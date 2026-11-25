// auto-tabs 패널 순수 계산 — 호스트 import 없음(node 시험용). 레이아웃 트리 → snapshot → ops 계획.
export const TOOLS = ["files", "files-plus", "changes", "graph"];
export const SIDES = {
  right: { stack: "panel-body", vis: "panel" },
  bottom: { stack: "panel-bottom", vis: "panel-bottom" },
};
export const DEFAULT_PANELS = ["files", "changes"];
// moveTree 가 복사본에서 지우는, 실행 중에만 있는 필드 이름. 기본 빈 목록.
export const STRIP = [];

const SIDE_KEYS = Object.keys(SIDES);
const isTool = (id) => typeof id === "string" && TOOLS.includes(id);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export const panelsOf = (v) => (Array.isArray(v) ? v : [...DEFAULT_PANELS]);

export function eligible(id, { panels, hideFiles } = {}) {
  const list = panelsOf(panels);
  if (id === "files") return list.includes("files") && !hideFiles;
  if (id === "changes") return list.includes("changes");
  return id === "files-plus" || id === "graph";
}

export function validClosed(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isTool))];
}

export function findNode(root, id) {
  if (!isObj(root)) return null;
  if (root.id === id) return root;
  if (!Array.isArray(root.children)) return null;
  for (const c of root.children) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return null;
}

// 아래는 우리 header 가 있는 스택만 소유. 잘못된 스택은 없는 쪽.
function sideStack(root, side) {
  const stack = findNode(root, SIDES[side].stack);
  if (stack?.type !== "stack" || !Array.isArray(stack.children)) return null;
  if (side === "bottom" && !(isObj(stack.header) && isObj(stack.header.content) && stack.header.content.mod === "panel-tabs")) return null;
  return stack;
}

// → {side, stack, index} | null | {error:"dup"}
export function locate(root, id) {
  const hits = [];
  for (const side of SIDE_KEYS) {
    const stack = sideStack(root, side);
    const kids = Array.isArray(stack?.children) ? stack.children : [];
    const index = kids.findIndex((c) => c?.id === id);
    if (index >= 0) hits.push({ side, stack: SIDES[side].stack, index });
  }
  if (hits.length > 1) return { error: "dup" };
  return hits[0] ?? null;
}

const emptySide = () => ({ exists: false, shown: false, active: null, children: [], ok: [], chips: [], foreign: [] });

export function snapshot(root, opts = {}, closed = []) {
  const shut = validClosed(closed);
  const out = {};
  for (const side of SIDE_KEYS) {
    const stack = sideStack(root, side);
    const vis = findNode(root, SIDES[side].vis);
    if (!stack || !vis) { out[side] = emptySide(); continue; }
    const children = (Array.isArray(stack.children) ? stack.children : []).map((c) => c?.id).filter((x) => typeof x === "string");
    out[side] = {
      exists: true,
      shown: !vis.hidden,
      active: stack.active ?? null,
      children,
      // 닫힘 무시하고 eligible 인 도구(다시 열 수 있는 것)
      ok: children.filter((c) => isTool(c) && eligible(c, opts)),
      chips: children.filter((c) => isTool(c) && eligible(c, opts) && !shut.includes(c)),
      foreign: children.filter((c) => !isTool(c)),
    };
  }
  return out;
}

export function recordOf(snap) {
  const rec = {};
  for (const side of SIDE_KEYS) {
    const s = snap?.[side];
    rec[side] = s?.exists ? { shown: Boolean(s.shown), active: s.active ?? null } : { shown: false, active: null };
  }
  return rec;
}

export function matches(snap, expect) {
  if (isObj(expect)) {
    if (!isObj(snap)) return false;
    return Object.keys(expect).every((k) => matches(snap[k], expect[k]));
  }
  if (Array.isArray(expect)) return JSON.stringify(snap) === JSON.stringify(expect);
  return snap === expect;
}

const select = (side, child) => ({ cmd: "layout.select", args: { stack: SIDES[side].stack, child } });
const show = (side) => ({ cmd: "layout.show", args: { id: SIDES[side].vis } });
const hide = (side) => ({ cmd: "layout.hide", args: { id: SIDES[side].vis } });

// 쪽을 id 로 보이게: 필요한 ops 만.
function reveal(s, side, id, ops, expect) {
  if (s.active !== id) ops.push(select(side, id));
  if (!s.shown) ops.push(show(side));
  expect[side] = { shown: true, active: id };
}

