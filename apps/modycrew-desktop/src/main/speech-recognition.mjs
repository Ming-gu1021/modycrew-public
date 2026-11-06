/**
 * 받아쓰기(음성 인식) 엔진 — whisper.cpp 를 이 PC 안에서 실행한다.
 *
 * kind
 *  - status        엔진·모델 준비 상태, 진행 중 작업, 마이크 OS 권한(가능할 때), 클라우드 선택 경로 가능 여부
 *  - prepare       모델(엔진이 없으면 엔진도) 내려받기. payload.approved === true 이고 메인의 확인 창(confirmDownload)을 통과할 때만
 *  - transcribe    16kHz 모노 16비트 WAV 바이트, 또는 허용된 폴더 안의 오디오 파일(wav·mp3·flac·ogg) → 글
 *  - cancel        진행 중 받아쓰기·내려받기 취소(requestId 로 지정, 없으면 전부)
 *  - select_model  설치된 모델 중 기본 모델 바꾸기
 *  - remove_model  내려받은 모델 지우기
 *
 * 원칙
 *  - 오디오는 PC 밖으로 보내지 않는다. 클라우드 전사는 메인이 cloudTranscribe 를 연결하고 사용자가 요청마다 동의할 때만 쓴다.
 *  - 렌더러는 실행 파일·모델 경로·다운로드 주소를 정하지 못한다. 카탈로그(버전·크기·SHA-256 고정)만 쓴다.
 *  - 임시 파일은 요청마다 만든 폴더(%TEMP%\ModyCrew-speech\job-xxxxxx)에만 쓰고 끝나면 지운다. 남은 폴더는 1시간 뒤 정리한다.
 *  - whisper-cli 인자는 Windows 코드 페이지로 바뀌므로 파일 이름은 작업 폴더 기준 ASCII 상대 경로로 넘긴다.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, constants as fsConstants } from 'node:fs';
import { copyFile, link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, statfs, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultSpeechModelId,
  resolveSpeechModel,
  speechEngineRelease,
  speechModelCatalog,
  speechModelDownloadHosts,
  speechModelPreference,
  whisperLanguageCodes,
} from './feature-modules/speech-models.mjs';

export const speechRecognitionChannel = 'mody.speech-recognition.v1';
export const speechRecognitionProgressChannel = 'mody.speech-recognition.progress';

export const speechLimits = Object.freeze({
  sampleRate: 16000,
  // 16kHz 모노 16비트는 초당 32,000바이트 → 64MB 는 약 34분.
  maxWavBytes: 64 * 1024 * 1024,
  maxRecordingSeconds: 30 * 60,
  minAudioSeconds: 0.3,
  minActiveSpeechSeconds: 0.25,
  maxFileBytes: 512 * 1024 * 1024,
  maxFileSeconds: 2 * 60 * 60,
  maxQueued: 2,
  cloudMaxBytes: 25 * 1024 * 1024,
  freeSpaceMarginBytes: 200 * 1024 * 1024,
});

// 모델별 디코딩 방식은 카탈로그(beamSize)에 측정 근거와 함께 둔다. 카탈로그에 없을 때만 whisper.cpp 기본값(빔 5)을 쓴다.
export const defaultBeamSize = 5;
const audioFileExtensions = new Set(['.wav', '.mp3', '.flac', '.ogg']);
const activeFrameDb = -45;
const statusDllNotFound = 0xc0000135;
const statusInvalidImageFormat = 0xc000007b;
const statusIllegalInstruction = 0xc000001d;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

class SpeechError extends Error {
  constructor(status, userMessage, extra = {}) {
    super(userMessage);
    this.status = status;
    this.userMessage = userMessage;
    this.extra = extra;
  }
}
const fail = (status, userMessage, extra) => new SpeechError(status, userMessage, extra);
const result = (status, userMessage, fields = {}) => ({ status, userMessage, externalMutation: false, ...fields });
const megabytes = (bytes) => `${Math.max(1, Math.round(bytes / 1024 / 1024))}MB`;

const state = { active: null, queue: [], download: null, sweptWorkRoots: new Set() };
const probeCache = new Map();
const engineVerifyCache = new Map();

/** 테스트 전용: 모듈 상태 초기화. */
export function resetSpeechRecognitionStateForTests() {
  state.active?.abort?.();
  state.active = null;
  state.queue = [];
  state.download?.controller?.abort();
  state.download = null;
  state.sweptWorkRoots.clear();
  probeCache.clear();
  engineVerifyCache.clear();
}

// ── 요청 출처 ────────────────────────────────────────────────────────────────
function assertTrustedSender(event, options) {
  if (options.trustedSender === true) return;
  const sender = event?.sender;
  const frame = event?.senderFrame;
  const denied = () => fail('forbidden', '앱 화면에서 받아쓰기를 사용해 주세요.');
  if (!sender || !frame || (sender.mainFrame && frame !== sender.mainFrame)) throw denied();
  let url;
  try { url = new URL(frame.url || sender.getURL()); } catch { throw denied(); }
  const appScreen = url.protocol === 'modycrew:' && url.hostname === 'app';
  const devScreen = options.allowDevOrigin === true && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (!appScreen && !devScreen) throw denied();
}

// ── 경로 ─────────────────────────────────────────────────────────────────────
export function speechPaths(options = {}) {
  const userData = options.userDataPath || options.app?.getPath?.('userData');
  if (!userData && !options.modelsDir) throw fail('unavailable', '앱의 저장 위치를 확인할 수 없습니다.');
  const featureRoot = userData ? path.join(path.resolve(userData), 'feature-modules') : '';
  const modelsRoot = options.modelsDir ? path.resolve(options.modelsDir) : path.join(featureRoot, 'speech-models');
  return {
    modelsRoot,
    preferences: path.join(modelsRoot, 'preferences.json'),
    engineRoot: options.engineInstallDir
      ? path.resolve(options.engineInstallDir)
      : path.join(featureRoot || modelsRoot, 'speech-engine', `${speechEngineRelease.version}-${speechEngineRelease.buildTag}`),
    workRoot: options.tempRoot ? path.resolve(options.tempRoot) : path.join(os.tmpdir(), 'ModyCrew-speech'),
  };
}

/** 사용자가 고른 파일이 허용된 폴더 안의 지원 형식 오디오인지 확인한다(링크·바로가기로 밖을 가리키면 거부). */
export async function resolveAllowedAudioFile(filePath, allowedRoots, { maxBytes = speechLimits.maxFileBytes } = {}) {
  const retry = () => fail('invalid_request', '받아쓸 오디오 파일을 다시 선택해 주세요.');
  if (typeof filePath !== 'string' || !filePath.trim() || filePath.length > 1024 || /[\u0000-\u001f]/u.test(filePath)) throw retry();
  if (!path.isAbsolute(filePath)) throw retry();
  if (/^[\\/]{2}/u.test(filePath)) throw fail('path_not_allowed', '네트워크 위치의 파일은 PC로 복사한 뒤 받아써 주세요.');
  const extension = path.extname(filePath).toLowerCase();
  if (!audioFileExtensions.has(extension)) {
    throw fail('unsupported_audio', 'wav·mp3·flac·ogg 파일만 바로 받아쓸 수 있습니다. 다른 형식은 앱 화면의 파일 받아쓰기를 이용해 주세요.');
  }
  const roots = [];
  for (const root of Array.isArray(allowedRoots) ? allowedRoots : []) {
    if (typeof root !== 'string' || !root || !path.isAbsolute(root)) continue;
    try { roots.push(await realpath(path.resolve(root))); } catch { /* 없는 폴더는 건너뛴다 */ }
  }
  if (!roots.length) throw fail('path_not_allowed', '받아쓸 수 있는 폴더가 정해지지 않았습니다. 작업 폴더 안의 파일을 선택해 주세요.');
  let actual;
  try { actual = await realpath(filePath); } catch { throw fail('invalid_audio', '오디오 파일을 찾지 못했습니다. 파일 위치를 확인해 주세요.'); }
  const inside = roots.some((root) => {
    const relative = path.relative(root, actual);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  });
  if (!inside) throw fail('path_not_allowed', '작업 폴더 안의 오디오 파일만 받아쓸 수 있습니다.');
  if (path.extname(actual).toLowerCase() !== extension) throw retry();
  const info = await lstat(actual);
  if (!info.isFile()) throw retry();
  if (info.size > maxBytes) throw fail('too_large', `오디오 파일이 너무 큽니다. ${megabytes(maxBytes)} 이하로 나눠 주세요.`);
  if (info.size < 64) throw fail('invalid_audio', '오디오 파일이 비어 있습니다.');
  return { path: actual, bytes: info.size, extension };
}

