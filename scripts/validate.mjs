#!/usr/bin/env node
// Check v1.json: format, every entry, sorted by id, no id twice.
//   node scripts/validate.mjs            check
//   node scripts/validate.mjs --write    sort entries and fields, then check
//   node scripts/validate.mjs --verify [id...]   also download packages and check
//                                         their SHA-256, manifest, version and permissions
import { catalogProblems, readCatalog, verifyEntry, writeCatalog } from "./lib.mjs";

const args = process.argv.slice(2);
const catalog = readCatalog();
if (args.includes("--write")) writeCatalog(catalog);
const fresh = readCatalog();
const problems = catalogProblems(fresh);
if (args.includes("--verify")) {
  const only = args.filter((a) => !a.startsWith("--"));
  for (const e of fresh.plugins.filter((e) => !only.length || only.includes(e.id))) {
    try {
      const { size } = await verifyEntry(e);
      if (e.size !== undefined && e.size !== size) problems.push(`${e.id}: the package is ${size} bytes, the catalog says ${e.size}`);
      console.log(`verified ${e.id} ${e.version}`);
    } catch (err) {
      problems.push(err.message);
    }
  }
}
if (problems.length) {
  for (const p of problems) console.error(`::error::${p}`);
  process.exit(1);
}
console.log(`v1.json is valid (${fresh.plugins.length} plugins)`);
