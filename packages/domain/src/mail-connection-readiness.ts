export type ModyMailConnectionCategory =
  | "consumer_mail"
  | "workspace_mail"
  | "company_mail"
  | "public_agency_mail"
  | "generic_mail";

export type ModyMailConnectionMethod =
  | "oauth_readonly"
  | "graph_oauth"
  | "imap_app_password"
  | "custom_imap_smtp"
  | "provider_admin_review";

export type ModyMailConnectionReadinessStatus =
  | "live_imap_testable"
  | "oauth_app_required"
  | "admin_policy_required"
  | "provider_policy_review_required";

export type ModyMailConnectionCapability = {
  readInbox: boolean;
  classifyInquiry: boolean;
  draftReply: boolean;
  sendAfterApproval: boolean;
  calendarLink: boolean;
};

export type ModyMailConnectionReadinessItem = {
  id: string;
  label: string;
  category: ModyMailConnectionCategory;
  method: ModyMailConnectionMethod;
  status: ModyMailConnectionReadinessStatus;
  userCanTestNow: boolean;
  providerHost?: string;
  providerPort?: number;
  requiredUserInputs: string[];
  setupSteps: string[];
  testCommand: string;
  capability: ModyMailConnectionCapability;
  safetyBoundary: string;
  officialEvidence: string[];
  externalMutationFromConnection: false;
};

export type ModyMailConnectionReadinessSummary = {
  total: number;
  liveImapTestable: number;
  oauthAppRequired: number;
  adminPolicyRequired: number;
  providerPolicyReviewRequired: number;
  userTestableNow: number;
  externalMutationAllowed: false;
};

const approvalOnlyCapability: ModyMailConnectionCapability = {
  readInbox: true,
  classifyInquiry: true,
  draftReply: true,
  sendAfterApproval: true,
  calendarLink: true,
};

