/**
 * 単純移動平均(SMA)の系列を返す。
 * 結果の i 番目は values[i-period+1 .. i] の平均。期間に満たない位置は null。
 */
export function sma(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) result[i] = sum / period;
  }
  return result;
}
