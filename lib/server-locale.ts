import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE, type Locale } from "./i18n";

export async function serverLocale(preferred?: string): Promise<Locale> {
  if (isLocale(preferred)) return preferred;
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(saved) ? saved : "ar";
}
