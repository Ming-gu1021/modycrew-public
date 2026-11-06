/**
 * 말로 입력하기 — 마이크 녹음·오디오 파일을 16kHz 모노 16비트 WAV 로 바꿔 데스크톱 받아쓰기 엔진에 보낸다.
 *
 * - 녹음: getUserMedia(오디오만) → Web Audio(ScriptProcessor; 앱 CSP 가 blob 워크릿을 막으므로) → 16kHz 모노 PCM.
 * - 파일: AudioContext.decodeAudioData 로 mp3·m4a·wav·ogg·flac 등을 풀어 같은 경로로 보낸다(ffmpeg 없음).
 * - 엔진: window.modyCrewDesktopBridge.speechRecognition({ kind: 'transcribe', audio, ... }) — 오디오는 이 PC 안에서만 글로 바뀐다.
 * - 오류는 VoiceInputError(code, 사용자 문장)로 구분한다: 권한 거부·마이크 없음·사용 중·엔진 미준비·시간 초과·말소리 없음 등.
 *
 * 이 파일은 다른 모듈을 import 하지 않는다(node --test 가 타입만 지우고 바로 읽는다).
 */

export const VOICE_SAMPLE_RATE = 16000;
export const VOICE_MAX_RECORDING_SECONDS = 5 * 60;
// 데스크톱 엔진이 바이트로 받는 최대 길이(약 30분)와 맞춘다.
export const VOICE_MAX_FILE_SECONDS = 30 * 60;
export const VOICE_MIN_SECONDS = 0.3;
const ACTIVE_FRAME_DB = -45;
const MIN_ACTIVE_SPEECH_SECONDS = 0.25;

export type VoiceInputErrorCode =
  | 'unsupported'
  | 'desktop_required'
  | 'permission_denied'
  | 'no_microphone'
  | 'microphone_busy'
  | 'engine_not_ready'
  | 'engine_runtime_missing'
  | 'engine_blocked'
  | 'busy'
  | 'timeout'
  | 'no_speech'
  | 'too_short'
  | 'too_long'
  | 'decode_failed'
  | 'cancelled'
  | 'failed';

export class VoiceInputError extends Error {
  code: VoiceInputErrorCode;
  helpUrl: string;
  engineStatus: string;
  constructor(code: VoiceInputErrorCode, message: string, details: { helpUrl?: string; engineStatus?: string } = {}) {
    super(message);
    this.name = 'VoiceInputError';
    this.code = code;
    this.helpUrl = details.helpUrl ?? '';
    this.engineStatus = details.engineStatus ?? '';
  }
}

export type SpeechModelInfo = {
  id: string;
  label: string;
  description: string;
  downloadBytes: number;
  installed: boolean;
  recommended: boolean;
  state: string;
};

export type SpeechJobInfo = {
  kind: 'download' | 'transcribe';
  requestId: string;
  modelId: string;
  stage: string;
  percent: number;
  receivedBytes: number;
  totalBytes: number;
};

export type SpeechEngineStatus = {
  status: string;
  userMessage: string;
  helpUrl?: string;
  models?: SpeechModelInfo[];
  selectedModelId?: string;
  defaultModelId?: string;
  job?: SpeechJobInfo | null;
  microphoneAccess?: string;
  modelId?: string;
  downloadBytes?: number;
  includesEngine?: boolean;
  cloud?: { available: boolean; provider: string; requiresConsent: boolean };
};

export type SpeechSegment = { startMs: number | null; endMs: number | null; text: string };

export type SpeechTranscription = {
  status: string;
  userMessage: string;
  text: string;
  requestId?: string;
  segments?: SpeechSegment[];
  possibleHallucination?: boolean;
  audioSeconds?: number | null;
  elapsedMs?: number;
  modelId?: string;
  engine?: string;
  helpUrl?: string;
};

export type VoiceLevel = { rmsDb: number; peakDb: number; activeSeconds: number };

type SpeechBridgeCall = (payload: Record<string, unknown>) => Promise<unknown>;

function speechBridge(): SpeechBridgeCall | null {
  if (typeof window === 'undefined') return null;
  const desktop = (window as unknown as { modyCrewDesktopBridge?: { speechRecognition?: SpeechBridgeCall } }).modyCrewDesktopBridge;
  return typeof desktop?.speechRecognition === 'function' ? desktop.speechRecognition.bind(desktop) : null;
}

