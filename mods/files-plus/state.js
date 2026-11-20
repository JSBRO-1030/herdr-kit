// 패널 ↔ 팝업(미리보기·전송 창·메뉴/확인 창) 공통 계약 — herdr 모듈을 쓰지 않는 순수 함수 모음(node · QuickJS 둘 다 돈다).
// shared(key) → 값 · setShared(key, 값) 은 인자로 받는다(시험에서는 Map 대역).

export const KEY = {
  jobs: owner => `files-plus.jobs/${owner}`,                 // 패널이 쓴다 · 팝업이 읽는다
  req: (owner, from) => `files-plus.req/${owner}/${from}`,   // from = SOURCES 중 하나("preview" | "jobs" | "ask") · 그 팝업만 쓴다
  ack: (owner, from) => `files-plus.ack/${owner}/${from}`,   // 패널만 쓴다
  win: owner => `files-plus.win/${owner}`,                   // 전송 창이 쓴다: 열려 있으면 {t: 토큰, expanded} · 닫히면 null
  history: "files-plus.history",                             // 패널만 쓴다
  previewSize: "files-plus.previewSize",                     // 미리보기 창 크기 {w,h} px(자리는 기억하지 않는다) · 미리보기 창이 쓴다
  fontSize: "files-plus.fontSize",                           // 미리보기 글자 크기 {md, code} px · 미리보기 창이 쓴다
  tf: owner => `files-plus.tf/${owner}`,                     // 패널만 쓴다 · 터미널 파일 줄의 마지막 훑기 결과(진단용 {at, phase, kind, cands, found, …})
  resize: owner => `files-plus.resize/${owner}`,             // 크기 틀이 쓴다: 열 때 {id: 미리보기 id, at} · 닫을 때(어느 길이든) null — 미리보기가 «틀이 닫혔다» 를 알아 포커스를 되찾는다
};

// 미리보기 창의 «지금 열린 id» 를 담는 shared 키(주인 하나에 하나) — overlay 의 `key` 가 아니다.
// [주의] overlay key 를 주면 호스트가 «마지막 놓은 자리» 를 기억해 `at` 보다 앞서 쓴다: 반쯤 화면 밖으로 끈 창이 그 자리에서 다시 열리고,
// «크게 보기»(0.98)가 옛 0.82 자리에서 커져 오른쪽(레일 · ✕)이 잘린다 → key 를 쓰지 않고, 주인당 하나는 이 키의 id 로 지킨다.
// 여는 쪽(openPreviewWindow)이 옛 id 를 닫고(try/catch) 새 id 를 여기에 쓴다. 창이 스스로 닫히면 자기 id 일 때만 지운다.
export const previewKey = owner => `files-plus.preview/${owner}`;

// previewKey 의 값 = {id, at}: 미리보기 창이 1.5 s 마다(확인은 0.5 s 마다지만 쓰기는 3 번에 한 번 — setShared 마다 모든 mod 가 다시 그려진다) at(ms)을 새로 쓴다. 충돌(크래시)로 남은 낡은 id 를 호스트가 다른 창에 재사용했을 때 엉뚱한 창을 닫지 않도록,
// «at 이 5 s 안» 일 때만(= 살아 있는 미리보기) 옛 id 를 닫는다. 옛 꼴(문자열 id)은 at 을 모르므로 낡은 것으로 본다.
export const PREVIEW_TTL = 5000;
export function previewEntry(v) {
  if (typeof v === "string") return v ? { id: v, at: 0 } : null;
  if (v && typeof v === "object" && typeof v.id === "string" && v.id) return { id: v.id, at: typeof v.at === "number" && Number.isFinite(v.at) ? v.at : 0 };
  return null;
}
export const previewId = v => previewEntry(v)?.id ?? null;                                 // 낡았든 아니든 적힌 id
export function livePreviewId(v, now, ttl = PREVIEW_TTL) {                                 // 살아 있다고 볼 수 있는 id 만(아니면 null)
  const e = previewEntry(v);
  return e && Number.isFinite(now) && now - e.at >= 0 && now - e.at <= ttl ? e.id : null;
}

// 크기 틀 키(KEY.resize) 값 {id: 미리보기 id, frame: 틀 id(모르면 생략), at}. 틀은 끄는 동안 at 을 RESIZE_REFRESH_MS 마다 새로 쓴다(쓰기 ≤ 0.2/s) →
// 미리보기는 at 이 틈(RESIZE_SLACK)을 더한 «무동작 한도» 보다 낡았을 때만 틀이 죽었다고 본다.
export const RESIZE_REFRESH_MS = 5000;
export const RESIZE_SLACK = 5000;
export const resizeEntry = (id, frame, at) => (typeof frame === "string" && frame ? { id, frame, at } : { id, at });
export function resizeEntryOf(v) {
  if (!v || typeof v !== "object" || typeof v.id !== "string" || !v.id) return null;
  return { id: v.id, frame: typeof v.frame === "string" && v.frame ? v.frame : null, at: typeof v.at === "number" && Number.isFinite(v.at) ? v.at : NaN };
}
// 이 미리보기(id) 것이고 at 이 maxAge 안이면 true. 미래의 at(시계 어긋남)은 낡은 것으로 보지 않되 너무 앞서면(maxAge 초과) 거른다.
export function resizeLive(v, id, now, maxAge) {
  const e = resizeEntryOf(v);
  return Boolean(e && id && e.id === id && Number.isFinite(e.at) && Number.isFinite(now) && Math.abs(now - e.at) < maxAge);
}
// 틀이 자기 id 를 못 읽을 때(props().overlay 없음) 쓸 id: 미리보기가 키에 적어 둔 frame.
export const resizeFrameId = (v, previewId) => { const e = resizeEntryOf(v); return e && e.id === previewId ? e.frame : null; };

