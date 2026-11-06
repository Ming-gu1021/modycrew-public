"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createRelayRequest,
  saveRelayPreferences,
  subscribeRecentRelayRequests,
  subscribeRelayPreferences,
  type ModyAccountRelayRequest,
  type ModyRelayPreferences,
  type ModyRelayRequestMode,
} from "@/lib/account-device-relay";
import {
  getCurrentDeviceProfile,
  publishWorkspaceSyncSnapshot,
  registerCurrentDevice,
  subscribeAccountDevices,
  subscribeWorkspaceSyncSnapshot,
  type ModyAccountDevice,
  type ModyWorkspaceSyncSnapshot,
} from "@/lib/account-device-sync";
import { createDesktopBridge } from "@/lib/desktop-bridge";
import { applyFeatureActivationRecords, readFeatureActivationRecords } from "@/lib/feature-activation";
import { onAuthSession, type ModyAuthSession } from "@/lib/firebase-client";
import styles from "./AccountCard.module.css";

type SyncConnectorStatus = {
  connectorId: string;
  method: string;
  category?: string;
  status: string;
  lastCheckedAt?: string;
  secretFingerprint?: string;
};

type SyncTriggerRule = {
  id: string;
  label: string;
  connectorId: string;
  mode: string;
  enabled: boolean;
  cadenceMinutes: number;
};

type DeviceSyncBridge = ReturnType<typeof createDesktopBridge> & {
  listConnectorStatuses?: () => Promise<{ connectors: SyncConnectorStatus[] }>;
  getTriggerSettings?: () => Promise<{ rules: SyncTriggerRule[] }>;
};

