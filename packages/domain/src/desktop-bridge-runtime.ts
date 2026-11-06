import { ModyApprovalGate } from "./approval-gate.js";
import { ModyDesktopBridgeIpcGuard } from "./desktop-bridge-ipc.js";
import {
  isModyDesktopCapability,
  isModyDesktopPlatform,
} from "./desktop-bridge.js";
import type {
  ModyDesktopActionMetadata,
  ModyDesktopCapability,
  ModyDesktopPlatform,
} from "./desktop-bridge.js";
import type {
  ModyDesktopBridgeIpcDecision,
  ModyDesktopBridgeIpcPeer,
} from "./desktop-bridge-ipc.js";
import type {
  ApprovalRecord,
  ApprovalGateResult,
  ISODateTimeString,
  ToolActionRequest,
  ToolOperationKind,
  ToolPermissionLevel,
} from "./types.js";

export const modyDesktopBridgeProtocolVersion = "mody.desktop-bridge.v1" as const;
export type ModyDesktopBridgeProtocolVersion = typeof modyDesktopBridgeProtocolVersion;

export type ModyDesktopBridgeHealthStatus =
  | "not_installed"
  | "running"
  | "disconnected"
  | "permission_required";

export type ModyDesktopBridgeHealth = {
  bridgeId: string;
  platform: ModyDesktopPlatform;
  status: ModyDesktopBridgeHealthStatus;
  version?: string;
  capabilities: ModyDesktopCapability[];
  grantedCapabilities: ModyDesktopCapability[];
  lastHeartbeatAt?: ISODateTimeString;
  userMessage: string;
};

export type ModyDesktopBridgeCommandTarget = {
  app?: string;
  path?: string;
  url?: string;
};

export type ModyDesktopBridgeCommandIpc = {
  origin: string;
  channel: string;
  transport: ModyDesktopBridgeIpcPeer["transport"];
  peerId?: string;
};

export type ModyDesktopBridgeCommand = {
  id: string;
  requestId: string;
  protocolVersion: ModyDesktopBridgeProtocolVersion;
  command: ModyDesktopCapability;
  platform: ModyDesktopPlatform;
  permissionLevel: ToolPermissionLevel;
  operationKind: ToolOperationKind;
  target: ModyDesktopBridgeCommandTarget;
  requiresApproval: boolean;
  externalMutation: boolean;
  userVisibleDescription: string;
  expectedImpact: string;
  createdAt: ISODateTimeString;
  ipc?: ModyDesktopBridgeCommandIpc;
};

export type ModyDesktopBridgeDispatchStatus =
  | "queued"
  | "needs_approval"
  | "blocked"
  | "ipc_rejected"
  | "bridge_unavailable"
  | "capability_missing"
  | "invalid_request"
  | "not_desktop_request";

export type ModyDesktopBridgeDispatchResult = {
  request: ToolActionRequest;
  bridge: ModyDesktopBridgeHealth;
  gate: ApprovalGateResult;
  status: ModyDesktopBridgeDispatchStatus;
  command?: ModyDesktopBridgeCommand;
  ipc?: ModyDesktopBridgeIpcDecision;
  userMessage: string;
};

export type ModyDesktopBridgeRuntimeOptions = {
  gate?: ModyApprovalGate;
  ipcGuard?: ModyDesktopBridgeIpcGuard;
  requireIpcPeer?: boolean;
};

export type ModyDesktopBridgePrepareOptions = {
  ipcPeer?: ModyDesktopBridgeIpcPeer;
};

export class ModyDesktopBridgeRuntime {
  readonly #gate: ModyApprovalGate;
  readonly #ipcGuard: ModyDesktopBridgeIpcGuard;
  readonly #requireIpcPeer: boolean;

  constructor(options: ModyApprovalGate | ModyDesktopBridgeRuntimeOptions = {}) {
    if (options instanceof ModyApprovalGate) {
      this.#gate = options;
      this.#ipcGuard = new ModyDesktopBridgeIpcGuard();
      this.#requireIpcPeer = false;
      return;
    }

    this.#gate = options.gate ?? new ModyApprovalGate();
    this.#ipcGuard = options.ipcGuard ?? new ModyDesktopBridgeIpcGuard();
    this.#requireIpcPeer = options.requireIpcPeer ?? false;
  }

