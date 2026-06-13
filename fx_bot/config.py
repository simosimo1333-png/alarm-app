"""
config.py
---------
環境変数と運用パラメータを一元管理するモジュール。

すべての設定値はここに集約し、他モジュールは ``from config import settings`` のように
参照する。秘匿情報（APIキー等）は環境変数からのみ読み込み、コードには埋め込まない。
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, time
from typing import List, Tuple


def _get_bool(key: str, default: bool) -> bool:
    val = os.environ.get(key)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


def _get_float(key: str, default: float) -> float:
    val = os.environ.get(key)
    if val is None or val.strip() == "":
        return default
    try:
        return float(val)
    except ValueError:
        return default


def _get_int(key: str, default: int) -> int:
    val = os.environ.get(key)
    if val is None or val.strip() == "":
        return default
    try:
        return int(val)
    except ValueError:
        return default


def _get_str(key: str, default: str) -> str:
    val = os.environ.get(key)
    return default if val is None else val


def _parse_news_windows(raw: str) -> List[Tuple[time, time]]:
    """
    経済指標の取引停止時間帯を ``HH:MM-HH:MM,HH:MM-HH:MM`` 形式で受け取りパースする。
    時刻はすべて TZ（既定 JST）基準。
    """
    windows: List[Tuple[time, time]] = []
    raw = (raw or "").strip()
    if not raw:
        return windows
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk or "-" not in chunk:
            continue
        start_s, end_s = chunk.split("-", 1)
        try:
            sh, sm = (int(x) for x in start_s.strip().split(":"))
            eh, em = (int(x) for x in end_s.strip().split(":"))
            windows.append((time(sh, sm), time(eh, em)))
        except ValueError:
            continue
    return windows


@dataclass
class Settings:
    # --- API 認証（環境変数のみ） ---
    api_key: str = field(default_factory=lambda: _get_str("GMO_API_KEY", ""))
    api_secret: str = field(default_factory=lambda: _get_str("GMO_API_SECRET", ""))

    # --- エンドポイント（GMOコイン 外国為替FX API） ---
    public_base_url: str = field(
        default_factory=lambda: _get_str(
            "GMO_PUBLIC_BASE_URL", "https://forex-api.coin.z.com/public"
        )
    )
    private_base_url: str = field(
        default_factory=lambda: _get_str(
            "GMO_PRIVATE_BASE_URL", "https://forex-api.coin.z.com/private"
        )
    )
    ws_public_url: str = field(
        default_factory=lambda: _get_str(
            "GMO_WS_PUBLIC_URL", "wss://forex-api.coin.z.com/ws/public/v1"
        )
    )

    # --- 動作モード ---
    # DRY_RUN=true（既定）: 注文を一切送信せず、判断とログ出力のみ行う。
    dry_run: bool = field(default_factory=lambda: _get_bool("DRY_RUN", True))
    use_websocket: bool = field(default_factory=lambda: _get_bool("USE_WEBSOCKET", False))

    # --- 取引対象 ---
    symbol: str = field(default_factory=lambda: _get_str("SYMBOL", "USD_JPY"))
    poll_interval_sec: int = field(default_factory=lambda: _get_int("POLL_INTERVAL_SEC", 60))

    # --- テクニカル指標 ---
    ma_short: int = field(default_factory=lambda: _get_int("MA_SHORT", 5))
    ma_long: int = field(default_factory=lambda: _get_int("MA_LONG", 20))
    rsi_period: int = field(default_factory=lambda: _get_int("RSI_PERIOD", 14))
    rsi_upper: float = field(default_factory=lambda: _get_float("RSI_UPPER", 70.0))
    rsi_lower: float = field(default_factory=lambda: _get_float("RSI_LOWER", 30.0))

    # --- 注文・建玉 ---
    order_size: int = field(default_factory=lambda: _get_int("ORDER_SIZE", 10000))
    max_order_size: int = field(default_factory=lambda: _get_int("MAX_ORDER_SIZE", 10000))

    # --- pips 設定（USD_JPY は 1 pip = 0.01 円） ---
    pip_value: float = field(default_factory=lambda: _get_float("PIP_VALUE", 0.01))
    take_profit_pips: float = field(default_factory=lambda: _get_float("TAKE_PROFIT_PIPS", 10.0))
    stop_loss_pips: float = field(default_factory=lambda: _get_float("STOP_LOSS_PIPS", 7.0))

    # --- リスク管理 ---
    max_daily_loss_jpy: float = field(
        default_factory=lambda: _get_float("MAX_DAILY_LOSS_JPY", 5000.0)
    )
    max_spread_pips: float = field(default_factory=lambda: _get_float("MAX_SPREAD_PIPS", 0.5))
    min_margin_ratio: float = field(
        default_factory=lambda: _get_float("MIN_MARGIN_RATIO", 200.0)
    )  # 証拠金維持率(%)の下限

    # --- 経済指標 回避時間帯（TZ基準） ---
    news_windows_raw: str = field(default_factory=lambda: _get_str("NEWS_WINDOWS", ""))
    timezone: str = field(default_factory=lambda: _get_str("TZ_NAME", "Asia/Tokyo"))

    # --- 通知 ---
    notify_channel: str = field(
        default_factory=lambda: _get_str("NOTIFY_CHANNEL", "none")
    )  # none / line / email
    line_token: str = field(default_factory=lambda: _get_str("LINE_NOTIFY_TOKEN", ""))
    smtp_host: str = field(default_factory=lambda: _get_str("SMTP_HOST", ""))
    smtp_port: int = field(default_factory=lambda: _get_int("SMTP_PORT", 587))
    smtp_user: str = field(default_factory=lambda: _get_str("SMTP_USER", ""))
    smtp_password: str = field(default_factory=lambda: _get_str("SMTP_PASSWORD", ""))
    mail_from: str = field(default_factory=lambda: _get_str("MAIL_FROM", ""))
    mail_to: str = field(default_factory=lambda: _get_str("MAIL_TO", ""))

    # --- ファイルパス ---
    data_dir: str = field(default_factory=lambda: _get_str("DATA_DIR", "data"))
    log_dir: str = field(default_factory=lambda: _get_str("LOG_DIR", "logs"))
    stop_file: str = field(default_factory=lambda: _get_str("STOP_FILE", "stop.txt"))

    def __post_init__(self) -> None:
        self.news_windows: List[Tuple[time, time]] = _parse_news_windows(self.news_windows_raw)

    # --- 便利メソッド ---
    @property
    def take_profit_price_diff(self) -> float:
        return self.take_profit_pips * self.pip_value

    @property
    def stop_loss_price_diff(self) -> float:
        return self.stop_loss_pips * self.pip_value

    def validate(self) -> List[str]:
        """設定の妥当性を検証し、問題点のリストを返す（空なら正常）。"""
        problems: List[str] = []
        if not self.dry_run:
            if not self.api_key or not self.api_secret:
                problems.append("DRY_RUN=false だが GMO_API_KEY / GMO_API_SECRET が未設定です。")
        if self.order_size > self.max_order_size:
            problems.append(
                f"ORDER_SIZE({self.order_size}) が MAX_ORDER_SIZE({self.max_order_size}) を超えています。"
            )
        if self.ma_short >= self.ma_long:
            problems.append("MA_SHORT は MA_LONG より小さくしてください。")
        if self.take_profit_pips <= 0 or self.stop_loss_pips <= 0:
            problems.append("TAKE_PROFIT_PIPS / STOP_LOSS_PIPS は正の値にしてください。")
        return problems


# シングルトン的に共有する設定インスタンス
settings = Settings()
