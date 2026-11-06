export type BrowserAction = { kind: 'click' | 'fill' | 'scroll'; elementId?: string; text?: string };
export type BrowserSnapshot = { token: string; url: string; title: string; text: string; elements: { id: string; tag: string; type: string; label: string }[] };
export type BrowserState = { available: boolean; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; notice?: string; snapshot?: BrowserSnapshot; persistent?: boolean };
type BrowserCommand = { kind: 'open' | 'state' | 'bounds' | 'hide' | 'close' | 'back' | 'forward' | 'reload' | 'snapshot' | 'apply'; scope?: string; url?: string; bounds?: { x: number; y: number; width: number; height: number }; visible?: boolean; token?: string; action?: BrowserAction };
export const WORK_BROWSER_OPEN_EVENT = 'modycrew:work-browser-open';
export function resolveWorkBrowserInput(value: string) {
  const input = value.trim();
  if (!input) throw new Error('웹 주소나 검색어를 입력해 주세요.');
  if (/^https?:\/\//i.test(input)) return input;
  if (/^[\w-]+(?:\.[\w-]+)+(?::\d+)?(?:[/?#]\S*)?$/u.test(input) || /^localhost(?::\d+)?(?:\/\S*)?$/i.test(input)) return `https://${input}`;
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}
export function openWorkBrowserPane(url?: string) {
  window.dispatchEvent(new CustomEvent(WORK_BROWSER_OPEN_EVENT, { detail: { url } }));
}
declare global { interface Window { modyCrewWorkBrowser?: { request: (payload: BrowserCommand) => Promise<BrowserState>; onOpen?: (listener: (data: { url: string }) => void) => (() => void) } } }
export function requestWorkBrowser(payload: BrowserCommand) {
  if (!window.modyCrewWorkBrowser) return Promise.reject(new Error('업무 브라우저는 최신 ModyCrew 설치 앱에서 사용할 수 있습니다.'));
  return window.modyCrewWorkBrowser.request(payload);
}
