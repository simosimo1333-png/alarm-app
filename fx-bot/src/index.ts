import { loadConfig } from "./config.js";
import { Trader } from "./trader.js";
import { runBacktest } from "./backtest.js";
import { OandaClient } from "./oanda.js";

async function showStatus(): Promise<void> {
  const config = loadConfig();
  const client = new OandaClient(config);
  const summary = await client.getAccountSummary();
  const positions = await client.getOpenPositions();

  console.log(`環境      : ${config.env}`);
  console.log(`残高      : ${summary.balance} ${summary.currency}`);
  console.log(`純資産    : ${summary.NAV} ${summary.currency}`);
  console.log(`評価損益  : ${summary.unrealizedPL} ${summary.currency}`);
  console.log(`ポジション: ${positions.length}件`);
  for (const p of positions) {
    const long = Number(p.long.units);
    const short = Number(p.short.units);
    if (long !== 0) console.log(`  ${p.instrument} 買い ${long} (平均 ${p.long.averagePrice}, 評価損益 ${p.long.unrealizedPL})`);
    if (short !== 0) console.log(`  ${p.instrument} 売り ${short} (平均 ${p.short.averagePrice}, 評価損益 ${p.short.unrealizedPL})`);
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  switch (mode) {
    case "trade":
      await new Trader(loadConfig()).run();
      break;
    case "backtest":
      await runBacktest(loadConfig());
      break;
    case "status":
      await showStatus();
      break;
    default:
      console.log("使い方: npm run trade | npm run backtest | npm run status");
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
