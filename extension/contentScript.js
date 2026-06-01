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

  function mergeJobLists(targetMap, jobs) {
    for (const job of jobs || []) {
      const id = job.id || shared.makeJobId(job);
      if (!targetMap.has(id)) {
        targetMap.set(id, { ...job, id });
      }
    }
  }

  function scrollableDelta(element) {
    return Math.max(0, (element?.scrollHeight || 0) - (element?.clientHeight || 0));
  }

  function canScrollElement(element) {
    if (!element || !isVisible(element)) return false;
    const style = getComputedStyle(element);
    const overflow = `${style.overflowY} ${style.overflow}`;
    return (
      /(auto|scroll|overlay)/u.test(overflow) ||
      scrollableDelta(element) > 120
    ) && scrollableDelta(element) > 80;
  }

  function addScrollableCandidate(target, element, cards) {
    if (!canScrollElement(element)) return;
    const current = target.get(element) || { element, cardCount: 0 };
    current.cardCount += cards.filter((card) => element.contains(card)).length;
    target.set(element, current);
  }

  function addScrollableAncestors(target, element, cards) {
    for (let node = element?.parentElement; node && node !== document.body; node = node.parentElement) {
      addScrollableCandidate(target, node, cards);
    }
  }

  function scoreScrollableCandidate(candidate) {
    const element = candidate.element;
    const rect = element.getBoundingClientRect();
    const className = String(element.className || "").toLowerCase();
    const listHint = /job-list|joblist|search-job|list-box|job-card|job-primary|job-wrapper|position-list/u.test(className);
    const detailHint = /detail|description|job-sec|chat|message|conversation/u.test(className);
    let score = Math.min(scrollableDelta(element), 4000);

    score += candidate.cardCount * 10000;
    if (listHint) score += 3000;
    if (detailHint) score -= 3000;

    if (site.id === "boss") {
      if (rect.left < window.innerWidth * 0.5) score += 2500;
      if (rect.width < window.innerWidth * 0.55) score += 1200;
      if (rect.left > window.innerWidth * 0.45) score -= 2500;
      if (candidate.cardCount > 0) score += 3000;
    }

    return score;
  }

  function findScrollableContainer() {
    const cards = collectCards();
    const cardContainers = new Map();
    for (const card of cards) {
      addScrollableCandidate(cardContainers, card, cards);
      addScrollableAncestors(cardContainers, card, cards);
    }

    const preferred = Array.from(cardContainers.values())
      .filter((candidate) => candidate.cardCount > 0)
      .sort((left, right) => scoreScrollableCandidate(right) - scoreScrollableCandidate(left));

    if (preferred.length) {
      return preferred[0].element;
    }

    if (cards.length && document.documentElement.scrollHeight > window.innerHeight + 120) {
      return document.scrollingElement || document.documentElement;
    }

    const candidates = Array.from(document.querySelectorAll("main, [class*='list'], [class*='job'], [class*='scroll'], section, div"))
      .filter((element) => {
        return canScrollElement(element);
      })
      .map((element) => ({ element, cardCount: 0 }))
      .sort((left, right) => scoreScrollableCandidate(right) - scoreScrollableCandidate(left));

    return candidates[0]?.element || document.scrollingElement || document.documentElement;
  }

  function scrollContainerOnce(container) {
    if (!container) return false;
    const before = container === document.scrollingElement || container === document.documentElement
      ? window.scrollY
      : container.scrollTop;
    const step = Math.max(360, Math.round((container.clientHeight || window.innerHeight) * 0.85));

    if (container === document.scrollingElement || container === document.documentElement) {
      window.scrollBy({ top: step, behavior: "smooth" });
      return window.scrollY !== before || document.documentElement.scrollHeight > window.innerHeight;
    }

    container.scrollBy({ top: step, behavior: "smooth" });
    return container.scrollTop !== before || container.scrollHeight > container.clientHeight;
  }

  function buttonText(element) {
    return shared.normalizeText(
      [
        element.innerText,
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title")
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  function isDisabledAction(element) {
    return (
      element.disabled ||
      element.getAttribute("aria-disabled") === "true" ||
      element.classList.contains("disabled") ||
      element.closest("[disabled], [aria-disabled='true']")
    );
  }

  const PRIMARY_ACTION_TERMS = [
    "apply",
    "\u7533\u8bf7",
    "\u6295\u9012",
    "\u6295\u9012\u7b80\u5386",
    "\u7acb\u5373\u6295\u9012",
    "\u7acb\u5373\u7533\u8bf7",
    "\u6c9f\u901a",
    "\u7acb\u5373\u6c9f\u901a",
    "\u6253\u62db\u547c"
  ];

  const FOLLOWUP_ACTION_TERMS = [
    "send",
    "ok",
    "confirm",
    "\u53d1\u9001",
    "\u786e\u5b9a",
    "\u786e\u8ba4",
    "\u786e\u8ba4\u6295\u9012",
    "\u7acb\u5373\u6295\u9012",
    "\u7ee7\u7eed\u6295\u9012",
    "\u7acb\u5373\u6c9f\u901a",
    "\u5f00\u59cb\u6c9f\u901a",
    "\u53d1\u8d77\u6c9f\u901a",
    "\u6253\u62db\u547c",
    "\u540c\u610f",
    "\u6211\u77e5\u9053\u4e86"
  ];

  const NEGATIVE_ACTION_TERMS = [
    "\u53d6\u6d88",
    "\u5173\u95ed",
    "\u7a0d\u540e",
    "\u6682\u4e0d",
    "\u8fd4\u56de",
    "\u6536\u85cf",
    "\u5206\u4eab",
    "\u4e3e\u62a5",
    "\u7b5b\u9009",
    "\u641c\u7d22",
    "\u4e0a\u4f20",
    "\u767b\u5f55",
    "\u6ce8\u518c",
    "\u5b8c\u5584",
    "\u5df2\u6c9f\u901a",
    "\u7ee7\u7eed\u6c9f\u901a",
    "\u5df2\u6295\u9012",
    "\u5df2\u7533\u8bf7"
  ];

  const SUCCESS_TERMS = [
    "\u5df2\u6c9f\u901a",
    "\u7ee7\u7eed\u6c9f\u901a",
    "\u6c9f\u901a\u4e2d",
    "\u5df2\u6295\u9012",
    "\u6295\u9012\u6210\u529f",
    "\u7b80\u5386\u5df2\u6295\u9012",
    "\u7b80\u5386\u5df2\u53d1\u9001",
    "\u5df2\u53d1\u9001",
    "\u53d1\u9001\u6210\u529f",
    "\u5df2\u7533\u8bf7",
    "\u7533\u8bf7\u6210\u529f",
    "\u6253\u62db\u547c\u6210\u529f"
  ];

  function containsAnyNormalized(text, terms) {
    const normalized = shared.normalizeText(text);
    return terms.some((term) => normalized.includes(shared.normalizeText(term)));
  }

  function visibleButtonCandidates() {
    return Array.from(new Set(Array.from(document.querySelectorAll("button, a, [role='button'], [class*='btn'], [class*='button']"))))
      .filter((candidate) => isVisible(candidate) && !isDisabledAction(candidate));
  }

  function isDialogScoped(element) {
    return Boolean(element.closest("[role='dialog'], [aria-modal='true'], [class*='modal'], [class*='dialog'], [class*='popover'], [class*='popup']"));
  }

  function findButtonByTerms(positiveTerms, negativeTerms = [], { preferDialog = false } = {}) {
    let best = null;
    let bestScore = 0;
    for (const candidate of visibleButtonCandidates()) {
      const text = buttonText(candidate);
      if (!text || containsAnyNormalized(text, negativeTerms)) continue;
      let score = 0;
      for (const term of positiveTerms) {
        const normalized = shared.normalizeText(term);
        if (normalized && text.includes(normalized)) {
          score += normalized.length >= 3 ? 5 : 3;
        }
      }
      if (!score) continue;
      if (preferDialog && isDialogScoped(candidate)) score += 8;
      if (candidate.matches("button, a, [role='button']")) score += 4;
      if (candidate.tagName === "BUTTON") score += 1;
      if (text.length <= 8) score += 1;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  }

  function resolveClickableElement(element) {
    if (!element) return null;
    if (element.matches("button, a, [role='button']")) {
      return element;
    }
    const nested = Array.from(element.querySelectorAll("button, a, [role='button']")).find((candidate) => {
      const text = buttonText(candidate);
      return isVisible(candidate) && !isDisabledAction(candidate) && text && buttonText(element).includes(text);
    });
    return nested || element;
  }

  function clickElement(element) {
    const target = resolveClickableElement(element);
    if (!target) return false;
    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    target.focus?.();
    target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    target.click();
    return true;
  }

  function detectApplicationSuccess() {
    if (site.id === "boss" && /\/web\/geek\/chat/u.test(location.pathname)) {
      return { success: true, reason: "BOSS chat page opened" };
    }
    const text = document.body ? document.body.innerText.slice(0, 16000) : "";
    if (containsAnyNormalized(text, SUCCESS_TERMS)) {
      return { success: true, reason: "application already completed or confirmed" };
    }
    return { success: false, reason: "" };
  }

  function findFollowupActionButton() {
    return findButtonByTerms(FOLLOWUP_ACTION_TERMS, NEGATIVE_ACTION_TERMS, { preferDialog: true });
  }

  async function finishApplicationFlow({ settings, effectiveJob, primaryActionText }) {
    const actions = primaryActionText ? [primaryActionText] : [];
    for (let round = 0; round < 5; round += 1) {
      await wait(settings.filters.actionDelayMs);
      await fillCurrentPage({ automationJob: effectiveJob });

      const success = detectApplicationSuccess();
      if (success.success) {
        return { applied: true, verified: true, actions, reason: success.reason };
      }

      const blocking = detectBlockingState({ actionAvailable: true });
      if (settings.automation.stopOnBlocking && blocking.blocked) {
        return { applied: false, blocked: true, actions, reason: blocking.reason };
      }

      const followup = findFollowupActionButton();
      if (!followup) {
        continue;
      }
      const actionText = compactText(followup.innerText || followup.textContent || followup.getAttribute("aria-label"));
      actions.push(actionText);
      clickElement(followup);
    }

    const success = detectApplicationSuccess();
    if (success.success) {
      return { applied: true, verified: true, actions, reason: success.reason };
    }
    return { applied: true, verified: false, actions, reason: "primary action clicked; no blocking state detected" };
  }

  function clickLoadMoreButton() {
    const positiveTerms = ["加载更多", "查看更多", "更多职位", "更多岗位", "展开更多", "load more", "more"];
    const negativeTerms = ["投递", "申请", "沟通", "登录", "注册", "收藏", "筛选", "搜索"];
    const candidates = Array.from(document.querySelectorAll("button, a, [role='button']")).filter(isVisible);
    for (const candidate of candidates) {
      const text = buttonText(candidate);
      if (!text || isDisabledAction(candidate)) continue;
      const href = candidate.getAttribute("href") || "";
      if (/\/job_detail\//u.test(href)) continue;
      if (candidate.tagName === "A" && text.length > 30) continue;
      if (negativeTerms.some((term) => text.includes(shared.normalizeText(term)))) continue;
      if (positiveTerms.some((term) => text.includes(shared.normalizeText(term)))) {
        const lastClickedAt = Number(candidate.dataset.autoApplyClickedAt || 0);
        if (Date.now() - lastClickedAt < 5000) continue;
        candidate.dataset.autoApplyClickedAt = String(Date.now());
        candidate.click();
        return true;
      }
    }
    return false;
  }

  function findNextPageControl() {
    const positiveTerms = ["下一页", "下页", "next", ">", "›", "»"];
    const negativeTerms = ["投递", "申请", "沟通", "登录", "注册", "收藏", "筛选", "搜索"];
    const candidates = Array.from(document.querySelectorAll("a[href], button, [role='button']")).filter(isVisible);
    for (const candidate of candidates) {
      const text = buttonText(candidate);
      if (!text || isDisabledAction(candidate)) continue;
      if (negativeTerms.some((term) => text.includes(shared.normalizeText(term)))) continue;
      const href = candidate.getAttribute("href") || "";
      if (/\/job_detail\//u.test(href)) continue;
      const aria = shared.normalizeText(candidate.getAttribute("aria-label") || "");
      const rel = shared.normalizeText(candidate.getAttribute("rel") || "");
      const isNext =
        rel === "next" ||
        positiveTerms.some((term) => text === shared.normalizeText(term)) ||
        aria.includes("next") ||
        aria.includes("下一页");
      if (!isNext) continue;

      return {
        element: candidate,
        url: href ? new URL(href, location.href).href : ""
      };
    }
    return null;
  }

  async function collectCurrentPage({ highlight = false } = {}) {
    const settings = await getSettings();
    const automation = settings.automation;
    const collected = new Map();
    const stats = { scrolls: 0, loadMoreClicks: 0, inPageNextClicks: 0, pagesVisited: 1 };
    let blocked = detectBlockingState();
    let nextPageUrl = "";

    for (let pageIndex = 0; pageIndex < automation.collectionMaxPages; pageIndex += 1) {
      let staleRounds = 0;
      let lastCount = collected.size;

      for (let scrollIndex = 0; scrollIndex < automation.collectionMaxScrolls; scrollIndex += 1) {
        blocked = detectBlockingState();
        if (automation.stopOnBlocking && blocked.blocked) {
          return { site, jobs: Array.from(collected.values()), nextPageUrl: "", blocked, stats };
        }

        const scan = await scanJobs({ highlight: false });
        mergeJobLists(collected, scan.jobs);
        const clickedMore = clickLoadMoreButton();
        if (clickedMore) stats.loadMoreClicks += 1;

        const container = findScrollableContainer();
        if (scrollContainerOnce(container)) stats.scrolls += 1;
        await wait(automation.collectionScrollDelayMs);

        if (collected.size === lastCount && !clickedMore) {
          staleRounds += 1;
        } else {
          staleRounds = 0;
          lastCount = collected.size;
        }
        if (staleRounds >= 4) break;
      }

      if (!automation.collectionClickNextPage || pageIndex >= automation.collectionMaxPages - 1) {
        break;
      }

      const next = findNextPageControl();
      if (!next) break;
      if (next.url) {
        nextPageUrl = next.url;
        break;
      }

      next.element.click();
      stats.inPageNextClicks += 1;
      stats.pagesVisited += 1;
      await wait(Math.max(automation.navigationDelayMs, automation.collectionScrollDelayMs * 2));
    }

    const jobs = Array.from(collected.values()).sort((left, right) => (right.score || 0) - (left.score || 0));
    lastScan = lastScan.filter((job) => collected.has(job.id));
    if (highlight) {
      renderHighlights(lastScan, settings.filters.minScore);
    }
    return {
      site,
      jobs,
      nextPageUrl,
      blocked,
      stats
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
    if (detectApplicationSuccess().success) {
      return null;
    }
    const robustMatch = findButtonByTerms(PRIMARY_ACTION_TERMS, NEGATIVE_ACTION_TERMS);
    if (robustMatch) {
      return robustMatch;
    }

    const positiveWords = [
      "投递",
      "申请",
      "应聘",
      "沟通",
      "聊一聊",
      "发送简历",
      "投递简历",
      "立即沟通",
      "继续沟通",
      "立即申请",
      "立即投递",
      "apply"
    ];
    const negativeWords = ["收藏", "分享", "举报", "订阅", "上传", "登录", "注册", "完善", "筛选", "搜索", "已沟通", "已投递"];
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

  function detectBlockingState({ actionAvailable = false } = {}) {
    const text = shared.normalizeText(document.body.innerText.slice(0, 12000));
    const hardBlockTerms = [
      "captcha",
      "\u9a8c\u8bc1\u7801",
      "\u5b89\u5168\u9a8c\u8bc1",
      "\u6ed1\u5757",
      "\u8bf7\u767b\u5f55",
      "\u767b\u5f55\u540e",
      "\u64cd\u4f5c\u9891\u7e41",
      "\u8bbf\u95ee\u5f02\u5e38",
      "\u4eca\u65e5\u5df2\u8fbe",
      "\u8fbe\u5230\u4e0a\u9650",
      "\u4eca\u65e5\u6c9f\u901a\u5df2\u8fbe",
      "\u8bf7\u5b8c\u6210\u8ba4\u8bc1"
    ];
    if (containsAnyNormalized(text, hardBlockTerms)) {
      return { blocked: true, reason: "manual verification, login, rate limit, or daily limit required" };
    }
    const rules = [
      { terms: ["验证码", "安全验证", "滑块", "captcha", "人机验证"], reason: "检测到验证码或安全验证" },
      { terms: ["请先登录", "登录后", "未登录", "手机号登录"], reason: "检测到登录要求" },
      { terms: ["实名认证", "身份认证", "完善在线简历"], reason: "检测到账号或简历资料要求" },
      { terms: ["访问过于频繁", "操作过于频繁", "稍后再试"], reason: "检测到平台频控提示" }
    ];
    for (const [ruleIndex, rule] of rules.entries()) {
      if (rule.terms.some((term) => text.includes(shared.normalizeText(term)))) {
        if ((rule.softWhenActionAvailable || ruleIndex === 2) && actionAvailable) {
          continue;
        }
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
    const actionButton = findActionButton();
    const blocking = detectBlockingState({ actionAvailable: Boolean(actionButton) });
    if (settings.automation.stopOnBlocking && blocking.blocked) {
      return { applied: false, blocked: true, reason: blocking.reason, job: automationJob || extractCurrentJob() };
    }

    const job = extractCurrentJob();
    const localScore = shared.scoreJob(job, settings);
    const scored = { ...job, id: shared.makeJobId(job), ...localScore };
    const effectiveJob = automationJob ? { ...scored, ...automationJob } : scored;
    const effectiveScore = shared.effectiveApplicationScore(effectiveJob, settings);
    const threshold = settings.llm.enabled ? settings.llm.minScore : settings.filters.minScore;
    const todayCount = todaysApplicationCount(settings);

    if (effectiveScore < threshold) {
      return {
        applied: false,
        blocked: false,
        reason: `评分 ${effectiveScore} 低于阈值 ${threshold}`,
        job: stripDomFields(effectiveJob)
      };
    }

    if (todayCount >= settings.filters.maxDailySubmissions) {
      return {
        applied: false,
        blocked: true,
        limitReached: true,
        reason: `今日已达到 ${settings.filters.maxDailySubmissions} 次上限`,
        job: stripDomFields(effectiveJob)
      };
    }

    const alreadyCompleted = detectApplicationSuccess();
    if (alreadyCompleted.success) {
      return {
        applied: false,
        blocked: false,
        alreadyApplied: true,
        reason: alreadyCompleted.reason,
        job: stripDomFields(effectiveJob)
      };
    }

    if (!actionButton) {
      return {
        applied: false,
        blocked: false,
        reason: "未找到可识别的投递/沟通按钮",
        job: stripDomFields(effectiveJob)
      };
    }

    if (settings.filters.requireManualConfirmation && !confirmed) {
      return {
        applied: false,
        blocked: false,
        requiresConfirmation: true,
        actionText: compactText(actionButton.innerText || actionButton.textContent),
        job: stripDomFields(effectiveJob)
      };
    }

    const fillResult = await fillCurrentPage({ automationJob: effectiveJob });
    await wait(settings.filters.actionDelayMs);
    const primaryActionText = compactText(actionButton.innerText || actionButton.textContent || actionButton.getAttribute("aria-label"));
    clickElement(actionButton);
    const flow = await finishApplicationFlow({ settings, effectiveJob, primaryActionText });

    if (!flow.applied) {
      return {
        applied: false,
        blocked: Boolean(flow.blocked),
        reason: flow.reason || "application action was not completed",
        actions: flow.actions || [],
        job: stripDomFields(effectiveJob)
      };
    }

    await new Promise((resolve) => {
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
          status: flow.verified ? "applied" : "clicked"
        }
      }, () => resolve());
    });

    return {
      applied: true,
      verified: Boolean(flow.verified),
      filled: fillResult.filled,
      actionText: primaryActionText,
      actions: flow.actions || [],
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
        case "COLLECT_CURRENT_PAGE":
          return collectCurrentPage({ highlight: Boolean(message.highlight) });
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
