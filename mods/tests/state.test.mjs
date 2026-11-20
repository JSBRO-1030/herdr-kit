// files-plus/state.js 시험 — node --test tests/state.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { previewKey, previewSpec, KEY, newOwner, snapshot, summary, bar, speedometer, send, drain, pushHistory, groupHistory, stateLabel, throttle, safeName, ownerKeys, alive, pushHistoryGroup, own, restoreOwner, orphanedJobs, orphanParts, isPartPath, OWNER_STORE, readShared, startLife, lifeCurrent, seenJids, LIFE_STORE, lifeKey, previewEntry, previewId, livePreviewId, PREVIEW_TTL, partsKey, closingParts, pendingParts, PARTS_CAP } from "../files-plus/state.js";
import { SOURCES, MIN_W, MIN_H, ABS_MAX, clampRect, fitSize, dragRect, stepFont, fontOf, FONT_STEPS } from "../files-plus/state.js";
import { OWNERS_KEY, OWNERS_CAP, OWNER_BEAT_MS, OWNER_DEAD_MS, normalizeOwners, registerOwner, dropOwners, deadOwners, ownerCleanupPlan } from "../files-plus/state.js";
import { partName } from "../files-plus/transfer.js";

const store = () => { const m = new Map(); return { m, get: k => m.get(k), set: (k, v) => m.set(k, v) }; };

test("KEY · newOwner", () => {
  assert.equal(KEY.jobs("a"), "files-plus.jobs/a");
  assert.equal(KEY.req("a", "jobs"), "files-plus.req/a/jobs");
  assert.equal(KEY.ack("a", "preview"), "files-plus.ack/a/preview");
  assert.equal(KEY.history, "files-plus.history");
  const o = newOwner();
  assert.match(o, /^[a-z0-9]{8}$/);
  assert.notEqual(o, newOwner());
});

test("snapshot: 평범한 JSON 만 · 유한 숫자 또는 null", () => {
  const s = snapshot("o", "box", [{ id: 1, dir: "down", name: "a", total: 10, done: NaN, state: "run", speed: Infinity, eta: 3, fn() {}, cancelled: true, extra: 1 }, null], 5);
  assert.deepEqual(s, { owner: "o", on: "box", life: "", updated: 5, jobs: [{ id: 1, dir: "down", name: "a", total: 10, done: null, state: "run", note: "", speed: null, eta: 3, where: "", on: "", cancelling: true }] });
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  assert.deepEqual(snapshot("o", "", "x", NaN).jobs, []);
});

test("send/drain: 순서 · 중복 없음", () => {
  const { get, set } = store();
  assert.equal(send(get, set, "o", "jobs", "cancel", { id: 1 }), 1);
  assert.equal(send(get, set, "o", "jobs", "clear"), 2);
  const a = drain(get, set, "o", "jobs");
  assert.deepEqual(a.map(e => [e.id, e.action]), [[1, "cancel"], [2, "clear"]]);
  assert.deepEqual(a[1].args, {});
  assert.deepEqual(drain(get, set, "o", "jobs"), []);
  assert.equal(get(KEY.ack("o", "jobs")), 2);
});

test("send: ack 이하 정리 · id 는 ack 다음부터", () => {
  const { m, get, set } = store();
  send(get, set, "o", "jobs", "a"); send(get, set, "o", "jobs", "b");
  drain(get, set, "o", "jobs");
  assert.equal(send(get, set, "o", "jobs", "c"), 3);
  assert.deepEqual(m.get(KEY.req("o", "jobs")).map(e => e.id), [3]);
  m.set(KEY.req("o", "jobs"), []); // 목록이 비어도 ack 아래로 내려가지 않는다
  assert.equal(send(get, set, "o", "jobs", "d"), 3); // ack=2 그대로 → 3
});

test("두 송신자(from)는 서로 섞이지 않는다", () => {
  const { get, set } = store();
  send(get, set, "o", "preview", "open"); send(get, set, "o", "jobs", "clear"); send(get, set, "o", "jobs", "cancelAll");
  assert.deepEqual(drain(get, set, "o", "preview").map(e => e.action), ["open"]);
  assert.deepEqual(drain(get, set, "o", "jobs").map(e => e.action), ["clear", "cancelAll"]);
  send(get, set, "o", "preview", "download");
  assert.deepEqual(drain(get, set, "o", "jobs"), []);
  assert.deepEqual(drain(get, set, "o", "preview").map(e => e.id), [2]);
});

test("drain: 쓰레기 값에 견딘다 · 오름차순", () => {
  for (const bad of [undefined, null, "x", 5, { id: 1 }]) {
    const { m, get, set } = store();
    m.set(KEY.req("o", "p"), bad);
    assert.deepEqual(drain(get, set, "o", "p"), []);
    assert.equal(send(get, set, "o", "p", "a"), 1);
  }
  const { m, get, set } = store();
  m.set(KEY.ack("o", "p"), "zz");
  m.set(KEY.req("o", "p"), [{ id: 3, action: "c" }, null, { action: "no-id" }, { id: 1, action: "a" }, { id: 2, action: "b" }]);
  assert.deepEqual(drain(get, set, "o", "p").map(e => e.id), [1, 2, 3]);
  assert.equal(m.get(KEY.ack("o", "p")), 3);
  m.set(KEY.req("o", "p"), [{ id: 2, action: "b" }]); // ack 이하는 무시
  assert.deepEqual(drain(get, set, "o", "p"), []);
  assert.equal(m.get(KEY.ack("o", "p")), 3);
});

test("summary: 바이트 가중 · 크기 모름 · 빈 목록", () => {
  assert.deepEqual(summary([]), { total: 0, finished: 0, running: 0, waiting: 0, failed: 0, pct: 0, text: "전송 없음" });
  assert.equal(summary(undefined).text, "전송 없음");
  const s = summary([
    { state: "ok", total: 100, done: 100 },
    { state: "run", total: 300, done: 100 },
    { state: "wait", total: 100, done: 0 },
    { state: "run", total: null, done: 50 },   // 크기 모름: 뺀다
    { state: "fail", total: 1000, done: 10 },  // fail·cancel 은 pct 에서 뺀다
    { state: "cancel", total: 1000, done: 900 },
  ]);
  assert.equal(s.pct, 40); // (100+100)/(100+300+100)
  assert.deepEqual([s.total, s.finished, s.running, s.waiting, s.failed], [6, 3, 2, 1, 1]);
  assert.equal(s.text, "전송 3/6 · 40%");
  assert.equal(summary([{ state: "ok", total: 5, done: 5 }]).pct, 100);
  assert.equal(summary([{ state: "run", total: 0, done: 0 }]).pct, 0);
  assert.equal(summary([{ state: "run", total: 10, done: 99 }]).pct, 100);  // 크기 모르는 ok: 혼자면 100%, 바이트 가중 작업 옆에선 [1,1] 몫만, cancel 은 여전히 뺀다
  assert.equal(summary([{ state: "ok" }]).pct, 100);
  assert.equal(summary([{ state: "ok" }, { state: "run", total: 100, done: 50 }]).pct, 50);
  assert.equal(summary([{ state: "cancel" }]).pct, 0);
});

test("bar", () => {
  assert.equal(bar(0), "░░░░░░░░");
  assert.equal(bar(100), "▓▓▓▓▓▓▓▓");
  assert.equal(bar(50), "▓▓▓▓░░░░");
  assert.equal(bar(42), "▓▓▓░░░░░");   // 3.36 → 3
  assert.equal(bar(44), "▓▓▓▓░░░░");   // 3.52 → 4
  assert.equal(bar(50, 10), "▓▓▓▓▓░░░░░");
  assert.equal(bar(-5), "░░░░░░░░");
  assert.equal(bar(150, 4), "▓▓▓▓");
  assert.equal(bar(NaN, 4), "░░░░");
  assert.equal(bar(50, 0), "");
});

