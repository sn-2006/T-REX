# T-REX — Person 2: Decentralized Wallet Integration

This module extends the existing T-REX compliance pipeline with live, observable on-chain wallet data.

## What it does

```text
Public Ethereum wallet
        |
        v
Alchemy Transfers API
        |
        v
Incoming / outgoing transfers
        |
        v
Observable one-hop fund-flow graph
        |
        +--------------------+
        |                    |
        v                    v
Address Label API       Risk Score API
        |                    |
        +---------+----------+
                  v
         Normalized T-REX rows
                  |
                  v
       Existing compliance engine
```

### Data responsibilities

- **Alchemy:** blockchain transfer data (external ETH, internal ETH, ERC-20 transfers).
- **MetaSleuth:** address labels/entities/name tags and risk score/risk indicators.
- **T-REX:** normalization, classification, consideration/TDS logic, reconciliation, reporting and anchoring.

The implementation deliberately keeps Alchemy and MetaSleuth credentials on the backend.

## Setup

1. Create an Ethereum Mainnet Alchemy app and copy its API key.
2. Obtain the separate MetaSleuth Address Label API key and Risk Score API key from the API settings page.
3. Copy `server/.env.example` to `server/.env`.
4. Set:

```env
ALCHEMY_ETH_API_KEY=your_alchemy_key
METASLEUTH_ADDRESS_LABEL_API_KEY=your_address_label_key
METASLEUTH_RISK_SCORE_API_KEY=your_risk_score_key
WALLET_MAX_PAGES=20
WALLET_MAX_COUNTERPARTIES=8
```

5. Start the backend on port 4000.
6. Start the Vite frontend.
7. Sign in, enter a public Ethereum address, and click **Analyze on-chain**.

## What the UI shows

- Ethereum wallet address
- Number of observed transfers
- Counterparties
- Observable one-hop paths
- Direction (IN/OUT)
- Asset and amount
- MetaSleuth entity/name tag when available
- MetaSleuth risk score when available
- `UNKNOWN` when an address cannot be enriched

## Important scope statement

The result is **observable on-chain provenance**, not guaranteed real-world identity or the ultimate source of funds. A path such as:

```text
Wallet A -> Wallet B -> Exchange C
```

is evidence of observable on-chain movement. It does not by itself prove who controls Wallet B or why a transfer occurred.

The current prototype uses a bounded one-hop graph around the supplied wallet. It intentionally avoids recursively crawling an unbounded transaction graph.

## Integration point

The backend returns `normalizedRows` in the same transaction shape consumed by the existing compliance analysis endpoint. Therefore the decentralized module does not duplicate the existing TDS/reconciliation logic.