// ── WAV·음량 ─────────────────────────────────────────────────────────────────
function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw fail('invalid_request', '녹음 데이터를 읽지 못했습니다.');
}

/** RIFF/WAVE 헤더를 읽는다. 형식이 이상하면 사용자 문장과 함께 거부한다. */
export function parseWavHeader(input) {
  const buffer = toBuffer(input);
  const invalid = () => fail('invalid_audio', 'WAV 녹음을 읽지 못했습니다. 다시 녹음해 주세요.');
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw invalid();
  let offset = 12;
  let format = null;
  let dataOffset = -1;
  let dataBytes = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > buffer.length) throw invalid();
      format = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
      // WAVE_FORMAT_EXTENSIBLE: 실제 형식은 하위 형식 GUID 앞 2바이트.
      if (format.audioFormat === 0xfffe && size >= 40 && body + 26 <= buffer.length) format.audioFormat = buffer.readUInt16LE(body + 24);
    } else if (id === 'data') {
      dataOffset = body;
      // 녹음 중 끊긴 파일은 크기가 0 이나 최댓값으로 남는다 → 남은 바이트를 쓴다.
      dataBytes = size === 0 || size > buffer.length - body ? buffer.length - body : size;
      break;
    }
    offset = body + size + (size % 2);
  }
  if (!format || dataOffset < 0 || !format.channels || !format.sampleRate || !format.bitsPerSample) throw invalid();
  const blockAlign = format.channels * (format.bitsPerSample / 8);
  const durationSec = blockAlign ? dataBytes / (format.sampleRate * blockAlign) : 0;
  return { ...format, dataOffset, dataBytes, durationSec };
}

export function assertDictationWav(info) {
  if (info.audioFormat !== 1 || info.bitsPerSample !== 16 || info.channels !== 1 || info.sampleRate !== speechLimits.sampleRate) {
    throw fail('unsupported_audio', '16kHz 모노 16비트 WAV만 바로 받아쓸 수 있습니다. 앱의 녹음·파일 받아쓰기 기능을 이용해 주세요.');
  }
}

/** 16비트 PCM 의 음량(dBFS)과 말소리로 볼 만한 구간 길이(20ms 단위)를 잰다. */
export function analyzePcm16Level(input, dataOffset = 0, dataBytes = undefined, sampleRate = speechLimits.sampleRate) {
  const buffer = toBuffer(input);
  const length = Math.max(0, Math.min(dataBytes ?? buffer.length - dataOffset, buffer.length - dataOffset));
  const count = Math.floor(length / 2);
  const frame = Math.max(1, Math.round(sampleRate * 0.02));
  // 메인 프로세스를 오래 붙잡지 않도록 정렬돼 있으면 Int16Array 로 바로 읽는다(Windows x64 는 리틀 엔디언).
  const aligned = (buffer.byteOffset + dataOffset) % 2 === 0 && os.endianness() === 'LE';
  const view = aligned ? new Int16Array(buffer.buffer, buffer.byteOffset + dataOffset, count) : null;
  const read = view ? (index) => view[index] : (index) => buffer.readInt16LE(dataOffset + index * 2);
  let sum = 0;
  let peak = 0;
  let frameSum = 0;
  let frameCount = 0;
  let activeFrames = 0;
  for (let index = 0; index < count; index += 1) {
    const value = read(index) / 32768;
    const square = value * value;
    sum += square;
    frameSum += square;
    frameCount += 1;
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
    if (frameCount === frame) {
      if (10 * Math.log10(frameSum / frameCount + 1e-12) > activeFrameDb) activeFrames += 1;
      frameSum = 0;
      frameCount = 0;
    }
  }
  const db = (value) => (value > 0 ? Math.round(20 * Math.log10(value) * 10) / 10 : -120);
  return { rmsDb: db(count ? Math.sqrt(sum / count) : 0), peakDb: db(peak), activeSeconds: Math.round(activeFrames * 0.02 * 100) / 100 };
}

// 무음·잡음에서 whisper 가 흔히 지어내는 문장(영상 자막 학습 흔적).
const silenceHallucinationPatterns = [
  /시청\s*해\s*주셔서\s*(감사|고맙)/u,
  /구독(과|이랑|하고)?\s*좋아요/u,
  /좋아요(와|랑|하고)?\s*구독/u,
  /자막\s*(제공|편집|by)/iu,
  /(MBC|KBS|SBS|YTN|JTBC)\s*뉴스.{0,20}입니다/u,
  /^\s*[(\[]?\s*(음악|박수|웃음)\s*[)\]]?\s*$/u,
];
export function looksLikeSilenceHallucination(text) {
  const value = String(text ?? '').trim();
  return Boolean(value) && value.length <= 60 && silenceHallucinationPatterns.some((pattern) => pattern.test(value));
}

// ── whisper-cli 인자·출력 ─────────────────────────────────────────────────────
export function defaultThreadCount(parallelism = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length) {
  const logical = Math.max(1, Math.floor(Number(parallelism) || 1));
  if (logical <= 2) return logical;
  return Math.min(8, Math.max(2, Math.floor(logical / 2)));
}

export function normalizeLanguage(value) {
  const language = String(value ?? 'ko').trim().toLowerCase() || 'ko';
  if (!whisperLanguageCodes.has(language)) throw fail('invalid_request', '지원하지 않는 언어입니다. 언어 설정을 확인해 주세요.');
  return language;
}

/** 모델·입력·출력은 작업 폴더 기준 상대 경로(ASCII)로 넘긴다. 셸을 쓰지 않으므로 인자는 그대로 전달된다. */
export function buildWhisperArgs({ model, input = 'input.wav', outputBase = 'out', language = 'ko', threads = 4, beamSize = defaultBeamSize } = {}) {
  if (typeof model !== 'string' || !model) throw fail('invalid_request', '받아쓰기 모델을 확인하지 못했습니다.');
  const safeName = /^[A-Za-z0-9._-]{1,64}$/u;
  if (!safeName.test(input) || !safeName.test(outputBase)) throw fail('invalid_request', '받아쓰기 작업 파일 이름이 올바르지 않습니다.');
  const lang = normalizeLanguage(language);
  const t = Math.max(1, Math.min(16, Math.floor(Number(threads) || 1)));
  const beam = Math.max(1, Math.min(8, Math.floor(Number(beamSize) || 1)));
  return ['-m', model, '-f', input, '-l', lang, '-t', String(t), '-bs', String(beam), '-bo', String(beam), '-oj', '-of', outputBase, '-pp'];
}

/** 작업 폴더에서 대상까지의 상대 경로(같은 드라이브·ASCII 일 때). 아니면 절대 경로. */
export function engineFileArgument(workDir, target) {
  const relative = path.relative(workDir, target);
  const ascii = (value) => /^[\x20-\x7e]+$/u.test(value);
  if (relative && !path.isAbsolute(relative) && !/^[A-Za-z]:/u.test(relative) && ascii(relative)) return relative;
  return target;
}

export function parseWhisperProgress(line) {
  const match = /progress\s*=\s*(\d{1,3})%/u.exec(String(line));
  return match ? Math.min(100, Number(match[1])) : null;
}

export function parseWhisperAudioSeconds(line) {
  const match = /\(\d+ samples, ([0-9]+(?:\.[0-9]+)?) sec\)/u.exec(String(line));
  return match ? Number(match[1]) : null;
}

