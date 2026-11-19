// files-plus 파일 다루기 창 두 모드 — 설계: docs/popups-design.md §8.
// View 가 아니라 평범한 class: main.js 의 View 가 props.mode 가 "menu" · "ask" 일 때 위임한다.
//  · menu(FileMenu)  트리 줄 오른쪽 클릭 팝업(커서 자리). herdr 기본 mod `menu` 꼴.
//  · ask(AskDialog)  이름 입력(새 폴더 · 이름 바꾸기) · 지우기 확인 대화창. 기본 mod `prompt` · `confirm` 꼴.
// 하는 일은 요청뿐이다: state.js 의 send(…, "ask", 액션, 인자)로 패널에 보낸다 — 경로는 보내지 않고 패널이 쥔 티켓의 토큰만 보낸다(fsops.js).
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, theme, props, openOverlay, closeOverlay, shared, setShared } from "herdr";
import { human } from "./kinds.js";
import { send, alive } from "./state.js";
import { MOD, PROBE, menuItems, askProps, askSpec, freeName, stemRange, parseProbe, opError, askProblem, submitPlan, ENTER_GUARD_MS } from "./fsops.js";

const icon = n => `mods/${MOD}/${n}.svg`;
const MENU_ICON = { mkdir: "folder-plus", rename: "rename", delete: "trash" };
const TITLE = { mkdir: "새 폴더", rename: "이름 바꾸기", delete: "지우기" };

// 이 overlay 의 id — 기본 mod(confirm · prompt)처럼 props() 에서 읽고, 없으면 init 때 받은 것.
const overlayId = p => props()?.overlay ?? p?.overlay;

export class FileMenu {
  constructor(p, cx) {
    this.p = p ?? {};
    this.items = menuItems(this.p);
    this.at = 0; this.closed = false;
    this.handle = cx.focus_handle();
    this.handle.focus();
    // 팝업은 열릴 때 포커스가 늦게 올 수 있다 → 한 번 더.
    this.later = cx.timer.after(50, () => { if (!this.closed) this.handle.focus(); });
  }

  close() { this.closed = true; try { this.later?.cancel(); } catch { /* 이미 끝남 */ } }

  shut() { const id = overlayId(this.p); if (id) closeOverlay(id); }

  choose(i) {
    const it = this.items[i];
    if (!it) return;
    this.shut();
    // 패널이 죽었으면(jobs 키가 치워짐) 아무것도 하지 않고 닫기만 한다.
    if (!alive(shared, this.p.owner)) return;
    openOverlay(askSpec(askProps(this.p, it.op)));
  }

  render(cx) {
    const t = theme(), list = this.items, n = list.length;
    return v_flex().id("files-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.is_held) return;      // 누르고 있는 키(반복)는 무시 — 누르고 있던 Enter 로 바로 실행되지 않게
        if (e.key === "down") this.at = (this.at + 1) % n;
        else if (e.key === "up") this.at = (this.at + n - 1) % n;
        else if (e.key === "enter") this.choose(this.at);
        else if (e.key === "escape") this.shut();
        else return;
        cx.notify();
      })
      .children(list.map((it, i) => h_flex().id(`fm-${it.op}`).h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground)
        .when(i === this.at, el => el.bg(t.selected)).hover(s => s.bg(t.hover))
        .on_click(() => this.choose(i))
        .child(svg(icon(MENU_ICON[it.op])).size(14).flex_none().text_color(it.op === "delete" ? t.ansi1 : t.muted))
        .child(div().flex_1().child(it.label))));
  }
}

export class AskDialog {
  constructor(p, cx) {
    this.p = p ?? {};
    this.op = Object.hasOwn(TITLE, this.p.op) ? this.p.op : "mkdir";
    this.owner = typeof this.p.owner === "string" ? this.p.owner : "";
    this.token = typeof this.p.token === "string" ? this.p.token : "";
    this.taken = new Set(Array.isArray(this.p.taken) ? this.p.taken.filter(x => typeof x === "string") : []);
    this.closed = false; this.tasks = new Set();
    this.handle = cx.focus_handle();
    this.inputFocused = true;
    this.readyAt = Date.now() + ENTER_GUARD_MS;   // 이 시각 전의 Enter 제출은 무시(지우기는 PROBE 결과가 온 뒤로 다시 잡는다)
    this.probe = null;           // 지우기: null = 확인 중 · { err } · { tool, kind, n }
    if (this.op === "delete") { this.handle.focus(); this.probeNow(cx); } else this.initInput(cx);
  }

