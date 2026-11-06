import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { readDesktopFileAccess, setDesktopFileAccess, assertDesktopFileAccess } from "./chat-local-file-access.mjs";

const running = new Map();
const desktopLocks = new Set();
const groups = {
  문서: [".pdf", ".doc", ".docx", ".hwp", ".hwpx", ".txt", ".md", ".xlsx", ".xls", ".csv", ".ppt", ".pptx", ".odt"],
  이미지: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".svg", ".bmp"],
  영상: [".mp4", ".mov", ".avi", ".mkv", ".webm"],
  음성: [".mp3", ".wav", ".m4a", ".flac"],
  압축파일: [".zip", ".7z", ".rar", ".tar", ".gz"],
};
const outputName = "ModyCrew_정리";
const category = name => name.startsWith(".") ? undefined : Object.keys(groups).find(group => groups[group].includes(path.extname(name).toLowerCase()));
const keyOf = value => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
const exists = async file => { try { return await fs.lstat(file); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };
async function digest(file) { const hash = createHash("sha256"); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest("hex"); }
async function fingerprint(file) {
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("일반 파일만 정리할 수 있습니다.");
  const sha256 = await digest(file);
  const after = await fs.lstat(file);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new Error("확인 중 파일이 변경되었습니다.");
  return { size: after.size, mtime: after.mtimeMs, sha256, ino: after.ino };
}
const matches = (a, b) => a.size === b.size && a.sha256 === b.sha256;
async function directory(parent, name) {
  const target = path.join(parent, name);
  await fs.mkdir(target).catch(e => { if (e.code !== "EEXIST") throw e; });
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || keyOf(await fs.realpath(target)) !== keyOf(target)) throw new Error("정리 폴더가 다른 위치로 연결되어 있어 중단했습니다.");
  return target;
}
async function persist(file, data) {
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(temp, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(data)); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temp, file);
}
function view(plan) {
  return { status: plan.status, approvalToken: plan.approvalToken, directory: path.join(plan.desktop, outputName),
    total: plan.files.length, moved: plan.files.filter(f => f.state === "moved").length,
    restored: plan.files.filter(f => f.state === "restored").length, skipped: plan.skipped,
    files: plan.files.map(f => ({ name: f.name, destination: `${outputName}/${f.category}/${f.name}`, state: f.state, detail: f.detail })),
    userMessage: plan.userMessage || "", externalMutation: plan.files.some(f => f.state === "moved") };
}
function validate(plan, context) {
  if (plan.version !== 1 || plan.threadId !== context.threadId || plan.scopeKey !== context.scopeKey || keyOf(plan.desktop) !== keyOf(context.desktop) ||
      !Array.isArray(plan.files) || plan.files.length > 500 || plan.files.some(f => path.basename(f.name) !== f.name || !category(f.name) || category(f.name) !== f.category)) {
    throw new Error("이 대화의 정리 기록을 확인할 수 없습니다.");
  }
}

