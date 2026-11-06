type DocumentDraftDisplayInput = {
  learnedDraftWorkItems?: readonly unknown[];
  learnedOutputDrafts?: readonly unknown[];
  learnedDraftInboxResult?: { status?: string; stagedItemIds?: readonly string[] };
};

/** Only IDs confirmed by the local inbox writer may be presented as staged. */
export function documentDraftDisplay(result: DocumentDraftDisplayInput | null | undefined) {
  const candidateCount = result?.learnedDraftWorkItems?.length ?? result?.learnedOutputDrafts?.length ?? 0;
  const stagedIds = [...new Set((result?.learnedDraftInboxResult?.stagedItemIds ?? []).filter((id) => typeof id === "string" && id.length > 0))];
  const stagedCount = stagedIds.length;
  const reviewRequired = result?.learnedDraftInboxResult?.status === "learned_output_drafts_review_required" || candidateCount > stagedCount;
  return { candidateCount, stagedIds, stagedCount, reviewRequired };
}
