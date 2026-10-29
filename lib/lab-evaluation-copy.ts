import type {Locale} from './i18n';
import {evaluationExtraCopy} from './lab-evaluation-extra-copy';
export const evaluationEnglish={
  title:'Understand this result',checks:'Your automatic checks',checkScore:'Configured checks passed',coverage:'Measured checks',
  basis:'These checks use your saved rules. Their percentage is not an overall quality or factual-accuracy score.',
  passed:'Passed',failed:'Not passed',not_measured:'Not measured',reference:'Reference comparison',
  referenceNote:'The reference is supplied by you and is not independently verified. This compares text after Unicode normalization, line-ending normalization and trimming outer whitespace.',
  literal_found:'The required text appears in the answer.',literal_missing:'The required text was not found.',excluded_absent:'The excluded text does not appear.',excluded_present:'The excluded text appears in the answer.',exact_match:'The complete answer matches the required text exactly.',exact_difference:'The answer differs from the required text.',valid_json:'The complete answer is valid JSON.',invalid_json:'The complete answer is not valid JSON.',invalid_check:'This check is incomplete and was not measured.',attempt_incomplete:'The attempt did not provide a complete successful answer.',no_reference:'No reference was supplied.',reference_match:'The normalized text matches your reference.',reference_difference:'The normalized text differs from your reference.',
  evidence:'Excerpt from the answer',expected:'Expected text',manual:'Your review',manualNote:'These are your own ratings and source checks. HESSARA does not independently confirm the sources you enter.',
  relevance:'Relevance',instruction:'Following instructions',completeness:'Completeness',visible_reasoning:'Explanation visible in the answer',source_quality:'Source quality',accuracy:'Factual accuracy',
  rating:'Your rating (1–5)',rationale:'Reason for this rating',notes:'Review notes',save:'Save my review',remove:'Delete my review',saving:'Saving…',saved:'Review saved',error:'The action could not be completed. Refresh and review the entered fields.',
  claims:'Review specific claims',addClaim:'Add a claim',deleteClaim:'Remove claim',claim:'Claim text',claimStatus:'Your verification status',verified:'Verified by you',contradicted:'Conflicts with your source',unverified:'Not verified',opinion:'Opinion or inference',sourceURL:'Source link',sourceTitle:'Source name',quote:'Exact quotation from the source',claimReason:'Explain your conclusion',
  sourceNote:'A source link and quotation are required for verified or conflicting claims. They are recorded as your review, not automatic fact-checking.',
  judge:'Optional model assessment',judgeNote:'An independent connected model can assess the visible answer and explain its ratings. This is an estimate, can be wrong and does not verify facts or browse sources.',
  evaluator:'Choose an evaluator',choose:'Choose a connected model',judgeConsent:'Send the question, answer and optional reference to this evaluator. I understand that one additional provider call may be billed.',
  evaluate:'Request an assessment',assessing:'Assessment in progress',assessment:'Model assessment',judgeFailed:'The assessment failed or could not be validated. No score is inferred from this failure.',unknownOutcome:'The assessment may have been interrupted. Its outcome or cost is unknown; it will not be sent again automatically.',
  factNote:'Facts and source contents have not been verified. Claims below are quotations selected for review, not proven errors.',strengths:'Observed strengths',weaknesses:'Observed limitations',referenceAlignment:'Alignment with your unverified reference',
  noJudge:'Connect a different model to request an independent assessment.',refresh:'Refresh reviews',recordedAt:'Recorded at',model:'Evaluator model',unavailable:'Unavailable',
  sameEvaluator:'Choose a different provider/model from the author of this answer.',limit:'The assessment limit has been reached or another assessment is active. Refresh before trying again.',
} as const;
export type EvaluationCopy={ [K in keyof typeof evaluationEnglish]:string };
export const evaluationArabic:EvaluationCopy={
  title:'افهم هذه النتيجة',checks:'فحوصك الآلية',checkScore:'الفحوص المحددة التي اجتازتها الإجابة',coverage:'الفحوص التي تم قياسها',
  basis:'تستخدم هذه الفحوص قواعدك المحفوظة. نسبتها ليست درجة عامة للجودة أو لصحة الحقائق.',
  passed:'اجتاز',failed:'لم يجتز',not_measured:'لم يُقس',reference:'مقارنة المرجع',
  referenceNote:'أنت من قدّم المرجع ولم يتم التحقق منه بشكل مستقل. تُقارن النصوص بعد توحيد يونيكود ونهايات الأسطر وحذف المسافات الخارجية.',
  literal_found:'ظهر النص المطلوب داخل الإجابة.',literal_missing:'لم يُعثر على النص المطلوب.',excluded_absent:'لم يظهر النص المستبعد.',excluded_present:'ظهر النص المستبعد داخل الإجابة.',exact_match:'تطابق الإجابة كاملة النص المطلوب تمامًا.',exact_difference:'تختلف الإجابة عن النص المطلوب.',valid_json:'الإجابة كاملة بصيغة JSON صالحة.',invalid_json:'الإجابة كاملة ليست بصيغة JSON صالحة.',invalid_check:'هذا الفحص غير مكتمل ولم يُقس.',attempt_incomplete:'لم تنتج المحاولة إجابة ناجحة مكتملة.',no_reference:'لم تُدخل إجابة مرجعية.',reference_match:'يطابق النص بعد التوحيد مرجعك.',reference_difference:'يختلف النص بعد التوحيد عن مرجعك.',
  evidence:'مقتطف من الإجابة',expected:'النص المتوقع',manual:'مراجعتك',manualNote:'هذه تقييماتك ومراجعتك للمصادر. لا تؤكد HESSARA بشكل مستقل صحة المصادر التي تدخلها.',
  relevance:'الصلة بالسؤال',instruction:'الالتزام بالتعليمات',completeness:'اكتمال الإجابة',visible_reasoning:'الشرح الظاهر في الإجابة',source_quality:'جودة المصادر',accuracy:'دقة الحقائق',
  rating:'تقييمك من ١ إلى ٥',rationale:'سبب هذا التقييم',notes:'ملاحظات المراجعة',save:'حفظ مراجعتي',remove:'حذف مراجعتي',saving:'جارٍ الحفظ…',saved:'حُفظت المراجعة',error:'تعذّر إكمال الإجراء. حدّث البيانات وراجع الحقول المدخلة.',
  claims:'مراجعة ادعاءات محددة',addClaim:'إضافة ادعاء',deleteClaim:'حذف الادعاء',claim:'نص الادعاء',claimStatus:'حالة التحقق بحسب مراجعتك',verified:'تحققت منه أنت',contradicted:'يتعارض مع مصدرك',unverified:'لم يُتحقق منه',opinion:'رأي أو استنتاج',sourceURL:'رابط المصدر',sourceTitle:'اسم المصدر',quote:'اقتباس مطابق من المصدر',claimReason:'اشرح أساس استنتاجك',
  sourceNote:'يلزم رابط مصدر واقتباس عند إثبات ادعاء أو تسجيل تعارض. يُحفظان بوصفهما مراجعتك، وليس تحققًا آليًا من الحقائق.',
  judge:'تقييم اختياري بواسطة نموذج',judgeNote:'يمكن لنموذج آخر مرتبط بحسابك تقييم الإجابة الظاهرة وشرح درجاته. هذا تقدير قابل للخطأ، ولا يتحقق من الحقائق أو يتصفح المصادر.',
  evaluator:'اختر المقيّم',choose:'اختر نموذجًا مرتبطًا',judgeConsent:'أوافق على إرسال السؤال والإجابة والمرجع الاختياري إلى هذا المقيّم. أفهم أنه قد تُحتسب تكلفة طلب إضافي لدى المزوّد.',
  evaluate:'طلب تقييم',assessing:'جارٍ إعداد التقييم',assessment:'تقييم النموذج',judgeFailed:'تعذّر التقييم أو لم يجتز التحقق من بنيته وأدلته. لا نستنتج درجة من هذا الفشل.',unknownOutcome:'قد يكون التقييم قد انقطع. نتيجته أو تكلفته غير معروفة ولن يُعاد إرساله تلقائيًا.',
  factNote:'لم يتم التحقق من الحقائق أو محتوى المصادر. الادعاءات التالية مقتطفات اختيرت للمراجعة وليست أخطاء مثبتة.',strengths:'نقاط القوة الملحوظة',weaknesses:'القيود الملحوظة',referenceAlignment:'التوافق مع مرجعك غير المتحقق منه',
  noJudge:'اربط نموذجًا مختلفًا لطلب تقييم مستقل.',refresh:'تحديث المراجعات',recordedAt:'وقت التسجيل',model:'نموذج التقييم',unavailable:'غير متوفر',
  sameEvaluator:'اختر مزوّدًا أو نموذجًا مختلفًا عن كاتب هذه الإجابة.',limit:'وصلت إلى حد التقييمات أو يوجد تقييم جارٍ. حدّث البيانات قبل المحاولة مجددًا.',
};
export const evaluationTranslations:Record<Locale,EvaluationCopy>={ar:evaluationArabic,en:evaluationEnglish,...evaluationExtraCopy};
export function evaluationCopy(locale:Locale):EvaluationCopy{return evaluationTranslations[locale];}
