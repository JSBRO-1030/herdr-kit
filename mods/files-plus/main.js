// files-plus(파일+) — 지금 터미널 폴더의 파일 패널. 한 mod 다섯 모드: 패널(이 파일) · preview(preview.js) · jobs(jobs-view.js) · menu · ask(ask-view.js).
// 바탕: herdr-app 기본 mod `files`(defaults/mods/files · Apache-2.0 · herdr-app ce0fd1b)의 폴더 읽기·트리.
// 패널이 하는 일: 트리 · 전송 큐 실행(주인) · 진행 게시 · 팝업 요청 처리 · 팝업 열기 · 새 폴더/이름 바꾸기/지우기 실행. 설계: docs/popups-design.md §3 · §8.
// Windows 머신 폴더 읽기(PowerShell 길)는 뺐다 — 옮기기가 sh 로만 돈다.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, terminals, exec, hc, readTextFile, watchFolder, theme, window, appHome, home, notify, openOverlay, closeOverlay, shared, setShared, props as modProps } from "herdr";
import { makeTransfer, oneAtATime } from "./transfer.js";
import { Preview, ResizeFrame, openPreviewWindow } from "./preview.js";
import { dedupeNested, replaceGroupLines } from "./tree.js";
import { FileMenu, AskDialog } from "./ask-view.js";
import { opPlan, putTicket, takeTicket, parentRel, joinAbs, menuItems, menuSpec, askSpec, askProps, renameTree, dropTree, withEntry, withoutEntry, renamedEntry, opError } from "./fsops.js";
import { isRunnable, MAC_HANDLER_SCRIPT, macHandlerVerdict, linuxHandlerVerdict } from "./kinds.js";
import { JobsWindow, winKey, W as JOBS_W, H_OPEN as JOBS_H_OPEN, H_BAR as JOBS_H_BAR } from "./jobs-view.js";
import { scanText, mergeResolved, mergeLight, endedWorking, unresolved, terminalMachine, RESOLVE_SCRIPT, SEARCH_SCRIPT, scanGate, errClass, stuckAfter, noteWrite, termKey, TF_STUCK_MS, dcStep, dcPick, dcLonger, dcChoose, dcBind, dcOldText, dcClipShape, dcReadCut, DC_BIND_MAX, selSpan, selKey } from "./termfiles.js";
import { KEY, SOURCES, restoreOwner, orphanedJobs, snapshot, summary, speedometer, drain, pushHistoryGroup, throttle, safeName, ownerKeys, readShared, startLife, lifeCurrent, seenJids, previewKey, orphanParts, isPartPath, livePreviewId, partsKey, closingParts, pendingParts, OWNERS_KEY, OWNER_BEAT_MS, registerOwner, dropOwners, deadOwners, normalizeOwners, ownerCleanupPlan } from "./state.js";

const NAME = "files-plus";
// 숨긴 폴더: 앱은 mod 폴더의 보이는 파일이 바뀌면 mod 를 다시 읽는다.
const CACHE_REL = `mods/${NAME}/.cache`;
const OPEN_LIMIT = 4 * 1024 * 1024 * 1024;
const PER_FOLDER = 500, TOTAL = 5000;
// [주의] 폴더 하나의 파일 수 상한 — 파일마다 작업 1개(스냅샷·기록·메모리) · 넘으면 그 폴더 작업만 실패한다. 올리려면 나눠서.
// 한 번 놓기(여러 폴더 합계)도 이 상한을 함께 쓴다.
const MAX_TREE_FILES = 5000;
const MAX_TREE_DIRS = 2000;                 // 폴더 하나의 하위 폴더 수 상한(MKDIRS 묶음 수·시간)
const ACTIVE_CAP = 100;                     // 스냅샷에 싣는 활성 작업 수(나머지는 more 개수로 · 1000개 드롭에서 쓰기 크기 제한)
const GROUP_FLUSH = 200;                    // 폴더 그룹이 새 기록을 이만큼 모으면 그룹이 안 끝나도 그 그룹 줄을 갈아 끼워 쓴다(크래시 대비 · 줄 수는 늘지 않는다)
const KEEP_JOBS = 30;                       // 목록에 남기는 끝난 작업 수(더 오래된 건 기록으로만)
const ACTIVE = new Set(["wait", "run", "verify"]);
const icon = (n) => `mods/${NAME}/${n}.svg`;
// 이 모듈 버전에서 살아 있는 패널 copy 들의 owner(같은 owner 를 두 copy 가 쓰지 않게 하는 안전장치 — 새 버전은 빈 집합으로 시작한다).
const LIVE = new Set();

// 지금 자리: 눌린 터미널 페인의 폴더와 머신. 이 mod 의 페인을 누른 것이면 앞 자리를 그대로 둔다.
function location(prev) {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  if (pane?.mod === NAME && prev) return prev;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}

// «터미널에 나온 파일» 대상: 눌린 터미널의 주소 · 머신(on) · 폴더 · 상태. 이 mod 페인이 눌렸거나 터미널이 아니면 앞 값을 그대로 둔다. 입출력 없음(300 ms 틱에서 부른다).
function termTarget(prev) {
  const f = focused(), all = panes();
  const pane = f?.pane ? all.find(p => p.pane === f.pane) : null;
  if (pane?.mod === NAME || !f?.terminal) return prev ?? null;
  const addr = f.terminal, info = all.find(p => p.terminal === addr), space = spaces().find(s => s.active);
  // 머신은 location() 과 같은 규칙(terminalMachine). [주의] 로컬 터미널 안에서 `ssh` 로 들어간 서버의 파일은 이 규칙으로 알 수 없다 — 이름은 Mac 에서 푼다.
  return { addr, on: terminalMachine(f, space, addr), cwd: info?.cwd || f.cwd || null, status: info?.status ?? null };
}
// TF_ROWS = 보이는 줄 수(넘치면 스크롤) · TF_MAX = 목록 크기 · TF_POLL_MS = working 중 가벼운 다시 훑기 간격
const TF_READ_MS = 5000, TF_LINES = 300, TF_TEXT = 64 * 1024, TF_DEBOUNCE = 800, TF_ROWS = 8, TF_MAX = 12, TF_POLL_MS = 10000;
// 더블클릭 열기: 선택 시각부터 이 시간이 지나면 열지 않는다(느린 원격에서 늦게 뜬 미리보기가 키보드를 가져가지 않게)
const DC_OPEN_MAX_MS = 4000;
// 더블클릭 묶기(dcBind): 선택 행이 맨 아래에서 이만큼(행) 안이면 그 행까지 깊게 읽는다 · 깊게 읽은 글 전체 상한(UTF-16) — 넘으면 앞을 자르고 cut 이지만 글이 DC_BIND_MAX(512 KiB)를 넘어 묶이지 않는다(옛 길). 아래 붙임에 닿는 잘림은 dcReadCut(줄 수 제한)뿐.
const DC_READ_MAX = 20000, DC_TEXT_MAX = 4 * 1024 * 1024;
// 이 주소 터미널의 전체 행 수(panes() scroll.total): 정수 total 을 가진 항목이 정확히 하나일 때만 · 아니면 null(레이아웃 블록 터미널 · 대체 화면 · 겹침).
const dcTotal = (addr) => { const m = panes().filter(p => p.terminal === addr && Number.isInteger(p.scroll?.total)); return m.length === 1 ? m[0].scroll.total : null; };

// [주의] hc 에는 timeout 옵션이 없다 → ms 안에 안 돌아오면 null(늦은 결과는 무시) — 안 그러면 tfBusy 가 안 풀려 줄이 멎는다. 실패도 null.
function hcLimited(cx, args, ms = TF_READ_MS) {
  return new Promise(resolve => {
    let done = false;
    const timer = cx.timer.after(ms, () => { if (!done) { done = true; resolve(null); } });
    const end = v => { if (!done) { done = true; try { timer.cancel(); } catch { /* 이미 끝남 */ } resolve(v); } };
    hc(args).then(end, () => end(null));
  });
}