export function DeviceSyncCard() {
  const [session, setSession] = useState<ModyAuthSession | null>(null);
  const [currentDevice, setCurrentDevice] = useState(() => getCurrentDeviceProfile());
  const [devices, setDevices] = useState<ModyAccountDevice[]>([]);
  const [snapshot, setSnapshot] = useState<ModyWorkspaceSyncSnapshot | null>(null);
  const [relayRequests, setRelayRequests] = useState<ModyAccountRelayRequest[]>([]);
  const [relayPreferences, setRelayPreferences] = useState<ModyRelayPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [relayBusyId, setRelayBusyId] = useState("");
  const [relayWorkText, setRelayWorkText] = useState("");
  const [message, setMessage] = useState("");
  const relayInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let authUnsubscribe: (() => void) | undefined;
    let devicesUnsubscribe: (() => void) | undefined;
    let snapshotUnsubscribe: (() => void) | undefined;
    let relayRecentUnsubscribe: (() => void) | undefined;
    let relayPreferencesUnsubscribe: (() => void) | undefined;
    let mounted = true;
    let authGeneration = 0;

    void onAuthSession((nextSession) => {
      authGeneration += 1;
      const generation = authGeneration;
      setSession(nextSession);
      setMessage("");
      setRelayRequests([]);
      devicesUnsubscribe?.();
      snapshotUnsubscribe?.();
      relayRecentUnsubscribe?.();
      relayPreferencesUnsubscribe?.();
      devicesUnsubscribe = undefined;
      snapshotUnsubscribe = undefined;
      relayRecentUnsubscribe = undefined;
      relayPreferencesUnsubscribe = undefined;

      if (!nextSession) return;

      void registerCurrentDevice(nextSession)
        .then((device) => {
          if (!mounted || generation !== authGeneration) return;
          setCurrentDevice(device);
        })
        .catch((error) => {
          if (mounted) setMessage(error instanceof Error ? error.message : "기기 등록 실패");
        });

      void subscribeAccountDevices(
        nextSession,
        (nextDevices) => {
          if (mounted) setDevices(nextDevices);
        },
        (error) => {
          if (mounted) setMessage(error.message);
        },
      ).then((unsubscribe) => {
        devicesUnsubscribe = unsubscribe;
      });

      void subscribeRecentRelayRequests(
        nextSession,
        (requests) => {
          if (mounted) setRelayRequests(requests);
        },
        (error) => {
          if (mounted) setMessage(error.message);
        },
      ).then((unsubscribe) => {
        relayRecentUnsubscribe = unsubscribe;
      });

      void subscribeRelayPreferences(
        nextSession,
        (preferences) => {
          if (mounted) setRelayPreferences(preferences);
        },
        (error) => {
          if (mounted) setMessage(error.message);
        },
      ).then((unsubscribe) => {
        relayPreferencesUnsubscribe = unsubscribe;
      });

      void subscribeWorkspaceSyncSnapshot(
        nextSession,
        (nextSnapshot) => {
          if (!mounted) return;
          setSnapshot(nextSnapshot);
          if (
            nextSnapshot?.featureActivationRecords.length &&
            nextSnapshot.sourceDeviceId !== getCurrentDeviceProfile().id
          ) {
            applyFeatureActivationRecords(nextSnapshot.featureActivationRecords);
            setMessage("계정 작업환경의 기능 스위치 상태를 이 기기에 적용했습니다.");
          }
        },
        (error) => {
          if (mounted) setMessage(error.message);
        },
      ).then((unsubscribe) => {
        snapshotUnsubscribe = unsubscribe;
      });
    }).then((unsubscribe) => {
      authUnsubscribe = unsubscribe;
    });

    return () => {
      mounted = false;
      authUnsubscribe?.();
      devicesUnsubscribe?.();
      snapshotUnsubscribe?.();
      relayRecentUnsubscribe?.();
      relayPreferencesUnsubscribe?.();
    };
  }, []);

  const onlineDevices = useMemo(() => {
    const cutoff = Date.now() - 10 * 60_000;
    return devices.filter((device) => device.lastSeenAtEpochMs >= cutoff);
  }, [devices]);
  const syncProgress = Math.min(
    100,
    Math.round(((session ? 1 : 0) + (snapshot ? 1 : 0) + (onlineDevices.length > 0 ? 1 : 0)) / 3 * 100),
  );

  const onlineDesktopDevices = useMemo(
    () =>
      onlineDevices.filter(
        (device) => device.kind === "desktop_app" && device.id !== currentDevice.id,
      ),
    [currentDevice.id, onlineDevices],
  );
  const preferredDesktopDevice = useMemo(
    () =>
      onlineDesktopDevices.find((device) => device.id === relayPreferences?.defaultDesktopDeviceId) ??
      onlineDesktopDevices[0] ??
      null,
    [onlineDesktopDevices, relayPreferences?.defaultDesktopDeviceId],
  );
  const orderedDesktopDevices = useMemo(() => {
    if (!preferredDesktopDevice) return onlineDesktopDevices;
    return [
      preferredDesktopDevice,
      ...onlineDesktopDevices.filter((device) => device.id !== preferredDesktopDevice.id),
    ];
  }, [onlineDesktopDevices, preferredDesktopDevice]);

  const handleSaveRelayPreference = async (targetDevice: ModyAccountDevice) => {
    if (!session) {
      setMessage("먼저 로그인하면 기본 실행 PC를 저장할 수 있습니다.");
      return;
    }

    setRelayBusyId(`${targetDevice.id}:set-default`);
    setMessage(`${targetDevice.label}을 기본 실행 PC로 저장하는 중...`);

    try {
      const preferences = await saveRelayPreferences(session, targetDevice);
      setRelayPreferences(preferences);
      setMessage("기본 실행 PC를 저장했습니다. 다음부터는 노트북에서 바로 이 데스크톱에 맡길 수 있습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "기본 실행 PC 저장에 실패했습니다.");
    } finally {
      setRelayBusyId("");
    }
  };

  const handleCreateRelayRequest = async (
    targetDevice: ModyAccountDevice,
    mode: ModyRelayRequestMode,
    text?: string,
  ) => {
    if (!session) {
      setMessage("먼저 로그인하면 켜져 있는 데스크톱에 작업을 맡길 수 있습니다.");
      return;
    }

    const requestText = text?.trim() || getRelayRequestText(mode);
    if (mode === "work_intake" && requestText.length < 8) {
      setMessage("데스크톱에 맡길 업무 내용을 8자 이상 입력해 주세요.");
      relayInputRef.current?.focus();
      return;
    }

    const busyId = `${targetDevice.id}:${mode}`;
    setRelayBusyId(busyId);
    setMessage(`${targetDevice.label}에 원격 실행 요청을 보내는 중...`);

    try {
      await createRelayRequest(session, targetDevice, {
        mode,
        text: requestText,
      });
      if (mode === "work_intake") setRelayWorkText("");
      setMessage("요청 완료 - 데스크톱 앱이 켜져 있으면 자동으로 받아 실행합니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "원격 실행 요청에 실패했습니다.");
    } finally {
      setRelayBusyId("");
    }
  };

  const handlePublish = async () => {
    if (!session) {
      setMessage("먼저 로그인하면 이 PC 설정을 계정에 저장할 수 있습니다.");
      return;
    }

    setBusy(true);
    setMessage("이 PC 설정을 계정 작업환경으로 저장 중...");

    try {
      const bridge = createDesktopBridge() as DeviceSyncBridge;
      const [connectorResult, triggerResult] = await Promise.all([
        bridge.listConnectorStatuses?.() ?? Promise.resolve({ connectors: [] }),
        bridge.getTriggerSettings?.() ?? Promise.resolve({ rules: [] }),
      ]);
      const nextSnapshot = await publishWorkspaceSyncSnapshot(session, {
        connectorSummaries: connectorResult.connectors.map((connector) => ({
          connectorId: connector.connectorId,
          method: connector.method,
          category: connector.category,
          status: connector.status,
          lastCheckedAt: connector.lastCheckedAt,
          secretFingerprint: connector.secretFingerprint,
        })),
        triggerRules: triggerResult.rules.map((rule) => ({
          id: rule.id,
          label: rule.label,
          connectorId: rule.connectorId,
          mode: rule.mode,
          enabled: rule.enabled,
          cadenceMinutes: rule.cadenceMinutes,
        })),
        featureActivationRecords: readFeatureActivationRecords(),
        syncNote: bridge.isAvailable
          ? "설치된 데스크톱 앱의 연결 상태, 반복 업무, 기능 스위치를 계정 작업환경으로 저장했습니다."
          : "브라우저에서 볼 수 있는 작업환경과 기능 스위치만 저장했습니다. 실제 PC 연결은 데스크톱 앱에서 저장하세요.",
      });
      setSnapshot(nextSnapshot);
      setMessage(
        bridge.isAvailable
          ? "동기화 완료 - 다른 PC에서 로그인하면 이 환경을 기준으로 시작합니다."
          : "계정 스냅샷 저장 완료 - 실제 연결값은 데스크톱 앱에서 다시 확인합니다.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "작업환경 저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={styles.card}>
      <header className={styles.head}>
        <h2>기기 동기화</h2>
      </header>

      {!session ? (
        <p className={styles.warning}>로그인하면 이 기기를 계정에 등록하고 작업환경 동기화를 시작합니다.</p>
      ) : (
        <>
          <button
            type="button"
            className={styles.primary}
            onClick={handlePublish}
            disabled={busy}
          >
            {busy ? "저장 중..." : "이 PC 설정을 계정에 저장"}
          </button>

          <details className={styles.advancedBox} data-device-sync-details-default="closed">
            <summary>동기화 상태와 기기</summary>
            <section className={styles.syncProgressCard} aria-label={`기기 동기화 진행률 ${syncProgress}%`}>
            <div>
              <strong>{syncProgress}%</strong>
              <span>{onlineDevices.length}대 확인 · {snapshot ? "작업환경 있음" : "저장 전"}</span>
            </div>
            <i style={{ width: `${syncProgress}%` }} />
          </section>

          <section className={styles.syncSummary} aria-label="현재 기기">
            <div>
              <span>현재 기기</span>
              <strong>{currentDevice.label}</strong>
              <small>{currentDevice.kind === "desktop_app" ? "설치 앱" : "웹/브라우저"}</small>
            </div>
            <div>
              <span>켜져 있는 기기</span>
              <strong>{onlineDevices.length}대</strong>
              <small>최근 10분 기준</small>
            </div>
          </section>

          <ul className={styles.syncScopeList} aria-label="동기화 범위">
            <li>
              <strong>동기화</strong>
              <span>연결 상태, 반복 업무, 기능 스위치</span>
            </li>
            <li>
              <strong>제외</strong>
              <span>비밀번호, 연결 보안값, 원문 메일/파일 내용</span>
            </li>
          </ul>

          {snapshot ? (
            <details className={styles.advancedBox}>
              <summary>계정 작업환경</summary>
              <section className={styles.syncSnapshot} aria-label="계정 작업환경">
                <div>
                  <span>계정 작업환경</span>
                  <strong>{snapshot.sourceDeviceLabel}</strong>
                  <small>{formatTime(snapshot.updatedAtEpochMs)} 저장</small>
                </div>
                <dl>
                  <div>
                    <dt>연결</dt>
                    <dd>{snapshot.connectorSummaries.length}개</dd>
                  </div>
                  <div>
                    <dt>자동화</dt>
                    <dd>{snapshot.triggerRules.filter((rule) => rule.enabled).length}개 켜짐</dd>
                  </div>
                  <div>
                    <dt>기능</dt>
                    <dd>
                      {snapshot.featureActivationRecords.filter((record) => record.status === "active").length}
                      개 켜짐
                    </dd>
                  </div>
                </dl>
                <p>{snapshot.syncNote}</p>
              </section>
            </details>
          ) : (
            <p className={styles.status}>
              아직 계정 작업환경이 없습니다. 데스크톱에서 연결을 마친 뒤 한 번 저장하면 다른 PC가
              따라옵니다.
            </p>
          )}

          <details className={styles.advancedBox}>
            <summary>다른 PC에 맡기기</summary>
            <section className={styles.relayBox} aria-label="원격 실행 릴레이">
              <div className={styles.relayHead}>
                <div>
                  <span>원격 실행</span>
                  <strong>
                    {currentDevice.kind === "desktop_app"
                      ? "이 PC가 요청을 받을 수 있습니다"
                      : "켜진 데스크톱에 맡기기"}
                  </strong>
                </div>
                <small>같은 계정 안에서만 작동 · 비밀값 저장 없음</small>
              </div>

            {currentDevice.kind === "desktop_app" ? (
              <p className={styles.relayNote}>
                이 데스크톱 앱이 켜져 있으면 노트북이나 웹에서 보낸 연결 확인, 자동 점검 요청을
                받아 처리합니다.
              </p>
            ) : onlineDesktopDevices.length ? (
              <div className={styles.relayActions}>
                {preferredDesktopDevice ? (
                  <div className={styles.preferredRelayTarget}>
                    <span>기본 실행 PC</span>
                    <strong>{preferredDesktopDevice.label}</strong>
                    <small>
                      {relayPreferences?.updatedAtEpochMs
                        ? `${formatTime(relayPreferences.updatedAtEpochMs)} 저장`
                        : "방금 선택됨"}
                    </small>
                  </div>
                ) : null}
                {orderedDesktopDevices.slice(0, 3).map((device) => {
                  const isPreferred = device.id === preferredDesktopDevice?.id;
                  return (
                  <div key={device.id} className={styles.relayTarget}>
                    <div className={styles.relayTargetHeader}>
                      <strong>{device.label}</strong>
                      {isPreferred ? <span>기본</span> : null}
                    </div>
                    <div>
                      <button
                        type="button"
                        className={styles.secondary}
                        onClick={() => handleCreateRelayRequest(device, "connectivity_audit")}
                        disabled={relayBusyId === `${device.id}:connectivity_audit`}
                      >
                        연결 진단
                      </button>
                      <button
                        type="button"
                        className={styles.secondary}
                        onClick={() => handleCreateRelayRequest(device, "trigger_check")}
                        disabled={relayBusyId === `${device.id}:trigger_check`}
                      >
                        자동화 실행
                      </button>
                    </div>
                    {!isPreferred ? (
                      <button
                        type="button"
                        className={styles.secondary}
                        onClick={() => handleSaveRelayPreference(device)}
                        disabled={relayBusyId === `${device.id}:set-default`}
                      >
                        기본 실행 PC로 저장
                      </button>
                    ) : null}
                    <label className={styles.relayComposer}>
                      <span>데스크톱에 업무 맡기기</span>
                      <textarea
                        id={`relay-work-text-${device.id}`}
                        name={`relayWorkText-${device.id}`}
                        ref={relayInputRef}
                        value={relayWorkText}
                        onChange={(event) => setRelayWorkText(event.target.value)}
                        placeholder="예: 데스크톱에 연결된 메일/문의함을 확인하고 오늘 처리할 답장 초안을 만들어줘."
                        rows={3}
                      />
                      <button
                        type="button"
                        className={styles.primary}
                        onClick={() => handleCreateRelayRequest(device, "work_intake", relayWorkText)}
                        disabled={relayBusyId === `${device.id}:work_intake`}
                      >
                        업무 맡기기
                      </button>
                    </label>
                  </div>
                  );
                })}
              </div>
            ) : (
              <p className={styles.relayNote}>
                같은 계정으로 로그인한 데스크톱 앱이 켜지면 여기서 바로 작업을 맡길 수 있습니다.
              </p>
            )}

            {relayRequests.length ? (
              <div className={styles.relayList}>
                {relayRequests.map((request) => (
                  <div key={request.id} className={styles.relayItem}>
                    <div>
                      <strong>{getRelayModeLabel(request.mode)}</strong>
                      <small>
                        {request.requesterDeviceLabel} → {request.targetDeviceLabel}
                      </small>
                    </div>
                    <span className={getRelayStatusClass(request.status)}>
                      {getRelayStatusLabel(request.status)}
                    </span>
                    <p>
                      {request.errorMessage ??
                        request.resultSummary ??
                        request.text}
                    </p>
                    {request.resultDeepLink ? (
                      <a href={request.resultDeepLink} className={styles.relayDeepLink}>
                        결과 업무로 이동
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            </section>
          </details>

          {devices.length ? (
            <details className={styles.advancedBox}>
              <summary>로그인된 기기 {devices.length}대</summary>
              <div className={styles.deviceList} aria-label="로그인된 기기">
                {devices.map((device) => (
                  <div key={device.id} className={styles.deviceItem}>
                    <span className={isOnline(device) ? styles.deviceOnline : styles.deviceOffline} />
                    <div>
                      <strong>{device.label}</strong>
                      <small>
                        {device.kind === "desktop_app" ? "설치 앱" : "웹/브라우저"} · 마지막 확인{" "}
                        {formatTime(device.lastSeenAtEpochMs)}
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
          </details>
        </>
      )}

      {message ? <p className={styles.status}>{message}</p> : null}
    </article>
  );
}

function isOnline(device: ModyAccountDevice): boolean {
  return device.lastSeenAtEpochMs >= Date.now() - 10 * 60_000;
}

function formatTime(epochMs: number): string {
  if (!epochMs) return "아직 없음";
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) return "아직 없음";
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${date
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
}

function getRelayRequestText(mode: ModyRelayRequestMode): string {
  if (mode === "trigger_check") {
    return "노트북에서 요청했습니다. 켜져 있는 데스크톱의 반복 업무를 지금 한 번 점검해줘.";
  }
  if (mode === "work_intake") {
    return "노트북에서 요청했습니다. 현재 업무 인박스를 확인하고 처리 가능한 작업을 정리해줘.";
  }
  return "노트북에서 요청했습니다. 데스크톱 앱의 연결 상태와 사용할 수 있는 업무 도구를 진단해줘.";
}

function getRelayModeLabel(mode: ModyRelayRequestMode): string {
  if (mode === "trigger_check") return "자동화 실행";
  if (mode === "work_intake") return "업무 처리";
  return "연결 진단";
}

function getRelayStatusLabel(status: ModyAccountRelayRequest["status"]): string {
  if (status === "queued") return "대기";
  if (status === "running") return "실행 중";
  if (status === "completed") return "완료";
  if (status === "awaiting_approval") return "승인 대기";
  if (status === "needs_attention") return "확인 필요";
  return "실패";
}

function getRelayStatusClass(status: ModyAccountRelayRequest["status"]): string {
  if (status === "completed") return styles.relayStatusDone;
  if (status === "failed" || status === "needs_attention") return styles.relayStatusFailed;
  if (status === "running") return styles.relayStatusRunning;
  return styles.relayStatusQueued;
}
