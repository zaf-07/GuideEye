#!/usr/bin/env python3
"""Read-only Vexo connection diagnostic for macOS."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.services.vexo_config import BAND_NAME


def _run(command: list[str]) -> str:
    try:
        return subprocess.run(
            command, capture_output=True, text=True, timeout=8, check=False
        ).stdout
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return ""


def _connected_vexo_bluetooth() -> list[dict[str, str | None]]:
    raw = _run(
        ["system_profiler", "SPBluetoothDataType", "-json", "-detailLevel", "full"]
    )
    try:
        reports = json.loads(raw).get("SPBluetoothDataType", [])
    except (json.JSONDecodeError, AttributeError):
        return []

    devices: list[dict[str, str | None]] = []
    for report in reports:
        for entry in report.get("device_connected", []):
            for name, details in entry.items():
                if name == BAND_NAME:
                    devices.append(
                        {
                            "name": name,
                            "address": details.get("device_address"),
                            "services": details.get("device_services"),
                        }
                    )
    return devices


def probe() -> dict:
    ports = sorted(
        str(path)
        for pattern in ("cu.usbmodem*", "tty.usbmodem*")
        for path in Path("/dev").glob(pattern)
    )
    usb_report = _run(["ioreg", "-p", "IOUSB", "-l", "-w", "0"])
    usb_connected = "Vexo Open band" in usb_report
    bluetooth = _connected_vexo_bluetooth()

    return {
        "detected": usb_connected or bool(bluetooth),
        "product": "Vexo Open band" if usb_connected else None,
        "usb": {
            "connected": usb_connected,
            "serial_ports": ports,
            "vid": "0x2FE3" if usb_connected else None,
            "pid": "0x0004" if usb_connected else None,
        },
        "bluetooth": {"connected": bool(bluetooth), "devices": bluetooth},
        "capabilities": {
            "presence": "verified" if usb_connected or bluetooth else "not_detected",
            "live_audio": "documented_vexo_open_contract",
            "band_haptics": "unavailable_no_hardware",
        },
        "safety": (
            "Read-only probe. No serial or BLE commands were sent. Use guideband_vexo.py "
            "for official audio/LED control; Vexo Open has no vibration hardware."
        ),
    }


def _print_human(result: dict) -> None:
    print(f"Vexo detected: {result['detected']}")
    print(f"USB connected: {result['usb']['connected']}")
    print("Serial ports: " + (", ".join(result["usb"]["serial_ports"]) or "none"))
    print(f"Bluetooth connected: {result['bluetooth']['connected']}")
    for device in result["bluetooth"]["devices"]:
        address = f" ({device['address']})" if device["address"] else ""
        print(f"Bluetooth device: {device['name']}{address}")
    print(result["safety"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Detect a connected Vexo Open Band without writing to it."
    )
    parser.add_argument("--json", action="store_true")
    arguments = parser.parse_args()
    result = probe()
    if arguments.json:
        print(json.dumps(result, indent=2))
    else:
        _print_human(result)