test("speedometer: 3초 동안 null · 이동평균 · eta", () => {
  const sp = speedometer();
  assert.deepEqual(sp.sample(0, 1000), { speed: null, eta: null });
  assert.deepEqual(sp.sample(500, 2500, 10000), { speed: null, eta: null });
  assert.deepEqual(sp.sample(900, 3999, 10000), { speed: null, eta: null });
  const r = sp.sample(3000, 4000, 10000);   // 3초 경과: 3000B/3s
  assert.equal(r.speed, 1000);
  assert.equal(r.eta, 7);
  assert.equal(sp.sample(3000, 4500).eta, null);   // total 없으면 eta null
  // 5초 창: 4000 이전 표본은 밀려난다 → 최근 속도 반영
  const r2 = sp.sample(13000, 9000, 20000);
  assert.ok(r2.speed > 1000);
  sp.reset();
  assert.deepEqual(sp.sample(0, 50000), { speed: null, eta: null });
  const stall = speedometer(); stall.sample(100, 0);
  assert.deepEqual(stall.sample(100, 4000, 200), { speed: 0, eta: null });
});

test("pushHistory: 새것이 앞 · max 자르기", () => {
  let l = [];
  for (let i = 1; i <= 5; i++) l = pushHistory(l, { at: i }, 3);
  assert.deepEqual(l.map(e => e.at), [5, 4, 3]);
  assert.deepEqual(pushHistory(null, { at: 1 }), [{ at: 1 }]);
  const orig = [{ at: 1 }]; pushHistory(orig, { at: 2 }); assert.equal(orig.length, 1);
});

test("groupHistory: 오늘/어제/날짜 · 자정 경계", () => {
  const at = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
  const now = at(2026, 11, 15, 0, 5);   // 자정 직후
  const list = [
    { at: at(2026, 11, 15, 0, 1), name: "a" },
    { at: at(2026, 11, 14, 23, 59), name: "b" },   // 6분 전이지만 어제
    { at: at(2026, 11, 14, 1), name: "c" },
    { at: at(2026, 11, 13, 23, 59), name: "d" },
    { at: at(2026, 1, 3), name: "e" },
  ];
  const g = groupHistory(list, now);
  assert.deepEqual(g.map(x => x.label), ["오늘", "어제", "2026-11-13", "2026-01-03"]);
  assert.deepEqual(g.map(x => x.items.map(i => i.name).join("")), ["a", "bc", "d", "e"]);
  assert.deepEqual(groupHistory([], now), []);
  // 달·해 경계: 3/1 의 어제는 2/28
  assert.equal(groupHistory([{ at: at(2026, 2, 28) }], at(2026, 3, 1))[0].label, "어제");
  assert.equal(groupHistory([{ at: at(2025, 12, 31) }], at(2026, 1, 1))[0].label, "어제");
});

test("stateLabel", () => {
  assert.deepEqual(["wait", "run", "verify", "ok", "fail", "cancel"].map(stateLabel), ["대기", "진행", "검증 중", "끝", "실패", "취소"]);
  assert.equal(stateLabel("zzz"), "");
});

function fakeClock() {
  let now = 0, id = 0; const q = new Map();
  return {
    setTimeout(f, ms) { q.set(++id, [now + ms, f]); return id; },
    clearTimeout(i) { q.delete(i); },
    tick(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...q].filter(([, [t]]) => t <= end).sort((a, b) => a[1][0] - b[1][0])[0];
        if (!next) break;
        q.delete(next[0]); now = next[1][0]; next[1][1]();
      }
      now = end;
    },
    pending: () => q.size,
  };
}

test("throttle: leading · trailing(마지막 인자) · 창 재시작", () => {
  const c = fakeClock(); const got = [];
  const t = throttle(x => got.push(x), 100, c);
  t(1); assert.deepEqual(got, [1]);
  t(2); t(3); assert.deepEqual(got, [1]);
  c.tick(99); assert.deepEqual(got, [1]);
  c.tick(1); assert.deepEqual(got, [1, 3]);
  t(4); assert.deepEqual(got, [1, 3]);       // 방금 trailing 이 돌아 새 창 안
  c.tick(100); assert.deepEqual(got, [1, 3, 4]);
  c.tick(500); assert.equal(c.pending(), 0);
  t(5); assert.deepEqual(got, [1, 3, 4, 5]); // 쉬었다 오면 바로
});

test("throttle: flush · cancel", () => {
  const c = fakeClock(); const got = [];
  const t = throttle(x => got.push(x), 100, c);
  t.flush(); assert.deepEqual(got, []);       // 밀린 게 없으면 무동작
  t("a"); t("b");
  t.flush(); assert.deepEqual(got, ["a", "b"]);
  c.tick(100); assert.deepEqual(got, ["a", "b"]); // 이미 비웠으니 trailing 없음
  t("c"); t("d"); t.cancel();
  c.tick(1000); assert.deepEqual(got, ["a", "b", "c"]);
  assert.equal(c.pending(), 0);
  t("e"); assert.deepEqual(got, ["a", "b", "c", "e"]);
});

test("throttle: timers 필수 — 없으면 만들 때 던진다(전역 타이머 안 씀)", () => {
  assert.throws(() => throttle(() => {}, 100), /timers/);
  assert.throws(() => throttle(() => {}, 100, {}), /timers/);
  assert.throws(() => throttle(() => {}, 100, { setTimeout() {} }), /timers/);
  // 전역 setTimeout 이 없는 환경(herdr)을 흉내: 주입한 가짜 타이머만으로 돈다.
  const saved = globalThis.setTimeout;
  globalThis.setTimeout = () => { throw new Error("`setTimeout` is not available in the shell"); };
  try {
    const c = fakeClock(); const got = [];
    const t = throttle(x => got.push(x), 50, c);
    t(1); t(2);
    assert.deepEqual(got, [1]);
    c.tick(50); assert.deepEqual(got, [1, 2]);
    t.cancel();
  } finally { globalThis.setTimeout = saved; }
});

test("safeName: 빈 것 · . · .. · / · NUL 거절", () => {
  for (const bad of ["", ".", "..", "/../.zshenv", "a/b", "/a", "a/", "x\0y", "\0", null, undefined, 5, {}]) assert.equal(safeName(bad), false, JSON.stringify(bad));
  for (const ok of ["a.txt", ".zshenv", "...", "..a", "a..", "한글 이름.md", "a b", "a\nb", "a\\b"]) assert.equal(safeName(ok), true, JSON.stringify(ok));
});

test("ownerKeys · alive", () => {
  const k = ownerKeys("o");
  assert.deepEqual(k, ["files-plus.jobs/o", "files-plus.win/o", "files-plus.preview/o", "files-plus.resize/o", "files-plus.tf/o", "files-plus.req/o/preview", "files-plus.ack/o/preview", "files-plus.req/o/jobs", "files-plus.ack/o/jobs", "files-plus.req/o/ask", "files-plus.ack/o/ask"]);
  assert.deepEqual(SOURCES, ["preview", "jobs", "ask"]);
  assert.ok(SOURCES.includes("ask") && k.includes("files-plus.req/o/ask"));
  assert.equal(KEY.win("o"), "files-plus.win/o");
  assert.equal(KEY.tf("o"), "files-plus.tf/o");
  assert.ok(k.includes(KEY.tf("o")), "닫힘 · 죽은 주인 정리가 터미널 파일 진단 키도 치운다");
  const { get, set } = store();
  assert.equal(alive(get, "o"), false);
  set(KEY.jobs("o"), snapshot("o", "", [], 1));
  assert.equal(alive(get, "o"), true);
  for (const key of k) set(key, null);
  assert.equal(alive(get, "o"), false);
});

