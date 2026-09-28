"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Bookmark,
  Check,
  Search,
  X,
  KeyRound,
  ArrowDownToLine,
  Link2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { isRTL, translate, type Locale } from "@/lib/i18n";
import { displayName } from "@/lib/display-names";
import type { Model } from "@/lib/benchmarks";
import catalog from "@/lib/catalog/models.json";
import directory from "@/lib/catalog/tools.json";
const checkedDate = (date: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
const categories: Record<string, [string, string]> = {
  agents: ["الوكلاء والأتمتة", "Agents & automation"],
  rag: ["الاسترجاع والذاكرة", "Retrieval & memory"],
  evaluation: ["التقييم والمراقبة", "Evaluation & observability"],
  inference: ["تشغيل النماذج", "Inference & serving"],
  training: ["التدريب والبيانات", "Training & data"],
  vision: ["الرؤية الحاسوبية", "Computer vision"],
  speech: ["الصوت والكلام", "Speech & audio"],
  images: ["التوليد المرئي", "Visual generation"],
  nlp: ["معالجة اللغة", "Language & documents"],
  mcp: ["بروتوكول سياق النموذج", "MCP tools"],
  coding: ["مساعدو البرمجة", "Coding assistants"],
};
// Short controls are translated throughout the interface. The longer guide
// remains available in Arabic and English; its fallback language is marked
// explicitly below for screen readers.
const otherLocales: Exclude<Locale, "ar" | "en">[] = [
  "fr",
  "es",
  "zh",
  "ko",
  "ur",
  "fa",
  "pt",
  "it",
  "ru",
  "de",
  "nl",
];
type LocalizedRow = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];
const uiTerms: Record<string, LocalizedRow> = {
  "Meet the model. Then measure it.": [
    "Découvrez le modèle. Puis mesurez-le.",
    "Conoce el modelo. Luego mídelo.",
    "了解模型，再评测。",
    "모델을 알고, 직접 평가하세요.",
    "ماڈل کو جانیں، پھر جانچیں۔",
    "مدل را بشناسید، سپس بسنجید.",
    "Conheça o modelo. Depois, avalie.",
    "Conosci il modello. Poi misuralo.",
    "Узнайте модель. Затем оцените её.",
    "Modell kennenlernen. Dann messen.",
    "Leer het model kennen. Meet het daarna.",
  ],
  "Add another model": [
    "Ajouter un modèle",
    "Añadir otro modelo",
    "添加其他模型",
    "다른 모델 추가",
    "مزید ماڈل شامل کریں",
    "افزودن مدل دیگر",
    "Adicionar outro modelo",
    "Aggiungi un altro modello",
    "Добавить другую модель",
    "Weiteres Modell hinzufügen",
    "Ander model toevoegen",
  ],
  "Search models": [
    "Rechercher des modèles",
    "Buscar modelos",
    "搜索模型",
    "모델 검색",
    "ماڈل تلاش کریں",
    "جست‌وجوی مدل‌ها",
    "Pesquisar modelos",
    "Cerca modelli",
    "Поиск моделей",
    "Modelle suchen",
    "Modellen zoeken",
  ],
  "Search name or family…": [
    "Nom ou famille…",
    "Nombre o familia…",
    "搜索名称或系列…",
    "이름 또는 제품군 검색…",
    "نام یا خاندان تلاش کریں…",
    "جست‌وجوی نام یا خانواده…",
    "Nome ou família…",
    "Nome o famiglia…",
    "Название или семейство…",
    "Name oder Familie…",
    "Naam of familie…",
  ],
  Publisher: [
    "Éditeur",
    "Desarrollador",
    "开发者",
    "개발사",
    "تیار کنندہ",
    "توسعه‌دهنده",
    "Desenvolvedor",
    "Sviluppatore",
    "Разработчик",
    "Entwickler",
    "Ontwikkelaar",
  ],
  "Context window": [
    "Fenêtre de contexte",
    "Ventana de contexto",
    "上下文窗口",
    "컨텍스트 창",
    "سیاقی ونڈو",
    "پنجرهٔ زمینه",
    "Janela de contexto",
    "Finestra di contesto",
    "Контекстное окно",
    "Kontextfenster",
    "Contextvenster",
  ],
  "Input / output": [
    "Entrée / sortie",
    "Entrada / salida",
    "输入 / 输出",
    "입력 / 출력",
    "ان پٹ / آؤٹ پٹ",
    "ورودی / خروجی",
    "Entrada / saída",
    "Input / output",
    "Ввод / вывод",
    "Eingabe / Ausgabe",
    "Invoer / uitvoer",
  ],
  Source: [
    "Source",
    "Fuente",
    "来源",
    "출처",
    "ماخذ",
    "منبع",
    "Fonte",
    "Fonte",
    "Источник",
    "Quelle",
    "Bron",
  ],
  "No matching models. Try another name.": [
    "Aucun modèle trouvé. Essayez un autre nom.",
    "No hay modelos coincidentes. Prueba otro nombre.",
    "没有匹配的模型，请尝试其他名称。",
    "일치하는 모델이 없습니다. 다른 이름을 입력하세요.",
    "کوئی مماثل ماڈل نہیں ملا۔ دوسرا نام آزمائیں۔",
    "مدلی پیدا نشد. نام دیگری را امتحان کنید.",
    "Nenhum modelo encontrado. Tente outro nome.",
    "Nessun modello trovato. Prova un altro nome.",
    "Модели не найдены. Попробуйте другое название.",
    "Keine Modelle gefunden. Versuchen Sie einen anderen Namen.",
    "Geen modellen gevonden. Probeer een andere naam.",
  ],
  "models selected": [
    "modèles sélectionnés",
    "modelos seleccionados",
    "个已选模型",
    "개 모델 선택됨",
    "ماڈل منتخب",
    "مدل انتخاب‌شده",
    "modelos selecionados",
    "modelli selezionati",
    "моделей выбрано",
    "Modelle ausgewählt",
    "modellen geselecteerd",
  ],
  "Compare specifications": [
    "Comparer les caractéristiques",
    "Comparar especificaciones",
    "比较规格",
    "사양 비교",
    "تفصیلات کا موازنہ",
    "مقایسهٔ مشخصات",
    "Comparar especificações",
    "Confronta le specifiche",
    "Сравнить характеристики",
    "Spezifikationen vergleichen",
    "Specificaties vergelijken",
  ],
  "Connect & prepare experiment": [
    "Connecter et préparer l’expérience",
    "Conectar y preparar prueba",
    "连接并准备实验",
    "연결하고 실험 준비",
    "منسلک کریں اور تجربہ تیار کریں",
    "اتصال و آماده‌سازی آزمایش",
    "Conectar e preparar experimento",
    "Collega e prepara l’esperimento",
    "Подключить и подготовить эксперимент",
    "Verbinden und Experiment vorbereiten",
    "Verbinden en experiment voorbereiden",
  ],
  "Clear selection": [
    "Effacer la sélection",
    "Borrar selección",
    "清除选择",
    "선택 해제",
    "انتخاب ختم کریں",
    "پاک کردن انتخاب",
    "Limpar seleção",
    "Cancella selezione",
    "Снять выделение",
    "Auswahl aufheben",
    "Selectie wissen",
  ],
  "One key, multiple models": [
    "Une clé, plusieurs modèles",
    "Una clave, varios modelos",
    "一个密钥，多个模型",
    "하나의 키로 여러 모델 연결",
    "ایک کلید، متعدد ماڈلز",
    "یک کلید، چند مدل",
    "Uma chave, vários modelos",
    "Una chiave, più modelli",
    "Один ключ — несколько моделей",
    "Ein Schlüssel, mehrere Modelle",
    "Eén sleutel, meerdere modellen",
  ],
  "Manage OpenRouter keys": [
    "Gérer les clés OpenRouter",
    "Gestionar claves de OpenRouter",
    "管理 OpenRouter 密钥",
    "OpenRouter 키 관리",
    "OpenRouter کلیدوں کا انتظام",
    "مدیریت کلیدهای OpenRouter",
    "Gerir chaves OpenRouter",
    "Gestisci le chiavi OpenRouter",
    "Управление ключами OpenRouter",
    "OpenRouter-Schlüssel verwalten",
    "OpenRouter-sleutels beheren",
  ],
  "Save connections & choose tests": [
    "Enregistrer et choisir les tests",
    "Guardar conexiones y elegir pruebas",
    "保存连接并选择测试",
    "연결 저장 및 테스트 선택",
    "رابطے محفوظ کریں اور ٹیسٹ چنیں",
    "ذخیرهٔ اتصال‌ها و انتخاب آزمون‌ها",
    "Salvar conexões e escolher testes",
    "Salva le connessioni e scegli i test",
    "Сохранить подключения и выбрать тесты",
    "Verbindungen speichern und Tests wählen",
    "Verbindingen opslaan en tests kiezen",
  ],
  "Tools to build with.\nSources worth knowing.": [
    "Des outils pour créer.\nDes sources à découvrir.",
    "Herramientas para crear.\nFuentes que vale conocer.",
    "助力构建的工具。\n值得了解的来源。",
    "만드는 데 필요한 도구.\n알아둘 만한 출처.",
    "تعمیر کے لیے اوزار۔\nجاننے کے قابل ذرائع۔",
    "ابزارهایی برای ساختن.\nمنابعی برای شناختن.",
    "Ferramentas para criar.\nFontes que valem conhecer.",
    "Strumenti per creare.\nFonti da conoscere.",
    "Инструменты для работы.\nИсточники, которые стоит знать.",
    "Werkzeuge zum Entwickeln.\nQuellen, die sich lohnen.",
    "Tools om mee te bouwen.\nBronnen om te ontdekken.",
  ],
  "Use integration": [
    "Utiliser l’intégration",
    "Usar integración",
    "使用集成",
    "연동 사용",
    "انضمام استعمال کریں",
    "استفاده از یکپارچه‌سازی",
    "Usar integração",
    "Usa l’integrazione",
    "Использовать интеграцию",
    "Integration nutzen",
    "Integratie gebruiken",
  ],
  "Search tools": [
    "Rechercher des outils",
    "Buscar herramientas",
    "搜索工具",
    "도구 검색",
    "اوزار تلاش کریں",
    "جست‌وجوی ابزارها",
    "Pesquisar ferramentas",
    "Cerca strumenti",
    "Поиск инструментов",
    "Tools suchen",
    "Tools zoeken",
  ],
  "Tool category": [
    "Catégorie d’outil",
    "Categoría de herramienta",
    "工具类别",
    "도구 분류",
    "اوزار کی قسم",
    "دستهٔ ابزار",
    "Categoria da ferramenta",
    "Categoria dello strumento",
    "Категория инструмента",
    "Tool-Kategorie",
    "Toolcategorie",
  ],
  "No matching tools": [
    "Aucun outil trouvé",
    "No se encontraron herramientas",
    "没有匹配的工具",
    "일치하는 도구가 없습니다",
    "کوئی مماثل اوزار نہیں ملا",
    "ابزاری پیدا نشد",
    "Nenhuma ferramenta encontrada",
    "Nessuno strumento trovato",
    "Инструменты не найдены",
    "Keine Tools gefunden",
    "Geen tools gevonden",
  ],
  Previous: [
    "Précédent",
    "Anterior",
    "上一页",
    "이전",
    "پچھلا",
    "قبلی",
    "Anterior",
    "Precedente",
    "Назад",
    "Zurück",
    "Vorige",
  ],
  Next: [
    "Suivant",
    "Siguiente",
    "下一页",
    "다음",
    "اگلا",
    "بعدی",
    "Próximo",
    "Successivo",
    "Далее",
    "Weiter",
    "Volgende",
  ],
  "Start an experiment": [
    "Lancer une expérience",
    "Iniciar un experimento",
    "开始实验",
    "실험 시작",
    "تجربہ شروع کریں",
    "شروع آزمایش",
    "Iniciar experimento",
    "Avvia un esperimento",
    "Начать эксперимент",
    "Experiment starten",
    "Experiment starten",
  ],
  "Explore models": [
    "Explorer les modèles",
    "Explorar modelos",
    "探索模型",
    "모델 살펴보기",
    "ماڈلز دیکھیں",
    "کاوش مدل‌ها",
    "Explorar modelos",
    "Esplora i modelli",
    "Посмотреть модели",
    "Modelle entdecken",
    "Modellen verkennen",
  ],
  "Guide contents": [
    "Sommaire du guide",
    "Contenido de la guía",
    "指南目录",
    "가이드 목차",
    "رہنما کے مندرجات",
    "فهرست راهنما",
    "Conteúdo do guia",
    "Indice della guida",
    "Содержание руководства",
    "Inhalt des Leitfadens",
    "Inhoud van de gids",
  ],
  "Explore the tools directory": [
    "Explorer le répertoire d’outils",
    "Explorar el directorio de herramientas",
    "探索工具目录",
    "도구 목록 살펴보기",
    "اوزار کی فہرست دیکھیں",
    "کاوش فهرست ابزارها",
    "Explorar o diretório de ferramentas",
    "Esplora la raccolta di strumenti",
    "Посмотреть каталог инструментов",
    "Tool-Verzeichnis entdecken",
    "Toolgids verkennen",
  ],
  "Download Paperclip task": [
    "Télécharger la tâche Paperclip",
    "Descargar tarea de Paperclip",
    "下载 Paperclip 任务",
    "Paperclip 작업 다운로드",
    "Paperclip کا کام ڈاؤن لوڈ کریں",
    "دریافت وظیفهٔ Paperclip",
    "Baixar tarefa Paperclip",
    "Scarica attività Paperclip",
    "Скачать задачу Paperclip",
    "Paperclip-Aufgabe herunterladen",
    "Paperclip-taak downloaden",
  ],
  "Send review draft": [
    "Envoyer le brouillon",
    "Enviar borrador de revisión",
    "发送审核草稿",
    "검토 초안 보내기",
    "جائزے کا مسودہ بھیجیں",
    "ارسال پیش‌نویس بازبینی",
    "Enviar rascunho de revisão",
    "Invia bozza di revisione",
    "Отправить черновик проверки",
    "Prüfentwurf senden",
    "Conceptbeoordeling verzenden",
  ],
  "Official repository": [
    "Dépôt officiel",
    "Repositorio oficial",
    "官方代码库",
    "공식 저장소",
    "سرکاری ریپوزٹری",
    "مخزن رسمی",
    "Repositório oficial",
    "Repository ufficiale",
    "Официальный репозиторий",
    "Offizielles Repository",
    "Officiële repository",
  ],
  "Integration docs": [
    "Documentation d’intégration",
    "Documentación de integración",
    "集成文档",
    "연동 문서",
    "انضمام کی دستاویزات",
    "مستندات یکپارچه‌سازی",
    "Documentação da integração",
    "Documentazione integrazione",
    "Документация по интеграции",
    "Integrationsanleitung",
    "Integratiedocumentatie",
  ],
  "Agents & automation": [
    "Agents et automatisation",
    "Agentes y automatización",
    "智能体与自动化",
    "에이전트 및 자동화",
    "ایجنٹس اور خودکاری",
    "عامل‌ها و خودکارسازی",
    "Agentes e automação",
    "Agenti e automazione",
    "Агенты и автоматизация",
    "Agenten und Automatisierung",
    "Agents en automatisering",
  ],
  "Retrieval & memory": [
    "Recherche et mémoire",
    "Recuperación y memoria",
    "检索与记忆",
    "검색 및 메모리",
    "بازیافت اور یادداشت",
    "بازیابی و حافظه",
    "Recuperação e memória",
    "Recupero e memoria",
    "Поиск и память",
    "Suche und Speicher",
    "Zoeken en geheugen",
  ],
  "Evaluation & observability": [
    "Évaluation et observabilité",
    "Evaluación y observabilidad",
    "评测与可观测性",
    "평가 및 관측",
    "جانچ اور نگرانی",
    "ارزیابی و پایش‌پذیری",
    "Avaliação e observabilidade",
    "Valutazione e osservabilità",
    "Оценка и наблюдаемость",
    "Evaluation und Beobachtbarkeit",
    "Evaluatie en inzicht",
  ],
  "Inference & serving": [
    "Inférence et déploiement",
    "Inferencia y servicio",
    "推理与部署",
    "추론 및 서비스",
    "استنتاج اور سروس",
    "استنتاج و ارائه",
    "Inferência e disponibilização",
    "Inferenza e distribuzione",
    "Инференс и обслуживание",
    "Inferenz und Bereitstellung",
    "Inferentie en hosting",
  ],
  "Training & data": [
    "Entraînement et données",
    "Entrenamiento y datos",
    "训练与数据",
    "학습 및 데이터",
    "تربیت اور ڈیٹا",
    "آموزش و داده",
    "Treino e dados",
    "Addestramento e dati",
    "Обучение и данные",
    "Training und Daten",
    "Training en data",
  ],
  "Computer vision": [
    "Vision par ordinateur",
    "Visión artificial",
    "计算机视觉",
    "컴퓨터 비전",
    "کمپیوٹر وژن",
    "بینایی ماشین",
    "Visão computacional",
    "Visione artificiale",
    "Компьютерное зрение",
    "Computer Vision",
    "Computer vision",
  ],
  "Speech & audio": [
    "Parole et audio",
    "Voz y audio",
    "语音与音频",
    "음성 및 오디오",
    "تقریر اور آڈیو",
    "گفتار و صدا",
    "Fala e áudio",
    "Voce e audio",
    "Речь и аудио",
    "Sprache und Audio",
    "Spraak en audio",
  ],
  "Visual generation": [
    "Génération visuelle",
    "Generación visual",
    "视觉生成",
    "이미지 생성",
    "بصری تخلیق",
    "تولید تصویر",
    "Geração visual",
    "Generazione visiva",
    "Генерация изображений",
    "Bildgenerierung",
    "Visuele generatie",
  ],
  "Language & documents": [
    "Langue et documents",
    "Lenguaje y documentos",
    "语言与文档",
    "언어 및 문서",
    "زبان اور دستاویزات",
    "زبان و سندها",
    "Linguagem e documentos",
    "Lingua e documenti",
    "Язык и документы",
    "Sprache und Dokumente",
    "Taal en documenten",
  ],
  "MCP tools": [
    "Outils MCP",
    "Herramientas MCP",
    "MCP 工具",
    "MCP 도구",
    "MCP اوزار",
    "ابزارهای MCP",
    "Ferramentas MCP",
    "Strumenti MCP",
    "Инструменты MCP",
    "MCP-Tools",
    "MCP-tools",
  ],
  "Coding assistants": [
    "Assistants de programmation",
    "Asistentes de programación",
    "编程助手",
    "코딩 도우미",
    "کوڈنگ معاون",
    "دستیارهای کدنویسی",
    "Assistentes de programação",
    "Assistenti di programmazione",
    "Помощники программиста",
    "Programmierassistenten",
    "Code-assistenten",
  ],
  "Why Hessara?": [
    "Pourquoi Hessara ?",
    "¿Por qué Hessara?",
    "为什么选择 Hessara？",
    "왜 Hessara인가요?",
    "Hessara کیوں؟",
    "چرا Hessara؟",
    "Por que Hessara?",
    "Perché Hessara?",
    "Почему Hessara?",
    "Warum Hessara?",
    "Waarom Hessara?",
  ],
  "Choose models, not assumptions": [
    "Choisir des modèles, pas des suppositions",
    "Elige modelos, no suposiciones",
    "选择模型，不靠猜测",
    "추측보다 모델 선택",
    "اندازوں کے بجائے ماڈل چنیں",
    "مدل انتخاب کنید، نه بر اساس حدس",
    "Escolha modelos, não suposições",
    "Scegli i modelli, non le ipotesi",
    "Выбирайте модели, а не догадки",
    "Modelle wählen statt raten",
    "Kies modellen, geen aannames",
  ],
  "Design a comparable experiment": [
    "Concevoir une expérience comparable",
    "Diseña una prueba comparable",
    "设计可比较的实验",
    "비교 가능한 실험 설계",
    "قابلِ موازنہ تجربہ بنائیں",
    "آزمایشی قابل مقایسه طراحی کنید",
    "Planeie um experimento comparável",
    "Progetta un esperimento comparabile",
    "Создайте сравнимый эксперимент",
    "Vergleichbares Experiment planen",
    "Ontwerp een vergelijkbaar experiment",
  ],
  "What do the tasks measure?": [
    "Que mesurent les tâches ?",
    "¿Qué miden las tareas?",
    "任务测量什么？",
    "작업은 무엇을 측정하나요?",
    "ٹاسک کیا ناپتے ہیں؟",
    "وظایف چه چیزی را می‌سنجند؟",
    "O que as tarefas medem?",
    "Che cosa misurano le attività?",
    "Что измеряют задания?",
    "Was messen die Aufgaben?",
    "Wat meten de taken?",
  ],
  "How is quality scored?": [
    "Comment la qualité est-elle notée ?",
    "¿Cómo se puntúa la calidad?",
    "如何计算质量分数？",
    "품질 점수는 어떻게 계산하나요?",
    "معیار کا اسکور کیسے بنتا ہے؟",
    "کیفیت چگونه امتیازدهی می‌شود؟",
    "Como a qualidade é pontuada?",
    "Come viene valutata la qualità?",
    "Как оценивается качество?",
    "Wie wird Qualität bewertet?",
    "Hoe wordt kwaliteit beoordeeld?",
  ],
  "Latency and consistency": [
    "Latence et constance",
    "Latencia y consistencia",
    "延迟与一致性",
    "지연 시간과 일관성",
    "تاخیر اور یکسانیت",
    "تأخیر و ثبات",
    "Latência e consistência",
    "Latenza e coerenza",
    "Задержка и стабильность",
    "Latenz und Konsistenz",
    "Vertraging en consistentie",
  ],
  "Cost and resource usage": [
    "Coût et utilisation des ressources",
    "Coste y uso de recursos",
    "成本与资源消耗",
    "비용과 자원 사용량",
    "لاگت اور وسائل کا استعمال",
    "هزینه و مصرف منابع",
    "Custo e uso de recursos",
    "Costi e uso delle risorse",
    "Стоимость и расход ресурсов",
    "Kosten und Ressourcenverbrauch",
    "Kosten en hulpbronnen",
  ],
  "Persistence and privacy": [
    "Enregistrement et confidentialité",
    "Guardado y privacidad",
    "保存与隐私",
    "저장과 개인정보 보호",
    "محفوظ کرنا اور رازداری",
    "ذخیره‌سازی و حریم خصوصی",
    "Armazenamento e privacidade",
    "Salvataggio e privacy",
    "Сохранение и конфиденциальность",
    "Speicherung und Datenschutz",
    "Opslag en privacy",
  ],
  "Simulation and live evaluation": [
    "Simulation et évaluation réelle",
    "Simulación y evaluación real",
    "模拟与实际评测",
    "시뮬레이션과 실제 평가",
    "نقلی اور حقیقی جانچ",
    "شبیه‌سازی و ارزیابی واقعی",
    "Simulação e avaliação real",
    "Simulazione e valutazione reale",
    "Симуляция и реальная оценка",
    "Simulation und reale Evaluation",
    "Simulatie en echte evaluatie",
  ],
  "Tools and Paperclip": [
    "Outils et Paperclip",
    "Herramientas y Paperclip",
    "工具与 Paperclip",
    "도구 및 Paperclip",
    "اوزار اور Paperclip",
    "ابزارها و Paperclip",
    "Ferramentas e Paperclip",
    "Strumenti e Paperclip",
    "Инструменты и Paperclip",
    "Tools und Paperclip",
    "Tools en Paperclip",
  ],
  "Reports you can use": [
    "Des rapports utiles",
    "Informes utilizables",
    "可用的报告",
    "실용적인 보고서",
    "کارآمد رپورٹس",
    "گزارش‌های کاربردی",
    "Relatórios úteis",
    "Report utili",
    "Полезные отчёты",
    "Nutzbare Berichte",
    "Bruikbare rapporten",
  ],
  "What results do not prove": [
    "Ce que les résultats ne prouvent pas",
    "Lo que los resultados no prueban",
    "结果不能证明什么",
    "결과로 알 수 없는 것",
    "نتائج کیا ثابت نہیں کرتے",
    "نتایج چه چیزی را ثابت نمی‌کنند",
    "O que os resultados não provam",
    "Cosa non dimostrano i risultati",
    "Чего результаты не доказывают",
    "Was Ergebnisse nicht belegen",
    "Wat resultaten niet bewijzen",
  ],
  "Let results lead to better work.": [
    "Transformez les résultats en actions utiles.",
    "Convierte los resultados en mejores decisiones.",
    "让结果推动更好的工作。",
    "평가 결과를 더 나은 작업으로 이어가세요.",
    "نتائج کو بہتر کام کی بنیاد بنائیں۔",
    "نتایج را به کار بهتر تبدیل کنید.",
    "Transforme resultados em trabalho melhor.",
    "Trasforma i risultati in lavoro migliore.",
    "Пусть результаты улучшают работу.",
    "Mit Ergebnissen besser arbeiten.",
    "Gebruik resultaten voor beter werk.",
  ],
  "Issue draft downloaded.": [
    "Brouillon téléchargé.",
    "Borrador descargado.",
    "任务草稿已下载。",
    "작업 초안을 다운로드했습니다.",
    "کام کا مسودہ ڈاؤن لوڈ ہو گیا۔",
    "پیش‌نویس وظیفه دریافت شد.",
    "Rascunho baixado.",
    "Bozza scaricata.",
    "Черновик задачи скачан.",
    "Aufgabenentwurf heruntergeladen.",
    "Concepttaak gedownload.",
  ],
  "Review draft created in Paperclip.": [
    "Brouillon créé dans Paperclip.",
    "Borrador creado en Paperclip.",
    "已在 Paperclip 创建审核草稿。",
    "Paperclip에 검토 초안을 만들었습니다.",
    "Paperclip میں جائزے کا مسودہ بن گیا۔",
    "پیش‌نویس بازبینی در Paperclip ساخته شد.",
    "Rascunho criado no Paperclip.",
    "Bozza creata in Paperclip.",
    "Черновик создан в Paperclip.",
    "Prüfentwurf in Paperclip erstellt.",
    "Conceptbeoordeling gemaakt in Paperclip.",
  ],
  "Sending destination: ": [
    "Destination d’envoi : ",
    "Destino: ",
    "发送至：",
    "전송 대상: ",
    "بھیجنے کی منزل: ",
    "مقصد ارسال: ",
    "Destino do envio: ",
    "Destinazione: ",
    "Адрес отправки: ",
    "Sendeziel: ",
    "Verzendbestemming: ",
  ],
  "Open a run from Experiments to enable export.": [
    "Ouvrez une expérience pour activer l’export.",
    "Abre una prueba para activar la exportación.",
    "打开一项实验以启用导出。",
    "실험을 열면 내보낼 수 있습니다.",
    "برآمد کے لیے تجربہ کھولیں۔",
    "برای فعال شدن خروجی، آزمایشی را باز کنید.",
    "Abra um experimento para exportar.",
    "Apri un esperimento per esportare.",
    "Откройте эксперимент для экспорта.",
    "Experiment zum Exportieren öffnen.",
    "Open een experiment om te exporteren.",
  ],
  "Select ": [
    "Sélectionner ",
    "Seleccionar ",
    "选择",
    "선택: ",
    "منتخب کریں: ",
    "انتخاب ",
    "Selecionar ",
    "Seleziona ",
    "Выбрать ",
    "Auswählen: ",
    "Selecteer ",
  ],
  "Save ": [
    "Enregistrer ",
    "Guardar ",
    "收藏",
    "저장: ",
    "محفوظ کریں: ",
    "ذخیرهٔ ",
    "Salvar ",
    "Salva ",
    "Сохранить ",
    "Speichern: ",
    "Bewaar ",
  ],
  "Check license": [
    "Vérifier la licence",
    "Comprobar licencia",
    "查看许可证",
    "라이선스 확인",
    "لائسنس دیکھیں",
    "بررسی مجوز",
    "Verificar licença",
    "Verifica la licenza",
    "Проверить лицензию",
    "Lizenz prüfen",
    "Licentie controleren",
  ],
  All: [
    "Tout",
    "Todo",
    "全部",
    "전체",
    "سب",
    "همه",
    "Todos",
    "Tutti",
    "Все",
    "Alle",
    "Alles",
  ],
  Saved: [
    "Enregistrés",
    "Guardados",
    "已收藏",
    "저장됨",
    "محفوظ شدہ",
    "ذخیره‌شده‌ها",
    "Salvos",
    "Salvati",
    "Сохранённые",
    "Gespeichert",
    "Opgeslagen",
  ],
  results: [
    "résultats",
    "resultados",
    "项结果",
    "개 결과",
    "نتائج",
    "نتیجه",
    "resultados",
    "risultati",
    "результатов",
    "Ergebnisse",
    "resultaten",
  ],
  tokens: [
    "jetons",
    "tokens",
    "个标记",
    "토큰",
    "ٹوکن",
    "توکن",
    "tokens",
    "token",
    "токенов",
    "Token",
    "tokens",
  ],
  Reasoning: [
    "Raisonnement",
    "Razonamiento",
    "推理",
    "추론",
    "استدلال",
    "استدلال",
    "Raciocínio",
    "Ragionamento",
    "Рассуждение",
    "Schlussfolgern",
    "Redeneren",
  ],
  "Text generation": [
    "Génération de texte",
    "Generación de texto",
    "文本生成",
    "텍스트 생성",
    "متن کی تخلیق",
    "تولید متن",
    "Geração de texto",
    "Generazione di testo",
    "Генерация текста",
    "Textgenerierung",
    "Tekstgeneratie",
  ],
  Tools: [
    "Outils",
    "Herramientas",
    "工具",
    "도구",
    "اوزار",
    "ابزارها",
    "Ferramentas",
    "Strumenti",
    "Инструменты",
    "Tools",
    "Tools",
  ],
  "Specifications side by side": [
    "Caractéristiques côte à côte",
    "Especificaciones en paralelo",
    "并排比较规格",
    "사양 나란히 비교",
    "تفصیلات ساتھ ساتھ",
    "مشخصات در کنار هم",
    "Especificações lado a lado",
    "Specifiche a confronto",
    "Характеристики рядом",
    "Spezifikationen im Vergleich",
    "Specificaties naast elkaar",
  ],
  Metric: [
    "Critère",
    "Criterio",
    "指标",
    "항목",
    "معیار",
    "معیار",
    "Critério",
    "Criterio",
    "Показатель",
    "Kriterium",
    "Criterium",
  ],
  "Context tokens": [
    "Jetons de contexte",
    "Tokens de contexto",
    "上下文标记数",
    "컨텍스트 토큰",
    "سیاقی ٹوکن",
    "توکن‌های زمینه",
    "Tokens de contexto",
    "Token di contesto",
    "Токены контекста",
    "Kontext-Token",
    "Contexttokens",
  ],
  "Input USD / million": [
    "Entrée USD / million",
    "Entrada USD / millón",
    "输入价格（美元/百万）",
    "입력 비용(USD/백만)",
    "ان پٹ امریکی ڈالر / ملین",
    "ورودی دلار / میلیون",
    "Entrada USD / milhão",
    "Input USD / milione",
    "Ввод, USD / млн",
    "Eingabe USD / Mio.",
    "Invoer USD / miljoen",
  ],
  "Output USD / million": [
    "Sortie USD / million",
    "Salida USD / millón",
    "输出价格（美元/百万）",
    "출력 비용(USD/백만)",
    "آؤٹ پٹ امریکی ڈالر / ملین",
    "خروجی دلار / میلیون",
    "Saída USD / milhão",
    "Output USD / milione",
    "Вывод, USD / млн",
    "Ausgabe USD / Mio.",
    "Uitvoer USD / miljoen",
  ],
  "Tool calling": [
    "Appel d’outils",
    "Llamada a herramientas",
    "工具调用",
    "도구 호출",
    "اوزار استعمال",
    "فراخوانی ابزار",
    "Chamada de ferramentas",
    "Chiamata di strumenti",
    "Вызов инструментов",
    "Tool-Aufruf",
    "Toolaanroepen",
  ],
  Available: [
    "Disponible",
    "Disponible",
    "可用",
    "가능",
    "دستیاب",
    "در دسترس",
    "Disponível",
    "Disponibile",
    "Доступно",
    "Verfügbar",
    "Beschikbaar",
  ],
  "models to connect": [
    "modèles à connecter",
    "modelos por conectar",
    "个待连接模型",
    "개 연결할 모델",
    "ماڈل منسلک کرنے ہیں",
    "مدل برای اتصال",
    "modelos para conectar",
    "modelli da collegare",
    "моделей для подключения",
    "Modelle zum Verbinden",
    "modellen om te verbinden",
  ],
  "Search agents, speech, retrieval, evaluation…": [
    "Agents, voix, recherche, évaluation…",
    "Agentes, voz, recuperación, evaluación…",
    "搜索智能体、语音、检索、评测…",
    "에이전트, 음성, 검색, 평가…",
    "ایجنٹس، آواز، بازیافت، جانچ…",
    "عامل، گفتار، بازیابی، ارزیابی…",
    "Agentes, fala, recuperação, avaliação…",
    "Agenti, voce, ricerca, valutazione…",
    "Агенты, речь, поиск, оценка…",
    "Agenten, Sprache, Suche, Evaluation…",
    "Agents, spraak, zoeken, evaluatie…",
  ],
  "A considered choice\nstarts with a good question.": [
    "Un choix réfléchi\ncommence par la bonne question.",
    "Una decisión meditada\nempieza con una buena pregunta.",
    "明智的选择，\n始于好问题。",
    "좋은 선택은\n좋은 질문에서 시작됩니다.",
    "سوچا سمجھا انتخاب\nاچھے سوال سے شروع ہوتا ہے۔",
    "انتخاب سنجیده\nبا پرسشی خوب آغاز می‌شود.",
    "Uma escolha consciente\ncomeça com uma boa pergunta.",
    "Una scelta consapevole\ninizia con una buona domanda.",
    "Осознанный выбор\nначинается с хорошего вопроса.",
    "Eine gute Entscheidung\nbeginnt mit einer guten Frage.",
    "Een doordachte keuze\nbegint met een goede vraag.",
  ],
  "Try another keyword or turn off the saved filter.": [
    "Essayez un autre terme ou désactivez le filtre des favoris.",
    "Prueba otra palabra o desactiva el filtro de guardados.",
    "换个关键词，或关闭收藏筛选。",
    "다른 검색어를 입력하거나 저장됨 필터를 끄세요.",
    "دوسرا لفظ آزمائیں یا محفوظ شدہ فلٹر بند کریں۔",
    "واژهٔ دیگری را امتحان کنید یا فیلتر ذخیره‌شده‌ها را بردارید.",
    "Tente outro termo ou desative o filtro de salvos.",
    "Prova un altro termine o disattiva il filtro dei salvati.",
    "Попробуйте другой запрос или отключите фильтр сохранённых.",
    "Anderes Stichwort versuchen oder Filter für Gespeicherte ausschalten.",
    "Probeer een ander zoekwoord of schakel het filter Opgeslagen uit.",
  ],
  "This run was already sent or its outcome is pending verification. Check Paperclip before manually retrying.":
    [
      "Cette expérience a déjà été envoyée ou son état reste incertain. Vérifiez Paperclip avant de réessayer.",
      "Esta prueba ya se envió o su estado aún no está claro. Revisa Paperclip antes de reintentar.",
      "此实验可能已发送，或结果仍待确认。重试前请检查 Paperclip。",
      "이미 전송되었거나 결과 확인이 필요합니다. 다시 시도하기 전에 Paperclip을 확인하세요.",
      "یہ تجربہ پہلے بھیجا جا چکا ہے یا نتیجہ ابھی واضح نہیں۔ دوبارہ کوشش سے پہلے Paperclip دیکھیں۔",
      "این آزمایش قبلاً ارسال شده یا نتیجهٔ ارسال نامشخص است. پیش از تلاش دوباره Paperclip را بررسی کنید.",
      "Este experimento já foi enviado ou o resultado ainda é incerto. Verifique o Paperclip antes de tentar novamente.",
      "Questo esperimento è già stato inviato o l’esito è incerto. Controlla Paperclip prima di riprovare.",
      "Эксперимент уже отправлен или результат отправки неясен. Проверьте Paperclip перед повтором.",
      "Dieses Experiment wurde bereits gesendet oder der Ausgang ist unklar. Prüfen Sie Paperclip vor einem erneuten Versuch.",
      "Dit experiment is al verzonden of de uitkomst is onzeker. Controleer Paperclip voordat u opnieuw probeert.",
    ],
  "Unable to complete the request. Check Paperclip if a send was attempted; it is not repeated automatically.":
    [
      "La demande a échoué. Vérifiez Paperclip si l’envoi a commencé : nous ne le relançons pas automatiquement.",
      "No se pudo completar. Si empezó el envío, revisa Paperclip; no se reintenta automáticamente.",
      "请求未能完成。如已开始发送，请检查 Paperclip；系统不会自动重试。",
      "요청을 완료하지 못했습니다. 전송이 시작되었다면 Paperclip을 확인하세요. 자동 재전송은 하지 않습니다.",
      "درخواست مکمل نہ ہو سکی۔ اگر بھیجنا شروع ہوا تھا تو Paperclip دیکھیں؛ خودکار طور پر دوبارہ نہیں بھیجیں گے۔",
      "درخواست کامل نشد. اگر ارسال آغاز شده، Paperclip را بررسی کنید؛ ارسال خودکار تکرار نمی‌شود.",
      "Não foi possível concluir. Se o envio começou, verifique o Paperclip; não repetimos automaticamente.",
      "Richiesta non completata. Se l’invio è iniziato, controlla Paperclip: non riproviamo automaticamente.",
      "Не удалось завершить запрос. Если отправка началась, проверьте Paperclip; автоматического повтора нет.",
      "Anfrage konnte nicht abgeschlossen werden. Falls das Senden begann, prüfen Sie Paperclip; es gibt keinen automatischen erneuten Versuch.",
      "Verzoek niet voltooid. Als verzending is gestart, controleer Paperclip; we proberen niet automatisch opnieuw.",
    ],
  "Direct connection is not configured. Draft download is available for a selected run; server setup instructions ship with the project.":
    [
      "La connexion directe n’est pas configurée. Sélectionnez une expérience pour télécharger le brouillon; les instructions serveur accompagnent le projet.",
      "La conexión directa no está configurada. Selecciona una prueba para descargar el borrador; las instrucciones del servidor están en el proyecto.",
      "尚未配置直接连接。选择实验后可下载草稿；服务器配置说明随项目提供。",
      "직접 연결이 설정되지 않았습니다. 실험을 선택하면 초안을 다운로드할 수 있으며 서버 설정 안내는 프로젝트에 포함됩니다.",
      "براہِ راست رابطہ ابھی تیار نہیں۔ تجربہ منتخب کریں تو مسودہ ڈاؤن لوڈ کر سکتے ہیں؛ سرور کی ہدایات منصوبے میں ہیں۔",
      "اتصال مستقیم تنظیم نشده است. با انتخاب آزمایش می‌توانید پیش‌نویس را دریافت کنید؛ راهنمای سرور در پروژه است.",
      "A conexão direta não está configurada. Selecione um experimento para baixar o rascunho; as instruções do servidor acompanham o projeto.",
      "La connessione diretta non è configurata. Seleziona un esperimento per scaricare la bozza; le istruzioni del server sono nel progetto.",
      "Прямое подключение не настроено. Выберите эксперимент для загрузки черновика; инструкции сервера есть в проекте.",
      "Direkte Verbindung ist nicht eingerichtet. Wählen Sie ein Experiment zum Herunterladen des Entwurfs; die Serveranleitung liegt dem Projekt bei.",
      "Directe verbinding is niet ingesteld. Selecteer een experiment om het concept te downloaden; serverinstructies staan in het project.",
    ],
};
const localized = Object.fromEntries(
  otherLocales.map((locale, i) => [
    locale,
    Object.fromEntries(
      Object.entries(uiTerms).map(([key, values]) => [key, values[i]]),
    ),
  ]),
) as Partial<Record<Locale, Record<string, string>>>;
const language = (locale: Locale) => (ar: string, en: string) =>
  locale === "ar" ? ar : (localized[locale]?.[en] ?? en);
