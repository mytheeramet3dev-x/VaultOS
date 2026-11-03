export interface IndexedOrganization {
  address: string;
  orgId: string;
  name: string;
  admin: string;
  vaultCount: number;
  createdAt: number;
}

export interface IndexedVault {
  address: string;
  organization: string;
  vaultIndex: number;
  name: string;
  authorityPda: string;
  threshold: number;
  memberCount: number;
  proposalCount: number;
  policyCount: number;
  timelockDelay: number;
  isFrozen: boolean;
  solBalanceLamports: number;
  createdAt: number;
}

export interface IndexedMember {
  vault: string;
  wallet: string;
  roles: number;
  roleNames: string[];
  isActive: boolean;
  addedAt: number;
}

export interface IndexedProposal {
  address: string;
  vault: string;
  proposalIndex: number;
  proposer: string;
  title: string;
  operationType: string;
  destination: string;
  amount: number;
  mint: string | null;
  status: "Draft" | "Active" | "Approved" | "Executable" | "Executed" | "Cancelled" | "Expired";
  approvalCount: number;
  requiredThreshold: number;
  timelockDelay: number;
  createdAt: number;
  approvedAt: number;
  executedAt: number;
  expiresAt: number;
  txSignature?: string;
}

export interface IndexedApproval {
  proposal: string;
  member: string;
  approvedAt: number;
  txSignature: string;
}

export interface IndexedPolicy {
  address: string;
  vault: string;
  policyIndex: number;
  policyType: string;
  config: Record<string, any>;
  isActive: boolean;
  createdAt: number;
}

export interface IndexedAuditEvent {
  id: string;
  signature: string;
  vault: string;
  eventName: string;
  actor: string;
  blockTime: number;
  data: Record<string, any>;
}

export interface VaultAnalytics {
  vaultAddress: string;
  totalVolumeLamports: number;
  totalProposals: number;
  executedProposals: number;
  activeProposals: number;
  cancelledProposals: number;
  memberCount: number;
  policyCount: number;
  approvalRatePercentage: number;
}
