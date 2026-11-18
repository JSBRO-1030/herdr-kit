// 파일 종류 가르기 · 이미지 머리에서 크기 읽기 · 바이트 표기.
// herdr 모듈을 쓰지 않는다 — node 로도 그대로 시험한다(tests/files-plus.test.mjs).

// gpui 가 그리는 형식(gpui ImageFormat: png·jpeg·webp·gif·svg·bmp·tiff·ico·pnm).
export const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "tif", "tiff", "pbm", "pgm", "ppm", "pnm"]);
// gpui 가 못 그리는 사진 — macOS 에서 sips 로 PNG 로 바꿔 보인다.
export const CONVERT = new Set(["heic", "heif", "avif"]);
// 문서 — macOS 에서 빠른 보기(qlmanage -t)로 첫 쪽을 그림으로 받는다. 전체는 «Mac에서 열기».
export const DOC = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "key", "pages", "numbers", "rtf", "odt", "ods", "odp", "hwp", "hwpx", "epub"]);
// html-viewer mod 가 페이지로 그리는 것.
export const PAGE = new Set(["md", "markdown", "html", "htm"]);

// «열기» 가 실행하거나 시스템 설정을 바꿀 수 있는 형식 — 격리 속성이 없는 이 컴퓨터 파일은 열지 않고 Finder 에서 보여 준다(open -R).
export const RUNNABLE = new Set(["command", "terminal", "app", "workflow", "wflow", "scpt", "scptd", "applescript", "sh", "bash", "zsh", "csh", "ksh", "fish", "tool", "action", "osax",
  "pkg", "mpkg", "dmg", "iso", "img", "sparseimage", "sparsebundle", "jar", "webloc", "inetloc", "fileloc", "url", "mobileconfig", "saver", "prefpane", "qlgenerator", "shortcut",
  // 시작 형식(열면 다른 앱·프로토콜이 실행됨): Terminal 세션 · 서버 접속 · 메일 작성 · Java Web Start · Linux 런처. 일반 소스(py · pl · rb · js · php)는 글자로 미리 보므로 넣지 않는다 — 실행 비트는 열기 검사가 따로 거른다.
  "term", "afploc", "ftploc", "vncloc", "mailloc", "newsloc", "jnlp", "desktop"]);
// 이름 끝의 점·공백은 LaunchServices 가 무시하고 확장자로 본다(`y.command.` · `y.command `) → 확장자를 잴 때 먼저 뗀다.
export const isRunnable = name => RUNNABLE.has(extOf(String(name).replace(/[.\s]+$/, "")));

// ── 기본 앱 검사(Enter · ⌘O): 이름 목록(RUNNABLE) 위에 «OS 가 이 파일을 어느 앱으로 여나» 를 한 번 더 묻는다. 그 앱이 터미널·설치기·실행기면 열지 않고 보여 준다.
// 아래는 순수 함수 — 실제로 OS 에 묻는 일(exec)은 main.js 가 한다.

// macOS: 이 파일을 열 기본 앱의 «경로 \n 번들 id» 를 찍는 JXA. 경로는 argv 로만 받는다(스크립트에 끼우지 않는다). System Events 는 쓰지 않는다.
// Finder 별칭(alias) 파일이면 «@alias» 한 줄만 찍는다 — NSWorkspace 는 별칭을 «가리키는 대상» 으로 판정해(계산기 · .webloc · .shortcut · .mobileconfig 별칭이 그대로 열렸다) 별칭 자체는 늘 보여 주기만 한다.
// [주의] 별칭 판정은 URL 리소스 값 NSURLIsAliasFileKey — 못 읽으면(오류) 열지 않는 쪽: «@unknown» 을 찍는다.
export const MAC_HANDLER_SCRIPT = 'ObjC.import("AppKit"); function run(a){ const f=$.NSURL.fileURLWithPath(a[0]); const r=Ref(); const ok=f.getResourceValueForKeyError(r,$.NSURLIsAliasFileKey,null); if(!ok||r[0]==null||r[0].isNil()) return "@unknown"; if(r[0].boolValue) return "@alias"; const u=$.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL(f); if (u.isNil()) return ""; const b=$.NSBundle.bundleWithURL(u); return u.path.js + "\\n" + (b.isNil()||b.bundleIdentifier.isNil() ? "" : b.bundleIdentifier.js); }';

// 번들 id 앞부분(소문자) · 앱 이름(소문자 · `.app` 뗀 것) — 실행기 · 터미널 · 설치기 · 마운터.
const RUNNER_BUNDLE = ["com.apple.terminal", "com.googlecode.iterm2", "org.python.pythonlauncher", "com.apple.installer", "com.apple.automator", "com.apple.jarlauncher",
  "com.apple.javawebstart", "com.apple.javajnlpinstaller", "com.apple.diskimagemounter", "com.apple.scriptmenu", "com.mitchellh.ghostty", "org.alacritty", "io.alacritty",
  "net.kovidgoyal.kitty", "com.github.wez.wezterm", "dev.warp.", "co.zeit.hyper", "org.tabby", "dev.herdr."];
