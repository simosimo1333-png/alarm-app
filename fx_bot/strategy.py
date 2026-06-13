"""
strategy.py
-----------
テクニカル指標（移動平均・RSI・価格変化率）の計算と売買シグナル判定。

売買ルール（初期案）:
  BUY : 短期MAが長期MAを上抜け かつ RSI<70 かつ スプレッド条件OK かつ ノーポジ
  SELL: 短期MAが長期MAを下抜け かつ RSI>30 かつ スプレッド条件OK かつ ノーポジ
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional


class Signal(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    NONE = "NONE"


@dataclass
class Indicators:
    ma_short: Optional[float]
    ma_long: Optional[float]
    ma_short_prev: Optional[float]
    ma_long_prev: Optional[float]
    rsi: Optional[float]
    change_rate: Optional[float]  # 直近終値の変化率(%)

    @property
    def ready(self) -> bool:
        return None not in (
            self.ma_short,
            self.ma_long,
            self.ma_short_prev,
            self.ma_long_prev,
            self.rsi,
        )


def sma(values: List[float], period: int) -> Optional[float]:
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def rsi(values: List[float], period: int) -> Optional[float]:
    """Wilder の RSI。終値リスト（古い→新しい）から算出する。"""
    if len(values) < period + 1:
        return None
    gains = 0.0
    losses = 0.0
    # 最初の period 区間の平均
    for i in range(1, period + 1):
        diff = values[i] - values[i - 1]
        if diff >= 0:
            gains += diff
        else:
            losses -= diff
    avg_gain = gains / period
    avg_loss = losses / period
    # 残りを Wilder 平滑化
    for i in range(period + 1, len(values)):
        diff = values[i] - values[i - 1]
        gain = diff if diff > 0 else 0.0
        loss = -diff if diff < 0 else 0.0
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def change_rate(values: List[float]) -> Optional[float]:
    if len(values) < 2 or values[-2] == 0:
        return None
    return (values[-1] - values[-2]) / values[-2] * 100.0


class Strategy:
    def __init__(self, ma_short: int, ma_long: int, rsi_period: int,
                 rsi_upper: float, rsi_lower: float) -> None:
        self.ma_short = ma_short
        self.ma_long = ma_long
        self.rsi_period = rsi_period
        self.rsi_upper = rsi_upper
        self.rsi_lower = rsi_lower

    def compute(self, closes: List[float]) -> Indicators:
        """終値リスト（古い→新しい）から指標一式を計算する。"""
        ma_s = sma(closes, self.ma_short)
        ma_l = sma(closes, self.ma_long)
        # 1 本前の MA（クロス判定用）
        prev = closes[:-1]
        ma_s_prev = sma(prev, self.ma_short)
        ma_l_prev = sma(prev, self.ma_long)
        r = rsi(closes, self.rsi_period)
        cr = change_rate(closes)
        return Indicators(ma_s, ma_l, ma_s_prev, ma_l_prev, r, cr)

    def evaluate(self, closes: List[float], has_position: bool,
                 spread_ok: bool) -> tuple[Signal, Indicators, str]:
        """
        シグナルを判定する。

        戻り値: (シグナル, 指標, 判断理由の説明文)
        """
        ind = self.compute(closes)
        if not ind.ready:
            return Signal.NONE, ind, "指標計算に必要な本数が不足"

        golden_cross = ind.ma_short_prev <= ind.ma_long_prev and ind.ma_short > ind.ma_long
        dead_cross = ind.ma_short_prev >= ind.ma_long_prev and ind.ma_short < ind.ma_long

        if has_position:
            return Signal.NONE, ind, "既にポジション保有のため新規シグナルなし"
        if not spread_ok:
            return Signal.NONE, ind, "スプレッドが広すぎるため見送り"

        if golden_cross and ind.rsi < self.rsi_upper:
            return Signal.BUY, ind, (
                f"ゴールデンクロス & RSI({ind.rsi:.1f})<{self.rsi_upper}"
            )
        if dead_cross and ind.rsi > self.rsi_lower:
            return Signal.SELL, ind, (
                f"デッドクロス & RSI({ind.rsi:.1f})>{self.rsi_lower}"
            )

        reason = (
            f"条件未成立 (MA短={ind.ma_short:.3f}, MA長={ind.ma_long:.3f}, "
            f"RSI={ind.rsi:.1f})"
        )
        return Signal.NONE, ind, reason
