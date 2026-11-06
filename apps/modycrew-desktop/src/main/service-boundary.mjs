export const modyDesktopServiceBoundary = Object.freeze({
  desktopApp: {
    owns: ["inbox UI", "approval UI", "local file permission", "OS credential reference", "desktop update check"],
    doesNotOwn: ["card payment processing", "provider OAuth app secrets", "public update feed hosting"],
  },
  cloudService: {
    owns: ["signup", "organization membership", "subscription entitlement", "connector callback", "remote config"],
    recommendedStack: ["Firebase Auth", "Postgres or Firestore service data layer", "payment provider adapter", "server-side connector workers"],
    preBusinessBillingMode: "payment disabled, private pilot, manual license",
    koreaPaymentCandidatesAfterBusinessRegistration: ["Toss Payments", "PortOne", "KG/NICE PG through contract"],
  },
  connectorWorkers: {
    owns: ["provider API clients", "rate limit handling", "webhook verification", "read-only sync", "draft execution request"],
    permissionModel: "connector permission contract",
  },
  localRuntime: {
    owns: ["file watcher", "document parser", "local document learning folder plan", "local report export", "ICS candidate generation", "desktop bridge queue"],
    mutationPolicy: "approval before external mutation",
  },
});

export function createStartupPlan() {
  return [
    "load local config without secrets in renderer",
    "verify app version and update channel",
    "restore account session reference",
    "hydrate connector health without provider token material",
    "open inbox with simple mode first",
    "run local readiness checks in background",
  ];
}