function binaryStringToBytes(value) {
  if (!/[^\u0000-\u00ff]/u.test(value)) return Buffer.from(value, 'latin1');
  const parts = [];
  for (const character of value) {
    const code = character.codePointAt(0);
    parts.push(code <= 0xff ? Buffer.from([code]) : Buffer.from(character, 'utf8'));
  }
  return Buffer.concat(parts);
}

/** 끝에서 끝나지 않은 UTF-8 글자의 바이트 수(0 이면 완결). */
export function incompleteUtf8Tail(bytes) {
  let index = bytes.length - 1;
  let continuation = 0;
  while (index >= 0 && continuation < 3 && (bytes[index] & 0xc0) === 0x80) { index -= 1; continuation += 1; }
  if (index < 0) return 0;
  const lead = bytes[index];
  const needed = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
  return needed > continuation + 1 ? continuation + 1 : 0;
}

/**
 * whisper.cpp 는 바이트 단위 토큰으로 세그먼트를 나누므로 한글 한 글자(3바이트)가 두 세그먼트에 걸칠 수 있다.
 * 앞 세그먼트 끝의 끝나지 않은 바이트를 다음 세그먼트로 넘겨 해독한다.
 * (모델이 애초에 잘못된 바이트를 고른 경우는 복구할 수 없다 → parseWhisperJson 이 U+FFFD 를 빼고 개수를 알린다.)
 */
export function repairUtf8Segments(segments) {
  const decoder = new TextDecoder('utf-8');
  const output = [];
  let carry = Buffer.alloc(0);
  segments.forEach((segment, index) => {
    let bytes = Buffer.concat([carry, Buffer.from(segment.bytes)]);
    carry = Buffer.alloc(0);
    if (index < segments.length - 1) {
      const tail = incompleteUtf8Tail(bytes);
      if (tail) { carry = bytes.subarray(bytes.length - tail); bytes = bytes.subarray(0, bytes.length - tail); }
    }
    output.push({ startMs: segment.startMs, endMs: segment.endMs, text: decoder.decode(bytes).replace(/\s+/gu, ' ').trim() });
  });
  return output;
}

/**
 * -oj 결과 파일(바이트)을 읽는다. 글자 깨짐을 고치려고 latin1 로 풀어 바이트를 보존한다.
 * 전체 글은 whisper 가 낱말 앞에 붙인 공백을 살려 바이트째 이어 붙인 뒤 한 번에 해독한다
 * (세그먼트가 낱말 중간에서 나뉘어도 띄어쓰기가 끼어들지 않는다).
 * 해독할 수 없는 바이트(U+FFFD)는 화면에 "�" 로 보이지 않게 빼고 unreadableCharacters 로 센다.
 */
export function parseWhisperJson(input) {
  let document;
  try { document = JSON.parse(toBuffer(input).toString('latin1')); } catch { throw fail('engine_failed', '받아쓰기 결과를 읽지 못했습니다. 다시 시도해 주세요.'); }
  const items = Array.isArray(document?.transcription) ? document.transcription : [];
  const raw = items.map((item) => ({
    startMs: Number.isFinite(Number(item?.offsets?.from)) ? Number(item.offsets.from) : null,
    endMs: Number.isFinite(Number(item?.offsets?.to)) ? Number(item.offsets.to) : null,
    bytes: binaryStringToBytes(String(item?.text ?? '')),
  }));
  const strip = (value) => value.replace(/\uFFFD+/gu, '').replace(/\s+/gu, ' ').trim();
  const segments = repairUtf8Segments(raw).map((segment) => ({ ...segment, text: strip(segment.text) })).filter((segment) => segment.text);
  const language = typeof document?.result?.language === 'string' ? document.result.language : '';
  const decoded = new TextDecoder('utf-8').decode(Buffer.concat(raw.map((segment) => segment.bytes)));
  const unreadableCharacters = (decoded.match(/\uFFFD/gu) || []).length;
  return { language, segments, text: strip(decoded), unreadableCharacters };
}

/** 녹음 길이·모델에 맞춘 시간 제한. whisper 는 30초 단위로 처리하므로 짧은 녹음도 한 구간만큼은 기다린다. */
export function estimateTranscriptionTimeoutMs(audioSeconds, model, { minimumMs = 60_000, maximumMs = 3 * 60 * 60_000 } = {}) {
  const seconds = Number.isFinite(audioSeconds) && audioSeconds > 0 ? audioSeconds : speechLimits.maxFileSeconds;
  const factor = Number(model?.slowPcSecondsPerAudioSecond) > 0 ? Number(model.slowPcSecondsPerAudioSecond) : 4;
  const windows = Math.max(1, Math.ceil(seconds / 30));
  return Math.round(Math.min(maximumMs, Math.max(minimumMs, 30_000 + windows * 30 * factor * 1000)));
}

/** 엔진 종료 코드·오류 출력을 사용자 문장으로 바꾼다. */
export function classifyEngineExit(code, stderr = '') {
  const unsigned = typeof code === 'number' ? code >>> 0 : null;
  if (unsigned === statusDllNotFound) {
    return {
      status: 'engine_runtime_missing',
      userMessage: '받아쓰기 엔진에 필요한 Microsoft Visual C++ 런타임이 이 PC에 없습니다. Microsoft 공식 "Visual C++ 재배포 가능 패키지(x64)"를 설치한 뒤 다시 시도해 주세요.',
      helpUrl: speechEngineRelease.vcRuntimeHelpUrl,
    };
  }
  if (unsigned === statusInvalidImageFormat) return { status: 'engine_damaged', userMessage: '받아쓰기 엔진 파일이 손상되었거나 이 PC와 맞지 않습니다. 엔진을 다시 받아 주세요.' };
  if (unsigned === statusIllegalInstruction) return { status: 'engine_unsupported_cpu', userMessage: '이 PC의 CPU에서 받아쓰기 엔진을 실행하지 못했습니다.' };
  const text = String(stderr);
  if (/model file not found|failed to (?:load|initialize) (?:whisper )?(?:model|context)|invalid model/iu.test(text)) {
    return { status: 'model_damaged', userMessage: '받아쓰기 모델을 읽지 못했습니다. 모델을 다시 받아 주세요.' };
  }
  if (/input file not found|failed to (?:read|open|decode) (?:audio|input)|no input files/iu.test(text)) {
    return { status: 'invalid_audio', userMessage: '오디오를 읽지 못했습니다. wav·mp3·flac·ogg 파일인지 확인해 주세요.' };
  }
  if (/unknown language/iu.test(text)) return { status: 'invalid_request', userMessage: '지원하지 않는 언어입니다. 언어 설정을 확인해 주세요.' };
  return { status: 'engine_failed', userMessage: '받아쓰기 엔진이 작업을 끝내지 못했습니다. 잠시 후 다시 시도해 주세요.' };
}

function classifySpawnError(error) {
  if (error?.code === 'ENOENT') return { status: 'needs_engine', userMessage: '받아쓰기 엔진 파일이 없습니다. 엔진을 다시 받아 주세요.' };
  if (['EACCES', 'EPERM', 'UNKNOWN'].includes(error?.code)) {
    return { status: 'engine_blocked', userMessage: '보안 프로그램이나 회사 정책이 받아쓰기 엔진 실행을 막았습니다. 관리자에게 ModyCrew 받아쓰기 엔진 실행 허용을 요청해 주세요.' };
  }
  return { status: 'engine_failed', userMessage: '받아쓰기 엔진을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
}

// ── 프로세스 실행 ─────────────────────────────────────────────────────────────
function childEnvironment(engineDir) {
  // API 키 같은 앱 환경변수를 엔진에 넘기지 않는다.
  const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  return { SystemRoot: systemRoot, windir: systemRoot, PATH: [engineDir, path.join(systemRoot, 'System32')].join(path.delimiter), TEMP: os.tmpdir(), TMP: os.tmpdir() };
}

function runProcess(file, args, { cwd, env, timeoutMs, spawn = nodeSpawn, signal, onStderrLine } = {}) {
  return new Promise((resolve) => {
    const stdout = [];
    let stdoutBytes = 0;
    let stderr = '';
    let pendingLine = '';
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let child;
    let timer;
    const onAbort = () => { cancelled = true; try { child?.kill(); } catch { /* 이미 끝남 */ } };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      resolve({ stdout: Buffer.concat(stdout), stderr, timedOut, cancelled, ...value });
    };
    try { child = spawn(file, args, { cwd, env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { finish({ spawnError: error }); return; }
    timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch { /* 이미 끝남 */ } }, Math.max(1000, timeoutMs ?? 60_000));
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    child.stdout?.on('data', (chunk) => { if (stdoutBytes < 4 * 1024 * 1024) { stdout.push(chunk); stdoutBytes += chunk.length; } });
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderr = (stderr + text).slice(-64 * 1024);
      if (!onStderrLine) return;
      const lines = (pendingLine + text).split(/\r?\n/u);
      pendingLine = lines.pop() ?? '';
      for (const line of lines) onStderrLine(line);
    });
    child.on('error', (error) => finish({ spawnError: error }));
    child.on('close', (code, signalName) => { if (pendingLine && onStderrLine) onStderrLine(pendingLine); finish({ code, signal: signalName }); });
  });
}

