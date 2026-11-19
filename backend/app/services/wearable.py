from __future__ import annotations

import asyncio
import json
from dataclasses import asdict, dataclass
from glob import glob
from pathlib import Path
import subprocess
import sys
import time

from .vexo_config import BAND_NAME, BAND_NUMBER, SERVICE_UUID

VEXO_USB_ID = 'VID_2FE3&PID_0004'  # the Vexo Open band
ROOT = Path(__file__).resolve().parents[3]
PYTHON_BIN = sys.executable or str(ROOT / '.venv' / 'bin' / 'python')


class WearableError(RuntimeError):
    """A hardware bridge operation failed before a transcript was produced."""


_live_state: dict = {
    'connected': False,
    'transport': 'ble',
    'battery': None,
    'firmware': None,
    'protocol': None,
    'last_seen': time.time(),
}


@dataclass(frozen=True)
class Capability:
    name: str
    status: str
    evidence: str


def _windows_ports() -> list[str]:
    """COM ports that belong to the band and are plugged in right now. Reads the registry only."""
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'HARDWARE\DEVICEMAP\SERIALCOMM') as key:
            present = {winreg.EnumValue(key, i)[1] for i in range(winreg.QueryInfoKey(key)[1])}
    except OSError:
        return []
    found = set()
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'SYSTEM\CurrentControlSet\Enum\USB') as usb:
            for i in range(winreg.QueryInfoKey(usb)[0]):
                device = winreg.EnumKey(usb, i)
                if not device.upper().startswith(VEXO_USB_ID):
                    continue
                with winreg.OpenKey(usb, device) as instances:
                    for j in range(winreg.QueryInfoKey(instances)[0]):
                        try:
                            with winreg.OpenKey(instances, winreg.EnumKey(instances, j) + r'\Device Parameters') as params:
                                port = winreg.QueryValueEx(params, 'PortName')[0]
                        except OSError:
                            continue
                        if port in present:
                            found.add(port)
    except OSError:
        pass
    return sorted(found)


def serial_ports() -> list[str]:
    if sys.platform == 'win32':
        return _windows_ports()
    return sorted(glob('/dev/cu.usbmodem*') + glob('/dev/tty.usbmodem*') + glob('/dev/ttyACM*'))


_bluetooth_cache: dict = {'at': 0.0, 'devices': []}
BLUETOOTH_CACHE_SECONDS = 10.0


def bluetooth_devices() -> list[dict[str, str | None]]:
    """Return connected Vexo BLE devices without opening a BLE session.

    The system query takes a second or more and the pages poll every few seconds, so the answer is reused briefly.
    """
    if time.monotonic() - _bluetooth_cache['at'] < BLUETOOTH_CACHE_SECONDS and _bluetooth_cache['at']:
        return list(_bluetooth_cache['devices'])
    devices = _query_bluetooth_devices()
    _bluetooth_cache.update(at=time.monotonic(), devices=devices)
    return list(devices)


def _query_bluetooth_devices() -> list[dict[str, str | None]]:
    try:
        completed = subprocess.run(
            ['system_profiler', 'SPBluetoothDataType', '-json', '-detailLevel', 'full'],
            capture_output=True, text=True, timeout=8, check=False,
        )
        reports = json.loads(completed.stdout).get('SPBluetoothDataType', [])
    except (FileNotFoundError, subprocess.TimeoutExpired, json.JSONDecodeError, AttributeError):
        return []

    devices = []
    for report in reports:
        for entry in report.get('device_connected', []):
            for name, details in entry.items():
                if name == BAND_NAME:
                    devices.append({'name': name, 'address': details.get('device_address')})
    return devices


