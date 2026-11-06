import { access } from "node:fs/promises";
import path from "node:path";

const allowedTargets = new Map([
  ["scorecard", path.join("tmp", "first-user-observation-scorecard.md")],
  ["command_template", path.join("tmp", "first-user-observation-command-template.ps1")],
  ["checklist", path.join("tmp", "first-user-observation-checklist.md")],
]);

export async function handleFirstUserObservationKitMessage(payload = {}, options = {}) {
  const kind = sanitizeKind(payload.kind);
  if (kind !== "open_first_user_observation_kit") {
    return createResult("first_user_observation_kit_unknown_message", {
      userMessage: "지원하지 않는 첫 사용자 관찰 요청입니다.",
    });
  }

  const target = sanitizeTarget(payload.target);
  const relativePath = allowedTargets.get(target);
  if (!relativePath) {
    return createResult("first_user_observation_kit_unknown_target", {
      target,
      userMessage: "지원하지 않는 첫 사용자 관찰 파일입니다.",
    });
  }

  const filePath = path.join(resolveRepoRoot(options), relativePath);
  try {
    await access(filePath);
  } catch {
    return createResult("first_user_observation_kit_missing", {
      target,
      path: filePath,
      userMessage: "첫 사용자 관찰 준비 파일이 없습니다. 먼저 npm.cmd run prepare:first-user-observation 을 실행해 주세요.",
    });
  }

  if (typeof options.shell?.openPath !== "function") {
    return createResult("first_user_observation_kit_shell_unavailable", {
      target,
      path: filePath,
      userMessage: "첫 사용자 관찰 파일을 열 수 있는 Windows shell API가 없습니다.",
    });
  }

  const openError = await options.shell.openPath(filePath);
  if (openError) {
    return createResult("first_user_observation_kit_open_failed", {
      target,
      path: filePath,
      openError: sanitizeText(openError, 240),
      userMessage: "첫 사용자 관찰 파일을 열지 못했습니다. 파일 경로를 확인해 주세요.",
    });
  }

  return createResult("first_user_observation_kit_opened", {
    target,
    path: filePath,
    userMessage: firstUserObservationOpenMessage(target),
  });
}

function firstUserObservationOpenMessage(target) {
  if (target === "command_template") return "첫 사용자 관찰 기록 명령 템플릿을 열었습니다.";
  if (target === "checklist") return "첫 사용자 관찰 준비 체크리스트를 열었습니다.";
  return "첫 사용자 관찰 점검표를 열었습니다.";
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
  return String(value ?? "scorecard").replace(/[^a-z_]/g, "").slice(0, 64) || "scorecard";
}

function sanitizeText(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
