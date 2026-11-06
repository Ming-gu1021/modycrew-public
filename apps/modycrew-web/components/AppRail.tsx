"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { navigateInternalPath } from "@/lib/safe-navigation";
import { openWorkBrowserPane } from "@/lib/work-browser";
import { openWorkspaceFiles, closeWorkspacePane, WORKSPACE_PANE_STATE } from "@/lib/workspace-side-pane";
import { useThemeMode } from "@/lib/theme-mode";
import { COMPANY_UNREAD_EVENT, readCompanyUnreadCount } from "@/lib/company-unread.mjs";
import { createDesktopBridge } from "@/lib/desktop-bridge";
import styles from "./AppRail.module.css";
import AIUsagePopover from "./AIUsagePopover";
import DesktopUpdateRailButton from "./DesktopUpdateRailButton";
import AssistantRailButton from "./AssistantRailButton";
import FirstUseTutorial from "./FirstUseTutorial";
import { openFirstUseTutorial } from "@/lib/first-use-tutorial";

type RailItem = {
  href: "/" | "/crew" | "/office" | "/account" | "/receipts" | "/documents" | "/automation" | "/company" | "/browser" | "/metrics" | "/dev";
  label: string;
  icon: RailIconName;
  ariaLabel: string;
  description: string;
  panel?: RailPanelName;
  legacyPath?: "/office" | "/connect" | "/learn";
  crewOffice?: boolean;
  /** 승인함: 크루가 외부로 보내거나 등록하기 전에 확인을 기다리는 일. 대기 수를 배지로 보여 준다. */
  approvals?: boolean;
};

type RailPanelName = "office" | "connect" | "learn" | "messengers" | "workers" | "skills" | "control" | "mail";

const primaryRailItems: RailItem[] = [
  { href: "/", label: "대화", icon: "home", ariaLabel: "AI 업무 대화", description: "AI에게 일을 말하기" },
  { href: "/office", label: "승인함", icon: "shield", ariaLabel: "승인함", description: "보내기·등록 전 확인", approvals: true },
  { href: "/crew", label: "AI 직원", icon: "users", ariaLabel: "AI 직원 고용과 우리 팀", description: "직원 고용·일 맡기기" },
  { href: "/dev", label: "개발", icon: "code", ariaLabel: "개발 작업실", description: "폴더 프로젝트·코드 결과·실행" },
  { href: "/office", label: "크루 사무실", icon: "building", ariaLabel: "크루 사무실", description: "크루의 업무와 결과 보기", crewOffice: true },
];

const settingsRailItem: RailItem = {
  href: "/account",
  label: "설정",
  icon: "settings",
  ariaLabel: "설정",
  description: "계정과 앱 환경",
};

/** 자주 쓰는 작업은 레일에, 운영과 설정은 더보기에 둡니다. */
const workspaceRailItems: RailItem[] = [
  { href: "/", label: "파일", icon: "folder", ariaLabel: "파일과 회사 공유 자료", description: "작업 옆에서 파일 열기", panel: "learn", legacyPath: "/learn" },
                                                                  
  // 문서·팀 자료의 링크나 AI가 승인받아 연 주소는 지금처럼 작업 옆 '웹 페이지' 탭으로 열린다.
  { href: "/metrics", label: "업무 현황", icon: "grid", ariaLabel: "업무 현황과 성과 지표", description: "실제 업무 기록을 차트로 보기" },
  { href: "/company", label: "우리 회사", icon: "building", ariaLabel: "우리 회사 구성원과 팀 채팅", description: "회사 연결·팀 대화·공용 AI" },
  { href: "/documents", label: "문서", icon: "book", ariaLabel: "문서와 PPT 만들기", description: "한글·Word·PPT·Excel 만들기" },
  { href: "/", label: "메일", icon: "mail", ariaLabel: "받은 메일 모아 보기", description: "연결한 메일 한곳에서", panel: "mail" },
];