// 패널이 닫힐 때 «도는 전송의 조각 파일» 을 적어 두는 공용 키(주인당 하나). ownerKeys 에 넣지 않는다 — 닫힘이 키를 치워도 이것은 다음 삶이 읽고 지울 때까지 남아야 한다.
// 이유: 닫힘 직전에 돌던 조각 쓰기(`>>`)가 rm 뒤에 파일을 되살릴 수 있다.
export const partsKey = owner => `files-plus.parts/${owner}`;
export const PARTS_CAP = 50;
export function closingParts(jobs, prev = []) {
  const out = [], seen = new Set();
  const add = (path, on) => {
    if (!isPartPath(path)) return;
    const o = typeof on === "string" && on !== "" ? on : null, k = `${o ?? ""}\0${path}`;
    if (!seen.has(k)) { seen.add(k); out.push({ path, on: o }); }
  };
  for (const e of Array.isArray(prev) ? prev : []) if (e && typeof e === "object") add(e.path, e.on);
  for (const j of Array.isArray(jobs) ? jobs : []) if (j && typeof j === "object" && j.state === "run" && !j.ended) add(j.part, j.partOn);
  // [주의] 상한을 넘으면 «가장 새 것» PARTS_CAP 개만 남긴다(prev = 옛 것 → 앞 · 지금 도는 작업 = 뒤). 넘친 옛 조각은 못 지운다(드문 경우 — 돌던 전송이 50 개 넘을 때).
  return out.length > PARTS_CAP ? out.slice(out.length - PARTS_CAP) : out;
}
// 다음 삶이 지울 조각들: 값을 다시 거르고(이름 꼴 · 쪽) 이 삶의 살아 있는 작업이 쓰는 경로는 뺀다.
export function pendingParts(v, jobs = []) {
  const live = new Set((Array.isArray(jobs) ? jobs : []).map(j => j?.part).filter(Boolean));
  return closingParts([], v).filter(e => !live.has(e.path));
}

// ── 주인(owner) 등록부: 제자리 다시 불러오기 뒤 새 패널 copy 가 «옛 owner 가 아직 살아 있다» 는 이유로 새 owner 를 받으면, 크래시 뒤 다시 뜬 패널은 저장소의 옛 owner 만 이어 받아
// 새 owner 의 jobs · .part 를 아무도 치우지 않는다(VM 확인). → 공용 키 `files-plus.owners` 에 «살아 있는 copy 들의 {owner, at}» 를 적고, 죽은(오래 갱신 없는) 주인의 흔적은 아무 패널이나 치운다.
// [주의] setShared 는 모든 mod 를 다시 그린다 → at 갱신은 15 s 마다(더 자주 금지). 죽음 판정은 60 s.
export const OWNERS_KEY = "files-plus.owners";
export const OWNERS_CAP = 20;
export const OWNER_BEAT_MS = 15000;
export const OWNER_DEAD_MS = 60000;
const OWNER_RE = /^[a-z0-9]{8}$/;
// 값 → [{owner, at}] — 꼴이 틀린 항목은 버리고 중복은 앞의 것만. at 이 숫자가 아니면 null(아래 deadOwners 가 «처음 본 때» 로 판정). 상한 OWNERS_CAP(앞에서부터).
export function normalizeOwners(v) {
  const out = [], seen = new Set();
  for (const e of Array.isArray(v) ? v : []) {
    if (!e || typeof e !== "object" || typeof e.owner !== "string" || !OWNER_RE.test(e.owner) || seen.has(e.owner)) continue;
    seen.add(e.owner);
    out.push({ owner: e.owner, at: typeof e.at === "number" && Number.isFinite(e.at) ? e.at : null });
    if (out.length >= OWNERS_CAP) break;
  }
  return out;
}
// 내 항목을 새 at 으로 넣는다(없으면 추가). 상한을 넘으면 «at 이 가장 오래된 남의 것» 부터 뺀다(내 것은 늘 남는다 · at 이 null 인 것이 가장 오래된 것).
export function registerOwner(v, owner, now) {
  const list = normalizeOwners(v).filter(e => e.owner !== owner);
  list.push({ owner, at: now });
  if (list.length <= OWNERS_CAP) return list;
  const others = list.filter(e => e.owner !== owner).sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity)).slice(0, OWNERS_CAP - 1);
  return [...others, { owner, at: now }];
}
export const dropOwners = (v, owners) => normalizeOwners(v).filter(e => !owners.includes(e.owner));
// 죽은 주인: 내가 아니고 · 이 프로세스의 LIVE 에 없고 · at 이 60 s 보다 오래됨. at 이 없거나(쓰레기) 지금보다 60 s 넘게 «미래» 인 항목은 시계를 믿지 않고,
// «이 프로세스가 그 항목을 처음 본 때»(firstSeen: Map owner → ms)부터 60 s 가 지나야 죽은 것으로 본다(살아 있는 copy 는 15 s 마다 올바른 at 으로 덮어쓰므로 쓰레기가 60 s 남아 있으면 갱신하는 이가 없다).
export function deadOwners(list, { mine, live = new Set(), now, firstSeen = new Map() }) {
  const out = [];
  for (const e of normalizeOwners(list)) {
    if (e.owner === mine || live.has(e.owner)) continue;
    const odd = e.at == null || e.at - now > OWNER_DEAD_MS;
    if (odd) { const t = firstSeen.get(e.owner); if (typeof t === "number" && now - t > OWNER_DEAD_MS) out.push(e.owner); }
    else if (now - e.at > OWNER_DEAD_MS) out.push(e.owner);
  }
  return out;
}
// 죽은 주인 하나의 뒷정리 계획(순수): 스냅샷의 끝나지 못한 작업 → 기록 묶음(jid 로 중복 제외) · 도는 작업의 조각 + 닫힘이 남긴 조각 목록 → 지울 조각 · 치울 shared 키 전부(ownerKeys + parts).
// 자기 이전 삶을 처리하는 것과 똑같은 규칙(orphanedJobs · orphanParts(snap, null) · pendingParts)이다.
export function ownerCleanupPlan({ owner, snap, partsList, seen = new Set(), now }) {
  const groups = snap && typeof snap === "object" ? orphanedJobs(snap, now, seen).groups : [];
  const parts = [], dup = new Set();
  for (const t of [...(snap && typeof snap === "object" ? orphanParts(snap, null) : []), ...pendingParts(partsList, [])]) {
    const k = `${t.on ?? ""}\0${t.path}`;
    if (!dup.has(k)) { dup.add(k); parts.push(t); }
  }
  return { owner, groups, parts, keys: [...ownerKeys(owner), partsKey(owner)] };
}

