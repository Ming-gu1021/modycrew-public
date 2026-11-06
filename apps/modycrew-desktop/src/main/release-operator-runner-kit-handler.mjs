import { access } from "node:fs/promises";
import path from "node:path";

const allowedTargets = new Map([
  ["runner", path.join("tmp", "release-operator-runner.ps1")],
  ["guide", path.join("tmp", "release-operator-runner.md")],
  ["run_report", path.join("tmp", "release-operator-runner-run-report.json")],
  ["run_summary", path.join("tmp", "release-operator-runner-run-report.md")],
]);

export async function handleReleaseOperatorRunnerKitMessage(payload = {}, options = {}) {
  const kind = sanitizeKind(payload.kind);
  if (kind !== "open_release_operator_runner_kit") {
    return createResult("release_operator_runner_kit_unknown_message", {
      userMessage: "지원하지 않는 운영자 runner 파일 요청입니다.",
    });
  }

  const target = sanitizeTarget(payload.target);
  const relativePath = allowedTargets.get(target);
  if (!relativePath) {
    return createResult("release_operator_runner_kit_unknown_target", {
      target,
      userMessage: "지원하지 않는 운영자 runner 파일입니다.",
    });
  }

  const filePath = path.join(resolveRepoRoot(options), relativePath);
  try {
    await access(filePath);
  } catch {
    return createResult("release_operator_runner_kit_missing", {
      target,
      path: filePath,
      userMessage:
        target === "run_report" || target === "run_summary"
          ? "운영자 runner 실행 리포트가 없습니다. 실제 준비가 끝난 뒤 tmp/release-operator-runner.ps1을 로컬 PowerShell에서 실행해 주세요."
          : "운영자 runner 파일이 없습니다. 먼저 npm.cmd run prepare:release-operator-runner 를 실행해 주세요.",
    });
  }

  if (typeof options.shell?.openPath !== "function") {
    return createResult("release_operator_runner_kit_shell_unavailable", {
      target,
      path: filePath,
      userMessage: "운영자 runner 파일을 열 수 있는 Windows shell API가 없습니다.",
    });
  }

  const openError = await options.shell.openPath(filePath);
  if (openError) {
    return createResult("release_operator_runner_kit_open_failed", {
      target,
      path: filePath,
      openError: sanitizeText(openError, 240),
      userMessage: "운영자 runner 파일을 열지 못했습니다. 파일 경로를 확인해 주세요.",
    });
  }

  return createResult("release_operator_runner_kit_opened", {
    target,
    path: filePath,
    userMessage: releaseOperatorRunnerOpenMessage(target),
  });
}

function releaseOperatorRunnerOpenMessage(target) {
  if (target === "guide") return "운영자 runner 안내를 열었습니다.";
  if (target === "run_report") return "운영자 runner 실행 JSON 리포트를 열었습니다.";
  if (target === "run_summary") return "운영자 runner 실행 요약을 열었습니다.";
  return "운영자 runner PowerShell 파일을 열었습니다.";
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
  return String(value ?? "runner").replace(/[^a-z_]/g, "").slice(0, 64) || "runner";
}

function sanitizeText(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
