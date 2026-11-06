/**
 * 배경 정리 — 창을 닫아 둔 사이에 새로 들어온 것을 AI 가 한 번 훑어 정리한다.
 *
 * 이 앱에서 모델로 가는 길은 ipcMain "mody.ai-provider.v1" 하나뿐이고, 그 핸들러는
 * event 를 읽지 않는다. 그래서 main 안에서 그대로 부를 수 있다 — 다만 **부를지 말지**를
 * 정하는 규칙이 필요하다. 배경에서 모델을 부르는 것은 사용자의 돈을 쓰는 일이다.
 *
 * 규칙은 packages/domain/src/second-brain/background-digest.ts 에 있다(순수 함수).
 * 여기서는 그 규칙에 필요한 것을 읽고 쓰고, 실제 모델을 부른다.
 *
 * 안전 경계:
 *  - 기본 꺼짐. 사용자가 켜야 시작한다.
 *  - 정리만 한다. 메일 발송·일정 등록·파일 이동은 여기서 절대 하지 않는다.
 *  - 결과는 로컬 파일에만 남는다.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveDesktopDomainEntryPath } from "./runtime-paths.mjs";

const stateFileName = "background-digest.json";
const maxDigestChars = 1_200;
const maxStoredDigests = 30;

let domainRuntimePromise;
const storeWrites = new Map();
const runningStores = new Set();

function storeKey(options) {
  const key = path.resolve(statePath(options));
  return process.platform === "win32" ? key.toLowerCase() : key;
}

// 설정 변경과 실행 선점/완료 저장을 직렬화한다. 모델을 기다리는 동안에는 잠그지
// 않으므로 사용자가 언제든 배경 정리를 끌 수 있다.
async function withStoreWrite(options, action) {
  const key = storeKey(options);
  const previous = storeWrites.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(action);
  storeWrites.set(key, pending);
  try {
    return await pending;
  } finally {
    if (storeWrites.get(key) === pending) storeWrites.delete(key);
  }
}

async function loadDomainRuntime(options = {}) {
  if (options.domainRuntime) return options.domainRuntime;
  if (!domainRuntimePromise) {
    const entry =
      options.domainEntryPath ?? resolveDesktopDomainEntryPath({ repoRoot: options.repoRoot });
    domainRuntimePromise = import(pathToFileURL(entry).href);
  }
  try {
    return await domainRuntimePromise;
  } catch (error) {
    domainRuntimePromise = undefined;
    throw error;
  }
}

function statePath(options) {
  if (!options.app?.getPath) throw new Error("앱 데이터 폴더를 찾지 못했습니다.");
  return path.join(options.app.getPath("userData"), stateFileName);
}

function nowIso(options) {
  const value = typeof options.now === "function" ? options.now() : new Date();
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

async function readJson(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** 임시 파일 + 교체 + 직전 사본. 찢어진 파일 때문에 진행 지점을 잃지 않는다. */
async function writeStore(options, store) {
  const filePath = statePath(options);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  if (existsSync(filePath)) {
    try {
      await copyFile(filePath, `${filePath}.previous`);
    } catch {
      // 사본을 못 남겨도 교체 자체는 진행한다.
    }
  }
  await rename(tempPath, filePath);
}

async function readStore(options, runtime) {
  const filePath = statePath(options);
  const parsed = (await readJson(filePath)) ?? (await readJson(`${filePath}.previous`));
  return {
    version: 1,
    settings: { ...runtime.modyBackgroundDigestDefaults, ...(parsed?.settings ?? {}) },
    state: { ...runtime.modyBackgroundDigestInitialState, ...(parsed?.state ?? {}) },
    digests: Array.isArray(parsed?.digests) ? parsed.digests.slice(0, maxStoredDigests) : [],
  };
}

function publicStatus(store, extra = {}) {
  return {
    status: "background_digest_status_loaded",
    enabled: store.settings.enabled === true,
    maxRunsPerDay: store.settings.maxRunsPerDay,
    minIntervalMinutes: store.settings.minIntervalMinutes,
    runsToday: store.state.runsOnDayKey,
    consecutiveFailures: store.state.consecutiveFailures,
    lastRunAt: store.state.lastRunAt,
    digests: store.digests.slice(0, 10),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    ...extra,
  };
}

