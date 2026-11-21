// «터미널에 나온 파일»(termfiles.js) 시험 — candidates · parseResolved 는 순수 함수, RESOLVE_SCRIPT 는 진짜 sh(FP_SH 로 바꿈)로 임시 폴더에서 돌린다.
//   node --test mods/tests/termfiles.test.mjs
// 실제 사용자 홈은 건드리지 않는다: HOME 은 임시 폴더로 덮는다.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir, rm, realpath, symlink, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidates, scanText, pickRows, parseResolved, RESOLVE_SCRIPT, SEARCH_SCRIPT, unresolved, mergeResolved, terminalMachine, trimTail, mergeLight, endedWorking, TERM_EXTS, CODE_EXTS, scanGate, TF_STUCK_MS, errClass, stuckAfter, noteWrite, termKey, cellWidth, selSpan, selKey, dcStep, dcPick, dcLonger, dcChoose, DC_MAX_PROBES, NAME_MAX_UNITS } from "../files-plus/termfiles.js";

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
