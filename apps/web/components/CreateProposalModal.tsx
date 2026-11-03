"use client";

import React, { useState } from "react";
import { X, Send, AlertTriangle, ShieldCheck, ArrowRight } from "lucide-react";
import { useTreasury } from "../context/TreasuryContext";
import { useWallet } from "../context/WalletContext";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateProposalModal({ isOpen, onClose }: Props) {
  const { vault, createProposal, policies } = useTreasury();
  const { activeWallet } = useWallet();

  const [title, setTitle] = useState("");
  const [opType, setOpType] = useState<"SolTransfer" | "TokenTransfer">("SolTransfer");
  const [symbol, setSymbol] = useState("SOL");
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");

  if (!isOpen) return null;

  const numAmount = parseFloat(amount) || 0;

  // Real-time policy checking
  const perTxPolicy = policies.find((p) => p.type === "PerTransactionLimit");
  const rollingPolicy = policies.find((p) => p.type === "RollingSpendingLimit");

  const exceedsPerTx =
    symbol === "SOL"
      ? numAmount > (perTxPolicy?.details.maxSol || 200)
      : numAmount > (perTxPolicy?.details.maxUsdc || 50000);

  const exceedsRolling =
    symbol === "SOL"
      ? (rollingPolicy?.details.currentSpentSol || 0) + numAmount >
        (rollingPolicy?.details.maxWindowSol || 500)
      : false;

  const requiresEscalation = symbol === "SOL" && numAmount >= 300;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !destination || numAmount <= 0) return;

    createProposal({
      title,
      operationType: opType,
      symbol,
      destination,
      amount: numAmount,
    });

    onClose();
    setTitle("");
    setDestination("");
    setAmount("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-vault-900 border border-vault-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between p-5 border-b border-vault-800">
          <div>
            <h2 className="text-base font-bold text-white">Create Treasury Proposal</h2>
            <p className="text-xs text-slate-400">Initiate on-chain asset movement or configuration change</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-vault-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Operation Type */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Operation Type</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setOpType("SolTransfer");
                  setSymbol("SOL");
                }}
                className={`py-2 px-3 text-xs font-semibold rounded-lg border transition ${
                  opType === "SolTransfer"
                    ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400"
                    : "bg-vault-950 border-vault-800 text-slate-400 hover:text-slate-200"
                }`}
              >
                Native SOL Transfer
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpType("TokenTransfer");
                  setSymbol("USDC");
                }}
                className={`py-2 px-3 text-xs font-semibold rounded-lg border transition ${
                  opType === "TokenTransfer"
                    ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400"
                    : "bg-vault-950 border-vault-800 text-slate-400 hover:text-slate-200"
                }`}
              >
                SPL Token Transfer
              </button>
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Proposal Title / Memo</label>
            <input
              type="text"
              required
              placeholder="e.g. Q4 Infrastructure Payment"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-vault-950 border border-vault-800 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
            />
          </div>

          {/* Asset & Amount */}
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-1">
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Asset</label>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="w-full bg-vault-950 border border-vault-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 transition"
              >
                {opType === "SolTransfer" ? (
                  <option value="SOL">SOL</option>
                ) : (
                  <>
                    <option value="USDC">USDC</option>
                    <option value="PYTH">PYTH</option>
                  </>
                )}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Transfer Amount</label>
              <input
                type="number"
                step="any"
                required
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-vault-950 border border-vault-800 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
              />
            </div>
          </div>

          {/* Destination */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Destination Recipient Address
            </label>
            <input
              type="text"
              required
              placeholder="Recipient Solana wallet or ATA address"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="w-full bg-vault-950 border border-vault-800 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
            />
          </div>

          {/* Real-time Policy Pre-Flight Feedback */}
          <div className="p-3 rounded-lg bg-vault-950 border border-vault-800/80 space-y-1.5 text-xs">
            <div className="flex items-center space-x-1.5 text-slate-300 font-semibold text-[11px]">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>On-Chain Policy Engine Pre-Flight</span>
            </div>

            {exceedsPerTx && (
              <div className="flex items-center space-x-2 text-red-400 text-[11px]">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Exceeds per-transaction limit policy. On-chain execution will reject.</span>
              </div>
            )}

            {exceedsRolling && (
              <div className="flex items-center space-x-2 text-red-400 text-[11px]">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Exceeds 24-hour rolling spending limit policy window.</span>
              </div>
            )}

            {requiresEscalation && (
              <div className="flex items-center space-x-2 text-amber-400 text-[11px]">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Amount &ge; 300 SOL triggers Escalation Policy: 3 approvals &amp; 48h timelock required.</span>
              </div>
            )}

            {!exceedsPerTx && !exceedsRolling && !requiresEscalation && numAmount > 0 && (
              <p className="text-[11px] text-emerald-400">
                &check; Complies with active spending limits and requires {vault.threshold} on-chain approvals.
              </p>
            )}
          </div>

          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-vault-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white rounded-lg transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={exceedsPerTx || exceedsRolling || numAmount <= 0}
              className="flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm transition"
            >
              <span>Submit Proposal</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