// Uses the OS's actual Desktop location. No screen-control service, model or
// renderer-supplied source/destination path is needed for local file operations.
export async function handleChatDesktopTidy(payload, options) {
  const context = payload.chatTidy;
  if (!context || !/^[a-zA-Z0-9_-]{8,160}$/.test(context.requestId) || !context.threadId || !context.scopeKey) throw new Error("정리 요청의 대화 범위를 확인해 주세요.");
  const authorized = await options.resolveAuthorizedLocalStorageRoot?.();
  if (!authorized || !payload.localStorageRoot || keyOf(authorized) !== keyOf(payload.localStorageRoot)) throw new Error("저장 위치가 바뀌었습니다. 현재 대화에서 다시 시작해 주세요.");
  const root = await fs.realpath(authorized);
  if (payload.kind === "preview_folder_plan" && ["access", "set_access"].includes(context.intent)) {
    const access = context.intent === "set_access" ? await setDesktopFileAccess(root, context, context.accessMode) : await readDesktopFileAccess(root, context);
    return { status: "access", files: [], access };
  }
  let access = await readDesktopFileAccess(root, context);
  const viewWithAccess = plan => ({ ...view(plan), access });
  const desktop = await fs.realpath(options.app.getPath("desktop"));
  const scope = { ...context, desktop };
  const index = await directory(root, "ModyCrew_Desktop_Tidy");
  const file = path.join(index, createHash("sha256").update(`${context.scopeKey}\0${context.threadId}\0${context.requestId}`).digest("hex") + ".json");
  const read = async () => { const plan = JSON.parse(await fs.readFile(file, "utf8")); validate(plan, scope); return plan; };
  if (payload.kind === "preview_folder_plan") {
    const live = running.get(file);
    if (context.intent === "cancel" && live) { live.cancel = true; return { ...viewWithAccess(live.plan), userMessage: "현재 파일 처리를 마친 뒤 멈춥니다." }; }
    if (live) return viewWithAccess(live.plan);
    const plan = await read().catch(e => { if (e.code === "ENOENT") return null; throw e; });
    if (!plan) return { status: "not_started", files: [], access };
    if (["applying", "reverting"].includes(plan.status)) {
      // Reconcile a persisted intent after a crash; never silently re-run it.
      for (const entry of plan.files.filter(f => ["moving", "restoring"].includes(f.state))) {
        const original = await exists(path.join(desktop, entry.name));
        const target = await exists(path.join(desktop, outputName, entry.category, entry.name));
        entry.state = !original && target?.isFile() ? "moved" : original?.isFile() && !target ? "restored" : "review";
      }
      plan.status = "interrupted";
      plan.userMessage = "이전 실행이 중단되었습니다. 처리 기록을 확인하고 이동된 파일을 되돌릴 수 있습니다.";
      await persist(file, plan);
    }
    if (context.intent === "cancel" && plan.status === "ready") { plan.status = "cancelled"; await persist(file, plan); }
    if (context.intent === "open" && plan.files.some(f => f.state === "moved")) {
      const target = path.join(desktop, outputName);
      if (keyOf(await fs.realpath(target)) !== keyOf(target)) throw new Error("폴더 위치가 변경되었습니다.");
      const error = await options.shell?.openPath(target); if (error) throw new Error(error);
    }
    return viewWithAccess(plan);
  }
  if (running.has(file)) return viewWithAccess(running.get(file).plan);
  if (payload.kind === "create_folder_plan") {
    assertDesktopFileAccess(access, "prepare");
    const previous = await read().catch(e => { if (e.code === "ENOENT") return null; throw e; });
    if (previous) return viewWithAccess(previous);
    if (running.has(file)) return viewWithAccess(running.get(file).plan);
    const plan = { version: 1, ...scope, status: "scanning", approvalToken: randomUUID(), files: [], skipped: 0 };
    const task = { plan, cancel: false }; running.set(file, task);
    try {
      for (const entry of await fs.readdir(desktop, { withFileTypes: true })) {
        access = await readDesktopFileAccess(root, context);
        if (access.mode === "disabled") { task.cancel = true; plan.userMessage = "파일 접근이 꺼져 확인을 중지했습니다."; }
        if (task.cancel) break;
        const group = category(entry.name);
        if (!entry.isFile() || entry.isSymbolicLink() || !group || plan.files.length >= 500) { plan.skipped++; continue; }
        const target = path.join(desktop, outputName, group, entry.name);
        if (await exists(target)) { plan.skipped++; continue; }
        try { plan.files.push({ name: entry.name, category: group, fingerprint: await fingerprint(path.join(desktop, entry.name)), state: "pending" }); }
        catch { plan.skipped++; }
      }
      plan.status = task.cancel ? "cancelled" : plan.files.length ? "ready" : "empty";
      await persist(file, plan);
      return viewWithAccess(plan);
    } finally { running.delete(file); }
  }
  const plan = await read();
  if (context.approvalToken !== plan.approvalToken) throw new Error("표시된 정리 목록을 승인한 뒤 실행해 주세요.");
  assertDesktopFileAccess(access, payload.kind === "revert_folder_plan" ? "revert" : "apply", { finalApproval: payload.finalApproval === true, automatic: context.automatic === true });
  const reverting = payload.kind === "revert_folder_plan";
  if (reverting ? !["completed", "partial", "interrupted", "cancelled"].includes(plan.status) : plan.status !== "ready") return viewWithAccess(plan);
  if (desktopLocks.has(keyOf(desktop))) throw new Error("다른 바탕화면 정리가 실행 중입니다. 마친 뒤 다시 눌러 주세요.");
  desktopLocks.add(keyOf(desktop));
  const task = { plan, cancel: false }; running.set(file, task);
  try {
    plan.status = reverting ? "reverting" : "applying";
    await persist(file, plan); // No filesystem mutation before the durable journal.
    const organized = await directory(desktop, outputName);
    for (const entry of plan.files) {
      if (!reverting) {
        const currentAccess = await readDesktopFileAccess(root, context);
        access = currentAccess;
        if (currentAccess.mode === "disabled" || (context.automatic === true && currentAccess.mode !== "auto")) {
          task.cancel = true; plan.userMessage = "파일 접근 설정이 바뀌어 정리를 멈췄습니다.";
        }
      }
      if (task.cancel) break;
      if (reverting ? entry.state !== "moved" : entry.state !== "pending") continue;
      const group = await directory(organized, entry.category);
      const from = reverting ? path.join(group, entry.name) : path.join(desktop, entry.name);
      const to = reverting ? path.join(desktop, entry.name) : path.join(group, entry.name);
      try {
        const current = await fingerprint(from);
        if (!matches(current, entry.fingerprint)) throw new Error("승인 후 파일이 변경되어 유지했습니다.");
        if (await exists(to)) throw new Error("같은 이름의 파일이 있어 유지했습니다.");
        entry.state = reverting ? "restoring" : "moving";
        await persist(file, plan);
        // link is atomic and fails if destination exists (unlike rename on POSIX).
        // Both paths are on the same Desktop volume. Unsupported FS fails closed.
        await fs.link(from, to);
        const check = await fingerprint(from);
        if (!matches(check, current) || check.ino !== current.ino) throw new Error("실행 중 파일이 변경되어 두 위치를 보존했습니다.");
        await fs.unlink(from);
        entry.state = reverting ? "restored" : "moved";
        entry.detail = "";
      } catch (error) {
        entry.detail = error.code === "EPERM" || error.code === "EACCES" ? "이 파일에 접근할 수 없어 원본을 유지했습니다." : error.message;
        entry.state = reverting ? "moved" : ["moving", "restoring"].includes(entry.state) ? "review" : "skipped";
      }
      await persist(file, plan);
    }
    plan.status = task.cancel ? "cancelled" : plan.files.some(f => f.detail || f.state === "pending") ? "partial" : reverting ? "reverted" : "completed";
    await persist(file, plan);
    return viewWithAccess(plan);
  } catch (error) {
    plan.status = "interrupted"; plan.userMessage = `정리가 중단되었습니다. ${error.message}`;
    await persist(file, plan).catch(() => {});
    return viewWithAccess(plan);
  } finally { running.delete(file); desktopLocks.delete(keyOf(desktop)); }
}
