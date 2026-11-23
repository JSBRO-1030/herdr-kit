// «터미널에 나온 파일»(termfiles.js) 시험 — candidates · parseResolved 는 순수 함수, RESOLVE_SCRIPT 는 진짜 sh(FP_SH 로 바꿈)로 임시 폴더에서 돌린다.
//   node --test mods/tests/termfiles.test.mjs
// 실제 사용자 홈은 건드리지 않는다: HOME 은 임시 폴더로 덮는다.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir, rm, realpath, symlink, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidates, scanText, pickRows, parseResolved, RESOLVE_SCRIPT, SEARCH_SCRIPT, unresolved, mergeResolved, terminalMachine, trimTail, mergeLight, endedWorking, TERM_EXTS, CODE_EXTS, scanGate, TF_STUCK_MS, errClass, stuckAfter, noteWrite, termKey, cellWidth, selSpan, selKey, dcStep, dcPick, dcLonger, dcChoose, DC_MAX_PROBES, NAME_MAX_UNITS, dcBind, dcOldText, DC_WRAP_ROWS, DC_TAIL_STEPS, DC_MAX_WRAP, DC_WIN_MAX, DC_BIND_MAX, DC_WALK_MAX, DC_FIND_DIV, dcClipShape, dcReadCut } from "../files-plus/termfiles.js";

const utf8Len = (s) => Buffer.byteLength(s, "utf8");
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
  // protects=목록 밖(.bak .exe) 과 `.pdf` 만 있는 토큰은 안 나오고 대문자 확장자는 나온다; fails_when=.exe 가 나오거나 REPORT.PDF 가 빠지면 실패; no_claim=TERM_EXTS 전체 목록은 고정하지 않는다(.sh 는 코드 확장자로 들어와 아래 시험이 다룬다)
  assert.deepEqual(candidates("x.exe y.bak .pdf"), []);
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

// ── 에이전트 화면(Claude Code · Codex · Gemini CLI) · 코드 확장자 · 줄 잇기 ──
const has = (c, ...names) => names.every(n => c.includes(n));

test("candidates: Claude Code 꼴 — ⏺ Write(…) · ⎿ Wrote … · ⏺ Update(…)", () => {
  // protects=⏺ ⎿ 장식과 괄호가 경계라 경로가 그대로 나온다; fails_when=⏺/⎿ 가 토큰에 붙거나 Update(src/app.py) 의 py 가 빠지면 실패; no_claim=나오는 순서의 세부는 최근(아래)이 먼저라는 것만 본다
  const c = candidates(["⏺ Write(report/summary.pdf)", "  ⎿  Wrote 12 lines to report/summary.pdf", "⏺ Update(src/app.py)"].join("\n"));
  assert.deepEqual(c, ["src/app.py", "report/summary.pdf"]);
});

test("candidates: Claude Bash 줄바꿈(들여쓴 이음 줄 · 토큰 중간에서 잘림) → 이은 후보는 guesses", () => {
  // protects=잘린 경로가 위 줄 끝 + 아래 줄 머리로 이어져 나오고 추측으로 표시된다; fails_when=이은 후보가 없거나 guesses 에 없으면 실패(찾기로 새면 안 된다); no_claim=단어 경계 줄바꿈과 구별되지 않는다(추측일 뿐)
  const text = ["⏺ Bash(cat docs/notes/long/dir/mem", "      o_final.md)"].join("\n");
  const r = scanText(text);
  assert.ok(r.cands.includes("docs/notes/long/dir/memo_final.md"), r.cands.join("|"));
  assert.ok(r.guesses.has("docs/notes/long/dir/memo_final.md"));
  assert.ok(r.cands.includes("o_final.md") && !r.guesses.has("o_final.md"));
  // 세 줄 이음: 가운데 줄이 토큰 하나
  const t3 = ["⏺ Bash(cat docs/notes/lo", "      ng/di", "      r/memo.md)"].join("\n");
  const r3 = scanText(t3);
  assert.ok(r3.guesses.has("docs/notes/long/dir/memo.md"), r3.cands.join("|"));
});

test("candidates: Gemini 상자 줄바꿈 — │ … │ 안에서 이어진다", () => {
  // protects=│ 테두리가 경계 · 이음 둘 다에서 벗겨져 경로가 이어진다; fails_when=docs/very/long/path/guide.md 가 없거나 추측 표시가 없으면 실패; no_claim=✓ 같은 상태 글자는 후보에 영향 없음
  const r = scanText(["│ ✓  ReadFile docs/very/long/pa │", "│ th/guide.md │"].join("\n"));
  assert.ok(r.cands.includes("docs/very/long/path/guide.md"), r.cands.join("|"));
  assert.ok(r.guesses.has("docs/very/long/path/guide.md"));
});

