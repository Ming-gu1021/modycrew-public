import { ModyDesktopBridge, isModyDesktopCapability, isModyDesktopPlatform } from "./desktop-bridge.js";
import type {
  ModyDesktopActionInput,
  ModyDesktopCapability,
  ModyDesktopPlatform,
} from "./desktop-bridge.js";
import type { ISODateTimeString, ToolActionRequest, ToolRiskLabel } from "./types.js";

export type ModyDesktopControlAdapterSourceKind =
  | "open_source_reference"
  | "native_bridge"
  | "browser_automation"
  | "manual_stub";

export type ModyDesktopControlAdapterLicenseKey =
  | "mit"
  | "apache-2.0"
  | "gpl-3.0"
  | "agpl-3.0"
  | "fair-code"
  | "other"
  | "unknown";

export type ModyDesktopControlAdapterAdoptionMode =
  | "reference_and_adapter"
  | "adapter_candidate"
  | "reference_only"
  | "external_integration_only";

export type ModyDesktopControlAdapterDirectCodeUse =
  | false
  | true
  | "review_required"
  | "approved";

export type ModyDesktopControlAdapterCodeImportApproval =
  | "not_requested"
  | "approved"
  | "not_allowed";

export type ModyDesktopControlAdapterManifest = {
  id: string;
  name: string;
  sourceKind: ModyDesktopControlAdapterSourceKind;
  sourceRepo?: string;
  sourceUrl?: string;
  description?: string;
  licenseKey: ModyDesktopControlAdapterLicenseKey;
  licenseName: string;
  latestRelease?: string;
  lastVerified: string;
  lastVerifiedBy: string;
  pushedAt?: ISODateTimeString;
  stargazerCount?: number;
  isArchived: boolean;
  adoptionMode: ModyDesktopControlAdapterAdoptionMode;
  directCodeUse: ModyDesktopControlAdapterDirectCodeUse;
  codeImportApproval: ModyDesktopControlAdapterCodeImportApproval;
  supportedPlatforms: readonly ModyDesktopPlatform[];
  capabilities: readonly ModyDesktopCapability[];
  evidencePaths: readonly string[];
  primaryUse: string;
  safetyNotes: readonly string[];
};

export type ModyDesktopControlAdapterReviewStatus =
  | "ready_for_adapter_experiment"
  | "license_blocked"
  | "code_import_not_approved"
  | "repo_archived"
  | "unsupported_capability"
  | "unsupported_platform";

export type ModyDesktopControlAdapterReview = {
  status: ModyDesktopControlAdapterReviewStatus;
  allowed: boolean;
  riskLabel: ToolRiskLabel;
  manifestId: string;
  reasons: string[];
  userMessage: string;
};

export type ModyDesktopControlActionInput = ModyDesktopActionInput;

export type ModyDesktopControlActionResultStatus =
  | "created"
  | "adapter_not_found"
  | "capability_not_declared"
  | "platform_not_supported"
  | ModyDesktopControlAdapterReviewStatus;

export type ModyDesktopControlActionResult = {
  status: ModyDesktopControlActionResultStatus;
  request?: ToolActionRequest;
  review?: ModyDesktopControlAdapterReview;
  userMessage: string;
};

const permissiveLicenseKeys = new Set<ModyDesktopControlAdapterLicenseKey>(["mit", "apache-2.0"]);
const restrictedLicenseKeys = new Set<ModyDesktopControlAdapterLicenseKey>([
  "gpl-3.0",
  "agpl-3.0",
  "fair-code",
]);

export const openClawDesktopControlReference: ModyDesktopControlAdapterManifest = {
  id: "openclaw-desktop-control-reference",
  name: "OpenClaw desktop control reference",
  sourceKind: "open_source_reference",
  sourceRepo: "openclaw/openclaw",
  sourceUrl: "https://github.com/openclaw/openclaw",
  description: "Personal AI assistant reference for desktop control, approval, daemon, and permission boundaries.",
  licenseKey: "mit",
  licenseName: "MIT License",
  latestRelease: "v2026.6.9",
  lastVerified: "2026-06-23",
  lastVerifiedBy: "GitHub repository + LICENSE review",
  pushedAt: "2026-06-23T00:49:13Z",
  stargazerCount: 379978,
  isArchived: false,
  adoptionMode: "reference_and_adapter",
  directCodeUse: "review_required",
  codeImportApproval: "not_requested",
  supportedPlatforms: ["windows", "macos", "linux"],
  capabilities: [
    "read_screen",
    "list_windows",
    "open_app",
    "open_url",
    "open_local_file",
    "click",
    "type_text",
    "send_hotkey",
    "browser_automation",
  ],
  evidencePaths: [
    "apps/macos/Sources/OpenClaw/ExecApprovalEvaluation.swift",
    "apps/macos/Sources/OpenClaw/ExecApprovals.swift",
    "apps/macos/Sources/OpenClaw/PermissionManager.swift",
    "src/daemon",
    "src/mcp",
    "docs/tools/exec-approvals.md",
  ],
  primaryUse: "권한 모델, 앱 조종 승인 경계, 데스크톱 daemon/channel 구조 참고",
  safetyNotes: [
    "OpenClaw 코드는 통째 포크하거나 직접 포함하지 않는다.",
    "ModyDesktopBridge가 ToolActionRequest를 만들고 ModyApprovalGate가 실행 전 최종 판단한다.",
    "클릭, 입력, 단축키, browser_automation은 승인 전 실행하지 않는다.",
  ],
};

