'use client';

import { collection, doc, getDocFromServer as getDoc, getDocsFromServer as getDocs, getFirestore, limit, onSnapshot as observeSnapshot, or, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch, deleteDoc, type DocumentData, type DocumentReference, type DocumentSnapshot, type Query, type QuerySnapshot, type Unsubscribe } from 'firebase/firestore';
import { getAuth, type User } from 'firebase/auth';
import type { FirebaseApp } from 'firebase/app';
import { getFirebaseClientApp, type ModyAuthSession } from './firebase-client';
import { COMPANY_AI_LEASE_MS, type CompanyAIContext, type CompanyAIRequest, type CompanyHost, type CompanyInfo, type CompanyInvite, type CompanyMember, type CompanyMembership, type CompanyMessage, type CompanyResource, type CompanyRole, type CompanyTeam } from './company-types';
import { companyClock } from './company-clock.mjs';

type ErrorHandler = (error: Error) => void;
type TeamInput = Pick<CompanyTeam, 'name' | 'visibility' | 'memberIds'>;
const clean = (value: string, label: string, max: number, optional = false) => {
  const result = String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if ((!optional && !result) || result.length > max) throw new Error(`${label}을(를) ${max}자 이내로 확인해 주세요.`);
  return result;
};
const id = (value: string) => { const result = clean(value, 'ID', 140); if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new Error('잘못된 회사 또는 업무 ID입니다.'); return result; };
const data = <T,>(snap: DocumentSnapshot<DocumentData>): T => ({ ...snap.data(), id: snap.id } as T);
// Rules compare these epoch fields with the server clock, so a PC whose clock drifted is corrected
// with the offset learned from this device's own earlier writes (0 until one comes back).
const serverNow = () => companyClock.serverNow();
const serverMillis = (value: unknown) => typeof (value as { toMillis?: unknown })?.toMillis === 'function' ? (value as { toMillis: () => number }).toMillis() : 0;
const stamp = () => ({ updatedAt: serverTimestamp(), updatedAtEpochMs: serverNow() });
const created = () => ({ createdAt: serverTimestamp(), createdAtEpochMs: serverNow(), ...stamp() });
const membershipData = (company: CompanyInfo, member: CompanyMember): CompanyMembership => ({ uid: member.uid, companyId: company.id, companyName: company.name, role: member.role, status: member.status, updatedAtEpochMs: serverNow() });
const fail = (onError?: ErrorHandler) => (error: unknown) => onError?.(error instanceof Error ? error : new Error(String(error)));
const isPermissionDenied = (error: unknown) => /permission-denied|insufficient permissions|permission denied/i.test(`${(error as { code?: string })?.code || ''} ${error instanceof Error ? error.message : ''}`);
export const COMPANY_AI_PENDING_MESSAGE = '이전 AI 요청이 아직 대기 중이에요 — [내 대기 요청 취소]를 눌러 주세요.';

// Cached snapshots can belong to a previous signed-in user; expose server-authorized snapshots only.
function onSnapshot(reference: DocumentReference<DocumentData>, onChange: (snapshot: DocumentSnapshot<DocumentData>) => void, onError: ErrorHandler): Unsubscribe;
function onSnapshot(reference: Query<DocumentData>, onChange: (snapshot: QuerySnapshot<DocumentData>) => void, onError: ErrorHandler): Unsubscribe;
function onSnapshot(reference: DocumentReference<DocumentData> | Query<DocumentData>, onChange: ((snapshot: DocumentSnapshot<DocumentData>) => void) | ((snapshot: QuerySnapshot<DocumentData>) => void), onError: ErrorHandler): Unsubscribe {
  if (reference.type === 'document') return observeSnapshot(reference, { includeMetadataChanges: true }, (snapshot) => {
    if (!snapshot.metadata.fromCache) (onChange as (value: DocumentSnapshot<DocumentData>) => void)(snapshot);
  }, onError);
  return observeSnapshot(reference, { includeMetadataChanges: true }, (snapshot) => {
    if (!snapshot.metadata.fromCache) (onChange as (value: QuerySnapshot<DocumentData>) => void)(snapshot);
  }, onError);
}

