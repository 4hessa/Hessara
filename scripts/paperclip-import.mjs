// Import an explicitly downloaded Hessara review draft. Never reads model keys.
import fs from "node:fs";
const file = process.argv[2];
const { PAPERCLIP_BASE_URL, PAPERCLIP_COMPANY_ID, PAPERCLIP_API_KEY } =
  process.env;
if (!file || !PAPERCLIP_BASE_URL || !PAPERCLIP_COMPANY_ID)
  throw new Error(
    "Usage: set PAPERCLIP_BASE_URL, PAPERCLIP_COMPANY_ID and PAPERCLIP_API_KEY; then node scripts/paperclip-import.mjs hessara-paperclip-issue.json",
  );
const base = new URL(PAPERCLIP_BASE_URL);
const local = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
if (
  base.username ||
  base.password ||
  base.search ||
  base.hash ||
  !(base.protocol === "https:" || (local && base.protocol === "http:"))
)
  throw new Error(
    "Use HTTPS, or HTTP for your own loopback Paperclip instance.",
  );
if (!local && !PAPERCLIP_API_KEY)
  throw new Error("An API key is required for remote Paperclip.");
const input = JSON.parse(fs.readFileSync(file, "utf8"));
if (
  typeof input.title !== "string" ||
  typeof input.description !== "string" ||
  input.title.length > 180 ||
  input.description.length > 60000
)
  throw new Error("Invalid Hessara issue draft.");
const response = await fetch(
  new URL(
    `/api/companies/${encodeURIComponent(PAPERCLIP_COMPANY_ID)}/issues`,
    base,
  ),
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(PAPERCLIP_API_KEY
        ? { Authorization: `Bearer ${PAPERCLIP_API_KEY}` }
        : {}),
    },
    body: JSON.stringify({
      title: input.title,
      description: input.description,
      status: "backlog",
      priority: "medium",
    }),
    signal: AbortSignal.timeout(25000),
    redirect: "error",
  },
);
if (!response.ok)
  throw new Error(
    `Paperclip returned HTTP ${response.status}. Check the instance before retrying to avoid duplicate issues.`,
  );
const issue = await response.json();
console.log(`Created review draft: ${issue.identifier || issue.id}`);