const secondaryRailItems: RailItem[] = [
  { href: "/automation", label: "회사 운영", icon: "flow", ariaLabel: "회사 운영과 부서별 자동화", description: "회사 자료·부서·장부·자동화 관리" },
  { href: "/", label: "오피스", icon: "grid", ariaLabel: "AI 오피스", description: "직원 상태와 승인 보기", panel: "office", legacyPath: "/office" },
  { href: "/", label: "연결", icon: "plug", ariaLabel: "메일과 업무 도구 연결", description: "메일·캘린더 연결", panel: "connect", legacyPath: "/connect" },
  { href: "/", label: "팀원", icon: "users", ariaLabel: "AI 팀원 관리", description: "담당 직원 보기", panel: "workers" },
  { href: "/", label: "알림", icon: "bell", ariaLabel: "알림 연결", description: "메신저 알림 연결", panel: "messengers" },
  { href: "/", label: "기능", icon: "spark", ariaLabel: "추가 업무 기능", description: "필요한 기능 찾기", panel: "skills" },
  { href: "/", label: "내 PC", icon: "monitor", ariaLabel: "내 PC 작업", description: "열린 창과 파일 작업", panel: "control" },
];

const receiptRailItem: RailItem = {
  href: "/receipts",
  label: "\uC601\uC218\uC99D",
  icon: "inbox",
  ariaLabel: "\uC601\uC218\uC99D \uC815\uB9AC",
  description: "\uC0AC\uC9C4\uC744 \uBB38\uC11C \uCD08\uC548\uC73C\uB85C \uC815\uB9AC",
};

const railCollapsedStorageKey = "modycrew-app-rail-collapsed-v1";

function readStoredRailCollapsed() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(railCollapsedStorageKey) !== "false";
}

