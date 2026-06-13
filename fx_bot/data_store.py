"""
data_store.py
-------------
価格データの永続化（CSV）と、ティック→足（1分足・5分足相当）への集約を担う。

- ``record_tick()`` で取得したティック（bid/ask/mid）を CSV に追記する。
- ``CandleBuilder`` がティックを時間バケットでまとめ、OHLC ローソク足を生成する。
"""

from __future__ import annotations

import csv
import os
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Deque, List, Optional


@dataclass
class Tick:
    timestamp: datetime
    bid: float
    ask: float

    @property
    def mid(self) -> float:
        return (self.bid + self.ask) / 2.0

    @property
    def spread(self) -> float:
        return self.ask - self.bid


@dataclass
class Candle:
    start: datetime  # バケット開始時刻
    open: float
    high: float
    low: float
    close: float

    def to_dict(self) -> dict:
        return {
            "start": self.start.isoformat(),
            "open": self.open,
            "high": self.high,
            "low": self.low,
            "close": self.close,
        }


class TickCsvStore:
    """ティックを CSV に追記保存する。"""

    def __init__(self, data_dir: str, symbol: str) -> None:
        self.data_dir = data_dir
        self.symbol = symbol
        os.makedirs(data_dir, exist_ok=True)

    def _path_for(self, dt: datetime) -> str:
        fname = f"ticks_{self.symbol}_{dt.strftime('%Y%m%d')}.csv"
        return os.path.join(self.data_dir, fname)

    def record_tick(self, tick: Tick) -> None:
        path = self._path_for(tick.timestamp)
        new_file = not os.path.exists(path)
        with open(path, "a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            if new_file:
                writer.writerow(["timestamp", "bid", "ask", "mid", "spread"])
            writer.writerow(
                [
                    tick.timestamp.isoformat(),
                    f"{tick.bid:.5f}",
                    f"{tick.ask:.5f}",
                    f"{tick.mid:.5f}",
                    f"{tick.spread:.5f}",
                ]
            )


class CandleBuilder:
    """
    ティックを指定秒数のバケットに集約してローソク足を作る。

    interval_sec=60 で 1 分足、300 で 5 分足相当となる。
    確定した足は ``candles`` に最大 ``maxlen`` 本だけ保持する。
    """

    def __init__(self, interval_sec: int, maxlen: int = 500) -> None:
        self.interval_sec = interval_sec
        self.candles: Deque[Candle] = deque(maxlen=maxlen)
        self._current: Optional[Candle] = None
        self._current_bucket: Optional[int] = None

    def _bucket_id(self, dt: datetime) -> int:
        return int(dt.timestamp()) // self.interval_sec

    def add_price(self, dt: datetime, price: float) -> Optional[Candle]:
        """
        価格を 1 点追加する。新しいバケットに入って前の足が確定した場合、
        確定した足を返す（それ以外は None）。
        """
        bucket = self._bucket_id(dt)
        finalized: Optional[Candle] = None

        if self._current_bucket is None:
            self._start_new(bucket, dt, price)
        elif bucket == self._current_bucket:
            c = self._current
            assert c is not None
            c.high = max(c.high, price)
            c.low = min(c.low, price)
            c.close = price
        else:
            # バケットが変わった → 現在の足を確定
            if self._current is not None:
                self.candles.append(self._current)
                finalized = self._current
            self._start_new(bucket, dt, price)

        return finalized

    def _start_new(self, bucket: int, dt: datetime, price: float) -> None:
        start = datetime.fromtimestamp(bucket * self.interval_sec, tz=timezone.utc)
        self._current_bucket = bucket
        self._current = Candle(start=start, open=price, high=price, low=price, close=price)

    def closes(self) -> List[float]:
        """確定済みローソク足の終値リスト（古い順）。"""
        return [c.close for c in self.candles]

    def closes_with_current(self) -> List[float]:
        """確定足 + 形成中の足の終値も含めたリスト。"""
        result = self.closes()
        if self._current is not None:
            result.append(self._current.close)
        return result
