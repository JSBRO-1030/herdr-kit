// auto-tabs/panels.js 시험 — node --test mods/tests/auto-tabs.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TOOLS, SIDES, STRIP, eligible, panelsOf, findNode, locate, snapshot, planRestore, planNormalize,
  planToggle, planOpen, planClose, moveTree, recordOf, matches, parseCommand, loadState, saveState, validClosed,
} from "../auto-tabs/panels.js";
import { Owner } from "../auto-tabs/owner.js";
import { menuRows } from "../panel-tabs/model.js";

const blk = (id, extra = {}) => ({ id, type: "block", content: { mod: id }, ...extra });
// my-main 의 작은 사본. rightIds/bottomIds = 스택 자식, 값이 문자열이면 id, 객체면 그대로.
function fixture({ right = ["files", "files-plus", "changes", "graph"], bottom = [], rActive = right[0], bActive = bottom[0],
  panelHidden = false, bottomHidden = true, withBottom = true, dupOk = false } = {}) {
  const mk = (x) => (typeof x === "string" ? blk(x) : x);
  const idOf = (x) => (typeof x === "string" ? x : x.id);
  // 아래에 있는 도구는 오른쪽 기본 목록에서 뺌(id 겹침 방지). dup 시험은 두 목록을 직접 같은 id 로 만듦.
  if (!dupOk) right = right.filter((x) => !bottom.map(idOf).includes(idOf(x)));
  const stackR = { id: "panel-body", type: "stack", children: right.map(mk), header: { content: { mod: "panel-tabs", props: { stack: "panel-body" } }, height: 32 } };
  if (rActive !== undefined) stackR.active = rActive;
  const work = [
    { id: "tabs", type: "block", content: { mod: "auto-tabs" }, size: { px: 42 } },
    { id: "work-body", type: "row", padding: 8, gap: 8, children: [
      { id: "main", type: "block", content: { tab: "active" } },
      { id: "panel", type: "column", size: { px: 368 }, min: 280, hidden: panelHidden, children: [stackR] },
    ] },
  ];
  if (withBottom) {
    const b = { id: "panel-bottom", type: "stack", size: { px: 240 }, hidden: bottomHidden, children: bottom.map(mk), header: { content: { mod: "panel-tabs" }, height: 32 } };
    if (bActive !== undefined) b.active = bActive;
    work.push(b);
  }
  work.push({ id: "status", type: "block", size: { px: 28 } });
  return { id: "root", type: "row", children: [{ id: "sidebar", type: "column", children: [] }, { id: "work", type: "column", children: work }] };
}
const OPTS = { panels: ["files", "changes"], hideFiles: false };
const snapOf = (t, opts = OPTS, closed = []) => snapshot(t, opts, closed);
const allIds = (t, out = []) => { out.push(t.id); (t.children ?? []).forEach(c => allIds(c, out)); return out; };
const J = (x) => JSON.stringify(x);

test("TOOLS 순서 · SIDES 꼴", () => {
  assert.deepEqual(TOOLS, ["files", "files-plus", "changes", "graph"]);
  assert.deepEqual(SIDES, { right: { stack: "panel-body", vis: "panel" }, bottom: { stack: "panel-bottom", vis: "panel-bottom" } });
  assert.deepEqual(STRIP, []);
});

test("panelsOf 기본값", () => {
  assert.deepEqual(panelsOf(undefined), ["files", "changes"]);
  assert.deepEqual(panelsOf("x"), ["files", "changes"]);
  assert.deepEqual(panelsOf(["graph"]), ["graph"]);
});

test("eligible 규칙", () => {
  assert.equal(eligible("files", OPTS), true);
  assert.equal(eligible("files", { ...OPTS, hideFiles: true }), false);
  assert.equal(eligible("files", { panels: ["changes"] }), false);
  assert.equal(eligible("changes", { panels: ["files"] }), false);
  assert.equal(eligible("changes", {}), true);
  assert.equal(eligible("files-plus", { panels: [] }), true);
  assert.equal(eligible("graph", { panels: [] }), true);
  assert.equal(eligible("sc-1", OPTS), false);
});

test("findNode · locate", () => {
  const t = fixture({ right: ["files", "changes"], bottom: ["graph"] });
  assert.equal(findNode(t, "panel-body").id, "panel-body");
  assert.equal(findNode(t, "nope"), null);
  assert.deepEqual(locate(t, "changes"), { side: "right", stack: "panel-body", index: 1 });
  assert.deepEqual(locate(t, "graph"), { side: "bottom", stack: "panel-bottom", index: 0 });
  assert.equal(locate(t, "files-plus"), null);
  const dup = fixture({ right: ["files"], bottom: ["files"], dupOk: true });
  assert.deepEqual(locate(dup, "files"), { error: "dup" });
});

test("snapshot 기본 · chip/foreign 구분", () => {
  const t = fixture({ right: ["files", "sc-1", "changes", "graph"], bottom: [] });
  const s = snapOf(t, OPTS, ["graph"]);
  assert.equal(s.right.exists, true);
  assert.equal(s.right.shown, true);
  assert.equal(s.right.active, "files");
  assert.deepEqual(s.right.chips, ["files", "changes"]);
  assert.deepEqual(s.right.foreign, ["sc-1"]);
  assert.equal(s.bottom.shown, false);
  assert.equal(s.bottom.active, null);
});

test("snapshot 숨긴 Files 는 chip 아님", () => {
  const s = snapOf(fixture(), { ...OPTS, hideFiles: true });
  assert.deepEqual(s.right.chips, ["files-plus", "changes", "graph"]);
});

test("snapshot 꺼진 Changes 는 chip 아님", () => {
  const s = snapOf(fixture(), { panels: ["files"], hideFiles: false });
  assert.deepEqual(s.right.chips, ["files", "files-plus", "graph"]);
});

test("panel-bottom 없음 → exists false, 계획에서 건너뜀", () => {
  const t = fixture({ withBottom: false });
  const s = snapOf(t);
  assert.equal(s.bottom.exists, false);
  const r = planRestore(s, { right: { shown: true, active: "changes" }, bottom: { shown: true, active: "graph" } });
  assert.equal(r.ops.every(o => o.args.stack !== "panel-bottom" && o.args.id !== "panel-bottom"), true);
  assert.equal("bottom" in r.expect, false);
  assert.deepEqual(planNormalize(s).ops, []);
});

test("matches 부분 비교", () => {
  const s = snapOf(fixture());
  assert.equal(matches(s, {}), true);
  assert.equal(matches(s, { right: { active: "files" } }), true);
  assert.equal(matches(s, { right: { active: "graph" } }), false);
  assert.equal(matches(s, { right: { chips: ["files", "files-plus", "changes", "graph"] } }), true);
  assert.equal(matches(s, { right: { chips: ["files"] } }), false);
  assert.equal(matches(undefined, { right: {} }), false);
});

