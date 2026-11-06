"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  createDesktopBridge,
  type ConnectorStatusRecord,
  type DesktopBridgeApi,
  type LocalMemoryConnectorRecoveryMemory,
  type LocalMemoryStatusResult,
} from "@/lib/desktop-bridge";
import type { WorkItem } from "@/lib/types";
import styles from "./ExternalAccountVaultCard.module.css";

type OfficeHandoffWorkItem = Pick<WorkItem, "id" | "title" | "status" | "sourceLabel"> & {
  browserTask?: Pick<NonNullable<WorkItem["browserTask"]>, "targetUrl" | "host" | "requiresFinalUserPresence">;
};

type ExternalAccountVaultCardProps = {
  initialFormOpen?: boolean;
};

export function ExternalAccountVaultCard({ initialFormOpen = false }: ExternalAccountVaultCardProps = {}) {
  const [bridge, setBridge] = useState<DesktopBridgeApi | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [requestContext, setRequestContext] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [appPath, setAppPath] = useState("");
  const [label, setLabel] = useState("");
  const [siteUserId, setSiteUserId] = useState("");
  const [secret, setSecret] = useState("");
  const [warningOk, setWarningOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [records, setRecords] = useState<ConnectorStatusRecord[]>([]);
  const [localMemoryStatus, setLocalMemoryStatus] = useState<LocalMemoryStatusResult | null>(null);
  const [latestOfficeHandoff, setLatestOfficeHandoff] = useState<OfficeHandoffWorkItem | null>(null);
  const [officeHandoffItems, setOfficeHandoffItems] = useState<OfficeHandoffWorkItem[]>([]);
  const [showVaultGuide, setShowVaultGuide] = useState(false);
  const [showAllTemplates, setShowAllTemplates] = useState(false);
  const [showSavedDetails, setShowSavedDetails] = useState(false);
  const [formOpen, setFormOpen] = useState(initialFormOpen);
  const [selectedVaultTemplateId, setSelectedVaultTemplateId] = useState("");

  useEffect(() => {
    const nextBridge = createDesktopBridge();
    setBridge(nextBridge);
    setIsDesktop(nextBridge.isAvailable);
    applyUrlVaultContext();
    void refreshVaultState(nextBridge);
  }, []);

  useEffect(() => {
    if (initialFormOpen) setFormOpen(true);
  }, [initialFormOpen]);

  const connectorId = useMemo(() => {
    const host = normalizeSiteHost(siteUrl);
    return host ? `external-site-${host}` : "external-site-account";
  }, [siteUrl]);

  const connectorRecoveryMemoryMap = useMemo(() => {
    return new Map(
      (localMemoryStatus?.connectorRecoveryMemories ?? []).map((record) => [record.connectorId, record]),
    );
  }, [localMemoryStatus?.connectorRecoveryMemories]);

  const siteLoginRecoveryMemories = useMemo(() => {
    const listedConnectorIds = new Set(records.map((record) => record.connectorId));
    return (localMemoryStatus?.connectorRecoveryMemories ?? []).filter((memory) => {
      if (listedConnectorIds.has(memory.connectorId)) return false;
      return (
        memory.method === "site_login" ||
        memory.connectorId.startsWith("external-site-") ||
        memory.connectorId === "site-login"
      );
    });
  }, [localMemoryStatus?.connectorRecoveryMemories, records]);

  const canSubmit =
    siteUrl.trim().length >= 8 &&
    siteUserId.trim().length > 0 &&
    secret.trim().length >= 4 &&
    warningOk;
  const visibleVaultTemplates = showAllTemplates ? vaultQuickTemplates : vaultQuickTemplates.slice(0, 3);
  const selectedVaultTemplate = vaultQuickTemplates.find((template) => template.id === selectedVaultTemplateId);
  const hasVaultDraft = Boolean(
    siteUrl.trim() ||
      appPath.trim() ||
      label.trim() ||
      siteUserId.trim() ||
      secret.trim() ||
      warningOk,
  );
  const vaultFormSummary = selectedVaultTemplate
    ? `${selectedVaultTemplate.label} · 필요한 칸만 채우기`
    : hasVaultDraft
      ? "직접 입력 중 · 저장 전 확인"
      : "유형을 고르면 입력칸이 열립니다";
  const showVaultForm = formOpen || hasVaultDraft;
  const visibleSavedRecords = records.slice(0, 1);
  const hiddenSavedRecords = records.slice(1);
  const visibleRecoveryMemories = siteLoginRecoveryMemories.slice(0, 1);
  const hiddenRecoveryMemories = siteLoginRecoveryMemories.slice(1);
  const savedDetailsAvailable = records.length > 0 || siteLoginRecoveryMemories.length > 0;
  const latestCredentialRecord =
    records.find((record) => record.method === "site_login" && (record.credentialReferenceId || record.secretFingerprint)) ??
    records[0] ??
    null;
  const credentialReferenceId = latestCredentialRecord?.credentialReferenceId ?? "";
  const credentialStorageLabel = formatCredentialStorage(latestCredentialRecord?.credentialStorage);

  async function refreshVaultState(nextBridge: DesktopBridgeApi | null = bridge) {
    if (!nextBridge) return;
    const [statusResult, memoryResult, inboxResult] = await Promise.allSettled([
      nextBridge.listConnectorStatuses(),
      nextBridge.getLocalMemoryStatus(),
      nextBridge.fetchInbox(),
    ]);
    const nextRecords =
      statusResult.status === "fulfilled"
        ? (statusResult.value.connectors ?? []).filter((record) => record.method === "site_login")
        : records;
    const nextMemory = memoryResult.status === "fulfilled" ? memoryResult.value : localMemoryStatus;
    if (statusResult.status === "fulfilled") {
      setRecords(nextRecords);
    }
    if (memoryResult.status === "fulfilled") {
      setLocalMemoryStatus(nextMemory);
    }
    if (inboxResult.status === "fulfilled") {
      setOfficeHandoffItems(
        filterOfficeHandoffItems(
          inboxResult.value ?? [],
          nextRecords,
          nextMemory?.connectorRecoveryMemories ?? [],
        ),
      );
    }
  }

  async function saveExternalAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bridge || !canSubmit || busy) return;

    setBusy(true);
    setMessage("");
    try {
      const result = await bridge.connectConnector(connectorId, {
        method: "site_login",
        siteUrl: siteUrl.trim(),
        siteLabel: label.trim() || undefined,
        siteUserId: siteUserId.trim(),
        appPath: appPath.trim() || undefined,
        secret,
        warningAcknowledged: warningOk,
      });

      setSecret("");
      setMessage(
        result.userMessage ??
          (result.status === "site_login_stored"
            ? "외부 계정 정보를 OS 보안 저장소에 저장했습니다."
            : "저장 결과를 확인했습니다."),
      );
      if (result.stagedWorkItem?.title) {
        setLatestOfficeHandoff({
          id: result.stagedWorkItem.id,
          title: result.stagedWorkItem.title,
          status: result.stagedWorkItem.status,
          sourceLabel: result.stagedWorkItem.sourceLabel,
          browserTask: result.stagedWorkItem.browserTask
            ? {
                host: result.stagedWorkItem.browserTask.host,
                targetUrl: result.stagedWorkItem.browserTask.targetUrl,
                requiresFinalUserPresence: result.stagedWorkItem.browserTask.requiresFinalUserPresence,
              }
            : undefined,
        });
        setMessage(`${result.userMessage ?? "외부 계정 정보를 저장했습니다."} 업무 오피스에 '${result.stagedWorkItem.title}' 카드를 만들었습니다.`);
      }
      await refreshVaultState(bridge);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "외부 계정 저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article id="external-accounts" className={styles.card}>
      <header className={styles.head}>
        <div>
          <h2>외부 계정 보관함</h2>
        </div>
        <button type="button" onClick={() => setShowVaultGuide((current) => !current)}>
          {showVaultGuide ? "안내 접기" : "안전 안내"}
        </button>
      </header>

      {showVaultGuide ? (
      <section className={styles.flow} aria-label="보관함 사용 흐름">
        <div>
          <span>1</span>
          <strong>공식 연결 우선</strong>
          <small>공식 로그인, 메신저 연결, 회사 메일 수동 연결이 있으면 연결 페이지에서 먼저 점검합니다.</small>
        </div>
        <div>
          <span>2</span>
          <strong>막히면 보관함</strong>
          <small>사이트 주소, 아이디, 비밀번호, 앱 위치만 OS 보안 저장소에 저장합니다.</small>
        </div>
        <div>
          <span>3</span>
          <strong>읽기 모드</strong>
          <small>내 PC 작업 도우미는 화면 확인과 후보 정리부터 시작하고 클릭·입력은 승인 뒤로 둡니다.</small>
        </div>
        <div>
          <span>4</span>
          <strong>오피스 승인</strong>
          <small>업무 오피스 카드에서 수정·승인한 뒤에만 실제 외부 실행을 진행합니다.</small>
        </div>
      </section>
      ) : null}

      <section className={styles.quickSetup} aria-label="빠른 설정 템플릿">
        <button
          type="button"
          className={styles.manualFormButton}
          data-external-vault-primary-action="manual"
          onClick={() => {
            setSelectedVaultTemplateId("");
            setFormOpen(true);
          }}
        >
          직접 입력
        </button>
        <details className={styles.advancedBox} aria-label="계정 유형 고르기">
          <summary>계정 유형 고르기</summary>
          <div>
            {visibleVaultTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => applyVaultTemplate(template)}
              >
                <strong>{template.label}</strong>
                <small>{template.detail}</small>
              </button>
            ))}
            {vaultQuickTemplates.length > visibleVaultTemplates.length ? (
              <button type="button" className={styles.moreTemplateButton} onClick={() => setShowAllTemplates(true)}>
                <strong>{vaultQuickTemplates.length - visibleVaultTemplates.length}개 더 보기</strong>
                <small>카카오, Telegram, Slack, Discord 등</small>
              </button>
            ) : null}
          </div>
        </details>
      </section>

      <section
        className={styles.mailAutomationRail}
        aria-label="메일 자동 점검 보관함 준비"
        data-mail-vault-automation-rail="vault_2fa_polling_approval"
        data-mail-vault-secret-policy="secret_reference_only_ai_cannot_read"
        data-mail-vault-polling-policy="user_enabled_5_minute_readonly_check"
        data-mail-vault-final-action-policy="send_calendar_file_locked_until_office_approval"
      >
        <header>
          <div>
            <span>메일 자동 점검</span>
            <strong>보관함 저장 뒤 5분 점검과 승인함으로 이어갑니다</strong>
          </div>
          <small>비밀번호 원문은 AI가 읽지 않고 저장소 참조만 사용합니다</small>
        </header>
        <ol>
          {mailAutomationVaultSteps.map((step) => (
            <li key={step.id} data-state={step.state}>
              <span>{step.label}</span>
              <strong>{step.title}</strong>
              <small>{step.detail}</small>
            </li>
          ))}
        </ol>
        <dl
          className={styles.mailAutomationProof}
          aria-label="메일 자동 점검 보안 증거"
          data-mail-vault-proof="webmail_metadata_filter_approval_lock"
          data-mail-vault-webmail-contract="webmail_login_reference_to_metadata_scan_to_approval_queue"
          data-mail-vault-secure-intake-contract="metadata_first_secret_blind_mail_intake"
          data-mail-vault-cadence-minutes="5"
          data-mail-vault-body-preview-policy="business_preview_after_noise_filter_only"
        >
          {mailAutomationVaultProofs.map((proof) => (
            <div key={proof.id} data-state={proof.state}>
              <dt>{proof.label}</dt>
              <dd>
                <strong>{proof.title}</strong>
                <small>{proof.detail}</small>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        className={styles.secureReferenceRail}
        aria-label="보관함 보안 참조 증거"
        data-external-vault-secret-runtime="input_to_main_process_encrypted_reference_only"
        data-external-vault-ai-secret-readable="false"
        data-external-vault-secret-returned="false"
        data-external-vault-credential-storage={latestCredentialRecord?.credentialStorage ?? "os_keychain"}
        data-external-vault-credential-reference={credentialReferenceId || "created_after_save"}
      >
        <article data-state={isDesktop ? "ready" : "locked"}>
          <span>저장 위치</span>
          <strong>{isDesktop ? credentialStorageLabel : "설치 앱 필요"}</strong>
          <small>{isDesktop ? "비밀번호 원문은 main process에서 암호화" : "브라우저 미리보기에서는 저장하지 않음"}</small>
        </article>
        <article data-state={credentialReferenceId ? "ready" : "review"}>
          <span>참조 ID</span>
          <strong>{credentialReferenceId ? previewCredentialReferenceId(credentialReferenceId) : "저장 후 생성"}</strong>
          <small>자동 점검과 내 PC 작업에는 이 참조만 전달</small>
        </article>
        <article data-state="ready">
          <span>AI 경계</span>
          <strong>원문 비노출</strong>
          <small>AI, 채팅, 리포트에는 password/token 값을 반환하지 않음</small>
        </article>
      </section>

      {showVaultForm ? (
      <details
        className={styles.formFold}
        open={formOpen}
        onToggle={(event) => setFormOpen(event.currentTarget.open)}
        data-external-vault-form="template_first_details_form"
        data-external-vault-form-open={formOpen ? "true" : "false"}
        data-external-vault-template-selected={selectedVaultTemplate?.id ?? (hasVaultDraft ? "manual" : "none")}
      >
        <summary>
          <span>입력칸</span>
          <strong>{vaultFormSummary}</strong>
          <small>{hasVaultDraft ? "주소, 아이디, 비밀번호 확인" : "먼저 계정 유형 선택"}</small>
        </summary>

        <form id="external-account-form" className={styles.form} onSubmit={saveExternalAccount}>
          <label className={styles.field}>
            <span>접속 사이트</span>
            <input
              type="url"
              value={siteUrl}
              onChange={(event) => setSiteUrl(event.target.value)}
              placeholder="https://..."
              autoComplete="url"
            />
          </label>

          <label className={styles.field}>
            <span>표시 이름</span>
            <input
              type="text"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="예: 네이버예약 관리자"
              autoComplete="off"
            />
          </label>

          <label className={styles.field}>
            <span>앱 위치 또는 실행 이름 (선택)</span>
            <input
              type="text"
              value={appPath}
              onChange={(event) => setAppPath(event.target.value)}
              placeholder="예: C:\\Program Files\\... 또는 chrome.exe"
              autoComplete="off"
            />
          </label>

          <label className={styles.field}>
            <span>외부 사이트 아이디</span>
            <input
              type="text"
              value={siteUserId}
              onChange={(event) => setSiteUserId(event.target.value)}
              placeholder="사이트 로그인 아이디"
              autoComplete="username"
            />
          </label>

          <label className={styles.field}>
            <span>외부 사이트 비밀번호</span>
            <input
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="채팅에 입력하지 말고 여기에만 입력"
              autoComplete="current-password"
            />
          </label>

          <label className={styles.check}>
            <input
              type="checkbox"
              checked={warningOk}
              onChange={(event) => setWarningOk(event.target.checked)}
            />
            <span>공식 연결이 없을 때만 제한적으로 쓰며, 외부 실행은 승인 후 진행합니다.</span>
          </label>

          {showVaultGuide ? (
          <section className={styles.submitGuide} aria-label="저장 후 이어지는 흐름">
            <strong>저장하면 바로 이어지는 일</strong>
            <ol>
              <li>OS 보안 저장소에 보안 입력값 원문을 암호화해서 보관</li>
              <li>연결 재점검 또는 내 PC 작업 도우미 읽기 후보 생성</li>
              <li>업무 오피스 승인 카드로 넘겨 실제 클릭·발송 전 멈춤</li>
            </ol>
          </section>
          ) : null}

          <button type="submit" disabled={!canSubmit || busy}>
            {busy ? "저장 중..." : "암호화해서 저장"}
          </button>
        </form>
      </details>
      ) : null}

      {showVaultGuide ? (
      <section className={styles.truth} aria-label="보안 처리">
        <div data-ready={isDesktop ? "true" : "false"}>
          <strong>{isDesktop ? "OS 보안 저장소 사용" : "설치 앱에서 저장 필요"}</strong>
          <p>
            {isDesktop
              ? "비밀번호 원문은 Electron main process에서 암호화되고 화면 상태에는 다시 표시하지 않습니다."
              : "브라우저 미리보기에서는 비밀번호를 저장하지 않습니다. 설치 앱에서 이 패널을 열어 주세요."}
          </p>
        </div>
        <div>
          <strong>AI는 원문을 모릅니다</strong>
          <p>업무 실행 시에는 저장소 참조만 사용합니다. 로그인 실패는 저장된 외부 계정 정보가 틀린 경우로 처리합니다.</p>
        </div>
      </section>
      ) : null}

      <section className={styles.nextRoutes} aria-label="다른 연결 경로">
        <a href="/?panel=connect&goal=메일과 메신저 연결을 설정하고 싶어요&recommend=telegram-bot,slack-app,company-mail">
          메신저·메일 연결창 열기
        </a>
        <a href="/?computerUse=1">내 PC 읽기 모드 확인</a>
      </section>

      <section className={styles.vaultSummary} aria-label="보관함 상태 요약">
        <div>
          <span>저장됨</span>
          <strong>{records.length}개</strong>
        </div>
        <div>
          <span>복구 기억</span>
          <strong>{siteLoginRecoveryMemories.length}개</strong>
        </div>
        <div>
          <span>오피스 승인함</span>
          <strong>{officeHandoffItems.length}개</strong>
        </div>
        <button
          type="button"
          onClick={() => setShowSavedDetails((current) => !current)}
          disabled={!savedDetailsAvailable}
        >
          {showSavedDetails ? "목록 접기" : "목록 보기"}
        </button>
      </section>

      {savedDetailsAvailable ? (
        <details
          className={styles.savedVaultDetails}
          open={showSavedDetails}
          onToggle={(event) => setShowSavedDetails(event.currentTarget.open)}
          aria-label="보관함 저장 목록 접힘"
          data-external-vault-saved-details="summary_counts_first_record_more_on_demand"
          data-external-vault-saved-details-default="closed"
          data-external-vault-saved-details-open={showSavedDetails ? "true" : "false"}
          data-external-vault-visible-record-count={visibleSavedRecords.length}
          data-external-vault-hidden-record-count={hiddenSavedRecords.length}
          data-external-vault-visible-recovery-count={visibleRecoveryMemories.length}
          data-external-vault-hidden-recovery-count={hiddenRecoveryMemories.length}
        >
          <summary>
            <span>저장 목록</span>
            <strong>
              저장 {records.length}개 · 복구 {siteLoginRecoveryMemories.length}개
            </strong>
            <small>대표 항목만 먼저 보고 나머지는 열 때 확인합니다.</small>
          </summary>
          <div className={styles.savedVaultDetailsBody}>
            {records.length ? (
              <section
                className={styles.records}
                aria-label="저장된 외부 업무 계정"
                data-external-vault-records="first_record_then_more_inside_details"
              >
                <span>저장된 외부 계정</span>
                <ol>
                  {visibleSavedRecords.map((record) => (
                    <SavedVaultRecord
                      key={record.connectorId}
                      record={record}
                      recoveryMemory={connectorRecoveryMemoryMap.get(record.connectorId)}
                      queuedWorkItem={findOfficeHandoffForRecord(record, officeHandoffItems)}
                    />
                  ))}
                </ol>
                {hiddenSavedRecords.length ? (
                  <details
                    className={styles.savedVaultMore}
                    aria-label="나머지 저장 외부 계정"
                    data-external-vault-records-more="remaining_records_collapsed"
                    data-external-vault-records-more-default="closed"
                  >
                    <summary>
                      <span>나머지 저장 계정</span>
                      <strong>{hiddenSavedRecords.length}개 접힘</strong>
                    </summary>
                    <ol>
                      {hiddenSavedRecords.map((record) => (
                        <SavedVaultRecord
                          key={record.connectorId}
                          record={record}
                          recoveryMemory={connectorRecoveryMemoryMap.get(record.connectorId)}
                          queuedWorkItem={findOfficeHandoffForRecord(record, officeHandoffItems)}
                        />
                      ))}
                    </ol>
                  </details>
                ) : null}
              </section>
            ) : null}

            {siteLoginRecoveryMemories.length ? (
              <section
                className={styles.recoveryShelf}
                aria-label="복구할 외부 계정 기억"
                data-external-vault-recovery="first_memory_then_more_inside_details"
              >
                <span>복구할 외부 계정</span>
                <div>
                  {visibleRecoveryMemories.map((memory) => (
                    <VaultRecoveryMemory key={memory.id} memory={memory} />
                  ))}
                </div>
                {hiddenRecoveryMemories.length ? (
                  <details
                    className={styles.savedVaultMore}
                    aria-label="나머지 복구 기억"
                    data-external-vault-recovery-more="remaining_recovery_collapsed"
                    data-external-vault-recovery-more-default="closed"
                  >
                    <summary>
                      <span>나머지 복구 기억</span>
                      <strong>{hiddenRecoveryMemories.length}개 접힘</strong>
                    </summary>
                    <div>
                      {hiddenRecoveryMemories.map((memory) => (
                        <VaultRecoveryMemory key={memory.id} memory={memory} />
                      ))}
                    </div>
                  </details>
                ) : null}
              </section>
            ) : null}
          </div>
        </details>
      ) : null}

      <OfficeHandoffPanel
        latestWorkItem={latestOfficeHandoff ?? officeHandoffItems[0] ?? null}
        savedAccountCount={records.length}
        recoveryCount={siteLoginRecoveryMemories.length}
        queuedCount={officeHandoffItems.length}
      />

      {message ? <p className={styles.status}>{message}</p> : null}
    </article>
  );

  function applyUrlVaultContext() {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const nextSiteUrl = firstParam(params, ["siteUrl", "site", "targetUrl", "loginUrl"]);
    const nextAppPath = firstParam(params, ["appPath", "app", "appLocation"]);
    const nextLabel = firstParam(params, ["accountLabel", "label", "siteLabel"]);
    const nextUserId = firstParam(params, ["siteUserId", "userId", "loginId", "account"]);
    const connectorHint = firstParam(params, ["connector", "open", "recommend"]);
    const goal = firstParam(params, ["goal", "intent"]);
    const hasIncomingVaultContext = Boolean(nextSiteUrl || nextAppPath || nextLabel || nextUserId);

    if (nextSiteUrl) setSiteUrl(nextSiteUrl);
    if (nextAppPath) setAppPath(nextAppPath);
    if (nextLabel) setLabel(nextLabel);
    if (nextUserId) setSiteUserId(nextUserId);
    if (hasIncomingVaultContext) {
      setSelectedVaultTemplateId("");
      setFormOpen(true);
    }
    if (goal || connectorHint) {
      setRequestContext(
        [
          goal ? `요청: ${goal}` : "",
          connectorHint ? `연결 후보: ${connectorHint}` : "",
        ].filter(Boolean).join(" · "),
      );
      const template = recommendVaultTemplate(connectorHint, goal);
      if (template && !nextSiteUrl && !nextLabel) applyVaultTemplate(template);
    }
  }

  function applyVaultTemplate(template: VaultQuickTemplate) {
    setSelectedVaultTemplateId(template.id);
    setLabel(template.defaultLabel);
    setSiteUrl(template.defaultSiteUrl);
    setAppPath(template.defaultAppPath);
    setWarningOk(true);
    setFormOpen(true);
    setMessage(template.nextStep);
  }
}

type VaultQuickTemplate = {
  id: string;
  label: string;
  detail: string;
  defaultLabel: string;
  defaultSiteUrl: string;
  defaultAppPath: string;
  nextStep: string;
  match: RegExp;
};

const vaultQuickTemplates: VaultQuickTemplate[] = [
  {
    id: "company-mail",
    label: "사내 메일/포털",
    detail: "메일함 연결이나 계정 동의 연결이 막힐 때 포털 주소와 앱 비밀번호 후보를 보관합니다.",
    defaultLabel: "사내 메일 포털",
    defaultSiteUrl: "https://",
    defaultAppPath: "chrome.exe",
    nextStep: "사내 메일 포털 템플릿을 열었습니다. 접속 URL, 메일 아이디, 앱 비밀번호를 이 칸에만 넣어 주세요.",
    match: /mail|imap|outlook|gmail|메일|포털|portal|groupware|그룹웨어/iu,
  },
  {
    id: "kakao",
    label: "카카오/톡 관리자",
    detail: "공식 연결이 막히면 관리자 사이트와 PC 앱 위치를 읽기 후보로 넘깁니다.",
    defaultLabel: "카카오 업무 관리자",
    defaultSiteUrl: "https://center-pf.kakao.com/",
    defaultAppPath: "KakaoTalk.exe",
    nextStep: "카카오 템플릿을 열었습니다. 관리자 링크나 PC 앱 위치를 확인하고 계정 정보는 보관함에만 저장하세요.",
    match: /kakao|카카오|톡|talk/iu,
  },
  {
    id: "telegram",
    label: "Telegram 연결 대체",
    detail: "Telegram 공식 연결이 실패하면 관리자 위치와 계정 참조를 보관합니다.",
    defaultLabel: "Telegram 관리자",
    defaultSiteUrl: "https://web.telegram.org/",
    defaultAppPath: "Telegram.exe",
    nextStep: "Telegram 템플릿을 열었습니다. 공식 연결은 연결창에서 먼저 진행하고, 막힐 때만 보관함 참조로 남깁니다.",
    match: /telegram|텔레그램|botfather|bot token/iu,
  },
  {
    id: "slack",
    label: "Slack 워크스페이스",
    detail: "공식 로그인 승인이 막힌 워크스페이스 주소와 앱 위치를 보관합니다.",
    defaultLabel: "Slack 워크스페이스",
    defaultSiteUrl: "https://slack.com/signin",
    defaultAppPath: "Slack.exe",
    nextStep: "Slack 템플릿을 열었습니다. 가능하면 공식 연결을 먼저 쓰고, 관리자 승인이 막히면 이 보관함에서 다른 방법을 준비합니다.",
    match: /slack|슬랙|workspace|워크스페이스/iu,
  },
  {
    id: "discord",
    label: "Discord 서버",
    detail: "공식 연결이나 초대 권한이 막힌 서버 주소와 앱 위치를 보관합니다.",
    defaultLabel: "Discord 서버",
    defaultSiteUrl: "https://discord.com/channels/@me",
    defaultAppPath: "Discord.exe",
    nextStep: "Discord 템플릿을 열었습니다. 공식 연결은 연결창에서 먼저 진행하고, 서버 권한이 막히면 보관함과 오피스 승인 카드로 이어갑니다.",
    match: /discord|디스코드|guild|server|서버/iu,
  },
  {
    id: "business-site",
    label: "업무 사이트",
    detail: "예약, 문의, 관리자 페이지처럼 별도 로그인 사이트를 보관합니다.",
    defaultLabel: "업무 관리자 사이트",
    defaultSiteUrl: "https://",
    defaultAppPath: "chrome.exe",
    nextStep: "업무 사이트 템플릿을 열었습니다. 사이트 주소와 아이디, 비밀번호를 넣으면 오피스 승인 카드로 이어집니다.",
    match: /site|login|admin|관리자|예약|문의|사이트/iu,
  },
];

const mailAutomationVaultSteps = [
  {
    id: "vault",
    label: "1",
    title: "계정 참조 저장",
    detail: "메일 주소, 아이디, 앱 비밀번호 또는 로그인 동의 참조만 보관함에 저장",
    state: "ready",
  },
  {
    id: "two_factor",
    label: "2",
    title: "2차 인증 확인",
    detail: "2차 인증, 앱 비밀번호, 외부 앱 허용 상태를 사용자 화면에서 확인",
    state: "review",
  },
  {
    id: "polling",
    label: "3",
    title: "5분 읽기 점검",
    detail: "제목, 보낸 사람 표시명, 시간, 첨부 표시부터 읽고 광고는 본문 전 제외",
    state: "locked",
  },
  {
    id: "approval",
    label: "4",
    title: "오피스 승인함",
    detail: "답장, 일정 등록, 첨부 정리는 마지막 확인 전까지 실행하지 않음",
    state: "locked",
  },
] as const;

const mailAutomationVaultProofs = [
  {
    id: "webmail",
    label: "웹메일 대체",
    title: "IMAP이 없어도 목록 메타데이터부터",
    detail: "로그인 원문 대신 저장소/브라우저 세션 참조로 받은메일함 목록만 읽습니다.",
    state: "ready",
  },
  {
    id: "noise_filter",
    label: "광고 제외",
    title: "본문 전 필터",
    detail: "광고, 뉴스레터, 스팸은 본문 preview를 AI에 넘기기 전에 제외합니다.",
    state: "review",
  },
  {
    id: "approval_lock",
    label: "실행 잠금",
    title: "발송·일정·파일은 승인함에서",
    detail: "답장, 일정 등록, 첨부 정리는 후보만 만들고 마지막 확인 전까지 잠급니다.",
    state: "locked",
  },
] as const;

function formatCredentialStorage(value?: string) {
  if (value === "os_keychain") return "OS 보안 저장소";
  if (value === "enterprise_vault") return "회사 보안 저장소";
  if (value === "external_mcp_config") return "외부 연결 설정";
  if (value === "local_env_reference") return "로컬 환경 참조";
  return "OS 보안 저장소";
}

function previewCredentialReferenceId(value: string) {
  const text = value.trim();
  if (!text) return "저장 후 생성";
  if (text.length <= 38) return text;
  return `${text.slice(0, 18)}...${text.slice(-14)}`;
}

function recommendVaultTemplate(...values: Array<string | undefined>) {
  const text = values.filter(Boolean).join(" ");
  return vaultQuickTemplates.find((template) => template.match.test(text));
}

function firstParam(params: URLSearchParams, keys: string[]) {
  for (const key of keys) {
    const value = params.get(key);
    if (value?.trim()) return value.trim();
  }
  return "";
}

function VaultRecoveryMemory({ memory }: { memory: LocalMemoryConnectorRecoveryMemory }) {
  return (
    <aside className={styles.recoveryMemory} data-kind={memory.recoveryKind}>
      <div>
        <span>지난 복구 기억</span>
        <strong>{memory.actionLabel || "연결 확인"}</strong>
      </div>
      <p>{memory.summary}</p>
      {memory.signals.length ? (
        <ul>
          {memory.signals.slice(0, 3).map((signal) => (
            <li key={`${memory.id}-${signal}`}>{signal}</li>
          ))}
        </ul>
      ) : null}
      <nav className={styles.recoveryActions} aria-label={`${memory.connectorId} 복구 액션`}>
        <a href={buildRecoveryConnectHref(memory)}>연결창 재시도</a>
        <a href={buildComputerUseHref(memory)}>내 PC 작업 도우미 읽기</a>
        <a href="#external-account-form">계정 다시 저장</a>
        <a href={buildOfficeApprovalHref(memory.connectorId)}>오피스 승인 카드</a>
      </nav>
    </aside>
  );
}

function OfficeHandoffPanel({
  latestWorkItem,
  savedAccountCount,
  recoveryCount,
  queuedCount,
}: {
  latestWorkItem: OfficeHandoffWorkItem | null;
  savedAccountCount: number;
  recoveryCount: number;
  queuedCount: number;
}) {
  const hasVaultContext = savedAccountCount > 0 || recoveryCount > 0;
  const officeHref = latestWorkItem
    ? `/?queue=approval&draft=${encodeURIComponent(latestWorkItem.id)}`
    : "/?queue=approval";

  return (
    <section className={styles.officeHandoffPanel} data-active={latestWorkItem ? "true" : "false"} aria-label="업무 오피스 인계">
      <div className={styles.officeHandoffHeader}>
        <div>
          <span>오피스 인계</span>
          <strong>{latestWorkItem ? "승인 카드 생성됨" : hasVaultContext ? "승인 흐름 준비됨" : "저장 후 승인 카드 생성"}</strong>
        </div>
        <a href={officeHref}>업무 오피스 보기</a>
      </div>

      {latestWorkItem ? (
        <div className={styles.officeHandoffCard}>
          <strong>{latestWorkItem.title}</strong>
          <small>
            {[
              latestWorkItem.sourceLabel,
              latestWorkItem.browserTask?.host,
              latestWorkItem.browserTask?.requiresFinalUserPresence ? "최종 사용자 승인 필요" : "",
            ].filter(Boolean).join(" · ")}
          </small>
        </div>
      ) : (
        <p>
          계정을 다시 저장하면 연결 재점검과 내 PC 작업 도우미 읽기 확인 뒤 업무 오피스 승인 카드로 이어집니다.
        </p>
      )}
      {queuedCount > 1 ? <small className={styles.officeQueueCount}>오피스 승인함에 {queuedCount}개 카드가 있습니다.</small> : null}

      <details className={styles.officeHandoffDetails}>
        <summary>승인 흐름 보기</summary>
        <ol>
          <li data-state={hasVaultContext ? "done" : "todo"}>
            <span>1</span>
            <strong>계정 재저장</strong>
            <small>외부 사이트 정보는 보관함에만 저장</small>
          </li>
          <li data-state={latestWorkItem ? "done" : hasVaultContext ? "active" : "todo"}>
            <span>2</span>
            <strong>연결 재점검</strong>
            <small>공식 연결이 막히면 다른 방법 선택</small>
          </li>
          <li data-state={latestWorkItem ? "done" : "todo"}>
            <span>3</span>
            <strong>읽기 모드 확인</strong>
            <small>내 PC 작업 도우미는 화면 확인부터</small>
          </li>
          <li data-state={latestWorkItem ? "active" : "todo"}>
            <span>4</span>
            <strong>오피스 승인 카드</strong>
            <small>클릭·입력·발송 전 앱에서 다시 확인</small>
          </li>
        </ol>
      </details>
    </section>
  );
}

function SavedVaultRecord({
  record,
  recoveryMemory,
  queuedWorkItem,
}: {
  record: ConnectorStatusRecord;
  recoveryMemory?: LocalMemoryConnectorRecoveryMemory;
  queuedWorkItem: OfficeHandoffWorkItem | null;
}) {
  return (
    <li>
      <div className={styles.recordMain}>
        <strong>{record.userMessage || record.connectorId}</strong>
        <small>
          {[
            record.siteHost,
            record.appPath ? `앱 ${record.appPath}` : "",
            record.credentialReferenceId ? `참조 ${previewCredentialReferenceId(record.credentialReferenceId)}` : "",
            record.secretFingerprint ? `확인값 ${record.secretFingerprint}` : record.status,
          ].filter(Boolean).join(" · ")}
        </small>
      </div>
      <RecordOfficeHandoff record={record} queuedWorkItem={queuedWorkItem} />
      {recoveryMemory ? <VaultRecoveryMemory memory={recoveryMemory} /> : null}
    </li>
  );
}

function RecordOfficeHandoff({
  record,
  queuedWorkItem,
}: {
  record: ConnectorStatusRecord;
  queuedWorkItem: OfficeHandoffWorkItem | null;
}) {
  const connectorId = record.connectorId;
  const host = record.siteHost || normalizeSiteHost(record.siteUrl || "");
  return (
    <aside className={styles.recordOfficeHandoff} data-queued={queuedWorkItem ? "true" : "false"}>
      <div>
        <span>오피스 승인함</span>
        <strong>{queuedWorkItem ? queuedWorkItem.title : "읽기 후보 대기"}</strong>
        <small>
          {queuedWorkItem
            ? [queuedWorkItem.sourceLabel, queuedWorkItem.browserTask?.host, "승인 대기"].filter(Boolean).join(" · ")
            : `${host || connectorId} 계정을 저장하면 내 PC 작업 도우미 읽기 카드로 이어집니다.`}
        </small>
      </div>
      <nav aria-label={`${connectorId} 오피스 승인함 액션`}>
        <a href={buildOfficeApprovalHref(connectorId, queuedWorkItem?.id)}>오피스 승인 카드</a>
        <a href={buildComputerUseHrefForConnector(connectorId, queuedWorkItem?.id)}>내 PC 작업 도우미 읽기</a>
      </nav>
    </aside>
  );
}

function buildRecoveryConnectHref(memory: LocalMemoryConnectorRecoveryMemory) {
  const params = new URLSearchParams();
  params.set("panel", "connect");
  params.set("from", "restore-reauth");
  params.set("reauth", "1");
  params.set("mode", memory.recoveryKind === "ready" ? "read" : "write");
  params.set("connector", memory.connectorId);
  params.set("recommend", memory.connectorId);
  params.set("goal", `${memory.connectorId} 외부 계정 연결을 다시 확인하고 싶어요`);
  return `/?${params.toString()}`;
}

function buildComputerUseHref(memory: LocalMemoryConnectorRecoveryMemory) {
  const params = new URLSearchParams();
  params.set("computerUse", "1");
  params.set("source", "external-account-vault");
  params.set("connector", memory.connectorId);
  return `/?${params.toString()}`;
}

function buildOfficeApprovalHref(connectorId: string, workItemId = "") {
  const params = new URLSearchParams();
  params.set("queue", "approval");
  params.set("connector", connectorId);
  params.set("source", "external-account-vault");
  if (workItemId) params.set("draft", workItemId);
  return `/?${params.toString()}`;
}

function buildComputerUseHrefForConnector(connectorId: string, workItemId = "") {
  const params = new URLSearchParams();
  params.set("computerUse", "1");
  params.set("source", "external-account-vault");
  params.set("connector", connectorId);
  if (workItemId) params.set("workItem", workItemId);
  return `/?${params.toString()}`;
}

function filterOfficeHandoffItems(
  items: WorkItem[],
  records: ConnectorStatusRecord[],
  memories: LocalMemoryConnectorRecoveryMemory[],
): OfficeHandoffWorkItem[] {
  const knownHosts = new Set(
    [
      ...records.flatMap((record) => [record.siteHost, normalizeSiteHost(record.siteUrl || "")]),
      ...memories.map((memory) => memory.connectorId.replace(/^external-site-/u, "")),
    ]
      .map((value) => String(value ?? "").toLowerCase())
      .filter(Boolean),
  );
  return items
    .filter((item) => item.browserTask && item.status === "approval_pending")
    .filter((item) => {
      const host = String(item.browserTask?.host ?? "").toLowerCase();
      const targetHost = normalizeSiteHost(item.browserTask?.targetUrl ?? "");
      return item.source === "web_page" && (!knownHosts.size || knownHosts.has(host) || knownHosts.has(targetHost));
    })
    .slice(0, 8)
    .map(toOfficeHandoffWorkItem);
}

function findOfficeHandoffForRecord(
  record: ConnectorStatusRecord,
  items: OfficeHandoffWorkItem[],
): OfficeHandoffWorkItem | null {
  const host = (record.siteHost || normalizeSiteHost(record.siteUrl || "")).toLowerCase();
  return (
    items.find((item) => {
      const itemHost = String(item.browserTask?.host ?? "").toLowerCase();
      const targetHost = normalizeSiteHost(item.browserTask?.targetUrl ?? "");
      return Boolean(host && (itemHost === host || targetHost === host));
    }) ?? null
  );
}

function toOfficeHandoffWorkItem(item: WorkItem): OfficeHandoffWorkItem {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    sourceLabel: item.sourceLabel,
    browserTask: item.browserTask
      ? {
          targetUrl: item.browserTask.targetUrl,
          host: item.browserTask.host,
          requiresFinalUserPresence: item.browserTask.requiresFinalUserPresence,
        }
      : undefined,
  };
}

function normalizeSiteHost(value: string) {
  try {
    const url = new URL(value.trim());
    return url.hostname.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  } catch {
    return "";
  }
}
