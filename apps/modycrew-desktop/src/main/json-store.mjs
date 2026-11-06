import { randomUUID } from "node:crypto";
import { copyFile, mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";

/**
 * 작은 JSON 저장 파일(연결 보관함, 업무 기록, 메일 원장, 자동화 규칙 등)을
 * 잃어버리지 않게 다루는 공통 도구.
 *
 * 예전 저장 방식은 "잠금 없이 읽고 → 고치고 → writeFile 로 통째로 덮어쓰기"였다.
 * 두 요청이 겹치면 늦게 쓴 쪽이 먼저 쓴 쪽의 기록을 지웠고(47건 → 1건 실측),
 * 쓰는 도중 앱이 꺼지거나 두 쓰기가 섞이면 파일이 깨져 다음 읽기가 빈 값이 됐다.
 *
 * 여기서 지키는 약속:
 *  1. 같은 파일에 대한 읽고-고치고-쓰기는 한 번에 하나씩만 돈다(파일별 대기열).
 *     대기열 안에서 다시 같은 파일의 대기열을 부르면 서로 기다리다 멈추므로 금지.
 *  2. 새 내용은 매번 다른 이름의 임시 파일에 끝까지 쓰고(디스크 반영 포함) rename 으로
 *     한 번에 바꾼다. 읽는 쪽은 옛 내용이나 새 내용 중 하나만 본다.
 *  3. 바꾸기 직전의 정상 내용은 `.previous` 에 남긴다. 본 파일이 깨졌으면 `.previous`
 *     로 되살리고, 깨진 원본은 `.unreadable-<시각>` 사본으로 보존한 뒤 덮어쓴다.
 *  4. Windows 에서 백신·색인기가 파일을 잠깐 잡고 있으면 rename 이 EPERM/EBUSY 로
 *     실패할 수 있어 짧게 몇 번 다시 시도한다.
 */

export const jsonStorePreviousSuffix = ".previous";
export const JSON_STORE_SKIP_WRITE = Symbol("json-store-skip-write");

const fileQueues = new Map();
const transientRenameErrorCodes = new Set(["EPERM", "EBUSY", "EACCES"]);
const renameRetryDelaysMs = [25, 80, 200];

function queueKey(filePath) {
  const resolved = path.resolve(String(filePath));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function previousPathFor(filePath) {
  return `${filePath}${jsonStorePreviousSuffix}`;
}

/**
 * 같은 파일에 대한 작업을 앞 작업이 끝난 뒤에 실행한다. 앞 작업이 실패해도 다음 작업은 돈다.
 */
export function withJsonFileLock(filePath, task) {
  const key = queueKey(filePath);
  const previous = fileQueues.get(key) ?? Promise.resolve();
  const run = previous.then(() => task());
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  fileQueues.set(key, settled);
  void settled.then(() => {
    if (fileQueues.get(key) === settled) fileQueues.delete(key);
  });
  return run;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function renameWithRetry(fromPath, toPath) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(fromPath, toPath);
      return;
    } catch (error) {
      if (!transientRenameErrorCodes.has(error?.code) || attempt >= renameRetryDelaysMs.length) throw error;
      await delay(renameRetryDelaysMs[attempt]);
    }
  }
}

async function writeFileDurably(filePath, text) {
  const handle = await open(filePath, "wx");
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** 임시 파일에 끝까지 쓴 뒤 rename 으로 한 번에 바꾼다. */
export async function replaceFileWithText(filePath, text) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFileDurably(tempPath, text);
    await renameWithRetry(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

// 읽기는 다른 프로그램이 파일을 잠깐 잡고 있을 때(EBUSY)만 짧게 다시 시도한다.
// 권한 문제(EPERM/EACCES)는 기다려도 풀리지 않으므로 바로 알린다.
async function readTextWithRetry(filePath) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      if (error?.code !== "EBUSY" || attempt >= renameRetryDelaysMs.length) throw error;
      await delay(renameRetryDelaysMs[attempt]);
    }
  }
}

function parseWith(raw, parse) {
  const parsed = JSON.parse(raw);
  return parse ? parse(parsed) : parsed;
}

/**
 * 저장 파일을 읽는다. 결과 status:
 *  - "ok": 본 파일을 정상으로 읽음
 *  - "missing": 본 파일이 아직 없음(처음 시작)
 *  - "recovered": 본 파일이 깨져 `.previous` 로 읽음
 *  - "unreadable": 본 파일이 깨졌고 쓸 만한 `.previous` 도 없음
 *  - "io_error": 파일은 있는데 읽지 못함(폴더이거나 잠겨 있음 등) — 추측으로 덮어쓰면 안 됨
 * parse 는 모양이 틀리면 throw 해서 "깨짐"으로 취급하게 한다.
 */
