export type ModyGoogleCalendarLiveStatus =
  | "needs_credentials"
  | "freebusy_loaded"
  | "google_calendar_api_failed";

export type ModyGoogleCalendarLiveAction = "query_freebusy";

export type ModyGoogleCalendarBusyWindow = {
  calendarId: string;
  startsAt: string;
  endsAt: string;
};

export type ModyGoogleCalendarLiveInput = {
  accessToken?: string;
  calendarIds?: string[];
  timeMin?: string;
  timeMax?: string;
  timeZone?: string;
};

export type ModyGoogleCalendarLiveResult = {
  status: ModyGoogleCalendarLiveStatus;
  providerId: "google_calendar";
  action: ModyGoogleCalendarLiveAction;
  externalMutation: false;
  appMayPersistSecret: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  endpoint: "https://www.googleapis.com/calendar/v3/freeBusy";
  calendarIds?: string[];
  timeMin?: string;
  timeMax?: string;
  timeZone?: string;
  busyWindows?: ModyGoogleCalendarBusyWindow[];
  calendarErrors?: Record<string, string[]>;
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

type GoogleFreeBusyResponse = {
  kind?: string;
  timeMin?: string;
  timeMax?: string;
  calendars?: Record<string, {
    busy?: Array<{ start?: string; end?: string }>;
    errors?: Array<{ domain?: string; reason?: string }>;
  }>;
  error?: {
    message?: string;
    status?: string;
  };
};

export class ModyGoogleCalendarLiveConnector {
  private readonly fetchImpl: FetchLike;
  private readonly endpoint: "https://www.googleapis.com/calendar/v3/freeBusy";
  private readonly now: () => Date;

  constructor(options: {
    fetch?: FetchLike;
    now?: () => Date;
  } = {}) {
    const fetchImpl = options.fetch ?? (globalThis as unknown as { fetch?: FetchLike }).fetch;
    if (!fetchImpl) {
      throw new Error("fetch runtime is required for Google Calendar live connector");
    }
    this.fetchImpl = fetchImpl as FetchLike;
    this.endpoint = "https://www.googleapis.com/calendar/v3/freeBusy";
    this.now = options.now ?? (() => new Date());
  }

  async queryFreeBusy(input: ModyGoogleCalendarLiveInput): Promise<ModyGoogleCalendarLiveResult> {
    const accessToken = sanitizeAccessToken(input.accessToken);
    if (!accessToken) {
      return needsCredentials("Google Calendar OAuth access token이 필요합니다.");
    }

    const calendarIds = sanitizeCalendarIds(input.calendarIds);
    const timeMin = sanitizeDateTime(input.timeMin) ?? this.now().toISOString();
    const timeMax = sanitizeDateTime(input.timeMax) ?? new Date(this.now().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const timeZone = sanitizeTimeZone(input.timeZone);

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timeMin,
          timeMax,
          timeZone,
          items: calendarIds.map((id) => ({ id })),
        }),
      });
      const json = await response.json().catch(() => ({})) as GoogleFreeBusyResponse;
      if (!response.ok) {
        return apiFailure(
          "Google Calendar freeBusy 호출에 실패했습니다.",
          redactGoogleCalendarToken(json.error?.message ?? response.statusText, [accessToken]),
          calendarIds,
          timeMin,
          timeMax,
          timeZone,
        );
      }

      const busyWindows = collectBusyWindows(json);
      const calendarErrors = collectCalendarErrors(json);
      return {
        status: "freebusy_loaded",
        providerId: "google_calendar",
        action: "query_freebusy",
        externalMutation: false,
        appMayPersistSecret: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
        endpoint: this.endpoint,
        calendarIds,
        timeMin,
        timeMax,
        timeZone,
        busyWindows,
        ...(Object.keys(calendarErrors).length > 0 ? { calendarErrors } : {}),
        userMessage: `Google Calendar freeBusy로 바쁜 시간 ${busyWindows.length}개를 읽었습니다.`,
        auditMessages: [
          "Google Calendar API POST /calendar/v3/freeBusy 호출 완료",
          "사용 scope는 calendar.readonly, calendar.events.freebusy, calendar.freebusy 같은 읽기/availability 권한을 전제로 합니다.",
          "일정 생성, 수정, 삭제는 실행하지 않았습니다.",
          "OAuth access token 원문은 결과, 로그, 리포트에 반환하지 않습니다.",
        ],
      };
    } catch (error) {
      return apiFailure(
        "Google Calendar freeBusy 네트워크 호출에 실패했습니다.",
        redactGoogleCalendarToken(error instanceof Error ? error.message : String(error), [accessToken]),
        calendarIds,
        timeMin,
        timeMax,
        timeZone,
      );
    }
  }
}

