# Metis Rise — application, filled

Everything below is ready to paste except the three items marked **[FILL]**, which must be
real before you submit: the repo, the deployed addresses, and the live URL. Do not submit
placeholders — the contract list is the field they check hardest.

---

### Project name

Mandate

### One-line description

Ten AI models, each holding $5 of real money on Metis and a written treasury policy — talk one out of its purse and you take it, plus a numbered certificate.

### Category

Consumer

> Alternative: Developer Tools. Consumer is the better claim — anyone can play, no SDK needed, and it keeps you out of the DeFi bucket where a dozen applicants will be fighting. The benchmark framing lives in the description instead.

### GitHub repository

**[FILL]** e.g. `https://github.com/<you>/mandate` — public, with `mandate/contracts`, `mandate/SPEC.md`, and the referee service.

### Smart contract address(es) on Metis Andromeda Mainnet

Deploy first, then paste:

```
0x… MandateArena          (model registry, purses, attempt commits, keeper verdicts, payouts)
0x… BreakCertificate      (ERC-721, one per break, numbered)
```

No factory and no proxy: both are immutable, deployed once, no upgrade path. Every purse,
attempt and payout routes through `MandateArena`, so its USDC inflows and outflows are the
complete gas and volume picture — nothing happens off-contract except the model inference.

### Live dApp / Product URL

**[FILL]** — the board of ten models, the purses, the attempt flow, the certificate gallery.

### Website

**[FILL]** — same domain is fine.

### Which problems does your project solve on-chain?

> Every AI agent that touches money is defended by a claim nobody can check: "it can not be talked into paying the wrong address." Off-chain that claim is unfalsifiable. The operator keeps the transcripts, chooses which attempts to publish, and can quietly re-run a patched model after a failure. Mandate makes it checkable. A scenario is one written mandate, live for every standing model at the same time, so the order the models fall in is a like-for-like comparison rather than a set of unrelated puzzles - the "this scenario was harder for my model" objection cannot be raised when there is only one scenario. Each purse is a real balance in a contract on Metis. An attempt is a commit hash with a timestamp, so it provably existed before the verdict. The verdict is a signed message carrying the transcript hash, so a break cannot be retracted later. A break pays the purse and mints a numbered certificate, so "this model was broken on this date by this handle" is a fact about the chain rather than a press release. A model that breaks is removed from the scenario, so each scenario ends with a ranked list of what survived. The money is what makes the benchmark honest: volunteers test what they find interesting, a real purse makes people test what actually breaks.

### ERC20 wallet address for receiving rewards

**[FILL]** — a fresh address on 1088 that you control, not a CEX deposit address and not one you've reused on other chains.

---

## Before you submit

- [ ] `node mandate/scripts/compile.mjs` — clean build
- [ ] `cd mandate; forge test` — 24/24 green
- [ ] `node --experimental-strip-types mandate/scripts/e2e.mjs` — `digest match: true`, `E2E PASS`
- [ ] `node mandate/scripts/deploy.mjs` with `USDC_ADDRESS` set to m.USDC on Andromeda, `FUND_PURSES=true` for the ten $5 purses
- [ ] `mandate/deployments/metis.json` written — copy both addresses into the form
- [ ] One real attempt submitted end-to-end (commit → verdict → resolve) so you know the loop works with real money
- [ ] Certificate `tokenURI` resolving to something that renders
- [ ] The trust disclosure published: keeper key, EIP-712 payload, "operator-confirmed resolution in v1"

## What is not built yet

Be straight about this if anyone asks, and never claim otherwise in the application:

- No frontend yet (board, attempt flow, certificate gallery)
- No X OAuth yet; wallet-only is enough for the first round
- No TEE attestation, no dispute jury — v1 is operator-confirmed resolution, disclosed as such
- No model providers wired beyond whichever two or three you run in round one
- Contracts are unaudited. Pilot money only, $50 at risk, no upgrades

## Why this is a good Rise entry, in one paragraph

The programme wants new projects with real usage on Andromeda. Mandate's usage is the
product: every attempt is a paid transaction, every break is a payout, and the board gives
people a reason to come back until a purse is taken or the season ends. It is also the only
entry in the cohort that produces a public safety result for agent payments, which is the
exact surface Metis is courting with x402 and agent wallets — so the story is not "our dApp
has users," it is "our dApp is where you find out whether agent treasuries hold."
