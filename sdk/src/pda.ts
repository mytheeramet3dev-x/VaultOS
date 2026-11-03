import { PublicKey } from "@solana/web3.js";

export const DEFAULT_PROGRAM_ID = new PublicKey(
  "8crGeaqgPRAak8pvSf3YZpDovdTwUrCmfag3YdRM1iYw"
);

export function getOrganizationPDA(
  orgId: string,
  programId: PublicKey = DEFAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("organization"), Buffer.from(orgId)],
    programId
  );
}

export function getVaultPDA(
  organization: PublicKey,
  vaultIndex: number,
  programId: PublicKey = DEFAULT_PROGRAM_ID
): [PublicKey, number] {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(vaultIndex, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), organization.toBuffer(), buf],
    programId
  );
}

export function getVaultAuthorityPDA(
  vault: PublicKey,
  programId: PublicKey = DEFAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority"), vault.toBuffer()],
    programId
  );
}

export function getMemberPDA(
  vault: PublicKey,
  wallet: PublicKey,
  programId: PublicKey = DEFAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("member"), vault.toBuffer(), wallet.toBuffer()],
    programId
  );
}

export function getProposalPDA(
  vault: PublicKey,
  proposalIndex: number | bigint,
  programId: PublicKey = DEFAULT_PROGRAM_ID
): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(proposalIndex), 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("proposal"), vault.toBuffer(), buf],
    programId
  );
}

export function getApprovalPDA(
  proposal: PublicKey,
  member: PublicKey,
  programId: PublicKey = DEFAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("approval"), proposal.toBuffer(), member.toBuffer()],
    programId
  );
}

export function getPolicyPDA(
  vault: PublicKey,
  policyIndex: number,
  programId: PublicKey = DEFAULT_PROGRAM_ID
): [PublicKey, number] {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(policyIndex, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("policy"), vault.toBuffer(), buf],
    programId
  );
}

export function getExecutionRecordPDA(
  proposal: PublicKey,
  programId: PublicKey = DEFAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("execution"), proposal.toBuffer()],
    programId
  );
}
