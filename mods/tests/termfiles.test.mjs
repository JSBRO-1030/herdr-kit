// «터미널에 나온 파일»(termfiles.js) 시험 — candidates · parseResolved 는 순수 함수, RESOLVE_SCRIPT 는 진짜 sh(FP_SH 로 바꿈)로 임시 폴더에서 돌린다.
//   node --test mods/tests/termfiles.test.mjs
// 실제 사용자 홈은 건드리지 않는다: HOME 은 임시 폴더로 덮는다.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir, rm, realpath, symlink, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidates, parseResolved, RESOLVE_SCRIPT, SEARCH_SCRIPT, unresolved, mergeResolved, terminalMachine, trimTail, TERM_EXTS } from "../files-plus/termfiles.js";

const base = await realpath(await mkdtemp(join(process.env.TMPDIR || tmpdir(), "termfiles-")));
after(() => rm(base, { recursive: true, force: true }));
let seq = 0;
const fresh = async () => { const d = join(base, `d-${++seq}`); await mkdir(d); return d; };
const touch = async (p, body = "x") => { await mkdir(join(p, ".."), { recursive: true }); await writeFile(p, body); };

function sh(script, cwd, cands, env = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.FP_SH || "/bin/sh", ["-c", script, "files-plus", cwd, ...cands], { env: { ...process.env, HOME: base, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    const out = [], err = [];
    p.stdout.on("data", d => out.push(d)); p.stderr.on("data", d => err.push(d));
    p.on("error", reject);
    p.on("close", code => { const raw = Buffer.concat(out).toString("utf8"); resolve({ code, raw, paths: raw.split("\0").filter(x => x.startsWith("/")), stderr: Buffer.concat(err).toString() }); });
  });
}

// main.js tfScan 과 같은 두 단계: 직접 풀기 → 못 찾은 상대 이름만 찾기. 1단계가 실패하면 그 결과를 그대로 돌려준다.
async function run(cwd, cands, env = {}) {
  const a = await sh(RESOLVE_SCRIPT, cwd, cands, env);
  if (a.code !== 0) return a;
  const names = unresolved(a.raw);
  if (!names.length) return a;
  const s = await sh(SEARCH_SCRIPT, cwd, names, env);
  return { code: s.code, paths: [...a.paths, ...s.paths], stderr: a.stderr + s.stderr, searched: true };
}

// find 를 부를 때마다 로그에 한 줄 남기는 PATH 앞 가짜 find(진짜 find 로 넘긴다).
async function findShim() {
  const dir = await fresh(), log = join(dir, "calls.log"), real = (await new Promise(r => { const p = spawn("/bin/sh", ["-c", "command -v find"]); const o = []; p.stdout.on("data", d => o.push(d)); p.on("close", () => r(Buffer.concat(o).toString().trim())); }));
  await writeFile(join(dir, "find"), `#!/bin/sh\necho x >> "${log}"\nexec "${real}" "$@"\n`); await chmod(join(dir, "find"), 0o755);
  const calls = async () => { try { return (await readFile(log, "utf8")).split("\n").filter(Boolean).length; } catch { return 0; } };
  return { env: { PATH: `${dir}:${process.env.PATH}` }, calls };
}

const SAMPLE = [
  "  • 📄 PDF 완본 보고서: 고서_X_Ver2.pdfreport/보고서_X_Ver2.pdf (12페이지 완본)",
  "  • 🌐 HTML 원본 문서: report/report_v2.html",
  "  • report.html.bak, report.html.v2.bak (편집 백업본)",
].join("\n");

// ── candidates ──
test("candidates: 붙은 확장자를 나눠 report/…pdf 를 낸다", () => {
  // protects=링크 글자와 상대 경로가 붙어 찍힌 줄에서도 실제 경로 후보가 나온다; fails_when=붙은 확장자 분리가 없으면 `report/보고서_X_Ver2.pdf` 가 빠진다; no_claim=그 파일이 있는지는 말하지 않는다(RESOLVE_SCRIPT 몫) · `/` 든 토큰의 마지막 조각은 맨 이름 후보로 내지 않는다(아래 시험)
  const c = candidates("고서_X_Ver2.pdfreport/보고서_X_Ver2.pdf");
  assert.deepEqual(c, ["report/보고서_X_Ver2.pdf", "고서_X_Ver2.pdf"]);
});

