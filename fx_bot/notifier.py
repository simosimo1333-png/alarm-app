"""
notifier.py
-----------
売買シグナル・注文結果・停止理由を LINE またはメールで通知する。

NOTIFY_CHANNEL の値で送信先を切り替える:
  none  : 通知しない（ログのみ）
  line  : LINE Notify（LINE_NOTIFY_TOKEN が必要）
  email : SMTP メール（SMTP_* / MAIL_* が必要）

通知の失敗は致命傷にしない（ログに残して処理は継続）。
"""

from __future__ import annotations

import smtplib
from email.mime.text import MIMEText
from email.utils import formatdate
from typing import Optional

import requests

from logger import get_logger

logger = get_logger()


class Notifier:
    def __init__(
        self,
        channel: str = "none",
        line_token: str = "",
        smtp_host: str = "",
        smtp_port: int = 587,
        smtp_user: str = "",
        smtp_password: str = "",
        mail_from: str = "",
        mail_to: str = "",
    ) -> None:
        self.channel = (channel or "none").lower()
        self.line_token = line_token
        self.smtp_host = smtp_host
        self.smtp_port = smtp_port
        self.smtp_user = smtp_user
        self.smtp_password = smtp_password
        self.mail_from = mail_from
        self.mail_to = mail_to

    def notify(self, subject: str, message: str) -> None:
        """通知を送信する。チャンネル未設定/失敗時もログに残して継続。"""
        text = f"[FX BOT] {subject}\n{message}"
        try:
            if self.channel == "line":
                self._send_line(text)
            elif self.channel == "email":
                self._send_email(subject, message)
            else:
                logger.info("通知(none): %s", text.replace("\n", " | "))
        except Exception as e:  # 通知失敗は処理を止めない
            logger.error("通知の送信に失敗しました: %s", e)

    def _send_line(self, text: str) -> None:
        if not self.line_token:
            logger.warning("LINE_NOTIFY_TOKEN 未設定のため LINE 通知をスキップ")
            return
        resp = requests.post(
            "https://notify-api.line.me/api/notify",
            headers={"Authorization": f"Bearer {self.line_token}"},
            data={"message": text},
            timeout=10,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"LINE Notify HTTP {resp.status_code}: {resp.text[:120]}")

    def _send_email(self, subject: str, body: str) -> None:
        if not (self.smtp_host and self.mail_from and self.mail_to):
            logger.warning("SMTP/メール設定が不足しているためメール通知をスキップ")
            return
        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = f"[FX BOT] {subject}"
        msg["From"] = self.mail_from
        msg["To"] = self.mail_to
        msg["Date"] = formatdate(localtime=True)

        with smtplib.SMTP(self.smtp_host, self.smtp_port, timeout=15) as server:
            server.starttls()
            if self.smtp_user:
                server.login(self.smtp_user, self.smtp_password)
            server.sendmail(self.mail_from, [self.mail_to], msg.as_string())
