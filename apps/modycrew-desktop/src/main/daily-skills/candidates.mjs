/**
 * 일상 도구 후보 고르기 — 데스크톱 메인(예약·백그라운드 업무)용.
 *
 * 채팅 화면은 apps/modycrew-web/lib/daily-skills.ts 의 같은 규칙으로 후보를 고른다.
 * 백그라운드 업무 실행기는 화면 없이 돌기 때문에 메인 프로세스에서 같은 점수 규칙을 쓴다.
 * 두 구현이 어긋나지 않도록 tests/desktop/daily-skills-runtime.test.mjs 가 같은 예문으로 함께 검증한다.
 */
import * as bundledCatalog from "./catalog-data.mjs";

const singleCharJosa = new Set(["가", "이", "는", "도", "와", "오", "올", "옴", "야", "요", "랑", "만", "엔", "은"]);
const candidateMinScore = 3;

function tokensOf(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[\s,.;:!?·~'"()\[\]{}<>/\\|]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function keywordHit(keyword, compactText, tokens) {
  const key = String(keyword ?? "").toLowerCase().replace(/\s+/gu, "");
  if (!key) return false;
  if (key.length >= 2) return compactText.includes(key);
  return tokens.some((token) => token === key || (token.length === 2 && token.startsWith(key) && singleCharJosa.has(token.slice(1))));
}

export function scoreDailySkillForText(skill, text) {
  const lowered = String(text ?? "").toLowerCase();
  if (!lowered.trim()) return 0;
  const compactText = lowered.replace(/\s+/gu, "");
  const tokens = tokensOf(lowered);
  let score = 0;
  const seen = new Set();
  for (const keyword of skill.keywords ?? []) {
    const key = String(keyword).toLowerCase().replace(/\s+/gu, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (keywordHit(keyword, compactText, tokens)) score += key.length >= 3 ? 3 : 2;
  }
  const name = String(skill.name ?? "").toLowerCase().replace(/\s+/gu, "");
  if (name.length >= 2 && compactText.includes(name)) score += 2;
  const requestTokens = new Set(tokens.filter((token) => token.length >= 2));
  let overlap = 0;
  for (const example of skill.examples ?? []) {
    for (const token of tokensOf(example)) if (token.length >= 2 && requestTokens.has(token)) overlap += 1;
  }
  return score + Math.min(overlap, 3);
}

/** categories: "all" 또는 분류 id 배열(직원 역할이 허용한 범위). 빈 배열이면 후보 없음. */
export function selectDailySkillsForText(text, options = {}) {
  const catalog = options.catalog ?? bundledCatalog;
  const categories = options.categories ?? "all";
  const limit = Math.max(1, Math.min(Number(options.limit) || 3, 5));
  const skills = (catalog.dailySkills ?? []).filter((skill) => categories === "all" || (Array.isArray(categories) && categories.includes(skill.category)));
  return skills
    .map((skill) => ({ skill, score: scoreDailySkillForText(skill, text) }))
    .filter((entry) => entry.score >= candidateMinScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.skill);
}

/** 백그라운드 실행기의 [읽기 도구] 한 줄에 들어갈 후보 설명. */
export function formatDailySkillsForToolLabel(skills) {
  const parts = [];
  for (const skill of skills) {
    for (const endpoint of (skill.endpoints ?? []).slice(0, 3)) {
      const params = (endpoint.params ?? [])
        .map((param) => `${param.name}${param.required ? "*" : ""}${param.description ? `(${param.description})` : ""}`)
        .join(", ");
      parts.push(`skill=${skill.id} endpoint=${endpoint.id} ${skill.name}: ${endpoint.summary}${params ? ` [params: ${params}]` : ""}`);
    }
  }
  return parts.join(" | ");
}

function kstStamp(iso) {
  const time = Date.parse(iso ?? "");
  if (!Number.isFinite(time)) return "방금";
  const kst = new Date(time + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")} ${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
}

/** 조회 결과 → 백그라운드 관찰 문장. 실패는 실패로 남겨 모델이 값을 지어내지 않게 한다. */
export function formatDailySkillResultForBackground(result) {
  if (!result?.ok) return `조회 실패: ${result?.userMessage || "조회 서버가 응답하지 않았어요."} (값을 추측하지 말 것)`;
  return `[${result.skillName} · ${result.endpointSummary}] 출처: ${result.source || "공개 데이터"} (k-skill 공개 중계 서버 경유) · 조회 ${kstStamp(result.fetchedAt)}\n${result.dataText ?? ""}`;
}