test("pushHistoryGroup: 적으면 그대로 · 많으면 한 줄로 묶음 · max 지킴", () => {
  const e = i => ({ at: i, dir: "up", name: `f${i}`, size: 5, state: "cancel", where: "", on: "", note: "패널 닫힘" });
  const old = [{ at: 0, name: "old" }];
  assert.deepEqual(pushHistoryGroup(old, [e(1), e(2)]).map(x => x.name), ["f1", "f2", "old"]);
  const many = pushHistoryGroup(old, Array.from({ length: 50 }, (_, i) => e(i + 1)));
  assert.equal(many.length, 6);
  assert.deepEqual(many.map(x => x.name), ["f1", "f2", "f3", "f4", "외 46개", "old"]);
  assert.equal(many[4].state, "cancel");
  assert.equal(pushHistoryGroup(Array.from({ length: 200 }, (_, i) => ({ at: i })), [e(1), e(2)]).length, 200);
  assert.deepEqual(pushHistoryGroup(old, []), old);
  assert.deepEqual(pushHistoryGroup(null, [e(1)]).map(x => x.name), ["f1"]);
});

test("throttle: dropPending 은 밀린 호출만 버린다 — 창은 그대로(즉시 쓰기가 창을 풀지 못함)", () => {
  const c = fakeClock(); const got = [];
  const t = throttle(x => got.push(x), 100, c);
  t(1); t(2);                                   // 1 바로 · 2 밀림
  t.dropPending(); assert.equal(t.hasPending(), false);
  c.tick(100); assert.deepEqual(got, [1]);      // 2 는 버려졌다
  t(3); assert.deepEqual(got, [1, 3]);          // 버려진 trailing 은 새 창을 열지 않는다 → 창이 끝났으니 바로
});

test("throttle: dropPending 뒤에도 창 안의 다음 호출은 밀린다(쓰기 폭주 방지) · flush 는 창을 새로 연다", () => {
  const c = fakeClock(); const got = [];
  const t = throttle(x => got.push(x), 100, c);
  t(1); t.dropPending();                        // 1 바로 · 밀린 것 없음
  c.tick(50); t(2); assert.deepEqual(got, [1]); // 창(100) 안 → 밀림
  t.dropPending(); t(3); t.dropPending(); t(4);
  c.tick(50); assert.deepEqual(got, [1, 4]);    // 창 끝에 마지막 하나만
  t(5); assert.deepEqual(got, [1, 4]);          // 방금 trailing 이 새 창을 열었다
  t.flush(); assert.deepEqual(got, [1, 4, 5]);
  t(6); assert.deepEqual(got, [1, 4, 5]);       // flush 도 새 창
  c.tick(100); assert.deepEqual(got, [1, 4, 5, 6]);
});

test("throttle: ms 가 함수면 창마다 부른다", () => {
  const c = fakeClock(); const got = []; let w = 100;
  const t = throttle(x => got.push(x), () => w, c);
  t(1); t(2); w = 500;
  c.tick(100); assert.deepEqual(got, [1, 2]);   // 두 번째 창은 500
  t(3); c.tick(499); assert.deepEqual(got, [1, 2]);
  c.tick(1); assert.deepEqual(got, [1, 2, 3]);
});

test("own · stateLabel: 프로토타입 키(constructor · __proto__)는 없는 것으로", () => {
  for (const k of ["constructor", "__proto__", "toString", "hasOwnProperty"]) { assert.equal(stateLabel(k), ""); assert.equal(own({ a: 1 }, k), undefined); }
  assert.equal(stateLabel("run"), "진행");
  assert.equal(own({ a: 1 }, "a"), 1);
  assert.equal(own({ a: 1 }, 5), undefined);
  assert.equal(own({ a: 1 }, null), undefined);
});

test("restoreOwner: 저장된 owner 를 잇는다 · 없거나 깨졌으면 새로 짓고 저장 · 겹치면 새로(저장 안 함)", () => {
  const m = new Map(); const st = { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
  const a = restoreOwner(st);
  assert.equal(a.restored, false); assert.match(a.owner, /^[a-z0-9]{8}$/); assert.equal(m.get(OWNER_STORE), a.owner);
  const b = restoreOwner(st);
  assert.deepEqual(b, { owner: a.owner, restored: true });                // 제자리 다시 불러오기: 같은 owner
  const c = restoreOwner(st, new Set([a.owner]));
  assert.notEqual(c.owner, a.owner); assert.equal(m.get(OWNER_STORE), a.owner);   // 겹침: 저장은 그대로
  m.set(OWNER_STORE, "../evil/../x"); const d = restoreOwner(st);   // 깨진 값: 버리고 새로 지어 저장
  assert.match(d.owner, /^[a-z0-9]{8}$/); assert.equal(d.restored, false); assert.equal(m.get(OWNER_STORE), d.owner);
  assert.match(restoreOwner(null).owner, /^[a-z0-9]{8}$/);                // 저장소 없음
  assert.match(restoreOwner({ getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } }).owner, /^[a-z0-9]{8}$/);
});

test("orphanedJobs: wait·run → 실패 · verify → 취소(검증 중) · 끝난 것은 건너뜀(life 없음) · seq = 최대 id", () => {
  const snap = { jobs: [
    { id: 3, dir: "down", name: "a", total: 10, state: "run", on: "m" }, { id: 7, dir: "up", name: "b", total: 0, state: "verify" },
    { id: 5, dir: "up", name: "c", state: "ok" }, { id: 9, dir: "up", name: "d", state: "wait" }, null, { id: "x", state: "run", name: "z" } ] };
  const o = orphanedJobs(snap, 123);
  assert.equal(o.seq, 9);
  assert.deepEqual(o.entries.map(e => [e.name, e.state, e.note, e.size, e.dir, e.on]), [["a", "fail", "다시 불러옴", 10, "down", "m"], ["b", "cancel", "다시 불러옴 · 검증 중", null, "up", ""], ["d", "fail", "다시 불러옴", null, "up", ""], ["z", "fail", "다시 불러옴", null, "up", ""]]);
  assert.deepEqual(orphanedJobs(null, 1), { entries: [], groups: [], seq: 0 });
});

test("pushHistoryGroup: 방향이 섞이면 both · 방향별 개수는 note · 머신이 다르면 on 비움", () => {
  const e = (i, dir, on = "m") => ({ at: i, dir, name: `f${i}`, size: 1, state: "cancel", where: "", on, note: "x" });
  const mixed = pushHistoryGroup([], [e(1, "up"), e(2, "down"), e(3, "up"), e(4, "down"), e(5, "up"), e(6, "up")]);
  assert.equal(mixed.length, 5);
  const g = mixed[4]; assert.equal(g.dir, "both"); assert.equal(g.note, "묶음 · ↑4 ↓2"); assert.equal(g.name, "외 2개"); assert.equal(g.on, "m");
  const ups = pushHistoryGroup([], Array.from({ length: 7 }, (_, i) => e(i, "up")));
  assert.equal(ups[4].dir, "up"); assert.equal(ups[4].note, "묶음");
  const ons = pushHistoryGroup([], [e(1, "up", "a"), e(2, "up", "b"), e(3, "up"), e(4, "up"), e(5, "up"), e(6, "up")]);
  assert.equal(ons[4].on, "");
});

test("partName: 이름 길이와 무관한 고정 길이 · 숨김 · 이름에 따라 다름 · 무작위로 겹치지 않음", () => {
  const long = "가".repeat(85), huge = "x".repeat(255);          // 255 바이트 · 255 글자
  for (const n of [long, huge, "a", "공백 이름.txt"]) {
    const p = partName(n);
    assert.ok(p.startsWith(".") && p.endsWith(".part") && !p.includes("/"));
    assert.ok(Buffer.byteLength(p) <= 40, p);
    assert.ok(Buffer.byteLength(p) + 4 <= 255);
  }
  assert.notEqual(partName("a", "r"), partName("b", "r"));
  assert.equal(partName("a", "r"), partName("a", "r"));
  assert.notEqual(partName("a"), partName("a"));
});

