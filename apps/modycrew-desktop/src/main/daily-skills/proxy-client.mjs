/**
 * 일상 도구 조회 클라이언트 — 데스크톱 메인 프로세스 전용.
 *
 * 채팅 AI 가 "오늘 서울 날씨", "강남역 지하철" 같은 실시간 공개 정보를 물을 때
 * k-skill 공개 중계 서버(NomaDamas 운영, 원천 기관 API 키는 운영자 서버가 보관)를
 * 읽기 전용으로 호출한다. 사용자 PC 에 k-skill 이 설치돼 있지 않아도 동작하도록
 * 경로·인자 정보는 앱에 동봉한 카탈로그(catalog-data.mjs)만 본다.
 *
 * 보안 경계(화면 쪽 요청은 신뢰하지 않는다):
 *  - GET 만 보낸다. 호스트는 고정(https)이고, 카탈로그에 선언된 경로·인자만 통과한다.
 *  - 경로 변수는 인코딩 후 치환하고 '/', '\', '.', '..' 값은 거부한다.
 *  - 시간 제한 8초, 응답 512KB 상한, 리다이렉트 거부.
 *  - 분당 호출 상한(반복 루프 폭주 방지)과 같은 요청 60초 캐시.
 *  - 모델에게 넘기는 결과는 핵심 필드만 골라 3,500자 안으로 줄인다.
 */

export const defaultDailySkillsProxyBase = "https://k-skill-proxy.nomadamas.org";
export const dailySkillsProxyProvider = "k-skill 공개 중계 서버 (NomaDamas 운영)";

const defaultTimeoutMs = 8_000;
const defaultMaxResponseBytes = 512 * 1024;
const defaultCacheTtlMs = 60_000;
const defaultRateLimitPerMinute = 30;
const defaultModelMaxChars = 3_500;
const maxCacheEntries = 100;
const defaultStringMaxLength = 120;

const paramTypes = new Set(["string", "number", "integer", "enum", "boolean"]);

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function cleanText(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
}

/** 프록시 주소. 자체 중계 서버로 바꿀 때만 환경변수를 쓴다(https·경로 없는 주소만 허용). */
export function resolveDailySkillsProxyBase(env = process.env) {
  const raw = cleanText(env?.MODY_DAILY_SKILLS_PROXY_BASE_URL);
  if (!raw) return defaultDailySkillsProxyBase;
  try {
    const url = new URL(raw);
    const pathOk = !url.pathname || url.pathname === "/";
    if (url.protocol !== "https:" || url.username || url.password || !pathOk || url.search || url.hash) {
      return defaultDailySkillsProxyBase;
    }
    return url.origin;
  } catch {
    return defaultDailySkillsProxyBase;
  }
}

function catalogSkills(catalog) {
  return Array.isArray(catalog?.dailySkills) ? catalog.dailySkills : [];
}

export function findDailySkill(catalog, skillId) {
  const id = cleanText(skillId);
  if (!id) return null;
  return catalogSkills(catalog).find((skill) => skill?.id === id) ?? null;
}

export function findDailySkillEndpoint(skill, endpointId) {
  const endpoints = Array.isArray(skill?.endpoints) ? skill.endpoints : [];
  const id = cleanText(endpointId);
  if (!id) return endpoints.length === 1 ? endpoints[0] : null;
  return endpoints.find((endpoint) => endpoint?.id === id) ?? null;
}

function pathVariableNames(path) {
  return [...String(path ?? "").matchAll(/\{([A-Za-z0-9_]+)\}/gu)].map((match) => match[1]);
}