test("candidates: Codex 꼴 — • Edited · └ Read · 백틱 · #L · :줄-줄 · ─ 구분선", () => {
  // protects=줄 위치 꼬리(:42 · #L10-L20 · :12-20)와 • └ ─ 장식이 이름에서 빠진다; fails_when=꼬리가 남거나 main.rs / lib.rs 가 빠지면 실패; no_claim=`(+3 -1)` 같은 통계는 후보가 아니다
  const text = ["• Edited src/app.ts (+3 -1)", "  └ Read main.rs, lib.rs", "`src/app.ts:42`", "docs/guide.md#L10-L20", "src/a.ts:12-20", "─ Worked for 1m 20s ─"].join("\n");
  const c = candidates(text);
  assert.ok(has(c, "src/app.ts", "main.rs", "lib.rs", "docs/guide.md", "src/a.ts"), c.join("|"));
  assert.ok(!c.some(x => /[:#]/.test(x)), c.join("|"));
});

test("trimTail: #LN · #LN-LM · #LNCM · #LNCM-LNCM · :N-M", () => {
  // protects=깃허브 · 에디터식 줄 위치 꼬리가 모두 빠진다; fails_when=꼬리가 남거나 a-12 같은 이름 일부를 잘못 떼면 실패; no_claim=`#` 뒤가 L 없는 숫자(#12)는 줄 위치로 보지 않는다
  for (const tail of ["#L10", "#L10-L20", "#L10C5", "#L10C5-L12C8", "#L10-20", ":12-20", ":12", ":12:3"]) assert.equal(trimTail(`a/b.md${tail}`), "a/b.md", tail);
  assert.equal(trimTail("a-12"), "a-12");
  assert.equal(trimTail("a.md#12"), "a.md#12");
  const t0 = Date.now();
  assert.equal(trimTail("x.md" + "#L1".repeat(100_000)), "x.md");
  assert.ok(Date.now() - t0 < 1000);
});

test("candidates: « » 「 」 · 끝 ? ! · 굵게 ** 장식", () => {
  // protects=묶음표 · 굵게 · 끝 문장부호가 이름에서 떨어진다; fails_when=report.pdf?·STATE.md 가 후보에서 빠지면 실패; no_claim=`?` 가 가운데 든 이름은 글롭으로 계속 버린다
  const c = candidates("«report.pdf» 「보고서.pdf」 report.pdf? **STATE.md** notes.md!");
  assert.ok(has(c, "report.pdf", "보고서.pdf", "STATE.md", "notes.md"), c.join("|"));
  assert.ok(!c.some(x => /[*?!«」]/.test(x)));
  assert.deepEqual(candidates("src/*.ts *.test.ts **/a.md a?b.md"), []);
});

test("candidates: URL 은 버리고 file:// 은 남긴다", () => {
  // protects=https://… 가 후보 · 찾기 자리를 먹지 않는다; fails_when=URL 의 .md 가 후보로 나오거나 file:// 이 빠지면 실패; no_claim=URL 안 경로의 파일 여부는 보지 않는다
  assert.deepEqual(candidates("https://example.com/docs/readme.md"), []);
  assert.deepEqual(candidates("see https://example.com/a.pdf and file:///tmp/proj/a.md"), ["/tmp/proj/a.md"]);
});

test("candidates: 코드 확장자는 들어오고 .env 는 빠진다 · 영숫자가 붙으면 경계가 아니다", () => {
  // protects=CODE_EXTS 가 TERM_EXTS 에 들어가고 한 글자 확장자는 c · h 뿐이다; fails_when=src/app.py 가 없거나 .env 가 나오거나 x.config 가 x.conf 로 잘리면 실패; no_claim=목록 전체는 고정하지 않는다
  assert.ok(CODE_EXTS.has("py") && CODE_EXTS.has("ts") && TERM_EXTS.has("sh") && TERM_EXTS.has("py"));
  assert.ok([...CODE_EXTS].every(e => e.length > 1 || e === "c" || e === "h"));
  assert.deepEqual(candidates("src/app.py .env x.config a.class"), ["src/app.py"]);
  assert.deepEqual(candidates("run.sh main.c lib.h"), ["lib.h", "main.c", "run.sh"]);
});

test("candidates: 줄 끝이 평범한 단어면 이은 후보를 만들지 않는다", () => {
  // protects=«다음은» + «docs/a.md» 같은 문장에서 가짜 이음이 안 생긴다; fails_when=guesses 가 비어 있지 않으면 실패; no_claim=문장 끝 `.` 로 끝나는 줄은 이어 본다(추측일 뿐)
  const r = scanText("다음은\n  docs/a.md");
  assert.deepEqual(r.cands, ["docs/a.md"]);
  assert.equal(r.guesses.size, 0);
  // 이미 끝난 이름(확장자로 끝남) 뒤에서는 이어 보지 않는다 — 파일 목록 줄이 서로 붙지 않게
  assert.equal(scanText("src/a.ts\nsrc/b.ts").guesses.size, 0);
});

test("unresolved: skip 에 든 이름(추측)은 찾기 대상에서 빠진다", () => {
  // protects=이은 추측이 SEARCH_SCRIPT 로 가지 않는다; fails_when=skip 이름이 나오거나 skip 이 max 를 먹으면 실패; no_claim=skip 이 없을 때는 기존과 같다
  const out = "?a.md\0?guess/x.md\0?b.md\0";
  assert.deepEqual(unresolved(out), ["a.md", "guess/x.md", "b.md"]);
  assert.deepEqual(unresolved(out, { skip: new Set(["guess/x.md"]) }), ["a.md", "b.md"]);
  assert.deepEqual(unresolved(out, { skip: new Set(["guess/x.md"]), max: 2 }), ["a.md", "b.md"]);
});

test("이은 경로: RESOLVE_SCRIPT 가 임시 폴더에서 직접 푼다", async () => {
  // protects=잘려 이어진 경로가 실제 파일로 풀린다(직접 풀기만); fails_when=이은 후보가 없거나 파일로 안 풀리면 실패; no_claim=찾기(find)는 쓰지 않는다
  const d = await fresh(); await touch(join(d, "docs/notes/long/dir/memo_final.md"));
  const r0 = scanText("⏺ Bash(cat docs/notes/long/dir/mem\n      o_final.md)");
  const r = await sh(RESOLVE_SCRIPT, d, r0.cands);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.paths, [join(d, "docs/notes/long/dir/memo_final.md")]);
});

test("pickRows: 넘치면 문서를 먼저 · 남는 자리에 코드 · 원래 순서", () => {
  // protects=코드 줄이 많아도 오래된 문서 줄이 남는다; fails_when=문서가 밀려나거나 순서가 바뀌면 실패; no_claim=코드끼리는 앞(최근)이 우선이라는 것까지만
  const code = Array.from({ length: 10 }, (_, i) => `/p/c${i}.py`);
  const list = [...code.slice(0, 6), "/p/old1.pdf", ...code.slice(6), "/p/old2.md"];
  const out = pickRows(list, 8);
  assert.equal(out.length, 8);
  assert.ok(out.includes("/p/old1.pdf") && out.includes("/p/old2.md"));
  assert.deepEqual(out, list.filter(p => out.includes(p)));
  assert.equal(pickRows(list, 99), list);
  assert.equal(mergeResolved(list.join("\0"), null, { max: 8 }).length, 8);
});

test("candidates: 상한 — 일반 40 + 코드 20", () => {
  // protects=코드 후보가 일반 후보 자리를 먹지 않고 총 60 을 넘지 않는다; fails_when=코드 20 개 초과 · 일반 40 개 초과 · 일반이 코드에 밀려 줄면 실패; no_claim=기본값의 근거는 시험하지 않는다
  const text = [...Array.from({ length: 50 }, (_, i) => `d${i}.md`), ...Array.from({ length: 50 }, (_, i) => `s${i}.py`)].join("\n");
  const c = candidates(text);
  assert.equal(c.filter(x => x.endsWith(".py")).length, 20);
  assert.equal(c.filter(x => x.endsWith(".md")).length, 40);
  assert.equal(c[0], "s49.py");
});

test("candidates: 글롭의 앞 * 하나는 글롭 · ** 두 개 이상은 굵게", () => {
  // protects=`ls *a.md` 의 글롭이 파일 a.md 로 새지 않는다 · 굵게 장식은 그대로 뗀다; fails_when=단일 * 가 떼져 a.md 가 나오거나 ** 굵게가 안 떼지면 실패; no_claim=뒤쪽 * 짝 맞추기는 하지 않는다(`**src/a.ts changed**` 는 두 토큰)
  assert.deepEqual(candidates("ls *a.md"), []);
  assert.deepEqual(candidates("ls *.ts"), []);
  assert.deepEqual(candidates("ls **/a.md"), []);
  assert.deepEqual(candidates("**a.md**"), ["a.md"]);
  assert.deepEqual(candidates("**src/a.ts changed**"), ["src/a.ts"]);
});

test("scanText: 세 줄 잇기 — 가운데 줄에 뒤 공백 · 상자 가장자리가 있어도", () => {
  // protects=터미널이 줄을 공백으로 채우거나 Gemini 상자선이 붙어도 세 줄 이음이 된다; fails_when=가운데 줄 꾸밈 때문에 이어진 후보가 안 나오면 실패; no_claim=가운데 줄이 토큰 둘 이상이면 잇지 않는다는 점은 별도
  for (const t of ["  docs/very/long/   \n  folder/name/      \n  guide2.md     ", "│ docs/very/long/ │\n│ folder/name/ │\n│ guide2.md │"]) {
    const r = scanText(t);
    assert.ok(r.cands.includes("docs/very/long/folder/name/guide2.md"), t);
    assert.ok(r.guesses.has("docs/very/long/folder/name/guide2.md"), t);
  }
});

test("mergeLight: 새 줄 먼저 · 남는 자리에 옛 줄", () => {
  // protects=가벼운 다시 훑기에서 새 코드 줄이 옛 문서 줄에 밀려나지 않는다; fails_when=새 줄이 빠지거나 중복 · 순서가 틀리면 실패; no_claim=옛 줄끼리의 우선순위는 입력 순서뿐
  const old = Array.from({ length: 12 }, (_, i) => `/p/old${i}.pdf`);
  const fresh = ["/p/new1.ts", "/p/new2.ts"];
  const m = mergeLight(fresh, old, 12);
  assert.equal(m.length, 12);
  assert.deepEqual(m.slice(0, 2), fresh);
  assert.deepEqual(m.slice(2), old.slice(0, 10));
  assert.deepEqual(mergeLight(["/p/a.md", "/p/b.ts"], ["/p/b.ts", "/p/c.md"], 12), ["/p/a.md", "/p/b.ts", "/p/c.md"]);
  assert.deepEqual(mergeLight([], ["/p/x.md"], 12), ["/p/x.md"]);
});

test("endedWorking: 같은 주소에서 working 이 끝났을 때만 true", () => {
  const w = { addr: "t1", status: "working" };
  assert.equal(endedWorking(w, { addr: "t1", status: "idle" }), true);
  assert.equal(endedWorking(w, { addr: "t1", status: null }), true);
  assert.equal(endedWorking(w, { addr: "t1", status: "working" }), false);
  assert.equal(endedWorking(w, { addr: "t2", status: "idle" }), false);
  assert.equal(endedWorking({ addr: "t1", status: "idle" }, { addr: "t1", status: "idle" }), false);
  assert.equal(endedWorking(null, { addr: "t1", status: "idle" }), false);
  assert.equal(endedWorking(w, null), false);
});

test("scanGate: 안 바쁘면 start · 어린 훑기는 light=skip / 전체=again · 30 s 이상이면 abandon", () => {
  const now = 100000;
  assert.equal(scanGate({ busy: false, busyAt: 0, now, light: false }), "start");
  assert.equal(scanGate({ busy: false, busyAt: 0, now, light: true }), "start");
  assert.equal(scanGate({ busy: true, busyAt: now - 1000, now, light: true }), "skip");
  assert.equal(scanGate({ busy: true, busyAt: now - 1000, now, light: false }), "again");
  assert.equal(scanGate({ busy: true, busyAt: now - (TF_STUCK_MS - 1), now, light: false }), "again");
  assert.equal(scanGate({ busy: true, busyAt: now - TF_STUCK_MS, now, light: false }), "abandon", "정확히 stuckMs 에서 버린다");
  assert.equal(scanGate({ busy: true, busyAt: now - TF_STUCK_MS, now, light: true }), "abandon", "가벼운 훑기도 멎음이면 버린다");
  assert.equal(scanGate({ busy: true, busyAt: now - 5, now, light: false, stuckMs: 5 }), "abandon");
  assert.equal(TF_STUCK_MS, 30000);
});

test("scanGate: busyAt 이 숫자가 아니면 abandon(영영 막히지 않게)", () => {
  for (const busyAt of [undefined, null, NaN, Infinity, "x"]) assert.equal(scanGate({ busy: true, busyAt, now: 5, light: false }), "abandon", String(busyAt));
});

test("errClass: 메시지 글은 안 돌려준다 · 시간 초과 · 이름 허용 목록 · 던지는 getter", () => {
  assert.equal(errClass(new Error("cannot read /tmp/work/a.txt")), "Error");
  assert.equal(errClass(new Error("connect to somehost failed")), "Error");
  const te = new TypeError("bad /x/y"); assert.equal(errClass(te), "TypeError");
  assert.equal(errClass(new Error("timed out")), "timeout");
  assert.equal(errClass(new Error("Timeout")), "timeout");
  assert.equal(errClass(new Error("time out after 10s")), "timeout");
  assert.equal(errClass({ name: "Err0r9", message: "x" }), "error");
  assert.equal(errClass({ name: "Bad Name", message: "x" }), "error");
  assert.equal(errClass({ name: "A".repeat(41), message: "x" }), "error");
  assert.equal(errClass({ get message() { throw new Error("boom"); } }), "error");
  assert.equal(errClass({ message: "x", get name() { throw new Error("boom"); } }), "error");
  assert.equal(errClass(null), "error");
  assert.equal(errClass(undefined), "error");
});

test("stuckAfter: 연속 버림마다 두 배 · 480 s 상한 · 이상한 값은 base", () => {
  assert.equal(stuckAfter(0), 30000);
  assert.equal(stuckAfter(1), 60000);
  assert.equal(stuckAfter(2), 120000);
  assert.equal(stuckAfter(3), 240000);
  assert.equal(stuckAfter(4), 480000);
  assert.equal(stuckAfter(9), 480000);
  for (const r of [-1, NaN, undefined, Infinity]) assert.equal(stuckAfter(r), 30000, String(r));
  assert.equal(stuckAfter(2, 1000), 4000);
});

test("termKey: 없으면 빈 문자열 · addr|on|cwd|status 순서로 잇는다", () => {
  assert.equal(termKey(null), "");
  assert.equal(termKey(undefined), "");
  assert.equal(termKey({ addr: "t1", on: "m1", cwd: "/w", status: "idle" }), "t1|m1|/w|idle");
  assert.equal(termKey({ addr: "t1", on: null, cwd: "/w", status: "working" }), "t1|null|/w|working");
});

test("noteWrite: 처음 · 분류 바뀜은 바로 · 개수만 바뀌면 minGap 뒤 · 같으면 안 씀", () => {
  const a = { phase: "ok", kind: "full", cands: 3, found: 2, shown: 2 };
  assert.equal(noteWrite(null, a, 1000, 0), true);
  assert.equal(noteWrite(undefined, a, 1000, 0), true);
  assert.equal(noteWrite(a, { ...a, phase: "read-failed" }, 1001, 1000), true);
  assert.equal(noteWrite(a, { ...a, cands: 4, found: 3 }, 5000, 1000), false);
  assert.equal(noteWrite(a, { ...a, cands: 4 }, 16000, 1000), true);
  assert.equal(noteWrite(a, { ...a, cands: 4 }, 15999, 1000), false);
  assert.equal(noteWrite(a, { ...a }, 99999, 1000), false);
  assert.equal(noteWrite(a, { ...a, abandons: 1 }, 1001, 1000), true);
  assert.equal(noteWrite(a, { ...a, shown: 0 }, NaN, 1000), true);
  assert.equal(noteWrite(a, { ...a, found: 9 }, 5000, 1000, 1000), true);
  // 개수가 0 이 되거나 0 에서 벗어나면 minGap 안이어도 바로 · 크기만 바뀌면 그대로 느림
  assert.equal(noteWrite(a, { ...a, shown: 0 }, 2000, 1000), true);
  assert.equal(noteWrite({ ...a, found: 0 }, { ...a, found: 2 }, 2000, 1000), true);
  assert.equal(noteWrite(a, { ...a, cands: 4 }, 2000, 1000), false);
  assert.equal(noteWrite({ ...a, cands: 1 }, { ...a, cands: 2 }, 2000, 1000), false);
});

// ── 더블클릭 열기: cellWidth · selSpan · dcStep · dcPick (순수 · 합성 경로만) ──
const cell = (row, col) => ({ row, col });
const S = (r1, c1, r2, c2) => ({ start: cell(r1, c1), end: cell(r2, c2) });

test("cellWidth: 영문 1 · 한글/CJK/전각 2 · 결합 문자 0 · 빈 값 0", () => {
  assert.equal(cellWidth("abc"), 3);
  assert.equal(cellWidth("보고서"), 6);
  assert.equal(cellWidth("a.txt"), 5);
  assert.equal(cellWidth("報告"), 4);
  assert.equal(cellWidth("ＡＢ"), 4);
  assert.equal(cellWidth("e\u0301"), 1);
  assert.equal(cellWidth("/tmp/보고서.pdf"), 5 + 6 + 4);
  assert.equal(cellWidth(""), 0);
  assert.equal(cellWidth(null), 0);
});

test("selSpan: 한 줄 · 거꾸로 순서 · 줄 이어짐(cols) · maxRows · 전체 선택 · 나쁜 cols · 나쁜 모양", () => {
  assert.equal(selSpan(S(5, 3, 5, 7), 80), 5);
  assert.equal(selSpan(S(5, 7, 5, 3), 80), 5);                  // 끝이 앞 — 순서를 바로잡는다
  assert.equal(selSpan(S(5, 70, 6, 4), 80), 10 + 5);            // (80-70) + 0 + 4+1
  assert.equal(selSpan(S(6, 4, 5, 70), 80), 15);
  assert.equal(selSpan(S(5, 70, 7, 4), 80), 10 + 80 + 5);
  assert.equal(selSpan(S(5, 70, 8, 4), 80), null);              // 4 줄 > maxRows 3
  assert.equal(selSpan(S(5, 70, 8, 4), 80, { maxRows: 4 }), 10 + 160 + 5);
  assert.equal(selSpan(S(0, 0, 40, 12), 80), null);             // Cmd+A
  assert.equal(selSpan(S(0, 0, 0, 9), 80), 10);                 // 한 줄 0,0 은 전체 선택이 아니다
  for (const c of [0, -1, 1.5, NaN, "80", null, undefined]) assert.equal(selSpan(S(1, 1, 1, 2), c), null, String(c));
  assert.equal(selSpan(null, 80), null);
  assert.equal(selSpan({ start: cell(1, 1) }, 80), null);
  assert.equal(selSpan(S(1, -1, 1, 2), 80), null);
  assert.equal(selSpan(S(1, 1, 1, 80), 80), null);              // 칸이 cols 밖
});

test("dcStep: 처음 · 주소 바뀜은 기준선만 — 있던 선택은 새 것이 아니다", () => {
  const sel = S(3, 0, 3, 5);
  let r = dcStep(null, { addr: "a", sel, now: 0 });
  assert.equal(r.fire, false);
  r = dcStep(r.state, { addr: "a", sel, now: 5000 });
  assert.equal(r.fire, false, "처음 본 선택은 오래 머물러도 안 연다");
  r = dcStep(r.state, { addr: "b", sel: S(1, 1, 1, 4), now: 6000 });
  assert.equal(r.fire, false);
  r = dcStep(r.state, { addr: "b", sel: S(1, 1, 1, 4), now: 9000 });
  assert.equal(r.fire, false, "주소가 바뀐 터미널에 이미 있던 선택");
});

test("dcStep: 새 선택은 settleMs 머문 뒤 한 번만 · 바뀌면 시계 다시 · null 뒤 같은 선택은 다시", () => {
  const sel = S(3, 0, 3, 5);
  let r = dcStep(null, { addr: "a", sel: null, now: 0 });
  r = dcStep(r.state, { addr: "a", sel, now: 100 });
  assert.equal(r.fire, false);
  r = dcStep(r.state, { addr: "a", sel, now: 499 });
  assert.equal(r.fire, false, "399 ms");
  r = dcStep(r.state, { addr: "a", sel, now: 500 });
  assert.equal(r.fire, true);
  r = dcStep(r.state, { addr: "a", sel, now: 900 });
  assert.equal(r.fire, false, "같은 선택은 두 번 안 연다");
  r = dcStep(r.state, { addr: "a", sel, now: 9999 });
  assert.equal(r.fire, false);
  r = dcStep(r.state, { addr: "a", sel: null, now: 10000 });
  assert.equal(r.fire, false);
  r = dcStep(r.state, { addr: "a", sel, now: 10100 });
  assert.equal(r.fire, false);
  r = dcStep(r.state, { addr: "a", sel, now: 10500 });
  assert.equal(r.fire, true, "null 로 지운 뒤 같은 낱말을 다시");
  // 변하면 시계가 다시 시작
  r = dcStep(null, { addr: "a", sel: null, now: 0 });
  r = dcStep(r.state, { addr: "a", sel: S(1, 0, 1, 3), now: 100 });
  r = dcStep(r.state, { addr: "a", sel: S(1, 0, 1, 4), now: 450 });
  r = dcStep(r.state, { addr: "a", sel: S(1, 0, 1, 4), now: 800 });
  assert.equal(r.fire, false, "450 에 바뀌어 350 ms 만 머묾");
  r = dcStep(r.state, { addr: "a", sel: S(1, 0, 1, 4), now: 850 });
  assert.equal(r.fire, true);
  // 설정값 settleMs
  r = dcStep(null, { addr: "a", sel: null, now: 0 }, { settleMs: 50 });
  r = dcStep(r.state, { addr: "a", sel: S(1, 0, 1, 4), now: 10 }, { settleMs: 50 });
  r = dcStep(r.state, { addr: "a", sel: S(1, 0, 1, 4), now: 60 }, { settleMs: 50 });
  assert.equal(r.fire, true);
});

test("dcStep: 끌기 흐름은 끝 값이 늘다가 멈춘 뒤 한 번만 fire", () => {
  let r = dcStep(null, { addr: "a", sel: null, now: 0 });
  let fires = 0, now = 0;
  for (let c = 0; c < 12; c++) { now += 100; r = dcStep(r.state, { addr: "a", sel: S(2, 0, 2, c), now }); if (r.fire) fires++; }
  assert.equal(fires, 0, "끄는 동안");
  for (let i = 0; i < 20; i++) { now += 100; r = dcStep(r.state, { addr: "a", sel: S(2, 0, 2, 11), now }); if (r.fire) fires++; }
  assert.equal(fires, 1);
});

// 한 줄 선택: row 의 col0 에서 시작해 글의 칸 수만큼.
const one = (row, col0, str) => S(row, col0, row, col0 + cellWidth(str) - 1);
const TXT = "ls\n  /w/proj/보고서.pdf\nsee /w/proj/src/a.ts:42 now\n";

test("dcPick: 터미널 글자에 있는 경로 → 그 경로 · 한글 이름 · 끝 개행", () => {
  const k = "/w/proj/보고서.pdf";
  assert.equal(dcPick({ clip: k, sel: one(1, 2, k), cols: 80, text: TXT }), k);
  assert.equal(dcPick({ clip: k + "\n", sel: one(1, 2, k), cols: 80, text: TXT }), k);
  assert.equal(dcPick({ clip: k + "\r\n", sel: one(1, 2, k), cols: 80, text: TXT }), k);
  assert.equal(dcPick({ clip: k + "\n\n", sel: one(1, 2, k), cols: 80, text: TXT }), null, "개행은 하나만 뗀다");
});

test("dcPick: 터미널에는 a.ts:42 · 선택한 낱말은 :줄 없이", () => {
  const a = "/w/proj/src/a.ts";
  assert.equal(dcPick({ clip: a, sel: one(2, 4, a), cols: 80, text: TXT }), a);
});

test("dcPick: 여러 줄 선택 — 클립보드에 낀 개행을 뺀다(터미널 글자에는 이어진 한 글)", () => {
  const long = "/w/proj/" + "d".repeat(70) + "/x.txt";                  // 84 칸
  const text = `echo\n${long}\n`;
  const sel = S(4, 4, 5, 7);                                            // 76 + 8 = 84
  assert.equal(selSpan(sel, 80), 84);
  assert.equal(dcPick({ clip: long.slice(0, 76) + "\n" + long.slice(76), sel, cols: 80, text }), long);
  assert.equal(dcPick({ clip: long.slice(0, 76) + "\r\n" + long.slice(76) + "\n", sel, cols: 80, text }), long);
  assert.equal(dcPick({ clip: long, sel, cols: 80, text }), long, "개행 없이 와도 같다");
});

test("dcPick: 칸 수가 안 맞으면 null(낡은 클립보드 · 와이드 글자 줄바꿈 어긋남)", () => {
  const k = "/w/proj/보고서.pdf";
  assert.equal(dcPick({ clip: k, sel: S(1, 2, 1, 2 + k.length - 1), cols: 80, text: TXT }), null, "글자 수로 세면 어긋난다");
  assert.equal(dcPick({ clip: k, sel: one(1, 2, k), cols: 0, text: TXT }), null);
  assert.equal(dcPick({ clip: k, sel: null, cols: 80, text: TXT }), null);
  assert.equal(dcPick({ clip: k, sel: S(0, 0, 9, 3), cols: 80, text: TXT }), null, "전체 선택");
});

test("dcPick: 터미널에 없는 경로 · 비밀번호 같은 글 · 낱말이 둘 · 너무 긴 글 → null", () => {
  const stale = "/w/other/secret.pdf";                                   // 클립보드에만 있는 경로
  assert.equal(dcPick({ clip: stale, sel: one(1, 2, stale), cols: 80, text: TXT }), null);
  const pw = "hunter2-Xk9!pass";
  assert.equal(dcPick({ clip: pw, sel: one(1, 2, pw), cols: 80, text: TXT + pw }), null, "후보가 아니다");
  const pw2 = "p4ss.txt";                                               // 파일 이름처럼 보여도 터미널에 없으면 null
  assert.equal(dcPick({ clip: pw2, sel: one(1, 2, pw2), cols: 80, text: TXT }), null);
  const two = "/w/a.pdf /w/b.pdf";
  assert.equal(dcPick({ clip: two, sel: one(1, 2, two), cols: 80, text: `${two}\n` }), null, "후보가 둘");
  assert.equal(dcPick({ clip: "", sel: S(1, 2, 1, 2), cols: 80, text: TXT }), null);
  assert.equal(dcPick({ clip: "\n", sel: S(1, 2, 1, 2), cols: 80, text: TXT }), null);
  assert.equal(dcPick({ clip: null, sel: S(1, 2, 1, 2), cols: 80, text: TXT }), null);
  const big = "/" + "z".repeat(1100) + ".txt";
  assert.equal(dcPick({ clip: big, sel: S(0, 0, 2, 79), cols: 80, text: big }), null);
});

test("selSpan: 0,0 에서 시작하는 여러 줄은 null(전체 선택 의심) · 1 열 시작은 계산", () => {
  assert.equal(selSpan(S(0, 0, 1, 5), 80), null);
  assert.equal(selSpan(S(0, 0, 2, 5), 80), null);
  assert.equal(selSpan(S(0, 1, 1, 5), 80), 85);                 // (80-1) + 5 + 1
});

test("dcPick: 긴 목록 — 20 번째보다 오래된 코드 파일도 터미널 사본으로 찾는다", () => {
  const text = Array.from({ length: 30 }, (_, i) => `edited /w/proj/f${String(i).padStart(2, "0")}.ts`).join("\n") + "\n";
  const p = "/w/proj/f00.ts";
  assert.equal(dcPick({ clip: p, sel: one(0, 7, p), cols: 80, text }), p);
  assert.ok(!scanText(text).cands.includes(p), "기본 상한이면 빠지는 자리");
});

test("cellWidth · dcPick: 한글 NFD(자모 분해)도 NFC 와 같은 칸 수", () => {
  const k = "/w/proj/" + "한글.md".normalize("NFD");
  assert.equal(cellWidth(k), 8 + 4 + 3);
  assert.equal(cellWidth("한글".normalize("NFD")), cellWidth("한글"));
  assert.equal(dcPick({ clip: k, sel: one(1, 2, k), cols: 80, text: `ls\n  ${k}\n` }), k);
});

test("dcPick: 문장 끝 장식(`.`)이 붙은 한 경로는 열고 · 공백이 든 선택은 안 연다", () => {
  const text = "Created docs/plan.md.\n";
  assert.equal(dcPick({ clip: "docs/plan.md.", sel: S(0, 8, 0, 20), cols: 80, text }), "docs/plan.md");
  assert.equal(selSpan(S(0, 8, 0, 20), 80), 13);
  const sp = "see docs/plan.md";
  assert.equal(dcPick({ clip: sp, sel: one(0, 0, sp), cols: 80, text: "see docs/plan.md\n" }), null);
});

const S_KEY = selKey(S(1, 0, 1, 4));
test("dcStep: 주소 바뀜 + prevKey 가 null(앞 틱엔 선택 없음) + 선택 있음 → 첫 틱 fire 없음 · settleMs 뒤 한 번", () => {
  let r = dcStep({ addr: "a", key: null, since: 0, fired: false }, { addr: "b", sel: S(1, 0, 1, 4), now: 100, prevKey: null });
  assert.equal(r.fire, false, "첫 틱");
  assert.equal(r.state.fired, false);
  r = dcStep(r.state, { addr: "b", sel: S(1, 0, 1, 4), now: 300, prevKey: S_KEY });
  assert.equal(r.fire, false, "200 ms 만 머묾");
  r = dcStep(r.state, { addr: "b", sel: S(1, 0, 1, 4), now: 500, prevKey: S_KEY });
  assert.equal(r.fire, true, "400 ms 머묾");
  r = dcStep(r.state, { addr: "b", sel: S(1, 0, 1, 4), now: 900, prevKey: S_KEY });
  assert.equal(r.fire, false, "한 번뿐");
});

test("dcStep: 주소 바뀜 + prevKey 가 지금 key 와 같음(키보드 포커스 이동 · 원래 있던 선택) → fire 없음", () => {
  let r = dcStep({ addr: "a", key: null, since: 0, fired: false }, { addr: "b", sel: S(1, 0, 1, 4), now: 100, prevKey: S_KEY });
  assert.equal(r.state.fired, true);
  for (const now of [500, 900, 1500]) { r = dcStep(r.state, { addr: "b", sel: S(1, 0, 1, 4), now, prevKey: S_KEY }); assert.equal(r.fire, false); }
});

test("dcStep: 주소 바뀜 + prevKey undefined(모름) → 옛 동작(기준선 · fire 없음)", () => {
  let r = dcStep({ addr: "a", key: null, since: 0, fired: false }, { addr: "b", sel: S(1, 0, 1, 4), now: 100 });
  assert.equal(r.state.fired, true);
  for (const now of [500, 900]) { r = dcStep(r.state, { addr: "b", sel: S(1, 0, 1, 4), now }); assert.equal(r.fire, false); }
});

test("dcPick: 이름이 더 이어지면(allowlist 밖) null — data.jsonl 이 data.json 으로 열리지 않는다", () => {
  for (const [name, short] of [["data.jsonl", "data.json"], ["notes.mdx", "notes.md"], ["a.json5", "a.json"], ["a.md.bak", "a.md"], ["x.json.gz", "x.json"]]) {
    const text = `ls\n${short}\n${name}\n`;                                // 짧은 이름도 터미널에 있다 — 회귀가 보이게
    assert.equal(dcPick({ clip: name, sel: one(2, 0, name), cols: 80, text }), null, name);
  }
});

test("dcPick: 장식은 허용 — 앞 ** · 뒤 #L12 · 끝 .", () => {
  const b = "**docs/plan.md**";
  assert.equal(dcPick({ clip: b, sel: one(1, 0, b), cols: 80, text: `x\n${b}\n` }), "docs/plan.md");
  const l = "/w/a.md#L12";
  assert.equal(dcPick({ clip: l, sel: one(1, 0, l), cols: 80, text: `x\n${l}\n` }), "/w/a.md");
  const d = "docs/plan.md.";
  assert.equal(dcPick({ clip: d, sel: one(1, 0, d), cols: 80, text: `x\n${d}\n` }), "docs/plan.md");
});

// protects=이름 뒤에 붙은 한글·일본어 조사와 CJK 괄호·줄 꼬리(#L12C3)가 장식으로 떼어져 그 이름이 열린다; fails_when=allowlist 가 조사·「」·C열을 거부해 null 이 되면 실패; no_claim=조사가 어떤 단어인지·문법은 안 본다
test("dcPick: 붙은 조사 · CJK 괄호 · #L12C3 은 허용 — 이름만 연다", () => {
  const cases = [["docs/plan.md를", "docs/plan.md"], ["보고서.pdf를", "보고서.pdf"], ["report.md에서", "report.md"], ["note.mdを", "note.md"], ["config.yamlを更新し", "config.yaml"],
    ["「보고서.pdf」", "보고서.pdf"], ["a.md#L12C3", "a.md"], ["a.md#L1C2-L3C4", "a.md"], ["docs/plan.md를".normalize("NFD"), "docs/plan.md"]];
  for (const [clip, want] of cases) {
    const text = `x\n${clip}\n${want}\n`;
    assert.equal(dcPick({ clip, sel: one(1, 0, clip), cols: 80, text }), want, clip);
  }
});

// protects=이름이 라틴 글자·숫자·확장자·결합 부호로 이어지면 다른 파일이라 안 연다; fails_when=조사 허용이 넓어져 data.jsonl 이 data.json 으로 열리면 실패; no_claim=그 밖의 문자(키릴 등) 처리는 보장 안 함
test("dcPick: 조사 허용에도 data.jsonl · notes.mdx · a.md.bak · x.json.gz · 결합 부호는 null", () => {
  for (const [clip, short] of [["data.jsonl를", "data.json"], ["data.jsonl", "data.json"], ["notes.mdx", "notes.md"], ["a.md.bak", "a.md"], ["x.json.gz", "x.json"], ["a.md\u0301", "a.md"]]) {
    const text = `x\n${short}\n${clip}\n`;
    assert.equal(dcPick({ clip, sel: one(2, 0, clip), cols: 80, text }), null, clip);
  }
});

// protects=한글·가나 한 글자 뒤에 아무 글이나 붙어도 짧은 이름이 열리던 구멍(data.json백업.gz → data.json)이 막혀 null; fails_when=꼬리가 [\s\S] 처럼 넓어지거나 한자 시작을 받으면 실패; no_claim=꼬리 안 한글·한자 단어의 뜻은 안 본다
test("dcPick: 한글·가나 뒤에 다른 이름 조각이 이어지면 짧은 이름도 안 연다(null)", () => {
  const cases = [["data.json백업.gz", "data.json"], ["plan.md를.bak", "plan.md"], ["a.md를.json.gz", "a.md"], ["/tmp/a.md를/b", "/tmp/a.md"],
    ["a.md를=b", "a.md"], ["a.md를\u0301", "a.md"], ["a.md를\u202E", "a.md"], ["data.csv备份", "data.csv"]];
  for (const [clip, short] of cases) {
    const text = `x\n${short}\n${clip}\n`;                                // 짧은 이름도 터미널에 있다 — 잘못 열리면 보인다
    assert.equal(dcPick({ clip, sel: one(2, 0, clip), cols: 80, text }), null, clip);
  }
});

// protects=조사 뒤에 허용 밖 글자가 하나라도 오면 어떤 조사든 null; fails_when=꼬리에 ASCII·`/`·`=`·`-`·`_`·`~`·결합/제어/제로폭 문자가 새면 실패; no_claim=표의 글자 밖 문자는 보장 안 함
test("dcPick: 조사(를·에서·を) × 금지 글자 표 — 모두 null", () => {
  for (const p of ["를", "에서", "を"]) {
    for (const c of ["b", "2", "/", "=", "-", "_", "~", "\u0301", "\u202E", "\u200B"]) {
      const clip = `docs/plan.md${p}${c}x`;
      const text = `x\ndocs/plan.md\n${clip}\n`;
      assert.equal(dcPick({ clip, sel: one(2, 0, clip), cols: 80, text }), null, JSON.stringify(clip));
    }
  }
});

// protects=DC_POST · DC_LETTER · DC_HEAD 의 한글·가나·한자 범위가 \uXXXX 로만 적혀 있다(보이지 않는 글자가 소스에 글자 그대로 숨지 않게); fails_when=그 세 줄에 해당 범위의 글자가 그대로 있으면 실패; no_claim=정규식 의미는 안 본다
test("termfiles.js: DC_POST · DC_LETTER · DC_HEAD 소스에 한글·가나·한자 글자가 그대로 없다", async () => {
  const src = await readFile(new URL("../files-plus/termfiles.js", import.meta.url), "utf8");
  const lines = src.split("\n").filter(l => /^const DC_(POST|LETTER|HEAD) /.test(l));
  assert.equal(lines.length, 3);
  for (const l of lines) for (const ch of l) {
    const c = ch.codePointAt(0);
    assert.ok(!((c >= 0x1100 && c <= 0x11ff) || (c >= 0x3040 && c <= 0x30ff) || (c >= 0x3130 && c <= 0x318f) || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7ff)), `글자 그대로: U+${c.toString(16)} in ${l.slice(0, 20)}`);
  }
});

// protects=보이지 않는 한글 채움 문자(U+115F · 1160 · 3164 · FFA0)가 이름 뒤 첫 꼬리 자리에도 뒤쪽 꼬리 자리에도 새지 못한다(공백처럼 보이는 선택이 열리던 구멍); fails_when=시작/꼬리 부류가 채움 문자를 받으면 실패; no_claim=표의 글자 밖 보이지 않는 글자는 보장 안 함
test("dcPick: 보이지 않는 한글 채움 문자 × 첫 꼬리 · 뒤 꼬리 — 모두 null", () => {
  for (const f of ["ᅟ", "ᅠ", "ㅤ", "ﾠ"]) {
    for (const clip of [`a.md${f}사본`, `a.md사${f}본`, `docs/plan.md를${f}x`, `a.md${f}`]) {
      const text = `x\na.md\ndocs/plan.md\n${clip}\n`;
      assert.equal(dcPick({ clip, sel: one(3, 0, clip), cols: 80, text }), null, JSON.stringify(clip));
    }
  }
  // 허용은 그대로: NFD 가나 · NFD 한글 · 자모 이음(U+1161–11FF) · 줄 꼬리
  for (const [clip, want] of [["デ.pdfを".normalize("NFD"), "デ.pdf".normalize("NFD")], ["docs/plan.md를".normalize("NFD"), "docs/plan.md"], ["a.md#L12C3", "a.md"], ["a.mdあ゙", "a.md"]]) {
    const text = `x\n${want}\n${clip}\n`;
    assert.equal(dcPick({ clip, sel: one(2, 0, clip), cols: 80, text }), want, JSON.stringify(clip));
  }
});

// protects=İ(U+0130 · 소문자화하면 두 글자)가 있어도 확장자 경계 인덱스가 어긋나 조각이 후보가 되지 않는다; fails_when=toLowerCase() 처럼 길이가 바뀌는 접기를 쓰면 실패; no_claim=그 밖 유니코드 대소문자 접기는 안 한다(확장자는 ASCII)
test("scanText: İ 가 든 토큰도 경계가 어긋나지 않는다 · 대문자 ASCII 확장자는 그대로", () => {
  assert.deepEqual(scanText("AİB.docx/x.md").cands, ["AİB.docx/x.md"]);
  assert.deepEqual(scanText("İ.md.md").cands, ["İ.md.md"]);
  assert.deepEqual(scanText("İa.md-를").cands, [], "확장자 뒤 `-` 는 경계가 아니다 — 조각(`İa.md-`)도 후보가 아니다");
  assert.deepEqual(scanText("A.PDF").cands, ["A.PDF"]);
  assert.deepEqual(scanText("Report.MD").cands, ["Report.MD"]);
  const clip = "İa.md-를", text = `x\n${clip}\n`;
  assert.equal(dcPick({ clip, sel: one(1, 0, clip), cols: 80, text }), null, "진짜 후보가 아닌 조각은 돌려주지 않는다");
});

// ── «더 긴 이름» 거부(dcLonger · dcChoose) ──
// 터미널 글자 text 와 한 줄 선택 clip 으로 dcPick → dcLonger → 진짜 sh(RESOLVE_SCRIPT) → dcChoose. 임시 폴더만 쓴다.
async function dcRun(dir, clip, text, row = 0) {
  const sel = one(row, 0, clip), cand = dcPick({ clip, sel, cols: 80, text });
  if (cand === null) return { cand, longer: [], got: null };
  const longer = dcLonger({ clip, sel, text, cand });
  const r = await sh(RESOLVE_SCRIPT, dir, [cand, ...longer]);
  return { cand, longer, got: dcChoose(r.raw, cand, longer) };
}

test("dcChoose: 순수 — 더 긴 이름 레코드가 있으면 null · cand 하나면 그 경로 · 둘이면 null · 더 긴 파일만 있어도 null", () => {
  const rec = (...p) => p.join("\0") + "\0";
  assert.equal(dcChoose(rec("/w/a.md"), "a.md", ["a.md.bak"]), "/w/a.md");
  assert.equal(dcChoose(rec("/w/a.md", "/w/a.md.bak"), "a.md", ["a.md.bak"]), null);
  assert.equal(dcChoose(rec("/w/a.md.bak"), "a.md", ["a.md.bak"]), null, "더 긴 파일만 있으면 연다 안 한다");
  assert.equal(dcChoose(rec("?a.md", "?a.md.bak"), "a.md", ["a.md.bak"]), null);
  assert.equal(dcChoose(rec("/w/a.md", "/w/b/a.md"), "a.md", []), null, "같은 이름 둘");
  assert.equal(dcChoose(rec("/w/docs/plan.md"), "docs/plan.md", ["docs/plan.md를"]), "/w/docs/plan.md");
  assert.equal(dcChoose("", "a.md", []), null);
  assert.equal(dcChoose(rec("/w/a.md"), "", []), null);
});

test("줄 끝 이름 + 다음 줄 머리 `.bak`: a.md.bak 이 있으면 아무것도 안 연다 · 없으면 a.md", async () => {
  const text = "x\nsee a.md\n  .bak next\n";
  const d = await fresh();
  await touch(join(d, "a.md"));
  assert.equal((await dcRun(d, "a.md", text, 1)).got, join(d, "a.md"), "a.md.bak 없음");
  await touch(join(d, "a.md.bak"));
  const r = await dcRun(d, "a.md", text, 1);
  assert.deepEqual(r.longer, ["a.md.bak"]);
  assert.equal(r.got, null, "a.md.bak 이 있다");
  const d2 = await fresh();
  await touch(join(d2, "a.md.bak"));
  assert.equal((await dcRun(d2, "a.md", text, 1)).got, null, "더 긴 파일만 있어도 열지 않는다");
  // [의도적 반전] 예전엔 data.json / l 이 `data.jsonl` 탐침을 내 null 이었다 → 이제 짧은 소문자 머리는 탐침 없음: 이름이 확장자 안에서 갈린 경우는 확인하지 않아 data.json 이 열린다(알려진 한계)
  const d3 = await fresh();
  await touch(join(d3, "data.json")); await touch(join(d3, "data.jsonl"));
  const rl = await dcRun(d3, "data.json", "x\ndata.json\nl\n", 1);
  assert.deepEqual(rl.longer, []); assert.equal(rl.got, join(d3, "data.json"));
  // 다른 모양: plan.md를 / .bak
  await touch(join(d3, "plan.md")); await touch(join(d3, "plan.md를.bak"));
  assert.equal((await dcRun(d3, "plan.md를", "x\nplan.md를\n.bak\n", 1)).got, null);
});

test("ls -1 목록: a.md / b.md / c.md 모두 있어도 각자 자기 파일 · 거부 없음", async () => {
  const d = await fresh();
  for (const n of ["a.md", "b.md", "c.md"]) await touch(join(d, n));
  const text = "ls -1\na.md\nb.md\nc.md\n";
  for (const [i, n] of ["a.md", "b.md", "c.md"].entries()) assert.equal((await dcRun(d, n, text, i + 1)).got, join(d, n), n);
});

test("붙은 꼬리: 보고서.pdf사본 · data.csvの备份 — 긴 파일이 있으면 null · 없으면 짧은 파일 · 접두 탐침", async () => {
  for (const [short, tail] of [["보고서.pdf", "사본"], ["data.csv", "の备份"]]) {
    const clip = short + tail, text = `x\n${clip}\n`;
    const both = await fresh();
    await touch(join(both, short)); await touch(join(both, clip));
    assert.equal((await dcRun(both, clip, text, 1)).got, null, `${clip} 도 있다`);
    const only = await fresh();
    await touch(join(only, short));
    assert.equal((await dcRun(only, clip, text, 1)).got, join(only, short), `${short} 만 있다`);
    const longOnly = await fresh();
    await touch(join(longOnly, clip));
    assert.equal((await dcRun(longOnly, clip, text, 1)).got, null, "짧은 파일이 없다");
  }
  const d = await fresh();
  await touch(join(d, "보고서.pdf")); await touch(join(d, "보고서.pdf사본"));
  const clip = "보고서.pdf사본을";
  assert.equal((await dcRun(d, clip, `x\n${clip}\n`, 1)).got, null, "접두 탐침(보고서.pdf사본)");
  const d2 = await fresh();
  await touch(join(d2, "docs/plan.md"));
  assert.equal((await dcRun(d2, "docs/plan.md를", "x\ndocs/plan.md를\n", 1)).got, join(d2, "docs/plan.md"), "plan.md를 파일은 없다");
  // [의도적 반전] 예전엔 text 에 `cand + 글자줄` 이 없으면 짧은 파일을 열었다(fail-open) → 이제 한 줄 선택에서 꼬리를 확인 못 하면 아무것도 안 연다(fail-closed)
  const d3 = await fresh();
  await touch(join(d3, "a.md")); await touch(join(d3, "a.md를사본"));
  const c3 = "a.md를사본", t3 = "x\na.md를\n";
  assert.deepEqual(dcLonger({ clip: c3, sel: one(1, 0, c3), text: t3, cand: "a.md" }), []);
  assert.equal((await dcRun(d3, c3, t3, 1)).cand, null, "한 줄 선택 · 꼬리가 text 에 없음 → 아무것도 안 연다");
  assert.equal((await dcRun(d3, c3, t3, 1)).got, null);
});

test("dcPick fail-closed: 한 줄 선택 꼬리가 text 에 없으면 null · 있으면 열림 · 여러 줄 선택은 그대로", () => {
  const clip = "docs/plan.md를";
  assert.equal(dcPick({ clip, sel: one(1, 0, clip), cols: 80, text: "x\ndocs/plan.md를\n" }), "docs/plan.md");
  assert.equal(dcPick({ clip, sel: one(1, 0, clip), cols: 80, text: "x\ndocs/plan.md\n" }), null, "꼬리 없음");
  assert.equal(dcPick({ clip, sel: one(1, 0, clip), cols: 80, text: "x\ndocs/plan.md" + "\u1105\u1175\u11AF\n" }), null, "NFC 클립보드 · NFD 터미널");
  assert.equal(dcPick({ clip: "a.md", sel: one(1, 0, "a.md"), cols: 80, text: "x\na.md\n" }), "a.md", "꼬리 없는 선택은 영향 없음");
  // 여러 줄(줄바뀜) 선택: 꼬리를 text 에서 못 찾아도 예전처럼 연다(이어진 한 글이라 꼬리 위치를 신뢰 못 함)
  const base = "/w/proj/" + "d".repeat(70) + "/x.txt", sel = S(4, 4, 5, 9);   // 76 + 10 = 86 칸 = base(84) + 를(2)
  assert.equal(selSpan(sel, 80), 86);
  assert.equal(dcPick({ clip: base.slice(0, 76) + "\n" + base.slice(76) + "를", sel, cols: 80, text: `echo\n${base}\n` }), base);
});

test("줄바꿈 탐침: Gemini 상자(│ a.md │ / │ .bak │) · Claude 들여쓰기 이음", () => {
  const box = "x\n│ see a.md │\n│ .bak       │\n";
  assert.deepEqual(dcLonger({ clip: "a.md", sel: one(1, 0, "a.md"), text: box, cand: "a.md" }), ["a.md.bak"]);
  const indent = "x\n  see a.md\n    .bak\n";
  assert.deepEqual(dcLonger({ clip: "a.md", sel: one(1, 0, "a.md"), text: indent, cand: "a.md" }), ["a.md.bak"]);
  const tail = "x\n  docs/plan.md를\n    .bak\n";
  assert.ok(dcLonger({ clip: "docs/plan.md", sel: one(1, 0, "docs/plan.md"), text: tail, cand: "docs/plan.md" }).includes("docs/plan.md를.bak"));
});

test("dcLonger: 탐침은 text 조각 + cand 로만 · 클립보드의 비밀 글은 어디에도 없다", () => {
  const secret = "hunter2-S3cr3t";
  const clip = "a.md를사본", cand = "a.md", text = `x\n${cand}를사본\n  .bak\nsee a.md\n .zip\n`;
  const out = dcLonger({ clip, sel: one(1, 0, clip), text, cand });
  assert.deepEqual([...out].sort(), ["a.md.zip", "a.md를", "a.md를사", "a.md를사본", "a.md를사본.bak"].sort());
  for (const p of out) {
    assert.ok(p.startsWith(cand) && p !== cand && !p.includes(secret), p);
    assert.ok([...Array(p.length - cand.length + 1).keys()].some(i => { const j = cand.length + i; return text.includes(p.slice(0, j)) && (j === p.length || text.includes(p.slice(j))); }), `text 조각 둘 이하로 안 만들어짐: ${p}`);
  }
  // 클립보드가 비밀이면 dcLonger 는 꼬리 탐침을 내지 않고(줄바꿈 탐침만) 비밀은 어디에도 나오지 않는다
  const sc = dcLonger({ clip: secret, sel: one(1, 0, secret), text, cand });
  assert.deepEqual([...sc].sort(), ["a.md.zip", "a.md를사본.bak"]);
  assert.ok(sc.every(p => !p.includes(secret)));
  for (const bad of [null, undefined, 3]) assert.deepEqual(dcLonger({ clip: bad, sel: null, text, cand }).sort(), ["a.md.zip", "a.md를사본.bak"]);
  assert.deepEqual(dcLonger({ clip: "a.md", sel: one(0, 0, "a.md"), text: null, cand }), []);
  assert.deepEqual(dcLonger({ clip: "a.md", sel: one(0, 0, "a.md"), text, cand: "" }), []);
});

test("dcLonger: 상한 · 같은 이름 다른 폴더 줄 · 제어문자", () => {
  const rep = Array.from({ length: 300 }, (_, i) => `a.md\n.s${i}`).join("\n");
  const out = dcLonger({ clip: "a.md", sel: one(0, 0, "a.md"), text: rep, cand: "a.md" });
  assert.equal(out.length, 4, `wrap 은 최대 4 개: ${out.length}`);
  const big = Array.from({ length: 300 }, (_, i) => `${"x".repeat(180)} a.md${i % 2 ? "를사본" : ""}`).join("\n");
  const b = dcLonger({ clip: "a.md를사본", sel: one(0, 0, "a.md를사본"), text: big, cand: "a.md" });
  assert.ok(b.length <= DC_MAX_PROBES);
  const many = "a.md" + "가".repeat(40);
  const m = dcLonger({ clip: many, sel: one(0, 0, many), text: many, cand: "a.md" });
  assert.ok(m.length >= 9 && m.length <= DC_MAX_PROBES && new Set(m).size === m.length);
  assert.ok(m.every(p => p.startsWith("a.md") && p !== "a.md"));
  assert.deepEqual(dcLonger({ clip: "a.md", sel: one(0, 0, "a.md"), text: "a.md\n\u0007x\n", cand: "a.md" }), [], "제어문자 든 탐침은 안 낸다");
});

test("dcLonger: 상한 — 꼬리 9 + 줄바꿈 4 = 13 개가 모두 남는다(옛 상한 12 에 줄바꿈이 밀리지 않는다)", () => {
  assert.ok(DC_MAX_PROBES >= 13);
  const clip = "a.md가나다라마바사아자차", cand = "a.md";
  const text = `x\n${clip}\n` + Array.from({ length: 6 }, (_, i) => `a.md\n.s${i}`).join("\n") + "\n";
  const out = dcLonger({ clip, sel: one(1, 0, clip), text, cand });
  assert.equal(out.length, 13, JSON.stringify(out));
  assert.equal(out.length, DC_MAX_PROBES);
  assert.equal(out.filter(p => /\.s\d$/.test(p)).length, 4, "줄바꿈 탐침 4 개 모두");
  assert.equal(out.filter(p => p.startsWith("a.md가")).length, 9, "꼬리 탐침 9 개(전체 + 앞 8 글자씩)");
  // 줄바꿈 탐침이 4 개를 넘게 만들어져도 총수는 상한 이하(꼬리·줄바꿈 한도가 각자 막는다)
  const huge = Array.from({ length: 300 }, (_, i) => `${clip}\n.s${i}`).join("\n");
  const h = dcLonger({ clip, sel: one(0, 0, clip), text: huge, cand });
  assert.ok(h.length <= DC_MAX_PROBES);
});

// protects=클립보드에만 있는 글(post)이 탐침에 들어가지 않는다 — 탐침은 늘 text 조각 + cand; fails_when=탐침을 `cand + p.post` 로 만들면 실패; no_claim=text 에 실제로 있는 글의 비밀성
test("dcLonger: 클립보드에만 있는 post 글은 어떤 탐침에도 안 들어간다(placeholder)", () => {
  const text = "x\na.md를\n.bak\n", cand = "a.md";
  // 클립보드 post 가 허용 모양(한글 글자줄)이고 text 에는 없는 경우 · 허용 모양 밖(ASCII)인 경우 — 둘 다 text 에서 나온 탐침만 남는다
  for (const clip of ["a.md를비밀값", "a.md를。PLACEHOLDERSECRET", "a.md를。비밀값"]) {
    const out = dcLonger({ clip, sel: one(1, 0, clip), text, cand });
    assert.ok(out.every(p => !/PLACEHOLDERSECRET|비밀값/.test(p)), JSON.stringify(out));
    // 허용되는 것은 text 에서 자른 조각뿐: 줄바꿈 탐침 + (post 앞부분 `를` 이 text 에 있으면) 꼬리 탐침
    assert.deepEqual([...out].sort(), clip === "a.md를。비밀값" ? ["a.md를", "a.md를.bak"] : ["a.md를.bak"], clip);
  }
});

test("dcLonger: 다음 줄 비밀 글이 탐침으로 새지 않는다(placeholder)", () => {
  const text = "$ cat token.txt\nPLACEHOLDERSECRET\n";
  const out = dcLonger({ clip: "token.txt", sel: one(0, 6, "token.txt"), text, cand: "token.txt" });
  assert.deepEqual(out, []);
  assert.ok(out.every(p => !p.includes("PLACEHOLDERSECRET")));
});

// protects=줄바꿈 탐침에 붙는 다음 줄 머리가 좁은 두 모양(점 확장자 · 한글/가나 글자줄)뿐이다; fails_when=허용 밖 글자(글롭 · 대문자 · 짧은 소문자·숫자 `l`/`abcd`/`123` · 17자 확장자 · 9자 한글 · `/` · `=`)로 탐침이 만들어지면 또는 허용 모양이 막히면 실패; no_claim=이름이 확장자 안에서 갈린 경우(`l`)는 확인하지 않는다
test("dcLonger: 다음 줄 머리 모양 표 — 허용 2 모양 통과 · 금지는 탐침 없음(옛 허용 `l` `abcd` `123` 은 이제 탐침 없음으로 반전)", () => {
  const probe = (head) => dcLonger({ clip: "a.md", sel: one(1, 0, "a.md"), text: `x\nsee a.md\n${head}\n`, cand: "a.md" });
  for (const ok of [".bak", ".old", ".a-b_c", "사본", "사본가나다라마", "ー가", "・가"]) assert.deepEqual(probe(ok), ["a.md" + ok], ok);
  const bad = ["l", "abcd", "123", "on", "app", "0000", "*", "?", "[x", "\\x", ".b*k", "l*", "사*본", "ABC", "Abc", ".BAK_" + "x".repeat(16), "abcde", "123456", "." + "a".repeat(16), "사본가나다라마바사아", "/etc", "=x", "-x", "x/y", ".b/k"];
  for (const b of bad) assert.deepEqual(probe(b), [], JSON.stringify(b));
  // `.` + 15 자는 허용 · 16 자는 금지
  assert.equal(probe("." + "a".repeat(15)).length, 1);
  // 머리 글자 핀: 한글 8 자 허용 · 9 자 거부 · 한자 시작 · 한글 채움(U+3164) 시작 거부
  assert.deepEqual(probe("가나다라마바사아"), ["a.md가나다라마바사아"]);
  for (const b of ["가나다라마바사아자", "备份", "\u3164사본", "\u3164"]) assert.deepEqual(probe(b), [], JSON.stringify(b));
  // 회귀: 영어 문장이 줄바꿈으로 갈려도 `config.json` 류를 탐침하지 않는다(`config.js` + `on` → `config.json`)
  const prose = (line, next, cand) => dcLonger({ clip: cand, sel: one(1, 0, cand), text: `x\n${line}\n${next}\n`, cand });
  assert.deepEqual(prose("I updated config.js", "on the server", "config.js"), []);
  assert.deepEqual(prose("I updated App.js", "on", "App.js"), []);
});

test("dcLonger: 글롭 글자 든 탐침은 거부 · 마지막 조각 255 단위(UTF-16) 초과 거부 · 같은 이름은 안 낸다", () => {
  // 꼬리 장식의 글롭(`a.md*` + 다음 줄 `.bak`)은 post 모양 검사(글자줄이 아님)가 먼저 막는다 — push 의 GLOB 검사까지 가지 않는다
  for (const d of ["*", "?"]) assert.deepEqual(dcLonger({ clip: "a.md", sel: one(1, 0, "a.md"), text: `x\nsee a.md${d}\n.bak\n`, cand: "a.md" }), [], JSON.stringify(d));
  // 이름 길이 상한은 UTF-16 글자 단위(255): 한글 250 자 꼬리 → 전체 254 단위 통과 · 252 자 꼬리 → 전체 256 단위 탈락. (바이트로 세면 86 자부터 탈락해 유효한 긴 이름의 탐침이 빠졌다)
  assert.equal(NAME_MAX_UNITS, 255);
  for (const [n, full] of [[250, true], [251, true], [252, false]]) {
    const long = "가".repeat(n), clip = "a.md" + long, t2 = `x\n${clip}\n`;
    const o2 = dcLonger({ clip, sel: one(1, 0, clip), text: t2, cand: "a.md" });
    assert.ok(o2.every(p => p.slice(p.lastIndexOf("/") + 1).length <= NAME_MAX_UNITS), String(n));
    assert.equal(o2.includes(clip), full, `n=${n}`);
    assert.ok(o2.includes("a.md" + "가".repeat(8)), "앞 8 글자 탐침은 남는다");
  }
  // 바이트로는 255 를 넘지만(86 자 = 258 B) 단위로는 넘지 않는 이름의 탐침은 남는다
  const c86 = "a.md" + "가".repeat(86);
  assert.ok(utf8Len("가".repeat(86)) > 255 && dcLonger({ clip: c86, sel: one(1, 0, c86), text: `x\n${c86}\n`, cand: "a.md" }).includes(c86));
  // 폴더가 길어도 마지막 조각만 잰다
  const dir = "d".repeat(100) + "/", c3 = dir + "a.md";
  assert.deepEqual(dcLonger({ clip: c3, sel: one(1, 0, c3), text: `x\nsee ${c3}\n.bak\n`, cand: c3 }), [c3 + ".bak"]);
  // 같은 이름(cand 와 마지막 조각이 같음)은 탐침으로 안 낸다 — 탐침은 늘 cand 의 접두 확장이라 모든 출력이 이름이 다르다
  for (const [t, c] of [["x\nsee docs/a.md\n.bak\n", "docs/a.md"], ["x\na.md가나\n", "a.md"]]) {
    for (const p of dcLonger({ clip: c + "가", sel: one(1, 0, c), text: t, cand: c })) assert.notEqual(p.slice(p.lastIndexOf("/") + 1), c.slice(c.lastIndexOf("/") + 1));
  }
});

// protects=줄바꿈 탐침의 거름(앞 줄 접두 · 허용 꼬리 · 다음 줄 첫 글자)이 모두 [] 를 낸다; fails_when=세 케이스 중 하나라도 탐침을 내면 실패(앞 접두 DC_PRE 만 단독으로 막는 케이스 — 허용 꼬리 · 괄호 케이스는 다른 검사와 겹쳐 한 검사만 지워서는 실패하지 않는다; isCut 은 `(  .b` 케이스가 단독 방어); no_claim=이름이 줄 머리에 있는 경우
test("줄바꿈 탐침 음성: 다른 폴더 이름 · 확장자 뒤 더 이어짐 · 괄호로 시작하는 다음 줄", () => {
  assert.deepEqual(dcLonger({ clip: "a.md", sel: one(1, 0, "a.md"), text: "x\nsee docs/a.md\n  .bak\n", cand: "a.md" }), [], "앞 접두(docs/)");
  assert.deepEqual(dcLonger({ clip: "a.md", sel: one(1, 0, "a.md"), text: "x\nsee a.md.bak\n  .old\n", cand: "a.md" }), [], "허용 꼬리 밖(.bak)");
  assert.deepEqual(dcLonger({ clip: "a.md", sel: one(1, 0, "a.md"), text: "x\nsee a.md\n(.bak)\n", cand: "a.md" }), [], "다음 줄 첫 글자");
  assert.deepEqual(dcLonger({ clip: "a.md", sel: one(1, 0, "a.md"), text: "x\nsee a.md\n(  .b\n", cand: "a.md" }), [], "isCut 단독 방어 — 이 검사가 없으면 a.md.b");
});

test("dcStep: cols 가 바뀌면 기준선(fire 없음) · 그 뒤 reflowMs 안의 key 변화도 기준선 · 지나면 정상", () => {
  const a = S(3, 0, 3, 5), b = S(4, 0, 4, 5);
  let r = dcStep(null, { addr: "a", sel: a, cols: 80, now: 0 });
  r = dcStep(r.state, { addr: "a", sel: a, cols: 100, now: 100 });
  assert.equal(r.fire, false);
  r = dcStep(r.state, { addr: "a", sel: a, cols: 100, now: 5000 });
  assert.equal(r.fire, false, "cols 바뀐 뒤 머물러도 안 연다");
  // 줄바꿈 직후 key 변화
  r = dcStep(null, { addr: "a", sel: a, cols: 80, now: 0 });
  r = dcStep(r.state, { addr: "a", sel: a, cols: 100, now: 100 });
  r = dcStep(r.state, { addr: "a", sel: b, cols: 100, now: 600 });
  r = dcStep(r.state, { addr: "a", sel: b, cols: 100, now: 1500 });
  assert.equal(r.fire, false, "reflowMs 안에 바뀐 key");
  // reflowMs 뒤 key 변화는 정상
  r = dcStep(null, { addr: "a", sel: a, cols: 80, now: 0 });
  r = dcStep(r.state, { addr: "a", sel: a, cols: 100, now: 100 });
  r = dcStep(r.state, { addr: "a", sel: b, cols: 100, now: 1100 });
  assert.equal(r.fire, false);
  r = dcStep(r.state, { addr: "a", sel: b, cols: 100, now: 1500 });
  assert.equal(r.fire, true, "settle 뒤 fire");
  // cols 모름 = 예전 동작
  r = dcStep(null, { addr: "a", sel: null, now: 0 });
  r = dcStep(r.state, { addr: "a", sel: a, now: 100 });
  r = dcStep(r.state, { addr: "a", sel: a, now: 500 });
  assert.equal(r.fire, true);
});

test("cellWidth: NFD 결합 탁점 · 성조 표시는 0 칸 — NFD 와 NFC 폭이 같다", () => {
  assert.equal(cellWidth("デ.pdf"), 6);
  assert.equal(cellWidth("デ.pdf".normalize("NFD")), cellWidth("デ.pdf".normalize("NFC")));
  assert.equal(cellWidth("\u3099"), 0);
  assert.equal(cellWidth("\u302a"), 0);
});

test("selKey: null → null · 정상 → r:c-r:c · 모양 틀림 → null", () => {
  assert.equal(selKey(null), null);
  assert.equal(selKey(S(1, 2, 3, 4)), "1:2-3:4");
  assert.equal(selKey({ start: {}, end: {} }), null);
  assert.equal(selKey({ start: cell(1, 2) }), null);
});

test("dcLonger: 같은 줄 cand 뒤 글(post)은 없음 · 글자 8 자 이하만 탐침에 실린다(`.` · `#L41` · 9 자는 거부)", () => {
  const run = (line, next, cand) => dcLonger({ clip: cand, sel: one(1, 0, cand), text: `x\n${line}\n${next}\n`, cand });
  const clause = "を更新して、テスト用のファイルを作成しました";
  assert.deepEqual(run("config.yaml" + clause, "ok", "config.yaml"), []);
  assert.deepEqual(run("see a.md#L4111111111111111", ".bak", "a.md"), []);
  assert.deepEqual(run("x a.md" + "가".repeat(40), "abcd", "a.md"), []);
  // [의도적 반전] 예전엔 `a.md.` / `bak` 이 `a.md.bak` 탐침을 냈다 → 이제 post `.` · 짧은 소문자 머리 모두 불허: 확장자 안에서 갈린 이름은 확인하지 않는다
  assert.deepEqual(run("see a.md.", "bak", "a.md"), []);
  assert.deepEqual(run("see a.md.", ".bak", "a.md"), []);
  assert.deepEqual(run("see a.md#L41", ".bak", "a.md"), [], "#L41 post");
  assert.deepEqual(run("see a.md" + "가".repeat(9), ".bak", "a.md"), [], "글자 9 자 post");
  assert.deepEqual(run("  docs/plan.md를", ".bak", "docs/plan.md"), ["docs/plan.md를.bak"]);
  assert.deepEqual(run("see a.md" + "가".repeat(8), ".bak", "a.md"), ["a.md" + "가".repeat(8) + ".bak"]);
});

test("dcLonger: 줄 끝이 닫는 장식이면 줄바꿈 탐침 없음 · 맨 이름은 그대로 탐침", () => {
  const run = (line, next, cand) => dcLonger({ clip: cand, sel: one(1, 0, cand), text: `x\n${line}\n${next}\n`, cand });
  assert.deepEqual(run("built (x.js)", ".map files are emitted too", "x.js"), []);
  assert.deepEqual(run("built 'x.js'", ".map files are emitted too", "x.js"), []);
  assert.deepEqual(run("built `x.js`", ".map files are emitted too", "x.js"), []);
  assert.deepEqual(run("「보고서.pdf」", "사본도", "보고서.pdf"), []);
  assert.deepEqual(run("see x.js", ".map", "x.js"), ["x.js.map"]);
});

test("dcChoose: 닫는 장식 줄 끝의 x.js 는 x.js.map 이 있어도 열린다(끝에서 끝)", async () => {
  const d = await mkdtemp(join(base, "dcw-"));
  await writeFile(join(d, "x.js"), "1");
  await writeFile(join(d, "x.js.map"), "2");
  const text = "x\nbuilt (x.js)\n.map files are emitted too\n";
  const sel = one(1, 7, "x.js");
  const cand = dcPick({ clip: "x.js", sel, cols: 80, text });
  assert.equal(cand, "x.js");
  const longer = dcLonger({ clip: "x.js", sel, text, cand });
  const r = await sh(RESOLVE_SCRIPT, d, [cand, ...longer]);
  assert.equal(dcChoose(r.raw, cand, longer), join(d, "x.js"));
});

test("dcLonger: 다음 줄 머리는 한 낱말 전체여야 한다(뒤가 줄 끝 · 공백 · 상자선)", () => {
  const run = (next) => dcLonger({ clip: "a.md", sel: one(1, 0, "a.md"), text: `x\nsee a.md\n${next}\n`, cand: "a.md" });
  // 모양은 맞지만(점 확장자 · 한글 글자줄) 뒤가 `=` `<` `(` 로 이어져 낱말의 앞부분일 뿐 → 탐침 없음
  for (const bad of [".bak=1 2 3", ".old<rest", "사본(마바사"]) assert.deepEqual(run(bad), [], bad);
  assert.deepEqual(run("사본 rest"), ["a.md사본"]);
  assert.deepEqual(run("│ .bak │"), ["a.md.bak"]);
});

// ───────── dcBind · 묶인 모드(bd) ─────────
// 시험용 기준 배치(dcBind 와 따로 짠 느린 걸음): 글자마다 칸 → (행, 열). 너비 2 글자는 마지막 칸이면 일찍 넘어간다 · 폭 0 글자는 칸을 안 쓴다.
// 폭은 코드(cpRange)와 다른 자기 함수 vmWidth — Herdr 0.1.16 VM 실측(✅ ⚡ 🚀 등 그림 글자 2 · 태국어 · 히브리어 · 데바나가리 · 아랍어 결합 0 · 글자 + U+FE0F 는 2)을 따른다. 그 밖은 cellWidth 와 같다.
const VM_W2 = new Set([0x2705, 0x274C, 0x26A1, 0x2728, 0x2B50, 0x1F680, 0x1F525, 0x1F4C1, 0x1F7E2, 0x1FA84]);
const vmWidth = (cp) => VM_W2.has(cp) ? 2
  : (cp === 0x0E31 || (cp >= 0x0E34 && cp <= 0x0E3A) || (cp >= 0x0E47 && cp <= 0x0E4E) || cp === 0x05B4 || cp === 0x0941 || cp === 0x064E) ? 0
  : cellWidth(String.fromCodePoint(cp));
// «진짜 터미널» 폭 모델 T = { w(cp), widen, fe(prevCp) }. 기본(VM_T) = 위 vmWidth(실측). 성질 · 차이 시험은 mkTruth 로 불확실 글자(코드 표에서 lo ≠ hi)의 폭을 [lo, hi] 안에서 무작위로 정한다.
const VM_T = { w: vmWidth, widen: true, fe: () => vmWidth(0xFE0F) };
// 코드 표에서 폭이 불확실한 글자(lo ≠ hi)와 그 범위 — 코드와 따로 적은 시험용 표(FE0F 는 mkTruth 가 따로 다룬다).
const UNC_RANGE = new Map([[0x0E01, [0, 2]], [0x0E34, [0, 2]], [0x05B4, [0, 2]], [0x05D0, [0, 2]], [0x0941, [0, 2]], [0x064E, [0, 2]], [0xE0B0, [0, 2]], [0x1F389, [1, 2]], [0x1F916, [1, 2]]]);
// seed 로 재현 가능한 터미널: 글자마다 폭을 한 번 정한다(같은 터미널 안에서는 늘 같다) · FE0F 는 «앞 글자를 넓힘(widen)» 또는 «제 칸 0/1» 중 하나 · 앞이 확실한 2 칸 글자면 늘 0(실측 U+2705 + FE0F = 2).
function mkTruth(seed) {
  const rn = mulberry(seed), memo = new Map(), widen = rn(2) === 0, feOwn = rn(2);
  const w = (cp) => { const r = UNC_RANGE.get(cp); if (!r) return vmWidth(cp); if (!memo.has(cp)) memo.set(cp, r[0] + rn(r[1] - r[0] + 1)); return memo.get(cp); };
  const fe = (prev) => (prev >= 0 && !UNC_RANGE.has(prev) && vmWidth(prev) === 2) || widen ? 0 : feOwn;
  return { w, widen, fe };
}
function refWalk(line, cols, T = VM_T) {
  const chars = [...line];
  const cells = []; let row = 0, col = 0, u = 0;
  for (let k = 0; k < chars.length; k++) {
    const ch = chars[k];
    const cp0 = ch.codePointAt(0);
    let w = cp0 === 0xFE0F ? T.fe(k > 0 ? chars[k - 1].codePointAt(0) : -1) : T.w(cp0);
    if (T.widen && w === 1 && cp0 !== 0xFE0F && chars[k + 1] === "\uFE0F") w = 2;   // 이형 선택자 VS16 이 앞 글자를 2 칸으로 넓힌다
    if (w > 0 && col > 0 && col + w > cols) { row++; col = 0; }
    cells.push({ u, len: ch.length, row, col, w });
    if (w > 0) col += w;
    u += ch.length;
  }
  return { cells, rows: row + 1 };
}
// 코드의 옛 폭 표와 VM 실측이 어긋나는 글자 · 줄바꿈 경계 근처 긴 줄(✅ ⚡ 🚀 = 2 · 태국어 결합 = 0 · ✔ + FE0F = 2). cols 에 맞춰 만든다.
const MISMATCH_UNITS = ["✅", "⚡", "🚀", "กิ", "ก", "✔\uFE0F", "é", "→", "⏺", "ก\u0E34\u0E34", "\uE0B0", "🎉", "🤖", "\u05D0\u05B4"];
function mismatchLine(rnd, pick, cols) {
  const u = pick(MISMATCH_UNITS);
  switch (rnd(4)) {
    case 0: return u.repeat(1 + rnd(Math.max(2, cols)));                                    // 한 종류 길게(여러 행)
    case 1: return "a".repeat(Math.max(0, cols - 1 + rnd(3))) + u + "b".repeat(rnd(5));     // 줄바꿈 경계에 걸침
    case 2: return `${"x".repeat(rnd(cols))}${u.repeat(1 + rnd(6))}${"y".repeat(rnd(cols))}`;
    default: return u + pick(MISMATCH_UNITS) + "z".repeat(rnd(cols * 2));
  }
}
// 평범한 줄 = 폭이 확실한 글자뿐(ASCII · 한글 음절 · 상자선 · ✅). 아닌 줄이 j0 아래에 있으면 묶이지 않는 것이 정상이다.
const PLAIN_LINE = /^[\u0020-\u007e\uAC00-\uD7A3\u2502\u2705]*$/;
// 글 → 줄마다 시작 행 + 걸음. 끝 개행이 만드는 빈 조각은 줄이 아니다(dcBind 와 같은 약속).
function refLayout(text, cols, T = VM_T) {
  let lines = text.split(/\r\n|\n|\r/);
  if (lines.length > 1 && lines.at(-1) === "") lines = lines.slice(0, -1);
  let r = 0;
  return { lines, L: lines.map(l => { const w = refWalk(l, cols, T); const o = { row0: r, ...w }; r += w.rows; return o; }), R: r };
}
// text 의 occ 번째 word 를 «더블클릭» 한 것처럼: sel · clip · total(= 전체 행 + pad) 을 만들어 dcBind · dcPick · dcLonger 를 돌린다.
function pickAt(text, word, { occ = 0, cols = 80, rows = 24, clip = word, pad = 0, total, cut = false } = {}) {
  let at = -1;
  for (let k = 0; k <= occ; k++) { at = text.indexOf(word, at + 1); if (at < 0) throw new Error(`word 없음: ${word}`); }
  const lay = refLayout(text, cols);
  const raw = text.split("\n");                                   // 시험 글은 \n 만 쓴다
  let pos = 0, li = -1, off = 0;
  for (let j = 0; j < raw.length; j++) { if (at <= pos + raw[j].length) { li = j; off = at - pos; break; } pos += raw[j].length + 1; }
  const { cells, row0 } = lay.L[li];
  const first = cells.find(c => c.u === off && c.w > 0), lastC = [...cells].reverse().find(c => c.u < off + word.length && c.w > 0);
  const sel = S(row0 + first.row, first.col, row0 + lastC.row, lastC.col + lastC.w - 1);
  const tot = total === undefined ? lay.R + pad : total;
  const bd = dcBind({ sel, cols, rows, text, clip, total: tot, cut });
  const cand = dcPick({ clip, sel, cols, text, bd });
  const longer = cand === null ? [] : dcLonger({ clip, sel, text, cand, bd });
  return { sel, bd, cand, longer, total: tot, li, off };
}
// 탐침이 «text 조각 ≤ max 개를 이은 것» 인지(클립보드 글은 어디에도 없다) — 조각 하나하나가 text 의 부분 문자열.
function piecewise(probe, text, max = 4) {
  const n = probe.length, best = new Array(n + 1).fill(Infinity);
  best[0] = 0;
  for (let i = 0; i < n; i++) if (best[i] < Infinity) for (let j = i + 1; j <= n; j++) { if (!text.includes(probe.slice(i, j))) break; best[j] = Math.min(best[j], best[i] + 1); }
  return best[n] <= max;
}
// 결정적 난수(mulberry32): rnd(n) = 0..n-1
function mulberry(a) { return (n) => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return Math.floor(((t ^ (t >>> 14)) >>> 0) / 4294967296 * n); }; }
// RESOLVE_SCRIPT 흉내: 있는 이름(fsSet)만 `/w/<이름>` 레코드로 낸다.
const fakeOpen = (fsSet, cand, longer) => dcChoose("=/w\0" + [cand, ...longer].filter(a => fsSet.has(a)).map(a => `/w/${a}\0`).join(""), cand, longer);

