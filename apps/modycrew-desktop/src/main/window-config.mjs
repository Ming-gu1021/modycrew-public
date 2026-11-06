import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { isPackagedElectronRuntime } from "./runtime-paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 데스크톱 창이 어떤 URL/파일을 로드해야 하는지 결정합니다.
 *
 * 개발 런타임에서는 `MODYCREW_DEV_URL`, 명시된 정적 빌드, 모노레포 빌드 순서로
 * 찾습니다. 설치본은 환경변수나 cwd를 신뢰하지 않고 패키지 resources/web만 읽습니다.
 */
export function resolveWindowTarget(options = {}) {
  const runtimeProcess = options.runtimeProcess ?? process;
  const env = options.env ?? runtimeProcess.env ?? {};
  const fileExists = options.existsSync ?? existsSync;
  const isPackaged =
    typeof options.isPackaged === "boolean"
      ? options.isPackaged
      : isPackagedElectronRuntime(runtimeProcess);
  const resourcesPath = String(
    options.resourcesPath ?? runtimeProcess.resourcesPath ?? "",
  ).trim();

  if (!isPackaged) {
    const devUrl = String(env.MODYCREW_DEV_URL ?? "").trim();
    if (devUrl) return { mode: "dev", devUrl };
  }

  const packagedIndex = resourcesPath
    ? path.join(resourcesPath, "web", "index.html")
    : "";
  const explicitWebRoot = !isPackaged
    ? String(env.MODYCREW_DESKTOP_WEB_ROOT ?? "").trim()
    : "";
  const candidates = isPackaged
    ? [packagedIndex]
    : [
        explicitWebRoot ? path.join(explicitWebRoot, "index.html") : "",
        packagedIndex,
        path.resolve(
          __dirname,
          "..",
          "..",
          "..",
          "modycrew-web",
          "out",
          "index.html",
        ),
        path.resolve(
          options.cwd ?? runtimeProcess.cwd?.() ?? process.cwd(),
          "apps",
          "modycrew-web",
          "out",
          "index.html",
        ),
      ];

  for (const candidate of candidates.filter(Boolean)) {
    if (fileExists(candidate)) {
      return {
        mode: "prod",
        file: candidate,
        webRoot: path.dirname(candidate),
      };
    }
  }

  return { mode: "fallback" };
}

/**
 * BrowserWindow 생성 시 사용하는 보안 기본값.
 * `docs/38-security-stabilization-checklist.md` 의 기준을 따릅니다.
 */
export const secureBrowserWindowOptions = Object.freeze({
  width: 1320,
  height: 860,
  minWidth: 960,
  minHeight: 600,
  backgroundColor: "#f5f7fa",
  show: false,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    spellcheck: false,
    devTools: true,
    webSecurity: true,
  },
});