function needsCredentials(userMessage: string): ModyGoogleCalendarLiveResult {
  return {
    status: "needs_credentials",
    providerId: "google_calendar",
    action: "query_freebusy",
    externalMutation: false,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    endpoint: "https://www.googleapis.com/calendar/v3/freeBusy",
    userMessage,
    auditMessages: [
      "Google Calendar live connector needs OAuth access token",
      "access token 원문은 앱 결과에 반환하지 않습니다.",
    ],
  };
}

function apiFailure(
  userMessage: string,
  errorMessage: string,
  calendarIds: string[],
  timeMin: string,
  timeMax: string,
  timeZone: string,
): ModyGoogleCalendarLiveResult {
  return {
    status: "google_calendar_api_failed",
    providerId: "google_calendar",
    action: "query_freebusy",
    externalMutation: false,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    endpoint: "https://www.googleapis.com/calendar/v3/freeBusy",
    calendarIds,
    timeMin,
    timeMax,
    timeZone,
    userMessage,
    errorMessage,
    auditMessages: [
      "Google Calendar freeBusy live call failed before any mutation",
      "오류 메시지는 OAuth token-like 문자열을 마스킹한 뒤 반환합니다.",
    ],
  };
}

function collectBusyWindows(response: GoogleFreeBusyResponse): ModyGoogleCalendarBusyWindow[] {
  const calendars = response.calendars ?? {};
  const busyWindows: ModyGoogleCalendarBusyWindow[] = [];
  for (const [calendarId, calendar] of Object.entries(calendars)) {
    for (const busy of calendar.busy ?? []) {
      if (typeof busy.start === "string" && typeof busy.end === "string") {
        busyWindows.push({
          calendarId,
          startsAt: busy.start,
          endsAt: busy.end,
        });
      }
    }
  }
  return busyWindows;
}

function collectCalendarErrors(response: GoogleFreeBusyResponse): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const [calendarId, calendar] of Object.entries(response.calendars ?? {})) {
    const reasons = (calendar.errors ?? [])
      .map((error) => error.reason ?? error.domain ?? "")
      .filter(Boolean);
    if (reasons.length > 0) errors[calendarId] = reasons;
  }
  return errors;
}

function sanitizeAccessToken(value: unknown): string {
  const token = typeof value === "string" ? value.trim() : "";
  return token.length >= 20 && token.length <= 4096 ? token : "";
}

function sanitizeCalendarIds(value: unknown): string[] {
  const ids = Array.isArray(value) ? value : ["primary"];
  const normalized = ids
    .map((id) => (typeof id === "string" ? id.trim() : ""))
    .filter((id) => id.length > 0 && id.length <= 320 && !/[\r\n]/.test(id));
  return normalized.length > 0 ? [...new Set(normalized)].slice(0, 10) : ["primary"];
}

function sanitizeDateTime(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function sanitizeTimeZone(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_+./-]{1,64}$/.test(text) ? text : "Asia/Seoul";
}

export function redactGoogleCalendarToken(value: string, secrets: string[] = []): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join("[google-calendar-token-redacted]");
  }
  return redacted
    .replace(/\bya29\.[A-Za-z0-9._-]+\b/g, "[google-calendar-token-redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [google-calendar-token-redacted]");
}
