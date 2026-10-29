import type { Locale } from "./i18n";

export type WorkspaceStartId = "personal-lab" | "code-workspace" | "reverse-engineering";

export interface WorkspaceStartEntry {
  readonly title: string;
  readonly description: string;
}

export interface WorkspaceStartCopy {
  readonly sectionLabel: string;
  readonly topNavWorkspace: string;
  readonly heroNote: string;
  readonly workflows: Readonly<Record<WorkspaceStartId, WorkspaceStartEntry>>;
}

const translations = {
  ar: {
    sectionLabel: "اختر خطوتك التالية",
    topNavWorkspace: "مساحة النماذج",
    heroNote: "مهمة واحدة. إجابات قابلة للمقارنة.",
    workflows: {
      "personal-lab": { title: "المختبر الشخصي", description: "اختبر النماذج على مهامك وقارن إجاباتها." },
      "code-workspace": { title: "مساحة البرمجة", description: "اعمل مع وكلاء البرمجة في مساحة واحدة." },
      "reverse-engineering": { title: "الهندسة العكسية", description: "افحص ملفاتك وتحقق من توفر محركات التحليل." },
    },
  },
  en: {
    sectionLabel: "Choose your next step",
    topNavWorkspace: "Model workspace",
    heroNote: "One task. Comparable answers.",
    workflows: {
      "personal-lab": { title: "Personal lab", description: "Test models on your tasks and compare their answers." },
      "code-workspace": { title: "Coding workspace", description: "Work with coding agents in one place." },
      "reverse-engineering": { title: "Reverse engineering", description: "Inspect your artifacts and check analysis engine availability." },
    },
  },
  fr: {
    sectionLabel: "Choisissez votre prochaine étape",
    topNavWorkspace: "Espace des modèles",
    heroNote: "Une tâche. Des réponses comparables.",
    workflows: {
      "personal-lab": { title: "Laboratoire personnel", description: "Testez les modèles sur vos tâches et comparez leurs réponses." },
      "code-workspace": { title: "Espace de développement", description: "Travaillez avec des agents de programmation au même endroit." },
      "reverse-engineering": { title: "Rétro-ingénierie", description: "Examinez vos fichiers et vérifiez la disponibilité des moteurs d’analyse." },
    },
  },
  es: {
    sectionLabel: "Elige tu siguiente paso",
    topNavWorkspace: "Espacio de modelos",
    heroNote: "Una tarea. Respuestas comparables.",
    workflows: {
      "personal-lab": { title: "Laboratorio personal", description: "Prueba modelos con tus tareas y compara sus respuestas." },
      "code-workspace": { title: "Espacio de programación", description: "Trabaja con agentes de programación en un solo lugar." },
      "reverse-engineering": { title: "Ingeniería inversa", description: "Examina tus archivos y comprueba qué motores de análisis están disponibles." },
    },
  },
  zh: {
    sectionLabel: "选择下一步",
    topNavWorkspace: "模型工作区",
    heroNote: "同一任务。可比较的回答。",
    workflows: {
      "personal-lab": { title: "个人实验室", description: "用你的任务测试模型，比较它们的回答。" },
      "code-workspace": { title: "编程工作区", description: "在同一空间与编程智能体协作。" },
      "reverse-engineering": { title: "逆向工程", description: "检查你的文件，查看分析引擎是否可用。" },
    },
  },
  ko: {
    sectionLabel: "다음 단계를 선택하세요",
    topNavWorkspace: "모델 작업 공간",
    heroNote: "하나의 작업. 비교할 수 있는 답변.",
    workflows: {
      "personal-lab": { title: "개인 실험실", description: "내 작업으로 모델을 테스트하고 답변을 비교하세요." },
      "code-workspace": { title: "코딩 작업 공간", description: "한곳에서 코딩 에이전트와 함께 작업하세요." },
      "reverse-engineering": { title: "리버스 엔지니어링", description: "파일을 살펴보고 분석 엔진의 사용 가능 여부를 확인하세요." },
    },
  },
  ur: {
    sectionLabel: "اپنا اگلا قدم منتخب کریں",
    topNavWorkspace: "ماڈلز کی جگہ",
    heroNote: "ایک کام۔ قابل موازنہ جوابات۔",
    workflows: {
      "personal-lab": { title: "ذاتی تجربہ گاہ", description: "اپنے کاموں پر ماڈلز آزمائیں اور ان کے جوابات کا موازنہ کریں۔" },
      "code-workspace": { title: "پروگرامنگ کی جگہ", description: "ایک ہی جگہ پروگرامنگ ایجنٹس کے ساتھ کام کریں۔" },
      "reverse-engineering": { title: "ریورس انجینئرنگ", description: "اپنی فائلیں دیکھیں اور تجزیاتی انجنوں کی دستیابی جانچیں۔" },
    },
  },
  fa: {
    sectionLabel: "گام بعدی خود را انتخاب کنید",
    topNavWorkspace: "فضای مدل‌ها",
    heroNote: "یک کار. پاسخ‌های قابل مقایسه.",
    workflows: {
      "personal-lab": { title: "آزمایشگاه شخصی", description: "مدل‌ها را با کارهای خود بیازمایید و پاسخ‌ها را مقایسه کنید." },
      "code-workspace": { title: "فضای برنامه‌نویسی", description: "در یک فضا با عامل‌های برنامه‌نویسی کار کنید." },
      "reverse-engineering": { title: "مهندسی معکوس", description: "فایل‌های خود و در دسترس بودن موتورهای تحلیل را بررسی کنید." },
    },
  },
  pt: {
    sectionLabel: "Escolha o próximo passo",
    topNavWorkspace: "Espaço de modelos",
    heroNote: "Uma tarefa. Respostas comparáveis.",
    workflows: {
      "personal-lab": { title: "Laboratório pessoal", description: "Teste modelos com suas tarefas e compare as respostas." },
      "code-workspace": { title: "Espaço de programação", description: "Trabalhe com agentes de programação em um só lugar." },
      "reverse-engineering": { title: "Engenharia reversa", description: "Examine seus arquivos e verifique a disponibilidade dos motores de análise." },
    },
  },
  it: {
    sectionLabel: "Scegli il prossimo passo",
    topNavWorkspace: "Spazio dei modelli",
    heroNote: "Un compito. Risposte confrontabili.",
    workflows: {
      "personal-lab": { title: "Laboratorio personale", description: "Prova i modelli sui tuoi compiti e confronta le risposte." },
      "code-workspace": { title: "Spazio di programmazione", description: "Lavora con gli agenti di programmazione in un unico spazio." },
      "reverse-engineering": { title: "Ingegneria inversa", description: "Esamina i tuoi file e verifica i motori di analisi disponibili." },
    },
  },
  ru: {
    sectionLabel: "Выберите следующий шаг",
    topNavWorkspace: "Рабочая область моделей",
    heroNote: "Одна задача. Сопоставимые ответы.",
    workflows: {
      "personal-lab": { title: "Личная лаборатория", description: "Проверяйте модели на своих задачах и сравнивайте ответы." },
      "code-workspace": { title: "Среда программирования", description: "Работайте с агентами программирования в одном месте." },
      "reverse-engineering": { title: "Обратная разработка", description: "Изучайте свои файлы и проверяйте доступность движков анализа." },
    },
  },
  de: {
    sectionLabel: "Wählen Sie den nächsten Schritt",
    topNavWorkspace: "Modellarbeitsbereich",
    heroNote: "Eine Aufgabe. Vergleichbare Antworten.",
    workflows: {
      "personal-lab": { title: "Persönliches Labor", description: "Modelle mit eigenen Aufgaben testen und Antworten vergleichen." },
      "code-workspace": { title: "Programmierbereich", description: "Mit Programmieragenten an einem Ort arbeiten." },
      "reverse-engineering": { title: "Reverse Engineering", description: "Eigene Dateien untersuchen und die Verfügbarkeit der Analysewerkzeuge prüfen." },
    },
  },
  nl: {
    sectionLabel: "Kies je volgende stap",
    topNavWorkspace: "Modelwerkruimte",
    heroNote: "Eén taak. Vergelijkbare antwoorden.",
    workflows: {
      "personal-lab": { title: "Persoonlijk lab", description: "Test modellen met je eigen taken en vergelijk hun antwoorden." },
      "code-workspace": { title: "Programmeerwerkruimte", description: "Werk op één plek met programmeeragenten." },
      "reverse-engineering": { title: "Reverse engineering", description: "Bekijk je bestanden en controleer welke analyse-engines beschikbaar zijn." },
    },
  },
} satisfies Record<Locale, WorkspaceStartCopy>;

export function workspaceStartCopy(locale: Locale): WorkspaceStartCopy {
  return translations[locale];
}
