import "dotenv/config";

export interface Config {
  env: "practice" | "live";
  apiToken: string;
  accountId: string;
  instrument: string;
  granularity: string;
  fastMa: number;
  slowMa: number;
  riskPercent: number;
  stopLossPips: number;
  takeProfitPips: number;
  maxUnits: number;
  dailyLossLimitPercent: number;
  dryRun: boolean;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.startsWith("your-")) {
    throw new Error(
      `環境変数 ${name} が設定されていません。.env.example をコピーして .env を作成し、値を設定してください。`
    );
  }
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`環境変数 ${name} の値が不正です: ${v}`);
  }
  return n;
}

export function loadConfig(): Config {
  const env = required("OANDA_ENV");
  if (env !== "practice" && env !== "live") {
    throw new Error(`OANDA_ENV は practice または live を指定してください (現在: ${env})`);
  }

  const config: Config = {
    env,
    apiToken: required("OANDA_API_TOKEN"),
    accountId: required("OANDA_ACCOUNT_ID"),
    instrument: process.env.INSTRUMENT ?? "USD_JPY",
    granularity: process.env.GRANULARITY ?? "M15",
    fastMa: num("FAST_MA", 10),
    slowMa: num("SLOW_MA", 30),
    riskPercent: num("RISK_PERCENT", 0.5),
    stopLossPips: num("STOP_LOSS_PIPS", 20),
    takeProfitPips: num("TAKE_PROFIT_PIPS", 40),
    maxUnits: num("MAX_UNITS", 10000),
    dailyLossLimitPercent: num("DAILY_LOSS_LIMIT_PERCENT", 2),
    // 未設定の場合は安全側(発注しない)に倒す
    dryRun: (process.env.DRY_RUN ?? "true").toLowerCase() !== "false",
  };

  if (config.fastMa >= config.slowMa) {
    throw new Error(`FAST_MA (${config.fastMa}) は SLOW_MA (${config.slowMa}) より小さくしてください`);
  }
  return config;
}

/** 通貨ペアの1pipの値幅。JPYが絡むペアは0.01、それ以外は0.0001 */
export function pipSize(instrument: string): number {
  return instrument.endsWith("_JPY") || instrument.startsWith("JPY_") ? 0.01 : 0.0001;
}
