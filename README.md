> **Contract source:** [signal_judge.py](https://github.com/genlayerlabs/genlayer-studio/pull/1626) — part of the genlayer-studio examples.
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
- The SignalJudge contract deployed and its address known — see [genlayer-studio PR #1626](https://github.com/genlayerlabs/genlayer-studio/pull/1626) for the contract source

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
- Form to submit a trading signal (Asset, Direction, Target Price, Prediction, Reasoning)
- Validates that asset is alphanumeric and direction is exactly `ABOVE`, `BELOW`, or `AT`
- Shows the wallet address being used (auto-generated and persisted in `localStorage`)
- Displays a prominent loading state while the transaction is finalized (30–90 seconds)
- Shows the judgment result (correct/incorrect, current price, reasoning quality)

### Signal Feed
- Lists all signals from `get_all_signals()`
- Asset filter dropdown (All / BTC / ETH / SOL)
- Each card shows asset, prediction, direction, target/current prices, correctness badge, reasoning quality, and truncated submitter address
- Auto-refreshes every 30 seconds

### Leaderboard
- Look up any wallet address with `get_score(address)`
- Shows wins, total signals, and win rate %
- Aggregates all unique submitters from the signal feed and loads their scores automatically

## Contract Interface

The UI expects these methods on the deployed contract:

**Write**
- `submit_signal(asset, prediction, reasoning, target_price, direction)` → returns judgment JSON

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
