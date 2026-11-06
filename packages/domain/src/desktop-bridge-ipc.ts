export type ModyDesktopBridgeIpcTransport =
  | "electron_ipc"
  | "named_pipe"
  | "unix_socket"
  | "loopback_http"
  | "local_websocket";

export type ModyDesktopBridgeIpcPeer = {
  origin: string;
  channel: string;
  transport: ModyDesktopBridgeIpcTransport;
  peerId?: string;
  appSignature?: string;
};

export type ModyDesktopBridgeIpcPolicy = {
  allowedOrigins: string[];
  allowedChannels: string[];
  allowedTransports: ModyDesktopBridgeIpcTransport[];
  requiredAppSignature?: string;
  requireSignedPeer: boolean;
};

export type ModyDesktopBridgeIpcDecisionStatus =
  | "allowed"
  | "missing_peer"
  | "origin_not_allowed"
  | "channel_not_allowed"
  | "transport_not_allowed"
  | "signature_required";

export type ModyDesktopBridgeIpcDecision = {
  status: ModyDesktopBridgeIpcDecisionStatus;
  peer?: ModyDesktopBridgeIpcPeer;
  userMessage: string;
};

export const defaultModyDesktopBridgeIpcPolicy: ModyDesktopBridgeIpcPolicy = {
  allowedOrigins: [
    "app://modycrew-desktop",
    "modycrew://desktop",
    "http://127.0.0.1",
  ],
  allowedChannels: [
    "mody.desktop-bridge.v1",
  ],
  allowedTransports: [
    "electron_ipc",
    "named_pipe",
    "unix_socket",
    "loopback_http",
    "local_websocket",
  ],
  requireSignedPeer: false,
};

export class ModyDesktopBridgeIpcGuard {
  readonly #policy: ModyDesktopBridgeIpcPolicy;

  constructor(policy: Partial<ModyDesktopBridgeIpcPolicy> = {}) {
    this.#policy = normalizePolicy(policy);
  }

  evaluate(peer?: ModyDesktopBridgeIpcPeer): ModyDesktopBridgeIpcDecision {
    if (!peer) {
      return {
        status: "missing_peer",
        userMessage: "데스크톱 브리지 IPC peer 정보가 없어 명령을 보낼 수 없습니다.",
      };
    }

    if (!this.#policy.allowedOrigins.includes(peer.origin)) {
      return {
        status: "origin_not_allowed",
        peer,
        userMessage: "허용되지 않은 IPC origin의 브리지 요청입니다.",
      };
    }

    if (!this.#policy.allowedChannels.includes(peer.channel)) {
      return {
        status: "channel_not_allowed",
        peer,
        userMessage: "허용되지 않은 IPC channel의 브리지 요청입니다.",
      };
    }

    if (!this.#policy.allowedTransports.includes(peer.transport)) {
      return {
        status: "transport_not_allowed",
        peer,
        userMessage: "허용되지 않은 IPC transport의 브리지 요청입니다.",
      };
    }

    if (this.#policy.requireSignedPeer && peer.appSignature !== this.#policy.requiredAppSignature) {
      return {
        status: "signature_required",
        peer,
        userMessage: "브리지 peer 서명이 일치하지 않아 명령을 보낼 수 없습니다.",
      };
    }

    return {
      status: "allowed",
      peer,
      userMessage: "허용된 IPC origin과 channel입니다.",
    };
  }
}

function normalizePolicy(policy: Partial<ModyDesktopBridgeIpcPolicy>): ModyDesktopBridgeIpcPolicy {
  const normalized: ModyDesktopBridgeIpcPolicy = {
    allowedOrigins: policy.allowedOrigins ?? defaultModyDesktopBridgeIpcPolicy.allowedOrigins,
    allowedChannels: policy.allowedChannels ?? defaultModyDesktopBridgeIpcPolicy.allowedChannels,
    allowedTransports: policy.allowedTransports ?? defaultModyDesktopBridgeIpcPolicy.allowedTransports,
    requireSignedPeer: policy.requireSignedPeer ?? defaultModyDesktopBridgeIpcPolicy.requireSignedPeer,
  };

  if (policy.requiredAppSignature) {
    normalized.requiredAppSignature = policy.requiredAppSignature;
  }

  return normalized;
}