export async function readJsonStore(filePath, { parse } = {}) {
  let raw;
  try {
    raw = await readTextWithRetry(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "missing" };
    return { status: "io_error", error };
  }
  try {
    return { status: "ok", value: parseWith(raw, parse), raw };
  } catch (parseError) {
    try {
      const previousRaw = await readFile(previousPathFor(filePath), "utf8");
      return { status: "recovered", value: parseWith(previousRaw, parse), raw: previousRaw, error: parseError };
    } catch {
      return { status: "unreadable", error: parseError };
    }
  }
}

/** 읽기 전용 편의 함수: 읽지 못하면 empty() 를 돌려준다. */
export async function readJsonStoreValue(filePath, { parse, empty = () => null } = {}) {
  const loaded = await readJsonStore(filePath, { parse });
  return loaded.status === "ok" || loaded.status === "recovered" ? loaded.value : empty();
}

async function preserveUnreadableCopy(filePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await copyFile(filePath, `${filePath}.unreadable-${stamp}`).catch(() => {});
}

async function writePreviousText(filePath, text) {
  try {
    await replaceFileWithText(previousPathFor(filePath), text);
  } catch {
    // 백업을 못 남겨도 본 저장은 진행한다.
  }
}

/**
 * 파일별 대기열 안에서 최신 내용을 읽고 → mutator 로 고치고 → 원자적으로 저장한다.
 *
 * mutator(current, loaded) 는 current 를 직접 고치거나(undefined 반환) 새 값을 돌려준다.
 * JSON_STORE_SKIP_WRITE 를 돌려주면 저장하지 않는다.
 *
 * options:
 *  - parse(parsed): 모양 검증·정규화. 틀리면 throw.
 *  - empty(): 파일이 없을 때(또는 onUnreadable "reset" 일 때) 시작 값
 *  - serialize(value): 저장할 문자열. 기본은 2칸 들여쓴 JSON + 줄바꿈
 *  - onUnreadable: "reset"(깨진 원본을 사본으로 남기고 빈 값에서 시작) | "throw"
 *  - createUnreadableError(cause): "throw" 일 때 던질 오류
 *  - previousMode: "keep"(직전 정상 내용을 .previous 로) | "mirror"(새 내용을 .previous 에도 —
 *    비밀값을 지운 뒤 옛 사본에 남지 않게) | "none"
 */
export function mutateJsonStore(filePath, options = {}, mutator) {
  const {
    parse,
    empty = () => ({}),
    serialize = (value) => `${JSON.stringify(value, null, 2)}\n`,
    onUnreadable = "reset",
    createUnreadableError,
    previousMode = "keep",
  } = options;
  return withJsonFileLock(filePath, async () => {
    const loaded = await readJsonStore(filePath, { parse });
    if (loaded.status === "io_error" || (loaded.status === "unreadable" && onUnreadable === "throw")) {
      if (createUnreadableError) throw createUnreadableError(loaded.error);
      const error = new Error(`저장 파일을 읽지 못해 변경하지 않았습니다: ${path.basename(filePath)}`);
      error.code = "json_store_unreadable";
      error.cause = loaded.error;
      throw error;
    }
    const current = loaded.status === "ok" || loaded.status === "recovered" ? loaded.value : empty();
    const returned = await mutator(current, loaded);
    if (returned === JSON_STORE_SKIP_WRITE) return current;
    const next = returned === undefined ? current : returned;
    const text = serialize(next);
    if (loaded.status === "recovered" || loaded.status === "unreadable") {
      await preserveUnreadableCopy(filePath);
    } else if (loaded.status === "ok" && previousMode === "keep") {
      await writePreviousText(filePath, loaded.raw);
    }
    await replaceFileWithText(filePath, text);
    if (previousMode === "mirror") {
      try {
        await replaceFileWithText(previousPathFor(filePath), text);
      } catch {
        await unlink(previousPathFor(filePath)).catch(() => {});
      }
    }
    return next;
  });
}

/** 저장 파일과 그 백업(.previous)·깨진 원본 사본(.unreadable-*)을 함께 지운다(계정 연결 해제 등). */
export function removeJsonStore(filePath) {
  return withJsonFileLock(filePath, async () => {
    let removed = false;
    const unreadablePrefix = `${path.basename(filePath)}.unreadable-`;
    const siblings = await readdir(path.dirname(filePath)).catch(() => []);
    const targets = [
      filePath,
      previousPathFor(filePath),
      ...siblings.filter((name) => name.startsWith(unreadablePrefix)).map((name) => path.join(path.dirname(filePath), name)),
    ];
    for (const target of targets) {
      try {
        await unlink(target);
        if (target === filePath) removed = true;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    return removed;
  });
}
