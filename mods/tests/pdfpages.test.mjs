// pdfpages.js 시험 — 순수 함수는 그대로, 렌더는 이 Mac 의 진짜 sandbox-exec + osascript(darwin 만).
//   node --test mods/tests/pdfpages.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, stat, realpath, mkdir, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDF_PAGE_JXA, PDF_LONG, PDF_MAX_PAGES, PDF_MAX_DIM, sandboxProfile, renderArgv, parsePdfOut, nextRender } from "../files-plus/pdfpages.js";

const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { timeout: 60000 }, (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr })));

// 손으로 쓴 최소 PDF(쪽 n 개 · xref 계산) — 쪽마다 큰 글자로 «P<i>»
function miniPdf(n, pageExtra = "") {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${Array.from({ length: n }, (_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${n} >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  for (let i = 0; i < n; i++) {
    const body = `BT /F1 96 Tf 50 100 Td (P${i + 1}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] ${pageExtra} /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
  }
  let out = "%PDF-1.4\n"; const off = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return out;
}

// protects=parsePdfOut 가 JXA 출력만 받는다; fails_when=꼴이 다른 출력·범위 밖 수를 받아들일 때; no_claim=JXA 자체의 정확성
test("parsePdfOut: 정상 · 범위 밖 · 이상한 꼴", () => {
  assert.deepEqual(parsePdfOut("12 1131 1600\n"), { pages: 12, w: 1131, h: 1600 });
  assert.deepEqual(parsePdfOut("3 0 0"), { pages: 3, w: 0, h: 0 });
  for (const bad of ["", null, undefined, "0 10 10", `${PDF_MAX_PAGES + 1} 1 1`, "3 20001 5", "3 5", "3 5 5 5", "a b c", "-1 5 5", "3.5 5 5", "3 5 5\nextra"]) assert.equal(parsePdfOut(bad), null, String(bad));
});

// protects=샌드박스 프로필이 안전한 절대 경로로만 만들어진다; fails_when=상대 경로·따옴표·역슬래시·제어문자가 프로필에 끼어들 때; no_claim=프로필 의미(실제 차단은 통합 시험)
test("sandboxProfile: 절대 경로만 · 위험 문자 거절", () => {
  const p = sandboxProfile("/tmp/a b/한글");
  assert.match(p, /\(deny network\*\)/);
  assert.ok(p.includes('(subpath "/tmp/a b/한글")'));
  for (const bad of ["tmp/x", "", "./x", '/tmp/a"b', "/tmp/a\\b", "/tmp/a\nb", "/tmp/a\u0000b", "/tmp/a\u007fb", null, undefined, 5]) assert.equal(sandboxProfile(bad), null, JSON.stringify(bad));
});

const mac = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec");

// protects=실제 샌드박스 아래에서 쪽 수 · 쪽별 PNG · 범위 밖 처리; fails_when=JXA 가 샌드박스에서 못 돌거나 쪽 수·파일이 어긋날 때; no_claim=앱 안의 표시·캐시 흐름
test("진짜 sandbox-exec+osascript: 3쪽 PDF", { skip: !mac && "macOS 만" }, async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "pdfpages-")));
  try {
    const src = join(base, "t.pdf"); await writeFile(src, miniPdf(3));
    const outDir = join(base, "out"); await run("mkdir", [outDir]);
    const prof = sandboxProfile(outDir); assert.ok(prof);
    const render = (i, out) => run("/usr/bin/sandbox-exec", ["-p", prof, "/usr/bin/osascript", "-l", "JavaScript", "-e", PDF_PAGE_JXA, src, out, String(i), String(PDF_LONG)]);
    for (let i = 0; i < 3; i++) {
      const out = join(outDir, `p${i}.png`), r = await render(i, out);
      assert.equal(r.code, 0, r.stderr);
      const o = parsePdfOut(r.stdout); assert.equal(o.pages, 3); assert.ok(o.w > 0 && o.h > 0);
      assert.equal(Math.max(o.w, o.h), PDF_LONG);
      const png = await readFile(out); assert.equal(png.subarray(1, 4).toString(), "PNG");
    }
    // 범위 밖 쪽: 그림 없이 "3 0 0"
    const none = join(outDir, "none.png"), r3 = await render(3, none);
    assert.equal(r3.code, 0, r3.stderr);
    assert.deepEqual(parsePdfOut(r3.stdout), { pages: 3, w: 0, h: 0 });
    assert.equal(existsSync(none), false);
  } finally { await rm(base, { recursive: true, force: true }); }
});

// protects=프로필이 출력 폴더 밖 쓰기를 막는다(믿을 수 없는 PDF 의 부작용 차단); fails_when=밖 파일이 만들어질 때; no_claim=네트워크 차단·읽기 제한
test("진짜 sandbox-exec: 출력 폴더 밖 쓰기 실패 · 안은 성공", { skip: !mac && "macOS 만" }, async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "pdfpages-")));
  try {
    const src = join(base, "t.pdf"); await writeFile(src, miniPdf(1));
    const outDir = join(base, "out"); await run("mkdir", [outDir]);
    const prof = sandboxProfile(outDir);
    const outside = join(base, "outside.png");
    const bad = await run("/usr/bin/sandbox-exec", ["-p", prof, "/usr/bin/osascript", "-l", "JavaScript", "-e", PDF_PAGE_JXA, src, outside, "0", "400"]);
    assert.notEqual(bad.code, 0, "밖에 쓰기가 막혀야 한다");
    assert.equal(existsSync(outside), false);
    const w = await run("/usr/bin/sandbox-exec", ["-p", prof, "sh", "-c", `echo x > "${base}/leak"`]);
    assert.notEqual(w.code, 0); assert.equal(existsSync(join(base, "leak")), false);
    const ok = await run("/usr/bin/sandbox-exec", ["-p", prof, "sh", "-c", `echo x > "${outDir}/in"`]);
    assert.equal(ok.code, 0, ok.stderr); assert.ok((await stat(join(outDir, "in"))).size > 0);
  } finally { await rm(base, { recursive: true, force: true }); }
});

// ---- 강화 프로필(홈 읽기 거부 · fork/exec/LaunchServices 거부) · 경계 · 단일 비행 순수 함수

// protects=PDF_MAX_DIM 을 넘는 w/h 를 받아들이지 않는다(상수와 파서가 같은 값); fails_when=상한 바로 위 값을 통과시키거나 상한 값을 거절할 때; no_claim=상한 값 자체의 적정성
test("parsePdfOut: w/h 가 PDF_MAX_DIM 을 넘으면 거절", () => {
  assert.deepEqual(parsePdfOut(`3 ${PDF_MAX_DIM} 5`), { pages: 3, w: PDF_MAX_DIM, h: 5 });
  assert.equal(parsePdfOut(`3 ${PDF_MAX_DIM + 1} 5`), null);
  assert.equal(parsePdfOut(`3 5 ${PDF_MAX_DIM + 1}`), null);
});

// protects=강화 프로필이 home/read 를 같은 규칙으로 검증하고 규칙을 모두 붙인다; fails_when=위험한 home/read 가 통과하거나 규칙이 빠질 때; no_claim=규칙의 실제 차단(통합 시험)
test("sandboxProfile: opts {home, read} 검증 · 규칙 포함", () => {
  const p = sandboxProfile("/tmp/o", { home: "/tmp/h", read: "/tmp/r" });
  for (const r of ["(deny process-fork)", '(deny process-exec (require-not (literal "/usr/bin/osascript")))', "(deny lsopen)", "(deny appleevent-send)", '"com.apple.pasteboard.1"', '(deny file-read* (subpath "/tmp/h"))', '(allow file-read* (subpath "/tmp/r"))']) assert.ok(p.includes(r), r);
  assert.ok(p.indexOf("(deny file-read*") < p.indexOf("(allow file-read*"), "허용이 거부 뒤에 와야 이긴다");
  const bad = ["rel", "", '/a"b', "/a\\b", "/a\nb", "/a\u0000b", null, undefined, 5];
  for (const b of bad) {
    assert.equal(sandboxProfile("/tmp/o", { home: b, read: "/tmp/r" }), null, `home ${JSON.stringify(b)}`);
    assert.equal(sandboxProfile("/tmp/o", { home: "/tmp/h", read: b }), null, `read ${JSON.stringify(b)}`);
  }
  assert.equal(sandboxProfile("/tmp/o", {}), null);
  assert.equal(sandboxProfile("/tmp/o", null), null);
});

// protects=창당 한 번에 한 쪽만 렌더 · 원하는 쪽 우선 · 중간 쪽 건너뜀 · 한가할 때만 미리 만들기; fails_when=busy 인데 새 렌더를 고르거나 want 가 있는데 미리 만들기를 고를 때; no_claim=실제 실행 순서(preview.js 펌프 연결)
test("nextRender: single-flight 선택", () => {
  const base = { busy: false, want: null, page: 2, pages: 10, pre: new Set() };
  assert.equal(nextRender({ ...base, busy: true, want: 5 }, true), null);
  assert.deepEqual(nextRender({ ...base, want: 7 }, true), { to: 7, show: true });   // 3~6 은 건너뜀
  assert.deepEqual(nextRender({ ...base, want: 7 }, false), { to: 7, show: true });  // 오류 화면에서도 넘길 수 있다
  assert.deepEqual(nextRender(base, true), { to: 3, show: false });
  assert.equal(nextRender(base, false), null, "그림이 안 떠 있으면 미리 만들지 않는다");
  assert.equal(nextRender({ ...base, pre: new Set([3]) }, true), null, "한 번 해 본 쪽은 되풀이하지 않는다");
  assert.equal(nextRender({ ...base, page: 9 }, true), null, "끝 쪽 다음은 없다");
  assert.equal(nextRender({ ...base, want: 2 }, true)?.show ?? false, false, "want 가 지금 쪽이면 보여 줄 것이 없다");
  assert.equal(nextRender(null, true), null);
});

// 강화 프로필로 쪽을 그리는 공통 준비: base/{cache/sha/{t.pdf,view/.tmp.x}, home/secret/f.txt}
async function hardened(pdf) {
  const base = await realpath(await mkdtemp(join(tmpdir(), "pdfpages-")));
  const cache = join(base, "cache", "sha"), tmp = join(cache, "view", ".tmp.x"), home = join(base, "home");
  await mkdir(tmp, { recursive: true }); await mkdir(join(home, "secret"), { recursive: true });
  await writeFile(join(home, "secret", "f.txt"), "secret"); await writeFile(join(cache, "r.txt"), "ok");
  const src = join(cache, "t.pdf"); await writeFile(src, pdf);
  const prof = sandboxProfile(tmp, { home, read: cache });
  return { base, cache, tmp, home, src, prof };
}
const jxa = (prof, src, out, i) => run("/usr/bin/sandbox-exec", ["-p", prof, "/usr/bin/osascript", "-l", "JavaScript", "-e", PDF_PAGE_JXA, src, out, String(i), String(PDF_LONG)]);
const READ_JXA = 'function run(a){ObjC.import("Foundation");const s=$.NSString.stringWithContentsOfFileEncodingError(a[0],4,$());return s.isNil()?"DENIED":"READ:"+ObjC.unwrap(s).trim();}';

// protects=강화 프로필 아래서도 쪽 그림이 기본 프로필과 바이트까지 같다(렌더 회귀 없음); fails_when=추가 규칙이 PDFKit 렌더를 깨거나 다르게 할 때; no_claim=다른 PDF(내장 글꼴·큰 그림)
test("진짜 sandbox-exec: 강화 프로필 렌더가 기본 프로필과 같은 PNG", { skip: !mac && "macOS 만" }, async () => {
  const h = await hardened(miniPdf(3));
  try {
    const oldP = sandboxProfile(h.tmp);
    for (const i of [0, 2]) {
      const a = join(h.tmp, `old${i}.png`), b = join(h.tmp, `new${i}.png`);
      const ra = await jxa(oldP, h.src, a, i), rb = await jxa(h.prof, h.src, b, i);
      assert.equal(ra.code, 0, ra.stderr); assert.equal(rb.code, 0, rb.stderr);
      assert.equal(parsePdfOut(rb.stdout).pages, 3);
      assert.ok((await readFile(a)).equals(await readFile(b)), `${i + 1}쪽 PNG 가 같아야 한다`);
    }
  } finally { await rm(h.base, { recursive: true, force: true }); }
});

// protects=LaunchServices 접근(lsappinfo)이 강화 프로필 아래서 막힌다; fails_when=lsappinfo front 가 성공(exit 0)할 때; no_claim=실패 이유 구분(실행 거부 · 서비스 거부 모두 실패로 센다) · lsopen/appleevent 규칙 자체는 프로필 문자열 시험이 본다
test("진짜 sandbox-exec: 강화 프로필에서 lsappinfo 실패", { skip: !mac && "macOS 만" }, async () => {
  const h = await hardened(miniPdf(1));
  try {
    const r = spawnSync("/usr/bin/sandbox-exec", ["-p", h.prof, "/usr/bin/lsappinfo", "front"], { encoding: "utf8", timeout: 20000 });
    assert.notEqual(r.status, 0);
  } finally { await rm(h.base, { recursive: true, force: true }); }
});

// protects=home 아래 읽기는 거부되고 허용 폴더(캐시) 아래는 읽힌다; fails_when=home 안 파일이 읽히거나 허용 폴더가 막힐 때; no_claim=진짜 홈(임시 폴더를 home 으로 줘서 시험) · 심볼릭 링크 우회
test("진짜 sandbox-exec: home 읽기 거부 · 허용 폴더 읽기 가능", { skip: !mac && "macOS 만" }, async () => {
  const h = await hardened(miniPdf(1));
  try {
    const rd = (f) => run("/usr/bin/sandbox-exec", ["-p", h.prof, "/usr/bin/osascript", "-l", "JavaScript", "-e", READ_JXA, f]);
    const denied = await rd(join(h.home, "secret", "f.txt")); assert.equal(denied.stdout.trim(), "DENIED", denied.stderr);
    const ok = await rd(join(h.cache, "r.txt")); assert.equal(ok.stdout.trim(), "READ:ok", ok.stderr);
    // 대조: 기본 프로필(읽기 제한 없음)에서는 같은 파일이 읽힌다 → 위 거부가 프로필 때문임을 확인
    const open = await run("/usr/bin/sandbox-exec", ["-p", sandboxProfile(h.tmp), "/usr/bin/osascript", "-l", "JavaScript", "-e", READ_JXA, join(h.home, "secret", "f.txt")]);
    assert.equal(open.stdout.trim(), "READ:secret");
  } finally { await rm(h.base, { recursive: true, force: true }); }
});

// protects=깨진 PDF 는 샌드박스 안에서도 그림 없이 실패한다; fails_when=쓰레기 바이트가 «성공 + PNG» 로 보일 때; no_claim=부분적으로 읽히는 손상 PDF
test("진짜 sandbox-exec: 깨진 PDF(쓰레기 바이트)는 실패 · PNG 없음", { skip: !mac && "macOS 만" }, async () => {
  const h = await hardened(Buffer.from("not a pdf \x00\x01\x02 garbage ".repeat(40)));
  try {
    const out = join(h.tmp, "o.png"), r = await jxa(h.prof, h.src, out, 0);
    assert.ok(r.code !== 0 || parsePdfOut(r.stdout) === null, `실패해야 한다: ${r.code} ${r.stdout}`);
    assert.equal(existsSync(out), false);
  } finally { await rm(h.base, { recursive: true, force: true }); }
});

// protects=돌린 쪽(/Rotate 90)의 보고 w/h 가 실제 PNG 머리글(IHDR)과 같고 가로가 더 길다; fails_when=회전을 무시해 세로로 보고하거나 보고 값과 PNG 크기가 어긋날 때; no_claim=180/270 · 크롭 박스
test("진짜 sandbox-exec: 90도 돌린 쪽의 w/h 가 PNG 와 일치", { skip: !mac && "macOS 만" }, async () => {
  const h = await hardened(miniPdf(1, "/Rotate 90"));
  try {
    const out = join(h.tmp, "o.png"), r = await jxa(h.prof, h.src, out, 0);
    assert.equal(r.code, 0, r.stderr);
    const o = parsePdfOut(r.stdout), png = await readFile(out);
    assert.equal(png.readUInt32BE(16), o.w); assert.equal(png.readUInt32BE(20), o.h);
    assert.ok(o.w > o.h, "300x400 를 90도 돌리면 가로가 길다");
    assert.equal(Math.max(o.w, o.h), PDF_LONG);
  } finally { await rm(h.base, { recursive: true, force: true }); }
});

// 시험 전용 JXA: 격리 안에서 LaunchServices · 클립보드 mach 서비스가 정말 막혔는지 «존재 여부만» 본다(내용 · 실행 · 열기 호출 없음).
// 출력 "<실행 중 앱 수> <클립보드 types: nil | n<개수>>" — 서비스가 막히면 "0 nil".
const PROBE_JXA = 'function run(){ObjC.import("AppKit");let n,t;try{n=$.NSWorkspace.sharedWorkspace.runningApplications.count;}catch(e){n="E"}try{const ty=$.NSPasteboard.generalPasteboard.types;t=(ty&&!ty.isNil())?"n"+ty.count:"nil";}catch(e){t="E"}return n+" "+t;}';

// protects=강화 프로필의 mach-lookup 규칙(launchservicesd · pasteboard.1)이 osascript «안에서» 실행 중 앱 목록과 클립보드 types 조회를 막는다; fails_when=격리 안에서 실행 중 앱이 보이거나 클립보드 types 가 읽힐 때; no_claim=lsopen · appleevent 규칙의 효과 · openURL/launch 차단(시험이 호출하지 않는다) · 클립보드 내용
test("진짜 sandbox-exec: 강화 프로필 안 osascript 는 앱 목록 · 클립보드 types 를 못 본다(기본 프로필은 본다)", { skip: !mac && "macOS 만" }, async () => {
  const h = await hardened(miniPdf(1));
  try {
    const probe = (prof) => run("/usr/bin/sandbox-exec", ["-p", prof, "/usr/bin/osascript", "-l", "JavaScript", "-e", PROBE_JXA]);
    const ctl = await probe(sandboxProfile(h.tmp));
    const [cn, ct] = ctl.stdout.trim().split(" ");
    assert.ok(Number(cn) > 0, `대조: 기본 프로필에서는 앱 목록이 보여야 한다 (${ctl.stdout.trim()} ${ctl.stderr})`);
    assert.match(ct, /^n\d+$/, "대조: 기본 프로필에서는 클립보드 types 가 읽혀야 한다");
    const hard = await probe(h.prof);
    assert.equal(hard.stdout.trim(), "0 nil", `격리 안: 앱 0개 · types 없음 (${hard.stderr})`);
  } finally { await rm(h.base, { recursive: true, force: true }); }
});

// protects=원본은 실제 경로(readDir)로 넘겨야 홈 안 심볼릭 링크(stow 식 dotfiles) 밑 캐시에서도 렌더된다; fails_when=renderArgv 가 논리 경로를 넘기거나 실제 경로 렌더가 실패할 때; no_claim=링크 없는 홈 · 앱 안 흐름(preview.js 의 mk 스크립트)
test("진짜 sandbox-exec: 홈 안 심볼릭 링크 밑 캐시 — 실제 경로는 렌더 · 논리 경로는 거부", { skip: !mac && "macOS 만" }, async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "pdfpages-")));
  try {
    const home = join(base, "home"), real = join(home, ".cfg", "cache", "sha");
    await mkdir(join(real, "view", ".tmp.x"), { recursive: true });
    await symlink(".cfg", join(home, "cfglink"));
    await writeFile(join(real, "t.pdf"), miniPdf(1));
    const tmp = join(real, "view", ".tmp.x"), logical = join(home, "cfglink", "cache", "sha");
    const prof = sandboxProfile(tmp, { home, read: real });
    const argv = renderArgv(prof, real, "t.pdf", tmp, 0);
    assert.ok(argv.includes(join(real, "t.pdf")) && !argv.some(a => a.includes("cfglink")), "argv 는 실제 경로만");
    const ok = await run("/usr/bin/sandbox-exec", argv);
    assert.equal(ok.code, 0, ok.stderr); assert.equal(parsePdfOut(ok.stdout).pages, 1);
    assert.equal(existsSync(join(tmp, "o.png")), true);
    // 대조: 같은 파일을 논리(링크) 경로로 넘기면 홈 읽기 거부 프로필이 링크 조회를 막는다 → 위 realpath 사용이 필요한 이유
    const bad = await run("/usr/bin/sandbox-exec", ["-p", prof, "/usr/bin/osascript", "-l", "JavaScript", "-e", PDF_PAGE_JXA, join(logical, "t.pdf"), join(tmp, "o2.png"), "0", String(PDF_LONG)]);
    assert.notEqual(bad.code, 0, "링크를 지나는 논리 경로는 거부돼야 한다");
    assert.equal(existsSync(join(tmp, "o2.png")), false);
  } finally { await rm(base, { recursive: true, force: true }); }
});

// protects=renderArgv 가 원본 · 출력 경로를 readDir/tmp 에서만 만든다; fails_when=인자 자리가 어긋나거나 JXA 인자 순서(src out idx long)가 바뀔 때; no_claim=실제 실행
test("renderArgv: 인자 모양", () => {
  const a = renderArgv("PROF", "/r/sha", "x.pdf", "/r/sha/view/.tmp.z", 4);
  assert.deepEqual(a.slice(0, 2), ["-p", "PROF"]);
  assert.deepEqual(a.slice(-4), ["/r/sha/x.pdf", "/r/sha/view/.tmp.z/o.png", "4", String(PDF_LONG)]);
  assert.equal(a[a.indexOf("-e") + 1], PDF_PAGE_JXA);
});