// ── 엔진 찾기·확인 ────────────────────────────────────────────────────────────
function engineCandidates(options) {
  const list = [];
  if (options.engineDir) list.push({ dir: path.resolve(options.engineDir), source: 'configured' });
  const resources = options.resourcesPath ?? process.resourcesPath;
  if (resources) list.push({ dir: path.join(resources, 'toolchain', 'whisper'), source: 'bundled' });
  try { list.push({ dir: speechPaths(options).engineRoot, source: 'downloaded' }); } catch { /* 저장 위치 없음 */ }
  if (options.isPackaged === false) list.push({ dir: path.join(repoRoot, 'dist', 'whisper-toolchain-staging', 'whisper'), source: 'dev' });
  return list;
}

async function regularFile(file) {
  try { const info = await lstat(file); return info.isFile() && !info.isSymbolicLink() ? info : null; } catch { return null; }
}

async function verifyDownloadedEngine(dir) {
  const receiptPath = path.join(dir, 'modycrew-install.json');
  const receiptInfo = await regularFile(receiptPath);
  if (!receiptInfo) return false;
  const cacheKey = `${dir}|${receiptInfo.mtimeMs}`;
  if (engineVerifyCache.has(cacheKey)) return engineVerifyCache.get(cacheKey);
  let ok = false;
  try {
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    const allowed = new Set([...speechEngineRelease.files, speechEngineRelease.licenseFile.name]);
    ok = receipt.version === speechEngineRelease.version && receipt.archiveSha256 === speechEngineRelease.archive.sha256 && Array.isArray(receipt.files) &&
      speechEngineRelease.requiredFiles.every((name) => receipt.files.some((item) => item.name === name));
    for (const item of ok ? receipt.files : []) {
      if (!allowed.has(item.name) || !/^[a-f0-9]{64}$/u.test(item.sha256)) { ok = false; break; }
      const bytes = await readFile(path.join(dir, item.name));
      if (bytes.length !== item.bytes || createHash('sha256').update(bytes).digest('hex') !== item.sha256) { ok = false; break; }
    }
  } catch { ok = false; }
  engineVerifyCache.set(cacheKey, ok);
  return ok;
}

async function findEngine(options) {
  for (const candidate of engineCandidates(options)) {
    const exe = path.join(candidate.dir, 'whisper-cli.exe');
    const present = await Promise.all(speechEngineRelease.requiredFiles.map((name) => regularFile(path.join(candidate.dir, name))));
    if (present.some((info) => !info)) continue;
    if (candidate.source === 'downloaded' && !(await verifyDownloadedEngine(candidate.dir))) continue;
    return { ...candidate, exe };
  }
  return null;
}

async function probeEngine(engine, options) {
  const cached = probeCache.get(engine.exe);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.value;
  const run = await runProcess(engine.exe, ['--version'], { cwd: engine.dir, env: childEnvironment(engine.dir), timeoutMs: 15_000, spawn: options.spawn });
  let value;
  if (run.spawnError) value = { ok: false, ...classifySpawnError(run.spawnError) };
  else if (run.timedOut) value = { ok: false, status: 'engine_failed', userMessage: '받아쓰기 엔진이 응답하지 않습니다. PC를 다시 시작한 뒤 시도해 주세요.' };
  else {
    const version = /whisper\.cpp version:\s*([0-9][0-9.]*)/u.exec(`${run.stdout.toString('utf8')}\n${run.stderr}`)?.[1];
    value = run.code === 0 && version ? { ok: true, version } : { ok: false, ...classifyEngineExit(run.code, run.stderr) };
  }
  probeCache.set(engine.exe, { at: Date.now(), value });
  return value;
}

// ── 모델 ─────────────────────────────────────────────────────────────────────
function modelLocation(entry, options) {
  const dir = path.join(speechPaths(options).modelsRoot, entry.id);
  return { dir, file: path.join(dir, entry.file), receipt: path.join(dir, 'modycrew-install.json') };
}

async function inspectModel(entry, options) {
  const location = modelLocation(entry, options);
  const info = await regularFile(location.file);
  if (!info) {
    try { await lstat(location.file); return { state: 'damaged', ...location }; } catch { return { state: 'not_installed', ...location }; }
  }
  if (info.size !== entry.bytes) return { state: 'damaged', ...location };
  try {
    const receipt = JSON.parse(await readFile(location.receipt, 'utf8'));
    const same = receipt.id === entry.id && receipt.sha256 === entry.sha256 && receipt.bytes === entry.bytes && Math.abs(Number(receipt.mtimeMs) - info.mtimeMs) < 2;
    return { state: same ? 'installed' : 'unverified', installedAt: receipt.installedAt, ...location };
  } catch {
    return { state: 'unverified', ...location };
  }
}

async function readPreferredModelId(options) {
  try {
    const value = JSON.parse(await readFile(speechPaths(options).preferences, 'utf8'))?.modelId;
    return Object.hasOwn(speechModelCatalog, value) ? value : '';
  } catch { return ''; }
}

async function atomicWriteJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx' });
  try { await rename(temporary, file); } catch (error) { await rm(temporary, { force: true }); throw error; }
}

async function chooseInstalledModel(requestedId, options) {
  if (requestedId !== undefined && requestedId !== null && requestedId !== '') {
    const entry = resolveSpeechModel(requestedId);
    const inspected = await inspectModel(entry, options);
    if (inspected.state !== 'installed') throw fail('needs_model', `${entry.label} 받아쓰기 모델을 먼저 내려받아 주세요(약 ${megabytes(entry.bytes)}).`, { modelId: entry.id, downloadBytes: entry.bytes });
    return { entry, file: inspected.file };
  }
  const preferred = await readPreferredModelId(options);
  for (const id of [preferred, ...speechModelPreference].filter(Boolean)) {
    const entry = speechModelCatalog[id];
    const inspected = await inspectModel(entry, options);
    if (inspected.state === 'installed') return { entry, file: inspected.file };
  }
  const entry = speechModelCatalog[defaultSpeechModelId];
  throw fail('needs_model', `받아쓰기 모델을 한 번 내려받아야 합니다(${entry.label} 약 ${megabytes(entry.bytes)}).`, { modelId: entry.id, downloadBytes: entry.bytes });
}

async function hashFile(file, signal) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    const abort = () => stream.destroy(new Error('aborted'));
    signal?.addEventListener?.('abort', abort, { once: true });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
    stream.on('close', () => signal?.removeEventListener?.('abort', abort));
  });
  return hash.digest('hex');
}

// ── 내려받기 ──────────────────────────────────────────────────────────────────
function hostAllowed(hostname, hosts) {
  const host = String(hostname).toLowerCase();
  return hosts.some((rule) => {
    const value = String(rule).toLowerCase();
    return value.startsWith('.') ? host.endsWith(value) && host.length > value.length : host === value;
  });
}

