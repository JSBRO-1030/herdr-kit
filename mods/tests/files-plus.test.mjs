// files-plus 시험 — node 로 mod 의 kinds.js · transfer.js 를 그대로 불러 이 상자의 진짜 hc exec 로 돌린다.
//   node --test ~/Work/herdr-mods/tests/files-plus.test.mjs
// --on 길(다른 머신)은 여기서 못 탄다: viaHc 로 같은 스크립트가 `hc exec`(--on 없이)를 타게 해서 잰다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, writeFile, readFile, readdir, mkdir, rm, chmod, stat, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kindOf, extOf, imageSize, pictureCheck, drawWidth, human, isRunnable, tooManyPixels, safeMarkdown, MD_RENDER_LIMIT, declaredSize, MAC_HANDLER_SCRIPT, isRunnerApp, macHandlerVerdict, linuxHandlerVerdict, isRunnerMime, isRunnerDesktop } from "../files-plus/kinds.js";
import { makeTransfer, CHUNK, TooBig, placed, PLACE, PREP, CACHE_PLACE, oneAtATime, partName } from "../files-plus/transfer.js";
import { snapshot, orphanParts } from "../files-plus/state.js";
import { replaceGroupLines } from "../files-plus/tree.js";

// herdr exec 대역: 같은 꼴 {code, stdout, stderr}. on 은 늘 null 이어야 한다(원격은 hc exec 로만 탄다).
let calls = 0;
function exec(cmd, args = [], opts = {}) {
  assert.equal(opts.on ?? null, null, "시험에서 on 이 들어오면 안 된다");
  calls += 1;
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    const out = [], err = [];
    p.stdout.on("data", (d) => out.push(d)); p.stderr.on("data", (d) => err.push(d));
    p.on("error", reject);
    p.on("close", (code) => resolve({ code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") }));
  });
}
const sha = (b) => createHash("sha256").update(b).digest("hex");
const parts = async (dir) => (await readdir(dir)).filter((n) => n.endsWith(".part"));

const base = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "files-plus-"));
const SIZES = [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 20 * 1024 * 1024 + 7];
const NAMES = [`a b'c"$(x) \`y\`.bin`, "한글 이름.png", ".hidden", "noext", "a.tar.gz"];

test("kinds: 종류와 확장자", () => {
  assert.equal(kindOf("x/사진.JPG"), "image");
  assert.equal(kindOf("a.heic"), "convert");
  assert.equal(kindOf("보고서.pdf"), "doc");
  assert.equal(kindOf("README.md"), "page");
  assert.equal(kindOf("main.rs"), "text");
  assert.equal(extOf(".bashrc"), "");
  assert.equal(extOf("a.tar.GZ"), "gz");
  assert.equal(drawWidth({ w: 100, h: 50 }, 600), 100);
  assert.equal(drawWidth({ w: 3000, h: 50 }, 600), 600);
  assert.equal(drawWidth(null, 600), 600);
  assert.equal(human(0), "0 B");
  assert.equal(human(4 * 1024 * 1024), "4.0 MB");
});

test("kinds: 이미지 머리에서 크기", () => {
  const png = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png); png.write("IHDR", 12); png.writeUInt32BE(1920, 16); png.writeUInt32BE(1080, 20);
  assert.deepEqual(imageSize(png), { w: 1920, h: 1080 });
  const gif = Buffer.alloc(30); gif.write("GIF89a"); gif.writeUInt16LE(320, 6); gif.writeUInt16LE(200, 8);
  assert.deepEqual(imageSize(gif), { w: 320, h: 200 });
  const bmp = Buffer.alloc(30); bmp.write("BM"); bmp.writeInt32LE(640, 18); bmp.writeInt32LE(-480, 22);
  assert.deepEqual(imageSize(bmp), { w: 640, h: 480 });
  const vp8x = Buffer.alloc(30); vp8x.write("RIFF"); vp8x.write("WEBP", 8); vp8x.write("VP8X", 12); vp8x.writeUIntLE(4095 - 1, 24, 3); vp8x.writeUIntLE(300 - 1, 27, 3);
  assert.deepEqual(imageSize(vp8x), { w: 4095, h: 300 });
  // VP8L: 14비트 폭-1 · 14비트 높이-1 (21바이트부터)
  const vp8l = Buffer.alloc(30); vp8l.write("RIFF"); vp8l.write("WEBP", 8); vp8l.write("VP8L", 12);
  const bits = (800 - 1) | ((600 - 1) << 14); vp8l[21] = bits & 0xff; vp8l[22] = (bits >> 8) & 0xff; vp8l[23] = (bits >> 16) & 0xff; vp8l[24] = (bits >> 24) & 0xff;
  assert.deepEqual(imageSize(vp8l), { w: 800, h: 600 });
  // JPEG: SOI · APP0(길이 16) · SOF0
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Array(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, ...Array(12).fill(0)]);
  assert.deepEqual(imageSize(jpg), { w: 800, h: 600 });
  assert.equal(imageSize(Buffer.from("not an image at all, just text....")), null);
});

test("transfer: 내려받기·올리기 — 크기 경계 · 이상한 이름 · 덮어쓰지 않음 (진짜 hc exec)", { timeout: 600000 }, async () => {
  const t = makeTransfer(exec, { viaHc: true });
  assert.equal(await t.canPush(), true, "이 상자 hc 는 exec -i 를 안다");
  const far = join(base, "far"), here = join(base, "here"), back = join(base, "back");
  await mkdir(far, { recursive: true }); await mkdir(back, { recursive: true });
  for (const [k, size] of SIZES.entries()) {
    const name = NAMES[k % NAMES.length].replace(/(\.[^.]*)?$/, (e) => `-${size}${e}`);
    const data = randomBytes(size);
    const src = join(far, name);
    await writeFile(src, data);
    let seen = 0;
    const job = { start: (n) => assert.equal(n, size), progress: (n) => { assert.ok(n >= seen); seen = n; } };
    const got = await t.download(null, src, here, name, job);
    assert.equal(got, join(here, name));
    assert.equal(sha(await readFile(got)), sha(data), `내려받기 ${size}`);
    assert.equal(seen, size);
    const again = await t.download(null, src, here, name, {});
    assert.notEqual(again, got, "같은 이름이 있으면 새 이름");
    assert.match(again, /\(1\)/);
    assert.equal(sha(await readFile(again)), sha(data));
    const up = await t.upload(null, got, back, {});
    assert.equal(up, join(back, name));
    assert.equal(sha(await readFile(up)), sha(data), `올리기 ${size}`);
    const up2 = await t.upload(null, got, back, {});
    assert.match(up2, /\(1\)/);
  }
  assert.deepEqual(await parts(here), []); assert.deepEqual(await parts(back), []);
});

test("transfer: 미리보기 사본은 한 번만 받는다 · 상한", async () => {
  const t = makeTransfer(exec, { viaHc: true });
  const src = join(base, "pic.png"), cache = join(base, "cache");
  const data = randomBytes(CHUNK + 5);
  await writeFile(src, data);
  const a = await t.cached(null, src, cache, "pic.png", 16 * 1024 * 1024, {});
  assert.equal(a.path, join(cache, sha(data), "pic.png"));
  assert.equal(sha(await readFile(a.path)), sha(data));
  const before = calls;
  const b = await t.cached(null, src, cache, "pic.png", 16 * 1024 * 1024, {});
  assert.equal(b.path, a.path);
  assert.ok(calls - before <= 2, `다시 받지 않는다(부른 수 ${calls - before})`);
  await assert.rejects(t.cached(null, src, cache, "pic.png", 1024, {}), TooBig);
  assert.deepEqual(await parts(cache), []);
});

test("transfer: 실패와 취소는 조각을 남기지 않는다", async () => {
  const t = makeTransfer(exec, { viaHc: true });
  const dir = join(base, "fail"); await mkdir(dir, { recursive: true });
  await assert.rejects(t.download(null, dir, join(base, "fail-out"), "x", {}), /파일이 아니다/);
  const src = join(base, "big.bin"); await writeFile(src, randomBytes(3 * CHUNK));
  await assert.rejects(t.upload(null, src, join(base, "no-such-dir"), {}), /폴더가 없다/);
  const job = { cancelled: false, progress() { this.cancelled = true; } };
  await assert.rejects(t.upload(null, src, dir, job), /취소/);
  const job2 = { cancelled: false, progress() { this.cancelled = true; } };
  await assert.rejects(t.download(null, src, dir, "big.bin", job2), /취소/);
  assert.deepEqual(await readdir(dir), []);
});

test("transfer: 줄바꿈 든 이름 · 셸과 같은 이름 규칙(placed)", async () => {
  const t = makeTransfer(exec, { viaHc: true });
  const dir = join(base, "nl"), out = join(base, "nl-out"); await mkdir(dir, { recursive: true });
  const name = "두 줄\n이름.txt", src = join(dir, name);
  await writeFile(src, "x");
  const a = await t.download(null, src, out, name, {});
  assert.equal(a, join(out, name));
  assert.equal(await readFile(a, "utf8"), "x");
  const b = await t.download(null, src, out, name, {});
  assert.equal(b, join(out, "두 줄\n이름 (1).txt"));
  assert.equal(await readFile(b, "utf8"), "x");
  // 셸이 실제로 지은 이름과 placed() 가 같은가
  for (const n of [".bashrc", "x.", "..x", ".a.b", "a.tar.gz", "noext"]) {
    const d = join(base, `rule-${Buffer.from(n).toString("hex")}`);
    const s = join(base, `src-${Buffer.from(n).toString("hex")}`); await writeFile(s, n);
    const first = await t.download(null, s, d, n, {}), second = await t.download(null, s, d, n, {});
    assert.equal(first, join(d, placed(n, 0)));
    assert.equal(second, join(d, placed(n, 1)), `이름 규칙 ${n}`);
    assert.deepEqual((await readdir(d)).sort(), [placed(n, 0), placed(n, 1)].sort());
  }
});

test("transfer: 같은 이름으로 동시에 끝나도 덮어쓰지 않는다", { timeout: 120000 }, async () => {
  const t = makeTransfer(exec, { viaHc: true });
  const dir = join(base, "race"); await mkdir(dir, { recursive: true });
  const files = [];
  for (let i = 0; i < 4; i++) { const p = join(base, `race-src-${i}`, "같은.bin"); await mkdir(join(base, `race-src-${i}`), { recursive: true }); const d = randomBytes(1000 + i); await writeFile(p, d); files.push({ p, h: sha(d) }); }
  const got = await Promise.all(files.map(f => t.upload(null, f.p, dir, {})));
  assert.equal(new Set(got).size, 4, `놓인 이름이 모두 달라야 한다: ${got.join(" | ")}`);
  const hashes = new Set(await Promise.all(got.map(async g => sha(await readFile(g)))));
  assert.deepEqual(hashes, new Set(files.map(f => f.h)), "네 내용이 모두 남아야 한다");
  assert.deepEqual(await parts(dir), []);
});

test("transfer: PLACE — 같은 이름 폴더 · 하드링크 못 거는 곳 · 쓸 수 없는 폴더", async () => {
  const t = makeTransfer(exec, { viaHc: true });
  // 같은 이름의 폴더가 있으면 그 안에 넣지 않고 «이름 (1)»
  const d = join(base, "dirclash"); await mkdir(join(d, "foo"), { recursive: true });
  const s = join(base, "foo-src"); await mkdir(s, { recursive: true }); await writeFile(join(s, "foo"), "data");
  assert.equal(await t.download(null, join(s, "foo"), d, "foo", {}), join(d, "foo (1)"));
  assert.deepEqual(await readdir(join(d, "foo")), []);
  // [주의] /dev/shm 은 Linux 전용 — 없으면(macOS) 다른 파일 시스템 하위 케이스만 건너뛰고 나머지는 그대로 돈다.
  if (existsSync("/dev/shm")) {
    // 조각이 다른 파일 시스템(/dev/shm tmpfs)에 있으면 ln 이 실패한다 → set -C 자리표 + mv 길
    const shm = await mkdtemp("/dev/shm/files-plus-"), far = join(base, "xdev"); await mkdir(far, { recursive: true });
    const part = join(shm, "p.part"), body = randomBytes(5000); await writeFile(part, body);
    const r = await exec("sh", ["-c", PLACE, "sh", part, far, "x.bin", sha(body)]);
    assert.equal(r.code, 0, r.stderr); assert.equal(r.stdout.trim(), "0");
    assert.equal(sha(await readFile(join(far, "x.bin"))), sha(body));
    // 하드링크 못 거는 길에서 이름이 차 있으면 mv -n 이 안 옮긴다 → 다음 번호
    const part1 = join(shm, "p1.part"), body1 = randomBytes(700); await writeFile(part1, body1);
    const r1 = await exec("sh", ["-c", PLACE, "sh", part1, far, "x.bin", sha(body1)]);
    assert.equal(r1.code, 0, r1.stderr); assert.equal(r1.stdout.trim(), "1");
    assert.equal(sha(await readFile(join(far, "x (1).bin"))), sha(body1));
    assert.equal(sha(await readFile(join(far, "x.bin"))), sha(body), "먼저 놓인 파일은 그대로");
    // 하드링크 못 거는 길에서 같은 이름 넷이 동시에 — 잠금으로 한 줄 · 모두 다른 이름 · 내용 그대로.
    // GNU mv -n 은 이미 원자적이라 잠금 없이도 통과한다 → macOS 처럼 «있나 보고 rename» 하는 가짜 mv 로도 돈다
    // (11-13: 잠금 뺀 사본은 가짜 mv 에서 2/2 실패 · 본판 2/2 통과).
    const fake = join(base, "bsdmv"); await mkdir(fake, { recursive: true });
    await writeFile(join(fake, "mv"), '#!/bin/sh\nif [ "$1" = -n ]; then shift; [ -e "$2" ] && exit 0; sleep 0.1; exec /usr/bin/mv -f "$1" "$2"; fi\nexec /usr/bin/mv "$@"\n');
    await chmod(join(fake, "mv"), 0o755);
    for (const env of [process.env, { ...process.env, PATH: `${fake}:${process.env.PATH}` }]) {
      const race = join(base, `xdev-race-${env === process.env ? "gnu" : "bsd"}`); await mkdir(race, { recursive: true });
      const bodies = [0, 1, 2, 3].map(i => randomBytes(2 * CHUNK + i));
      await Promise.all(bodies.map((b, i) => writeFile(join(shm, `r${i}.part`), b)));
      const rs = await Promise.all(bodies.map((b, i) => exec("sh", ["-c", PLACE, "sh", join(shm, `r${i}.part`), race, "같은.bin", sha(b)], { env })));
      assert.deepEqual(rs.map(r => r.code), [0, 0, 0, 0], rs.map(r => r.stderr).join(" | "));
      assert.deepEqual(new Set(rs.map(r => r.stdout.trim())), new Set(["0", "1", "2", "3"]));
      const kept = new Set(await Promise.all((await readdir(race)).map(async n => sha(await readFile(join(race, n))))));
      assert.deepEqual(kept, new Set(bodies.map(sha)), `네 내용이 모두 남아야 한다(${race})`);
    }
    assert.deepEqual(await readdir(shm), []); await rm(shm, { recursive: true, force: true });
  }
  // 쓸 수 없는 폴더: 999번 돌지 않고 바로 rc 6 · 조각 지움
  const ro = join(base, "ro"); await mkdir(ro); await chmod(ro, 0o555);
  const part2 = join(base, "p2.part"), b2 = randomBytes(10); await writeFile(part2, b2);
  const r2 = await exec("sh", ["-c", PLACE, "sh", part2, ro, "y.bin", sha(b2)]);
  assert.equal(r2.code, 6, `${r2.code} ${r2.stderr}`);
  await assert.rejects(stat(part2));
  await chmod(ro, 0o755);
});

