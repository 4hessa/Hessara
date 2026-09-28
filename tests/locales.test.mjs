import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
test("13 complete dictionaries, one English-only brand name", () => {
  const languages = [
    "ar",
    "en",
    "fr",
    "es",
    "zh",
    "ko",
    "ur",
    "fa",
    "pt",
    "it",
    "ru",
    "de",
    "nl",
  ];
  const expected = Object.keys(
    JSON.parse(
      fs.readFileSync(
        new URL("../lib/locales/en.json", import.meta.url),
        "utf8",
      ),
    ),
  ).sort();
  for (const language of languages) {
    const data = JSON.parse(
      fs.readFileSync(
        new URL(`../lib/locales/${language}.json`, import.meta.url),
        "utf8",
      ),
    );
    assert.deepEqual(Object.keys(data).sort(), expected, language);
    assert.equal(data.brand, "Hessara");
    assert.ok(
      Object.values(data).every(
        (v) => typeof v === "string" && v.trim().length,
      ),
      language,
    );
  }
});
