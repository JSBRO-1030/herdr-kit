// files-plus 미리보기 팝업(C2) — 설계: docs/popups-design.md §4.
// View 가 아니라 평범한 class: main.js 의 View 가 props.mode === "preview" 일 때 위임한다.
// 전송은 하지 않는다 — 내려받기·열기는 state.js 의 send() 로 패널에 요청만 보낸다.
import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import { exec, readTextFile, theme, settings, appHome, run, props, openOverlay, closeOverlay, shared, setShared, notify } from "herdr";
import * as fs from "fs/promises";
import { kindOf, pictureCheck, human, safeMarkdown, MD_RENDER_LIMIT } from "./kinds.js";
import { makeTransfer, TooBig } from "./transfer.js";
import { sandboxProfile, renderArgv, parsePdfOut, nextRender } from "./pdfpages.js";
import { send, safeName, alive, own, previewSpec, previewKey, readShared, livePreviewId, previewId, KEY, dragRect, fontOf, stepFont, FONT_DEFAULT, resizeEntry, resizeEntryOf, resizeLive, RESIZE_SLACK, RESIZE_REFRESH_MS, resizeFrameId } from "./state.js";

const NAME = "files-plus";
const CACHE_REL = `mods/${NAME}/.cache`;
const IMAGE_LIMIT = 16 * 1024 * 1024;    // image() 자산 상한(gpui-kit MAX_ASSET_BYTES)
const DOC_LIMIT = 200 * 1024 * 1024;     // 첫 쪽을 보려면 통째로 받아야 한다
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const icon = (n) => `mods/${NAME}/${n}.svg`;
const ZOOMS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];   // 확대 단계(자연 크기 대비)
const NOTCH_PX = 40;                                            // 트랙패드 픽셀 누적 → 한 단계
const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
const PDF_FAIL = "PDF 를 열 수 없다(잠김·손상) · 열기나 내려받기를 쓴다";
const DOC_NOTE = "첫 쪽만 보임 · 전체는 Mac에서 열기";
const NO_SANDBOX_NOTE = "첫 쪽만 보임 (쪽 넘기기 불가: 격리 실행 없음)";
const HELP = [   // ? 패널: [키, 설명]
  ["→ · 스페이스", "다음 파일"], ["←", "이전 파일"], ["↑ ↓ · Home · End", "이전·다음 · 처음·끝 파일 (글 칸을 누르면 글 스크롤)"], ["Esc", "닫기"],
  ["Enter · ⌘O", "Mac에서 열기 (기본 앱이 터미널·설치기·실행기면 열지 않고 Finder 에서 보여 준다)"], ["⌘S", "내려받기"], ["⌘C", "경로 복사"], ["I · L", "정보 · 목록 칸"], ["P", "페이지로"], ["F", "크게 보기 ↔ 보통"],
  ["PageUp · PageDown", "PDF 쪽 넘기기"], ["+ · =", "확대"], ["-", "축소"], ["0", "맞춤"], ["1", "실제 크기(100%)"], ["끌기 · 휠", "그림 이동(커졌을 때)"], ["⌘/Ctrl + 휠", "커서 기준 확대·축소"], ["더블클릭", "맞춤 ↔ 100%"],
  ["+ · - · 0", "글자 크게 · 작게 · 기본 (글자 보기일 때 · 기억됨)"],
  ["오른쪽 · 아래 가장자리 · 모서리 끌기", "창 크기 조절(기억됨) · 모서리를 두 번 누르면 기본 크기"],
  ["M", "마크다운 렌더 ↔ 원문"], ["?", "이 도움말"],
];
const BORDER = 1;            // 미리보기 루트 border_1 — 루트의 e.bounds 는 테두리 안쪽이라 창 사각형은 사방 1px 더 크다(VM 실측)
const IDLE_MS = 15000;       // 크기 틀: 이 시간 동안 움직임이 없으면 스스로 닫는다
const KIND_LABEL = { image: "그림", convert: "그림(변환)", doc: "문서", page: "페이지", text: "글자" };

// 미리보기 창 열기 — 처음(main.js)과 «크게 보기» 다시 열기(toggleFull)가 같은 곳을 쓴다: 옵션이 한 군데에서만 정해진다.
// 앱 창 크기는 전역 window.viewport_size()(gpui-kit Window) — herdr 의 window() 에는 크기가 없다. 이벤트 핸들러 안에서만 읽힌다(밖이면 던진다 → 크기 모름으로 처리).
// [주의] viewport_size 가 앱 창 전체인지 확인 필요(사이드바 제외 등) — 어긋나면 가운데에서 조금 벗어날 뿐.
// 주인당 하나: overlay key 를 쓰지 않으므로(옛 자리를 기억해 되살리는 문제) shared 의 previewKey(owner) 에 «지금 열린 id» 를 두고 여기서 옛 것을 닫는다.
//  · replace = 호출한 창 자신의 id(크게 보기): 새 창을 먼저 열고 그 뒤에 옛 것(= 자신)을 닫는다. 없으면(처음 열기) 옛 것을 먼저 닫고 연다.
//  · 닫기는 try/catch — 이미 사라진 id 여도 괜찮다.
export function openPreviewWindow(props, full = false, replace = null) {
  const key = previewKey(props.owner);
  // 키 값 {id, at}: 살아 있는(at 이 5 s 안) 미리보기의 id 만 «옛 창» 으로 닫는다. 충돌로 남은 낡은 id 는 호스트가 다른 창에 재사용했을 수 있어 닫지 않고 덮어쓴다. replace(= 호출한 창 자신)는 늘 닫는다.
  const old = [...new Set([livePreviewId(readShared(shared, key), Date.now()), replace].filter(x => typeof x === "string" && x))];
  const drop = keep => { for (const id of old) if (id !== keep) { try { closeOverlay(id); } catch { /* 이미 닫힘 */ } } };
  if (!replace) drop(null);
  let viewport = null;
  try { viewport = globalThis.window?.viewport_size?.() ?? null; } catch { viewport = null; }
  // rect(크기 틀이 끝낸 자리)는 이번 열기에만 쓰고 새 창의 props 에는 남기지 않는다. 없으면 기억된 크기(KEY.previewSize)로 가운데.
  const { rect, ...rest } = props;
  const id = openOverlay(previewSpec({ mod: NAME, owner: props.owner, props: rest, full, viewport, rect: rect ?? null, size: readShared(shared, KEY.previewSize) }));
  try { setShared(key, { id, at: Date.now() }); } catch { /* 키를 못 쓰면 다음 열기가 옛 창을 못 닫는다 — 겹칠 수 있다 */ }
  if (replace) drop(id);
  return id;
}

export class Preview {
  constructor(props, cx) {
    this.p = props ?? {};
    // 이름은 이 컴퓨터 경로(사본 · 내려받기)에 닿는다 → 안전하지 않은 것은 여기서 뺀다. 누른 파일의 자리는 이름으로 다시 찾는다.
    const raw = Array.isArray(this.p.files) ? this.p.files : [], want = raw[this.p.index ?? 0];
    this.files = raw.filter(safeName);
    this.index = Math.max(0, this.files.indexOf(want));
    this.mac = Boolean(this.p.mac);
    this.viewer = Boolean(this.p.viewer);
    this.on = this.p.on ?? null;
    this.tx = makeTransfer(exec, { quarantine: () => this.mac });   // 패널과 같은 격리: 사본을 mv -f 로 바꿔도 격리 속성이 남는다
    this.cacheDir = `${appHome()}/${CACHE_REL}`;
    this.gen = 0; this.closed = false;
    this.flight = Promise.resolve(); this.homeReal = null;   // 쪽 렌더는 창당 하나씩(앞 파일 것이 끝나야 다음) · 홈 실제 경로 캐시
    this.box = { w: 0, h: 0 };
    // zoom: null = 맞춤 · 숫자 = 자연 크기 배율. props.zoom(숫자 | "fit")은 첫 파일에만 쓴다.
    const z = Number(this.p.zoom);
    this.initZoom = this.p.zoom != null && this.p.zoom !== "fit" && Number.isFinite(z) && z > 0 ? Math.min(8, Math.max(0.1, z)) : null;
    this.zoom = null; this.wheel = 0; this.first = true;
    this.px = null; this.py = null; this.drag = null;   // 그림 왼쪽 위 좌표(그림 칸 기준) · null = 그 축은 가운데
    this.font = fontOf(readShared(shared, KEY.fontSize));      // {md, code} px — 다른 창에서 바꾼 값도 다음 열기에 이어진다
    this.rootBounds = null; this.rootSize = null;               // 크기 조절용: 루트 on_mouse_move 의 e.bounds · on_size_change
    this.resizePending = null; this.resizeUntil = 0;            // 크기 틀이 떠 있는 동안 {at, seen} · 틀이 닫힌 뒤 Esc 뗌을 무시할 시각(아래 checkResize · onKeyUp)
    this.full = Boolean(this.p.full); this.help = false; this.note = null; this.noteTok = 0;
    this.md = false; this.raw = Boolean(this.p.raw); this.mdText = null;
    this.showList = Boolean(this.p.list); this.showInfo = Boolean(this.p.info);
    this.code = null; this.media = null; this.error = null; this.stat = null;
    this.handle = cx.focus_handle();
    this.downSeen = { left: false, right: false, space: false, escape: false };   // 루트 on_key_down 이 본 키(키 뗌 보정용 · C3)
    this.escMuteUntil = 0;                                                         // 도움말을 Esc 로 닫은 직후 이 시각까지 Esc 를 무시(누르고 있던 Esc 가 창까지 닫지 않게)
    this.modAt = 0;                                                                // 수식키가 마지막으로 바뀐 때(ms)
    // window 는 열릴 때 키보드를 받지 않는다 → 스스로 포커스를 건다(첫 그리기 뒤에도 두 번 더).
    this.tasks = new Set();    // 걸어 둔 타이머 — close() 가 모두 끊는다
    this.handle.focus();
    for (const ms of [50, 250]) this.later(cx, ms, () => this.handle.focus());
    // 주인 패널이 닫히면(shared 의 jobs 키가 치워짐) 이 창도 닫는다 — 패널이 closeOverlay 를 못 불러도(id 가 바뀐 경우 · 레이아웃 정리) 고아 창이 남지 않게.
    // [주의] 읽기가 한 번 비어도 닫지 않도록 연속 두 번 없을 때만 닫는다.
    let gone = 0, beat = 0;
    this.selfCheck = cx.timer.every(500, () => {
      if (this.closed || !this.p.owner) return;
      gone = alive(shared, this.p.owner) ? 0 : gone + 1;
      if (gone >= 2) { this.shut(); return; }
      if (this.resizePending) this.checkResize(cx);
      // 살아 있다는 표시: 이 창의 id 가 «지금 것» 일 때만 at 을 새로 쓴다(크게 보기로 새 창이 키를 넘겨받았으면 건드리지 않는다).
      // [주의] setShared 는 모든 mod 를 다시 그린다(herdr.d.ts) → 읽기는 0.5 s 마다 해도 쓰기는 1.5 s 마다만(PREVIEW_TTL 5 s 안에 세 번).
      if (++beat % 3 !== 0) return;
      try { const id = this.overlayId, k = previewKey(this.p.owner); if (id && previewId(readShared(shared, k)) === id) setShared(k, { id, at: Date.now() }); } catch { /* 다음 틱에 */ }
    });
    this.go(this.index, cx);
  }

