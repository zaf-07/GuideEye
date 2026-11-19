"""Loads backend/.env into the process environment. Standard library only."""
import os
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parents[1] / '.env'


def load_env(path: Path = ENV_FILE) -> None:
    """Read KEY=VALUE lines. Real environment variables always win."""
    if not path.is_file():
        return
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