export function AppRail() {
  const routerPathname = usePathname() ?? "/";
  const routerSearchParams = useSearchParams();
  const routerSearchKey = routerSearchParams?.toString() ?? "";
  const { theme, setTheme } = useThemeMode();
  const [collapsed, setCollapsed] = useState(true);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [locationSnapshot, setLocationSnapshot] = useState<{ pathname: string; search: string } | null>(null);
  const [companyUnread, setCompanyUnread] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [sidePanel,setSidePanel]=useState<{open:boolean;tab:string}>({open:false,tab:''});
  const moreMenuRef = useRef<HTMLDetailsElement>(null);
  const moreMenuSummaryRef = useRef<HTMLElement>(null);
  const pathname = locationSnapshot?.pathname ?? routerPathname;
  const searchParams = new URLSearchParams(locationSnapshot?.search ?? routerSearchKey);
  const normalizedPathname = pathname.replace(/\/+$/u, "") || "/";
  const moreMenuRouteKey = `${pathname}?${searchParams.toString()}`;

  useEffect(() => {
    setCollapsed(readStoredRailCollapsed());
  }, []);
  useEffect(()=>{const update=(event:Event)=>setSidePanel((event as CustomEvent<{open:boolean;tab:string}>).detail);window.addEventListener(WORKSPACE_PANE_STATE,update);return()=>window.removeEventListener(WORKSPACE_PANE_STATE,update);},[]);

  // 팀 대화 새 글 표시(점 하나). 개수와 알림은 CompanyInboxWatcher가 계산한다.
  useEffect(() => {
    setCompanyUnread(readCompanyUnreadCount());
    const sync = (event: Event) => setCompanyUnread(Number((event as CustomEvent<{ count?: number }>).detail?.count) || 0);
    window.addEventListener(COMPANY_UNREAD_EVENT, sync);
    return () => window.removeEventListener(COMPANY_UNREAD_EVENT, sync);
  }, []);

  // 승인 대기 수: 데스크톱 앱이 승인함(인박스)이 바뀔 때마다 보내는 개수를 그대로 쓴다.
  // 웹 미리보기처럼 연결이 없으면 0으로 두고 배지를 숨긴다(추정 숫자를 만들지 않는다).
  useEffect(() => {
    const bridge = createDesktopBridge();
    if (!bridge.isAvailable) return;
    let cancelled = false;
    void bridge
      .getInboxAttention()
      .then((attention) => {
        if (!cancelled) setPendingApprovals(attention.pendingApprovalCount);
      })
      .catch(() => undefined);
    const unsubscribe = bridge.onInboxChanged((change) => setPendingApprovals(change.pendingApprovalCount));
    return () => {
      cancelled = true;
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, []);

  useEffect(() => {
    const syncLocation = () => {
      const next = { pathname: window.location.pathname, search: window.location.search.slice(1) };
      setLocationSnapshot((current) =>
        current?.pathname === next.pathname && current.search === next.search ? current : next,
      );
    };
    syncLocation();
    window.addEventListener("popstate", syncLocation);
    return () => window.removeEventListener("popstate", syncLocation);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = { pathname: window.location.pathname || routerPathname, search: window.location.search.slice(1) || routerSearchKey };
    setLocationSnapshot((current) =>
      current?.pathname === next.pathname && current.search === next.search ? current : next,
    );
  }, [routerPathname, routerSearchKey]);

  useEffect(() => {
    if (moreMenuRef.current?.open) moreMenuRef.current.open = false;
    setMoreMenuOpen(false);
  }, [moreMenuRouteKey]);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(railCollapsedStorageKey, String(next));
      return next;
    });
  };
  const closeMoreMenu = (restoreSummaryFocus = false) => {
    if (moreMenuRef.current?.open) moreMenuRef.current.open = false;
    setMoreMenuOpen(false);
    if (restoreSummaryFocus && typeof window !== "undefined") {
      window.requestAnimationFrame(() => moreMenuSummaryRef.current?.focus());
    }
  };
  const handleMoreMenuKeyDown = (event: KeyboardEvent<HTMLDetailsElement>) => {
    if (event.key !== "Escape" || !moreMenuRef.current?.open) return;
    event.preventDefault();
    event.stopPropagation();
    closeMoreMenu(true);
  };
  const isWorkbenchPreview = searchParams?.get("preview") === "workbench";
  const isWorkerCompanion = searchParams?.get("workerCompanion") === "1";
  const activePanel = searchParams?.get("panel") ?? null;
  const activeSingleSetting = searchParams?.get("singleSetting") ?? "";
  const crewOfficeActive = normalizedPathname === "/office" && searchParams.get("officeSpace") === "crew";
  const fullWorkspacePaths = new Set(["/office", "/connect", "/learn"]);
  const isWorkspaceContext =
    (pathname === "/" && Boolean(activePanel)) ||
    fullWorkspacePaths.has(normalizedPathname) ||
    searchParams?.get("view") === "full" ||
    searchParams?.get("workspaceMode") === "full";
  const isActive = (item: RailItem) => {
    if (item.crewOffice) return crewOfficeActive;
    if (item.approvals) return normalizedPathname === "/office" && !crewOfficeActive && searchParams.get("officeView") === "approval";
    if (item.panel === "office" && normalizedPathname === "/office") return !crewOfficeActive && searchParams.get("officeView") !== "approval";
    if (item.panel === "messengers") {
      return (
        (pathname === "/" && activePanel === item.panel) ||
        (pathname === "/connect" && activeSingleSetting === "messenger-channel")
      );
    }
    if (item.panel === "connect" && pathname === "/connect" && activeSingleSetting === "messenger-channel") {
      return false;
    }
    return item.panel
      ? (pathname === "/" && activePanel === item.panel) || pathname === item.legacyPath
      : item.href === "/"
        ? pathname === "/" && !activePanel
        : pathname.startsWith(item.href);
  };
  const withPreview = (href: string) => {
    if (!isWorkbenchPreview) return href;
    const separator = href.includes("?") ? "&" : "?";
    const mock = searchParams.get("mockRuntime") === "1" ? "&mockRuntime=1" : "";
    return `${href}${separator}preview=workbench${mock}`;
  };
  const sideHrefFor = (item: RailItem) => {
    if (item.crewOffice) return withPreview("/office?officeSpace=crew");
    if (item.approvals) return withPreview("/office?officeView=approval");
    if (!item.panel) return withPreview(item.href);
    const params = new URLSearchParams();
    params.set("panel", item.panel);
    if (item.panel === "messengers") params.set("singleSetting", "messenger-channel");
    if (isWorkbenchPreview) params.set("preview", "workbench");
    return `/?${params.toString()}`;
  };
  const fullHrefFor = (item: RailItem) => {
    if (!item.panel) return sideHrefFor(item);
    if (item.panel === "office") return withPreview("/office");
    if (item.panel === "learn") return withPreview("/learn?view=full");
    if (item.panel === "connect") return withPreview("/connect?view=full");
    if (item.panel === "messengers") return withPreview("/connect?view=full&singleSetting=messenger-channel");
    const params = new URLSearchParams();
    params.set("panel", item.panel);
    params.set("view", "full");
    if (item.panel === "workers") params.set("workerTab", "employees");
    if (isWorkbenchPreview) params.set("preview", "workbench");
    return `/?${params.toString()}`;
  };
  const targetModeFor = (item: RailItem) =>
    item.panel && isWorkspaceContext ? "full" : "side";
  const targetHrefFor = (item: RailItem) =>
    item.panel ? (targetModeFor(item) === "full" ? fullHrefFor(item) : sideHrefFor(item)) : sideHrefFor(item);
  const modeLabelFor = (item: RailItem) => {
    if (!item.panel) return "";
    return targetModeFor(item) === "full" ? "크게 열기" : "옆에서 열기";
  };
  const handlePanelClick = (item: RailItem) => (event: MouseEvent<HTMLAnchorElement>) => {
    // 같은 /office 안에서 승인 화면으로 옮길 때는 화면이 주소의 officeView 를 다시 읽도록 새로 연다.
    if (item.approvals && normalizedPathname === "/office" && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
      event.preventDefault();
      navigateInternalPath(sideHrefFor(item));
      return;
    }
    if ((item.crewOffice || (item.panel === "office" && crewOfficeActive)) && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
      event.preventDefault();
      navigateInternalPath(item.crewOffice ? sideHrefFor(item) : fullHrefFor(item));
      return;
    }
    if (!item.panel || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (typeof window === "undefined" || pathname !== "/") return;
    const targetMode = targetModeFor(item);
    const targetHref = targetHrefFor(item);
    if (targetMode === "full") {
      event.preventDefault();
      navigateInternalPath(targetHref);
      return;
    }
    event.preventDefault();
    window.history.pushState(null, "", targetHref);
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.dispatchEvent(
      new CustomEvent("modycrew:workspace-panel", {
        detail: {
          panel: item.panel,
          label: item.label,
          href: targetHref,
          mode: targetMode,
        },
      }),
    );
  };
  const renderRailLink = (item: RailItem, closeMoreMenuOnSelect = false) => {
    if (item.href === '/browser'||item.panel==='learn') return <button key={item.href==='/browser'?'browser':'files'} type="button" className={`${styles.item} ${styles.actionButton} ${sidePanel.open&&sidePanel.tab===(item.href==='/browser'?'browser':'files')?styles.active:''}`} aria-label={item.href==='/browser'?'업무 브라우저 사이드창 열기':'파일 사이드 패널 열기'} aria-pressed={sidePanel.open&&sidePanel.tab===(item.href==='/browser'?'browser':'files')} title={item.href==='/browser'?'현재 작업 옆에서 브라우저 열기':'현재 작업 옆에서 파일·회사 공유 자료 열기'} onClick={() => { closeMoreMenu(true);if(sidePanel.open&&sidePanel.tab===(item.href==='/browser'?'browser':'files'))closeWorkspacePane();else item.href==='/browser'?openWorkBrowserPane():openWorkspaceFiles(); }}>
      <span className={styles.icon} aria-hidden="true"><RailIcon name={item.icon} /></span>
      <span className={styles.itemText}><span className={styles.label}>{item.href==='/browser'?'브라우저':'파일'}</span><small>지금 업무 옆에서 열기</small></span>
    </button>;
    const active = isActive(item);
    const unread = item.href === "/company" && !item.panel && companyUnread > 0;
    const approvalCount = item.approvals ? pendingApprovals : 0;
    const ariaLabel = approvalCount > 0 ? `${item.ariaLabel} · 승인 대기 ${approvalCount}건` : item.ariaLabel;
    return (
      <Link
        key={item.panel ?? `${item.href}-${item.label}`}
        href={targetHrefFor(item) as Route}
        // 대화('/')로 돌아오는 길만 미리 불러 둔다. 나머지 화면까지 미리 불러오면 처음 여는
        // 화면이 쓰지도 않는 코드를 함께 받아 굼떠진다.
        prefetch={item.href === "/" ? undefined : false}
        onClick={(event) => {
          if (closeMoreMenuOnSelect) closeMoreMenu(true);
          handlePanelClick(item)(event);
        }}
        className={`${styles.item} ${active ? styles.active : ""}`}
        aria-label={ariaLabel}
        aria-current={active ? "page" : undefined}
        title={item.panel ? `${item.ariaLabel} · ${modeLabelFor(item)}` : ariaLabel}
        data-target-mode={item.panel ? targetModeFor(item) : undefined}
        data-workspace-tab={item.panel ?? undefined}
        data-unread={unread ? "true" : undefined}
        data-approval-count={item.approvals ? approvalCount : undefined}
      >
        <span className={`${styles.icon} ${unread || approvalCount > 0 ? styles.iconUnread : ""}`} aria-hidden="true">
          <RailIcon name={item.icon} />
          {unread ? <span className={styles.unreadDot} /> : null}
          {approvalCount > 0 ? <span className={styles.countBadge}>{approvalCount > 99 ? "99+" : approvalCount}</span> : null}
        </span>
        <span className={styles.itemText}>
          <span className={styles.label}>{item.crewOffice ? <><span className={styles.crewOfficeFull}>크루 사무실</span><span className={styles.crewOfficeShort}>사무실</span></> : item.label}</span>
          <small>{item.description}</small>
        </span>
      </Link>
    );
  };
  const triggerRailAction = (action: "companion" | "progress" | "theme" | "tutorial") => {
    if (action === "tutorial") {
      closeMoreMenu(true);
      openFirstUseTutorial();
      return;
    }
    if (action === "theme") {
      setTheme(theme === "dark" ? "light" : "dark");
      return;
    }
    if (pathname !== "/") {
      const params = new URLSearchParams();
      if (isWorkbenchPreview) params.set("preview", "workbench");
      params.set("railAction", action);
      navigateInternalPath(`/?${params.toString()}` as Route);
      return;
    }
    window.dispatchEvent(new CustomEvent("modycrew:rail-action", { detail: { action } }));
  };
  const renderRailAction = (
    action: "companion" | "progress" | "theme" | "tutorial",
    label: string,
    icon: RailIconName,
    ariaLabel: string,
    description: string,
  ) => (
    <button
      key={action}
      type="button"
      className={`${styles.item} ${styles.actionButton}`}
      onClick={() => triggerRailAction(action)}
      aria-label={ariaLabel}
      title={ariaLabel}
      data-rail-action={action}
    >
      <span className={styles.icon} aria-hidden="true">
        <RailIcon name={icon} />
      </span>
      <span className={styles.itemText}>
        <span className={styles.label}>{label}</span>
        <small>{description}</small>
      </span>
    </button>
  );
  // 더보기 안의 목적지가 현재 화면이면 메뉴도 활성 상태로 표시합니다.
  const moreMenuActive = [...secondaryRailItems, receiptRailItem].some(isActive);
  if (isWorkerCompanion) return null;

  return (
    <aside
      className={`${styles.rail} mc-app-rail`}
      aria-label="ModyCrew 주요 메뉴"
      data-workspace-items={workspaceRailItems.length + secondaryRailItems.length}
      data-collapsed={collapsed ? "true" : "false"}
    >
      <div className={styles.brand}>
        <div className={styles.brandName} aria-label="ModyCrew">
          <img src="/modycrew-logo-256.png" alt="" />
          <strong>ModyCrew</strong>
        </div>
        <button
          type="button"
          className={styles.collapseButton}
          onClick={toggleCollapsed}
          aria-label={collapsed ? "왼쪽 메뉴 글자 표시" : "왼쪽 메뉴 아이콘만 보기"}
          title={collapsed ? "메뉴 글자 표시" : "아이콘만 보기"}
          aria-expanded={!collapsed}
          aria-controls="modycrew-main-navigation"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d={collapsed ? "m7.5 5 5 5-5 5" : "m12.5 5-5 5 5 5"} />
          </svg>
        </button>
      </div>
      <nav id="modycrew-main-navigation" className={styles.nav}>
        {/* 맨 위 MODY 탭: 팝업이 아니라 비서와 대화하는 화면으로 간다. */}
        <AssistantRailButton collapsed={collapsed} />
        {primaryRailItems.map((item) => renderRailLink(item))}
        {/* 파일·브라우저·업무·문서·메일은 항상 접근할 수 있습니다. */}
        {workspaceRailItems.map((item) => renderRailLink(item))}
        {secondaryRailItems.length ? (
          <details
            ref={moreMenuRef}
            className={styles.moreMenu}
            aria-label="ModyCrew 추가 메뉴"
            open={moreMenuOpen}
            onKeyDown={handleMoreMenuKeyDown}
            onToggle={(event) => setMoreMenuOpen(event.currentTarget.open)}
          >
            <summary
              ref={moreMenuSummaryRef}
              className={`${styles.item} ${styles.moreSummary} ${moreMenuActive ? styles.active : ""}`}
              aria-label="추가 메뉴"
              title="추가 메뉴"
            >
              <span className={styles.icon} aria-hidden="true">
                <RailIcon name="more" />
              </span>
              <span className={styles.itemText}>
                <span className={styles.label}>더보기</span>
                <small>팀원·알림·기타 기능</small>
              </span>
            </summary>
            <div className={styles.moreList}>
              {secondaryRailItems.map((item) => renderRailLink(item, true))}
              {renderRailLink(receiptRailItem, true)}
              {renderRailAction("progress", "진행", "clock", "진행상황 열기 또는 닫기", "현재 작업 상태")}
              {renderRailAction("theme", "화면", "theme", "라이트·다크 화면 전환", "밝기 바꾸기")}
              {renderRailAction("tutorial", "사용 안내", "book", "튜토리얼 다시 보기", "처음 사용 안내 다시 보기")}
            </div>
          </details>
        ) : null}
      </nav>
      <nav className={styles.utilityNav} aria-label="화면과 설정">
        <DesktopUpdateRailButton collapsed={collapsed} />
        <AIUsagePopover collapsed={collapsed} />
        {renderRailLink(settingsRailItem)}
      </nav>
      <FirstUseTutorial autoStart={normalizedPathname === "/"} />
    </aside>
  );
}

