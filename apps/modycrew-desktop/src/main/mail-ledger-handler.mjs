import { existsSync } from "node:fs";
import path from "node:path";
import { mutateJsonStore, readJsonStore, removeJsonStore } from "./json-store.mjs";
import { classifyMailRow } from "./mail-category.mjs";

/**
 * 메일 원장 — 통합 메일함이 보여줄 "받은 메일 목록"의 저장소.
 *
 * 승인함(automation-inbox)과 왜 나누는가:
 *  - 승인함은 처리하면 사라지는 큐이고 80건 상한이 있다. 메일함은 지우지
 *    않는 목록이어야 한다.
 *  - 승인함에는 "업무가 될 메일"만 올라간다(광고·알림은 버려진다). 메일함은
 *    사용자가 받은 것을 그대로 보여줘야 한다.
 *  - 승인함 정규화기는 발신자 주소를 가린다. 메일함에서 보낸사람이 가려지면
 *    쓸모가 없다.
 *
 * 안전 경계:
 *  - 계정별 파일로 나눠 계정을 지우면 그 계정 메일만 사라진다.
 *  - 본문 원문은 저장하지 않는다. 목록에 필요한 미리보기(선필터가 허용한
 *    범위)만 담는다.
 *  - 이 원장은 사용자에게 보여주기 위한 것이며, 메일 내용이 앱의 명령이
 *    되지 않는다는 원칙은 그대로다.
 */

const ledgerDirName = "mail-ledger";
const ledgerVersion = 1;
const maxMessagesPerAccount = 500;
const maxPreviewChars = 600;

function resolveLedgerDir(options = {}) {
  if (options.mailLedgerRoot) return path.resolve(String(options.mailLedgerRoot));
  if (options.storageRoot) return path.join(path.resolve(String(options.storageRoot)), ledgerDirName);
  if (options.app?.getPath) return path.join(options.app.getPath("userData"), ledgerDirName);
  return null;
}

/** 파일명으로 쓸 수 있게 계정 식별자를 정리한다. */
function safeAccountFileName(accountId) {
  const text = String(accountId ?? "").trim().toLowerCase();
  const safe = text.replace(/[^a-z0-9._-]/g, "-").slice(0, 120);
  return safe || "unknown-account";
}

function ledgerFilePath(options, accountId) {
  const dir = resolveLedgerDir(options);
  if (!dir) return null;
  return path.join(dir, `${safeAccountFileName(accountId)}.v${ledgerVersion}.json`);
}

function cleanLine(value, limit = 200) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

/** 목록 한 줄에 필요한 것만 남긴다. 본문 원문은 담지 않는다. */
function toLedgerRow(message, accountId) {
  const messageId = cleanLine(message?.messageId, 200);
  if (!messageId) return null;
  return {
    messageId,
    accountId: cleanLine(accountId, 160),
    subject: cleanLine(message?.subject, 200) || "(제목 없음)",
    from: cleanLine(message?.from, 200),
    receivedAt: cleanLine(message?.receivedAt, 40),
    preview: cleanLine(message?.snippet ?? message?.bodyPreview ?? "", maxPreviewChars),
    ...(message?.threadId ? { threadId: cleanLine(message.threadId, 200) } : {}),
    ...(message?.rfcMessageId ? { rfcMessageId: cleanLine(message.rfcMessageId, 200) } : {}),
    ...(message?.hasAttachments === true ? { hasAttachments: true } : {}),
    ...(typeof message?.isRead === "boolean" ? { isRead: message.isRead } : {}),
    ...(Array.isArray(message?.labels) && message.labels.length
      ? { labels: message.labels.map((label) => cleanLine(label, 60)).filter(Boolean).slice(0, 12) }
      : {}),
  };
}

/**
 * 분류 결과(기본함/결제·영수증/알림/광고/소셜/스팸)와 답장·일정·결제 후보를 행에 붙인다.
 * 저장된 행에 분류가 없으면(이전 버전 원장) 저장된 제목·보낸 사람·미리보기로 다시 판단한다.
 */
function applyMailCategory(row, candidate = null) {
  const verdict = classifyMailRow(row, candidate, {
    storedScheduleCandidate: row.scheduleCandidate === true,
    storedReplyCandidate: row.replyCandidate === true,
  });
  return {
    ...row,
    category: verdict.category,
    replyCandidate: verdict.replyCandidate,
    scheduleCandidate: verdict.scheduleCandidate,
    receiptCandidate: verdict.receiptCandidate,
  };
}

function ensureMailCategory(row) {
  return row && typeof row === "object" && !row.category ? applyMailCategory(row, null) : row;
}

function parseLedgerFile(parsed) {
  return {
    accountId: cleanLine(parsed?.accountId, 160),
    messages: Array.isArray(parsed?.messages) ? parsed.messages : [],
  };
}

/**
 * 계정 원장 하나를 대기열 안에서 읽고 → 합치고 → 원자적으로 저장한다.
 * 예전엔 두 수집이 겹치면 늦게 쓴 쪽이 원장을 통째로 덮어써 151통이 1통으로 줄었다.
 * 깨진 원장은 직전 정상본(.previous)으로 이어 쓰고, 그것도 없으면 사본을 남기고 새로 시작한다.
 */