test("candidates: 실제 보고 샘플 — .bak 백업은 후보가 아니고 html 이 htm 으로 잘리지 않는다", () => {
  // protects=샘플 3줄에서 pdf 1 · html 1 만 나온다; fails_when=`.html` 이 `.htm` 으로 잘리거나 `report.html.bak` 에서 `report.html` 을 뽑으면 목록이 어긋난다; no_claim=bare 이름 후보(report_v2.html)는 순서까지만 본다
  const c = candidates(SAMPLE);
  assert.ok(c.includes("report/보고서_X_Ver2.pdf") && c.includes("report/report_v2.html"));
  assert.ok(!c.some(x => /\.bak|\.htm$|^report\.html$/.test(x)), c.join("|"));
});

test("candidates: file:// 은 떼고 퍼센트 디코딩 · 깨진 인코딩은 버린다", () => {
  // protects=링크 글자의 %20 · 한글 인코딩이 실제 이름이 된다; fails_when=디코딩이 없으면 %20 이 남고 깨진 %E0 에서 던진다; no_claim=호스트 부분이 있는 file://host/ 는 다루지 않는다
  assert.deepEqual(candidates("file:///tmp/my%20doc/%EC%95%84.pdf"), ["/tmp/my doc/아.pdf"]);
  assert.deepEqual(candidates("file:///tmp/%E0%A4%A.pdf"), []);
});

test("candidates: 끝 문장부호 · :줄번호 를 뗀다", () => {
  // protects=`a.json:12:3,` 같은 오류 위치 꼬리가 이름에서 빠진다; fails_when=꼬리가 남으면 존재 검사에서 전부 탈락한다; no_claim=확장자 뒤 일반 글자(a.pdfx)는 다른 규칙
  assert.deepEqual(candidates("see out/a.json:12:3, and b.csv."), ["b.csv", "out/a.json"]);   // `/` 든 토큰은 맨 이름 조각을 내지 않는다
  assert.deepEqual(candidates("(x.png);"), ["x.png"]);
});

test("candidates: 글롭 · 제어문자 · 1024 바이트 초과 토큰은 버린다", () => {
  // protects=터미널 글자가 find 패턴이나 이스케이프로 새지 않는다; fails_when=* ? [ \\ 나 \\u001b 가 든 토큰이 후보로 나오면 실패; no_claim=공백으로 쪼개진 조각은 별개 토큰
  assert.deepEqual(candidates("*.pdf a?b.png c\\d.txt \u001bx.txt e\u0007.log"), []);
  assert.deepEqual(candidates(`${"가".repeat(400)}.pdf`), []);               // 1200 바이트
  assert.equal(candidates(`${"가".repeat(300)}.pdf`).length > 0, true);       // 900 바이트
});

test("candidates: 가장 최근(아래 줄 · 오른쪽)이 먼저, 중복 없이", () => {
  // protects=최근 순 + 같은 이름 한 번; fails_when=순서가 위에서 아래이거나 중복이 두 번 나오면 실패; no_claim=같은 줄 안 순서의 세부는 오른쪽 우선만 본다
  assert.deepEqual(candidates("a.png b.png\nc.png\na.png"), ["a.png", "c.png", "b.png"]);
});

test("candidates: max 개까지만", () => {
  // protects=후보 수 상한(sh 인자 수 · 시간); fails_when=max 를 넘겨 내면 실패; no_claim=기본값 40 의 근거는 시험하지 않는다
  const text = Array.from({ length: 100 }, (_, i) => `f${i}.png`).join("\n");
  assert.equal(candidates(text, { max: 5 }).length, 5);
  assert.equal(candidates(text).length, 40);
  assert.equal(candidates(text, { max: 5 })[0], "f99.png");
});

