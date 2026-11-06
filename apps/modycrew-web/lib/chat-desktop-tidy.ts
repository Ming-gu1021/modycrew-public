import type { DesktopBridgeApi } from "./desktop-bridge";

export const desktopTidyPrefix = "assistant-desktop-tidy-";
export { resolveDesktopTidyIntent } from "./chat-desktop-tidy-intent";
import { resolveDesktopTidyIntent } from "./chat-desktop-tidy-intent";
export const isDesktopTidyRequest = (text: string, history: { role: string; text: string }[] = []) => Boolean(resolveDesktopTidyIntent(text, history));

export type DesktopTidyScope = { localStorageRoot: string; scopeKey: string; threadId: string; requestId: string };
export type DesktopTidyResult = { access?: { mode: "disabled" | "approval" | "auto"; revision: string }; status: string; approvalToken?: string; total?: number; moved?: number; restored?: number; skipped?: number; userMessage?: string;
  files: { name: string; destination: string; state: string; detail?: string }[] };
export async function requestDesktopTidy(bridge: DesktopBridgeApi | null | undefined, scope: DesktopTidyScope,
  action: "status" | "prepare" | "apply" | "revert" | "cancel" | "open" | "access" | "set_access", approvalToken?: string, options?: { automatic?: boolean; accessMode?: "disabled" | "approval" | "auto" }): Promise<DesktopTidyResult> {
  if (!bridge?.isAvailable) throw new Error("이 PC의 바탕화면 정리는 모디크루 설치 앱에서 시작할 수 있습니다.");
  const method = action === "prepare" ? bridge.createDocumentLearningFolderPlan : action === "apply" ? bridge.applyDocumentLearningFolderPlan : action === "revert" ? bridge.revertDocumentLearningFolderPlan : bridge.previewDocumentLearningFolderPlan;
  const invoke = method as unknown as (payload: unknown) => Promise<DesktopTidyResult>;
  const response = await invoke({ localStorageRoot: scope.localStorageRoot, files: [],
    chatTidy: { requestId: scope.requestId, scopeKey: scope.scopeKey, threadId: scope.threadId, approvalToken, intent: ["cancel", "open", "access", "set_access"].includes(action) ? action : "", accessMode: options?.accessMode, automatic: options?.automatic === true },
    finalApproval: action === "revert" || (action === "apply" && options?.automatic !== true) });
  if (!response || !Array.isArray(response.files)) throw new Error(response?.userMessage || "파일 정리 연결을 확인하지 못했습니다. 이 기능이 포함된 앱 업데이트가 필요합니다.");
  return response;
}

export async function requestDesktopFileAccess(bridge: DesktopBridgeApi | null | undefined, scope: Omit<DesktopTidyScope, "requestId">, mode?: "disabled" | "approval" | "auto") {
  const result = await requestDesktopTidy(bridge, { ...scope, requestId: "desktop-access-settings" }, mode ? "set_access" : "access", undefined, { accessMode: mode });
  if (!result.access) throw new Error("파일 접근 설정을 지원하는 앱 업데이트가 필요합니다.");
  return result.access;
}
