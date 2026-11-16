// Shared by the market scripts: reading plugin zips, checking manifests and
// catalog entries the way the Vespera panel does, and fetching packages.
import { createHash } from "node:crypto";
import fs from "node:fs";
import { inflateRawSync } from "node:zlib";

export const CATALOG = new URL("../v1.json", import.meta.url);
export const SCHEMA = 1;
export const MANIFEST = "vespera-plugin.json";
export const PERMISSIONS = ["nodes", "nodes:ip", "nodes:billing", "events", "events:security", "notify", "http", "http:private", "routes", "routes:public"];
export const CATEGORIES = ["notify", "monitoring", "report", "integration", "security", "display", "utility", ""];
/** Entries are written in this order. */
export const FIELDS = ["id", "name", "description", "author", "category", "icon", "version", "vespera", "url", "download", "sha256", "size", "permissions"];
/** Same limits as the panel: 10 MB unpacked, 500 files. */
export const MAX_UNPACKED = 10 << 20;
export const MAX_FILES = 500;
export const MAX_DOWNLOAD = 16 << 20;

export const ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
export const SHA256 = /^[0-9a-f]{64}$/;

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

export function readCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG, "utf8"));
}

export function writeCatalog(catalog) {
  catalog.plugins = catalog.plugins.map(ordered).sort(byId);
  fs.writeFileSync(CATALOG, `${JSON.stringify(catalog, null, 2)}\n`);
}

export const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function ordered(entry) {
  const out = {};
  for (const k of FIELDS) if (entry[k] !== undefined) out[k] = entry[k];
  return out;
}

const text = (t) => typeof t === "string" ? t.trim() !== "" : !!t && typeof t === "object" && Object.values(t).some((s) => typeof s === "string" && s.trim());

/** Problems with one catalog entry, as text; empty when it is fine. */
export function entryProblems(e) {
  const p = [];
  if (!ID.test(e.id || "") || e.id === "market") p.push("id must be 1-32 chars of a-z, 0-9, - or _ (and not \"market\")");
  if (!text(e.name)) p.push("name is required");
  if (!VERSION.test(e.version || "")) p.push("version must be semver, e.g. 1.2.0");
  if (!/^https?:\/\//.test(e.download || "")) p.push("download must be an http(s) URL");
  if (!SHA256.test(e.sha256 || "")) p.push("sha256 must be 64 lowercase hex digits");
  if (e.url && !/^https?:\/\//.test(e.url)) p.push("url must be an http(s) URL");
  if (e.vespera && !/^>=\s*\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(e.vespera)) p.push("vespera must look like >=0.1.0-beta.8.4");
  if (e.category !== undefined && !CATEGORIES.includes(e.category)) p.push(`category must be one of ${CATEGORIES.filter(Boolean).join(", ")}`);
  for (const perm of e.permissions || []) if (!PERMISSIONS.includes(perm)) p.push(`unknown permission ${perm}`);
  for (const k of Object.keys(e)) if (!FIELDS.includes(k)) p.push(`unknown field ${k}`);
  return p;
}

/** Problems with the whole catalog. */
export function catalogProblems(c) {
  const p = [];
  if (c.schema !== SCHEMA) p.push(`schema must be ${SCHEMA}`);
  if (!Array.isArray(c.plugins)) return [...p, "plugins must be an array"];
  const seen = new Set();
  c.plugins.forEach((e, i) => {
    for (const q of entryProblems(e)) p.push(`plugins[${i}] ${e.id ?? "?"}: ${q}`);
    if (seen.has(e.id)) p.push(`${e.id} is listed twice`);
    seen.add(e.id);
  });
  const sorted = [...c.plugins].sort(byId);
  const at = c.plugins.findIndex((e, i) => e !== sorted[i]);
  if (at !== -1) p.push(`plugins must be sorted by id: expected ${sorted[at].id} at index ${at}; run node scripts/validate.mjs --write`);
  return p;
}

/** The files of a zip: { name: Buffer }. Refuses what the panel would refuse. */
export function unzip(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(end + 10);
  if (count > MAX_FILES) throw new Error(`too many files (max ${MAX_FILES})`);
  let at = buf.readUInt32LE(end + 16);
  const files = {};
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error("broken zip directory");
    const method = buf.readUInt16LE(at + 10);
    const packed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28), extraLen = buf.readUInt16LE(at + 30), commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen).replaceAll("\\", "/");
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (name.startsWith("/") || name.split("/").includes("..")) throw new Error(`unsafe path in zip: ${name}`);
    if (name.startsWith("__MACOSX/") || name.endsWith(".DS_Store")) continue;
    total += size;
    if (total > MAX_UNPACKED) throw new Error("the package is larger than 10 MB unpacked");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + packed);
    if (method === 0) files[name] = Buffer.from(raw);
    else if (method === 8) files[name] = inflateRawSync(raw);
    else throw new Error(`${name}: unsupported compression ${method}`);
  }
  // One top-level folder around everything is fine, as in the panel.
  if (!files[MANIFEST]) {
    const wrapped = Object.keys(files).find((n) => n.endsWith(`/${MANIFEST}`) && n.split("/").length === 2);
    if (!wrapped) throw new Error(`${MANIFEST} not found`);
    const prefix = wrapped.slice(0, -MANIFEST.length);
    return Object.fromEntries(Object.entries(files).filter(([n]) => n.startsWith(prefix)).map(([n, d]) => [n.slice(prefix.length), d]));
  }
  return files;
}

