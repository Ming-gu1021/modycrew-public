import { ModyAuditLog } from "./audit-log.js";
import type {
  ModyDesktopBridgeCommand,
  ModyDesktopBridgeDispatchResult,
} from "./desktop-bridge-runtime.js";
import type {
  ISODateTimeString,
  ModyAuditEntry,
} from "./types.js";

export type ModyDesktopBridgeQueueStatus =
  | "pending"
  | "sent"
  | "completed"
  | "failed"
  | "expired";

export type ModyDesktopBridgeEnqueueStatus =
  | "queued"
  | "duplicate"
  | "rejected"
  | "expired";

export type ModyDesktopBridgeQueueEntry = {
  queueId: string;
  bridgeId: string;
  command: ModyDesktopBridgeCommand;
  status: ModyDesktopBridgeQueueStatus;
  attempts: number;
  createdAt: ISODateTimeString;
  expiresAt: ISODateTimeString;
  sentAt?: ISODateTimeString;
  completedAt?: ISODateTimeString;
  failedAt?: ISODateTimeString;
  failureReason?: string;
};

export type ModyDesktopBridgeEnqueueOptions = {
  createdAt?: ISODateTimeString;
  expiresAt?: ISODateTimeString;
};

export type ModyDesktopBridgeEnqueueResult = {
  status: ModyDesktopBridgeEnqueueStatus;
  entry?: ModyDesktopBridgeQueueEntry;
  auditEntries: ModyAuditEntry[];
  userMessage: string;
};

export class ModyDesktopBridgeCommandQueue {
  readonly #entries = new Map<string, ModyDesktopBridgeQueueEntry>();
  readonly #auditLog: ModyAuditLog;
  readonly #now: () => Date;
  readonly #defaultTtlMs: number;

  constructor(options: {
    auditLog?: ModyAuditLog;
    now?: () => Date;
    defaultTtlMs?: number;
  } = {}) {
    this.#auditLog = options.auditLog ?? (options.now ? new ModyAuditLog(options.now) : new ModyAuditLog());
    this.#now = options.now ?? (() => new Date());
    this.#defaultTtlMs = options.defaultTtlMs ?? 5 * 60 * 1000;
  }

  enqueue(
    dispatch: ModyDesktopBridgeDispatchResult,
    options: ModyDesktopBridgeEnqueueOptions = {},
  ): ModyDesktopBridgeEnqueueResult {
    const createdAt = options.createdAt ?? this.#now().toISOString();
    const expiresAt = options.expiresAt ?? new Date(new Date(createdAt).getTime() + this.#defaultTtlMs).toISOString();
    const auditEntries: ModyAuditEntry[] = [];

    if (dispatch.status !== "queued" || !dispatch.command) {
      auditEntries.push(this.#auditLog.record({
        requestId: dispatch.request.id,
        actor: "system",
        eventType: "tool_blocked",
        message: "데스크톱 브리지 명령을 대기열에 넣지 않았습니다.",
        createdAt,
        operationKind: dispatch.request.operationKind,
        riskLabel: dispatch.request.riskLabel,
        metadata: {
          dispatchStatus: dispatch.status,
          bridgeId: dispatch.bridge.bridgeId,
        },
      }));

      return {
        status: "rejected",
        auditEntries,
        userMessage: dispatch.userMessage,
      };
    }

    if (isExpired(expiresAt, this.#now())) {
      auditEntries.push(this.#auditLog.record({
        requestId: dispatch.request.id,
        actor: "system",
        eventType: "tool_blocked",
        message: "만료된 데스크톱 브리지 명령은 대기열에 넣지 않습니다.",
        createdAt,
        operationKind: dispatch.request.operationKind,
        riskLabel: dispatch.request.riskLabel,
        metadata: {
          bridgeCommandId: dispatch.command.id,
          bridgeId: dispatch.bridge.bridgeId,
          expiresAt,
        },
      }));

