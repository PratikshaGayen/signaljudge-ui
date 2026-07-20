import { useState } from "react";
import { useGenLayer } from "./hooks/useGenLayer";
import SubmitSignal from "./components/SubmitSignal";
import SignalFeed from "./components/SignalFeed";
import Leaderboard from "./components/Leaderboard";

const TABS = [
  { id: "submit", label: "Submit Signal" },
  { id: "feed", label: "Signal Feed" },
  { id: "leaderboard", label: "Leaderboard" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("submit");
  const { address, balance, readContract, writeContract, ensureFunded, refreshBalance, error } =
    useGenLayer();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/50">
        <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">SignalJudge</h1>
            <p className="text-xs text-slate-400">GenLayer Trading Signal Evaluator</p>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-slate-800 p-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "bg-emerald-600 text-white"
                    : "text-slate-400 hover:text-white hover:bg-slate-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {error && (
        <div className="mx-auto max-w-5xl px-4 pt-4">
          <div className="rounded-lg bg-red-900/30 border border-red-700 px-4 py-3 text-red-300 text-sm">
            {error}
          </div>
        </div>
      )}

      {!import.meta.env.VITE_CONTRACT_ADDRESS && (
        <div className="mx-auto max-w-5xl px-4 pt-4">
          <div className="rounded-lg bg-amber-900/30 border border-amber-700 px-4 py-3 text-amber-300 text-sm">
            <strong>Missing contract address.</strong> Set <code>VITE_CONTRACT_ADDRESS</code> in your <code>.env</code> file.
          </div>
        </div>
      )}

      <main className="pb-12">
        {activeTab === "submit" && (
          <SubmitSignal
            address={address}
            writeContract={writeContract}
            balance={balance}
            ensureFunded={ensureFunded}
            refreshBalance={refreshBalance}
          />
        )}
        {activeTab === "feed" && <SignalFeed readContract={readContract} writeContract={writeContract} />}
        {activeTab === "leaderboard" && <Leaderboard readContract={readContract} />}
      </main>
    </div>
  );
}
