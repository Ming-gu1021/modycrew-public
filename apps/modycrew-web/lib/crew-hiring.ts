"use client";

import {
  createAITeammateFromTemplate,
  normalizeAITeammates,
  readAITeammates,
  saveAITeammates,
  type AITeammate,
} from "./ai-teammates";
import { builtinExperts, getBuiltinExpert, restoreBuiltinExpert, type BuiltinExpert } from "../../../packages/domain/dist/builtin-experts.js";
import {
  getRoleCapability,
  resolveRoleFirstTasks,
  resolveTeammateRoleCapability,
  type ModyRoleCapability,
  type ModyRoleConnectionId,
  type ModyRoleConnectionStatus,
} from "../../../packages/domain/dist/role-capabilities.js";
import { getCrewCharacter, type CrewCharacterId } from "./crew-character-catalog";
import {
  createDesktopBridge,
  type AIProviderKeyStatus,
  type ConnectorStatusRecord,
  type LocalMemoryAppProfile,
} from "./desktop-bridge";

export {
  describeRoleDailySkillCategories,
  describeRoleTools,
  resolveRoleFirstTasks,
} from "../../../packages/domain/dist/role-capabilities.js";
export type { ModyResolvedRoleFirstTask, ModyRoleCapability, ModyRoleRecipe } from "../../../packages/domain/dist/role-capabilities.js";

/**
 * AI 직원 채용 화면의 직무 목록.
 * 고용하면 기존 AI 팀원 모델(AITeammate)로 저장되므로, 대화·업무 배정·기억 경로는
 * 원래 쓰던 흐름을 그대로 탄다. 이 파일은 "어떤 직무를 어떤 기준으로 뽑는가"만 정한다.
 */
export type CrewJobId = string;
export type CrewJob = Omit<BuiltinExpert, "avatarId"> & { avatarId: CrewCharacterId };
export const crewJobs: readonly CrewJob[] = builtinExperts as readonly CrewJob[];

const fallbackPortrait = "/office-crew/crew-mail-v2.webp";

export function crewJobPortrait(job: Pick<CrewJob, "avatarId">): string {
  return getCrewCharacter(job.avatarId)?.asset.idle.src ?? fallbackPortrait;
}

export function teammatePortrait(teammate: Pick<AITeammate, "avatarId">): string {
  return getCrewCharacter(teammate.avatarId)?.asset.idle.src ?? fallbackPortrait;
}

export function findHiredTeammate(job: CrewJob, teammates: AITeammate[]): AITeammate | undefined {
  return teammates.find((teammate) => getBuiltinExpert(teammate)?.id === job.id);
}

/**
 * 대화 첫 화면(직원 소개)의 예시 요청. 채용 화면·직원 설정에서 고른 첫 업무 → 역할 정본의 첫 업무 →
 * 직무 예시 요청 순서로 최대 3개를 돌려준다. 버튼을 누르면 입력칸에 채워지는 기존 흐름 그대로다.
 * 연결 상태를 넘기면 연결이 없는 첫 업무는 붙여 넣은 자료로 시작하는 요청으로 바꾼다.
 * 직무에서 온 직원이 아니면 고른 첫 업무만(없으면 빈 목록).
 */
export function crewStarterPrompts(
  teammate: Pick<AITeammate, "id" | "avatarId" | "roleTitle" | "builtinExpertId">,
  connections?: Partial<CrewConnectionState>,
): string[] {
  const remembered = readCrewFirstTask(teammate.id);
  const job = getBuiltinExpert(teammate);
  if (!job) return remembered ? [remembered] : [];
  const capability = getRoleCapability(job.id);
  const firstTasks = capability ? resolveRoleFirstTasks(capability, connections).map((task) => task.prompt) : [];
  return [...new Set([...(remembered ? [remembered] : []), ...firstTasks, ...job.starterPrompts])].slice(0, 3);
}