const toxic = () => { throw new TypeError("'toString' is read-only"); };

test("readShared: 던지면 null(또는 onError) · 없으면 null · alive/send/drain 이 견딘다", () => {
  assert.equal(readShared(toxic, "k"), null);
  assert.equal(readShared(toxic, "k", 1), 1);
  assert.equal(readShared(() => undefined, "k"), null);
  assert.equal(readShared(() => 5, "k"), 5);
  assert.equal(alive(toxic, "o"), false);
  const { get, set } = store();
  const bad = k => (k.includes("req") ? toxic() : get(k));
  assert.equal(send(bad, set, "o", "jobs", "clear"), 1);        // 읽기가 던져도 새 목록으로 시작
  assert.deepEqual(drain(bad, set, "o", "jobs"), []);
});

test("요청 id: 안전한 정수 ≥ 1 만 — 1e308 · 소수 · 0 · 음수 · 문자열은 버린다 · 요청함이 멈추지 않는다", () => {
  const { m, get, set } = store();
  m.set(KEY.req("o", "p"), [{ id: 1e308, action: "x" }, { id: 0, action: "z" }, { id: -3, action: "n" }, { id: 1.5, action: "f" }, { id: "2", action: "s" }, { id: Number.MAX_SAFE_INTEGER, action: "m" }, { id: 4, action: "ok" }]);
  assert.deepEqual(drain(get, set, "o", "p").map(e => e.action), ["ok"]);
  m.set(KEY.req("o", "q"), [{ id: 1e308, action: "x" }]);
  assert.equal(send(get, set, "o", "q", "a"), 1);                  // 1e308 은 무시 → 1 부터
  assert.equal(send(get, set, "o", "q", "b"), 2);
  m.set(KEY.ack("o", "r"), 1e308);                                  // 이상한 ack 는 0 으로
  assert.equal(send(get, set, "o", "r", "a"), 1);
});

test("삶 토큰: 주인별 키 · startLife 가 쓰고 · 다른 토큰이 저장되면 낡은 삶 · 저장소 없음/비어 있음은 막지 않는다", () => {
  const st = (() => { const m = new Map(); return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; })();
  const a = startLife(st, "own1"), b = startLife(st, "own1");
  assert.notEqual(a.life, b.life); assert.equal(st.getItem(lifeKey("own1")), b.life); assert.equal(lifeKey("own1"), `${LIFE_STORE}/own1`);
  assert.equal(a.gated, true); assert.equal(b.gated, true);
  assert.equal(lifeCurrent(st, "own1", b.life), true);
  assert.equal(lifeCurrent(st, "own1", a.life), false);              // 새 삶이 토큰을 덮었다 → 옛 삶은 쓰기 금지
  assert.equal(lifeCurrent(null, "own1", a.life), true);
  assert.equal(lifeCurrent({ getItem: () => null }, "own1", a.life), true);
  assert.equal(lifeCurrent({ getItem() { throw new Error("x"); } }, "own1", a.life), true);
  assert.match(startLife(null, "o").life, /^[a-z0-9]{16}$/);
});

test("삶 토큰(M3): 다른 주인의 copy 가 같은 저장소에 써도 서로 굶기지 않는다", () => {
  const st = (() => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; })();
  const a = startLife(st, "aaaaaaaa"), b = startLife(st, "bbbbbbbb");
  assert.equal(lifeCurrent(st, "aaaaaaaa", a.life), true);
  assert.equal(lifeCurrent(st, "bbbbbbbb", b.life), true);
});

test("삶 토큰(M3): 쓴 뒤 읽어 같지 않으면 게이트를 끈다(쓰기 실패 + 옛 토큰 · 읽기 던짐)", () => {
  const stuck = { getItem: () => "OLDTOKEN", setItem() { throw new Error("quota"); } };   // 옛 토큰이 남은 채 쓰기 실패
  const s1 = startLife(stuck, "o");
  assert.equal(s1.gated, false);
  assert.equal(lifeCurrent(stuck, "o", s1.life, s1.gated), true);   // 막히지 않는다
  assert.equal(lifeCurrent(stuck, "o", s1.life, true), false);      // 게이트가 켜져 있었다면 영영 막혔을 상황
  const ignoring = { getItem: () => "OLD", setItem() {} };            // 쓰기는 조용히 무시
  assert.equal(startLife(ignoring, "o").gated, false);
  assert.equal(startLife(null, "o").gated, false);
});

test("orphanedJobs: 끝난 것(기록 전)은 한 번만 · jid 로 중복 제거 · noHistory 제외 · more → 외 N개", () => {
  const snap = { life: "L1", updated: 50, jobs: [
    { id: 1, dir: "down", name: "ok1", total: 5, state: "ok", where: "/d/ok1", on: "m", note: "" },
    { id: 2, dir: "up", name: "bad", state: "fail", note: "x" },
    { id: 3, dir: "up", name: "gone", state: "cancel", note: "취소했다" },
    { id: 4, dir: "down", name: "cache", state: "ok", noHistory: true },
    { id: 5, dir: "down", name: "cache2", state: "run", noHistory: true },
    { id: 6, dir: "down", name: "v", state: "verify" }, { id: 7, dir: "up", name: "w", state: "wait" } ], more: { wait: 40, run: 0, verify: 0, ok: 3 } };
  const o = orphanedJobs(snap, 100, new Set(["L1:2"]));
  assert.deepEqual(o.entries.map(e => [e.name, e.state, e.note, e.jid ?? null]), [
    ["ok1", "ok", "", "L1:1"], ["gone", "cancel", "취소했다", "L1:3"], ["v", "cancel", "다시 불러옴 · 검증 중", "L1:6"], ["w", "fail", "다시 불러옴", "L1:7"], ["외 40개", "fail", "다시 불러옴", null]]);
  assert.equal(o.entries[0].at, 50); assert.equal(o.entries[0].where, "/d/ok1");
  assert.equal(o.seq, 7);
  // 기록에 적은 jid 는 다시 나오지 않는다(seen 대조)
  const hist = o.entries.slice(0, 4);
  const again = orphanedJobs({ ...snap, jobs: snap.jobs.filter(j => ["ok", "fail", "cancel"].includes(j.state)), more: undefined }, 200, seenJids(hist));
  assert.deepEqual(again.entries.map(e => e.name), ["bad"]);       // L1:2 만 hist 에 없다 → 그것만
  assert.equal(orphanedJobs({ jobs: [{ id: 1, state: "ok", name: "x" }] }, 1).entries.length, 0);   // life 없으면 끝난 것은 기록하지 않는다
});

test("orphanedJobs(M1): 이미 기록된 jid 는 wait·run·verify 에서도 건너뛴다", () => {
  const snap = { life: "L", jobs: [{ id: 1, state: "run", name: "r" }, { id: 2, state: "wait", name: "w" }, { id: 3, state: "verify", name: "v" }, { id: 4, state: "ok", name: "o" }, { id: 5, state: "run", name: "n" }] };
  const o = orphanedJobs(snap, 9, new Set(["L:1", "L:2", "L:3", "L:4"]));
  assert.deepEqual(o.entries.map(e => e.name), ["n"]);               // 같은 jid 가 «끝» 과 «실패·다시 불러옴» 으로 두 번 기록되지 않는다
  assert.equal(o.seq, 5);
});

