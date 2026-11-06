type AnyCallback = (...args: unknown[]) => unknown;

/**
 * 늘 같은 함수 묶음을 돌려주되, 부를 때마다 read() 가 주는 "지금" 함수를 부른다.
 *
 * memo 로 감싼 자식에게 매 렌더 새로 만들어지는 함수를 넘기면 memo 가 아무 일도 못 한다.
 * 그렇다고 옛 함수를 그대로 넘기면 옛 상태를 보는 버그가 생긴다. 그래서 겉은 고정하고,
 * 속은 항상 최신 함수로 이어 준다. 열쇠 목록은 처음 받은 묶음에서 읽는다.
 */
export function createLatestCallbacks<T extends object>(read: () => T): T {
  const stable: Record<string, AnyCallback> = {};
  for (const key of Object.keys(read())) {
    stable[key] = (...args: unknown[]) => ((read() as Record<string, AnyCallback>)[key])(...args);
  }
  return stable as T;
}
