// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validateStagingRelease } from "../../scripts/deployment-release.mjs";
const sha = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;
const repository = "stagingregistry.azurecr.io/finops";
const release = {
  schemaVersion: 2, publicConfiguration: "runtime-v1", environment: "staging", sha, run: "123/2",
  runtime: `${repository}@${digest}`, migrator: `${repository}@${digest}`, signed: false,
};
describe("promotion consumes the exact successful staging evidence", () => {
  it("returns only two well-formed digests, never untrusted shell data", () => {
    expect(validateStagingRelease(release, sha, "123/2", repository)).toEqual({
      runtime_digest: digest, migrator_digest: digest,
    });
  });
  it.each([
    { ...release, schemaVersion: 1 }, { ...release, publicConfiguration: undefined },
    { ...release, sha: "c".repeat(40) }, { ...release, run: "123/1" },
    { ...release, environment: "prod" }, { ...release, runtime: `${repository}:mutable-tag` },
    { ...release, migrator: `otherregistry.azurecr.io/finops@${digest}` },
    { ...release, runtime: `${repository}@${digest}\ninjected=bad` },
    { ...release, runtime: `${repository}@${digest}\n` },
    { ...release, migrator: `${repository}@${digest}\r\n` },
  ])("rejects stale, mismatched, or environment-built evidence: %j", value => {
    expect(() => validateStagingRelease(value, sha, "123/2", repository)).toThrow();
  });
  it.each([["main", "123/2", repository], [sha, "123/2\n", repository], [sha, "123/2", "https://evil.test"]])(
    "rejects an invalid expected identity", (expectedSha, run, source) => {
      expect(() => validateStagingRelease(release, expectedSha, run, source)).toThrow();
    });
});
