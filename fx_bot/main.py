"""
main.py
-------
FX自動売買ボットのエントリーポイント。

処理フロー（1ループ = POLL_INTERVAL_SEC ごと）:
  1. stop.txt / 停止フラグの確認
  2. Public API で価格取得 → CSV 保存 → 足を更新
  3. 保有建玉があれば 利確/損切り 判定 → 条件成立で決済
  4. 指標を計算し売買シグナルを判定
  5. リスクチェックを通過したら 新規エントリー
       - DRY_RUN=true: 注文予定をログ出力のみ
       - DRY_RUN=false: Private API で実発注（事前に建玉/証拠金/有効注文を確認）
  6. API/通信/想定外エラー時は通知して安全停止

このボットは個人利用・学習目的を想定しています。実弾運用は自己責任で、
必ず DRY_RUN とデモ的検証を十分に行ってから移行してください。
"""

from __future__ import annotations

import signal
import sys
import time
from datetime import datetime, timezone

from config import settings
from logger import setup_logger
from data_store import CandleBuilder, Tick, TickCsvStore
from broker_gmo_fx import BrokerError, GmoFxBroker, GmoFxWebSocket, TickerData
from strategy import Signal, Strategy
from risk_manager import PositionState, RiskManager
from notifier import Notifier

logger = setup_logger(settings.log_dir)

_shutdown = False


def _handle_sigterm(signum, frame):
    global _shutdown
    _shutdown = True
    logger.info("シグナル %s を受信。次のループ後に停止します。", signum)


