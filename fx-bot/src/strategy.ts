import { sma } from "./indicators.js";

export type Signal = "long" | "short" | "none";

/**
 * 移動平均クロス戦略。
 * 直近の確定足で短期MAが長期MAを上抜いたら long(ゴールデンクロス)、
 * 下抜いたら short(デッドクロス)、それ以外は none。
 */
export function maCrossSignal(closes: number[], fastPeriod: number, slowPeriod: number): Signal {
  if (closes.length < slowPeriod + 1) return "none";

  const fast = sma(closes, fastPeriod);
  const slow = sma(closes, slowPeriod);

  const last = closes.length - 1;
  const prev = last - 1;
  const fPrev = fast[prev];
  const sPrev = slow[prev];
  const fLast = fast[last];
  const sLast = slow[last];
  if (fPrev === null || sPrev === null || fLast === null || sLast === null) return "none";
  if (fPrev === undefined || sPrev === undefined || fLast === undefined || sLast === undefined) return "none";

  if (fPrev <= sPrev && fLast > sLast) return "long";
  if (fPrev >= sPrev && fLast < sLast) return "short";
  return "none";
}
