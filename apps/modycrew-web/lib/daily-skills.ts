/**
 * 일상 도구(실시간 공개 정보 조회) — 화면 쪽 도우미.
 *
 *  - 데스크톱 메인이 준 공개 카탈로그를 한 번 받아 캐시한다.
 *  - 요청 문장에 맞는 후보를 최대 3개만 골라 모델 프롬프트 블록을 만든다(전체 목록을 넣지 않음).
 *  - daily.lookup 결과를 출처·조회 시각이 붙은 관찰 문장으로 바꾼다.
 *
 * 이 파일은 다른 앱 모듈을 import 하지 않는다. agent-tools 스모크가 agent-tools.ts 를
 * 단독 tsc 로 컴파일하는데, 그때 함께 컴파일되어도 가볍게 유지하기 위해서다.
 * 실제 네트워크 경계(고정 호스트·GET·경로/인자 검증)는 데스크톱 메인이 맡는다.
 */

export type DailySkillParamSpec = {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  values?: string[];
  min?: number;
  max?: number;
};

export type DailySkillEndpointSpec = {
  id: string;
  summary: string;
  params: DailySkillParamSpec[];
};

export type DailySkillSpec = {
  id: string;
  name: string;
  category: string;
  summary: string;
  examples: string[];
  keywords: string[];
  source: string;
  notes?: string;
  endpoints: DailySkillEndpointSpec[];
};

export type DailySkillCategory = { id: string; label: string };

export type DailySkillCatalogResult = {
  ok: boolean;
  status: string;
  userMessage?: string;
  version?: string;
  proxy?: { host: string; provider: string; license: string };
  categories?: DailySkillCategory[];
  skills?: DailySkillSpec[];
};

export type DailySkillCatalog = {
  version: string;
  proxy: { host: string; provider: string; license: string };
  categories: DailySkillCategory[];
  skills: DailySkillSpec[];
};

export type DailySkillLookupPayload = {
  skillId: string;
  endpointId?: string;
  params?: Record<string, unknown>;
};

export type DailySkillLookupResult = {
  ok: boolean;
  status: string;
  userMessage: string;
  code?: string;
  skillId?: string;
  skillName?: string;
  endpointId?: string;
  endpointSummary?: string;
  source?: string;
  provider?: string;
  fetchedAt?: string;
  itemCount?: number | null;
  truncated?: boolean;
  ignoredParams?: string[];
  problems?: string[];
  dataText?: string;
  cached?: boolean;
};

export type DailySkillsBridgeLike = {
  dailySkillsCatalog?: () => Promise<DailySkillCatalogResult>;
};

/** 직원 역할이 허용한 일상 도구 분류. "all" 은 전체(기본 비서). */
export type DailySkillCategoryGrant = readonly string[] | "all";

export const dailySkillsEnabledStorageKey = "modycrew.dailySkills.enabled.v1";
export const dailySkillsEnabledEventName = "modycrew:daily-skills-enabled";

let catalogPromise: Promise<DailySkillCatalog | null> | null = null;

