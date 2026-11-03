"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useWallet, DEMO_WALLETS, DemoWallet } from "./WalletContext";

export interface TreasuryVault {
  address: string;
  name: string;
  orgName: string;
  authorityPda: string;
  threshold: number; // M
  memberCount: number; // N
  timelockDelaySeconds: number;
  isFrozen: boolean;
  solBalance: number;
  tokens: {
    symbol: string;
    mint: string;
    balance: number;
    priceUsd: number;
    logo?: string;
  }[];
}

export interface ProposalItem {
  id: string;
  proposalIndex: number;
  title: string;
  proposer: string;
  proposerName: string;
  operationType: "SolTransfer" | "TokenTransfer" | "ChangeThreshold" | "EmergencyFreeze";
  destination: string;
  amount: number;
  symbol: string;
  status: "Active" | "Approved" | "Executable" | "Executed" | "Cancelled";
  approvals: string[]; // wallet addresses who approved
  requiredThreshold: number;
  timelockDelay: number;
  createdAt: number;
  approvedAt?: number;
  executedAt?: number;
  txSignature?: string;
}

export interface PolicyItem {
  id: string;
  type: "PerTransactionLimit" | "RollingSpendingLimit" | "DestinationAllowlist" | "ApprovalEscalation";
  title: string;
  description: string;
  isActive: boolean;
  details: Record<string, any>;
}

export interface AuditLogItem {
  id: string;
  signature: string;
  eventName: string;
  actor: string;
  actorName: string;
  timestamp: number;
  details: string;
}

interface TreasuryContextType {
  vault: TreasuryVault;
  members: DemoWallet[];
  proposals: ProposalItem[];
  policies: PolicyItem[];
  auditLogs: AuditLogItem[];
  createProposal: (data: Partial<ProposalItem>) => void;
  approveProposal: (proposalId: string) => void;
  revokeApproval: (proposalId: string) => void;
  executeProposal: (proposalId: string) => void;
  cancelProposal: (proposalId: string) => void;
  freezeVault: () => void;
  unfreezeVault: () => void;
  deposit: (amount: number, symbol: string) => void;
  addMember: (address: string, name: string, roles: number) => void;
  removeMember: (memberId: string) => void;
  createPolicy: (policy: Partial<PolicyItem>) => void;
}

const INITIAL_VAULT: TreasuryVault = {
  address: "9vau1tK7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ9z",
  name: "Protocol Operations Treasury",
  orgName: "Solana DeFi Labs",
  authorityPda: "AU7HkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ9z44",
  threshold: 2,
  memberCount: 3,
  timelockDelaySeconds: 86400, // 24 hours
  isFrozen: false,
  solBalance: 1450.75,
  tokens: [
    {
      symbol: "SOL",
      mint: "So11111111111111111111111111111111111111112",
      balance: 1450.75,
      priceUsd: 154.2,
    },
    {
      symbol: "USDC",
      mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      balance: 250000.0,
      priceUsd: 1.0,
    },
    {
      symbol: "PYTH",
      mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
      balance: 65400.0,
      priceUsd: 0.38,
    },
  ],
};

const INITIAL_PROPOSALS: ProposalItem[] = [
  {
    id: "prop-1",
    proposalIndex: 1,
    title: "Q4 High-Performance RPC Infrastructure Grant",
    proposer: "AL1CE7K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ2k",
    proposerName: "Alice",
    operationType: "SolTransfer",
    destination: "TR1T0NkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ22",
    amount: 120.0,
    symbol: "SOL",
    status: "Active",
    approvals: ["AL1CE7K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ2k"],
    requiredThreshold: 2,
    timelockDelay: 0,
    createdAt: Date.now() - 3600 * 1000 * 4,
  },
  {
    id: "prop-2",
    proposalIndex: 2,
    title: "Security Audit Milestone 2 - OtterSec",
    proposer: "AL1CE7K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ2k",
    proposerName: "Alice",
    operationType: "TokenTransfer",
    destination: "0TT3R7K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ88",
    amount: 50000.0,
    symbol: "USDC",
    status: "Executable",
    approvals: [
      "AL1CE7K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ2k",
      "B0B88K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ3m",
    ],
    requiredThreshold: 2,
    timelockDelay: 0,
    createdAt: Date.now() - 3600 * 1000 * 28,
    approvedAt: Date.now() - 3600 * 1000 * 25,
  },
  {
    id: "prop-3",
    proposalIndex: 3,
    title: "Core Contributor Monthly Payroll (October)",
    proposer: "B0B88K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ3m",
    proposerName: "Bob",
    operationType: "TokenTransfer",
    destination: "P4YR0LLK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ77",
    amount: 35000.0,
    symbol: "USDC",
    status: "Executed",
    approvals: [
      "AL1CE7K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ2k",
      "CH4RL1E7K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ4n",
    ],
    requiredThreshold: 2,
    timelockDelay: 0,
    createdAt: Date.now() - 3600 * 1000 * 72,
    approvedAt: Date.now() - 3600 * 1000 * 70,
    executedAt: Date.now() - 3600 * 1000 * 68,
    txSignature: "5wKzUvG6Y3sJ2qP8rN9eM1tC4bA7dF0xH2jK5mQ8vX1zL9aP3nB6cE8dF2gH4jK6",
  },
];