export function buildHiredTeammate(job: CrewJob): AITeammate {
  const base = createAITeammateFromTemplate(job.templateId);
  const now = Date.now();
  return restoreBuiltinExpert({
    ...base,
    builtinExpertId: job.id,
    id: "teammate-" + job.id + "-" + now,
    avatarId: job.avatarId,
    name: job.name,
    roleTitle: job.roleTitle,
    channelName: job.channelName,
    brief: job.brief,
    // 직무 정본의 스킬만 쓴다. 템플릿 기본 스킬을 섞으면 같은 템플릿 직무끼리 다시 똑같아진다.
    skillIds: [...job.skillIds].slice(0, 16),
    workPackIds: [...job.workPackIds],
    instructions: [...job.instructions],
    createdAt: now,
    updatedAt: now,
  });
}

export type CrewRoster = {
  teammates: AITeammate[];
  profile: LocalMemoryAppProfile | null;
};

/** 설치 앱의 기억 폴더에 저장된 앱 프로필을 정본으로 읽는다. 없으면 이 화면의 저장분을 쓴다. */
export async function loadCrewRoster(): Promise<CrewRoster> {
  try {
    const result = await createDesktopBridge().loadAppProfile();
    const profile = result.profile ?? null;
    const stored = Array.isArray(profile?.teammates) && profile.teammates.length ? profile.teammates : readAITeammates();
    return { teammates: normalizeAITeammates(stored), profile };
  } catch {
    return { teammates: readAITeammates(), profile: null };
  }
}

/**
 * 직원 목록을 저장한다. 프로필이 이미 있으면 다른 설정은 그대로 두고 직원 목록과
 * (지정한 경우) 대화 화면에서 먼저 열 직원만 바꾼다. 프로필이 아직 없으면 화면 저장분만
 * 바꾸고, 대화 화면이 처음 열릴 때 기존 규칙대로 프로필을 만든다.
 */
export async function saveCrewRoster(
  teammates: AITeammate[],
  profile: LocalMemoryAppProfile | null,
  activeTeammateId?: string,
): Promise<LocalMemoryAppProfile | null> {
  const normalized = normalizeAITeammates(teammates);
  saveAITeammates(normalized);
  if (!profile) return null;
  const nextProfile: LocalMemoryAppProfile = {
    ...profile,
    version: profile.version ?? 1,
    updatedAt: new Date().toISOString(),
    teammates: normalized,
    appSettings: {
      ...(profile.appSettings ?? {}),
      ...(activeTeammateId ? { activeTeammateId } : {}),
    },
  };
  const result = await createDesktopBridge().saveAppProfile(nextProfile);
  return result.profile ?? nextProfile;
}

// ── 역할 정본 ──────────────────────────────────────────────────────────────

/** 직무의 역할 정본(도구·연결·승인·첫 업무·업무 레시피). 정본에 없으면 직접 만든 직원 기본값. */
export function crewJobCapability(job: Pick<CrewJob, "id">): ModyRoleCapability {
  return getRoleCapability(job.id) ?? resolveTeammateRoleCapability(null);
}

/** 고용했거나 직접 만든 직원의 역할 정본. 기본 전문가 판정은 도메인 getBuiltinExpert 와 같다. */
export function teammateRoleCapability(
  teammate: Pick<AITeammate, "id" | "builtinExpertId" | "templateId" | "workPackIds"> | null | undefined,
): ModyRoleCapability {
  return resolveTeammateRoleCapability(teammate);
}

// ── 연결 상태 ──────────────────────────────────────────────────────────────

export type CrewConnectionId = ModyRoleConnectionId;
export type CrewConnectionStatus = ModyRoleConnectionStatus;
export type CrewConnectionState = Record<CrewConnectionId, CrewConnectionStatus>;

export const unknownCrewConnectionState: Readonly<CrewConnectionState> = Object.freeze({
  mail: "unknown",
  calendar: "unknown",
  drive: "unknown",
  ai: "unknown",
});

export const crewConnectionStatusLabels: Readonly<Record<CrewConnectionStatus, string>> = Object.freeze({
  connected: "연결됨",
  missing: "연결 안 됨",
  unknown: "확인 전",
});

export const crewConnectionShortLabels: Readonly<Record<CrewConnectionId, string>> = Object.freeze({
  mail: "메일",
  calendar: "캘린더",
  drive: "구글 드라이브",
  ai: "AI 답변",
});

