# Submit this week — 48-hour sprint

Rolling applications, and a submission in month N is ranked in N+1. Submitting **now** with a
working board puts you in the November ranking and lets you pressure the team in Discord while
the product is already live. Every hour spent polishing is an hour not spent in the queue.

Ship in this order. Stop as soon as the form can be filled.

---

## Block 1 — 2 hours: repo, wallet, money

```powershell
git remote add origin https://github.com/<you>/mandate.git
git push -u origin main
```

- [ ] Repo is **public** and shows `mandate/`, `keeper/`, `web/`, `SUBMIT.md`
- [ ] Fresh wallet created — this is the deployer, the keeper, and the form's reward wallet
- [ ] ~$55 m.USDC + ~0.3 METIS on Andromeda. Confirm the m.USDC address from the Metis docs
      before sending anything. Do not guess it.

## Block 2 — 2 hours: deploy

```powershell
$env:DEPLOYER_PRIVATE_KEY="0x…"
$env:USDC_ADDRESS="0x…"
$env:COOLDOWN="600"
$env:FUND_PURSES="true"
node mandate/scripts/deploy.mjs
```

- [ ] Two addresses printed. Paste them into `mandate/FORM.md`
- [ ] `node mandate/scripts/preflight.mjs` with `ARENA_ADDRESS` + `CERTIFICATE_ADDRESS` —
      **14/14, including "scenario 1 is live" and "mandate hash matches policy.txt"**
- [ ] One real attempt from `cast`: approve, `submitAttempt(0, keccak)`, confirm `attemptCount` is 1

## Block 3 — half a day: keeper

- [ ] Container on Fly / Railway / Render (serverless will time out on inference)
- [ ] `JUDGE_BASE_URL` + `JUDGE_API_KEY`, and `MODEL_*_BASE_URL` for **three** labs you can afford
- [ ] `GET /health` shows the arena address and which models are real vs mock
- [ ] One attempt through `POST /attempts` → verdict → `relayTx`

If the keeper is not up in time, **still submit.** The contracts, the board and the attempt
flow are the product; the keeper is a service you can run by hand for a week.

## Block 4 — 2 hours: site

- [ ] Vercel, root directory `web/`, env vars from `web/.env.example`
- [ ] `/` loads without the "Preview data" badge
- [ ] Connect the funded wallet, submit one attempt through the UI
- [ ] Screenshot the board and a certificate

## Block 5 — submit, then push

- [ ] Replace the three **[FILL]**s in `mandate/FORM.md`
- [ ] Submit
- [ ] Post in the Discord: what it is, the live URL, one specific ask ("please try to break
      DeepSeek, the purse is at $12.70"). Being a known name in the channel is worth more than
      another week of features.

---

## Before you hit submit

- **Do not ship ten models if only three are real.** Trim `keeper/models.json` and
  `mandate/models.json` to the ones with keys, redeploy, and let the board show the real count.
  A reviewer who breaks a mock and reads a canned refusal has caught you overstating it.
- Contracts are **unaudited**, resolution is **operator-confirmed**, and there is **no TEE**.
  Say so in the application. It reads as competence, not weakness.

## The sentence that carries the application

One commit is one transaction. A break pays out and mints a certificate in the same resolution.
So a single engaged person produces six real transactions per week, and the board shows a
reviewer exactly why — no padding anywhere in the product.