// E1: 조각 경로가 정해진 «바로 그 순간» 스냅샷에 part 가 실려야 한다(owner 가 job.onPart 에서 즉시 게시) — 그렇지 않으면 충돌 뒤 정리가 아무것도 못 찾는다.
// 세 길(내려받기 · 미리보기 사본 · 올리기) 모두. 시험은 main.js 의 흐름을 흉내 낸다: onPart → snapshot(state==="run") → 죽은 삶의 orphanParts.
test("E1: onPart — 조각 경로를 정하는 즉시 스냅샷에 part 가 있고 orphanParts 가 그 경로를 찾는다(내려받기 · 사본 · 올리기)", async () => {
  const t = makeTransfer(exec, { viaHc: true });
  const src = join(base, "e1-src.bin"); await writeFile(src, randomBytes(4096));
  const run = async (label, fn) => {
    const job = { id: 1, dir: "down", name: "x", state: "run", total: 1, done: 0, snaps: [] };
    // 늦춤 게시를 흉내: 아래 스냅샷은 «이 호출 안에서만» 만들어진다 — 다른 게시는 없다.
    job.onPart = () => { job.snaps.push({ snap: snapshot("o", "", [job], 1, { life: "OLD" }), existedThen: existsSync(job.part) }); };
    await fn(job);
    assert.equal(job.snaps.length, 1, `${label}: onPart 는 정확히 한 번`);
    const [{ snap, existedThen }] = job.snaps;
    assert.equal(snap.jobs[0].part, job.part, `${label}: 스냅샷의 part`);
    assert.equal(existedThen, false, `${label}: PREP(조각 만들기) 전에 게시한다`);
    assert.deepEqual(orphanParts(snap, "NEW"), [{ path: job.part, on: job.partOn ?? null }], `${label}: 죽은 삶의 정리 대상`);
  };
  await run("download", job => t.download(null, src, join(base, "e1-dl"), "e1.bin", job));
  await run("cached", job => t.cached(null, src, join(base, "e1-cache"), "e1.bin", 1 << 20, job));
  await mkdir(join(base, "e1-up"), { recursive: true });
  await run("upload", job => t.upload(null, src, join(base, "e1-up"), job));
  // onPart 가 던져도 전송은 계속한다
  const out = await t.download(null, src, join(base, "e1-dl2"), "e1b.bin", { onPart() { throw new Error("boom"); } });
  assert.equal((await stat(out)).size, 4096);
});

// E3: PLACE 는 조각이 사라지면(충돌 뒤 정리가 지움) 성공을 보고하지 않고 rc 11 로 실패한다.
test("E3: PLACE · CACHE_PLACE — 시작 때 조각이 없으면 rc 11 · 해시 계산 중에 사라져도 rc 11(성공 보고 없음)", async () => {
  const d = join(base, "e3"); await mkdir(d, { recursive: true });
  const part = join(d, ".0a1b2c3d.files-plus-abcdefgh.part");
  const r0 = await exec("sh", ["-c", PLACE, "sh", part, d, "gone.bin", "0".repeat(64)]);
  assert.equal(r0.code, 11, r0.stderr); assert.equal(r0.stdout.trim(), ""); assert.match(r0.stderr, /사라졌다/);
  assert.deepEqual((await readdir(d)).filter(n => n.includes("gone")), []);
  const c0 = await exec("sh", ["-c", CACHE_PLACE, "sh", part, join(d, "c", "x.bin"), "0".repeat(64)]);
  assert.equal(c0.code, 11, c0.stderr);
  // 해시 계산이 느릴 때(가짜 sha256sum 이 0.7 s 잔다) 그 사이 조각이 지워진다 — 옛 PLACE 는 rc 0 · 아무 파일도 없었다
  const fake = join(base, "e3-slow"); await mkdir(fake, { recursive: true });
  await writeFile(join(fake, "sha256sum"), "#!/bin/sh\nsleep 0.7; exec shasum -a 256\n"); await chmod(join(fake, "sha256sum"), 0o755);
  const body = randomBytes(300); await writeFile(part, body);
  const done = exec("sh", ["-c", PLACE, "sh", part, d, "race.bin", sha(body)], { env: { ...process.env, PATH: `${fake}:${process.env.PATH}` } });
  await new Promise(r => setTimeout(r, 250)); await rm(part, { force: true });
  const r1 = await done;
  assert.equal(r1.code, 11, `${r1.code} ${r1.stdout} ${r1.stderr}`); assert.equal(r1.stdout.trim(), "");
  assert.deepEqual((await readdir(d)).filter(n => n.includes("race")), []);
  // 정상 경로는 그대로 rc 0
  const ok = join(d, ".0a1b2c3d.files-plus-zzzzzzzz.part"); await writeFile(ok, body);
  const r2 = await exec("sh", ["-c", PLACE, "sh", ok, d, "fine.bin", sha(body)]);
  assert.equal(r2.code, 0, r2.stderr); assert.equal(r2.stdout.trim(), "0"); assert.equal(sha(await readFile(join(d, "fine.bin"))), sha(body));
});

// G6: ln 직후 조각이 밖에서 지워져도(ln 을 «연결 뒤 조각 삭제» 로 바꿔 흉내) 놓인 파일이 온전하면 성공(rc 0 · k=0) — 해시가 다르면 성공이 아니다.
test("G6: PLACE — ln 직후 조각이 사라져도 놓인 파일 해시가 맞으면 성공", async () => {
  const d = join(base, "g6"); await mkdir(d, { recursive: true });
  const body = randomBytes(500), part = join(d, ".0a1b2c3d.files-plus-g6g6g6g6.part");
  const hook = 'ln() { command ln "$@" && rm -f "$1"; }\n';
  await writeFile(part, body);
  const r = await exec("sh", ["-c", hook + PLACE, "sh", part, d, "kept.bin", sha(body)]);
  assert.equal(r.code, 0, r.stderr); assert.equal(r.stdout.trim(), "0");
  assert.equal(sha(await readFile(join(d, "kept.bin"))), sha(body)); assert.deepEqual(await parts(d), []);
  // 해시가 다르면 조각이 먼저 «해시가 다르다» 로 실패 — 파일은 안 놓인다
  const part2 = join(d, ".0a1b2c3d.files-plus-g7g7g7g7.part"); await writeFile(part2, body);
  const r2 = await exec("sh", ["-c", hook + PLACE, "sh", part2, d, "bad.bin", "0".repeat(64)]);
  assert.equal(r2.code, 4); assert.deepEqual((await readdir(d)).filter(n => n.includes("bad")), []);
});

test("transfer: 같은 머신은 hc 없이 복사", async () => {
  const t = makeTransfer(exec);
  const src = join(base, "local.txt"); await writeFile(src, "안녕\n");
  const out = await t.download(null, src, join(base, "local-out"), "local.txt", {});
  assert.equal(await readFile(out, "utf8"), "안녕\n");
});

test.after(async () => { await rm(base, { recursive: true, force: true }); });

test("oneAtATime: 한 줄로 차례대로 · 앞 것이 실패해도 다음 것은 돈다", async () => {
  const line = oneAtATime(), log = [];
  let now = 0, most = 0;
  const job = (n, ms, fail) => line(async () => {
    now += 1; most = Math.max(most, now); log.push(`s${n}`);
    await new Promise(r => setTimeout(r, ms));
    now -= 1; log.push(`e${n}`);
    if (fail) throw new Error(`실패${n}`);
    return n;
  });
  const all = await Promise.allSettled([job(1, 30), job(2, 5, true), job(3, 1), job(4, 10), line(() => { throw new Error("바로 실패"); })]);
  assert.equal(most, 1);
  assert.deepEqual(log, ["s1", "e1", "s2", "e2", "s3", "e3", "s4", "e4"]);
  assert.deepEqual(all.map(r => r.status === "fulfilled" ? r.value : r.reason.message), [1, "실패2", 3, 4, "바로 실패"]);
  assert.equal(await line(async () => "뒤"), "뒤");
});

test("transfer: 긴 이름(250 바이트)도 받는다 · placing 훅 · job.part · 격리 속성(macOS)", async () => {
  const seenX = [];
  const spy = (cmd, args, opts) => { if (cmd === "xattr") seenX.push(args); return exec(cmd, args, opts); };
  const t = makeTransfer(spy, { viaHc: true, quarantine: () => process.platform === "darwin" });
  const dir = join(base, "long"); await mkdir(dir, { recursive: true });
  const name = "가".repeat(80) + "x".repeat(8) + ".bin";             // 240 + 8 + 4 = 252 바이트
  assert.ok(Buffer.byteLength(name) >= 250 && Buffer.byteLength(name) <= 255);
  const src = join(dir, name); await writeFile(src, "hello");
  const here = join(base, "long-here");
  const job = { placing() { this.placed = (this.placed ?? 0) + 1; } };
  const got = await t.download(null, src, here, name, job);
  assert.equal(await readFile(got, "utf8"), "hello");
  assert.equal(job.placed, 1);
  assert.ok(job.part.startsWith(`${here}/.`) && job.part.endsWith(".part") && job.partOn === null);
  assert.deepEqual(await parts(here), []);
  if (process.platform === "darwin") {
    assert.equal(seenX.length, 1); assert.deepEqual(seenX[0].slice(0, 2), ["-w", "com.apple.quarantine"]);
    assert.match(seenX[0][2], /^0081;[0-9a-f]+;files-plus;$/); assert.equal(seenX[0][3], job.part);   // 놓기 전 조각에 단다(inode 가 그대로 이름만 바뀐다)
    const r = await exec("xattr", ["-p", "com.apple.quarantine", got]); assert.equal(r.code, 0);
  } else assert.equal(seenX.length, 0);
  // 올리기에는 격리 속성을 달지 않는다 · 0바이트도 placing 을 부른다
  seenX.length = 0;
  const z = join(dir, "zero.bin"); await writeFile(z, "");
  const jz = { placing() { this.placed = true; } };
  const back = join(base, "long-back"); await mkdir(back, { recursive: true });
  const up = await t.upload(null, z, back, jz);
  assert.equal(jz.placed, true); assert.equal(seenX.length, 0); assert.equal((await stat(up)).size, 0);
  const off = makeTransfer(spy, { viaHc: true });                    // quarantine 끔 → xattr 안 부른다
  await off.download(null, src, join(base, "long-off"), name, {}); assert.equal(seenX.length, 0);
});

test("transfer: PREP 는 이미 있는 조각 파일·심볼릭 링크를 자르지 않고 거절한다(noclobber)", async () => {
  const dir = join(base, "prep"); await mkdir(dir, { recursive: true });
  const run = (part) => exec("sh", ["-c", PREP, "sh", dir, part, "0"]);
  const fresh = join(dir, ".fresh.part");
  assert.equal((await run(fresh)).code, 0); assert.equal((await stat(fresh)).size, 0);
  const keep = join(dir, ".keep.part"); await writeFile(keep, "중요한 내용");
  const r = await run(keep);
  assert.notEqual(r.code, 0); assert.match(r.stderr, /이미 있다/);
  assert.equal(await readFile(keep, "utf8"), "중요한 내용");
  const victim = join(dir, "victim.txt"); await writeFile(victim, "희생");
  const link = join(dir, ".link.part"); await symlink(victim, link);
  assert.notEqual((await run(link)).code, 0); assert.equal(await readFile(victim, "utf8"), "희생");
  const dangling = join(dir, ".dangling.part"); await symlink(join(dir, "nowhere"), dangling);
  assert.notEqual((await run(dangling)).code, 0); await assert.rejects(stat(join(dir, "nowhere")));
  // 전송 전체: 같은 조각 이름을 미리 심어 둔 파일은 그대로 · 오류는 «준비:» 로 깔끔히
  const t = makeTransfer(exec, { viaHc: true });
  const src = join(dir, "src.bin"); await writeFile(src, "abc");
  const out = join(base, "prep-out"); await mkdir(out, { recursive: true });
  const orig = Math.random; Math.random = () => 0.123456789;      // partName 의 무작위 부분을 고정 → 같은 조각 이름이 겹친다
  try {
    const planted = join(out, partName("src.bin")); await writeFile(planted, "남의 파일");
    await assert.rejects(t.download(null, src, out, "src.bin", {}), /준비.*이미 있다/);
    assert.equal(await readFile(planted, "utf8"), "남의 파일");   // 자르지도 지우지도 않는다
  } finally { Math.random = orig; }
});

test("transfer: 격리 속성은 놓기 «전에» 조각에 달린다 · 이름이 바뀌어도 남는다(macOS)", { skip: process.platform !== "darwin" }, async () => {
  const seen = [];
  let placedBefore = null;
  const dir = join(base, "qbefore"); await mkdir(dir, { recursive: true });
  const src = join(base, "qsrc.bin"); await writeFile(src, "quarantine me");
  const spy = async (cmd, args, opts) => {
    if (cmd === "xattr") { seen.push(args[3]); placedBefore = (await readdir(dir)).some(n => !n.startsWith(".")); }
    return exec(cmd, args, opts);
  };
  const t = makeTransfer(spy, { viaHc: true, quarantine: true });
  const got = await t.download(null, src, dir, "qsrc.bin", {});
  assert.equal(seen.length, 1); assert.ok(seen[0].startsWith(`${dir}/.`) && seen[0].endsWith(".part"), seen[0]);
  assert.equal(placedBefore, false, "xattr 시점에 진짜 이름이 아직 없어야 한다");
  assert.equal((await exec("xattr", ["-p", "com.apple.quarantine", got])).code, 0, "ln 뒤에도 격리 속성이 남는다");
  // 미리보기 사본(mv -f)도 같다
  const cache = join(base, "qcache"); const seenC = [];
  const t2 = makeTransfer((c, a, o) => { if (c === "xattr") seenC.push(a[3]); return exec(c, a, o); }, { viaHc: true, quarantine: true });
  const c = await t2.cached(null, src, cache, "qsrc.bin", 1 << 20, {});
  assert.ok(seenC[0].endsWith(".part"));
  assert.equal((await exec("xattr", ["-p", "com.apple.quarantine", c.path])).code, 0);
});

test("transfer(M6): 이 컴퓨터 안의 복사(on == null · viaHc 아님)에는 격리 속성을 달지 않는다", async () => {
  const seenX = [];
  const spy = (cmd, args, opts) => { if (cmd === "xattr") seenX.push(args); return exec(cmd, args, opts); };
  const t = makeTransfer(spy, { quarantine: true });
  const dir = join(base, "q-local"); await mkdir(dir, { recursive: true });
  const src = join(dir, "a.txt"); await writeFile(src, "x");
  await t.download(null, src, join(base, "q-local-dst"), "a.txt", {});
  assert.equal(seenX.length, 0);
  await t.cached(null, src, join(base, "q-local-cache"), "a.txt", 1024, {});
  assert.equal(seenX.length, 0);
});

test("kinds(M11 M13 M14 M16): isRunnable · safeMarkdown · tooManyPixels", () => {
  for (const n of ["x.command", "X.APP", "a.sh", "b.pkg", "c.dmg", "d.terminal", "e.workflow", "f.scpt"]) assert.equal(isRunnable(n), true, n);
  // D2: 시작 형식(Terminal 세션 · 서버 접속 · 메일 · Java Web Start · Linux 런처)과 셸 · 번들 · 스크립트 형식
  for (const n of ["a.term", "b.afploc", "c.ftploc", "d.vncloc", "e.mailloc", "f.newsloc", "g.jnlp", "h.desktop", "i.webloc", "j.inetloc", "k.fileloc", "l.terminal", "m.tool", "n.workflow", "o.pkg", "p.mpkg", "q.scpt", "r.scptd", "s.applescript", "t.jar", "u.app", "v.command", "w.sh", "x.zsh", "y.bash", "z.csh", "a.ksh", "b.fish"]) assert.equal(isRunnable(n), true, n);
  // 일반 소스는 글자로 미리 본다 → 이름만으론 걸지 않는다(+x 는 열기 검사가 따로 거른다)
  for (const n of ["a.py", "b.pl", "c.rb", "d.js", "e.php", "f.ts"]) assert.equal(isRunnable(n), false, n);
  for (const n of ["a.txt", "b.png", "c.md", "command", ".sh"]) assert.equal(isRunnable(n), false, n);
  // 이름 끝의 점·공백은 LaunchServices 가 무시한다 → 같은 형식으로 본다. 확장자 없는 +x 파일 · 심볼릭 링크는 main.js 가 파일 상태로 따로 거른다.
  for (const n of ["y.command.", "y.command ", "y.command. .", "z.APP.  ", "a.sh."]) assert.equal(isRunnable(n), true, JSON.stringify(n));
  for (const n of ["notes.txt.", "notes.txt ", "command.", "."]) assert.equal(isRunnable(n), false, JSON.stringify(n));
  const out = safeMarkdown("a ![alt](https://x.test/p.png) b ![r][1]\n<img src=\"http://10.0.0.1/\"> <IMG\n```\n![keep](u)\n```\n[link](https://ok)");
  assert.ok(!out.includes("![")); assert.ok(!/<img/i.test(out));
  assert.ok(out.includes("[그림: alt](https://x.test/p.png)")); assert.ok(out.includes("[그림: r][1]"));
  assert.ok(out.includes("[link](https://ok)"));
  // 불변식: 어떤 입력이든 `![` · `<img` 가 없다 — 치환이 새로 만드는 경우 · CommonMark 울타리 규칙을 비껴가는 경우
  const adversarial = [
    "!![x](http://e/a.png)", "!<img src=x>(http://e/b.png)", "!!!![x](u)", "<IMG\nsrc=x>", "<imgx y>", "<im<img>g src=x>",
    "```\n![in](u)\n```", "````\n```\n![in](u)\n````", "```js\n![in](u)\n``` x\n![out](u)", "~~~\n![in](u)\n```\n![out](u)",
    "```a`b\n![x](u)", "a\r![cr](u)", "a\r\n![crlf](u)\r\n<img src=y>", "![a][b]\n\n[b]: http://e/c.png",
  ];
  for (const src of adversarial) { const o = safeMarkdown(src); assert.ok(!o.includes("!["), `![ 남음: ${JSON.stringify(src)} → ${JSON.stringify(o)}`); assert.ok(!/<img/i.test(o), `<img 남음: ${JSON.stringify(src)}`); }
  assert.equal(safeMarkdown("a\r\nb\rc"), "a\nb\nc");
  // `![alt](u)` 의 눈에 보이는 꼴은 그대로: `[그림: alt](u)` · `!` 뒤에 `[` 가 없으면 건드리지 않는다
  assert.equal(safeMarkdown("x ![a](u) !!![b](v) wow! [c](w) !"), "x [그림: a](u) [그림: b](v) wow! [c](w) !");
  assert.equal(MD_RENDER_LIMIT, 200000);
  assert.equal(tooManyPixels({ w: 10000, h: 10001 }), true); assert.equal(tooManyPixels({ w: 10000, h: 10000 }), false);
  assert.equal(tooManyPixels(null), false);
});

