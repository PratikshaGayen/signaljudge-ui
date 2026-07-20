import { useState } from "react";
import { abi } from "genlayer-js";
import { STAKE_WEI } from "../hooks/useGenLayer";

// Format a wei amount (bigint) as a short GEN string for display.
function fmtGen(wei) {
  if (wei == null) return "—";
  const GEN = 10n ** 18n;
  const whole = wei / GEN;
  const frac = (wei % GEN).toString().padStart(18, "0").slice(0, 4);
  return `${whole}.${frac}`;
}

// The localnet receipt encodes a contract's return value as calldata, not JSON.
// After simplifyTransactionReceipt the SDK hands it back as
//   { raw, status: "return", payload: { raw: number[], readable } }
// (and occasionally as a bare base64 string whose first byte is the status
// code, 0 = return). Decode the calldata bytes into a plain JS object.
function normalizeCalldata(value) {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Map) {
    const obj = {};
    for (const [k, v] of value) obj[k] = normalizeCalldata(v);
    return obj;
  }
  if (Array.isArray(value)) return value.map(normalizeCalldata);
  return value;
}

function decodeReturnValue(receipt) {
  const result = receipt?.consensus_data?.leader_receipt?.[0]?.result;
  if (!result) return null;
  try {
    let bytes;
    if (typeof result === "string") {
      const raw = Uint8Array.from(atob(result), (c) => c.charCodeAt(0));
      if (raw[0] !== 0) return null; // not a successful return
      bytes = raw.slice(1);
    } else if (result.payload?.raw) {
      bytes = Uint8Array.from(result.payload.raw);
    } else {
      return null;
    }
    // calldata.decode yields a Map with BigInt integers — normalize both.
    return normalizeCalldata(abi.calldata.decode(bytes));
  } catch {
    return null;
  }
}

const ASSETS = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", "DOT", "MATIC"];
const DIRECTIONS = ["ABOVE", "BELOW", "AT"];
const TIMEFRAMES = [
  { value: "5min", label: "5 Minutes" },
  { value: "15min", label: "15 Minutes" },
  { value: "30min", label: "30 Minutes" },
  { value: "1h", label: "1 Hour" },
  { value: "4h", label: "4 Hours" },
  { value: "1d", label: "1 Day" },
];

