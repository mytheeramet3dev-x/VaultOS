import { describe, it } from "node:test";
import assert from "node:assert";
import { Connection, Keypair } from "@solana/web3.js";
import {
  DEFAULT_PROGRAM_ID,
  RoleBitflags,
  getOrganizationPDA,
  getVaultPDA,
  getVaultAuthorityPDA,
  getProposalPDA,
  PolicyEvaluator,
  SimulationHelper,
} from "../../sdk/dist/src/index.js";
import { IndexerDatabase } from "../../services/indexer/dist/db.js";
import { VaultOSIndexer } from "../../services/indexer/dist/indexer.js";

describe("VaultOS End-to-End & Property Fuzz Suite (SDK -> Program -> Indexer -> Audit)", () => {
  const programId = DEFAULT_PROGRAM_ID;
  const db = new IndexerDatabase(":memory:");
  const dummyConnection = new Connection("http://127.0.0.1:8899", "confirmed");
  const indexer = new VaultOSIndexer(dummyConnection, db, programId);

  const admin = Keypair.generate().publicKey;
  const approver2 = Keypair.generate().publicKey;
  const executor = Keypair.generate().publicKey;
  const destination = Keypair.generate().publicKey;

  const [orgPda] = getOrganizationPDA("e2e-org", programId);
  const [vaultPda] = getVaultPDA(orgPda, 0, programId);
  const [authPda] = getVaultAuthorityPDA(vaultPda, programId);
  const [proposalPda] = getProposalPDA(vaultPda, 0n, programId);

  it("E2E 1: Ingests organization, vault, members, and deposit into SQLite Indexer", () => {
    indexer.ingestEvent(
      "sig_org_1",
      "OrganizationCreated",
      vaultPda.toBase58(),
      admin.toBase58(),
      {
        organization: orgPda.toBase58(),
        orgId: "e2e-org",
        name: "Institutional E2E Org",
      },
      1000
    );

    indexer.ingestEvent(
      "sig_vault_1",
      "VaultCreated",
      vaultPda.toBase58(),
      admin.toBase58(),
      {
        vault: vaultPda.toBase58(),
        organization: orgPda.toBase58(),
        vaultIndex: 0,
        name: "Primary Treasury Vault",
        vaultAuthority: authPda.toBase58(),
        threshold: 2,
        timelockDelay: 0,
      },
      1010
    );

    indexer.ingestEvent(
      "sig_mem_1",
      "MemberAdded",
      vaultPda.toBase58(),
      admin.toBase58(),
      {
        member: admin.toBase58(),
        roles: RoleBitflags.ADMIN | RoleBitflags.PROPOSER | RoleBitflags.APPROVER,
      },
      1015
    );

    indexer.ingestEvent(
      "sig_mem_2",
      "MemberAdded",
      vaultPda.toBase58(),
      admin.toBase58(),
      {
        member: approver2.toBase58(),
        roles: RoleBitflags.APPROVER | RoleBitflags.EXECUTOR,
      },
      1020
    );

    indexer.ingestEvent(
      "sig_dep_1",
      "DepositReceived",
      vaultPda.toBase58(),
      admin.toBase58(),
      {
        amount: 100_000_000_000, // 100 SOL
        mint: null,
      },
      1030
    );

    const indexedVault = db.getVault(vaultPda.toBase58());
    assert.ok(indexedVault);
    assert.strictEqual(indexedVault.solBalanceLamports, 100_000_000_000);
    assert.strictEqual(indexedVault.memberCount, 2);
  });

  it("E2E 2: Pre-Flight SDK Simulation & Proposal Execution Updates Indexer Balances and Analytics", async () => {
    const transferOp = {
      type: "SolTransfer" as const,
      destination,
      lamports: 40_000_000_000n, // 40 SOL
    };

    const mockProposalAccount = {
      address: proposalPda,
      vault: vaultPda,
      proposalIndex: 0n,
      proposer: admin,
      title: "Validator Infrastructure Payment",
      operation: transferOp,
      status: 2, // Executable
      approvalCount: 2,
      requiredThreshold: 2,
      timelockDelay: 0n,
      createdAt: 1050n,
      approvedAt: 1070n,
      executedAt: 0n,
      expiresAt: 100000n,
      bump: 255,
    };

    const sim = await SimulationHelper.simulateProposalExecution(
      dummyConnection,
      mockProposalAccount as any,
      [],
      2,
      0n,
      authPda
    );

    assert.strictEqual(sim.success, true);
    assert.strictEqual(sim.expectedBalanceChanges[0].deltaLamports, -40_000_000_000);

    // Ingest ProposalCreated -> Approved -> Executed
    indexer.ingestEvent(
      "sig_prop_1",
      "ProposalCreated",
      vaultPda.toBase58(),
      admin.toBase58(),
      {
        proposal: proposalPda.toBase58(),
        proposalIndex: 0,
        title: "Validator Infrastructure Payment",
        operationType: "SolTransfer",
        destination: destination.toBase58(),
        amount: 40_000_000_000,
        requiredThreshold: 2,
        timelockDelay: 0,
      },
      1050
    );

    indexer.ingestEvent(
      "sig_app_1",
      "ProposalApproved",
      vaultPda.toBase58(),
      admin.toBase58(),
      {
        proposal: proposalPda.toBase58(),
        currentApprovals: 1,
      },
      1060
    );

    indexer.ingestEvent(
      "sig_app_2",
      "ProposalApproved",
      vaultPda.toBase58(),
      approver2.toBase58(),
      {
        proposal: proposalPda.toBase58(),
        currentApprovals: 2,
      },
      1070
    );

    const readyProp = db.getProposal(proposalPda.toBase58());
    assert.ok(readyProp);
    assert.strictEqual(readyProp.status, "Executable");

    indexer.ingestEvent(
      "sig_exec_1",
      "ProposalExecuted",
      vaultPda.toBase58(),
      executor.toBase58(),
      {
        proposal: proposalPda.toBase58(),
      },
      1080
    );

    const executedProp = db.getProposal(proposalPda.toBase58());
    assert.ok(executedProp);
    assert.strictEqual(executedProp.status, "Executed");

    const updatedVault = db.getVault(vaultPda.toBase58());
    assert.ok(updatedVault);
    assert.strictEqual(updatedVault.solBalanceLamports, 60_000_000_000); // 100 - 40 = 60 SOL

    const analytics = db.getAnalytics(vaultPda.toBase58());
    assert.strictEqual(analytics.executedProposals, 1);
    assert.strictEqual(analytics.totalVolumeLamports, 40_000_000_000);
    assert.strictEqual(analytics.approvalRatePercentage, 100);
  });

  it("E2E 3: Idempotent Indexer Reprocessing Tolerates Duplicate Event Delivery", () => {
    const statsBefore = db.getStats();
    const vaultBefore = db.getVault(vaultPda.toBase58())!;

    // Re-deliver duplicate DepositReceived and ProposalExecuted events
    indexer.ingestEvent(
      "sig_dep_1",
      "DepositReceived",
      vaultPda.toBase58(),
      admin.toBase58(),
      {
        amount: 100_000_000_000,
        mint: null,
      },
      1030
    );

    indexer.ingestEvent(
      "sig_exec_1",
      "ProposalExecuted",
      vaultPda.toBase58(),
      executor.toBase58(),
      {
        proposal: proposalPda.toBase58(),
      },
      1080
    );

    const statsAfter = db.getStats();
    const vaultAfter = db.getVault(vaultPda.toBase58())!;

    assert.strictEqual(statsAfter.eventsCount, statsBefore.eventsCount);
    assert.strictEqual(vaultAfter.solBalanceLamports, vaultBefore.solBalanceLamports);
  });

  it("Property Fuzz 4: Split-Transfer Rolling Window Accounting Never Exceeds Cap Across 200 Randomized Trials", () => {
    const windowCap = 100_000_000_000n; // 100 SOL per 24h
    const windowSeconds = 86400n;
    let currentWindowStart = 1_000_000n;
    let currentSpent = 0n;
    let currentTime = 1_000_000n;

    // Deterministic PRNG (LCG) for reproducible fuzzing
    let seed = 42;
    const nextRand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };

    for (let i = 0; i < 200; i++) {
      // Advance time randomly between 0 and 15,000 seconds
      const timeStep = BigInt(Math.floor(nextRand() * 15000));
      currentTime += timeStep;

      // Random transfer between 1 SOL and 60 SOL
      const transferLamports = BigInt(Math.floor(nextRand() * 60) + 1) * 1_000_000_000n;

      const policy = {
        address: Keypair.generate().publicKey,
        vault: vaultPda,
        policyIndex: 0,
        config: {
          type: "RollingSpendingLimit" as const,
          mint: null,
          maxAmountWindow: windowCap,
          windowSeconds,
          currentWindowStart,
          currentSpent,
        },
        isActive: true,
        createdAt: 1000,
        bump: 255,
      };

      const op = {
        type: "SolTransfer" as const,
        destination,
        lamports: transferLamports,
      };

      const evalRes = PolicyEvaluator.evaluate([policy], op, 2, 0n, currentTime);

      const windowExpired = currentTime - currentWindowStart >= windowSeconds;
      const effectiveSpent = windowExpired ? 0n : currentSpent;

      if (effectiveSpent + transferLamports <= windowCap) {
        assert.strictEqual(evalRes.passed, true, `Trial ${i} should have passed`);
        if (windowExpired) {
          currentWindowStart = currentTime;
          currentSpent = transferLamports;
        } else {
          currentSpent += transferLamports;
        }
      } else {
        assert.strictEqual(evalRes.passed, false, `Trial ${i} should have been rejected`);
      }

      // Invariant: cumulative spend in active window NEVER exceeds windowCap
      assert.ok(
        currentSpent <= windowCap,
        `Invariant violated on trial ${i}: ${currentSpent} > ${windowCap}`
      );
    }
  });

  it("E2E 5: Real Anchor 'Program data: <base64>' Binary Event Log Decoding & Checkpointing", () => {
    const newMember = Keypair.generate().publicKey;
    const disc = VaultOSIndexer.getEventDiscriminator("MemberAdded");
    const tsBuf = Buffer.alloc(8);
    tsBuf.writeBigInt64LE(2000n, 0);

    // Binary layout of MemberAdded: [disc(8), vault(32), member(32), roles(1), timestamp(8)]
    const payload = Buffer.concat([
      disc,
      vaultPda.toBuffer(),
      newMember.toBuffer(),
      Buffer.from([RoleBitflags.PROPOSER | RoleBitflags.EXECUTOR]),
      tsBuf,
    ]);

    const b64Log = `Program data: ${payload.toString("base64")}`;
    indexer.processLogs("sig_binary_log_1", 2000, [
      "Program 8crGeaqgPRAak8pvSf3YZpDovdTwUrCmfag3YdRM1iYw invoke [1]",
      b64Log,
      "Program 8crGeaqgPRAak8pvSf3YZpDovdTwUrCmfag3YdRM1iYw success",
    ]);

    const members = db.getMembers(vaultPda.toBase58());
    const decodedMember = members.find((m) => m.wallet === newMember.toBase58());
    assert.ok(decodedMember, "Binary Anchor MemberAdded event should be decoded and stored");
    assert.strictEqual(decodedMember.roles, RoleBitflags.PROPOSER | RoleBitflags.EXECUTOR);

    // Verify Checkpoint persistence
    db.saveCheckpoint("last_signature", "sig_binary_log_1");
    assert.strictEqual(db.getCheckpoint("last_signature"), "sig_binary_log_1");
  });

  it("E2E 6: Rejects Foreign CPI Log Spoofing (H4) & Supports Multi-Event Same-Transaction Indexing (M6)", () => {
    const spoofedMember = Keypair.generate().publicKey;
    const validMemberA = Keypair.generate().publicKey;
    const validMemberB = Keypair.generate().publicKey;
    const attackerProgramId = Keypair.generate().publicKey.toBase58();

    const disc = VaultOSIndexer.getEventDiscriminator("MemberAdded");
    const tsBuf = Buffer.alloc(8);
    tsBuf.writeBigInt64LE(2100n, 0);

    const makeMemberLog = (wallet: typeof spoofedMember) => {
      const buf = Buffer.concat([
        disc,
        vaultPda.toBuffer(),
        wallet.toBuffer(),
        Buffer.from([RoleBitflags.APPROVER]),
        tsBuf,
      ]);
      return `Program data: ${buf.toString("base64")}`;
    };

    // 1. Foreign program invokes and emits a spoofed Anchor `Program data:` log for VaultOS -> MUST be ignored!
    // 2. VaultOS emits TWO valid MemberAdded events in the same transaction -> BOTH must be indexed (M6)!
    indexer.processLogs("sig_cpi_spoof_and_multi_1", 2100, [
      `Program ${attackerProgramId} invoke [1]`,
      makeMemberLog(spoofedMember),
      `Program ${attackerProgramId} success`,
      `Program ${programId.toBase58()} invoke [1]`,
      makeMemberLog(validMemberA),
      `Program ${attackerProgramId} invoke [2]`,
      makeMemberLog(spoofedMember),
      `Program ${attackerProgramId} success`,
      makeMemberLog(validMemberB),
      `Program ${programId.toBase58()} success`,
    ]);

    const members = db.getMembers(vaultPda.toBase58());
    assert.strictEqual(
      members.some((m) => m.wallet === spoofedMember.toBase58()),
      false,
      "Spoofed Anchor event from foreign CPI program must be rejected"
    );
    assert.strictEqual(
      members.some((m) => m.wallet === validMemberA.toBase58()),
      true,
      "First valid VaultOS event in transaction must be indexed"
    );
    assert.strictEqual(
      members.some((m) => m.wallet === validMemberB.toBase58()),
      true,
      "Second valid VaultOS event of same type in same transaction must not collide"
    );
  });

  it("E2E 7: Full Binary Borsh Log Decoding for ProposalCreated, ProposalApprovalRevoked, ProposalCancelled, VaultFrozen, VaultUnfrozen, MemberRolesUpdated & MemberRemoved", () => {
    const prop2Pda = Keypair.generate().publicKey;
    const memberTarget = Keypair.generate().publicKey;
    const titleStr = "Emergency Liquidity Rebalance";
    const titleBytes = Buffer.from(titleStr, "utf8");
    const titleLen = Buffer.alloc(4);
    titleLen.writeUInt32LE(titleBytes.length, 0);

    const idxBuf = Buffer.alloc(8);
    idxBuf.writeBigUInt64LE(2n, 0);
    const amtBuf = Buffer.alloc(8);
    amtBuf.writeBigUInt64LE(15_000_000_000n, 0);
    const reqBuf = Buffer.alloc(2);
    reqBuf.writeUInt16LE(2, 0);
    const tlBuf = Buffer.alloc(8);
    tlBuf.writeBigInt64LE(3600n, 0);
    const expBuf = Buffer.alloc(8);
    expBuf.writeBigInt64LE(900000n, 0);
    const tsBuf = Buffer.alloc(8);
    tsBuf.writeBigInt64LE(2500n, 0);

    const propCreatedPayload = Buffer.concat([
      VaultOSIndexer.getEventDiscriminator("ProposalCreated"),
      vaultPda.toBuffer(),
      prop2Pda.toBuffer(),
      idxBuf,
      admin.toBuffer(),
      titleLen,
      titleBytes,
      Buffer.from([1]), // SolTransfer
      destination.toBuffer(),
      amtBuf,
      Buffer.from([0]), // None mint
      reqBuf,
      tlBuf,
      expBuf,
      tsBuf,
    ]);

    const frozenPayload = Buffer.concat([
      VaultOSIndexer.getEventDiscriminator("VaultFrozen"),
      vaultPda.toBuffer(),
      admin.toBuffer(),
      tsBuf,
    ]);

    const unfrozenPayload = Buffer.concat([
      VaultOSIndexer.getEventDiscriminator("VaultUnfrozen"),
      vaultPda.toBuffer(),
      admin.toBuffer(),
      tsBuf,
    ]);

    const cancelledPayload = Buffer.concat([
      VaultOSIndexer.getEventDiscriminator("ProposalCancelled"),
      vaultPda.toBuffer(),
      prop2Pda.toBuffer(),
      admin.toBuffer(),
      tsBuf,
    ]);

    const memberAddedPayload = Buffer.concat([
      VaultOSIndexer.getEventDiscriminator("MemberAdded"),
      vaultPda.toBuffer(),
      memberTarget.toBuffer(),
      Buffer.from([RoleBitflags.PROPOSER]),
      tsBuf,
    ]);

    const rolesUpdatedPayload = Buffer.concat([
      VaultOSIndexer.getEventDiscriminator("MemberRolesUpdated"),
      vaultPda.toBuffer(),
      memberTarget.toBuffer(),
      Buffer.from([RoleBitflags.PROPOSER | RoleBitflags.GUARDIAN]),
      tsBuf,
    ]);

    const memberRemovedPayload = Buffer.concat([
      VaultOSIndexer.getEventDiscriminator("MemberRemoved"),
      vaultPda.toBuffer(),
      memberTarget.toBuffer(),
      tsBuf,
    ]);

    indexer.processLogs("sig_full_lifecycle_logs", 2500, [
      `Program ${programId.toBase58()} invoke [1]`,
      `Program data: ${propCreatedPayload.toString("base64")}`,
      `Program data: ${frozenPayload.toString("base64")}`,
      `Program data: ${memberAddedPayload.toString("base64")}`,
      `Program data: ${rolesUpdatedPayload.toString("base64")}`,
      `Program ${programId.toBase58()} success`,
    ]);

    // Verify ProposalCreated & VaultFrozen & MemberRolesUpdated were decoded from binary logs
    const decodedProp = db.getProposal(prop2Pda.toBase58());
    assert.ok(decodedProp, "ProposalCreated must be decoded from binary log");
    assert.strictEqual(decodedProp.title, titleStr);
    assert.strictEqual(decodedProp.status, "Active");

    assert.strictEqual(db.getVault(vaultPda.toBase58())?.isFrozen, true);

    const updatedMember = db
      .getMembers(vaultPda.toBase58())
      .find((m) => m.wallet === memberTarget.toBase58());
    assert.ok(updatedMember);
    assert.strictEqual(updatedMember.roles, RoleBitflags.PROPOSER | RoleBitflags.GUARDIAN);
    assert.ok(updatedMember.roleNames.includes("Guardian"));

    // Now process VaultUnfrozen, ProposalCancelled, and MemberRemoved binary logs
    indexer.processLogs("sig_full_lifecycle_logs_2", 2600, [
      `Program ${programId.toBase58()} invoke [1]`,
      `Program data: ${unfrozenPayload.toString("base64")}`,
      `Program data: ${cancelledPayload.toString("base64")}`,
      `Program data: ${memberRemovedPayload.toString("base64")}`,
      `Program ${programId.toBase58()} success`,
    ]);

    assert.strictEqual(db.getVault(vaultPda.toBase58())?.isFrozen, false);
    assert.strictEqual(db.getProposal(prop2Pda.toBase58())?.status, "Cancelled");
    const removedMember = db
      .getMembers(vaultPda.toBase58())
      .find((m) => m.wallet === memberTarget.toBase58());
    assert.strictEqual(removedMember?.isActive, false);
  });
});
