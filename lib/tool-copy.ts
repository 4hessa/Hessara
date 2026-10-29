import type { Locale } from './i18n';
import { toolDescriptionLocales, toolDescriptionTranslationsById } from './tool-description-locales';
import { toolDescriptionMiddleById } from './tool-description-middle-locales';
import { toolDescriptionTailById } from './tool-description-tail-locales';
import { toolDescriptionExtraById } from './tool-description-extra-locales';

export const toolDescriptions = {
  ...toolDescriptionTranslationsById,
  ...toolDescriptionMiddleById,
  ...toolDescriptionTailById,
  ...toolDescriptionExtraById,
};
export function toolDescription(tool: { id: string; summaryAr: string; summaryEn: string }, locale: Locale) {
  if (locale === 'ar') return tool.summaryAr;
  if (locale === 'en') return tool.summaryEn;
  return toolDescriptions[tool.id][toolDescriptionLocales.indexOf(locale)];
}