function textOf(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

function normalizeCatalog(result: DailySkillCatalogResult): DailySkillCatalog | null {
  const skills = Array.isArray(result.skills)
    ? result.skills.filter((skill) => skill && textOf(skill.id) && Array.isArray(skill.endpoints) && skill.endpoints.length)
    : [];
  if (!skills.length) return null;
  return {
    version: textOf(result.version),
    proxy: {
      host: textOf(result.proxy?.host),
      provider: textOf(result.proxy?.provider) || "k-skill 공개 중계 서버",
      license: textOf(result.proxy?.license) || "k-skill (MIT)",
    },
    categories: Array.isArray(result.categories) ? result.categories.filter((category) => textOf(category?.id)) : [],
    skills,
  };
}

/** 데스크톱이 지원하지 않거나 실패하면 null. 실패한 결과는 캐시하지 않아 다음에 다시 시도한다. */
export function loadDailySkillCatalog(
  bridge: DailySkillsBridgeLike | null | undefined,
  options: { timeoutMs?: number; force?: boolean } = {},
): Promise<DailySkillCatalog | null> {
  if (!bridge || typeof bridge.dailySkillsCatalog !== "function") return Promise.resolve(null);
  if (catalogPromise && !options.force) return catalogPromise;
  const timeoutMs = options.timeoutMs ?? 2_500;
  const pending: Promise<DailySkillCatalog | null> = (async () => {
    try {
      const result = await Promise.race<DailySkillCatalogResult | null>([
        bridge.dailySkillsCatalog!(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      if (!result || !result.ok) return null;
      return normalizeCatalog(result);
    } catch {
      return null;
    }
  })();
  catalogPromise = pending;
  void pending.then((catalog) => {
    if (!catalog && catalogPromise === pending) catalogPromise = null;
  });
  return pending;
}

export function readDailySkillsEnabled(): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return true;
    return window.localStorage.getItem(dailySkillsEnabledStorageKey) !== "off";
  } catch {
    return true;
  }
}

export function writeDailySkillsEnabled(enabled: boolean): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(dailySkillsEnabledStorageKey, enabled ? "on" : "off");
    window.dispatchEvent(new CustomEvent(dailySkillsEnabledEventName, { detail: { enabled } }));
  } catch {
    // 저장소를 못 쓰면 이번 실행에서만 기본값(켜짐)을 쓴다.
  }
}

export function filterDailySkillsByCategories(
  skills: readonly DailySkillSpec[],
  grant: DailySkillCategoryGrant | undefined,
): DailySkillSpec[] {
  if (grant === "all") return [...skills];
  if (!grant || !grant.length) return [];
  const allowed = new Set(grant);
  return skills.filter((skill) => allowed.has(skill.category));
}

const singleCharJosa = new Set(["가", "이", "는", "도", "와", "오", "올", "옴", "야", "요", "랑", "만", "엔", "은"]);

function tokensOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,.;:!?·~'"()\[\]{}<>/\\|]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

/** 한 글자 키워드(비·눈 등)는 "비용·준비" 같은 단어에 걸리지 않게 단독 낱말일 때만 센다. */
function keywordHit(keyword: string, compactText: string, tokens: readonly string[]): boolean {
  const key = keyword.toLowerCase().replace(/\s+/gu, "");
  if (!key) return false;
  if (key.length >= 2) return compactText.includes(key);
  return tokens.some((token) => token === key || (token.length === 2 && token.startsWith(key) && singleCharJosa.has(token.slice(1))));
}