test("D1: safeMarkdown 은 200 KB 적대 입력에서도 선형 시간(< 500 ms)이고 불변식을 지킨다", () => {
  const N = 200000;
  const inputs = {
    bang: "!".repeat(N), bangX: "!x".repeat(N / 2), imgOpen: "<img".repeat(N / 4), imgSpace: "<img ".repeat(N / 5), imgNl: "<img\n".repeat(N / 5),
    bracket: "[".repeat(N), lt: "<".repeat(N), gt: ">".repeat(N), ltSlash: "</".repeat(N / 2), bangBracket: "![".repeat(N / 2),
    mixed: "!<img ![".repeat(N / 8), bangImg: "!<img x".repeat(N / 7), cr: "\r".repeat(N), crlf: "\r\n".repeat(N / 2), tagPrefix: "<im".repeat(N / 3),
  };
  for (const [k, v] of Object.entries(inputs)) {
    const t = performance.now();
    const o = safeMarkdown(v);
    const ms = performance.now() - t;
    assert.ok(ms < 500, `${k}: ${ms.toFixed(1)} ms`);
    assert.ok(!o.includes("!["), `${k}: ![ 남음`); assert.ok(!/<img/i.test(o), `${k}: <img 남음`);
  }
});

test("D3: cached — 격리 속성 쓰기 실패가 quarantineFailed 로 드러난다(전송은 그대로 성공)", async () => {
  const dir = join(base, "qf"); await mkdir(dir, { recursive: true });
  const src = join(dir, "s.bin"); await writeFile(src, "payload");
  for (const [label, xa] of [["종료 코드 1", async () => ({ code: 1, stdout: "", stderr: "denied" })], ["던짐", () => Promise.reject(new Error("no xattr"))]]) {
    const fail = (c, a, o) => (c === "xattr" ? xa() : exec(c, a, o));
    const t = makeTransfer(fail, { viaHc: true, quarantine: true });
    const cache = join(dir, `c-${label.length}`);
    const c1 = await t.cached(null, src, cache, "s.bin", 1 << 20, {});
    assert.equal(c1.quarantineFailed, true, `${label}: 새로 받음`);
    assert.equal(await readFile(c1.path, "utf8"), "payload");
    assert.equal((await t.cached(null, src, cache, "s.bin", 1 << 20, {})).quarantineFailed, true, `${label}: 사본 재사용`);
  }
  const ok = makeTransfer(async (c, a, o) => (c === "xattr" ? { code: 0, stdout: "", stderr: "" } : exec(c, a, o)), { viaHc: true, quarantine: true });
  assert.equal((await ok.cached(null, src, join(dir, "c-ok"), "s.bin", 1 << 20, {})).quarantineFailed, false);
  const off = makeTransfer(exec, { viaHc: true });   // 격리를 달 일 없음(Linux 등) → 실패 아님
  assert.equal((await off.cached(null, src, join(dir, "c-off"), "s.bin", 1 << 20, {})).quarantineFailed, false);
});

// ── M9: 기본 앱 판정(순수) ─────────────────────────────────────────────
test("kinds(M9): RUNNABLE 에 디스크 이미지 · isRunnerApp(번들 id · 앱 이름 · 대소문자)", () => {
  for (const n of ["a.iso", "b.IMG", "c.sparseimage", "d.sparsebundle", "e.dmg"]) assert.equal(isRunnable(n), true, n);
  const yes = [
    ["/System/Applications/Utilities/Terminal.app", "com.apple.Terminal"], ["/Applications/iTerm.app", "com.googlecode.iterm2"], ["/Applications/Python 3.12/Python Launcher.app", "org.python.PythonLauncher"],
    ["/System/Library/CoreServices/Installer.app", "com.apple.installer"], ["/System/Applications/Automator.app", "com.apple.Automator"], ["/x/Automator Application Stub.app", "com.apple.automator.Foo"],
    ["/x/Jar Launcher.app", "com.apple.JarLauncher"], ["/x/Java Web Start.app", ""], ["/System/Library/CoreServices/DiskImageMounter.app", "com.apple.DiskImageMounter"],
    ["/Applications/Ghostty.app", "com.mitchellh.ghostty"], ["/Applications/Alacritty.app", "org.alacritty"], ["/Applications/Alacritty.app", "io.alacritty"], ["/Applications/kitty.app", "net.kovidgoyal.kitty"],
    ["/Applications/WezTerm.app", "com.github.wez.wezterm"], ["/Applications/Warp.app", "dev.warp.Warp-Stable"], ["/Applications/Hyper.app", "co.zeit.hyper"], ["/Applications/Tabby.app", "org.tabby"],
    ["/Applications/Herdr.app", "dev.herdr.app"], ["/x/Python Launcher 3.app", ""], ["/Applications/TERMINAL.APP/", ""], ["", "COM.APPLE.TERMINAL"],
  ];
  for (const [path, bundleId] of yes) assert.equal(isRunnerApp({ path, bundleId }), true, `${path} ${bundleId}`);
  const no = [["/System/Applications/TextEdit.app", "com.apple.TextEdit"], ["/Applications/Xcode.app", "com.apple.dt.Xcode"], ["/Applications/Google Chrome.app", "com.google.Chrome"],
    ["/Applications/Visual Studio Code.app", "com.microsoft.VSCode"], ["/System/Applications/Preview.app", "com.apple.Preview"], ["/x/Terminalizer.app", ""], ["/x/Installer Notes.app", ""], ["", ""]];
  for (const [path, bundleId] of no) assert.equal(isRunnerApp({ path, bundleId }), false, `${path} ${bundleId}`);
  assert.equal(isRunnerApp(), false); assert.equal(isRunnerApp({ path: null, bundleId: null }), false);
});

test("kinds(M9): macHandlerVerdict — 앱 없음 · 오류 · 시간 초과 · 해석 불가 → 열지 않음 · 실행기 → 열지 않음 · 그 밖 → 연다", () => {
  const ok = (path, id = "") => ({ code: 0, stdout: `${path}\n${id}\n`, stderr: "" });
  assert.deepEqual(macHandlerVerdict(ok("/System/Applications/TextEdit.app", "com.apple.TextEdit")), { open: true, app: "TextEdit" });
  assert.deepEqual(macHandlerVerdict(ok("/Applications/iTerm.app", "com.googlecode.iterm2")), { open: false, why: "runner", app: "iTerm" });
  assert.deepEqual(macHandlerVerdict(ok("/Applications/Terminal.app", "")), { open: false, why: "runner", app: "Terminal" });   // 번들 id 가 비면 이름으로
  // E6: Finder 별칭 — 대상(계산기 · .webloc · .shortcut · .mobileconfig)이 아니라 별칭 자체를 보여 준다
  assert.deepEqual(macHandlerVerdict({ code: 0, stdout: "@alias" }), { open: false, why: "alias" });
  assert.deepEqual(macHandlerVerdict({ code: 0, stdout: "@alias\n" }), { open: false, why: "alias" });
  assert.deepEqual(macHandlerVerdict({ code: 0, stdout: "@unknown" }), { open: false, why: "unknown" });  // 별칭 여부를 못 읽음 → 열지 않음
  assert.deepEqual(macHandlerVerdict({ code: 1, stdout: "@alias" }), { open: false, why: "unknown" });
  assert.ok(/NSURLIsAliasFileKey/.test(MAC_HANDLER_SCRIPT) && /@alias/.test(MAC_HANDLER_SCRIPT));
  for (const r of [null, undefined, { code: 1, stdout: "/a.app\ncom.x\n" }, { code: null, stdout: "" }, { code: 0, stdout: "" }, { code: 0, stdout: "\n" }, { code: 0, stdout: "garbage" }, { code: 0, stdout: 5 }, { code: 0 }])
    assert.deepEqual(macHandlerVerdict(r), { open: false, why: "unknown" }, JSON.stringify(r));
});

test("kinds(M9): linuxHandlerVerdict — mime 실행 꼴 · 터미널·런처·마운터 기본 앱 · 도구 실패", () => {
  const r = out => ({ code: 0, stdout: `${out}\n`, stderr: "" });
  assert.deepEqual(linuxHandlerVerdict(r("text/plain"), r("org.gnome.TextEditor.desktop")), { open: true, app: "org.gnome.TextEditor.desktop" });
  assert.deepEqual(linuxHandlerVerdict(r("image/png"), r("eog.desktop")), { open: true, app: "eog.desktop" });
  for (const m of ["application/x-executable", "application/x-sharedlib", "application/x-shellscript", "application/x-desktop", "application/x-perl", "application/x-python-code", "application/x-ms-dos-executable",
    "application/x-msdownload", "application/x-iso9660-image", "application/x-raw-disk-image", "application/java-archive", "application/x-java-jnlp-file", "application/vnd.appimage", "Application/X-Executable",
    // E7
    "application/vnd.debian.binary-package", "application/x-deb", "application/x-rpm", "application/x-redhat-package-manager", "application/vnd.flatpak", "application/vnd.flatpak.ref", "application/vnd.flatpak.repo",
    "application/x-cd-image", "application/x-iso9660-appimage", "application/vnd.appimage", "text/x-shellscript", "application/x-shellscript"])
    assert.equal(linuxHandlerVerdict(r(m), r("eog.desktop")).why, "runner", m);
  for (const d of ["gnome-terminal.desktop", "org.gnome.Terminal.desktop", "konsole.desktop", "xterm.desktop", "alacritty.desktop", "kitty.desktop", "wezterm.desktop", "org.wezfurlong.wezterm.desktop", "tilix.desktop",
    "terminator.desktop", "xfce4-terminal.desktop", "wine.desktop", "java.desktop", "gnome-disk-image-mounter.desktop", "org.gnome.DiskUtility.desktop", "appimagelauncher.desktop", "python.desktop", "perl.desktop",
    // E7
    "gnome-software.desktop", "org.gnome.Software.desktop", "gdebi.desktop", "org.kde.discover.desktop", "ptyxis.desktop", "org.gnome.Ptyxis.desktop", "foot.desktop", "footclient.desktop", "ghostty.desktop",
    "com.mitchellh.ghostty.desktop", "io.elementary.terminal.desktop", "qterminal.desktop", "lxterminal.desktop", "mate-terminal.desktop", "sakura.desktop", "st.desktop", "urxvt.desktop", "rxvt.desktop", "kgx.desktop",
    "org.gnome.Console.desktop", "org.kde.konsole.desktop", "Alacritty.desktop", "kitty.desktop"])
    assert.equal(linuxHandlerVerdict(r("text/x-foo"), r(d)).why, "runner", d);
  assert.equal(isRunnerMime("application/pdf"), false); assert.equal(isRunnerDesktop("org.gnome.Evince.desktop"), false); assert.equal(isRunnerDesktop(""), false);
  for (const [a, b] of [[null, null], [{ code: 1, stdout: "text/plain" }, r("x.desktop")], [r(""), r("x.desktop")], [r("not a mime"), r("x.desktop")], [r("text/plain"), null], [r("text/plain"), r("")], [r("text/plain"), { code: 2, stdout: "x.desktop" }]])
    assert.deepEqual(linuxHandlerVerdict(a, b), { open: false, why: "unknown" }, JSON.stringify([a, b]));
});

// ── M12: 선언 크기(픽셀 폭탄) 머리글 읽기 ─────────────────────────────────
const u16 = (n, le) => (le ? [n & 255, n >> 8 & 255] : [n >> 8 & 255, n & 255]);
const u32 = (n, le) => (le ? [n & 255, n >> 8 & 255, n >> 16 & 255, n >>> 24 & 255] : [n >>> 24 & 255, n >> 16 & 255, n >> 8 & 255, n & 255]);
function tiff(w, h, { le = true, type = 3, extra = [] } = {}) {
  const v = n => (type === 3 ? [...u16(n, le), 0, 0] : u32(n, le));
  const ents = [...extra, [256, w], [257, h]];
  const bytes = [...(le ? [0x49, 0x49, 42, 0] : [0x4d, 0x4d, 0, 42]), ...u32(8, le), ...u16(ents.length, le)];
  for (const [tag, val] of ents) bytes.push(...u16(tag, le), ...u16(tag > 257 ? 3 : type, le), ...u32(1, le), ...(tag > 257 ? [...u16(val, le), 0, 0] : v(val)));
  return Uint8Array.from([...bytes, 0, 0, 0, 0]);
}
// ICO: 디렉터리 칸마다 자료 오프셋(22)이 있고 자료는 뒤에 0 으로 채운다(PNG 서명 아님 · DIB 아님)
const ico = (...dims) => Uint8Array.from([0, 0, 1, 0, ...u16(dims.length, true), ...dims.flatMap(([w, h]) => [w, h, 0, 0, 1, 0, 32, 0, 0, 0, 0, 0, 22, 0, 0, 0]), ...new Array(64).fill(0)]);
const text = s => new TextEncoder().encode(s);

test("kinds(M12): declaredSize — TIFF(II · MM · SHORT · LONG)", () => {
  assert.deepEqual(declaredSize(tiff(640, 480)), { w: 640, h: 480 });
  assert.deepEqual(declaredSize(tiff(640, 480, { le: false })), { w: 640, h: 480 });
  assert.deepEqual(declaredSize(tiff(70000, 80000, { type: 4 })), { w: 70000, h: 80000 });
  assert.deepEqual(declaredSize(tiff(70000, 80000, { type: 4, le: false })), { w: 70000, h: 80000 });
  assert.deepEqual(declaredSize(tiff(10, 20, { extra: [[254, 0], [255, 1]] })), { w: 10, h: 20 });
  assert.equal(tooManyPixels(declaredSize(tiff(70000, 80000, { type: 4 }))), true);       // 5.6 GP
  assert.equal(tooManyPixels(declaredSize(tiff(10000, 10000, { type: 4 }))), false);
  assert.equal(declaredSize(Uint8Array.from([0x49, 0x49, 42, 0, 0xff, 0xff, 0xff, 0x7f, 0, 0, 0, 0])), null);   // IFD 위치가 범위 밖
  assert.equal(declaredSize(tiff(0, 5)), null);
  assert.equal(declaredSize(Uint8Array.from([0x49, 0x49, 43, 0, 8, 0, 8, 0])), null);       // BigTIFF 인데 잘림 = 모름
});

// BigTIFF(E2): 머리 16 바이트 · 항목 20 바이트(값 8 바이트 칸) · SHORT/LONG/LONG8
function bigTiff(w, h, { le = true, type = 16 } = {}) {
  const u64 = n => { const lo = n % 4294967296, hi = Math.floor(n / 4294967296); return le ? [...u32(lo, true), ...u32(hi, true)] : [...u32(hi, false), ...u32(lo, false)]; };
  const val = n => (type === 3 ? [...u16(n, le), 0, 0, 0, 0, 0, 0] : type === 4 ? [...u32(n, le), 0, 0, 0, 0] : u64(n));
  const bytes = [...(le ? [0x49, 0x49, 43, 0] : [0x4d, 0x4d, 0, 43]), ...u16(8, le), ...u16(0, le), ...u64(16), ...u64(2)];
  for (const [tag, v] of [[256, w], [257, h]]) bytes.push(...u16(tag, le), ...u16(type, le), ...u64(1), ...val(v));
  return Uint8Array.from([...bytes, ...u64(0)]);
}
test("kinds(E2): declaredSize — BigTIFF(SHORT · LONG · LONG8 · II · MM)", () => {
  for (const le of [true, false]) for (const type of [3, 4, 16]) assert.deepEqual(declaredSize(bigTiff(640, 480, { le, type })), { w: 640, h: 480 }, `le=${le} type=${type}`);
  assert.deepEqual(declaredSize(bigTiff(5000000000, 3, { type: 16 })), { w: 5000000000, h: 3 });          // 2^32 넘는 LONG8
  assert.equal(tooManyPixels(declaredSize(bigTiff(70000, 80000, { type: 16 }))), true);
  const bad = bigTiff(10, 10); bad[4] = 4; assert.equal(declaredSize(bad), null);                           // 오프셋 크기가 8 이 아님
  assert.equal(declaredSize(bigTiff(0, 5)), null);
  assert.equal(declaredSize(bigTiff(10, 10).subarray(0, 40)), null);                                        // 항목이 잘림
});

