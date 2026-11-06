import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const hash=b=>createHash('sha256').update(b).digest('hex');
const safe=s=>typeof s==='string'&&s.length>0&&s.length<230&&!/[\\:\x00-\x1f]/u.test(s)&&s.split('/').every(x=>x&&!['.','..'].includes(x)&&!/[. ]$/u.test(x)&&! /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(x));
export function extractReviewedNpmTar(archive,pkg){
 if(archive.length!==pkg.bytes||hash(archive)!==pkg.sha256||'sha512-'+createHash('sha512').update(archive).digest('base64')!==pkg.integrity)throw Error('npm 원본 무결성 오류');
 const total=pkg.files.reduce((n,f)=>n+f.bytes,0);const tar=gunzipSync(archive,{maxOutputLength:Math.min(512*1024*1024,total+pkg.files.length*4096+1048576)});
 const wanted=new Map(pkg.files.map(f=>[f.path,f])),found=new Map();let at=0,paxPath=null;
 const str=b=>b.toString('utf8').replace(/\0.*$/su,'');
 const oct=b=>{const s=str(b).trim();if(!/^[0-7]*$/u.test(s))throw Error('TAR 수치 오류');return s?parseInt(s,8):0;};
 while(at+512<=tar.length){
  const h=tar.subarray(at,at+512);if(h.every(x=>x===0))break;
  const stored=oct(h.subarray(148,156));let sum=0;for(let i=0;i<512;i++)sum+=i>=148&&i<156?32:h[i];if(sum!==stored)throw Error('TAR 헤더 오류');
  const size=oct(h.subarray(124,136)),type=String.fromCharCode(h[156]||48);if(!Number.isSafeInteger(size)||size<0||at+512+size>tar.length)throw Error('TAR 범위 오류');
  const bytes=tar.subarray(at+512,at+512+size);let name=str(h.subarray(0,100)),prefix=str(h.subarray(345,500));if(prefix)name=prefix+'/'+name;at+=512+Math.ceil(size/512)*512;
  if(type==='x'){
   if(size>65536||paxPath!==null)throw Error('TAR 확장 헤더 오류');let p=0;
   while(p<bytes.length){const space=bytes.indexOf(32,p),length=Number(bytes.subarray(p,space).toString());if(space<0||!Number.isSafeInteger(length)||length<3||p+length>bytes.length)throw Error('PAX 길이 오류');const record=bytes.subarray(space+1,p+length-1).toString('utf8'),eq=record.indexOf('=');const key=record.slice(0,eq);if(key==='path')paxPath=record.slice(eq+1);else if(!['mtime','atime','ctime','uid','gid','uname','gname'].includes(key))throw Error('PAX 속성 미지원');p+=length;}continue;
  }
  if(paxPath!==null){name=paxPath;paxPath=null;}
  if(type==='5'){if(name==='package/'||name==='package')continue;const n=name.replace(/\/$/u,'');if(!n.startsWith('package/')||!safe(n.slice(8)))throw Error('TAR 디렉터리 오류');continue;}
  if(type!=='0'||!name.startsWith('package/')||!safe(name.slice(8)))throw Error('TAR 링크·경로 미지원');
  const rel=name.slice(8),f=wanted.get(rel);if(!f||found.has(rel)||bytes.length!==f.bytes||hash(bytes)!==f.sha256)throw Error('npm 내부 파일 무결성 오류');found.set(rel,Buffer.from(bytes));
 }
 if(paxPath!==null||found.size!==wanted.size)throw Error('npm 파일 누락');return found;
}
async function download(fetchImpl,pkg){
 const u=new URL(pkg.url);if(u.protocol!=='https:'||u.hostname!=='registry.npmjs.org'||u.username||u.password||u.port)throw Error('npm 다운로드 출처 오류');
 const res=await fetchImpl(pkg.url,{redirect:'error',signal:AbortSignal.timeout(120000)});if(!res.ok||!res.body?.getReader)throw Error('npm 다운로드 실패');
 const reader=res.body.getReader(),chunks=[];let bytes=0;try{while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.length;if(bytes>pkg.bytes)throw Error('npm 다운로드 크기 초과');chunks.push(Buffer.from(r.value));}}finally{await reader.cancel().catch(()=>{});}return Buffer.concat(chunks);
}
export function createReviewedNpmBundle({root,manifest,io=fs,fetch:fetchImpl=globalThis.fetch,confirm=async()=>false}){
 if(manifest.schema!=='mody.reviewed-npm-bundle.v1'||!/^\d+\.\d+\.\d+$/u.test(manifest.version)||!Array.isArray(manifest.packages)||!manifest.packages.length||manifest.packages.length>300)throw Error('npm 명세 오류');
 const expected=new Map();let total=0;
 for(const p of manifest.packages){if(!safe(p.path)||!p.path.startsWith('node_modules/')||p.bytes<1||p.bytes>160*1024*1024||!p.license||!p.files.length)throw Error('npm 패키지 명세 오류');for(const f of p.files){const name=p.path+'/'+f.path;if(!safe(f.path)||expected.has(name)||!Number.isSafeInteger(f.bytes)||f.bytes<0||!/^[a-f0-9]{64}$/u.test(f.sha256))throw Error('npm 파일 명세 오류');expected.set(name,f);total+=f.bytes;}}
 for(const f of manifest.supplementalFiles??[]){if(!safe(f.path)||expected.has(f.path)||typeof f.content!=='string'||Buffer.byteLength(f.content)!==f.bytes||hash(Buffer.from(f.content))!==f.sha256)throw Error('npm 보완 고지 오류');expected.set(f.path,f);total+=f.bytes;}
 if(total>1024*1024*1024)throw Error('npm 설치 용량 제한');
 const manifestHash=hash(Buffer.from(JSON.stringify(manifest))),destination=path.join(root,manifest.version);let busy=false;
 const exists=async p=>{try{await io.lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
 async function directory(p){const s=await io.lstat(p);if(!s.isDirectory()||s.isSymbolicLink())throw Error('npm 폴더 형식 오류');}
 async function verify(folder){
  await directory(root);await directory(folder);let count=0;
  async function walk(dir,rel=''){for(const e of await io.readdir(dir,{withFileTypes:true})){const name=rel?rel+'/'+e.name:e.name,p=path.join(dir,e.name),s=await io.lstat(p);if(s.isSymbolicLink())throw Error('npm 링크 변조');if(s.isDirectory()){await walk(p,name);continue;}if(name==='receipt.json'){if(s.size>4096)throw Error('npm 기록 크기 오류');continue;}const f=expected.get(name);if(!s.isFile()||!f||s.size!==f.bytes||hash(await io.readFile(p))!==f.sha256)throw Error('npm 설치본 변조');count++;}}
  await walk(folder);if(count!==expected.size)throw Error('npm 설치 파일 누락');const receipt=JSON.parse(await io.readFile(path.join(folder,'receipt.json'),'utf8'));if(receipt.manifestHash!==manifestHash||typeof receipt.approvedAt!=='string')throw Error('npm 설치 출처 오류');return destination;
 }
 return {resolve:async()=>await exists(destination)?verify(destination):null,
 async prepare(){if(busy)return {status:'busy',userMessage:'QMD 준비 중입니다.'};busy=true;let stage,lock,lockPath,physical;
 try{
  if(await exists(destination)){await verify(destination);return {status:'tool_available',reused:true,userMessage:'고정 QMD 설치본을 재사용합니다. 검색 실행은 별도 승인하며 실제 호환성은 실행 결과로 확인해야 합니다.'};}
  if(!await confirm({kind:'install_tool',name:'QMD '+manifest.version+' 키워드 검색',detail:[
   '공식 npm 원본과 고정 의존성을 앱 전용 폴더에 준비합니다. 설치 스크립트·npm 실행·시스템 PATH 변경 없음.',
   '원본: '+manifest.source,'커밋: '+manifest.sourceCommit,'명세 SHA-256: '+manifestHash,
   manifest.packages.length+'개 패키지 / 다운로드 '+manifest.packages.reduce((n,p)=>n+p.bytes,0)+'바이트 / 해제 '+total+'바이트',
   '경로: '+destination,'각 패키지 버전·SHA-512 및 파일 SHA-256 검증. 라이선스·고지 원문 보존. 전체 의존성 명세는 앱에 포함됩니다.',
   '라이선스: '+[...new Set(manifest.packages.map(p=>p.license))].join(', '),
   '원본에 별도 고지 파일이 없는 reflink 계열은 원본 package.json의 MIT 표시와 원본 파일을 보존합니다. 앱이 저작권자 표시를 새로 만들지 않습니다.',
   '키워드 검색만 연결하며 모델 다운로드·임베딩·재정렬은 호출하지 않습니다. 설치 후 문서 처리·원본 실행은 다시 승인합니다.',
  ].join('\n')}))return {status:'declined',userMessage:'QMD 준비를 취소했습니다.'};
  await io.mkdir(root,{recursive:true});await directory(root);physical=await io.realpath(root);lockPath=path.join(physical,'.install.lock');try{lock=await io.open(lockPath,'wx');}catch(e){if(e.code==='EEXIST')return {status:'busy',userMessage:'기존 QMD 설치 잠금을 보존했습니다.'};throw e;}
  if(await exists(destination)){await verify(destination);return {status:'tool_available',reused:true,userMessage:'고정 설치본 재사용'};}
  stage=path.join(physical,'.stage-'+randomUUID());await io.mkdir(stage);
  for(const p of manifest.packages){const files=extractReviewedNpmTar(await download(fetchImpl,p),p);for(const [name,bytes]of files){const target=path.join(stage,p.path,name);await io.mkdir(path.dirname(target),{recursive:true});await io.writeFile(target,bytes,{flag:'wx'});}}
  for(const f of manifest.supplementalFiles??[]){const target=path.join(stage,f.path);await io.mkdir(path.dirname(target),{recursive:true});await io.writeFile(target,f.content,{flag:'wx'});}
  await io.writeFile(path.join(stage,'receipt.json'),JSON.stringify({manifestHash,approvedAt:new Date().toISOString()}),{flag:'wx'});await verify(stage);if(await exists(destination))throw Error('npm 설치 경로 변경');await io.rename(stage,destination);stage=null;await verify(destination);
  return {status:'tool_available',installedNow:true,userMessage:'고정 QMD 원본·의존성만 준비했습니다. 아직 실행하지 않았으며 실제 검색 호환성은 미검증입니다.'};
 }catch(e){return {status:'review_required',userMessage:e.message+' 기존 설치본을 덮어쓰지 않았습니다.'};}
 finally{if(stage&&path.dirname(stage)===physical)await io.rm(stage,{recursive:true,force:true}).catch(()=>{});if(lock){await lock.close().catch(()=>{});await io.unlink(lockPath).catch(()=>{});}busy=false;}
 }};
}
