import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function validateStagingRelease(release, sha, run, repository) {
  if (typeof sha !== "string" || sha.length !== 40 || !/^[a-f0-9]{40}$/.test(sha)
    || typeof run !== "string" || run.trim() !== run || !/^[0-9]+\/[0-9]+$/.test(run)
    || typeof repository !== "string" || repository.trim() !== repository
    || !/^[a-z0-9]{5,50}\.azurecr\.io\/finops$/.test(repository)) {
    throw new Error("Invalid expected staging release identity.");
  }
  if (!release || release.schemaVersion !== 2 || release.publicConfiguration !== "runtime-v1"
    || release.sha !== sha || release.environment !== "staging" || release.run !== run) {
    throw new Error("Staging evidence does not match the selected commit/run or runtime configuration contract.");
  }
  const result = {};
  for (const target of ["runtime", "migrator"]) {
    const reference = release[target];
    if (typeof reference !== "string" || reference.length !== repository.length + 1 + 71
      || !reference.startsWith(`${repository}@`)
      || !/^sha256:[a-f0-9]{64}$/.test(reference.slice(repository.length + 1))) {
      throw new Error(`Invalid staging ${target} image reference.`);
    }
    result[`${target}_digest`] = reference.slice(repository.length + 1);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, sha, run, repository] = process.argv.slice(2);
  const release = validateStagingRelease(JSON.parse(readFileSync(file, "utf8")), sha, run, repository);
  for (const [key, value] of Object.entries(release)) console.log(`${key}=${value}`);
}