  // 크기 틀(ResizeFrame)이 열릴 때 shared 의 KEY.resize 에 {id: 이 창 id, at} 를 쓰고 닫힐 때(어느 길이든) 지운다 → 키가 사라진 것을 보면 틀이 끝난 것: 포커스를 되찾는다
  // (틀을 Esc · 15 s · 주인 죽음으로 취소하면 이어서 포커스가 어디에도 없어 Esc/F/←→ 가 죽는다). 틀이 끝난 뒤 500 ms 는 Esc 뗌을 무시한다(Editor 로 간 뗌이 shut() 하지 않게).
  // [주의] 틀이 아예 안 열렸거나 읽기 전에 닫힌 경우: 키를 한 번도 못 봤어도 2 s 가 지나면 끝난 것으로 본다. 키의 at 이 IDLE_MS+5 s 보다 낡았으면 틀이 죽은 것(충돌) → 열려 있다고 보지 않는다.
  checkResize(cx) {
    const now = Date.now(), v = readShared(shared, KEY.resize(this.p.owner)), id = this.overlayId;
    const open = Boolean(id) && resizeLive(v, id, now, IDLE_MS + RESIZE_SLACK);
    if (open) { this.resizePending.seen = true; return; }
    if (!this.resizePending.seen && now - this.resizePending.at < 2000) return;
    // 키가 이 미리보기 것인데 낡았다 = 틀이 죽었거나 닫기가 안 먹혔다 → 틀을 한 번 더 닫고 키를 치운다(투명 전체 창이 남지 않게).
    this.killFrame(v);
    this.resizePending = null; this.resizeUntil = now + 500;
    this.refocus(cx);
  }

  // 낡은 틀 정리: 이 미리보기 것인 키(v)의 틀 id(내가 연 것 · 없으면 키에 적힌 것)를 한 번 더 닫고, 키가 아직 이 미리보기를 가리키면 지운다.
  killFrame(v) {
    const id = this.overlayId, e = resizeEntryOf(v);
    if (!id || !e || e.id !== id) return;
    const fid = this.frameId || e.frame;
    if (typeof fid === "string" && fid && fid !== id) { try { closeOverlay(fid); } catch { /* 이미 닫힘 */ } }
    this.frameId = null;
    try { if (resizeEntryOf(readShared(shared, KEY.resize(this.p.owner)))?.id === id) setShared(KEY.resize(this.p.owner), null); } catch { /* 다음에 */ }
  }

  // 타이머 하나 — 닫히면 안 돌고(closed 확인), close() 가 끊는다. 끝나면 목록에서 빠진다.
  later(cx, ms, fn) {
    const t = cx.timer.after(ms, c => { this.tasks.delete(t); if (!this.closed) fn(c); });
    this.tasks.add(t);
    return t;
  }
  // 키보드를 겉 요소로 되돌린다: 보이던 내용(Editor · TextView · 도움말)이 트리에서 빠지면 포커스가 사라져 키가 죽는다 → 바로 한 번, 다시 그려진 뒤 한 번 더.
  refocus(cx) {
    this.handle.focus();
    this.later(cx, 50, () => this.handle.focus());
  }

  get name() { return this.files[this.index] ?? ""; }
  get abs() { return this.p.dir ? `${this.p.root}/${this.p.dir}/${this.name}` : `${this.p.root}/${this.name}`; }
  // 팝업을 닫을 때 쓸 자기 overlay id — 기본 mod(confirm · prompt · toast)처럼 props() 에서 읽고, 없으면 init 때 받은 것.
  get overlayId() { return props()?.overlay ?? this.p.overlay; }

  // 파일 하나로 넘어간다. 앞 요청 결과는 세대 번호로 버린다.
  go(i, cx) {
    if (i < 0 || i >= this.files.length) return;
    if (!safeName(this.files[i])) return;
    this.index = i;
    for (const k of Object.keys(this.downSeen)) this.downSeen[k] = false;
    const startPage = this.first ? Number(this.p.page) : 0;   // 크게 보기·크기 조절로 다시 열었을 때 이어 볼 쪽(첫 파일만 · 범위 밖이면 0)
    this.zoom = this.first ? this.initZoom : null; this.first = false; this.wheel = 0;
    this.px = null; this.py = null; this.drag = null;
    this.pdf = null; this.pdfJobs = new Map(); this.pw = 0;   // PDF 쪽 넘기기 상태 · 진행 중인 쪽 렌더 · 휠 누적
    this.md = /\.(md|markdown)$/i.test(this.files[i]); this.mdText = null;
    this.refocus(cx);   // 새 내용이 키보드를 받지 않는다 → 겉 요소로 되돌린다
    const gen = ++this.gen;
    this.code?.release(); this.code = null; this.media = null; this.error = null; this.stat = null;
    const name = this.name, abs = this.abs, kind = kindOf(name);
    const live = () => !this.closed && this.gen === gen;
    // 크기·수정 시각 — 실패하면 줄을 뺀다.
    cx.spawn(async cx => {
      try {
        const r = await exec("sh", ["-c", 'stat -L -c "%Y %s" "$1" 2>/dev/null || stat -L -f "%m %z" "$1"', "sh", abs], { on: this.on });
        const [m, s] = r.stdout.trim().split(/\s+/).map(Number);
        if (r.code === 0 && live() && Number.isFinite(m)) this.stat = { mtime: m * 1000, size: Number.isFinite(s) ? s : null };
      } catch { /* 줄 생략 */ }
      if (live()) cx.notify();
    });
    if (kind === "image" || kind === "convert" || kind === "doc") this.picture(kind, name, abs, gen, cx, Number.isInteger(startPage) && startPage > 0 ? startPage : 0);
    else this.text(name, abs, gen, cx);
    cx.notify();
  }

