import { pipSize, type Config } from "./config.js";

/**
 * 注文数量(通貨単位)を計算する。
 * 「損切りに掛かったときの損失 ≒ 口座残高 × RISK_PERCENT%」となる数量を求め、
 * MAX_UNITS を上限とする。
 *
 * 注意: クロス通貨(口座通貨と決済通貨が異なる場合)は概算になる。
 * 口座がJPY建てでUSD_JPYを取引する標準的なケースでは正確。
 */
export function calcUnits(config: Config, balance: number, price: number): number {
  const pip = pipSize(config.instrument);
  const riskAmount = balance * (config.riskPercent / 100);
  const lossPerUnit = config.stopLossPips * pip;

  // 決済通貨がJPY以外(EUR_USDなど)でJPY口座の場合、損失額を口座通貨に概算換算
  const quoteIsJpy = config.instrument.endsWith("_JPY");
  const lossPerUnitInAccountCurrency = quoteIsJpy ? lossPerUnit : lossPerUnit * price;

  const units = Math.floor(riskAmount / lossPerUnitInAccountCurrency);
  return Math.max(0, Math.min(units, config.maxUnits));
}

/** 1日の損失上限チェック。trueなら取引を停止すべき */
export function dailyLossExceeded(config: Config, dayStartNav: number, currentNav: number): boolean {
  const limit = dayStartNav * (config.dailyLossLimitPercent / 100);
  return dayStartNav - currentNav >= limit;
}

/** 価格の小数桁数(注文時のSL/TP価格のフォーマットに使用) */
export function pricePrecision(instrument: string): number {
  return pipSize(instrument) === 0.01 ? 3 : 5;
}
