"use client";

import React, { useState } from "react";
import { Sliders, PlusCircle, ShieldCheck, AlertCircle, ArrowRight } from "lucide-react";
import { useTreasury } from "../../context/TreasuryContext";
import { useWallet } from "../../context/WalletContext";

export default function PoliciesPage() {
  const { policies, createPolicy } = useTreasury();
  const { activeWallet } = useWallet();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [policyType, setPolicyType] = useState<
    "PerTransactionLimit" | "RollingSpendingLimit" | "DestinationAllowlist" | "ApprovalEscalation"
  >("PerTransactionLimit");

  const handleCreatePolicy = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !description) return;

    createPolicy({
      title,
      description,
      type: policyType,
    });

    setIsModalOpen(false);
    setTitle("");
    setDescription("");
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Programmable Spending Policies</h1>
          <p className="text-sm text-slate-400">
            Rules evaluated on-chain by the Policy Engine before any asset leaves the vault
          </p>
        </div>

        {activeWallet.roles.includes("Admin") && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-xs font-semibold text-white shadow-md shadow-emerald-500/10 transition"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Create Policy</span>
          </button>
        )}
      </div>

      {/* Policy Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {policies.map((p) => (
          <div
            key={p.id}
            className="rounded-xl bg-vault-900 border border-vault-800 p-5 space-y-3 hover:border-vault-700 transition"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <h3 className="font-bold text-sm text-white">{p.title}</h3>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {p.type}
              </span>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">{p.description}</p>

            <div className="p-3 rounded-lg bg-vault-950 border border-vault-800 text-xs space-y-1.5 font-mono">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                On-Chain Policy Configuration
              </div>
              {p.type === "PerTransactionLimit" && (
                <div className="text-slate-300 text-[11px] space-y-0.5">
                  <p>&bull; Max Native SOL: <span className="text-white font-bold">{p.details?.maxSol ?? 200} SOL</span></p>
                  <p>&bull; Max SPL USDC: <span className="text-white font-bold">${(p.details?.maxUsdc ?? 50000).toLocaleString()}</span></p>
                </div>
              )}
              {p.type === "RollingSpendingLimit" && (
                <div className="text-slate-300 text-[11px] space-y-0.5">
                  <p>&bull; Window Duration: <span className="text-white font-bold">{p.details?.windowHours ?? 24} Hours</span></p>
                  <p>&bull; 24h Ceiling: <span className="text-white font-bold">{p.details?.maxWindowSol ?? 500} SOL</span></p>
                  <p>&bull; Current Window Spent: <span className="text-emerald-400 font-bold">{p.details?.currentSpentSol ?? 0} SOL</span></p>
                </div>
              )}
              {p.type === "DestinationAllowlist" && (
                <div className="text-slate-300 text-[11px] space-y-0.5">
                  <p>&bull; Strict Allowlist: <span className="text-emerald-400 font-bold">Enabled</span></p>
                  <p>&bull; Approved Destinations: <span className="text-white font-bold">{p.details?.allowedCount ?? 4} Wallets</span></p>
                </div>
              )}
              {p.type === "ApprovalEscalation" && (
                <div className="text-slate-300 text-[11px] space-y-0.5">
                  <p>&bull; Trigger Tier: <span className="text-white font-bold">&ge; {p.details?.tierThresholdSol ?? 300} SOL</span></p>
                  <p>&bull; Escalated Threshold: <span className="text-amber-400 font-bold">{p.details?.requiredApprovals ?? 3} Approvals</span></p>
                  <p>&bull; Mandatory Timelock: <span className="text-amber-400 font-bold">+{p.details?.timelockHours ?? 48}h</span></p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Create Policy Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-vault-900 border border-vault-800 shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95">
            <h3 className="font-bold text-sm text-white">Create Spending Policy</h3>

            <form onSubmit={handleCreatePolicy} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Policy Type</label>
                <select
                  value={policyType}
                  onChange={(e) => setPolicyType(e.target.value as any)}
                  className="w-full bg-vault-950 border border-vault-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="PerTransactionLimit">Per-Transaction Spending Cap</option>
                  <option value="RollingSpendingLimit">24-Hour Rolling Budget Window</option>
                  <option value="DestinationAllowlist">Destination Wallet Allowlist</option>
                  <option value="ApprovalEscalation">Approval Escalation Tier</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Policy Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Marketing Outflow Cap"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-vault-950 border border-vault-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Description &amp; Constraint</label>
                <textarea
                  required
                  rows={2}
                  placeholder="Explain rule and parameters enforced by this policy"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-vault-950 border border-vault-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-vault-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 font-semibold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg shadow-sm"
                >
                  Enforce Policy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
