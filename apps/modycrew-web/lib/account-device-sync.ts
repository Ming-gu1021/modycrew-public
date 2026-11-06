"use client";

import type { Unsubscribe } from "firebase/firestore";
import type {
  ModyFeatureActivationRecord,
  ModyFeatureActivationStatus,
  ModyFeatureId,
} from "./feature-activation";
import { getFirebaseClientApp, type ModyAuthSession } from "./firebase-client";

const DEVICE_ID_STORAGE_KEY = "modycrew.deviceId.v1";
const DEVICE_LABEL_STORAGE_KEY = "modycrew.deviceLabel.v1";

export type ModyDeviceKind = "desktop_app" | "web_browser";

export type ModyAccountDevice = {
  id: string;
  label: string;
  kind: ModyDeviceKind;
  platform: string;
  appVersion?: string;
  lastSeenAtEpochMs: number;
  createdAtEpochMs: number;
  capabilities: string[];
};

export type ModySyncedConnectorSummary = {
  connectorId: string;
  method: string;
  category?: string;
  status: string;
  lastCheckedAt?: string;
  secretFingerprint?: string;
};

export type ModySyncedTriggerRule = {
  id: string;
  label: string;
  connectorId: string;
  mode: string;
  enabled: boolean;
  cadenceMinutes: number;
};

export type ModyWorkspaceSyncSnapshot = {
  version: "modycrew.workspace-sync.v1";
  sourceDeviceId: string;
  sourceDeviceLabel: string;
  sourceDeviceKind: ModyDeviceKind;
  updatedAtEpochMs: number;
  connectorSummaries: ModySyncedConnectorSummary[];
  triggerRules: ModySyncedTriggerRule[];
  featureActivationRecords: ModyFeatureActivationRecord[];
  syncNote: string;
};

export type PublishWorkspaceSyncInput = {
  connectorSummaries: ModySyncedConnectorSummary[];
  triggerRules: ModySyncedTriggerRule[];
  featureActivationRecords?: ModyFeatureActivationRecord[];
  syncNote?: string;
};

declare global {
  interface Window {
    modyCrewDesktopInfo?: {
      platform?: string;
      versions?: {
        electron?: string;
        chrome?: string;
        node?: string;
      };
    };
  }
}

export function getCurrentDeviceProfile(): ModyAccountDevice {
  const now = Date.now();
  const id = getOrCreateDeviceId();
  const kind: ModyDeviceKind =
    typeof window !== "undefined" && window.modyCrewDesktopInfo ? "desktop_app" : "web_browser";
  const platform =
    typeof window !== "undefined"
      ? window.modyCrewDesktopInfo?.platform ?? window.navigator.platform ?? "unknown"
      : "unknown";
  const label = getOrCreateDeviceLabel(kind, platform);

  return {
    id,
    label,
    kind,
    platform,
    appVersion:
      typeof window !== "undefined" ? window.modyCrewDesktopInfo?.versions?.electron : undefined,
    lastSeenAtEpochMs: now,
    createdAtEpochMs: readStoredEpoch(`${DEVICE_ID_STORAGE_KEY}:${id}:createdAt`) ?? now,
    capabilities:
      kind === "desktop_app"
        ? ["desktop_bridge", "local_files", "connector_vault", "trigger_runner"]
        : ["account_view", "approval_review", "setup_guide"],
  };
}

export async function registerCurrentDevice(session: ModyAuthSession): Promise<ModyAccountDevice> {
  const device = getCurrentDeviceProfile();
  const [{ doc, getFirestore, setDoc, serverTimestamp }, app] = await Promise.all([
    import("firebase/firestore"),
    getFirebaseClientApp(),
  ]);
  if (!app) throw new Error("Firebase 미설정 - 기기 동기화를 사용할 수 없습니다.");

  await setDoc(
    doc(getFirestore(app), "users", session.uid, "devices", device.id),
    stripUndefinedDeep({
      ...device,
      updatedAt: serverTimestamp(),
      rawSecretMaterialStored: false,
    }),
    { merge: true },
  );

  return device;
}

