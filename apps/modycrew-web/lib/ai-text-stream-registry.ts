import type { AITextGenerationPayload, AITextGenerationResult } from "./desktop-bridge";

/**
 * 대화(스레드)마다 지금 받고 있는 AI 스트리밍 답변을 기억해 두었다가, 사용자가 '중지'를
 * 누르면 설치 앱에 그 답변을 멈추라고 알린다.
 *
 * 예전에는 '중지'가 화면 반영만 끊고 요청은 그대로 두어, AI 가 뒤에서 끝까지 답을 만들며
 * PC 자원과 구독 사용량을 썼다. 설치 앱이 cancelAITextStream 을 모르면(옛 버전) 조용히
 * 화면 반영만 끊는 예전 동작으로 돌아간다.
 */
type StreamingBridge = {
  generateAITextStream?: (
    payload: AITextGenerationPayload,
    onChunk: (delta: string) => void,
  ) => Promise<AITextGenerationResult>;
  cancelAITextStream?: (streamId: string) => Promise<unknown>;
};

type CancelStream = () => boolean;

const activeStreamsByThread = new Map<string, Map<string, CancelStream>>();
let streamSequence = 0;

export function createAITextStreamId(): string {
  streamSequence = (streamSequence + 1) % 1_000_000;
  const random = Math.random().toString(36).slice(2, 10) || "0";
  return `chatstream-${Date.now().toString(36)}-${streamSequence.toString(36)}-${random}`;
}

export function startTrackedAITextStream(
  bridge: StreamingBridge,
  threadId: string,
  payload: AITextGenerationPayload,
  onChunk: (delta: string) => void,
): Promise<AITextGenerationResult> {
  if (typeof bridge.generateAITextStream !== "function") {
    return Promise.reject(new Error("이 앱 버전에서는 답변을 실시간으로 받을 수 없어요."));
  }
  const streamId = createAITextStreamId();
  const streams = activeStreamsByThread.get(threadId) ?? new Map<string, CancelStream>();
  activeStreamsByThread.set(threadId, streams);
  streams.set(streamId, () => {
    if (typeof bridge.cancelAITextStream !== "function") return false;
    void bridge.cancelAITextStream(streamId).catch(() => undefined);
    return true;
  });
  const release = () => {
    streams.delete(streamId);
    if (streams.size === 0 && activeStreamsByThread.get(threadId) === streams) activeStreamsByThread.delete(threadId);
  };
  let pending: Promise<AITextGenerationResult>;
  try {
    pending = bridge.generateAITextStream({ ...payload, streamId }, onChunk);
  } catch (error) {
    release();
    return Promise.reject(error);
  }
  return Promise.resolve(pending).finally(release);
}

   
                                                   
                              
   
export function cancelTrackedAITextStreams(threadId: string): number {
  const streams = activeStreamsByThread.get(threadId);
  if (!streams || streams.size === 0) return 0;
  activeStreamsByThread.delete(threadId);
  const cancels = [...streams.values()];
  streams.clear();
  let signalled = 0;
  for (const cancel of cancels) if (cancel()) signalled += 1;
  return signalled;
}

export function countTrackedAITextStreams(threadId: string): number {
  return activeStreamsByThread.get(threadId)?.size ?? 0;
}