export const modyMailConnectionReadinessItems: ModyMailConnectionReadinessItem[] = [
  {
    id: "generic-imap-smtp",
    label: "범용 IMAP/SMTP",
    category: "generic_mail",
    method: "custom_imap_smtp",
    status: "live_imap_testable",
    userCanTestNow: true,
    providerPort: 993,
    requiredUserInputs: ["IMAP host", "IMAP port", "메일 주소", "앱 비밀번호", "메일함 이름"],
    setupSteps: ["메일 provider에서 IMAP 사용", "앱 비밀번호 또는 전용 비밀번호 생성", "연결 테스트", "읽기 전용 업무 분류"],
    testCommand: "npm run run:imap-live -- --host <imap-host> --username <email> --password <app-password>",
    capability: approvalOnlyCapability,
    safetyBoundary: "IMAP probe는 envelope/internalDate/flags/size만 읽고 메일 삭제, 이동, 읽음 처리, 답장 발송은 실행하지 않습니다.",
    officialEvidence: ["IMAP 표준 provider는 host/port/credential이 있으면 read-only mailbox probe를 수행할 수 있습니다."],
    externalMutationFromConnection: false,
  },
  {
    id: "gmail-api-oauth",
    label: "Gmail OAuth",
    category: "workspace_mail",
    method: "oauth_readonly",
    status: "oauth_app_required",
    userCanTestNow: false,
    requiredUserInputs: ["Google OAuth client", "redirect URI", "gmail.readonly 또는 gmail.compose/send scope 동의"],
    setupSteps: ["Google Cloud OAuth 앱 생성", "read-only scope부터 동의", "callback state 검증", "승인 후 발송 scope 분리"],
    testCommand: "npm run run:provider-intake -- --provider gmail-oauth",
    capability: approvalOnlyCapability,
    safetyBoundary: "Gmail OAuth는 제한 scope 검증과 보안 심사 가능성을 검토한 뒤 read-only부터 진행합니다. full mailbox scope는 V1 기본값으로 쓰지 않습니다.",
    officialEvidence: ["Gmail API scopes include gmail.readonly, gmail.compose, gmail.send, and restricted full mailbox scope."],
    externalMutationFromConnection: false,
  },
  {
    id: "gmail-imap",
    label: "Gmail IMAP",
    category: "consumer_mail",
    method: "imap_app_password",
    status: "live_imap_testable",
    userCanTestNow: true,
    providerHost: "imap.gmail.com",
    providerPort: 993,
    requiredUserInputs: ["Gmail 주소", "Google 앱 비밀번호", "IMAP 사용 상태"],
    setupSteps: ["Google 계정 2단계 인증 확인", "앱 비밀번호 생성", "IMAP read-only probe", "업무 메일 분류"],
    testCommand: "npm run run:imap-live -- --host imap.gmail.com --username <gmail> --password <app-password>",
    capability: approvalOnlyCapability,
    safetyBoundary: "Gmail IMAP 연결은 읽기 probe만 수행하고 발송은 승인 후 별도 SMTP/OAuth 경계로 넘깁니다.",
    officialEvidence: ["Gmail can also be connected through Gmail API OAuth scopes when an OAuth client is configured."],
    externalMutationFromConnection: false,
  },
  {
    id: "outlook-graph-oauth",
    label: "Outlook / Microsoft 365 OAuth",
    category: "workspace_mail",
    method: "graph_oauth",
    status: "oauth_app_required",
    userCanTestNow: false,
    requiredUserInputs: ["Microsoft Entra app", "redirect URI", "Mail.Read 또는 Mail.Send delegated consent"],
    setupSteps: ["Microsoft Graph 앱 등록", "Mail.Read부터 동의", "tenant/admin 정책 확인", "발송은 승인 후 실행으로 분리"],
    testCommand: "npm run run:provider-intake -- --provider microsoft-graph-mail",
    capability: approvalOnlyCapability,
    safetyBoundary: "Graph Mail.Send와 Mail.ReadWrite는 쓰기/발송 권한이므로 연결만으로 외부 발송을 허용하지 않습니다.",
    officialEvidence: ["Microsoft Graph has Mail.ReadWrite and Mail.Send permissions with delegated/application consent boundaries."],
    externalMutationFromConnection: false,
  },
  {
    id: "outlook-imap",
    label: "Outlook IMAP",
    category: "consumer_mail",
    method: "imap_app_password",
    status: "admin_policy_required",
    userCanTestNow: true,
    providerHost: "outlook.office365.com",
    providerPort: 993,
    requiredUserInputs: ["Outlook 주소", "IMAP 사용 허용", "앱 비밀번호 또는 tenant 허용 방식"],
    setupSteps: ["계정/tenant의 IMAP 허용 확인", "전용 credential 준비", "read-only probe", "Graph OAuth 전환 후보 검토"],
    testCommand: "npm run run:imap-live -- --host outlook.office365.com --username <email> --password <app-password>",
    capability: approvalOnlyCapability,
    safetyBoundary: "Microsoft tenant가 legacy IMAP을 막을 수 있으므로 실패 시 Graph OAuth 경로로 전환합니다.",
    officialEvidence: ["Microsoft 365 environments can be governed by tenant policies and Graph permissions."],
    externalMutationFromConnection: false,
  },
  {
    id: "naver-mail-imap",
    label: "NAVER 메일",
    category: "consumer_mail",
    method: "imap_app_password",
    status: "live_imap_testable",
    userCanTestNow: true,
    providerHost: "imap.naver.com",
    providerPort: 993,
    requiredUserInputs: ["네이버 메일 주소", "IMAP/SMTP 사용 설정", "앱 비밀번호 또는 계정 보안 방식"],
    setupSteps: ["네이버 메일 IMAP/SMTP 사용", "앱 비밀번호 준비", "read-only probe", "문의 메일 분류"],
    testCommand: "npm run run:imap-live -- --host imap.naver.com --username <naver-id>@naver.com --password <app-password>",
    capability: approvalOnlyCapability,
    safetyBoundary: "NAVER 메일은 imap.naver.com read-only probe부터 확인하고 SMTP 발송은 승인 후 별도 단계로 둡니다.",
    officialEvidence: ["NAVER help documents IMAP server imap.naver.com and SMTP server smtp.naver.com."],
    externalMutationFromConnection: false,
  },
  {
    id: "daum-kakao-mail-imap",
    label: "Daum/Kakao 메일",
    category: "consumer_mail",
    method: "imap_app_password",
    status: "live_imap_testable",
    userCanTestNow: true,
    providerHost: "imap.kakao.com",
    providerPort: 993,
    requiredUserInputs: ["Daum/Kakao 메일 주소", "2단계 인증", "앱 비밀번호"],
    setupSteps: ["IMAP/POP3 사용", "2단계 인증과 앱 비밀번호 생성", "read-only probe", "문의 메일 분류"],
    testCommand: "npm run run:imap-live -- --host imap.kakao.com --username <email> --password <app-password>",
    capability: approvalOnlyCapability,
    safetyBoundary: "Kakao Mail은 앱 비밀번호를 사용해 IMAP probe만 수행하고 외부 답장은 승인 후 실행합니다.",
    officialEvidence: ["Kakao Mail notice requires 2-step verification and app password for IMAP/POP3 external clients."],
    externalMutationFromConnection: false,
  },
  {
    id: "company-mail-imap",
    label: "회사/그룹웨어 메일",
    category: "company_mail",
    method: "custom_imap_smtp",
    status: "admin_policy_required",
    userCanTestNow: true,
    providerPort: 993,
    requiredUserInputs: ["회사 IMAP host", "port", "계정", "전용 비밀번호", "관리자 허용 여부"],
    setupSteps: ["회사 provider 확인", "관리자/보안 정책 확인", "IMAP read-only probe", "발송/삭제 권한 분리"],
    testCommand: "npm run run:imap-live -- --host <company-imap-host> --username <email> --password <app-password>",
    capability: approvalOnlyCapability,
    safetyBoundary: "회사 메일은 관리자 정책을 우선하고 읽기, 초안, 발송 권한을 단계별로 분리합니다.",
    officialEvidence: ["Company mail can be Google Workspace, Microsoft 365, or any hosted IMAP/SMTP provider depending on admin policy."],
    externalMutationFromConnection: false,
  },
  {
    id: "public-agency-mail",
    label: "공공기관/보안 메일",
    category: "public_agency_mail",
    method: "provider_admin_review",
    status: "provider_policy_review_required",
    userCanTestNow: false,
    requiredUserInputs: ["기관 제공 방식", "망분리/보안 정책", "관리자 승인", "테스트 계정"],
    setupSteps: ["기관 정책 확인", "읽기 전용 가능 여부 확인", "보안 책임자 승인", "실제 연결은 별도 테스트 계정으로 진행"],
    testCommand: "npm run run:mail-readiness",
    capability: { ...approvalOnlyCapability, sendAfterApproval: false },
    safetyBoundary: "공공기관 메일은 일괄 연결 대상이 아니라 기관별 승인과 보안 검토가 끝난 뒤 읽기 전용부터 진행합니다.",
    officialEvidence: ["Public agency mail systems are provider- and policy-specific; admin review is required before automation."],
    externalMutationFromConnection: false,
  },
  {
    id: "icloud-mail-imap",
    label: "iCloud Mail",
    category: "consumer_mail",
    method: "imap_app_password",
    status: "live_imap_testable",
    userCanTestNow: true,
    providerHost: "imap.mail.me.com",
    providerPort: 993,
    requiredUserInputs: ["iCloud 메일 주소", "앱 암호", "IMAP 사용"],
    setupSteps: ["Apple ID 앱 암호 생성", "IMAP read-only probe", "업무 메일 분류", "발송은 승인 후 분리"],
    testCommand: "npm run run:imap-live -- --host imap.mail.me.com --username <icloud-email> --password <app-password>",
    capability: approvalOnlyCapability,
    safetyBoundary: "iCloud Mail은 앱 암호 기반 IMAP probe만 수행하고 외부 답장은 승인 후 실행합니다.",
    officialEvidence: ["iCloud Mail commonly uses app-specific passwords for third-party mail clients."],
    externalMutationFromConnection: false,
  },
  {
    id: "yahoo-mail-imap",
    label: "Yahoo Mail",
    category: "consumer_mail",
    method: "imap_app_password",
    status: "live_imap_testable",
    userCanTestNow: true,
    providerHost: "imap.mail.yahoo.com",
    providerPort: 993,
    requiredUserInputs: ["Yahoo 메일 주소", "앱 비밀번호", "IMAP 사용"],
    setupSteps: ["Yahoo 앱 비밀번호 생성", "IMAP read-only probe", "업무 메일 분류", "발송은 승인 후 분리"],
    testCommand: "npm run run:imap-live -- --host imap.mail.yahoo.com --username <yahoo-email> --password <app-password>",
    capability: approvalOnlyCapability,
    safetyBoundary: "Yahoo Mail은 read-only probe만 수행하고 SMTP 발송은 승인 후 별도 설정으로 둡니다.",
    officialEvidence: ["Yahoo Mail is handled through the same generic IMAP read-only connector when app password access is enabled."],
    externalMutationFromConnection: false,
  },
];