const RUNNER_NAME = [/^terminal$/, /^iterm2?$/, /^python launcher/, /^installer$/, /^automator( application stub)?$/, /^jar launcher$/, /^java web start$/,
  /^disk ?image ?mounter$/, /^script menu$/, /^(applescript|script|osascript) runner$/, /^osascript$/, /^ghostty$/, /^alacritty$/, /^kitty$/, /^wezterm$/, /^warp$/, /^hyper$/, /^tabby$/, /^herdr$/];

// 기본 앱이 실행기인가. 번들 id 와 앱 파일 이름 어느 쪽이든 맞으면 참(대소문자 무시) — 번들 id 가 비어 있어도 이름으로 가른다.
export function isRunnerApp({ path = "", bundleId = "" } = {}) {
  const id = String(bundleId ?? "").trim().toLowerCase();
  if (id && RUNNER_BUNDLE.some(p => id === p || id.startsWith(p.endsWith(".") ? p : `${p}.`) || (p === "com.apple.automator" && id.startsWith(p)))) return true;
  const base = String(path ?? "").trim().replace(/\/+$/, "").split("/").pop().toLowerCase().replace(/\.app$/, "").trim();
  return base !== "" && RUNNER_NAME.some(re => re.test(base));
}

// osascript 결과 → { app, runner } 또는 null(= 열 앱 없음 · 읽지 못함 → 열지 않고 보여 준다).
// 판정: 실행 오류 · 시간 초과 · 0 이 아닌 종료 · 해석 못 함 · 앱 없음 → { open:false, why:"unknown" } · 별칭 → { open:false, why:"alias" } · 실행기 → { open:false, why:"runner", app } · 그 밖 → { open:true }.
export function macHandlerVerdict(r) {
  if (!r || r.code !== 0 || typeof r.stdout !== "string") return { open: false, why: "unknown" };
  const [path = "", bundleId = ""] = r.stdout.replace(/\r?\n$/, "").split("\n");
  if (path === "@alias") return { open: false, why: "alias" };           // Finder 별칭 — 대상이 아니라 별칭 자체를 보여 준다
  if (!path.startsWith("/")) return { open: false, why: "unknown" };     // 빈 줄 = 기본 앱 없음 · 그 밖 = 해석 불가
  const app = path.replace(/\/+$/, "").split("/").pop().replace(/\.app$/i, "");
  return isRunnerApp({ path, bundleId }) ? { open: false, why: "runner", app } : { open: true, app };
}

// Linux(xdg-mime): 실행 파일 · 스크립트 · 디스크 이미지 · 런처 꼴 mime 과, 터미널 · 런처 · 마운터 기본 앱(.desktop id).
const RUNNER_MIME = new Set(["application/x-executable", "application/x-sharedlib", "application/x-shellscript", "application/x-desktop", "application/x-perl", "application/x-python-code",
  "application/x-ms-dos-executable", "application/x-msdownload", "application/x-java-archive", "application/x-msi", "application/x-ms-installer", "application/x-ms-shortcut", "application/x-iso9660-image", "application/x-raw-disk-image", "application/java-archive", "application/x-java-jnlp-file", "application/vnd.appimage",
  // 패키지 · 설치기(열면 소프트웨어 센터가 설치) · 디스크 이미지 · AppImage · 셸 스크립트 별칭 mime.
  "application/vnd.debian.binary-package", "application/x-deb", "application/x-rpm", "application/x-redhat-package-manager", "application/vnd.flatpak", "application/vnd.flatpak.ref", "application/vnd.flatpak.repo",
  "application/x-cd-image", "application/x-iso9660-appimage", "text/x-shellscript", "application/x-shellscript"]);
const RUNNER_DESKTOP = ["gnome-terminal", "org.gnome.terminal", "konsole", "xterm", "alacritty", "kitty", "wezterm", "tilix", "terminator", "xfce4-terminal", "wine", "java",
  "gnome-disk-image-mounter", "org.gnome.diskutility", "appimagelauncher", "python", "perl",
  // 소프트웨어 센터 · 패키지 설치기 · 그 밖의 터미널 에뮬레이터.
  "gnome-software", "org.gnome.software", "gdebi", "org.kde.discover", "ptyxis", "org.gnome.ptyxis", "foot", "footclient", "ghostty", "com.mitchellh.ghostty", "io.elementary.terminal", "qterminal", "lxterminal",
  "mate-terminal", "sakura", "st", "urxvt", "rxvt", "kgx", "org.gnome.console", "org.kde.konsole"];