test("recordOf", () => {
  const s = snapOf(fixture({ bottom: ["graph"], bottomHidden: false }));
  assert.deepEqual(recordOf(s), { right: { shown: true, active: "files" }, bottom: { shown: true, active: "graph" } });
  const n = snapOf(fixture({ withBottom: false }));
  assert.deepEqual(recordOf(n).bottom, { shown: false, active: null });
});

// ---- planRestore ----
test("restore 기록 없음 → 둘 다 닫힘", () => {
  const t = fixture({ bottom: ["graph"], bottomHidden: false });
  const p = planRestore(snapOf(t), undefined);
  assert.deepEqual(p.ops, [{ cmd: "layout.hide", args: { id: "panel" } }, { cmd: "layout.hide", args: { id: "panel-bottom" } }]);
  assert.deepEqual(p.expect, { right: { shown: false }, bottom: { shown: false } });
});

test("restore 이미 닫힘 + 기록 없음 → ops 없음", () => {
  const t = fixture({ panelHidden: true });
  assert.deepEqual(planRestore(snapOf(t), undefined).ops, []);
});

test("restore 기록대로 select + show", () => {
  const t = fixture({ panelHidden: true });
  const p = planRestore(snapOf(t), { right: { shown: true, active: "changes" } });
  assert.deepEqual(p.ops, [
    { cmd: "layout.select", args: { stack: "panel-body", child: "changes" } },
    { cmd: "layout.show", args: { id: "panel" } },
  ]);
  assert.deepEqual(p.expect.right, { shown: true, active: "changes" });
});

test("restore 이미 맞으면 ops 없음", () => {
  const t = fixture({ panelHidden: false });
  assert.deepEqual(planRestore(snapOf(t), { right: { shown: true, active: "files" } }).ops, []);
});

test("restore 기록 active 가 고를 수 없으면 현재 active 유지", () => {
  const t = fixture({ rActive: "graph" });
  const p = planRestore(snapOf(t), { right: { shown: true, active: "zzz" } });
  assert.deepEqual(p.ops, []);
});

test("restore 기록 active 도 현재 active 도 못 고르면 chips[0]", () => {
  const t = fixture({ rActive: "files" });
  const p = planRestore(snapOf(t, { ...OPTS, hideFiles: true }), { right: { shown: true, active: "files" } });
  assert.deepEqual(p.ops, [{ cmd: "layout.select", args: { stack: "panel-body", child: "files-plus" } }]);
});

test("restore 고를 것 없음 → hide", () => {
  const t = fixture({ right: [], rActive: undefined });
  const p = planRestore(snapOf(t), { right: { shown: true, active: "files" } });
  assert.deepEqual(p.ops, [{ cmd: "layout.hide", args: { id: "panel" } }]);
});

test("restore foreign active 유지(M0-d)", () => {
  const t = fixture({ right: ["files", "sc-1"], rActive: "sc-1", panelHidden: true });
  const p = planRestore(snapOf(t), { right: { shown: true, active: "sc-1" } });
  assert.deepEqual(p.ops, [{ cmd: "layout.show", args: { id: "panel" } }]);
  const p2 = planRestore(snapOf(fixture({ right: ["files", "sc-1"], rActive: "sc-1" })), { right: { shown: true, active: "sc-1" } });
  assert.deepEqual(p2.ops, []);
});

test("restore 아래쪽도 처리", () => {
  const t = fixture({ bottom: ["graph", "changes"], bActive: "graph" });
  const p = planRestore(snapOf(t), { right: { shown: true, active: "files" }, bottom: { shown: true, active: "changes" } });
  assert.deepEqual(p.ops, [
    { cmd: "layout.select", args: { stack: "panel-bottom", child: "changes" } },
    { cmd: "layout.show", args: { id: "panel-bottom" } },
  ]);
});

test("restore 멱등", () => {
  const t = fixture({ panelHidden: true });
  const rec = { right: { shown: true, active: "graph" }, bottom: { shown: false, active: null } };
  const p = planRestore(snapOf(t), rec);
  const t2 = fixture({ panelHidden: false, rActive: "graph" });
  assert.equal(matches(snapOf(t2), p.expect), true);
  assert.deepEqual(planRestore(snapOf(t2), rec).ops, []);
});

// ---- planNormalize ----
test("normalize 보이는 빈 쪽 → hide", () => {
  const t = fixture({ right: [], rActive: undefined });
  assert.deepEqual(planNormalize(snapOf(t)).ops, [{ cmd: "layout.hide", args: { id: "panel" } }]);
});

test("normalize 숨겨진 빈 쪽은 그대로", () => {
  const t = fixture({ right: [], rActive: undefined, panelHidden: true });
  assert.deepEqual(planNormalize(snapOf(t)).ops, []);
});

test("normalize 숨긴 Files active → 다른 chip", () => {
  const t = fixture({ rActive: "files" });
  const p = planNormalize(snapOf(t, { ...OPTS, hideFiles: true }));
  assert.deepEqual(p.ops, [{ cmd: "layout.select", args: { stack: "panel-body", child: "files-plus" } }]);
  assert.deepEqual(p.expect, { right: { active: "files-plus" } });
});

test("normalize 숨긴 Files 만 남음 → hide (chip 0, foreign 0)", () => {
  const t = fixture({ right: ["files"], rActive: "files" });
  const s = snapOf(t, { ...OPTS, hideFiles: true });
  assert.deepEqual(s.right.chips, []);
  assert.deepEqual(planNormalize(s).ops, [{ cmd: "layout.hide", args: { id: "panel" } }]);
});

test("normalize 닫힌 도구 active → chip", () => {
  const t = fixture({ rActive: "files" });
  const p = planNormalize(snapOf(t, OPTS, ["files"]));
  assert.deepEqual(p.ops, [{ cmd: "layout.select", args: { stack: "panel-body", child: "files-plus" } }]);
});

test("normalize 닫힌 active + chip 없음 + foreign → foreign 선택", () => {
  const t = fixture({ right: ["files", "sc-1"], rActive: "files" });
  const p = planNormalize(snapOf(t, OPTS, ["files"]));
  assert.deepEqual(p.ops, [{ cmd: "layout.select", args: { stack: "panel-body", child: "sc-1" } }]);
});

test("normalize foreign active 는 그대로", () => {
  const t = fixture({ right: ["sc-1", "files"], rActive: "sc-1" });
  assert.deepEqual(planNormalize(snapOf(t, OPTS, ["files"])).ops, []);
});

test("normalize foreign 만 있는 쪽은 비지 않음", () => {
  const t = fixture({ right: ["sc-1"], rActive: "sc-1" });
  assert.deepEqual(planNormalize(snapOf(t)).ops, []);
});

test("normalize 빈 스택(active 키 없음) 허용 · 멱등", () => {
  const t = fixture({ right: [], rActive: undefined, panelHidden: true });
  assert.deepEqual(planNormalize(snapOf(t)).ops, []);
  const t2 = fixture({ rActive: "files" });
  const p = planNormalize(snapOf(t2, { ...OPTS, hideFiles: true }));
  const t3 = fixture({ rActive: "files-plus" });
  assert.equal(matches(snapOf(t3, { ...OPTS, hideFiles: true }), p.expect), true);
  assert.deepEqual(planNormalize(snapOf(t3, { ...OPTS, hideFiles: true })).ops, []);
});