const INITIAL_POLICIES: PolicyItem[] = [
  {
    id: "pol-1",
    type: "PerTransactionLimit",
    title: "Per-Transaction Spending Cap",
    description: "Limits single transfer volume to maximum 200 SOL or 50,000 USDC",
    isActive: true,
    details: { maxSol: 200, maxUsdc: 50000 },
  },
  {
    id: "pol-2",
    type: "RollingSpendingLimit",
    title: "24-Hour Rolling Budget",
    description: "Caps cumulative outflows to 500 SOL / 100,000 USDC per 24 hours",
    isActive: true,
    details: { windowHours: 24, maxWindowSol: 500, currentSpentSol: 120 },
  },
  {
    id: "pol-3",
    type: "DestinationAllowlist",
    title: "Institutional Destination Allowlist",
    description: "Enforces that outgoing transfers match pre-verified partner wallets",
    isActive: true,
    details: { allowedCount: 4, strictMode: true },
  },
  {
    id: "pol-4",
    type: "ApprovalEscalation",
    title: "High-Value Escalation Tier",
    description: "Transfers > 300 SOL require 3 approvals and 48-hour timelock delay",
    isActive: true,
    details: { tierThresholdSol: 300, requiredApprovals: 3, timelockHours: 48 },
  },
];

const INITIAL_AUDIT_LOGS: AuditLogItem[] = [
  {
    id: "log-1",
    signature: "5wKzUvG6Y3sJ2qP8rN9eM1tC4bA7dF0xH2jK5mQ8vX1zL9aP3nB6cE8dF2gH4jK6",
    eventName: "ProposalExecuted",
    actor: "CH4RL1E7K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ4n",
    actorName: "Charlie",
    timestamp: Date.now() - 3600 * 1000 * 68,
    details: "Executed Proposal #3: 35,000 USDC transfer to Payroll PDA",
  },
  {
    id: "log-2",
    signature: "4aMzKvG6Y3sJ2qP8rN9eM1tC4bA7dF0xH2jK5mQ8vX1zL9aP3nB6cE8dF2gH4jK5",
    eventName: "ProposalApproved",
    actor: "B0B88K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ3m",
    actorName: "Bob",
    timestamp: Date.now() - 3600 * 1000 * 25,
    details: "Approved Proposal #2: Milestone reached threshold (2/2)",
  },
  {
    id: "log-3",
    signature: "3xPzKvG6Y3sJ2qP8rN9eM1tC4bA7dF0xH2jK5mQ8vX1zL9aP3nB6cE8dF2gH4jK4",
    eventName: "ProposalCreated",
    actor: "AL1CE7K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ2k",
    actorName: "Alice",
    timestamp: Date.now() - 3600 * 1000 * 4,
    details: "Created Proposal #1: Q4 High-Performance RPC Infrastructure Grant",
  },
  {
    id: "log-4",
    signature: "2qRzKvG6Y3sJ2qP8rN9eM1tC4bA7dF0xH2jK5mQ8vX1zL9aP3nB6cE8dF2gH4jK3",
    eventName: "DepositReceived",
    actor: "AL1CE7K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ2k",
    actorName: "Alice",
    timestamp: Date.now() - 3600 * 1000 * 96,
    details: "Deposited 500.0 SOL into Vault Authority PDA",
  },
];

const TreasuryContext = createContext<TreasuryContextType | undefined>(undefined);