// 기존 연결 화면 경로. 메일·AI 는 한 가지 설정만 여는 화면, 캘린더·드라이브는 해당 연결창을 바로 연다.
const crewConnectionRoutes: Readonly<Record<CrewConnectionId, string>> = Object.freeze({
  mail: "/connect?singleSetting=mail-calendar",
  calendar: "/connect?open=google-calendar",
  drive: "/connect?open=google-drive",
  ai: "/connect?singleSetting=codex-oauth",
});

export function crewConnectionRoute(id: CrewConnectionId, goal?: string): string {
  const base = crewConnectionRoutes[id];
  const text = String(goal ?? "").replace(/\s+/gu, " ").trim().slice(0, 60);
  return text ? base + "&goal=" + encodeURIComponent(text) : base;
}

const blockedConnectorRecoveryKinds = new Set(["install_required", "permission_required", "credential_failed", "connection_required"]);

/** 대화 화면(page.tsx)의 연결 판정과 같은 기준. 확인 중·만료·권한 필요는 연결로 보지 않는다. */
function isReadyConnectorRecord(record: ConnectorStatusRecord): boolean {
  if (record.recovery?.kind && blockedConnectorRecoveryKinds.has(record.recovery.kind)) return false;
  const status = String(record.status ?? "").toLowerCase();
  if (status === "site_login_stored") return false;
  if (/missing|unavailable|failed|invalid|required|not_connected|blocked|denied|expired|authorization|consent|callback|pending|started|in_progress|action_required|waiting/u.test(status)) {
    return false;
  }
  return /connected|ready|loaded|stored|token_exchanged|context_ready|verified/u.test(status);
}

function connectorKinds(record: ConnectorStatusRecord): Array<"mail" | "calendar" | "drive"> {
  const text = [record.category, record.connectorId, record.method, record.siteLabel, record.siteHost]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const kinds: Array<"mail" | "calendar" | "drive"> = [];
  const isCalendar = /calendar|caldav|freebusy|schedule/u.test(text);
  if (isCalendar) kinds.push("calendar");
  if (/drive|onedrive|sharepoint|dropbox/u.test(text)) kinds.push("drive");
  if (!isCalendar && /mail|gmail|outlook|imap|smtp|inbox|exchange/u.test(text)) kinds.push("mail");
  return kinds;
}

/** 대화 화면의 AI 연결 판정과 같은 기준(코덱스 로그인·저장 키·로컬 모델·구독). */
function isReadyAIProvider(provider: AIProviderKeyStatus): boolean {
  const id = provider.provider ?? "";
  if (id === "codex_oauth") return provider.status === "codex_oauth_ready" && Boolean(provider.hasLocalKey);
  if (id === "openai" || id === "gemini" || id === "anthropic") return Boolean(provider.hasLocalKey) && provider.chatContentAllowed === true;
  if (id === "local") return provider.isActive === true;
  if (id.endsWith("_subscription")) return provider.isActive === true && provider.modelAvailability?.state === "available";
  return false;
}

async function readCrewConnectionState(): Promise<CrewConnectionState> {
  const state: CrewConnectionState = { ...unknownCrewConnectionState };
  let bridge: ReturnType<typeof createDesktopBridge>;
  try {
    bridge = createDesktopBridge();
  } catch {
    return state;
  }
  // 브라우저 미리보기에는 이 PC 의 연결 정보가 없다. '연결 안 됨'으로 단정하지 않고 확인 전으로 둔다.
  if (!bridge.isAvailable) return state;
  const [connectors, ai, drive] = await Promise.allSettled([
    bridge.listConnectorStatuses(),
    bridge.getAIProviderStatus(),
    bridge.googleDriveFiles({ kind: "status" }),
  ]);
  if (connectors.status === "fulfilled") {
    const records = Array.isArray(connectors.value.connectors) ? connectors.value.connectors : [];
    const ready = new Set<string>();
    const unconfirmed = new Set<string>();
    for (const record of records) {
      if (String(record.status ?? "").toLowerCase() === "site_login_stored") {
        for (const kind of connectorKinds(record)) unconfirmed.add(kind);
        continue;
      }
      if (!isReadyConnectorRecord(record)) continue;
      for (const kind of connectorKinds(record)) ready.add(kind);
    }
    state.mail = ready.has("mail") ? "connected" : unconfirmed.has("mail") ? "unknown" : "missing";
    state.calendar = ready.has("calendar") ? "connected" : unconfirmed.has("calendar") ? "unknown" : "missing";
    if (ready.has("drive")) state.drive = "connected";
  }
  if (state.drive !== "connected" && drive.status === "fulfilled" && drive.value?.status) {
    state.drive = drive.value.connected === true ? "connected" : "missing";
  }
  if (ai.status === "fulfilled") {
    const providers = Array.isArray(ai.value.providers) ? ai.value.providers : [];
    state.ai = providers.some(isReadyAIProvider) ? "connected" : "missing";
  }
  return state;
}