test("candidates: 확장자 목록 밖 · 이름 없는 확장자 · 대소문자 · 절대 경로", () => {
  // protects=목록 밖(.bak .sh) 과 `.pdf` 만 있는 토큰은 안 나오고 대문자 확장자는 나온다; fails_when=.sh 가 나오거나 REPORT.PDF 가 빠지면 실패; no_claim=TERM_EXTS 전체 목록은 고정하지 않는다
  assert.deepEqual(candidates("x.sh y.bak .pdf"), []);
  assert.deepEqual(candidates("REPORT.PDF"), ["REPORT.PDF"]);
  assert.deepEqual(candidates("/a/b/c.docx ~/n.md"), ["~/n.md", "/a/b/c.docx"]);
  assert.ok(TERM_EXTS.has("pdf") && TERM_EXTS.has("heic") && TERM_EXTS.has("md") && TERM_EXTS.has("toml") && !TERM_EXTS.has("bak"));
});

// ── parseResolved ──
test("parseResolved: 순서 유지 · 중복 · 상대 · 제어문자 · 나쁜 이름 거름 · max", () => {
  // protects=sh 가 준 것을 JS 가 한 번 더 걸러 경로 탈출·상대 경로가 못 들어온다; fails_when=중복·상대·`..` 이름·개행 든 경로가 통과하면 실패; no_claim=파일 존재는 sh 가 정한다
  const out = ["/a/x.pdf", "/a/x.pdf", "rel/y.png", "/a/..", "/b/z\n.txt", "/b/ok.txt", ""].join("\0");
  assert.deepEqual(parseResolved(out), ["/a/x.pdf", "/b/ok.txt"]);
  assert.deepEqual(parseResolved(["/1.png", "/2.png", "/3.png"].join("\0"), { max: 2 }), ["/1.png", "/2.png"]);
  assert.deepEqual(parseResolved(undefined), []);
});

// ── RESOLVE_SCRIPT (진짜 sh) ──
test("RESOLVE_SCRIPT: 절대 경로 · 상대 경로", async () => {
  // protects=있는 파일은 실제 절대 경로로 나온다; fails_when=상대 후보가 cwd 기준으로 안 풀리면 실패; no_claim=심볼릭 링크 대상 파일의 소유권은 다루지 않는다
  const d = await fresh(); await touch(join(d, "report/a.pdf")); await touch(join(d, "top.png"));
  const r = await run(d, [join(d, "top.png"), "report/a.pdf", "./top.png"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.paths, [join(d, "top.png"), join(d, "report/a.pdf"), join(d, "top.png")]);
});

test("RESOLVE_SCRIPT: ~/ 는 HOME 아래", async () => {
  // protects=~/ 가 HOME 으로 풀린다(임시 HOME); fails_when=~ 를 그대로 cwd 아래에서 찾으면 실패; no_claim=HOME 이 비었을 때의 동작은 건너뛴다(후보 무시)
  const d = await fresh(); const home = await fresh(); await touch(join(home, "docs/n.md"));
  const r = await run(d, ["~/docs/n.md", "~/docs/none.md"], { HOME: home });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.paths, [join(home, "docs/n.md")]);
});