export async function publishWorkspaceSyncSnapshot(
  session: ModyAuthSession,
  input: PublishWorkspaceSyncInput,
): Promise<ModyWorkspaceSyncSnapshot> {
  const device = getCurrentDeviceProfile();
  const now = Date.now();
  const snapshot: ModyWorkspaceSyncSnapshot = {
    version: "modycrew.workspace-sync.v1",
    sourceDeviceId: device.id,
    sourceDeviceLabel: device.label,
    sourceDeviceKind: device.kind,
    updatedAtEpochMs: now,
    connectorSummaries: input.connectorSummaries.map(sanitizeConnectorSummary).slice(0, 40),
    triggerRules: input.triggerRules.map(sanitizeTriggerRule).slice(0, 40),
    featureActivationRecords: Array.isArray(input.featureActivationRecords)
      ? input.featureActivationRecords.map(sanitizeFeatureActivationRecord).slice(0, 12)
      : [],
    syncNote:
      input.syncNote ??
      "이 계정의 다른 기기에서 업무툴 연결 상태와 반복 업무를 같은 시작점으로 불러옵니다.",
  };
  const [{ doc, getFirestore, setDoc, serverTimestamp }, app] = await Promise.all([
    import("firebase/firestore"),
    getFirebaseClientApp(),
  ]);
  if (!app) throw new Error("Firebase 미설정 - 작업환경 동기화를 사용할 수 없습니다.");

  await setDoc(
    doc(getFirestore(app), "users", session.uid, "private", "workspaceSync"),
    stripUndefinedDeep({
      ...snapshot,
      updatedAt: serverTimestamp(),
      rawSecretMaterialStored: false,
    }),
    { merge: true },
  );

  return snapshot;
}

export async function subscribeWorkspaceSyncSnapshot(
  session: ModyAuthSession,
  onChange: (snapshot: ModyWorkspaceSyncSnapshot | null) => void,
  onError?: (error: Error) => void,
): Promise<Unsubscribe> {
  const [{ doc, getFirestore, onSnapshot }, app] = await Promise.all([
    import("firebase/firestore"),
    getFirebaseClientApp(),
  ]);
  if (!app) throw new Error("Firebase 미설정 - 작업환경 동기화를 사용할 수 없습니다.");

  return onSnapshot(
    doc(getFirestore(app), "users", session.uid, "private", "workspaceSync"),
    (snap) => onChange(snap.exists() ? coerceWorkspaceSyncSnapshot(snap.data()) : null),
    (error) => onError?.(error instanceof Error ? error : new Error(String(error))),
  );
}

export async function subscribeAccountDevices(
  session: ModyAuthSession,
  onChange: (devices: ModyAccountDevice[]) => void,
  onError?: (error: Error) => void,
): Promise<Unsubscribe> {
  const [{ collection, getFirestore, limit, onSnapshot, orderBy, query }, app] =
    await Promise.all([import("firebase/firestore"), getFirebaseClientApp()]);
  if (!app) throw new Error("Firebase 미설정 - 기기 목록을 사용할 수 없습니다.");

  const devicesQuery = query(
    collection(getFirestore(app), "users", session.uid, "devices"),
    orderBy("lastSeenAtEpochMs", "desc"),
    limit(12),
  );

  return onSnapshot(
    devicesQuery,
    (snap) => onChange(snap.docs.map((docSnap) => coerceDevice(docSnap.id, docSnap.data()))),
    (error) => onError?.(error instanceof Error ? error : new Error(String(error))),
  );
}

