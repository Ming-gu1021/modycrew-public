import { access } from "node:fs/promises";
import path from "node:path";

const allowedTargets = new Map([
  ["template", path.join("tmp", "release-live-smoke-template.ps1")],
  ["checklist", path.join("tmp", "release-live-smoke-checklist.md")],
  ["scorecard", path.join("tmp", "release-live-smoke-operator-scorecard.md")],
  ["unblock_report", path.join("tmp", "release-live-smoke-unblock-run-report.md")],
]);

export async function handleReleaseLiveSmokeKitMessage(payload = {}, options = {}) {
  const kind = sanitizeKind(payload.kind);
  if (kind !== "open_release_live_smoke_kit") {
    return createResult("release_live_smoke_kit_unknown_message", {
      userMessage: "지원하지 않는 live smoke 준비 파일 요청입니다.",
    });
  }

  const target = sanitizeTarget(payload.target);
  const relativePath = allowedTargets.get(target);
  if (!relativePath) {
    return createResult("release_live_smoke_kit_unknown_target", {
      target,
      userMessage: "지원하지 않는 live smoke 준비 파일입니다.",
    });
  }

  const filePath = path.join(resolveRepoRoot(options), relativePath);
  try {
    await access(filePath);
  } catch {
    return createResult("release_live_smoke_kit_missing", {
      target,
      path: filePath,
      userMessage: "live smoke 준비 파일이 없습니다. 먼저 npm.cmd run prepare:release-live-smoke 를 실행해 주세요.",
    });
  }

  if (typeof options.shell?.openPath !== "function") {
    return createResult("release_live_smoke_kit_shell_unavailable", {
      target,
      path: filePath,
      userMessage: "live smoke 준비 파일을 열 수 있는 Windows shell API가 없습니다.",
    });
  }

  const openError = await options.shell.openPath(filePath);
  if (openError) {
    return createResult("release_live_smoke_kit_open_failed", {
      target,
      path: filePath,
      openError: sanitizeText(openError, 240),
      userMessage: "live smoke 준비 파일을 열지 못했습니다. 파일 경로를 확인해 주세요.",
    });
  }

  return createResult("release_live_smoke_kit_opened", {
    target,
    path: filePath,
    userMessage: releaseLiveSmokeOpenMessage(target),
  });
}

function releaseLiveSmokeOpenMessage(target) {
  if (target === "checklist") return "메일/캘린더 live smoke 체크리스트를 열었습니다.";
  if (target === "scorecard") return "live smoke 운영 점검표를 열었습니다.";
  if (target === "unblock_report") return "메일/캘린더 언블록 runner 보고서를 열었습니다.";
  return "메일/캘린더 live smoke 실행 템플릿을 열었습니다.";
}

function createResult(status, extra = {}) {
  return {
    status,
    ...extra,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function resolveRepoRoot(options = {}) {
  return options.repoRoot ? path.resolve(String(options.repoRoot)) : process.cwd();
}

function sanitizeKind(value) {
  return String(value ?? "").replace(/[^a-z_]/g, "").slice(0, 64);
}

function sanitizeTarget(value) {
  return String(value ?? "template").replace(/[^a-z_]/g, "").slice(0, 64) || "template";
}

function sanitizeText(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
