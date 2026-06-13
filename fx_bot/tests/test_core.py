"""
strategy / risk_manager / data_store のオフライン単体テスト。

ネットワーク・APIキー不要。実行方法:
    cd fx_bot && python -m unittest discover -s tests -v
"""

import math
import os
import sys
import unittest
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from strategy import Strategy, Signal, sma, rsi, change_rate  # noqa: E402
from risk_manager import RiskManager, PositionState  # noqa: E402
from data_store import CandleBuilder  # noqa: E402


class TestIndicators(unittest.TestCase):
    def test_sma(self):
        self.assertIsNone(sma([1, 2], 5))
        self.assertEqual(sma([1, 2, 3, 4, 5], 5), 3.0)

    def test_rsi_all_gains_is_100(self):
        vals = [100 + i for i in range(20)]
        self.assertEqual(rsi(vals, 14), 100.0)

    def test_rsi_in_range(self):
        vals = [100 + math.sin(i / 2) for i in range(40)]
        r = rsi(vals, 14)
        self.assertIsNotNone(r)
        self.assertTrue(0 <= r <= 100)

    def test_change_rate(self):
        self.assertAlmostEqual(change_rate([100, 101]), 1.0)
        self.assertIsNone(change_rate([100]))


class TestStrategy(unittest.TestCase):
    def setUp(self):
        self.s = Strategy(5, 20, 14, 70, 30)

    def test_buy_on_golden_cross_with_rsi_filter(self):
        closes = [100 + math.sin(i / 2) * 0.3 for i in range(22)]
        closes += [100.25, 100.35, 100.5]
        sig, ind, _ = self.s.evaluate(closes, has_position=False, spread_ok=True)
        self.assertEqual(sig, Signal.BUY)
        self.assertLess(ind.rsi, 70)

    def test_no_signal_when_position_held(self):
        closes = [100 + math.sin(i / 2) * 0.3 for i in range(22)] + [100.25, 100.35, 100.5]
        sig, _, _ = self.s.evaluate(closes, has_position=True, spread_ok=True)
        self.assertEqual(sig, Signal.NONE)

    def test_no_signal_when_spread_wide(self):
        closes = [100 + math.sin(i / 2) * 0.3 for i in range(22)] + [100.25, 100.35, 100.5]
        sig, _, _ = self.s.evaluate(closes, has_position=False, spread_ok=False)
        self.assertEqual(sig, Signal.NONE)

    def test_rsi_overbought_blocks_buy(self):
        # 単調上昇 → RSI=100 で BUY を抑制
        closes = [100 + i * 0.1 for i in range(40)]
        sig, _, _ = self.s.evaluate(closes, has_position=False, spread_ok=True)
        self.assertEqual(sig, Signal.NONE)


class TestRiskManager(unittest.TestCase):
    def setUp(self):
        self.rm = RiskManager(
            max_order_size=10000, max_daily_loss_jpy=5000, max_spread_pips=0.5,
            min_margin_ratio=200, pip_value=0.01, take_profit_pips=10, stop_loss_pips=7,
        )

    def test_clamp_size(self):
        self.assertEqual(self.rm.clamp_size(50000), 10000)
        self.assertEqual(self.rm.clamp_size(5000), 5000)

    def test_spread_ok(self):
        self.assertTrue(self.rm.spread_ok(0.003))
        self.assertFalse(self.rm.spread_ok(0.008))

    def test_take_profit_and_stop_loss(self):
        pos = PositionState(side="BUY", entry_price=150.0, size=10000)
        self.assertTrue(self.rm.should_exit(pos, bid=150.12, ask=150.13)[0])
        self.assertTrue(self.rm.should_exit(pos, bid=149.92, ask=149.93)[0])
        self.assertFalse(self.rm.should_exit(pos, bid=150.03, ask=150.04)[0])

    def test_sell_position_exit(self):
        pos = PositionState(side="SELL", entry_price=150.0, size=10000)
        self.assertTrue(self.rm.should_exit(pos, bid=149.87, ask=149.88)[0])  # 利確
        self.assertTrue(self.rm.should_exit(pos, bid=150.08, ask=150.09)[0])  # 損切り

    def test_daily_loss_halt(self):
        self.assertFalse(self.rm.daily_loss_exceeded())
        self.rm.register_realized_pnl(-6000)
        self.assertTrue(self.rm.daily_loss_exceeded())

    def test_consecutive_same_direction_blocked(self):
        self.rm.record_entry("BUY")
        ok, why = self.rm.can_enter(Signal.BUY, 0.003, 250, has_position=False)
        self.assertFalse(ok)
        self.assertIn("連続", why)

    def test_can_enter_happy_path(self):
        ok, _ = self.rm.can_enter(Signal.BUY, 0.003, 250, has_position=False)
        self.assertTrue(ok)

    def test_margin_floor(self):
        ok, why = self.rm.can_enter(Signal.BUY, 0.003, 150, has_position=False)
        self.assertFalse(ok)
        self.assertIn("証拠金", why)

    def test_estimate_pnl(self):
        pos = PositionState(side="BUY", entry_price=150.0, size=10000)
        self.assertAlmostEqual(self.rm.estimate_pnl(pos, bid=150.10, ask=150.11), 1000.0)


class TestCandleBuilder(unittest.TestCase):
    def test_one_minute_buckets(self):
        cb = CandleBuilder(interval_sec=60)
        base = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
        for i in range(130):
            cb.add_price(base + timedelta(seconds=i), 150 + i * 0.01)
        # 130秒 → 確定足は2本（0-59, 60-119）、120-129は形成中
        self.assertEqual(len(cb.candles), 2)
        self.assertEqual(len(cb.closes_with_current()), 3)

    def test_ohlc_correctness(self):
        cb = CandleBuilder(interval_sec=60)
        base = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
        prices = [150.0, 150.5, 149.5, 150.2]
        for i, p in enumerate(prices):
            cb.add_price(base + timedelta(seconds=i * 10), p)
        cb.add_price(base + timedelta(seconds=70), 151.0)  # 次のバケットで確定
        c = cb.candles[0]
        self.assertEqual(c.open, 150.0)
        self.assertEqual(c.high, 150.5)
        self.assertEqual(c.low, 149.5)
        self.assertEqual(c.close, 150.2)


if __name__ == "__main__":
    unittest.main()
