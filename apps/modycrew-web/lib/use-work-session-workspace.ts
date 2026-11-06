"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkSessionWorkspace, WorkSessionWorkspaceCommand } from "../../../packages/domain/dist/work-session-workspace.js";
import type { DesktopBridgeApi } from "./desktop-bridge";
import { createWorkSessionScopeState, loadBrowserWorkSessionWorkspace, updateBrowserWorkSessionWorkspace, workSessionChangedEvent, workSessionStorageKey } from "./work-session-storage";

export type { WorkProject, WorkSessionMeta, WorkSessionWorkspace, WorkSessionWorkspaceCommand } from "../../../packages/domain/dist/work-session-workspace.js";

type WorkSessionView = ReturnType<ReturnType<typeof createWorkSessionScopeState>["snapshot"]>;

/**
 * 같은 저장소에서 revision 이 같으면 내용도 같다 — 업무 대화 명령은 적용될 때마다 revision 을 올린다
 * (packages/domain work-session-workspace applyWorkSessionWorkspaceCommand). 그래서 창에 포커스가
 * 돌아올 때마다 다시 읽어도, revision·저장소·오류·불러오는 중 여부가 같으면 "바뀐 것 없음"으로 본다.
 */
export function sameWorkSessionView(left: WorkSessionView, right: WorkSessionView): boolean {
  return left === right || (
    left.storage === right.storage &&
    left.loading === right.loading &&
    left.error === right.error &&
    left.state.revision === right.state.revision
  );
}

export function useWorkSessionWorkspace(bridge: DesktopBridgeApi | null | undefined, scopeKey = "", enabled = true) {
  const controller = useRef(createWorkSessionScopeState()).current;
  // 렌더 시점부터 이전 회사의 응답·명령을 차단한다. effect 실행 전에도 A 상태를 B에 노출하지 않는다.
  const token = controller.select(bridge, scopeKey, enabled);
  const [, render] = useState(0);
  const mounted = useRef(false);
  const pendingUpdates = useRef(new Set<Promise<WorkSessionWorkspace | null>>());
  const refreshView = useCallback(() => { if (mounted.current) render((value) => value + 1); }, []);
  // 다시 읽었는데 바뀐 게 없으면 화면 전체(TodayPage)를 다시 그리지 않는다.
  const refreshViewIfChanged = useCallback((before: WorkSessionView) => {
    if (!sameWorkSessionView(before, controller.snapshot())) refreshView();
  }, [controller, refreshView]);
  const expectedRoot = bridge?.isAvailable && scopeKey && scopeKey !== "browser" ? scopeKey : undefined;

  const reload = useCallback(async () => {
    if (!controller.isCurrent(token)) return null;
    const before = controller.snapshot();
    try {
      const result = bridge ? await bridge.loadWorkSessionWorkspace(expectedRoot) : await loadBrowserWorkSessionWorkspace();
      const workspace = controller.accept(token, result);
      if (!workspace && controller.isCurrent(token)) controller.fail(token, controller.snapshot().error, true);
      refreshViewIfChanged(before);
      return workspace;
    } catch (cause) {
      controller.fail(token, cause instanceof Error ? cause.message : "업무 대화를 불러오지 못했습니다.", true);
      refreshViewIfChanged(before);
      return null;
    }
  }, [bridge, controller, expectedRoot, refreshViewIfChanged, token]);

  useEffect(() => {
    mounted.current = true;
    if (enabled) void reload();
    const refresh = () => { if (enabled) void reload(); };
    const onStorage = (event: StorageEvent) => { if (event.key === workSessionStorageKey || event.key?.startsWith(`${workSessionStorageKey}:`)) refresh(); };
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", onStorage);
    window.addEventListener(workSessionChangedEvent, refresh);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(workSessionChangedEvent, refresh);
    };
  }, [enabled, reload]);

  const update = useCallback((command: WorkSessionWorkspaceCommand): Promise<WorkSessionWorkspace | null> => {
    if (!controller.canUpdate(token)) {
      controller.fail(token, "업무 대화 저장소를 불러온 뒤 다시 시도해 주세요.");
      refreshView();
      return Promise.resolve(null);
    }
    const request = (async () => {
      try {
        const result = bridge ? await bridge.updateWorkSessionWorkspace(command, expectedRoot) : await updateBrowserWorkSessionWorkspace(command);
        const workspace = controller.accept(token, result);
        refreshView();
        return workspace;
      } catch (cause) {
        controller.fail(token, cause instanceof Error ? cause.message : "업무 대화를 저장하지 못했습니다.");
        refreshView();
        return null;
      }
    })();
    pendingUpdates.current.add(request);
    void request.finally(() => pendingUpdates.current.delete(request));
    return request;
  }, [bridge, controller, expectedRoot, refreshView, token]);

  const flush = useCallback(async () => {
    const results = await Promise.all([...pendingUpdates.current]);
    if (results.some((result) => result === null)) throw new Error("업무 대화 저장을 완료하지 못해 기억 저장소 변경을 중단했습니다.");
  }, []);

  // 내용이 같은 새 객체가 들어와도 이전 객체를 그대로 넘긴다 — 받는 쪽의 useMemo·memo 가 헛돌지 않게.
  const stableView = useRef<{ token: typeof token; view: WorkSessionView } | null>(null);
  const liveView = controller.snapshot();
  const previous = stableView.current;
  const view = previous && previous.token === token && sameWorkSessionView(previous.view, liveView) ? previous.view : liveView;
  stableView.current = { token, view };

  return { ...view, update, reload, flush };
}