test("orphanedJobs(M2): 상태별로 따로 묶는다 — 취소 1 + 실패 9 + more 50 이 «외 N개 · 취소» 로 뭉개지지 않는다", () => {
  const jobs = [{ id: 1, state: "verify", name: "v" }, ...Array.from({ length: 9 }, (_, i) => ({ id: 10 + i, state: "wait", name: `w${i}` }))];
  const o = orphanedJobs({ life: "L", jobs, more: { wait: 40, run: 10, verify: 2 } }, 5);
  const bySt = o.groups.map(g => [...new Set(g.map(e => e.state))]);
  assert.ok(bySt.every(x => x.length === 1));                       // 묶음마다 상태가 하나
  let hist = [];
  for (const g of o.groups) hist = pushHistoryGroup(hist, g);
  const fails = hist.filter(e => e.state === "fail"), cancels = hist.filter(e => e.state === "cancel");
  assert.deepEqual(fails.map(e => e.name).sort(), ["w0", "w1", "w2", "w3", "외 5개", "외 50개"].sort());   // 9개 → 4 + «외 5개» · more 는 따로 «외 50개»
  assert.deepEqual(cancels.map(e => e.name).sort(), ["v", "외 2개"].sort());
  assert.ok(fails.every(e => e.note === "다시 불러옴" || e.note === "묶음"));
  assert.ok(cancels.every(e => e.note === "다시 불러옴 · 검증 중"));
});

test("send(M7): ack 가 MAX_SAFE_INTEGER 근처면 요청함을 0 에서 다시 시작한다", () => {
  const { m, get, set } = store();
  m.set(KEY.ack("o", "r"), Number.MAX_SAFE_INTEGER - 1);
  m.set(KEY.req("o", "r"), []);
  assert.equal(send(get, set, "o", "r", "a"), 1);
  assert.equal(m.get(KEY.ack("o", "r")), 0);
  assert.deepEqual(drain(get, set, "o", "r").map(r => [r.id, r.action]), [[1, "a"]]);   // 이제 전달된다
  assert.equal(send(get, set, "o", "r", "b"), 2);
});

test("pushHistoryGroup: 접힌 줄이 jids 를 든다 · seenJids 가 둘 다 읽는다", () => {
  const es = Array.from({ length: 8 }, (_, i) => ({ at: i, jid: `L:${i}`, dir: "up", name: `f${i}`, size: 1, state: "cancel", where: "", on: "", note: "" }));
  const h = pushHistoryGroup([], es);
  assert.equal(h.length, 5); assert.equal(h[0].jid, "L:0"); assert.equal(h[4].jid, undefined);
  assert.deepEqual(h[4].jids, ["L:4", "L:5", "L:6", "L:7"]);
  const seen = seenJids(h);
  for (let i = 0; i < 8; i++) assert.ok(seen.has(`L:${i}`));
  assert.equal(seenJids("x").size, 0);
});

test("snapshot 상한: 활성은 run·verify 먼저 + 대기는 id 작은 순 · 끝난 건 keep 개 · more 개수 · summary 는 전체를 센다", () => {
  const jobs = [];
  for (let i = 1000; i >= 1; i--) jobs.push({ id: i, dir: "up", name: `f${i}`, total: 10, done: i === 1 ? 5 : 0, state: i === 1 ? "run" : "wait" });
  for (let i = 0; i < 40; i++) jobs.push({ id: 2000 + i, dir: "down", name: `d${i}`, total: 10, done: 10, state: i < 35 ? "ok" : "fail" });
  const s = snapshot("o", "", jobs, 1, { life: "L", activeCap: 100, keep: 30 });
  assert.equal(s.jobs.length, 130);
  assert.ok(s.jobs.some(j => j.id === 1 && j.state === "run"));
  assert.deepEqual(s.more, { wait: 900, run: 0, verify: 0, ok: 5, fail: 5, cancel: 0, tot: 9050, got: 50 });
  // 잘린 몫을 합친 요약 == 전체 요약
  const full = summary(jobs), cut = summary(s.jobs, s.more);
  assert.deepEqual(cut, full);
  assert.equal(cut.total, 1040);
  assert.ok(JSON.stringify(s).length < 40000);
  const small = snapshot("o", "", jobs.slice(0, 5), 1);
  assert.equal(small.more, undefined);
  assert.equal(snapshot("o", "", [{ id: 1, state: "ok", name: "c", noHistory: true }], 1).jobs[0].noHistory, true);
});

test("previewSpec: window · overlay key 없음(열 때마다 가운데) · keep 없음 · 가운데 at · 크게 보기도 같은 옵션", () => {
  const props = { mode: "preview", owner: "ab12" }, vp = { width: 1600, height: 1000 };
  const a = previewSpec({ mod: "files-plus", owner: "ab12", props, viewport: vp });
  assert.equal(a.kind, "window"); assert.equal(a.frame, "none");
  assert.ok(!("key" in a)); assert.ok(!("keep" in a)); assert.ok(!("modal" in a));     // key 가 있으면 호스트가 놓은 자리를 기억해 at 보다 앞선다
  assert.equal(previewKey("ab12"), "files-plus.preview/ab12");                          // 지금 열린 id 를 두는 shared 키(overlay key 아님)
  assert.deepEqual([a.width, a.height], [0.82, 0.82]); assert.deepEqual(a.at, { x: 144, y: 90 });
  const f = previewSpec({ mod: "files-plus", owner: "ab12", props, full: true, viewport: vp });
  assert.deepEqual([f.width, f.height], [0.98, 0.98]); assert.deepEqual(f.at, { x: 16, y: 10 });
  assert.ok(f.at.x + vp.width * f.width <= vp.width && f.at.y + vp.height * f.height <= vp.height);   // 창 안쪽
  assert.deepEqual({ ...f, width: 0, height: 0, at: 0 }, { ...a, width: 0, height: 0, at: 0 });   // 크기·자리 말고는 같은 옵션
  assert.ok(!("at" in previewSpec({ mod: "m", owner: "o", props })));                              // 크기를 모르면 at 없음(호스트 가운데)
  assert.ok(!("at" in previewSpec({ mod: "m", owner: "o", props, viewport: { width: NaN, height: 5 } })));
});