test("dcBind: 위 붙임 · 한 줄 · 개행 끝 · 나쁜 입력은 null", () => {
  const text = "ls\nsee a.md now";
  const r = pickAt(text, "a.md");
  assert.deepEqual([r.bd.i, r.bd.a, r.bd.b], [1, 4, 8]);
  assert.deepEqual(r.bd.lines, ["ls", "see a.md now"]);
  assert.equal(r.cand, "a.md");
  const r2 = pickAt(text + "\n", "a.md");
  assert.deepEqual([r2.bd.i, r2.bd.a, r2.bd.b], [1, 4, 8], "끝 개행의 빈 조각은 줄이 아니다");
  const ok = { sel: r.sel, cols: 80, rows: 24, text, clip: "a.md", total: 2, cut: false };
  assert.ok(dcBind(ok));
  for (const bad of [{ sel: null }, { cols: 0 }, { cols: 80.5 }, { rows: 0 }, { rows: undefined }, { text: null }, { clip: null }, { clip: "" }, { sel: S(1, 80, 1, 83) }, { sel: S(1, 4, 1, 90) }]) assert.equal(dcBind({ ...ok, ...bad }), null, JSON.stringify(bad));
  assert.equal(dcBind(), null);
  assert.equal(dcBind({ ...ok, sel: S(1, 7, 1, 4) })?.b, 8, "거꾸로 순서도 같다");
});