// ---- planToggle / planOpen / planClose ----
test("toggle 닫힌 도구 → open + closed 에서 뺌", () => {
  const t = fixture({ panelHidden: true, rActive: "files" });
  const p = planToggle(snapOf(t, OPTS, ["graph"]), ["graph"], "graph");
  assert.deepEqual(p.ops, [
    { cmd: "layout.select", args: { stack: "panel-body", child: "graph" } },
    { cmd: "layout.show", args: { id: "panel" } },
  ]);
  assert.deepEqual(p.closed, []);
  assert.deepEqual(p.expect, { right: { shown: true, active: "graph" } });
});

test("toggle 보이고 active → hide", () => {
  const p = planToggle(snapOf(fixture()), [], "files");
  assert.deepEqual(p.ops, [{ cmd: "layout.hide", args: { id: "panel" } }]);
  assert.deepEqual(p.expect, { right: { shown: false } });
});

test("toggle 숨김 상태 + 이미 active → show 만", () => {
  const p = planToggle(snapOf(fixture({ panelHidden: true })), [], "files");
  assert.deepEqual(p.ops, [{ cmd: "layout.show", args: { id: "panel" } }]);
});

test("toggle 보이지만 다른 탭 active → select 만", () => {
  const p = planToggle(snapOf(fixture()), [], "changes");
  assert.deepEqual(p.ops, [{ cmd: "layout.select", args: { stack: "panel-body", child: "changes" } }]);
});

test("toggle 아래쪽 도구는 아래쪽 노드로", () => {
  const t = fixture({ right: ["files"], bottom: ["graph"], bActive: "graph" });
  const p = planToggle(snapOf(t), [], "graph");
  assert.deepEqual(p.ops, [{ cmd: "layout.show", args: { id: "panel-bottom" } }]);
  const p2 = planToggle(snapOf(fixture({ right: ["files"], bottom: ["graph", "changes"], bActive: "changes" })), [], "graph");
  assert.deepEqual(p2.ops, [{ cmd: "layout.select", args: { stack: "panel-bottom", child: "graph" } }, { cmd: "layout.show", args: { id: "panel-bottom" } }]);
});

test("toggle 모르는 id · 못 여는 도구 → 무동작", () => {
  const s = snapOf(fixture(), { ...OPTS, hideFiles: true });
  assert.deepEqual(planToggle(s, [], "zzz").ops, []);
  assert.deepEqual(planToggle(s, [], "files").ops, []);
  assert.deepEqual(planToggle(s, ["files"], "files").ops, []);
});

test("toggle 중복 id(dup) → 무동작", () => {
  const t = fixture({ right: ["files"], bottom: ["files"], dupOk: true });
  assert.deepEqual(planToggle(snapOf(t), [], "files").ops, []);
});

test("open 이미 보이는 active → ops 없음, closed 만 정리", () => {
  const t = fixture();
  const p = planOpen(snapOf(t), ["files-plus"], "files");
  assert.deepEqual(p.ops, []);
  assert.deepEqual(p.closed, ["files-plus"]);
});

test("open 닫힌 도구: 원래 스택 안에서 select (블록 이동 없음)", () => {
  const t = fixture({ right: ["files"], bottom: ["graph", "changes"], bActive: "changes" });
  const p = planOpen(snapOf(t, OPTS, ["graph"]), ["graph"], "graph");
  assert.deepEqual(p.ops, [
    { cmd: "layout.select", args: { stack: "panel-bottom", child: "graph" } },
    { cmd: "layout.show", args: { id: "panel-bottom" } },
  ]);
  assert.deepEqual(p.closed, []);
});

test("close active 칩 → 다음 chip", () => {
  const p = planClose(snapOf(fixture({ rActive: "files" })), [], "files");
  assert.deepEqual(p.ops, [{ cmd: "layout.select", args: { stack: "panel-body", child: "files-plus" } }]);
  assert.deepEqual(p.closed, ["files"]);
});

test("close 마지막 위치 active → 이전 chip", () => {
  const p = planClose(snapOf(fixture({ rActive: "graph" })), [], "graph");
  assert.deepEqual(p.ops, [{ cmd: "layout.select", args: { stack: "panel-body", child: "changes" } }]);
});

test("close 닫힌 도구 건너뛰고 다음 chip", () => {
  const p = planClose(snapOf(fixture({ rActive: "files" }), OPTS, ["files-plus"]), ["files-plus"], "files");
  assert.deepEqual(p.ops, [{ cmd: "layout.select", args: { stack: "panel-body", child: "changes" } }]);
  assert.deepEqual(p.closed, ["files-plus", "files"]);
});

test("close 마지막 chip → hide", () => {
  const t = fixture({ right: ["files-plus"], rActive: "files-plus" });
  const p = planClose(snapOf(t), [], "files-plus");
  assert.deepEqual(p.ops, [{ cmd: "layout.hide", args: { id: "panel" } }]);
  assert.deepEqual(p.expect, { right: { shown: false } });
});

test("close chip 없고 foreign 있음 → foreign 선택", () => {
  const t = fixture({ right: ["files-plus", "sc-1"], rActive: "files-plus" });
  const p = planClose(snapOf(t), [], "files-plus");
  assert.deepEqual(p.ops, [{ cmd: "layout.select", args: { stack: "panel-body", child: "sc-1" } }]);
});

test("close 비활성 칩 → ops 없음, closed 만", () => {
  const p = planClose(snapOf(fixture()), [], "graph");
  assert.deepEqual(p.ops, []);
  assert.deepEqual(p.closed, ["graph"]);
});

test("close 이미 닫힌 것 → 멱등", () => {
  const p = planClose(snapOf(fixture(), OPTS, ["graph"]), ["graph"], "graph");
  assert.deepEqual(p.ops, []);
  assert.deepEqual(p.closed, ["graph"]);
});

test("close foreign active 는 건드리지 않음", () => {
  const t = fixture({ right: ["files", "sc-1"], rActive: "sc-1" });
  assert.deepEqual(planClose(snapOf(t), [], "files").ops, []);
});

test("close 모르는 id 무시", () => {
  const p = planClose(snapOf(fixture()), [], "sc-1");
  assert.deepEqual(p.ops, []);
  assert.deepEqual(p.closed, []);
});

test("close 숨은 쪽에서 active 였던 칩도 이웃으로 옮김", () => {
  const t = fixture({ panelHidden: true, rActive: "files" });
  const p = planClose(snapOf(t), [], "files");
  assert.deepEqual(p.ops, [{ cmd: "layout.select", args: { stack: "panel-body", child: "files-plus" } }]);
});

test("close 후 상태에서 normalize/close 재계획 → ops 없음", () => {
  const t = fixture({ rActive: "files" });
  const p = planClose(snapOf(t), [], "files");
  const t2 = fixture({ rActive: "files-plus" });
  assert.equal(matches(snapOf(t2, OPTS, p.closed), p.expect), true);
  assert.deepEqual(planClose(snapOf(t2, OPTS, p.closed), p.closed, "files").ops, []);
  assert.deepEqual(planNormalize(snapOf(t2, OPTS, p.closed)).ops, []);
});

