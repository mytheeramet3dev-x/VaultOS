"use client";

import React, { useState } from "react";
import {
  CheckCircle,
  Clock,
  Play,
  XCircle,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  UserCheck,
  RotateCcw,
  Eye,
  X,
  Copy,
  Check,
  AlertTriangle,
  Cpu,
} from "lucide-react";
import { ProposalItem, useTreasury } from "../context/TreasuryContext";
import { useWallet } from "../context/WalletContext";

interface Props {
  proposal: ProposalItem;
  onSelect?: () => void;
}

export function ProposalCard({ proposal, onSelect }: Props) {
  const { activeWallet } = useWallet();
  const { vault, policies, approveProposal, revokeApproval, executeProposal, cancelProposal } =
    useTreasury();
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [copiedDest, setCopiedDest] = useState(false);

  const hasApproved = proposal.approvals.includes(activeWallet.address);
  const canApprove = activeWallet.roles.includes("Approver") || activeWallet.roles.includes("Admin");
  const canExecute = activeWallet.roles.includes("Executor") || activeWallet.roles.includes("Admin");
  const canCancel =
    activeWallet.address === proposal.proposer || activeWallet.roles.includes("Admin");

  const progressPercent = Math.min(
    100,
    (proposal.approvals.length / proposal.requiredThreshold) * 100
  );

  const currentAssetBalance =
    proposal.symbol === "SOL"
      ? vault.solBalance
      : vault.tokens.find((t) => t.symbol === proposal.symbol)?.balance || 0;
  const postExecutionBalance = Math.max(0, currentAssetBalance - proposal.amount);
  const drainPercent =
    currentAssetBalance > 0 ? (proposal.amount / currentAssetBalance) * 100 : 0;

  // Evaluate active policies against this proposal
  const activePolicies = policies.filter((p) => p.isActive);
  const policyViolations: string[] = [];
  for (const pol of activePolicies) {
    if (pol.type === "PerTransactionLimit") {
      const cap = Number(pol.details?.maxAmount || 0);
      const asset = pol.details?.asset || "SOL";
      if (cap > 0 && proposal.symbol === asset && proposal.amount > cap) {
        policyViolations.push(
          `Exceeds ${pol.title} (${proposal.amount.toLocaleString()} > ${cap.toLocaleString()} ${asset})`
        );
      }
    } else if (pol.type === "RollingSpendingLimit") {
      const maxWindow = Number(pol.details?.maxAmountWindow || 0);
      const currentSpent = Number(pol.details?.currentSpent || 0);
      const asset = pol.details?.asset || "SOL";
      if (maxWindow > 0 && proposal.symbol === asset && currentSpent + proposal.amount > maxWindow) {
        policyViolations.push(
          `Exceeds 24h Rolling Limit (${(currentSpent + proposal.amount).toLocaleString()} > ${maxWindow.toLocaleString()} ${asset})`
        );
      }
    } else if (pol.type === "DestinationAllowlist") {
      const allowed: string[] = Array.isArray(pol.details?.allowedAddresses)
        ? pol.details.allowedAddresses
        : [];
      if (
        allowed.length > 0 &&
        !allowed.some((a) => proposal.destination.startsWith(a.replace(/\.\.\.$/, "")))
      ) {
        policyViolations.push(`Destination ${proposal.destination.slice(0, 8)}... not in allowlist`);
      }
    }
  }

  const handleOpenDetail = () => {
    if (onSelect) onSelect();
    setIsDetailOpen(true);
  };

  const handleCopyDest = () => {
    navigator.clipboard.writeText(proposal.destination);
    setCopiedDest(true);
    setTimeout(() => setCopiedDest(false), 2000);
  };

  return (
    <>
      <div className="rounded-xl bg-vault-900 border border-vault-800 p-5 hover:border-vault-700 transition shadow-sm space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-mono font-semibold text-emerald-400">
                #{proposal.proposalIndex}
              </span>
              <span
                className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${
                  proposal.status === "Executed"
                    ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                    : proposal.status === "Executable"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    : proposal.status === "Cancelled"
                    ? "bg-red-500/10 text-red-400 border-red-500/30"
                    : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                }`}
              >
                {proposal.status}
              </span>
              <span className="text-xs text-slate-500">
                Proposed by {proposal.proposerName}
              </span>
            </div>
            <h3
              className="font-semibold text-sm text-white mt-1 hover:text-emerald-400 transition cursor-pointer"
              onClick={handleOpenDetail}
            >
              {proposal.title}
            </h3>
          </div>

          {/* Amount Badge */}
          <div className="text-right shrink-0">
            <p className="text-base font-bold text-white font-mono">
              {proposal.amount.toLocaleString()} {proposal.symbol}
            </p>
            <p className="text-[11px] text-slate-400 font-mono truncate max-w-[140px]">
              &rarr; {proposal.destination.slice(0, 4)}...{proposal.destination.slice(-4)}
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 flex items-center space-x-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>On-Chain Approvals</span>
            </span>
            <span className="font-semibold text-slate-200">
              {proposal.approvals.length} of {proposal.requiredThreshold} Required
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-vault-950 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 rounded-full ${
                proposal.status === "Executed"
                  ? "bg-blue-500"
                  : proposal.status === "Executable"
                  ? "bg-emerald-500"
                  : "bg-amber-500"
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Approvers Pills */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[11px] text-slate-500 mr-1">Approvers:</span>
          {proposal.approvals.map((addr) => (
            <span
              key={addr}
              className="text-[10px] font-mono px-2 py-0.5 rounded bg-vault-950 text-slate-300 border border-vault-800"
            >
              {addr === activeWallet.address ? "You" : `${addr.slice(0, 4)}...${addr.slice(-4)}`}
            </span>
          ))}
        </div>

        {/* Action Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-vault-800 text-xs">
          <div className="flex items-center space-x-2">
            <button
              onClick={handleOpenDetail}
              className="inline-flex items-center space-x-1 text-slate-400 hover:text-emerald-400 transition font-medium"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Inspect &amp; Simulate</span>
            </button>
            {proposal.txSignature && (
              <span className="text-[11px] font-mono text-slate-500 flex items-center space-x-1 pl-2 border-l border-vault-800">
                <span>TX: {proposal.txSignature.slice(0, 6)}...</span>
                <ExternalLink className="w-3 h-3 text-slate-500" />
              </span>
            )}
          </div>

          <div className="flex items-center space-x-2">
            {/* Cancel button */}
            {proposal.status !== "Executed" && proposal.status !== "Cancelled" && canCancel && (
              <button
                onClick={() => cancelProposal(proposal.id)}
                className="px-2.5 py-1 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded transition text-xs font-medium"
              >
                Cancel
              </button>
            )}

            {/* Revoke button */}
            {hasApproved && proposal.status !== "Executed" && proposal.status !== "Cancelled" && (
              <button
                onClick={() => revokeApproval(proposal.id)}
                className="flex items-center space-x-1 px-3 py-1 bg-vault-800 hover:bg-vault-700 text-slate-300 rounded-lg text-xs font-semibold transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Revoke</span>
              </button>
            )}

            {/* Approve button */}
            {!hasApproved &&
              canApprove &&
              (proposal.status === "Active" || proposal.status === "Approved") && (
                <button
                  onClick={() => approveProposal(proposal.id)}
                  className="flex items-center space-x-1 px-3 py-1 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold shadow-sm transition"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>Approve</span>
                </button>
              )}

            {/* Execute button */}
            {proposal.status === "Executable" && canExecute && !vault.isFrozen && (
              <button
                onClick={() => executeProposal(proposal.id)}
                className="flex items-center space-x-1 px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-xs font-semibold shadow-sm transition animate-pulse"
              >
                <Play className="w-3.5 h-3.5 fill-white" />
                <span>Execute On-Chain</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Proposal Detail & Simulation Modal */}
      {isDetailOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl rounded-2xl bg-vault-900 border border-vault-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-5 border-b border-vault-800">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-mono font-bold text-emerald-400">
                    Proposal #{proposal.proposalIndex}
                  </span>
                  <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-vault-800 text-slate-200 border border-vault-700">
                    {proposal.operationType}
                  </span>
                </div>
                <h2 className="text-base font-bold text-white mt-1">{proposal.title}</h2>
              </div>
              <button
                onClick={() => setIsDetailOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-vault-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
              {/* Exact Transaction Intent */}
              <div className="p-3.5 rounded-xl bg-vault-950 border border-vault-800 space-y-2.5">
                <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <span>Immutable On-Chain Transaction Intent</span>
                  <span className="text-emerald-400">Verified Payload</span>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <p className="text-[10px] text-slate-500">Asset &amp; Amount</p>
                    <p className="text-sm font-bold text-white font-mono">
                      {proposal.amount.toLocaleString()} {proposal.symbol}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500">Proposer</p>
                    <p className="text-xs font-semibold text-slate-200">
                      {proposal.proposerName}{" "}
                      <span className="font-mono text-slate-500">
                        ({proposal.proposer.slice(0, 4)}...{proposal.proposer.slice(-4)})
                      </span>
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] text-slate-500 mb-1">Exact Destination Address</p>
                  <div className="flex items-center justify-between p-2 rounded bg-vault-900 border border-vault-800 font-mono text-[11px] text-slate-200">
                    <span className="truncate">{proposal.destination}</span>
                    <button
                      onClick={handleCopyDest}
                      className="ml-2 p-1 rounded hover:bg-vault-800 text-slate-400 hover:text-white shrink-0"
                      title="Copy full destination address"
                    >
                      {copiedDest ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Pre-Execution Simulation Preview */}
              <div className="p-3.5 rounded-xl bg-vault-950 border border-vault-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center space-x-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                    <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Pre-Flight Transaction Simulation</span>
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Est. Fee: 0.000005 SOL
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1 font-mono">
                  <div className="p-2 rounded bg-vault-900 border border-vault-800">
                    <p className="text-[10px] text-slate-500 font-sans">Current Balance</p>
                    <p className="font-semibold text-slate-200">
                      {currentAssetBalance.toLocaleString()} {proposal.symbol}
                    </p>
                  </div>
                  <div className="p-2 rounded bg-vault-900 border border-vault-800">
                    <p className="text-[10px] text-slate-500 font-sans">Balance Delta</p>
                    <p className="font-semibold text-red-400">
                      -{proposal.amount.toLocaleString()} {proposal.symbol}
                    </p>
                  </div>
                  <div className="p-2 rounded bg-vault-900 border border-vault-800">
                    <p className="text-[10px] text-slate-500 font-sans">Post-Execution</p>
                    <p className="font-semibold text-emerald-400">
                      {postExecutionBalance.toLocaleString()} {proposal.symbol}
                    </p>
                  </div>
                </div>

                {drainPercent >= 25 && (
                  <div className="flex items-center space-x-2 p-2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[11px]">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>
                      High-Impact Warning: This transfer moves {drainPercent.toFixed(1)}% of the
                      vault&apos;s {proposal.symbol} balance.
                    </span>
                  </div>
                )}

                <div className="text-[11px] text-slate-400 space-y-1 pt-1">
                  {policyViolations.length === 0 ? (
                    <p className="text-emerald-400">
                      &check; Policy Check: Passes {activePolicies.length} active on-chain spending
                      policies.
                    </p>
                  ) : (
                    policyViolations.map((v, idx) => (
                      <p key={idx} className="text-red-400 font-medium">
                        &times; Policy Violation: {v}
                      </p>
                    ))
                  )}
                  <p>
                    &bull; Timelock Requirement:{" "}
                    {proposal.timelockDelay > 0
                      ? `${proposal.timelockDelay / 3600} hours mandatory delay`
                      : "Immediate execution upon M-of-N consensus"}
                  </p>
                  <p>
                    &bull; Authority Signer: Vault Authority PDA ({vault.authorityPda.slice(0, 8)}
                    ...)
                  </p>
                </div>
              </div>

              {/* Approvals & Modal Actions */}
              <div className="flex items-center justify-between pt-2 border-t border-vault-800">
                <div className="text-slate-400">
                  Approvals:{" "}
                  <span className="font-bold text-white">
                    {proposal.approvals.length} / {proposal.requiredThreshold}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setIsDetailOpen(false)}
                    className="px-3 py-1.5 rounded-lg bg-vault-800 hover:bg-vault-700 text-slate-300 font-semibold transition"
                  >
                    Close
                  </button>
                  {!hasApproved &&
                    canApprove &&
                    (proposal.status === "Active" || proposal.status === "Approved") && (
                      <button
                        onClick={() => {
                          approveProposal(proposal.id);
                          setIsDetailOpen(false);
                        }}
                        className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold transition"
                      >
                        Approve Proposal
                      </button>
                    )}
                  {proposal.status === "Executable" && canExecute && !vault.isFrozen && (
                    <button
                      onClick={() => {
                        executeProposal(proposal.id);
                        setIsDetailOpen(false);
                      }}
                      className="px-3.5 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-semibold transition"
                    >
                      Execute Now
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