function requireBridge(): SpeechBridgeCall {
  const bridge = speechBridge();
  if (!bridge) throw new VoiceInputError('desktop_required', '받아쓰기는 모디크루 데스크톱 앱에서 사용할 수 있습니다.');
  return bridge;
}

export function isSpeechRecognitionAvailable(): boolean {
  return speechBridge() !== null;
}

// ── 순수 함수(테스트 대상) ─────────────────────────────────────────────────────

/** 여러 채널을 평균해 모노로 만든다. */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (!channels.length) return new Float32Array(0);
  if (channels.length === 1) return new Float32Array(channels[0]);
  const length = Math.min(...channels.map((channel) => channel.length));
  const output = new Float32Array(length);
  for (const channel of channels) for (let index = 0; index < length; index += 1) output[index] += channel[index] / channels.length;
  return output;
}

/**
 * 표본 주파수 변환(브라우저 OfflineAudioContext 를 못 쓸 때의 대체 경로).
 * 내릴 때는 비율 폭의 평균 필터로 고주파를 줄인 뒤 선형 보간한다.
 */
export function resampleLinear(input: Float32Array, fromRate: number, toRate: number = VOICE_SAMPLE_RATE): Float32Array {
  if (!(fromRate > 0) || !(toRate > 0)) throw new RangeError('sample rate must be positive');
  if (fromRate === toRate || input.length === 0) return new Float32Array(input);
  const ratio = fromRate / toRate;
  let source = input;
  if (ratio > 1) {
    const width = Math.max(1, Math.round(ratio));
    if (width > 1) {
      source = new Float32Array(input.length);
      let sum = 0;
      for (let index = 0; index < input.length; index += 1) {
        sum += input[index];
        if (index >= width) sum -= input[index - width];
        source[index] = sum / Math.min(index + 1, width);
      }
      // 평균 필터는 (폭-1)/2 표본 늦어지므로 앞으로 당긴다.
      const shift = Math.floor((width - 1) / 2);
      if (shift > 0) source = shiftLeft(source, shift);
    }
  }
  const length = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(source.length - 1, left + 1);
    const weight = position - left;
    output[index] = (source[Math.min(left, source.length - 1)] ?? 0) * (1 - weight) + (source[right] ?? 0) * weight;
  }
  return output;
}

function shiftLeft(values: Float32Array, shift: number): Float32Array {
  const output = new Float32Array(values.length);
  output.set(values.subarray(shift));
  return output;
}

/** 16비트 PCM 모노 WAV(RIFF) 바이트를 만든다. */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number = VOICE_SAMPLE_RATE): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => { for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index)); };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Number.isFinite(samples[index]) ? Math.max(-1, Math.min(1, samples[index])) : 0;
    view.setInt16(44 + index * 2, value < 0 ? Math.round(value * 32768) : Math.round(value * 32767), true);
  }
  return new Uint8Array(buffer);
}

/** 데스크톱 엔진과 같은 기준(20ms 구간, -45dBFS)으로 음량과 말소리 길이를 잰다. */
export function measureLevel(samples: Float32Array, sampleRate: number = VOICE_SAMPLE_RATE): VoiceLevel {
  const frame = Math.max(1, Math.round(sampleRate * 0.02));
  let sum = 0;
  let peak = 0;
  let frameSum = 0;
  let frameCount = 0;
  let activeFrames = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    const square = value * value;
    sum += square;
    frameSum += square;
    frameCount += 1;
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
    if (frameCount === frame) {
      if (10 * Math.log10(frameSum / frameCount + 1e-12) > ACTIVE_FRAME_DB) activeFrames += 1;
      frameSum = 0;
      frameCount = 0;
    }
  }
  const db = (value: number) => (value > 0 ? Math.round(20 * Math.log10(value) * 10) / 10 : -120);
  return {
    rmsDb: db(samples.length ? Math.sqrt(sum / samples.length) : 0),
    peakDb: db(peak),
    activeSeconds: Math.round(activeFrames * (frame / sampleRate) * 100) / 100,
  };
}

/** 레벨 미터용 0~1 값(작은 소리도 보이도록 -60dBFS~0dBFS 를 0~1 로). */
export function meterLevel(frame: Float32Array): number {
  if (!frame.length) return 0;
  let sum = 0;
  for (let index = 0; index < frame.length; index += 1) sum += frame[index] * frame[index];
  const rms = Math.sqrt(sum / frame.length);
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
}

