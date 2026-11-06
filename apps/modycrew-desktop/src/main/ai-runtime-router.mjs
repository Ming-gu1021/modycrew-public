export const aiRuntimeRouterRouteOrder = [
  "codex_oauth",
  "codex_cli",
  "openai_api",
  "gemini_api",
  "setup_recovery",
];

export function inferAIRuntimeFinalRoute(result = {}, codexOAuthProvider = "codex_oauth") {
  if (result.runtime === "codex_cli") return "codex_cli";
  if (result.provider === "openai") return "openai_api";
  if (result.provider === "gemini") return "gemini_api";
  if (result.provider === codexOAuthProvider) return "codex_oauth";
  return "setup_recovery";
}

export function createAIRuntimeRouterMetadata({
  result = {},
  attemptedRoutes = [],
  finalRoute = "",
  answerReady = false,
  codexOAuthProvider = "codex_oauth",
} = {}) {
  const inferredRoute = finalRoute || inferAIRuntimeFinalRoute(result, codexOAuthProvider);
  const resolvedFinalRoute = answerReady ? inferredRoute : "setup_recovery";
  const uniqueAttempts = Array.from(
    new Set(attemptedRoutes.length ? attemptedRoutes : [inferredRoute]),
  ).filter(Boolean);
  if (inferredRoute && !uniqueAttempts.includes(inferredRoute)) uniqueAttempts.push(inferredRoute);
  if (resolvedFinalRoute && !uniqueAttempts.includes(resolvedFinalRoute)) {
    uniqueAttempts.push(resolvedFinalRoute);
  }

  return {
    routeOrder: aiRuntimeRouterRouteOrder,
    attemptedRoutes: uniqueAttempts,
    finalRoute: resolvedFinalRoute || "setup_recovery",
    failClosed: !answerReady,
    recoveryRequired: !answerReady,
    recoveryReason: answerReady ? "" : String(result.status ?? "answer_generation_blocked"),
  };
}

export function ensureAIRuntimeRouterMetadata(
  result = {},
  {
    attemptedRoutes = [],
    finalRoute = "",
    answerReady = false,
    codexOAuthProvider = "codex_oauth",
  } = {},
) {
  if (
    result?.aiRuntimeRouter &&
    Array.isArray(result.aiRuntimeRouter.attemptedRoutes) &&
    result.aiRuntimeRouter.finalRoute
  ) {
    return result.aiRuntimeRouter;
  }
  return createAIRuntimeRouterMetadata({
    result,
    attemptedRoutes,
    finalRoute,
    answerReady,
    codexOAuthProvider,
  });
}

export function createAIRuntimeRecoveryPlan(result = {}) {
  const status = String(result.status ?? "");
  const fallbackAttemptFailures = normalizeAIRuntimeFallbackAttemptFailures(result.fallbackAttemptFailures);
  if (/prompt_required/u.test(status)) {
    return {
      kind: "input_required",
      actionLabel: "요청 입력",
      detail: "처리할 문장이 비어 있어 실제 AI 호출을 시작하지 않았습니다.",
      choices: ["요청 입력"],
    };
  }
  if (/model_unavailable|model_catalog_unavailable|model_selection_mismatch/u.test(status)) {
    return {
      kind: "setup_recovery",
      actionLabel: "사용 가능한 모델 확인",
      detail: "선택한 모델을 현재 연결에서 사용할 수 있는지 확인해야 합니다. 다른 모델로 자동 전환하지 않았습니다.",
      choices: ["모델 목록 새로고침", "AI 연결 설정", "다른 모델 직접 선택"],
    };
  }
  if (/credential|login|oauth|refresh|invalid|expired/u.test(status)) {
    return {
      kind: "auth_recovery",
      actionLabel: "AI 로그인 다시 연결",
      detail: "저장된 AI 연결이 만료되었거나 인증 갱신이 필요합니다.",
      choices: ["AI 로그인 다시 연결", "다른 모델 직접 선택", "방금 요청 이어서 처리"],
    };
  }
  if (/required|not_connected|provider_runtime_not_ready/u.test(status)) {
    return {
      kind: "setup_recovery",
      actionLabel: "AI 연결 설정",
      detail: "실제 답변을 만들 수 있는 AI 연결을 먼저 켜야 합니다.",
      choices: ["AI 연결 설정", "OpenAI 또는 Gemini 연결", "방금 요청 이어서 처리"],
    };
  }
  if (fallbackAttemptFailures.length > 0) {
    return {
      kind: "retry_or_fallback",
      actionLabel: "대체 AI 연결 확인",
      detail: `시도한 대체 답변 경로가 실패했습니다: ${fallbackAttemptFailures.map((item) => item.label).join(", ")}.`,
      choices: ["대체 답변 연결", "AI 연결 다시 확인", "방금 요청 이어서 처리"],
    };
  }
  return {
    kind: "retry_or_fallback",
    actionLabel: "선택한 모델 다시 확인",
    detail: "선택한 모델의 요청이 실패했습니다. 연결을 확인하고 같은 모델로 재시도하거나 다른 모델을 직접 선택해 주세요.",
    choices: ["같은 모델로 다시 시도", "AI 연결 다시 확인", "다른 모델 직접 선택"],
  };
}

export function normalizeAIRuntimeFallbackAttemptFailures(failures = []) {
  if (!Array.isArray(failures)) return [];
  return failures
    .map((failure) => {
      const [route = "", status = "unknown"] = String(failure ?? "").split(":");
      const normalizedRoute = route.trim();
      const normalizedStatus = status.trim() || "unknown";
      if (!normalizedRoute) return null;
      return {
        route: normalizedRoute,
        status: normalizedStatus,
        label: `${aiRuntimeRouteUserLabel(normalizedRoute)} ${aiRuntimeFailureUserLabel(normalizedStatus)}`,
      };
    })
    .filter(Boolean);
}

export function aiRuntimeRouteUserLabel(route = "") {
  if (route === "codex_oauth") return "AI 로그인 연결";
  if (route === "codex_cli") return "설치 앱 답변 실행";
  if (route === "openai" || route === "openai_api") return "OpenAI";
  if (route === "gemini" || route === "gemini_api") return "Google Gemini";
  if (route === "setup_recovery") return "설정 복구";
  return String(route || "AI 연결").replaceAll("_", " ");
}

export function aiRuntimeFailureUserLabel(status = "") {
  const value = String(status ?? "").trim();
  if (!value) return "실패";
  if (/timeout|network|fetch/u.test(value)) return "네트워크/응답 지연";
  if (/rate|quota|limit/u.test(value)) return "사용량 제한";
  if (/credential|auth|login|oauth|refresh|invalid|expired/u.test(value)) return "인증 재확인 필요";
  if (/required|missing|not_connected|not_ready/u.test(value)) return "연결 준비 필요";
  if (/failed|error/u.test(value)) return "호출 실패";
  return value.replaceAll("_", " ");
}
