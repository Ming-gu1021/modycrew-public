import { existsSync } from "node:fs";
import path from "node:path";

export function isPackagedElectronRuntime(runtimeProcess = process) {
  return Boolean(runtimeProcess?.versions?.electron) && runtimeProcess?.defaultApp !== true;
}

export function resolveDesktopDomainEntryPath(options = {}) {
  const isPackaged =
    typeof options.isPackaged === "boolean"
      ? options.isPackaged
      : isPackagedElectronRuntime(options.runtimeProcess ?? process);
  const resourcesPath = String(
    options.resourcesPath ?? options.runtimeProcess?.resourcesPath ?? process.resourcesPath ?? "",
  ).trim();
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const fileExists = options.existsSync ?? existsSync;
  const packagedEntry = resourcesPath
    ? path.join(resourcesPath, "domain", "index.js")
    : "";
  const developmentEntry = path.join(
    repoRoot,
    "packages",
    "domain",
    "dist",
    "index.js",
  );

  if (isPackaged) {
    return packagedEntry || path.join(repoRoot, "resources", "domain", "index.js");
  }
  if (fileExists(developmentEntry)) return developmentEntry;
  if (packagedEntry && fileExists(packagedEntry)) return packagedEntry;
  return developmentEntry;
}