function normalizeParamValue(spec, raw) {
  if (raw === undefined || raw === null) return { missing: true };
  if (typeof raw === "string" && !raw.trim()) return { missing: true };
  const label = spec.description ? `${spec.name}(${spec.description})` : spec.name;
  switch (spec.type) {
    case "number":
    case "integer": {
      const value = typeof raw === "number" ? raw : Number(cleanText(raw).replace(/,/gu, ""));
      if (!Number.isFinite(value)) return { error: `${label}: 숫자를 넣어 주세요.` };
      if (spec.type === "integer" && !Number.isInteger(value)) return { error: `${label}: 정수를 넣어 주세요.` };
      if (Number.isFinite(spec.min) && value < spec.min) return { error: `${label}: ${spec.min} 이상이어야 해요.` };
      if (Number.isFinite(spec.max) && value > spec.max) return { error: `${label}: ${spec.max} 이하여야 해요.` };
      return { value: String(value) };
    }
    case "boolean": {
      if (raw === true || raw === false) return { value: String(raw) };
      const text = cleanText(raw).toLowerCase();
      if (text === "true" || text === "false") return { value: text };
      return { error: `${label}: true 또는 false 로 넣어 주세요.` };
    }
    case "enum": {
      const value = cleanText(raw);
      const values = Array.isArray(spec.values) ? spec.values.map((item) => String(item)) : [];
      if (!values.includes(value)) return { error: `${label}: ${values.join(", ")} 중 하나여야 해요.` };
      return { value };
    }
    default: {
      if (typeof raw === "object") return { error: `${label}: 글자로 넣어 주세요.` };
      const value = cleanText(raw);
      const maxLength = Number.isFinite(spec.maxLength) ? spec.maxLength : defaultStringMaxLength;
      if (value.length > maxLength) return { error: `${label}: ${maxLength}자 이하로 넣어 주세요.` };
      if (spec.pattern) {
        let pattern = null;
        try {
          pattern = new RegExp(spec.pattern, "u");
        } catch {
          pattern = null;
        }
        if (pattern && !pattern.test(value)) return { error: `${label}: 형식이 맞지 않아요.` };
      }
      return { value };
    }
  }
}

/**
 * 카탈로그에 선언된 인자만 검증해 돌려준다. 선언되지 않은 인자는 네트워크로 보내지 않고
 * ignored 에 이름만 남긴다(모델이 다음 호출에서 고칠 수 있게).
 */
