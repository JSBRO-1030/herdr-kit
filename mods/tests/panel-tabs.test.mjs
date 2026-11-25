// panel-tabs/model.js 시험 — node --test mods/tests/panel-tabs.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { findNode, chipsFor, availWidth, needWidth, decideCompact, pickAvail, TOOLS, eligible, panelsOf, ownerInfo, SIDES, sideOfStack, locateTool, menuRows, menuHeight, MENU_W, ROW_H, MENU_PAD, SEP_H, CLOSE_W, COMPACT_W, CHIP_GAP, STRIP_PAD, firstEnabled, stepEnabled, rowEnabled } from "../panel-tabs/model.js";

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

// ---- M2 ----
// right: panel-body, bottom: panel-bottom
const two = (right, bottom, ra = right[0], ba = bottom[0]) => ({
  id: "root", type: "row", children: [
    { id: "work", type: "column", children: [{ id: "panel-bottom", type: "stack", active: ba, children: kids(...bottom) }] },
    { id: "panel", type: "column", children: [{ id: "panel-body", type: "stack", active: ra, children: kids(...right) }] },
  ],
});
const labels = (rows) => rows.map(r => r.label);

test("closed ids excluded from chips; non-array closed ignored; owner absent = M1", () => {
  assert.deepEqual(ids(chipsFor(owner(), "panel-body", { closed: ["files-plus", "graph"] })), ["files", "changes"]);
  assert.deepEqual(ids(chipsFor(owner(), "panel-body", { closed: "graph" })), ["files", "files-plus", "changes", "graph"]);
  assert.deepEqual(chipsFor(owner(), "nope", { closed: ["graph"] }), { error: "no-stack", chips: [] });
  assert.deepEqual(chipsFor(owner(), "panel-body"), chipsFor(owner(), "panel-body", { closed: [] }));
  const a = chipsFor(owner("graph"), "panel-body", { closed: ["graph"] });
  assert.ok(a.chips.every(c => !c.active));
});

test("panelsOf / eligible", () => {
  assert.deepEqual(panelsOf(["changes"]), ["changes"]);
  assert.deepEqual(panelsOf([]), []);
  for (const v of [undefined, null, "files", {}, 3]) assert.deepEqual(panelsOf(v), ["files", "changes"]);
  assert.equal(eligible("files", {}), true);
  assert.equal(eligible("files", { hideFiles: true }), false);
  assert.equal(eligible("files", { panels: ["changes"] }), false);
  assert.equal(eligible("changes", { panels: ["files"] }), false);
  assert.equal(eligible("changes", { panels: "junk" }), true);
  assert.equal(eligible("graph", { panels: [] }), true);
  assert.equal(eligible("files-plus", { panels: [], hideFiles: true }), true);
  assert.equal(eligible("x", {}), false);
  assert.equal(eligible("toString", {}), false);
  assert.equal(eligible(undefined), false);
  assert.equal(eligible("graph"), true);
});

test("ownerInfo", () => {
  const root = { type: "block", content: { mod: "auto-tabs" } };
  assert.deepEqual(ownerInfo(undefined, ["graph"], true, root, 1000), { on: false, hideFiles: true, closed: [], bottom: false });
  assert.deepEqual(ownerInfo(null, undefined, "yes", root, 1000), { on: false, hideFiles: false, closed: [], bottom: false });
  assert.deepEqual(ownerInfo({ v: 1, hideFiles: true, bottom: true }, ["graph"], false, root, 1000), { on: false, hideFiles: false, closed: [], bottom: false });
  assert.deepEqual(ownerInfo({ v: "2" }, [], true, root, 1000), { on: false, hideFiles: true, closed: [], bottom: false });
  assert.deepEqual(ownerInfo({ v: 2, t: 1000, hideFiles: true, bottom: true }, ["graph"], false, root, 1000), { on: true, hideFiles: true, closed: ["graph"], bottom: true });
  // owner on: props ignored, truthy-but-not-true ignored
  assert.deepEqual(ownerInfo({ v: 2, t: 1000, hideFiles: "true", bottom: 1 }, undefined, true, root, 1000), { on: true, hideFiles: false, closed: [], bottom: false });
  assert.deepEqual(ownerInfo({ v: 2, t: 1000 }, "graph", true, root, 1000), { on: true, hideFiles: false, closed: [], bottom: false });
  // closed: junk, duplicates, non-TOOLS
  assert.deepEqual(ownerInfo({ v: 2, t: 1000 }, ["graph", "graph", "x", 3, null, "toString", "files", {}, "graph"], false, root, 1000).closed, ["graph", "files"]);
});

