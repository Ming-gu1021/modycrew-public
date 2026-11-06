/**
 * 크루 스킬 확장 패키지 — 선택형(optional) 크루 스킬의 추가·업데이트·되돌리기와 동봉 스킬의 무결성 확인.
 *
 * 신뢰 기준은 앱 설치본에 들어 있는 카탈로그(crew-skills/catalog.json)다. 화면이나 웹사이트가 다운로드 주소·해시를
 * 넘길 수 없다(기존 PDF 기능 모듈과 같은 방식). 카탈로그는 도메인 정본과 SKILL.md 폴더 해시로 만들고 테스트가 지킨다.
 *
 * 추가 흐름: 사전 점검(카탈로그·호환·의존 실행기) → 권한 확인(늘어난 권한은 사용자 승인) → 패키지 받기(지금은 앱에
 * 동봉한 원본에서 복사, 네트워크 사용 없음) → 무결성 확인(SHA-256) → 임시 폴더 설치 → 자체 검사 → 사용 가능.
 *   - 실행 파일은 받지 않는다. 문서(.md·.txt·.json)만 설치하고, 실행 권한은 앱의 확인 창·폴더 권한이 정한다.
 *   - 이전 정상 버전을 남겨 되돌릴 수 있게 하고, 카탈로그가 막은 버전은 쓰지 않는다.
 *   - 사용자의 실행 기록·결과(crew-skill-runs)는 패키지와 따로 저장돼 추가·제거·되돌리기에 영향받지 않는다.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const defaultBundledCatalogPath = path.join(moduleDir, "crew-skills", "catalog.json");
export const crewSkillCatalogSchema = "modycrew.crew-skill-catalog.v1";
const stateSchema = "modycrew.crew-skill-packages.v1";
const allowedPackageExtensions = new Set([".md", ".txt", ".json"]);
const maxPackageBytes = 2 * 1024 * 1024;
const maxPackageFiles = 60;
const namePattern = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const versionPattern = /^\d+\.\d+\.\d+$/u;
const auditForbiddenTools = ["Write", "Edit", "Bash"];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const result = (status, userMessage, extra = {}) => ({ status, userMessage, ...extra });

export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

/** 패키지 안 파일 경로 검사: 상대 경로·숨김 파일 없음·문서 확장자만. */
function safeRelativeParts(rel) {
  const value = String(rel ?? "");
  if (!value || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/u.test(value)) return null;
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.startsWith("."))) return null;
  if (!allowedPackageExtensions.has(path.extname(value).toLowerCase())) return null;
  return parts;
}

/**
 * 폴더 내용 해시: 상대 경로 순서대로 "경로\0내용해시\n" 을 이어 해시한다. 줄바꿈은 LF 로 맞춰 운영체제 차이를 없앤다.
 * 숨김 파일·심볼릭 링크는 건너뛰고, 허용하지 않은 확장자나 크기·개수 초과가 있으면 오류다.
 */
export async function hashSkillFolder(dir, { io = fs } = {}) {
  const files = [];
  let bytes = 0;
  const visit = async (folder, prefix) => {
    const entries = await io.readdir(folder, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink?.()) continue;
      const rel = prefix ? prefix + "/" + entry.name : entry.name;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) { await visit(full, rel); continue; }
      if (!entry.isFile()) continue;
      if (!safeRelativeParts(rel)) throw new Error("패키지에 허용하지 않는 파일이 있습니다: " + rel);
      files.push(rel);
      if (files.length > maxPackageFiles) throw new Error("패키지 파일이 너무 많습니다.");
    }
  };
  await visit(dir, "");
  files.sort();
  const hash = createHash("sha256");
  for (const rel of files) {
    const content = String(await io.readFile(path.join(dir, ...rel.split("/")), "utf8")).replace(/\r\n/gu, "\n");
    bytes += Buffer.byteLength(content);
    if (bytes > maxPackageBytes) throw new Error("패키지가 너무 큽니다(2MB 초과).");
    hash.update(rel + "\0" + sha256(content) + "\n");
  }
  return { sha256: hash.digest("hex"), files };
}

