import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
const hash=text=>createHash('sha256').update(text).digest('hex');
export function normalizeBeadsTasks(input){
 if(!Array.isArray(input)||input.length<1||input.length>100)throw new Error('1~100개 업무 배열이 필요합니다.');
 const ids=new Set();
 const tasks=input.map((x,i)=>{
  if(!x||typeof x.id!=='string'||! /^[a-zA-Z0-9_-]{1,40}$/.test(x.id)||ids.has(x.id)||typeof x.title!=='string'||!x.title.trim()||x.title.length>300)throw new Error('중복 없는 업무 ID와 300자 이하 제목이 필요합니다.');
  ids.add(x.id);const status=x.status??'open',priority=x.priority??2,dependsOn=x.dependsOn??[];
  if(!['open','in_progress','blocked','closed'].includes(status)||!Number.isInteger(priority)||priority<0||priority>4||!Array.isArray(dependsOn)||dependsOn.length>20||dependsOn.some(id=>typeof id!=='string'))throw new Error('업무 상태·우선순위·선행 업무 형식 오류');
  return {id:x.id,title:x.title,status,priority,dependsOn:[...new Set(dependsOn)],internalId:'mody-s'+String(i+1).padStart(3,'0')};
 });
 for(const t of tasks)if(t.dependsOn.some(id=>!ids.has(id)||id===t.id))throw new Error('선행 업무는 목록 안의 다른 ID여야 합니다.');
 // Cyclic input cannot be ready; reject rather than returning a misleading empty result.
 const byId=new Map(tasks.map(t=>[t.id,t])),visiting=new Set(),done=new Set();
 function visit(id){if(visiting.has(id))throw new Error('선행 업무 순환이 있습니다.');if(done.has(id))return;visiting.add(id);for(const d of byId.get(id).dependsOn)visit(d);visiting.delete(id);done.add(id);}
 for(const t of tasks)visit(t.id);
 const jsonl=tasks.map(t=>JSON.stringify({id:t.internalId,title:t.title,status:t.status,priority:t.priority,issue_type:'task',dependencies:t.dependsOn.map(id=>({issue_id:t.internalId,depends_on_id:byId.get(id).internalId,type:'blocks'}))})).join('\n')+'\n';
 if(Buffer.byteLength(jsonl)>65536)throw new Error('업무 목록은 64KiB 이하여야 합니다.');
 return {tasks,jsonl};
}
function execute({executable,args,cwd,env,stdin=''}){
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{cwd,env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',bytes=0,error;
  const timer=setTimeout(()=>{error=new Error('beads 업무 분석 시간 초과');child.kill();},30000);
  const collect=(d,out)=>{bytes+=d.length;if(bytes>262144){error=new Error('beads 업무 응답 크기 초과');child.kill();}else if(out)output+=d.toString('utf8');};
  child.stdout.on('data',d=>collect(d,true));child.stderr.on('data',d=>collect(d,false));child.stdin.on('error',()=>{});
  child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);if(error||code!==0)reject(error??new Error('beads 임시 업무 분석 실패'));else resolve(output);});child.stdin.end(stdin);
 });
}
export async function analyzeBeadsSnapshot({input,root,prepare,resolve,confirm,io=fs,run=execute,environment=process.env}){
 let work;let result;
 try{
  let snapshot;try{snapshot=normalizeBeadsTasks(input);}catch(e){return {status:'invalid',userMessage:e.message};}
  const {tasks,jsonl}=snapshot,ready=await prepare();if(ready.status!=='tool_available')return ready;
  if(!await confirm({kind:'run_beads_snapshot',name:'beads 임시 업무 분석',detail:[
   '고정 beads 1.3.4로 아래 업무 목록을 새 임시 DB에 가져온 뒤 착수 가능 업무를 조회합니다.',
   '실행: init --skip-hooks --skip-agents → import (표준입력) → list --ready --readonly. 각 단계 --sandbox 사용.',
   '기존 프로젝트·DB·계정·서버 주소를 받지 않습니다. 결과 뒤 앱이 만든 임시 DB를 제거하며 업무를 영구 등록하지 않습니다.',
   'Git 및 동기화 명령을 호출하지 않고 빈 환경과 앱 전용 BEADS_DIR을 사용합니다. OS 수준 네트워크 격리 보장은 아닙니다.',
   '입력 '+Buffer.byteLength(jsonl)+'바이트 / SHA-256 '+hash(jsonl),'제공 업무(변환 후):\n'+jsonl,
  ].join('\n')}))return {status:'declined',userMessage:'임시 업무 분석을 취소했습니다.'};
  const stat=await io.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('beads 작업 경로 오류');
  const physicalRoot=await io.realpath(root);work=path.join(physicalRoot,'.tasks-'+randomUUID());await io.mkdir(work);const beads=path.join(work,'.beads');await io.mkdir(beads);
  const env=Object.fromEntries(['SystemRoot','WINDIR'].filter(k=>environment[k]).map(k=>[k,environment[k]]));
  Object.assign(env,{PATH:'',HOME:work,USERPROFILE:work,APPDATA:work,LOCALAPPDATA:work,TEMP:work,TMP:work,XDG_CONFIG_HOME:work,BEADS_DIR:beads,BD_NON_INTERACTIVE:'1',OTEL_SDK_DISABLED:'true',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(work,'no-git-config')});
  async function command(args,stdin=''){return run({executable:await resolve(),args:['--sandbox',...args],cwd:work,env,stdin});}
  await command(['init','--prefix','mody','--skip-hooks','--skip-agents','--non-interactive','--quiet']);
  await command(['import','-','--json'],jsonl);
  const parsed=JSON.parse(await command(['list','--ready','--readonly','--json','--limit','100','--no-pager']));
  if(!Array.isArray(parsed)||parsed.length>100)throw new Error('beads 업무 목록 응답 형식 오류');
  const known=new Map(tasks.map(t=>[t.internalId,t])),seen=new Set();
  const readyTasks=parsed.map(row=>{const t=known.get(row?.id);if(!t||seen.has(row.id))throw new Error('beads 응답의 업무 ID 오류');seen.add(row.id);return {id:t.id,title:t.title,status:t.status,priority:t.priority};});
  result={status:'tasks_analyzed',readyTasks,total:tasks.length,snapshotOnly:true,toolVersion:'1.3.4',userMessage:'제공한 업무 목록의 임시 복사본에서 beads가 착수 가능 업무를 조회했습니다. 기존 프로젝트 상태나 영구 업무 등록 결과가 아닙니다.'};
 }catch(e){result={status:'unavailable',userMessage:e.message};}
 finally{if(work){try{await io.rm(work,{recursive:true,force:true});}catch{result={status:'cleanup_required',userMessage:'임시 업무 DB를 제거하지 못했습니다. 분석 성공으로 보고하지 않습니다.',cleanupPath:work};}}}
 return result;
}
