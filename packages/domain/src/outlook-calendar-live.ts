export type ModyOutlookCalendarLiveStatus =
  | "needs_credentials"
  | "freebusy_loaded"
  | "outlook_calendar_api_failed";

export type ModyOutlookCalendarLiveAction = "query_schedule";

export type ModyOutlookCalendarBusyWindow = {
  scheduleId: string;
  startsAt: string;
  endsAt: string;
  status: string;
};

export type ModyOutlookCalendarLiveInput = {
  accessToken?: string;
  scheduleIds?: string[];
  timeMin?: string;
  timeMax?: string;
  timeZone?: string;
};

export type ModyOutlookCalendarLiveResult = {
  status: ModyOutlookCalendarLiveStatus;
  providerId: "outlook_calendar";
  action: ModyOutlookCalendarLiveAction;
  externalMutation: false;
  appMayPersistSecret: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  endpoint: "https://graph.microsoft.com/v1.0/me/calendar/getSchedule";
  scheduleIds?: string[];
  timeMin?: string;
  timeMax?: string;
  timeZone?: string;
  busyWindows?: ModyOutlookCalendarBusyWindow[];
  scheduleErrors?: Record<string, string>;
  userMessage: string;
  errorMessage?: string;
  auditMessages: string[];
};

type FetchLikeResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
};

type FetchLike = (url: string, init: {
  method: "POST";
  headers: Record<string, string>;
  body: string;
}) => Promise<FetchLikeResponse>;

type GraphDateTime = {
  dateTime?: string;
  timeZone?: string;
};

type OutlookScheduleResponse = {
  value?: Array<{
    scheduleId?: string;
    error?: {
      message?: string;
      responseCode?: string;
    };
    scheduleItems?: Array<{
      status?: string;
      start?: GraphDateTime;
      end?: GraphDateTime;
    }>;
  }>;
  error?: {
    message?: string;
    code?: string;
  };
};

export class ModyOutlookCalendarLiveConnector {
  private readonly fetchImpl: FetchLike;
  private readonly endpoint: "https://graph.microsoft.com/v1.0/me/calendar/getSchedule";
  private readonly now: () => Date;

  constructor(options: {
    fetch?: FetchLike;
    now?: () => Date;
  } = {}) {
    const fetchImpl = options.fetch ?? (globalThis as unknown as { fetch?: FetchLike }).fetch;
    if (!fetchImpl) {
      throw new Error("fetch runtime is required for Outlook Calendar live connector");
    }
    this.fetchImpl = fetchImpl as FetchLike;
    this.endpoint = "https://graph.microsoft.com/v1.0/me/calendar/getSchedule";
    this.now = options.now ?? (() => new Date());
  }

  async querySchedule(input: ModyOutlookCalendarLiveInput): Promise<ModyOutlookCalendarLiveResult> {
    const accessToken = sanitizeAccessToken(input.accessToken);
    if (!accessToken) {
      return needsCredentials("Outlook Calendar OAuth access token이 필요합니다.");
    }

    const scheduleIds = sanitizeScheduleIds(input.scheduleIds);
    const timeMin = sanitizeDateTime(input.timeMin) ?? this.now().toISOString();
    const timeMax =
      sanitizeDateTime(input.timeMax) ??
      new Date(this.now().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const timeZone = sanitizeTimeZone(input.timeZone);

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          schedules: scheduleIds,
          startTime: {
            dateTime: toGraphLocalDateTime(timeMin),
            timeZone,
          },
          endTime: {
            dateTime: toGraphLocalDateTime(timeMax),
            timeZone,
          },
          availabilityViewInterval: 30,
        }),
      });
      const json = await response.json().catch(() => ({})) as OutlookScheduleResponse;
      if (!response.ok) {
        return apiFailure(
          "Outlook Calendar getSchedule 호출에 실패했습니다.",
          redactOutlookCalendarToken(json.error?.message ?? response.statusText, [accessToken]),
          scheduleIds,
          timeMin,
          timeMax,
          timeZone,
        );
      }

      const busyWindows = collectBusyWindows(json);
      const scheduleErrors = collectScheduleErrors(json);
      return {
        status: "freebusy_loaded",
        providerId: "outlook_calendar",
        action: "query_schedule",
        externalMutation: false,
        appMayPersistSecret: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
        endpoint: this.endpoint,
        scheduleIds,
        timeMin,
        timeMax,
        timeZone,
        busyWindows,
        ...(Object.keys(scheduleErrors).length > 0 ? { scheduleErrors } : {}),
        userMessage: `Outlook Calendar getSchedule로 바쁜 시간 ${busyWindows.length}개를 읽었습니다.`,
        auditMessages: [
          "Microsoft Graph POST /me/calendar/getSchedule 호출 완료",
          "사용 scope는 Calendars.ReadBasic, Calendars.Read 같은 읽기/availability 권한을 전제로 합니다.",
          "일정 생성, 수정, 삭제는 실행하지 않았습니다.",
          "OAuth access token 원문은 결과, 로그, 리포트에 반환하지 않습니다.",
        ],
      };
    } catch (error) {
      return apiFailure(
        "Outlook Calendar getSchedule 네트워크 호출에 실패했습니다.",
        redactOutlookCalendarToken(error instanceof Error ? error.message : String(error), [accessToken]),
        scheduleIds,
        timeMin,
        timeMax,
        timeZone,
      );
    }
  }
}

