function getAlchemyRpcUrl() {
  const apiKey = process.env.ALCHEMY_ETH_API_KEY || "";
  return process.env.ALCHEMY_ETH_RPC_URL ||
    (apiKey ? `https://eth-mainnet.g.alchemy.com/v2/${apiKey}` : "");
}
function getMetaSleuthLabelApiKey() {
  return process.env.METASLEUTH_ADDRESS_LABEL_API_KEY || "";
}

function getMetaSleuthRiskApiKey() {
  return process.env.METASLEUTH_RISK_SCORE_API_KEY || "";
}
const METASLEUTH_LABEL_URL = "https://aml.blocksec.com/address-label/api/v3/batch-labels";
const METASLEUTH_RISK_URL = "https://aml.blocksec.com/address-compliance/api/v3/risk-score";
const MAX_PAGES = Number(process.env.WALLET_MAX_PAGES || 20);
const MAX_COUNTERPARTIES = Number(process.env.WALLET_MAX_COUNTERPARTIES || 8);
const MAX_DISPLAY_EDGES = 50;

function assertEthereumAddress(address) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error("Enter a valid Ethereum wallet address (0x + 40 hexadecimal characters).");
  }
}

async function alchemyTransfers(address, direction) {
  const ALCHEMY_RPC_URL = getAlchemyRpcUrl();
  if (!ALCHEMY_RPC_URL) {
    throw new Error("Ethereum on-chain access is not configured. Set ALCHEMY_ETH_API_KEY or ALCHEMY_ETH_RPC_URL in server/.env.");
  }
  const transfers = [];
  let pageKey;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = {
      fromBlock: "0x0", toBlock: "latest",
      category: ["external", "internal", "erc20"],
      withMetadata: true, excludeZeroValue: true, maxCount: "0x3e8", order: "asc",
      ...(direction === "in" ? { toAddress: address } : { fromAddress: address }),
      ...(pageKey ? { pageKey } : {}),
    };
    const response = await fetch(ALCHEMY_RPC_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "alchemy_getAssetTransfers", params: [params] }),
    });
    if (!response.ok) throw new Error(`Alchemy returned HTTP ${response.status}.`);
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error.message || "Alchemy transfer query failed.");
    const result = payload.result || {};
    transfers.push(...(result.transfers || []));
    pageKey = result.pageKey || "";
    if (!pageKey) break;
  }
  return transfers.map((transfer) => ({ ...transfer, direction }));
}

function transferKey(t) { return `${t.hash}:${t.uniqueId || ""}`; }

function normalizeTransfer(t, rootAddress) {
  const timestamp = t.metadata?.blockTimestamp || "";
  const from = t.from || "";
  const to = t.to || "";
  const isIncoming = from.toLowerCase() !== rootAddress.toLowerCase() && to.toLowerCase() === rootAddress.toLowerCase();
  return {
    exchange: `Wallet ${rootAddress.slice(-4)}`,
    date: timestamp ? timestamp.slice(0, 10) : "",
    type: isIncoming ? "DEPOSIT" : "WITHDRAWAL",
    asset: t.asset || (t.category === "external" || t.category === "internal" ? "ETH" : "TOKEN"),
    assetType: "VDA", amount: Number(t.value) || 0, inrValue: 0,
    tdsStatus: "NOT_APPLICABLE", refId: `${t.hash}-${t.uniqueId || ""}`,
    provenanceOnly: true,
    txHash: t.hash, blockNumber: t.blockNum, fromAddress: from, toAddress: to,
    transferCategory: t.category,
  };
}

function buildFlow(rootAddress, transfers) {
  const root = rootAddress.toLowerCase();
  const edges = [];
  const counterparties = [];
  const counterpartySet = new Set();
  let totalEdges = 0;

  for (const t of transfers) {
    const from = t.from || "", to = t.to || "";
    if (!from || !to) continue;

    const counterparty = from.toLowerCase() === root ? to : from;
    if (counterparty && counterparty.toLowerCase() !== root && !counterpartySet.has(counterparty.toLowerCase())) {
      counterpartySet.add(counterparty.toLowerCase());
      if (counterparties.length < MAX_COUNTERPARTIES) counterparties.push(counterparty);
    }

    totalEdges += 1;
    // The UI only renders a small sample. Keep the full transfer count but
    // avoid returning tens of thousands of edge objects to the browser.
    if (edges.length < MAX_DISPLAY_EDGES) {
      edges.push({
        txHash: t.hash, blockNumber: t.blockNum, timestamp: t.metadata?.blockTimestamp || null,
        asset: t.asset || (t.category === "external" || t.category === "internal" ? "ETH" : "TOKEN"),
        amount: Number(t.value) || 0, category: t.category, from, to,
        direction: from.toLowerCase() === root ? "OUT" : "IN",
        path: from.toLowerCase() === root ? [rootAddress, to] : [from, rootAddress],
      });
    }
  }

  return { rootAddress, hopDepth: 1, edges, totalEdges, counterparties };
}

