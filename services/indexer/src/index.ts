import { Connection, PublicKey } from "@solana/web3.js";
import { IndexerDatabase } from "./db";
import { VaultOSIndexer } from "./indexer";
import { createServer } from "./server";

const PORT = process.env.PORT || 4000;
const RPC_URL = process.env.SOLANA_RPC_URL || "http://127.0.0.1:8899";
const PROGRAM_ID = new PublicKey(
  process.env.VAULTOS_PROGRAM_ID || "8crGeaqgPRAak8pvSf3YZpDovdTwUrCmfag3YdRM1iYw"
);

async function main() {
  console.log(`[VaultOS Indexer] Initializing database...`);
  const db = new IndexerDatabase();

  console.log(`[VaultOS Indexer] Connecting to Solana RPC at ${RPC_URL}...`);
  const connection = new Connection(RPC_URL, "confirmed");

  const indexer = new VaultOSIndexer(connection, db, PROGRAM_ID);
  indexer.start().catch((err) => {
    console.warn(`[VaultOS Indexer] Background sync warning:`, err.message);
  });

  const app = createServer(db, indexer);
  app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`🛡️  VaultOS Indexer & API Server`);
    console.log(`🌐 Server running at: http://localhost:${PORT}`);
    console.log(`📊 Health endpoint:   http://localhost:${PORT}/health`);
    console.log(`🏛️  Vaults API:        http://localhost:${PORT}/api/vaults`);
    console.log(`📜 Audit Trail API:   http://localhost:${PORT}/api/audit`);
    console.log(`===============================================`);
  });
}

main().catch(console.error);
