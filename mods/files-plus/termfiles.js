// «터미널에 나온 파일» — 터미널 출력 글자에서 파일 이름 후보를 뽑고(candidates), 그 컴퓨터에 진짜 있는 것만 가린다(RESOLVE_SCRIPT · parseResolved).
// herdr 모듈을 쓰지 않는다 — node 와 QuickJS 둘 다 돈다(tests/termfiles.test.mjs).
// [경고] 터미널 출력은 믿을 수 없는 입력이다: 이름은 «데이터» 로만 다룬다 — sh 에는 위치 인자로만 넘기고 스크립트 글자에 끼우지 않는다.
import { IMAGE, CONVERT, DOC, PAGE } from "./kinds.js";
import { safeName } from "./state.js";
import { utf8Len } from "./fsops.js";

export const TERM_EXTS = new Set([...IMAGE, ...CONVERT, ...DOC, ...PAGE, "txt", "csv", "tsv", "json", "log", "yaml", "yml", "xml", "toml"]);
const EXTS = [...TERM_EXTS].sort((a, b) => b.length - a.length);   // 긴 확장자 먼저 — `.html` 이 `.htm` 으로, `.docx` 가 `.doc` 로 잘리지 않게
export const MAX_TOKEN_BYTES = 1024;

const CUT = /[\s'"`<>|()[\]{}=]+/;                // 토큰 경계: 공백 · 따옴표 · 백틱 · <>|()[]{} · = (`--out=/tmp/x.pdf` → `/tmp/x.pdf`)
const GLOB = /[*?[\\]/;
const CTRL = /[\u0000-\u001f\u007f]/;
const WORD = /[\p{L}\p{N}]/u;                      // 확장자 바로 뒤에 붙은 글자(영숫자 · 한글 …)

// 끝의 `.,;:` 와 `:줄번호` · `:줄:열` 꼬리를 뗀다(더 뗄 게 없을 때까지). 끝에서 한 번씩 훑는다 — 점이 긴 토큰도 선형.
const isDigit = (ch) => ch >= "0" && ch <= "9";
export function trimTail(s) {
  let e = s.length;
  for (;;) {
    const before = e;
    while (e > 0 && ".,;:".includes(s[e - 1])) e--;
    let i = e;
    while (i > 0 && isDigit(s[i - 1])) i--;
    if (i < e && i > 0 && s[i - 1] === ":") {
      const j = i - 1;
      let k = j;
      while (k > 0 && isDigit(s[k - 1])) k--;
      e = k < j && k > 0 && s[k - 1] === ":" ? k - 1 : j;
    }
    if (e === before) return s.slice(0, e);
  }
}

// 토큰 하나 → 후보들(긴 것 먼저). 붙은 확장자(`a.pdfreport/b.pdf`)는 앞 조각을 후보로 쓰고 뒤 조각을 이어 본다.
function fromToken(tok) {
  if (tok.startsWith("file://")) {
    try { tok = decodeURIComponent(tok.slice(7)); } catch { return []; }
  }
  if (!tok || GLOB.test(tok) || CTRL.test(tok) || utf8Len(tok) > MAX_TOKEN_BYTES) return [];
  tok = trimTail(tok);
  if (!tok) return [];
  const lower = tok.toLowerCase();
  // 경계: `.<ext>` 의 끝 위치. 같은 점에서는 가장 긴 확장자 하나. 뒤가 토큰 끝이거나 글자(붙은 확장자)일 때만 경계다 —
  // `report.html.bak` 의 `.html` 뒤는 `.` 이므로 경계가 아니다(= `.bak` 백업은 후보가 아니다).
  const ends = [];
  for (let i = lower.indexOf("."); i >= 0; i = lower.indexOf(".", i + 1)) {
    const ext = EXTS.find(e => lower.startsWith(e, i + 1));
    if (!ext) continue;
    const end = i + 1 + ext.length, nextCp = tok.codePointAt(end);
    if (nextCp === undefined || WORD.test(String.fromCodePoint(nextCp))) ends.push(end);
  }
  // `/` 가 든 토큰은 마지막 조각(맨 이름)을 따로 후보로 내지 않는다 — 다른 폴더의 같은 이름 파일을 잘못 잡지 않게. 못 찾은 상대 경로는 SEARCH_SCRIPT 가 «끝이 같은 경로» 로만 찾는다.
  const out = [];
  for (let k = ends.length - 1; k >= 0; k--) {
    const from = k === 0 ? 0 : ends[k - 1], to = ends[k];
    const c = tok.slice(from, to), base = c.split("/").pop();
    if (c && base.length > 0 && !(base.startsWith(".") && base.indexOf(".", 1) < 0)) out.push(c);   // `.pdf` 같은 «이름 없는 확장자» 제외
  }
  return out;
}

// 터미널 글자 → 후보 이름 배열. 아래 줄이 더 최근 · 가장 최근 것부터 · 중복 없이 max 개.
export function candidates(text, { max = 40 } = {}) {
  const lines = String(text ?? "").split(/\r\n|\n|\r/);
  const seen = new Set(), out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < max; i--) {
    const toks = lines[i].split(CUT).filter(Boolean);
    for (let j = toks.length - 1; j >= 0 && out.length < max; j--) {
      for (const c of fromToken(toks[j])) {
        if (seen.has(c)) continue;
        seen.add(c); out.push(c);
        if (out.length >= max) break;
      }
    }
  }
  return out;
}

// 두 단계 — 둘 다 `sh -c SCRIPT files-plus <cwd> <후보>…` · POSIX sh(dash 가능) · BSD/GNU find 둘 다 · 출력 = NUL 로 끝나는 레코드들.
//  1) RESOLVE_SCRIPT(빠름): 후보마다 `/` 시작 → 그대로 · `~/` → $HOME/… · 그 밖 → cwd/… . 읽을 수 있는 «일반 파일» 이면 폴더를 cd -P 로 실제 경로로 바꿔 절대 경로를 낸다.
//     못 찾은 «상대» 후보는 `?후보` 레코드로 돌려준다(unresolved) — 절대 · `~/` 는 찾지 않는다.
//  2) SEARCH_SCRIPT(느릴 수 있음): 1) 이 못 찾은 이름만 find 한 번으로 — cwd 아래 깊이 3(경로 후보는 그 조각 수 + 2, 최대 6) · -xdev · .git/node_modules 는 들어가지 않는다.
//     `/` 없는 이름 = 이름이 같은 파일 · `/` 든 상대 경로 = 경로 끝이 같은 파일(`*/src/a.json`). 이름 하나당 3개 · 전체 24개까지.
//     cwd 가 `/` 이거나 실제 $HOME 이거나 $HOME 의 조상이면 아예 찾지 않는다. 이름은 10개까지.
// 개행·제어문자가 든 경로는 내지 않는다 · cwd 가 폴더가 아니면 exit 3. parseResolved 는 `/` 로 시작하는 레코드만 쓴다(`?` 레코드 무시).
// [주의] 호출 쪽이 둘 다 exec timeout(10 s)을 건다. 2) 가 실패해도 1) 의 결과는 쓴다 — 두 번 나눠 부르는 이유.
const EMIT = `emit() {
  d=\${1%/*}; n=\${1##*/}
  [ -n "$d" ] || d=/
  [ -n "$n" ] || return 0
  r=$(cd -P -- "$d" 2>/dev/null && pwd -P) || return 0
  case $r in /) o=/$n;; *) o=$r/$n;; esac
  case $o in *[[:cntrl:]]*) return 0;; esac
  [ -f "$o" ] && [ -r "$o" ] || return 0
  printf '%s\\0' "$o"
}`;

export const RESOLVE_SCRIPT = `[ $# -ge 1 ] || exit 2
cd -P -- "$1" 2>/dev/null || exit 3
root=$(pwd -P) || exit 3
shift
${EMIT}
for c in "$@"; do
  case $c in ''|*'*'*|*'?'*|*'['*|*'\\'*) continue;; esac
  case $c in
    /*) p=$c;;
    '~/'*) [ -n "$HOME" ] || continue; p=$HOME/\${c#'~/'};;
    *) p=$root/$c;;
  esac
  if [ -f "$p" ] && [ -r "$p" ]; then emit "$p"; continue; fi
  case $c in /*|'~/'*) continue;; esac
  printf '?%s\\0' "$c"
done
exit 0`;

// 위치 인자 = cwd + 못 찾은 상대 후보. find 인자는 set -- 로 위치 인자에 쌓는다(eval · 글자 이어붙인 명령 없음) — 이름은 늘 데이터.
// awk 는 이름별 3개 상한과 스펙별 깊이 한도(위 lim)를 맡는다(스펙은 환경변수 FP_SPECS 로 — 프로그램 글자에 끼우지 않는다).
export const SEARCH_SCRIPT = `[ $# -ge 1 ] || exit 2
cd -P -- "$1" 2>/dev/null || exit 3
root=$(pwd -P) || exit 3
shift
[ "$root" = / ] && exit 0
h=; [ -n "$HOME" ] && h=$(cd -P -- "$HOME" 2>/dev/null && pwd -P)
[ -n "$h" ] && case "$h/" in "$root"/*) exit 0;; esac
${EMIT}
nl='
'
specs=; n=0; maxd=3
for c in "$@"; do
  [ "$n" -lt 10 ] || break
  case $c in ''|*'*'*|*'?'*|*'['*|*'\\'*|*[[:cntrl:]]*) continue;; esac
  case $c in ./*) c=\${c#./};; esac
  case $c in ''|.|..|/*|'~/'*|../*|*/../*|*/..|*/.) continue;; esac
  case $c in
    */*) k=-path; v=*/$c; t=p;;
    *) k=-name; v=$c; t=n;;
  esac
  # 깊이 규칙(cwd 기준, cwd 바로 아래 = 1): 맨 이름은 깊이 3 까지 · 상대 경로 조각 N 개는 깊이 N+2 까지(최대 6).
  # find 는 가장 깊은 규칙에 맞춰 한 번만 훑고, 규칙별 한도는 awk 가 다시 건다(경로 하나가 맨 이름의 깊이를 늘리지 않게).
  m=1; r=$c
  while :; do case $r in */*) r=\${r#*/}; m=$((m+1));; *) break;; esac; done
  lim=3
  if [ "$t" = p ]; then lim=$((m+2)); [ "$lim" -le 6 ] || lim=6; fi
  [ "$lim" -le "$maxd" ] || maxd=$lim
  if [ "$n" -eq 0 ]; then set -- "$k" "$v"; else set -- "$@" -o "$k" "$v"; fi
  specs=\${specs:+$specs$nl}$t$lim:$c
  n=$((n+1))
done
[ "$n" -gt 0 ] || exit 0
find "$root" -maxdepth "$maxd" -xdev \\( -name .git -o -name node_modules \\) -prune -o -type f \\( "$@" \\) -print 2>/dev/null | head -n 400 |
  FP_SPECS=$specs FP_ROOT=$root awk 'BEGIN { n = split(ENVIRON["FP_SPECS"], S, "\\n"); R = ENVIRON["FP_ROOT"] "/"; rl = length(R) }
{
  rel = substr($0, rl + 1); dep = gsub("/", "/", rel) + 1
  for (i = 1; i <= n; i++) {
    t = substr(S[i], 1, 1); lim = substr(S[i], 2, 1) + 0; v = substr(S[i], 4)
    if (dep > lim) continue
    if (t == "n") { b = $0; while ((q = index(b, "/")) > 0) b = substr(b, q + 1); ok = (b == v) }
    else ok = (length($0) > length(v) + 1 && substr($0, length($0) - length(v)) == "/" v)
    if (ok && C[i] < 3) { C[i]++; print; break }
  }
}' | head -n 24 | while IFS= read -r f; do emit "$f"; done
exit 0`;

// RESOLVE_SCRIPT 출력 → 못 찾은 상대 후보(`?` 레코드) 배열 · 최대 max 개(SEARCH_SCRIPT 의 상한과 같다).
export function unresolved(stdout, { max = 10 } = {}) {
  const out = [];
  for (const r of String(stdout ?? "").split("\0")) {
    if (out.length >= max) break;
    if (r.startsWith("?") && r.length > 1 && !CTRL.test(r)) out.push(r.slice(1));
  }
  return out;
}

// 눌린 터미널이 있는 머신: main.js location() 과 같은 규칙(터미널만 눌렸으면 주소 앞부분 · 아니면 활성 space 의 machine) — space 가 머신을 안 알려 주면 주소 앞부분으로.
export function terminalMachine(f, space, addr) {
  const pre = typeof addr === "string" && addr.includes("/") ? addr.split("/")[0] : null;
  return f?.pane === null ? pre : space?.machine ?? pre;
}

// 1단계 결과 + 2단계 결과(실패·건너뜀이면 null) → 한 목록. 2단계가 없어도 1단계 결과는 남는다.
export function mergeResolved(direct, search, opts) {
  return parseResolved(`${direct ?? ""}\0${search ?? ""}`, opts);
}

// 스크립트 출력(NUL 구분) → 절대 경로 배열. 순서 유지 · 중복 제거 · `/` 시작 · 이름이 safeName · 제어문자 없음 · max 개.
export function parseResolved(stdout, { max = 8 } = {}) {
  const out = [], seen = new Set();
  for (const p of String(stdout ?? "").split("\0")) {
    if (out.length >= max) break;
    if (!p.startsWith("/") || CTRL.test(p) || seen.has(p)) continue;
    if (!safeName(p.split("/").pop())) continue;
    seen.add(p); out.push(p);
  }
  return out;
}
