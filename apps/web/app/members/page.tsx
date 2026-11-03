"use client";

import React, { useState } from "react";
import { UserPlus, Shield, Check, Copy, UserCheck, Key, Trash2 } from "lucide-react";
import { useWallet } from "../../context/WalletContext";
import { useTreasury } from "../../context/TreasuryContext";

export default function MembersPage() {
  const { activeWallet } = useWallet();
  const { vault, members, addMember, removeMember } = useTreasury();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newAddress, setNewAddress] = useState("");
  const [newName, setNewName] = useState("");
  const [selectedRoles, setSelectedRoles] = useState({
    admin: false,
    proposer: true,
    approver: true,
    executor: false,
  });

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAddress || !newName) return;

    let mask = 0;
    if (selectedRoles.admin) mask |= 1;
    if (selectedRoles.proposer) mask |= 2;
    if (selectedRoles.approver) mask |= 4;
    if (selectedRoles.executor) mask |= 8;

    addMember(newAddress, newName, mask);
    setIsModalOpen(false);
    setNewAddress("");
    setNewName("");
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Members &amp; Permissions</h1>
          <p className="text-sm text-slate-400">
            Granular on-chain role bitflags (Admin, Proposer, Approver, Executor)
          </p>
        </div>

        {activeWallet.roles.includes("Admin") && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-xs font-semibold text-white shadow-md shadow-emerald-500/10 transition"
          >
            <UserPlus className="w-4 h-4" />
            <span>Add Member</span>
          </button>
        )}
      </div>

      {/* Permissions Bitmask Architecture Card */}
      <div className="p-4 rounded-xl bg-vault-900 border border-vault-800 grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
        <div className="flex items-start space-x-3">
          <div className="w-7 h-7 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center font-mono font-bold shrink-0">
            01
          </div>
          <div>
            <h4 className="font-bold text-white">ROLE_ADMIN (1)</h4>
            <p className="text-slate-400 text-[11px]">Can manage policies, membership, and emergency freeze controls.</p>
          </div>
        </div>

        <div className="flex items-start space-x-3">
          <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center font-mono font-bold shrink-0">
            02
          </div>
          <div>
            <h4 className="font-bold text-white">ROLE_PROPOSER (2)</h4>
            <p className="text-slate-400 text-[11px]">Can create transfers, CPI calls, and parameter proposals.</p>
          </div>
        </div>

        <div className="flex items-start space-x-3">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center font-mono font-bold shrink-0">
            04
          </div>
          <div>
            <h4 className="font-bold text-white">ROLE_APPROVER (4)</h4>
            <p className="text-slate-400 text-[11px]">Can sign on-chain approvals towards the {vault.threshold}-of-{vault.memberCount} multisig threshold.</p>
          </div>
        </div>

        <div className="flex items-start space-x-3">
          <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center font-mono font-bold shrink-0">
            08
          </div>
          <div>
            <h4 className="font-bold text-white">ROLE_EXECUTOR (8)</h4>
            <p className="text-slate-400 text-[11px]">Can trigger idempotent execution once threshold and timelock pass.</p>
          </div>
        </div>
      </div>

      {/* Members Table */}
      <div className="rounded-xl bg-vault-900 border border-vault-800 overflow-hidden shadow-sm">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-vault-800 text-slate-400 uppercase text-[10px] bg-vault-950">
            <tr>
              <th className="py-3 px-5 font-semibold">Member</th>
              <th className="py-3 px-5 font-semibold">Wallet Address</th>
              <th className="py-3 px-5 font-semibold">Roles (Bitmask)</th>
              <th className="py-3 px-5 font-semibold">Status</th>
              <th className="py-3 px-5 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-vault-800/60">
            {members.map((member) => (
              <tr key={member.id} className="hover:bg-vault-850/50 transition">
                <td className="py-3.5 px-5 font-bold text-white flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-full bg-vault-800 border border-vault-700 flex items-center justify-center text-emerald-400 font-bold text-xs">
                    {member.name.slice(0, 1)}
                  </div>
                  <div>
                    <span>{member.name}</span>
                    {member.id === activeWallet.id && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        Current Connected
                      </span>
                    )}
                  </div>
                </td>

                <td className="py-3.5 px-5 font-mono text-slate-400">
                  {member.address}
                </td>

                <td className="py-3.5 px-5">
                  <div className="flex flex-wrap items-center gap-1">
                    {member.roles.map((r) => (
                      <span
                        key={r}
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                          r === "Admin"
                            ? "bg-red-500/10 text-red-400 border-red-500/30"
                            : r === "Proposer"
                            ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                            : r === "Approver"
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                            : r === "Executor"
                            ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                            : "bg-slate-500/10 text-slate-400 border-slate-500/30"
                        }`}
                      >
                        {r}
                      </span>
                    ))}
                    <span className="text-[10px] font-mono text-slate-500 ml-1">
                      (0x{member.roleMask.toString(16).padStart(2, "0")})
                    </span>
                  </div>
                </td>

                <td className="py-3.5 px-5">
                  <span className="flex items-center space-x-1.5 text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span className="font-medium text-[11px]">Active</span>
                  </span>
                </td>

                <td className="py-3.5 px-5 text-right">
                  {activeWallet.roles.includes("Admin") &&
                    member.id !== activeWallet.id &&
                    members.length > vault.threshold && (
                      <button
                        onClick={() => removeMember(member.id)}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-[11px] font-medium transition"
                        title="Revoke member permissions on-chain"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Remove</span>
                      </button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Member Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-vault-900 border border-vault-800 shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95">
            <h3 className="font-bold text-sm text-white">Add New Vault Member</h3>

            <form onSubmit={handleAddMember} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Member Name / Label</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Finance Multi-sig Key"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-vault-950 border border-vault-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Solana Wallet Address</label>
                <input
                  type="text"
                  required
                  placeholder="Base58 Solana public key"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  className="w-full bg-vault-950 border border-vault-800 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-2">Granted Roles</label>
                <div className="grid grid-cols-2 gap-2">
                  {(["proposer", "approver", "executor", "admin"] as const).map((role) => (
                    <label
                      key={role}
                      className="flex items-center space-x-2 p-2 rounded bg-vault-950 border border-vault-800 cursor-pointer text-slate-300"
                    >
                      <input
                        type="checkbox"
                        checked={selectedRoles[role]}
                        onChange={(e) =>
                          setSelectedRoles({ ...selectedRoles, [role]: e.target.checked })
                        }
                        className="rounded accent-emerald-500"
                      />
                      <span className="capitalize font-medium">{role}</span>
                    </label>
                  ))}
                </div>
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
                  Register Member
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
