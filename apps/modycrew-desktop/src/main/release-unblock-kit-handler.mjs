import { access } from "node:fs/promises";
import path from "node:path";

const allowedTargets = new Map([
  ["guide", path.join("tmp", "release-unblock-kit.md")],
  ["runner", path.join("tmp", "release-unblock-kit.ps1")],
  ["manifest", path.join("tmp", "release-unblock-kit.json")],
  ["status", path.join("tmp", "release-unblock-status.md")],
  ["ai_report", path.join("tmp", "release-ai-runtime-readiness-report.md")],
  ["live_report", path.join("tmp", "release-live-readiness-report.md")],
  ["observation_report", path.join("tmp", "first-user-observation-report.md")],
]);

export async function handleReleaseUnblockKitMessage(payload = {}, options = {}) {
  const kind = sanitizeKind(payload.kind);
  if (kind !== "open_release_unblock_kit") {
    return createResult("release_unblock_kit_unknown_message", {
      userMessage: "지원하지 않는 릴리즈 언블록 kit 요청입니다.",
    });
  }

  const target = sanitizeTarget(payload.target);
  const relativePath = allowedTargets.get(target);
  if (!relativePath) {
    return createResult("release_unblock_kit_unknown_target", {
      target,
      userMessage: "지원하지 않는 릴리즈 언블록 kit 파일입니다.",
    });
  }

  const filePath = path.join(resolveRepoRoot(options), relativePath);
  try {
    await access(filePath);
  } catch {
    return createResult("release_unblock_kit_missing", {
      target,
      path: filePath,
      userMessage: "릴리즈 언블록 kit 파일이 없습니다. 먼저 npm.cmd run prepare:release-unblock-kit 을 실행해 주세요.",
    });
  }

  if (typeof options.shell?.openPath !== "function") {
    return createResult("release_unblock_kit_shell_unavailable", {
      target,
      path: filePath,
      userMessage: "릴리즈 언블록 kit 파일을 열 수 있는 Windows shell API가 없습니다.",
    });
  }

  const openError = await options.shell.openPath(filePath);
  if (openError) {
    return createResult("release_unblock_kit_open_failed", {
      target,
      path: filePath,
      openError: sanitizeText(openError, 240),
      userMessage: "릴리즈 언블록 kit 파일을 열지 못했습니다. 파일 경로를 확인해 주세요.",
    });
  }

  return createResult("release_unblock_kit_opened", {
    target,
    path: filePath,
    userMessage: releaseUnblockKitOpenMessage(target),
  });
}

function releaseUnblockKitOpenMessage(target) {
  if (target === "runner") return "릴리즈 언블록 kit PowerShell 파일을 열었습니다. 실행은 사용자가 로컬에서 직접 확인해야 합니다.";
  if (target === "manifest") return "릴리즈 언블록 kit JSON 매니페스트를 열었습니다.";
  if (target === "status") return "릴리즈 언블록 현재 상태 보고서를 열었습니다.";
  if (target === "ai_report") return "AI live readiness 보고서를 열었습니다.";
  if (target === "live_report") return "메일/캘린더 live readiness 보고서를 열었습니다.";
  if (target === "observation_report") return "첫 사용자 관찰 보고서를 열었습니다.";
  return "릴리즈 언블록 kit 가이드를 열었습니다.";
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
  return String(value ?? "guide").replace(/[^a-z_]/g, "").slice(0, 64) || "guide";
}

function sanitizeText(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
