import type { Metadata } from "next";
import { SolanaProvider } from "@/providers/SolanaProvider";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "https://solana-dust-cleaner.vercel.app"
  ),
  title: "Solana Dust Cleaner & Spam NFT Burner - Reclaim Locked SOL Rent",
  description:
    "Close empty SPL token accounts and burn spam NFTs to reclaim your locked SOL rent deposits. Free, transparent, open-source utility for the Solana community.",
  keywords: [
    "Solana",
    "dust cleaner",
    "spam NFT burner",
    "burn spam NFTs",
    "rent reclaim",
    "reclaim SOL",
    "close empty token accounts",
    "Solana rent refund",
    "SPL token accounts",
    "Phantom wallet",
    "Solana utility",
    "Web3 tool",
  ],
  authors: [{ name: "Solana Dust Cleaner Community" }],
  openGraph: {
    title: "Solana Dust Cleaner & Spam NFT Burner - Reclaim Locked SOL Rent",
    description:
      "Close empty SPL token accounts and burn spam NFTs to reclaim your locked SOL rent deposits. Free, transparent, open-source utility for the Solana community.",
    url: "/",
    siteName: "Solana Dust Cleaner & NFT Burner",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Solana Dust Cleaner",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Solana Dust Cleaner & Spam NFT Burner - Reclaim Locked SOL Rent",
    description:
      "Close empty SPL token accounts and burn spam NFTs to reclaim your locked SOL rent deposits. Free, transparent, open-source utility for the Solana community.",
    images: ["/og-image.png"],
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
    canonical: "/",
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
