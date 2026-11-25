// panel-tabs 순수 계산 — 호스트 import 없음(node 시험용). 스택 노드 → 탭 칩 목록 · 폭 추정 · 압축 판정.
export const TOOLS = {
  "files": { label: "Files", icon: "mods/files/file.svg" },
  "files-plus": { label: "Files+", icon: "mods/files-plus/folder.svg" },
  "changes": { label: "Changes", icon: "mods/changes/changes.svg" },
  "graph": { label: "Git", icon: "mods/git-graph/icons/graph.svg" },
};
export const DEFAULT_PANELS = ["files", "changes"];
export const OWNER_STALE_MS = 60000;
export const STRIP_PAD = 8, CHIP_GAP = 3, CHIP_PAD = 8, ICON_W = 14, ICON_GAP = 5, CHAR_W = 6.6, COMPACT_W = 26, COMPACT_MARGIN = 24;

export function findNode(root, id) {
  if (!root || typeof root !== "object") return null;
  if (root.id === id) return root;
  if (!Array.isArray(root.children)) return null;
  for (const c of root.children) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return null;
}

export const panelsOf = (sharedValue) => Array.isArray(sharedValue) ? sharedValue : DEFAULT_PANELS;

// 보임 규칙(auto-tabs/panels.js 와 같은 규칙 — 짝 시험). panels 가 배열 아니면 기본값.
export function eligible(id, { panels, hideFiles } = {}) {
  if (typeof id !== "string" || !Object.hasOwn(TOOLS, id)) return false;
  const on = panelsOf(panels);
  if (id === "files") return on.includes("files") && !hideFiles;
  if (id === "changes") return on.includes("changes");
  return true;
}

export function chipsFor(root, stackId, { panels, hideFiles, closed } = {}) {
  const stack = findNode(root, stackId);
  if (!stack || stack.type !== "stack" || !Array.isArray(stack.children)) return { error: "no-stack", chips: [] };
  const shut = Array.isArray(closed) ? closed : [];
  const chips = [];
  for (const c of stack.children) {
    const id = c?.id;
    if (!eligible(id, { panels, hideFiles }) || shut.includes(id)) continue;
    chips.push({ id, label: TOOLS[id].label, icon: TOOLS[id].icon, active: stack.active === id });
  }
  return { error: null, chips };
}

// 소유자 shared 값 → header 가 쓰는 상태. 소유자 없으면 M1 동작(props.hideFiles, 닫힘 없음).
export function ownerInfo(sharedOwner, sharedClosed, propsHideFiles, root, now) {
  const hasOwner = (node) => !!node && typeof node === "object" && (
    (node.type === "block" && node.content?.mod === "auto-tabs") ||
    (Array.isArray(node.children) && node.children.some(hasOwner))
  );
  const age = now - sharedOwner?.t;
  const on = sharedOwner?.v === 2 && typeof sharedOwner.t === "number" && age >= 0 && age <= OWNER_STALE_MS && hasOwner(root);
  const closed = [];
  if (on && Array.isArray(sharedClosed)) {
    for (const id of sharedClosed) if (typeof id === "string" && Object.hasOwn(TOOLS, id) && !closed.includes(id)) closed.push(id);
  }
  return {
    on,
    hideFiles: on ? sharedOwner.hideFiles === true : propsHideFiles === true,
    closed,
    bottom: on && sharedOwner.bottom === true,
  };
}

export const SIDES = {
  right: { stack: "panel-body", vis: "panel" },
  bottom: { stack: "panel-bottom", vis: "panel-bottom" },
};

export function sideOfStack(stackId) {
  for (const [side, v] of Object.entries(SIDES)) if (v.stack === stackId) return side;
  return null;
}

// panel-body / panel-bottom 의 직계 자식만 훑음(다른 스택의 같은 id 는 무시).
export function locateTool(root, id) {
  if (typeof id !== "string") return null;
  for (const [side, v] of Object.entries(SIDES)) {
    const st = findNode(root, v.stack);
    if (st?.type === "stack" && Array.isArray(st.children) && st.children.some(c => c?.id === id)) return { side, stack: v.stack };
  }
  return null;
}

export const MENU_W = 220, ROW_H = 31, MENU_PAD = 5, SEP_H = 9;
export const menuHeight = (rows) => 2 * MENU_PAD + (Array.isArray(rows) ? rows : []).reduce((a, r) => a + (r?.sep ? SEP_H : ROW_H), 0);

const SIDE_NOTE = { bottom: " (아래에 있음)", right: " (오른쪽에 있음)" };

