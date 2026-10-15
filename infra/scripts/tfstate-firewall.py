#!/usr/bin/env python3
"""Temporary Storage firewall access. All callers must hold the same GitHub concurrency group."""
import ipaddress
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

TAG = "TFStateFirewallLease"


def az(*args):
    result = subprocess.run(["az", *args, "--only-show-errors", "-o", "none" if args[0] == "rest" else "json"],
                            capture_output=True, text=True, check=False, timeout=120)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    if args[0] == "rest":
        return None
    return json.loads(result.stdout) if result.stdout.strip() else None


def ipv4(value):
    if not isinstance(value, str):
        raise ValueError("Invalid runner IPv4")
    address = ipaddress.ip_address(value)
    if address.version != 4 or not address.is_global:
        raise ValueError("Only a public IPv4 /32 may be opened")
    return str(address)


def load_lease(account):
    raw = (account.get("tags") or {}).get(TAG)
    if raw is None:
        return None
    lease = json.loads(raw)
    if (not isinstance(lease, dict)
            or not isinstance(lease.get("owner"), str)
            or not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", lease["owner"])
            or type(lease.get("expires")) is not int
            or not isinstance(lease.get("ips"), list) or not 1 <= len(lease["ips"]) <= 8):
        raise ValueError("Invalid ARM firewall lease; manual review required")
    for ip in lease["ips"]:
        ipv4(ip)
    return lease


def cleanup(account, lease):
    if lease is None:
        return
    # Keep metadata until ALL removals succeed: a failed cleanup is retried by the reconciler.
    for ip in lease["ips"]:
        az("storage", "account", "network-rule", "remove", "--account-name", account["name"],
           "--resource-group", account["resourceGroup"], "--ip-address", ip)
    az("tag", "update", "--resource-id", account["id"], "--operation", "Delete",
       "--tags", TAG)


def main(command):
    name, group = os.environ["TFSTATE_STORAGE"], os.environ["TFSTATE_RG"]
    if not re.fullmatch(r"[a-z0-9]{3,24}", name):
        raise ValueError("Invalid backend storage account")
    account = az("storage", "account", "show", "--name", name, "--resource-group", group)
    lease = load_lease(account)
    owner = os.environ.get("TFSTATE_LEASE_ID", "")
    if command == "reconcile":
        if lease and lease["expires"] <= int(time.time()):
            cleanup(account, lease)
            print("Expired backend firewall lease removed via ARM.")
        return
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", owner):
        raise ValueError("Invalid lease owner")
    if command == "close":
        if lease and lease["owner"] == owner:
            cleanup(account, lease)
            print("Backend firewall access closed.")
        return
    if command != "open":
        raise ValueError("Usage: tfstate-firewall.py open|close|reconcile")
    if lease and lease["expires"] <= int(time.time()):
        cleanup(account, lease)
        account = az("storage", "account", "show", "--name", name, "--resource-group", group)
        lease = None
    if lease and lease["owner"] != owner:
        raise RuntimeError("Another backend lease is active; refusing concurrent mutation")
    ttl = int(os.environ.get("TFSTATE_TTL_MINUTES", "70"))
    if not 1 <= ttl <= 70:
        raise ValueError("Lease TTL must be between 1 and 70 minutes")
    container = os.environ["TFSTATE_CONTAINER"]
    if container not in ("tfstate-prod", "tfstate-stg"):
        raise ValueError("Invalid backend container")
    lease = lease or {"owner": owner, "expires": int(time.time()) + ttl * 60, "ips": []}
    consecutive = 0
    for attempt in range(36):
        with urllib.request.urlopen("https://api.ipify.org", timeout=15) as response:
            ip = ipv4(response.read(64).decode().strip())
        if ip not in lease["ips"]:
            if len(lease["ips"]) >= 8:
                raise RuntimeError("Runner exceeded eight outbound IPs; refusing broader access")
            # Do not adopt an existing rule: it may be an operator's permanent rule.
            rules = account["networkRuleSet"]["ipRules"]
            if any(rule["ipAddressOrRange"] in (ip, ip + "/32") for rule in rules):
                raise RuntimeError("Runner IP already has an unmanaged rule; refusing to take ownership")
            lease["ips"].append(ip)
            encoded = json.dumps(lease, separators=(",", ":"))
            if len(encoded) > 256:
                raise ValueError("ARM lease exceeds the Storage tag limit")
            az("tag", "update", "--resource-id", account["id"], "--operation", "Merge",
               "--tags", TAG + "=" + encoded)
        rules = account["networkRuleSet"]["ipRules"]
        if not any(rule["ipAddressOrRange"] in (ip, ip + "/32") for rule in rules):
            az("storage", "account", "network-rule", "add", "--account-name", name,
               "--resource-group", group, "--ip-address", ip)
            rules.append({"ipAddressOrRange": ip})
            # ARM completion precedes propagation to Storage data-plane frontends.
            time.sleep(60)
            consecutive = 0
        try:
            az("rest", "--method", "get",
               "--url", f"https://{name}.blob.core.windows.net/{container}?restype=container&comp=list&maxresults=1",
               "--resource", "https://storage.azure.com/", "--headers", "x-ms-version=2023-11-03")
            consecutive += 1
            if consecutive == 3:
                print("Backend data plane stable across three probes; ARM lease registered.")
                return
        except RuntimeError as error:
            if "<Code>AuthorizationFailure</Code>" not in str(error):
                raise
            consecutive = 0
        time.sleep(5)
    raise RuntimeError("Backend firewall access did not stabilize; no wider rule was added")


if __name__ == "__main__":
    try:
        main(sys.argv[1])
    except (RuntimeError, ValueError, KeyError, IndexError, OSError, subprocess.TimeoutExpired) as error:
        print(f"::error::{error}", file=sys.stderr)
        sys.exit(1)