export const playwrightMcpDesktopControlReference: ModyDesktopControlAdapterManifest = {
  id: "playwright-mcp-browser-control-reference",
  name: "Microsoft Playwright MCP browser control reference",
  sourceKind: "open_source_reference",
  sourceRepo: "microsoft/playwright-mcp",
  sourceUrl: "https://github.com/microsoft/playwright-mcp",
  description: "Browser automation MCP reference for controlled web app inspection and QA.",
  licenseKey: "apache-2.0",
  licenseName: "Apache License 2.0",
  latestRelease: "v0.0.75",
  lastVerified: "2026-05-12",
  lastVerifiedBy: "gh repo view microsoft/playwright-mcp",
  pushedAt: "2026-05-09T01:34:55Z",
  stargazerCount: 32366,
  isArchived: false,
  adoptionMode: "adapter_candidate",
  directCodeUse: "review_required",
  codeImportApproval: "not_requested",
  supportedPlatforms: ["windows", "macos", "linux"],
  capabilities: ["open_url", "read_screen", "click", "type_text", "browser_automation"],
  evidencePaths: [
    "README.md",
    "package.json",
    "browser automation MCP server release v0.0.75",
  ],
  primaryUse: "브라우저 자동화와 QA 수집을 ModyApprovalGate 뒤에 붙이는 후보",
  safetyNotes: [
    "Playwright MCP는 브라우저 제어 참고용이며 실제 외부 사이트 변경은 승인 후에만 실행한다.",
    "테스트/수집 세션과 사용자 업무 세션을 분리한다.",
  ],
};

export const defaultModyDesktopControlAdapterManifests = [
  openClawDesktopControlReference,
  playwrightMcpDesktopControlReference,
] as const;

export class ModyDesktopControlAdapterRegistry {
  readonly #desktopBridge: ModyDesktopBridge;
  readonly #manifests = new Map<string, ModyDesktopControlAdapterManifest>();

  constructor(options: {
    desktopBridge?: ModyDesktopBridge;
    manifests?: readonly ModyDesktopControlAdapterManifest[];
  } = {}) {
    this.#desktopBridge = options.desktopBridge ?? new ModyDesktopBridge();

    for (const manifest of options.manifests ?? defaultModyDesktopControlAdapterManifests) {
      this.#manifests.set(manifest.id, manifest);
    }
  }

  register(manifest: ModyDesktopControlAdapterManifest): ModyDesktopControlAdapterReview {
    this.#manifests.set(manifest.id, manifest);
    return this.reviewManifest(manifest);
  }

