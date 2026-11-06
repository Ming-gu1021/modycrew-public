import type { ISODateTimeString, ModyAuditEntry } from "./types.js";

type AuditEntryInput = Omit<ModyAuditEntry, "id" | "createdAt"> & {
  id?: string;
  createdAt?: ISODateTimeString;
};

export class ModyAuditLog {
  private readonly entries: ModyAuditEntry[] = [];
  private sequence = 0;
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  record(input: AuditEntryInput): ModyAuditEntry {
    const entry: ModyAuditEntry = {
      id: input.id ?? `audit_${++this.sequence}`,
      actor: input.actor,
      eventType: input.eventType,
      message: input.message,
      createdAt: input.createdAt ?? this.now().toISOString(),
    };

    if (input.requestId) {
      entry.requestId = input.requestId;
    }

    if (input.policyVersion) {
      entry.policyVersion = input.policyVersion;
    }

    if (input.operationKind) {
      entry.operationKind = input.operationKind;
    }

    if (input.riskLabel) {
      entry.riskLabel = input.riskLabel;
    }

    if (input.metadata) {
      entry.metadata = input.metadata;
    }

    this.entries.push(entry);
    return entry;
  }

  list(): ModyAuditEntry[] {
    return [...this.entries];
  }
}