  text(name, abs, gen, cx) {
    const live = () => !this.closed && this.gen === gen;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(abs, { on: this.on });
        if (!live()) return;
        if (text === null) { this.error = "이 파일이 이제 없다"; return; }
        if (text.includes("\0")) { this.error = "글자 파일이 아니다 · 내려받기나 열기를 쓴다"; return; }
        const t = theme(), ext = name.includes(".") ? name.split(".").pop() : "txt";
        // 렌더 칸: 200 KB 로 자르고(TextView 가 통째로 그리면 느리다) 그림 불러오기는 막는다 — 원문 칸(Editor)은 400K 까지 그대로.
        if (this.md) {
          const cut = text.length > MD_RENDER_LIMIT;
          this.mdText = safeMarkdown(cut ? text.slice(0, MD_RENDER_LIMIT) : text) + (cut ? "\n\n---\n… 앞 200 KB 만 보였다 · 「원문 보기」(M)로 전체 보기" : "");
        }
        this.codeSrc = { language: own(LANG, ext) ?? ext, readonly: true,
          value: text.length > 400000 ? text.slice(0, 400000) + "\n… (뒤는 잘랐다)" : text,
          font_family: settings().font_family,
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } };
        this.code = EditorState.new({ ...this.codeSrc, font_size: this.font.code }); this.codeBuilt = this.font.code;
      } catch { if (live()) this.error = "글자로 보일 수 없다(바이너리 · 1 MiB 넘음 · 읽기 불가) · 내려받기나 열기를 쓴다"; }
      finally { if (live()) cx.notify(); }
    });
  }

  picture(kind, name, abs, gen, cx, startPage = 0) {
    if (kind !== "image" && !this.mac) { this.media = { kind, state: "error", note: "문서·HEIC 미리보기는 Mac 앱에서만 된다(빠른 보기·sips) · 열기나 내려받기를 쓴다" }; return; }
    const live = () => !this.closed && this.gen === gen;
    const media = this.media = { kind, state: "loading", total: 0, done: 0 };
    cx.spawn(async cx => {
      // cancelled: 다른 파일로 넘어가면(세대가 바뀌면) transfer 가 조각마다 보고 멈춘다.
      const job = { start: n => { media.total = n; }, progress: n => { media.done = n; if (live()) cx.notify(); }, get cancelled() { return !live(); } };
      try {
        const c = await this.tx.cached(this.on, abs, this.cacheDir, name, kind === "image" ? IMAGE_LIMIT : DOC_LIMIT, job);
        if (!live()) return;   // 다운로드 사이 다른 파일로 넘어갔다 → 낡은 파일이 새 세대 줄에 서지 않게
        this.touch(c.sha);   // 캐시 정리(main.js · 폴더 mtime 기준)가 쓰는 중인 사본을 지우지 않게
        let out = null, note = kind === "doc" ? DOC_NOTE : null, pdf = null;
        // PDF(Mac 앱만): 한 쪽씩. 격리 렌더러 자체가 없을 때(sandbox-exec 없음 · 홈 모름 · 프로필 못 만듦 = null)만 기존 첫 쪽(qlmanage)으로 돌아간다.
        // [주의] 격리 렌더가 «실패»(잠김 · 5000쪽 초과 · 시간 초과 · 거대한 쪽 · 깨짐)하면 오류 화면 — 믿을 수 없는 PDF 를 더 약한 샌드박스(qlmanage)로 두 번째 파싱하지 않는다(공격자가 실패를 유도해 약한 경로로 내릴 수 있다).
        if (kind === "doc" && this.mac && /\.pdf$/i.test(name)) {
          let r = null;
          try {
            r = await this.pdfPage(c.path, c.sha, startPage, 0, gen);
            if (r && r.out === null) r = await this.pdfPage(c.path, c.sha, 0, 0, gen);   // 이어 볼 쪽이 범위 밖 → 1쪽
          } catch {
            if (!live()) return;
            // 이어 볼 쪽(>0)만 못 그린 것일 수 있다 → 같은 격리 렌더러로 1쪽을 한 번 더(qlmanage 로 다시 파싱하지 않는다). 그것도 실패하면 오류 화면.
            r = null;
            if (startPage > 0) { try { r = await this.pdfPage(c.path, c.sha, 0, 0, gen); } catch { if (!live()) return; } }
            if (!r) throw new Error(PDF_FAIL);
          }
          if (!live()) return;
          if (r) {
            if (!r.out) throw new Error(PDF_FAIL);
            out = r.out; note = null; pdf = { src: c.path, sha: c.sha, pages: r.pages, page: r.page, want: null, busy: false, pre: new Set(), bytes: c.size };
          } else note = NO_SANDBOX_NOTE;
        }
        out ??= kind === "image" ? c.path : await this.convert(kind, c.path, c.sha);
        const v = await this.look(out);
        if (!live()) return;
        if (v.note) { this.media = { kind, state: "error", note: v.note }; return; }
        this.pdf = pdf;
        this.media = { kind, state: "ready", rel: out.slice(appHome().length + 1), size: v.size, bytes: c.size, note };
        if (pdf) this.pump(pdf, gen, cx);
      } catch (e) {
        if (!live()) return;
        this.media = { kind, state: "error", note: e instanceof TooBig ? `미리보기 상한 ${human(e.limit)}보다 크다(${human(e.size)}) · 내려받기나 열기를 쓴다` : String(e?.message ?? e) };
      } finally { if (live()) cx.notify(); }
    });
  }

  // 그림 파일 검사: 픽셀 폭탄 · 크기 모름: imageSize ?? declaredSize(머리글의 선언 크기 — TIFF · ICO · PNM · SVG 포함)로 잰다. 모르면(null) 그리지 않는다 — 변환된 PNG(문서 · HEIC · PDF 쪽)도 같다.
  // media.size 는 그리기용 imageSize 만(그리는 쪽은 그대로). 돌려주는 값: {size} 또는 {note}(그리지 않는 사유).
  async look(out) {
    const bytes = await fs.readFile(out).catch(() => null);
    const { size, bomb, unknown } = pictureCheck(bytes);
    if (unknown) return { note: "크기를 알 수 없는 그림이다 · 열기나 내려받기를 쓴다" };
    if (bomb) return { note: `너무 큰 그림이다(${bomb.w >= 1e12 ? "?" : Math.round(bomb.w)}×${bomb.h >= 1e12 ? "?" : Math.round(bomb.h)}) · 열기나 내려받기를 쓴다` };
    return { size };
  }

  // PDF 한 쪽(i, 0부터)을 PNG 로 — 캐시(${sha}/view/p${i}.png · 쪽 수 ${sha}/view/pages: sha 폴더가 이미 파일마다 따로라 원래 이름은 안 쓴다 → NAME_MAX 안전)가 비어 있지 않으면 그대로
  // · 같은 쪽을 동시에 두 번 만들지 않는다 · 렌더는 창당 하나씩(this.flight 줄: 앞 파일의 낡은 렌더도 끝나야 다음이 시작 · 세대가 바뀐 줄 선 렌더는 시작하지 않는다).
  // 돌려주는 값 {out, pages, page} · out null = 그 쪽이 범위 밖(pages 만 유효) · 반환 null = 격리 실행 불가 · 그 밖의 실패는 던진다.
  // known = 이미 아는 쪽 수(0 이면 모름 → 첫 쪽은 pages 파일이 없을 때 다시 만들어 센다).
  // gen = 부르는 쪽이 잡은 세대(호출 시점의 this.gen 을 쓰지 않는다 — await 뒤 낡은 호출이 새 세대로 줄 서는 것 방지).
  pdfPage(src, sha, i, known, gen) {
    const dir = `${this.cacheDir}/${sha}/view`, out = `${dir}/p${i}.png`;
    const jobs = this.pdfJobs;
    if (this.closed || this.gen !== gen) return Promise.reject(new Error("취소했다"));
    if (jobs.has(out)) return jobs.get(out);
    const run = () => { if (this.closed || this.gen !== gen) throw new Error("취소했다"); return this.pdfRender(src, sha, dir, out, i, known, gen); };
    const job = this.flight.then(run).then(r => { if (r?.out) this.touch(sha); return r; }).finally(() => jobs.delete(out));
    this.flight = job.catch(() => {});
    jobs.set(out, job);
    return job;
  }
  // 캐시 폴더 mtime 갱신 — main.js 가 mtime 이 낡은 ${cacheDir}/<sha> 를 지운다. 조용히 실패해도 된다(다음 열기에 다시).
  touch(sha) { exec("touch", ["-c", `${this.cacheDir}/${sha}`]).catch(() => {}); }
  // 홈 폴더 실제 경로(프로필의 deny subpath) — 한 번만 알아 두고 캐시. 못 알면 null(→ 격리 프로필을 못 만들어 PDF 를 열지 않는다).
  async homeDir() {
    if (this.homeReal) return this.homeReal;
    const r = await exec("sh", ["-c", 'cd -P "$HOME" && pwd -P']).catch(() => null);
    const h = r?.code === 0 ? r.stdout.trim() : "";
    if (h.startsWith("/") && h !== "/") this.homeReal = h;
    return this.homeReal;
  }
  async pdfRender(src, sha, dir, out, i, known, gen) {
    const pf = `${dir}/pages`;
    await exec("mkdir", ["-p", dir]);
    const hit = await exec("sh", ["-c", '[ -s "$1" ] || exit 1; cat "$2" 2>/dev/null; exit 0', "sh", out, pf]);
    if (hit.code === 0) { const n = Number(hit.stdout.trim()); if (n >= 1) return { out, pages: n, page: i }; if (known >= 1) return { out, pages: known, page: i }; }
    if ((await exec("test", ["-x", SANDBOX_EXEC])).code !== 0) return null;
    // 임시 폴더: 캐시 폴더의 실제 경로(pwd -P) 아래 — 프로필의 subpath 는 실제 경로여야 맞는다. 쓰기는 이 폴더 안으로만 허용된다.
    // 읽기 허용 폴더 = ${cacheDir}/${sha} 의 실제 경로: 원본 PDF(그 안)와 임시 폴더(view 아래)를 모두 품는다. view 가 밖으로 새는 링크면(임시 폴더가 그 아래가 아니면) 실패.
    const mk = await exec("sh", ["-c", 'd=$(cd -P "$1" && pwd -P) && r=$(cd -P "$2" && pwd -P) && case "$d" in "$r"/*) ;; *) exit 1;; esac && t=$(mktemp -d "$d/.tmp.XXXXXX") && printf "%s\n%s" "$t" "$r"', "sh", dir, `${this.cacheDir}/${sha}`]);
    const [tmp = "", readDir = ""] = mk.code === 0 ? mk.stdout.split("\n") : [];
    const home = tmp ? await this.homeDir() : null;
    const prof = home ? sandboxProfile(tmp, { home, read: readDir }) : null;
    // 프로필을 못 만들면(이상한 경로 · 홈 모름) 격리 없이 돌리지 않는다. tmp 가 만들어졌으면 치운다.
    if (!prof) { if (tmp) await exec("rm", ["-rf", tmp]).catch(() => {}); return null; }
    try {
      // [경고] 믿을 수 없는 PDF 를 PDFKit 로 연다 — 네트워크 거부 · tmp 밖 쓰기 거부 · 홈 읽기 거부(캐시 폴더만 허용) · fork/exec/LaunchServices 거부 프로필 아래에서만 실행. 샌드박스 없이 osascript 로 PDF 를 열지 말 것.
      // [주의] 외부 프로세스 — 60 s 타임아웃(큰 PDF · 멈춘 PDFKit). 타임아웃이면 실패로 본다.
      if (this.closed || this.gen !== gen) throw new Error("취소했다");   // 준비하는 사이 다른 파일로 넘어갔으면 60 s 짜리 렌더를 시작하지 않는다
      // [경고] 원본은 실제 경로(readDir)로 넘긴다 — 홈 읽기 거부 프로필은 홈 안의 심볼릭 링크(stow 식 dotfiles)를 지나는 경로 조회도 막아 논리 경로면 «pdf open failed».
      const r = await exec(SANDBOX_EXEC, renderArgv(prof, readDir, src.split("/").pop(), tmp, i), { timeout: 60000 });
      const o = r.code === 0 ? parsePdfOut(r.stdout) : null;
      if (!o) throw new Error(PDF_FAIL);
      if (o.w === 0 && o.h === 0) return { out: null, pages: o.pages, page: i };   // 범위 밖(그림 없음)
      if (o.w < 1 || o.h < 1) throw new Error(PDF_FAIL);
      const mv = await exec("sh", ["-c", '[ -s "$1/o.png" ] && mv -f "$1/o.png" "$2" && printf %s "$3" > "$1/pages" && mv -f "$1/pages" "$4"', "sh", tmp, out, String(o.pages), pf]);
      if (mv.code !== 0) throw new Error(PDF_FAIL);
      return { out, pages: o.pages, page: i };
    } finally { await exec("rm", ["-rf", tmp]).catch(() => {}); }
  }
  pdfPaged() { return Boolean(this.pdf && this.pdf.pages > 1); }
  // 쪽 렌더 펌프(창당 하나만 돈다): 한 번에 한 쪽 — 원하는 쪽(want)이 있으면 그 쪽(중간 쪽은 건너뜀), 한가하면 다음 쪽 미리 만들기. 끝나면 스스로 다시 부른다.
  // 앞 파일의 결과는 gen · this.pdf 비교로 버린다.
  pump(p, gen, cx, fired = false) {
    if (this.closed || this.gen !== gen || this.pdf !== p) return;
    if (!fired) p.tok = (p.tok ?? 0) + 1;   // 활동 번호 — 쪽 넘김 · 렌더 끝마다 오른다(미리 만들기 타이머가 «그 뒤 400 ms 조용했나» 를 보는 데 쓴다)
    const step = nextRender(p, this.media?.state === "ready");
    if (!step) return;
    // [주의] 미리 만들기는 취소할 수 없다(exec 에 kill 없음 · 최대 60 s) → 마지막 활동 뒤 400 ms 조용할 때만 시작한다(디바운스): 타이머가 도는 사이 활동 번호가 바뀌었으면 다시 400 ms 기다린다. 깨어나면 gen · want 를 다시 본다.
    if (!step.show && !fired) {
      if (!p.timer) {
        p.timer = true;
        const arm = c0 => {
          const t0 = p.tok;
          this.later(c0, 400, c => {
            if (this.closed || this.gen !== gen || this.pdf !== p) { p.timer = false; return; }
            if (p.tok !== t0) { arm(c); return; }
            p.timer = false; this.pump(p, gen, c, true);
          });
        };
        arm(cx);
      }
      return;
    }
    const { to, show } = step, kind = this.media?.kind ?? "doc";
    const live = () => !this.closed && this.gen === gen && this.pdf === p;
    p.busy = true;
    if (!show) p.pre.add(to);
    cx.spawn(async cx => {
      let media = null;
      try {
        const r = await this.pdfPage(p.src, p.sha, to, p.pages, gen);
        if (show && live() && p.want === to) {
          if (!r?.out) throw new Error(PDF_FAIL);
          const v = await this.look(r.out);
          media = v.note ? { kind, state: "error", note: v.note }
            : { kind, state: "ready", rel: r.out.slice(appHome().length + 1), size: v.size, bytes: p.bytes, note: null };
        }
      } catch { if (show && live() && p.want === to) media = { kind, state: "error", note: `${to + 1}쪽을 그릴 수 없다 · 다른 쪽으로 넘겨 본다` }; }
      finally {
        p.busy = false;
        if (live()) {
          if (media && p.want === to) {   // 그 사이 다른 쪽을 원하게 됐으면(want 변경) 이 결과는 버린다 → 아래 pump 가 새 쪽을 만든다
            if (media.state === "ready") p.page = to;   // 실패한 쪽은 «보던 쪽» 으로 남기지 않는다 → 다시 열기(reopenProps)가 좋은 쪽을 잇는다
            p.want = null;
            this.media = media; this.zoom = null; this.px = null; this.py = null; this.drag = null; this.wheel = 0; this.pw = 0;
          }
          cx.notify();
          this.pump(p, gen, cx);
        }
      }
    });
  }
  // PDF 쪽 넘기기(d = ±1): 목표 쪽은 연달아 눌러도 쌓이지만(want) 렌더는 하나씩 — 중간 쪽은 건너뛴다. 지금 쪽으로 돌아오면 want 는 비운다.
  turn(d, cx) {
    const p = this.pdf;
    if (!p || p.pages < 2) return;
    const cur = p.want ?? p.page, to = Math.min(p.pages - 1, Math.max(0, cur + d));
    if (to === cur) return;
    p.want = to === p.page ? null : to;
    cx.notify();
    this.pump(p, this.gen, cx);
  }

  // macOS 에서만: HEIC 등은 sips 로 PNG, 문서는 빠른 보기(qlmanage -t)로 첫 쪽 PNG.
  // 같은 폴더의 임시 폴더에 만든 뒤 mv 로 자리에 놓는다 — A→B→A 로 겹쳐 돌아도 반쯤 쓴 PNG 가 사본으로 남지 않는다.
  async convert(kind, src, sha) {
    const dir = `${this.cacheDir}/${sha}/view`, base = src.split("/").pop();
    await exec("mkdir", ["-p", dir]);
    const out = `${dir}/${base}.png`;
    if ((await exec("sh", ["-c", '[ -s "$1" ]', "sh", out])).code === 0) return out;
    const script = `dir=$1; src=$2; out=$3; kind=$4
tmp=$(mktemp -d "$dir/.tmp.XXXXXX") || exit 1
trap 'rm -rf "$tmp"' EXIT
name=\${out##*/}
if [ "$kind" = convert ]; then sips -s format png "$src" --out "$tmp/$name"; else qlmanage -t -s 1600 -o "$tmp" "$src"; fi
[ -s "$tmp/$name" ] && mv -f "$tmp/$name" "$out"`;
    const r = await exec("sh", ["-c", script, "sh", dir, src, out, kind], { timeout: 120000 });
    if ((await exec("sh", ["-c", '[ -s "$1" ]', "sh", out])).code !== 0) throw new Error(`${kind === "convert" ? "sips" : "빠른 보기"}가 그림을 못 만들었다 ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
    return out;
  }

  async close(_cx) {
    this.closed = true; this.gen++;
    try { this.killFrame(readShared(shared, KEY.resize(this.p.owner))); } catch { /* 종료 중 */ }   // 미리보기가 닫히면 틀도 같이(남은 투명 전체 창 방지)
    try { this.selfCheck?.cancel(); } catch { /* 이미 끝남 */ }
    for (const t of this.tasks ?? []) { try { t.cancel(); } catch { /* 이미 끝남 */ } }
    this.tasks?.clear();
    this.code?.release(); this.code = null;
    // 크게 보기로 새 창이 열렸으면 키는 새 id — 자기 id 일 때만 지운다.
    try { const id = this.overlayId; if (id && previewId(readShared(shared, previewKey(this.p.owner))) === id) setShared(previewKey(this.p.owner), null); } catch { /* 종료 중 */ }
  }

  step(d, cx) { const i = this.index + d; if (i >= 0 && i < this.files.length) this.go(i, cx); }
  shut() { const id = this.overlayId; if (id) closeOverlay(id); }
  ask(action) {
    if (!this.files.length) return;
    // 패널이 닫혔으면(jobs 키가 치워짐) 요청은 아무도 처리하지 않는다 → 알린다(요청 키도 되살리지 않는다).
    if (!alive(shared, this.p.owner)) { notify({ title: "파일+ 패널이 닫혀 있다", body: "내려받기·열기를 처리할 패널이 없다", level: "warning" }); return; }
    send(shared, setShared, this.p.owner, "preview", action, { abs: this.abs, name: this.name, on: this.on });
  }
  toPage() {
    run("pane.split", { direction: "right", mod: "html-viewer", props: { space: this.p.space, machine: this.on ?? null, file: this.abs } });   // html-viewer 는 «machine» 이 있으면 그 머신의 파일로 연다(없으면 space 의 머신 → 패널과 다를 수 있다)
    this.shut();
  }

  // 아이콘 줄 단추: 눌러도 뒤로 번지지 않는다.
  tool(id, file, label, t, onClick, on = false, off = false) {
    return h_flex().id(id).w(32).h(32).flex_none().items_center().justify_center().rounded(6).cursor_pointer()
      .bg(on ? t.selected : "#00000000").text_color(on ? t.accent : t.dim)
      .hover(s => s.bg(t.hover).text_color(on ? t.accent : t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); })
      .when(off, el => el.opacity(0.35))
      .tooltip(label)
      .child(svg(icon(file)).size(18).flex_none());
  }

  // ---- 바닥 줄 알림(1.6초) · 경로 복사 · 크게 보기 · 링크. 타이머는 cx.timer.after 만 쓴다(전역 setTimeout 없음).
  flash(msg, cx) {
    const tok = ++this.noteTok; this.note = msg; cx.notify();
    cx.timer.after(1600, c => { if (!this.closed && this.noteTok === tok) { this.note = null; c.notify(); } });
  }
  fullPath() { return this.on ? `${this.on}:${this.abs}` : this.abs; }   // 원격이면 `<머신>:/경로`
  copyPath(cx) {
    if (!this.files.length) return;
    const path = this.fullPath();
    // 이름에 줄바꿈·제어문자가 있으면 터미널에 붙여 넣는 순간 명령이 실행될 수 있다(pastejacking) → 복사하지 않는다.
    if (/[\u0000-\u001f\u007f-\u009f]/.test(path)) { notify({ title: "복사할 수 없는 이름", body: "경로에 줄바꿈·제어 문자가 들어 있다", level: "warning" }); this.flash("복사할 수 없는 이름", cx); return; }
    cx.write_to_clipboard(path);
    this.flash("경로를 복사했다", cx);
  }
  // 같은 창을 0.98 ↔ 0.82 로 다시 연다(같은 파일 · 확대 · 칸 · 렌더 상태). 가운데에서 새로 열고(자리를 기억하지 않는다) 그 뒤 자신을 닫는다 — 새 id 는 shared 의 previewKey 에 적혀 주인(main.js)이 읽는다.
  // 다시 열 때 넘기는 props(크게 보기 · 크기 조절 · 기본 크기가 같은 것을 쓴다). rect 는 한 번만 쓰는 것 → 남기지 않는다(F 로 크게 → 다시 F 는 기억된 크기로 가운데).
  reopenProps(full) {
    const p = { ...this.p }; delete p.overlay; delete p.rect;
    const rawFiles = Array.isArray(this.p.files) ? this.p.files : [];
    return { ...p, files: rawFiles, index: Math.max(0, rawFiles.indexOf(this.name)), full,
      page: this.pdf ? (this.pdf.want ?? this.pdf.page) : 0,   // PDF 면 보던 쪽 · 새 창이 첫 파일에서 그 쪽을 연다(범위 밖이면 0)
      zoom: this.zoom === null ? "fit" : this.zoom, list: this.showList, info: this.showInfo, raw: this.raw };
  }
  toggleFull(cx) {
    if (!this.files.length) return;
    openPreviewWindow(this.reopenProps(!this.full), !this.full, this.overlayId ?? "");
  }

  // ---- 창 크기 조절: 호스트 overlay 는 크기를 못 바꾼다 → 끄는 동안만 투명한 «크기 틀»(ResizeFrame) 창을 앱 전체에 띄워 마우스를 받고, 놓으면 새 크기로 다시 연다.
  // 현재 창 사각형(앱 창 px): 루트 on_mouse_move 의 bounds(테두리 안쪽) + BORDER. 아직 못 봤으면(손잡이에 바로 닿은 경우) 손잡이 bounds + rootSize 로 맞춘다.
  // [주의] 폴백은 rootSize 가 테두리 안쪽 크기라고 가정(미확인) — 틀리면 처음 크기가 2px 어긋날 뿐.
  winRect(axis, hb) {
    const b = this.rootBounds;
    if (b && b.width > 0 && b.height > 0) return { x: b.x - BORDER, y: b.y - BORDER, w: b.width + 2 * BORDER, h: b.height + 2 * BORDER };
    const s = this.rootSize;
    if (!hb || !s || !(s.w > 0 && s.h > 0)) return null;
    const w = s.w + 2 * BORDER, h = s.h + 2 * BORDER, right = hb.x + hb.width + BORDER, bottom = hb.y + hb.height + BORDER;
    return { x: axis === "y" ? hb.x - BORDER : right - w, y: axis === "x" ? hb.y - BORDER : bottom - h, w, h };
  }
  beginResize(axis, e, cx) {
    cx.stop_propagation();    // 호스트가 창을 끌지 않게
    if (!this.files.length) return;
    if (axis === "xy" && e.click_count >= 2) {   // 모서리 더블클릭 = 기억 크기 지우고 기본(0.82) 가운데로
      try { setShared(KEY.previewSize, null); } catch { /* 못 지우면 이번 열기만 기본 */ }
      openPreviewWindow(this.reopenProps(false), false, this.overlayId ?? "");
      return;
    }
    const start = this.winRect(axis, e.bounds);
    if (!start || !Number.isFinite(e.position?.x) || !Number.isFinite(e.position?.y)) return;   // 모르면 아무것도 안 함
    // [경고] 이 전체 창이 안 닫히고 남으면 앱 전체 클릭이 막힌다 → ResizeFrame 이 Esc · 아무 클릭 · 15 s 무동작 · 주인 죽음 넷 모두로 스스로 닫는다.
    try {
      this.frameId = openOverlay({ mod: NAME, kind: "window", frame: "none", width: 1, height: 1, at: { x: 0, y: 0 },
        props: { mode: "preview-resize", owner: this.p.owner, axis, start, p0: { x: e.position.x, y: e.position.y }, previewId: this.overlayId ?? "", reopen: this.reopenProps(false) } });
      // 틀이 자기 id 를 props().overlay 로 못 읽는 경우를 위해 열린 id 를 키에 미리 둔다(at 0 = «아직 살아 있다는 표시 아님» → 틀이 안 뜨면 2 s 뒤 낡은 키로 보고 틀을 닫는다 · 틀이 뜨면 같은 모양으로 at 을 써 넣는다).
      if (typeof this.frameId === "string" && this.frameId && this.p.owner && this.overlayId) {
        try { setShared(KEY.resize(this.p.owner), resizeEntry(this.overlayId, this.frameId, 0)); } catch { /* 틀이 직접 쓴다 */ }
      }
      this.resizePending = { at: Date.now(), seen: false };     // 틀이 끝나면(키가 사라지면) checkResize 가 포커스를 되찾는다
    } catch { /* 틀을 못 열면 크기를 못 바꿀 뿐 */ }
  }
  // 손잡이 하나(절대 위치 · 루트의 맨 마지막 자식 → 위에 그려진다).
  grip(id, axis, t, place, mark = null) {
    const el = place(div().id(id).absolute().flex_none())
      .on_mouse_down("left", (e, cx) => this.beginResize(axis, e, cx));
    const cur = axis === "x" ? el.cursor_ew_resize() : axis === "y" ? el.cursor_ns_resize() : el.cursor_nwse_resize();
    return mark ? cur.child(mark) : cur;
  }

  // ---- 글자 크기: kind = 렌더 md → "md" · 그 밖(원문 · 코드 · 글자 파일 Editor) → "code". 바꾸면 shared 에 저장(다음 열기 · 다른 창도 같은 크기) + 바닥줄 알림.
  fontKind() { return this.rendered() ? "md" : "code"; }
  // held = 키 반복: 끝(9 · 32)이나 기본에서 값이 안 바뀌면 다시 알리지 않는다(첫 눌림만).
  setFont(dir, cx, held = false) {
    if (!this.textual()) return;
    const kind = this.fontKind(), cur = this.font[kind], next = stepFont(cur, dir, kind);
    if (next === cur) { if (!held) this.flash(`글자 ${next}px${dir ? (dir > 0 ? " (최대)" : " (최소)") : ""}`, cx); return; }
    // 저장 직전에 shared 를 다시 읽어 이 종류(kind)만 바꾼다 — 다른 창이 바꾼 다른 종류의 값을 낡은 사본으로 덮지 않게.
    // 병합으로 «다른 종류» 의 값이 바뀌어도(다른 창이 바꾼 값) 메모리 값이 곧 보이는 크기 · «기본» 아이콘 상태 → 아래에서 Editor 도 같은 크기로 맞춘다.
    this.font = { ...fontOf(readShared(shared, KEY.fontSize)), [kind]: next };
    try { setShared(KEY.fontSize, this.font); } catch { /* 저장 못 해도 이 창은 바뀐다 */ }
    // [주의] Editor 는 font_size 를 만들 때만 받는다 → EditorState 를 새로 만들어 바꾼다. 스크롤이 맨 위로 돌아간다. 렌더 안이 아니라 키·클릭 핸들러에서만 만든다(VM 확인).
    // 만들어진 Editor 의 크기(codeBuilt)가 code 값과 다르면(이번에 code 를 바꿨거나, 병합으로 다른 창의 code 값이 들어왔거나) 다시 만든다 — 렌더 md 를 보는 중이어도 «M» 으로 원문을 보일 때 맞는 크기.
    if (this.codeSrc && this.code && this.codeBuilt !== this.font.code) {
      try { const old = this.code; this.code = EditorState.new({ ...this.codeSrc, font_size: this.font.code }); this.codeBuilt = this.font.code; old?.release(); } catch { /* 못 만들면 옛 상태 유지 */ }
      if (kind === "code") this.refocus(cx);
    }
    this.flash(`글자 ${next}px`, cx);
  }
  // http(s) 절대 주소만 연다. 나머지(상대 · file: · javascript: · 공백/제어문자 포함)는 아무것도 하지 않고 알린다. 자동으로 열지 않는다.
  openLink(url, cx) {
    const ok = typeof url === "string" && url.length <= 2048 && /^https?:\/\/[^\s\u0000-\u001f\u007f]+$/i.test(url);
    if (!ok || !this.mac) { this.flash(ok ? "링크는 Mac 앱에서만 연다" : "열 수 없는 링크", cx); return; }
    exec("open", [url]).catch(() => {});
  }

  // ---- 확대·축소·이동: 크기는 this.box 와 this.zoom/px/py 로만 계산한다(내용 무관 · 애니메이션 없음).
  canZoom() { const m = this.media; return Boolean(m && m.state === "ready" && m.size && m.size.w > 0 && m.size.h > 0 && this.box.w > 0 && this.box.h > 0); }
  area() { return { w: this.box.w, h: Math.max(0, this.box.h - 24) }; }     // 그림 칸 = 본문 − 캡션(20) − 간격(4)
  fitScale() {
    const s = this.media.size, bw = Math.max(40, this.box.w - 24), bh = Math.max(40, this.box.h - 24 - 24);
    return Math.min(1, bw / s.w, bh / s.h);
  }
  scale() { return this.zoom ?? this.fitScale(); }
  dims() { const s = this.media.size, k = this.scale(); return { iw: Math.max(1, Math.round(s.w * k)), ih: Math.max(1, Math.round(s.h * k)) }; }
  // 그림 왼쪽 위(칸 기준): 칸보다 작으면 가운데 · 크면 화면 밖으로 끌려 나가지 않게 가둔다.
  place(iw, ih) {
    const a = this.area(), ax = (p, A, I) => I <= A || p === null ? (A - I) / 2 : Math.min(0, Math.max(A - I, p));
    return { x: ax(this.px, a.w, iw), y: ax(this.py, a.h, ih) };
  }
  larger() { if (!this.canZoom()) return false; const a = this.area(), { iw, ih } = this.dims(); return iw > a.w || ih > a.h; }
  // 배율 바꾸기: 기준점(칸 좌표) 아래의 그림 점이 그대로 있게 한다. 기준을 모르면 칸 가운데.
  setZoom(next, anchor, cx) {
    if (!this.canZoom()) return;
    if (next === this.zoom) return;
    if (next === null) { this.zoom = null; this.px = null; this.py = null; this.wheel = 0; cx.notify(); return; }
    const a = this.area(), s0 = this.scale(), { iw, ih } = this.dims(), cur = this.place(iw, ih);
    const ax = Number.isFinite(anchor?.x) ? anchor.x : a.w / 2, ay = Number.isFinite(anchor?.y) ? anchor.y : a.h / 2;
    const ux = (ax - cur.x) / s0, uy = (ay - cur.y) / s0;
    this.zoom = next; this.px = ax - ux * next; this.py = ay - uy * next;
    cx.notify();
  }
  zoomBy(d, cx, anchor) {
    if (!this.canZoom()) return;
    const cur = this.scale(), eps = 1e-6;
    let next = cur;
    for (let i = Math.abs(d); i > 0; i--) {
      const n = d > 0 ? ZOOMS.find(l => l > next + eps) : ZOOMS.findLast(l => l < next - eps);
      if (n === undefined) break;
      next = n;
    }
    if (next !== cur) this.setZoom(next, anchor, cx);
  }
  zoomFit(cx) { this.wheel = 0; this.setZoom(null, null, cx); }
  panTo(x, y) { const { iw, ih } = this.dims(); this.px = x; this.py = y; const p = this.place(iw, ih); this.px = p.x; this.py = p.y; }

  // 그림 칸 입력: 끌기(왼쪽) · 휠 · 더블클릭.
  picDown(e, cx) {
    cx.stop_propagation();    // 그림 칸은 이동·더블클릭에 쓴다 → 창이 끌려가지 않게(창은 머리줄·바닥줄로 끈다). 겉 요소의 자동 포커스도 막히므로 직접 건다.
    this.handle.focus();
    if (!this.canZoom()) return;
    if (e.click_count >= 2) { this.drag = null; this.setZoom(this.zoom === null ? 1 : null, e.local_position, cx); return; }
    if (!this.larger()) return;
    const { iw, ih } = this.dims(), c = this.place(iw, ih);
    this.drag = { x: e.position.x, y: e.position.y, px: c.x, py: c.y };
    cx.notify();
  }
  picMove(e, cx) {
    if (!this.drag) return;
    // 누른 단추는 이벤트에 없다 → 우리가 쥔 drag 상태로만 판단하고, 놓음 · 칸 밖으로 나감에서 반드시 푼다.
    this.panTo(this.drag.px + e.position.x - this.drag.x, this.drag.py + e.position.y - this.drag.y);
    cx.notify();
  }
  picUp(cx) { if (this.drag) { this.drag = null; cx.notify(); } }
  // PDF 쪽 넘기기 휠(위로 = 앞 쪽): 누적 NOTCH_PX 마다 한 쪽. 쪽 그리기 실패 화면에서도 쓴다(그림이 없어도 다른 쪽으로 넘길 수 있게).
  pageWheel(e, cx) {
    if (!this.pdfPaged()) return;
    cx.stop_propagation();
    if (e.touch_phase === "started") this.pw = 0;
    this.pw += e.delta_lines ? e.delta_lines.y * NOTCH_PX : (e.delta?.y ?? 0);
    if (Math.abs(this.pw) >= NOTCH_PX) { const d = this.pw > 0 ? -1 : 1; this.pw = 0; this.turn(d, cx); }
  }
  picWheel(e, cx) {
    if (!this.canZoom()) return;
    const mo = e.modifiers;
    // 누적은 한 제스처 안에서만: 수식키가 없거나 새 제스처가 시작되면 남은 조각을 버린다(앞의 30 px + 뒤의 15 px 가 한 단계로 합쳐지지 않게).
    if (!(mo && (mo.platform || mo.control)) || e.touch_phase === "started") this.wheel = 0;
    if (e.touch_phase === "started") this.pw = 0;
    if (mo && (mo.platform || mo.control)) {
      cx.stop_propagation();
      // 줄 단위 장치는 한 칸 = 한 단계 · 트랙패드(픽셀)는 누적해 NOTCH_PX 마다 한 단계. 위로 굴리면(양수) 확대.
      const dy = e.delta_lines ? e.delta_lines.y * NOTCH_PX : e.delta.y;
      this.wheel += dy;
      const n = Math.trunc(this.wheel / NOTCH_PX);
      if (n !== 0) { this.wheel -= n * NOTCH_PX; this.zoomBy(n, cx, e.local_position); }
      return;
    }
    if (!this.larger()) { this.pageWheel(e, cx); return; }   // 다 들어오면: PDF 면 휠 한 번에 한 쪽 · 아니면 할 일 없다
    cx.stop_propagation();
    const { iw, ih } = this.dims(), c = this.place(iw, ih);
    this.panTo(c.x + (e.delta?.x ?? 0), c.y + (e.delta?.y ?? 0));
    cx.notify();
  }

  // 글자 칸이 키보드를 쥐고 있나: 겉 요소(handle)가 직접 쥐고 있지 않으면 Editor/TextView 안이다.
  contentFocused() { return !this.handle.is_focused(); }
  textual() { return !this.media && !this.error && Boolean(this.code); }
  // 지금 렌더된 마크다운(TextView)을 보여 주는 중인가 — body() 의 분기와 같아야 한다.
  rendered() { return this.textual() && this.md && !this.raw && this.mdText !== null; }

  body(t) {
    const m = this.media;
    if (!this.files.length) return div().p(14).text_color(t.dim).child("파일 없음");
    if (this.error) return div().p(14).text_color(t.dim).child(this.error);
    if (!m) {
      if (!this.code) return div().p(14).text_color(t.dim).child("불러오는 중…");
      if (this.md && !this.raw && this.mdText !== null)
        // [주의] 글자 크기는 부모 div 의 text_size 를 TextView 가 물려받는 방식(VM 확인: 제목 · 문단 · 목록 · 코드가 같이 커진다). window.set_rem_size 는 앱 전체가 바뀌므로 금지.
        return div().id("fp-md").size_full().min_h(0).min_w(0).overflow_hidden().px(16).py(10).text_size(this.font.md)
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())     // 글을 고르다 창이 끌려가지 않게(머리줄·바닥줄이 끄는 자리)
          .child(TextView.markdown(`fp-md-${this.gen}`, this.mdText).selectable(true).scrollable(true).size_full()
            .on_link_click((url, cx) => this.openLink(url, cx)));
      return div().id("fp-code").size_full().min_h(0).min_w(0)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())       // Editor 가 먼저 받는다(캐럿·선택) → 여기서 창 끌기만 막는다
        .child(Editor.new(this.code).size_full().min_h(0).min_w(0));
    }
    if (m.state === "loading") {
      const pct = m.total ? Math.min(100, Math.floor((100 * (m.done ?? 0)) / m.total)) : 0;
      const fill = Math.round(pct / 12.5);
      return div().p(14).text_color(t.dim).child(m.total
        ? `받는 중  ${"▓".repeat(fill)}${"░".repeat(8 - fill)} ${pct}%  (${human(m.done ?? 0)} / ${human(m.total)})` : "받는 중…");
    }
    if (m.state === "error") {
      // 쪽 그리기 실패(PDF): 다른 쪽으로 넘길 길을 둔다 — 휠 · 쪽 캡션(PageUp/PageDown · 단추는 그대로).
      if (this.pdfPaged()) {
        const pg = this.pdf;
        return v_flex().id("fp-pic-err").size_full().min_h(0).min_w(0).overflow_hidden().gap(4)
          .on_scroll_wheel((e, cx) => this.pageWheel(e, cx))
          .child(div().flex_1().min_h(0).min_w(0).p(14).text_color(t.dim).child(m.note))
          .child(div().h(20).flex_none().flex().items_center().justify_center().text_size(11).text_color(t.dim).child(`${(pg.want ?? pg.page) + 1} / ${pg.pages}쪽${pg.want !== null ? "…" : ""}`));
      }
      return div().p(14).text_color(t.dim).child(m.note);
    }
    // 측정 전에는 그리지 않는다 → 작은 그림이 커지는 점프 없음. 크기는 늘어난 fp-body 상자와 zoom 으로만 계산(내용 무관).
    if (!(this.box.w > 0 && this.box.h > 0)) return div().size_full();
    const bw = Math.max(40, this.box.w - 24), bh = Math.max(40, this.box.h - 24 - 24);
    let img = image(m.rel).flex_none(), pct = null, view;
    const pg = this.pdf, pageLabel = pg ? `${(pg.want ?? pg.page) + 1} / ${pg.pages}쪽${pg.want !== null ? "…" : ""}` : null;
    const cap = [m.size ? `${m.size.w}×${m.size.h}` : null, human(m.bytes), m.note].filter(Boolean).join(" · ");
    if (m.size && m.size.w > 0 && m.size.h > 0) {
      const k = this.scale(), { iw, ih } = this.dims(), pos = this.place(iw, ih), big = this.larger();
      pct = `${this.zoom === null ? "맞춤 · " : ""}${Math.round(k * 100)}%`;
      view = div().id("fp-pic").relative().overflow_hidden().size_full().min_h(0).min_w(0)
        .when(big, el => this.drag ? el.cursor_grabbing() : el.cursor_grab())
        .on_scroll_wheel((e, cx) => this.picWheel(e, cx))
        .on_mouse_down("left", (e, cx) => this.picDown(e, cx))
        .on_mouse_move((e, cx) => this.picMove(e, cx))
        .on_mouse_up("left", (_e, cx) => this.picUp(cx))
        .on_hover((h, cx) => { if (!h) this.picUp(cx); })
        .child(img.w(iw).h(ih).absolute().left(pos.x).top(pos.y));
    } else {
      img = img.max_w(bw).max_h(bh);
      // 크기를 모르는 그림(svg · ico · tiff · pnm): 눌러도 창이 끌려가지 않게 막고, 겉 요소의 자동 포커스가 막히므로 직접 건다.
      view = v_flex().id("fp-pic").size_full().min_h(0).min_w(0).overflow_hidden().items_center().justify_center()
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.handle.focus(); })
        .child(img);
    }
    return v_flex().size_full().min_h(0).min_w(0).overflow_hidden().gap(4)
      .child(div().flex_1().min_h(0).min_w(0).child(view))
      .child(div().h(20).flex_none().flex().items_center().justify_center().text_size(11).text_color(t.dim).child([pageLabel, pct, cap].filter(Boolean).join(" · ")));
  }

  listPane(t) {
    return v_flex().id("fp-listpane").w(240).h_full().flex_none().min_h(0).border_r(1).border_color(t.border)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(div().h(28).flex_none().px(10).flex().items_center().text_size(11).text_color(t.dim).child(`같은 폴더 · ${this.files.length}개`))
      .child(v_flex().id("fp-list").flex_1().min_h(0).overflow_y_scrollbar().px(4).pb(4).children(this.files.map((f, i) => {
        const cur = i === this.index;
        return h_flex().id(`fp-file-${i}`).h(26).flex_none().px(6).gap(7).items_center().rounded(5).cursor_pointer()
          .bg(cur ? t.selected : "#00000000").hover(s => s.bg(cur ? t.selected : t.hover))
          .on_click((_e, cx) => this.go(i, cx))
          .child(svg(icon("file")).size(13).flex_none().text_color(t.muted))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(cur ? t.accent : t.foreground).child(f));
      })));
  }

  infoPane(t) {
    const name = this.name, kind = kindOf(name), m = this.media;
    const size = this.stat?.size ?? (m?.state === "ready" ? m.bytes : null);
    const mtime = this.stat?.mtime ? new Date(this.stat.mtime) : null;
    const pad = n => String(n).padStart(2, "0");
    const rows = [
      ["이름", name],
      size != null ? ["크기", human(size)] : null,
      ["종류", own(KIND_LABEL, kind) ?? "글자"],
      m?.state === "ready" && m.size ? ["치수", `${m.size.w}×${m.size.h}`] : null,
      ["위치", this.on ? `${this.on}:${this.abs}` : this.abs],
      mtime ? ["수정", `${mtime.getFullYear()}-${pad(mtime.getMonth() + 1)}-${pad(mtime.getDate())} ${pad(mtime.getHours())}:${pad(mtime.getMinutes())}`] : null,
    ].filter(Boolean);
    return v_flex().id("fp-info").w(220).h_full().flex_none().min_h(0).overflow_y_scrollbar().border_l(1).border_color(t.border).p(12).gap(10)
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.handle.focus(); })
      .children(rows.map(([k, v]) => v_flex().gap(2)
        .child(div().text_size(11).text_color(t.dim).child(k))
        .child(div().text_size(12).text_color(t.foreground).child(v))))
      .child(h_flex().id("fp-info-copy").h(28).flex_none().px(8).gap(6).items_center().justify_center().rounded(6).cursor_pointer().border_1().border_color(t.border)
        .text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); this.copyPath(cx); })
        .child(svg(icon("copy")).size(14).flex_none())
        .child(div().text_size(12).child("경로 복사")));
  }

  // 도움말 켜기·끄기. 도움말이 켜지면 본문(Editor/TextView)이 트리에서 빠진다 → 그 칸이 키보드를 쥐고 있었다면 포커스가 사라져
  // Esc 가 겉 요소(이 mod)로 오지 않아 키가 길을 잃는다(window 는 Esc 를 mod 에 준다). 그래서 바꾸는 즉시 겉 요소(handle)로 포커스를 되돌리고, 다시 그려진 뒤에도 한 번 더 건다.
  toggleHelp(cx) {
    this.help = !this.help;
    this.refocus(cx);
    cx.notify();
  }
  // Esc 로 도움말을 닫는다: 누르고 있던 Esc 가 곧바로 창까지 닫지 않게 300 ms 동안 Esc 를 삼킨다.
  closeHelpByEsc(cx) { this.toggleHelp(cx); this.escMuteUntil = Date.now() + 300; }
  // 원문 ↔ 렌더: 보이던 칸(Editor · TextView)이 트리에서 빠진다 → 포커스를 겉 요소로.
  toggleRaw(cx) { this.raw = !this.raw; this.refocus(cx); cx.notify(); }

  // 키 한 번을 처리했으면 true. 수식키 규칙: 글자 키는 ⌘/Ctrl/Alt 가 없을 때만(+ · ? 는 Shift 허용),
  // ⌘(Mac) 또는 Ctrl(Linux)이 눌린 것은 아래 명시한 ⌘O ⌘S ⌘C ⌘+ ⌘- ⌘0 만 쓴다.
  onKey(e, cx) {
    const mo = e.modifiers ?? {}, cmd = Boolean(mo.platform || mo.control), alt = Boolean(mo.alt), shift = Boolean(mo.shift);
    const k = String(e.key ?? "").toLowerCase(), ch = e.key_char ?? "";
    const plain = !cmd && !alt, bare = plain && !shift;
    const dk = k === " " ? "space" : k;
    if (Object.hasOwn(this.downSeen, dk)) this.downSeen[dk] = true;   // 루트가 이 키의 눌림을 봤다 → 키 뗌에서 다시 처리하지 않는다
    // 누르고 있는 키(is_held 반복): 이동·확대는 반복하되, 한 번만 해야 하는 동작(열기·내려받기·크게 보기·토글·복사)은 다시 쏘지 않는다.
    const held = e.is_held === true;
    const has = this.files.length > 0, text = this.textual();
    const isPlus = k === "+" || k === "=" || k === "plus" || k === "equal" || ch === "+";
    const isMinus = k === "-" || k === "minus" || ch === "-";
    if (k === "escape") {
      if (held) return true;
      if (Date.now() < this.escMuteUntil) { this.escMuteUntil = Date.now() + 300; return true; }   // 도움말을 막 닫았다 — 이어진 Esc 는 삼킨다(계속 눌린 동안은 삼킴이 이어진다)
      if (this.help) this.closeHelpByEsc(cx); else this.shut();
      return true;
    }
    if ((k === "?" || ch === "?" || (k === "/" && shift)) && plain) { if (held) return false; this.toggleHelp(cx); return true; }
    if (cmd && !alt) {                                  // 명시한 ⌘ 단축키만
      if (!has) return false;
      if (k === "o") { if (held) return false; this.ask("open"); return true; }
      if (k === "s") { if (held) return false; this.ask("download"); return true; }
      // 글자 칸에서 글을 고른 채 ⌘C 는 그 선택을 복사하게 둔다(칸이 키보드를 쥔 때) · 겉 요소가 쥐면 경로 복사.
      if (k === "c") { if ((text && this.contentFocused()) || held) return false; this.copyPath(cx); return true; }
      if (this.canZoom() && isPlus) { this.zoomBy(1, cx); return true; }
      if (this.canZoom() && isMinus) { this.zoomBy(-1, cx); return true; }
      if (this.canZoom() && k === "0") { this.zoomFit(cx); return true; }
      if (text && isPlus) { this.setFont(1, cx, held); return true; }                 // 글자 보기: 그림 확대와 같은 자리 · 누르고 있기 반복 허용
      if (text && isMinus) { this.setFont(-1, cx, held); return true; }
      if (text && k === "0") { this.setFont(0, cx, held); return true; }
      return false;
    }
    if (!plain) return false;
    if (this.canZoom() && isPlus) { this.zoomBy(1, cx); return true; }
    if (this.canZoom() && isMinus) { this.zoomBy(-1, cx); return true; }
    if (text && isPlus) { this.setFont(1, cx, held); return true; }
    if (text && isMinus) { this.setFont(-1, cx, held); return true; }
    if (!bare) return false;
    if ((k === "pagedown" || k === "pageup") && this.pdfPaged() && !this.help) { this.turn(k === "pagedown" ? 1 : -1, cx); return true; }   // PDF 쪽 넘기기(←→↑↓ 는 그대로 파일 넘기기)
    // 스크롤 키(↑ ↓ PageUp PageDown Home End):
    //  · 렌더된 마크다운(TextView): 키보드 스크롤이 없다 → 그림처럼 ↑ 이전 · ↓ 다음 · Home 처음 · End 끝 파일. PageUp/PageDown 은 할 일 없음.
    //  · Editor 글 칸(원문 · 코드 · 글자): 사용자가 글 칸을 눌러 포커스를 줬을 때만(contentFocused) 글 칸으로 흘려보낸다. 아니면 그림처럼 파일 넘기기.
    // (Editor 는 프로그램에서 포커스를 줄 수 없다 → 글 칸을 눌러야 한다. 위·아래 줄을 누르면 포커스가 겉 요소로 돌아온다.)
    // ←/→/스페이스는 어느 쪽이 포커스를 쥐어도 파일을 넘긴다(읽기 전용 칸이 가로채는지는 앱에서 확인 필요).
    const scrollKey = k === "up" || k === "down" || k === "pageup" || k === "pagedown" || k === "home" || k === "end";
    if (scrollKey && this.rendered()) { if (k === "pageup" || k === "pagedown") return true; }
    else if (scrollKey && text && this.contentFocused()) return false;
    else if (scrollKey && (k === "pageup" || k === "pagedown")) return false;
    if (k === "space" || k === " " || k === "right" || k === "down") { this.step(1, cx); return true; }
    if (k === "left" || k === "up") { this.step(-1, cx); return true; }
    if (k === "home") { this.go(0, cx); return true; }
    if (k === "end") { this.go(this.files.length - 1, cx); return true; }
    if (k === "enter" || k === "return") { if (!has || held) return false; this.ask("open"); return true; }
    if (k === "i") { if (held) return false; this.showInfo = !this.showInfo; cx.notify(); return true; }
    if (k === "l") { if (held) return false; this.showList = !this.showList; cx.notify(); return true; }
    if (k === "f") { if (held) return false; this.toggleFull(cx); return true; }
    if (k === "p" && kindOf(this.name) === "page" && this.viewer) { if (held) return false; this.toPage(); return true; }
    if (k === "m" && this.md && this.code) { if (held) return false; this.toggleRaw(cx); return true; }
    if (this.canZoom() && k === "0") { this.zoomFit(cx); return true; }
    if (text && k === "0") { this.setFont(0, cx, held); return true; }
    if (this.canZoom() && k === "1") { this.setZoom(1, null, cx); return true; }
    return false;
  }

  // 키 뗌 보정(C3): 글 칸(Editor)을 눌러 포커스가 거기 있으면 GPUI 가 Editor 의 키 바인딩(캐럿 이동)을 먼저 처리해 루트 on_key_down 이 ←/→/스페이스/Esc 를 못 본다.
  // 루트가 눌림을 못 봤고(downSeen) 글 칸이 포커스를 쥔 채 맨 키가 떼어지면 그 동작을 여기서 한다. ↑ ↓ PageUp PageDown Home End 는 건드리지 않는다(Editor 가 스크롤).
  //  · 눌림을 루트가 봤으면 이미 처리됐다 → 중복 방지(플래그만 푼다).
  //  · 이 창을 연 키의 뗌은 루트가 포커스를 쥔 때 오므로 contentFocused() 가 거짓 → 걸리지 않는다.
  //  · 수식키를 방금 바꿨으면(⌘← 로 캐럿을 옮기고 ⌘ 를 먼저 뗀 경우) 건너뛴다.
  onKeyUp(e, cx) {
    const k = String(e.key ?? "").toLowerCase(), dk = k === " " ? "space" : k;
    if (!Object.hasOwn(this.downSeen, dk)) return false;
    const seen = this.downSeen[dk];
    this.downSeen[dk] = false;
    // 크기 틀이 떠 있거나 막 닫혔다: 틀을 Esc 로 취소한 뒤의 Esc 뗌이 글 칸(Editor)으로 와서 미리보기를 닫지 않게 무시한다.
    if (dk === "escape" && (this.resizePending || Date.now() < this.resizeUntil)) return false;
    const mo = e.modifiers ?? {};
    if (seen || mo.platform || mo.control || mo.alt || mo.shift) return false;
    if (Date.now() - this.modAt < 250) return false;
    if (!this.contentFocused() || !this.files.length) return false;
    if (dk === "escape") {
      if (Date.now() < this.escMuteUntil) { this.escMuteUntil = Date.now() + 300; return true; }
      if (this.help) this.closeHelpByEsc(cx); else this.shut();
    }
    else if (dk === "left") this.step(-1, cx);
    else this.step(1, cx);   // right · space
    return true;
  }

  hint() {
    const base = "←→ 이동";
    if (this.media?.state === "error" && this.pdfPaged()) return `${base} · PageUp/PageDown 쪽 · ? 단축키 · Esc 닫기`;
    if (this.media) return this.canZoom() ? `${base}${this.pdfPaged() ? " · PageUp/PageDown 쪽" : ""} · +/− 확대 · 0 맞춤 · 1 실제 크기 · 끌어서 이동 · ? 단축키 · Esc 닫기` : `${base} · ? 단축키 · Esc 닫기`;
    if (this.rendered()) return `${base} · 휠로 스크롤 · +/− 글자 · M 원문/렌더 · ? 단축키 · Esc 닫기`;
    if (this.md && this.code) return `${base} · 글 칸을 누르면 ↑↓ 스크롤 · +/− 글자 · M 원문/렌더 · ? 단축키 · Esc 닫기`;
    if (this.textual()) return `${base} · 글 칸을 누르면 ↑↓ 스크롤 · +/− 글자 · ? 단축키 · Esc 닫기`;
    return `${base} · ? 단축키 · Esc 닫기`;
  }

  // 도움말: 본문 칸을 대신 채운다(절대 위치 아님 · 흐름 안). 포커스를 받지 않는다 — track_focus·focusable 없음, 눌러도 겉 요소로 되돌린다.
  helpPane(t) {
    return v_flex().id("fp-help").size_full().min_h(0).min_w(0).overflow_y_scrollbar().px(18).py(14).gap(6).text_size(12)
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.handle.focus(); })
      .child(div().text_size(14).font_semibold().child("단축키"))
      .child(div().text_size(11).text_color(t.dim).mb(6).child("? 또는 Esc 로 닫기"))
      .children(HELP.map(([k, d]) => h_flex().gap(14).items_start()
        .child(div().w(150).flex_none().whitespace_nowrap().text_color(t.accent).child(k))
        .child(div().flex_1().min_w(0).text_color(t.foreground).child(d))));
  }

  render(cx) {
    const t = theme(), name = this.name, kind = kindOf(name), m = this.media;
    const meta = [
      (this.stat?.size ?? (m?.state === "ready" ? m.bytes : null)) != null ? human(this.stat?.size ?? m.bytes) : null,
      m?.state === "ready" && m.size ? `${m.size.w}×${m.size.h}` : null,
      this.on,
    ].filter(Boolean).join("   ");
    const sep = () => div().w(20).h(1).my(4).bg(t.border);
    return v_flex().id("files-plus-preview").relative().track_focus(this.handle).size_full().min_h(0).rounded(6).overflow_hidden()
      // window 는 어둡게 하지 않는다 → 가장자리를 테두리(1px)와 그림자로 또렷하게. 위쪽 2px 강조띠는 아래 첫 자식.
      .bg(t.chrome ?? t.background).border_1().border_color(t.border).shadow_2xl().text_color(t.foreground).text_size(13)
      .on_key_down((e, cx) => { if (this.onKey(e, cx)) cx.stop_propagation(); })
      .on_key_up((e, cx) => { if (this.onKeyUp(e, cx)) cx.stop_propagation(); })
      .on_modifiers_changed(() => { this.modAt = Date.now(); })
      .on_mouse_up("left", (_e, cx) => this.picUp(cx))      // 크기 틀을 Esc 로 취소한 뒤 이어지는 mouse up 도 여기로 온다 → picUp 은 그림 끌기 중(drag)일 때만 일한다
      .on_mouse_move((e, _cx) => { if (e.bounds) this.rootBounds = e.bounds; })   // 창 사각형 기억(손잡이에 닿기 전에 루트 위를 지난다) · 다시 그리지 않는다
      .on_size_change((s, _cx) => { this.rootSize = { w: s.width, h: s.height }; })
      .child(div().h(2).flex_none().bg(t.accent))
      .child(h_flex().h(36).flex_none().px(14).gap(14).items_center().border_b(1).border_color(t.border)
        .on_mouse_down("left", () => this.handle.focus())
        .child(div().flex_none().max_w(420).truncate().font_semibold().child(name))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(meta))
        .child(this.tool("fp-close", "close", "닫기 (Esc)", t, () => this.shut())))
      .child(h_flex().flex_1().min_h(0).items_stretch()
        .when(this.showList, el => el.child(this.listPane(t)))
        .child(v_flex().id("fp-body").h_full().flex_1().min_w(0).min_h(0).overflow_hidden()
          .on_size_change((s, cx) => { if (Math.abs(s.width - this.box.w) >= 1 || Math.abs(s.height - this.box.h) >= 1) { this.box = { w: s.width, h: s.height }; cx.notify(); } })
          .child(this.help ? this.helpPane(t) : this.body(t)))
        .when(this.showInfo, el => el.child(this.infoPane(t)))
        .child(v_flex().id("fp-rail").w(44).h_full().flex_none().min_h(0).py(8).gap(4).items_center().overflow_y_scrollbar().border_l(1).border_color(t.border)
          .child(this.tool("fp-t-list", "list", "목록 (L)", t, (_e, cx) => { this.showList = !this.showList; cx.notify(); }, this.showList))
          .child(this.tool("fp-t-info", "info", "정보 (I)", t, (_e, cx) => { this.showInfo = !this.showInfo; cx.notify(); }, this.showInfo))
          .when(this.md && Boolean(this.code), el => el
            .child(this.tool("fp-t-md", this.raw ? "render" : "code", this.raw ? "렌더 보기 (M)" : "원문 보기 (M)", t, (_e, cx) => this.toggleRaw(cx))))
          .when(this.pdfPaged(), el => el
            .child(sep())
            .child(this.tool("fp-t-pprev", "chevron-up", "이전 쪽 (PageUp)", t, (_e, cx) => this.turn(-1, cx), false, (this.pdf.want ?? this.pdf.page) <= 0))
            .child(this.tool("fp-t-pnext", "chevron-down", "다음 쪽 (PageDown)", t, (_e, cx) => this.turn(1, cx), false, (this.pdf.want ?? this.pdf.page) >= this.pdf.pages - 1)))
          .when(this.canZoom(), el => el
            .child(sep())
            .child(this.tool("fp-t-zin", "zoom-in", "확대 (+)", t, (_e, cx) => this.zoomBy(1, cx)))
            .child(this.tool("fp-t-zout", "zoom-out", "축소 (−)", t, (_e, cx) => this.zoomBy(-1, cx)))
            .child(this.tool("fp-t-fit", "fit", "맞춤 (0)", t, (_e, cx) => this.zoomFit(cx), this.zoom === null))
            .child(this.tool("fp-t-100", "actual", "실제 크기 (1)", t, (_e, cx) => this.setZoom(1, null, cx), this.zoom === 1)))
          .when(this.textual(), el => el
            .child(sep())
            .child(this.tool("fp-t-fin", "zoom-in", "글자 크게 (+)", t, (_e, cx) => this.setFont(1, cx)))
            .child(this.tool("fp-t-fout", "zoom-out", "글자 작게 (−)", t, (_e, cx) => this.setFont(-1, cx)))
            .child(this.tool("fp-t-fdef", "fit", "글자 기본 (0)", t, (_e, cx) => this.setFont(0, cx), this.font[this.fontKind()] === FONT_DEFAULT[this.fontKind()])))
          .child(sep())
          .child(this.tool("fp-t-full", this.full ? "full-exit" : "full", this.full ? "보통 크기 (F)" : "크게 보기 (F)", t, (_e, cx) => this.toggleFull(cx), this.full))
          .child(this.tool("fp-t-copy", "copy", "경로 복사 (⌘C)", t, (_e, cx) => this.copyPath(cx)))
          .child(this.tool("fp-t-down", "download", "내려받기 (⌘S)", t, () => this.ask("download")))
          .child(this.tool("fp-t-open", "open", this.mac ? "Mac에서 열기 (Enter · ⌘O)" : "열기 (Enter)", t, () => this.ask("open")))
          .when(kind === "page" && this.viewer, el => el.child(this.tool("fp-t-page", "page", "페이지로 (P)", t, () => this.toPage())))
          .child(this.tool("fp-t-help", "keyboard", "단축키 (?)", t, (_e, cx) => this.toggleHelp(cx), this.help))))
      .child(h_flex().h(24).flex_none().px(14).items_center().border_t(1).border_color(t.border).text_size(11).text_color(this.note ? t.accent : t.dim)
        .on_mouse_down("left", () => this.handle.focus())
        .child(div().flex_1().min_w(0).truncate().child(this.note ?? this.hint()))
        .when(this.files.length > 0, el => el.child(div().flex_none().child(`${this.index + 1}/${this.files.length}`))))
      // 크기 손잡이 3개 — 맨 마지막 자식(위에 그려진다). 오른쪽 가장자리 · 아래 가장자리 · 오른쪽 아래 모서리(더블클릭 = 기본 크기).
      .child(this.grip("fp-g-x", "x", t, el => el.top(0).bottom(14).right(0).w(4)))
      .child(this.grip("fp-g-y", "y", t, el => el.left(0).right(14).bottom(0).h(6)))
      .child(this.grip("fp-g-xy", "xy", t, el => el.right(0).bottom(0).size(14).tooltip("끌어서 창 크기 · 두 번 누르면 기본 크기"),
        div().absolute().inset_0().child(div().absolute().right(3).bottom(3).w(8).h(1).bg(t.dim)).child(div().absolute().right(3).bottom(6).w(5).h(1).bg(t.dim))));
  }
}

// 크기 틀(mode "preview-resize"): 끄는 동안만 앱 전체를 덮는 투명 창. 미리보기 창 밖으로 끌어도 마우스를 받으려는 것이다.
// 끝(놓음 · 아무 클릭) → 기억 크기 저장 → 새 크기로 미리보기를 다시 열고 → 자신을 닫는다(한 번만). 취소(Esc · 15 s 무동작 · 주인 패널 죽음) → 자신만 닫는다.
// 움직임 없이 놓으면(제자리 클릭) 크기가 그대로 → 저장도 다시 열기도 하지 않고 닫기만 한다.
// [경고] 이 창이 남으면 앱 전체 클릭이 막힌다 → 닫기는 dismiss 한 곳으로만. closeOverlay 가 안 던져도 «닫혔다» 로 보지 않는다: 호스트가 close() 를 불러야만 닫힘(closed) — 그때까지 타이머를 끄지 않는다.
// 실패하면 0.5 s 마다 다시(최대 RETRY_MAX 번), 던지지 않았으면 1 s 마다 다시 불러 본다(최대 WATCH_MAX 번 · 호스트가 조용히 무시하는 경우) · 그 뒤에도 Esc · 클릭이 다시 시도한다. 미리보기도 키가 낡으면 이 틀을 한 번 더 닫는다.
// 열 때 shared 의 KEY.resize(owner) 에 {id: 미리보기 id, at} 를 쓰고 닫힐 때(어느 길이든) 지운다 — 미리보기가 이를 보고 포커스를 되찾는다. 쓰기는 열기·닫기 두 번뿐(setShared 는 모든 mod 를 다시 그린다).
const RETRY_MAX = 20;
const WATCH_MAX = 10;
export class ResizeFrame {
  constructor(init, cx) {   // [주의] 인자 이름을 props 로 두면 herdr 의 props() 를 가린다
    this.p = init ?? {};
    this.cx = cx;
    this.done = false;       // 끝났다(끝내기 · 취소) — 더는 움직임을 받지 않는다
    this.finished = false;   // finish 의 본 작업은 한 번만
    this.closed = false;     // 호스트가 close() 를 불렀다(= 유일한 닫힘 확인)
    this.called = false;     // 마지막 closeOverlay 가 던지지 않았다(확인은 아님)
    this.last = null; this.moveAt = Date.now();
    this.tasks = []; this.retry = null; this.tries = 0; this.keyOn = false; this.keyAt = 0;
    this.id0 = null;
    try { this.id0 = props()?.overlay ?? null; } catch { /* 열 때 id 를 못 읽음 — 닫을 때 다시 읽는다 */ }
    this.axis = "xy"; this.start = null; this.rect = null; this.handle = null;
    try {
      const s = this.p.start, f = Number.isFinite, p0 = this.p.p0;
      this.axis = ["x", "y", "xy"].includes(this.p.axis) ? this.p.axis : "xy";
      this.start = s && f(s.x) && f(s.y) && f(s.w) && f(s.h) ? { x: s.x, y: s.y, w: s.w, h: s.h } : null;   // 끌기 시작 때의 창 사각형(왼쪽 위 고정)
      this.rect = this.start;                                                                               // 지금 틀 사각형
      this.handle = cx.focus_handle();
      // 자기 id 를 props().overlay 로 못 읽었으면 미리보기가 키에 적어 둔 frame id 를 쓴다(닫기 재시도 · 키 쓰기가 overlayId 로 쓴다).
      if (!this.id0 && this.p.owner && this.p.previewId) { try { this.id0 = resizeFrameId(readShared(shared, KEY.resize(this.p.owner)), this.p.previewId); } catch { /* 없으면 Esc · 클릭 재시도 */ } }
      if (!this.start || !p0 || !f(p0.x) || !f(p0.y)) { this.dismiss(); return; }   // 시작 정보가 틀렸다 → 바로 닫는다
      this.last = { x: p0.x, y: p0.y };   // 눌린 자리에서 시작 → 처음 도착하는 같은 좌표 move 는 «움직임» 이 아니다
      if (this.p.owner && this.p.previewId) {
        try { this.writeKey(); this.keyOn = true; } catch { /* 키를 못 쓰면 미리보기가 포커스를 직접 못 되찾는다 — 클릭하면 돌아온다 */ }
      }
      // window 는 열릴 때 키보드를 받지 않는다 → 포커스를 건다(Esc 받으려고 · 첫 그리기 뒤에도 한 번 더).
      this.handle.focus();
      this.tasks.push(cx.timer.after(50, () => { if (!this.closed) this.handle.focus(); }));
      // 안전장치: 15 s 동안 움직임이 없으면 취소 · 주인 패널이 죽었으면(연속 두 번 확인) 취소.
      let gone = 0;
      this.tasks.push(cx.timer.every(500, () => {
        if (this.closed || this.done) return;
        if (Date.now() - this.moveAt > IDLE_MS) { this.dismiss(); return; }
        gone = !this.p.owner || alive(shared, this.p.owner) ? 0 : gone + 1;
        if (gone >= 2) this.dismiss();
      }));
    } catch { this.dismiss(); }   // 어떤 오류든 투명 전체 창을 남기지 않는다
  }
  // id: 호스트가 준 현재 값 → 열 때 읽어 둔 값 → props 로 받은 값 순.
  get overlayId() { let cur = null; try { cur = props()?.overlay ?? null; } catch { /* 아래 폴백 */ } return cur ?? this.id0 ?? this.p.overlay ?? null; }

  // 키 쓰기: 미리보기가 «틀이 살아 있다» 를 알게 한다. 끄는 동안 RESIZE_REFRESH_MS 마다(≤ 0.2/s) 새로 쓴다 — 안 그러면 긴 끌기(> IDLE_MS+5 s)가 «죽은 틀» 로 보인다.
  writeKey() {
    const now = Date.now();
    setShared(KEY.resize(this.p.owner), resizeEntry(this.p.previewId, this.overlayId, now));
    this.keyAt = now;
  }
  stopTasks() { for (const t of this.tasks) { try { t.cancel(); } catch { /* 이미 끝남 */ } } this.tasks = []; }
  stopRetry() { if (this.retry) { try { this.retry.cancel(); } catch { /* 이미 끝남 */ } this.retry = null; } }
  clearKey() {
    if (!this.keyOn) return;
    this.keyOn = false;
    try { setShared(KEY.resize(this.p.owner), null); } catch { /* 종료 중 — 미리보기는 낡은 at 도 «끝남» 으로 본다 */ }
  }
  // closeOverlay 를 한 번 시도 — 던지지 않으면 true 지만 closed 는 아니다(호스트의 close() 만 확인).
  tryClose() {
    if (this.closed) return true;
    try { const id = this.overlayId; if (!id) throw new Error("overlay id 없음"); closeOverlay(id); } catch { this.called = false; return false; }
    this.called = true;
    return true;
  }
  // 자신만 닫는다(모든 길이 여기로). [경고] 호스트의 close() 가 오기 전에는 멈추지 않는다: 던지면 0.5 s · 던지지 않았어도 1 s 마다 다시 부른다(조용히 무시하는 호스트 대비).
  dismiss() {
    this.done = true; this.finished = true;
    if (this.closed) return;
    this.tryClose();
    if (this.retry) return;
    this.tries = 0; this.watch = 0;
    try {
      let tick = 0;
      this.retry = this.cx.timer.every(500, () => {
        if (this.closed) { this.stopRetry(); return; }
        tick++;
        if (!this.called) { if (!this.tryClose() && ++this.tries >= RETRY_MAX) this.stopRetry(); return; }   // 던짐 → 0.5 s 마다(포기 뒤에도 Esc · 클릭이 다시 시도)
        if (tick % 2 === 0) { this.tryClose(); if (++this.watch >= WATCH_MAX) this.stopRetry(); }           // 안 던졌지만 close() 가 안 옴 → 1 s 마다 ≤ 10 번
      });
    } catch { /* 타이머도 못 만듦 — Esc · 클릭이 시도한다 */ }
  }
  move(e, cx) {
    if (this.done || !this.start) return;
    const x = e.position?.x, y = e.position?.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (this.last && this.last.x === x && this.last.y === y) return;      // 같은 좌표가 수십 번 반복해 온다(VM) → 바뀔 때만
    this.last = { x, y }; this.moveAt = Date.now();
    if (this.keyOn && this.moveAt - this.keyAt >= RESIZE_REFRESH_MS) { try { this.writeKey(); } catch { /* 다음 움직임에 */ } }
    let vp = null;
    try { vp = globalThis.window?.viewport_size?.() ?? null; } catch { vp = null; }   // 실패하면 절대 상한(ABS_MAX)만
    const r = dragRect(this.start, this.axis, x - this.p.p0.x, y - this.p.p0.y, vp);
    if (r) { this.rect = r; cx.notify(); }
  }
  finish(_cx) {
    if (this.finished) { this.dismiss(); return; }   // 이미 끝낸 뒤의 클릭 = 닫기 재시도(본 작업은 다시 하지 않는다)
    this.finished = true; this.done = true;
    const r = this.rect, s = this.start;
    if (!r || !s || (r.x === s.x && r.y === s.y && r.w === s.w && r.h === s.h)) { this.dismiss(); return; }   // 크기가 그대로(제자리 클릭 · 되돌려 놓음) = 취소
    try { setShared(KEY.previewSize, { w: r.w, h: r.h }); } catch { /* 못 저장하면 이번 열기만 이 크기 */ }
    try { openPreviewWindow({ ...(this.p.reopen ?? {}), rect: { x: r.x, y: r.y, w: r.w, h: r.h } }, false, this.p.previewId || null); } catch { /* 못 열면 옛 창이 그대로 남는다 */ }
    this.dismiss();
  }

  render(_cx) {
    const t = theme(), r = this.rect;
    const tint = typeof t.accent === "string" && /^#[0-9a-f]{6}$/i.test(t.accent) ? `${t.accent}22` : "#ffffff14";   // 아주 옅은 바탕
    let root = div().id("files-plus-resize").relative().size_full();
    if (this.handle) root = root.track_focus(this.handle);
    root = root
      .on_mouse_move((e, cx) => this.move(e, cx))
      .on_mouse_up("left", (_e, cx) => { cx.stop_propagation(); this.finish(cx); })
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.finish(cx); })     // 창 밖에서 놓쳐도 다음 클릭으로 끝낸다
      // 가운데 · 오른쪽 단추도 삼킨다 — 처리하지 않은 누름은 호스트가 창 끌기로 쓴다.
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.finish(cx); })
      .on_mouse_down("middle", (_e, cx) => { cx.stop_propagation(); this.finish(cx); })
      .on_key_down((e, cx) => { if (String(e.key ?? "").toLowerCase() === "escape") { cx.stop_propagation(); this.dismiss(); } });
    const shaped = this.axis === "x" ? root.cursor_ew_resize() : this.axis === "y" ? root.cursor_ns_resize() : root.cursor_nwse_resize();
    if (!r) return shaped;
    return shaped.child(div().absolute().left(r.x).top(r.y).w(r.w).h(r.h).border_2().border_color(t.accent).bg(tint)
      .flex().items_center().justify_center().text_size(16).text_color(t.accent).child(`${r.w} × ${r.h}`));
  }

  // 호스트가 창을 닫을 때(우리 closeOverlay · 바깥에서 닫음 모두).
  async close(_cx) {
    this.closed = true; this.done = true; this.finished = true;
    this.stopTasks(); this.stopRetry(); this.clearKey();   // 모든 타이머는 여기서만 끊는다
  }
}
