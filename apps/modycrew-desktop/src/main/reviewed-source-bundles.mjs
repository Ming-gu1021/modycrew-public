/** Exact, reviewed source snapshots. No installer, subprocess, dependency or model execution. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseSkillMeta } from './skill-library.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = /^[a-f0-9]{64}$/u;
const idPattern = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const result = (status, userMessage, extra = {}) => ({ status, userMessage, ...extra });
export function sourcePath(value) {
  if (typeof value !== 'string' || !value || value.length > 200 || value.includes('\\')) throw new Error('원본 상대 경로가 잘못됐습니다.');
  const parts = value.split('/');
  if (parts.length > 8 || parts.some(p => !p || p === '.' || p === '..' || p.toLowerCase() === '.git' || /[<>:"|?*\x00-\x1f]/u.test(p) || /[. ]$/u.test(p) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(p))) throw new Error('허용하지 않는 원본 경로입니다.');
  return value;
}

export function validateSourceManifest(manifest, referenceId) {
  if (manifest.schema !== 'mody.reviewed-source-bundle.v1' || manifest.id !== referenceId || !idPattern.test(manifest.name) || !/^[a-f0-9]{40}$/u.test(manifest.commit) || !/^[A-Za-z0-9._-]+$/u.test(manifest.owner) || !/^[A-Za-z0-9._-]+$/u.test(manifest.repo)) throw new Error('검토된 원본 묶음 형식이 아닙니다.');
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 512) throw new Error('원본 파일 수 한도를 넘었습니다.');
  const seen = new Set(); let bytes = 0;
  for (const f of manifest.files) {
    sourcePath(f.path); sourcePath(f.source);
    if (seen.has(f.path.toLowerCase()) || !hex.test(f.sha256) || !Number.isSafeInteger(f.bytes) || f.bytes < 0 || f.bytes > 1024 * 1024) throw new Error('원본 파일 명세가 잘못됐습니다.');
    seen.add(f.path.toLowerCase()); bytes += f.bytes;
  }
  if (bytes > 8 * 1024 * 1024 || manifest.entrypoint !== 'SKILL.md' || !seen.has('skill.md') || !manifest.files.some(f => /(?:^|\/)LICENSE(?:\.txt|\.md)?$/u.test(f.path))) throw new Error('원본 용량·진입 지침·저작권 고지를 확인하지 못했습니다.');
  return manifest;
}

async function limitedBytes(response, expected) {
  if (!response.ok) throw new Error('원본 다운로드 실패 (' + response.status + ')');
  const chunks = []; let bytes = 0;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    try { while (true) { const {done,value}=await reader.read(); if(done)break; bytes+=value.byteLength; if(bytes>expected)throw new Error('원본 크기가 명세와 다릅니다.'); chunks.push(Buffer.from(value)); } }
    finally { await reader.cancel().catch(()=>{}); }
  } else { const b=Buffer.from(await response.arrayBuffer()); bytes=b.length; chunks.push(b); }
  if (bytes !== expected) throw new Error('원본 크기가 명세와 다릅니다.');
  return Buffer.concat(chunks);
}

export function createReviewedSourceBundles({ manifestsRoot, stateRoot, deployRoot, skillRoots = [], io = fs, fetch: fetchImpl = globalThis.fetch, confirm = async () => false }) {
  let busy = false;
  async function manifestFor(reference) {
    const spec=reference.installation;
    if (!idPattern.test(reference.id) || spec?.type !== 'reviewed_source_bundle' || !hex.test(spec.manifestSha256)) throw new Error('검토된 원본 설치 명세가 아닙니다.');
    const buffer=await io.readFile(path.join(manifestsRoot,reference.id+'.json'));
    if(buffer.length>256*1024 || digest(buffer.toString('utf8').replaceAll('\r\n','\n'))!==spec.manifestSha256)throw new Error('앱 원본 명세의 무결성 확인에 실패했습니다.');
    return validateSourceManifest(JSON.parse(buffer.toString('utf8')),reference.id);
  }
  async function verifyDirectory(folder, manifest) {
    const info=await io.lstat(folder); if(!info.isDirectory()||info.isSymbolicLink())throw new Error('원본 폴더가 일반 디렉터리가 아닙니다.');
    const expected=new Map(manifest.files.map(f=>[f.path,f]));let count=0;
    const visit=async(dir,prefix='')=>{
      for(const e of await io.readdir(dir,{withFileTypes:true})){
        const rel=prefix+e.name;sourcePath(rel);
        if(e.isSymbolicLink())throw new Error('원본 설치본에 링크가 있습니다.');
        if(e.isDirectory()) { if(!manifest.files.some(f=>f.path.startsWith(rel+'/')))throw new Error('원본 설치본에 추가 폴더가 있습니다.'); await visit(path.join(dir,e.name),rel+'/'); }
        else {
          const f=expected.get(rel);if(!e.isFile()||!f)throw new Error('원본 설치본에 추가 파일이 있습니다.');
          const stat=await io.stat(path.join(dir,e.name));if(stat.size!==f.bytes)throw new Error('원본 설치본 크기가 바뀌었습니다.');
          const data=await io.readFile(path.join(dir,e.name));if(digest(data)!==f.sha256)throw new Error('원본 설치본 내용이 바뀌었습니다.');count++;
        }
      }
    };
    await visit(folder);if(count!==manifest.files.length)throw new Error('필수 원본 파일이 빠졌습니다.');
    const meta=parseSkillMeta(await io.readFile(path.join(folder,'SKILL.md'),'utf8'));
    if(meta?.name!==manifest.name)throw new Error('원본 스킬 이름이 명세와 다릅니다.');
    return meta;
  }
  async function exists(target) { try { await io.lstat(target);return true; } catch(e){if(e.code==='ENOENT')return false;throw e;} }
  function ready(manifest, folder, meta, reused) {
    return result('reference_ready','검토된 원본 전체 묶음을 준비했습니다. 의존 프로그램 설치나 원본 스크립트·모델 실행은 하지 않았습니다.',{
      referenceId:manifest.id,commit:manifest.commit,entrypoint:manifest.name,installedNow:reused?[]:[manifest.name],reused:reused?[manifest.name]:[],runtimeRequirements:manifest.runtimeRequirements,
      instructions:[{name:manifest.name,file:path.join(folder,'SKILL.md'),body:meta.body,sha256:manifest.files.find(f=>f.path==='SKILL.md').sha256}],fileCount:manifest.files.length,
    });
  }
  return {
    async verify(reference, folder) {
      const manifest=await manifestFor(reference);
      const meta=await verifyDirectory(folder,manifest);
      return {manifest,meta};
    },
    async prepare(reference) {
      if(busy)return result('busy','다른 원본 묶음을 준비 중입니다. 완료 후 다시 요청하세요.');
      busy=true;let stage,stageRoot,lockFile,lock;
      try {
        const manifest=await manifestFor(reference);
        await io.mkdir(stateRoot,{recursive:true});
        lockFile=path.join(stateRoot,manifest.name+'.lock');
        try { lock=await io.open(lockFile,'wx');await lock.writeFile(JSON.stringify({pid:process.pid,createdAt:new Date().toISOString(),reference:manifest.id})); }
        catch(error){if(error.code==='EEXIST')return result('busy','다른 설치가 이 스킬을 준비 중이거나 이전 설치가 중단됐습니다. 잠금 상태 확인이 필요하며 자동 해제하지 않았습니다.');throw error;}
        const roots=[...new Set([deployRoot,...skillRoots.map(r=>r.directory)])];let existing;
        for(const root of roots){const folder=path.join(root,manifest.name);if(await exists(folder)){const meta=await verifyDirectory(folder,manifest);existing??={folder,meta};}}
        if(existing)return ready(manifest,existing.folder,existing.meta,true);
        if(!(await confirm({kind:'import',name:reference.label,detail:[reference.url,'고정 커밋: '+manifest.commit,'라이선스: '+manifest.license,'전체 '+manifest.files.length+'개 파일 · '+manifest.files.reduce((n,f)=>n+f.bytes,0)+'바이트','저장 위치: '+path.join(deployRoot,manifest.name),'원본 코드·이미지를 포함한 검토된 묶음을 보존합니다. 설치 스크립트·프로그램·모델은 실행하지 않습니다.',manifest.runtimeRequirements].join('\n')})))return result('declined','원본 묶음 준비를 취소했습니다. 다운로드·설치하지 않았습니다.');
        await io.mkdir(deployRoot,{recursive:true});const physicalRoot=await io.realpath(deployRoot);
        stageRoot=physicalRoot;stage=path.join(physicalRoot,'.mody-source-'+manifest.name+'-'+randomUUID());await io.mkdir(stage);
        for(let offset=0;offset<manifest.files.length;offset+=4){
          const batch=await Promise.allSettled(manifest.files.slice(offset,offset+4).map(async f=>{
            const url='https://raw.githubusercontent.com/'+manifest.owner+'/'+manifest.repo+'/'+manifest.commit+'/'+f.source.split('/').map(encodeURIComponent).join('/');
            const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
            if(response.url&&response.url!==url)throw new Error('원본 주소가 다른 곳으로 이동했습니다.');
            const data=await limitedBytes(response,f.bytes);if(digest(data)!==f.sha256)throw new Error('원본 파일 해시 불일치: '+f.path);
            const target=path.join(stage,f.path);await io.mkdir(path.dirname(target),{recursive:true});await io.writeFile(target,data,{flag:'wx'});
          }));const failure=batch.find(r=>r.status==='rejected');if(failure)throw failure.reason;
        }
        const meta=await verifyDirectory(stage,manifest);
        const destination=path.join(physicalRoot,manifest.name);
        if(await exists(destination))throw new Error('준비 중 설치 위치가 생겼습니다. 기존 폴더를 덮어쓰지 않았습니다.');
        await io.rename(stage,destination);stage=null;
        await verifyDirectory(destination,manifest);
        return ready(manifest,destination,meta,false);
      } catch(error) { return result('review_required',String(error.message)+' 기존 설치본은 덮어쓰지 않았습니다. 실행하지 않았습니다.'); }
      finally {
        // stage is always a fresh, exclusively created child of the resolved deployment root.
        if(stage && path.dirname(stage) === stageRoot && path.basename(stage).startsWith(".mody-source-"))await io.rm(stage,{recursive:true,force:true}).catch(()=>{});
        if(lock){await lock.close().catch(()=>{});await io.unlink(lockFile).catch(()=>{});}
        busy=false;
      }
    },
  };
}
