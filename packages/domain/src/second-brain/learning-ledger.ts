/**
 * 배운 것 장부 — 앱이 시키지 않아도 스스로 나아지기 위한 저장소.
 *
 * 지금 이 저장소의 학습은 아홉 갈래로 흩어져 있다(메일 결정 학습, 업무 패턴 분석,
 * 작업공간 지능, crew-souls 4파일 …). 각자 다른 모양으로 쌓이고, 서로 모르고,
 * 되돌릴 수 없다. 그래서 "무엇을 배웠는지" 사람이 볼 수 없고 "잘못 배운 것"을
 * 지울 수도 없다.
 *
 * 여기서는 **한 가지 레코드, 네 가지 종류, 한 저장소**로 모은다.
 * 설계는 prime-agent 의 continual harness 를 따르되(docs/122), 두 가지를 바꿨다.
 *
 * 1. **승인선이 다르다.** prime-agent 는 다른 모델이 심사하고 바로 적용한다.
 *    우리는 진짜 메일과 정산 자료에 닿으므로 선을 나눈다 —
 *    *사용자를 알아가는 것*은 저절로 쌓이고, *밖으로 나가는 행동이 달라지는 것*은
 *    승인함을 거친다. 이것이 "혼자 발전한다"와 "마음대로 하지 않는다"를 동시에
 *    지키는 유일한 선이다.
 * 2. **근거가 필수다.** prime-agent 는 근거 문장이 비어도 통과한다. 여기서는
 *    근거 없는 학습을 거부한다 — 근거 없이 쌓인 규칙은 사람이 검토할 수 없다.
 */

/** 배운 것의 종류. 화면에는 한국어 이름으로만 보인다. */
export type ModyLessonKind =
  /** 이렇게 해 주세요 — 말투, 형식, 우선순위 같은 취향. */
  | "preference"
  /** 알아둘 것 — 거래처, 담당자, 마감처럼 오래 가는 사실. */
  | "fact"
  /** 일하는 순서 — 반복되는 절차. */
  | "procedure"
  /** 담당 방식 — 특정 직원이 일을 대하는 기준. */
  | "role";

export const modyLessonKinds: readonly ModyLessonKind[] = [
  "preference",
  "fact",
  "procedure",
  "role",
];

export const modyLessonKindLabels: Readonly<Record<ModyLessonKind, string>> = {
  preference: "이렇게 해 주세요",
  fact: "알아둘 것",
  procedure: "일하는 순서",
  role: "담당 방식",
};

/** 이 배움이 누구에게 적용되는가. */
export type ModyLessonScope =
  /** 이 직원에게만. */
  | "teammate"
  /** 사무실 전체 — 모든 직원이 따른다. */
  | "office";