test("dcBind: 소프트 랩 — 한 논리 줄이 여러 행 · 줄이 정확히 cols 칸이면 1 행 · 빈 줄 1 행", () => {
  const long = "y".repeat(75) + " plan.md " + "z".repeat(10);           // plan.md 는 76..82 → 행 0 의 76..79 + 행 1 의 0..2
  const text = `q\n\n${"p".repeat(80)}\n${long}\nend`;                   // 행: q 0 · 빈 1 · p 2 · long 3,4 · end 5
  const r = pickAt(text, "plan.md");
  assert.equal(r.sel.start.row, 3); assert.equal(r.sel.end.row, 4);
  assert.deepEqual([r.bd.i, r.bd.a, r.bd.b], [3, 76, 83]);
  assert.equal(r.total, 6);
  assert.equal(r.cand, "plan.md");
  assert.equal(dcBind({ sel: S(3, 76, 5, 2), cols: 80, rows: 24, text, clip: "plan.md", total: 6 }), null, "끝이 다음 논리 줄");
});

test("dcBind: 칸 걸음 — 너비 2 글자가 마지막 칸이면 일찍 넘어간다(ceil(폭/cols) 로는 틀린다)", () => {
  // cols 3: 가 하나가 한 행(둘째 가는 남은 1 칸에 안 들어간다) → `가가가` = 3 행 · ceil(6/3) = 2 행이면 아래 줄이 한 행 어긋난다
  const text = "x\n가가가\ny";
  const r = pickAt(text, "y", { cols: 3 });
  assert.equal(r.sel.start.row, 4, "x 0 · 가가가 1..3 · y 4");
  assert.deepEqual([r.bd.i, r.bd.a, r.bd.b], [2, 0, 1]);
  const r2 = pickAt(text, "가", { occ: 2, cols: 3 });
  assert.deepEqual([r2.sel.start.row, r2.sel.start.col, r2.sel.end.col], [3, 0, 1]);
  assert.deepEqual([r2.bd.i, r2.bd.a, r2.bd.b], [1, 2, 3]);
  // 일찍 넘어간 빈 칸(행 끝) · 글자 가운데는 «글자가 시작하는 칸» 이 아니다
  assert.equal(dcBind({ sel: S(1, 2, 1, 2), cols: 3, rows: 24, text, clip: "가", total: 5 }), null, "빈 칸");
  assert.equal(dcBind({ sel: S(1, 1, 1, 1), cols: 3, rows: 24, text, clip: "가", total: 5 }), null, "글자 가운데");
  // 기준 배치와 같은 걸음: 섞인 줄을 여러 cols 로
  for (const cols of [4, 7, 10, 80]) {
    const t = ["a가b나c다라마바사아자차카타파하".repeat(3), "plan.md 보고서.pdf", "한글 abc"].join("\n");
    const r3 = pickAt(t, "plan.md", { cols });
    assert.equal(r3.bd?.i, 1, `cols=${cols}`);
    assert.equal(r3.cand, "plan.md", `cols=${cols}`);
    const r4 = pickAt(t, "보고서.pdf", { cols });
    assert.equal(r4.bd?.i, 1, `cols=${cols}`);
  }
});

test("dcBind: 닻 — 빈 행이 아래에 있으면 위 붙임 · 기록이 잘렸으면 아래 붙임 · 잘림 + 빈 행은 자체 검사로 null · 반복 낱말 구멍", () => {
  const lines = Array.from({ length: 30 }, (_, i) => `row${String(i).padStart(2, "0")}.md`);
  const text = lines.join("\n");
  // 아래에 빈 행 5 개(d = 5 < rows) → 위 붙임: 줄 j = 행 j
  const top = pickAt(text, "row07.md", { pad: 5 });
  assert.equal(top.bd.i, 7);
  // 오래된 기록이 10 행 잘림(total = R − 10 → d < 0) → 지금은 null(아래 붙임 계산이 성립하지 않는다)
  const real = 25 - 10;
  // d < 0(글이 total 보다 큼)은 cut 이든 아니든 있을 수 없는 배치 → null(3차 리뷰: 옛 «cut 이면 아래 붙임으로 묶임» 단언을 null 로 바꿈)
  assert.equal(dcBind({ sel: S(real, 0, real, 7), cols: 80, rows: 24, text, clip: "row25.md", total: 20, cut: true }), null, "cut + d < 0 → null");
  assert.equal(dcBind({ sel: S(35, 0, 35, 7), cols: 80, rows: 24, text, clip: "row25.md", total: 30 + 10, cut: true })?.i, 25, "cut + d = 10 → 아래 붙임: 줄 25 = 행 35");
  assert.equal(dcBind({ sel: S(real, 0, real, 7), cols: 80, rows: 24, text, clip: "row25.md", total: 20, cut: false }), null, "안 잘린 읽기 + d < 0 → null");
  // 잘림 + 맨 아래 빈 행 3 개: 아래 붙임이 3 행 어긋남 → 글자가 다르면 자체 검사가 null
  assert.equal(dcBind({ sel: S(real, 0, real, 7), cols: 80, rows: 24, text, clip: "row25.md", total: 20 + 3, cut: true }), null);
  // 구멍 닫힘(모호함 가드): 같은 낱말이 같은 열에 반복되면(옛: 어긋난 줄 22 에 조용히 묶임) 가능한 오프셋 [0, d] 안 다른 등장과 구별되지 않으므로 묶지 않는다
  const same = Array.from({ length: 30 }, () => "same.md").join("\n");
  assert.equal(dcBind({ sel: S(real, 0, real, 6), cols: 80, rows: 24, text: same, clip: "same.md", total: 23, cut: true }), null, "d < 0 → 가드 전에 null");
  // 가드가 실제로 도는 입력: cut + d = 3 → 닻은 줄 12 · 같은 열 같은 낱말이 오프셋 [0, 3] 안(줄 13..15)에도 있다
  const h = dcBind({ sel: S(real, 0, real, 6), cols: 80, rows: 24, text: same, clip: "same.md", total: 33, cut: true });
  assert.equal(h, null, "구멍이 닫힘 — 가능한 오프셋 [0, d] 안 같은 열 같은 낱말은 묶지 않는다(옛 길로)");
  assert.equal(dcBind({ sel: S(real, 0, real, 6), cols: 80, rows: 24, text: same, clip: "same.md", total: 30, cut: true })?.i, real, "d = 0 → 가능한 오프셋이 0 하나뿐 → 모호하지 않다");
  // total 이 R 보다 훨씬 큰 경우(맨 아래 d > rows): 잘린 읽기면 아래 붙임 · 안 잘린 읽기면 진짜 오프셋이 후보 밖이라 null(2차 리뷰: 안 잘렸는데 d > rows 는 끝 빈 행이 화면보다 많다는 뜻)
  const far = dcBind({ sel: S(1000 + 7, 0, 1000 + 7, 7), cols: 80, rows: 24, text, clip: "row07.md", total: 1000 + 30, cut: true });
  assert.equal(far.i, 7);
  assert.equal(dcBind({ sel: S(1000 + 7, 0, 1000 + 7, 7), cols: 80, rows: 24, text, clip: "row07.md", total: 1000 + 30, cut: false }), null, "안 잘린 읽기 + d > rows → null");
  // cut: d 가 0..rows 안이어도 아래 붙임(위 붙임 금지)
  const dd = { cols: 80, rows: 24, text, clip: "row07.md", total: 30 + 3 };
  assert.equal(dcBind({ ...dd, sel: S(7, 0, 7, 7), cut: false }).i, 7, "d=3 → 위 붙임");
  assert.equal(dcBind({ ...dd, sel: S(7, 0, 7, 7), cut: true }), null, "cut → 아래 붙임: 행 7 은 줄 4 → 글자가 다르다");
  assert.equal(dcBind({ ...dd, sel: S(10, 0, 10, 7), cut: true }).i, 7, "cut 아래 붙임: 줄 7 = 행 10");
  // total 모름 → 묶지 않는다(옛: 위 붙임으로 묶었다 — 닻을 모르면 오결합 위험)
  assert.equal(dcBind({ ...dd, sel: S(7, 0, 7, 7), total: null }), null, "total 모름 → null(옛: 위 붙임)");
  assert.equal(dcBind({ ...dd, sel: S(7, 0, 7, 7), total: null, cut: true }), null);
  for (const t of [0, -1, 2.5, "9", NaN]) assert.equal(dcBind({ ...dd, sel: S(7, 0, 7, 7), total: t }), null, `total=${t} → 정수 아님 · 모름 → null(옛: 위 붙임)`);
});

test("dcBind: 선택이 두 논리 줄에 걸치면 null · 자체 검사 불일치 null · 글 밖 행 null", () => {
  const text = "aaa.md\nbbb.md\nccc.md";
  assert.equal(dcBind({ sel: S(0, 2, 1, 2), cols: 80, rows: 24, text, clip: "a.mdbbb", total: 3 }), null);
  assert.equal(dcBind({ sel: S(1, 0, 1, 5), cols: 80, rows: 24, text, clip: "ccc.md", total: 3 }), null, "글자가 다르다");
  assert.equal(dcBind({ sel: S(1, 0, 1, 5), cols: 80, rows: 24, text, clip: "bbb.md", total: 3 })?.i, 1);
  assert.equal(dcBind({ sel: S(0, 0, 0, 5), cols: 80, rows: 24, text, clip: "aaa.md", total: 3 + 40 }), null, "안 잘린 읽기 + d > rows → null");
  assert.equal(dcBind({ sel: S(0, 0, 0, 5), cols: 80, rows: 24, text, clip: "aaa.md", total: 3 + 40, cut: true }), null, "잘린 읽기 d = 40 아래 붙임: 행 0 − 40 은 첫 줄 앞");
  assert.equal(dcBind({ sel: S(9, 0, 9, 5), cols: 80, rows: 24, text, clip: "aaa.md", total: 3 }), null, "행이 글 밖");
});

test("dcBind: NFD 자모 줄 — 폭 0 자모가 끝 글자에 붙고 클립보드와 글 조각이 같다", () => {
  const nfd = "한글".normalize("NFD") + ".md";
  const text = `x\nsee ${nfd} end`;
  const r = pickAt(text, nfd);
  assert.deepEqual([r.sel.start.col, r.sel.end.col], [4, 4 + 4 + 3 - 1]);
  assert.equal(r.bd.lines[1].slice(r.bd.a, r.bd.b), nfd);
  assert.equal(r.cand, nfd);
  // 끝 칸이 한글 끝 글자(`글`)면 뒤따르는 받침 자모(폭 0)까지 범위에 든다
  const k = "한글".normalize("NFD");
  const r2 = pickAt(`x\n${k} end`, k);
  assert.equal(r2.bd.b - r2.bd.a, k.length);
});

test("dcBind: 가나 NFD 탁점 · 이모지(서러게이트) 줄도 기준 배치와 같다", () => {
  const t = `a\n${"デ".normalize("NFD")}.pdf b.md`;
  const r = pickAt(t, "b.md");
  assert.equal(r.bd.lines[1].slice(r.bd.a, r.bd.b), "b.md");
  assert.equal(r.cand, "b.md");
  // 그림 글자(😀 = 폭 [1,2] 불확실)가 이름 앞에 있으면 칸을 모른다 → 묶지 않는다(3차 리뷰: 옛 «기준 배치와 같다» 단언을 null 로 바꿈 · 폭 1 로 가정했었다)
  assert.equal(pickAt(`a\n${"デ".normalize("NFD")}.pdf 😀 b.md`, "b.md").bd, null);
});

test("dcOldText: 끝 keep 줄만(끝 개행은 종결) · 끝 maxUnits 글자 · 짧으면 그대로", () => {
  assert.equal(dcOldText("a\nb\nc\n", 1, 99), "c\n");
  assert.equal(dcOldText("a\nb\nc", 2, 99), "b\nc");
  assert.equal(dcOldText("a\nb\nc", 9, 99), "a\nb\nc");
  assert.equal(dcOldText("a\nb\nc", 0, 99), "");
  assert.equal(dcOldText("abcdef", 5, 3), "def");
  assert.equal(dcOldText(null, 5, 3), "");
  const t = Array.from({ length: 400 }, (_, i) => `L${i}`).join("\n");
  assert.equal(dcOldText(t, 300 + 24, 1e9).split("\n").length, 324);
  const short = t.split("\n").slice(-100).join("\n");
  assert.equal(dcOldText(short, 324, 64 * 1024), short, "032f193 이 보던 짧은 글은 그대로");
});

// ── 묶인 모드: dcPick 오른쪽 · 왼쪽 · 창 ──
test("묶인 dcPick 오른쪽: 이름이 더 이어지면 null(data.json+l · a.md+.bak · x.js+-old) · 장식은 열린다(표)", () => {
  const cont = [["data.json", "l"], ["a.md", ".bak"], ["x.js", "-old"], ["x.js", "+z"], ["x.js", "/y"], ["a.md", "_2"], ["a.md", "9"]];
  for (const [n, t] of cont) {
    const r = pickAt(`x\nsee ${n}${t} end`, n);
    assert.ok(r.bd, `bd ${n}${t}`);
    assert.equal(r.cand, null, `${n}${t} → 이름이 이어진다`);
  }
  // 결합 부호: 정상 선택은 뒤따르는 폭 0 글자까지 범위에 들지만(클립보드도 같다) 범위 밖에 남았으면 이어짐이다
  const mk = { lines: ["a.md\u0301"], i: 0, a: 0, b: 4 };
  assert.equal(dcPick({ clip: "a.md", sel: S(0, 0, 0, 3), cols: 80, text: "a.md\u0301", bd: mk }), null, "결합 부호가 이어진다");
  assert.equal(dcPick({ clip: "a.md", sel: S(0, 0, 0, 3), cols: 80, text: "a.md\u0301", bd: { lines: ["a.md x"], i: 0, a: 0, b: 4 } }), "a.md");
  assert.equal(dcBind({ sel: S(0, 0, 0, 3), cols: 80, rows: 24, text: "a.md\u0301", clip: "a.md", total: 1 }), null, "폭 0 글자는 범위에 든다 → 클립보드가 부호를 빼면 묶지 않는다");
  // 옛 길은 열린다(알려진 한계 — 묶이면 닫힌다)
  assert.equal(dcPick({ clip: "data.json", sel: one(1, 4, "data.json"), cols: 80, text: "x\nsee data.jsonl end" }), "data.json");
  const deco = ["x.js.", "x.js. 다음", "x.js:42", "x.js)", "x.js,", "x.js#L4", "x.js**", "x.js를", "x.js를 보세요", "x.js ", "x.js", "x.js。", "x.js」", "x.js!", "x.js.."];   // `x.js-` · `x.js+` · `x.js/` 는 이어짐이 아니지만 scanText 가 후보를 안 낸다(확장자 뒤가 글자도 끝도 아님)
  for (const d of deco) assert.equal(pickAt(`x\nsee ${d}`, "x.js").cand, "x.js", `${d} → 열린다`);
  assert.equal(pickAt("x\nsee 「x.js」 and", "x.js").cand, "x.js");
  assert.equal(pickAt("x\nsee **x.js** and", "x.js").cand, "x.js", "굵게 안의 이름만 고른 것");
  assert.equal(pickAt("x\nsee **x.js** and", "**x.js**").cand, "x.js", "장식째 고른 것");
  assert.equal(pickAt("x\nsee docs/plan.md를 and", "docs/plan.md를").cand, "docs/plan.md");
});

