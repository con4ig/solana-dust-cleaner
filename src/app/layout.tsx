import type { Metadata } from "next";
import { SolanaProvider } from "@/providers/SolanaProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Solana Dust Cleaner — Reclaim Locked SOL Rent",
  description:
    "Close empty SPL token accounts and reclaim your locked SOL rent deposits. Free, transparent, open-source.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" style={{ colorScheme: "dark" }}>
      <body>
        <SolanaProvider>{children}</SolanaProvider>
      </body>
    </html>
  );
}
