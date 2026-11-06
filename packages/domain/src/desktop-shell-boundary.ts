import type {
  ModyDesktopCapability,
  ModyDesktopPlatform,
} from "./desktop-bridge.js";
import type {
  ModyDesktopBridgeHealth,
  ModyDesktopBridgeHealthStatus,
} from "./desktop-bridge-runtime.js";
import type { ISODateTimeString } from "./types.js";

export type ModyDesktopShellCandidateId =
  | "electron-desktop-shell"
  | "tauri-desktop-shell"
  | "native-helper-service";

export type ModyDesktopShellCandidateDecision =
  | "recommended_for_v1"
  | "defer_until_native_security_review"
  | "defer_for_enterprise_v2";

export type ModyDesktopShellCandidate = {
  id: ModyDesktopShellCandidateId;
  label: string;
  decision: ModyDesktopShellCandidateDecision;
  supportedPlatforms: readonly ModyDesktopPlatform[];
  recommendedV1Capabilities: readonly ModyDesktopCapability[];
  deferredCapabilities: readonly ModyDesktopCapability[];
  userMessage: string;
  riskControls: readonly string[];
};

export type ModyDesktopShellCapabilityReviewStatus =
  | "v1_supported"
  | "deferred_permission_review"
  | "blocked_in_v1";

export type ModyDesktopShellCapabilityReview = {
  capability: ModyDesktopCapability;
  status: ModyDesktopShellCapabilityReviewStatus;
  finalUserPresenceRequired: boolean;
  userMessage: string;
};

export type ModyDesktopShellHealthInput = {
  bridgeId: string;
  platform: ModyDesktopPlatform;
  status: ModyDesktopBridgeHealthStatus;
  candidateId?: ModyDesktopShellCandidateId;
  version?: string;
  grantedCapabilities?: readonly ModyDesktopCapability[];
  lastHeartbeatAt?: ISODateTimeString;
};

export const modyDesktopShellV1Capabilities: readonly ModyDesktopCapability[] = [
  "list_windows",
  "open_app",
  "open_url",
  "open_local_file",
  "read_local_file",
  "watch_folder",
] as const;

const permissionReviewCapabilities: readonly ModyDesktopCapability[] = [
  "read_screen",
  "read_clipboard",
] as const;

const blockedV1Capabilities: readonly ModyDesktopCapability[] = [
  "write_local_file",
  "click",
  "type_text",
  "send_hotkey",
  "browser_automation",
] as const;

export const modyDesktopShellCandidates: readonly ModyDesktopShellCandidate[] = [
  {
    id: "electron-desktop-shell",
    label: "Electron desktop shell",
    decision: "recommended_for_v1",
    supportedPlatforms: ["windows", "macos"],
    recommendedV1Capabilities: modyDesktopShellV1Capabilities,
    deferredCapabilities: [...permissionReviewCapabilities, ...blockedV1Capabilities],
    userMessage: "V1은 Electron shell에서 파일 열기, 폴더 감시, 앱/URL 열기를 먼저 연결합니다.",
    riskControls: [
      "mody.desktop-bridge.v1 IPC allowlist",
      "OS secret storage reference only",
      "approval gate before external mutation",
      "native V1 excludes click/type/browser automation",
    ],
  },
  {
    id: "tauri-desktop-shell",
    label: "Tauri desktop shell",
    decision: "defer_until_native_security_review",
    supportedPlatforms: ["windows", "macos"],
    recommendedV1Capabilities: ["open_app", "open_url", "open_local_file"],
    deferredCapabilities: ["watch_folder", "read_local_file", ...permissionReviewCapabilities, ...blockedV1Capabilities],
    userMessage: "Tauri는 가볍지만 native permission/plugin 경계를 더 검토한 뒤 도입합니다.",
    riskControls: [
      "Rust command allowlist review",
      "per-platform folder permission review",
      "updater and signing review",
    ],
  },
  {
    id: "native-helper-service",
    label: "Native helper service",
    decision: "defer_for_enterprise_v2",
    supportedPlatforms: ["windows", "macos"],
    recommendedV1Capabilities: ["read_local_file", "watch_folder"],
    deferredCapabilities: ["open_app", "open_url", "open_local_file", ...permissionReviewCapabilities, ...blockedV1Capabilities],
    userMessage: "별도 native helper는 엔터프라이즈 배포와 강한 OS 제어가 필요해지는 V2에서 검토합니다.",
    riskControls: [
      "code signing required",
      "service install approval required",
      "enterprise audit policy required",
    ],
  },
];

export class ModyDesktopShellBoundary {
  listCandidates(): readonly ModyDesktopShellCandidate[] {
    return modyDesktopShellCandidates;
  }

  selectCandidate(
    candidateId: ModyDesktopShellCandidateId = "electron-desktop-shell",
  ): ModyDesktopShellCandidate {
    const candidate = modyDesktopShellCandidates.find((entry) => entry.id === candidateId);
    if (!candidate) {
      throw new Error(`지원하지 않는 데스크톱 shell 후보입니다: ${candidateId}`);
    }

    return candidate;
  }

  reviewCapability(capability: ModyDesktopCapability): ModyDesktopShellCapabilityReview {
    if (modyDesktopShellV1Capabilities.includes(capability)) {
      return {
        capability,
        status: "v1_supported",
        finalUserPresenceRequired: false,
        userMessage: `${capability} 명령은 V1 native shell health에 포함할 수 있습니다.`,
      };
    }

    if (permissionReviewCapabilities.includes(capability)) {
      return {
        capability,
        status: "deferred_permission_review",
        finalUserPresenceRequired: true,
        userMessage: `${capability} 명령은 화면/클립보드 민감 권한 검토 후 V1 이후에 엽니다.`,
      };
    }

    return {
      capability,
      status: "blocked_in_v1",
      finalUserPresenceRequired: true,
      userMessage: `${capability} 명령은 외부 상태를 바꿀 수 있어 native V1 health에서 제외합니다.`,
    };
  }

  createV1BridgeHealth(input: ModyDesktopShellHealthInput): ModyDesktopBridgeHealth {
    const candidate = this.selectCandidate(input.candidateId);
    const capabilities = candidate.recommendedV1Capabilities;
    const requestedGrants = input.grantedCapabilities ?? capabilities;
    const grantedCapabilities = requestedGrants.filter((capability) => capabilities.includes(capability));
    const health: ModyDesktopBridgeHealth = {
      bridgeId: input.bridgeId,
      platform: input.platform,
      status: input.status,
      capabilities: [...capabilities],
      grantedCapabilities,
      userMessage: buildHealthMessage(input.status, candidate),
    };

    if (input.version) health.version = input.version;
    if (input.lastHeartbeatAt) health.lastHeartbeatAt = input.lastHeartbeatAt;

    return health;
  }
}

function buildHealthMessage(
  status: ModyDesktopBridgeHealthStatus,
  candidate: ModyDesktopShellCandidate,
): string {
  if (status === "running") {
    return `${candidate.label} 브리지가 V1 안전 경계로 실행 중입니다.`;
  }

  if (status === "permission_required") {
    return `${candidate.label} 브리지 권한을 사용자가 먼저 허용해야 합니다.`;
  }

  if (status === "disconnected") {
    return `${candidate.label} 브리지가 연결되어 있지 않습니다.`;
  }

  return `${candidate.label} 브리지가 아직 설치되지 않았습니다.`;
}
