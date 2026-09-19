import { reconcileWallet } from "../../../src/utils/reconcile.js";
import { withTransactionClassification } from "../../../src/utils/transactionClassifier.js";
import { resolveHistoricalInrValuation } from "./inrValuation.js";
import { computeAmmFinancialMetrics } from "./ammFinancialMetrics.js";
import {
  decodeReceiptAmmEvents,
  detectLiquidityActivities,
  trackLiquidityPositions,
  reconstructAmmRoute,
  computeEvidenceConfidence,
} from "./dexEventDecoder.js";

const ETH_MAINNET_CHAIN_ID = 1;
const MAX_PAGES = Number(process.env.WALLET_MAX_PAGES || 20);
const MAX_COUNTERPARTIES = Number(process.env.WALLET_MAX_COUNTERPARTIES || 8);
const MAX_DISPLAY_EDGES = 50;
const MAX_DEX_TX_LOOKUPS = Number(process.env.WALLET_MAX_DEX_TX_LOOKUPS || 100);
const DEX_FX_CACHE = new Map();
const TRANSACTION_CACHE = new Map();

const METASLEUTH_LABEL_URL = "https://aml.blocksec.com/address-label/api/v3/batch-labels";
const METASLEUTH_RISK_URL = "https://aml.blocksec.com/address-compliance/api/v3/risk-score";

const STABLECOINS = new Set(["USDC", "USDT", "DAI", "USDS", "USDE"]);

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

function assertEthereumAddress(address) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error("Enter a valid Ethereum wallet address (0x + 40 hexadecimal characters).");
  }
}

async function alchemyRpc(method, params) {
  const url = getAlchemyRpcUrl();
  if (!url) throw new Error("Ethereum on-chain access is not configured. Set ALCHEMY_ETH_API_KEY or ALCHEMY_ETH_RPC_URL in server/.env.");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`Alchemy returned HTTP ${response.status}.`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || `Alchemy ${method} failed.`);
  return payload.result;
}

async function alchemyTransfers(address, direction) {
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
    const result = await alchemyRpc("alchemy_getAssetTransfers", [params]) || {};
    transfers.push(...(result.transfers || []));
    pageKey = result.pageKey || "";
    if (!pageKey) break;
  }
  return transfers.map((transfer) => ({ ...transfer, direction }));
}

function transferKey(t) { return `${t.hash}:${t.uniqueId || ""}`; }

function normalizeTransfer(t, rootAddress) {
  const timestamp = t.metadata?.blockTimestamp || null;
  const from = t.from || "";
  const to = t.to || "";
  const isIncoming = from.toLowerCase() !== rootAddress.toLowerCase() && to.toLowerCase() === rootAddress.toLowerCase();
  const date = timestamp ? new Date(timestamp).toISOString() : null;
  return {
    chain: { id: ETH_MAINNET_CHAIN_ID, name: "Ethereum Mainnet" },
    wallet: rootAddress,
    date,
    type: isIncoming ? "DEPOSIT" : "WITHDRAWAL",
    asset: t.asset || (t.category === "external" || t.category === "internal" ? "ETH" : "TOKEN"),
    assetType: "VDA",
    amount: Number(t.value) || 0,
    inrValue: null,
    tdsStatus: "NOT_APPLICABLE",
    refId: `${t.hash}-${t.uniqueId || ""}`,
    provenanceOnly: true,
    txHash: t.hash,
    blockNumber: t.blockNum,
    fromAddress: from,
    toAddress: to,
    transferCategory: t.category,
    transactionSource: "ON_CHAIN",
  };
}

