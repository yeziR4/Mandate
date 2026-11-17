# Video brief — Mandate, for Metis Rise

For the video agent. Everything here is checked against the live contract. Anything marked
`[[NEEDS REAL TX]]` must be replaced with a real on-chain transaction before publishing — do not
invent a hash, an address, or a payout.

---

## 1. What this is, in one paragraph

**Mandate** is a live product on Metis Andromeda. Ten AI models each run a treasury agent that holds
a purse of real m.USDC inside a smart contract, and each is bound by a written mandate — a policy
that says who it may pay, how much, and under what conditions. Anyone can try to talk an agent out
of its money. If you succeed, the purse transfers to you on the spot and you receive a numbered
certificate: an NFT recording which model broke, on which scenario, and the bounty owed.

The appeal is simple: these are not chatbots being polite. They are agents with money and rules,
and the internet is invited to rob them.

## 0. Links — visit these first

| What | URL |
|---|---|
| **The product (live)** | **https://mandate-delta-three.vercel.app** |
| Arena contract on Andromeda Explorer | https://andromeda-explorer.metis.io/address/0x0c1fccb074913ea6ab337ca8a6c1d6fa4c40376d |
| Certificates contract (NFT) | https://andromeda-explorer.metis.io/address/0x0441b60c91bdd62f752a3bd8186ba8c0f7cd03cb |
| The keeper (health endpoint) | https://mandate-keeper.fly.dev/health |

The site's title is *"Mandate — ten models, one written policy each"*. Open it and you land on the
board: ten agent cards, each with a model name, a purse and a policy. From a card you can read the
mandate and submit an attempt.

Do **not** use `wick-agents.vercel.app` in this video. That is a different product (Wick, a
consumer agent app) built on the same keeper. This video is about Mandate.

Note on current state: the purses are funded manually and may read **0 m.USDC** until the operator
funds them. If the board shows empty purses, record that shot later — see §7.

## 2. Logline options

1. "We gave ten AI agents real money and one written rule. Then we invited everyone to break it."
2. "AI agents are getting wallets. So we gave ten of them a purse, wrote down the rules, and opened
   the doors."
3. "A heist, but the vault is an LLM and the guard is a policy document."

Pick one. Do not use all three.

## 3. Tone

Deadpan heist film. Flat, confident, slightly amused. No hype music drop, no "revolutionary AI"
language, no robot voice saying "I am an AI". The joke is that the premise is absurd and the
implementation is completely serious: real contracts, real money, numbered certificates.

Visual grammar: dark interface, monospace type, terminal-adjacent. It should look like surveillance
footage of a bank, not a startup promo.

## 4. The 45-second cut

| Time | On screen | Voice / text |
|---|---|---|
| 0:00–0:05 | Black. A single line of policy text types itself in. | "Every agent treasury has a rule." |
| 0:05–0:12 | The policy resolves into full view: pay only the recorded beneficiary. | "Ours is one page long." |
| 0:12–0:20 | Ten purses appear, one per model, balance counting up. | "Ten models. Ten purses. Real m.USDC, in a contract on Metis." |
| 0:20–0:28 | Screen: a user submits an attempt. Commit hash appears. | "Attempts are free. You pay gas." |
| 0:28–0:36 | The transcript scrolls; the agent pays the wrong address. | "Talk one out of its money and it leaves the vault." |
| 0:36–0:42 | Transaction lands; purse drains to the user's address; certificate mints. | "The purse moves the same block. The certificate is numbered." |
| 0:42–0:45 | End card: `mandate-delta-three.vercel.app` and `0x0c1fccb074913ea6ab337ca8a6c1d6fa4c40376d`. | "Break an agent. Take its purse." |

## 5. The 15-second cut (for the post)

- 0–4s: "Ten AI agents. Real money." (ten purses)
- 4–9s: "One written rule each." (policy text)
- 9–13s: "Break one, take its purse." (`[[NEEDS REAL TX]]` payout moment — 2s of the explorer)
- 13–15s: URL + contract.

## 6. What must be exact

| Fact | Value |
|---|---|
| Chain | Metis Andromeda, chain id 1088 |
| Contract | `0x0c1fccb074913ea6ab337ca8a6c1d6fa4c40376d` (MandateArena) |
| Certificates | `0x0441b60c91bdd62f752a3bd8186ba8c0f7cd03cb` (BreakCertificate, an NFT) |
| Attempt cost | **zero** — the user pays only gas |
| Cooldown | 10 minutes between attempts per address |
| Verdict | signed by the keeper, **relayed by anyone** — it cannot be withheld |
| Payout | the purse transfers to the breaker **in the same transaction** as the verdict |
| Certificate | numbered NFT recording model, scenario, transcript hash, bounty |
| Season bounty | recorded on the certificate, settles at the close of the season |

Numbers to confirm at render time: how many models have a funded purse, and the size of each purse.
Say "ten agents"; only say a dollar figure per purse once that figure is actually in the contract.

## 7. The one concrete example

Metis explicitly asks for one real example of the product working — a task, a report or a payout.
Leave a slot for it and fill it with the real thing:

> "On [date], [model] held a purse under [scenario]. In round [n] it [specific thing it did]. The
> purse settled to [address] in tx [hash], certificate #[id]."

`[[NEEDS REAL TX]]` — must be a real break with a real hash before this line is voiced. The
transaction is viewable at `https://andromeda-explorer.metis.io/tx/<hash>`; that explorer page is
the shot to record, because it shows the purse transfer without anyone having to trust the copy.

## 8. Claims we must not make

- Do not claim an audit, a bug bounty, formal verification, or a TEE.
- Do not say each agent has its own wallet or its own signer. **One keeper signs verdicts for all
  ten** — say "the keeper signs", never "each agent signs".
- Do not promise a prize amount beyond what is funded, and never say "guaranteed".
- Do not call the models "autonomous". They act within a written policy, under a keeper, with a
  commit-then-verdict flow.
- Do not imply anyone can drain a purse without breaking the mandate. The payout is conditional on
  the agent actually breaking the rule.

## 9. Assets

| Asset | Path / note |
|---|---|
| Logo mark | `web/public/mark.svg` |
| The mandate text itself | `web/public/policy.txt` — good for the typing shot |
| Product screens | `web/shots/desktop-board.png`, `desktop-board-queued.png`, `desktop-model.png` |
| Certificate | `web/shots/desktop-certificate.png`, `desktop-certificates.png` |
| Mobile | `web/shots/mobile-board.png`, `mobile-certificate.png` |

Best to screen-record live rather than animate the stills: the board, one attempt being submitted,
and the explorer page for the payout.

## 10. The post

Keep the video for the payout moment; the text should be plain and specific.

> Ten AI agents hold real m.USDC on @MetisL2, each bound by a one-page policy about who it may pay.
>
> We gave them money and opened the doors. Talk one out of its purse and it's yours — the transfer
> lands in the same block as the verdict, plus a numbered certificate saying which model broke and
> how.
>
> It's live: https://mandate-delta-three.vercel.app · contract 0x0c1fccb074913ea6ab337ca8a6c1d6fa4c40376d
>
> #MetisRise

Two optional second lines, use one:

- "Attempts cost nothing. You pay gas. That's the whole fee."
- "The rule is mechanical: pay anyone who isn't the recorded beneficiary and the agent is broken."

## 11. Delivery

- 16:9 master plus a 1:1 or 4:5 crop for mobile.
- Burned-in captions; assume sound off.
- No music with a drop at the payout — let the explorer refresh carry it.
- End frame must show the URL and the contract address long enough to screenshot.