/** The manifest of a package, checked as the panel checks it. */
export function packageManifest(buf) {
  const files = unzip(buf);
  let m;
  try {
    m = JSON.parse(files[MANIFEST].toString("utf8"));
  } catch (e) {
    throw new Error(`invalid ${MANIFEST}: ${e.message}`);
  }
  const problems = [];
  if (!ID.test(m.id || "") || m.id === "market") problems.push("manifest id is not valid");
  if (!text(m.name)) problems.push("manifest name is required");
  if (!VERSION.test(m.version || "")) problems.push("manifest version must be semver");
  const entry = m.entry || "main.js";
  if (!files[entry]) problems.push(`the script ${entry} is not in the package`);
  for (const perm of m.permissions || []) if (!PERMISSIONS.includes(perm)) problems.push(`unknown permission ${perm}`);
  if ((m.http || []).length && !(m.permissions || []).includes("http")) problems.push("http hosts listed without the http permission");
  if ((m.public_routes || []).length && !(m.permissions || []).includes("routes:public")) problems.push("public_routes without the routes:public permission");
  for (const page of m.pages || []) {
    if (!/^ui\/.*\.html$/.test(page.file || "") || page.file.includes("..")) problems.push(`page ${page.file} must be an .html file under ui/`);
    else if (!files[page.file]) problems.push(`page ${page.file} is not in the package`);
  }
  if (problems.length) throw new Error(problems.join("; "));
  return m;
}

/** A catalog entry for a package, from its manifest: what the market shows. */
export function entryFromManifest(m, { download, sha256: digest, size, category }) {
  return ordered({
    id: m.id,
    name: m.name,
    description: m.description || "",
    author: m.author || "",
    category: category ?? "",
    icon: m.icon || "",
    version: m.version,
    vespera: (m.vespera || "").trim(),
    url: m.url || "",
    download,
    sha256: digest,
    size,
    permissions: [...new Set(m.permissions || [])].sort(),
  });
}

const UA = { "User-Agent": "vespera-plugin-market" };

export async function download(url) {
  const res = await fetch(url, { headers: UA, redirect: "follow" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_DOWNLOAD) throw new Error(`${url}: larger than 16 MiB`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD) throw new Error(`${url}: larger than 16 MiB`);
  return buf;
}

export async function github(path) {
  const token = process.env.GITHUB_TOKEN;
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { ...UA, Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API ${path}: HTTP ${res.status}`);
  return res.json();
}

/** owner/repo of a github.com URL, or null. */
export function githubRepo(url) {
  try {
    const u = new URL(url);
    if (!["github.com", "www.github.com"].includes(u.hostname)) return null;
    const [owner, repo] = u.pathname.split("/").filter(Boolean);
    return owner && repo ? { owner, repo: repo.replace(/\.git$/, "") } : null;
  } catch {
    return null;
  }
}

/** The plugin zip of a GitHub release: the one asset that looks like <id>-<version>.zip, or the only zip. */
export function releaseZip(release, id) {
  const zips = (release.assets || []).filter((a) => a.name.toLowerCase().endsWith(".zip"));
  const named = zips.filter((a) => a.name.startsWith(`${id}-`) || a.name === `${id}.zip`);
  if (named.length === 1) return named[0];
  return zips.length === 1 ? zips[0] : null;
}

/** Check an entry against its package: downloads it, compares the digest and the manifest. */
export async function verifyEntry(e) {
  const buf = await download(e.download);
  const digest = sha256(buf);
  if (digest !== e.sha256) throw new Error(`${e.id}: the package has SHA-256 ${digest}, the catalog says ${e.sha256}`);
  const m = packageManifest(buf);
  if (m.id !== e.id) throw new Error(`${e.id}: the package is plugin ${m.id}`);
  if (m.version !== e.version) throw new Error(`${e.id}: the package is version ${m.version}, the catalog says ${e.version}`);
  if ((m.vespera || "").trim() !== (e.vespera || "")) throw new Error(`${e.id}: the package needs Vespera "${m.vespera || ""}", the catalog says "${e.vespera || ""}"`);
  const perms = [...new Set(m.permissions || [])].sort().join(",");
  if (perms !== [...(e.permissions || [])].sort().join(",")) throw new Error(`${e.id}: the package asks for [${perms}], the catalog lists [${(e.permissions || []).join(",")}]`);
  return { manifest: m, size: buf.length };
}
