import type { Metadata } from "next";
import { SolanaProvider } from "@/providers/SolanaProvider";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://solanadustcleaner.com"),
  title: "Solana Dust Cleaner - Reclaim Locked SOL Rent",
  description:
    "Close empty SPL token accounts and reclaim your locked SOL rent deposits. Free, transparent, open-source tool for the Solana community.",
  keywords: [
    "Solana",
    "dust cleaner",
    "rent reclaim",
    "reclaim SOL",
    "close empty token accounts",
    "Solana rent refund",
    "SPL token accounts",
    "Phantom wallet",
    "Solana tool",
  ],
  authors: [{ name: "Solana Dust Cleaner Community" }],
  openGraph: {
    title: "Solana Dust Cleaner - Reclaim Locked SOL Rent",
    description:
      "Close empty SPL token accounts and reclaim your locked SOL rent deposits. Free, transparent, open-source tool for the Solana community.",
    url: "https://solanadustcleaner.com",
    siteName: "Solana Dust Cleaner",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Solana Dust Cleaner - Reclaim Locked SOL Rent",
    description:
      "Close empty SPL token accounts and reclaim your locked SOL rent deposits. Free, transparent, open-source tool for the Solana community.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: "https://solanadustcleaner.com",
  },
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
