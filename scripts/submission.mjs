#!/usr/bin/env node
// Turn a submission issue into a catalog entry. The issue comes from one of the
// forms under .github/ISSUE_TEMPLATE; its body has "### <label>" sections.
//   node scripts/submission.mjs --event <event.json> --comment <out.md> --github-output <file>
// Outputs status=success|failure|retry and id=<plugin id>.
import fs from "node:fs";
import { CATEGORIES, entryFromManifest, github, githubRepo, packageManifest, readCatalog, releaseZip, sha256, download, writeCatalog } from "./lib.mjs";

export const FIELDS = {
  repository: "GitHub 仓库地址 / GitHub repository URL",
  download: "插件包下载地址 / Plugin package URL",
  project: "项目地址 / Project URL",
  category: "插件分类 / Plugin category",
};
export const CATEGORY_OPTIONS = {
  "通知 / Notifications": "notify",
  "监控与告警 / Monitoring and alerts": "monitoring",
  "报表与统计 / Reports": "report",
  "数据与集成 / Data and integrations": "integration",
  "登录与安全 / Login and security": "security",
  "展示与嵌入 / Display and embeds": "display",
  "系统与工具 / System and utilities": "utility",
  "未分类 / Uncategorized": "",
};

/** The "### label" sections of an issue form body. */
export function formFields(body) {
  const out = {};
  const parts = String(body || "").replace(/\r\n/g, "\n").split(/^### /m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const label = (nl < 0 ? part : part.slice(0, nl)).trim();
    const value = (nl < 0 ? "" : part.slice(nl + 1)).trim();
    out[label] = value === "_No response_" ? "" : value;
  }
  return out;
}

class Retry extends Error {}

async function fromGithub(url) {
  const repo = githubRepo(url);
  if (!repo) throw new Error("请填写 https://github.com/<owner>/<repo> 形式的仓库地址 / Give the repository as https://github.com/<owner>/<repo>");
  let info, releases;
  try {
    info = await github(`/repos/${repo.owner}/${repo.repo}`);
    releases = await github(`/repos/${repo.owner}/${repo.repo}/releases?per_page=20`);
  } catch (e) {
    throw new Retry(e.message);
  }
  if (!info || info.private) throw new Error("仓库不存在或不是公开的 / The repository does not exist or is not public");
  const release = (releases || []).find((r) => !r.draft);
  if (!release) throw new Error("仓库还没有 Release / The repository has no release yet");
  const asset = releaseZip(release, "");
  const zips = (release.assets || []).filter((a) => a.name.toLowerCase().endsWith(".zip"));
  const pick = asset || (zips.length ? null : undefined);
  if (!pick) throw new Error(`最新 Release ${release.tag_name} 里应当恰好有一个插件 zip / The latest release ${release.tag_name} must have exactly one plugin zip`);
  return { download: pick.browser_download_url, project: `https://github.com/${repo.owner}/${repo.repo}`, tag: release.tag_name };
}

export async function submit(body) {
  const f = formFields(body);
  const category = CATEGORY_OPTIONS[f[FIELDS.category]] ?? "";
  if (!CATEGORIES.includes(category)) throw new Error("未知分类 / Unknown category");
  let source;
  if (f[FIELDS.repository]) source = await fromGithub(f[FIELDS.repository]);
  else if (f[FIELDS.download]) {
    if (!/^https:\/\//.test(f[FIELDS.download])) throw new Error("插件包地址必须是 https:// 链接 / The package URL must be https://");
    if (githubRepo(f[FIELDS.download]) || /githubusercontent\.com/.test(f[FIELDS.download])) {
      throw new Error("GitHub 上的插件请用“在 GitHub 中开源的插件”模板提交 / Use the GitHub template for plugins hosted on GitHub");
    }
    source = { download: f[FIELDS.download], project: f[FIELDS.project] || "" };
  } else throw new Error("没有找到仓库地址或插件包地址 / No repository or package URL found");

  let buf;
  try {
    buf = await download(source.download);
  } catch (e) {
    throw new Retry(`无法下载插件包 / Cannot download the package: ${e.message}`);
  }
  const m = packageManifest(buf);
  if (source.tag && source.tag.replace(/^v/, "") !== m.version) {
    throw new Error(`Release 标签 ${source.tag} 与清单版本 ${m.version} 不一致 / Release tag ${source.tag} does not match manifest version ${m.version}`);
  }
  const entry = entryFromManifest(m, { download: source.download, sha256: sha256(buf), size: buf.length, category });
  if (!entry.url) entry.url = source.project;

  const catalog = readCatalog();
  const existing = catalog.plugins.findIndex((p) => p.id === entry.id);
  if (existing !== -1 && catalog.plugins[existing].url && entry.url && catalog.plugins[existing].url !== entry.url) {
    throw new Error(`id ${entry.id} 已被 ${catalog.plugins[existing].url} 使用 / The id ${entry.id} is taken by ${catalog.plugins[existing].url}`);
  }
  if (existing === -1) catalog.plugins.push(entry);
  else catalog.plugins[existing] = entry;
  catalog.updated_at = new Date().toISOString();
  writeCatalog(catalog);
  return { entry, manifest: m, replaced: existing !== -1 };
}

function summary({ entry, manifest, replaced }) {
  const name = typeof entry.name === "string" ? entry.name : Object.values(entry.name)[0];
  return [
    "<!-- plugin-submission-validation -->",
    `### ✅ ${name} (\`${entry.id}\` ${entry.version})`,
    "",
    replaced ? "已有条目，将被更新。 / Already listed; the entry will be updated." : "新插件。 / New plugin.",
    "",
    `- 下载 / Package: ${entry.download}`,
    `- SHA-256: \`${entry.sha256}\``,
    `- 大小 / Size: ${entry.size} bytes`,
    `- Vespera: \`${entry.vespera || "any"}\``,
    `- 权限 / Permissions: ${entry.permissions.length ? entry.permissions.map((p) => `\`${p}\``).join(", ") : "–"}`,
    (manifest.http || []).length ? `- 可访问的主机 / Hosts: ${manifest.http.map((h) => `\`${h}\``).join(", ")}` : "",
    (manifest.public_routes || []).length ? `- 公开路由 / Public routes: ${manifest.public_routes.map((r) => `\`${r}\``).join(", ")}` : "",
  ].filter((l) => l !== "").join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k) => process.argv[process.argv.indexOf(k) + 1];
  const event = JSON.parse(fs.readFileSync(arg("--event"), "utf8"));
  const out = (k, v) => fs.appendFileSync(arg("--github-output"), `${k}=${v}\n`);
  try {
    const result = await submit(event.issue.body);
    fs.writeFileSync(arg("--comment"), summary(result) + "\n");
    out("status", "success");
    out("id", result.entry.id);
  } catch (e) {
    const retry = e instanceof Retry;
    fs.writeFileSync(
      arg("--comment"),
      [
        "<!-- plugin-submission-validation -->",
        retry ? "### ⏳ 暂时无法完成检查 / Could not finish the checks" : "### ❌ 提交未通过 / Submission rejected",
        "",
        e.message,
        "",
        retry ? "稍后会重试，也可以重新打开 Issue。 / It will be retried; reopening the issue retries too." : "修改后请重新提交。 / Please fix it and submit again.",
      ].join("\n") + "\n",
    );
    out("status", retry ? "retry" : "failure");
  }
}
