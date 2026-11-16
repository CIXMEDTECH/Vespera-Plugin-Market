#!/usr/bin/env node
// Add or update an entry from a zip on disk, for a package that will be (or is)
// published at <download>. The catalog then vouches for exactly this file.
//   node scripts/add-local.mjs <zip> <download-url> [category]
import fs from "node:fs";
import { entryFromManifest, packageManifest, readCatalog, sha256, writeCatalog } from "./lib.mjs";

const [zip, download, category = ""] = process.argv.slice(2);
if (!zip || !download) {
  console.error("usage: node scripts/add-local.mjs <zip> <download-url> [category]");
  process.exit(2);
}
const buf = fs.readFileSync(zip);
const m = packageManifest(buf);
const catalog = readCatalog();
const at = catalog.plugins.findIndex((p) => p.id === m.id);
const entry = entryFromManifest(m, { download, sha256: sha256(buf), size: buf.length, category: category || catalog.plugins[at]?.category || "" });
if (at === -1) catalog.plugins.push(entry);
else catalog.plugins[at] = entry;
catalog.updated_at = new Date().toISOString();
writeCatalog(catalog);
console.log(`${m.id} ${m.version} ${entry.sha256}`);
