# T-REX — Crypto TDS Compliance & Verifiable Reporting

T-REX (formerly ChainTDS) is a fintech + blockchain prototype for reconciling crypto/VDA transaction records across exchanges and wallets, determining the consideration relevant to Section 194S, identifying TDS discrepancies, explaining findings with AI, and certifying the finalized report with SHA-256 + Polygon Amoy verification.

> **Core principle:** deterministic rules determine compliance; AI explains the deterministic results; blockchain certifies the finalized report.

## Current status

This repository is the Vercel-ready prototype. The current implementation includes:

- CSV ingestion and normalization
- Exchange adapters for WazirX, CoinDCX, and Binance-style API responses
- Wallet ingestion interface with mock fallback / Alchemy integration path
- Cross-exchange reconciliation and transfer matching
- Deterministic Section 194S TDS discrepancy calculation
- **Deterministic consideration determination before 194S calculation**
- AI compliance explanation / investigation layer
- PDF report generation
- SHA-256 report fingerprinting
- Simulated blockchain anchoring plus real Polygon Amoy contract integration
- MetaMask authorization and public hash/QR verification flow
- Taxpayer, auditor, and regulator dashboard structure
- Power BI-style analytics component
- Existing authentication / KYC / email-verification backend structure
- Vercel-ready frontend + `/api/*` Express backend

### Currently on hold

**Beeceptor integration is intentionally on hold.** The architecture is prepared for mocked CoinDCX/Binance/wallet APIs, but Beeceptor credits/access have not been made a dependency of the current build yet. When enabled, the preferred flow is:

```text
Vercel frontend
      ↓
T-REX API/backend
      ↓
Beeceptor mock exchange/wallet endpoints
      ↓
normalized transactions
      ↓
reconciliation + consideration + 194S
```

Do not place database passwords, JWT secrets, SMTP passwords, blockchain private keys, or other secrets in Beeceptor.

---

## End-to-end architecture

```text
CoinDCX / Binance / WazirX / Wallet data
                  │
                  ▼
        Ingestion / CSV / API adapters
                  │
                  ▼
              Normalize
                  │
                  ▼
            Reconciliation
                  │
                  ▼
      Determine Consideration
                  │
        ┌─────────┼──────────┐
        │         │          │
        ▼         ▼          ▼
     VDA→INR  VDA→FX    VDA→VDA
        │         │          │
        └─────────┼──────────┘
                  ▼
          Section 194S rules
                  │
                  ▼
          TDS discrepancies
                  │
                  ▼
       AI explanation / review
                  │
                  ▼
             Final report
                  │
                  ▼
             SHA-256 hash
                  │
                  ▼
          MetaMask / Polygon
                  │
                  ▼
          QR / public verify
```

Sensitive transaction data is not intended to be stored on-chain. The blockchain layer certifies the report fingerprint.

---

## 1. Consideration determination

### Why this step exists

Section 194S applies a 1% TDS rate to the consideration for transfer of a VDA. The engine therefore should not conceptually jump directly from an arbitrary `amount`, `price`, or precomputed `inr_value` field to TDS.

The implementation now has an explicit deterministic module:

```text
src/utils/consideration.js
```

The module exposes:

```js
import {
  determineConsideration,
  withDeterminedConsideration,
} from "./utils/consideration.js";
```

Every normalized transaction is passed through `withDeterminedConsideration()` before it reaches the TDS engine.

### Supported consideration forms

#### A. VDA → INR

When the transaction contains quantity and INR unit price:

```text
consideration INR = VDA quantity × INR unit price
```

Example:

```text
0.05 BTC × ₹5,600,000/BTC
= ₹280,000 consideration
```

The engine does not need to trust a precomputed total when the underlying quantity and unit price are available.

#### B. VDA → foreign currency

When the quote currency is foreign, the engine calculates the foreign-currency consideration first and then converts it to INR:

```text
foreign consideration
= VDA quantity × foreign-currency unit price

INR consideration
= foreign consideration × INR/foreign-currency FX rate
```

Example:

```text
0.01 BTC × 64,500 USDT/BTC
= 645 USDT

645 USDT × ₹87/USDT
= ₹56,115 consideration
```

#### C. VDA → VDA

For an exchange of one VDA for another, the normalized transaction can carry the received VDA quantity and its INR fair-market value per unit:

```text
consideration INR
= received VDA quantity × received VDA INR FMV/unit
```

Example:

```text
0.181818 ETH × ₹310,000/ETH
≈ ₹56,363.58 consideration
```

The code deliberately records the method used, the valuation components, and whether the value was actually determined from transaction economics.

### Consideration result

Each normalized row receives:

```js
row.consideration = {
  determined: true | false,
  inrValue,
  considerationType,
  method,
  source,
  currency,
  components,
}
```

The 194S engine then uses:

```text
consideration.inrValue
        ↓
1% TDS calculation
```

### Legacy input handling

Older CSVs may only contain:

```text
inr_value
```

Those rows remain backwards compatible, but they are explicitly marked:

```text
method = provided_inr_value_fallback
determined = false
```

This is important: the engine no longer hides the difference between a value it independently calculated and a value that was simply supplied by the source file.

For production use, exchange adapters should provide the underlying price/quantity or an auditable valuation source rather than relying on the fallback.

---

## 2. Section 194S rule engine

File:

```text
src/utils/tdsDiscrepancy.js
```

The deterministic engine calculates expected TDS for SELL transactions from the determined consideration:

```text
Expected TDS = 1% × consideration.inrValue
```

It compares this with:

1. an explicit `tds_amount`, when available; otherwise
2. `tds_status=DEDUCTED` as an assumption that the full expected amount was collected; otherwise
3. zero reported TDS.

The engine returns:

- consideration
- expected TDS
- reported TDS
- difference
- discrepancy flag
- risk tier
- reported source

AI does not recalculate these values.

### Important scope

The current prototype focuses its TDS discrepancy calculation on classified `SELL` VDA-transfer rows. The broader Section 194S treatment of who is responsible for deduction, thresholds, and special transaction circumstances is not represented as a complete legal-advice engine.

The Income Tax Department describes Section 194S as applying 1% TDS to consideration for transfer of a VDA, including specific treatment where consideration is wholly/partly in kind or is another VDA. citeturn0search0turn0search24

---

## 3. Reconciliation engine

File:

```text
src/utils/reconcile.js
```

The reconciliation layer handles:

- per-exchange / per-asset trade summaries
- total traded quantity
- INR consideration totals
- TDS deduction counts
- withdrawal/deposit matching
- cross-exchange transfer detection
- deterministic transfer confidence
- orphaned withdrawals
- unmatched deposits
- TDS-gap transfer warnings

Transfer matching uses asset, amount, and a five-day time window. Confidence is deterministic and is not generated by the AI.

---

## 4. Exchange/API adapters

The adapter registry is in:

```text
src/adapters/index.js
```

Current adapters:

```text
WazirX
CoinDCX
Binance
```

Each adapter normalizes its exchange-specific response into the common transaction structure.

The current adapters are deterministic mock API implementations for development/demo purposes. They are not live exchange integrations.

The mock data generator now exposes unit-price information so the consideration engine can calculate the INR value instead of simply trusting the generated total.

---

## 5. CSV format

The original minimal format is still accepted:

```text
date,type,asset,amount,inr_value,tds_status,ref_id
```

The preferred valuation-aware format is:

```text
date,type,asset,amount,price,quote_currency,fx_rate_inr,inr_value,tds_status,tds_amount,ref_id
```

For VDA → VDA transactions, add:

```text
received_asset
received_amount
received_asset_fmv_inr_per_unit
```

### Example VDA → INR

```text
date,type,asset,amount,price,quote_currency,fx_rate_inr,inr_value,tds_status,tds_amount,ref_id
2026-06-01,SELL,BTC,0.05,5600000,INR,1,280000,DEDUCTED,2800,TX1001
```

### Example VDA → foreign currency

```text
2026-06-27,SELL,BTC,0.01,64500,USDT,87,56115,UNKNOWN,,FX1001
```

### Example VDA → VDA

See:

```text
public/sample-vda-to-vda.csv
```

### Included sample datasets

- `public/sample-exchange-a.csv`
- `public/sample-exchange-b.csv`
- `public/sample-foreign-currency.csv`
- `public/sample-vda-to-vda.csv`

---

## 6. AI explainability

The architecture intentionally separates deterministic compliance from AI explanation:

```text
Rule engine → structured evidence → AI → human review
```

Relevant files:

```text
src/utils/tdsDiscrepancy.js
src/utils/evidenceBuilder.js
src/services/complianceAssistant.js
src/services/llmClient.js
src/utils/aiReport.js
```

AI can:

- explain discrepancies
- explain reconciliation findings
- summarize results
- provide investigation context

AI must not:

- calculate TDS independently
- determine transfer matches
- invent confidence scores
- override deterministic rule-engine values

The current narrative report is template-based; the explainability layer can use the configured LLM path.

---

## 7. Blockchain certification

The report certification flow is:

```text
Finalize report
      ↓
SHA-256
      ↓
MetaMask authorization
      ↓
Polygon Amoy
      ↓
QR code
      ↓
public verification route
      ↓
verify report hash
```

Contract:

```text
blockchain/contracts/ChainTDSRegistry.sol
```

The system can fall back to simulated anchoring when the blockchain is not configured.

Only the report fingerprint is intended to be certified on-chain; sensitive transaction details should remain off-chain.

---

## 8. Dashboards

The application contains role-oriented dashboard structures for:

- Taxpayer
- Auditor
- Regulator

The analytics direction includes:

- total transactions
- trading volume
- expected TDS
- deducted TDS
- TDS gap
- compliance coverage
- discrepancy count
- high-risk discrepancies
- exchange-level comparison
- discrepancy types
- risk distribution
- time trends
- transaction flow visualization

Discrepancy investigation surfaces the transaction, consideration, expected TDS, reported TDS, gap, source, and determination method.

---

## 9. Authentication / KYC / email

The current backend includes structures for:

- taxpayer/auditor/regulator roles
- login/session handling
- email verification / OTP flow
- KYC-related records
- PostgreSQL persistence

SMTP configuration is environment-based. Never commit SMTP passwords or other credentials.

---

## 10. Deployment plan

### Frontend

```text
Vercel
```

The Vite frontend is configured for Vercel.

### Backend

```text
Render
```

The Express backend is intended to run on Render for production-style deployment.

### Database

```text
Managed PostgreSQL
```

The production database must be reachable by the deployed backend.

### AI

The intended production direction is:

```text
Render backend → Ollama Cloud
```

Do not deploy a local Ollama server on Vercel.

### External mocked APIs

Beeceptor is currently **on hold** pending credits/access. Once available, it can provide deterministic CoinDCX/Binance/wallet mock endpoints without changing the core reconciliation/consideration/TDS layers.

---

## 11. Environment variables

Frontend `.env` contains public `VITE_*` configuration such as:

```text
VITE_API_BASE_URL
VITE_CONTRACT_ADDRESS
VITE_RPC_URL
VITE_CHAIN_ID_HEX
VITE_CHAIN_NAME
VITE_CURRENCY_SYMBOL
VITE_EXPLORER_URL
VITE_WALLET_RPC_URL
```

Never put these secrets in frontend variables:

```text
DATABASE_URL
JWT_SECRET
SMTP_PASS
BLOCKCHAIN PRIVATE KEY
```

Those belong server-side only.

---

## 12. Local development

```bash
npm install
npm run dev
```

Build check:

```bash
npm run build
```

Lint:

```bash
npm run lint
```

For the fastest demo, load the supplied exchange sample files and run reconciliation.

---

## 13. Blockchain local development

```bash
cd blockchain
npm install
npm run node
```

In another terminal:

```bash
cd blockchain
npm run deploy:local
```

For Polygon Amoy, configure the blockchain environment with an Amoy RPC URL and a dedicated test wallet, then run the Amoy deployment script.

Never commit a private key.

---

## 14. What is real vs mocked

| Component | Current status |
|---|---|
| CSV parsing | Real |
| Consideration engine | Real deterministic logic |
| VDA → INR valuation | Real from quantity × INR unit price when supplied |
| VDA → foreign currency valuation | Real deterministic conversion when price + FX are supplied |
| VDA → VDA valuation | Real deterministic FMV calculation when received VDA quantity + FMV are supplied |
| Legacy `inr_value` fallback | Supported and explicitly marked as fallback |
| Reconciliation | Real deterministic prototype logic |
| TDS discrepancy engine | Real deterministic prototype logic |
| AI explanation | Real orchestration; deterministic fallback available |
| AI narrative report | Template-based in current build |
| Exchange adapters | Mock API-shaped adapters |
| Beeceptor | On hold |
| Wallet API | Alchemy integration path + mock fallback |
| SHA-256 | Real |
| PDF export | Real |
| QR generation | Real |
| Solidity contract | Real contract code |
| Blockchain anchor | Simulated unless configured; real Polygon Amoy path available |
| PostgreSQL backend | Included; production DB must be configured |
| Vercel deployment | Configured |
| Render deployment | Target deployment architecture |
| Ollama Cloud | Target production AI deployment |
| Power BI analytics | Dashboard/analytics component direction; connect to production data for final live metrics |

