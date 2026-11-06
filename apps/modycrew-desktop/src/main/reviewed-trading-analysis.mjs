import {reviewedRunnerPath} from './reviewed-runner-path.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash,randomUUID} from 'node:crypto';import {spawn} from 'node:child_process';
import {verifyReviewedPython} from './reviewed-python-runtime.mjs';import {createTradingBundle} from './reviewed-trading-bundle.mjs';
const main=path.dirname(fileURLToPath(import.meta.url)),hash=b=>createHash('sha256').update(b).digest('hex');
export const tradingAnalysisManifestHash='baac00f4ccca2ee58646fd3ff10107ec0721ebf6a1b434c4625aa958a9bb3c5b';
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>names.includes(k));
export function validateTradingConfiguration(value){
 if(!keys(value,['schema','provider','apiKey','quick','deep','dataProviders','limits'])||value.schema!=='mody.trading-analysis-settings.v1'||value.provider!=='openai'||typeof value.apiKey!=='string'||!/^sk-[A-Za-z0-9_-]{16,500}$/u.test(value.apiKey))throw Error('사용자 설정에는 지원하는 OpenAI 공급자와 사용자가 제공한 키가 필요합니다.');
 const models={};for(const tier of ['quick','deep']){const m=value[tier];if(!keys(m,['model','inputUsdPerMillion','outputUsdPerMillion'])||typeof m.model!=='string'||!/^[A-Za-z0-9._:-]{1,80}$/u.test(m.model)||[m.inputUsdPerMillion,m.outputUsdPerMillion].some(n=>typeof n!=='number'||!Number.isFinite(n)||n<=0||n>10000))throw Error('모델 이름과 사용자가 확인한 입력·출력 단가가 필요합니다.');models[tier]={...m};}
 const d=value.dataProviders;if(!Array.isArray(d)||!d.includes('yfinance')||new Set(d).size!==d.length||d.some(x=>!['yfinance','reddit','stocktwits'].includes(x)))throw Error('데이터 공급자는 yfinance 필수, reddit·stocktwits 선택만 지원합니다.');
 const l=value.limits;if(!keys(l,['maxModelCalls','maxRequests','maxOutputTokens','maxSeconds','maxEstimatedUsd']))throw Error('실행 한도 설정 오류');
 for(const [k,min,max]of [['maxModelCalls',1,80],['maxRequests',1,200],['maxOutputTokens',128,4096],['maxSeconds',30,600]])if(!Number.isInteger(l[k])||l[k]<min||l[k]>max)throw Error('요청·토큰·시간 한도가 허용 범위를 벗어났습니다.');
 if(l.maxRequests<l.maxModelCalls||typeof l.maxEstimatedUsd!=='number'||!Number.isFinite(l.maxEstimatedUsd)||l.maxEstimatedUsd<=0||l.maxEstimatedUsd>100)throw Error('예상 비용 한도는 0 초과 100 USD 이하이고 요청 한도는 모델 호출 한도 이상이어야 합니다.');
 return {schema:value.schema,provider:'openai',apiKey:value.apiKey,...models,dataProviders:[...d],limits:{...l}};
}
function execute({executable,runner,bundle,cwd,env,payload,seconds}){
 return new Promise((resolve,reject)=>{const child=spawn(executable,['-I','-S','-B',runner,bundle],{cwd,env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',bytes=0,error;
 const timer=setTimeout(()=>{error=Error('분석 시간 한도에 도달했습니다. 이미 발생한 공급자 비용은 취소되지 않습니다.');child.kill();},seconds*1000);
 const collect=(d,out)=>{bytes+=d.length;if(bytes>2*1024*1024){error=Error('분석 응답 크기 한도 초과');child.kill();}else if(out)output+=d.toString('utf8');};child.stdout.on('data',d=>collect(d,true));child.stderr.on('data',d=>collect(d,false));child.stdin.on('error',()=>{});child.on('error',()=>{clearTimeout(timer);reject(Error('분석 프로세스를 시작하지 못했습니다.'));});child.on('close',code=>{clearTimeout(timer);if(error||code!==0)reject(error??Error('원본 분석이 완료되지 않았습니다. 공급자 호환성·데이터·한도를 확인하세요. 원본 오류나 키는 대화에 출력하지 않습니다.'));else resolve(output);});child.stdin.end(JSON.stringify(payload));});
}
export function createReviewedTradingAnalysis({root,io=fs,fetch:fetchImpl=globalThis.fetch,confirm=async()=>false,pickConfiguration=async()=>'',runtimeOptions={},manifestPath=path.join(main,'reviewed-source-manifests','trading-analysis.json'),expectedManifestHash=tradingAnalysisManifestHash,runner=reviewedRunnerPath(path.join(main,'trading-analysis-runner.py')),run=execute,environment=process.env,now=()=>new Date().toISOString()}){
 let bundle,busy=false;async function installer(){if(!bundle){const b=await io.readFile(manifestPath);if(b.length>8*1024*1024||hash(b)!==expectedManifestHash)throw Error('전체 분석 명세 무결성 오류');bundle=createTradingBundle({root,manifest:JSON.parse(b),io,fetch:fetchImpl,confirm});}return bundle;}
 const runtime=()=>verifyReviewedPython({io,...runtimeOptions});
 async function prepare(){try{await runtime();return await(await installer()).prepare();}catch(e){return {status:'needs_setup',userMessage:e.message};}}
 return {prepare,async analyze(input){
  if(busy)return {status:'busy',userMessage:'TradingAgents 분석 중입니다.'};busy=true;let work,result,configuration;
  try{
   const ticker=typeof input?.ticker==='string'?input.ticker.trim().toUpperCase():'',date=input?.date;
   if(!/^[A-Z0-9^][A-Z0-9.^=-]{0,19}$/u.test(ticker)||typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/u.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date>now().slice(0,10))return {status:'invalid',userMessage:'공개 종목 코드와 미래가 아닌 YYYY-MM-DD 분석일이 필요합니다.'};
   const selected=await pickConfiguration();if(!selected)return {status:'needs_configuration',userMessage:'사용자가 공급자·모델·단가·키·한도를 담은 설정 JSON을 직접 선택해야 합니다. 대화에 키를 보내지 마세요.'};
   if(typeof selected!=='string'||!path.isAbsolute(selected)||selected.startsWith('\\\\'))return {status:'invalid_configuration',userMessage:'사용자가 선택한 로컬 설정 파일만 지원합니다.'};
   try{const s=await io.lstat(selected);if(!s.isFile()||s.isSymbolicLink()||s.size>16384)throw Error('size');configuration=validateTradingConfiguration(JSON.parse(await io.readFile(selected,'utf8')));}catch{return {status:'invalid_configuration',userMessage:'설정 파일 형식·지원 공급자·모델 단가·실행 한도를 확인하세요. 키나 파일 내용을 대화에 출력하지 않았습니다.'};}
   const ready=await prepare();if(ready.status!=='tool_available')return ready;
   const c=configuration,limit=c.limits;
   if(!await confirm({kind:'run_trading_analysis',name:'TradingAgents 외부 분석 요청',detail:[
    '대상: '+ticker+' / 기준일: '+date+' / 재무·뉴스·시장 심리·차트 → 강세·약세 검토 → 위험 검토. 실제 거래·주문·보유 계정 접근 없음.',
    '모델 공급자: OpenAI api.openai.com. 종목·기준일·공개 시세/뉴스/게시물과 중간 분석문을 모델에 전송합니다. 키는 요청 인증에만 사용하고 저장하거나 대화로 반환하지 않습니다.',
    '데이터 공급자: '+c.dataProviders.join(', ')+'. Yahoo Finance 조회/쿠키용 도메인, 선택 시 www.reddit.com·api.stocktwits.com에 종목/검색 조건을 전송합니다.',
    '사용자가 제공한 quick 모델: '+c.quick.model+' / 입력·출력 USD/백만 토큰 '+c.quick.inputUsdPerMillion+' / '+c.quick.outputUsdPerMillion,
    '사용자가 제공한 deep 모델: '+c.deep.model+' / 입력·출력 USD/백만 토큰 '+c.deep.inputUsdPerMillion+' / '+c.deep.outputUsdPerMillion,
    '최대 모델 호출 '+limit.maxModelCalls+'회 / 전체 요청 '+limit.maxRequests+'회 / 응답 '+limit.maxOutputTokens+'토큰 / '+limit.maxSeconds+'초 / 추정 예약 비용 '+limit.maxEstimatedUsd+' USD.',
    '비용은 사용자가 제공한 단가와 요청 크기로 사전 추정해 제한합니다. 실제 청구액 보장·공급자 결제 한도가 아닙니다. 중단·오류 전 발생한 비용은 취소되지 않습니다.',
    'SEC·FRED·Polymarket·다른 공급자로 자동 전환하지 않습니다. 허용하지 않은 심리 자료는 미확인으로 남습니다. 국내 공시 완전 지원·과거 심리 자료의 시점 일치를 보장하지 않습니다.',
    '기존 사용자 문서·환경 키·계정·캐시는 읽지 않고 새 임시 폴더의 분석 파일만 생성 후 제거합니다. 네이티브 라이브러리가 있어 OS 수준 완전 격리 보장은 아닙니다.',
    '원본 실행과 실제 공급자 호환성은 아직 검증하지 않았습니다. 투자 손실 위험과 자료 지연·결측을 함께 확인해야 합니다.',
   ].join('\n')}))return {status:'declined',userMessage:'외부 분석 요청을 취소했습니다.'};
   const executable=await runtime(),directory=await(await installer()).resolve();if(!directory)throw Error('원본 설치본 없음');const physical=await io.realpath(root);work=path.join(physical,'.analysis-'+randomUUID());await io.mkdir(work);
   const env=Object.fromEntries(['SystemRoot','WINDIR'].filter(k=>environment[k]).map(k=>[k,environment[k]]));Object.assign(env,{PATH:'',HOME:work,USERPROFILE:work,APPDATA:work,LOCALAPPDATA:work,TEMP:work,TMP:work,XDG_CONFIG_HOME:work,XDG_CACHE_HOME:work,LANGCHAIN_TRACING_V2:'false',LANGSMITH_TRACING:'false',OTEL_SDK_DISABLED:'true'});
   const parsed=JSON.parse(await run({executable,runner,bundle:directory,cwd:work,env,payload:{ticker,date,configuration:c},seconds:limit.maxSeconds}));
   if(!['Buy','Overweight','Hold','Underweight','Sell','REVIEW'].includes(parsed.rating)||!parsed.reports||typeof parsed.reports!=='object'||!parsed.network||!Number.isInteger(parsed.network.requests)||parsed.network.requests>limit.maxRequests||!Number.isInteger(parsed.network.modelCalls)||parsed.network.modelCalls>limit.maxModelCalls)throw Error('분석 응답 형식 오류');
   const reports={};for(const k of ['market_report','sentiment_report','news_report','fundamentals_report','investment_plan','trader_investment_plan','final_trade_decision','investment_debate_state','risk_debate_state']){if(typeof parsed.reports[k]!=='string'||parsed.reports[k].length>16000)throw Error('분석 보고서 형식 오류');reports[k]=parsed.reports[k].replaceAll(c.apiKey,'[REDACTED]');}
   const n=parsed.network;if(n.requests<0||n.modelCalls<0||!Number.isFinite(n.reservedEstimatedUsd)||n.reservedEstimatedUsd<0||n.reservedEstimatedUsd>limit.maxEstimatedUsd+0.000001||!Number.isInteger(n.blockedRequests)||n.blockedRequests<0||!Array.isArray(n.sources)||n.sources.length>limit.maxRequests)throw Error('전송 기록 형식 오류');
   const allowed=new Set(['api.openai.com','query1.finance.yahoo.com','query2.finance.yahoo.com','fc.yahoo.com','finance.yahoo.com','consent.yahoo.com','guce.yahoo.com',...(c.dataProviders.includes('reddit')?['www.reddit.com']:[]),...(c.dataProviders.includes('stocktwits')?['api.stocktwits.com']:[])]);
   const sources=n.sources.map(x=>{const u=new URL(x.url);if(u.protocol!=='https:'||!allowed.has(u.hostname)||u.username||u.password||u.search||u.hash||typeof x.requestedAt!=='string'||Number.isNaN(Date.parse(x.requestedAt)))throw Error('전송 출처 기록 오류');return {url:u.href.replaceAll(c.apiKey,'[REDACTED]'),requestedAt:x.requestedAt};});
   const network={requests:n.requests,modelCalls:n.modelCalls,reservedEstimatedUsd:n.reservedEstimatedUsd,blockedRequests:n.blockedRequests,sources,pricingSource:'사용자 제공 단가 기반 추정이며 공급자 실제 청구액 보장이 아님'};
   result={status:'analysis_completed',ticker,date,rating:parsed.rating,reports,network,checkedAt:now(),userMessage:'원본 연구 분석 경로가 완료됐습니다. 주문·체결·잔고 시뮬레이션 결과가 아니며 수익 보장이나 투자 적합성 검증이 아닙니다. 공개 자료 지연·누락 및 과거 심리 자료 한계를 확인하세요.'};
  }catch{result={status:'unavailable',userMessage:'분석이 완료되지 않았습니다. 실제 요청이 시작됐다면 중단 전 비용이 발생했을 수 있습니다. 키·원본 오류 내용은 대화에 출력하지 않았습니다.'};}
  finally{if(configuration)configuration.apiKey='';if(work)try{await io.rm(work,{recursive:true,force:true});}catch{result={status:'cleanup_required',cleanupPath:work,userMessage:'임시 분석 파일을 제거하지 못했습니다. 성공으로 보고하지 않습니다.'};}busy=false;}
  return result;
 }};
}