test("SIDES / sideOfStack / locateTool", () => {
  assert.deepEqual(SIDES, { right: { stack: "panel-body", vis: "panel" }, bottom: { stack: "panel-bottom", vis: "panel-bottom" } });
  assert.equal(sideOfStack("panel-body"), "right");
  assert.equal(sideOfStack("panel-bottom"), "bottom");
  assert.equal(sideOfStack("other"), null);
  assert.equal(sideOfStack(undefined), null);
  const r = two(["files", "changes"], ["graph"]);
  assert.deepEqual(locateTool(r, "files"), { side: "right", stack: "panel-body" });
  assert.deepEqual(locateTool(r, "graph"), { side: "bottom", stack: "panel-bottom" });
  assert.equal(locateTool(r, "files-plus"), null);
  assert.equal(locateTool(r, "foreign"), null);
  assert.equal(locateTool(r, "panel"), null);          // not a child of either stack
  assert.equal(locateTool(r, "panel-body"), null);
  assert.equal(locateTool(r, undefined), null);
  assert.equal(locateTool(null, "files"), null);
  const other = { id: "r", type: "row", children: [{ id: "elsewhere", type: "stack", children: kids("files") }] };
  assert.equal(locateTool(other, "files"), null);
  assert.equal(locateTool({ id: "panel-body", type: "column", children: kids("files") }, "files"), null);
});

test("menuRows tab: on right / on bottom / bottom unavailable", () => {
  const r = two(["files", "changes"], ["graph"]);
  const right = menuRows(r, "panel-body", { bottom: true }, "tab", "files");
  assert.deepEqual(right, [
    { label: "아래로 옮기기", cmd: "move:files:bottom", dim: false, sep: false },
    { label: "오른쪽으로 옮기기", cmd: null, dim: true, sep: false },
    { label: "", cmd: null, dim: false, sep: true },
    { label: "닫기", cmd: "close:files", dim: false, sep: false },
  ]);
  const bot = menuRows(r, "panel-bottom", { bottom: true }, "tab", "graph");
  assert.equal(bot[0].cmd, null); assert.equal(bot[0].dim, true);
  assert.equal(bot[1].cmd, "move:graph:right"); assert.equal(bot[1].dim, false);
  assert.equal(bot[3].cmd, "close:graph");
  const nob = menuRows(owner(), "panel-body", { bottom: false }, "tab", "changes");
  assert.equal(nob[0].cmd, null); assert.equal(nob[0].dim, true);
  assert.equal(nob[1].cmd, null);
  assert.equal(nob[3].cmd, "close:changes"); assert.equal(nob[3].dim, false);
  assert.equal(menuRows(r, "panel-body", {}, "tab", "files")[0].cmd, null);
});

test("menuRows plus", () => {
  // nothing closed, everything is a chip -> empty row
  const all = two(["files", "files-plus", "changes", "graph"], []);
  assert.deepEqual(menuRows(all, "panel-body", {}, "plus"), [{ label: "닫힌 도구 없음", cmd: null, dim: true, sep: false }]);
  // closed on same side
  assert.deepEqual(menuRows(all, "panel-body", { closed: ["changes"] }, "plus"), [{ label: "Changes", cmd: "open:changes", dim: false, sep: false }]);
  // closed on the other side: suffix, not dim
  const sp = two(["files", "changes"], ["graph", "files-plus"]);
  const c = menuRows(sp, "panel-body", { bottom: true, closed: ["graph"] }, "plus");
  assert.deepEqual(c, [
    { label: "Files+ (아래에 있음)", cmd: "open:files-plus", dim: true, sep: false },
    { label: "Git (아래에 있음)", cmd: "open:graph", dim: false, sep: false },
  ]);
  // open on other side: dim; viewed from bottom the right-side ones are noted
  const fb = menuRows(sp, "panel-bottom", { closed: ["files"] }, "plus");
  assert.deepEqual(fb, [
    { label: "Files (오른쪽에 있음)", cmd: "open:files", dim: false, sep: false },
    { label: "Changes (오른쪽에 있음)", cmd: "open:changes", dim: true, sep: false },
  ]);
  // TOOLS order, absent from layout never offered
  const part = two(["graph", "files"], ["changes"]);
  assert.deepEqual(labels(menuRows(part, "panel-body", { bottom: true }, "plus")), ["Changes (아래에 있음)"]);
});

