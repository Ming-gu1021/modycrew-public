'use client';

import Link from 'next/link';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { onAuthSession, type ModyAuthSession } from '@/lib/firebase-client';
import { getCurrentDeviceProfile } from '@/lib/account-device-sync';
import { requestWorkspaceAI } from '@/lib/company-ai';
import { isCompanyHostOnline } from '@/lib/company-context.mjs';
import { clockSkewNotice, companyClock } from '@/lib/company-clock.mjs';
import { describeCompanyHostIssue, readCompanyHostStatus, subscribeCompanyHostStatus, type CompanyHostIssue } from '@/lib/company-host-status.mjs';
import { COMPANY_SEEN_EVENT, markCompanyTeamSeen } from '@/lib/company-unread.mjs';
import { companyAuthorBadge, mergeCompanyMessages, PERSONAL_AI_NOTE, visibleCompanyRequests } from '@/lib/company-view.mjs';
import {
  acceptCompanyInvite, cancelCompanyAIRequest, cancelMyCompanyAIRequest, createCompany, createCompanyEmployee, createCompanyInvite,
  createCompanyTeam, deleteCompanyResource, loadMoreCompanyResources, loadOlderCompanyMessages, saveCompanyHost, saveCompanyResource,
  sendCompanyMessage, recoverCompanyConnection, subscribeCompany, subscribeCompanyAIRequests,
  subscribeCompanyHost, subscribeCompanyMembers, subscribeCompanyMemberships,
  subscribeCompanyMessages, subscribeCompanyResources, subscribeCompanyTeams,
  updateCompanyMember, updateCompanyTeam,
} from '@/lib/company-client';
import type {
  CompanyAIRequest, CompanyHost, CompanyInfo, CompanyMember, CompanyMembership,
  CompanyMessage, CompanyResource, CompanyTeam,
} from '@/lib/company-types';
import { DriveLinkComposer, SafeLinkText } from './TeamResourceTools';
import { openWorkspaceFiles } from '@/lib/workspace-side-pane';
import CompanyConversationPicker from './CompanyConversationPicker';
import CompanyTaskBoard from './CompanyTaskBoard';
import CompanyFileShelf from './CompanyFileShelf';
import CompanyToday from './CompanyToday';
import CompanyHome from './CompanyHome';
import { suggestDueDate } from '@/lib/company-agenda';
import { startCompanyConversation } from '@/lib/company-collaboration';
import styles from './CompanyWorkspace.module.css';

type Tab = 'home' | 'chat' | 'resources' | 'tasks' | 'agenda' | 'files' | 'members' | 'ai';
type AIMode = 'company' | 'personal';
const tabs: { id: Tab; label: string }[] = [
  { id: 'home', label: '홈' }, { id: 'chat', label: '대화' }, { id: 'tasks', label: '업무 지시' }, { id: 'agenda', label: '업무 일정' }, { id: 'files', label: '공유 파일' }, { id: 'resources', label: '자료·메일' },
  { id: 'members', label: '구성원과 팀' }, { id: 'ai', label: 'AI 연결' },
];
const MESSAGE_PAGE = 40;
const RESOURCE_PAGE = 50;
const roleLabel = (role: string) => role === 'owner' ? '회사 소유자' : role === 'admin' ? '관리자' : '멤버';
function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  // A PC clock that is off by a minute or more is rejected by the server as "no permission".
  if (/permission-denied|insufficient permissions|permission denied/i.test(code + ' ' + message)) return clockSkewNotice(companyClock.skewMs()) || '이 회사 또는 팀에 접근할 권한이 없습니다. 관리자에게 소속과 팀 참여 상태를 확인해 주세요.';
  if (/unauthenticated|auth\//i.test(code)) return '계정 연결을 다시 확인해 주세요. 로그인한 뒤 회사에 다시 연결할 수 있습니다.';
  if (/unavailable|network|failed to fetch|offline/i.test(code + ' ' + message)) return '회사에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.';
  return message || '처리하지 못했습니다. 다시 시도해 주세요.';
}
const resourceKindLabel = (kind: CompanyResource['kind']) => kind === 'material' ? '공유한 결과·자료' : '업무 노트';
const timeLabel = (value?: number) => value ? new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
function safeStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