---

## 15. Important prototype limitations

1. A legacy source containing only `inr_value` cannot be independently re-valued by the engine; it is explicitly marked as a fallback.
2. VDA → VDA consideration requires an INR FMV for the received VDA. The prototype accepts that valuation as an input; it does not yet provide a historical market-price oracle.
3. Foreign-currency consideration requires an FX rate. The prototype accepts an FX rate rather than fetching a historical FX feed.
4. Wallet transactions currently do not have a price oracle, so wallet transfer rows are not themselves treated as TDS-bearing sales.
5. Exchange-to-wallet-to-exchange identification cannot always be certain; the reconciliation layer therefore exposes confidence and manual-review paths.
6. Tax rules and thresholds can change; the production system should version its rule/valuation sources and maintain an auditable basis for every calculation.

---

## 16. Hackathon demo golden path

```text
CSV / mocked API data
        ↓
Normalize
        ↓
Reconcile exchanges + wallets
        ↓
Determine consideration
        ↓
Apply Section 194S rule
        ↓
Show TDS discrepancy
        ↓
Explain with AI
        ↓
Generate report
        ↓
SHA-256
        ↓
MetaMask
        ↓
Polygon Amoy
        ↓
QR verification
```

The strongest demo point is that the system can now show **why the TDS number exists**:

```text
transaction
   ↓
consideration determination
   ↓
INR consideration
   ↓
1% Section 194S rule
   ↓
expected TDS
   ↓
compare with reported TDS
```

That makes the deterministic rule path auditable instead of treating `inr_value` as an unexplained input.

## Transaction classification and VDA-transfer determination

The compliance pipeline now has a dedicated transaction-classification stage before consideration and 194S:

```text
CSV
 ↓
Normalize
 ↓
Transaction Classification
 ↓
VDA Transfer Determination
 ↓
Transfer Type
 ↓
Determine Consideration
 ↓
Determine INR Value
 ↓
194S applicability
 ↓
Expected TDS
 ↓
Actual TDS
 ↓
Expected vs Actual
 ↓
Discrepancy
 ↓
Explanation
```

### Classification behavior

- `BUY`, `SELL`, `SWAP`, `CONVERT`, `TRADE`, and `EXCHANGE` rows with a recognized or explicitly declared VDA are classified as VDA transfer events.
- `SELL` rows are classified into `VDA_TO_INR`, `VDA_TO_FOREIGN_CURRENCY`, or `VDA_TO_VDA` when the available consideration fields support that distinction.
- `DEPOSIT`, `WITHDRAWAL`, and `TRANSFER` rows are treated as VDA movements, not automatically as ownership transfers. They become confirmed VDA ownership transfers only when source/destination ownership is explicitly supplied and differs.
- A VDA movement without ownership evidence is marked `UNDETERMINED` rather than being guessed as taxable.
- `asset_type=VDA` or `received_asset_type=VDA` can be used when an asset is not in the built-in prototype asset registry.

The classifier is deterministic and does not calculate TDS. The 194S engine only calculates the current seller/exchange-side TDS rows after a row has been explicitly classified as a VDA transfer. This separation keeps classification, valuation, and tax calculation independently inspectable.

### New local test CSV

`public/sample-vda-transfer-classification.csv` contains:

1. Confirmed VDA → INR sale with TDS deducted.
2. Confirmed VDA → INR sale with missing TDS.
3. Own-wallet movement (`SELF → SELF`) that is **not** treated as a VDA ownership transfer.
4. VDA transfer to another owner (`SELF → OTHER`).
5. VDA movement with missing ownership evidence, classified as **UNDETERMINED**.
6. VDA → VDA exchange with received-asset FMV.

### Prototype boundary

This classifier determines transaction/ownership status from the fields present in the source data. It does not invent missing counterparties, wallet ownership, historical market prices, or exchange contractual TDS responsibilities. Such cases remain `UNDETERMINED` or require additional data. Section 194S has transaction-specific deduction responsibilities and thresholds, so the prototype's current deterministic TDS module should be treated as a compliance-analysis prototype rather than a complete tax filing engine.

## Local test steps for VDA-transfer classification

### 1. Install dependencies

