"""
risk_manager.py
---------------
注文前後のリスクチェックと自動停止判断を集約する。

担当する安全装置:
  - 1 回あたりの注文数量上限
  - 1 日の最大損失額の超過監視（超過で停止）
  - 同一方向への連続エントリー禁止
  - スプレッド過大時の取引停止
  - 経済指標 時間帯の回避
  - 証拠金維持率の下限チェック
  - 損切り・利確（pips）の判定
  - stop.txt による即時手動停止
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import List, Optional, Tuple
from zoneinfo import ZoneInfo

from strategy import Signal


@dataclass
class PositionState:
    """ボットが認識している現在の建玉（簡易・単一ポジション管理）。"""
    side: Optional[str] = None       # 'BUY' / 'SELL' / None
    entry_price: float = 0.0
    size: int = 0
    position_id: Optional[str] = None
    opened_at: Optional[datetime] = None

    @property
    def has_position(self) -> bool:
        return self.side is not None and self.size > 0


@dataclass
class RiskManager:
    max_order_size: int
    max_daily_loss_jpy: float
    max_spread_pips: float
    min_margin_ratio: float
    pip_value: float
    take_profit_pips: float
    stop_loss_pips: float
    news_windows: List[Tuple] = field(default_factory=list)
    timezone: str = "Asia/Tokyo"
    stop_file: str = "stop.txt"

    # 内部状態
    daily_loss: float = 0.0
    _loss_date: Optional[date] = None
    last_entry_side: Optional[str] = None
    halted: bool = False
    halt_reason: str = ""

    def _now(self) -> datetime:
        try:
            return datetime.now(ZoneInfo(self.timezone))
        except Exception:
            return datetime.now()

    # ---------------- 停止系 ---------------- #
    def stop_file_exists(self) -> bool:
        return os.path.exists(self.stop_file)

    def halt(self, reason: str) -> None:
        self.halted = True
        self.halt_reason = reason

    # ---------------- 日次損益 ---------------- #
    def _roll_day_if_needed(self) -> None:
        today = self._now().date()
        if self._loss_date != today:
            self._loss_date = today
            self.daily_loss = 0.0

    def register_realized_pnl(self, pnl_jpy: float) -> None:
        """決済で確定した損益を登録する（損失は負の値）。"""
        self._roll_day_if_needed()
        self.daily_loss += pnl_jpy

    def daily_loss_exceeded(self) -> bool:
        self._roll_day_if_needed()
        # daily_loss は累積損益。損失超過は -max を下回ったとき。
        return self.daily_loss <= -abs(self.max_daily_loss_jpy)

    # ---------------- 各種チェック ---------------- #
    def in_news_window(self) -> bool:
        now_t = self._now().time()
        for start, end in self.news_windows:
            if start <= end:
                if start <= now_t <= end:
                    return True
            else:  # 日跨ぎ
                if now_t >= start or now_t <= end:
                    return True
        return False

    def spread_ok(self, spread_price: float) -> bool:
        spread_pips = spread_price / self.pip_value
        return spread_pips <= self.max_spread_pips

    def margin_ok(self, margin_ratio: Optional[float]) -> bool:
        if margin_ratio is None:
            return True  # 取得不可なら別途エラー処理に委ねる
        return margin_ratio >= self.min_margin_ratio

    def clamp_size(self, size: int) -> int:
        return min(size, self.max_order_size)

    def consecutive_same_direction(self, signal: Signal) -> bool:
        """同一方向への連続エントリーかどうか。"""
        return self.last_entry_side is not None and self.last_entry_side == signal.value

    def can_enter(
        self,
        signal: Signal,
        spread_price: float,
        margin_ratio: Optional[float],
        has_position: bool,
    ) -> Tuple[bool, str]:
        """
        新規エントリー可否を総合判定する。
        戻り値: (可否, 理由)
        """
        if self.halted:
            return False, f"停止中: {self.halt_reason}"
        if self.stop_file_exists():
            return False, "stop.txt が存在するため停止"
        if signal == Signal.NONE:
            return False, "シグナルなし"
        if has_position:
            return False, "既存ポジションあり"
        if self.daily_loss_exceeded():
            return False, "1日の最大損失額に到達"
        if self.in_news_window():
            return False, "経済指標 回避時間帯"
        if not self.spread_ok(spread_price):
            return False, "スプレッド過大"
        if not self.margin_ok(margin_ratio):
            return False, f"証拠金維持率が下限({self.min_margin_ratio}%)未満"
        if self.consecutive_same_direction(signal):
            return False, "同一方向への連続エントリー禁止"
        return True, "エントリー条件クリア"

    # ---------------- 決済判定（損切り・利確） ---------------- #
    def should_exit(self, position: PositionState, bid: float, ask: float) -> Tuple[bool, str]:
        """
        保有建玉に対して利確・損切り条件を判定する。
        BUY 建玉は bid で評価、SELL 建玉は ask で評価する。
        """
        if not position.has_position:
            return False, ""
        tp = self.take_profit_pips * self.pip_value
        sl = self.stop_loss_pips * self.pip_value

        if position.side == "BUY":
            diff = bid - position.entry_price
            if diff >= tp:
                return True, f"利確 (+{diff / self.pip_value:.1f}pips)"
            if diff <= -sl:
                return True, f"損切り ({diff / self.pip_value:.1f}pips)"
        elif position.side == "SELL":
            diff = position.entry_price - ask
            if diff >= tp:
                return True, f"利確 (+{diff / self.pip_value:.1f}pips)"
            if diff <= -sl:
                return True, f"損切り ({diff / self.pip_value:.1f}pips)"
        return False, ""

    def record_entry(self, side: str) -> None:
        self.last_entry_side = side

    def estimate_pnl(self, position: PositionState, bid: float, ask: float) -> float:
        """概算の確定損益(JPY)。USD_JPY 等、決済通貨が円の前提の簡易計算。"""
        if not position.has_position:
            return 0.0
        if position.side == "BUY":
            return (bid - position.entry_price) * position.size
        return (position.entry_price - ask) * position.size
