// panel-tabs/model.js 시험 — node --test mods/tests/panel-tabs.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findNode, chipsFor, availWidth, needWidth, decideCompact, pickAvail, TOOLS } from "../panel-tabs/model.js";

const kids = (...ids) => ids.map(id => ({ id, type: "mod" }));
const owner = (active = "files", children = ["files", "files-plus", "changes", "graph"]) => ({
  id: "root", type: "row", children: [
    { id: "main", type: "column", children: [] },
    { id: "panel", type: "column", size: { px: 368, min: 280 }, children: [{ id: "panel-body", type: "stack", active, children: kids(...children) }] },
  ],
});
const ids = (r) => r.chips.map(c => c.id);

test("owner layout hideFiles: files hidden, none active", () => {
  const r = chipsFor(owner(), "panel-body", { hideFiles: true });
  assert.equal(r.error, null);
  assert.deepEqual(ids(r), ["files-plus", "changes", "graph"]);
  assert.ok(r.chips.every(c => !c.active));
});

test("hideFiles false + default panels: Files chip present and active", () => {
  const r = chipsFor(owner(), "panel-body", { hideFiles: false });
  assert.deepEqual(ids(r), ["files", "files-plus", "changes", "graph"]);
  assert.deepEqual(r.chips.filter(c => c.active).map(c => c.id), ["files"]);
  assert.equal(r.chips[0].label, TOOLS.files.label);
});

test("panels filter and default", () => {
  assert.deepEqual(ids(chipsFor(owner(), "panel-body", { panels: ["files"] })), ["files", "files-plus", "graph"]);
  assert.deepEqual(ids(chipsFor(owner(), "panel-body", { panels: "x" })), ["files", "files-plus", "changes", "graph"]);
  assert.deepEqual(ids(chipsFor(owner(), "panel-body", { panels: [] })), ["files-plus", "graph"]);
});

test("stack order preserved", () => {
  const r = chipsFor(owner("graph", ["graph", "files-plus", "changes"]), "panel-body", {});
  assert.deepEqual(ids(r), ["graph", "files-plus", "changes"]);
  assert.equal(r.chips[0].active, true);
});

test("unknown child skipped; unknown active -> none active", () => {
  const r = chipsFor(owner("mystery", ["files-plus", "mystery", "graph"]), "panel-body", {});
  assert.deepEqual(ids(r), ["files-plus", "graph"]);
  assert.ok(r.chips.every(c => !c.active));
});

test("no-stack errors", () => {
  const bad = [
    [owner(), "nope"],
    [{ id: "panel-body", type: "column", children: [] }, "panel-body"],
    [{ id: "panel-body", type: "stack", children: "x" }, "panel-body"],
    [null, "panel-body"],
    [undefined, "panel-body"],
    ["garbage", "panel-body"],
  ];
  for (const [root, id] of bad) assert.deepEqual(chipsFor(root, id, {}), { error: "no-stack", chips: [] });
  assert.equal(findNode(null, "a"), null);
  assert.equal(findNode({ id: "a", children: [null, 3, { id: "b" }] }, "b").id, "b");
});

test("availWidth: ancestor px or null", () => {
  assert.equal(availWidth(owner(), "panel-body"), 368);
  const own = owner(); own.children[1].children[0].size = { px: 300 };
  assert.equal(availWidth(own, "panel-body"), 300);
  assert.equal(availWidth({ id: "r", children: [{ id: "panel-body", type: "stack", children: [] }] }, "panel-body"), null);
  assert.equal(availWidth(owner(), "nope"), null);
  assert.equal(availWidth(null, "panel-body"), null);
});

test("needWidth exact values; 4 chips exceed min width 280, 3 fit", () => {
  const three = chipsFor(owner(), "panel-body", { hideFiles: true }).chips;
  const four = chipsFor(owner(), "panel-body", {}).chips;
  // chip = 35 + ceil(len*6.6): Files 68, Files+ 75, Changes 82, Git 55
  assert.equal(needWidth(three), 16 + 6 + 75 + 82 + 55);   // 234
  assert.equal(needWidth(four), 16 + 9 + 68 + 75 + 82 + 55); // 305
  assert.ok(needWidth(three) <= 280, "3 chips fit at panel min width 280");
  assert.ok(needWidth(four) > 280, "compact only reachable at 280 when 4+ chips show");
  const act = four.map(c => ({ ...c, active: c.id === "changes" }));
  assert.equal(needWidth(act, true), 16 + 9 + 26 + 26 + 82 + 26);
  assert.equal(needWidth([]), 16);
});

test("decideCompact hysteresis", () => {
  assert.equal(decideCompact(false, 305, 280), true);
  assert.equal(decideCompact(false, 280, 280), false);
  assert.equal(decideCompact(true, 305, 320), true);   // 329 > 320
  assert.equal(decideCompact(true, 305, 329), false);  // 329 <= 329
  assert.equal(decideCompact(true, 305, null), false);
  assert.equal(decideCompact(false, 999, null), false);
});

test("main.js source: no hex colors, imports model.js", () => {
  const src = readFileSync(new URL("../panel-tabs/main.js", import.meta.url), "utf8");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src));
  assert.match(src, /from "\.\/model\.js"/);
  assert.match(src, /on_size_change/);
  assert.match(src, /pickAvail\(/);
});

test("pickAvail: measured wins when finite > 0, else layout, else null", () => {
  assert.equal(pickAvail(300, 368), 300);
  assert.equal(pickAvail(0, 368), 368);
  assert.equal(pickAvail(NaN, 368), 368);
  assert.equal(pickAvail(undefined, 368), 368);
  assert.equal(pickAvail(null, 368), 368);
  assert.equal(pickAvail(Infinity, 368), 368);
  assert.equal(pickAvail(0, null), null);
  assert.equal(pickAvail(undefined, undefined), null);
});