/** 고정 주소에서 받아 크기·SHA-256 를 확인한다. 리다이렉트는 허용 호스트(https)로만 따라간다. */
export async function downloadVerifiedFile({ url, hosts, expectedBytes, expectedSha256, destination, signal, fetchImpl = globalThis.fetch, onBytes, maxRedirects = 5 }) {
  let current = new URL(url);
  let response;
  for (let hop = 0; ; hop += 1) {
    if (current.protocol !== 'https:' || current.username || current.password || !hostAllowed(current.hostname, hosts)) {
      throw fail('download_failed', '승인된 공식 배포처가 아닌 주소로 연결되어 내려받기를 멈췄습니다.');
    }
    try { response = await fetchImpl(current.href, { redirect: 'manual', signal, headers: { 'user-agent': 'ModyCrew-speech' } }); }
    catch (error) {
      if (signal?.aborted) throw error;
      throw fail('download_failed', '배포처에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      try { await response.body?.cancel?.(); } catch { /* 본문 없음 */ }
      if (!location || hop >= maxRedirects) throw fail('download_failed', '배포처 주소를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      current = new URL(location, current);
      continue;
    }
    break;
  }
  if (!response.ok || !response.body) throw fail('download_failed', `배포처에서 파일을 받지 못했습니다(HTTP ${response.status}). 잠시 후 다시 시도해 주세요.`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared && declared !== expectedBytes) throw fail('download_failed', '배포처 파일 크기가 승인된 값과 다릅니다. 앱을 업데이트한 뒤 다시 시도해 주세요.');
  const hash = createHash('sha256');
  let received = 0;
  const handle = await open(destination, 'wx', 0o600);
  try {
    for await (const chunk of response.body) {
      received += chunk.length;
      if (received > expectedBytes) throw fail('download_failed', '배포처 파일 크기가 승인된 값과 다릅니다. 앱을 업데이트한 뒤 다시 시도해 주세요.');
      hash.update(chunk);
      await handle.write(chunk);
      onBytes?.(chunk.length);
    }
  } finally {
    await handle.close();
  }
  const sha256 = hash.digest('hex');
  if (received !== expectedBytes || sha256 !== expectedSha256) throw fail('download_failed', '내려받은 파일의 무결성 검사에 실패했습니다. 다시 시도해 주세요.');
  return { bytes: received, sha256 };
}

async function ensureFreeSpace(directory, bytes) {
  if (!bytes) return;
  try {
    await mkdir(directory, { recursive: true });
    const info = await statfs(directory);
    const free = Number(info.bavail) * Number(info.bsize);
    if (Number.isFinite(free) && free < bytes + speechLimits.freeSpaceMarginBytes) {
      throw fail('disk_full', `저장 공간이 부족합니다. ${megabytes(bytes + speechLimits.freeSpaceMarginBytes)} 이상 비운 뒤 다시 시도해 주세요.`);
    }
  } catch (error) {
    if (error instanceof SpeechError) throw error;
  }
}

async function installModel(entry, inspected, options, signal, onBytes) {
  await mkdir(inspected.dir, { recursive: true });
  const writeReceipt = async () => {
    const info = await lstat(inspected.file);
    await atomicWriteJson(inspected.receipt, { id: entry.id, file: entry.file, bytes: entry.bytes, sha256: entry.sha256, mtimeMs: info.mtimeMs, revision: entry.revision, source: entry.url, installedAt: new Date().toISOString() });
  };
  if (inspected.state === 'unverified' && (await hashFile(inspected.file, signal)) === entry.sha256) { await writeReceipt(); return { downloaded: false }; }
  const pending = path.join(inspected.dir, `.download-${randomUUID()}.part`);
  try {
    await downloadVerifiedFile({ url: entry.url, hosts: speechModelDownloadHosts, expectedBytes: entry.bytes, expectedSha256: entry.sha256, destination: pending, signal, fetchImpl: options.fetch, onBytes });
    await rm(inspected.file, { force: true });
    await rename(pending, inspected.file);
    await writeReceipt();
    return { downloaded: true };
  } finally {
    await rm(pending, { force: true }).catch(() => {});
  }
}

async function installEngine(options, signal, onBytes) {
  const target = speechPaths(options).engineRoot;
  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true });
  const zipPath = path.join(parent, `.engine-${randomUUID()}.zip.part`);
  const pendingDir = path.join(parent, `.engine-${randomUUID()}`);
  const previousDir = path.join(parent, `.engine-previous-${randomUUID()}`);
  const { archive, licenseFile } = speechEngineRelease;
  try {
    await downloadVerifiedFile({ url: archive.url, hosts: speechEngineRelease.downloadHosts, expectedBytes: archive.bytes, expectedSha256: archive.sha256, destination: zipPath, signal, fetchImpl: options.fetch, onBytes });
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await readFile(zipPath), { checkCRC32: true });
    await mkdir(pendingDir);
    const files = [];
    for (const name of speechEngineRelease.files) {
      const item = zip.file(`${archive.folder}/${name}`);
      if (!item) {
        if (speechEngineRelease.requiredFiles.includes(name)) throw fail('download_failed', '받아쓰기 엔진 패키지가 예상과 다릅니다. 앱을 업데이트해 주세요.');
        continue;
      }
      const data = await item.async('nodebuffer');
      if (data.length > 32 * 1024 * 1024) throw fail('download_failed', '받아쓰기 엔진 패키지가 예상과 다릅니다. 앱을 업데이트해 주세요.');
      await writeFile(path.join(pendingDir, name), data, { flag: 'wx' });
      files.push({ name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
    }
    const licensePath = path.join(pendingDir, licenseFile.name);
    await downloadVerifiedFile({ url: licenseFile.url, hosts: speechEngineRelease.downloadHosts, expectedBytes: licenseFile.bytes, expectedSha256: licenseFile.sha256, destination: licensePath, signal, fetchImpl: options.fetch });
    files.push({ name: licenseFile.name, bytes: licenseFile.bytes, sha256: licenseFile.sha256 });
    await writeFile(path.join(pendingDir, 'modycrew-install.json'), JSON.stringify({
      id: speechEngineRelease.id, version: speechEngineRelease.version, buildTag: speechEngineRelease.buildTag, commit: speechEngineRelease.commit,
      archiveSha256: archive.sha256, source: archive.url, license: speechEngineRelease.license, files, installedAt: new Date().toISOString(),
    }, null, 2));
    let backedUp = false;
    try { await rename(target, previousDir); backedUp = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await rename(pendingDir, target); } catch (error) { if (backedUp) await rename(previousDir, target); throw error; }
  } finally {
    await rm(zipPath, { force: true }).catch(() => {});
    await rm(pendingDir, { recursive: true, force: true }).catch(() => {});
    await rm(previousDir, { recursive: true, force: true }).catch(() => {});
  }
  engineVerifyCache.clear();
  probeCache.clear();
}

// ── 작업 폴더 ─────────────────────────────────────────────────────────────────
const workDirPattern = /^job-[A-Za-z0-9]{6}$/u;

async function sweepStaleWorkDirs(workRoot) {
  if (state.sweptWorkRoots.has(workRoot)) return;
  state.sweptWorkRoots.add(workRoot);
  let names = [];
  try { names = await readdir(workRoot); } catch { return; }
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const name of names) {
    if (!workDirPattern.test(name)) continue;
    const dir = path.join(workRoot, name);
    try {
      const info = await lstat(dir);
      if (info.isDirectory() && !info.isSymbolicLink() && info.mtimeMs < cutoff) await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch { /* 다른 프로세스가 쓰는 중이면 다음에 정리 */ }
  }
}

async function createWorkDir(options) {
  const { workRoot } = speechPaths(options);
  await mkdir(workRoot, { recursive: true });
  await sweepStaleWorkDirs(workRoot);
  return mkdtemp(path.join(workRoot, 'job-'));
}

async function removeWorkDir(dir, options) {
  const { workRoot } = speechPaths(options);
  // 이 모듈이 만든 job-xxxxxx 폴더만 지운다.
  if (path.dirname(dir) !== workRoot || !workDirPattern.test(path.basename(dir))) return;
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

// ── 작업 큐·진행률 ────────────────────────────────────────────────────────────
function publicJob(job) {
  if (!job) return null;
  return {
    kind: job.kind,
    requestId: job.requestId,
    modelId: job.modelId || '',
    stage: job.progress?.stage || '',
    percent: Math.max(0, Math.min(100, Math.round(job.progress?.percent ?? 0))),
    receivedBytes: job.progress?.receivedBytes ?? 0,
    totalBytes: job.progress?.totalBytes ?? 0,
    queued: state.queue.length,
  };
}

function report(job, patch) {
  job.progress = { ...job.progress, ...patch };
  const now = Date.now();
  if (patch.percent !== 100 && now - (job.lastReportAt || 0) < 250) return;
  job.lastReportAt = now;
  try { job.onProgress?.(publicJob(job)); } catch { /* 화면이 닫혀도 작업은 계속 */ }
}

function enqueue(job) {
  if (state.queue.length >= speechLimits.maxQueued) throw fail('busy', '다른 받아쓰기가 진행 중입니다. 끝난 뒤 다시 시도해 주세요.');
  return new Promise((resolve, reject) => {
    state.queue.push({ ...job, resolve, reject });
    pump();
  });
}

function pump() {
  if (state.active || !state.queue.length) return;
  const job = state.queue.shift();
  state.active = job;
  Promise.resolve()
    .then(() => job.run(job))
    .then(job.resolve, job.reject)
    .finally(() => { state.active = null; pump(); });
}

function sanitizeRequestId(value) {
  const id = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,80}$/u.test(id) ? id : '';
}

// ── 입력 준비 ─────────────────────────────────────────────────────────────────
function decodeAudioPayload(value) {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value?.base64 === 'string') {
    const text = typeof value === 'string' ? value : value.base64;
    if (text.length > Math.ceil(speechLimits.maxWavBytes / 3) * 4 + 8) throw fail('too_large', '녹음이 너무 깁니다. 30분 이하로 나눠 주세요.');
    return Buffer.from(text, 'base64');
  }
  return toBuffer(value);
}

