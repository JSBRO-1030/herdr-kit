// panel-tabs(패널 탭) — 오른쪽 패널 스택(panel-body) 맨 위 탭 줄. header mod 로 레이아웃에 붙는다.
// M1: 스택 자식마다 칩 · 누르면 layout.select 로 보이는 자식 전환. 닫기/+/우클릭/옮기기는 이후 단계.
// 읽는 props: stack(스택 노드 id, 기본 "panel-body") · hideFiles(true 면 Files 칩 숨김).
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, props, shared, theme, run } from "herdr";
import { chipsFor, availWidth, needWidth, decideCompact, pickAvail } from "./model.js";

export default class PanelTabs extends View {
  compact = false;
  width = null;   // on_size_change 로 잰 줄 전체 폭(px)

  render(cx) {
    const t = theme();
    const p = props() ?? {};
    const stackId = typeof p.stack === "string" ? p.stack : "panel-body";
    const root = layout();
    const r = chipsFor(root, stackId, { panels: shared("workspace.panels"), hideFiles: p.hideFiles === true });
    const bar = () => h_flex().id("panel-tabs").size_full().min_w(0).px(8).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_size_change((size, c) => { const w = Math.round(size.width); if (w !== this.width) { this.width = w; c.notify(); } });
    if (r.error) {
      return bar()
        .child(div().text_size(12).text_color(t.blocked).child("⚠"))
        .child(div().text_size(12).text_color(t.muted).child("패널 구조를 못 찾음 — 탭 줄 꺼짐"));
    }
    // needWidth 는 좌우 패딩 8+8 포함 = 줄 전체 폭과 비교한다.
    this.compact = decideCompact(this.compact === true, needWidth(r.chips), pickAvail(this.width, availWidth(root, stackId)));
    const stop = (_e, c) => c.stop_propagation();
    const select = (id) => { if (!r.chips.find(c => c.id === id)?.active) run("layout.select", { stack: stackId, child: id }); };
    const full = ({ id, label, icon, active }) => h_flex().id("pt-" + id).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
      .text_size(12).bg(active ? t.selected : t.chrome).text_color(active ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click(() => select(id)).child(svg(icon).size(14)).child(label);
    const small = ({ id, icon }) => div().id("pt-" + id).size(26).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(() => select(id)).child(svg(icon).size(14));
    return bar().children(r.chips.map(c => this.compact && !c.active ? small(c) : full(c)));
  }
}