async function fetchMetaSleuthLabels(addresses, chainId) {
  const apiKey = getMetaSleuthLabelApiKey();
  if (!apiKey || !addresses.length) return {};
  const response = await fetch(METASLEUTH_LABEL_URL, {
    method: "POST", headers: { "Content-Type": "application/json", "API-KEY": apiKey },
    body: JSON.stringify({ chain_id: chainId, addresses }),
  });
  if (!response.ok) {
  if (response.status === 429) {
  console.warn("MetaSleuth Address Label rate limit reached.");
  return { __rateLimited: true };
}

  throw new Error(`MetaSleuth Address Label returned HTTP ${response.status}.`);
}
  const payload = await response.json();
  if (payload.code && payload.code !== 200000) throw new Error(payload.message || "MetaSleuth Address Label request failed.");
  const rows = Array.isArray(payload.data) ? payload.data : [];
  return Object.fromEntries(rows.map((row) => [row.address?.toLowerCase(), row]));
}

async function fetchMetaSleuthRisk(address, chainId) {
  const apiKey = getMetaSleuthRiskApiKey();
  if (!apiKey) return null;
  const response = await fetch(METASLEUTH_RISK_URL, {
    method: "POST", headers: { "Content-Type": "application/json", "API-KEY": apiKey },
    body: JSON.stringify({ chain_id: chainId, address, interaction_risk: true }),
  });
  if (!response.ok) {
  if (response.status === 429) {
    console.warn(`MetaSleuth Risk Score rate limit reached for ${address}.`);
    return { __rateLimited: true };
  }

  throw new Error(`MetaSleuth Risk Score returned HTTP ${response.status}.`);
}
  const payload = await response.json();
  if (payload.code && payload.code !== 200000) throw new Error(payload.message || "MetaSleuth Risk Score request failed.");
  return payload.data || null;
}

function riskLevel(score) {
  if (score == null) return "UNKNOWN";
  if (score >= 4) return "HIGH";
  if (score === 3) return "MEDIUM";
  return "LOW";
}

export async function analyzeEthereumWallet(address, { includeNormalizedRows = false } = {}) {
  const rootAddress = address.trim();
  assertEthereumAddress(rootAddress);
  const [incoming, outgoing] = await Promise.all([
    alchemyTransfers(rootAddress, "in"), alchemyTransfers(rootAddress, "out"),
  ]);
  const transferMap = new Map();
  for (const transfer of [...incoming, ...outgoing]) transferMap.set(transferKey(transfer), transfer);
  const transfers = Array.from(transferMap.values());
  const normalizedRows = includeNormalizedRows
    ? transfers.map((t) => normalizeTransfer(t, rootAddress)).sort((a, b) => a.date.localeCompare(b.date))
    : null;
  const flow = buildFlow(rootAddress, transfers);
  const addresses = [
  ...new Map(
    [rootAddress, ...flow.counterparties].map((address) => [
      address.toLowerCase(),
      address,
    ])
  ).values(),
].slice(0, 3);
  const chainId = 1;
  const hasLabelKey = Boolean(getMetaSleuthLabelApiKey());
  const hasRiskKey = Boolean(getMetaSleuthRiskApiKey());
  let labels = {}, risk = {};
  let metaSleuthRateLimited = false;

  if (hasLabelKey) {
    labels = await fetchMetaSleuthLabels(addresses, chainId);
    metaSleuthRateLimited = labels.__rateLimited === true;
  }

  if (hasRiskKey) {
    const riskResults = await Promise.all(
      addresses.map(async (addr) => [addr.toLowerCase(), await fetchMetaSleuthRisk(addr, chainId)])
    );
    risk = Object.fromEntries(riskResults);
    metaSleuthRateLimited =
      metaSleuthRateLimited || riskResults.some(([, result]) => result?.__rateLimited === true);
  }
  const enrichmentStatus = metaSleuthRateLimited ? "rate_limited" : (hasLabelKey && hasRiskKey ? "live" : (hasLabelKey || hasRiskKey ? "partial" : "not_configured"));
  const nodes = addresses.map((addressValue) => {
    const label = labels[addressValue.toLowerCase()] || null;
    const riskData = risk[addressValue.toLowerCase()] || null;
    const score = riskData?.risk_score ?? null;
    return {
      address: addressValue,
      entity: label?.main_entity || label?.main_entity_info?.entity || null,
      nameTag: label?.name_tag || "",
      attributes: label?.attributes || [],
      riskScore: score,
      riskLevel: riskLevel(score),
      riskIndicators: riskData?.risk_indicators || [],
      source: { blockchain: "Ethereum", addressLabel: hasLabelKey, riskScore: hasRiskKey },
    };
  });
  return {
    chain: { id: 1, name: "Ethereum Mainnet" }, wallet: rootAddress,
    transferCount: transfers.length,
    ...(includeNormalizedRows ? { normalizedRows } : {}),
    provenance: {
      ...flow,
      nodes,
      note: "Observable one-hop on-chain provenance. This does not prove ultimate real-world identity or ultimate source of funds.",
    },
    enrichment: {
      provider: "MetaSleuth", status: enrichmentStatus,
      note: metaSleuthRateLimited ? "MetaSleuth rate limit reached; blockchain provenance is still available." : hasLabelKey && hasRiskKey ? "Address labels and risk scores were requested from MetaSleuth." : hasLabelKey ? "Address labels were requested from MetaSleuth; Risk Score API key is not configured." : hasRiskKey ? "Risk scores were requested from MetaSleuth; Address Label API key is not configured." : "MetaSleuth API keys are not configured; blockchain provenance is still available.",
    },
  };
}
