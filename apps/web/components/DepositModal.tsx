"use client";

import React, { useState } from "react";
import { X, ArrowDownRight, CheckCircle2 } from "lucide-react";
import { useTreasury } from "../context/TreasuryContext";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function DepositModal({ isOpen, onClose }: Props) {
  const { vault, deposit } = useTreasury();
  const [symbol, setSymbol] = useState("SOL");
  const [amount, setAmount] = useState("");
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseFloat(amount);
    if (num <= 0) return;

    deposit(num, symbol);
    setSuccess(true);
    setTimeout(() => {
      setSuccess(false);
      onClose();
      setAmount("");
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-vault-900 border border-vault-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between p-5 border-b border-vault-800">
          <div>
            <h2 className="text-base font-bold text-white">Deposit Treasury Funds</h2>
            <p className="text-xs text-slate-400">Transfer assets directly into the non-custodial Vault Authority</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-vault-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {success ? (
          <div className="p-8 text-center space-y-3">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-sm text-white">Deposit Confirmed</h3>
            <p className="text-xs text-slate-400">
              Successfully credited {amount} {symbol} to Vault Authority PDA
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-1">
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Asset</label>
                <select
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="w-full bg-vault-950 border border-vault-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 transition"
                >
                  <option value="SOL">SOL</option>
                  <option value="USDC">USDC</option>
                  <option value="PYTH">PYTH</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Amount</label>
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

            <div className="p-3 rounded-lg bg-vault-950 border border-vault-800 text-[11px] text-slate-400 space-y-1">
              <p className="font-semibold text-slate-300">Recipient Account</p>
              <p className="font-mono text-slate-400 truncate">{vault.authorityPda}</p>
              <p className="text-[10px] text-slate-500">
                Assets are non-custodial and can only be moved with multisig consensus.
              </p>
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
                disabled={!amount || parseFloat(amount) <= 0}
                className="flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm transition"
              >
                <span>Confirm Deposit</span>
                <ArrowDownRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
