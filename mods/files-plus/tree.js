// 폴더 올리기의 순수 부분 — herdr 를 쓰지 않는다(node 시험 대상). 셸 스크립트·exec 는 transfer.js 가 맡는다.
// LIST 가 찍은 NUL 목록 → 올릴 계획(폴더·파일·건너뜀), 이름 충돌 번호, 인자 묶음, 겹치는 항목 거르기.

import { safeName, pushHistoryGroup } from "./state.js";

// Mac 부속 파일: 올리지 않는다(규칙 3). 그 밖 dotfile(.env 등)은 올린다.
const junk = (name) => name === ".DS_Store" || name.startsWith("._") || name === "Icon\r";

// LIST 출력 → { dirs, emptyDirs, files: [{ src, dir, name }], skipped, unreadableRc }
// 조각은 «종류 NUL 경로 NUL» 쌍(종류: d 폴더 · f 파일 · l 링크 · o 그 밖) · 끝에 «E NUL rc NUL» 표지.
// [주의] 표지가 없으면 출력이 잘린 것(시간 초과·출력 상한) → 일부만 올리지 않도록 던진다.
// rc: 1 = 읽지 못한 곳이 있었다(경고 · 나머지는 올린다) · 2 이상(시그널 128+ 포함) = 목록을 끝까지 못 읽었다 → 던진다.
export function treePlan(stdout, { max = Infinity, maxDirs = Infinity } = {}) {
  const f = String(stdout ?? "").split("\0");
  const dirs = [], files = [];
  let skipped = 0, rc = null;
  for (let i = 0; i + 1 < f.length; i += 2) {
    const kind = f[i], raw = f[i + 1];
    if (kind === "E") {
      if (!/^\d+$/.test(raw)) throw new Error("목록 끝 표지를 못 읽었다");   // rc 자리가 숫자가 아니면 표지가 깨진 것
      rc = Number(raw); break;
    }
    const rel = raw.startsWith("./") ? raw.slice(2) : raw;
    const parts = rel.split("/");
    const name = parts[parts.length - 1];
    if (!parts.every(safeName)) { skipped++; continue; }   // 빈 조각 · `..` — 경로 밖으로 새지 않게 그 항목만 뺀다
    if (kind === "d") dirs.push(rel);
    else if (kind === "f") {
      if (junk(name)) { skipped++; continue; }
      files.push({ src: rel, dir: parts.slice(0, -1).join("/"), name });
    } else skipped++;                                     // l(링크) · o(소켓·FIFO·장치 등)
  }
  if (rc === null) throw new Error("목록이 잘렸다");
  if (rc >= 2) throw new Error(`폴더 목록을 끝까지 못 읽었다(rc ${rc})`);
  if (files.length > max) throw Object.assign(new Error(`파일이 너무 많다(${files.length}개 · 상한 ${max})`), { code: "TOO_MANY" });
  if (dirs.length > maxDirs) throw new Error(`하위 폴더가 너무 많다(${dirs.length}개 · 상한 ${maxDirs})`);
  // leaf 폴더만 mkdir -p 하면 부모도 생긴다 · 파일이 든 폴더는 파일 PREP "1" 이 만든다.
  const used = new Set();
  for (const d of dirs) used.add(d.includes("/") ? d.slice(0, d.lastIndexOf("/")) : "");
  for (const x of files) used.add(x.dir);
  const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  files.sort((a, b) => byStr(a.src, b.src));
  dirs.sort(byStr);
  return { dirs, emptyDirs: dirs.filter((d) => !used.has(d)), files, skipped, unreadableRc: Number.isFinite(rc) ? rc : 0 };
}

// MKTOP 이 찍은 k 로 놓인 폴더 이름 — 파일과 달리 확장자를 나누지 않는다(`v1.2` → `v1.2 (1)`).
export function placedDir(name, k) { return k === 0 ? name : `${name} (${k})`; }

const utf8 = (s) => { let n = 0; for (const ch of s) { const c = ch.codePointAt(0); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; } return n; };

// 위치 인자 묶음: 한 번에 maxCount 개 · 합계 maxBytes(NUL 몫 1 포함) 이하. 하나가 상한을 넘어도 혼자 한 묶음으로 간다.
export function batches(list, maxCount = 200, maxBytes = 65536) {
  const out = [];
  let cur = [], bytes = 0;
  for (const s of list) {
    const b = utf8(s) + 1;
    if (cur.length && (cur.length >= maxCount || bytes + b > maxBytes)) { out.push(cur); cur = []; bytes = 0; }
    cur.push(s); bytes += b;
  }
  if (cur.length) out.push(cur);
  return out;
}

// 같은 경로 하나로 · 끝 `/` 정규화 · 폴더와 그 안 항목이 함께면 안쪽을 뺀다(접두 `src/` 비교 — `a` 와 `ab` 는 다르다).
// O(n·깊이): 경로마다 조상 문자열(`/` 앞까지)이 집합에 있는지만 본다. 처음 나온 순서를 지킨다.
// 빈 값·문자열 아닌 값은 버린다(`""` 가 `/` 가 되지 않게 — 슬래시만으로 된 경로만 `/`). `.`/`..` 조각이 든 경로는 조상 비교를 하지 않는다(둘 다 남긴다).
const dotty = (p) => p.split("/").some((s) => s === "." || s === "..");
export function dedupeNested(paths) {
  const norm = [...new Set(paths.filter((p) => typeof p === "string" && p !== "").map((p) => (p.replace(/\/+$/, "") || "/")))];
  const all = new Set(norm.filter((p) => !dotty(p)));
  return norm.filter((p) => {
    if (p === "/" || dotty(p)) return true;
    if (p.startsWith("/") && all.has("/")) return false;
    for (let i = p.indexOf("/", 1); i !== -1; i = p.indexOf("/", i + 1)) if (all.has(p.slice(0, i))) return false;
    return true;
  });
}

// 그룹(폴더 올리기 하나)의 기록 줄을 «갈아 끼운다»: list 에서 grp 가 gid 인 줄을 모두 빼고, byState({ok,fail,cancel} 각 최신이 앞인 항목들})
// 로 상태마다 pushHistoryGroup 식 접기(≤ group-1 개 + «외 N개» 한 줄)를 새로 만들어 앞에 붙인다 → 그룹은 상태마다 최대 group 줄만 차지한다.
// 줄마다 grp 를 단다(다음 갈아 끼움이 찾는 표지). max 로 자른다. 같은 입력이면 같은 결과(멱등).
export function replaceGroupLines(list, gid, byState, max = 200, group = 5) {
  const rest = (Array.isArray(list) ? list : []).filter((e) => !(e && e.grp === gid));
  let lines = [];
  for (const st of ["ok", "fail", "cancel"]) {
    const es = byState?.[st];
    if (!Array.isArray(es) || !es.length) continue;
    lines = [...pushHistoryGroup([], es.map((e) => ({ ...e, grp: gid })), max, group), ...lines];
  }
  return [...lines, ...rest].slice(0, Math.max(0, max));
}

// 받는 실경로가 올리는 폴더 자신이거나 그 안인가(문자열 비교 — 실경로는 셸이 구한다).
export function isInside(dstReal, srcReal) {
  return dstReal === srcReal || dstReal.startsWith(srcReal === "/" ? "/" : `${srcReal}/`);
}
