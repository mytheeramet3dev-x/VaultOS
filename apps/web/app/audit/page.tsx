"use client";

import React, { useState } from "react";
import { History, Search, ExternalLink, ShieldCheck, Filter } from "lucide-react";
import { useTreasury } from "../../context/TreasuryContext";

export default function AuditPage() {
  const { auditLogs } = useTreasury();
  const [search, setSearch] = useState("");
  const [filterEvent, setFilterEvent] = useState("ALL");

  const filteredLogs = auditLogs.filter((log) => {
    if (filterEvent !== "ALL" && log.eventName !== filterEvent) return false;
    if (
      search &&
      !log.details.toLowerCase().includes(search.toLowerCase()) &&
      !log.signature.toLowerCase().includes(search.toLowerCase()) &&
      !log.actorName.toLowerCase().includes(search.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const eventTypes = [
    "ALL",
    "ProposalCreated",
    "ProposalApproved",
    "ProposalExecuted",
    "ProposalCancelled",
    "VaultFrozen",
    "VaultUnfrozen",
    "DepositReceived",
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
            <span>Protocol Audit Trail</span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Immutable History
            </span>
          </h1>
          <p className="text-sm text-slate-400">
            Reconstructable chronological log of all security-sensitive state transitions
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 sm:pb-0">
          {eventTypes.map((t) => (
            <button
              key={t}
              onClick={() => setFilterEvent(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                filterEvent === t
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                  : "bg-vault-900 text-slate-400 hover:text-white border border-vault-800"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by signature or actor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-vault-900 border border-vault-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
          />
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="rounded-xl bg-vault-900 border border-vault-800 overflow-hidden shadow-sm">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-vault-800 text-slate-400 uppercase text-[10px] bg-vault-950">
            <tr>
              <th className="py-3 px-5 font-semibold">Event</th>
              <th className="py-3 px-5 font-semibold">Operation Details</th>
              <th className="py-3 px-5 font-semibold">Actor</th>
              <th className="py-3 px-5 font-semibold">Timestamp</th>
              <th className="py-3 px-5 font-semibold text-right">Solana Signature</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-vault-800/60">
            {filteredLogs.map((log) => (
              <tr key={log.id} className="hover:bg-vault-850/50 transition">
                <td className="py-3.5 px-5">
                  <span
                    className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                      log.eventName.includes("Executed")
                        ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                        : log.eventName.includes("Approved")
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                        : log.eventName.includes("Frozen")
                        ? "bg-red-500/10 text-red-400 border-red-500/30"
                        : "bg-slate-500/10 text-slate-300 border-slate-500/30"
                    }`}
                  >
                    {log.eventName}
                  </span>
                </td>

                <td className="py-3.5 px-5 text-slate-200 font-medium">
                  {log.details}
                </td>

                <td className="py-3.5 px-5 text-slate-400">
                  <span className="font-semibold text-slate-300">{log.actorName}</span>
                  <p className="text-[10px] font-mono text-slate-500">
                    {log.actor.slice(0, 4)}...{log.actor.slice(-4)}
                  </p>
                </td>

                <td className="py-3.5 px-5 font-mono text-slate-400">
                  {new Date(log.timestamp).toLocaleString()}
                </td>

                <td className="py-3.5 px-5 text-right font-mono">
                  <a
                    href={`https://explorer.solana.com/tx/${log.signature}?cluster=custom`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center space-x-1 text-emerald-400 hover:text-emerald-300 hover:underline"
                  >
                    <span>{log.signature.slice(0, 8)}...</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </td>
              </tr>
            ))}
            {filteredLogs.length === 0 && (
              <tr>
                <td colSpan={5} className="py-12 text-center text-slate-400">
                  No audit events found matching the search query.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