async function runtime(session: ModyAuthSession, suppliedApp?: FirebaseApp) {
  const app = suppliedApp ?? await getFirebaseClientApp();
  if (!app) throw new Error('계정 연결 설정을 확인해 주세요.');
  const auth = getAuth(app); await auth.authStateReady();
  const user = auth.currentUser;
  if (!user || user.uid !== session.uid) throw new Error('회사 연결을 위해 계정에 다시 로그인해 주세요.');
  return { app, auth, user, db: getFirestore(app) };
}
function currentName(user: User) { return clean(user.displayName || user.email || '직원', '직원 이름', 120); }
function memberValue(user: User, role: CompanyRole, inviteHash: string): CompanyMember {
  const now = serverNow();
  return { uid: user.uid, email: (user.email || '').toLowerCase(), displayName: currentName(user), role, status: 'active', inviteHash, createdAtEpochMs: now, updatedAtEpochMs: now };
}
async function companyAndMember(session: ModyAuthSession, companyId: string) {
  const r = await runtime(session); const cid = id(companyId);
  const [company, member] = await Promise.all([getDoc(doc(r.db, 'companies', cid)), getDoc(doc(r.db, 'companies', cid, 'members', r.user.uid))]);
  if (!company.exists() || !member.exists() || member.data().status !== 'active') throw new Error('현재 회사의 직원 권한이 없습니다.');
  return { ...r, company: data<CompanyInfo>(company), member: member.data() as CompanyMember };
}
export const getCompanySession = companyAndMember;
/** Refresh this account's authentication and verify live membership before reopening listeners. */
export async function recoverCompanyConnection(session: ModyAuthSession, companyId: string): Promise<void> {
  const { user } = await runtime(session);
  await user.getIdToken(true);
  await companyAndMember(session, companyId);
}
function requireAdmin(member: CompanyMember) { if (!['owner', 'admin'].includes(member.role)) throw new Error('회사 관리자만 변경할 수 있습니다.'); }
function roleValue(role: 'admin' | 'member' = 'member') { if (!['admin', 'member'].includes(role)) throw new Error('직원 권한을 확인해 주세요.'); return role; }
function teamValue(input: TeamInput): TeamInput {
  if (!['company', 'private'].includes(input.visibility) || !Array.isArray(input.memberIds) || input.memberIds.length > 100) throw new Error('팀 범위와 직원을 확인해 주세요.');
  return { name: clean(input.name, '팀 이름', 80), visibility: input.visibility, memberIds: [...new Set(input.memberIds.map(id))] };
}
function teamAccess(team: CompanyTeam, uid: string) { return team.visibility === 'company' || team.memberIds.includes(uid); }

