import { createHash } from "node:crypto";
import { classifyArchiveNames } from "./format-policy.ts";

export class ArtifactError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) { super(code); this.code = code; this.status = status; this.name = "ArtifactError"; }
}
export const CONTENT_LIMITS = { files: 10000, expandedBytes: 256 * 1024 * 1024, ratio: 100, textBytes: 8 * 1024 * 1024 } as const;
export type VerifiedFormat = "elf" | "pe" | "macho" | "apk" | "dex" | "jar" | "aab" | "zip" | "asar" | "javascript";
const invalid = () => { throw new ArtifactError("CORRUPT_ARTIFACT"); };
function safePath(path: string) {
  if (!path || path.length > 1024 || /[\x00-\x1f\\:]/.test(path) || path.startsWith("/") || path.split("/").some(s => s === ".." || s === ".")) throw new ArtifactError("UNSAFE_ARCHIVE");
}
/** Inspect directory records only. Never extract or execute an archive in the API. */
export function inspectZip(bytes: Uint8Array) {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50 && i + 22 + b.readUInt16LE(i + 20) === b.length) { end = i; break; }
  }
  if (end < 0) invalid();
  const count = b.readUInt16LE(end + 10), start = b.readUInt32LE(end + 16), directorySize = b.readUInt32LE(end + 12);
  if (b.readUInt16LE(end + 4) || b.readUInt16LE(end + 6) || count !== b.readUInt16LE(end + 8) || count === 0xffff || start === 0xffffffff || start + directorySize !== end) throw new ArtifactError("UNSUPPORTED_ARCHIVE");
  if (!count || count > CONTENT_LIMITS.files) throw new ArtifactError("ARCHIVE_LIMIT");
  let cursor = start, expanded = 0;
  const names = new Set<string>();
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || b.readUInt32LE(cursor) !== 0x02014b50) invalid();
    const flags = b.readUInt16LE(cursor + 8), method = b.readUInt16LE(cursor + 10), compressed = b.readUInt32LE(cursor + 20), size = b.readUInt32LE(cursor + 24);
    const nameLength = b.readUInt16LE(cursor + 28), extra = b.readUInt16LE(cursor + 30), comment = b.readUInt16LE(cursor + 32), local = b.readUInt32LE(cursor + 42);
    if (flags & 1 || ![0, 8].includes(method)) throw new ArtifactError("UNSUPPORTED_ARCHIVE");
    if (cursor + 46 + nameLength + extra + comment > end || local + 30 > start || b.readUInt32LE(local) !== 0x04034b50) invalid();
    let name: string;
    try { name = new TextDecoder("utf-8", { fatal: true }).decode(b.subarray(cursor + 46, cursor + 46 + nameLength)); } catch { throw new ArtifactError("UNSUPPORTED_ARCHIVE"); }
    safePath(name);
    if (names.has(name) || (b.readUInt32LE(cursor + 38) >>> 16 & 0xf000) === 0xa000) throw new ArtifactError("UNSAFE_ARCHIVE");
    names.add(name);
    const localNameLength = b.readUInt16LE(local + 26), localExtra = b.readUInt16LE(local + 28), data = local + 30 + localNameLength + localExtra;
    if (localNameLength !== nameLength || !b.subarray(local + 30, local + 30 + localNameLength).equals(b.subarray(cursor + 46, cursor + 46 + nameLength)) || data + compressed > start) invalid();
    ranges.push([local, data + compressed]);
    expanded += size;
    if (size === 0xffffffff || expanded > CONTENT_LIMITS.expandedBytes || size > Math.max(1, compressed) * CONTENT_LIMITS.ratio) throw new ArtifactError("ARCHIVE_LIMIT");
    cursor += 46 + nameLength + extra + comment;
  }
  if (cursor !== end) invalid();
  ranges.sort((a, z) => a[0] - z[0]);
  if (ranges.some((range, i) => i > 0 && range[0] < ranges[i - 1][1])) throw new ArtifactError("UNSAFE_ARCHIVE");
  return { names, count, expandedBytes: expanded };
}
export function inspectArtifact(bytes: Uint8Array, name: string): { format: VerifiedFormat; sha256: string; metadata: Record<string, unknown> } {
  if (bytes.byteLength < 4) invalid();
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), magic = b.subarray(0, 4).toString("hex");
  let format: VerifiedFormat;
  const metadata: Record<string, unknown> = { inspectedBytes: b.length, validation: "container-header", executableStarted: false };
  if (magic === "7f454c46") {
    if (b.length < 52 || ![1, 2].includes(b[4]) || ![1, 2].includes(b[5]) || b[6] !== 1 || b[4] === 2 && b.length < 64) invalid();
    format = "elf"; metadata.bits = b[4] === 2 ? 64 : 32;
  } else if (b[0] === 0x4d && b[1] === 0x5a) {
    if (b.length < 64) invalid();
    const offset = b.readUInt32LE(60);
    if (offset < 64 || offset + 24 > b.length || b.readUInt32LE(offset) !== 0x4550) invalid();
    format = "pe";
  } else if (["feedface", "cefaedfe", "feedfacf", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca"].includes(magic)) {
    if (b.length < 32) invalid();
    // CAFEBABE is also a Java class; reject ambiguity rather than misroute it.
    if (magic === "cafebabe" && b.readUInt32BE(4) > 64) throw new ArtifactError("UNSUPPORTED_FORMAT");
    format = "macho";
  } else if (b.subarray(0, 4).toString("ascii") === "dex\n") {
    if (b.length < 112 || !/^dex\n\d{3}\x00$/.test(b.subarray(0, 8).toString("ascii")) || b.readUInt32LE(32) !== b.length || b.readUInt32LE(36) !== 112) invalid();
    format = "dex";
  } else if (magic === "504b0304") {
    const zip = inspectZip(b);
    format = classifyArchiveNames(zip.names);
    metadata.files = zip.count; metadata.expandedBytes = zip.expandedBytes;
  } else if (b.length >= 16 && b.readUInt32LE(0) === 4) {
    const headerSize = b.readUInt32LE(4), jsonSize = b.readUInt32LE(12);
    if (jsonSize < 2 || jsonSize > 1024 * 1024 || headerSize < jsonSize + 8 || headerSize + 8 > b.length || 16 + jsonSize > b.length) invalid();
    let header: unknown;
    try { header = JSON.parse(b.subarray(16, 16 + jsonSize).toString("utf8")); } catch { invalid(); }
    let files = 0;
    function walk(value: unknown, prefix = "", depth = 0) {
      if (depth > 32 || !value || typeof value !== "object" || Array.isArray(value)) invalid();
      for (const [part, node] of Object.entries(value as Record<string, unknown>)) {
        safePath(prefix + part); if (++files > CONTENT_LIMITS.files) throw new ArtifactError("ARCHIVE_LIMIT");
        if (!node || typeof node !== "object" || Array.isArray(node)) invalid();
        const record = node as Record<string, unknown>;
        if (record.link || record.unpacked) throw new ArtifactError("UNSAFE_ARCHIVE");
        if (record.files) walk(record.files, prefix + part + "/", depth + 1);
        else {
          const offset = Number(record.offset), size = Number(record.size);
          if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size < 0 || offset + size > b.length - headerSize - 8) invalid();
        }
      }
    }
    walk((header as Record<string, unknown>)?.files); format = "asar"; metadata.files = files;
  } else if (/\.(?:js|mjs|cjs)$/i.test(name)) {
    if (b.length > CONTENT_LIMITS.textBytes) throw new ArtifactError("TEXT_LIMIT");
    let source: string;
    try { source = new TextDecoder("utf-8", { fatal: true }).decode(b); } catch { throw new ArtifactError("UNSUPPORTED_FORMAT"); }
    if (!source.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(source)) throw new ArtifactError("UNSUPPORTED_FORMAT");
    format = "javascript"; metadata.validation = "utf8-text only; standalone JavaScript analysis is unsupported";
    metadata.analysisSupported = false; metadata.analysisRequirement = "REA requires a ZIP with root package.json and source files, or a supported ASAR.";
  } else throw new ArtifactError("UNSUPPORTED_FORMAT");
  return { format, sha256: createHash("sha256").update(b).digest("hex"), metadata };
}

export async function boundedBytes(response: Response, limit: number) {
  if (!response.ok || !response.body) { void response.body?.cancel().catch(() => {}); throw new ArtifactError("STORAGE_UNAVAILABLE", 503); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) throw new ArtifactError("ARTIFACT_TOO_LARGE", 413);
      chunks.push(value);
    }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return bytes;
}
