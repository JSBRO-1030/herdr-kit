// files-plus 파일 다루기(fsops.js) 시험 — 순수 함수는 그대로, 스크립트는 진짜 /bin/sh 로 임시 폴더에서 돌린다.
//   node --test mods/tests/fsops.test.mjs
// 실제 사용자 휴지통·홈은 건드리지 않는다: 휴지통 도구는 PATH 앞의 가짜(인자를 임시 «휴지통» 폴더로 mv) · HOME 은 임시 폴더로 덮는다.
// macOS 의 진짜 /usr/bin/trash 는 FP_REAL_TRASH=1 일 때만 돈다(그 사용자의 휴지통에 임시 파일 하나가 들어간다 — VM 에서만 켠다).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, readdir, mkdir, rm, chmod, stat, symlink, link, lstat, readlink } from "node:fs/promises";
import { existsSync, accessSync, constants, readFileSync, openSync, closeSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import {
  MKDIR, RENAME, PROBE, REMOVE, TOOLS, utf8Len, nameProblem, relOk, parentRel, joinAbs, placeLabel, opPlan, putTicket, takeTicket, TICKET_TTL, TICKET_MAX,
  renameTree, dropTree, sortEntries, withEntry, withoutEntry, renamedEntry, freeName, stemRange, menuItems, askProps, askSpec, menuSpec, parseProbe, opError,
  idOk, askProblem, submitPlan, ENTER_GUARD_MS,
} from "../files-plus/fsops.js";
import { SOURCES, ownerKeys } from "../files-plus/state.js";

const base = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "fsops-"));
after(() => rm(base, { recursive: true, force: true }));
const IS_ROOT = process.getuid?.() === 0;
const NAMES = [`a b'c"$(x) \`y\``, "-rf", "한글 이름", "x\ny", ".hid den"];
let seq = 0;
const fresh = async (name = "d") => { const d = join(base, `${name}-${++seq}`); await mkdir(d); return d; };