test("kinds(M12): declaredSize — ICO/CUR(0 = 256 · 최대)", () => {
  assert.deepEqual(declaredSize(ico([16, 16], [32, 32], [0, 0])), { w: 256, h: 256 });
  assert.deepEqual(declaredSize(ico([48, 48])), { w: 48, h: 48 });
  const cur = ico([8, 8]); cur[2] = 2; assert.deepEqual(declaredSize(cur), { w: 8, h: 8 });
  assert.equal(declaredSize(Uint8Array.from([0, 0, 1, 0, 0, 0, 0, 0])), null);             // 항목 0개
  assert.equal(declaredSize(Uint8Array.from([0, 0, 1, 0, 9, 0, 16, 16, 0, 0, 1, 0, 32, 0, 0, 0, 0, 0, 22, 0, 0, 0])), null);   // 개수만 크고 잘림 → 모름(fail-closed)
});

test("kinds(M12): declaredSize — PNM P1–P6 · PAM P7", () => {
  assert.deepEqual(declaredSize(text("P6\n# 주석\n640 480\n255\n")), { w: 640, h: 480 });
  assert.deepEqual(declaredSize(text("P1 3 4\n0 1 0")), { w: 3, h: 4 });
  assert.deepEqual(declaredSize(text("P5\r\n#a\r\n#b 1 2\r\n  70000   80000 \r\n255\n")), { w: 70000, h: 80000 });
  assert.equal(tooManyPixels(declaredSize(text("P6\n70000 80000\n255\n"))), true);
  assert.deepEqual(declaredSize(text("P7\nWIDTH 100\nHEIGHT 50\nDEPTH 3\nMAXVAL 255\nTUPLTYPE RGB\nENDHDR\n")), { w: 100, h: 50 });
  assert.equal(tooManyPixels(declaredSize(text("P7\nWIDTH 90000\nHEIGHT 90000\nENDHDR\n"))), true);
  assert.equal(declaredSize(text("P6\n640")), null);                                         // 높이 없음
  assert.equal(declaredSize(text("P9\n1 1\n")), null); assert.equal(declaredSize(text("P6x1 1\n")), null);
  assert.equal(declaredSize(text("P7\nWIDTH 100\nENDHDR\n")), null);
});

test("kinds(M12): declaredSize — SVG(width·height px/무단위 · viewBox · % · 없음)", () => {
  const svg = a => text(`<?xml version="1.0"?>\n<!-- <svg width="1" height="1"> -->\n<svg xmlns="http://www.w3.org/2000/svg" ${a}><rect width="5" height="5"/></svg>`);
  assert.deepEqual(declaredSize(svg('width="120" height="80"')), { w: 120, h: 80 });
  assert.deepEqual(declaredSize(svg('width="120px" height=\'80.5px\'')), { w: 120, h: 80.5 });
  assert.deepEqual(declaredSize(svg('stroke-width="9" viewBox="0 0 300 200"')), { w: 300, h: 200 });   // stroke-width 는 width 가 아니다
  assert.deepEqual(declaredSize(svg('width="100%" height="100%" viewBox="0 0 64 32"')), { w: 64, h: 32 });
  assert.deepEqual(declaredSize(svg('width="200" viewBox="0 0 100 50"')), { w: 200, h: 50 });        // usvg: 한쪽만 있으면 나머지는 viewBox 의 그 변(비율 계산이 아니다)
  assert.equal(declaredSize(svg('width="100%" height="50%"')), null);                               // viewBox 가 없으면 % 는 모름
  assert.equal(declaredSize(svg('width="10foo" height="10foo"')), null);                              // viewBox 없고 읽을 수 없는 값 → 모름(usvg 는 내용 bbox)
  assert.equal(declaredSize(svg('')), null);                                                          // 아무것도 없음 → 모름
  assert.equal(declaredSize(svg('viewBox="0 0 0 10"')), null);                                        // 쓸 수 없는 viewBox = 없음 → 모름
  assert.equal(tooManyPixels(declaredSize(svg('width="50000" height="50000"'))), true);
  assert.equal(tooManyPixels(declaredSize(svg('viewBox="0 0 1e5 1e5"'))), true);
  assert.equal(tooManyPixels(declaredSize(svg('width="800" height="600"'))), false);
  assert.equal(declaredSize(text("<html><body>not svg</body></html>")), null);
});

test("kinds: SVG 루트 태그 16 KB 상한 — 넘으면 크기 모름(null), 아래면 정상", () => {
  const svg = a => text(`<svg xmlns="http://www.w3.org/2000/svg" ${a}><rect/></svg>`);
  assert.equal(declaredSize(svg('x="y" '.repeat(9000) + 'width="20" height="10"')), null);               // ≈54 KB
  assert.deepEqual(declaredSize(svg('x="y" '.repeat(1700) + 'width="20" height="10"')), { w: 20, h: 10 });   // ≈10 KB
});

test("kinds(E2): SVG 단위 → px 환산 · 20000mm 는 높이와 함께 재서 100 MP 초과로 거절", () => {
  const svg = a => text(`<svg xmlns="http://www.w3.org/2000/svg" ${a}/>`);
  const near = (r, w, h) => { assert.ok(r, "크기를 못 읽음"); assert.ok(Math.abs(r.w - w) < 1e-6 && Math.abs(r.h - h) < 1e-6, JSON.stringify(r)); };
  near(declaredSize(svg('width="20000mm" height="20000mm"')), 20000 * 96 / 25.4, 20000 * 96 / 25.4);
  assert.equal(tooManyPixels(declaredSize(svg('width="20000mm" height="20000mm"'))), true);               // 7.5 만 px 각 → 5.7 GP
  assert.equal(tooManyPixels(declaredSize(svg('width="200mm" height="100mm"'))), false);
  near(declaredSize(svg('width="30pt" height="60pt"')), 40, 80);
  near(declaredSize(svg('width="2pc" height="1pc"')), 32, 16);
  near(declaredSize(svg('width="1in" height="2in"')), 96, 192);
  near(declaredSize(svg('width="2.54cm" height="5.08cm"')), 96, 192);
  assert.equal(declaredSize(svg('width="2em" height="1.5em"')), null); assert.equal(declaredSize(svg('width="2ex" height="3"')), null);   // em/ex = 모름
  assert.equal(declaredSize(svg('width="2em" height="3" viewBox="0 0 8 8"')), null);
  near(declaredSize(svg('width="10" height=".5e2px"')), 10, 50);
  near(declaredSize(svg('width="100%" height="50%" viewBox="0 0 640 480"')), 640, 240);                   // % → viewBox 의 비율
  assert.deepEqual(declaredSize(svg('width="10furlong" height="5furlong" viewBox="0 0 8 4"')), { w: 8, h: 4 });   // 모르는 단위 → 100% = viewBox
  assert.equal(declaredSize(svg('width="100%" height="50%"')), null);                                       // viewBox 도 없음 → 모름
  assert.equal(tooManyPixels(declaredSize(svg('width="1e300" height="1e300"'))), true);                    // 지수 폭주도 «크다»
  assert.equal(tooManyPixels(declaredSize(svg('width="1234567890123" height="5"'))), true);                 // 자릿수 상한 없음 — 아주 큰 값은 «크다»
  assert.equal(declaredSize(text('<svg:svg width="9" height="7"/>')) && declaredSize(text('<svg:svg width="9" height="7"/>')).w, 9);
  assert.equal(declaredSize(text('<svgx width="9" height="7"/>')), null);                                  // 이름이 svg 가 아님
});

// E2: 64 KB 안의 병적 입력은 모두 선형 시간 — 각 50 ms 미만(옛 정규식: 16 s · 0.4 s · 1.2 s)
test("kinds(E2): 병적 입력 64 KB 는 각각 50 ms 미만", () => {
  const cap = s => text(s.slice(0, 64 * 1024));
  const cases = {
    "svg width 숫자 6만 자리(검수 1)": '<svg width="' + "1".repeat(60000) + 'x" height="1">',
    "닫히지 않은 <!-- 6천 개(검수 2)": "<!--".repeat(6000),
    "<svg  1만 3천 번 반복(검수 3)": "<svg ".repeat(13000),
    "<!-- 1만 6천 개": "<!--".repeat(16384),
    "열린 따옴표": '<svg "' + "a".repeat(65000),
    "속성 3만 개": "<svg" + " x".repeat(32000) + ">",
    "속성 값 따옴표 반복": "<svg " + 'a="'.repeat(20000),
    "= 반복": "<svg " + "=".repeat(60000) + ">",
    "viewBox 긴 값": '<svg viewBox="' + "1 ".repeat(30000) + '">',
    "viewBox 쉼표·공백": '<svg viewBox="' + " ,".repeat(30000) + '">',
    "주석 닫힘 -- 반복": "<!--" + "--".repeat(30000),
    "<? 반복": "<?".repeat(30000),
    "<svg:svg 반복": "<svg:svg ".repeat(7000),
    "<!DOCTYPE 반복": "<!DOCTYPE ".repeat(6000),
    "<!DOCTYPE 긴 안쪽": "<!DOCTYPE " + "x".repeat(60000),
    "< 만": "<".repeat(65000),
    "PAM 공백 줄": "P7\nWIDTH" + " ".repeat(65000) + "x\n",
    "PAM 숫자 뒤 공백": "P7\nWIDTH 12" + " ".repeat(65000) + "x\n",
    "PAM 짧은 줄 수만": "P7\n" + "W\n".repeat(30000),
    "PNM 주석 반복": "P6\n" + "#\n".repeat(30000),
    "PNM 공백": "P6 " + " ".repeat(65000),
    "PNM 앞 0 6만 자리": "P6 " + "0".repeat(65000),
    "PAM 주석 줄 3만 개": "P7\n" + "#\n".repeat(30000),
    "svg width 앞 공백 6만": '<svg width="' + " ".repeat(60000) + '1" height="1">',
    "svg width 지수 반복": '<svg width="' + "1e".repeat(30000) + '">',
    "svg width 점 반복": '<svg width="' + "1.".repeat(30000) + '">',
    "svg viewBox 숫자 6만 자리": '<svg viewBox="0 0 ' + "1".repeat(60000) + ' 1">',
    "svg viewBox 부호 반복": '<svg viewBox="' + "+-".repeat(30000) + '">',
    "svg 문자 참조 반복": '<svg viewBox="' + "&#50;".repeat(12000) + '">',
    "svg 문자 참조 깨짐": '<svg viewBox="' + "&#".repeat(30000) + '">',
  };
  for (const [k, s] of Object.entries(cases)) {
    const b = cap(s), t0 = performance.now();
    assert.doesNotThrow(() => declaredSize(b), k);
    const dt = performance.now() - t0;
    assert.ok(dt < 50, `${k}: ${dt.toFixed(1)} ms`);
  }
  // 배율 점검: 입력을 두 배로 늘려도 시간이 두 배 안팎(제곱이 아니다) — 가장 나빴던 두 꼴.
  const time = s => { const b = text(s), t0 = performance.now(); declaredSize(b); return performance.now() - t0; };
  for (const mk of [n => '<svg width="' + "1".repeat(n) + 'x" height="1">', n => "<!--".repeat(n / 4)]) {
    time(mk(1000));                                      // 예열
    const a = Math.max(time(mk(30000)), 0.05), c = time(mk(60000));
    assert.ok(c < a * 8 + 5, `비선형 의심: ${a.toFixed(2)} → ${c.toFixed(2)} ms`);
  }
});

test("kinds(M12): declaredSize — 방어: 잘림 · 쓰레기 · 64 KB 상한 · 던지지 않음 · 알려진 형식은 imageSize 와 같다", () => {
  for (const b of [null, undefined, new Uint8Array(0), new Uint8Array(5), new Uint8Array(100), Uint8Array.from({ length: 1000 }, (_, i) => (i * 37) & 255), text("<svg"), text("<svg width='")])
    assert.doesNotThrow(() => declaredSize(b));
  assert.equal(declaredSize(Uint8Array.from({ length: 1000 }, (_, i) => (i * 37) & 255)), null);
  const pad = "x".repeat(70 * 1024);
  assert.equal(declaredSize(text(`<?xml?><!--${pad}--><svg width="9" height="9"></svg>`)), null);      // 64 KB 안에서 루트를 못 찾으면 모름
  assert.equal(declaredSize(text(`P6\n${"#".repeat(70 * 1024)}\n1 1\n`)), null);
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...u32(300, false), ...u32(200, false), 8, 6, 0, 0, 0]);
  assert.deepEqual(declaredSize(png), imageSize(png));
  assert.deepEqual(declaredSize(png), { w: 300, h: 200 });
});

// G2: SVG 크기 = usvg 0.46 / svgtypes 0.16 이 실제로 내는 값(scratchpad rv9 usvgprobe 실측)과 같다. 값 꼴이 거절되면 100%(viewBox 쪽 길이).
test("kinds(G2): SVG 크기는 usvg 규칙 — 길이 문법 · 한쪽 없음 · viewBox 읽기", () => {
  const svg = a => text(`<svg xmlns="http://www.w3.org/2000/svg" ${a}/>`);
  const got = a => { const d = declaredSize(svg(a)); return d ? `${d.w}x${d.h}` : null; };
  const V = 'viewBox="0 0 20000 20000"';
  // [속성, usvg 가 낸 크기]
  const table = [
    [`width="1 " height="1 " ${V}`, "20000x20000"],          // 뒤 공백 거절
    [`width=" 1" height=" 1" ${V}`, "1x1"],                  // 앞 공백은 허용
    [`width="1 px" height="1 px" ${V}`, "20000x20000"],      // 사이 공백 거절
    [`width="1PX" height="1PX" ${V}`, "20000x20000"],        // 대문자 거절
    [`width="1rem" height="1rem" ${V}`, "20000x20000"],
    [`width="1q" height="1q" ${V}`, "20000x20000"],
    [`width="1vw" height="1vw" ${V}`, "20000x20000"],
    [`width="auto" height="auto" ${V}`, "20000x20000"], [`width="" height="" ${V}`, "20000x20000"], [`width="abc" height="abc" ${V}`, "20000x20000"],
    ['width="30000px" height="30000px"', "30000x30000"], ['width="30000pt" height="30000pt"', "40000x40000"], ['width="1000pc" height="1000pc"', "16000x16000"],
    ['width="1000in" height="1000in"', "96000x96000"], ['width="1000em" height="1000em"', null], ['width="1000ex" height="1000ex"', null],
    [`width="50%" height="50%" ${V}`, "10000x10000"], ['width="50%" height="50%"', null],
    ['width="1e4" height="1E4"', "10000x10000"], ['width="+100" height="+100"', "100x100"], ['width=".5e4" height="1.e4"', "5000x10000"],
    ['width="5000" viewBox="0 0 20000 10000"', "5000x10000"],       // 한쪽 없음 → viewBox 의 그 변
    ['height="5000" viewBox="0 0 20000 10000"', "20000x5000"],
    ['height="20000" viewBox="0 0 20000 1000000000"', "20000x20000"],
    ['width="10%" viewBox="0 0 20000 10000"', "2000x10000"],
    ['width="5000"', null], ['height="5000"', null], ['', null],      // viewBox 도 없음 → 모름
    ['viewBox="0 0 20000 10000"', "20000x10000"],
    ['viewBox="0 0 20000 20000 9"', "20000x20000"],          // 4 번째 뒤 찌꺼기 무시
    ['viewBox="0 0 20000 20000x"', "20000x20000"],
    ['viewBox="0 0 20000"', null], ['viewBox="0 0 20000x 20000"', null],   // 숫자 부족 · 중간 찌꺼기 → viewBox 없음 → 모름
    ['viewBox="0,0,20000,10000"', "20000x10000"], ['viewBox="0 , 0 ,20000, 10000"', "20000x10000"], ['viewBox="  0 0 20000 10000  "', "20000x10000"],
    ['viewBox="0 0 2e4 1e4"', "20000x10000"], ['viewBox="0 0 +20000 +10000"', "20000x10000"],
    ['viewBox="0 0 -20000 10000"', null], ['viewBox="0 0 0 10000"', null], ['viewBox="0 0 NaN 10000"', null],
    ['viewBox="0 0 20000% 10000"', null], ['viewBox="a b c d"', null], ['viewBox="0 0 1e999 10000"', null],
    [`viewBox="0${" ".repeat(130)}0 20000 20000"`, "20000x20000"],   // 128 자 제한 없음
    ['viewBox="0 0 &#50;0000 &#50;0000"', "20000x20000"],            // XML 문자 참조
    ['width="3000" height="4000" viewBox="0 0 1 1"', "3000x4000"],
  ];
  for (const [a, want] of table) assert.equal(got(a), want, a);
  // usvg 가 «그릴 수 없다» 고 한 것 → 모름(null)
  for (const a of ['width="-5" height="-5"', 'width="0" height="0"', 'width="-5%" height="5"']) assert.equal(got(a), null, a);
  // 폭탄: 읽히는 값만 센다
  const big = a => assert.equal(tooManyPixels(declaredSize(svg(a))), true, a);
  big('width="0000000100000" height="100000"'); big('width="100000.0000001" height="100000.0000001"'); big('width="1e0005" height="1e5"');
  big('width="1000000000" height="1000000000"'); big('width="+100000" height="+100000"');
  big(`width="${"0".repeat(5000)}100000" height="100000"`);             // 앞 0 이 아주 길어도 값은 10 만
  big('width="1e999" height="1"');                                       // 무한대로 넘침 → 보수적으로 «크다»(usvg 는 100%)
  assert.equal(declaredSize(svg('width="2000000"')), null);              // 한쪽만 + viewBox 없음 → 모름
  big('width="100%" height="100000" viewBox="0 0 100000 5"');            // % 는 viewBox 폭 기준
  big('width="1PX" height="1PX" viewBox="0 0 20000 20000"');             // 거절된 값 → viewBox 20000² = 4 억 px
  big('height="20000" viewBox="0 0 20000 1000000000"');                  // 한쪽 없음 → viewBox 폭 20000 × 20000
  assert.equal(tooManyPixels(declaredSize(svg('width="1000000" height="1"'))), false);
  // DOCTYPE · 접두 루트 · svgz 는 크기를 모른다(null) — 거절하지 않는다(Illustrator · Inkscape 파일에 DOCTYPE)
  assert.equal(declaredSize(text(`<!DOCTYPE svg [<!ENTITY a "<svg width='1' height='1'>">]><svg viewBox="0 0 20000 20000"/>`)), null);   // 내부 부분집합 → 모름
  assert.deepEqual(declaredSize(text('<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg width="10" height="20"/>')), { w: 10, h: 20 });   // 평범한 DOCTYPE 은 그대로 읽는다
  assert.deepEqual(declaredSize(text('<x:svg xmlns:x="http://www.w3.org/2000/svg" viewBox="0 0 20000 20000"/>')), { w: 20000, h: 20000 });   // 루트의 접두사는 무엇이든 받는다
  assert.equal(declaredSize(Uint8Array.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3, 1, 2, 3, 4])), null);
  // PNM: 앞 0 이 긴 자릿수는 0 을 뗀 값으로 · PAM 은 주석 줄이 200 개를 넘어도 64 KB 안에서 읽는다
  assert.deepEqual(declaredSize(text("P6\n000000000000022000 000000000000000010\n255\n")), { w: 22000, h: 10 });
  assert.deepEqual(declaredSize(text("P5 0000000000000000000000000000000000000000012 00034 255\n")), { w: 12, h: 34 });
  assert.equal(tooManyPixels(declaredSize(text("P6\n000000000000090000 000000000000090000\n255\n"))), true);
  assert.equal(tooManyPixels(declaredSize(text("P6\n1234567890123456789 1\n255\n"))), true);       // 유효 자릿수 15 초과 → 크다
  assert.deepEqual(declaredSize(text("P7\n" + "# c\n".repeat(500) + "WIDTH 7\nHEIGHT 9\nENDHDR\n")), { w: 7, h: 9 });
  // PAM: 80자 넘는 WIDTH · HEIGHT 줄 · 숫자 아닌 값 · 11자리 이상 → 크다
  const pam = l => text(`P7\n${l}\nENDHDR\n`);
  for (const l of [`WIDTH ${"0".repeat(100)}1\nHEIGHT 100000`, `WIDTH 100000\nHEIGHT${" ".repeat(90)}5`, "WIDTH 123456789012345\nHEIGHT 9", "WIDTH abc\nHEIGHT 100000", "WIDTH 100000\nHEIGHT 0x10"])
    assert.equal(tooManyPixels(declaredSize(pam(l))), true, l);
  assert.deepEqual(declaredSize(pam("WIDTH 7\nHEIGHT 9")), { w: 7, h: 9 });
});