export function newRequestId(): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  return ('voice-' + random).replace(/[^A-Za-z0-9_-]/gu, '').slice(0, 80);
}

const windowsPrivacyMessage = '마이크 사용이 막혀 있습니다. Windows 설정 > 개인 정보 및 보안 > 마이크에서 "마이크 액세스"와 "데스크톱 앱이 마이크에 액세스하도록 허용"을 켠 뒤 다시 시도해 주세요.';

/** getUserMedia 오류를 사용자 문장으로 바꾼다. microphoneAccess 는 데스크톱 엔진 status 의 OS 마이크 권한 값. */
export function describeMicrophoneError(error: unknown, microphoneAccess: string = 'unknown'): { code: VoiceInputErrorCode; message: string } {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name?: unknown }).name) : '';
  const osDenied = microphoneAccess === 'denied' || microphoneAccess === 'restricted';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return { code: 'permission_denied', message: windowsPrivacyMessage };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return { code: 'no_microphone', message: '연결된 마이크를 찾지 못했습니다. 마이크를 연결하거나 Windows 소리 설정에서 입력 장치를 확인해 주세요.' };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    if (osDenied) return { code: 'permission_denied', message: windowsPrivacyMessage };
    return { code: 'microphone_busy', message: '마이크를 열 수 없습니다. 다른 통화·녹음 프로그램이 마이크를 쓰고 있다면 닫고 다시 시도해 주세요.' };
  }
  if (osDenied) return { code: 'permission_denied', message: windowsPrivacyMessage };
  return { code: 'failed', message: '마이크를 열지 못했습니다. 잠시 후 다시 시도해 주세요.' };
}

/** 데스크톱 엔진 결과 상태를 화면용 오류 코드·문장으로 바꾼다. 받아쓰기가 끝났으면 null. */
export function describeEngineResult(result: { status?: string; userMessage?: string; helpUrl?: string } | null | undefined): { code: VoiceInputErrorCode; message: string; helpUrl?: string } | null {
  const status = String(result?.status ?? '');
  const message = String(result?.userMessage ?? '').trim();
  if (status === 'transcribed' || status === 'ready') return null;
  const map: Record<string, VoiceInputErrorCode> = {
    needs_model: 'engine_not_ready',
    needs_engine: 'engine_not_ready',
    approval_required: 'engine_not_ready',
    downloading: 'engine_not_ready',
    model_damaged: 'engine_not_ready',
    engine_damaged: 'engine_not_ready',
    engine_runtime_missing: 'engine_runtime_missing',
    engine_blocked: 'engine_blocked',
    engine_unsupported_cpu: 'failed',
    unsupported_platform: 'unsupported',
    busy: 'busy',
    timeout: 'timeout',
    no_speech: 'no_speech',
    too_short: 'too_short',
    too_large: 'too_long',
    too_long: 'too_long',
    invalid_audio: 'decode_failed',
    unsupported_audio: 'decode_failed',
    cancelled: 'cancelled',
    forbidden: 'desktop_required',
  };
  const code = map[status] ?? 'failed';
  return { code, message: message || '받아쓰기를 끝내지 못했습니다. 잠시 후 다시 시도해 주세요.', ...(result?.helpUrl ? { helpUrl: result.helpUrl } : {}) };
}

/** 렌더러 쪽 시간 제한(엔진 제한보다 넉넉하게). */
export function transcriptionTimeoutMs(audioSeconds: number): number {
  const seconds = Number.isFinite(audioSeconds) && audioSeconds > 0 ? audioSeconds : 60;
  return Math.round(Math.min(45 * 60_000, Math.max(120_000, 90_000 + Math.ceil(seconds / 30) * 30 * 4 * 1000)));
}

// ── 데스크톱 엔진 호출 ─────────────────────────────────────────────────────────

export async function getSpeechEngineStatus(): Promise<SpeechEngineStatus> {
  return (await requireBridge()({ kind: 'status' })) as SpeechEngineStatus;
}

export async function cancelSpeechRecognition(requestId?: string): Promise<void> {
  const bridge = speechBridge();
  if (!bridge) return;
  try { await bridge({ kind: 'cancel', ...(requestId ? { requestId } : {}) }); } catch { /* 이미 끝남 */ }
}