      return {
        status: "expired",
        auditEntries,
        userMessage: "만료된 브리지 명령입니다. 다시 요청해야 합니다.",
      };
    }

    const existing = this.#entries.get(dispatch.command.id);
    if (existing && existing.status !== "failed" && existing.status !== "expired") {
      auditEntries.push(this.#auditLog.record({
        requestId: dispatch.request.id,
        actor: "system",
        eventType: "tool_requested",
        message: "중복 데스크톱 브리지 명령을 새로 만들지 않았습니다.",
        createdAt,
        operationKind: dispatch.request.operationKind,
        riskLabel: dispatch.request.riskLabel,
        metadata: {
          bridgeCommandId: dispatch.command.id,
          existingQueueId: existing.queueId,
          status: existing.status,
        },
      }));

      return {
        status: "duplicate",
        entry: existing,
        auditEntries,
        userMessage: "이미 대기 중인 브리지 명령입니다.",
      };
    }

    const entry: ModyDesktopBridgeQueueEntry = {
      queueId: `bridge_queue_${this.#entries.size + 1}`,
      bridgeId: dispatch.bridge.bridgeId,
      command: dispatch.command,
      status: "pending",
      attempts: 0,
      createdAt,
      expiresAt,
    };

    this.#entries.set(dispatch.command.id, entry);
    auditEntries.push(this.#auditLog.record({
      requestId: dispatch.request.id,
      actor: "system",
      eventType: "tool_requested",
      message: "데스크톱 브리지 명령을 대기열에 추가했습니다.",
      createdAt,
      operationKind: dispatch.request.operationKind,
      riskLabel: dispatch.request.riskLabel,
      metadata: {
        bridgeCommandId: dispatch.command.id,
        queueId: entry.queueId,
        bridgeId: dispatch.bridge.bridgeId,
        expiresAt,
      },
    }));

    return {
      status: "queued",
      entry,
      auditEntries,
      userMessage: "브리지 명령이 대기열에 추가되었습니다.",
    };
  }

  markSent(commandId: string, sentAt = this.#now().toISOString()): ModyDesktopBridgeQueueEntry {
    const entry = this.#requireEntry(commandId);
    if (isExpired(entry.expiresAt, new Date(sentAt))) {
      entry.status = "expired";
      return entry;
    }

    entry.status = "sent";
    entry.attempts += 1;
    entry.sentAt = sentAt;
    return entry;
  }

  markCompleted(commandId: string, completedAt = this.#now().toISOString()): ModyDesktopBridgeQueueEntry {
    const entry = this.#requireEntry(commandId);
    entry.status = "completed";
    entry.completedAt = completedAt;
    return entry;
  }

  markFailed(
    commandId: string,
    failureReason: string,
    failedAt = this.#now().toISOString(),
  ): ModyDesktopBridgeQueueEntry {
    const entry = this.#requireEntry(commandId);
    entry.status = "failed";
    entry.failedAt = failedAt;
    entry.failureReason = failureReason;
    return entry;
  }

  expirePending(now = this.#now()): ModyDesktopBridgeQueueEntry[] {
    const expiredEntries: ModyDesktopBridgeQueueEntry[] = [];

    for (const entry of this.#entries.values()) {
      if ((entry.status === "pending" || entry.status === "sent") && isExpired(entry.expiresAt, now)) {
        entry.status = "expired";
        expiredEntries.push(entry);
      }
    }

    return expiredEntries;
  }

  list(): ModyDesktopBridgeQueueEntry[] {
    return [...this.#entries.values()];
  }

  #requireEntry(commandId: string): ModyDesktopBridgeQueueEntry {
    const entry = this.#entries.get(commandId);
    if (!entry) {
      throw new Error(`등록되지 않은 브리지 명령입니다: ${commandId}`);
    }

    return entry;
  }
}

function isExpired(expiresAt: ISODateTimeString, now: Date): boolean {
  return new Date(expiresAt).getTime() <= now.getTime();
}
