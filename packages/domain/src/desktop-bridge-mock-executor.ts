import { ModyAuditLog } from "./audit-log.js";
import type { ModyDesktopCapability } from "./desktop-bridge.js";
import { modyDesktopCapabilities } from "./desktop-bridge.js";
import type {
  ModyDesktopBridgeCommand,
} from "./desktop-bridge-runtime.js";
import type {
  ModyDesktopBridgeCommandQueue,
  ModyDesktopBridgeQueueEntry,
} from "./desktop-bridge-queue.js";
import type {
  ISODateTimeString,
  ModyAuditEntry,
} from "./types.js";

export type ModyDesktopBridgeMockExecutionStatus =
  | "simulated_completed"
  | "blocked_external_mutation_without_presence"
  | "expired"
  | "not_ready"
  | "target_missing"
  | "unsupported_command"
  | "simulated_failed";

export type ModyDesktopBridgeMockExecutionSideEffect = "simulated_only";

export type ModyDesktopBridgeMockExecutorOptions = {
  queue?: ModyDesktopBridgeCommandQueue;
  auditLog?: ModyAuditLog;
  now?: () => Date;
  supportedCommands?: readonly ModyDesktopCapability[];
};

export type ModyDesktopBridgeMockExecuteOptions = {
  finalUserPresence?: boolean;
  simulateFailure?: boolean;
  failureReason?: string;
  now?: ISODateTimeString;
};

export type ModyDesktopBridgeMockExecutionResult = {
  status: ModyDesktopBridgeMockExecutionStatus;
  entry: ModyDesktopBridgeQueueEntry;
  command: ModyDesktopBridgeCommand;
  sideEffect: ModyDesktopBridgeMockExecutionSideEffect;
  auditEntries: ModyAuditEntry[];
  simulatedPayload?: Record<string, unknown>;
  userMessage: string;
};

const commandsRequiringPath = new Set<ModyDesktopCapability>([
  "open_local_file",
  "read_local_file",
  "watch_folder",
  "write_local_file",
]);

const commandsRequiringUrl = new Set<ModyDesktopCapability>([
  "open_url",
  "browser_automation",
]);

const commandsRequiringAnyTarget = new Set<ModyDesktopCapability>([
  "click",
  "type_text",
  "send_hotkey",
]);

export class ModyDesktopBridgeMockExecutor {
  readonly #queue: ModyDesktopBridgeCommandQueue | undefined;
  readonly #auditLog: ModyAuditLog;
  readonly #now: () => Date;
  readonly #supportedCommands: readonly ModyDesktopCapability[];

  constructor(options: ModyDesktopBridgeMockExecutorOptions = {}) {
    this.#queue = options.queue;
    this.#auditLog = options.auditLog ?? (options.now ? new ModyAuditLog(options.now) : new ModyAuditLog());
    this.#now = options.now ?? (() => new Date());
    this.#supportedCommands = options.supportedCommands ?? modyDesktopCapabilities;
  }

  execute(
    entry: ModyDesktopBridgeQueueEntry,
    options: ModyDesktopBridgeMockExecuteOptions = {},
  ): ModyDesktopBridgeMockExecutionResult {
    const now = options.now ?? this.#now().toISOString();
    const command = entry.command;

    if (isExpired(entry.expiresAt, new Date(now))) {
      this.#queue?.expirePending(new Date(now));
      entry.status = "expired";
      return this.#blockedResult("expired", entry, "만료된 데스크톱 브리지 명령은 mock 실행하지 않습니다.", now);
    }

    if (entry.status !== "pending" && entry.status !== "sent") {
      return this.#blockedResult("not_ready", entry, "대기 또는 전송 상태가 아닌 명령은 mock 실행하지 않습니다.", now);
    }

    if (!this.#supportedCommands.includes(command.command)) {
      this.#markFailed(entry, "지원하지 않는 데스크톱 브리지 명령입니다.", now);
      return this.#blockedResult("unsupported_command", entry, "지원하지 않는 데스크톱 브리지 명령입니다.", now);
    }

    if (!hasRequiredTarget(command)) {
      this.#markFailed(entry, "데스크톱 브리지 명령 target이 부족합니다.", now);
      return this.#blockedResult("target_missing", entry, "데스크톱 브리지 명령 target이 부족합니다.", now);
    }

    if (command.externalMutation && options.finalUserPresence !== true) {
      this.#markFailed(entry, "외부 변경성 OS 조작은 최종 사용자 확인 없이는 mock 실행도 하지 않습니다.", now);
      return this.#blockedResult(
        "blocked_external_mutation_without_presence",
        entry,
        "클릭, 입력, 브라우저 자동화 같은 외부 변경성 OS 조작은 최종 사용자 확인이 필요합니다.",
        now,
      );
    }