  listManifests(): ModyDesktopControlAdapterManifest[] {
    return Array.from(this.#manifests.values());
  }

  getManifest(adapterId: string): ModyDesktopControlAdapterManifest | undefined {
    return this.#manifests.get(adapterId);
  }

  reviewManifest(manifest: ModyDesktopControlAdapterManifest): ModyDesktopControlAdapterReview {
    const invalidCapabilities = manifest.capabilities.filter((capability) => !isModyDesktopCapability(capability));
    const invalidPlatforms = manifest.supportedPlatforms.filter((platform) => !isModyDesktopPlatform(platform));
    const reasons: string[] = [];

    if (manifest.isArchived) {
      reasons.push("저장소가 archived 상태입니다.");
      return blockedReview("repo_archived", manifest, reasons);
    }

    if (restrictedLicenseKeys.has(manifest.licenseKey) || !permissiveLicenseKeys.has(manifest.licenseKey)) {
      reasons.push(`ModyCrew V1에 직접 포함할 수 없는 라이선스입니다: ${manifest.licenseName}`);
      return blockedReview("license_blocked", manifest, reasons);
    }

    if (invalidCapabilities.length > 0) {
      reasons.push(`지원하지 않는 capability가 포함되어 있습니다: ${invalidCapabilities.join(", ")}`);
      return blockedReview("unsupported_capability", manifest, reasons);
    }

    if (invalidPlatforms.length > 0) {
      reasons.push(`지원하지 않는 platform이 포함되어 있습니다: ${invalidPlatforms.join(", ")}`);
      return blockedReview("unsupported_platform", manifest, reasons);
    }

    if (manifest.directCodeUse === true && manifest.codeImportApproval !== "approved") {
      reasons.push("직접 코드 사용은 라이선스/보안 승인 전에는 불가합니다.");
      return blockedReview("code_import_not_approved", manifest, reasons);
    }

    if (manifest.directCodeUse === "approved" && manifest.codeImportApproval !== "approved") {
      reasons.push("직접 코드 사용 approved 상태와 승인 기록이 일치하지 않습니다.");
      return blockedReview("code_import_not_approved", manifest, reasons);
    }

    if (!canCreateRuntimeAdapter(manifest.adoptionMode)) {
      reasons.push(`현재 도입 모드는 실행 어댑터 생성 대상이 아닙니다: ${manifest.adoptionMode}`);
      return blockedReview("code_import_not_approved", manifest, reasons);
    }

    return {
      status: "ready_for_adapter_experiment",
      allowed: true,
      riskLabel: "medium",
      manifestId: manifest.id,
      reasons: [
        "라이선스는 MIT/Apache 계열로 연구와 어댑터 실험이 가능합니다.",
        "직접 코드 포함은 review_required 경계에 묶여 있습니다.",
        "실행 요청은 ModyDesktopBridge와 ModyApprovalGate를 통과합니다.",
      ],
      userMessage: "오픈소스 참고 데이터를 ModyCrew 어댑터 실험에 사용할 수 있습니다.",
    };
  }

  createActionRequest(adapterId: string, input: ModyDesktopControlActionInput): ModyDesktopControlActionResult {
    const manifest = this.#manifests.get(adapterId);
    if (!manifest) {
      return {
        status: "adapter_not_found",
        userMessage: `등록되지 않은 데스크톱 제어 어댑터입니다: ${adapterId}`,
      };
    }

    const review = this.reviewManifest(manifest);
    if (!review.allowed) {
      return {
        status: review.status,
        review,
        userMessage: review.userMessage,
      };
    }

    if (!manifest.capabilities.includes(input.capability)) {
      return {
        status: "capability_not_declared",
        review,
        userMessage: `${manifest.name} manifest가 허용하지 않은 capability입니다: ${input.capability}`,
      };
    }

    if (!manifest.supportedPlatforms.includes(input.platform)) {
      return {
        status: "platform_not_supported",
        review,
        userMessage: `${manifest.name} manifest가 지원하지 않는 platform입니다: ${input.platform}`,
      };
    }

    const request = this.#desktopBridge.createActionRequest(input);
    const adapterMetadata = desktopControlAdapterMetadata(manifest);

    return {
      status: "created",
      review,
      request: {
        ...request,
        sourceAdapterId: `desktop-control:${manifest.id}`,
        metadata: {
          ...(request.metadata ?? {}),
          desktopControlAdapter: adapterMetadata,
        },
      },
      userMessage: "데스크톱 제어 요청을 생성했습니다. 실행 가능 여부는 승인 게이트에서 다시 판단합니다.",
    };
  }
}

function blockedReview(
  status: Exclude<ModyDesktopControlAdapterReviewStatus, "ready_for_adapter_experiment">,
  manifest: ModyDesktopControlAdapterManifest,
  reasons: string[],
): ModyDesktopControlAdapterReview {
  return {
    status,
    allowed: false,
    riskLabel: status === "license_blocked" || status === "code_import_not_approved" ? "blocked" : "high",
    manifestId: manifest.id,
    reasons,
    userMessage: reasons[0] ?? "데스크톱 제어 어댑터를 사용할 수 없습니다.",
  };
}

function canCreateRuntimeAdapter(adoptionMode: ModyDesktopControlAdapterAdoptionMode): boolean {
  return adoptionMode === "reference_and_adapter" || adoptionMode === "adapter_candidate";
}

function desktopControlAdapterMetadata(manifest: ModyDesktopControlAdapterManifest): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    adapterId: manifest.id,
    sourceKind: manifest.sourceKind,
    licenseKey: manifest.licenseKey,
    adoptionMode: manifest.adoptionMode,
    directCodeUse: manifest.directCodeUse,
    codeImportApproval: manifest.codeImportApproval,
    lastVerified: manifest.lastVerified,
    evidencePaths: manifest.evidencePaths,
  };

  if (manifest.sourceRepo) metadata.sourceRepo = manifest.sourceRepo;
  if (manifest.sourceUrl) metadata.sourceUrl = manifest.sourceUrl;
  if (manifest.latestRelease) metadata.latestRelease = manifest.latestRelease;
  if (manifest.pushedAt) metadata.pushedAt = manifest.pushedAt;

  return metadata;
}
