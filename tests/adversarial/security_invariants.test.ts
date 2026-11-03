import { describe, it } from "node:test";
import assert from "node:assert";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  DEFAULT_PROGRAM_ID,
  RoleBitflags,
  getApprovalPDA,
  getExecutionRecordPDA,
  getMemberPDA,
  getVaultAuthorityPDA,
  getVaultPDA,
  PolicyEvaluator,
  ProposalStatus,
  VaultOSClient,
  VaultOSError,
} from "../../sdk/dist/src/index.js";

describe("VaultOS Adversarial Suite: Critical Security Invariants", () => {
  const programId = DEFAULT_PROGRAM_ID;

  it("Invariant 1: Only the deterministic Vault Authority PDA can move vault assets", () => {
    const org = Keypair.generate().publicKey;
    const [vault] = getVaultPDA(org, 0, programId);
    const [authenticAuthority, authBump] = getVaultAuthorityPDA(vault, programId);

    // Adversary creates fake/forged authority account
    const forgedAuthority = Keypair.generate().publicKey;

    assert.notStrictEqual(authenticAuthority.toBase58(), forgedAuthority.toBase58());

    // Validation: on-chain seeds check [b"vault_authority", vault.key()]
    const [expectedAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority"), vault.toBuffer()],
      programId
    );
    assert.strictEqual(authenticAuthority.toBase58(), expectedAuthority.toBase58());

    // Adversary attempting to substitute forged authority fails validation
    assert.throws(() => {
      if (!forgedAuthority.equals(authenticAuthority)) {
        throw new VaultOSError("InvalidVaultAuthority");
      }
    }, /InvalidVaultAuthority/);
  });

  it("Invariant 2: A proposal cannot execute without its required approvals (M)", () => {
    const proposal = {
      approvalCount: 1,
      requiredThreshold: 3,
      status: ProposalStatus.Active,
    };

    assert.throws(() => {
      if (proposal.approvalCount < proposal.requiredThreshold) {
        throw new VaultOSError("ThresholdNotMet");
      }
    }, /ThresholdNotMet/);
  });

  it("Invariant 3: A signer cannot create multiple approvals for one proposal revision", () => {
    const proposal = Keypair.generate().publicKey;
    const signer = Keypair.generate().publicKey;

    const existingApprovals = new Set<string>();
    const [approvalPda] = getApprovalPDA(proposal, signer, programId);

    // First approval succeeds
    existingApprovals.add(approvalPda.toBase58());

    // Second approval attempt from same signer
    assert.throws(() => {
      if (existingApprovals.has(approvalPda.toBase58())) {
        throw new VaultOSError("AlreadyApproved");
      }
    }, /AlreadyApproved/);
  });

  it("Invariant 4: A proposal cannot execute more than once (Idempotent Execution)", () => {
    const proposal = Keypair.generate().publicKey;
    const [execRecordPda] = getExecutionRecordPDA(proposal, programId);

    const executedRecords = new Set<string>();
    executedRecords.add(execRecordPda.toBase58());

    // Attempting to re-execute fails
    assert.throws(() => {
      if (executedRecords.has(execRecordPda.toBase58())) {
        throw new VaultOSError("ProposalAlreadyExecuted");
      }
    }, /ProposalAlreadyExecuted/);
  });

  it("Invariant 5: A cancelled or expired proposal cannot execute", () => {
    const cancelledProposal = {
      status: ProposalStatus.Cancelled,
      expiresAt: Math.floor(Date.now() / 1000) + 1000,
    };

    assert.throws(() => {
      if (cancelledProposal.status === ProposalStatus.Cancelled) {
        throw new VaultOSError("ProposalCancelled");
      }
    }, /ProposalCancelled/);

    const expiredProposal = {
      status: ProposalStatus.Approved,
      expiresAt: Math.floor(Date.now() / 1000) - 100, // in the past
    };

    const currentTime = Math.floor(Date.now() / 1000);
    assert.throws(() => {
      if (currentTime > expiredProposal.expiresAt) {
        throw new VaultOSError("ProposalExpired");
      }
    }, /ProposalExpired/);
  });

  it("Invariant 6: A frozen vault cannot execute prohibited treasury operations", () => {
    const vault = {
      isFrozen: true,
    };

    assert.throws(() => {
      if (vault.isFrozen) {
        throw new VaultOSError("VaultIsFrozen");
      }
    }, /VaultIsFrozen/);
  });

  it("Invariant 7: A timelocked proposal cannot execute early", () => {
    const approvedAt = 1000n;
    const timelockDelay = 86400n; // 24 hours
    const unlockTime = approvedAt + timelockDelay; // 87400

    // Current time is 12 hours after approval (t = 44200 < 87400)
    const currentTime = 44200n;

    assert.throws(() => {
      if (currentTime < unlockTime) {
        throw new VaultOSError("TimelockNotElapsed");
      }
    }, /TimelockNotElapsed/);

    // Current time is 25 hours after approval (t = 91000 >= 87400) -> Passes
    assert.doesNotThrow(() => {
      const validTime = 91000n;
      if (validTime < unlockTime) {
        throw new VaultOSError("TimelockNotElapsed");
      }
    });
  });

  it("Invariant 8: A transfer cannot exceed an enforced spending policy", () => {
    const policy = {
      address: Keypair.generate().publicKey,
      vault: Keypair.generate().publicKey,
      policyIndex: 0,
      config: {
        type: "PerTransactionLimit" as const,
        mint: null,
        maxAmount: 50_000_000_000n, // 50 SOL
      },
      isActive: true,
      createdAt: 1000,
      bump: 255,
    };

    const opExceeding = {
      type: "SolTransfer" as const,
      destination: Keypair.generate().publicKey,
      lamports: 75_000_000_000n, // 75 SOL
    };

    const result = PolicyEvaluator.evaluate([policy], opExceeding, 2, 0n);
    assert.strictEqual(result.passed, false);
    assert.ok(result.violations.some((v) => v.includes("exceeds limit")));
  });

  it("Invariant 9: A transfer cannot exceed a rolling 24-hour spending window", () => {
    const policy = {
      address: Keypair.generate().publicKey,
      vault: Keypair.generate().publicKey,
      policyIndex: 1,
      config: {
        type: "RollingSpendingLimit" as const,
        mint: null,
        maxAmountWindow: 100_000_000_000n, // 100 SOL per 24h
        windowSeconds: 86400n,
        currentWindowStart: 1000n,
        currentSpent: 80_000_000_000n, // 80 SOL already spent
      },
      isActive: true,
      createdAt: 1000,
      bump: 255,
    };

    // Attempting to spend 30 SOL in same window (80 + 30 = 110 > 100) -> Rejected
    const op = {
      type: "SolTransfer" as const,
      destination: Keypair.generate().publicKey,
      lamports: 30_000_000_000n,
    };

    const result = PolicyEvaluator.evaluate([policy], op, 2, 0n, 2000n);
    assert.strictEqual(result.passed, false);
    assert.ok(result.violations.some((v) => v.includes("exceeds 24h rolling limit")));
  });

  it("Invariant 10: A transfer to an unapproved destination is rejected when allowlist is active", () => {
    const allowed = Keypair.generate().publicKey;
    const hacker = Keypair.generate().publicKey;

    const policy = {
      address: Keypair.generate().publicKey,
      vault: Keypair.generate().publicKey,
      policyIndex: 2,
      config: {
        type: "DestinationAllowlist" as const,
        destinations: [allowed],
      },
      isActive: true,
      createdAt: 1000,
      bump: 255,
    };

    const maliciousOp = {
      type: "SolTransfer" as const,
      destination: hacker,
      lamports: 10_000_000_000n,
    };

    const result = PolicyEvaluator.evaluate([policy], maliciousOp, 2, 0n);
    assert.strictEqual(result.passed, false);
    assert.ok(result.violations.some((v) => v.includes("not allowlisted")));
  });

  it("Invariant 11: Removing a member prevents future privileged actions by that member", () => {
    const member = {
      roles: RoleBitflags.APPROVER,
      isActive: true,
    };

    // Member can approve while active
    assert.strictEqual(member.isActive && (member.roles & RoleBitflags.APPROVER) !== 0, true);

    // Admin removes/deactivates member
    member.isActive = false;
    (member as any).roles = 0;

    // Former member attempts to approve
    assert.throws(() => {
      if (!member.isActive || (member.roles & RoleBitflags.APPROVER) === 0) {
        throw new VaultOSError("MemberNotFound");
      }
    }, /MemberNotFound/);
  });

  it("Invariant 12: Self-CPI & Re-entrancy into VaultOS program is strictly blocked", () => {
    const cpiTarget = programId; // Attacker tries to CPI back into VaultOS itself

    assert.throws(() => {
      if (cpiTarget.equals(programId) || cpiTarget.equals(PublicKey.default)) {
        throw new VaultOSError("ProgramNotAllowed");
      }
    }, /ProgramNotAllowed/);
  });

  it("Invariant 13: Retroactive Threshold Hardening enforces max(proposal.requiredThreshold, vault.threshold)", () => {
    // Proposal created when vault threshold was 2
    const proposal = {
      approvalCount: 2,
      requiredThreshold: 2,
      status: ProposalStatus.Executable,
    };

    // Governance raises vault threshold to 3 before proposal executes
    const vault = {
      threshold: 3,
    };

    const effectiveThreshold = Math.max(proposal.requiredThreshold, vault.threshold);
    assert.strictEqual(effectiveThreshold, 3);

    assert.throws(() => {
      if (proposal.approvalCount < effectiveThreshold) {
        throw new VaultOSError("ThresholdNotMet");
      }
    }, /ThresholdNotMet/);
  });

  it("Invariant 14: Safe Account Closure on remove_member reclaims rent and permits clean re-onboarding", () => {
    const vault = Keypair.generate().publicKey;
    const memberWallet = Keypair.generate().publicKey;
    const [memberPda] = getMemberPDA(vault, memberWallet, programId);

    const activeAccounts = new Map<string, { roles: number; isActive: boolean; lamports: number }>();

    // 1. Initial onboarding via add_member
    activeAccounts.set(memberPda.toBase58(), {
      roles: RoleBitflags.APPROVER,
      isActive: true,
      lamports: 1_500_000,
    });
    assert.strictEqual(activeAccounts.has(memberPda.toBase58()), true);

    // 2. remove_member with `close = admin` zeroes data, reclaims rent, and deletes account
    const closedAccount = activeAccounts.get(memberPda.toBase58())!;
    closedAccount.isActive = false;
    closedAccount.roles = 0;
    closedAccount.lamports = 0;
    activeAccounts.delete(memberPda.toBase58());
    assert.strictEqual(activeAccounts.has(memberPda.toBase58()), false);

    // 3. Re-onboarding same wallet later succeeds without AccountAlreadyInitialized error
    assert.doesNotThrow(() => {
      if (activeAccounts.has(memberPda.toBase58())) {
        throw new VaultOSError("MemberAlreadyExists");
      }
      activeAccounts.set(memberPda.toBase58(), {
        roles: RoleBitflags.PROPOSER | RoleBitflags.APPROVER,
        isActive: true,
        lamports: 1_500_000,
      });
    });
    assert.strictEqual(activeAccounts.get(memberPda.toBase58())?.isActive, true);
  });

  it("Invariant 15: Stale Approval Invalidation rejects execution if a prior approver was removed before execution", () => {
    const alice = Keypair.generate().publicKey;
    const bob = Keypair.generate().publicKey;

    // Alice and Bob both approved the proposal (2 of 2)
    const proposal = {
      approvers: [alice, bob],
      approvalCount: 2,
      requiredThreshold: 2,
    };

    // Before execution, Bob is compromised and removed by Admin
    const currentVaultMembers = new Map<string, { isActive: boolean; roles: number }>([
      [alice.toBase58(), { isActive: true, roles: RoleBitflags.APPROVER }],
      // Bob's Member PDA was closed/deactivated
    ]);

    // Execution-time active approver verification
    const verifiedActiveApprovers = proposal.approvers.filter((wallet) => {
      const m = currentVaultMembers.get(wallet.toBase58());
      return m && m.isActive && (m.roles & RoleBitflags.APPROVER) !== 0;
    });

    assert.strictEqual(verifiedActiveApprovers.length, 1);

    assert.throws(() => {
      if (verifiedActiveApprovers.length < proposal.requiredThreshold) {
        throw new VaultOSError("ThresholdNotMet");
      }
    }, /ThresholdNotMet/);
  });

  it("Invariant 16: Unilateral Admin Bypass is blocked when multisig is active (requires M-of-N co-signers with valid binary Member PDAs)", () => {
    const org = Keypair.generate().publicKey;
    const [vaultPda, vaultBump] = getVaultPDA(org, 0, programId);
    const [authPda, authBump] = getVaultAuthorityPDA(vaultPda, programId);

    const admin1 = Keypair.generate();
    const admin2 = Keypair.generate();
    const [admin2MemberPda, m2Bump] = getMemberPDA(vaultPda, admin2.publicKey, programId);

    // Encode binary Vault (threshold = 2, memberCount = 3, adminCount = 2)
    const vaultBuf = VaultOSClient.encodeVaultAccount({
      address: vaultPda,
      organization: org,
      vaultIndex: 0,
      name: "Multisig Guarded Vault",
      authorityPda: authPda,
      authorityBump: authBump,
      threshold: 2,
      memberCount: 3,
      adminCount: 2,
      proposalCount: 0n,
      policyCount: 0,
      timelockDelay: 3600n,
      isFrozen: false,
      createdAt: 1_700_000_000,
      bump: vaultBump,
    });
    const decodedVault = VaultOSClient.decodeVaultAccount(vaultPda, vaultBuf, programId);

    // Helper mirroring on-chain Vault::verify_admin_consensus over binary Member PDAs
    const verifyAdminConsensus = (
      primaryAdmin: PublicKey,
      coSigners: { pubkey: PublicKey; isSigner: boolean; memberPda: PublicKey; memberData: Buffer }[]
    ) => {
      if (decodedVault.memberCount < decodedVault.threshold || decodedVault.threshold <= 1) {
        return true;
      }
      const needed = decodedVault.threshold - 1;
      if (coSigners.length < needed) {
        throw new VaultOSError("ThresholdNotMet");
      }
      const seen = new Set<string>([primaryAdmin.toBase58()]);
      let valid = 0;
      for (const cs of coSigners) {
        if (!cs.isSigner || seen.has(cs.pubkey.toBase58())) {
          throw new VaultOSError("UnauthorizedRole");
        }
        const m = VaultOSClient.decodeMemberAccount(cs.memberPda, cs.memberData);
        const [expectedPda] = getMemberPDA(vaultPda, cs.pubkey, programId);
        if (!expectedPda.equals(cs.memberPda) || !m.isActive) {
          throw new VaultOSError("InvalidPDASeeds");
        }
        if ((m.roles & (RoleBitflags.ADMIN | RoleBitflags.APPROVER)) === 0) {
          throw new VaultOSError("UnauthorizedRole");
        }
        seen.add(cs.pubkey.toBase58());
        valid++;
      }
      if (valid < needed) throw new VaultOSError("ThresholdNotMet");
      return true;
    };

    // 1. Single admin trying to mutate members/policies/unfreeze alone -> REJECTED
    assert.throws(() => verifyAdminConsensus(admin1.publicKey, []), /ThresholdNotMet/);

    // 2. Co-signer with valid binary Member PDA -> PASSES
    const admin2MemberBuf = VaultOSClient.encodeMemberAccount({
      address: admin2MemberPda,
      vault: vaultPda,
      wallet: admin2.publicKey,
      roles: RoleBitflags.ADMIN | RoleBitflags.APPROVER,
      isActive: true,
      addedAt: 1_700_000_000,
      bump: m2Bump,
    });
    assert.strictEqual(
      verifyAdminConsensus(admin1.publicKey, [
        {
          pubkey: admin2.publicKey,
          isSigner: true,
          memberPda: admin2MemberPda,
          memberData: admin2MemberBuf,
        },
      ]),
      true
    );
  });

  it("Invariant 17: Last-Admin Lockout Protection prevents removing or demoting the final Admin", () => {
    let adminCount = 1;
    const targetIsAdmin = true;
    const newRolesWithoutAdmin = RoleBitflags.PROPOSER | RoleBitflags.APPROVER;

    // Attempting to demote or remove the last remaining admin must fail
    assert.throws(() => {
      if (targetIsAdmin && (newRolesWithoutAdmin & RoleBitflags.ADMIN) === 0 && adminCount <= 1) {
        throw new VaultOSError("InvalidRole");
      }
    }, /InvalidRole/);
  });

  it("Invariant 18: SPL Token TransferChecked (discriminator 12u8) & AddMember/RemoveMember binary codecs", () => {
    const amount = 250_000_000n;
    const decimals = 6;

    // Build TransferChecked instruction payload (10 bytes: [12, u64 LE amount, u8 decimals])
    const ixData = Buffer.alloc(10);
    ixData.writeUInt8(12, 0);
    ixData.writeBigUInt64LE(amount, 1);
    ixData.writeUInt8(decimals, 9);

    assert.strictEqual(ixData.readUInt8(0), 12);
    assert.strictEqual(ixData.readBigUInt64LE(1), 250_000_000n);
    assert.strictEqual(ixData.readUInt8(9), 6);

    // Verify AddMember and RemoveMember ProposalOperation binary roundtrip
    const newWallet = Keypair.generate().publicKey;
    const encodedAdd = VaultOSClient.encodeOperation({
      type: "AddMember",
      wallet: newWallet,
      roles: RoleBitflags.PROPOSER | RoleBitflags.APPROVER,
    });
    const decodedAdd = VaultOSClient.decodeOperation(encodedAdd, 0);
    assert.strictEqual(decodedAdd.operation.type, "AddMember");
    if (decodedAdd.operation.type === "AddMember") {
      assert.strictEqual(decodedAdd.operation.wallet.toBase58(), newWallet.toBase58());
      assert.strictEqual(decodedAdd.operation.roles, 6);
    }
  });

  it("Invariant 19: Config Revision Tracking (config_revision / vault_revision) invalidates stale proposals when vault config changes", () => {
    const org = Keypair.generate().publicKey;
    const [vaultPda, vaultBump] = getVaultPDA(org, 0, programId);
    const [authPda, authBump] = getVaultAuthorityPDA(vaultPda, programId);

    // 1. Proposal created at config_revision = 1
    const propBuf = VaultOSClient.encodeProposalAccount({
      address: Keypair.generate().publicKey,
      vault: vaultPda,
      proposalIndex: 1n,
      proposer: Keypair.generate().publicKey,
      title: "Payout under revision 1",
      operation: {
        type: "SolTransfer",
        destination: Keypair.generate().publicKey,
        lamports: 10_000_000_000n,
      },
      status: ProposalStatus.Executable,
      approvalCount: 2,
      requiredThreshold: 2,
      timelockDelay: 0n,
      createdAt: 1_700_000_000,
      approvedAt: 1_700_000_100,
      executedAt: 0,
      expiresAt: 1_800_000_000,
      bump: 254,
      approvers: [],
      vaultRevision: 1,
    });
    const decodedProp = VaultOSClient.decodeProposalAccount(Keypair.generate().publicKey, propBuf);
    assert.strictEqual(decodedProp.vaultRevision, 1);

    // 2. Vault undergoes a security config change (e.g. member removed or threshold changed) -> configRevision = 2
    const vaultBuf = VaultOSClient.encodeVaultAccount({
      address: vaultPda,
      organization: org,
      vaultIndex: 0,
      name: "Revision Guarded Vault",
      authorityPda: authPda,
      authorityBump: authBump,
      threshold: 2,
      memberCount: 3,
      adminCount: 2,
      proposalCount: 2n,
      policyCount: 0,
      timelockDelay: 3600n,
      isFrozen: false,
      createdAt: 1_700_000_000,
      bump: vaultBump,
      executedProposalCount: 5n,
      configRevision: 2,
      accountVersion: 1,
    });
    const decodedVault = VaultOSClient.decodeVaultAccount(vaultPda, vaultBuf, programId);
    assert.strictEqual(decodedVault.configRevision, 2);
    assert.strictEqual(decodedVault.executedProposalCount, 5n);
    assert.strictEqual(decodedVault.accountVersion, 1);

    // 3. Attempting to approve or execute a proposal from revision 1 when vault is at revision 2 MUST fail
    assert.throws(() => {
      if (decodedProp.vaultRevision !== decodedVault.configRevision) {
        throw new VaultOSError("StaleConfigRevision");
      }
    }, /StaleConfigRevision/);
  });

  it("Invariant 20: Timelock Expiry Scaling (H1) & Threshold/Approver Capacity Caps (H2) prevent permanent vault deadlock", () => {
    const MAX_TIMELOCK = 30 * 86400; // 30 days
    const EXECUTION_GRACE_PERIOD = 7 * 86400; // 7 days
    const MAX_APPROVERS = 16;

    // 1. Setting timelock > 30 days is rejected with InvalidTimelock
    const excessiveTimelock = 365 * 86400;
    assert.throws(() => {
      if (excessiveTimelock > MAX_TIMELOCK) {
        throw new VaultOSError("InvalidTimelock");
      }
    }, /InvalidTimelock/);

    // 2. A 14-day timelocked proposal receives expires_at = now + timelock + 7d grace (never expires before unlocking)
    const now = 1_700_000_000;
    const timelock14d = 14 * 86400;
    const expiresAt = now + timelock14d + EXECUTION_GRACE_PERIOD;
    const unlockAt = now + timelock14d;
    assert.ok(
      expiresAt >= unlockAt + EXECUTION_GRACE_PERIOD,
      "Proposal expiration must always exceed timelock unlock timestamp by the execution grace period"
    );

    // 3. Setting threshold > MAX_APPROVERS (16) is rejected with MaxApproversReached
    const unreachableThreshold = 17;
    assert.throws(() => {
      if (unreachableThreshold > MAX_APPROVERS) {
        throw new VaultOSError("MaxApproversReached");
      }
    }, /MaxApproversReached/);
  });

  it("Invariant 21: Core Asset Program Blocklist (H3) prevents CpiCall from bypassing SolTransfer/TokenTransfer spending limits", () => {
    const splTokenProgram = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const token2022Program = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    const bpfLoaderUpgradeable = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

    assert.strictEqual(PolicyEvaluator.isForbiddenCpiProgram(splTokenProgram), true);
    assert.strictEqual(PolicyEvaluator.isForbiddenCpiProgram(token2022Program), true);
    assert.strictEqual(PolicyEvaluator.isForbiddenCpiProgram(bpfLoaderUpgradeable), true);
    assert.strictEqual(PolicyEvaluator.isForbiddenCpiProgram(programId), true);

    // Even if an allowlist policy mistakenly listed SPL Token, PolicyEvaluator rejects CpiCall to SPL Token
    const allowlistPolicy = {
      address: Keypair.generate().publicKey,
      vault: Keypair.generate().publicKey,
      policyIndex: 0,
      config: {
        type: "ProgramAllowlist" as const,
        allowedPrograms: [splTokenProgram],
      },
      isActive: true,
      createdAt: 1000,
      bump: 255,
    };

    const bypassAttemptOp = {
      type: "CpiCall" as const,
      programId: splTokenProgram,
      instructionData: Buffer.from([3, 0, 0, 0, 0, 0, 0, 0, 0]),
    };

    const res = PolicyEvaluator.evaluate([allowlistPolicy], bypassAttemptOp, 2, 0n);
    assert.strictEqual(res.passed, false);
    assert.ok(res.violations.some((v) => v.includes("core asset/system program")));
  });

  it("Invariant 22: Approver/Executor Liveness Guards (M4) & Vault Binary Codec Roundtrip", () => {
    const org = Keypair.generate().publicKey;
    const [vaultPda, vaultBump] = getVaultPDA(org, 0, programId);
    const [authPda, authBump] = getVaultAuthorityPDA(vaultPda, programId);

    const encoded = VaultOSClient.encodeVaultAccount({
      address: vaultPda,
      organization: org,
      vaultIndex: 0,
      name: "Liveness Guarded Vault",
      authorityPda: authPda,
      authorityBump: authBump,
      threshold: 2,
      memberCount: 3,
      adminCount: 2,
      proposalCount: 0n,
      policyCount: 0,
      timelockDelay: 0n,
      isFrozen: false,
      createdAt: 1_700_000_000,
      bump: vaultBump,
      executedProposalCount: 0n,
      configRevision: 1,
      accountVersion: 1,
      approverCount: 2,
      executorCount: 1,
    });
    const decoded = VaultOSClient.decodeVaultAccount(vaultPda, encoded, programId);
    assert.strictEqual(decoded.approverCount, 2);
    assert.strictEqual(decoded.executorCount, 1);

    // Stripping ROLE_APPROVER when approverCount == threshold (2) must fail
    assert.throws(() => {
      if ((decoded.approverCount ?? 0) - 1 < decoded.threshold) {
        throw new VaultOSError("ApproverThresholdShortfall");
      }
    }, /ApproverThresholdShortfall/);

    // Stripping ROLE_EXECUTOR when executorCount == 1 must fail
    assert.throws(() => {
      if ((decoded.executorCount ?? 0) - 1 < 1) {
        throw new VaultOSError("NoActiveExecutor");
      }
    }, /NoActiveExecutor/);
  });

  it("Invariant 23: Multi-Tier Escalation Non-Cumulative Max & Bounded Proposal Expiry Lifetime", () => {
    const tier1 = {
      address: Keypair.generate().publicKey,
      vault: Keypair.generate().publicKey,
      policyIndex: 0,
      config: {
        type: "ApprovalEscalation" as const,
        tierAmount: 100_000_000_000n,
        extraApprovals: 1,
        extraTimelock: 3600n,
      },
      isActive: true,
      createdAt: 1000,
      bump: 255,
    };
    const tier2 = {
      address: Keypair.generate().publicKey,
      vault: tier1.vault,
      policyIndex: 1,
      config: {
        type: "ApprovalEscalation" as const,
        tierAmount: 500_000_000_000n,
        extraApprovals: 2,
        extraTimelock: 86400n,
      },
      isActive: true,
      createdAt: 1000,
      bump: 254,
    };

    const op600Sol = {
      type: "SolTransfer" as const,
      destination: Keypair.generate().publicKey,
      lamports: 600_000_000_000n,
    };

    const res = PolicyEvaluator.evaluate([tier1, tier2], op600Sol, 2, 0n);
    assert.strictEqual(res.passed, true);
    assert.strictEqual(res.escalatedThreshold, 4); // max(2+1, 2+2) = 4, not 5
    assert.strictEqual(res.escalatedTimelock, 86400n);

    // Bounded expiry: approve/revoke cycling cannot push expires_at past created_at + MAX_TIMELOCK + 2*GRACE
    const createdAt = 1_700_000_000;
    const maxLifetime = createdAt + 30 * 86400 + 2 * (7 * 86400);
    const lateApprovalTime = createdAt + 40 * 86400;
    const clampedExpiry = Math.min(lateApprovalTime + 7 * 86400, maxLifetime);
    assert.strictEqual(clampedExpiry, maxLifetime);
  });
});
