# VaultOS Incident Response Playbook

## 1. Overview & Emergency Roles

This document defines standard operating procedures (SOPs) for detecting, containing, mitigating, and recovering from security incidents involving VaultOS treasury vaults.

### Emergency Response Team
- **Incident Commander (IC)**: Leads triage, decisions, and stakeholder comms.
- **Operations Engineer (Ops)**: Executes CLI commands, verifies on-chain account state.
- **Security Auditor / Engineer**: Analyzes suspicious transactions, traces attacker flows.

---

## 2. Severity Classification

| Level | Description | Target Response Time | Action |
|---|---|---|---|
| **SEV-1 (Critical)** | Active unauthorized drain or critical vulnerability discovered with funds at risk | < 15 minutes | Immediate Vault Emergency Freeze (`freeze_vault`) |
| **SEV-2 (High)** | Compromised member signer or attempted bypass rejected by policy engine | < 1 hour | Signer rotation (`remove_member`, `add_member`), policy review |
| **SEV-3 (Medium)** | Indexer sync lag, RPC degradation, stale telemetry | < 4 hours | Failover RPC endpoint, restart indexer service |
| **SEV-4 (Low)** | Minor UI bug or non-security telemetry reporting error | < 24 hours | Standard hotfix cycle |

---

## 3. SEV-1 Playbook: Emergency Freeze Execution

When active exploit or unauthorized proposal activity is observed, any authorized Admin can freeze the vault immediately.

### Action A: On-Chain Emergency Freeze
Run the CLI / SDK freeze command using an active Admin keypair:

```bash
# Using VaultOS TypeScript CLI / SDK
node -e '
  const { VaultOSClient } = require("@vaultos/sdk");
  const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
  const fs = require("fs");

  const connection = new Connection(process.env.SOLANA_RPC_URL, "confirmed");
  const adminKey = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ADMIN_KEYPAIR_PATH))));
  const client = new VaultOSClient(connection, adminKey, new PublicKey(process.env.PROGRAM_ID));
  
  (async () => {
    const sig = await client.freezeVault(new PublicKey(process.env.VAULT_ADDRESS));
    console.log("Vault FROZEN! Transaction signature:", sig);
  })();
'
```

### Action B: What Freezing Does
- **Blocks all new proposal creations** (`require!(!vault.is_frozen, VaultOSError::VaultIsFrozen)`).
- **Blocks proposal execution** (`require!(!vault.is_frozen, VaultOSError::VaultIsFrozen)`).
- **Allows incoming deposits** (SOL/SPL tokens can still be received if required).
- **Allows admin operations** (`unfreeze_vault`, member management after threshold consensus).

---

## 4. SEV-2 Playbook: Compromised Signer Rotation

If a vault member's private key is leaked or compromised:

### Step 1: Revoke the Compromised Signer Immediately
An Admin executes `remove_member`:
```typescript
const sig = await client.removeMember(vaultPubkey, compromisedMemberPubkey);
console.log("Compromised member removed:", sig);
```

### Step 2: Cancel Any Pending Proposals Initiated by Compromised Signer
Inspect pending proposals:
```typescript
const proposals = await client.getProposals(vaultPubkey);
for (const p of proposals) {
  if (p.proposer.equals(compromisedMemberPubkey) && p.status === "Active") {
    await client.cancelProposal(vaultPubkey, p.proposalIndex);
    console.log(`Cancelled suspicious proposal #${p.proposalIndex}`);
  }
}
```

### Step 3: Onboard New Hardware-Backed Signer
Generate a new hardware wallet or multisig keypair and add to the vault:
```typescript
const NEW_ROLES = 0b0110; // Proposer (2) + Approver (4)
await client.addMember(vaultPubkey, newSignerPubkey, NEW_ROLES);
```

---

## 5. SEV-3 Playbook: Indexer & RPC Failover

1. Switch primary RPC in `services/indexer/.env`:
   ```bash
   SOLANA_RPC_URL=https://backup-rpc.helius-rpc.com/?api-key=BACKUP_KEY
   ```
2. Restart systemd service / docker container:
   ```bash
   pm2 restart vaultos-indexer
   ```
3. Verify indexing health:
   ```bash
   curl -s http://localhost:4000/health | jq .
   curl -s http://localhost:4000/metrics | grep vaultos_indexer_uptime_seconds
   ```

---

## 6. Post-Mortem Template

Every SEV-1 and SEV-2 incident requires a published post-mortem within 72 hours covering:
1. **Executive Summary**: Timeline of incident from detection to resolution.
2. **Root Cause Analysis (RCA)**: 5 Whys analysis of vulnerabilities or operational failures.
3. **Financial Impact**: Exact lamports / SPL tokens affected, if any.
4. **Corrective & Preventive Actions (CAPA)**: Code modifications, security invariants added, automated alert thresholds updated.