// 미리보기 창 크기 규칙(순수) — 최소 420×300 · 앱 창 안쪽.
export const MIN_W = 420, MIN_H = 300;
// [주의] viewport 를 모를 때의 절대 상한 — 오염된 shared 값(예: 1e9)이 터무니없는 창 크기를 만들지 않게.
export const ABS_MAX = 8000;
const pos = v => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);   // 양의 유한 숫자만(문자열 · NaN · 음수 · 0 은 무시)
const viewOf = vp => { const w = pos(Number(vp?.width)), h = pos(Number(vp?.height)); return w && h ? { w, h } : null; };
const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// {w,h} → 정수 {w,h}: 최소 이상 · viewport 가 있으면 그 0.98 이하(viewport 가 최소보다 작으면 viewport 가 우선) · 없으면 ABS_MAX 이하. 숫자가 아니면 null.
export function fitSize(size, viewport = null) {
  const w = pos(size?.w), h = pos(size?.h);
  if (!w || !h) return null;
  const vp = viewOf(viewport);
  const maxW = vp ? Math.floor(vp.w * 0.98) : ABS_MAX, maxH = vp ? Math.floor(vp.h * 0.98) : ABS_MAX;
  return { w: Math.round(clampN(w, Math.min(MIN_W, maxW), maxW)), h: Math.round(clampN(h, Math.min(MIN_H, maxH), maxH)) };
}

// {x,y,w,h} → 정수 {x,y,w,h}: 크기는 최소 이상 · viewport 안(w ≤ vw · h ≤ vh)이고 x∈[0, vw-w] · y∈[0, vh-h]. viewport 를 모르면 x,y 는 0..ABS_MAX · w·h 는 ..ABS_MAX. w·h 가 숫자가 아니면 null.
export function clampRect(rect, viewport = null) {
  const w = pos(rect?.w), h = pos(rect?.h);
  if (!w || !h) return null;
  const vp = viewOf(viewport);
  const x = Number.isFinite(rect?.x) ? rect.x : 0, y = Number.isFinite(rect?.y) ? rect.y : 0;
  const cw = Math.round(vp ? clampN(w, Math.min(MIN_W, vp.w), vp.w) : clampN(w, MIN_W, ABS_MAX)), ch = Math.round(vp ? clampN(h, Math.min(MIN_H, vp.h), vp.h) : clampN(h, MIN_H, ABS_MAX));
  return { x: Math.round(vp ? clampN(x, 0, Math.max(0, vp.w - cw)) : clampN(x, 0, ABS_MAX)), y: Math.round(vp ? clampN(y, 0, Math.max(0, vp.h - ch)) : clampN(y, 0, ABS_MAX)), w: cw, h: ch };
}

// 크기 틀의 끌기: start{x,y,w,h}(창 왼쪽 위 고정) 에서 axis("x"|"y"|"xy")로 dx·dy 만큼 키운다. 최소 이상 · 왼쪽 위 기준으로 앱 창 밖으로 안 나간다(viewport 를 모르면 ABS_MAX 상한).
export function dragRect(start, axis, dx, dy, viewport = null) {
  const r = clampRect(start, viewport);
  if (!r) return null;
  const vp = viewOf(viewport), f = Number.isFinite;
  const lim = (v, min, room) => Math.round(clampN(v, Math.min(min, room), Math.max(Math.min(min, room), room)));
  const w = axis.includes("x") && f(dx) ? lim(r.w + dx, MIN_W, vp ? vp.w - r.x : ABS_MAX) : r.w;
  const h = axis.includes("y") && f(dy) ? lim(r.h + dy, MIN_H, vp ? vp.h - r.y : ABS_MAX) : r.h;
  return { x: r.x, y: r.y, w, h };
}

// 글자 크기: 단계 · 기본(렌더 md 13 = 지금 루트 text_size · Editor 12). 값은 shared 에서 읽으므로 항상 거른다.
export const FONT_STEPS = [9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32];
export const FONT_DEFAULT = { md: 13, code: 12 };
export const fontOf = v => {
  const ok = x => (typeof x === "number" && Number.isFinite(x) && x >= 9 && x <= 32 ? Math.round(x) : null);
  return { md: ok(v?.md) ?? FONT_DEFAULT.md, code: ok(v?.code) ?? FONT_DEFAULT.code };
};
// cur 에서 dir(+1 크게 · -1 작게 · 0 기본)로 한 단계. 단계 밖의 값이면 그 방향의 가장 가까운 단계(끝에서는 멈춘다). kind = "md" | "code".
export function stepFont(cur, dir, kind = "md") {
  const def = FONT_DEFAULT[kind] ?? FONT_DEFAULT.md;
  if (!dir) return def;
  if (typeof cur !== "number" || !Number.isFinite(cur)) return def;
  const next = dir > 0 ? FONT_STEPS.find(n => n > cur) : FONT_STEPS.findLast(n => n < cur);
  return next ?? (dir > 0 ? FONT_STEPS[FONT_STEPS.length - 1] : FONT_STEPS[0]);
}

