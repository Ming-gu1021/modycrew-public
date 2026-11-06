"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AccountCard } from "@/components/AccountCard";
import DisplayPreferences from "@/components/DisplayPreferences";
import { TutorialSettings } from "@/components/FirstUseTutorial";
import { AIKeySecureCard } from "@/components/AIKeySecureCard";
import { DeviceSyncCard } from "@/components/DeviceSyncCard";
import { ExternalAccountVaultCard } from "@/components/ExternalAccountVaultCard";
import { JevMailSettingsCard } from "@/components/JevMailSettingsCard";
import { MemoryRootCard } from "@/components/MemoryRootCard";
import { onAuthSession, signOutCurrent, type ModyAuthSession } from "@/lib/firebase-client";
import { markSignedIn } from "@/lib/onboarding";
import { useThemeMode } from "@/lib/theme-mode";
import styles from "./page.module.css";

type PanelId = "account" | "memory" | "device" | "external" | "ai";
type AccountSettingsView = "basic" | "connections" | "advanced";

const accountSettingsViewStorageKey = "modycrew-account-settings-view-v1";

type Panel = {
  id: PanelId;
  label: string;
  title: string;
  description: string;
  content: ReactNode;
};

function normalizeAccountSettingsView(value: unknown): AccountSettingsView {
  return value === "connections" || value === "advanced" || value === "basic" ? value : "basic";
}

function readStoredAccountSettingsView(): AccountSettingsView {
  if (typeof window === "undefined") return "basic";
  try {
    return normalizeAccountSettingsView(window.localStorage.getItem(accountSettingsViewStorageKey));
  } catch {
    return "basic";
  }
}