let crewConnectionStateCache: { at: number; promise: Promise<CrewConnectionState> } | null = null;

/** 메일·캘린더·드라이브·AI 연결 상태. 채용 화면과 직원 설정이 같이 열려도 5초 안에는 한 번만 묻는다. */
export function loadCrewConnectionState(options: { force?: boolean } = {}): Promise<CrewConnectionState> {
  const now = Date.now();
  if (!options.force && crewConnectionStateCache && now - crewConnectionStateCache.at < 5_000) {
    return crewConnectionStateCache.promise;
  }
  const promise = readCrewConnectionState().catch(() => ({ ...unknownCrewConnectionState }));
  crewConnectionStateCache = { at: now, promise };
  return promise;
}

// ── 첫 업무 전달 ────────────────────────────────────────────────────────────
// 첫 업무 버튼은 기존처럼 /?teammate=…&fresh=1 로 새 대화를 연다. 고른 요청은 30분 동안 기억해
// 직원 소개의 예시 요청 맨 앞에 보이고(누르면 입력칸에 채워짐), 대화 화면이 원하면 consume 해서 바로 채울 수 있다.

const crewFirstTaskStorageKey = "modycrew.crew.firstTask.v1";
const crewFirstTaskTtlMs = 30 * 60 * 1000;

type StoredCrewFirstTask = { teammateId: string; prompt: string; at: number };

function readStoredCrewFirstTask(): StoredCrewFirstTask | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(crewFirstTaskStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredCrewFirstTask>;
    if (typeof parsed.teammateId !== "string" || typeof parsed.prompt !== "string" || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > crewFirstTaskTtlMs) return null;
    return { teammateId: parsed.teammateId, prompt: parsed.prompt, at: parsed.at };
  } catch {
    return null;
  }
}

export function rememberCrewFirstTask(teammateId: string, prompt: string): void {
  if (typeof window === "undefined") return;
  const text = String(prompt ?? "").replace(/\s+/gu, " ").trim().slice(0, 300);
  if (!teammateId || !text) return;
  try {
    window.sessionStorage.setItem(crewFirstTaskStorageKey, JSON.stringify({ teammateId, prompt: text, at: Date.now() }));
  } catch {
    // 저장소를 못 쓰면 예시 요청 기본 순서로 보인다.
  }
}

/** 채용 화면·직원 설정에서 고른 첫 업무(30분 안). 읽기만 한다. */
export function readCrewFirstTask(teammateId: string): string | null {
  const stored = readStoredCrewFirstTask();
  return stored && stored.teammateId === teammateId ? stored.prompt : null;
}

/** 대화 화면이 입력칸에 채운 뒤 지울 때 쓴다. */
export function consumeCrewFirstTask(teammateId: string): string | null {
  const prompt = readCrewFirstTask(teammateId);
  if (prompt && typeof window !== "undefined") {
    try {
      window.sessionStorage.removeItem(crewFirstTaskStorageKey);
    } catch {
      // 지우지 못해도 30분 뒤에는 무시된다.
    }
  }
  return prompt;
}

export function crewFirstTaskPath(teammateId: string): string {
  return "/?teammate=" + encodeURIComponent(teammateId) + "&fresh=1";
}

