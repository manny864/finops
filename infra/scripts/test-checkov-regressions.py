#!/usr/bin/env python3
"""Exercise real Checkov against an isolated copy, never live tfvars or state."""
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SCOPES = ["infra/terraform", ".github/workflows", "Dockerfile", "infra/checkov"]


def scan(root, expected=None):
    result = subprocess.run(
        ["checkov", "--directory", ".", "--framework", "terraform", "dockerfile", "github_actions",
         "--config-file", "infra/checkov/config.yml", "--output", "json"],
        cwd=root, capture_output=True, text=True, check=False, timeout=180)
    if result.returncode not in (0, 1):
        raise AssertionError(f"Checkov execution failed ({result.returncode}): {result.stderr}")
    reports = json.loads(result.stdout)
    if not isinstance(reports, list):
        reports = [reports]
    assert {report["check_type"] for report in reports} == {"terraform", "dockerfile", "github_actions"}
    assert all(report["summary"]["parsing_errors"] == 0 for report in reports), "Parsing errors"
    assert all(report["summary"]["passed"] > 0 for report in reports), "Empty framework scan"
    failed = {check["check_id"] for report in reports for check in report["results"]["failed_checks"]}
    evaluated = {check["check_id"] for report in reports
                 for check in report["results"]["passed_checks"] + report["results"]["failed_checks"]}
    assert "CKV2_FINOPS_1" in evaluated, "Local default-Deny policy was not loaded"
    if expected is None:
        assert result.returncode == 0 and not failed, f"Baseline failed: {sorted(failed)}"
    else:
        assert result.returncode == 1 and expected in failed, f"Mutation escaped {expected}: {sorted(failed)}"
    return reports


def main():
    version = (ROOT / "infra/checkov/requirements.txt").read_text().strip().split("==")[1]
    actual = subprocess.check_output(["checkov", "--version"], text=True).strip()
    assert actual == version, f"Expected Checkov {version}, got {actual}"
    files = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", *SCOPES],
        cwd=ROOT).decode().split("\0")
    with tempfile.TemporaryDirectory(prefix="finops-checkov-") as directory:
        root = Path(directory)
        for name in set(files) - {""}:
            source = ROOT / name
            # Ignored state, plans, secret tfvars and provider caches are never copied.
            if source.is_file():
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
        reports = scan(root)
        for report in reports:
            print(f"{report['check_type']}: {report['summary']}", flush=True)
        mutations = [
            ("backend Allow", "infra/terraform/bootstrap/main.tf",
             'default_action             = "Deny"', 'default_action             = "Allow"', "CKV2_FINOPS_1"),
            ("backend missing firewall", "infra/terraform/bootstrap/main.tf",
             '  network_rules {\n    default_action             = "Deny"\n    bypass                     = ["None"]\n    virtual_network_subnet_ids = var.runner_subnet_ids\n  }\n',
             "", "CKV2_FINOPS_1"),
            ("backend Shared Key", "infra/terraform/bootstrap/main.tf",
             "shared_access_key_enabled       = false", "shared_access_key_enabled       = true",
             "CKV2_AZURE_40"),
            ("app Shared Key", "infra/terraform/modules/storage/main.tf",
             "shared_access_key_enabled = var.shared_access_key_enabled",
             "shared_access_key_enabled = true", "CKV2_AZURE_40"),
            ("AI local auth", "infra/terraform/modules/ai_services/main.tf",
             "local_auth_enabled            = var.local_auth_enabled",
             "local_auth_enabled            = true", "CKV_AZURE_236"),
            ("Key Vault firewall", "infra/terraform/modules/keyvault/main.tf",
             '\n      default_action = "Deny"\n', '\n      default_action = "Allow"\n', "CKV_AZURE_109"),
            ("workflow write-all", ".github/workflows/_deploy.yml",
             "permissions:\n  contents: read", "permissions: write-all", "CKV2_GHA_1"),
            ("Docker root", "Dockerfile", "\nUSER nextjs\n", "\nUSER root\n", "CKV_DOCKER_8"),
        ]
        for label, name, before, after, check in mutations:
            target = root / name
            original = target.read_text()
            assert original.count(before) == 1, f"Mutation target changed: {label}"
            try:
                target.write_text(original.replace(before, after, 1))
                scan(root, check)
                print(f"Blocked: {label} ({check})", flush=True)
            finally:
                target.write_text(original)
        # Local exceptions cannot suppress the same checks on a new resource.
        backend = (root / "infra/terraform/bootstrap/main.tf").read_text()
        account = re.search(r'resource "azurerm_storage_account" "tfstate" \{.*?\n\}', backend, re.S)[0]
        account = re.sub(r"^\s*# checkov:skip=.*\n", "\n", account, flags=re.M)
        account = account.replace('"tfstate" {', '"unreviewed" {', 1)
        account = account.replace('default_action             = "Deny"', 'default_action             = "Allow"')
        target = root / "infra/terraform/bootstrap/unreviewed.tf"
        target.write_text(account)
        scan(root, "CKV_AZURE_59")
        print("Blocked: new public Storage has no inherited exception (CKV_AZURE_59)", flush=True)


if __name__ == "__main__":
    main()