// G1: herdr 실행 환경(QuickJS)에는 TextDecoder 가 없다 — 없어도 크기 읽기가 던지지 않고 폭탄을 거른다.
test("kinds(G1): globalThis.TextDecoder 를 지워도 SVG · PAM 크기 읽기가 그대로 동작", () => {
  const svgBig = text('<svg width="20000mm" height="20000mm"/>'), pamBig = text("P7\nWIDTH 100000\nHEIGHT 100000\nENDHDR\n"), svgOk = text('<svg width="120" height="80"/>');
  const TD = globalThis.TextDecoder;
  delete globalThis.TextDecoder;
  try {
    assert.equal(typeof globalThis.TextDecoder, "undefined");
    assert.equal(tooManyPixels(declaredSize(svgBig)), true);
    assert.equal(tooManyPixels(declaredSize(pamBig)), true);
    assert.deepEqual(declaredSize(svgOk), { w: 120, h: 80 });
    assert.deepEqual(declaredSize(text("P7\nWIDTH 7\nHEIGHT 9\nENDHDR\n")), { w: 7, h: 9 });
    const huge = text('<svg width="5" height="5">' + "x".repeat(70000));                  // 4096 조각 경계를 넘는 입력
    assert.deepEqual(declaredSize(huge), { w: 5, h: 5 });
  } finally { globalThis.TextDecoder = TD; }
});

// G9: Linux 실행기 mime · desktop id 확장(Java · MSI · 바로가기).
test("kinds(G9): Linux 실행기 — java archive · msi · ms 바로가기 · openjdk · java desktop", () => {
  for (const m of ["application/x-java-archive", "application/x-msi", "application/x-ms-installer", "application/x-ms-shortcut", "application/x-msdownload"]) assert.equal(isRunnerMime(m), true, m);
  for (const d of ["openjdk-17-java.desktop", "openjdk-21.desktop", "java-17-openjdk.desktop", "org.example.javaws.desktop", "jarfile-java.desktop"]) assert.equal(isRunnerDesktop(d), true, d);
  assert.equal(isRunnerDesktop("org.gnome.TextEditor.desktop"), false);
  assert.equal(linuxHandlerVerdict({ code: 0, stdout: "application/x-java-archive\n" }, { code: 0, stdout: "x.desktop\n" }).why, "runner");
  assert.equal(linuxHandlerVerdict({ code: 0, stdout: "text/plain\n" }, { code: 0, stdout: "openjdk-17-java.desktop\n" }).why, "runner");
});

// ── fail-closed: 확실하지 않으면 null → 미리보기 거절 ─────────────────────
const pngOf = (w, h) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...u32(w, false), ...u32(h, false), 8, 6, 0, 0, 0]);

test("kinds(fail-closed): pictureCheck — 합친 값(imageSize ?? declaredSize)으로 잰다 · 모르면 unknown", () => {
  const ok = b => { const r = pictureCheck(b); assert.equal(r.unknown, false); assert.equal(r.bomb, null); return r; };
  assert.deepEqual(ok(pngOf(300, 200)).size, { w: 300, h: 200 });
  assert.equal(ok(text('<svg width="120" height="80"/>')).size, null);          // media.size 는 imageSize 만 — SVG 는 null 이어도 거절하지 않는다
  ok(tiff(640, 480)); ok(ico([16, 16])); ok(text("P6\n2 2\n255\n")); ok(text("P7\nWIDTH 2\nHEIGHT 2\nENDHDR\n"));
  assert.deepEqual(pictureCheck(pngOf(70000, 80000)).bomb, { w: 70000, h: 80000 });
  assert.deepEqual(pictureCheck(text('<svg width="70000" height="80000"/>')).bomb, { w: 70000, h: 80000 });
  for (const b of [null, undefined, new Uint8Array(0), new Uint8Array(100), text("hello world, not a picture"), pngOf(0, 5), text("<svg/>"), text('<svg width="5"/>')])
    assert.equal(pictureCheck(b).unknown, true, String(b && b.length));
});

test("kinds(fail-closed): SVG — 첫 요소가 루트 · DOCTYPE · viewBox 없는 %/없음 · em/ex · 접두 속성 · & 잔여", () => {
  const S = s => declaredSize(text(s));
  assert.equal(S('<x:svg xmlns:x="u"><svg width="1" height="1"/></x:svg>'), null);                       // 접두 루트의 local 이 svg 이면 그것이 루트 — 아래
  assert.equal(S('<x:g width="9" height="9"/><svg width="1" height="1"/>'), null);                        // 첫 요소가 svg 가 아니다 → 뒤의 svg 를 찾지 않는다
  assert.equal(S('<html><svg width="1" height="1"/></html>'), null);
  assert.deepEqual(S('<?xml version="1.0"?><!-- c --><?pi x?><foo:svg width="3" height="4"/>'), { w: 3, h: 4 });   // 접두사는 무엇이든
  assert.equal(S('<svg:svg:svg width="3" height="4"/>'), null);
  assert.equal(S('</svg><svg width="3" height="4"/>'), null);
  // DOCTYPE: 따옴표 안의 `>` 는 끝이 아니고 · `[` 는 null
  assert.deepEqual(S('<!DOCTYPE svg PUBLIC "-//a>b//" "x>y"><svg width="3" height="4"/>'), { w: 3, h: 4 });
  assert.equal(S('<!DOCTYPE svg PUBLIC "a>[b" "c"><svg width="3" height="4"/>'), null);                  // 따옴표 안이어도 `[`
  assert.equal(S('<!DOCTYPE svg [ <!ENTITY w "99999"> ]><svg width="&w;" height="1"/>'), null);
  assert.equal(S('<!DOCTYPE svg SYSTEM "a>b'), null);                                                    // 안 닫힘
  assert.equal(S('<!doctype svg><svg width="3" height="4"/>'), null);
  // viewBox 없음 + width/height 없음/% → null · viewBox 있으면 읽는다
  for (const a of ['', 'width="5"', 'height="5"', 'width="50%" height="5"', 'width="5" height="50%"', 'width="auto" height="5"']) assert.equal(S(`<svg ${a}/>`), null, a);
  assert.deepEqual(S('<svg width="5" viewBox="0 0 10 20"/>'), { w: 5, h: 20 });
  // em / ex 는 viewBox 가 있어도 모름
  for (const a of ['width="2em" height="2" viewBox="0 0 5 5"', 'width="2" height="2ex" viewBox="0 0 5 5"', 'width="1em" height="1em" font-size="9"', 'width="1em" height="1em" style="font-size:9px"', 'width="1em" height="1em"'])
    assert.equal(S(`<svg ${a}/>`), null, a);
  // 접두사 붙은 width/height/viewBox/font-size/style · 중복 → null
  for (const a of ['width="5" height="5" foo:width="9"', 'xlink:viewBox="0 0 9 9" width="5" height="5"', 'width="5" height="5" x:style="a"', 'width="5" height="5" x:font-size="1"', 'width="5" width="6" height="5"', 'viewBox="0 0 5 5" viewBox="0 0 9 9"'])
    assert.equal(S(`<svg xmlns:foo="u" ${a}/>`), null, a);
  assert.deepEqual(S('<svg xmlns:foo="u" foo:bar="1" stroke-width="3" width="5" height="6"/>'), { w: 5, h: 6 });   // 다른 이름은 무관
  // 문자 참조: 풀면 읽는다 · 풀 수 없으면(& 잔여) null — 자릿수 제한 없음
  assert.deepEqual(S('<svg width="&#x35;" height="&#0000000054;"/>'), { w: 5, h: 6 });
  for (const a of ['width="&#99999999;" height="5"', 'width="&#xFFFFFFFFFFFFFFFF;" height="5"', 'width="&foo;" height="5"', 'width="5&amp;" height="5"', 'width="5" height="&#0;"', 'width="5" height="5" viewBox="&#xD800; 0 5 5"'])
    assert.equal(S(`<svg ${a}/>`), null, a);
  assert.equal(S('<svg width="5" height="5" viewBox="0 0 &#' + "9".repeat(5000) + '; 5"/>'), null);
});

test("kinds(fail-closed): ICO — 0 바이트 · PNG 서명 항목은 안쪽 IHDR 을 읽고 · 범위 밖이면 null", () => {
  const entry = (w, h, off) => [w, h, 0, 0, 1, 0, 32, 0, 0, 0, 0, 0, ...u32(off, true)];
  const mk = (entries, tail) => Uint8Array.from([0, 0, 1, 0, ...u16(entries.length, true), ...entries.flat(), ...tail]);
  // 디렉터리는 단 1칸(22 바이트) → 자료는 22 부터
  assert.deepEqual(declaredSize(mk([entry(0, 0, 22)], [...pngOf(30000, 40000)])), { w: 30000, h: 40000 });          // 0 바이트 + PNG
  assert.deepEqual(declaredSize(mk([entry(1, 1, 22)], [...pngOf(30000, 40000)])), { w: 30000, h: 40000 });          // 칸은 1×1 이라 해도 PNG 가 말한다
  assert.equal(tooManyPixels(declaredSize(mk([entry(1, 1, 22)], [...pngOf(30000, 40000)]))), true);
  assert.deepEqual(declaredSize(mk([entry(16, 16, 22)], [...pngOf(8, 8)])), { w: 8, h: 8 });
  assert.equal(declaredSize(mk([entry(0, 0, 22)], [0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0])), null);           // PNG 서명 뒤 IHDR 잘림
  assert.equal(declaredSize(mk([entry(16, 16, 9999)], new Array(40).fill(0))), null);                                // 오프셋이 범위 밖
  assert.equal(declaredSize(mk([entry(0, 0, 9999)], new Array(40).fill(0))), null);
  assert.equal(declaredSize(mk([entry(16, 16, 22)], [0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48])), null);   // 서명은 있는데 24 바이트 못 채움
  // 가장 큰 것: 작은 PNG + 큰 PNG
  const two = Uint8Array.from([0, 0, 1, 0, 2, 0, ...entry(1, 1, 38), ...entry(1, 1, 38 + 29), ...pngOf(8, 8), ...pngOf(20000, 20000)]);
  assert.deepEqual(declaredSize(two), { w: 20000, h: 20000 });
  // 0 바이트 + DIB(BITMAPINFOHEADER): 헤더의 값도 본다
  const dib = Uint8Array.from([0, 0, 1, 0, 1, 0, ...entry(0, 0, 22), ...u32(40, true), ...u32(30000, true), ...u32(80000, true), 0, 0, 0, 0]);
  assert.deepEqual(declaredSize(dib), { w: 30000, h: 40000 });
  assert.equal(declaredSize(ico([16, 16]).subarray(0, 20)), null);                                                   // 디렉터리 칸이 잘림
});

