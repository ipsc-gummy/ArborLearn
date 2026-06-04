from __future__ import annotations

import logging
import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr


logger = logging.getLogger(__name__)


class EmailConfigurationError(RuntimeError):
    pass


class EmailDeliveryError(RuntimeError):
    pass


def _smtp_port() -> int:
    raw_port = os.getenv("SMTP_PORT", "465").strip() or "465"
    try:
        return int(raw_port)
    except ValueError as exc:
        raise EmailConfigurationError("SMTP_PORT must be a number") from exc


def send_email(to_email: str, subject: str, body: str) -> None:
    host = os.getenv("SMTP_HOST", "").strip()
    username = os.getenv("SMTP_USER", "").strip()
    password = os.getenv("SMTP_PASSWORD", "")
    from_email = (os.getenv("SMTP_FROM") or username).strip()
    from_name = os.getenv("SMTP_FROM_NAME", "ArborLearn").strip() or "ArborLearn"

    if not host or not from_email or not username or not password:
        raise EmailConfigurationError("SMTP email delivery is not configured")

    message = EmailMessage()
    message["From"] = formataddr((from_name, from_email))
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(body, subtype="plain", charset="utf-8")

    context = ssl.create_default_context()
    try:
        with smtplib.SMTP_SSL(host, _smtp_port(), context=context, timeout=20) as smtp:
            smtp.login(username, password)
            smtp.send_message(message)
    except EmailConfigurationError:
        raise
    except Exception as exc:
        logger.warning("Unable to send email to %s via SMTP", to_email, exc_info=True)
        raise EmailDeliveryError("Unable to send email") from exc


def send_verification_code_email(email: str, code: str) -> None:
    body = (
        f"{email}，你好！\n\n"
        "我们已收到你在 ArborLearn 请求邮箱验证码的申请。\n\n"
        f"你的验证码为：{code}\n\n"
        "验证码有效期为 10 分钟。请仅在 ArborLearn 官方网站中输入此验证码，不要与任何人共享。"
        "ArborLearn 不会在网站之外向你索要验证码。\n\n"
        "如果这不是你本人操作，请忽略此邮件。你的账户不会因此受到影响。\n\n"
        "谢谢，\n"
        "ArborLearn 团队"
    )
    send_email(email, "ArborLearn 邮箱验证码", body)
