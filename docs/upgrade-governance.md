# VaultOS Upgrade Governance

## 1. Principles of On-Chain Governance

VaultOS on-chain programs secure institutional treasury assets. All program modifications follow strict upgrade governance to prevent backdoors, unauthorized upgrades, and single-point-of-failure compromises.

### Core Tenets:
1. **No Single-Key Upgrade Authority**: In production, the Program Upgrade Authority must NEVER be held by an EOA (Externally Owned Account) or single hot wallet.
2. **Timelocked Multisig Custody**: Program upgrades must be controlled by a dedicated Governance Multisig (e.g. Squads or VaultOS Meta-Governance) with an enforceable on-chain timelock (minimum 48 hours for mainnet).
3. **Verifiable Reproducible Builds**: Every deployed binary must match the audited open-source git commit hash via Anchor verifiable builds (`anchor build --verifiable`).

---

## 2. Program Upgrade Lifecycle

```
[ Developer Branch ]
         │
         ▼
[ Audit & Peer Review ] 
         │
         ▼
[ Verifiable Docker Build ] ──> SHA256 matches verified build hash
         │
         ▼
[ Write Buffer to Chain ] ────> Buffer Account created with new bytecode
         │
         ▼
[ Governance Upgrade Proposal ]
  - Propose Buffer Address
  - 48-Hour Timelock initiates
  - Community / Signer review window
         │
         ▼
[ Multi-Party Execution ] ────> BPFLoaderUpgradeable::Upgrade via Multisig Authority
         │
         ▼
[ Post-Upgrade Invariant Check ]
```

---

## 3. Step-by-Step Production Upgrade Procedure

### Step 1: Deterministic Compilation
Compile the program in the official Anchor verifiable build environment:
```bash
anchor build --verifiable
```
Verify the generated binary checksum:
```bash
sha256sum target/deploy/vaultos.so
```

### Step 2: Deploy New Bytecode to a Buffer Account
Write the compiled `.so` file to an intermediate buffer account without touching the active program:
```bash
solana program write-buffer target/deploy/vaultos.so \
  --buffer target/deploy/vaultos-buffer-keypair.json \
  --keypair ~/.config/solana/deployer.json \
  --url mainnet-beta
```

### Step 3: Set Buffer Authority to Governance Multisig
Transfer authority of the buffer account to the Governance Multisig address:
```bash
solana program set-buffer-authority <BUFFER_ADDRESS> \
  --new-buffer-authority <MULTISIG_GOVERNANCE_PUBKEY> \
  --keypair ~/.config/solana/deployer.json \
  --url mainnet-beta
```

### Step 4: Submit Upgrade Proposal in Governance
Create an on-chain proposal in the Governance Multisig to invoke:
```rust
// BPFLoaderUpgradeable instruction: Upgrade
// Program ID: 8crGeaqgPRAak8pvSf3YZpDovdTwUrCmfag3YdRM1iYw
// Buffer: <BUFFER_ADDRESS>
// Spill: <MULTISIG_GOVERNANCE_PUBKEY>
```

### Step 5: Timelock & Signer Consensus
- Multisig threshold of signers review the buffer hash against the verifiable build artifact.
- The 48-hour timelock countdown completes.
- Multisig executes the upgrade transaction.

---

## 4. Emergency Downgrade / Freezing of Upgrade Authority

### Ultimate Immutability (Freeze Authority)
Once VaultOS achieves terminal protocol maturity, governance can vote to permanently revoke the upgrade authority:
```bash
solana program set-upgrade-authority <PROGRAM_ID> \
  --final \
  --keypair ~/.config/solana/governance.json \
  --url mainnet-beta
```
> **Warning**: Revoking the upgrade authority renders the program permanently immutable. No future bug fixes or optimizations will be possible.