export default function SubmitSignal({ address, writeContract, balance, ensureFunded, refreshBalance }) {
  const [asset, setAsset] = useState("BTC");
  const [direction, setDirection] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [prediction, setPrediction] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [timeframe, setTimeframe] = useState("15min");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [formError, setFormError] = useState("");
  const [funding, setFunding] = useState(false);

  const handleFund = async () => {
    setFormError("");
    setFunding(true);
    try {
      // Top the wallet up so it can cover the 1 GEN stake plus gas.
      await ensureFunded(STAKE_WEI * 2n);
      await refreshBalance();
    } catch (err) {
      setFormError(err.message || "Funding failed");
    } finally {
      setFunding(false);
    }
  };

  const validate = () => {
    if (!ASSETS.includes(asset)) {
      return "Asset must be selected from the dropdown.";
    }
    // Direction and target price are optional — leave them blank for a purely
    // natural-language prediction that the LLM judges on its own terms.
    if (direction && !DIRECTIONS.includes(direction)) {
      return "Direction, if set, must be ABOVE, BELOW, or AT.";
    }
    if (targetPrice && !/^[0-9.]+$/.test(targetPrice)) {
      return "Target Price, if set, must be a valid numeric string.";
    }
    if (!prediction.trim()) {
      return "Prediction is required.";
    }
    if (!reasoning.trim()) {
      return "Reasoning is required.";
    }
    if (!TIMEFRAMES.some((t) => t.value === timeframe)) {
      return "Timeframe must be selected from the dropdown.";
    }
    return "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    setResult(null);
    const err = validate();
    if (err) {
      setFormError(err);
      return;
    }
    setLoading(true);
    try {
      // submit_signal is payable and requires exactly STAKE_WEI (1 GEN). Forward
      // the stake as the transaction value — writeContract funds the wallet first
      // if it can't cover the stake plus gas.
      const receipt = await writeContract(
        "submit_signal",
        [
          asset.toUpperCase(),
          prediction.trim(),
          reasoning.trim(),
          targetPrice.trim(),
          direction,
          timeframe,
        ],
        STAKE_WEI
      );
      // Decode the calldata-encoded return value { signal_id, timeframe, deadline_ts }.
      const ret = decodeReturnValue(receipt);
      setResult({
        success: true,
        ret,
        txHash: receipt?.hash || receipt?.txId,
      });
    } catch (err) {
      setResult({ success: false, error: err.message || "Transaction failed" });
    } finally {
      setLoading(false);
    }
  };

  const formatDeadline = (ts) => {
    if (!ts) return "—";
    const d = new Date(ts * 1000);
    return d.toLocaleString();
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      <div className="mb-6 rounded-lg bg-slate-800 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-slate-400">Connected Wallet</p>
            <p className="font-mono text-sm text-emerald-400 break-all">{address || "Loading..."}</p>
            <p className="mt-1 text-xs text-slate-400">
              Balance:{" "}
              <span className="font-mono text-slate-200">{fmtGen(balance)} GEN</span>
            </p>
          </div>
          <button
            type="button"
            onClick={handleFund}
            disabled={funding}
            className="shrink-0 rounded-lg border border-slate-600 bg-slate-700 hover:bg-slate-600 disabled:opacity-60 disabled:cursor-not-allowed px-3 py-1.5 text-xs font-medium text-slate-100 transition-colors"
          >
            {funding ? "Funding..." : "Fund wallet"}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Each prediction escrows a <span className="text-slate-300">1 GEN</span> stake. New
          wallets are auto-funded from the studionet faucet on your first submission.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Asset</label>
          <select
            value={asset}
            onChange={(e) => setAsset(e.target.value)}
            className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {ASSETS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Timeframe</label>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {TIMEFRAMES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Direction <span className="text-slate-500 font-normal">(optional)</span>
          </label>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">None — natural-language prediction</option>
            {DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Target Price <span className="text-slate-500 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={targetPrice}
            onChange={(e) => setTargetPrice(e.target.value)}
            placeholder="e.g. 100000 — leave blank for a natural-language call"
            className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Prediction</label>
          <textarea
            value={prediction}
            onChange={(e) => setPrediction(e.target.value)}
            placeholder="e.g. BTC breaks its prior resistance and holds above it into the close"
            rows={3}
            className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <p className="mt-1 text-xs text-slate-500">
            Write a plain-English call — the LLM judges the claim and your reasoning, not just price vs. target.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Reasoning</label>
          <textarea
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
            placeholder="Explain your reasoning..."
            rows={4}
            className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {formError && (
          <div className="rounded-lg bg-red-900/30 border border-red-700 px-4 py-3 text-red-300 text-sm">
            {formError}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed px-4 py-3 font-semibold text-white transition-colors"
        >
          {loading ? "Submitting..." : "Submit Signal (stake 1 GEN)"}
        </button>
      </form>

      {loading && (
        <div className="mt-6 rounded-lg bg-amber-900/30 border border-amber-700 px-4 py-6 text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-amber-500 border-t-transparent" />
          <p className="font-semibold text-amber-300">Transaction in progress</p>
          <p className="text-sm text-amber-200 mt-1">
            GenLayer consensus can take 30–90 seconds. Please wait...
          </p>
        </div>
      )}

      {result && !loading && (
        <div
          className={`mt-6 rounded-lg border px-4 py-4 ${
            result.success
              ? "bg-emerald-900/30 border-emerald-700"
              : "bg-red-900/30 border-red-700"
          }`}
        >
          <p className="font-semibold text-sm">
            {result.success ? (
              <span className="text-emerald-300">Signal Submitted</span>
            ) : (
              <span className="text-red-300">Submission Failed</span>
            )}
          </p>
          {result.success && result.ret && (
            <div className="mt-3 space-y-2 text-sm text-slate-300">
              <p>
                Signal ID:{" "}
                <span className="font-mono text-white">{result.ret.signal_id ?? "—"}</span>
              </p>
              <p>
                Timeframe:{" "}
                <span className="font-mono text-white">{result.ret.timeframe ?? "—"}</span>
              </p>
              <p>
                Deadline:{" "}
                <span className="font-mono text-white">
                  {formatDeadline(result.ret.deadline_ts)}
                </span>
              </p>
              <p className="text-xs text-slate-400">
                Come back after {result.ret.timeframe ?? "the timeframe"} to resolve it.
              </p>
              {result.txHash && (
                <p className="text-xs text-slate-500 break-all">Tx: {result.txHash}</p>
              )}
            </div>
          )}
          {result.success && !result.ret && (
            <p className="mt-2 text-sm text-slate-300">
              Transaction finalized. Check the Signal Feed for details.
            </p>
          )}
          {!result.success && (
            <p className="mt-2 text-sm text-red-300">{result.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