export function planRestore(snap, rec) {
  const ops = [], expect = {};
  for (const side of SIDE_KEYS) {
    const s = snap?.[side];
    if (!s?.exists) continue;
    if (!isObj(rec?.[side]) && s.shown && s.foreign.includes(s.active)) {
      expect[side] = { shown: true, active: s.active };
      continue;
    }
    const r = isObj(rec?.[side]) ? rec[side] : { shown: false, active: null };
    const pick = [...s.chips, ...s.foreign];
    if (r.shown && pick.length) {
      const want = pick.includes(r.active) ? r.active : pick.includes(s.active) ? s.active : (s.chips[0] ?? s.foreign[0]);
      reveal(s, side, want, ops, expect);
    } else {
      if (s.shown) ops.push(hide(side));
      expect[side] = { shown: false };
    }
  }
  return { ops, expect };
}

export function planNormalize(snap) {
  const ops = [], expect = {};
  for (const side of SIDE_KEYS) {
    const s = snap?.[side];
    if (!s?.exists || !s.shown) continue;
    if (!s.chips.length && !s.foreign.length) {
      ops.push(hide(side)); expect[side] = { shown: false };
      continue;
    }
    // active 가 known 비chip(TOOLS 인데 chip 아님)일 때만 자리를 뜸. foreign/없음은 그대로.
    if (isTool(s.active) && !s.chips.includes(s.active)) {
      const to = s.chips[0] ?? s.foreign[0];
      ops.push(select(side, to)); expect[side] = { active: to };
    }
  }
  return { ops, expect };
}

// 닫을 때/옮길 때 쓰는 이웃: 뒤쪽 chip 우선, 없으면 앞쪽 chip, 없으면 첫 foreign.
function neighbour(children, after, before, isChip, foreign) {
  for (let i = after; i < children.length; i++) if (isChip(children[i])) return children[i];
  for (let i = before; i >= 0; i--) if (isChip(children[i])) return children[i];
  return foreign[0] ?? null;
}

function sideOf(snap, id) {
  const hit = SIDE_KEYS.filter((k) => snap?.[k]?.exists && snap[k].children.includes(id));
  return hit.length === 1 ? hit[0] : null;
}

const noop = (closed) => ({ ops: [], closed, expect: {} });

export function planOpen(snap, closed, id) {
  const shut = validClosed(closed);
  const side = isTool(id) ? sideOf(snap, id) : null;
  if (!side) return noop(shut);
  const s = snap[side];
  if (!s.ok.includes(id)) return noop(shut); // 열 수 없는 도구(숨긴 Files · 꺼진 Changes)
  const next = shut.filter((c) => c !== id);
  const ops = [], expect = {};
  reveal(s, side, id, ops, expect);
  return { ops, closed: next, expect };
}

export function planClose(snap, closed, id) {
  const shut = validClosed(closed);
  if (!isTool(id)) return noop(shut);
  const next = shut.includes(id) ? shut : [...shut, id];
  const side = sideOf(snap, id);
  if (!side) return { ops: [], closed: next, expect: {} };
  const s = snap[side];
  const ops = [], expect = {};
  if (s.active === id && s.chips.includes(id)) {
    const isChip = (c) => s.chips.includes(c) && c !== id;
    const to = neighbour(s.children, s.children.indexOf(id) + 1, s.children.indexOf(id) - 1, isChip, s.foreign);
    if (to) { ops.push(select(side, to)); expect[side] = { active: to }; }
    else if (s.shown) { ops.push(hide(side)); expect[side] = { shown: false }; }
  }
  return { ops, closed: next, expect };
}

export function planToggle(snap, closed, id) {
  const shut = validClosed(closed);
  if (!isTool(id)) return noop(shut);
  if (shut.includes(id)) return planOpen(snap, shut, id);
  const side = sideOf(snap, id);
  if (!side || !snap[side].chips.includes(id)) return noop(shut);
  const s = snap[side];
  if (s.shown && s.active === id) return { ops: [hide(side)], closed: shut, expect: { [side]: { shown: false } } };
  const ops = [], expect = {};
  reveal(s, side, id, ops, expect);
  return { ops, closed: shut, expect };
}