test("menuRows plus: hidden Files / disabled Changes never offered", () => {
  const sp = two(["files", "changes"], ["graph"]);
  assert.deepEqual(labels(menuRows(sp, "panel-bottom", { hideFiles: true }, "plus")), ["Changes (오른쪽에 있음)"]);
  assert.deepEqual(labels(menuRows(sp, "panel-bottom", { panels: ["files"] }, "plus")), ["Files (오른쪽에 있음)"]);
  assert.deepEqual(menuRows(sp, "panel-bottom", { hideFiles: true, panels: [] }, "plus"), [{ label: "닫힌 도구 없음", cmd: null, dim: true, sep: false }]);
  // closed but hidden Files: still not offered
  assert.ok(!labels(menuRows(owner(), "panel-body", { hideFiles: true, closed: ["files"] }, "plus")).includes("Files"));
});

test("menuRows unknown kind", () => {
  assert.deepEqual(menuRows(owner(), "panel-body", {}, "zzz", "files"), []);
  assert.deepEqual(menuRows(owner(), "panel-body", {}, undefined), []);
});

test("menu sizes and menuHeight", () => {
  assert.deepEqual([MENU_W, ROW_H, MENU_PAD, SEP_H], [220, 31, 5, 9]);
  assert.equal(menuHeight([]), 10);
  assert.equal(menuHeight([{ sep: false }]), 41);
  const rows = menuRows(owner(), "panel-body", { bottom: true }, "tab", "files");
  assert.equal(menuHeight(rows), 10 + 3 * 31 + 9);
  assert.equal(menuHeight(undefined), 10);
});

test("parity with auto-tabs/panels.js (if present)", async (t) => {
  const url = new URL("../auto-tabs/panels.js", import.meta.url);
  if (!existsSync(url)) return t.skip("mods/auto-tabs/panels.js not present yet");
  const other = await import(url.href);
  const pv = [undefined, [], ["files"], ["changes"], ["files", "changes"]];
  for (const id of [...Object.keys(TOOLS), "x"]) for (const panels of pv) for (const hideFiles of [true, false]) {
    assert.equal(other.eligible(id, { panels, hideFiles }), eligible(id, { panels, hideFiles }), `eligible ${id} ${JSON.stringify(panels)} ${hideFiles}`);
  }
  for (const v of [...pv, null, "x", 5]) assert.deepEqual(other.panelsOf(v), panelsOf(v));
});

test("needWidth: owner on adds + button and close x", () => {
  const chips = [{ label: "Files", active: true }, { label: "Git", active: false }];
  const base = needWidth(chips);
  assert.equal(needWidth(chips, false, false), base);
  assert.equal(needWidth(chips, false, true), base + CLOSE_W + COMPACT_W + CHIP_GAP);
  // compact: inactive chip is COMPACT_W, active keeps full + x
  assert.equal(needWidth(chips, true, true), needWidth(chips, true) + CLOSE_W + COMPACT_W + CHIP_GAP);
  assert.equal(needWidth([], false, true), STRIP_PAD * 2 + COMPACT_W);
  assert.equal(needWidth([], false, false), STRIP_PAD * 2);
});

test("decideCompact flips earlier when owner on", () => {
  const chips = [{ label: "Files", active: true }, { label: "Changes", active: false }];
  const avail = needWidth(chips);
  assert.equal(decideCompact(false, needWidth(chips, false, false), avail), false);
  assert.equal(decideCompact(false, needWidth(chips, false, true), avail), true);
});

test("rowEnabled / firstEnabled / stepEnabled", () => {
  const rows = [
    { label: "a", cmd: null, dim: true, sep: false },
    { label: "b", cmd: "x", dim: false, sep: false },
    { label: "", cmd: null, dim: false, sep: true },
    { label: "c", cmd: "y", dim: true, sep: false },
  ];
  assert.deepEqual(rows.map(rowEnabled), [false, true, false, true]);
  assert.equal(rowEnabled(undefined), false);
  assert.equal(firstEnabled(rows), 1);
  assert.equal(firstEnabled([{ cmd: null }]), -1);
  assert.equal(firstEnabled([]), -1);
  assert.equal(firstEnabled(undefined), -1);
  assert.equal(stepEnabled(rows, 1, 1), 3);
  assert.equal(stepEnabled(rows, 3, 1), 1);   // wrap
  assert.equal(stepEnabled(rows, 1, -1), 3);  // wrap back
  assert.equal(stepEnabled(rows, 3, -1), 1);
  assert.equal(stepEnabled(rows, -1, 1), 1);  // out of range start
  assert.equal(stepEnabled(rows, -1, -1), 3);
  assert.equal(stepEnabled([{ cmd: null }], 0, 1), -1);
  assert.equal(stepEnabled([{ cmd: "x" }], 0, 1), 0);
});