async function mutateAccountLedger(filePath, accountId, mergeMessages) {
  return mutateJsonStore(
    filePath,
    {
      parse: parseLedgerFile,
      empty: () => ({ accountId, messages: [] }),
      serialize: (state) =>
        `${JSON.stringify(
          {
            version: ledgerVersion,
            accountId,
            updatedAt: new Date().toISOString(),
            messages: state.messages.slice(0, maxMessagesPerAccount),
          },
          null,
          2,
        )}\n`,
      onUnreadable: "reset",
    },
    (state) => ({ accountId, messages: mergeMessages(state.messages) }),
  );
}

/**
 * 인테이크가 읽은 메일을 원장에 합친다.
 * 이미 있는 메일은 갱신하고, 새 메일은 앞에 붙인다(최신 우선).
 */
export async function recordMailMessages(options = {}, input = {}) {
  const messages = Array.isArray(input.messages) ? input.messages : [];
  if (!messages.length) {
    return { status: "mail_ledger_no_messages", addedCount: 0, totalCount: 0 };
  }

  const byAccount = new Map();
  // Match using account + source ID: providers can use identical message IDs.
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  for (const message of messages) {
    const accountId =
      cleanLine(message?.sourceAccountId, 160) ||
      cleanLine(input.accountId, 160) ||
      "unknown-account";
    let row = toLedgerRow(message, accountId);
    if (!row) continue;
    const candidate = candidates.find((entry) => entry.sourceId === row.messageId &&
      (entry.sourceAccountId || input.accountId) === accountId);
    // 인테이크가 만든 후보(답장 초안·일정 초안)와 메일함 분류를 함께 반영한다.
    row = applyMailCategory(row, candidate ?? null);
    if (!byAccount.has(accountId)) byAccount.set(accountId, []);
    byAccount.get(accountId).push(row);
  }

  let addedCount = 0;
  let totalCount = 0;
  const files = [];
  for (const [accountId, rows] of byAccount) {
    let merged = [];
    let accountAddedCount = 0;
    const mergeMessages = (existingMessages) => {
      const seen = new Map(existingMessages.map((row) => [row.messageId, row]));
      accountAddedCount = 0;
      for (const row of rows) {
        if (!seen.has(row.messageId)) accountAddedCount += 1;
        seen.set(row.messageId, { ...seen.get(row.messageId), ...row });
      }
      merged = [...seen.values()].sort((a, b) =>
        String(b.receivedAt ?? "").localeCompare(String(a.receivedAt ?? "")),
      );
      return merged;
    };
    const filePath = ledgerFilePath(options, accountId);
    if (filePath) {
      await mutateAccountLedger(filePath, accountId, mergeMessages);
      files.push(filePath);
    } else {
      mergeMessages([]);
    }
    addedCount += accountAddedCount;
    totalCount += Math.min(merged.length, maxMessagesPerAccount);
  }

  return {
    status: "mail_ledger_recorded",
    addedCount,
    totalCount,
    accountCount: byAccount.size,
    files,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

/** 통합 메일함이 그릴 목록. 계정을 합쳐 최신순으로 돌려준다. */
export async function listMailMessages(options = {}, input = {}) {
  const dir = resolveLedgerDir(options);
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
  const offset = Math.max(0, Math.floor(Number(input.offset) || 0));
  const accountFilter = cleanLine(input.accountId, 160);
  if (!dir || !existsSync(dir)) {
    return { status: "mail_ledger_empty", messages: [], totalCount: 0, accountIds: [] };
  }

  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir).catch(() => []);
  const accountIds = [];
  let all = [];
  for (const entry of entries) {
    if (!entry.endsWith(`.v${ledgerVersion}.json`)) continue;
    // 한 계정의 원장이 깨져도 나머지 목록은 보여준다. 깨진 원장은 직전 정상본으로 읽는다.
    const loaded = await readJsonStore(path.join(dir, entry), { parse: parseLedgerFile });
    if (loaded.status !== "ok" && loaded.status !== "recovered") continue;
    const accountId = loaded.value.accountId;
    if (!accountId) continue;
    accountIds.push(accountId);
    if (accountFilter && accountFilter !== accountId) continue;
    all = all.concat(loaded.value.messages.map(ensureMailCategory));
  }

  all.sort((a, b) => String(b.receivedAt ?? "").localeCompare(String(a.receivedAt ?? "")));
  return {
    status: all.length ? "mail_ledger_ready" : "mail_ledger_empty",
    messages: all.slice(offset, offset + limit),
    totalCount: all.length,
    accountIds: [...new Set(accountIds)],
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

/** 계정 연결을 해제하면 그 계정 원장도 함께 지운다. */
export async function removeAccountMailLedger(options = {}, accountId = "") {
  const filePath = ledgerFilePath(options, accountId);
  if (!filePath) {
    return { status: "mail_ledger_not_found", accountId };
  }
  // 백업(.previous)까지 함께 지워 해제한 계정의 메일 목록이 남지 않게 한다.
  const removed = await removeJsonStore(filePath);
  if (!removed) {
    return { status: "mail_ledger_not_found", accountId };
  }
  return { status: "mail_ledger_removed", accountId, externalMutation: false };
}