    this.#markSent(entry, now);

    if (options.simulateFailure) {
      const failureReason = options.failureReason ?? "mock desktop bridge failure";
      this.#markFailed(entry, failureReason, now);
      return {
        status: "simulated_failed",
        entry,
        command,
        sideEffect: "simulated_only",
        auditEntries: [
          this.#recordAudit(entry, "tool_failed", `데스크톱 브리지 mock 실행이 실패했습니다: ${failureReason}`, now),
        ],
        userMessage: "데스크톱 브리지 mock 실행이 실패했습니다.",
      };
    }

    this.#markCompleted(entry, now);
    return {
      status: "simulated_completed",
      entry,
      command,
      sideEffect: "simulated_only",
      auditEntries: [
        this.#recordAudit(entry, "tool_completed", "데스크톱 브리지 명령을 simulated_only 모드로 완료했습니다.", now),
      ],
      simulatedPayload: buildSimulatedPayload(command),
      userMessage: "데스크톱 브리지 명령을 실제 OS 변경 없이 mock 실행했습니다.",
    };
  }

  #markSent(entry: ModyDesktopBridgeQueueEntry, at: ISODateTimeString): void {
    if (this.#queue) {
      this.#queue.markSent(entry.command.id, at);
      return;
    }

    entry.status = "sent";
    entry.attempts += 1;
    entry.sentAt = at;
  }

  #markCompleted(entry: ModyDesktopBridgeQueueEntry, at: ISODateTimeString): void {
    if (this.#queue) {
      this.#queue.markCompleted(entry.command.id, at);
      return;
    }

    entry.status = "completed";
    entry.completedAt = at;
  }

  #markFailed(entry: ModyDesktopBridgeQueueEntry, reason: string, at: ISODateTimeString): void {
    if (this.#queue) {
      this.#queue.markFailed(entry.command.id, reason, at);
      return;
    }

    entry.status = "failed";
    entry.failedAt = at;
    entry.failureReason = reason;
  }

  #blockedResult(
    status: Exclude<ModyDesktopBridgeMockExecutionStatus, "simulated_completed" | "simulated_failed">,
    entry: ModyDesktopBridgeQueueEntry,
    userMessage: string,
    at: ISODateTimeString,
  ): ModyDesktopBridgeMockExecutionResult {
    return {
      status,
      entry,
      command: entry.command,
      sideEffect: "simulated_only",
      auditEntries: [
        this.#recordAudit(entry, "tool_blocked", userMessage, at),
      ],
      userMessage,
    };
  }

  #recordAudit(
    entry: ModyDesktopBridgeQueueEntry,
    eventType: "tool_blocked" | "tool_completed" | "tool_failed",
    message: string,
    createdAt: ISODateTimeString,
  ): ModyAuditEntry {
    return this.#auditLog.record({
      requestId: entry.command.requestId,
      actor: "tool",
      eventType,
      message,
      createdAt,
      operationKind: entry.command.operationKind,
      riskLabel: entry.command.externalMutation ? "high" : "medium",
      metadata: {
        bridgeCommandId: entry.command.id,
        queueId: entry.queueId,
        bridgeId: entry.bridgeId,
        command: entry.command.command,
        sideEffect: "simulated_only",
      },
    });
  }
}

function hasRequiredTarget(command: ModyDesktopBridgeCommand): boolean {
  if (commandsRequiringPath.has(command.command)) {
    return Boolean(command.target.path);
  }

  if (commandsRequiringUrl.has(command.command)) {
    return Boolean(command.target.url);
  }

  if (commandsRequiringAnyTarget.has(command.command)) {
    return Boolean(command.target.app || command.target.path || command.target.url);
  }

  return true;
}

function buildSimulatedPayload(command: ModyDesktopBridgeCommand): Record<string, unknown> {
  return {
    command: command.command,
    platform: command.platform,
    target: command.target,
    externalMutation: command.externalMutation,
    simulatedOnly: true,
  };
}

function isExpired(expiresAt: ISODateTimeString, now: Date): boolean {
  return new Date(expiresAt).getTime() <= now.getTime();
}