// ---- moveTree ----
const move = (t, id, dest, opts = OPTS, closed = []) => moveTree(t, id, dest, opts, closed);

test("move 입력 불변", () => {
  const t = fixture({ bottom: ["graph"] });
  const before = structuredClone(t);
  move(t, "changes", "bottom");
  move(t, "graph", "right");
  move(t, "nope", "bottom");
  assert.deepEqual(t, before);
});

test("move 블록을 대상 스택 끝으로 · 활성 · 보임", () => {
  const t = fixture({ bottom: ["graph"], bActive: "graph" });
  const r = move(t, "changes", "bottom");
  const b = findNode(r.tree, "panel-bottom");
  assert.deepEqual(b.children.map(c => c.id), ["graph", "changes"]);
  assert.equal(b.active, "changes");
  assert.equal(b.hidden, false);
  assert.deepEqual(findNode(r.tree, "panel-body").children.map(c => c.id), ["files", "files-plus"]);
  assert.deepEqual(r.expect.bottom, { shown: true, active: "changes" });
});

test("move 후 id 유일", () => {
  const t = fixture({ bottom: ["graph"] });
  for (const [id, d] of [["changes", "bottom"], ["graph", "right"]]) {
    const ids = allIds(move(t, id, d).tree);
    assert.equal(new Set(ids).size, ids.length);
  }
});

test("move 블록 내용 그대로(모든 필드)", () => {
  const rich = { id: "files-plus", type: "block", content: { mod: "files-plus", props: { a: [1, { b: 2 }] } }, size: { weight: 1 }, extra: "x", min: 5 };
  const t = fixture({ right: ["files", rich, "changes"], rActive: "files" });
  const r = move(t, "files-plus", "bottom");
  assert.deepEqual(findNode(r.tree, "files-plus"), rich);
});

test("move 무관 노드는 바이트 단위로 동일", () => {
  const t = fixture({ bottom: ["graph"] });
  const r = move(t, "changes", "bottom");
  for (const id of ["sidebar", "tabs", "main", "status"]) assert.equal(J(findNode(r.tree, id)), J(findNode(t, id)), id);
  const { children: _a, ...pa } = findNode(r.tree, "panel"), { children: _b, ...pb } = findNode(t, "panel");
  assert.equal(J(pa), J(pb));
  const { children: _c, ...wa } = findNode(r.tree, "work-body"), { children: _d, ...wb } = findNode(t, "work-body");
  assert.equal(J(wa), J(wb));
  // 스택 자체의 size/header/type 도 그대로
  const a = findNode(r.tree, "panel-bottom"), b = findNode(t, "panel-bottom");
  assert.equal(J(a.size), J(b.size)); assert.equal(J(a.header), J(b.header));
  assert.equal(J(findNode(r.tree, "panel-body").header), J(findNode(t, "panel-body").header));
});

test("move 원래 active 였으면 이웃 chip 으로", () => {
  const t = fixture({ rActive: "files-plus" });
  const r = move(t, "files-plus", "bottom");
  assert.equal(findNode(r.tree, "panel-body").active, "changes");
  assert.deepEqual(r.expect.right, { active: "changes" });
  assert.equal(findNode(r.tree, "panel").hidden, false);
});

test("move 원래 active 가 마지막이면 앞 chip", () => {
  const r = move(fixture({ rActive: "graph" }), "graph", "bottom");
  assert.equal(findNode(r.tree, "panel-body").active, "changes");
});

test("move active 가 아니면 원래 active 유지", () => {
  const r = move(fixture({ rActive: "files" }), "graph", "bottom");
  assert.equal(findNode(r.tree, "panel-body").active, "files");
  assert.equal("right" in r.expect, false);
});

test("move 이웃 없음 + foreign 있으면 foreign 선택", () => {
  const t = fixture({ right: ["files-plus", "sc-1"], rActive: "files-plus" });
  const r = move(t, "files-plus", "bottom");
  assert.equal(findNode(r.tree, "panel-body").active, "sc-1");
  assert.equal(findNode(r.tree, "panel").hidden, false);
});

test("move 마지막 chip → 원래 쪽 hide, active=첫 남은 자식", () => {
  const t = fixture({ right: ["files-plus", "files"], rActive: "files-plus" });
  const r = move(t, "files-plus", "bottom", { ...OPTS, hideFiles: true });
  assert.equal(findNode(r.tree, "panel").hidden, true);
  assert.equal(findNode(r.tree, "panel-body").active, "files");
  assert.deepEqual(r.expect.right, { shown: false, active: "files" });
});

test("move 빈 스택이 되면 active 키 삭제 · 스택 비어도 허용", () => {
  const t = fixture({ right: ["graph"], rActive: "graph" });
  const r = move(t, "graph", "bottom");
  const s = findNode(r.tree, "panel-body");
  assert.deepEqual(s.children, []);
  assert.equal("active" in s, false);
  assert.equal(findNode(r.tree, "panel").hidden, true);
  assert.deepEqual(r.expect.right, { shown: false, active: null });
  assert.equal(matches(snapOf(r.tree), r.expect), true);
});

test("move 아래 → 오른쪽: 아래 스택이 보임 노드라 hidden 직접", () => {
  const t = fixture({ right: ["files"], bottom: ["graph"], bActive: "graph", bottomHidden: false });
  const r = move(t, "graph", "right");
  assert.equal(findNode(r.tree, "panel-bottom").hidden, true);
  assert.equal(findNode(r.tree, "panel-body").active, "graph");
  assert.equal(findNode(r.tree, "panel").hidden, false);
});

test("move closed 에서 id 제거", () => {
  const r = move(fixture(), "graph", "bottom", OPTS, ["graph", "files"]);
  assert.deepEqual(r.closed, ["files"]);
});

test("move closed 도구는 이웃 후보 아님", () => {
  const t = fixture({ rActive: "files" });
  const r = move(t, "files", "bottom", OPTS, ["files-plus"]);
  assert.equal(findNode(r.tree, "panel-body").active, "changes");
});

test("move 오류: 모르는 id · 모르는 dest · 같은 쪽 · dup · missing", () => {
  const t = fixture({ bottom: ["graph"] });
  assert.deepEqual(move(t, "sc-1", "bottom"), { error: "unknown-id" });
  assert.deepEqual(move(t, "changes", "top"), { error: "no-dest" });
  assert.deepEqual(move(t, "changes", undefined), { error: "no-dest" });
  assert.deepEqual(move(t, "changes", "toString"), { error: "no-dest" });
  assert.deepEqual(move(fixture({ withBottom: false }), "changes", "bottom"), { error: "no-dest" });
  assert.deepEqual(move(t, "changes", "right"), { error: "same-side" });
  assert.deepEqual(move(fixture({ right: ["files"], bottom: ["files"], dupOk: true }), "files", "bottom"), { error: "dup" });
  assert.deepEqual(move(fixture({ right: ["files"] }), "graph", "bottom"), { error: "missing" });
});