export function validateDailySkillParams(endpoint, input) {
  const specs = Array.isArray(endpoint?.params)
    ? endpoint.params.filter((spec) => spec && spec.name && paramTypes.has(spec.type ?? "string"))
    : [];
  const source = plainObject(input) ?? {};
  const pathNames = new Set(pathVariableNames(endpoint?.path));
  const query = [];
  const pathValues = {};
  const problems = [];
  const declared = new Set(specs.map((spec) => spec.name));
  for (const spec of specs) {
    let normalized = normalizeParamValue({ ...spec, type: spec.type ?? "string" }, source[spec.name]);
    // 값이 하나뿐인 enum(예: 항상 1·항상 law)과 기본값이 있는 인자는 빠뜨려도 채운다.
    if (normalized.missing) {
      const onlyValue = spec.type === "enum" && Array.isArray(spec.values) && spec.values.length === 1 ? spec.values[0] : undefined;
      const fallback = spec.default !== undefined ? spec.default : onlyValue;
      if (fallback !== undefined) normalized = normalizeParamValue({ ...spec, type: spec.type ?? "string" }, fallback);
    }
    if (normalized.missing) {
      if (spec.required || pathNames.has(spec.name)) {
        problems.push(`${spec.name}${spec.description ? `(${spec.description})` : ""} 값이 필요해요.`);
      }
      continue;
    }
    if (normalized.error) {
      problems.push(normalized.error);
      continue;
    }
    if (pathNames.has(spec.name)) {
      const value = normalized.value;
      if (value === "." || value === ".." || /[\\/?#]/u.test(value)) {
        problems.push(`${spec.name}: 쓸 수 없는 글자가 들어 있어요.`);
        continue;
      }
      pathValues[spec.name] = value;
    } else {
      query.push([spec.name, normalized.value]);
    }
  }
  for (const name of pathNames) {
    if (!declared.has(name)) problems.push(`경로 변수 ${name} 의 정의가 없어요.`);
  }
  const ignored = Object.keys(source).filter((name) => !declared.has(name)).slice(0, 10);
  if (problems.length) return { ok: false, problems, ignored };
  return { ok: true, query, pathValues, ignored };
}

/** 고정 호스트 + 선언 경로로만 주소를 만든다. 결과가 /v1/ 밖이거나 호스트가 바뀌면 거부. */
export function buildDailySkillRequestUrl(base, endpoint, validated) {
  const template = String(endpoint?.path ?? "");
  if (!template.startsWith("/v1/")) throw new Error("daily_skill_path_not_allowed");
  const filled = template.replace(/\{([A-Za-z0-9_]+)\}/gu, (_whole, name) => encodeURIComponent(validated.pathValues[name] ?? ""));
  const baseUrl = new URL(base);
  const url = new URL(filled, baseUrl.origin);
  if (url.origin !== baseUrl.origin || url.protocol !== "https:") throw new Error("daily_skill_host_not_allowed");
  const staticPrefix = template.split("{")[0];
  if (!url.pathname.startsWith("/v1/") || !url.pathname.startsWith(staticPrefix)) throw new Error("daily_skill_path_not_allowed");
  for (const [name, value] of validated.query) url.searchParams.append(name, value);
  return url;
}

function getByPath(value, path) {
  if (!path) return undefined;
  return String(path)
    .split(".")
    .filter(Boolean)
    .reduce((current, key) => (current && typeof current === "object" ? current[key] : undefined), value);
}

// 원천 서버 운영자의 인증값이 링크에 섞여 오는 경우가 있다(예: 법제처 OC=). 모델·화면으로 넘기기 전에 가린다.
const secretQueryPattern = /([?&](?:oc|servicekey|service_key|apikey|api_key|authkey|crtfc_key|key|access_token|token|client_secret|secret)=)[^&\s"'<>#]+/giu;

export function redactDailySkillSecrets(text) {
  return String(text ?? "").replace(secretQueryPattern, "$1***");
}

const weekdayKo = ["일", "월", "화", "수", "목", "금", "토"];
const kmaSkyLabel = { 1: "맑음", 3: "구름많음", 4: "흐림" };
const kmaRainLabel = { 0: "", 1: "비", 2: "비/눈", 3: "눈", 4: "소나기", 5: "빗방울", 6: "빗방울·눈날림", 7: "눈날림" };

function ymdLabel(ymd) {
  const match = /^(\d{4})(\d{2})(\d{2})$/u.exec(String(ymd ?? ""));
  if (!match) return String(ymd ?? "");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return `${match[2]}/${match[3]}(${weekdayKo[date.getUTCDay()]})`;
}

/**
 * 기상청 단기예보(항목 1,000행 안팎)를 날짜별 요약 + 3시간 간격 값으로 바꾼다.
 * 앞쪽 몇 행만 넘기면 "내일 비 와?"에 답할 수 없어서, 예보 기간 전체를 작은 표로 접는다.
 */
function kmaForecastView(data, endpoint) {
  const located = getByPath(data, endpoint.listPath);
  const items = Array.isArray(located) ? located : located && typeof located === "object" ? [located] : [];
  if (!items.length) return null;
  const days = new Map();
  for (const item of items) {
    const date = String(item?.fcstDate ?? "");
    const time = String(item?.fcstTime ?? "");
    const category = String(item?.category ?? "");
    const value = String(item?.fcstValue ?? "");
    if (!date || !category) continue;
    let day = days.get(date);
    if (!day) {
      day = { slots: new Map(), low: null, high: null, temps: [], popMax: 0, rains: new Set(), skies: new Map() };
      days.set(date, day);
    }
    let slot = day.slots.get(time);
    if (!slot) {
      slot = {};
      day.slots.set(time, slot);
    }
    slot[category] = value;
    const numeric = Number.parseFloat(value);
    if (category === "TMN" && Number.isFinite(numeric)) day.low = numeric;
    if (category === "TMX" && Number.isFinite(numeric)) day.high = numeric;
    if (category === "TMP" && Number.isFinite(numeric)) day.temps.push(numeric);
    if (category === "POP" && Number.isFinite(numeric)) day.popMax = Math.max(day.popMax, numeric);
    if (category === "PTY" && value !== "0") day.rains.add(kmaRainLabel[value] || value);
    if (category === "SKY") day.skies.set(value, (day.skies.get(value) ?? 0) + 1);
  }
  const forecast = [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 4)
    .map(([date, day]) => {
      const low = Number.isFinite(day.low) ? day.low : day.temps.length ? Math.min(...day.temps) : null;
      const high = Number.isFinite(day.high) ? day.high : day.temps.length ? Math.max(...day.temps) : null;
      const sky = [...day.skies.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const hourly = [...day.slots.entries()]
        .filter(([time]) => /^(00|03|06|09|12|15|18|21)00$/u.test(time))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([time, slot]) => {
          const weather = slot.PTY && slot.PTY !== "0" ? kmaRainLabel[slot.PTY] || slot.PTY : kmaSkyLabel[slot.SKY] || "";
          return `${time.slice(0, 2)}시 ${slot.TMP ?? "?"}℃ ${weather} 강수${slot.POP ?? "?"}%`.replace(/\s+/gu, " ");
        });
      return {
        날짜: ymdLabel(date),
        최저기온: low,
        최고기온: high,
        하늘: kmaSkyLabel[sky] || "",
        강수확률최대: day.popMax,
        강수형태: day.rains.size ? [...day.rains].join("·") : "없음",
        시간별: hourly.join(" / "),
      };
    });
  const first = items[0] ?? {};
  return {
    발표: [first.baseDate, first.baseTime].filter(Boolean).join(" "),
    단위: "기온 ℃, 강수확률 %",
    단기예보: forecast,
  };
}

/** 카탈로그 endpoint.transform 이름 → 변환 함수. 카탈로그는 이름만 고르고 코드는 여기만 있다. */
const dailySkillTransforms = {
  "kma-forecast": kmaForecastView,
};

const xmlEntities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeXmlText(value) {
  return String(value ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (whole, entity) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return xmlEntities[entity.toLowerCase()] ?? whole;
  });
}

function xmlNodeValue(node) {
  if (!node.children.length) return decodeXmlText(node.text).replace(/\s+/gu, " ").trim();
  const out = {};
  const repeated = new Set();
  for (const child of node.children) {
    const value = xmlNodeValue(child);
    if (!Object.prototype.hasOwnProperty.call(out, child.name)) out[child.name] = value;
    else if (repeated.has(child.name)) out[child.name].push(value);
    else {
      out[child.name] = [out[child.name], value];
      repeated.add(child.name);
    }
  }
  return out;
}

/**
 * 공공데이터 XML 응답(예: response.body.items.item)을 목록 구조로 바꾼다.
 * 속성·네임스페이스는 버리고 태그 이름과 글자만 남긴다. 같은 태그가 반복되면 배열이 된다.
 * 실패하면 null(호출부가 글자 그대로 쓴다).
 */
export function parseSimpleXml(source) {
  const text = String(source ?? "")
    .replace(/^\uFEFF/u, "")
    .replace(/<\?[\s\S]*?\?>/gu, "")
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/<!DOCTYPE[^>]*>/giu, "");
  if (!/^\s*</u.test(text)) return null;
  const tokens = /<!\[CDATA\[([\s\S]*?)\]\]>|<\/([A-Za-z_][\w:.-]*)\s*>|<([A-Za-z_][\w:.-]*)(?:\s[^<>]*?)?(\/?)>|([^<]+)/gu;
  const root = { name: "#root", children: [], text: "" };
  const stack = [root];
  let match;
  let steps = 0;
  while ((match = tokens.exec(text))) {
    steps += 1;
    if (steps > 200_000) break;
    const [, cdata, closeName, openName, selfClose, chunk] = match;
    const top = stack[stack.length - 1];
    if (cdata !== undefined) {
      top.text += cdata;
    } else if (closeName) {
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].name === closeName) {
          stack.length = index;
          break;
        }
      }
    } else if (openName) {
      const node = { name: openName.includes(":") ? openName.split(":").pop() : openName, children: [], text: "" };
      top.children.push(node);
      if (!selfClose && stack.length < 32) stack.push(node);
    } else if (chunk) {
      top.text += chunk;
    }
  }
  if (!root.children.length) return null;
  return xmlNodeValue(root);
}

