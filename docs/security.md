# VaultOS Security Specification

VaultOS manages high-value treasury assets. Security is enforced through invariant-based programming, checked arithmetic, defensive PDA re-derivation, and idempotent execution witnesses.

## Critical Invariants

1. **Deterministic Authority Isolation**:
   Only the `Vault Authority` PDA (`seeds = [b"vault_authority", vault.key()]`) can move vault funds. No backend key or single admin wallet ever has custody.

2. **Multisig Threshold Enforcement**:
   A proposal requires $M$ valid, active member approvals. A proposal cannot execute if `approval_count < required_threshold`.

3. **Replay & Double-Approval Prevention**:
   The `Approval` PDA (`seeds = [b"approval", proposal.key(), member.key()]`) is initialized once per signer per proposal revision. Duplicate approval attempts fail at account initialization.

4. **Idempotent Execution Guarantee**:
   Execution initializes a dedicated `ExecutionRecord` PDA (`seeds = [b"execution", proposal.key()]`). Re-execution fails immediately, preventing double-spend attacks.

5. **Timelock Delay Enforcement**:
   High-risk proposals can require a delay:
   $$\text{Current Timestamp} \ge \text{Approved Timestamp} + \text{Timelock Delay}$$
   Early execution attempts are rejected on-chain with `TimelockNotElapsed`.

6. **Defensive Policy Engine**:
   Every transfer proposal is checked against active vault policies before funds move:
   - Per-transaction cap
   - 24-hour rolling window budget
   - Destination address allowlist
   - Token mint allowlist
   - Automatic escalation of approvals for high-value transactions

7. **Emergency Freeze Circuit Breakers**:
   Authorized administrators can freeze a vault to immediately halt all transfers. Unfreezing requires governance consensus.
