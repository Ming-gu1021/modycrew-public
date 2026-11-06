export async function handleWorkSyncMessage(_event, payload = {}, options = {}) {
  if (payload.kind !== "run_today_check") {
    throw new Error(`unsupported work sync kind: ${String(payload.kind)}`);
  }

  return runTodayWorkSync(payload, options);
}

export async function runTodayWorkSync(payload = {}, options = {}) {
  const checkedAt = new Date().toISOString();
  const steps = [];
  let createdWorkItemsCount = 0;
  let approvalQueueCount = 0;
  let messageCount = 0;
  let relayEventCount = 0;
  let externalMutation = false;

  const pushStep = (id, label, state, detail) => {
    steps.push({
      id,
      label,
      state,
      detail: cleanOneLine(detail || "확인 결과가 없습니다."),
    });
  };

  if (typeof options.listConnectorStatuses === "function") {
    try {
      const connectorResult = await options.listConnectorStatuses();
      const connectors = Array.isArray(connectorResult?.connectors) ? connectorResult.connectors : [];
      const readyCount = connectors.filter((connector) => connector.status === "connected").length;
      pushStep(
        "connectors",
        "연결 상태",
        readyCount > 0 ? "done" : "needs",
        readyCount > 0
          ? `연결된 도구 ${readyCount}개 확인`
          : "연결된 메일/메신저/캘린더가 없어 읽기 단계는 건너뜁니다.",
      );
    } catch (error) {
      pushStep("connectors", "연결 상태", "error", errorMessage(error, "연결 상태 확인 실패"));
    }
  } else {
    pushStep("connectors", "연결 상태", "needs", "연결 상태 어댑터가 아직 준비되지 않았습니다.");
  }

  if (typeof options.pullPublicTriggerRelay === "function") {
    try {
      const relayResult = await options.pullPublicTriggerRelay({ triggeredBy: payload.triggeredBy ?? "work-sync" });
      relayEventCount = Number(relayResult?.eventsDispatched ?? relayResult?.eventsPulled ?? 0);
      externalMutation = externalMutation || relayResult?.externalMutation === true;
      pushStep(
        "relay",
        "다른 PC/외부 요청",
        relayEventCount > 0 ? "done" : "needs",
        relayResult?.userMessage ?? `릴레이 이벤트 ${relayEventCount}건 확인`,
      );
    } catch (error) {
      pushStep("relay", "다른 PC/외부 요청", "error", errorMessage(error, "릴레이 확인 실패"));
    }
  } else {
    pushStep("relay", "다른 PC/외부 요청", "needs", "다른 PC 요청 릴레이가 아직 준비되지 않았습니다.");
  }

  if (typeof options.runTriggerDueChecks === "function") {
    try {
      const triggerResult = await options.runTriggerDueChecks({
        triggeredBy: payload.triggeredBy ?? "work-sync",
        suppressExternalNotifications: payload.suppressExternalNotifications !== false,
      });
      createdWorkItemsCount += Number(triggerResult?.createdWorkItemsCount ?? triggerResult?.report?.queuedWorkItemsCount ?? 0);
      approvalQueueCount += Number(triggerResult?.approvalQueueCount ?? 0);
      externalMutation = externalMutation || triggerResult?.externalMutation === true;
      pushStep(
        "triggers",
        "일정/자동화",
        "done",
        triggerResult?.userMessage ??
          `자동화 확인 완료: 업무 ${triggerResult?.createdWorkItemsCount ?? 0}건, 승인 ${triggerResult?.approvalQueueCount ?? 0}건`,
      );
    } catch (error) {
      pushStep("triggers", "일정/자동화", "error", errorMessage(error, "일정/자동화 확인 실패"));
    }
  } else {
    pushStep("triggers", "일정/자동화", "needs", "일정/자동화 점검 어댑터가 아직 준비되지 않았습니다.");
  }

  if (typeof options.runMailWorkIntake === "function") {
    try {
      const mailResult = await options.runMailWorkIntake({
        limit: Number.isFinite(Number(payload.limit)) ? Number(payload.limit) : 10,
      });
      messageCount = Number(mailResult?.messageCount ?? 0);
      createdWorkItemsCount += Number(mailResult?.createdWorkItemsCount ?? mailResult?.addedInboxItemsCount ?? 0);
      approvalQueueCount += Number(mailResult?.approvalQueueCount ?? 0);
      externalMutation = externalMutation || mailResult?.externalMutation === true;
      pushStep(
        "mail",
        "메일 업무",
        mailResult?.status === "mail_connector_missing" || mailResult?.status === "needs_credentials"
          ? "needs"
          : "done",
        mailResult?.userMessage ??
          `메일 ${messageCount}건 확인, 승인 후보 ${mailResult?.approvalQueueCount ?? 0}건 준비`,
      );
    } catch (error) {
      pushStep("mail", "메일 업무", "error", errorMessage(error, "메일 업무 확인 실패"));
    }
  } else {
    pushStep("mail", "메일 업무", "needs", "메일 점검 어댑터가 아직 준비되지 않았습니다.");
  }

  const inbox = typeof options.getInboxSnapshot === "function" ? options.getInboxSnapshot() : [];
  const metrics = createHeaderMetrics(inbox, checkedAt);
  const hasError = steps.some((step) => step.state === "error");
  const result = {
    status: hasError ? "work_sync_partial_failure" : "work_sync_completed",
    checkedAt,
    createdWorkItemsCount,
    approvalQueueCount,
    inboxCount: inbox.length,
    messageCount,
    relayEventCount,
    steps,
    metrics,
    userMessage: hasError
      ? "일부 업무 확인이 실패했습니다. 단계별 상태를 확인해 주세요."
      : `오늘 업무 확인 완료: 인박스 ${inbox.length}건, 승인 ${metrics.pendingApproval}건`,
    externalMutation,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };

  if (typeof options.recordActivity === "function") {
    try {
      await options.recordActivity(createWorkSyncActivityEvent(result, payload));
    } catch {
      // Activity persistence must never block the actual work-sync result.
    }
  }

  return result;
}