  close() { this.closed = true; for (const t of this.tasks) { try { t.cancel(); } catch { /* 이미 끝남 */ } } this.tasks.clear(); }

  shut() { const id = overlayId(this.p); if (id) closeOverlay(id); }

  // 이름 창: 새 폴더 = 빈 이름 «새 폴더»(있으면 «새 폴더 2» …) 전체 선택 · 이름 바꾸기 = 지금 이름(파일이면 확장자 앞까지 선택 · Finder 처럼).
  initInput(cx) {
    const name = typeof this.p.name === "string" ? this.p.name : "";
    this.text = this.op === "mkdir" ? freeName("새 폴더", this.taken) : name;
    this.input = InputState.new({ value: this.text });
    const range = this.op === "rename" ? stemRange(this.text, this.p.dir === true) : { start: 0, end: this.text.length };
    if (this.text) this.input.set_selected_range(range);
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); cx.notify(); });
    this.input.on("submit", () => this.submit(true));
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.input.focus();
    // prompt 와 같다: 열린 직후 포커스가 안 걸릴 수 있어 한 번 더.
    this.tasks.add(cx.timer.after(600, () => { if (!this.closed) this.input.focus(); }));
  }

  // 지우기 창이 뜨면 «그 머신에서» 대상을 읽기만 해 본다: 휴지통 도구 · 종류 · 크기/항목 수. 결과가 올 때까지 확인 단추는 없다.
  probeNow(cx) {
    cx.spawn(async cx => {
      try {
        const r = await exec("sh", ["-c", PROBE, "files-plus", String(this.p.abs ?? "")], { on: this.p.on ?? null, timeout: 10000 });
        if (this.closed) return;
        const pr = r.code === 0 ? parseProbe(r.stdout) : null;
        this.probe = pr ?? { err: r.code === 0 ? "결과를 읽을 수 없다" : opError(r) };
      } catch (e) {
        if (this.closed) return;
        this.probe = { err: String(e?.message ?? e).slice(0, 200) };
      }
      this.readyAt = Date.now() + ENTER_GUARD_MS;
      cx.notify();
    });
  }

  // 입력 문제 → 한국어 사유 | null. 판단은 fsops.js 의 askProblem(순수 · 시험한다).
  problem() { return askProblem({ op: this.op, text: this.text, name: this.p.name, taken: this.taken }); }

  // Enter · 확인 단추. enter=true 는 Enter(Input submit · 지우기 창 키) · 단추 클릭은 enter=false.
  // 판단(영구 삭제는 Enter 로 못 한다 · 같은 이름 = 닫기 · 연 직후 Enter 무시)은 fsops.js 의 submitPlan.
  submit(enter) {
    if (this.closed || !alive(shared, this.owner)) return;
    const plan = submitPlan({ op: this.op, text: this.text, name: this.p.name, taken: this.taken, probe: this.probe, enter: enter === true, now: Date.now(), readyAt: this.readyAt });
    if (plan.kind === "close") this.shut();
    else if (plan.kind === "post") this.post(plan.action, { token: this.token, ...plan.args });
  }

  post(action, args) {
    this.closed = true;          // 한 번만 — 티켓이 1회용이라 두 번째 요청은 «오래됐다» 알림만 만든다
    send(shared, setShared, this.owner, "ask", action, args);
    this.shut();
  }

  key(e, cx) {
    if (e.is_held) return;      // 누르고 있는 키(반복)는 무시
    if (e.key === "escape") { this.shut(); cx.stop_propagation(); }
    else if (e.key === "enter" && this.op === "delete") { this.submit(true); cx.stop_propagation(); }
  }

  render(cx) {
    const t = theme(), live = alive(shared, this.owner);
    const del = this.op === "delete", pr = del ? this.probe : null;
    const title = !del ? TITLE[this.op] : pr?.tool === "none" ? "영구히 지울까?" : pr?.tool ? "휴지통으로 옮길까?" : TITLE.delete;
    // 단추: kind = plain | primary | danger · 못 누르면(enabled=false) 흐리게.
    const button = (id, text, kind, enabled, action) => {
      const bg = !enabled ? t.raised : kind === "primary" ? t.solid : kind === "danger" ? t.ansi1 : t.raised;
      const fg = !enabled ? t.dim : kind === "plain" ? t.foreground : t.solid_foreground;
      return h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1().border_color(enabled && kind !== "plain" ? bg : t.input).bg(bg).text_color(fg)
        .text_size(12.5).font_medium().when(enabled, el => el.cursor_pointer().hover(s => s.opacity(0.88)).on_click(action)).when(!enabled, el => el.cursor_not_allowed()).child(text);
    };
    const root = v_flex().id("files-ask").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx)).size_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child(title)).child(div().text_size(11).text_color(t.dim).child("Esc")));
    if (!live) {
      return root.child(div().flex_1().pt(16).text_size(12.5).text_color(t.ansi1).child("파일+ 패널이 닫혔다"))
        .child(h_flex().gap(8).justify_end().child(button("fa-cancel", "닫기", "plain", true, () => this.shut())));
    }
    if (!del) {
      const bad = this.problem();
      return root
        .child(div().pt(12).h(30).text_size(11.5).text_color(t.dim).whitespace_nowrap().overflow_hidden().text_ellipsis_middle().child(this.p.where ?? ""))
        .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(bad ? t.ansi1 : this.inputFocused ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
        .child(div().pt(6).h(22).text_size(11.5).text_color(t.ansi1).child(bad ?? ""))
        .child(h_flex().pt(14).gap(8).justify_end()
          .child(button("fa-cancel", "취소", "plain", true, () => this.shut()))
          .child(button("fa-ok", this.op === "mkdir" ? "만들기" : "바꾸기", "primary", !bad, () => this.submit(false))));
    }
    // 지우기 확인
    const ready = Boolean(pr && !pr.err);
    const body = v_flex().flex_1().min_h(0).pt(12).gap(6)
      .child(div().h(16).text_size(12).text_color(t.muted).whitespace_nowrap().overflow_hidden().text_ellipsis_middle().child(this.p.where ?? ""))
      .when(!pr, el => el.child(div().text_size(12.5).text_color(t.dim).child("확인 중…")))
      .when(Boolean(pr?.err), el => el.child(div().text_size(12.5).text_color(t.ansi1).child(`확인하지 못했다: ${pr.err}`)))
      .when(ready, el => el.child(div().text_size(12.5).text_color(t.foreground).child(infoLine(pr))))
      .when(ready && pr.tool === "none", el => el.child(div().text_size(12.5).text_color(t.ansi1).child("되돌릴 수 없다 · 휴지통이 없는 머신")));
    return root.child(body)
      .when(ready && pr.tool === "none", el => el.child(div().pb(8).text_size(11).text_color(t.dim).child("영구 삭제는 단추를 눌러야 한다")))
      .child(h_flex().gap(8).justify_end()
        .child(button("fa-cancel", "취소", "plain", true, () => this.shut()))
        .when(ready, el => el.child(pr.tool === "none" ? button("fa-ok", "영구 삭제", "danger", true, () => this.submit(false)) : button("fa-ok", "휴지통으로", "primary", true, () => this.submit(false)))));
  }
}

function infoLine(pr) {
  if (pr.kind === "d") return pr.n > 10000 ? "폴더 · 안의 항목 10000개 넘음" : `폴더 · 안의 항목 ${pr.n}개`;
  if (pr.kind === "l") return "링크 · 링크만 지우고 가리키는 것은 그대로 둔다";
  return pr.n >= 0 ? `파일 · ${human(pr.n)}` : "파일 · 크기를 모른다";
}