export class ModyMailConnectionReadinessMatrix {
  listItems(): ModyMailConnectionReadinessItem[] {
    return modyMailConnectionReadinessItems.map((item) => ({
      ...item,
      requiredUserInputs: [...item.requiredUserInputs],
      setupSteps: [...item.setupSteps],
      officialEvidence: [...item.officialEvidence],
      capability: { ...item.capability },
    }));
  }

  summarize(items: ModyMailConnectionReadinessItem[] = this.listItems()): ModyMailConnectionReadinessSummary {
    return {
      total: items.length,
      liveImapTestable: items.filter((item) => item.status === "live_imap_testable").length,
      oauthAppRequired: items.filter((item) => item.status === "oauth_app_required").length,
      adminPolicyRequired: items.filter((item) => item.status === "admin_policy_required").length,
      providerPolicyReviewRequired: items.filter((item) => item.status === "provider_policy_review_required").length,
      userTestableNow: items.filter((item) => item.userCanTestNow).length,
      externalMutationAllowed: false,
    };
  }

  findById(id: string): ModyMailConnectionReadinessItem | undefined {
    return this.listItems().find((item) => item.id === id);
  }

  listUserTestableItems(): ModyMailConnectionReadinessItem[] {
    return this.listItems().filter((item) => item.userCanTestNow);
  }
}
