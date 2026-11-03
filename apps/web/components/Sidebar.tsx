"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileCheck2,
  Users2,
  Sliders,
  History,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { useTreasury } from "../context/TreasuryContext";

export function Sidebar() {
  const pathname = usePathname();
  const { vault, proposals } = useTreasury();
  const [copied, setCopied] = React.useState(false);

  const pendingCount = proposals.filter(
    (p) => p.status === "Active" || p.status === "Approved" || p.status === "Executable"
  ).length;

  const navItems = [
    { label: "Overview", href: "/", icon: LayoutDashboard },
    {
      label: "Proposals",
      href: "/proposals",
      icon: FileCheck2,
      badge: pendingCount > 0 ? pendingCount : undefined,
    },
    { label: "Members & Roles", href: "/members", icon: Users2 },
    { label: "Spending Policies", href: "/policies", icon: Sliders },
    { label: "Audit Trail", href: "/audit", icon: History },
  ];

  const handleCopy = () => {
    navigator.clipboard.writeText(vault.authorityPda);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <aside className="w-64 border-r border-vault-800 bg-vault-950 flex flex-col justify-between p-4 min-h-[calc(100vh-61px)]">
      <div className="space-y-6">
        {/* Active Vault Badge Card */}
        <div className="p-3.5 rounded-xl bg-vault-900 border border-vault-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Active Treasury
            </span>
            <span className="flex items-center text-[10px] text-emerald-400 space-x-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              <span>Online</span>
            </span>
          </div>
          <h3 className="font-semibold text-sm text-white truncate">{vault.name}</h3>
          <p className="text-xs text-slate-400 truncate">{vault.orgName}</p>

          <div className="pt-2 border-t border-vault-800/80 grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-[10px] text-slate-500">Threshold</p>
              <p className="font-semibold text-slate-200">
                {vault.threshold} of {vault.memberCount}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500">Timelock</p>
              <p className="font-semibold text-slate-200">
                {vault.timelockDelaySeconds / 3600}h
              </p>
            </div>
          </div>
        </div>

        {/* Navigation Menu */}
        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                  isActive
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "text-slate-400 hover:text-white hover:bg-vault-900"
                }`}
              >
                <div className="flex items-center space-x-3">
                  <Icon className={`w-4 h-4 ${isActive ? "text-emerald-400" : "text-slate-400"}`} />
                  <span>{item.label}</span>
                </div>
                {item.badge !== undefined && (
                  <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-semibold">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Vault Authority PDA Card */}
      <div className="p-3 rounded-lg bg-vault-900/60 border border-vault-800/80 space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="flex items-center space-x-1.5 text-[11px] font-medium text-slate-300">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Vault Authority PDA</span>
          </span>
          <button
            onClick={handleCopy}
            className="hover:text-white p-1 rounded hover:bg-vault-800 transition"
            title="Copy Authority PDA"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
        <p className="text-[11px] font-mono text-slate-400 truncate bg-vault-950 p-1.5 rounded border border-vault-800">
          {vault.authorityPda}
        </p>
        <p className="text-[10px] text-slate-500">
          Non-custodial PDA authority owns all treasury lamports & SPL token accounts.
        </p>
      </div>
    </aside>
  );
}
