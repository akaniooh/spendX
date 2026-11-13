# SpendX

Pay on any chain with any token. SpendX is a cross-chain payment layer built on **NEAR Intents**:
a merchant asks for an exact amount of a token on a chain of their choice, a customer pays from
whatever token and chain they hold, and NEAR Intents routes and settles the payment.

> **Status: work in progress (hackathon build, NEAR HACKATHON 2026).**
> This README describes only what exists today. Sections marked *not yet implemented* are planned, not working.

## The problem

Paying someone on a different chain normally means swapping, bridging, maybe swapping again, then
sending. SpendX turns that into one step: the customer picks what they hold, SpendX asks NEAR Intents
for a live quote that delivers an **exact** amount to the merchant, and tracks the transfer to delivery.

## How a payment works (design)

1. Merchant creates a request: amount, destination token and chain, recipient address.
2. Customer opens the link, connects a wallet, and picks a source token and chain from the **live** NEAR Intents catalog.
3. SpendX requests a quote with `swapType: EXACT_OUTPUT` (merchant receives exactly the requested amount), `depositType: ORIGIN_CHAIN`.
   A `dry: true` quote is used for previews; a live quote creates the deposit address.
4. SpendX checks the live quote against the request (asset, recipient, amount, deadline, 1Click signature) before showing it.
5. The customer authorizes one transfer from their own wallet to the quote's deposit address. SpendX never holds keys.
6. SpendX polls the 1Click status API and, where it can, independently checks delivery on the destination chain.
   A payment is only shown as confirmed once delivery is confirmed.
7. If the swap fails, 1Click refunds to the customer's refund address; SpendX shows the refund.

Nothing is hardcoded to specific chains or tokens: selectors are built from the 1Click token catalog,
and whether a pair is routable is decided by the live quote, never assumed.

## NEAR technologies used

- **NEAR Intents, 1Click Swap API** (`https://1click.chaindefuser.com`): `GET /v0/tokens`, `POST /v0/quote`,
  `POST /v0/deposit/submit`, `GET /v0/status`.
- Docs: <https://docs.near-intents.org/>. Explorer: <https://explorer.near-intents.org>.

## What works today

Supported wallet families, by design: **Solana, EVM and NEAR**. Merchants can already request payment on
**any chain in the live catalog** (receiving needs only an address). Paying is wired for the wallets below.

| Area | State |
| --- | --- |
| 1Click client, dynamic catalog, exact-output quotes, live-quote validation, signature check | Implemented. Tokens and dry quotes verified against the live API |
| Payment service (requests, previews, attempts, deposits, status, refunds, expiry, duplicate protection) | Implemented, unit-tested with stubs |
| Merchant sign-in by wallet signature (EVM and Solana) | Implemented; Solana tested with real keys, EVM not yet exercised with a real wallet |
| REST API and Express server | Implemented; runs locally (verified: `/api/health`, `/api/catalog`) |
| Landing page (home): hero with a real live quote, network and token counts read from the live catalog, how it works, networks, NEAR Intents credit | Implemented; every number on it comes from the live API, nothing is mocked |
| Web app in the SpendX design: swap workspace, payment screen, wallet modal, review modal, activity table, merchant dashboard, live status tracker | Implemented; bundles and type-checks; **not yet exercised in a browser with real wallets** |
| Merchant sign-in with a NEAR wallet (NEP-413) | *Not yet implemented* (sign in with an EVM or Solana wallet; you can still receive on NEAR) |
| AI assistant: describe a swap in a sentence ("10 SOL to USDC on Base") and the Swap card is filled in for review. It only proposes; it cannot connect, sign or send anything. A pasted payment link opens that payment directly | Implemented and unit-tested with simulated model replies; **not yet tried with a real model**. Optional: hidden unless `ANTHROPIC_API_KEY` is set |
| Dynamic network and token selectors (look-alike tokens flagged) | Implemented |
| One-click **Swap** (send an exact amount, receive another token on any chain, delivered to your own address) | Implemented end to end; **not yet exercised in a browser or with real funds** |
| Paying from **Phantom (Solana)**: native SOL only | Implemented, untested with real funds |
| Paying from a **NEAR wallet**: NEP-141 tokens (USDC, USDT and others), including one-time storage registration for the deposit address | Implemented with `@hot-labs/near-connect`; adapter logic unit-tested against a fake NEAR RPC; **not yet run with a real wallet or funds** |
| Paying from **EVM wallets**: native currency and ERC-20 on Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Gnosis, Scroll | Implemented, untested with real funds |
| Paying with Solana tokens (SPL) | *Not enabled yet* (token-account handling still to be confirmed) |
| Supabase storage | Mapping tested; **not yet run against a real database** (`REPOSITORY=memory` works for local development) |
| Independent delivery verification on **EVM and Solana** destinations: SpendX reads the destination chain's own RPC and requires the recipient to have received at least the promised amount (ERC-20 `Transfer` logs, native transfers, SPL token and SOL balance changes) before showing "Verified on-chain" | Implemented; tested against simulated chain responses for correct, wrong-recipient, too-little, reverted and not-yet-visible deliveries; **not yet run against the live chains** |
| Delivery verification for **NEAR** destinations and other chains | *Not available*: delivery is shown as "reported by NEAR Intents" with the destination transaction link, never as "verified" |
| Real mainnet payments | *None performed yet* |