test("move 멱등: 결과에 다시 계획해도 ops 없음", () => {
  const t = fixture({ bottom: ["graph"] });
  const r = move(t, "changes", "bottom");
  const s = snapOf(r.tree, OPTS, r.closed);
  assert.equal(matches(s, r.expect), true);
  assert.deepEqual(planNormalize(s).ops, []);
  assert.deepEqual(planRestore(s, recordOf(s)).ops, []);
  assert.deepEqual(move(r.tree, "changes", "bottom"), { error: "same-side" });
});

test("move 왕복 후 블록 동일", () => {
  const t = fixture();
  const a = move(t, "graph", "bottom");
  const b = move(a.tree, "graph", "right");
  assert.deepEqual(findNode(b.tree, "graph"), findNode(t, "graph"));
});

test("STRIP 은 복사본의 루트와 하위에서 필드를 지움", () => {
  const t = fixture({ bottom: ["graph"] });
  t.runtime = 1;
  findNode(t, "main").runtime = 2;
  findNode(t, "graph").runtime = 3;
  const before = structuredClone(t);
  STRIP.push("runtime");
  try {
    const r = move(t, "changes", "bottom");
    assert.deepEqual(t, before);
    assert.equal("runtime" in r.tree, false);
    assert.equal("runtime" in findNode(r.tree, "main"), false);
    assert.equal("runtime" in findNode(r.tree, "graph"), false);
    assert.equal(findNode(r.tree, "changes").id, "changes");
  } finally { STRIP.length = 0; }
  const r2 = move(t, "changes", "bottom");
  assert.equal(r2.tree.runtime, 1);
  assert.equal(findNode(r2.tree, "main").runtime, 2);
});

// ---- parseCommand ----
test("parseCommand 표", () => {
  const rows = [
    ["files", { op: "toggle", id: "files" }],
    ["graph", { op: "toggle", id: "graph" }],
    ["toggle:changes", { op: "toggle", id: "changes" }],
    ["open:files-plus", { op: "open", id: "files-plus" }],
    ["close:graph", { op: "close", id: "graph" }],
    ["move:graph:bottom", { op: "move", id: "graph", side: "bottom" }],
    ["move:files:right", { op: "move", id: "files", side: "right" }],
    ["  files-plus ", { op: "toggle", id: "files-plus" }],
    ["move:graph:top", null],
    ["move:graph", null],
    ["move:graph:bottom:x", null],
    ["move:zzz:bottom", null],
    ["close:zzz", null],
    ["open:", null],
    ["toggle:", null],
    ["zzz", null],
    ["", null],
    ["constructor", null],
    ["close:graph:x", null],
    ["foo:graph", null],
    [undefined, null],
    [42, null],
  ];
  for (const [inp, out] of rows) assert.deepEqual(parseCommand(inp), out, String(inp));
});

// ---- 상태 ----
test("loadState v2 정상", () => {
  const v2 = { v: 2, spaces: { a: { right: { shown: true, active: "files" }, bottom: { shown: false, active: null } } } };
  assert.deepEqual(loadState(J(v2), undefined), v2);
});

test("loadState v2 가 v1 보다 우선", () => {
  const out = loadState(J({ v: 2, spaces: {} }), J({ a: "files" }));
  assert.deepEqual(out, { v: 2, spaces: {} });
});

test("loadState v1 이관", () => {
  const out = loadState(null, J({ a: "changes", b: null, c: 5, d: "" }));
  assert.deepEqual(out, { v: 2, spaces: {
    a: { right: { shown: true, active: "changes" }, bottom: { shown: false, active: null } },
    b: { right: { shown: false, active: null }, bottom: { shown: false, active: null } },
  } });
});

test("loadState v2 깨짐/잘못된 꼴 → v1 이관", () => {
  for (const bad of ["{oops", J({ v: 1, spaces: {} }), J({ v: 2 }), J({ v: 2, spaces: [] }), "null", ""]) {
    assert.deepEqual(loadState(bad, J({ a: "graph" })).spaces.a.right, { shown: true, active: "graph" }, bad);
  }
});

test("loadState 둘 다 깨짐 → 빈 상태", () => {
  assert.deepEqual(loadState("{x", "[[["), { v: 2, spaces: {} });
  assert.deepEqual(loadState(undefined, undefined), { v: 2, spaces: {} });
  assert.deepEqual(loadState(null, J([1, 2])), { v: 2, spaces: {} });
  assert.deepEqual(loadState(null, "7"), { v: 2, spaces: {} });
});

test("loadState 잘못된 항목 제거 · 쪽 기본값", () => {
  const raw = { v: 2, spaces: {
    ok: { right: { shown: true, active: "files" }, bottom: { shown: true, active: "graph" } },
    bad1: 5, bad2: null, bad3: [],
    half: { right: { shown: "yes", active: "files" }, bottom: { shown: true, active: 7 } },
    none: {},
  } };
  const out = loadState(J(raw), null);
  assert.deepEqual(Object.keys(out.spaces).sort(), ["half", "none", "ok"]);
  assert.deepEqual(out.spaces.half, { right: { shown: false, active: null }, bottom: { shown: false, active: null } });
  assert.deepEqual(out.spaces.ok.bottom, { shown: true, active: "graph" });
});

test("loadState __proto__ 키 무시", () => {
  const out = loadState('{"v":2,"spaces":{"__proto__":{"right":{"shown":true,"active":"files"}}}}', null);
  assert.deepEqual(out, { v: 2, spaces: {} });
  assert.equal(({}).right, undefined);
});

test("saveState ↔ loadState 왕복 · 잘못된 입력", () => {
  const st = { v: 2, spaces: { a: { right: { shown: true, active: "files" }, bottom: { shown: false, active: null } } } };
  assert.deepEqual(loadState(saveState(st), null), st);
  assert.deepEqual(JSON.parse(saveState(undefined)), { v: 2, spaces: {} });
  assert.deepEqual(JSON.parse(saveState({ spaces: { x: 3 } })), { v: 2, spaces: {} });
});

test("validClosed", () => {
  assert.deepEqual(validClosed(["files", "files", "zzz", 3, "graph"]), ["files", "graph"]);
  assert.deepEqual(validClosed(undefined), []);
  assert.deepEqual(validClosed("files"), []);
});

test("기록 없는 공간 = 첫 공간 포함 둘 다 닫힘, state 조회 없음", () => {
  const st = loadState(null, null);
  const t = fixture({ bottom: ["graph"], bottomHidden: false });
  const p = planRestore(snapOf(t), st.spaces["first"]);
  assert.deepEqual(p.expect, { right: { shown: false }, bottom: { shown: false } });
  assert.equal(p.ops.length, 2);
});