export async function readBundledCatalog(file = defaultBundledCatalogPath, { io = fs } = {}) {
  const catalog = JSON.parse(await io.readFile(file, "utf8"));
  if (catalog?.schema !== crewSkillCatalogSchema || !Array.isArray(catalog.skills)) throw new Error("크루 스킬 카탈로그 형식을 확인하지 못했습니다.");
  return catalog;
}

function frontMatter(source) {
  const match = String(source ?? "").replace(/^\uFEFF/u, "").match(/^---\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/u);
  if (!match) return null;
  const field = (key) => (match[1].match(new RegExp("^" + key + ":[ \\t]*(.*)$", "mu"))?.[1] ?? "").trim().replace(/^['"]|['"]$/gu, "");
  return { name: field("name"), description: field("description"), allowedTools: field("allowed-tools").split(/[,\s]+/u).filter(Boolean), body: match[2].trim() };
}

/** 자체 검사: SKILL.md 형식, 카탈로그와 이름·설명 일치, 실행 프로필과 도구 선언의 모순 여부. */
export async function selfTestSkillFolder(dir, entry, { io = fs } = {}) {
  const problems = [];
  let doc = null;
  try { doc = frontMatter(await io.readFile(path.join(dir, "SKILL.md"), "utf8")); } catch { problems.push("SKILL.md를 읽지 못했습니다."); }
  if (doc === null && !problems.length) problems.push("SKILL.md 머리말 형식이 올바르지 않습니다.");
  if (doc) {
    if (doc.name !== entry.name) problems.push("SKILL.md 이름이 카탈로그와 다릅니다.");
    if (doc.description !== entry.description) problems.push("SKILL.md 설명이 카탈로그와 다릅니다.");
    if (doc.body.length < 200) problems.push("지침 본문이 비어 있습니다.");
    if (entry.profile === "audit" && doc.allowedTools.some((tool) => auditForbiddenTools.includes(tool))) problems.push("읽기 전용 점검 스킬이 쓰기·명령 도구를 요구합니다.");
  }
  return { ok: problems.length === 0, problems };
}

/** 동봉 스킬 하나의 무결성. 카탈로그에 없거나 해시가 다르면 ok:false. */
export async function verifyBundledSkill(name, { catalog, libraryRoot, io = fs }) {
  const entry = catalog?.skills?.find((skill) => skill.name === name);
  if (!entry?.integrity?.sha256) return { ok: false, reason: "카탈로그에 등록되지 않은 스킬입니다." };
  try {
    const { sha256: actual } = await hashSkillFolder(path.join(libraryRoot, name), { io });
    return actual === entry.integrity.sha256
      ? { ok: true, sha256: actual }
      : { ok: false, sha256: actual, reason: "스킬 파일이 카탈로그와 다릅니다(무결성 확인 실패). 앱을 다시 설치하거나 이전 버전으로 되돌려 주세요." };
  } catch (error) {
    return { ok: false, reason: "스킬 파일을 확인하지 못했습니다: " + String(error?.message ?? error) };
  }
}

/**
 * 설치 상태 저장소. stateRoot/installed.json 에 활성·이전 버전을 원자 저장하고,
 * 패키지 파일은 stateRoot/packages/<이름>/<버전> 에 둔다. 한 번에 한 작업만 한다(직렬 실행).
 */
export function createCrewSkillPackageStore(options = {}) {
  const io = options.io ?? fs;
  const stateRoot = options.stateRoot;
  if (!stateRoot) throw new Error("확장 패키지 저장 위치가 필요합니다.");
  const libraryRoot = options.libraryRoot;
  const loadCatalog = options.loadCatalog ?? (() => readBundledCatalog(options.catalogPath ?? defaultBundledCatalogPath, { io }));
  const now = options.now ?? (() => new Date());
  const stateFile = path.join(stateRoot, "installed.json");
  const packagesRoot = path.join(stateRoot, "packages");
  let queue = Promise.resolve();
  const serial = (task) => { const run = queue.then(task, task); queue = run.catch(() => undefined); return run; };

  const packageDir = (name, version) => {
    if (!namePattern.test(name) || !versionPattern.test(version)) throw new Error("패키지 이름이나 버전이 올바르지 않습니다.");
    return path.join(packagesRoot, name, version);
  };

  async function readState() {
    try {
      const data = JSON.parse(await io.readFile(stateFile, "utf8"));
      return data?.schema === stateSchema && data.skills && typeof data.skills === "object" ? data : { schema: stateSchema, skills: {} };
    } catch (error) {
      if (error.code === "ENOENT") return { schema: stateSchema, skills: {} };
      throw new Error("확장 설치 기록을 읽지 못했습니다. 원본 파일은 그대로 두었습니다.");
    }
  }

  async function writeState(state) {
    await io.mkdir(stateRoot, { recursive: true });
    const pending = stateFile + "." + process.pid + "." + randomUUID() + ".pending";
    await io.writeFile(pending, JSON.stringify(state, null, 2), "utf8");
    await io.rename(pending, stateFile);
  }

  async function entryFor(name) {
    const clean = String(name ?? "").trim();
    if (!namePattern.test(clean)) throw new Error("확장 이름을 다시 선택해 주세요.");
    const catalog = await loadCatalog();
    const entry = catalog.skills.find((skill) => skill.name === clean);
    if (!entry) throw new Error("카탈로그에 없는 확장입니다.");
    return { catalog, entry };
  }

  async function installedIntegrity(record) {
    if (!record?.version || !record.sha256) return { ok: false, reason: "설치 기록이 없습니다." };
    try {
      const { sha256: actual } = await hashSkillFolder(packageDir(record.name, record.version), { io });
      return actual === record.sha256 ? { ok: true } : { ok: false, reason: "설치된 파일이 바뀌었습니다(패키지 손상)." };
    } catch (error) {
      return { ok: false, reason: "설치된 파일을 확인하지 못했습니다: " + String(error?.message ?? error) };
    }
  }

  /** 상태 조회: 설치 여부, 무결성, 업데이트·권한 확대, 막힌 버전. */
  async function status(name) {
    const { entry } = await entryFor(name);
    const state = await readState();
    const current = state.skills[entry.name] ?? null;
    const active = current?.active ?? null;
    const integrity = active ? await installedIntegrity(active) : null;
    const blocked = active ? (entry.blockedVersions ?? []).includes(active.version) : false;
    const updateAvailable = Boolean(active && compareVersions(entry.version, active.version) > 0);
    const addedPermissions = active ? entry.permissions.filter((permission) => !(active.permissions ?? []).includes(permission)) : entry.permissions;
    return {
      name: entry.name, availability: entry.availability, catalogVersion: entry.version,
      installed: Boolean(active && integrity?.ok && !blocked), activeVersion: active?.version ?? "", previousVersion: current?.previous?.version ?? "",
      integrityOk: integrity ? integrity.ok : null, integrityProblem: integrity && !integrity.ok ? integrity.reason : "",
      blocked, updateAvailable, addedPermissions, permissions: entry.permissions, disabledReason: current?.disabledReason ?? "",
    };
  }

  /**
   * 추가·업데이트. approvedPermissions 에 이번 버전의 권한이 모두 있어야 한다(확인 창에서 사용자가 승인한 목록).
   * precheck 는 실행기 로그인·MCP 연결 같은 의존 조건을 확인하는 함수다(실패하면 설치하지 않는다).
   */
  function install(name, { approvedPermissions = [], precheck } = {}) {
    return serial(async () => {
      const steps = [];
      const { entry } = await entryFor(name);
      if (entry.availability !== "optional") return result("not_needed", "기본 탑재 스킬이라 따로 추가하지 않아도 됩니다.", { steps });
      if ((entry.blockedVersions ?? []).includes(entry.version)) return result("blocked", "이 버전은 문제로 중단돼 설치하지 않습니다.", { steps });
      steps.push("사전 점검: 카탈로그 " + entry.version);
      if (precheck) {
        const check = await precheck(entry);
        if (!check?.ok) return result("precheck_failed", check?.userMessage || "설치 조건을 확인하지 못했습니다.", { steps: [...steps, "사전 점검 실패"], missing: check?.missing ?? [] });
        steps.push("사전 점검 통과: " + (check.summary || "의존 조건 확인"));
      }
      const state = await readState();
      const previous = state.skills[entry.name]?.active ?? null;
      const granted = new Set(approvedPermissions);
      const missingApproval = entry.permissions.filter((permission) => !granted.has(permission));
      const expanded = previous ? entry.permissions.filter((permission) => !(previous.permissions ?? []).includes(permission)) : entry.permissions;
      if (missingApproval.length) return result("needs_approval", "추가하려면 권한 승인이 필요합니다.", { steps, permissions: entry.permissions, expanded });
      steps.push("권한 승인: " + (entry.permissions.join(", ") || "없음") + (previous && expanded.length ? " (늘어난 권한 " + expanded.join(", ") + ")" : ""));
      if (previous && previous.version === entry.version && (await installedIntegrity(previous)).ok) return result("installed", "이미 같은 버전이 설치돼 있습니다.", { steps, version: entry.version });
      // 받기: 지금은 앱에 동봉한 원본에서 복사한다. 원격 받기는 카탈로그에 고정 해시가 있는 주소만 허용할 예정이다.
      const source = path.join(libraryRoot, entry.name);
      const target = packageDir(entry.name, entry.version);
      const staging = path.join(packagesRoot, entry.name, "." + entry.version + "-" + randomUUID() + ".pending");
      try {
        const listed = await hashSkillFolder(source, { io });
        if (listed.sha256 !== entry.integrity?.sha256) return result("integrity_failed", "앱에 동봉된 패키지가 카탈로그와 다릅니다. 설치하지 않았습니다.", { steps: [...steps, "받기 전 무결성 실패"] });
        await io.mkdir(staging, { recursive: true });
        for (const rel of listed.files) {
          const dest = path.join(staging, ...rel.split("/"));
          await io.mkdir(path.dirname(dest), { recursive: true });
          await io.writeFile(dest, await io.readFile(path.join(source, ...rel.split("/"))));
        }
        steps.push("패키지 받기: 앱 동봉 원본 " + listed.files.length + "개 파일(네트워크 사용 없음)");
        const copied = await hashSkillFolder(staging, { io });
        if (copied.sha256 !== entry.integrity.sha256) throw Object.assign(new Error("받은 패키지의 무결성 확인에 실패했습니다."), { code: "INTEGRITY" });
        steps.push("무결성 확인: SHA-256 " + copied.sha256.slice(0, 12));
        const test = await selfTestSkillFolder(staging, entry, { io });
        if (!test.ok) throw Object.assign(new Error("자체 검사 실패: " + test.problems.join(" ")), { code: "SELFTEST" });
        steps.push("자체 검사 통과");
        await io.rm(target, { recursive: true, force: true });
        await io.mkdir(path.dirname(target), { recursive: true });
        await io.rename(staging, target);
        const record = { name: entry.name, version: entry.version, sha256: copied.sha256, permissions: [...entry.permissions], installedAt: now().toISOString(), source: "bundled" };
        const keepPrevious = previous && previous.version !== entry.version ? previous : state.skills[entry.name]?.previous ?? null;
        state.skills[entry.name] = { active: record, ...(keepPrevious ? { previous: keepPrevious } : {}) };
        await writeState(state);
        steps.push("사용 가능");
        return result("installed", entry.name + " " + entry.version + " 추가를 마쳤습니다.", { steps, version: entry.version, previousVersion: keepPrevious?.version ?? "" });
      } catch (error) {
        await io.rm(staging, { recursive: true, force: true }).catch(() => undefined);
        const status = error?.code === "INTEGRITY" ? "integrity_failed" : error?.code === "SELFTEST" ? "selftest_failed" : "failed";
        return result(status, String(error?.message ?? error) + " 이전 상태를 그대로 두었습니다.", { steps });
      }
    });
  }

  /** 이전 정상 버전으로 되돌린다. 이전 버전 파일이 손상됐으면 되돌리지 않는다. */
  function rollback(name) {
    return serial(async () => {
      const { entry } = await entryFor(name);
      const state = await readState();
      const current = state.skills[entry.name];
      if (!current?.previous) return result("no_previous", "되돌릴 이전 버전이 없습니다.");
      const check = await installedIntegrity(current.previous);
      if (!check.ok) return result("integrity_failed", "이전 버전 파일이 손상돼 되돌리지 않았습니다. " + check.reason);
      if ((entry.blockedVersions ?? []).includes(current.previous.version)) return result("blocked", "이전 버전도 중단된 버전이라 되돌리지 않았습니다.");
      state.skills[entry.name] = { active: current.previous, ...(current.active ? { previous: current.active } : {}) };
      await writeState(state);
      return result("rolled_back", entry.name + "을 " + current.previous.version + " 버전으로 되돌렸습니다.", { version: current.previous.version });
    });
  }

  /** 확장 제거. 패키지 파일만 지우고 실행 기록·결과는 건드리지 않는다. */
  function remove(name) {
    return serial(async () => {
      const { entry } = await entryFor(name);
      const state = await readState();
      if (!state.skills[entry.name]) return result("not_installed", "추가돼 있지 않습니다.");
      delete state.skills[entry.name];
      await writeState(state);
      await io.rm(path.join(packagesRoot, entry.name), { recursive: true, force: true });
      return result("removed", entry.name + " 확장을 뺐습니다. 실행 기록과 결과 파일은 그대로 있습니다.");
    });
  }

  /**
   * 실행 직전 확인: 활성 버전의 폴더 위치. 막힌 버전이면 이전 정상 버전으로 자동 전환하고, 손상이면 실행하지 않는다.
   */
  function resolveInstalled(name) {
    return serial(async () => {
      const { entry } = await entryFor(name);
      const state = await readState();
      const current = state.skills[entry.name];
      if (!current?.active) return { ok: false, status: "not_installed", userMessage: entry.name + " 확장이 아직 추가되지 않았습니다. 확장 화면에서 추가한 뒤 다시 실행해 주세요." };
      let active = current.active;
      if ((entry.blockedVersions ?? []).includes(active.version)) {
        const fallback = current.previous && !(entry.blockedVersions ?? []).includes(current.previous.version) && (await installedIntegrity(current.previous)).ok ? current.previous : null;
        if (!fallback) return { ok: false, status: "blocked", userMessage: "설치된 버전이 문제로 중단됐고 되돌릴 정상 버전이 없습니다. 확장 화면에서 다시 추가해 주세요." };
        state.skills[entry.name] = { active: fallback, previous: active, disabledReason: active.version + " 중단으로 " + fallback.version + " 사용" };
        await writeState(state);
        active = fallback;
      }
      const check = await installedIntegrity(active);
      if (!check.ok) return { ok: false, status: "integrity_failed", userMessage: check.reason + " 확장 화면에서 다시 추가하거나 이전 버전으로 되돌려 주세요." };
      return { ok: true, dir: packageDir(active.name, active.version), version: active.version, sha256: active.sha256 };
    });
  }

  return { status, install, rollback, remove, resolveInstalled, readState };
}