export function isRunnerMime(mime) { return RUNNER_MIME.has(String(mime ?? "").trim().toLowerCase().split(";")[0]); }
export function isRunnerDesktop(id) {
  const d = String(id ?? "").trim().toLowerCase().replace(/\.desktop$/, "");
  // Java 런처(openjdk-17-java.desktop · java-17-openjdk.desktop 등) — 이름에 java 가 들어 있거나 openjdk- 로 시작하면 모두 실행기로 본다.
  if (d.startsWith("openjdk-") || d.includes("java")) return true;
  return d !== "" && RUNNER_DESKTOP.some(r => d === r || d.startsWith(`${r}.`) || d.startsWith(`${r}-`) || d.endsWith(`.${r}`));
}
// mimeR = `xdg-mime query filetype <경로>` 결과 · defR = `xdg-mime query default <mime>` 결과(mime 을 못 읽었으면 null). 둘 다 {code, stdout} 또는 null(실행 실패).
export function linuxHandlerVerdict(mimeR, defR) {
  const mime = mimeR && mimeR.code === 0 && typeof mimeR.stdout === "string" ? mimeR.stdout.trim().split("\n")[0].trim() : "";
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime)) return { open: false, why: "unknown" };
  if (isRunnerMime(mime)) return { open: false, why: "runner", app: mime };
  const id = defR && defR.code === 0 && typeof defR.stdout === "string" ? defR.stdout.trim().split("\n")[0].trim() : "";
  if (!id) return { open: false, why: "unknown" };                       // 기본 앱 없음
  return isRunnerDesktop(id) ? { open: false, why: "runner", app: id } : { open: true, app: id };
}

export function extOf(name) {
  const base = name.split("/").pop();
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i + 1).toLowerCase() : "";
}

export function kindOf(name) {
  const e = extOf(name);
  if (IMAGE.has(e)) return "image";
  if (CONVERT.has(e)) return "convert";
  if (DOC.has(e)) return "doc";
  if (PAGE.has(e)) return "page";
  return "text";
}

const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b, i) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const i32le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
const ascii = (b, i, n) => String.fromCharCode(...b.slice(i, i + n));
// 바이트 → latin1 글자열. [경고] herdr 실행 환경(QuickJS)에는 TextDecoder 가 없다 — 쓰면 늘 던져 폭탄 검사가 조용히 건너뛰어진다. 조각(4096)씩 fromCharCode 로 바꾼다(인자 개수 상한 회피). 토큰은 모두 ASCII.
function latin1(b, from, to) {
  let s = "";
  for (let i = from; i < to; i += 4096) s += String.fromCharCode.apply(null, b.subarray(i, Math.min(to, i + 4096)));
  return s;
}

// 픽셀 크기 {w, h} — 모르는 꼴이면 null(그때는 패널 폭에 맞춘다).
export function imageSize(b) {
  if (!b || b.length < 26) return null;
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return { w: u32be(b, 16), h: u32be(b, 20) };
  if (ascii(b, 0, 4) === "GIF8") return { w: u16le(b, 6), h: u16le(b, 8) };
  if (ascii(b, 0, 2) === "BM") return { w: i32le(b, 18), h: Math.abs(i32le(b, 22)) };
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const c = ascii(b, 12, 4);
    if (c === "VP8 " && b.length >= 30) return { w: u16le(b, 26) & 0x3fff, h: u16le(b, 28) & 0x3fff };
    if (c === "VP8L" && b.length >= 25) return { w: 1 + (((b[22] & 0x3f) << 8) | b[21]), h: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
    if (c === "VP8X" && b.length >= 30) return { w: 1 + u24le(b, 24), h: 1 + u24le(b, 27) };
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xff) { i += 1; continue; }                       // 채움 바이트
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }  // 길이 없는 표지
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: u16be(b, i + 7), h: u16be(b, i + 5) };
      i += 2 + u16be(b, i + 2);
    }
    return null;
  }
  return null;
}

// ── 픽셀 폭탄 검사용 «선언된 크기»: imageSize(그리기용)가 모르는 형식(TIFF · ICO/CUR · PNM · PAM · SVG)의 머리글도 읽는다. 앞 64 KB 만 훑고, 경계를 넘거나 이상하면 null — 던지지 않는다.
// 그리기용 imageSize 는 그대로 둔다(이 형식들은 지금처럼 패널 폭에 맞춘다).
// [주의] 규칙(fail-closed): 읽는 쪽이 «확실하지 않으면» 흉내 내지 않고 null 을 돌려준다. null(= 크기 모름)은 «검사 안 함» 이 아니라 «미리보기 거절» 이다 — pictureCheck 가 imageSize ?? declaredSize 가 null 이면 unknown 으로 돌려주고 preview 가 그림을 그리지 않는다.
const SCAN = 64 * 1024;
const pos = (w, h) => (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : null);

// BigTIFF(버전 43): 머리 16 바이트(바이트순서 · 43 · 오프셋 크기 8 · 0 · IFD 오프셋 u64) · IFD = 항목 수 u64 + 항목 20 바이트(태그 · 형식 · 개수 u64 · 값 u64). 형식 SHORT · LONG · LONG8.
// 확실하지 않으면 null: 항목 512 초과 · 항목 칸이 버퍼를 넘음 · 너비/높이 태그 중복 · 너비/높이 형식이 SHORT/LONG(/LONG8)이 아님 · 너비/높이 없음.
function bigTiffSize(b, le) {
  const u16 = i => (le ? u16le(b, i) : u16be(b, i));
  const u32 = i => (le ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 : u32be(b, i));
  const u64 = i => (le ? u32(i) + u32(i + 4) * 4294967296 : u32(i) * 4294967296 + u32(i + 4));
  if (b.length < 16 || u16(4) !== 8 || u16(6) !== 0) return null;
  const off = u64(8);
  if (!Number.isSafeInteger(off) || off < 16 || off + 8 > b.length) return null;
  const n = u64(off);
  if (!Number.isSafeInteger(n) || n > 512 || off + 8 + n * 20 > b.length) return null;
  let w = null, h = null;
  for (let k = 0; k < n; k++) {
    const e = off + 8 + k * 20;
    const tag = u16(e), type = u16(e + 2);
    if (tag !== 256 && tag !== 257) continue;
    // 값은 항목 안(e+12)에 들어 있다. 빅엔디언의 SHORT · LONG 은 8 바이트 칸의 «앞» 에 놓인다.
    const v = type === 3 ? u16(e + 12) : type === 4 ? u32(e + 12) : type === 16 ? u64(e + 12) : null;
    if (v == null) return null;
    if (tag === 256) { if (w != null) return null; w = v; } else { if (h != null) return null; h = v; }
  }
  return pos(w, h);
}

