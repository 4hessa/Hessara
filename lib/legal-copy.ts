import type { Locale } from "./i18n";
const labels: Record<Locale, [string, string]> = {
  ar: ["الخصوصية", "شروط الاستخدام"], en: ["Privacy", "Terms of use"],
  fr: ["Confidentialité", "Conditions d’utilisation"], es: ["Privacidad", "Condiciones de uso"],
  zh: ["隐私政策", "使用条款"], ko: ["개인정보 처리방침", "이용약관"],
  ur: ["رازداری", "استعمال کی شرائط"], fa: ["حریم خصوصی", "شرایط استفاده"],
  pt: ["Privacidade", "Termos de uso"], it: ["Privacy", "Condizioni d’uso"],
  ru: ["Конфиденциальность", "Условия использования"], de: ["Datenschutz", "Nutzungsbedingungen"],
  nl: ["Privacy", "Gebruiksvoorwaarden"],
};
export function legalCopy(locale: Locale) { const [privacy, terms] = labels[locale]; return { privacy, terms }; }