const AVATAR_TONES = 4;
/** Stable avatar colour per person; only brand and neutral tokens, never status colours. */
function avatarTone(seed: string) {
  let value = 0;
  for (let index = 0; index < seed.length; index += 1) value = (value * 31 + seed.charCodeAt(index)) % 9973;
  return String(value % AVATAR_TONES);
}
function initialOf(name: string) {
  return (Array.from(name.trim())[0] || '?').toUpperCase();
}
const dayKeyOf = (value: number) => { const date = new Date(value); return date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate(); };
/** Day separators in the conversation: 오늘 · 어제 · 11월 2일 (일). */
function dayLabel(value: number, now: number) {
  if (dayKeyOf(value) === dayKeyOf(now)) return '오늘';
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (dayKeyOf(value) === dayKeyOf(yesterday.getTime())) return '어제';
  const date = new Date(value);
  return date.toLocaleDateString('ko-KR', date.getFullYear() === new Date(now).getFullYear() ? { month: 'long', day: 'numeric', weekday: 'short' } : { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}
const clockLabel = (value?: number) => value ? new Date(value).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' }) : '';
type IconName = 'hash' | 'lock' | 'more' | 'chevron' | 'sparkles' | 'send' | 'userPlus' | 'alert' | 'back' | 'task' | 'bell' | 'chat';
const ICON_PATHS: Record<IconName, string> = {
  hash: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18',
  lock: 'M7 11V7a5 5 0 0 1 10 0v4M6 11h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  chevron: 'm6 9 6 6 6-6',
  sparkles: 'M9.9 15.5a2 2 0 0 0-1.4-1.4l-6.1-1.6a.5.5 0 0 1 0-1l6.1-1.6a2 2 0 0 0 1.4-1.4l1.6-6.1a.5.5 0 0 1 1 0l1.6 6.1a2 2 0 0 0 1.4 1.4l6.1 1.6a.5.5 0 0 1 0 1l-6.1 1.6a2 2 0 0 0-1.4 1.4l-1.6 6.1a.5.5 0 0 1-1 0zM20 3v4M22 5h-4',
  send: 'm5 12 7-7 7 7M12 19V5',
  userPlus: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6',
  alert: 'm21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3zM12 9v4M12 17h.01',
  back: 'm12 19-7-7 7-7M19 12H5',
  task: 'M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M12 11h4M12 16h4M8 11h.01M8 16h.01',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
};
function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return <svg className={styles.icon} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 3 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={ICON_PATHS[name]} /></svg>;
}

export default function CompanyWorkspace() {
  const [session, setSession] = useState<ModyAuthSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [memberships, setMemberships] = useState<CompanyMembership[]>([]);
  const [membershipsLoaded, setMembershipsLoaded] = useState(false);
  const [companyId, setCompanyId] = useState('');
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [members, setMembers] = useState<CompanyMember[]>([]);
  const [teams, setTeams] = useState<CompanyTeam[]>([]);
  const [teamId, setTeamId] = useState('general');
  const [messages, setMessages] = useState<CompanyMessage[]>([]);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [olderMessages, setOlderMessages] = useState<CompanyMessage[]>([]);
  const [olderState, setOlderState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [resources, setResources] = useState<CompanyResource[]>([]);
  const [olderResources, setOlderResources] = useState<CompanyResource[]>([]);
  const [moreResourcesState, setMoreResourcesState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [requests, setRequests] = useState<CompanyAIRequest[]>([]);
  const [host, setHost] = useState<CompanyHost | null>(null);
  const [hostIssue, setHostIssue] = useState<CompanyHostIssue | null>(null);
  const [tab, setTab] = useState<Tab>('chat');
  const [busy, setBusy] = useState('');
  const [conversationPicker,setConversationPicker]=useState(false);
  const [taskSeed,setTaskSeed]=useState('');const [taskSeedDue,setTaskSeedDue]=useState('');
  const [aiPending, setAIPending] = useState<Record<string, { mode: AIMode; requestId: number }>>({});
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [newEmployee, setNewEmployee] = useState({ displayName: '', email: '', password: '', role: 'member' as 'member' | 'admin' });
  const [inviteEmail, setInviteEmail] = useState('');
  const [issuedInvite, setIssuedInvite] = useState<{ code: string; expiresAtEpochMs: number } | null>(null);
  const [editingTeamId, setEditingTeamId] = useState('');
  const [teamName, setTeamName] = useState('');
  const [teamMemberIds, setTeamMemberIds] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [, setFailedDraftRevision] = useState(0);
  const [aiMode, setAIMode] = useState<AIMode>('company');
  const [note, setNote] = useState({ id: '', title: '', text: '' });
  // Editing keeps what the resource was (a shared report stays a shared material).
  const [noteKind, setNoteKind] = useState<CompanyResource['kind']>('work_note');
  const [resourceQuery, setResourceQuery] = useState('');
  const [resourceKind, setResourceKind] = useState<'all' | CompanyResource['kind']>('all');
  const [confirmRemove, setConfirmRemove] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [connectionBlocked, setConnectionBlocked] = useState(false);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [authRevision, setAuthRevision] = useState(0);
  const [companyRevision, setCompanyRevision] = useState(0);
  const [teamRevision, setTeamRevision] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [device, setDevice] = useState<ReturnType<typeof getCurrentDeviceProfile> | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<string>('unsupported');
  const generation = useRef(0);
  const authGeneration = useRef(0);
  // Changes only when the company, the account or the access state changes (not on team switch).
  const companyGeneration = useRef(0);
  const aiRequestSequence = useRef(0);
  const reconnectSequence = useRef(0);
  const reconnectingRef = useRef(false);
  const aiPendingRef = useRef<Record<string, { mode: AIMode; requestId: number }>>({});
  const blocked = useRef(false);
  const currentScope = useRef('');
  const currentIdentity = useRef({ uid: '', companyId: '', teamId: '' });
  const conversationRef = useRef<HTMLDivElement>(null);
  const followsConversation = useRef(true);
  const previousMessageIds = useRef<string[]>([]);
  const conversationPosition = useRef(0);
  const restoreFromBottom = useRef<number | null>(null);
  // Unsent text per team of the current company; cleared whenever the company changes.
  const drafts = useRef<Record<string, string>>({});
  // In-memory only. Kept separately so a failed send cannot replace newer typing.
  const failedDrafts = useRef<Record<string, { id: number; text: string; kind: 'message' | 'company_ai' | 'personal_ai' }[]>>({});
  const failedDraftSequence = useRef(0);
  // A failed access check is not proof that reconnect restored the same rights.
  const lockedRecoveryScopes = useRef(new Set<string>());
  // A notification click opens /company?company=…&team=… on that conversation.
  const pendingTarget = useRef({ companyId: '', teamId: '', forCompany: '' });
  currentScope.current = `${session?.uid || ''}:${companyId}:${teamId}`;
  currentIdentity.current = { uid: session?.uid || '', companyId, teamId };
  const membership = memberships.find((item) => item.companyId === companyId && item.status === 'active');
  const isAdmin = membership?.role === 'owner' || membership?.role === 'admin';
  const activeMembers = members.filter((item) => item.status === 'active');
  const selfMember = activeMembers.find((item) => item.uid === session?.uid);
  const availableTeams = teams.filter((item) => item.visibility === 'company' || item.memberIds.includes(session?.uid || ''));
  const selectedTeam = availableTeams.find((item) => item.id === teamId);
  const direct = selectedTeam?.kind === 'direct';
  const teamLabel=(team:CompanyTeam)=>team.kind==='direct'?'1대1 · '+(activeMembers.find(m=>m.uid!==session?.uid&&team.memberIds.includes(m.uid))?.displayName||team.name):team.name;
  useEffect(()=>{if(direct)setAIMode('personal');},[direct]);
  function openConversation(team:CompanyTeam){setTeams(rows=>rows.some(t=>t.id===team.id)?rows:[...rows,team]);chooseTeam(team.id);setTab('chat');setConversationPicker(false);}
  const skew = companyClock.skewMs();
  // heartbeatAt is server time; compare it with this PC's clock corrected by the skew seen so far.
  const online = isCompanyHostOnline(host, now - (skew ?? 0));
  const companyLabel = company?.name || membership?.companyName || '우리 회사';
  const displayMessages = olderMessages.length ? mergeCompanyMessages(olderMessages, messages) : messages;
  const liveResourceIds = new Set(resources.map((item) => item.id));
  const displayResources = [...resources, ...olderResources.filter((item) => !liveResourceIds.has(item.id))];
  const resourceSearch = resourceQuery.trim().toLowerCase();
  const filteringResources = Boolean(resourceSearch) || resourceKind !== 'all';
  const shownResources = filteringResources ? displayResources.filter((item) => (resourceKind === 'all' || item.kind === resourceKind) && (!resourceSearch || item.title.toLowerCase().includes(resourceSearch))) : displayResources;
  const shownRequests = visibleCompanyRequests(requests, displayMessages, now);
  const aiPendingHere = aiPending[JSON.stringify([session?.uid || '', companyId, teamId])] || null;
  const thisDeviceHosts = Boolean(host?.enabled && device && host.uid === session?.uid && host.deviceId === device.id);
  const hostIssueText = thisDeviceHosts ? describeCompanyHostIssue(hostIssue, skew) : '';
  const draftKey = JSON.stringify([session?.uid || '', companyId, teamId]);

  function updateDraft(value: string) {
    drafts.current[draftKey] = value;
    setDraft(value);
  }
  function rememberFailedText(key: string, text: string, kind: 'message' | 'company_ai' | 'personal_ai') {
    if (!drafts.current[key]) drafts.current[key] = text;
    const previous = failedDrafts.current[key] || [];
    failedDrafts.current[key] = [...previous, { id: ++failedDraftSequence.current, text, kind }];
    setFailedDraftRevision((value) => value + 1);
  }
  function resetForms(keepDraft = false) {
    setConversationPicker(false); setTaskSeed('');
    setBusy(''); setNotice(null); setIssuedInvite(null); setInviteCode(''); setInviteEmail('');
    setNewEmployee({ displayName: '', email: '', password: '', role: 'member' });
    if (!keepDraft) setDraft('');
    setNote({ id: '', title: '', text: '' }); setConfirmRemove(''); setConfirmDelete('');
    setEditingTeamId(''); setTeamName(''); setTeamMemberIds([]);
    followsConversation.current = true; previousMessageIds.current = []; conversationPosition.current = 0; setNewMessageCount(0);
  }
  function clearTeamPages() {
    setOlderMessages([]); setOlderState('idle'); setOlderResources([]); setMoreResourcesState('idle'); setMessagesLoaded(false);
  }
  function chooseCompany(id: string, force = false) {
    if (!force && id === currentIdentity.current.companyId) return;
    if (currentIdentity.current.uid && currentIdentity.current.companyId) lockedRecoveryScopes.current.add(JSON.stringify([currentIdentity.current.uid, currentIdentity.current.companyId]));
    currentIdentity.current = { ...currentIdentity.current, companyId: id, teamId: 'general' };
    setCompanyRevision(value => value + 1); setTeamRevision(value => value + 1);
    reconnectingRef.current = false; setReconnecting(false);
    generation.current += 1; companyGeneration.current += 1;
    blocked.current = false; setConnectionBlocked(false);
    drafts.current = {}; aiPendingRef.current = {}; setAIPending({});
    setCompanyId(id); setTeamId('general'); setCompany(null); setMembers([]); setTeams([]); setHost(null);
    setMessages([]); setResources([]); setRequests([]); clearTeamPages(); resetForms();
  }
  function chooseTeam(id: string) {
    if (id === currentIdentity.current.teamId) return;
    currentIdentity.current = { ...currentIdentity.current, teamId: id };
    generation.current += 1;
    setTeamRevision(value => value + 1);
    reconnectingRef.current = false; setReconnecting(false);
    setTeamId(id); setMessages([]); setResources([]); setRequests([]); clearTeamPages(); resetForms(true);
  }
  function appendFailedDraft(id: number) {
    if (!session || currentIdentity.current.uid !== session.uid || currentIdentity.current.companyId !== companyId || currentIdentity.current.teamId !== teamId) return;
    if (blocked.current || lockedRecoveryScopes.current.has(JSON.stringify([session.uid, companyId])) || !membership || !selfMember || !selectedTeam || !messagesLoaded) return;
    const entry = failedDrafts.current[draftKey]?.find((item) => item.id === id);
    if (!entry) return;
    const current = drafts.current[draftKey] || '';
    if (current === entry.text) return;
    const next = current ? `${current}\n\n${entry.text}` : entry.text;
    if (next.length > 6000) return;
    updateDraft(next);
  }
  function dismissFailedDraft(id: number) {
    if (!session || currentIdentity.current.uid !== session.uid || currentIdentity.current.companyId !== companyId || currentIdentity.current.teamId !== teamId) return;
    if (blocked.current || lockedRecoveryScopes.current.has(JSON.stringify([session.uid, companyId])) || !membership || !selfMember || !selectedTeam || !messagesLoaded) return;
    const entries = failedDrafts.current[draftKey] || [];
    failedDrafts.current[draftKey] = entries.filter((item) => item.id !== id);
    setFailedDraftRevision((value) => value + 1);
  }
  function subscriptionError(error: unknown) {
    if (currentIdentity.current.uid && currentIdentity.current.companyId) lockedRecoveryScopes.current.add(JSON.stringify([currentIdentity.current.uid, currentIdentity.current.companyId]));
    authGeneration.current += 1; generation.current += 1; companyGeneration.current += 1; blocked.current = true; setConnectionBlocked(true);
    reconnectingRef.current = false; setReconnecting(false);
    drafts.current = {}; aiPendingRef.current = {}; setAIPending({});
    setCompany(null); setMembers([]); setTeams([]); setHost(null);
    setMessages([]); setResources([]); setRequests([]); clearTeamPages(); resetForms();
    setNotice({ text: errorText(error), error: true });
  }
  async function reconnectCompany() {
    if (!session || !companyId || reconnectingRef.current) return;
    lockedRecoveryScopes.current.add(JSON.stringify([session.uid, companyId]));
    authGeneration.current += 1; companyGeneration.current += 1; generation.current += 1;
    blocked.current = true; setConnectionBlocked(true);
    aiPendingRef.current = {}; setAIPending({});
    const captured = generation.current; const uid = session.uid; const cid = companyId; const tid = currentIdentity.current.teamId;
    const requestId = ++reconnectSequence.current;
    const isCurrent = () => generation.current === captured && reconnectSequence.current === requestId && currentIdentity.current.uid === uid && currentIdentity.current.companyId === cid && currentIdentity.current.teamId === tid;
    reconnectingRef.current = true;
    setReconnecting(true);
    try {
      await recoverCompanyConnection(session, companyId);
      if (!isCurrent()) return;
      blocked.current = false;
      setConnectionBlocked(current => isCurrent() ? false : current);
      setNotice(current => isCurrent() ? null : current);
      setConnectionRevision(value => isCurrent() ? value + 1 : value);
    } catch (error) {
      if (isCurrent()) {
        const notice = { text: errorText(error), error: true };
        setNotice(current => isCurrent() ? notice : current);
      }
    } finally { if (isCurrent()) { reconnectingRef.current = false; setReconnecting(current => isCurrent() ? false : current); } }
  }

  useEffect(() => {
    setDevice(getCurrentDeviceProfile());
    try {
      const params = new URLSearchParams(window.location.search);
      pendingTarget.current = { companyId: params.get('company') || '', teamId: params.get('team') || '', forCompany: params.get('company') || '' };
      // [팀에 공유] 뒤 '우리 회사에서 보기'는 공유 자료 탭으로 바로 연다.
      if (params.get('tab') === 'resources') setTab('resources');
      if (params.get('tab') === 'tasks') setTab('tasks');
      if (params.get('tab') === 'home') setTab('home');
      if (params.get('tab') === 'agenda') setTab('agenda');
    } catch { /* No target: open the first company as before. */ }
    if (typeof Notification !== 'undefined') setNotificationPermission(Notification.permission);
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void onAuthSession((next) => {
      if (disposed) return;
      authGeneration.current += 1;
      setAuthRevision(value => value + 1);
      generation.current += 1;
      setSession(next); setAuthReady(true); setMemberships([]); setMembershipsLoaded(false); chooseCompany('', true);
    }).then((stop) => { if (disposed) stop(); else unsubscribe = stop; }).catch((error) => {
      if (!disposed) { setAuthReady(true); setMembershipsLoaded(true); setNotice({ text: errorText(error), error: true }); }
    });
    return () => { disposed = true; authGeneration.current += 1; generation.current += 1; companyGeneration.current += 1; unsubscribe?.(); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!session) return;
    let disposed = false;
    const captured = authGeneration.current;
    const isCurrent = () => !disposed && authGeneration.current === captured;
    let unsubscribe: (() => void) | undefined;
    void subscribeCompanyMemberships(session, (items) => {
      if (!isCurrent()) return;
      const active = items.filter((item) => item.status === 'active');
      setMemberships(active); setMembershipsLoaded(true);
      const currentId = currentIdentity.current.companyId;
      const target = pendingTarget.current.companyId;
      if (target && active.some((item) => item.companyId === target)) {
        pendingTarget.current.companyId = '';
        if (target !== currentId) { chooseCompany(target); return; }
      }
      if (!active.some((item) => item.companyId === currentId)) chooseCompany(active[0]?.companyId || '');
    }, (error) => { if (isCurrent()) { setMembershipsLoaded(true); subscriptionError(error); } })
      .then((stop) => { if (!isCurrent()) stop(); else unsubscribe = stop; }).catch((error) => {
        if (isCurrent()) { setMembershipsLoaded(true); subscriptionError(error); }
      });
    return () => { disposed = true; unsubscribe?.(); };
  }, [session, connectionRevision, authRevision]);

  useEffect(() => {
    if (!session || !companyId || blocked.current) return;
    generation.current += 1;
    setCompany(null); setMembers([]); setTeams([]); setHost(null); resetForms();
    let disposed = false;
    const captured = companyGeneration.current;
    const isCurrent = () => !disposed && companyGeneration.current === captured;
    const stops: (() => void)[] = [];
    const fail = (error: unknown) => { if (isCurrent()) { disposed = true; stops.forEach((stop) => stop()); subscriptionError(error); } };
    const attach = (pending: Promise<() => void>) => void pending.then((stop) => { if (!isCurrent()) stop(); else stops.push(stop); }).catch(fail);
    attach(subscribeCompany(session, companyId, (value) => { if (isCurrent() && !blocked.current) setCompany(value); }, fail));
    attach(subscribeCompanyMembers(session, companyId, (value) => { if (isCurrent() && !blocked.current) setMembers(value); }, fail));
    attach(subscribeCompanyHost(session, companyId, (value) => { if (isCurrent() && !blocked.current) setHost(value); }, fail));
    attach(subscribeCompanyTeams(session, companyId, (value) => { if (isCurrent() && !blocked.current) setTeams(value); }, fail));
    return () => { disposed = true; stops.forEach((stop) => stop()); };
  }, [session, companyId, connectionRevision, companyRevision]);

  useEffect(() => {
    if (!session || !companyId || !teamId || blocked.current) return;
    generation.current += 1;
    setMessages([]); setResources([]); setRequests([]); setDraft(drafts.current[JSON.stringify([session?.uid || '', companyId, teamId])] || ''); setNote({ id: '', title: '', text: '' }); setBusy('');
    setMessagesLoaded(false); setOlderMessages([]); setOlderState('idle'); setOlderResources([]); setMoreResourcesState('idle');
    let disposed = false;
    const captured = generation.current;
    const isCurrent = () => !disposed && generation.current === captured;
    const stops: (() => void)[] = [];
    const fail = (error: unknown) => { if (isCurrent()) { disposed = true; stops.forEach((stop) => stop()); subscriptionError(error); } };
    const attach = (pending: Promise<() => void>) => void pending.then((stop) => { if (!isCurrent()) stop(); else stops.push(stop); }).catch(fail);
    attach(subscribeCompanyMessages(session, companyId, teamId, (value) => { if (isCurrent() && !blocked.current) { setMessages(value); setMessagesLoaded(true); } }, fail));
    attach(subscribeCompanyResources(session, companyId, teamId, (value) => { if (isCurrent() && !blocked.current) setResources(value); }, fail));
    attach(subscribeCompanyAIRequests(session, companyId, teamId, (value) => { if (isCurrent() && !blocked.current) setRequests(value); }, fail));
    return () => { disposed = true; stops.forEach((stop) => stop()); };
  }, [session, companyId, teamId, connectionRevision, companyRevision, teamRevision]);

  useEffect(() => {
    if (teams.length && !availableTeams.some((item) => item.id === teamId)) chooseTeam('general');
  }, [teams, membership?.role, session?.uid, teamId]);

  useEffect(() => {
    const target = pendingTarget.current;
    if (!target.teamId || target.forCompany !== companyId || !availableTeams.length) return;
    if (availableTeams.some((item) => item.id === target.teamId) && target.teamId !== teamId) chooseTeam(target.teamId);
    pendingTarget.current = { companyId: '', teamId: '', forCompany: '' };
  }, [teams, companyId]);

  useEffect(() => {
    setHostIssue(companyId ? readCompanyHostStatus(companyId) : null);
    return subscribeCompanyHostStatus((changedCompanyId, status) => { if (changedCompanyId === companyId) setHostIssue(status); });
  }, [companyId]);

  // Once older pages are open, keep every live message too, so nothing disappears as the live window moves.
  useEffect(() => {
    if (olderMessages.length && messages.length) setOlderMessages((old) => old.length ? mergeCompanyMessages(old, messages) : old);
  }, [messages]);

  // The conversation on screen counts as read (drives the rail dot and notifications).
  useEffect(() => {
    if (!session || !companyId || tab !== 'chat' || !messagesLoaded || !messages.length) return;
    const markSeen = () => {
      if (document.hidden) return;
      const latest = messages[messages.length - 1];
      if (markCompanyTeamSeen(safeStorage(), session.uid, companyId, teamId, latest.createdAtEpochMs)) window.dispatchEvent(new CustomEvent(COMPANY_SEEN_EVENT));
    };
    markSeen();
    document.addEventListener('visibilitychange', markSeen);
    return () => document.removeEventListener('visibilitychange', markSeen);
  }, [messages, messagesLoaded, tab, session, companyId, teamId]);

  function scrollToLatest() {
    followsConversation.current = true; setNewMessageCount(0);
    const element = conversationRef.current;
    if (element) { element.scrollTop = element.scrollHeight; conversationPosition.current = element.scrollTop; }
  }
  useEffect(() => {
    const element = conversationRef.current;
    if (!element || tab !== 'chat') return;
    // Only the live window counts toward "new messages"; older pages never do.
    const ids = messages.map((message) => message.id);
    const added = ids.filter((id) => !previousMessageIds.current.includes(id)).length;
    if (followsConversation.current || !previousMessageIds.current.length) scrollToLatest();
    else {
      element.scrollTop = conversationPosition.current;
      if (added) setNewMessageCount((count) => count + added);
    }
    previousMessageIds.current = ids;
  }, [messages, tab]);
  useLayoutEffect(() => {
    const element = conversationRef.current;
    if (!element || restoreFromBottom.current === null) return;
    element.scrollTop = element.scrollHeight - restoreFromBottom.current;
    conversationPosition.current = element.scrollTop;
    restoreFromBottom.current = null;
  }, [olderMessages]);

  // '다른 회사 만들기 또는 연결하기' 팝오버: 회사가 바뀌거나 바깥을 누르거나 Esc 를 누르면 닫는다.
  const [connectOpen, setConnectOpen] = useState(false);
  const connectRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => { setConnectOpen(false); }, [companyId]);
  useEffect(() => {
    if (!connectOpen) return;
    const closeOutside = (event: PointerEvent) => { if (!connectRef.current?.contains(event.target as Node)) setConnectOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key !== 'Escape') return; setConnectOpen(false); connectRef.current?.querySelector('summary')?.focus(); };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeOnEscape); };
  }, [connectOpen]);
  // 좁은 화면에서 탭 줄이 가로로 스크롤될 때 선택한 탭이 가려지지 않게 한다.
  const tabNavRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = tabNavRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return;
    const left = active.offsetLeft - 16; const right = active.offsetLeft + active.offsetWidth + 32;
    if (left < nav.scrollLeft) nav.scrollLeft = Math.max(0, left);
    else if (right > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = right - nav.clientWidth;
  }, [tab, membership?.companyId, connectionBlocked]);

  async function run<T>(key: string, operation: (isCurrent: () => boolean) => Promise<T>, success?: (value: T) => void) {
    const captured = generation.current;
    const scope = currentScope.current;
    const isCurrent = () => generation.current === captured && currentScope.current === scope;
    setBusy(key); setNotice(null);
    try {
      const result = await operation(isCurrent);
      if (isCurrent()) success?.(result);
    } catch (error) {
      if (isCurrent()) setNotice({ text: errorText(error), error: true });
    } finally {
      if (isCurrent()) setBusy('');
    }
  }
  function submitMessage(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!session || !membership || !text) return;
    const captured = generation.current; const scope = currentScope.current; const key = draftKey;
    const capturedCompany = companyGeneration.current; const uid = session.uid; const cid = companyId; const tid = teamId;
    const isCurrent = () => generation.current === captured && currentScope.current === scope;
    const isCompanyCurrent = () => companyGeneration.current === capturedCompany && currentIdentity.current.uid === uid && currentIdentity.current.companyId === cid;
    const isDisplayed = () => isCompanyCurrent() && currentIdentity.current.teamId === tid;
    // Clear at once; the message shows up (dimmed) from the local write and the text comes back if sending fails.
    drafts.current[key] = ''; setDraft(''); setNotice(null);
    followsConversation.current = true;
    void sendCompanyMessage(session, companyId, teamId, text, { member: selfMember }).then(() => {
      if (isCurrent()) scrollToLatest();
    }).catch((error) => {
      if (!isCompanyCurrent()) {
        lockedRecoveryScopes.current.add(JSON.stringify([uid, cid]));
        failedDrafts.current[key] = [...(failedDrafts.current[key] || []), { id: ++failedDraftSequence.current, text, kind: 'message' }];
        setFailedDraftRevision((value) => value + 1);
        return;
      }
      rememberFailedText(key, text, 'message');
      if (!isDisplayed()) return;
      setDraft((current) => isDisplayed() ? current || drafts.current[key] || text : current);
      const notice = { text: errorText(error), error: true };
      setNotice((current) => isDisplayed() ? notice : current);
    });
  }
  function askAI() {
    const prompt = draft.trim();
    if (!session || !membership || !prompt || aiPendingRef.current[draftKey]) return;
    if (currentIdentity.current.uid !== session.uid || currentIdentity.current.companyId !== companyId || currentIdentity.current.teamId !== teamId) return;
    const mode = aiMode; const key = draftKey;
    const capturedCompany = companyGeneration.current; const uid = session.uid; const cid = companyId; const tid = teamId;
    // The answer still belongs to the team it was asked in, so switching teams does not lose it;
    // switching company or account does (it is then discarded and never posted).
    const isCurrent = () => companyGeneration.current === capturedCompany && currentIdentity.current.uid === uid && currentIdentity.current.companyId === cid;
    const isDisplayed = () => isCurrent() && currentIdentity.current.teamId === tid;
    drafts.current[key] = ''; setDraft(''); setNotice(null);
    const requestId = ++aiRequestSequence.current;
    aiPendingRef.current = { ...aiPendingRef.current, [key]: { mode, requestId } };
    setAIPending(aiPendingRef.current);
    followsConversation.current = true;
    void requestWorkspaceAI({ session, companyId: cid, teamId: tid, prompt, mode, isCurrent }).then(() => {
      if (!isCurrent()) return;
      if (isDisplayed()) {
        scrollToLatest();
        const notice = { text: mode === 'company' ? '회사 메인 PC에 요청했습니다. 처리 상태를 아래에서 확인하세요.' : '개인 AI 처리 결과를 팀 대화에서 확인하세요.' };
        setNotice((current) => isDisplayed() ? notice : current);
      }
    }).catch((error) => {
      if (!isCurrent()) {
        // No current authorization to show the previous company's unknown result.
        lockedRecoveryScopes.current.add(JSON.stringify([uid, cid]));
        failedDrafts.current[key] = [...(failedDrafts.current[key] || []), { id: ++failedDraftSequence.current, text: prompt, kind: mode === 'company' ? 'company_ai' : 'personal_ai' }];
        setFailedDraftRevision((value) => value + 1);
        return;
      }
      rememberFailedText(key, prompt, mode === 'company' ? 'company_ai' : 'personal_ai');
      if (isDisplayed()) {
        setDraft((current) => isDisplayed() ? current || drafts.current[key] || prompt : current);
        const notice = { text: mode === 'company' ? `${errorText(error)} AI 요청 목록에서 등록 상태를 확인해 주세요. 목록에 보이지 않아도 처리됐을 수 있습니다. 자동으로 재시도하지 않습니다.` : errorText(error), error: true };
        setNotice((current) => isDisplayed() ? notice : current);
      }
    }).finally(() => {
      if (!isCurrent() || aiPendingRef.current[key]?.requestId !== requestId) return;
      const next = { ...aiPendingRef.current }; delete next[key];
      aiPendingRef.current = next; setAIPending(next);
    });
  }
  async function loadOlderMessages() {
    const first = displayMessages[0];
    if (!session || !first || olderState === 'loading') return;
    const captured = generation.current; const scope = currentScope.current;
    const isCurrent = () => generation.current === captured && currentScope.current === scope;
    setOlderState('loading');
    try {
      const rows = await loadOlderCompanyMessages(session, companyId, teamId, first.createdAtEpochMs, MESSAGE_PAGE);
      if (!isCurrent()) return;
      const known = new Set(displayMessages.map((message) => message.id));
      const fresh = rows.filter((message) => !known.has(message.id));
      const element = conversationRef.current;
      restoreFromBottom.current = element ? element.scrollHeight - element.scrollTop : null;
      setOlderMessages((old) => mergeCompanyMessages(mergeCompanyMessages(old, messages), fresh));
      setOlderState(fresh.length && rows.length >= MESSAGE_PAGE ? 'idle' : 'done');
    } catch (error) {
      if (isCurrent()) { setOlderState('idle'); setNotice({ text: errorText(error), error: true }); }
    }
  }
  async function loadMoreResources() {
    const last = displayResources[displayResources.length - 1];
    if (!session || !last || moreResourcesState === 'loading') return;
    const captured = generation.current; const scope = currentScope.current;
    const isCurrent = () => generation.current === captured && currentScope.current === scope;
    setMoreResourcesState('loading');
    try {
      const rows = await loadMoreCompanyResources(session, companyId, teamId, last.updatedAtEpochMs || last.createdAtEpochMs, RESOURCE_PAGE);
      if (!isCurrent()) return;
      const known = new Set(displayResources.map((item) => item.id));
      const fresh = rows.filter((item) => !known.has(item.id));
      setOlderResources((old) => [...old, ...fresh]);
      setMoreResourcesState(fresh.length && rows.length >= RESOURCE_PAGE ? 'idle' : 'done');
    } catch (error) {
      if (isCurrent()) { setMoreResourcesState('idle'); setNotice({ text: errorText(error), error: true }); }
    }
  }
  function enableNotifications() {
    if (typeof Notification === 'undefined') return;
    void Notification.requestPermission().then((result) => setNotificationPermission(result)).catch(() => undefined);
  }
  function editTeam(team: CompanyTeam) {
    setEditingTeamId(team.id); setTeamName(team.name); setTeamMemberIds(team.memberIds);
  }

  if (!authReady) return <div className={styles.page}><p className={styles.pageStatus} role="status">계정을 확인하고 있습니다.</p></div>;
  if (!session) return <div className={styles.page}><section className={styles.setupCard}><h1>우리 회사</h1><p className={styles.pageLead}>로그인한 계정으로 회사를 만들거나 초대받은 회사에 연결하세요.</p><Link className={styles.btnPrimary} href="/account">로그인하러 가기</Link></section></div>;

  // Room views (대화·업무·일정·파일·자료) follow the room picked in the sidebar; company-wide views open its conversation.
  const roomScopedTabs: Tab[] = ['chat', 'tasks', 'agenda', 'files', 'resources'];
  const peerOf = (team: CompanyTeam) => activeMembers.find((member) => member.uid !== session.uid && team.memberIds.includes(member.uid));
  const roomTitle = (team?: CompanyTeam) => !team ? '전체' : team.kind === 'direct' ? peerOf(team)?.displayName || team.name : team.name;
  const roomGroups = [
    { kind: 'team', label: '팀·단체 대화', rooms: availableTeams.filter((item) => item.kind !== 'direct') },
    { kind: 'direct', label: '개인 대화', rooms: availableTeams.filter((item) => item.kind === 'direct') },
  ];
  const roomPeople = !selectedTeam || selectedTeam.visibility === 'company' ? activeMembers.length : activeMembers.filter((member) => selectedTeam.memberIds.includes(member.uid)).length;
  const roomMeta = direct ? '1대1 · 참여자만 보기' : (selectedTeam?.visibility === 'private' ? '지정 멤버' : '회사 구성원 모두') + (roomPeople ? ' · ' + roomPeople + '명' : '');
  const roleText = selfMember && !connectionBlocked ? roleLabel(selfMember.role) : connectionBlocked ? '회사 접근 확인 필요' : '소속 확인 중';
  const companyAIIssue = Boolean(company) && !direct && aiMode === 'company' && !online;
  const companyAIIssueText = !host ? '회사 AI를 처리할 메인 PC가 아직 지정되지 않았습니다. ' + (isAdmin ? 'AI 연결에서 메인 PC를 지정하거나' : '관리자에게 지정을 요청하거나') + ' 직접 개인 AI를 선택해 주세요.'
    : !host.enabled ? '회사 AI 공유가 중지되어 있습니다. ' + (isAdmin ? 'AI 연결에서 다시 켜거나' : '관리자에게 다시 켜 달라고 요청하거나') + ' 직접 개인 AI를 선택해 주세요.'
    : '회사 메인 PC가 응답하지 않습니다. 메인 PC를 켜거나 직접 개인 AI를 선택해 주세요.';
  const composerHint = direct ? '이 대화는 두 참여자만 열람합니다. AI에 요청하면 내 PC의 AI가 처리하고 결과를 이 대화방에 공유합니다.' : aiMode === 'company' ? online ? (host?.label || '회사 메인 PC') + '에서 연결한 AI로 처리합니다.' : '' : '개인 AI도 이 회사의 팀 대화와 공유 자료를 참고하며, 결과는 팀에 공유됩니다.';
  const noticeBar = notice && <p className={styles.noticeBar} role={notice.error ? 'alert' : 'status'} data-error={Boolean(notice.error)}>{notice.text}</p>;
  const connectForms = (Heading: 'h2' | 'h3') => <div className={styles.connectForms}>
    <form className={styles.fieldStack} onSubmit={(event) => { event.preventDefault(); if (companyName.trim()) void run('create-company', () => createCompany(session, companyName.trim()), (value) => { setCompanyName(''); chooseCompany(value.id); }); }}>
      <Heading>새 회사 만들기</Heading><p className={styles.pageLead}>회사를 만든 계정이 소유자가 됩니다.</p>
      <label>회사 이름<input value={companyName} maxLength={80} onChange={(event) => setCompanyName(event.target.value)} autoComplete="organization" required /></label>
      <button className={styles.btnPrimary} disabled={Boolean(busy) || !companyName.trim()}>회사 만들기</button>
    </form>
    <form className={styles.fieldStack} onSubmit={(event) => { event.preventDefault(); if (inviteCode.trim()) void run('join-company', () => acceptCompanyInvite(session, inviteCode.trim()), (value) => chooseCompany(value.companyId)); }}>
      <Heading>초대받은 회사 연결</Heading><p className={styles.pageLead}>현재 계정으로 참여할 수 있습니다.</p>
      <label>회사 초대 코드<input value={inviteCode} maxLength={200} onChange={(event) => setInviteCode(event.target.value)} autoComplete="off" required /></label>
      <button className={styles.btn} disabled={Boolean(busy) || !inviteCode.trim()}>초대 코드로 연결</button>
    </form>
  </div>;

  if (!membership) return <div className={styles.page} data-company-workspace="true">
    <div className={styles.setup}>
      <header className={styles.setupHead}>
        <div className={styles.setupTitle}><h1>우리 회사</h1><p className={styles.pageLead}>회사 공간을 만들거나 초대받은 회사에 연결해 동료와 함께 일하세요.</p></div>
        <Link className={styles.btn} href="/"><Icon name="back" />내 업무로 돌아가기</Link>
      </header>
      {membershipsLoaded ? <label className={styles.inlineField}>소속 회사<select aria-label="소속 회사" value={companyId} onChange={(event) => chooseCompany(event.target.value)} disabled={!memberships.length}>
        {!memberships.length ? <option value="">연결된 회사 없음</option> : memberships.map((item) => <option key={item.companyId} value={item.companyId}>{item.companyName}</option>)}
      </select></label> : <p className={styles.pageStatus} role="status">회사 정보를 불러오는 중…</p>}
      {noticeBar}
      {connectionBlocked && <div><button type="button" className={styles.btn} disabled={reconnecting} onClick={() => void reconnectCompany()}>{reconnecting ? '계정과 소속 확인 중…' : '회사 연결 다시 확인'}</button></div>}
      {membershipsLoaded && <details className={styles.setupConnect} open={!memberships.length}>
        <summary>{memberships.length ? '다른 회사 만들기 또는 연결하기' : '회사와 연결해 함께 시작하기'}</summary>
        {connectForms('h2')}
        <p className={styles.pageNote}>회사에 연결하지 않아도 개인 업무는 계속 사용할 수 있습니다.</p>
      </details>}
    </div>
  </div>;

  return <div className={styles.shell} data-company-workspace="true">
    <div className={styles.frame}>
      <div className={styles.sidebar}>
        <div className={styles.sidebarHead}>
          <div className={styles.switcher}>
            <span className={styles.companyMark} aria-hidden="true">{initialOf(companyLabel)}</span>
            <div className={styles.switcherText}>
              <h1>우리 회사</h1>
              <div className={styles.companyLine}>{connectionBlocked ? <p className={styles.companyName} title={companyLabel}>{companyLabel}</p> : <h2 className={styles.companyName} title={companyLabel}>{companyLabel}</h2>}<span className={styles.switcherChevron}><Icon name="chevron" size={14} /></span></div>
              <p className={styles.companyRole}><span>{roleText}</span>{!connectionBlocked && activeMembers.length > 0 && <span>· 구성원 {activeMembers.length}명</span>}</p>
            </div>
            {/* 회사 전환: 머리 전체가 '소속 회사' 선택 상자다(보이는 글자는 위의 회사 이름). */}
            <select className={styles.switcherSelect} aria-label="소속 회사" value={companyId} onChange={(event) => chooseCompany(event.target.value)}>
              {memberships.map((item) => <option key={item.companyId} value={item.companyId}>{item.companyName}</option>)}
            </select>
          </div>
          <details ref={connectRef} className={styles.connectMenu} open={connectOpen} onToggle={(event) => setConnectOpen(event.currentTarget.open)}>
            <summary title="다른 회사 만들기 또는 연결하기"><Icon name="more" /><span className="sr-only">다른 회사 만들기 또는 연결하기</span></summary>
            <div className={styles.connectPanel}>
              <p className={styles.connectTitle}>다른 회사 만들기 또는 연결하기</p>
              {connectForms('h3')}
            </div>
          </details>
        </div>
        {!connectionBlocked && <>
          <div className={styles.sidebarActions}><button type="button" className={styles.startButton} onClick={() => setConversationPicker((value) => !value)} aria-expanded={conversationPicker}>＋ 대화 시작</button></div>
          <nav className={styles.roomNav} aria-label="회사 대화 목록">
            {roomGroups.map((group) => <details key={group.kind} className={styles.roomGroup} open>
              <summary>{group.label}</summary>
              {group.rooms.length > 0 && <ul>{group.rooms.map((item) => <li key={item.id}><button type="button" className={styles.roomButton} aria-current={teamId === item.id ? 'true' : undefined} title={roomTitle(item) + (item.kind !== 'direct' && item.visibility === 'private' ? ' · 지정 멤버만 참여' : '')} onClick={() => { chooseTeam(item.id); if (!roomScopedTabs.includes(tab)) setTab('chat'); }}>
                {item.kind === 'direct' ? <span className={styles.roomAvatar} data-tone={avatarTone(peerOf(item)?.uid || item.id)} aria-hidden="true">{initialOf(roomTitle(item))}</span> : <Icon name={item.visibility === 'private' ? 'lock' : 'hash'} size={15} />}
                <span className={styles.roomName}>{roomTitle(item)}</span>
              </button></li>)}</ul>}
              {group.kind === 'direct' && !group.rooms.length && <p className={styles.roomEmpty}>동료와 대화를 시작해 보세요.</p>}
            </details>)}
          </nav>
        </>}
        <div className={styles.sidebarFoot}>
          {isAdmin && !connectionBlocked && <button type="button" className={styles.footButton} onClick={() => { setTab('members'); setConversationPicker(false); requestAnimationFrame(() => document.getElementById('company-invite')?.scrollIntoView({ block: 'nearest' })); }}><Icon name="userPlus" />직원 초대</button>}
          <Link className={styles.footButton} href="/"><Icon name="back" />내 업무로 돌아가기</Link>
        </div>
      </div>

      <div className={styles.main} data-view={connectionBlocked ? 'blocked' : tab}>
        {connectionBlocked ? <div className={styles.blocked}>
          <span className={styles.blockedIcon}><Icon name="alert" size={20} /></span>
          {noticeBar}
          <button type="button" className={styles.btn} disabled={reconnecting} onClick={() => void reconnectCompany()}>{reconnecting ? '계정과 소속 확인 중…' : '회사 연결 다시 확인'}</button>
        </div> : <>
          <header className={styles.channelHeader}>
            <div className={styles.channelTitle}>
              <div className={styles.roomTrigger}>
                <h2 className={styles.channelName}>
                  {direct && selectedTeam ? <span className={styles.roomAvatar} data-tone={avatarTone(peerOf(selectedTeam)?.uid || selectedTeam.id)} aria-hidden="true">{initialOf(roomTitle(selectedTeam))}</span> : <Icon name={selectedTeam?.visibility === 'private' ? 'lock' : 'hash'} size={17} />}
                  <span className={styles.channelText} title={roomTitle(selectedTeam)}>{roomTitle(selectedTeam)}</span>
                  <span className={styles.triggerChevron}><Icon name="chevron" size={15} /></span>
                </h2>
                {/* 좁은 화면: 사이드바 목록 대신 대화방 제목을 눌러 대화방을 바꾼다. 넓은 화면에서는 숨긴다. */}
                <select className={styles.roomSelect} aria-label="대화할 팀" value={teamId} onChange={(event) => chooseTeam(event.target.value)}>{!availableTeams.length && <option value="general">전체</option>}{availableTeams.map((item) => <option key={item.id} value={item.id}>{teamLabel(item)}{item.kind!=='direct'&&item.visibility === 'private' ? ' · 지정 멤버' : ''}</option>)}</select>
              </div>
              <p className={styles.channelMeta}>{roomMeta}</p>
            </div>
            <div className={styles.channelActions}>
              {tab === 'chat' && notificationPermission === 'default' && <button type="button" className={styles.ghostButton} onClick={enableNotifications}><Icon name="bell" size={15} />새 메시지 알림 켜기</button>}
              {!direct && <span className={styles.aiBadge} data-online={online}>{online ? '회사 AI 온라인' : '회사 AI 오프라인'}</span>}
            </div>
          </header>
          <div className={styles.tabBar}><nav ref={tabNavRef} className={styles.tabNav} aria-label="회사 화면 선택">{tabs.map((item) => <button key={item.id} type="button" aria-current={tab === item.id ? 'page' : undefined} onClick={() => { setTab(item.id); setConfirmRemove(''); setConfirmDelete(''); }}>{item.label}</button>)}</nav></div>
          {conversationPicker && <div className={styles.pickerSlot}><CompanyConversationPicker key={session.uid+':'+companyId} session={session} companyId={companyId} members={activeMembers} onOpen={openConversation} onClose={()=>setConversationPicker(false)}/></div>}
          {noticeBar}

          <div className={styles.content} data-view={tab}>
            {tab === 'home' && <CompanyHome key={session.uid+':'+companyId} session={session} companyId={companyId} companyName={companyLabel} teams={availableTeams} members={activeMembers} isAdmin={isAdmin} online={online} hostLabel={host?.label || ''} onOpenConversation={team => { chooseTeam(team); setTab('chat'); }} onAssignTask={team => { chooseTeam(team); setTaskSeed(''); setTaskSeedDue(''); setTab('tasks'); }} onOpenAgenda={team => { chooseTeam(team); setTab('agenda'); }} onShareFile={team => { chooseTeam(team); setTab('files'); }} onNewConversation={() => setConversationPicker(true)} onOpenMembers={() => setTab('members')}/>}
            {tab === 'tasks' && selectedTeam && <CompanyTaskBoard key={session.uid+':'+companyId+':'+teamId+':'+taskSeed+':'+taskSeedDue} session={session} companyId={companyId} team={selectedTeam} members={activeMembers} isAdmin={isAdmin} seed={taskSeed} seedDueDate={taskSeedDue}/>}
            {tab === 'agenda' && selectedTeam && <CompanyToday key={session.uid+':'+companyId+':'+teamId} session={session} companyId={companyId} team={selectedTeam} onManage={() => { setTaskSeed(''); setTaskSeedDue(''); setTab('tasks'); }}/>}
            {tab === 'files' && selectedTeam && <CompanyFileShelf key={session.uid+':'+companyId+':'+teamId} session={session} companyId={companyId} teamId={teamId} destination={companyLabel+' · '+teamLabel(selectedTeam)}/>}

            {tab === 'chat' && <section className={styles.chat} aria-label="팀 대화">
              {companyAIIssue && <div className={styles.banner} role="status">
                <Icon name="alert" />
                <p>{companyAIIssueText}</p>
                {device?.kind === 'desktop_app' ? <button type="button" className={styles.bannerAction} onClick={() => setAIMode('personal')}>개인 AI로 바꾸기</button> : isAdmin ? <button type="button" className={styles.bannerAction} onClick={() => setTab('ai')}>AI 연결 확인</button> : null}
              </div>}
              <div className={styles.stage}>
                <div ref={conversationRef} className={styles.conversation} aria-label="대화 기록" onScroll={(event) => {
                  const element = event.currentTarget;
                  conversationPosition.current = element.scrollTop;
                  followsConversation.current = element.scrollHeight - element.clientHeight - element.scrollTop < 80;
                  if (followsConversation.current) setNewMessageCount(0);
                }}>
                  {messagesLoaded && messages.length >= 60 && olderState !== 'done' && <div className={styles.olderRow}><button type="button" onClick={() => void loadOlderMessages()} disabled={olderState === 'loading'}>{olderState === 'loading' ? '이전 대화를 불러오는 중…' : '이전 대화 더 보기'}</button></div>}
                  {!messagesLoaded ? <p className={styles.chatState} role="status">대화를 불러오는 중…</p> : !displayMessages.length && <div className={styles.chatEmpty}><Icon name="chat" size={22} /><p>첫 메시지를 남겨 팀과 업무를 이어 가세요.</p></div>}
                  {displayMessages.map((message, index) => {
                    const badge = companyAuthorBadge(message, members);
                    const ai = message.kind === 'company_ai' || message.kind === 'personal_ai';
                    const author = message.kind === 'company_ai' ? '회사 AI' : message.kind === 'personal_ai' ? '개인 AI · ' + (message.authorName || '구성원') : message.authorName || '구성원';
                    const previous = displayMessages[index - 1];
                    const newDay = Boolean(message.createdAtEpochMs) && (!previous?.createdAtEpochMs || dayKeyOf(previous.createdAtEpochMs) !== dayKeyOf(message.createdAtEpochMs));
                    return <Fragment key={message.id}>
                      {newDay && <p className={styles.dayDivider}><span>{dayLabel(message.createdAtEpochMs, now)}</span></p>}
                      <article className={styles.message} data-own={message.kind === 'human' && message.authorUid === session.uid} data-kind={message.kind} data-pending={message.pending ? 'true' : undefined}>
                        <span className={styles.avatar} data-tone={ai ? undefined : avatarTone(message.authorUid || author)} data-ai={ai ? 'true' : undefined} aria-hidden="true">{ai ? <Icon name="sparkles" size={15} /> : initialOf(author)}</span>
                        <div className={styles.messageBody}>
                          <div className={styles.messageHead}>
                            <strong className={styles.author}>{author}</strong>
                            {ai && <span className={styles.aiTag}>AI 답변</span>}
                            {badge && <span className={styles.authorMeta}>{badge}</span>}
                            {message.kind === 'personal_ai' && <span className={styles.authorMeta}>{PERSONAL_AI_NOTE}</span>}
                            {message.pending ? <small className={styles.time}>보내는 중…</small> : <time className={styles.time} dateTime={message.createdAtEpochMs ? new Date(message.createdAtEpochMs).toISOString() : undefined} title={timeLabel(message.createdAtEpochMs)}>{clockLabel(message.createdAtEpochMs)}</time>}
                            {!message.pending&&<button type="button" className={styles.taskButton} onClick={()=>{setTaskSeed(message.text);setTaskSeedDue(suggestDueDate(message.text));setTab('tasks');}}><Icon name="task" size={13} />업무로 지시</button>}
                          </div>
                          {ai ? <div className={styles.aiCard}>{message.requestText && <p className={styles.requestPrompt}>요청: {message.requestText}</p>}<p className={styles.messageText}>{message.text}</p></div>
                            : <>{message.requestText && <p className={styles.requestPrompt}>요청: {message.requestText}</p>}<p className={styles.messageText}>{message.text}</p></>}
                        </div>
                      </article>
                    </Fragment>;
                  })}
                  {aiPendingHere?.mode === 'personal' && <div className={styles.pendingRow}><span className={styles.avatar} data-ai="true" aria-hidden="true"><Icon name="sparkles" size={15} /></span><p role="status">내 PC의 개인 AI가 답을 쓰고 있어요…</p></div>}
                </div>
                {newMessageCount > 0 && <div className={styles.newMessages}><button type="button" onClick={scrollToLatest}>새 메시지 {newMessageCount}개 · 아래로</button></div>}
              </div>

              <div className={styles.dock}>
                {shownRequests.length > 0 && <details className={styles.requests} open><summary>AI 처리 상태 · {shownRequests.length}건</summary><div className={styles.requestList}>{shownRequests.map((request) => <article key={request.id} className={styles.requestItem}>
                  <div className={styles.requestHead}><strong className={styles.requestState} data-status={request.status}>{request.status === 'queued' ? '회사 PC 응답 대기' : request.status === 'running' ? 'AI 처리 중' : request.status === 'completed' ? 'AI 처리 완료' : 'AI 처리 실패'}</strong><p className={styles.requestText}>{request.text}</p>
                    {request.requesterUid === session.uid && ['queued', 'running'].includes(request.status) && <button type="button" className={styles.smallButton} disabled={Boolean(busy)} onClick={() => void run('cancel-ai', () => cancelCompanyAIRequest(session, companyId, request.id), () => setNotice({ text: 'AI 요청을 취소했습니다.' }))}>AI 요청 취소</button>}</div>
                  {request.errorMessage && <p className={styles.requestError}>{request.errorMessage}</p>}
                  {request.outputText && !displayMessages.some((message) => message.requestId === request.id) && <p className={styles.requestOutput}>{request.outputText}</p>}
                </article>)}</div></details>}
                {lockedRecoveryScopes.current.has(JSON.stringify([session.uid, companyId])) && (failedDrafts.current[draftKey]?.length || 0) > 0 && <p className={styles.lockHint}>접근 권한을 다시 확인해야 임시 보관 글을 볼 수 있습니다. 현재는 확인 방법이 없어 잠겨 있으며 앱을 종료하면 사라집니다.</p>}
                {!connectionBlocked && !blocked.current && !lockedRecoveryScopes.current.has(JSON.stringify([session.uid, companyId])) && membership && selfMember && selectedTeam && messagesLoaded && (failedDrafts.current[draftKey]?.length || 0) > 0 && <details className={styles.failedDrafts}>
                  <summary>처리 오류가 난 글 · {failedDrafts.current[draftKey].length}개</summary>
                  <p className={styles.failedNote}>앱이 켜져 있는 동안 임시 보관합니다. 회사 전환 또는 연결 오류 후에는 권한 확인 방법이 없어 잠기며, 앱을 닫으면 사라집니다. 다시 보내기 전 대화 기록을 확인해 주세요.</p>
                  {failedDrafts.current[draftKey].map((item) => <article key={item.id} className={styles.failedItem}>
                    {item.kind === 'company_ai' && <p className={styles.failedNote}>AI 요청 목록에서 등록 상태를 확인해 주세요. 목록에 보이지 않아도 처리됐을 수 있습니다. 자동으로 재시도하지 않습니다.</p>}
                    {item.kind === 'personal_ai' && <p className={styles.failedNote}>대화에서 처리 결과를 확인한 뒤 다시 요청해 주세요. 자동으로 재시도하지 않습니다.</p>}
                    <p className={styles.failedText}>{item.text}</p>
                    <div className={styles.buttonRow}><button type="button" className={styles.smallButton} onClick={() => appendFailedDraft(item.id)} disabled={draft === item.text || draft.length + (draft ? 2 : 0) + item.text.length > 6000}>입력란에 추가</button><button type="button" className={styles.smallButton} onClick={() => dismissFailedDraft(item.id)}>목록에서 지우기</button></div>
                  </article>)}
                </details>}
                {selectedTeam && messagesLoaded && !connectionBlocked && !blocked.current && <CompanyFileShelf key={session.uid+':'+companyId+':'+teamId} compact session={session} companyId={companyId} teamId={teamId} destination={companyLabel+' · '+teamLabel(selectedTeam)}/>}
                <form className={styles.composer} onSubmit={submitMessage}>
                  <label className={styles.composerField}><span className="sr-only">메시지 또는 AI 요청</span><textarea value={draft} maxLength={6000} rows={2} onChange={(event) => updateDraft(event.target.value)} onKeyDown={(event) => {
                    // Enter sends; Shift+Enter adds a line. Never send while a Korean syllable is still being composed.
                    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
                    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                    event.preventDefault();
                    submitMessage();
                  }} placeholder="메시지를 쓰거나 AI에 맡길 일을 적어 주세요 · Enter 보내기 · Shift+Enter 줄바꿈" /></label>
                  <div className={styles.composerBar}>
                    <button type="button" className={styles.askButton} onClick={askAI} disabled={Boolean(busy) || Boolean(aiPendingHere) || !draft.trim() || (aiMode === 'company' ? !online : device?.kind !== 'desktop_app')}><Icon name="sparkles" size={14} />{aiPendingHere ? 'AI 요청 중…' : 'AI에 요청'}</button>
                    <span className={styles.aiTarget}><select aria-label="사용할 AI" value={aiMode} onChange={(event) => setAIMode(event.target.value as AIMode)}>{!direct&&<option value="company">회사 메인 PC의 AI</option>}<option value="personal">내 PC의 개인 AI</option></select><Icon name="chevron" size={13} /></span>
                    <button className={styles.sendButton} disabled={!draft.trim()} aria-label="대화방에 보내기" title="대화방에 보내기 · Enter"><Icon name="send" size={16} /></button>
                  </div>
                </form>
                <div className={styles.composerFoot}>
                  {composerHint && <p className={styles.footHint}>{composerHint}</p>}
                  {aiMode === 'personal' && device?.kind !== 'desktop_app' && <p className={styles.footHint}>개인 AI는 AI를 연결한 설치 앱에서 사용할 수 있습니다.</p>}
                  {aiMode === 'company' && <button type="button" className={styles.textButton} disabled={Boolean(busy)} onClick={() => void run('cancel-my-ai', async () => { try { await cancelMyCompanyAIRequest(session, companyId); } catch (error) { const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''; if (code.includes('permission-denied')) throw new Error('처리 중인 요청이 없거나 요청 권한이 바뀌었습니다. 새 요청을 보내거나 회사 연결을 확인해 주세요.'); throw error; } }, () => setNotice({ text: '내 대기 요청을 취소했습니다. 필요한 요청을 다시 보낼 수 있습니다.' }))}>내 대기 요청 취소</button>}
                </div>
              </div>
            </section>}

            {tab === 'resources' && <div className={styles.split}>
              <section className={styles.panel}><h3>{note.id ? '공유 자료 수정' : '팀에 업무 노트 공유'}</h3><p className={styles.panelLead}>동료와 AI가 참고할 내용을 직접 적어 공유하세요.</p>
                <form className={styles.fieldStack} onSubmit={(event) => { event.preventDefault(); void run('save-resource', () => saveCompanyResource(session, companyId, teamId, { id: note.id || undefined, kind: note.id ? noteKind : 'work_note', title: note.title.trim(), text: note.text.trim() }), () => { setNote({ id: '', title: '', text: '' }); setNotice({ text: '팀 공유 자료에 저장했습니다.' }); }); }}>
                  <label>자료 제목<input value={note.title} maxLength={160} onChange={(event) => setNote({ ...note, title: event.target.value })} required /></label>
                  <label>공유할 본문<textarea value={note.text} maxLength={20000} rows={8} onChange={(event) => setNote({ ...note, text: event.target.value })} required /></label>
                  <div className={styles.buttonRow}><button className={styles.btnPrimary} disabled={Boolean(busy) || !note.title.trim() || !note.text.trim()}>팀에 자료 공유</button>{note.id && <button type="button" className={styles.btn} onClick={() => setNote({ id: '', title: '', text: '' })}>수정 취소</button>}</div>
                </form>
                <div className={styles.panelNotes}>
                  <p>개인 PC의 파일이나 개인 업무 자료는 자동으로 공유되지 않습니다.</p>
                  {teamId === 'general' && <p>전체에 공유한 자료는 모든 팀의 AI가 회사 공통 자료로 참고합니다.</p>}
                  <p>보고서·문서·메일·회사 운영 결과는 각 화면의 [팀에 공유]로 올리면 여기에 모여요.</p>
                </div>
                {/* 팀을 바꾸면 고르던 파일·설명을 비운다(key) — A팀에서 고른 파일이 B팀에 올라가지 않게. 미리보기에 올라갈 곳도 보인다. */}
                <DriveLinkComposer key={companyId + ':' + teamId} destinationLabel={companyLabel + ' · ' + (selectedTeam?.name || '전체')} disabled={Boolean(busy)} onSave={(input) => new Promise<boolean>((resolve) => {
                  void run('save-drive-link', () => saveCompanyResource(session, companyId, teamId, { kind: 'material', title: input.title, text: input.text }), () => { setNotice({ text: '드라이브 파일 링크를 팀 공유 자료에 올렸어요.' }); resolve(true); }).then(() => resolve(false));
                })} />
              </section>
              <section className={styles.panel}><h3>{selectedTeam?.name || '전체'} 공유 자료 · {displayResources.length}</h3>{!displayResources.length && <p className={styles.panelEmpty}>공유한 자료가 아직 없습니다. 보고서·문서·메일도 [팀에 공유]로 올릴 수 있어요.</p>}
                {displayResources.length > 0 && <div className={styles.resourceFilters} role="search" aria-label="공유 자료 찾기">
                  <label>제목으로 찾기<input type="search" value={resourceQuery} maxLength={80} onChange={(event) => setResourceQuery(event.target.value)} placeholder="예: 주간 보고" /></label>
                  <label>종류<select aria-label="공유 자료 종류" value={resourceKind} onChange={(event) => setResourceKind(event.target.value as 'all' | CompanyResource['kind'])}><option value="all">모두</option><option value="material">공유한 결과·자료</option><option value="work_note">업무 노트</option></select></label>
                </div>}
                {filteringResources && <p className={styles.filterHint} role="status">{shownResources.length ? '불러온 자료 ' + displayResources.length + '개 중 ' + shownResources.length + '개' : '찾는 자료가 없어요. 검색어나 종류를 바꿔 보세요.'}{resources.length >= RESOURCE_PAGE && moreResourcesState !== 'done' ? ' · 더 오래된 자료는 아래에서 더 불러올 수 있어요.' : ''}</p>}
                {shownResources.map((resource) => <article key={resource.id} className={styles.resourceItem} data-resource-kind={resource.kind}><h4>{resource.title}</h4><small>{resourceKindLabel(resource.kind)} · {resource.authorName} · {timeLabel(resource.updatedAtEpochMs || resource.createdAtEpochMs)}</small><SafeLinkText text={resource.text} />
                  <div className={styles.buttonRow}><button type="button" className={styles.smallButton} onClick={()=>openWorkspaceFiles({companyId,teamId,resourceId:resource.id})}>옆에서 자료 열기</button>
                  {(isAdmin || resource.authorUid === session.uid) && <><button type="button" className={styles.smallButton} onClick={() => { setNote({ id: resource.id, title: resource.title, text: resource.text }); setNoteKind(resource.kind === 'material' ? 'material' : 'work_note'); }}>수정</button><button type="button" className={styles.smallButton} onClick={() => setConfirmDelete(resource.id)}>삭제</button></>}</div>
                  {confirmDelete === resource.id && <div className={styles.confirmBox}><p>이 공유 자료를 팀에서 삭제할까요?</p><button type="button" className={styles.btnDangerSolid} disabled={Boolean(busy)} onClick={() => void run('delete-resource', () => deleteCompanyResource(session, companyId, teamId, resource.id), () => { setConfirmDelete(''); setOlderResources((old) => old.filter((item) => item.id !== resource.id)); })}>공유 자료 삭제</button><button type="button" className={styles.btn} onClick={() => setConfirmDelete('')}>취소</button></div>}
                </article>)}
                {resources.length >= RESOURCE_PAGE && moreResourcesState !== 'done' && <div className={styles.buttonRow}><button type="button" className={styles.btn} onClick={() => void loadMoreResources()} disabled={moreResourcesState === 'loading'}>{moreResourcesState === 'loading' ? '자료를 더 불러오는 중…' : '공유 자료 더 보기'}</button></div>}
              </section>
            </div>}

            {tab === 'members' && <div className={styles.stack}>
              <section className={styles.panel}><h3>함께 일하는 구성원 · {activeMembers.length}</h3><div className={styles.memberList}>{activeMembers.map((member) => <article key={member.uid} className={styles.memberRow}>
                <span className={styles.avatar} data-tone={avatarTone(member.uid)} aria-hidden="true">{initialOf(member.displayName || member.email)}</span>
                <div className={styles.memberInfo}><strong>{member.displayName || member.email}</strong><p>{member.email}</p><small>{roleLabel(member.role)}</small></div>
                <div className={styles.memberActions}>
                  {member.uid!==session.uid&&<button type="button" className={styles.smallButton} disabled={Boolean(busy)} onClick={()=>void run('start-direct',()=>startCompanyConversation(session,companyId,{kind:'direct',memberIds:[member.uid]}),openConversation)}>1대1 대화</button>}
                  {isAdmin && member.role !== 'owner' && member.uid !== session.uid && <label className={styles.roleSelect}>권한<select aria-label={(member.displayName || member.email) + '님의 권한'} value={member.role} disabled={Boolean(busy)} onChange={(event) => { const role = event.target.value as 'admin' | 'member'; void run('member-role', () => updateCompanyMember(session, companyId, member.uid, { role }), () => setNotice({ text: (member.displayName || member.email) + '님의 권한을 ' + roleLabel(role) + '로 바꿨어요.' })); }}><option value="member">멤버</option><option value="admin">관리자</option></select></label>}
                  {isAdmin && member.role !== 'owner' && member.uid !== session.uid && <button type="button" className={styles.btnDanger} onClick={() => setConfirmRemove(member.uid)}>구성원 제거</button>}
                </div>
                {confirmRemove === member.uid && <div className={styles.confirmBox}><p>{member.displayName || member.email}님의 회사 접근을 해제할까요? 개인 계정은 유지됩니다.</p><button type="button" className={styles.btnDanger} disabled={Boolean(busy)} onClick={() => void run('remove-member', () => updateCompanyMember(session, companyId, member.uid, { status: 'removed' }), () => setConfirmRemove(''))}>회사에서 제거</button><button type="button" className={styles.btn} onClick={() => setConfirmRemove('')}>취소</button></div>}
              </article>)}</div></section>
              {isAdmin && <div className={styles.split}>
                <details className={styles.panel}><summary>직원 계정 직접 만들기 · 추가 방법</summary><h3>직원 계정 직접 만들기</h3><p className={styles.panelLead}>새 직원에게 사용할 이메일과 임시 비밀번호를 알려 주세요.</p>
                  <form className={styles.fieldStack} onSubmit={(event) => { event.preventDefault(); const input = { ...newEmployee }; setNewEmployee((value) => ({ ...value, password: '' })); void run('create-employee', () => createCompanyEmployee(session, companyId, input), () => { setNewEmployee({ displayName: '', email: '', password: '', role: 'member' }); setNotice({ text: '직원 계정을 만들었습니다. 직원에게 초기 로그인 정보를 전달하고, 첫 로그인 뒤 설정의 내 프로필에서 비밀번호를 바꾸도록 알려 주세요.' }); }); }}>
                    <label>직원 이름<input value={newEmployee.displayName} maxLength={80} onChange={(event) => setNewEmployee({ ...newEmployee, displayName: event.target.value })} required /></label>
                    <label>직원 이메일<input type="email" value={newEmployee.email} onChange={(event) => setNewEmployee({ ...newEmployee, email: event.target.value })} autoComplete="off" required /></label>
                    <label>직원 임시 비밀번호<input type="password" value={newEmployee.password} minLength={8} maxLength={128} autoComplete="new-password" onChange={(event) => setNewEmployee({ ...newEmployee, password: event.target.value })} required /></label>
                    <label>직원 권한<select value={newEmployee.role} onChange={(event) => setNewEmployee({ ...newEmployee, role: event.target.value as 'admin' | 'member' })}><option value="member">멤버</option><option value="admin">관리자</option></select></label>
                    <button className={styles.btnPrimary} disabled={Boolean(busy) || newEmployee.password.length < 8}>직원 계정 만들기</button>
                  </form>
                  <p className={styles.panelNote}>직원은 첫 로그인 뒤 설정의 내 프로필에서 임시 비밀번호를 직접 바꿀 수 있어요.</p>
                </details>
                <section className={styles.panel} id="company-invite"><h3>직원을 회사로 초대</h3><p className={styles.panelLead}>이미 가입한 직원은 초대 코드로 연결할 수 있습니다.</p>
                  <form className={styles.fieldStack} onSubmit={(event) => { event.preventDefault(); void run('create-invite', () => createCompanyInvite(session, companyId, { email: inviteEmail.trim() || undefined, role: 'member' }), setIssuedInvite); }}>
                    <label>초대할 이메일 (선택)<input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} autoComplete="off" /></label>
                    <button className={styles.btn} disabled={Boolean(busy)}>멤버 초대 코드 만들기</button>
                  </form>
                  {issuedInvite && <div className={styles.inviteBox} role="status"><strong>초대 코드</strong><code>{issuedInvite.code}</code><small>{timeLabel(issuedInvite.expiresAtEpochMs)}까지 사용 가능</small><button type="button" className={styles.btn} disabled={Boolean(busy)} onClick={() => void run('copy-invite', async () => { try { await navigator.clipboard.writeText(issuedInvite.code); } catch { throw new Error('초대 코드를 복사하지 못했습니다. 코드를 선택해 직접 복사해 주세요.'); } }, () => setNotice({ text: '초대 코드를 복사했습니다.' }))}>초대 코드 복사</button><p>초대할 직원에게 이 코드를 전달하세요.</p></div>}
                </section>
              </div>}
              <section className={styles.panel}><h3>업무 팀</h3><div className={styles.teamList}>{(isAdmin ? teams : availableTeams).map((team) => <article key={team.id} className={styles.teamRow}><div><strong>{team.name}</strong><p>{team.visibility === 'company' ? '회사 전체 구성원' : team.memberIds.length + '명의 지정 멤버'}</p>{team.visibility === 'private' && !team.memberIds.includes(session.uid) && <small>참여 멤버로 지정된 뒤 이 팀의 대화와 AI를 사용할 수 있습니다.</small>}</div>{isAdmin && team.id !== 'general' && <button type="button" className={styles.smallButton} onClick={() => editTeam(team)}>팀 멤버 관리</button>}</article>)}</div>
                {isAdmin && <form className={styles.fieldStack + ' ' + styles.teamForm} onSubmit={(event) => { event.preventDefault(); const input = { name: teamName.trim(), visibility: 'private' as const, memberIds: teamMemberIds }; void run('save-team', async () => { if (editingTeamId) await updateCompanyTeam(session, companyId, editingTeamId, input); else await createCompanyTeam(session, companyId, input); }, () => { setEditingTeamId(''); setTeamName(''); setTeamMemberIds([]); setNotice({ text: '팀 구성을 저장했습니다.' }); }); }}>
                  <h4>{editingTeamId ? '팀 구성 수정' : '새 팀 만들기'}</h4><label>팀 이름<input value={teamName} maxLength={80} onChange={(event) => setTeamName(event.target.value)} required /></label>
                  <fieldset className={styles.memberChoices}><legend>참여할 구성원</legend>{activeMembers.map((member) => <label key={member.uid}><input type="checkbox" checked={teamMemberIds.includes(member.uid)} onChange={(event) => setTeamMemberIds((value) => event.target.checked ? [...value, member.uid] : value.filter((id) => id !== member.uid))} />{member.displayName || member.email}</label>)}</fieldset>
                  <div className={styles.buttonRow}><button className={styles.btnPrimary} disabled={Boolean(busy) || !teamName.trim()}>{editingTeamId ? '팀 구성 저장' : '지정 멤버로 팀 만들기'}</button>{editingTeamId && <button type="button" className={styles.btn} onClick={() => { setEditingTeamId(''); setTeamName(''); setTeamMemberIds([]); }}>수정 취소</button>}</div>
                </form>}
              </section>
            </div>}

            {tab === 'ai' && <section className={styles.panel}><h3>회사 메인 PC의 AI</h3>
              <div className={styles.hostStatus}><span className={styles.statusDot} data-online={online} /><div className={styles.hostText}><strong>{host?.label || '아직 지정한 PC가 없습니다'}</strong><p>{host?.enabled ? online ? '온라인 · 팀의 AI 요청을 처리할 수 있습니다.' : '오프라인 · 지정한 PC에서 앱을 열어 주세요.' : '공유가 중지되어 있습니다.'}</p>{host?.heartbeatAtEpochMs ? <small>마지막 연결 {timeLabel(host.heartbeatAtEpochMs)}</small> : null}</div></div>
              {hostIssueText && hostIssue && <div className={styles.hostIssue} role="status"><strong>이 PC에서 최근 막힌 일</strong><p>{hostIssueText}</p><small>{timeLabel(hostIssue.at)} · 동료에게는 일반 안내만 보여요.</small></div>}
              <p className={styles.panelLead}>메인 PC에 이미 연결한 AI가 회사의 팀 대화와 공유 자료를 참고해 답변합니다. 요청을 처리하는 동안 해당 PC에서 ModyCrew를 켜 두세요.</p>
              {isAdmin && <div className={styles.buttonRow + ' ' + styles.hostActions}><button type="button" className={styles.btnPrimary} disabled={Boolean(busy) || device?.kind !== 'desktop_app'} onClick={() => { if (device) void run('set-host', () => saveCompanyHost(session, companyId, { uid: session.uid, deviceId: device.id, label: device.label, enabled: true }), () => setNotice({ text: '이 PC를 회사 메인 PC로 지정했습니다. AI 연결 상태와 온라인 표시를 확인하세요.' })); }}>이 PC의 AI를 회사에 공유</button><button type="button" className={styles.btn} disabled={Boolean(busy) || !host?.enabled} onClick={() => { if (host) void run('stop-host', () => saveCompanyHost(session, companyId, { uid: host.uid, deviceId: host.deviceId, label: host.label, enabled: false }), () => setNotice({ text: '회사 AI 공유를 중지했습니다.' })); }}>회사 AI 공유 중지</button></div>}
              {isAdmin && device?.kind !== 'desktop_app' && <p className={styles.panelNote}>회사 메인 PC 지정은 AI를 연결한 설치 앱에서 진행하세요.</p>}
              {!isAdmin && <p className={styles.panelNote}>메인 PC 지정과 공유 중지는 회사 관리자에게 요청하세요.</p>}
              <div className={styles.boundary}><h4>회사와 개인 업무의 저장 범위</h4><p>이 화면의 팀 대화, AI 결과, 직접 공유한 업무 노트가 회사에 저장됩니다. 개인 PC 파일과 개인 업무 자료는 자동으로 올리지 않습니다.</p><p>개인 AI를 선택해도 이 회사 화면에서 만든 결과는 팀과 공유됩니다. 개인 업무는 ‘내 업무로 돌아가기’에서 계속하세요.</p></div>
            </section>}
          </div>
        </>}
      </div>
    </div>
  </div>;
}
