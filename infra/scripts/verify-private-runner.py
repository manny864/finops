#!/usr/bin/env python3
"""Probe runner service endpoints with short-lived operator tokens, never persisted in Terraform."""
import argparse
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("configure_runner", Path(__file__).with_name("configure-private-runner.py"))
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)

PROBE = """#!/bin/bash
set -euo pipefail
service=$(cat /opt/actions-runner/.service)
systemctl is-active --quiet "$service"
systemctl is-enabled --quiet "$service"
test "$(stat -c '%U:%a' /usr/local/lib/finops-runner-job-started.sh)" = 'root:755'
test "$(stat -c '%U:%a' /usr/local/lib/finops-runner-job-completed.sh)" = 'root:755'
runuser -u actions -- env GITHUB_WORKSPACE=/opt/actions-runner/_work/finops/finops /usr/local/lib/finops-runner-job-completed.sh
export GITHUB_REPOSITORY=manny864/finops GITHUB_REF=refs/heads/main GITHUB_EVENT_NAME=workflow_dispatch
export GITHUB_WORKFLOW_REF=manny864/finops/.github/workflows/terraform.yml@refs/heads/main
/usr/local/lib/finops-runner-job-started.sh
if GITHUB_REF=refs/pull/1/merge /usr/local/lib/finops-runner-job-started.sh; then
  echo 'PR hook unexpectedly accepted' >&2; exit 1
fi
if GITHUB_EVENT_NAME=pull_request /usr/local/lib/finops-runner-job-started.sh; then
  echo 'PR event unexpectedly accepted' >&2; exit 1
fi
if GITHUB_WORKFLOW_REF=manny864/finops/.github/workflows/ci.yml@refs/heads/main /usr/local/lib/finops-runner-job-started.sh; then
  echo 'Unapproved workflow unexpectedly accepted' >&2; exit 1
fi
python3 - <<'PY'
import os, time, urllib.request, urllib.error
environment = os.environ['RUNNER_ENVIRONMENT']
container = 'tfstate-stg' if environment == 'staging' else 'tfstate-prod'
vault = 'cscs-finops-stg-wus2-kv' if environment == 'staging' else 'cscs-finops-prod-wus2-kv'
other = 'cscs-finops-prod-wus2-kv' if environment == 'staging' else 'cscs-finops-stg-wus2-kv'
storage_url = f'https://cscsfinopsmgmtqak5xmsa.blob.core.windows.net/{container}?restype=container&comp=list&maxresults=1'
def request(url, token, headers=None):
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token, **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.status
for attempt in range(20):
    try:
        request(storage_url, os.environ['STORAGE_TOKEN'], {'x-ms-version': '2023-11-03'})
        request(f'https://{vault}.vault.azure.net/secrets?api-version=7.4&maxresults=1', os.environ['VAULT_TOKEN'])
        break
    except urllib.error.HTTPError as error:
        body = error.read().decode()
        if error.code != 403 or not ('AuthorizationFailure' in body or 'ForbiddenByFirewall' in body) or attempt == 19:
            raise RuntimeError(f'Authorized probe failed: HTTP {error.code}') from None
        time.sleep(15)
for _ in range(5):
    assert request(storage_url, os.environ['STORAGE_TOKEN'], {'x-ms-version': '2023-11-03'}) == 200
    assert request(f'https://{vault}.vault.azure.net/secrets?api-version=7.4&maxresults=1', os.environ['VAULT_TOKEN']) == 200
    time.sleep(2)
try:
    request(f'https://{other}.vault.azure.net/secrets?api-version=7.4&maxresults=1', os.environ['VAULT_TOKEN'])
except urllib.error.HTTPError as error:
    if error.code != 403 or 'ForbiddenByFirewall' not in error.read().decode():
        raise RuntimeError('Cross-vault denial was not proven to be a network denial') from None
else:
    raise RuntimeError('Other environment vault unexpectedly reachable')
print(f'{environment}: five authenticated Storage/Key Vault probes passed; other vault denied by firewall.')
PY
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("environment", choices=("staging", "prod"))
    args = parser.parse_args()
    vm = setup.cli("az", "vm", "show", "-g", f"cscs-finops-{args.environment}-runner-rg",
                   "-n", f"cscs-finops-{args.environment}-runner", "-o", "json")
    protected = {"RUNNER_ENVIRONMENT": args.environment}
    for name, resource in (("STORAGE_TOKEN", "https://storage.azure.com/"),
                           ("VAULT_TOKEN", "https://vault.azure.net")):
        protected[name] = setup.cli("az", "account", "get-access-token", "--resource", resource,
                                   "-o", "json")["accessToken"]
    print(setup.run_command(vm["id"], vm["location"], PROBE, protected))


if __name__ == "__main__":
    main()