/**
 * 모델(필요하면 엔진도) 내려받기. approved 는 사용자가 화면에서 "내려받기"를 누른 경우에만 true 로 넘긴다.
 * 진행률은 status 를 0.5초마다 읽어 onProgress(0~100)로 알린다.
 */
export async function prepareSpeechEngine(options: { modelId?: string; approved: boolean; onProgress?: (percent: number, job: SpeechJobInfo | null) => void }): Promise<SpeechEngineStatus> {
  const bridge = requireBridge();
  const requestId = newRequestId();
  let finished = false;
  const poll = async () => {
    while (!finished) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (finished) break;
      try {
        const status = (await bridge({ kind: 'status' })) as SpeechEngineStatus;
        const job = status.job && status.job.kind === 'download' ? status.job : null;
        if (job) options.onProgress?.(job.percent, job);
      } catch { /* 다음 주기에 다시 */ }
    }
  };
  void poll();
  try {
    return (await bridge({ kind: 'prepare', approved: options.approved === true, requestId, ...(options.modelId ? { modelId: options.modelId } : {}) })) as SpeechEngineStatus;
  } finally {
    finished = true;
  }
}

/** 16kHz 모노 16비트 WAV 를 받아쓴다. 실패하면 VoiceInputError. */
export async function transcribeWav(
  wav: Uint8Array,
  options: { language?: string; timestamps?: boolean; modelId?: string; requestId?: string; timeoutMs?: number; audioSeconds?: number; signal?: AbortSignal } = {},
): Promise<SpeechTranscription> {
  const bridge = requireBridge();
  const requestId = options.requestId || newRequestId();
  const seconds = options.audioSeconds ?? Math.max(0, (wav.byteLength - 44) / (VOICE_SAMPLE_RATE * 2));
  const timeoutMs = options.timeoutMs ?? transcriptionTimeoutMs(seconds);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const guard = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      void cancelSpeechRecognition(requestId);
      reject(new VoiceInputError('timeout', '받아쓰기가 너무 오래 걸려 멈췄습니다. 더 짧게 나눠 말하거나 잠시 후 다시 시도해 주세요.'));
    }, timeoutMs);
    if (options.signal) {
      onAbort = () => { void cancelSpeechRecognition(requestId); reject(new VoiceInputError('cancelled', '받아쓰기를 취소했습니다.')); };
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  try {
    const call = bridge({
      kind: 'transcribe',
      audio: wav,
      language: options.language ?? 'ko',
      timestamps: options.timestamps === true,
      requestId,
      ...(options.modelId ? { modelId: options.modelId } : {}),
    }) as Promise<SpeechTranscription & { helpUrl?: string }>;
    const result = await Promise.race([call, guard]);
    const failure = describeEngineResult(result);
    if (failure) throw new VoiceInputError(failure.code, failure.message, { helpUrl: failure.helpUrl, engineStatus: String(result?.status ?? '') });
    return { ...result, text: String(result.text ?? '').trim() };
  } catch (error) {
    if (error instanceof VoiceInputError) throw error;
    throw new VoiceInputError('failed', '받아쓰기 엔진에 연결하지 못했습니다. 앱을 다시 시작한 뒤 시도해 주세요.');
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) options.signal?.removeEventListener('abort', onAbort);
  }
}

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext;

function audioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;
  const scope = window as unknown as { AudioContext?: AudioContextConstructor; webkitAudioContext?: AudioContextConstructor };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/** 브라우저의 고품질 변환(OfflineAudioContext)으로 16kHz 모노를 만든다. 못 쓰면 순수 함수로 대신한다. */