// ---------------- owner.js 컨트롤러 (가짜 호스트) ----------------
const REC_CLOSED = { shown: false, active: null };
const v2 = (spaces) => JSON.stringify({ v: 2, spaces });
// mode: "land" = ops 즉시 반영 · "hold" = land() 때 반영 · "drop" = 영영 반영 안 됨
function mkHost({ tree = fixture(), panels = ["files", "changes"], hideFiles = false, store = {}, shared = {}, mode = "land" } = {}) {
  const h = { tree, t: 1000, runs: [], notes: [], writes: [], sets: [], store: { ...store }, shared: { ...shared }, held: [], mode, panels };
  const apply = (op) => {
    const { cmd, args } = op;
    if (cmd === "layout.select") findNode(h.tree, args.stack).active = args.child;
    else if (cmd === "layout.show") findNode(h.tree, args.id).hidden = false;
    else if (cmd === "layout.hide") findNode(h.tree, args.id).hidden = true;
    else if (cmd === "layout.set") h.tree = JSON.parse(JSON.stringify(args.layout));
  };
  h.owner = new Owner({
    run: (cmd, args) => {
      h.runs.push({ cmd, args });
      if (h.mode === "land") apply({ cmd, args });
      else if (h.mode === "hold") h.held.push({ cmd, args });
    },
    notify: (n) => h.notes.push(n),
    now: () => h.t,
    storage: { get: (k) => h.store[k] ?? null, set: (k, v) => { h.writes.push([k, v]); h.store[k] = v; } },
    setShared: (k, v) => { h.sets.push([k, v]); h.shared[k] = v; },
    getShared: (k) => h.shared[k],
    hideFiles,
  });
  h.tick = (space = "s1") => h.owner.tick(h.tree, space, { panels: h.panels });
  h.land = () => { h.held.splice(0).forEach(apply); };
  h.sets_of = (key) => h.sets.filter(([k]) => k === key);
  h.cmds = () => h.runs.map((r) => r.cmd);
  return h;
}
const RIGHT_FILES = { right: { shown: true, active: "files" }, bottom: REC_CLOSED };

test("owner: toggle = select+show, 기대 트리 확인 뒤에야 끝", () => {
  const h = mkHost({ tree: fixture({ panelHidden: true }), store: { "panels.v2": v2({ s1: { right: REC_CLOSED, bottom: REC_CLOSED } }) }, mode: "hold" });
  assert.equal(h.tick().repoll, false);
  h.owner.command("changes");
  assert.equal(h.tick().repoll, true);
  assert.deepEqual(h.runs, [
    { cmd: "layout.select", args: { stack: "panel-body", child: "changes" } },
    { cmd: "layout.show", args: { id: "panel" } },
  ]);
  assert.equal(h.tick().repoll, true); // 아직 안 닿음
  assert.equal(h.runs.length, 2);
  h.land();
  const r = h.tick();
  assert.equal(r.repoll, false);
  assert.deepEqual([...r.on], ["changes"]);
});

test("owner: 옮기기 둘 연달아 — 두 번째 set 은 첫째가 닿은 뒤, 최신 트리로", () => {
  const h = mkHost({ store: { "panels.v2": v2({ s1: { right: { shown: true, active: "files" }, bottom: REC_CLOSED } }) }, mode: "hold" });
  h.tick();
  h.owner.command("move:files:bottom");
  h.owner.command("move:changes:bottom");
  h.tick(); h.tick();
  assert.deepEqual(h.cmds(), ["layout.set"]);
  h.land();
  h.tick();
  assert.deepEqual(h.cmds(), ["layout.set", "layout.set"]);
  const second = findNode(h.runs[1].args.layout, "panel-bottom").children.map((c) => c.id);
  assert.deepEqual(second, ["files", "changes"]);
  assert.equal(h.notes.length, 0);
});

test("F5 owner: 늦게 닿은 set 보존 · 큐 취소 · 안정 뒤 최신 트리로 재개", () => {
  const h = mkHost({ store: { "panels.v2": v2({ s1: RIGHT_FILES }) }, mode: "hold" });
  h.tick();
  h.owner.command("move:files:bottom");
  h.owner.command("move:graph:bottom");
  h.tick();
  h.t += 2000;
  assert.equal(h.tick().repoll, true);
  assert.deepEqual(h.cmds(), ["layout.set"]);
  assert.deepEqual(h.notes, [{ title: "옮기기 실패", body: "옮기기가 늦어 멈춤 — 다시 한다", level: "error" }]);
  h.owner.command("move:changes:bottom");
  h.t += 500; h.tick();
  assert.deepEqual(h.cmds(), ["layout.set"]);
  h.land(); // 첫 set 이 시간 넘긴 뒤 닿음
  h.tick();
  h.t += 1999; h.tick();
  assert.deepEqual(h.cmds(), ["layout.set"]);
  h.t += 1; h.tick();
  assert.deepEqual(h.cmds(), ["layout.set", "layout.set"]);
  assert.deepEqual(findNode(h.runs[1].args.layout, "panel-bottom").children.map(c => c.id), ["files", "changes"]);
  h.land(); h.tick();
  assert.equal(locate(h.tree, "files").side, "bottom");
  assert.equal(locate(h.tree, "changes").side, "bottom");
  assert.equal(locate(h.tree, "graph").side, "right");
  assert.equal(h.notes.length, 1);
});

test("F5 owner: 격리 중 move 뒤의 close 명령도 계속", () => {
  const h = mkHost({ store: { "panels.v2": v2({ s1: RIGHT_FILES }) }, mode: "drop" });
  h.tick();
  h.owner.command("move:files:bottom"); h.tick();
  h.t += 2000; h.tick();
  h.owner.command("move:changes:bottom");
  h.owner.command("close:files"); h.tick();
  assert.deepEqual(h.shared["panel-tabs.closed"], ["files"]);
  assert.deepEqual(h.cmds(), ["layout.set", "layout.select"]);
});

test("F8 owner: 공간 A의 대기 toggle/open/close/restore/normalize는 공간 B에서 버림", () => {
  const h = mkHost({ store: { "panels.v2": v2({ s1: RIGHT_FILES, s2: RIGHT_FILES }) }, mode: "hold" });
  h.tick("s1");
  h.owner.command("changes"); h.tick("s1");
  h.owner.command("graph");
  h.owner.command("open:graph");
  h.owner.command("close:files");
  h.owner.queue.push({ kind: "restore", space: "s1" }, { kind: "normalize", space: "s1" });
  h.tick("s2");
  assert.deepEqual(h.owner.queue, [{ kind: "restore", space: "s2" }]);
  h.land(); h.mode = "land";
  h.tick("s2"); h.tick("s2");
  assert.equal(h.runs.some(r => r.args.child === "graph"), false);
  assert.equal(findNode(h.tree, "panel-body").active, "files");
  assert.deepEqual(h.shared["panel-tabs.closed"] ?? [], []);
  assert.deepEqual(h.notes, []);
});

