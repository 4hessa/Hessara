"use client";
import { useState } from "react";
import { ArrowUpRight, KeyRound, LoaderCircle } from "lucide-react";
import { NVIDIA_MODELS } from "@/lib/nvidia";
import type { Model } from "@/lib/benchmarks";
import type { Locale } from "@/lib/i18n";

export function NvidiaStart({
  locale,
  onLinked,
}: {
  locale: Locale;
  onLinked: (ids: string[], models: Model[]) => void;
}) {
  const ar = locale === "ar";
  const [selected, setSelected] = useState<string[]>(
    NVIDIA_MODELS.map((m) => m.id),
  );
  const [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/catalog/nvidia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selected, apiKey: key }),
      });
      const data = (await response.json()) as {
        error?: string;
        ids: string[];
        models: Model[];
      };
      if (!response.ok) throw new Error(data.error ?? "UNAVAILABLE");
      setKey("");
      onLinked(data.ids, data.models);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const errors: Record<string, string> = ar
    ? {
        AUTH_REQUIRED: "سجّل الدخول أولًا لحفظ الربط والتجارب في حسابك.",
        PROVIDER_AUTH:
          "لم تقبل إنفيديا المفتاح. تحقّق من صلاحيته وإتاحة النموذج في حسابك.",
        PROVIDER_QUOTA:
          "وصل حسابك إلى حد الاستخدام لدى إنفيديا. انتظر تجدد الحصة ثم حاول مجددًا.",
        PROVIDER_UNAVAILABLE:
          "لم يكتمل التحقق من الاتصال. راجع حالة الطلب في حساب إنفيديا قبل المحاولة مجددًا.",
        NOT_READY:
          "تغيّرت إتاحة أحد النماذج المحددة لدى إنفيديا. اختر نموذجًا آخر.",
        VAULT: "خدمة حفظ المفاتيح غير متاحة مؤقتًا.",
        LIMIT: "وصلت إلى الحد الأقصى لروابط النماذج في حسابك.",
      }
    : {
        AUTH_REQUIRED: "Sign in to save connections and experiments.",
        PROVIDER_AUTH:
          "NVIDIA rejected this key. Check its validity and model access.",
        PROVIDER_QUOTA:
          "Your NVIDIA usage limit was reached. Wait for your quota to reset.",
        PROVIDER_UNAVAILABLE:
          "Connection verification did not complete. Check your NVIDIA account before retrying.",
        NOT_READY:
          "A selected model is no longer available. Choose another model.",
      };
  return (
    <section className="nvidia-start" aria-labelledby="nvidia-title">
      <div className="nvidia-story">
        <span className="eyebrow">
          {ar ? "نماذج فعلية · مفتاح واحد" : "REAL MODELS · ONE KEY"}
        </span>
        <h2 id="nvidia-title">
          {ar ? "ابدأ التقييم مع إنفيديا." : "Start evaluating with NVIDIA."}
        </h2>
        <p>
          {ar
            ? "أربعة نماذج متاحة للتقييم المجاني عبر حسابك لدى إنفيديا. اربطها، واختر مهامك، ثم قارن النتائج الفعلية."
            : "Four models with free evaluation access through your NVIDIA account. Connect, choose tasks, and compare real results."}
        </p>
        <a
          className="text-link"
          href="https://build.nvidia.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          {ar ? "إنشاء مفتاح من موقع إنفيديا" : "Get a key from NVIDIA"}
          <ArrowUpRight size={17} />
        </a>
        <p className="form-help">
          {ar
            ? "الإتاحة المجانية مخصصة للتجربة والبحث والتقييم، وتخضع لحصص المزود وشروطه. ليست خدمة غير محدودة. آخر تحقق من الإتاحة: ٢٧ سبتمبر ٢٠٢٦."
            : "Free access is for prototyping, research and evaluation, subject to provider quotas and terms. Availability checked September 27, 2026."}
        </p>
        <a
          className="text-link"
          href="https://docs.api.nvidia.com/nim/docs/product"
          target="_blank"
          rel="noopener noreferrer"
        >
          {ar
            ? "شروط الإتاحة وحدود الاستخدام"
            : "Access terms and usage limits"}
          <ArrowUpRight size={15} />
        </a>
      </div>
      <form className="nvidia-connect" onSubmit={connect}>
        <fieldset disabled={busy}>
          <legend>
            {ar
              ? "اختر النماذج التي تريد مقارنتها"
              : "Choose models to compare"}
          </legend>
          {NVIDIA_MODELS.map((m) => (
            <div className="nvidia-model" key={m.id}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(m.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, m.id]
                        : selected.filter((id) => id !== m.id),
                    )
                  }
                />
                <span>{ar ? m.name : m.id.split("/")[1]}</span>
              </label>
              <a
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={(ar ? "صفحة النموذج: " : "Model page: ") + m.name}
              >
                <ArrowUpRight size={17} />
              </a>
            </div>
          ))}
        </fieldset>
        <label className="field" htmlFor="nvidia-key">
          <span>
            <KeyRound size={15} />{" "}
            {ar ? "مفتاح الاتصال الخاص بك" : "Your API key"}
          </span>
          <input
            id="nvidia-key"
            type="password"
            dir="ltr"
            autoComplete="off"
            value={key}
            maxLength={4096}
            disabled={busy}
            onChange={(e) => setKey(e.target.value)}
            required
            minLength={10}
          />
        </label>
        <p className="form-help">
          {ar
            ? "يُحفظ المفتاح مشفّرًا. يرسل زر الربط طلب تحقق واحدًا إلى إنفيديا، ثم تختار الاختبارات قبل تشغيلها. تُرسل نصوص الاختبارات إلى المزود عند التنفيذ."
            : "Your key is encrypted. Connecting sends one verification request to NVIDIA. You choose and start tests separately; test prompts are sent to the provider."}
        </p>
        {error && (
          <div className="notice error" role="alert">
            {errors[error] ??
              (ar
                ? "تعذّر إكمال الربط. تحقّق من الاتصال وحاول مجددًا."
                : "Connection failed. Please try again.")}
            {error === "AUTH_REQUIRED" && (
              <a href="/signin?next=/" target="_top">
                {ar ? "تسجيل الدخول" : "Sign in"}
              </a>
            )}
          </div>
        )}
        <button
          type="submit"
          className="primary full"
          disabled={busy || !selected.length || key.trim().length < 10}
        >
          {busy && <LoaderCircle className="loading-spin" size={17} />}{" "}
          {busy
            ? ar
              ? "جارٍ التحقق والربط…"
              : "Verifying connection…"
            : ar
              ? "تحقّق واربط النماذج"
              : "Verify and connect models"}
        </button>
      </form>
    </section>
  );
}
