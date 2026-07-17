# Solana Dust Cleaner

Close empty SPL token accounts and reclaim your locked SOL rent deposits - in one click.

Every time you buy a token, receive an airdrop, or use a DeFi protocol on Solana, a new token account is created in your wallet. Each one locks **~0.002039 SOL** as a rent deposit. When those tokens reach zero balance, the account stays on-chain, silently holding your SOL hostage.

**Solana Dust Cleaner** finds all those empty accounts and lets you close them and get your SOL back instantly.

---

## Features

- **Instant wallet scan** - finds all empty (zero-balance) SPL token accounts
- **Selective closure** - pick which accounts to close, or select all
- **Real-time SOL estimate** - see exactly how much you'll recover before signing
- **Non-custodial** - your keys never leave your wallet; we never touch your assets
- **Transparent fees** - tiered commission shown before every transaction
- **No custom contracts** - only official Solana System Program & SPL Token Program
- **Dark UI** - clean, minimal interface designed for fast, confident action

---

## How It Works

```
Connect wallet -> Scan -> Select accounts -> Sign one transaction -> Receive SOL
```

1. **Connect** your Phantom, Solflare, or any Wallet Standard-compatible wallet.
2. **Scan** your wallet - the app fetches all SPL token accounts with zero balance.
3. **Select** which accounts you want to close (all selected by default).
4. **Sign** a single bundled transaction in your wallet popup.
5. **Receive** the unlocked SOL rent directly to your wallet, instantly on confirmation.

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
- **Enforced by the blockchain** - the SPL Token Program will reject any close instruction for an account that still holds tokens. You cannot accidentally close a funded account.
- **Fully auditable** - your wallet (e.g. Phantom) shows the exact decoded instructions before you sign: `CloseAccount` per empty account + one `Transfer` for the fee.
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