function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "server-device";
  const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (existing) return existing;

  const next =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `device-${crypto.randomUUID()}`
      : `device-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, next);
  window.localStorage.setItem(`${DEVICE_ID_STORAGE_KEY}:${next}:createdAt`, String(Date.now()));
  return next;
}

function getOrCreateDeviceLabel(kind: ModyDeviceKind, platform: string): string {
  if (typeof window === "undefined") return "ModyCrew 기기";
  const existing = window.localStorage.getItem(DEVICE_LABEL_STORAGE_KEY);
  if (existing) return existing;

  const label = kind === "desktop_app" ? `내 데스크톱 (${platform})` : `웹/노트북 (${platform})`;
  window.localStorage.setItem(DEVICE_LABEL_STORAGE_KEY, label);
  return label;
}

function readStoredEpoch(key: string): number | null {
  if (typeof window === "undefined") return null;
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) ? value : null;
}

function sanitizeConnectorSummary(value: ModySyncedConnectorSummary): ModySyncedConnectorSummary {
  return {
    connectorId: sanitizeId(value.connectorId, "connector"),
    method: sanitizeId(value.method, "method"),
    category: value.category ? sanitizeId(value.category, "category") : undefined,
    status: sanitizeId(value.status, "status"),
    lastCheckedAt: sanitizeOptionalText(value.lastCheckedAt),
    secretFingerprint: sanitizeOptionalText(value.secretFingerprint),
  };
}

function sanitizeTriggerRule(value: ModySyncedTriggerRule): ModySyncedTriggerRule {
  return {
    id: sanitizeId(value.id, "rule"),
    label: sanitizeText(value.label, "반복 업무"),
    connectorId: sanitizeId(value.connectorId, "connector"),
    mode: sanitizeId(value.mode, "polling"),
    enabled: Boolean(value.enabled),
    cadenceMinutes: Number.isFinite(value.cadenceMinutes) ? Math.trunc(value.cadenceMinutes) : 30,
  };
}

function coerceWorkspaceSyncSnapshot(raw: unknown): ModyWorkspaceSyncSnapshot {
  const data = raw as Partial<ModyWorkspaceSyncSnapshot>;
  return {
    version: "modycrew.workspace-sync.v1",
    sourceDeviceId: sanitizeId(data.sourceDeviceId, "device"),
    sourceDeviceLabel: sanitizeText(data.sourceDeviceLabel, "동기화 기기"),
    sourceDeviceKind: data.sourceDeviceKind === "desktop_app" ? "desktop_app" : "web_browser",
    updatedAtEpochMs:
      typeof data.updatedAtEpochMs === "number" ? data.updatedAtEpochMs : 0,
    connectorSummaries: Array.isArray(data.connectorSummaries)
      ? data.connectorSummaries.map((item) => sanitizeConnectorSummary(item)).slice(0, 40)
      : [],
    triggerRules: Array.isArray(data.triggerRules)
      ? data.triggerRules.map((item) => sanitizeTriggerRule(item)).slice(0, 40)
      : [],
    featureActivationRecords: Array.isArray(data.featureActivationRecords)
      ? data.featureActivationRecords.map((item) => sanitizeFeatureActivationRecord(item)).slice(0, 12)
      : [],
    syncNote: sanitizeText(data.syncNote, "계정 작업환경 동기화 준비됨"),
  };
}

function coerceDevice(id: string, raw: unknown): ModyAccountDevice {
  const data = raw as Partial<ModyAccountDevice>;
  return {
    id: sanitizeId(id, "device"),
    label: sanitizeText(data.label, "ModyCrew 기기"),
    kind: data.kind === "desktop_app" ? "desktop_app" : "web_browser",
    platform: sanitizeText(data.platform, "unknown"),
    appVersion: sanitizeOptionalText(data.appVersion),
    lastSeenAtEpochMs:
      typeof data.lastSeenAtEpochMs === "number" ? data.lastSeenAtEpochMs : 0,
    createdAtEpochMs:
      typeof data.createdAtEpochMs === "number" ? data.createdAtEpochMs : 0,
    capabilities: Array.isArray(data.capabilities)
      ? data.capabilities.map((item) => sanitizeId(item, "capability")).slice(0, 12)
      : [],
  };
}

function sanitizeId(value: unknown, fallback: string): string {
  const text = String(value ?? "")
    .trim()
    .replace(/[^a-z0-9._:-]/gi, "")
    .slice(0, 90);
  return text || fallback;
}

function sanitizeFeatureActivationRecord(value: unknown): ModyFeatureActivationRecord {
  const data = value as Partial<ModyFeatureActivationRecord>;
  return {
    id: sanitizeFeatureId(data.id),
    status: sanitizeFeatureStatus(data.status),
    activatedAt: sanitizeOptionalText(data.activatedAt),
    pausedAt: sanitizeOptionalText(data.pausedAt),
    lastIntent: sanitizeOptionalLongText(data.lastIntent),
  };
}

function sanitizeFeatureId(value: unknown): ModyFeatureId {
  const id = sanitizeId(value, "work_intake");
  if (
    id === "work_intake" ||
    id === "connector_recommendations" ||
    id === "automation_monitoring" ||
    id === "document_learning" ||
    id === "remote_desktop_relay" ||
    id === "desktop_control" ||
    id === "approval_execution"
  ) {
    return id;
  }
  return "work_intake";
}

function sanitizeFeatureStatus(value: unknown): ModyFeatureActivationStatus {
  if (value === "available" || value === "active" || value === "paused") return value;
  return "available";
}

function sanitizeText(value: unknown, fallback: string): string {
  const text = String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\bsk-(ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return text || fallback;
}

function sanitizeOptionalText(value: unknown): string | undefined {
  const text = sanitizeText(value, "");
  return text || undefined;
}

function sanitizeOptionalLongText(value: unknown): string | undefined {
  const text = String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\bsk-(ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
  return text || undefined;
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => stripUndefinedDeep(item)) as T;
  }

  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefinedDeep(item)]),
    ) as T;
  }

  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