function tiffSize(b) {
  if (b[2] === 43 && b[3] === 0 && ascii(b, 0, 2) === "II") return bigTiffSize(b, true);
  if (b[2] === 0 && b[3] === 43 && ascii(b, 0, 2) === "MM") return bigTiffSize(b, false);
  const le = ascii(b, 0, 2) === "II" && b[2] === 42 && b[3] === 0, be = ascii(b, 0, 2) === "MM" && b[2] === 0 && b[3] === 42;
  if (!le && !be) return null;
  const u16 = i => (le ? u16le(b, i) : u16be(b, i)), u32 = i => (le ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 : u32be(b, i));
  const off = u32(4);
  if (off < 8 || off + 2 > b.length) return null;
  const n = u16(off);
  if (n > 512 || off + 2 + n * 12 > b.length) return null;
  let w = null, h = null;
  for (let k = 0; k < n; k++) {
    const e = off + 2 + k * 12;
    const tag = u16(e), type = u16(e + 2);
    if (tag !== 256 && tag !== 257) continue;
    const v = type === 3 ? u16(e + 8) : type === 4 ? u32(e + 8) : null;     // SHORT · LONG 만 — 다른 형식은 모름
    if (v == null) return null;
    if (tag === 256) { if (w != null) return null; w = v; } else { if (h != null) return null; h = v; }
  }
  return pos(w, h);
}

// ICO/CUR: 디렉터리 칸의 너비/높이 바이트는 믿지 않는다. 0(=256)이거나 자료가 PNG 서명으로 시작하면 자료 안쪽 머리글을 읽는다(PNG IHDR · DIB 머리글). 칸이 버퍼를 넘으면 null. 가장 큰 것을 쓴다.
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function icoSize(b) {
  if (b[0] !== 0 || b[1] !== 0 || (b[2] !== 1 && b[2] !== 2) || b[3] !== 0) return null;
  const n = u16le(b, 4);
  if (n < 1 || n > 1024) return null;
  const u32le = i => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  let best = null;
  for (let k = 0; k < n; k++) {
    const e = 6 + k * 16;
    if (e + 16 > b.length) return null;
    let w = b[e] || 256, h = b[e + 1] || 256;      // 0 = 256
    const zero = b[e] === 0 || b[e + 1] === 0;
    const off = u32le(e + 12);
    if (off + 8 > b.length) return null;           // 자료를 못 본다 → 모름
    if (PNG_SIG.every((c, x) => b[off + x] === c)) {
      if (off + 24 > b.length) return null;
      w = u32be(b, off + 16); h = u32be(b, off + 20);
    } else if (zero && off + 12 <= b.length && u32le(off) === 40) {            // DIB(BITMAPINFOHEADER): 너비 · 높이(마스크 포함 ×2)
      w = Math.max(w, Math.abs(i32le(b, off + 4))); h = Math.max(h, Math.abs(i32le(b, off + 8)) / 2);
    }
    if (!(w > 0 && h > 0)) return null;
    if (!best || w * h > best.w * best.h) best = { w, h };
  }
  return best;
}

