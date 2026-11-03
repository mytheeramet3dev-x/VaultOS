# VaultOS Threat Model

The VaultOS threat model assumes untrusted frontends, potential indexer/API compromise, malicious proposers, rogue signers, and adversarial network conditions.

## Threat Analysis & Mitigations

### 1. Compromised Single Member Key
- **Threat**: An attacker steals an approver's private key.
- **Mitigation**: The vault enforces $M$-of-$N$ threshold. A single key cannot authorize transfers. The admin can promptly invoke `remove_member` or `freeze_vault`.

### 2. Compromised Frontend or Indexer
- **Threat**: Attacker tampers with the web dashboard or manipulates the API database to show fake approval counts.
- **Mitigation**: The on-chain program remains the sole source of truth. All account validations, approval counts, and policy evaluations are executed by the Solana runtime. The indexer is strictly read-only and derived.

### 3. Account Substitution & Forged PDAs
- **Threat**: Attacker supplies a fake authority account or fake destination token account during execution.
- **Mitigation**: The program derives `vault_authority` on-chain using `[b"vault_authority", vault.key()]` and validates ownership and seeds before invoking transfers.

### 4. Split-Transfer Policy Evasion
- **Threat**: Attacker creates multiple small proposals under the per-transaction limit to drain funds.
- **Mitigation**: The `RollingSpendingLimit` policy tracks cumulative volume within a rolling 24-hour window, deterministically blocking split transfers.

### 5. Flash Loan / Early Timelock Exploits
- **Threat**: Attacker attempts to approve and execute within the same slot or before timelock expires.
- **Mitigation**: The program verifies the Solana `Clock` sysvar. Early executions return `TimelockNotElapsed`.