test("묶인 dcPick 왼쪽: 앞에 이름 글자가 붙으면 null(myplan.md · my-plan.md) · `/` 는 폴더 접두 모양일 때만", () => {
  for (const pre of ["my", "my-", "a.", "a_", "9"]) {
    const text = `x\nsee ${pre}plan.md now\n  plan.md\n`;            // 뒤 줄에 단독 plan.md 가 있어도(창 안에 후보로 있다) 왼쪽 규칙이 막는다
    assert.equal(pickAt(text, "plan.md").cand, null, pre);
  }
  assert.equal(pickAt("x\nsee myplan.md now", "plan.md").cand, null, "창에 own 후보가 없어도 null");
  // 앞이 공백 · 줄 머리 · 상자선 · 장식이면 이름은 자기 낱말
  assert.equal(pickAt("x\nplan.md", "plan.md").cand, "plan.md");
  assert.equal(pickAt("x\n│ plan.md │", "plan.md").cand, "plan.md");
  assert.equal(pickAt("x\n(plan.md)", "plan.md").cand, "plan.md");
  assert.equal(pickAt("x\nsee `plan.md`", "plan.md").cand, "plan.md");
  assert.equal(pickAt("x\nsee **plan.md", "**plan.md").cand, "plan.md");
  // `/` 앞: own 이 창 안에서 단독 후보여야 하고 접두 모양이 맞아야 한다
  const ok = pickAt("x\nsee docs/plan.md and plan.md\n", "plan.md");
  assert.equal(ok.cand, "plan.md"); assert.deepEqual(ok.longer, ["docs/plan.md"], "접두 탐침(폴더만 다른 같은 이름)");
  const badPre = ["https://x/plan.md and plan.md", "foo:docs/plan.md and plan.md", "a/b/c/d/e/f/g/h/i/plan.md and plan.md", "(docs/plan.md and plan.md", "docs//plan.md and plan.md", `${"d".repeat(65)}/plan.md and plan.md`, `/${"d/".repeat(64)}plan.md and plan.md`];
  for (const bad of badPre) assert.equal(pickAt(`x\nsee ${bad}`, "plan.md").cand, null, bad);
  for (const good of ["/abs/dir/plan.md and plan.md", "~/docs/plan.md and plan.md", "./plan.md and plan.md", "../plan.md and plan.md", "a/b/c/d/e/f/g/h/plan.md and plan.md", "*docs/plan.md and plan.md"]) {
    const r = pickAt(`x\nsee ${good}`, "plan.md");
    assert.equal(r.cand, "plan.md", good);
    assert.equal(r.longer.length, 1, good);
    assert.ok(r.longer[0].endsWith("/plan.md"), good);
  }
});

test("묶인 dcPick: 창 = 앞 줄 + 그 줄 + 뒤 DC_WRAP_ROWS 줄 · 한 줄 선택 꼬리 fail-closed 는 없다 · 위조 bd 는 null", () => {
  assert.equal(DC_WRAP_ROWS, 3);
  // own 이 이 자리의 토큰에서만 후보인 경우: 같은 낱말이 먼 줄에 단독으로 있어도 이 자리가 후보가 아니면 null
  const far = `${"filler\n".repeat(10)}plan.md\n`;
  assert.equal(pickAt(`x\nsee my-plan.md\n${far}`, "plan.md").cand, null);
  // 한 줄 선택 + 꼬리: 옛 길은 text 에 꼬리가 없으면 null · 묶이면 줄에서 온다(text 는 안 본다)
  const full = "x\nsee docs/plan.md를 end";
  const r = pickAt(full, "docs/plan.md를");
  assert.equal(r.cand, "docs/plan.md");
  assert.equal(dcPick({ clip: "docs/plan.md를", sel: r.sel, cols: 80, text: "전혀 다른 글\n", bd: r.bd }), "docs/plan.md", "text 는 안 본다");
  assert.equal(dcPick({ clip: "docs/plan.md를", sel: r.sel, cols: 80, text: "전혀 다른 글\n", bd: null }), null, "옛 길은 fail-closed");
  // 방어: bd 가 이 클립보드의 것이 아니면 null
  assert.equal(dcPick({ clip: "docs/plan.md", sel: S(1, 4, 1, 15), cols: 80, text: full, bd: r.bd }), null);
  assert.equal(dcPick({ clip: "docs/plan.md를", sel: r.sel, cols: 80, text: full, bd: { ...r.bd, i: 0 } }), null);
});

// ── 묶인 모드: dcLonger 탐침 ──
test("묶인 dcLonger 꼬리: 줄에서 자른다 — 클립보드 post 없이도 오른쪽 글자줄 · 장식으로 시작하면 없음 · 255 단위 상한", () => {
  const t1 = "x\n보고서.pdf사본을 보세요";
  const r = pickAt(t1, "보고서.pdf");
  assert.equal(r.cand, "보고서.pdf");
  assert.deepEqual([...r.longer].sort(), ["보고서.pdf사", "보고서.pdf사본", "보고서.pdf사본을"].sort());
  // 클립보드에 꼬리가 들어 있어도 같은 것
  const r2 = pickAt(t1, "보고서.pdf사본을");
  assert.deepEqual([...r2.longer].sort(), ["보고서.pdf사", "보고서.pdf사본", "보고서.pdf사본을"].sort());
  assert.deepEqual(pickAt("x\n보고서.pdf.사본", "보고서.pdf").longer, [], "장식(`.`)으로 시작 → 꼬리 탐침 없음");
  assert.deepEqual(pickAt("x\n보고서.pdf를", "보고서.pdf").longer, ["보고서.pdf를"]);
  assert.deepEqual(pickAt("x\na.md 가나", "a.md").longer, [], "공백 뒤 글은 안 본다");
  assert.deepEqual(pickAt("x\na.md\n가나", "a.md").longer, ["a.md가나"], "다음 줄 머리는 줄바꿈 사슬로");
  const huge = "가".repeat(252), t3 = `x\na.md${huge}`, h = pickAt(t3, "a.md");
  assert.ok(h.longer.every(p => p.length <= NAME_MAX_UNITS) && !h.longer.includes("a.md" + huge) && h.longer.includes("a.md" + "가".repeat(8)));
  assert.equal(h.cand, "a.md");
  for (const p of r.longer.concat(r2.longer)) assert.ok(piecewise(p, t1, 2), p);
  for (const p of h.longer) assert.ok(piecewise(p, t3, 2), p.slice(0, 20));
});

test("묶인 dcLonger 거울: 이름이 줄 머리 · 앞 줄 끝 토큰이 `/` 로 끝나는 폴더 모양 → 앞 토큰 + 이름 · 그 밖은 탐침 없음(누출 가드)", () => {
  const probe = (prev, line = "  plan.md") => pickAt(`x\n${prev}\n${line}`, "plan.md").longer;
  assert.deepEqual(probe("see docs/"), ["docs/plan.md"]);
  assert.deepEqual(probe("│ docs/ │", "│ plan.md │"), ["docs/plan.md"]);
  assert.deepEqual(probe("see /abs/dir/"), ["/abs/dir/plan.md"]);
  assert.deepEqual(probe("see ~/docs/"), ["~/docs/plan.md"]);
  assert.deepEqual(probe("see ./"), ["./plan.md"]);
  assert.deepEqual(probe("--out=docs/"), ["docs/plan.md"]);
  // 누출 가드: `/` 로 끝나지 않는 앞 줄 토큰(cat 이 찍은 값 · 문장 끝 낱말)은 절대 안 붙인다
  for (const prev of ["$ cat token.txt", "PLACEHOLDERSECRET", "see docs", "my-docs", "a/b", "see docs/x", "see https://host/", "docs/ more"]) assert.deepEqual(probe(prev), [], prev);
  assert.deepEqual(probe("(docs/)"), [], "닫는 장식 끝");
  assert.deepEqual(probe("「docs/」"), [], "닫는 장식 끝");
  assert.deepEqual(probe("'docs/'"), []);
  assert.deepEqual(probe("*docs/"), [], "모양 밖(장식 글자)");
  assert.deepEqual(probe("a/b/c/d/e/f/g/h/i/"), [], "9 조각");
  assert.deepEqual(probe(`${"d".repeat(65)}/`), [], "조각 65 자");
  assert.deepEqual(probe(`${"d/".repeat(64)}`), [], "128 자 초과");
  assert.deepEqual(probe("//"), []);
  assert.deepEqual(probe("see docs/", "see plan.md"), [], "이름이 줄 머리가 아니다");
  assert.deepEqual(probe("see docs/", "x plan.md"), []);
  // 첫 줄에 있으면 앞 줄이 없다
  assert.deepEqual(pickAt("plan.md", "plan.md").longer, []);
});

test("묶인 dcLonger 줄바꿈 사슬: 이름 + 같은 줄 꼬리 + 다음 줄 머리 · 줄 전체가 머리 하나면 다음 줄로 이어 DC_WRAP_ROWS 줄까지", () => {
  const ch = (text, w = "plan.md") => pickAt(text, w).longer;
  assert.deepEqual(ch("x\nsee plan.md\n  .bak"), ["plan.md.bak"]);
  assert.deepEqual(ch("x\n│ see plan.md │\n│ .bak       │"), ["plan.md.bak"]);
  assert.deepEqual(ch("x\nsee plan.md를\n    .bak").sort(), ["plan.md를", "plan.md를.bak"].sort());
  // 사슬
  assert.deepEqual(ch("x\nplan.md\n사\n본\n을\n다"), ["plan.md사", "plan.md사본", "plan.md사본을"], "3 줄까지 · 넷째 줄(다)은 안 본다");
  assert.deepEqual(ch("x\nplan.md\n.bak\n.old"), ["plan.md.bak", "plan.md.bak.old"]);
  assert.deepEqual(ch("x\nplan.md\n  .bak\n.old\n.x1"), ["plan.md.bak", "plan.md.bak.old", "plan.md.bak.old.x1"]);
  assert.deepEqual(ch("x\nplan.md\n.bak 와 더\n.old"), ["plan.md.bak"], "머리 줄에 다른 글이 있으면 거기서 끝");
  assert.deepEqual(ch("x\nplan.md\n.bak\nl"), ["plan.md.bak"], "둘째 머리가 모양 밖(짧은 소문자)이면 거기서 끝");
  assert.deepEqual(ch("x\nplan.md\n.bak\n\n.old"), ["plan.md.bak"], "빈 줄은 사슬을 끊는다");
  // 음성
  assert.deepEqual(ch("x\n(plan.md)\n.bak"), [], "닫는 장식 끝");
  assert.deepEqual(ch("x\nsee 'plan.md'\n.bak"), []);
  assert.deepEqual(ch("x\nplan.md foo\n.bak"), [], "이름이 줄의 마지막 토큰이 아니다");
  assert.deepEqual(ch("x\nsee plan.md\n(.bak)"), [], "다음 줄 첫 글자");
  assert.deepEqual(ch("x\nsee plan.md\n.bak=1 2"), [], "머리 뒤가 낱말 중간");
  assert.deepEqual(ch("x\nsee plan.md\nl"), [], "짧은 소문자 머리");
  const nine = ch("x\nsee plan.md" + "가".repeat(9) + "\n.bak");
  assert.ok(nine.length > 0 && nine.every(p => !p.endsWith(".bak")), "꼬리 9 자 → 사슬 없음(꼬리 탐침만)");
  assert.deepEqual(ch("x\nsee plan.md.\n.bak"), [], "post `.`");
  assert.deepEqual(ch("x\nsee plan.md"), [], "맨 아래 줄이면 다음 줄 없음");
});

test("묶인 dcLonger: 고정 회귀 — I updated config.js / on the server 은 두 모드 모두 []", () => {
  const text = "x\nI updated config.js\non the server\n";
  const r = pickAt(text, "config.js");
  assert.ok(r.bd);
  assert.equal(r.cand, "config.js"); assert.deepEqual(r.longer, []);
  assert.equal(dcPick({ clip: "config.js", sel: r.sel, cols: 80, text }), "config.js");
  assert.deepEqual(dcLonger({ clip: "config.js", sel: r.sel, text, cand: "config.js" }), []);
});

test("묶인 dcLonger: 옛 쌍이 다른 곳에 있어도 거부 없음(전체 훑기 없음) · 옛 길은 거부", () => {
  const text = "ls -1\na.md\nb.md\nc.md\nold: a.md\n .bak\n";
  const r = pickAt(text, "a.md");
  assert.equal(r.cand, "a.md"); assert.deepEqual(r.longer, []);
  const fsSet = new Set(["a.md", "a.md.bak"]);
  assert.equal(fakeOpen(fsSet, r.cand, r.longer), "/w/a.md", "묶이면 거부 없음");
  const old = dcLonger({ clip: "a.md", sel: r.sel, text, cand: "a.md" });
  assert.deepEqual(old, ["a.md.bak"]);
  assert.equal(fakeOpen(fsSet, "a.md", old), null, "옛 길은 거부(알려진 한계)");
  // 진짜 쌍 위에서는 둘 다 거부
  const r2 = pickAt("x\nsee a.md\n .bak next\n", "a.md");
  assert.deepEqual(r2.longer, ["a.md.bak"]);
  assert.equal(fakeOpen(fsSet, r2.cand, r2.longer), null);
});

test("묶인 dcLonger: 상한 — DC_MAX_PROBES 는 두 모드의 큰 쪽 · 묶인 모드 최대 12 개", () => {
  assert.equal(DC_MAX_PROBES, (DC_TAIL_STEPS + 1) + Math.max(DC_MAX_WRAP, 1 + DC_WRAP_ROWS));
  assert.equal(DC_MAX_PROBES, 13);
  // 묶인 모드 현실 최대: 꼬리 8 글자(전체 = 8 번째라 겹침) 8 + 거울 1 + 사슬 3 = 12 · 꼬리 9 글자여도 선택 밖 꼬리는 8 글자까지라 8 + 1 = 9 (사슬 없음)
  const tail8 = "가나다라마바사아";
  const r = pickAt(`x\ndocs/\nplan.md${tail8}\n사\n본\n을\n다`, "plan.md");
  assert.equal(r.longer.length, 12, JSON.stringify(r.longer));
  assert.equal(r.longer.filter(p => p.startsWith("docs/")).length, 1);
  const r9 = pickAt(`x\ndocs/\nplan.md${tail8}자\n사\n본`, "plan.md");
  assert.equal(r9.longer.length, 9, "선택 밖 꼬리 상한 8 글자 → 9 글자째 전체 탐침이 8 글자 탐침과 겹쳐 사라진다(옛 10)");
  for (const rr of [r, r9]) assert.ok(rr.longer.length <= DC_MAX_PROBES);
  // 선택한 꼬리 탐침(bd.b > oe): 선택한 글(`아.` 까지)이 가장 먼저 · 걸음 8 · 접두/거울 1 — 상한에 밀려 빠지는 탐침이 없다.
  // 구조상 최대 13: 줄바꿈 사슬이 서면 이름 뒤 글자줄이 8 자 이하라 선택한 꼬리는 걸음과 겹치거나 걸음 8 + 선택 1 + 접두/거울 1 + 사슬 3 = 13 이하 · 사슬이 없으면 선택 1 + 전체 1 + 걸음 8 + 접두/거울 1 = 11.
  const wsel = "plan.md" + tail8 + ".";
  const rsel = pickAt(`x\ndocs/\n${wsel}\n사\n본\n을\n다`, wsel);
  assert.equal(rsel.cand, "plan.md");
  assert.equal(rsel.longer[0], wsel, "선택한 꼬리 탐침이 가장 먼저");
  assert.equal(rsel.longer.filter(p => p.startsWith("docs/")).length, 1);
  assert.equal(new Set(rsel.longer).size, rsel.longer.length);
  assert.ok(rsel.longer.length <= DC_MAX_PROBES);
});

test("묶기: 폭 불확실 줄 — j0 아래(끝 줄까지)에 있으면 null · j0 위에만 있으면(잘린 읽기) 묶인다", () => {
  const thai = "กิ".repeat(6);   // 코드 폭 범위 [0, 2] → 칸 10 에서 행 수 불확실(진짜는 1 행)
  const below = ["zz", "a.md", thai].join("\n"), above = [thai, "zz", "a.md"].join("\n");
  for (const cut of [false, true]) assert.equal(dcBind({ sel: S(1, 0, 1, 3), cols: 10, rows: 5, text: below, clip: "a.md", total: 3, cut }), null, `아래 불확실 cut=${cut}`);
  assert.equal(dcBind({ sel: S(2, 0, 2, 3), cols: 10, rows: 5, text: above, clip: "a.md", total: 3, cut: true })?.i, 2, "j0 위 불확실 줄은 상관없다");
  // 확실한 글자(실측 목록 · 블록)는 불확실이 아니다: ✅ ⚡ 🚀 2 칸 · ⏺ → 1 칸 · 상자선 · 그리스어 · 점자
  for (const u of ["✅", "⚡", "🚀", "⏺", "→", "─", "α", "⠂"]) {
    const t = ["zz", "a.md", u.repeat(13)].join("\n");
    const r = pickAt(t, "a.md", { cols: 10, rows: 5, pad: 0 });
    assert.equal(r.bd?.i, 1, `확실한 글자 ${u}`);
  }
});

test("묶기: 상한 — 글 DC_BIND_MAX 초과 null · 큰 줄(DC_WIN_MAX 초과)에 닿으면(가드 후보여도) 칸 걸음 전에 null", () => {
  assert.equal(DC_BIND_MAX, 512 * 1024);
  const ok = ["zz", "see a.md now"].join("\n");
  assert.equal(dcBind({ sel: S(1, 4, 1, 7), cols: 80, rows: 24, text: ok, clip: "a.md", total: 2 })?.i, 1);
  assert.equal(dcBind({ sel: S(1, 4, 1, 7), cols: 80, rows: 24, text: "z".repeat(DC_BIND_MAX) + "\n" + "see a.md now", clip: "a.md", total: 2 }), null, "글이 DC_BIND_MAX 를 넘는다");
  const big = ["x".repeat(DC_WIN_MAX + 1000), "mid", "see a.md now"].join("\n");   // cols 80 → 큰 줄 = 행 0..831 (창 합은 한도 안: 앞 줄이 아니라 두 줄 위)
  const R = Math.ceil((DC_WIN_MAX + 1000) / 80) + 2;
  assert.equal(dcBind({ sel: S(R - 1, 4, R - 1, 7), cols: 80, rows: 24, text: big, clip: "a.md", total: R })?.i, 2, "d = 0 → 가드 후보 모두 큰 줄 밖");
  assert.equal(dcBind({ sel: S(R - 1, 4, R - 1, 7), cols: 80, rows: 24, text: big, clip: "a.md", total: R + 3 })?.i, 2, "d = 3 → 가드 범위의 큰 줄에 a.md 가 없다: 찾기 값 ceil(길이 × 4 ÷ DC_FIND_DIV)만 빼고 걷지 않는다 → 예산 안이라 묶인다");
  // 가드 긴 줄 상한: 묶인 줄(마지막) 위 가드 범위에 a.md 가 든 64K 넘는 줄 — 등장이 줄 앞쪽(걸음 예산은 거의 안 쓴다)이라 «줄 길이 > DC_WIN_MAX → null» 만이 막는다
  const big3 = ["see a.md " + "x".repeat(DC_WIN_MAX), "mid", "see a.md now"].join("\n"), R3 = Math.ceil((9 + DC_WIN_MAX) / 80) + 2;
  assert.equal(dcBind({ sel: S(R3 - 1, 4, R3 - 1, 7), cols: 80, rows: 24, text: big3, clip: "a.md", total: R3 + 3, cut: false }), null, "가드 범위 안 큰 줄(> DC_WIN_MAX)에 등장 → null");
  assert.equal(dcBind({ sel: S(R3 - 1, 4, R3 - 1, 7), cols: 80, rows: 24, text: big3, clip: "a.md", total: R3, cut: false })?.i, 2, "d = 0 → 가드 범위는 마지막 줄뿐 · 큰 줄은 걷지 않는다");
  const big2 = ["x".repeat(2000) + " a.md " + "x".repeat(DC_WIN_MAX), "mid", "see a.md now"].join("\n");
  assert.equal(dcBind({ sel: S(R - 1, 4, R - 1, 7), cols: 80, rows: 24, text: big2, clip: "a.md", total: R + 3 + 25 }), null, "가드 범위 큰 줄에 등장이 있으면 null(여기선 d > rows 라 null 일 수도 있어 아래에서 cut 으로 다시)");
  assert.equal(dcBind({ sel: S(R - 1, 4, R - 1, 7), cols: 80, rows: 24, text: big2, clip: "a.md", total: R + 3 + 2000, cut: true }), null);
  // dcReadCut 은 split 없이 센다 — 큰 글 · 작은 n 에서 일찍 끝난다
  assert.equal(dcReadCut("x\n".repeat(1e6), 5), true);
  assert.equal(dcReadCut("x".repeat(1e6), 2), false);
});

test("묶인 dcLonger: push 거름은 그대로 — 제어문자 · 글롭 · 중복", () => {
  assert.deepEqual(pickAt("x\nsee a.md*\n.bak", "a.md").longer, [], "글롭 post");
  assert.deepEqual(pickAt("x\na.md\n\u0007bak", "a.md").longer, []);
  const d = pickAt("x\nsee docs/plan.md and plan.md and plan.md", "plan.md");
  assert.equal(new Set(d.longer).size, d.longer.length);
  assert.deepEqual(d.longer, ["docs/plan.md"]);
});

test("D: 소프트 랩으로 두 행에 걸친 data.jsonl — 선택은 두 행 · 한 논리 줄로 묶인다 · data.json 이 열리지 않는다", () => {
  const text = "q\ndata.jsonl";
  const r = pickAt(text, "data.jsonl", { cols: 6 });
  assert.deepEqual([r.sel.start.row, r.sel.end.row], [1, 2], "두 행");
  assert.ok(r.bd, "한 논리 줄로 묶인다");
  assert.deepEqual([r.bd.i, r.bd.a, r.bd.b], [1, 0, 10]);
  assert.equal(r.cand, null, "jsonl 은 목록 밖 확장자 → 후보 없음 · 절대 data.json 이 아니다");
  assert.equal(dcPick({ clip: "data.jsonl", sel: r.sel, cols: 6, text }), null);
  assert.deepEqual(r.longer, []);
});

test("알려진 한계(고정): 확장자 안에서 프로그램이 하드 랩한 이름(data.json / l)은 짧은 이름이 열린다 · 이름 안 갈림(docs/pl / an.md)은 탐침 없음", () => {
  const a = pickAt("x\ndata.json\nl", "data.json");
  assert.equal(a.cand, "data.json"); assert.deepEqual(a.longer, []);
  const b = pickAt("x\ndocs/pl\nan.md", "an.md");
  assert.equal(b.cand, "an.md"); assert.deepEqual(b.longer, []);
});

// ── 클립보드만의 글 · 위조 bd ──
test("묶기: 클립보드에만 있는 글은 dcBind 를 못 지나고 어떤 탐침에도 없다(무작위)", () => {
  const rnd = mulberry(12345);
  const alpha = "abcxyz019_.-/가나다라ー・ \t";
  const text = "x\nsee plan.md를사본 end\n  .bak\nbuild docs/\n  a.md\n";
  const good = pickAt(text, "plan.md를사본");
  assert.ok(good.bd);
  let tried = 0;
  for (let k = 0; k < 300; k++) {
    let secret = ""; const n = 1 + rnd(24);
    for (let j = 0; j < n; j++) secret += alpha[rnd(alpha.length)];
    if (text.includes(secret.replace(/\r?\n$/, ""))) continue;
    tried++;
    // 같은 선택 · 비밀 클립보드: 자체 검사에서 null
    assert.equal(dcBind({ sel: good.sel, cols: 80, rows: 24, text, clip: secret, total: good.total }), null, JSON.stringify(secret));
    // 진짜 bd 를 위조해 비밀 클립보드와 같이 넘겨도 dcPick · dcLonger 는 아무것도 안 낸다
    assert.equal(dcPick({ clip: secret, sel: good.sel, cols: 80, text, bd: good.bd }), null);
    assert.deepEqual(dcLonger({ clip: secret, sel: good.sel, text, cand: "plan.md", bd: good.bd }), []);
    // 진짜 클립보드 + 비밀 꼬리: bd 가 안 묶이고, 옛 길로 가도 탐침에 비밀이 없다
    const mixed = "plan.md를사본" + secret;
    assert.equal(dcBind({ sel: good.sel, cols: 80, rows: 24, text, clip: mixed, total: good.total }), null);
    assert.deepEqual(dcLonger({ clip: mixed, sel: good.sel, text, cand: "plan.md", bd: good.bd }), []);
    for (const p of dcLonger({ clip: mixed, sel: good.sel, text, cand: "plan.md" })) assert.ok(piecewise(p, text, 4) && !p.includes(secret), p);
  }
  assert.ok(tried > 250);
  // 정상 선택의 모든 탐침은 text 조각 ≤ 4 개
  for (const w of ["plan.md", "a.md", "plan.md를사본"]) {
    const r = pickAt(text, w);
    for (const p of r.longer) assert.ok(piecewise(p, text, 4), p);
  }
});

