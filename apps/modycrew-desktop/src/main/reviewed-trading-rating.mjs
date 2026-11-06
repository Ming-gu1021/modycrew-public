import {reviewedRunnerPath} from './reviewed-runner-path.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {verifyReviewedPython} from './reviewed-python-runtime.mjs';
import {downloadReviewedFile} from './reviewed-tool-installer.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
const commit='9fa1196fffbcfd9de5146d2dd2869df84ab99838';
export const tradingRatingManifest={commit,source:'https://github.com/TauricResearch/TradingAgents',license:'Apache-2.0',files:[
 {name:'rating.py',originalPath:'tradingagents/agents/rating.py',bytes:5619,sha256:'90ab5951c3438ba8d9f7536a80c6b5824a6b56ae5cda83f31ada1be311866a52',url:`https://raw.githubusercontent.com/TauricResearch/TradingAgents/${commit}/tradingagents/agents/rating.py`},
 {name:'LICENSE',originalPath:'LICENSE',bytes:11357,sha256:'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4',url:`https://raw.githubusercontent.com/TauricResearch/TradingAgents/${commit}/LICENSE`},
]};
function execute({executable,runner,directory,cwd,env,text}){
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,['-I','-S','-B',runner,directory],{cwd,env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',bytes=0,error;
  const timer=setTimeout(()=>{error=new Error('판정 문구 분석 시간 초과');child.kill();},10000);
  const collect=(data,stdout)=>{bytes+=data.length;if(bytes>32768){error=new Error('판정 응답 크기 초과');child.kill();}else if(stdout)output+=data.toString('utf8');};
  child.stdout.on('data',d=>collect(d,true));child.stderr.on('data',d=>collect(d,false));child.stdin.on('error',()=>{});
  child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);if(error||code!==0)reject(error??new Error('원본 판정 파서 실행 실패'));else resolve(output);});child.stdin.end(JSON.stringify({text}));
 });
}
export function createReviewedTradingRating({root,io=fs,fetch:fetchImpl=globalThis.fetch,confirm=async()=>false,manifest=tradingRatingManifest,runtimeOptions={},run=execute,environment=process.env,runner=reviewedRunnerPath(path.join(path.dirname(fileURLToPath(import.meta.url)),'trading-rating-runner.py'))}){
 if(!/^[a-f0-9]{40}$/u.test(manifest.commit)||manifest.files.length!==2||new Set(manifest.files.map(f=>f.name)).size!==2||manifest.files.some(f=>!['rating.py','LICENSE'].includes(f.name)||!Number.isSafeInteger(f.bytes)||f.bytes<1||f.bytes>65536||!/^[a-f0-9]{64}$/u.test(f.sha256)||!f.url.startsWith('https://raw.githubusercontent.com/TauricResearch/TradingAgents/'+manifest.commit+'/')))throw new Error('판정 파서 명세 오류');
 const destination=path.join(root,manifest.commit),manifestHash=digest(Buffer.from(JSON.stringify(manifest)));let busy=false;
 const runtime=()=>verifyReviewedPython({io,...runtimeOptions});
 const exists=async p=>{try{await io.lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
 const dir=async p=>{const s=await io.lstat(p);if(!s.isDirectory()||s.isSymbolicLink())throw new Error('판정 파서 폴더 형식 오류');};
 async function verify(folder){
  await dir(root);await dir(folder);const entries=await io.readdir(folder);if(entries.length!==3||entries.some(n=>!['rating.py','LICENSE','receipt.json'].includes(n)))throw new Error('판정 파서 설치 구성 오류');
  for(const f of manifest.files){const p=path.join(folder,f.name),s=await io.lstat(p);if(!s.isFile()||s.isSymbolicLink()||s.size!==f.bytes||digest(await io.readFile(p))!==f.sha256)throw new Error('판정 파서 파일 변조');}
  const receiptPath=path.join(folder,'receipt.json'),s=await io.lstat(receiptPath);if(!s.isFile()||s.isSymbolicLink()||s.size>4096)throw new Error('판정 파서 출처 기록 오류');const receipt=JSON.parse(await io.readFile(receiptPath,'utf8'));if(receipt.manifestHash!==manifestHash||typeof receipt.approvedAt!=='string')throw new Error('판정 파서 출처 불일치');
 }
 async function prepare(){
  let stage,physicalRoot,lock,lockPath;
  try{
   await runtime();if(await exists(destination)){await verify(destination);return {status:'tool_available',reused:true,userMessage:'TradingAgents 원본 판정 파서를 재사용합니다. tradingagents.rating.read만 지원하며 전체 투자 분석·백테스트는 미연결입니다.'};}
   if(!await confirm({kind:'install_tool',name:'TradingAgents 원본 판정 파서',detail:[
    '원본 rating.py와 LICENSE만 앱 전용 폴더에 준비합니다. 전체 TradingAgents 프레임워크를 설치하는 작업이 아닙니다.',
    '출처: '+manifest.source,'커밋: '+manifest.commit,'용량: '+manifest.files.reduce((n,f)=>n+f.bytes,0)+'바이트 / 2개 원본 파일','위치: '+destination,'라이선스: Apache-2.0',
    ...manifest.files.map(f=>f.originalPath+' · SHA-256 '+f.sha256),'기존 검토된 Python 3.14.0을 사용합니다. pip·패키지 설치 스크립트·모델·시세 공급자 연결 없음.',
    '다운로드·저장에만 동의합니다. 제공 보고서의 판정 문구 분석 실행은 별도 승인합니다. 원본 내용은 변경하지 않습니다.',
   ].join('\n')}))return {status:'declined',userMessage:'원본 판정 파서 준비를 취소했습니다.'};
   await io.mkdir(root,{recursive:true});await dir(root);physicalRoot=await io.realpath(root);lockPath=path.join(physicalRoot,'.install.lock');try{lock=await io.open(lockPath,'wx');}catch(e){if(e.code==='EEXIST')return {status:'busy',userMessage:'판정 파서 준비 잠금이 있습니다. 자동 해제하지 않았습니다.'};throw e;}
   if(await exists(destination)){await verify(destination);return {status:'tool_available',reused:true,userMessage:'동일 판정 파서를 재사용합니다.'};}
   stage=path.join(physicalRoot,'.stage-'+randomUUID());await io.mkdir(stage);for(const f of manifest.files)await io.writeFile(path.join(stage,f.name),await downloadReviewedFile(fetchImpl,f),{flag:'wx'});
   await io.writeFile(path.join(stage,'receipt.json'),JSON.stringify({manifestHash,source:manifest.source,commit:manifest.commit,approvedAt:new Date().toISOString()}),{flag:'wx'});await verify(stage);if(await exists(destination))throw new Error('설치 위치가 변경됐습니다.');await io.rename(stage,destination);stage=null;await verify(destination);
   return {status:'tool_available',installedNow:true,userMessage:'원본 판정 파서만 준비했습니다. 아직 실행하지 않았습니다. tradingagents.rating.read의 별도 승인을 받으세요. 전체 투자 분석·백테스트는 미연결입니다.'};
  }catch(e){return {status:'review_required',userMessage:e.message+' 기존 설치본을 덮어쓰거나 자동 실행하지 않았습니다.'};}
  finally{if(stage&&path.dirname(stage)===physicalRoot&&path.basename(stage).startsWith('.stage-'))await io.rm(stage,{recursive:true,force:true}).catch(()=>{});if(lock){await lock.close().catch(()=>{});await io.unlink(lockPath).catch(()=>{});}}
 }
 return {
  async prepare(){if(busy)return {status:'busy',userMessage:'판정 파서 준비 중입니다.'};busy=true;try{return await prepare();}finally{busy=false;}},
  async read(text){
   if(busy)return {status:'busy',userMessage:'판정 문구 분석 중입니다.'};busy=true;let work;
   try{
    if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>65536)return {status:'invalid',userMessage:'64KiB 이하의 보고서 문자열이 필요합니다. URL·파일 경로·실행 명령은 받지 않습니다.'};
    const ready=await prepare();if(ready.status!=='tool_available')return ready;
    if(!await confirm({kind:'run_report_rating',name:'원본 판정 문구 읽기',detail:[
     '제공 보고서에서 TradingAgents 원본 규칙으로 영문 Rating 표기만 읽습니다. 새 투자 의견·시세 분석·매매 신호를 생성하거나 검증하지 않습니다.',
     '입력 '+Buffer.byteLength(text)+'바이트 / SHA-256 '+digest(Buffer.from(text)),'미리보기: '+text.slice(0,500),
     '기존 Python 3.14.0에서 로컬 실행합니다. 모델·시세·계정 연결·거래·사용자 파일 열기 없음. 판정이 없으면 REVIEW로 반환합니다.',
    ].join('\n')}))return {status:'declined',userMessage:'판정 문구 읽기를 취소했습니다.'};
    const executable=await runtime();await verify(destination);work=path.join(root,'.read-'+randomUUID());await io.mkdir(work);
    const env=Object.fromEntries(['SystemRoot','WINDIR'].filter(k=>environment[k]).map(k=>[k,environment[k]]));Object.assign(env,{PATH:'',HOME:work,USERPROFILE:work,APPDATA:work,LOCALAPPDATA:work,TEMP:work,TMP:work});
    const parsed=JSON.parse(await run({executable,runner,directory:destination,cwd:work,env,text}));if(!['Buy','Overweight','Hold','Underweight','Sell','REVIEW'].includes(parsed.rating))throw new Error('원본 판정 결과 형식 오류');
    return {status:'rating_read',rating:parsed.rating,needsReview:parsed.rating==='REVIEW',sourceCommit:manifest.commit,userMessage:'제공 문서의 판정 표기를 읽었습니다. 새 투자 의견이 아니며 보고서 정확성·투자 적합성·수익성을 검증한 결과가 아닙니다.'};
   }catch(e){return {status:'unavailable',userMessage:e.message};}
   finally{if(work&&path.dirname(work)===root&&path.basename(work).startsWith('.read-'))await io.rm(work,{recursive:true,force:true}).catch(()=>{});busy=false;}
  },
 };
}
