> **Contract source:** [`contract/signal_judge.py`](contract/signal_judge.py) — the exact Intelligent Contract used by this project, included in this repo. (Also mirrored upstream in [genlayer-studio PR #1626](https://github.com/genlayerlabs/genlayer-studio/pull/1626), but this repo is the source of truth.)
>
> **Contract tests:** [`test/`](test/) — 14 `gltest` cases covering stake enforcement, input validation, reward-pool accounting, resolve guards, and views. See [`test/README.md`](test/README.md) to run them.
>
> **Deployed contract address:** `0x536E1afB326F44550D7A5Af5d420aE3dcBD7ce81` (GenLayer Studio testnet / studionet)
# SignalJudge UI

**Live demo:** https://predikt-fun.vercel.app/

A React + Vite + Tailwind CSS frontend for the **SignalJudge** GenLayer smart contract. Traders submit price predictions, an LLM judges them on-chain, and a leaderboard tracks win rates.

## Stack

- React 19 + Vite
- Tailwind CSS v4
- [genlayer-js](https://docs.genlayer.com/api-references/genlayer-js) SDK

## Prerequisites

- Node.js 18+
- A running GenLayer local node at `http://localhost:4000` (e.g. via [GenLayer Studio](https://github.com/yeagerai/genlayer-simulator))
- The SignalJudge contract deployed and its address known — the contract source lives in this repo at [`contract/signal_judge.py`](contract/signal_judge.py)

## Setup

1. **Clone / copy this project**

```bash
cd signaljudge-ui
```

2. **Install dependencies**

```bash
npm install
```

3. **Set the contract address**

Copy `.env.example` to `.env` and fill in your deployed contract address:

```bash
cp .env.example .env
```

Edit `.env`:

```env
VITE_CONTRACT_ADDRESS=0xYourContractAddressHere
```

4. **Start the dev server**

```bash
npm run dev
```

The app will be available at `http://localhost:5173` (or another port if 5173 is taken).

## Features

### Submit Signal
- Form to submit a trading signal (Asset, Timeframe, Direction, Target Price, Prediction, Reasoning)
- **Stakes 1 GEN per prediction.** `submit_signal` is a payable method that requires exactly `10^18` wei (1 GEN); the UI forwards that stake as the transaction value (see `writeContract(..., STAKE_WEI)` in `src/components/SubmitSignal.jsx`).
- **Funded account flow.** The auto-generated wallet starts empty on studionet, so before the first write the app tops it up from the studionet faucet RPC (`sim_fundAccount`) — the same call the ops scripts use. Funding is automatic on submit/resolve, and there is also a manual **Fund wallet** button. The connected-wallet panel shows the live GEN balance.
- Supports pure natural-language predictions: Direction and Target Price are **optional** — leave them blank and the LLM judges the plain-English claim on its own terms
- Validates that asset is alphanumeric and, if a direction is set, that it is exactly `ABOVE`, `BELOW`, or `AT`
- Shows the wallet address being used (auto-generated and persisted in `localStorage`)
- Displays a prominent loading state while the transaction is finalized (30–90 seconds)
- On submission, shows the assigned signal ID, timeframe, and resolution deadline

### Signal Feed
- Lists all signals from `get_all_signals()`
- Asset filter dropdown (All / BTC / ETH / SOL / BNB / XRP / DOGE / ADA / AVAX / DOT / MATIC)
- Each card shows asset, timeframe, prediction, direction, target/current prices, correctness badge, reasoning quality, the judge's one-sentence rationale (on resolved cards), and truncated submitter address
- Pending cards show a live countdown and a Resolve button once the deadline passes
- Auto-refreshes every 15 seconds

### Leaderboard
- Look up any wallet address with `get_score(address)`
- Shows wins, total signals, and win rate %
- Aggregates all unique submitters from the signal feed and loads their scores automatically

## Contract Interface

The UI expects these methods on the deployed contract:

**Write**
- `submit_signal(asset, prediction, reasoning, target_price, direction, timeframe)` → **payable, escrows exactly 1 GEN** — stores a PENDING signal. `target_price` and `direction` are **optional** — leave them blank for a purely natural-language prediction the LLM judges on its own terms.
- `resolve_signal(signal_id)` → after the deadline, fetches recent OHLC candles over the timeframe, has validator LLMs judge the prediction against the real price action, and returns `{ correct, current_price, reasoning_quality, rationale }`.

**Read**
- `get_signal_count()` → number
- `get_all_signals()` → JSON string (array)
- `get_signals_by_asset(asset)` → JSON string (filtered array)
- `get_score(address)` → `{ wins, total, win_rate_pct }`

## Notes

- The GenLayer local node runs at `http://localhost:4000`. This is **not** a standard EVM RPC.
- `get_all_signals()` returns a JSON string — the UI parses it with `JSON.parse()`.
- All prices are handled as strings (not floats) as required by the contract.
- The app auto-generates a local wallet on first load and persists the private key in `localStorage` so the same address is reused across sessions.
