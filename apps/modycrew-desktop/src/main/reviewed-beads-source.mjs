import {analyzeBeadsSnapshot} from "./beads-task-snapshot.mjs";
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {beadsArchiveManifest,beadsFiles,extractBeadsArchive} from './reviewed-beads-archive.mjs';
import {downloadReviewedFile} from './reviewed-tool-installer.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
function executeVersion(file,cwd,env){
 return new Promise((resolve,reject)=>{
  const child=spawn(file,['version','--json'],{cwd,env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',bytes=0,error;
  const timer=setTimeout(()=>{error=new Error('beads 실행 시간 초과');child.kill();},15000);
  const collect=(chunk,stdout)=>{bytes+=chunk.length;if(bytes>65536){error=new Error('beads 응답 크기 초과');child.kill();}else if(stdout)output+=chunk.toString('utf8');};
  child.stdout.on('data',c=>collect(c,true));child.stderr.on('data',c=>collect(c,false));
  child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);if(error||code!==0)reject(error??new Error('beads 버전 확인 실패'));else resolve(output);});
 });
}
export function createReviewedBeadsSource({root,io=fs,fetch:fetchImpl=globalThis.fetch,confirm=async()=>false,manifest=beadsArchiveManifest,platform=process.platform,arch=process.arch,run=executeVersion,runSnapshot,environment=process.env}){
 if(!root||!/^\d+\.\d+\.\d+$/u.test(manifest.version)||manifest.bytes>64*1024*1024)throw new Error('beads 설치 명세 오류');
 const destination=path.join(root,manifest.version);let busy=false;
 const exists=async p=>{try{await io.lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
 async function directory(p){const s=await io.lstat(p);if(!s.isDirectory()||s.isSymbolicLink())throw new Error('beads 경로가 일반 폴더가 아닙니다.');}
 async function verify(folder){
  await directory(root);await directory(folder);
  const names=await io.readdir(folder),expected=[...beadsFiles,'source.zip','receipt.json'];
  if(names.length!==expected.length||names.some(n=>!expected.includes(n)))throw new Error('beads 설치 파일 구성이 바뀌었습니다.');
  for(const name of names){const s=await io.lstat(path.join(folder,name));if(!s.isFile()||s.isSymbolicLink()||s.size>260*1024*1024)throw new Error('beads 파일 형식 오류');}
  const zip=path.join(folder,'source.zip');if((await io.stat(zip)).size!==manifest.bytes)throw new Error('beads 원본 압축 파일 크기 불일치');
  const files=extractBeadsArchive(await io.readFile(zip),manifest);
  for(const [name,bytes] of files){const p=path.join(folder,name);if((await io.stat(p)).size!==bytes.length||!bytes.equals(await io.readFile(p)))throw new Error('beads 설치 무결성 불일치: '+name);}
  const receiptPath=path.join(folder,'receipt.json');if((await io.stat(receiptPath)).size>8192)throw new Error('설치 기록 크기 오류');
  const receipt=JSON.parse(await io.readFile(receiptPath,'utf8'));if(receipt.sha256!==manifest.sha256||typeof receipt.approvedAt!=='string')throw new Error('beads 출처 기록 오류');
  return path.join(folder,'bd.exe');
 }
 async function prepare(){
  if(platform!=='win32'||arch!=='x64')return {status:'needs_setup',userMessage:'beads 앱 전용 설치는 Windows x64만 지원합니다.'};
  let stage,physicalRoot,lock,lockPath;
  try{
   if(await exists(destination)){await verify(destination);return {status:'tool_available',reused:true,userMessage:'검증된 beads 설치본을 재사용합니다. beads.runtime.check로 버전 진단만 실행할 수 있습니다. beads.tasks.analyze로 제공 업무 목록을 별도 승인 후 임시 분석할 수 있습니다. 기존 업무 저장소는 미연결입니다.'};}
   if(!await confirm({kind:'install_tool',name:'beads '+manifest.version,detail:[
    '원본 beads CLI를 앱 전용 폴더에 설치합니다. 버전 진단과 제공 업무 목록의 임시 분석을 지원합니다. 기존 프로젝트·DB 연결 및 영구 업무 등록·조회는 지원하지 않습니다.',
    '출처: '+manifest.source,'버전: '+manifest.version,'다운로드: '+manifest.bytes+'바이트; 원본 ZIP 보관 및 해제 최대 260MiB, 총 약 325MiB 이하',
    '위치: '+destination,'SHA-256: '+manifest.sha256,'라이선스: MIT; LICENSE·README·CHANGELOG 원문 보존',
    'GitHub/CDN 다운로드만 승인합니다. PATH·레지스트리·Git·기존 데이터베이스 변경 없음. 프로그램 실행은 별도 확인합니다.',
    '실패 시 임시 폴더만 제거합니다. 기존 설치본 덮어쓰기·자동 업데이트·기존 bd 실행은 하지 않습니다.',
   ].join('\n')}))return {status:'declined',userMessage:'beads 설치를 취소했습니다.'};
   await io.mkdir(root,{recursive:true});await directory(root);physicalRoot=await io.realpath(root);lockPath=path.join(physicalRoot,'.install.lock');
   try{lock=await io.open(lockPath,'wx');}catch(e){if(e.code==='EEXIST')return {status:'busy',userMessage:'beads 설치 잠금이 있습니다. 자동 해제하지 않았습니다.'};throw e;}
   if(await exists(destination)){await verify(destination);return {status:'tool_available',reused:true,userMessage:'동일한 beads 설치본을 재사용합니다.'};}
   stage=path.join(physicalRoot,'.stage-'+randomUUID());await io.mkdir(stage);
   const archive=await downloadReviewedFile(fetchImpl,{...manifest,name:'beads.zip'});const files=extractBeadsArchive(archive,manifest);
   await io.writeFile(path.join(stage,'source.zip'),archive,{flag:'wx'});for(const [name,bytes] of files)await io.writeFile(path.join(stage,name),bytes,{flag:'wx'});
   await io.writeFile(path.join(stage,'receipt.json'),JSON.stringify({sha256:manifest.sha256,source:manifest.source,version:manifest.version,license:manifest.license,approvedAt:new Date().toISOString()}),{flag:'wx'});
   await verify(stage);if(await exists(destination))throw new Error('beads 설치 위치가 변경됐습니다.');await io.rename(stage,destination);stage=null;await verify(destination);
   return {status:'tool_available',installedNow:true,userMessage:'beads 원본 설치를 검증했습니다. 아직 실행하지 않았습니다. beads.runtime.check의 별도 승인으로 버전만 확인할 수 있습니다. beads.tasks.analyze로 제공 업무 목록을 별도 승인 후 임시 분석할 수 있습니다. 기존 업무 저장소는 미연결입니다.'};
  }catch(e){return {status:'review_required',userMessage:e.message+' 기존 설치본은 보존하며 자동 실행하지 않았습니다.'};}
  finally{if(stage&&path.dirname(stage)===physicalRoot&&path.basename(stage).startsWith('.stage-'))await io.rm(stage,{recursive:true,force:true}).catch(()=>{});if(lock){await lock.close().catch(()=>{});await io.unlink(lockPath).catch(()=>{});}}
 }
 return {
  async prepare(){if(busy)return {status:'busy',userMessage:'beads 준비 중입니다.'};busy=true;try{return await prepare();}finally{busy=false;}},
  async analyzeTasks(input){
   if(busy)return {status:"busy",userMessage:"beads 준비·분석 중입니다."};busy=true;
   try{return await analyzeBeadsSnapshot({input,root,prepare,resolve:()=>verify(destination),confirm,io,run:runSnapshot,environment});}finally{busy=false;}
  },
  async check(){
   if(busy)return {status:'busy',userMessage:'beads 준비·진단 중입니다.'};busy=true;let work;
   try{
    const ready=await prepare();if(ready.status!=='tool_available')return ready;
    if(!await confirm({kind:'run_tool_check',name:'beads 버전 진단',detail:'고정 beads '+manifest.version+'의 version --json만 앱 전용 임시 폴더에서 실행합니다. 사용자 프로젝트·작업·자격증명은 전달하지 않습니다. Git 초기화·업무 등록·DB 열기·원격 동기화는 호출하지 않습니다. 이 결과는 업무 관리 연결 완료가 아닙니다.'}))return {status:'declined',userMessage:'beads 실행을 취소했습니다.'};
    const executable=await verify(destination);work=path.join(root,'.check-'+randomUUID());await io.mkdir(work);await io.mkdir(path.join(work,'.beads'));
    const env=Object.fromEntries(['SystemRoot','WINDIR'].filter(k=>environment[k]).map(k=>[k,environment[k]]));
    Object.assign(env,{PATH:'',HOME:work,USERPROFILE:work,APPDATA:work,LOCALAPPDATA:work,TEMP:work,TMP:work,XDG_CONFIG_HOME:work,BEADS_DIR:path.join(work,'.beads'),OTEL_SDK_DISABLED:'true'});
    const parsed=JSON.parse(await run(executable,work,env));if(parsed.version!==manifest.version)throw new Error('beads 실행 버전 불일치');
    return {status:'runtime_checked',version:parsed.version,userMessage:'beads 버전 실행을 확인했습니다. 업무 등록·조회·기존 프로젝트 연결은 미지원입니다.'};
   }catch(e){return {status:'unavailable',userMessage:e.message};}
   finally{if(work&&path.dirname(work)===root&&path.basename(work).startsWith('.check-'))await io.rm(work,{recursive:true,force:true}).catch(()=>{});busy=false;}
  },
 };
}
