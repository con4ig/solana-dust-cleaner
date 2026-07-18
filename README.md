# Solana Utility Toolkit

Close empty token accounts and burn spam NFTs to reclaim your locked SOL rent deposits - in one click.

Every time you buy a token, receive an airdrop, or use a DeFi protocol on Solana, a new token account is created in your wallet. Each one locks **~0.002039 SOL** as a rent deposit. When those tokens reach zero balance (or if you receive unwanted spam NFTs), those accounts stay on-chain, silently holding your SOL hostage.

**Solana Utility Toolkit** helps you tidy up your wallet, burn unwanted assets, and get your SOL back instantly.

---

## Features

- **Empty Accounts Cleaner** - scans your wallet for empty (zero-balance) SPL token accounts and closes them.
- **Spam NFT Burner** - permanently burns unwanted spam NFTs/tokens and closes their token accounts to reclaim rent.
- **On-chain Metadata Resolution** - decodes Metaplex Metadata V1 PDA accounts to show name and symbol for NFTs.
- **Dynamic CORS Proxy API** - uses an internal proxy route (`/api/proxy`) to fetch remote NFT image metadata without browser CORS blocks.
- **Framer Motion Transitions** - ultra-smooth tab slide-out animations and page transition animations.
- **Auto-Scrolling Easing** - automatically scrolls viewports to the bottom of accordion boxes smoothly when expanded.
- **Selective Reclaiming** - pick exactly which accounts to close/burn, or select all with one click.
- **Real-time SOL Estimate** - see exactly how much gross and net SOL you'll recover before signing.
- **Non-custodial** - your private keys never leave your wallet; we never touch your assets.
- **No Custom Contracts** - uses official, audited Solana System and SPL Token Programs only.

---

## How It Works

```
Connect Wallet -> Select Tab (Accounts / NFTs) -> Scan -> Select Items -> Reclaim & Burn -> Receive SOL
```

1. **Connect** your Phantom, Solflare, or any Wallet Standard-compatible wallet.
2. **Select Tab** - choose "Empty Accounts" or "Spam NFTs" depending on what you want to clean.
3. **Scan** - the app fetches accounts/tokens from the chain and resolves metadata.
4. **Select** which items you want to clean/burn (all selected by default).
5. **Sign** a single bundled transaction safely in your wallet popup.
6. **Receive** the unlocked SOL rent directly to your wallet instantly on transaction confirmation.

---

## Fee Structure

To support open-source development, a small dynamic fee is taken inside the same transaction:

| Gross Reclaimed SOL  | Fee Rate | Example                              |
| :------------------- | :------: | :----------------------------------- |
| Below 0.05 SOL       |  **5%**  | 0.001 SOL fee on 0.020 SOL reclaimed |
| 0.05 SOL to 0.20 SOL |  **2%**  | 0.002 SOL fee on 0.100 SOL reclaimed |
| Above 0.20 SOL       |  **1%**  | 0.003 SOL fee on 0.300 SOL reclaimed |

The fee is processed as a standard `SystemProgram.transfer`, fully visible in your wallet's transaction preview before you sign anything.

---

## Security

This tool is built with transparency as a core design principle:

- **No custom smart contracts** - every instruction uses the official, audited Solana System Program and SPL Token Program. There is no custom bytecode to audit or trust.
- **Enforced by the blockchain** - the SPL Token Program will reject any close instruction for a standard token account that still holds tokens. Your active funded tokens are mathematically safe.
- **Fully auditable** - your wallet (e.g. Phantom) shows the exact decoded instructions before you sign: `Burn` and `CloseAccount` per account + one `Transfer` for the fee.
- **Open source** - all code is public and can be run locally on your own machine.

---

## Run Locally

You don't have to trust the hosted version. Clone it, read it, run it yourself:

```bash
# 1. Clone the repository
git clone https://github.com/con4ig/solana-dust-cleaner.git
cd solana-dust-cleaner

# 2. Install dependencies
npm install --ignore-scripts

# 3. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

> **Note:** `--ignore-scripts` prevents any postinstall scripts from running, an extra safety measure when auditing open-source code you just cloned.

---

## Testing on Devnet

Want to test the full flow without using real SOL? Use the included helper script to create dummy empty token accounts on Solana Devnet:

### Prerequisites

Make sure your Phantom wallet is switched to **Devnet**:

1. Open Phantom -> Settings -> Developer Settings -> enable **Testnet Mode** -> select **Solana Devnet**
2. Get free Devnet SOL for your wallet from faucet.solana.com or solfaucet.com

### Create a test empty account

```bash
npx tsx scripts/create-dust.ts <YOUR_DEVNET_WALLET_ADDRESS>
```

Example:

```bash
npx tsx scripts/create-dust.ts 81kTLKjRBJBXt4CWz8mv5Fq9mSQVQsU9pDW81rbszxFT
```

The script will:

1. Attempt an automatic airdrop to a temporary payer account.
2. If the public faucet is rate-limited (HTTP 429), it will print a temporary address and wait, just send 0.05 SOL to it from faucet.solana.com or from your own Devnet wallet.
3. Create a random test token (Mint) on Devnet.
4. Register an empty token account for that token under your wallet address.

Once the script completes, click **Rescan** in the app and you'll see the new empty account ready to be closed. Repeat the script multiple times to create several test accounts.

---

## Tech Stack

| Layer      | Technology                                                                 |
| :--------- | :------------------------------------------------------------------------- |
| Framework  | [Next.js 16](https://nextjs.org/) (App Router)                             |
| Blockchain | [Solana Web3.js](https://github.com/solana-labs/solana-web3.js)            |
| Token ops  | [@solana/spl-token](https://github.com/solana-labs/solana-program-library) |
| Wallet     | [@solana/wallet-adapter](https://github.com/anza-xyz/wallet-adapter)       |
| Network    | Solana Devnet (configurable via `NEXT_PUBLIC_SOLANA_RPC_URL`)              |
| Styling    | Vanilla CSS (custom design tokens, no Tailwind)                            |
| Language   | TypeScript                                                                 |

---

## Configuration

| Environment Variable         | Default                  | Description                                  |
| :--------------------------- | :----------------------- | :------------------------------------------- |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Solana public Devnet RPC | Custom RPC endpoint (e.g. Helius, QuickNode) |

To switch to **Mainnet**, change `WalletAdapterNetwork.Devnet` to `WalletAdapterNetwork.Mainnet` in [`src/providers/SolanaProvider.tsx`](src/providers/SolanaProvider.tsx).

---

## Project Structure

```
solana-dust-cleaner/
├── src/
│   ├── app/
│   │   ├── page.tsx          # Main app UI & transaction logic
│   │   ├── layout.tsx        # Root layout with providers
│   │   └── globals.css       # Design tokens & global styles
│   └── providers/
│       └── SolanaProvider.tsx # Wallet adapter & network config
└── scripts/
    └── create-dust.ts        # Devnet testing helper script
```

---

## License

This project is licensed under the **Business Source License 1.1 (BSL-1.1)**.

- You may read, audit, fork, and run the code locally for personal use.
- Commercial hosting or production deployment by any party other than the author is not permitted.
- On **July 18, 2028**, the license automatically converts to **MIT** - free for everyone.

See the [LICENSE](LICENSE) file for full terms.

---

_Built for the Solana ecosystem. Not affiliated with Solana Foundation._
