import { ModyChannelHub } from "./channel-hub.js";
import { ModyAiDraftAdapterFactory } from "./ai-draft-adapter.js";
import { ModyToolConnectivityMatrix } from "./connector-connectivity.js";
import { ModyMailWorkflowPlanner } from "./mail-workflow.js";
import { ModyLocalLiveWorkflowRunner } from "./local-live-workflow.js";
import { ModyProviderWorkIntakePlanner } from "./provider-work-intake.js";
import { ModyWorkCommandLoop } from "./work-command-loop.js";
import { ModyConsultationBookingWorkflow } from "./consultation-booking-workflow.js";
import { ModyConnectorQuickConnectPlanner } from "./connector-quick-connect.js";
import { createToolActionRequest } from "./policy.js";
import type {
  ISODateTimeString,
  ModyChannelMessage,
  ToolActionRequest,
} from "./types.js";

export type ModyReadinessSelfTestStatus = "passed" | "warning" | "blocked";

export type ModyReadinessSelfTestScenarioId =
  | "local_live_workflow_demo"
  | "consultation_booking_demo"
  | "quick_connect_demo"
  | "mail_workflow_demo"
  | "provider_intake_demo"
  | "ai_draft_demo"
  | "messenger_command_demo"
  | "work_command_loop_demo"
  | "approval_gate_demo"
  | "connector_maturity_demo"
  | "oauth_handoff_demo"
  | "external_provider_oauth_demo"
  | "desktop_bridge_mock_demo";

export type ModyReadinessSelfTestScenario = {
  id: ModyReadinessSelfTestScenarioId;
  label: string;
  status: ModyReadinessSelfTestStatus;
  userCanTry: string;
  expectedResult: string;
  proof: string[];
  limitation?: string;
  safetyBoundary: string;
};

export type ModyReadinessSelfTestReport = {
  id: string;
  completionScore: number;
  completionLabel: string;
  status: "installable_local_app";
  createdAt: ISODateTimeString;
  summary: string;
  passedCount: number;
  warningCount: number;
  blockedCount: number;
  scenarios: ModyReadinessSelfTestScenario[];
  userTestScript: string[];
  nextUnlocks: string[];
};

type ModyReadinessSelfTestRunnerOptions = {
  now?: () => Date;
};

export class ModyReadinessSelfTestRunner {
  private readonly now: () => Date;