function External({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="external-link"
    >
      {children}
      <ArrowUpRight size={16} aria-hidden="true" />
    </a>
  );
}
export function LLMDirectory({
  locale,
  onCustom,
  onLinked,
}: {
  locale: Locale;
  onCustom: () => void;
  onLinked: (ids: string[], models: Model[]) => void;
}) {
  const c = language(locale),
    t = (k: string) => translate(locale, k);
  const [query, setQuery] = useState(""),
    [publisher, setPublisher] = useState("all"),
    [selected, setSelected] = useState<string[]>([]),
    [showCompare, setShowCompare] = useState(false),
    [connect, setConnect] = useState(false),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const visible = catalog.filter(
    (m) =>
      (publisher === "all" || m.publisher === publisher) &&
      `${m.name} ${displayName(m.name, locale)} ${m.id} ${m.publisher} ${displayName(m.publisher, locale)}`
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
  );
  const picked = catalog.filter((m) => selected.includes(m.id));
  const fmt = (n: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(n);
  async function link() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/catalog/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selected, apiKey: key }),
      });
      const data = (await r.json()) as {
        error?: string;
        ids: string[];
        models: Model[];
      };
      if (!r.ok) throw new Error(data.error || "UNAVAILABLE");
      setKey("");
      setConnect(false);
      onLinked(data.ids, data.models);
    } catch (e) {
      const code = (e as Error).message;
      setError(
        t("error_" + code).startsWith("error_")
          ? t("error")
          : t("error_" + code),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="discovery"
      lang={locale}
      dir={isRTL(locale) ? "rtl" : "ltr"}
    >
      <div className="catalog-intro">
        <div>
          <span className="eyebrow">
            {c("دليل النماذج / ٣٠", "MODEL ATLAS / 30")}
          </span>
          <h2>
            {c(
              "تعرّف إلى النموذج. ثم اختبره.",
              "Meet the model. Then measure it.",
            )}
          </h2>
          <p lang={locale === "ar" ? "ar" : "en"} dir="auto">
            {c(
              "ثلاثون نموذجًا من عائلات معروفة، مع إمكانية إضافة أي معرّف آخر يدعمه مزوّدك. المواصفات من أوبن راوتر؛ نتائج الجودة تُحسب من تجاربك فقط.",
              "Thirty models from established families, alongside any other model ID your provider supports. Specifications come from OpenRouter; quality scores come only from your experiments.",
            )}
          </p>
        </div>
        <button className="secondary" onClick={onCustom}>
          <Link2 size={16} />
          {c("إضافة نموذج آخر", "Add another model")}
        </button>
      </div>
      <div className="catalog-toolbar">
        <label className="catalog-search">
          <Search size={18} />
          <input
            aria-label={c("البحث عن نموذج", "Search models")}
            placeholder={c("ابحث بالاسم أو العائلة…", "Search name or family…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="catalog-select">
          {c("المطوّر", "Publisher")}
          <select
            value={publisher}
            onChange={(e) => setPublisher(e.target.value)}
          >
            <option value="all">{t("all")}</option>
            {[...new Set(catalog.map((m) => m.publisher))].map((p) => (
              <option key={p} value={p}>
                {displayName(p, locale)}
              </option>
            ))}
          </select>
        </label>
        <span className="catalog-count" aria-live="polite">
          {fmt(visible.length)} / {fmt(30)}
        </span>
      </div>
      <div className="model-atlas">
        {visible.map((m, i) => (
          <article
            key={m.id}
            className={
              selected.includes(m.id) ? "atlas-entry selected" : "atlas-entry"
            }
          >
            <div className="atlas-top">
              <span className="atlas-number">
                {fmt(catalog.indexOf(m) + 1)}
              </span>
              <Checkbox
                aria-label={
                  c("اختيار ", "Select ") + displayName(m.name, locale)
                }
                checked={selected.includes(m.id)}
                onCheckedChange={(v) => {
                  setSelected(
                    v
                      ? [...selected, m.id]
                      : selected.filter((x) => x !== m.id),
                  );
                  setShowCompare(false);
                }}
              />
            </div>
            <span className="atlas-publisher" dir="auto">
              {displayName(m.publisher, locale)}
            </span>
            <h3 dir="auto">{displayName(m.name, locale)}</h3>
            <details className="atlas-details">
              <summary>{c("معرّف الربط", "Connection ID")}</summary>
              <code className="atlas-id" dir="ltr">
                {m.id}
              </code>
            </details>
            <dl>
              <div>
                <dt>{c("نافذة السياق", "Context window")}</dt>
                <dd>
                  {fmt(m.context)} {c("رمز", "tokens")}
                </dd>
              </div>
              <div>
                <dt>{c("إدخال / إخراج", "Input / output")}</dt>
                <dd dir="ltr">
                  ${fmt(m.inputPrice)} / ${fmt(m.outputPrice)}
                </dd>
              </div>
            </dl>
            <p className="atlas-pricing-note">
              {c(
                "لكل مليون رمز، سعر مرجعي",
                "per million tokens, reference price",
              )}
            </p>
            <div className="atlas-bottom">
              <span>
                {m.reasoning
                  ? c("استدلال", "Reasoning")
                  : c("توليد نصي", "Text generation")}
                {m.tools ? " · " + c("أدوات", "Tools") : ""}
              </span>
              <External href={m.url}>{c("المصدر", "Source")}</External>
            </div>
          </article>
        ))}
      </div>
      {!visible.length && (
        <p className="catalog-empty">
          {c(
            "لا توجد نماذج تطابق بحثك. جرّب اسمًا آخر.",
            "No matching models. Try another name.",
          )}
        </p>
      )}
      {!!selected.length && (
        <div className="comparison-dock">
          <span>
            {c("عدد النماذج المحددة: ", "Models selected: ")}
            <strong>{fmt(selected.length)}</strong>
          </span>
          <button
            className="secondary"
            onClick={() => setShowCompare((v) => !v)}
          >
            {c("مقارنة المواصفات", "Compare specifications")}
          </button>
          <button
            className="primary"
            onClick={() => {
              setConnect(true);
              setError("");
            }}
          >
            <KeyRound size={16} />
            {c("ربط النماذج وإعداد تجربة", "Connect & prepare experiment")}
          </button>
          <button
            className="icon-button"
            aria-label={c("إلغاء التحديد", "Clear selection")}
            onClick={() => {
              setSelected([]);
              setShowCompare(false);
            }}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {showCompare && (
        <div className="spec-comparison">
          <h3>{c("المواصفات جنبًا إلى جنب", "Specifications side by side")}</h3>
          <div className="table-scroll">
            <table>
              <caption>
                {c(
                  "هذه مقارنة مواصفات، وليست ترتيبًا حسب الأداء.",
                  "Specifications are not a performance ranking.",
                )}
              </caption>
              <thead>
                <tr>
                  <th>{c("المعيار", "Metric")}</th>
                  {picked.map((m) => (
                    <th key={m.id}>{displayName(m.name, locale)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>{c("المطوّر", "Publisher")}</th>
                  {picked.map((m) => (
                    <td key={m.id}>{displayName(m.publisher, locale)}</td>
                  ))}
                </tr>
                <tr>
                  <th>{c("السياق بالرموز", "Context tokens")}</th>
                  {picked.map((m) => (
                    <td key={m.id}>{fmt(m.context)}</td>
                  ))}
                </tr>
                <tr>
                  <th>{c("سعر الإدخال / مليون رمز", "Input USD / million")}</th>
                  {picked.map((m) => (
                    <td key={m.id}>${fmt(m.inputPrice)}</td>
                  ))}
                </tr>
                <tr>
                  <th>
                    {c("سعر الإخراج / مليون رمز", "Output USD / million")}
                  </th>
                  {picked.map((m) => (
                    <td key={m.id}>${fmt(m.outputPrice)}</td>
                  ))}
                </tr>
                <tr>
                  <th>{c("استدعاء الأدوات", "Tool calling")}</th>
                  {picked.map((m) => (
                    <td key={m.id}>{m.tools ? c("متاح", "Available") : "—"}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p
        className="catalog-footnote"
        lang={locale === "ar" ? "ar" : "en"}
        dir="auto"
      >
        {c(
          `آخر تحقق: ${checkedDate(catalog[0].checkedAt, locale)}. تتغير الأسعار والإتاحة؛ يعاد التحقق عند الربط. قد تختلف جودة الخدمة حسب المضيف. لا تمثل هذه القائمة ترتيبًا للأفضل.`,
          `Checked ${checkedDate(catalog[0].checkedAt, locale)}. Prices and availability change and are rechecked on connection. Host routing can affect service quality. This list is not a best-model ranking.`,
        )}
      </p>
      <Dialog
        open={connect}
        onOpenChange={(v) => {
          setConnect(v);
          if (!v) setKey("");
        }}
      >
        <DialogContent
          className="form-dialog"
          dir={isRTL(locale) ? "rtl" : "ltr"}
          showCloseButton={false}
        >
          <DialogClose className="dialog-close" aria-label={t("close")}>
            <X size={19} />
          </DialogClose>
          <DialogHeader>
            <DialogTitle>
              {c("مفتاح واحد، نماذج متعددة", "One key, multiple models")}
            </DialogTitle>
            <DialogDescription>
              {c(
                "أضف مفتاح أوبن راوتر الخاص بك. يُحفظ مشفّرًا، وتبقى خطوة تشغيل التجربة بيدك. يُرسل محتوى الاختبارات إلى أوبن راوتر ومضيف النموذج عند التشغيل.",
                "Add your OpenRouter key. It is stored encrypted. You start the experiment separately. Test prompts are sent to OpenRouter and the model host when you run it.",
              )}
            </DialogDescription>
          </DialogHeader>
          <p>
            {c("عدد النماذج للربط: ", "Models to connect: ")}
            {fmt(selected.length)}
          </p>
          <label className="field">
            {c("مفتاح اتصال أوبن راوتر", "OpenRouter API key")}
            <input
              type="password"
              dir="ltr"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              maxLength={4096}
            />
          </label>
          <External href="https://openrouter.ai/settings/keys">
            {c("إدارة مفاتيح أوبن راوتر", "Manage OpenRouter keys")}
          </External>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <button
            className="primary full"
            disabled={busy || key.trim().length < 10}
            onClick={link}
          >
            {busy
              ? t("saving")
              : c(
                  "حفظ الربط واختيار الاختبارات",
                  "Save connections & choose tests",
                )}
          </button>
          <p
            className="form-help"
            lang={locale === "ar" ? "ar" : "en"}
            dir="auto"
          >
            {c(
              "قد تتطلب النماذج رصيدًا لدى المزوّد. لا يجري هذا الزر أي اختبار مدفوع.",
              "Models may require provider credits. This button does not run any paid evaluation.",
            )}
          </p>
        </DialogContent>
      </Dialog>
    </section>
  );
}
export function ToolsDirectory({
  locale,
  onPaperclip,
}: {
  locale: Locale;
  onPaperclip: () => void;
}) {
  const fmt = (value: number) => new Intl.NumberFormat(locale).format(value);
  const c = language(locale),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("all"),
    [saved, setSaved] = useState<string[]>([]),
    [onlySaved, setOnlySaved] = useState(false),
    [page, setPage] = useState(1);
  useEffect(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem("hessara:saved-tools") || "[]",
      );
      if (Array.isArray(value))
        setSaved(value.filter((v) => typeof v === "string"));
    } catch {}
  }, []);
  const visible = useMemo(
    () =>
      directory.filter(
        (tool) =>
          (category === "all" || tool.category === category) &&
          (!onlySaved || saved.includes(tool.id)) &&
          `${tool.name} ${tool.id} ${tool.summaryAr} ${tool.summaryEn}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      ),
    [category, query, onlySaved, saved],
  );
  const pages = Math.max(1, Math.ceil(visible.length / 24)),
    currentPage = Math.min(page, pages);
  function favorite(id: string) {
    const next = saved.includes(id)
      ? saved.filter((x) => x !== id)
      : [...saved, id];
    setSaved(next);
    try {
      localStorage.setItem("hessara:saved-tools", JSON.stringify(next));
    } catch {}
  }
  return (
    <section
      className="discovery tools-discovery"
      lang={locale}
      dir={isRTL(locale) ? "rtl" : "ltr"}
    >
      <div className="tools-editorial">
        <div>
          <span className="eyebrow">
            {c("دليل أدوات الذكاء الاصطناعي", "AI TOOL DIRECTORY")} /{" "}
            {new Intl.NumberFormat(locale).format(directory.length)}
          </span>
          <h2>
            {c(
              "أدوات تختصر الطريق،\nومصادر تستحق الاكتشاف.",
              "Tools to build with.\nSources worth knowing.",
            )}
          </h2>
          <p lang={locale === "ar" ? "ar" : "en"} dir="auto">
            {c(
              "دليل منتقى لأدوات ووكلاء الذكاء الاصطناعي، مع وصف عربي ورابط إلى المستودع الأصلي. ابحث حسب حاجتك واحفظ ما يفيدك.",
              "A curated directory of AI tools and agents, each linked to its original repository. Search by need and save your shortlist.",
            )}
          </p>
        </div>
        <div className="tools-editorial-note">
          <strong>{fmt(directory.length)}</strong>
          <span>
            {c("أداة ومستودع برمجي", "tools & software repositories")}
          </span>
          <span>
            {fmt(11)} {c("مجالًا متخصصًا", "focused categories")}
          </span>
        </div>
      </div>
      <div className="paperclip-feature">
        <div>
          <span className="eyebrow">
            {c("تكامل بيبركليب", "INTEGRATION / PAPERCLIP")}
          </span>
          <h3>
            {c(
              "من نتيجة اختبار إلى مهمة لفريقك.",
              "From evaluation to a team task.",
            )}
          </h3>
          <p lang={locale === "ar" ? "ar" : "en"} dir="auto">
            {c(
              "حوّل ملخص تجربتك إلى مسودة مراجعة في بيبركليب. يمكنك تنزيل المهمة أو إرسالها إلى خادمك بعد إعداد الربط.",
              "Turn your experiment summary into a Paperclip review draft. Download it, or send it to your server after configuration.",
            )}
          </p>
        </div>
        <div className="feature-actions">
          <button className="primary" onClick={onPaperclip}>
            {c("استخدام التكامل", "Use integration")}
          </button>
          <External href="https://github.com/paperclipai/paperclip">
            {c("بيبركليب", "Paperclip")}
          </External>
        </div>
      </div>
      <div className="catalog-toolbar">
        <label className="catalog-search">
          <Search size={18} />
          <input
            aria-label={c("البحث في الأدوات", "Search tools")}
            placeholder={c(
              "ابحث عن وكيل، صوت، استرجاع، تقييم…",
              "Search agents, speech, retrieval, evaluation…",
            )}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <button
          className={onlySaved ? "secondary saved-active" : "secondary"}
          aria-pressed={onlySaved}
          onClick={() => {
            setOnlySaved(!onlySaved);
            setPage(1);
          }}
        >
          <Bookmark size={16} />
          {c("المفضلة", "Saved")} ({fmt(saved.length)})
        </button>
        <span className="catalog-count" aria-live="polite">
          {c("عدد النتائج: ", "Results: ")}
          {fmt(visible.length)}
        </span>
      </div>
      <div
        className="category-filters"
        aria-label={c("مجال الأداة", "Tool category")}
      >
        <button
          aria-pressed={category === "all"}
          onClick={() => {
            setCategory("all");
            setPage(1);
          }}
        >
          {c("الكل", "All")}
        </button>
        {Object.entries(categories).map(([id, labels]) => (
          <button
            key={id}
            aria-pressed={category === id}
            onClick={() => {
              setCategory(id);
              setPage(1);
            }}
          >
            {c(...labels)}
          </button>
        ))}
      </div>
      <div className="tool-list">
        {visible.slice((currentPage - 1) * 24, currentPage * 24).map((tool) => (
          <article key={tool.id} className="tool-entry">
            <div className="tool-entry-top">
              <span className="tool-category">
                {categories[tool.category] && c(...categories[tool.category])}
              </span>
              <button
                className="icon-button"
                aria-label={c("حفظ ", "Save ") + tool.name}
                aria-pressed={saved.includes(tool.id)}
                onClick={() => favorite(tool.id)}
              >
                <Bookmark
                  size={17}
                  fill={saved.includes(tool.id) ? "currentColor" : "none"}
                />
              </button>
            </div>
            <h3>
              <External href={tool.url}>
                <span dir="ltr" lang="en">
                  {tool.name}
                </span>
              </External>
            </h3>
            <p lang={locale === "ar" ? "ar" : "en"}>
              {locale === "ar" ? tool.summaryAr : tool.summaryEn}
            </p>
            <div className="tool-meta">
              <span dir="ltr">{tool.id.split("/")[0]}</span>
              <span>
                {tool.license === "NOASSERTION"
                  ? c("راجع الترخيص", "Check license")
                  : tool.license}
              </span>
            </div>
          </article>
        ))}
      </div>
      {!visible.length && (
        <div className="catalog-empty">
          <h3>{c("لم نجد نتيجة مطابقة", "No matching tools")}</h3>
          <p>
            {c(
              "جرّب كلمة أخرى أو أزل تصفية المفضلة.",
              "Try another keyword or turn off the saved filter.",
            )}
          </p>
        </div>
      )}
      <div className="catalog-pagination">
        <button
          className="secondary"
          disabled={currentPage === 1}
          onClick={() => setPage(currentPage - 1)}
        >
          {c("السابق", "Previous")}
        </button>
        <span aria-live="polite">
          {fmt(currentPage)} / {fmt(pages)}
        </span>
        <button
          className="secondary"
          disabled={currentPage === pages}
          onClick={() => setPage(currentPage + 1)}
        >
          {c("التالي", "Next")}
        </button>
      </div>
      <p
        className="catalog-footnote"
        lang={locale === "ar" ? "ar" : "en"}
        dir="auto"
      >
        {c(
          `روابط مستودعات تحقّقنا من وجودها في ${checkedDate(directory[0].checkedAt, locale)}. الأدوات خدمات وبرمجيات خارجية؛ إضافتها إلى الدليل لا تعني تثبيتها أو تدقيقها أمنيًا. راجع الترخيص ومتطلبات التشغيل في المصدر. المفضلة محفوظة على جهازك.`,
          `Repository links checked ${checkedDate(directory[0].checkedAt, locale)}. These are external software and services; inclusion does not mean installation or a security audit. Review licenses and setup requirements at the source. Your saved list stays on this device.`,
        )}
      </p>
    </section>
  );
}
export function HowWork({
  locale,
  onStart,
  onModels,
  onTools,
  onAgents,
}: {
  locale: Locale;
  onStart: () => void;
  onModels: () => void;
  onTools: () => void;
  onAgents: () => void;
}) {
  const c = language(locale);
  const sections = [
    [
      c("لماذا Hessara؟", "Why Hessara?"),
      c(
        "النموذج المناسب هو الذي ينجح في مهامك ضمن وقتك وميزانيتك. تساعدك Hessara على تحويل الانطباعات إلى تجارب قابلة للمراجعة، ثم مقارنة الجودة والسرعة والثبات واستهلاك الرموز والتكلفة. لا نعتمد ترتيبًا جاهزًا ولا نمنح درجات قبل الاختبار.",
        "The right model succeeds on your tasks within your time and budget. Hessara turns impressions into reviewable experiments comparing quality, latency, consistency, token usage and cost. Scores come from your runs, not a prefabricated ranking.",
      ),
    ],
    [
      c("ابدأ بالنموذج، لا بالتخمين", "Choose models, not assumptions"),
      c(
        "يضم دليل النماذج ثلاثين نموذجًا من عائلات معروفة. قارن مواصفاتها، ثم اربط المحدد منها بمفتاح أوبن راوتر واحد. ويمكن إضافة أي نموذج آخر يدعمه أوبن إيه آي أو أنثروبيك أو جيميني أو أوبن راوتر أو إنفيديا باستخدام معرّفه. لا تعني شهرة النموذج أنه الأفضل لمهمتك.",
        "LLMs lists thirty models from established families. Compare their specifications, then connect your selection with one OpenRouter key. Add other models supported by OpenAI, Anthropic, Gemini or OpenRouter using their IDs. Popularity is not proof of suitability.",
      ),
    ],
    [
      c("حدّد تجربة قابلة للمقارنة", "Design a comparable experiment"),
      c(
        "اختر حتى 30 نموذجًا، والفئات التي تهمك، و4 أو 12 أو 40 مهمة لكل فئة، وتكرارًا واحدًا أو ثلاثة. تتلقى النماذج المدخلات نفسها. يعرض نموذج الإعداد عدد الاستدعاءات قبل التشغيل؛ قد تصل التجربة الكاملة إلى 21,600 محاولة. ابدأ بعينة صغيرة ثم وسّعها.",
        "Choose up to 30 models, your categories, 4, 12 or 40 tasks per category, and one or three repeats. Models receive identical inputs. Setup shows the request count before execution; a maximum run can reach 21,600 attempts. Start small and expand deliberately.",
      ),
    ],
    [
      c("ماذا تختبر المهام؟", "What do the tasks measure?"),
      c(
        "240 مهمة ثابتة في ست فئات: فهم مخرجات جافاسكربت، الاستدلال العددي والمنطقي، تحليل بيانات صغيرة، استرجاع حقائق من سجلات، الالتزام بصيغ البيانات المنظّمة، واستخراج معلومات من سياقات تتضمن 400 إلى 1,600 سجل. أربعة أنماط وعشر حالات لكل نمط في كل فئة.",
        "240 fixed tasks cover JavaScript output reasoning, numerical logic, small-data analysis, record retrieval, strict JSON instructions and retrieval from contexts containing 400–1,600 records. Each category has four patterns with ten cases each.",
      ),
    ],
    [
      c("كيف تُحسب الجودة؟", "How is quality scored?"),
      c(
        "نصحّح الإجابات بمقارنة مباشرة مع الإجابة المرجعية أو بمطابقة البيانات المنظّمة بعد تنظيم المفاتيح. الأخطاء والمهل تساوي صفرًا. الدرجة الإجمالية هي متوسط درجات الفئات بأوزان متساوية. يمكنك مراجعة السؤال وإجابة النموذج والمرجع. لا يوجد حكم مخفي صادر عن نموذج آخر.",
        "Answers are graded against references with exact text or canonical JSON matching. Errors and timeouts score zero. The overall quality score averages categories equally. Inspect each prompt, response and reference; no hidden model judge is used.",
      ),
    ],
    [
      c("السرعة والثبات", "Latency and consistency"),
      c(
        "نقيس مدة الطلب الكامل من الخادم، ونعرض الوسيط والمئين ٩٥؛ وهما ليسا زمن أول رمز. يُقاس الثبات عند التكرار، بنسبة المهام التي أعادت النص نفسه بعد إزالة الفراغات الطرفية. قد تكون الإجابة ثابتة وخاطئة؛ لذلك اقرأ الثبات مع الجودة.",
        "We measure complete server-side request duration and show p50 and p95, not time to first token. With repeats, consistency measures tasks returning identical trimmed text. An answer can be consistently wrong, so read this metric alongside quality.",
      ),
    ],
    [
      c("التكلفة واستهلاك الموارد", "Cost and resource usage"),
      c(
        "نستخدم أعداد الرموز التي يعيدها المزوّد، بما فيها رموز التفكير حين تتوفر. التكلفة تقدير بسعر الإدخال والإخراج لكل مليون رمز، وليست فاتورة. تظهر القيم غير المعروفة بوضوح. لا يمكن لهذه الواجهات قياس ذاكرة المعالج الرسومي أو الذاكرة العشوائية أو الطاقة.",
        "We use provider-reported token counts, including reasoning tokens when available. Cost is an estimate from per-million input and output prices, not an invoice. Unknown values remain unknown. These APIs cannot measure GPU memory, RAM or energy.",
      ),
    ],
    [
      c("الحفظ والاستئناف وخصوصية المفاتيح", "Persistence and privacy"),
      c(
        "تُحفظ النتائج في قاعدة بيانات مرتبطة بحسابك، وتُشفّر مفاتيح الاتصال قبل تخزينها. يدفع المتصفح دفعات التنفيذ؛ أبقِ الصفحة مفتوحة أو استأنف لاحقًا. لا يعاد إرسال طلب مدفوع تلقائيًا إذا انقطعت نتيجته. عند الاختبار الفعلي تُرسل المطالبات إلى المزوّد الذي اخترته.",
        "Results are stored under your account and connection keys are encrypted. The browser dispatches batches: keep the page open or resume later. Ambiguous interrupted paid requests are not automatically resent. Live evaluation sends prompts to your chosen provider.",
      ),
    ],
    [
      c("المحاكاة والتقييم الفعلي", "Simulation and live evaluation"),
      c(
        "المحاكاة مجانية وتستخدم أسماء ونتائج اصطناعية لتجربة الواجهة. تُوسم بوضوح ولا تصلح للحكم على أي نموذج تجاري. التقييم الفعلي يحتاج مفتاحًا صالحًا، وقد يتطلب رصيدًا عند المزوّد. يمكنك ربط أربعة نماذج متاحة للتقييم المجاني من إنفيديا ضمن حصة حسابك وشروط الخدمة. لا تُعرض النتائج الجزئية كترتيب نهائي.",
        "Free simulation uses fictional names and synthetic results to explore the interface. It cannot establish commercial-model quality. Live evaluation needs valid credentials and may require provider credits. Four NVIDIA models offer free evaluation access subject to account quotas and provider terms. Partial results are not a final ranking.",
      ),
    ],
    [
      c("وكلاء خارقون ومحركات قرار", "Agents and decision engines"),
      c(
        "إذا لم تعرف أي فئة تختبر أولًا، اكتب حاجتك في قسم وكلاء خارقون. يتيح محركا jev وLaya Decision اقتراح فئة من مكتبة الاختبارات؛ الأول يتطلب مفتاحك، والثاني خادمًا آمنًا تهيئه بنفسك. راجع الاقتراح ثم ابدأ التجربة. يضم القسم أيضًا روابط مباشرة إلى وكلاء مستقلين مثل OpenClaw وأطر بنائهم؛ إدراجها لا يعني تشغيلها داخل المنصة.",
        "If you are unsure which category to evaluate first, describe your need in Super agents. Jev requires your key and Laya Decision requires your own secure server. Review the suggested category before starting a run. The section also links to independent agents such as OpenClaw and to agent-building frameworks; listing does not mean they run inside Hessara.",
      ),
    ],
    [
      c("الأدوات وبيبركليب", "Tools and Paperclip"),
      c(
        "استكشف 317 أداة متخصصة وابحث واحفظ المفضلة وافتح المصدر مباشرة. في تكامل بيبركليب، يتحول ملخص التقييم إلى مسودة مهمة مراجعة غير مسندة لوكيل. نزّل المهمة للاستخدام المحلي أو أرسلها إلى خادم بيبركليب بعد إعداد الربط؛ لا يُثبّت الدليل الأدوات تلقائيًا.",
        "Explore 317 AI tools, search, save and open each source. Paperclip integration turns an evaluation summary into an unassigned review draft. Download it locally or send it to a configured Paperclip server. The directory does not install tools automatically.",
      ),
    ],
    [
      c("تقارير قابلة للاستخدام", "Reports you can use"),
      c(
        "صدّر البيانات المنظّمة للتجربة والمقاييس والإجابات، أو جدول البيانات لتحليل المحاولات في أدواتك. يحتفظ التقرير بإصدار الاختبارات وإعدادات النماذج وقت التنفيذ، حتى لا تتغير هوية النتائج القديمة عند تعديل الربط. استخدم التقرير لتحديد تجربة تالية أو مراجعة بشرية.",
        "Export JSON with the run, metrics and responses, or CSV for further analysis. Reports preserve the suite version and model configuration at execution time. Use evidence to decide the next experiment or request a human review.",
      ),
    ],
    [
      c("ما الذي لا تثبته النتائج؟", "What results do not prove"),
      c(
        "هذه مجموعة اصطناعية أولية، وليست تقييمًا شاملًا لكل مجال. البرمجة هنا فهم كود، والاسترجاع من سياق مرفق، والسياق الطويل استخراج معلومات؛ لا ننفّذ كودًا مولّدًا ولا نقيس وكلاء يعملون لساعات. تختلف النتائج مع المطالبات والإعدادات والمزوّد. أضف تقييمًا خاصًا بمجال عملك قبل الاعتماد الإنتاجي.",
        "This initial synthetic suite is not comprehensive. Coding means code reasoning, retrieval uses supplied context, and long-context tests extract information. We do not execute generated code or benchmark agents working for hours. Results vary with prompts, settings and hosts. Validate on domain data before production decisions.",
      ),
    ],
  ];
  return (
    <section
      className="how-work"
      lang={locale}
      dir={isRTL(locale) ? "rtl" : "ltr"}
    >
      <div className="how-hero">
        <span className="eyebrow">
          {c("دليل استخدام المنصة", "HOW IT WORKS / HESSARA")}
        </span>
        <h2>
          {c(
            "اختيار مدروس،\nيبدأ بسؤال جيد.",
            "A considered choice\nstarts with a good question.",
          )}
        </h2>
        <p>
          {c(
            "دليلك لفهم المنصة، تصميم التجربة وقراءة النتائج دون مبالغة.",
            "Your guide to designing experiments and interpreting results without overclaiming.",
          )}
        </p>
        <div className="hero-actions">
          <button className="primary" onClick={onStart}>
            {c("ابدأ تجربة", "Start an experiment")}
          </button>
          <button className="text-button" onClick={onModels}>
            {c("استكشف النماذج", "Explore models")}
            <ArrowUpRight size={17} />
          </button>
        </div>
      </div>
      <div className="how-layout">
        <nav
          aria-label={c("دليل المحتوى", "Guide contents")}
          className="how-index"
        >
          {sections.map(([title], i) => (
            <a key={title} href={"#guide-" + i}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              {title}
            </a>
          ))}
        </nav>
        <div className="how-articles">
          {sections.map(([title, body], i) => (
            <article id={"guide-" + i} key={title}>
              <span className="article-index">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3>{title}</h3>
              <p lang={locale === "ar" ? "ar" : "en"} dir="auto">
                {body}
              </p>
            </article>
          ))}
          <button className="secondary" onClick={onTools}>
            {c("استكشف دليل الأدوات", "Explore the tools directory")}
            <ArrowUpRight size={17} />
          </button>
          <button className="secondary" onClick={onAgents}>
            {c("استكشف الوكلاء", "Explore agents")}
            <ArrowUpRight size={17} />
          </button>
        </div>
      </div>
    </section>
  );
}
export function PaperclipPanel({
  locale,
  runId,
}: {
  locale: Locale;
  runId?: string;
}) {
  const c = language(locale),
    [ready, setReady] = useState(false),
    [host, setHost] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    fetch("/api/integrations/paperclip")
      .then((r) => r.json())
      .then((value) => {
        const d = value as { ready?: boolean; host?: string };
        setReady(!!d.ready);
        setHost(d.host || "");
      })
      .catch(() => {});
  }, []);
  async function submit(action: "download" | "send") {
    if (!runId) return;
    setBusy(true);
    setNotice("");
    try {
      const r = await fetch("/api/integrations/paperclip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, action }),
      });
      const d = (await r.json()) as {
        previous?: unknown;
        issue?: unknown;
        id?: string;
      };
      if (!r.ok) {
        if (r.status === 409 && d.previous)
          throw new Error(
            c(
              "سبق إرسال هذه التجربة أو أن إرسالها قيد التحقق. راجع بيبركليب قبل المحاولة يدويًا.",
              "This run was already sent or its outcome is pending verification. Check Paperclip before manually retrying.",
            ),
          );
        throw new Error(
          c(
            "تعذّر إكمال الإرسال. إذا بدأت محاولة إرسال، راجع بيبركليب؛ لا نكررها تلقائيًا لتجنب الازدواج.",
            "Unable to complete the request. Check Paperclip if a send was attempted; it is not repeated automatically.",
          ),
        );
      }
      if (action === "download") {
        const blob = new Blob([JSON.stringify(d.issue, null, 2)], {
            type: "application/json",
          }),
          url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = "hessara-paperclip-issue.json";
        a.click();
        URL.revokeObjectURL(url);
        setNotice(c("تم تنزيل مسودة المهمة.", "Issue draft downloaded."));
      } else
        setNotice(
          c(
            "أُنشئت مسودة المراجعة في بيبركليب.",
            "Review draft created in Paperclip.",
          ) +
            " " +
            d.id,
        );
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="paperclip-panel"
      id="paperclip"
      lang={locale}
      dir={isRTL(locale) ? "rtl" : "ltr"}
    >
      <span className="eyebrow">
        {c("ربط نتائج التقييم بفريقك", "CONNECTED WORK / PAPERCLIP")}
      </span>
      <h2>
        {c("اجعل نتائجك بداية لعمل أفضل.", "Let results lead to better work.")}
      </h2>
      <p>
        {c(
          "ينشئ التكامل مسودة مهمة تحتوي على مقاييس التجربة وخطوات مراجعتها، دون مفاتيح الاتصال أو نصوص إجابات النماذج، ودون إسناد تلقائي إلى وكيل.",
          "Create a draft task with experiment metrics and review steps, without API keys, response bodies or automatic agent assignment.",
        )}
      </p>
      <ol>
        <li>
          {c(
            "شغّل تجربة أو افتح تجربة محفوظة.",
            "Run or open a saved experiment.",
          )}
        </li>
        <li>
          {c(
            "نزّل مسودة البيانات المنظّمة، أو أرسلها إلى خادمك المهيّأ.",
            "Download the JSON draft, or send it to your configured server.",
          )}
        </li>
        <li>
          {c(
            "راجع المهمة في بيبركليب ثم اسندها إلى فريقك مع ميزانية واضحة.",
            "Review it in Paperclip, then assign it with an explicit budget.",
          )}
        </li>
      </ol>
      <p className="notice">
        {ready
          ? c("وجهة الإرسال: ", "Sending destination: ") + host
          : c(
              "الربط المباشر غير مهيّأ بعد. تنزيل المهمة متاح عند اختيار تجربة؛ تعليمات إعداد الخادم مرفقة مع المشروع.",
              "Direct connection is not configured. Draft download is available for a selected run; server setup instructions ship with the project.",
            )}
      </p>
      {!runId && (
        <p className="form-help">
          {c(
            "افتح تجربة من قسم التجارب لتفعيل التصدير.",
            "Open a run from Experiments to enable export.",
          )}
        </p>
      )}
      <div className="feature-actions">
        <button
          className="secondary"
          disabled={!runId || busy}
          onClick={() => submit("download")}
        >
          <ArrowDownToLine size={17} />
          {c("تنزيل مهمة بيبركليب", "Download Paperclip task")}
        </button>
        <button
          className="primary"
          disabled={!runId || !ready || busy}
          onClick={() => submit("send")}
        >
          {c("إرسال مسودة مراجعة", "Send review draft")}
        </button>
        <External href="https://github.com/paperclipai/paperclip">
          {c("المستودع الرسمي", "Official repository")}
        </External>
        <External href="https://docs.paperclip.ing/reference/api/issues/">
          {c("وثائق الربط", "Integration docs")}
        </External>
      </div>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
    </section>
  );
}
