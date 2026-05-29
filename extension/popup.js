(function attachPopup() {
  "use strict";

  const shared = globalThis.AutoApplyShared;
  const elements = {
    applyPage: document.querySelector("#applyPage"),
    autoApply: document.querySelector("#autoApply"),
    automationStatus: document.querySelector("#automationStatus"),
    clearMarks: document.querySelector("#clearMarks"),
    collectJobs: document.querySelector("#collectJobs"),
    fillPage: document.querySelector("#fillPage"),
    focusTop: document.querySelector("#focusTop"),
    highlightJobs: document.querySelector("#highlightJobs"),
    jobList: document.querySelector("#jobList"),
    llmScore: document.querySelector("#llmScore"),
    message: document.querySelector("#message"),
    openOptions: document.querySelector("#openOptions"),
    profileStatus: document.querySelector("#profileStatus"),
    scanJobs: document.querySelector("#scanJobs"),
    siteStatus: document.querySelector("#siteStatus"),
    stopAutomation: document.querySelector("#stopAutomation")
  };

  let activeTab = null;
  let settings = shared.cloneDefaultSettings();
  let lastJobs = [];
  let statusTimer = null;

  function sendRuntime(message) {
    return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
  }

  function queryActiveTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0] || null));
    });
  }

  function sendToTab(message) {
    return new Promise((resolve) => {
      if (!activeTab || typeof activeTab.id !== "number") {
        resolve({ error: "未找到当前标签页" });
        return;
      }
      chrome.tabs.sendMessage(activeTab.id, message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || {});
      });
    });
  }

  function setMessage(text, isError = false) {
    elements.message.textContent = text || "";
    elements.message.classList.toggle("error", Boolean(isError));
  }

  function setBusy(isBusy) {
    for (const button of document.querySelectorAll("button")) {
      if (button.id === "stopAutomation") continue;
      button.disabled = isBusy;
    }
  }

  function renderProfileStatus() {
    const profile = settings.profile;
    const filters = settings.filters;
    const missing = [];
    if (!profile.name) missing.push("姓名");
    if (!profile.phone) missing.push("手机");
    if (!profile.email) missing.push("邮箱");
    if (!profile.expectedRole) missing.push("求职方向");

    const llmText = settings.llm.enabled ? `LLM ${settings.llm.model || "未配置模型"}` : "LLM 未启用";
    elements.profileStatus.textContent = missing.length
      ? `资料未完整：${missing.join("、")}。本地阈值 ${filters.minScore} 分。${llmText}。`
      : `${profile.expectedRole} · ${profile.expectedCity || "不限城市"} · 本地阈值 ${filters.minScore} · ${llmText}`;
  }

  function renderAutomationStatus(status) {
    if (!status) {
      elements.automationStatus.textContent = "自动化状态：读取中";
      return;
    }
    const current = status.current ? ` · 当前：${status.current.title || ""}` : "";
    const failed = status.failed && status.failed.length ? ` · 失败 ${status.failed.length}` : "";
    const stopped = status.stoppedReason ? ` · ${status.stoppedReason}` : "";
    elements.automationStatus.textContent = `自动化：${status.status || "idle"} · 队列 ${status.queueLength || 0} · 完成 ${
      status.completed?.length || 0
    }${failed}${current}${stopped}`;
  }

  function displayScore(job) {
    return job.combinedScore || job.llmScore || job.score || 0;
  }

  function renderJobs(jobs) {
    elements.jobList.replaceChildren();
    if (!jobs || !jobs.length) {
      setMessage("未找到可分析的岗位。");
      return;
    }
    setMessage(`已找到 ${jobs.length} 个岗位，按匹配度排序。`);
    const topJobs = jobs.slice(0, 12);
    for (const job of topJobs) {
      const item = document.createElement("li");
      item.className = "job-item";

      const title = document.createElement("div");
      title.className = "job-title";
      const titleText = document.createElement("strong");
      titleText.textContent = job.title || "未命名岗位";
      const score = document.createElement("span");
      score.className = "score";
      score.textContent = `${displayScore(job)}`;
      title.append(titleText, score);

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = [job.company, job.city, job.salary].filter(Boolean).join(" · ") || job.siteName;

      const reasons = document.createElement("div");
      reasons.className = "reasons";
      const localReason = [...(job.positives || []), ...(job.negatives || [])].slice(0, 2).join("；");
      reasons.textContent = job.llmReason || localReason || "暂无命中原因";

      const decision = document.createElement("div");
      decision.className = "decision";
      decision.textContent = job.llmDecision ? `LLM：${job.llmDecision} · ${job.llmScore || 0}分` : `本地：${job.confidence || "unknown"}`;

      item.append(title, meta, reasons, decision);
      elements.jobList.appendChild(item);
    }
  }

  async function loadStatus() {
    const response = await sendRuntime({ type: "GET_SETTINGS" });
    settings = shared.mergeSettings(response && response.settings);
    renderProfileStatus();

    activeTab = await queryActiveTab();
    let currentUrl = null;
    try {
      currentUrl = activeTab && activeTab.url ? new URL(activeTab.url) : null;
    } catch (_error) {
      currentUrl = null;
    }
    const currentSite = currentUrl ? shared.resolveSite(currentUrl.hostname) : null;
    if (!currentSite) {
      elements.siteStatus.textContent = "当前页不是已支持的招聘站点";
      setMessage("请打开 BOSS、51Job、智联、猎聘、脉脉或神仙外企页面。");
    } else {
      elements.siteStatus.textContent = `当前站点：${currentSite.name}`;
    }
    await refreshAutomationStatus();
  }

  async function refreshAutomationStatus() {
    const response = await sendRuntime({ type: "GET_AUTOMATION_STATUS" });
    renderAutomationStatus(response && response.status);
  }

  async function runAction(action) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
      await refreshAutomationStatus();
    }
  }

  async function scanJobs({ highlight = false, withLlm = false } = {}) {
    const result = await sendToTab({ type: "SCAN_JOBS", highlight });
    if (result.error) {
      setMessage(`扫描失败：${result.error}`, true);
      return [];
    }
    lastJobs = result.jobs || [];
    if (withLlm) {
      await scoreLastJobsWithLlm();
    }
    renderJobs(lastJobs);
    return lastJobs;
  }

  async function scoreLastJobsWithLlm() {
    if (!lastJobs.length) {
      await scanJobs();
    }
    const response = await sendRuntime({ type: "LLM_SCORE_JOBS", jobs: lastJobs });
    if (response.error) {
      setMessage(`LLM 评分失败：${response.error}`, true);
      return false;
    }
    lastJobs = response.jobs || lastJobs;
    renderJobs(lastJobs);
    setMessage(response.message || "LLM 评分完成。", false);
    return Boolean(response.usedLlm);
  }

  async function collectJobs({ withLlm = false, highlight = false } = {}) {
    if (!activeTab || typeof activeTab.id !== "number") {
      setMessage("未找到当前标签页", true);
      return [];
    }
    const response = await sendRuntime({
      type: "START_COLLECT_JOBS",
      tabId: activeTab.id,
      withLlm,
      highlight
    });
    if (response.error) {
      setMessage(`自动采集失败：${response.error}`, true);
      return [];
    }
    lastJobs = response.jobs || [];
    renderJobs(lastJobs);
    const pages = response.pageStats ? response.pageStats.length : 0;
    const suffix = response.stoppedReason ? `；停止原因：${response.stoppedReason}` : "";
    setMessage(response.message || `已采集 ${lastJobs.length} 个岗位，覆盖 ${pages} 页${suffix}`, Boolean(response.stoppedReason));
    return lastJobs;
  }

  elements.openOptions.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  elements.scanJobs.addEventListener("click", () => {
    runAction(async () => {
      await scanJobs({ highlight: false, withLlm: false });
    });
  });

  elements.collectJobs.addEventListener("click", () => {
    runAction(async () => {
      await collectJobs({ withLlm: settings.llm.enabled, highlight: true });
    });
  });

  elements.llmScore.addEventListener("click", () => {
    runAction(async () => {
      if (!lastJobs.length) {
        await scanJobs({ highlight: false, withLlm: false });
      }
      await scoreLastJobsWithLlm();
    });
  });

  elements.highlightJobs.addEventListener("click", () => {
    runAction(async () => {
      await scanJobs({ highlight: true, withLlm: false });
    });
  });

  elements.focusTop.addEventListener("click", () => {
    runAction(async () => {
      const result = await sendToTab({ type: "FOCUS_TOP_MATCH" });
      setMessage(result.focused ? `已定位：${result.job.title}` : result.reason || "定位失败", !result.focused);
    });
  });

  elements.clearMarks.addEventListener("click", () => {
    runAction(async () => {
      const result = await sendToTab({ type: "CLEAR_HIGHLIGHTS" });
      setMessage(result.cleared ? "已清除页面标记。" : result.error || "清除失败", Boolean(result.error));
    });
  });

  elements.fillPage.addEventListener("click", () => {
    runAction(async () => {
      const result = await sendToTab({ type: "FILL_CURRENT_PAGE" });
      if (result.error) {
        setMessage(`填充失败：${result.error}`, true);
        return;
      }
      setMessage(result.filled && result.filled.length ? `已填充：${result.filled.join("、")}` : "未找到可填充字段。");
    });
  });

  elements.applyPage.addEventListener("click", () => {
    runAction(async () => {
      const preview = await sendToTab({ type: "APPLY_CURRENT_PAGE", confirmed: false });
      if (preview.error) {
        setMessage(`投递失败：${preview.error}`, true);
        return;
      }
      if (preview.requiresConfirmation) {
        const job = preview.job || {};
        const ok = window.confirm(`确认点击“${preview.actionText}”？\n${job.title || ""}\n${job.company || ""}\n匹配分：${displayScore(job)}`);
        if (!ok) {
          setMessage("已取消。");
          return;
        }
      } else if (!preview.applied) {
        setMessage(preview.reason || "当前岗位未通过投递条件。", true);
        return;
      }
      const result = preview.applied ? preview : await sendToTab({ type: "APPLY_CURRENT_PAGE", confirmed: true });
      setMessage(result.applied ? `已点击：${result.actionText || "投递/沟通"}` : result.reason || "未完成点击", !result.applied);
    });
  });

  elements.autoApply.addEventListener("click", () => {
    runAction(async () => {
      if (settings.automation.autoCollectBeforeApply || !lastJobs.length) {
        await collectJobs({ withLlm: settings.llm.enabled, highlight: false });
      } else if (settings.llm.enabled && !lastJobs.some((job) => job.llmDecision)) {
        await scoreLastJobsWithLlm();
      }
      if (!lastJobs.length) {
        setMessage("当前页面没有采集到可匹配的岗位，请先打开招聘搜索结果页。", true);
        return;
      }
      const response = await sendRuntime({
        type: "START_AUTO_APPLY",
        jobs: lastJobs,
        sourceTabId: activeTab && activeTab.id,
        force: true
      });
      if (response.error) {
        setMessage(`自动化启动失败：${response.error}`, true);
        return;
      }
      renderAutomationStatus(response.status);
      setMessage(response.message || "自动化已启动。");
    });
  });

  elements.stopAutomation.addEventListener("click", () => {
    runAction(async () => {
      const response = await sendRuntime({ type: "STOP_AUTOMATION" });
      renderAutomationStatus(response.status);
      setMessage("已发送停止指令。");
    });
  });

  statusTimer = window.setInterval(refreshAutomationStatus, 2000);
  window.addEventListener("unload", () => {
    if (statusTimer) window.clearInterval(statusTimer);
  });

  loadStatus();
})();
