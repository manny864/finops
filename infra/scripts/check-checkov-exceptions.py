#!/usr/bin/env python3
"""Fail on expired, undocumented or protected Checkov suppressions."""
import datetime
from pathlib import Path
import re
import subprocess
import sys

PROTECTED = {"CKV_AZURE_35", "CKV_AZURE_109", "CKV_AZURE_236", "CKV2_AZURE_40"}
SCOPES = ["infra/terraform", ".github/workflows", "Dockerfile", "infra/checkov"]


def validate(text, path, today):
    errors = []
    for number, line in enumerate(text.splitlines(), 1):
        if "checkov:skip" not in line:
            continue
        match = re.search(
            r"# checkov:skip=(CKV[A-Z0-9_]+):owner=([A-Za-z0-9_.-]+); "
            r"expires=(\d{4}-\d{2}-\d{2}); (.{20,})$", line)
        location = f"{path}:{number}"
        if not match:
            errors.append(f"{location}: require one check ID, owner, expiry and meaningful risk/control reason")
            continue
        check, _, expiration, _ = match.groups()
        if check in PROTECTED:
            errors.append(f"{location}: protected control {check} cannot be suppressed")
        if check == "CKV2_FINOPS_1" and path != "infra/terraform/modules/storage/main.tf":
            errors.append(f"{location}: only the existing app Storage has a default-Deny exception")
        try:
            expires = datetime.date.fromisoformat(expiration)
        except ValueError:
            errors.append(f"{location}: invalid expiry")
            continue
        if expires <= today:
            errors.append(f"{location}: exception expired on {expires}")
        if expires > today + datetime.timedelta(days=120):
            errors.append(f"{location}: exception review must be within 120 days")
    return errors


def main():
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", *SCOPES],
        check=True, capture_output=True, text=True)
    errors = []
    today = datetime.datetime.now(datetime.timezone.utc).date()
    for name in sorted(set(result.stdout.split("\0")) - {""}):
        path = Path(name)
        if path.is_file() and (path.suffix in (".tf", ".yml", ".yaml") or path.name == "Dockerfile"):
            errors.extend(validate(path.read_text(), name, today))
    if errors:
        for error in errors:
            print(f"::error::{error}", file=sys.stderr)
        return 1
    print("Checkov local exceptions: documented, scoped and within review dates.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
