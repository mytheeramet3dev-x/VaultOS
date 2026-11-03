"use client";

import React from "react";
import { Shield, ShieldAlert, Wifi, UserCheck, ChevronDown, Wallet } from "lucide-react";
import { useWallet, DEMO_WALLETS } from "../context/WalletContext";
import { useTreasury } from "../context/TreasuryContext";

export function Navbar() {
  const {
    activeWallet,
    setActiveWallet,
    network,
    setNetwork,
    isBrowserWalletConnected,
    connectBrowserWallet,
    disconnectBrowserWallet,
  } = useWallet();
  const { vault, unfreezeVault } = useTreasury();

  return (
    <header className="border-b border-vault-800 bg-vault-950/80 backdrop-blur-md sticky top-0 z-40">
      <div className="flex items-center justify-between px-6 py-3.5">
        {/* Brand */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-lg tracking-tight text-white">VaultOS</span>
              <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {network === "localnet" ? "Localnet Staging" : "Solana Devnet"}
              </span>
            </div>
            <p className="text-xs text-slate-400">Institutional Treasury & Governance OS</p>
          </div>
        </div>

        {/* Emergency Freeze Banner if active */}
        {vault.isFrozen && (
          <div className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 animate-pulse">
            <ShieldAlert className="w-4 h-4 text-red-400" />
            <span className="text-xs font-semibold">EMERGENCY CONTROLS ACTIVE: VAULT FROZEN</span>
            {activeWallet.roles.includes("Admin") && (
              <button
                onClick={unfreezeVault}
                className="ml-2 text-xs bg-red-500 hover:bg-red-600 text-white font-medium px-2 py-0.5 rounded transition"
              >
                Lift Freeze
              </button>
            )}
          </div>
        )}

        {/* Right Action Bar */}
        <div className="flex items-center space-x-3">
          {/* Network Selector */}
          <div className="flex items-center space-x-1.5 bg-vault-900 border border-vault-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300">
            <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            <select
              value={network}
              onChange={(e) => setNetwork(e.target.value as any)}
              className="bg-transparent border-none text-xs font-medium focus:outline-none cursor-pointer text-slate-200"
            >
              <option value="localnet" className="bg-vault-900 text-slate-200">Localnet (Agave RPC)</option>
              <option value="devnet" className="bg-vault-900 text-slate-200">Solana Devnet</option>
            </select>
          </div>

          {/* Connect Browser Wallet Button */}
          {!isBrowserWalletConnected ? (
            <button
              onClick={connectBrowserWallet}
              className="flex items-center space-x-1.5 bg-vault-900 hover:bg-vault-850 border border-vault-800 hover:border-emerald-500/50 text-slate-300 hover:text-white rounded-lg px-2.5 py-1.5 text-xs transition"
              title="Connect Phantom / Solflare"
            >
              <Wallet className="w-3.5 h-3.5 text-emerald-400" />
              <span>Connect Wallet</span>
            </button>
          ) : (
            <button
              onClick={disconnectBrowserWallet}
              className="flex items-center space-x-1.5 bg-emerald-500/10 hover:bg-red-500/10 border border-emerald-500/30 hover:border-red-500/30 text-emerald-400 hover:text-red-400 rounded-lg px-2.5 py-1.5 text-xs transition"
              title="Disconnect Browser Wallet"
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>Disconnect</span>
            </button>
          )}

          {/* Persona / Wallet Switcher */}
          <div className="relative">
            <div className="flex items-center space-x-2 bg-vault-900 hover:bg-vault-850 border border-vault-700/60 rounded-lg px-3 py-1.5 transition">
              <UserCheck className="w-4 h-4 text-emerald-400" />
              <div className="text-left">
                <div className="text-xs font-medium text-white flex items-center space-x-1">
                  <span>{activeWallet.name}</span>
                </div>
                <div className="text-[10px] text-slate-400 flex items-center space-x-1">
                  <span>{activeWallet.address.slice(0, 4)}...{activeWallet.address.slice(-4)}</span>
                </div>
              </div>
              <select
                value={activeWallet.id}
                onChange={(e) => {
                  const target = DEMO_WALLETS.find((w) => w.id === e.target.value);
                  if (target) {
                    disconnectBrowserWallet();
                    setActiveWallet(target);
                  }
                }}
                className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
              >
                {DEMO_WALLETS.map((w) => (
                  <option key={w.id} value={w.id} className="bg-vault-900 text-slate-200">
                    {w.name} ({w.roles.join(", ")})
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
