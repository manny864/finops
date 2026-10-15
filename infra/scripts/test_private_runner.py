import importlib.util
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("private_runner", Path(__file__).with_name("configure-private-runner.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class PrivateRunnerTest(unittest.TestCase):
    def execute(self, state="Succeeded", exit_code=0):
        self.calls = []
        self.body_path = None

        def cli(*args):
            self.calls.append(args)
            if "put" in args:
                self.body_path = Path(args[args.index("--body") + 1][1:])
                self.assertEqual(self.body_path.stat().st_mode & 0o777, 0o600)
                self.assertEqual(json.loads(self.body_path.read_text())["properties"]["protectedParameters"],
                                 [{"name": "RUNNER_TOKEN", "value": "test-secret"}])
                self.assertNotIn("test-secret", repr(args))
            if "get" in args:
                return {"properties": {"instanceView": {
                    "executionState": state, "exitCode": exit_code, "output": "safe-output"}}}

        with patch.object(runner, "cli", side_effect=cli), patch.object(runner.time, "sleep"):
            return runner.run_command("/vm", "westus2", "echo ready", {"RUNNER_TOKEN": "test-secret"})

    def test_token_uses_protected_parameters_and_private_temporary_file(self):
        self.assertEqual(self.execute(), "safe-output")
        self.assertFalse(self.body_path.exists())
        self.assertIn("delete", self.calls[-1])

    def test_failed_script_is_not_success_and_command_is_removed(self):
        with self.assertRaisesRegex(RuntimeError, "Failed"):
            self.execute("Failed", 1)
        self.assertIn("delete", self.calls[-1])
        self.assertFalse(self.body_path.exists())

    def test_nonzero_exit_is_failure_even_when_execution_says_succeeded(self):
        with self.assertRaisesRegex(RuntimeError, "exit 2"):
            self.execute("Succeeded", 2)

    def test_cli_errors_do_not_expose_credentials(self):
        with patch.object(runner.subprocess, "run") as mock:
            mock.return_value.returncode = 1
            mock.return_value.stderr = "sensitive-token"
            with self.assertRaises(RuntimeError) as error:
                runner.cli("az", "rest")
            self.assertNotIn("sensitive-token", str(error.exception))

    def test_cleanup_refuses_unknown_workspace(self):
        import subprocess
        script = Path(__file__).with_name("private-runner-job-completed.sh")
        result = subprocess.run(["bash", str(script)], env={**os.environ, "GITHUB_WORKSPACE": "/tmp/not-finops"},
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("refusing cleanup", result.stderr)

    def test_runner_hook_paths_have_supported_script_extensions(self):
        import re
        paths = re.findall(r"Environment=ACTIONS_RUNNER_HOOK_JOB_(?:STARTED|COMPLETED)=([^\\]+)",
                           runner.REGISTER)
        self.assertEqual(len(paths), 2)
        self.assertTrue(all(path.endswith(".sh") for path in paths))


if __name__ == "__main__":
    unittest.main()