export async function handleBackgroundDigestMessage(_event, payload = {}, options = {}) {
  const kind = String(payload.kind ?? "");
  const runtime = await loadDomainRuntime(options);
  if (kind === "status") return publicStatus(await readStore(options, runtime));
  if (kind === "set_enabled") return withStoreWrite(options, () => setEnabled(payload, options, runtime));
  if (kind === "run_if_due") return runIfDue(payload, options, runtime);
  return {
    status: "background_digest_unknown_kind",
    userMessage: "알 수 없는 배경 정리 요청입니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

/** 켤 때는 실패 카운터를 지운다 — 사용자가 연결을 고치고 다시 켰다는 뜻이다. */
async function setEnabled(payload, options, runtime) {
  const store = await readStore(options, runtime);
  const enabled = payload.enabled === true;
  store.settings = { ...store.settings, enabled };
  if (enabled) {
    store.state = { ...store.state, consecutiveFailures: 0, nextEligibleAt: "" };
  }
  await writeStore(options, store);
  return publicStatus(store, {
    userMessage: enabled
      ? "창을 닫아도 새로 들어온 것을 훑어 정리합니다. 정리만 하고, 보내거나 등록하지는 않습니다."
      : "배경 정리를 껐습니다. 창이 열려 있을 때만 AI 가 일합니다.",
  });
}

/**
 * 지금 정리할 때인지 도메인 규칙에 묻고, 맞으면 모델을 한 번 부른다.
 *
 * 순서가 중요하다: **돌리기로 정하면 상태를 먼저 저장하고** 모델을 부른다.
 * 도중에 앱이 죽어도 같은 재료로 두 번 돌지 않게 하려는 것이다.
 */
async function runIfDue(payload, options, runtime) {
  const key = storeKey(options);
  const material = {
    newWorkItemCount: Number(payload.material?.newWorkItemCount ?? 0),
    pendingApprovalCount: Number(payload.material?.pendingApprovalCount ?? 0),
    newLearnedDocumentCount: Number(payload.material?.newLearnedDocumentCount ?? 0),
    fingerprint: String(payload.material?.fingerprint ?? ""),
  };
  const skipped = await withStoreWrite(options, async () => {
    const store = await readStore(options, runtime);
    if (runningStores.has(key)) {
      return publicStatus(store, {
        status: "background_digest_skipped",
        skipReason: "too_soon",
        userMessage: "이미 정리 중입니다. 끝난 뒤에 다시 확인합니다.",
      });
    }
    const decision = runtime.decideBackgroundDigest({
      settings: store.settings,
      state: store.state,
      material,
      nowIso: nowIso(options),
    });
    if (!decision.run) {
      return publicStatus(store, {
        status: "background_digest_skipped",
        skipReason: decision.reason,
        userMessage: decision.koreanReason,
      });
    }
    store.state = runtime.claimBackgroundDigest(store.state, decision);
    await writeStore(options, store);
    runningStores.add(key);
    return null;
  });
  if (skipped) return skipped;

  try {
    return await finishRun(payload, material, options, runtime);
  } finally {
    runningStores.delete(key);
  }
}

async function finishRun(payload, material, options, runtime) {
  let digestText = "";
  let failed = false;
  try {
    const generated = await options.generateText?.({
      kind: "generate_text",
      prompt: buildDigestPrompt(payload, material),
    });
    digestText = String(generated?.outputText ?? "")
      .trim()
      .slice(0, maxDigestChars);
    failed = !digestText;
  } catch {
    failed = true;
  }

  return withStoreWrite(options, async () => {
    // 모델 실행 중 바뀐 사용자 설정을 보존한다.
    const store = await readStore(options, runtime);
    const finishedAt = nowIso(options);
    store.state = runtime.recordBackgroundDigestOutcome({
      state: store.state,
      settings: store.settings,
      outcome: failed ? "failed" : "done",
      material,
      nowIso: finishedAt,
    });
    if (!failed) {
      store.digests = [
        {
          id: `digest-${finishedAt}`,
          createdAt: finishedAt,
          text: digestText,
          newWorkItemCount: material.newWorkItemCount,
          pendingApprovalCount: material.pendingApprovalCount,
        },
        ...store.digests,
      ].slice(0, maxStoredDigests);
    }
    await writeStore(options, store);

    return publicStatus(store, {
      status: failed ? "background_digest_failed" : "background_digest_written",
      digestText,
      userMessage: failed
        ? "배경 정리를 못 했습니다. 잠시 뒤에 다시 확인합니다."
        : "새로 들어온 것을 정리해 두었습니다.",
    });
  });
}

/**
 * 정리 프롬프트. 사용자의 메일 본문을 여기 담지 않는다 — 제목과 개수만 넘긴다.
 * 배경에서 도는 호출이라 사람이 결과를 즉시 보지 못하므로, 짧고 확인 가능한 것만 시킨다.
 */
function buildDigestPrompt(payload, material) {
  const titles = Array.isArray(payload.itemTitles)
    ? payload.itemTitles.slice(0, 12).map((title) => `- ${String(title).slice(0, 120)}`)
    : [];
  const lines = [
    "당신은 한국의 소규모 사무실에서 일하는 업무 비서입니다.",
    "사용자가 자리를 비운 사이에 새로 들어온 일을 정리해 두려고 합니다.",
    "",
    `새 업무 카드 ${material.newWorkItemCount}건, 결정을 기다리는 것 ${material.pendingApprovalCount}건, 새로 읽은 자료 ${material.newLearnedDocumentCount}건.`,
  ];
  if (titles.length > 0) {
    lines.push("제목:", ...titles);
  }
  lines.push(
    "",
    "아래 형식으로 한국어 세 줄만 쓰세요. 각 줄은 한 문장입니다.",
    "1) 무슨 일이 있었는지",
    "2) 사용자가 알아야 할 것 (없으면 특별히 알아야 할 것은 없다고 쓰세요)",
    "3) 사용자가 결정해 줘야 할 것 (없으면 결정할 것은 없다고 쓰세요)",
    "",
    "추측해서 사실을 만들지 마세요. 위에 준 것 말고는 아는 것이 없습니다.",
    "메일을 보내거나 일정을 등록하지 마세요. 당신은 지금 정리만 합니다.",
  );
  return lines.join("\n");
}
