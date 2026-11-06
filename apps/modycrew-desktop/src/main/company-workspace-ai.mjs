export const COMPANY_WORKSPACE_AI_SOURCE = "company_shared_workspace";

export function isCompanyWorkspaceAIRequest(payload) {
  return payload?.kind === "generate_text" && payload?.executionContext?.source === COMPANY_WORKSPACE_AI_SOURCE;
}

/** Never route a coworker's prompt through this computer's personal roles or tools. */
export function generateCompanyWorkspaceText(event, payload, options, generate) {
  const prompt = typeof payload?.prompt === "string" ? payload.prompt.trim().slice(0, 32000) : "";
  if (!prompt) throw new Error("회사 업무 요청이 비어 있습니다.");
  return generate(event, {
    kind: "generate_text", prompt,
    executionContext: {source: COMPANY_WORKSPACE_AI_SOURCE, externalMutationAllowed: false},
  }, { ...options, companySharedContext: true });
}