async function prepareInput(payload, options) {
  const bytes = decodeAudioPayload(payload.audio);
  if (bytes) {
    if (bytes.length > speechLimits.maxWavBytes) throw fail('too_large', '녹음이 너무 깁니다. 30분 이하로 나눠 주세요.');
    const info = parseWavHeader(bytes);
    assertDictationWav(info);
    if (info.durationSec > speechLimits.maxRecordingSeconds) throw fail('too_large', '녹음이 너무 깁니다. 30분 이하로 나눠 주세요.');
    if (info.durationSec < speechLimits.minAudioSeconds) throw fail('too_short', '녹음이 너무 짧습니다. 버튼을 누른 뒤 말씀하고 다시 눌러 주세요.');
    return { kind: 'bytes', bytes, durationSec: info.durationSec, level: analyzePcm16Level(bytes, info.dataOffset, info.dataBytes, info.sampleRate) };
  }
  if (payload.filePath !== undefined) {
    const roots = typeof options.allowedRoots === 'function' ? await options.allowedRoots() : options.allowedRoots;
    const file = await resolveAllowedAudioFile(payload.filePath, roots);
    let durationSec = null;
    if (file.extension === '.wav') {
      const handle = await open(file.path, 'r');
      try {
        const head = Buffer.alloc(Math.min(file.bytes, 1024 * 1024));
        await handle.read(head, 0, head.length, 0);
        const info = parseWavHeader(head);
        const blockAlign = info.channels * (info.bitsPerSample / 8);
        durationSec = (file.bytes - info.dataOffset) / (info.sampleRate * blockAlign);
      } finally { await handle.close(); }
      if (durationSec > speechLimits.maxFileSeconds) throw fail('too_long', '2시간보다 긴 오디오는 나눠서 받아써 주세요.');
    }
    return { kind: 'file', file, durationSec };
  }
  throw fail('invalid_request', '받아쓸 녹음이나 오디오 파일을 보내 주세요.');
}

// ── 받아쓰기 ──────────────────────────────────────────────────────────────────
async function runLocalTranscription(job) {
  const { input, model, engine, language, timestamps, options, requestId } = job;
  const startedAt = Date.now();
  const controller = new AbortController();
  job.abort = () => controller.abort();
  if (job.cancelRequested) controller.abort();
  const workDir = await createWorkDir(options);
  try {
    const inputName = input.kind === 'bytes' ? 'input.wav' : `input${input.file.extension}`;
    const inputPath = path.join(workDir, inputName);
    if (input.kind === 'bytes') await writeFile(inputPath, input.bytes, { flag: 'wx', mode: 0o600 });
    else {
      await copyFile(input.file.path, inputPath, fsConstants.COPYFILE_EXCL);
      if ((await lstat(inputPath)).size !== input.file.bytes) throw fail('invalid_audio', '받아쓰는 도중 파일이 바뀌었습니다. 다시 시도해 주세요.');
    }
    const args = buildWhisperArgs({
      model: engineFileArgument(workDir, model.file), input: inputName, outputBase: 'out', language,
      threads: options.threads ?? defaultThreadCount(), beamSize: options.beamSize ?? model.entry.beamSize ?? defaultBeamSize,
    });
    report(job, { stage: 'transcribing', percent: 0 });
    let audioSeconds = input.durationSec;
    let tooLong = false;
    const run = await runProcess(engine.exe, args, {
      cwd: workDir,
      env: childEnvironment(engine.dir),
      timeoutMs: options.timeoutMs ?? estimateTranscriptionTimeoutMs(input.durationSec, model.entry),
      spawn: options.spawn,
      signal: controller.signal,
      onStderrLine: (line) => {
        const percent = parseWhisperProgress(line);
        if (percent !== null) report(job, { percent });
        const seconds = parseWhisperAudioSeconds(line);
        if (seconds !== null) {
          audioSeconds = seconds;
          if (input.kind === 'file' && seconds > speechLimits.maxFileSeconds) { tooLong = true; controller.abort(); }
        }
      },
    });
    if (tooLong) throw fail('too_long', '2시간보다 긴 오디오는 나눠서 받아써 주세요.');
    if (run.cancelled) return result('cancelled', '받아쓰기를 취소했습니다.', { requestId, text: '' });
    if (run.timedOut) throw fail('timeout', '받아쓰기가 너무 오래 걸려 멈췄습니다. 더 짧게 나누거나 가벼운 모델로 다시 시도해 주세요.');
    if (run.spawnError) { probeCache.delete(engine.exe); const failure = classifySpawnError(run.spawnError); throw fail(failure.status, failure.userMessage); }
    if (run.code !== 0) {
      probeCache.delete(engine.exe);
      const failure = classifyEngineExit(run.code, run.stderr);
      throw fail(failure.status, failure.userMessage, failure.helpUrl ? { helpUrl: failure.helpUrl } : {});
    }
    let output;
    try { output = await readFile(path.join(workDir, 'out.json')); }
    catch { const failure = classifyEngineExit(run.code, run.stderr); throw fail(failure.status, failure.userMessage); }
    const parsed = parseWhisperJson(output);
    report(job, { percent: 100, stage: 'done' });
    const fields = {
      requestId, modelId: model.entry.id, engine: 'local', language: parsed.language || language,
      audioSeconds: Number.isFinite(audioSeconds) ? Math.round(audioSeconds * 10) / 10 : null, elapsedMs: Date.now() - startedAt,
    };
    if (!parsed.text) return result('no_speech', '알아들을 수 있는 말소리가 없었습니다. 마이크 가까이에서 다시 말씀해 주세요.', { ...fields, text: '' });
    const possibleHallucination = looksLikeSilenceHallucination(parsed.text) && (!input.level || input.level.activeSeconds < 2.5);
    const userMessage = possibleHallucination ? '말소리가 작거나 짧아 잘못 받아썼을 수 있습니다. 내용을 확인해 주세요.'
      : parsed.unreadableCharacters ? '일부 글자를 알아듣지 못해 뺐습니다. 내용을 확인한 뒤 사용해 주세요.'
        : '받아쓴 글을 확인한 뒤 사용해 주세요.';
    return result('transcribed', userMessage, {
      ...fields, text: parsed.text, possibleHallucination, unreadableCharacters: parsed.unreadableCharacters, ...(timestamps ? { segments: parsed.segments } : {}),
    });
  } finally {
    await removeWorkDir(workDir, options).catch(() => {});
  }
}

