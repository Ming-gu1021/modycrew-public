export const modyDesktopSecurityPolicy = Object.freeze({
  localSecretsNeverInRenderer: true,
  oauthUsesPkce: true,
  oauthStateRequired: true,
  externalMutationRequiresApproval: true,
  finalUserPresenceRequiredForHighRiskTasks: true,
  codeSigningRequiredBeforeRelease: true,
  updateFeedRequiresSignature: true,
  directShellOpenExternalForbidden: true,
  allowedExternalPurposes: ["ai_oauth_authorization", "connector_oauth_authorization", "billing_customer_portal"],
  allowedIpcNamespaces: [
    "mody.account.v1",
    "mody.billing.v1",
    "mody.ai-provider.v1",
    "mody.connector.v1",
    "mody.local-workflow.v1",
    "mody.selected-work-actions.v1",
    "mody.desktop-control.v1",
    "mody.desktop-update.v1",
    "mody.audit.v1",
  ],
  // main → renderer 신호는 정해 둔 두 채널만. 값은 preload 에서 다시 정리해 넘긴다.
  allowedRendererEventChannels: ["mody.focus-work-item.v1", "mody.inbox.changed"],
});

export function assertAllowedIpcNamespace(namespace) {
  if (!modyDesktopSecurityPolicy.allowedIpcNamespaces.includes(namespace)) {
    throw new Error(`IPC namespace is not allowlisted: ${namespace}`);
  }
  return true;
}