// ── 묶인 길 vs 옛 길 차이 시험 ──
// 무작위 글 · 선택에서 묶이면 연 파일 X 를 옛 길도 열거나, 이유가 (a) 다른 곳의 옛 쌍이 옛 길을 거부함 (b) 선택 줄이 옛 300 줄 읽기 밖 중 하나여야 한다. 묶인 쪽이 더 엄격(null)한 것은 허용.
test("차이 시험: 묶인 길이 연 것은 옛 길도 열거나 (a) 다른 곳의 옛 쌍 (b) 옛 읽기 밖 — 그 밖의 차이는 실패", () => {
  const rnd = mulberry(20261122);
  const pick = (a) => a[rnd(a.length)];
  const names = ["a.md", "b.md", "plan.md", "x.js", "data.json", "보고서.pdf", "notes.txt", "docs/plan.md", "src/a.ts"];
  const tails = ["", "", "", "를", "를사본", ".", ":42", ")", ".bak", "l", "사본", "#L4"];
  const heads = [".bak", ".old", "사본", "l", "on", "(x)"];
  const lead = ["", "see ", "edited ", "│ ", "  ", "- ", "`", "「", "**", "my", "dir/", "กิ ", "🎉 ", "\uE0B0 "];   // 앞 3 개 = 폭 불확실 글자가 이름 앞
  const stats = { bound: 0, same: 0, a: 0, b: 0, pre: 0, stricter: 0, cases: 0, tail: 0, blank: 0, rep: 0, over: 0, mism: 0, mismBound: 0 };
  for (let it = 0; it < 4000; it++) {
    const fsSet0 = new Set();
    const cols = pick([20, 40, 80]), rows = 24;
    const long = rnd(6) === 0, total = long ? 380 + rnd(60) : 3 + rnd(10);
    const lines = [];
    for (let j = 0; j < total; j++) {
      const t = rnd(10);
      if (long && j < total - 12) lines.push(`filler ${j} n${j}.md${pick(tails)}`);
      else if (t === 9 && rnd(2)) lines.push("see docs/plan.md and plan.md");
      else if (t === 8 && rnd(2)) { const same = pick(names); for (let r = 2 + rnd(4); r > 0; r--) lines.push(same); }   // 같은 열 반복 이름
      else if (t < 5) lines.push(`${pick(lead)}${pick(names)}${pick(tails)}${rnd(3) === 0 ? " end" : ""}`);
      else if (t < 7) { lines.push(`see ${pick(names)}`); lines.push(`  ${pick(heads)}`); j++; }
      else if (t < 8) lines.push(`${pick(names)}`);
      else lines.push(rnd(3) === 0 ? mismatchLine(rnd, pick, cols) : "ls -1");   // 코드 폭 표와 어긋나는 글자 줄도 섞는다
    }
    const text = lines.join("\n");
    const lay = refLayout(text, cols, mkTruth(rnd(1e9)));   // 진짜 터미널 = 불확실 글자 폭을 [lo, hi] 안에서 무작위로 정한 것(seed 로 재현)
    // 선택: 무작위 줄의 무작위 후보 위치(이름 + 선택한 꼬리)
    const li = long && rnd(2) ? rnd(40) : lay.lines.length - 1 - rnd(Math.min(lay.lines.length, 14));
    const line = lay.lines[li];
    const deep = line.match(/^filler (\d+) (n\d+\.md)/);
    const here = deep ? [deep[2]] : names.filter(n => line.includes(n));
    if (!here.length) continue;
    const nm = pick(here), at = rnd(2) ? line.indexOf(nm) : line.lastIndexOf(nm);
    if (deep && rnd(5)) fsSet0.add(nm);
    const tailsel = pick(["", "", "", "를", "를사본", ".", "l"]);
    const word = line.slice(at + nm.length).startsWith(tailsel) ? nm + tailsel : nm;
    const { cells, row0 } = lay.L[li];
    const first = cells.find(c => c.u === at && c.w > 0), lc = [...cells].reverse().find(c => c.u < at + word.length && c.w > 0);
    if (!first || !lc) continue;
    const sel = S(row0 + first.row, first.col, row0 + lc.row, lc.col + lc.w - 1);
    if (selSpan(sel, cols) === null) continue;
    stats.cases++;
    // 진짜 읽기 흉내: 앞 m 줄을 버린 뒷부분 글(cut) · 끝 빈 행 tb ∈ [0, rows] — 선택 행 · total 은 전체 글의 진짜(VM 실측 폭) 배치에서
    const m = rnd(4) === 0 && li > 0 ? 1 + rnd(li) : 0, tb = rnd(3) ? 0 : (rnd(6) === 0 ? rows + 1 + rnd(m === 0 ? 8 : 3 * rows) : rnd(rows + 1));   // 끝 빈 행 [0, rows] · rows 초과도 일부(잘린 읽기는 크게 — 닻이 틀린 줄을 가리킨다)
    const lines2 = lay.lines.slice(m), text2 = lines2.join("\n"), li2 = li - m;
    if (m > 0) stats.tail++;
    if (tb > 0) stats.blank++;
    if (text2.split(word).length > 2) stats.rep++;
    const fsSet = fsSet0;
    for (const n of names) if (rnd(3)) fsSet.add(n);
    for (const n of names) for (const t of [".bak", ".old", "를", "를사본", "사본", "l"]) if (rnd(5) === 0) fsSet.add(n + t);
    // 옛 길은 끝 300 + rows 줄만 본다
    const oldText = dcOldText(text2, 300 + rows, 64 * 1024);
    const bd = dcBind({ sel, cols, rows, text: text2, clip: word, total: lay.R + tb, cut: m > 0 ? dcReadCut(text2, lines2.length) : false });
    // 묶인 길
    const candB = dcPick({ clip: word, sel, cols, text: oldText, bd });
    const longB = candB === null ? [] : dcLonger({ clip: word, sel, text: oldText, cand: candB, bd });
    const openB = candB === null ? null : fakeOpen(fsSet, candB, longB);
    for (const p of longB) assert.ok(piecewise(p, text2, 4), `조각 ${p}`);
    // 옛 길(같은 글 · 묶음 없음)
    const candO = dcPick({ clip: word, sel, cols, text: oldText });
    const openO = candO === null ? null : fakeOpen(fsSet, candO, dcLonger({ clip: word, sel, text: oldText, cand: candO }));
    if (bd) { stats.bound++; assert.ok(bd.i === li2 && bd.a === at, `묶인 자리가 진짜 줄 · 자리가 아니다 it=${it} i=${bd.i} 진짜=${li2}`); }
    if (m === 0 && tb > rows) { stats.over++; assert.equal(bd, null, `안 잘린 읽기 + 끝 빈 행 ${tb} > rows → null it=${it}`); }
    if (lines2.some(l => !PLAIN_LINE.test(l))) { stats.mism++; if (bd) stats.mismBound++; }
    if (longB.some(p => p.includes("/") && p.slice(p.lastIndexOf("/") + 1) === candB.slice(candB.lastIndexOf("/") + 1))) stats.pre++;
    if (openB === null) { if (openO !== null) stats.stricter++; continue; }
    if (openB === openO) { stats.same++; continue; }
    // 이유 (b) 선택 줄이 옛 읽기 밖
    if (li2 < lines2.length - (300 + rows)) { stats.b++; continue; }
    // 묶인 길은 접두 · 거울 경로를 절대 열지 않는다(dcChoose 가 같은 이름 탐침이 있으면 cand 의 기대 경로만 연다)
    assert.equal(openB, `/w/${candB}`, `묶음이 cand 밖 경로를 열었다: ${openB}`);
    // 이유 (a) 다른 곳(선택 줄과 바로 이웃 밖)의 쌍이 옛 길을 거부함: 그 줄들을 지운 글에서는 옛 길도 같은 것을 연다
    const keep = new Set([li2 - 1, li2, li2 + 1]);   // 선택 줄과 바로 이웃만 남긴다 — 그 밖의 쌍이 옛 길만 막은 것인지 본다
    const clean = lines2.map((l, j) => keep.has(j) ? l : "zz").join("\n");
    const cleanText = dcOldText(clean, 300 + rows, 64 * 1024);
    const cC = dcPick({ clip: word, sel, cols, text: cleanText });
    const oC = cC === null ? null : fakeOpen(fsSet, cC, dcLonger({ clip: word, sel, text: cleanText, cand: cC }));
    if (openO === null && oC === openB) { stats.a++; continue; }
    assert.fail(`설명 안 되는 차이: it=${it} 묶음=${openB} 옛=${openO} 청소 뒤 옛=${oC} word=${JSON.stringify(word)} li=${li2} m=${m} tb=${tb} cols=${cols}\n${JSON.stringify(lines2.slice(Math.max(0, li2 - 2), li2 + 4))}`);
  }
  assert.ok(stats.cases > 1500 && stats.bound > 1000 && stats.same > 300 && stats.a > 5 && stats.b > 0 && stats.pre > 0 && stats.tail > 200 && stats.blank > 300 && stats.rep > 200 && stats.over > 30 && stats.mism > 200 && stats.mismBound > 50, JSON.stringify(stats));
  console.log("[diff stats]", JSON.stringify(stats));
});

test("깊게 읽기: 선택 줄이 옛 읽기(끝 300 + rows 줄) 밖이어도 묶이면 열린다 · 묶이지 않으면 null(032f193 과 같다)", () => {
  const lines = Array.from({ length: 500 }, (_, i) => `filler ${i}`);
  lines[5] = "see uniq.md now";
  const text = lines.join("\n");
  const r = pickAt(text, "uniq.md");
  assert.equal(r.cand, "uniq.md");
  assert.equal(r.bd.i, 5);
  const oldText = dcOldText(text, 300 + 24, 64 * 1024);
  assert.ok(!oldText.includes("uniq.md"));
  assert.equal(dcPick({ clip: "uniq.md", sel: r.sel, cols: 80, text: oldText }), null, "묶음 없음 = 옛 읽기 = 못 찾음");
  assert.equal(dcPick({ clip: "uniq.md", sel: r.sel, cols: 80, text: oldText, bd: r.bd }), "uniq.md");
  assert.equal(fakeOpen(new Set(["uniq.md"]), r.cand, r.longer), "/w/uniq.md");
});

// 접두 · 거울 탐침은 cand 와 마지막 조각이 같다(폴더만 다름) → dcChoose 는 RESOLVE_SCRIPT 의 `=<cwd>` 레코드로 cand 의 기대 경로 E 를 만들어 «E 하나만» 있을 때 연다. 진짜 RESOLVE_SCRIPT · 임시 폴더.
test("접두 · 거울 탐침(같은 이름): E 하나만 열린다 · 접두 파일만 · 둘 다 · 링크 폴더 → null", async () => {
  for (const text of ["x\nsee docs/plan.md and plan.md\n", "x\nsee docs/\n  plan.md\n"]) {
    const r = pickAt(text, "plan.md");
    assert.equal(r.cand, "plan.md", text);
    assert.deepEqual(r.longer, ["docs/plan.md"], text);
    const run = async (setup, dirName) => {
      const d = await fresh(), cwd = dirName ? join(d, dirName) : d;
      await mkdir(cwd, { recursive: true });
      await setup(cwd, d);
      const o = await sh(RESOLVE_SCRIPT, cwd, [r.cand, ...r.longer]);
      return { cwd, got: dcChoose(o.raw, r.cand, r.longer) };
    };
    const only = await run(c => touch(join(c, "plan.md")));
    assert.equal(only.got, join(only.cwd, "plan.md"), "./plan.md 만 → 열린다");
    const pre = await run(c => touch(join(c, "docs/plan.md")));
    assert.equal(pre.got, null, "docs/plan.md 만 → null");
    const both = await run(async c => { await touch(join(c, "plan.md")); await touch(join(c, "docs/plan.md")); });
    assert.equal(both.got, null, "둘 다 → null");
    assert.equal((await run(async () => {})).got, null, "아무것도 없음");
    const inDocs = await run(c => touch(join(c, "plan.md")), "docs");
    assert.equal(inDocs.got, join(inDocs.cwd, "plan.md"), "cwd 이름이 docs · ./plan.md 만 → 열린다");
    const link = await run(async (c, d) => { await touch(join(d, "other/plan.md")); await symlink(join(d, "other"), join(c, "docs")); await touch(join(c, "plan.md")); }, "w");
    assert.equal(link.got, null, "docs 가 다른 폴더 링크 + ./plan.md 도 있음 → null");
    const self = await run(async c => { await touch(join(c, "plan.md")); await symlink(".", join(c, "docs")); });
    assert.equal(self.got, join(self.cwd, "plan.md"), "docs 가 . 링크 → 같은 파일(중복 없음)");
  }
});

test("dcChoose: 같은 이름 탐침이 있으면 `=` 루트 레코드가 필수 · 제어문자 · `~/` · 절대 cand", () => {
  const rec = (...p) => p.join("\0") + "\0";
  const L = ["docs/plan.md"];
  assert.equal(dcChoose(rec("=/w", "/w/plan.md"), "plan.md", L), "/w/plan.md");
  assert.equal(dcChoose(rec("/w/plan.md"), "plan.md", L), null, "= 없음");
  assert.equal(dcChoose(rec("=/w\u0007x", "/w\u0007x/plan.md"), "plan.md", L), null, "root 에 제어문자");
  assert.equal(dcChoose(rec("=w", "/w/plan.md"), "plan.md", L), null, "root 가 절대 경로가 아님");
  assert.equal(dcChoose(rec("=/w", "/w/plan.md", "/w/docs/plan.md"), "plan.md", L), null);
  assert.equal(dcChoose(rec("=/w", "/w/docs/plan.md"), "plan.md", L), null);
  assert.equal(dcChoose(rec("=/", "/plan.md"), "plan.md", L), "/plan.md");
  assert.equal(dcChoose(rec("=/w", "/h/plan.md"), "~/plan.md", ["x/plan.md"]), null, "~/ cand");
  assert.equal(dcChoose(rec("=/w", "/abs/plan.md"), "/abs/plan.md", ["/abs/d/plan.md"]), "/abs/plan.md");
  assert.equal(dcChoose(rec("=/w", "/w/plan.md", "/w/plan.md사본"), "plan.md", [...L, "plan.md사본"]), null, "다른 이름 탐침 히트는 그대로 거부");
  assert.equal(dcChoose(rec("=/w", "/w/plan.md"), "plan.md", ["plan.md사본"]), "/w/plan.md", "같은 이름 탐침이 없으면 옛 논리 그대로");
});

test("D 쌍둥이: 소프트 랩으로 두 행에 걸친 report.html — 후보는 report.html · report.htm 이 아니다", () => {
  assert.ok(TERM_EXTS.has("html") && TERM_EXTS.has("htm"));
  const r = pickAt("q\nreport.html", "report.html", { cols: 8 });
  assert.deepEqual([r.sel.start.row, r.sel.end.row], [1, 2]);
  assert.ok(r.bd);
  assert.equal(r.cand, "report.html");
  assert.deepEqual(r.longer, []);
});

// ───────── 리뷰 수정: 줄 수 제한 읽기 · 닻 · 같은 이름 탐침 · 비용 · 꼬리 상한 ─────────
test("dcReadCut: 논리 줄 수가 n 이상이면 cut · 끝 개행의 빈 조각은 줄이 아니다 · 나쁜 입력은 보수적으로 true", () => {
  assert.equal(dcReadCut("a\nb\nc", 3), true);
  assert.equal(dcReadCut("a\nb\nc", 4), false);
  assert.equal(dcReadCut("a\nb\nc\n", 3), true, "끝 개행은 줄이 아니다 → 3 줄");
  assert.equal(dcReadCut("a\nb\nc\n", 4), false);
  assert.equal(dcReadCut("a\r\nb\rc", 3), true, "CRLF · CR 도 줄 나눔");
  assert.equal(dcReadCut("a", 1), true);
  assert.equal(dcReadCut("", 2), false);
  for (const n of [0, -1, 2.5, "3", NaN, null, undefined]) assert.equal(dcReadCut("a\nb", n), true, `n=${n}`);
  for (const t of [null, undefined, 5, []]) assert.equal(dcReadCut(t, 3), true);
});

test("dcBind: 줄 수 제한에 걸린 읽기(cut)는 아래 붙임만 — 위 붙임으로 잘못 묶이지 않는다", () => {
  const all = Array.from({ length: 40 }, (_, i) => `row${String(i).padStart(2, "0")}.md`);
  // 진짜 터미널: 40 줄 + 끝 빈 행 5 · 앞 10 줄을 버린 30 줄만 읽음. 선택 row20.md = 진짜 행 20
  const tail = all.slice(10).join("\n");
  const cut = dcReadCut(tail, 30);
  assert.equal(cut, true);
  assert.equal(dcBind({ sel: S(20, 0, 20, 7), cols: 80, rows: 24, text: tail, clip: "row20.md", total: 45, cut }), null, "끝 빈 행 5 → 아래 붙임이 5 행 어긋남 → 자체 검사 null(옛 길)");
  const ok = dcBind({ sel: S(20, 0, 20, 7), cols: 80, rows: 24, text: tail, clip: "row20.md", total: 40, cut });
  assert.equal(ok?.i, 10, "끝 빈 행 0 → 아래 붙임이 맞다: 읽은 글의 10 번째 줄 = 진짜 줄 20");
  // cut 을 안 알리면(위 붙임) 같은 입력이 잘못 묶인다 — main.js 가 dcReadCut 으로 막는 이유
  assert.equal(dcBind({ sel: S(20, 0, 20, 7), cols: 80, rows: 24, text: tail, clip: "row20.md", total: 40, cut: false }), null, "cut 을 안 알리면 위 붙임(d = 10 < rows)으로 행 20 = 읽은 글 줄 20(row30) → 글자가 달라 null(반복 낱말이면 잘못 묶였을 경우)");
});

test("dcBind: 모호함 가드 — 가능한 오프셋 [0, d] 안 같은 열의 같은 낱말은 묶지 않고 · 밖이면 묶는다", () => {
  const mk = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join("\n");
  // 같은 낱말 2 줄(행 5 · 9) · 선택은 아래(행 9) · 끝 빈 행이 있을 수 있어(d = 5) 위(행 5)가 진짜일 수 있다 → null
  const two = mk(30, i => (i === 5 || i === 9 ? "dup.md" : `u${String(i).padStart(2, "0")}.md`));
  assert.equal(dcBind({ sel: S(9, 0, 9, 5), cols: 80, rows: 24, text: two, clip: "dup.md", total: 30 + 5 }), null);
  // 끝 빈 행이 없으면(d = 0) 오프셋이 0 하나뿐 → 모호하지 않다(옛: 음수 오프셋 후보까지 봐 null)
  assert.equal(dcBind({ sel: S(9, 0, 9, 5), cols: 80, rows: 24, text: two, clip: "dup.md", total: 30 })?.i, 9);
  // 선택 «아래» 같은 낱말은 음수 오프셋이라 불가능 → 묶인다(옛: null)
  assert.equal(dcBind({ sel: S(5, 0, 5, 5), cols: 80, rows: 24, text: two, clip: "dup.md", total: 30 + 5 })?.i, 5);
  // 잘린 읽기: 같은 낱말이 묶인 줄 아래 d 행 이내(오프셋 [0, d])에 있으면 null · 밖이면 묶는다
  assert.equal(dcBind({ sel: S(10, 0, 10, 5), cols: 80, rows: 24, text: two, clip: "dup.md", total: 30 + 5, cut: true }), null);
  const far = mk(60, i => (i === 5 || i === 40 ? "dup.md" : `u${String(i).padStart(2, "0")}.md`));
  assert.equal(dcBind({ sel: S(5, 0, 5, 5), cols: 80, rows: 24, text: far, clip: "dup.md", total: 60 })?.i, 5);
  assert.equal(dcBind({ sel: S(40, 0, 40, 5), cols: 80, rows: 24, text: far, clip: "dup.md", total: 60 + 24 })?.i, 40, "두 낱말이 rows 이상 떨어져 있으면 한 화면에 같이 안 든다");
  // 다른 열의 같은 낱말은 모호하지 않다
  const col = mk(30, i => (i === 5 ? "dup.md" : i === 9 ? "  dup.md" : `u${String(i).padStart(2, "0")}.md`));
  assert.equal(dcBind({ sel: S(5, 0, 5, 5), cols: 80, rows: 24, text: col, clip: "dup.md", total: 30 })?.i, 5);
  assert.equal(dcBind({ sel: S(9, 2, 9, 7), cols: 80, rows: 24, text: col, clip: "dup.md", total: 30 + 5 })?.i, 9);
});

test("dcBind: 창(묶인 줄 + 앞 줄 + 뒤 DC_WRAP_ROWS 줄)이 DC_WIN_MAX 를 넘으면 null(옛 길)", () => {
  assert.equal(DC_WIN_MAX, 64 * 1024);
  const small = "x".repeat(1000) + "\nsee a.md end\n" + "y".repeat(1000);
  const r = pickAt(small, "a.md");
  assert.ok(r.bd, "작으면 묶인다");
  for (const big of [`${"x".repeat(DC_WIN_MAX)}\nsee a.md end`, `see a.md end\n${"y".repeat(DC_WIN_MAX)}`, `q\nsee a.md end\nz\nz\n${"w".repeat(DC_WIN_MAX)}`]) {
    const b = pickAt(big, "a.md");
    assert.equal(b.bd, null, "이웃 줄이 크면 묶지 않는다");
  }
  const far4 = pickAt(`q\nsee a.md end\nz\nz\nz\n${"w".repeat(DC_WIN_MAX)}`, "a.md");
  assert.ok(far4.bd, "창 밖(뒤 4 번째 줄)의 큰 줄은 상관없다");
});

test("dcClipShape: 불리언만 · dcPick 앞부분과 같은 판정(공백 · 두 후보 · 칸 수 · 허용 목록)", () => {
  const sel = (w) => S(1, 4, 1, 4 + cellWidth(w) - 1);
  for (const [clip, want] of [["plan.md", true], ["plan.md\n", true], ["**plan.md**", true], ["plan.md를", true], ["docs/plan.md", true], ["plan.md#L12C3", true], ["a.md b.md", false], ["plain", false], ["data.jsonl", false], ["", false], [null, false], ["plan.mdx.bak", false]]) {
    const got = dcClipShape({ clip, sel: sel((clip ?? "").replace(/\n$/, "")), cols: 80 });
    assert.equal(typeof got, "boolean");
    if (want) assert.equal(got, true, JSON.stringify(clip));
    if (!want) assert.equal(got, false, JSON.stringify(clip));
  }
  assert.equal(dcClipShape({ clip: "plan.md", sel: S(1, 4, 1, 20), cols: 80 }), false, "칸 수 불일치(낡은 클립보드)");
  assert.equal(dcClipShape({ clip: "plan.md", sel: null, cols: 80 }), false);
  assert.equal(dcClipShape({ clip: "plan.md", sel: S(1, 4, 1, 10), cols: 0 }), false);
  assert.equal(dcClipShape(), false);
  // dcPick 이 후보를 내면 모양 검사는 반드시 통과한다
  for (const w of ["plan.md", "x.js", "보고서.pdf", "**a.md**", "docs/plan.md를"]) {
    const r = pickAt(`x\nsee ${w} end`, w);
    if (r.cand !== null) assert.equal(dcClipShape({ clip: w, sel: r.sel, cols: 80 }), true, w);
  }
});

test("같은 이름 탐침(접두 · 거울)은 평범한 상대 이름 cand 에만 — `~/` · `/` · `./` · `../` cand 는 탐침 없음", () => {
  for (const w of ["~/notes.md", "/abs/notes.md", "/tmp/notes.md", "./plan.md", "../w/plan.md"]) {
    for (const prev of ["saved under docs/", "see ~/docs/", "see ./"]) {
      const r = pickAt(`x\n${prev}\n${w} end`, w);
      assert.equal(r.cand, w, `${prev} / ${w}`);
      assert.deepEqual(r.longer, [], `${prev} / ${w} → 탐침 없음`);
      assert.equal(fakeOpen(new Set([r.cand]), r.cand, r.longer), `/w/${w}`, "가짜 resolve 로 열린다(탐침 없음 → 옛 논리로 cand 하나만 봄)");
    }
  }
  // 왼쪽 접두도 같다: 이름만 고르면 cand 는 평범한 `plan.md` → 접두 탐침 유지
  assert.deepEqual(pickAt("x\nsee ./plan.md and plan.md", "plan.md").longer, ["./plan.md"]);
  assert.deepEqual(pickAt("x\nsaved under docs/\nplan.md", "plan.md").longer, ["docs/plan.md"]);
  assert.deepEqual(pickAt("x\nsaved under docs/\ndocs/plan.md", "docs/plan.md").longer, ["docs/docs/plan.md"], "폴더가 든 평범한 상대 cand 는 거울을 그대로 낸다(dcChoose 가 기대 경로 하나만 연다)");
});