const VP = { width: 1600, height: 1000 }, SP = { mod: "m", owner: "o", props: {}, viewport: VP };
test("previewSpec: size 는 그 크기로 가운데 · 0.98 상한 · 최소 420×300 · full 은 size 무시", () => {
  const a = previewSpec({ ...SP, size: { w: 800, h: 600 } });
  assert.deepEqual([a.width, a.height, a.at], [800, 600, { x: 400, y: 200 }]);
  const big = previewSpec({ ...SP, size: { w: 5000, h: 5000 } });
  assert.deepEqual([big.width, big.height, big.at], [1568, 980, { x: 16, y: 10 }]);
  const small = previewSpec({ ...SP, size: { w: 10, h: 10 } });
  assert.deepEqual([small.width, small.height], [MIN_W, MIN_H]);
  const f = previewSpec({ ...SP, size: { w: 800, h: 600 }, full: true });
  assert.deepEqual([f.width, f.height], [0.98, 0.98]);
  const nv = previewSpec({ mod: "m", owner: "o", props: {}, size: { w: 800, h: 600 } });       // viewport 모름: 크기만 · at 은 호스트 가운데
  assert.deepEqual([nv.width, nv.height], [800, 600]); assert.ok(!("at" in nv));
});
test("previewSpec: rect 는 그 자리 · 안쪽으로 맞춤 · size 보다 우선 · full 은 무시", () => {
  const r = previewSpec({ ...SP, rect: { x: 100, y: 50, w: 700, h: 500 }, size: { w: 900, h: 900 } });
  assert.deepEqual([r.width, r.height, r.at], [700, 500, { x: 100, y: 50 }]);
  const out = previewSpec({ ...SP, rect: { x: 1500, y: -20, w: 700, h: 500 } });                // 밖으로 나간 x/y → 안쪽
  assert.deepEqual(out.at, { x: 900, y: 0 });
  assert.deepEqual(previewSpec({ ...SP, rect: { x: 0, y: 0, w: 700, h: 500 }, full: true }).at, { x: 16, y: 10 });
});
test("previewSpec: 이상한 값은 기본(0.82)으로", () => {
  for (const bad of [{ w: "800", h: 600 }, { w: -5, h: 600 }, { w: NaN, h: 600 }, { w: 800 }, {}, "x", 5, [], { w: Infinity, h: 5 }]) {
    const s = previewSpec({ ...SP, size: bad, rect: bad });
    assert.deepEqual([s.width, s.height, s.at], [0.82, 0.82, { x: 144, y: 90 }], JSON.stringify(bad));
  }
});
test("fitSize · clampRect: 경계값", () => {
  assert.deepEqual(fitSize({ w: 420, h: 300 }, VP), { w: 420, h: 300 });
  assert.deepEqual(fitSize({ w: 419.4, h: 299 }, VP), { w: 420, h: 300 });
  assert.deepEqual(fitSize({ w: 1568, h: 980 }, VP), { w: 1568, h: 980 });
  assert.deepEqual(fitSize({ w: 1569, h: 981 }, VP), { w: 1568, h: 980 });
  assert.deepEqual(fitSize({ w: 700.6, h: 500.4 }), { w: 701, h: 500 });             // viewport 없으면 상한 없음
  assert.deepEqual(fitSize({ w: 9999, h: 9999 }, { width: 300, height: 200 }), { w: 294, h: 196 });   // viewport 가 최소보다 작으면 viewport 우선
  assert.equal(fitSize({ w: 0, h: 5 }, VP), null); assert.equal(fitSize(null, VP), null);
  assert.deepEqual(clampRect({ x: 0, y: 0, w: 1600, h: 1000 }, VP), { x: 0, y: 0, w: 1600, h: 1000 });
  assert.deepEqual(clampRect({ x: 50, y: 50, w: 2000, h: 2000 }, VP), { x: 0, y: 0, w: 1600, h: 1000 });
  assert.deepEqual(clampRect({ x: 1300, y: 900, w: 500, h: 400 }, VP), { x: 1100, y: 600, w: 500, h: 400 });
  assert.deepEqual(clampRect({ x: -5, y: -5, w: 100, h: 100 }, VP), { x: 0, y: 0, w: MIN_W, h: MIN_H });
  assert.deepEqual(clampRect({ x: -5, y: 7.6, w: 500.4, h: 400 }), { x: 0, y: 8, w: 500, h: 400 });
  assert.deepEqual(clampRect({ w: 500, h: 400 }, VP), { x: 0, y: 0, w: 500, h: 400 });
  assert.equal(clampRect({ x: 0, y: 0, w: "a", h: 5 }, VP), null);
});
test("fitSize · clampRect · previewSpec: viewport 를 모르면 절대 상한(오염된 값 방어)", () => {
  assert.deepEqual(fitSize({ w: 1e9, h: 1e9 }), { w: ABS_MAX, h: ABS_MAX });
  assert.deepEqual(clampRect({ x: 1e9, y: 1e9, w: 1e9, h: 1e9 }), { x: ABS_MAX, y: ABS_MAX, w: ABS_MAX, h: ABS_MAX });
  assert.deepEqual(fitSize({ w: 700, h: 500 }), { w: 700, h: 500 });
  const s = previewSpec({ mod: "m", owner: "o", props: {}, size: { w: 1e9, h: 5e8 } });
  assert.deepEqual([s.width, s.height], [ABS_MAX, ABS_MAX]); assert.ok(!("at" in s));
  assert.equal(KEY.resize("ab"), "files-plus.resize/ab");
  assert.ok(ownerKeys("ab").includes(KEY.resize("ab")), "닫힘 · 죽은 주인 정리가 이 키도 치운다");
});
test("dragRect: 축별 · 최소 · 왼쪽 위 기준 앱 창 밖 금지", () => {
  const st = { x: 100, y: 50, w: 800, h: 600 };
  assert.deepEqual(dragRect(st, "x", 100, 999, VP), { x: 100, y: 50, w: 900, h: 600 });
  assert.deepEqual(dragRect(st, "y", 999, 100, VP), { x: 100, y: 50, w: 800, h: 700 });
  assert.deepEqual(dragRect(st, "xy", -9999, -9999, VP), { x: 100, y: 50, w: MIN_W, h: MIN_H });
  assert.deepEqual(dragRect(st, "xy", 9999, 9999, VP), { x: 100, y: 50, w: 1500, h: 950 });
  assert.deepEqual(dragRect(st, "xy", 9999, 9999), { x: 100, y: 50, w: ABS_MAX, h: ABS_MAX });   // viewport 모름 → 절대 상한
  assert.deepEqual(dragRect(st, "xy", NaN, NaN, VP), st);
  assert.equal(dragRect({ w: "a" }, "x", 1, 1, VP), null);
});
test("stepFont · fontOf: 단계 · 경계 · 기본 · 단계 밖 값", () => {
  assert.equal(stepFont(13, 1, "md"), 14); assert.equal(stepFont(13, -1, "md"), 12);
  assert.equal(stepFont(16, 1), 18); assert.equal(stepFont(18, -1), 16);
  assert.equal(stepFont(32, 1), 32); assert.equal(stepFont(9, -1), 9);                 // 끝에서 멈춤
  assert.equal(stepFont(24, 0, "md"), 13); assert.equal(stepFont(24, 0, "code"), 12);
  assert.equal(stepFont(17, 1), 18); assert.equal(stepFont(17, -1), 16);               // 단계 밖: 그 방향의 가장 가까운 단계
  assert.equal(stepFont(5, 1), 9); assert.equal(stepFont(99, -1), 32);
  assert.equal(stepFont(NaN, 1, "code"), 12); assert.equal(stepFont("x", -1, "md"), 13);
  let v = 9; for (let i = 0; i < 30; i++) v = stepFont(v, 1); assert.equal(v, 32);
  assert.equal(FONT_STEPS.length, 14);
  assert.deepEqual(fontOf(null), { md: 13, code: 12 });
  assert.deepEqual(fontOf({ md: 20, code: 8 }), { md: 20, code: 12 });                  // 범위 밖은 기본
  assert.deepEqual(fontOf({ md: "20", code: NaN }), { md: 13, code: 12 });
  assert.equal(KEY.previewSize, "files-plus.previewSize"); assert.equal(KEY.fontSize, "files-plus.fontSize");
});

const PART = "/Users/x/Downloads/.0a1b2c3d.files-plus-k9x8w7v6.part";
test("isPartPath · partName: 조각 이름 꼴만(절대 경로 · 폴더 이탈 없음)", () => {
  assert.equal(isPartPath(PART), true);
  assert.equal(isPartPath(`/d/${partName("a b.txt")}`), true);
  assert.equal(isPartPath(`/d/${partName("x".repeat(255))}`), true);
  for (const bad of ["rel/.0a1b2c3d.files-plus-k9x8w7v6.part", "/Users/x/Downloads", "/Users/x/Downloads/", "/Users/x/a.part", "/Users/x/.0a1b2c3d.files-plus-k9x8w7v6.part.bak",
    "/Users/x/.0A1B2C3D.files-plus-k9x8w7v6.part", "/Users/x/.0a1b2c3.files-plus-k9x8w7v6.part", "/Users/x/.0a1b2c3d.files-plus-k9x8w7v.part", "/Users/x/..0a1b2c3d.files-plus-k9x8w7v6.part",
    "/Users/../.0a1b2c3d.files-plus-k9x8w7v6.part", "/Users/x/y.0a1b2c3d.files-plus-k9x8w7v6.part", "/Users/x/.0a1b2c3d.files-plus-k9x8w7v6.part\0", "/Users/x\n/.0a1b2c3d.files-plus-k9x8w7v6.part", "/", "", null, 5, {}])
    assert.equal(isPartPath(bad), false, JSON.stringify(bad));
});