export async function toVoiceSamples(channels: Float32Array[], sampleRate: number): Promise<Float32Array> {
  const mono = mixToMono(channels);
  if (sampleRate === VOICE_SAMPLE_RATE) return mono;
  const Offline = typeof window !== 'undefined' ? (window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext : undefined;
  if (Offline && mono.length) {
    try {
      const frames = Math.max(1, Math.ceil((mono.length * VOICE_SAMPLE_RATE) / sampleRate));
      const offline = new Offline(1, frames, VOICE_SAMPLE_RATE);
      const buffer = offline.createBuffer(1, mono.length, sampleRate);
      const channelData = new Float32Array(mono.length);
      channelData.set(mono);
      buffer.copyToChannel(channelData, 0);
      const source = offline.createBufferSource();
      source.buffer = buffer;
      source.connect(offline.destination);
      source.start();
      const rendered = await offline.startRendering();
      return new Float32Array(rendered.getChannelData(0));
    } catch { /* 아래 대체 경로 */ }
  }
  return resampleLinear(mono, sampleRate, VOICE_SAMPLE_RATE);
}

/** 오디오 파일(mp3·m4a·wav·ogg·flac 등)을 풀어 16kHz 모노 WAV 로 바꾼다. */
export async function decodeAudioFileToWav(file: Blob, options: { maxSeconds?: number } = {}): Promise<{ wav: Uint8Array; seconds: number; level: VoiceLevel }> {
  const Context = audioContextConstructor();
  if (!Context) throw new VoiceInputError('unsupported', '이 화면에서는 오디오 파일을 읽을 수 없습니다. 모디크루 데스크톱 앱에서 사용해 주세요.');
  const maxSeconds = options.maxSeconds ?? VOICE_MAX_FILE_SECONDS;
  // 디코드하면 32비트 PCM 으로 커진다. 너무 큰 파일은 미리 막는다(평균 128kbps 기준 여유 있게).
  if (file.size > 512 * 1024 * 1024) throw new VoiceInputError('too_long', '오디오 파일이 너무 큽니다. 30분 이하로 나눠 주세요.');
  const context = new Context();
  try {
    let decoded: AudioBuffer;
    try { decoded = await context.decodeAudioData(await file.arrayBuffer()); }
    catch { throw new VoiceInputError('decode_failed', '이 오디오 파일을 읽지 못했습니다. mp3·m4a·wav 파일인지 확인해 주세요.'); }
    if (decoded.duration > maxSeconds) throw new VoiceInputError('too_long', '오디오가 너무 깁니다. ' + Math.round(maxSeconds / 60) + '분 이하로 나눠 주세요.');
    const channels: Float32Array[] = [];
    for (let index = 0; index < decoded.numberOfChannels; index += 1) channels.push(decoded.getChannelData(index));
    const samples = await toVoiceSamples(channels, decoded.sampleRate);
    return { wav: encodeWavPcm16(samples), seconds: samples.length / VOICE_SAMPLE_RATE, level: measureLevel(samples) };
  } finally {
    void context.close().catch(() => undefined);
  }
}

/** 오디오 파일 받아쓰기(파일 → 디코드 → 16kHz WAV → 데스크톱 엔진). */
export async function transcribeAudioFile(file: Blob, options: { language?: string; timestamps?: boolean; modelId?: string; signal?: AbortSignal } = {}): Promise<SpeechTranscription> {
  requireBridge();
  const prepared = await decodeAudioFileToWav(file);
  if (prepared.seconds < VOICE_MIN_SECONDS) throw new VoiceInputError('too_short', '오디오가 너무 짧습니다.');
  if (prepared.level.activeSeconds < MIN_ACTIVE_SPEECH_SECONDS) throw new VoiceInputError('no_speech', '이 파일에서 말소리를 찾지 못했습니다.');
  return transcribeWav(prepared.wav, { ...options, audioSeconds: prepared.seconds });
}

// ── 녹음 ──────────────────────────────────────────────────────────────────────

export type VoiceRecording = { wav: Uint8Array; seconds: number; level: VoiceLevel };

export type VoiceRecorder = {
  start(): Promise<void>;
  stop(): Promise<VoiceRecording>;
  cancel(): void;
  isRecording(): boolean;
};

async function microphoneAccessHint(): Promise<string> {
  const bridge = speechBridge();
  if (!bridge) return 'unknown';
  try { return String(((await bridge({ kind: 'status' })) as SpeechEngineStatus).microphoneAccess ?? 'unknown'); } catch { return 'unknown'; }
}

/**
 * 마이크 녹음기. start → (onLevel·onTick 으로 레벨·시간 표시) → stop 이 16kHz WAV 를 돌려준다.
 * maxSeconds 에 닿으면 onLimit 을 부른다(화면이 stop 해서 받아쓴다). cancel 은 녹음을 버린다.
 */
export function createVoiceRecorder(options: { maxSeconds?: number; onLevel?: (level: number) => void; onTick?: (seconds: number) => void; onLimit?: () => void } = {}): VoiceRecorder {
  const maxSeconds = options.maxSeconds ?? VOICE_MAX_RECORDING_SECONDS;
  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let mute: GainNode | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let chunks: Float32Array[] = [];
  let samples = 0;
  let sampleRate = VOICE_SAMPLE_RATE;
  let recording = false;
  let limitReported = false;
  let lastLevel = 0;

  const release = () => {
    recording = false;
    if (timer) clearInterval(timer);
    timer = null;
    if (processor) processor.onaudioprocess = null;
    try { processor?.disconnect(); } catch { /* 이미 끊김 */ }
    try { source?.disconnect(); } catch { /* 이미 끊김 */ }
    try { mute?.disconnect(); } catch { /* 이미 끊김 */ }
    stream?.getTracks().forEach((track) => track.stop());
    const closing = context;
    context = null; source = null; processor = null; mute = null; stream = null;
    if (closing && closing.state !== 'closed') void closing.close().catch(() => undefined);
  };

  return {
    isRecording: () => recording,
    async start() {
      if (recording) return;
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new VoiceInputError('unsupported', '이 화면에서는 마이크를 쓸 수 없습니다. 모디크루 데스크톱 앱에서 사용해 주세요.');
      }
      const Context = audioContextConstructor();
      if (!Context) throw new VoiceInputError('unsupported', '이 화면에서는 녹음을 할 수 없습니다. 모디크루 데스크톱 앱에서 사용해 주세요.');
      chunks = []; samples = 0; limitReported = false; lastLevel = 0;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      } catch (error) {
        const described = describeMicrophoneError(error, await microphoneAccessHint());
        throw new VoiceInputError(described.code, described.message);
      }
      try {
        // 16kHz 컨텍스트를 만들면 브라우저가 마이크 입력을 고품질로 변환해 준다. 안 되면 기본 주파수로 받고 나중에 변환한다.
        try { context = new Context({ sampleRate: VOICE_SAMPLE_RATE, latencyHint: 'interactive' }); source = context.createMediaStreamSource(stream); }
        catch {
          if (context) void context.close().catch(() => undefined);
          context = new Context();
          source = context.createMediaStreamSource(stream);
        }
        sampleRate = context.sampleRate;
        processor = context.createScriptProcessor(4096, 1, 1);
        mute = context.createGain();
        mute.gain.value = 0;
        processor.onaudioprocess = (event: AudioProcessingEvent) => {
          if (!recording) return;
          const input = event.inputBuffer.getChannelData(0);
          chunks.push(new Float32Array(input));
          samples += input.length;
          lastLevel = meterLevel(input);
          if (!limitReported && samples / sampleRate >= maxSeconds) { limitReported = true; options.onLimit?.(); }
        };
        source.connect(processor);
        processor.connect(mute);
        mute.connect(context.destination);
        if (context.state === 'suspended') await context.resume();
        recording = true;
        timer = setInterval(() => {
          options.onTick?.(samples / sampleRate);
          options.onLevel?.(lastLevel);
        }, 100);
      } catch {
        release();
        throw new VoiceInputError('failed', '녹음을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
    },
    async stop() {
      const rate = sampleRate;
      const captured = chunks;
      const total = samples;
      release();
      chunks = []; samples = 0;
      const joined = new Float32Array(total);
      let offset = 0;
      for (const chunk of captured) { joined.set(chunk, offset); offset += chunk.length; }
      const limited = joined.subarray(0, Math.min(joined.length, Math.round(maxSeconds * rate)));
      const voice = await toVoiceSamples([limited], rate);
      return { wav: encodeWavPcm16(voice), seconds: voice.length / VOICE_SAMPLE_RATE, level: measureLevel(voice) };
    },
    cancel() {
      release();
      chunks = []; samples = 0;
    },
  };
}

/** 녹음 결과를 받아쓰기 전에 확인(짧음·무음). 문제가 있으면 VoiceInputError. */
export function assertRecordingUsable(recording: { seconds: number; level: VoiceLevel }): void {
  if (recording.seconds < VOICE_MIN_SECONDS) throw new VoiceInputError('too_short', '녹음이 너무 짧습니다. 버튼을 누른 뒤 말씀하고 다시 눌러 주세요.');
  if (recording.level.activeSeconds < MIN_ACTIVE_SPEECH_SECONDS) throw new VoiceInputError('no_speech', '말소리가 들리지 않았습니다. 마이크 가까이에서 다시 말씀해 주세요.');
}
