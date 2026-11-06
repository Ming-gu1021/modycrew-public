import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MAIL_ATTACHMENT_MAX_BYTES, MAIL_ATTACHMENT_MAX_COUNT, prepareMailAttachments } from './smtp-sender.mjs';

const uuid=/^[a-f0-9-]{36}$/;
const within=(root,file)=>{const relative=path.relative(root,file);return Boolean(relative)&&!relative.startsWith('..')&&!path.isAbsolute(relative);};
/** Resolve only saved outputs linked to this reply in the currently selected workspace. Never accept paths from a renderer. */
export function createMailDocumentAttachmentResolver({stateRoot,outputRoot,loadWorkspace}) {
  return async function resolve({workItemId,selection}={}) {
    const loaded=await loadWorkspace();
    if(loaded.status!=='work_session_workspace_loaded')throw new Error('첨부할 업무 자료를 다시 불러와 주세요.');
    const artifacts=loaded.workspace.sessions.filter(work=>work.replyCardId===workItemId).flatMap(work=>work.artifacts||[]);
    const requested=typeof selection==='string'?selection.split(',').filter(Boolean):null;
    if(requested&&(requested.length>MAIL_ATTACHMENT_MAX_COUNT||new Set(requested).size!==requested.length))throw new Error('첨부 결과물은 중복 없이 최대 5개까지 선택해 주세요.');
    if(requested?.length===0)return {candidates:[],attachments:[]};
    const candidates=[];const attachments=[];const seen=new Set();let total=0;
    for(const artifact of artifacts) {
      const key=`${artifact.documentId}:${artifact.sha256}`;
      if(seen.has(key)||(requested&&!requested.includes(key)))continue;
      seen.add(key);
      if(!uuid.test(artifact.documentId)||!/^[a-f0-9]{64}$/.test(artifact.sha256))throw new Error('저장한 결과물 정보를 확인할 수 없습니다.');
      const document=JSON.parse(await readFile(path.join(stateRoot,'outputs',`${artifact.documentId}.json`),'utf8'));
      if(document.id!==artifact.documentId||document.sha256!==artifact.sha256||document.bytes!==artifact.bytes)throw new Error('결과물이 바뀌었습니다. 업무에서 파일을 다시 확인해 주세요.');
      const output=await realpath(outputRoot);const folder=await realpath(path.join(outputRoot,document.id));const file=await realpath(document.path);
      if(!within(output,folder)||!within(folder,file))throw new Error('결과물 저장 경로를 확인할 수 없습니다.');
      const info=await stat(file);
      if(!info.isFile()||info.size!==document.bytes||info.size>MAIL_ATTACHMENT_MAX_BYTES)throw new Error('첨부 결과물 크기가 바뀌었거나 10 MB를 초과합니다.');
      const bytes=await readFile(file);
      if(createHash('sha256').update(bytes).digest('hex')!==artifact.sha256)throw new Error('결과물 내용이 바뀌었습니다. 새 파일을 저장한 뒤 다시 선택해 주세요.');
      const candidate={id:artifact.documentId,key,title:artifact.title,filename:path.basename(file),bytes:bytes.length,sha256:artifact.sha256};
      candidates.push(candidate);
      if(requested){total+=bytes.length;if(total>MAIL_ATTACHMENT_MAX_BYTES)throw new Error('첨부 결과물 합계가 10 MB를 초과합니다.');attachments.push({filename:candidate.filename,contentBase64:bytes.toString('base64')});}
    }
    if(requested&&requested.some(key=>!candidates.some(candidate=>candidate.key===key)))throw new Error('이 답장에 연결되지 않은 결과물입니다. 현재 업무에서 다시 선택해 주세요.');
    if((await loadWorkspace()).root!==loaded.root)throw new Error('업무 저장소가 바뀌어 첨부 확인을 중단했습니다. 다시 확인해 주세요.');
    return {candidates,attachments:requested?prepareMailAttachments(attachments):[]};
  };
}
