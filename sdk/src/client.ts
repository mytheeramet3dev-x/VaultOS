import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  DEFAULT_PROGRAM_ID,
  getApprovalPDA,
  getExecutionRecordPDA,
  getMemberPDA,
  getOrganizationPDA,
  getPolicyPDA,
  getProposalPDA,
  getVaultAuthorityPDA,
  getVaultPDA,
} from "./pda";
import {
  MemberAccount,
  OrganizationAccount,
  PolicyAccount,
  PolicyConfig,
  ProposalAccount,
  ProposalOperation,
  ProposalStatus,
  RoleBitflags,
  VaultAccount,
} from "./types";
import { SimulationHelper, SimulationResult } from "./simulation";
import { VaultOSError } from "./errors";

export interface WalletSigner {
  publicKey: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
}

export class VaultOSClient {
  constructor(
    public readonly connection: Connection,
    public readonly wallet: Keypair | WalletSigner,
    public readonly programId: PublicKey = DEFAULT_PROGRAM_ID
  ) {}

  get publicKey(): PublicKey {
    return this.wallet.publicKey;
  }

  private async sendTransaction(
    instruction: TransactionInstruction,
    additionalSigners: Keypair[] = []
  ): Promise<string> {
    const tx = new Transaction().add(instruction);
    tx.feePayer = this.publicKey;
    const latestBlockhash = await this.connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = latestBlockhash.blockhash;

    if ("secretKey" in this.wallet) {
      return sendAndConfirmTransaction(
        this.connection,
        tx,
        [this.wallet as Keypair, ...additionalSigners],
        { commitment: "confirmed" }
      );
    } else {
      if (additionalSigners.length > 0) {
        tx.partialSign(...additionalSigners);
      }
      const signed = await this.wallet.signTransaction(tx);
      const rawTx = signed.serialize();
      const sig = await this.connection.sendRawTransaction(rawTx);
      await this.connection.confirmTransaction(
        {
          signature: sig,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        "confirmed"
      );
      return sig;
    }
  }

  // --- 1. Organization ---

  async createOrganization(params: {
    orgId: string;
    name: string;
  }): Promise<{ organization: PublicKey; signature: string }> {
    const [organization] = getOrganizationPDA(params.orgId, this.programId);

    // Anchor instruction discriminator for "create_organization": sha256("global:create_organization")[..8]
    // In SDK, we can serialize the Anchor instruction buffer
    const data = Buffer.concat([
      this.getInstructionDiscriminator("create_organization"),
      this.encodeString(params.orgId),
      this.encodeString(params.name),
    ]);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: organization, isSigner: false, isWritable: true },
        { pubkey: this.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const signature = await this.sendTransaction(ix);
    return { organization, signature };
  }

  // --- 2. Vault ---

  async createVault(params: {
    organization: PublicKey;
    vaultIndex: number;
    name: string;
    threshold: number;
    timelockDelay: bigint | number;
  }): Promise<{ vault: PublicKey; vaultAuthority: PublicKey; signature: string }> {
    const [vault] = getVaultPDA(params.organization, params.vaultIndex, this.programId);
    const [vaultAuthority] = getVaultAuthorityPDA(vault, this.programId);
    const [adminMember] = getMemberPDA(vault, this.publicKey, this.programId);

    const timelockBuf = Buffer.alloc(8);
    timelockBuf.writeBigInt64LE(BigInt(params.timelockDelay), 0);

    const thresholdBuf = Buffer.alloc(2);
    thresholdBuf.writeUInt16LE(params.threshold, 0);

    const data = Buffer.concat([
      this.getInstructionDiscriminator("create_vault"),
      this.encodeString(params.name),
      thresholdBuf,
      timelockBuf,
    ]);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: params.organization, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: vaultAuthority, isSigner: false, isWritable: false },
        { pubkey: adminMember, isSigner: false, isWritable: true },
        { pubkey: this.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const signature = await this.sendTransaction(ix);
    return { vault, vaultAuthority, signature };
  }

  // --- 3. Members ---

  private appendAdminCoSigners(
    vault: PublicKey,
    coSigners: Keypair[] = []
  ): { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] {
    const metas: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
    for (const signer of coSigners) {
      const [memberPda] = getMemberPDA(vault, signer.publicKey, this.programId);
      metas.push({ pubkey: signer.publicKey, isSigner: true, isWritable: false });
      metas.push({ pubkey: memberPda, isSigner: false, isWritable: false });
    }
    return metas;
  }

  async addMember(params: {
    vault: PublicKey;
    memberWallet: PublicKey;
    roles: number;
    coSigners?: Keypair[];
  }): Promise<{ member: PublicKey; signature: string }> {
    const [adminMember] = getMemberPDA(params.vault, this.publicKey, this.programId);
    const [newMember] = getMemberPDA(params.vault, params.memberWallet, this.programId);

    const data = Buffer.concat([
      this.getInstructionDiscriminator("add_member"),
      params.memberWallet.toBuffer(),
      Buffer.from([params.roles]),
    ]);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: params.vault, isSigner: false, isWritable: true },
        { pubkey: adminMember, isSigner: false, isWritable: false },
        { pubkey: newMember, isSigner: false, isWritable: true },
        { pubkey: this.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ...this.appendAdminCoSigners(params.vault, params.coSigners),
      ],
      data,
    });

    const signature = await this.sendTransaction(ix, params.coSigners || []);
    return { member: newMember, signature };
  }

  async updateMember(params: {
    vault: PublicKey;
    memberWallet: PublicKey;
    newRoles: number;
    coSigners?: Keypair[];
  }): Promise<{ signature: string }> {
    const [adminMember] = getMemberPDA(params.vault, this.publicKey, this.programId);
    const [targetMember] = getMemberPDA(params.vault, params.memberWallet, this.programId);

    const data = Buffer.concat([
      this.getInstructionDiscriminator("update_member"),
      params.memberWallet.toBuffer(),
      Buffer.from([params.newRoles]),
    ]);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: params.vault, isSigner: false, isWritable: true },
        { pubkey: adminMember, isSigner: false, isWritable: false },
        { pubkey: targetMember, isSigner: false, isWritable: true },
        { pubkey: this.publicKey, isSigner: true, isWritable: false },
        ...this.appendAdminCoSigners(params.vault, params.coSigners),
      ],
      data,
    });

    const signature = await this.sendTransaction(ix, params.coSigners || []);
    return { signature };
  }

  async removeMember(params: {
    vault: PublicKey;
    memberWallet: PublicKey;
    coSigners?: Keypair[];
  }): Promise<{ signature: string }> {
    const [adminMember] = getMemberPDA(params.vault, this.publicKey, this.programId);
    const [targetMember] = getMemberPDA(params.vault, params.memberWallet, this.programId);

    const data = Buffer.concat([
      this.getInstructionDiscriminator("remove_member"),
      params.memberWallet.toBuffer(),
    ]);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: params.vault, isSigner: false, isWritable: true },
        { pubkey: adminMember, isSigner: false, isWritable: false },
        { pubkey: targetMember, isSigner: false, isWritable: true },
        { pubkey: this.publicKey, isSigner: true, isWritable: true },
        ...this.appendAdminCoSigners(params.vault, params.coSigners),
      ],
      data,
    });

    const signature = await this.sendTransaction(ix, params.coSigners || []);
    return { signature };
  }

  // --- 4. Proposals ---

  async createSolTransferProposal(params: {
    vault: PublicKey;
    proposalIndex: number | bigint;
    title: string;
    destination: PublicKey;
    lamports: bigint | number;
    remainingPolicyAccounts?: PublicKey[];
  }): Promise<{ proposal: PublicKey; signature: string }> {
    return this.createGovernanceProposal({
      vault: params.vault,
      proposalIndex: params.proposalIndex,
      title: params.title,
      operation: {
        type: "SolTransfer",
        destination: params.destination,
        lamports: BigInt(params.lamports),
      },
      remainingPolicyAccounts: params.remainingPolicyAccounts,
    });
  }

  async createTokenTransferProposal(params: {
    vault: PublicKey;
    proposalIndex: number | bigint;
    title: string;
    mint: PublicKey;
    destination: PublicKey;
    amount: bigint | number;
    remainingPolicyAccounts?: PublicKey[];
  }): Promise<{ proposal: PublicKey; signature: string }> {
    return this.createGovernanceProposal({
      vault: params.vault,
      proposalIndex: params.proposalIndex,
      title: params.title,
      operation: {
        type: "TokenTransfer",
        mint: params.mint,
        destination: params.destination,
        amount: BigInt(params.amount),
      },
      remainingPolicyAccounts: params.remainingPolicyAccounts,
    });
  }

  async createGovernanceProposal(params: {
    vault: PublicKey;
    proposalIndex: number | bigint;
    title: string;
    operation: ProposalOperation;
    remainingPolicyAccounts?: PublicKey[];
  }): Promise<{ proposal: PublicKey; signature: string }> {
    const [proposerMember] = getMemberPDA(params.vault, this.publicKey, this.programId);
    const [proposal] = getProposalPDA(params.vault, params.proposalIndex, this.programId);

    const opBuf = VaultOSClient.encodeOperation(params.operation);

    const data = Buffer.concat([
      this.getInstructionDiscriminator("create_proposal"),
      this.encodeString(params.title),
      opBuf,
    ]);

    const keys = [
      { pubkey: params.vault, isSigner: false, isWritable: true },
      { pubkey: proposerMember, isSigner: false, isWritable: false },
      { pubkey: proposal, isSigner: false, isWritable: true },
      { pubkey: this.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ...(params.remainingPolicyAccounts || []).map((p) => ({
        pubkey: p,
        isSigner: false,
        isWritable: false,
      })),
    ];

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys,
      data,
    });

    const signature = await this.sendTransaction(ix);
    return { proposal, signature };
  }

  async createPolicy(params: {
    vault: PublicKey;
    policyIndex: number;
    config: PolicyConfig;
    coSigners?: Keypair[];
  }): Promise<{ policy: PublicKey; signature: string }> {
    const [adminMember] = getMemberPDA(params.vault, this.publicKey, this.programId);
    const [policy] = getPolicyPDA(params.vault, params.policyIndex, this.programId);

    const data = Buffer.concat([
      this.getInstructionDiscriminator("create_policy"),
      VaultOSClient.encodePolicyConfig(params.config),
    ]);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: params.vault, isSigner: false, isWritable: true },
        { pubkey: adminMember, isSigner: false, isWritable: false },
        { pubkey: policy, isSigner: false, isWritable: true },
        { pubkey: this.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ...this.appendAdminCoSigners(params.vault, params.coSigners),
      ],
      data,
    });

    const signature = await this.sendTransaction(ix, params.coSigners || []);
    return { policy, signature };
  }

  async approveProposal(params: {
    vault: PublicKey;
    proposal: PublicKey;
  }): Promise<{ approval: PublicKey; signature: string }> {
    const [approverMember] = getMemberPDA(params.vault, this.publicKey, this.programId);
    const [approval] = getApprovalPDA(params.proposal, this.publicKey, this.programId);

    const data = this.getInstructionDiscriminator("approve_proposal");

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: params.vault, isSigner: false, isWritable: false },
        { pubkey: params.proposal, isSigner: false, isWritable: true },
        { pubkey: approverMember, isSigner: false, isWritable: false },
        { pubkey: approval, isSigner: false, isWritable: true },
        { pubkey: this.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const signature = await this.sendTransaction(ix);
    return { approval, signature };
  }

  async revokeApproval(params: {
    vault: PublicKey;
    proposal: PublicKey;
  }): Promise<{ signature: string }> {
    const [approverMember] = getMemberPDA(params.vault, this.publicKey, this.programId);
    const [approval] = getApprovalPDA(params.proposal, this.publicKey, this.programId);

    const data = this.getInstructionDiscriminator("revoke_approval");

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: params.vault, isSigner: false, isWritable: false },
        { pubkey: params.proposal, isSigner: false, isWritable: true },
        { pubkey: approverMember, isSigner: false, isWritable: false },
        { pubkey: approval, isSigner: false, isWritable: true },
        { pubkey: this.publicKey, isSigner: true, isWritable: true },
      ],
      data,
    });

    const signature = await this.sendTransaction(ix);
    return { signature };
  }

  async cancelProposal(params: {
    vault: PublicKey;
    proposal: PublicKey;
    coSigners?: Keypair[];
  }): Promise<{ signature: string }> {
    const [callerMember] = getMemberPDA(params.vault, this.publicKey, this.programId);
    const data = this.getInstructionDiscriminator("cancel_proposal");

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: params.vault, isSigner: false, isWritable: false },
        { pubkey: params.proposal, isSigner: false, isWritable: true },
        { pubkey: callerMember, isSigner: false, isWritable: false },
        { pubkey: this.publicKey, isSigner: true, isWritable: false },
        ...this.appendAdminCoSigners(params.vault, params.coSigners),
      ],
      data,
    });

    const signature = await this.sendTransaction(ix, params.coSigners || []);
    return { signature };
  }

  async executeProposal(params: {
    vault: PublicKey;
    proposal: PublicKey;
    remainingAccounts?: { pubkey: PublicKey; isWritable: boolean }[];
  }): Promise<{ executionRecord: PublicKey; signature: string }> {
    const [vaultAuthority] = getVaultAuthorityPDA(params.vault, this.programId);
    const [executionRecord] = getExecutionRecordPDA(params.proposal, this.programId);
    const [executorMember] = getMemberPDA(params.vault, this.publicKey, this.programId);

    const data = this.getInstructionDiscriminator("execute_proposal");

    const keys = [
      { pubkey: params.vault, isSigner: false, isWritable: true },
      { pubkey: vaultAuthority, isSigner: false, isWritable: true },
      { pubkey: params.proposal, isSigner: false, isWritable: true },
      { pubkey: executionRecord, isSigner: false, isWritable: true },
      { pubkey: executorMember, isSigner: false, isWritable: false },
      { pubkey: this.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ...(params.remainingAccounts || []).map((acc) => ({
        pubkey: acc.pubkey,
        isSigner: false,
        isWritable: acc.isWritable,
      })),
    ];

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys,
      data,
    });

    const signature = await this.sendTransaction(ix);
    return { executionRecord, signature };
  }

  // --- 5. Emergency Controls ---

  async freezeVault(vault: PublicKey): Promise<{ signature: string }> {
    const [adminMember] = getMemberPDA(vault, this.publicKey, this.programId);
    const data = this.getInstructionDiscriminator("freeze_vault");

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: adminMember, isSigner: false, isWritable: false },
        { pubkey: this.publicKey, isSigner: true, isWritable: false },
      ],
      data,
    });

    const signature = await this.sendTransaction(ix);
    return { signature };
  }

  async unfreezeVault(
    vault: PublicKey,
    coSigners: Keypair[] = []
  ): Promise<{ signature: string }> {
    const [adminMember] = getMemberPDA(vault, this.publicKey, this.programId);
    const data = this.getInstructionDiscriminator("unfreeze_vault");

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: adminMember, isSigner: false, isWritable: false },
        { pubkey: this.publicKey, isSigner: true, isWritable: false },
        ...this.appendAdminCoSigners(vault, coSigners),
      ],
      data,
    });

    const signature = await this.sendTransaction(ix, coSigners);
    return { signature };
  }

  // --- 6. Deposits ---

  async depositSol(params: {
    vault: PublicKey;
    amountLamports: bigint | number;
  }): Promise<{ signature: string }> {
    const [vaultAuthority] = getVaultAuthorityPDA(params.vault, this.programId);
    const amountBuf = Buffer.alloc(8);
    amountBuf.writeBigUInt64LE(BigInt(params.amountLamports), 0);

    const data = Buffer.concat([
      this.getInstructionDiscriminator("deposit_sol"),
      amountBuf,
    ]);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: params.vault, isSigner: false, isWritable: false },
        { pubkey: vaultAuthority, isSigner: false, isWritable: true },
        { pubkey: this.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const signature = await this.sendTransaction(ix);
    return { signature };
  }

  // --- 7. Account Fetchers & Borsh Binary Codecs ---

  async fetchVault(vaultAddress: PublicKey): Promise<VaultAccount | null> {
    const info = await this.connection.getAccountInfo(vaultAddress, "confirmed");
    if (!info || !info.data) return null;
    return VaultOSClient.decodeVaultAccount(vaultAddress, Buffer.from(info.data), this.programId);
  }

  async fetchMember(memberAddress: PublicKey): Promise<MemberAccount | null> {
    const info = await this.connection.getAccountInfo(memberAddress, "confirmed");
    if (!info || !info.data) return null;
    return VaultOSClient.decodeMemberAccount(memberAddress, Buffer.from(info.data));
  }

  async fetchProposal(proposalAddress: PublicKey): Promise<ProposalAccount | null> {
    const info = await this.connection.getAccountInfo(proposalAddress, "confirmed");
    if (!info || !info.data) return null;
    return VaultOSClient.decodeProposalAccount(proposalAddress, Buffer.from(info.data));
  }

  static getAccountDiscriminator(accountName: string): Buffer {
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(`account:${accountName}`).digest().slice(0, 8);
  }

  static getInstructionDiscriminatorStatic(name: string): Buffer {
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(`global:${name}`).digest().slice(0, 8);
  }

  static encodeOperation(op: ProposalOperation): Buffer {
    switch (op.type) {
      case "SolTransfer": {
        const b = Buffer.alloc(8);
        b.writeBigUInt64LE(BigInt(op.lamports), 0);
        return Buffer.concat([Buffer.from([0]), op.destination.toBuffer(), b]);
      }
      case "TokenTransfer": {
        const b = Buffer.alloc(8);
        b.writeBigUInt64LE(BigInt(op.amount), 0);
        return Buffer.concat([
          Buffer.from([1]),
          op.mint.toBuffer(),
          op.destination.toBuffer(),
          b,
        ]);
      }
      case "AddMember":
        return Buffer.concat([Buffer.from([2]), op.wallet.toBuffer(), Buffer.from([op.roles])]);
      case "RemoveMember":
        return Buffer.concat([Buffer.from([3]), op.wallet.toBuffer()]);
      case "ChangeThreshold": {
        const b = Buffer.alloc(2);
        b.writeUInt16LE(op.newThreshold, 0);
        return Buffer.concat([Buffer.from([4]), b]);
      }
      case "SetTimelock": {
        const b = Buffer.alloc(8);
        b.writeBigInt64LE(BigInt(op.delaySeconds), 0);
        return Buffer.concat([Buffer.from([5]), b]);
      }
      case "SetFrozen":
        return Buffer.concat([Buffer.from([6]), Buffer.from([op.frozen ? 1 : 0])]);
      case "CpiCall": {
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32LE(op.instructionData.length, 0);
        return Buffer.concat([
          Buffer.from([7]),
          op.programId.toBuffer(),
          lenBuf,
          op.instructionData,
        ]);
      }
    }
  }

  static decodeOperation(buf: Buffer, offset: number): { operation: ProposalOperation; nextOffset: number } {
    const variant = buf.readUInt8(offset);
    let cursor = offset + 1;
    switch (variant) {
      case 0: {
        const destination = new PublicKey(buf.slice(cursor, cursor + 32));
        cursor += 32;
        const lamports = buf.readBigUInt64LE(cursor);
        cursor += 8;
        return { operation: { type: "SolTransfer", destination, lamports }, nextOffset: cursor };
      }
      case 1: {
        const mint = new PublicKey(buf.slice(cursor, cursor + 32));
        cursor += 32;
        const destination = new PublicKey(buf.slice(cursor, cursor + 32));
        cursor += 32;
        const amount = buf.readBigUInt64LE(cursor);
        cursor += 8;
        return { operation: { type: "TokenTransfer", mint, destination, amount }, nextOffset: cursor };
      }
      case 2: {
        const wallet = new PublicKey(buf.slice(cursor, cursor + 32));
        cursor += 32;
        const roles = buf.readUInt8(cursor);
        cursor += 1;
        return { operation: { type: "AddMember", wallet, roles }, nextOffset: cursor };
      }
      case 3: {
        const wallet = new PublicKey(buf.slice(cursor, cursor + 32));
        cursor += 32;
        return { operation: { type: "RemoveMember", wallet }, nextOffset: cursor };
      }
      case 4: {
        const newThreshold = buf.readUInt16LE(cursor);
        cursor += 2;
        return { operation: { type: "ChangeThreshold", newThreshold }, nextOffset: cursor };
      }
      case 5: {
        const delaySeconds = buf.readBigInt64LE(cursor);
        cursor += 8;
        return { operation: { type: "SetTimelock", delaySeconds }, nextOffset: cursor };
      }
      case 6: {
        const frozen = buf.readUInt8(cursor) !== 0;
        cursor += 1;
        return { operation: { type: "SetFrozen", frozen }, nextOffset: cursor };
      }
      case 7: {
        const programId = new PublicKey(buf.slice(cursor, cursor + 32));
        cursor += 32;
        const len = buf.readUInt32LE(cursor);
        cursor += 4;
        const instructionData = Buffer.from(buf.slice(cursor, cursor + len));
        cursor += len;
        return { operation: { type: "CpiCall", programId, instructionData }, nextOffset: cursor };
      }
      default:
        throw new Error(`Unknown ProposalOperation variant: ${variant}`);
    }
  }

  static encodePolicyConfig(config: PolicyConfig): Buffer {
    switch (config.type) {
      case "PerTransactionLimit": {
        const optMint = config.mint
          ? Buffer.concat([Buffer.from([1]), config.mint.toBuffer()])
          : Buffer.from([0]);
        const maxBuf = Buffer.alloc(8);
        maxBuf.writeBigUInt64LE(BigInt(config.maxAmount), 0);
        return Buffer.concat([Buffer.from([0]), optMint, maxBuf]);
      }
      case "RollingSpendingLimit": {
        const optMint = config.mint
          ? Buffer.concat([Buffer.from([1]), config.mint.toBuffer()])
          : Buffer.from([0]);
        const b = Buffer.alloc(32);
        b.writeBigUInt64LE(BigInt(config.maxAmountWindow), 0);
        b.writeBigInt64LE(BigInt(config.windowSeconds), 8);
        b.writeBigInt64LE(BigInt(config.currentWindowStart), 16);
        b.writeBigUInt64LE(BigInt(config.currentSpent), 24);
        return Buffer.concat([Buffer.from([1]), optMint, b]);
      }
      case "DestinationAllowlist": {
        const len = Buffer.alloc(4);
        len.writeUInt32LE(config.destinations.length, 0);
        return Buffer.concat([
          Buffer.from([2]),
          len,
          ...config.destinations.map((d) => d.toBuffer()),
        ]);
      }
      case "AssetAllowlist": {
        const len = Buffer.alloc(4);
        len.writeUInt32LE(config.allowedMints.length, 0);
        return Buffer.concat([
          Buffer.from([3]),
          len,
          ...config.allowedMints.map((m) => m.toBuffer()),
        ]);
      }
      case "ProgramAllowlist": {
        const len = Buffer.alloc(4);
        len.writeUInt32LE(config.allowedPrograms.length, 0);
        return Buffer.concat([
          Buffer.from([4]),
          len,
          ...config.allowedPrograms.map((p) => p.toBuffer()),
        ]);
      }
      case "ApprovalEscalation": {
        const b = Buffer.alloc(18);
        b.writeBigUInt64LE(BigInt(config.tierAmount), 0);
        b.writeUInt16LE(config.extraApprovals, 8);
        b.writeBigInt64LE(BigInt(config.extraTimelock), 10);
        return Buffer.concat([Buffer.from([5]), b]);
      }
    }
  }

  static encodeVaultAccount(vault: VaultAccount): Buffer {
    const disc = VaultOSClient.getAccountDiscriminator("Vault");
    const nameBytes = Buffer.from(vault.name, "utf8");
    const nameLen = Buffer.alloc(4);
    nameLen.writeUInt32LE(nameBytes.length, 0);

    const idxBuf = Buffer.alloc(4);
    idxBuf.writeUInt32LE(vault.vaultIndex, 0);

    const fixed = Buffer.alloc(1 + 2 + 2 + 2 + 8 + 2 + 8 + 1 + 8 + 1 + 8 + 4 + 1 + 2 + 2);
    let o = 0;
    fixed.writeUInt8(vault.authorityBump, o); o += 1;
    fixed.writeUInt16LE(vault.threshold, o); o += 2;
    fixed.writeUInt16LE(vault.memberCount, o); o += 2;
    fixed.writeUInt16LE(vault.adminCount ?? 1, o); o += 2;
    fixed.writeBigUInt64LE(BigInt(vault.proposalCount), o); o += 8;
    fixed.writeUInt16LE(vault.policyCount, o); o += 2;
    fixed.writeBigInt64LE(BigInt(vault.timelockDelay), o); o += 8;
    fixed.writeUInt8(vault.isFrozen ? 1 : 0, o); o += 1;
    fixed.writeBigInt64LE(BigInt(vault.createdAt), o); o += 8;
    fixed.writeUInt8(vault.bump, o); o += 1;
    fixed.writeBigUInt64LE(BigInt(vault.executedProposalCount ?? 0n), o); o += 8;
    fixed.writeUInt32LE(vault.configRevision ?? 1, o); o += 4;
    fixed.writeUInt8(vault.accountVersion ?? 1, o); o += 1;
    fixed.writeUInt16LE(vault.approverCount ?? vault.memberCount, o); o += 2;
    fixed.writeUInt16LE(vault.executorCount ?? 1, o);

    return Buffer.concat([disc, vault.organization.toBuffer(), idxBuf, nameLen, nameBytes, fixed]);
  }

  static decodeVaultAccount(
    address: PublicKey,
    data: Buffer,
    programId: PublicKey = DEFAULT_PROGRAM_ID
  ): VaultAccount {
    const expectedDisc = VaultOSClient.getAccountDiscriminator("Vault");
    if (data.length < 8 || !data.slice(0, 8).equals(expectedDisc)) {
      throw new Error("Invalid Vault account discriminator");
    }
    let cursor = 8;
    const organization = new PublicKey(data.slice(cursor, cursor + 32));
    cursor += 32;
    const vaultIndex = data.readUInt32LE(cursor);
    cursor += 4;
    const nameLen = data.readUInt32LE(cursor);
    cursor += 4;
    const name = data.slice(cursor, cursor + nameLen).toString("utf8");
    cursor += nameLen;
    const authorityBump = data.readUInt8(cursor); cursor += 1;
    const threshold = data.readUInt16LE(cursor); cursor += 2;
    const memberCount = data.readUInt16LE(cursor); cursor += 2;
    const adminCount = data.readUInt16LE(cursor); cursor += 2;
    const proposalCount = data.readBigUInt64LE(cursor); cursor += 8;
    const policyCount = data.readUInt16LE(cursor); cursor += 2;
    const timelockDelay = data.readBigInt64LE(cursor); cursor += 8;
    const isFrozen = data.readUInt8(cursor) !== 0; cursor += 1;
    const createdAt = Number(data.readBigInt64LE(cursor)); cursor += 8;
    const bump = data.readUInt8(cursor); cursor += 1;
    const executedProposalCount =
      cursor + 8 <= data.length ? data.readBigUInt64LE(cursor) : 0n;
    if (cursor + 8 <= data.length) cursor += 8;
    const configRevision =
      cursor + 4 <= data.length ? data.readUInt32LE(cursor) : 1;
    if (cursor + 4 <= data.length) cursor += 4;
    const accountVersion =
      cursor + 1 <= data.length ? data.readUInt8(cursor) : 1;
    if (cursor + 1 <= data.length) cursor += 1;
    const approverCount =
      cursor + 2 <= data.length ? data.readUInt16LE(cursor) : memberCount;
    if (cursor + 2 <= data.length) cursor += 2;
    const executorCount =
      cursor + 2 <= data.length ? data.readUInt16LE(cursor) : 1;

    const [authorityPda] = getVaultAuthorityPDA(address, programId);
    return {
      address,
      organization,
      vaultIndex,
      name,
      authorityPda,
      authorityBump,
      threshold,
      memberCount,
      adminCount,
      proposalCount,
      policyCount,
      timelockDelay,
      isFrozen,
      createdAt,
      bump,
      executedProposalCount,
      configRevision,
      accountVersion,
      approverCount,
      executorCount,
    };
  }

  static encodeMemberAccount(member: MemberAccount): Buffer {
    const disc = VaultOSClient.getAccountDiscriminator("Member");
    const tail = Buffer.alloc(1 + 1 + 8 + 1 + 4);
    tail.writeUInt8(member.roles, 0);
    tail.writeUInt8(member.isActive ? 1 : 0, 1);
    tail.writeBigInt64LE(BigInt(member.addedAt), 2);
    tail.writeUInt8(member.bump, 10);
    tail.writeUInt32LE(member.configRevisionAtJoin ?? 1, 11);
    return Buffer.concat([disc, member.vault.toBuffer(), member.wallet.toBuffer(), tail]);
  }

  static decodeMemberAccount(address: PublicKey, data: Buffer): MemberAccount {
    const expectedDisc = VaultOSClient.getAccountDiscriminator("Member");
    if (data.length < 8 || !data.slice(0, 8).equals(expectedDisc)) {
      throw new Error("Invalid Member account discriminator");
    }
    let cursor = 8;
    const vault = new PublicKey(data.slice(cursor, cursor + 32)); cursor += 32;
    const wallet = new PublicKey(data.slice(cursor, cursor + 32)); cursor += 32;
    const roles = data.readUInt8(cursor); cursor += 1;
    const isActive = data.readUInt8(cursor) !== 0; cursor += 1;
    const addedAt = Number(data.readBigInt64LE(cursor)); cursor += 8;
    const bump = data.readUInt8(cursor); cursor += 1;
    const configRevisionAtJoin =
      cursor + 4 <= data.length ? data.readUInt32LE(cursor) : 1;
    return { address, vault, wallet, roles, isActive, addedAt, bump, configRevisionAtJoin };
  }

  static encodeProposalAccount(prop: ProposalAccount): Buffer {
    const disc = VaultOSClient.getAccountDiscriminator("Proposal");
    const idxBuf = Buffer.alloc(8);
    idxBuf.writeBigUInt64LE(BigInt(prop.proposalIndex), 0);
    const titleBytes = Buffer.from(prop.title, "utf8");
    const titleLen = Buffer.alloc(4);
    titleLen.writeUInt32LE(titleBytes.length, 0);
    const opBuf = VaultOSClient.encodeOperation(prop.operation);

    const fixed = Buffer.alloc(1 + 2 + 2 + 8 + 8 + 8 + 8 + 8 + 1);
    let o = 0;
    fixed.writeUInt8(prop.status, o); o += 1;
    fixed.writeUInt16LE(prop.approvalCount, o); o += 2;
    fixed.writeUInt16LE(prop.requiredThreshold, o); o += 2;
    fixed.writeBigInt64LE(BigInt(prop.timelockDelay), o); o += 8;
    fixed.writeBigInt64LE(BigInt(prop.createdAt), o); o += 8;
    fixed.writeBigInt64LE(BigInt(prop.approvedAt), o); o += 8;
    fixed.writeBigInt64LE(BigInt(prop.executedAt), o); o += 8;
    fixed.writeBigInt64LE(BigInt(prop.expiresAt), o); o += 8;
    fixed.writeUInt8(prop.bump, o);

    const approvers = prop.approvers || [];
    const appLen = Buffer.alloc(4);
    appLen.writeUInt32LE(approvers.length, 0);

    const revBuf = Buffer.alloc(4);
    revBuf.writeUInt32LE(prop.vaultRevision ?? 1, 0);

    return Buffer.concat([
      disc,
      prop.vault.toBuffer(),
      idxBuf,
      prop.proposer.toBuffer(),
      titleLen,
      titleBytes,
      opBuf,
      fixed,
      appLen,
      ...approvers.map((a) => a.toBuffer()),
      revBuf,
    ]);
  }

  static decodeProposalAccount(address: PublicKey, data: Buffer): ProposalAccount {
    const expectedDisc = VaultOSClient.getAccountDiscriminator("Proposal");
    if (data.length < 8 || !data.slice(0, 8).equals(expectedDisc)) {
      throw new Error("Invalid Proposal account discriminator");
    }
    let cursor = 8;
    const vault = new PublicKey(data.slice(cursor, cursor + 32)); cursor += 32;
    const proposalIndex = data.readBigUInt64LE(cursor); cursor += 8;
    const proposer = new PublicKey(data.slice(cursor, cursor + 32)); cursor += 32;
    const titleLen = data.readUInt32LE(cursor); cursor += 4;
    const title = data.slice(cursor, cursor + titleLen).toString("utf8"); cursor += titleLen;
    const { operation, nextOffset } = VaultOSClient.decodeOperation(data, cursor);
    cursor = nextOffset;
    const status = data.readUInt8(cursor) as ProposalStatus; cursor += 1;
    const approvalCount = data.readUInt16LE(cursor); cursor += 2;
    const requiredThreshold = data.readUInt16LE(cursor); cursor += 2;
    const timelockDelay = data.readBigInt64LE(cursor); cursor += 8;
    const createdAt = Number(data.readBigInt64LE(cursor)); cursor += 8;
    const approvedAt = Number(data.readBigInt64LE(cursor)); cursor += 8;
    const executedAt = Number(data.readBigInt64LE(cursor)); cursor += 8;
    const expiresAt = Number(data.readBigInt64LE(cursor)); cursor += 8;
    const bump = data.readUInt8(cursor); cursor += 1;

    const approvers: PublicKey[] = [];
    if (cursor + 4 <= data.length) {
      const appCount = data.readUInt32LE(cursor); cursor += 4;
      for (let i = 0; i < appCount && cursor + 32 <= data.length; i++) {
        approvers.push(new PublicKey(data.slice(cursor, cursor + 32)));
        cursor += 32;
      }
    }
    const vaultRevision = cursor + 4 <= data.length ? data.readUInt32LE(cursor) : 1;

    return {
      address,
      vault,
      proposalIndex,
      proposer,
      title,
      operation,
      status,
      approvalCount,
      requiredThreshold,
      timelockDelay,
      createdAt,
      approvedAt,
      executedAt,
      expiresAt,
      bump,
      approvers,
      vaultRevision,
    };
  }

  // --- Helpers ---

  private encodeString(str: string): Buffer {
    const strBuf = Buffer.from(str, "utf8");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(strBuf.length, 0);
    return Buffer.concat([lenBuf, strBuf]);
  }

  /**
   * Generates standard Anchor 8-byte instruction discriminator:
   * sha256("global:" + name).slice(0, 8)
   */
  private getInstructionDiscriminator(name: string): Buffer {
    return VaultOSClient.getInstructionDiscriminatorStatic(name);
  }
}
