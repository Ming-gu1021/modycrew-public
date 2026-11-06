"use client";

import type { Unsubscribe } from "firebase/firestore";
import { getFirebaseClientApp, type ModyAuthSession } from "./firebase-client";
import { getCurrentDeviceProfile, type ModyAccountDevice } from "./account-device-sync";
import type { WorkItem, WorkItemStatus } from "./types";

export type ModyRelayRequestStatus = "queued" | "running" | "completed" | "failed" | "awaiting_approval" | "needs_attention";
export type ModyRelayRequestMode = "work_intake" | "trigger_check" | "connectivity_audit";

export type ModyRelayPreferences = {
  version: "modycrew.relay-preferences.v1";
  defaultDesktopDeviceId: string;
  defaultDesktopDeviceLabel: string;
  updatedByDeviceId: string;
  updatedByDeviceLabel: string;
  updatedAtEpochMs: number;
  rawSecretMaterialStored: false;
};

export type ModyAccountRelayRequest = {
  id: string;
  targetDeviceId: string;
  targetDeviceLabel: string;
  requesterDeviceId: string;
  requesterDeviceLabel: string;
  mode: ModyRelayRequestMode;
  text: string;
  status: ModyRelayRequestStatus;
  createdAtEpochMs: number;
  updatedAtEpochMs: number;
  resultSummary?: string;
  sessionId?: string;
  resultWorkItemIds?: string[];
  resultDeepLink?: string;
  errorMessage?: string;
  rawSecretMaterialStored: false;
};

export type CreateRelayRequestInput = {
  mode: ModyRelayRequestMode;
  text: string;
};

export type CompleteRelayRequestInput = {
  status?: "completed" | "awaiting_approval" | "needs_attention";
  resultSummary?: string;
  sessionId?: string;
  resultWorkItemIds?: string[];
};

