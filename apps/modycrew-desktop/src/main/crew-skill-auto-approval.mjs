   
                                                          
  
                                                                              
                                                                       
                                                                    
  
                                                                 
                                                                            
  
                                                      
                                             
                                               
                                                          
   
export const autoRunnableExecutions = Object.freeze(["agent", "council", "instructions"]);
export const preferredRuntimeOrder = Object.freeze(["codex", "claude"]);

/** 확인 창 정보(info) → 자동 승인 { approved, runtimeId, automatic } 또는 null(확인 창으로 넘긴다). */
export function decideCrewSkillAutoApproval(info, { prefer = preferredRuntimeOrder } = {}) {
  if (!info || info.approvedPlan) return null;
  if (info.profile && info.profile !== "standard") return null;
  if (!autoRunnableExecutions.includes(String(info.execution ?? ""))) return null;
  const ready = (Array.isArray(info.runtimes) ? info.runtimes : []).filter((runtime) => runtime && runtime.loggedIn);
  if (!ready.length) return null;
  const picked = prefer.map((id) => ready.find((runtime) => runtime.id === id)).find(Boolean) ?? ready[0];
  return { approved: true, runtimeId: picked.id, automatic: true };
}

