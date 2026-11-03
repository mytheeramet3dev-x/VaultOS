"use client";

import React, { useState } from "react";
import {
  Wallet,
  TrendingUp,
  FileCheck2,
  ShieldAlert,
  ArrowUpRight,
  ArrowDownRight,
  ShieldCheck,
  Coins,
  History,
  Lock,
  PlusCircle,
} from "lucide-react";
import { useTreasury } from "../context/TreasuryContext";
import { useWallet } from "../context/WalletContext";
import { ProposalCard } from "../components/ProposalCard";
import { CreateProposalModal } from "../components/CreateProposalModal";
import { DepositModal } from "../components/DepositModal";

export default function OverviewPage() {
  const { vault, proposals, policies, auditLogs, freezeVault } = useTreasury();
  const { activeWallet } = useWallet();

  const [isProposalModalOpen, setIsProposalModalOpen] = useState(false);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);

  // Compute Total Treasury Value in USD
  const totalUsd = vault.tokens.reduce((acc, t) => acc + t.balance * t.priceUsd, 0);

  const pendingProposals = proposals.filter(
    (p) => p.status === "Active" || p.status === "Approved" || p.status === "Executable"
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Top Header & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
            <span>Treasury Overview</span>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Verified Non-Custodial
            </span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Real-time multisig custody, programmable spending limits, and governance controls.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setIsDepositModalOpen(true)}
            className="flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-vault-900 hover:bg-vault-850 border border-vault-700/80 text-xs font-semibold text-slate-200 transition"
          >
            <ArrowDownRight className="w-4 h-4 text-emerald-400" />
            <span>Deposit Assets</span>
          </button>

          <button
            onClick={() => setIsProposalModalOpen(true)}
            className="flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-xs font-semibold text-white shadow-md shadow-emerald-500/10 transition"
          >
            <PlusCircle className="w-4 h-4" />
            <span>New Proposal</span>
          </button>

          {activeWallet.roles.includes("Admin") && !vault.isFrozen && (
            <button
              onClick={freezeVault}
              className="flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-xs font-semibold text-red-400 transition"
              title="Emergency control: immediately halt transfers"
            >
              <ShieldAlert className="w-4 h-4" />
              <span>Freeze Vault</span>
            </button>
          )}
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Total TVL */}
        <div className="rounded-xl bg-vault-900 border border-vault-800 p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Total Value Locked</span>
            <Wallet className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-white font-mono">
            ${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <div className="flex items-center space-x-1 text-xs text-emerald-400">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Multi-asset custody</span>
          </div>
        </div>

        {/* Native SOL Balance */}
        <div className="rounded-xl bg-vault-900 border border-vault-800 p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Native SOL</span>
            <Coins className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-white font-mono">
            {vault.solBalance.toLocaleString()} SOL
          </p>
          <p className="text-xs text-slate-400 font-mono">
            &asymp; ${(vault.solBalance * 154.2).toLocaleString()} USD
          </p>
        </div>

        {/* Multisig Rule */}
        <div className="rounded-xl bg-vault-900 border border-vault-800 p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Approval Policy</span>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-white font-mono">
            {vault.threshold} / {vault.memberCount} M-of-N
          </p>
          <p className="text-xs text-slate-400">
            {vault.timelockDelaySeconds / 3600}h execution timelock delay
          </p>
        </div>

        {/* Pending Actions */}
        <div className="rounded-xl bg-vault-900 border border-vault-800 p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Pending Proposals</span>
            <FileCheck2 className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-white font-mono">
            {pendingProposals.length}
          </p>
          <p className="text-xs text-slate-400">
            {proposals.filter((p) => p.status === "Executed").length} historical executions
          </p>
        </div>
      </div>

      {/* Treasury Assets & Policy Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Token Accounts Table */}
        <div className="lg:col-span-2 rounded-xl bg-vault-900 border border-vault-800 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-sm text-white">Vault Asset Holdings</h2>
            <span className="text-xs text-slate-400">Authority: PDA controlled</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-vault-800 text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="pb-3 font-semibold">Asset</th>
                  <th className="pb-3 font-semibold">Price</th>
                  <th className="pb-3 font-semibold">Balance</th>
                  <th className="pb-3 font-semibold text-right">Value (USD)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vault-800/60">
                {vault.tokens.map((token) => (
                  <tr key={token.symbol} className="hover:bg-vault-850/50 transition">
                    <td className="py-3 font-bold text-white flex items-center space-x-2">
                      <div className="w-7 h-7 rounded-full bg-vault-800 flex items-center justify-center font-bold text-xs text-emerald-400 border border-vault-700">
                        {token.symbol.slice(0, 3)}
                      </div>
                      <div>
                        <span>{token.symbol}</span>
                        <p className="text-[10px] text-slate-500 font-mono font-normal truncate max-w-[120px]">
                          {token.mint.slice(0, 4)}...{token.mint.slice(-4)}
                        </p>
                      </div>
                    </td>
                    <td className="py-3 font-mono text-slate-300">
                      ${token.priceUsd.toFixed(2)}
                    </td>
                    <td className="py-3 font-mono font-semibold text-white">
                      {token.balance.toLocaleString()} {token.symbol}
                    </td>
                    <td className="py-3 font-mono font-bold text-emerald-400 text-right">
                      ${(token.balance * token.priceUsd).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Active Spending Policies Card */}
        <div className="rounded-xl bg-vault-900 border border-vault-800 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-sm text-white">Active Policies</h2>
            <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
              Enforced On-Chain
            </span>
          </div>

          <div className="space-y-3">
            {policies.map((p) => (
              <div
                key={p.id}
                className="p-3 rounded-lg bg-vault-950 border border-vault-800/80 space-y-1 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200">{p.title}</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                </div>
                <p className="text-[11px] text-slate-400">{p.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pending Proposals Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white flex items-center space-x-2">
            <span>Pending Multisig Proposals</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-vault-800 text-slate-300 font-semibold">
              {pendingProposals.length}
            </span>
          </h2>
        </div>

        {pendingProposals.length === 0 ? (
          <div className="p-8 text-center rounded-xl bg-vault-900 border border-vault-800 text-xs text-slate-400">
            No active proposals requiring approval. Click "New Proposal" to initiate a transfer.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {pendingProposals.map((p) => (
              <ProposalCard key={p.id} proposal={p} />
            ))}
          </div>
        )}
      </div>

      {/* Recent Live Audit Ticker */}
      <div className="rounded-xl bg-vault-900 border border-vault-800 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <History className="w-4 h-4 text-emerald-400" />
            <h2 className="font-bold text-sm text-white">Recent Audit Events</h2>
          </div>
          <span className="text-xs text-slate-400">Full immutable on-chain record</span>
        </div>

        <div className="divide-y divide-vault-800/60 text-xs">
          {auditLogs.slice(0, 5).map((log) => (
            <div key={log.id} className="py-2.5 flex items-center justify-between gap-4">
              <div className="flex items-center space-x-3">
                <span className="font-mono text-[11px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  {log.eventName}
                </span>
                <span className="text-slate-300">{log.details}</span>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[11px] font-mono text-slate-500">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </p>
                <p className="text-[10px] text-slate-500">
                  By {log.actorName}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modals */}
      <CreateProposalModal
        isOpen={isProposalModalOpen}
        onClose={() => setIsProposalModalOpen(false)}
      />
      <DepositModal
        isOpen={isDepositModalOpen}
        onClose={() => setIsDepositModalOpen(false)}
      />
    </div>
  );
}