test("snapshot · orphanParts: 도는(run) 작업의 조각만 · 죽은 삶만 · 정확한 경로만", () => {
  const jobs = [
    { id: 1, dir: "down", name: "a", state: "run", part: PART, partOn: null },
    { id: 2, dir: "up", name: "b", state: "run", part: "/srv/.11111111.files-plus-abcdefgh.part", partOn: "box" },
    { id: 3, dir: "down", name: "c", state: "wait", part: PART },                          // 아직 조각 없음
    { id: 4, dir: "down", name: "d", state: "verify", part: "/Users/x/.22222222.files-plus-abcdefgh.part" },   // 자리 잡기가 돌 수 있다
    { id: 5, dir: "down", name: "e", state: "run", part: "/Users/x/Downloads" },           // 조각 꼴 아님
    { id: 6, dir: "down", name: "f", state: "run", part: "/Users/x/../../etc/passwd" },
    { id: 7, dir: "down", name: "g", state: "ok", part: PART },
    { id: 8, dir: "down", name: "h", state: "run", part: PART, partOn: "" },               // 같은 경로 중복
    { id: 9, dir: "down", name: "i", state: "run" },                                       // 기록 없음
  ];
  const snap = snapshot("o", "", jobs, 1, { life: "OLD" });
  assert.equal(snap.jobs[0].part, PART); assert.equal(snap.jobs[0].partOn, null); assert.equal(snap.jobs[1].partOn, "box");
  for (const i of [2, 3, 4, 5, 6, 8]) assert.ok(!("part" in snap.jobs[i]), `job ${jobs[i].id}`);     // run 이면서 조각 꼴일 때만 싣는다
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap);
  assert.deepEqual(orphanParts(snap, "NEW"), [{ path: PART, on: null }, { path: "/srv/.11111111.files-plus-abcdefgh.part", on: "box" }]);
  assert.deepEqual(orphanParts(snap, "OLD"), []);                  // 지금 삶 = 살아 있다 → 건드리지 않는다
  assert.deepEqual(orphanParts({ ...snap, life: "" }, "NEW"), []);
  assert.deepEqual(orphanParts(null, "NEW"), []); assert.deepEqual(orphanParts({ life: "L", jobs: "x" }, "N"), []);
  // 손으로 만든(믿지 못할) 스냅샷도 같은 거름을 거친다
  assert.deepEqual(orphanParts({ life: "L", jobs: jobs.slice(2) }, "N"), [{ path: PART, on: null }]);
});

// E5: previewKey 의 값 {id, at} — 2 s 안(살아 있는 미리보기)일 때만 옛 id 를 닫는다
test("E5: previewEntry · livePreviewId — 살아 있는 id 만", () => {
  const now = 1_000_000;
  assert.deepEqual(previewEntry({ id: "ov1", at: now }), { id: "ov1", at: now });
  assert.deepEqual(previewEntry("ov9"), { id: "ov9", at: 0 });                                 // 옛 꼴(문자열) = 시각 모름
  for (const bad of [null, undefined, "", {}, { id: "" }, { id: 5 }, 5, []]) assert.equal(previewEntry(bad), null, JSON.stringify(bad));
  assert.equal(livePreviewId({ id: "a", at: now - 500 }, now), "a");
  assert.equal(livePreviewId({ id: "a", at: now - PREVIEW_TTL }, now), "a");                  // 경계 포함
  assert.equal(livePreviewId({ id: "a", at: now - PREVIEW_TTL - 1 }, now), null);              // 낡음 → 닫지 않는다
  assert.equal(livePreviewId({ id: "a", at: now + 5000 }, now), null);                         // 미래 시각 = 이상 → 낡은 것 취급
  assert.equal(livePreviewId("ov9", now), null); assert.equal(livePreviewId({ id: "a" }, now), null);
  assert.equal(livePreviewId(null, now), null); assert.equal(livePreviewId({ id: "a", at: now }, NaN), null);
  assert.equal(previewId({ id: "a", at: 1 }), "a"); assert.equal(previewId("b"), "b"); assert.equal(previewId(null), null);
});

// E4: 닫힘이 남기는 조각 목록
test("E4: closingParts · pendingParts — 도는 작업의 정확한 경로만 · 상한 · 살아 있는 작업은 제외", () => {
  const P1 = "/Users/x/Downloads/.0a1b2c3d.files-plus-k9x8w7v6.part", P2 = "/srv/.11111111.files-plus-abcdefgh.part";
  assert.equal(partsKey("ab"), "files-plus.parts/ab");
  assert.ok(!ownerKeys("ab").includes(partsKey("ab")), "닫힘이 이 키를 치우면 안 된다");
  const jobs = [{ state: "run", part: P1, partOn: null }, { state: "run", part: P2, partOn: "box" }, { state: "wait", part: P1 }, { state: "run", part: P1, ended: true },
    { state: "run", part: "/Users/x/Downloads" }, { state: "verify", part: P1 }, { state: "run", part: P1, partOn: "" }, null];
  assert.deepEqual(closingParts(jobs), [{ path: P1, on: null }, { path: P2, on: "box" }]);
  assert.deepEqual(closingParts([{ state: "run", part: P2, partOn: "box" }], [{ path: P1, on: null }, { path: "/etc/passwd", on: null }, null, "x"]), [{ path: P1, on: null }, { path: P2, on: "box" }]);
  const many = Array.from({ length: 120 }, (_, i) => ({ state: "run", part: `/d/.${i.toString(16).padStart(8, "0")}.files-plus-abcdefgh.part` }));
  assert.equal(closingParts(many).length, PARTS_CAP);
  assert.equal(closingParts(many)[PARTS_CAP - 1].path, many[119].part); assert.equal(closingParts(many)[0].path, many[120 - PARTS_CAP].part);   // G7: 넘치면 가장 새 것을 남긴다
  assert.deepEqual(pendingParts([{ path: P1, on: null }, { path: P2, on: "box" }, { path: "/x", on: null }], [{ part: P1 }]), [{ path: P2, on: "box" }]);   // 이 삶의 살아 있는 작업 경로는 건너뜀
  assert.deepEqual(pendingParts(null), []); assert.deepEqual(pendingParts("x"), []);
});

// G8: 미리보기 heartbeat 는 1.5 s 마다 쓰므로 TTL 은 5 s(세 번 건너뛰어도 살아 있음).
test("G8: PREVIEW_TTL 5 s — 1.5 s 박자 세 번을 놓쳐도 산 것", () => {
  const now = 1_000_000;
  assert.equal(PREVIEW_TTL, 5000);
  assert.equal(livePreviewId({ id: "a", at: now - 4500 }, now), "a");
  assert.equal(livePreviewId({ id: "a", at: now - 5001 }, now), null);
});

// G3: 주인 등록부 — 산 주인 · 죽은 주인 가르기 · 뒷정리 계획
test("G3: normalizeOwners · registerOwner · dropOwners — 꼴 검사 · 상한 20 · 내 것은 남는다", () => {
  assert.equal(OWNERS_KEY, "files-plus.owners"); assert.equal(OWNER_BEAT_MS, 15000); assert.equal(OWNER_DEAD_MS, 60000);
  assert.deepEqual(normalizeOwners([{ owner: "abcd1234", at: 5 }, { owner: "abcd1234", at: 9 }, { owner: "BAD", at: 1 }, { owner: "zzzz9999" }, { owner: "qqqq1111", at: NaN }, null, 7, { at: 3 }]),
    [{ owner: "abcd1234", at: 5 }, { owner: "zzzz9999", at: null }, { owner: "qqqq1111", at: null }]);
  assert.deepEqual(normalizeOwners(null), []); assert.deepEqual(normalizeOwners("x"), []); assert.deepEqual(normalizeOwners({}), []);
  assert.deepEqual(registerOwner(null, "mine0001", 100), [{ owner: "mine0001", at: 100 }]);
  assert.deepEqual(registerOwner([{ owner: "mine0001", at: 1 }, { owner: "othr0002", at: 2 }], "mine0001", 100), [{ owner: "othr0002", at: 2 }, { owner: "mine0001", at: 100 }]);
  const many = Array.from({ length: 30 }, (_, i) => ({ owner: `o${String(i).padStart(7, "0")}`, at: i + 1 }));
  const reg = registerOwner(many, "mine0001", 999);
  assert.equal(reg.length, OWNERS_CAP); assert.ok(reg.some(e => e.owner === "mine0001" && e.at === 999));
  assert.ok(normalizeOwners(many).length <= OWNERS_CAP);
  assert.deepEqual(dropOwners([{ owner: "aaaaaaaa", at: 1 }, { owner: "bbbbbbbb", at: 2 }], ["aaaaaaaa"]), [{ owner: "bbbbbbbb", at: 2 }]);
});