type RailIconName = "home"
  | "inbox"
  | "grid"
  | "plug"
  | "book"
  | "users"
  | "chat"
  | "settings"
  | "clock"
  | "theme"
  | "more"
  | "spark"
  | "monitor"
  // 접힌 레일은 아이콘만 보인다. 같은 말풍선·책 아이콘이 반복돼 '우리 회사'와 '메일',
  // '문서'와 '자료'를 구분할 수 없었다. 메뉴마다 뜻이 드러나는 아이콘을 따로 둔다.
  | "building"
  | "mail"
  | "folder"
  | "flow"
  | "bell"
  | "code"
  | "shield";

function RailIcon({ name }: { name: RailIconName }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {name === "shield" ? (
        <>
          <path d="M12 3.8 5.5 6.3v5.2c0 4.1 2.8 7.4 6.5 8.7 3.7-1.3 6.5-4.6 6.5-8.7V6.3z" />
          <path d="m9 12 2.2 2.2L15.2 10" />
        </>
      ) : null}
      {name === "home" ? (
        <>
          <path d="M4.5 11.2 12 5l7.5 6.2" />
          <path d="M6.5 10.5v8h11v-8" />
          <path d="M10 18.5v-5h4v5" />
        </>
      ) : null}
      {name === "code" ? (
        <>
          <path d="m8.5 8.5-4 3.5 4 3.5" />
          <path d="m15.5 8.5 4 3.5-4 3.5" />
          <path d="M13.5 6 10.5 18" />
        </>
      ) : null}
      {name === "inbox" ? (
        <>
          <path d="M4 5.5h16v9.2l-2.4 3.8H6.4L4 14.7z" />
          <path d="M8 14h2.2l1.2 1.8h1.2L13.8 14H16" />
        </>
      ) : null}
      {name === "grid" ? (
        <>
          <path d="M4.5 5.5h6v6h-6z" />
          <path d="M13.5 5.5h6v6h-6z" />
          <path d="M4.5 14.5h6v4h-6z" />
          <path d="M13.5 14.5h6v4h-6z" />
        </>
      ) : null}
      {name === "plug" ? (
        <>
          <path d="M9 5v5" />
          <path d="M15 5v5" />
          <path d="M7 10h10v2a5 5 0 0 1-10 0z" />
          <path d="M12 17v2" />
        </>
      ) : null}
      {name === "book" ? (
        <>
          <path d="M5 5.5h6a3 3 0 0 1 3 3v10a3 3 0 0 0-3-3H5z" />
          <path d="M19 5.5h-5a3 3 0 0 0-3 3" />
          <path d="M14 15.5h5v-10" />
        </>
      ) : null}
      {name === "users" ? (
        <>
          <path d="M9 10.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
          <path d="M3.8 19a5.2 5.2 0 0 1 10.4 0" />
          <path d="M16 11a2.5 2.5 0 1 0 0-5" />
          <path d="M15.2 14.3a4.8 4.8 0 0 1 5 4.7" />
        </>
      ) : null}
      {name === "chat" ? (
        <>
          <path d="M5 6.5h14v9H9l-4 3z" />
          <path d="M8.5 10h7" />
          <path d="M8.5 13h4.5" />
        </>
      ) : null}
      {name === "settings" ? (
        <>
          <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6z" />
          <path d="M12 3.8v2.1M12 18.1v2.1M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M3.8 12h2.1M18.1 12h2.1M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5" />
        </>
      ) : null}
      {name === "clock" ? (
        <>
          <circle cx="12" cy="12" r="7.5" />
          <path d="M12 8v4.4l3 1.8" />
        </>
      ) : null}
      {name === "theme" ? (
        <>
          <circle cx="12" cy="12" r="7.5" />
          <path d="M12 4.5a7.5 7.5 0 0 0 0 15z" />
        </>
      ) : null}
      {name === "more" ? (
        <>
          <path d="M5 12h.1" />
          <path d="M12 12h.1" />
          <path d="M19 12h.1" />
        </>
      ) : null}
      {name === "spark" ? (
        <>
          <path d="M12 4.5 13.7 9l4.8 1.7-4.8 1.7L12 17l-1.7-4.6-4.8-1.7L10.3 9z" />
          <path d="M18.5 15.5 19.2 17l1.3.5-1.3.5-.7 1.5-.7-1.5-1.3-.5 1.3-.5z" />
        </>
      ) : null}
      {name === "monitor" ? (
        <>
          <path d="M4.5 5.5h15v10h-15z" />
          <path d="M9 19h6" />
          <path d="M12 15.5V19" />
        </>
      ) : null}
      {name === "building" ? (
        <>
          <path d="M5.5 19.5V5.5h8v14" />
          <path d="M13.5 9.5h5v10" />
          <path d="M4 19.5h16" />
          <path d="M8 8.5h3M8 11.5h3M8 14.5h3M16 12.5h.1M16 15.5h.1" />
        </>
      ) : null}
      {name === "mail" ? (
        <>
          <path d="M4.5 6.5h15v11h-15z" />
          <path d="m5 7.5 7 5.5 7-5.5" />
        </>
      ) : null}
      {name === "folder" ? (
        <>
          <path d="M4 7.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2h7a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
          <path d="M4 10.5h16" />
        </>
      ) : null}
      {name === "flow" ? (
        <>
          <path d="M7 5.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
          <path d="M17 15.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
          <path d="M9 7.5h5.5a2.5 2.5 0 0 1 0 5h-5a2.5 2.5 0 0 0 0 5H15" />
        </>
      ) : null}
      {name === "bell" ? (
        <>
          <path d="M7 16.5V11a5 5 0 0 1 10 0v5.5l1.5 1.5h-13z" />
          <path d="M10.5 20h3" />
        </>
      ) : null}
    </svg>
  );
}