async function directory(path, on) {
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  const r = await exec("sh", ["-c", script, "files", path], { on });
  if (r.code !== 0) throw new Error(r.stderr || "이 폴더를 읽을 수 없다");
  const fields = r.stdout.split("\0"), out = [];
  // 원격이 준 이름은 믿지 않는다: `/../.zshenv` 같은 것은 이 컴퓨터 경로로 새므로 목록에서 뺀다.
  for (let i = 0; i + 1 < fields.length; i += 2) if (safeName(fields[i + 1])) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

const parent = parentRel;

export default class FilesPlus extends View {
  // 앱 루트 mod 의 init 인자는 호스트가 mod props 로 채우지 않는다(gpui-kit.d.ts View.init = gpui-shell 중첩 뷰 Props) →
  // 기본 mod(confirm)처럼 herdr 의 props() 에서 읽는다. 인자는 검사(herdr-app check) 같은 대역이 넘길 때를 위한 대비.
  init(initProps, cx) {
    const p = [modProps(), initProps].find(x => x && typeof x === "object" && x.mode) ?? {};   // props() 우선 · mode 가 든 쪽을 쓴다
    if (p.mode === "preview") { this.impl = new Preview(p, cx); return; }
    if (p.mode === "preview-resize") { this.impl = new ResizeFrame(p, cx); return; }
    if (p.mode === "jobs") { this.impl = new JobsWindow(p, cx); return; }
    // [주의] 팝업 모드는 panelInit 앞에서 갈라야 한다 — 빠지면 overlay 가 두 번째 패널이 된다.
    if (p.mode === "menu") { this.impl = new FileMenu(p, cx); return; }
    if (p.mode === "ask") { this.impl = new AskDialog(p, cx); return; }
    this.panelInit(cx);
  }

  render(cx) { return this.impl ? this.impl.render(cx) : this.panelRender(cx); }

  async close(cx) {
    if (this.impl) { await this.impl.close?.(cx); return; }
    // 패널(레이아웃 전환 · 블록 제거 · 앱 종료): 동기로만 한다 — 호스트는 close 뒤 ~250 ms 에 task 를 끊고, 끊긴 약속은 영영 안 끝난다.
    this.closed = true;
    try { this.publish?.cancel(); } catch { /* 종료 중 */ }
    try { this.tfTimer?.cancel(); } catch { /* 종료 중 */ }
    try { this.histPub?.cancel(); } catch { /* 종료 중 */ }
    LIVE.delete(this.owner);
    this.closePreview();
    if (!this.lifeOk()) return;     // 낡은 삶(다시 불러오기로 밀려난 빌드) — 새 삶의 shared 를 건드리지 않는다
    try {
      // 검증 중(되돌릴 수 없음)이던 것: 파일은 놓였을 수 있다 → 기록에만 «패널 닫힘 · 검증 중» 으로 남긴다.
      const verifying = [];
      for (const j of this.jobs) if (!j.ended && j.state === "verify") { const e = this.settle(j, "cancel", "패널 닫힘 · 검증 중"); if (j.group) this.collect(j, e); else if (e) verifying.push(e); }
      this.record(verifying);
      // 도는 전송의 조각 경로를 공용 키에 남긴다: 돌던 청크 exec(`>>`)는 못 끊어 rm 뒤에 파일을 되살릴 수 있다 → 다음 삶의 panelInit 이 같은 정확한 경로를 한 번 더 지운다.
      // [주의] 이 키는 ownerKeys 에 없어 아래 키 치우기에서 살아남는다(다음 삶이 읽고 지운다). 상한 PARTS_CAP.
      try {
        const list = closingParts(this.jobs, readShared(shared, partsKey(this.owner), []));
        if (list.length) setShared(partsKey(this.owner), list);
      } catch { /* 키 하나 실패가 닫힘을 막지 않게 */ }
      // 줄 서 있거나 도는 작업은 취소로 맺고 기록에 남긴다. 돌던 exec 는 못 끊는다 → 그 작업의 .part 한 개씩만 지운다(정확한 경로만).
      this.cancelMany(this.jobs, "패널 닫힘", true);
    } catch { /* 종료 중 */ }
    try { for (const g of [...this.groups]) this.flushGroup(g); }   // 폴더 그룹에 남은 기록은 버리지 않고 지금 쓴다
    catch { /* 아래 기록 쓰기는 한다 */ }
    try { this.writeHistory(); }      // 닫힌 뒤엔 타이머가 안 돈다 → 모아 둔 기록을 지금 쓴다
    catch { /* 기록이 안 써져도 아래 키 치우기는 한다 */ }
    finally {
      try { setShared(OWNERS_KEY, dropOwners(readShared(shared, OWNERS_KEY), [this.owner])); } catch { /* 등록부 정리 실패 — 남아도 60 s 뒤 죽은 주인으로 치워진다 */ }
      // 이 주인의 shared 키를 치운다: 열려 있는 팝업은 jobs 키가 없으면 «패널 닫힘» 으로 알린다. 읽기가 던지는 값(toString 키)도 치운다.
      for (const key of ownerKeys(this.owner)) {
        try { if (readShared(shared, key, 1) != null) setShared(key, null); } catch { /* 키 하나 실패가 나머지를 막지 않게 */ }
      }
    }
  }

  // 이 패널의 미리보기 창을 닫는다(주인 없는 고아 창 방지 · 지운/바꾼 파일을 보이는 창 정리). 창 쪽도 jobs 키가 치워지면 0.5 s 안에 스스로 닫는다(id 가 바뀐 경우의 보험).
  // 창 id 는 shared 의 previewKey 가 «지금 것»(크게 보기가 새 창으로 바꾸면 그쪽이 쓴다) — 낡은 삶이 아닐 때만 읽는다.
  closePreview() {
    const ids = new Set([this.previewId]);
    // 키 값은 {id, at} — at 이 5 s 안(살아 있는 미리보기)일 때만 믿는다. 낡은 id 는 호스트가 다른 창에 재사용했을 수 있어 닫지 않는다.
    if (this.lifeOk()) ids.add(livePreviewId(readShared(shared, previewKey(this.owner)), Date.now()));
    for (const id of ids) if (typeof id === "string" && id) { try { closeOverlay(id); } catch { /* 이미 닫힘 */ } }
    this.previewId = null; this.previewDir = null;
  }

  // ── 패널 ────────────────────────────────────────────────────────────
  panelInit(cx) {
    // owner 는 copy 의 localStorage 에 둔다(제자리 다시 불러오기에도 이어 씀 · 없으면 이번 삶만). 설계: docs §3.
    const store = typeof localStorage === "undefined" ? null : localStorage;
    this.owner = restoreOwner(store, LIVE).owner;
    // 삶 토큰(§3): 이 삶이 shared 에 쓰기 전에 저장소의 토큰이 아직 내 것인지 본다 — 다시 불러온 뒤 옛 빌드의 늦은 쓰기를 막는다.
    const lf = startLife(store, this.owner);
    this.life = lf.life; this.lifeGated = lf.gated;
    LIVE.add(this.owner);
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.jobs = []; this.seq = 0; this.viewer = false; this.groups = new Set();
    this.tickets = new Map(); this.previewDir = null; this.rightAt = 0;   // 티켓 = 메뉴·이름 창의 1회용 요청권(fsops.js)
    this.tx = makeTransfer(exec, { quarantine: () => this.mac }); this.line = oneAtATime();
    this.cacheDir = `${appHome()}/${CACHE_REL}`;
    // herdr 에는 전역 setTimeout 이 없다 → init 의 AsyncContext 로 cx.timer.after 를 감싼다(Task.cancel() 로 끈다).
    const timers = { setTimeout: (fn, ms) => cx.timer.after(ms, () => fn()), clearTimeout: task => task?.cancel() };
    // 작업이 많으면(드롭 수백 개) 창을 넓힌다: 250 ms → 1 s. 끝 상태는 flush 로 반드시 올라간다.
    this.publish = throttle(() => this.publishNow(), () => (this.jobs.filter(j => ACTIVE.has(j.state)).length > 30 ? 1000 : 250), timers);
    this.histBuf = [];
    this.histPub = throttle(() => this.writeHistory(), 1000, timers);
    // 하루 넘은 사본은 지운다(html-viewer 와 같은 꼴).
    exec("find", [this.cacheDir, "-mindepth", "1", "-maxdepth", "1", "-mmin", "+1440", "-exec", "rm", "-rf", "{}", "+"]).catch(() => {});
    cx.spawn(async cx => { this.viewer = (await readTextFile(`${appHome()}/mods/html-viewer/main.js`).catch(() => null)) !== null; cx.notify(); });
    // 다시 불러오기 직전 삶의 흔적: 끝나지 못한 작업은 «실패 · 다시 불러옴» 기록으로 · 옛 요청은 버린다(ack 를 최대 id 로) ·
    // 닫히지 못한 옛 전송 창 깃발은 치운다(남아 있으면 새 작업이 창을 못 연다 · 열려 있던 창이면 다음 새 작업이 같은 key 로 그 자리에서 바꾼다).
    //   끝났지만 기록에 아직 없던 작업(늦춤 쓰기 전에 다시 불러온 경우)도 한 번 옮긴다 — 기록의 jid 와 대조해 두 번 쓰지 않는다. noHistory 는 뺀다.
    const old = readShared(shared, KEY.jobs(this.owner));
    if (old && typeof old === "object") {
      const o = orphanedJobs(old, Date.now(), seenJids(readShared(shared, KEY.history))); this.seq = o.seq; for (const g of o.groups) this.record(g);
      // 죽은 삶이 도는 중에 남긴 조각 파일: 스냅샷에 적힌 정확한 경로(이름이 조각 꼴인 것만)를 하나씩 지운다. 못 지우면 조용히 둔다.
      for (const t of orphanParts(old, this.life)) this.rmPart(t.path, t.on);
    }
    // 앞 삶이 닫히며 남긴 «돌던 전송의 조각» — 닫힘 뒤에 늦게 끝난 `>>` 가 되살렸을 수 있다 → 같은 정확한 경로를 지운다.
    // [주의] 지금은 this.jobs 가 비어 있어 «살아 있는 작업 제외» 가 무의미하다 → init 에서 한 번, ~10 s · ~60 s 뒤에 다시(그 사이 죽은 삶의 늦은 `>>` 가 조각을 되살릴 수 있다). 키는 마지막 패스 뒤에만 치운다.
    //   늦은 패스는 그때의 this.jobs 로 살아 있는 작업의 경로를 뺀다. 목록이 PARTS_CAP 를 넘었으면 closingParts 가 가장 새 PARTS_CAP 개만 남겼다(넘친 옛 조각은 못 지움).
    try {
      const pk = partsKey(this.owner), left = readShared(shared, pk);
      if (left != null) {
        const sweep = () => { for (const t of pendingParts(left, this.jobs)) this.rmPart(t.path, t.on); };
        sweep();
        const later = (ms, last) => cx.timer.after(ms, () => {
          if (this.closed || !this.lifeOk()) return;
          sweep();
          if (last) { try { if (readShared(shared, pk, 1) != null) setShared(pk, null); } catch { /* 다음 삶이 다시 한다 */ } }
        });
        later(10000, false); later(60000, true);
      }
    } catch { /* 정리 실패가 시작을 막지 않게 */ }
    for (const from of SOURCES) drain(shared, setShared, this.owner, from);
    if (readShared(shared, KEY.win(this.owner)) != null) setShared(KEY.win(this.owner), null);
    this.publishNow();
    // 주인 등록부(G3): 내 owner 를 올리고 15 s 마다 at 을 새로 쓴다 · 죽은 다른 주인의 흔적은 지금과 60 s 마다 치운다.
    // [주의] 패널이 열려야 정리가 돈다 — 앱을 다시 켠 뒤 패널이 자동으로 안 열리면 열 때까지 남는다(docs §3).
    this.ownerSeen = new Map();
    this.beat();
    this.reap(cx);
    cx.timer.every(OWNER_BEAT_MS, () => this.beat());
    cx.timer.every(60000, cx => this.reap(cx));
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
    // «터미널에 나온 파일» 줄: 상태는 this.tf* (스캔 시점 = 틱에서 key 변화 · 새로고침 단추 · 패널 열림 · working 중 10 s 가벼운 스캔)
    this.tfList = []; this.tfCollapsed = false; this.tfBusy = false; this.tfAgain = false; this.tfT = null; this.tfKey = undefined; this.tfWho = ""; this.tfTimer = null; this.tfPending = false; this.tfLastAt = 0; this.tfText = null; this.tfLive = null; this.tfOwed = false; this.tfUrgent = false; this.tfGen = 0; this.tfBusyAt = 0; this.tfBusyKind = "full"; this.tfStage = ""; this.tfAbandons = 0; this.tfAbandonRun = 0; this.tfLastAbandon = null; this.tfNotePrev = null; this.tfNoteAt = 0;   // tfBusyKind = 진행 중 스캔의 종류("light" | "full") · tfStage = 진행 중 스캔이 지금 기다리는 단계(read · scan · resolve · search · merge) · tfAbandons = 이번 삶에 버린 횟수 · tfAbandonRun = 연속으로 버린 횟수(끝난 스캔이 0 으로) · tfLastAbandon = 마지막으로 버린 스캔의 {stage, kind, age(초)} · tfGen = 스캔 세대(낡은 스캔은 아무것도 안 쓴다) · tfBusyAt = 진행 중 스캔의 시작 시각 · tfNotePrev · tfNoteAt = 마지막으로 쓴 진단 기록(at 뺀 객체)과 쓴 시각 · tfLive = 직전 틱의 {addr, status}(panes() 실시간) · tfOwed = working 이 끝났는데 아직 안 본 마지막 출력(빚) · tfUrgent = ⟳ 또는 터미널·폴더 바뀜으로 줄 선 전체 훑기(감시가 늘어난 기다림 대신 TF_STUCK_MS 를 쓴다)
    // 터미널 더블클릭 → 미리보기: 상태는 this.dc* (tf* 와 따로 · 새 선택이 서면 앞 작업을 밀어낸다 · dcGen = 낡은 작업은 아무것도 안 한다 · dcOpened = 터미널마다 방금 연 파일 Map(addr → path) — 선택이 풀리거나 터미널이 사라질 때까지 같은 파일을 다시 안 연다 · dcSeen = 앞 틱 terminals() 의 주소→선택 key Map(포커스 없는 창 더블클릭 감지용 · 매 틱 갱신))
    this.dcSt = null; this.dcGen = 0; this.dcOpened = new Map(); this.dcSeen = null;
    cx.timer.every(300, cx => this.inbox(cx));
  }

  // 틱마다 key(주소|머신|폴더|상태)만 비교한다(입출력 없음). 바뀌면 800 ms 뒤 한 번 스캔 — 그 사이 또 바뀌면 다시 800 ms. 처음(패널 열림)은 바로.
  tfTick(cx) {
    const t = termTarget(this.tfT);
    this.tfT = t;
    // 멎음 감시: 기다림(보통 stuckAfter(연속 버림 수) · ⟳ 나 터미널·폴더 바뀜으로 전체 훑기가 줄 섰으면(tfUrgent) 고정 TF_STUCK_MS) 넘게 안 끝난 스캔이 있으면 다시 요청한다 — tfScan 의 관문이 앞 스캔을 버린다(틱당 한 번). 가벼운 스캔은 가볍게(일하는 중 원격 find 없음) — 단 전체 스캔 요청이 줄 서 있거나(tfAgain) ⟳ · 터미널/폴더 바뀜이 대기 중(tfUrgent)이면 전체로 — 가볍게 다시 시작하면 tfUrgent 가 꺼져 줄 선 전체 스캔이 늘어난 기다림으로 밀린다.
    // [주의] 연속으로 버릴수록 간격이 늘어난다(30 s → 480 s) — 버린 exec 는 못 끊어 멎은 머신에 쌓이므로. 상태(working ↔ idle)만 바뀐 것은 tfUrgent 를 켜지 않아 늘어난 기다림을 그대로 따른다.
    if (this.tfBusy && Date.now() - this.tfBusyAt >= this.tfStuckMs()) this.tfScan(cx, this.tfBusyKind === "light" && !this.tfAgain && !this.tfUrgent);
    const key = termKey(t);
    // [주의] t.status 는 이 패널이 눌려 있는 동안 낡는다(termTarget 이 앞 값을 그대로 둠) → 상태 판단은 panes() 의 실시간 값으로만 한다. key · tfT 에는 넣지 않는다(상태 뒤집힘이 전체 스캔으로 줄을 바꾸지 않게).
    const live = t ? panes().find(p => p.terminal === t.addr)?.status ?? null : null;
    // 같은 터미널에서 working 이 끝났으면 빚: 이 패널이 눌려 있으면 key 가 안 바뀌고 10 s 폴링도 working 이 아니라 멈춰, 마지막 출력을 놓친다 → 한 번 더 가볍게 본다.
    if (t && endedWorking(this.tfLive, { addr: t.addr, status: live })) this.tfOwed = true;
    this.tfLive = t ? { addr: t.addr, status: live } : null;
    if (key === this.tfKey) {
      // 에이전트는 몇 시간씩 working 이라 key 가 안 바뀐다 → 10 s 마다 가볍게 다시 본다(직접 풀기만 · find 는 절대 안 돈다). 빚이 있으면 주기를 건너뛰고 바로(진행 중이면 다음 틱에 다시).
      if (t && !this.tfBusy && !this.tfPending && (this.tfOwed || (Date.now() - this.tfLastAt >= TF_POLL_MS && live === "working"))) this.tfScan(cx, true);
      return;
    }
    const first = this.tfKey === undefined, who = t ? `${t.addr}|${t.on}|${t.cwd}` : "";
    if (who !== this.tfWho) { this.tfUrgent = true; this.tfSet([], cx); }       // 다른 터미널·폴더의 목록을 새 스캔 전까지 보이지 않는다(상태만 바뀐 경우는 그대로 둔다)
    this.tfWho = who; this.tfKey = key;
    this.tfSchedule(cx, first ? 0 : TF_DEBOUNCE);
  }

  // 멎음으로 보는 기다림: ⟳ · 터미널/폴더 바뀜으로 줄 선 전체 훑기(tfUrgent)는 고정 30 s, 그 밖(감시 · 상태만 바뀜)은 연속 버림에 따라 늘어난 기다림. 관문(tfScan)과 감시(tfTick)가 같이 쓴다.
  tfStuckMs() { return this.tfUrgent ? TF_STUCK_MS : stuckAfter(this.tfAbandonRun); }

  tfSchedule(cx, ms) {
    try { this.tfTimer?.cancel(); } catch { /* 이미 끝남 */ }
    this.tfPending = true;
    this.tfTimer = cx.timer.after(ms, cx => { this.tfPending = false; this.tfScan(cx); });
  }

  tfSet(list, cx) {
    if (this.tfList.length === list.length && this.tfList.every((p, i) => p === list[i])) return;
    this.tfList = list; cx.notify();
  }

  // 스캔: 터미널 글자(hc read) → 후보 → 그 머신에서 진짜 있는 파일(sh). 한 번에 하나(진행 중이면 끝난 뒤 한 번 더). 시작한 key 가 그대로일 때만 반영한다.
  // 전체 스캔 실패(hc 오류 · sh 오류 · 시간 초과)는 줄을 비우고 조용히 — 다음 스캔에서 다시. 결과는 tfNote 로 shared 에 한 줄 남긴다(진단용).
  // light(10 s 틱 · working 중): 글이 앞 스캔과 같으면 아무것도 안 한다 · 다르면 직접 풀기만(find 없음) · 앞 목록 뒤에 잇는다 · 실패해도 목록을 그대로 둔다.
  // 멎음 감시: 관문(여기)과 감시(틱)가 tfStuckMs() 를 같이 쓴다 — ⟳ · 터미널/폴더 바뀜(tfUrgent)은 TF_STUCK_MS(30 s), 상태만 바뀜 · 감시는 stuckAfter(30 s 부터 두 배씩, 480 s 상한). 그 기다림을 넘게 안 끝난 스캔은 버리고(abandon) 새로 시작한다 — 호스트가 끊은 task 의 약속은 영영 안 끝나 tfBusy 가 영영 true 일 수 있다.
  // 버려진 스캔(gen 이 낡음)은 await 뒤마다 빠져나가 아무것도 쓰지 않는다(tfBusy · tfAgain · tfText · 목록 · 기록 · 뒤따르는 스캔 모두).
  // [주의] 버린 exec 는 못 끊는다 — 원격에서는 제 시간 초과(10 s)까지 find 가 계속 돈다. ⟳ 연타는 «어린 스캔 → 한 번만 대기 · 멎은 스캔 → 버리고 새로» 로 막는다.
  tfScan(cx, light = false) {
    if (this.closed) return;
    const now = Date.now(), kind = light ? "light" : "full";
    const gate = scanGate({ busy: this.tfBusy, busyAt: this.tfBusyAt, now, light, stuckMs: this.tfStuckMs() });
    if (gate === "skip") return;
    if (gate === "again") { this.tfAgain = true; return; }
    if (gate === "abandon") {
      // 버리는 스캔이 어느 단계에서 얼마나 멎었는지 남긴다(새 스캔을 시작하기 전에). 기록의 kind 는 버려지는 스캔의 것.
      this.tfAgain = false; this.tfAbandons++; this.tfAbandonRun++;
      this.tfLastAbandon = { stage: this.tfStage, kind: this.tfBusyKind, age: Math.round((now - this.tfBusyAt) / 1000) };
      this.tfNote({ phase: "abandoned", kind: this.tfBusyKind, cands: 0, found: 0 });
    }
    const gen = ++this.tfGen;                 // 앞 스캔이 있었다면 이 순간부터 낡은 것
    this.tfUrgent = false;                    // 스캔이 실제로 시작됐다 → 줄 선 «전체 훑기» 요청은 해소
    this.tfOwed = false;                      // 스캔이 실제로 시작될 때만 빚을 지운다(전체 스캔도 빚을 덮는다)
    const t = this.tfT, key = termKey(t);     // 이 스캔이 실제로 읽는 대상의 key(틱이 tfKey 를 갱신하기 전에 감시가 불러도 어긋나지 않게)
    if (!t?.cwd) { this.tfBusy = false; this.tfAbandonRun = 0; this.tfLastAt = now; this.tfSet([], cx); this.tfNote({ phase: "no-cwd", kind, cands: 0, found: 0 }); return; }
    this.tfBusy = true; this.tfBusyAt = now; this.tfBusyKind = kind;
    this.tfStage = "spawn";                   // spawn 본문이 안 돌아도 lastAbandon.stage 가 앞 스캔의 단계를 물려받지 않게
    cx.spawn(async cx => {
      let list = [], keep = false, newText, phase = "ok", cands = 0, code, err, search, stage = "read";
      // 단계 표시: 이 스캔이 아직 현재일 때만 this.tfStage 에 비춘다(버려진 스캔이 새 스캔의 단계를 덮지 않게).
      const at = (s) => { stage = s; if (gen === this.tfGen) this.tfStage = s; };
      try {
        at("read");
        const t0 = Date.now();
        const r = await hcLimited(cx, ["read", t.addr, "--lines", String(TF_LINES), "--json"]);
        if (gen !== this.tfGen) return;
        if (!r || r.code !== 0) { phase = "read-failed"; code = r?.code; if (!r) err = Date.now() - t0 >= TF_READ_MS ? "timeout" : "failed"; throw new Error("hc read"); }
        let text;
        try { text = JSON.parse(r.stdout)?.text; } catch { phase = "read-failed"; err = "parse"; throw new Error("parse"); }
        if (typeof text !== "string") { phase = "no-text"; throw new Error("no text"); }
        // [주의] 글자(UTF-16) 수로 자른다 — 바이트로는 최대 ~192 KiB. 터미널 글자는 믿을 수 없는 입력(이름은 위치 인자로만 sh 에 넘긴다).
        if (text.length > TF_TEXT) text = text.slice(-TF_TEXT);
        if (light && text === this.tfText) { keep = true; phase = "same-text"; }
        else {
          const root = t.cwd;
          at("scan");
          const sc = scanText(text), guesses = sc.guesses;
          cands = sc.cands.length;
          if (cands) {
            phase = "resolve-failed";
            at("resolve");
            const e = await exec("sh", ["-c", RESOLVE_SCRIPT, NAME, root, ...sc.cands], { on: t.on, timeout: 10000 });
            if (gen !== this.tfGen) return;
            if (e.code !== 0) { code = e.code; throw new Error("resolve"); }
            phase = "ok";
            at("merge");
            list = mergeResolved(e.stdout, null, { max: TF_MAX });
            // 2단계(전체 스캔만): 직접 못 푼 상대 이름만 find 한 번. 줄 잇기 추측(guesses)은 넘기지 않는다. 실패 · 시간 초과면 1단계 결과만 쓴다.
            const names = light ? [] : unresolved(e.stdout, { skip: guesses });
            if (names.length) {
              try {
                at("search");
                const f = await exec("sh", ["-c", SEARCH_SCRIPT, NAME, root, ...names], { on: t.on, timeout: 10000 });
                if (gen !== this.tfGen) return;
                at("merge");
                if (f.code === 0) list = mergeResolved(e.stdout, f.stdout, { max: TF_MAX });
                else search = "failed";
              } catch { search = "failed"; /* 1단계 결과 유지 */ }
              if (gen !== this.tfGen) return;
            }
          }
          at("merge");
          if (light) list = mergeLight(list, this.tfList, TF_MAX);
          newText = text;
        }
      } catch (e) {
        if (gen !== this.tfGen) return;
        // 단계로 갈음: 읽기 · 풀기에서 던졌으면 그 이름, 그 밖(scanText · merge* 가 던짐)은 parse-failed. 위에서 정한 phase 는 그대로 둔다.
        if (phase === "ok") phase = { read: "read-failed", resolve: "resolve-failed" }[stage] ?? "parse-failed";
        err ??= errClass(e);
        if (light) keep = true; else { list = []; newText = null; }
      }
      if (gen !== this.tfGen) return;
      if (newText !== undefined) this.tfText = newText;
      this.tfBusy = false; this.tfAbandonRun = 0; this.tfLastAt = Date.now();
      if (!keep && !this.closed && this.tfKey === key) this.tfSet(list, cx);
      const note = { phase, kind, cands, found: list.length, shown: this.tfList.length };   // shown = 줄이 실제로 보여 주는 수(tfSet 뒤)
      if (code !== undefined) note.code = code;
      if (err) note.err = err;
      if (search) note.search = search;
      // [주의] ok 직후의 same-text 는 새로 본 게 없다 — 분류만 번갈아 바뀌어 매번 쓰는 걸 막는다(앞 기록이 ok 가 아니면 그대로 남긴다).
      if (!(phase === "same-text" && this.tfNotePrev?.phase === "ok")) this.tfNote(note);
      if (this.tfAgain && !this.closed) { this.tfAgain = false; this.tfScan(cx); }
    });
  }

  // 마지막 훑기 결과를 shared 에 한 줄 남긴다(진단용 · 패널만 쓴다). 쓸지는 noteWrite — 분류가 바뀌면 바로, 개수(cands · found · shown)만 바뀌면 OWNER_BEAT_MS 이상 지났을 때만. 닫혔거나 낡은 삶이면 안 쓴다. 실패해도 조용히.
  // 한 번이라도 버렸으면 모든 기록에 abandons · lastAbandon 을 합친다.
  // [경고] 이름 · 폴더 · 터미널 글자는 넣지 않는다 — 숫자와 짧은 분류만.
  tfNote(obj) {
    try {
      if (this.closed || !this.lifeOk()) return;
      const next = this.tfAbandons ? { ...obj, abandons: this.tfAbandons, lastAbandon: this.tfLastAbandon } : obj;
      const now = Date.now();
      if (!noteWrite(this.tfNotePrev, next, now, this.tfNoteAt, OWNER_BEAT_MS)) return;
      setShared(KEY.tf(this.owner), { at: now, ...next });
      this.tfNotePrev = next; this.tfNoteAt = now;
    } catch { /* 기록이 훑기를 막지 않게 */ }
  }

  // 줄 클릭 → 미리보기(openPreview 와 같은 꼴 · 그 파일 하나). 터미널 출력만으로는 저절로 열지 않는다 — 사용자 동작(줄 클릭 · 터미널에서 낱말을 더블클릭해 고른 선택 → dcTick)만 연다.
  // on = 그 파일이 있는 머신(줄 클릭은 눌린 터미널의 머신 · 더블클릭은 그 터미널을 고른 때의 머신).
  openTermFile(abs, on = this.tfT?.on ?? null) {
    const i = abs.lastIndexOf("/"), name = abs.slice(i + 1), root = i > 0 ? abs.slice(0, i) : "/";
    if (!safeName(name)) return;
    this.previewDir = null;
    this.previewId = openPreviewWindow({ mode: "preview", owner: this.owner, root, on, space: this.context?.space, dir: "", files: [name], index: 0, mac: this.mac, viewer: this.viewer }, false);
  }

  // 터미널에서 낱말을 더블클릭(= 마우스 선택) → 그 낱말이 터미널에 나온 파일 이름이면 미리보기. macOS 전용(클립보드 = pbpaste).
  // 평소 틱은 입출력이 없다(terminals · focused · panes 만 · spaces 는 fire 때) — 선택이 400 ms 머물러 «새 선택» 이 될 때만 작업을 하나 띄운다.
  // 클립보드 글은 터미널 글자에서 찾은 후보 중 하나를 «고르는 데만» 쓴다(dcPick). 클립보드에서만 온 글은 exec 로 가지 않는다 — exec 에는 상수 스크립트 · 터미널 쪽 후보(cand) · dcLonger 가 터미널 글자에서 자른 «더 긴 이름» 탐침만 간다.
  // 선택 칸을 글 위치로 묶는다(dcBind · 팬 터미널만 · 안 묶이면 옛 규칙 그대로).
  dcTick(cx) {
    if (!this.mac || this.closed) return;
    const ts = terminals();
    const prevSeen = this.dcSeen;
    this.dcSeen = new Map(ts.map(t => [t.address, selKey(t.selection ?? null)]));   // 이른 return 앞에서 갱신 — 패널·terminal.show 가 포커스여도 기억이 낡지 않게
    for (const a of [...this.dcOpened.keys()]) if (this.dcSeen.get(a) == null) this.dcOpened.delete(a);   // 선택이 풀렸거나(null) 터미널이 사라졌다 → 같은 파일을 다시 열 수 있다(포커스 여부 무관)
    const f = focused();
    if (!f?.terminal) return;                                   // 터미널이 아님 · 상태는 그대로 둔다
    const all = panes();
    const own = f.pane ? all.find(p => p.pane === f.pane) : null;
    if (own?.mod === NAME) return;                              // 이 패널이 눌림 · 상태는 그대로 둔다
    if (f.shown && f.shown !== f.terminal) return;              // 선택은 보이는 쪽(terminal.show) 터미널 것 — 그 cwd 는 검증 못 한다 → 열지 않는다 · 상태는 그대로
    const addr = f.terminal, sel = f.selection ?? null, now = Date.now();
    const cols = ts.find(t => t.address === addr)?.cols;
    const rows = ts.find(t => t.address === addr)?.rows;
    const r = dcStep(this.dcSt, { addr, sel, cols, now, prevKey: prevSeen?.get(addr) });
    this.dcSt = r.state;
    if (!r.fire) return;
    const space = spaces().find(s => s.active);
    const on = terminalMachine(f, space, addr);
    const cwd = all.find(p => p.terminal === addr)?.cwd || f.cwd || null;
    const span = selSpan(sel, cols);
    if (span === null || span > 1024 || !cwd) return;           // 칸 수를 모르거나 너무 길면 클립보드도 읽지 않는다
    const gen = ++this.dcGen;                                   // 새 선택이 앞 작업을 밀어낸다 — 앞 작업은 이 순간부터 낡은 것
    cx.spawn(async cx => {
      try {
        // [경고] 클립보드(믿을 수 없는 입력 · 비밀번호일 수 있음)는 저장 · 기록 · 진단 · exec 인자로 쓰지 않는다. dcClipShape(모양 참/거짓만) · dcBind(선택 ↔ 글 위치 자체 검사) · dcPick 이 터미널 글자의 후보 중 하나를 고르는 데만 쓴다(dcLonger 는 clip 으로 꼬리를 확인할 뿐 탐침은 터미널 글자 + cand 로만 만든다).
        const c = await exec("/bin/sh", ["-c", "LC_ALL=en_US.UTF-8 /usr/bin/pbpaste | /usr/bin/head -c 4097"], { timeout: 2000 });
        if (gen !== this.dcGen) return;
        const clip = c?.code === 0 ? c.stdout : null;
        if (typeof clip !== "string" || clip.length > 4096) return;
        if (!dcClipShape({ clip, sel, cols })) return;   // 깊게 읽기 전 싼 검사 — 클립보드 모양이 안 맞으면 읽지 않는다(참/거짓만)
        // 묶기(dcBind): 선택 행까지 깊게 읽는다(맨 아래서 DC_READ_MAX 행 안이면). total 은 읽기 앞 · 뒤가 같을 때만 쓴다(읽는 사이 줄이 밀렸으면 모름).
        // cx.sleep 이 없으면 쉴 수 없다 → 옛 300 줄 길 그대로(깊게 읽기 · 묶기 · 쉼 없음).
        const canSleep = typeof cx.sleep === "function";
        const tb = dcTotal(addr);
        let n = TF_LINES;
        if (canSleep && tb !== null) { const dist = tb - Math.min(sel.start.row, sel.end.row); if (dist <= DC_READ_MAX) n = Math.min(DC_READ_MAX, Math.max(TF_LINES, dist + 2)); }
        const r = await hcLimited(cx, ["read", addr, "--lines", String(n), "--json"]);
        if (gen !== this.dcGen) return;
        if (!r || r.code !== 0) return;
        const rd = JSON.parse(r.stdout);
        let full = rd?.text;
        if (typeof full !== "string") return;
        const total = tb !== null && tb === dcTotal(addr) ? tb : null;
        // 읽기 방식(how)이 "history" 일 때만 묶는다 — stitched(화면과 기록을 이어 붙인 읽기) · 모르는 값은 줄 ↔ 행 대응을 믿지 않는다 → 묶지 않는다. 쉴 수 없으면(canSleep) 묶지도 않는다.
        const binds = canSleep && total !== null && rd?.how === "history";
        // [주의] 글자(UTF-16) 수로 자른다(앞을 버림 → cut). 4 MiB 를 넘는 읽기는 자른 뒤에도 dcBind 의 DC_BIND_MAX 를 넘어 묶이지 않는다(옛 길). 터미널 글자는 믿을 수 없는 입력(이름은 위치 인자로만 sh 에 넘긴다).
        const cut = full.length > DC_TEXT_MAX || (binds && full.length <= DC_BIND_MAX && dcReadCut(full, n));   // 줄 수 제한(--lines n)에 걸린 읽기도 앞이 잘렸을 수 있다 → 아래 붙임만(반드시 slice 앞의 원래 글로 센다). dcReadCut 은 묶을 때만 · DC_BIND_MAX 를 넘는 글은 dcBind 가 어차피 null 이라 줄 수를 세지 않는다
        if (cut) full = full.slice(-DC_TEXT_MAX);
        // [주의] Herdr 는 한 번에 약 0.5 초 넘게 도는 JS 조각을 소리 없이 끊는다(VM 실측 450–600 ms · 모드는 산다) → 읽기·파싱 / 묶기 / 옛 길을 다른 조각으로 나눈다: 묶기 앞 · 묶기 뒤에서 쉬고, 묶지 않아도 깊게 읽었으면(n !== TF_LINES) 옛 길 앞에서 쉰다. 300 줄 읽기를 묶지 않는 길은 032f193 과 같다(쉼 없음). 쉬는 사이 새 선택이 서면 버린다(gen). 앞에서 잡은 sel · cols · rows · addr · cwd · full 은 값이라 낡지 않는다.
        if (binds) { await cx.sleep(0); if (gen !== this.dcGen) return; }
        const bd = binds ? dcBind({ sel, cols, rows, text: full, clip, total, cut }) : null;
        if (binds || n !== TF_LINES) { await cx.sleep(0); if (gen !== this.dcGen) return; }   // n !== TF_LINES 면 canSleep 이다
        // 묶이지 않는 길의 글: 깊게 안 읽었으면(n === TF_LINES) 읽은 그대로 끝 TF_TEXT 글자(032f193 과 같다) · 깊게 읽었으면 «마지막 TF_LINES + rows 줄» → 끝 TF_TEXT 글자. 끝 빈 행이 잘려 화면 줄이 적으면(예: Ctrl+L 뒤) 032f193 보다 최대 rows 줄 더 오래된 줄까지 본다(바뀐 동작 · 연 것은 선택한 이름).
        const oldText = dcOldText(full, n === TF_LINES ? null : TF_LINES + (Number.isInteger(rows) && rows > 0 ? rows : 0), TF_TEXT);
        const cand = dcPick({ clip, sel, cols, text: oldText, bd });
        if (cand === null) return;
        // «더 긴 이름»(cand + 붙은 꼬리 · 줄바꿈 뒤 이어진 조각 · 폴더 접두)도 같은 exec 로 확인한다 — 있으면 dcChoose 가 아무것도 열지 않는다. 탐침은 터미널 글자 + cand 로만 만든다(clip 은 안 간다).
        const longer = dcLonger({ clip, sel, text: oldText, cand, bd });
        const e = await exec("sh", ["-c", RESOLVE_SCRIPT, NAME, cwd, cand, ...longer], { on, timeout: 10000 });
        if (gen !== this.dcGen) return;
        if (e.code !== 0) return;
        const path = dcChoose(e.stdout, cand, longer);   // 정확히 하나일 때만 연다(찾기 단계 없음) · 더 긴 이름 파일이 있으면 null
        if (path === null) return;
        if (this.dcOpened.get(addr) === path) return;   // 방금 연 파일 — 선택이 풀릴 때까지 다시 안 연다(줄이 밀려 같은 선택이 새 선택처럼 보여도)
        if (Date.now() - now > DC_OPEN_MAX_MS) return;       // 선택한 지 너무 오래 — 늦게 뜬 미리보기가 키보드를 가져가지 않게
        const g = focused();
        if (g?.terminal !== addr || selKey(g?.selection ?? null) !== selKey(sel) || this.closed || !this.lifeOk()) return;   // 그 선택이 아직 현재 선택일 때만
        this.dcOpened.set(addr, path);
        this.openTermFile(path, on);
      } catch { /* 조용히 */ }
    });
  }

  // 머리줄 아래 칸: 터미널 대상이 있을 때(결과 0 이면 줄 없이 «· 0» 머리 + 새로고침만). 머리(접기 ▾/▸ · 개수 · 새로고침) + 줄(file 아이콘 · 이름 · 흐린 부모 폴더 이름).
  termStrip(t) {
    const list = this.tfList;
    return v_flex().id("tf-strip").flex_none().border_b(1).border_color(t.border)
      .child(h_flex().id("tf-head").h(30).px(10).gap(6).items_center()
        .child(h_flex().id("tf-toggle").h(24).flex_1().min_w(0).gap(6).items_center().rounded(6).px(4).cursor_pointer().hover(s => s.bg(t.hover))
          .on_click((_e, cx) => { this.tfCollapsed = !this.tfCollapsed; cx.notify(); })
          .child(svg(icon(`chevron-${this.tfCollapsed || list.length === 0 ? "right" : "down"}`)).size(12).flex_none().text_color(t.dim))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(`터미널에 나온 파일 · ${list.length}`)))
        .child(h_flex().id("tf-refresh").w(24).h(24).flex_none().items_center().justify_center().rounded(6).cursor_pointer()
          .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).tooltip("다시 찾기")
          .on_click((_e, cx) => { this.tfUrgent = true; this.tfScan(cx); }).child(svg(icon("history")).size(14).flex_none())))
      .when(!this.tfCollapsed && list.length > 0, el => el.child(v_flex().id("tf-list").max_h(TF_ROWS * 28 + 8).overflow_y_scrollbar().px(6).pb(6).children(list.map((abs, i) => {
        const parts = abs.split("/"), name = parts.pop(), dir = parts.pop() ?? "";
        return h_flex().id(`tf-row-${i}`).h(28).flex_none().px(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
          .on_click(() => this.openTermFile(abs))
          .child(svg(icon("file")).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().min_w(0).truncate().child(name))
          .when(Boolean(dir), el => el.child(div().max_w(110).flex_none().truncate().text_size(11).text_color(t.dim).child(dir)));
      }))));
  }

  // 등록부에 내 owner 와 지금 시각을 적는다(15 s 마다). 닫혔거나 낡은 삶이면 쓰지 않는다.
  beat() {
    if (this.closed || !this.lifeOk()) return;
    try { setShared(OWNERS_KEY, registerOwner(readShared(shared, OWNERS_KEY), this.owner, Date.now())); } catch { /* 다음 박자에 */ }
  }

  // 죽은 주인(등록부에 있고 · 이 프로세스에 없고 · 60 s 넘게 갱신 없음)의 흔적을 내 이전 삶과 똑같이 치운다: 끝나지 못한 작업 → 기록(jid 중복 제외) · 조각 → rm · 키 → null · 등록부에서 뺀다.
  // 산 주인은 건드리지 않는다. 조각은 즉시 + ~10 s · ~60 s 뒤 다시(죽은 copy 의 늦은 `>>` 가 되살릴 수 있다).
  reap(cx) {
    if (this.closed || !this.lifeOk()) return;
    try {
      const now = Date.now(), list = normalizeOwners(readShared(shared, OWNERS_KEY));
      const names = new Set(list.map(e => e.owner));
      for (const e of list) if (!this.ownerSeen.has(e.owner)) this.ownerSeen.set(e.owner, now);
      for (const k of [...this.ownerSeen.keys()]) if (!names.has(k)) this.ownerSeen.delete(k);
      const dead = deadOwners(list, { mine: this.owner, live: LIVE, now, firstSeen: this.ownerSeen });
      if (!dead.length) return;
      const seen = seenJids(readShared(shared, KEY.history));
      const sweepParts = [];
      for (const o of dead) {
        const plan = ownerCleanupPlan({ owner: o, snap: readShared(shared, KEY.jobs(o)), partsList: readShared(shared, partsKey(o)), seen, now });
        for (const g of plan.groups) this.record(g);
        for (const t of plan.parts) { this.rmPart(t.path, t.on); sweepParts.push(t); }
        for (const key of plan.keys) { try { if (readShared(shared, key, 1) != null) setShared(key, null); } catch { /* 키 하나 실패가 나머지를 막지 않게 */ } }
      }
      setShared(OWNERS_KEY, dropOwners(readShared(shared, OWNERS_KEY), dead));
      if (sweepParts.length) for (const ms of [10000, 60000]) cx.timer.after(ms, () => { if (!this.closed && this.lifeOk()) for (const t of sweepParts) if (!this.jobs.some(j => j.part === t.path)) this.rmPart(t.path, t.on); });
    } catch { /* 정리 실패가 패널을 막지 않게 — 다음 60 s 에 다시 */ }
  }

  // 이 삶이 아직 현재인가(저장소의 삶 토큰이 내 것) — 아니면 shared 에 쓰지 않는다.
  lifeOk() { return lifeCurrent(typeof localStorage === "undefined" ? null : localStorage, this.owner, this.life, this.lifeGated !== false); }

  get mac() { return window()?.platform === "macos"; }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) { return this.context === context && JSON.stringify(location(this.loc)) === context.key; }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  // force = 파일 작업 직후: 읽는 중이어도 끝난 뒤 한 번 더 읽는다(그 사이 바뀐 것을 놓치지 않게).
  refresh(cx, force = false) {
    this.loc = location(this.loc);
    const { cwd, on } = this.loc, next = JSON.stringify(this.loc);
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on, space: this.loc.space }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.watched = null; this.error = null; this.limited = false;
      this.loading = false; this.again = false;
    }
    if (!cwd) return;
    if (this.loading) { if (force) this.again = true; return; }
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally {
        if (this.context === context) this.loading = false;
        cx.notify();
        if (this.context === context && this.again) { this.again = false; this.refresh(cx); }
      }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) { this.folders.delete(folder); this.entries.delete(folder); }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  // 파일 줄 클릭 → 미리보기 팝업. 그 폴더의 파일만(트리와 같은 정렬) · 누른 것의 index.
  openPreview(path) {
    const dir = parent(path), name = path.split("/").pop();
    if (!safeName(name)) return;
    const all = (this.entries.get(dir) ?? []).filter(e => !e.dir && safeName(e.name)).map(e => e.name);
    // 누른 파일이 목록에 없으면(그 사이 사라짐) 다른 파일을 열지 않고 그것 하나만 넘긴다.
    const found = all.indexOf(name);
    const files = found < 0 ? [name] : all, index = found < 0 ? 0 : found;
    // window: 어둡게 하지 않아 옆(전송 창 등)을 누를 수 있고, 안 닫힌다 — 닫기는 Esc · ✕ · 머리줄을 끌어 옮긴다. 주인당 하나: 같은 key 라 다른 파일을 열면 열린 창을 그 자리에서 바꾼다.
    // 열 때마다 가운데에서(자리를 기억하지 않는다) · 옛 창은 openPreviewWindow 가 먼저 닫는다(shared 의 previewKey 에 적힌 id — 크게 보기가 바꾼 것도 포함).
    this.previewDir = dir;
    this.previewId = openPreviewWindow({ mode: "preview", owner: this.owner, root: this.root, on: this.on, space: this.context?.space, dir, files, index, mac: this.mac, viewer: this.viewer }, false);
  }

  // 전송 창: 같은 key 면 열린 것을 그 자리에서 바꾼다. at 은 처음 한 번만 뜻이 있다. history = 기록 보기 상태를 잇는다.
  openJobs(expanded = true, history = false) {
    this.winAt = Date.now();
    openOverlay({ mod: NAME, kind: "window", frame: "none", key: winKey(this.owner), width: JOBS_W, height: expanded ? JOBS_H_OPEN : JOBS_H_BAR,
      at: { x: 640, y: 46 }, props: { mode: "jobs", owner: this.owner, expanded, history } });
  }

  // ── 전송 큐(패널만 돌린다) ───────────────────────────────────────────
  // 즉시 게시(사용자 동작): 앞서 걸린 늦춤 게시만 버린다 — 늦춤 창은 그대로라 끝 상태·verify 가 쓰기를 늘리지 않는다.
  // 닫힌 뒤에는 쓰지 않는다(치운 키가 되살아나지 않게).
  publishNow() {
    if (this.closed || !this.lifeOk()) return;
    this.publish?.dropPending();
    setShared(KEY.jobs(this.owner), snapshot(this.owner, this.on, this.jobs, Date.now(), { life: this.life, activeCap: ACTIVE_CAP, keep: KEEP_JOBS }));
  }

  // 전송 창 열기. 열림은 창이 shared 에 적는 깃발로 안다(폴링 없음).
  //  · 새 작업(chip=false): 깃발이 있으면 — 접혀 있어도 — 아무것도 안 한다(기록·접힘 상태 유지). 깃발이 없고 방금(1.5초) 연 게 아닐 때만 펼쳐 연다.
  //  · 칩 클릭(chip=true): 사용자의 명시 동작 → 깃발이 있으면 같은 key 로 펼친 채 그 자리에서 바꾼다(중복 창 없음 · 1.5초 안이어도). 깃발이 없고 방금 연 게 아니면 연다.
  ensureJobs(chip = false) {
    const w = readShared(shared, KEY.win(this.owner));
    if (w) { if (chip) this.openJobs(true, w.history === true); return; }
    if (this.winAt && Date.now() - this.winAt < 1500) return;
    this.openJobs(true);
  }

  // 작업 하나를 끝 상태로 바꾼다(한 번만). 게시·기록은 부르는 쪽 몫 — 돌려주는 값 = 기록할 항목 또는 null.
  settle(job, state, note) {
    if (job.ended) return null;
    job.ended = true; job.state = state; job.note = note ?? ""; job.speed = null; job.eta = null;
    if (job.groupHead && state !== "ok") { job.group.dead = true; if (state === "cancel") job.group.headCancelled = true; }   // 폴더 만들기가 성공 아닌 모든 끝 → 그 그룹의 파일은 더 올리지 않는다(취소면 파일도 취소로 맺는다)
    if (state === "ok" && job.total) job.done = job.total;
    if (job.noHistory) return null;
    return { at: Date.now(), jid: `${this.life}:${job.id}`, dir: job.dir, name: job.name, size: job.total || null, state, where: job.where, on: job.on, note: job.note };
  }

  // 기록은 모아서 쓴다(늦춤 1 s): 한 번의 동작이 낳은 묶음(entries)은 따로 두었다가 쓸 때 각각 pushHistoryGroup 으로 앞에 붙인다.
  record(entries) {
    if (!entries.replaceGroup && !entries.length) return;
    this.histBuf.push(entries);
    this.histPub();
  }

  writeHistory() {
    // 아직 안 쓴 그룹 항목(dirty)은 이 틱에서 그룹 줄을 갈아 끼운다 — 크래시로 잃는 양을 한 틱(≈1 s) 몫으로 줄인다. 줄 수는 그대로(replaceGroupLines).
    for (const g of this.groups) if (g.dirty) this.histBuf.push(this.groupBatch(g));
    const batches = this.histBuf;
    this.histBuf = [];
    if (!batches.length || !this.lifeOk()) return;
    let list = readShared(shared, KEY.history);
    list = Array.isArray(list) ? list : [];
    for (const b of batches) list = b.replaceGroup ? replaceGroupLines(list, b.replaceGroup, b.byState) : pushHistoryGroup(list, b);
    setShared(KEY.history, list);
  }

  // 끝난 작업: 상태 · 게시 · 기록 — 늦춤 경로로. 남은 작업이 없으면(= 마지막 상태) 바로 비워 올린다.
  finish(job, state, note) {
    if (job.ended) return;
    const entry = this.settle(job, state, note);
    this.publish();
    this.collect(job, entry);
    if (!this.jobs.some(j => ACTIVE.has(j.state))) { this.publish.flush(); this.histPub.flush(); }
  }

  // 끝 기록 한 건: 폴더 그룹의 작업이면 모아 두었다가(g.byState) 그룹 줄을 «갈아 끼워» 쓴다 · 아니면 바로.
  collect(job, entry) {
    const g = job.group;
    if (!g) { if (entry) this.record([entry]); return; }
    if (g.flushed) { if (entry) this.record([entry]); return; }
    g.ended += 1;
    if (entry) { g.byState[entry.state]?.push({ ...entry, grp: g.id }); g.fresh += 1; g.dirty = true; this.histPub(); }
    if (g.ended >= g.total) this.flushGroup(g);
    else if (g.fresh >= GROUP_FLUSH) this.flushEntries(g);   // 상한 200건: dirty 틱 쓰기(writeHistory)와 별개의 상한 보장
  }

  // 그룹이 지금까지 모은 모든 항목으로 그 그룹의 기록 줄을 통째로 갈아 끼운다(상태별 ≤ 5줄). 상태마다 작업 id 큰 쪽(최신)이 앞 —
  // 스냅샷(최신 작업 먼저)과 «외 N개» 에 접히는 jid 가 맞아야 다시 불러온 뒤 중복 기록이 없다. 끝난 순서가 아니라 id 순이다
  // («모두 취소» 는 대기 작업을 id 내림차순으로 맺으므로 끝난 순서를 뒤집으면 스냅샷의 최신 30건과 어긋난다).
  groupBatch(g) {
    g.fresh = 0; g.dirty = false;
    const jobNo = e => Number(String(e.jid).split(":").pop()) || 0;
    const byState = {};
    for (const st of ["ok", "fail", "cancel"]) byState[st] = [...g.byState[st]].sort((a, b) => jobNo(b) - jobNo(a));
    return { replaceGroup: g.id, byState };
  }

  flushEntries(g) { this.record(this.groupBatch(g)); }

  flushGroup(g) {
    if (g.flushed) return;
    g.flushed = true; this.groups.delete(g);
    this.flushEntries(g);
  }

  // 닫힐 때 취소되는 작업의 조각 파일 하나만 지운다(그 작업이 쓰던 정확한 경로 · 훑거나 glob 하지 않는다).
  removePart(job) { this.rmPart(job.part, job.partOn ?? null); }

  // 조각 파일 하나를 정확한 경로로만 지운다: 이름이 조각 꼴(.<fnv8>.files-plus-<rand8>.part)이 아니면 아무것도 하지 않는다. 폴더는 지우지 않는다(-r 없음).
  // 이 컴퓨터는 /bin/rm 직접 · 원격은 같은 exec 의 on 으로 — 경로는 늘 위치 인자(`--` 뒤).
  rmPart(path, on) {
    if (!isPartPath(path)) return;
    try { (on ? exec("rm", ["-f", "--", path], { on, timeout: 15000 }) : exec("/bin/rm", ["-f", "--", path], { timeout: 15000 })).catch(() => {}); } catch { /* 종료 중 */ }
  }

  // 여러 작업을 한꺼번에 취소: 모두 바꾼 뒤 게시 한 번 · 기록 한 번(5개 넘으면 한 줄로 묶는다).
  // 줄 서 있던 것은 바로 취소로 맺고, 도는 것은 «취소 중» 표시만(settle=true 면 도는 것도 맺는다 — 패널 닫힘).
  cancelMany(list, note, settle = false) {
    const entries = [];
    for (const j of list) {
      if (j.ended || (j.state !== "wait" && j.state !== "run")) continue;   // verify(되돌릴 수 없음) · 끝난 것은 그대로
      j.cancelled = true;
      if (settle && j.state === "run") this.removePart(j);
      if (j.state === "wait" || settle) { const e = this.settle(j, "cancel", note); if (j.group) this.collect(j, e); else if (e) entries.push(e); }
    }
    this.publishNow();
    this.record(entries);
  }

  // 전송 하나를 목록에 올리고 돌린다. work(job) 는 놓인 경로를 돌려준다. redo(cx) = 같은 일을 다시 거는 함수(실제로 다시 걸었으면 true — 아니면 다시 시도가 줄을 지우지 않는다).
  // on = 이 전송이 실제로 쓰는 머신(인자로 받은 값 · 다시 시도도 같은 값).
  transfer(dir, name, work, cx, after, { redo, noHistory = false, on = null } = {}) {
    this.transferMany([{ dir, name, work, after, redo, noHistory, on }], cx);
    return true;
  }

  // 여러 전송을 한꺼번에 목록에 올리고 돈다. spec = { dir, name, work, after, redo, noHistory, on, group, groupHead }.
  // this.jobs 재구성 · 게시 · 창 열기는 한 번만(파일 수천 개에서 작업마다 하면 O(n²)). 줄(oneAtATime)은 spec 순서를 지킨다.
  transferMany(specs, cx) {
    const mine = specs.map(spec => {
      const job = { id: ++this.seq, dir: spec.dir, name: spec.name, total: 0, done: 0, state: "wait", note: "", speed: null, eta: null, where: "", cancelled: false, ended: false, on: spec.on ?? "", redo: spec.redo, noHistory: spec.noHistory === true, meter: speedometer(), group: spec.group ?? null, groupHead: spec.groupHead === true };
      job.start = n => { job.total = n; };
      // 받은 조각을 해시로 맞추고 자리 잡기 시작할 때(크기 0 이어도): 이제부터는 되돌릴 수 없다 → verify(취소 단추 없음).
      // [경고] 즉시 게시(publishNow)여야 한다 — 늦춤 게시(≤250 ms · 작업 30개 넘으면 1 s)면 그 사이 스냅샷이 «run + part» 로 남아, 제자리 다시 불러오기가 겹치면
      // 새 삶의 orphanParts 가 PLACE 가 해시·이동 중인 조각을 지운다(받은 파일 유실). verify 는 orphanParts 가 건드리지 않는다(= «놓는 중» 깃발). PLACE 는 시작 전에 이미 verify 가 올라가 있다.
      job.placing = () => { if (job.state === "run" && !job.ended) { job.state = "verify"; job.speed = null; job.eta = null; this.publishNow(); } };
      // 조각 경로가 정해지면 즉시 게시(E1): 마지막 늦춤 게시 뒤에 정해지고 해시 계산·긴 받기가 이어지므로, 안 올리면 충돌 뒤 스냅샷에 part 가 없어 정리할 게 없다.
      job.onPart = () => { if (job.state === "run" && !job.ended) this.publishNow(); };
      return { job, spec };
    });
    for (const g of new Set(mine.map(m => m.job.group).filter(Boolean))) this.groups.add(g);
    const finished = this.jobs.filter(j => !ACTIVE.has(j.state)).slice(0, KEEP_JOBS);
    // 목록은 최신이 앞(snapshot 은 앞 KEEP_JOBS 개만 싣는다) → 한 번에 올린 것도 거꾸로 넣는다. 도는 순서는 runJob 이 줄에 spec 순서로 거니 그대로.
    this.jobs = [...mine.map(m => m.job).reverse(), ...this.jobs.filter(j => ACTIVE.has(j.state)), ...finished];
    this.publish();                                   // 늦춤 게시: 파일 여러 개를 한꺼번에 올려도 쓰기가 250 ms 에 한 번
    this.ensureJobs();
    // 이벤트 cx(on_drop · on_click)는 await 뒤에 못 쓴다 → 진행 알림은 spawn 의 cx 로. work 가 돌기 전에 달아 둔다.
    cx.spawn(async cx => {
      await Promise.all(mine.map(({ job, spec }) => this.runJob(job, spec, cx)));
    });
    cx.notify();
  }

  async runJob(job, { work, after, noHistory, okNote }, cx) {
    job.progress = n => {
      job.done = n;
      if (job.state === "run") {
        const s = job.meter.sample(n, Date.now(), job.total || undefined);
        job.speed = s.speed; job.eta = s.eta;
        this.publish();
      }
      cx.notify();
    };
    try {
      const where = await this.line(() => {
        if (job.cancelled) throw new Error("취소했다");
        // 제자리 다시 불러온 뒤 옛 빌드의 줄 서 있던 작업: 더 돌리지 않는다(새 삶이 «실패 · 다시 불러옴» 으로 기록한다 — 안 그러면 파일이 놓이고도 실패로 남아 다시 올리면 «이름 (1)»).
        if (this.closed || !this.lifeOk()) throw new Error("다시 불러옴");
        job.state = "run"; job.meter.reset(); this.publish(); cx.notify();
        return work(job);
      });
      // 일은 끝났어도 그 사이 취소가 눌렸으면 취소로 맺고 뒷일(열기·알림)은 하지 않는다.
      if (job.cancelled) { this.finish(job, "cancel", "취소했다"); return; }
      job.where = noHistory ? "" : String(where ?? "");
      this.finish(job, "ok", okNote ? okNote(where) : where);
      after?.(where, cx);
    }
    catch (e) { this.finish(job, job.cancelled ? "cancel" : "fail", String(e?.message ?? e)); }
    // 취소·닫힘으로 끝난 작업: 돌던 청크 exec 가 이제 끝났다 — 그 `>>` 가 닫힘의 rm 뒤에 조각을 되살렸을 수 있어 정확한 경로를 한 번 더 지운다(이 삶이 아직 살아 있을 때).
    finally { if (job.cancelled && job.part) this.removePart(job); cx.notify(); }
  }

  download(abs, name, on, cx) {
    if (!safeName(name) || !abs.endsWith(`/${name}`)) { notify({ title: "내려받기 거절", body: "이름이 안전하지 않다", level: "error" }); return false; }
    return this.transfer("down", name, job => this.tx.download(on, abs, `${home()}/Downloads`, name, job), cx,
      where => notify({ title: "내려받았다", body: where, level: "success" }),
      { redo: cx => this.download(abs, name, on, cx), on });
  }

  // 열어도 되는 파일인가 — «열기» 직전 검사(이 컴퓨터 파일 · 원격 사본 둘 다). 열면 true · 아니면 Finder 에서 보여 주고 false.
  //  · 이름이 실행 형식(.command · .app · .sh · .pkg · .iso … · 끝의 점/공백 포함)이면 열지 않는다.
  //  · 아니면 파일 상태를 본다: 보통 파일 · 심볼릭 링크 아님 · 실행 비트 없음 — 모두 맞아 종료 코드가 정확히 0 일 때만 다음으로.
  //  · 마지막으로 OS 에 «이 파일을 어느 앱이 여나» 를 묻는다(macOS: NSWorkspace · Linux: xdg-mime). 그 앱이 터미널·설치기·실행기·마운터면 열지 않는다.
  //    앱이 없거나 · 물음이 실패·시간 초과·해석 불가여도 열지 않는다. 그 밖의 모든 결과는 열지 않는 쪽.
  // 경로는 늘 위치 인자($1 · argv)로만 넘긴다(스크립트에 끼워 넣지 않는다). forceReveal = 호출자가 이미 위험하다고 본 경우(격리 속성 실패 등).
  // [주의] 검사와 열기 사이에 파일이 바뀔 수 있다(TOCTOU) — 알려진 한계.
  async openChecked(abs, name, forceReveal = false) {
    const opener = this.mac ? "open" : "xdg-open";
    let safe = !forceReveal && !isRunnable(name), reason = forceReveal ? "quarantine" : "name";
    if (safe) {
      try { safe = (await exec("/bin/sh", ["-c", '[ -f "$1" ] && [ ! -L "$1" ] && [ ! -x "$1" ]', "sh", abs]))?.code === 0; }
      catch { safe = false; }    // [주의] 검사가 실패하면 안전한 쪽(열지 않음)으로
    }
    let app = "";
    if (safe) {
      const v = await this.handlerVerdict(abs);
      safe = v.open; app = v.app ?? ""; if (!safe) reason = v.why;
    }
    if (safe) { exec(opener, [abs]).catch(() => {}); return true; }
    const body = reason === "quarantine" ? `${name} 은(는) 격리 표시를 달지 못해 열지 않았다`
      : reason === "alias" ? `${name} 은(는) Finder 별칭이라(대상이 무엇이든 열지 않는다) 열지 않았다`
      : reason === "runner" ? `${name} 은(는) 기본 앱(${app})이 터미널·설치기·실행기라 열지 않았다`
      : reason === "unknown" ? `${name} 은(는) 기본 앱을 확인하지 못해 열지 않았다`
      : `${name} 은(는) 실행될 수 있는 파일이라 열지 않았다`;
    notify({ title: this.mac ? "Finder 에서 보여 준다" : "폴더를 연다", body, level: "warning" });
    if (this.mac) exec("open", ["-R", abs]).catch(() => {});
    else exec(opener, [abs.slice(0, abs.lastIndexOf("/")) || "/"]).catch(() => {});
    return false;
  }

  // OS 가 이 파일을 열 기본 앱을 물어 판정한다(kinds.js 의 순수 판정). 물음이 던지면(실행 불가 · 시간 초과) 모름 → 열지 않는다.
  async handlerVerdict(abs) {
    try {
      if (this.mac) return macHandlerVerdict(await exec("/usr/bin/osascript", ["-l", "JavaScript", "-e", MAC_HANDLER_SCRIPT, abs], { timeout: 5000 }));
      const mime = await exec("xdg-mime", ["query", "filetype", abs], { timeout: 5000 });
      const m = mime?.code === 0 ? String(mime.stdout ?? "").trim().split("\n")[0].trim() : "";
      const def = m ? await exec("xdg-mime", ["query", "default", m], { timeout: 5000 }) : null;
      return linuxHandlerVerdict(mime, def);
    } catch { return { open: false, why: "unknown" }; }
  }

  openHere(abs, name, on, cx) {
    if (!safeName(name) || !abs.endsWith(`/${name}`)) { notify({ title: "열기 거절", body: "이름이 안전하지 않다", level: "error" }); return false; }
    if (!on) { cx.spawn(async () => { await this.openChecked(abs, name); }); return true; }
    // 원격 파일: 받은 사본(.cache/<sha>/<name>)도 같은 검사를 거친다. 격리 속성(macOS)을 못 달았으면 열지 않는다(Linux 는 격리가 없어 이름·파일 검사만).
    let qfail = false;
    return this.transfer("down", name, async job => {
      const c = await this.tx.cached(on, abs, this.cacheDir, name, OPEN_LIMIT, job);
      qfail = this.mac && c.quarantineFailed === true;
      return c.path;
    }, cx,
    where => { this.openChecked(where, name, qfail).catch(() => {}); },
    { redo: cx => this.openHere(abs, name, on, cx), noHistory: true, on });
  }

  // 올리기(끌어 놓기 · 고르기 창): 파일·폴더·섞어서. 폴더는 걸어서 폴더 구조 그대로(빈 폴더 포함) 파일마다 작업 하나로 올린다.
  upload(paths, rel, cx) {
    const dir = rel ? `${this.root}/${rel}` : this.root, on = this.on, context = this.context;
    if (!this.root || !paths?.length) return;
    // on_drop · on_click 의 cx 는 await 뒤에 못 쓴다 → spawn 의 cx 로. 겹침 거르기도 여기서(이벤트 처리기를 막지 않게).
    cx.spawn(async cx => {
      const list = dedupeNested(paths);            // 같은 경로 하나로 · 폴더와 그 안 항목이 함께면 안쪽은 뺀다
      const tally = { files: 0 };                  // 이번 놓기 전체의 파일 합계(폴더마다 더한다) — 상한 MAX_TREE_FILES
      const kinds = await this.tx.kinds(list).catch(() => null);   // 실패면 전부 지금처럼 파일 올리기(META 가 폴더를 지금 메시지로 거절)
      const specs = [];
      for (const [i, p] of list.entries()) {
        if (kinds?.[i] === "d") specs.push(...await this.folderSpecs(p, dir, on, context, rel, tally));
        else specs.push(this.fileSpec(p, dir, on, context, rel));
      }
      if (this.closed || !specs.length) return;
      this.transferMany(specs, cx);
    });
  }

  uploadOne(p, dir, on, context, rel, cx) { this.transferMany([this.fileSpec(p, dir, on, context, rel)], cx); return true; }

  // 올린 뒤 패널: rel 이 있고 접혀 있으면 펼치고 · 아니면 새로 고친다.
  afterUpload(context, rel, cx) { if (this.context === context) { if (rel && !this.folders.has(rel)) this.toggle(rel, cx); else this.refresh(cx); } }

  fileSpec(p, dir, on, context, rel) {
    const name = p.replace(/\/+$/, "").split("/").pop();
    return {
      dir: "up", name, on,
      work: async job => {
        if (on && !(await this.tx.canPush())) throw new Error("이 컴퓨터의 hc 가 `exec -i` 를 모른다 — `hc update` 뒤 다시");
        return this.tx.upload(on, p, dir, job);
      },
      after: (_where, cx) => this.afterUpload(context, rel, cx),
      redo: cx => this.uploadOne(p, dir, on, context, rel, cx),
    };
  }

  // 폴더 src → 작업들: «폴더 만들기» 1개 + 안의 파일마다 1개(같은 그룹 — 끝 기록은 모았다가 한 번에).
  // 걷기(tree)가 실패하면(상한 · 목록 잘림 · 열 수 없음) 실패한 폴더 작업 1줄만 남긴다 — 다시 시도 = 걷기부터.
  async folderSpecs(src, dir, on, context, rel, tally = { files: 0 }) {
    const base = src.replace(/\/+$/, "").split("/").pop();
    const again = cx => { cx.spawn(async cx => { const s = await this.folderSpecs(src, dir, on, context, rel); if (!this.closed && s.length) this.transferMany(s, cx); }); return true; };
    let plan;
    try { plan = await this.tx.tree(src, { max: MAX_TREE_FILES - tally.files, maxDirs: MAX_TREE_DIRS }); tally.files += plan.files.length; }
    catch (e) {
      let msg = String(e?.message ?? e);
      if (e?.code === "TOO_MANY" && tally.files > 0) msg = `이번에 올리는 파일 합계가 상한 ${MAX_TREE_FILES}개를 넘는다(앞 폴더 ${tally.files}개 · ${msg}) — 나눠서 올릴 것`;
      return [{ dir: "up", name: `${base}/`, on, work: async () => { throw new Error(msg); }, redo: again }];
    }
    let dirNote = "";   // 빈 폴더 일부를 못 만들었을 때의 짧은 사유(머리 작업 note 에)
    const group = { root: null, dead: false, headCancelled: false, total: plan.files.length + 1, ended: 0, byState: { ok: [], fail: [], cancel: [] }, fresh: 0, dirty: false, id: `g${this.life}:${this.gseq = (this.gseq ?? 0) + 1}`, flushed: false, restarted: false };
    // 다시 시도: 폴더를 못 만든 그룹이면 폴더 전체를 처음부터(한 번만 — 파일 줄마다 눌러도 «이름 (k)» 폴더가 여러 개 생기지 않게).
    const restart = cx => { if (group.restarted) return "restarted"; group.restarted = true; return again(cx); };
    const notes = [plan.skipped ? `건너뜀 ${plan.skipped}개` : "", plan.unreadable ? `읽지 못한 곳 ${plan.unreadable}개` : ""].filter(Boolean).join(" · ");
    const head = {
      dir: "up", name: `${base}/`, on, group, groupHead: true,
      work: async job => {
        if (on && !(await this.tx.canPush())) throw new Error("이 컴퓨터의 hc 가 `exec -i` 를 모른다 — `hc update` 뒤 다시");
        if (!on && await this.tx.inside(dir, src)) throw new Error("폴더를 자기 안으로 올릴 수 없다");
        const root = await this.tx.makeTop(on, dir, base);
        group.root = root;      // 맨 위 폴더가 생기자마자 적는다 — 이후 단계가 실패해도 다시 시도가 «이름 (1)» 폴더를 또 만들지 않게(파일 줄 다시 시도는 이 root 로)
        // 빈 폴더 만들기 실패는 치명적이지 않다: 파일은 PREP "1" 이 자기 부모를 만든다 → 머리 작업은 성공 + note · 경고.
        try { await this.tx.makeDirs(on, root, plan.emptyDirs, job); }
        catch (e) {
          if (job.cancelled) throw e;   // 취소는 «일부 못 만듦» 으로 삼키지 않는다 — runJob 이 취소로 맺는다
          dirNote = String(e?.message ?? e).split("\n").map(l => l.trim()).filter(Boolean).pop()?.slice(0, 120) ?? "";
          notify({ title: `${base}/ 빈 폴더 일부 못 만듦`, body: dirNote, level: "warning" });
        }
        return root;
      },
      okNote: where => [where, dirNote ? `빈 폴더 일부 못 만듦: ${dirNote}` : "", notes].filter(Boolean).join(" · "),
      after: (_where, cx) => {
        if (notes) notify({ title: `${base}/ 올리는 중`, body: notes, level: "warning" });
        this.afterUpload(context, rel, cx);
      },
      redo: restart,
    };
    // tracked = 첫 실행(그룹에 센다) · 다시 시도는 그룹 밖 · 기록을 바로 쓴다. 파일 작업엔 after 가 없다(수천 번 새로 고치지 않게).
    const fileSpec = (f, tracked) => ({
      dir: "up", name: `${base}/${f.src}`, on, group: tracked ? group : null,
      work: async job => {
        if (tracked && group.headCancelled) { job.cancelled = true; throw new Error("취소했다"); }   // 폴더 만들기를 취소했으면 파일도 취소로 맺는다(실패 아님)
        if (!group.root || (tracked && group.dead)) throw new Error("폴더를 못 만들었다");
        return this.tx.upload(on, `${src}/${f.src}`, f.dir ? `${group.root}/${f.dir}` : group.root, job, { mkdir: true });
      },
      redo: cx => { if (group.root) { this.transferMany([fileSpec(f, false)], cx); return true; } return restart(cx); },
    });
    return [head, ...plan.files.map(f => fileSpec(f, true))];
  }

  // 파일·폴더 고르기: NSOpenPanel(JXA) 이 경로 배열을 JSON 으로 찍는다 — 줄바꿈이 든 이름이 «두 번째 경로» 로 쪼개지지 않는다(AppleScript 줄 나눔은 `/etc/passwd` 를 끼워 넣을 수 있었다).
  // 그래도 절대 경로가 아니거나 줄바꿈·NUL 이 든 것은 올리지 않는다(경로는 늘 위치 인자). 실패하면 예전 chooseFile(파일만)로 한 번 더.
  pick(rel, cx) {
    const panel = 'ObjC.import("AppKit");'
      + 'const a = $.NSApplication.sharedApplication;'
      + 'a.setActivationPolicy($.NSApplicationActivationPolicyAccessory);'
      + 'a.activateIgnoringOtherApps(true);'
      + 'const p = $.NSOpenPanel.openPanel;'
      + 'p.canChooseFiles = true; p.canChooseDirectories = true; p.allowsMultipleSelection = true; p.canCreateDirectories = false;'
      + 'p.message = "올릴 파일·폴더"; p.prompt = "올리기";'
      + 'const out = [];'
      + 'if (p.runModal == $.NSModalResponseOK) { const u = p.URLs; for (let i = 0; i < u.count; i++) out.push(u.objectAtIndex(i).path.js); }'
      + 'JSON.stringify(out)';
    const legacy = 'const a = Application.currentApplication(); a.includeStandardAdditions = true;'
      + 'const r = a.chooseFile({ withPrompt: "올릴 파일", multipleSelectionsAllowed: true });'
      + 'JSON.stringify((Array.isArray(r) ? r : [r]).map(f => String(f)))';
    cx.spawn(async cx => {
      const t0 = Date.now();
      let r = await exec("osascript", ["-l", "JavaScript", "-e", panel], { timeout: 600000 }).catch(() => null);
      // 예전 chooseFile 로 물러나는 건 패널 스크립트가 바로(5 s 안) rc≠0 으로 끝났을 때만 — 실행 거절(null) · 시간 초과 · 오래 둔 뒤의 실패는 그냥 끝낸다.
      if (r && r.code !== 0 && Date.now() - t0 < 5000) r = await exec("osascript", ["-l", "JavaScript", "-e", legacy], { timeout: 600000 }).catch(() => null);
      if (r?.code !== 0) return;
      let list = [];
      try { list = JSON.parse(r.stdout.trim()); } catch { return; }
      const paths = (Array.isArray(list) ? list : []).filter(p => typeof p === "string" && p.startsWith("/") && !/[\n\r\0]/.test(p));
      if (paths.length) this.upload(paths, rel, cx);
    });
  }

  // verify(해시 맞추고 자리 잡는 중)는 되돌릴 수 없다 → cancelMany 가 건너뛴다.
  cancelJob(job) { this.cancelMany([job], "취소했다"); }

  // ── 파일 다루기(새 폴더 · 이름 바꾸기 · 지우기) ─────────────────────
  // 메뉴·이름 창을 열 때 패널이 {root, on, rel…} 를 1회용 티켓에 적는다. 팝업의 요청(shared)은 토큰과 이름/도구만 싣는다 —
  // 실행은 늘 티켓의 값으로 한다(this.root · 현재 위치로 다시 풀지 않는다). 설계: docs/popups-design.md §8.
  // row = { rel, dir, name } | null(빈 곳 · 아래 아이콘). 새 폴더가 들어갈 부모: 폴더 줄 = 그 폴더 · 파일 줄 = 그 폴더 · 빈 곳 = 맨 위.
  fsCtx(row) {
    const rel = row?.rel ?? "", dir = row ? row.dir === true : true, name = row?.name ?? "", on = this.on ?? null;
    const into = row ? (dir ? rel : parent(rel)) : "";
    const names = r => (this.entries.get(r) ?? []).slice(0, 500).map(e => e.name);
    const token = putTicket(this.tickets, { root: this.root, on, context: this.context, rel, dir, name }, Date.now());
    return { token, owner: this.owner, on, name, dir, empty: !row, abs: joinAbs(this.root, rel), dirAbs: joinAbs(this.root, into), taken: names(into), siblings: row ? names(parent(rel)) : [] };
  }

  openMenu(row) {
    if (!this.root || this.closed) return;
    const ctx = this.fsCtx(row);
    openOverlay(menuSpec(ctx, menuItems(ctx).length));
  }

  // 아래 «새 폴더» 아이콘: 맨 위 폴더에 새 폴더.
  openMkdir() {
    if (!this.root || this.closed) return;
    openOverlay(askSpec(askProps(this.fsCtx(null), "mkdir")));
  }

  fsop(op, a, cx) {
    const t = takeTicket(this.tickets, a.token, Date.now());
    if (!t) { notify({ title: "요청이 오래됐다 — 다시 할 것", level: "warning" }); return; }
    const v = opPlan(op, t, a);
    if (!v.ok) { notify({ title: "요청 거절", body: v.why, level: "error" }); return; }
    // 이름 바꾸기·지우기는 전송이 하나라도 돌면 거절(옮기는 중인 경로를 바꾸지 않게). 새 폴더는 된다.
    const busy = () => op !== "mkdir" && this.jobs.some(j => ACTIVE.has(j.state));
    const wait = () => notify({ title: "전송이 끝난 뒤 다시", body: v.name ?? v.from, level: "warning" });
    if (busy()) { wait(); return; }
    this.ops = this.ops ?? oneAtATime();      // 한 줄로: 파일 작업끼리 겹치지 않는다
    const context = t.context, FAIL = { mkdir: "폴더를 만들지 못했다", rename: "이름을 바꾸지 못했다", delete: "지우지 못했다" };
    cx.spawn(async cx => {
      try {
        await this.ops(async () => {
          if (busy()) { wait(); return; }       // 줄 서 있는 사이 전송이 시작됐을 수 있다
          let r;
          try { r = await exec("sh", ["-c", v.script, "files-plus", ...v.args], { on: v.on, timeout: v.timeout }); }
          catch { notify({ title: "결과를 알 수 없다 — 목록을 새로 고친다", level: "warning" }); return; }   // 시간 초과 · 연결 끊김
          if (r.code !== 0) { notify({ title: FAIL[op], body: opError(r), level: "error" }); return; }
          if (this.context === context) this.applyFsop(v, cx);
          notify(op === "mkdir" ? { title: "폴더를 만들었다", body: v.name, level: "success" }
            : op === "rename" ? { title: "이름을 바꿨다", body: `${v.from} → ${v.to}`, level: "success" }
            : { title: v.tool === "none" ? "지웠다" : "휴지통으로 옮겼다", body: v.name, level: "success" });
        });
      } catch { /* 알림은 위에서 냈다 */ }
      finally { if (!this.closed) this.refresh(cx, true); }
    });
  }

  // 성공한 작업을 트리 상태에 바로 반영한다(다음 refresh 가 디스크 기준으로 바로잡는다).
  applyFsop(v, cx) {
    const list = this.entries.get(v.parentRel);
    if (v.op === "mkdir") {
      if (list) this.entries.set(v.parentRel, withEntry(list, { name: v.name, dir: true }));
      if (v.parentRel && !this.folders.has(v.parentRel)) this.toggle(v.parentRel, cx);   // 접힌 부모면 펼쳐 새 폴더가 보이게
    } else if (v.op === "rename") {
      if (list) this.entries.set(v.parentRel, renamedEntry(list, v.from, v.to));
      if (v.isDir) { const r = renameTree(this.folders, this.entries, v.rel, v.newRel); this.folders = r.folders; this.entries = r.entries; }
    } else {
      if (list) this.entries.set(v.parentRel, withoutEntry(list, v.name));
      const r = dropTree(this.folders, this.entries, v.rel); this.folders = r.folders; this.entries = r.entries;
    }
    // 열려 있는 미리보기가 그 폴더 목록(또는 지운/바꾼 폴더 안)이면 닫는다 — 없어진 파일을 계속 보이지 않게.
    if (v.op !== "mkdir" && this.previewDir != null && (this.previewDir === v.parentRel || this.previewDir === v.rel || this.previewDir.startsWith(v.rel + "/"))) this.closePreview();
    cx.notify();
  }

  // 팝업 요청함(300 ms). 모르는 action 은 무시한다.
  inbox(cx) {
    if (this.closed || !this.lifeOk()) return;    // 낡은 삶은 요청함도 비우지 않는다(ack 를 올려 새 삶의 요청을 가로채지 않게)
    try { this.tfTick(cx); } catch (e) { try { this.tfNote({ phase: "tick-error", kind: "full", cands: 0, found: 0, err: errClass(e) }); } catch { /* 터미널 줄 오류가 요청함을 막지 않게 */ } }
    try { this.dcTick(cx); } catch { /* 더블클릭 열기는 조용히 — 오류가 요청함을 막지 않게 */ }
    for (const from of SOURCES) {
      for (const req of drain(shared, setShared, this.owner, from)) {
        try { this.handle(req.action, req.args ?? {}, cx); } catch { /* 한 요청 오류가 나머지를 막지 않게 */ }
      }
    }
  }

  handle(action, a, cx) {
    // 요청은 shared 로 오므로 팝업을 믿지 않고 여기서도 거른다: 이름은 safeName · 경로는 그 이름으로 끝나고 NUL 없음.
    // abs 는 절대 경로("/" 로 시작)만: 상대 경로면 on==null 일 때 `open` 이 «-» 로 시작하는 값을 옵션으로 읽는다.
    const target = () => (typeof a.abs === "string" && typeof a.name === "string" && safeName(a.name) && a.abs.startsWith("/") && !a.abs.includes("\0") && a.abs.endsWith(`/${a.name}`)
      && (a.on == null || typeof a.on === "string") ? [a.abs, a.name, a.on || null] : null);
    if (action === "download") { const t = target(); if (t) this.download(...t, cx); }
    else if (action === "open") { const t = target(); if (t) this.openHere(...t, cx); }
    else if (action === "cancel") { const j = this.jobs.find(j => j.id === a.id); if (j) this.cancelJob(j); }
    else if (action === "cancelAll") { this.cancelMany(this.jobs, "취소했다"); }
    else if (action === "clear") { this.jobs = this.jobs.filter(j => ACTIVE.has(j.state)); this.publishNow(); }
    else if (action === "retry") {
      const j = this.jobs.find(j => j.id === a.id);
      if (j && j.state === "fail" && j.redo) {
        // 줄을 먼저 뺀다(동기 redo 의 transferMany 가 끝난 목록을 다시 쓴다) → 실제로 다시 걸지 않았으면(true 아님) 제자리에 되돌린다.
        const at = this.jobs.indexOf(j);
        this.jobs = this.jobs.filter(x => x !== j);
        let r = false;
        try { r = j.redo(cx); } catch { r = false; }
        if (r !== true) { this.jobs.splice(Math.min(at, this.jobs.length), 0, j); notify({ title: r === "restarted" ? "이미 다시 시도 중" : "다시 시도할 수 없다", body: j.name, level: "info" }); }
        this.publishNow();
      }
    }
    else if (action === "mkdir" || action === "rename" || action === "delete") { this.fsop(action, a, cx); }
    else if (action === "clearHistory") { this.histBuf = []; for (const g of this.groups) { g.byState = { ok: [], fail: [], cancel: [] }; g.fresh = 0; g.dirty = false; } if (this.lifeOk()) setShared(KEY.history, []); }   // 돌고 있는 그룹이 모아 둔 항목도 비운다 — 안 그러면 다음 그룹 쓰기에 지운 기록이 되살아난다
    else return;
    cx.notify();
  }

  // ── 그리기 ──────────────────────────────────────────────────────────
  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      const into = entry.dir ? path : prefix;
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => { if (Date.now() - (this.rightAt ?? 0) < 400) return; entry.dir ? this.toggle(path, cx) : this.openPreview(path); })   // 오른쪽 클릭이 on_click 도 낼 수 있다(문서 없음) → 막 연 메뉴 뒤 400 ms 는 무시
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.rightAt = Date.now(); this.openMenu({ rel: path, dir: entry.dir, name: entry.name }); })
        .on_drop((e, cx) => { cx.stop_propagation(); this.upload(e.paths, into, cx); })
        .child(entry.dir ? svg(icon(`chevron-${open ? "down" : "right"}`)).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(icon(entry.dir ? "folder" : "file")).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  // 아래 줄: 왼쪽 올리기 아이콘(macOS) · 새 폴더 아이콘 + 흐린 «끌어다 놓기» · 오른쪽 전송 칩(작업 있을 때만).
  bottomRow(t) {
    const s = summary(this.jobs);
    return h_flex().id("files-bottom").h(32).flex_none().px(10).gap(8).items_center().border_t(1).border_color(t.border)
      .when(this.mac && Boolean(this.root), el => el.child(h_flex().id("act-up").w(24).h(24).flex_none().items_center().justify_center().rounded(6).cursor_pointer()
        .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).tooltip("올리기")
        .on_click((_e, cx) => this.pick("", cx)).child(svg(icon("upload")).size(16).flex_none())))
      .when(Boolean(this.root), el => el.child(h_flex().id("act-mkdir").w(24).h(24).flex_none().items_center().justify_center().rounded(6).cursor_pointer()
        .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).tooltip("새 폴더")
        .on_click(() => this.openMkdir()).child(svg(icon("folder-plus")).size(16).flex_none())))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child("끌어다 놓기"))
      .when(s.total > 0, el => el.child(h_flex().id("files-chip").h(22).px(8).flex_none().items_center().rounded(11).border_1().border_color(t.border).cursor_pointer()
        .text_size(11).text_color(s.failed > 0 ? t.blocked : s.running + s.waiting > 0 ? t.accent : t.muted).hover(x => x.bg(t.hover))
        .on_click((_e, cx) => { this.ensureJobs(true); cx.notify(); })
        .child(`↑↓ ${s.running + s.waiting} · ${s.pct}%`)));
  }

  panelRender(cx) {
    if (JSON.stringify(location(this.loc)) !== this.context?.key) this.refresh(cx);
    const t = theme();
    const where = [this.on, this.root?.split(/[\\/]/).pop()].filter(Boolean).join(" · ");
    const empty = !this.error && !this.entries.get("")?.length;
    return v_flex().id("files-plus").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .on_drop((e, cx) => this.upload(e.paths, "", cx))
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("파일+"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(where)))
      .when(Boolean(this.tfT), el => el.child(this.termStrip(t)))
      .child(v_flex().id("files-tree").on_mouse_down("right", () => this.openMenu(null)).flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))
        .when(Boolean(this.error), el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error)))
        .when(empty, el => el.child(v_flex().p(8).gap(2)
          .child(div().text_size(12).text_color(t.dim).child(this.loading ? "불러오는 중…" : this.root ? "비어 있음" : "폴더 없음"))
          .when(!this.loading && Boolean(this.root), el => el.child(div().text_size(11).text_color(t.dim).child("끌어다 놓기로 올리기")))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("목록은 폴더마다 500개 · 모두 5,000개까지"))))
      .child(this.bottomRow(t));
  }
}
