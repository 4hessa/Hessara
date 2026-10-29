// Public status explanations use stable codes, never container stderr or paths.
const reasons: Record<string, readonly [string, string]> = {
  NO_WORKER: ["لا يوجد عامل تحليل معزول متصل بهذا المحرك حاليًا.", "No isolated analysis worker is connected to this engine."],
  IMAGE_UNPINNED: ["صورة المحرك غير مثبتة ببصمة SHA-256 معتمدة؛ لا يُسمح بتشغيل صورة متغيرة.", "The engine image is not pinned to an approved SHA-256 digest; mutable images cannot run."],
  WORKER_STALE: ["انقطع اتصال عامل التحليل. يعود المحرك بعد تجدد فحص الجاهزية.", "The analysis worker stopped responding. A fresh readiness check is required."],
  ENGINE_DISABLED: ["أوقف المسؤول هذا المحرك مؤقتًا.", "An administrator has paused this engine."],
  INTAKE_PAUSED: ["استقبال تحليلات جديدة متوقف مؤقتًا.", "New analysis jobs are temporarily paused."],
  WORKER_ENGINE_DISABLED: ["المحرك غير مفعّل أو لم يُعتمد تشغيله على عامل التحليل.", "The engine is disabled or has not been approved on the analysis worker."],
  CIRCUIT_OPEN: ["أُوقف المحرك مؤقتًا بعد أخطاء تشغيل متكررة لحماية بقية المنصة.", "Repeated execution errors temporarily stopped this engine to protect the platform."],
  VERSION_UNVERIFIED: ["لم يُوثّق إصدار المحرك بفحص تثبيت ناجح بعد.", "A successful installation check has not verified the engine version yet."],
  VERIFIED_SAMPLE_REQUIRED: ["يلزم نجاح تحليل ملف اختبار حقيقي لهذا الإصدار قبل إتاحة المحرك.", "This engine version must successfully analyze a real test artifact before it is available."],
  CAPABILITIES_UNVERIFIED: ["لم يؤكد عامل التحليل القدرات المطلوبة لهذا التكامل بعد.", "The analysis worker has not confirmed the capabilities required by this integration."],
  BENCHMARK_REQUIRED: ["لم تكتمل مراجعة حدود الموارد واختبار تشغيل المحرك بعد.", "Engine execution and resource limits have not been approved yet."],
  HEALTH_CHECK_FAILED: ["فشل فحص جاهزية المحرك. يلزم إصلاح التشغيل قبل إرسال ملفات إليه.", "The engine readiness check failed. Runtime repair is required before accepting artifacts."],
  ENGINE_CAPACITY_UNAVAILABLE: ["المحرك مشغول أو لا توجد له سعة تنفيذ متاحة حاليًا.", "The engine is busy or has no execution capacity available."],
  INSUFFICIENT_CAPACITY: ["لا توجد موارد كافية لاستقبال تحليل إضافي حاليًا.", "There are insufficient resources for an additional analysis right now."],
};

export function engineReason(reasonCode: unknown, locale: string): string {
  const reason = typeof reasonCode === "string" ? reasons[reasonCode] : undefined;
  return reason?.[locale === "ar" ? 0 : 1] ?? (locale === "ar"
    ? "لم تتأكد جاهزية المحرك بعد. يمكنك حفظ ملفك في المشروع وإعادة فحص الحالة لاحقًا."
    : "Engine readiness has not been verified. You can save your artifact and check again later.");
}

/** Diagnostic labels are a closed vocabulary, never worker stderr or paths. */
export function engineDiagnosticCode(reasonCode: unknown): string {
  return typeof reasonCode === "string" && Object.hasOwn(reasons, reasonCode)
    ? reasonCode : "READINESS_UNVERIFIED";
}

