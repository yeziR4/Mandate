# Submit by 1 November — checklist

Today is 27 October. Everything below is ordered by what blocks the application form.
The form needs exactly four things that do not exist yet: **a public repo, two mainnet
addresses, a live URL, and a working attempt loop.**

---

## Day 1 (today) — repo and key

- [ ] Create an empty **public** GitHub repo, then:
  ```powershell
  git init
  git add .
  git commit -m "Mandate: purses, mandates, keeper, board"
  git remote add origin https://github.com/<you>/mandate.git
  git push -u origin main
  ```
- [ ] Create a fresh wallet for the pilot. Note its address — this is the form's reward wallet too.
- [ ] Fund it with ~$55 of m.USDC and ~0.5 METIS. Confirm the m.USDC address from the Metis docs
  before sending anything.
- [ ] `node mandate/scripts/preflight.mjs` — expect the USDC and gas checks to pass, arena to fail
  (it is not deployed yet).

## Day 2 — deploy

```powershell
$env:DEPLOYER_PRIVATE_KEY="0x…"
$env:USDC_ADDRESS="0x…"            # m.USDC on Andromeda, confirmed
$env:KEEPER_ADDRESS="0x…"          # a separate key from the deployer, if you can
$env:COOLDOWN="600"
$env:FUND_PURSES="true"
node mandate/scripts/deploy.mjs
```

- [ ] Two addresses printed → paste into `mandate/FORM.md`
- [ ] `node mandate/scripts/preflight.mjs` with `ARENA_ADDRESS` and `CERTIFICATE_ADDRESS` set — all green
- [ ] Confirm the ten purses are visible on the explorer

## Day 3 — keeper

- [ ] Deploy the keeper to a container host (Fly / Railway / Render). See `keeper/README.md`.
- [ ] Set `JUDGE_BASE_URL` + `JUDGE_API_KEY`, and per-model `MODEL_*_BASE_URL` for at least
  **three** labs. Leave the rest on mock rather than fake them.
- [ ] `GET /health` returns your arena address and the real model count
- [ ] Run one real attempt end to end: commit → POST → verdict → relay → `getAttempt` shows resolved

## Day 4 — site

- [ ] `cd web; npm.cmd run build`
- [ ] Vercel project, **root directory `web/`**, env vars from `web/.env.example`
- [ ] Load `/` — the "Preview data" badge must be gone
- [ ] Load a model page, connect the funded wallet, submit a real attempt through the UI
- [ ] Screenshot the board, a model page, the certificate page

## Day 5 — apply

- [ ] `mandate/FORM.md` — every **[FILL]** replaced with a real URL or address
- [ ] Read the description paragraph out loud once. It should sound like something you would say.
- [ ] Submit. Applications in month N are ranked in month N+1, so a submission on 31 October
  puts you in the November ranking with the board already live.

---

## What is honestly not ready

Say this if asked, and never imply otherwise:

- Contracts are **unaudited**. Fifty dollars at risk, no upgrade path, no admin drain.
- Resolution is **operator-confirmed**: the keeper signs, a human approves every break.
  No TEE, no dispute jury.
- X sign-in is not built; the site is wallet-only.
- Only the models with real API keys are real. The rest run mock and the board does not say so
  yet — either wire them or remove them from `models.json` before you apply.

## The number that matters

The programme wants 15+ wallets doing 3+ transactions a month. One commit is one transaction.
A broken model pays out and mints in the same resolution, so a single good attempt is worth six
transactions per person — there is no padding anywhere in this product, and the board makes that
visible to a reviewer in about four seconds.

That is the strongest thing you can say in the application, and it is true from the first
gameweek.