From the project root:

```bash
npm install
```

### 2. Run the deterministic engine test

```bash
node scripts/test-classification.mjs
```

Expected result includes:

```text
VDA → INR: CONFIRMED | VDA_TO_INR | 100%
VDA → foreign currency: CONFIRMED | VDA_TO_FOREIGN_CURRENCY | 100%
VDA → VDA: CONFIRMED | VDA_TO_VDA | 100%
Own-wallet movement: NOT_TRANSFER | OWN_VDA_MOVEMENT | 100%
VDA transfer to another owner: CONFIRMED | VDA_OWNERSHIP_TRANSFER | 100%
Unknown wallet ownership: UNDETERMINED | VDA_MOVEMENT_OWNERSHIP_UNKNOWN | 0%

PASS: VDA classification, consideration, and TDS gating tests passed.
```

### 3. Start the frontend

```bash
npm run dev
```

Open the Vite URL shown in the terminal, normally `http://localhost:5173`.

### 4. Test through the UI

Upload:

```text
public/sample-vda-transfer-classification.csv
```

The expected behavior is:

| Row | Classification | 194S/TDS path |
|---|---|---|
| CLS1001 | Confirmed `VDA_TO_INR` | Included |
| CLS1002 | Confirmed `VDA_TO_INR` | Included and should show a TDS gap |
| CLS1003 | `OWN_VDA_MOVEMENT` | Not treated as a taxable transfer by the TDS engine |
| CLS1004 | `VDA_OWNERSHIP_TRANSFER` | Classified as a VDA ownership transfer; not a seller-side `SELL` row, so it is not included in the current TDS calculation |
| CLS1005 | `VDA_MOVEMENT_OWNERSHIP_UNKNOWN` | Not silently treated as taxable |
| CLS1006 | Confirmed `VDA_TO_VDA` | Included; consideration is based on received-VDA FMV |

For a discrepancy, click **Investigate**. The detail panel now exposes:

- VDA transfer status
- transfer type
- transfer confidence
- consideration method
- consideration source
- whether consideration was independently determined
- expected TDS
- reported TDS
- TDS gap

### 5. Test the full pipeline manually

Use this sequence while demonstrating:

```text
CSV
 ↓
Transaction Classification
 ↓
VDA Transfer Determination
 ↓
Transfer Type
 ↓
Determine Consideration
 ↓
INR Consideration
 ↓
194S seller-side TDS calculation
 ↓
Actual TDS
 ↓
Expected vs Actual
 ↓
Discrepancy
 ↓
AI Explanation
```

The AI is not used to decide whether a row is a VDA transfer or to calculate TDS. Those decisions come from the deterministic engine.

### 6. Build for production

```bash
npm run build
```

If `vite` is reported as missing, run `npm install` again in the project root and rerun the build. `node_modules` is intentionally excluded from the distributed ZIP.

## Backend-integrated compliance engine

The current build now routes normalized transaction rows through the authenticated backend endpoint `POST /api/compliance/analyze` before the frontend computes reconciliation/report UI state.

Backend sequence:

`Normalized CSV/API rows → VDA transfer classification → consideration determination → INR value → deterministic 194S/TDS gating → expected vs actual TDS → discrepancies`

The backend returns the classified/valued rows, TDS rows, discrepancies, and a summary. Ollama remains a separate explanation service at `POST /api/ai/ask`: it receives structured evidence/results and explains them; it does not calculate TDS or override the deterministic engine.

### Local full-stack run

1. Install frontend dependencies in the repository root: `npm install`
2. Install backend dependencies: `cd server && npm install`
3. Create `server/.env` from `server/.env.example` and configure `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`, and Ollama settings. For local development, `OLLAMA_BASE_URL=http://localhost:11434` and `OLLAMA_MODEL=llama3.2:3b` are supported.
4. Start Ollama and make sure the configured model is available (`ollama pull llama3.2:3b`).
5. Start the backend from `server`: `npm run dev`
6. In a second terminal, from the repository root, run `npm run dev`.
7. Log in through the UI, upload `public/sample-vda-transfer-classification.csv`, and verify the classification/TDS results.
8. To test the deterministic backend without the UI, use an authenticated request to `POST http://localhost:4000/api/compliance/analyze` with JSON `{ "rows": [...] }`.

If PostgreSQL/auth is not configured yet, run `node scripts/test-classification.mjs` to test the pure deterministic frontend engine without starting the full stack.