// Actionable operator steps contain no secrets, private image names or host paths.
const remediation: Record<string, readonly [string, string]> = {
  NO_WORKER: ["للمسؤول: جهّز عامل Linux معزولًا مع Docker، ثم اضبط اتصال HTTPS ورمز العامل السري وقائمة مضيفي التخزين المسموح بها.", "Administrator: provision a dedicated isolated Linux/Docker worker, then configure its HTTPS platform URL, private worker token and storage-host allowlist."],
  WORKER_STALE: ["للمسؤول: افحص خدمة العامل واتصال HTTPS بالمنصة وتطابق رمز العامل، ثم تحقق من تجدد نبضات الاتصال.", "Administrator: check the worker service, HTTPS connectivity and matching worker token, then verify fresh heartbeats."],
  ENGINE_DISABLED: ["للمسؤول: أكمل التثبيت واختبار العينة وحدود الموارد أولًا، ثم فعّل هذا المحرك وحده من إعدادات الإدارة.", "Administrator: complete installation, real sample verification and resource checks, then enable this engine in administration."],
  WORKER_ENGINE_DISABLED: ["للمسؤول: راجع تفعيل المحرك في إعدادات العامل وشهادة العينة قبل إعادة تشغيل الخدمة.", "Administrator: review the worker engine enablement and sample attestation before restarting its service."],
  INTAKE_PAUSED: ["للمسؤول: بعد التأكد من جاهزية العامل والقدرة المتاحة، استأنف استقبال المهام من إدارة الهندسة العكسية.", "Administrator: after confirming worker readiness and capacity, resume intake in reverse-engineering administration."],
  IMAGE_UNPINNED: ["للمسؤول: ابنِ صورة المحرك المراجعة، وسجّل بصمتها الحقيقية، ثم استخدم المرجع image@sha256:digest بدل وسم متغير.", "Administrator: build the reviewed engine image, record its actual digest, and configure image@sha256:digest rather than a mutable tag."],
  BENCHMARK_REQUIRED: ["للمسؤول: اختبر المهلة والإلغاء وحدود الذاكرة والشبكة والتنظيف داخل البيئة المعزولة قبل اعتماد benchmarkApproved.", "Administrator: verify timeout, cancellation, memory/network limits and cleanup inside isolation before approving benchmarkApproved."],
  VERIFIED_SAMPLE_REQUIRED: ["للمسؤول: نفّذ verify_engine.py على مضيف Linux المعزول بملف مأذون، ثم اربط تقريره الحقيقي بإعداد verificationReport.", "Administrator: run verify_engine.py on the isolated Linux host with an authorized fixture, then configure its genuine verificationReport."],
  VERSION_UNVERIFIED: ["للمسؤول: أصلح فحص إصدار الأداة داخل الصورة المعزولة، ثم أعد التحقق من عينة لهذا الإصدار.", "Administrator: repair the tool version probe inside the isolated image, then verify a real sample for that version."],
  CAPABILITIES_UNVERIFIED: ["للمسؤول: تحقق من قدرات محول المحرك المثبت؛ لا تُعلن قدرة قبل ظهور دليل تنفيذ لها.", "Administrator: verify the installed adapter capabilities; advertise only those backed by actual execution evidence."],
  HEALTH_CHECK_FAILED: ["للمسؤول: افحص سجل العامل الخاص واعتماديات الصورة وإصدار الأداة، وأعد فحص الجاهزية دون تخفيف العزل.", "Administrator: inspect private worker diagnostics, image dependencies and tool version, then rerun readiness checks without relaxing isolation."],
  ENGINE_CAPACITY_UNAVAILABLE: ["انتظر انتهاء المهمة الحالية أو وفّر سعة معزولة إضافية مقاسة قبل إعادة المحاولة.", "Wait for the current job or provide additional measured isolated capacity before retrying."],
  INSUFFICIENT_CAPACITY: ["للمسؤول: وفّر الذاكرة والمساحة والمعالجات المعلنة لهذا المحرك، ثم أعد قياس موارد العامل.", "Administrator: provide the engine's declared memory, disk and CPU requirements, then remeasure worker capacity."],
  CIRCUIT_OPEN: ["للمسؤول: عالج سبب أخطاء التنفيذ في السجلات الخاصة قبل إعادة تفعيل المحرك؛ لا تكرر التحليل بلا تحقق.", "Administrator: fix execution failures using private diagnostics before re-enabling the engine; do not blindly repeat analysis."],
};
export function engineRemediation(reasonCode: unknown, locale: string): string | null {
  return typeof reasonCode === "string" && Object.hasOwn(remediation, reasonCode)
    ? remediation[reasonCode][locale === "ar" ? 0 : 1] : null;
}
