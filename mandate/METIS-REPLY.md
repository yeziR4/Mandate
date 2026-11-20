# Reply to Metis Rise — declaration, contracts, X details

Send as a reply to Julie's declaration email (the one with the 7-day clock). It covers both of her
emails.

**One line to fill before sending:** (b) — whether anyone on the team is involved in another Metis
Rise application. Answering wrongly is a disqualification risk, so it must be said deliberately.

---

**Subject:** Wallet declaration, contract question, and X details — Mandate (Metis Rise)

Hi Julie,

Thanks for both notes. Covering the declaration, the question about four contracts, and the X
details here together.

**X handle and launch post**

- Handle: **@Mr_Hy4**
- Launch post: https://x.com/Mr_Hy4/status/2123048199984181713

**(a) Every wallet we control that interacts with the project**

- **`0xd20b6ecb626DF04064771483bCD4C8aa210fbEC7`** — our only address. It is the deployer, the keeper
  (the sole signer of verdicts) and the relayer of those verdicts. We do not operate a separate
  treasury, reward, payout or bot wallet; the hosted keeper service holds this same key.
- **We create and fund no user wallets.** Every user acts from a wallet they already hold.
- The prize purses are **contract balance, not a wallet**. They sit inside `MandateArena`
  (`0x0c1fccb074913ea6ab337ca8a6c1d6fa4c40376d`) and are funded from the deployer address above. It
  currently holds 5.311014 m.USDC in one model's purse.

**(b) Other Metis Rise applications**

`[[ANSWER: "No — Mandate is our only application." OR name the other project]]`

**(c) How users hold the wallets they act from**

Users connect **their own wallet** in the browser and submit the attempt transaction themselves. The
verdict is signed by our keeper and relayed by us — the contract makes relaying permissionless, so a
verdict cannot be withheld — and the contract pays the attempt's submitter, i.e. the user's own
wallet. No project wallet ever holds or forwards user funds, and users pay their own gas.

**The four contracts in your other email**

Yes — all four belong to us. They were created by the deployer address above on **28 October 2026**,
and they are two earlier deployment iterations of the same pair of contracts. Each iteration is one
arena plus one certificate contract:

| Contract | Type | Created | Attempts | Certificates | Funds |
|---|---|---|---|---|---|
| `0xff4A373aCAe0FD625C8c14c17cB758ef1F7C0fC3` | certificate, v1 | 28 Oct 14:45 UTC | — | 0 minted | none |
| `0x57783fA6Bc4A372d188CB276894B88C78Cc9C4AD` | arena, v1 | 28 Oct 14:45 UTC | 0 | — | none |
| `0x2F9F8c72368f4d65813839c06e68B6b571E5dD1c` | certificate, v2 | 28 Oct 14:58 UTC | — | 0 minted | none |
| `0x0c16403366278D3d427Bc6AC4b8902ccCF97977a` | arena, v2 | 28 Oct 15:10 UTC | 0 | — | none |
| `0x0441b60c91bdd62f752a3bd8186ba8c0f7cd03cb` | **certificate, live** | 28 Oct 15:33 UTC | — | 1 minted | none |
| `0x0c1fccb074913ea6ab337ca8a6c1d6fa4c40376d` | **arena, live** | 28 Oct 15:34 UTC | 5 | — | 5.311014 m.USDC |

The four you listed are the **superseded** iterations. They were replaced 30–45 minutes later by the
live pair, which is the one verified on Andromeda Explorer and the one in our application. The
superseded contracts have zero attempts, zero certificates and hold no funds. These are the only six
contracts this deployer address has ever created.

**Two things I would rather declare before you ask**

1. **One internal test attempt.** Attempt #4 on 17 November was submitted by the deployer address as
   an end-to-end test of the commit → verdict → certificate path. It minted certificate #1 against a
   zero purse. We are **not** counting it as a user, and by your definition it is a test transaction.
2. **Current usage is honestly zero.** As of today the arena has 5 attempts from one address — ours —
   and 1 certificate. The launch post went live today and the first external wallet connected this
   morning; the purse was funded yesterday. We would rather report that plainly than let the
   leaderboard imply otherwise.

Happy to supply anything else, including the creation transactions for the four contracts above.

Best,
Yezir
