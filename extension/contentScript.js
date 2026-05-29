(function attachContentScript() {
  "use strict";

  const shared = globalThis.AutoApplyShared;
  const site = shared.resolveSite(location.hostname);

  if (!site) {
    return;
  }

  const SELECTORS = {
    boss: {
      cards: [".job-card-wrapper", ".job-list-box li", ".job-primary", "[ka*='search_list']", "li[class*='job']"],
      title: [".job-name", ".job-title", "a[href*='/job_detail/']", "h3", "h2"],
      company: [".company-name", ".company-text", ".boss-name", "[class*='company']"],
      city: [".job-area", ".job-location", ".location-name", "[class*='area']"],
      salary: [".salary", ".red", "[class*='salary']"]
    },
    "51job": {
      cards: [".joblist-item", ".j_joblist .el", ".e", "[class*='joblist'] [class*='item']", "li[class*='job']"],
      title: [".jname", ".job_title", ".t1 a", "a[href*='jobs.51job.com']", "h3", "h2"],
      company: [".cname", ".t2", "[class*='company']"],
      city: [".area", ".t3", "[class*='area']", "[class*='city']"],
      salary: [".sal", ".t4", "[class*='salary']"]
    },
    zhaopin: {
      cards: [".joblist-box__item", ".job-card", ".positionlist__item", "[class*='joblist'] [class*='item']"],
      title: [".job-title", ".position_name", "a[href*='jobs.zhaopin.com']", "h3", "h2"],
      company: [".company-name", "[class*='company']"],
      city: [".job-area", ".job-location", "[class*='city']", "[class*='area']"],
      salary: [".salary", "[class*='salary']"]
    },
    liepin: {
      cards: [".job-card-pc-container", ".job-card", ".job-list-box li", "[data-nick='job-card']", "li[class*='job']"],
      title: [".job-title-box", ".job-title", "a[href*='job.liepin.com']", "h3", "h2"],
      company: [".company-name", "[class*='company']"],
      city: [".job-dq-box", ".job-location", "[class*='city']", "[class*='area']"],
      salary: [".job-salary", ".salary", "[class*='salary']"]
    },
    maimai: {
      cards: [".job-card", "[class*='job-card']", "[class*='position']", "li"],
      title: [".job-title", "[class*='title']", "a[href*='job']", "h3", "h2"],
      company: [".company-name", "[class*='company']"],
      city: [".job-location", "[class*='city']", "[class*='area']"],
      salary: [".salary", "[class*='salary']"]
    },
    waiqi: {
      cards: [".job-card", "[class*='job-card']", "[class*='job-item']", "[class*='position']", "li"],
      title: [".job-title", "[class*='title']", "a[href*='job']", "h3", "h2"],
      company: [".company-name", "[class*='company']"],
      city: [".job-location", "[class*='city']", "[class*='area']"],
      salary: [".salary", "[class*='salary']"]
    }
  };

  const DEFAULT_SELECTOR_SET = {
    cards: ["[class*='job']", "[class*='position']", "[data-job-id]", "[data-id]", "article", "li", ".card"],
    title: ["h1", "h2", "h3", "a[href*='job']", "[class*='title']", "[class*='name']"],
    company: ["[class*='company']", "[class*='corp']", "[class*='employer']"],
    city: ["[class*='city']", "[class*='area']", "[class*='location']", "[class*='address']"],
    salary: ["[class*='salary']", "[class*='pay']", "[class*='money']", "[class*='wage']"]
  };

  let lastScan = [];

  function getSelectors() {
    return SELECTORS[site.id] || DEFAULT_SELECTOR_SET;
  }

  function compactText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function queryFirst(root, selectors) {
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      if (element && compactText(element.innerText || element.textContent)) {
        return element;
      }
    }
    return null;
  }

  function textFrom(root, selectors) {
    const element = queryFirst(root, selectors);
    return compactText(element ? element.innerText || element.textContent : "");
  }

  function findLink(root, selectors) {
    for (const selector of selectors) {
      const element = root.matches && root.matches(selector) ? root : root.querySelector(selector);
      const link = element && element.closest ? element.closest("a[href]") : null;
      if (link) {
        return link;
      }
    }
    return root.querySelector("a[href*='job'], a[href*='position'], a[href]");
  }

  function collectCards() {
    const selectors = getSelectors();
    const nodes = new Set();
    for (const selector of selectors.cards) {
      document.querySelectorAll(selector).forEach((node) => {
        if (isVisible(node) && compactText(node.innerText).length >= 18) {
          nodes.add(node);
        }
      });
    }

    if (nodes.size < 3) {
      document.querySelectorAll(DEFAULT_SELECTOR_SET.cards.join(",")).forEach((node) => {
        if (isVisible(node) && compactText(node.innerText).length >= 18) {
          nodes.add(node);
        }
      });
    }

    return Array.from(nodes).slice(0, 80);
  }

  function extractJobFromCard(card) {
    const selectors = getSelectors();
    const title = textFrom(card, selectors.title) || compactText(card.querySelector("a, h3, h2")?.textContent);
    const company = textFrom(card, selectors.company);
    const city = textFrom(card, selectors.city);
    const salary = textFrom(card, selectors.salary);
    const link = findLink(card, selectors.title);
    const url = link ? new URL(link.getAttribute("href"), location.href).href : location.href;
    const rawText = compactText(card.innerText).slice(0, 1800);

    if (!title || rawText.length < 12) {
      return null;
    }

    return {
      siteId: site.id,
      siteName: site.name,
      title,
      company,
      city,
      salary,
      url,
      rawText,
      card
    };
  }

  function extractCurrentJob() {
    const selectors = getSelectors();
    const title =
      compactText(document.querySelector("h1")?.innerText) ||
      textFrom(document.body, selectors.title) ||
      document.title.replace(/[-_].*$/u, "").trim();
    const company = textFrom(document.body, selectors.company);
    const city = textFrom(document.body, selectors.city);
    const salary = textFrom(document.body, selectors.salary);
    const description =
      compactText(document.querySelector("[class*='description'], [class*='detail'], main, article")?.innerText) ||
      compactText(document.body.innerText).slice(0, 3000);

    return {
      siteId: site.id,
      siteName: site.name,
      title,
      company,
      city,
      salary,
      description,
      rawText: description,
      url: location.href
    };
  }

  function getSettings() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (response) => {
        resolve(shared.mergeSettings(response && response.settings));
      });
    });
  }

  async function scanJobs({ highlight = false } = {}) {
    const settings = await getSettings();
    const seen = new Set();
    const jobs = [];

    for (const card of collectCards()) {
      const job = extractJobFromCard(card);
      if (!job) continue;
      const id = shared.makeJobId(job);
      if (seen.has(id)) continue;
      seen.add(id);
      const score = shared.scoreJob(job, settings);
      jobs.push({ ...job, id, ...score });
    }

    if (!jobs.length) {
      const current = extractCurrentJob();
      const id = shared.makeJobId(current);
      const score = shared.scoreJob(current, settings);
      jobs.push({ ...current, id, ...score });
    }

    jobs.sort((left, right) => right.score - left.score);
    lastScan = jobs;
    if (highlight) {
      renderHighlights(jobs, settings.filters.minScore);
    }
    return {
      site,
      jobs: jobs.map(stripDomFields)
    };
  }

  function stripDomFields(job) {
    const { card, ...rest } = job;
    return rest;
  }

  function clearHighlights() {
    document.querySelectorAll(".auto-apply-badge").forEach((badge) => badge.remove());
    document.querySelectorAll(".auto-apply-highlight, .auto-apply-low, .auto-apply-reject").forEach((element) => {
      element.classList.remove("auto-apply-highlight", "auto-apply-low", "auto-apply-reject");
    });
  }

  function renderHighlights(jobs, minScore) {
    clearHighlights();
    for (const job of jobs) {
      if (!job.card) continue;
      const level = job.score >= minScore ? "high" : job.score >= 50 ? "medium" : "reject";
      job.card.classList.add(job.score >= minScore ? "auto-apply-highlight" : job.score >= 50 ? "auto-apply-low" : "auto-apply-reject");
      const badge = document.createElement("span");
      badge.className = "auto-apply-badge";
      badge.dataset.level = level;
      badge.textContent = `${job.score} ${job.confidence === "high" ? "高" : job.confidence === "medium" ? "中" : "低"}`;
      badge.title = [...job.positives, ...job.negatives].join("\n") || "未生成原因";
      job.card.appendChild(badge);
    }
  }

  function labelTextFor(control) {
    const parts = [
      control.getAttribute("name"),
      control.getAttribute("id"),
      control.getAttribute("placeholder"),
      control.getAttribute("aria-label"),
      control.getAttribute("data-testid")
    ];
    if (control.id) {
      const label = document.querySelector(`label[for="${CSS.escape(control.id)}"]`);
      parts.push(label?.innerText);
    }
    const wrappedLabel = control.closest("label");
    parts.push(wrappedLabel?.innerText);
    parts.push(control.closest("div, li, section, form")?.innerText?.slice(0, 160));
    return shared.normalizeText(parts.filter(Boolean).join(" "));
  }

  function editableControls() {
    return Array.from(document.querySelectorAll("input, textarea, [contenteditable='true']")).filter((control) => {
      if (!isVisible(control) || control.disabled || control.readOnly) return false;
      const type = shared.normalizeText(control.getAttribute("type") || "text");
      return !["hidden", "button", "submit", "reset", "checkbox", "radio", "file", "image"].includes(type);
    });
  }

  function findControl(keywords) {
    const terms = keywords.map(shared.normalizeText);
    let best = null;
    let bestScore = 0;
    for (const control of editableControls()) {
      const label = labelTextFor(control);
      let score = 0;
      for (const term of terms) {
        if (label.includes(term)) {
          score += term.length > 3 ? 4 : 2;
        }
      }
      if (control.tagName === "TEXTAREA" || control.isContentEditable) {
        score += terms.some((term) => ["介绍", "求职信", "备注", "message", "cover"].includes(term)) ? 3 : 0;
      }
      if (score > bestScore) {
        best = control;
        bestScore = score;
      }
    }
    return bestScore >= 2 ? best : null;
  }

  function setControlValue(control, value) {
    const text = String(value || "").trim();
    if (!text || !control) return false;
    if (control.isContentEditable) {
      control.focus();
      control.textContent = text;
    } else {
      const prototype = Object.getPrototypeOf(control);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      if (descriptor && typeof descriptor.set === "function") {
        descriptor.set.call(control, text);
      } else {
        control.value = text;
      }
    }
    control.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  async function fillCurrentPage({ automationJob = null } = {}) {
    const settings = await getSettings();
    const profile = settings.profile;
    const currentJob = extractCurrentJob();
    const job = automationJob || currentJob;
    const coverLetter = job.llmCoverLetter || shared.buildCoverLetter(profile, job);
    const fields = [
      { key: "name", value: profile.name, labels: ["姓名", "name", "真实姓名"] },
      { key: "phone", value: profile.phone, labels: ["手机", "电话", "联系方式", "mobile", "phone", "tel"] },
      { key: "email", value: profile.email, labels: ["邮箱", "email", "mail"] },
      { key: "city", value: profile.expectedCity, labels: ["城市", "地点", "期望城市", "所在地", "city"] },
      { key: "salary", value: profile.expectedSalary, labels: ["薪资", "期望薪资", "薪酬", "salary"] },
      { key: "coverLetter", value: coverLetter, labels: ["自我介绍", "求职信", "留言", "备注", "优势", "message", "cover"] }
    ];
    const filled = [];
    for (const field of fields) {
      const control = findControl(field.labels);
      if (control && setControlValue(control, field.value)) {
        filled.push(field.key);
      }
    }
    return { filled, job: stripDomFields(currentJob) };
  }

  function findActionButton() {
    const positiveWords = ["投递", "申请", "应聘", "沟通", "发送简历", "立即沟通", "立即申请", "apply"];
    const negativeWords = ["收藏", "分享", "举报", "订阅", "上传", "登录", "注册", "完善", "筛选", "搜索"];
    const candidates = Array.from(document.querySelectorAll("button, a, [role='button']")).filter(isVisible);
    let best = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      const text = shared.normalizeText(candidate.innerText || candidate.textContent || candidate.getAttribute("aria-label"));
      if (!text || candidate.disabled || candidate.getAttribute("aria-disabled") === "true") continue;
      if (negativeWords.some((word) => text.includes(shared.normalizeText(word)))) continue;
      let score = 0;
      for (const word of positiveWords) {
        if (text.includes(shared.normalizeText(word))) {
          score += word.length >= 3 ? 4 : 2;
        }
      }
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    return bestScore > 0 ? best : null;
  }

  function detectBlockingState() {
    const text = shared.normalizeText(document.body.innerText.slice(0, 12000));
    const rules = [
      { terms: ["验证码", "安全验证", "滑块", "captcha", "人机验证"], reason: "检测到验证码或安全验证" },
      { terms: ["请先登录", "登录后", "未登录", "手机号登录"], reason: "检测到登录要求" },
      { terms: ["实名认证", "身份认证", "完善在线简历"], reason: "检测到账号或简历资料要求" },
      { terms: ["访问过于频繁", "操作过于频繁", "稍后再试"], reason: "检测到平台频控提示" }
    ];
    for (const rule of rules) {
      if (rule.terms.some((term) => text.includes(shared.normalizeText(term)))) {
        return { blocked: true, reason: rule.reason };
      }
    }
    return { blocked: false, reason: "" };
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function todaysApplicationCount(settings) {
    const today = new Date().toDateString();
    return (settings.history.applications || []).filter((entry) => {
      if (!entry.createdAt) return false;
      return new Date(entry.createdAt).toDateString() === today;
    }).length;
  }

  async function applyCurrentPage({ confirmed = false, automationJob = null } = {}) {
    const settings = await getSettings();
    const blocking = detectBlockingState();
    if (settings.automation.stopOnBlocking && blocking.blocked) {
      return { applied: false, reason: blocking.reason, job: automationJob || extractCurrentJob() };
    }

    const job = extractCurrentJob();
    const localScore = shared.scoreJob(job, settings);
    const scored = { ...job, id: shared.makeJobId(job), ...localScore };
    const effectiveJob = automationJob ? { ...scored, ...automationJob } : scored;
    const effectiveScore = Number(effectiveJob.combinedScore || effectiveJob.llmScore || effectiveJob.score) || 0;
    const threshold = settings.llm.enabled ? settings.llm.minScore : settings.filters.minScore;
    const actionButton = findActionButton();
    const todayCount = todaysApplicationCount(settings);

    if (effectiveScore < threshold) {
      return {
        applied: false,
        reason: `评分 ${effectiveScore} 低于阈值 ${threshold}`,
        job: stripDomFields(effectiveJob)
      };
    }

    if (todayCount >= settings.filters.maxDailySubmissions) {
      return {
        applied: false,
        reason: `今日已达到 ${settings.filters.maxDailySubmissions} 次上限`,
        job: stripDomFields(effectiveJob)
      };
    }

    if (!actionButton) {
      return {
        applied: false,
        reason: "未找到可识别的投递/沟通按钮",
        job: stripDomFields(effectiveJob)
      };
    }

    if (settings.filters.requireManualConfirmation && !confirmed) {
      return {
        applied: false,
        requiresConfirmation: true,
        actionText: compactText(actionButton.innerText || actionButton.textContent),
        job: stripDomFields(effectiveJob)
      };
    }

    const fillResult = await fillCurrentPage({ automationJob: effectiveJob });
    await wait(settings.filters.actionDelayMs);
    actionButton.click();
    await wait(settings.filters.actionDelayMs);
    await fillCurrentPage({ automationJob: effectiveJob });

    chrome.runtime.sendMessage({
      type: "LOG_APPLICATION",
      entry: {
        id: effectiveJob.id,
        siteId: effectiveJob.siteId,
        siteName: effectiveJob.siteName,
        title: effectiveJob.title,
        company: effectiveJob.company,
        url: effectiveJob.url,
        score: effectiveJob.score,
        llmScore: effectiveJob.llmScore,
        combinedScore: effectiveScore,
        status: "clicked"
      }
    });

    return {
      applied: true,
      filled: fillResult.filled,
      actionText: compactText(actionButton.innerText || actionButton.textContent),
      job: stripDomFields(effectiveJob)
    };
  }

  async function focusTopMatch() {
    const settings = await getSettings();
    if (!lastScan.length) {
      await scanJobs();
    }
    const match = lastScan.find((job) => job.score >= settings.filters.minScore) || lastScan[0];
    if (!match || !match.card) {
      return { focused: false, reason: "当前页未找到岗位卡片" };
    }
    match.card.scrollIntoView({ behavior: "smooth", block: "center" });
    match.card.classList.add("auto-apply-highlight");
    return { focused: true, job: stripDomFields(match) };
  }

  function pageStatus() {
    return {
      supported: true,
      site,
      url: location.href,
      title: document.title,
      lastScanCount: lastScan.length,
      blocking: detectBlockingState()
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== "string") {
      return false;
    }

    (async () => {
      switch (message.type) {
        case "GET_PAGE_STATUS":
          return pageStatus();
        case "SCAN_JOBS":
          return scanJobs({ highlight: Boolean(message.highlight) });
        case "CLEAR_HIGHLIGHTS":
          clearHighlights();
          return { cleared: true };
        case "FILL_CURRENT_PAGE":
          return fillCurrentPage({ automationJob: message.automationJob || null });
        case "APPLY_CURRENT_PAGE":
          return applyCurrentPage({
            confirmed: Boolean(message.confirmed),
            automationJob: message.automationJob || null
          });
        case "FOCUS_TOP_MATCH":
          return focusTopMatch();
        default:
          return { error: `Unknown content message type: ${message.type}` };
      }
    })()
      .then((payload) => sendResponse(payload))
      .catch((error) => sendResponse({ error: error.message || String(error) }));

    return true;
  });
})();