export function TreasuryProvider({ children }: { children: React.ReactNode }) {
  const { activeWallet } = useWallet();
  const [vault, setVault] = useState<TreasuryVault>(INITIAL_VAULT);
  const [members, setMembers] = useState<DemoWallet[]>(DEMO_WALLETS);
  const [proposals, setProposals] = useState<ProposalItem[]>(INITIAL_PROPOSALS);
  const [policies, setPolicies] = useState<PolicyItem[]>(INITIAL_POLICIES);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>(INITIAL_AUDIT_LOGS);

  const indexerBaseUrl =
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_INDEXER_URL
      ? process.env.NEXT_PUBLIC_INDEXER_URL
      : "http://localhost:4000";

  // Synchronize with Indexer API if reachable, falling back to interactive state when offline
  useEffect(() => {
    let cancelled = false;
    async function syncFromIndexer() {
      try {
        const res = await fetch(`${indexerBaseUrl}/api/vaults/${INITIAL_VAULT.address}`);
        if (!res.ok || cancelled) return;
        const indexedVault = await res.json();
        if (indexedVault && indexedVault.address && !cancelled) {
          setVault((prev) => ({
            ...prev,
            name: indexedVault.name || prev.name,
            threshold: indexedVault.threshold || prev.threshold,
            memberCount: indexedVault.memberCount || prev.memberCount,
            isFrozen: Boolean(indexedVault.isFrozen),
            solBalance:
              typeof indexedVault.solBalanceLamports === "number"
                ? indexedVault.solBalanceLamports / 1e9
                : prev.solBalance,
          }));
        }
      } catch {
        // Offline / local simulation mode fallback
      }
    }
    syncFromIndexer();
    return () => {
      cancelled = true;
    };
  }, [indexerBaseUrl]);

  const addAuditLog = (eventName: string, details: string) => {
    const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let sig = "";
    for (let i = 0; i < 64; i++) {
      sig += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const newLog: AuditLogItem = {
      id: `log-${Date.now()}`,
      signature: sig,
      eventName,
      actor: activeWallet.address,
      actorName: activeWallet.name,
      timestamp: Date.now(),
      details,
    };
    setAuditLogs((prev) => [newLog, ...prev]);
  };

  const createProposal = (data: Partial<ProposalItem>) => {
    const newId = `prop-${Date.now()}`;
    const amt = data.amount || 10;
    const sym = data.symbol || "SOL";
    const isEscalated = sym === "SOL" && amt >= 300;
    const newProposal: ProposalItem = {
      id: newId,
      proposalIndex: proposals.length + 1,
      title: data.title || "Treasury Operation",
      proposer: activeWallet.address,
      proposerName: activeWallet.name,
      operationType: data.operationType || "SolTransfer",
      destination: data.destination || "TR1T0NkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ22",
      amount: amt,
      symbol: sym,
      status: "Active",
      approvals: [activeWallet.address], // Creator automatically approves
      requiredThreshold: isEscalated ? Math.max(vault.threshold, 3) : vault.threshold,
      timelockDelay: isEscalated ? 48 * 3600 : 0,
      createdAt: Date.now(),
    };

    setProposals([newProposal, ...proposals]);
    addAuditLog(
      "ProposalCreated",
      `Created Proposal #${newProposal.proposalIndex}: ${newProposal.title} (${newProposal.amount} ${newProposal.symbol})`
    );
  };

  const approveProposal = (proposalId: string) => {
    setProposals((prev) =>
      prev.map((p) => {
        if (p.id !== proposalId) return p;
        if (p.approvals.includes(activeWallet.address)) return p;

        const newApprovals = [...p.approvals, activeWallet.address];
        const isThresholdReached = newApprovals.length >= p.requiredThreshold;
        return {
          ...p,
          approvals: newApprovals,
          status: isThresholdReached ? "Executable" : "Active",
          approvedAt: isThresholdReached ? Date.now() : p.approvedAt,
        };
      })
    );
    addAuditLog("ProposalApproved", `Approved Proposal ${proposalId} by ${activeWallet.name}`);
  };

  const revokeApproval = (proposalId: string) => {
    setProposals((prev) =>
      prev.map((p) => {
        if (p.id !== proposalId) return p;
        const newApprovals = p.approvals.filter((a) => a !== activeWallet.address);
        return {
          ...p,
          approvals: newApprovals,
          status: "Active",
        };
      })
    );
    addAuditLog("ProposalApprovalRevoked", `Revoked approval for Proposal ${proposalId} by ${activeWallet.name}`);
  };

  const executeProposal = (proposalId: string) => {
    const target = proposals.find((p) => p.id === proposalId);
    if (!target) return;

    // Deduct balance
    if (target.symbol === "SOL") {
      setVault((v) => ({ ...v, solBalance: Math.max(0, v.solBalance - target.amount) }));
    } else {
      setVault((v) => ({
        ...v,
        tokens: v.tokens.map((t) =>
          t.symbol === target.symbol ? { ...t, balance: Math.max(0, t.balance - target.amount) } : t
        ),
      }));
    }

    setProposals((prev) =>
      prev.map((p) =>
        p.id === proposalId
          ? {
              ...p,
              status: "Executed",
              executedAt: Date.now(),
            }
          : p
      )
    );
    addAuditLog(
      "ProposalExecuted",
      `Executed Proposal #${target.proposalIndex}: Transferred ${target.amount} ${target.symbol} to ${target.destination.slice(0, 8)}...`
    );
  };

  const cancelProposal = (proposalId: string) => {
    setProposals((prev) =>
      prev.map((p) => (p.id === proposalId ? { ...p, status: "Cancelled" } : p))
    );
    addAuditLog("ProposalCancelled", `Cancelled Proposal ${proposalId} by ${activeWallet.name}`);
  };

  const freezeVault = () => {
    setVault((v) => ({ ...v, isFrozen: true }));
    addAuditLog("VaultFrozen", `Emergency Freeze activated by ${activeWallet.name}`);
  };

  const unfreezeVault = () => {
    setVault((v) => ({ ...v, isFrozen: false }));
    addAuditLog("VaultUnfrozen", `Emergency Freeze lifted by ${activeWallet.name}`);
  };

  const deposit = (amount: number, symbol: string) => {
    if (symbol === "SOL") {
      setVault((v) => ({ ...v, solBalance: v.solBalance + amount }));
    } else {
      setVault((v) => ({
        ...v,
        tokens: v.tokens.map((t) =>
          t.symbol === symbol ? { ...t, balance: t.balance + amount } : t
        ),
      }));
    }
    addAuditLog("DepositReceived", `Deposited ${amount} ${symbol} into Vault Authority PDA`);
  };

  const addMember = (address: string, name: string, roles: number) => {
    const roleList: string[] = [];
    if (roles & 1) roleList.push("Admin");
    if (roles & 2) roleList.push("Proposer");
    if (roles & 4) roleList.push("Approver");
    if (roles & 8) roleList.push("Executor");
    if (roleList.length === 0) roleList.push("Viewer");

    const newMember: DemoWallet = {
      id: `member-${Date.now()}`,
      name,
      address,
      roles: roleList,
      roleMask: roles,
    };

    setMembers((prev) => [...prev, newMember]);
    setVault((v) => ({ ...v, memberCount: v.memberCount + 1 }));
    addAuditLog("MemberAdded", `Added new member: ${name} (${address.slice(0, 8)}...)`);
  };

  const removeMember = (memberId: string) => {
    const target = members.find((m) => m.id === memberId);
    if (!target || members.length <= vault.threshold) return;
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
    setVault((v) => ({ ...v, memberCount: Math.max(v.threshold, v.memberCount - 1) }));
    addAuditLog("MemberRemoved", `Removed member: ${target.name} (${target.address.slice(0, 8)}...)`);
  };

  const createPolicy = (policy: Partial<PolicyItem>) => {
    const pType = policy.type || "PerTransactionLimit";
    const defaultDetails: Record<string, any> =
      pType === "PerTransactionLimit"
        ? { maxSol: 200, maxUsdc: 50000 }
        : pType === "RollingSpendingLimit"
        ? { windowHours: 24, maxWindowSol: 500, currentSpentSol: 0 }
        : pType === "DestinationAllowlist"
        ? { allowedCount: 4, strictMode: true }
        : { tierThresholdSol: 300, requiredApprovals: 3, timelockHours: 48 };

    const newPolicy: PolicyItem = {
      id: `pol-${Date.now()}`,
      type: pType,
      title: policy.title || "Custom Policy",
      description: policy.description || "Policy restriction rule",
      isActive: true,
      details: { ...defaultDetails, ...(policy.details || {}) },
    };
    setPolicies([newPolicy, ...policies]);
    addAuditLog("PolicyCreated", `Created programmable policy: ${newPolicy.title}`);
  };

  return (
    <TreasuryContext.Provider
      value={{
        vault,
        members,
        proposals,
        policies,
        auditLogs,
        createProposal,
        approveProposal,
        revokeApproval,
        executeProposal,
        cancelProposal,
        freezeVault,
        unfreezeVault,
        deposit,
        addMember,
        removeMember,
        createPolicy,
      }}
    >
      {children}
    </TreasuryContext.Provider>
  );
}

export function useTreasury() {
  const context = useContext(TreasuryContext);
  if (!context) {
    throw new Error("useTreasury must be used within a TreasuryProvider");
  }
  return context;
}
