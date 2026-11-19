"""Load local environment files into the process environment. Standard library only."""
import os
from pathlib import Path

BACKEND_ENV_FILE = Path(__file__).resolve().parents[1] / '.env'
ROOT_ENV_FILE = Path(__file__).resolve().parents[2] / '.env'


def _load_file(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def load_env(path: Path | None = None) -> None:
    """Read .env files without overriding shell-provided variables.

    The repository-root .env is loaded first so one file can configure the
    web/API stack. backend/.env remains supported for existing installations.
    """
    if path is not None:
        _load_file(path)
        return
    _load_file(ROOT_ENV_FILE)
    _load_file(BACKEND_ENV_FILE)