## Install and run

Requires Node.js 22.18 or newer.

```bash
npm install
cp .env.example .env        # then edit .env (see Configuration)
npm test                    # unit tests, no network needed
```

The landing page is the home page (`http://localhost:5173/`); **Launch app** opens the swap at `#/swap`.

Two terminals:

```bash
npm start      # API on http://localhost:8787
npm run dev    # web app on http://localhost:5173 (proxies /api to the API)
```

For a single-server build, run `npm run build` and then `npm start`; the API serves `web/dist`.

### Configuration

Copy `.env.example` to `.env`. Never commit `.env`.
- `SESSION_SECRET` (required): at least 32 random characters.
- `REPOSITORY=memory` for local development (data resets on restart), or Supabase credentials after running `supabase/migrations/0001_init.sql`.
- `ONECLICK_API_KEY` (optional, free from <https://partners.near-intents.org>): without it an extra 0.25% fee applies to live quotes.
- Optional `VITE_SOLANA_RPC_URL`: a Solana RPC endpoint for the browser. The default public endpoint is rate-limited.
- Optional `ANTHROPIC_API_KEY` (and `ANTHROPIC_MODEL`, default `claude-haiku-5-5`; check the name against Anthropic's docs): enables the assistant. Server-side only.
- Optional `SOLANA_RPC_URL` and `RPC_URL_<CHAIN>` (for example `RPC_URL_BASE`): endpoints the server uses to verify delivery. EVM chains default to viem's public RPC.

### Explore the live catalog (no wallet, no funds)

`npm run discover` lists the live catalog; `npm run discover -- --find USDC` and `--chain sol` list assets;
`npm run discover -- --pair "sol:SOL>base:USDC" --amount 1 --addr "svm=<solana address>,evm=<0x address>"`
requests a **dry** quote (it can never create a deposit address or move funds).

## How to connect wallets

Click **Connect wallet** at the top right. EVM wallets (MetaMask, Rabby, Coinbase Wallet and any other
EIP-6963 wallet) are detected automatically; Phantom is detected from its browser extension; for NEAR, click
**Connect** on the NEAR row and pick a wallet in NEAR Connect's own selector (HOT, Meteor, Nightly and others). SpendX never asks
for private keys or seed phrases. Signing in as a merchant signs a text message only.

## Testing instructions (no funds needed)

1. **Action:** Run `npm start` and `npm run dev`; open <http://localhost:5173>.
   **Expected result:** The SpendX home page with Home, Payments, Activity and Merchant in the navigation and wallet buttons at the top right.
2. **Action:** Click **Connect** for your EVM wallet (or Phantom) and approve.
   **Expected result:** A chip with the wallet name and a shortened address appears.
3. **Action:** Open **Merchant**, click **Sign in with ...**, and sign the message in your wallet.
   **Expected result:** The wallet shows a plain-text message (no transaction, no fee). You land on the merchant page showing "Signed in as ..." and the create form.
4. **Action:** Choose a network and token to receive (for example Base and USDC), enter an amount like `1`, paste a recipient address, and click **Create payment link**.
   **Expected result:** A payment link appears with **Copy link** and **Open payment page**. The Payments table shows the new request with "No payment yet".
5. **Action:** Click **Open payment page**, choose a network and token to pay with (no wallet needed yet).
   **Expected result:** The amount you would pay appears in the **You pay with** box, with estimated fees and expected delivery time, from a live NEAR Intents dry quote. Unsupported tokens are greyed out with the reason. The button reads **Connect wallet** until you connect one.

## How to try the one-click Swap (no funds needed to see the quote)

1. **Action:** Open **Swap**, choose a source network and token, enter an amount, then choose a destination network and token (any network in the list). No wallet is needed for this step.
   **Expected result:** After a moment the **You receive** box shows the estimated output, and the details under the card show the rate, the guaranteed minimum, the estimated cost and the expected time. Before a quote arrives, an indicative rate from catalog prices is shown and labelled as such. Connecting a wallet fills in **Deliver to** with your own address.
2. **Action:** Change the slippage or the amount.
   **Expected result:** The estimate refreshes. A warning appears if spread and fees exceed about 3% of the amount.

Completing a swap uses real funds, so follow the real-funds steps below with a small amount.

## How to try the assistant (needs `ANTHROPIC_API_KEY`; no funds)

1. **Action:** Set `ANTHROPIC_API_KEY` in `.env`, restart `npm start`, and open **Swap**.
   **Expected result:** A "Describe it" input appears above the swap card. Without a key it does not appear.
2. **Action:** Type `10 SOL to USDC on Base` and press Enter.
   **Expected result:** The card fills in (send 10 SOL on Solana, receive USDC on Base) and the live estimate appears. Nothing is sent.
3. **Action:** Type `swap some USDC to SOL`.
   **Expected result:** A question instead of a guess, for example "Which network is USDC on? It is available on ...".
4. **Action:** Paste a SpendX payment link.
   **Expected result:** That payment opens directly, with no AI involved.

How it stays safe: the model only extracts fields into a fixed schema. Ordinary code matches tokens against the live catalog,
validates amounts and addresses, and reports ambiguity. The assistant has no wallet access and no ability to send; every
transaction still needs your approval in your own wallet. An address taken from your message is flagged for you to check.

## How to perform a test payment (real funds, mainnet)

NEAR Intents has no testnet, so a real payment uses real tokens. Use a small amount (around 1 USDC) and a recipient
address you control. Not yet tested end to end; this will be updated with real transaction hashes.

6. **Action:** On the payment page click **Continue to final quote**.
   **Expected result:** A "Final quote" card shows the exact amount you will send, the deposit address, your refund address, and a countdown. Nothing has been sent yet.
7. **Action:** Click **Approve in wallet and pay ...** and approve in your wallet.
   **Expected result:** Your wallet shows a transfer to the deposit address. After approving you are taken to the status page.
8. **Action:** Watch the status page.
   **Expected result:** Steps advance from "Source transaction submitted" to "Processing cross-chain transfer" to "Destination payment confirmed" (about 20 to 40 seconds after the deposit confirms for the routes tested).

## How to verify the destination transaction

On the status page, **Source transaction** and **Destination transaction** link to block explorers. Open the
destination link and confirm the recipient address and token amount.

The page also states how delivery was confirmed. **Verified on-chain** means SpendX itself read the destination
chain and saw the recipient receive at least the promised amount. **Delivery reported by NEAR Intents** means the chain
type cannot be checked by SpendX (for example NEAR), so only NEAR Intents' report and the transaction link back it up.
If the transaction exists but does not match the recipient or amount, the payment is shown as **Needs review**, never as paid.



## Network and cost notes

NEAR Intents has **no testnet**. Testing real payments means mainnet with small amounts of real tokens
(plus gas on the source chain). Dry quotes are free. The app will never sign or send a transaction
without an explicit confirmation in the user's own wallet.

## Hackathon disclosure

- Built during NEAR HACKATHON (2026-11-01 to 2026-11-14). No pre-hackathon code.
- UI/UX design: supplied by the team as a Figma Make export (a cross-chain transfer interface). Its layout, palette and
  typography are implemented in plain CSS and React; its placeholder content (mock routes, canned assistant replies and
  portfolio figures) was deliberately not used.
- Libraries: React, Vite, viem, @solana/web3.js, @hot-labs/near-connect, Express, @supabase/supabase-js,
  @defuse-protocol/one-click-sdk-typescript. Fonts: DM Sans and Manrope (Google Fonts).
