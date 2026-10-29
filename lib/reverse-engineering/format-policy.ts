/** Keep this order/predicate in sync with common.classify_archive_names.
 * Both implementations consume tests/fixtures/reverse-format-cases.json.
 * A ZIP extension alone never establishes an Android or Java artifact format.
 */
export function classifyArchiveNames(entries: Iterable<string>): "apk" | "aab" | "jar" | "zip" {
  const names = new Set(entries);
  if (names.has("AndroidManifest.xml") && [...names].some(name => /^classes\d*\.dex$/.test(name))) return "apk";
  if (names.has("base/manifest/AndroidManifest.xml") && names.has("BundleConfig.pb")) return "aab";
  if (names.has("META-INF/MANIFEST.MF") && [...names].some(name => name.endsWith(".class"))) return "jar";
  return "zip";
}
