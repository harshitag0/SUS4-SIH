# Digital agreements & blockchain integrity (AgriLink Trust)

## Flow
1. Buyer posts a requirement → farmers are notified.
2. Farmer commits tons (after "Check before you sign") → a **draft agreement** is created automatically (`AGL-YYYY-NNNNN`).
3. Either party completes the terms (live formal preview) → **Send for signature**: the draft PDF is generated and stored write-once; its SHA-256 is what each signature commits to. Terms are now locked.
4. Each party signs through the e-signature provider: **mobile OTP identity check → typed or drawn signature → explicit consent**. A certificate ID, timestamp, IP and device are recorded.
5. When both have signed: the **signed PDF** (with a Signature Certificate page) is stored write-once, its **SHA-256 is registered on Polygon** via the `AgreementRegistry` contract, the commitment becomes binding (requirement filled), both parties are notified.
6. Lifecycle milestones are recorded in order by the right role (harvest → inspection → packing → dispatch → received → payment).
7. **Amendments** freeze the current version (PDF + on-chain record) and open version n+1, which both must sign again; on-chain, the new record links to the previous hash.
8. **Verify Document Integrity**: the browser hashes any PDF locally; the hash is looked up on-chain → green "Verified — Original document unchanged" or red "Verification failed — Document may have been modified".

## What is on-chain vs off-chain
| On-chain (`AgreementRegistry`) | Off-chain |
|---|---|
| `keccak256(agreementId)`, SHA-256 of signed PDF, version, previous-version hash, timestamp, registrar | PDF (write-once store; S3 Versioning + Object Lock in production), names, phones, prices, signature evidence (MongoDB, role-based access) |

## Pieces
- `blockchain/contracts/AgreementRegistry.sol` — OpenZeppelin AccessControl + Pausable; append-only versions; one registration per hash; `lookup(hash)`, `latest(ref)`, `getVersion(ref, v)`, `isLatest`. Tests: `cd blockchain && npm test`.
- `server/src/modules/contracts/` — `service.js` (lifecycle rules), `chain.js` (ethers v6), `pdf.js` (pdfkit), `storage.js` (write-once), `audit.js` (hash-chained audit trail), `esign/` (provider interface), `routes.js` (`/api/contracts/*`).
- `client/src/pages/contracts/` — Dashboard, Detail (document · signatures · blockchain · timeline · audit · versions), Edit (structured form + live legal preview), Sign (review → OTP → signature → certificate), Verify, Network.

## Running
```bash
cd blockchain && npm install && npm run node          # local Polygon-compatible chain on :8545 (keep running)
cd blockchain && npm run deploy:local                  # writes deployments/localhost.json
```
The API reads `blockchain/deployments/localhost.json`. The local chain forgets everything on restart: the API detects this, redeploys the registry and re-anchors all registered versions (marked "re-anchored" in the UI and audit trail).

**Polygon Amoy / mainnet:** set `CHAIN_RPC`, `CHAIN_PRIVATE_KEY` (registrar wallet with POL for gas — never commit it) and `CHAIN_DEPLOYMENT`, then `npm run deploy:amoy`. The UI shows the real network name and explorer links automatically.

## Honest limits of this build
- **E-signature:** the active provider is the built-in **sandbox** (OTP code `1234` in demo). Zoho Sign / DocuSign adapters are stubs enabled by API keys; legal enforceability needs one of them (or Aadhaar eSign) in production.
- **Storage:** local write-once folder (`server/storage/agreements`) stands in for S3; production should use S3 with Versioning + Object Lock + KMS.
- **Database:** MongoDB (the project's MERN choice) instead of PostgreSQL.
- **Network:** development runs on a local Hardhat chain (chainId 31337), not on public Polygon.
