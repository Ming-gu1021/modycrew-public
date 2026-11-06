'use client';

import { collection, doc, getDocFromServer, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { getStorage, ref, uploadBytesResumable, getBytes, deleteObject } from 'firebase/storage';
import { getCompanySession } from './company-client';
import { companyClock } from './company-clock.mjs';
import type { ModyAuthSession } from './firebase-client';
import type { CompanyTeam, CompanyTask, CompanyTaskEvent, CompanyTaskStatus, CompanyFile } from './company-types';

const text = (value: string, max: number, required = true) => {
  const clean = String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if ((required && !clean) || clean.length > max) throw new Error(`내용을 ${max}자 이내로 확인해 주세요.`);
  return clean;
};
const identifier = (value: string) => { if (!/^[A-Za-z0-9_-]{1,140}$/.test(value)) throw new Error('회사·대화방 정보를 확인해 주세요.'); return value; };
const now = () => companyClock.serverNow();
const stamp = () => ({ updatedAt: serverTimestamp(), updatedAtEpochMs: now() });
const created = () => ({ createdAt: serverTimestamp(), createdAtEpochMs: now(), ...stamp() });
const row = <T,>(snap: { id: string; data: () => unknown }) => ({ ...(snap.data() as object), id: snap.id } as T);
export const taskStatusLabels: Record<CompanyTaskStatus, string> = { todo: '할 일', doing: '진행 중', review: '검토 요청', done: '완료', canceled: '취소' };
export const COMPANY_FILE_MAX = 20 * 1024 * 1024;
export const COMPANY_FILE_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.hwp,.hwpx,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp,.gif,.zip';
const hash = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');

async function teamSession(session: ModyAuthSession, companyId: string, teamId: string) {
  const current = await getCompanySession(session, identifier(companyId));
  const teamRef = doc(current.db, 'companies', companyId, 'teams', identifier(teamId));
  const snap = await getDocFromServer(teamRef); const team = snap.exists() ? row<CompanyTeam>(snap) : null;
  if (!team || (team.visibility !== 'company' && !team.memberIds.includes(session.uid))) throw new Error('이 대화방의 참여자만 사용할 수 있습니다.');
  return { ...current, team, teamRef };
}

/** Employees can start their own conversations; direct conversations keep exactly two participants. */
export async function startCompanyConversation(session: ModyAuthSession, companyId: string, input: { kind: 'direct' | 'group'; name?: string; memberIds: string[] }): Promise<CompanyTeam> {
  const { db, user } = await getCompanySession(session, identifier(companyId));
  const memberIds = [...new Set([user.uid, ...input.memberIds.map(identifier)])].sort();
  if (!['direct', 'group'].includes(input.kind) || memberIds.length > 50 || (input.kind === 'direct' && memberIds.length !== 2)) throw new Error('1대1은 상대 1명을, 단체 대화는 50명 이내로 선택해 주세요.');
  const members = await Promise.all(memberIds.map(uid => getDocFromServer(doc(db, 'companies', companyId, 'members', uid))));
  if (members.some(m => !m.exists() || m.data().status !== 'active')) throw new Error('현재 회사에 참여 중인 직원만 선택해 주세요.');
  const key = input.kind === 'direct' ? 'dm-' + await hash(new TextEncoder().encode(JSON.stringify(memberIds)).buffer) : doc(collection(db, 'companies', companyId, 'teams')).id;
  const teamRef = doc(db, 'companies', companyId, 'teams', key);
  const name = input.kind === 'direct' ? members.map(m => m.data()!.displayName).join(' · ').slice(0, 80) : text(input.name || '', 80);
  return runTransaction(db, async tx => {
    // A new private room cannot be read before it exists. Direct IDs are deterministic,
    // so rules allow a missing dm-* get to active members only.
    const existing = await tx.get(teamRef);
    if (existing.exists()) {
      const value = row<CompanyTeam>(existing);
      if (value.kind !== input.kind || JSON.stringify([...value.memberIds].sort()) !== JSON.stringify(memberIds)) throw new Error('대화방 참여자가 일치하지 않습니다. 관리자에게 문의해 주세요.');
      return value;
    }
    const team: CompanyTeam = { id: key, name, visibility: 'private', kind: input.kind, memberIds, createdBy: user.uid, createdAtEpochMs: now(), updatedAtEpochMs: now() };
    tx.set(teamRef, { ...team, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); return team;
  });
}

export async function subscribeCompanyTasks(session: ModyAuthSession, companyId: string, teamId: string, change: (tasks: CompanyTask[]) => void, error: (error: Error) => void) {
  const { teamRef } = await teamSession(session, companyId, teamId);
  return onSnapshot(query(collection(teamRef, 'tasks'), orderBy('updatedAtEpochMs', 'desc'), limit(200)), { includeMetadataChanges: true }, snap => { if (!snap.metadata.fromCache) change(snap.docs.map(s => row<CompanyTask>(s))); }, error);
}
export async function subscribeTaskEvents(session: ModyAuthSession, companyId: string, teamId: string, taskId: string, change: (events: CompanyTaskEvent[]) => void, error: (error: Error) => void) {
  const { teamRef } = await teamSession(session, companyId, teamId);
  return onSnapshot(query(collection(teamRef, 'tasks', identifier(taskId), 'events'), orderBy('createdAtEpochMs', 'desc'), limit(50)), { includeMetadataChanges: true }, snap => { if (!snap.metadata.fromCache) change(snap.docs.map(s => row<CompanyTaskEvent>(s))); }, error);
}
export async function createCompanyTask(session: ModyAuthSession, companyId: string, teamId: string, input: Pick<CompanyTask, 'title' | 'description' | 'assigneeUid' | 'dueDate' | 'priority'>): Promise<string> {
  const { db, member, user, teamRef, team } = await teamSession(session, companyId, teamId);
  if (!['normal', 'high'].includes(input.priority) || (input.dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) || Number.isNaN(Date.parse(input.dueDate)) || new Date(input.dueDate).toISOString().slice(0, 10) !== input.dueDate))) throw new Error('기한과 우선순위를 확인해 주세요.');
  const assignee = await getDocFromServer(doc(db, 'companies', companyId, 'members', identifier(input.assigneeUid)));
  if (!assignee.exists() || assignee.data().status !== 'active' || (team.visibility !== 'company' && !team.memberIds.includes(input.assigneeUid))) throw new Error('이 대화방에 참여하는 직원을 담당자로 선택해 주세요.');
  const taskRef = doc(collection(teamRef, 'tasks')); const eventRef = doc(collection(taskRef, 'events'));
  const value = { id: taskRef.id, title: text(input.title, 160), description: text(input.description, 6000, false), assigneeUid: input.assigneeUid, assigneeName: assignee.data().displayName, creatorUid: user.uid, creatorName: member.displayName, dueDate: input.dueDate, priority: input.priority, status: 'todo', resultText: '', lastEventId: eventRef.id, ...created() };
  const messageRef = doc(collection(teamRef, 'messages'));
  await runTransaction(db, async tx => {
    tx.set(taskRef, value);
    tx.set(eventRef, { id: eventRef.id, authorUid: user.uid, authorName: member.displayName, status: 'todo', note: '업무를 지시했습니다.', createdAt: serverTimestamp(), createdAtEpochMs: now() });
    tx.set(messageRef, { id: messageRef.id, authorUid: user.uid, authorName: member.displayName, kind: 'human', text: `[업무 지시] ${value.title}\n담당: ${value.assigneeName}${value.dueDate ? '\n기한: ' + value.dueDate : ''}\n이 대화방의 ‘업무 지시’에서 진행 내용과 결과를 보고해 주세요.`, requestText: '', requestId: '', createdAt: serverTimestamp(), createdAtEpochMs: now() });
  });
  return taskRef.id;
}
export async function updateCompanyTask(session: ModyAuthSession, companyId: string, teamId: string, taskId: string, input: { status: CompanyTaskStatus; resultText: string }) {
  const { db, member, user, teamRef } = await teamSession(session, companyId, teamId);
  const resultText = text(input.resultText, 6000, false); const taskRef = doc(teamRef, 'tasks', identifier(taskId)); const eventRef = doc(collection(taskRef, 'events'));
  await runTransaction(db, async tx => {
    const snap = await tx.get(taskRef); if (!snap.exists()) throw new Error('업무가 없습니다.'); const before = snap.data() as CompanyTask;
    const assigner = before.creatorUid === user.uid || ['owner', 'admin'].includes(member.role); const assignee = before.assigneeUid === user.uid;
    const permitted = (assignee && ((input.status === 'doing' && ['todo', 'doing', 'review'].includes(before.status)) || (input.status === 'review' && ['todo', 'doing', 'review'].includes(before.status)))) || (assigner && ((input.status === 'done' && before.status === 'review') || (input.status === 'todo' && ['review', 'done', 'canceled'].includes(before.status)) || (input.status === 'canceled' && ['todo', 'doing', 'review'].includes(before.status))));
    if (!permitted) throw new Error('담당자는 진행·결과 보고를, 지시자와 관리자는 검토·완료 확인을 할 수 있습니다.');
    if (input.status === 'review' && !resultText) throw new Error('검토할 결과나 진행 내용을 입력해 주세요.');
    tx.update(taskRef, { status: input.status, resultText, lastEventId: eventRef.id, ...stamp() });
    tx.set(eventRef, { id: eventRef.id, authorUid: user.uid, authorName: member.displayName, status: input.status, note: resultText || taskStatusLabels[input.status], createdAt: serverTimestamp(), createdAtEpochMs: now() });
  });
}