test("RESOLVE_SCRIPT: 맨 이름은 깊이 3 까지 find · node_modules · .git 은 건너뜀", async () => {
  // protects=맨 이름 후보가 하위 폴더에서 찾아지되 깊이 3 · node_modules · .git 밖은 안 본다; fails_when=깊이 4 파일이나 node_modules 안 파일이 나오면 실패; no_claim=find 결과 순서는 보장하지 않는다
  const d = await fresh();
  await touch(join(d, "a/b/deep3.png")); await touch(join(d, "a/b/c/d/deep5.png"));
  await touch(join(d, "node_modules/p/nm.png")); await touch(join(d, ".git/g.png"));
  const r = await run(d, ["deep3.png", "deep5.png", "nm.png", "g.png"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.paths, [join(d, "a/b/deep3.png")]);
});

test("RESOLVE_SCRIPT: 맨 이름 find 는 같은 이름 3개까지만", async () => {
  // protects=한 후보가 결과를 도배하지 않는다; fails_when=4개 이상 나오면 실패; no_claim=어느 3개인지는 보장하지 않는다
  const d = await fresh();
  for (const s of ["a", "b", "c", "e", "f"]) await touch(join(d, s, "same.png"));
  const r = await run(d, ["same.png"]);
  assert.equal(r.paths.length, 3);
});

test("RESOLVE_SCRIPT: 폴더 · 없는 파일 · 글롭 · 슬래시 든 못 찾은 후보는 안 나온다", async () => {
  // protects=폴더 이름이 .pdf 로 끝나도 · 없는 것 · 글롭은 거절; fails_when=폴더가 나오거나 글롭이 find 패턴으로 쓰이면 실패; no_claim=못 찾은 슬래시 후보는 find 하지 않는다(맨 이름만 find)
  const d = await fresh(); await mkdir(join(d, "dir.pdf")); await touch(join(d, "x/real.png"));
  const r = await run(d, ["dir.pdf", "missing.png", "*.png", "re?l.png", "q/real.png"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.paths, []);
});

test("RESOLVE_SCRIPT: 공백 · 한글 · 따옴표 · 앞 - 이름", async () => {
  // protects=이름이 스크립트 글자로 해석되지 않고 위치 인자로만 쓰인다(직접 풀기 · -name 찾기 · -path 찾기 셋 다); fails_when=공백에서 쪼개지거나 $(…)·- 가 실행·옵션이 되면 실패; no_claim=개행 든 이름은 아래 시험
  const d = await fresh();
  const names = ["my report 보고서.pdf", "a'b$(echo x).txt", "-rf.png", "`id`.log"];
  for (const n of names) await touch(join(d, "sub", n));
  for (const n of names) await touch(join(d, "deep", "sub2", n));
  const r = await run(d, [...names.map(n => `sub/${n}`), ...names, ...names.map(n => `sub2/${n}`)]);   // 앞 = 직접 · 가운데 = 이름 찾기(-name) · 뒤 = 경로 끝 찾기(-path)
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.searched, true);
  assert.deepEqual(new Set(r.paths), new Set([...names.map(n => join(d, "sub", n)), ...names.map(n => join(d, "deep/sub2", n))]));
});

test("RESOLVE_SCRIPT: -path 만으로 찾기 — 같은 이름이 다른 폴더에 있어도 sub2/<이름> 끝만", async () => {
  // protects=-path 가지가 -name 에 가려지지 않고 홀로 위험한 이름(공백 · $( ) · 앞 - · 백틱)을 데이터로 다룬다; fails_when=-path 가지가 빠지면 deep/sub2 결과가 비고 -name 으로 새면 sub/ 파일이 섞여 실패; no_claim=결과 순서는 보장하지 않는다
  const { existsSync } = await import("node:fs");
  const d = await fresh();
  const names = ["my report 보고서.pdf", "a'b$(echo x).txt", "-rf.png", "`id`.log"];
  for (const n of names) { await touch(join(d, "deep", "sub2", n)); await touch(join(d, "sub", n)); }   // sub/ 쪽은 -name 이었다면 걸릴 미끼
  const prev = process.env.FP_SH;
  try {
    for (const shell of ["/bin/sh", "/bin/dash"]) {
      if (!existsSync(shell)) continue;
      process.env.FP_SH = shell;
      const r = await run(d, names.map(n => `sub2/${n}`));
      assert.equal(r.code, 0, `${shell}: ${r.stderr}`);
      assert.equal(r.searched, true);
      assert.deepEqual(new Set(r.paths), new Set(names.map(n => join(d, "deep/sub2", n))), shell);
      assert.equal(r.paths.length, names.length, shell);
    }
  } finally { prev === undefined ? delete process.env.FP_SH : (process.env.FP_SH = prev); }
});

test("SEARCH_SCRIPT: 깊이 — 맨 이름은 3 · 경로 N 조각은 N+2(최대 6), 서로 늘리지 않는다", async () => {
  // protects=한 후보의 깊이가 다른 후보로 번지지 않는다(맨 이름 3 고정 · 경로는 자기 조각 수 +2 · 상한 6); fails_when=경로 후보와 함께 오면 깊이 5 맨 이름이 나오거나, 경로가 한도 안(깊이 6)에서 안 나오거나 한도 밖(깊이 7)에서 나오면 실패; no_claim=6 조각 이상 경로의 접두 폴더 허용은 정하지 않는다(상한 6 이 그대로 적용)
  const d = await fresh();
  await touch(join(d, "a/b/c/d/deep5.png"));                // 맨 이름 · 깊이 5 → 안 나와야 한다
  await touch(join(d, "a/b/ok3.png"));                      // 맨 이름 · 깊이 3 → 나온다
  await touch(join(d, "m/n/p/q/r/s.png"));                  // 경로 p/q/r/s.png(4조각 → 한도 6) · 깊이 6 → 나온다
  await touch(join(d, "m/n/o/p/q/r/s.png"));               // 같은 경로 · 깊이 7 → 안 나온다(위와 접두만 다른 자리)
  await touch(join(d, "x/a/b/c/d/e.png"));                  // 경로 a/b/c/d/e.png(5조각 → 한도 6) · 깊이 6 → 나온다
  await touch(join(d, "y/z/a/b/c/d/e.png"));               // 깊이 7 → 안 나온다
  const r = await run(d, ["deep5.png", "ok3.png", "p/q/r/s.png", "a/b/c/d/e.png", "w/x/y/z.png"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(new Set(r.paths), new Set([join(d, "a/b/ok3.png"), join(d, "m/n/p/q/r/s.png"), join(d, "x/a/b/c/d/e.png")]));
  const solo = await run(d, ["deep5.png"]);                 // 대조군: 경로 후보 없이도 깊이 5 맨 이름은 안 나온다
  assert.deepEqual(solo.paths, []);
});

test("SEARCH_SCRIPT: 경로 후보 자기 한도(조각+2)도 awk 가 건다 — 다른 후보가 find 깊이를 6 으로 늘려도", async () => {
  // protects=2조각 경로(한도 4)가 같이 온 6조각 경로 때문에 깊이 6 까지 늘어나지 않는다(awk 깊이 한도가 맨 이름뿐 아니라 경로 후보에도 걸린다); fails_when=깊이 5 의 a/b/c/k/f.png 가 k/f.png 로 나오면 실패(한도를 맨 이름에만 거는 변형을 잡는다); no_claim=p/q/r/s.png 가 있을 때의 결과(위 시험이 다룬다)
  const d = await fresh();
  await touch(join(d, "a/b/c/k/f.png"));                    // k/f.png(2조각 → 한도 4) · 깊이 5 → 안 나온다
  const r = await run(d, ["k/f.png", "p/q/r/s.png"]);       // 두 번째가 find maxdepth 를 6 으로 올린다
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.searched, true);
  assert.deepEqual(r.paths, []);
});

test("SEARCH_SCRIPT: cwd 가 HOME 의 조상이면 찾지 않는다 · HOME 아래 하위 폴더는 찾는다", async () => {
  // protects=/Users · /home 같은 조상 폴더에서 모든 사용자 홈을 훑지 않는다(임시 HOME=<tmp>/u/me); fails_when=조상 cwd 에서 find 가 불리거나 파일이 나오거나, HOME 아래 proj 에서 안 찾으면 실패; no_claim=HOME 이 비었을 때는 조상 판정을 건너뛴다(빈 HOME 이 모든 루트에 맞지 않는다)
  const u = await fresh(), home = join(u, "me"), proj = join(home, "proj");
  await touch(join(u, "x/deep.png")); await touch(join(proj, "sub/deep.png"));
  let sh = await findShim();
  let r = await run(u, ["deep.png"], { ...sh.env, HOME: home });
  assert.equal(r.code, 0, r.stderr); assert.deepEqual(r.paths, []); assert.equal(await sh.calls(), 0);
  sh = await findShim();
  r = await run(proj, ["deep.png"], { ...sh.env, HOME: home });
  assert.deepEqual(r.paths, [join(proj, "sub/deep.png")]); assert.equal(await sh.calls(), 1);
  sh = await findShim();
  r = await run(u, ["deep.png"], { ...sh.env, HOME: "" });  // 빈 HOME 은 건너뛰기 아님 → 일반 탐색
  assert.equal(r.code, 0, r.stderr); assert.equal(await sh.calls(), 1);
});

test("SEARCH_SCRIPT: 이름만 비슷한 폴더(HOME=<tmp>/me, cwd=<tmp>/meeting)는 조상으로 보지 않는다", async () => {
  // protects=조상 판정이 글자 접두사가 아니라 폴더 경계("$h/" 가 "$root"/ 로 시작)로 이뤄진다; fails_when=<tmp>/meeting 에서 찾기를 건너뛰어 파일이 안 나오거나 find 가 불리지 않으면 실패; no_claim=심볼릭 링크로 이어진 조상(실제 경로만 비교한다)
  const u = await fresh(), home = join(u, "me"), cwd = join(u, "meeting");
  await touch(join(home, "x.txt")); await touch(join(cwd, "sub/deep.png"));
  const sh = await findShim();
  const r = await run(cwd, ["deep.png"], { ...sh.env, HOME: home });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.paths, [join(cwd, "sub/deep.png")]);
  assert.equal(await sh.calls(), 1);
});

test("RESOLVE_SCRIPT: 개행 든 이름은 내지 않는다 · 폴더 링크는 실제 경로로", async () => {
  // protects=NUL 구분 출력이 개행 든 경로로 깨지지 않고 링크 폴더는 실제 경로로 풀린다; fails_when=개행 든 경로가 나오거나 링크 경로가 그대로 나오면 실패; no_claim=링크 파일 자체는 다루지 않는다
  const d = await fresh(); await touch(join(d, "real/ok.png")); await touch(join(d, "real/n\nl.png"));
  await symlink(join(d, "real"), join(d, "lnk"));
  const r = await run(d, ["lnk/ok.png", "real/n\nl.png"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.paths, [join(d, "real/ok.png")]);
});

test("RESOLVE_SCRIPT: cwd 가 폴더가 아니면 exit 3", async () => {
  // protects=사라진 cwd 에서 빈 결과 대신 exit 3 로 알린다; fails_when=exit 0 이거나 cwd 밖을 뒤지면 실패; no_claim=stderr 문구는 정하지 않는다
  const d = await fresh(); await touch(join(d, "f.png"));
  assert.equal((await run(join(d, "missing"), ["x.png"])).code, 3);
  assert.equal((await run(join(d, "f.png"), ["x.png"])).code, 3);
});

test("RESOLVE_SCRIPT: /bin/dash 가 있으면 같은 결과", async t => {
  // protects=dash 호환(우분투 /bin/sh); fails_when=bash 전용 문법이 들어가 dash 에서 결과가 달라지면 실패; no_claim=dash 가 없는 곳에서는 건너뛴다
  const { existsSync } = await import("node:fs");
  if (!existsSync("/bin/dash")) return t.skip("no /bin/dash");
  const d = await fresh(); await touch(join(d, "a/b/x y.pdf"));
  const prev = process.env.FP_SH; process.env.FP_SH = "/bin/dash";
  try { const r = await run(d, ["x y.pdf", "a/b/x y.pdf"]); assert.equal(r.code, 0, r.stderr); assert.deepEqual(r.paths, [join(d, "a/b/x y.pdf"), join(d, "a/b/x y.pdf")]); }
  finally { prev === undefined ? delete process.env.FP_SH : (process.env.FP_SH = prev); }
});

// ── 두 번째 단계(SEARCH_SCRIPT) · = 경계 · trimTail ──
test("candidates: = 는 토큰 경계 — --out=/tmp/x.pdf 는 /tmp/x.pdf", () => {
  // protects=옵션=값 꼴에서 값이 후보로 나온다; fails_when=`--out=` 가 붙은 채 남거나 값이 빠지면 실패; no_claim=`=` 가 든 실제 파일 이름(a=b.pdf)은 앞 조각을 잃는다(알려진 한계)
  assert.deepEqual(candidates("run --out=/tmp/report.pdf --in=src/a.png"), ["src/a.png", "/tmp/report.pdf"]);
});

test("candidates: / 든 토큰은 마지막 조각(맨 이름)을 따로 내지 않는다", () => {
  // protects=src/conf/app.json 이 다른 폴더의 app.json 으로 오인되지 않는다; fails_when=`app.json` 이 후보에 나오면 실패; no_claim=붙은 확장자 앞 조각(a.pdfb/c.pdf 의 a.pdf)은 맨 이름 후보로 남는다
  assert.deepEqual(candidates("src/conf/app.json"), ["src/conf/app.json"]);
  assert.deepEqual(candidates("./x/y.png ../z.png ~/w.png"), ["~/w.png", "../z.png", "./x/y.png"]);
});

test("SEARCH_SCRIPT: 못 찾은 상대 경로는 «끝이 같은 경로» 만 — 이름만 같은 다른 파일은 안 나온다", async () => {
  // protects=src/conf/app.json 을 찾을 때 a/src/conf/app.json 만 나오고 b/other/app.json 은 안 나온다; fails_when=맨 이름 app.json 으로 찾아 b/other/app.json 이 나오면 실패; no_claim=여러 곳에 끝이 같은 경로가 있을 때 어느 것인지는 보장하지 않는다
  const d = await fresh(); await touch(join(d, "a/src/conf/app.json")); await touch(join(d, "b/other/app.json")); await touch(join(d, "c/xsrc/conf/app.json"));
  const r = await run(d, ["src/conf/app.json"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.paths, [join(d, "a/src/conf/app.json")]);
});

test("SEARCH_SCRIPT: 이름이 많아도 find 는 한 번 · 이름은 10개까지", async () => {
  // protects=후보 40개여도 트리를 한 번만 훑고 10개까지만 찾는다; fails_when=find 호출이 2번 이상이거나 11번째 이름의 파일이 나오면 실패; no_claim=앞 10개 중 어느 것이 나오는지는 후보 순서를 따른다
  const d = await fresh(); const sh = await findShim();
  const names = Array.from({ length: 14 }, (_, i) => `n${i}.png`);
  for (const n of names) await touch(join(d, "sub", n));
  const r = await run(d, names, sh.env);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(await sh.calls(), 1);
  assert.deepEqual(new Set(r.paths), new Set(names.slice(0, 10).map(n => join(d, "sub", n))));
});

test("SEARCH_SCRIPT: cwd 가 실제 $HOME 이거나 / 이면 찾지 않는다", async () => {
  // protects=홈 · 루트에서 트리 전체를 훑지 않는다(임시 HOME 으로 시험); fails_when=find 가 불리거나 하위 파일이 나오면 실패; no_claim=HOME 의 심볼릭 링크 폴더에서도 실제 경로로 비교하는지는 이 시험이 아니라 pwd -P 에 맡긴다
  const home = await fresh(); await touch(join(home, "sub/deep.png")); const other = await fresh(); await touch(join(other, "sub/deep.png"));
  let sh = await findShim();
  let r = await run(home, ["deep.png"], { ...sh.env, HOME: home });
  assert.equal(r.code, 0, r.stderr); assert.deepEqual(r.paths, []); assert.equal(await sh.calls(), 0);
  sh = await findShim();
  r = await run(other, ["deep.png"], { ...sh.env, HOME: home });                          // 대조군: 홈이 아니면 찾는다
  assert.deepEqual(r.paths, [join(other, "sub/deep.png")]); assert.equal(await sh.calls(), 1);
  sh = await findShim();
  r = await run("/", ["nonexistent_termfiles_probe.png"], { ...sh.env, HOME: home });
  assert.equal(r.code, 0, r.stderr); assert.deepEqual(r.paths, []); assert.equal(await sh.calls(), 0);
});

test("두 단계: 2단계가 없어도 1단계(직접) 결과는 남는다", async () => {
  // protects=찾기 단계가 실패·시간 초과여도 직접 푼 파일은 줄에 나온다; fails_when=mergeResolved 가 2단계 null 에서 직접 결과를 버리면 실패; no_claim=main.js 의 exec 실패 처리 자체는 herdr 호스트가 필요해 시험하지 않는다
  const d = await fresh(); await touch(join(d, "hit.png")); await touch(join(d, "sub/deep.png"));
  const a = await sh(RESOLVE_SCRIPT, d, ["hit.png", "deep.png"]);
  assert.equal(a.code, 0, a.stderr);
  assert.deepEqual(unresolved(a.raw), ["deep.png"]);
  assert.deepEqual(mergeResolved(a.raw, null), [join(d, "hit.png")]);
  const s = await sh(SEARCH_SCRIPT, d, ["deep.png"]);
  assert.deepEqual(mergeResolved(a.raw, s.raw), [join(d, "hit.png"), join(d, "sub/deep.png")]);
  assert.equal((await sh(SEARCH_SCRIPT, join(d, "missing"), ["deep.png"])).code, 3);        // 2단계 실패는 exit 3 등으로 알려진다 → 호출 쪽이 무시
});

test("terminalMachine: 원격 터미널은 원격 머신 · 로컬은 null · space 의 machine 우선", () => {
  // protects=location() 과 같은 머신 규칙(터미널만 눌림 → 주소 앞부분 · 페인이 있으면 space.machine); fails_when=원격 주소가 null 이 되거나 로컬이 원격으로 나오면 실패; no_claim=space.machine 이 없을 때 주소 앞부분으로 되돌리는 것은 location() 과 다른 점이다
  assert.equal(terminalMachine({ pane: null }, { machine: null }, "box-a/t3"), "box-a");
  assert.equal(terminalMachine({ pane: null }, { machine: "box-b" }, "t3"), null);
  assert.equal(terminalMachine({ pane: "p1" }, { machine: "box-a" }, "box-a/t3"), "box-a");
  assert.equal(terminalMachine({ pane: "p1" }, { machine: null }, "t3"), null);
  assert.equal(terminalMachine({ pane: "p1" }, { machine: null }, "box-a/t3"), "box-a");
});

test("trimTail: 점 · 콜론이 긴 토큰도 선형 시간 · 꼬리 규칙은 그대로", () => {
  // protects=긴 점 줄에서 제곱 시간이 되지 않는다; fails_when=1e6 글자 처리가 1 초를 넘거나 꼬리 결과가 달라지면 실패; no_claim=절대 시간은 기계에 따라 다르다(느슨한 상한)
  assert.equal(trimTail("a.json:12:3,"), "a.json");
  assert.equal(trimTail("a:1:2:3"), "a");
  assert.equal(trimTail("a.b"), "a.b");
  assert.equal(trimTail("...."), "");
  assert.equal(trimTail("x.pdf:7."), "x.pdf");
  const t0 = Date.now();
  assert.equal(trimTail("x.pdf" + ".".repeat(1_000_000)), "x.pdf");
  assert.equal(trimTail("x.pdf" + ":1".repeat(200_000)), "x.pdf");
  assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
});
