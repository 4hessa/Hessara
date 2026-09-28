import fs from "node:fs";
const path = new URL("../lib/catalog/models.json", import.meta.url);
const existing = JSON.parse(fs.readFileSync(path, "utf8"));
const response = await fetch("https://openrouter.ai/api/v1/models", {
  signal: AbortSignal.timeout(30000),
});
if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
const { data } = await response.json();
const missing = existing.filter((m) => !data.some((x) => x.id === m.id));
if (missing.length)
  throw new Error(
    "Review delisted models before updating: " +
      missing.map((m) => m.id).join(", "),
  );
const updated = existing.map((m) => {
  const x = data.find((x) => x.id === m.id);
  return {
    ...m,
    context: x.context_length,
    inputPrice: Number(x.pricing.prompt) * 1e6,
    outputPrice: Number(x.pricing.completion) * 1e6,
    inputModalities: x.architecture.input_modalities,
    reasoning: x.supported_parameters.includes("reasoning"),
    tools: x.supported_parameters.includes("tools"),
    checkedAt: new Date().toISOString().slice(0, 10),
  };
});
fs.writeFileSync(path, JSON.stringify(updated, null, 2) + "\n");
console.log(
  "Updated " +
    updated.length +
    " model specifications. Review the diff before publishing.",
);
