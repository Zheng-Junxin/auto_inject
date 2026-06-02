(function attachBackground() {
  "use strict";

  importScripts("shared.js");

  const shared = globalThis.AutoApplyShared;
  const SETTINGS_KEY = "autoApplySettings";
  const AUTOMATION_DONE_STATUSES = new Set(["completed", "stopped", "failed", "idle"]);

  let automationState = {
    running: false,
    status: "idle",
    queue: [],
    current: null,
    completed: [],
    failed: [],
    startedAt: "",
    stoppedReason: "",
    workerTabId: null,
    confirmedApply: false,
    mode: "single",
    agent: null
  };

  function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  function storageSet(value) {
    return new Promise((resolve) => chrome.storage.local.set(value, resolve));
  }

  function tabsCreate(createProperties) {
    return new Promise((resolve, reject) => {
      chrome.tabs.create(createProperties, (tab) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(tab);
      });
    });
  }

  function tabsRemove(tabId) {
    return new Promise((resolve) => {
      chrome.tabs.remove(tabId, () => resolve());
    });
  }

  function tabsUpdate(tabId, updateProperties) {
    return new Promise((resolve, reject) => {
      chrome.tabs.update(tabId, updateProperties, (tab) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(tab);
      });
    });
  }

  function tabsGet(tabId) {
    return new Promise((resolve, reject) => {
      chrome.tabs.get(tabId, (tab) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(tab);
      });
    });
  }

  function applyTabUpdateProperties(url, settings) {
    return {
      url,
      active: Boolean(settings.automation.focusApplyTab)
    };
  }

  function collectionWarmupDelayMs(settings) {
    const automation = settings.automation || {};
    const navigationDelay = Number(automation.navigationDelayMs) || 0;
    const scrollDelay = Number(automation.collectionScrollDelayMs) || 0;
    return Math.max(navigationDelay, scrollDelay * 8, 6000);
  }

  function sendTabMessage(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(response || {});
      });
    });
  }

  async function getSettings() {
    const stored = await storageGet(SETTINGS_KEY);
    return shared.mergeSettings(stored[SETTINGS_KEY]);
  }

  function mergeApplicationHistory(...lists) {
    const byKey = new Map();
    for (const entry of lists.flat()) {
      if (!entry || typeof entry !== "object") continue;
      const key = entry.url || entry.id || `${entry.siteId || ""}|${entry.company || ""}|${entry.title || ""}|${entry.createdAt || ""}`;
      if (!key) continue;
      const existing = byKey.get(key);
      const existingTime = existing?.createdAt ? Date.parse(existing.createdAt) || 0 : 0;
      const entryTime = entry.createdAt ? Date.parse(entry.createdAt) || 0 : 0;
      if (!existing || entryTime >= existingTime || (entry.status === "applied" && existing.status !== "applied")) {
        byKey.set(key, entry);
      }
    }
    return Array.from(byKey.values())
      .sort((left, right) => (Date.parse(right.createdAt || "") || 0) - (Date.parse(left.createdAt || "") || 0))
      .slice(0, 500);
  }

  async function saveSettings(nextSettings, { preserveHistory = true } = {}) {
    const merged = shared.mergeSettings(nextSettings);
    if (preserveHistory) {
      const stored = await storageGet(SETTINGS_KEY);
      const current = shared.mergeSettings(stored[SETTINGS_KEY]);
      merged.history.applications = mergeApplicationHistory(
        merged.history.applications || [],
        current.history.applications || []
      );
    }
    await storageSet({ [SETTINGS_KEY]: merged });
    return merged;
  }

  async function logApplication(entry) {
    const settings = await getSettings();
    const applications = Array.isArray(settings.history.applications)
      ? settings.history.applications.slice(0, 499)
      : [];
    applications.unshift({
      id: entry.id || `${Date.now()}`,
      siteId: entry.siteId || "",
      siteName: entry.siteName || "",
      title: entry.title || "",
      company: entry.company || "",
      url: entry.url || "",
      score: Number(entry.score) || 0,
      llmScore: Number(entry.llmScore) || 0,
      combinedScore: Number(entry.combinedScore) || Number(entry.score) || 0,
      status: entry.status || "clicked",
      createdAt: new Date().toISOString()
    });
    settings.history.applications = applications;
    await saveSettings(settings);
    return applications;
  }

  function todaysApplicationCount(settings) {
    const today = new Date().toDateString();
    return (settings.history.applications || []).filter((entry) => {
      if (!entry.createdAt) return false;
      return new Date(entry.createdAt).toDateString() === today;
    }).length;
  }

  function alreadyApplied(settings, job) {
    const targetUrl = String(job.url || "");
    const targetKey = `${job.siteId || ""}|${job.company || ""}|${job.title || ""}`;
    return (settings.history.applications || []).some((entry) => {
      const entryKey = `${entry.siteId || ""}|${entry.company || ""}|${entry.title || ""}`;
      return (targetUrl && entry.url === targetUrl) || entryKey === targetKey;
    });
  }

  function getAutomationSnapshot() {
    return {
      running: automationState.running,
      status: automationState.status,
      queueLength: automationState.queue.length,
      current: automationState.current,
      completed: automationState.completed.slice(-20),
      failed: automationState.failed.slice(-20),
      startedAt: automationState.startedAt,
      stoppedReason: automationState.stoppedReason,
      workerTabId: automationState.workerTabId || null,
      mode: automationState.mode || "single",
      agent: automationState.agent || null
    };
  }

  function validateJobs(jobs) {
    return (Array.isArray(jobs) ? jobs : [])
      .map((job) => ({
        id: String(job.id || shared.makeJobId(job)),
        siteId: String(job.siteId || ""),
        siteName: String(job.siteName || ""),
        title: String(job.title || "").slice(0, 160),
        company: String(job.company || "").slice(0, 160),
        city: String(job.city || "").slice(0, 80),
        salary: String(job.salary || "").slice(0, 80),
        description: String(job.description || "").slice(0, 2500),
        rawText: String(job.rawText || "").slice(0, 2500),
        url: String(job.url || ""),
        score: Number(job.score) || 0,
        confidence: String(job.confidence || ""),
        positives: Array.isArray(job.positives) ? job.positives.slice(0, 10) : [],
        negatives: Array.isArray(job.negatives) ? job.negatives.slice(0, 10) : [],
        llmScore: Number(job.llmScore) || 0,
        combinedScore: Number(job.combinedScore) || 0,
        llmDecision: String(job.llmDecision || ""),
        llmReason: String(job.llmReason || "").slice(0, 300),
        llmCoverLetter: String(job.llmCoverLetter || "").slice(0, 1000)
      }))
      .filter((job) => /^https?:\/\//u.test(job.url));
  }

  function normalizeJobUrl(url) {
    try {
      const parsed = new URL(String(url || "").trim());
      parsed.hash = "";
      return parsed.toString().replace(/\/$/u, "");
    } catch (_error) {
      return String(url || "").trim();
    }
  }

  function jobQueueKey(job) {
    const normalizedUrl = normalizeJobUrl(job.url);
    if (normalizedUrl) return normalizedUrl;
    return [job.siteId, job.company, job.title, job.city].map((part) => String(part || "").trim()).join("|");
  }

  function semanticJobKey(job) {
    return [job.siteId, job.company, job.title, job.city].map((part) => String(part || "").trim().toLowerCase()).join("|");
  }

  function uniqueJobs(jobs) {
    const seen = new Set();
    const unique = [];
    for (const job of validateJobs(jobs)) {
      const keys = [jobQueueKey(job), semanticJobKey(job)].filter(Boolean);
      if (!keys.length || keys.some((key) => seen.has(key))) continue;
      for (const key of keys) seen.add(key);
      unique.push(job);
    }
    return unique;
  }

  function hasMatchingProfile(settings) {
    const profile = settings.profile || {};
    return [profile.resumeText, profile.skills, profile.expectedRole]
      .some((value) => String(value || "").trim().length >= 6);
  }

  function mergeValidatedJobs(targetMap, jobs) {
    for (const job of validateJobs(jobs)) {
      const id = job.id || shared.makeJobId(job);
      if (!targetMap.has(id)) {
        targetMap.set(id, { ...job, id });
      }
    }
  }

  function chromePermissionsContains(details) {
    return new Promise((resolve) => chrome.permissions.contains(details, resolve));
  }

  async function ensureLlmPermission(settings) {
    const validation = shared.validateLlmConfig(settings.llm);
    if (!validation.ok) {
      return { ok: false, error: validation.errors.join("；") };
    }
    const granted = await chromePermissionsContains({ origins: [validation.originPattern] });
    if (!granted) {
      return {
        ok: false,
        needsPermission: true,
        originPattern: validation.originPattern,
        error: `需要授权访问 LLM 地址：${validation.originPattern}`
      };
    }
    return { ok: true, validation };
  }

  async function callChatCompletions(settings, messages) {
    const permission = await ensureLlmPermission(settings);
    if (!permission.ok) {
      const error = new Error(permission.error);
      error.needsPermission = permission.needsPermission;
      error.originPattern = permission.originPattern;
      throw error;
    }

    const { validation } = permission;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), validation.config.timeoutMs);
    const headers = { "Content-Type": "application/json" };
    if (validation.config.apiKey) {
      headers.Authorization = `Bearer ${validation.config.apiKey}`;
    }

    try {
      const response = await fetch(validation.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: validation.config.model,
          messages,
          temperature: 0.1
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        throw new Error(`LLM 请求失败：HTTP ${response.status} ${detail}`);
      }
      return response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function buildLlmMessages(settings, jobs) {
    const profile = settings.profile;
    const compactJobs = jobs.slice(0, 20).map((job) => ({
      id: job.id,
      title: job.title,
      company: job.company,
      city: job.city,
      salary: job.salary,
      url: job.url,
      localScore: job.score,
      text: [job.description, job.rawText].filter(Boolean).join("\n").slice(0, 1600)
    }));

    return [
      {
        role: "system",
        content:
          "你是严谨的招聘匹配助手。只返回 JSON，不返回 Markdown。判断候选人与岗位匹配度，避免误投、低质岗位和与候选人目标明显不符的岗位。"
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            task:
              "请为每个岗位返回 {id, score, decision, reason, coverLetter}。score 为 0-100；decision 只能是 apply、review、skip；reason 30字以内；coverLetter 用中文，120字以内。",
            candidate: {
              name: profile.name,
              expectedRole: profile.expectedRole,
              expectedCity: profile.expectedCity,
              expectedSalary: profile.expectedSalary,
              skills: profile.skills,
              resume: profile.resumeText.slice(0, 6000)
            },
            jobs: compactJobs
          },
          null,
          2
        )
      }
    ];
  }

  function parseLlmJson(content) {
    const text = String(content || "").trim();
    const direct = tryParseJson(text);
    if (direct) return direct;

    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu);
    if (fenced) {
      const parsed = tryParseJson(fenced[1]);
      if (parsed) return parsed;
    }

    const arrayStart = text.indexOf("[");
    const arrayEnd = text.lastIndexOf("]");
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      const parsed = tryParseJson(text.slice(arrayStart, arrayEnd + 1));
      if (parsed) return parsed;
    }

    const objectStart = text.indexOf("{");
    const objectEnd = text.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) {
      const parsed = tryParseJson(text.slice(objectStart, objectEnd + 1));
      if (parsed) return parsed;
    }
    return null;
  }

  function tryParseJson(text) {
    try {
      return JSON.parse(text);
    } catch (_error) {
      return null;
    }
  }

  function normalizeLlmResults(payload) {
    const list = Array.isArray(payload) ? payload : payload?.results || payload?.jobs || [];
    return new Map(
      (Array.isArray(list) ? list : []).map((item) => [
        String(item.id || ""),
        {
          score: Number(item.score),
          decision: String(item.decision || "review"),
          reason: String(item.reason || ""),
          coverLetter: String(item.coverLetter || item.cover_letter || "")
        }
      ])
    );
  }

  async function scoreJobsWithLlm(rawJobs) {
    const settings = await getSettings();
    const jobs = validateJobs(rawJobs);
    if (!jobs.length) {
      return { jobs: [], usedLlm: false, message: "没有可评分岗位" };
    }
    if (!settings.llm.enabled) {
      return { jobs, usedLlm: false, message: "LLM 未启用" };
    }
    if (!settings.llm.allowSendingResumeToLlm) {
      return { jobs, usedLlm: false, message: "未允许向 LLM 发送简历与岗位信息" };
    }

    const resultMap = new Map();
    const llmBatchSize = 20;
    for (let index = 0; index < jobs.length; index += llmBatchSize) {
      const batch = jobs.slice(index, index + llmBatchSize);
      const response = await callChatCompletions(settings, buildLlmMessages(settings, batch));
      const content = response?.choices?.[0]?.message?.content || "";
      const parsed = parseLlmJson(content);
      if (!parsed) {
      throw new Error("LLM 返回内容不是可解析 JSON");
    }

      for (const [id, result] of normalizeLlmResults(parsed)) {
        resultMap.set(id, result);
      }
    }
    const scoredJobs = jobs
      .map((job) => shared.combineLlmScore(job, resultMap.get(job.id), settings))
      .sort((left, right) => (right.combinedScore || right.score) - (left.combinedScore || left.score));

    return { jobs: scoredJobs, usedLlm: true, message: `LLM 已评分 ${scoredJobs.length} 个岗位` };
  }

  async function collectJobsFromTab(tabId, { withLlm = false, highlight = false, maxPages = null, clickNextPage = null } = {}) {
    const settings = await getSettings();
    const numericTabId = Number(tabId);
    if (!Number.isInteger(numericTabId)) {
      throw new Error("未找到可采集的标签页");
    }

    const collected = new Map();
    const pageStats = [];
    let stoppedReason = "";
    const pageLimit = Number.isInteger(maxPages) ? Math.max(1, Math.min(maxPages, settings.automation.collectionMaxPages)) : settings.automation.collectionMaxPages;
    const shouldClickNextPage = typeof clickNextPage === "boolean" ? clickNextPage : settings.automation.collectionClickNextPage;

    for (let pageIndex = 0; pageIndex < pageLimit; pageIndex += 1) {
      const result = await sendMessageWithRetry(numericTabId, {
        type: "COLLECT_CURRENT_PAGE",
        highlight
      });
      if (result.error) {
        throw new Error(result.error);
      }

      mergeValidatedJobs(collected, result.jobs || []);
      pageStats.push({
        page: pageIndex + 1,
        jobs: (result.jobs || []).length,
        total: collected.size,
        nextPageUrl: result.nextPageUrl || "",
        blocked: Boolean(result.blocked && result.blocked.blocked),
        stats: result.stats || {}
      });

      if (result.blocked && result.blocked.blocked && settings.automation.stopOnBlocking) {
        stoppedReason = result.blocked.reason || "页面被登录、验证码或频控阻断";
        break;
      }

      if (!shouldClickNextPage || !result.nextPageUrl) {
        break;
      }
      if (pageIndex >= pageLimit - 1) {
        break;
      }

      await tabsUpdate(numericTabId, { url: result.nextPageUrl });
      await waitForTabReady(numericTabId, 30000);
      await wait(settings.automation.navigationDelayMs);
    }

    let jobs = Array.from(collected.values()).sort((left, right) => (right.score || 0) - (left.score || 0));
    let usedLlm = false;
    let llmMessage = "";
    if (withLlm && settings.llm.enabled && jobs.length) {
      const scored = await scoreJobsWithLlm(jobs);
      jobs = scored.jobs;
      usedLlm = Boolean(scored.usedLlm);
      llmMessage = scored.message || "";
    }

    return {
      jobs,
      usedLlm,
      pageStats,
      stoppedReason,
      message: stoppedReason || llmMessage || `已自动采集 ${jobs.length} 个岗位`
    };
  }

  async function testLlmConfig() {
    const settings = await getSettings();
    const response = await callChatCompletions(settings, [
      { role: "system", content: "只返回 JSON。" },
      { role: "user", content: "{\"ok\":true,\"message\":\"ping\"}" }
    ]);
    return {
      ok: true,
      model: settings.llm.model,
      message: String(response?.choices?.[0]?.message?.content || "连接成功").slice(0, 200)
    };
  }

  function resetAutomation(status = "idle", stoppedReason = "") {
    automationState = {
      running: false,
      status,
      queue: [],
      current: null,
      completed: automationState.completed || [],
      failed: automationState.failed || [],
      startedAt: automationState.startedAt || "",
      stoppedReason,
      workerTabId: null,
      confirmedApply: false,
      mode: "single",
      agent: null
    };
  }

  async function selectApplicableJobs(rawJobs, settings, remainingDaily) {
    const sourceJobs = uniqueJobs(rawJobs);
    if (!sourceJobs.length || remainingDaily <= 0) {
      return { queue: [], usedLlmForQueue: false, sourceCount: sourceJobs.length };
    }

    let scored = sourceJobs;
    let usedLlmForQueue = settings.llm.enabled && sourceJobs.some((job) => job.llmDecision);
    if (settings.llm.enabled && !usedLlmForQueue) {
      const scoredResult = await scoreJobsWithLlm(sourceJobs);
      scored = scoredResult.jobs;
      usedLlmForQueue = Boolean(scoredResult.usedLlm);
    }

    const threshold = usedLlmForQueue ? settings.llm.minScore : settings.filters.minScore;
    const queue = uniqueJobs(scored)
      .filter((job) => {
        const score = shared.effectiveApplicationScore(job, settings);
        if (score < threshold) return false;
        if (usedLlmForQueue && String(job.llmDecision || "").toLowerCase() !== "apply") return false;
        if (String(job.llmDecision || "").toLowerCase() === "skip") return false;
        if (settings.automation.skipAlreadyApplied && alreadyApplied(settings, job)) return false;
        return true;
      })
      .sort((left, right) => {
        const leftScore = shared.effectiveApplicationScore(left, settings);
        const rightScore = shared.effectiveApplicationScore(right, settings);
        return rightScore - leftScore;
      })
      .slice(0, Math.min(settings.automation.maxJobsPerRun, remainingDaily));

    return { queue, usedLlmForQueue, sourceCount: sourceJobs.length };
  }

  async function startAutomation(rawJobs, sourceTabId = null, options = {}) {
    if (automationState.running) {
      return { status: getAutomationSnapshot(), message: "自动化正在运行" };
    }

    const settings = await getSettings();
    const force = Boolean(options.force);
    if (!settings.automation.enabled && !force) {
      return { status: getAutomationSnapshot(), message: "自动化未启用" };
    }

    if (!hasMatchingProfile(settings)) {
      return {
        status: getAutomationSnapshot(),
        message: "请先在设置中上传/解析简历，或填写技能与期望岗位后再自动投递。"
      };
    }

    let sourceJobs = uniqueJobs(rawJobs);
    if (!sourceJobs.length && settings.automation.autoCollectBeforeApply && sourceTabId !== null) {
      const collected = await collectJobsFromTab(sourceTabId, { withLlm: settings.llm.enabled, highlight: false });
      sourceJobs = uniqueJobs(collected.jobs);
    }

    let scored = sourceJobs;
    let usedLlmForQueue = settings.llm.enabled && sourceJobs.some((job) => job.llmDecision);
    if (settings.llm.enabled && !usedLlmForQueue) {
      const scoredResult = await scoreJobsWithLlm(sourceJobs);
      scored = scoredResult.jobs;
      usedLlmForQueue = Boolean(scoredResult.usedLlm);
    }
    const todayCount = todaysApplicationCount(settings);
    const remainingDaily = settings.filters.maxDailySubmissions - todayCount;
    if (remainingDaily <= 0) {
      return { status: getAutomationSnapshot(), message: `今日已达到 ${settings.filters.maxDailySubmissions} 次上限` };
    }

    const threshold = usedLlmForQueue ? settings.llm.minScore : settings.filters.minScore;
    const queue = uniqueJobs(scored)
      .filter((job) => {
        const score = shared.effectiveApplicationScore(job, settings);
        if (score < threshold) return false;
        if (usedLlmForQueue && String(job.llmDecision || "").toLowerCase() !== "apply") return false;
        if (String(job.llmDecision || "").toLowerCase() === "skip") return false;
        if (settings.automation.skipAlreadyApplied && alreadyApplied(settings, job)) return false;
        return true;
      })
      .sort((left, right) => {
        const leftScore = shared.effectiveApplicationScore(left, settings);
        const rightScore = shared.effectiveApplicationScore(right, settings);
        return rightScore - leftScore;
      })
      .slice(0, Math.min(settings.automation.maxJobsPerRun, remainingDaily));

    if (!queue.length) {
      return { status: getAutomationSnapshot(), message: "没有达到自动投递条件的岗位" };
    }

    automationState = {
      running: true,
      status: "running",
      queue,
      current: null,
      completed: [],
      failed: [],
      startedAt: new Date().toISOString(),
      stoppedReason: "",
      workerTabId: null,
      confirmedApply: force || settings.automation.autoClickApply,
      mode: "single",
      agent: null
    };

    runAutomationQueue().catch((error) => {
      automationState.running = false;
      automationState.status = "failed";
      automationState.stoppedReason = error.message || String(error);
    });

    return { status: getAutomationSnapshot(), message: `已启动 ${queue.length} 个岗位的自动处理` };
  }

  async function applyQueuedJobsWithExistingWorker(workerTabId, settings) {
    while (automationState.running && automationState.queue.length) {
      const job = automationState.queue.shift();
      automationState.current = job;

      try {
        const result = await applyJobInWorker(workerTabId, job, settings);

        if (result.alreadyApplied) {
          automationState.completed.push({
            title: job.title,
            company: job.company,
            score: job.combinedScore || job.score,
            status: "alreadyApplied",
            appliedAt: new Date().toISOString()
          });
          continue;
        }

        if (!result.applied) {
          throw new Error(result.reason || "application action was not completed");
        }

        automationState.completed.push({
          title: job.title,
          company: job.company,
          score: job.combinedScore || job.score,
          status: result.verified ? "applied" : "clicked",
          appliedAt: new Date().toISOString()
        });
      } catch (error) {
        const blocked = isBlockingAutomationError(error);
        automationState.failed.push({
          title: job.title,
          company: job.company,
          reason: error.message || String(error),
          blocked,
          failedAt: new Date().toISOString()
        });
        if (settings.automation.stopOnBlocking && blocked) {
          automationState.running = false;
          automationState.stoppedReason = error.message || String(error);
        }
      }
    }
  }

  async function applyJobInWorker(workerTabId, job, settings) {
    await tabsUpdate(workerTabId, applyTabUpdateProperties(job.url, settings));
    await waitForTabReady(workerTabId, 30000);
    await wait(settings.automation.navigationDelayMs);

    try {
      const result = await sendMessageWithRetry(workerTabId, {
        type: "APPLY_CURRENT_PAGE",
        confirmed: automationState.confirmedApply,
        automationJob: job
      });
      return verifyPostApplyResult(workerTabId, result);
    } catch (error) {
      const recovered = await recoverPostApplyNavigation(workerTabId);
      if (recovered) {
        return recovered;
      }
      throw error;
    }
  }

  async function recoverPostApplyNavigation(workerTabId) {
    await wait(1200);
    const pageStatus = await getPageStatusFromTab(workerTabId);
    if (/\/web\/geek\/chat/u.test(pageStatus?.url || "")) {
      return { applied: true, verified: true, reason: "BOSS chat page opened after navigation" };
    }
    return null;
  }

  async function verifyPostApplyResult(workerTabId, result) {
    if (!result || !result.applied || result.verified) {
      return result;
    }
    const recovered = await recoverPostApplyNavigation(workerTabId);
    return recovered ? { ...result, ...recovered } : result;
  }

  async function getPageStatusFromTab(tabId) {
    try {
      return await sendMessageWithRetry(tabId, { type: "GET_PAGE_STATUS" });
    } catch (_error) {
      try {
        const tab = await tabsGet(tabId);
        return {
          supported: false,
          site: null,
          url: tab.url || "",
          title: tab.title || "",
          blocking: { blocked: false, reason: "" }
        };
      } catch (_tabError) {
        return { supported: false, site: null, url: "", title: "", blocking: { blocked: false, reason: "" } };
      }
    }
  }

  function deriveAgentQueries(settings, currentUrl = "") {
    const profile = settings.profile || {};
    const filters = settings.filters || {};
    const currentQuery = (() => {
      try {
        return new URL(currentUrl).searchParams.get("query") || "";
      } catch (_error) {
        return "";
      }
    })();
    const excluded = new Set(shared.splitTerms(filters.excludeKeywords).map(shared.normalizeText));
    const roleTerms = shared.splitTerms(profile.expectedRole).filter(isUsefulAgentQuery);
    const includeTerms = shared.splitTerms(filters.includeKeywords).filter(isUsefulAgentQuery);
    const skillTerms = shared.splitTerms(profile.skills).filter(isUsefulAgentQuery);
    const resumeTerms = shared.extractResumeSignals(profile.resumeText).filter(isUsefulAgentQuery);
    const candidates = [
      currentQuery,
      ...includeTerms,
      ...roleTerms,
      ...skillTerms,
      ...resumeTerms,
      "AI",
      "LLM",
      "Python",
      "Java",
      "JavaScript",
      "React",
      "C++",
      "Vue",
      "Node.js",
      "Go"
    ];

    const queries = [];
    const seen = new Set();
    for (const value of candidates) {
      const query = String(value || "").trim();
      const key = shared.normalizeText(query);
      if (!key || seen.has(key) || excluded.has(key)) continue;
      if (!isUsefulAgentQuery(query)) continue;
      if (query.length < 2 || query.length > 40) continue;
      if (/https?:|www\.|@|\d{6,}/iu.test(query)) continue;
      seen.add(key);
      queries.push(query);
      if (queries.length >= settings.automation.agentMaxQueries) break;
    }
    return queries.length ? queries : ["Python", "Java", "AI"];
  }

  function isUsefulAgentQuery(value) {
    const query = String(value || "").trim();
    const key = shared.normalizeText(query);
    if (!key || query.length < 2 || query.length > 40) return false;
    if (/https?:|www\.|@|github|profile|\.(?:com|cn|io)\b|\d{6,}/iu.test(query)) return false;
    if (/[\u884c\u4e1a\u6c42\u804c\u62db\u8058\u7b80\u5386\u516c\u53f8]/u.test(query) && query.length <= 8) return false;
    const broadTerms = new Set([
      "it",
      "hr",
      "ui",
      "pc",
      "\u4e92\u8054\u7f51",
      "\u4e92\u8054\u7f51\u884c\u4e1a",
      "\u8ba1\u7b97\u673a",
      "\u8f6f\u4ef6",
      "\u6280\u672f",
      "\u5de5\u7a0b",
      "\u79d1\u6280",
      "\u884c\u4e1a"
    ]);
    return !broadTerms.has(key);
  }

  function buildBossSearchUrl(currentUrl, query, page) {
    let url;
    try {
      url = new URL(currentUrl || "https://www.zhipin.com/web/geek/jobs");
    } catch (_error) {
      url = new URL("https://www.zhipin.com/web/geek/jobs");
    }
    url.protocol = "https:";
    url.hostname = url.hostname && url.hostname.endsWith("zhipin.com") ? url.hostname : "www.zhipin.com";
    url.pathname = "/web/geek/jobs";
    url.searchParams.set("query", query);
    url.searchParams.set("page", String(page));
    return url.toString();
  }

  function buildBossAgentPlan(settings, currentUrl) {
    const queries = deriveAgentQueries(settings, currentUrl);
    const startPage = settings.automation.agentStartPage;
    const pagesPerQuery = settings.automation.agentMaxPagesPerQuery;
    const plan = [];
    for (const query of queries) {
      for (let page = startPage; page < startPage + pagesPerQuery; page += 1) {
        plan.push({
          siteId: "boss",
          query,
          page,
          url: buildBossSearchUrl(currentUrl, query, page)
        });
      }
    }
    return plan;
  }

  async function startAgentAutomation(sourceTabId = null, options = {}) {
    if (automationState.running) {
      return { status: getAutomationSnapshot(), message: "Automation is already running" };
    }

    const settings = await getSettings();
    const force = Boolean(options.force);
    if (!settings.automation.enabled && !force) {
      return { status: getAutomationSnapshot(), message: "Automation is disabled" };
    }
    if (!hasMatchingProfile(settings)) {
      return { status: getAutomationSnapshot(), message: "Please configure resume/profile before agent auto apply" };
    }

    const numericTabId = Number(sourceTabId);
    if (!Number.isInteger(numericTabId)) {
      return { status: getAutomationSnapshot(), message: "Open a supported job site tab before starting agent auto apply" };
    }

    const pageStatus = await getPageStatusFromTab(numericTabId);
    const siteId = pageStatus?.site?.id || (() => {
      try {
        return shared.resolveSite(new URL(pageStatus.url || "").hostname)?.id || "";
      } catch (_error) {
        return "";
      }
    })();

    if (siteId !== "boss") {
      return startAutomation([], numericTabId, { force });
    }

    const todayCount = todaysApplicationCount(settings);
    if (todayCount >= settings.filters.maxDailySubmissions) {
      return { status: getAutomationSnapshot(), message: "Daily application limit reached" };
    }

    const plan = buildBossAgentPlan(settings, pageStatus.url || options.sourceUrl || "");
    automationState = {
      running: true,
      status: "running",
      queue: [],
      current: null,
      completed: [],
      failed: [],
      startedAt: new Date().toISOString(),
      stoppedReason: "",
      workerTabId: null,
      confirmedApply: force || settings.automation.autoClickApply,
      mode: "agent",
      agent: {
        siteId: "boss",
        plannedPages: plan.length,
        pageIndex: 0,
        query: "",
        page: 0,
        collected: 0,
        selected: 0
      }
    };

    runAgentAutomation(numericTabId, plan).catch((error) => {
      automationState.running = false;
      automationState.status = "failed";
      automationState.stoppedReason = error.message || String(error);
    });

    return { status: getAutomationSnapshot(), message: `Agent auto apply started with ${plan.length} planned search pages` };
  }

  async function runAgentAutomation(sourceTabId, plan) {
    let workerTab = null;
    try {
      workerTab = await tabsCreate({ url: "about:blank", active: false });
      automationState.workerTabId = workerTab.id;

      for (let index = 0; automationState.running && index < plan.length; index += 1) {
        const target = plan[index];
        let settings = await getSettings();
        const remainingDaily = settings.filters.maxDailySubmissions - todaysApplicationCount(settings);
        if (remainingDaily <= 0) {
          automationState.stoppedReason = "Daily application limit reached";
          break;
        }

        automationState.agent = {
          ...(automationState.agent || {}),
          pageIndex: index + 1,
          query: target.query,
          page: target.page,
          collected: 0,
          selected: 0
        };
        automationState.current = { title: `${target.query} page ${target.page}`, company: "Collecting jobs", url: target.url };

        await tabsUpdate(sourceTabId, { url: target.url, active: true });
        await waitForTabReady(sourceTabId, 30000);
        await wait(collectionWarmupDelayMs(settings));

        const collected = await collectJobsFromTab(sourceTabId, {
          withLlm: settings.llm.enabled,
          highlight: false,
          maxPages: 1,
          clickNextPage: false
        });
        if (collected.stoppedReason) {
          automationState.stoppedReason = collected.stoppedReason;
          break;
        }

        settings = await getSettings();
        const freshRemainingDaily = settings.filters.maxDailySubmissions - todaysApplicationCount(settings);
        const selected = await selectApplicableJobs(collected.jobs, settings, freshRemainingDaily);
        automationState.agent = {
          ...(automationState.agent || {}),
          collected: collected.jobs.length,
          selected: selected.queue.length
        };
        if (!selected.queue.length) {
          continue;
        }

        automationState.queue = selected.queue;
        await applyQueuedJobsWithExistingWorker(workerTab.id, settings);
        if (automationState.stoppedReason) {
          break;
        }
        await wait(500);
      }
    } finally {
      if (workerTab && (await getSettings()).automation.closeTabsAfterApply) {
        await tabsRemove(workerTab.id);
      }
      automationState.workerTabId = null;
    }

    automationState.running = false;
    automationState.current = null;
    automationState.queue = [];
    if (!AUTOMATION_DONE_STATUSES.has(automationState.status) || automationState.status === "running") {
      automationState.status = automationState.stoppedReason ? "stopped" : "completed";
    }
  }

  async function runAutomationQueue() {
    const settings = await getSettings();
    let workerTab = null;
    try {
      workerTab = await tabsCreate({ url: "about:blank", active: Boolean(settings.automation.focusApplyTab) });
      automationState.workerTabId = workerTab.id;

      while (automationState.running && automationState.queue.length) {
      const job = automationState.queue.shift();
      automationState.current = job;

      try {
        const result = await applyJobInWorker(workerTab.id, job, settings);

        if (!result.applied) {
          throw new Error(result.reason || (result.requiresConfirmation ? "需要人工确认" : "未完成投递"));
        }

        automationState.completed.push({
          title: job.title,
          company: job.company,
          score: job.combinedScore || job.score,
          appliedAt: new Date().toISOString()
        });
      } catch (error) {
        const blocked = isBlockingAutomationError(error);
        automationState.failed.push({
          title: job.title,
          company: job.company,
          reason: error.message || String(error),
          blocked,
          failedAt: new Date().toISOString()
        });
        if (settings.automation.stopOnBlocking && blocked) {
          automationState.running = false;
          automationState.stoppedReason = error.message || String(error);
        }
      }
    }
    } finally {
      if (workerTab && settings.automation.closeTabsAfterApply) {
        await tabsRemove(workerTab.id);
      }
      automationState.workerTabId = null;
    }

    automationState.running = false;
    automationState.current = null;
    if (!AUTOMATION_DONE_STATUSES.has(automationState.status) || automationState.status === "running") {
      automationState.status = automationState.stoppedReason ? "stopped" : "completed";
    }
  }

  function isBlockingAutomationError(error) {
    const message = String(error?.message || error || "");
    if (/captcha|verify|verification|login|rate|limit|blocked|manual|daily|\u9a8c\u8bc1\u7801|\u5b89\u5168\u9a8c\u8bc1|\u6ed1\u5757|\u767b\u5f55|\u9891\u7e41|\u4e0a\u9650|\u8ba4\u8bc1/i.test(message)) {
      return true;
    }
    return /验证码|安全验证|滑块|captcha|登录|频控|频繁|上限|认证|简历资料|blocked|limit/i.test(message);
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function waitForTabReady(tabId, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("页面加载超时"));
      }, timeoutMs);

      function cleanup() {
        clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(listener);
      }

      function listener(updatedTabId, changeInfo) {
        if (updatedTabId === tabId && changeInfo.status === "complete") {
          cleanup();
          resolve();
        }
      }

      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs.get(tabId, (tab) => {
        if (!chrome.runtime.lastError && tab && tab.status === "complete") {
          cleanup();
          resolve();
        }
      });
    });
  }

  async function sendMessageWithRetry(tabId, message) {
    let lastError = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        return await sendTabMessage(tabId, message);
      } catch (error) {
        lastError = error;
        await wait(500);
      }
    }
    throw lastError || new Error("无法连接内容脚本");
  }

  chrome.runtime.onInstalled.addListener(() => {
    getSettings().then(saveSettings);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== "string") {
      return false;
    }

    (async () => {
      switch (message.type) {
        case "GET_SETTINGS": {
          const settings = await getSettings();
          const includeSecrets = Boolean(message.includeSecrets) && !sender.tab;
          return { settings: includeSecrets ? settings : shared.redactSettings(settings) };
        }
        case "SAVE_SETTINGS":
          return { settings: shared.redactSettings(await saveSettings(message.settings)) };
        case "LOG_APPLICATION":
          return { applications: await logApplication(message.entry || {}) };
        case "CLEAR_HISTORY": {
          const settings = await getSettings();
          settings.history.applications = [];
          await saveSettings(settings, { preserveHistory: false });
          return { applications: [] };
        }
        case "TEST_LLM_CONFIG":
          return await testLlmConfig();
        case "LLM_SCORE_JOBS":
          return await scoreJobsWithLlm(message.jobs || []);
        case "START_COLLECT_JOBS":
          return await collectJobsFromTab(message.tabId ?? sender.tab?.id, {
            withLlm: Boolean(message.withLlm),
            highlight: Boolean(message.highlight)
          });
        case "START_AUTO_APPLY":
          return await startAutomation(message.jobs || [], message.sourceTabId ?? sender.tab?.id ?? null, {
            force: Boolean(message.force)
          });
        case "START_AGENT_AUTO_APPLY":
          return await startAgentAutomation(message.sourceTabId ?? sender.tab?.id ?? null, {
            force: Boolean(message.force),
            sourceUrl: message.sourceUrl || ""
          });
        case "STOP_AUTOMATION":
          resetAutomation("stopped", "用户停止");
          return { status: getAutomationSnapshot() };
        case "GET_AUTOMATION_STATUS":
          return { status: getAutomationSnapshot() };
        default:
          return { error: `Unknown message type: ${message.type}` };
      }
    })()
      .then((payload) => sendResponse(payload))
      .catch((error) =>
        sendResponse({
          error: error.message || String(error),
          needsPermission: Boolean(error.needsPermission),
          originPattern: error.originPattern || ""
        })
      );

    return true;
  });
})();
