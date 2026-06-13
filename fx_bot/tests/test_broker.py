"""
broker_gmo_fx の署名生成と、main の建玉同期ヘルパーのオフラインテスト。
ネットワークは使用しない。
"""

import hashlib
import hmac
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from broker_gmo_fx import GmoFxBroker  # noqa: E402


class TestSigning(unittest.TestCase):
    def test_signature_matches_manual_hmac(self):
        broker = GmoFxBroker(
            api_key="key", api_secret="secret",
            public_base_url="https://example/public",
            private_base_url="https://example/private",
        )
        headers = broker._headers("POST", "/v1/order", '{"symbol":"USD_JPY"}')
        ts = headers["API-TIMESTAMP"]
        expected = hmac.new(
            b"secret",
            (ts + "POST" + "/v1/order" + '{"symbol":"USD_JPY"}').encode("ascii"),
            hashlib.sha256,
        ).hexdigest()
        self.assertEqual(headers["API-SIGN"], expected)
        self.assertEqual(headers["API-KEY"], "key")
        self.assertIn("Content-Type", headers)


class TestPositionReconcile(unittest.TestCase):
    def test_position_from_api(self):
        # main をインポート（モジュールロードでネットワークは発生しない）
        os.environ.setdefault("DRY_RUN", "true")
        import main  # noqa: E402
        item = {"positionId": "12345", "side": "BUY", "size": "10000", "price": "150.123"}
        pos = main.TradingBot._position_from_api(item)
        self.assertEqual(pos.side, "BUY")
        self.assertEqual(pos.size, 10000)
        self.assertEqual(pos.position_id, "12345")
        self.assertAlmostEqual(pos.entry_price, 150.123)
        self.assertTrue(pos.has_position)


if __name__ == "__main__":
    unittest.main()
