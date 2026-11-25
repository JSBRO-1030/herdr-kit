// panel-tabs(패널 탭) — 오른쪽 패널 스택(panel-body) 맨 위 탭 줄. header mod 로 레이아웃에 붙는다.
// M1: 스택 자식마다 칩 · 누르면 layout.select 로 보이는 자식 전환. 닫기/+/우클릭/옮기기는 이후 단계.
// 읽는 props: stack(스택 노드 id, 기본 "panel-body") · hideFiles(true 면 Files 칩 숨김).
import { View, div, svg } from "gpui-kit";
import { layout, props, shared, theme, run, openOverlay, closeOverlay } from "herdr";
import { h_flex, v_flex } from "gpui-base";
import { chipsFor, availWidth, needWidth, decideCompact, pickAvail, ownerInfo, OWNER_STALE_MS, menuRows, menuHeight, MENU_W, firstEnabled, stepEnabled, rowEnabled } from "./model.js";

export default class PanelTabs extends View {
  compact = false;
  width = null;   // on_size_change 로 잰 줄 전체 폭(px)
  at = -1;        // 팝업 메뉴에서 고른 행

  init(_props, cx) {
    this.handle = cx.focus_handle();
    const p = props() ?? {};
    if (p.menu === "tab" || p.menu === "plus") {
      this.at = firstEnabled(this.rowsNow());
      this.handle.focus();
    }
  }

  // 팝업 행: 열린 순간이 아니라 그릴 때의 layout/shared 로 다시 계산.
  rowsNow() {
    const p = props() ?? {};
    const stackId = typeof p.stack === "string" ? p.stack : "panel-body";
    const o = ownerInfo(shared("panel-tabs.owner"), shared("panel-tabs.closed"), p.hideFiles === true, layout(), Date.now());
    if (!o.on) return [];
    return menuRows(layout(), stackId, { panels: shared("workspace.panels"), hideFiles: o.hideFiles, closed: o.closed, bottom: o.bottom }, p.menu, p.id);
  }

  choose(i, rows) {
    const r = rows[i];
    if (!rowEnabled(r)) return;
    closeOverlay(props()?.overlay);
    run("auto-tabs." + r.cmd);
  }

  renderMenu() {
    const t = theme();
    const rows = this.rowsNow();
    if (!rowEnabled(rows[this.at])) this.at = firstEnabled(rows);
    return v_flex().id("pt-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, c) => {
        if (e.key === "down") this.at = stepEnabled(rows, this.at, 1);
        else if (e.key === "up") this.at = stepEnabled(rows, this.at, -1);
        else if (e.key === "enter") { this.choose(this.at, rows); return; }
        else if (e.key === "escape") { closeOverlay(props()?.overlay); return; }
        else return;
        c.notify();
      })
      .children(rows.map((r, i) => {
        if (r.sep) return div().mx(7).my(4).h(1).bg(t.border);
        const ok = rowEnabled(r);
        return h_flex().id("pt-mi-" + i).h(31).px(8).gap(9).rounded(7).items_center()
          .text_color(ok && !r.dim ? t.foreground : t.dim)
          .when(ok && i === this.at, (el) => el.bg(t.selected))
          .when(ok, (el) => el.hover((s) => s.bg(t.hover)).on_mouse_move((_e, c) => { if (this.at !== i) { this.at = i; c.notify(); } }).on_click(() => this.choose(i, rows)))
          .child(div().flex_1().child(r.label));
      }));
  }

  render(cx) {
    const t = theme();
    const p = props() ?? {};
    const root = layout();
    const value = shared("panel-tabs.owner"), now = Date.now();
    const o = ownerInfo(value, shared("panel-tabs.closed"), p.hideFiles, root, now);
    if (o.on && !this.ownerTimer) {
      this.ownerTimer = true;
      cx.timer.after(value.t + OWNER_STALE_MS + 1 - now, (cx) => { this.ownerTimer = false; cx.notify(); });
    }
    if (p.menu === "tab" || p.menu === "plus") return this.renderMenu();
    const stackId = typeof p.stack === "string" ? p.stack : "panel-body";
    const r = chipsFor(root, stackId, { panels: shared("workspace.panels"), hideFiles: o.hideFiles, closed: o.closed });
    const bar = () => h_flex().id("panel-tabs").size_full().min_w(0).px(8).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_size_change((size, c) => { const w = Math.round(size.width); if (w !== this.width) { this.width = w; c.notify(); } });
    if (r.error) {
      return bar()
        .child(div().text_size(12).text_color(t.blocked).child("⚠"))
        .child(div().text_size(12).text_color(t.muted).child("패널 구조를 못 찾음 — 탭 줄 꺼짐"));
    }
    // needWidth 는 좌우 패딩 8+8 포함 = 줄 전체 폭과 비교한다.
    this.compact = decideCompact(this.compact === true, needWidth(r.chips, false, o.on), pickAvail(this.width, availWidth(root, stackId)));
    const stop = (_e, c) => c.stop_propagation();
    const select = (id) => { if (!r.chips.find(c => c.id === id)?.active) run("layout.select", { stack: stackId, child: id }); };
    const menuOf = (menu, id) => {
      const rows = menuRows(root, stackId, { panels: shared("workspace.panels"), hideFiles: o.hideFiles, closed: o.closed, bottom: o.bottom }, menu, id);
      openOverlay({ mod: "panel-tabs", kind: "popup", width: MENU_W, height: menuHeight(rows), props: menu === "tab" ? { menu, id, stack: stackId } : { menu, stack: stackId } });
    };
    const rightClick = (id) => (_e, c) => { c.stop_propagation(); menuOf("tab", id); };
    const full = ({ id, label, icon, active }) => {
      let el = h_flex().id("pt-" + id).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(active ? t.selected : t.chrome).text_color(active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => select(id)).child(svg(icon).size(14)).child(label);
      if (o.on) {
        el = el.on_mouse_down("right", rightClick(id));
        if (active) {
          el = el.child(div().id("pt-x-" + id).flex_none().flex().items_center().text_color(t.dim).hover(s => s.text_color(t.foreground))
            .on_mouse_down("left", stop)
            .on_click((_e, c) => { c.stop_propagation(); run("auto-tabs.close:" + id); })
            .child(svg("mods/pane/close.svg").size(12)));
        }
      }
      return el;
    };
    const small = ({ id, icon }) => {
      const el = div().id("pt-" + id).size(26).flex_none().flex().items_center().justify_center().rounded(6)
        .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", stop).on_click(() => select(id)).child(svg(icon).size(14));
      return o.on ? el.on_mouse_down("right", rightClick(id)) : el;
    };
    const plus = () => div().id("pt-plus").size(26).flex_none().flex().items_center().justify_center().rounded(6)
      .text_size(14).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(() => menuOf("plus")).child("+");
    const kids = r.chips.map(c => this.compact && !c.active ? small(c) : full(c));
    return bar().children(o.on ? [...kids, plus()] : kids);
  }
}
