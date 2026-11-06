import { createDesktopPlatformContract } from "./platform-contract.mjs";
import { modyDesktopSecurityPolicy } from "./security-policy.mjs";
import { createStartupPlan, modyDesktopServiceBoundary } from "./service-boundary.mjs";

export function createModyDesktopBootstrapPlan() {
  return {
    contract: createDesktopPlatformContract(),
    security: modyDesktopSecurityPolicy,
    boundary: modyDesktopServiceBoundary,
    startupPlan: createStartupPlan(),
  };
}

function validateBootstrapPlan(plan) {
  const failures = [];

  if (plan.contract.sourceModel !== "source-owned desktop app") {
    failures.push("desktop source model must be source-owned");
  }
  if (!plan.contract.packaging.codeSigningRequiredBeforeRelease) {
    failures.push("code signing must be required before release");
  }
  if (!plan.contract.packaging.updateFeedRequiresSignature) {
    failures.push("update feed signature must be required");
  }
  if (!plan.contract.aiConnection.supportedModes.includes("API key")) {
    failures.push("AI API key mode is missing");
  }
  if (!plan.contract.aiConnection.supportedModes.includes("OAuth PKCE")) {
    failures.push("AI OAuth PKCE mode is missing");
  }
  if (!plan.security.localSecretsNeverInRenderer) {
    failures.push("renderer secret storage must be forbidden");
  }
  if (!plan.contract.connectorBoundary.approvalBeforeExternalMutation) {
    failures.push("connector mutation must require approval");
  }

  return failures;
}

if (process.argv.includes("--mody-smoke-platform-contract")) {
  const plan = createModyDesktopBootstrapPlan();
  const failures = validateBootstrapPlan(plan);
  console.log(JSON.stringify({
    status: failures.length === 0 ? "production_platform_contract_ready" : "production_platform_contract_failed",
    failures,
    appId: plan.contract.appId,
    installer: plan.contract.packaging.primaryInstaller,
    updater: plan.contract.packaging.updater,
    aiModes: plan.contract.aiConnection.supportedModes,
    billing: plan.contract.billing.strategy,
    preBusinessSigningMode: plan.contract.packaging.preBusinessSigningMode,
    preBusinessBillingMode: plan.contract.billing.preBusinessMode,
    koreaPaymentCandidates: plan.contract.billing.koreaLivePaymentCandidates,
    auth: plan.contract.account.identityProvider,
    startupChecks: plan.startupPlan.length,
  }, null, 2));
  process.exit(failures.length === 0 ? 0 : 1);
}
