"use client";

import { useEffect } from "react";
import { onAuthSession } from "@/lib/firebase-client";
import { getCurrentDeviceProfile } from "@/lib/account-device-sync";
import { subscribeCompanyMemberships, subscribeCompanyHost, subscribeCompanyAIQueue, heartbeatCompanyHost, claimCompanyAIRequest, cancelCompanyAIRequest, readCompanyHost } from "@/lib/company-client";
import { processClaimedCompanyAI } from "@/lib/company-ai";
import { canProcessCompanyRequest } from "@/lib/company-context.mjs";
import { companyClock } from "@/lib/company-clock.mjs";
import { reportCompanyHostIssue, reportCompanyHostOk } from "@/lib/company-host-status.mjs";
import { companyHostWatchMode, isThisCompanyHost, staleCompanyRequestMessage, stuckCompanyRequestMessage } from "@/lib/company-host-policy.mjs";
import type { CompanyHost, CompanyAIRequest, CompanyMembership } from "@/lib/company-types";

/** Runs only on an explicitly designated company computer while its owner is signed in. */
export function CompanyHostHeartbeat() {
  useEffect(() => {
    const device = getCurrentDeviceProfile();
    if (device.kind !== "desktop_app") return;
    let mounted=true;
    let generation=0;
    let authStop: (()=>void) | undefined;
    let membershipsStop: (()=>void) | undefined;
    const companies=new Map<string,{stop:()=>void;admin:boolean}>();
    const checks=new Map<string,number>();
    const clear=()=>{ membershipsStop?.(); membershipsStop=undefined; companies.forEach(entry=>entry.stop()); companies.clear(); checks.clear(); };
    void onAuthSession((session)=>{
      generation++;
      clear();
      if (!session || !mounted) return;
      const authGeneration=generation;
      const sessionCurrent=()=>mounted && authGeneration===generation;
      const isMine=(value:CompanyHost|null)=>isThisCompanyHost(value,session.uid,device.id);
      const release=(cid:string)=>{ companies.get(cid)?.stop(); companies.delete(cid); };
      const watch=(cid:string, adminRole:boolean)=>{
        let disposed=false;
        let host:CompanyHost|null=null;
        let hostStop:(()=>void)|undefined;
        let queueStop:(()=>void)|undefined;
        let queueStarting=false;
        let hostGeneration=0;
        let running=false;
        let dirty=false;
        let requests:CompanyAIRequest[]=[];
        const claimFailures=new Map<string,{count:number;first:number}>();
        const current=()=>!disposed && sessionCurrent() && isMine(host);
        const close=async(candidate:CompanyAIRequest,message:string)=>{
          try { await cancelCompanyAIRequest(session,cid,candidate.id,message); claimFailures.delete(candidate.id); reportCompanyHostOk(cid,"close"); }
          catch(error) { reportCompanyHostIssue(cid,"close",error); }
        };
        const drain=async()=>{
          if(running || !current()) { dirty=true; return; }
          running=true;
          const captured=hostGeneration;
          try {
            do {
              dirty=false;
              for(const candidate of requests) {
                if(!current() || captured!==hostGeneration) break;
                // Lease and age checks use the server clock learned from this PC's heartbeats.
                const now=companyClock.serverNow();
                const stale=staleCompanyRequestMessage(candidate,now);
                if(stale) { await close(candidate,stale); continue; }
                if(!canProcessCompanyRequest(candidate,host,device.id,now)) continue;
                try {
                  const claimed=await claimCompanyAIRequest(session,cid,candidate.id,device.id);
                  claimFailures.delete(candidate.id); reportCompanyHostOk(cid,"claim");
                  if(claimed && current() && captured===hostGeneration) await processClaimedCompanyAI(session,cid,claimed,device.id,()=>current() && captured===hostGeneration);
                } catch(error) {
                  // Rules reject changed memberships/hosts; a fresh snapshot usually resolves it. Keep the cause visible.
                  reportCompanyHostIssue(cid,"claim",error);
                  const failure=claimFailures.get(candidate.id) || {count:0,first:Date.now()};
                  failure.count+=1; claimFailures.set(candidate.id,failure);
                  const stuck=stuckCompanyRequestMessage(candidate,failure,now,Date.now());
                  if(stuck) await close(candidate,stuck);
                }
              }
            } while(dirty && current() && captured===hostGeneration);
          } finally { running=false; }
        };
        const tick=()=>{
          if(!current()) return;
          void heartbeatCompanyHost(session,cid,device.id).then(()=>reportCompanyHostOk(cid,"heartbeat")).catch((error)=>reportCompanyHostIssue(cid,"heartbeat",error));
          void drain();
        };
        const timer=window.setInterval(tick,30000);
        const stop=()=>{disposed=true;hostGeneration++;hostStop?.();queueStop?.();window.clearInterval(timer);requests=[];claimFailures.clear();};
        void subscribeCompanyHost(session,cid,(next)=>{
          if(disposed || !sessionCurrent()) return;
          const changed=host?.uid!==next?.uid || host?.deviceId!==next?.deviceId || host?.enabled!==next?.enabled;
          host=next;
          if(changed) {hostGeneration++;queueStop?.();queueStop=undefined;requests=[];claimFailures.clear();}
          // A plain member only watches while this PC is the main PC; membership changes re-check it.
          if(!adminRole && !isMine(next)) { if(companies.get(cid)?.stop===stop) release(cid); return; }
          if(!current()) return;
          // Each heartbeat that comes back sharpens the server-clock estimate; retry waiting work with it.
          if(queueStop || queueStarting) { void drain(); return; }
          queueStarting=true;
          const startedGeneration=hostGeneration;
          void subscribeCompanyAIQueue(session,cid,(rows)=>{if(current() && startedGeneration===hostGeneration){requests=rows;dirty=true;void drain();}},(error)=>{requests=[];reportCompanyHostIssue(cid,"queue",error);})
            .then(unsubscribe=>{if(current() && startedGeneration===hostGeneration) queueStop=unsubscribe;else unsubscribe();})
            .catch((error)=>reportCompanyHostIssue(cid,"queue",error)).finally(()=>{queueStarting=false;});
          tick();
        },()=>{hostGeneration++;host=null;queueStop?.();queueStop=undefined;requests=[];})
          .then(unsubscribe=>{if(!disposed && sessionCurrent()) hostStop=unsubscribe;else unsubscribe();}).catch(()=>undefined);
        return stop;
      };
      const decide=(membership:CompanyMembership)=>{
        const cid=membership.companyId;
        const adminRole=companyHostWatchMode(membership)==="watch";
        const token=(checks.get(cid)||0)+1; checks.set(cid,token);
        if(adminRole) { if(!companies.get(cid)?.admin) { release(cid); companies.set(cid,{stop:watch(cid,true),admin:true}); } return; }
        // Members rarely host (only after an admin who hosted was demoted), so one read decides
        // instead of every employee PC listening to the 30-second heartbeat.
        void readCompanyHost(session,cid).then((value)=>{
          if(!sessionCurrent() || checks.get(cid)!==token) return;
          if(isMine(value)) { if(!companies.has(cid) || companies.get(cid)?.admin) { release(cid); companies.set(cid,{stop:watch(cid,false),admin:false}); } }
          else release(cid);
        }).catch(()=>undefined);
      };
      void subscribeCompanyMemberships(session,(memberships)=>{
        if (!sessionCurrent()) return;
        const ids=new Set(memberships.map(m=>m.companyId));
        companies.forEach((_entry,cid)=>{if(!ids.has(cid)) release(cid);});
        for(const membership of memberships) decide(membership);
      },()=>{companies.forEach(entry=>entry.stop());companies.clear();})
        .then(stop=>{if(sessionCurrent()) membershipsStop=stop;else stop();}).catch(()=>undefined);
    }).then(stop=>{if(mounted) authStop=stop;else stop();}).catch(()=>undefined);
    return ()=>{mounted=false;generation++;authStop?.();clear();};
  },[]);
  return null;
}
