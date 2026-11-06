import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export const desktopFileAccessModes = ["disabled", "approval", "auto"];
const key = value => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
async function location(root, scope, create = false) {
  if (!scope?.scopeKey || !scope?.threadId) throw new Error("파일 접근의 대화 범위가 없습니다.");
  const parent = await fs.realpath(root);
  const directory = path.join(parent, "ModyCrew_Desktop_Tidy");
  if (create) await fs.mkdir(directory, { recursive: true });
  const stat = await fs.lstat(directory).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink() || key(await fs.realpath(directory)) !== key(directory))) throw new Error("파일 권한 저장 위치가 변경되었습니다.");
  return path.join(directory, "access-" + createHash("sha256").update(`${scope.scopeKey}\0${scope.threadId}`).digest("hex") + ".json");
}

// The trusted renderer's explicit access-menu action is the only setter. This
// API is not registered as a model tool. The host checks origin and storage root
// before invoking it. A model string or old web preference never grants access.
export async function readDesktopFileAccess(root, scope) {
  const file = await location(root, scope);
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("파일 접근 기록을 확인할 수 없습니다.");
    const saved = JSON.parse(await fs.readFile(file, "utf8"));
    if (saved.version !== 1 || saved.scopeKey !== scope.scopeKey || saved.threadId !== scope.threadId || !desktopFileAccessModes.includes(saved.mode)) throw new Error("파일 접근 기록의 범위가 다릅니다.");
    return saved;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { version: 1, scopeKey: scope.scopeKey, threadId: scope.threadId, mode: "approval", revision: "default" };
  }
}

export async function setDesktopFileAccess(root, scope, mode) {
  if (!desktopFileAccessModes.includes(mode)) throw new Error("지원하지 않는 파일 접근 설정입니다.");
  const file = await location(root, scope, true);
  const record = { version: 1, scopeKey: scope.scopeKey, threadId: scope.threadId, mode, revision: randomUUID(), updatedAt: new Date().toISOString() };
  const temporary = `${file}.${record.revision}.tmp`;
  const handle = await fs.open(temporary, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temporary, file);
  return record;
}

export function assertDesktopFileAccess(access, action, { finalApproval = false, automatic = false } = {}) {
  // A user can always recover earlier changes or cancel after revoking access.
  if (action === "revert" && finalApproval) return;
  if (access.mode === "disabled") throw new Error("이 대화의 바탕화면 파일 접근이 꺼져 있습니다. 입력창의 권한 메뉴에서 켤 수 있습니다.");
  if (action === "prepare") return;
  if (action === "apply" && (finalApproval || (automatic && access.mode === "auto"))) return;
  throw new Error("표시된 이동 목록을 승인한 뒤 실행해 주세요.");
}
