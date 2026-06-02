import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const extensionDir = path.join(root, "extension");
const requiredFiles = [
  "manifest.json",
  "shared.js",
  "resumeParser.js",
  "background.js",
  "contentScript.js",
  "contentStyles.css",
  "popup.html",
  "popup.css",
  "popup.js",
  "options.html",
  "options.css",
  "options.js"
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readExtensionFile(file) {
  return fs.readFileSync(path.join(extensionDir, file), "utf8");
}

for (const file of requiredFiles) {
  assert(fs.existsSync(path.join(extensionDir, file)), `Missing required file: ${file}`);
}

const manifest = JSON.parse(readExtensionFile("manifest.json"));
assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(manifest.action?.default_popup === "popup.html", "default popup is not configured");
assert(manifest.background?.service_worker === "background.js", "background service worker is not configured");
assert(Array.isArray(manifest.permissions), "manifest permissions must be an array");
assert(manifest.permissions.includes("storage"), "storage permission is required");
assert(!manifest.permissions.includes("cookies"), "cookies permission should not be requested");
assert(!manifest.host_permissions, "host_permissions should stay empty; LLM hosts must be optional");
assert(Array.isArray(manifest.optional_host_permissions), "optional_host_permissions must be configured for LLM access");
assert(manifest.optional_host_permissions.includes("https://*/*"), "HTTPS LLM optional permission is missing");

for (const contentScript of manifest.content_scripts || []) {
  for (const file of [...(contentScript.js || []), ...(contentScript.css || [])]) {
    assert(fs.existsSync(path.join(extensionDir, file)), `Manifest references missing file: ${file}`);
  }
}

for (const file of ["shared.js", "resumeParser.js", "background.js", "contentScript.js", "popup.js", "options.js"]) {
  const result = spawnSync(process.execPath, ["--check", path.join(extensionDir, file)], { encoding: "utf8" });
  assert(result.status === 0, `Syntax check failed for ${file}\n${result.stderr || result.stdout}`);
}

for (const file of ["popup.html", "options.html"]) {
  const html = readExtensionFile(file);
  assert(!/<script(?![^>]*\bsrc=)[^>]*>/iu.test(html), `${file} contains inline script`);
  assert(!/\son\w+=/iu.test(html), `${file} contains inline event handlers`);
  assert(!/<(?:script|link|img|iframe|object|embed)\b[^>]+(?:src|href)=["']https?:\/\//iu.test(html), `${file} loads remote assets`);
}

const joinedSource = requiredFiles.map((file) => readExtensionFile(file)).join("\n");
assert(!/\beval\s*\(/u.test(joinedSource), "eval() is not allowed");
assert(!/sk-[a-z0-9_-]{10,}/iu.test(joinedSource), "Potential hardcoded API key found");
assert(!/api[_-]?key\s*[:=]\s*['"][^'"]{8,}/iu.test(joinedSource), "Potential hardcoded api key assignment found");
assert(!/chrome\.cookies/u.test(joinedSource), "chrome.cookies should not be used");

const context = {
  console,
  globalThis: null,
  URL,
  setTimeout,
  clearTimeout
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(readExtensionFile("shared.js"), context, { filename: "shared.js" });
assert(context.AutoApplyShared, "shared API was not attached");

const settings = context.AutoApplyShared.mergeSettings({
  profile: {
    expectedRole: "Python 后端",
    expectedCity: "上海",
    skills: "Flask, PostgreSQL",
    resumeText: "姓名: 张三\n手机: 13800138000\n邮箱: test@example.com\n技能: Python, Flask, PostgreSQL"
  },
  filters: { includeKeywords: "Python, Flask", excludeKeywords: "培训", minScore: 70 },
  llm: {
    enabled: true,
    baseUrl: "https://api.openai.com/v1",
    model: "test-model",
    minScore: 75,
    allowSendingResumeToLlm: true
  }
});

const strong = context.AutoApplyShared.scoreJob(
  { siteId: "boss", title: "Python 后端工程师", company: "Example", city: "上海", description: "Flask PostgreSQL" },
  settings
);
const weak = context.AutoApplyShared.scoreJob(
  { siteId: "boss", title: "电话销售", company: "Example", city: "上海", description: "培训 销售" },
  settings
);
assert(strong.score >= 70, `Expected strong job score >= 70, got ${strong.score}`);
assert(weak.score < strong.score, "Excluded weak job should score lower than strong job");

const hints = context.AutoApplyShared.extractProfileHints(settings.profile.resumeText);
assert(hints.name === "张三", "Resume hint parser failed to extract name");
assert(hints.phone === "13800138000", "Resume hint parser failed to extract phone");
assert(hints.email === "test@example.com", "Resume hint parser failed to extract email");
assert(hints.skills.includes("Python"), "Resume hint parser failed to extract skills");

const validation = context.AutoApplyShared.validateLlmConfig(settings.llm);
assert(validation.ok, `Expected LLM config to validate: ${validation.errors.join(", ")}`);
assert(
  validation.endpoint === "https://api.openai.com/v1/chat/completions",
  `Unexpected chat endpoint: ${validation.endpoint}`
);

const localValidation = context.AutoApplyShared.validateLlmConfig({
  baseUrl: "http://localhost:11434/v1",
  model: "local-model"
});
assert(localValidation.ok, `Expected localhost LLM config to validate: ${localValidation.errors.join(", ")}`);
assert(localValidation.originPattern === "http://localhost/*", "Localhost permission pattern should not include a port");

const redacted = context.AutoApplyShared.redactSettings({ llm: { apiKey: "token" } });
assert(redacted.llm.apiKey === "", "redactSettings must remove llm.apiKey");

const llmApplyScore = context.AutoApplyShared.effectiveApplicationScore(
  { score: 31, llmScore: 85, combinedScore: 66, llmDecision: "apply" },
  settings
);
assert(llmApplyScore === 85, `LLM apply score should use the LLM score, got ${llmApplyScore}`);

const automationSettings = context.AutoApplyShared.mergeSettings({
  filters: {
    maxDailySubmissions: 999
  },
  automation: {
    autoCollectBeforeApply: true,
    maxJobsPerRun: 999,
    collectionMaxScrolls: 999,
    collectionMaxPages: 999,
    collectionScrollDelayMs: 1,
    collectionClickNextPage: true
  }
});
assert(automationSettings.automation.autoCollectBeforeApply === true, "Auto collection flag should be preserved");
assert(automationSettings.automation.collectionClickNextPage === true, "Next-page collection flag should be preserved");
assert(automationSettings.automation.collectionMaxScrolls === 80, "Collection scroll limit should be clamped");
assert(automationSettings.automation.collectionMaxPages === 15, "Collection page limit should be clamped");
assert(automationSettings.automation.collectionScrollDelayMs === 250, "Collection delay should be clamped");
assert(automationSettings.filters.maxDailySubmissions === 150, "Daily submission limit should allow BOSS 150 cap");
assert(automationSettings.automation.maxJobsPerRun === 150, "Single automation run should allow a 150-job queue");

const backgroundSource = readExtensionFile("background.js");
assert(backgroundSource.includes("function uniqueJobs"), "Automation queue must dedupe jobs before applying");
assert(backgroundSource.includes("function semanticJobKey"), "Automation queue should dedupe semantic job duplicates");
assert(backgroundSource.includes("uniqueJobs(scored)"), "Automation queue should be built from deduped scored jobs");
assert(
  backgroundSource.includes('tabsCreate({ url: "about:blank", active: Boolean('),
  "Automation should create one reusable worker tab"
);
assert(
  backgroundSource.includes("function applyJobInWorker") &&
    backgroundSource.includes("applyTabUpdateProperties(job.url, settings)"),
  "Automation should navigate the reusable worker tab for each job"
);
assert(!backgroundSource.includes("tabsCreate({ url: job.url"), "Automation must not open one tab per job");

const popupSource = readExtensionFile("popup.js");
assert(popupSource.includes("force: true"), "Popup auto apply must explicitly authorize a user-triggered run");
assert(
  backgroundSource.includes("message.sourceTabId ?? sender.tab?.id ?? null"),
  "Automation should infer the source tab for content-script initiated runs"
);
assert(
  backgroundSource.includes("isBlockingAutomationError"),
  "Automation should continue after non-blocking per-job failures"
);
assert(
  backgroundSource.includes("const llmBatchSize = 20") &&
    backgroundSource.includes("index += llmBatchSize"),
  "LLM scoring should batch through all collected jobs instead of only the first page slice"
);
assert(
  backgroundSource.includes("START_AGENT_AUTO_APPLY") &&
    backgroundSource.includes("function buildBossAgentPlan") &&
    backgroundSource.includes("function runAgentAutomation"),
  "Popup auto apply should start a background agent that can search and page through BOSS jobs"
);
assert(
  backgroundSource.includes("function isUsefulAgentQuery") &&
    backgroundSource.includes("\\u4e92\\u8054\\u7f51\\u884c\\u4e1a") &&
    backgroundSource.indexOf("...includeTerms") < backgroundSource.indexOf("...roleTerms"),
  "Agent search should prioritize concrete skills and skip broad industry/profile terms"
);
assert(
  backgroundSource.includes("function mergeApplicationHistory") &&
    backgroundSource.includes("entry.url || entry.id") &&
    backgroundSource.includes("preserveHistory: false"),
  "Settings saves should not overwrite application history, while clear history must still work"
);
assert(
  backgroundSource.includes("focusApplyTab") &&
    backgroundSource.includes("function verifyPostApplyResult") &&
    backgroundSource.includes("BOSS chat page opened after navigation"),
  "Application worker tabs should run in the foreground and re-check BOSS chat navigation after clicks"
);
assert(
  backgroundSource.includes("function collectionWarmupDelayMs") &&
    backgroundSource.includes("scrollDelay * 8") &&
    backgroundSource.includes("await wait(collectionWarmupDelayMs(settings))"),
  "Agent collection should wait for dynamic job lists to settle before scanning"
);
assert(
  backgroundSource.includes('workerTab = await tabsCreate({ url: "about:blank", active: false })') &&
    backgroundSource.includes("await tabsUpdate(sourceTabId, { url: target.url, active: true })"),
  "Agent collection should keep the search tab in the foreground and only focus worker tabs during apply"
);

const contentSource = readExtensionFile("contentScript.js");
assert(
  contentSource.includes("detectBlockingState({ actionAvailable: Boolean(actionButton) })"),
  "Apply flow should not treat optional resume prompts as hard blockers when an action button is available"
);
assert(
  contentSource.includes("function scoreScrollableCandidate") &&
    contentSource.includes("candidate.cardCount * 10000") &&
    contentSource.includes("document.documentElement.scrollHeight > window.innerHeight + 120"),
  "Collection should prioritize the scroll container that owns visible job cards"
);
assert(
  contentSource.includes("function finishApplicationFlow") &&
    contentSource.includes("findFollowupActionButton") &&
    contentSource.includes("detectApplicationSuccess"),
  "Apply flow should handle post-click confirmations and success states"
);
assert(
  contentSource.includes("function resolveClickableElement") &&
    contentSource.includes("target.focus?.()"),
  "Apply flow should click the real nested button/link instead of a styled wrapper"
);
assert(
  contentSource.includes("/\\/web\\/geek\\/chat"),
  "BOSS chat navigation should be treated as a successful communication state"
);
assert(
  contentSource.includes("await new Promise((resolve) =>") &&
    contentSource.includes('type: "LOG_APPLICATION"'),
  "Apply flow should wait for local application history to be written"
);
assert(
  popupSource.includes("START_AGENT_AUTO_APPLY"),
  "Popup auto apply button should launch the background agent"
);

console.log("Extension verification passed.");
