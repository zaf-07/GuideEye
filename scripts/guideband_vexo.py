#!/usr/bin/env python3
"""GuideBand hardware bridge for the team's Vexo Open band #20.

Uses the official vexo-open-kit unchanged. Every real connection is restricted to
Vexo-HACK-20 by the kit and is verified again before any command is sent.
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KIT = ROOT / "vexo-open-kit"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(KIT / "python"))
sys.path.insert(0, str(KIT / "examples" / "python"))

from backend.app.config import load_env  # noqa: E402
from backend.app.services.vexo_config import BAND_NAME, BAND_NUMBER, SERVICE_UUID  # noqa: E402

load_env()


def _kit_error() -> None:
    if not (KIT / "python" / "vexo_open" / "sync.py").is_file():
        raise SystemExit(
            "Missing vexo-open-kit. Run scripts/setup_vexo_open_kit.sh first."
        )


def _connect(transport: str):
    _kit_error()
    from vexo_open.sync import Band

    band = Band.connect(BAND_NUMBER, transport=transport)
    if band.number != BAND_NUMBER or band.name != BAND_NAME:
        band.disconnect()
        raise RuntimeError(
            f"Wrong band refused: expected {BAND_NAME}, got {band.name!r}."
        )
    return band


def check(transport: str) -> None:
    with _connect(transport) as band:
        battery = band.get_battery()
        print(
            json.dumps(
                {
                    "connected": True,
                    "number": band.number,
                    "name": band.name,
                    "transport": band.transport_kind,
                    "service_uuid": SERVICE_UUID,
                    "firmware": band.info.firmware,
                    "protocol": band.info.protocol,
                    "battery": {
                        "percent": battery.percent,
                        "state": battery.state,
                        "charging": battery.charging,
                    },
                    "capabilities": band.info.capabilities,
                    "features": band.info.features,
                    "vibration": "not present in Vexo Open hardware",
                },
                indent=2,
            )
        )


def identify(transport: str, seconds: int) -> None:
    with _connect(transport) as band:
        band.identify(seconds)
        print(f"Identified {band.name}: white LED flashed for {seconds} seconds.")


def listen(transport: str, seconds: float, language: str) -> None:
    import speech

    with _connect(transport) as band:
        print(
            f"Preparing {band.name}. If its light turns solid blue, nearby audio is being "
            "sent to Deepgram; tell everyone nearby before that happens."
        )
        options = {'language': language}
        final = threading.Event()

        def on_text(value, is_final):
            print(("Final: " if is_final else "Hearing: ") + value)
            if is_final:
                final.set()

        ears = speech.create(**options).start(on_text)
        feed = ears.feed
        band.on("audio", feed)
        try:
            band.configure(audio=True)
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline and not final.is_set():
                band.wait(min(0.1, deadline - time.monotonic()))
            band.configure(audio=False)
        finally:
            band.off("audio", feed)
        text = ears.stop()
        print("Transcript:", text or "(no speech heard)")


def microphone_test(transport: str, seconds: float) -> None:
    """Verify that Opus frames arrive without storing or transmitting the audio."""
    packets = 0
    bytes_received = 0

    def received(event) -> None:
        nonlocal packets, bytes_received
        packets += 1
        bytes_received += len(event.opus)

    with _connect(transport) as band:
        band.on("audio", received)
        try:
            band.configure(audio=True)
            band.wait(seconds)
            band.configure(audio=False)
        finally:
            band.off("audio", received)
        expected = max(1, round(seconds * 50))
        print(
            json.dumps(
                {
                    "band": band.name,
                    "microphone": "working" if packets >= expected * 0.8 else "incomplete",
                    "packets": packets,
                    "expected_approximately": expected,
                    "opus_bytes": bytes_received,
                    "stored": False,
                    "sent_to_deepgram": False,
                },
                indent=2,
            )
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=f"Control only the team's {BAND_NAME}."
    )
    parser.add_argument("action", choices=("check", "identify", "mic-test", "listen"))
    parser.add_argument(
        "--transport", choices=("ble", "serial", "sim"), default="ble"
    )
    parser.add_argument("--seconds", type=float, default=7)
    parser.add_argument("--language", default="multi")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    if args.action == "check":
        check(args.transport)
    elif args.action == "identify":
        identify(args.transport, max(1, min(30, round(args.seconds))))
    elif args.action == "mic-test":
        microphone_test(args.transport, max(1, min(30, args.seconds)))
    else:
        listen(args.transport, max(1, min(300, args.seconds)), args.language)

