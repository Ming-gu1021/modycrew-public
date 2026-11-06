/** Reviewed yt-dlp: approval-gated private installation and public metadata only. */
import { createReviewedToolInstaller } from "./reviewed-tool-installer.mjs";
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

export const reviewedYtDlp = Object.freeze({ version: '2026.03.17', sha256: '3db811b366b2da47337d2fcfdfe5bbd9a258dad3f350c54974f005df115a1545', source: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.03.17/SHA2-256SUMS' });
export function publicVideoUrl(input) {
  const url = new URL(String(input));
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) throw new Error('공개 HTTPS 영상 주소가 필요합니다.');
  let id;
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})$/u.exec(url.pathname)?.[1];
  } else if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
  if (!/^[A-Za-z0-9_-]{11}$/u.test(id ?? '')) throw new Error('현재 공개 YouTube 영상 1개만 조회할 수 있습니다.');
  return 'https://www.youtube.com/watch?v=' + id;
}

export function metadataArgs(url) {
  return ['--ignore-config', '--no-plugin-dirs', '--no-js-runtimes', '--no-cache-dir', '--no-playlist', '--skip-download', '--dump-single-json', '--no-warnings', '--socket-timeout', '15', '--retries', '0', '--extractor-retries', '0', '--', publicVideoUrl(url)];
}

function execute(file, args) {
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
    const child = spawn(file, args, { shell: false, windowsHide: true, cwd: os.tmpdir(), env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let output = '', bytes = 0, failure;
    const timer = setTimeout(() => { failure = new Error('영상 정보 조회 시간이 초과됐습니다.'); child.kill(); }, 45000);
    const collect = (chunk, stdout) => { bytes += Buffer.byteLength(chunk); if (bytes > 2 * 1024 * 1024) { failure = new Error('조회 응답이 너무 큽니다.'); child.kill(); } else if (stdout) output += chunk.toString('utf8'); };
    child.stdout.on('data', chunk => collect(chunk, true));
    child.stderr.on('data', chunk => collect(chunk, false));
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); if (failure || code !== 0) reject(failure ?? new Error('영상 정보를 받지 못했습니다. 로그인·외부 런타임이 필요한 영상은 지원하지 않습니다.')); else resolve(output); });
  });
}

export function createReviewedVideoSource({ home = os.homedir(), platform = process.platform, io = fs, run = execute, confirm = async () => false, reviewed = reviewedYtDlp, managedRoot, fetch: fetchImpl, installManifest, arch = process.arch } = {}) {
  let busy = false;
  const installer = managedRoot ? createReviewedToolInstaller({ root: managedRoot, io, fetch: fetchImpl, confirm, manifest: installManifest }) : null;
  async function verifiedFile() {
    if (platform !== 'win32') throw new Error('현재 검증된 Windows 설치본만 지원합니다.');
    if (installer) { const managed = await installer.resolve(); if (managed) return managed; }
    const link = path.join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe');
    const file = await io.realpath(link);
    const stat = await io.stat(file);
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error('yt-dlp 설치 파일을 확인하지 못했습니다.');
    const hash = createHash('sha256').update(await io.readFile(file)).digest('hex');
    if (hash !== reviewed.sha256) throw new Error('설치된 yt-dlp가 검토한 버전과 다릅니다. 자동 설치·업데이트하지 않았습니다.');
    return file;
  }
  async function prepareTool() {
    try { const file = await verifiedFile(); return { status: 'tool_available', file, reused: true, userMessage: '검증된 기존 설치본을 재사용합니다. media.video.inspect로 별도 조회 승인을 받으세요.' }; }
    catch (error) {
      if (error.code !== 'ENOENT' || !installer) return { status: 'needs_setup', userMessage: error.message };
      if (platform !== 'win32' || arch !== 'x64') return { status: 'needs_setup', userMessage: '앱 전용 원본 설치는 현재 Windows x64만 지원합니다.' };
      return await installer.prepare();
    }
  }
  return {
    prepare: prepareTool,
    async status() {
      try { const file = await verifiedFile(); return { status: 'tool_available', userMessage: '공식 해시가 일치하는 기존 yt-dlp로 공개 YouTube 정보 조회를 지원합니다. media.video.inspect를 호출하세요. 영상 다운로드·로그인·쿠키 사용은 지원하지 않습니다.', file, ...reviewedYtDlp }; }
      catch (error) { return { status: 'needs_setup', userMessage: error.message, ...reviewedYtDlp }; }
    },
    async inspect(input) {
      if (busy) return { status: 'busy', userMessage: '이미 영상 정보를 조회 중입니다. 완료 후 다시 요청하세요.' };
      busy = true;
      try {
        const url = publicVideoUrl(input);
        const preparation = await prepareTool();
        if (preparation.status !== 'tool_available') return preparation;
        if (!(await confirm({ kind: 'run', name: '공개 영상 정보 조회', detail: url + '\nYouTube로 주소를 보내 제목·길이·채널 정보를 읽습니다. 영상·자막 다운로드, 로그인, 쿠키, 플러그인, 외부 JS 실행은 하지 않습니다.' }))) return { status: 'declined', userMessage: '영상 정보 조회를 취소했습니다.' };
        const file = await verifiedFile();
        const data = JSON.parse(await run(file, metadataArgs(url)));
        if (!data || data._type === 'playlist' || data.id !== new URL(url).searchParams.get('v')) throw new Error('요청한 단일 영상의 응답이 아닙니다.');
        const clip = (value, length) => typeof value === 'string' ? value.slice(0, length) : '';
        return { status: 'video_metadata', userMessage: '공개 영상 정보를 조회했습니다. 영상·자막 내용은 읽지 않았습니다.', source: url, checkedAt: new Date().toISOString(), toolVersion: reviewedYtDlp.version, video: { id: data.id, title: clip(data.title, 300), channel: clip(data.channel, 200), description: clip(data.description, 4000), durationSeconds: Number.isFinite(data.duration) ? data.duration : null, uploadDate: clip(data.upload_date, 8) } };
      } catch (error) { return { status: 'unavailable', userMessage: error.message }; } finally { busy = false; }
    },
  };
}