test("묶인 dcLonger 꼬리: 선택 밖 글자는 8 개까지 · 선택 안 글자는 셈에서 뺀다", () => {
  const t = "x\n보고서.pdf가나다라마바사아자차카타파";
  const r = pickAt(t, "보고서.pdf");
  assert.ok(r.longer.includes("보고서.pdf가나다라마바사아") && !r.longer.includes("보고서.pdf가나다라마바사아자"), "선택 밖 8 글자 상한");
  assert.ok(r.longer.length <= 8 + 1, JSON.stringify(r.longer));
  // 꼬리 3 글자를 선택에 포함하면 선택 밖 8 글자 → 전체 11 글자까지
  const r3 = pickAt(t, "보고서.pdf가나다");
  assert.ok(r3.longer.includes("보고서.pdf가나다라마바사아자차카") && !r3.longer.includes("보고서.pdf가나다라마바사아자차카타"), JSON.stringify(r3.longer));
  for (const p of r3.longer) assert.ok(piecewise(p, t, 2), p);
});

test("묶기 성질: 묶이면 늘 진짜 줄 · 진짜 자리(앞 줄 버림 · 끝 빈 행 · 같은 열 반복 포함) · 묶인 비율", () => {
  const rnd = mulberry(8675309);
  const pick = (a) => a[rnd(a.length)];
  const names = ["a.md", "plan.md", "x.js", "보고서.pdf", "notes.txt", "docs/plan.md", "data.json"];
  const baseFiller = ["ls -1", "x".repeat(37), "한글한글한글한글한글한글", "가a나b다c라d" .repeat(5), "", "│ │", "ok"];
  const st = { cases: 0, bound: 0, nullCases: 0, noRep: 0, noRepBound: 0, noRepFull: 0, noRepFullBound: 0, tail: 0, blank: 0, repeat: 0, over: 0, risk: 0, riskBound: 0, blankFull: 0, aboveBound: 0 };
  for (let it = 0; it < 6000; it++) {
    const cols = pick([10, 20, 40, 80]), rows = pick([8, 24]);
    const filler = rnd(5) < 2 ? [...baseFiller, mismatchLine(rnd, pick, cols), mismatchLine(rnd, pick, cols)] : baseFiller;   // 코드 폭 표와 어긋나는 글자 줄을 섞는다
    const nL = 3 + rnd(50), lines = [];
    const repName = pick(names);
    const uniq = () => pick(["n", "보고", "q_"]) + rnd(1e6) + pick([".md", ".pdf", ".txt"]);   // 거의 겹치지 않는 이름
    while (lines.length < nL) {
      const k = rnd(10);
      if (k < 4) lines.push(`${pick(["", "see ", "│ ", "  ", "- "])}${rnd(3) ? uniq() : pick(names)}${pick(["", "", "를", " end", ":42"])}`);
      else if (k < 6) lines.push(pick(filler));
      else if (k < 8) lines.push(`${pick(filler)} ${rnd(3) ? uniq() : pick(names)} ${pick(filler)}`);   // 긴 줄 → 소프트 랩
      else if (rnd(4) === 0) for (let j = 0, c = 2 + rnd(5); j < c; j++) lines.push(repName);       // 같은 열 반복 이름
    }
    const lay = refLayout(lines.join("\n"), cols, mkTruth(rnd(1e9)));   // 진짜 터미널 = 불확실 글자 폭을 [lo, hi] 안에서 무작위로 정한 것(seed 로 재현)
    const li = rnd(lay.lines.length), line = lay.lines[li];
    const here = [...names, ...(line.match(/(?:n|\uBCF4\uACE0|q_)\d+\.(?:md|pdf|txt)/g) ?? [])].filter(n => line.includes(n));
    if (!here.length) continue;
    const word = pick(here), at = rnd(2) ? line.indexOf(word) : line.lastIndexOf(word);
    const { cells, row0 } = lay.L[li];
    const first = cells.find(c => c.u === at && c.w > 0), lc = [...cells].reverse().find(c => c.u < at + word.length && c.w > 0);
    if (!first || !lc) continue;
    const sel = S(row0 + first.row, first.col, row0 + lc.row, lc.col + lc.w - 1);
    const m = rnd(3) === 0 ? rnd(li + 1) : 0;                                     // 앞 m 줄 버림
    const t = rnd(3) ? 0 : (rnd(6) === 0 ? rows + 1 + rnd(m === 0 ? 6 : 3 * rows) : rnd(rows + 1));   // 끝 빈 행 t ∈ [0, rows] · rows 초과도 일부(안 잘린 읽기는 null 기대 · 잘린 읽기는 닻이 틀린 줄을 가리켜도 진짜 줄 또는 null)
    const kept = lay.lines.slice(m), text = kept.join("\n");
    const cut = m > 0 ? (rnd(2) ? true : dcReadCut(text, kept.length)) : false;
    const total = lay.R + t;
    const bd = dcBind({ sel, cols, rows, text, clip: word, total, cut });
    st.cases++;
    const count = kept.join("\n").split(word).length - 1;
    const rep = count > 1;
    if (m > 0) st.tail++;
    if (t > 0) st.blank++;
    if (rep) st.repeat++;
    if (!cut && t > rows) { st.over++; assert.equal(bd, null, `안 잘린 읽기 + 끝 빈 행 ${t} > rows ${rows} → null it=${it}`); }
    // 폭이 불확실한(= 평범하지 않은) 줄이 있는가: 어디든(risky) · t = 0 후보가 선택 첫 행을 보내는 줄 j0 부터 끝 줄까지(riskBelow — 코드가 null 로 막는 범위)
    const selRow0 = Math.min(sel.start.row, sel.end.row), tgt = Math.max(0, selRow0 - t), j0 = lay.L.findIndex(x => tgt < x.row0 + x.rows);
    const risky = kept.some(l => !PLAIN_LINE.test(l)), riskBelow = lay.lines.slice(Math.max(m, j0)).some(l => !PLAIN_LINE.test(l));
    if (risky) { st.risk++; if (bd) st.riskBound++; }
    if (cut && risky && !riskBelow && bd) st.aboveBound++;   // j0 위 줄만 불확실 — 잘린 읽기는 상관없이 묶인다
    if (bd) {
      st.bound++;
      assert.equal(bd.i, li - m, `줄 어긋남 it=${it} cols=${cols} t=${t} m=${m} cut=${cut} word=${word}\n${JSON.stringify(kept.slice(Math.max(0, li - m - 2), li - m + 3))}`);
      assert.equal(bd.a, at, `줄 안 자리 it=${it}`);
      assert.equal(bd.lines[bd.i].slice(bd.a, bd.b), word);
    } else st.nullCases++;
    if (!rep) {
      st.noRep++; if (bd) st.noRepBound++;
      if (!cut && m === 0 && t <= rows && !risky) { st.noRepFull++; if (bd) st.noRepFullBound++; if (t > 0) st.blankFull++; }
    }
  }
  assert.equal(st.noRepFullBound, st.noRepFull, "반복 낱말이 없고 전체 글이고 끝 빈 행 ≤ rows 이고 폭이 어긋나는 줄이 없으면 늘 묶인다: " + JSON.stringify(st));
  assert.ok(st.cases > 3000 && st.tail > 300 && st.blank > 500 && st.repeat > 300 && st.noRep > 1500, JSON.stringify(st));
  assert.ok(st.over > 100 && st.risk > 300 && st.riskBound > 50 && st.blankFull > 200 && st.aboveBound > 20, "어긋남 글자 · rows 초과 · 끝 빈 행이 충분히 섞였다: " + JSON.stringify(st));
  assert.ok(st.noRepBound / st.noRep > 0.6, "묶인 비율이 너무 낮다: " + JSON.stringify(st));
  assert.ok(st.nullCases > 100, "가드가 아무것도 안 막는다: " + JSON.stringify(st));
  console.log("[property stats]", JSON.stringify(st));
});

// ───────── 2차 리뷰 재현(고치기 전 실패 → 고친 뒤 통과) ─────────
test("재현 (a) 태국어 결합 글자 과다 계산: 줄 3 이 진짜 — 줄 4 에 묶이면 안 된다", () => {
  const text = ["zz", "zz", "docs/", "a.md", "a.md", "กิ".repeat(6)].join("\n") + "\n";
  for (const cut of [false, true]) {
    const r = dcBind({ sel: S(3, 0, 3, 3), cols: 10, rows: 5, text, clip: "a.md", total: 6, cut });
    assert.ok(r === null || r.i === 3, `cut=${cut} i=${r?.i}`);
  }
});

test("재현 (b) 그림 글자 과소 계산 ≥ rows: 진짜 100 번 줄 — 76 번 줄에 묶이면 안 된다", () => {
  const lines = Array.from({ length: 102 }, (_, i) => (i === 76 || i === 100 ? "a.md" : i === 101 ? ".bak" : `f${i}`));
  for (let k = 0; k < 24; k++) lines.push("✅".repeat(80));
  const text = lines.join("\n"), cols = 80;
  const total = refLayout(text, cols).R;
  assert.equal(total, 102 + 48);
  const r = dcBind({ sel: S(100, 0, 100, 3), cols, rows: 24, text, clip: "a.md", total, cut: false });
  assert.ok(r === null || r.i === 100, `i=${r?.i}`);
});

test("재현 (c) 끝 빈 행 = rows: 진짜 줄 7 — 줄 2 에 묶이면 안 된다", () => {
  const text = ["h0", "h1", "see a.md", "plain", "x3", "x4", "x5", "see a.md", ".bak", "y1", "y2", "y3"].join("\n");
  const r = dcBind({ sel: S(7, 4, 7, 7), cols: 40, rows: 5, text, clip: "a.md", total: 12 + 5, cut: false });
  assert.ok(r === null || r.i === 7, `i=${r?.i}`);
});

test("재현 (d) 위의 큰 줄(1e6 자): 위 붙임이어도 묶지 않고 걸음이 짧다", () => {
  const text = ["가".repeat(1e6), "x", "see a.md now"].join("\n");
  const t0 = Date.now();
  const r = dcBind({ sel: S(25001, 4, 25001, 7), cols: 80, rows: 24, text, clip: "a.md", total: 25002 + 3, cut: false });
  const ms = Date.now() - t0;
  assert.equal(r, null);
  // gstack-timing-ok: 위의 큰 줄(1e6 자)은 걷지 않고 null — 200 ms 는 걸으면(수백 ms) 넘는 상한
  assert.ok(ms < 200, `${ms} ms`);
});

test("재현 (e) 선택한 9 글자 꼬리: 탐침에 들고 두 파일이 다 있으면 열지 않는다", () => {
  const text = "x\na.md가나다라마바사아자를";
  const word = "a.md가나다라마바사아자";
  const r = pickAt(text, word);
  assert.equal(r.cand, "a.md");
  assert.ok(r.longer.includes(word), JSON.stringify(r.longer));
  assert.equal(fakeOpen(new Set(["a.md", word]), r.cand, r.longer), null);
});

// ───────── 3차 리뷰 재현(고치기 전 실패 → 고친 뒤 통과) ─────────
// 가짜 resolve(두 파일 다 있음)로 dcPick → dcLonger → dcChoose 까지 돌린다. 묶임이 null 이면 옛 길(글 전체)로 간다.
const openVia = ({ text, sel, clip, total, cols = 80, rows = 24, cut = false, exist = ["a.md", "a.md.bak"] }) => {
  const bd = dcBind({ sel, cols, rows, text, clip, total, cut });
  const cand = dcPick({ clip, sel, cols, text, bd });
  const longer = cand === null ? [] : dcLonger({ clip, sel, text, cand, bd });
  return { bd, cand, open: cand === null ? null : fakeOpen(new Set(exist), cand, longer) };
};

test("재현 P1 칸 밀림: 폭 불확실 글자(태국어) 뒤 이름 — 묶지 않고 아무것도 안 연다", () => {
  const text = "กิ".repeat(5) + " a.md a.md\n.bak";
  const r = openVia({ text, sel: S(0, 11, 0, 14), clip: "a.md", total: 2, rows: 2 });
  assert.equal(r.bd, null);
  assert.equal(r.open, null);
});

test("재현 P1b 폭 불확실 글자가 이름 앞에 있는 같은 줄 미끼 — 태국어 폭 0 · 1 · 2 어느 조합에서도 묶지 않는다", () => {
  const text = "กิ".repeat(3) + " a.md a.md";
  for (const wa of [0, 1, 2]) for (const wb of [0, 1, 2]) {
    const c1 = 3 * (wa + wb) + 1, c2 = c1 + 5;
    for (const c of [c1, c2]) assert.equal(dcBind({ sel: S(0, c, 0, c + 3), cols: 80, rows: 24, text, clip: "a.md", total: 1 }), null, `wa=${wa} wb=${wb} c=${c}`);
  }
});

test("재현 P1c 1 칸 글자 + FE0F 앞은 불확실 → 묶지 않음 · 2 칸 글자 + FE0F 앞은 확실 → 진짜 자리에 묶임", () => {
  // ✔(1 칸) + FE0F: 실측 2 칸이지만 표에서는 불확실
  assert.equal(dcBind({ sel: S(0, 3, 0, 6), cols: 80, rows: 24, text: "✔️ a.md", clip: "a.md", total: 1 }), null);
  // ✅(2 칸) + FE0F: 앞 칸에 붙는다 → 2 칸 · 이름은 3 열
  const ok = dcBind({ sel: S(0, 3, 0, 6), cols: 80, rows: 24, text: "✅️ a.md", clip: "a.md", total: 1 });
  assert.deepEqual([ok?.i, ok?.a, ok?.b], [0, 3, 7]);
  // 이름 «뒤» 결합 글자: 폭 0 확실(U+0301)은 범위에 붙고 · 불확실(태국어 결합)은 묶지 않는다
  assert.equal(dcBind({ sel: S(0, 0, 0, 3), cols: 80, rows: 24, text: "a.mdิ x", clip: "a.md", total: 1 }), null);
  // 이름 뒤 FE0F: 앞 글자가 1 칸이면 불확실
  assert.equal(dcBind({ sel: S(0, 0, 0, 3), cols: 80, rows: 24, text: "a.md️ x", clip: "a.md", total: 1 }), null);
});

test("재현 P2 위 줄 행 수 불확실 + 같은 열 미끼: 안 잘린 읽기는 글 안 어느 줄이든 행 수 불확실이면 null", () => {
  const lines = ["ก".repeat(200), ...Array.from({ length: 30 }, (_, i) => `f${i}`), "กิ a.md", "  .bak", "x a.md", "end"];
  const r = openVia({ text: lines.join("\n"), sel: S(33, 2, 33, 5), clip: "a.md", total: 37 });
  assert.equal(r.bd, null);
  assert.equal(r.open, null);
});

test("재현 P3 잘린 읽기 + 끝 빈 행 60(> rows): 40 번 줄 미끼에 묶이지 않는다", () => {
  const lines = Array.from({ length: 300 }, (_, i) => `l${i}`);
  lines[40] = "a.md"; lines[100] = "a.md"; lines[101] = ".bak";
  const r = openVia({ text: lines.join("\n"), sel: S(740, 0, 740, 3), clip: "a.md", total: 1000, cut: true });
  assert.equal(r.bd, null);
  assert.equal(r.open, null);
});

test("재현 P4 멈춤: 긴 한 줄 위쪽 보이는 행 — 걸음이 rows 에 비례하지 않는다 · 큰 rows 도 빠르다", () => {
  const mk = (ch, cols, rows) => {
    const L = 60000, lr = Math.ceil(L / cols), total = lr + 1, top = total - rows, pos = top * cols + 10;
    return { text: ch.repeat(pos) + " a.md " + ch.repeat(L - pos - 6) + "\n$ ", sel: S(top, 11, top, 14), total, cols, rows };
  };
  const time = (ch, cols, rows) => { const x = mk(ch, cols, rows); const t0 = performance.now(); const bd = dcBind({ sel: x.sel, cols, rows, text: x.text, clip: "a.md", total: x.total, cut: false }); return { ms: performance.now() - t0, bd }; };
  time("x", 83, 29);                                   // 예열
  const a = time("x", 83, 2), b = time("x", 83, 200);
  // gstack-timing-ok: ASCII 60000 자 한 줄(빠른 길 · 칸 걸음만) — rows 200 이 rows 2 의 8 배 + 50 ms 안(걸음이 rows 에 비례하면 훨씬 넘는다)
  assert.ok(b.ms < 8 * a.ms + 50, `rows 2 = ${a.ms.toFixed(0)} ms · rows 200 = ${b.ms.toFixed(0)} ms`);
  const c = time("Ж", 83, 29);
  // gstack-timing-ok: Ж 60000 자 — 행 걸음 + 칸 걸음이 예산(64K)을 넘으면 null 로 바로 끝난다 · 200 ms 는 넉넉한 상한
  assert.ok(c.ms < 200, `Ж rows 29 = ${c.ms.toFixed(0)} ms`);
  assert.equal(c.bd, null, "Ж 60000 자 한 줄 = 행 걸음 60000 + 칸 걸음 60000 > DC_WALK_MAX → 옛 길");
  const ж = mk("Ж", 83, 29);
  assert.equal(ж.text.length, 60000 + 3);
  assert.equal(c.bd === null || c.bd.a === ж.text.indexOf(" a.md ") + 1, true, "묶이면 진짜 자리(예산 안이면)");
});

// ───────── 묶음 위험 줄(cluster hazard) — Herdr 는 폭을 글자 묶음(grapheme cluster) 단위로 잰다 ─────────
// 실측(Herdr 0.1.16): 🚀‍🔥 = 2 칸(표 합 4) · ✅‍✅ = 2 · ✅︎(FE0E) = 1(표 2) · ᄀᄀ = 1(표 4) · ✋🏻 · 👋🏻 · 🚴🏻 = 2 · 🇰🇷 = 2. 그런 열이 든 줄은 칸 걸음 · 행 수를 믿지 않는다.
test("묶음 위험 줄: ZWJ · VS15 · 피부색 · 첫소리 겹침 앞 이름 — 어느 열을 골라도 null 이거나 진짜 줄 · 같은 열 미끼가 있어도", () => {
  for (const U of ["🚀‍🔥", "✅︎", "🚴\u{1F3FB}", "ᄀᄀ", "✅‍✅", "👋\u{1F3FB}"]) {
    const lines = [`${U} a.md`, `${U} a.md`, "   a.md", "      a.md"];
    const text = lines.join("\n");
    for (const rows of [4, 24]) for (let r = 0; r < lines.length; r++) for (let c = 0; c <= 14; c++) {
      for (const extra of [0, 3]) {
        const bd = dcBind({ sel: S(r, c, r, c + 3), cols: 80, rows, text, clip: "a.md", total: lines.length + extra, cut: false });
        assert.ok(bd === null || (bd.i === r && bd.lines[bd.i].indexOf("a.md") === bd.a), `U=${JSON.stringify(U)} r=${r} c=${c} extra=${extra} i=${bd?.i}`);
        if (bd && r < 2) assert.fail(`묶음 위험 줄에 묶임 U=${JSON.stringify(U)} r=${r} c=${c}`);
      }
    }
  }
  // 위 반복은 열 6 · 표 걸음이 불확실해 자체 검사에서 null 이 되는 경우가 섞여 있다 — 표 걸음 기준 진짜 열(U 합 4 칸 + 공백 → 열 5)에서도 «위험 줄이라서» null 인지 대조로 본다
  for (const U of ["🚀‍🔥", "ᄀᄀ", "✅‍✅"]) {
    const sel = S(0, 5, 0, 8);
    assert.equal(dcBind({ sel, cols: 80, rows: 4, text: "xxxx a.md\n   a.md", clip: "a.md", total: 2, cut: false })?.i, 0, `대조(같은 칸 수 평범한 글) U=${JSON.stringify(U)}`);
    for (const cut of [false, true]) assert.equal(dcBind({ sel, cols: 80, rows: 4, text: `${U} a.md\n   a.md`, clip: "a.md", total: 2, cut }), null, `표 걸음 열 5 · 위험 줄 U=${JSON.stringify(U)} cut=${cut}`);
  }
});

test("묶음 위험 줄 종류마다: 위 줄(길이 > cols / 2 · 행 수는 하한 = 상한처럼 보임)이 위험이면 null — ZWJ · VS15 · 피부색 · 첫소리 겹침 · 홀로 된 중성(V/T)", () => {
  // 각 줄: 위 줄 = 평범한 글 45 자 + 위험 글자(빠른 길 밖 · lr = hr = 1 행) · 아래 줄 = 이름. 위험 판정이 없으면 행 수가 «확실» 이라 아래 줄에 묶인다
  const kinds = { ZWJ: "🚀‍🔥", VS15: "✅︎", 피부색: "🚴\u{1F3FB}", 첫소리겹침: "ᄀᄀ", 홀로중성: "ᅡ" };
  for (const [name, U] of Object.entries(kinds)) {
    const above = "h".repeat(45) + U, ctl = "h".repeat(45) + "yy";
    for (const cut of [false, true]) {
      assert.equal(dcBind({ sel: S(1, 4, 1, 7), cols: 80, rows: 24, text: `${ctl}\nsee a.md`, clip: "a.md", total: 2, cut })?.i, 1, `대조(위험 아닌 글) ${name} cut=${cut}`);
      assert.equal(dcBind({ sel: S(1, 4, 1, 7), cols: 80, rows: 24, text: `${above}\nsee a.md`, clip: "a.md", total: 2, cut }), null, `${name} cut=${cut}`);
    }
  }
});

test("묶음 위험 줄: 가드 범위 안 위험 줄 미끼 — 표 열이 선택 열과 달라도(Herdr 실제 열은 같을 수 있다) 묶지 않는다", () => {
  // 미끼 줄(짧은 위험 줄 · 1 행) 의 a.md 는 표 열 5 · 선택은 아래 줄 열 3 · 총 행 +3 이라 가드 범위가 미끼 줄을 덮는다
  for (const U of ["🚀‍🔥", "ᄀᄀ"]) {
    const run = (decoy) => dcBind({ sel: S(1, 3, 1, 6), cols: 80, rows: 24, text: `${decoy} a.md\n   a.md`, clip: "a.md", total: 5, cut: false });
    assert.equal(run("xxxx")?.i, 1, `대조(평범한 미끼 · 열이 달라 모호하지 않다) U=${JSON.stringify(U)}`);
    assert.equal(run(U), null, `위험 줄 미끼 U=${JSON.stringify(U)}`);
  }
});

test("묶음 위험 줄: 행 수 — 짧은 줄(2 * 길이 ≤ cols)은 1 행 그대로 · 긴 줄은 불확실이라 안 잘린 읽기는 null", () => {
  const long = "🚀‍🔥".repeat(30) + " a.md";                       // 길이 > 40 → 빠른 길 밖
  assert.equal(dcBind({ sel: S(1, 3, 1, 6), cols: 80, rows: 24, text: `${long}\nq a.md`, clip: "a.md", total: 2 }), null, "위 줄이 위험 → 행 수 불확실 → null");
  assert.equal(dcBind({ sel: S(1, 3, 1, 6), cols: 80, rows: 24, text: `${long}\nq a.md`, clip: "a.md", total: 2, cut: true }), null, "잘린 읽기도 위험 줄은 글 어디에 있든 null");
  const ok = dcBind({ sel: S(1, 2, 1, 5), cols: 80, rows: 24, text: "🚀‍🔥\nq a.md", clip: "a.md", total: 2 });
  assert.equal(ok?.i, 1, "짧은 위험 줄은 빠른 길로 1 행 — 위에 있어도 닻에 지장 없다");
});

test("묶음 위험 줄: NFD 한글(L V · L V T · macOS 파일 이름 꼴)은 위험이 아니다 — 진짜 줄에 묶인다", () => {
  const name = "한글.md";            // 한글.md (NFD)
  const text = `x\nsee ${name} end`;
  const r = pickAt(text, name);
  assert.equal(r.bd?.i, 1);
  assert.equal(r.cand, name);
  // 홀로 된 중성 · 종성(앞이 한글이 아님) · 첫소리 + 첫소리 · 첫소리 + 완성형은 위험
  for (const bad of ["ᅡ", "xᆫ", "ᄀᄀ", "ᄀ가"]) assert.equal(dcBind({ sel: S(1, 6, 1, 9), cols: 80, rows: 24, text: `x\nab ${bad} a.md`, clip: "a.md", total: 2 }), null, JSON.stringify(bad));
});

