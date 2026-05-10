import { useEffect, useState, useCallback } from "react";

function truncateAddr(addr) {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function Leaderboard({ readContract }) {
  const [addressInput, setAddressInput] = useState("");
  const [manualScore, setManualScore] = useState(null);
  const [manualLoading, setManualLoading] = useState(false);
  const [signals, setSignals] = useState([]);
  const [scores, setScores] = useState({});
  const [loadingScores, setLoadingScores] = useState(false);
  const [error, setError] = useState("");

  const fetchAllSignals = useCallback(async () => {
    try {
      const raw = await readContract("get_all_signals");
      const parsed = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(String(raw));
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      setError(err.message || "Failed to load signals");
      return [];
    }
  }, [readContract]);

  const lookupScore = useCallback(
    async (addr) => {
      try {
        const result = await readContract("get_score", [addr]);
        // Result may be a Map-like object or plain object depending on SDK
        const normalized =
          result instanceof Map
            ? Object.fromEntries(result)
            : result;
        return normalized;
      } catch {
        return null;
      }
    },
    [readContract]
  );

  const handleManualLookup = async (e) => {
    e.preventDefault();
    if (!addressInput.trim()) return;
    setManualLoading(true);
    setManualScore(null);
    const score = await lookupScore(addressInput.trim());
    setManualScore(score);
    setManualLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingScores(true);
      const all = await fetchAllSignals();
      if (cancelled) return;
      setSignals(all);
      const unique = [...new Set(all.map((s) => s.submitter).filter(Boolean))];
      const map = {};
      for (const addr of unique) {
        const score = await lookupScore(addr);
        if (cancelled) return;
        if (score) map[addr] = score;
      }
      if (!cancelled) {
        setScores(map);
        setLoadingScores(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [fetchAllSignals, lookupScore]);

  const uniqueAddresses = [...new Set(signals.map((s) => s.submitter).filter(Boolean))];

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <div className="rounded-lg bg-slate-800 border border-slate-700 p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Look up Score by Address</h3>
        <form onSubmit={handleManualLookup} className="flex gap-2">
          <input
            type="text"
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            placeholder="0x..."
            className="flex-1 rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            type="submit"
            disabled={manualLoading}
            className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 px-4 py-2 text-sm font-semibold text-white transition-colors"
          >
            {manualLoading ? "..." : "Get Score"}
          </button>
        </form>
        {manualScore && (
          <div className="mt-4 grid grid-cols-3 gap-4 text-center">
            <div className="rounded bg-slate-900 p-3">
              <p className="text-xs text-slate-400">Wins</p>
              <p className="text-lg font-mono text-emerald-400">{String(manualScore.wins ?? "—")}</p>
            </div>
            <div className="rounded bg-slate-900 p-3">
              <p className="text-xs text-slate-400">Total</p>
              <p className="text-lg font-mono text-white">{String(manualScore.total ?? "—")}</p>
            </div>
            <div className="rounded bg-slate-900 p-3">
              <p className="text-xs text-slate-400">Win Rate</p>
              <p className="text-lg font-mono text-amber-400">{manualScore.win_rate_pct ?? "—"}%</p>
            </div>
          </div>
        )}
        {manualScore === null && !manualLoading && addressInput && (
          <p className="mt-3 text-sm text-slate-500">No score data found for this address.</p>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-white mb-3">Leaderboard</h3>
        {error && (
          <div className="rounded-lg bg-red-900/30 border border-red-700 px-4 py-3 text-red-300 text-sm mb-4">
            {error}
          </div>
        )}
        {loadingScores && uniqueAddresses.length === 0 && (
          <div className="text-center py-8 text-slate-400">
            <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
            Loading scores...
          </div>
        )}
        <div className="space-y-2">
          {uniqueAddresses.map((addr) => {
            const score = scores[addr];
            return (
              <div
                key={addr}
                className="flex items-center justify-between rounded-lg bg-slate-800 border border-slate-700 px-4 py-3"
              >
                <div className="text-sm font-mono text-slate-300">{truncateAddr(addr)}</div>
                <div className="flex items-center gap-4 text-sm">
                  {score ? (
                    <>
                      <span className="text-slate-400">
                        Wins: <span className="text-emerald-400 font-mono">{String(score.wins ?? 0)}</span>
                      </span>
                      <span className="text-slate-400">
                        Total: <span className="text-white font-mono">{String(score.total ?? 0)}</span>
                      </span>
                      <span className="text-slate-400">
                        Rate: <span className="text-amber-400 font-mono">{score.win_rate_pct ?? "—"}%</span>
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-slate-500">Loading score...</span>
                  )}
                </div>
              </div>
            );
          })}
          {uniqueAddresses.length === 0 && !loadingScores && (
            <p className="text-center text-slate-500 py-8">No signals yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
