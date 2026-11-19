"""Sending a WhatsApp message for the user.

With Twilio credentials the message is delivered by the service itself, with no
further tap. Without them the caller falls back to opening WhatsApp with the
text prepared. Either way the assistant only calls this after a spoken yes.
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from urllib.parse import quote

SANDBOX_NUMBER = '+14155238886'  # Twilio's shared WhatsApp sandbox sender


class MessageError(Exception):
    pass


def configured() -> bool:
    return bool(os.getenv('TWILIO_ACCOUNT_SID') and os.getenv('TWILIO_AUTH_TOKEN'))


def desktop_enabled() -> bool:
    """Opt-in: let the service press Send in WhatsApp Desktop on this Windows computer."""
    return sys.platform == 'win32' and os.getenv('WHATSAPP_DESKTOP_SEND', '').lower() in {'1', 'true', 'yes'}


# Opens the chat with the text filled in, waits for the window, then presses Enter in it.
# The key press only happens if a window titled "WhatsApp" could be brought to the front.
_DESKTOP_SCRIPT = (
    "Start-Process $env:GUIDEBAND_WA_URI; Start-Sleep -Milliseconds ([int]$env:GUIDEBAND_WA_DELAY); "
    "$shell = New-Object -ComObject WScript.Shell; "
    "if ($shell.AppActivate('WhatsApp')) { Start-Sleep -Milliseconds 600; $shell.SendKeys('{ENTER}'); 'sent' } else { 'no-window' }"
)


async def send_desktop(phone: str, text: str) -> bool:
    """Send through the WhatsApp Desktop app the user is signed in to. True when Send was pressed."""
    env = {**os.environ,
           'GUIDEBAND_WA_URI': f'whatsapp://send?phone={phone}&text={quote(text)}',
           'GUIDEBAND_WA_DELAY': os.getenv('WHATSAPP_SEND_DELAY_MS', '4000')}
    try:
        result = await asyncio.to_thread(
            subprocess.run, ['powershell', '-NoProfile', '-NonInteractive', '-Command', _DESKTOP_SCRIPT],
            env=env, capture_output=True, text=True, timeout=40,
        )
    except Exception:
        return False
    return 'sent' in result.stdout


async def send_whatsapp(phone: str, text: str) -> dict:
    """Deliver `text` to `phone` (digits with country code). Raises MessageError on failure."""
    import httpx
    sid, token = os.environ['TWILIO_ACCOUNT_SID'], os.environ['TWILIO_AUTH_TOKEN']
    sender = os.getenv('TWILIO_WHATSAPP_FROM', SANDBOX_NUMBER)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
            response = await client.post(
                f'https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json',
                auth=(sid, token),
                data={'From': f'whatsapp:{sender}', 'To': f'whatsapp:+{phone}', 'Body': text[:1500]},
            )
    except Exception as error:
        raise MessageError('I could not reach the message service.') from error
    if response.status_code >= 400:
        raise MessageError('The message service refused the message.')
    return {'id': response.json().get('sid'), 'status': response.json().get('status')}
