/**
 * Overline venue economics: Panta (rented venue) vs Metis (own contracts).
 *
 * Every input below is either known from the GW6 page, stated by the builder,
 * or an explicitly labelled assumption. Run: node cost-model.mjs
 */

const CFG = {
  // calendar
  seasonGameweeks: 38,
  pilotGameweeks: 13, // ~3 months of Premier League fixtures

  // slate size
  marketsPerGwNow: 3, // GW6: Saka, Haaland, Joao Pedro
  marketsPerGwTarget: 8, // needed so a visitor can build 3 legs without repeating a line

  // Panta (rented venue) - builder-stated
  pantaCreateFee: 20, // $ per market, up front
  creatorShareOfVenueFee: 0.2, // "20% of the liquidity as creator fee" - read as 20% of venue fee revenue
  venueFeeBps: 200, // ASSUMPTION: 2% of pool, typical for parimutuel

  // observed market size at GW6
  volumePerMarketNow: 12.1 / 3, // $12.10 committed across 3 markets

  // Metis (own contracts)
  metisGasPerTx: 0.005, // ASSUMPTION: ~$0.005 per parimutuel write at current METIS price
  claimTxPerGw: 1,

  // promo budget
  promoLegsPerGw: 10,
  promoStakePerLeg: 3,

  // people
  humansNow: 12,
  humansTarget: 25,
  legsPerHumanPerGw: 3,
};

const money = (n) =>
  "$" + n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 });

const rent = (gws, markets) => gws * markets * CFG.pantaCreateFee;

const creatorRevenue = (volume, metis = false) =>
  volume * (metis ? 0 : CFG.venueFeeBps / 10000) * (metis ? 1 : CFG.creatorShareOfVenueFee);

function breakEvenVolume() {
  // creator share = share * feeRate * V  =>  V = fee / (share * rate)
  const rate = (CFG.venueFeeBps / 10000) * CFG.creatorShareOfVenueFee;
  return CFG.pantaCreateFee / rate;
}

function promoSpend(gws) {
  return gws * CFG.promoLegsPerGw * CFG.promoStakePerLeg;
}

function metisCost(gws, markets) {
  const marketsTx = gws * markets;
  const humanTx = CFG.humansTarget * CFG.legsPerHumanPerGw * gws;
  const claimTx = CFG.humansTarget * CFG.claimTxPerGw * gws;
  return (marketsTx + humanTx + claimTx) * CFG.metisGasPerTx;
}

function creditSpend(gws) {
  // one $3 first leg per new human, ~40 new humans across the pilot
  return 40 * 3;
}

console.log("=== 1. What the venue fee actually costs ===");
console.table({
  "pilot, 3 markets/GW": { markets: CFG.pilotGameweeks * CFG.marketsPerGwNow, rent: rent(CFG.pilotGameweeks, CFG.marketsPerGwNow) },
  "pilot, 8 markets/GW": { markets: CFG.pilotGameweeks * CFG.marketsPerGwTarget, rent: rent(CFG.pilotGameweeks, CFG.marketsPerGwTarget) },
  "full season, 3/GW": { markets: CFG.seasonGameweeks * CFG.marketsPerGwNow, rent: rent(CFG.seasonGameweeks, CFG.marketsPerGwNow) },
  "full season, 8/GW": { markets: CFG.seasonGameweeks * CFG.marketsPerGwTarget, rent: rent(CFG.seasonGameweeks, CFG.marketsPerGwTarget) },
});

console.log("\n=== 2. Break-even volume per market (to earn back the $" + CFG.pantaCreateFee + ") ===");
console.table({
  "venue fee 1%": { "volume needed per market": money(breakEvenVolume() * (2 / 1)) },
  "venue fee 2% (base)": { "volume needed per market": money(breakEvenVolume()) },
  "venue fee 5%": { "volume needed per market": money(breakEvenVolume() * (2 / 5)) },
  "actual GW6 volume": { "volume per market": money(CFG.volumePerMarketNow) },
});

const shortfall = breakEvenVolume() / CFG.volumePerMarketNow;
console.log(`\nCurrent markets are ${shortfall.toFixed(0)}x short of break-even.`);

console.log("\n=== 3. Three-month pilot, all-in cash ===");
const pilotRent = rent(CFG.pilotGameweeks, CFG.marketsPerGwNow);
console.log(
  `Panta: rent ${money(pilotRent)} + promo stakes ${money(promoSpend(CFG.pilotGameweeks))} = ${money(
    pilotRent + promoSpend(CFG.pilotGameweeks)
  )} out`
);
console.log(`Best case prize (rank #1): ${money(800)}/mo x 3 = ${money(2400)}`);
console.log(
  `Never places: promo positions are house-signed, so valid active users produced = 0/13 gameweeks`
);

console.log("\n=== 4. Same pilot on Metis ===");
const mGas = metisCost(CFG.pilotGameweeks, CFG.marketsPerGwTarget);
const mCredit = creditSpend(CFG.pilotGameweeks);
console.log(`gas for 8 markets/GW + ${CFG.humansTarget} humans x ${CFG.legsPerHumanPerGw} legs + claims: ${money(mGas)}`);
console.log(`first-leg credit for ~40 new humans: ${money(mCredit)}`);
console.log(`acquisition cost per valid active user: ${money((mGas + mCredit) / CFG.humansTarget)}`);
console.log(
  `freed-up rent redeployed as season prize pool: ${money(pilotRent)} (vs ${money(0)} prize pool today)`
);

console.log("\n=== 5. Breadth is the growth lever, and rent forbids it ===");
console.table({
  "Panta, 8 markets/GW, pilot": { cost: money(rent(CFG.pilotGameweeks, CFG.marketsPerGwTarget)), perMarket: money(CFG.pantaCreateFee) },
  "Metis, 8 markets/GW, pilot": { cost: money(CFG.pilotGameweeks * CFG.marketsPerGwTarget * CFG.metisGasPerTx), perMarket: money(CFG.metisGasPerTx) },
});
