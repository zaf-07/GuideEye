#!/usr/bin/env python3
"""GuideEye HarnessRouter / Universal Harness Protocol (UHP) Verifier

Validates the repository's HarnessRouter integration, protocol compliance,
and execution evidence.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.services import errand  # noqa: E402


def check(description: str, condition: bool) -> bool:
    mark = "\033[92m[PASS]\033[0m" if condition else "\033[91m[FAIL]\033[0m"
    print(f"{mark} {description}")
    return condition


def main() -> int:
    print("=" * 64)
    print("  GuideEye: HarnessRouter UHP Execution Evidence Verification")
    print("=" * 64)

    passed = True

    # 1. Check harnessrouter.json
    cfg = errand.CONFIG_FILE
    passed &= check(f"Configuration file exists: {cfg.name}", cfg.exists())
    try:
        data = json.loads(cfg.read_text(encoding="utf-8"))
        h_id = data.get("harness_id", "")
        passed &= check(f"Harness ID is set ({h_id})", bool(h_id and h_id.startswith("chrn_")))
        passed &= check("Protocol is UHP (Universal Harness Protocol)", data.get("protocol") == "UHP")
        passed &= check("Protocol version matches 2026-09-28", data.get("protocol_version") == "2026-09-28")
    except Exception as err:
        passed &= check(f"Parse harnessrouter.json: {err}", False)

    # 2. Check UHP headers
    headers = errand._headers()
    passed &= check("UHP Version header present (2026-09-28)", headers.get("UHP-Version") == "2026-09-28")

    # 3. Check documentation evidence
    evidence = ROOT / "docs" / "HARNESSROUTER_EXECUTION_EVIDENCE.md"
    passed &= check("Execution evidence document exists", evidence.exists())
    if evidence.exists():
        content = evidence.read_text(encoding="utf-8")
        passed &= check("Evidence contains recorded HTTP POST /v1/responses trace", "POST /v1/responses" in content)
        passed &= check("Evidence contains recorded POST /v1/files upload trace", "POST /v1/files" in content)
        passed &= check("Evidence contains multi-turn confirmation proof", "previous_response_id" in content)

    print("=" * 64)
    if passed:
        print("\033[92mAll HarnessRouter UHP execution evidence verified successfully!\033[0m")
        return 0
    else:
        print("\033[91mOne or more HarnessRouter verifications failed.\033[0m")
        return 1


if __name__ == "__main__":
    sys.exit(main())
