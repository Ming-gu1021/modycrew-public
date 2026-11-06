import { ModyApprovalGate } from "./approval-gate.js";
import { createToolActionRequest } from "./policy.js";
import type {
  AgentPlan,
  AgentPlanStep,
  AgentPlanStepPhase,
  AgentWorkRequest,
  ToolActionRequest,
  ToolOperationKind,
} from "./types.js";

type AgentRuntimeOptions = {
  now?: () => Date;
};

export class ModyAgentRuntime {
  private readonly approvalGate: ModyApprovalGate;
  private readonly now: () => Date;

  constructor(options: AgentRuntimeOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.approvalGate = new ModyApprovalGate({ now: this.now });
  }

  plan(workRequest: AgentWorkRequest): AgentPlan {
    const createdAt = workRequest.createdAt ?? this.now().toISOString();
    const actions = this.createDefaultActions(workRequest, createdAt);
    const sequencedActions = this.withApprovalStages(workRequest, actions, createdAt);
    const steps = sequencedActions.map((action, index) => this.createStep(action, index));
    const approvalQueue = steps
      .filter((step) => step.gate.status === "approval_required")
      .map((step) => step.action);
    const blockedActions = steps
      .filter((step) => step.gate.status === "blocked")
      .map((step) => step.action);

    const plan: AgentPlan = {
      id: `plan_${workRequest.id}`,
      requestId: workRequest.id,
      title: workRequest.title,
      steps,
      approvalQueue,
      blockedActions,
      requiresApproval: steps.some((step) => step.gate.requiresApproval),
      blocked: blockedActions.length > 0,
      createdAt,
    };
    // 담당자는 계획을 넘어 실행까지 따라가야 한다. 여기서 끊기면 누가 하는 일인지 사라진다.
    if (workRequest.assignee) plan.assignee = workRequest.assignee;
    return plan;
  }

  private withApprovalStages(
    workRequest: AgentWorkRequest,
    actions: ToolActionRequest[],
    createdAt: string,
  ): ToolActionRequest[] {
    const sequencedActions: ToolActionRequest[] = [];

    for (const action of actions) {
      const gate = this.approvalGate.evaluate(action);
      if (action.permissionLevel === "execute" && gate.status === "approval_required") {
        sequencedActions.push(this.createApprovalStageAction(workRequest, action, createdAt));
      }

      sequencedActions.push(action);
    }

    return sequencedActions;
  }

  private createApprovalStageAction(
    workRequest: AgentWorkRequest,
    targetAction: ToolActionRequest,
    createdAt: string,
  ): ToolActionRequest {
    return createToolActionRequest({
      id: `${targetAction.id}:stage-approval`,
      toolName: "mody.approval.stage",
      permissionLevel: "stage",
      operationKind: "stage_approval",
      inputSummary: `요청 ${workRequest.id}: ${targetAction.inputSummary}`,
      expectedImpact: `${targetAction.toolName} 실행 요청을 승인함에 등록하고 외부 시스템은 변경하지 않습니다.`,
      userVisibleDescription: approvalStageDescriptionFor(targetAction),
      createdAt,
      sourceAdapterId: targetAction.toolName,
      approvalTargetActionId: targetAction.id,
      requiresApproval: false,
      externalMutation: false,
      riskLabel: "medium",
    });
  }

