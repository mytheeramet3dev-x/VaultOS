"use client";

import React, { useState } from "react";
import { PlusCircle, Search, Filter } from "lucide-react";
import { useTreasury } from "../../context/TreasuryContext";
import { ProposalCard } from "../../components/ProposalCard";
import { CreateProposalModal } from "../../components/CreateProposalModal";

export default function ProposalsPage() {
  const { proposals } = useTreasury();
  const [filter, setFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const filteredProposals = proposals.filter((p) => {
    if (filter !== "ALL" && p.status !== filter) return false;
    if (search && !p.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = {
    ALL: proposals.length,
    Active: proposals.filter((p) => p.status === "Active").length,
    Executable: proposals.filter((p) => p.status === "Executable").length,
    Executed: proposals.filter((p) => p.status === "Executed").length,
    Cancelled: proposals.filter((p) => p.status === "Cancelled").length,
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Multisig Proposals</h1>
          <p className="text-sm text-slate-400">
            Lifecycle: Propose &rarr; Collect Approvals &rarr; Timelock &rarr; Execute Exactly Once
          </p>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-xs font-semibold text-white shadow-md shadow-emerald-500/10 transition"
        >
          <PlusCircle className="w-4 h-4" />
          <span>New Proposal</span>
        </button>
      </div>

      {/* Filters and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 sm:pb-0">
          {(["ALL", "Active", "Executable", "Executed", "Cancelled"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                filter === tab
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                  : "bg-vault-900 text-slate-400 hover:text-white border border-vault-800"
              }`}
            >
              {tab} ({counts[tab as keyof typeof counts] || 0})
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search proposals..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-vault-900 border border-vault-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
          />
        </div>
      </div>

      {/* Proposal Cards List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filteredProposals.map((p) => (
          <ProposalCard key={p.id} proposal={p} />
        ))}
        {filteredProposals.length === 0 && (
          <div className="col-span-2 p-12 text-center rounded-xl bg-vault-900 border border-vault-800 text-xs text-slate-400">
            No proposals match the current filter criteria.
          </div>
        )}
      </div>

      <CreateProposalModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  );
}
