#!/bin/bash
set -euo pipefail
if [ "${GITHUB_WORKSPACE:-}" != "/opt/actions-runner/_work/finops/finops" ]; then
  echo "::error::Unexpected runner workspace; refusing cleanup" >&2
  exit 1
fi
for environment in prod staging; do
  for filename in terraform.tfvars tfplan plan.json terraform.tfstate terraform.tfstate.backup; do
    rm -f -- "$GITHUB_WORKSPACE/infra/terraform/environments/$environment/$filename"
  done
done
