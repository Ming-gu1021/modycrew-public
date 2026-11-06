import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const MAX_ATTEMPTS = 32;
function filesFor(inboxPath, workItemId, attempt) {
  if (!inboxPath || !workItemId) return null;
  const key = createHash('sha256').update(workItemId, 'utf8').digest('hex');
  const root = path.join(path.dirname(inboxPath), 'mail-send-journal.v1');
  const prefix = path.join(root, `${key}${attempt ? `.${attempt}` : ''}`);
  return { root, key, intent:`${prefix}.intent`, outcome:`${prefix}.outcome` };
}
// Missing/corrupt intent with any outcome is never interpreted as a new request.
// A next attempt is available only after a durably recorded definite no-send.
// "absent" means only that this journal has no entry. Legacy sends whose inbox
// update was lost are not discoverable here; no migration or no-send claim is made.
export function createMailDispatchJournalReader(inboxPath, readDirectory = readdirSync) {
  const initial=filesFor(inboxPath,'scope-probe',0);
  if (!initial) return () => ({status:'unavailable'});
  let entries;
  try { entries=readDirectory(initial.root); }
  catch (error) { const status=error?.code === 'ENOENT' ? 'absent' : 'unavailable'; return () => ({status}); }
  return workItemId => readMailDispatchJournal(inboxPath, workItemId, entries);
}
export function readMailDispatchJournal(inboxPath, workItemId, directorySnapshot) {
  const initial=filesFor(inboxPath,workItemId,0);
  if (!initial) return { status:'unavailable' };
  try {
    let entries;
    try { entries=directorySnapshot ?? readdirSync(initial.root); }
    catch (error) { return error?.code === 'ENOENT' ? {status:'absent',attempt:0} : {status:'unavailable'}; }
    const related=entries.filter(name=>name.startsWith(`${initial.key}.`));
    const pattern=new RegExp(`^${initial.key}(?:\\.([1-9][0-9]*))?\\.(?:intent|outcome)$`);
    if (related.some(name=>!pattern.test(name))) return {status:'uncertain'};
    const highest=Math.max(-1,...related.map(name=>Number(name.match(pattern)[1] ?? 0)));
    for (let attempt=0; attempt<MAX_ATTEMPTS; attempt++) {
      const files=filesFor(inboxPath,workItemId,attempt);
      const hasIntent=entries.includes(path.basename(files.intent)), hasOutcome=entries.includes(path.basename(files.outcome));
      if (!hasIntent && hasOutcome) return { status:'uncertain' };
      if (!hasIntent) return highest > attempt ? {status:'uncertain'} : { status:'absent',attempt };
      if (!hasOutcome) return { status:'uncertain' };
      let outcome;
      try { outcome=JSON.parse(readFileSync(files.outcome,'utf8')); } catch { return {status:'uncertain'}; }
      if (outcome?.version !== 1) return {status:'uncertain'};
      if (outcome.status === 'not_sent') continue;
      if (['sent','partial'].includes(outcome.status)) return {status:outcome.status};
      return {status:'uncertain'};
    }
    return {status:'unavailable'};
  } catch { return {status:'unavailable'}; }
}
function writeExclusive(file,data) {
  const fd=openSync(file,'wx',0o600);
  try { writeFileSync(fd,JSON.stringify(data),'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
}
export function beginMailDispatch(inboxPath, workItemId) {
  const state=readMailDispatchJournal(inboxPath,workItemId);
  if (state.status !== 'absent') return state;
  const files=filesFor(inboxPath,workItemId,state.attempt);
  try { mkdirSync(files.root,{recursive:true}); } catch { return {status:'unavailable'}; }
  try { writeExclusive(files.intent,{version:1,createdAt:new Date().toISOString()}); return {status:'started',attempt:state.attempt}; }
  catch (error) { return error?.code === 'EEXIST' ? readMailDispatchJournal(inboxPath,workItemId) : {status:'unavailable'}; }
}
export function recordMailDispatchOutcome(inboxPath,workItemId,attempt,status) {
  if (!Number.isSafeInteger(attempt) || attempt < 0 || attempt >= MAX_ATTEMPTS || !['sent','partial','not_sent'].includes(status)) return false;
  const files=filesFor(inboxPath,workItemId,attempt); if (!files) return false;
  try { writeExclusive(files.outcome,{version:1,status,recordedAt:new Date().toISOString()}); return true; } catch { return false; }
}