function stripNoise(value, depth = 0) {
  if (typeof value === "string") {
    const text = redactDailySkillSecrets(value.replace(/<[^>]{0,200}>/gu, " ").replace(/&nbsp;/gu, " ").replace(/\s+/gu, " ").trim());
    return text.length > 300 ? `${text.slice(0, 299)}…` : text;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => stripNoise(item, depth + 1));
  if (value && typeof value === "object") {
    if (depth > 6) return "…";
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      if (item === null || item === undefined || item === "") continue;
      out[key] = stripNoise(item, depth + 1);
    }
    return out;
  }
  return value;
}

function pickFields(item, fields) {
  if (!Array.isArray(fields) || !fields.length || !item || typeof item !== "object") return item;
  const out = {};
  for (const field of fields) {
    const value = getByPath(item, field);
    if (value !== undefined && value !== null && value !== "") out[field] = value;
  }
  return Object.keys(out).length ? out : item;
}

/** 목록 옆에 붙어 오는 요약 값(전체 건수, 중위·최소·최대 가격 같은 작은 객체)을 함께 넘긴다. */
function topLevelMeta(data, excludeKey) {
  const out = {};
  const record = plainObject(data);
  if (!record) return out;
  for (const [key, value] of Object.entries(record)) {
    // proxy: 중계 서버 캐시·요청 시각 같은 운영 정보라 모델 근거로 쓸 값이 아니다.
    if (key === excludeKey || key === "proxy") continue;
    if (["string", "number", "boolean"].includes(typeof value)) {
      if (String(value).length <= 120) out[key] = typeof value === "string" ? redactDailySkillSecrets(value) : value;
    } else if (plainObject(value)) {
      const cleaned = stripNoise(value);
      if (JSON.stringify(cleaned).length <= 600) out[key] = cleaned;
    }
    if (Object.keys(out).length >= 8) break;
  }
  return out;
}