// 미리보기 창 openOverlay 인자 — 처음 여는 곳(main.js)과 «크게 보기» 다시 열기(preview.js)가 같은 것을 쓴다(옵션이 어긋나지 않게 한 곳).
//  · window: 어둡게 하지 않고, 옆을 눌러도 안 닫히고, Esc 가 mod 로 온다. `key`·`keep` 은 두지 않는다(열 때마다 가운데 · 다시 시작해도 되살리지 않는다).
//  · 늘 가운데에서 열도록 `at`(왼쪽 위 px)을 앱 창 크기(viewport {width,height})로 계산해 준다(share ≤ 0.98 이라 창 안쪽에 든다). 크기를 모르면 at 을 빼고 호스트 기본(가운데)에 맡긴다.
//  · full → 0.98 · rect{x,y,w,h}(크기 틀이 끝낸 자리) → 그 자리·크기 px · size{w,h}(기억된 크기) → 그 크기 px 로 가운데 · 없으면 0.82. 이상한 값은 무시(기본으로).
//  · [주의] viewport 를 모르면 rect 는 x,y 를 맞추지 못한다(최소 크기·양수만 보장) · size 는 at 없이 호스트 가운데에 맡긴다.
export function previewSpec({ mod, owner: _owner, props, full = false, viewport = null, size = null, rect = null }) {
  const vp = viewOf(viewport);
  const spec = { mod, kind: "window", frame: "none", width: full ? 0.98 : 0.82, height: full ? 0.98 : 0.82, props };
  const r = !full && rect ? clampRect(rect, viewport) : null;
  if (r) { spec.width = r.w; spec.height = r.h; spec.at = { x: r.x, y: r.y }; return spec; }
  const z = !full && size ? fitSize(size, viewport) : null;
  if (z) {
    spec.width = z.w; spec.height = z.h;
    if (vp) spec.at = { x: Math.max(0, Math.round((vp.w - z.w) / 2)), y: Math.max(0, Math.round((vp.h - z.h) / 2)) };
    return spec;
  }
  if (vp) spec.at = { x: Math.max(0, Math.round((vp.w - vp.w * spec.width) / 2)), y: Math.max(0, Math.round((vp.h - vp.h * spec.height) / 2)) };
  return spec;
}

// 요청 출처(팝업 종류) — 요청함 req/ack 키를 가진다. ownerKeys · 패널의 요청함(inbox) · 시작 때 옛 요청 버리기(drain)가 모두 이 목록을 쓴다.
// [경고] 새 출처를 여기에 빼먹으면 영속 shared 에 남은 옛 요청(예: «지우기»)이 다음 시작에 돈다.
export const SOURCES = ["preview", "jobs", "ask"];

// 이 주인이 만든 shared 키 전부 — 패널이 닫힐 때 null 로 치운다(영속 shared 에 쌓이지 않게).
export function ownerKeys(owner) {
  return [KEY.jobs(owner), KEY.win(owner), previewKey(owner), KEY.resize(owner), KEY.tf(owner), ...SOURCES.flatMap(f => [KEY.req(owner, f), KEY.ack(owner, f)])];
}

// 호스트 shared() 는 저장된 값 어딘가에 `toString` 키가 있으면 던진다("'toString' is read-only").
// 모든 읽기는 이걸로 — 던지면 onError(기본 null)를 돌려준다. 값이 없어도 null.
export function readShared(shared, key, onError = null) {
  try { return shared(key) ?? null; } catch { return onError; }
}

// 팝업이 보기에 패널이 살아 있나: 패널은 init 에서 jobs 스냅샷을 게시하고 close 에서 null 로 치운다.
export function alive(shared, owner) {
  const v = readShared(shared, KEY.jobs(owner));
  return v != null && typeof v === "object";
}

const ALPHA = "abcdefghijklmnopqrstuvwxyz0123456789";
export function newOwner() {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  return s;
}

// 패널의 owner 는 copy 의 localStorage 에 둔다: 제자리 다시 불러오기(파일 저장)에도 close() 가 안 불려서(AGENTS.md)
// 새 owner 를 만들면 옛 owner 의 jobs 키가 객체로 남아 alive() 가 영영 참이 된다 → 같은 copy 는 같은 owner 를 이어 쓴다.
// 그래서 shared 에 남는 owner 키 수 = (서로 다른 패널 블록 수) × 11 이지 다시 불러온 횟수·재시작 횟수가 아니다.
// taken = 이 프로세스에서 이미 다른 살아 있는 copy 가 쓰는 owner 들(저장소가 copy 끼리 겹쳐 보일 때를 대비) → 겹치면 새로 짓고 저장하지 않는다.
export const OWNER_STORE = "files-plus.owner";
export function restoreOwner(storage, taken = new Set()) {
  let id = null;
  try { const v = storage?.getItem(OWNER_STORE); if (typeof v === "string" && /^[a-z0-9]{8}$/.test(v)) id = v; } catch { /* 저장소 없음 */ }
  if (id && !taken.has(id)) return { owner: id, restored: true };
  const owner = newOwner();
  if (!id) { try { storage?.setItem(OWNER_STORE, owner); } catch { /* 저장 못 하면 이번 삶만 */ } }
  return { owner, restored: false };
}

