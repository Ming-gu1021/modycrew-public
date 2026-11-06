"use client";

/**
 * 팀 공유 자료에서 쓰는 두 가지 데스크톱 기능 — 무거운 desktop-bridge 를 끌어오지 않고
 * 설치 앱이 열어 둔 창구(window.modyCrewDesktopBridge)만 쓴다.
 *
 *  - 드라이브 파일 목록: 영수증 채널과 분리된 보기 전용 창구(mody.google-drive.v1).
 *  - 링크 열기: 앱의 안전한 열기 경로(컴퓨터 조작 open_url — http(s)만, 확인 번호를 받고
 *    확인해야 연다). 사람의 확인은 이 함수를 부르기 전에 화면에서 받는다.
 *    새 창(target=_blank)이나 주소 이동으로 여는 일은 없다.
 */

import type { GoogleDriveFilesPayload, GoogleDriveFilesResult } from "./desktop-bridge";

export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && Boolean(window.modyCrewDesktopBridge);
}

export async function listDriveFilesForSharing(payload: GoogleDriveFilesPayload): Promise<GoogleDriveFilesResult> {
  const bridge = typeof window !== "undefined" ? window.modyCrewDesktopBridge : undefined;
  if (!bridge) return { status: "desktop_required", userMessage: "드라이브 파일 연결은 설치된 ModyCrew 앱에서 할 수 있어요." };
  if (!bridge.googleDriveFiles) return { status: "desktop_update_required", userMessage: "앱을 최신 버전으로 업데이트하면 드라이브 파일을 고를 수 있어요." };
  return bridge.googleDriveFiles(payload);
}

export async function openExternalLinkSafely(url: string): Promise<{ ok: boolean; message: string }> {
  const bridge = typeof window !== "undefined" ? window.modyCrewDesktopBridge : undefined;
  if (!bridge?.requestDesktopControlAction || !bridge.confirmDesktopControlAction) {
    return { ok: false, message: "여기서는 링크를 바로 열 수 없어요. 링크를 복사해 브라우저에 붙여 넣어 주세요." };
  }
  const request = await bridge.requestDesktopControlAction({
    capability: "open_url",
    featureEnabled: true,
    target: url,
    instruction: "팀 공유 자료에 있는 링크를 브라우저로 열기",
  });
  const confirmationId = request.confirmation?.confirmationId;
  if (request.status !== "needs_user_confirmation" || !confirmationId) {
    return { ok: false, message: request.userMessage || "이 링크는 열 수 없어요." };
  }
  const opened = await bridge.confirmDesktopControlAction({ confirmationId, approved: true });
  return opened.status === "confirmed_opened"
    ? { ok: true, message: "브라우저에서 열었어요." }
    : { ok: false, message: opened.userMessage || "링크를 열지 못했어요. 잠시 뒤 다시 눌러 주세요." };
}

export async function copyLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}