/** 모델 관찰용으로 줄인다. 목록이면 앞쪽 항목의 핵심 필드만, 아니면 잡음을 걷어 낸 원본. */
export function compactDailySkillData(data, endpoint, maxChars = defaultModelMaxChars) {
  if (typeof data === "string") {
    const text = redactDailySkillSecrets(data.replace(/<[^>]{0,200}>/gu, " ").replace(/\s+/gu, " ").trim());
    const truncated = text.length > maxChars;
    return { text: truncated ? `${text.slice(0, maxChars - 1)}…` : text, truncated, itemCount: null };
  }
  const transform = endpoint?.transform ? dailySkillTransforms[endpoint.transform] : null;
  if (transform) {
    const transformed = transform(data, endpoint);
    if (transformed) {
      const serialized = JSON.stringify(transformed);
      const source = endpoint?.listPath ? getByPath(data, endpoint.listPath) : undefined;
      const count = Array.isArray(source) ? source.length : source ? 1 : null;
      return serialized.length > maxChars
        ? { text: `${serialized.slice(0, maxChars - 1)}…`, truncated: true, itemCount: count }
        : { text: serialized, truncated: false, itemCount: count };
    }
  }
  const located = endpoint?.listPath ? getByPath(data, endpoint.listPath) : undefined;
  // XML 은 항목이 하나면 배열이 아니라 객체가 된다. 목록 경로로 선언된 곳이면 한 건짜리 목록으로 본다.
  const list = Array.isArray(located) ? located : located && typeof located === "object" ? [located] : located;
  let view;
  let itemCount = null;
  if (Array.isArray(list)) {
    itemCount = list.length;
    const meta = topLevelMeta(data, String(endpoint.listPath ?? "").split(".")[0]);
    let limit = 8;
    for (;;) {
      view = { 전체건수: list.length, 항목: list.slice(0, limit).map((item) => stripNoise(pickFields(item, endpoint.fields))) };
      if (Object.keys(meta).length) view.정보 = meta;
      if (JSON.stringify(view).length <= maxChars || limit <= 1) break;
      limit = Math.max(1, Math.floor(limit / 2));
    }
  } else {
    view = stripNoise(data);
  }
  let text = typeof view === "string" ? view : JSON.stringify(view);
  let truncated = false;
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars - 1)}…`;
    truncated = true;
  }
  return { text, truncated, itemCount };
}

function errorResult(code, userMessage, extra = {}) {
  return { ok: false, status: `daily_skill_${code}`, code, userMessage, ...extra };
}

async function readBodyWithLimit(response, maxBytes, abort) {
  const declared = Number(response?.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    abort();
    return { tooLarge: true };
  }
  const body = response?.body;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.byteLength;
      if (total > maxBytes) {
        abort();
        try {
          await reader.cancel();
        } catch {
          // 이미 끊긴 스트림
        }
        return { tooLarge: true };
      }
      chunks.push(chunk);
    }
    return { text: Buffer.concat(chunks).toString("utf8"), bytes: total };
  }
  const text = typeof response?.text === "function" ? await response.text() : "";
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > maxBytes) return { tooLarge: true };
  return { text, bytes };
}

function serverMessage(text) {
  try {
    const parsed = JSON.parse(text);
    const record = plainObject(parsed);
    const message = record?.message ?? record?.error?.message ?? record?.error ?? record?.detail;
    return typeof message === "string" ? cleanText(message).slice(0, 200) : "";
  } catch {
    return "";
  }
}

/** 화면에 보여 줄 공개 카탈로그(실행 경로·검증 기록은 빼고 사용법만). */
export function toPublicDailySkillCatalog(catalog, base = defaultDailySkillsProxyBase) {
  const categories = Array.isArray(catalog?.dailySkillCategories) ? catalog.dailySkillCategories : [];
  return {
    version: String(catalog?.dailySkillCatalogVersion ?? ""),
    proxy: {
      host: new URL(base).host,
      provider: dailySkillsProxyProvider,
      license: "k-skill (MIT)",
    },
    categories: categories.map((category) => ({ id: String(category.id), label: String(category.label) })),
    skills: catalogSkills(catalog).map((skill) => ({
      id: String(skill.id),
      name: String(skill.name ?? skill.id),
      category: String(skill.category ?? ""),
      summary: String(skill.summary ?? ""),
      examples: Array.isArray(skill.examples) ? skill.examples.map(String).slice(0, 4) : [],
      keywords: Array.isArray(skill.keywords) ? skill.keywords.map(String).slice(0, 20) : [],
      source: String(skill.source ?? ""),
      notes: skill.notes ? String(skill.notes) : "",
      endpoints: (Array.isArray(skill.endpoints) ? skill.endpoints : []).map((endpoint) => ({
        id: String(endpoint.id),
        summary: String(endpoint.summary ?? ""),
        // 값이 하나뿐인 enum 은 런타임이 채우므로 화면·모델에는 보이지 않는다(프롬프트를 줄이고 실수를 막음).
        params: (Array.isArray(endpoint.params) ? endpoint.params : [])
          .filter((param) => !(param.type === "enum" && Array.isArray(param.values) && param.values.length === 1))
          .map((param) => ({
          name: String(param.name),
          type: String(param.type ?? "string"),
          required: Boolean(param.required) || pathVariableNames(endpoint.path).includes(param.name),
          description: param.description ? String(param.description) : "",
          ...(Array.isArray(param.values) ? { values: param.values.map(String) } : {}),
          ...(Number.isFinite(param.min) ? { min: param.min } : {}),
          ...(Number.isFinite(param.max) ? { max: param.max } : {}),
        })),
      })),
    })),
  };
}

/**
 * 조회 클라이언트. fetchImpl·now 를 주입할 수 있어 테스트가 네트워크 없이 경계를 검증한다.
 */
export function createDailySkillsProxyClient(options = {}) {
  const catalog = options.catalog;
  const fetchImpl = typeof options.fetchImpl === "function" ? options.fetchImpl : globalThis.fetch;
  const base = options.base ?? resolveDailySkillsProxyBase(options.env);
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : defaultTimeoutMs;
  const maxBytes = Number.isFinite(options.maxResponseBytes) ? options.maxResponseBytes : defaultMaxResponseBytes;
  const cacheTtlMs = Number.isFinite(options.cacheTtlMs) ? options.cacheTtlMs : defaultCacheTtlMs;
  const rateLimit = Number.isFinite(options.rateLimitPerMinute) ? options.rateLimitPerMinute : defaultRateLimitPerMinute;
  const modelMaxChars = Number.isFinite(options.modelMaxChars) ? options.modelMaxChars : defaultModelMaxChars;
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const userAgent = `ModyCrew/${cleanText(options.appVersion) || "dev"} (daily-skills)`;
  const cache = new Map();
  const recent = [];

  function takeRateSlot() {
    const current = now();
    while (recent.length && current - recent[0] > 60_000) recent.shift();
    if (recent.length >= rateLimit) return false;
    recent.push(current);
    return true;
  }

  async function lookup(request = {}) {
    const skill = findDailySkill(catalog, request.skillId);
    if (!skill) return errorResult("unknown_skill", "등록되지 않은 일상 도구예요. 목록에 있는 도구만 쓸 수 있어요.");
    const endpoint = findDailySkillEndpoint(skill, request.endpointId);
    if (!endpoint) {
      const ids = (skill.endpoints ?? []).map((item) => item.id).join(", ");
      return errorResult("unknown_endpoint", `${skill.name} 도구에는 그런 조회 항목이 없어요. 쓸 수 있는 항목: ${ids}`, { skillId: skill.id });
    }
    const validated = validateDailySkillParams(endpoint, request.params);
    if (!validated.ok) {
      return errorResult("invalid_params", `조회 조건을 확인해 주세요. ${validated.problems.join(" ")}`, {
        skillId: skill.id,
        endpointId: endpoint.id,
        problems: validated.problems,
      });
    }
    let url;
    try {
      url = buildDailySkillRequestUrl(base, endpoint, validated);
    } catch {
      return errorResult("path_not_allowed", "허용되지 않은 조회 경로라 보내지 않았어요.", { skillId: skill.id, endpointId: endpoint.id });
    }
    const cacheKey = url.toString();
    const cached = cache.get(cacheKey);
    if (cached && now() - cached.storedAt <= cacheTtlMs) {
      return { ...cached.result, cached: true };
    }
    if (typeof fetchImpl !== "function") return errorResult("network", "이 환경에서는 조회 서버에 연결할 수 없어요.");
    if (!takeRateSlot()) {
      return errorResult("rate_limited", "짧은 시간에 조회가 너무 많아 잠시 멈췄어요. 1분 뒤 다시 시도해 주세요.", { skillId: skill.id });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = now();
    let response;
    let body;
    try {
      response = await fetchImpl(url.toString(), {
        method: "GET",
        headers: { accept: "application/json", "user-agent": userAgent },
        redirect: "error",
        signal: controller.signal,
      });
      body = await readBodyWithLimit(response, maxBytes, () => controller.abort());
    } catch (error) {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        return errorResult("timeout", `조회 서버가 ${Math.round(timeoutMs / 1000)}초 안에 답하지 않았어요. 잠시 뒤 다시 시도해 주세요.`, { skillId: skill.id });
      }
      return errorResult("network", "조회 서버에 연결하지 못했어요. 인터넷 연결을 확인하거나 잠시 뒤 다시 시도해 주세요.", {
        skillId: skill.id,
        detail: cleanText(error?.message).slice(0, 160),
      });
    }
    clearTimeout(timer);
    if (body?.tooLarge) {
      return errorResult("too_large", "응답이 너무 커서 읽지 않았어요. 조건을 좁혀서 다시 물어봐 주세요.", { skillId: skill.id });
    }
    const status = Number(response?.status ?? 0);
    if (status < 200 || status >= 300) {
      const message = serverMessage(body?.text ?? "");
      return errorResult("http_error", `조회 서버가 오류를 돌려줬어요 (HTTP ${status}).${message ? ` ${message}` : ""}`, {
        skillId: skill.id,
        endpointId: endpoint.id,
        httpStatus: status,
      });
    }
    let data;
    try {
      data = JSON.parse(body?.text ?? "");
    } catch {
      const raw = String(body?.text ?? "");
      const xml = parseSimpleXml(raw);
      if (xml && typeof xml === "object") {
        data = xml;
      } else {
        const text = cleanText(raw);
        if (!text) return errorResult("bad_json", "조회 결과가 비어 있어요.", { skillId: skill.id });
        data = text;
      }
    }
    const compact = compactDailySkillData(data, endpoint, modelMaxChars);
    const result = {
      ok: true,
      status: "daily_skill_loaded",
      skillId: skill.id,
      skillName: String(skill.name ?? skill.id),
      endpointId: endpoint.id,
      endpointSummary: String(endpoint.summary ?? ""),
      source: String(skill.source ?? ""),
      provider: dailySkillsProxyProvider,
      fetchedAt: new Date(now()).toISOString(),
      elapsedMs: Math.max(0, now() - startedAt),
      httpStatus: status,
      bytes: body?.bytes ?? 0,
      itemCount: compact.itemCount,
      truncated: compact.truncated,
      ignoredParams: validated.ignored,
      dataText: compact.text,
      userMessage: `${skill.name} 조회 완료`,
    };
    cache.set(cacheKey, { storedAt: now(), result });
    while (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value);
    return result;
  }

  return {
    base,
    lookup,
    publicCatalog: () => toPublicDailySkillCatalog(catalog, base),
  };
}