  prepareCommand(
    request: ToolActionRequest,
    bridge: ModyDesktopBridgeHealth,
    approval?: ApprovalRecord,
    options: ModyDesktopBridgePrepareOptions = {},
  ): ModyDesktopBridgeDispatchResult {
    const gate = this.#gate.evaluate(request, approval);
    const desktopRequest = parseDesktopRequest(request);

    if (desktopRequest === "invalid") {
      return {
        request,
        bridge,
        gate,
        status: "invalid_request",
        userMessage: "데스크톱 브리지 요청 메타데이터가 유효하지 않습니다.",
      };
    }

    if (!desktopRequest) {
      return {
        request,
        bridge,
        gate,
        status: "not_desktop_request",
        userMessage: "데스크톱 브리지 요청이 아닙니다.",
      };
    }

    if (this.#requireIpcPeer || options.ipcPeer) {
      const ipc = this.#ipcGuard.evaluate(options.ipcPeer);
      if (ipc.status !== "allowed") {
        return {
          request,
          bridge,
          gate,
          ipc,
          status: "ipc_rejected",
          userMessage: ipc.userMessage,
        };
      }
    }

    if (bridge.status !== "running") {
      return {
        request,
        bridge,
        gate,
        status: "bridge_unavailable",
        userMessage: bridge.userMessage,
      };
    }

    if (!bridge.capabilities.includes(desktopRequest.command)) {
      return {
        request,
        bridge,
        gate,
        status: "capability_missing",
        userMessage: `${desktopRequest.command} 명령은 이 브리지에서 지원하지 않습니다.`,
      };
    }

    if (!bridge.grantedCapabilities.includes(desktopRequest.command)) {
      return {
        request,
        bridge,
        gate,
        status: "capability_missing",
        userMessage: `${desktopRequest.command} 명령 권한이 아직 허용되지 않았습니다.`,
      };
    }

    if (gate.status === "blocked") {
      return {
        request,
        bridge,
        gate,
        status: "blocked",
        userMessage: gate.userMessage,
      };
    }

    if (!gate.canRunTool) {
      return {
        request,
        bridge,
        gate,
        status: "needs_approval",
        userMessage: gate.userMessage,
      };
    }

    const commandInput: ModyDesktopBridgeCommand = {
      id: `bridge_cmd_${request.id}`,
      requestId: request.id,
      protocolVersion: modyDesktopBridgeProtocolVersion,
      command: desktopRequest.command,
      platform: desktopRequest.platform,
      permissionLevel: request.permissionLevel,
      operationKind: request.operationKind,
      target: desktopRequest.target,
      requiresApproval: request.requiresApproval,
      externalMutation: request.externalMutation,
      userVisibleDescription: request.userVisibleDescription,
      expectedImpact: request.expectedImpact,
      createdAt: request.createdAt,
    };

    if (options.ipcPeer) {
      const ipcInput: ModyDesktopBridgeCommandIpc = {
        origin: options.ipcPeer.origin,
        channel: options.ipcPeer.channel,
        transport: options.ipcPeer.transport,
      };
      if (options.ipcPeer.peerId) {
        ipcInput.peerId = options.ipcPeer.peerId;
      }
      commandInput.ipc = ipcInput;
    }

    return {
      request,
      bridge,
      gate,
      status: "queued",
      command: commandInput,
      userMessage: "데스크톱 브리지 명령 대기열에 추가할 수 있습니다.",
    };
  }
}

type ParsedDesktopRequest = {
  command: ModyDesktopCapability;
  platform: ModyDesktopPlatform;
  target: ModyDesktopBridgeCommandTarget;
};

function parseDesktopRequest(request: ToolActionRequest): ParsedDesktopRequest | "invalid" | undefined {
  if (!request.toolName.startsWith("mody.desktop.")) return undefined;

  const commandText = request.toolName.replace("mody.desktop.", "");
  if (!isModyDesktopCapability(commandText)) return "invalid";

  const command = commandText;
  const metadataRequest = parseDesktopMetadata(request.metadata?.desktop, command);
  if (metadataRequest) return metadataRequest;

  const metadata = parseInputSummary(request.inputSummary);
  const platform = parsePlatform(metadata.platform);
  const target: ModyDesktopBridgeCommandTarget = {};

  if (metadata.app) target.app = metadata.app;
  if (metadata.path) target.path = metadata.path;
  if (metadata.url) target.url = metadata.url;

  return {
    command,
    platform,
    target,
  };
}

function parseDesktopMetadata(
  value: unknown,
  expectedCommand: ModyDesktopCapability,
): ParsedDesktopRequest | "invalid" | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return "invalid";

  const platform = value.platform;
  const capability = value.capability;
  const target = value.target;
  if (!isModyDesktopPlatform(platform)) return "invalid";
  if (capability !== expectedCommand) return "invalid";
  if (!isModyDesktopCapability(capability)) return "invalid";
  if (!isRecord(target)) return "invalid";

  const parsedTarget: ModyDesktopActionMetadata["target"] = {};
  if (target.app !== undefined) {
    if (typeof target.app !== "string") return "invalid";
    parsedTarget.app = target.app;
  }
  if (target.path !== undefined) {
    if (typeof target.path !== "string") return "invalid";
    parsedTarget.path = target.path;
  }
  if (target.url !== undefined) {
    if (typeof target.url !== "string") return "invalid";
    parsedTarget.url = target.url;
  }

  return {
    command: capability,
    platform,
    target: parsedTarget,
  };
}

function parseInputSummary(inputSummary: string): Record<string, string> {
  const metadata: Record<string, string> = {};

  for (const part of inputSummary.split(";")) {
    const trimmed = part.trim();
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && value) metadata[key] = value;
  }

  return metadata;
}

function parsePlatform(value: string | undefined): ModyDesktopPlatform {
  if (value === "macos" || value === "linux") return value;
  return "windows";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
