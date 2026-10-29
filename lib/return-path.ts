export function safeReturnPath(value: string | null | undefined) {
  if (!value?.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value)) return "/";
  const parsed = new URL(value, "https://hessara.invalid");
  if (parsed.origin !== "https://hessara.invalid" || /^\/(auth|signin|signout)(\/|$|-)/.test(parsed.pathname)) return "/";
  return parsed.pathname + parsed.search + parsed.hash;
}
