import { readFileSync } from "node:fs";

const plan = JSON.parse(readFileSync(process.argv[2], "utf8"));
const replacement = process.env.REPLACE_ADDR || "";
const destructive = (plan.resource_changes || []).filter((resource) =>
  resource.change.actions.includes("delete") && resource.address !== replacement,
);
const failedChecks = (plan.checks || []).filter((check) => check.status !== "pass");

if (destructive.length || failedChecks.length || plan.errored === true) {
  for (const resource of destructive) {
    console.error(`Unapproved destructive change: ${resource.address}`);
  }
  for (const check of failedChecks) {
    console.error(`Unresolved Terraform check: ${check.address?.to_display || "unknown"} (${check.status})`);
  }
  if (plan.errored === true) console.error("Terraform plan reports an error.");
  process.exitCode = 1;
} else {
  console.log("Terraform apply safety checks passed.");
}