// ───────── 5차 리뷰 재현: 걸음 예산(DC_WALK_MAX) · 묶음 위험 줄은 «하한» 이 아니다(고치기 전 실패 → 고친 뒤 통과) ─────────
// 한 번의 더블클릭이 지나는 «느린 걸음»(행 수 cpRange 루프 · 묶인 줄 칸 걸음 · 가드 걸음) 합이 DC_WALK_MAX(UTF-16 단위)를 넘으면 dcBind 는 null(옛 길). 시험 글은 전부 합성이다.
function capCases() {   // 예산을 넘기는 입력들 — 자식 프로세스(jitless 시간)에서도 같은 함수를 쓴다(toString 으로 옮긴다)
  const S2 = (r0, c0, r1, c1) => ({ start: { row: r0, col: c0 }, end: { row: r1, col: c1 } });
  const out = [], CAP = 512 * 1024;
  for (const [name, ch, w] of [["키릴", "Ж", 1], ["태국어", "ก", 1], ["한글", "가", 2]]) {
    const L = 1000, nLines = Math.floor((CAP - 20) / (L + 1));
    const lines = Array(nLines).fill(ch.repeat(L)); lines.push("see a.md", "$ ");
    const R = nLines * Math.ceil((L * w) / 80) + 2;
    out.push({ name: `${name} 512K 아래 붙임`, text: lines.join("\n"), sel: S2(R - 2, 4, R - 2, 7), total: R, cut: true, cols: 80, rows: 24 });
  }
  { const lines = ["a.md", "filler", ...Array(500).fill("Ж".repeat(1000))];
    out.push({ name: "Codex 입력(위 줄 이름 + 키릴 500 줄)", text: lines.join("\n"), sel: S2(0, 0, 0, 3), total: 6502, cut: false, cols: 80, rows: 24 }); }
  { const lines = [...Array(300).fill("Ж".repeat(1000)), "see a.md", "$ "], R = 300 * 13 + 2;
    out.push({ name: "기본 300 줄 읽기(키릴 300 줄 아래 붙임)", text: lines.join("\n"), sel: S2(R - 2, 4, R - 2, 7), total: R, cut: true, cols: 80, rows: 24 }); }
  { const cols = 83, rows = 29, L = 65000, total = Math.ceil(L / cols) + 1, top = total - rows, head = "─".repeat(top * cols + 10) + " a.md ";   // 64K 한 줄 · 이름 두 번(묶인 줄 걸음 + 가드 걸음)
    out.push({ name: "64K 한 줄 ─ 이름 두 번", text: head + "─".repeat(L - head.length - 11) + "─".repeat(7) + "a.md\n$ ", sel: S2(top, 11, top, 14), total, cut: false, cols, rows }); }
  return out;
}

test("예산 DC_WALK_MAX: 느린 걸음 합이 64K 단위를 넘는 입력은 묶지 않는다(null · 결정적) — 512K 키릴 · 태국어 · 한글 · Codex 입력 · 300 줄 · 64K 한 줄", () => {
  assert.equal(DC_WALK_MAX, 64 * 1024);
  const cases = capCases();
  assert.equal(cases.length, 6);
  for (const c of cases) assert.equal(dcBind({ sel: c.sel, cols: c.cols, rows: c.rows, text: c.text, clip: "a.md", total: c.total, cut: c.cut }), null, c.name);
});

test("예산 안 보통 경우는 계속 묶인다: 한글 300 줄 아래 붙임 · ASCII 60000 자 한 줄 · 키릴 한 줄 약 30000 자", () => {
  const lines = Array.from({ length: 300 }, (_, i) => "가나다 ".repeat(15) + i); lines.push("see a.md", "$ ");
  const R = 300 * 2 + 2;
  assert.equal(dcBind({ sel: S(R - 2, 4, R - 2, 7), cols: 80, rows: 24, text: lines.join("\n"), clip: "a.md", total: R, cut: true })?.i, 300, "보통 한글 300 줄");
  const L = 60000, cols = 83, rows = 29, total = Math.ceil(L / cols) + 1, top = total - rows, pos = top * cols + 10;
  const x = "x".repeat(pos) + " a.md " + "x".repeat(L - pos - 6) + "\n$ ";
  assert.equal(dcBind({ sel: S(top, 11, top, 14), cols, rows, text: x, clip: "a.md", total, cut: false })?.a, pos + 1, "ASCII 60000 → 진짜 자리");
  const K = 30000, tK = Math.ceil(K / cols) + 1, topK = tK - rows, posK = topK * cols + 10;
  const ж = "Ж".repeat(posK) + " a.md " + "Ж".repeat(K - posK - 6) + "\n$ ";
  assert.equal(dcBind({ sel: S(topK, 11, topK, 14), cols, rows, text: ж, clip: "a.md", total: tK, cut: false })?.a, posK + 1, "키릴 30000 한 줄(행 걸음 30000 + 칸 걸음 30000 ≤ 64K)");
});

test("예산: 합이 정확히 DC_WALK_MAX 이하면 묶이고 하나 넘으면 null — 행 걸음 + 칸 걸음 경계", () => {
  // 줄 0 = 키릴 K 자(느린 걸음) · 줄 1 = 키릴 40 자 + 이름(45 자 > cols / 2 → 행 걸음도 느린 길 · 묶인 줄 칸 걸음 · 가드 찾기 값 ceil(45 × 5 ÷ DC_FIND_DIV) = 1). 합 = 줄 0 K + 줄 1 길이 × 2 + 1
  const run = (k) => {
    const l0 = "Ж".repeat(k), l1 = "Ж".repeat(40) + " a.md";
    const r0 = Math.ceil(k / 80), R = r0 + 1;
    return dcBind({ sel: S(r0, 41, r0, 44), cols: 80, rows: 24, text: `${l0}\n${l1}`, clip: "a.md", total: R, cut: false });
  };
  const l1len = 45, fit = DC_WALK_MAX - 2 * l1len - 1;
  assert.equal(run(fit)?.i, 1, "합 = DC_WALK_MAX → 묶인다");
  assert.equal(run(fit + 1), null, "합 = DC_WALK_MAX + 1 → null");
});

test("jitless 시간: 예산 넘는 입력 여섯 개 각각 dcBind 한 번이 150 ms 미만(자식 프로세스 node --jitless · 합성 글)", async () => {
  const href = new URL("../files-plus/termfiles.js", import.meta.url).href;
  const src = `import { dcBind } from ${JSON.stringify(href)};
const capCases = ${capCases.toString()};
const res = [];
for (const c of capCases()) {
  let m = Infinity;
  for (let k = 0; k < 2; k++) { const t0 = performance.now(); dcBind({ sel: c.sel, cols: c.cols, rows: c.rows, text: c.text, clip: "a.md", total: c.total, cut: c.cut }); m = Math.min(m, performance.now() - t0); }
  res.push({ name: c.name, ms: m });
}
console.log(JSON.stringify(res));`;
  const out = await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ["--jitless", "--input-type=module", "-e", src], { stdio: ["ignore", "pipe", "pipe"] });
    const o = [], e = [];
    p.stdout.on("data", d => o.push(d)); p.stderr.on("data", d => e.push(d));
    p.on("error", reject);
    p.on("close", code => code === 0 ? resolve(Buffer.concat(o).toString("utf8")) : reject(new Error(`자식 종료 ${code}: ${Buffer.concat(e).toString("utf8").slice(0, 300)}`)));
  });
  const res = JSON.parse(out);
  assert.equal(res.length, 6);
  // gstack-timing-ok: jitless 해석기에서 입력당 예산(64K 단위)만 걷는다 — 예산이 없으면 400 ms 넘는다
  for (const r of res) assert.ok(r.ms < 150, `${r.name} = ${r.ms.toFixed(0)} ms`);
});

test("묶음 위험 줄은 «하한» 이 아니다: 잘린 읽기 j0 위 위험 줄(진짜 행 수가 표보다 적다) — 선택 한 행 위 미끼에 묶이지 않는다 · 잘못 열지 않는다", () => {
  // 줄 0 = 위험 줄(표 하한 82 칸 = 2 행 · Herdr 실측 80 칸 = 1 행) · 줄 1..300 = x0.. · 미끼 plan.md(b 행 위) · 누른 plan.md + .bak · 끝 빈 행 b 개(hc read 가 잘라 냄)
  const H = "h".repeat(62) + "\u{1F680}‍\u{1F525}".repeat(5);
  for (const b of [1, 4]) {
    const lines = [H];
    for (let i = 0; i < 300; i++) lines.push("x" + i);
    lines.push("plan.md");
    for (let i = 1; i < b; i++) lines.push("y" + i);
    const iT = lines.length; lines.push("plan.md", ".bak", "$ ");
    const text = lines.join("\n"), total = lines.length + b, cut = dcReadCut(text, 300);
    assert.equal(cut, true);
    const r = openVia({ text, sel: S(iT, 0, iT, 6), clip: "plan.md", total, cut, exist: ["plan.md", "plan.md.bak"] });
    assert.equal(r.bd, null, `b=${b}`);
    assert.equal(r.open, null, `b=${b}: 032f193 처럼 .bak 탐침이 있어 열지 않는다`);
    // 위험 줄이 짧으면(2 * 길이 ≤ cols · 빠른 길 1 행) 옛 동작: 묶이거나 null — 잘못 열지 않는다
    const short = lines.slice(); short[0] = "h\u{1F680}‍\u{1F525}";
    const st = short.join("\n");
    const q = openVia({ text: st, sel: S(iT, 0, iT, 6), clip: "plan.md", total, cut: dcReadCut(st, 300), exist: ["plan.md", "plan.md.bak"] });
    assert.ok(q.bd === null || q.bd.i === iT, `b=${b} 짧은 위험 줄: i=${q.bd?.i}`);
    assert.equal(q.open, null, `b=${b} 짧은 위험 줄: .bak 탐침`);
  }
});

test("묶음 위험 줄(잘린 읽기): 위험 줄이 글 어디에 있든 null · 위험 아닌 불확실 줄은 j0 위에서 계속 허용", () => {
  const H = "h".repeat(62) + "\u{1F680}‍\u{1F525}".repeat(5);
  const base = Array.from({ length: 300 }, (_, i) => "x" + i);
  const mk = (extra, pos) => { const l = base.slice(); l[pos] = extra; l.push("see a.md", "$ "); return l.join("\n"); };
  const sel = S(301, 4, 301, 7);   // 줄 300 = see a.md · 끝 빈 행 1 → 위험 줄이 든 글은 표 행 수 303 · total 303(d = 0)
  for (const pos of [0, 150, 299]) assert.equal(dcBind({ sel, cols: 80, rows: 24, text: mk(H, pos), clip: "a.md", total: 303, cut: true }), null, `위험 줄 위치 ${pos}`);
  // 대조: 위험 아닌 불확실 줄(태국어 · 폭 [0, 2])은 j0 위(줄 0)에서 허용 — 오차가 상쇄된다
  const th = "ก".repeat(60);
  assert.equal(dcBind({ sel, cols: 80, rows: 24, text: mk(th, 0), clip: "a.md", total: 303, cut: true })?.i, 300, "위험 아닌 불확실 줄은 계속 허용");
});

// ── 표가 «확실» 이라 했지만 Herdr 가 다르게 그리는 글자(WIDE_UNSURE · ZERO_UNSURE) · 가드 찾기 예산 ──
// 낱말 위 줄이 표 행 수를 한 행 더 세면 같은 열의 미끼 줄에 묶여 032f193 이 거부하던 파일을 연다 → 미끼에 묶이면 안 된다(null 이거나 진짜 줄).
const decoyText = (X, name = "a.md") => [X, `${name} is here`, name, ".bak"].join("\n");
const notDecoy = (bd, ok, msg) => assert.ok(bd === null || bd.i === ok, `${msg}: 미끼에 묶임 i=${bd?.i}`);
const decoyBind = (X, name = "a.md") => dcBind({ sel: S(2, 0, 2, name.length - 1), cols: 80, rows: 24, text: decoyText(X, name), clip: name, total: 24, cut: false });
const CUT_LINES = (X) => [...Array.from({ length: 296 }, (_, i) => "x" + i), "a.md", "a.md is here", ".bak", X];   // 진짜 줄 = 296 · 미끼 = 297 · X 는 선택 «아래»

test("표와 다르게 그려지는 글자 위 줄: 미끼 줄에 묶이지 않는다(안 잘린 읽기 · plan.md · 잘린 읽기)", () => {
  for (const [label, X] of [["U+3248", "\u3248".repeat(41)], ["U+FF00", "\uFF00".repeat(41)], ["U+3097", "\u3097".repeat(41)], ["U+3164", "x" + "\u3164".repeat(40)], ["U+115F", "x" + "\u115Fy".repeat(27)]]) {
    notDecoy(decoyBind(X), 2, `uncut ${label}`);
  }
  notDecoy(decoyBind("\u3248".repeat(41), "plan.md"), 2, "plan.md");
  // 잘린 읽기(아래 붙임): 선택 아래 줄의 과대 행 수가 오프셋을 한 칸 밀어 바로 아래 미끼에 묶이던 것(표 R = 301 → d = 0 · 진짜 R = 300 → d = 1).
  const text = CUT_LINES("\u3248".repeat(41)).join("\n");
  assert.equal(dcReadCut(text, 300), true);
  notDecoy(dcBind({ sel: S(297, 0, 297, 3), cols: 80, rows: 24, text, clip: "a.md", total: 301, cut: true }), 296, "cut");
});

// 표 범위 끝점 두 개씩 — WIDE_UNSURE · ZERO_UNSURE 와 같은 목록(cpRange 는 내보내지 않는다 → dcBind 효과로 본다).
const WIDE_EDGES = [[0x115f, 0x115f], [0x2e9a, 0x2e9a], [0x2ef4, 0x2eff], [0x2fd6, 0x2fef], [0x3097, 0x3098], [0x3100, 0x3104], [0x3130, 0x3130], [0x3164, 0x3164], [0x318f, 0x318f], [0x31e6, 0x31ee], [0x321f, 0x321f], [0x3248, 0x324f], [0xa48d, 0xa48f], [0xa4c7, 0xa4cf], [0xa97d, 0xa97f], [0xfe53, 0xfe53], [0xfe67, 0xfe67], [0xfe6c, 0xfe6f], [0xff00, 0xff00], [0x2fffe, 0x2ffff]];
const ZERO_EDGES = [[0x1ade, 0x1adf], [0x1aec, 0x1aff], [0x20f1, 0x20ff], [0x302e, 0x302f], [0xd7c7, 0xd7ca], [0xd7fc, 0xd7ff]];

test("WIDE 예외 글자(표 2 · 진짜 0–1): 그 글자가 든 줄이 위에 있어도 미끼 줄에 묶이지 않는다 — 범위 양 끝", () => {
  for (const [lo, hi] of WIDE_EDGES) for (const cp of new Set([lo, hi])) {
    const ch = String.fromCodePoint(cp);
    notDecoy(decoyBind((ch + "y").repeat(27)), 2, `U+${cp.toString(16)}`);   // 표 3 × 27 = 81 칸(2 행) · 진짜 ≤ 54 칸(1 행)
  }
});

test("ZERO 예외 글자(표 0 · 진짜 ≥ 1): 묶인 줄에서 낱말 앞에 있으면 칸을 믿지 않는다(null) — 범위 양 끝", () => {
  for (const [lo, hi] of ZERO_EDGES) for (const cp of new Set([lo, hi])) {
    const ch = String.fromCodePoint(cp);
    const text = "\uAC00" + ch + " a.md";   // 가 + 예외 글자 + 공백 + 낱말(표대로면 낱말은 3 열 · 진짜는 4 열 이후일 수 있다)
    assert.equal(dcBind({ sel: S(0, 3, 0, 6), cols: 80, rows: 24, text, clip: "a.md", total: 1, cut: false }), null, `U+${cp.toString(16)}`);
  }
});

test("가드 찾기 예산: 가드 범위의 긴 16 비트 줄 indexOf 는 걸음 예산에 든다(QuickJS 는 길이 × 낱말 길이) — 긴 줄이면 null · 짧으면 그대로 묶인다", () => {
  const name = "a".repeat(597) + ".md";
  const mk = (n0) => {
    const l0 = "\u0100" + "a".repeat(n0), text = [l0, "x", name].join("\n");
    const r0 = Math.ceil(l0.length / 200), top = r0 + 1;   // 줄 0 = r0 행 · 줄 1 = 1 행 · 줄 2 = 3 행
    return dcBind({ sel: S(top, 0, top + 2, 199), cols: 200, rows: 50, text, clip: name, total: r0 + 1 + 3 + 5, cut: false });
  };
  assert.equal(mk(450000), null, "긴 줄 0 은 가드에서 걷기 전에 예산 초과");
  assert.equal(mk(100)?.i, 2, "대조: 줄 0 이 짧으면 묶인다");
});

// ── 7차: 가드 찾기 값(DC_FIND_DIV) · 도달 거리 · 홀로 첫소리 자모 ──
// indexOf 를 감싸 한 번의 dcBind 안 순진한 탐색 비용(Σ 받는 글 길이 × 낱말 길이)을 센다.
function findCost(run) {
  const orig = String.prototype.indexOf;
  let sum = 0;
  String.prototype.indexOf = function (needle, ...rest) { sum += this.length * String(needle).length; return orig.call(this, needle, ...rest); };
  try { run(); } finally { String.prototype.indexOf = orig; }
  return sum;
}

test("가드 찾기 값: indexOf 비용 Σ(줄 길이 × 낱말 길이)가 DC_WALK_MAX × DC_FIND_DIV 이하 — 찾기 «전에» · 낱말 길이를 곱해 뺀다", () => {
  assert.equal(DC_FIND_DIV, 1024);
  const name = "a".repeat(597) + ".md";
  const mk = (n0) => {
    const l0 = "\u0100" + "a".repeat(n0), text = [l0, "x", name].join("\n");
    const r0 = Math.ceil(l0.length / 200), top = r0 + 1;
    return dcBind({ sel: S(top, 0, top + 2, 199), cols: 200, rows: 50, text, clip: name, total: r0 + 1 + 3 + 5, cut: false });
  };
  // 누적 입력: 62000 자 줄 두 개 + 이름 줄(줄마다 찾기 값을 빼야 합이 예산 안 — 빼지 않거나 빼기를 잊으면 Σ 가 두 배)
  const f3 = () => dcBind({ sel: S(620, 0, 622, 199), cols: 200, rows: 700, text: ["a".repeat(62000), "a".repeat(62000), name].join("\n"), clip: name, total: 1244, cut: false });
  let res;
  assert.ok(findCost(() => { res = mk(450000); }) <= DC_WALK_MAX * DC_FIND_DIV, "450K 줄: 찾기 전에 예산 초과 → 탐색 0");
  assert.equal(res, null);
  assert.ok(findCost(() => { f3(); }) <= DC_WALK_MAX * DC_FIND_DIV, "62000 자 줄 두 개 × 낱말 600 자 누적");
  assert.ok(findCost(() => { res = mk(100); }) <= DC_WALK_MAX * DC_FIND_DIV);
  assert.equal(res?.i, 2, "대조: 짧으면 묶인다");
});

test("가드 등장 줄 전체 값: 등장이 있는 가드 줄은 줄 길이 전체를 위험 줄 검사 «앞» 에서 뺀다 — 한 단위 차로 null ↔ 묶임", () => {
  // 가드 범위 줄 0 = x 가 길고 끝에 a.md · 빈 줄 1 · 묶인 줄 2 = see a.md now. 합 = 묶인 줄 12 + 찾기 ceil(길이 × 4 ÷ DC_FIND_DIV)(줄 0) + 줄 0 길이 전체 + 묶인 줄 찾기 1 (빈 줄 0)
  const run = (pad) => {
    const g = ["x".repeat(DC_WIN_MAX - pad) + "a.md", "", "see a.md now"].join("\n"), Rg = Math.ceil((DC_WIN_MAX - pad + 4) / 80) + 2;
    return dcBind({ sel: S(Rg - 1, 4, Rg - 1, 7), cols: 80, rows: 24, text: g, clip: "a.md", total: Rg + 3, cut: false });
  };
  assert.equal(run(271), null, "줄 길이 전체까지 더하면 예산을 하나 넘는다");
  assert.equal(run(272)?.i, 2, "한 칸 이쪽은 예산 안");
  // 위험 줄 검사(정규식이 줄 전체를 훑는다)는 값을 «낸 뒤» 에만 돈다 — 줄 자체가 예산을 넘긴 경우(pad 270)에서는 큰 줄에 test 를 부르지 않는다
  const orig = RegExp.prototype.test;
  let big = 0;
  RegExp.prototype.test = function (str) { if (String(str).length > 60000) big++; return orig.call(this, str); };
  try { assert.equal(run(270), null); } finally { RegExp.prototype.test = orig; }
  assert.equal(big, 0, "예산 초과 줄은 위험 줄 검사 전에 null");
});

test("WIDE 불확실 글자가 줄 위에 많이 있어도 미끼에 묶이지 않는다 — U+3164 81 개 · 중성이 따르는 U+115F · A97D · A97F 41 쌍(표 4 칸 · 진짜 0–2)", () => {
  notDecoy(decoyBind("\u3164".repeat(81)), 2, "U+3164 x81");
  for (const [label, X] of [["U+115F", "\u115F\u1161".repeat(41)], ["U+A97D", "\uA97D\u1161".repeat(41)], ["U+A97F", "\uA97F\u1161".repeat(41)]]) notDecoy(decoyBind(X), 2, label);   // 중성이 바로 따라 위험 줄이 아니다 → 목록 항목이 «유일한» 방어
  notDecoy(decoyBind("\u3164".repeat(81), "plan.md"), 2, "plan.md");
});

test("홀로 첫소리 자모(U+1100–115F · A960–A97F)는 위험 줄 — 중성 자모가 바로 뒤에 없으면 묶지 않는다 · 표준 NFD 한글은 계속 묶인다", () => {
  // Red Team: 첫소리 + 공백 27 쌍(표 81 칸 = 2 행 · 진짜가 1 칸이면 1 행) 아래 미끼 줄
  const x = ["\u1100 ".repeat(27), "x a.md", "y a.md"].join("\n");
  notDecoy(dcBind({ sel: S(2, 2, 2, 5), cols: 80, rows: 24, text: x, clip: "a.md", total: 4, cut: false }), 2, "첫소리 + 공백");
  const bound = (line) => dcBind({ sel: S(0, 0, 0, 3), cols: 80, rows: 24, text: "a.md " + line, clip: "a.md", total: 1, cut: false });
  for (const [label, h] of [["첫소리 + x", "\u1100x"], ["A960 + x", "\uA960x"], ["줄 끝 첫소리", "\u1100"], ["첫소리 + 끝소리", "\u1100\u11A8"], ["첫소리 겹침", "\u1100\u1100"], ["첫소리 + 완성형", "\u1100\uAC00"]]) assert.equal(bound(h), null, label);
  for (const [label, ok] of [["NFD L+V", "\u1100\u1161"], ["NFD L+V+T", "\u1100\u1161\u11A8"], ["완성형", "\uAC01"], ["A960 + 중성 D7B0", "\uA960\uD7B0"]]) assert.equal(bound(ok)?.i, 0, label);
  assert.equal(bound("\u1100\u1161 \u1100\u1161\u11A8.md")?.i, 0, "macOS 풍 NFD 이름 옆");
  assert.equal(dcBind({ sel: S(0, 0, 0, 6), cols: 80, rows: 24, text: "\u1100\u1161\u11A8\u1100\u1161.md", clip: "\u1100\u1161\u11A8\u1100\u1161.md", total: 1, cut: false })?.i, 0, "NFD 이름 자체를 고른다");
});

test("도달 거리: 잘린 읽기 · 줄 0 이 a.md · 79 자 줄 2000 개가 아래에 있어도 묶인다(가드 찾기 값이 줄당 1 단위)", () => {
  const lines = ["a.md"].concat(Array.from({ length: 2000 }, (_, i) => ("l" + i + " ").padEnd(79, "x")));
  const hist = 50000;
  const bd = dcBind({ sel: S(hist, 0, hist, 3), cols: 80, rows: 40, text: lines.join("\n"), clip: "a.md", total: hist + lines.length, cut: true });
  assert.equal(bd?.i, 0);
});

test("U+2E3B(3 칸 줄표 · 표 [0, 2])는 위험 줄 — 든 줄은 묶지 않고 · 위 줄이어도 실제 줄이 아닌 줄에 묶이지 않는다", () => {
  const X = "a".repeat(78) + "\u2E3B";   // 표: 78–80 칸 = 1 행 확실 · 3 칸이면 2 행
  const bound = (line) => dcBind({ sel: S(0, 0, 0, 3), cols: 80, rows: 24, text: "a.md " + line, clip: "a.md", total: 1, cut: false });
  assert.equal(bound("\u2E3B"), null, "⸻ 가 든 묶인 줄");
  assert.equal(bound("\u2013")?.i, 0, "대조: 다른 줄표는 묶인다");
  for (const total of [4, 5, 24]) for (const row of [2, 3]) {
    const lines = [X, "x a.md", "y a.md"];
    notDecoy(dcBind({ sel: S(row, 2, row, 5), cols: 80, rows: 24, text: lines.join("\n"), clip: "a.md", total, cut: false }), row - 1, `total ${total} row ${row}`);
  }
});

test("U+3164 위 줄(잘린 읽기 · 하한): 선택 아래 줄 수가 달라도 미끼에 묶이지 않는다", () => {
  const lines = ["x" + "\u3164".repeat(80), ...Array.from({ length: 296 }, (_, i) => "x" + i), "a.md is here", "a.md", ".bak"], text = lines.join("\n");
  assert.equal(dcReadCut(text, 300), true);
  notDecoy(dcBind({ sel: S(298, 0, 298, 3), cols: 80, rows: 24, text, clip: "a.md", total: 301, cut: true }), 298, "cut");
});