def status() -> dict:
    ports = serial_ports()
    bluetooth = bluetooth_devices()
    live_conn = bool(ports or bluetooth or _live_state.get('connected'))
    capabilities = [
        Capability('usb_presence', 'detected' if ports else 'unavailable', ports[0] if ports else 'No serial device detected'),
        Capability('bluetooth_presence', 'detected' if (bluetooth or _live_state.get('connected')) else 'unavailable', f"{BAND_NAME} via BLE" if _live_state.get('connected') else (bluetooth[0]['name'] if bluetooth else 'No connected Vexo BLE device detected')),
        Capability('identity', 'locked', f'Only {BAND_NAME}; service {SERVICE_UUID}'),
        Capability('live_audio', 'documented', 'Opus 16 kHz mono, 20 ms frames over the Vexo Open contract'),
        Capability('deepgram', 'ready', 'Official helper reads DEEPGRAM_API_KEY; mip_opt_out=true'),
        Capability('band_haptics', 'unavailable', 'Vexo Open contract explicitly says this hardware has no vibration'),
        Capability('phone_haptics', 'implemented', 'Android vibrates after every accepted GuideBand command'),
    ]
    return {
        'connected': live_conn,
        'band_number': BAND_NUMBER,
        'band_name': BAND_NAME,
        'service_uuid': SERVICE_UUID,
        'ports': ports,
        'bluetooth_devices': bluetooth,
        'transport': _live_state.get('transport', 'ble' if not ports else 'serial'),
        'battery': _live_state.get('battery'),
        'firmware': _live_state.get('firmware'),
        'capabilities': [asdict(item) for item in capabilities],
    }


async def refresh_band_state(timeout: float = 25.0) -> dict:  # a Windows BLE scan takes about 10 s
    """Query Vexo-HACK-20 over BLE asynchronously to update live state."""
    global _live_state
    script = ROOT / 'scripts' / 'guideband_vexo.py'
    if not script.is_file():
        return _live_state
    try:
        proc = await asyncio.create_subprocess_exec(
            PYTHON_BIN, str(script), 'check', '--transport', 'ble',
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        if proc.returncode == 0 and stdout:
            data = json.loads(stdout.decode())
            _live_state.update({
                'connected': bool(data.get('connected')),
                'transport': data.get('transport', 'ble'),
                'battery': data.get('battery', _live_state['battery']),
                'firmware': data.get('firmware', _live_state['firmware']),
                'protocol': data.get('protocol', _live_state['protocol']),
                'last_seen': time.time(),
            })
    except Exception:
        pass
    return _live_state


async def listen_band(seconds: float = 7.0, language: str = 'multi') -> str:
    """Capture speech through Vexo band via BLE and Deepgram Nova-3."""
    script = ROOT / 'scripts' / 'guideband_vexo.py'
    if not script.is_file():
        raise WearableError(f'Hardware bridge script is missing: {script}')
    proc = None
    try:
        proc = await asyncio.create_subprocess_exec(
            PYTHON_BIN, str(script), 'listen', '--transport', 'ble',
            '--seconds', str(seconds), '--language', language,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=seconds + 14.0)
    except asyncio.TimeoutError as error:
        if proc is not None and proc.returncode is None:
            proc.kill()
            await proc.communicate()
        raise WearableError('The band did not finish listening in time. Double-tap it and try again.') from error
    except OSError as error:
        raise WearableError(f'Could not start the hardware bridge: {error.strerror or error}') from error

    out_text = stdout.decode(errors='replace') if stdout else ''
    stderr_text = stderr.decode(errors='replace') if stderr else ''
    if proc.returncode != 0:
        detail = stderr_text.strip() or out_text.strip()
        if 'ModuleNotFoundError' in detail or 'Missing vexo-open-kit' in detail:
            raise WearableError('The Vexo kit is not installed. Run scripts/setup_vexo_open_kit.sh first.')
        raise WearableError(detail.splitlines()[-1] if detail else 'The band connection failed. Double-tap it and try again.')

    transcript = ''
    for line in out_text.splitlines():
        line = line.strip()
        if line.startswith('Transcript:'):
            transcript = line.split('Transcript:', 1)[1].strip()
    return '' if transcript == '(no speech heard)' else transcript