const isWs = c => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0b || c === 0x0c;
// P1..P6: 매직 뒤에 공백이 «꼭» 있어야 하고(`P411000` 은 모름) · 머리글 토큰(P1/P4 = 2개 · 그 밖 = 3개 · 마지막 뒤에 공백)이 훑는 범위 안에 «전부» 있어야 하며 · `#` 주석이 숫자에 바로 붙으면(`12#c`) · CR 만으로 끝나면(줄 끝 해석이 갈림) · 안 닫히면 모름(null).
function pnmSize(b) {
  if (b[0] !== 0x50 || b[1] < 0x31 || b[1] > 0x37) return null;      // P1..P7
  const end = Math.min(b.length, SCAN);
  if (b[1] === 0x37) {                                              // PAM: 줄마다 `WIDTH n` · `HEIGHT n` · `ENDHDR`
    let w = null, h = null, endhdr = false;
    for (const line of latin1(b, 0, end).split("\n").slice(1)) {         // 64 KB(SCAN) 안의 모든 줄 — 주석 줄이 200 개를 넘어도 읽는다
      if (line.length > 80) {                                      // 정규식은 짧은 줄에만(선형 보장). 긴 WIDTH · HEIGHT 줄은 읽을 수 없다 → 크다(BIG)로 센다(fail-closed)
        if (/^(WIDTH|HEIGHT)\s/.test(line.trimStart())) { if (line.trimStart().startsWith("WIDTH")) w = BIG; else h = BIG; }
        continue;
      }
      const m = /^\s*(WIDTH|HEIGHT)\s+(\d+)\s*$/.exec(line);
      if (m) { const n = Math.min(Number(m[2]), BIG); if (m[1] === "WIDTH") w = n; else h = n; }
      else if (/^\s*(WIDTH|HEIGHT)(\s|$)/.test(line)) { if (line.trimStart().startsWith("WIDTH")) w = BIG; else h = BIG; }   // 값이 숫자가 아니다 → 크다
      if (/^\s*ENDHDR/.test(line)) { endhdr = true; break; }
    }
    return endhdr ? pos(w, h) : null;                               // ENDHDR 을 훑는 범위 안에서 못 봤다 → 모름
  }
  if (!isWs(b[2])) return null;
  let i = 2;
  const isDigit = c => c >= 0x30 && c <= 0x39;
  const num = () => {
    for (;;) {                                                      // 공백 · `#` 주석(줄 끝까지)을 건너뛴다
      while (i < end && isWs(b[i])) i++;
      if (i < end && b[i] === 0x23) {
        if (isDigit(b[i - 1])) return null;                         // 주석이 숫자에 붙어 시작
        while (i < end && b[i] !== 0x0a && b[i] !== 0x0d) i++;
        if (i >= end || (b[i] === 0x0d && b[i + 1] !== 0x0a)) return null;   // 안 닫힘 · CR 만으로 끝남
        continue;
      }
      break;
    }
    const s = i;
    while (i < end && isDigit(b[i])) i++;                           // 자릿수 상한 없이 64 KB 안에서 한 번만 훑는다(선형)
    if (i === s) return null;
    let z = s;
    while (z < i - 1 && b[z] === 0x30) z++;                         // 앞쪽 0 은 값이 아니다(`000000000000022000` = 22000) — 0 을 뗀 뒤에 길이를 잰다
    return i - z > 15 ? BIG : Number(ascii(b, z, i - z));          // 유효 자릿수가 15 를 넘으면 «크다»
  };
  const w = num(), h = num();
  if (w == null || h == null) return null;
  if (b[1] !== 0x31 && b[1] !== 0x34 && num() == null) return null;   // P2 P3 P5 P6 은 최대값까지 — 못 찾으면 모름
  if (i >= end || !isWs(b[i])) return null;                         // 마지막 토큰 뒤에 공백이 없다(경계 · 붙은 글자) → 모름
  return pos(w, h);
}

