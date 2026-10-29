import Link from "next/link";
import { BrandLockup } from "./brand-mark";
import "./legal-document.css";

const contact = "hessa.alzahrani.sa@gmail.com";
const documents = {
  ar: {
    privacy: {
      title: "سياسة الخصوصية",
      intro: "هيسارا منصة لفهم احتياجات المستخدم وتجربة نماذج الذكاء الاصطناعي ومقارنة نتائجها.",
      sections: [
        ["الحساب وتسجيل الدخول", "عند اختيار تسجيل الدخول عبر Google، تعالج خدمة Supabase معرّف الحساب والبريد والاسم وصورة الملف العامة التي يتيحها Google، لإنشاء حساب هيسارا أو ربطه بجلسة الضيف. لا يطلب هذا الربط الوصول إلى Gmail أو Drive أو جهات الاتصال، ولا يوفّر اشتراكًا في نماذج الذكاء الاصطناعي."],
        ["المحتوى المحفوظ والخدمات المستخدمة", "قد تتضمن مساحة حسابك الأسئلة والإجابات وإعدادات الاختبارات ونتائجها وتواريخها وتفضيلات تختار حفظها. عند تشغيل نموذج، تُرسل المهمة والسياق اللازم إلى مزوّد النموذج المختار. يعالج كل مزوّد البيانات وفق سياساته. تشغيل النماذج المجانية الحالي يستخدم Cloudflare Workers AI. تستضيف Vercel التطبيق وتوفّر Supabase خدمات الحسابات والبيانات."],
        ["الأمان والتشغيل", "تستخدم المنصة ملفات ارتباط للجلسة وإكمال تسجيل الدخول، وتخزينًا محليًا لتفضيلات الواجهة. تُستخدم بيانات تشغيلية وحدود طلبات لمراقبة الخدمة ومنع إساءة الاستخدام. تُحفظ مفاتيح النماذج التي يضيفها المستخدم مشفّرة على الخادم. لا تطلب المنصة كلمة مرور حساب Google."],
        ["التحكم والاحتفاظ بالبيانات", "نشر تقارير التجارب يتم باختيار المستخدم. يمكنك إلغاء وصول هيسارا من إعدادات حساب Google، وتصدير النتائج أو حذف العناصر التي توفّر الواجهة حذفها. لطلب حذف الحساب أو بيانات أخرى، تواصل مع عنوان الدعم أدناه. لا توجد حاليًا مدة حذف آلي موحّدة معلنة لجميع البيانات؛ وقد تكون السجلات والنسخ الاحتياطية خاضعة لسياسات مزوّدي الخدمة. جلسة الضيف مرتبطة بالمتصفح وقد تفقد إمكانية الوصول إليها عند محو بياناته."],
      ],
    },
    terms: {
      title: "شروط الاستخدام",
      intro: "تقدّم هيسارا أدوات لفهم المهام ومقارنة النماذج وتشغيل الاختبارات.",
      sections: [
        ["فهم النتائج", "النتائج والتوصيات تقديرات مرتبطة بالمهمة وإصدار النموذج ووقت الاختبار، وقد تتضمن أخطاء. يجب مراجعة النتائج قبل الاعتماد عليها."],
        ["استخدام المنصة والمزوّدين", "استخدم المنصة ومزوّدي النماذج وفق شروطهم، ومع المحتوى والحسابات التي تملك حق استخدامها. أنت مسؤول عن الطلبات التي تختار تشغيلها أو مشاركتها. لا يمنح تسجيل الدخول عبر Google أو مزوّد اجتماعي اشتراكًا لدى Claude أو ChatGPT أو غيرهما."],
        ["التوافر والحصص", "قد تعتمد بعض الوظائف على إعدادات حسابات خارجية أو رصيد أو حصص استخدام. تظهر الطرق غير المجهّزة على أنها غير متاحة. الحصص المجانية محدودة ويمكن أن تتوقف عند بلوغ الحد؛ لا تعني إتاحة نموذج ضمان بقائه متاحًا دائمًا. لا تبدأ المنصة عملية شراء اشتراك خارجي لمجرد تسجيل الدخول."],
      ],
    },
    updated: "آخر تحديث: 16 أكتوبر 2026", back: "العودة إلى المنصة", contact: "للتواصل بشأن البيانات والحسابات واستخدام المنصة", other: "English", privacyLabel: "سياسة الخصوصية", termsLabel: "شروط الاستخدام",
  },
  en: {
    privacy: {
      title: "Privacy policy",
      intro: "HESSARA helps users understand their needs, test AI models and compare their results.",
      sections: [
        ["Accounts and sign-in", "When you choose Google sign-in, Supabase processes the account identifier, email address, name and public profile picture provided by Google to create your HESSARA account or link your guest session. This connection does not request access to Gmail, Drive or contacts and does not provide an AI model subscription."],
        ["Saved content and service providers", "Your workspace may contain questions, answers, test settings, results, dates and preferences you choose to save. Running a model sends the task and necessary context to the selected model provider, which processes data under its own policies. The currently available free models use Cloudflare Workers AI. Vercel hosts the application; Supabase provides account and database services."],
        ["Security and operation", "HESSARA uses cookies for sessions and sign-in completion, and local storage for interface preferences. Operational data and request limits support service monitoring and abuse prevention. Model keys added by users are stored encrypted on the server. HESSARA does not ask for your Google account password."],
        ["Control and retention", "Publishing experiment reports requires your choice. You can revoke HESSARA access in your Google account, export results, and delete items where the interface provides deletion. Contact support below to request account or other data deletion. No single automatic deletion period is currently published for all data; logs and backups may be subject to service providers’ policies. Guest access is associated with your browser and may be lost when its data is cleared."],
      ],
    },
    terms: {
      title: "Terms of use",
      intro: "HESSARA provides tools for understanding tasks, comparing models and running tests.",
      sections: [
        ["Understanding results", "Results and recommendations are estimates tied to the task, model version and test date. They may contain errors. Review results before relying on them."],
        ["Using HESSARA and model providers", "Use HESSARA and model providers under their terms, with content and accounts you are entitled to use. You are responsible for requests you choose to run or share. Google or social sign-in does not grant a Claude, ChatGPT or other model subscription."],
        ["Availability and quotas", "Some features depend on external account configuration, credit or usage quotas. Unconfigured methods are shown as unavailable. Free quotas are limited and may stop when exhausted; a model being available does not guarantee continued availability. Signing in alone does not initiate an external subscription purchase."],
      ],
    },
    updated: "Last updated: 16 October 2026", back: "Back to HESSARA", contact: "Contact for data, accounts and platform use", other: "العربية", privacyLabel: "Privacy policy", termsLabel: "Terms of use",
  },
};

export function LegalDocument({ kind, language }: { kind: "privacy" | "terms"; language: "ar" | "en" }) {
  const copy = documents[language], document = copy[kind];
  return <main className="legal-page" lang={language} dir={language === "ar" ? "rtl" : "ltr"}>
    <article className="legal-paper">
      <header><Link className="legal-brand" href="/" aria-label="HESSARA"><BrandLockup /></Link><Link href={`/${kind}?lang=${language === "ar" ? "en" : "ar"}`} hrefLang={language === "ar" ? "en" : "ar"}>{copy.other}</Link></header>
      <h1>{document.title}</h1><p className="legal-updated">{copy.updated}</p><p>{document.intro}</p>
      {document.sections.map(([title, body]) => <section key={title}><h2>{title}</h2><p>{body}</p></section>)}
      <p>{copy.contact}: <a href={`mailto:${contact}`} dir="ltr">{contact}</a>.</p>
      <nav aria-label={language === "ar" ? "روابط المنصة" : "Platform links"}><Link href="/">{copy.back}</Link><Link href={`/privacy?lang=${language}`}>{copy.privacyLabel}</Link><Link href={`/terms?lang=${language}`}>{copy.termsLabel}</Link></nav>
    </article>
  </main>;
}
