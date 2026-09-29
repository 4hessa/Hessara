import type { Locale } from "@/lib/i18n";

type HeroCopy = {
  eyebrow: string;
  headline: string;
  description: string;
  explore: string;
  how: string;
  models: string;
  tools: string;
  tasks: string;
};

export const heroCopy: Record<Locale, HeroCopy> = {
  ar: {
    eyebrow: "مختبر Hessara لتقييم النماذج",
    headline: "وضوح أكثر في اختيار النموذج",
    description:
      "اختبر النماذج على مهام واضحة، وقارن الجودة والسرعة والثبات والتكلفة قبل أن تبني عليها.",
    explore: "استكشف النماذج",
    how: "كيف تعمل المنصة",
    models: "نموذجًا للاستكشاف",
    tools: "أداة برابط مباشر",
    tasks: "مهمة تقييم",
  },
  en: {
    eyebrow: "Hessara / model evaluation lab",
    headline: "A clearer way to choose a model.",
    description:
      "Test models on defined tasks. Compare quality, speed, stability and cost before building on them.",
    explore: "Explore models",
    how: "How it works",
    models: "models to explore",
    tools: "tools with direct links",
    tasks: "evaluation tasks",
  },
  fr: {
    eyebrow: "Hessara / laboratoire d’évaluation",
    headline: "Choisissez votre modèle avec plus de clarté.",
    description:
      "Testez les modèles sur des tâches définies. Comparez qualité, vitesse, stabilité et coût avant de les adopter.",
    explore: "Explorer les modèles",
    how: "Comment ça marche",
    models: "modèles à explorer",
    tools: "outils avec lien direct",
    tasks: "tâches d’évaluation",
  },
  es: {
    eyebrow: "Hessara / laboratorio de evaluación",
    headline: "Elige tu modelo con más claridad.",
    description:
      "Prueba modelos en tareas definidas. Compara calidad, velocidad, estabilidad y coste antes de utilizarlos.",
    explore: "Explorar modelos",
    how: "Cómo funciona",
    models: "modelos para explorar",
    tools: "herramientas con enlace directo",
    tasks: "tareas de evaluación",
  },
  zh: {
    eyebrow: "Hessara / 模型评测实验室",
    headline: "更清楚地选择合适的模型。",
    description:
      "在明确的任务上测试模型，比较质量、速度、稳定性和成本，再决定如何使用。",
    explore: "探索模型",
    how: "工作原理",
    models: "个可探索的模型",
    tools: "款附有直达链接的工具",
    tasks: "项评测任务",
  },
  ko: {
    eyebrow: "Hessara / 모델 평가 연구실",
    headline: "더 명확하게 모델을 선택하세요.",
    description:
      "정해진 과제로 모델을 테스트하고 품질, 속도, 안정성, 비용을 비교한 뒤 선택하세요.",
    explore: "모델 살펴보기",
    how: "작동 방식",
    models: "개 모델",
    tools: "개 바로가기 도구",
    tasks: "개 평가 과제",
  },
  ur: {
    eyebrow: "Hessara / ماڈل جانچ کی تجربہ گاہ",
    headline: "ماڈل کے انتخاب میں زیادہ وضاحت۔",
    description:
      "واضح کاموں پر ماڈل آزمائیں، پھر معیار، رفتار، استحکام اور لاگت کا موازنہ کریں۔",
    explore: "ماڈل دیکھیں",
    how: "یہ کیسے کام کرتا ہے",
    models: "ماڈل دریافت کریں",
    tools: "براہِ راست ربط والی ٹولز",
    tasks: "جانچ کے کام",
  },
  fa: {
    eyebrow: "Hessara / آزمایشگاه ارزیابی مدل‌ها",
    headline: "مدل مناسب را با دیدی روشن‌تر انتخاب کنید.",
    description:
      "مدل‌ها را با وظایف مشخص بیازمایید و کیفیت، سرعت، پایداری و هزینه را پیش از انتخاب مقایسه کنید.",
    explore: "کاوش مدل‌ها",
    how: "نحوهٔ کار",
    models: "مدل برای کاوش",
    tools: "ابزار با پیوند مستقیم",
    tasks: "وظیفهٔ ارزیابی",
  },
  pt: {
    eyebrow: "Hessara / laboratório de avaliação",
    headline: "Escolha o seu modelo com mais clareza.",
    description:
      "Teste modelos em tarefas definidas. Compare qualidade, velocidade, estabilidade e custo antes de os adotar.",
    explore: "Explorar modelos",
    how: "Como funciona",
    models: "modelos para explorar",
    tools: "ferramentas com ligação direta",
    tasks: "tarefas de avaliação",
  },
  it: {
    eyebrow: "Hessara / laboratorio di valutazione",
    headline: "Scegli il modello con più chiarezza.",
    description:
      "Prova i modelli su attività definite. Confronta qualità, velocità, stabilità e costi prima di usarli.",
    explore: "Esplora i modelli",
    how: "Come funziona",
    models: "modelli da esplorare",
    tools: "strumenti con link diretto",
    tasks: "attività di valutazione",
  },
  ru: {
    eyebrow: "Hessara / лаборатория оценки моделей",
    headline: "Выбирайте модель с большей уверенностью.",
    description:
      "Проверяйте модели на конкретных задачах. Сравнивайте качество, скорость, стабильность и стоимость.",
    explore: "Изучить модели",
    how: "Как это работает",
    models: "моделей для изучения",
    tools: "инструментов с прямыми ссылками",
    tasks: "задач оценки",
  },
  de: {
    eyebrow: "Hessara / Labor für Modellbewertung",
    headline: "Wählen Sie Ihr Modell mit mehr Klarheit.",
    description:
      "Testen Sie Modelle mit klaren Aufgaben. Vergleichen Sie Qualität, Tempo, Stabilität und Kosten vor dem Einsatz.",
    explore: "Modelle entdecken",
    how: "So funktioniert es",
    models: "Modelle zum Entdecken",
    tools: "Tools mit direktem Link",
    tasks: "Bewertungsaufgaben",
  },
  nl: {
    eyebrow: "Hessara / laboratorium voor modelbeoordeling",
    headline: "Kies uw model met meer duidelijkheid.",
    description:
      "Test modellen met duidelijke taken. Vergelijk kwaliteit, snelheid, stabiliteit en kosten voordat u ze inzet.",
    explore: "Modellen verkennen",
    how: "Hoe het werkt",
    models: "modellen om te verkennen",
    tools: "tools met directe links",
    tasks: "beoordelingstaken",
  },
};
