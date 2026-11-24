// panel-tabs 순수 계산 — 호스트 import 없음(node 시험용). 스택 노드 → 탭 칩 목록 · 폭 추정 · 압축 판정.
export const TOOLS = {
  "files": { label: "Files", icon: "mods/files/file.svg" },
  "files-plus": { label: "Files+", icon: "mods/files-plus/folder.svg" },
  "changes": { label: "Changes", icon: "mods/changes/changes.svg" },
  "graph": { label: "Git", icon: "mods/git-graph/icons/graph.svg" },
};
export const DEFAULT_PANELS = ["files", "changes"];
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

export function chipsFor(root, stackId, { panels, hideFiles } = {}) {
  const stack = findNode(root, stackId);
  if (!stack || stack.type !== "stack" || !Array.isArray(stack.children)) return { error: "no-stack", chips: [] };
  const on = Array.isArray(panels) ? panels : DEFAULT_PANELS;
  const shown = (id) => id === "files" ? on.includes("files") && !hideFiles : id === "changes" ? on.includes("changes") : true;
  const chips = [];
  for (const c of stack.children) {
    const id = c?.id;
    if (typeof id !== "string" || !Object.hasOwn(TOOLS, id) || !shown(id)) continue;
    chips.push({ id, label: TOOLS[id].label, icon: TOOLS[id].icon, active: stack.active === id });
  }
  return { error: null, chips };
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

export function needWidth(chips, compact = false) {
  if (!Array.isArray(chips) || chips.length === 0) return STRIP_PAD * 2;
  const sum = chips.reduce((a, c) => a + (compact && !c.active ? COMPACT_W : fullChipWidth(c.label)), 0);
  return STRIP_PAD * 2 + CHIP_GAP * (chips.length - 1) + sum;
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
