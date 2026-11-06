import fs from 'node:fs/promises';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
function sourcePath(value){if(typeof value!=='string'||!value||value.length>240||value.includes('\\'))throw Error('Archive path invalid');const parts=value.split('/');if(parts.length>16||parts.some(p=>!p||p==='.'||p==='..'||p.toLowerCase()==='.git'||/[<>:"|?*\x00-\x1f]/u.test(p)||/[. ]$/u.test(p)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(p)))throw Error('Archive path unsafe');return value;}
const hash=b=>createHash('sha256').update(b).digest('hex');
export function createTradingBundle({root,manifest,io=fs,fetch:fetchImpl=globalThis.fetch,confirm=async()=>false}){
 if(manifest.schema!=='mody.trading-analysis-bundle.v1'||!/^[a-f0-9]{40}$/u.test(manifest.version)||manifest.packages.length>100)throw Error('TradingAgents 명세 오류');
 const all=[manifest.source,...manifest.packages],expected=new Map();let total=0;
 for(const a of all){if(a.bytes<1||a.bytes>128*1024*1024||!/^[a-f0-9]{64}$/u.test(a.sha256))throw Error('원본 압축 명세 오류');for(const f of a.files){sourcePath(f.path);sourcePath(f.target);const target=(a===manifest.source?'source/':'packages/')+f.target;if(expected.has(target.toLowerCase())||f.bytes<0||f.bytes>64*1024*1024)throw Error('원본 설치 파일 충돌·용량 오류');expected.set(target.toLowerCase(),{...f,target});total+=f.bytes;}}
 for(const f of manifest.supplementalFiles??[]){sourcePath(f.path);if(hash(Buffer.from(f.content))!==f.sha256||Buffer.byteLength(f.content)!==f.bytes||expected.has(f.path.toLowerCase()))throw Error('저작권 고지 오류');expected.set(f.path.toLowerCase(),{...f,target:f.path});}
 if(total>512*1024*1024||expected.size>20000)throw Error('TradingAgents 전체 용량 초과');
 const target=path.join(root,manifest.version),manifestHash=hash(Buffer.from(JSON.stringify(manifest)));let busy=false;
 const exists=async p=>{try{await io.lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
 const dir=async p=>{const s=await io.lstat(p);if(!s.isDirectory()||s.isSymbolicLink())throw Error('원본 폴더 링크·형식 오류');};
 async function verify(folder){await dir(root);await dir(folder);let count=0;async function walk(p,rel=''){for(const e of await io.readdir(p,{withFileTypes:true})){const name=rel?rel+'/'+e.name:e.name,s=await io.lstat(path.join(p,e.name));if(s.isSymbolicLink())throw Error('설치본 링크 변조');if(s.isDirectory()){await walk(path.join(p,e.name),name);continue;}if(name==='receipt.json'){if(s.size>4096)throw Error('설치 기록 오류');continue;}const f=expected.get(name.toLowerCase());if(!f||f.target!==name||!s.isFile()||s.size!==f.bytes||hash(await io.readFile(path.join(p,e.name)))!==f.sha256)throw Error('원본 설치본 변조');count++;}}await walk(folder);if(count!==expected.size)throw Error('설치본 파일 누락');const receipt=JSON.parse(await io.readFile(path.join(folder,'receipt.json'),'utf8'));if(receipt.manifestHash!==manifestHash||typeof receipt.approvedAt!=='string')throw Error('설치 출처 불일치');return folder;}
 async function download(a){const u=new URL(a.url);const valid=a===manifest.source?u.href==='https://codeload.github.com/TauricResearch/TradingAgents/zip/'+manifest.version:u.protocol==='https:'&&u.hostname==='files.pythonhosted.org';if(!valid||u.username||u.password||u.port)throw Error('원본 주소 오류');const r=await fetchImpl(a.url,{redirect:'error',signal:AbortSignal.timeout(120000)});if(!r.ok||!r.body?.getReader)throw Error('원본 다운로드 실패');const reader=r.body.getReader(),parts=[];let size=0;try{while(true){const x=await reader.read();if(x.done)break;size+=x.value.length;if(size>a.bytes)throw Error('원본 크기 초과');parts.push(Buffer.from(x.value));}}finally{await reader.cancel().catch(()=>{});}return Buffer.concat(parts);}
 return {resolve:async()=>await exists(target)?verify(target):null,async prepare(){if(busy)return {status:'busy',userMessage:'TradingAgents 준비 중'};busy=true;let stage,physical,lock,lockPath;
 try{if(await exists(target)){await verify(target);return {status:'tool_available',reused:true,userMessage:'고정 전체 원본을 재사용합니다. 분석은 사용자 공급자 설정과 별도 전송·비용 승인이 필요합니다.'};}
 if(!await confirm({kind:'install_tool',name:'TradingAgents 전체 분석 원본',detail:[
  '원본 전체 소스와 고정 Python wheel '+manifest.packages.length+'개를 앱 전용 폴더에 준비합니다. pip·빌드·설치 스크립트를 실행하지 않습니다.',
  '출처: GitHub TauricResearch/TradingAgents 및 PyPI files.pythonhosted.org','커밋: '+manifest.version,'명세 SHA-256: '+manifestHash,
  '다운로드 '+all.reduce((n,a)=>n+a.bytes,0)+'바이트 / 해제 '+total+'바이트 / '+expected.size+'파일','경로: '+target,
  'Apache-2.0 원본 및 각 의존성 라이선스·고지를 보존합니다. 기존 Python·전역 패키지·계정 설정은 변경하지 않습니다.',
  '준비 승인은 외부 분석 요청 승인이 아닙니다. 모델·데이터 공급자·비용·전송 범위는 실행 전에 따로 확인합니다.',
 ].join('\n')}))return {status:'declined',userMessage:'TradingAgents 설치를 취소했습니다.'};
 await io.mkdir(root,{recursive:true});await dir(root);physical=await io.realpath(root);lockPath=path.join(physical,'.install.lock');try{lock=await io.open(lockPath,'wx');}catch(e){if(e.code==='EEXIST')return {status:'busy',userMessage:'기존 설치 잠금을 보존했습니다.'};throw e;}
 if(await exists(target)){await verify(target);return {status:'tool_available',reused:true,userMessage:'동일 설치본 재사용'};}
 stage=path.join(physical,'.stage-'+randomUUID());await io.mkdir(stage);
 for(const a of all){const extracted=extractReviewedWheel(await download(a),a);for(const f of a.files){const p=path.join(stage,a===manifest.source?'source':'packages',f.target);await io.mkdir(path.dirname(p),{recursive:true});await io.writeFile(p,extracted.get(f.path),{flag:'wx'});}}
 for(const f of manifest.supplementalFiles??[]){const p=path.join(stage,f.path);await io.mkdir(path.dirname(p),{recursive:true});await io.writeFile(p,f.content,{flag:'wx'});}
 await io.writeFile(path.join(stage,'receipt.json'),JSON.stringify({manifestHash,approvedAt:new Date().toISOString()}),{flag:'wx'});await verify(stage);if(await exists(target))throw Error('설치 경로 변경');await io.rename(stage,target);stage=null;await verify(target);return {status:'tool_available',installedNow:true,userMessage:'TradingAgents 전체 원본과 의존성을 준비했습니다. 실제 원본 실행·공급자 호환성은 미검증입니다.'};
 }catch(e){return {status:'review_required',userMessage:e.message+' 기존 설치본은 보존했습니다.'};}finally{if(stage&&path.dirname(stage)===physical)await io.rm(stage,{recursive:true,force:true}).catch(()=>{});if(lock){await lock.close().catch(()=>{});await io.unlink(lockPath).catch(()=>{});}busy=false;}}};
}

export function extractReviewedWheel(buffer,wheel){
 if(buffer.length!==wheel.bytes||hash(buffer)!==wheel.sha256)throw new Error('wheel 원본 크기·해시 불일치');
 const expected=new Map(wheel.files.map(f=>[f.path,f])),out=new Map();let end=-1;
 const need=(at,n)=>{if(at<0||n<0||at+n>buffer.length)throw new Error('wheel ZIP 경계 오류');};
 for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50&&i+22+buffer.readUInt16LE(i+20)===buffer.length){end=i;break;}
 if(end<0)throw new Error('wheel ZIP 종료 오류');
 const count=buffer.readUInt16LE(end+10),start=buffer.readUInt32LE(end+16),size=buffer.readUInt32LE(end+12);
 if(count>4096||buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6)||buffer.readUInt16LE(end+8)!==count||start+size!==end)throw new Error('wheel ZIP 구조 오류');
 let at=start;const ranges=[];
 for(let i=0;i<count;i++){
  need(at,46);if(buffer.readUInt32LE(at)!==0x02014b50)throw new Error('wheel 파일 명세 오류');
  const flags=buffer.readUInt16LE(at+8),method=buffer.readUInt16LE(at+10),compressed=buffer.readUInt32LE(at+20),bytes=buffer.readUInt32LE(at+24),n=buffer.readUInt16LE(at+28),extra=buffer.readUInt16LE(at+30),comment=buffer.readUInt16LE(at+32),mode=(buffer.readUInt32LE(at+38)>>>16)&0xf000,offset=buffer.readUInt32LE(at+42);
  need(at+46,n+extra+comment);const name=buffer.subarray(at+46,at+46+n).toString('utf8');at+=46+n+extra+comment;
  if(flags&1||buffer.readUInt16LE(at-46-n-extra-comment+34)||![0,8].includes(method))throw new Error('wheel 암호화·압축 방식 오류');
  if(name.endsWith('/')){sourcePath(name.slice(0,-1));if(bytes!==0||![0,0x4000].includes(mode)||!wheel.files.some(f=>f.path.startsWith(name)))throw new Error('wheel 폴더 오류');continue;}
  sourcePath(name);const file=expected.get(name);if(!file||out.has(name)||bytes!==file.bytes||![0,0x8000].includes(mode))throw new Error('wheel 허용 파일 명세 불일치');
  need(offset,30);if(buffer.readUInt32LE(offset)!==0x04034b50||buffer.readUInt16LE(offset+6)!==flags||buffer.readUInt16LE(offset+8)!==method)throw new Error('wheel 로컬 명세 불일치');
  const ln=buffer.readUInt16LE(offset+26),le=buffer.readUInt16LE(offset+28),dataAt=offset+30+ln+le;need(offset+30,ln+le+compressed);
  if(buffer.subarray(offset+30,offset+30+ln).toString('utf8')!==name||dataAt+compressed>start||ranges.some(([a,b])=>offset<b&&dataAt+compressed>a))throw new Error('wheel 파일 경계 불일치');
  ranges.push([offset,dataAt+compressed]);const packed=buffer.subarray(dataAt,dataAt+compressed);const data=method===0?Buffer.from(packed):inflateRawSync(packed,{maxOutputLength:Math.max(1,bytes)});
  if(data.length!==bytes||hash(data)!==file.sha256)throw new Error('wheel 해제 파일 무결성 불일치');out.set(name,data);
 }
 if(at!==end||out.size!==expected.size)throw new Error('wheel 필수 파일 누락');return out;
}
