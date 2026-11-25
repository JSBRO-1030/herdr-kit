// auto-tabs 소유자 컨트롤러 — 호스트 import 없음(node 시험용). 작업 큐 + 공간 기억.
// 호스트 호출(run · notify · 저장 · shared)은 전부 생성자에 주입받는다.
import {
  TOOLS, SIDES, eligible, validClosed, snapshot, recordOf, matches, locate, parseCommand,
  planRestore, planNormalize, planToggle, planOpen, planClose, moveTree, loadState, saveState,
} from "./panels.js";

const ERRORS = {
  "no-dest": "아래 패널이 없음 — 설치기를 다시 돌린다",
  missing: "도구를 찾을 수 없음",
  "unknown-id": "알 수 없는 도구",
  dup: "도구가 두 패널에 겹쳐 있음",
};
const MOVE_MS = 2000;
const OTHER_MS = 1000;
export const POLL_MS = 50;
export const OWNER_BEAT_MS = 20000;

const OWNER_KEY = "panel-tabs.owner";
const CLOSED_KEY = "panel-tabs.closed";

const sameOwner = (a, b) => a?.v === b.v && a?.hideFiles === b.hideFiles && a?.bottom === b.bottom && a?.t === b.t;

export class Owner {
  constructor({ run, notify, now, storage, setShared, getShared, hideFiles = false }) {
    this.host = { run, notify, now, storage, setShared, getShared };
    this.hideFiles = Boolean(hideFiles);
    // 옛 `panels` 키는 읽기만. 쓰는 키는 panels.v2 뿐.
    this.state = loadState(storage.get("panels.v2"), storage.get("panels"));
    this.queue = [];
    this.quarantine = null; // {key, until}: 늦은 set 이 닿을 때까지 다음 set 대기
    this.ownerTime = now();
    this.cur = null; // {kind, space, expect, until, id?, side?}
    this.space = undefined;
    this.closed = [];
    this.stuck = {}; // kind → {space, key}: 시간 넘긴 restore/normalize 를 snapshot 이 바뀔 때까지 막음
    this.root = null;
    this.opts = { panels: undefined, hideFiles: this.hideFiles };
  }

  command(str) {
    const c = parseCommand(str);
    if (!c) return;
    this.queue.push({ kind: c.op, id: c.id, side: c.side, space: this.space });
  }

  // render · 폴링 타이머에서 부름 → {repoll, on}
  tick(root, spaceId, { panels } = {}) {
    this.root = root;
    this.opts = { panels, hideFiles: this.hideFiles };
    this.closed = validClosed(this.host.getShared(CLOSED_KEY));
    const snap = snapshot(root, this.opts, this.closed);
    const key = JSON.stringify(snap);
    if (this.quarantine) {
      if (this.quarantine.key !== key) this.quarantine = { key, until: this.host.now() + MOVE_MS };
      else if (this.host.now() >= this.quarantine.until) this.quarantine = null;
    }
    for (const k of Object.keys(this.stuck)) if (this.stuck[k].key !== key) delete this.stuck[k];

    if (spaceId && spaceId !== this.space) {
      this.space = spaceId;
      this.queue = this.queue.filter((j) => j.kind === "move" || j.space === spaceId);
      this.enqueueRestore(spaceId, key);
    }

    if (this.cur) {
      if (matches(snap, this.cur.expect)) this.finish(false, key);
      else if (this.host.now() >= this.cur.until) this.finish(true, key);
    }
    this.pump();

    // 한가할 때만 기록 · 정리: cur 없음 · 큐 비음 · 공간 확정.
    if (!this.cur && !this.queue.length && this.space) {
      const idle = snapshot(root, this.opts, this.closed);
      const rec = recordOf(idle);
      if (JSON.stringify(rec) !== JSON.stringify(this.state.spaces[this.space])) {
        this.state.spaces[this.space] = rec;
        this.host.storage.set("panels.v2", saveState(this.state));
      }
      const np = planNormalize(idle);
      const stuck = this.stuck.normalize;
      if (np.ops.length && !(stuck && stuck.key === JSON.stringify(idle))) {
        this.queue.push({ kind: "normalize" });
        this.pump();
      }
    }

    const fin = snapshot(root, this.opts, this.closed);
    this.publishOwner(fin);
    return { repoll: Boolean(this.cur || this.queue.length || this.quarantine), on: this.onSet(fin) };
  }