test("kinds(fail-closed): TIFF/BigTIFF — 항목 512 초과 · 중복 태그 · 형식 · 잘림은 null", () => {
  assert.deepEqual(declaredSize(tiff(7, 9, { extra: Array.from({ length: 100 }, (_, i) => [300 + i, 1]) })), { w: 7, h: 9 });
  assert.equal(declaredSize(tiff(7, 9, { extra: Array.from({ length: 511 }, (_, i) => [300 + i, 1]) })), null);   // 511 + 2 = 513 항목
  // 중복
  const dupT = tiff(7, 9, { extra: [[256, 99999]] }); assert.equal(declaredSize(dupT), null);                    // 256 이 두 번
  const dupH = tiff(7, 9, { extra: [[257, 5]] }); assert.equal(declaredSize(dupH), null);
  // 형식: RATIONAL(5) · BYTE(1) 너비 → null
  for (const type of [1, 5, 16]) { const t = tiff(7, 9); t[8 + 2 + 2] = type; assert.equal(declaredSize(t), null, `type ${type}`); }   // 첫 항목(256) 형식 바꿈
  assert.equal(declaredSize(tiff(7, 9).subarray(0, 20)), null);                                                   // 항목 칸이 잘림
  // BigTIFF
  const bt = (w, h, extra = []) => { const b = bigTiff(w, h); return b; };
  assert.deepEqual(declaredSize(bt(7, 9)), { w: 7, h: 9 });
  const bigDup = Uint8Array.from([0x49, 0x49, 43, 0, 8, 0, 0, 0, ...u32(16, true), 0, 0, 0, 0, ...u32(3, true), 0, 0, 0, 0,
    ...[[256, 7], [256, 8], [257, 9]].flatMap(([tag, v]) => [...u16(tag, true), ...u16(16, true), ...u32(1, true), 0, 0, 0, 0, ...u32(v, true), 0, 0, 0, 0]), 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(declaredSize(bigDup), null);
  const badType = bigTiff(7, 9); badType[16 + 8 + 2] = 5; assert.equal(declaredSize(badType), null);                // 너비 형식 RATIONAL
  const many = bigTiff(7, 9); many[16] = 0x01; many[17] = 0x02; assert.equal(declaredSize(many), null);            // 항목 수 513 이상 선언
});

test("kinds(fail-closed): PNM — 매직 뒤 공백 · 주석 접촉 · 토큰 부족 · 경계는 null", () => {
  assert.deepEqual(declaredSize(text("P6 2 3 255\n")), { w: 2, h: 3 });
  assert.deepEqual(declaredSize(text("P4\n# c\n8 8\n")), { w: 8, h: 8 });
  assert.deepEqual(declaredSize(text("P1\r\n# c\r\n3 3\r\n0")), { w: 3, h: 3 });
  const nulls = {
    "매직에 붙은 숫자": "P411000\n", "매직에 붙은 주석": "P6#c\n2 2 255\n", "매직 뒤 공백 없음 P4": "P42 2\n",
    "숫자에 붙은 주석 시작": "P6 12#c\n3 255\n", "주석이 숫자 뒤 시작(높이)": "P6 2 3#c\n255\n",
    "CR 로만 끝나는 주석": "P6 2 #c\r3 255\n", "안 닫히는 주석": "P6 2 #c",
    "maxval 없음": "P6 2 3", "maxval 없음 개행": "P6 2 3\n", "높이 없음": "P6 2\n", "P4 높이 없음": "P4 2",
    "마지막 토큰이 경계": "P4 2 3", "마지막 토큰 뒤 쓰레기": "P4 2 3x\n", "P5 maxval 쓰레기": "P5 2 3 255x\n",
    "PAM ENDHDR 없음": "P7\nWIDTH 2\nHEIGHT 3\n", "스캔 범위 밖 토큰": "P6\n" + " ".repeat(70000) + "2 2 255\n",
  };
  for (const [k, v] of Object.entries(nulls)) assert.equal(declaredSize(text(v)), null, k);
});

// ── 폴더·여러 항목 올리기 ──────────────────────────────────────────────
import { execFileSync } from "node:child_process";
import { readdir as readdirR, lstat } from "node:fs/promises";
import { treePlan, placedDir, batches, dedupeNested, isInside } from "../files-plus/tree.js";
import { LIST, MKTOP } from "../files-plus/transfer.js";

const nul = (...f) => f.join("\0") + "\0";
const IS_ROOT = process.getuid?.() === 0;

test("tree: treePlan — 섞인 목록 · 건너뜀 · emptyDirs leaf · 정렬", () => {
  const out = nul(
    "d", "./b", "f", "./b/z.txt", "f", "./a.txt", "d", "./e", "d", "./e/inner", "d", "./c",
    "f", "./.DS_Store", "f", "./b/._z.txt", "f", "./Icon\r", "l", "./lnk", "o", "./fifo", "f", "./.env",
    "d", "./dotonly", "f", "./dotonly/.DS_Store", "E", "1");
  const p = treePlan(out, { max: 100 });
  assert.deepEqual(p.files.map((x) => x.src), [".env", "a.txt", "b/z.txt"]);
  assert.deepEqual(p.files.find((x) => x.src === "b/z.txt"), { src: "b/z.txt", dir: "b", name: "z.txt" });
  assert.equal(p.skipped, 6);
  assert.equal(p.unreadableRc, 1);
  // b 는 파일이 있다 · e 는 하위 폴더가 있다 → leaf 만: c · dotonly · e/inner
  assert.deepEqual(p.emptyDirs, ["c", "dotonly", "e/inner"]);
  assert.deepEqual(p.dirs, ["b", "c", "dotonly", "e", "e/inner"]);
});

test("tree: treePlan — .. · 빈 조각 skipped · 표지 없음 · 상한", () => {
  const p = treePlan(nul("f", "./../x", "f", "./a//b", "f", "./ok", "E", "0"), {});
  assert.deepEqual(p.files.map((x) => x.src), ["ok"]);
  assert.equal(p.skipped, 2);
  assert.throws(() => treePlan(nul("f", "./a"), {}), /목록이 잘렸다/);
  assert.throws(() => treePlan("f\0./a", {}), /목록이 잘렸다/);
  assert.throws(() => treePlan(nul("f", "./a", "f", "./b", "E", "0"), { max: 1 }), /파일이 너무 많다\(2개 · 상한 1\)/);
  assert.equal(treePlan(nul("f", "./a", "E", "0"), { max: 1 }).files.length, 1);
  assert.deepEqual(treePlan(nul("E", "0")).files, []);
});

test("tree: dedupeNested · isInside · placedDir · batches", () => {
  assert.deepEqual(dedupeNested(["/x/src/", "/x/src/a.txt", "/x/srcb", "/x/src", "/y"]), ["/x/src", "/x/srcb", "/y"]);
  assert.deepEqual(dedupeNested(["/a/b", "/a"]), ["/a"]);
  assert.equal(isInside("/a/b", "/a"), true);
  assert.equal(isInside("/a", "/a"), true);
  assert.equal(isInside("/ab", "/a"), false);
  assert.equal(isInside("/a", "/a/b"), false);
  assert.equal(placedDir("v1.2", 0), "v1.2");
  assert.equal(placedDir("v1.2", 3), "v1.2 (3)");
  assert.deepEqual(batches([]), []);
  assert.deepEqual(batches(["a", "b", "c"], 2), [["a", "b"], ["c"]]);
  assert.deepEqual(batches(["aaaa", "bbbb", "cc"], 200, 10), [["aaaa", "bbbb"], ["cc"]]);   // 5+5=10 → 경계는 포함
  assert.deepEqual(batches(["aaaa", "bbbb", "c"], 200, 10), [["aaaa", "bbbb"], ["c"]]);
  assert.deepEqual(batches(["x".repeat(50), "y"], 200, 10), [["x".repeat(50)], ["y"]]);        // 하나가 상한 넘어도 혼자 간다
  assert.deepEqual(batches(["한", "한"], 200, 7), [["한"], ["한"]]);   // 한글 3바이트+1 = 4 → 둘이면 8 > 7
});

// 시험용 폴더 트리를 만든다. 이름은 바이트 그대로(NFD 한글 포함) 다뤄야 한다.
const NFD = "한글".normalize("NFD") + ".txt";
async function makeTree(root) {
  await mkdir(join(root, "sub", "deep"), { recursive: true });
  await mkdir(join(root, "empty"), { recursive: true });
  await mkdir(join(root, "nest-empty", "x", "y"), { recursive: true });
  await mkdir(join(root, "sp ace", `q'"$x`), { recursive: true });
  await writeFile(join(root, "top.txt"), "top");
  await writeFile(join(root, "zero.bin"), "");
  await writeFile(join(root, "sub", "deep", "d.bin"), randomBytes(CHUNK + 3));
  await writeFile(join(root, "sub", ".env"), "SECRET=1");
  await writeFile(join(root, "sp ace", `q'"$x`, "a b.txt"), "quote");
  await writeFile(join(root, "sp ace", "nl\nname.txt"), "newline");
  await writeFile(join(root, NFD), "nfd");
}
// 폴더 → 정렬된 "d:상대" · "f:상대:sha" 목록.
async function snap(root) {
  const out = [];
  for (const n of await readdirR(root, { recursive: true })) {
    const full = join(root, n), st = await lstat(full);
    out.push(st.isDirectory() ? `d:${n}` : `f:${n}:${sha(await readFile(full))}`);
  }
  return out.sort();
}

test("LIST: 실물 — 중첩 · 빈 폴더 · 이상한 이름 · 링크 · FIFO · 부속 파일 · 읽을 수 없는 폴더", async () => {
  const root = join(base, "list-src"); await makeTree(root);
  await symlink(join(root, "top.txt"), join(root, "flnk"));
  await symlink(root, join(root, "dlnk"));                      // 폴더 링크(고리) — 따라가지 않는다
  await writeFile(join(root, ".DS_Store"), "x"); await writeFile(join(root, "sub", "._d.bin"), "x");
  execFileSync("mkfifo", [join(root, "fifo")]);
  const locked = join(root, "locked"); await mkdir(locked); await writeFile(join(locked, "hidden"), "h");
  if (!IS_ROOT) await chmod(locked, 0o000);
  try {
    const t = makeTransfer(exec, { viaHc: true });
    const plan = await t.tree(root, { max: 100 });
    const want = [NFD, "sp ace/nl\nname.txt", `sp ace/q'"$x/a b.txt`, "sub/.env", "sub/deep/d.bin", "top.txt", "zero.bin", ...(IS_ROOT ? ["locked/hidden"] : [])].sort();
    assert.deepEqual(plan.files.map((f) => f.src), want);
    assert.equal(plan.skipped, 5, "링크 2 · FIFO · .DS_Store · ._d.bin");
    assert.deepEqual(plan.emptyDirs, ["empty", ...(IS_ROOT ? [] : ["locked"]), "nest-empty/x/y"].sort());
    if (!IS_ROOT) { assert.equal(plan.unreadableRc, 1); assert.ok(plan.unreadable >= 1); }
    else { assert.equal(plan.unreadableRc, 0); assert.equal(plan.unreadable, 0); }
    await assert.rejects(t.tree(root, { max: 3 }), /파일이 너무 많다/);
    await assert.rejects(t.tree(join(base, "no-such"), {}), /폴더를 열 수 없다/);
    // 맨 위 항목이 링크면 따라간다.
    const viaLink = join(base, "list-top-link"); await symlink(join(base, "list-src", "sub"), viaLink);
    assert.deepEqual((await t.tree(viaLink, {})).files.map((f) => f.src), [".env", "deep/d.bin"]);
    assert.deepEqual(await t.kinds([root, join(root, "top.txt"), viaLink, join(root, "fifo"), join(base, "nope"), join(root, "flnk")]), ["d", "f", "d", "x", "x", "f"]);
  } finally { if (!IS_ROOT) await chmod(locked, 0o700); }
});

test("MKTOP: 처음 k=0 · 같은 이름 폴더/파일/링크 → 번호 · 동시 4개 · 쓸 수 없는 폴더", async () => {
  const t = makeTransfer(exec, { viaHc: true });
  const d = join(base, "mktop"); await mkdir(d);
  assert.equal(await t.makeTop(null, d, "v1.2"), join(d, "v1.2"));
  assert.equal(await t.makeTop(null, d, "v1.2"), join(d, "v1.2 (1)"));
  await writeFile(join(d, "file"), "x"); await symlink(join(d, "nowhere"), join(d, "lnk"));
  assert.equal(await t.makeTop(null, d, "file"), join(d, "file (1)"));
  assert.equal(await t.makeTop(null, d, "lnk"), join(d, "lnk (1)"));   // 깨진 링크도 «있는 이름»
  const four = await Promise.all([0, 1, 2, 3].map(() => t.makeTop(null, d, "race")));
  assert.equal(new Set(four).size, 4);
  for (const p of four) assert.equal((await stat(p)).isDirectory(), true);
  await assert.rejects(t.makeTop(null, join(d, "nope"), "x"), /폴더가 없다/);
  await assert.rejects(t.makeTop(null, d, "a/b"), /이름이 안전하지 않다/);
  if (!IS_ROOT) {
    const ro = join(base, "mktop-ro"); await mkdir(ro); await chmod(ro, 0o500);
    try { await assert.rejects(t.makeTop(null, ro, "x"), /쓸 수 없는 폴더/); } finally { await chmod(ro, 0o700); }
  }
});

test("폴더 올리기 끝까지: kinds → tree → makeTop → makeDirs → upload(mkdir) — 받은 트리 = 원본", { timeout: 120000 }, async () => {
  const t = makeTransfer(exec, { viaHc: true });
  const src = join(base, "e2e-src"); await makeTree(src);
  await symlink(join(src, "top.txt"), join(src, "flnk")); await writeFile(join(src, ".DS_Store"), "x");
  const dst = join(base, "e2e-dst"); await mkdir(dst);
  const upFolder = async () => {
    assert.deepEqual(await t.kinds([src]), ["d"]);
    const plan = await t.tree(src, { max: 100 });
    const root = await t.makeTop(null, dst, "e2e-src");
    await t.makeDirs(null, root, plan.emptyDirs);
    for (const f of plan.files) {
      const got = await t.upload(null, `${src}/${f.src}`, f.dir ? `${root}/${f.dir}` : root, {}, { mkdir: true });
      assert.equal(got, `${root}/${f.dir ? f.dir + "/" : ""}${f.name}`, "이름 바이트 그대로 · 충돌 없음");
    }
    return root;
  };
  const root = await upFolder();
  assert.equal(root, join(dst, "e2e-src"));
  const want = (await snap(src)).filter((x) => !/flnk|\.DS_Store/.test(x));
  assert.deepEqual(await snap(root), want);
  assert.ok((await snap(root)).includes("d:nest-empty/x/y") && (await snap(root)).includes("d:empty"));
  assert.ok((await readdir(root)).includes(NFD), "NFD 이름 그대로");
  const again = await upFolder();
  assert.equal(again, join(dst, "e2e-src (1)"));
  assert.deepEqual(await snap(again), want);
  for (const r of [root, again]) for (const n of await readdirR(r, { recursive: true })) assert.ok(!n.endsWith(".part"), n);
});

test("upload: mkdir 기본 false — 없는 폴더면 rc 6 «폴더가 없다» · mkdir:true 면 만든다", async () => {
  const t = makeTransfer(exec, { viaHc: true });
  const f = join(base, "mk-one.txt"); await writeFile(f, "one");
  const dir = join(base, "mk-out", "a", "b");
  await assert.rejects(t.upload(null, f, dir, {}), /폴더가 없다/);
  await assert.rejects(t.upload(null, f, dir, {}, {}), /폴더가 없다/);
  assert.equal(await t.upload(null, f, dir, {}, { mkdir: true }), join(dir, "mk-one.txt"));
  assert.equal(await readFile(join(dir, "mk-one.txt"), "utf8"), "one");
});

test("inside: 자기 안 · 자기 · a vs ab · 링크로 돌아 들어온 경우", async () => {
  const t = makeTransfer(exec, { viaHc: true });
  const a = join(base, "in-a"), ab = join(base, "in-ab"); await mkdir(join(a, "child"), { recursive: true }); await mkdir(ab);
  assert.equal(await t.inside(a, a), true);
  assert.equal(await t.inside(join(a, "child"), a), true);
  assert.equal(await t.inside(ab, a), false);
  assert.equal(await t.inside(base, a), false);
  const lnk = join(base, "in-lnk"); await symlink(join(a, "child"), lnk);
  assert.equal(await t.inside(lnk, a), true);
  assert.equal(await t.inside(join(base, "in-missing"), a), false);
});

// ── 검토 반영: 기록 그룹 갈아 끼움 · 겹침 거르기 · 종류 묶음 · 상한 · find 종료 코드 ──
const ent = (i, state, extra = {}) => ({ at: i, jid: `L:${i}`, dir: "up", name: `f${i}`, size: 1, state, where: "", on: "", note: "", ...extra });

test("replaceGroupLines: 그룹 줄은 상태마다 ≤5 · 갈아 끼움 멱등 · 다른 기록 보존 · jids 접힘 · max 상한", () => {
  const other = [ent(900, "ok", { name: "other-a" }), ent(901, "fail", { name: "other-b" })];
  const ok = Array.from({ length: 300 }, (_, i) => ent(i, "ok", { grp: "ignored" })).reverse();     // 최신이 앞
  const fail = [ent(1000, "fail"), ent(1001, "fail")];
  let list = replaceGroupLines(other, "g1", { ok: ok.slice(0, 50), fail: [], cancel: [] });
  const first = list.filter((e) => e.grp === "g1").length;
  assert.ok(first <= 5);
  // 부분 → 최종: 앞 줄은 갈아 끼워지고 쌓이지 않는다
  list = replaceGroupLines(list, "g1", { ok, fail, cancel: [] });
  const mine = list.filter((e) => e.grp === "g1");
  assert.equal(mine.length, 5 + 2, "ok 5줄 + fail 2줄");
  assert.equal(mine.filter((e) => e.state === "ok").at(-1).name, "외 296개");
  assert.equal(mine.filter((e) => e.state === "ok").at(-1).state, "ok");
  assert.equal(mine.find((e) => e.name === "외 296개").jids.length, 150, "접힌 jid 는 150개까지");
  assert.deepEqual(list.slice(-2).map((e) => e.name), ["other-a", "other-b"], "다른 기록 그대로 · 뒤에");
  const again = replaceGroupLines(list, "g1", { ok, fail, cancel: [] });
  assert.deepEqual(again, list, "같은 입력 → 같은 결과(멱등)");
  // 다른 그룹은 따로
  const two = replaceGroupLines(list, "g2", { ok: [ent(5000, "ok")], fail: [], cancel: [] });
  assert.equal(two.filter((e) => e.grp === "g1").length, 7);
  assert.equal(two.filter((e) => e.grp === "g2").length, 1);
  // 5000개 파일 그룹도 줄은 ≤ 15, 전체는 max 이하
  const big = Array.from({ length: 5000 }, (_, i) => ent(i, "ok"));
  const capped = replaceGroupLines(other, "g3", { ok: big, fail: big.slice(0, 10), cancel: big.slice(0, 3) });
  assert.ok(capped.filter((e) => e.grp === "g3").length <= 15);
  assert.equal(replaceGroupLines(Array.from({ length: 300 }, (_, i) => ent(i, "ok", { name: `o${i}` })), "g4", { ok: [ent(1, "ok")], fail: [], cancel: [] }, 200).length, 200);
});

test("dedupeNested: 20000 개 평평한 경로 < 1 초 · 기존 규칙(끝 / · 같은 경로 · a vs ab · 루트)", () => {
  const flat = Array.from({ length: 20000 }, (_, i) => `/tmp/x/dir${i % 50}/file${i}`);
  const t0 = Date.now();
  assert.equal(dedupeNested(flat).length, 20000);
  assert.ok(Date.now() - t0 < 1000, `느리다: ${Date.now() - t0} ms`);
  assert.deepEqual(dedupeNested(["/a/b/", "/a/b/c", "/a/bc", "/a/b", "/a/b/c/d", "/z"]), ["/a/b", "/a/bc", "/z"]);
  assert.deepEqual(dedupeNested(["/a", "/"]), ["/"]);
  assert.deepEqual(dedupeNested([]), []);
});

test("kinds: 인자가 아주 많아도(15000) 묶음으로 나눠 순서대로 이어 붙인다", async () => {
  const t = makeTransfer(exec, { viaHc: true });
  const real = join(base, "kinds-many"); await mkdir(real, { recursive: true });
  const fl = join(real, "a.txt"); await writeFile(fl, "x");
  const long = "/nonexistent-kinds-dir/" + "p".repeat(40);
  const paths = Array.from({ length: 15000 }, (_, i) => `${long}${i}`);
  paths[0] = real; paths[7000] = fl;
  const out = await t.kinds(paths);
  assert.equal(out.length, 15000);
  assert.equal(out[0], "d"); assert.equal(out[7000], "f");
  assert.ok(out.every((k, i) => i === 0 || i === 7000 || k === "x"));
  assert.deepEqual(await t.kinds([]), []);
});

test("treePlan: 하위 폴더 상한(maxDirs) · 파일 상한 코드 · find 종료 코드(1 경고 · 2+ 던짐)", () => {
  const mk = (rc, ds = [], fs = []) => [...ds.map((d) => `d\0./${d}\0`), ...fs.map((f) => `f\0./${f}\0`), `E\0${rc}\0`].join("");
  const dirs = Array.from({ length: 5 }, (_, i) => `d${i}`);
  assert.equal(treePlan(mk(0, dirs), { maxDirs: 5 }).dirs.length, 5);
  assert.throws(() => treePlan(mk(0, dirs), { maxDirs: 4 }), /하위 폴더가 너무 많다\(5개 · 상한 4\)/);
  assert.throws(() => treePlan(mk(0, [], ["a", "b"]), { max: 1 }), (e) => e.code === "TOO_MANY" && /파일이 너무 많다/.test(e.message));
  assert.equal(treePlan(mk(1, [], ["a"])).unreadableRc, 1, "rc 1 = 경고");
  assert.throws(() => treePlan(mk(2, [], ["a"])), /폴더 목록을 끝까지 못 읽었다\(rc 2\)/);
  assert.throws(() => treePlan(mk(137, [], ["a"])), /rc 137/);
});

test("dedupeNested: 빈 값 · 문자열 아님은 버린다 · 슬래시만이면 `/` · `.`/`..` 든 경로는 조상 비교 안 함", () => {
  assert.deepEqual(dedupeNested(["", "/a", null, undefined, 3]), ["/a"]);
  assert.deepEqual(dedupeNested([""]), []);
  assert.deepEqual(dedupeNested(["//", "/a"]), ["/"]);
  assert.deepEqual(dedupeNested(["/a", "/a/../b", "/a/./c"]), ["/a", "/a/../b", "/a/./c"]);
  assert.deepEqual(dedupeNested(["/a/..", "/a/../b"]), ["/a/..", "/a/../b"]);
});

test("treePlan: E 표지의 rc 가 숫자가 아니면 던진다", () => {
  assert.throws(() => treePlan("f\0./a\0E\0\0"), /목록 끝 표지를 못 읽었다/);
  assert.throws(() => treePlan("f\0./a\0E\0x1\0"), /목록 끝 표지를 못 읽었다/);
  assert.throws(() => treePlan("E\0-1\0"), /목록 끝 표지를 못 읽었다/);
  assert.equal(treePlan("E\0 0\0".replace(" ", "")).files.length, 0);
});

test("makeDirs: 취소된 job 은 묶음 사이에서 멈춘다", async () => {
  const t = makeTransfer(exec, { viaHc: true });
  const root = join(base, "mkd-cancel"); await mkdir(root, { recursive: true });
  const dirs = Array.from({ length: 500 }, (_, i) => `c${i}`);
  await assert.rejects(t.makeDirs(null, root, dirs, { cancelled: true }), /취소했다/);
  assert.equal((await readdir(root)).length, 0);
  await t.makeDirs(null, root, dirs, { cancelled: false });
  assert.equal((await readdir(root)).length, 500);
});

// main.js 는 host 모듈(herdr · gpui)을 불러 node 에서 못 연다 → 소스 글자로 확인: 올리기 spec 4곳(fileSpec · 폴더 실패 · 머리 · 파일별)의 dir 은 방향 "up" 이어야 한다.
// (목적지 경로를 `dir,` 약식으로 넣으면 기록에 ↓ 로 찍히던 회귀)
test("main.js: 올리기 spec 의 dir 은 방향 \"up\"", async () => {
  const src = await readFile(new URL("../files-plus/main.js", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("  fileSpec(p, dir"), src.indexOf("return [head, ...plan.files.map"));
  assert.equal((body.match(/^\s*dir, name/gm) ?? []).length, 0, "약식 `dir, name` 금지");
  assert.equal((body.match(/dir: "up", name/g) ?? []).length, 4);
});

// «터미널에 나온 파일» 훑기 글자 확인: await 마다 세대 확인이 있고 · 버림 횟수를 세고 · 멎음 감시는 같은 종류로 다시 부르고 · ok 뒤 same-text 는 안 쓴다.
test("main.js: tfScan 의 await 마다 gen 확인 · 버림 기록 · 감시는 같은 종류 · same-text 건너뜀", async () => {
  const src = await readFile(new URL("../files-plus/main.js", import.meta.url), "utf8");
  const from = src.indexOf("  tfScan(cx, light = false) {"), to = src.indexOf("  // 마지막 훑기 결과를 shared 에 한 줄");
  assert.ok(from > 0 && to > from, "tfScan 본문을 못 찾음");
  const body = src.slice(from, to);
  const lines = body.split("\n");
  const aw = lines.map((l, i) => (/\bawait /.test(l) ? i : -1)).filter((i) => i >= 0);
  assert.ok(aw.length > 0, "await 없음");
  for (const i of aw) assert.ok(/^\s*if \(gen !== this\.tfGen\) return;/.test(lines[i + 1] ?? ""), `await 다음 줄에 gen 확인 없음: ${lines[i].trim().slice(0, 60)}`);
  assert.ok(/phase === "same-text" && this\.tfNotePrev\?\.phase === "ok"/.test(body), "ok 뒤 same-text 건너뜀");
  assert.ok(body.includes("this.tfAbandons++"), "버림 횟수");
  const tick = src.slice(src.indexOf("  tfTick(cx) {"), src.indexOf("  tfSchedule(cx, ms) {"));
  assert.ok(tick.includes('if (this.tfBusy && Date.now() - this.tfBusyAt >= this.tfStuckMs()) this.tfScan(cx, this.tfBusyKind === "light" && !this.tfAgain && !this.tfUrgent);'), "감시: ⟳ · 터미널/폴더 바뀜(tfUrgent)은 고정 30 s, 아니면 백오프 · 종류를 이어 받되 줄 선 전체 요청이 있으면 전체");
  assert.ok(body.includes("light, stuckMs: this.tfStuckMs() })"), "관문도 감시와 같은 기다림(tfStuckMs)");
  assert.ok(src.includes("tfStuckMs() { return this.tfUrgent ? TF_STUCK_MS : stuckAfter(this.tfAbandonRun); }"), "tfStuckMs: 긴급이면 30 s, 아니면 늘어난 기다림");
  assert.ok(tick.includes("const key = termKey(t);"), "틱의 key 는 termKey");
  assert.ok(/if \(who !== this\.tfWho\) \{ this\.tfUrgent = true; this\.tfSet\(\[\], cx\); \}/.test(tick), "터미널·폴더(who) 바뀜에서만 tfUrgent — 상태만 바뀐 건 아님");
  assert.equal((tick.match(/tfUrgent = true/g) ?? []).length, 1, "틱에서 tfUrgent 를 켜는 곳은 who 바뀜 한 곳");
  assert.ok(body.includes("const t = this.tfT, key = termKey(t);"), "스캔은 자기가 읽는 대상의 key(termKey(t))");
  assert.ok(!/key = this\.tfKey/.test(body), "스캔이 this.tfKey 를 캡처하면 안 됨(감시가 틱 안에서 먼저 부르면 앞 대상의 key)");
  assert.ok(body.indexOf("this.tfUrgent = false") > body.indexOf("const gen = ++this.tfGen;"), "스캔이 실제로 시작될 때 tfUrgent 해소");
  const rIcon = src.indexOf("this.tfUrgent = true; this.tfScan(cx);");
  assert.ok(rIcon > 0 && /\.on_click\(\(_e, cx\) => \{ this\.tfUrgent = true; this\.tfScan\(cx\); \}\)/.test(src), "⟳ 핸들러: tfScan 전에 tfUrgent");
  const iSt = body.indexOf('this.tfStage = "spawn"'), iSp = body.indexOf("cx.spawn(");
  assert.ok(iSt > 0 && iSp > iSt, "spawn 전에 tfStage = spawn");
});

// 터미널 더블클릭 열기(dcTick) 글자 확인: 클립보드 글(clip)은 exec 로 가지 않는다 · await 마다 dcGen 확인 · tf* 상태 · 기록 · shared 를 건드리지 않는다.
test("main.js: dcTick — exec 인자는 상수 pbpaste 스크립트와 RESOLVE_SCRIPT+cand+longer(dcLonger 탐침) 뿐 · clip 은 dcPick · dcLonger 에만", async () => {
  const src = await readFile(new URL("../files-plus/main.js", import.meta.url), "utf8");
  const from = src.indexOf("  dcTick(cx) {"), to = src.indexOf("  // 머리줄 아래 칸");
  assert.ok(from > 0 && to > from, "dcTick 본문을 못 찾음");
  const body = src.slice(from, to), lines = body.split("\n");
  const code = lines.filter(l => !/^\s*\/\//.test(l));
  const execs = code.filter(l => /\bexec\(/.test(l)).map(l => l.trim());
  assert.equal(execs.length, 2, "exec 호출은 둘뿐");
  assert.ok(execs[0].includes('await exec("/bin/sh", ["-c", "LC_ALL=en_US.UTF-8 /usr/bin/pbpaste | /usr/bin/head -c 4097"], { timeout: 2000 })'), "첫 exec = 상수 pbpaste 스크립트(인자 없음 · 로컬)");
  assert.ok(execs[1].includes('await exec("sh", ["-c", RESOLVE_SCRIPT, NAME, cwd, cand, ...longer], { on, timeout: 10000 })'), "둘째 exec = RESOLVE_SCRIPT + cwd + cand + longer(터미널 글자에서 나온 탐침)");
  assert.ok(code.some(l => l.trim() === "const longer = dcLonger({ clip, sel, text: oldText, cand, bd });"), "longer 는 dcLonger 에서만(clip 은 거기까지만)");
  assert.ok(code.some(l => l.includes("const path = dcChoose(e.stdout, cand, longer);")), "결과는 dcChoose 를 거친다");
  assert.ok(!code.some(l => /mergeResolved|found\.length/.test(l)), "mergeResolved · found.length 판정은 dcChoose 로 대체됨");
  for (const l of execs) assert.ok(!/\bclip\b/.test(l), `exec 줄에 clip 금지: ${l.slice(0, 60)}`);
  const uses = code.filter(l => /\bclip\b/.test(l)).map(l => l.trim());
  assert.ok(uses.every(l => l.startsWith("const clip = ") || l.startsWith("if (typeof clip") || l.includes("dcBind({ sel, cols, rows, text: full, clip, total, cut })") || l.includes("dcPick({ clip, sel, cols, text: oldText, bd })") || l.includes("dcLonger({ clip, sel, text: oldText, cand, bd })") || l.includes("if (!dcClipShape({ clip, sel, cols })) return;")), `clip 사용처가 정해진 여섯 밖: ${uses.join(" | ")}`);
  assert.ok(uses.some(l => l.includes("dcPick({ clip, sel, cols, text: oldText, bd })")), "clip 은 dcPick 으로");
  // 깊게 읽기 전 클립보드 모양 검사(참/거짓만): 길이 검사 뒤 · total 읽기 앞 · hc read 앞
  const iShape = body.indexOf("if (!dcClipShape({ clip, sel, cols })) return;"), iLen = body.indexOf("clip.length > 4096"), iTb0 = body.indexOf("const tb = dcTotal(addr);"), iHc = body.indexOf("hcLimited(");
  assert.ok(iLen > 0 && iShape > iLen && iShape < iTb0 && iShape < iHc, "dcClipShape 는 pbpaste 길이 검사 뒤 · dcTotal · hc read 앞");
  assert.equal((code.join("\n").match(/dcClipShape\(/g) ?? []).length, 1, "dcClipShape 호출은 한 곳(주석 제외)");
  // 묶기(dcBind): total 은 읽기 앞 · 뒤가 같을 때만 · how 가 history 가 아니면(stitched · 모르는 값) 묶지 않는다 · 깊이 · 글 상한 · 묶이지 않는 글은 032f193 이 보던 것
  const iTb = body.indexOf("const tb = dcTotal(addr);"), iRead = body.indexOf("await hcLimited("), iTot = body.indexOf("tb === dcTotal(addr)");
  assert.ok(iTb > 0 && iRead > iTb && iTot > iRead, "total 은 읽기 앞에서 한 번 · 뒤에서 한 번");
  assert.ok(body.includes("const binds = canSleep && total !== null && rd?.how === \"history\";") && body.includes("const bd = binds ? dcBind({"), "묶기는 binds 일 때만(how 가 history 가 아니면 · total 을 모르면 · cx.sleep 이 없으면 묶지 않는다 — 동작은 아래 «dcTick 동작» 시험)");
  assert.ok(body.includes("const canSleep = typeof cx.sleep === \"function\";") && body.includes("if (canSleep && tb !== null) {"), "깊게 읽기는 쉴 수 있을 때만");
  assert.ok(body.includes("dist <= DC_READ_MAX") && body.includes("Math.min(DC_READ_MAX, Math.max(TF_LINES, dist + 2))"), "읽기 깊이");
  assert.ok(src.includes("DC_READ_MAX = 20000, DC_TEXT_MAX = 4 * 1024 * 1024") && body.includes("full.slice(-DC_TEXT_MAX)") && body.includes("const cut = full.length > DC_TEXT_MAX || (binds && full.length <= DC_BIND_MAX && dcReadCut(full, n));"), "글 상한 + cut(줄 수는 묶을 때만 센다)");
  // dcReadCut 은 글이 DC_BIND_MAX 이하일 때만(넘으면 dcBind 가 null) — 한 곳에서만 불리고 import 에 DC_BIND_MAX 가 있다
  assert.equal(code.filter(l => /\bdcReadCut\(/.test(l)).length, 1, "dcReadCut 호출은 한 곳");
  assert.ok(code.some(l => /\bdcReadCut\(/.test(l) && l.includes("binds && full.length <= DC_BIND_MAX && dcReadCut(full, n)")), "dcReadCut 은 묶을 때(binds) · full.length <= DC_BIND_MAX 일 때만");
  assert.ok(/import \{[^}]*\bDC_BIND_MAX\b[^}]*\} from "\.\/termfiles\.js"/.test(src), "main.js import 에 DC_BIND_MAX");
  assert.ok(body.includes("dcOldText(full, n === TF_LINES ? null : TF_LINES + ") && body.includes(", TF_TEXT)"), "묶이지 않는 글: 깊게 안 읽었으면 그대로(032f193) · 깊게 읽었으면 끝 TF_LINES + rows 줄 → TF_TEXT");
  assert.ok(src.includes("Number.isInteger(p.scroll?.total)") && !src.includes("Number.isFinite(p.scroll?.total)"), "total 은 정수만");
  assert.ok(src.includes("const dcTotal = (addr) =>") && /m\.length === 1 \? m\[0\]\.scroll\.total : null/.test(src), "total = 숫자 scroll.total 항목이 정확히 하나일 때만");
  assert.ok(!SHARED_OR_NOTE.test(code.join("\n")), "setShared · notify · tfNote · this.tf* 금지");
  const aw = lines.map((l, i) => (/\bawait /.test(l) ? i : -1)).filter(i => i >= 0);
  assert.equal(aw.length, 5, "await 다섯(pbpaste · hc read · 쉼 둘 · resolve)");
  // 긴 동기 조각 나누기(동작은 «dcTick 동작» 시험): 쉼은 둘 · 둘 다 같은 줄에서 gen 확인 · 순서 JSON.parse → 쉼 → dcBind → 쉼 → dcOldText → dcPick
  const iParse = body.indexOf("JSON.parse(r.stdout)"), iBind = body.indexOf("dcBind({"), iOld = body.indexOf("dcOldText("), iPick = body.indexOf("dcPick({");
  const sl = [...body.matchAll(/await cx\.sleep\(0\); if \(gen !== this\.dcGen\) return;/g)].map(m => m.index);
  assert.equal(sl.length, 2, "쉼 + gen 확인 둘");
  assert.equal((body.match(/cx\.sleep\(/g) ?? []).length, 2, "cx.sleep 호출 둘뿐");
  assert.ok(iParse > 0 && sl[0] > iParse && sl[0] < iBind && sl[1] > iBind && sl[1] < iOld && iOld < iPick, "쉼 하나는 JSON.parse 와 dcBind 사이 · 하나는 dcBind 와 dcOldText 사이");
  for (const i of aw) assert.ok(/^\s*if \(gen !== this\.dcGen\) return;/.test(lines[i + 1] ?? "") || /await [^;]+; if \(gen !== this\.dcGen\) return;/.test(lines[i]), `await 다음에 dcGen 확인 없음: ${lines[i].trim().slice(0, 60)}`);
  assert.ok(body.includes("if (!this.mac || this.closed) return;"), "macOS 전용");
  assert.equal(code.join("\n").match(/\bterminals\(\)/g)?.length, 1, "terminals() 호출은 하나(ts 를 cols 에도 쓴다)");
  const iSeen = body.indexOf("this.dcSeen = new Map("), iNoTerm = body.indexOf("if (!f?.terminal) return;");
  assert.ok(iSeen > 0 && iNoTerm > 0 && iSeen < iNoTerm, "dcSeen 갱신은 이른 return 앞");
  assert.ok(/dcStep\([^)]*prevKey: prevSeen\?\.get\(addr\)/.test(body), "dcStep 에 앞 틱 key 를 넘긴다");
  assert.ok(body.includes("selKey(g?.selection ?? null) !== selKey(sel)") && body.includes("g?.terminal !== addr") && body.includes("this.lifeOk()"), "열기 전 같은 터미널 · 같은 선택 · 닫힘 · 삶 확인");
  assert.ok(body.includes("this.openTermFile(path, on);"), "찍힌 머신(on)으로 연다");
  const iGet = body.indexOf("this.dcOpened.get(addr) === path"), iSet = body.indexOf("this.dcOpened.set(addr, path)"), iOpen = body.indexOf("this.openTermFile(path, on);");
  assert.ok(iGet > 0 && iSet > iGet && iSet < iOpen, "방금 연 파일 확인(get)이 기록(set) 앞 · 둘 다 열기 앞");
  const iAge = body.indexOf("DC_OPEN_MAX_MS");
  assert.ok(iAge > 0 && iAge < iOpen && iAge > iGet, "나이 제한 확인이 열기 앞");
  const iClr = body.indexOf("this.dcOpened.delete(");
  assert.ok(iClr > iSeen && iClr < iNoTerm, "dcOpened 정리는 dcSeen 갱신 뒤 · 이른 return 앞");
  assert.ok(/dcStep\([^)]*\bcols\b/.test(body) && body.indexOf("const cols = ts.find(") < body.indexOf("dcStep("), "cols 를 dcStep 앞에서 구해 넘긴다");
  assert.ok(body.includes("if (f.shown && f.shown !== f.terminal) return;"), "terminal.show 중이면 닫아 둔다");
  const iSpan = body.indexOf("const span = selSpan(sel, cols);");
  assert.ok(iSpan > 0 && body.includes("span === null || span > 1024 || !cwd") && iSpan < body.indexOf("cx.spawn("), "selSpan 관문이 spawn 앞");
  assert.ok(!src.includes("dcBusy"), "dcBusy 는 없다(새 선택이 앞 작업을 밀어낸다)");
  assert.ok(src.includes("try { this.dcTick(cx); } catch {"), "inbox 가 따로 try/catch 로 부른다");
});
const SHARED_OR_NOTE = /\bsetShared\b|\bnotify\(|tfNote|this\.tf[A-Z]/;

// ── dcTick 동작 시험: main.js 의 진짜 dcTick 메서드를 꺼내 가짜 호스트로 돌린다(쉼 · 깊게 읽기 · 묶기 · 열기). 순수 함수는 termfiles.js 진짜 + 호출 순서 기록(spy).
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, realpathSync } from "node:fs";
import * as TF from "../files-plus/termfiles.js";

const DC_SRC = await readFile(new URL("../files-plus/main.js", import.meta.url), "utf8");
const dcTickSrc = (() => {
  const from = DC_SRC.indexOf("  dcTick(cx) {"), to = DC_SRC.indexOf("  // 머리줄 아래 칸");
  assert.ok(from > 0 && to > from, "dcTick 경계(시작 · 다음 메서드 앞 주석)를 못 찾음");
  return DC_SRC.slice(from, to);
})();
// main.js 안 상수 · 작은 도우미를 글자 그대로 가져온다(못 찾으면 시험 실패 — 조용히 가짜로 바뀌지 않게)
const dcMainPart = (re, what) => { const m = DC_SRC.match(re); assert.ok(m, `main.js 에서 ${what} 를 못 찾음`); return m[0]; };
const dcConsts = [
  dcMainPart(/^const NAME = .*;$/m, "NAME"),
  dcMainPart(/^const TF_READ_MS = .*;$/m, "TF_LINES · TF_TEXT"),
  dcMainPart(/^const DC_OPEN_MAX_MS = .*;$/m, "DC_OPEN_MAX_MS"),
  dcMainPart(/^const DC_READ_MAX = .*;$/m, "DC_READ_MAX · DC_TEXT_MAX"),
  dcMainPart(/^const dcTotal = .*$/m, "dcTotal"),
].join("\n");
const dcMainVals = new Function("panes", `${dcConsts}\nreturn { NAME, TF_LINES, TF_TEXT, DC_READ_MAX, DC_TEXT_MAX, DC_OPEN_MAX_MS, dcTotal };`);
const DC_NAMES = ["terminals", "selKey", "focused", "panes", "NAME", "dcStep", "spaces", "terminalMachine", "selSpan", "exec", "dcClipShape", "dcTotal", "TF_LINES", "DC_READ_MAX", "hcLimited", "DC_TEXT_MAX", "DC_BIND_MAX", "dcReadCut", "dcBind", "dcOldText", "TF_TEXT", "dcPick", "dcLonger", "RESOLVE_SCRIPT", "dcChoose", "DC_OPEN_MAX_MS"];
const dcTickFn = new Function(...DC_NAMES, `return ({${dcTickSrc}}).dcTick;`);

const DC_ADDR = "term1", DC_COLS = 80, DC_ROWS = 24, DC_CLIP = "plan.md";
const dcLinesText = () => {   // 500 줄 · 150 줄과 450 줄에 «see plan.md here»(낱말은 열 4–10)
  const a = [];
  for (let i = 0; i < 500; i++) a.push(i === 150 || i === 450 ? "see plan.md here" : `filler line ${i}`);
  return a;
};

// opts: { selRow, how, sleep: "ok" | "none" | "reject" | "bump1" | "bump2" }
async function dcRun({ selRow, how, sleep }) {
  const dir = mkdtempSync(join(tmpdir(), "dctick-"));
  try {
    writeFileSync(join(dir, "plan.md"), "synthetic\n");
    const sel = { start: { row: selRow, col: 4 }, end: { row: selRow, col: 10 } };
    const lines = dcLinesText(), log = [], ev = { resolveArgv: null, lines: null, opened: [], sleeps: 0 };
    const state = { mac: true, closed: false, dcSeen: new Map(), dcOpened: new Map(), dcGen: 0, lifeOk: () => true, openTermFile: (p, on) => { ev.opened.push(p); log.push("open"); },
      dcSt: { addr: DC_ADDR, key: TF.selKey(sel), cols: DC_COLS, since: Date.now() - 5000, fired: false } };
    const spy = (name, fn) => (...a) => { log.push(name); return fn(...a); };
    const M = dcMainVals(() => [{ pane: "p1", terminal: DC_ADDR, cwd: dir, scroll: { total: 500 } }]);
    const exec = async (cmd, args) => {
      if (cmd === "/bin/sh") { log.push("pbpaste"); return { code: 0, stdout: DC_CLIP, stderr: "" }; }
      assert.equal(cmd, "sh", "둘째 exec 는 sh");
      log.push("resolve"); ev.resolveArgv = args;
      const r = spawnSync("sh", args, { encoding: "utf8" });
      return { code: r.status, stdout: r.stdout, stderr: r.stderr };
    };
    const hcLimited = async (cx, args) => {
      log.push("hc"); ev.lines = Number(args[args.indexOf("--lines") + 1]);
      return { code: 0, stdout: JSON.stringify({ text: lines.slice(-ev.lines).join("\n") + "\n", how }) };
    };
    const fn = dcTickFn(() => [{ address: DC_ADDR, selection: sel, cols: DC_COLS, rows: DC_ROWS }], TF.selKey, () => ({ terminal: DC_ADDR, pane: "p1", selection: sel, cwd: dir }), () => [{ pane: "p1", terminal: DC_ADDR, cwd: dir, scroll: { total: 500 } }],
      M.NAME, TF.dcStep, () => [{ active: true, machine: null }], TF.terminalMachine, TF.selSpan, exec, TF.dcClipShape, M.dcTotal, M.TF_LINES, M.DC_READ_MAX, hcLimited, M.DC_TEXT_MAX, TF.DC_BIND_MAX,
      spy("dcReadCut", TF.dcReadCut), spy("dcBind", TF.dcBind), spy("dcOldText", TF.dcOldText), M.TF_TEXT, spy("dcPick", TF.dcPick), spy("dcLonger", TF.dcLonger), TF.RESOLVE_SCRIPT, spy("dcChoose", TF.dcChoose), M.DC_OPEN_MAX_MS);
    let task = null;
    const inner = { timer: { after: () => ({ cancel() {} }) } };
    if (sleep !== "none") inner.sleep = async () => {
      ev.sleeps++; log.push("sleep");
      if (sleep === "reject") throw new Error("sleep 실패");
      if ((sleep === "bump1" && ev.sleeps === 1) || (sleep === "bump2" && ev.sleeps === 2)) state.dcGen++;
    };
    const unhandled = [], onUn = (e) => unhandled.push(e);
    process.on("unhandledRejection", onUn);
    try {
      fn.call(state, { spawn: (f) => { task = f(inner); } });
      assert.ok(task, "dcTick 이 작업을 띄우지 않음(사전 관문에서 멈춤 — 시험 장치 오류)");
      await task;
      await new Promise(r => setImmediate(r));
    } finally { process.off("unhandledRejection", onUn); }
    assert.equal(unhandled.length, 0, "처리 안 된 거부 없음");
    return { ...ev, log, opened: ev.opened.map(p => realpathSync(p)), want: join(realpathSync(dir), "plan.md"), seq: log.filter(x => x !== "pbpaste" && x !== "hc") };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const dcOpenedOk = (r, msg = "선택한 합성 파일 하나를 연다") => assert.deepEqual(r.opened, [r.want], msg);
const dcNothing = (r, msg) => { assert.deepEqual(r.opened, [], msg); assert.equal(r.resolveArgv, null, `${msg} — resolve 도 안 돈다`); };

test("dcTick 동작: 묶기 길(history · 쉼 정상) — 쉼 2 · dcBind 앞뒤 · 깊게 읽기 · 순서 · 파일 연다", async () => {
  const r = await dcRun({ selRow: 150, how: "history", sleep: "ok" });
  assert.equal(r.lines, 352, "깊게 읽는다(--lines 352)");
  assert.equal(r.sleeps, 2, "쉼 둘");
  assert.deepEqual(r.seq, ["dcReadCut", "sleep", "dcBind", "sleep", "dcOldText", "dcPick", "dcLonger", "resolve", "dcChoose", "open"], "순서");
  assert.equal(r.resolveArgv[0], "-c"); assert.equal(r.resolveArgv[1], TF.RESOLVE_SCRIPT);
  assert.deepEqual(r.resolveArgv.slice(2, 3), ["files-plus"]);
  assert.equal(r.resolveArgv[4], "plan.md", "cand");
  dcOpenedOk(r);
});

test("dcTick 동작: 묶기 + 300 줄 읽기(화면 안 선택 · 보통 길) — 쉼 둘 · dcBind 앞뒤 · 연다", async () => {
  const r = await dcRun({ selRow: 450, how: "history", sleep: "ok" });
  assert.equal(r.lines, 300, "깊게 읽지 않는다(--lines 300)");
  assert.equal(r.sleeps, 2, "묶으면 300 줄 읽기에서도 쉼 둘");
  assert.deepEqual(r.seq, ["dcReadCut", "sleep", "dcBind", "sleep", "dcOldText", "dcPick", "dcLonger", "resolve", "dcChoose", "open"], "순서");
  dcOpenedOk(r);
  const b2 = await dcRun({ selRow: 450, how: "history", sleep: "bump2" });
  assert.ok(b2.log.includes("dcBind") && !b2.log.includes("dcOldText"), "둘째 쉼에서 밀리면 dcBind 는 돌았고 dcOldText 는 안 돈다"); dcNothing(b2, "둘째 쉼에서 밀림");
});

test("dcTick 동작: 쉬는 사이 새 선택(dcGen)이 서면 그 뒤를 하지 않는다", async () => {
  const ok = await dcRun({ selRow: 150, how: "history", sleep: "ok" });
  dcOpenedOk(ok, "대조군(같은 장치 · 쉼 정상)은 연다");
  const b1 = await dcRun({ selRow: 150, how: "history", sleep: "bump1" });
  assert.equal(b1.sleeps, 1); assert.ok(!b1.log.includes("dcBind"), "첫 쉼에서 밀리면 dcBind 안 돈다"); dcNothing(b1, "첫 쉼에서 밀림");
  const b2 = await dcRun({ selRow: 150, how: "history", sleep: "bump2" });
  assert.equal(b2.sleeps, 2); assert.ok(b2.log.includes("dcBind") && !b2.log.includes("dcOldText"), "둘째 쉼에서 밀리면 dcBind 는 돌았고 dcOldText 는 안 돈다"); dcNothing(b2, "둘째 쉼에서 밀림");
});

test("dcTick 동작: cx.sleep 이 없으면 옛 300 줄 길 — 깊게 읽기 · 묶기 · dcReadCut · 쉼 없음, 옛 길로 연다", async () => {
  const r = await dcRun({ selRow: 150, how: "history", sleep: "none" });
  assert.equal(r.lines, 300, "--lines 300");
  assert.equal(r.sleeps, 0);
  assert.ok(!r.log.includes("dcBind") && !r.log.includes("dcReadCut"), "dcBind · dcReadCut 안 돈다");
  assert.deepEqual(r.seq, ["dcOldText", "dcPick", "dcLonger", "resolve", "dcChoose", "open"]);
  dcOpenedOk(r);
});

test("dcTick 동작: stitched + 깊게 읽기 — 쉼 하나(옛 길 앞) · 묶지 않는다 · dcReadCut 안 돈다", async () => {
  const r = await dcRun({ selRow: 150, how: "stitched", sleep: "ok" });
  assert.equal(r.lines, 352, "깊게 읽는다");
  assert.equal(r.sleeps, 1, "쉼 하나");
  assert.ok(!r.log.includes("dcBind") && !r.log.includes("dcReadCut"));
  assert.deepEqual(r.seq, ["sleep", "dcOldText", "dcPick", "dcLonger", "resolve", "dcChoose", "open"]);
  dcOpenedOk(r);
  const g = await dcRun({ selRow: 150, how: "stitched", sleep: "bump1" });
  dcNothing(g, "그 쉼에서 밀림");
});

test("dcTick 동작: stitched + 300 줄 읽기 — 쉼 없음(032f193 과 같다) · 연다", async () => {
  const r = await dcRun({ selRow: 450, how: "stitched", sleep: "ok" });
  assert.equal(r.lines, 300); assert.equal(r.sleeps, 0);
  assert.ok(!r.log.includes("dcBind") && !r.log.includes("dcReadCut"));
  dcOpenedOk(r);
});

test("dcTick 동작: 쉼이 거부되면 아무것도 열지 않고 작업은 조용히 끝난다(처리 안 된 거부 없음)", async () => {
  const r = await dcRun({ selRow: 150, how: "history", sleep: "reject" });
  assert.equal(r.sleeps, 1); dcNothing(r, "쉼 거부");
  const s = await dcRun({ selRow: 150, how: "stitched", sleep: "reject" });
  dcNothing(s, "쉼 거부(stitched 깊게 읽기)");
});
