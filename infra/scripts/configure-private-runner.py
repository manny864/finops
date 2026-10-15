#!/usr/bin/env python3
"""Register an Azure runner using a short-lived GitHub token in protected Run Command parameters."""
import argparse
import json
import subprocess
import tempfile
import time
from pathlib import Path


def cli(*args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=180, check=False)
    if result.returncode:
        # Do not forward CLI output: a failed request may include protected parameters.
        raise RuntimeError(f"{args[0]} {args[1]} failed (exit {result.returncode}); inspect Azure/GitHub status")
    return json.loads(result.stdout) if result.stdout.strip() else None


def run_command(vm_id, location, script, protected=None):
    url = f"https://management.azure.com{vm_id}/runCommands/finops-setup?api-version=2024-07-01"
    payload = {
        "location": location,
        "properties": {
            "source": {"script": script},
            "protectedParameters": [{"name": k, "value": v} for k, v in (protected or {}).items()],
            "timeoutInSeconds": 1800,
            "asyncExecution": True,
            "treatFailureAsDeploymentFailure": True,
        },
    }
    with tempfile.TemporaryDirectory(prefix="finops-runner-") as directory:
        body = Path(directory) / "request.json"
        body.touch(mode=0o600)
        body.write_text(json.dumps(payload))
        cli("az", "rest", "--method", "put", "--url", url, "--body", f"@{body}", "-o", "json")
    for _ in range(190):
        result = cli("az", "rest", "--method", "get", "--url", url + "&$expand=instanceView", "-o", "json")
        view = result["properties"].get("instanceView", {})
        state = view.get("executionState")
        if state in ("Succeeded", "Failed", "TimedOut", "Canceled"):
            cli("az", "rest", "--method", "delete", "--url", url, "-o", "none")
            if state != "Succeeded" or view.get("exitCode", 1) != 0:
                raise RuntimeError(f"Run Command {state}, exit {view.get('exitCode')}; inspect VM setup logs")
            return view.get("output", "")
        time.sleep(10)
    raise TimeoutError("Run Command did not finish within the bounded wait; inspect finops-setup on the VM")


REGISTER = """#!/bin/bash
set -euo pipefail
cloud-init status --wait >/dev/null
test -f /var/lib/cloud/instance/finops-runner-ready
cd /opt/actions-runner
if [ ! -f .runner ]; then
  runuser -u actions -- ./config.sh --unattended --url https://github.com/manny864/finops \\
    --token "$RUNNER_TOKEN" --name "$(hostname)" --labels "$RUNNER_LABEL" --work _work
fi
unset RUNNER_TOKEN
if [ ! -f .service ]; then
  ./svc.sh install actions
fi
service=$(cat .service)
install -m 0755 /usr/local/lib/finops-runner-job-started /usr/local/lib/finops-runner-job-started.sh
cat > /usr/local/lib/finops-runner-job-completed.sh <<'COMPLETED_HOOK'
@@COMPLETED_HOOK@@
COMPLETED_HOOK
chmod 0755 /usr/local/lib/finops-runner-job-completed.sh
install -d -m 0755 "/etc/systemd/system/$service.d"
printf '[Service]\\nEnvironment=ACTIONS_RUNNER_HOOK_JOB_STARTED=/usr/local/lib/finops-runner-job-started.sh\\nEnvironment=ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/usr/local/lib/finops-runner-job-completed.sh\\n' > "/etc/systemd/system/$service.d/trusted-jobs.conf"
systemctl daemon-reload
systemctl enable "$service"
systemctl restart "$service"
systemctl is-active --quiet "$service"
runuser -u actions -- bash -c 'if sudo -n true 2>/dev/null; then echo "Runner unexpectedly has sudo" >&2; exit 1; fi'
terraform version
az version --query '\"azure-cli\"' -o tsv
echo 'Runner service active; unprivileged job user verified.'
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("environment", choices=("staging", "prod"))
    args = parser.parse_args()
    group = f"cscs-finops-{args.environment}-runner-rg"
    name = f"cscs-finops-{args.environment}-runner"
    runners = cli("gh", "api", "repos/manny864/finops/actions/runners")["runners"]
    if any(runner["name"] == name and runner["busy"] for runner in runners):
        raise RuntimeError("Runner is busy; refusing to restart its service")
    vm = cli("az", "vm", "show", "-g", group, "-n", name, "-o", "json")
    token = cli("gh", "api", "--method", "POST",
                "repos/manny864/finops/actions/runners/registration-token")["token"]
    hook = Path(__file__).with_name("private-runner-job-completed.sh").read_text()
    script = REGISTER.replace("@@COMPLETED_HOOK@@", hook)
    output = run_command(vm["id"], vm["location"], script,
                         {"RUNNER_TOKEN": token, "RUNNER_LABEL": f"finops-{args.environment}"})
    # config.sh normally masks its token; redact defensively before forwarding any output.
    print(output.replace(token, "***"))
    for _ in range(12):
        runners = cli("gh", "api", "repos/manny864/finops/actions/runners")["runners"]
        if any(runner["name"] == name and runner["status"] == "online" for runner in runners):
            print(f"{name}: GitHub confirms online.")
            return
        time.sleep(5)
    raise RuntimeError("VM service started, but GitHub has not confirmed the runner online")


if __name__ == "__main__":
    main()
