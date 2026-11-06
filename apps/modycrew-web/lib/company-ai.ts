"use client";

import { createDesktopBridge } from "./desktop-bridge";
import { getCurrentDeviceProfile } from "./account-device-sync";
import type { ModyAuthSession } from "./firebase-client";
import { enqueueCompanyAIRequest, readCompanyAIContext, sendCompanyMessage, renewCompanyAIClaim, completeCompanyAIRequest } from "./company-client";
import type { CompanyAIRequest } from "./company-types";
import { buildCompanyPrompt } from "./company-context.mjs";
import { reportCompanyHostIssue, reportCompanyHostOk } from "./company-host-status.mjs";

async function generateCompanyAnswer(session: ModyAuthSession, companyId: string, teamId: string, prompt: string, requesterUid: string, isCurrent: () => boolean) {
  if (!isCurrent()) throw new Error("회사 또는 계정이 바뀌었습니다. 다시 요청해 주세요.");
  if (getCurrentDeviceProfile().kind !== "desktop_app") throw new Error("내 PC AI는 설치한 모디크루에서 연결해 주세요.");
  const context = await readCompanyAIContext(session, companyId, {teamId, requesterUid, text:prompt});
  if (!isCurrent()) throw new Error("회사 또는 계정이 바뀌었습니다.");
  const result = await createDesktopBridge().generateAIText({
    prompt: buildCompanyPrompt({companyId, teamId, prompt, ...context}),
    executionContext: {source:"company_shared_workspace",externalMutationAllowed:false},
  });
  if (!isCurrent()) throw new Error("실행 중 계정 또는 회사 연결이 바뀌어 결과를 게시하지 않았습니다.");
  if (result.status !== "generate_content_loaded" || !result.outputText?.trim()) {
    // Provider diagnostics may contain local paths. Only show a general recovery instruction to coworkers.
    throw new Error("연결한 AI에서 답변을 받지 못했습니다. 실행 PC의 AI 연결과 선택한 모델을 확인해 주세요.");
  }
  return result.outputText.trim().slice(0,16000);
}

export async function requestWorkspaceAI({session,companyId,teamId,prompt,mode,isCurrent}: {
  session:ModyAuthSession; companyId:string; teamId:string; prompt:string; mode:"company"|"personal"; isCurrent:()=>boolean;
}): Promise<{id:string;status:"queued"|"completed"}> {
  if (!isCurrent()) throw new Error("현재 회사와 팀을 다시 확인해 주세요.");
  if (mode === "company") {
    const request = await enqueueCompanyAIRequest(session,companyId,teamId,prompt,{isCurrent});
    return {id:request.id,status:"queued"};
  }
  const text = await generateCompanyAnswer(session,companyId,teamId,prompt,session.uid,isCurrent);
  const message = await sendCompanyMessage(session,companyId,teamId,{kind:"personal_ai",text,requestText:prompt},{isCurrent});
  return {id:message.id,status:"completed"};
}

export async function processClaimedCompanyAI(session:ModyAuthSession,companyId:string,request:CompanyAIRequest,deviceId:string,isCurrent:()=>boolean) {
  let valid = true;
  let renewing = false;
  const current = () => valid && isCurrent();
  const renewal = window.setInterval(() => {
    if (renewing || !current()) return;
    renewing = true;
    void renewCompanyAIClaim(session,companyId,request.id,deviceId,request.claimId)
      .catch((error) => { valid=false; reportCompanyHostIssue(companyId,"renew",error); }).finally(() => { renewing=false; });
  },40000);
  try {
    const outputText = await generateCompanyAnswer(session,companyId,request.teamId,request.text,request.requesterUid,current);
    if (current()) {
      await completeCompanyAIRequest(session,companyId,request.id,deviceId,request.claimId,{outputText});
      reportCompanyHostOk(companyId,"process");
    }
  } catch (error) {
    // Coworkers get a general instruction; the real cause stays on this PC's 'AI 연결' tab.
    reportCompanyHostIssue(companyId,"process",error);
    if (current()) await completeCompanyAIRequest(session,companyId,request.id,deviceId,request.claimId,{
      errorMessage:"메인 PC의 AI가 작업을 마치지 못했습니다. AI 연결과 회사·팀 권한을 확인한 뒤 다시 요청해 주세요.",
    }).catch((completion) => reportCompanyHostIssue(companyId,"complete",completion));
  } finally {
    valid=false;
    window.clearInterval(renewal);
  }
}
