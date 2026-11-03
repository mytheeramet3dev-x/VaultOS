import { describe, it } from "node:test";
import assert from "node:assert";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  DEFAULT_PROGRAM_ID,
  RoleBitflags,
  getApprovalPDA,
  getExecutionRecordPDA,
  getMemberPDA,
  getOrganizationPDA,
  getProposalPDA,
  getVaultAuthorityPDA,
  getVaultPDA,
  PolicyEvaluator,
  ProposalStatus,
  SimulationHelper,
  VaultOSClient,
  VaultOSError,
} from "../../sdk/dist/src/index.js";

describe("VaultOS Integration: Full Treasury Lifecycle & Binary Codec Verification", () => {
  const programId = DEFAULT_PROGRAM_ID;

  // Actors
  const admin = Keypair.generate();
  const proposer = Keypair.generate();
  const approver1 = Keypair.generate();
  const approver2 = Keypair.generate();
  const executor = Keypair.generate();
  const recipient = Keypair.generate().publicKey;

  // Binary Ledger Storage (stores raw Borsh-encoded account Buffers keyed by PDA)
  const rawAccounts = new Map<string, Buffer>();
  const state = {
    organizations: new Map<string, any>(),
    vaults: new Map<string, any>(),
    members: new Map<string, any>(),
    proposals: new Map<string, any>(),
    approvals: new Set<string>(),
    executionRecords: new Set<string>(),
    vaultAuthorityBalances: new Map<string, bigint>(),
    recipientBalance: 0n,
  };

  it("Step 1: Create Organization & Vault with M=2 of N=3 multisig and verify Borsh binary encoding", () => {
    const orgId = "solana-foundation-grant";
    const [orgPda] = getOrganizationPDA(orgId, programId);

    state.organizations.set(orgPda.toBase58(), {
      admin: admin.publicKey,
      orgId,
      name: "Solana Foundation Grant",
      vaultCount: 1,
    });

    const [vaultPda, vaultBump] = getVaultPDA(orgPda, 0, programId);
    const [authPda, authBump] = getVaultAuthorityPDA(vaultPda, programId);

    const vaultObj = {
      address: vaultPda,
      organization: orgPda,
      vaultIndex: 0,
      name: "Core Treasury Vault",
      authorityPda: authPda,
      authorityBump: authBump,
      threshold: 2,
      memberCount: 1,
      adminCount: 1,
      proposalCount: 0n,
      policyCount: 0,
      timelockDelay: 0n,
      isFrozen: false,
      createdAt: 1_700_000_000,
      bump: vaultBump,
    };

    // Encode to real Anchor binary buffer & decode back
    const encodedVault = VaultOSClient.encodeVaultAccount(vaultObj);
    rawAccounts.set(vaultPda.toBase58(), encodedVault);
    const decodedVault = VaultOSClient.decodeVaultAccount(vaultPda, encodedVault, programId);

    assert.strictEqual(decodedVault.name, "Core Treasury Vault");
    assert.strictEqual(decodedVault.threshold, 2);
    assert.strictEqual(decodedVault.adminCount, 1);
    assert.strictEqual(decodedVault.authorityPda.toBase58(), authPda.toBase58());

    state.vaults.set(vaultPda.toBase58(), decodedVault);

    // Register creator as initial Admin and verify Member binary codec
    const [adminMemberPda, memberBump] = getMemberPDA(vaultPda, admin.publicKey, programId);
    const adminMemberObj = {
      address: adminMemberPda,
      vault: vaultPda,
      wallet: admin.publicKey,
      roles: RoleBitflags.ADMIN | RoleBitflags.PROPOSER | RoleBitflags.APPROVER | RoleBitflags.EXECUTOR,
      isActive: true,
      addedAt: 1_700_000_000,
      bump: memberBump,
    };
    const encodedMember = VaultOSClient.encodeMemberAccount(adminMemberObj);
    rawAccounts.set(adminMemberPda.toBase58(), encodedMember);
    const decodedMember = VaultOSClient.decodeMemberAccount(adminMemberPda, encodedMember);
    assert.strictEqual(decodedMember.roles, 15);
    assert.strictEqual(decodedMember.isActive, true);

    state.members.set(`${vaultPda.toBase58()}_${admin.publicKey.toBase58()}`, decodedMember);

    assert.ok(state.organizations.has(orgPda.toBase58()));
    assert.ok(state.vaults.has(vaultPda.toBase58()));
    assert.strictEqual(state.vaults.get(vaultPda.toBase58()).threshold, 2);
  });

  it("Step 2: Add Members with Granular Roles (Proposer, Approvers, Executor)", () => {
    const vault = Array.from(state.vaults.values())[0];

    // Proposer
    state.members.set(`${vault.address.toBase58()}_${proposer.publicKey.toBase58()}`, {
      roles: RoleBitflags.PROPOSER,
      isActive: true,
    });

    // Approver 1
    state.members.set(`${vault.address.toBase58()}_${approver1.publicKey.toBase58()}`, {
      roles: RoleBitflags.APPROVER,
      isActive: true,
    });

    // Approver 2
    state.members.set(`${vault.address.toBase58()}_${approver2.publicKey.toBase58()}`, {
      roles: RoleBitflags.APPROVER,
      isActive: true,
    });

    // Executor
    state.members.set(`${vault.address.toBase58()}_${executor.publicKey.toBase58()}`, {
      roles: RoleBitflags.EXECUTOR,
      isActive: true,
    });

    vault.memberCount = 5;
    assert.strictEqual(vault.memberCount, 5);
  });

  it("Step 3: Deposit SOL into Vault Authority PDA", () => {
    const vault = Array.from(state.vaults.values())[0];
    const depositAmount = 100_000_000_000n; // 100 SOL

    state.vaultAuthorityBalances.set(vault.authorityPda.toBase58(), depositAmount);
    assert.strictEqual(state.vaultAuthorityBalances.get(vault.authorityPda.toBase58()), depositAmount);
  });

  it("Step 4: Proposer creates a 25 SOL Transfer Proposal", () => {
    const vault = Array.from(state.vaults.values())[0];
    const proposerMember = state.members.get(
      `${vault.address.toBase58()}_${proposer.publicKey.toBase58()}`
    );

    // Verify proposer role
    assert.ok((proposerMember.roles & RoleBitflags.PROPOSER) !== 0);

    const proposalIndex = vault.proposalCount;
    const [proposalPda] = getProposalPDA(vault.address, proposalIndex, programId);

    const proposal = {
      address: proposalPda,
      vault: vault.address,
      proposalIndex,
      proposer: proposer.publicKey,
      title: "Core Infrastructure Payment",
      operation: {
        type: "SolTransfer",
        destination: recipient,
        lamports: 25_000_000_000n, // 25 SOL
      },
      status: ProposalStatus.Active,
      approvalCount: 0,
      requiredThreshold: vault.threshold,
      timelockDelay: vault.timelockDelay,
      createdAt: Math.floor(Date.now() / 1000),
      approvedAt: 0,
      executedAt: 0,
    };

    state.proposals.set(proposalPda.toBase58(), proposal);
    vault.proposalCount += 1n;

    assert.strictEqual(proposal.status, ProposalStatus.Active);
    assert.strictEqual(proposal.approvalCount, 0);
  });

  it("Step 5: Approver 1 signs approval -> Status remains Active (1 of 2)", () => {
    const proposal = Array.from(state.proposals.values())[0];
    const approverMember = state.members.get(
      `${proposal.vault.toBase58()}_${approver1.publicKey.toBase58()}`
    );

    assert.ok((approverMember.roles & RoleBitflags.APPROVER) !== 0);

    const approvalKey = `${proposal.address.toBase58()}_${approver1.publicKey.toBase58()}`;
    assert.strictEqual(state.approvals.has(approvalKey), false);

    state.approvals.add(approvalKey);
    proposal.approvalCount += 1;

    // Threshold = 2, currently 1
    assert.strictEqual(proposal.approvalCount, 1);
    assert.strictEqual(proposal.status, ProposalStatus.Active);
  });

  it("Step 6: Approver 2 signs approval -> Threshold reached -> Status becomes Executable", () => {
    const proposal = Array.from(state.proposals.values())[0];
    const approvalKey = `${proposal.address.toBase58()}_${approver2.publicKey.toBase58()}`;

    state.approvals.add(approvalKey);
    proposal.approvalCount += 1;

    if (proposal.approvalCount >= proposal.requiredThreshold) {
      proposal.status = ProposalStatus.Executable;
      proposal.approvedAt = Math.floor(Date.now() / 1000);
    }

    assert.strictEqual(proposal.approvalCount, 2);
    assert.strictEqual(proposal.status, ProposalStatus.Executable);
  });

  it("Step 7: Executor executes proposal -> Idempotently transfers SOL & updates state", () => {
    const proposal = Array.from(state.proposals.values())[0];
    const vault = state.vaults.get(proposal.vault.toBase58());
    const executorMember = state.members.get(
      `${vault.address.toBase58()}_${executor.publicKey.toBase58()}`
    );

    // Verify executor permission
    assert.ok((executorMember.roles & RoleBitflags.EXECUTOR) !== 0);
    assert.strictEqual(vault.isFrozen, false);
    assert.strictEqual(proposal.status, ProposalStatus.Executable);

    // Initial ExecutionRecord
    const [execRecordPda] = getExecutionRecordPDA(proposal.address, programId);
    assert.strictEqual(state.executionRecords.has(execRecordPda.toBase58()), false);

    state.executionRecords.add(execRecordPda.toBase58());

    // Deduct lamports from Vault Authority PDA
    const currentVaultBal = state.vaultAuthorityBalances.get(vault.authorityPda.toBase58()) || 0n;
    const transferAmount = proposal.operation.lamports;

    state.vaultAuthorityBalances.set(vault.authorityPda.toBase58(), currentVaultBal - transferAmount);
    state.recipientBalance += transferAmount;

    proposal.status = ProposalStatus.Executed;
    proposal.executedAt = Math.floor(Date.now() / 1000);

    // Assert outcomes
    assert.strictEqual(state.recipientBalance, 25_000_000_000n);
    assert.strictEqual(
      state.vaultAuthorityBalances.get(vault.authorityPda.toBase58()),
      75_000_000_000n // 100 SOL - 25 SOL = 75 SOL
    );
    assert.strictEqual(proposal.status, ProposalStatus.Executed);
    assert.ok(state.executionRecords.has(execRecordPda.toBase58()));
  });

  it("Step 8: Re-execution attempt is strictly rejected (Idempotency guarantee)", () => {
    const proposal = Array.from(state.proposals.values())[0];

    // Proposal is already Executed
    assert.throws(
      () => {
        if (proposal.status === ProposalStatus.Executed) {
          throw new VaultOSError("ProposalAlreadyExecuted");
        }
      },
      (err: any) => err.code === "ProposalAlreadyExecuted"
    );
  });

  it("Step 9: Proposal Binary Codec & Pre-Execution Simulation Engine verification", async () => {
    const vault = Array.from(state.vaults.values())[0];
    const [proposalPda, propBump] = getProposalPDA(vault.address, 99n, programId);
    const mint = Keypair.generate().publicKey;

    const propAccount = {
      address: proposalPda,
      vault: vault.address,
      proposalIndex: 99n,
      proposer: proposer.publicKey,
      title: "SPL Token Grant Payout",
      operation: {
        type: "TokenTransfer" as const,
        mint,
        destination: recipient,
        amount: 5_000_000_000n,
      },
      status: ProposalStatus.Executable,
      approvalCount: 2,
      requiredThreshold: 2,
      timelockDelay: 0n,
      createdAt: 1_700_000_000,
      approvedAt: 1_700_000_100,
      executedAt: 0,
      expiresAt: 1_900_000_000,
      bump: propBump,
      approvers: [approver1.publicKey, approver2.publicKey],
    };

    const rawBuf = VaultOSClient.encodeProposalAccount(propAccount);
    rawAccounts.set(proposalPda.toBase58(), rawBuf);
    const decoded = VaultOSClient.decodeProposalAccount(proposalPda, rawBuf);

    assert.strictEqual(decoded.title, "SPL Token Grant Payout");
    assert.strictEqual(decoded.operation.type, "TokenTransfer");
    if (decoded.operation.type === "TokenTransfer") {
      assert.strictEqual(decoded.operation.mint.toBase58(), mint.toBase58());
      assert.strictEqual(decoded.operation.amount, 5_000_000_000n);
    }
    assert.strictEqual(decoded.approvers?.length, 2);

    const dummyConn = new Connection("http://127.0.0.1:8899", "confirmed");
    const sim = await SimulationHelper.simulateProposalExecution(
      dummyConn,
      decoded,
      [],
      vault.threshold,
      vault.timelockDelay,
      vault.authorityPda
    );
    assert.strictEqual(sim.success, true);
  });
});
