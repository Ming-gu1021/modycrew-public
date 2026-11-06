import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppShellGate } from "@/components/AppShellGate";
import DesktopUpdateBanner from "@/components/DesktopUpdateBanner";
import { InboxPersistenceNotice } from "@/components/InboxPersistenceNotice";
import "./globals.css";
import "./drawer-motion.css";

export const metadata: Metadata = {
  title: "ModyCrew",
  description: "한국형 AI 업무 오피스 — 받은 일을 AI 가 정리, 사용자는 승인만.",
  applicationName: "ModyCrew",
  icons: { icon: "/modycrew-logo-256.png", apple: "/modycrew-logo-256.png" },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

const scriptSrc =
  process.env.NODE_ENV === "development"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval';"
    : "script-src 'self' 'unsafe-inline';";

const contentSecurityPolicy = [
  "default-src 'self';",
  scriptSrc,
  "style-src 'self' 'unsafe-inline';",
  "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://firebaseinstallations.googleapis.com https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com;",
  "frame-src 'self' https://*.firebaseapp.com https://*.firebase.com;",
  "img-src 'self' data: https://*.googleusercontent.com;",
  "object-src 'none';",
  "base-uri 'none'",
].join(" ");

const themeBootstrapScript = `
(() => {
  try {
    const saved = window.localStorage.getItem("modycrew-theme-mode");
    const theme =
      saved === "light" || saved === "dark"
        ? saved
        : window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
          ? "dark"
          : "light";
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.modyTheme = theme;
    root.style.colorScheme = theme;
  } catch {
    document.documentElement.dataset.modyTheme = "light";
    document.documentElement.dataset.theme = "light";
    document.documentElement.style.colorScheme = "light";
  }
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-mody-flat: 탈-상자 렌더 레이어 스위치 (globals.css 맨 끝 블록). 끄면 즉시 기존 상자 UI로 롤백.
    // suppressHydrationWarning: head 의 테마 부트스트랩이 하이드레이션 전에
    // data-theme 를 저장된 값(dark 등)으로 바꿔 서버 초기값과 어긋나는 것은 의도된 동작.
    <html lang="ko" data-theme="light" data-mody-theme="light" data-mody-flat="true" suppressHydrationWarning>
      <head>
        <meta
          httpEquiv="Content-Security-Policy"
          content={contentSecurityPolicy}
        />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>
        <AppShellGate><DesktopUpdateBanner /><InboxPersistenceNotice />{children}</AppShellGate>
      </body>
    </html>
  );
}