  enqueueRestore(space, key) {
    if (this.queue.some((j) => j.kind === "restore" && j.space === space)) return;
    const st = this.stuck.restore;
    if (st && st.space === space && st.key === key) return;
    this.queue.unshift({ kind: "restore", space });
  }

  finish(timedOut, key) {
    const c = this.cur;
    this.cur = null;
    if (timedOut) {
      if (c.kind === "move") {
        this.queue = this.queue.filter((j) => j.kind !== "move");
        this.quarantine = { key, until: this.host.now() + MOVE_MS };
        this.host.notify({ title: "옮기기 실패", body: "옮기기가 늦어 멈춤 — 다시 한다", level: "error" });
      } else if (c.kind === "restore" || c.kind === "normalize") {
        this.stuck[c.kind] = { space: c.space, key };
      }
    }
    if (this.space && c.space !== this.space) this.enqueueRestore(this.space, key);
  }

  // 한 번에 하나: cur 가 비었을 때만 다음 일을 시작 → 한 tick 에 set 두 번 없음.
  pump() {
    while (!this.cur && this.queue.length) {
      const i = this.quarantine ? this.queue.findIndex((j) => j.kind !== "move") : 0;
      if (i < 0) break;
      this.start(this.queue.splice(i, 1)[0]);
    }
  }

  commitClosed(next) {
    if (JSON.stringify(next) === JSON.stringify(this.closed)) return;
    this.closed = next;
    this.host.setShared(CLOSED_KEY, next);
  }

  start(job) {
    const root = this.root, opts = this.opts;
    const snap = snapshot(root, opts, this.closed);
    let plan = null;
    switch (job.kind) {
      case "restore":
        plan = planRestore(snap, this.state.spaces[job.space]);
        break;
      case "normalize":
        plan = planNormalize(snap);
        break;
      case "toggle": plan = planToggle(snap, this.closed, job.id); break;
      case "open": plan = planOpen(snap, this.closed, job.id); break;
      case "close": plan = planClose(snap, this.closed, job.id); break;
      case "move": {
        const at = locate(root, job.id);
        if (at && !at.error && at.side === job.side) { plan = planOpen(snap, this.closed, job.id); break; } // 같은 쪽 = 열기
        const r = moveTree(root, job.id, job.side, opts, this.closed);
        if (r.error === "same-side") { plan = planOpen(snap, this.closed, job.id); break; }
        if (r.error) {
          this.host.notify({ title: "옮기기 실패", body: ERRORS[r.error] ?? "옮길 수 없음", level: "error" });
          return;
        }
        plan = { ops: [{ cmd: "layout.set", args: { layout: r.tree } }], closed: r.closed, expect: r.expect };
        break;
      }
      default: return;
    }
    if (plan.closed) this.commitClosed(plan.closed);
    if (!plan.ops.length) return;
    for (const op of plan.ops) this.host.run(op.cmd, op.args);
    this.cur = {
      kind: job.kind, space: this.space, expect: plan.expect,
      until: this.host.now() + (job.kind === "move" ? MOVE_MS : OTHER_MS),
      id: job.id, side: job.side,
    };
  }

  beat() {
    this.ownerTime = this.host.now();
    this.publishOwner(snapshot(this.root, this.opts, this.closed));
  }

  publishOwner(snap) {
    const want = { v: 2, hideFiles: this.hideFiles, bottom: Boolean(snap.bottom?.exists), t: this.ownerTime };
    if (!sameOwner(this.host.getShared(OWNER_KEY), want)) this.host.setShared(OWNER_KEY, want);
  }

  // 단추 켜짐 = 어느 쪽이든 보임 && active 이고 닫히지 않은 도구.
  onSet(snap) {
    const on = new Set();
    for (const id of TOOLS) {
      if (this.closed.includes(id) || !eligible(id, this.opts)) continue;
      for (const side of Object.keys(SIDES)) {
        const s = snap[side];
        if (s?.exists && s.shown && s.active === id && s.children.includes(id)) on.add(id);
      }
    }
    return on;
  }
}
