type ExecutionResult = {
  status?: string;
  userMessage?: string;
  session?: { id?: string; status?: string; finishedAt?: string; approvalQueueCount?: number; outputSummary?: string };
};

const completedByMode: Record<string, ReadonlySet<string>> = {
  work_intake: new Set(["desktop_local_live_completed"]),
  trigger_check: new Set(["trigger_runner_completed", "trigger_runner_quiet"]),
  connectivity_audit: new Set(["connectivity_audit_completed"]),
};

export function classifyRelayExecution(mode: string, result: ExecutionResult | null | undefined): {
  status: "completed" | "awaiting_approval" | "needs_attention" | "failed";
  summary: string;
} {
  const status = result?.status || "";
  const session = result?.session;
  const summary = session?.outputSummary || result?.userMessage || "메인 PC에서 처리 결과를 확인해 주세요.";
  if (/(?:failed|error|unavailable)/.test(status)) return { status: "failed", summary };
  if (!completedByMode[mode]?.has(status) || !session?.id || !session.finishedAt || session.status !== status) {
    return { status: "needs_attention", summary: `완료를 확인하지 못했습니다. ${summary}` };
  }
  if ((session.approvalQueueCount || 0) > 0) return { status: "awaiting_approval", summary: `초안이 준비됐으며 사용자 승인을 기다리고 있습니다. ${summary}` };
  return { status: "completed", summary };
}
