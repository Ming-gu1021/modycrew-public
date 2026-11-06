import {reviewedRunnerPath} from './reviewed-runner-path.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash,randomUUID} from 'node:crypto';import {spawn} from 'node:child_process';
import {createReviewedNpmBundle} from './reviewed-npm-bundle.mjs';
const main=path.dirname(fileURLToPath(import.meta.url)),hash=b=>createHash('sha256').update(b).digest('hex');
export const qmdManifestHash='565b34b64a865aa1f9fdff378683b47dda2e628dd42e4dd899abb82d1b87a005';
export const qmdNode={file:'C:\\Program Files\\nodejs\\node.exe',bytes:91406496,sha256:'e3be0545990c90995d7bf3a7af5d64af1f2e0fc1bbd9b79c27f7abc1e9676e50'};
function execute({executable,runner,bundle,cwd,env,payload}){
 return new Promise((resolve,reject)=>{
  const args=['--permission','--allow-addons','--allow-fs-read='+bundle,'--allow-fs-read='+cwd,'--allow-fs-read='+runner,'--allow-fs-write='+cwd,runner,bundle];
  const child=spawn(executable,args,{cwd,env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',bytes=0,error;
  const timer=setTimeout(()=>{error=Error('QMD 검색 시간 초과');child.kill();},30000);
  const collect=(d,out)=>{bytes+=d.length;if(bytes>262144){error=Error('QMD 응답 크기 초과');child.kill();}else if(out)output+=d.toString('utf8');};child.stdout.on('data',d=>collect(d,true));child.stderr.on('data',d=>collect(d,false));child.stdin.on('error',()=>{});
  child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);if(error||code!==0)reject(error??Error('QMD 키워드 검색 실패. 원본·네이티브 호환성을 확인해야 합니다.'));else resolve(output);});child.stdin.end(JSON.stringify(payload));
 });
}
export function createReviewedQmdSource({root,io=fs,fetch:fetchImpl=globalThis.fetch,confirm=async()=>false,platform=process.platform,arch=process.arch,runtime=qmdNode,manifestPath=path.join(main,'reviewed-source-manifests','qmd-keyword.json'),expectedManifestHash=qmdManifestHash,runner=reviewedRunnerPath(path.join(main,'qmd-snapshot-runner.mjs')),run=execute,environment=process.env}){
 let bundle,busy=false;
 async function verifiedNode(){if(platform!=='win32'||arch!=='x64')throw Error('검토된 Windows x64 Node 24.13.1만 지원합니다.');const s=await io.lstat(runtime.file);if(!s.isFile()||s.isSymbolicLink()||s.size!==runtime.bytes||hash(await io.readFile(runtime.file))!==runtime.sha256)throw Error('기존 Node 핵심 파일이 검토 버전과 다릅니다.');return runtime.file;}
 async function installer(){if(!bundle){const b=await io.readFile(manifestPath);if(b.length>2*1024*1024||hash(b)!==expectedManifestHash)throw Error('QMD 명세 무결성 오류');const m=JSON.parse(b);if(m.id!=='qmd-keyword')throw Error('QMD 명세 종류 오류');bundle=createReviewedNpmBundle({root,manifest:m,io,fetch:fetchImpl,confirm});}return bundle;}
 async function prepare(){try{await verifiedNode();return await(await installer()).prepare();}catch(e){return {status:'needs_setup',userMessage:e.message};}}
 return {prepare,async search(input){
  if(busy)return {status:'busy',userMessage:'QMD 검색 중입니다.'};busy=true;let work,result;
  try{
   const {query,documents}=input??{};
   if(typeof query!=='string'||!query.trim()||query.length>300||!Array.isArray(documents)||documents.length<1||documents.length>20)return {status:'invalid',userMessage:'300자 이하 검색어와 1~20개 문서 문자열이 필요합니다.'};
   const ids=new Set(),docs=[];let total=0;
   for(const d of documents){if(!d||typeof d.id!=='string'||! /^[a-zA-Z0-9_-]{1,40}$/u.test(d.id)||ids.has(d.id)||typeof d.text!=='string'||!d.text.trim()||Buffer.byteLength(d.text)>65536)return {status:'invalid',userMessage:'중복 없는 문서 ID와 문서당 64KiB 이하 문자열이 필요합니다. 파일 경로는 받지 않습니다.'};ids.add(d.id);total+=Buffer.byteLength(d.text);docs.push({id:d.id,text:d.text});}
   if(total>1048576)return {status:'invalid',userMessage:'문서 합계는 1MiB 이하여야 합니다.'};
   const ready=await prepare();if(ready.status!=='tool_available')return ready;
   if(!await confirm({kind:'run_qmd_snapshot',name:'QMD 임시 문서 검색',detail:[
    '제공 문서 문자열만 임시 Markdown 파일·SQLite 인덱스로 만들고 원본 QMD searchLex(BM25)로 검색한 뒤 제거합니다.',
    '검색어: '+query,...docs.map(d=>d.id+' · '+Buffer.byteLength(d.text)+'바이트 · SHA-256 '+hash(d.text)+'\n미리보기: '+d.text.slice(0,300)),
    '기존 폴더·인덱스·설정을 읽지 않습니다. 임베딩·재정렬·모델 다운로드·외부 서비스 호출 없음.',
    '파일 접근 권한과 JavaScript 네트워크/프로세스 차단을 사용합니다. SQLite 네이티브 애드온을 허용하므로 OS 전체 격리 보장은 아닙니다.',
   ].join('\n')}))return {status:'declined',userMessage:'QMD 문서 처리를 취소했습니다.'};
   const executable=await verifiedNode(),directory=await(await installer()).resolve();if(!directory)throw Error('QMD 설치본 없음');
   const physical=await io.realpath(root);work=path.join(physical,'.search-'+randomUUID());await io.mkdir(work);
   const env=Object.fromEntries(['SystemRoot','WINDIR'].filter(k=>environment[k]).map(k=>[k,environment[k]]));Object.assign(env,{PATH:'',HOME:work,USERPROFILE:work,APPDATA:work,LOCALAPPDATA:work,TEMP:work,TMP:work,XDG_CONFIG_HOME:work,XDG_CACHE_HOME:work,NODE_LLAMA_CPP_SKIP_DOWNLOAD:'true'});
   const parsed=JSON.parse(await run({executable,runner,bundle:directory,cwd:work,env,payload:{query,documents:docs}}));
   if(parsed.keywordOnly!==true||!Array.isArray(parsed.matches)||parsed.matches.length>10||parsed.matches.some(x=>!Number.isInteger(x.index)||x.index<0||x.index>=docs.length||!Number.isFinite(x.score)))throw Error('QMD 결과 형식 오류');
   result={status:'documents_searched',matches:parsed.matches.map(x=>({id:docs[x.index].id,score:x.score})),keywordOnly:true,snapshotOnly:true,userMessage:'제공한 문서 문자열의 임시 복사본에서 QMD 키워드 검색을 했습니다. 기존 사용자 폴더 검색이나 의미 기반 검색 결과가 아닙니다.'};
  }catch(e){result={status:'unavailable',userMessage:e.message};}
  finally{if(work)try{await io.rm(work,{recursive:true,force:true});}catch{result={status:'cleanup_required',cleanupPath:work,userMessage:'임시 문서·인덱스를 제거하지 못했습니다. 성공으로 보고하지 않습니다.'};}busy=false;}
  return result;
 }};
}
