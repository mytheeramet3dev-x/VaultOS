import { PublicKey } from "@solana/web3.js";

export enum RoleBitflags {
  ADMIN = 1 << 0,     // 1
  PROPOSER = 1 << 1,  // 2
  APPROVER = 1 << 2,  // 4
  EXECUTOR = 1 << 3,  // 8
  GUARDIAN = 1 << 4,  // 16
}

export enum ProposalStatus {
  Draft = 0,
  Active = 1,
  Approved = 2,
  Executable = 3,
  Executed = 4,
  Cancelled = 5,
  Expired = 6,
}

export type ProposalOperation =
  | { type: "SolTransfer"; destination: PublicKey; lamports: bigint }
  | { type: "TokenTransfer"; mint: PublicKey; destination: PublicKey; amount: bigint }
  | { type: "AddMember"; wallet: PublicKey; roles: number }
  | { type: "RemoveMember"; wallet: PublicKey }
  | { type: "ChangeThreshold"; newThreshold: number }
  | { type: "SetTimelock"; delaySeconds: bigint }
  | { type: "SetFrozen"; frozen: boolean }
  | { type: "CpiCall"; programId: PublicKey; instructionData: Buffer };

export type PolicyConfig =
  | { type: "PerTransactionLimit"; mint: PublicKey | null; maxAmount: bigint }
  | {
      type: "RollingSpendingLimit";
      mint: PublicKey | null;
      maxAmountWindow: bigint;
      windowSeconds: bigint;
      currentWindowStart: bigint;
      currentSpent: bigint;
    }
  | { type: "DestinationAllowlist"; destinations: PublicKey[] }
  | { type: "AssetAllowlist"; allowedMints: PublicKey[] }
  | { type: "ProgramAllowlist"; allowedPrograms: PublicKey[] }
  | {
      type: "ApprovalEscalation";
      tierAmount: bigint;
      extraApprovals: number;
      extraTimelock: bigint;
    };

export interface OrganizationAccount {
  address: PublicKey;
  admin: PublicKey;
  orgId: string;
  name: string;
  vaultCount: number;
  createdAt: number;
  bump: number;
}

export interface VaultAccount {
  address: PublicKey;
  organization: PublicKey;
  vaultIndex: number;
  name: string;
  authorityPda: PublicKey;
  authorityBump: number;
  threshold: number;
  memberCount: number;
  adminCount?: number;
  proposalCount: bigint;
  policyCount: number;
  timelockDelay: bigint;
  isFrozen: boolean;
  createdAt: number;
  bump: number;
  executedProposalCount?: bigint;
  configRevision?: number;
  accountVersion?: number;
  approverCount?: number;
  executorCount?: number;
}

export interface MemberAccount {
  address: PublicKey;
  vault: PublicKey;
  wallet: PublicKey;
  roles: number;
  isActive: boolean;
  addedAt: number;
  bump: number;
  configRevisionAtJoin?: number;
}

export interface ProposalAccount {
  address: PublicKey;
  vault: PublicKey;
  proposalIndex: bigint;
  proposer: PublicKey;
  title: string;
  operation: ProposalOperation;
  status: ProposalStatus;
  approvalCount: number;
  requiredThreshold: number;
  timelockDelay: bigint;
  createdAt: number;
  approvedAt: number;
  executedAt: number;
  expiresAt: number;
  bump: number;
  approvers?: PublicKey[];
  vaultRevision?: number;
}

export interface ApprovalAccount {
  address: PublicKey;
  proposal: PublicKey;
  member: PublicKey;
  approvedAt: number;
  bump: number;
  proposalRevision?: number;
}

export interface PolicyAccount {
  address: PublicKey;
  vault: PublicKey;
  policyIndex: number;
  config: PolicyConfig;
  isActive: boolean;
  createdAt: number;
  bump: number;
}

export interface ExecutionRecordAccount {
  address: PublicKey;
  proposal: PublicKey;
  executor: PublicKey;
  executedAt: number;
  outcome: number;
  bump: number;
}

export interface AuditEvent {
  signature: string;
  blockTime: number;
  eventName: string;
  vault: string;
  actor: string;
  data: Record<string, any>;
}
