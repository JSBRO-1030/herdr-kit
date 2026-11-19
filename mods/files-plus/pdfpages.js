// PDF 쪽별 렌더(미리보기 A) — 순수 모듈: JXA 원문 · 샌드박스 프로필 · 출력 파서. 실행은 preview.js 의 pdfPage() 가 한다.
// [경고] 믿을 수 없는 PDF 를 PDFKit 로 연다 → 반드시 sandboxProfile() 아래(/usr/bin/sandbox-exec)에서만 돌린다. 프로필이 없으면 돌리지 않는다.

export const PDF_LONG = 1600;       // 쪽 그림의 긴 변(px)
export const PDF_MAX_PAGES = 5000;  // 쪽 수 상한(그 이상은 깨진 출력으로 본다)
export const PDF_MAX_DIM = 20000;   // 쪽 그림 한 변 상한(px) — 그 이상은 깨진 출력으로 본다

// osascript -l JavaScript -e <이것> <src> <out> <idx 0부터> <long> → stdout "<쪽수> <w> <h>" · 범위 밖이면 그림 없이 "<쪽수> 0 0" · 잠김/열기 실패는 throw(exit≠0).
// writeToFileAtomically(out, false): 샌드박스 안에서는 «원자적 쓰기» 의 임시 파일이 막힌다 → false 필수.
export const PDF_PAGE_JXA = `function run(argv) {
  ObjC.import("Quartz"); ObjC.import("AppKit");
  const src = argv[0], out = argv[1], idx = parseInt(argv[2], 10), long = parseInt(argv[3], 10);
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(src));
  if (!doc || doc.isNil()) throw new Error("pdf open failed");
  if (doc.isLocked) throw new Error("pdf locked");
  const n = doc.pageCount;
  if (!(idx >= 0 && idx < n)) return n + " 0 0";
  const page = doc.pageAtIndex(idx);
  const b = page.boundsForBox(1);
  const rot = ((page.rotation % 360) + 360) % 360;
  let pw = b.size.width, ph = b.size.height;
  if (rot === 90 || rot === 270) { const t = pw; pw = ph; ph = t; }
  const k = long / Math.max(pw, ph), w = Math.max(1, Math.round(pw * k)), h = Math.max(1, Math.round(ph * k));
  const img = page.thumbnailOfSizeForBox($.NSMakeSize(w, h), 1);
  const rep = $.NSBitmapImageRep.imageRepWithData(img.TIFFRepresentation);
  const png = rep.representationUsingTypeProperties(4, $());
  if (!png.writeToFileAtomically(out, false)) throw new Error("write failed");
  return n + " " + rep.pixelsWide + " " + rep.pixelsHigh;
}`;

// sandbox-exec -p 프로필: 네트워크 전부 거부 · outDir 밖 쓰기 거부(/dev/null 만 허용).
// 한 deny 안에 require-not 두 개를 나란히 쓰면 OR 로 묶여 전부 막힌다 → deny 뒤에 allow 를 따로 둔다(뒤 규칙이 이긴다).
// 경로는 모두 실제 경로(pwd -P)여야 한다(심볼릭 링크면 subpath 가 안 맞는다). 절대 경로 + `"` `\` 제어문자 없음일 때만 문자열, 아니면 null.
// opts = {home, read}: 있으면 강화 규칙을 덧붙인다 — fork · 다른 실행 파일 실행 · LaunchServices(lsopen · appleevent) · 클립보드/LaunchServices mach 조회 거부,
//   home 아래 읽기 거부 후 read(원본 PDF 와 outDir 를 모두 품는 캐시 폴더) 아래만 다시 허용(뒤 규칙이 이긴다). 한쪽만 주거나 경로가 이상하면 null.
// [주의] opts 없이 부르면 강화 규칙이 빠진 기본 프로필(쓰기·네트워크만 막음) — 실제 PDF 렌더(preview.js)는 늘 opts 를 준다.
const okPath = (p) => typeof p === "string" && p.startsWith("/") && !/["\\\u0000-\u001f\u007f]/.test(p);
export function sandboxProfile(outDir, opts) {
  if (!okPath(outDir)) return null;
  const base = `(version 1)(allow default)(deny network*)(deny file-write* (require-not (subpath "${outDir}")))(allow file-write* (literal "/dev/null"))`;
  if (opts === undefined) return base;
  const { home, read } = opts ?? {};
  if (!okPath(home) || !okPath(read)) return null;
  return `${base}(deny process-fork)(deny process-exec (require-not (literal "/usr/bin/osascript")))(deny lsopen)(deny appleevent-send)(deny mach-lookup (global-name "com.apple.coreservices.launchservicesd") (global-name "com.apple.pasteboard.1") (global-name "com.apple.coreservices.appleevents"))(deny file-read* (subpath "${home}"))(allow file-read* (subpath "${read}"))`;
}

// sandbox-exec 인자 목록(순수) — 원본은 readDir(캐시 폴더의 «실제» 경로) + name 으로 넘긴다.
// [경고] 논리 경로(${cacheDir}/…)를 넘기지 말 것: 홈 읽기 거부 프로필은 홈 안의 심볼릭 링크를 지나는 조회도 막아 «pdf open failed». tmp 도 실제 경로(mktemp 가 realpath 아래에 만든다).
export function renderArgv(prof, readDir, name, tmp, i) {
  return ["-p", prof, "/usr/bin/osascript", "-l", "JavaScript", "-e", PDF_PAGE_JXA, `${readDir}/${name}`, `${tmp}/o.png`, String(i), String(PDF_LONG)];
}

// 쪽 렌더 한 번에 한 개만(창당 single-flight): 지금 무엇을 만들지 고른다. 순수 함수.
//  · busy → null(이미 도는 것이 끝나면 다시 부른다)
//  · want 가 지금 쪽과 다르면 그 쪽(보여 줄 것) — 중간 쪽은 건너뛴다
//  · 아무것도 원하지 않고 ready(그림이 떠 있음)이며 다음 쪽을 아직 안 해 봤으면 그 쪽(미리 만들기)
// p = {busy, want, page, pages, pre: Set(해 본 미리 만들기 쪽)} → {to, show} | null
export function nextRender(p, ready) {
  if (!p || p.busy) return null;
  if (p.want !== null && p.want !== undefined && p.want !== p.page) return { to: p.want, show: true };
  const nx = p.page + 1;
  if (ready && nx < p.pages && !p.pre?.has(nx)) return { to: nx, show: false };
  return null;
}

// JXA stdout → {pages, w, h} · 정수 범위 밖이거나 꼴이 다르면 null.
export function parsePdfOut(stdout) {
  const m = /^(\d{1,5}) (\d{1,5}) (\d{1,5})\s*$/.exec(String(stdout ?? ""));
  if (!m) return null;
  const [pages, w, h] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!(pages >= 1 && pages <= PDF_MAX_PAGES && w <= PDF_MAX_DIM && h <= PDF_MAX_DIM)) return null;
  return { pages, w, h };
}
