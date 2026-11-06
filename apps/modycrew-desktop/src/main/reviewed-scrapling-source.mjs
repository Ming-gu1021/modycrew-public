import {reviewedRunnerPath} from './reviewed-runner-path.mjs';
import {verifyReviewedPython,reviewedPythonFiles as runtimeFiles} from './reviewed-python-runtime.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createReviewedWheelBundle} from './reviewed-wheel-bundle.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const main=path.dirname(fileURLToPath(import.meta.url));
export const scraplingManifestHash='44f643b46a7d36a5fcbd29d69d7bff79f5f77b4b5af73bbc39a5d3334d3acd0c';

function execute({executable,runner,packages,cwd,env,payload}){
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,['-I','-S','-B',runner,packages],{cwd,env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',size=0,error;
  const timer=setTimeout(()=>{error=new Error('HTML 분석 시간이 초과됐습니다.');child.kill();},20000);
  const collect=(data,stdout)=>{size+=data.length;if(size>256*1024){error=new Error('HTML 분석 결과 크기 초과');child.kill();}else if(stdout)output+=data.toString('utf8');};
  child.stdout.on('data',d=>collect(d,true));child.stderr.on('data',d=>collect(d,false));child.stdin.on('error',()=>{});
  child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);if(error||code!==0)reject(error??new Error('정적 HTML 분석에 실패했습니다. 패키지 호환성·선택자를 확인하세요.'));else resolve(output);});
  child.stdin.end(JSON.stringify(payload));
 });
}
export function createReviewedScraplingSource({root,io=fs,fetch:fetchImpl=globalThis.fetch,confirm=async()=>false,platform=process.platform,arch=process.arch,manifestPath=path.join(main,'reviewed-source-manifests','scrapling-static.json'),expectedManifestHash=scraplingManifestHash,runtimeRoot='C:\\Python314',runtime=runtimeFiles,runner=reviewedRunnerPath(path.join(main,'scrapling-static-runner.py')),run=execute,environment=process.env}){
 let bundle,busy=false;
 const verifiedRuntime=()=>verifyReviewedPython({io,platform,arch,runtimeRoot,runtime});
 async function installer(){
  if(!bundle){const bytes=await io.readFile(manifestPath);if(bytes.length>256*1024||hash(bytes.toString('utf8').replaceAll('\r\n','\n'))!==expectedManifestHash)throw new Error('Scrapling 앱 명세 무결성 오류');const manifest=JSON.parse(bytes.toString('utf8'));if(manifest.id!=='scrapling-static')throw new Error('Scrapling 명세 종류 오류');bundle=createReviewedWheelBundle({root,manifest,io,fetch:fetchImpl,confirm});}
  return bundle;
 }
 async function prepare(){try{await verifiedRuntime();return await (await installer()).prepare();}catch(e){return {status:'needs_setup',userMessage:e.message+' 검토된 Python 런타임이 필요합니다.'};}}
 return {
  prepare,
  async extract(input){
   if(busy)return {status:'busy',userMessage:'HTML을 분석 중입니다.'};busy=true;let work;
   try{
    const html=input?.html,selector=input?.selector;
    if(typeof html!=='string'||!html.trim()||Buffer.byteLength(html)>1048576||typeof selector!=='string'||!selector.trim()||selector.length>512||/[\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(selector))return {status:'invalid',userMessage:'1MiB 이하 HTML 문자열과 512자 이하 CSS 선택자가 필요합니다. URL·파일 경로·Python 명령은 입력으로 받지 않습니다.'};
    const ready=await prepare();if(ready.status!=='tool_available')return ready;
    if(!await confirm({kind:'run_static_html',name:'Scrapling 정적 HTML 분석',detail:[
     '기존 검증된 Python 3.14.0과 검토된 Scrapling 패키지로 제공한 HTML 문자열을 로컬 분석합니다.',
     'HTML '+Buffer.byteLength(html)+'바이트 / SHA-256 '+hash(Buffer.from(html)),'CSS 선택자: '+selector,
     'HTML 미리보기: '+html.slice(0,500),'웹사이트 요청·브라우저·쿠키·로그인·모델 호출·사용자 파일 열기는 제공하지 않습니다.',
     '스크립트·추적 요소를 실행하지 않고 최대 100개 결과를 반환합니다. 원본 HTML을 영구 저장하지 않습니다.',
    ].join('\n')}))return {status:'declined',userMessage:'정적 HTML 분석을 취소했습니다.'};
    const executable=await verifiedRuntime(),packages=await (await installer()).resolve();if(!packages)throw new Error('패키지 설치본이 없습니다.');
    work=path.join(root,'.parse-'+randomUUID());await io.mkdir(work);
    const env=Object.fromEntries(['SystemRoot','WINDIR'].filter(k=>environment[k]).map(k=>[k,environment[k]]));Object.assign(env,{PATH:'',HOME:work,USERPROFILE:work,APPDATA:work,LOCALAPPDATA:work,TEMP:work,TMP:work});
    const parsed=JSON.parse(await run({executable,runner,packages,cwd:work,env,payload:{html,selector}}));
    if(parsed.staticOnly!==true||!Array.isArray(parsed.matches)||parsed.matches.length>100||parsed.matches.some(x=>typeof x!=='string'||x.length>2000))throw new Error('정적 분석 응답 형식 오류');
    return {status:'html_extracted',userMessage:'제공한 HTML 문자열에서 CSS 선택자로 추출했습니다. 실제 웹사이트를 방문한 결과가 아닙니다.',matches:parsed.matches,truncated:parsed.truncated===true,staticOnly:true,toolVersion:'Scrapling 0.5'};
   }catch(e){return {status:'unavailable',userMessage:e.message};}
   finally{if(work&&path.dirname(work)===root&&path.basename(work).startsWith('.parse-'))await io.rm(work,{recursive:true,force:true}).catch(()=>{});busy=false;}
  },
 };
}
