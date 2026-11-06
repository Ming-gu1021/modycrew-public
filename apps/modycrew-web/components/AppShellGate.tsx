"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AccountDeviceHeartbeat } from "@/components/AccountDeviceHeartbeat";
import { CompanyHostHeartbeat } from "@/components/CompanyHostHeartbeat";
import { CompanyInboxWatcher } from "@/components/CompanyInboxWatcher";
import { DesktopWorkItemFocusListener } from "@/components/DesktopWorkItemFocusListener";
import { AppRail } from "@/components/AppRail";
import { BrowserWorkspace } from "@/components/BrowserWorkspace";
import { onAuthSession } from "@/lib/firebase-client";
import { isSetupDone } from "@/lib/onboarding";
import styles from "./AppShellGate.module.css";
import "./rounded-ui.css";
import { useDisplayPreferencesController } from "./DisplayPreferences";

type Props = {
  children: ReactNode;
};

/**
 * 첫 진입 라우팅 가드.
 *
 *  로그인 안 됨 → /account
 *  로그인 됨 → 진행형 기본 설정 또는 채팅 작업실
 *
 * 첫 진입에서는 로그인만 보여주고, AI 연결/업무 연결은 인증 후 단계적으로 엽니다.
 */
export function AppShellGate({ children }: Props) {
  useDisplayPreferencesController();
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [isDetachedOfficeWindow, setIsDetachedOfficeWindow] = useState(false);
  const [isWorkerCompanion, setIsWorkerCompanion] = useState(false);

  const isFullscreenRoute =
    pathname.startsWith("/account") ||
    pathname.startsWith("/legal") ||
    pathname.startsWith("/privacy") ||
    pathname.startsWith("/terms") ||
    pathname.startsWith("/mail-share") ||
    pathname.startsWith("/welcome") ||
    pathname.startsWith("/setup");
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void onAuthSession((session) => {
      if (cancelled) return;
      setSignedIn(Boolean(session));
      setSessionChecked(true);
    }).then((nextUnsubscribe) => {
      unsubscribe = nextUnsubscribe;
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const from = params.get("from");
    setIsDetachedOfficeWindow(pathname.startsWith("/office") && from === "chat-window");
    setIsWorkerCompanion(params.get("workerCompanion") === "1");
  }, [pathname]);

  useEffect(() => {
    const isLocalWorkbenchPreview =
      typeof window !== "undefined" &&
      (window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "localhost" ||
        window.location.protocol === "modycrew:" ||
        window.location.protocol === "file:") &&
      new URLSearchParams(window.location.search).get("preview") === "workbench";

    if (isLocalWorkbenchPreview) {
      setReady(true);
      return;
    }
    if (typeof window === "undefined" || !sessionChecked) return;
    if (
      !signedIn &&
      (pathname.startsWith("/account") ||
        pathname.startsWith("/legal") ||
        pathname.startsWith("/privacy") ||
        pathname.startsWith("/terms") ||
        pathname.startsWith("/mail-share") ||
        pathname.startsWith("/welcome"))
    ) {
      setReady(true);
      return;
    }
    if (!signedIn) {
      setReady(false);
      router.replace("/account");
      return;
    }
    if (signedIn && pathname.startsWith("/welcome")) {
      setReady(false);
      router.replace(isSetupDone() ? "/" : "/setup");
      return;
    }
    setReady(true);
  }, [pathname, router, sessionChecked, signedIn]);

  if (!ready) {
    return (
      <div className={styles.loadingShell} role="status" aria-live="polite">
        <div className={styles.loadingBrand}>
          <img src="/modycrew-logo-256.png" alt="" width={40} height={40} />
          <div className={styles.loadingDot} aria-hidden="true" />
          <span>ModyCrew를 여는 중…</span>
        </div>
      </div>
    );
  }

  if (isFullscreenRoute) {
    return (
      <main className={styles.fullscreen}>
        <AccountDeviceHeartbeat />
        <CompanyHostHeartbeat />
        <CompanyInboxWatcher />
        <DesktopWorkItemFocusListener />
        {children}
      </main>
    );
  }

  return (
    <div
      className={`mc-app-shell ${isDetachedOfficeWindow ? "mc-app-shell-detached" : ""} ${isWorkerCompanion ? "mc-app-shell-companion" : ""}`}
      data-app="modycrew-web"
      data-worker-companion={isWorkerCompanion ? "true" : "false"}
    >
      <AccountDeviceHeartbeat />
      <CompanyHostHeartbeat />
      <CompanyInboxWatcher />
      <DesktopWorkItemFocusListener />
      {isDetachedOfficeWindow || isWorkerCompanion ? null : <AppRail />}
      <BrowserWorkspace enabled={!isWorkerCompanion}>
        <main className={`mc-workspace ${isDetachedOfficeWindow ? "mc-workspace-detached" : ""} ${isWorkerCompanion ? "mc-workspace-companion" : ""}`}>{children}</main>
      </BrowserWorkspace>
    </div>
  );
}
