(function attachShared(global) {
  "use strict";

  const PLATFORM_DEFS = [
    { id: "boss", name: "BOSS直聘", domains: ["zhipin.com"] },
    { id: "51job", name: "前程无忧 51Job", domains: ["51job.com"] },
    { id: "zhaopin", name: "智联招聘", domains: ["zhaopin.com"] },
    { id: "liepin", name: "猎聘", domains: ["liepin.com"] },
    { id: "maimai", name: "脉脉", domains: ["maimai.cn"] },
    { id: "waiqi", name: "神仙外企", domains: ["waiqi.com", "offersir.com"] }
  ];

  const DEFAULT_SETTINGS = {
    profile: {
      name: "",
      phone: "",
      email: "",
      expectedRole: "",
      expectedCity: "",
      expectedSalary: "",
      skills: "",
      resumeText: "",
      coverLetterTemplate:
        "你好，我是{{name}}。我关注到贵公司的{{title}}岗位，与我的{{role}}方向和过往经验匹配。我的核心能力包括{{skills}}，希望有机会进一步沟通。"
    },
    filters: {
      includeKeywords: "AI, LLM, 自动化, Python, JavaScript, 浏览器插件",
      excludeKeywords: "培训, 保险, 电话销售, 外包驻场, 纯销售",
      preferredCities: "",
      minScore: 70,
      maxDailySubmissions: 15,
      requireManualConfirmation: true,
      actionDelayMs: 900
    },
    llm: {
      enabled: false,
      baseUrl: "https://api.openai.com/v1",
      model: "",
      apiKey: "",
      timeoutMs: 30000,
      minScore: 75,
      allowSendingResumeToLlm: false
    },
    automation: {
      enabled: false,
      autoClickApply: false,
      maxJobsPerRun: 5,
      closeTabsAfterApply: true,
      navigationDelayMs: 2500,
      stopOnBlocking: true,
      skipAlreadyApplied: true,
      autoCollectBeforeApply: true,
      collectionMaxScrolls: 18,
      collectionMaxPages: 3,
      collectionScrollDelayMs: 900,
      collectionClickNextPage: true
    },
    history: {
      applications: []
    }
  };

  const TECH_TERMS = [
    "AI",
    "AIGC",
    "API",
    "AWS",
    "Azure",
    "BERT",
    "BI",
    "C++",
    "Claude",
    "CSS",
    "Docker",
    "ERP",
    "Excel",
    "FastAPI",
    "Flask",
    "GCP",
    "Git",
    "Go",
    "GPT",
    "HTML",
    "Java",
    "JavaScript",
    "Kubernetes",
    "LangChain",
    "Linux",
    "LLM",
    "MySQL",
    "Next.js",
    "Node.js",
    "PostgreSQL",
    "Power BI",
    "Python",
    "RAG",
    "React",
    "Redis",
    "SQL",
    "Tableau",
    "TypeScript",
    "Vue",
    "产品经理",
    "数据分析",
    "机器学习",
    "深度学习",
    "后端",
    "前端",
    "运营",
    "增长",
    "自动化",
    "项目管理"
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function mergeSection(base, stored) {
    return isPlainObject(stored) ? { ...base, ...stored } : base;
  }

  function mergeSettings(stored) {
    const base = clone(DEFAULT_SETTINGS);
    if (!isPlainObject(stored)) {
      return base;
    }

    base.profile = mergeSection(base.profile, stored.profile);
    base.filters = mergeSection(base.filters, stored.filters);
    base.llm = mergeSection(base.llm, stored.llm);
    base.automation = mergeSection(base.automation, stored.automation);
    base.history = mergeSection(base.history, stored.history);

    if (!Array.isArray(base.history.applications)) {
      base.history.applications = [];
    }

    base.filters.minScore = clampNumber(base.filters.minScore, 0, 100, DEFAULT_SETTINGS.filters.minScore);
    base.filters.maxDailySubmissions = clampNumber(
      base.filters.maxDailySubmissions,
      1,
      100,
      DEFAULT_SETTINGS.filters.maxDailySubmissions
    );
    base.filters.actionDelayMs = clampNumber(base.filters.actionDelayMs, 250, 5000, DEFAULT_SETTINGS.filters.actionDelayMs);
    base.filters.requireManualConfirmation = Boolean(base.filters.requireManualConfirmation);

    base.llm.enabled = Boolean(base.llm.enabled);
    base.llm.allowSendingResumeToLlm = Boolean(base.llm.allowSendingResumeToLlm);
    base.llm.timeoutMs = clampNumber(base.llm.timeoutMs, 5000, 120000, DEFAULT_SETTINGS.llm.timeoutMs);
    base.llm.minScore = clampNumber(base.llm.minScore, 0, 100, DEFAULT_SETTINGS.llm.minScore);

    base.automation.enabled = Boolean(base.automation.enabled);
    base.automation.autoClickApply = Boolean(base.automation.autoClickApply);
    base.automation.maxJobsPerRun = clampNumber(
      base.automation.maxJobsPerRun,
      1,
      30,
      DEFAULT_SETTINGS.automation.maxJobsPerRun
    );
    base.automation.closeTabsAfterApply = Boolean(base.automation.closeTabsAfterApply);
    base.automation.navigationDelayMs = clampNumber(
      base.automation.navigationDelayMs,
      500,
      15000,
      DEFAULT_SETTINGS.automation.navigationDelayMs
    );
    base.automation.stopOnBlocking = Boolean(base.automation.stopOnBlocking);
    base.automation.skipAlreadyApplied = Boolean(base.automation.skipAlreadyApplied);
    base.automation.autoCollectBeforeApply = Boolean(base.automation.autoCollectBeforeApply);
    base.automation.collectionMaxScrolls = clampNumber(
      base.automation.collectionMaxScrolls,
      1,
      80,
      DEFAULT_SETTINGS.automation.collectionMaxScrolls
    );
    base.automation.collectionMaxPages = clampNumber(
      base.automation.collectionMaxPages,
      1,
      15,
      DEFAULT_SETTINGS.automation.collectionMaxPages
    );
    base.automation.collectionScrollDelayMs = clampNumber(
      base.automation.collectionScrollDelayMs,
      250,
      5000,
      DEFAULT_SETTINGS.automation.collectionScrollDelayMs
    );
    base.automation.collectionClickNextPage = Boolean(base.automation.collectionClickNextPage);

    return base;
  }

  function redactSettings(settings) {
    const redacted = mergeSettings(settings);
    redacted.llm.apiKey = "";
    return redacted;
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.max(min, Math.min(max, number));
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function splitTerms(value) {
    if (Array.isArray(value)) {
      return unique(value.flatMap(splitTerms));
    }
    return String(value || "")
      .split(/[\n,，、;；|/]+/u)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function unique(values) {
    const seen = new Set();
    const output = [];
    for (const value of values) {
      const item = String(value || "").trim();
      const key = normalizeText(item);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      output.push(item);
    }
    return output;
  }

  function resolveSite(hostname) {
    const host = normalizeText(hostname).replace(/^www\./, "");
    for (const platform of PLATFORM_DEFS) {
      if (platform.domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
        return platform;
      }
    }
    return null;
  }

  function buildTermSet(settings) {
    const profile = settings.profile || {};
    const filters = settings.filters || {};
    return {
      include: unique([
        ...splitTerms(filters.includeKeywords),
        ...splitTerms(profile.expectedRole),
        ...splitTerms(profile.skills),
        ...extractResumeSignals(profile.resumeText)
      ]),
      exclude: unique(splitTerms(filters.excludeKeywords)),
      preferredCities: unique([
        ...splitTerms(filters.preferredCities),
        ...splitTerms(profile.expectedCity)
      ])
    };
  }

  function extractResumeSignals(value) {
    const text = String(value || "");
    const stopWords = new Set(["and", "are", "com", "for", "from", "http", "https", "the", "with", "www"]);
    const matches = text.match(/[A-Za-z][A-Za-z0-9+#.-]{1,30}/gu) || [];
    const signals = [];
    const counts = new Map();

    for (const term of TECH_TERMS) {
      if (normalizeText(text).includes(normalizeText(term))) {
        signals.push(term);
      }
    }

    for (const match of matches) {
      const normalized = normalizeText(match).replace(/^[.-]+|[.-]+$/g, "");
      if (normalized.length < 2 || stopWords.has(normalized) || /^\d+$/u.test(normalized)) {
        continue;
      }
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }

    return unique([
      ...signals,
      ...Array.from(counts.entries())
        .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)
        .slice(0, 20)
        .map(([term]) => term)
    ]);
  }

  function extractProfileHints(value) {
    const text = String(value || "").replace(/\u00a0/g, " ").trim();
    const lines = text
      .split(/\r?\n/u)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu)?.[0] || "";
    const phone = text.match(/(?:\+?86[-\s]?)?1[3-9]\d{9}/u)?.[0] || "";
    const labeledName = text.match(/(?:姓名|名字|Name)\s*[:：]\s*([^\n\r,，|]{2,32})/iu)?.[1]?.trim() || "";
    const name =
      labeledName ||
      lines.find((line) => /^[\u4e00-\u9fa5]{2,5}$/u.test(line)) ||
      lines.find((line) => /^[A-Z][A-Za-z\s.-]{2,40}$/u.test(line)) ||
      "";
    const expectedRole =
      text.match(/(?:求职意向|应聘岗位|目标岗位|期望职位|目标职位)\s*[:：]\s*([^\n\r]{2,80})/u)?.[1]?.trim() || "";
    const expectedCity =
      text.match(/(?:期望城市|意向城市|目标城市|所在城市)\s*[:：]\s*([^\n\r]{2,40})/u)?.[1]?.trim() || "";
    const skills = unique([
      ...extractResumeSignals(text),
      ...(text.match(/(?:技能|技术栈|专业技能)\s*[:：]\s*([^\n\r]{2,160})/u)?.[1]?.split(/[、,，;；]/u) || [])
    ])
      .slice(0, 30)
      .join(", ");

    return {
      name,
      phone,
      email,
      expectedRole,
      expectedCity,
      skills,
      resumeText: text.slice(0, 60000)
    };
  }

  function scoreJob(job, settings) {
    const merged = mergeSettings(settings);
    const terms = buildTermSet(merged);
    const titleText = normalizeText(job.title);
    const companyText = normalizeText(job.company);
    const cityText = normalizeText(job.city);
    const bodyText = normalizeText([job.title, job.company, job.city, job.salary, job.description, job.rawText].join(" "));
    const positives = [];
    const negatives = [];
    let score = 20;

    if (titleText) score += 15;
    if (companyText) score += 8;
    if (cityText) score += 5;

    let includeScore = 0;
    for (const term of terms.include) {
      const normalized = normalizeText(term);
      if (!normalized) continue;
      if (titleText.includes(normalized)) {
        includeScore += 14;
        positives.push(`标题匹配：${term}`);
      } else if (bodyText.includes(normalized)) {
        includeScore += 7;
        positives.push(`内容匹配：${term}`);
      }
    }
    score += Math.min(includeScore, 38);

    for (const city of terms.preferredCities) {
      const normalized = normalizeText(city);
      if (normalized && cityText.includes(normalized)) {
        score += 10;
        positives.push(`城市匹配：${city}`);
        break;
      }
    }

    for (const term of terms.exclude) {
      const normalized = normalizeText(term);
      if (normalized && bodyText.includes(normalized)) {
        score -= 35;
        negatives.push(`排除词：${term}`);
      }
    }

    if (!positives.length && terms.include.length) {
      score -= 12;
      negatives.push("未命中核心关键词");
    }

    const finalScore = Math.max(0, Math.min(100, Math.round(score)));
    const confidence = finalScore >= 80 ? "high" : finalScore >= 60 ? "medium" : "low";
    return {
      score: finalScore,
      confidence,
      positives: unique(positives),
      negatives: unique(negatives)
    };
  }

  function hashString(input) {
    let hash = 5381;
    const text = String(input || "");
    for (let index = 0; index < text.length; index += 1) {
      hash = (hash * 33) ^ text.charCodeAt(index);
    }
    return (hash >>> 0).toString(36);
  }

  function makeJobId(job) {
    const source = [job.siteId, job.company, job.title, job.url].filter(Boolean).join("|");
    return `${job.siteId || "site"}:${hashString(source)}`;
  }

  function buildCoverLetter(profile, job) {
    const template = profile.coverLetterTemplate || DEFAULT_SETTINGS.profile.coverLetterTemplate;
    const replacements = {
      name: profile.name || "",
      phone: profile.phone || "",
      email: profile.email || "",
      role: profile.expectedRole || "目标岗位",
      city: profile.expectedCity || "",
      salary: profile.expectedSalary || "",
      skills: profile.skills || "相关经验",
      title: job.title || "该",
      company: job.company || "贵公司"
    };
    return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => replacements[key] || "");
  }

  function normalizeLlmBaseUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString().replace(/\/$/u, "");
  }

  function isLocalHttpUrl(url) {
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  }

  function validateLlmConfig(llm) {
    const config = mergeSettings({ llm }).llm;
    const errors = [];
    let normalizedBaseUrl = "";
    let originPattern = "";
    let endpoint = "";

    try {
      normalizedBaseUrl = normalizeLlmBaseUrl(config.baseUrl);
      const url = new URL(normalizedBaseUrl);
      if (!["https:", "http:"].includes(url.protocol)) {
        errors.push("base_url 只支持 http 或 https");
      }
      if (url.protocol === "http:" && !isLocalHttpUrl(url)) {
        errors.push("非本机地址必须使用 https，避免泄露 API key");
      }
      originPattern = `${url.protocol}//${url.hostname}/*`;
      endpoint = toChatCompletionsEndpoint(normalizedBaseUrl);
    } catch (_error) {
      errors.push("base_url 不是有效 URL");
    }

    if (!String(config.model || "").trim()) {
      errors.push("model 不能为空");
    }

    return {
      ok: errors.length === 0,
      errors,
      normalizedBaseUrl,
      endpoint,
      originPattern,
      config
    };
  }

  function toChatCompletionsEndpoint(baseUrl) {
    const url = new URL(baseUrl);
    const path = url.pathname.replace(/\/+$/u, "");
    if (path.endsWith("/chat/completions")) {
      url.pathname = path;
    } else if (path.endsWith("/v1")) {
      url.pathname = `${path}/chat/completions`;
    } else if (!path || path === "/") {
      url.pathname = "/v1/chat/completions";
    } else {
      url.pathname = `${path}/chat/completions`;
    }
    return url.toString();
  }

  function combineLlmScore(job, llmResult, settings) {
    const localScore = Number(job.score) || 0;
    const llmScore = clampNumber(llmResult && llmResult.score, 0, 100, localScore);
    const combinedScore = Math.round(localScore * 0.35 + llmScore * 0.65);
    const decision = String(llmResult?.decision || (combinedScore >= settings.llm.minScore ? "apply" : "skip")).toLowerCase();
    return {
      ...job,
      llmScore,
      combinedScore,
      llmDecision: ["apply", "review", "skip"].includes(decision) ? decision : "review",
      llmReason: String(llmResult?.reason || "").slice(0, 300),
      llmCoverLetter: String(llmResult?.coverLetter || "").slice(0, 1000)
    };
  }

  global.AutoApplyShared = {
    PLATFORM_DEFS,
    DEFAULT_SETTINGS,
    buildCoverLetter,
    buildTermSet,
    cloneDefaultSettings: () => clone(DEFAULT_SETTINGS),
    combineLlmScore,
    extractProfileHints,
    extractResumeSignals,
    makeJobId,
    mergeSettings,
    normalizeLlmBaseUrl,
    normalizeText,
    redactSettings,
    resolveSite,
    scoreJob,
    splitTerms,
    toChatCompletionsEndpoint,
    validateLlmConfig
  };
})(globalThis);
