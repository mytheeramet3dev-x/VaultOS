import { IndexerDatabase } from "../services/indexer/dist/db.js";
import { Keypair } from "@solana/web3.js";

async function main() {
  console.log("Seeding demo data into VaultOS indexer database...");
  const db = new IndexerDatabase();

  const orgAddress = "0RG11K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ1a";
  const vaultAddress = "9vau1tK7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ9z";
  const authorityPda = "AU7HkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ9z44";

  // 1. Organization
  db.saveOrganization({
    address: orgAddress,
    orgId: "solana-defi-labs",
    name: "Solana DeFi Labs",
    admin: "AL1CE7K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ2k",
    vaultCount: 1,
    createdAt: Math.floor(Date.now() / 1000) - 86400 * 30,
  });

  // 2. Vault
  db.saveVault({
    address: vaultAddress,
    organization: orgAddress,
    vaultIndex: 0,
    name: "Protocol Operations Treasury",
    authorityPda,
    threshold: 2,
    memberCount: 3,
    proposalCount: 3,
    policyCount: 4,
    timelockDelay: 86400,
    isFrozen: false,
    solBalanceLamports: 1450750000000, // 1450.75 SOL
    createdAt: Math.floor(Date.now() / 1000) - 86400 * 30,
  });

  // 3. Members
  db.saveMember({
    vault: vaultAddress,
    wallet: "AL1CE7K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ2k",
    roles: 15, // Admin, Proposer, Approver, Executor
    roleNames: ["Admin", "Proposer", "Approver", "Executor"],
    isActive: true,
    addedAt: Math.floor(Date.now() / 1000) - 86400 * 30,
  });

  db.saveMember({
    vault: vaultAddress,
    wallet: "B0B88K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ3m",
    roles: 4, // Approver
    roleNames: ["Approver"],
    isActive: true,
    addedAt: Math.floor(Date.now() / 1000) - 86400 * 29,
  });

  db.saveMember({
    vault: vaultAddress,
    wallet: "CH4RL1E7K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ4n",
    roles: 12, // Approver, Executor
    roleNames: ["Approver", "Executor"],
    isActive: true,
    addedAt: Math.floor(Date.now() / 1000) - 86400 * 28,
  });

  // 4. Proposals
  db.saveProposal({
    address: "PR0P11K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ01",
    vault: vaultAddress,
    proposalIndex: 1,
    proposer: "AL1CE7K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ2k",
    title: "Q4 High-Performance RPC Infrastructure Grant",
    operationType: "SolTransfer",
    destination: "TR1T0NkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ22",
    amount: 120000000000, // 120 SOL
    mint: null,
    status: "Active",
    approvalCount: 1,
    requiredThreshold: 2,
    timelockDelay: 0,
    createdAt: Math.floor(Date.now() / 1000) - 3600 * 4,
    approvedAt: 0,
    executedAt: 0,
    expiresAt: Math.floor(Date.now() / 1000) + 86400 * 7,
  });

  db.saveProposal({
    address: "PR0P22K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ02",
    vault: vaultAddress,
    proposalIndex: 2,
    proposer: "AL1CE7K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ2k",
    title: "Security Audit Milestone 2 - OtterSec",
    operationType: "TokenTransfer",
    destination: "0TT3R7K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ88",
    amount: 50000000000, // 50,000 USDC
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    status: "Executable",
    approvalCount: 2,
    requiredThreshold: 2,
    timelockDelay: 0,
    createdAt: Math.floor(Date.now() / 1000) - 3600 * 28,
    approvedAt: Math.floor(Date.now() / 1000) - 3600 * 25,
    executedAt: 0,
    expiresAt: Math.floor(Date.now() / 1000) + 86400 * 6,
  });

  db.saveProposal({
    address: "PR0P33K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ03",
    vault: vaultAddress,
    proposalIndex: 3,
    proposer: "B0B88K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ3m",
    title: "Core Contributor Monthly Payroll (October)",
    operationType: "TokenTransfer",
    destination: "P4YR0LLK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ77",
    amount: 35000000000, // 35,000 USDC
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    status: "Executed",
    approvalCount: 2,
    requiredThreshold: 2,
    timelockDelay: 0,
    createdAt: Math.floor(Date.now() / 1000) - 3600 * 72,
    approvedAt: Math.floor(Date.now() / 1000) - 3600 * 70,
    executedAt: Math.floor(Date.now() / 1000) - 3600 * 68,
    expiresAt: Math.floor(Date.now() / 1000) + 86400 * 4,
    txSignature: "5wKzUvG6Y3sJ2qP8rN9eM1tC4bA7dF0xH2jK5mQ8vX1zL9aP3nB6cE8dF2gH4jK6",
  });

  // 5. Policies
  db.savePolicy({
    address: "P0L11K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ11",
    vault: vaultAddress,
    policyIndex: 0,
    policyType: "PerTransactionLimit",
    config: { maxSol: 200, maxUsdc: 50000 },
    isActive: true,
    createdAt: Math.floor(Date.now() / 1000) - 86400 * 30,
  });

  db.savePolicy({
    address: "P0L22K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ22",
    vault: vaultAddress,
    policyIndex: 1,
    policyType: "RollingSpendingLimit",
    config: { windowHours: 24, maxWindowSol: 500, currentSpentSol: 120 },
    isActive: true,
    createdAt: Math.floor(Date.now() / 1000) - 86400 * 30,
  });

  // 6. Audit Events
  db.saveAuditEvent({
    id: "log-1",
    signature: "5wKzUvG6Y3sJ2qP8rN9eM1tC4bA7dF0xH2jK5mQ8vX1zL9aP3nB6cE8dF2gH4jK6",
    vault: vaultAddress,
    eventName: "ProposalExecuted",
    actor: "CH4RL1E7K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ4n",
    blockTime: Math.floor(Date.now() / 1000) - 3600 * 68,
    data: { proposal: "PR0P33K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ03", amount: 35000 },
  });

  console.log("✅ Seed complete! All demo entities stored in SQLite database.");
}

main().catch(console.error);
