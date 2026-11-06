import path from "node:path";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

const relativePath = path.join("memory", "chat", "work-sessions.v1.json");

function acquireLockInsideGate(lock) {
  const identity = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
  const open = () => {
    const descriptor = openSync(lock, "wx");
    try { writeFileSync(descriptor, identity, "utf8"); }
    catch (error) { closeSync(descriptor); throw error; }
    return { descriptor, identity };
  };
  try { return open(); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const locked = () => new Error("다른 창에서 업무 대화를 저장 중이거나 저장 잠금을 확인해야 합니다. 기존 자료는 보존했습니다.");
    // 시간만으로 살아 있는 작업자의 잠금을 빼앗지 않는다. 모르는 잠금도 남겨 둔다.
    let previous;
    let owner;
    try { previous = readFileSync(lock, "utf8"); owner = JSON.parse(previous); }
    catch { throw locked(); }
    if (!Number.isSafeInteger(owner?.pid) || owner.pid < 1 || typeof owner.nonce !== "string" || !/^[0-9a-f-]{36}$/iu.test(owner.nonce)) throw locked();
    try { process.kill(owner.pid, 0); throw locked(); }
    catch (probeError) { if (probeError.code !== "ESRCH") throw locked(); }
    if (readFileSync(lock, "utf8") !== previous) throw locked();
    unlinkSync(lock);
    try { return open(); } catch (retryError) { if (retryError.code === "EEXIST") throw locked(); throw retryError; }
  }
}

function acquireLock(lock) {
  // 모든 잠금 획득과 죽은 소유자 복구를 같은 gate 아래 직렬화한다.
  // 복구자가 멈춘 gate는 임의 해제하지 않는다. 원문 대신 별도 잠금만 확인하면 된다.
  const gate = `${lock}.recovery`;
  const identity = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
  let descriptor;
  try { descriptor = openSync(gate, "wx"); }
  catch (error) { if (error.code === "EEXIST") throw new Error("다른 창에서 저장 잠금을 확인 중입니다. 기존 자료는 보존했습니다."); throw error; }
  try {
    writeFileSync(descriptor, identity, "utf8");
    return acquireLockInsideGate(lock);
  } finally {
    closeSync(descriptor);
    if (existsSync(gate) && readFileSync(gate, "utf8") === identity) unlinkSync(gate);
  }
}

function read(root, domain) {
  const file = path.join(root, relativePath);
  return existsSync(file) ? domain.readWorkSessionWorkspace(JSON.parse(readFileSync(file, "utf8"))) : domain.createWorkSessionWorkspace();
}

export function loadWorkSessionWorkspaceStore(root, domain) {
  return { status: "work_session_workspace_loaded", workspace: read(root, domain), storage: "desktop", root, userMessage: "프로젝트와 업무 대화를 불러왔습니다." };
}

export function updateWorkSessionWorkspaceStore(root, command, domain) {
  const file = path.join(root, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const { descriptor, identity } = acquireLock(lock);
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    // 읽기부터 이름 변경까지 await 없이 실행해 같은 프로세스의 명령도 순서대로 반영한다.
    const workspace = domain.applyWorkSessionWorkspaceCommand(read(root, domain), command);
    writeFileSync(temporary, `${JSON.stringify(workspace, null, 2)}\n`, "utf8");
    renameSync(temporary, file);
    return { status: "work_session_workspace_updated", workspace, storage: "desktop", root, userMessage: "프로젝트와 업무 대화를 저장했습니다." };
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
    closeSync(descriptor);
    if (existsSync(lock) && readFileSync(lock, "utf8") === identity) unlinkSync(lock);
  }
}
