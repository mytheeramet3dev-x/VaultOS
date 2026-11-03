import "./globals.css";
import type { Metadata } from "next";
import { WalletProvider } from "../context/WalletContext";
import { TreasuryProvider } from "../context/TreasuryContext";
import { Navbar } from "../components/Navbar";
import { Sidebar } from "../components/Sidebar";

export const metadata: Metadata = {
  title: "VaultOS - Solana Institutional Treasury & Governance OS",
  description: "Production-grade on-chain treasury, multisig, policy, and governance operating system for Solana",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-vault-950 text-slate-100 min-h-screen flex flex-col antialiased selection:bg-emerald-500/30 selection:text-emerald-300">
        <WalletProvider>
          <TreasuryProvider>
            <Navbar />
            <div className="flex flex-1">
              <Sidebar />
              <main className="flex-1 p-8 overflow-y-auto max-w-7xl">
                {children}
              </main>
            </div>
          </TreasuryProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