function transferRef(transfer) {
  return `${transfer.hash}-${transfer.uniqueId || ""}`;
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

function assetName(transfer) {
  return String(transfer.asset || (transfer.category === "external" || transfer.category === "internal" ? "ETH" : "TOKEN")).trim().toUpperCase();
}

function aggregateWalletMovements(transfers, rootAddress) {
  const root = rootAddress.toLowerCase();
  const map = new Map();
  for (const t of transfers) {
    if (!t.hash) continue;
    const from = String(t.from || "").toLowerCase();
    const to = String(t.to || "").toLowerCase();
    const isOut = from === root;
    const isIn = to === root;
    if (!isOut && !isIn) continue;
    const asset = assetName(t);
    const key = `${t.hash}:${asset}`;
    const current = map.get(key) || {
      hash: t.hash,
      asset,
      tokenAddress: t.rawContract?.address || null,
      decimals: t.rawContract?.decimals ?? t.rawContract?.decimal ?? null,
      category: t.category,
      blockNumber: t.blockNum || null,
      timestamp: t.metadata?.blockTimestamp || null,
      outgoingAmount: 0,
      incomingAmount: 0,
      outgoingCount: 0,
      incomingCount: 0,
      transferRefs: [],
    };
    const amount = Number(t.value) || 0;
    if (isOut) {
      current.outgoingAmount += amount;
      current.outgoingCount += 1;
    }
    if (isIn) {
      current.incomingAmount += amount;
      current.incomingCount += 1;
    }
    current.transferRefs.push(transferRef(t));
    map.set(key, current);
  }
  return Array.from(map.values());
}

async function getTransaction(hash) {
  if (TRANSACTION_CACHE.has(hash)) return TRANSACTION_CACHE.get(hash);
  try {
    const transaction = await alchemyRpc("eth_getTransactionByHash", [hash]);
    let receipt = null;
    try {
      receipt = await alchemyRpc("eth_getTransactionReceipt", [hash]);
      if (receipt?.status === "0x0") return null;
    } catch (receiptError) {
      // Transaction input is still useful for reconstruction if a provider
      // temporarily cannot return the receipt. Do not turn a receipt lookup
      // outage into a failed wallet analysis.
      console.warn(`Could not fetch receipt ${hash}: ${receiptError.message}`);
    }
    const record = { transaction, receipt };
    TRANSACTION_CACHE.set(hash, record);
    return record;
  } catch (err) {
    console.warn(`Could not fetch transaction ${hash}: ${err.message}`);
    TRANSACTION_CACHE.set(hash, null);
    return null;
  }
}

function buildGasEvidence(receipt, transaction, transactionHash) {
  const parseBigInt = (value) => {
    if (value == null || value === "") return null;
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  };
  const gasUsed = parseBigInt(receipt?.gasUsed);
  const gasPrice = parseBigInt(transaction?.gasPrice);
  const gasFeeWei = gasUsed != null && gasPrice != null ? gasUsed * gasPrice : null;
  const gasFeeEth = gasFeeWei == null ? null : Number(gasFeeWei) / 1e18;
  return {
    transactionHash,
    gasUsed: gasUsed == null ? null : gasUsed.toString(),
    gasPrice: gasPrice == null ? null : gasPrice.toString(),
    gasFeeWei: gasFeeWei == null ? null : gasFeeWei.toString(),
    gasFeeEth: Number.isFinite(gasFeeEth) ? gasFeeEth : null,
    evidence: { transactionHash, receiptStatus: receipt?.status || null },
  };
}

async function fetchUsdInr(date) {
  const day = date ? new Date(date).toISOString().slice(0, 10) : null;
  if (!day) {
    console.warn("[walletTracing] FX lookup failed", {
      requestedDate: date ?? null,
      httpStatus: null,
      ratesInrFinite: null,
      fromCache: false,
      errorCategory: "missing_date",
    });
    return null;
  }
  if (DEX_FX_CACHE.has(day)) {
    console.debug("[walletTracing] FX lookup", {
      requestedDate: day,
      httpStatus: null,
      ratesInrFinite: Number.isFinite(Number(DEX_FX_CACHE.get(day))),
      fromCache: true,
      errorCategory: null,
    });
    return DEX_FX_CACHE.get(day);
  }
  try {
    const response = await fetch(`https://api.frankfurter.app/${day}?from=USD&to=INR`);
    if (!response.ok) {
      console.warn("[walletTracing] FX lookup failed", {
        requestedDate: day,
        httpStatus: response.status,
        ratesInrFinite: null,
        fromCache: false,
        errorCategory: "http_error",
      });
      return null;
    }
    const payload = await response.json();
    const rate = Number(payload?.rates?.INR);
    const value = Number.isFinite(rate) ? rate : null;
    if (value == null) {
      console.warn("[walletTracing] FX lookup failed", {
        requestedDate: day,
        httpStatus: response.status,
        ratesInrFinite: false,
        fromCache: false,
        errorCategory: "invalid_inr_rate",
      });
    } else {
      console.debug("[walletTracing] FX lookup succeeded", {
        requestedDate: day,
        httpStatus: response.status,
        ratesInrFinite: true,
        fromCache: false,
        errorCategory: null,
      });
    }
    if (value != null) DEX_FX_CACHE.set(day, value);
    return value;
  } catch (error) {
    console.warn("[walletTracing] FX lookup failed", {
      requestedDate: day,
      httpStatus: null,
      ratesInrFinite: null,
      fromCache: false,
      errorCategory:
        error?.name === "SyntaxError"
          ? "invalid_json"
          : error?.name === "AbortError"
            ? "request_aborted"
            : "network_or_request_error",
    });
    return null;
  }
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

function dexSignal(tx, label) {
  const to = String(tx?.to || "").toLowerCase();
  const input = String(tx?.input || "").toLowerCase();
  const selector = input.slice(0, 10);
  const entity = String(label?.main_entity || label?.main_entity_info?.entity || "").toLowerCase();
  const nameTag = String(label?.name_tag || "").toLowerCase();
  return { hasEntityLabel: Boolean(entity || nameTag), selector, to, isContractCall: Boolean(tx?.to && input && input !== "0x") };
}

async function reconstructLiquidityEvents(rootAddress, transfers) {
  const grouped = aggregateWalletMovements(transfers, rootAddress);
  const byHash = new Map();
  for (const movement of grouped) {
    if (!byHash.has(movement.hash)) byHash.set(movement.hash, []);
    byHash.get(movement.hash).push(movement);
  }

  const activities = [];
  for (const [hash, movements] of byHash) {
    const txRecord = await getTransaction(hash);
    if (!txRecord?.receipt) continue;
    const ammResult = decodeReceiptAmmEvents(txRecord.receipt.logs, hash);
    const detected = detectLiquidityActivities({
      decodedEvents: ammResult.decodedEvents,
      logs: txRecord.receipt.logs,
    });
    for (const activity of detected) {
      const isAddition = activity.eventType === "LIQUIDITY_ADD";
      const walletMovement = movements.some((movement) => isAddition
        ? movement.outgoingAmount > 0
        : movement.incomingAmount > 0);
      if (!walletMovement) continue;
      activities.push({
        ...activity,
        sourceTransferRefs: [...new Set(movements.flatMap((movement) => movement.transferRefs))],
      });
    }
  }
  return activities;
}

async function reconstructDexEvents(rootAddress, transfers, labels) {
  const grouped = aggregateWalletMovements(transfers, rootAddress);
  const byHash = new Map();
  for (const movement of grouped) {
    if (!byHash.has(movement.hash)) byHash.set(movement.hash, []);
    byHash.get(movement.hash).push(movement);
  }
  const candidates = [];
  let lookups = 0;
  for (const [hash, movements] of byHash) {
    if (lookups >= MAX_DEX_TX_LOOKUPS) break;
    const outgoing = movements.filter((m) => m.outgoingAmount > 0);
    const incoming = movements.filter((m) => m.incomingAmount > 0);
    if (!outgoing.length || !incoming.length) continue;
    if (outgoing.some((m) => m.asset === incoming[0]?.asset) && outgoing.length === 1 && incoming.length === 1) continue;
    const txRecord = await getTransaction(hash);
    lookups += 1;
    if (!txRecord) continue;
    const tx = txRecord.transaction;
    const receipt = txRecord.receipt;
    const label = labels[String(tx.to || "").toLowerCase()] || null;
    const signal = dexSignal(tx, label);
    // Decode receipt logs first — they are the primary evidence source.
    const ammResult = decodeReceiptAmmEvents(receipt?.logs, hash);
    const { decodedEvents: decodedAmmEvents, uninterpretedLogs, hasAmmSwap, primaryPoolAddress, allPoolAddresses } = ammResult;
    const hasLiquidityEvent = decodedAmmEvents.some((event) => ["Mint", "Burn"].includes(event.eventType));
    // Evidence-driven gate: admit candidate if (a) receipt contains a verified AMM swap,
    // (b) entity metadata labels the destination as a DEX, or (c) receipt contains any
    // verified AMM event (Sync/Mint/Burn alongside opposing flows). Never gate on a
    // hardcoded address list or function selector list.
    const hasAmmEvent = decodedAmmEvents.length > 0;
    if (!hasAmmSwap && hasLiquidityEvent) continue;
    if (!(signal.isContractCall && (hasAmmSwap || hasAmmEvent))) continue;
    const out = outgoing.sort((a, b) => b.outgoingAmount - a.outgoingAmount)[0];
    const inn = incoming.sort((a, b) => b.incomingAmount - a.incomingAmount)[0];
    if (!out || !inn || out.asset === inn.asset) continue;
    const route = reconstructAmmRoute({
      decodedEvents: decodedAmmEvents,
      logs: receipt?.logs,
      walletTransfers: { outgoing: out, incoming: inn },
    });
    const financialMetrics = computeAmmFinancialMetrics({
      decodedEvents: decodedAmmEvents,
      route: route.route,
      gasEvidence: buildGasEvidence(receipt, tx, hash),
    });
    const timestamp = out.timestamp || inn.timestamp || null;
    const fxRate = await fetchUsdInr(timestamp);
    const receivedValuation = await resolveHistoricalInrValuation({
      asset: inn.asset,
      tokenAddress: inn.tokenAddress || null,
      amount: inn.incomingAmount,
      date: timestamp,
      fxRateInr: fxRate,
    });
    const settledInr =
      receivedValuation.actualInrReceived ?? receivedValuation.estimatedInrValue ?? null;
    const receivedFmv = settledInr != null && inn.incomingAmount > 0
      ? Number((settledInr / inn.incomingAmount).toFixed(12))
      : null;
    const spentStableFmv = STABLECOINS.has(out.asset) && fxRate != null ? fxRate : null;

    const row = {
      date: timestamp ? new Date(timestamp).toISOString() : null,
      exchange: label?.main_entity || label?.name_tag || "DEX",
      type: "SELL",
      asset: out.asset,
      assetType: "VDA",
      amount: Number(out.outgoingAmount.toFixed(12)),
      receivedAsset: inn.asset,
      receivedAssetType: "VDA",
      receivedAmount: Number(inn.incomingAmount.toFixed(12)),
      receivedAssetFmvInrPerUnit: receivedFmv,
      quoteCurrency: inn.asset,
      unitPrice: spentStableFmv && out.outgoingAmount > 0 ? Number((inn.incomingAmount * fxRate / out.outgoingAmount).toFixed(12)) : null,
      // Prefer verified settlement INR; never promote estimated FMV as verified.
      inrValue: settledInr,
      actualInrReceived: receivedValuation.actualInrReceived,
      estimatedInrValue: receivedValuation.estimatedInrValue,
      valuationStatus: receivedValuation.valuationStatus,
      valuationEvidence: {
        ...receivedValuation.valuationEvidence,
        transactionHash: hash,
        blockNumber: out.blockNumber || null,
        receiptStatus: receipt?.status || null,
        receiptLogCount: Array.isArray(receipt?.logs) ? receipt.logs.length : null,
        decodedReceiptEventCount: decodedAmmEvents.length,
        uninterpretedLogCount: uninterpretedLogs.length,
        poolAddress: primaryPoolAddress,
        ammEvents: decodedAmmEvents,
        route: route.route,
        routeStatus: route.routeStatus,
        logicalInput: route.logicalInput,
        logicalOutput: route.logicalOutput,
        financialMetrics,
      },
      tdsStatus: "NOT_REPORTED",
      tdsAmount: null,
      refId: `onchain-${hash}`,
      txHash: hash,
      blockNumber: out.blockNumber || null,
      wallet: rootAddress,
      transactionSource: "DECENTRALIZED_DEX",
      provenanceOnly: false,
      reconstruction: {
        kind: "DEX_SWAP",
        ...computeEvidenceConfidence({
          hasOpposingFlow: true,
          hasAmmSwap,
          hasAmmEvent: decodedAmmEvents.length > 0,
          isSuccess: receipt?.status === "0x1",
          hasEntityLabel: signal.hasEntityLabel,
          hasValuation: settledInr != null,
        }),
        dexAddress: tx.to || null,
        dexEntity: label?.main_entity || label?.main_entity_info?.entity || null,
        dexNameTag: label?.name_tag || "",
        selector: signal.selector || null,
        outgoingAssets: outgoing.map((m) => ({ asset: m.asset, amount: m.outgoingAmount })),
        incomingAssets: incoming.map((m) => ({ asset: m.asset, amount: m.incomingAmount })),
        sourceTransferRefs: [
          ...new Set([...outgoing, ...incoming].flatMap((movement) => movement.transferRefs)),
        ],
        valuation: receivedValuation.valuationStatus,
        verifiedByReceipt: hasAmmSwap,
        poolAddress: primaryPoolAddress,
        poolAddresses: allPoolAddresses,
        decodedEvents: decodedAmmEvents,
        uninterpretedLogs,
        route: route.route,
        routeStatus: route.routeStatus,
        logicalInput: route.logicalInput,
        logicalOutput: route.logicalOutput,
        financialMetrics,
      },
    };
    candidates.push(withTransactionClassification(row));
  }
  return candidates;
}

export async function analyzeEthereumWallet(address, { includeNormalizedRows = false } = {}) {
  const rootAddress = address.trim();
  assertEthereumAddress(rootAddress);
  const [incoming, outgoing] = await Promise.all([
    alchemyTransfers(rootAddress, "in"),
    alchemyTransfers(rootAddress, "out"),
  ]);
  const transferMap = new Map();
  for (const transfer of [...incoming, ...outgoing]) transferMap.set(transferKey(transfer), transfer);
  const transfers = Array.from(transferMap.values());
  const flow = buildFlow(rootAddress, transfers);

  // Enrich the wallet plus flow counterparties. The address list stays small
  // to respect MetaSleuth quotas; DEX reconstruction still works from raw
  // on-chain evidence when MetaSleuth is unavailable or rate-limited.
  const addresses = [...new Map([rootAddress, ...flow.counterparties].map((value) => [value.toLowerCase(), value])).values()].slice(0, 3);
  const hasLabelKey = Boolean(getMetaSleuthLabelApiKey());
  const hasRiskKey = Boolean(getMetaSleuthRiskApiKey());
  let labels = {}, risk = {};
  let metaSleuthRateLimited = false;
  if (hasLabelKey) {
    labels = await fetchMetaSleuthLabels(addresses, ETH_MAINNET_CHAIN_ID);
    metaSleuthRateLimited = labels.__rateLimited === true;
  }
  if (hasRiskKey) {
    const riskResults = await Promise.all(addresses.map(async (addr) => [addr.toLowerCase(), await fetchMetaSleuthRisk(addr, ETH_MAINNET_CHAIN_ID)]));
    risk = Object.fromEntries(riskResults);
    metaSleuthRateLimited = metaSleuthRateLimited || riskResults.some(([, result]) => result?.__rateLimited === true);
  }

  // DEX contract addresses are discovered from the transaction itself. If the
  // destination was among the MetaSleuth-enriched addresses, its label is also
  // used as a supporting signal.
  const dexEvents = await reconstructDexEvents(rootAddress, transfers, labels);
  const liquidityEvents = await reconstructLiquidityEvents(rootAddress, transfers);
  const liquidityPositions = trackLiquidityPositions(liquidityEvents);
  const normalizedRows = includeNormalizedRows ? transfers.map((t) => normalizeTransfer(t, rootAddress)) : null;

  const dexTransferRefs = new Map();
  dexEvents.forEach((event) => {
    (event.reconstruction?.sourceTransferRefs || []).forEach((ref) => {
      dexTransferRefs.set(ref, event.refId);
    });
  });
  const liquidityTransferRefs = new Map();
  liquidityEvents.forEach((event) => {
    event.sourceTransferRefs.forEach((ref) => liquidityTransferRefs.set(ref, event));
  });
  const transactionRecords = new Map();
  for (const hash of new Set(transfers.map((transfer) => transfer.hash).filter(Boolean))) {
    transactionRecords.set(hash, await getTransaction(hash));
  }
  const transferOutcomes = transfers.map((transfer) => {
    const normalized = withTransactionClassification(normalizeTransfer(transfer, rootAddress));
    const refId = transferRef(transfer);
    if (liquidityTransferRefs.has(refId)) {
      const event = liquidityTransferRefs.get(refId);
      return {
        refId,
        txHash: transfer.hash,
        type: "LIQUIDITY_EVENT_LEG",
        status: "RECONSTRUCTED_LIQUIDITY_LEG",
        complianceIncluded: false,
        accountedFor: true,
        fullyVerified: event.interpretationStatus === "VERIFIED_LIQUIDITY_EVENT",
        reconstructedEventId: `${event.eventType}:${event.transactionHash}:${event.logIndex}`,
        valuationStatus: "NOT_APPLICABLE",
        reason: event.interpretationStatus === "VERIFIED_LIQUIDITY_EVENT"
          ? "Raw transfer leg grouped into receipt-verified liquidity activity; excluded from DEX swap compliance rows."
          : "Raw transfer leg grouped into incomplete liquidity evidence; excluded from DEX swap compliance rows.",
        evidenceSources: ["Alchemy asset transfer", "Alchemy transaction receipt", "Decoded AMM liquidity event"],
        classification: normalized.transactionClassification,
      };
    }
    if (dexTransferRefs.has(refId)) {
      const event = dexEvents.find((candidate) => candidate.refId === dexTransferRefs.get(refId));
      const valuationStatus = event?.valuationStatus || "UNAVAILABLE";
      const fullyVerified = valuationStatus === "VERIFIED_INR";
      return {
        refId,
        txHash: transfer.hash,
        type: "DEX_SWAP_LEG",
        status: "RECONSTRUCTED_DEX_LEG",
        complianceIncluded: true,
        // Accounted = grouped into an economic event. Verified = settlement INR only.
        accountedFor: true,
        fullyVerified,
        reconstructedEventId: dexTransferRefs.get(refId),
        valuationStatus,
        reason: fullyVerified
          ? "Raw transfer leg grouped into one reconstructed DEX economic event with verified INR settlement."
          : valuationStatus === "ESTIMATED_INR"
            ? "Raw transfer leg grouped into one reconstructed DEX economic event with estimated INR fair-market value only."
            : "Raw transfer leg grouped into one reconstructed DEX economic event.",
        evidenceSources: [
          "Alchemy asset transfer",
          "Alchemy transaction receipt",
          "DEX router/selector",
          ...(event?.reconstruction?.verifiedByReceipt ? ["Decoded AMM receipt events"] : []),
        ],
        classification: normalized.transactionClassification,
      };
    }
    const classification = normalized.transactionClassification;
    const outcomeType = classification.status === "NOT_TRANSFER"
      ? "SELF_TRANSFER"
      : classification.status === "UNDETERMINED"
        ? "MANUAL_REVIEW"
        : classification.status === "NOT_VDA"
          ? "UNSUPPORTED_EVENT"
          : "PROVENANCE_ONLY";
    const isPendingReview = outcomeType === "MANUAL_REVIEW" || outcomeType === "PROVENANCE_ONLY";
    const isExcluded = outcomeType === "SELF_TRANSFER" || outcomeType === "UNSUPPORTED_EVENT";
    return {
      refId,
      txHash: transfer.hash,
      type: outcomeType,
      status: isPendingReview
        ? "PENDING_MANUAL_REVIEW"
        : outcomeType === "SELF_TRANSFER"
          ? "EXCLUDED_SELF_TRANSFER"
          : "EXCLUDED_UNSUPPORTED",
      complianceIncluded: false,
      // Pending review is classified but not reconciled. Excluded rows are accounted
      // as non-compliance outcomes. Never treat pending as accounted/verified.
      accountedFor: isExcluded,
      fullyVerified: false,
      reconstructedEventId: null,
      valuationStatus: "UNAVAILABLE",
      reason: classification.reason || "Economic ownership or disposition evidence is unavailable.",
      evidenceSources: transactionRecords.get(transfer.hash)
        ? ["Alchemy asset transfer", "Alchemy transaction receipt"]
        : ["Alchemy asset transfer"],
      classification,
    };
  });
  const inventory = transfers.map((transfer) => {
    const refId = transferRef(transfer);
    const record = transactionRecords.get(transfer.hash);
    const receipt = record?.receipt || null;
    const transaction = record?.transaction || null;
    const outcome = transferOutcomes.find((candidate) => candidate.refId === refId);
    const event = outcome?.reconstructedEventId
      ? dexEvents.find((candidate) => candidate.refId === outcome.reconstructedEventId)
      : null;
    const liquidityEvent = outcome?.type === "LIQUIDITY_EVENT_LEG"
      ? liquidityEvents.find((candidate) => candidate.sourceTransferRefs.includes(refId))
      : null;
    const ammFallback = event ? null : decodeReceiptAmmEvents(receipt?.logs, transfer.hash);
    const decodedAmmEvents = event?.reconstruction?.decodedEvents ?? ammFallback?.decodedEvents ?? [];
    const gasEvidence = buildGasEvidence(receipt, transaction, transfer.hash);
    const from = transfer.from || null;
    const to = transfer.to || null;
    return {
      rawTransferId: refId,
      txHash: transfer.hash || null,
      uniqueId: transfer.uniqueId || null,
      blockNumber: transfer.blockNum || null,
      timestamp: transfer.metadata?.blockTimestamp || null,
      asset: assetName(transfer),
      tokenContract: transfer.rawContract?.address || null,
      decimals: transfer.rawContract?.decimals ?? transfer.rawContract?.decimal ?? null,
      amount: Number.isFinite(Number(transfer.value)) ? Number(transfer.value) : null,
      from,
      to,
      direction: from?.toLowerCase() === rootAddress.toLowerCase() ? "OUT" : "IN",
      transactionCategory: transfer.category || null,
      gasFeeWei: gasEvidence.gasFeeWei,
      gasFeeEth: gasEvidence.gasFeeEth,
      receiptStatus: receipt?.status || null,
      receiptLogCount: Array.isArray(receipt?.logs) ? receipt.logs.length : null,
      transactionInputSelector: transaction?.input ? transaction.input.slice(0, 10) : null,
      linkedEconomicEventId: outcome?.reconstructedEventId || null,
      status: outcome?.status || "PENDING_MANUAL_REVIEW",
      accountedFor: outcome?.accountedFor === true,
      fullyVerified: outcome?.fullyVerified === true,
      valuationStatus: outcome?.valuationStatus || "UNAVAILABLE",
      reason: outcome?.reason || "No outcome was produced.",
      evidenceSources: outcome?.evidenceSources || ["Alchemy asset transfer"],
      poolAddress: event?.reconstruction?.poolAddress || ammFallback?.primaryPoolAddress || decodedAmmEvents[0]?.poolAddress || null,
      receiptVerified: event ? (event.reconstruction?.verifiedByReceipt ?? false) : (ammFallback?.hasAmmSwap ?? decodedAmmEvents.some((e) => e.eventType === "Swap")),
      decodedAmmEvents,
      liquidityEvent,
    };
  });
  const outcomeCounts = Object.fromEntries(
    Object.entries(Object.groupBy(transferOutcomes, (outcome) => outcome.type))
      .map(([type, outcomes]) => [type, outcomes.length])
  );
  const pendingReviewCount = transferOutcomes.filter(
    (outcome) => outcome.status === "PENDING_MANUAL_REVIEW"
  ).length;
  const traceability = {
    rawTransferCount: transfers.length,
    classifiedTransferCount: transferOutcomes.length,
    reconstructedEventCount: dexEvents.length,
    complianceRowCount: dexEvents.length,
    liquidityEventCount: liquidityEvents.length,
    liquidityPositionCount: liquidityPositions.length,
    excludedTransferCount: transferOutcomes.filter(
      (outcome) => !outcome.complianceIncluded && outcome.status !== "PENDING_MANUAL_REVIEW"
    ).length,
    pendingReviewCount,
    accountedTransferCount: transferOutcomes.filter((outcome) => outcome.accountedFor).length,
    verifiedRecordCount: transferOutcomes.filter((outcome) => outcome.fullyVerified).length,
    estimatedValueRecordCount: transferOutcomes.filter((outcome) => outcome.valuationStatus === "ESTIMATED_INR").length,
    // Unmatched excludes pending-review: those are known but unresolved, not missing.
    unmatchedTransferCount: transferOutcomes.filter(
      (outcome) => !outcome.accountedFor && outcome.status !== "PENDING_MANUAL_REVIEW"
    ).length,
    outcomeCounts,
    transferOutcomes,
    inventory,
    liquidityPositions,
  };

  const walletRows = normalizedRows || transfers.map((t) => normalizeTransfer(t, rootAddress));
  const walletReconciliation = reconcileWallet(walletRows.map((row) => withTransactionClassification(row)));
  const dexHashes = new Set(dexEvents.map((event) => event.txHash));
  walletReconciliation.derivedDexEventCount = dexEvents.length;
  walletReconciliation.taxableTransactionCount = dexEvents.length;
  walletReconciliation.manualVerification = (walletReconciliation.manualVerification || []).filter(
    (item) => !dexHashes.has(String(item.refId || "").split("-")[0])
  );
  walletReconciliation.manualVerificationCount = walletReconciliation.manualVerification.length;
  walletReconciliation.tdsStatus = dexEvents.some((r) => r.inrValue != null)
    ? "PARTIALLY_DETERMINED"
    : walletReconciliation.tdsStatus;
  walletReconciliation.reason = walletReconciliation.manualVerificationCount > 0
    ? "Some wallet movements still require ownership/manual verification."
    : dexEvents.length > 0
      ? "DEX swap event(s) were reconstructed from observable on-chain movements. Consideration was determined where an independent INR valuation was available."
      : walletReconciliation.reason;

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
    chain: { id: ETH_MAINNET_CHAIN_ID, name: "Ethereum Mainnet" },
    wallet: rootAddress,
    transferCount: transfers.length,
    derivedDexEventCount: dexEvents.length,
    derivedLiquidityEventCount: liquidityEvents.length,
    derivedTransactions: dexEvents,
    derivedLiquidityEvents: liquidityEvents,
    derivedLiquidityPositions: liquidityPositions,
    traceability,
    ...(includeNormalizedRows ? { normalizedRows } : {}),
    provenance: {
      ...flow,
      nodes,
      note: "Observable one-hop on-chain provenance. This does not prove ultimate real-world identity or ultimate source of funds.",
    },
    enrichment: {
      provider: "MetaSleuth", status: metaSleuthRateLimited ? "rate_limited" : (hasLabelKey && hasRiskKey ? "live" : (hasLabelKey || hasRiskKey ? "partial" : "not_configured")),
      note: metaSleuthRateLimited ? "MetaSleuth rate limit reached; blockchain provenance and DEX reconstruction still use on-chain evidence." : hasLabelKey && hasRiskKey ? "Address labels and risk scores were requested from MetaSleuth." : hasLabelKey ? "Address labels were requested from MetaSleuth; Risk Score API key is not configured." : hasRiskKey ? "Risk scores were requested from MetaSleuth; Address Label API key is not configured." : "MetaSleuth API keys are not configured; blockchain provenance is still available.",
    },
    reconciliation: walletReconciliation,
  };
}