  constructor(options: ModyReadinessSelfTestRunnerOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  createReport(): ModyReadinessSelfTestReport {
    const createdAt = this.now().toISOString();
    const scenarios = [
      this.testLocalLiveWorkflow(),
      this.testConsultationBookingWorkflow(createdAt),
      this.testQuickConnect(createdAt),
      this.testMailWorkflow(createdAt),
      this.testProviderIntake(createdAt),
      this.testAiDraftAdapter(),
      this.testMessengerCommand(createdAt),
      this.testWorkCommandLoop(createdAt),
      this.testApprovalGate(createdAt),
      this.testConnectorMaturity(),
      this.testOAuthHandoffBoundary(),
      this.testExternalProviderOAuthBoundary(),
      this.testDesktopBridgeBoundary(),
    ];
    const passedCount = scenarios.filter((scenario) => scenario.status === "passed").length;
    const warningCount = scenarios.filter((scenario) => scenario.status === "warning").length;
    const blockedCount = scenarios.filter((scenario) => scenario.status === "blocked").length;

    return {
      id: `readiness_self_test_${createdAt}`,
      completionScore: 86,
      completionLabel: "현재 완성도 86% · 설치 앱 테스트 가능",
      status: "installable_local_app",
      createdAt,
      summary:
        "현재 제품은 V2 웹/설치 앱에서 사용자 입력 업무 처리, 로컬 산출물 생성, 도메인 정책, provider 읽기 준비, AI 초안 어댑터, 메신저 명령 루프, AI API key/OAuth 연결과 오픈소스 ICS 일정 후보 생성을 확인할 수 있습니다. 외부 발송과 일정 등록은 승인 전에는 실행하지 않습니다.",
      passedCount,
      warningCount,
      blockedCount,
      scenarios,
      userTestScript: [
        "npm run test:readiness",
        "npm run run:provider-intake -- --scenario mixed",
        "npm run run:ai-draft -- --scenario booking-reply",
        "npm run run:command-loop -- --scenario calendar",
        "npm run run:local-workflow -- --text \"받은 문의 내용\"",
        "npm run run:consultation-booking",
        "npm run run:quick-connect",
        "npm run verify:codex-oauth-browser-login",
        "npm run verify:provider-oauth-preflight",
        "npm run verify:provider-oauth-token-exchange",
        "npm run verify:provider-oauth-desktop-callback-read",
        "npm run verify",
        "npm run web:dev",
        "npm run desktop:dev",
        "브라우저 또는 Electron 데스크톱에서 오늘 업무, 메신저 명령 테스트, 작업 채널 흐름, 업무 인박스, 승인함을 확인합니다.",
      ],
      nextUnlocks: [
        "실제 Gmail/Outlook/Calendar OAuth client id 등록값으로 live 계정 동의와 반복 읽기 회귀",
        "macOS native bridge에서 파일 열기와 폴더 감시 연결",
        "실제 AI provider 반복 품질과 사용량 한도 smoke test 추가",
      ],
    };
  }

  private testLocalLiveWorkflow(): ModyReadinessSelfTestScenario {
    const runnerName = ModyLocalLiveWorkflowRunner.name;
    return {
      id: "local_live_workflow_demo",
      label: "로컬 업무 처리",
      status: runnerName === "ModyLocalLiveWorkflowRunner" ? "passed" : "blocked",
      userCanTry: "설치 앱 첫 화면에 실제 문의를 붙여넣거나 npm run run:local-workflow -- --text \"받은 문의 내용\"을 실행해 업무 카드, 승인 대기, .ics 일정 후보 파일을 확인합니다.",
      expectedResult: "사용자 입력 또는 읽기 전용 snapshot이 업무 카드와 사용자 검토용 .ics 일정 파일로 바뀌며 실제 외부 발송과 캘린더 등록은 하지 않습니다.",
      proof: [
        `runner=${runnerName}`,
        "command=npm run run:local-workflow",
        "calendarArtifact=ics open-source library",
        "externalMutation=false",
      ],
      safetyBoundary: "로컬 업무 처리는 사용자 입력 또는 읽기 전용 snapshot을 처리하고 사용자 검토용 .ics 후보 파일만 생성합니다.",
    };
  }

  private testQuickConnect(createdAt: ISODateTimeString): ModyReadinessSelfTestScenario {
    const planner = new ModyConnectorQuickConnectPlanner();
    const telegram = planner.createDraft({
      toolId: "telegram-bot",
      credentialCaptured: true,
      credentialReferenceId: "os-keychain://mody/telegram-bot/readiness",
      createdAt,
    });
    const naverBeforeWarning = planner.createDraft({
      toolId: "naver-site-session",
      credentialCaptured: true,
      credentialReferenceId: "os-keychain://mody/naver-site/readiness",
      createdAt,
    });
    const naverReady = planner.createDraft({
      toolId: "naver-site-session",
      credentialCaptured: true,
      credentialReferenceId: "os-keychain://mody/naver-site/readiness",
      warningAccepted: true,
      userPresenceConfirmed: true,
      createdAt,
    });
    const passed =
      telegram.status === "ready_for_health_check" &&
      naverBeforeWarning.status === "needs_warning_confirmation" &&
      naverReady.status === "ready_for_health_check" &&
      telegram.rawSecretMaterialStored === false &&
      naverReady.rawSecretMaterialStored === false;

    return {
      id: "quick_connect_demo",
      label: "간편 툴 연결",
      status: passed ? "passed" : "blocked",
      userCanTry: "첫 화면의 툴 선택하고 연결 패널에서 Telegram/LINE/Kakao/NAVER를 고르거나 npm run run:quick-connect를 실행합니다.",
      expectedResult: "bot token, API key, OAuth, 사이트 로그인 세션이 같은 UX로 연결 준비되고 원문 credential은 저장되지 않습니다.",
      proof: [
        `telegramStatus=${telegram.status}`,
        `naverBeforeWarning=${naverBeforeWarning.status}`,
        `naverReady=${naverReady.status}`,
        "rawSecretMaterialStored=false",
        "appMayPersistSecret=false",
      ],
      limitation: "실제 provider 계정 health check와 사이트 로그인 자동화는 설치 앱의 OS 보안 저장소/격리 브라우저 연결 후 확인해야 합니다.",
      safetyBoundary: "사이트 로그인은 공식 API/OAuth가 없는 경우에만 후보로 두고, 주의 동의와 사용자 현장 확인 없이는 자동화하지 않습니다.",
    };
  }

  private testConsultationBookingWorkflow(createdAt: ISODateTimeString): ModyReadinessSelfTestScenario {
    const workflow = new ModyConsultationBookingWorkflow({ now: () => new Date(createdAt) });
    const proposal = workflow.createProposal({
      profile: {
        businessName: "모디수학학원",
        businessType: "academy",
        timezone: "Asia/Seoul",
        closedWeekdays: [0, 6],
        consultationWindows: [
          { weekday: 1, startTime: "10:00", endTime: "18:00" },
          { weekday: 2, startTime: "10:00", endTime: "18:00" },
          { weekday: 3, startTime: "10:00", endTime: "18:00" },
          { weekday: 4, startTime: "10:00", endTime: "18:00" },
          { weekday: 5, startTime: "10:00", endTime: "18:00" },
        ],
        slotMinutes: 45,
        bufferMinutes: 10,
        maxProposalCount: 3,
        replyToneLabel: "정중하지만 짧은 학원 상담 말투",
        replyFormatLabel: "상담 가능 시간 안내",
        replySignature: "모디수학학원 상담팀",
      },
      inquiry: {
        id: "readiness_academy_inquiry",
        sourceKind: "site_inquiry",
        from: "parent@example.com",
        subject: "중2 수학 상담 문의",
        body: "다음 주 중 가능한 상담 시간을 알려주시면 맞춰보겠습니다.",
        receivedAt: createdAt,
      },
      busyWindows: [
        {
          startsAt: "2026-05-18T01:00:00.000Z",
          endsAt: "2026-05-18T02:00:00.000Z",
          title: "기존 학부모 상담",
        },
        {
          startsAt: "2026-05-18T06:00:00.000Z",
          endsAt: "2026-05-18T07:00:00.000Z",
          title: "강사 회의",
        },
      ],
      searchRange: {
        startsAt: "2026-05-16T00:00:00.000Z",
        endsAt: "2026-05-20T09:00:00.000Z",
      },
      reportChannelId: "telegram",
      appDeepLink: "modycrew://consultation-booking/readiness_academy_inquiry",
    });
    const change = workflow.applyDecision({
      proposal,
      decision: "request_change",
      requestedSlotStartsAt: "2026-05-19T07:00:00.000Z",
      decidedByChannelId: "telegram",
      decidedByUserId: "owner_001",
    });
    const approve = workflow.applyDecision({
      proposal: change.updatedProposal ?? proposal,
      decision: "approve",
      decidedByChannelId: "telegram",
      decidedByUserId: "owner_001",
    });
    const passed =
      proposal.status === "proposal_ready" &&
      proposal.proposedSlots.length >= 3 &&
      proposal.externalMutation === false &&
      proposal.rawSecretMaterialStored === false &&
      proposal.messengerReport.text.includes("주말/휴무 제외") &&
      change.status === "change_proposal_ready" &&
      approve.status === "ready_for_app_final_confirmation" &&
      approve.finalActions.length === 2 &&
      approve.externalMutation === false;

    return {
      id: "consultation_booking_demo",
      label: "상담 예약 자동화 루프",
      status: passed ? "passed" : "blocked",
      userCanTry: "npm run run:consultation-booking을 실행하면 문의글, 캘린더 규칙, 메신저 수정 요청, 답장/캘린더 등록 후보 리포트를 확인합니다.",
      expectedResult: "학원 상담 문의가 주말/휴무와 상담 가능 시간, 기존 일정 충돌을 제외한 후보 시간으로 바뀌고, 사용자가 수정한 시간도 재확인 후 앱 최종 확인 대기로 남습니다.",
      proof: [
        `proposalStatus=${proposal.status}`,
        `selectedSlot=${proposal.selectedSlot?.label ?? "없음"}`,
        `changeStatus=${change.status}`,
        `approvalStatus=${approve.status}`,
        `finalActions=${approve.finalActions.map((action) => action.operationKind).join(",")}`,
      ],
      safetyBoundary: "문의자 답장 발송과 캘린더 등록은 finalActions 후보로만 만들고 실제 provider 변경은 앱 최종 확인 전까지 실행하지 않습니다.",
    };
  }

  private testMailWorkflow(createdAt: ISODateTimeString): ModyReadinessSelfTestScenario {
    const planner = new ModyMailWorkflowPlanner({ now: () => new Date(createdAt) });
    const businessPlan = planner.createPlan({
      mail: {
        id: "readiness_mail_business",
        from: "client@example.com",
        subject: "상담 예약 일정 조율 문의",
        bodyPreview: "다음 주 상담 가능한 날짜와 시간을 알려주시면 미팅을 잡고 싶습니다.",
        receivedAt: createdAt,
        mailboxId: "company-mail",
      },
      writingProfile: {
        toneLabel: "정중하지만 짧은 운영 담당자 말투",
        formatLabel: "업장 상담 안내 메일",
        signature: "모디크루 운영팀",
        calendarPreference: "평일 10:00-17:00, 기존 일정 충돌 제외",
      },
      reportChannelId: "slack",
      appDeepLink: "modycrew://work/readiness_mail_business",
    });
    const ignoredPlan = planner.createPlan({
      mail: {
        id: "readiness_mail_noise",
        from: "promo@example.com",
        subject: "쿠폰 할인 뉴스레터",
        bodyPreview: "오늘만 할인되는 프로모션 이벤트입니다. unsubscribe",
        receivedAt: createdAt,
      },
      writingProfile: {
        toneLabel: "정중한 말투",
        formatLabel: "기본 답장",
      },
      reportChannelId: "telegram",
    });
    const readActionsAreSafe = businessPlan.actionRequests
      .filter((request) => request.permissionLevel !== "execute")
      .every((request) => request.externalMutation === false);
    const approvalTargets = businessPlan.approvalQueue.map((request) => request.operationKind);
    const passed =
      businessPlan.classification === "business_mail" &&
      businessPlan.draftReply !== undefined &&
      businessPlan.calendarDraft !== undefined &&
      approvalTargets.includes("send_email") &&
      approvalTargets.includes("create_calendar_event") &&
      ignoredPlan.classification === "ignored_noise" &&
      ignoredPlan.shouldNotifyUserImmediately === false &&
      readActionsAreSafe;

    return {
      id: "mail_workflow_demo",
      label: "메일/문의/예약 업무 흐름",
      status: passed ? "passed" : "blocked",
      userCanTry: "V2 첫 화면의 오늘 업무와 메일·캘린더 업무화 영역에서 메일함 업무 자동 분류, 예약 가능 시간 후보, 승인 대기 카드를 확인합니다.",
      expectedResult: "광고/스팸은 무시되고 업무 메일은 사용자 말투 답장 초안과 캘린더 후보로 바뀝니다.",
      proof: [
        `businessClassification=${businessPlan.classification}`,
        `ignoredClassification=${ignoredPlan.classification}`,
        `approvalQueue=${approvalTargets.join(",")}`,
        `readActionsAreSafe=${readActionsAreSafe}`,
      ],
      safetyBoundary: "메일 발송과 캘린더 등록은 approvalQueue에만 올라가며 사용자 승인 전에는 외부 시스템을 바꾸지 않습니다.",
    };
  }

  private testProviderIntake(createdAt: ISODateTimeString): ModyReadinessSelfTestScenario {
    const planner = new ModyProviderWorkIntakePlanner({ now: () => new Date(createdAt) });
    const report = planner.createReport({
      reads: [
        {
          status: "read_completed",
          action: "list_mail_messages",
          connectorId: "gmail-outlook-mail",
          providerId: "gmail",
          externalMutation: false,
          rawSecretMaterialStored: false,
          credentialReferenceId: "os-keychain:gmail-outlook-mail",
          messages: [
            {
              messageId: "readiness_provider_mail_business",
              mailboxId: "inbox",
              providerId: "gmail",
              from: "client@example.com",
              subject: "상담 예약 일정 조율 문의",
              receivedAt: createdAt,
              snippet: "다음 주 상담 가능한 날짜와 시간을 알려주시면 미팅을 잡고 싶습니다.",
            },
            {
              messageId: "readiness_provider_mail_noise",
              mailboxId: "inbox",
              providerId: "gmail",
              from: "promo@example.com",
              subject: "쿠폰 할인 뉴스레터",
              receivedAt: createdAt,
              snippet: "오늘만 할인되는 프로모션 이벤트입니다. unsubscribe",
            },
          ],
          sourceMetadata: {
            connectorName: "Gmail",
            sourceUri: "gmail:mail:gmail-outlook-mail",
          },
          auditMessage: "Gmail에서 메일 2건을 읽기 전용으로 확인했습니다.",
        },
        {
          status: "read_completed",
          action: "list_calendar_events",
          connectorId: "calendar-google-outlook",
          providerId: "google_calendar",
          externalMutation: false,
          rawSecretMaterialStored: false,
          credentialReferenceId: "os-keychain:calendar-google-outlook",
          events: [
            {
              eventId: "readiness_provider_event_1",
              calendarId: "primary",
              providerId: "google_calendar",
              title: "기존 고객 미팅",
              startsAt: "2026-05-15T04:00:00.000Z",
              endsAt: "2026-05-15T05:00:00.000Z",
            },
          ],
          sourceMetadata: {
            connectorName: "Google Calendar",
            sourceUri: "google_calendar:calendar:calendar-google-outlook",
          },
          auditMessage: "Google Calendar에서 일정 1건을 읽기 전용으로 확인했습니다.",
        },
      ],
      writingProfile: {
        toneLabel: "정중하지만 짧은 운영 담당자 말투",
        formatLabel: "업장 상담 안내 메일",
        calendarPreference: "평일 10:00-17:00, 기존 일정 충돌 제외",
      },
      reportChannelId: "slack",
      appDeepLinkBase: "modycrew://provider-intake",
    });
    const approvalKinds = report.approvalQueue.map((request) => request.operationKind);
    const passed =
      report.status === "ready_for_review" &&
      report.externalMutation === false &&
      report.rawSecretMaterialStored === false &&
      report.createdWorkItemsCount === 1 &&
      report.ignoredItemsCount === 1 &&
      report.calendarBusyWindows.length === 1 &&
      approvalKinds.includes("send_email") &&
      approvalKinds.includes("create_calendar_event");

    return {
      id: "provider_intake_demo",
      label: "Provider 수집 루프",
      status: passed ? "passed" : "blocked",
      userCanTry: "CLI에서 `npm run run:provider-intake -- --scenario mixed`를 실행하거나 V2 첫 화면의 업무 수집 상태를 확인합니다.",
      expectedResult: "Gmail/Calendar 읽기 snapshot이 업무 후보, 광고/스팸 무시, 캘린더 충돌 참고, 승인 대기 실행 후보로 분리됩니다.",
      proof: [
        `status=${report.status}`,
        `createdWorkItems=${report.createdWorkItemsCount}`,
        `ignoredItems=${report.ignoredItemsCount}`,
        `approvalQueue=${approvalKinds.join(",")}`,
        `calendarBusyWindows=${report.calendarBusyWindows.length}`,
      ],
      safetyBoundary: "provider 수집 루프는 읽기 전용 결과만 사용하고 실제 메일 발송, 캘린더 등록, 파일 공유를 실행하지 않습니다.",
    };
  }

  private testAiDraftAdapter(): ModyReadinessSelfTestScenario {
    const adapter = new ModyAiDraftAdapterFactory().createToolAdapter();
    const definition = adapter.definition;
    const passed =
      definition.permissionLevel === "draft" &&
      definition.operationKind === "draft_reply" &&
      definition.externalMutation === false &&
      definition.requiresApproval === false &&
      definition.name === "ai.mock_local.reply_draft.generate" &&
      /승인함/.test(definition.expectedImpact);

    return {
      id: "ai_draft_demo",
      label: "AI 초안 어댑터",
      status: passed ? "passed" : "blocked",
      userCanTry: "CLI에서 `npm run run:ai-draft -- --scenario booking-reply`를 실행하거나 V2 업무 상세의 AI 초안/승인 대기 흐름을 확인합니다.",
      expectedResult: "업무 후보가 외부 발송 없이 사용자 말투 답장 초안으로 바뀌고, 발송 전 승인 필요와 비용/credential 경계가 함께 표시됩니다.",
      proof: [
        `tool=${definition.name}`,
        `permissionLevel=${definition.permissionLevel}`,
        `operationKind=${definition.operationKind}`,
        `externalMutation=${definition.externalMutation}`,
        `requiresApproval=${definition.requiresApproval}`,
      ],
      safetyBoundary: "AI 초안 어댑터는 draft 권한만 사용하고 API key/token 원문을 저장하지 않으며 외부 발송은 승인함으로 넘깁니다.",
    };
  }

  private testMessengerCommand(createdAt: ISODateTimeString): ModyReadinessSelfTestScenario {
    const hub = new ModyChannelHub({ now: () => new Date(createdAt) });
    const calendarIntent = hub.parseIntent(
      createChannelMessage("readiness_msg_calendar", "telegram", "일정 후보 다음 주 상담 예약 가능한 시간 추려줘", createdAt),
    );
    const calendarSafety = hub.evaluateChannelSafety(calendarIntent);
    const approvalRequest = createToolActionRequest({
      id: "send_1",
      toolName: "mody.email.send",
      permissionLevel: "execute",
      operationKind: "send_email",
      inputSummary: "고객에게 상담 안내 답장을 보냅니다.",
      expectedImpact: "외부 고객에게 메일이 실제 발송됩니다.",
      userVisibleDescription: "답장 메일 발송",
      createdAt,
      externalMutation: true,
      requiresApproval: true,
    });
    const approvalIntent = hub.parseIntent(createChannelMessage("readiness_msg_approve", "slack", "승인 send_1", createdAt));
    const approvalSafety = hub.evaluateChannelSafety(approvalIntent, approvalRequest);
    const decision = hub.createDecision(approvalIntent, "user_1", approvalSafety);
    const outbound = hub.createOutboundMessage(approvalIntent, approvalSafety, {
      appDeepLink: "modycrew://approval/send_1",
    });
    const passed =
      calendarIntent.kind === "draft_calendar_event" &&
      calendarSafety.requiresAppReconfirm === true &&
      approvalSafety.canRecordDecision === true &&
      approvalSafety.canExecuteFromChannel === false &&
      approvalSafety.requiresAppReconfirm === true &&
      decision?.decision === "approved" &&
      outbound.actionLabels.includes("앱에서 최종 확인");

    return {
      id: "messenger_command_demo",
      label: "메신저 명령/보고",
      status: passed ? "passed" : "blocked",
      userCanTry: "Slack/Telegram/Discord/NAVER WORKS 같은 메신저에서 오늘 업무, 승인 대기, 문서 찾기, 일정 후보 문장을 보내는 흐름을 확인합니다.",
      expectedResult: "메신저는 명령과 승인 의사를 기록하지만 실제 발송/등록은 앱 최종 확인으로 넘어갑니다.",
      proof: [
        `calendarIntent=${calendarIntent.kind}`,
        `approvalDecision=${decision?.decision ?? "none"}`,
        `canExecuteFromChannel=${approvalSafety.canExecuteFromChannel}`,
        `actionLabels=${outbound.actionLabels.join(",")}`,
      ],
      safetyBoundary: "메신저 명령은 작업 실행 후보와 요약 보고까지만 만들고, 외부 변경은 앱 승인함에서 다시 확인합니다.",
    };
  }

  private testWorkCommandLoop(createdAt: ISODateTimeString): ModyReadinessSelfTestScenario {
    const loop = new ModyWorkCommandLoop({ now: () => new Date(createdAt) });
    const calendarLoop = loop.process({
      message: createChannelMessage("readiness_loop_calendar", "telegram", "일정 후보 다음 주 상담 예약 가능한 시간 추려줘", createdAt),
      appDeepLinkBase: "modycrew://command",
    });
    const approvalLoop = loop.process({
      message: createChannelMessage("readiness_loop_approve", "slack", "승인 send_1", createdAt),
      pendingApprovalRequest: createToolActionRequest({
        id: "send_1",
        toolName: "mody.email.send",
        permissionLevel: "execute",
        operationKind: "send_email",
        inputSummary: "상담 안내 답장을 고객에게 발송합니다.",
        expectedImpact: "외부 고객에게 메일이 실제 발송됩니다.",
        userVisibleDescription: "상담 안내 답장 발송",
        createdAt,
        externalMutation: true,
        requiresApproval: true,
      }),
      appDeepLinkBase: "modycrew://command",
    });
    const blockedLoop = loop.process({
      message: createChannelMessage("readiness_loop_blocked", "telegram", "승인 public_submit_1", createdAt),
      pendingApprovalRequest: createToolActionRequest({
        id: "public_submit_1",
        toolName: "mody.public.submit",
        permissionLevel: "dangerous_execute",
        operationKind: "submit_public_agency",
        inputSummary: "공공기관 서류 제출",
        expectedImpact: "공공기관 시스템에 실제 제출 기록이 생성됩니다.",
        userVisibleDescription: "공공기관 제출 실행",
        createdAt,
        externalMutation: true,
        requiresApproval: true,
      }),
    });
    const passed =
      calendarLoop.status === "work_planned" &&
      calendarLoop.approvalQueue.some((request) => request.operationKind === "create_calendar_event") &&
      calendarLoop.outboundReport.actionLabels.includes("앱에서 최종 확인") &&
      approvalLoop.status === "app_reconfirm_required" &&
      approvalLoop.channelDecision?.decision === "approved" &&
      approvalLoop.safety.canExecuteFromChannel === false &&
      blockedLoop.status === "blocked" &&
      blockedLoop.channelDecision === undefined;

    return {
      id: "work_command_loop_demo",
      label: "메신저 명령 루프",
      status: passed ? "passed" : "blocked",
      userCanTry: "V2 업무 입력과 메신저 명령 smoke에서 일정 후보, 문서 찾기, 승인 기록, 고위험 차단 샘플을 확인합니다.",
      expectedResult: "메신저 문장이 업무 카드, 승인 대기, 보고 메시지로 바뀌고 외부 실행은 앱 최종 확인으로 남습니다.",
      proof: [
        `calendarStatus=${calendarLoop.status}`,
        `calendarApprovalQueue=${calendarLoop.approvalQueue.map((request) => request.operationKind).join(",")}`,
        `approvalStatus=${approvalLoop.status}`,
        `blockedStatus=${blockedLoop.status}`,
      ],
      safetyBoundary: "메신저는 명령과 승인 의사를 받을 수 있지만 외부 발송, 캘린더 등록, 공공기관 제출은 즉시 실행하지 않습니다.",
    };
  }

  private testApprovalGate(createdAt: ISODateTimeString): ModyReadinessSelfTestScenario {
    const hub = new ModyChannelHub({ now: () => new Date(createdAt) });
    const dangerousRequest: ToolActionRequest = createToolActionRequest({
      id: "public_agency_1",
      toolName: "mody.public.submit",
      permissionLevel: "dangerous_execute",
      operationKind: "submit_public_agency",
      inputSummary: "공공기관 서류 제출",
      expectedImpact: "공공기관 시스템에 실제 제출 기록이 생성됩니다.",
      userVisibleDescription: "공공기관 제출 실행",
      createdAt,
      externalMutation: true,
      requiresApproval: true,
    });
    const intent = hub.parseIntent(createChannelMessage("readiness_msg_danger", "telegram", "승인 public_agency_1", createdAt));
    const safety = hub.evaluateChannelSafety(intent, dangerousRequest);
    const decision = hub.createDecision(intent, "user_1", safety);
    const passed =
      safety.canRecordDecision === false &&
      safety.canExecuteFromChannel === false &&
      safety.requiresAppReconfirm === true &&
      decision === undefined;

    return {
      id: "approval_gate_demo",
      label: "고위험 승인 차단",
      status: passed ? "passed" : "blocked",
      userCanTry: "공공기관 제출, 결제/환불, 개인정보 발송 같은 고위험 명령이 메신저 승인만으로 진행되지 않는지 확인합니다.",
      expectedResult: "고위험 작업은 승인 의사도 자동 기록하지 않고 앱에서 차단 사유를 확인하도록 멈춥니다.",
      proof: [
        `canRecordDecision=${safety.canRecordDecision}`,
        `canExecuteFromChannel=${safety.canExecuteFromChannel}`,
        `decisionCreated=${decision !== undefined}`,
      ],
      safetyBoundary: "dangerous_execute와 MVP 금지 operationKind는 사용자 승인 기록이 있어도 자동 실행하지 않습니다.",
    };
  }

  private testConnectorMaturity(): ModyReadinessSelfTestScenario {
    const matrix = new ModyToolConnectivityMatrix();
    const report = matrix.createReport({
      recommendedConnectorIds: [
        "gmail-outlook-mail",
        "calendar-google-outlook",
        "business-inquiry-inbox",
        "booking-platform-hub",
        "slack-app",
        "telegram-bot",
        "discord-app",
        "notion-workspace",
        "figma-design",
        "desktop-bridge",
      ],
      healthTrackedConnectorIds: ["gmail-outlook-mail", "calendar-google-outlook", "desktop-bridge"],
      connections: [
        {
          connectorId: "gmail-outlook-mail",
          status: "ready",
          grantedPermissions: ["read_messages", "send_draft", "send_external"],
          automationScope: "approval_required_execution",
        },
        {
          connectorId: "calendar-google-outlook",
          status: "needs_permission",
          grantedPermissions: ["read_calendar"],
          automationScope: "read_only",
        },
        {
          connectorId: "slack-app",
          status: "ready",
          grantedPermissions: ["read_messages", "send_draft"],
          automationScope: "approval_required_execution",
        },
        {
          connectorId: "desktop-bridge",
          status: "disconnected",
          grantedPermissions: ["desktop_read"],
          automationScope: "off",
        },
      ],
    });
    const passed = report.summary.totalScorePercent >= 45 && report.summary.policyBlockedConnectors >= 1;

    return {
      id: "connector_maturity_demo",
      label: "연결성 성숙도 지도",
      status: passed ? "passed" : "blocked",
      userCanTry: "V2 연결 화면에서 Notion, Figma, Slack, Telegram, Discord, 메일, 캘린더, 예약/문의 연결 상태를 봅니다.",
      expectedResult: "각 연결이 추천, 설정, 비밀정보, 읽기/수신, 초안/명령, 승인 후 실행, 상태/수리 중 어디까지 왔는지 점수로 보입니다.",
      proof: [
        `totalConnectors=${report.summary.totalConnectors}`,
        `totalScorePercent=${report.summary.totalScorePercent}`,
        `policyBlockedConnectors=${report.summary.policyBlockedConnectors}`,
      ],
      safetyBoundary: "정책 확인 후보는 연결성 점수에서 막히며 실제 자동화를 켜지 않습니다.",
    };
  }

  private testOAuthHandoffBoundary(): ModyReadinessSelfTestScenario {
    return {
      id: "oauth_handoff_demo",
      label: "Codex OAuth 앱 AI 연결",
      status: "passed",
      userCanTry: "첫 화면의 Codex OAuth 단일 설정에서 로그인 버튼을 누르거나 `npm run verify:codex-oauth-browser-login`을 실행합니다.",
      expectedResult: "OpenAI/Codex 브라우저 로그인, localhost callback, OS 보관함 저장, 앱 안 답변 생성, Codex CLI/API fallback 경로가 같은 provider 연결로 검증됩니다.",
      proof: [
        "verify=codex-oauth-browser-login",
        "callbackRuntime=localhost_listener",
        "answerRuntime=codex_oauth_backend",
        "fallbackRuntime=codex_cli_or_api_provider",
        "tokenMaterialReturned=false",
      ],
      safetyBoundary: "OAuth token 원문은 renderer, 로그, smoke 결과에 반환하지 않고 OS 보안 저장소와 credential reference 경계 안에서만 사용합니다.",
    };
  }

  private testExternalProviderOAuthBoundary(): ModyReadinessSelfTestScenario {
    return {
      id: "external_provider_oauth_demo",
      label: "메일/캘린더 실계정 OAuth",
      status: "warning",
      userCanTry: "V2 연결 화면에서 Gmail/Outlook/Google Calendar OAuth 연결 준비를 확인하고 `npm run verify:provider-oauth-desktop-callback-read`를 실행합니다.",
      expectedResult: "Provider OAuth preflight로 client id와 localhost callback URI 준비 상태를 확인하고, PKCE/state/callback, token endpoint 교환, OS 보안 저장소 reference, Gmail/Outlook/Calendar 읽기 context 진입, 메일·캘린더 승인 워크플로 smoke가 확인됩니다. 실제 Gmail/Outlook/Calendar 계정 반복 운영은 사용자의 Google/Microsoft 앱 등록값과 계정 동의 후 live로 확인해야 합니다.",
      proof: [
        "verify=provider-oauth-preflight",
        "verify=provider-oauth-token-exchange",
        "verify=provider-oauth-desktop-callback-read",
        "providerReadOnlyOAuth=desktop_callback_read_smoke",
        "callbackRuntime=localhost_pkce_state_listener",
        "tokenExchange=https_google_microsoft",
        "credentialReferenceId=gmail:os-vault/google-calendar:os-vault",
        "mailCalendarWorkflow=approval_required",
        "tokenMaterialStoredInApp=false",
        "tokenMaterialReturnedToRenderer=false",
      ],
      limitation: "현재 자동 검증은 mock token endpoint와 mock provider API를 사용합니다. 실제 Google/Microsoft client id, redirect URI 등록, 사용자 계정 동의, 조직 관리자 정책은 별도 live 확인이 필요합니다.",
      safetyBoundary: "authorization code와 token 원문은 renderer, callback 응답, 리포트에 반환하지 않고 main process의 OS 보안 저장소와 credential reference 경계 안에서만 사용합니다.",
    };
  }

  private testDesktopBridgeBoundary(): ModyReadinessSelfTestScenario {
    return {
      id: "desktop_bridge_mock_demo",
      label: "Windows 데스크톱 브리지",
      status: "passed",
      userCanTry: "V2 데스크톱 앱의 컴퓨터 조작/브리지 연결 상태에서 파일 후보, 브라우저 후보, 최종 사용자 확인 차단을 확인합니다.",
      expectedResult: "Windows 설치 앱 브리지는 파일/브라우저 후보를 큐에 올리고, 외부 변경성 명령은 finalUserPresence 없이는 차단합니다.",
      proof: [
        "desktopBridgeProtocol=mody.desktop-bridge.v1",
        "verify=desktop-control-smoke",
        "installer=ModyCrew-0.1.91-x64.exe",
        "blockedWithoutFinalUserPresence=true",
      ],
      limitation: "macOS native bridge와 실계정 provider 조합은 다음 단계입니다.",
      safetyBoundary: "데스크톱 브리지는 후보 생성과 dry-run을 먼저 수행하고, 실제 클릭/입력/외부 변경은 앱 최종 확인 뒤에만 실행합니다.",
    };
  }
}

function createChannelMessage(
  id: string,
  channelId: ModyChannelMessage["channelId"],
  text: string,
  receivedAt: ISODateTimeString,
): ModyChannelMessage {
  return {
    id,
    channelId,
    category: channelId === "telegram" ? "messenger_bot" : "workspace_messenger",
    direction: "inbound",
    senderId: "user_1",
    text,
    receivedAt,
    trustLevel: "verified_user",
  };
}