function createWorkSyncActivityEvent(result, payload = {}) {
  const triggeredBy = cleanOneLine(payload.triggeredBy || "manual");
  const evidence = [
    `inbox:${result.inboxCount}`,
    `approval:${result.approvalQueueCount}`,
    `mail:${result.messageCount}`,
    `relay:${result.relayEventCount}`,
  ].join(" ");
  return {
    id: `work-sync-${result.checkedAt.replace(/[^0-9A-Za-z]/g, "")}-${triggeredBy}`,
    workItemId: "work-sync-today",
    label: triggeredBy === "tray" ? "트레이 업무 점검" : "오늘 업무 한번에 확인",
    detail: result.userMessage,
    status: result.status === "work_sync_completed" ? "done" : "error",
    createdAt: result.checkedAt,
    evidence,
    kind: "work_sync",
    sourceLabel: triggeredBy === "tray" ? "트레이 업무 점검" : "오늘 업무 점검",
    metrics: {
      inboxCount: result.inboxCount,
      createdWorkItemsCount: result.createdWorkItemsCount,
      approvalQueueCount: result.approvalQueueCount,
      messageCount: result.messageCount,
      relayEventCount: result.relayEventCount,
      stepCount: result.steps.length,
      readOnly: result.externalMutation !== true,
    },
    auditTrail: result.steps.map((step) => `${step.label}: ${step.detail}`).slice(0, 6),
  };
}

function createHeaderMetrics(items, checkedAt) {
  const list = Array.isArray(items) ? items : [];
  return {
    newToday: list.length,
    pendingApproval: list.filter((item) =>
      ["approval_pending", "draft_ready", "needs_review"].includes(item?.status),
    ).length,
    riskFlagged: list.filter((item) => item?.riskLabel === "high" || item?.riskLabel === "blocked").length,
    lastSyncedAt: checkedAt,
  };
}

function errorMessage(error, fallback) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function cleanOneLine(value) {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b(?:\+?82[-.\s]?)?0?1[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/g, "[redacted-phone]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\b(?:sk|pk|rk)-(?:ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 360);
}
