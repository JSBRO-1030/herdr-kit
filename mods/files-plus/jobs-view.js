// files-plus 전송 창(mode "jobs") — 막대 32px + 펼침 목록 + 기록 + 아이콘 4칸. 설계: docs/popups-design.md §5.
// 보여 주고 요청만 보낸다(전송은 패널이 돌린다). 데이터는 shared 에서 render 마다 읽는다(폴링 없음).
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, settings, shared, setShared, exec, home, openOverlay, closeOverlay, notify, props, window } from "herdr";
import { human } from "./kinds.js";
import { KEY, summary, bar, groupHistory, stateLabel, send, alive, readShared } from "./state.js";

const NAME = "files-plus";
// 창 key 에 주인을 넣는다: 패널이 둘이면 창도 둘(서로 바꿔치지 않는다).
export const winKey = owner => `files-plus-jobs/${owner}`;
export const W = 380, H_OPEN = 330, H_BAR = 32;
const COLLAPSE_MS = 5000;
const ACTIVE = new Set(["wait", "run", "verify"]);
const icon = n => `mods/${NAME}/${n}.svg`;

const arr = v => (Array.isArray(v) ? v : []);
const num = v => (Number.isFinite(v) ? v : null);
const str = v => (typeof v === "string" ? v : "");

// 게시된 작업 하나를 안전한 꼴로.
function cleanJob(j, i) {
  if (!j || typeof j !== "object") return null;
  return {
    id: j.id ?? i, dir: j.dir === "up" ? "up" : "down", name: str(j.name) || "?",
    total: num(j.total) ?? 0, done: num(j.done) ?? 0, state: str(j.state) || "wait",
    note: str(j.note), speed: num(j.speed), eta: num(j.eta), where: str(j.where), cancelling: j.cancelling === true,
  };
}

function etaText(s) {
  if (s == null || s < 0) return "";
  if (s >= 3600) return `${Math.floor(s / 3600)}시간`;
  if (s >= 60) return `${Math.floor(s / 60)}분`;
  return `${Math.ceil(s)}초`;
}

function clock(ms) {
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "";
}

export class JobsWindow {
  constructor(props, cx) {
    this.props = props ?? {};
    this.owner = str(this.props.owner);
    this.expanded = this.props.expanded !== false;
    this.history = this.props.history === true;      // 기록 보기(접기/펼치기로 다시 열어도 이어 간다)
    this.hovered = false;
    this.timer = null;
    this.openedAt = Date.now();
    // 열림 깃발: 창 수명에 두 번만 쓴다(init · close). 같은 key 로 바꿔 열면 옛 창 close 가 새 창 init 뒤에 올 수 있어
    // 토큰으로 «내 것일 때만» 지운다.
    this.token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    this.flag();
  }

  // 열림 깃발을 쓴다 — 패널이 살아 있을 때만(닫힌 패널이 치운 깃발을 창이 되살리지 않게). history 는 새 작업·칩이 기록 보기를 잇게 싣는다.
  flag() {
    if (this.owner && alive(shared, this.owner)) setShared(KEY.win(this.owner), { t: this.token, expanded: this.expanded, history: this.history });
  }

  async close(_cx) {
    this.timer?.cancel(); this.timer = null;
    if (this.owner && readShared(shared, KEY.win(this.owner))?.t === this.token) setShared(KEY.win(this.owner), null);
  }

  // 자기 overlay id: 기본 mod(confirm · prompt · toast)처럼 props() 에서 읽고, 없으면 init 때 받은 것.
  get overlayId() { return props()?.overlay ?? this.props.overlay; }
  get mac() { return window()?.platform === "macos"; }

  gone() { return !alive(shared, this.owner); }     // 패널이 닫혔다(jobs 키가 치워짐)

  snap() { return readShared(shared, KEY.jobs(this.owner)); }
  jobs() { return arr(this.snap()?.jobs).map(cleanJob).filter(Boolean); }
  // 스냅샷에서 잘려 나간 작업의 개수(1000개 드롭 등) — 요약·막대가 합쳐 센다.
  more() { const m = this.snap()?.more; return m && typeof m === "object" ? m : null; }

