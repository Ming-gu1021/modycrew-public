"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { createDesktopBridge } from "@/lib/desktop-bridge";
import {
  buildHomeReturnPath,
  buildOfficeApprovalFocusPath,
  classifyWorkItemFocusRoute,
  classifyWorkItemFocusTarget,
  decideWorkItemFocusRouteAction,
  normalizeWorkItemFocusRequest,
  publishWorkItemFocus,
  subscribeWorkItemFocus,
} from "@/lib/work-item-focus";

/**
 * 설치 앱에서 알림을 눌렀을 때 main 이 보내는 "이 카드로 옮겨 달라" 신호를 받는다.
 * 창을 다시 불러오지 않으므로 작성 중인 글과 진행 중인 답변이 그대로 남는다.
 * - 대화 화면(/): TodayPage 가 우편함을 구독해서 처리한다.
 * - 업무 오피스(/office): 승인함 카드는 여기서(승인함 펼치기·카드 맨 앞), 맡긴 업무는 업무판(TaskBoard)이 처리한다.
 * - 그 밖의 화면(문서·회사 운영·계정 등): 대화 화면으로 새로고침 없이 옮겨 가고, 요청은 우편함에 남겨
 *   TodayPage 가 같은 규칙으로 처리하게 한다(예전에는 여기서 요청이 2분 동안 아무도 받지 않았다).
 */
export function DesktopWorkItemFocusListener() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  // 같은 요청으로 두 번 옮겨 가지 않게 한다(새 구독자가 생길 때마다 우편함이 다시 보여 준다).
  const navigatedForRef = useRef(0);

  useEffect(() => {
    const bridge = createDesktopBridge();
    if (!bridge.isAvailable) return;
    let cancelled = false;
    const unsubscribe = bridge.onFocusWorkItem((raw) => {
      const request = normalizeWorkItemFocusRequest(raw);
      if (request) publishWorkItemFocus(request);
    });
    // 창이 막 열린 참이면 main 이 맡겨 둔 요청이 있다. 이 호출이 "신호 받을 준비됨" 알림이기도 하다.
    void bridge
      .takePendingWorkItemFocus()
      .then((raw) => {
        if (cancelled) return;
        const request = normalizeWorkItemFocusRequest(raw);
        if (request) publishWorkItemFocus(request);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const route = classifyWorkItemFocusRoute(pathname);
    if (route === "home") return;
    return subscribeWorkItemFocus((request) => {
      const action = decideWorkItemFocusRouteAction(route, classifyWorkItemFocusTarget(request), {
        detachedOfficeWindow: isDetachedOfficeWindow(),
      });
      if (action === "focus_office_approval") {
        focusOfficeApprovalInPlace(request.workItemId);
        return true;
      }
      if (action === "navigate_home" && navigatedForRef.current !== request.receivedAt) {
        // 일정 브리핑·메일→일정 카드 등은 대화 화면에 있다. 새로고침 없이 옮겨 가면 TodayPage 가
        // 우편함에 남은 이 요청을 주소로 들어올 때와 같은 규칙으로 연다.
        navigatedForRef.current = request.receivedAt;
        router.push(buildHomeReturnPath(window.location.search));
      }
      // 처리는 TodayPage·업무판이 한다. 요청은 우편함에 남긴다.
      return false;
    });
  }, [pathname, router]);

  return null;
}

function isDetachedOfficeWindow() {
  return new URLSearchParams(window.location.search).get("from") === "chat-window";
}

function focusOfficeApprovalInPlace(workItemId: string) {
  const nextPath = buildOfficeApprovalFocusPath(window.location.pathname, window.location.search, workItemId);
  window.history.replaceState(window.history.state, "", nextPath);
  // OfficeBoard 는 hashchange 때 주소를 다시 읽어 승인함 보기와 맨 앞 카드를 맞춘다.
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      // 후보 목록이 접혀 있으면(보이지 않으면) 승인함 보기 자체로 옮긴다.
      const candidates = document.getElementById("final-action-candidates");
      const target =
        candidates && candidates.getClientRects().length > 0
          ? candidates
          : document.querySelector<HTMLElement>("[data-office-board-view]");
      target?.scrollIntoView({ block: "start" });
    });
  });
}
