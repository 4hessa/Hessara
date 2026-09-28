export type AgentCategory =
  "decision" | "personal" | "orchestration" | "specialist";

export type AgentEntry = {
  id: string;
  name: string;
  category: AgentCategory;
  summaryAr: string;
  summaryEn: string;
  url: string;
  mode: "connected" | "selfhost" | "framework";
};

export const AGENTS: AgentEntry[] = [
  {
    id: "jev",
    name: "jev",
    category: "decision",
    summaryAr:
      "قرار مُهيكل لاختيار المهمة الأنسب؛ يعمل هنا بمفتاحك من الجهة المطوّرة.",
    summaryEn:
      "Structured decisions for task selection; connect with your provider key.",
    url: "https://github.com/typesafe-ai/typesafe-sdk-js",
    mode: "connected",
  },
  {
    id: "laya",
    name: "Laya Decision",
    category: "decision",
    summaryAr: "محرك قرار مفتوح المصدر؛ اربط خادمك الآمن للاستفادة منه هنا.",
    summaryEn:
      "Open-source decision engine; connect your own secure server here.",
    url: "https://github.com/NandhaKishorM/laya",
    mode: "selfhost",
  },
  {
    id: "stuntd",
    name: "stuntd",
    category: "decision",
    summaryAr:
      "وسيط محلي متوافق مع قرارات jev ويتعلم من قرارات تطبيقك باستخدام Laya.",
    summaryEn:
      "Local Jev-compatible proxy that learns typed decisions with Laya.",
    url: "https://github.com/bladedevoff/stuntd",
    mode: "selfhost",
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    category: "personal",
    summaryAr: "مساعد شخصي يعمل ضمن بيئتك. افتح المشروع لإعداده على جهازك.",
    summaryEn:
      "Personal assistant for your own environment; set it up locally.",
    url: "https://github.com/openclaw/openclaw",
    mode: "selfhost",
  },
  {
    id: "nanobot",
    name: "nanobot",
    category: "personal",
    summaryAr: "وكيل شخصي خفيف قابل للتشغيل الذاتي والتخصيص.",
    summaryEn: "Lightweight self-hosted personal agent.",
    url: "https://github.com/HKUDS/nanobot",
    mode: "selfhost",
  },
  {
    id: "nanoclaw",
    name: "NanoClaw",
    category: "personal",
    summaryAr: "مساعد ذاتي الاستضافة مبني على العزل والبساطة.",
    summaryEn: "Self-hosted assistant focused on isolation and simplicity.",
    url: "https://github.com/nanocoai/nanoclaw",
    mode: "selfhost",
  },
  {
    id: "picoclaw",
    name: "PicoClaw",
    category: "personal",
    summaryAr: "وكيل صغير الحجم للأجهزة والبيئات محدودة الموارد.",
    summaryEn: "Compact agent for resource-constrained devices.",
    url: "https://github.com/sipeed/picoclaw",
    mode: "selfhost",
  },
  {
    id: "zeroclaw",
    name: "ZeroClaw",
    category: "personal",
    summaryAr: "مساعد ذاتي الاستضافة لمهام الأتمتة الشخصية.",
    summaryEn: "Self-hosted assistant for personal automation.",
    url: "https://github.com/zeroclaw-labs/zeroclaw",
    mode: "selfhost",
  },
  {
    id: "langgraph",
    name: "LangGraph",
    category: "orchestration",
    summaryAr: "بناء مسارات وكلاء ذات حالة وخطوات قابلة للمراجعة.",
    summaryEn: "Build stateful, inspectable agent workflows.",
    url: "https://github.com/langchain-ai/langgraph",
    mode: "framework",
  },
  {
    id: "crewai",
    name: "CrewAI",
    category: "orchestration",
    summaryAr: "تنسيق فرق من الوكلاء لأداء أعمال متعددة الخطوات.",
    summaryEn: "Orchestrate agent teams for multi-step work.",
    url: "https://github.com/crewAIInc/crewAI",
    mode: "framework",
  },
  {
    id: "agent-framework",
    name: "Microsoft Agent Framework",
    category: "orchestration",
    summaryAr: "إطار لبناء تطبيقات الوكلاء وسير عملها.",
    summaryEn: "Framework for building agent applications and workflows.",
    url: "https://github.com/microsoft/agent-framework",
    mode: "framework",
  },
  {
    id: "pydantic-ai",
    name: "Pydantic AI",
    category: "orchestration",
    summaryAr: "وكلاء بمدخلات ومخرجات واضحة وقابلة للتحقق.",
    summaryEn: "Agents with typed, validated inputs and outputs.",
    url: "https://github.com/pydantic/pydantic-ai",
    mode: "framework",
  },
  {
    id: "mastra",
    name: "Mastra",
    category: "orchestration",
    summaryAr: "إطار لبناء الوكلاء والأتمتة داخل تطبيقات جافاسكربت.",
    summaryEn: "Framework for agents and automation in JavaScript apps.",
    url: "https://github.com/mastra-ai/mastra",
    mode: "framework",
  },
  {
    id: "flowise",
    name: "Flowise",
    category: "orchestration",
    summaryAr: "بناء تدفقات الوكلاء بصريًا وربط أدواتها.",
    summaryEn: "Visual builder for agent workflows and tools.",
    url: "https://github.com/FlowiseAI/Flowise",
    mode: "selfhost",
  },
  {
    id: "dify",
    name: "Dify",
    category: "orchestration",
    summaryAr: "منصة لبناء تطبيقات الذكاء الاصطناعي والوكلاء.",
    summaryEn: "Platform for building AI applications and agents.",
    url: "https://github.com/langgenius/dify",
    mode: "selfhost",
  },
  {
    id: "paperclip",
    name: "Paperclip",
    category: "orchestration",
    summaryAr:
      "تنظيم عمل الوكلاء؛ يمكن إرسال مسودة مراجعة التقييم من Hessara بعد الإعداد.",
    summaryEn:
      "Coordinate agent work; Hessara can send an evaluation review draft after setup.",
    url: "https://github.com/paperclipai/paperclip",
    mode: "connected",
  },
  {
    id: "browser-use",
    name: "Browser Use",
    category: "specialist",
    summaryAr: "وكيل لتنفيذ خطوات داخل المتصفح تحت إشرافك.",
    summaryEn: "Agent for supervised browser tasks.",
    url: "https://github.com/browser-use/browser-use",
    mode: "selfhost",
  },
  {
    id: "openhands",
    name: "OpenHands",
    category: "specialist",
    summaryAr: "وكيل لمهام تطوير البرمجيات والعمل على المستودعات.",
    summaryEn: "Agent for software development and repository tasks.",
    url: "https://github.com/OpenHands/OpenHands",
    mode: "selfhost",
  },
  {
    id: "letta",
    name: "Letta",
    category: "specialist",
    summaryAr: "بناء وكلاء يحتفظون بالحالة والذاكرة عبر الجلسات.",
    summaryEn: "Build agents with persistent state and memory.",
    url: "https://github.com/letta-ai/letta",
    mode: "framework",
  },
];