export async function saveRelayPreferences(
  session: ModyAuthSession,
  targetDevice: ModyAccountDevice,
): Promise<ModyRelayPreferences> {
  const updater = getCurrentDeviceProfile();
  const now = Date.now();
  const preferences: ModyRelayPreferences = {
    version: "modycrew.relay-preferences.v1",
    defaultDesktopDeviceId: sanitizeId(targetDevice.id, "target-device"),
    defaultDesktopDeviceLabel: sanitizeText(targetDevice.label, "기본 데스크톱"),
    updatedByDeviceId: sanitizeId(updater.id, "updater-device"),
    updatedByDeviceLabel: sanitizeText(updater.label, "설정 기기"),
    updatedAtEpochMs: now,
    rawSecretMaterialStored: false,
  };
  const [{ doc, getFirestore, setDoc, serverTimestamp }, app] = await Promise.all([
    import("firebase/firestore"),
    getFirebaseClientApp(),
  ]);
  if (!app) throw new Error("Firebase 미설정 - 기본 실행 PC를 저장할 수 없습니다.");

  await setDoc(
    doc(getFirestore(app), "users", session.uid, "private", "relayPreferences"),
    {
      ...preferences,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  return preferences;
}

export async function subscribeRelayPreferences(
  session: ModyAuthSession,
  onChange: (preferences: ModyRelayPreferences | null) => void,
  onError?: (error: Error) => void,
): Promise<Unsubscribe> {
  const [{ doc, getFirestore, onSnapshot }, app] = await Promise.all([
    import("firebase/firestore"),
    getFirebaseClientApp(),
  ]);
  if (!app) throw new Error("Firebase 미설정 - 기본 실행 PC 설정을 읽을 수 없습니다.");

  return onSnapshot(
    doc(getFirestore(app), "users", session.uid, "private", "relayPreferences"),
    (snap) => onChange(snap.exists() ? coerceRelayPreferences(snap.data()) : null),
    (error) => onError?.(error instanceof Error ? error : new Error(String(error))),
  );
}

export async function createRelayRequest(
  session: ModyAuthSession,
  targetDevice: ModyAccountDevice,
  input: CreateRelayRequestInput,
): Promise<ModyAccountRelayRequest> {
  const requester = getCurrentDeviceProfile();
  const now = Date.now();
  const [{ collection, doc, getFirestore, setDoc, serverTimestamp }, app] = await Promise.all([
    import("firebase/firestore"),
    getFirebaseClientApp(),
  ]);
  if (!app) throw new Error("Firebase 미설정 - 원격 실행 요청을 만들 수 없습니다.");

  const requestRef = doc(collection(getFirestore(app), "users", session.uid, "relayRequests"));
  const relayRequest: ModyAccountRelayRequest = {
    id: requestRef.id,
    targetDeviceId: sanitizeId(targetDevice.id, "target-device"),
    targetDeviceLabel: sanitizeText(targetDevice.label, "대상 데스크톱"),
    requesterDeviceId: sanitizeId(requester.id, "requester-device"),
    requesterDeviceLabel: sanitizeText(requester.label, "요청 기기"),
    mode: sanitizeMode(input.mode),
    text: sanitizeLongText(input.text, "연결 상태를 확인해줘."),
    status: "queued",
    createdAtEpochMs: now,
    updatedAtEpochMs: now,
    rawSecretMaterialStored: false,
  };

  await setDoc(requestRef, {
    ...relayRequest,
    updatedAt: serverTimestamp(),
  });

  return relayRequest;
}

export function relayRequestToWorkItem(request: ModyAccountRelayRequest): WorkItem {
  const status = workItemStatusForRelay(request);
  const isWorkIntake = request.mode === "work_intake";
  const title =
    request.status === "completed"
      ? `${relayModeLabel(request.mode)} 완료`
      : request.status === "failed"
        ? `${relayModeLabel(request.mode)} 실패`
        : request.status === "awaiting_approval"
          ? `${relayModeLabel(request.mode)} 승인 대기`
          : request.status === "needs_attention"
            ? `${relayModeLabel(request.mode)} 확인 필요`
            : `${relayModeLabel(request.mode)} 요청`;
  const body = [
    `요청: ${request.text}`,
    request.resultSummary ? `결과: ${request.resultSummary}` : "",
    request.sessionId ? `세션: ${request.sessionId}` : "",
    request.resultWorkItemIds?.length ? `이어볼 업무: ${request.resultWorkItemIds.slice(0, 3).join(", ")}` : "",
    request.resultDeepLink ? `이어보기: ${request.resultDeepLink}` : "",
    request.errorMessage ? `오류: ${request.errorMessage}` : "",
    `실행 PC: ${request.targetDeviceLabel}`,
    `요청 기기: ${request.requesterDeviceLabel}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    id: `account-relay-${request.id}`,
    title,
    source: "messaging_command",
    sourceLabel: "계정 릴레이",
    senderLabel: `${request.requesterDeviceLabel} → ${request.targetDeviceLabel}`,
    body,
    summary:
      request.errorMessage ??
      request.resultSummary ??
      `${request.targetDeviceLabel}에서 ${relayModeLabel(request.mode)}을 처리 중입니다.`,
    status,
    riskLabel: isWorkIntake ? "medium" : request.status === "failed" ? "medium" : "low",
    riskSignals:
      isWorkIntake || request.status === "failed"
        ? [
            {
              id: `account-relay-${request.id}:review`,
              label: request.status === "failed" ? "확인 필요" : "승인 경계 유지",
              riskLabel: "medium",
              reason:
                request.status === "failed"
                  ? "원격 실행이 실패했습니다. 대상 데스크톱 연결 상태를 확인해야 합니다."
                  : "데스크톱이 만든 답장, 일정, 파일 실행 후보는 기존 승인함 최종 확인 전까지 외부 실행되지 않습니다.",
            },
          ]
        : [],
    receivedAt: new Date(request.updatedAtEpochMs || request.createdAtEpochMs || Date.now()).toISOString(),
    ...(isWorkIntake && (request.status === "completed" || request.status === "awaiting_approval")
      ? {
          draft: {
            id: `account-relay-${request.id}:result`,
            toneLabel: "원격 실행 결과",
            body: request.resultSummary ?? "데스크톱에서 원격 업무 처리를 완료했습니다.",
            operationKind: "stage_approval",
            requiresApprovalBeforeSend: true,
          },
        }
      : {}),
  };
}

export async function subscribeRelayRequestsForDevice(
  session: ModyAuthSession,
  deviceId: string,
  onChange: (requests: ModyAccountRelayRequest[]) => void,
  onError?: (error: Error) => void,
): Promise<Unsubscribe> {
  const [{ collection, getFirestore, limit, onSnapshot, query, where }, app] =
    await Promise.all([import("firebase/firestore"), getFirebaseClientApp()]);
  if (!app) throw new Error("Firebase 미설정 - 원격 실행 요청을 받을 수 없습니다.");

  const requestsQuery = query(
    collection(getFirestore(app), "users", session.uid, "relayRequests"),
    where("targetDeviceId", "==", sanitizeId(deviceId, "device")),
    where("status", "==", "queued"),
    limit(5),
  );

  return onSnapshot(
    requestsQuery,
    (snap) => onChange(sortRelayRequests(snap.docs.map((docSnap) => coerceRelayRequest(docSnap.id, docSnap.data())))),
    (error) => onError?.(error instanceof Error ? error : new Error(String(error))),
  );
}

export async function subscribeRecentRelayRequests(
  session: ModyAuthSession,
  onChange: (requests: ModyAccountRelayRequest[]) => void,
  onError?: (error: Error) => void,
): Promise<Unsubscribe> {
  const [{ collection, getFirestore, limit, onSnapshot, orderBy, query }, app] = await Promise.all([
    import("firebase/firestore"),
    getFirebaseClientApp(),
  ]);
  if (!app) throw new Error("Firebase 미설정 - 원격 실행 기록을 볼 수 없습니다.");

  const requestsQuery = query(
    collection(getFirestore(app), "users", session.uid, "relayRequests"),
    orderBy("createdAtEpochMs", "desc"),
    limit(24),
  );

  return onSnapshot(
    requestsQuery,
    (snap) =>
      onChange(
        sortRelayRequests(snap.docs.map((docSnap) => coerceRelayRequest(docSnap.id, docSnap.data()))).slice(
          0,
          8,
        ),
      ),
    (error) => onError?.(error instanceof Error ? error : new Error(String(error))),
  );
}

export async function markRelayRequestRunning(
  session: ModyAuthSession,
  requestId: string,
): Promise<void> {
  await updateRelayRequest(session, requestId, {
    status: "running",
    updatedAtEpochMs: Date.now(),
  });
}

export async function completeRelayRequest(
  session: ModyAuthSession,
  requestId: string,
  input: CompleteRelayRequestInput,
): Promise<void> {
  await updateRelayRequest(session, requestId, {
    status: input.status ?? "completed",
    resultSummary: sanitizeLongText(input.resultSummary, "원격 실행을 완료했습니다."),
    sessionId: input.sessionId ? sanitizeId(input.sessionId, "session") : undefined,
    resultWorkItemIds: Array.isArray(input.resultWorkItemIds)
      ? input.resultWorkItemIds.map((id) => sanitizeId(id, "work-item")).filter(Boolean).slice(0, 8)
      : [],
    resultDeepLink: createResultDeepLink(input.resultWorkItemIds?.[0], input.sessionId),
    errorMessage: undefined,
    updatedAtEpochMs: Date.now(),
  });
}

export async function failRelayRequest(
  session: ModyAuthSession,
  requestId: string,
  error: unknown,
): Promise<void> {
  await updateRelayRequest(session, requestId, {
    status: "failed",
    errorMessage: sanitizeLongText(error instanceof Error ? error.message : String(error), "원격 실행 실패"),
    updatedAtEpochMs: Date.now(),
  });
}

async function updateRelayRequest(
  session: ModyAuthSession,
  requestId: string,
  patch: Partial<ModyAccountRelayRequest>,
): Promise<void> {
  const [{ doc, getFirestore, serverTimestamp, updateDoc }, app] = await Promise.all([
    import("firebase/firestore"),
    getFirebaseClientApp(),
  ]);
  if (!app) throw new Error("Firebase 미설정 - 원격 실행 상태를 갱신할 수 없습니다.");

  await updateDoc(
    doc(getFirestore(app), "users", session.uid, "relayRequests", requestId),
    stripUndefined({
      ...patch,
      rawSecretMaterialStored: false,
      updatedAt: serverTimestamp(),
    }),
  );
}

function workItemStatusForRelay(request: ModyAccountRelayRequest): WorkItemStatus {
  if (request.status === "queued") return "pending";
  if (request.status === "running") return "analyzing";
  if (request.status === "failed") return "needs_review";
  if (request.status === "needs_attention") return "needs_review";
  if (request.status === "awaiting_approval") return "approval_pending";
  if (request.mode === "work_intake") return "approval_pending";
  return "completed";
}

function relayModeLabel(mode: ModyRelayRequestMode): string {
  if (mode === "work_intake") return "원격 업무 처리";
  if (mode === "trigger_check") return "원격 자동화 실행";
  return "원격 연결 진단";
}

function coerceRelayPreferences(raw: unknown): ModyRelayPreferences {
  const data = raw as Partial<ModyRelayPreferences>;
  return {
    version: "modycrew.relay-preferences.v1",
    defaultDesktopDeviceId: sanitizeId(data.defaultDesktopDeviceId, "target-device"),
    defaultDesktopDeviceLabel: sanitizeText(data.defaultDesktopDeviceLabel, "기본 데스크톱"),
    updatedByDeviceId: sanitizeId(data.updatedByDeviceId, "updater-device"),
    updatedByDeviceLabel: sanitizeText(data.updatedByDeviceLabel, "설정 기기"),
    updatedAtEpochMs: typeof data.updatedAtEpochMs === "number" ? data.updatedAtEpochMs : 0,
    rawSecretMaterialStored: false,
  };
}

function coerceRelayRequest(id: string, raw: unknown): ModyAccountRelayRequest {
  const data = raw as Partial<ModyAccountRelayRequest>;
  return {
    id: sanitizeId(data.id ?? id, id),
    targetDeviceId: sanitizeId(data.targetDeviceId, "target-device"),
    targetDeviceLabel: sanitizeText(data.targetDeviceLabel, "대상 데스크톱"),
    requesterDeviceId: sanitizeId(data.requesterDeviceId, "requester-device"),
    requesterDeviceLabel: sanitizeText(data.requesterDeviceLabel, "요청 기기"),
    mode: sanitizeMode(data.mode),
    text: sanitizeLongText(data.text, "연결 상태를 확인해줘."),
    status: sanitizeStatus(data.status),
    createdAtEpochMs: typeof data.createdAtEpochMs === "number" ? data.createdAtEpochMs : 0,
    updatedAtEpochMs: typeof data.updatedAtEpochMs === "number" ? data.updatedAtEpochMs : 0,
    resultSummary: data.resultSummary ? sanitizeLongText(data.resultSummary, "") : undefined,
    sessionId: data.sessionId ? sanitizeId(data.sessionId, "session") : undefined,
    resultWorkItemIds: Array.isArray(data.resultWorkItemIds)
      ? data.resultWorkItemIds.map((id) => sanitizeId(id, "work-item")).filter(Boolean).slice(0, 8)
      : [],
    resultDeepLink: data.resultDeepLink ? sanitizeDeepLink(data.resultDeepLink) : undefined,
    errorMessage: data.errorMessage ? sanitizeLongText(data.errorMessage, "") : undefined,
    rawSecretMaterialStored: false,
  };
}

function sortRelayRequests(requests: ModyAccountRelayRequest[]): ModyAccountRelayRequest[] {
  return [...requests].sort((a, b) => b.createdAtEpochMs - a.createdAtEpochMs);
}

function sanitizeMode(value: unknown): ModyRelayRequestMode {
  if (value === "work_intake" || value === "trigger_check" || value === "connectivity_audit") {
    return value;
  }
  return "connectivity_audit";
}

function sanitizeStatus(value: unknown): ModyRelayRequestStatus {
  if (value === "queued" || value === "running" || value === "completed" || value === "failed" || value === "awaiting_approval" || value === "needs_attention") {
    return value;
  }
  return "needs_attention";
}

function sanitizeId(value: unknown, fallback: string): string {
  const text = String(value ?? "")
    .trim()
    .replace(/[^a-z0-9._:-]/gi, "")
    .slice(0, 120);
  return text || fallback;
}

function createResultDeepLink(workItemId?: string, sessionId?: string): string | undefined {
  const params = new URLSearchParams();
  const safeWorkItemId = workItemId ? sanitizeId(workItemId, "") : "";
  const safeSessionId = sessionId ? sanitizeId(sessionId, "") : "";
  if (safeWorkItemId) params.set("workItem", safeWorkItemId);
  if (safeWorkItemId) params.set("queue", "approval");
  if (safeSessionId) params.set("agentSession", safeSessionId);
  const query = params.toString();
  return query ? `/?${query}` : undefined;
}

function sanitizeDeepLink(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text.startsWith("/?")) return "";
  const params = new URLSearchParams(text.slice(2));
  const next = new URLSearchParams();
  const workItemId = sanitizeId(params.get("workItem"), "");
  const queue = sanitizeQueue(params.get("queue"));
  const agentSession = sanitizeId(params.get("agentSession"), "");
  if (workItemId) next.set("workItem", workItemId);
  if (queue) next.set("queue", queue);
  if (agentSession) next.set("agentSession", agentSession);
  const query = next.toString();
  return query ? `/?${query}` : "";
}

function sanitizeQueue(value: unknown): string {
  const text = String(value ?? "").trim();
  if (text === "approval" || text === "deadline" || text === "meeting" || text === "today") return text;
  return "";
}

function sanitizeText(value: unknown, fallback: string): string {
  const text = redactSecretLikeText(value).slice(0, 160);
  return text || fallback;
}

function sanitizeLongText(value: unknown, fallback: string): string {
  const text = redactSecretLikeText(value).slice(0, 1000);
  return text || fallback;
}

function redactSecretLikeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\b(?:sk|pk|rk)-(?:ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[redacted-google-key]")
    .replace(/\s+/g, " ")
    .trim();
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
