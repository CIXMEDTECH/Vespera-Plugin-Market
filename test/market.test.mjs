import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { catalogProblems, entryFromManifest, entryProblems, packageManifest, readCatalog, unzip } from "../scripts/lib.mjs";
import { newer } from "../scripts/update-releases.mjs";
import { formFields } from "../scripts/submission.mjs";

/** A zip of { name: string }. */
function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content), packed = deflateRawSync(data), n = Buffer.from(name);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(8, 8); h.writeUInt32LE(packed.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(h, n, packed); centrals.push(c, n);
    offset += 30 + n.length + packed.length;
  }
  const dir = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

const manifest = (extra = {}) => JSON.stringify({ id: "demo", name: { zh: "演示", en: "Demo" }, version: "1.0.0", permissions: ["routes", "nodes"], ...extra });

test("the catalog in this repository is valid", () => {
  assert.deepEqual(catalogProblems(readCatalog()), []);
});

test("packages are read and checked like the panel does", () => {
  const m = packageManifest(zip({ "vespera-plugin.json": manifest(), "main.js": "" }));
  assert.equal(m.id, "demo");
  // One folder around it all is fine.
  assert.equal(packageManifest(zip({ "demo-1.0/vespera-plugin.json": manifest(), "demo-1.0/main.js": "" })).id, "demo");
  assert.throws(() => packageManifest(zip({ "vespera-plugin.json": manifest() })), /script/);
  assert.throws(() => packageManifest(zip({ "vespera-plugin.json": manifest({ permissions: ["root"] }), "main.js": "" })), /unknown permission/);
  assert.throws(() => packageManifest(zip({ "vespera-plugin.json": manifest({ id: "Demo" }), "main.js": "" })), /id/);
  assert.throws(() => packageManifest(zip({ "vespera-plugin.json": manifest({ public_routes: ["/x"] }), "main.js": "" })), /routes:public/);
  assert.throws(() => unzip(zip({ "../evil": "x", "vespera-plugin.json": manifest() })), /unsafe path/);
  assert.throws(() => unzip(Buffer.from("not a zip at all, not even close to one")), /not a zip/);
});

test("entries come from manifests and are checked", () => {
  const m = JSON.parse(manifest({ vespera: ">=0.1.0-beta.9", icon: "image" }));
  const e = entryFromManifest(m, { download: "https://example.com/demo-1.0.0.zip", sha256: "a".repeat(64), size: 10, category: "display" });
  assert.deepEqual(Object.keys(e).slice(0, 3), ["id", "name", "description"]);
  assert.deepEqual(e.permissions, ["nodes", "routes"]);
  assert.deepEqual(entryProblems(e), []);
  assert.ok(entryProblems({ ...e, sha256: "A".repeat(64) }).length);
  assert.ok(entryProblems({ ...e, id: "market" }).length);
  assert.ok(entryProblems({ ...e, category: "games" }).length);
  assert.ok(entryProblems({ ...e, extra: 1 }).length);
  const unsorted = { schema: 1, plugins: [{ ...e, id: "b" }, { ...e, id: "a" }] };
  assert.match(catalogProblems(unsorted).join(), /sorted/);
  assert.match(catalogProblems({ schema: 1, plugins: [e, e] }).join(), /twice/);
});

test("versions compare like the panel's", () => {
  assert.ok(newer("1.0.1", "1.0.0"));
  assert.ok(newer("v1.1.0", "1.0.9"));
  assert.ok(newer("1.0.0", "1.0.0-beta.2"));
  assert.ok(newer("1.0.0-beta.10", "1.0.0-beta.9"));
  assert.ok(!newer("1.0.0", "1.0.0"));
  assert.ok(!newer("1.0.0-rc.1", "1.0.0"));
});

test("issue forms are read by their headings", () => {
  const f = formFields("### GitHub 仓库地址 / GitHub repository URL\n\nhttps://github.com/a/b\n\n### 插件分类 / Plugin category\n\n_No response_\n");
  assert.equal(f["GitHub 仓库地址 / GitHub repository URL"], "https://github.com/a/b");
  assert.equal(f["插件分类 / Plugin category"], "");
});
