(function attachOptions() {
  "use strict";

  const shared = globalThis.AutoApplyShared;
  const resumeParser = globalThis.AutoApplyResumeParser;
  const form = document.querySelector("#settingsForm");
  const saveButton = document.querySelector("#saveSettings");
  const parseResumeButton = document.querySelector("#parseResume");
  const resumeFileInput = document.querySelector("#resumeFile");
  const testLlmButton = document.querySelector("#testLlm");
  const generateMatchRulesButton = document.querySelector("#generateMatchRules");
  const clearHistoryButton = document.querySelector("#clearHistory");
  const historyList = document.querySelector("#historyList");
  const toast = document.querySelector("#toast");
  let settings = shared.cloneDefaultSettings();
  let savedLlmApiKey = "";

  function startBackgroundKeepAlive() {
    let port = null;
    const connect = () => {
      try {
        port = chrome.runtime.connect({ name: "auto-apply-keepalive" });
        port.onDisconnect.addListener(() => {
          port = null;
        });
      } catch (_error) {
        port = null;
      }
    };
    connect();
    window.setInterval(() => {
      try {
        if (!port) connect();
        port?.postMessage({ type: "ping", at: Date.now() });
      } catch (_error) {
        port = null;
      }
    }, 20000);
  }

  function sendRuntime(message) {
    return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
  }

  function showToast(text) {
    toast.textContent = text;
    toast.classList.add("visible");
    window.setTimeout(() => toast.classList.remove("visible"), 2600);
  }

  function setValue(name, value) {
    const control = form.elements[name];
    if (!control) return;
    if (control.type === "checkbox") {
      control.checked = Boolean(value);
      return;
    }
    control.value = value == null ? "" : String(value);
  }

  function getValue(name) {
    const control = form.elements[name];
    if (!control) return "";
    if (control.type === "checkbox") return control.checked;
    if (control.type === "number") return Number(control.value);
    return control.value.trim();
  }

  function populateForm() {
    const profile = settings.profile;
    const filters = settings.filters;
    const llm = settings.llm;
    const automation = settings.automation;

    for (const key of Object.keys(profile)) {
      setValue(key, profile[key]);
    }
    for (const key of Object.keys(filters)) {
      setValue(key, filters[key]);
    }
    setValue("llmEnabled", llm.enabled);
    setValue("llmBaseUrl", llm.baseUrl);
    setValue("llmModel", llm.model);
    setValue("llmApiKey", "");
    setValue("llmTimeoutMs", llm.timeoutMs);
    setValue("llmMinScore", llm.minScore);
    setValue("allowSendingResumeToLlm", llm.allowSendingResumeToLlm);
    setValue("automationEnabled", automation.enabled);
    setValue("autoClickApply", automation.autoClickApply);
    setValue("maxJobsPerRun", automation.maxJobsPerRun);
    setValue("fillDailyLimit", automation.fillDailyLimit);
    setValue("llmOrganizeSearchKeywords", automation.llmOrganizeSearchKeywords);
    setValue("closeTabsAfterApply", automation.closeTabsAfterApply);
    setValue("navigationDelayMs", automation.navigationDelayMs);
    setValue("stopOnBlocking", automation.stopOnBlocking);
    setValue("skipAlreadyApplied", automation.skipAlreadyApplied);
    setValue("autoCollectBeforeApply", automation.autoCollectBeforeApply);
    setValue("collectionMaxScrolls", automation.collectionMaxScrolls);
    setValue("collectionMaxPages", automation.collectionMaxPages);
    setValue("collectionScrollDelayMs", automation.collectionScrollDelayMs);
    setValue("collectionClickNextPage", automation.collectionClickNextPage);
    setValue("agentMaxQueries", automation.agentMaxQueries);
    setValue("agentMaxPagesPerQuery", automation.agentMaxPagesPerQuery);
    setValue("agentStartPage", automation.agentStartPage);
    updateApiKeyPlaceholder();
    renderHistory();
  }

  function collectForm() {
    const enteredApiKey = getValue("llmApiKey");
    return shared.mergeSettings({
      ...settings,
      profile: {
        name: getValue("name"),
        phone: getValue("phone"),
        email: getValue("email"),
        expectedRole: getValue("expectedRole"),
        expectedCity: getValue("expectedCity"),
        expectedSalary: getValue("expectedSalary"),
        skills: getValue("skills"),
        resumeText: getValue("resumeText"),
        coverLetterTemplate: getValue("coverLetterTemplate")
      },
      filters: {
        includeKeywords: getValue("includeKeywords"),
        excludeKeywords: getValue("excludeKeywords"),
        preferredCities: getValue("preferredCities"),
        minScore: getValue("minScore"),
        maxDailySubmissions: getValue("maxDailySubmissions"),
        actionDelayMs: getValue("actionDelayMs"),
        requireManualConfirmation: getValue("requireManualConfirmation")
      },
      llm: {
        enabled: getValue("llmEnabled"),
        baseUrl: getValue("llmBaseUrl"),
        model: getValue("llmModel"),
        apiKey: enteredApiKey || savedLlmApiKey,
        timeoutMs: getValue("llmTimeoutMs"),
        minScore: getValue("llmMinScore"),
        allowSendingResumeToLlm: getValue("allowSendingResumeToLlm")
      },
      automation: {
        enabled: getValue("automationEnabled"),
        autoClickApply: getValue("autoClickApply"),
        maxJobsPerRun: getValue("maxJobsPerRun"),
        fillDailyLimit: getValue("fillDailyLimit"),
        llmOrganizeSearchKeywords: getValue("llmOrganizeSearchKeywords"),
        closeTabsAfterApply: getValue("closeTabsAfterApply"),
        navigationDelayMs: getValue("navigationDelayMs"),
        stopOnBlocking: getValue("stopOnBlocking"),
        skipAlreadyApplied: getValue("skipAlreadyApplied"),
        autoCollectBeforeApply: getValue("autoCollectBeforeApply"),
        collectionMaxScrolls: getValue("collectionMaxScrolls"),
        collectionMaxPages: getValue("collectionMaxPages"),
        collectionScrollDelayMs: getValue("collectionScrollDelayMs"),
        collectionClickNextPage: getValue("collectionClickNextPage"),
        agentMaxQueries: getValue("agentMaxQueries"),
        agentMaxPagesPerQuery: getValue("agentMaxPagesPerQuery"),
        agentStartPage: getValue("agentStartPage")
      }
    });
  }

  function updateApiKeyPlaceholder() {
    const control = form.elements.llmApiKey;
    if (!control) return;
    control.placeholder = savedLlmApiKey
      ? "Saved. Leave blank to keep it; paste a new key to replace"
      : "Leave blank for local compatible services";
  }

  function renderHistory() {
    historyList.replaceChildren();
    const applications = settings.history.applications || [];
    if (!applications.length) {
      const empty = document.createElement("li");
      empty.textContent = "暂无记录";
      historyList.appendChild(empty);
      return;
    }
    for (const entry of applications.slice(0, 30)) {
      const item = document.createElement("li");
      const date = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "";
      const score = entry.combinedScore || entry.llmScore || entry.score || 0;
      item.textContent = `${score}分 · ${entry.title || "岗位"} · ${entry.company || entry.siteName || ""} · ${date}`;
      historyList.appendChild(item);
    }
  }

  async function loadSettings() {
    const response = await sendRuntime({ type: "GET_SETTINGS", includeSecrets: true });
    settings = shared.mergeSettings(response && response.settings);
    savedLlmApiKey = settings.llm.apiKey || "";
    populateForm();
  }

  async function saveSettings() {
    settings = collectForm();
    const response = await sendRuntime({ type: "SAVE_SETTINGS", settings });
    settings = shared.mergeSettings({ ...settings, ...(response && response.settings), llm: settings.llm });
    savedLlmApiKey = settings.llm.apiKey || savedLlmApiKey;
    populateForm();
    showToast("设置已保存");
  }

  function fillIfPresent(name, value, overwrite = true) {
    if (!value) return false;
    const control = form.elements[name];
    if (!control) return false;
    if (!overwrite && control.value.trim()) return false;
    control.value = value;
    return true;
  }

  function applyResumeHints(hints) {
    const changed = [];
    for (const key of ["name", "phone", "email", "expectedRole", "expectedCity", "skills", "resumeText"]) {
      if (fillIfPresent(key, hints[key])) {
        changed.push(key);
      }
    }
    return changed;
  }

  function applyGeneratedMatchRules(rules = {}) {
    const changed = [];
    for (const [name, value] of Object.entries({
      includeKeywords: rules.includeKeywords,
      excludeKeywords: rules.excludeKeywords,
      preferredCities: rules.preferredCities,
      minScore: rules.minScore
    })) {
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        setValue(name, value);
        changed.push(name);
      }
    }
    return changed;
  }

  function applyLlmResumeParse(response = {}) {
    return [
      ...applyResumeHints(response.profile || {}),
      ...applyGeneratedMatchRules(response.rules || {})
    ];
  }

  function requestPermission(details) {
    return new Promise((resolve) => chrome.permissions.request(details, resolve));
  }

  function containsPermission(details) {
    return new Promise((resolve) => chrome.permissions.contains(details, resolve));
  }

  async function ensureLlmOriginPermission(nextSettings) {
    const validation = shared.validateLlmConfig(nextSettings.llm);
    if (!validation.ok) {
      throw new Error(validation.errors.join("；"));
    }
    const details = { origins: [validation.originPattern] };
    if (await containsPermission(details)) {
      return validation;
    }
    const granted = await requestPermission(details);
    if (!granted) {
      throw new Error(`未授权访问 ${validation.originPattern}`);
    }
    return validation;
  }

  async function parseResumeWithOptionalLlm(event) {
    event?.stopImmediatePropagation();
    try {
      parseResumeButton.disabled = true;
      const file = resumeFileInput.files && resumeFileInput.files[0];
      const result = await resumeParser.parseResumeFile(file);
      const changed = applyResumeHints(result.hints);
      const messages = [];
      settings = collectForm();
      await sendRuntime({ type: "SAVE_SETTINGS", settings });

      if (settings.llm.enabled && settings.llm.allowSendingResumeToLlm) {
        try {
          await ensureLlmOriginPermission(settings);
          const response = await sendRuntime({ type: "PARSE_RESUME_WITH_LLM", resumeText: result.text });
          if (response && response.error) {
            throw new Error(response.error);
          }
          changed.push(...applyLlmResumeParse(response));
          messages.push(response.message || "LLM resume parsing completed");
        } catch (error) {
          messages.push(`LLM resume parsing failed; local parse kept: ${error.message || String(error)}`);
        }
      }

      settings = collectForm();
      await sendRuntime({ type: "SAVE_SETTINGS", settings });
      const suffix = result.warnings.length ? ` ${result.warnings.join(" ")}` : "";
      const llmSuffix = messages.length ? ` ${messages.join(" ")}` : "";
      showToast(`Resume parsed. Updated ${changed.length} fields.${suffix}${llmSuffix}`);
    } catch (error) {
      showToast(error.message || String(error));
    } finally {
      parseResumeButton.disabled = false;
    }
  }

  saveButton.addEventListener("click", async () => {
    await saveSettings();
  });

  parseResumeButton.addEventListener("click", parseResumeWithOptionalLlm, { capture: true });

  parseResumeButton.addEventListener("click", async () => {
    try {
      const file = resumeFileInput.files && resumeFileInput.files[0];
      const result = await resumeParser.parseResumeFile(file);
      const changed = applyResumeHints(result.hints);
      settings = collectForm();
      await sendRuntime({ type: "SAVE_SETTINGS", settings });
      const suffix = result.warnings.length ? `；${result.warnings.join("；")}` : "";
      showToast(`已解析并填充 ${changed.length} 个字段${suffix}`);
    } catch (error) {
      showToast(error.message || String(error));
    }
  });

  testLlmButton.addEventListener("click", async () => {
    try {
      settings = collectForm();
      await ensureLlmOriginPermission(settings);
      await sendRuntime({ type: "SAVE_SETTINGS", settings });
      const response = await sendRuntime({ type: "TEST_LLM_CONFIG" });
      if (response && response.error) {
        throw new Error(response.error);
      }
      showToast(`LLM 连接成功：${response.message || response.model || "OK"}`);
    } catch (error) {
      showToast(error.message || String(error));
    }
  });

  generateMatchRulesButton.addEventListener("click", async () => {
    try {
      generateMatchRulesButton.disabled = true;
      settings = collectForm();
      await ensureLlmOriginPermission(settings);
      await sendRuntime({ type: "SAVE_SETTINGS", settings });
      const response = await sendRuntime({ type: "GENERATE_MATCH_RULES" });
      if (response && response.error) {
        throw new Error(response.error);
      }
      applyGeneratedMatchRules(response.rules || {});
      settings = collectForm();
      await sendRuntime({ type: "SAVE_SETTINGS", settings });
      showToast(response.message || "LLM 已生成匹配规则");
    } catch (error) {
      showToast(error.message || String(error));
    } finally {
      generateMatchRulesButton.disabled = false;
    }
  });

  clearHistoryButton.addEventListener("click", async () => {
    const ok = window.confirm("确认清空最近投递记录？");
    if (!ok) return;
    await sendRuntime({ type: "CLEAR_HISTORY" });
    settings.history.applications = [];
    renderHistory();
    showToast("记录已清空");
  });

  loadSettings();
  startBackgroundKeepAlive();
})();