export type ModyLesson = {
  id: string;
  kind: ModyLessonKind;
  scope: ModyLessonScope;
  /** scope 가 teammate 일 때만 채워진다. */
  teammateId: string;
  title: string;
  content: string;
  /** 묶어 보여줄 갈래(메일·문서·일정 …). 없으면 "일반". */
  path: string;
  /**
   * 왜 이렇게 배웠는지. **비어 있으면 저장하지 않는다** — 근거 없는 규칙은
   * 사람이 검토할 수 없고, 검토할 수 없는 규칙은 되돌릴 수도 없다.
   */
  evidence: string;
  /** 누가 적었는가. 사용자가 직접 적은 것과 앱이 관찰한 것을 구분한다. */
  source: "user" | "observed";
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type ModyLearningLedger = {
  schema: 1;
  lessons: ModyLesson[];
};

export const modyLearningLedgerEmpty: ModyLearningLedger = { schema: 1, lessons: [] };

export type ModyLessonEdit = {
  action: "create" | "update" | "delete";
  kind: ModyLessonKind;
  scope: ModyLessonScope;
  teammateId?: string;
  id?: string;
  title?: string;
  content?: string;
  path?: string;
  evidence?: string;
  source?: "user" | "observed";
};

export type ModyAppliedLessonEdit = ModyLessonEdit & {
  id: string;
  /** 편집 전 모습. 이 값 하나가 되돌리기 기록이 된다. */
  before?: ModyLesson | undefined;
  after?: ModyLesson | undefined;
  applied: boolean;
  error?: string | undefined;
};

export type ModyLessonEditResult = {
  applied: ModyAppliedLessonEdit[];
  ledger: ModyLearningLedger;
};

/**
 * 물어보고 배워야 하는가.
 *
 * 이 문은 **앱이 스스로 정하는 것**을 막기 위한 것이지, 사용자를 막기 위한 것이 아니다.
 * 그래서 사용자가 직접 적은 것(`source: "user"`)은 묻지 않는다 — 사용자가 말한 것이
 * 곧 승인이고, 자기가 방금 적은 것을 다시 확인시키면 앱이 굼떠 보일 뿐이다.
 *
 * 앱이 관찰해서 얻은 것(`source: "observed"`)이면:
 * - "일하는 순서"와 "담당 방식"은 앞으로 무엇을 할지를 바꾸므로 사람이 봐야 한다.
 * - "이렇게 해 주세요"와 "알아둘 것"은 사용자를 알아가는 것이라 저절로 쌓여도 된다.
 * - 사무실 전체(office)에 거는 것은 종류와 무관하게 확인을 받는다 — 한 사람의 습관이
 *   모두의 규칙이 되면 안 된다.
 */
export function lessonNeedsApproval(
  edit: Pick<ModyLessonEdit, "kind" | "scope"> & { source?: ModyLesson["source"] },
): boolean {
  if (edit.source === "user") return false;
  if (edit.scope === "office") return true;
  return edit.kind === "procedure" || edit.kind === "role";
}

function nowOr(value: string | undefined, fallback: string): string {
  return value && value.trim() ? value : fallback;
}

function slugify(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  return base || "lesson";
}

/** 저장 전 검사. 통과하지 못한 편집은 버리되, 나머지 편집은 그대로 적용한다. */
export function validateLessonEdit(edit: ModyLessonEdit): string | null {
  if (!["create", "update", "delete"].includes(edit.action)) return "알 수 없는 편집입니다.";
  if (!modyLessonKinds.includes(edit.kind)) return "알 수 없는 종류입니다.";
  if (edit.scope !== "teammate" && edit.scope !== "office") return "적용 범위가 잘못됐습니다.";
  if (edit.scope === "teammate" && !String(edit.teammateId ?? "").trim()) {
    return "어느 담당자에게 적용할지가 없습니다.";
  }
  if (edit.action !== "create" && !String(edit.id ?? "").trim()) {
    return "고칠 대상이 지정되지 않았습니다.";
  }
  if (edit.action === "delete") return null;
  if (!String(edit.title ?? "").trim()) return "제목이 없습니다.";
  if (!String(edit.content ?? "").trim()) return "내용이 없습니다.";
  // 근거 없는 학습은 받지 않는다.
  if (!String(edit.evidence ?? "").trim()) return "무엇을 보고 배웠는지가 없습니다.";
  return null;
}

/**
 * 편집을 적용한다. 편집마다 before/after 를 들고 나오므로, 이 결과 하나가
 * 그대로 되돌리기 기록이 된다 — 따로 스냅샷 파일을 두지 않는다.
 */
export function applyLessonEdits(input: {
  ledger: ModyLearningLedger;
  edits: readonly ModyLessonEdit[];
  nowIso: string;
}): ModyLessonEditResult {
  const { ledger, edits, nowIso } = input;
  const lessons = ledger.lessons.map((lesson) => ({ ...lesson }));
  const applied: ModyAppliedLessonEdit[] = [];
  const touched = new Set<string>();

  for (const edit of edits) {
    const invalid = validateLessonEdit(edit);
    const id = String(edit.id ?? "").trim() || `${edit.kind}-${slugify(String(edit.title ?? ""))}`;
    if (invalid) {
      applied.push({ ...edit, id, applied: false, error: invalid });
      continue;
    }
    const index = lessons.findIndex((lesson) => lesson.id === id);
    const existing = index >= 0 ? lessons[index] : undefined;
    const before: ModyLesson | undefined = existing ? { ...existing } : undefined;

    if (edit.action === "delete") {
      if (!before) {
        applied.push({ ...edit, id, applied: false, error: "없는 항목입니다." });
        continue;
      }
      lessons.splice(index, 1);
      touched.add(id);
      applied.push({ ...edit, id, before, applied: true });
      continue;
    }

    if (edit.action === "create" && before && !touched.has(id)) {
      applied.push({ ...edit, id, before, applied: false, error: "이미 있는 항목입니다." });
      continue;
    }
    if (edit.action === "update" && !before) {
      applied.push({ ...edit, id, applied: false, error: "없는 항목입니다." });
      continue;
    }

    const after: ModyLesson = {
      id,
      kind: edit.kind,
      scope: edit.scope,
      teammateId: edit.scope === "teammate" ? String(edit.teammateId ?? "") : "",
      title: String(edit.title ?? before?.title ?? ""),
      content: String(edit.content ?? before?.content ?? ""),
      path: nowOr(edit.path, before?.path ?? "일반"),
      evidence: String(edit.evidence ?? before?.evidence ?? ""),
      source: edit.source ?? before?.source ?? "observed",
      createdAt: before?.createdAt ?? nowIso,
      updatedAt: nowIso,
      version: (before?.version ?? 0) + 1,
    };
    if (index >= 0) lessons[index] = after;
    else lessons.push(after);
    touched.add(id);
    applied.push({ ...edit, id, before, after: { ...after }, applied: true });
  }

  return { applied, ledger: { schema: 1, lessons } };
}

/**
 * 되돌리기. 적용된 편집을 역순으로 뒤집은 편집 목록을 만든다.
 * 이 목록을 applyLessonEdits 에 그대로 넣으면 되므로, 되돌리기도 같은 검사를 받고
 * 그 자체가 다시 되돌릴 수 있는 기록으로 남는다.
 */
export function buildLessonRollbackEdits(
  applied: readonly ModyAppliedLessonEdit[],
): ModyLessonEdit[] {
  const edits: ModyLessonEdit[] = [];
  for (const edit of [...applied].reverse()) {
    if (!edit.applied) continue;
    if (edit.before) {
      edits.push({
        action: edit.after ? "update" : "create",
        kind: edit.before.kind,
        scope: edit.before.scope,
        teammateId: edit.before.teammateId,
        id: edit.before.id,
        title: edit.before.title,
        content: edit.before.content,
        path: edit.before.path,
        evidence: edit.before.evidence,
        source: edit.before.source,
      });
      continue;
    }
    if (edit.after) {
      edits.push({
        action: "delete",
        kind: edit.after.kind,
        scope: edit.after.scope,
        teammateId: edit.after.teammateId,
        id: edit.after.id,
      });
    }
  }
  return edits;
}

/** 한 직원이 따라야 할 배움. 사무실 전체 규칙 + 그 직원 것. */
export function lessonsForTeammate(
  ledger: ModyLearningLedger,
  teammateId: string,
): ModyLesson[] {
  return ledger.lessons.filter(
    (lesson) =>
      lesson.scope === "office" ||
      (lesson.scope === "teammate" && lesson.teammateId === teammateId),
  );
}

/**
 * 프롬프트에 넣을 요약. **본문을 통째로 넣지 않는다.**
 *
 * 작업공간 스킬이 지금 그렇게 하고 있어서, 활성 스킬의 모든 문장이 매 턴 들어간다.
 * 배움은 시간이 갈수록 늘어나므로 같은 방식이면 곧 프롬프트가 터진다.
 * 종류마다 몇 개, 한 줄 몇 자로 묶고 넘치는 만큼은 개수로만 알린다.
 */
export function formatLessonsForPrompt(
  lessons: readonly ModyLesson[],
  options: { perKind?: number; contentChars?: number } = {},
): string {
  const perKind = options.perKind ?? 6;
  const contentChars = options.contentChars ?? 180;
  if (lessons.length === 0) return "";

  const lines: string[] = ["[지금까지 배운 것]"];
  for (const kind of modyLessonKinds) {
    const ofKind = lessons
      .filter((lesson) => lesson.kind === kind)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    if (ofKind.length === 0) continue;
    lines.push(`${modyLessonKindLabels[kind]} (${ofKind.length}):`);
    for (const lesson of ofKind.slice(0, perKind)) {
      const summary = lesson.content.replace(/\s+/gu, " ").trim().slice(0, contentChars);
      lines.push(`- ${lesson.title} (${lesson.path}): ${summary}`);
    }
    const overflow = ofKind.length - Math.min(ofKind.length, perKind);
    if (overflow > 0) lines.push(`- 그 밖에 ${overflow}개 더`);
  }
  return lines.join("\n");
}

export function parseLearningLedger(raw: unknown): ModyLearningLedger {
  if (!raw || typeof raw !== "object") return { schema: 1, lessons: [] };
  const candidate = raw as { lessons?: unknown };
  if (!Array.isArray(candidate.lessons)) return { schema: 1, lessons: [] };
  const lessons: ModyLesson[] = [];
  for (const value of candidate.lessons) {
    if (!value || typeof value !== "object") continue;
    const lesson = value as Partial<ModyLesson>;
    const kind = lesson.kind;
    if (!kind || !modyLessonKinds.includes(kind)) continue;
    const scope: ModyLessonScope = lesson.scope === "office" ? "office" : "teammate";
    const id = String(lesson.id ?? "").trim();
    const title = String(lesson.title ?? "").trim();
    const content = String(lesson.content ?? "").trim();
    const evidence = String(lesson.evidence ?? "").trim();
    if (!id || !title || !content || !evidence) continue;
    lessons.push({
      id,
      kind,
      scope,
      teammateId: scope === "teammate" ? String(lesson.teammateId ?? "") : "",
      title,
      content,
      path: String(lesson.path ?? "").trim() || "일반",
      evidence,
      source: lesson.source === "user" ? "user" : "observed",
      createdAt: String(lesson.createdAt ?? ""),
      updatedAt: String(lesson.updatedAt ?? ""),
      version: Number.isFinite(lesson.version) ? Number(lesson.version) : 1,
    });
  }
  return { schema: 1, lessons };
}