export async function createCompany(session: ModyAuthSession, name: string): Promise<CompanyInfo> {
  const { db, user } = await runtime(session); const ref = doc(collection(db, 'companies')); const now = serverNow();
  const company = { id: ref.id, name: clean(name, '회사 이름', 120), ownerUid: user.uid, createdAtEpochMs: now, updatedAtEpochMs: now };
  const owner = memberValue(user, 'owner', ''); const batch = writeBatch(db);
  batch.set(ref, { ...company, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  batch.set(doc(ref, 'members', user.uid), { ...owner, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  batch.set(doc(db, 'users', user.uid, 'companyMemberships', ref.id), { ...membershipData(company, owner), updatedAt: serverTimestamp() });
  batch.set(doc(ref, 'teams', 'general'), { id: 'general', name: '전체', visibility: 'company', memberIds: [], createdBy: user.uid, ...created() });
  await batch.commit(); return company;
}
export async function subscribeCompanyMemberships(session: ModyAuthSession, onChange: (rows: CompanyMembership[]) => void, onError?: ErrorHandler): Promise<Unsubscribe> {
  const { db, user } = await runtime(session);
  return onSnapshot(collection(db, 'users', user.uid, 'companyMemberships'), (snap) => onChange(snap.docs.map((row) => row.data() as CompanyMembership).filter((row) => row.status === 'active')), fail(onError));
}
export async function subscribeCompany(session: ModyAuthSession, companyId: string, onChange: (company: CompanyInfo | null) => void, onError?: ErrorHandler): Promise<Unsubscribe> {
  const { db } = await runtime(session);
  return onSnapshot(doc(db, 'companies', id(companyId)), (snap) => onChange(snap.exists() ? data<CompanyInfo>(snap) : null), fail(onError));
}
export async function subscribeCompanyMembers(session: ModyAuthSession, companyId: string, onChange: (rows: CompanyMember[]) => void, onError?: ErrorHandler): Promise<Unsubscribe> {
  const { db } = await runtime(session);
  return onSnapshot(collection(db, 'companies', id(companyId), 'members'), (snap) => onChange(snap.docs.map((row) => row.data() as CompanyMember)), fail(onError));
}
export async function updateCompanyMember(session: ModyAuthSession, companyId: string, uid: string, patch: { role?: 'admin' | 'member'; status?: 'active' | 'removed' }): Promise<void> {
  const { db, company, member } = await companyAndMember(session, companyId); requireAdmin(member);
  if (uid === company.ownerUid) throw new Error('회사를 만든 관리자는 제거하거나 권한을 바꿀 수 없습니다.');
  if (patch.role) roleValue(patch.role);
  if (patch.status && !['active', 'removed'].includes(patch.status)) throw new Error('직원 상태를 확인해 주세요.');
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'companies', company.id, 'members', id(uid)); const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('회사의 직원을 찾을 수 없습니다.');
    const next = { ...snap.data(), ...patch } as CompanyMember;
    tx.update(ref, { ...patch, ...stamp() });
    tx.set(doc(db, 'users', uid, 'companyMemberships', company.id), { ...membershipData(company, next), updatedAt: serverTimestamp() });
  });
}
async function hashInvite(code: string) {
  const value = clean(code, '초대 코드', 64);
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('초대 코드를 확인해 주세요.');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map((n) => n.toString(16).padStart(2, '0')).join('');
}
export async function createCompanyInvite(session: ModyAuthSession, companyId: string, input: { email?: string; role?: 'admin' | 'member' } = {}): Promise<CompanyInvite> {
  const { db, company, member, user } = await companyAndMember(session, companyId); requireAdmin(member);
  const code = [...crypto.getRandomValues(new Uint8Array(32))].map((n) => n.toString(16).padStart(2, '0')).join(''); const hash = await hashInvite(code);
  // Rules allow at most seven days (+10s) after the server time; keep a small margin.
  const issuedAt = serverNow(); const expiresAtEpochMs = issuedAt + 7 * 86400000 - 5000;
  await setDoc(doc(db, 'companyInvites', hash), { companyId: company.id, companyName: company.name, email: clean(input.email || '', '초대 이메일', 254, true).toLowerCase(), role: roleValue(input.role), status: 'pending', usedBy: '', createdBy: user.uid, createdAtEpochMs: issuedAt, expiresAtEpochMs, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return { code, expiresAtEpochMs };
}
async function acceptInvite(session: ModyAuthSession, code: string, suppliedApp?: FirebaseApp): Promise<CompanyMembership> {
  const { db, user } = await runtime(session, suppliedApp); const hash = await hashInvite(code);
  return runTransaction(db, async (tx) => {
    const inviteRef = doc(db, 'companyInvites', hash); const snap = await tx.get(inviteRef);
    if (!snap.exists()) throw new Error('초대가 없거나 만료되었습니다. 관리자에게 새 초대를 요청하세요.');
    const invite = snap.data();
    if (invite.status !== 'pending' || invite.expiresAtEpochMs <= serverNow() || (invite.email && invite.email !== (user.email || '').toLowerCase())) throw new Error('사용한 초대이거나 계정 이메일이 다릅니다. 초대를 다시 확인해 주세요.');
    const cid = id(invite.companyId); const ref = doc(db, 'companies', cid, 'members', user.uid);
    const member = memberValue(user, roleValue(invite.role), hash);
    const membership: CompanyMembership = { uid: user.uid, companyId: cid, companyName: invite.companyName, role: member.role, status: 'active', updatedAtEpochMs: serverNow() };
    tx.set(ref, { ...member, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    tx.set(doc(db, 'users', user.uid, 'companyMemberships', cid), { ...membership, updatedAt: serverTimestamp() });
    tx.update(inviteRef, { status: 'accepted', usedBy: user.uid, updatedAt: serverTimestamp() });
    return membership;
  });
}
export const acceptCompanyInvite = (session: ModyAuthSession, code: string) => acceptInvite(session, code);
export async function createCompanyEmployee(session: ModyAuthSession, companyId: string, input: { email: string; password: string; displayName: string; role: 'admin' | 'member' }): Promise<CompanyMembership> {
  const current = await companyAndMember(session, companyId); requireAdmin(current.member);
  const email = clean(input.email, '직원 이메일', 254).toLowerCase(); const displayName = clean(input.displayName, '직원 이름', 120); const role = roleValue(input.role);
  if (input.password.length < 8 || input.password.length > 128) throw new Error('처음 사용할 비밀번호를 8~128자로 입력해 주세요.');
  const [{ initializeApp, deleteApp }, { initializeAuth, inMemoryPersistence, createUserWithEmailAndPassword, updateProfile, signOut, deleteUser }] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
  const app = initializeApp(current.app.options, `company-enrollment-${crypto.randomUUID()}`); const auth = initializeAuth(app, { persistence: inMemoryPersistence });
  let newUser: User | undefined; let enrolled = false;
  try {
    newUser = (await createUserWithEmailAndPassword(auth, email, input.password)).user;
    await updateProfile(newUser, { displayName });
    const invite = await createCompanyInvite(session, companyId, { email, role });
    const result = await acceptInvite({ uid: newUser.uid, email, displayName, providerId: 'password', emailVerified: newUser.emailVerified }, invite.code, app);
    enrolled = true; return result;
  } catch (error) {
    if (newUser && !enrolled) {
      try { await deleteUser(newUser); } catch { throw new Error('회사 연결에 실패했고 새 계정도 삭제하지 못했습니다. 생성한 이메일로 로그인한 뒤 관리자에게 초대를 받아 연결해 주세요.'); }
    }
    if ((error as { code?: string })?.code === 'auth/email-already-in-use') throw new Error('이미 가입한 이메일입니다. 직원 생성 대신 기존 계정 초대 코드를 발급해 주세요.');
    throw error;
  } finally {
    await signOut(auth).catch(() => undefined); await deleteApp(app).catch(() => undefined);
  }
}

export async function createCompanyTeam(session: ModyAuthSession, companyId: string, input: TeamInput): Promise<CompanyTeam> {
  const { db, member, user } = await companyAndMember(session, companyId); requireAdmin(member); const ref = doc(collection(db, 'companies', id(companyId), 'teams'));
  const team = { id: ref.id, ...teamValue(input), createdBy: user.uid, createdAtEpochMs: serverNow(), updatedAtEpochMs: serverNow() };
  await setDoc(ref, { ...team, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); return team;
}
export async function updateCompanyTeam(session: ModyAuthSession, companyId: string, teamId: string, input: TeamInput): Promise<void> {
  const { db, member } = await companyAndMember(session, companyId); requireAdmin(member);
  const existing = await getDoc(doc(db, 'companies', id(companyId), 'teams', id(teamId)));
  if (existing.data()?.kind === 'direct') throw new Error('1대1 대화의 참여자는 변경할 수 없습니다.');
  if (teamId === 'general' && input.visibility !== 'company') throw new Error('전체 팀은 모든 직원에게 열려 있어야 합니다.');
  await updateDoc(doc(db, 'companies', id(companyId), 'teams', id(teamId)), { ...teamValue(input), ...stamp() });
}
export async function subscribeCompanyTeams(session: ModyAuthSession, companyId: string, onChange: (rows: CompanyTeam[]) => void, onError?: ErrorHandler): Promise<Unsubscribe> {
  const { db, member, user } = await companyAndMember(session, companyId); const ref = collection(db, 'companies', id(companyId), 'teams');
  const selected = ['owner', 'admin'].includes(member.role) ? query(ref) : query(ref, or(where('visibility', '==', 'company'), where('memberIds', 'array-contains', user.uid)));
  return onSnapshot(selected, (snap) => onChange(snap.docs.map((row) => data<CompanyTeam>(row))), fail(onError));
}
/**
 * `member` may be the caller's already-subscribed member record; it only saves two reads.
 * The rules still re-check membership and the author name on the server.
 */
export async function sendCompanyMessage(session: ModyAuthSession, companyId: string, teamId: string, input: string | { text: string; kind?: 'human' | 'personal_ai'; requestText?: string }, options: { isCurrent?: () => boolean; member?: CompanyMember } = {}): Promise<CompanyMessage> {
  const known = options.member?.uid === session.uid && options.member.status === 'active' && options.member.displayName ? options.member : undefined;
  const { db, user, member } = known ? { ...(await runtime(session)), member: known } : await companyAndMember(session, companyId);
  const value = typeof input === 'string' ? { text: input } : input; const kind = value.kind || 'human';
  if (!['human', 'personal_ai'].includes(kind)) throw new Error('회사 AI 응답은 지정된 메인 PC만 기록할 수 있습니다.');
  const ref = doc(collection(db, 'companies', id(companyId), 'teams', id(teamId), 'messages'));
  const local = Date.now();
  const message: CompanyMessage = { id: ref.id, authorUid: user.uid, authorName: member.displayName, kind, text: clean(value.text, '메시지', kind === 'human' ? 6000 : 16000), requestText: clean(value.requestText || '', 'AI 요청', 6000, true), requestId: '', createdAtEpochMs: companyClock.toServer(local) };
  if (kind === 'personal_ai' && options.isCurrent?.() === false) throw new Error('회사 또는 팀이 바뀌어 개인 AI 결과를 게시하지 않았습니다.');
  companyClock.expectOwnWrite(`msg:${ref.id}`, local);
  await setDoc(ref, { ...message, createdAt: serverTimestamp() }); return message;
}
const messageRows = (rows: DocumentSnapshot<DocumentData>[]) => rows.map((row) => {
  const value = row.data() || {};
  const serverCreated = serverMillis(value.createdAt);
  if (serverCreated) companyClock.observeOwnWrite(`msg:${row.id}`, serverCreated);
  return { ...data<CompanyMessage>(row), ...(row.metadata.hasPendingWrites ? { pending: true } : {}) };
});
export async function subscribeCompanyMessages(session: ModyAuthSession, companyId: string, teamId: string, onChange: (rows: CompanyMessage[]) => void, onError?: ErrorHandler): Promise<Unsubscribe> {
  const { db } = await runtime(session);
  return onSnapshot(query(collection(db, 'companies', id(companyId), 'teams', id(teamId), 'messages'), orderBy('createdAtEpochMs', 'desc'), limit(60)), (snap) => onChange(messageRows(snap.docs).reverse()), fail(onError));
}
/** Older team messages before the live window, oldest first. Ties at the boundary are de-duplicated by the caller. */
export async function loadOlderCompanyMessages(session: ModyAuthSession, companyId: string, teamId: string, beforeEpochMs: number, count = 40): Promise<CompanyMessage[]> {
  const { db } = await runtime(session);
  if (!Number.isFinite(beforeEpochMs) || beforeEpochMs <= 0) return [];
  const snap = await getDocs(query(collection(db, 'companies', id(companyId), 'teams', id(teamId), 'messages'), where('createdAtEpochMs', '<=', beforeEpochMs), orderBy('createdAtEpochMs', 'desc'), limit(Math.min(100, Math.max(1, count)))));
  return snap.docs.map((row) => data<CompanyMessage>(row)).reverse();
}
/** Only the newest message of one team: enough for unread marks and notifications. */
export async function subscribeLatestCompanyMessage(session: ModyAuthSession, companyId: string, teamId: string, onChange: (message: CompanyMessage | null) => void, onError?: ErrorHandler): Promise<Unsubscribe> {
  const { db } = await runtime(session);
  return onSnapshot(query(collection(db, 'companies', id(companyId), 'teams', id(teamId), 'messages'), orderBy('createdAtEpochMs', 'desc'), limit(1)), (snap) => onChange(snap.docs[0] ? data<CompanyMessage>(snap.docs[0]) : null), fail(onError));
}
export async function saveCompanyResource(session: ModyAuthSession, companyId: string, teamId: string, input: { id?: string; kind: 'material' | 'work_note'; title: string; text: string }): Promise<void> {
  const { db, user, member } = await companyAndMember(session, companyId); if (!['material', 'work_note'].includes(input.kind)) throw new Error('공유 자료 유형을 확인해 주세요.');
  const group = collection(db, 'companies', id(companyId), 'teams', id(teamId), 'resources'); const ref = input.id ? doc(group, id(input.id)) : doc(group);
  const values = { kind: input.kind, title: clean(input.title, '자료 제목', 200), text: clean(input.text, '공유 내용', 20000), ...stamp() };
  if (input.id) await updateDoc(ref, values);
  else await setDoc(ref, { ...values, id: ref.id, authorUid: user.uid, authorName: member.displayName, createdAt: serverTimestamp(), createdAtEpochMs: serverNow() });
}
/**
 * Puts one finished piece of work (a report, a document, a mail excerpt, a company-operation result)
 * into a team's shared materials, where teammates and the company AI can read it.
 * Callers show the exact title, text and announcement first (lib/team-share.mjs) and pass
 * those same values after the person confirms; nothing here adds to what leaves the PC.
 * The shared material is saved first; the optional one-line chat notice follows it.
 */
export async function shareToTeam(session: ModyAuthSession, companyId: string, teamId: string, input: { title: string; text: string; announcement?: string }): Promise<{ announced: boolean; announceError?: string }> {
  if (input.text.length > 20000) throw new Error('공유 내용을 20000자 이내로 확인해 주세요.');
  await saveCompanyResource(session, companyId, teamId, { kind: 'material', title: input.title, text: input.text });
  const announcement = (input.announcement || '').trim();
  if (!announcement) return { announced: false };
  try {
    await sendCompanyMessage(session, companyId, teamId, announcement);
    return { announced: true };
  } catch (error) {
    return { announced: false, announceError: error instanceof Error ? error.message : String(error) };
  }
}
export async function deleteCompanyResource(session: ModyAuthSession, companyId: string, teamId: string, resourceId: string): Promise<void> {
  const { db } = await runtime(session); await deleteDoc(doc(db, 'companies', id(companyId), 'teams', id(teamId), 'resources', id(resourceId)));
}
export async function subscribeCompanyResources(session: ModyAuthSession, companyId: string, teamId: string, onChange: (rows: CompanyResource[]) => void, onError?: ErrorHandler): Promise<Unsubscribe> {
  const { db } = await runtime(session);
  return onSnapshot(query(collection(db, 'companies', id(companyId), 'teams', id(teamId), 'resources'), orderBy('updatedAtEpochMs', 'desc'), limit(50)), (snap) => onChange(snap.docs.map((row) => data<CompanyResource>(row))), fail(onError));
}
/** Shared resources older than the live list (newest first). The caller removes duplicates by id. */
export async function loadMoreCompanyResources(session: ModyAuthSession, companyId: string, teamId: string, beforeUpdatedAtEpochMs: number, count = 50): Promise<CompanyResource[]> {
  const { db } = await runtime(session);
  if (!Number.isFinite(beforeUpdatedAtEpochMs) || beforeUpdatedAtEpochMs <= 0) return [];
  const snap = await getDocs(query(collection(db, 'companies', id(companyId), 'teams', id(teamId), 'resources'), where('updatedAtEpochMs', '<=', beforeUpdatedAtEpochMs), orderBy('updatedAtEpochMs', 'desc'), limit(Math.min(100, Math.max(1, count)))));
  return snap.docs.map((row) => data<CompanyResource>(row));
}
function hostValue(companyId: string, snap: DocumentSnapshot<DocumentData>): CompanyHost | null {
  if (!snap.exists()) return null;
  const value = snap.data();
  const serverUpdatedAtEpochMs = serverMillis(value.updatedAt);
  // A heartbeat this device stamped has come back with the server's time for the same write.
  if (serverUpdatedAtEpochMs) companyClock.observeOwnWrite(`host:${companyId}:${value.updatedAtEpochMs}`, serverUpdatedAtEpochMs);
  return { ...value, heartbeatAtEpochMs: serverMillis(value.heartbeatAt), serverUpdatedAtEpochMs } as CompanyHost;
}
export async function subscribeCompanyHost(session: ModyAuthSession, companyId: string, onChange: (host: CompanyHost | null) => void, onError?: ErrorHandler): Promise<Unsubscribe> {
  const { db } = await runtime(session); const cid = id(companyId);
  let previousHeartbeat: number | undefined;
  return onSnapshot(doc(db, 'companies', cid, 'settings', 'host'), (snap) => {
    const host = hostValue(cid, snap);
    const heartbeat = host?.heartbeatAtEpochMs || 0;
    // Only a live update of a new heartbeat says "the server wrote this just now".
    if (previousHeartbeat !== undefined && heartbeat && heartbeat !== previousHeartbeat) companyClock.observeArrival(heartbeat);
    previousHeartbeat = heartbeat;
    onChange(host);
  }, fail(onError));
}
/** One read of the main-PC setting, for deciding whether this account needs to watch it at all. */
export async function readCompanyHost(session: ModyAuthSession, companyId: string): Promise<CompanyHost | null> {
  const { db } = await runtime(session); const cid = id(companyId);
  return hostValue(cid, await getDoc(doc(db, 'companies', cid, 'settings', 'host')));
}
export async function saveCompanyHost(session: ModyAuthSession, companyId: string, input: Pick<CompanyHost, 'uid' | 'deviceId' | 'label' | 'enabled'>): Promise<void> {
  const { db, member } = await companyAndMember(session, companyId); requireAdmin(member);
  await setDoc(doc(db, 'companies', id(companyId), 'settings', 'host'), { uid: id(input.uid), deviceId: id(input.deviceId), label: clean(input.label, '메인 PC 이름', 160), enabled: input.enabled === true, heartbeatAtEpochMs: 0, heartbeatAt: null, ...stamp() });
}
export async function heartbeatCompanyHost(session: ModyAuthSession, companyId: string, deviceId: string): Promise<void> {
  const { db, user } = await runtime(session); const cid = id(companyId); const ref = doc(db, 'companies', cid, 'settings', 'host');
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref); const host = snap.data(); if (!host?.enabled || host.uid !== user.uid || host.deviceId !== deviceId) throw new Error('이 기기는 회사 메인 PC로 지정되지 않았습니다.');
    const local = Date.now(); const stamped = companyClock.toServer(local);
    companyClock.expectOwnWrite(`host:${cid}:${stamped}`, local);
    tx.update(ref, { heartbeatAt: serverTimestamp(), heartbeatAtEpochMs: stamped, updatedAt: serverTimestamp(), updatedAtEpochMs: stamped });
  });
}
async function hasPendingAIRequest(db: ReturnType<typeof getFirestore>, companyId: string, uid: string) {
  const slot = await getDoc(doc(db, 'companies', companyId, 'aiRequestSlots', uid));
  const requestId = slot.exists() ? String(slot.data().requestId || '') : '';
  if (!requestId) return false;
  try {
    const previous = await getDoc(doc(db, 'companies', companyId, 'aiRequests', id(requestId)));
    return !previous.exists() || ['queued', 'running'].includes(String(previous.data().status));
  } catch (error) {
    // A request in a team the user has since left can no longer be read; the slot still holds it.
    if (isPermissionDenied(error)) return true;
    throw error;
  }
}
export async function enqueueCompanyAIRequest(session: ModyAuthSession, companyId: string, teamId: string, text: string, options: { isCurrent: () => boolean }): Promise<CompanyAIRequest> {
  const assertCurrent = (auth?: ReturnType<typeof getAuth>) => {
    if (!options?.isCurrent?.() || (auth && auth.currentUser?.uid !== session.uid)) {
      throw Object.assign(new Error('회사 또는 계정이 바뀌었습니다. 요청 상태를 이전 회사에서 확인해 주세요.'), { code: 'company/context-changed' });
    }
  };
  assertCurrent();
  const { db, auth, user, member } = await companyAndMember(session, companyId);
  assertCurrent(auth);
  const host = await getDoc(doc(db, 'companies', id(companyId), 'settings', 'host'));
  assertCurrent(auth);
  const team = await getDoc(doc(db, 'companies', id(companyId), 'teams', id(teamId)));
  assertCurrent(auth);
  if (team.data()?.kind === 'direct') throw new Error('1대1 대화에서는 내 PC의 개인 AI를 선택해 주세요. 회사 메인 PC에는 대화가 전달되지 않습니다.');
  if (!host.exists() || !host.data().enabled) throw new Error('관리자가 회사 메인 PC를 지정한 뒤 회사 AI를 사용할 수 있습니다.');
  const ref = doc(collection(db, 'companies', id(companyId), 'aiRequests')); const now = serverNow();
  const request: CompanyAIRequest = { id: ref.id, teamId: id(teamId), requesterUid: user.uid, requesterName: member.displayName, text: clean(text, 'AI 요청', 6000), status: 'queued', hostUid: '', hostDeviceId: '', claimId: '', leaseExpiresAtEpochMs: 0, attempts: 0, outputText: '', errorMessage: '', createdAtEpochMs: now, updatedAtEpochMs: now };
  try {
    assertCurrent(auth);
    await runTransaction(db, async (tx) => {
      assertCurrent(auth);
      const slotRef = doc(db, 'companies', id(companyId), 'aiRequestSlots', user.uid);
      // Serialize requests without rereading a former private team's contents after removal.
      await tx.get(slotRef);
      assertCurrent(auth);
      tx.set(ref, { ...request, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      tx.set(slotRef, { requestId: ref.id, ...stamp() });
    });
  } catch (error) {
    if (!options.isCurrent() || auth.currentUser?.uid !== session.uid) {
      if ((error as {code?: string})?.code === 'company/context-changed') throw error;
      throw Object.assign(new Error('회사 또는 계정이 바뀌었습니다. 전송이 이미 시작된 요청의 최종 상태를 이전 회사에서 확인해 주세요.'), { code: 'company/ai-request-outcome-unknown', cause: error });
    }
    // The rules keep one open request per person; say so instead of "no permission".
    if (isPermissionDenied(error)) {
      const pending = await hasPendingAIRequest(db, id(companyId), user.uid).catch(() => false);
      if (!options.isCurrent() || auth.currentUser?.uid !== session.uid) {
        throw Object.assign(new Error('회사 또는 계정이 바뀌었습니다. 이전 회사에서 요청 상태를 확인해 주세요.'), { code: 'company/ai-request-outcome-unknown', cause: error });
      }
      if (pending) throw Object.assign(new Error(COMPANY_AI_PENDING_MESSAGE), { code: 'company/ai-request-pending' });
    }
    throw error;
  }
  if (!options.isCurrent() || auth.currentUser?.uid !== session.uid) {
    throw Object.assign(new Error('이전 회사에 요청이 등록된 뒤 회사 또는 계정이 바뀌었습니다. 이전 회사에서 처리 상태를 확인해 주세요.'), { code: 'company/ai-request-committed-after-switch' });
  }
  return request;
}
export async function subscribeCompanyAIRequests(session: ModyAuthSession, companyId: string, teamId: string, onChange: (rows: CompanyAIRequest[]) => void, onError?: ErrorHandler): Promise<Unsubscribe> {
  const { db } = await runtime(session);
  return onSnapshot(query(collection(db, 'companies', id(companyId), 'aiRequests'), where('teamId', '==', id(teamId)), orderBy('createdAtEpochMs', 'desc'), limit(30)), (snap) => onChange(snap.docs.map((row) => data<CompanyAIRequest>(row))), fail(onError));
}
export async function subscribeCompanyAIQueue(session: ModyAuthSession, companyId: string, onChange: (rows: CompanyAIRequest[]) => void, onError?: ErrorHandler): Promise<Unsubscribe> {
  const { db } = await runtime(session);
  return onSnapshot(query(collection(db, 'companies', id(companyId), 'aiRequests'), where('status', 'in', ['queued', 'running']), limit(100)), (snap) => onChange(snap.docs.map((row) => data<CompanyAIRequest>(row)).sort((a, b) => a.createdAtEpochMs - b.createdAtEpochMs)), fail(onError));
}
async function claimReferences(session: ModyAuthSession, companyId: string, requestId: string, deviceId: string) {
  const { db, user } = await runtime(session); const cid = id(companyId);
  return { db, user, cid, deviceId: id(deviceId), ref: doc(db, 'companies', cid, 'aiRequests', id(requestId)), hostRef: doc(db, 'companies', cid, 'settings', 'host') };
}
export async function claimCompanyAIRequest(session: ModyAuthSession, companyId: string, requestId: string, deviceId: string): Promise<CompanyAIRequest | null> {
  const { db, user, cid, ref, hostRef } = await claimReferences(session, companyId, requestId, deviceId);
  return runTransaction(db, async (tx) => {
    const [snap, hostSnap] = await Promise.all([tx.get(ref), tx.get(hostRef)]); if (!snap.exists()) return null;
    const current = data<CompanyAIRequest>(snap); const host = hostSnap.data(); const now = serverNow();
    if (!host?.enabled || host.uid !== user.uid || host.deviceId !== deviceId) throw new Error('이 기기는 회사 메인 PC가 아닙니다.');
    if (current.status !== 'queued' && !(current.status === 'running' && current.leaseExpiresAtEpochMs <= now)) return null;
    const [member, team] = await Promise.all([tx.get(doc(db, 'companies', cid, 'members', current.requesterUid)), tx.get(doc(db, 'companies', cid, 'teams', current.teamId))]);
    const revoked = member.data()?.status !== 'active' || !team.exists() || !teamAccess(data<CompanyTeam>(team), current.requesterUid);
    if (revoked || current.attempts >= 3) {
      tx.update(ref, { status: 'failed', outputText: '', errorMessage: revoked ? '요청자의 회사 또는 팀 권한이 변경되어 실행하지 않았습니다.' : '메인 PC 연결이 반복해서 끊겼습니다. 연결을 확인한 뒤 새 요청을 보내 주세요.', ...stamp() }); return null;
    }
    // The rules accept a lease of at most server time + 185s; keep a margin below that.
    const next = { ...current, status: 'running' as const, hostUid: user.uid, hostDeviceId: deviceId, claimId: crypto.randomUUID(), leaseExpiresAtEpochMs: now + COMPANY_AI_LEASE_MS - 2000, attempts: current.attempts + 1, updatedAtEpochMs: now };
    tx.update(ref, { status: next.status, hostUid: next.hostUid, hostDeviceId: next.hostDeviceId, claimId: next.claimId, leaseExpiresAtEpochMs: next.leaseExpiresAtEpochMs, attempts: next.attempts, updatedAt: serverTimestamp(), updatedAtEpochMs: now }); return next;
  });
}
export async function renewCompanyAIClaim(session: ModyAuthSession, companyId: string, requestId: string, deviceId: string, claimId: string): Promise<void> {
  const { db, user, ref } = await claimReferences(session, companyId, requestId, deviceId);
  await runTransaction(db, async (tx) => { const snap = await tx.get(ref); const request = snap.data(); const now = serverNow(); if (!request || request.status !== 'running' || request.claimId !== claimId || request.hostUid !== user.uid || request.hostDeviceId !== deviceId || request.leaseExpiresAtEpochMs <= now) throw new Error('회사 AI 실행 권한이 만료되었습니다.'); tx.update(ref, { leaseExpiresAtEpochMs: now + COMPANY_AI_LEASE_MS - 2000, updatedAt: serverTimestamp(), updatedAtEpochMs: now }); });
}
export async function completeCompanyAIRequest(session: ModyAuthSession, companyId: string, requestId: string, deviceId: string, claimId: string, result: { outputText?: string; errorMessage?: string }): Promise<void> {
  const { db, user, cid, ref } = await claimReferences(session, companyId, requestId, deviceId);
  const outputText = clean(result.outputText || '', 'AI 결과', 16000, true); const errorMessage = clean(result.errorMessage || '', '오류 안내', 1000, true);
  if (!outputText && !errorMessage) throw new Error('AI 결과 또는 오류 안내가 필요합니다.');
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref); const request = snap.data() as CompanyAIRequest | undefined;
    if (!request || request.status !== 'running' || request.claimId !== claimId || request.hostUid !== user.uid || request.hostDeviceId !== deviceId || request.leaseExpiresAtEpochMs <= serverNow()) throw new Error('회사 AI 실행 권한이 만료되었습니다. 결과를 게시하지 않았습니다.');
    const status = errorMessage ? 'failed' : 'completed';
    tx.update(ref, { status, outputText: errorMessage ? '' : outputText, errorMessage, ...stamp() });
    if (status === 'completed') tx.set(doc(db, 'companies', cid, 'teams', request.teamId, 'messages', `ai-${requestId}`), { id: `ai-${requestId}`, authorUid: user.uid, authorName: '회사 AI', kind: 'company_ai', text: outputText, requestText: request.text, requestId, createdAtEpochMs: serverNow(), createdAt: serverTimestamp() });
  });
}
/** The requester, an admin or the main PC may close a waiting request (the main PC uses its own message). */
export async function cancelCompanyAIRequest(session: ModyAuthSession, companyId: string, requestId: string, errorMessage = '요청을 취소했습니다.'): Promise<void> {
  const { db } = await runtime(session);
  await updateDoc(doc(db, 'companies', id(companyId), 'aiRequests', id(requestId)), { status: 'failed', outputText: '', errorMessage: clean(errorMessage, '오류 안내', 1000), ...stamp() });
}
export async function cancelMyCompanyAIRequest(session: ModyAuthSession, companyId: string): Promise<void> {
  const { db, user } = await runtime(session);
  const slot = await getDoc(doc(db, 'companies', id(companyId), 'aiRequestSlots', user.uid));
  if (!slot.exists()) throw new Error('처리 중인 회사 AI 요청이 없습니다.');
  await cancelCompanyAIRequest(session, companyId, slot.data().requestId);
}
export async function readCompanyAIContext(session: ModyAuthSession, companyId: string, request: Pick<CompanyAIRequest, 'teamId' | 'requesterUid' | 'text'>): Promise<CompanyAIContext> {
  const { db } = await runtime(session); const cid = id(companyId); const tid = id(request.teamId);
  const [member, team] = await Promise.all([getDoc(doc(db, 'companies', cid, 'members', id(request.requesterUid))), getDoc(doc(db, 'companies', cid, 'teams', tid))]);
  if (member.data()?.status !== 'active' || !team.exists() || !teamAccess(data<CompanyTeam>(team), request.requesterUid)) throw new Error('요청자의 회사 또는 팀 접근 권한이 바뀌었습니다.');
  const readResources = (teamId: string) => getDocs(query(collection(db, 'companies', cid, 'teams', teamId, 'resources'), orderBy('updatedAtEpochMs', 'desc'), limit(50)));
  const [messages, resources, general] = await Promise.all([getDocs(query(collection(db, 'companies', cid, 'teams', tid, 'messages'), orderBy('createdAtEpochMs', 'desc'), limit(60))), readResources(tid), tid === 'general' ? Promise.resolve(null) : readResources('general')]);
  const shared = [...resources.docs.map((row) => data<CompanyResource>(row)), ...(general?.docs.map((row) => data<CompanyResource>(row)) || [])];
  return { messages: messages.docs.map((row) => data<CompanyMessage>(row)).reverse(), resources: [...new Map(shared.map((row) => [row.id, row])).values()].sort((a, b) => b.updatedAtEpochMs - a.updatedAtEpochMs).slice(0, 50) };
}