export async function subscribeCompanyFiles(session: ModyAuthSession, companyId: string, teamId: string, change: (files: CompanyFile[]) => void, error: (error: Error) => void) {
  const { teamRef } = await teamSession(session, companyId, teamId);
  return onSnapshot(query(collection(teamRef, 'files'), orderBy('createdAtEpochMs', 'desc'), limit(100)), { includeMetadataChanges: true }, snap => { if (!snap.metadata.fromCache) change(snap.docs.map(s => row<CompanyFile>(s)).filter(f => f.status === 'ready')); }, error);
}
export async function uploadCompanyFile(session: ModyAuthSession, companyId: string, teamId: string, file: File, progress: (percent: number) => void, signal?: AbortSignal) {
  const { app, user, member, teamRef } = await teamSession(session, companyId, teamId);
  const name = text(file.name, 180); const extension = '.' + name.split('.').at(-1)?.toLowerCase();
  if (!COMPANY_FILE_ACCEPT.split(',').includes(extension) || !file.size || file.size > COMPANY_FILE_MAX || /[\\/]/.test(name)) throw new Error('20MB 이하의 문서·표·이미지·ZIP 파일을 선택해 주세요.');
  const bytes = await file.arrayBuffer(); const digest = await hash(bytes); const fileRef = doc(collection(teamRef, 'files'));
  const storagePath = `companies/${companyId}/teams/${teamId}/files/${user.uid}/${fileRef.id}`;
  const objectRef = ref(getStorage(app), storagePath);
  await setDoc(fileRef, { id: fileRef.id, name, size: bytes.byteLength, sha256: digest, storagePath, authorUid: user.uid, authorName: member.displayName, status: 'uploading', ...created() });
  const upload = uploadBytesResumable(objectRef, bytes, { contentType: 'application/octet-stream', contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(name)}` });
  const cancel = () => upload.cancel(); signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
  try {
    await new Promise<void>((resolve, reject) => upload.on('state_changed', snap => progress(Math.round(snap.bytesTransferred / snap.totalBytes * 100)), reject, () => resolve()));
    if (signal?.aborted) throw new Error('업로드를 취소했습니다.');
    await updateDoc(fileRef, { status: 'ready', ...stamp() }); return fileRef.id;
  } catch (error) {
    // Keep metadata if object cleanup fails, so the same uploader can retry cleanup.
    await deleteObject(objectRef).catch(error => { if (error?.code !== 'storage/object-not-found') throw error; }).then(() => deleteDoc(fileRef)).catch(() => undefined);
    throw error;
  } finally { signal?.removeEventListener('abort', cancel); }
}
export async function downloadCompanyFile(session: ModyAuthSession, companyId: string, teamId: string, fileId: string): Promise<{ name: string; bytes: ArrayBuffer }> {
  const { app, teamRef } = await teamSession(session, companyId, teamId);
  const snap = await getDocFromServer(doc(teamRef, 'files', identifier(fileId))); const file = snap.data() as CompanyFile | undefined;
  const expected = `companies/${companyId}/teams/${teamId}/files/${file?.authorUid}/${fileId}`;
  if (!file || file.status !== 'ready' || file.storagePath !== expected || file.size > COMPANY_FILE_MAX) throw new Error('다운로드할 파일을 다시 확인해 주세요.');
  const bytes = await getBytes(ref(getStorage(app), expected), COMPANY_FILE_MAX);
  if (bytes.byteLength !== file.size || await hash(bytes) !== file.sha256) throw new Error('파일이 원본과 일치하지 않아 저장하지 않았습니다.');
  return { name: file.name, bytes };
}
