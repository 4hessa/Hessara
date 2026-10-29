import type { AssistantProvider } from "./featured-assistants";
import type { Locale } from "./i18n";

export type FeaturedAssistantCopy = {
  title: string;
  description: string;
  capability: string;
  distinction: string;
  steps: string[];
  example: string;
};

export const FEATURED_ASSISTANT_TRANSLATED_LOCALES = [
  "fr", "es", "zh", "ko", "ur", "fa", "pt", "it", "ru", "de", "nl",
] as const satisfies readonly Exclude<Locale, "ar" | "en">[];

export const FEATURED_ASSISTANT_TRANSLATIONS: Record<
  Exclude<Locale, "ar" | "en">,
  Record<AssistantProvider, FeaturedAssistantCopy>
> = {
  zh: {
    grok: {
      title: "从一个问题开始，获得更清晰的理解",
      description: "借助 Grok 梳理想法、理解主题或比较不同选择。",
      capability: "通过 Grok 提供文本帮助",
      distinction: "此连接使用 Grok 模型。Grok Bot 的记忆、计算机访问和连接功能属于其官方应用，不包含在此连接中。",
      steps: [
        "在 xAI 开发者控制台创建 API 密钥，并检查额度和使用限制。",
        "在此粘贴密钥，描述任务，然后选择“运行助手”。",
        "如需使用完整的 Grok Bot，请按照官方应用指南操作，使用符合条件的套餐登录，并仅授予所需权限。",
      ],
      example: "比较学习一门较难课程的三种方法。说明每种方法适合什么情况，然后给出切实可行的每周学习计划。",
    },
    meta: {
      title: "梳理想法的空间",
      description: "借助 Muse Spark 将笔记整理成清晰的计划或通俗的解释。",
      capability: "通过 Muse Spark 提供文本帮助",
      distinction: "此连接使用 Muse Spark。个人智能体 Muse 及其连接的服务通过官方网站提供；是否可用取决于你的地区和账户。",
      steps: [
        "打开 Meta 开发者平台，确认你的账户可以访问模型 API，然后创建密钥。",
        "在此输入密钥，即可通过 Muse Spark 执行文本任务。",
        "如需使用个人智能体，请打开 Muse 并完成账户设置。如需在终端中编程，请参阅 Muse Code 开发者文档。",
      ],
      example: "将这个想法转化为大学项目计划：开发一款帮助学生整理资料来源的工具。请提出每周里程碑和明确的交付成果。",
    },
    manus: {
      title: "让任务一步步推进",
      description: "将多步骤任务发送给 Manus，并在此跟踪进度和查看结果。",
      capability: "创建并跟踪 Manus 任务",
      distinction: "此连接通过 Manus API 执行任务。Cue 是独立的个人应用，可能需要邀请才能使用；Manus 密钥不会自动解锁 Cue 的全部功能。",
      steps: [
        "在具有 API 访问权限的 Manus 账户中创建密钥，并检查任务额度。",
        "描述目标和预期成果，然后在此运行任务。创建任务时，共享设置为私密。",
        "选择“刷新任务状态”以跟踪进度。如果智能体需要回答或批准，请在官方平台打开任务并亲自回应。",
        "如需使用 Cue 个人服务，请打开官方公告，按其中向你的账户提供的访问链接操作。",
      ],
      example: "根据官方来源，查找用于整理学术参考文献的免费工具。用表格比较这些工具，附上来源链接，并推荐适合初学者的选项。不要创建账户或购买任何东西。",
    },
    openai: {
      title: "适合你当前任务的帮助",
      description: "借助 OpenAI 模型审阅文本、简化概念，或制定学习与工作计划。",
      capability: "通过 OpenAI 提供文本帮助",
      distinction: "此助手使用 OpenAI API，而非你的 ChatGPT dot。个人 dot 及其记忆和工具需在 ChatGPT 中设置，具体取决于你的套餐和地区。",
      steps: [
        "在 OpenAI 开发者平台创建 API 密钥，并检查 API 额度。ChatGPT 订阅不会自动包含 API 额度。",
        "在此输入密钥和任务。回复将显示在 Hessara 中，并可复制。",
        "如需创建个人 dot，请在桌面浏览器或桌面应用中的 ChatGPT 内，按照官方设置指南，使用你的账户可用的选项完成设置。",
      ],
      example: "说明如何选择适合审阅大学论文的 AI 模型。给出简单的评估标准，以及五项用于检验质量的小任务，不要编造参考文献。",
    },
  },
  ko: {
    grok: {
      title: "질문에서 더 명확한 이해로",
      description: "Grok과 함께 아이디어를 정리하고, 주제를 이해하고, 여러 선택지를 비교하세요.",
      capability: "Grok을 통한 텍스트 지원",
      distinction: "이 연결은 Grok 모델을 사용합니다. Grok Bot의 메모리, 컴퓨터 접근 및 연결 기능은 공식 앱에서 제공되며 여기에는 포함되지 않습니다.",
      steps: [
        "xAI 개발자 콘솔에서 API 키를 만들고 크레딧과 사용 한도를 확인하세요.",
        "여기에 키를 붙여 넣고 작업을 설명한 뒤 ‘도우미 실행’을 선택하세요.",
        "Grok Bot의 전체 기능을 사용하려면 공식 앱 안내에 따라 지원되는 요금제로 로그인하고 필요한 권한만 허용하세요.",
      ],
      example: "어려운 과목을 공부하는 세 가지 방법을 비교해 주세요. 각 방법이 어떤 상황에 유용한지 설명하고 실천 가능한 주간 계획을 제안해 주세요.",
    },
    meta: {
      title: "아이디어를 정리하는 공간",
      description: "Muse Spark로 메모를 명확한 계획이나 쉬운 설명으로 바꿔 보세요.",
      capability: "Muse Spark를 통한 텍스트 지원",
      distinction: "이 연결은 Muse Spark를 사용합니다. 개인 에이전트 Muse와 연결된 서비스는 공식 사이트에서 이용할 수 있으며, 이용 가능 여부는 지역과 계정에 따라 다릅니다.",
      steps: [
        "Meta 개발자 플랫폼을 열어 계정의 모델 API 접근 가능 여부를 확인한 뒤 키를 만드세요.",
        "여기에 키를 입력하면 Muse Spark로 텍스트 작업을 실행할 수 있습니다.",
        "개인 에이전트를 이용하려면 Muse를 열고 계정 설정을 완료하세요. 터미널에서 코딩하려면 Muse Code 개발자 문서를 참고하세요.",
      ],
      example: "학생들이 자료 출처를 정리하도록 돕는 도구라는 아이디어를 대학 프로젝트 계획으로 구체화해 주세요. 주간 목표와 명확한 결과물을 제안해 주세요.",
    },
    manus: {
      title: "한 단계씩 진행되는 작업",
      description: "여러 단계로 이루어진 작업을 Manus에 보내고 여기에서 진행 상황과 결과를 확인하세요.",
      capability: "Manus 작업 생성 및 추적",
      distinction: "이 연결은 Manus API를 통해 작업을 실행합니다. Cue는 초대가 필요할 수 있는 별도의 개인용 앱입니다. Manus 키가 있다고 해서 Cue의 모든 기능을 자동으로 사용할 수 있는 것은 아닙니다.",
      steps: [
        "API 접근 권한이 있는 Manus 계정에서 키를 만들고 작업 크레딧을 확인하세요.",
        "목표와 기대하는 결과물을 설명한 뒤 여기에서 작업을 실행하세요. 작업은 비공개 공유 설정으로 생성됩니다.",
        "‘작업 상태 새로고침’을 선택해 진행 상황을 확인하세요. 에이전트가 답변이나 승인을 요청하면 공식 사이트에서 작업을 열고 직접 응답하세요.",
        "개인용 Cue 서비스를 이용하려면 공식 발표를 열고 계정에 제공되는 접근 링크를 따라가세요.",
      ],
      example: "공식 자료를 바탕으로 학술 참고문헌을 정리하는 무료 도구를 조사해 주세요. 출처 링크를 포함한 표로 비교하고 초보자에게 적합한 도구를 제안해 주세요. 계정을 만들거나 어떤 것도 구매하지 마세요.",
    },
    openai: {
      title: "작업에 맞는 도움",
      description: "OpenAI 모델로 글을 검토하고, 개념을 쉽게 풀거나, 학습 및 업무 계획을 세워 보세요.",
      capability: "OpenAI를 통한 텍스트 지원",
      distinction: "이 도우미는 ChatGPT 계정의 dot이 아닌 OpenAI API를 사용합니다. 개인 dot과 그 메모리 및 도구는 요금제와 지역에 따라 ChatGPT에서 설정합니다.",
      steps: [
        "OpenAI 개발자 플랫폼에서 API 키를 만들고 API 크레딧을 확인하세요. ChatGPT 구독에 API 크레딧이 자동으로 포함되지는 않습니다.",
        "여기에 키와 작업을 입력하세요. 응답은 Hessara에 표시되며 복사할 수 있습니다.",
        "개인 dot을 만들려면 데스크톱 웹이나 데스크톱 앱의 ChatGPT에서 공식 설정 안내에 따라 계정에 제공되는 옵션으로 설정을 완료하세요.",
      ],
      example: "대학 논문을 검토할 AI 모델을 선택하는 방법을 설명해 주세요. 간단한 기준과 품질을 확인할 수 있는 작은 작업 다섯 가지를 제시하고, 참고문헌은 지어내지 마세요.",
    },
  },
  ur: {
    grok: {
      title: "ایک سوال سے بہتر سمجھ تک",
      description: "Grok کی مدد سے کسی خیال کو ترتیب دیں، موضوع کو سمجھیں یا اپنے اختیارات کا موازنہ کریں۔",
      capability: "Grok کے ذریعے تحریری مدد",
      distinction: "یہ رابطہ Grok ماڈل استعمال کرتا ہے۔ Grok Bot کی یادداشت، کمپیوٹر تک رسائی اور دیگر خدمات سے رابطے اس کی سرکاری ایپ میں دستیاب ہیں اور یہاں شامل نہیں ہیں۔",
      steps: [
        "xAI کے ڈویلپر کنسول میں API کلید بنائیں اور اپنے کریڈٹس اور استعمال کی حدود دیکھیں۔",
        "اپنی کلید یہاں پیسٹ کریں، کام کی وضاحت کریں اور «معاون چلائیں» منتخب کریں۔",
        "Grok Bot کی تمام خصوصیات استعمال کرنے کے لیے سرکاری ایپ کی رہنمائی پر عمل کریں، اہل پلان کے ساتھ لاگ اِن کریں اور صرف ضروری اجازتیں دیں۔",
      ],
      example: "کسی مشکل مضمون کی تیاری کے تین طریقوں کا موازنہ کریں۔ بتائیں کہ ہر طریقہ کب مفید ہے، پھر ایک قابلِ عمل ہفتہ وار منصوبہ تجویز کریں۔",
    },
    meta: {
      title: "اپنے خیالات کو ترتیب دینے کی جگہ",
      description: "Muse Spark کی مدد سے اپنے نوٹس کو واضح منصوبے یا آسان وضاحت میں بدلیں۔",
      capability: "Muse Spark کے ذریعے تحریری مدد",
      distinction: "یہ رابطہ Muse Spark استعمال کرتا ہے۔ ذاتی ایجنٹ Muse اور اس سے منسلک خدمات اس کی سرکاری ویب سائٹ پر دستیاب ہیں؛ دستیابی آپ کے علاقے اور اکاؤنٹ پر منحصر ہے۔",
      steps: [
        "Meta کا ڈویلپر پلیٹ فارم کھولیں، دیکھیں کہ آپ کے اکاؤنٹ کو ماڈلز کی API تک رسائی حاصل ہے یا نہیں، پھر کلید بنائیں۔",
        "Muse Spark سے تحریری کام کروانے کے لیے اپنی کلید یہاں درج کریں۔",
        "ذاتی ایجنٹ استعمال کرنے کے لیے Muse کھولیں اور اکاؤنٹ کی ترتیب مکمل کریں۔ ٹرمینل میں پروگرامنگ کے لیے Muse Code کی ڈویلپر دستاویزات دیکھیں۔",
      ],
      example: "اس خیال کو یونیورسٹی کے ایک منصوبے میں بدلیں: ایک ایسا ٹول جو طلبہ کو اپنے ماخذ ترتیب دینے میں مدد دے۔ ہفتہ وار مراحل اور ہر مرحلے میں پیش کیے جانے والے واضح نتائج تجویز کریں۔",
    },
    manus: {
      title: "ایسا کام جو قدم بہ قدم آگے بڑھے",
      description: "کئی مراحل پر مشتمل کام Manus کو بھیجیں اور یہاں اس کی پیش رفت اور نتیجہ دیکھیں۔",
      capability: "Manus کے کام بنائیں اور ان کی پیش رفت دیکھیں",
      distinction: "یہ رابطہ Manus کی API کے ذریعے کام چلاتا ہے۔ Cue ایک الگ ذاتی ایپ ہے جس کے لیے دعوت نامہ درکار ہو سکتا ہے؛ Manus کی کلید خودبخود Cue کی تمام خصوصیات تک رسائی نہیں دیتی۔",
      steps: [
        "API تک رسائی رکھنے والے Manus اکاؤنٹ میں کلید بنائیں اور کاموں کے لیے دستیاب کریڈٹس دیکھیں۔",
        "اپنا مقصد اور مطلوبہ نتیجہ واضح کریں، پھر کام یہاں چلائیں۔ کام نجی اشتراک کی ترتیب کے ساتھ بنائے جاتے ہیں۔",
        "پیش رفت دیکھنے کے لیے «کام کی حالت تازہ کریں» منتخب کریں۔ اگر ایجنٹ کو جواب یا منظوری درکار ہو تو سرکاری پلیٹ فارم پر کام کھولیں اور خود جواب دیں۔",
        "Cue کی ذاتی سروس کے لیے سرکاری اعلان کھولیں اور اپنے اکاؤنٹ کے لیے دستیاب رسائی کے لنک پر جائیں۔",
      ],
      example: "سرکاری ماخذ کی مدد سے تعلیمی حوالہ جات ترتیب دینے والے مفت ٹول تلاش کریں۔ ماخذ کے لنکس کے ساتھ ایک جدول میں ان کا موازنہ کریں اور نئے صارف کے لیے آسان انتخاب تجویز کریں۔ کوئی اکاؤنٹ نہ بنائیں اور کچھ بھی نہ خریدیں۔",
    },
    openai: {
      title: "آپ کے کام کے مطابق مدد",
      description: "OpenAI ماڈل کی مدد سے تحریر کا جائزہ لیں، کسی تصور کو آسان بنائیں یا پڑھائی اور کام کا منصوبہ تیار کریں۔",
      capability: "OpenAI کے ذریعے تحریری مدد",
      distinction: "یہ معاون OpenAI کی API استعمال کرتا ہے، آپ کے ChatGPT اکاؤنٹ کا dot نہیں۔ آپ کا ذاتی dot، اس کی یادداشت اور ٹولز ChatGPT کے اندر ترتیب دیے جاتے ہیں، اور ان کی دستیابی آپ کے پلان اور علاقے پر منحصر ہے۔",
      steps: [
        "OpenAI کے ڈویلپر پلیٹ فارم پر API کلید بنائیں اور API کریڈٹس دیکھیں۔ ChatGPT کی رکنیت میں API کریڈٹس خودبخود شامل نہیں ہوتے۔",
        "اپنی کلید اور کام یہاں درج کریں۔ جواب Hessara میں ظاہر ہوگا اور آپ اسے کاپی کر سکیں گے۔",
        "اپنا ذاتی dot بنانے کے لیے کمپیوٹر کے براؤزر یا ڈیسک ٹاپ ایپ میں ChatGPT کھولیں اور سرکاری رہنمائی کے مطابق اپنے اکاؤنٹ کے لیے دستیاب اختیارات سے ترتیب مکمل کریں۔",
      ],
      example: "سمجھائیں کہ یونیورسٹی کے تحقیقی مقالے کا جائزہ لینے کے لیے AI ماڈل کیسے منتخب کیا جائے۔ آسان معیار اور معیارِ کار جانچنے کے لیے پانچ چھوٹے کام دیں، اور فرضی حوالہ جات نہ بنائیں۔",
    },
  },
  fa: {
    grok: {
      title: "از یک پرسش تا درکی روشن‌تر",
      description: "با Grok به ایده‌هایتان نظم بدهید، موضوعی را درک کنید یا گزینه‌هایتان را مقایسه کنید.",
      capability: "کمک متنی با Grok",
      distinction: "این اتصال از مدل Grok استفاده می‌کند. حافظه، دسترسی به رایانه و اتصال‌های Grok Bot در برنامهٔ رسمی آن در دسترس‌اند و در اینجا ارائه نمی‌شوند.",
      steps: [
        "در کنسول توسعه‌دهندگان xAI یک کلید API بسازید و اعتبار و محدودیت‌های استفاده را بررسی کنید.",
        "کلید را اینجا جای‌گذاری کنید، کارتان را توضیح دهید و «اجرای دستیار» را انتخاب کنید.",
        "برای استفاده از همهٔ قابلیت‌های Grok Bot، راهنمای برنامهٔ رسمی را دنبال کنید، با یک طرح واجد شرایط وارد شوید و فقط مجوزهای موردنیاز را بدهید.",
      ],
      example: "سه روش برای مطالعهٔ یک درس دشوار را مقایسه کن. توضیح بده هر روش چه زمانی مفید است و سپس یک برنامهٔ هفتگی عملی پیشنهاد بده.",
    },
    meta: {
      title: "فضایی برای نظم دادن به ایده‌هایتان",
      description: "با Muse Spark یادداشت‌هایتان را به برنامه‌ای روشن یا توضیحی ساده تبدیل کنید.",
      capability: "کمک متنی با Muse Spark",
      distinction: "این اتصال از Muse Spark استفاده می‌کند. عامل شخصی Muse و خدمات متصل به آن از طریق وب‌سایت رسمی ارائه می‌شوند؛ دسترسی به آن‌ها به منطقه و حساب شما بستگی دارد.",
      steps: [
        "پلتفرم توسعه‌دهندگان Meta را باز کنید، دسترسی حساب خود به API مدل‌ها را بررسی کنید و یک کلید بسازید.",
        "کلید را اینجا وارد کنید تا یک کار متنی با Muse Spark اجرا شود.",
        "برای استفاده از عامل شخصی، Muse را باز کنید و تنظیم حساب را تکمیل کنید. برای برنامه‌نویسی در پایانه، مستندات توسعه‌دهندگان Muse Code را ببینید.",
      ],
      example: "این ایده را به برنامهٔ یک پروژهٔ دانشگاهی تبدیل کن: ابزاری که به دانشجویان در سازمان‌دهی منابعشان کمک کند. مراحل هفتگی و خروجی‌های مشخصی پیشنهاد بده.",
    },
    manus: {
      title: "کاری که گام‌به‌گام پیش می‌رود",
      description: "یک کار چندمرحله‌ای به Manus بفرستید و روند پیشرفت و نتیجهٔ آن را اینجا دنبال کنید.",
      capability: "ایجاد و پیگیری کارهای Manus",
      distinction: "این اتصال کارها را از طریق API رسمی Manus اجرا می‌کند. Cue یک برنامهٔ شخصی جداگانه است که ممکن است به دعوت‌نامه نیاز داشته باشد؛ کلید Manus به‌طور خودکار دسترسی به همهٔ قابلیت‌های Cue را نمی‌دهد.",
      steps: [
        "در یک حساب Manus دارای دسترسی به API کلید بسازید و اعتبار اجرای کارها را بررسی کنید.",
        "هدف و خروجی موردانتظار را توضیح دهید، سپس کار را اینجا اجرا کنید. کارها با تنظیم اشتراک‌گذاری خصوصی ساخته می‌شوند.",
        "برای پیگیری پیشرفت، «به‌روزرسانی وضعیت کار» را انتخاب کنید. اگر عامل به پاسخ یا تأیید نیاز داشت، کار را در پلتفرم رسمی باز کنید و خودتان پاسخ دهید.",
        "برای خدمات شخصی Cue، اطلاعیهٔ رسمی را باز کنید و پیوند دسترسی ارائه‌شده برای حساب خود را دنبال کنید.",
      ],
      example: "با استفاده از منابع رسمی، ابزارهای رایگان سازمان‌دهی منابع دانشگاهی را پیدا کن. آن‌ها را در جدولی همراه با پیوند منابع مقایسه کن و گزینه‌ای مناسب برای مبتدیان پیشنهاد بده. هیچ حسابی نساز و چیزی نخر.",
    },
    openai: {
      title: "کمکی متناسب با کار شما",
      description: "با یک مدل OpenAI متنی را بازبینی کنید، مفهومی را ساده کنید یا برنامه‌ای برای مطالعه یا کار بسازید.",
      capability: "کمک متنی با OpenAI",
      distinction: "این دستیار از API شرکت OpenAI استفاده می‌کند، نه از dot حساب ChatGPT شما. dot شخصی، حافظه و ابزارهایش در ChatGPT تنظیم می‌شوند و به طرح اشتراک و منطقهٔ شما بستگی دارند.",
      steps: [
        "در پلتفرم توسعه‌دهندگان OpenAI یک کلید API بسازید و اعتبار API را بررسی کنید. اشتراک ChatGPT به‌طور خودکار شامل اعتبار API نمی‌شود.",
        "کلید و کارتان را اینجا وارد کنید. پاسخ در Hessara نمایش داده می‌شود و می‌توانید آن را کپی کنید.",
        "برای ساخت dot شخصی، راهنمای رسمی راه‌اندازی را در ChatGPT از طریق مرورگر رایانه یا برنامهٔ دسکتاپ دنبال کنید و از گزینه‌های موجود برای حساب خود استفاده کنید.",
      ],
      example: "توضیح بده چگونه یک مدل هوش مصنوعی برای بازبینی مقالهٔ دانشگاهی انتخاب کنم. معیارهای ساده و پنج کار کوچک برای سنجش کیفیت ارائه بده، بدون اینکه منابع ساختگی تولید کنی.",
    },
  },
  ru: {
    grok: {
      title: "От вопроса к более ясному пониманию",
      description: "Упорядочьте идею, разберитесь в теме или сравните варианты с помощью Grok.",
      capability: "Текстовая помощь от Grok",
      distinction: "Это подключение использует модель Grok. Память Grok Bot, доступ к компьютеру и подключения к сервисам доступны в официальном приложении и сюда не входят.",
      steps: [
        "Создайте API-ключ в консоли разработчика xAI и проверьте баланс и ограничения использования.",
        "Вставьте ключ здесь, опишите задачу и выберите «Запустить помощника».",
        "Чтобы использовать все функции Grok Bot, следуйте руководству официального приложения, войдите с подходящим тарифом и предоставьте только необходимые разрешения.",
      ],
      example: "Сравни три способа подготовки по сложному учебному предмету. Объясни, когда полезен каждый из них, и предложи выполнимый план на неделю.",
    },
    meta: {
      title: "Пространство для упорядочивания идей",
      description: "Превратите заметки в понятный план или простое объяснение с помощью Muse Spark.",
      capability: "Текстовая помощь от Muse Spark",
      distinction: "Это подключение использует Muse Spark. Персональный агент Muse и подключённые сервисы доступны на официальном сайте; доступность зависит от региона и учётной записи.",
      steps: [
        "Откройте платформу разработчиков Meta, проверьте, доступен ли вашей учётной записи API моделей, и создайте ключ.",
        "Введите ключ здесь, чтобы выполнить текстовую задачу с помощью Muse Spark.",
        "Для работы с персональным агентом откройте Muse и завершите настройку учётной записи. Для программирования в терминале ознакомьтесь с документацией Muse Code для разработчиков.",
      ],
      example: "Преврати эту идею в план университетского проекта: инструмент, помогающий студентам упорядочивать источники. Предложи еженедельные этапы и конкретные результаты для каждого из них.",
    },
    manus: {
      title: "Задача, которая продвигается шаг за шагом",
      description: "Отправьте многоэтапную задачу в Manus и отслеживайте здесь её выполнение и результат.",
      capability: "Создание и отслеживание задач Manus",
      distinction: "Это подключение выполняет задачи через API Manus. Cue — отдельное персональное приложение, для которого может понадобиться приглашение; ключ Manus не даёт автоматического доступа ко всем функциям Cue.",
      steps: [
        "Создайте ключ в учётной записи Manus с доступом к API и проверьте запас кредитов для задач.",
        "Опишите цель и ожидаемый результат, затем запустите задачу здесь. Задачи создаются с приватными настройками доступа.",
        "Выберите «Обновить статус задачи», чтобы следить за выполнением. Если агенту нужен ответ или одобрение, откройте задачу на официальном сайте и ответьте самостоятельно.",
        "Для персонального сервиса Cue откройте официальный анонс и перейдите по ссылке доступа, доступной вашей учётной записи.",
      ],
      example: "Найди в официальных источниках бесплатные инструменты для организации академических ссылок и библиографии. Сравни их в таблице со ссылками на источники и предложи вариант для начинающих. Не создавай учётные записи и ничего не покупай.",
    },
    openai: {
      title: "Помощь под вашу задачу",
      description: "Отредактируйте текст, упростите сложное понятие или составьте учебный либо рабочий план с помощью модели OpenAI.",
      capability: "Текстовая помощь от OpenAI",
      distinction: "Этот помощник использует API OpenAI, а не dot вашей учётной записи ChatGPT. Ваш персональный dot, его память и инструменты настраиваются в ChatGPT с учётом тарифа и региона.",
      steps: [
        "Создайте API-ключ на платформе разработчиков OpenAI и проверьте баланс API. Подписка ChatGPT не включает кредиты API автоматически.",
        "Введите здесь ключ и задачу. Ответ появится в Hessara, и его можно будет скопировать.",
        "Чтобы создать персональный dot, следуйте официальному руководству по настройке в ChatGPT через браузер на компьютере или настольное приложение, используя доступные вашей учётной записи возможности.",
      ],
      example: "Объясни, как выбрать модель ИИ для проверки университетской работы. Предложи простые критерии и пять небольших заданий для оценки качества, не выдумывая источники.",
    },
  },
  fr: {
    grok: {
      title: "D’une question à une meilleure compréhension",
      description: "Structurez une idée, comprenez un sujet ou comparez vos options avec Grok.",
      capability: "Assistance textuelle avec Grok",
      distinction: "Cette connexion utilise le modèle Grok. La mémoire de Grok Bot, son accès à un ordinateur et ses connexions sont disponibles dans son application officielle et ne sont pas inclus ici.",
      steps: [
        "Créez une clé API dans la console développeur de xAI et vérifiez vos crédits ainsi que vos limites d’utilisation.",
        "Collez votre clé ici, décrivez votre tâche, puis sélectionnez « Lancer l’assistant ».",
        "Pour utiliser toutes les fonctions de Grok Bot, suivez le guide de l’application officielle, connectez-vous avec une offre compatible et accordez uniquement les autorisations nécessaires.",
      ],
      example: "Comparez trois méthodes pour réviser un cours difficile. Expliquez dans quels cas chacune est utile, puis proposez un programme hebdomadaire réaliste.",
    },
    meta: {
      title: "Un espace pour structurer vos idées",
      description: "Transformez vos notes en un plan clair ou en une explication simple avec Muse Spark.",
      capability: "Assistance textuelle avec Muse Spark",
      distinction: "Cette connexion utilise Muse Spark. L’agent personnel Muse et les services connectés sont accessibles sur son site officiel ; leur disponibilité dépend de votre région et de votre compte.",
      steps: [
        "Ouvrez la plateforme développeur de Meta, vérifiez que votre compte dispose d’un accès à l’API des modèles et créez une clé.",
        "Saisissez votre clé ici pour exécuter une tâche textuelle avec Muse Spark.",
        "Pour l’agent personnel, ouvrez Muse et terminez la configuration du compte. Pour programmer dans un terminal, consultez la documentation développeur de Muse Code.",
      ],
      example: "Transformez cette idée en un plan de projet universitaire : un outil pour aider les étudiants à organiser leurs sources. Proposez des étapes hebdomadaires et des livrables précis.",
    },
    manus: {
      title: "Une tâche qui avance, étape par étape",
      description: "Envoyez une tâche en plusieurs étapes à Manus et suivez ici son avancement et son résultat.",
      capability: "Créer et suivre des tâches Manus",
      distinction: "Cette connexion exécute des tâches via l’API Manus. Cue est une application personnelle distincte qui peut nécessiter une invitation ; une clé Manus ne donne pas automatiquement accès à toutes les fonctions de Cue.",
      steps: [
        "Créez une clé dans un compte Manus disposant d’un accès à l’API et vérifiez vos crédits de tâches.",
        "Décrivez votre objectif et le résultat attendu, puis lancez la tâche ici. Les tâches sont créées avec un partage privé.",
        "Sélectionnez « Actualiser l’état de la tâche » pour suivre son avancement. Si l’agent attend une réponse ou une autorisation, ouvrez la tâche sur le site officiel et répondez vous-même.",
        "Pour le service personnel Cue, ouvrez l’annonce officielle et suivez le lien d’accès disponible pour votre compte.",
      ],
      example: "Recherchez, dans des sources officielles, des outils gratuits pour organiser des références universitaires. Comparez-les dans un tableau avec les liens des sources et proposez une option adaptée aux débutants. Ne créez aucun compte et n’achetez rien.",
    },
    openai: {
      title: "Une aide adaptée à votre tâche",
      description: "Relisez un texte, simplifiez un concept ou préparez un programme d’étude ou de travail avec un modèle OpenAI.",
      capability: "Assistance textuelle avec OpenAI",
      distinction: "Cet assistant utilise l’API OpenAI, et non votre dot ChatGPT. Votre dot personnel, sa mémoire et ses outils se configurent dans ChatGPT, selon votre offre et votre région.",
      steps: [
        "Créez une clé API sur la plateforme développeur OpenAI et vérifiez vos crédits API. Un abonnement ChatGPT n’inclut pas automatiquement de crédits API.",
        "Saisissez votre clé et votre tâche ici. La réponse s’affiche dans Hessara et peut être copiée.",
        "Pour créer votre dot personnel, suivez le guide officiel de configuration dans ChatGPT, sur le Web depuis un ordinateur ou dans l’application de bureau, avec les options disponibles pour votre compte.",
      ],
      example: "Expliquez comment choisir un modèle d’IA pour relire un travail universitaire. Donnez des critères simples et cinq petites tâches pour vérifier la qualité sans inventer de références.",
    },
  },
  es: {
    grok: {
      title: "De una pregunta a una comprensión más clara",
      description: "Organiza una idea, comprende un tema o compara tus opciones con Grok.",
      capability: "Asistencia de texto con Grok",
      distinction: "Esta conexión utiliza el modelo Grok. La memoria de Grok Bot, su acceso a un ordenador y sus conexiones pertenecen a su aplicación oficial y no se incluyen aquí.",
      steps: [
        "Crea una clave de API en la consola para desarrolladores de xAI y comprueba tus créditos y límites de uso.",
        "Pega aquí tu clave, describe la tarea y selecciona «Ejecutar asistente».",
        "Para utilizar todas las funciones de Grok Bot, sigue la guía de la aplicación oficial, inicia sesión con un plan compatible y concede solo los permisos necesarios.",
      ],
      example: "Compara tres métodos para estudiar una asignatura difícil. Explica cuándo resulta útil cada uno y propone un plan semanal práctico.",
    },
    meta: {
      title: "Un espacio para organizar tus ideas",
      description: "Convierte tus notas en un plan claro o una explicación sencilla con Muse Spark.",
      capability: "Asistencia de texto con Muse Spark",
      distinction: "Esta conexión utiliza Muse Spark. El agente personal Muse y los servicios conectados están disponibles en su sitio oficial; la disponibilidad depende de tu región y tu cuenta.",
      steps: [
        "Abre la plataforma para desarrolladores de Meta, comprueba si tu cuenta tiene acceso a la API de modelos y crea una clave.",
        "Introduce aquí tu clave para ejecutar una tarea de texto con Muse Spark.",
        "Para usar el agente personal, abre Muse y termina de configurar tu cuenta. Para programar en una terminal, consulta la documentación para desarrolladores de Muse Code.",
      ],
      example: "Convierte esta idea en un plan de proyecto universitario: una herramienta que ayude a los estudiantes a organizar sus fuentes. Propón hitos semanales y entregables concretos.",
    },
    manus: {
      title: "Una tarea que avanza paso a paso",
      description: "Envía una tarea de varios pasos a Manus y sigue aquí su progreso y resultado.",
      capability: "Crear y seguir tareas de Manus",
      distinction: "Esta conexión ejecuta tareas mediante la API de Manus. Cue es una aplicación personal independiente que puede requerir una invitación; una clave de Manus no da acceso automáticamente a todas las funciones de Cue.",
      steps: [
        "Crea una clave en una cuenta de Manus con acceso a la API y comprueba tus créditos para tareas.",
        "Describe tu objetivo y el resultado esperado, y ejecuta aquí la tarea. Las tareas se crean con uso compartido privado.",
        "Selecciona «Actualizar estado de la tarea» para seguir el progreso. Si el agente necesita una respuesta o aprobación, abre la tarea en el sitio oficial y responde personalmente.",
        "Para el servicio personal Cue, abre el anuncio oficial y sigue el enlace de acceso disponible para tu cuenta.",
      ],
      example: "Investiga herramientas gratuitas para organizar referencias académicas usando fuentes oficiales. Compáralas en una tabla con enlaces a las fuentes y sugiere una opción fácil para principiantes. No crees cuentas ni compres nada.",
    },
    openai: {
      title: "Ayuda adaptada a tu tarea",
      description: "Revisa un texto, simplifica un concepto o crea un plan de estudio o trabajo con un modelo de OpenAI.",
      capability: "Asistencia de texto con OpenAI",
      distinction: "Este asistente utiliza la API de OpenAI, no el dot de tu cuenta de ChatGPT. Tu dot personal, su memoria y sus herramientas se configuran en ChatGPT, según tu plan y región.",
      steps: [
        "Crea una clave de API en la plataforma para desarrolladores de OpenAI y comprueba tus créditos de API. Una suscripción a ChatGPT no incluye automáticamente créditos de API.",
        "Introduce aquí tu clave y tu tarea. La respuesta aparecerá en Hessara y podrás copiarla.",
        "Para crear tu dot personal, sigue la guía oficial de configuración en ChatGPT desde la web de escritorio o la aplicación de escritorio, con las opciones disponibles para tu cuenta.",
      ],
      example: "Explica cómo elegir un modelo de IA para revisar un trabajo universitario. Da criterios sencillos y cinco tareas pequeñas para comprobar la calidad sin inventar referencias.",
    },
  },
  pt: {
    grok: {
      title: "De uma pergunta a uma compreensão mais clara",
      description: "Organize uma ideia, compreenda um tema ou compare suas opções com o Grok.",
      capability: "Assistência de texto com o Grok",
      distinction: "Esta conexão usa o modelo Grok. A memória do Grok Bot, seu acesso a um computador e suas conexões estão disponíveis no aplicativo oficial e não estão incluídos aqui.",
      steps: [
        "Crie uma chave de API no console de desenvolvedores da xAI e confira seus créditos e limites de uso.",
        "Cole sua chave aqui, descreva a tarefa e selecione «Executar assistente».",
        "Para usar todos os recursos do Grok Bot, siga o guia do aplicativo oficial, entre com um plano compatível e conceda apenas as permissões necessárias.",
      ],
      example: "Compare três métodos para estudar uma disciplina difícil. Explique quando cada um é útil e sugira um plano semanal prático.",
    },
    meta: {
      title: "Um espaço para organizar suas ideias",
      description: "Transforme suas anotações em um plano claro ou uma explicação simples com o Muse Spark.",
      capability: "Assistência de texto com o Muse Spark",
      distinction: "Esta conexão usa o Muse Spark. O agente pessoal Muse e os serviços conectados estão disponíveis no site oficial; a disponibilidade depende da sua região e da sua conta.",
      steps: [
        "Abra a plataforma de desenvolvedores da Meta, confira se sua conta tem acesso à API de modelos e crie uma chave.",
        "Insira sua chave aqui para executar uma tarefa de texto com o Muse Spark.",
        "Para usar o agente pessoal, abra o Muse e conclua a configuração da conta. Para programar em um terminal, consulte a documentação para desenvolvedores do Muse Code.",
      ],
      example: "Transforme esta ideia em um plano de projeto universitário: uma ferramenta que ajude estudantes a organizar suas fontes. Sugira etapas semanais e entregas bem definidas.",
    },
    manus: {
      title: "Uma tarefa que avança passo a passo",
      description: "Envie uma tarefa com várias etapas ao Manus e acompanhe seu progresso e resultado por aqui.",
      capability: "Criar e acompanhar tarefas do Manus",
      distinction: "Esta conexão executa tarefas pela API do Manus. O Cue é um aplicativo pessoal separado que pode exigir um convite; uma chave do Manus não dá acesso automático a todos os recursos do Cue.",
      steps: [
        "Crie uma chave em uma conta do Manus com acesso à API e confira seus créditos de tarefas.",
        "Descreva seu objetivo e o resultado esperado e execute a tarefa aqui. As tarefas são criadas com compartilhamento privado.",
        "Selecione «Atualizar status da tarefa» para acompanhar o progresso. Se o agente precisar de uma resposta ou aprovação, abra a tarefa no site oficial e responda pessoalmente.",
        "Para o serviço pessoal Cue, abra o anúncio oficial e siga o link de acesso disponível para sua conta.",
      ],
      example: "Pesquise ferramentas gratuitas para organizar referências acadêmicas usando fontes oficiais. Compare-as em uma tabela com links para as fontes e sugira uma opção adequada para iniciantes. Não crie contas nem compre nada.",
    },
    openai: {
      title: "Ajuda adequada à sua tarefa",
      description: "Revise um texto, simplifique um conceito ou crie um plano de estudo ou trabalho com um modelo da OpenAI.",
      capability: "Assistência de texto com a OpenAI",
      distinction: "Este assistente usa a API da OpenAI, não o dot da sua conta do ChatGPT. Seu dot pessoal, a memória e as ferramentas dele são configurados no ChatGPT, conforme seu plano e sua região.",
      steps: [
        "Crie uma chave de API na plataforma de desenvolvedores da OpenAI e confira seus créditos de API. Uma assinatura do ChatGPT não inclui automaticamente créditos de API.",
        "Insira sua chave e sua tarefa aqui. A resposta aparece no Hessara e pode ser copiada.",
        "Para criar seu dot pessoal, siga o guia oficial de configuração no ChatGPT pelo navegador no computador ou pelo aplicativo para desktop, usando as opções disponíveis para sua conta.",
      ],
      example: "Explique como escolher um modelo de IA para revisar um trabalho universitário. Apresente critérios simples e cinco pequenas tarefas para verificar a qualidade sem inventar referências.",
    },
  },
  it: {
    grok: {
      title: "Da una domanda a una comprensione più chiara",
      description: "Organizza un’idea, approfondisci un argomento o confronta le tue opzioni con Grok.",
      capability: "Assistenza testuale con Grok",
      distinction: "Questo collegamento utilizza il modello Grok. La memoria di Grok Bot, l’accesso al computer e le connessioni sono disponibili nella sua app ufficiale e non sono inclusi qui.",
      steps: [
        "Crea una chiave API nella console per sviluppatori di xAI e verifica i tuoi crediti e i limiti di utilizzo.",
        "Incolla qui la chiave, descrivi l’attività e seleziona «Avvia assistente».",
        "Per usare tutte le funzioni di Grok Bot, segui la guida dell’app ufficiale, accedi con un piano compatibile e concedi solo le autorizzazioni necessarie.",
      ],
      example: "Confronta tre metodi per studiare una materia difficile. Spiega quando è utile ciascun metodo e proponi un programma settimanale pratico.",
    },
    meta: {
      title: "Uno spazio per organizzare le tue idee",
      description: "Trasforma i tuoi appunti in un piano chiaro o in una spiegazione semplice con Muse Spark.",
      capability: "Assistenza testuale con Muse Spark",
      distinction: "Questo collegamento utilizza Muse Spark. L’agente personale Muse e i servizi collegati sono disponibili sul sito ufficiale; la disponibilità dipende dalla regione e dall’account.",
      steps: [
        "Apri la piattaforma per sviluppatori di Meta, verifica che il tuo account abbia accesso all’API dei modelli e crea una chiave.",
        "Inserisci qui la chiave per eseguire un’attività testuale con Muse Spark.",
        "Per l’agente personale, apri Muse e completa la configurazione dell’account. Per programmare in un terminale, consulta la documentazione per sviluppatori di Muse Code.",
      ],
      example: "Trasforma questa idea in un piano per un progetto universitario: uno strumento che aiuti gli studenti a organizzare le fonti. Proponi tappe settimanali e risultati concreti da consegnare.",
    },
    manus: {
      title: "Un’attività che avanza, passo dopo passo",
      description: "Invia a Manus un’attività in più fasi e seguine qui l’avanzamento e il risultato.",
      capability: "Creare e monitorare attività Manus",
      distinction: "Questo collegamento esegue attività tramite l’API di Manus. Cue è un’app personale separata che potrebbe richiedere un invito; una chiave Manus non include automaticamente tutte le funzioni di Cue.",
      steps: [
        "Crea una chiave in un account Manus con accesso all’API e verifica i crediti disponibili per le attività.",
        "Descrivi l’obiettivo e il risultato atteso, poi avvia qui l’attività. Le attività vengono create con condivisione privata.",
        "Seleziona «Aggiorna stato dell’attività» per seguirne l’avanzamento. Se l’agente richiede una risposta o un’approvazione, apri l’attività sul sito ufficiale e rispondi personalmente.",
        "Per il servizio personale Cue, apri l’annuncio ufficiale e segui il collegamento di accesso disponibile per il tuo account.",
      ],
      example: "Cerca strumenti gratuiti per organizzare riferimenti accademici usando fonti ufficiali. Confrontali in una tabella con i collegamenti alle fonti e suggerisci un’opzione adatta ai principianti. Non creare account e non acquistare nulla.",
    },
    openai: {
      title: "Un aiuto adatto alla tua attività",
      description: "Rivedi un testo, semplifica un concetto o prepara un piano di studio o di lavoro con un modello OpenAI.",
      capability: "Assistenza testuale con OpenAI",
      distinction: "Questo assistente utilizza l’API di OpenAI, non il dot del tuo account ChatGPT. Il tuo dot personale, la sua memoria e i suoi strumenti si configurano in ChatGPT, in base al piano e alla regione.",
      steps: [
        "Crea una chiave API sulla piattaforma per sviluppatori OpenAI e verifica i crediti API. Un abbonamento ChatGPT non include automaticamente crediti API.",
        "Inserisci qui la chiave e l’attività. La risposta appare in Hessara e può essere copiata.",
        "Per creare il tuo dot personale, segui la guida ufficiale alla configurazione in ChatGPT sul Web da computer o nell’app desktop, usando le opzioni disponibili per il tuo account.",
      ],
      example: "Spiega come scegliere un modello di IA per rivedere un elaborato universitario. Fornisci criteri semplici e cinque piccole attività per verificare la qualità senza inventare riferimenti.",
    },
  },
  de: {
    grok: {
      title: "Von einer Frage zu mehr Verständnis",
      description: "Ordnen Sie eine Idee, verstehen Sie ein Thema oder vergleichen Sie Ihre Möglichkeiten mit Grok.",
      capability: "Textunterstützung mit Grok",
      distinction: "Diese Verbindung verwendet das Grok-Modell. Das Gedächtnis, der Computerzugriff und die Verbindungen von Grok Bot stehen in der offiziellen App zur Verfügung und sind hier nicht enthalten.",
      steps: [
        "Erstellen Sie in der xAI-Entwicklerkonsole einen API-Schlüssel und prüfen Sie Ihr Guthaben sowie die Nutzungslimits.",
        "Fügen Sie hier Ihren Schlüssel ein, beschreiben Sie Ihre Aufgabe und wählen Sie „Assistent starten“.",
        "Für den vollständigen Grok Bot folgen Sie der Anleitung der offiziellen App, melden sich mit einem geeigneten Tarif an und erteilen nur die benötigten Berechtigungen.",
      ],
      example: "Vergleichen Sie drei Lernmethoden für ein schwieriges Studienfach. Erklären Sie, wann welche Methode hilfreich ist, und schlagen Sie einen praktikablen Wochenplan vor.",
    },
    meta: {
      title: "Raum, um Ihre Ideen zu ordnen",
      description: "Machen Sie mit Muse Spark aus Ihren Notizen einen klaren Plan oder eine einfache Erklärung.",
      capability: "Textunterstützung mit Muse Spark",
      distinction: "Diese Verbindung verwendet Muse Spark. Der persönliche Agent Muse und die verbundenen Dienste sind über die offizielle Website verfügbar; die Verfügbarkeit hängt von Ihrer Region und Ihrem Konto ab.",
      steps: [
        "Öffnen Sie die Meta-Entwicklerplattform, prüfen Sie den Zugriff Ihres Kontos auf die Modell-API und erstellen Sie einen Schlüssel.",
        "Geben Sie hier Ihren Schlüssel ein, um mit Muse Spark eine Textaufgabe auszuführen.",
        "Für den persönlichen Agenten öffnen Sie Muse und schließen die Kontoeinrichtung ab. Informationen zum Programmieren im Terminal finden Sie in der Entwicklerdokumentation von Muse Code.",
      ],
      example: "Entwickeln Sie aus dieser Idee einen Plan für ein Hochschulprojekt: ein Werkzeug, das Studierende beim Ordnen ihrer Quellen unterstützt. Schlagen Sie wöchentliche Meilensteine und klare Arbeitsergebnisse vor.",
    },
    manus: {
      title: "Eine Aufgabe, die Schritt für Schritt vorankommt",
      description: "Senden Sie eine mehrstufige Aufgabe an Manus und verfolgen Sie hier den Fortschritt und das Ergebnis.",
      capability: "Manus-Aufgaben erstellen und verfolgen",
      distinction: "Diese Verbindung führt Aufgaben über die Manus-API aus. Cue ist eine separate persönliche App, für die eine Einladung erforderlich sein kann; ein Manus-Schlüssel gewährt nicht automatisch Zugriff auf alle Cue-Funktionen.",
      steps: [
        "Erstellen Sie in einem Manus-Konto mit API-Zugriff einen Schlüssel und prüfen Sie Ihr Aufgabenguthaben.",
        "Beschreiben Sie Ihr Ziel und das erwartete Ergebnis und starten Sie die Aufgabe hier. Aufgaben werden mit privater Freigabe erstellt.",
        "Wählen Sie „Aufgabenstatus aktualisieren“, um den Fortschritt zu verfolgen. Wenn der Agent eine Antwort oder Genehmigung benötigt, öffnen Sie die Aufgabe auf der offiziellen Website und antworten Sie selbst.",
        "Für den persönlichen Dienst Cue öffnen Sie die offizielle Ankündigung und folgen dem Zugangslink, der für Ihr Konto verfügbar ist.",
      ],
      example: "Recherchieren Sie anhand offizieller Quellen kostenlose Werkzeuge zur Verwaltung wissenschaftlicher Literatur. Vergleichen Sie diese in einer Tabelle mit Quellenlinks und empfehlen Sie eine einsteigerfreundliche Option. Erstellen Sie keine Konten und kaufen Sie nichts.",
    },
    openai: {
      title: "Unterstützung passend zu Ihrer Aufgabe",
      description: "Überarbeiten Sie einen Text, vereinfachen Sie ein Konzept oder erstellen Sie mit einem OpenAI-Modell einen Lern- oder Arbeitsplan.",
      capability: "Textunterstützung mit OpenAI",
      distinction: "Dieser Assistent verwendet die OpenAI-API, nicht den dot Ihres ChatGPT-Kontos. Ihr persönlicher dot, sein Gedächtnis und seine Werkzeuge werden in ChatGPT eingerichtet, abhängig von Ihrem Tarif und Ihrer Region.",
      steps: [
        "Erstellen Sie auf der OpenAI-Entwicklerplattform einen API-Schlüssel und prüfen Sie Ihr API-Guthaben. Ein ChatGPT-Abonnement enthält nicht automatisch API-Guthaben.",
        "Geben Sie hier Ihren Schlüssel und Ihre Aufgabe ein. Die Antwort erscheint in Hessara und kann kopiert werden.",
        "Um Ihren persönlichen dot zu erstellen, folgen Sie der offiziellen Einrichtungsanleitung in ChatGPT im Desktop-Browser oder in der Desktop-App und nutzen Sie die für Ihr Konto verfügbaren Optionen.",
      ],
      example: "Erklären Sie, wie man ein KI-Modell zur Überarbeitung einer Hochschularbeit auswählt. Nennen Sie einfache Kriterien und fünf kleine Aufgaben, mit denen sich die Qualität prüfen lässt, ohne Quellen zu erfinden.",
    },
  },
  nl: {
    grok: {
      title: "Van een vraag naar meer inzicht",
      description: "Orden een idee, begrijp een onderwerp of vergelijk je mogelijkheden met Grok.",
      capability: "Tekstondersteuning met Grok",
      distinction: "Deze verbinding gebruikt het Grok-model. Het geheugen, de computertoegang en de verbindingen van Grok Bot zijn beschikbaar in de officiële app en zijn hier niet inbegrepen.",
      steps: [
        "Maak een API-sleutel in de ontwikkelaarsconsole van xAI en controleer je tegoed en gebruikslimieten.",
        "Plak je sleutel hier, beschrijf je taak en kies ‘Assistent starten’.",
        "Voor alle functies van Grok Bot volg je de handleiding van de officiële app, meld je je aan met een geschikt abonnement en geef je alleen de benodigde machtigingen.",
      ],
      example: "Vergelijk drie manieren om voor een moeilijk vak te studeren. Leg uit wanneer elke methode nuttig is en stel een praktisch weekplan voor.",
    },
    meta: {
      title: "Ruimte om je ideeën te ordenen",
      description: "Maak van je notities een duidelijk plan of een eenvoudige uitleg met Muse Spark.",
      capability: "Tekstondersteuning met Muse Spark",
      distinction: "Deze verbinding gebruikt Muse Spark. De persoonlijke agent Muse en verbonden diensten zijn beschikbaar via de officiële website; de beschikbaarheid hangt af van je regio en account.",
      steps: [
        "Open het ontwikkelaarsplatform van Meta, controleer of je account toegang heeft tot de model-API en maak een sleutel.",
        "Voer je sleutel hier in om een teksttaak uit te voeren met Muse Spark.",
        "Open Muse en rond het instellen van je account af om de persoonlijke agent te gebruiken. Raadpleeg de ontwikkelaarsdocumentatie van Muse Code voor programmeren in een terminal.",
      ],
      example: "Werk dit idee uit tot een plan voor een universitair project: een hulpmiddel waarmee studenten hun bronnen kunnen ordenen. Stel wekelijkse mijlpalen en duidelijke op te leveren resultaten voor.",
    },
    manus: {
      title: "Een taak die stap voor stap vooruitgaat",
      description: "Stuur een taak met meerdere stappen naar Manus en volg hier de voortgang en het resultaat.",
      capability: "Manus-taken maken en volgen",
      distinction: "Deze verbinding voert taken uit via de Manus-API. Cue is een afzonderlijke persoonlijke app waarvoor mogelijk een uitnodiging nodig is; een Manus-sleutel geeft niet automatisch toegang tot alle functies van Cue.",
      steps: [
        "Maak een sleutel in een Manus-account met API-toegang en controleer je taakcredits.",
        "Beschrijf je doel en het verwachte resultaat en start de taak hier. Taken worden aangemaakt met privé delen als instelling.",
        "Kies ‘Taakstatus vernieuwen’ om de voortgang te volgen. Als de agent een antwoord of goedkeuring nodig heeft, open je de taak op de officiële website en reageer je zelf.",
        "Open voor de persoonlijke dienst Cue de officiële aankondiging en volg de toegangslink die voor je account beschikbaar is.",
      ],
      example: "Zoek met officiële bronnen naar gratis hulpmiddelen om wetenschappelijke referenties te ordenen. Vergelijk ze in een tabel met bronlinks en stel een geschikte optie voor beginners voor. Maak geen accounts aan en koop niets.",
    },
    openai: {
      title: "Hulp die bij je taak past",
      description: "Herzie een tekst, vereenvoudig een begrip of maak een studie- of werkplan met een OpenAI-model.",
      capability: "Tekstondersteuning met OpenAI",
      distinction: "Deze assistent gebruikt de OpenAI-API, niet de dot van je ChatGPT-account. Je persoonlijke dot, het geheugen en de hulpmiddelen daarvan worden in ChatGPT ingesteld, afhankelijk van je abonnement en regio.",
      steps: [
        "Maak een API-sleutel op het ontwikkelaarsplatform van OpenAI en controleer je API-tegoed. Een ChatGPT-abonnement bevat niet automatisch API-tegoed.",
        "Voer hier je sleutel en taak in. Het antwoord verschijnt in Hessara en kan worden gekopieerd.",
        "Volg voor je persoonlijke dot de officiële installatiehandleiding in ChatGPT via de desktopbrowser of desktopapp, met de opties die voor je account beschikbaar zijn.",
      ],
      example: "Leg uit hoe je een AI-model kiest om een universitair werkstuk na te kijken. Geef eenvoudige criteria en vijf kleine taken om de kwaliteit te controleren zonder referenties te verzinnen.",
    },
  },
};