  // 스냅샷에서 잘려 나간 작업 중 아직 도는 것·대기·실패가 있나(보이는 작업만 보고 접으면 안 된다).
  moreBusy() { const m = this.more(), n = k => Math.max(0, num(m?.[k]) ?? 0); return n("wait") + n("run") + n("verify") + n("fail") > 0; }

  // 같은 key 로 다시 열면 그 자리에서 바뀐다.
  reopen(expanded) {
    const { overlay: _old, ...rest } = this.props;
    openOverlay({ mod: NAME, kind: "window", frame: "none", key: winKey(this.owner), width: W, height: expanded ? H_OPEN : H_BAR,
      props: { ...rest, expanded, history: this.history } });   // 옛 overlay id 를 물려주지 않는다(새 창이 자기 것을 받는다)
  }

  // 펼친 채 일이 없으면(실패도 없음) 5초 뒤 접는다. 마우스가 위에 있거나 기록 보기이거나 패널이 닫혔으면 접지 않는다.
  arm(cx, jobs) {
    const idle = this.expanded && !this.hovered && !this.history && !this.gone() && !jobs.some(j => ACTIVE.has(j.state) || j.state === "fail") && !this.moreBusy();
    if (!idle) { this.timer?.cancel(); this.timer = null; return; }
    if (this.timer) return;
    const wait = Math.max(COLLAPSE_MS, this.openedAt + COLLAPSE_MS - Date.now());
    this.timer = cx.timer.after(wait, () => {
      this.timer = null;
      // 상태가 그 사이 바뀌었으면 접지 않는다(render 가 다시 건다).
      const now = this.jobs();
      if (this.hovered || this.history || this.gone() || now.some(j => ACTIVE.has(j.state) || j.state === "fail") || this.moreBusy()) return;
      if (Date.now() - this.openedAt < COLLAPSE_MS) return;
      this.reopen(false);
    });
  }

  req(action, args) {
    if (this.gone()) { notify({ title: "파일+ 패널이 닫혀 있다", body: "전송 요청을 처리할 패널이 없다", level: "warning" }); return; }
    send(shared, setShared, this.owner, "jobs", action, args);
  }

