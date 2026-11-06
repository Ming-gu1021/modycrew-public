import type { ISODateTimeString, ToolRiskLabel, WorkItemStatus } from "./types.js";

export type ModyScheduleBriefingCadence =
  | "daily_weekly_briefing"
  | "deadline_critical_15m"
  | "deadline_urgent_30m"
  | "deadline_soon_2h"
  | "meeting_day_before"
  | "meeting_3h_before"
  | "meeting_30m_before"
  | "relaxed_daily";

export type ModyScheduleBriefingItem = {
  id: string;
  title: string;
  summary?: string;
  body?: string;
  sourceLabel?: string;
  senderLabel?: string;
  status?: WorkItemStatus | string;
  riskLabel?: ToolRiskLabel | string;
  receivedAt?: ISODateTimeString;
  dueAt?: ISODateTimeString;
  deadlineAt?: ISODateTimeString;
  sourceEvidence?: {
    providerId?: string;
    messageSubject?: string;
    senderPreview?: string;
    replyToLabel?: string;
    mailThreadLabel?: string;
    draftPreview?: string;
    messageSnippet?: string;
    calendarCandidateText?: string;
    calendarTimeRangeLabel?: string;
    calendarStartsAt?: ISODateTimeString;
    calendarEndsAt?: ISODateTimeString;
    calendarAttendeeLabels?: string[];
    calendarLocationLabel?: string;
    calendarReminderLabel?: string;
    calendarConflictLabel?: string;
    scheduleWindowLabel?: string;
  };
  schedules?: {
    id?: string;
    label?: string;
    startsAt?: ISODateTimeString;
    endsAt?: ISODateTimeString;
  }[];
};

export type ModyScheduleBriefingAnchorKind = "deadline" | "meeting" | "follow_up";

export type ModyScheduleBriefingAnchor = {
  id: string;
  workItemId: string;
  title: string;
  sourceLabel: string;
  kind: ModyScheduleBriefingAnchorKind;
  startsAt: ISODateTimeString;
  endsAt?: ISODateTimeString;
  minutesRemaining: number;
  urgency: "critical" | "soon" | "today" | "week" | "relaxed";
  cadence: ModyScheduleBriefingCadence;
  nextReminderAt: ISODateTimeString;
  reminderLabel: string;
  contextLabel?: string;
  attentionLevel: "interrupt" | "attention" | "digest";
  userMessage: string;
};

export type ModyScheduleBriefingDateConfirmationItem = {
  id: string;
  workItemId: string;
  title: string;
  sourceLabel: string;
  sourceText: string;
  reason: string;
  userMessage: string;
};

export type ModyScheduleBriefingNotificationPlan = {
  cadence: ModyScheduleBriefingCadence;
  label: string;
  reason: string;
  nextCheckHintMinutes: number;
  nextCheckAt: ISODateTimeString;
  attentionLevel: "interrupt" | "attention" | "digest";
  itemCount: number;
};

export type ModyScheduleBriefingReport = {
  id: string;
  status: "schedule_briefing_ready" | "schedule_briefing_quiet";
  createdAt: ISODateTimeString;
  horizonEndsAt: ISODateTimeString;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  todayFocusItems: ModyScheduleBriefingAnchor[];
  urgentDeadlineItems: ModyScheduleBriefingAnchor[];
  meetingReminders: ModyScheduleBriefingAnchor[];
  weeklyTimeline: ModyScheduleBriefingAnchor[];
  dateConfirmationItems: ModyScheduleBriefingDateConfirmationItem[];
  relaxedItems: ModyScheduleBriefingItem[];
  notificationPlan: ModyScheduleBriefingNotificationPlan[];
  briefingText: string;
  userMessage: string;
  safetyBoundary: string;
};

export type ModyScheduleBriefingInput = {
  workItems: ModyScheduleBriefingItem[];
  createdAt?: ISODateTimeString;
  horizonDays?: number;
};

export type ModyKoreanBusinessDateParseResult = {
  status: "parsed" | "ambiguous" | "not_found";
  iso?: ISODateTimeString;
  sourceText?: string;
  reason?: string;
  question?: string;
  confidence: "none" | "low" | "medium" | "high";
};

type PlannerOptions = {
  now?: () => Date;
};

export class ModyWorkScheduleBriefingPlanner {
  private readonly now: () => Date;

