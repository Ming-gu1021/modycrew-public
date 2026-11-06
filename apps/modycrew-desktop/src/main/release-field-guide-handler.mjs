import { access } from "node:fs/promises";
import path from "node:path";

const guideRelativePath = path.join("tmp", "release-field-guide.md");

export async function handleReleaseFieldGuideMessage(payload = {}, options = {}) {
  const kind = sanitizeKind(payload.kind);
  if (kind !== "open_release_field_guide") {
    return createResult("release_field_guide_unknown_message", {
      userMessage: "지원하지 않는 릴리즈 현장 가이드 요청입니다.",
    });
  }

  const filePath = path.join(resolveRepoRoot(options), guideRelativePath);
  try {
    await access(filePath);
  } catch {
    return createResult("release_field_guide_missing", {
      path: filePath,
      userMessage: "릴리즈 현장 가이드 파일이 없습니다. 먼저 npm.cmd run prepare:release-field-guide 를 실행해 주세요.",
    });
  }

  if (typeof options.shell?.openPath !== "function") {
    return createResult("release_field_guide_shell_unavailable", {
      path: filePath,
      userMessage: "릴리즈 현장 가이드를 열 수 있는 Windows shell API가 없습니다.",
    });
  }

  const openError = await options.shell.openPath(filePath);
  if (openError) {
    return createResult("release_field_guide_open_failed", {
      path: filePath,
      openError: sanitizeText(openError, 240),
      userMessage: "릴리즈 현장 가이드를 열지 못했습니다. 파일 경로를 확인해 주세요.",
    });
  }

  return createResult("release_field_guide_opened", {
    path: filePath,
    userMessage: "릴리즈 현장 가이드를 열었습니다.",
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

function sanitizeText(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