test("G3: deadOwners — 내 것 · LIVE · 최근 at 은 산 것 / 60 s 넘게 갱신 없는 남은 죽은 것 / 쓰레기·미래 at 은 처음 본 때 기준", () => {
  const now = 10_000_000, mine = "mine0001";
  const list = [{ owner: mine, at: now - 999999 }, { owner: "live0002", at: now - 999999 }, { owner: "fresh003", at: now - 59999 }, { owner: "edge0004", at: now - 60000 },
    { owner: "dead0005", at: now - 60001 }, { owner: "dead0006", at: 0 }, { owner: "futr0007", at: now + 30000 }, { owner: "futr0008", at: now + 3_600_000 }, { owner: "garb0009" }];
  const live = new Set(["live0002"]);
  // 처음 본 때를 모르면(첫 훑기) 쓰레기·먼 미래는 아직 죽은 것으로 보지 않는다 — 보수적
  assert.deepEqual(deadOwners(list, { mine, live, now }), ["dead0005", "dead0006"]);
  assert.deepEqual(deadOwners(list, { mine, live, now, firstSeen: new Map([["futr0008", now - 61000], ["garb0009", now - 30000]]) }), ["dead0005", "dead0006", "futr0008"]);
  assert.deepEqual(deadOwners(list, { mine, live, now, firstSeen: new Map([["futr0008", now - 61000], ["garb0009", now - 61000], ["futr0007", now - 99999]]) }), ["dead0005", "dead0006", "futr0008", "garb0009"]);
  assert.deepEqual(deadOwners(null, { mine, now }), []);
  assert.deepEqual(deadOwners([{ owner: mine, at: 0 }], { mine, now }), []);                                       // 내 것은 절대 아니다
});

test("G3: ownerCleanupPlan — 끝나지 못한 작업 → 기록 · 조각 · 키 전부 · jid 중복 제외", () => {
  const P1 = "/Users/x/Downloads/.0a1b2c3d.files-plus-k9x8w7v6.part", P2 = "/srv/.11111111.files-plus-abcdefgh.part", P3 = "/tmp/.22222222.files-plus-zzzzzzzz.part";
  const snap = { owner: "dead0005", life: "LIFEAAAA", updated: 5, jobs: [
    { id: 1, dir: "down", name: "a.bin", state: "run", part: P1, partOn: null, total: 10 },
    { id: 2, dir: "up", name: "b.bin", state: "run", part: P2, partOn: "box", total: 20 },
    { id: 3, dir: "down", name: "c.bin", state: "verify", part: P3 },
    { id: 4, dir: "down", name: "d.bin", state: "wait" },
    { id: 5, dir: "down", name: "e.bin", state: "ok", where: "/x" }] };
  const plan = ownerCleanupPlan({ owner: "dead0005", snap, partsList: [{ path: P1, on: null }, { path: "/etc/passwd", on: null }, { path: P3, on: null }], seen: new Set(["LIFEAAAA:5"]), now: 99 });
  assert.equal(plan.owner, "dead0005");
  assert.deepEqual(plan.parts, [{ path: P1, on: null }, { path: P2, on: "box" }, { path: P3, on: null }]);          // run 의 조각 + parts 목록(중복 제외 · 조각 꼴만) · verify 의 조각은 parts 목록에 있을 때만
  const names = plan.groups.flat().map(e => `${e.name}:${e.state}`).sort();
  assert.deepEqual(names, ["a.bin:fail", "b.bin:fail", "c.bin:cancel", "d.bin:fail"]);                               // 5번(ok)은 기록에 이미 있다
  assert.ok(plan.groups.flat().every(e => e.jid.startsWith("LIFEAAAA:")));
  for (const k of ownerKeys("dead0005")) assert.ok(plan.keys.includes(k), k);
  assert.ok(plan.keys.includes(partsKey("dead0005")));
  assert.ok(!plan.keys.some(k => k.includes("mine0001")));
  const none = ownerCleanupPlan({ owner: "dead0006", snap: null, partsList: null, now: 1 });
  assert.deepEqual([none.groups, none.parts], [[], []]); assert.equal(none.keys.length, ownerKeys("dead0006").length + 1);
});

// ---- 크기 틀 키(KEY.resize) 보조 함수
import { RESIZE_REFRESH_MS, RESIZE_SLACK, resizeEntry, resizeEntryOf, resizeLive, resizeFrameId } from "../files-plus/state.js";
test("resizeEntry · resizeEntryOf: 틀 id 는 있을 때만 · 이상한 값은 null", () => {
  assert.deepEqual(resizeEntry("pv", "rf", 5), { id: "pv", frame: "rf", at: 5 });
  assert.deepEqual(resizeEntry("pv", null, 5), { id: "pv", at: 5 });
  assert.deepEqual(resizeEntry("pv", "", 5), { id: "pv", at: 5 });
  assert.deepEqual(resizeEntryOf({ id: "pv", frame: "rf", at: 7 }), { id: "pv", frame: "rf", at: 7 });
  assert.deepEqual(resizeEntryOf({ id: "pv", at: 7 }), { id: "pv", frame: null, at: 7 });
  assert.ok(Number.isNaN(resizeEntryOf({ id: "pv" }).at));
  for (const bad of [null, undefined, "pv", 3, {}, { id: "" }, { id: 4, at: 1 }]) assert.equal(resizeEntryOf(bad), null);
});
test("resizeLive: 이 미리보기 것 · 한도 안일 때만(갱신 5 s 마다면 20 s 넘는 끌기도 산다)", () => {
  const lim = 15000 + RESIZE_SLACK;
  assert.equal(RESIZE_REFRESH_MS, 5000);
  assert.ok(resizeLive({ id: "pv", at: 1000 }, "pv", 1000 + lim - 1, lim));
  assert.ok(!resizeLive({ id: "pv", at: 1000 }, "pv", 1000 + lim, lim));
  assert.ok(!resizeLive({ id: "pv", at: 1000 }, "other", 1000, lim));
  assert.ok(!resizeLive({ id: "pv" }, "pv", 1000, lim));                 // at 없음
  assert.ok(!resizeLive(null, "pv", 1000, lim) && !resizeLive({ id: "pv", at: 1000 }, "", 1000, lim));
  // 60 s 끌기: 5 s 마다 at 갱신 → 어느 시점에도 낡지 않는다
  let at = 0, ok = true;
  for (let t = 0; t <= 60000; t += 100) { if (t - at >= RESIZE_REFRESH_MS) at = t; if (!resizeLive({ id: "pv", at }, "pv", t, lim)) ok = false; }
  assert.ok(ok);
});
test("resizeFrameId: 이 미리보기 것일 때만 틀 id", () => {
  assert.equal(resizeFrameId({ id: "pv", frame: "rf", at: 1 }, "pv"), "rf");
  assert.equal(resizeFrameId({ id: "pv", frame: "rf", at: 1 }, "x"), null);
  assert.equal(resizeFrameId({ id: "pv", at: 1 }, "pv"), null);
  assert.equal(resizeFrameId(null, "pv"), null);
});
