/**
 * 내 스킬 보관함 — 사용자가 만들어 달라고 했거나 준 스킬을 앱 데이터에 버전별로 보관하고 최신으로 유지한다.
 *
 * 보관하는 것: 출처(우리 웹사이트·깃허브 주소+커밋·사용자 폴더·이 PC 스킬·앱이 새로 만듦), 버전, SHA-256(sha256-lf-tree),
 * 보관·배포 시각, 변경 이력, 이 스킬을 쓰는 직원, 웹사이트 게시 후보 표시.
 *
 * 지키는 것
 *   - 버전 폴더(store/<이름>/<버전>~<해시12>)는 한 번 쓰면 바꾸지 않는다. 새 버전이 와도 이전 버전을 함께 남긴다(최대 6개).
 *   - 실제로 쓰는 사본(배포본)은 공용 스킬 폴더(~/.agents/skills/<이름>)에 둔다. 크루 스킬 실행기·Codex·Claude·Gemini CLI 가
 *     같은 Agent Skills 폴더를 읽으므로 어느 AI가 연결돼 있어도 같은 스킬을 쓴다.
 *   - 배포본을 사용자가 직접 고쳤으면 덮어쓰지 않는다. '업데이트 있음 — 비교 후 적용'으로 남기고, 사용자가 고르면
 *     고친 사본을 먼저 새 버전으로 보관한 뒤 바꾼다.
 *   - 갱신은 임시 폴더에 쓰고 해시를 확인한 뒤 바꿔 넣는다. 실패하면 이전 배포본과 활성 버전을 되돌리고 이력에 남긴다.
 *   - 원격 확인은 고정 호스트만 쓴다(api.github.com·raw.githubusercontent.com). 다른 주소로 넘겨주는 응답은 받지 않는다.
 *   - 실행 파일·이미지 같은 바이너리는 보관하지 않는다(문서·스크립트 텍스트만). 스크립트를 실행하지 않는다.
 *   - 이 모듈은 '앱 안의 내 스킬'만 다룬다. PC 전역 도구 업데이트는 다른 관리 작업의 범위다.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";

export const skillLibrarySchema = "modycrew.skill-library.v1";
export const skillHashAlgorithm = "sha256-lf-tree";
export const skillNamePattern = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const textExtensions = new Set([".md", ".txt", ".json", ".ps1", ".psm1", ".psd1", ".mjs", ".js", ".cjs", ".ts", ".py", ".sh", ".bat", ".cmd", ".yaml", ".yml", ".toml", ".csv", ".tsv", ".xml", ".html", ".css", ".svg", ".ini", ".cfg"]);
const limits = Object.freeze({ files: 80, bytes: 4 * 1024 * 1024, fileBytes: 1024 * 1024, depth: 6, history: 60, versions: 6, usedBy: 40 });
export const remoteCheckIntervalMs = 6 * 60 * 60 * 1000;
const originKinds = new Set(["app_template", "app_draft", "ai_draft", "github", "user_folder", "website", "app_bundled", "this_pc"]);
export const skillOriginLabels = Object.freeze({
  app_template: "앱 템플릿으로 새로 만듦",
  app_draft: "앱 기본 지침으로 새로 만듦",
  ai_draft: "AI 초안으로 새로 만듦",
  github: "깃허브에서 가져옴",
  user_folder: "내 폴더에서 가져옴",
  website: "우리 웹사이트(mody.ai.kr)",
  app_bundled: "모디크루 앱에 포함",
  this_pc: "이 PC 스킬",
});
export const skillUpdateStatusLabels = Object.freeze({
  up_to_date: "최신",
  update_available: "새 버전 있음",
  update_available_modified: "업데이트 있음 — 비교 후 적용",
  modified_locally: "직접 고친 내용 있음",
  app_update_needed: "앱 업데이트 뒤 받을 수 있음",
  source_changed: "원본이 바뀜(원래 위치에서 관리)",
  source_missing: "원본을 찾지 못함",
  local_only: "원본 없음(앱 안에서만 관리)",
  check_failed: "확인 실패",
  not_checked: "아직 확인 안 함",
});

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const clip = (value, max) => String(value ?? "").trim().slice(0, max);
const result = (status, userMessage, extra = {}) => ({ status, userMessage, ...extra });
const normalizeLf = (content) => String(content ?? "").replace(/\r\n/gu, "\n");

// ── 형식 ───────────────────────────────────────────────────────────────────────

/** 스킬 안 파일 경로: 상대 경로, 숨김 파일 없음, 텍스트 확장자만. 통과하면 '/' 로 이은 경로. */
export function safeSkillRelativePath(rel) {
  const value = String(rel ?? "").replace(/\\/gu, "/");
  if (!value || value.length > 200 || value.startsWith("/") || /^[A-Za-z]:/u.test(value)) return null;
  const parts = value.split("/");
  if (parts.length > limits.depth) return null;
  if (parts.some((part) => !part || part === "." || part === ".." || part.startsWith(".") || /[<>:"|?*\x00-\x1f]/u.test(part) || /[. ]$/u.test(part))) return null;
  if (!textExtensions.has(path.extname(value).toLowerCase())) return null;
  return parts.join("/");
}

/** 폴더 해시(sha256-lf-tree): 상대 경로 순서대로 "경로\0내용해시\n" 을 잇는다. 줄바꿈은 LF 로 맞춘다(크루 스킬 패키지와 같은 방식). */
export function hashSkillFiles(files) {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hash = createHash("sha256");
  for (const file of sorted) hash.update(file.path + "\0" + (file.binary ? "binary:" + Number(file.size ?? 0) : sha256(normalizeLf(file.content))) + "\n");
  return hash.digest("hex");
}

/** SKILL.md 머리말을 데이터로만 읽는다(명령·후크를 실행하지 않음). metadata.version 도 읽는다. */
export function parseSkillMeta(source) {
  const match = String(source ?? "").replace(/^\uFEFF/u, "").match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/u);
  if (!match) return null;
  const metadata = match[1];
  const field = (key) => {
    const found = metadata.match(new RegExp("^" + key + ":[ \\t]*(.*)$", "mu"));
    if (!found) return "";
    const raw = found[1].trim();
    if (/^[>|][+-]?$/u.test(raw)) {
      const rest = metadata.slice(metadata.indexOf(found[0]) + found[0].length).split(/\r?\n/u).slice(1);
      const block = [];
      for (const line of rest) { if (!/^[ \t]+/u.test(line)) break; block.push(line.trim()); }
      return block.join(" ").trim();
    }
    return raw.replace(/^['"]|['"]$/gu, "");
  };
  const nested = metadata.match(/^metadata:[ \t]*\r?\n((?:[ \t]+.*(?:\r?\n|$))*)/mu)?.[1] ?? "";
  const nestedVersion = nested.match(/^[ \t]+version:[ \t]*["']?([^"'\s#]+)/mu)?.[1] ?? "";
  return {
    name: clip(field("name"), 80),
    description: clip(field("description"), 1024),
    version: clip(field("version") || nestedVersion, 40),
    license: clip(field("license"), 200),
    compatibility: clip(field("compatibility"), 500),
    allowedTools: field("allowed-tools").split(/[,\s]+/u).filter(Boolean),
    body: String(match[2] ?? "").trim(),
  };
}

/** 받은 파일 목록 검사. 통과하면 sha256 과 머리말을 함께 돌려준다. */
export function validateSkillFiles(files, { expectedName = "" } = {}) {
  const problems = [];
  const clean = [];
  const seen = new Set();
  let bytes = 0;
  for (const file of files ?? []) {
    if (file?.binary) { problems.push("실행 파일·이미지 같은 바이너리는 보관하지 않습니다: " + clip(file.path, 120)); continue; }
    if (file?.tooLarge) { problems.push("파일이 너무 큽니다(1MB 초과): " + clip(file.path, 120)); continue; }
    const rel = safeSkillRelativePath(file?.path);
    if (!rel) { problems.push("허용하지 않는 파일 이름이나 형식입니다: " + clip(file?.path, 120)); continue; }
    if (seen.has(rel.toLowerCase())) { problems.push("같은 이름 파일이 겹칩니다: " + rel); continue; }
    seen.add(rel.toLowerCase());
    const content = String(file.content ?? "");
    const size = Buffer.byteLength(content);
    if (size > limits.fileBytes) { problems.push("파일이 너무 큽니다(1MB 초과): " + rel); continue; }
    bytes += size;
    clean.push({ path: rel, content });
  }
  if (clean.length > limits.files) problems.push("파일이 너무 많습니다(" + limits.files + "개 초과).");
  if (bytes > limits.bytes) problems.push("스킬이 너무 큽니다(4MB 초과).");
  const skillFile = clean.find((file) => file.path === "SKILL.md");
  const meta = skillFile ? parseSkillMeta(skillFile.content) : null;
  if (!skillFile) problems.push("SKILL.md 가 없습니다.");
  else if (!meta) problems.push("SKILL.md 머리말(name·description) 형식을 확인해 주세요.");
  if (meta) {
    if (!skillNamePattern.test(meta.name)) problems.push("스킬 이름은 영문 소문자·숫자·하이픈(64자 이내)만 쓸 수 있습니다: " + meta.name);
    if (expectedName && meta.name !== expectedName) problems.push("SKILL.md 이름(" + meta.name + ")이 저장할 이름(" + expectedName + ")과 다릅니다.");
    if (!meta.description) problems.push("SKILL.md 설명(description)이 비어 있습니다.");
    // 원본 grill-me처럼 다른 이름의 스킬에 연결하는 최소 지침은 원문 그대로 보존한다.
    // 의존성의 설치·검증은 준비 단계가 맡으며, 이 구문 검사는 실행 승인이 아니다.
    const skillRedirect = /^Call the Skill tool with "[a-z0-9][a-z0-9-]{0,63}"\.$/u.test(meta.body);
    if (meta.body.length < 40 && !skillRedirect) problems.push("지침 본문이 너무 짧습니다.");
  }
  return { ok: problems.length === 0, problems, files: clean, meta, bytes, sha256: problems.length ? "" : hashSkillFiles(clean) };
}

/** 폴더 읽기. 숨김 파일·링크는 건너뛰고, 바이너리·큰 파일은 표시만 해서 검사에서 걸러지게 한다. */
export async function readSkillFolder(dir, { io = fs } = {}) {
  const files = [];
  const skipped = [];
  let count = 0;
  const visit = async (folder, prefix, depth) => {
    const entries = await io.readdir(folder, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.name.startsWith(".") || entry.isSymbolicLink?.()) { skipped.push(rel); continue; }
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (depth >= limits.depth) { skipped.push(rel + "/"); continue; }
        await visit(full, rel, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      count += 1;
      if (count > limits.files * 2) throw Object.assign(new Error("폴더에 파일이 너무 많습니다."), { code: "TOO_MANY" });
      const info = await io.stat(full);
      if (!textExtensions.has(path.extname(entry.name).toLowerCase())) { files.push({ path: rel, binary: true, size: info.size }); continue; }
      if (info.size > limits.fileBytes) { files.push({ path: rel, tooLarge: true, size: info.size }); continue; }
      files.push({ path: rel, content: await io.readFile(full, "utf8") });
    }
  };
  await visit(dir, "", 1);
  return { files, skipped };
}

async function pathExists(io, target) {
  try { await io.stat(target); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

/** 폴더 전체 해시(바이너리는 크기만 반영). 배포본이 바뀌었는지 볼 때 쓴다. 없으면 null. */
export async function folderTreeHash(dir, { io = fs } = {}) {
  if (!(await pathExists(io, dir))) return null;
  const { files } = await readSkillFolder(dir, { io });
  return { sha256: hashSkillFiles(files), files };
}

/**
 * 공용 폴더에 배포된 스킬 폴더를 엄격하게 본다. 보관함은 텍스트 파일만 배포하므로 숨김 파일·폴더, 바로가기 링크,
 * 바이너리, 1MB 넘는 파일이 있으면 사용자가 넣은 것으로 보고 해시에 반영한다(→ '직접 고침'으로 판정돼 덮어쓰지 않는다).
 * 이런 항목은 보관함에 옮겨 담을 수 없으므로 unpreservable 로 알려, 사용자가 덮어쓰기를 골라도 그 전에 멈추게 한다.
 * 텍스트 파일만 있는 폴더의 해시는 hashSkillFiles 와 같다. 없으면 null.
 */
export async function inspectDeployedFolder(dir, { io = fs } = {}) {
  if (!(await pathExists(io, dir))) return null;
  const parts = [];
  const unpreservable = [];
  let count = 0;
  const visit = async (folder, prefix, depth) => {
    const entries = await io.readdir(folder, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? prefix + "/" + entry.name : entry.name;
      const full = path.join(folder, entry.name);
      count += 1;
      if (count > limits.files * 4) throw Object.assign(new Error("폴더에 파일이 너무 많습니다."), { code: "TOO_MANY" });
      if (entry.isSymbolicLink?.()) { parts.push({ path: rel, digest: "link" }); unpreservable.push(rel + " (바로가기 링크)"); continue; }
      const hidden = entry.name.startsWith(".");
      if (entry.isDirectory()) {
        if (hidden || depth >= limits.depth) { parts.push({ path: rel + "/", digest: hidden ? "hidden-dir" : "deep-dir" }); unpreservable.push(rel + "/ (" + (hidden ? "숨김 폴더" : "너무 깊은 폴더") + ")"); continue; }
        await visit(full, rel, depth + 1);
        continue;
      }
      if (!entry.isFile()) { parts.push({ path: rel, digest: "special" }); unpreservable.push(rel + " (특수 파일)"); continue; }
      const info = await io.stat(full);
      if (info.size > limits.fileBytes) { parts.push({ path: rel, digest: "large:" + info.size + ":" + Math.round(info.mtimeMs) }); unpreservable.push(rel + " (1MB 초과)"); continue; }
      const buffer = await io.readFile(full);
      if (hidden || !textExtensions.has(path.extname(entry.name).toLowerCase())) {
        parts.push({ path: rel, digest: "raw:" + sha256(buffer) });
        unpreservable.push(rel + " (" + (hidden ? "숨김 파일" : "바이너리") + ")");
        continue;
      }
      parts.push({ path: rel, digest: sha256(normalizeLf(buffer.toString("utf8"))) });
    }
  };
  await visit(dir, "", 1);
  parts.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part.path + "\0" + part.digest + "\n");
  return { sha256: hash.digest("hex"), unpreservable };
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function writeFiles(io, dir, files) {
  await io.mkdir(dir, { recursive: true });
  for (const file of files) {
    const target = path.join(dir, ...file.path.split("/"));
    if (!isInside(dir, target)) throw new Error("스킬 파일 경로가 폴더 밖을 가리킵니다.");
    await io.mkdir(path.dirname(target), { recursive: true });
    await io.writeFile(target, file.content, "utf8");
  }
}

export function compareSkillVersions(a, b) {
  const parse = (value) => String(value ?? "").split(/[.+-]/u).slice(0, 3).map((part) => Number.parseInt(part, 10));
  const pa = parse(a); const pb = parse(b);
  if (pa.some(Number.isNaN) || pb.some(Number.isNaN) || pa.length < 3 || pb.length < 3) return null;
  for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

function sanitizeOrigin(origin) {
  const kind = String(origin?.kind ?? "");
  if (!originKinds.has(kind)) throw new Error("스킬 출처를 확인하지 못했습니다.");
  const clean = { kind };
  for (const key of ["templateId", "owner", "repo", "path", "ref", "refDate", "track", "url", "folder", "catalogUrl", "version", "sha256", "root", "license", "capabilityId", "sourceSha256"]) {
    if (origin[key] != null && origin[key] !== "") clean[key] = clip(origin[key], key === "url" || key === "folder" ? 600 : 300);
  }
  return clean;
}

function sameOrigin(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "app_template") return a.templateId === b.templateId;
  if (a.kind === "github") return a.owner?.toLowerCase() === b.owner?.toLowerCase() && a.repo?.toLowerCase() === b.repo?.toLowerCase() && (a.path ?? "") === (b.path ?? "");
  if (a.kind === "user_folder" || a.kind === "this_pc") return path.resolve(a.folder ?? "").toLowerCase() === path.resolve(b.folder ?? "").toLowerCase();
  return true;
}

// ── 깃허브(고정 호스트) ─────────────────────────────────────────────────────────

const githubOwnerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const githubRepoPattern = /^[A-Za-z0-9._-]{1,100}$/u;
const githubRefPattern = /^[A-Za-z0-9._-]{1,100}$/u;

function cleanGitHubPath(value) {
  const parts = String(value ?? "").replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "").split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === ".." || !/^[A-Za-z0-9._ -]{1,100}$/u.test(part))) return null;
  return parts.join("/");
}

/**
 * 깃허브 스킬 주소 해석: github.com/owner/repo, …/tree/<ref>/<경로>, …/blob/<ref>/<경로>/SKILL.md.
 * ref 에 '/' 가 들어간 가지 이름은 지원하지 않는다(커밋·태그·단순 가지 이름만).
 */
export function parseGitHubSkillUrl(value) {
  let url;
  try { url = new URL(String(value ?? "").trim()); } catch { return null; }
  if (url.protocol !== "https:" || !["github.com", "www.github.com"].includes(url.hostname)) return null;
  const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  const [owner, repoRaw, mode, ref, ...rest] = parts;
  const repo = String(repoRaw ?? "").replace(/\.git$/u, "");
  if (!githubOwnerPattern.test(owner ?? "") || !githubRepoPattern.test(repo)) return null;
  if (!mode) return { owner, repo, ref: "", path: "" };
  if (!["tree", "blob"].includes(mode) || !githubRefPattern.test(ref ?? "")) return null;
  let rel = rest.join("/");
  if (mode === "blob" && /(^|\/)SKILL\.md$/u.test(rel)) rel = rel.replace(/\/?SKILL\.md$/u, "");
  const cleanPath = cleanGitHubPath(rel);
  if (cleanPath === null) return null;
  return { owner, repo, ref, path: cleanPath };
}

export async function readLimitedText(response, maxBytes) {
  if (Number(response.headers?.get?.("content-length")) > maxBytes) throw new Error("응답이 너무 큽니다.");
  if (!response.body || typeof response.body[Symbol.asyncIterator] !== "function") {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw new Error("응답이 너무 큽니다.");
    return text;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("응답이 너무 큽니다.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function githubRequest(fetchImpl, url, { json = true, maxBytes = 2 * 1024 * 1024 } = {}) {
  if (!url.startsWith("https://api.github.com/repos/") && !url.startsWith("https://raw.githubusercontent.com/")) throw new Error("허용하지 않는 주소입니다.");
  let response;
  try {
    response = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { "user-agent": "ModyCrew-SkillLibrary", ...(json ? { accept: "application/vnd.github+json" } : {}) } });
  } catch {
    throw Object.assign(new Error("깃허브에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요."), { code: "OFFLINE" });
  }
  if (response.status >= 300 && response.status < 400) throw Object.assign(new Error("깃허브 주소가 다른 곳으로 옮겨졌습니다. 새 주소를 확인해 주세요."), { code: "MOVED" });
  if (response.status === 404) throw Object.assign(new Error("깃허브에서 찾지 못했습니다(주소·경로 확인)."), { code: "NOT_FOUND" });
  if (response.status === 403 || response.status === 429) throw Object.assign(new Error("깃허브 확인 한도에 걸렸습니다(로그인 없이 시간당 60회). 잠시 뒤 다시 확인해 주세요."), { code: "RATE_LIMIT" });
  if (!response.ok) throw Object.assign(new Error("깃허브 응답을 받지 못했습니다(" + response.status + ")."), { code: "HTTP" });
  if (response.url && response.url !== url) throw Object.assign(new Error("깃허브 주소를 확인하지 못했습니다."), { code: "MOVED" });
  const text = await readLimitedText(response, maxBytes);
  return json ? JSON.parse(text) : text;
}

const encodePath = (value) => String(value ?? "").split("/").filter(Boolean).map(encodeURIComponent).join("/");

/** 이 경로를 바꾼 마지막 커밋(ref 가 비면 기본 가지). */
export async function latestGitHubCommit({ owner, repo, path: rel = "", ref = "" }, { fetch: fetchImpl = globalThis.fetch } = {}) {
  const query = new URLSearchParams({ per_page: "1" });
  if (rel) query.set("path", rel);
  if (ref) query.set("sha", ref);
  const list = await githubRequest(fetchImpl, "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/commits?" + query.toString());
  const first = Array.isArray(list) ? list[0] : null;
  if (!first?.sha || !/^[0-9a-f]{40}$/u.test(first.sha)) throw Object.assign(new Error("이 경로의 커밋을 찾지 못했습니다."), { code: "NOT_FOUND" });
  return { sha: first.sha, date: clip(first.commit?.committer?.date ?? first.commit?.author?.date, 40) };
}

/**
 * 저장소의 최신 정식 릴리스(초안·사전 릴리스 제외, 깃허브 'latest' 기준). 릴리스가 없으면 null.
 * 스킬 파일이 실제로 바뀌었는지는 경로 커밋으로 판단하고, 릴리스는 사용자가 판단할 수 있게 함께 보여 준다.
 */
export async function latestGitHubRelease({ owner, repo }, { fetch: fetchImpl = globalThis.fetch } = {}) {
  let data;
  try { data = await githubRequest(fetchImpl, "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/releases/latest", { maxBytes: 1024 * 1024 }); }
  catch (error) { if (error.code === "NOT_FOUND") return null; throw error; }
  const tag = clip(data?.tag_name, 100);
  if (!tag) return null;
  const html = String(data?.html_url ?? "");
  return { tag, name: clip(data?.name, 120), publishedAt: clip(data?.published_at, 40), url: html.startsWith("https://github.com/") ? clip(html, 600) : "" };
}

/** 커밋 하나에 고정해 스킬 폴더 파일을 받는다(설치하지 않음 — 미리보기·보관용 데이터). */
export async function fetchGitHubSkill({ owner, repo, path: rel = "", ref = "" }, { fetch: fetchImpl = globalThis.fetch } = {}) {
  if (!githubOwnerPattern.test(owner ?? "") || !githubRepoPattern.test(repo ?? "")) throw new Error("깃허브 저장소 이름을 확인해 주세요.");
  const cleanPath = cleanGitHubPath(rel);
  if (cleanPath === null) throw new Error("깃허브 경로를 확인해 주세요.");
  const commit = /^[0-9a-f]{40}$/u.test(ref) ? { sha: ref, date: "" } : await latestGitHubCommit({ owner, repo, path: cleanPath, ref }, { fetch: fetchImpl });
  const base = "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/contents/";
  const files = [];
  const skipped = [];
  let requests = 0;
  const visit = async (dirPath, depth) => {
    requests += 1;
    if (requests > 25) throw new Error("폴더가 너무 깊거나 많습니다.");
    const entries = await githubRequest(fetchImpl, base + encodePath(dirPath) + "?ref=" + commit.sha);
    if (!Array.isArray(entries)) throw new Error("스킬 폴더 경로가 아니라 파일 하나를 가리킵니다. SKILL.md 가 있는 폴더 주소를 주세요.");
    for (const entry of entries) {
      const name = String(entry?.name ?? "");
      const relInSkill = (dirPath === cleanPath ? "" : dirPath.slice(cleanPath ? cleanPath.length + 1 : 0) + "/") + name;
      if (!name || name.startsWith(".")) { skipped.push(relInSkill); continue; }
      if (entry.type === "dir") {
        if (depth >= limits.depth) { skipped.push(relInSkill + "/"); continue; }
        await visit((dirPath ? dirPath + "/" : "") + name, depth + 1);
        continue;
      }
      if (entry.type !== "file") { skipped.push(relInSkill); continue; }
      if (files.length >= limits.files) throw new Error("스킬 파일이 너무 많습니다.");
      if (!textExtensions.has(path.extname(name).toLowerCase())) { files.push({ path: relInSkill, binary: true, size: Number(entry.size) || 0 }); continue; }
      if (Number(entry.size) > limits.fileBytes) { files.push({ path: relInSkill, tooLarge: true, size: Number(entry.size) }); continue; }
      const rawUrl = "https://raw.githubusercontent.com/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/" + commit.sha + "/" + encodePath((dirPath ? dirPath + "/" : "") + name);
      files.push({ path: relInSkill, content: await githubRequest(fetchImpl, rawUrl, { json: false, maxBytes: limits.fileBytes }) });
    }
  };
  await visit(cleanPath, 1);
  let repoLicense = "";
  try { repoLicense = clip((await githubRequest(fetchImpl, "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/license"))?.license?.spdx_id, 60); }
  catch (error) { if (error.code !== "NOT_FOUND") repoLicense = ""; }
  const url = "https://github.com/" + owner + "/" + repo + "/tree/" + commit.sha + (cleanPath ? "/" + cleanPath : "");
  return { owner, repo, path: cleanPath, commit: commit.sha, commitDate: commit.date, files, skipped, repoLicense: repoLicense === "NOASSERTION" ? "" : repoLicense, url };
}

// ── 보관함 ─────────────────────────────────────────────────────────────────────

export function defaultSkillDeployRoot(home = os.homedir()) {
  return path.join(home, ".agents", "skills");
}

/**
 * 보관함. root/library.json 에 기록을 원자 저장하고, 버전 파일은 root/store 에, 배포본은 deployRoot/<이름> 에 둔다.
 * options.templates: 앱에 들어 있는 템플릿 목록을 돌려주는 함수(async () => [{ id, name, version, sha256, files }]).
 * options.websiteCatalog / options.bundledCatalog: 웹사이트·앱 동봉 카탈로그를 돌려주는 함수(없으면 확인을 건너뜀).
 */
export function createSkillLibrary(options = {}) {
  const io = options.io ?? fs;
  const root = options.root;
  if (!root) throw new Error("내 스킬 보관함 위치가 필요합니다.");
  const deployRoot = path.resolve(options.deployRoot ?? defaultSkillDeployRoot());
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const templates = options.templates ?? (async () => []);
  const websiteCatalog = options.websiteCatalog ?? null;
  const bundledCatalog = options.bundledCatalog ?? null;
  const intervalMs = options.remoteCheckIntervalMs ?? remoteCheckIntervalMs;
  const indexFile = path.join(root, "library.json");
  const storeRoot = path.join(root, "store");
  const candidatesRoot = path.join(root, "publish-candidates");
  let queue = Promise.resolve();
  const serial = (task) => { const run = queue.then(task, task); queue = run.catch(() => undefined); return run; };
  const stamp = () => now().toISOString();

  async function readIndex() {
    let raw;
    try { raw = await io.readFile(indexFile, "utf8"); }
    catch (error) { if (error.code === "ENOENT") return { schema: skillLibrarySchema, skills: {} }; throw error; }
    try {
      const data = JSON.parse(raw);
      if (data?.schema === skillLibrarySchema && data.skills && typeof data.skills === "object") return data;
    } catch { /* 아래에서 안내 */ }
    throw Object.assign(new Error("내 스킬 보관함 기록을 읽지 못했습니다. 원본 파일(library.json)은 그대로 두었습니다."), { code: "INDEX_UNREADABLE" });
  }

  async function writeIndex(index) {
    await io.mkdir(root, { recursive: true });
    const pending = indexFile + "." + process.pid + "." + randomUUID() + ".pending";
    await io.writeFile(pending, JSON.stringify(index, null, 2), "utf8");
    try {
      try { await io.copyFile(indexFile, path.join(root, "library.prev.json")); } catch (error) { if (error.code !== "ENOENT") throw error; }
      await io.rename(pending, indexFile);
    } catch (error) {
      await io.rm(pending, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  const pushHistory = (record, entry) => {
    record.history = [...(record.history ?? []), { at: stamp(), ...entry }].slice(-limits.history);
    record.updatedAt = stamp();
  };

  const versionDir = (name, version, hash) => path.join(storeRoot, name, (String(version || "v").replace(/[^0-9A-Za-z.+-]/gu, "_").slice(0, 40) || "v") + "~" + hash.slice(0, 12));

  async function readStoredVersion(name, entry) {
    const dir = versionDir(name, entry.version, entry.sha256);
    const { files } = await readSkillFolder(dir, { io });
    const checked = validateSkillFiles(files, { expectedName: name });
    if (!checked.ok || checked.sha256 !== entry.sha256) throw Object.assign(new Error("보관한 " + entry.version + " 버전 파일이 바뀌었거나 손상됐습니다."), { code: "INTEGRITY" });
    return checked;
  }

  async function storeVersion(name, version, files, hash) {
    const dir = versionDir(name, version, hash);
    if (await pathExists(io, dir)) {
      try { const { files: present } = await readSkillFolder(dir, { io }); if (hashSkillFiles(present) === hash) return dir; } catch { /* 다시 쓴다 */ }
      await io.rm(dir, { recursive: true, force: true });
    }
    const staging = path.join(storeRoot, name, "." + randomUUID() + ".pending");
    try {
      await writeFiles(io, staging, files);
      const { files: written } = await readSkillFolder(staging, { io });
      if (hashSkillFiles(written) !== hash) throw Object.assign(new Error("보관 중 파일 확인에 실패했습니다."), { code: "INTEGRITY" });
      await io.rename(staging, dir);
    } finally {
      await io.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
    return dir;
  }

  /**
   * 배포본 상태: missing(없음) · current(활성 버전과 같음) · stale(보관함이 배포한 이전 버전 그대로 — 바꿔도 됨)
   * · modified(보관함이 배포한 뒤 사용자가 고침) · foreign(보관함이 배포한 적 없는 같은 이름 폴더).
   * 숨김 파일·링크·바이너리까지 엄격하게 보므로, 그런 항목을 넣으면 modified 로 잡혀 덮어쓰지 않는다.
   */
  async function deploymentState(record) {
    const target = path.join(deployRoot, record.name);
    const current = await inspectDeployedFolder(target, { io }).catch(() => ({ sha256: "unreadable", unpreservable: ["폴더를 끝까지 읽지 못함"] }));
    if (!current) return { state: "missing", target, unpreservable: [] };
    const found = { target, sha256: current.sha256, unpreservable: current.unpreservable };
    if (record.active?.sha256 && current.sha256 === record.active.sha256) return { state: "current", ...found };
    if (record.deployment?.sha256 && current.sha256 === record.deployment.sha256) return { state: "stale", ...found };
    if (record.deployment?.sha256) return { state: "modified", ...found };
    return { state: "foreign", ...found };
  }

  /**
   * 임시 폴더에 쓰고 해시 확인 → 기존 배포본을 백업 이름으로 옮김 → 새 폴더를 제자리로. 도중에 실패하면 백업을 되돌린다.
   * 백업은 바로 지우지 않는다. 기록 저장(commitIndex)이 끝나면 commit() 으로 지우고, 기록 저장에 실패하면 revert() 로 배포 전으로 되돌린다.
   */
  async function deployFiles(name, files, hash) {
    const target = path.join(deployRoot, name);
    if (!isInside(deployRoot, target)) throw new Error("배포 위치를 확인하지 못했습니다.");
    await io.mkdir(deployRoot, { recursive: true });
    const staging = path.join(deployRoot, ".mody-" + name + "-" + randomUUID() + ".pending");
    const backup = path.join(deployRoot, ".mody-" + name + "-" + randomUUID() + ".backup");
    let backedUp = false;
    try {
      await writeFiles(io, staging, files);
      const { files: written } = await readSkillFolder(staging, { io });
      if (hashSkillFiles(written) !== hash) throw Object.assign(new Error("배포할 파일 확인에 실패했습니다."), { code: "INTEGRITY" });
      if (await pathExists(io, target)) { await io.rename(target, backup); backedUp = true; }
      await io.rename(staging, target);
    } catch (error) {
      if (backedUp && !(await pathExists(io, target))) await io.rename(backup, target).catch(() => undefined);
      await io.rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    let settled = false;
    return {
      target,
      async commit() {
        if (settled) return;
        settled = true;
        if (backedUp) await io.rm(backup, { recursive: true, force: true }).catch(() => undefined);
      },
      async revert() {
        if (settled) return;
        settled = true;
        await io.rm(target, { recursive: true, force: true });
        if (backedUp) await io.rename(backup, target);
      },
    };
  }

  /** 기록을 저장한 뒤에만 배포를 확정한다. 저장에 실패하면 배포본을 되돌려 기록과 공용 폴더가 어긋나지 않게 하고 오류를 그대로 알린다. */
  async function commitIndex(index, ...deployments) {
    const pending = deployments.filter(Boolean);
    try { await writeIndex(index); }
    catch (error) {
      for (const deployment of [...pending].reverse()) await deployment.revert().catch(() => undefined);
      throw error;
    }
    for (const deployment of pending) await deployment.commit();
  }

  function trimVersions(record) {
    const keep = [];
    const versions = [...(record.versions ?? [])];
    for (let i = versions.length - 1; i >= 0; i -= 1) {
      const entry = versions[i];
      if (keep.length < limits.versions || entry.sha256 === record.active?.sha256) keep.unshift(entry);
    }
    const dropped = versions.filter((entry) => !keep.includes(entry));
    record.versions = keep;
    return dropped;
  }

  async function removeVersionDirs(name, dropped) {
    for (const entry of dropped) await io.rm(versionDir(name, entry.version, entry.sha256), { recursive: true, force: true }).catch(() => undefined);
  }

  async function localStatus(record) {
    if (record.storage !== "stored") return { deployed: false, localModified: false, deployState: "tracked", unpreservable: [] };
    const deployed = await deploymentState(record);
    return { deployed: ["current", "stale", "modified"].includes(deployed.state), localModified: deployed.state === "modified", deployState: deployed.state, deployedSha256: deployed.sha256 ?? "", target: deployed.target, unpreservable: deployed.unpreservable ?? [] };
  }

  function publicRecord(record, local = null) {
    return {
      name: record.name, label: record.label, description: record.description, storage: record.storage,
      origin: record.origin, originLabel: skillOriginLabels[record.origin?.kind] ?? "",
      active: record.active ?? null, versions: (record.versions ?? []).map(({ version, sha256: hash, storedAt, note }) => ({ version, sha256: hash, storedAt, note })),
      deployment: record.deployment ?? null, usedBy: record.usedBy ?? [], latest: record.latest ?? null,
      latestLabel: skillUpdateStatusLabels[record.latest?.status ?? "not_checked"] ?? "",
      publishCandidate: Boolean(record.publishCandidate), userModified: Boolean(record.userModified), license: record.license ?? "",
      history: (record.history ?? []).slice(-12), addedAt: record.addedAt, updatedAt: record.updatedAt,
      ...(local ? { local } : {}),
    };
  }

  /** 버전 보관 + 활성화. sourceRef·sourceSha256 은 이 버전을 만든 원본 기준(되돌릴 때 원본 기준도 함께 되돌린다). */
  async function activate(record, checked, { version, note, sourceRef, sourceSha256 } = {}) {
    await storeVersion(record.name, version, checked.files, checked.sha256);
    const entry = { version, sha256: checked.sha256, storedAt: stamp(), files: checked.files.map((file) => file.path), ...(note ? { note } : {}), ...(sourceRef ? { sourceRef } : {}), ...(sourceSha256 ? { sourceSha256 } : {}) };
    record.versions = [...(record.versions ?? []).filter((item) => item.sha256 !== checked.sha256), entry];
    record.active = { version, sha256: checked.sha256 };
    return entry;
  }

  /** 활성 버전을 공용 폴더에 둔다. 직접 고친 폴더·보관함이 모르는 폴더는 건드리지 않는다. 바꿨으면 확정 전 배포(handle)를 돌려준다. */
  async function deployRecord(record) {
    const state = await deploymentState(record);
    if (state.state === "current") {
      record.deployment = { to: state.target, sha256: state.sha256, at: record.deployment?.sha256 === state.sha256 ? record.deployment.at : stamp() };
      return { deployed: true, target: state.target, unchanged: true };
    }
    if (state.state === "modified") return { deployed: false, reason: "modified", target: state.target };
    if (state.state === "foreign") return { deployed: false, reason: "foreign", target: state.target };
    const active = (record.versions ?? []).find((entry) => entry.sha256 === record.active?.sha256);
    const checked = await readStoredVersion(record.name, active);
    const handle = await deployFiles(record.name, checked.files, checked.sha256);
    record.deployment = { to: handle.target, sha256: checked.sha256, at: stamp() };
    pushHistory(record, { action: "deploy", version: active.version, note: handle.target });
    return { deployed: true, target: handle.target, handle };
  }

  /** 새 스킬 보관(이미 같은 출처의 다른 내용이면 새 버전으로 쌓는다). */
  function add({ files, origin, label = "", versionHint = "", usedBy = null, note = "", deploy = true, publishCandidate = false, license = "" } = {}) {
    return serial(async () => {
      const cleanOrigin = sanitizeOrigin(origin);
      const checked = validateSkillFiles(files);
      if (!checked.ok) return result("invalid", "스킬을 보관하지 못했습니다: " + checked.problems.join(" "), { problems: checked.problems });
      const name = checked.meta.name;
      const version = checked.meta.version || clip(versionHint, 40) || "r-" + checked.sha256.slice(0, 8);
      const index = await readIndex();
      let record = index.skills[name];
      let action = "add";
      if (record) {
        if (record.storage !== "stored" || !sameOrigin(record.origin, cleanOrigin)) {
          return result("conflict", "'" + name + "' 이름의 다른 스킬이 이미 보관함에 있습니다(" + (skillOriginLabels[record.origin?.kind] ?? "다른 출처") + "). 덮어쓰지 않았습니다.", { skill: publicRecord(record) });
        }
        if (record.active?.sha256 === checked.sha256) {
          if (usedBy?.teammateId) record.usedBy = mergeUsedBy(record.usedBy, usedBy, true);
          const deployed = deploy ? await deployRecord(record) : null;
          await commitIndex(index, deployed?.handle);
          return result("already_saved", "같은 내용이 이미 보관함에 있습니다.", { skill: publicRecord(record, await localStatus(record)), deployed: deployed?.deployed ?? false, deployReason: deployed?.reason ?? "" });
        }
        action = "update";
      } else {
        record = { name, label: clip(label, 80) || name, description: checked.meta.description, storage: "stored", origin: cleanOrigin, versions: [], active: null, deployment: null, usedBy: [], latest: null, publishCandidate: false, history: [], addedAt: stamp(), updatedAt: stamp() };
        index.skills[name] = record;
      }
      const previous = record.active;
      record.origin = { ...record.origin, ...cleanOrigin };
      if (["app_template", "user_folder", "github", "app_draft", "ai_draft"].includes(record.origin.kind)) record.origin.sourceSha256 = checked.sha256;
      if (record.origin.kind === "app_template" && checked.meta.version) record.origin.version = checked.meta.version;
      record.description = checked.meta.description;
      record.license = clip(license || checked.meta.license, 200);
      if (label) record.label = clip(label, 80);
      if (publishCandidate) record.publishCandidate = true;
      if (usedBy?.teammateId) record.usedBy = mergeUsedBy(record.usedBy, usedBy, true);
      await activate(record, checked, { version, note, sourceRef: record.origin.kind === "github" ? record.origin.ref : undefined, sourceSha256: checked.sha256 });
      pushHistory(record, { action, version, from: previous?.version, note: clip(note, 200) || undefined });
      const dropped = trimVersions(record);
      let deployed = null;
      if (deploy) {
        try { deployed = await deployRecord(record); }
        catch (error) { deployed = { deployed: false, reason: "failed", error: String(error?.message ?? error) }; pushHistory(record, { action: "deploy_failed", version, note: deployed.error }); }
      }
      await commitIndex(index, deployed?.handle);
      await removeVersionDirs(name, dropped);
      const deployNote = !deploy ? "" : deployed?.deployed ? " 공용 스킬 폴더에 배포했습니다." : deployed?.reason === "foreign" ? " 같은 이름 폴더가 이미 있어 배포하지 않았습니다(덮어쓰지 않음)." : deployed?.reason === "modified" ? " 직접 고친 배포본이 있어 바꾸지 않았습니다." : " 배포하지 못했습니다(" + (deployed?.error ?? "") + ").";
      return result(action === "add" ? "saved" : "updated", "'" + name + "' " + version + " 버전을 내 스킬 보관함에 " + (action === "add" ? "저장했습니다." : "새 버전으로 쌓았습니다.") + deployNote, { skill: publicRecord(record, await localStatus(record)), deployed: Boolean(deployed?.deployed), deployReason: deployed?.reason ?? "", target: deployed?.target ?? "" });
    });
  }

  /** 파일을 보관하지 않고 출처만 기록(웹사이트·앱에 포함된 크루 스킬, 이 PC 스킬). 쓰는 직원과 최신 확인을 위해서다. */
  function track({ name, label = "", description = "", origin, usedBy = null } = {}) {
    return serial(async () => {
      const clean = clip(name, 64);
      if (!skillNamePattern.test(clean)) return result("invalid", "스킬 이름을 확인해 주세요.");
      const cleanOrigin = sanitizeOrigin(origin);
      if (!["website", "app_bundled", "this_pc"].includes(cleanOrigin.kind)) return result("invalid", "기록만 하는 스킬은 웹사이트·앱에 포함·이 PC 출처만 됩니다.");
      const index = await readIndex();
      let record = index.skills[clean];
      if (record && record.storage === "stored") {
        if (usedBy?.teammateId) { record.usedBy = mergeUsedBy(record.usedBy, usedBy, true); pushHistory(record, { action: "use", note: usedBy.teammateName || usedBy.teammateId }); await writeIndex(index); }
        return result("stored_exists", "보관함에 저장된 스킬입니다. 쓰는 직원만 기록했습니다.", { skill: publicRecord(record) });
      }
      if (!record) {
        record = { name: clean, label: clip(label, 80) || clean, description: clip(description, 1024), storage: "tracked", origin: cleanOrigin, versions: [], active: cleanOrigin.version || cleanOrigin.sha256 ? { version: cleanOrigin.version ?? "", sha256: cleanOrigin.sha256 ?? "" } : null, deployment: null, usedBy: [], latest: null, publishCandidate: false, history: [], addedAt: stamp(), updatedAt: stamp() };
        index.skills[clean] = record;
        pushHistory(record, { action: "track", version: cleanOrigin.version || undefined, note: skillOriginLabels[cleanOrigin.kind] });
      } else {
        record.origin = { ...record.origin, ...cleanOrigin };
        if (cleanOrigin.version || cleanOrigin.sha256) record.active = { version: cleanOrigin.version ?? record.active?.version ?? "", sha256: cleanOrigin.sha256 ?? record.active?.sha256 ?? "" };
      }
      if (usedBy?.teammateId) record.usedBy = mergeUsedBy(record.usedBy, usedBy, true);
      await writeIndex(index);
      return result("tracked", "'" + clean + "' 스킬을 보관함 목록에 기록했습니다(파일은 원래 위치에서 관리).", { skill: publicRecord(record) });
    });
  }

  function mergeUsedBy(list, usedBy, add) {
    const others = (list ?? []).filter((item) => item.teammateId !== usedBy.teammateId);
    return add ? [...others, { teammateId: clip(usedBy.teammateId, 120), name: clip(usedBy.teammateName, 40), at: stamp() }].slice(-limits.usedBy) : others;
  }

  function setUsedBy(name, { teammateId, teammateName = "", add = true } = {}) {
    return serial(async () => {
      const index = await readIndex();
      const record = index.skills[clip(name, 64)];
      if (!record) return result("not_found", "보관함에 없는 스킬입니다.");
      if (!clip(teammateId, 120)) return result("invalid", "직원을 다시 선택해 주세요.");
      record.usedBy = mergeUsedBy(record.usedBy, { teammateId, teammateName }, add);
      pushHistory(record, { action: add ? "use" : "unuse", note: clip(teammateName || teammateId, 60) });
      await writeIndex(index);
      return result("used_by", add ? "이 스킬을 쓰는 직원으로 기록했습니다." : "쓰는 직원에서 뺐습니다.", { skill: publicRecord(record) });
    });
  }

  async function list() {
    const index = await readIndex();
    const skills = [];
    for (const record of Object.values(index.skills)) skills.push(publicRecord(record, await localStatus(record).catch(() => null)));
    skills.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return result("library", skills.length ? "내 스킬 " + skills.length + "개입니다." : "아직 보관한 스킬이 없습니다.", { skills, root, deployRoot });
  }

  async function get(name) {
    const index = await readIndex();
    const record = index.skills[clip(name, 64)];
    if (!record) return result("not_found", "보관함에 없는 스킬입니다.");
    return result("skill", record.label + " 스킬입니다.", { skill: { ...publicRecord(record, await localStatus(record)), history: record.history ?? [] } });
  }

  /** 실행용 활성 버전 파일(해시 확인 뒤). 앱이 직접 스크립트를 실행할 때만 쓴다. */
  async function readActiveFiles(name) {
    const index = await readIndex();
    const record = index.skills[clip(name, 64)];
    if (!record || record.storage !== "stored" || !record.active) return null;
    const entry = (record.versions ?? []).find((item) => item.sha256 === record.active.sha256);
    if (!entry) return null;
    const checked = await readStoredVersion(record.name, entry);
    return { record: publicRecord(record), files: checked.files, sha256: checked.sha256, version: entry.version };
  }

  // ── 최신 확인 ──

  async function latestSource(record, { force }) {
    const origin = record.origin ?? {};
    if (String(origin.track ?? "").startsWith("reviewed-reference:")) return { status: "app_update_needed", note: "검토된 원본 의존 묶음입니다. 새 버전은 원본 참조 카탈로그의 라이선스·권한·전체 해시 검토 후 적용합니다.", version: record.active?.version, ref: origin.ref };
    const lastRemote = Date.parse(record.latest?.checkedAt ?? "");
    const fresh = !force && Number.isFinite(lastRemote) && now().getTime() - lastRemote < intervalMs && record.latest?.status !== "check_failed";
    if (origin.kind === "app_template") {
      const template = (await templates()).find((item) => item.id === origin.templateId);
      if (!template) return { status: "source_missing", note: "이 앱 버전에 템플릿이 없습니다." };
      // 비교 기준은 마지막으로 받은 원본(sourceSha256)이다. 사용자 수정본을 보관해 활성 버전이 달라도 원본이 그대로면 최신이다.
      const base = origin.sourceSha256 || record.active?.sha256;
      if (template.sha256 === base) return { status: "up_to_date", version: template.version, sha256: template.sha256 };
      const order = compareSkillVersions(template.version, origin.version || record.active?.version);
      if (order !== null && order < 0) return { status: "up_to_date", version: template.version, sha256: template.sha256, note: "보관함 버전이 앱 템플릿보다 새롭습니다." };
      return { status: "update_available", version: template.version, sha256: template.sha256, note: "앱에 새 템플릿이 들어 있습니다." };
    }
    if (origin.kind === "github") {
      if (fresh && record.latest) return { ...record.latest, reused: true };
      const latest = await latestGitHubCommit({ owner: origin.owner, repo: origin.repo, path: origin.path ?? "", ref: origin.track ?? "" }, { fetch: fetchImpl });
      // 릴리스는 참고 정보다(스킬 경로가 실제로 바뀌었는지는 커밋으로 본다). 릴리스 확인이 실패해도 커밋 결과는 그대로 쓴다.
      let release = null;
      let releaseText = "";
      try { release = await latestGitHubRelease({ owner: origin.owner, repo: origin.repo }, { fetch: fetchImpl }); }
      catch (error) { releaseText = "릴리스 확인 실패(" + String(error?.message ?? error).slice(0, 80) + ")"; }
      if (!releaseText) releaseText = release ? "최신 릴리스 " + release.tag + (release.publishedAt ? " (" + release.publishedAt.slice(0, 10) + ")" : "") : "릴리스 없음 — 커밋 기준";
      const releaseInfo = release ? { releaseTag: release.tag, releaseDate: release.publishedAt, releaseUrl: release.url } : {};
      if (latest.sha === origin.ref) return { status: "up_to_date", ref: latest.sha, version: record.active?.version, refDate: latest.date, ...releaseInfo, note: releaseText };
      return { status: "update_available", ref: latest.sha, refDate: latest.date, version: latest.sha.slice(0, 7), ...releaseInfo, note: "깃허브에 이 스킬 경로를 바꾼 새 커밋이 있습니다 · " + releaseText };
    }
    if (origin.kind === "user_folder") {
      if (!(await pathExists(io, origin.folder ?? ""))) return { status: "source_missing", note: "원본 폴더를 찾지 못했습니다." };
      const { files } = await readSkillFolder(origin.folder, { io });
      const checked = validateSkillFiles(files, { expectedName: record.name });
      if (!checked.ok) return { status: "check_failed", note: checked.problems.join(" ") };
      if (checked.sha256 === (origin.sourceSha256 || record.active?.sha256)) return { status: "up_to_date", sha256: checked.sha256, version: record.active?.version };
      return { status: "update_available", sha256: checked.sha256, version: checked.meta.version || "r-" + checked.sha256.slice(0, 8), note: "원본 폴더 내용이 바뀌었습니다." };
    }
    if (origin.kind === "website") {
      if (!websiteCatalog) return { status: "not_checked" };
      if (fresh && record.latest) return { ...record.latest, reused: true };
      const catalog = await websiteCatalog({ force });
      const entry = catalog?.skills?.find((item) => item.name === record.name);
      if (!entry) return { status: "source_missing", note: "웹사이트 카탈로그에 없습니다." };
      const bundled = bundledCatalog ? (await bundledCatalog())?.skills?.find((item) => item.name === record.name) : null;
      const bundledSha = bundled?.integrity?.sha256 ?? "";
      if (bundled && bundledSha === entry.sha256) return { status: "up_to_date", version: entry.version, sha256: entry.sha256 };
      const order = compareSkillVersions(entry.version, bundled?.version ?? record.active?.version);
      if (order !== null && order > 0) return { status: "app_update_needed", version: entry.version, sha256: entry.sha256, note: "웹사이트에 " + entry.version + " 이 있지만 이 앱에는 " + (bundled?.version ?? "없음") + " 입니다." };
      return { status: "up_to_date", version: entry.version, sha256: entry.sha256 };
    }
    if (origin.kind === "app_bundled") {
      const bundled = bundledCatalog ? (await bundledCatalog())?.skills?.find((item) => item.name === record.name) : null;
      if (!bundled) return { status: "source_missing", note: "이 앱 버전에 이 스킬이 없습니다." };
      const bundledSha = bundled.integrity?.sha256 ?? "";
      if (!websiteCatalog) return { status: "up_to_date", version: bundled.version, sha256: bundledSha };
      if (fresh && record.latest) return { ...record.latest, reused: true };
      const catalog = await websiteCatalog({ force });
      const entry = catalog?.skills?.find((item) => item.name === record.name);
      const order = entry ? compareSkillVersions(entry.version, bundled.version) : null;
      if (order !== null && order > 0) return { status: "app_update_needed", version: entry.version, sha256: entry.sha256, note: "웹사이트에 " + entry.version + " 이 있지만 이 앱에는 " + bundled.version + " 입니다." };
      return { status: "up_to_date", version: bundled.version, sha256: bundledSha, note: entry ? "" : "웹사이트 게시 전(앱에 포함)" };
    }
    if (origin.kind === "this_pc") {
      if (!(await pathExists(io, origin.folder ?? ""))) return { status: "source_missing", note: "이 PC 스킬 폴더를 찾지 못했습니다." };
      const tree = await folderTreeHash(origin.folder, { io });
      if (!origin.sha256 || tree.sha256 === origin.sha256) return { status: "up_to_date", sha256: tree.sha256 };
      return { status: "source_changed", sha256: tree.sha256, note: "이 PC 원본이 바뀌었습니다(원래 위치에서 관리)." };
    }
    return { status: "local_only" };
  }

  /**
   * 최신 확인. 원격(깃허브·웹사이트)은 6시간에 한 번만 묻고(force 면 바로), 템플릿·폴더는 매번 본다.
   * 같은 새 버전으로는 알림을 한 번만 만든다(notifiedFor).
   */
  function checkUpdates({ names = null, force = false } = {}) {
    return serial(async () => {
      const index = await readIndex();
      const wanted = Array.isArray(names) && names.length ? new Set(names.map((name) => clip(name, 64))) : null;
      const items = [];
      const notifications = [];
      for (const record of Object.values(index.skills)) {
        if (wanted && !wanted.has(record.name)) continue;
        let latest;
        try { latest = await latestSource(record, { force }); }
        catch (error) { latest = { status: "check_failed", note: String(error?.message ?? error).slice(0, 200), code: error?.code }; }
        const local = await localStatus(record).catch(() => ({ localModified: false }));
        let status = latest.status;
        if (status === "update_available" && local.localModified) status = "update_available_modified";
        else if (status === "up_to_date" && local.localModified) status = "modified_locally";
        const reused = Boolean(latest.reused);
        delete latest.reused;
        const previousStatus = record.latest?.status;
        record.latest = { ...latest, status, checkedAt: reused ? record.latest?.checkedAt ?? stamp() : stamp(), lastSeenAt: stamp() };
        if (previousStatus !== status) pushHistory(record, { action: "check", note: skillUpdateStatusLabels[status] + (latest.note ? " · " + latest.note : "") });
        const key = status.startsWith("update_available") ? [record.name, latest.version, latest.sha256, latest.ref].join("|") : "";
        const item = {
          name: record.name, label: record.label, storage: record.storage, origin: record.origin?.kind, originLabel: skillOriginLabels[record.origin?.kind] ?? "",
          currentVersion: record.active?.version ?? "", latestVersion: latest.version ?? "", status, statusLabel: skillUpdateStatusLabels[status] ?? status,
          localModified: Boolean(local.localModified), usedBy: record.usedBy ?? [], note: latest.note ?? "", checkedAt: record.latest.checkedAt,
          ...(latest.releaseTag ? { releaseTag: latest.releaseTag, releaseDate: latest.releaseDate ?? "", releaseUrl: latest.releaseUrl ?? "" } : {}),
          action: status === "update_available" ? "apply" : status === "update_available_modified" ? "compare" : status === "app_update_needed" ? "app_update" : status === "modified_locally" ? "adopt_local" : "none",
        };
        items.push(item);
        if (key && record.notifiedFor !== key) {
          record.notifiedFor = key;
          notifications.push({ name: record.name, text: skillUpdateNotice(item), action: item.action, latestVersion: item.latestVersion });
        }
      }
      await writeIndex(index);
      return result("checked", items.some((item) => item.status.startsWith("update_available")) ? "새 버전이 있는 스킬이 있습니다." : "모든 스킬을 확인했습니다.", { checkedAt: stamp(), items, notifications });
    });
  }

  /** 최신 원본 파일 받기(적용·비교용). */
  async function fetchLatestFiles(record) {
    const origin = record.origin ?? {};
    if (String(origin.track ?? "").startsWith("reviewed-reference:")) throw Object.assign(new Error("원본 의존 묶음은 개별 자동 갱신할 수 없습니다. 카탈로그의 새 고정 버전 검토가 필요합니다."), { code: "NOT_MANAGED" });
    if (origin.kind === "app_template") {
      const template = (await templates()).find((item) => item.id === origin.templateId);
      if (!template) throw new Error("이 앱 버전에 템플릿이 없습니다.");
      return { files: template.files, version: template.version, sourceRef: "template:" + template.id };
    }
    if (origin.kind === "github") {
      const ref = record.latest?.ref && /^[0-9a-f]{40}$/u.test(record.latest.ref) ? record.latest.ref : "";
      const fetched = await fetchGitHubSkill({ owner: origin.owner, repo: origin.repo, path: origin.path ?? "", ref: ref || origin.track || "" }, { fetch: fetchImpl });
      return { files: fetched.files, version: "", versionHint: fetched.commit.slice(0, 7), sourceRef: fetched.commit, refDate: fetched.commitDate, license: fetched.repoLicense };
    }
    if (origin.kind === "user_folder") {
      const { files } = await readSkillFolder(origin.folder, { io });
      return { files, version: "" };
    }
    throw Object.assign(new Error("이 스킬은 앱이 직접 갱신하지 않습니다(" + (skillOriginLabels[origin.kind] ?? origin.kind) + ")."), { code: "NOT_MANAGED" });
  }

  function diffFiles(beforeFiles, afterFiles) {
    const before = new Map((beforeFiles ?? []).map((file) => [file.path, file]));
    const changes = [];
    for (const file of afterFiles ?? []) {
      const old = before.get(file.path);
      before.delete(file.path);
      if (!old) changes.push({ path: file.path, change: "added", after: clip(file.content, 6000) });
      else if (old.binary || file.binary ? old.size !== file.size : normalizeLf(old.content) !== normalizeLf(file.content)) changes.push({ path: file.path, change: "changed", before: clip(old.content, 6000), after: clip(file.content, 6000) });
    }
    for (const old of before.values()) changes.push({ path: old.path, change: "removed", before: clip(old.content, 6000) });
    return changes;
  }

  /** 비교: 지금 쓰는 배포본(없으면 활성 버전)과 최신 원본. 적용 전에 사용자에게 보여 준다. */
  function compare(name) {
    return serial(async () => {
      const index = await readIndex();
      const record = index.skills[clip(name, 64)];
      if (!record || record.storage !== "stored") return result("not_found", "보관함에 저장된 스킬이 아닙니다.");
      const latest = await fetchLatestFiles(record);
      const checked = validateSkillFiles(latest.files, { expectedName: record.name });
      if (!checked.ok) return result("invalid", "최신 원본을 확인하지 못했습니다: " + checked.problems.join(" "), { problems: checked.problems });
      const deployedDir = path.join(deployRoot, record.name);
      const current = (await pathExists(io, deployedDir)) ? (await readSkillFolder(deployedDir, { io })).files : (await readStoredVersion(record.name, record.versions.find((entry) => entry.sha256 === record.active.sha256))).files;
      const local = await localStatus(record);
      return result("compare", "바뀐 파일 " + diffFiles(current, checked.files).length + "개입니다.", {
        name: record.name, fromVersion: record.active?.version, toVersion: latest.version || checked.meta.version || latest.versionHint || "r-" + checked.sha256.slice(0, 8), toSha256: checked.sha256,
        localModified: local.localModified, unpreservable: local.unpreservable ?? [], changes: diffFiles(current, checked.files),
      });
    });
  }

  const unpreservableMessage = (items, what) => "공용 스킬 폴더에 보관함에 옮겨 담을 수 없는 항목(" + items.slice(0, 5).join(", ") + (items.length > 5 ? " 외 " + (items.length - 5) + "개" : "") + ")이 있어 " + what + " 그 항목을 스킬 폴더 밖으로 옮기거나 직접 정리한 뒤 다시 시도해 주세요.";

  /** 직접 고친 배포본을 새 버전으로 보관한다(덮어쓰기 전에). 옮겨 담을 수 없는 항목이 있거나 형식이 틀리면 멈춘다. */
  async function preserveLocalCopy(record, local, note) {
    if (local.unpreservable?.length) return { ok: false, response: result("needs_review", unpreservableMessage(local.unpreservable, "바꾸지 않았습니다."), { unpreservable: local.unpreservable }) };
    const { files } = await readSkillFolder(local.target, { io });
    const mine = validateSkillFiles(files, { expectedName: record.name });
    if (!mine.ok) return { ok: false, response: result("invalid", "직접 고친 사본을 보관하지 못해 멈췄습니다(아무것도 바꾸지 않음): " + mine.problems.join(" "), { problems: mine.problems }) };
    const localVersion = (record.active?.version || "r") + "-local." + ((record.versions ?? []).filter((entry) => /-local\.\d+$/u.test(entry.version)).length + 1);
    await activate(record, mine, { version: localVersion, note });
    pushHistory(record, { action: "adopt_local", version: localVersion, note });
    record.deployment = { to: local.target, sha256: mine.sha256, at: stamp() };
    return { ok: true, version: localVersion };
  }

  /**
   * 새 버전 적용. 직접 고친 배포본이 있으면 overwriteLocal 이 아니면 멈춘다. overwriteLocal 이면 고친 사본을 먼저 새 버전으로 보관한다.
   * expectedSha256 이 있으면 사용자가 비교 화면에서 본 내용과 같을 때만 적용한다. 배포에 실패하면 이전 활성 버전으로 되돌린다.
   * 되돌릴 때는 활성 버전·배포 기록·출처 기준(커밋·원본 해시)·버전 목록을 모두 적용 전으로 돌린다.
   */
  function applyUpdate(name, { expectedSha256 = "", overwriteLocal = false } = {}) {
    return serial(async () => {
      const index = await readIndex();
      const record = index.skills[clip(name, 64)];
      if (!record || record.storage !== "stored") return result("not_found", "보관함에 저장된 스킬이 아닙니다.");
      let latest;
      try { latest = await fetchLatestFiles(record); }
      catch (error) { return result(error?.code === "NOT_MANAGED" ? "not_managed" : "failed", String(error?.message ?? error)); }
      const checked = validateSkillFiles(latest.files, { expectedName: record.name });
      if (!checked.ok) return result("invalid", "최신 원본을 확인하지 못했습니다: " + checked.problems.join(" "), { problems: checked.problems });
      if (expectedSha256 && checked.sha256 !== expectedSha256) return result("changed_since_review", "비교한 뒤 원본이 또 바뀌었습니다. 다시 비교해 주세요.");
      if (checked.sha256 === record.active?.sha256) {
        record.latest = { ...(record.latest ?? {}), status: "up_to_date", checkedAt: stamp() };
        await writeIndex(index);
        return result("up_to_date", "이미 최신 버전입니다.", { skill: publicRecord(record, await localStatus(record)) });
      }
      const local = await deploymentState(record);
      if (local.state === "modified" && !overwriteLocal) {
        return result("needs_review", "직접 고친 내용이 있어 바로 바꾸지 않았습니다. 비교한 뒤 '내 수정본 보관 후 적용'을 골라 주세요.", { skill: publicRecord(record, await localStatus(record)) });
      }
      if (local.state === "foreign") return result("conflict", "공용 스킬 폴더에 보관함이 모르는 같은 이름 폴더가 있어 바꾸지 않았습니다.");
      if (local.state === "modified") {
        const kept = await preserveLocalCopy(record, local, "새 버전 적용 전 직접 고친 사본 보관");
        if (!kept.ok) return { ...kept.response, skill: publicRecord(record, await localStatus(record)) };
      }
      const version = latest.version || checked.meta.version || latest.versionHint || "r-" + checked.sha256.slice(0, 8);
      const beforeUpdate = record.active;
      const deploymentBefore = record.deployment;
      const originBefore = { ...record.origin };
      const versionsBefore = [...(record.versions ?? [])];
      let handle = null;
      try {
        await activate(record, checked, { version, note: "최신 원본 적용", sourceRef: latest.sourceRef, sourceSha256: checked.sha256 });
        if (record.origin.kind === "github" && latest.sourceRef) { record.origin.ref = latest.sourceRef; if (latest.refDate) record.origin.refDate = latest.refDate; }
        record.origin.sourceSha256 = checked.sha256;
        if (record.origin.kind === "app_template") record.origin.version = version;
        handle = await deployFiles(record.name, checked.files, checked.sha256);
        record.deployment = { to: handle.target, sha256: checked.sha256, at: stamp() };
      } catch (error) {
        record.active = beforeUpdate;
        record.deployment = deploymentBefore;
        record.origin = originBefore;
        record.versions = versionsBefore;
        pushHistory(record, { action: "update_failed", version, from: beforeUpdate?.version, note: String(error?.message ?? error).slice(0, 200) });
        await writeIndex(index);
        if (!versionsBefore.some((entry) => entry.sha256 === checked.sha256)) await io.rm(versionDir(record.name, version, checked.sha256), { recursive: true, force: true }).catch(() => undefined);
        return result("failed", "새 버전을 적용하지 못해 이전 버전으로 되돌렸습니다: " + String(error?.message ?? error), { skill: publicRecord(record, await localStatus(record)) });
      }
      record.latest = { ...(record.latest ?? {}), status: "up_to_date", version, sha256: checked.sha256, checkedAt: stamp() };
      record.userModified = false;
      pushHistory(record, { action: "update", version, from: beforeUpdate?.version });
      const dropped = trimVersions(record);
      try { await commitIndex(index, handle); }
      catch (error) { return result("failed", "새 버전 기록을 저장하지 못해 공용 스킬 폴더를 적용 전으로 되돌렸습니다: " + String(error?.message ?? error)); }
      await removeVersionDirs(record.name, dropped);
      return result("updated", "'" + record.label + "' 스킬을 " + version + " 버전으로 바꿨습니다. 이전 버전(" + (beforeUpdate?.version ?? "") + ")은 보관함에 남겨 두었습니다.", { skill: publicRecord(record, await localStatus(record)) });
    });
  }

  /**
   * 이전 버전으로 되돌리기. 직접 고친 배포본이 있으면 overwriteLocal 이 아니면 멈춘다.
   * overwriteLocal 이어도 고친 사본을 먼저 새 버전으로 보관한 뒤 되돌린다(옮겨 담을 수 없는 항목이 있으면 멈춘다).
   */
  function rollback(name, { overwriteLocal = false } = {}) {
    return serial(async () => {
      const index = await readIndex();
      const record = index.skills[clip(name, 64)];
      if (!record || record.storage !== "stored") return result("not_found", "보관함에 저장된 스킬이 아닙니다.");
      const position = (record.versions ?? []).findIndex((entry) => entry.sha256 === record.active?.sha256);
      const previous = position > 0 ? record.versions[position - 1] : null;
      if (!previous) return result("no_previous", "되돌릴 이전 버전이 없습니다.");
      const local = await deploymentState(record);
      if (local.state === "modified" && !overwriteLocal) return result("needs_review", "직접 고친 내용이 있어 되돌리지 않았습니다. 먼저 '내 수정본 보관'을 눌러 주세요.");
      if (local.state === "foreign") return result("conflict", "공용 스킬 폴더에 보관함이 모르는 같은 이름 폴더가 있어 바꾸지 않았습니다.");
      let checked;
      try { checked = await readStoredVersion(record.name, previous); }
      catch (error) { return result("integrity_failed", String(error?.message ?? error) + " 되돌리지 않았습니다."); }
      if (local.state === "modified") {
        const kept = await preserveLocalCopy(record, local, "되돌리기 전 직접 고친 사본 보관");
        if (!kept.ok) return kept.response;
      }
      const from = record.active;
      let handle = null;
      try {
        handle = await deployFiles(record.name, checked.files, checked.sha256);
        record.active = { version: previous.version, sha256: previous.sha256 };
        record.deployment = { to: handle.target, sha256: checked.sha256, at: stamp() };
        // 원본 기준도 그 버전으로 돌린다(직접 고친 사본 버전이면 원본 기준은 그대로). 다음 확인 때 새 버전을 다시 알려 주되 같은 버전 알림은 반복하지 않는다.
        if (!/-local\.\d+$/u.test(previous.version)) {
          record.origin.sourceSha256 = previous.sourceSha256 ?? previous.sha256;
          if (record.origin.kind === "github" && previous.sourceRef) record.origin.ref = previous.sourceRef;
          if (record.origin.kind === "app_template") record.origin.version = previous.version;
        }
        record.latest = { status: "not_checked", checkedAt: "" };
      } catch (error) {
        pushHistory(record, { action: "rollback_failed", version: previous.version, from: from?.version, note: String(error?.message ?? error).slice(0, 200) });
        await writeIndex(index);
        return result("failed", "되돌리지 못했습니다. 지금 버전을 그대로 둡니다: " + String(error?.message ?? error));
      }
      pushHistory(record, { action: "rollback", version: previous.version, from: from?.version });
      try { await commitIndex(index, handle); }
      catch (error) { return result("failed", "되돌린 기록을 저장하지 못해 공용 스킬 폴더를 원래대로 두었습니다: " + String(error?.message ?? error)); }
      return result("rolled_back", "'" + record.label + "' 스킬을 " + previous.version + " 버전으로 되돌렸습니다.", { skill: publicRecord(record, await localStatus(record)) });
    });
  }

  /** 직접 고친 배포본을 새 버전으로 보관(덮어쓰지 않고 남긴다). 숨김 파일·바이너리처럼 옮겨 담을 수 없는 항목이 있으면 멈춘다. */
  function adoptLocal(name) {
    return serial(async () => {
      const index = await readIndex();
      const record = index.skills[clip(name, 64)];
      if (!record || record.storage !== "stored") return result("not_found", "보관함에 저장된 스킬이 아닙니다.");
      const local = await deploymentState(record);
      if (local.state !== "modified") return result("not_modified", "직접 고친 내용이 없습니다.");
      if (local.unpreservable?.length) return result("needs_review", unpreservableMessage(local.unpreservable, "보관하지 않았습니다."), { unpreservable: local.unpreservable });
      const { files } = await readSkillFolder(local.target, { io });
      const mine = validateSkillFiles(files, { expectedName: record.name });
      if (!mine.ok) return result("invalid", "고친 사본을 보관하지 못했습니다: " + mine.problems.join(" "), { problems: mine.problems });
      const version = (record.active?.version || "r") + "-local." + ((record.versions ?? []).filter((entry) => /-local\.\d+$/u.test(entry.version)).length + 1);
      await activate(record, mine, { version, note: "직접 고친 사본 보관" });
      record.deployment = { to: local.target, sha256: mine.sha256, at: stamp() };
      record.userModified = true;
      pushHistory(record, { action: "adopt_local", version });
      const dropped = trimVersions(record);
      await writeIndex(index);
      await removeVersionDirs(record.name, dropped);
      return result("adopted", "직접 고친 내용을 " + version + " 버전으로 보관했습니다. 원본에 새 버전이 오면 비교한 뒤 적용합니다.", { skill: publicRecord(record, await localStatus(record)) });
    });
  }

  /** 공용 스킬 폴더에 활성 버전을 다시 넣는다(지워졌거나 이전 버전이 남아 있을 때). 직접 고친 폴더·다른 스킬 폴더는 건드리지 않는다. */
  function redeploy(name) {
    return serial(async () => {
      const index = await readIndex();
      const record = index.skills[clip(name, 64)];
      if (!record || record.storage !== "stored") return result("not_found", "보관함에 저장된 스킬이 아닙니다.");
      let deployed;
      try { deployed = await deployRecord(record); }
      catch (error) {
        pushHistory(record, { action: "deploy_failed", version: record.active?.version, note: String(error?.message ?? error).slice(0, 200) });
        await writeIndex(index);
        return result("failed", "공용 스킬 폴더에 넣지 못했습니다: " + String(error?.message ?? error));
      }
      if (!deployed.deployed) {
        return result(deployed.reason === "modified" ? "needs_review" : "conflict", deployed.reason === "modified" ? "직접 고친 내용이 있어 바꾸지 않았습니다. '내 수정본 보관'을 먼저 눌러 주세요." : "공용 스킬 폴더에 같은 이름의 다른 스킬 폴더가 있어 바꾸지 않았습니다.", { skill: publicRecord(record, await localStatus(record)) });
      }
      await commitIndex(index, deployed.handle);
      return result("deployed", deployed.unchanged ? "이미 공용 스킬 폴더에 지금 버전이 들어 있습니다." : "'" + record.label + "' 스킬 " + (record.active?.version ?? "") + " 버전을 공용 스킬 폴더에 다시 넣었습니다.", { skill: publicRecord(record, await localStatus(record)), target: deployed.target });
    });
  }

  /** 웹사이트 게시 후보 표시. 켜면 후보 파일(publish-candidates/<이름>.json)을 만든다. 게시는 사람이 따로 한다. */
  function setPublishCandidate(name, flag = true) {
    return serial(async () => {
      const index = await readIndex();
      const record = index.skills[clip(name, 64)];
      if (!record || record.storage !== "stored") return result("not_found", "보관함에 저장된 스킬만 게시 후보로 모을 수 있습니다.");
      record.publishCandidate = Boolean(flag);
      pushHistory(record, { action: flag ? "publish_candidate" : "publish_candidate_off", version: record.active?.version });
      let file = "";
      if (flag) {
        const entry = record.versions.find((item) => item.sha256 === record.active.sha256);
        const checked = await readStoredVersion(record.name, entry);
        file = path.join(candidatesRoot, record.name + ".json");
        await io.mkdir(candidatesRoot, { recursive: true });
        await io.writeFile(file, JSON.stringify(buildPublishCandidate(record, checked), null, 2), "utf8");
      }
      await writeIndex(index);
      return result(flag ? "publish_candidate" : "publish_candidate_off", flag ? "웹사이트 게시 후보로 모았습니다(게시는 별도 승인)." : "게시 후보에서 뺐습니다.", { skill: publicRecord(record), file });
    });
  }

  function listPublishCandidates() {
    return readIndex().then((index) => {
      const skills = Object.values(index.skills).filter((record) => record.publishCandidate).map((record) => publicRecord(record));
      return result("publish_candidates", skills.length ? "게시 후보 " + skills.length + "개입니다." : "게시 후보가 없습니다.", { skills, folder: candidatesRoot });
    });
  }

  return { add, track, setUsedBy, list, get, readActiveFiles, checkUpdates, compare, applyUpdate, rollback, adoptLocal, redeploy, setPublishCandidate, listPublishCandidates, root, deployRoot };
}

/** 웹사이트 카탈로그 항목 모양의 게시 후보(검토용 초안). */
export function buildPublishCandidate(record, checked) {
  return {
    schema: "modycrew.crew-skill-catalog-candidate.v1",
    name: record.name, label: record.label, description: checked.meta.description, version: record.active.version,
    origin: record.origin, license: checked.meta.license || record.license || "",
    compatibility: checked.meta.compatibility, allowedTools: checked.meta.allowedTools,
    integrity: { algorithm: skillHashAlgorithm, sha256: checked.sha256, files: checked.files.map((file) => file.path) },
    packageNote: checked.files.some((file) => !/\.(md|txt|json)$/iu.test(file.path)) ? "스크립트 파일이 있어 지금 크루 스킬 패키지 형식(.md·.txt·.json 만 허용)으로는 실을 수 없습니다. 패키지 형식 확장 또는 앱 동봉이 필요합니다." : "",
    usedBy: (record.usedBy ?? []).map((item) => item.name || item.teammateId),
    status: "candidate", note: "게시 전 검토·실제 실행 검증·사용자 승인이 필요합니다.",
  };
}

/** 알림 문구: 쓰는 직원 이름이 있으면 직원 이름으로 말한다. */
export function skillUpdateNotice(item) {
  const owner = (item.usedBy ?? []).map((entry) => entry.name).filter(Boolean)[0];
  const subject = owner ? "'" + owner + "' 스킬(" + (item.label || item.name) + ")" : "'" + (item.label || item.name) + "' 스킬";
  if (item.status === "update_available_modified") return subject + " 새 버전이 있어요 — 직접 고친 내용이 있어 비교한 뒤 적용해 주세요.";
  return subject + " 새 버전이 있어요 — 적용할까요?";
}

/**
 * 주기 확인(MODY 비서 1분 점검·하루 1회 점검에서 부른다). 원격은 6시간에 한 번만 묻고, 같은 새 버전 알림은 한 번만 만든다.
 * 돌려주는 notifications 를 그대로 비서 메시지로 쓰면 된다.
 */
export async function checkSkillUpdates(library, { force = false, names = null } = {}) {
  const checked = await library.checkUpdates({ force, names });
  return { checkedAt: checked.checkedAt, items: checked.items, notifications: checked.notifications, userMessage: checked.userMessage };
}