test("F10 owner: 공간 A의 대기 move는 공간 B에서 실행, toggle은 버림", () => {
  const h = mkHost({ store: { "panels.v2": v2({ s1: RIGHT_FILES, s2: RIGHT_FILES }) } });
  h.tick("s1");
  h.owner.command("move:files:bottom");
  h.owner.command("graph");
  h.tick("s2");
  assert.equal(h.owner.cur.kind, "move");
  assert.equal(h.owner.cur.space, "s2");
  h.tick("s2");
  assert.deepEqual(h.cmds(), ["layout.set"]);
  assert.equal(locate(h.tree, "files").side, "bottom");
  assert.equal(findNode(h.tree, "panel-bottom").active, "files");
  assert.equal(h.runs.some(r => r.args.child === "graph"), false);
  assert.equal(h.owner.queue.length, 0);
  assert.deepEqual(h.notes, []);
});

test("F7 owner: 시작과 beat만 heartbeat 시각 갱신", () => {
  const h = mkHost({ store: { "panels.v2": v2({ s1: RIGHT_FILES }) }, shared: { "panel-tabs.owner": { v: 2, hideFiles: false, bottom: true, t: 1 } } });
  h.tick();
  assert.equal(h.shared["panel-tabs.owner"].t, 1000);
  h.t += 19999; h.tick();
  assert.equal(h.shared["panel-tabs.owner"].t, 1000);
  h.t += 1; h.owner.beat();
  assert.equal(h.shared["panel-tabs.owner"].t, 21000);
  assert.equal(h.sets_of("panel-tabs.owner").length, 2);
});

test("owner: move 말고 시간 넘김은 조용함", () => {
  const h = mkHost({ tree: fixture({ panelHidden: true }), store: { "panels.v2": v2({ s1: { right: REC_CLOSED, bottom: REC_CLOSED } }) }, mode: "drop" });
  h.tick();
  h.owner.command("files");
  h.tick(); h.t += 1001; h.tick();
  assert.equal(h.notes.length, 0);
  assert.equal(h.owner.cur, null);
});

test("owner: 옮기는 중 공간 바뀜 → 닿은 뒤 새 공간 restore, 그동안 기록 안 함", () => {
  const h = mkHost({
    store: { "panels.v2": v2({ s1: RIGHT_FILES, s2: { right: { shown: true, active: "changes" }, bottom: REC_CLOSED } }) },
    mode: "hold",
  });
  h.tick("s1");
  h.owner.command("move:files:bottom");
  h.tick("s1");
  const w0 = h.writes.length;
  h.tick("s2");
  assert.deepEqual(h.cmds(), ["layout.set"]);
  assert.equal(h.writes.length, w0);
  h.land();
  h.mode = "land";
  h.tick("s2");
  assert.deepEqual(h.runs.slice(1).map((r) => [r.cmd, r.args.stack ?? r.args.id]), [["layout.select", "panel-body"], ["layout.hide", "panel-bottom"]]);
  assert.equal(h.runs[1].args.child, "changes");
  h.tick("s2");
  assert.equal(h.owner.cur, null);
  const saved = JSON.parse(h.store["panels.v2"]);
  assert.deepEqual([saved.spaces.s2.right, saved.spaces.s2.bottom.shown], [{ shown: true, active: "changes" }, false]);
});

test("owner: 기록은 대기 중엔 안 하고 닿은 뒤 1번", () => {
  const h = mkHost({ tree: fixture({ panelHidden: true }), store: { "panels.v2": v2({ s1: { right: REC_CLOSED, bottom: REC_CLOSED } }) }, mode: "hold" });
  h.tick();
  const w0 = h.writes.length;
  h.owner.command("changes");
  h.tick(); h.tick();
  assert.equal(h.writes.length, w0);
  h.land();
  h.tick();
  assert.equal(h.writes.length, w0 + 1);
  assert.deepEqual(JSON.parse(h.store["panels.v2"]).spaces.s1.right, { shown: true, active: "changes" });
  h.tick();
  assert.equal(h.writes.length, w0 + 1);
});

test("owner: 첫 공간 예외 없음 — 기록 없음이면 둘 다 숨김", () => {
  const h = mkHost({ tree: fixture({ bottom: ["graph"], bottomHidden: false }) });
  h.tick();
  assert.deepEqual(h.runs, [{ cmd: "layout.hide", args: { id: "panel" } }, { cmd: "layout.hide", args: { id: "panel-bottom" } }]);
  h.tick();
  const rec = JSON.parse(h.store["panels.v2"]).spaces.s1;
  assert.deepEqual([rec.right.shown, rec.bottom.shown], [false, false]);
});

test("owner: v1 `panels` 이관 · 옛 키는 안 씀", () => {
  const h = mkHost({ tree: fixture({ panelHidden: true }), store: { panels: JSON.stringify({ s1: "changes", s2: null }) } });
  h.tick("s1");
  assert.deepEqual(h.runs, [
    { cmd: "layout.select", args: { stack: "panel-body", child: "changes" } },
    { cmd: "layout.show", args: { id: "panel" } },
  ]);
  h.tick("s1");
  assert.ok(h.writes.length === 0 || h.writes.every(([k]) => k === "panels.v2"));
  h.tick("s2"); h.tick("s2");
  assert.ok(h.writes.length > 0 && h.writes.every(([k]) => k === "panels.v2"));
  const saved = JSON.parse(h.store["panels.v2"]);
  assert.equal(saved.v, 2);
  assert.deepEqual(saved.spaces.s1.right, { shown: true, active: "changes" });
  assert.equal(saved.spaces.s2.right.shown, false);
  assert.equal(h.store.panels, JSON.stringify({ s1: "changes", s2: null }));
});

test("owner: foreign active 는 건드리지 않고 기록 그대로", () => {
  const h = mkHost({
    tree: fixture({ right: ["files", "sc-1"], rActive: "sc-1" }), hideFiles: true,
    store: { "panels.v2": v2({ s1: { right: { shown: true, active: "sc-1" }, bottom: REC_CLOSED } }) },
  });
  h.tick(); h.tick();
  assert.deepEqual(h.runs, []);
  assert.deepEqual(JSON.parse(h.store["panels.v2"]).spaces.s1.right, { shown: true, active: "sc-1" });
});

test("owner: 시간 넘긴 normalize 는 snapshot 이 바뀌기 전엔 다시 안 함", () => {
  const h = mkHost({
    tree: fixture({ right: ["files", "changes"], rActive: "changes" }), hideFiles: true,
    store: { "panels.v2": v2({ s1: { right: { shown: true, active: "changes" }, bottom: REC_CLOSED } }) },
    mode: "drop",
  });
  h.tick();
  assert.equal(h.runs.length, 0);
  findNode(h.tree, "panel-body").active = "files"; // 숨긴 Files 가 active → normalize 대상
  h.tick();
  assert.deepEqual(h.runs, [{ cmd: "layout.select", args: { stack: "panel-body", child: "changes" } }]);
  h.t += 1001; h.tick();
  assert.equal(h.notes.length, 0);
  for (let i = 0; i < 5; i++) { h.t += 1200; h.tick(); }
  assert.equal(h.runs.length, 1);
  findNode(h.tree, "panel-body").children.push(blk("sc-9")); // snapshot 변화
  h.tick();
  assert.equal(h.runs.length, 2);
});

