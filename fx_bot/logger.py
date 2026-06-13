"""
logger.py
---------
すべての判断・価格・注文・約定・エラーを記録するロギング基盤。

- コンソール出力とファイル出力（日次ローテーション）の両方を行う。
- ``get_logger()`` でアプリ共通のロガーを取得する。
"""

from __future__ import annotations

import logging
import os
from logging.handlers import TimedRotatingFileHandler

_LOGGER_NAME = "fx_bot"
_initialized = False


def setup_logger(log_dir: str = "logs", level: int = logging.INFO) -> logging.Logger:
    """ロガーを初期化する（多重初期化は防止）。"""
    global _initialized
    logger = logging.getLogger(_LOGGER_NAME)
    if _initialized:
        return logger

    os.makedirs(log_dir, exist_ok=True)
    logger.setLevel(level)
    logger.propagate = False

    fmt = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # コンソール
    console = logging.StreamHandler()
    console.setFormatter(fmt)
    logger.addHandler(console)

    # ファイル（日次ローテーション、14日保持）
    file_path = os.path.join(log_dir, "fx_bot.log")
    file_handler = TimedRotatingFileHandler(
        file_path, when="midnight", backupCount=14, encoding="utf-8"
    )
    file_handler.setFormatter(fmt)
    logger.addHandler(file_handler)

    _initialized = True
    logger.info("ロガーを初期化しました (log_dir=%s)", log_dir)
    return logger


def get_logger() -> logging.Logger:
    """初期化済みロガーを取得する。未初期化なら既定設定で初期化する。"""
    if not _initialized:
        return setup_logger()
    return logging.getLogger(_LOGGER_NAME)
