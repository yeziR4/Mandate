# Submit this week — 48-hour sprint

Rolling applications, and a submission in month N is ranked in N+1. Submitting **now** with a
working board puts you in the November ranking and lets you pressure the team in Discord while
the product is already live.

## Launch economics (added 28 Oct)

Money no longer gates the launch:

- **Certificate first, payment later.** A confirmed break mints immediately. The bounty ($5.00) is
  stored in the certificate at mint time and transferred at season close.
- **Attempt fee is 0 at launch.** An attempt costs gas and nothing else, so a user needs METIS and
  a legitimacy signal — not m.USDC, not a bridge, not a deposit. The fee is owner-switchable via
  `setAttemptFee` and should be turned on only after the first cohort is onboarded.
- **Nothing is escrowed**, and the site now says so in four places. Do not describe the bounty as
  "money in the contract" in the application; describe it as an amount recorded on-chain and
  settled at close.

This is the GraySwan model: score and certify now, pay on a schedule.

## Four rules from the article that change the plan

1. **Ranking is 80% valid monthly active users, 20% METIS gas.** Settled volume only counts toward
   the per-user floor, never toward rank. So the job is *distinct humans doing transactions*, not
   pool size. Do not spend a dollar chasing volume.
2. **Every counted user needs a legitimacy signal**: a unique Telegram ID, a Privy login, a Web3
   social handle, or a wallet older than 14 days or with prior Metis history. **We have none of
   these.** A fresh wallet from a cold visitor does not count, no matter how many attempts it makes.
3. **Wallets funded by the deployer, or from the same upstream source, do not count.** No gas
   airdrops, no USDC credit, no sponsored first attempt. Users must arrive with their own funds —
   or the signup must create a *Privy* wallet, which is the one path the brief explicitly blesses.
4. **Indexing starts on Day 1 of month N+1.** Activity in October scores nothing. Use October to
   deploy and prepare, and have users ready to transact on 1 November.

**The blocker is item 2.** Everything else is hours of work.

## Verified on chain, 27 Oct

- **m.USDC** — `0xEA32A96608495e54156Ae48931A7c20f0dcc1a21`, symbol `m.USDC`, 6 decimals.
  Read from the contract, not from a blog. It is now the default in `deploy.mjs` and `preflight.mjs`.
- **ERC-8004 is live on Andromeda** — IdentityRegistry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
  (EIP-1967 proxy, impl `0x7274e874ca62410a93bd8bf61c69d8045e399c02`, `name()` returns
  `AgentIdentity`), ReputationRegistry `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`.
  `node mandate/scripts/register-agents.mjs` registers each model as an agent identity.
  **Do not quote that as a product feature until you run it.**

---

## Block 1 — 2 hours: repo, wallet, money

```powershell
git remote add origin https://github.com/<you>/mandate.git
git push -u origin main
```

- [ ] Repo is **public** and shows `mandate/`, `keeper/`, `web/`, `SUBMIT.md`
- [ ] Fresh wallet created — deployer, keeper, and the form's reward wallet
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
- [ ] `node mandate/scripts/preflight.mjs` — **14/14, including "scenario 1 is live"**
- [ ] One real attempt from `cast`: approve, `submitAttempt(0, keccak)`, `attemptCount` is 1

## Block 3 — the blocker: a legitimacy signal

Pick one, in order of preference:

- [ ] **Privy** (`@privy-io/react-auth`) — email/social login, embedded wallet, and the brief names
      it as a valid signal. Also removes the "install a wallet to attempt" wall, which is the whole
      onboarding problem. Needs an app ID; free tier is enough for a pilot.
- [ ] **X login bound to the wallet** — a Web3 social handle is a listed signal. Store
      handle ↔ address, show the handle on the board, verify the link.
- [ ] **Telegram ID** — same idea, one row per Telegram account.

Whichever you pick, the board should show the signal next to each breaker. It is the difference
between "activity" and "counted activity" in the payout snapshot.

## Block 4 — half a day: keeper

- [ ] Container on Fly / Railway / Render (serverless times out on inference)
- [ ] `JUDGE_BASE_URL` + `JUDGE_API_KEY`, and `MODEL_*_BASE_URL` for **three** labs you can afford
- [ ] `GET /health` shows the arena and which models are real vs mock
- [ ] One attempt through `POST /attempts` → verdict → `relayTx`

If the keeper is not hosted in time, **still submit.** It can run by hand for a week.

## Block 5 — 2 hours: site

- [ ] Vercel, root directory `web/`, env vars from `web/.env.example`
- [ ] `/` loads without the "Preview data" badge
- [ ] An attempt through the UI, then verify the transcript on the certificate page
- [ ] Screenshot the board and a certificate

## Block 6 — submit, then push

- [ ] Replace the three **[FILL]**s in `mandate/FORM.md`
- [ ] Submit
- [ ] Discord: post the live URL and one specific ask ("try to break DeepSeek, its purse is at
      $12.70"). Be useful in that channel first — answer someone else's question, then mention it.

---

## Before you hit submit

- **Do not ship ten models if only three are real.** Trim `keeper/models.json` and
  `mandate/models.json`, redeploy, let the board show the real count. A reviewer who breaks a mock
  and reads a canned refusal has caught you overstating it.
- Contracts are **unaudited**, resolution is **operator-confirmed**, no TEE. Say so. It reads as
  competence.
- Ask in Discord whether ERC-8004 is deployed on Andromeda yet. If it is, registering the ten
  agents is a few transactions and turns "a benchmark" into "a benchmark of identified agents" —
  the brief's own vocabulary.

## The sentence that carries the application

One commit is one transaction. A break pays out and mints a certificate in the same resolution.
So a single engaged person produces six real transactions in a week, and the board shows a
reviewer exactly why — no padding anywhere in the product.

