export const modyDesktopPlatformContract = Object.freeze({
  appId: "com.modycrew.desktop",
  productName: "ModyCrew",
  sourceModel: "source-owned desktop app",
  generatedPreviewPolicy: "generated preview app is not production source",
  packaging: {
    primaryInstaller: "NSIS",
    futureInstaller: "MSIX",
    builder: "electron-builder",
    updater: "electron-updater",
    preBusinessSigningMode: "developer_test_signing_or_unsigned_internal_distribution",
    codeSigningRequiredBeforeRelease: true,
    smartScreenReputationRequiredBeforePublicSales: true,
    updateFeedRequiresSignature: true,
    publicAutoUpdateAllowedBeforeSigning: false,
  },
  account: {
    identityProvider: "Firebase Auth Email/Password first, OIDC compatible auth service later",
    currentDesktopAuth: "Firebase Auth",
    supportsOrganizationWorkspace: true,
    supportsDeviceSessionRevocation: true,
    desktopStoresSessionReferenceOnly: true,
  },
  billing: {
    strategy: "Payment provider adapter",
    preBusinessMode: "payment_disabled_private_pilot",
    koreaLivePaymentCandidates: ["Toss Payments", "PortOne", "KG/NICE PG through contract"],
    globalPaymentCandidate: "Stripe only when the legal entity and supported country requirements fit",
    customerPortal: "provider-specific portal or ModyCrew billing portal",
    desktopDoesNotProcessCardsDirectly: true,
    entitlementSource: "cloud license service",
    businessRegistrationRequiredBeforeLivePayments: true,
  },
  aiConnection: {
    apiKeyMode: "API key encrypted in OS keychain",
    oauthMode: "OAuth PKCE",
    supportedModes: ["API key", "OAuth PKCE"],
    tokenMaterialReturnedToRenderer: false,
    localStorageAllowedForSecrets: false,
  },
  connectorBoundary: {
    defaultConnectors: [
      "Gmail",
      "Outlook Mail",
      "Google Calendar",
      "Outlook Calendar",
      "Slack",
      "Telegram",
      "Discord",
      "Notion",
      "Figma",
      "NAVER WORKS",
    ],
    connectorPermissionContract: "read, draft, command, approval_execution, health_repair",
    approvalBeforeExternalMutation: true,
    highRiskTasksRequireAppFinalConfirmation: true,
  },
  observability: {
    auditLogRequired: true,
    piiRedactionRequired: true,
    secretRedactionRequired: true,
    localDiagnosticBundleRequiresUserExport: true,
  },
});

export function createDesktopPlatformContract() {
  return structuredClone(modyDesktopPlatformContract);
}
