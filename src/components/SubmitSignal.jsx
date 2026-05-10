import { useState } from "react";

const DIRECTIONS = ["ABOVE", "BELOW", "AT"];

export default function SubmitSignal({ address, writeContract }) {
  const [asset, setAsset] = useState("");
  const [direction, setDirection] = useState("ABOVE");
  const [targetPrice, setTargetPrice] = useState("");
  const [prediction, setPrediction] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [formError, setFormError] = useState("");

  const validate = () => {
    if (!asset || !/^[a-zA-Z0-9]+$/.test(asset)) {
      return "Asset must be alphanumeric (e.g. BTC, ETH, SOL).";
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
      ]);
      // Try to extract return value from receipt leader receipt
      let judgment = null;
      const leaderReceipt = receipt?.consensus_data?.leader_receipt?.[0];
      if (leaderReceipt?.result) {
        try {
          judgment = JSON.parse(leaderReceipt.result);
        } catch {
          judgment = { raw: leaderReceipt.result };
        }
      }
      setResult({
        success: true,
        judgment,
        txHash: receipt?.hash || receipt?.txId,
      });
    } catch (err) {
      setResult({ success: false, error: err.message || "Transaction failed" });
    } finally {
      setLoading(false);
    }
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
          <input
            type="text"
            value={asset}
            onChange={(e) => setAsset(e.target.value)}
            placeholder="e.g. BTC"
            className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
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
              <span className="text-emerald-300">Signal Judged</span>
            ) : (
              <span className="text-red-300">Submission Failed</span>
            )}
          </p>
          {result.success && result.judgment && (
            <div className="mt-3 space-y-2 text-sm text-slate-300">
              {typeof result.judgment.correct === "boolean" && (
                <p>
                  Correct:{" "}
                  <span className={result.judgment.correct ? "text-emerald-400" : "text-red-400"}>
                    {result.judgment.correct ? "Yes" : "No"}
                  </span>
                </p>
              )}
              {result.judgment.current_price && (
                <p>Current Price: <span className="font-mono text-white">{result.judgment.current_price}</span></p>
              )}
              {typeof result.judgment.reasoning_quality === "number" && (
                <p>Reasoning Quality: <span className="font-mono text-white">{result.judgment.reasoning_quality}/10</span></p>
              )}
              {result.txHash && (
                <p className="text-xs text-slate-500 break-all">Tx: {result.txHash}</p>
              )}
            </div>
          )}
          {result.success && !result.judgment && (
            <p className="mt-2 text-sm text-slate-300">Transaction finalized. Check the Signal Feed for results.</p>
          )}
          {!result.success && (
            <p className="mt-2 text-sm text-red-300">{result.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
