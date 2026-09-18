# ChainTDS — Prototype

Cross-platform crypto TDS reconciliation, prototype build.

## What this does
- Name and upload as many exchanges as you need (2 minimum, add more freely)
- Parses and normalizes transactions from all of them
- Optional wallet address field — only needed when a transfer went *through*
  a personal wallet as a stopover between two exchanges, since that's the one
  hop exchange statements alone can't see. Direct exchange-to-exchange
  transfers don't need it.
- Reconciles: per-asset trade summary, cross-platform transfer matching, and
  TDS-gap detection (the core differentiator — catching TDS status when an
  asset moves between platforms, which no single exchange can see on its own)
- Generates a plain-language AI summary (template-based placeholder for now —
  swap `src/utils/aiReport.js` for a real local Ollama call later; the input/
  output shape won't need to change)
- Hashes the report (SHA-256, real, via Web Crypto)
- "Anchors" the hash on-chain. **Real contract included, but not deployed for
  you** — see "Trying it on a real chain" below. Until you deploy it, this
  falls back automatically to a simulated anchor (fake tx hash, stored in
  localStorage) so the flow stays demoable.
- Displays a QR code pointing at an in-app verification route
  (`#/verify/<hash>`) that checks the real contract once deployed, or falls
  back to the local record otherwise
- Exports everything as a PDF report

## Running it
```bash
npm install
npm run dev
```
Then open the printed local URL. Click "Use sample data" on both upload boxes
for the fastest demo path — the sample CSVs are crafted so BTC and ETH show
up as flagged cross-platform TDS gaps, and a USDT withdrawal shows up as an
orphaned transfer with no matching deposit.

## Trying it on a real chain

The `/blockchain` folder is a real Hardhat project with the actual Solidity
contract (`ChainTDSRegistry.sol`) — compiled and verified to work. You can
deploy it two ways:

### Option A — Local Hardhat network (no faucet, no real funds, instant)

Best for testing and development, since it needs no testnet tokens at all.

**1. Start a local blockchain:**
```bash
cd blockchain
npm install
npm run node
```
Leave this running — it's a local Ethereum node with 20 pre-funded test
accounts (10,000 fake ETH each), printed in the terminal along with their
private keys.

**2. In a second terminal, deploy to it:**
```bash
cd blockchain
npm run deploy:local
```
This prints your contract address and the env lines to copy.

**3. Wire the frontend:**
```bash
cp .env.example .env
# paste in the lines the deploy script printed
npm install
npm run dev
```

**4. Import a local test account into MetaMask** so you can sign the anchor
transaction: MetaMask → Add account → Import account → paste in one of the
private keys the `npm run node` terminal printed (Account #0's, for
example). These keys are public and well-known — safe to use locally,
**never use them for anything real**.

Now clicking "Generate report + hash" in the app will prompt MetaMask to
add/switch to this local network and anchor for real — against your own
local blockchain, with zero real money or faucets involved.

### Option B — Real Polygon Amoy testnet

Same contract, same code, but talking to the actual public testnet — useful
once you want a demo that anyone else can also verify from their own device.

**1. Get set up**
- Install [MetaMask](https://metamask.io), add a wallet dedicated to this
  project (don't reuse one with real funds)
- Get free test POL from a Polygon Amoy faucet — availability varies, try a
  few (Polygon's own faucet, Chainlink Faucets, thirdweb, QuickNode). You
  only need a small amount — a single typical drip covers deploying plus
  several anchor transactions.
- Create a free [Alchemy](https://alchemy.com) account, make an app on the
  Polygon Amoy network, copy its HTTPS RPC URL

**2. Deploy the contract**
```bash
cd blockchain
cp .env.example .env
# fill in AMOY_RPC_URL and PRIVATE_KEY in .env — never commit this file
npm run deploy:amoy
```

**3. Wire the frontend** — same as Option A step 3, using the Amoy values
this deploy prints instead.

Either way, `src/utils/blockchain.js` reads whichever network you configured
from `.env` and works identically — anchoring (needs MetaMask + gas) and
verification (free, read-only).

## What's real vs. mocked
| Piece | Status |
|---|---|
| CSV parsing | Real, any number of named exchanges |
| Reconciliation logic (trade summary, transfer matching, TDS gap detection) | Real |
| SHA-256 hashing | Real |
| PDF export | Real |
| QR code generation | Real, links to a working in-app verification page |
| AI narrative report | Template placeholder (swap in Ollama call) |
| Wallet data | Simulated (address field triggers mock on-chain rows; swap in Alchemy) |
| Solidity contract | Real, compiled, ready to deploy locally or to Amoy |
| On-chain anchoring + verification | Auto-switches from simulated to real once you deploy and set `.env` |

## Sample data
`public/sample-exchange-a.csv` and `public/sample-exchange-b.csv` — edit these
or upload your own real exchange exports in the same column format:
`date,type,asset,amount,inr_value,tds_status,ref_id`
