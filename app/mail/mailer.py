"""Email transport for account-recovery messages (P33).

Two backends, selected by the ``MAIL_BACKEND`` env var:

- ``console`` (default): logs the outgoing message via ``structlog`` so a
  locked-out developer can copy the reset link straight from the dev logs.
  This is the **dev-only** transport — it is the deliberate substitute for a
  real inbox, so it is the one place a reset URL is logged. It is never active
  in production (prod sets ``MAIL_BACKEND=smtp``).
- ``smtp``: real delivery over SMTP+STARTTLS, intended for free Gmail SMTP with
  an app password. All credentials are env-only and never logged; the ``smtp``
  path logs only the backend + event name (no email, no token, no body).

The raw reset token is never constructed here — the caller hands in a
fully-formed URL — and the token/password never appear in an ``smtp``-path log.
"""
import asyncio
import os
import smtplib
from email.message import EmailMessage

import structlog

logger = structlog.get_logger(__name__)

DEFAULT_FROM = "PoseCoach <no-reply@posecoach.app>"
_SUBJECT_RESET = "Reset your PoseCoach password"
_SUBJECT_USERNAME = "Your PoseCoach username"
_SMTP_TIMEOUT_S = 10


def _backend() -> str:
    """Return the configured mail backend name (``console`` by default)."""
    return os.environ.get("MAIL_BACKEND", "console").strip().lower()


def _build_message(to: str, subject: str, body: str) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = os.environ.get("SMTP_FROM", DEFAULT_FROM)
    msg["To"] = to
    msg.set_content(body)
    return msg


def _send_smtp(msg: EmailMessage) -> None:
    """Blocking SMTP+STARTTLS send. Runs off the event loop via ``to_thread``."""
    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT", "587"))
    user = os.environ["SMTP_USER"]
    password = os.environ["SMTP_PASSWORD"]
    with smtplib.SMTP(host, port, timeout=_SMTP_TIMEOUT_S) as smtp:
        smtp.starttls()
        smtp.login(user, password)
        smtp.send_message(msg)


async def _deliver(to: str, subject: str, body: str, event: str) -> None:
    if _backend() == "smtp":
        msg = _build_message(to, subject, body)
        await asyncio.to_thread(_send_smtp, msg)
        # Prod path: never log the recipient, token, or body.
        logger.info("mail_sent", backend="smtp", event_name=event)
        return
    # Dev console transport — intentionally logs the link so it's copyable.
    logger.info("mail_console", backend="console", event_name=event, to=to, body=body)


async def send_password_reset(email: str, reset_url: str) -> None:
    """Send (or, in dev, log) a password-reset link to ``email``."""
    body = (
        "We received a request to reset your PoseCoach password.\n\n"
        f"Reset it here (this link expires shortly):\n{reset_url}\n\n"
        "If you didn't request this, you can safely ignore this email."
    )
    await _deliver(email, _SUBJECT_RESET, body, "password_reset")


async def send_username(email: str, username: str) -> None:
    """Send (or, in dev, log) a username reminder to ``email``."""
    body = (
        "You asked us to remind you of your PoseCoach username.\n\n"
        f"Your username / sign-in email is: {username}\n\n"
        "If you didn't request this, you can safely ignore this email."
    )
    await _deliver(email, _SUBJECT_USERNAME, body, "username_reminder")
