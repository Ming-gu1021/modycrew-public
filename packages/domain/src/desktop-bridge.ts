import { createToolActionRequest } from "./policy.js";
import type {
  ISODateTimeString,
  ToolActionRequest,
  ToolOperationKind,
  ToolPermissionLevel,
  ToolRiskLabel,
} from "./types.js";

export type ModyDesktopPlatform = "windows" | "macos" | "linux";

export const modyDesktopCapabilities = [
  "read_screen",
  "read_clipboard",
  "list_windows",
  "open_app",
  "open_url",
  "open_local_file",
  "read_local_file",
  "watch_folder",
  "write_local_file",
  "click",
  "type_text",
  "send_hotkey",
  "browser_automation",
] as const;

export type ModyDesktopCapability = (typeof modyDesktopCapabilities)[number];

export type ModyDesktopActionInput = {
  id: string;
  platform: ModyDesktopPlatform;
  capability: ModyDesktopCapability;
  targetApp?: string;
  targetPath?: string;
  targetUrl?: string;
  inputSummary: string;
  userVisibleDescription: string;
  createdAt: ISODateTimeString;
};

export type ModyDesktopActionMetadata = {
  platform: ModyDesktopPlatform;
  capability: ModyDesktopCapability;
  target: {
    app?: string;
    path?: string;
    url?: string;
  };
};

export type ModyDesktopCapabilityPolicy = {
  capability: ModyDesktopCapability;
  permissionLevel: ToolPermissionLevel;
  operationKind: ToolOperationKind;
  riskLabel: ToolRiskLabel;
  externalMutation: boolean;
  expectedImpact: string;
};

const capabilityPolicies: Record<ModyDesktopCapability, ModyDesktopCapabilityPolicy> = {
  read_screen: {
    capability: "read_screen",
    permissionLevel: "read",
    operationKind: "read_data",
    riskLabel: "medium",
    externalMutation: false,
    expectedImpact: "사용자 데스크톱 화면의 현재 상태를 읽어 업무 맥락을 파악합니다.",
  },
  read_clipboard: {
    capability: "read_clipboard",
    permissionLevel: "read",
    operationKind: "read_data",
    riskLabel: "medium",
    externalMutation: false,
    expectedImpact: "클립보드 내용을 읽어 사용자가 전달한 업무 맥락을 파악합니다.",
  },
  list_windows: {
    capability: "list_windows",
    permissionLevel: "read",
    operationKind: "read_data",
    riskLabel: "low",
    externalMutation: false,
    expectedImpact: "열려 있는 앱과 창 목록을 읽어 작업 대상을 찾습니다.",
  },
  open_app: {
    capability: "open_app",
    permissionLevel: "stage",
    operationKind: "stage_approval",
    riskLabel: "medium",
    externalMutation: false,
    expectedImpact: "로컬 앱을 열 준비를 하지만 외부 업무 시스템은 변경하지 않습니다.",
  },
  open_url: {
    capability: "open_url",
    permissionLevel: "stage",
    operationKind: "stage_approval",
    riskLabel: "medium",
    externalMutation: false,
    expectedImpact: "브라우저에서 업무 URL을 열 준비를 합니다.",
  },
  open_local_file: {
    capability: "open_local_file",
    permissionLevel: "stage",
    operationKind: "stage_approval",
    riskLabel: "medium",
    externalMutation: false,
    expectedImpact: "사용자가 선택한 로컬 파일을 기본 앱으로 열 준비를 합니다.",
  },
  read_local_file: {
    capability: "read_local_file",
    permissionLevel: "read",
    operationKind: "read_data",
    riskLabel: "medium",
    externalMutation: false,
    expectedImpact: "사용자가 허용한 로컬 파일을 읽어 업무 자료로 수집합니다.",
  },
  watch_folder: {
    capability: "watch_folder",
    permissionLevel: "read",
    operationKind: "read_data",
    riskLabel: "medium",
    externalMutation: false,
    expectedImpact: "사용자가 허용한 폴더의 새 업무 자료를 감지합니다.",
  },
  write_local_file: {
    capability: "write_local_file",
    permissionLevel: "execute",
    operationKind: "other_external_mutation",
    riskLabel: "high",
    externalMutation: true,
    expectedImpact: "사용자 PC의 파일을 생성하거나 수정할 수 있습니다.",
  },
  click: {
    capability: "click",
    permissionLevel: "execute",
    operationKind: "other_external_mutation",
    riskLabel: "high",
    externalMutation: true,
    expectedImpact: "외부 앱 화면에서 클릭을 수행해 상태를 바꿀 수 있습니다.",
  },
  type_text: {
    capability: "type_text",
    permissionLevel: "execute",
    operationKind: "other_external_mutation",
    riskLabel: "high",
    externalMutation: true,
    expectedImpact: "외부 앱에 텍스트를 입력해 초안, 검색어, 명령을 만들 수 있습니다.",
  },
  send_hotkey: {
    capability: "send_hotkey",
    permissionLevel: "execute",
    operationKind: "other_external_mutation",
    riskLabel: "high",
    externalMutation: true,
    expectedImpact: "외부 앱에 단축키를 보내 상태를 바꿀 수 있습니다.",
  },
  browser_automation: {
    capability: "browser_automation",
    permissionLevel: "execute",
    operationKind: "other_external_mutation",
    riskLabel: "high",
    externalMutation: true,
    expectedImpact: "브라우저 업무 사이트를 자동 조작할 수 있습니다.",
  },
};

export class ModyDesktopBridge {
  createActionRequest(input: ModyDesktopActionInput): ToolActionRequest {
    const policy = capabilityPolicies[input.capability];

    return createToolActionRequest({
      id: input.id,
      toolName: `mody.desktop.${input.capability}`,
      permissionLevel: policy.permissionLevel,
      operationKind: policy.operationKind,
      inputSummary: desktopInputSummary(input),
      expectedImpact: policy.expectedImpact,
      userVisibleDescription: input.userVisibleDescription,
      createdAt: input.createdAt,
      sourceAdapterId: `desktop-${input.platform}`,
      externalMutation: policy.externalMutation,
      riskLabel: policy.riskLabel,
      metadata: {
        desktop: desktopMetadata(input),
      },
    });
  }

  getCapabilityPolicy(capability: ModyDesktopCapability): ModyDesktopCapabilityPolicy {
    return capabilityPolicies[capability];
  }
}

export function isModyDesktopCapability(value: unknown): value is ModyDesktopCapability {
  return typeof value === "string" && modyDesktopCapabilities.includes(value as ModyDesktopCapability);
}

export function isModyDesktopPlatform(value: unknown): value is ModyDesktopPlatform {
  return value === "windows" || value === "macos" || value === "linux";
}

function desktopMetadata(input: ModyDesktopActionInput): ModyDesktopActionMetadata {
  const target: ModyDesktopActionMetadata["target"] = {};
  if (input.targetApp) target.app = input.targetApp;
  if (input.targetPath) target.path = input.targetPath;
  if (input.targetUrl) target.url = input.targetUrl;

  return {
    platform: input.platform,
    capability: input.capability,
    target,
  };
}

function desktopInputSummary(input: ModyDesktopActionInput): string {
  return [
    `platform=${input.platform}`,
    `capability=${input.capability}`,
    input.targetApp ? `app=${input.targetApp}` : undefined,
    input.targetPath ? `path=${input.targetPath}` : undefined,
    input.targetUrl ? `url=${input.targetUrl}` : undefined,
    input.inputSummary,
  ]
    .filter(Boolean)
    .join("; ");
}