// ── SVG: 정규식 없이 indexOf · 한 방향 단일 훑기만 쓴다 — 64 KB 안의 어떤 입력도 선형 시간(O(n)). (옛 정규식은 `<svg width="1…" ` · 닫히지 않은 `<!--` · 반복 `<svg ` 에서 O(n²) 로 UI 를 멈췄다.)
// 크기 추정은 호스트의 SVG 라이브러리(usvg 0.46 · svgtypes 0.16)가 «실제로 읽는» 규칙을 따른다(실측: scratchpad rv9 usvgprobe).
//  · 길이 = `[공백]* 숫자 [px|pt|pc|in|cm|mm|em|ex|%]` 이 «끝까지». 뒤 공백 · 사이 공백 · 대문자 단위 · rem · q · vw 는 거절 → width/height 가 없는 것처럼 100%(viewBox 쪽 길이)로 본다.
//  · 한쪽이 없으면 viewBox 의 그쪽 길이 · 둘 다 없으면 viewBox 크기 · viewBox 도 없으면 100(CSS 300×150 이 아니다). % 는 viewBox(없으면 100)의 비율.
//  · viewBox = 숫자 4 개(공백 · 쉼표 구분) — 4 번째 뒤의 찌꺼기는 무시, 길이 제한 없음, 실패하면 viewBox 없음. XML 문자 참조(`&#50;`)는 풀어서 읽는다.
//  · 폭 · 높이가 0 이하이면 usvg 도 그리지 못한다 → 모름(null).
// 확실하지 않으면 null(더 흉내 내지 않는다): 문서의 «첫 요소» 가 루트이고 그 지역 이름(`접두사:` 뒤)이 svg 가 아니면 · DOCTYPE 에 `[` 가 있으면(따옴표 안의 `>` 는 끝이 아님) · viewBox 가 없는데 width/height 가 없거나 % 이면(usvg 는 내용 bbox) · width/height 가 em/ex 이면 ·
//  width/height/viewBox/font-size/style 과 지역 이름이 같은 «접두사 붙은» 속성이 있거나 이 속성이 중복되면 · 문자 참조를 푼 뒤에도 `&` 가 남으면 · 루트 태그가 16 KB 를 넘으면.
// [경고] 지수가 넘쳐 무한대(1e999)가 되는 값만 «크다»(BIG) 로 센다(usvg 는 100% 로 돌리지만 폭탄 검사는 보수적으로). 그 밖의 못 읽는 값은 usvg 처럼 100%.
const BIG = 1e12;                        // 지수 표기가 무한대로 가도 «크다» 로 센다(폭탄 검사가 걸러낸다)
// CSS px 환산. 단위 없음 = px. em · ex 는 글꼴 크기에 달렸다(루트의 font-size · style) → 환산하지 않고 모름(EMEX)으로 센다.
const UNIT = { px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };
const EMEX = { em: 1, ex: 1 };
const isSpace = c => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
// svgtypes 숫자: 부호? (숫자+ (. 숫자*)? | . 숫자+) (e|E 부호? 숫자+)? — `1em` · `1ex` 의 e 는 지수가 아니다. t[i] 에서 시작해 끝 위치를 돌려준다(실패 -1). 한 번만 훑는다.
function scanNum(t, i) {
  const n = t.length;
  let j = i;
  if (t.charCodeAt(j) === 0x2b || t.charCodeAt(j) === 0x2d) j++;
  const d0 = j;
  while (j < n && t.charCodeAt(j) >= 0x30 && t.charCodeAt(j) <= 0x39) j++;
  const intDigits = j - d0;
  let frac = 0;
  if (t.charCodeAt(j) === 0x2e) { j++; const f0 = j; while (j < n && t.charCodeAt(j) >= 0x30 && t.charCodeAt(j) <= 0x39) j++; frac = j - f0; }
  if (intDigits === 0 && frac === 0) return -1;
  const c = t.charCodeAt(j);
  if (c === 0x65 || c === 0x45) {
    let k = j + 1;
    if (t.charCodeAt(k) === 0x2b || t.charCodeAt(k) === 0x2d) k++;
    const e0 = k;
    while (k < n && t.charCodeAt(k) >= 0x30 && t.charCodeAt(k) <= 0x39) k++;
    if (k > e0) j = k;                                              // 지수 숫자가 없으면(`1em`) 지수가 아니다
  }
  return j;
}
// → undefined(없음 · 읽을 수 없음) · null(em/ex = 모름) · {pct: 비율}(%) · 숫자(px) · BIG(무한대로 넘침). 0 이하 숫자도 그대로(호출 쪽이 모름으로 센다).
function svgLength(v) {
  if (typeof v !== "string") return undefined;
  let i = 0;
  while (i < v.length && isSpace(v.charCodeAt(i))) i++;             // 앞 공백만 허용
  const e = scanNum(v, i);
  if (e < 0) return undefined;
  const num = Number(v.slice(i, e));
  const rest = v.length - e;
  let k;
  if (rest === 0) k = 1;
  else if (rest === 1 && v.charCodeAt(e) === 0x25) { if (!Number.isFinite(num)) return { pct: BIG }; return { pct: Math.max(Math.min(num, BIG), -BIG) / 100 }; }
  else if (rest === 2) { const u = v.slice(e); if (Object.hasOwn(EMEX, u)) return null; k = Object.hasOwn(UNIT, u) ? UNIT[u] : undefined; }                          // 소문자 단위만(대문자 · rem · q · vw 는 undefined)
  if (k === undefined) return undefined;
  if (!Number.isFinite(num)) return BIG;
  const n = num * k;
  return Number.isFinite(n) ? Math.max(Math.min(n, BIG), -BIG) : BIG;
}
// viewBox: 숫자 4 개(공백 · 쉼표) — 뒤 찌꺼기는 무시. 폭 · 높이가 양수가 아니면 없는 것.
function svgViewBox(v) {
  if (typeof v !== "string") return null;
  const out = [];
  let i = 0;
  for (let k = 0; k < 4; k++) {
    while (i < v.length && isSpace(v.charCodeAt(i))) i++;
    const e = scanNum(v, i);
    if (e < 0) return null;
    const x = Number(v.slice(i, e));
    if (!Number.isFinite(x)) return null;
    out.push(x); i = e;
    while (i < v.length && isSpace(v.charCodeAt(i))) i++;
    if (v.charCodeAt(i) === 0x2c) i++;
  }
  return out[2] > 0 && out[3] > 0 ? { w: out[2], h: out[3] } : null;
}
// XML 문자 참조 · 기본 엔티티를 푼다(usvg 의 XML 파서가 푼 뒤의 값을 읽으므로). 정규식은 겹치는 반복이 없어 선형.
function xmlText(v) {
  if (typeof v !== "string" || v.indexOf("&") < 0) return v;
  const named = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
  return v.replace(/&(?:#x([0-9a-fA-F]+)|#([0-9]+)|(lt|gt|amp|quot|apos));/g, (m, h, d, nm) => {
    if (nm) return named[nm];
    const cp = h ? parseInt(h, 16) : Number(d);
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
  });
}
const isNameEnd = c => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0c || c === 0x3e || c === 0x2f;   // 공백 · > · /