export default function AccountPage() {
  const [signedIn, setSignedIn] = useState(false);
  const [session, setSession] = useState<ModyAuthSession | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [activePanel, setActivePanel] = useState<PanelId>("account");
  const [accountSettingsView, setAccountSettingsView] = useState<AccountSettingsView>(readStoredAccountSettingsView);
  const [settingsViewInitializedFor, setSettingsViewInitializedFor] = useState<"signed-in" | "signed-out" | null>(null);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const { theme, setTheme } = useThemeMode();
  const showOnlyLogin = !sessionChecked || !signedIn;
  const activeAccountSettingsView = showOnlyLogin ? "basic" : normalizeAccountSettingsView(accountSettingsView);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void onAuthSession((session) => {
      if (cancelled) return;
      setSession(session);
      setSignedIn(Boolean(session));
      setSessionChecked(true);
    }).then((nextUnsubscribe) => {
      if (cancelled) nextUnsubscribe();
      else unsubscribe = nextUnsubscribe;
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!sessionChecked || settingsViewInitializedFor !== (signedIn ? "signed-in" : "signed-out")) return;
    try {
      window.localStorage.setItem(accountSettingsViewStorageKey, activeAccountSettingsView);
    } catch {
      // 저장소가 막힌 환경에서는 현재 세션 안에서만 설정 보기 방식을 유지합니다.
    }
  }, [activeAccountSettingsView, sessionChecked, signedIn, settingsViewInitializedFor]);

  const handleSignOut = async () => {
    setSignOutBusy(true);
    try {
      await signOutCurrent();
      markSignedIn(false);
      setSession(null);
      setSignedIn(false);
      setActivePanel("account");
      setAccountSettingsView("basic");
    } finally {
      setSignOutBusy(false);
    }
  };

  useEffect(() => {
    if (!sessionChecked || !signedIn) {
      setActivePanel("account");
      if (sessionChecked) setSettingsViewInitializedFor("signed-out");
      return;
    }

    const syncHash = () => {
      if (window.location.hash === "#external-accounts") {
        setActivePanel("external");
        setAccountSettingsView("connections");
      } else if (window.location.hash === "#ai-connection") {
        setActivePanel("ai");
        setAccountSettingsView("connections");
      } else if (window.location.hash === "#device-sync") {
        setActivePanel("device");
        setAccountSettingsView("advanced");
      } else if (window.location.hash === "#memory-root") {
        setActivePanel("memory");
        setAccountSettingsView("advanced");
      } else {
        const storedView = readStoredAccountSettingsView();
        // '연결'을 고르는 사람은 대부분 AI 연결을 찾는다. 예전에는 외부 사이트 계정 보관함이 먼저 떠서
        // AI 연결까지 접힘을 몇 번 더 열어야 했다.
        const storedPanel = storedView === "connections" ? "ai" : storedView === "advanced" ? "memory" : "account";
        setAccountSettingsView(storedView);
        setActivePanel(storedPanel);
      }
    };
    syncHash();
    setSettingsViewInitializedFor("signed-in");
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [sessionChecked, signedIn]);

  const panels: Panel[] = [
    {
      id: "account",
      label: showOnlyLogin ? "로그인" : "내 프로필",
      title: showOnlyLogin ? "먼저 로그인만 합니다" : "내 프로필",
      description: showOnlyLogin
        ? "AI 연결, 외부 계정, 자동화 설정은 첫 진입에서 묻지 않습니다."
        : "로그인 상태와 로그아웃은 이 화면에서만 관리합니다.",
      content: <AccountCard variant={showOnlyLogin ? "login" : "default"} showSignOut={!showOnlyLogin} />,
    },
    {
      id: "device",
      label: "기기 동기화",
      title: "이 PC 업무실 이어 쓰기",
      description: "연결 상태, 반복 업무, 기능 스위치를 계정에 저장해 다른 PC에서도 같은 업무실로 시작합니다.",
      content: <DeviceSyncCard />,
    },
    {
      id: "memory",
      label: "기억 위치",
      title: "기억 위치 설정",
      description: "AI 팀원 기억과 다음부터 이렇게 기준을 저장할 폴더만 여기에서 정합니다.",
      content: <MemoryRootCard />,
    },
    {
      id: "external",
      label: "외부 계정",
      title: "외부 사이트 계정 보관함",
      description: "네이버예약, 톡톡, 사내 관리자 계정은 채팅이 아니라 이 보안 칸에만 저장합니다.",
      content: <ExternalAccountVaultCard />,
    },
    {
      id: "ai",
      label: "AI",
      title: "AI 연결",
      description: "채팅 중 실제 답변 생성이 필요할 때만 연결합니다.",
      content: (
        <>
          <AIKeySecureCard />
          {/* Jev 는 채팅 AI 와 별개인 선택 기능이다. AI 연결 카드와 섞여 보이지 않게 제목 있는 칸으로 나눈다. */}
          <section className={styles.jevSection} aria-labelledby="account-jev-section-title" data-account-jev-section="optional_mail_judgement_helper">
            <header>
              <h2 id="account-jev-section-title">메일 판단 도우미 (Jev)</h2>
              <p>선택 기능이에요. 채팅 AI 연결과는 따로, 받은 메일을 분류할 때만 도와줍니다. 쓰지 않아도 괜찮아요.</p>
            </header>
            <JevMailSettingsCard />
          </section>
        </>
      ),
    },
  ];

  const selectedPanel = showOnlyLogin
    ? panels[0]
    : panels.find((panel) => panel.id === activePanel) ?? panels[0];
  const accountPanel = panels[0];
  const connectionPanels = panels.filter((panel) => panel.id === "external" || panel.id === "ai");
  const advancedPanels = panels.filter((panel) => panel.id === "memory" || panel.id === "device");
  const visibleSettingsPanels = activeAccountSettingsView === "connections" ? connectionPanels : advancedPanels;
  const selectedAdvancedPanel = activePanel === "account" ? null : selectedPanel;
  const otherVisibleSettingsPanels = visibleSettingsPanels.filter((panel) => panel.id !== activePanel);
  const settingsSummary = accountSettingsSummary(activeAccountSettingsView);
  const accountSettingsCustomized = activeAccountSettingsView !== "basic";
  const activeAccountViewTab =
    getAccountSettingsViewTabs({ signedIn, activePanel }).find((tab) => tab.id === activeAccountSettingsView) ??
    getAccountSettingsViewTabs({ signedIn, activePanel })[0];
  const accountSettingsFocusCards = getAccountSettingsFocusCards({
    activePanel,
    signedIn,
  });
  const activeAccountSettingsFocusCard =
    accountSettingsFocusCards.find((item) => item.id === activeAccountSettingsView) ?? accountSettingsFocusCards[0];
  const otherAccountSettingsFocusCards = accountSettingsFocusCards.filter((item) => item.id !== activeAccountSettingsView);
  const visibleOtherAccountSettingsFocusCards = otherAccountSettingsFocusCards.slice(0, 1);
  const hiddenOtherAccountSettingsFocusCards = otherAccountSettingsFocusCards.slice(1);

  const selectAccountSettingsView = (nextView: AccountSettingsView) => {
    const normalizedView = normalizeAccountSettingsView(nextView);
    setAccountSettingsView(normalizedView);
    if (normalizedView === "basic") {
      setActivePanel("account");
      return;
    }

    if (normalizedView === "connections") {
      setActivePanel(activePanel === "external" || activePanel === "ai" ? activePanel : "ai");
      return;
    }

    setActivePanel(activePanel === "device" || activePanel === "memory" ? activePanel : "memory");
  };

  return (
    <section className={styles.page} data-theme={theme} aria-label="계정 설정">
      <div
        className={styles.shell}
        data-mode={showOnlyLogin ? "login" : "settings"}
        data-account-login-layout={showOnlyLogin ? "top_aligned_single_step" : "settings_tabs"}
      >
        <header className={styles.header}>
          <div className={styles.headerLead}>
            {signedIn ? (
              <Link
                href="/"
                className={styles.backArrow}
                aria-label="채팅으로 돌아가기"
                title="채팅으로 돌아가기"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </Link>
            ) : null}
            <div className={styles.headerTitle}>
              <span className={styles.brand}>
                <img src="/modycrew-logo-256.png" alt="" />
                ModyCrew
              </span>
              <h1>{showOnlyLogin ? "로그인" : selectedPanel.title}</h1>
            </div>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.themeToggle}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
              title={theme === "dark" ? "밝은 화면으로 전환" : "어두운 화면으로 전환"}
              data-theme-toggle-label="korean"
            >
              {theme === "dark" ? "밝게" : "어둡게"}
            </button>
            {signedIn && activePanel !== "account" ? (
              <button
                type="button"
                className={styles.profileButton}
                onClick={() => {
                  setActivePanel("account");
                  setAccountSettingsView("basic");
                }}
              >
                내 프로필
              </button>
            ) : null}
            {signedIn && activePanel !== "account" ? (
              <button
                type="button"
                className={styles.accountSignOutButton}
                onClick={handleSignOut}
                disabled={signOutBusy}
                aria-label={session?.email ? `${session.email} 로그아웃` : "로그아웃"}
              >
                {signOutBusy ? "로그아웃 중" : "로그아웃"}
              </button>
            ) : null}
          </div>
        </header>

        {/* 화면 크기·사무실 배경은 내 프로필에서만. 모든 설정 위에 먼저 떠서 AI 연결을 찾기 어려웠다. */}
        {!showOnlyLogin && activeAccountSettingsView === "basic" ? <DisplayPreferences /> : null}
        {!showOnlyLogin && activeAccountSettingsView === "basic" ? <TutorialSettings /> : null}
        {showOnlyLogin ? (
          <p className={styles.loginNote}>
            로그인만 하면 됩니다. AI 연결과 업무 설정은 들어간 뒤에 한 단계씩 열립니다.
          </p>
        ) : (
          <>
            <p className={styles.description}>{selectedPanel.description}</p>
          </>
        )}

        {!showOnlyLogin ? (
          <nav
            className={styles.accountViewTabs}
            aria-label="계정 설정 보기 방식"
            data-account-settings-organization="basic_connections_advanced"
            data-account-settings-tab-format="summary_connection_advanced_fixed"
            data-account-settings-tab-visible="all_views_directly_selectable"
            data-account-settings-tab-detail-default="visible_label_only"
            data-account-settings-user-config="preferred_view_per_page"
            data-account-settings-view={activeAccountSettingsView}
          >
            <details
              className={styles.accountViewMore}
              aria-label="다른 계정 설정"
            >
              <summary>다른 설정</summary>
              <div className={styles.accountViewMoreOptions}>
                {getAccountSettingsViewTabs({ signedIn, activePanel }).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    aria-label={`계정 설정 ${accountSettingsViewBaseLabel(tab.id)} 보기 · ${tab.label}`}
                    aria-selected={activeAccountSettingsView === tab.id}
                    data-account-settings-tab={tab.id}
                    data-account-settings-tab-role={accountSettingsViewBaseLabel(tab.id)}
                    data-active={activeAccountSettingsView === tab.id ? "true" : "false"}
                    onClick={() => selectAccountSettingsView(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </details>
          </nav>
        ) : null}

        {!showOnlyLogin ? (
          <details
            className={styles.accountSettingsFolderMap}
            aria-label="계정 설정 폴더 지도"
            data-account-settings-folder-map="basic_connections_advanced_slots"
            data-account-settings-folder-map-visible="summary_first_folder_slots_on_demand"
            data-account-settings-folder-map-default="closed"
            data-account-settings-folder-map-body="hidden_until_user_opens"
            data-account-settings-folder-map-details-default="closed"
            data-account-settings-view={activeAccountSettingsView}
            data-active-view-count={activeAccountSettingsFocusCard.countLabel}
          >
            <summary className={styles.accountSettingsFolderHeader}>
              <span>설정 폴더</span>
              <strong>{settingsSummary.title}</strong>
              <small>{settingsSummary.detail} · 필요한 폴더만 열고 나머지는 접습니다.</small>
              </summary>
            <div className={styles.accountSettingsFolderMapBody}>
              <ol aria-label="계정 설정 폴더">
                {accountSettingsFocusCards.map((item) => (
                  <li
                    key={item.id}
                    data-state={item.state}
                    data-current={item.id === activeAccountSettingsView ? "true" : "false"}
                  >
                    <button type="button" onClick={() => selectAccountSettingsView(item.id)}>
                      <span>{item.label}</span>
                      <strong>{item.countLabel}</strong>
                      <small>{item.actionLabel}</small>
                    </button>
                  </li>
                ))}
              </ol>
              <details
                className={styles.accountSettingsFolderDetails}
                aria-label="계정 설정 구성 상세"
                data-account-settings-folder-details-default="closed"
              >
                <summary>
                  <span>구성 정리</span>
                  <strong>내 시작 화면과 보기별 설명</strong>
                </summary>
                <div className={styles.accountSettingsFolderDetailsBody}>
                  <div
                    className={styles.accountLayoutGuide}
                    data-account-settings-customization="preferred_view_reset"
                    data-page-layout-format="fixed_tabs_user_start_view"
                    data-account-settings-view={activeAccountSettingsView}
                    data-custom-layout={accountSettingsCustomized ? "true" : "false"}
                    data-preferred-view-state={accountSettingsCustomized ? "custom" : "default"}
                    aria-label="계정 설정 페이지 내 구성"
                  >
                    <div>
                      <span>내 시작 화면</span>
                      <strong>{settingsSummary.title}</strong>
                      <small>{settingsSummary.detail} · 탭 포맷은 유지하고 시작 화면만 바꿉니다.</small>
                    </div>
                    <p data-account-layout-helper="desktop_only_context">
                      {accountSettingsCustomized ? "현재 보기가 저장됨" : `${activeAccountViewTab.detail} · 기본 보기`}
                    </p>
                    <button
                      type="button"
                      onClick={() => selectAccountSettingsView("basic")}
                      disabled={activeAccountSettingsView === "basic"}
                    >
                      기본 보기
                    </button>
                  </div>
                  <section
                    className={styles.accountSettingsFocusSummary}
                    aria-label="계정 설정 보기별 한눈에 보기"
                    data-account-settings-focus-summary="active_view_first_then_other_views_on_demand"
                    data-account-settings-view={activeAccountSettingsView}
                    data-active-view-count={activeAccountSettingsFocusCard.countLabel}
                    data-other-view-disclosure="all_other_views_inside_details"
                    data-other-view-visible-count={visibleOtherAccountSettingsFocusCards.length}
                    data-other-view-hidden-count={hiddenOtherAccountSettingsFocusCards.length}
                  >
                    <article data-state={activeAccountSettingsFocusCard.state}>
                      <span>{activeAccountSettingsFocusCard.label}</span>
                      <strong>{activeAccountSettingsFocusCard.title}</strong>
                      <small>{activeAccountSettingsFocusCard.detail}</small>
                      <button type="button" onClick={() => selectAccountSettingsView(activeAccountSettingsFocusCard.id)}>
                        {activeAccountSettingsFocusCard.actionLabel}
                      </button>
                    </article>
                    <details
                      className={styles.accountSettingsOtherViewsFold}
                      aria-label="계정 설정 다른 보기 접힘"
                      data-account-settings-other-views-fold="all_other_views_on_demand"
                      data-account-settings-other-views-default="closed"
                      data-account-settings-other-views-body="hidden_until_user_opens"
                    >
                      <summary>
                        <span>다른 보기</span>
                        <strong>
                          {visibleOtherAccountSettingsFocusCards.length + hiddenOtherAccountSettingsFocusCards.length}개
                        </strong>
                      </summary>
                      <div className={styles.accountSettingsOtherViewRail} aria-label="계정 설정 다른 보기 요약">
                        <ol
                          className={styles.accountSettingsOtherViewList}
                          aria-label="계정 설정 바로 갈 다른 보기"
                          data-account-settings-other-view-list="one_next_view"
                        >
                          {visibleOtherAccountSettingsFocusCards.map((item) => (
                            <li key={item.id} data-state={item.state}>
                              <button type="button" onClick={() => selectAccountSettingsView(item.id)}>
                                <span>{item.label}</span>
                                <strong>{item.countLabel}</strong>
                                <small>{item.actionLabel}</small>
                              </button>
                            </li>
                          ))}
                        </ol>
                        {hiddenOtherAccountSettingsFocusCards.length ? (
                          <details
                            className={styles.accountSettingsFocusMore}
                            aria-label="계정 설정 나머지 보기"
                            data-account-settings-other-views-more="remaining_views_collapsed"
                            data-account-settings-other-views-more-default="closed"
                          >
                            <summary>
                              <span>나머지 보기</span>
                              <strong>{hiddenOtherAccountSettingsFocusCards.length}개 접힘</strong>
                            </summary>
                            <ol>
                              {hiddenOtherAccountSettingsFocusCards.map((item) => (
                                <li key={item.id} data-state={item.state}>
                                  <button type="button" onClick={() => selectAccountSettingsView(item.id)}>
                                    <span>{item.label}</span>
                                    <strong>{item.countLabel}</strong>
                                    <small>{item.actionLabel}</small>
                                  </button>
                                </li>
                              ))}
                            </ol>
                          </details>
                        ) : null}
                      </div>
                    </details>
                  </section>
                </div>
              </details>
            </div>
          </details>
        ) : null}

        <div className={styles.panel}>{showOnlyLogin || activeAccountSettingsView === "basic" ? accountPanel.content : null}</div>

        {!showOnlyLogin && activeAccountSettingsView !== "basic" ? (
          <details
            className={styles.advancedSettingsDetails}
            aria-label="추가 계정 설정 접힘"
            data-account-settings-panel={activeAccountSettingsView}
            data-account-settings-display="selected_card_immediate"
            data-account-settings-visible-panel-count={visibleSettingsPanels.length}
            data-account-settings-active-panel={activePanel}
            open
          >
            <summary>
              <span>{settingsSummary.label}</span>
              <strong>{settingsSummary.title}</strong>
              <small>{settingsSummary.detail}</small>
            </summary>
            <div className={styles.advancedSettingsBody}>
              {selectedAdvancedPanel ? (
                <section
                  className={styles.accountSettingsGroupSummary}
                  aria-label="현재 설정 묶음 요약"
                  data-account-settings-group-disclosure="selected_panel_first_other_settings_inside_details"
                  data-account-settings-selected-panel={selectedAdvancedPanel.id}
                  data-account-settings-other-count={otherVisibleSettingsPanels.length}
                  data-account-settings-selected-visible-count="1"
                  data-account-settings-other-default="closed"
                >
                  <article>
                    <span>지금 열림</span>
                    <strong>{selectedAdvancedPanel.title}</strong>
                    <small>{selectedAdvancedPanel.description}</small>
                  </article>
                  {otherVisibleSettingsPanels.length ? (
                    <details
                      className={styles.accountSettingsOtherPanelFold}
                      aria-label="같은 탭의 다른 계정 설정"
                      data-account-settings-other-panel-fold="remaining_settings_collapsed"
                      data-account-settings-other-panel-default="closed"
                    >
                      <summary>
                        <span>같은 탭 다른 설정</span>
                        <strong>{otherVisibleSettingsPanels.length}개 접힘</strong>
                      </summary>
                      <ol aria-label="같은 탭의 다른 설정">
                        {otherVisibleSettingsPanels.map((panel) => (
                          <li key={`other-setting-${panel.id}`}>
                            <button
                              type="button"
                              onClick={() => {
                                setActivePanel(panel.id);
                                setAccountSettingsView(panel.id === "device" || panel.id === "memory" ? "advanced" : "connections");
                              }}
                            >
                              <span>{panel.label}</span>
                              <strong>{panel.title}</strong>
                            </button>
                          </li>
                        ))}
                      </ol>
                    </details>
                  ) : (
                    <p>이 탭에서는 이 설정만 확인하면 됩니다.</p>
                  )}
                </section>
              ) : null}
              <details
                className={styles.accountSettingsPanelSwitcher}
                aria-label="추가 설정 종류"
                data-account-settings-panel-switcher="all_settings_direct"
                data-account-settings-panel-switcher-default="closed"
                data-account-settings-panel-switcher-count={visibleSettingsPanels.length}
              >
                <summary style={{ display: "grid" }}>
                  <span>설정 바꾸기</span>
                  <strong>{visibleSettingsPanels.length}개 설정</strong>
                </summary>
                <nav className={styles.tabs} aria-label="추가 계정 설정 선택 목록">
                  {visibleSettingsPanels.map((panel) => (
                    <button
                      key={panel.id}
                      type="button"
                      aria-pressed={panel.id === activePanel}
                      onClick={() => {
                        setActivePanel(panel.id);
                        setAccountSettingsView(panel.id === "device" || panel.id === "memory" ? "advanced" : "connections");
                      }}
                    >
                      {panel.label}
                    </button>
                  ))}
                </nav>
              </details>
              {selectedAdvancedPanel ? (
                <div className={styles.panel}>{selectedAdvancedPanel.content}</div>
              ) : (
                <p className={styles.advancedSettingsHint}>
                  필요한 설정 묶음을 위에서 고르면 이 자리에서만 펼쳐집니다.
                </p>
              )}
            </div>
          </details>
        ) : null}

        <footer className={styles.legalFootnote}>
          <Link href="/legal">법적 고지</Link>
          <Link href="/privacy">개인정보처리방침</Link>
          <Link href="/terms">이용약관</Link>
          <span>출시 전 오픈소스, 개인정보, 승인 필요 작업을 확인합니다.</span>
        </footer>
      </div>
    </section>
  );
}

function accountSettingsSummary(view: AccountSettingsView) {
  if (view === "connections") {
    return {
      label: "연결 설정",
      title: "외부 계정과 AI 연결만 여기에서 엽니다",
      detail: "기기 동기화는 고급으로 분리",
    };
  }
  if (view === "advanced") {
    return {
      label: "고급 설정",
      title: "기억 위치와 PC 이어 쓰기만 따로 확인합니다",
      detail: "기본 설정과 연결 설정에서 분리",
    };
  }
  return {
    label: "기본 설정",
    title: "로그인 상태와 프로필만 확인합니다",
    detail: "연결과 고급 설정은 탭으로 분리",
  };
}

function accountSettingsViewBaseLabel(view: AccountSettingsView) {
  if (view === "connections") return "연결";
  if (view === "advanced") return "고급";
  return "요약";
}

function getAccountSettingsViewTabs(input: {
  signedIn: boolean;
  activePanel: PanelId;
}): Array<{ id: AccountSettingsView; label: string; detail: string }> {
  return [
    {
      id: "basic",
      label: "기본",
      detail: input.signedIn ? "프로필" : "로그인",
    },
    {
      id: "connections",
      label: "연결",
      detail: input.activePanel === "external" || input.activePanel === "ai" ? "열림" : "계정·AI",
    },
    {
      id: "advanced",
      label: "고급",
      detail: input.activePanel === "memory" || input.activePanel === "device" ? "열림" : "기억·기기",
    },
  ];
}

function getAccountSettingsFocusCards(input: {
  activePanel: PanelId;
  signedIn: boolean;
}): Array<{
  id: AccountSettingsView;
  label: string;
  title: string;
  detail: string;
  countLabel: string;
  actionLabel: string;
  state: "profile" | "connections" | "advanced";
}> {
  return [
    {
      id: "basic",
      label: "기본",
      title: input.signedIn ? "내 프로필과 로그아웃만" : "로그인만 먼저",
      detail: input.signedIn
        ? "현재 로그인 계정 상태를 먼저 확인합니다."
        : "처음에는 AI 키, 외부 계정, 기기 동기화를 묻지 않습니다.",
      countLabel: "1개",
      actionLabel: "기본 보기",
      state: "profile",
    },
    {
      id: "connections",
      label: "연결",
      title: input.activePanel === "ai" ? "AI 연결 확인 중" : "계정 보관함과 AI 연결",
      detail: "외부 사이트 계정과 AI 답변 연결은 필요할 때만 엽니다.",
      countLabel: "2개",
      actionLabel: "연결 보기",
      state: "connections",
    },
    {
      id: "advanced",
      label: "고급",
      title: input.activePanel === "device" ? "이 PC 업무실 이어 쓰기" : "기억 위치 먼저",
      detail: "기억 저장 위치와 기기 동기화는 고급 보기 안에서만 엽니다.",
      countLabel: "2개",
      actionLabel: "고급 보기",
      state: "advanced",
    },
  ];
}
