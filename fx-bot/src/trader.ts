import { pipSize, type Config } from "./config.js";
import { OandaClient, type OpenPosition } from "./oanda.js";
import { maCrossSignal, type Signal } from "./strategy.js";
import { calcUnits, dailyLossExceeded, pricePrecision } from "./risk.js";

const GRANULARITY_SECONDS: Record<string, number> = {
  M1: 60, M5: 300, M15: 900, M30: 1800,
  H1: 3600, H4: 14400, D: 86400,
};

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

export class Trader {
  private client: OandaClient;
  private lastCandleTime = "";
  private dayStartNav = 0;
  private currentDay = "";
  private halted = false;

  constructor(private config: Config) {
    this.client = new OandaClient(config);
  }

  async run(): Promise<void> {
    const c = this.config;
    log(`=== FXボット起動 ===`);
    log(`環境: ${c.env}${c.env === "live" ? " ★実資金口座です★" : " (デモ口座)"}`);
    log(`通貨ペア: ${c.instrument} / 時間枠: ${c.granularity} / MA: ${c.fastMa}/${c.slowMa}`);
    log(`リスク: ${c.riskPercent}%/回, SL: ${c.stopLossPips}pips, TP: ${c.takeProfitPips}pips, 上限: ${c.maxUnits}通貨`);
    log(`DRY_RUN: ${c.dryRun ? "ON (発注しません)" : "OFF (実際に発注します)"}`);

    const summary = await this.client.getAccountSummary();
    log(`口座確認OK: 残高 ${summary.balance} ${summary.currency}, 純資産 ${summary.NAV}`);

    if (c.env === "live" && !c.dryRun) {
      log("★★★ 実資金で自動発注を行います。停止するには Ctrl+C ★★★");
    }

    const intervalSec = GRANULARITY_SECONDS[c.granularity];
    if (!intervalSec) {
      throw new Error(`未対応のGRANULARITYです: ${c.granularity}`);
    }
    // 足の確定を見逃さないよう、時間枠の1/10(最低15秒)ごとにポーリング
    const pollMs = Math.max(15, intervalSec / 10) * 1000;
    log(`${pollMs / 1000}秒ごとに新しい確定足をチェックします`);

    // 初回は既存の足を「処理済み」として記録し、起動直後の過去シグナルでの発注を防ぐ
    const initial = await this.completedCandles();
    if (initial.length > 0) this.lastCandleTime = initial[initial.length - 1]!.time;

    for (;;) {
      try {
        await this.tick();
      } catch (e) {
        log(`エラー(次回リトライします): ${e instanceof Error ? e.message : String(e)}`);
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  private async completedCandles() {
    const candles = await this.client.getCandles(
      this.config.instrument,
      this.config.granularity,
      this.config.slowMa + 5
    );
    return candles.filter((c) => c.complete);
  }

  private async tick(): Promise<void> {
    if (await this.checkDailyLossLimit()) return;

    const candles = await this.completedCandles();
    if (candles.length === 0) return;
    const latest = candles[candles.length - 1]!;
    if (latest.time === this.lastCandleTime) return; // 新しい確定足なし
    this.lastCandleTime = latest.time;

    const closes = candles.map((c) => Number(c.mid.c));
    const signal = maCrossSignal(closes, this.config.fastMa, this.config.slowMa);
    const price = closes[closes.length - 1]!;
    log(`確定足 ${latest.time} 終値=${price} シグナル=${signal}`);

    if (signal === "none") return;
    await this.executeSignal(signal, price);
  }

  private async executeSignal(signal: Exclude<Signal, "none">, price: number): Promise<void> {
    const c = this.config;
    const positions = await this.client.getOpenPositions();
    const pos = positions.find((p) => p.instrument === c.instrument);

    // 反対方向のポジションがあれば先に決済(ドテン)
    if (pos && this.hasSide(pos, signal === "long" ? "short" : "long")) {
      const closeSide = signal === "long" ? "short" : "long";
      if (c.dryRun) {
        log(`[DRY_RUN] ${c.instrument} の${closeSide}ポジションを決済(実際には行いません)`);
      } else {
        await this.client.closePosition(c.instrument, closeSide);
        log(`${c.instrument} の${closeSide}ポジションを決済しました`);
      }
    }

    // 同方向のポジションを既に持っていたら追加しない
    if (pos && this.hasSide(pos, signal)) {
      log(`既に${signal}ポジション保有中のため新規発注はスキップ`);
      return;
    }

    const summary = await this.client.getAccountSummary();
    const balance = Number(summary.balance);
    const units = calcUnits(c, balance, price);
    if (units <= 0) {
      log(`計算された注文数量が0のため発注しません(残高不足またはリスク設定を確認)`);
      return;
    }

    const pip = pipSize(c.instrument);
    const dir = signal === "long" ? 1 : -1;
    const sl = price - dir * c.stopLossPips * pip;
    const tp = price + dir * c.takeProfitPips * pip;
    const precision = pricePrecision(c.instrument);

    if (c.dryRun) {
      log(
        `[DRY_RUN] ${signal === "long" ? "買い" : "売り"} ${units}通貨 ` +
        `SL=${sl.toFixed(precision)} TP=${tp.toFixed(precision)} (実際には発注しません)`
      );
      return;
    }

    await this.client.placeMarketOrder(c.instrument, dir * units, sl, tp, precision);
    log(
      `発注完了: ${signal === "long" ? "買い" : "売り"} ${units}通貨 ` +
      `SL=${sl.toFixed(precision)} TP=${tp.toFixed(precision)}`
    );
  }

  private hasSide(pos: OpenPosition, side: "long" | "short"): boolean {
    return Number(pos[side].units) !== 0;
  }

  /** 日次損失上限のチェック。超過していたら新規取引を停止する(保有ポジションのSL/TPは生きたまま) */
  private async checkDailyLossLimit(): Promise<boolean> {
    if (this.halted) return true;
    const summary = await this.client.getAccountSummary();
    const nav = Number(summary.NAV);
    const today = new Date().toISOString().slice(0, 10);

    if (today !== this.currentDay) {
      this.currentDay = today;
      this.dayStartNav = nav;
      this.halted = false;
      return false;
    }

    if (dailyLossExceeded(this.config, this.dayStartNav, nav)) {
      this.halted = true;
      log(
        `★ 日次損失上限(${this.config.dailyLossLimitPercent}%)に達しました。` +
        `本日の新規取引を停止します (開始時純資産=${this.dayStartNav} 現在=${nav})。` +
        `保有ポジションの損切り/利確注文は有効なままです。`
      );
      return true;
    }
    return false;
  }
}
