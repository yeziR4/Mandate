# Mandate

Ten AI models, each holding $5 of real money on Metis and a written treasury policy. Talk one
out of its purse, take the purse, keep a numbered certificate.

- `SPEC.md` — the product: loop, scoring, economics, trust model
- `FORM.md` — the Metis Rise application, filled
- `policy.txt` — the mandate every model is given (source of truth)
- `models.json` — the ten models
- `contracts/` — `MandateArena`, `BreakCertificate`
- `referee.ts` — rubric, EIP-712 payload, verdict signing, judge prompt
- `test/` — 24 Foundry tests
- `scripts/` — compile, deploy, end-to-end check

## Build and test

```powershell
npm.cmd install                # solc + openzeppelin (for scripts/compile.mjs)
node mandate/scripts/compile.mjs
cd mandate; forge test
npx.cmd tsc --noEmit
```

## Local end-to-end (real signatures, no real money)

```powershell
cd mandate
anvil --chain-id 1088 --silent &
forge create test/MandateArena.t.sol:MockUSDC --rpc-url http://127.0.0.1:8545 `
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast
cast send <mock-usdc> "mint(address,uint256)" 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 1000000000 `
  --rpc-url http://127.0.0.1:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

$env:DEPLOYMENT_NAME="local"
$env:DEPLOYER_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
$env:USDC_ADDRESS="<mock-usdc>"
$env:RPC_URL="http://127.0.0.1:8545"
$env:FUND_PURSES="true"
node scripts/deploy.mjs

node --experimental-strip-types scripts/e2e.mjs   # E2E PASS expected
```

The e2e check is the important one: it builds the verdict with `referee.ts`, compares its
typed-data hash against the contract's own `resolveDigest`, has the keeper sign it, and has an
unrelated address relay it. If `digest match: true` the referee and the contract agree.

## Mainnet

```powershell
$env:DEPLOYER_PRIVATE_KEY="0x..."
$env:USDC_ADDRESS="0x..."          # m.USDC on Andromeda — confirm from Metis docs
$env:KEEPER_ADDRESS="0x..."        # optional, defaults to deployer
$env:FUND_PURSES="true"
$env:COOLDOWN="600"                # 10 min between attempts per address
node mandate/scripts/deploy.mjs    # writes deployments/metis.json
```

## Front end

`web/` is a Vite + React + TypeScript app. It runs on design data until the two contract
addresses are set, and the header says "Preview data" whenever they are missing — so an
undeployed build can never be mistaken for live state.

```powershell
cd web
npm.cmd install
npm.cmd run dev      # http://localhost:5173
npm.cmd run build
```

Set `VITE_ARENA_ADDRESS`, `VITE_CERTIFICATE_ADDRESS`, `VITE_USDC_ADDRESS` (and optionally
`VITE_RPC_URL`, `VITE_DEPLOY_BLOCK`, `VITE_KEEPER_URL`) from `web/.env.example`.

Deploying on Vercel: set the project root to `web/`. `web/vercel.json` handles SPA routing.

Visual QA screenshots (desktop + mobile, every route):

```powershell
cd web
$env:CHROME_PATH="<path to chrome.exe>"
node scripts/shots.mjs
```

## Not built yet

Keeper service, X OAuth, model providers, TEE attestation, dispute jury. Contracts are
unaudited: pilot money only, $50 at risk, no upgrade path.