export function menuRows(root, stackId, { panels, hideFiles, closed, bottom } = {}, kind, id) {
  const shut = Array.isArray(closed) ? closed : [];
  if (kind === "tab") {
    const side = locateTool(root, id)?.side ?? sideOfStack(stackId);
    const row = (label, cmd) => ({ label, cmd, dim: cmd === null, sep: false });
    return [
      row("아래로 옮기기", bottom && side !== "bottom" ? `move:${id}:bottom` : null),
      row("오른쪽으로 옮기기", side !== "right" ? `move:${id}:right` : null),
      { label: "", cmd: null, dim: false, sep: true },
      row("닫기", `close:${id}`),
    ];
  }
  if (kind !== "plus") return [];
  const mine = sideOfStack(stackId);
  const here = new Set(chipsFor(root, stackId, { panels, hideFiles, closed: shut }).chips.map(c => c.id));
  const rows = [];
  for (const tid of Object.keys(TOOLS)) {
    if (!eligible(tid, { panels, hideFiles }) || here.has(tid)) continue;
    const loc = locateTool(root, tid);
    if (!loc || (loc.side === "bottom" && !bottom)) continue;
    const other = loc.side !== mine;
    rows.push({ label: TOOLS[tid].label + (other ? SIDE_NOTE[loc.side] : ""), cmd: `open:${tid}`, dim: other && !shut.includes(tid), sep: false });
  }
  return rows.length ? rows : [{ label: "닫힌 도구 없음", cmd: null, dim: true, sep: false }];
}

// 스택 자신 → 위로 올라가며 size.px 를 가진 가장 가까운 노드의 px.
export function availWidth(root, stackId) {
  const path = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return false;
    path.push(n);
    if (n.id === stackId) return true;
    if (Array.isArray(n.children) && n.children.some(walk)) return true;
    path.pop();
    return false;
  };
  if (!walk(root)) return null;
  for (let i = path.length - 1; i >= 0; i--) {
    const px = path[i]?.size?.px;
    if (typeof px === "number" && Number.isFinite(px)) return px;
  }
  return null;
}

export const fullChipWidth = (label) => CHIP_PAD + ICON_W + ICON_GAP + Math.ceil(label.length * CHAR_W) + CHIP_PAD;

// on=true(소유자 있음): 활성 칩 × (CLOSE_W) + 끝의 «+» (COMPACT_W + CHIP_GAP) 폭 가산.
export const CLOSE_W = ICON_GAP + 12;
export function needWidth(chips, compact = false, on = false) {
  const plus = on ? COMPACT_W + CHIP_GAP : 0;
  if (!Array.isArray(chips) || chips.length === 0) return STRIP_PAD * 2 + (on ? COMPACT_W : 0);
  const sum = chips.reduce((a, c) => a + (compact && !c.active ? COMPACT_W : fullChipWidth(c.label) + (on && c.active ? CLOSE_W : 0)), 0);
  return STRIP_PAD * 2 + CHIP_GAP * (chips.length - 1) + sum + plus;
}

// 메뉴 행 선택: 행이 누를 수 있나(구분선·cmd null 제외).
export const rowEnabled = (r) => !!r && !r.sep && r.cmd !== null && r.cmd !== undefined;
export function firstEnabled(rows) {
  const i = (Array.isArray(rows) ? rows : []).findIndex(rowEnabled);
  return i < 0 ? -1 : i;
}
// dir=+1/-1, 끝에서 감싸 돈다. 가능한 행 없으면 -1. at 가 범위 밖이면 처음/끝에서 시작.
export function stepEnabled(rows, at, dir) {
  const list = Array.isArray(rows) ? rows : [];
  const n = list.length;
  if (!n || firstEnabled(list) < 0) return -1;
  const d = dir < 0 ? -1 : 1;
  let i = Number.isInteger(at) && at >= 0 && at < n ? at : (d > 0 ? -1 : 0);
  for (let k = 0; k < n; k++) {
    i = (i + d + n) % n;
    if (rowEnabled(list[i])) return i;
  }
  return -1;
}

export function decideCompact(prev, need, avail, margin = COMPACT_MARGIN) {
  if (avail === null || avail === undefined) return false;
  return prev ? !(need + margin <= avail) : need > avail;
}

// 재 폭 우선: 실제로 잰 줄 폭(on_size_change)이 유효하면 그것, 아니면 레이아웃 size.px(첫 배치 전 대체값).
export function pickAvail(measured, fromLayout) {
  if (typeof measured === "number" && Number.isFinite(measured) && measured > 0) return measured;
  return typeof fromLayout === "number" && Number.isFinite(fromLayout) ? fromLayout : null;
}