export function scoreDailySkill(skill: DailySkillSpec, requestText: string): number {
  const lowered = String(requestText ?? "").toLowerCase();
  if (!lowered.trim()) return 0;
  const compactText = lowered.replace(/\s+/gu, "");
  const tokens = tokensOf(lowered);
  let score = 0;
  const seen = new Set<string>();
  for (const keyword of skill.keywords ?? []) {
    const key = keyword.toLowerCase().replace(/\s+/gu, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (keywordHit(keyword, compactText, tokens)) score += key.length >= 3 ? 3 : 2;
  }
  const name = textOf(skill.name).toLowerCase().replace(/\s+/gu, "");
  if (name.length >= 2 && compactText.includes(name)) score += 2;
  const requestTokens = new Set(tokens.filter((token) => token.length >= 2));
  let exampleOverlap = 0;
  for (const example of skill.examples ?? []) {
    for (const token of tokensOf(example)) {
      if (token.length >= 2 && requestTokens.has(token)) exampleOverlap += 1;
    }
  }
  score += Math.min(exampleOverlap, 3);
  return score;
}

const candidateMinScore = 3;

/**
 * 요청에 맞는 후보를 고른다. 이번 문장만으로 못 찾으면 직전 사용자 문장과 합쳐 한 번 더 본다
 * ("오늘 서울 날씨 어때?" 다음의 "그럼 내일은?" 같은 이어 묻기).
 */
export function selectDailySkillCandidates(
  skills: readonly DailySkillSpec[],
  requestText: string,
  options: { previousUserText?: string; limit?: number } = {},
): DailySkillSpec[] {
  const limit = Math.max(1, Math.min(options.limit ?? 3, 5));
  const rank = (text: string) =>
    skills
      .map((skill) => ({ skill, score: scoreDailySkill(skill, text) }))
      .filter((entry) => entry.score >= candidateMinScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => entry.skill);
  const direct = rank(requestText);
  if (direct.length || !textOf(options.previousUserText)) return direct;
  return rank(`${options.previousUserText} ${requestText}`);
}

function describeParam(param: DailySkillParamSpec): string {
  const parts: string[] = [param.required ? "필수" : "선택"];
  if (param.description) parts.push(param.description);
  if (param.values?.length) parts.push(`값: ${param.values.join("/")}`);
  if (Number.isFinite(param.min) || Number.isFinite(param.max)) {
    parts.push(`범위 ${Number.isFinite(param.min) ? param.min : ""}~${Number.isFinite(param.max) ? param.max : ""}`);
  }
  return `${param.name}(${parts.join(", ")})`;
}

function kstDateLabel(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][kst.getUTCDay()];
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}(${weekday})`;
}

/** 모델 프롬프트에 붙일 후보 블록. 후보가 없으면 빈 문자열(프롬프트를 늘리지 않음). */
export function formatDailySkillCandidatesForPrompt(candidates: readonly DailySkillSpec[], now: Date = new Date()): string {
  if (!candidates.length) return "";
  const lines: string[] = [
    "[일상 도구 후보 — 실시간 공개 정보 조회]",
    "아래 도구로 날씨·교통·공휴일·법령·공공 정보 같은 최신 값을 읽기 전용으로 조회할 수 있습니다. 실제 최신 값이 필요하면 첫 줄에 다음 형식 한 줄만 출력하세요.",
    'TOOL=daily.lookup|ARGS={"skill":"<skill>","endpoint":"<endpoint>","params":{...}}',
  ];
  for (const skill of candidates) {
    lines.push(`- skill=${skill.id} · ${skill.name}${skill.source ? ` (출처: ${skill.source})` : ""}`);
    for (const endpoint of skill.endpoints.slice(0, 4)) {
      const params = endpoint.params.length ? endpoint.params.map(describeParam).join(", ") : "없음";
      lines.push(`  · endpoint=${endpoint.id}: ${endpoint.summary} | params: ${params}`);
    }
    if (skill.notes) lines.push(`  · 팁: ${skill.notes}`);
  }
  lines.push(
    "규칙:",
    "- 위 목록에 있는 skill·endpoint·params 이름만 쓰세요.",
    `- 사용자가 말하지 않은 위치·번호·날짜를 지어내지 마세요. 꼭 필요한 값이 없으면 도구를 부르지 말고 먼저 짧게 물어보세요. 오늘은 ${kstDateLabel(now)}입니다.`,
    "- 조회 결과로 답할 때는 끝에 출처와 조회 시각을 한 줄로 알려 주세요.",
    "- 조회가 실패하면 실패했다고 말하고 값을 추측해서 채우지 마세요.",
  );
  return lines.join("\n");
}

function kstTimeLabel(iso: string | undefined): string {
  const time = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(time)) return "방금";
  const kst = new Date(time + 9 * 60 * 60 * 1000);
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mi = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
}

/** 채팅 답변 아래에 붙일 짧은 출처 줄. */
export function formatDailySkillSourceLine(result: DailySkillLookupResult | null | undefined): string {
  if (!result?.ok) return "";
  return `${textOf(result.skillName) || result.skillId} · 출처 ${textOf(result.source) || "공개 데이터"} · 조회 ${kstTimeLabel(result.fetchedAt)}`;
}