test("owner: panel-tabs.owner · closed 는 값이 바뀔 때만 setShared", () => {
  const h = mkHost({ store: { "panels.v2": v2({ s1: RIGHT_FILES }) } });
  h.tick(); h.tick(); h.tick();
  assert.deepEqual(h.sets_of("panel-tabs.owner"), [["panel-tabs.owner", { v: 2, hideFiles: false, bottom: true, t: 1000 }]]);
  assert.equal(h.sets_of("panel-tabs.closed").length, 0);
  h.owner.command("close:graph");
  h.tick(); h.tick();
  assert.deepEqual(h.sets_of("panel-tabs.closed"), [["panel-tabs.closed", ["graph"]]]);
  h.owner.command("close:graph");
  h.tick(); h.tick();
  assert.equal(h.sets_of("panel-tabs.closed").length, 1);
  h.owner.command("open:graph");
  h.tick(); h.tick();
  assert.deepEqual(h.sets_of("panel-tabs.closed").at(-1), ["panel-tabs.closed", []]);
  assert.equal(h.sets_of("panel-tabs.owner").length, 1);
  const none = mkHost({ tree: fixture({ withBottom: false }) });
  none.tick();
  assert.deepEqual(none.sets_of("panel-tabs.owner")[0][1], { v: 2, hideFiles: false, bottom: false, t: 1000 });
});

test("owner: 마지막 chip 닫기 → 그 쪽 숨김", () => {
  const h = mkHost({
    tree: fixture({ right: ["changes"], rActive: "changes" }),
    store: { "panels.v2": v2({ s1: { right: { shown: true, active: "changes" }, bottom: REC_CLOSED } }) },
  });
  h.tick();
  h.owner.command("close:changes");
  h.tick();
  assert.deepEqual(h.runs, [{ cmd: "layout.hide", args: { id: "panel" } }]);
  h.tick();
  assert.equal(findNode(h.tree, "panel").hidden, true);
  assert.deepEqual(h.shared["panel-tabs.closed"], ["changes"]);
  assert.equal(JSON.parse(h.store["panels.v2"]).spaces.s1.right.shown, false);
});

test("owner: 모르는 명령은 무시", () => {
  const h = mkHost({ store: { "panels.v2": v2({ s1: RIGHT_FILES }) } });
  for (const c of ["bogus", "move:files:left", "close:zzz", "", "files:extra", undefined]) h.owner.command(c);
  h.tick(); h.tick();
  assert.deepEqual(h.runs, []);
  assert.deepEqual(h.notes, []);
});

test("owner: 같은 쪽으로 옮기기 = 열기", () => {
  const h = mkHost({ store: { "panels.v2": v2({ s1: RIGHT_FILES }) } });
  h.tick();
  h.owner.command("move:changes:right");
  h.tick();
  assert.deepEqual(h.runs, [{ cmd: "layout.select", args: { stack: "panel-body", child: "changes" } }]);
  assert.equal(h.notes.length, 0);
});

test("owner: 옮기기 오류는 한국어 알림", () => {
  const h = mkHost({ tree: fixture({ withBottom: false }), store: { "panels.v2": v2({ s1: RIGHT_FILES }) } });
  h.tick();
  h.owner.command("move:files:bottom");
  h.tick();
  assert.deepEqual(h.notes, [{ title: "옮기기 실패", body: "아래 패널이 없음 — 설치기를 다시 돌린다", level: "error" }]);
  const g = mkHost({ tree: fixture({ right: ["files"] }), store: { "panels.v2": v2({ s1: RIGHT_FILES }) } });
  g.tick();
  g.owner.command("move:graph:bottom");
  g.tick();
  assert.equal(g.notes[0].body, "도구를 찾을 수 없음");
  assert.deepEqual(g.runs, []);
});

for (const kind of ["column", "no-header", "no-children"]) {
  test(`F1 bottom ${kind}: snapshot/move/owner/menu 거절 · 입력 불변`, () => {
    const tree = fixture({ panelHidden: true });
    const bottom = findNode(tree, "panel-bottom");
    if (kind === "column") bottom.type = "column";
    else if (kind === "no-header") delete bottom.header;
    else delete bottom.children;
    const before = J(tree);
    assert.deepEqual(snapOf(tree).bottom, { exists: false, shown: false, active: null, children: [], ok: [], chips: [], foreign: [] });
    assert.deepEqual(moveTree(tree, "files", "bottom"), { error: "no-dest" });
    const h = mkHost({ tree });
    h.tick();
    assert.equal(h.shared["panel-tabs.owner"].bottom, false);
    h.owner.command("move:files:bottom"); h.tick();
    assert.equal(h.runs.length, 0);
    assert.equal(menuRows(tree, "panel-body", h.shared["panel-tabs.owner"], "tab", "files")[0].cmd, null);
    assert.equal(J(tree), before);
  });
}

test("F1 우리 bottom 은 snapshot/move/owner 사용 가능", () => {
  const tree = fixture({ panelHidden: true });
  assert.equal(snapOf(tree).bottom.exists, true);
  assert.equal(findNode(moveTree(tree, "files", "bottom").tree, "panel-bottom").active, "files");
  const h = mkHost({ tree }); h.tick();
  assert.equal(h.shared["panel-tabs.owner"].bottom, true);
});

test("F1 잘못된 오른쪽 stack/children 은 없는 쪽", () => {
  for (const kind of ["column", "no-children"]) {
    const tree = fixture({ bottom: ["graph"] });
    const body = findNode(tree, "panel-body");
    if (kind === "column") body.type = "column"; else delete body.children;
    assert.equal(snapOf(tree).right.exists, false);
    assert.deepEqual(moveTree(tree, "graph", "right"), { error: "no-dest" });
  }
});

test("F1 foreign bottom 도구는 원본으로도 옮기지 않음", () => {
  const tree = fixture({ bottom: ["graph"] });
  delete findNode(tree, "panel-bottom").header;
  const before = J(tree);
  assert.equal(locate(tree, "graph"), null);
  assert.deepEqual(moveTree(tree, "graph", "right"), { error: "missing" });
  assert.equal(J(tree), before);
});

test("F3 기록 없는 shown foreign active 유지 · chip active 는 숨김", () => {
  for (const side of ["right", "bottom"]) {
    const tree = fixture({ right: side === "right" ? ["sc-1"] : [], bottom: side === "bottom" ? ["sc-1"] : [], panelHidden: side !== "right", bottomHidden: side !== "bottom" });
    const p = planRestore(snapOf(tree), undefined);
    assert.deepEqual(p.ops, []);
    assert.deepEqual(p.expect[side], { shown: true, active: "sc-1" });
    const h = mkHost({ tree }); h.tick();
    assert.deepEqual(h.owner.state.spaces.s1[side], { shown: true, active: "sc-1" });
  }
  const p = planRestore(snapOf(fixture({ withBottom: false })), undefined);
  assert.deepEqual(p.ops, [{ cmd: "layout.hide", args: { id: "panel" } }]);
});