  constructor(options: PlannerOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  createReport(input: ModyScheduleBriefingInput): ModyScheduleBriefingReport {
    const createdAt = input.createdAt ?? this.now().toISOString();
    const now = new Date(createdAt);
    const horizonEndsAt = addDays(now, Math.max(Number(input.horizonDays ?? 7) || 7, 1)).toISOString();
    const anchors = input.workItems
      .flatMap((item) => createAnchors(item, now))
      .filter((anchor) => anchor.minutesRemaining >= -30)
      .sort((a, b) => a.minutesRemaining - b.minutesRemaining);
    const dateConfirmationItems = input.workItems
      .flatMap((item) => createDateConfirmationItems(item, now))
      .filter((item) => !anchors.some((anchor) => anchor.workItemId === item.workItemId))
      .slice(0, 8);
    const todayFocusItems = anchors.filter((anchor) => isSameLocalDate(anchor.startsAt, createdAt));
    const urgentDeadlineItems = anchors.filter(
      (anchor) =>
        anchor.kind === "deadline" &&
        anchor.minutesRemaining >= 0 &&
        anchor.minutesRemaining <= 24 * 60,
    );
    const meetingReminders = anchors.filter(
      (anchor) =>
        anchor.kind === "meeting" &&
        anchor.minutesRemaining >= 0 &&
        anchor.minutesRemaining <= 24 * 60,
    );
    const weeklyTimeline = anchors.filter(
      (anchor) =>
        anchor.minutesRemaining >= 0 &&
        new Date(anchor.startsAt).getTime() <= new Date(horizonEndsAt).getTime(),
    );
    const anchoredIds = new Set(anchors.map((anchor) => anchor.workItemId));
    const dateConfirmationIds = new Set(dateConfirmationItems.map((item) => item.workItemId));
    const relaxedItems = input.workItems
      .filter((item) => !anchoredIds.has(item.id))
      .filter((item) => !dateConfirmationIds.has(item.id))
      .filter((item) => !["completed", "rejected"].includes(String(item.status ?? "")))
      .slice(0, 8);
    const notificationPlan = createNotificationPlan(
      {
        urgentDeadlineItems,
        meetingReminders,
        weeklyTimeline,
        relaxedItems,
      },
      now,
    );
    const status =
      todayFocusItems.length > 0 ||
      urgentDeadlineItems.length > 0 ||
      meetingReminders.length > 0 ||
      weeklyTimeline.length > 0 ||
      dateConfirmationItems.length > 0 ||
      relaxedItems.length > 0
        ? "schedule_briefing_ready"
        : "schedule_briefing_quiet";
    const briefingText = renderBriefing({
      createdAt,
      todayFocusItems,
      urgentDeadlineItems,
      meetingReminders,
      weeklyTimeline,
      dateConfirmationItems,
      relaxedItems,
      notificationPlan,
    });

    return {
      id: `work_schedule_briefing_${compactDate(createdAt)}`,
      status,
      createdAt,
      horizonEndsAt,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
      todayFocusItems,
      urgentDeadlineItems,
      meetingReminders,
      weeklyTimeline,
      dateConfirmationItems,
      relaxedItems,
      notificationPlan,
      briefingText,
      userMessage:
        status === "schedule_briefing_ready"
          ? `오늘 집중 ${todayFocusItems.length}건, 마감 임박 ${urgentDeadlineItems.length}건, 미팅 알림 ${meetingReminders.length}건, 1주일 일정 ${weeklyTimeline.length}건, 날짜 확인 필요 ${dateConfirmationItems.length}건을 정리했습니다.`
          : "알려줄 마감이나 일정이 아직 없습니다.",
      safetyBoundary:
        "일정 브리핑은 읽기 전용 업무 현황 카드만 만들며 메일 발송, 캘린더 등록, 외부 메시지 전송을 실행하지 않습니다.",
    };
  }
}

function createAnchors(item: ModyScheduleBriefingItem, now: Date): ModyScheduleBriefingAnchor[] {
  const anchors: ModyScheduleBriefingAnchor[] = [];
  const sourceLabel = clean(item.sourceLabel ?? "업무 인박스", 80) || "업무 인박스";
  const title = clean(item.title, 120) || "업무";
  const evidence = normalizeSourceEvidence(item.sourceEvidence);
  const textCandidates = [
    item.summary,
    item.body,
    evidence.messageSubject,
    evidence.messageSnippet,
    evidence.calendarCandidateText,
    evidence.scheduleWindowLabel,
  ];
  const deadline = firstIso(
    item.deadlineAt,
    item.dueAt,
    ...textCandidates.flatMap((text) => [
      findIsoLikeDate(text),
      parseKoreanBusinessDateExpression(text, now).iso,
    ]),
  );

  if (deadline) {
    const minutesRemaining = diffMinutes(deadline, now);
    const cadence = deadlineCadence(minutesRemaining);
    const contextLabel = createDeadlineContextLabel(evidence);
    anchors.push({
      id: `${item.id}:deadline`,
      workItemId: item.id,
      title,
      sourceLabel,
      kind: "deadline",
      startsAt: deadline,
      minutesRemaining,
      urgency: urgencyFor(minutesRemaining),
      cadence,
      nextReminderAt: nextReminderIso(now, minutesRemaining, cadence),
      reminderLabel: reminderLabelFor(cadence),
      attentionLevel: attentionLevelFor(cadence),
      userMessage: deadlineMessage(title, minutesRemaining),
      ...(contextLabel ? { contextLabel } : {}),
    });
  }

  const schedules = createScheduleCandidates(item, evidence, title);
  for (const [index, schedule] of schedules.entries()) {
    if (!schedule?.startsAt || !isValidDate(schedule.startsAt)) continue;
    const minutesRemaining = diffMinutes(schedule.startsAt, now);
    const cadence = meetingCadence(minutesRemaining, evidence);
    const contextLabel = createMeetingContextLabel(evidence);
    anchors.push({
      id: schedule.id ?? `${item.id}:meeting:${index}`,
      workItemId: item.id,
      title: clean(schedule.label ?? title, 120) || title,
      sourceLabel,
      kind: "meeting",
      startsAt: schedule.startsAt,
      ...(schedule.endsAt ? { endsAt: schedule.endsAt } : {}),
      minutesRemaining,
      urgency: urgencyFor(minutesRemaining),
      cadence,
      nextReminderAt: nextReminderIso(now, minutesRemaining, cadence),
      reminderLabel: reminderLabelFor(cadence),
      ...(contextLabel ? { contextLabel } : {}),
      attentionLevel: attentionLevelFor(cadence),
      userMessage: meetingMessage(clean(schedule.label ?? title, 120) || title, minutesRemaining),
    });
  }

  return anchors;
}

function createDateConfirmationItems(
  item: ModyScheduleBriefingItem,
  now: Date,
): ModyScheduleBriefingDateConfirmationItem[] {
  if (["completed", "rejected"].includes(String(item.status ?? ""))) return [];

  const sourceLabel = clean(item.sourceLabel ?? "업무 인박스", 80) || "업무 인박스";
  const title = clean(item.title, 120) || "업무";
  const evidence = normalizeSourceEvidence(item.sourceEvidence);
  const candidates = [
    parseKoreanBusinessDateExpression(item.summary, now),
    parseKoreanBusinessDateExpression(item.body, now),
    parseKoreanBusinessDateExpression(evidence.messageSnippet, now),
    parseKoreanBusinessDateExpression(evidence.calendarCandidateText, now),
    parseKoreanBusinessDateExpression(evidence.scheduleWindowLabel, now),
  ].filter((result) => result.status === "ambiguous");

  return candidates
    .filter((candidate, index, list) =>
      list.findIndex((other) => other.sourceText === candidate.sourceText) === index,
    )
    .map((candidate, index) => ({
      id: `${item.id}:date-confirmation:${index}`,
      workItemId: item.id,
      title,
      sourceLabel,
      sourceText: clean(candidate.sourceText, 160),
      reason: clean(candidate.reason, 160) || "날짜 또는 시간 범위가 확정되지 않았습니다.",
      userMessage:
        clean(candidate.question, 180) ||
        `${title}의 일정 표현을 확정해야 알림 시각을 잡을 수 있습니다.`,
    }));
}

function createNotificationPlan(input: {
  urgentDeadlineItems: ModyScheduleBriefingAnchor[];
  meetingReminders: ModyScheduleBriefingAnchor[];
  weeklyTimeline: ModyScheduleBriefingAnchor[];
  relaxedItems: ModyScheduleBriefingItem[];
}, now: Date): ModyScheduleBriefingNotificationPlan[] {
  const plans: ModyScheduleBriefingNotificationPlan[] = [
    withNextCheck(now, {
      cadence: "daily_weekly_briefing",
      label: "매일 1주일 브리핑",
      reason: "앞으로 7일의 일정과 마감을 매일 한 번 정리합니다.",
      nextCheckHintMinutes: 1440,
      attentionLevel: "digest",
      itemCount: input.weeklyTimeline.length,
    }),
  ];

  const criticalDeadlines = input.urgentDeadlineItems.filter((item) => item.minutesRemaining <= 60);
  if (criticalDeadlines.length > 0) {
    plans.push(withNextCheck(now, {
      cadence: "deadline_critical_15m",
      label: "마감 1시간 이내 15분 단위 확인",
      reason: "진짜 마감이 얼마 남지 않은 업무는 놓치지 않게 아주 촘촘히 확인합니다.",
      nextCheckHintMinutes: 15,
      attentionLevel: "interrupt",
      itemCount: criticalDeadlines.length,
    }));
  }

  const urgentDeadlines = input.urgentDeadlineItems.filter(
    (item) => item.minutesRemaining > 60 && item.minutesRemaining <= 6 * 60,
  );
  if (urgentDeadlines.length > 0) {
    plans.push(withNextCheck(now, {
      cadence: "deadline_urgent_30m",
      label: "마감 임박 30분 단위 확인",
      reason: "6시간 이내 마감은 사용자가 놓치지 않게 더 자주 확인합니다.",
      nextCheckHintMinutes: 30,
      attentionLevel: "interrupt",
      itemCount: urgentDeadlines.length,
    }));
  }

  const soonDeadlines = input.urgentDeadlineItems.filter((item) => item.minutesRemaining > 6 * 60);
  if (soonDeadlines.length > 0) {
    plans.push(withNextCheck(now, {
      cadence: "deadline_soon_2h",
      label: "24시간 이내 마감 2시간 단위 확인",
      reason: "오늘 또는 내일 마감은 지나치게 자주 방해하지 않으면서 추적합니다.",
      nextCheckHintMinutes: 120,
      attentionLevel: "attention",
      itemCount: soonDeadlines.length,
    }));
  }

  const meetings30m = input.meetingReminders.filter((item) => item.cadence === "meeting_30m_before");
  if (meetings30m.length > 0) {
    plans.push(withNextCheck(now, {
      cadence: "meeting_30m_before",
      label: "미팅 30분 전 최종 알림",
      reason: "곧 시작하는 미팅은 링크, 자료, 이동 준비를 바로 확인해야 합니다.",
      nextCheckHintMinutes: 15,
      attentionLevel: "interrupt",
      itemCount: meetings30m.length,
    }));
  }

  const meetings3h = input.meetingReminders.filter((item) => item.cadence === "meeting_3h_before");
  if (meetings3h.length > 0) {
    plans.push(withNextCheck(now, {
      cadence: "meeting_3h_before",
      label: "미팅 3시간 전 알림",
      reason: "자료 준비와 이동 시간을 확보해야 하는 미팅입니다.",
      nextCheckHintMinutes: 60,
      attentionLevel: "attention",
      itemCount: meetings3h.length,
    }));
  }

  const meetingsTomorrow = input.meetingReminders.filter((item) => item.cadence === "meeting_day_before");
  if (meetingsTomorrow.length > 0) {
    plans.push(withNextCheck(now, {
      cadence: "meeting_day_before",
      label: "미팅 하루 전 알림",
      reason: "내일 또는 24시간 이내 미팅을 미리 알려줍니다.",
      nextCheckHintMinutes: 180,
      attentionLevel: "digest",
      itemCount: meetingsTomorrow.length,
    }));
  }

  if (input.relaxedItems.length > 0) {
    plans.push(withNextCheck(now, {
      cadence: "relaxed_daily",
      label: "널널한 업무는 하루 요약",
      reason: "급하지 않은 업무는 몰아서 보여줘 방해를 줄입니다.",
      nextCheckHintMinutes: 1440,
      attentionLevel: "digest",
      itemCount: input.relaxedItems.length,
    }));
  }

  return plans;
}

function renderBriefing(input: {
  createdAt: ISODateTimeString;
  todayFocusItems: ModyScheduleBriefingAnchor[];
  urgentDeadlineItems: ModyScheduleBriefingAnchor[];
  meetingReminders: ModyScheduleBriefingAnchor[];
  weeklyTimeline: ModyScheduleBriefingAnchor[];
  dateConfirmationItems: ModyScheduleBriefingDateConfirmationItem[];
  relaxedItems: ModyScheduleBriefingItem[];
  notificationPlan: ModyScheduleBriefingNotificationPlan[];
}): string {
  const lines = [
    "ModyCrew 일정 브리핑",
    "",
    `기준 시각: ${formatKoreanTime(input.createdAt)}`,
    "",
    "오늘 집중",
    ...renderAnchorLines(input.todayFocusItems, "오늘 꼭 볼 업무가 없습니다."),
    "",
    "마감 임박",
    ...renderAnchorLines(input.urgentDeadlineItems, "24시간 이내 마감은 없습니다."),
    "",
    "미팅 알림",
    ...renderAnchorLines(input.meetingReminders, "24시간 이내 미팅은 없습니다."),
    "",
    "앞으로 1주일",
    ...renderAnchorLines(input.weeklyTimeline.slice(0, 10), "1주일 안에 잡힌 일정/마감이 없습니다."),
    "",
    "날짜 확인 필요",
    ...renderDateConfirmationLines(input.dateConfirmationItems, "확인할 애매한 날짜 표현이 없습니다."),
    "",
    "널널한 업무",
    ...(input.relaxedItems.length > 0
      ? input.relaxedItems.map((item) => `- ${clean(item.title, 80)}: 하루 요약으로 묶어도 됩니다.`)
      : ["- 급하지 않은 미정 업무가 없습니다."]),
    "",
    "알림 방식",
    ...input.notificationPlan.map((plan) => `- ${plan.label}: ${plan.reason}`),
    "",
    "안전 경계: 이 브리핑은 읽기 전용 정리이며 외부 발송/등록을 하지 않습니다.",
  ];
  return `${lines.join("\n")}\n`;
}

function renderAnchorLines(items: ModyScheduleBriefingAnchor[], emptyText: string): string[] {
  if (items.length === 0) return [`- ${emptyText}`];
  return items.map(
    (item) =>
      `- ${formatKoreanTime(item.startsAt)} ${item.userMessage} 다음 확인 ${formatKoreanTime(item.nextReminderAt)} · ${item.reminderLabel}${item.contextLabel ? ` · ${item.contextLabel}` : ""}`,
  );
}

function renderDateConfirmationLines(
  items: ModyScheduleBriefingDateConfirmationItem[],
  emptyText: string,
): string[] {
  if (items.length === 0) return [`- ${emptyText}`];
  return items.map((item) => `- ${item.title}: ${item.userMessage} (${item.reason})`);
}

function deadlineMessage(title: string, minutesRemaining: number): string {
  return `${title} 마감까지 ${humanRemaining(minutesRemaining)} 남았습니다.`;
}

function meetingMessage(title: string, minutesRemaining: number): string {
  return `${title} 미팅까지 ${humanRemaining(minutesRemaining)} 남았습니다.`;
}

function deadlineCadence(minutesRemaining: number): ModyScheduleBriefingCadence {
  if (minutesRemaining <= 60) return "deadline_critical_15m";
  if (minutesRemaining <= 6 * 60) return "deadline_urgent_30m";
  if (minutesRemaining <= 24 * 60) return "deadline_soon_2h";
  return "relaxed_daily";
}

function meetingCadence(
  minutesRemaining: number,
  evidence?: ReturnType<typeof normalizeSourceEvidence>,
): ModyScheduleBriefingCadence {
  if (minutesRemaining <= 30) return "meeting_30m_before";
  if (minutesRemaining <= 3 * 60) return "meeting_3h_before";
  const reminderLabel = clean(evidence?.calendarReminderLabel, 120);
  if (/몇\s*시간|3\s*시간|준비|자료|이동/u.test(reminderLabel) && minutesRemaining <= 6 * 60) {
    return "meeting_3h_before";
  }
  return "meeting_day_before";
}

function withNextCheck(
  now: Date,
  plan: Omit<ModyScheduleBriefingNotificationPlan, "nextCheckAt">,
): ModyScheduleBriefingNotificationPlan {
  return {
    ...plan,
    nextCheckAt: addMinutes(now, plan.nextCheckHintMinutes).toISOString(),
  };
}

function nextReminderIso(
  now: Date,
  minutesRemaining: number,
  cadence: ModyScheduleBriefingCadence,
): ISODateTimeString {
  if (minutesRemaining <= 0) return now.toISOString();
  const hint = cadenceMinutesFor(cadence);
  return addMinutes(now, Math.max(Math.min(hint, minutesRemaining), 1)).toISOString();
}

function cadenceMinutesFor(cadence: ModyScheduleBriefingCadence): number {
  if (cadence === "deadline_critical_15m") return 15;
  if (cadence === "deadline_urgent_30m") return 30;
  if (cadence === "deadline_soon_2h") return 120;
  if (cadence === "meeting_30m_before") return 15;
  if (cadence === "meeting_3h_before") return 60;
  if (cadence === "meeting_day_before") return 180;
  return 1440;
}

function reminderLabelFor(cadence: ModyScheduleBriefingCadence): string {
  if (cadence === "deadline_critical_15m") return "15분 단위 최우선 알림";
  if (cadence === "deadline_urgent_30m") return "30분 단위 마감 추적";
  if (cadence === "deadline_soon_2h") return "2시간 단위 마감 확인";
  if (cadence === "meeting_30m_before") return "30분 전 최종 준비 알림";
  if (cadence === "meeting_3h_before") return "3시간 전 준비 알림";
  if (cadence === "meeting_day_before") return "하루 전 미팅 알림";
  if (cadence === "relaxed_daily") return "하루 요약";
  return "매일 1주일 브리핑";
}

function attentionLevelFor(cadence: ModyScheduleBriefingCadence): ModyScheduleBriefingAnchor["attentionLevel"] {
  if (
    cadence === "deadline_critical_15m" ||
    cadence === "deadline_urgent_30m" ||
    cadence === "meeting_30m_before"
  ) {
    return "interrupt";
  }
  if (cadence === "deadline_soon_2h" || cadence === "meeting_3h_before") return "attention";
  return "digest";
}

function urgencyFor(minutesRemaining: number): ModyScheduleBriefingAnchor["urgency"] {
  if (minutesRemaining <= 6 * 60) return "critical";
  if (minutesRemaining <= 24 * 60) return "soon";
  if (minutesRemaining <= 36 * 60) return "today";
  if (minutesRemaining <= 7 * 24 * 60) return "week";
  return "relaxed";
}

function humanRemaining(minutesRemaining: number): string {
  if (minutesRemaining <= 0) return "이미 도래";
  if (minutesRemaining < 60) return `${Math.round(minutesRemaining)}분`;
  const hours = Math.floor(minutesRemaining / 60);
  const minutes = Math.round(minutesRemaining % 60);
  if (hours < 24) return minutes > 0 ? `${hours}시간 ${minutes}분` : `${hours}시간`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days}일 ${restHours}시간` : `${days}일`;
}

function formatKoreanTime(value: ISODateTimeString): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function firstIso(...values: unknown[]): ISODateTimeString | undefined {
  for (const value of values) {
    if (typeof value === "string" && isValidDate(value)) return value;
  }
  return undefined;
}

function findIsoLikeDate(value: unknown): ISODateTimeString | undefined {
  const text = String(value ?? "");
  const match = /\b20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})?\b/u.exec(text);
  return match?.[0];
}

function normalizeSourceEvidence(value: ModyScheduleBriefingItem["sourceEvidence"] = {}) {
  const calendarAttendeeLabels = Array.isArray(value.calendarAttendeeLabels)
    ? value.calendarAttendeeLabels.map((label) => clean(label, 80)).filter(Boolean).slice(0, 3)
    : [];
  return {
    providerId: clean(value.providerId, 80),
    messageSubject: clean(value.messageSubject, 160),
    senderPreview: clean(value.senderPreview, 120),
    replyToLabel: clean(value.replyToLabel, 120),
    mailThreadLabel: clean(value.mailThreadLabel, 120),
    draftPreview: clean(value.draftPreview, 240),
    messageSnippet: clean(value.messageSnippet, 500),
    calendarCandidateText: clean(value.calendarCandidateText, 240),
    calendarTimeRangeLabel: clean(value.calendarTimeRangeLabel, 120),
    calendarStartsAt: isValidDate(String(value.calendarStartsAt ?? "")) ? value.calendarStartsAt : undefined,
    calendarEndsAt: isValidDate(String(value.calendarEndsAt ?? "")) ? value.calendarEndsAt : undefined,
    calendarAttendeeLabels,
    calendarLocationLabel: clean(value.calendarLocationLabel, 120),
    calendarReminderLabel: clean(value.calendarReminderLabel, 120),
    calendarConflictLabel: clean(value.calendarConflictLabel, 160),
    scheduleWindowLabel: clean(value.scheduleWindowLabel, 120),
  };
}

function createScheduleCandidates(
  item: ModyScheduleBriefingItem,
  evidence: ReturnType<typeof normalizeSourceEvidence>,
  title: string,
): NonNullable<ModyScheduleBriefingItem["schedules"]> {
  const schedules = [...(item.schedules ?? [])];
  if (evidence.calendarStartsAt && !schedules.some((schedule) => schedule.startsAt === evidence.calendarStartsAt)) {
    schedules.push({
      id: `${item.id}:source-evidence-calendar`,
      label: evidence.messageSubject || evidence.calendarTimeRangeLabel || title,
      startsAt: evidence.calendarStartsAt,
      ...(evidence.calendarEndsAt ? { endsAt: evidence.calendarEndsAt } : {}),
    });
  }
  return schedules;
}

function createDeadlineContextLabel(evidence: ReturnType<typeof normalizeSourceEvidence>): string | undefined {
  const parts = [
    evidence.messageSubject ? `원문 ${evidence.messageSubject}` : "",
    evidence.replyToLabel ? `답장 대상 ${evidence.replyToLabel}` : "",
  ].filter(Boolean);
  return compactContext(parts);
}

function createMeetingContextLabel(evidence: ReturnType<typeof normalizeSourceEvidence>): string | undefined {
  const attendeeText = evidence.calendarAttendeeLabels.length > 0
    ? `참석자 ${evidence.calendarAttendeeLabels.join(", ")}`
    : "";
  const parts = [
    evidence.calendarTimeRangeLabel,
    evidence.calendarLocationLabel ? `장소 ${evidence.calendarLocationLabel}` : "",
    attendeeText,
    evidence.calendarReminderLabel,
    evidence.calendarConflictLabel,
  ].filter(Boolean);
  return compactContext(parts);
}

function compactContext(parts: string[]): string | undefined {
  const text = parts
    .map((part) => clean(part, 100))
    .filter(Boolean)
    .slice(0, 4)
    .join(" · ");
  return text ? text.slice(0, 260) : undefined;
}

export function parseKoreanBusinessDateExpression(
  value: unknown,
  baseDate: Date | ISODateTimeString = new Date(),
): ModyKoreanBusinessDateParseResult {
  const text = clean(value, 500);
  if (!text) return { status: "not_found", confidence: "none" };

  const base = baseDate instanceof Date ? new Date(baseDate) : new Date(baseDate);
  if (!Number.isFinite(base.getTime())) return { status: "not_found", confidence: "none" };

  const ambiguity = findAmbiguousKoreanDateExpression(text);
  if (ambiguity) {
    return {
      status: "ambiguous",
      sourceText: text.slice(0, 160),
      reason: ambiguity.reason,
      question: ambiguity.question,
      confidence: "low",
    };
  }

  const date = resolveKoreanDate(text, base);
  if (!date) return { status: "not_found", confidence: "none" };
  const time = resolveKoreanTime(text);
  date.setHours(time.hour, time.minute, 0, 0);

  return {
    status: "parsed",
    iso: date.toISOString(),
    sourceText: text.slice(0, 160),
    confidence: time.explicit ? "high" : "medium",
  };
}

function findAmbiguousKoreanDateExpression(text: string): { reason: string; question: string } | undefined {
  const normalized = text.replace(/\s+/g, " ");

  if (/가능하면\s*(이번\s*주|이번주)|이번\s*주\s*중|이번주\s*중/u.test(normalized)) {
    return {
      reason: "이번 주 안이라는 범위만 있고 정확한 마감일이 없습니다.",
      question: "이번 주 중 어느 요일과 몇 시까지로 알림을 잡을까요?",
    };
  }

  if (/오전\s*안|오전\s*까지/u.test(normalized)) {
    return {
      reason: "오전 안이라는 시간 범위만 있고 기준 날짜가 분명하지 않습니다.",
      question: "어느 날짜 오전 몇 시까지로 확정할까요?",
    };
  }

  if (/오늘\s*안/u.test(normalized)) {
    return {
      reason: "오늘 안이라는 표현은 업무마다 마감 시각이 달라질 수 있습니다.",
      question: "오늘 몇 시까지로 알림을 잡을까요?",
    };
  }

  if (/월초|이번\s*달\s*초|이달\s*초/u.test(normalized)) {
    return {
      reason: "월초는 1일, 첫 영업일, 첫째 주 등으로 해석이 갈릴 수 있습니다.",
      question: "월초를 몇 일 또는 어느 영업일 기준으로 잡을까요?",
    };
  }

  if (/분기\s*말|분기말|이번\s*분기\s*말/u.test(normalized)) {
    return {
      reason: "분기 말은 회사별 마감 기준일과 시간이 다를 수 있습니다.",
      question: "분기 말 마감을 정확히 몇 월 며칠 몇 시로 잡을까요?",
    };
  }

  return undefined;
}

function resolveKoreanDate(text: string, base: Date): Date | undefined {
  const normalized = text.replace(/\s+/g, " ");
  const explicit = /\b(20\d{2})[-./년]\s*(\d{1,2})[-./월]\s*(\d{1,2})\s*일?\b/u.exec(normalized);
  if (explicit) {
    return createLocalDate(
      Number(explicit[1]),
      Number(explicit[2]) - 1,
      Number(explicit[3]),
      base,
    );
  }

  const monthDay = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/u.exec(normalized);
  if (monthDay) {
    const month = Number(monthDay[1]) - 1;
    const day = Number(monthDay[2]);
    const candidate = createLocalDate(base.getFullYear(), month, day, base);
    if (candidate.getTime() < startOfLocalDay(base).getTime()) {
      candidate.setFullYear(candidate.getFullYear() + 1);
    }
    return candidate;
  }

  const businessDays = /(?:영업일\s*기준\s*)?(\d{1,2})\s*영업일|영업일\s*기준\s*(\d{1,2})\s*일/u.exec(normalized);
  if (businessDays) {
    const days = Number(businessDays[1] ?? businessDays[2]);
    if (Number.isFinite(days) && days > 0) return addBusinessDays(startOfLocalDay(base), days);
  }

  if (/이번\s*달\s*말|이달\s*말|월말/u.test(normalized)) {
    return createLocalDate(base.getFullYear(), base.getMonth() + 1, 0, base);
  }

  if (/모레/u.test(normalized)) return addLocalDays(startOfLocalDay(base), 2);
  if (/내일/u.test(normalized)) return addLocalDays(startOfLocalDay(base), 1);
  if (/오늘|금일|당일|퇴근\s*전|오전\s*중|오후\s*중|오늘\s*중/u.test(normalized)) return startOfLocalDay(base);

  const weekMatch = findKoreanWeekdayExpression(normalized);
  if (weekMatch) {
    const targetDay = weekdayIndex(weekMatch.day);
    if (targetDay === undefined) return undefined;
    const prefix = weekMatch.prefix;
    const baseStart = startOfLocalDay(base);
    let days = targetDay - baseStart.getDay();
    if (/다다음/u.test(prefix)) days += 14;
    else if (/다음/u.test(prefix)) days += 7;
    if (!/이번/u.test(prefix) && !/다음/u.test(prefix) && days < 0) days += 7;
    if (/이번/u.test(prefix) && days < 0) days += 7;
    return addLocalDays(baseStart, days);
  }

  return undefined;
}

function findKoreanWeekdayExpression(text: string): { prefix: string; day: string } | undefined {
  const weekPrefix = "(이번\\s*주|이번주|다음\\s*주|다음주|다다음\\s*주|다다음주)";
  const fullWeekday = "(월요일|화요일|수요일|목요일|금요일|토요일|일요일)";
  const shortWeekday = "(월|화|수|목|금|토|일)";
  const suffix = "(?:까지|전|에|까지는)";
  const boundaryStart = "(?:^|[^가-힣])";
  const boundaryEnd = "(?=$|[^가-힣])";

  const fullMatch = new RegExp(
    `${boundaryStart}(?:${weekPrefix}\\s*)?${fullWeekday}(?:\\s*${suffix})?${boundaryEnd}`,
    "u",
  ).exec(text);
  if (fullMatch) return { prefix: fullMatch[1] ?? "", day: fullMatch[2] ?? "" };

  const prefixedShortMatch = new RegExp(
    `${boundaryStart}${weekPrefix}\\s*${shortWeekday}(?:\\s*${suffix})?${boundaryEnd}`,
    "u",
  ).exec(text);
  if (prefixedShortMatch) return { prefix: prefixedShortMatch[1] ?? "", day: prefixedShortMatch[2] ?? "" };

  const suffixedShortMatch = new RegExp(
    `${boundaryStart}${shortWeekday}\\s*${suffix}${boundaryEnd}`,
    "u",
  ).exec(text);
  if (suffixedShortMatch) return { prefix: "", day: suffixedShortMatch[1] ?? "" };

  return undefined;
}

function resolveKoreanTime(text: string): { hour: number; minute: number; explicit: boolean } {
  if (/오전\s*중/u.test(text)) return { hour: 11, minute: 30, explicit: true };
  if (/오후\s*중/u.test(text)) return { hour: 17, minute: 0, explicit: true };
  if (/퇴근\s*전/u.test(text)) return { hour: 18, minute: 0, explicit: true };
  if (/점심\s*전/u.test(text)) return { hour: 12, minute: 0, explicit: true };
  if (/오늘\s*중|금일\s*중/u.test(text)) return { hour: 18, minute: 0, explicit: true };

  const timeMatch = /(오전|오후|낮|저녁|밤|새벽)?\s*(\d{1,2}|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|열한|열두)\s*시(?:\s*(\d{1,2})\s*분?)?/u.exec(text);
  if (!timeMatch) {
    return { hour: /미팅|회의|상담|방문/u.test(text) ? 10 : 18, minute: 0, explicit: false };
  }

  const meridiem = timeMatch[1] ?? "";
  let hour = koreanHourNumber(timeMatch[2] ?? "");
  const minute = Math.min(Math.max(Number(timeMatch[3] ?? 0), 0), 59);
  if (meridiem === "오전" || meridiem === "새벽") {
    if (hour === 12) hour = 0;
  } else if (meridiem === "오후" || meridiem === "저녁" || meridiem === "밤") {
    if (hour < 12) hour += 12;
  } else if (meridiem === "낮") {
    if (hour < 11) hour += 12;
  }
  return { hour: Math.min(Math.max(hour, 0), 23), minute, explicit: true };
}

function koreanHourNumber(value: string): number {
  const map: Record<string, number> = {
    한: 1,
    두: 2,
    세: 3,
    네: 4,
    다섯: 5,
    여섯: 6,
    일곱: 7,
    여덟: 8,
    아홉: 9,
    열: 10,
    열한: 11,
    열두: 12,
  };
  return map[value] ?? Number(value);
}

function weekdayIndex(value: string): number | undefined {
  const key = value.replace("요일", "");
  const map: Record<string, number> = {
    일: 0,
    월: 1,
    화: 2,
    수: 3,
    목: 4,
    금: 5,
    토: 6,
  };
  return map[key];
}

function startOfLocalDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function createLocalDate(year: number, month: number, day: number, base: Date): Date {
  const date = new Date(base);
  date.setFullYear(year, month, day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addLocalDays(value: Date, days: number): Date {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function addBusinessDays(value: Date, days: number): Date {
  const date = new Date(value);
  let remaining = days;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    remaining -= 1;
  }
  return date;
}

function isValidDate(value: string): boolean {
  return Number.isFinite(new Date(value).getTime());
}

function diffMinutes(value: ISODateTimeString, now: Date): number {
  return Math.round((new Date(value).getTime() - now.getTime()) / 60_000);
}

function isSameLocalDate(left: ISODateTimeString, right: ISODateTimeString): boolean {
  const a = new Date(left);
  const b = new Date(right);
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60_000);
}

function addMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60_000);
}

function compactDate(value: ISODateTimeString): string {
  return value.replace(/[^0-9]/g, "").slice(0, 12);
}

function clean(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
