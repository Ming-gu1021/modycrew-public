"use client";

import { useEffect, useRef } from "react";
import {
  completeRelayRequest,
  failRelayRequest,
  markRelayRequestRunning,
  subscribeRelayRequestsForDevice,
  type ModyAccountRelayRequest,
} from "@/lib/account-device-relay";
import { getCurrentDeviceProfile, registerCurrentDevice } from "@/lib/account-device-sync";
import { createDesktopBridge } from "@/lib/desktop-bridge";
import { classifyRelayExecution } from "@/lib/relay-execution-result";
import { onAuthSession, type ModyAuthSession } from "@/lib/firebase-client";

const HEARTBEAT_INTERVAL_MS = 60_000;

type RelayAgentSessionBridge = ReturnType<typeof createDesktopBridge> & {
  runAgentSession?: (input: {
    mode: ModyAccountRelayRequest["mode"];
    text: string;
  }) => Promise<{
    status?: string;
    session?: {
      id?: string;
      status?: string;
      finishedAt?: string;
      approvalQueueCount?: number;
      createdWorkItemIds?: string[];
      outputSummary?: string;
    };
    userMessage?: string;
  }>;
};

export function AccountDeviceHeartbeat() {
  const processingRelayIdsRef = useRef(new Set<string>());

  useEffect(() => {
    let authUnsubscribe: (() => void) | undefined;
    let relayUnsubscribe: (() => void) | undefined;
    let heartbeatTimer: number | undefined;
    let mounted = true;
    let authGeneration = 0;

    void onAuthSession((session) => {
      authGeneration += 1;
      const generation = authGeneration;
      relayUnsubscribe?.();
      relayUnsubscribe = undefined;
      if (heartbeatTimer) window.clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;

      if (!session) return;

      const runHeartbeat = () => {
        void registerCurrentDevice(session).catch((error) => {
          console.warn(`[modycrew] 계정 기기 하트비트 실패: ${String(error?.message ?? error)}`);
        });
      };

      runHeartbeat();
      heartbeatTimer = window.setInterval(runHeartbeat, HEARTBEAT_INTERVAL_MS);

      const currentDevice = getCurrentDeviceProfile();
      if (currentDevice.kind !== "desktop_app") return;

      void subscribeRelayRequestsForDevice(
        session,
        currentDevice.id,
        (requests) => {
          requests.forEach((request) => {
            void processRelayRequest(session, request);
          });
        },
        (error) => {
          console.warn(`[modycrew] 원격 실행 요청 구독 실패: ${error.message}`);
        },
      ).then((unsubscribe) => {
        if (mounted && generation === authGeneration) relayUnsubscribe = unsubscribe;
        else unsubscribe();
      });
    }).then((unsubscribe) => {
      authUnsubscribe = unsubscribe;
    });

    return () => {
      mounted = false;
      authUnsubscribe?.();
      relayUnsubscribe?.();
      if (heartbeatTimer) window.clearInterval(heartbeatTimer);
    };
  }, []);

  return null;

  async function processRelayRequest(
    session: ModyAuthSession,
    request: ModyAccountRelayRequest,
  ): Promise<void> {
    if (processingRelayIdsRef.current.has(request.id)) return;
    processingRelayIdsRef.current.add(request.id);

    try {
      await markRelayRequestRunning(session, request.id);
      const bridge = createDesktopBridge() as RelayAgentSessionBridge;
      if (!bridge.runAgentSession) {
        throw new Error("이 데스크톱 앱은 아직 계정 릴레이 실행 런타임을 지원하지 않습니다.");
      }
      const result = await bridge.runAgentSession({
        mode: request.mode,
        text: request.text,
      });
      const outcome = classifyRelayExecution(request.mode, result);
      if (outcome.status === "failed") {
        await failRelayRequest(session, request.id, new Error(outcome.summary));
        return;
      }
      await completeRelayRequest(session, request.id, {
        status: outcome.status,
        sessionId: result.session?.id,
        resultWorkItemIds: result.session?.createdWorkItemIds ?? [],
        resultSummary: outcome.summary,
      });
    } catch (error) {
      try {
        await failRelayRequest(session, request.id, error);
      } catch {
        console.warn("[modycrew] 원격 실행 실패 상태를 계정에 저장하지 못했습니다.");
      }
    } finally {
      processingRelayIdsRef.current.delete(request.id);
    }
  }
}