class TradingBot:
    def __init__(self) -> None:
        self.cfg = settings
        self.broker = GmoFxBroker(
            api_key=self.cfg.api_key,
            api_secret=self.cfg.api_secret,
            public_base_url=self.cfg.public_base_url,
            private_base_url=self.cfg.private_base_url,
        )
        self.store = TickCsvStore(self.cfg.data_dir, self.cfg.symbol)
        self.candle_1m = CandleBuilder(interval_sec=60)
        self.candle_5m = CandleBuilder(interval_sec=300)
        self.strategy = Strategy(
            ma_short=self.cfg.ma_short,
            ma_long=self.cfg.ma_long,
            rsi_period=self.cfg.rsi_period,
            rsi_upper=self.cfg.rsi_upper,
            rsi_lower=self.cfg.rsi_lower,
        )
        self.risk = RiskManager(
            max_order_size=self.cfg.max_order_size,
            max_daily_loss_jpy=self.cfg.max_daily_loss_jpy,
            max_spread_pips=self.cfg.max_spread_pips,
            min_margin_ratio=self.cfg.min_margin_ratio,
            pip_value=self.cfg.pip_value,
            take_profit_pips=self.cfg.take_profit_pips,
            stop_loss_pips=self.cfg.stop_loss_pips,
            news_windows=self.cfg.news_windows,
            timezone=self.cfg.timezone,
            stop_file=self.cfg.stop_file,
        )
        self.notifier = Notifier(
            channel=self.cfg.notify_channel,
            line_token=self.cfg.line_token,
            smtp_host=self.cfg.smtp_host,
            smtp_port=self.cfg.smtp_port,
            smtp_user=self.cfg.smtp_user,
            smtp_password=self.cfg.smtp_password,
            mail_from=self.cfg.mail_from,
            mail_to=self.cfg.mail_to,
        )
        # ボットが管理するポジション状態（単一建玉前提の簡易管理）
        self.position = PositionState()
        self._ws: GmoFxWebSocket | None = None
        self._latest_ticker: TickerData | None = None

    # ---------------------------------------------------------------- #
    def startup_checks(self) -> bool:
        problems = self.cfg.validate()
        if problems:
            for p in problems:
                logger.error("設定エラー: %s", p)
            self.notifier.notify("起動失敗", "設定エラー:\n" + "\n".join(problems))
            return False
        mode = "DRY_RUN(検証)" if self.cfg.dry_run else "本番(実発注)"
        logger.info(
            "起動: symbol=%s mode=%s interval=%ds MA(%d/%d) RSI(%d)",
            self.cfg.symbol, mode, self.cfg.poll_interval_sec,
            self.cfg.ma_short, self.cfg.ma_long, self.cfg.rsi_period,
        )
        self.notifier.notify("起動", f"FXボットを起動しました（{mode}, {self.cfg.symbol}）")
        return True

    def maybe_start_websocket(self) -> None:
        if not self.cfg.use_websocket:
            return
        def on_ticker(t: TickerData) -> None:
            self._latest_ticker = t
        try:
            self._ws = GmoFxWebSocket(self.cfg.ws_public_url, self.cfg.symbol, on_ticker)
            self._ws.start()
            logger.info("WebSocket を開始しました。")
        except BrokerError as e:
            logger.warning("WebSocket 開始に失敗（REST にフォールバック）: %s", e)

    # ---------------------------------------------------------------- #
    def fetch_ticker(self) -> TickerData:
        """WebSocket 優先、無ければ REST で最新レートを取得。"""
        if self.cfg.use_websocket and self._latest_ticker is not None:
            return self._latest_ticker
        return self.broker.get_ticker(self.cfg.symbol)

    def update_candles(self, ticker: TickerData) -> None:
        tick = Tick(timestamp=ticker.timestamp, bid=ticker.bid, ask=ticker.ask)
        self.store.record_tick(tick)
        self.candle_1m.add_price(ticker.timestamp, tick.mid)
        self.candle_5m.add_price(ticker.timestamp, tick.mid)

    # ---------------------------------------------------------------- #
    def handle_exit(self, ticker: TickerData) -> None:
        """保有建玉の利確・損切り判定と決済。"""
        if not self.position.has_position:
            return
        should, reason = self.risk.should_exit(self.position, ticker.bid, ticker.ask)
        if not should:
            return

        close_side = "SELL" if self.position.side == "BUY" else "BUY"
        pnl = self.risk.estimate_pnl(self.position, ticker.bid, ticker.ask)
        msg = (
            f"決済シグナル: {reason} / {self.position.side}建玉を{close_side}で決済 "
            f"size={self.position.size} 概算損益={pnl:+.0f}円"
        )
        logger.info(msg)

        if self.cfg.dry_run:
            logger.info("[DRY_RUN] 決済注文は送信しません（予定のみ）。")
        else:
            try:
                result = self.broker.close_market_order(
                    self.cfg.symbol, close_side, self.position.size,
                    position_id=self.position.position_id,
                )
                logger.info("決済注文応答: %s", result)
            except BrokerError as e:
                self._fail_stop(f"決済注文エラー: {e}")
                return

        self.risk.register_realized_pnl(pnl)
        self.notifier.notify("決済", msg)
        self.position = PositionState()  # クリア

        if self.risk.daily_loss_exceeded():
            self._fail_stop(
                f"1日の損失上限({self.cfg.max_daily_loss_jpy}円)に到達。自動停止します。"
            )

    def handle_entry(self, ticker: TickerData) -> None:
        """シグナル判定と新規エントリー。"""
        closes = self.candle_1m.closes_with_current()
        spread_ok = self.risk.spread_ok(ticker.spread)
        signal, ind, reason = self.strategy.evaluate(
            closes, self.position.has_position, spread_ok
        )

        logger.info(
            "判断: signal=%s spread=%.1fpips %s",
            signal.value, ticker.spread / self.cfg.pip_value, reason,
        )

        if signal == Signal.NONE:
            return

        # 本番時のみ、発注前に口座状態を実 API で再確認する
        margin_ratio = None
        if not self.cfg.dry_run:
            try:
                margin_ratio = self.broker.get_margin_ratio()
                live_positions = self.broker.get_open_positions(self.cfg.symbol)
                active_orders = self.broker.get_active_orders(self.cfg.symbol)
                if live_positions:
                    logger.info("既存建玉を検出（%d件）。新規を見送ります。", len(live_positions))
                    return
                if active_orders:
                    logger.info("有効注文を検出（%d件）。新規を見送ります。", len(active_orders))
                    return
            except BrokerError as e:
                self._fail_stop(f"発注前チェックでAPIエラー: {e}")
                return

        ok, why = self.risk.can_enter(
            signal, ticker.spread, margin_ratio, self.position.has_position
        )
        if not ok:
            logger.info("エントリー見送り: %s", why)
            return

        size = self.risk.clamp_size(self.cfg.order_size)
        entry_price = ticker.ask if signal == Signal.BUY else ticker.bid
        plan = (
            f"{signal.value} {self.cfg.symbol} size={size} @~{entry_price:.3f} "
            f"(TP {self.cfg.take_profit_pips}pips / SL {self.cfg.stop_loss_pips}pips) 理由: {reason}"
        )

        if self.cfg.dry_run:
            logger.info("[DRY_RUN] 注文予定（送信せず）: %s", plan)
            self.notifier.notify("シグナル(DRY_RUN)", plan)
            # DRY_RUN でも内部的に建玉を持ったとみなし、決済ロジックを検証可能にする
            self._open_local_position(signal.value, entry_price, size, None)
            self.risk.record_entry(signal.value)
            return

        # 本番発注
        try:
            result = self.broker.place_market_order(self.cfg.symbol, signal.value, size)
            logger.info("新規注文応答: %s", result)
        except BrokerError as e:
            self._fail_stop(f"新規注文エラー: {e}")
            return

        position_id = self._extract_position_id(result)
        self._open_local_position(signal.value, entry_price, size, position_id)
        self.risk.record_entry(signal.value)
        self.notifier.notify("新規注文", plan)

    def _open_local_position(self, side: str, price: float, size: int, position_id) -> None:
        self.position = PositionState(
            side=side, entry_price=price, size=size,
            position_id=position_id, opened_at=datetime.now(timezone.utc),
        )

    @staticmethod
    def _extract_position_id(result) -> str | None:
        # 応答仕様に応じて建玉IDを抽出（成行は約定後に建玉が立つため後続照会が必要な場合あり）
        if isinstance(result, dict):
            for k in ("positionId", "rootOrderId", "orderId"):
                if k in result:
                    return str(result[k])
        return None

    # ---------------------------------------------------------------- #
    def _fail_stop(self, reason: str) -> None:
        logger.error("自動停止: %s", reason)
        self.risk.halt(reason)
        self.notifier.notify("自動停止", reason)

    def run(self) -> None:
        if not self.startup_checks():
            sys.exit(1)
        self.maybe_start_websocket()

        global _shutdown
        while not _shutdown:
            loop_start = time.monotonic()

            # 1. 手動停止チェック
            if self.risk.stop_file_exists():
                self._fail_stop(f"{self.cfg.stop_file} を検出。即時停止します。")
            if self.risk.halted:
                logger.info("停止状態のためループを終了します。理由: %s", self.risk.halt_reason)
                break

            # 2-5. メイン処理
            try:
                ticker = self.fetch_ticker()
                if ticker.status not in ("OPEN", "UNKNOWN"):
                    logger.info("市場ステータス %s のため取引を見送ります。", ticker.status)
                else:
                    self.update_candles(ticker)
                    self.handle_exit(ticker)
                    if not self.risk.halted:
                        self.handle_entry(ticker)
            except BrokerError as e:
                self._fail_stop(f"APIエラー/想定外レスポンス: {e}")
            except Exception as e:  # 想定外も安全側に倒して停止
                logger.exception("想定外の例外")
                self._fail_stop(f"想定外の例外: {e}")

            if self.risk.halted:
                break

            # 6. インターバルまでスリープ
            elapsed = time.monotonic() - loop_start
            time.sleep(max(0.0, self.cfg.poll_interval_sec - elapsed))

        logger.info("ボットを終了しました。")
        self.notifier.notify("終了", f"FXボットが終了しました。理由: {self.risk.halt_reason or '正常終了/シグナル'}")
        if self._ws is not None:
            self._ws.stop()


def main() -> None:
    signal.signal(signal.SIGINT, _handle_sigterm)
    signal.signal(signal.SIGTERM, _handle_sigterm)
    bot = TradingBot()
    bot.run()


if __name__ == "__main__":
    main()