async function runCloudTranscription(job) {
  const { input, language, options, requestId } = job;
  const controller = new AbortController();
  job.abort = () => controller.abort();
  if (job.cancelRequested) controller.abort();
  const startedAt = Date.now();
  report(job, { stage: 'transcribing', percent: 0 });
  try {
    const response = await options.cloudTranscribe({ wavBytes: input.bytes, language, signal: controller.signal });
    const text = String(response?.text ?? '').replace(/\s+/gu, ' ').trim();
    const fields = { requestId, engine: 'cloud', provider: String(response?.provider || options.cloudProviderLabel || ''), language, audioSeconds: Math.round(input.durationSec * 10) / 10, elapsedMs: Date.now() - startedAt };
    if (!text) return result('no_speech', '알아들을 수 있는 말소리가 없었습니다. 다시 말씀해 주세요.', { ...fields, text: '' });
    return result('transcribed', '외부 AI로 받아쓴 글입니다. 내용을 확인한 뒤 사용해 주세요.', { ...fields, text });
  } catch (error) {
    if (controller.signal.aborted) return result('cancelled', '받아쓰기를 취소했습니다.', { requestId, text: '' });
    if (error instanceof SpeechError) throw error;
    throw fail('cloud_failed', '외부 AI 받아쓰기가 실패했습니다. 잠시 후 다시 시도하거나 이 PC 받아쓰기를 이용해 주세요.');
  }
}

async function transcribe(payload, options) {
  const requestId = sanitizeRequestId(payload.requestId) || randomUUID();
  const language = normalizeLanguage(payload.language);
  const timestamps = payload.timestamps === true;
  const input = await prepareInput(payload, options);
  if (input.level && input.level.activeSeconds < speechLimits.minActiveSpeechSeconds) {
    return result('no_speech', '말소리가 들리지 않았습니다. 마이크 가까이에서 다시 말씀해 주세요.', { requestId, text: '', level: input.level });
  }
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  if (payload.engine === 'cloud') {
    if (typeof options.cloudTranscribe !== 'function') {
      return result('cloud_unavailable', '클라우드 받아쓰기는 OpenAI 키를 연결한 경우에만 쓸 수 있습니다. 기본 받아쓰기는 이 PC 안에서 처리합니다.', { requestId });
    }
    if (payload.cloudConsent !== true) return result('cloud_consent_required', '녹음을 외부 AI 서비스로 보내야 합니다. 보내도 되는지 확인해 주세요.', { requestId });
    if (input.kind !== 'bytes') return result('cloud_unavailable', '클라우드 받아쓰기는 앱에서 녹음한 음성만 보낼 수 있습니다.', { requestId });
    if (input.bytes.length > speechLimits.cloudMaxBytes) return result('too_large', '클라우드 받아쓰기는 25MB(약 13분) 이하만 보낼 수 있습니다.', { requestId });
    return enqueue({ kind: 'transcribe', requestId, input, language, options, onProgress, run: runCloudTranscription });
  }
  if ((options.platform ?? process.platform) !== 'win32') return result('unsupported_platform', '받아쓰기는 현재 Windows 앱에서만 사용할 수 있습니다.', { requestId });
  const model = await chooseInstalledModel(payload.modelId, options);
  const engine = await findEngine(options);
  if (!engine) throw fail('needs_engine', '받아쓰기 엔진을 먼저 내려받아 주세요.', { modelId: model.entry.id, downloadBytes: speechEngineRelease.archive.bytes });
  const probe = await probeEngine(engine, options);
  if (!probe.ok) throw fail(probe.status, probe.userMessage, probe.helpUrl ? { helpUrl: probe.helpUrl } : {});
  return enqueue({ kind: 'transcribe', requestId, modelId: model.entry.id, input, model, engine, language, timestamps, options, onProgress, run: runLocalTranscription });
}

// ── 상태·준비·취소 ────────────────────────────────────────────────────────────
function readMicrophoneAccess(options) {
  try {
    const value = options.systemPreferences?.getMediaAccessStatus?.('microphone');
    return typeof value === 'string' ? value : 'unknown';
  } catch { return 'unknown'; }
}

async function buildStatus(options, overrides = {}) {
  const platformOk = (options.platform ?? process.platform) === 'win32';
  const engine = platformOk ? await findEngine(options) : null;
  const probe = engine ? await probeEngine(engine, options) : null;
  const preferred = await readPreferredModelId(options);
  const models = [];
  for (const entry of Object.values(speechModelCatalog)) {
    const inspected = await inspectModel(entry, options);
    models.push({ id: entry.id, label: entry.label, description: entry.description, downloadBytes: entry.bytes, state: inspected.state, installed: inspected.state === 'installed', recommended: entry.recommended === true });
  }
  const installed = models.filter((model) => model.installed).map((model) => model.id);
  const selectedModelId = [preferred, ...speechModelPreference].find((id) => id && installed.includes(id)) || '';
  const job = state.download ? publicJob(state.download) : publicJob(state.active);
  const defaultEntry = speechModelCatalog[defaultSpeechModelId];
  let status = 'ready';
  let userMessage = '받아쓰기를 사용할 수 있습니다. 녹음은 이 PC 안에서만 글로 바뀝니다.';
  let helpUrl;
  if (!platformOk) { status = 'unsupported_platform'; userMessage = '받아쓰기는 현재 Windows 앱에서만 사용할 수 있습니다.'; }
  else if (state.download) { status = 'downloading'; userMessage = '받아쓰기 모델을 내려받는 중입니다.'; }
  else if (!engine) { status = 'needs_engine'; userMessage = `받아쓰기 엔진과 모델을 한 번 내려받아야 합니다(약 ${megabytes(speechEngineRelease.archive.bytes + defaultEntry.bytes)}).`; }
  else if (!probe.ok) { status = probe.status; userMessage = probe.userMessage; helpUrl = probe.helpUrl; }
  else if (!selectedModelId) { status = 'needs_model'; userMessage = `받아쓰기 모델을 한 번 내려받아야 합니다(${defaultEntry.label} 약 ${megabytes(defaultEntry.bytes)}).`; }
  return result(overrides.status ?? status, overrides.userMessage ?? userMessage, {
    ...(helpUrl ? { helpUrl } : {}),
    engine: engine ? { source: engine.source, version: probe?.version || speechEngineRelease.version, license: speechEngineRelease.license } : null,
    models,
    selectedModelId,
    defaultModelId: defaultSpeechModelId,
    job,
    microphoneAccess: readMicrophoneAccess(options),
    cloud: { available: typeof options.cloudTranscribe === 'function', provider: options.cloudProviderLabel || '', requiresConsent: true },
    limits: { maxRecordingSeconds: speechLimits.maxRecordingSeconds, maxFileBytes: speechLimits.maxFileBytes, maxFileSeconds: speechLimits.maxFileSeconds },
    privacy: 'local_only_by_default',
  });
}

