import path from 'node:path';
import { open, writeFile } from 'node:fs/promises';
import { extractOfficeText, loadSafeZip } from './document-production/template-files.mjs';

const extensions = ['txt','md','csv','json','log','docx','pptx','xlsx','hwpx','pdf','png','jpg','jpeg','webp','gif'];
const maxBytes = 20 * 1024 * 1024;
export async function readWorkspaceFile(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('파일을 다시 선택해 주세요.');
  const extension = path.extname(filePath).slice(1).toLowerCase();
  if (!extensions.includes(extension)) throw new Error('이 형식은 미리보기를 지원하지 않습니다. 문서·표·이미지 파일을 선택해 주세요.');
  const handle = await open(filePath, 'r'); let buffer; let stats;
  try { stats=await handle.stat();if(!stats.isFile()||stats.size>maxBytes) throw new Error('20MB 이하의 파일을 선택해 주세요.');buffer=await handle.readFile();if(buffer.length>maxBytes)throw new Error('파일이 너무 큽니다.'); } finally { await handle.close(); }
  const base={name:path.basename(filePath),path:filePath,size:stats.size,extension};
  const mime={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif'}[extension];
  if(mime)return{...base,kind:'image',dataUrl:`data:${mime};base64,${buffer.toString('base64')}`};
  let text='';
  // Only slide text is read. Embedded chart workbooks are never opened or executed.
  if(['docx','pptx','hwpx'].includes(extension))text=await extractOfficeText(buffer,extension,{allowEmbeddedWorkbooks:extension==='pptx'});
  else if(extension==='xlsx'){
    await loadSafeZip(buffer);const {default:ExcelJS}=await import('exceljs');const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);
    const rows=[];let length=0;
    for(const sheet of workbook.worksheets){rows.push(`[${sheet.name}]`);sheet.eachRow((row,index)=>{if(index>500||length>80000)return;const cells=[];for(let col=1;col<=Math.min(row.cellCount,40);col++)cells.push(row.getCell(col).text);const line=cells.join('\t');rows.push(line);length+=line.length;});}text=rows.join('\n');
  } else if(extension==='pdf'){
    const {PDFParse}=await import('pdf-parse');const parser=new PDFParse({data:buffer});try{text=(await parser.getText({first:10})).text;}finally{await parser.destroy();}
  } else text=buffer.toString('utf8').replace(/^\uFEFF/,'');
  return {...base,kind:'text',text:text.slice(0,80000),truncated:text.length>80000||['xlsx','pdf'].includes(extension)};
}

export function createWorkspaceFiles({BrowserWindow,dialog,shell,trustedOrigin,read=readWorkspaceFile}){
  const opened=new WeakMap();
  return async(event,payload={})=>{
    const sender=event?.sender;let trusted=false;try{trusted=Boolean(sender&&event.senderFrame===sender.mainFrame&&trustedOrigin(new URL(sender.getURL())));}catch{}
    if(!trusted)throw new Error('앱 안에서 파일을 열어 주세요.');
    if(payload.kind==='select-project-folder'){
      const win=BrowserWindow.fromWebContents(sender);if(!win)throw new Error('앱 창을 찾을 수 없습니다.');
      const result=await dialog.showOpenDialog(win,{title:'프로젝트 폴더 선택',properties:['openDirectory']});
      if(result.canceled||!result.filePaths?.[0])return{status:'canceled'};
      return{status:'selected',path:result.filePaths[0],name:path.basename(result.filePaths[0])};
    }
    if(payload.kind==='save-shared'){
      const allowed = [...extensions,'doc','xls','ppt','hwp','zip'];
      const name=String(payload.name||'');const extension=path.extname(name).slice(1).toLowerCase();
      if(!name||name.length>180||name!==path.basename(name)||/[<>:"/\\|?*\x00-\x1f]/.test(name)||!allowed.includes(extension))throw new Error('저장할 파일 이름과 형식을 확인해 주세요.');
      if(typeof payload.base64!=='string'||payload.base64.length>Math.ceil(maxBytes/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(payload.base64))throw new Error('20MB 이하의 파일만 저장할 수 있습니다.');
      const bytes=Buffer.from(payload.base64,'base64');if(!bytes.length||bytes.length>maxBytes)throw new Error('파일 내용이 없습니다.');
      const win=BrowserWindow.fromWebContents(sender);if(!win)throw new Error('앱 창을 찾을 수 없습니다.');
      const result=await dialog.showSaveDialog(win,{title:'회사 공유 파일 저장',defaultPath:name,filters:[{name:'공유 파일',extensions:[extension]}]});
      if(result.canceled||!result.filePath)return{status:'canceled'};
      if(path.extname(result.filePath).slice(1).toLowerCase()!==extension)throw new Error('원본 파일의 확장자를 유지해 주세요.');
      await writeFile(result.filePath,bytes);return{status:'saved',path:result.filePath};
    }
    if(payload.kind==='open-original'){
      if(!opened.get(sender)?.has(payload.path))throw new Error('먼저 파일을 미리보기로 열어 주세요.');
      const result=await shell.openPath(payload.path);if(result)throw new Error('원본 파일을 열지 못했습니다. 파일 위치를 확인해 주세요.');return{status:'opened'};
    }
    let target=payload.path;
    if(payload.kind==='pick'){
      const win=BrowserWindow.fromWebContents(sender);if(!win)throw new Error('앱 창을 찾을 수 없습니다.');
      const result=await dialog.showOpenDialog(win,{title:'사이드 패널에서 파일 열기',properties:['openFile'],filters:[{name:'문서·표·이미지',extensions}]});if(result.canceled||!result.filePaths[0])return{status:'canceled'};target=result.filePaths[0];
    }else if(payload.kind!=='preview')throw new Error('지원하지 않는 파일 작업입니다.');
    const file=await read(target);const paths=opened.get(sender)||new Set();paths.add(file.path);opened.set(sender,paths);return{status:'ready',file};
  };
}
