import ar from "./locales/ar.json";
import en from "./locales/en.json";
import extra from "./locales/extra.json";
export const LANGUAGES = [
  ["ar", "العربية"],
  ["en", "English"],
  ["fr", "Français"],
  ["es", "Español"],
  ["zh", "简体中文"],
  ["ko", "한국어"],
  ["ur", "اردو"],
  ["fa", "فارسی"],
  ["pt", "Português"],
  ["it", "Italiano"],
  ["ru", "Русский"],
  ["de", "Deutsch"],
  ["nl", "Nederlands"],
] as const;
export type Locale = (typeof LANGUAGES)[number][0];
export const isRTL = (lang: Locale) => ["ar", "ur", "fa"].includes(lang);
export const dictionaries: Record<string, Record<string, string>> = {
  ar,
  en,
  ...extra,
};
export function translate(lang: Locale, key: string) {
  return dictionaries[lang]?.[key] ?? en[key as keyof typeof en] ?? key;
}