test("F4 ownerInfo: v2 shared 만 남은 레이아웃은 M1", () => {
  const value = { v: 2, t: 1000, hideFiles: true, bottom: true };
  const root = { type: "row", children: [{ type: "block", content: { mod: "terminal" } }] };
  assert.deepEqual(ownerInfo(value, ["graph"], false, root, 1000), { on: false, hideFiles: false, closed: [], bottom: false });
  root.children.push({ type: "stack", content: { mod: "auto-tabs" }, children: [] });
  assert.equal(ownerInfo(value, [], false, root, 1000).on, false);
  root.children.push({ type: "column", children: [{ type: "block", content: { mod: "auto-tabs" } }] });
  assert.deepEqual(ownerInfo(value, ["graph"], false, root, 1000), { on: true, hideFiles: true, closed: ["graph"], bottom: true });
  assert.equal(ownerInfo({ v: 1 }, [], false, root, 1000).on, false);
});

test("F7 ownerInfo: fresh heartbeat on, stale or future heartbeat M1", () => {
  const root = owner();
  root.children.push({ type: "block", content: { mod: "auto-tabs" } });
  const value = { v: 2, t: 1000, hideFiles: true, bottom: true };
  assert.equal(ownerInfo(value, ["graph"], false, root, 1000).on, true);
  assert.equal(ownerInfo(value, ["graph"], false, root, 61000).on, true);
  for (const now of [999, 61001]) {
    const info = ownerInfo(value, ["graph"], false, root, now);
    assert.deepEqual(info, { on: false, hideFiles: false, closed: [], bottom: false });
    assert.ok(ids(chipsFor(root, "panel-body", info)).includes("graph"));
  }
  for (const t of [undefined, null, "1000", NaN]) {
    assert.equal(ownerInfo({ ...value, t }, ["graph"], false, root, 1000).on, false);
  }
});

test("F9 plus: foreign bottom tools excluded, empty placeholder kept", () => {
  const root = two(["files", "changes"], ["graph", "files-plus"]);
  assert.deepEqual(menuRows(root, "panel-body", { bottom: false, closed: ["graph", "files-plus"] }, "plus"), [
    { label: "닫힌 도구 없음", cmd: null, dim: true, sep: false },
  ]);
  assert.deepEqual(menuRows(root, "panel-body", { bottom: false, closed: ["changes", "graph"] }, "plus"), [
    { label: "Changes", cmd: "open:changes", dim: false, sep: false },
  ]);
});

test("F7 header: one stale timer rechecks latest heartbeat without events", async () => {
  const model = await import("../panel-tabs/model.js");
  const root = owner("files-plus");
  root.children.push({ type: "block", content: { mod: "auto-tabs" } });
  let now = 1000;
  const value = { v: 2, t: now, bottom: true };
  const timers = [];
  let notified = 0;
  const element = () => {
    const node = { kids: [] };
    let el;
    el = new Proxy(node, { get(target, key) {
      if (key === "id") return (id) => { target.name = id; return el; };
      if (key === "child") return (kid) => { target.kids.push(kid); return el; };
      if (key === "children") return (kids) => { target.kids.push(...kids); return el; };
      if (key === "when") return (yes, fn) => yes ? fn(el) : el;
      if (key === "kids" || key === "name") return target[key];
      return () => el;
    } });
    return el;
  };
  const deps = { ...model, View: class {}, layout: () => root, props: () => ({}),
    shared: (k) => k === "panel-tabs.owner" ? value : k === "panel-tabs.closed" ? ["graph"] : undefined,
    theme: () => ({}), Date: { now: () => now }, div: element, h_flex: element, v_flex: element, svg: element };
  const src = readFileSync(new URL("../panel-tabs/main.js", import.meta.url), "utf8")
    .replace(/^import .*;\n/gm, "").replace("export default class", "return class");
  const Header = new Function(...Object.keys(deps), src)(...Object.values(deps));
  const header = new Header();
  const cx = { timer: { after: (ms, fn) => timers.push({ ms, fn }) } };
  const names = (node) => node && typeof node === "object" ? [node.name, ...(node.kids ?? []).flatMap(names)] : [];
  assert.ok(names(header.render(cx)).includes("pt-plus"));
  header.render(cx);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 60001);
  now = value.t = 21000;
  header.render(cx);
  assert.equal(timers.length, 1, "heartbeat redraw keeps one pending timer");
  now = 61001;
  timers.shift().fn({ notify: () => notified++ });
  assert.equal(notified, 1, "timer uses its callback cx");
  assert.ok(names(header.render(cx)).includes("pt-plus"));
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 20000);
  now = 81001;
  timers.shift().fn({ notify: () => notified++ });
  const stale = names(header.render(cx));
  assert.ok(!stale.includes("pt-plus"));
  assert.ok(stale.includes("pt-graph"), "stale owner ignores closed ids");
  assert.equal(timers.length, 0);
});
