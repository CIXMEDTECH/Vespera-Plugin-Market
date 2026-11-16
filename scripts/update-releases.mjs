#!/usr/bin/env node
// For every plugin hosted on GitHub: when its newest release (pre-releases included,
// like the panel's beta channel) is newer than the catalog's version, download the
// plugin zip, check it and update the entry. Writes a summary for the pull request.
//   node scripts/update-releases.mjs [--dry-run] [--pr-body=path]
import fs from "node:fs";
import { entryFromManifest, github, githubRepo, packageManifest, readCatalog, releaseZip, sha256, download, writeCatalog } from "./lib.mjs";

const dryRun = process.argv.includes("--dry-run");
const bodyPath = process.argv.find((a) => a.startsWith("--pr-body="))?.slice(10);

/** Compare semver strings, pre-releases below their release. */
export function newer(a, b) {
  const parse = (v) => {
    const [core, pre] = v.replace(/^v/, "").split(/-(.*)/s);
    return { nums: core.split(".").map(Number), pre: pre ? pre.split(".") : [] };
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i];
  if (!x.pre.length || !y.pre.length) return !x.pre.length && y.pre.length > 0;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return false;
    if (q === undefined) return true;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn && Number(p) !== Number(q)) return Number(p) > Number(q);
    if (pn !== qn) return !pn;
    if (p !== q) return p > q;
  }
  return false;
}

async function check(entry) {
  const repo = githubRepo(entry.url);
  if (!repo) return null;
  const releases = (await github(`/repos/${repo.owner}/${repo.repo}/releases?per_page=20`)) || [];
  const latest = releases
    .filter((r) => !r.draft)
    .filter((r) => /^v?\d+\.\d+\.\d+/.test(r.tag_name))
    .sort((a, b) => (newer(a.tag_name, b.tag_name) ? -1 : 1))[0];
  if (!latest || !newer(latest.tag_name, entry.version)) return null;
  const asset = releaseZip(latest, entry.id);
  if (!asset) throw new Error(`release ${latest.tag_name} has no unambiguous plugin zip`);
  const buf = await download(asset.browser_download_url);
  const m = packageManifest(buf);
  if (m.id !== entry.id) throw new Error(`release ${latest.tag_name} is plugin ${m.id}`);
  if (m.version !== latest.tag_name.replace(/^v/, "")) throw new Error(`release ${latest.tag_name} has version ${m.version} in its manifest`);
  const next = entryFromManifest(m, { download: asset.browser_download_url, sha256: sha256(buf), size: buf.length, category: entry.category });
  const added = next.permissions.filter((p) => !entry.permissions?.includes(p));
  return { before: entry.version, next, tag: latest.tag_name, added, repo: `https://github.com/${repo.owner}/${repo.repo}` };
}

const catalog = readCatalog();
const updates = [];
for (const [i, entry] of catalog.plugins.entries()) {
  try {
    const u = await check(entry);
    if (!u) continue;
    catalog.plugins[i] = u.next;
    updates.push(u);
    console.log(`${entry.id}: ${u.before} -> ${u.next.version}`);
  } catch (e) {
    console.warn(`::warning::${entry.id}: ${e.message}`);
  }
}
if (updates.length && !dryRun) {
  catalog.updated_at = new Date().toISOString();
  writeCatalog(catalog);
}
if (bodyPath) {
  const rows = updates.map((u) =>
    `| [${u.next.id}](${u.repo}) | \`${u.before}\` → \`${u.next.version}\` | \`${u.next.vespera || "any"}\` | ${u.added.length ? "**" + u.added.join(", ") + "**" : "–"} | \`${u.next.sha256}\` |`,
  );
  fs.writeFileSync(
    bodyPath,
    [
      "## 插件更新 / Plugin updates",
      "",
      "| 插件 / Plugin | 版本 / Version | Vespera | 新增权限 / New permissions | SHA-256 |",
      "| --- | --- | --- | --- | --- |",
      ...rows,
      "",
      "每个安装包都已从 GitHub Release 下载，并核对了根目录的 `vespera-plugin.json`：id 与目录一致，版本与标签一致，SHA-256 由该 zip 重新计算。新增权限需要审核者特别留意；面板会在升级后停用申请了新权限的插件，直到管理员重新批准。",
      "",
      "Each package was downloaded from its GitHub release and checked against its root `vespera-plugin.json`: the id matches the catalog, the version matches the tag, and the SHA-256 was computed from that exact zip. New permissions deserve a reviewer's attention; the panel turns off an upgraded plugin that asks for more until an admin approves it again.",
    ].join("\n") + "\n",
  );
}
console.log(updates.length ? `${updates.length} plugin(s) updated` : "no plugin updates");
