# SignalJudge UI — Project Overview

## 1. Project Identity

SignalJudge UI is a single-page React application that interacts with a GenLayer intelligent contract to evaluate crypto trading signals. Users submit price predictions, an on-chain LLM judges them, and the app displays results via a real-time signal feed and a win-rate leaderboard.

- **Repository root:** `signaljudge-ui/`
- **Primary framework:** React 19 + Vite
- **Styling:** Tailwind CSS v4
- **Blockchain SDK:** `genlayer-js`
- **Target network:** GenLayer local node (`http://localhost:4000`)

---

## 2. Directory Structure

```
signaljudge-ui/
├── public/                     # Static assets (if any)
├── src/
│   ├── components/             # Page-level view components
│   │   ├── SubmitSignal.jsx    # Signal submission form
│   │   ├── SignalFeed.jsx      # Signal list with filtering
│   │   └── Leaderboard.jsx     # Score lookup + aggregated leaderboard
│   ├── hooks/
│   │   └── useGenLayer.js      # GenLayer client initialization & contract helpers
│   ├── App.jsx                 # Root component: layout, navigation, global state
│   ├── main.jsx                # React DOM entry point
│   └── index.css               # Tailwind v4 import + base theme
├── index.html                  # HTML entry
├── vite.config.js              # Vite + Tailwind plugin config
├── package.json                # Dependencies & scripts
├── .env.example                # Required environment variables template
├── README.md                   # End-user setup instructions
└── PROJECT_OVERVIEW.md         # This file
```

---

## 3. Architecture & Data Flow

### 3.1 Client Initialization (`useGenLayer.js`)

```
┌─────────────────────────────────────────────┐
│  useGenLayer Hook                            │
│  • Creates genlayer-js client                │
│  • Connects to localnet @ localhost:4000     │
│  • Auto-generates wallet (persisted in LS)   │
│  • Exposes: readContract | writeContract     │
└─────────────────────────────────────────────┘
```

- **Wallet persistence:** On first load, a private key is generated via `generatePrivateKey()`, stored in `localStorage` under `sg_private_key`, and used to recreate the same account on subsequent visits.
- **Read calls:** Stateless contract reads (`get_all_signals`, `get_score`, etc.).
- **Write calls:** Transactions are submitted with `value: 0n`, then the hook blocks on `waitForTransactionReceipt({ status: FINALIZED })` with a 3-second polling interval.

### 3.2 View Components

| View | Contract Methods Used | State Strategy |
|------|----------------------|----------------|
| **SubmitSignal** | `writeContract("submit_signal", [...])` | Local form state + submission result |
| **SignalFeed** | `readContract("get_all_signals")` | `useState` + `useEffect` interval (30s) |
| **Leaderboard** | `readContract("get_all_signals")` → `readContract("get_score", [addr])` | `useState` + `useEffect` on mount |

### 3.3 Data Transformations

- **`get_all_signals()`** returns a JSON string → parsed via `JSON.parse()` into an array of signal objects.
- **`get_score(address)`** returns a Map-like or plain object → normalized to a plain JS object via `Object.fromEntries()` if needed.
- **Prices** are kept as strings throughout the UI (no float coercion).

---

## 4. Component Responsibilities

### `App.jsx`
- Tab navigation (Submit / Feed / Leaderboard)
- Mounts `useGenLayer` and passes `readContract` / `writeContract` down to views
- Displays missing-contract-address warning if `.env` is unset

### `SubmitSignal.jsx`
- Form validation:
  - Asset: `/^[a-zA-Z0-9]+$/`
  - Direction: strict whitelist `["ABOVE", "BELOW", "AT"]`
  - Target Price: `/^[0-9.]+$/`
- Loading UX: spinner + "30–90 seconds" banner during consensus
- Result parsing: extracts leader receipt result and attempts `JSON.parse` for judgment details

### `SignalFeed.jsx`
- Parses signal array and renders card grid
- Asset filter dropdown: `All | BTC | ETH | SOL`
- Auto-refresh timer: `setInterval(fetchSignals, 30000)`
- Address truncation helper: `0x1234...5678`

### `Leaderboard.jsx`
- **Manual lookup:** input any address → `get_score`
- **Auto-aggregation:** derives unique submitters from `get_all_signals`, then fans out `get_score` calls for each
- Score normalization handles both Map and POJO return types from the SDK

---

## 5. Environment & Configuration

| Variable | Source | Purpose |
|----------|--------|---------|
| `VITE_CONTRACT_ADDRESS` | `.env` | Deployed SignalJudge contract address |
| `localStorage.sg_private_key` | Runtime | Persisted local wallet private key |

No backend, API keys, or additional env vars are required.

---

## 6. Key Design Decisions

1. **No external wallet (MetaMask)** — The app targets a local GenLayer node where users may not have a browser wallet configured. A local account is generated automatically.
2. **No state management library** — `useState` + prop drilling is sufficient for three simple views with no shared mutable state.
3. **String-only prices** — The contract accepts and returns prices as strings. The UI respects this to avoid floating-point drift.
4. **Polling over WebSockets** — GenLayer local node behavior is best served by explicit polling intervals; no event subscription is implemented.
5. **Tailwind v4 via Vite plugin** — Uses `@tailwindcss/vite` instead of a PostCSS config file, aligning with Tailwind's latest recommended setup.

---

## 7. Known Constraints & Gotchas

- Transactions take **30–90 seconds** to finalize. The UI must keep the user informed; never fire-and-forget.
- `get_all_signals()` returns a **JSON string**, not a native array. Always `JSON.parse()`.
- `writeContract` requires an explicit `value: 0n` even for non-payable calls.
- The `genlayer-js` SDK is **ESM-only**; Vite handles this natively.
- If the local node is not running, all reads/writes will throw connection errors surfaced in the UI error banner.