// 삶 토큰: 제자리 다시 불러오기 뒤에도 옛 빌드의 돌던 전송은 계속 돈다(끊을 수 없다) → 옛 빌드가 새 삶의 스냅샷·기록을 덮지 못하게
// panelInit 마다 새 토큰을 copy 의 localStorage 에 쓰고, shared 에 쓰기 전에 «저장소의 토큰 == 내 토큰» 인지 본다. 아니면 쓰지 않는다.
// 키는 주인별(`files-plus.life/<owner>`): 저장소가 copy 끼리 겹쳐 보여도 다른 copy(다른 owner)가 내 토큰을 덮지 못한다.
// 쓴 뒤 다시 읽어 같지 않으면(저장 실패 · 옛 토큰이 남음) 게이트를 끈다(gated=false) — 안 그러면 새 삶이 영영 막힌다.
export const LIFE_STORE = "files-plus.life";
export const lifeKey = owner => `${LIFE_STORE}/${owner}`;
export function startLife(storage, owner) {
  const life = newOwner() + newOwner();
  let gated = false;
  try { storage?.setItem(lifeKey(owner), life); gated = storage?.getItem(lifeKey(owner)) === life; } catch { gated = false; }
  return { life, gated };
}
// 낡은 삶 = 게이트가 켜져 있고 저장소에 «다른» 문자열 토큰이 있다. 저장소가 없거나 비었거나 읽기가 던지면 막지 않는다.
export function lifeCurrent(storage, owner, life, gated = true) {
  if (!gated) return true;
  try { const v = storage?.getItem(lifeKey(owner)); return !(typeof v === "string" && v !== "" && v !== life); } catch { return true; }
}

// 다시 불러오기 전 삶이 남긴 스냅샷에서 기록으로 옮길 것을 고른다.
//  · wait·run → «실패 · 다시 불러옴» · verify → 취소 «다시 불러옴 · 검증 중»(close 와 같은 규칙: PLACE 는 계속 돌아 파일이 놓였을 수 있다)
//  · 이미 끝난(ok·fail·cancel) 작업 중 기록에 아직 없는 것 → 그 상태 그대로 한 번(늦춤 쓰기 전에 다시 불러온 경우). jid(= 삶:id)로 seen 과 대조한다.
//  · noHistory(«Mac에서 열기» 사본)는 모두 건너뛴다. more = 스냅샷에서 잘려 나간 나머지 → «외 N개» 한 줄.
// seq = 옛 작업 id 의 최댓값(새 id 가 옛 id 와 겹쳐 열려 있는 창의 옛 요청이 새 작업에 닿지 않게).
// 반환: entries(평평한 목록) · groups(상태별 묶음 — 각각 따로 pushHistoryGroup 으로 기록해야 «외 N개» 줄이 자기 상태를 지닌다) · seq.
export function orphanedJobs(snap, now, seen = new Set()) {
  const list = Array.isArray(snap?.jobs) ? snap.jobs.filter(j => j && typeof j === "object") : [];
  const life = typeof snap?.life === "string" && snap.life ? snap.life : null;
  const g = { lostFail: [], lostCancel: [], ok: [], fail: [], cancel: [] };
  const flat = [];
  let seq = 0;
  for (const j of list) {
    const id = fin(j.id);
    if (id != null) seq = Math.max(seq, id);
    if (j.noHistory === true) continue;
    const jid = life && id != null ? `${life}:${id}` : undefined;
    if (jid && seen.has(jid)) continue;       // 이미 기록에 있다(끝난 직후 다시 불러온 경우) — 어느 상태든 두 번 쓰지 않는다
    const base = { dir: j.dir === "down" ? "down" : "up", name: str(j.name), size: fin(j.total) || null, on: str(j.on), ...(jid ? { jid } : {}) };
    const add = (bucket, e) => { g[bucket].push(e); flat.push(e); };
    if (j.state === "wait" || j.state === "run") add("lostFail", { at: fin(now), ...base, state: "fail", where: "", note: "다시 불러옴" });
    else if (j.state === "verify") add("lostCancel", { at: fin(now), ...base, state: "cancel", where: "", note: "다시 불러옴 · 검증 중" });
    else if ((j.state === "ok" || j.state === "fail" || j.state === "cancel") && jid)
      add(j.state, { at: fin(snap.updated) ?? fin(now), ...base, state: j.state, where: str(j.where), note: str(j.note) });
  }
  const m = snap?.more;
  const n = k => (m && typeof m === "object" ? Math.max(0, fin(m[k]) ?? 0) : 0);
  const lost = n("wait") + n("run"), verifying = n("verify");
  // 잘려 나간 몫은 상태별로 따로 센다(한 묶음에 섞으면 접힌 줄이 첫 항목의 상태를 따라 50개 «실패» 가 «취소» 로 보인다).
  const more = [];
  if (lost > 0) more.push([{ at: fin(now), dir: "both", name: `외 ${lost}개`, size: null, on: "", state: "fail", where: "", note: "다시 불러옴" }]);
  if (verifying > 0) more.push([{ at: fin(now), dir: "both", name: `외 ${verifying}개`, size: null, on: "", state: "cancel", where: "", note: "다시 불러옴 · 검증 중" }]);
  const groups = [g.lostFail, g.lostCancel, g.ok, g.fail, g.cancel, ...more].filter(x => x.length);
  return { entries: [...flat, ...more.flat()], groups, seq };
}

// 조각 파일 경로 꼴: 절대 경로 · `.<fnv8>.files-plus-<rand8>.part`(transfer.js partName) · NUL·줄바꿈·«..» 없음. 폴더 이름이어도 `rm -f` 는 폴더를 못 지운다(-r 없음).
const PART_RE = /^\/(?:[^\0\n]*\/)?\.[0-9a-f]{8}\.files-plus-[0-9a-z]{8}\.part$/;
export const isPartPath = p => typeof p === "string" && p.length < 4096 && PART_RE.test(p) && !p.split("/").includes("..");

