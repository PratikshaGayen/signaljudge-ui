import { useState } from "react";

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

export default function SubmitSignal({ address, writeContract }) {
  const [asset, setAsset] = useState("BTC");
  const [direction, setDirection] = useState("ABOVE");
  const [targetPrice, setTargetPrice] = useState("");
  const [prediction, setPrediction] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [timeframe, setTimeframe] = useState("15min");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [formError, setFormError] = useState("");

  const validate = () => {
    if (!ASSETS.includes(asset)) {
      return "Asset must be selected from the dropdown.";
    }
    if (!DIRECTIONS.includes(direction)) {
      return "Direction must be ABOVE, BELOW, or AT.";
    }
    if (!targetPrice || !/^[0-9.]+$/.test(targetPrice)) {
      return "Target Price must be a valid numeric string.";
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
      const receipt = await writeContract("submit_signal", [
        asset.toUpperCase(),
        prediction.trim(),
        reasoning.trim(),
        targetPrice.trim(),
        direction,
        timeframe,
      ]);
      // Extract return value from receipt
      let ret = null;
      const leaderReceipt = receipt?.consensus_data?.leader_receipt?.[0];
      if (leaderReceipt?.result) {
        try {
          ret = JSON.parse(leaderReceipt.result);
        } catch {
          ret = { raw: leaderReceipt.result };
        }
      }
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
        <p className="text-sm text-slate-400">Connected Wallet</p>
        <p className="font-mono text-sm text-emerald-400 break-all">{address || "Loading..."}</p>
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
          <label className="block text-sm font-medium text-slate-300 mb-1">Direction</label>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Target Price</label>
          <input
            type="text"
            value={targetPrice}
            onChange={(e) => setTargetPrice(e.target.value)}
            placeholder="e.g. 100000"
            className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Prediction</label>
          <textarea
            value={prediction}
            onChange={(e) => setPrediction(e.target.value)}
            placeholder="e.g. BTC will hold above 100k"
            rows={3}
            className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
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
          {loading ? "Submitting..." : "Submit Signal"}
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
