# VaultOS Deployment Runbook

Guide for deploying VaultOS across environments: Localnet, Devnet, and Mainnet-Beta.

## Prerequisites

- Solana CLI $\ge 3.0$
- Anchor CLI $\ge 1.1$
- Node.js $\ge 20$

## Localnet Deployment

```bash
# 1. Start Solana test validator
solana-test-validator --reset

# 2. Build program binary
cargo build-sbf --manifest-path programs/vaultos/Cargo.toml

# 3. Deploy to localnet
solana program deploy target/deploy/vaultos.so --program-id target/deploy/vaultos-keypair.json

# 4. Start Indexer
npm --prefix services/indexer run start

# 5. Start Web Dashboard
npm --prefix apps/web run dev
```

## Devnet Deployment

```bash
# Set cluster to devnet
solana config set --url https://api.devnet.solana.com

# Deploy program
solana program deploy target/deploy/vaultos.so \
  --program-id target/deploy/vaultos-keypair.json \
  --upgrade-authority <GOVERNANCE_MULTISIG_PUBKEY>
```

## Upgrade Authority Strategy

In production, the program's upgrade authority must NEVER belong to a single deployer keypair. It should be transferred to a VaultOS Multisig Vault with an $M$-of-$N$ threshold and timelock delay.
