import { access } from "node:fs/promises";
import path from "node:path";

const allowedTargets = new Map([
  ["template", path.join("tmp", "release-ai-runtime-live-template.ps1")],
  ["checklist", path.join("tmp", "release-ai-runtime-live-checklist.md")],
]);

export async function handleReleaseAIRuntimeLiveKitMessage(payload = {}, options = {}) {
  const kind = sanitizeKind(payload.kind);
  if (kind !== "open_release_ai_runtime_live_kit") {
    return createResult("release_ai_runtime_live_kit_unknown_message", {
      userMessage: "지원하지 않는 AI live 준비 파일 요청입니다.",
    });
  }

  const target = sanitizeTarget(payload.target);
  const relativePath = allowedTargets.get(target);
  if (!relativePath) {
    return createResult("release_ai_runtime_live_kit_unknown_target", {
      target,
      userMessage: "지원하지 않는 AI live 준비 파일입니다.",
    });
  }

  const filePath = path.join(resolveRepoRoot(options), relativePath);
  try {
    await access(filePath);
  } catch {
    return createResult("release_ai_runtime_live_kit_missing", {
      target,
      path: filePath,
      userMessage: "AI live 준비 파일이 없습니다. 먼저 npm.cmd run prepare:release-ai-runtime-live 를 실행해 주세요.",
    });
  }

  if (typeof options.shell?.openPath !== "function") {
    return createResult("release_ai_runtime_live_kit_shell_unavailable", {
      target,
      path: filePath,
      userMessage: "AI live 준비 파일을 열 수 있는 Windows shell API가 없습니다.",
    });
  }

  const openError = await options.shell.openPath(filePath);
  if (openError) {
    return createResult("release_ai_runtime_live_kit_open_failed", {
      target,
      path: filePath,
      openError: sanitizeText(openError, 240),
      userMessage: "AI live 준비 파일을 열지 못했습니다. 파일 경로를 확인해 주세요.",
    });
  }

  return createResult("release_ai_runtime_live_kit_opened", {
    target,
    path: filePath,
    userMessage: target === "checklist" ? "AI live 준비 체크리스트를 열었습니다." : "AI live 실행 템플릿을 열었습니다.",
  });
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