async function prepare(payload, options) {
  if ((options.platform ?? process.platform) !== 'win32') return result('unsupported_platform', '받아쓰기는 현재 Windows 앱에서만 사용할 수 있습니다.');
  const entry = resolveSpeechModel(payload.modelId || defaultSpeechModelId);
  const requestId = sanitizeRequestId(payload.requestId) || randomUUID();
  const engine = await findEngine(options);
  const inspected = await inspectModel(entry, options);
  const needEngine = !engine;
  const needModel = inspected.state !== 'installed';
  if (!needEngine && !needModel) {
    await atomicWriteJson(speechPaths(options).preferences, { modelId: entry.id });
    return buildStatus(options);
  }
  const downloadBytes = (needEngine ? speechEngineRelease.archive.bytes : 0) + (needModel && inspected.state !== 'unverified' ? entry.bytes : 0);
  if (payload.approved !== true) {
    return result('approval_required', `${entry.label} 받아쓰기 모델(약 ${megabytes(downloadBytes)})을 내려받아야 합니다. 내려받은 뒤에는 인터넷 없이 이 PC 안에서 받아씁니다.`, { modelId: entry.id, downloadBytes, includesEngine: needEngine });
  }
  if (state.download) throw fail('busy', '다른 내려받기가 진행 중입니다. 끝난 뒤 다시 시도해 주세요.');
  const controller = new AbortController();
  const job = { kind: 'download', requestId, modelId: entry.id, controller, onProgress: typeof options.onProgress === 'function' ? options.onProgress : null, progress: { stage: 'confirming', percent: 0, receivedBytes: 0, totalBytes: downloadBytes } };
  state.download = job;
  try {
    if (typeof options.confirmDownload === 'function') {
      const confirmed = await options.confirmDownload({ modelId: entry.id, label: entry.label, downloadBytes, includesEngine: needEngine, source: 'Hugging Face ggerganov/whisper.cpp · GitHub ggml-org/whisper.cpp' });
      if (confirmed !== true) return result('cancelled', '내려받기를 취소했습니다.', { modelId: entry.id });
    }
    await ensureFreeSpace(speechPaths(options).modelsRoot, downloadBytes);
    const timeout = AbortSignal.timeout(options.downloadTimeoutMs ?? 60 * 60_000);
    const signal = AbortSignal.any([controller.signal, timeout]);
    const onBytes = (count) => {
      const receivedBytes = job.progress.receivedBytes + count;
      report(job, { stage: 'downloading', receivedBytes, percent: downloadBytes ? (receivedBytes / downloadBytes) * 100 : 0 });
    };
    try {
      if (needEngine) await installEngine(options, signal, onBytes);
      if (needModel) { report(job, { stage: inspected.state === 'unverified' ? 'verifying' : 'downloading' }); await installModel(entry, inspected, options, signal, onBytes); }
    } catch (error) {
      if (controller.signal.aborted) return result('cancelled', '내려받기를 취소했습니다. 받던 파일은 지웠습니다.', { modelId: entry.id });
      if (timeout.aborted) throw fail('download_failed', '내려받기가 너무 오래 걸려 멈췄습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
      throw error;
    }
    await atomicWriteJson(speechPaths(options).preferences, { modelId: entry.id });
    report(job, { stage: 'done', percent: 100 });
  } finally {
    if (state.download === job) state.download = null;
  }
  return buildStatus(options);
}

function cancel(payload) {
  const id = sanitizeRequestId(payload.requestId);
  let cancelled = 0;
  if (state.active && (!id || state.active.requestId === id)) { state.active.cancelRequested = true; state.active.abort?.(); cancelled += 1; }
  state.queue = state.queue.filter((job) => {
    if (id && job.requestId !== id) return true;
    job.resolve(result('cancelled', '받아쓰기를 취소했습니다.', { requestId: job.requestId, text: '' }));
    cancelled += 1;
    return false;
  });
  if (state.download && (!id || state.download.requestId === id)) { state.download.controller.abort(); cancelled += 1; }
  return result(cancelled ? 'cancelled' : 'idle', cancelled ? '취소했습니다.' : '진행 중인 받아쓰기가 없습니다.', { cancelled });
}

async function selectModel(payload, options) {
  const entry = resolveSpeechModel(payload.modelId);
  if ((await inspectModel(entry, options)).state !== 'installed') throw fail('needs_model', `${entry.label} 모델을 먼저 내려받아 주세요.`, { modelId: entry.id, downloadBytes: entry.bytes });
  await atomicWriteJson(speechPaths(options).preferences, { modelId: entry.id });
  return buildStatus(options, { userMessage: `앞으로 ${entry.label} 모델로 받아씁니다.` });
}

async function removeModel(payload, options) {
  const entry = resolveSpeechModel(payload.modelId);
  if (state.active?.modelId === entry.id || state.download?.modelId === entry.id) throw fail('busy', '이 모델을 쓰는 작업이 끝난 뒤 지워 주세요.');
  // 카탈로그에 고정된 id 의 폴더만 지운다. 녹음은 원래 이 폴더에 저장하지 않는다.
  await rm(modelLocation(entry, options).dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  return buildStatus(options, { userMessage: `${entry.label} 모델을 지웠습니다.` });
}

/**
 * IPC 진입점. options(메인 전용, 렌더러 입력 아님):
 *  app | userDataPath, resourcesPath, isPackaged, allowDevOrigin, systemPreferences,
 *  allowedRoots(배열 또는 async 함수), confirmDownload(async → boolean), onProgress(job), cloudTranscribe, cloudProviderLabel,
 *  개발·검증 전용: engineDir, engineInstallDir, modelsDir, tempRoot, fetch, spawn, platform, threads, beamSize, timeoutMs, trustedSender
 */
export async function handleSpeechRecognitionMessage(event, payload = {}, options = {}) {
  try {
    assertTrustedSender(event, options);
    const request = payload && typeof payload === 'object' ? payload : {};
    switch (String(request.kind ?? '')) {
      case 'status': return await buildStatus(options);
      case 'prepare': return await prepare(request, options);
      case 'transcribe': return await transcribe(request, options);
      case 'cancel': return cancel(request);
      case 'select_model': return await selectModel(request, options);
      case 'remove_model': return await removeModel(request, options);
      default: return result('invalid_request', '지원하지 않는 받아쓰기 요청입니다.');
    }
  } catch (error) {
    if (error instanceof SpeechError) return result(error.status, error.userMessage, error.extra);
    if (error?.message === '지원하는 받아쓰기 모델을 선택해 주세요.') return result('invalid_request', error.message);
    options.log?.('[speech-recognition] unexpected failure', error?.message);
    return result('error', '받아쓰기를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
}

/**
 * 선택 경로: 사용자가 연결한 OpenAI 키로 전사. 메인이 getApiKey 를 넘겨 cloudTranscribe 로 연결한다.
 * 요청마다 사용자 동의(payload.cloudConsent)가 있어야 handleSpeechRecognitionMessage 가 이 함수를 부른다.
 */
export function createOpenAITranscriber({ getApiKey, fetchImpl = globalThis.fetch, model = 'gpt-4o-mini-transcribe' } = {}) {
  const endpoint = 'https://api.openai.com/v1/audio/transcriptions';
  return async ({ wavBytes, language, signal }) => {
    const apiKey = typeof getApiKey === 'function' ? await getApiKey() : '';
    if (!apiKey) throw fail('cloud_unavailable', 'OpenAI 키를 찾지 못했습니다. AI 연결에서 키를 다시 저장해 주세요.');
    const form = new FormData();
    form.append('file', new Blob([wavBytes], { type: 'audio/wav' }), 'recording.wav');
    form.append('model', model);
    if (language && language !== 'auto') form.append('language', language);
    form.append('response_format', 'json');
    let response;
    try { response = await fetchImpl(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal, redirect: 'error' }); }
    catch (error) { if (signal?.aborted) throw error; throw fail('cloud_failed', 'OpenAI에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.'); }
    if (response.status === 401 || response.status === 403) throw fail('cloud_failed', 'OpenAI가 키를 거부했습니다. AI 연결에서 키를 확인해 주세요.');
    if (response.status === 429) throw fail('cloud_failed', 'OpenAI 사용 한도에 걸렸습니다. 잠시 후 다시 시도하거나 이 PC 받아쓰기를 이용해 주세요.');
    if (!response.ok) throw fail('cloud_failed', `OpenAI 받아쓰기가 실패했습니다(HTTP ${response.status}).`);
    const body = await response.json().catch(() => ({}));
    return { text: typeof body?.text === 'string' ? body.text : '', provider: 'openai' };
  };
}
