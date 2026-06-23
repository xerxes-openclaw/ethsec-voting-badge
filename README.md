# ETHSecurity Voting Badge

A private voting-address registry for holders of the ETHSecurity Badge NFT.
Addresses are encrypted in the browser with **ML-KEM-768 + AES-256-GCM**,
stored as ciphertext, and decrypted offline by the round administrator after
voting closes.

## Overview

The goal is unlinkability: a badge holder's on-chain voting and donation
activity should not be trivially traceable back to their public,
badge-holding wallet. A holder submits a separate voting address, which is
encrypted client-side and never leaves the browser in plaintext. The backend
only ever stores ciphertext.

The submitted address is later used to receive:

- A Voting NFT
- Gas money
- 46 FINN — worth 1 Finney (0.001 ETH) each if donated in the QF round

Every $1 donated from the submitted address counts as $4 toward directing the
matching pool. The same address may be reused in future rounds.

## Two modes

When you open the app you pick one of two modes.

### Online — normal dApp flow

For badge holders on a regular internet-connected machine.

1. Click **Online**.
2. **Connect Wallet** → pick the wallet holding your badge.
3. The app auto-detects your `tokenId` onchain.
4. Enter your voting address → **Encrypt & Sign**.
5. Sign the EIP-712 message. The voting address is encrypted in-browser and
   posted with the signature.

One badge = one submission. Re-submissions are rejected.

### Offline — airgapped signing

For badge holders whose signing key lives on an airgapped machine.

1. Click **Offline**.
2. Fill in: holder wallet, badge tokenId, voting address.
3. Click **Encrypt & prepare message**.
4. Pick a signing path:
   - **Connect wallet** — uses a local wallet extension (MetaMask, Rabby,
     Frame) including any hardware wallet plugged into this machine.
   - **Sign externally** — copy the EIP-712 payload, sign with `cast wallet
     sign-typed-data`, `pnpm sign-offline`, MyEtherWallet's offline signer, or
     any other EIP-712 signer; paste the `0x…` signature back. The page
     verifies the signature recovers to the declared holder wallet before
     producing the blob.
5. Download the signed blob `ethsec-submission-badge-<id>.json`.
6. On any online machine, open the app again, pick **Offline**, and use the
   **Submit a signed blob** section to upload.

What crosses the air gap: the signed JSON. What stays on the signing machine:
the private key and the plaintext voting address.

## Architecture

| Package            | Role                                                                    |
| ------------------ | ----------------------------------------------------------------------- |
| `apps/api`         | Fastify server. Verifies EIP-712 sig + onchain ERC-721 ownership.       |
| `apps/web`         | Vite + React + RainbowKit frontend. Submission and admin-decrypt UI.    |
| `packages/shared`  | Hybrid encryption (ML-KEM-768 + AES-256-GCM). Browser- and Node-safe.   |
| `scripts`          | `keygen`, `decrypt`, `sign-offline` CLI tools.                          |

API routes: `GET /config`, `GET /token-status/:id`, `POST /submit`,
`GET /admin/export` (bearer-auth).

## Security model

Admin power is split across two secrets held by the same person:

1. `ADMIN_EXPORT_TOKEN` — grants access to the encrypted CSV dump.
2. ML-KEM-768 private key — decrypts the ciphertexts.

Either alone is useless: the token yields ciphertext blobs you can't read; the
private key yields nothing to fetch. Both secrets live only on the
administrator's local machine. The browser admin page decrypts entirely
client-side; the private key never reaches a server.

## Development

```bash
pnpm install
pnpm dev          # run the web + api dev servers
pnpm test         # full test suite
pnpm typecheck    # tsc --noEmit
```

Environment variables are documented in `apps/api/.env.example` and
`apps/web/.env.example`.

## License

MIT.