// 문서의 «첫 요소»(주석 · 처리 명령 · DOCTYPE 뒤)가 루트다. 지역 이름(`접두사:` 뒤)이 svg 가 아니면 null — 뒤에 있는 `<svg>` 를 찾아 헤매지 않는다. 루트 열기 태그의 «이름 뒤 ~ 닫는 >» 까지(따옴표 안의 > 는 건너뛴다)를 돌려준다. 없으면 null.
function svgRootTag(t) {
  let p = 0;
  for (;;) {
    const i = t.indexOf("<", p);
    if (i < 0) return null;
    if (t.startsWith("<!--", i)) {                                   // 주석: 끝(-->)까지 건너뛴다 — 안 닫혔으면 나머지가 전부 주석
      const j = t.indexOf("-->", i + 4);
      if (j < 0) return null;
      p = j + 3; continue;
    }
    if (t.startsWith("<?", i)) {                                     // 처리 명령(<?xml ?>): 닫는 ?> 뒤로. 안 닫혔으면 나머지가 전부 명령 — 되풀이해 훑지 않는다(O(n))
      const j = t.indexOf("?>", i + 2);
      if (j < 0) return null;
      p = j + 2; continue;
    }
    if (t.startsWith("<!DOCTYPE", i)) {                              // DOCTYPE: 따옴표를 지키며 한 번 훑는다(따옴표 안의 `>` 는 끝이 아니다). `[`(내부 부분집합 — 엔티티가 크기를 바꾼다)가 있으면 모름. Illustrator 의 `<!ENTITY … [ ]>` 도 여기서 null.
      let quote = 0, k = i + 9;
      for (; k < t.length; k++) {
        const c = t.charCodeAt(k);
        if (c === 0x5b) return null;                                // `[` 는 따옴표 안이어도 모름
        if (quote) { if (c === quote) quote = 0; }
        else if (c === 0x22 || c === 0x27) quote = c;
        else if (c === 0x3e) break;
      }
      if (k >= t.length) return null;
      p = k + 1; continue;
    }
    let q = i + 1;
    while (q < t.length && !isNameEnd(t.charCodeAt(q))) q++;
    const name = t.slice(i + 1, q), colon = name.indexOf(":");
    const local = colon < 0 ? name : name.slice(colon + 1);
    if (local !== "svg" || local.includes(":")) return null;        // 첫 요소가 svg 가 아님(`<!` 다른 선언 · 닫는 태그 포함)
    let quote = 0;                                                   // 0 = 따옴표 밖 · 아니면 여는 따옴표 문자 코드
    // [주의] 루트 태그가 16 KB 를 넘으면 크기 모름(null → 미리보기 거절) — 호스트 엔진에서 일이 한없이 커지지 않게 막는다.
    const end = Math.min(t.length, q + 16384);
    for (let k = q; k < end; k++) {
      const c = t.charCodeAt(k);
      if (quote) { if (c === quote) quote = 0; }
      else if (c === 0x22 || c === 0x27) quote = c;
      else if (c === 0x3e) return t.slice(q, k);
    }
    return null;
  }
}

// 태그 속 width · height · viewBox · font-size · style 만 지역 이름(`:` 뒤)으로 뽑는다. 이름은 통째로 비교한다 — `stroke-width` 는 width 가 아니다.
// 접두사 붙은 속성(`foo:width`)이나 중복이 있으면 어느 것이 읽히는지 장담 못 한다 → null.
const SVG_WATCH = new Set(["width", "height", "viewBox", "font-size", "style"]);
function svgAttrs(tag) {
  const out = {}, n = tag.length;
  let i = 0;
  while (i < n) {
    while (i < n && (isNameEnd(tag.charCodeAt(i)) && tag.charCodeAt(i) !== 0x3e)) i++;     // 공백 · / 건너뜀
    const s = i;
    while (i < n && !isNameEnd(tag.charCodeAt(i)) && tag.charCodeAt(i) !== 0x3d) i++;
    const name = tag.slice(s, i);
    while (i < n && isWs(tag.charCodeAt(i))) i++;
    if (i >= n || tag.charCodeAt(i) !== 0x3d) { if (i === s) i++; continue; }                // 값 없는 속성(진행 보장: 이름이 비면 한 칸)
    i++;
    while (i < n && isWs(tag.charCodeAt(i))) i++;
    const q = tag.charCodeAt(i);
    let val;
    if (q === 0x22 || q === 0x27) {
      const e = tag.indexOf(q === 0x22 ? '"' : "'", i + 1);
      if (e < 0) return null;                                        // 안 닫힌 따옴표 — 못 읽는다
      val = tag.slice(i + 1, e); i = e + 1;
    } else { const v = i; while (i < n && !isWs(tag.charCodeAt(i))) i++; val = tag.slice(v, i); }
    const colon = name.indexOf(":");
    const local = colon < 0 ? name : name.slice(colon + 1);
    if (SVG_WATCH.has(local)) {
      if (colon >= 0 || Object.hasOwn(out, local)) return null;
      out[local] = val;
    }
    if (i === s) i++;
  }
  return out;
}