// sh -c SCRIPT files-plus <args…> — mod 이 쓰는 그대로.
// killMs > 0 이면 그 시간 뒤 SIGKILL — 멈추는 스크립트가 시험을 붙잡지 않게(결과에 killed).
function sh(script, args = [], env = {}, killMs = 0) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.FP_SH || "/bin/sh", ["-c", script, "files-plus", ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    const out = [], err = [];
    p.stdout.on("data", d => out.push(d)); p.stderr.on("data", d => err.push(d));
    p.on("error", reject);
    let killed = false, done = false;
    const fin = (code) => { if (done) return; done = true; if (timer) clearTimeout(timer); resolve({ killed, code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") }); };
    // 시간이 지나면 죽이고 바로 끝낸다(멈춘 하위 프로세스가 파이프를 쥐고 있어도 «close» 를 기다리지 않는다)
    const timer = killMs ? setTimeout(() => { killed = true; p.kill("SIGKILL"); fin(null); }, killMs) : null;
    p.on("close", fin);
  });
}
// REMOVE 는 PROBE 가 본 id 를 받는다 — id 를 안 주면 같은 PATH/HOME 으로 PROBE 를 돌려 얻는다(못 얻으면 아무 값).
async function rmv(tool, t, env, id) {
  id ??= parseProbe((await sh(PROBE, [t], env)).stdout)?.id ?? "f:0:0";
  return sh(REMOVE, [tool, t, id], env);
}
const which = t => process.env.PATH.split(delimiter).map(d => join(d, t)).find(p => { try { accessSync(p, constants.X_OK); return true; } catch { return false; } });
// 임시 bin: 필요한 도구만 심볼릭 링크 + 가짜 uname(리눅스인 척 — macOS 의 진짜 /usr/bin/trash 가 골라지지 않게) + 가짜 도구들. PATH 를 이것 하나로 둔다.
async function mkBin(fakes = {}) {
  const dir = await fresh("bin");
  // [경고] 가짜와 같은 이름의 진짜 도구는 링크하지 않는다 — 링크 위에 writeFile 하면 진짜 도구를 덮어쓴다.
  for (const t of ["find", "tr", "head", "wc", "tail", "rm", "mv", "ls", "mkdir", "cat", "sh", "stat", "awk"]) { const p = which(t); if (p && !(t in fakes)) await symlink(p, join(dir, t)); }
  await writeFile(join(dir, "uname"), "#!/bin/sh\necho Linux\n", { mode: 0o755 });
  for (const [k, body] of Object.entries(fakes)) { await rm(join(dir, k), { force: true }); await writeFile(join(dir, k), `#!/bin/sh\n${body}\n`, { mode: 0o755 }); }
  return dir;
}
// 가짜 휴지통 도구: 받은 인자를 FP_LOG 에 한 줄로 적고, 마지막 인자(대상)를 FP_TRASH 폴더로 mv.
const LOGIT = '[ -n "$FP_LOG" ] && printf "%s\\n" "$*" >> "$FP_LOG"';
const TAKE = 'for a; do :; done; mv -- "$a" "$FP_TRASH/"';
const FAKE_GIO = `${LOGIT}; [ "$1" = trash ] || exit 9; shift; [ "$1" = -- ] || exit 9; ${TAKE}`;
const FAKE_PUT = `${LOGIT}; [ "$1" = -- ] || exit 9; ${TAKE}`;
const list = async d => (await readdir(d)).sort();

// ── 순수 ─────────────────────────────────────────────────────────────
test("utf8Len: 한글 3 · 이모지 4 · ASCII 1", () => {
  assert.equal(utf8Len("abc"), 3); assert.equal(utf8Len("한글"), 6); assert.equal(utf8Len("😀"), 4); assert.equal(utf8Len("é"), 2); assert.equal(utf8Len(""), 0);
});

test("nameProblem: 빈 것 · 공백 · . · .. · / · 제어 문자 · 255/256 바이트", () => {
  for (const bad of ["", "   ", "\t", ".", "..", "a/b", "/", "a\nb", "a\u007fb", "a\u0000b", "a\u001fb", null, undefined, 5, {}]) assert.notEqual(nameProblem(bad), null, JSON.stringify(bad));
  assert.equal(nameProblem(""), "이름이 비었다"); assert.equal(nameProblem("  "), "이름이 비었다");
  assert.equal(nameProblem(".."), "쓸 수 없는 이름이다"); assert.equal(nameProblem("a/b"), "이름에 / 를 쓸 수 없다");
  assert.equal(nameProblem("a\nb"), "이름에 줄바꿈·제어 문자를 쓸 수 없다");
  const ok255 = "가".repeat(85), ok256 = "가".repeat(85) + "a";           // 255 · 256 바이트
  assert.equal(utf8Len(ok255), 255); assert.equal(nameProblem(ok255), null);
  assert.equal(nameProblem(ok256), "이름이 너무 길다(255바이트까지)");
  for (const ok of ["a.txt", ".bashrc", "한글 이름", "-rf", "a b", "...", "..a", `a'b"c$x`]) assert.equal(nameProblem(ok), null, ok);
});

test("relOk: .. 조각 · 빈 조각 · a//b · NUL · 제어 문자", () => {
  assert.equal(relOk("", { allowEmpty: true }), true); assert.equal(relOk(""), false);
  for (const bad of ["..", "a/..", "../a", "a//b", "/a", "a/", "a\0b", "a\nb", ".", "a/./b", 5, null, undefined, "x".repeat(4096)]) assert.equal(relOk(bad, { allowEmpty: true }), false, JSON.stringify(bad));
  for (const ok of ["a", "a/b", "한글/b c", ".hid/.den", "a...b", "x".repeat(4000)]) assert.equal(relOk(ok), true, ok);
});

test("parentRel · joinAbs · placeLabel", () => {
  assert.equal(parentRel("a"), ""); assert.equal(parentRel("a/b/c"), "a/b");
  assert.equal(joinAbs("/", "a"), "/a"); assert.equal(joinAbs("/r", "a/b"), "/r/a/b"); assert.equal(joinAbs("/r", ""), "/r"); assert.equal(joinAbs("/", ""), "/");
  assert.equal(placeLabel(null, "/x"), "이 컴퓨터 · /x"); assert.equal(placeLabel("m1", "/x"), "m1:/x");
});

test("opPlan: mkdir — 부모 규칙 · 이름 · 티켓 값 재검사", () => {
  const T = (o = {}) => ({ root: "/r", on: null, rel: "", dir: true, name: "", context: {}, at: 1, ...o });
  let v = opPlan("mkdir", T(), { name: "새" });
  assert.deepEqual([v.ok, v.dirAbs, v.parentRel, v.newRel, v.args, v.script === MKDIR, v.timeout, v.on], [true, "/r", "", "새", ["/r", "새"], true, 15000, null]);
  v = opPlan("mkdir", T({ rel: "a/b", dir: true }), { name: "n" }); assert.deepEqual([v.dirAbs, v.parentRel, v.newRel], ["/r/a/b", "a/b", "a/b/n"]);
  v = opPlan("mkdir", T({ rel: "a/f.txt", dir: false }), { name: "n" }); assert.deepEqual([v.dirAbs, v.parentRel, v.newRel], ["/r/a", "a", "a/n"]);   // 파일 줄 = 그 폴더 안
  v = opPlan("mkdir", T({ root: "/", rel: "", dir: true }), { name: "n" }); assert.equal(v.dirAbs, "/");
  assert.equal(opPlan("mkdir", T({ on: "" }), { name: "n" }).ok, false);
  assert.equal(opPlan("mkdir", T({ on: "m1" }), { name: "n" }).on, "m1");
  for (const bad of [{ root: "r" }, { root: "/r\0" }, { root: 5 }, { rel: "../x" }, { rel: "a//b" }, { rel: 5 }, { on: 5 }]) assert.equal(opPlan("mkdir", T(bad), { name: "n" }).ok, false, JSON.stringify(bad));
  for (const bad of ["", " ", "a/b", "..", "a\nb", " a", "a ", undefined, 5]) assert.equal(opPlan("mkdir", T(), { name: bad }).ok, false, JSON.stringify(bad));
  assert.equal(opPlan("mkdir", T(), { name: " a" }).why, "이름 앞뒤에 공백을 둘 수 없다");
  assert.equal(opPlan("mkdir", null, { name: "n" }).ok, false); assert.equal(opPlan("zap", T(), {}).ok, false);
});

test("opPlan: rename · delete — rel 비면 거절 · 도구 검사 · 새 경로", () => {
  const T = (o = {}) => ({ root: "/r", on: "m1", rel: "a/b.txt", dir: false, name: "b.txt", context: {}, at: 1, ...o });
  let v = opPlan("rename", T(), { to: "c.md" });
  assert.deepEqual([v.ok, v.dirAbs, v.from, v.to, v.rel, v.parentRel, v.newRel, v.args, v.isDir, v.on], [true, "/r/a", "b.txt", "c.md", "a/b.txt", "a", "a/c.md", ["/r/a", "b.txt", "c.md"], false, "m1"]);
  v = opPlan("rename", T({ rel: "top", dir: true }), { to: "t2" }); assert.deepEqual([v.dirAbs, v.newRel, v.isDir], ["/r", "t2", true]);
  assert.equal(opPlan("rename", T({ rel: "" }), { to: "x" }).ok, false);
  assert.equal(opPlan("rename", T(), { to: "b.txt" }).ok, false);        // 같은 이름은 대화창이 걸러 닫는다
  assert.equal(opPlan("rename", T(), { to: "a/x" }).ok, false);
  assert.equal(opPlan("rename", T(), { to: "x " }).ok, false);
  const ID = "f:16777230:12345";
  v = opPlan("delete", T(), { tool: "gio", id: ID });
  assert.deepEqual([v.ok, v.abs, v.tool, v.id, v.args, v.timeout, v.name, v.parentRel], [true, "/r/a/b.txt", "gio", ID, ["gio", "/r/a/b.txt", ID], 60000, "b.txt", "a"]);
  assert.equal(opPlan("delete", T(), { tool: "none", id: ID }).timeout, 600000);
  assert.equal(opPlan("delete", T({ rel: "" }), { tool: "gio", id: ID }).ok, false);
  for (const bad of ["rm", "", undefined, 5, "TRASH", "gio "]) assert.equal(opPlan("delete", T(), { tool: bad, id: ID }).ok, false, JSON.stringify(bad));
  for (const tool of TOOLS) assert.equal(opPlan("delete", T(), { tool, id: ID }).ok, true);
  assert.equal(opPlan("delete", T({ rel: "a/../b" }), { tool: "gio", id: ID }).ok, false);
  assert.equal(opPlan("delete", T({ root: "/" , rel: "x" }), { tool: "gio", id: ID }).abs, "/x");
  // 요청 인자에 경로가 있어도 쓰지 않는다
  v = opPlan("delete", T(), { tool: "gio", id: ID, abs: "/etc", rel: "x", root: "/" }); assert.equal(v.abs, "/r/a/b.txt");
  // id 형식: «종류:dev:ino» 또는 «종류:-:ino» 만 · 없거나 이상하면 거절
  for (const ok of ["d:1:2", "l:0:0", "f:-:77", "f:16777230:12345"]) assert.equal(opPlan("delete", T(), { tool: "gio", id: ok }).ok, true, ok);
  for (const bad of [undefined, null, 5, "", "x:1:2", "d:1", "d:1:2:3", "d:a:2", "d:1:", "d::2", "d:-1:2", " d:1:2", "d:1:2\n", "d:1:2;rm", "D:1:2"]) {
    assert.equal(opPlan("delete", T(), { tool: "gio", id: bad }).ok, false, JSON.stringify(bad)); assert.equal(idOk(bad), false, JSON.stringify(bad));
  }
  assert.equal(opPlan("delete", T(), { tool: "gio", id: "x" }).why, "확인 정보가 이상하다");
});

test("티켓: 1회용 · 10분 · 최대 20 · 토큰 16자 이상", () => {
  const m = new Map();
  const tok = putTicket(m, { root: "/r", rel: "a" }, 1000);
  assert.ok(tok.length >= 16); assert.notEqual(putTicket(m, {}, 1000), tok);
  assert.equal(takeTicket(m, "nope", 1000), null); assert.equal(takeTicket(m, 5, 1000), null); assert.equal(takeTicket(m, "", 1000), null);
  assert.equal(takeTicket(m, tok, 1000 + 5000).rel, "a");
  assert.equal(takeTicket(m, tok, 1000 + 5000), null, "쓰면 지운다");
  const t2 = putTicket(m, {}, 1000);
  assert.equal(takeTicket(m, t2, 1000 + TICKET_TTL + 1), null, "10분 지나면 무효"); assert.equal(m.has(t2), false);
  const m2 = new Map(), first = putTicket(m2, {}, 1);
  for (let i = 0; i < TICKET_MAX + 5; i++) putTicket(m2, {}, 2);
  assert.ok(m2.size <= TICKET_MAX); assert.equal(m2.has(first), false, "오래된 것부터 버린다");
  const m3 = new Map(), old = putTicket(m3, {}, 0); putTicket(m3, {}, TICKET_TTL + 10); assert.equal(m3.has(old), false, "낡은 것은 새로 둘 때 치운다");
});

test("renameTree · dropTree: 접두가 비슷한 형제(a vs ab)를 건드리지 않는다 · 인자는 안 바뀐다", () => {
  const folders = new Set(["a", "a/x", "ab", "ab/y", "b"]);
  const entries = new Map([["", [1]], ["a", [2]], ["a/x", [3]], ["ab", [4]], ["ab/y", [5]]]);
  const r = renameTree(folders, entries, "a", "z");
  assert.deepEqual([...r.folders].sort(), ["ab", "ab/y", "b", "z", "z/x"]);
  assert.deepEqual([...r.entries.keys()].sort(), ["", "ab", "ab/y", "z", "z/x"]);
  assert.deepEqual([...folders].sort(), ["a", "a/x", "ab", "ab/y", "b"], "인자 그대로");
  assert.equal(r.entries.get("z/x")[0], 3);
  const d = dropTree(folders, entries, "a");
  assert.deepEqual([...d.folders].sort(), ["ab", "ab/y", "b"]); assert.deepEqual([...d.entries.keys()].sort(), ["", "ab", "ab/y"]);
  assert.equal(folders.size, 5);
  const n = renameTree(new Set(["p/a", "p/a/q"]), new Map(), "p/a", "p/c"); assert.deepEqual([...n.folders].sort(), ["p/c", "p/c/q"]);
});

test("entries: sortEntries · withEntry · withoutEntry · renamedEntry", () => {
  const L = [{ name: "b", dir: true }, { name: "a.txt", dir: false }, { name: "c", dir: true }];
  assert.deepEqual(sortEntries(L).map(e => e.name), ["b", "c", "a.txt"]);
  assert.deepEqual(withEntry(L, { name: "a2", dir: true }).map(e => e.name), ["a2", "b", "c", "a.txt"]);
  assert.deepEqual(withEntry(L, { name: "b", dir: true }).map(e => e.name), ["b", "c", "a.txt"], "같은 이름은 바꿔 둔다");
  assert.deepEqual(withoutEntry(L, "b").map(e => e.name), ["a.txt", "c"], "순서는 그대로");
  assert.deepEqual(renamedEntry(L, "b", "z").map(e => e.name), ["c", "z", "a.txt"]);
  assert.equal(renamedEntry(L, "a.txt", "q.txt").find(e => e.name === "q.txt").dir, false);
  assert.equal(L.length, 3);
});

test("freeName: 새 폴더 · 새 폴더 2 · 3 … · 999 넘으면 base", () => {
  assert.equal(freeName("새 폴더", new Set()), "새 폴더");
  assert.equal(freeName("새 폴더", new Set(["새 폴더"])), "새 폴더 2");
  assert.equal(freeName("새 폴더", ["새 폴더", "새 폴더 2", "새 폴더 3"]), "새 폴더 4");
  assert.equal(freeName("새 폴더", new Set(["새 폴더", "새 폴더 3"])), "새 폴더 2");
  assert.equal(freeName("n", new Set(["n", ...Array.from({ length: 998 }, (_, i) => `n ${i + 2}`)])), "n");
});

test("stemRange: a.tar.gz · .bashrc · x. · 한글 · 폴더", () => {
  assert.deepEqual(stemRange("a.tar.gz", false), { start: 0, end: 5 });
  assert.deepEqual(stemRange(".bashrc", false), { start: 0, end: 7 });
  assert.deepEqual(stemRange("noext", false), { start: 0, end: 5 });
  assert.deepEqual(stemRange("x.", false), { start: 0, end: 1 });
  assert.deepEqual(stemRange("보고서.pdf", false), { start: 0, end: 3 });
  assert.deepEqual(stemRange("v1.2", true), { start: 0, end: 4 }, "폴더는 전체");
  assert.deepEqual(stemRange("😀.png", false), { start: 0, end: 2 }, "UTF-16 단위");
});

test("menuItems · askProps · askSpec · menuSpec", () => {
  assert.deepEqual(menuItems({ empty: true }).map(i => i.op), ["mkdir"]);
  assert.deepEqual(menuItems({ empty: false }).map(i => i.op), ["mkdir", "rename", "delete"]);
  assert.deepEqual(menuItems({ rel: "a" }).map(i => i.label), ["새 폴더", "이름 바꾸기", "지우기…"]);
  assert.deepEqual(menuItems({}).map(i => i.op), ["mkdir"]);
  const ctx = { token: "t", owner: "o", on: "m", name: "f", dir: false, abs: "/r/f", dirAbs: "/r", taken: ["x"], siblings: ["f", "y"] };
  assert.deepEqual([askProps(ctx, "mkdir").taken, askProps(ctx, "rename").taken, askProps(ctx, "delete").taken], [["x"], ["f", "y"], []]);
  assert.equal(askProps(ctx, "mkdir").where, "m:/r"); assert.equal(askProps(ctx, "delete").where, "m:/r/f"); assert.equal("root" in askProps(ctx, "mkdir"), false);
  const a = askSpec(askProps(ctx, "delete")), b = askSpec(askProps(ctx, "rename"));
  assert.deepEqual([a.mod, a.kind, a.modal, a.width, a.height, a.props.mode, b.height], ["files-plus", "dialog", true, 440, 250, "ask", 220]);
  const m = menuSpec({ x: 1 }, 3); assert.deepEqual([m.kind, m.width, m.height, m.props.mode], ["popup", 200, 103, "menu"]);
});

test("parseProbe · opError", () => {
  assert.deepEqual(parseProbe("gio d 12 d:1:2\n"), { tool: "gio", kind: "d", n: 12, id: "d:1:2" });
  assert.deepEqual(parseProbe("none f -1 f:-:9"), { tool: "none", kind: "f", n: -1, id: "f:-:9" });
  assert.deepEqual(parseProbe("trash-put l 0 l:3:4"), { tool: "trash-put", kind: "l", n: 0, id: "l:3:4" });
  for (const bad of ["", "gio", "gio d", "gio d 12", "rm d 1 d:1:2", "gio x 1 d:1:2", "gio d 1.5 d:1:2", "gio d 1 2", "gio d a d:1:2", "x\ngio d 1 d:1:2", "gio d 1 f:1:2", "gio d 1 d:1", "gio d 1 d:1:2 x", null, 5]) assert.equal(parseProbe(bad), null, JSON.stringify(bad));
  assert.equal(opError({ code: 6, stderr: "첫 줄\n마지막 줄\n\n" }), "마지막 줄");
  assert.equal(opError({ code: 7, stderr: "" }), "같은 이름이 이미 있다"); assert.equal(opError({ code: 99, stderr: "" }), "실패했다(종료 코드 99)");
  assert.ok(opError({ code: 1, stderr: "x".repeat(500) }).length <= 200);
});

test("state: SOURCES 에 ask · ownerKeys 가 ask 의 req/ack 를 싣는다", () => {
  assert.ok(SOURCES.includes("ask"));
  const k = ownerKeys("o");
  assert.ok(k.includes("files-plus.req/o/ask") && k.includes("files-plus.ack/o/ask"));
  assert.equal(k.length, 5 + SOURCES.length * 2);
});

test("main.js · fsops.js 글자: 요청 출처는 SOURCES · fsops 는 herdr 를 안 쓴다 · 경로를 요청에 안 싣는다", async () => {
  const dir = new URL("../files-plus/", import.meta.url);
  const main = readFileSync(new URL("main.js", dir), "utf8"), ops = readFileSync(new URL("fsops.js", dir), "utf8"), ask = readFileSync(new URL("ask-view.js", dir), "utf8");
  assert.equal((main.match(/for \(const from of SOURCES\)/g) ?? []).length, 2, "inbox · panelInit 버리기");
  assert.equal(main.includes('["preview", "jobs"]'), false);
  assert.equal(/from "herdr"/.test(ops), false);
  assert.equal(/TextDecoder|TextEncoder|structuredClone|Intl\.|AbortController|setTimeout/.test(ops), false);
  assert.ok(main.includes('p.mode === "menu"') && main.includes('p.mode === "ask"'));
  assert.ok(main.indexOf('p.mode === "ask"') < main.indexOf("this.panelInit(cx)"), "panelInit 앞에서 갈라야 한다");
  // 팝업이 요청을 보내는 길은 하나(post → send "ask") · 인자는 submitPlan 이 만들고 토큰만 얹는다 — 경로 키(abs · root · rel)가 없다
  assert.equal((ask.match(/send\(shared, setShared, this\.owner, "ask"/g) ?? []).length, 1, "send 한 곳");
  assert.equal((ask.match(/\bthis\.post\(/g) ?? []).length, 1, "post 호출 한 곳(정의 제외)" );
  const callSite = /this\.post\(([^\n]*)\)/.exec(ask)[1];
  assert.equal(/\b(abs|root|rel)\b/.test(callSite), false, callSite);
  assert.ok(ask.includes("submitPlan("), "제출 판단은 submitPlan");
});

// ── MKDIR ────────────────────────────────────────────────────────────
test("MKDIR: 만든다 · 이상한 이름 · -rf · 한글 · 줄바꿈", async () => {
  const d = await fresh();
  for (const n of ["plain", ...NAMES]) {
    const r = await sh(MKDIR, [d, n]); assert.equal(r.code, 0, `${n}: ${r.stderr}`);
    assert.ok((await stat(join(d, n))).isDirectory(), n);
  }
  assert.equal((await list(d)).length, NAMES.length + 1);
});

test("MKDIR: 같은 이름(파일 · 폴더 · 끊긴 링크) → 7 · 그대로", async () => {
  const d = await fresh();
  await writeFile(join(d, "f"), "내용"); await mkdir(join(d, "dir")); await writeFile(join(d, "dir", "in"), "x"); await symlink("/no/such/target", join(d, "dead"));
  for (const n of ["f", "dir", "dead"]) { const r = await sh(MKDIR, [d, n]); assert.equal(r.code, 7, n); assert.ok(r.stderr.includes("같은 이름"), r.stderr); }
  assert.equal(await readFile(join(d, "f"), "utf8"), "내용"); assert.deepEqual(await list(join(d, "dir")), ["in"]);
  assert.equal(await readlink(join(d, "dead")), "/no/such/target"); assert.deepEqual(await list(d), ["dead", "dir", "f"]);
});

test("MKDIR: 부모 없음 · 쓸 수 없음 → 6 · 이름 이상 · 상대 경로 → 2 · -p 처럼 부모를 만들지 않는다", async () => {
  const d = await fresh();
  let r = await sh(MKDIR, [join(d, "no", "parent"), "x"]); assert.equal(r.code, 6); assert.equal(existsSync(join(d, "no")), false);
  r = await sh(MKDIR, [join(d, "f-not-dir"), "x"]); assert.equal(r.code, 6);
  if (!IS_ROOT) { const ro = await fresh("ro"); await chmod(ro, 0o500); try { r = await sh(MKDIR, [ro, "x"]); assert.equal(r.code, 6); assert.deepEqual(await list(ro), []); } finally { await chmod(ro, 0o700); } }
  for (const bad of ["", ".", "..", "a/b"]) assert.equal((await sh(MKDIR, [d, bad])).code, 2, JSON.stringify(bad));
  assert.equal((await sh(MKDIR, ["rel/dir", "x"])).code, 2); assert.equal((await sh(MKDIR, [d])).code, 2);
  assert.deepEqual(await list(d), []);
});

// ── RENAME ───────────────────────────────────────────────────────────
async function caseInsensitive(d) { await writeFile(join(d, "Zz"), ""); const r = existsSync(join(d, "zz")); await rm(join(d, "Zz")); return r; }

test("RENAME: 파일 · 폴더 · 이상한 이름들", async () => {
  const d = await fresh();
  await writeFile(join(d, "a.txt"), "내용"); await mkdir(join(d, "dir")); await writeFile(join(d, "dir", "in"), "x");
  let r = await sh(RENAME, [d, "a.txt", "b.md"]); assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(await list(d), ["b.md", "dir"]); assert.equal(await readFile(join(d, "b.md"), "utf8"), "내용");
  r = await sh(RENAME, [d, "dir", "폴더"]); assert.equal(r.code, 0, r.stderr); assert.deepEqual(await list(join(d, "폴더")), ["in"]);
  for (const n of NAMES) {
    r = await sh(RENAME, [d, "b.md", n]); assert.equal(r.code, 0, `${n}: ${r.stderr}`); assert.ok(existsSync(join(d, n)), n); assert.equal(existsSync(join(d, "b.md")), false);
    r = await sh(RENAME, [d, n, "b.md"]); assert.equal(r.code, 0, `${n} 되돌림: ${r.stderr}`);
  }
  assert.deepEqual(await list(d), ["b.md", "폴더"]);
});

test("RENAME: 기존 파일 위 → 7 · 둘 다 그대로", async () => {
  const d = await fresh();
  await writeFile(join(d, "a"), "A"); await writeFile(join(d, "b"), "B");
  const r = await sh(RENAME, [d, "a", "b"]); assert.equal(r.code, 7); assert.ok(r.stderr.includes("같은 이름"));
  assert.equal(await readFile(join(d, "a"), "utf8"), "A"); assert.equal(await readFile(join(d, "b"), "utf8"), "B"); assert.deepEqual(await list(d), ["a", "b"]);
});

test("RENAME: 기존 폴더 위 → 7 · 폴더 안으로 들어가지 않는다", async () => {
  const d = await fresh();
  await writeFile(join(d, "f"), "F"); await mkdir(join(d, "dir")); await mkdir(join(d, "other")); await mkdir(join(d, "sub"));
  let r = await sh(RENAME, [d, "f", "dir"]); assert.equal(r.code, 7); assert.deepEqual(await list(join(d, "dir")), []); assert.ok(existsSync(join(d, "f")));
  r = await sh(RENAME, [d, "other", "sub"]); assert.equal(r.code, 7); assert.deepEqual(await list(join(d, "sub")), []); assert.ok(existsSync(join(d, "other")));
  await symlink(join(d, "dir"), join(d, "lnk"));       // 폴더를 가리키는 링크 위로도 안 들어간다
  r = await sh(RENAME, [d, "f", "lnk"]); assert.equal(r.code, 7); assert.deepEqual(await list(join(d, "dir")), []);
});

test("RENAME: 하드링크 → 7 · 둘 다 그대로 · 임시 이름이 안 남는다", async () => {
  const d = await fresh();
  await writeFile(join(d, "a"), "A"); await link(join(d, "a"), join(d, "b"));
  const r = await sh(RENAME, [d, "a", "b"]); assert.equal(r.code, 7, r.stderr);
  assert.deepEqual(await list(d), ["a", "b"]); assert.equal(await readFile(join(d, "a"), "utf8"), "A"); assert.equal((await stat(join(d, "a"))).ino, (await stat(join(d, "b"))).ino);
});

test("RENAME: 대소문자만 바꾸기 — 목록에 새 대소문자가 남는다", async () => {
  const d = await fresh();
  await writeFile(join(d, "Foo.txt"), "내용"); await mkdir(join(d, "Dir"));
  const ci = await caseInsensitive(d);       // 런타임에 FS 판별: 무시 FS(APFS 기본)면 두 단계 길을 탄다
  let r = await sh(RENAME, [d, "Foo.txt", "foo.txt"]); assert.equal(r.code, 0, `ci=${ci} ${r.stderr}`);
  assert.deepEqual(await list(d), ["Dir", "foo.txt"]); assert.equal(await readFile(join(d, "foo.txt"), "utf8"), "내용");
  r = await sh(RENAME, [d, "Dir", "DIR"]); assert.equal(r.code, 0, r.stderr); assert.deepEqual(await list(d), ["DIR", "foo.txt"]);
  r = await sh(RENAME, [d, "foo.txt", "FOO.TXT"]); assert.equal(r.code, 0, r.stderr); assert.deepEqual(await list(d), ["DIR", "FOO.TXT"]);
  assert.equal((await readdir(d)).some(n => n.startsWith(".files-plus-rename-")), false, "임시 이름이 안 남는다");
});

test("RENAME: 정규화(NFC↔NFD)만 다른 이름", async () => {
  const d = await fresh(), NFC = "\u00e9.txt", NFD = "e\u0301.txt";
  await writeFile(join(d, NFC), "x");
  const same = existsSync(join(d, NFD));      // APFS 는 정규화를 무시해 같은 항목 · 그 밖은 다른 이름
  const r = await sh(RENAME, [d, NFC, NFD]); assert.equal(r.code, 0, `same=${same} ${r.stderr}`);
  const names = await readdir(d); assert.equal(names.length, 1);
  assert.equal(Buffer.from(names[0]).equals(Buffer.from(NFD)) || (same && names[0].normalize("NFD") === NFD), true);
});

test("RENAME: 심볼릭 링크 바꾸기 — 대상은 그대로 · 끊긴 링크도", async () => {
  const d = await fresh();
  await mkdir(join(d, "tgt")); await writeFile(join(d, "tgt", "in"), "x"); await symlink(join(d, "tgt"), join(d, "lnk")); await symlink("/no/such", join(d, "dead"));
  let r = await sh(RENAME, [d, "lnk", "lnk2"]); assert.equal(r.code, 0, r.stderr);
  assert.ok((await lstat(join(d, "lnk2"))).isSymbolicLink()); assert.equal(await readlink(join(d, "lnk2")), join(d, "tgt")); assert.deepEqual(await list(join(d, "tgt")), ["in"]);
  r = await sh(RENAME, [d, "dead", "dead2"]); assert.equal(r.code, 0, r.stderr); assert.equal(await readlink(join(d, "dead2")), "/no/such");
});

test("RENAME: 없는 원본 → 3 · 부모 없음/쓸 수 없음 → 6 · 이름 이상 → 2 · 같은 이름 → 0", async () => {
  const d = await fresh();
  await writeFile(join(d, "a"), "A");
  assert.equal((await sh(RENAME, [d, "nope", "x"])).code, 3);
  assert.equal((await sh(RENAME, [join(d, "gone"), "a", "x"])).code, 6);
  assert.equal((await sh(RENAME, [d, "a", "a"])).code, 0);
  for (const bad of ["", ".", "..", "x/y"]) { assert.equal((await sh(RENAME, [d, "a", bad])).code, 2, bad); assert.equal((await sh(RENAME, [d, bad, "x"])).code, 2, bad); }
  assert.equal((await sh(RENAME, ["rel", "a", "x"])).code, 2); assert.equal((await sh(RENAME, [d, "a"])).code, 2);
  if (!IS_ROOT) { const ro = await fresh("ro"); await writeFile(join(ro, "a"), "A"); await chmod(ro, 0o500); try { assert.equal((await sh(RENAME, [ro, "a", "b"])).code, 6); assert.deepEqual(await list(ro), ["a"]); } finally { await chmod(ro, 0o700); } }
  assert.deepEqual(await list(d), ["a"]);
});

// ── PROBE ────────────────────────────────────────────────────────────
test("PROBE: 폴더 항목 수 · 파일 크기 · 링크 · 없음 → 3", async () => {
  const d = await fresh(), env = { PATH: await mkBin() }, pp = out => { const r = parseProbe(out); if (r) delete r.id; return r; };
  await mkdir(join(d, "p")); await writeFile(join(d, "p", "a"), ""); await writeFile(join(d, "p", ".hid"), ""); await writeFile(join(d, "p", "x\ny"), ""); await mkdir(join(d, "p", "sub")); await writeFile(join(d, "p", "sub", "c"), "");
  let r = await sh(PROBE, [join(d, "p")], env); assert.equal(r.code, 0, r.stderr); assert.deepEqual(pp(r.stdout), { tool: "none", kind: "d", n: 5 }, r.stdout);   // a · .hid · x\ny · sub · sub/c
  await mkdir(join(d, "empty")); r = await sh(PROBE, [join(d, "empty")], env); assert.equal(parseProbe(r.stdout).n, 0);
  await writeFile(join(d, "f"), "x".repeat(1234)); r = await sh(PROBE, [join(d, "f")], env); assert.deepEqual(pp(r.stdout), { tool: "none", kind: "f", n: 1234 });
  await writeFile(join(d, "f0"), ""); assert.equal(parseProbe((await sh(PROBE, [join(d, "f0")], env)).stdout).n, 0);
  await symlink(join(d, "p"), join(d, "lnk")); r = await sh(PROBE, [join(d, "lnk")], env); assert.deepEqual(pp(r.stdout), { tool: "none", kind: "l", n: 0 }, "폴더 링크는 링크만");
  await symlink("/no/such", join(d, "dead")); assert.equal(parseProbe((await sh(PROBE, [join(d, "dead")], env)).stdout).kind, "l");
  r = await sh(PROBE, [join(d, "nope")], env); assert.equal(r.code, 3); assert.equal(r.stdout, "");
  assert.equal((await sh(PROBE, ["rel"], env)).code, 2);
  if (!IS_ROOT) { await writeFile(join(d, "locked"), "secret"); await chmod(join(d, "locked"), 0); try { assert.equal(parseProbe((await sh(PROBE, [join(d, "locked")], env)).stdout).n, -1); } finally { await chmod(join(d, "locked"), 0o600); } }
});

test("PROBE: 폴더 항목 수는 10001 에서 멈춘다", { timeout: 120000 }, async () => {
  const d = await fresh("big"), env = { PATH: await mkBin() };
  for (let s = 0; s < 10100; s += 500) await Promise.all(Array.from({ length: Math.min(500, 10100 - s) }, (_, i) => writeFile(join(d, `f${s + i}`), "")));
  const r = await sh(PROBE, [d], env); assert.equal(parseProbe(r.stdout).n, 10001, r.stdout);
});

test("PROBE: 도구 고르기 — 가짜 gio · trash-put · 없음 · PATH 의 trash 는 무시", async () => {
  const d = await fresh(); await writeFile(join(d, "f"), "x");
  const probe = async fakes => parseProbe((await sh(PROBE, [join(d, "f")], { PATH: await mkBin(fakes) })).stdout).tool;
  assert.equal(await probe({}), "none");
  assert.equal(await probe({ gio: "exit 0" }), "gio");
  assert.equal(await probe({ "trash-put": "exit 0" }), "trash-put");
  assert.equal(await probe({ gio: "exit 0", "trash-put": "exit 0" }), "gio", "gio 가 먼저");
  assert.equal(await probe({ trash: "exit 0" }), "none", "리눅스 trash-cli 의 `trash` 는 trash 로 안 친다(macOS /usr/bin/trash 만)");
  if (process.platform === "darwin" && existsSync("/usr/bin/trash")) {      // 진짜 uname · 진짜 /usr/bin/trash 확인만(지우지 않는다)
    const r = await sh(PROBE, [join(d, "f")]); assert.equal(parseProbe(r.stdout).tool, "trash");
  }
});

// ── REMOVE ───────────────────────────────────────────────────────────
async function rmEnv(fakes) {
  const trash = await fresh("trash"), log = join(base, `log-${++seq}`), home = await fresh("home");
  const mi = join(base, `mi-${++seq}`); await writeFile(mi, "36 35 98:0 /src /mnt/unrelated-fp-test rw,noatime shared:1 - ext4 /dev/sdb1 rw\n");     // 대상과 무관한 마운트 한 줄 — 시험은 진짜 /proc 을 읽지 않는다(빈 파일은 «못 읽음» 으로 거절된다)
  return { trash, log, home, env: { PATH: await mkBin(fakes), FP_TRASH: trash, FP_LOG: log, HOME: home, FP_MOUNTINFO: mi } };
}

test("REMOVE: gio · trash-put 가짜 휴지통 — 인자 꼴 · 끝에 / 없음 · 이상한 이름", async () => {
  for (const [tool, fakes, head] of [["gio", { gio: FAKE_GIO }, ["trash", "--"]], ["trash-put", { "trash-put": FAKE_PUT }, ["--"]]]) {
    const { trash, log, home, env } = await rmEnv(fakes), d = await fresh("w");
    const names = ["plain", ...NAMES];
    for (const [i, n] of names.entries()) {
      if (i % 2) { await mkdir(join(d, n)); await writeFile(join(d, n, "in"), "x"); } else await writeFile(join(d, n), "x");
      const r = await rmv(tool, join(d, n), env); assert.equal(r.code, 0, `${tool} ${n}: ${r.stderr}`);
      assert.equal(existsSync(join(d, n)), false, n);
    }
    assert.deepEqual(await list(d), []); assert.equal((await readdir(trash)).length, names.length, "가짜 휴지통에 모였다");
    const logged = (await readFile(log, "utf8")).split("\n").filter(Boolean);
    assert.ok(logged[0].startsWith(head.join(" ")), logged[0]);
    assert.ok(logged.every(l => !l.endsWith("/")), "끝에 / 를 붙이지 않는다");
    assert.deepEqual(await list(home), []);
  }
});

test("REMOVE: 폴더 링크는 가짜 휴지통에 링크 자체로 · 끝 / 없음 · 대상 그대로", async () => {
  const { trash, log, env } = await rmEnv({ gio: FAKE_GIO }), d = await fresh();
  await mkdir(join(d, "tgt")); await writeFile(join(d, "tgt", "in"), "x"); await symlink(join(d, "tgt"), join(d, "lnk"));
  const r = await rmv("gio", join(d, "lnk"), env); assert.equal(r.code, 0, r.stderr);
  assert.ok(existsSync(join(d, "tgt", "in"))); assert.equal(existsSync(join(d, "lnk")), false);
  assert.equal((await readFile(log, "utf8")).trim(), `trash -- ${join(d, "lnk")}`); assert.ok((await lstat(join(trash, "lnk"))).isSymbolicLink());
});

test("REMOVE: none — 비지 않은 폴더 · 파일 · 폴더 링크는 링크만", async () => {
  const { env } = await rmEnv({}), d = await fresh();
  await mkdir(join(d, "full", "a", "b"), { recursive: true }); await writeFile(join(d, "full", "a", "b", "f"), "x"); await writeFile(join(d, "full", ".hid"), "x"); await writeFile(join(d, "file"), "x");
  await mkdir(join(d, "tgt")); await writeFile(join(d, "tgt", "keep"), "k"); await symlink(join(d, "tgt"), join(d, "lnk")); await symlink("/no/such", join(d, "dead"));
  for (const n of ["full", "file", "lnk", "dead"]) { const r = await rmv("none", join(d, n), env); assert.equal(r.code, 0, `${n}: ${r.stderr}`); }
  assert.deepEqual(await list(d), ["tgt"]); assert.deepEqual(await list(join(d, "tgt")), ["keep"], "링크를 지워도 대상은 그대로");
  for (const n of NAMES) { await writeFile(join(d, n), "x"); assert.equal((await rmv("none", join(d, n), env)).code, 0, n); }
  assert.deepEqual(await list(d), ["tgt"]);
});

test("REMOVE: HOME 보호 — HOME 자신 · 그 위 폴더 · HOME 을 가리키는 링크 → 8 · 아래는 된다", async () => {
  const { env, home } = await rmEnv({}), top = await fresh("top"), h = join(top, "me"), up = join(top, "x");
  await mkdir(h); await mkdir(join(h, "docs")); await writeFile(join(h, "docs", "f"), "x"); await mkdir(up); await symlink(h, join(up, "homelink"));
  const e = { ...env, HOME: h };
  for (const tool of TOOLS) {
    for (const t of [h, top, join(up, "..")]) { const r = await rmv(tool, t, e, "d:0:0"); assert.equal(r.code, 8, `${tool} ${t}: ${r.stderr}`); assert.ok(r.stderr.includes("홈 폴더")); }
    const r = await rmv(tool, join(up, "homelink"), e, "l:0:0"); assert.equal(r.code, 8, `${tool} 링크`);
  }
  assert.ok(existsSync(join(h, "docs", "f")) && existsSync(up));
  assert.equal((await rmv("none", "/", e, "d:0:0")).code, 8);   // 고정 id — PROBE 가 / 를 훑지 않게
  assert.equal((await rmv("none", join(h, "docs"), e)).code, 0, "HOME 아래는 지운다"); assert.equal(existsSync(join(h, "docs")), false);
  assert.deepEqual(await list(home), []);
  // 형제: 이름이 HOME 의 접두인 폴더는 지울 수 있다
  await mkdir(join(top, "me2")); assert.equal((await rmv("none", join(top, "me2"), e)).code, 0);
});

test("REMOVE: 없는 대상 → 3 · 도구 모름 → 2 · 상대 경로 → 2 · 인자 수", async () => {
  const { env } = await rmEnv({}), d = await fresh(); await writeFile(join(d, "f"), "x");
  assert.equal((await rmv("none", join(d, "nope"), env)).code, 3);
  for (const bad of ["rm", "", "TRASH", "gio;x"]) { const r = await rmv(bad, join(d, "f"), env); assert.equal(r.code, 2, bad); assert.ok(existsSync(join(d, "f"))); }
  assert.equal((await rmv("none", "f", env)).code, 2); assert.equal((await sh(REMOVE, ["none", join(d, "f")], env)).code, 2, "id 없이는 2"); assert.equal((await sh(REMOVE, ["none"], env)).code, 2);
  assert.ok(existsSync(join(d, "f")));
});

test("REMOVE: 휴지통 도구가 실패하면 6 · 대상 그대로 · 영구 삭제로 안 넘어간다", async () => {
  const { env, trash } = await rmEnv({ gio: 'echo "휴지통이 가득 찼다 — boom" >&2; exit 1', "trash-put": "exit 3" }), d = await fresh();
  await writeFile(join(d, "f"), "x"); await mkdir(join(d, "dir")); await writeFile(join(d, "dir", "in"), "x");
  let r = await rmv("gio", join(d, "f"), env); assert.equal(r.code, 6); assert.ok(r.stderr.trim().endsWith("boom"), r.stderr);
  r = await rmv("trash-put", join(d, "dir"), env); assert.equal(r.code, 6);
  assert.deepEqual(await list(d), ["dir", "f"]); assert.ok(existsSync(join(d, "dir", "in"))); assert.deepEqual(await list(trash), []);
});

test("REMOVE: 도구가 0 을 돌려주고 안 지우면 9", async () => {
  const { env } = await rmEnv({ gio: "exit 0" }), d = await fresh(); await writeFile(join(d, "f"), "x");
  const r = await rmv("gio", join(d, "f"), env); assert.equal(r.code, 9); assert.ok(existsSync(join(d, "f")));
});

// ── 이번 수정(H1 H2 M1 M2 M3 M4 M5) ──────────────────────────────────
const REAL = { mv: which("mv"), find: which("find") };
// 가짜 rm: --version 은 FP_GNU = gnu 면 «rm (GNU coreutils) 9.4» · uu 면 «rm (uutils coreutils) 0.8.0» · 그 밖은 실패(busybox · BSD 꼴) · 그 밖의 호출은 인자를 FP_LOG 에 한 줄로 적고 FP_RC(기본 0)로 끝난다. 아무것도 지우지 않는다.
const FAKE_RM = `if [ "$1" = --version ]; then case "$FP_GNU" in gnu) echo "rm (GNU coreutils) 9.4"; exit 0;; uu) echo "rm (uutils coreutils) 0.8.0"; exit 0;; esac; exit 1; fi; printf "%s\\n" "$*" >> "$FP_LOG"; exit \${FP_RC:-0}`;
// 가짜 mv: --version 은 그대로 · FP_AT 번째 mv 호출 직전에 FP_NEW 를 폴더(FP_MK=dir) 또는 파일로 만든 뒤 진짜 mv 를 실행한다(경쟁 재현).
const FAKE_MV = `[ "$1" = --version ] && exec "$REAL_MV" "$@"; n=$(cat "$FP_CNT" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$FP_CNT"; if [ "$n" = "$FP_AT" ]; then if [ "$FP_MK" = dir ]; then mkdir "$FP_NEW"; else echo OTHER > "$FP_NEW"; fi; fi; exec "$REAL_MV" "$@"`;
const FAKE_FIND = `printf "%s\\n" "$*" >> "$FP_LOG"; exec "$REAL_FIND" "$@"`;
const leftovers = async d => (await readdir(d, { recursive: true })).filter(n => n.includes(".files-plus-rename-"));

test("PROBE: id = 종류:dev:ino (링크는 링크 자신) · 항목 수는 -xdev -mindepth 1 로 센다", async () => {
  const d = await fresh(), log = join(base, `log-${++seq}`), env = { PATH: await mkBin({ find: FAKE_FIND }), FP_LOG: log, REAL_FIND: REAL.find };
  await mkdir(join(d, "p")); await writeFile(join(d, "p", "a"), "x"); await writeFile(join(d, "f"), "xy"); await symlink(join(d, "p"), join(d, "lnk")); await symlink("/no/such", join(d, "dead"));
  for (const [n, kind, st] of [["p", "d", await stat(join(d, "p"))], ["f", "f", await stat(join(d, "f"))], ["lnk", "l", await lstat(join(d, "lnk"))], ["dead", "l", await lstat(join(d, "dead"))]]) {
    const r = await sh(PROBE, [join(d, n)], env), pr = parseProbe(r.stdout);
    assert.equal(r.code, 0, r.stderr); assert.equal(pr.id, `${kind}:${st.dev}:${st.ino}`, n); assert.equal(idOk(pr.id), true);
  }
  assert.deepEqual((await readFile(log, "utf8")).split("\n").filter(Boolean), [`${join(d, "p")} -xdev -mindepth 1 -print0`], "find 는 폴더에만 · 전역 옵션이 앞");
  assert.ok(PROBE.indexOf("-xdev") < PROBE.indexOf("-mindepth"));
});

test("PROBE: FIFO 는 열지 않는다 — 2초 안에 끝나고 f -1 (M2)", async () => {
  const d = await fresh(), env = { PATH: await mkBin() }, fifo = join(d, "pipe");
  execFileSync("mkfifo", [fifo]);
  const r = await sh(PROBE, [fifo], env, 2000);
  if (r.killed) { try { closeSync(openSync(fifo, "r+")); } catch { /* 멈춰 있던 읽기를 풀어 준다 */ } }
  assert.equal(r.killed, false, "멈췄다"); assert.equal(r.code, 0, r.stderr);
  const pr = parseProbe(r.stdout); assert.equal(pr.kind, "f"); assert.equal(pr.n, -1); assert.ok(pr.id.startsWith("f:"));
  await rm(fifo);
});

const DARWIN = { uname: "echo Darwin" };       // 가짜 uname — mkBin 의 기본은 Linux
test("REMOVE none: 폴더 플래그 — Linux GNU 면 OS 무관 --one-file-system · Linux uutils · 그 밖 rm 은 플래그 없이 · Darwin 비 GNU 는 -x · 파일은 -r 없이 (U1)", async () => {
  for (const [os, gnu, flags] of [["Linux", "gnu", "-r -f --one-file-system"], ["Linux", "uu", "-r -f"], ["Linux", "", "-r -f"], ["Darwin", "gnu", "-r -f --one-file-system"], ["Darwin", "", "-r -f -x"]]) {
    const { log, env } = await rmEnv({ rm: FAKE_RM, ...(os === "Darwin" ? DARWIN : {}) }), d = await fresh(), e = { ...env, FP_GNU: gnu };
    await mkdir(join(d, "dir")); await writeFile(join(d, "f"), "x");
    let r = await rmv("none", join(d, "dir"), e);
    assert.equal(r.code, 9, r.stderr);                       // 가짜 rm 은 안 지운다 → «다 지우지 못했다»
    r = await rmv("none", join(d, "f"), e); assert.equal(r.code, 9);
    assert.deepEqual((await readFile(log, "utf8")).split("\n").filter(Boolean), [`${flags} -- ${join(d, "dir")}`, `-f -- ${join(d, "f")}`], `${os} ${gnu}`);
  }
});

test("REMOVE none: rm 이 오류로 끝나면 그대로 오류 — 플래그 없는 rm 으로 다시 시도하지 않는다 (닫힘)", async () => {
  for (const [os, gnu, re] of [["Linux", "gnu", /--one-file-system/], ["Darwin", "", / -x /], ["Darwin", "gnu", /--one-file-system/]]) {
    const { log, env } = await rmEnv({ rm: FAKE_RM, ...(os === "Darwin" ? DARWIN : {}) }), d = await fresh(), e = { ...env, FP_GNU: gnu, FP_RC: "1" };
    await mkdir(join(d, "dir")); await writeFile(join(d, "dir", "keep"), "x");
    const r = await rmv("none", join(d, "dir"), e);
    assert.notEqual(r.code, 0); assert.ok(existsSync(join(d, "dir", "keep")));
    const calls = (await readFile(log, "utf8")).split("\n").filter(Boolean);
    assert.equal(calls.length, 1, `rm 호출 ${calls.length}번: ${calls.join(" | ")}`); assert.ok(re.test(` ${calls[0]} `), calls[0]);
  }
});

// Linux 길의 마운트 검사(U1) — 가짜 uname(Linux) + FP_MOUNTINFO. 거절이면 rm 은 한 번도 안 불리고 대상은 그대로.
const mountLine = mp => `36 35 98:0 /src ${mp} rw,noatime shared:1 - ext4 /dev/sdb1 rw`;
test("REMOVE none (Linux): 안에 마운트가 있으면 12 · 마운트 지점 자신이어도 12 · rm 0번 (U1)", async () => {
  for (const [name, mk] of [["하위", (rd) => `${rd}/sub`], ["공백 든 하위(\\040)", (rd) => `${rd}/sub\\040dir`], ["대상 자신", (rd) => rd], ["탭·줄바꿈·역슬래시", (rd) => `${rd}/a\\011b\\012c\\134d`]]) {
    for (const gnu of ["gnu", "uu"]) {
      const { log, env } = await rmEnv({ rm: FAKE_RM }), d = await fresh(), dir = join(d, "dir"); await mkdir(dir); await writeFile(join(dir, "keep"), "x");
      const rd = realpathSync(dir), mi = join(base, `mi-${++seq}`);
      await writeFile(mi, `${mountLine("/")}\n${mountLine("/proc")}\n${mountLine(mk(rd))}\n`);
      const r = await rmv("none", dir, { ...env, FP_MOUNTINFO: mi, FP_GNU: gnu });
      assert.equal(r.code, 12, `${name} ${gnu}: ${r.stderr}`); assert.ok(opError(r).includes("마운트"), opError(r));
      assert.equal(existsSync(log), false, "rm 은 한 번도 안 불린다"); assert.ok(existsSync(join(dir, "keep")));
    }
  }
});

test("REMOVE none (Linux): 접두만 같은 이웃 마운트(/x/ab 와 /x/a) · 다른 곳 마운트는 거절하지 않는다 — uutils 면 플래그 없는 rm 1번 (U1)", async () => {
  const { log, env } = await rmEnv({ rm: FAKE_RM }), d = await fresh(), dir = join(d, "a"); await mkdir(dir); await mkdir(join(d, "ab"));
  const rd = realpathSync(dir), mi = join(base, `mi-${++seq}`);
  await writeFile(mi, `${mountLine("/")}\n${mountLine(`${rd}b`)}\n${mountLine(`${rd}b/c`)}\n${mountLine("/other/a")}\n`);
  const r = await rmv("none", dir, { ...env, FP_MOUNTINFO: mi, FP_GNU: "uu" });
  assert.equal(r.code, 9, r.stderr);                         // 가짜 rm 은 안 지운다
  assert.deepEqual((await readFile(log, "utf8")).split("\n").filter(Boolean), [`-r -f -- ${dir}`]);
});

test("REMOVE none (Linux): 마운트 정보를 못 읽으면 6 · rm 0번 · 대상 그대로 — 닫힘 (U1)", async () => {
  const { log, env } = await rmEnv({ rm: FAKE_RM }), d = await fresh(), dir = join(d, "dir"); await mkdir(dir); await writeFile(join(dir, "keep"), "x");
  const r = await rmv("none", dir, { ...env, FP_MOUNTINFO: join(d, "없는 파일"), FP_GNU: "gnu" });
  assert.equal(r.code, 6, r.stderr); assert.ok(r.stderr.includes("마운트 정보를 읽지 못해"), r.stderr);
  assert.equal(existsSync(log), false); assert.ok(existsSync(join(dir, "keep")));
});

test("REMOVE none (Linux): 읽을 수 있어도 줄이 하나도 없는 마운트 정보는 못 읽은 것으로 6 · rm 0번 (U3)", async () => {
  const { log, env } = await rmEnv({ rm: FAKE_RM }), d = await fresh(), dir = join(d, "dir"); await mkdir(dir); await writeFile(join(dir, "keep"), "x");
  const mi = join(base, `mi-${++seq}`); await writeFile(mi, "");
  const r = await rmv("none", dir, { ...env, FP_MOUNTINFO: mi, FP_GNU: "gnu" });
  assert.equal(r.code, 6, r.stderr); assert.ok(r.stderr.includes("마운트 정보를 읽지 못해"), r.stderr);
  assert.equal(existsSync(log), false); assert.ok(existsSync(join(dir, "keep")));
});

test("REMOVE none (Linux): 대상 경로에 공백·역슬래시가 있어도 이스케이프를 풀어 비교한다 (U1)", async () => {
  const esc = p => p.replace(/\\/g, "\\134").replace(/ /g, "\\040");
  for (const [nm, tail] of [["a b", ""], ["a b", "/in side"], ["x\\y", ""], ["x\\y", "/z"]]) {
    const { log, env } = await rmEnv({ rm: FAKE_RM }), d = await fresh(), dir = join(d, nm); await mkdir(dir);
    const rd = realpathSync(dir), mi = join(base, `mi-${++seq}`); await writeFile(mi, `${mountLine("/")}\n${mountLine(esc(rd + tail))}\n`);
    const r = await rmv("none", dir, { ...env, FP_MOUNTINFO: mi });
    assert.equal(r.code, 12, `${nm}${tail}: ${r.stderr}`); assert.equal(existsSync(log), false);
  }
});

test("REMOVE none (Linux): 대상 폴더에 들어갈 수 없어 경로를 못 구하면 6 · rm 0번 (U1)", { skip: IS_ROOT && "root 는 권한을 안 따른다" }, async () => {
  const { log, env } = await rmEnv({ rm: FAKE_RM }), d = await fresh(), dir = join(d, "locked"); await mkdir(dir);
  await chmod(dir, 0o000);
  try { const r = await rmv("none", dir, env); assert.equal(r.code, 6, r.stderr); assert.ok(r.stderr.includes("실제 위치를 읽지 못해"), r.stderr); assert.ok(!r.stderr.includes("마운트 정보"), "마운트 정보 문구와 구별"); assert.equal(existsSync(log), false); } finally { await chmod(dir, 0o755); }
});

test("REMOVE none (Linux): HOME 이 비어도 마운트 검사는 돈다 (U1)", async () => {
  const { log, env } = await rmEnv({ rm: FAKE_RM }), d = await fresh(), dir = join(d, "dir"); await mkdir(dir);
  const mi = join(base, `mi-${++seq}`); await writeFile(mi, `${mountLine(`${realpathSync(dir)}/m`)}\n`);
  const r = await rmv("none", dir, { ...env, HOME: "", FP_MOUNTINFO: mi });
  assert.equal(r.code, 12, r.stderr); assert.equal(existsSync(log), false);
});

test("REMOVE none: 일부만 지워지면 11 · 일부는 이미 지워졌다고 알린다 (M1)", { skip: IS_ROOT && "root 는 권한을 안 따른다" }, async () => {
  const { env } = await rmEnv({}), d = await fresh();
  await mkdir(join(d, "top", "a"), { recursive: true }); await mkdir(join(d, "top", "locked")); await writeFile(join(d, "top", "a", "f1"), "1"); await writeFile(join(d, "top", "locked", "f2"), "2"); await writeFile(join(d, "top", "t"), "t");
  await chmod(join(d, "top", "locked"), 0o555);
  try {
    const r = await rmv("none", join(d, "top"), env);
    assert.equal(r.code, 11, r.stderr); assert.ok(r.stderr.includes("일부"), r.stderr); assert.ok(opError(r).includes("일부"));
    assert.ok(existsSync(join(d, "top", "locked", "f2"))); assert.equal(existsSync(join(d, "top", "a")), false, "지울 수 있는 것은 지워졌다");
  } finally { await chmod(join(d, "top", "locked"), 0o755); }
  assert.equal((await rmv("none", join(d, "top"), env)).code, 0, "권한을 되돌리면 지워진다");
});

test("REMOVE: PROBE 뒤에 대상이 바뀌면 10 · 아무것도 안 지운다 (H2)", async () => {
  const { env } = await rmEnv({ gio: FAKE_GIO }), d = await fresh(), x = join(d, "x");
  // 파일 → 하위 파일이 든 폴더
  await writeFile(x, "ab"); const id = parseProbe((await sh(PROBE, [x], env)).stdout).id;
  await rm(x); await mkdir(x); await writeFile(join(x, "precious"), "p");
  for (const tool of ["none", "gio"]) {
    const r = await sh(REMOVE, [tool, x, id], env); assert.equal(r.code, 10, `${tool} ${r.stderr}`); assert.ok(opError(r).includes("바뀌었다"));
    assert.ok(existsSync(join(x, "precious")), "아무것도 안 지웠다");
  }
  // 같은 종류라도 다른 항목(inode 가 다르다)
  await rm(x, { recursive: true }); await writeFile(x, "ab"); const id2 = parseProbe((await sh(PROBE, [x], env)).stdout).id;
  const keep = join(d, "keep"); await writeFile(keep, "k"); await rm(x); await writeFile(x, "ab");
  if (parseProbe((await sh(PROBE, [x], env)).stdout).id !== id2) { assert.equal((await sh(REMOVE, ["none", x, id2], env)).code, 10); assert.ok(existsSync(x)); }
  // 링크로 바뀐 경우
  const id3 = parseProbe((await sh(PROBE, [x], env)).stdout).id; await rm(x); await symlink(keep, x);
  assert.equal((await sh(REMOVE, ["none", x, id3], env)).code, 10); assert.equal(await readFile(keep, "utf8"), "k");
  // 그대로면 지운다 · id 가 비었거나 이상하면 10
  const id4 = parseProbe((await sh(PROBE, [x], env)).stdout).id;
  for (const bad of ["", "f:0:0", "garbage"]) assert.equal((await sh(REMOVE, ["none", x, bad], env)).code, 10, bad);
  assert.equal((await sh(REMOVE, ["none", x, id4], env)).code, 0); assert.equal(existsSync(x), false); assert.equal(await readFile(keep, "utf8"), "k");
});

test("RENAME 두 단계: 둘째 mv 직전 새 이름이 생기면 7 · 임시 이름으로 남은 것을 알린다 · 조용히 0 이 아니다 (M3)", async t => {
  const d0 = await fresh(); if (!(await caseInsensitive(d0))) return t.skip("대소문자를 구분하는 FS — 두 단계 길을 타지 않는다");     // 두 단계 길은 대소문자를 무시하는 FS 에서만 탄다
  for (const mk of ["dir", "file"]) {
    const d = await fresh(); await writeFile(join(d, "Foo"), "MINE");
    const env = { PATH: await mkBin({ mv: FAKE_MV }), REAL_MV: REAL.mv, FP_CNT: join(base, `cnt-${++seq}`), FP_AT: "2", FP_MK: mk, FP_NEW: join(d, "foo") };
    const r = await sh(RENAME, [d, "Foo", "foo"], env);
    assert.equal(r.code, 7, `${mk}: ${r.stderr}`);
    // 대소문자 무시 FS 에서는 새로 생긴 이름이 원래 이름 자리이기도 해 되돌릴 자리가 없다 → 항목은 임시 이름(또는 새 폴더 안의 임시 이름)에 그대로 있고 메시지가 그걸 알린다
    assert.ok(r.stderr.includes(".files-plus-rename-"), r.stderr);
    const left = await leftovers(d); assert.equal(left.length, 1, `${mk}: ${left}`);
    assert.equal(await readFile(join(d, left[0]), "utf8"), "MINE", `${mk}: 항목은 잃지 않았다`);
    if (mk === "dir") { assert.deepEqual((await list(join(d, "foo"))).length, 1, "새 폴더 안에 임시 이름 하나"); assert.ok(r.stderr.includes("foo/.files-plus-rename-"), `실제 위치(새 이름/임시 이름)를 알린다: ${r.stderr}`); } else { assert.ok(!r.stderr.includes("foo/.files-plus-rename-"), r.stderr); assert.equal(await readFile(join(d, "foo"), "utf8"), "OTHER\n", "새 파일은 그대로"); }
  }
});

test("RENAME 두 단계: 둘째 mv 가 실패하면 원래 이름으로 되돌리고 6 (M3 되돌림 가지)", async t => {
  const d0 = await fresh(); if (!(await caseInsensitive(d0))) return t.skip("대소문자를 구분하는 FS — 두 단계 길을 타지 않는다");
  const d = await fresh(); await writeFile(join(d, "Foo"), "MINE");
  const failSecond = `[ "$1" = --version ] && exec "$REAL_MV" "$@"; n=$(cat "$FP_CNT" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$FP_CNT"; [ "$n" = 2 ] && exit 1; exec "$REAL_MV" "$@"`;
  const env = { PATH: await mkBin({ mv: failSecond }), REAL_MV: REAL.mv, FP_CNT: join(base, `cnt-${++seq}`) };
  const r = await sh(RENAME, [d, "Foo", "foo"], env);
  assert.equal(r.code, 6, r.stderr); assert.deepEqual(await list(d), ["Foo"]); assert.equal(await readFile(join(d, "Foo"), "utf8"), "MINE"); assert.deepEqual(await leftovers(d), []);
});

test("RENAME 보통 길: mv 직전 같은 이름 폴더/파일이 생기면 7 · 안으로 안 들어간다 (BSD 되돌림 가지)", async () => {
  for (const mk of ["dir", "file"]) {
    const d = await fresh(); await writeFile(join(d, "a"), "MINE");
    const env = { PATH: await mkBin({ mv: FAKE_MV }), REAL_MV: REAL.mv, FP_CNT: join(base, `cnt-${++seq}`), FP_AT: "1", FP_MK: mk, FP_NEW: join(d, "b") };
    const r = await sh(RENAME, [d, "a", "b"], env);
    assert.equal(r.code, 7, `${mk}: ${r.stderr}`); assert.equal(await readFile(join(d, "a"), "utf8"), "MINE", mk);
    if (mk === "dir") assert.deepEqual(await list(join(d, "b")), [], "b 안으로 안 들어갔다"); else assert.equal(await readFile(join(d, "b"), "utf8"), "OTHER\n");
  }
});

// ── 제출 판단(순수) ──────────────────────────────────────────────────
test("submitPlan: 지우기 — tool=none 은 Enter 로 실행 안 됨 · 단추는 실행 (가장 중요)", () => {
  const ID = "f:1:2", now = 10000, readyAt = 9000;
  const P = (o = {}) => submitPlan({ op: "delete", probe: { tool: "none", kind: "f", n: 3, id: ID }, enter: false, now, readyAt, ...o });
  assert.deepEqual(P({ enter: true }), { kind: "none" }, "영구 삭제는 Enter 로 안 된다");
  assert.deepEqual(P({ enter: false }), { kind: "post", action: "delete", args: { tool: "none", id: ID } }, "단추");
  for (const tool of ["gio", "trash", "trash-put"]) {
    const pr = { tool, kind: "f", n: 3, id: ID };
    assert.deepEqual(P({ probe: pr, enter: true }), { kind: "post", action: "delete", args: { tool, id: ID } }, `${tool} Enter`);
    assert.deepEqual(P({ probe: pr, enter: false }), { kind: "post", action: "delete", args: { tool, id: ID } }, `${tool} 단추`);
  }
  for (const probe of [null, undefined, { err: "x" }, { tool: "rm", kind: "f", n: 1, id: ID }, { tool: "gio", kind: "f", n: 1, id: "bad" }, { tool: "gio", kind: "f", n: 1 }]) {
    for (const enter of [true, false]) assert.deepEqual(P({ probe, enter }), { kind: "none" }, `${JSON.stringify(probe)} ${enter}`);
  }
});

test("submitPlan: 연 뒤 350 ms 안의 Enter 는 무시 · 단추는 그대로 (M5)", () => {
  assert.equal(ENTER_GUARD_MS, 350);
  const probe = { tool: "gio", kind: "f", n: 1, id: "f:1:2" };
  const D = (o = {}) => submitPlan({ op: "delete", probe, enter: true, now: 1000 + 349, readyAt: 1000 + 350, ...o });
  assert.equal(D().kind, "none"); assert.equal(D({ now: 1350 }).kind, "post"); assert.equal(D({ enter: false }).kind, "post", "단추는 늘");
  assert.equal(D({ readyAt: undefined }).kind, "none", "readyAt 이 없으면 Enter 는 안 된다");
  for (const op of ["mkdir", "rename"]) {
    const N = (o = {}) => submitPlan({ op, text: "새이름", name: "옛이름", taken: [], enter: true, now: 1349, readyAt: 1350, ...o });
    assert.equal(N().kind, "none", `${op} 350ms 안 Enter`); assert.equal(N({ now: 1350 }).kind, "post"); assert.equal(N({ enter: false }).kind, "post", `${op} 단추`);
  }
});

test("submitPlan: 이름 창 — 같은 이름(앞뒤 공백 포함)은 닫기 · 새 이름은 post · 문제 있으면 none (M4)", () => {
  const N = (o = {}) => submitPlan({ op: "rename", text: "a", name: "a", taken: ["a", "b"], enter: true, now: 2000, readyAt: 1000, ...o });
  assert.deepEqual(N(), { kind: "close" }, "손대지 않은 Enter");
  assert.deepEqual(N({ text: " a", name: " a" }), { kind: "close" }, "앞 공백 이름을 손대지 않음 — trim 한 a 가 이미 있어도 오류 없이 닫기");
  assert.deepEqual(N({ text: " a ", name: "a" }), { kind: "close" }, "trim 값 = 지금 이름");
  assert.deepEqual(N({ text: " a", name: "a", taken: ["a"] }), { kind: "close" }, "앞 공백만 붙은 지금 이름");
  assert.deepEqual(N({ text: "c" }), { kind: "post", action: "rename", args: { to: "c" } });
  assert.deepEqual(N({ text: "  c  " }), { kind: "post", action: "rename", args: { to: "c" } }, "trim 한 값을 보낸다");
  assert.deepEqual(N({ text: "b" }), { kind: "none" }, "이미 있는 다른 이름");
  for (const text of ["", "  ", "x/y", "..", "a\nb"]) assert.deepEqual(N({ text }), { kind: "none" }, JSON.stringify(text));
  assert.equal(askProblem({ op: "rename", text: " a", name: " a", taken: ["a", " a"] }), null, "problem() 도 같은 조건");
  assert.equal(askProblem({ op: "rename", text: "b", name: "a", taken: ["a", "b"] }), "같은 이름이 이미 있다");
  const M = (o = {}) => submitPlan({ op: "mkdir", text: "새 폴더", name: "", taken: ["새 폴더 2"], enter: false, now: 2000, readyAt: 1000, ...o });
  assert.deepEqual(M(), { kind: "post", action: "mkdir", args: { name: "새 폴더" } });
  assert.deepEqual(M({ text: "새 폴더 2" }), { kind: "none" }); assert.deepEqual(M({ text: " x " }), { kind: "post", action: "mkdir", args: { name: "x" } });
  assert.deepEqual(M({ text: "x", name: "x" }), { kind: "post", action: "mkdir", args: { name: "x" } }, "mkdir 은 «같은 이름 닫기» 가 없다");
  assert.deepEqual(submitPlan({ op: "zap", text: "x", enter: false, now: 2, readyAt: 1 }), { kind: "none" });
  // 요청 인자에 경로 키가 없다
  for (const pl of [N({ text: "c" }), M(), submitPlan({ op: "delete", probe: { tool: "gio", kind: "d", n: 0, id: "d:1:2" }, enter: false, now: 2, readyAt: 1 })]) for (const k of Object.keys(pl.args)) assert.ok(["name", "to", "tool", "id"].includes(k), k);
});

test("ask-view.js 글자: 제출은 submitPlan · 단추는 enter=false · 누르고 있는 키 무시 · 확인 단추 id 안 보임", () => {
  const ask = readFileSync(new URL("../files-plus/ask-view.js", import.meta.url), "utf8");
  assert.equal((ask.match(/e\.is_held/g) ?? []).length, 2, "메뉴 · 창 key 처리");
  assert.ok(ask.includes('this.input.on("submit", () => this.submit(true))'));
  assert.equal((ask.match(/\.submit\(true\)/g) ?? []).length >= 2, true, "Input submit · 지우기 창 Enter");
  assert.equal((ask.match(/on_click\(\(\) => this\.submit\(false\)|\(\) => this\.submit\(false\)/g) ?? []).length, 3, "단추 셋은 enter=false");
  assert.ok(ask.includes("readyAt"));
});

test("REMOVE: 진짜 macOS /usr/bin/trash (FP_REAL_TRASH=1 일 때만 · 그 사용자 휴지통에 파일 하나가 들어간다)", { skip: !(process.env.FP_REAL_TRASH === "1" && process.platform === "darwin" && existsSync("/usr/bin/trash")) && "FP_REAL_TRASH=1 + macOS 에서만" }, async () => {
  const d = await fresh(), f = join(d, `fp-real-trash-${process.pid}.txt`); await writeFile(f, "x");
  const r = await rmv("trash", f); assert.equal(r.code, 0, r.stderr); assert.equal(existsSync(f), false);
  const none = await rmv("trash", join(d, "nope")); assert.equal(none.code, 3);
});
