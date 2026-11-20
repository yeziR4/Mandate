# Metis Rise — rules as they apply to Mandate

Rulings received by email, newest first, with the operational consequence of each.

---

## 20 Nov — purse and bounty payouts do not count as "funding" a wallet

**Ruling.** "A purse or bounty that your contract pays to a user after they have played does not
make that wallet 'funded by the project'. The wallet still counts. Please keep the mechanism as it
is." Money a wallet receives **before** it first uses Mandate does not count — for example a wallet
the deployer funds so it can play. The same applies if a winner sends prize money to new wallets that
then play: those new wallets would not count. Privy embedded wallets and user-connected wallets both
count from 1 December.

**Consequences.**

- The prize mechanism stays exactly as built. No change to the contract, the certificate, or the
  month-end settlement.
- **Never pre-fund a wallet** — no gas top-ups, no test mUSDC, no "here's a little to get started".
  That wallet stops counting, permanently, for the month.
- Paying a winner after a genuine break is fine, and does not taint their wallet.
- Do not encourage winners to spread prize money to friends who then play: those fresh wallets do not
  count.

---

## 18 Nov — one prize slot per team; wallet declaration

**Ruling.** One builder or connected team holds one Top-3 slot per month, for its highest-ranked
project. Entering several projects is allowed; they are counted and shown, but only the best is paid.
Teams must declare (a) every wallet they control, (b) other Metis Rise applications they are in, and
(c) how users hold wallets. Inaccurate declarations can lead to disqualification, with a 7-day
evidence window.

**Consequences.**

- Declaration sent (see `METIS-REPLY.md`), including the correction that we use Privy embedded
  wallets and the disclosure of the six contracts and the one internal test attempt.
- Every wallet we operate is one address: `0xd20b…bEC7` (deployer, keeper, relayer).

---

## 18 Nov — user wallets must be user-held from 1 December

**Ruling.** From 1 Dec, counted users must transact from wallets they control: self-custodial
(MetaMask, Rabby, WalletConnect) or embedded/passkey wallets the user owns (Privy, GOAT AgentKit).
Server-held keys no longer count. For November only, a project-bot wallet counts if it belongs to a
real separate person and was not funded by the deployer, relayer or a shared source.

**Consequences.** Already compliant: sign-in is Privy (embedded) or the user's own wallet, and we
never hold a user's keys.

---

## Standing requirements

| Requirement | State (20 Nov) |
|---|---|
| 15 unique users in November | 0 |
| 3+ qualifying txs each, or ≥$2 settled each | $0 |
| Launch post on X | drafted, needs to go out |
| User proof posts | none |
| Prize purse | 5.311014 mUSDC in model 1 (Claude — currently offline) |
| Bounty per break | 5 mUSDC, recorded on the certificate, settled after review |