  private createDefaultActions(workRequest: AgentWorkRequest, createdAt: string): ToolActionRequest[] {
    const body = workRequest.body;
    const actions: ToolActionRequest[] = [
      createToolActionRequest({
        id: `${workRequest.id}:read`,
        toolName: "mody.request.read",
        permissionLevel: "read",
        operationKind: "read_data",
        inputSummary: summarizeBody(body),
        expectedImpact: "업무 원문을 읽고 다음 처리에 필요한 근거를 확인합니다.",
        userVisibleDescription: "업무 원문을 읽습니다.",
        createdAt,
      }),
      createToolActionRequest({
        id: `${workRequest.id}:analyze`,
        toolName: "mody.request.analyze",
        permissionLevel: "analyze",
        operationKind: "analyze_data",
        inputSummary: summarizeBody(body),
        expectedImpact: "요청 유형, 긴급도, 위험 신호를 정리합니다.",
        userVisibleDescription: "AI 팀원이 업무 내용을 정리합니다.",
        createdAt,
      }),
      createToolActionRequest({
        id: `${workRequest.id}:draft-reply`,
        toolName: "mody.reply.draft",
        permissionLevel: "draft",
        operationKind: "draft_reply",
        inputSummary: summarizeBody(body),
        expectedImpact: "외부로 나가지 않는 답장 초안을 만듭니다.",
        userVisibleDescription: "답장 초안을 작성합니다.",
        createdAt,
      }),
    ];

    if (looksLikeCalendarRequest(body)) {
      actions.push(
        createToolActionRequest({
          id: `${workRequest.id}:draft-calendar`,
          toolName: "mody.calendar.draft",
          permissionLevel: "draft",
          operationKind: "draft_calendar_event",
          inputSummary: summarizeBody(body),
          expectedImpact: "일정 등록 전 확인할 후보 시간과 질문을 만듭니다.",
          userVisibleDescription: "일정 후보를 초안으로 정리합니다.",
          createdAt,
        }),
      );
    }

    if (looksLikeExternalSendRequest(body)) {
      actions.push(
        createToolActionRequest({
          id: `${workRequest.id}:send-email`,
          toolName: "mody.email.send",
          permissionLevel: "execute",
          operationKind: "send_email",
          inputSummary: summarizeBody(body),
          expectedImpact: "고객 또는 외부 상대에게 메일이 발송됩니다.",
          userVisibleDescription: "메일 발송은 승인함에서 사용자 확인 후에만 실행합니다.",
          createdAt,
          externalMutation: true,
          requiresApproval: true,
        }),
      );
    }

    if (looksLikeCalendarMutationRequest(body)) {
      actions.push(
        createToolActionRequest({
          id: `${workRequest.id}:create-calendar`,
          toolName: "mody.calendar.create",
          permissionLevel: "execute",
          operationKind: "create_calendar_event",
          inputSummary: summarizeBody(body),
          expectedImpact: "외부 캘린더에 일정이 등록됩니다.",
          userVisibleDescription: "일정 등록은 승인함에서 사용자 확인 후에만 실행합니다.",
          createdAt,
          externalMutation: true,
          requiresApproval: true,
        }),
      );
    }

    if (looksLikeFileShareRequest(body)) {
      actions.push(
        createToolActionRequest({
          id: `${workRequest.id}:share-file`,
          toolName: "mody.file.share",
          permissionLevel: "execute",
          operationKind: "share_file",
          inputSummary: summarizeBody(body),
          expectedImpact: "외부 사용자가 파일에 접근할 수 있는 공유 상태가 됩니다.",
          userVisibleDescription: "파일 공유는 사용자 승인 전까지 실행하지 않습니다.",
          createdAt,
          externalMutation: true,
          requiresApproval: true,
        }),
      );
    }

    if (looksLikeHighRiskExecution(body)) {
      const operationKind = highRiskOperationKindFor(body);
      actions.push(
        createToolActionRequest({
          id: `${workRequest.id}:dangerous-review`,
          toolName: "mody.risk.high-review",
          permissionLevel: "dangerous_execute",
          operationKind,
          inputSummary: summarizeBody(body),
          expectedImpact: "세무, 계약, 공공기관, 금전 관련 실행은 법적 책임을 만들 수 있습니다.",
          userVisibleDescription: "고위험 업무는 MVP에서 자동 실행하지 않습니다.",
          createdAt,
          externalMutation: true,
          requiresApproval: true,
          riskLabel: "high",
        }),
      );
    }

    return actions;
  }

  private createStep(action: ToolActionRequest, index: number): AgentPlanStep {
    const gate = this.approvalGate.evaluate(action);

    return {
      id: `step_${index + 1}`,
      label: action.userVisibleDescription,
      phase: phaseForAction(action, gate.status),
      action,
      gate,
      canRunNow: gate.canRunTool && !gate.canMutateExternalSystem,
      userMessage: gate.userMessage,
    };
  }
}

function summarizeBody(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 180);
}

function looksLikeExternalSendRequest(body: string): boolean {
  return /발송|보내|전송|답장\s*해|메일\s*보내|고객에게/i.test(body);
}

function looksLikeCalendarRequest(body: string): boolean {
  return /일정|예약|미팅|회의|방문|시간|날짜|캘린더/i.test(body);
}

function looksLikeCalendarMutationRequest(body: string): boolean {
  return /(일정|예약|미팅|회의|방문).*(등록|생성|잡아|확정|추가)|캘린더.*(등록|생성|추가)/i.test(body);
}

function looksLikeFileShareRequest(body: string): boolean {
  return /파일.*(공유|링크|전달)|공유\s*링크|자료.*전달/i.test(body);
}

function looksLikeHighRiskExecution(body: string): boolean {
  return /세무|신고|계약|공공기관|환불|금전|계좌|주민등록|법적|제출/i.test(body);
}

function highRiskOperationKindFor(body: string): ToolOperationKind {
  if (/공공기관|국세청|관공서|제출/i.test(body)) return "submit_public_agency";
  if (/환불|금전|계좌|송금|입금|결제/i.test(body)) return "process_payment_or_refund";
  if (/주민등록|민감정보|개인정보|외국인등록/i.test(body)) return "send_sensitive_personal_data";
  return "tax_or_contract_execution";
}

function approvalStageDescriptionFor(action: ToolActionRequest): string {
  if (action.operationKind === "send_email") {
    return "메일 발송 승인 대기 카드를 만듭니다.";
  }

  if (action.operationKind === "create_calendar_event") {
    return "일정 등록 승인 대기 카드를 만듭니다.";
  }

  if (action.operationKind === "share_file") {
    return "파일 공유 승인 대기 카드를 만듭니다.";
  }

  return "외부 실행 승인 대기 카드를 만듭니다.";
}

function phaseForAction(
  action: ToolActionRequest,
  gateStatus: AgentPlanStep["gate"]["status"],
): AgentPlanStepPhase {
  if (gateStatus === "blocked") return "blocked";
  if (action.operationKind === "stage_approval") return "stage_approval";
  if (action.permissionLevel === "read") return "read";
  if (action.permissionLevel === "analyze") return "analyze";
  if (action.permissionLevel === "draft") return "draft";
  return "execute_after_approval";
}