  // 눌러도 창이 끌려가지 않게 하는 아이콘/글자 단추.
  // down = 왼쪽 «누름» 에서 바로 동작(되돌려도 무해한 토글용): 이 창이 다른 창(미리보기) 뒤에 있으면 첫 클릭은 창을 앞으로 가져오는 데만 쓰여 click 이 오지 않는다 → 누름에서 처리한다.
  // 지우기·취소 같은 되돌릴 수 없는 동작은 click 으로 둔다(누르고 밖으로 끌어 취소할 수 있게).
  btn(id, t, child, tip, onClick, { on = false, w = null, down = false } = {}) {
    let el = h_flex().id(id).h(24).flex_none().px(5).gap(5).items_center().justify_center().rounded(5).cursor_pointer()
      .text_color(on ? t.accent : t.muted).hover(s => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); if (down) onClick(cx); });
    if (!down) el = el.on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); });
    el = el.child(child);
    if (on) el = el.bg(t.selected);
    if (w) el = el.w(w);
    return tip ? el.tooltip(tip) : el;
  }

  barRow(t, mono, jobs) {
    const s = summary(jobs, this.more());
    const color = s.failed > 0 ? t.blocked : s.running > 0 || s.waiting > 0 ? t.accent : t.done;
    return h_flex().id("jobs-bar").h(H_BAR).flex_none().px(10).gap(8).items_center().bg(t.chrome ?? t.background)
      .border_1().border_color(this.expanded ? t.accent : t.border).rounded(5)
      .child(div().flex_none().text_size(12).text_color(t.muted).child("↑↓"))
      .child(div().flex_none().text_size(12).font_medium().child(this.gone() ? "패널 닫힘" : s.total > 0 ? `전송 ${s.finished}/${s.total}` : "전송 없음"))
      .when(s.total > 0, el => el
        .child(div().flex_none().text_size(11).font_family(mono).text_color(color).child(bar(s.pct, 8)))
        .child(div().flex_none().text_size(12).child(`${s.pct}%`)))
      .child(div().flex_1().min_w(0))
      .child(this.btn("jobs-toggle", t, svg(icon(this.expanded ? "chevron-up" : "chevron-down")).size(14).text_color(t.muted),
        this.expanded ? "접기" : "펼치기", () => { this.reopen(!this.expanded); }, { down: true }))
      .child(this.btn("jobs-close", t, svg(icon("close")).size(14).text_color(t.muted), "닫기",
        () => { const id = this.overlayId; if (id) closeOverlay(id); }));
  }

  dirMark(t, dir) {
    // «both» = 방향이 섞인 묶음 줄(↑↓)
    return div().w(dir === "both" ? 20 : 12).flex_none().text_size(12).text_color(t.muted).child(dir === "up" ? "↑" : dir === "both" ? "↑↓" : "↓");
  }

  // 기록·게시 값은 믿지 않는다: 내려받기 폴더 아래의 절대 경로(.. 없음 · NUL 없음)만 Finder 로 보여 준다. macOS 에서만.
  showable(where) {
    const dl = `${home()}/Downloads/`;
    return this.mac && typeof where === "string" && where.startsWith(dl) && where.length > dl.length && !where.includes("\0") && !where.split("/").includes("..");
  }

  finder(t, id, where) {
    if (!this.showable(where)) return div().w(20).flex_none();
    return this.btn(id, t, svg(icon("finder")).size(14).text_color(t.muted), "Finder에서 보기", () => {
      if (!this.showable(where)) return;
      exec("sh", ["-c", '[ -e "$1" ] || exit 44; exec open -R "$1"', "sh", where])
        .then(r => { if (r.code === 44) notify({ title: "파일 없음", body: where, level: "warning" }); })
        .catch(() => {});
    });
  }

  jobRow(t, mono, j) {
    const pct = j.state === "ok" ? 100 : j.total > 0 ? Math.max(0, Math.min(100, Math.floor(j.done / j.total * 100))) : 0;
    const color = j.state === "run" || j.state === "verify" ? t.accent : j.state === "ok" ? t.done : j.state === "fail" ? t.blocked : t.dim;
    const running = j.state === "run";
    let end = div().w(20).flex_none();
    // verify(검증 중)는 되돌릴 수 없고, 취소를 이미 눌렀으면 다시 누를 필요가 없다 → 취소 단추를 숨긴다.
    if ((j.state === "wait" || j.state === "run") && !j.cancelling) end = this.btn(`job-cancel-${j.id}`, t, svg(icon("cancel")).size(14).text_color(t.muted), "취소", () => this.req("cancel", { id: j.id }));
    else if (j.state === "fail") end = this.btn(`job-retry-${j.id}`, t, div().text_size(11).text_color(t.blocked).child("다시 시도"), null, () => this.req("retry", { id: j.id }));
    else if (j.state === "ok" && j.dir === "down" && j.where) end = this.finder(t, `job-finder-${j.id}`, j.where);
    return h_flex().id(`job-${j.id}`).h(28).flex_none().px(10).gap(6).items_center()
      .child(this.dirMark(t, j.dir))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(j.state === "cancel" ? t.dim : t.foreground).child(j.name))
      .when(j.state !== "wait" && j.state !== "cancel", el => el
        .child(div().flex_none().text_size(10).font_family(mono).text_color(color).child(bar(pct, 8)))
        .child(div().w(30).flex_none().text_size(11).text_color(t.muted).text_right().child(`${pct}%`)))
      .when(running && j.speed != null, el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`${human(j.speed)}/s`)))
      .when(running && j.eta != null, el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(etaText(j.eta))))
      .child(div().flex_none().text_size(11).text_color(color).child(j.cancelling ? "취소 중" : stateLabel(j.state)))
      .child(end);
  }

  queueBody(t, mono, jobs) {
    if (!jobs.length) return div().flex_1().flex().items_center().justify_center().text_size(12).text_color(t.dim).child("전송 없음");
    const m = this.more(), n = k => Math.max(0, num(m?.[k]) ?? 0);
    const rest = [n("wait") > 0 ? `외 ${n("wait")}개 대기` : "", n("run") + n("verify") > 0 ? `외 ${n("run") + n("verify")}개 진행` : "",
      n("ok") + n("fail") + n("cancel") > 0 ? `끝난 ${n("ok") + n("fail") + n("cancel")}개 생략` : ""].filter(Boolean).join(" · ");
    return v_flex().id("jobs-list").flex_1().min_h(0).overflow_y_scrollbar().children(jobs.map(j => this.jobRow(t, mono, j)))
      .when(Boolean(rest), el => el.child(div().id("jobs-more").h(26).flex_none().px(10).flex().items_center().text_size(11).text_color(t.dim).child(rest)));
  }

  historyBody(t) {
    const groups = groupHistory(arr(readShared(shared, KEY.history)).filter(e => e && typeof e === "object"), Date.now());
    if (!groups.length) return div().flex_1().flex().items_center().justify_center().text_size(12).text_color(t.dim).child("기록 없음");
    let n = 0;
    return v_flex().id("jobs-history").flex_1().min_h(0).overflow_y_scrollbar().children(groups.map(g => v_flex().flex_none()
      .child(div().h(22).flex_none().px(10).flex().items_center().text_size(11).text_color(t.dim).bg(t.surface ?? t.background).child(str(g.label)))
      .children(arr(g.items).map(e => {
        const id = `his-${n++}`, st = str(e.state);
        const color = st === "ok" ? t.done : st === "fail" ? t.blocked : t.dim;
        return h_flex().id(id).h(26).flex_none().px(10).gap(6).items_center()
          .child(this.dirMark(t, e.dir))
          .child(div().flex_1().min_w(0).truncate().text_size(12).child(str(e.name) || "?"))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(num(e.size) != null ? human(e.size) : ""))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(clock(e.at)))
          .child(div().w(30).flex_none().text_size(11).text_color(color).child(stateLabel(st)))
          .child(st === "ok" && e.dir === "down" && str(e.where) ? this.finder(t, `${id}-f`, e.where) : div().w(20).flex_none());
      }))));
  }

  cell(id, t, name, label, tip, onClick, on = false, down = false) {
    let el = h_flex().id(id).flex_1().h(34).gap(5).items_center().justify_center().cursor_pointer()
      .text_color(on ? t.accent : t.muted).hover(s => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); if (down) onClick(cx); });   // down: btn 과 같은 이유
    if (!down) el = el.on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); });
    return el.child(svg(icon(name)).size(14).flex_none().text_color(on ? t.accent : t.muted))
      .child(div().text_size(11).child(label));
  }

  toolbar(t) {
    return h_flex().id("jobs-tools").h(34).flex_none().border_t(1).border_color(t.border)
      .child(this.cell("t-clear", t, "clear", "모두 지우기", null, () => this.req(this.history ? "clearHistory" : "clear", {})))
      .child(this.cell("t-cancel", t, "cancel", "모두 취소", null, () => this.req("cancelAll", {})))
      .when(this.mac, el => el.child(this.cell("t-finder", t, "finder", "Finder 열기", null, () => { exec("open", [`${home()}/Downloads`]).catch(() => {}); })))
      .child(this.cell("t-history", t, "history", "기록", null, cx => { this.history = !this.history; if (readShared(shared, KEY.win(this.owner))?.t === this.token) this.flag(); cx.notify(); }, this.history, true));
  }

  render(cx) {
    const t = theme(), mono = String(settings()?.font_family ?? "monospace");
    const jobs = this.jobs();
    this.arm(cx, jobs);
    const root = v_flex().id("jobs-root").size_full().min_h(0).overflow_hidden().rounded(6).bg(t.chrome ?? t.background)
      .text_color(t.foreground).text_size(12)
      .on_hover((hovered, cx) => { if (hovered !== this.hovered) { this.hovered = hovered; cx.notify(); } })
      .child(this.barRow(t, mono, jobs));
    if (!this.expanded) return root;
    return root
      .child(v_flex().id("jobs-body").flex_1().min_h(0).mt(4).bg(t.background).border_1().border_color(t.border).rounded(5).overflow_hidden()
        .child(this.history ? this.historyBody(t) : this.queueBody(t, mono, jobs))
        .child(this.toolbar(t)));
  }
}
