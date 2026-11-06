import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "..", "..", "..", "..");

function resolveResourcePath(...segments) {
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, ...segments);
    if (existsSync(packaged)) return packaged;
  }
  return null;
}

function resolveWritableOutputDir() {
  const baseDir =
    process.env.MODYCREW_OUTPUT_DIR ||
    process.env.APPDATA ||
    process.env.LOCALAPPDATA ||
    path.join(repoRoot, "tmp");
  return path.join(baseDir, "ModyCrew", "local-live-workflow");
}

const defaultSamplePath =
  resolveResourcePath("sample-data", "local-live-workflow", "sample-intake.json") ??
  path.join(repoRoot, "sample-data", "local-live-workflow", "sample-intake.json");
const defaultOutputDir = resolveWritableOutputDir();
const defaultDomainEntryPath =
  resolveResourcePath("domain", "index.js") ??
  path.join(repoRoot, "packages", "domain", "dist", "index.js");

function assertSafeOutputDir(outputDir) {
  const resolved = path.resolve(outputDir);
  if (!resolved.toLowerCase().includes("local-live-workflow")) {
    throw new Error("Unsafe output directory for local live workflow artifacts.");
  }
  return resolved;
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJsonFile(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function renderReportMarkdown(report, outputDir) {
  const lines = [
    "# ModyCrew Desktop Local Workflow",
    "",
    `- 생성 시각: ${report.createdAt}`,
    `- 전체 상태: ${report.status}`,
    `- 요약: ${report.summary}`,
    `- 읽은 항목: ${report.totalReadItems}`,
    `- 업무 카드: ${report.createdWorkItemsCount}`,
    `- 승인 대기: ${report.approvalQueueCount}`,
    `- 무시 항목: ${report.ignoredItemsCount}`,
    `- 일정 후보 파일: ${report.calendarArtifactCount}`,
    "",
    "## 업무 항목",
  ];

  for (const item of report.workItems) {
    lines.push("");
    lines.push(`### ${item.title}`);
    lines.push("");
    lines.push(`- 출처: ${item.sourceLabel}`);
    lines.push(`- 상태: ${item.status}`);
    lines.push(`- 승인 필요: ${item.approvalRequiredBeforeExternalMutation ? "예" : "아니오"}`);
    lines.push(`- 승인 작업: ${item.approvalOperations.join(", ")}`);
    lines.push(`- 결과 폴더: ${outputDir}`);

    if (item.calendarCandidate) {
      lines.push(
        `- 일정 후보: ${item.calendarCandidate.label} (${item.calendarCandidate.startsAt} - ${item.calendarCandidate.endsAt})`,
      );
    }

    if (item.draftReply) {
      lines.push("");
      lines.push("#### 답장 초안");
      lines.push("");
      lines.push(item.draftReply);
    }
  }

  if (report.intakeReport?.ignoredItems?.length > 0) {
    lines.push("");
    lines.push("## 무시 항목");
    for (const item of report.intakeReport.ignoredItems) {
      lines.push(`- ${item.title}: ${item.reason}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function createSafeFileName(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeArtifactPaths(report, outputDir) {
  const artifacts = [];

  for (const item of report.calendarArtifacts) {
    artifacts.push({
      id: item.id,
      kind: "calendar_ics",
      title: item.sourceWorkItemId,
      path: path.join(outputDir, item.fileName),
    });
  }

  return artifacts;
}

export function createModyCrewLocalLiveWorkflowRuntime(options = {}) {
  const inputPath = path.resolve(options.inputPath ?? defaultSamplePath);
  const outputDir = assertSafeOutputDir(options.outputDir ?? defaultOutputDir);
  const domainEntryPath = path.resolve(options.domainEntryPath ?? defaultDomainEntryPath);
  const fixedNow = options.fixedNow ?? "2026-05-14T09:00:00.000+09:00";

  async function loadDomainModule() {
    if (!existsSync(domainEntryPath)) {
      throw new Error(`ModyCrew domain runtime was not found: ${domainEntryPath}`);
    }
    return import(pathToFileURL(domainEntryPath).href);
  }

  async function run(payload = {}) {
    if (!payload.intake && !existsSync(inputPath)) {
      throw new Error(`Local live workflow input was not found: ${inputPath}`);
    }

    const domain = await loadDomainModule();
    const intake = payload.intake
      ? { inputMode: "user_input", ...payload.intake }
      : { inputMode: "local_fixture", ...readJsonFile(inputPath) };
    const now = payload.now ?? fixedNow;
    const runner = new domain.ModyLocalLiveWorkflowRunner({
      now: () => new Date(now),
    });
    const report = await runner.createReport(intake);

    rmSync(outputDir, { recursive: true, force: true });
    mkdirSync(outputDir, { recursive: true });

    for (const item of report.workItems) {
      if (item.draftReply) {
        const draftName = `${createSafeFileName(item.title || item.id)}-reply-draft.txt`;
        writeFileSync(path.join(outputDir, draftName), item.draftReply, "utf8");
      }
    }

    for (const artifact of report.calendarArtifacts) {
      writeFileSync(path.join(outputDir, artifact.fileName), artifact.icsText, "utf8");
    }

    const reportMarkdownPath = path.join(outputDir, "modycrew-local-workflow-report.md");
    const reportJsonPath = path.join(outputDir, "modycrew-local-workflow-report.json");
    writeFileSync(reportMarkdownPath, renderReportMarkdown(report, outputDir), "utf8");
    writeJsonFile(reportJsonPath, report);

    return {
      status: "desktop_local_live_completed",
      desktopRuntime: "electron_ipc_native",
      userMessage: payload.intake
        ? "데스크톱 앱에서 입력한 업무를 처리하고 로컬 산출물을 생성했습니다."
        : "데스크톱 앱에서 검증 fixture 업무를 처리하고 로컬 산출물을 생성했습니다.",
      inputPath,
      outputDir,
      reportMarkdownPath,
      reportJsonPath,
      artifactPaths: normalizeArtifactPaths(report, outputDir),
      report,
    };
  }

  async function openOutputFolder(shellApi) {
    if (!existsSync(outputDir)) {
      return {
        status: "output_missing",
        outputDir,
        userMessage: "아직 생성된 결과 폴더가 없습니다. 먼저 데스크톱 테스트를 실행하세요.",
      };
    }

    const result = await shellApi.openPath(outputDir);
    return {
      status: result ? "open_failed" : "opened",
      outputDir,
      errorMessage: result || undefined,
      userMessage: result
        ? "결과 폴더를 열지 못했습니다."
        : "데스크톱 결과 폴더를 열었습니다.",
    };
  }

  return {
    inputPath,
    outputDir,
    domainEntryPath,
    run,
    openOutputFolder,
  };
}