// 죽은 삶(life 가 지금 삶과 다름)이 남긴 스냅샷에서 지워도 되는 조각 파일: «도는(run)» 작업이 스냅샷에 적어 둔 정확한 경로만 — 훑거나 glob 하지 않는다.
//  · wait 는 조각이 아직 없고 · verify 는 자리 잡기(ln · mv)가 돌고 있을 수 있어 건드리지 않는다.
//  · 지금 삶의 스냅샷(life 같음) · life 없는 스냅샷은 빈 목록. 같은 (경로, 쪽)은 한 번. 최대 200개.
// 반환: [{ path, on }] — on null = 이 컴퓨터.
export function orphanParts(snap, currentLife) {
  const life = typeof snap?.life === "string" ? snap.life : "";
  if (!life || life === currentLife || !Array.isArray(snap?.jobs)) return [];
  const out = [], seen = new Set();
  for (const j of snap.jobs) {
    if (!j || typeof j !== "object" || j.state !== "run" || !isPartPath(j.part)) continue;
    const on = typeof j.partOn === "string" && j.partOn !== "" ? j.partOn : null;
    const k = `${on ?? ""}\0${j.part}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push({ path: j.part, on });
    if (out.length >= 200) break;
  }
  return out;
}

// 기록에 이미 있는 작업 id(jid) 집합 — 묶음 줄은 jids 로 접힌 것들을 들고 있다.
export function seenJids(history) {
  const out = new Set();
  for (const e of Array.isArray(history) ? history : []) {
    if (!e || typeof e !== "object") continue;
    if (typeof e.jid === "string") out.add(e.jid);
    if (Array.isArray(e.jids)) for (const x of e.jids) if (typeof x === "string") out.add(x);
  }
  return out;
}

const STATES = ["wait", "run", "verify", "ok", "fail", "cancel"];
const fin = v => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = v => (v == null ? "" : String(v));

// 게시용 평범한 JSON — 함수·클로저·그 밖의 필드는 버리고 목록에 든 필드만 남긴다. 숫자는 유한하거나 null.
// 크기 상한(1000개 드롭에서 스냅샷이 ~150 KB 로 부푸는 것을 막는다): 활성(wait·run·verify)은 run·verify 먼저 + 대기는 id 작은(곧 돌) 순으로
// activeCap 개, 끝난 것은 앞 keep 개만 싣고 나머지는 more = {wait, run, verify, ok, fail, cancel, tot, got} 로 센다(summary(jobs, more) 가 합친다).
export function snapshot(owner, on, jobs, now, { life = "", activeCap = 100, keep = 30 } = {}) {
  const list = (Array.isArray(jobs) ? jobs : []).filter(j => j && typeof j === "object");
  const act = list.filter(j => j.state === "wait" || j.state === "run" || j.state === "verify");
  const rank = j => (j.state === "wait" ? 1 : 0);
  const actSet = new Set(act);
  const shownAct = new Set([...act].sort((a, b) => rank(a) - rank(b) || (fin(a.id) ?? 0) - (fin(b.id) ?? 0)).slice(0, Math.max(0, activeCap)));
  let fins = 0;
  const shownFin = new Set();
  for (const j of list) if (!actSet.has(j) && fins < keep) { shownFin.add(j); fins++; }
  const more = { wait: 0, run: 0, verify: 0, ok: 0, fail: 0, cancel: 0, tot: 0, got: 0 };
  const shown = [];
  for (const j of list) {
    if (shownAct.has(j) || shownFin.has(j)) { shown.push(j); continue; }
    const st = STATES.includes(j.state) ? j.state : "wait";
    more[st]++;
    const w = weight(j);
    if (w) { more.tot += w[0]; more.got += w[1]; }
  }
  const hidden = list.length - shown.length;
  return {
    owner: str(owner),
    on: str(on),
    life: str(life),
    updated: fin(now),
    jobs: shown.map(j => ({
      id: fin(j.id) ?? str(j.id),
      dir: j.dir === "down" ? "down" : "up",
      name: str(j.name),
      total: fin(j.total),
      done: fin(j.done),
      state: STATES.includes(j.state) ? j.state : "wait",
      note: str(j.note),
      speed: fin(j.speed),
      eta: fin(j.eta),
      where: str(j.where),
      on: str(j.on),
      cancelling: j.cancelled === true && (j.state === "wait" || j.state === "run"),
      ...(j.noHistory === true ? { noHistory: true } : {}),
      // 도는 전송의 조각 파일(.part) 정확한 경로와 쪽(원격이면 머신 이름) — 앱이 죽어 못 지운 조각을 다음 시작이 그 경로 하나씩만 지우는 데 쓴다(orphanParts).
      ...(j.state === "run" && isPartPath(j.part) ? { part: j.part, partOn: typeof j.partOn === "string" && j.partOn !== "" ? j.partOn : null } : {}),
    })),
    ...(hidden > 0 ? { more } : {}),
  };
}

// 진행률에 드는 몫: [총량, 받은 양] — total>0 이고 fail·cancel 이 아닌 것만(ok 는 전부).
//   total 을 모르거나 ≤0 인 ok 는 [1, 1] — 바이트 가중 작업 옆에선 무시할 몫이고, 그런 것만 있으면 100% 로 읽힌다(0% 로 남지 않게).
function weight(j) {
  const t = fin(j.total);
  if (t == null || t <= 0) return j.state === "ok" ? [1, 1] : null;
  if (j.state === "fail" || j.state === "cancel") return null;
  return [t, j.state === "ok" ? t : Math.min(Math.max(fin(j.done) ?? 0, 0), t)];
}

// pct: 바이트 가중 — total>0 인 작업만 센다(단 total 모르는 ok 는 [1,1] 몫으로 센다). ok 는 전부 끝난 것으로, 그 밖에는 done(0..total) 으로 센다.
//   fail·cancel 은 pct 에서 아예 뺀다(끝까지 못 간 바이트가 진행률을 끌어내리거나 부풀리지 않게). finished 에는 센다.
export function summary(jobs, more = null) {
  const list = Array.isArray(jobs) ? jobs.filter(j => j && typeof j === "object") : [];
  let finished = 0, running = 0, waiting = 0, failed = 0, tot = 0, got = 0;
  for (const j of list) {
    if (j.state === "ok" || j.state === "fail" || j.state === "cancel") finished++;
    if (j.state === "run" || j.state === "verify") running++;
    if (j.state === "wait") waiting++;
    if (j.state === "fail") failed++;
    const w = weight(j);
    if (w) { tot += w[0]; got += w[1]; }
  }
  // 스냅샷에서 잘려 나간 작업의 몫(more)도 센다.
  let extra = 0;
  if (more && typeof more === "object") {
    const n = k => Math.max(0, fin(more[k]) ?? 0);
    finished += n("ok") + n("fail") + n("cancel"); running += n("run") + n("verify"); waiting += n("wait"); failed += n("fail");
    tot += n("tot"); got += Math.min(n("got"), n("tot"));
    extra = n("ok") + n("fail") + n("cancel") + n("run") + n("verify") + n("wait");
  }
  const pct = tot > 0 ? Math.min(100, Math.max(0, Math.round((got / tot) * 100))) : 0;
  const total = list.length + extra;
  return { total, finished, running, waiting, failed, pct, text: total ? `전송 ${finished}/${total} · ${pct}%` : "전송 없음" };
}

export function bar(pct, width = 8) {
  const w = Math.max(0, Math.floor(width));
  const p = Math.min(100, Math.max(0, fin(pct) ?? 0));
  const n = Math.round((p / 100) * w);
  return "▓".repeat(n) + "░".repeat(w - n);
}

// 최근 5초 이동평균. sample(누적 바이트, now[, 전체 바이트]) — 전체를 주면 eta(초)도 계산한다.
// 첫 표본 뒤 3초 안은 speed null("계산 중").
export function speedometer() {
  const WINDOW = 5000, WARM = 3000;
  let pts = [];
  return {
    sample(bytes, now, total) {
      pts.push([now, bytes]);
      while (pts.length > 2 && now - pts[1][0] >= WINDOW) pts.shift();
      if (now - pts[0][0] < WARM) return { speed: null, eta: null };
      const [t0, b0] = pts[0];
      const dt = (now - t0) / 1000;
      const speed = dt > 0 ? Math.max(0, (bytes - b0) / dt) : null;
      let eta = null;
      if (speed && speed > 0 && fin(total) != null) eta = Math.max(0, (total - bytes) / speed);
      return { speed, eta };
    },
    reset() { pts = []; },
  };
}

// 요청 id: 1 이상 안전한 정수만(1e308 은 max+1 == max 라 요청함이 멈춘다) · MAX_SAFE_INTEGER 자신도 뺀다(+1 이 안전하지 않다).
const okId = v => Number.isSafeInteger(v) && v >= 1 && v < Number.MAX_SAFE_INTEGER;
const idOf = e => (e && typeof e === "object" && okId(e.id) ? e.id : null);
const listOf = v => (Array.isArray(v) ? v.filter(e => idOf(e) != null) : []);
const ackOf = v => (Number.isSafeInteger(v) && v >= 0 && v < Number.MAX_SAFE_INTEGER ? v : 0);

// 팝업 → 패널 요청. ack 이하는 지우고 {id: max(남은 id, ack)+1} 를 덧붙인다.
export function send(shared, setShared, owner, from, action, args = {}) {
  const ack = ackOf(readShared(shared, KEY.ack(owner, from)));
  const list = listOf(readShared(shared, KEY.req(owner, from))).filter(e => e.id > ack);
  const id = Math.max(ack, ...list.map(e => e.id)) + 1;
  if (!okId(id)) {
    // 망가진 ack(MAX_SAFE_INTEGER 근처)면 새 id 가 영영 거부된다 → 요청함을 처음부터: 요청을 id 1 로 먼저 쓰고 ack 를 0 으로 되돌린다.
    // (요청 먼저: 그 사이 패널이 읽어도 옛 ack 보다 작아 무시될 뿐이고, ack 가 0 이 된 다음 틱에 id 1 이 전달된다. ack 는 원래 패널만 쓰지만 이 복구에 한해 팝업이 쓴다.)
    setShared(KEY.req(owner, from), [{ id: 1, action, args }]);
    setShared(KEY.ack(owner, from), 0);
    return 1;
  }
  setShared(KEY.req(owner, from), [...list, { id, action, args }]);
  return id;
}

// 패널 전용: ack 보다 큰 요청을 id 오름차순으로 돌려주고 ack 를 가장 큰 id 로 올린다.
export function drain(shared, setShared, owner, from) {
  const ack = ackOf(readShared(shared, KEY.ack(owner, from)));
  const fresh = listOf(readShared(shared, KEY.req(owner, from))).filter(e => e.id > ack).sort((a, b) => a.id - b.id);
  if (!fresh.length) return [];
  setShared(KEY.ack(owner, from), fresh[fresh.length - 1].id);
  return fresh.map(e => ({ id: e.id, action: e.action, args: e.args ?? {} }));
}

export function pushHistory(list, entry, max = 200) {
  const rest = Array.isArray(list) ? list : [];
  return [entry, ...rest].slice(0, Math.max(0, max));
}

// 한 동작이 낳은 기록이 여러 개면(모두 취소 · 패널 닫힘) 앞 group-1 개만 남기고 «외 N개» 한 줄로 묶는다.
// 같은 상태의 묶음용이다(요약 줄의 state 는 첫 항목을 따른다). 200개 기록을 한 번에 밀어내지 않게 한다.
export function pushHistoryGroup(list, entries, max = 200, group = 5) {
  const es = (Array.isArray(entries) ? entries : []).filter(e => e && typeof e === "object");
  if (!es.length) return Array.isArray(list) ? list : [];
  const g = Math.max(2, group);
  // 묶음 줄: 방향이 섞였으면 «both»(화면 ↑↓) · 서로 다른 머신이면 on 을 비운다 · 방향별 개수는 note 에.
  const ups = es.filter(e => e.dir === "up").length, downs = es.filter(e => e.dir === "down").length;
  const dir = ups && downs ? "both" : ups ? "up" : "down";
  const note = ups && downs ? `묶음 · ↑${ups} ↓${downs}` : "묶음";
  const on = es.every(e => e.on === es[0].on) ? es[0].on : "";
  // 접힌 줄은 접힌 작업들의 jid 를 jids 로 들고 있다(다시 불러온 뒤 같은 작업을 두 번 기록하지 않는 대조용 · 150개까지).
  const folded = es.slice(g - 1).map(e => e.jid).filter(x => typeof x === "string").slice(0, 150);
  const { jid: _j, ...head } = es[0];
  const shown = es.length > g ? [...es.slice(0, g - 1), { ...head, dir, on, name: `외 ${es.length - (g - 1)}개`, size: null, where: "", note, ...(folded.length ? { jids: folded } : {}) }] : es;
  return [...shown, ...(Array.isArray(list) ? list : [])].slice(0, Math.max(0, max));
}

const p2 = n => String(n).padStart(2, "0");
const dayKey = d => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
// 이 컴퓨터의 달력 날(로컬) 기준. 날짜는 직접 찍는다(로캘 의존 없음).
export function groupHistory(list, now) {
  const today = new Date(now);
  const yest = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const tk = dayKey(today), yk = dayKey(yest);
  const out = [];
  for (const it of Array.isArray(list) ? list : []) {
    const d = new Date(it && it.at);
    const k = dayKey(d);
    const label = Number.isNaN(k) ? "?" : k === tk ? "오늘" : k === yk ? "어제" : `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(it);
    else out.push({ label, items: [it] });
  }
  return out;
}