function svgSize(b) {
  const t = latin1(b, 0, Math.min(b.length, SCAN));
  const tag = svgRootTag(t);
  if (tag == null) return null;
  const at = svgAttrs(tag);
  if (at == null) return null;
  const dec = v => (v === undefined ? undefined : xmlText(v));
  const vbRaw = dec(at.viewBox), wRaw = dec(at.width), hRaw = dec(at.height);
  if ([vbRaw, wRaw, hRaw].some(v => v !== undefined && v.includes("&"))) return null;   // 못 푼 엔티티/참조 → 모름
  const vb = svgViewBox(vbRaw);
  // viewBox 가 없으면(usvg 는 내용 bbox 를 쓴다) width/height 가 둘 다 «읽히는 절대 길이» 여야 한다. 있으면 읽을 수 없는/없는 변은 viewBox 의 그 변.
  let bad = false;
  const side = (raw, base) => {
    const l = svgLength(raw);
    if (l === null) { bad = true; return 0; }                       // em · ex
    if (l === undefined || typeof l === "object") { if (base == null) bad = true; return base == null ? 0 : typeof l === "object" ? base * l.pct : base; }
    return l;
  };
  const w = side(wRaw, vb?.w), h = side(hRaw, vb?.h);
  return bad ? null : pos(w, h);                                    // 0 이하 → pos 가 null(usvg 도 못 그린다)
}

// 폭탄 검사용 크기 {w, h} — 그리기용 imageSize 가 알면 그것 · 아니면 위 머리글 읽기 · 그래도 모르면 null.
export function declaredSize(b) {
  try {
    if (!b || b.length < 6) return null;
    return imageSize(b) ?? tiffSize(b) ?? icoSize(b) ?? pnmSize(b) ?? svgSize(b);
  } catch { return null; }
}

// 패널 폭 안에서 그릴 폭 — 원래보다 키우지 않는다.
export function drawWidth(size, panel) {
  const room = Math.max(40, Math.floor(panel));
  return size && size.w > 0 ? Math.min(size.w, room) : room;
}

export function human(n) {
  if (!Number.isFinite(n)) return "?";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return i === 0 ? `${v} B` : `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

// 그림 픽셀 상한: 바이트(16 MiB)만으론 작은 파일이 거대한 비트맵으로 풀리는 «픽셀 폭탄» 을 못 막는다.
// [주의] 크기를 모르면(null) tooManyPixels 는 false 지만 «그려도 된다» 는 뜻이 아니다 — 그림을 그리기 전에 pictureCheck 로 «모름» 도 거절한다.
export const MAX_PIXELS = 100_000_000;
export const tooManyPixels = size => Boolean(size && size.w > 0 && size.h > 0 && size.w * size.h > MAX_PIXELS);

// 그림을 그려도 되는지: size = imageSize(그리기용 · 없으면 null) · s = imageSize ?? declaredSize. s 가 없거나 양수 크기가 아니면 unknown(= 거절). 합친 값 s 로 잰다(size 만 재면 SVG/ICO/TIFF/PNM 이 전부 거절된다).
export function pictureCheck(b) {
  const size = b ? imageSize(b) : null;
  const s = b ? (size ?? declaredSize(b)) : null;
  if (!s || !(s.w > 0) || !(s.h > 0)) return { size, bomb: null, unknown: true };
  const bomb = tooManyPixels(size) ? size : tooManyPixels(declaredSize(b)) ? declaredSize(b) : null;
  return { size, bomb, unknown: false };
}

// 마크다운 렌더 상한(글자). 원문 칸(Editor)은 따로 400K 까지 그대로 둔다.
export const MD_RENDER_LIMIT = 200_000;

// 렌더용 마크다운에서 그림 불러오기를 막는다: TextView 가 `![](https://…)` 를 자동으로 받아 오면 읽는 순간 IP 가 새고 안쪽 주소로 GET 이 나간다.
// 불변식: 결과에 `![` 도 `<img` 도 없다 — 어떤 입력이든.
//  · 줄 끝(CRLF · CR)을 LF 로 통일한다
//  · `<img …>` 같은 HTML 그림 태그를 먼저 `[그림]` 으로 바꾼다
//  · 그다음 `!` 가 몇 개 이어지든 `![` 를 `[그림: ` 으로 바꾼다(`![alt](url)` → `[그림: alt](url)` = 그냥 링크 — 눌러도 http/https 만 연다)
// 코드 울타리 예외는 두지 않는다(CommonMark 울타리 규칙과 어긋나면 그림이 새므로) — 코드 블록 안은 «[그림…» 글자로 보일 뿐이고 원문 보기(Editor)는 이 함수를 거치지 않는다.
export function safeMarkdown(text) {
  const tag = /<\/?(?:img|image|picture|source|video|audio|object|embed|iframe|link|svg)[^>\n]*>?/gi;
  // [주의] \b 를 두지 않는다 — `<imgx` 처럼 단어 경계가 아니어도 `<img` 글자열이 남지 않게(과하게 걸려도 «[그림]» 글자로 보일 뿐).
  // 순서가 중요하다: 태그 치환(`!<img …>` → `![그림]`)이 새 `![` 를 만들 수 있으므로 `!+[` 치환을 반드시 뒤에 한다. 둘 다 `!` 나 `<img` 를 새로 만들지 않는다.
  // [주의] `/!+\[/g` 는 `!` 만 20만 개일 때 시작점마다 끝까지 훑고 실패해 O(n²)(17.9 s · 앱 멈춤) → `!+` 뒤 `[` 를 선택으로 두어 한 번에 훑는다. 결과는 같다.
  return String(text).replace(/\r\n?/g, "\n").replace(tag, "[그림]").replace(/!+(\[?)/g, (m, b) => (b ? "[그림: " : m));
}
