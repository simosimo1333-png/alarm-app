import { pipSize, type Config } from "./config.js";
import { OandaClient, type Candle } from "./oanda.js";
import { sma } from "./indicators.js";

interface Trade {
  side: "long" | "short";
  entryTime: string;
  exitTime: string;
  pips: number;
  exitReason: "SL" | "TP" | "doten";
}

/** 想定スプレッド(pips)。往復コストとして各取引から差し引く */
const SPREAD_PIPS = Number(process.env.SPREAD_PIPS ?? "1.0");
const CANDLE_COUNT = Number(process.env.BACKTEST_CANDLES ?? "4000");

export async function runBacktest(config: Config): Promise<void> {
  const client = new OandaClient(config);
  console.log(`バックテスト: ${config.instrument} ${config.granularity} MA${config.fastMa}/${config.slowMa}`);
  console.log(`過去${CANDLE_COUNT}本のローソク足を取得中...`);

  const raw = await client.getCandles(config.instrument, config.granularity, CANDLE_COUNT);
  const candles = raw.filter((c) => c.complete);
  console.log(`取得: ${candles.length}本 (${candles[0]?.time} 〜 ${candles[candles.length - 1]?.time})`);

  const trades = simulate(config, candles);
  report(config, trades);
}

function simulate(config: Config, candles: Candle[]): Trade[] {
  const pip = pipSize(config.instrument);
  const closes = candles.map((c) => Number(c.mid.c));
  const fast = sma(closes, config.fastMa);
  const slow = sma(closes, config.slowMa);

  const trades: Trade[] = [];
  let position: { side: "long" | "short"; entry: number; sl: number; tp: number; entryTime: string } | null = null;

  for (let i = config.slowMa; i < candles.length; i++) {
    const candle = candles[i]!;
    const high = Number(candle.mid.h);
    const low = Number(candle.mid.l);
    const close = Number(candle.mid.c);

    // 1. 保有中ポジションのSL/TP判定(同一足で両方に届く場合はSL優先=保守的に評価)
    if (position) {
      const p = position;
      let exit: { price: number; reason: "SL" | "TP" } | null = null;
      if (p.side === "long") {
        if (low <= p.sl) exit = { price: p.sl, reason: "SL" };
        else if (high >= p.tp) exit = { price: p.tp, reason: "TP" };
      } else {
        if (high >= p.sl) exit = { price: p.sl, reason: "SL" };
        else if (low <= p.tp) exit = { price: p.tp, reason: "TP" };
      }
      if (exit) {
        trades.push(makeTrade(p, exit.price, exit.reason, candle.time, pip));
        position = null;
      }
    }

    // 2. クロス判定(確定足ベース)
    const fPrev = fast[i - 1], sPrev = slow[i - 1], fCur = fast[i], sCur = slow[i];
    if (fPrev == null || sPrev == null || fCur == null || sCur == null) continue;

    let signal: "long" | "short" | null = null;
    if (fPrev <= sPrev && fCur > sCur) signal = "long";
    else if (fPrev >= sPrev && fCur < sCur) signal = "short";
    if (!signal) continue;

    // 反対ポジションは足の終値でドテン決済
    if (position && position.side !== signal) {
      trades.push(makeTrade(position, close, "doten", candle.time, pip));
      position = null;
    }

    // 次の足の始値でエントリー
    if (!position && i + 1 < candles.length) {
      const entry = Number(candles[i + 1]!.mid.o);
      const dir: number = signal === "long" ? 1 : -1;
      position = {
        side: signal,
        entry,
        sl: entry - dir * config.stopLossPips * pip,
        tp: entry + dir * config.takeProfitPips * pip,
        entryTime: candles[i + 1]!.time,
      };
      i++; // エントリー足ではSL/TP判定をスキップ(始値エントリーのため簡略化)
    }
  }
  return trades;
}

function makeTrade(
  p: { side: "long" | "short"; entry: number; entryTime: string },
  exitPrice: number,
  reason: "SL" | "TP" | "doten",
  exitTime: string,
  pip: number
): Trade {
  const dir = p.side === "long" ? 1 : -1;
  const pips = (dir * (exitPrice - p.entry)) / pip - SPREAD_PIPS;
  return { side: p.side, entryTime: p.entryTime, exitTime, pips, exitReason: reason };
}

function report(config: Config, trades: Trade[]): void {
  if (trades.length === 0) {
    console.log("取引が発生しませんでした。MA期間や時間枠を見直してください。");
    return;
  }
  const wins = trades.filter((t) => t.pips > 0);
  const totalPips = trades.reduce((s, t) => s + t.pips, 0);

  let equity = 0, peak = 0, maxDd = 0;
  for (const t of trades) {
    equity += t.pips;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }

  const pip = pipSize(config.instrument);
  const pnlAtMaxUnits = totalPips * pip * config.maxUnits;

  console.log("\n===== バックテスト結果 =====");
  console.log(`取引回数        : ${trades.length}回`);
  console.log(`勝率            : ${((wins.length / trades.length) * 100).toFixed(1)}% (${wins.length}勝${trades.length - wins.length}敗)`);
  console.log(`合計損益        : ${totalPips.toFixed(1)} pips (スプレッド${SPREAD_PIPS}pips/回 控除済み)`);
  console.log(`平均損益        : ${(totalPips / trades.length).toFixed(2)} pips/回`);
  console.log(`最大ドローダウン: ${maxDd.toFixed(1)} pips`);
  console.log(`参考PnL         : ${pnlAtMaxUnits.toFixed(0)} (${config.maxUnits}通貨で取引した場合、決済通貨建て)`);
  console.log("\n直近の取引:");
  for (const t of trades.slice(-10)) {
    console.log(
      `  ${t.entryTime.slice(0, 16)} ${t.side === "long" ? "買" : "売"} → ${t.exitTime.slice(0, 16)} ` +
      `${t.exitReason.padEnd(5)} ${t.pips >= 0 ? "+" : ""}${t.pips.toFixed(1)} pips`
    );
  }
  console.log("\n注意: 過去の成績は将来の利益を保証しません。");
}
