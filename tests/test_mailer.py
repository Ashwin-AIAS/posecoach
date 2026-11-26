"""Mailer tests (P33) — console backend logs the link; smtp backend selectable."""
from __future__ import annotations

from email.message import EmailMessage

import pytest
from structlog.testing import capture_logs

from app.mail import mailer

RESET_URL = "https://posecoach.example/reset-password?token=abc123def456"


async def test_console_backend_logs_reset_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAIL_BACKEND", "console")
    monkeypatch.setenv("ENVIRONMENT", "development")
    with capture_logs() as logs:
        await mailer.send_password_reset("user@example.com", RESET_URL)
    bodies = [str(entry.get("body", "")) for entry in logs]
    assert any(RESET_URL in body for body in bodies)
    assert any(entry.get("backend") == "console" for entry in logs)


async def test_console_backend_logs_username(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAIL_BACKEND", "console")
    monkeypatch.setenv("ENVIRONMENT", "development")
    with capture_logs() as logs:
        await mailer.send_username("user@example.com", "user@example.com")
    assert any(entry.get("event") == "mail_console" for entry in logs)
    assert any("user@example.com" in str(entry.get("body", "")) for entry in logs)


async def test_smtp_backend_selected_and_sends(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAIL_BACKEND", "smtp")
    monkeypatch.setenv("SMTP_HOST", "smtp.gmail.com")
    monkeypatch.setenv("SMTP_PORT", "587")
    monkeypatch.setenv("SMTP_USER", "bot@gmail.com")
    monkeypatch.setenv("SMTP_PASSWORD", "app-password")
    monkeypatch.setenv("SMTP_FROM", "PoseCoach <no-reply@posecoach.app>")

    sent: dict[str, EmailMessage] = {}

    def fake_send(msg: EmailMessage) -> None:
        sent["msg"] = msg

    monkeypatch.setattr(mailer, "_send_smtp", fake_send)

    with capture_logs() as logs:
        await mailer.send_password_reset("user@example.com", RESET_URL)

    assert "msg" in sent, "smtp backend must invoke the SMTP transport"
    msg = sent["msg"]
    assert msg["To"] == "user@example.com"
    assert RESET_URL in msg.get_content()
    # Prod path must not log the recipient, token, or body.
    for entry in logs:
        assert "body" not in entry
        assert entry.get("to") is None
        assert RESET_URL not in str(entry)


async def test_smtp_transport_uses_starttls_and_login(monkeypatch: pytest.MonkeyPatch) -> None:
    """The real _send_smtp opens STARTTLS + login before sending (no network)."""
    monkeypatch.setenv("SMTP_HOST", "smtp.gmail.com")
    monkeypatch.setenv("SMTP_PORT", "587")
    monkeypatch.setenv("SMTP_USER", "bot@gmail.com")
    monkeypatch.setenv("SMTP_PASSWORD", "app-password")

    calls: list[str] = []

    class FakeSMTP:
        def __init__(self, host: str, port: int, timeout: int) -> None:
            calls.append(f"connect:{host}:{port}")

        def __enter__(self) -> FakeSMTP:
            return self

        def __exit__(self, *exc: object) -> None:
            return None

        def starttls(self) -> None:
            calls.append("starttls")

        def login(self, user: str, password: str) -> None:
            calls.append(f"login:{user}")

        def send_message(self, msg: EmailMessage) -> None:
            calls.append("send")

    monkeypatch.setattr("app.mail.mailer.smtplib.SMTP", FakeSMTP)

    msg = EmailMessage()
    msg["To"] = "user@example.com"
    msg.set_content("hi")
    mailer._send_smtp(msg)

    assert calls == ["connect:smtp.gmail.com:587", "starttls", "login:bot@gmail.com", "send"]


@pytest.mark.parametrize("environment", ["production", "staging"])
async def test_console_backend_outside_development_never_logs_token(
    monkeypatch: pytest.MonkeyPatch, environment: str
) -> None:
    # SECURITY_REVIEW.md H-2: an unset MAIL_BACKEND on a deployed instance must
    # not write the reset link or the recipient's email into the log stream.
    monkeypatch.delenv("MAIL_BACKEND", raising=False)
    monkeypatch.setenv("ENVIRONMENT", environment)
    with capture_logs() as logs:
        await mailer.send_password_reset("user@example.com", RESET_URL)
    rendered = repr(logs)
    assert "abc123def456" not in rendered
    assert "user@example.com" not in rendered
    assert any(e.get("event") == "mail_not_sent_console_backend_in_production" for e in logs)
