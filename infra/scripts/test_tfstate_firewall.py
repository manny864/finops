import copy
import io
import importlib.util
import json
import os
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("tfstate_firewall", Path(__file__).with_name("tfstate-firewall.py"))
fw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fw)


class FirewallCheck(unittest.TestCase):
    def setUp(self):
        self.account = {"name": "teststate", "resourceGroup": "management", "id": "/account",
                        "tags": {"Owner": "CloudOps"}, "networkRuleSet": {"ipRules": []}}
        self.calls = []
        self.error = None
        self.env = patch.dict(os.environ, {
            "TFSTATE_STORAGE": "teststate", "TFSTATE_RG": "management",
            "TFSTATE_CONTAINER": "tfstate-prod", "TFSTATE_LEASE_ID": "run-1",
            "TFSTATE_TTL_MINUTES": "70",
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        self.mock = patch.object(fw, "az", side_effect=self.az)
        self.mock.start()
        self.addCleanup(self.mock.stop)
        self.clock = patch.object(fw.time, "time", return_value=1000)
        self.clock.start()
        self.addCleanup(self.clock.stop)
        self.sleep = patch.object(fw.time, "sleep")
        self.sleep.start()
        self.addCleanup(self.sleep.stop)
        self.http = patch.object(fw.urllib.request, "urlopen",
                                 side_effect=lambda *a, **k: io.BytesIO(b"8.8.8.8"))
        self.http.start()
        self.addCleanup(self.http.stop)

    def az(self, *args):
        self.calls.append(args)
        if args[:3] == ("storage", "account", "show"):
            return copy.deepcopy(self.account)
        if self.error and self.error in args:
            raise RuntimeError("injected failure")
        if args[:2] == ("tag", "update"):
            if args[args.index("--operation") + 1] == "Delete":
                self.account["tags"].pop(fw.TAG, None)
            else:
                self.account["tags"][fw.TAG] = args[-1].split("=", 1)[1]
        return None

    def lease(self, owner="run-1", expires=2000):
        self.account["tags"][fw.TAG] = json.dumps(
            {"owner": owner, "expires": expires, "ips": ["8.8.8.8"]})

    def test_lease_before_rule_and_cleanup_metadata_last(self):
        fw.main("open")
        tag = next(i for i, call in enumerate(self.calls) if call[:2] == ("tag", "update"))
        rule = next(i for i, call in enumerate(self.calls) if "add" in call)
        self.assertLess(tag, rule)
        self.assertEqual(fw.load_lease(self.account)["expires"], 5200)
        fw.main("close")
        self.assertNotIn(fw.TAG, self.account["tags"])
        self.assertEqual(self.account["tags"]["Owner"], "CloudOps")
        self.assertIn("remove", self.calls[-2])
        self.assertIn("Delete", self.calls[-1])

    def test_lost_runner_reconciles_without_blob(self):
        self.lease(expires=999)
        fw.main("reconcile")
        self.assertNotIn(fw.TAG, self.account["tags"])
        self.assertFalse(any(call[0] == "rest" for call in self.calls))

    def test_live_lease_is_not_reconciled_or_stolen(self):
        self.lease(owner="other")
        fw.main("reconcile")
        fw.main("close")
        with self.assertRaisesRegex(RuntimeError, "active"):
            fw.main("open")
        self.assertEqual(len(self.calls), 3)  # Only ARM reads.

    def test_failed_removal_preserves_lease_for_retry(self):
        self.lease(expires=999)
        self.error = "remove"
        with self.assertRaises(RuntimeError):
            fw.main("reconcile")
        self.assertIn(fw.TAG, self.account["tags"])

    def test_failed_add_has_a_durable_lease(self):
        self.error = "add"
        with self.assertRaises(RuntimeError):
            fw.main("open")
        self.assertEqual(fw.load_lease(self.account)["ips"], ["8.8.8.8"])

    def test_unmanaged_rule_is_not_adopted_or_removed(self):
        self.account["networkRuleSet"]["ipRules"] = [{"ipAddressOrRange": "8.8.8.8/32"}]
        with self.assertRaisesRegex(RuntimeError, "unmanaged"):
            fw.main("open")
        self.assertNotIn(fw.TAG, self.account["tags"])
        fw.main("close")
        self.assertFalse(any("remove" in call for call in self.calls))

    def test_rbac_and_network_errors_are_not_success(self):
        self.error = "rest"
        with self.assertRaises(RuntimeError):
            fw.main("open")
        self.assertEqual(sum(call[0] == "rest" for call in self.calls), 1)

    def test_network_propagation_retries_without_broadening(self):
        original = self.az
        probes = 0

        def az(*args):
            nonlocal probes
            if args[0] == "rest":
                probes += 1
                if probes < 3:
                    raise RuntimeError("<Code>AuthorizationFailure</Code>")
            return original(*args)

        with patch.object(fw, "az", side_effect=az):
            fw.main("open")
        self.assertEqual(probes, 3)
        self.assertEqual(sum("add" in call for call in self.calls), 1)
        self.assertFalse(any("Allow" in call for call in self.calls))

    def test_rest_xml_is_not_decoded_as_json(self):
        self.mock.stop()
        with patch.object(fw.subprocess, "run", return_value=subprocess.CompletedProcess(
                args=[], returncode=0, stdout="<EnumerationResults/>", stderr="")):
            self.assertIsNone(fw.az("rest", "--method", "get"))

    def test_network_denial_eventually_fails_closed(self):
        original = self.az
        probes = 0

        def az(*args):
            nonlocal probes
            if args[0] == "rest":
                probes += 1
                raise RuntimeError("<Code>AuthorizationFailure</Code>")
            return original(*args)

        with patch.object(fw, "az", side_effect=az), self.assertRaisesRegex(RuntimeError, "no wider"):
            fw.main("open")
        self.assertEqual(probes, 24)
        self.assertEqual(fw.load_lease(self.account)["ips"], ["8.8.8.8"])

    def test_more_than_eight_ips_is_rejected(self):
        self.lease()
        lease = fw.load_lease(self.account)
        lease["ips"] = [f"1.1.1.{i}" for i in range(1, 9)]
        self.account["tags"][fw.TAG] = json.dumps(lease)
        with self.assertRaisesRegex(RuntimeError, "eight"):
            fw.main("open")
        self.assertEqual(len(self.calls), 1)

    def test_invalid_addresses_metadata_and_ttl_fail_closed(self):
        for value in ["0.0.0.0", "10.0.0.1", "::1", "8.8.8.8/24", "8.8.8.8\nX=1"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                fw.ipv4(value)
        self.account["tags"][fw.TAG] = "bad-json"
        with self.assertRaises(ValueError):
            fw.main("reconcile")
        self.account["tags"].pop(fw.TAG)
        with patch.dict(os.environ, {"TFSTATE_TTL_MINUTES": "71"}), self.assertRaises(ValueError):
            fw.main("open")


if __name__ == "__main__":
    unittest.main()
