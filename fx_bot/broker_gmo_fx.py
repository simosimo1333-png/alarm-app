"""
broker_gmo_fx.py
----------------
GMOコイン 外国為替FX API クライアント。

- Public API: 価格（ticker）・稼働状況の取得（認証不要）
- Private API: 資産/証拠金・建玉・有効注文の照会、新規/決済注文（HMAC-SHA256 認証）
- WebSocket: リアルタイム ticker 購読（任意）

注意:
  エンドポイントのパス・パラメータは GMOコイン外国為替FX の公式 API 仕様
  （https://api.coin.z.com/fxdocs/）に準拠する想定です。利用前に最新仕様を確認し、
  必要に応じて定数を調整してください。本番運用は十分なテスト後に行ってください。
"""

from __future__ import annotations

import hashlib
import hmac
import json
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

import requests


class BrokerError(Exception):
    """API 呼び出し失敗・想定外レスポンスを表す例外。"""


@dataclass
class TickerData:
    symbol: str
    bid: float
    ask: float
    timestamp: datetime
    status: str

    @property
    def mid(self) -> float:
        return (self.bid + self.ask) / 2.0

    @property
    def spread(self) -> float:
        return self.ask - self.bid


class GmoFxBroker:
    def __init__(
        self,
        api_key: str,
        api_secret: str,
        public_base_url: str,
        private_base_url: str,
        timeout: int = 10,
    ) -> None:
        self.api_key = api_key
        self.api_secret = api_secret
        self.public_base_url = public_base_url.rstrip("/")
        self.private_base_url = private_base_url.rstrip("/")
        self.timeout = timeout
        self._session = requests.Session()

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #
    def get_ticker(self, symbol: str) -> TickerData:
        """指定通貨ペアの最新レートを取得する。"""
        url = f"{self.public_base_url}/v1/ticker"
        try:
            resp = self._session.get(url, timeout=self.timeout)
        except requests.RequestException as e:
            raise BrokerError(f"ticker 取得の通信エラー: {e}") from e

        payload = self._parse_json(resp)
        if payload.get("status") != 0:
            raise BrokerError(f"ticker API エラー応答: {payload}")

        for item in payload.get("data", []):
            if item.get("symbol") == symbol:
                try:
                    return TickerData(
                        symbol=symbol,
                        bid=float(item["bid"]),
                        ask=float(item["ask"]),
                        timestamp=self._parse_ts(item.get("timestamp")),
                        status=item.get("status", "UNKNOWN"),
                    )
                except (KeyError, ValueError) as e:
                    raise BrokerError(f"ticker のパースに失敗: {item} ({e})") from e
        raise BrokerError(f"ticker に対象シンボル {symbol} が見つかりません: {payload}")

    def get_status(self) -> str:
        """取引所の稼働状況（OPEN/CLOSE/MAINTENANCE）を返す。"""
        url = f"{self.public_base_url}/v1/status"
        try:
            resp = self._session.get(url, timeout=self.timeout)
        except requests.RequestException as e:
            raise BrokerError(f"status 取得の通信エラー: {e}") from e
        payload = self._parse_json(resp)
        if payload.get("status") != 0:
            raise BrokerError(f"status API エラー応答: {payload}")
        return payload.get("data", {}).get("status", "UNKNOWN")

    # ------------------------------------------------------------------ #
    # Private API（認証あり）
    # ------------------------------------------------------------------ #
    def _headers(self, method: str, path: str, body: str = "") -> Dict[str, str]:
        """HMAC-SHA256 署名ヘッダを生成する。path は /v1/... を含む。"""
        timestamp = str(int(time.time() * 1000))
        text = timestamp + method + path + body
        sign = hmac.new(
            self.api_secret.encode("ascii"),
            text.encode("ascii"),
            hashlib.sha256,
        ).hexdigest()
        return {
            "API-KEY": self.api_key,
            "API-TIMESTAMP": timestamp,
            "API-SIGN": sign,
            "Content-Type": "application/json",
        }

    def _private_get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
        headers = self._headers("GET", path, "")
        url = self.private_base_url + path
        try:
            resp = self._session.get(url, headers=headers, params=params, timeout=self.timeout)
        except requests.RequestException as e:
            raise BrokerError(f"GET {path} 通信エラー: {e}") from e
        payload = self._parse_json(resp)
        if payload.get("status") != 0:
            raise BrokerError(f"GET {path} エラー応答: {payload}")
        return payload.get("data")

    def _private_post(self, path: str, body: Dict[str, Any]) -> Any:
        body_str = json.dumps(body)
        headers = self._headers("POST", path, body_str)
        url = self.private_base_url + path
        try:
            resp = self._session.post(url, headers=headers, data=body_str, timeout=self.timeout)
        except requests.RequestException as e:
            raise BrokerError(f"POST {path} 通信エラー: {e}") from e
        payload = self._parse_json(resp)
        if payload.get("status") != 0:
            raise BrokerError(f"POST {path} エラー応答: {payload}")
        return payload.get("data")

    def get_assets(self) -> Dict[str, Any]:
        """資産・証拠金情報を取得する。"""
        data = self._private_get("/v1/account/assets")
        if isinstance(data, list):
            return data[0] if data else {}
        return data or {}

    def get_margin_ratio(self) -> Optional[float]:
        """証拠金維持率(%)を取得する。取得できない場合は None。"""
        assets = self.get_assets()
        for key in ("marginRatio", "margin_ratio"):
            if key in assets:
                try:
                    return float(assets[key])
                except (TypeError, ValueError):
                    return None
        return None

    def get_open_positions(self, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
        """建玉一覧を取得する。"""
        params = {"symbol": symbol} if symbol else None
        data = self._private_get("/v1/openPositions", params=params)
        if isinstance(data, dict):
            return data.get("list", [])
        if isinstance(data, list):
            return data
        return []

    def get_active_orders(self, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
        """有効注文（未約定）の一覧を取得する。"""
        params = {"symbol": symbol} if symbol else None
        data = self._private_get("/v1/activeOrders", params=params)
        if isinstance(data, dict):
            return data.get("list", [])
        if isinstance(data, list):
            return data
        return []

    def place_market_order(self, symbol: str, side: str, size: int) -> Any:
        """新規成行注文を送信する。side は 'BUY' / 'SELL'。"""
        body = {
            "symbol": symbol,
            "side": side,
            "size": str(size),
            "executionType": "MARKET",
        }
        return self._private_post("/v1/order", body)

    def close_market_order(self, symbol: str, side: str, size: int,
                           position_id: Optional[str] = None) -> Any:
        """
        決済成行注文を送信する。side は決済の方向（建玉が BUY なら 'SELL'）。
        position_id を指定すると個別建玉を決済する。
        """
        body: Dict[str, Any] = {
            "symbol": symbol,
            "side": side,
            "executionType": "MARKET",
        }
        if position_id is not None:
            body["settlePosition"] = [{"positionId": position_id, "size": str(size)}]
        else:
            body["size"] = str(size)
        return self._private_post("/v1/closeOrder", body)

    # ------------------------------------------------------------------ #
    # 補助
    # ------------------------------------------------------------------ #
    @staticmethod
    def _parse_json(resp: requests.Response) -> Dict[str, Any]:
        if resp.status_code != 200:
            raise BrokerError(f"HTTP {resp.status_code}: {resp.text[:200]}")
        try:
            return resp.json()
        except ValueError as e:
            raise BrokerError(f"JSON パース失敗: {resp.text[:200]}") from e

    @staticmethod
    def _parse_ts(raw: Optional[str]) -> datetime:
        if not raw:
            return datetime.now(timezone.utc)
        try:
            # 例: "2023-09-01T12:34:56.789Z"
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return datetime.now(timezone.utc)


class GmoFxWebSocket:
    """
    Public WebSocket で ticker をリアルタイム購読する（任意機能）。

    別スレッドで動作し、受信ごとに ``on_ticker(TickerData)`` を呼び出す。
    websocket-client パッケージが必要。
    """

    def __init__(self, ws_url: str, symbol: str,
                 on_ticker: Callable[[TickerData], None]) -> None:
        self.ws_url = ws_url
        self.symbol = symbol
        self.on_ticker = on_ticker
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._ws = None

    def start(self) -> None:
        try:
            import websocket  # type: ignore  # noqa: F401
        except ImportError as e:
            raise BrokerError(
                "WebSocket 利用には websocket-client が必要です: pip install websocket-client"
            ) from e
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self) -> None:
        import websocket  # type: ignore

        def on_open(ws):
            ws.send(json.dumps({
                "command": "subscribe",
                "channel": "ticker",
                "symbol": self.symbol,
            }))

        def on_message(ws, message):
            try:
                d = json.loads(message)
                if d.get("symbol") == self.symbol and "bid" in d and "ask" in d:
                    self.on_ticker(TickerData(
                        symbol=self.symbol,
                        bid=float(d["bid"]),
                        ask=float(d["ask"]),
                        timestamp=GmoFxBroker._parse_ts(d.get("timestamp")),
                        status=d.get("status", "OPEN"),
                    ))
            except (ValueError, KeyError):
                return

        while self._running:
            try:
                self._ws = websocket.WebSocketApp(
                    self.ws_url, on_open=on_open, on_message=on_message
                )
                self._ws.run_forever(ping_interval=30)
            except Exception:
                time.sleep(5)  # 再接続待機

    def stop(self) -> None:
        self._running = False
        if self._ws is not None:
            try:
                self._ws.close()
            except Exception:
                pass