function strip(node) {
  if (!isObj(node)) return;
  for (const f of STRIP) delete node[f];
  if (Array.isArray(node.children)) node.children.forEach(strip);
}

export function moveTree(root, id, dest, opts = {}, closed = []) {
  if (!isTool(id)) return { error: "unknown-id" };
  if (typeof dest !== "string" || !Object.hasOwn(SIDES, dest)) return { error: "no-dest" };
  // QuickJS 에 structuredClone 이 없을 수 있음 — 레이아웃은 JSON 이므로 JSON 왕복 복사.
  const tree = JSON.parse(JSON.stringify(root));
  strip(tree);
  const dStack = sideStack(tree, dest), dVis = findNode(tree, SIDES[dest].vis);
  if (!dStack || !dVis) return { error: "no-dest" };
  const at = locate(tree, id);
  if (!at) return { error: "missing" };
  if (at.error) return { error: at.error };
  if (at.side === dest) return { error: "same-side" };
  const src = at.side;
  const sStack = findNode(tree, SIDES[src].stack), sVis = findNode(tree, SIDES[src].vis);
  const shut = validClosed(closed).filter((c) => c !== id);
  const [block] = sStack.children.splice(at.index, 1);
  const expect = {};
  if (sStack.active === id) {
    const rest = sStack.children;
    const ids = rest.map((c) => c?.id);
    const isChip = (c) => isTool(c) && eligible(c, opts) && !shut.includes(c);
    const foreign = ids.filter((c) => !isTool(c));
    const to = neighbour(ids, at.index, at.index - 1, isChip, foreign);
    if (to) { sStack.active = to; expect[src] = { active: to }; }
    else {
      if (ids.length) sStack.active = ids[0]; else delete sStack.active;
      sVis.hidden = true;
      expect[src] = { shown: false, active: sStack.active ?? null };
    }
  }
  dStack.children.push(block);
  dStack.active = id;
  dVis.hidden = false;
  expect[dest] = { shown: true, active: id };
  return { tree, closed: shut, expect };
}

export function parseCommand(str) {
  if (typeof str !== "string") return null;
  const p = str.trim().split(":");
  if (p.length === 1) return isTool(p[0]) ? { op: "toggle", id: p[0] } : null;
  const [op, id, side] = p;
  if (!isTool(id)) return null;
  if (op === "toggle" && p.length === 2) return { op, id };
  if (op === "close" && p.length === 2) return { op, id };
  if (op === "open" && p.length === 2) return { op, id };
  if (op === "move" && p.length === 3 && Object.hasOwn(SIDES, side)) return { op, id, side };
  return null;
}

// ---- 소유자 상태 ----
const safeParse = (s) => { try { return typeof s === "string" ? JSON.parse(s) : undefined; } catch { return undefined; } };
const cleanSide = (v) => (isObj(v) && typeof v.shown === "boolean" && (v.active === null || typeof v.active === "string"))
  ? { shown: v.shown, active: v.active } : { shown: false, active: null };

export function loadState(v2Str, v1Str) {
  const v2 = safeParse(v2Str);
  if (isObj(v2) && v2.v === 2 && isObj(v2.spaces)) {
    const spaces = {};
    for (const [sid, rec] of Object.entries(v2.spaces)) {
      if (sid === "__proto__" || !isObj(rec)) continue;
      spaces[sid] = { right: cleanSide(rec.right), bottom: cleanSide(rec.bottom) };
    }
    return { v: 2, spaces };
  }
  const v1 = safeParse(v1Str);
  const spaces = {};
  if (isObj(v1)) {
    for (const [sid, val] of Object.entries(v1)) {
      if (sid === "__proto__") continue;
      if (typeof val === "string" && val) spaces[sid] = { right: { shown: true, active: val }, bottom: { shown: false, active: null } };
      else if (val === null) spaces[sid] = { right: { shown: false, active: null }, bottom: { shown: false, active: null } };
    }
  }
  return { v: 2, spaces };
}

export function saveState(state) {
  const spaces = {};
  if (isObj(state?.spaces)) {
    for (const [sid, rec] of Object.entries(state.spaces)) {
      if (sid === "__proto__" || !isObj(rec)) continue;
      spaces[sid] = { right: cleanSide(rec.right), bottom: cleanSide(rec.bottom) };
    }
  }
  return JSON.stringify({ v: 2, spaces });
}
