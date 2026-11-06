export const builtInWorkspaceSkillTrustedHosts = Object.freeze([
  "raw.githubusercontent.com",
]);

export const builtInWorkspaceSkillCatalog = Object.freeze({
  schema: "modycrew.workspace-skill-catalog.v1",
  candidates: Object.freeze([
    Object.freeze({
      skillId: "korean-report-polish",
      title: "한국어 보고서 정리",
      version: "1.0.0",
      publisher: "ModyCrew Korean Work Catalog",
      sourceUrl:
        "https://raw.githubusercontent.com/Ming-gu1021/modycrew-public/main/apps/modycrew-desktop/resources/workspace-skills/korean-report-polish-1.0.0.json",
      license: "ModyCrew App Content",
      integritySha256:
        "a3b36baa76ca7e8652e86872f392b3db6fb1d6d3ff6ecfc735a79641f339e56d",
      trust: "verified_catalog",
      installMode: "portable_user_space",
      supportedWorkPackIds: Object.freeze(["report_cleanup"]),
      requestedCapabilities: Object.freeze([
        "read_selected_workspace",
        "draft_report",
      ]),
      requestedNetworkHosts: Object.freeze([]),
      requestedFolderScope: "selected_workspace_only",
    }),
    Object.freeze({
      skillId: "korean-schedule-coordinator",
      title: "한국어 일정 조율",
      version: "1.0.0",
      publisher: "ModyCrew Korean Work Catalog",
      sourceUrl:
        "https://raw.githubusercontent.com/Ming-gu1021/modycrew-public/main/apps/modycrew-desktop/resources/workspace-skills/korean-schedule-coordinator-1.0.0.json",
      license: "ModyCrew App Content",
      integritySha256:
        "535100601fb3bc675d3d9967e44fcd769d08b78a5bcfeb9097cfbd76f70420cc",
      trust: "verified_catalog",
      installMode: "portable_user_space",
      supportedWorkPackIds: Object.freeze(["schedule_coordination"]),
      requestedCapabilities: Object.freeze([
        "read_selected_workspace",
        "draft_schedule",
      ]),
      requestedNetworkHosts: Object.freeze([]),
      requestedFolderScope: "selected_workspace_only",
    }),
    Object.freeze({
      skillId: "korean-inquiry-response",
      title: "한국어 문의 답변",
      version: "1.0.0",
      publisher: "ModyCrew Korean Work Catalog",
      sourceUrl:
        "https://raw.githubusercontent.com/Ming-gu1021/modycrew-public/main/apps/modycrew-desktop/resources/workspace-skills/korean-inquiry-response-1.0.0.json",
      license: "ModyCrew App Content",
      integritySha256:
        "b121eb49e1a16336f8157037a2aa85d612cca1ff9441e251946dff7cdc73d6fc",
      trust: "verified_catalog",
      installMode: "portable_user_space",
      supportedWorkPackIds: Object.freeze(["inquiry_response"]),
      requestedCapabilities: Object.freeze([
        "read_selected_workspace",
        "draft_mail",
      ]),
      requestedNetworkHosts: Object.freeze([]),
      requestedFolderScope: "selected_workspace_only",
    }),
  ]),
});
