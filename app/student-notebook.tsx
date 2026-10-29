"use client";
import { studentLanguage } from "@/lib/student-locales";

import { useId, useRef, useState } from "react";
import { ArrowUpRight, BookOpen, Check, Copy } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import "./student-notebook.css";

const studyModes = [
  { id: "summary", ar: "فهم الدرس", en: "Understand a lesson" },
  { id: "quiz", ar: "اختبار قصير", en: "Practice quiz" },
  { id: "cards", ar: "بطاقات مراجعة", en: "Flashcards" },
  { id: "plan", ar: "خطة مذاكرة", en: "Study plan" },
] as const;
type StudyMode = (typeof studyModes)[number]["id"];

export function StudentNotebook({ locale }: { locale: Locale }) {
  const c = studentLanguage(locale);
  const id = useId();
  const promptField = useRef<HTMLTextAreaElement>(null);
  const [topic, setTopic] = useState("");
  const [mode, setMode] = useState<StudyMode>("summary");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");
  const instructions: Record<StudyMode, [string, string]> = {
    summary: [
      "اشرح الفكرة بلغة بسيطة، ثم لخص أهم المفاهيم، وأضف مثالًا من المصادر لكل مفهوم متى توفر. اختم بثلاثة أسئلة تساعدني على التأكد من فهمي.",
      "Explain the topic simply, summarize the key concepts, and include an example from the sources when available. End with three questions to check my understanding.",
    ],
    quiz: [
      "أعد اختبارًا من خمسة أسئلة متنوعة ومتدرجة الصعوبة. ضع الإجابات وشروحها في قسم منفصل بعد الأسئلة حتى أستطيع اختبار نفسي أولًا.",
      "Create five varied questions of increasing difficulty. Put answers and explanations in a separate section after the questions so I can test myself first.",
    ],
    cards: [
      "أنشئ عشر بطاقات مراجعة. اجعل وجه كل بطاقة سؤالًا محددًا وظهرها إجابة قصيرة. ركز على المفاهيم الأساسية والفروق التي يسهل الخلط بينها.",
      "Create ten flashcards, with a specific question on each front and a concise answer on the back. Focus on core concepts and distinctions that are easy to confuse.",
    ],
    plan: [
      "رتب الموضوع إلى ثلاث جلسات مذاكرة تبدأ بالفهم، ثم التدريب، ثم المراجعة. حدد هدفًا ومهمة عملية وأسئلة مراجعة لكل جلسة، واربطها بالمصادر المتاحة.",
      "Organize the topic into three sessions: understanding, practice, and review. Give each session a goal, a practical task, and review questions linked to the available sources.",
    ],
  };
  const prompt = [
    c("أريد أن أدرس: ", "I want to study: ") + (topic.trim() || c("الموضوع الوارد في المصادر المرفقة", "the topic in my attached sources")),
    c(...instructions[mode]),
    c(
      "اعتمد على المصادر التي أضفتها إلى هذا الدفتر، وأشر إلى موضع المعلومات فيها. إذا كانت معلومة غير موجودة، وضح ذلك دون تخمين. استخدم العربية الواضحة وساعدني على التعلم خطوة بخطوة.",
      "Use the sources I added to this notebook and cite where the information comes from. If information is missing, say so without guessing. Use clear language and help me learn step by step.",
    ),
  ].join("\n\n");

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyState("copied");
    } catch {
      promptField.current?.focus();
      promptField.current?.select();
      setCopyState("manual");
    }
  }

  return (
    <section className="student-notebook" aria-labelledby={`${id}-title`} lang={locale}>
      <div className="student-notebook__intro">
        <div className="student-notebook__eyebrow"><BookOpen size={20} strokeWidth={1.5} aria-hidden="true" />{c("مساحة للطلاب", "FOR STUDENTS")}</div>
        <h3 id={`${id}-title`}>{c("من محاضرات كثيرة، إلى فهم أوضح", "From scattered notes to clearer understanding")}</h3>
        <p className="student-notebook__name">{c("دفتر جيمناي", "Gemini Notebook")} <span dir="ltr" lang="en">· NotebookLM</span></p>
        <p>{c("اجمع مصادر دراستك في دفتر واحد، واسأل عنها، وأنشئ ملخصات وبطاقات واختبارات تساعدك على المراجعة.", "Bring your study sources together, ask questions, and create summaries, flashcards, and quizzes to help you review.")}</p>
        <ol className="student-notebook__steps">
          <li><span>{c("١", "1")}</span>{c("افتح الخدمة وسجّل الدخول بحسابك في جوجل.", "Open the service and sign in with your Google account.")}</li>
          <li><span>{c("٢", "2")}</span>{c("أنشئ دفترًا وأضف محاضراتك أو ملفاتك ومصادرك.", "Create a notebook and add your lecture notes, files, or sources.")}</li>
          <li><span>{c("٣", "3")}</span>{c("انسخ الطلب من هنا والصقه في الدفتر. وللبطاقات والاختبارات، استخدم قسم الاستوديو.", "Copy your prompt here and paste it into the notebook. For flashcards and quizzes, use its Studio panel.")}</li>
        </ol>
        <a className="student-notebook__open" href="https://notebook.google.com/" target="_blank" rel="noopener noreferrer">
          {c("افتح دفتر جيمناي", "Open Gemini Notebook")}<ArrowUpRight size={17} aria-hidden="true" />
          <span className="sr-only">{c(" — يفتح في تبويب جديد", " — opens in a new tab")}</span>
        </a>
        <a className="student-notebook__guide" href="https://support.google.com/gemininotebook/answer/16164461" target="_blank" rel="noopener noreferrer">{c("دليل جوجل الرسمي ومتطلبات الوصول", "Google's official guide and access requirements")}</a>
      </div>
      <div className="student-notebook__workspace">
        <div className="student-notebook__workspace-heading"><h4>{c("جهّز طلب المذاكرة هنا", "Prepare your study prompt")}</h4><span>{c("على جهازك فقط", "LOCAL ONLY")}</span></div>
        <label htmlFor={`${id}-topic`}>{c("ما الموضوع الذي تراجعه؟", "What are you studying?")}</label>
        <textarea id={`${id}-topic`} rows={2} maxLength={500} value={topic} placeholder={c("مثلًا: قوانين الحركة في الفيزياء، أو مقدمة في البرمجة", "For example: laws of motion or an introduction to programming")} onChange={(event) => { setTopic(event.target.value); setCopyState("idle"); }} />
        <fieldset className="student-notebook__modes">
          <legend>{c("اختر ما يساعدك", "Choose your study activity")}</legend>
          <div>{studyModes.map((item) => <button key={item.id} type="button" aria-pressed={mode === item.id} onClick={() => { setMode(item.id); setCopyState("idle"); }}>{c(item.ar, item.en)}</button>)}</div>
        </fieldset>
        <label htmlFor={`${id}-prompt`}>{c("طلبك الجاهز للنسخ", "Your ready-to-copy prompt")}</label>
        <textarea ref={promptField} id={`${id}-prompt`} className="student-notebook__prompt" value={prompt} readOnly rows={7} />
        <div className="student-notebook__copy-row">
          <button type="button" className="student-notebook__copy" onClick={copyPrompt}>{copyState === "copied" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{c("انسخ طلب المذاكرة", "Copy study prompt")}</button>
          <span role="status">{copyState === "copied" ? c("تم النسخ", "Copied") : copyState === "manual" ? c("تم تحديد النص؛ انسخه يدويًا.", "Text selected. Copy it manually.") : ""}</span>
        </div>
        <p className="student-notebook__privacy">{c("يُرتّب هذا النموذج طلبك محليًا دون إرساله أو حفظه. ترفع ملفاتك وتستخدم الذكاء الاصطناعي في خدمة جوجل نفسها؛ راجع الإجابات ومراجعها أثناء المذاكرة.", "This form prepares your prompt locally without sending or saving it. Upload your files and use AI in Google's own service; check its answers and citations as you study.")}</p>
      </div>
    </section>
  );
}