function needsCredentials(userMessage: string): ModyOutlookCalendarLiveResult {
  return {
    status: "needs_credentials",
    providerId: "outlook_calendar",
    action: "query_schedule",
    externalMutation: false,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    endpoint: "https://graph.microsoft.com/v1.0/me/calendar/getSchedule",
    userMessage,
    auditMessages: [
      "Outlook Calendar live connector needs OAuth access token",
      "access token 원문은 앱 결과에 반환하지 않습니다.",
    ],
  };
}

function apiFailure(
  userMessage: string,
  errorMessage: string,
  scheduleIds: string[],
  timeMin: string,
  timeMax: string,
  timeZone: string,
): ModyOutlookCalendarLiveResult {
  return {
    status: "outlook_calendar_api_failed",
    providerId: "outlook_calendar",
    action: "query_schedule",
    externalMutation: false,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    endpoint: "https://graph.microsoft.com/v1.0/me/calendar/getSchedule",
    scheduleIds,
    timeMin,
    timeMax,
    timeZone,
    userMessage,
    errorMessage,
    auditMessages: [
      "Outlook Calendar getSchedule live call failed before any mutation",
      "오류 메시지는 OAuth token-like 문자열을 마스킹한 뒤 반환합니다.",
    ],
  };
}

function collectBusyWindows(response: OutlookScheduleResponse): ModyOutlookCalendarBusyWindow[] {
  const windows: ModyOutlookCalendarBusyWindow[] = [];
  for (const schedule of response.value ?? []) {
    const scheduleId = sanitizeScheduleId(schedule.scheduleId) || "me";
    for (const item of schedule.scheduleItems ?? []) {
      const status = sanitizeStatus(item.status);
      if (status === "free" || status === "unknown") continue;
      const startsAt = normalizeGraphDateTime(item.start);
      const endsAt = normalizeGraphDateTime(item.end);
      if (!startsAt || !endsAt) continue;
      windows.push({
        scheduleId,
        startsAt,
        endsAt,
        status,
      });
    }
  }
  return windows;
}

function collectScheduleErrors(response: OutlookScheduleResponse): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const schedule of response.value ?? []) {
    const scheduleId = sanitizeScheduleId(schedule.scheduleId) || "me";
    const message = schedule.error?.message ?? schedule.error?.responseCode ?? "";
    if (message) errors[scheduleId] = message.slice(0, 240);
  }
  return errors;
}

function sanitizeAccessToken(value: unknown): string {
  const token = typeof value === "string" ? value.trim() : "";
  return token.length >= 20 && token.length <= 4096 ? token : "";
}

function sanitizeScheduleIds(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : ["me"];
  const normalized = raw
    .map((id) => sanitizeScheduleId(id))
    .filter(Boolean);
  return normalized.length > 0 ? [...new Set(normalized)].slice(0, 10) : ["me"];
}

function sanitizeScheduleId(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 && text.length <= 320 && !/[\r\n]/.test(text) ? text : "";
}

function sanitizeDateTime(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function sanitizeTimeZone(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_+ ./-]{1,80}$/.test(text) ? text : "Asia/Seoul";
}

function sanitizeStatus(value: unknown): string {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z_ -]{1,40}$/.test(text) ? text : "unknown";
}

function toGraphLocalDateTime(value: string): string {
  return value.replace(/\.\d{3}Z$/, "").replace(/Z$/, "");
}

function normalizeGraphDateTime(value: GraphDateTime | undefined): string {
  const text = typeof value?.dateTime === "string" ? value.dateTime.trim() : "";
  if (!text) return "";
  const date = new Date(text.endsWith("Z") || /[+-]\d\d:\d\d$/.test(text) ? text : `${text}Z`);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

export function redactOutlookCalendarToken(value: string, secrets: string[] = []): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join("[outlook-calendar-token-redacted]");
  }
  return redacted
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [outlook-calendar-token-redacted]")
    .replace(/\bEw[A-Za-z0-9._~+/=-]{20,}\b/g, "[outlook-calendar-token-redacted]");
}