const LABELS = { wait: "대기", run: "진행", verify: "검증 중", ok: "끝", fail: "실패", cancel: "취소" };
// 저장된 기록·원격이 준 문자열로 찾는다: "constructor" · "__proto__" 가 Object.prototype 에 닿지 않게 자기 키만 본다.
export const own = (map, key) => (typeof key === "string" && Object.hasOwn(map, key) ? map[key] : undefined);
export function stateLabel(state) { return own(LABELS, state) ?? ""; }

// 원격 파일 이름이 이 컴퓨터 경로에 들어가도 되는지: 비지 않고 · "." ".." 아니고 · "/" 와 NUL 이 없다.
// 원격이 `/../.zshenv` 같은 이름을 돌려주면 경로가 폴더 밖으로 나간다 → 이름이 경로에 닿는 모든 곳에서 부른다.
export function safeName(name) {
  return typeof name === "string" && name !== "" && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\0");
}

// 앞 호출은 바로, 창(ms) 안의 호출은 하나로 모아 창 끝에 마지막 인자로 한 번(trailing). ms 는 숫자 또는 창마다 부르는 함수.
// flush() = 밀린 호출을 지금 돌리고 창을 새로 시작 · dropPending() = 밀린 호출만 버린다(창은 그대로 — 즉시 쓰기가 창을 풀지 못한다) ·
// cancel() = 밀린 호출도 창도 버린다.
// timers = { setTimeout(fn, ms) → 핸들, clearTimeout(핸들) } 는 필수 — herdr 실행 환경에는 전역 setTimeout 이 없다
// (cx.timer.after 를 감싸 넘긴다). 빠뜨리면 첫 호출이 아니라 만들 때 바로 던져 새 호출 자리가 조용히 깨지지 않게 한다.
export function throttle(fn, ms, timers) {
  if (typeof timers?.setTimeout !== "function" || typeof timers?.clearTimeout !== "function") {
    throw new TypeError("throttle: timers { setTimeout, clearTimeout } 가 필요하다(herdr 에는 전역 타이머가 없다 — cx.timer.after 를 감싸 넘긴다)");
  }
  const st = (...a) => timers.setTimeout(...a);
  const ct = id => timers.clearTimeout(id);
  const win = () => (typeof ms === "function" ? ms() : ms);
  let timer = null, pending = null;
  const tick = () => {
    timer = null;
    if (pending) { const a = pending; pending = null; fn(...a); timer = st(tick, win()); }
  };
  const t = (...args) => {
    if (timer == null) { fn(...args); timer = st(tick, win()); }
    else pending = args;
  };
  t.flush = () => {
    if (!pending) return;
    const a = pending; pending = null;
    if (timer != null) ct(timer);
    fn(...a);
    timer = st(tick, win());
  };
  t.dropPending = () => { pending = null; };
  t.hasPending = () => pending != null;
  t.cancel = () => { if (timer != null) ct(timer); timer = null; pending = null; };
  return t;
}
