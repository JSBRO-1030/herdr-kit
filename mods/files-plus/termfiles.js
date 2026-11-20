// «터미널에 나온 파일» — 터미널 출력 글자에서 파일 이름 후보를 뽑고(candidates), 그 컴퓨터에 진짜 있는 것만 가린다(RESOLVE_SCRIPT · parseResolved).
// herdr 모듈을 쓰지 않는다 — node 와 QuickJS 둘 다 돈다(tests/termfiles.test.mjs).
// [경고] 터미널 출력은 믿을 수 없는 입력이다: 이름은 «데이터» 로만 다룬다 — sh 에는 위치 인자로만 넘기고 스크립트 글자에 끼우지 않는다.
import { IMAGE, CONVERT, DOC, PAGE, extOf } from "./kinds.js";
import { safeName } from "./state.js";
import { utf8Len } from "./fsops.js";

// 코드 · 글 파일 확장자 — 에이전트가 «고친 파일» 로 찍는 것들. 점 파일(`.env`)은 «이름 없는 확장자» 규칙으로 계속 빠진다.
export const CODE_EXTS = new Set(("sh bash zsh fish ps1 bat cmd py pyi ipynb js mjs cjs ts mts cts tsx jsx vue svelte astro css scss sass less rs go java kt kts swift c h cc cpp cxx hpp hh cs fs rb php pl pm lua jl dart scala clj ex exs erl hrl hs ml mli elm nim zig sol sql graphql gql proto prisma tf tfvars hcl nix ini cfg conf properties gradle cmake diff patch rst tex bib org adoc").split(" "));
export const TERM_EXTS = new Set([...IMAGE, ...CONVERT, ...DOC, ...PAGE, "txt", "csv", "tsv", "json", "log", "yaml", "yml", "xml", "toml", ...CODE_EXTS]);
// 확장자 찾기는 Set 조회로 한다(점마다 129개를 훑지 않게). 전제: 모든 확장자가 [a-z0-9] 뿐 — 점 뒤 영숫자 줄을 읽어 긴 쪽부터 조회하면 «그 점의 가장 긴 확장자» 와 같다(`.html` 이 `.htm` 으로, `.docx` 가 `.doc` 로 잘리지 않게).
for (const e of TERM_EXTS) if (!/^[a-z0-9]+$/.test(e)) throw new Error(`termfiles: 확장자는 [a-z0-9] 만 — ${e}`);
const MAX_EXT_LEN = Math.max(...[...TERM_EXTS].map(e => e.length));
export const MAX_TOKEN_BYTES = 1024;

// 토큰 경계: 공백 · 따옴표 · 백틱 · <>|()[]{} · = (`--out=/tmp/x.pdf` → `/tmp/x.pdf`) · 상자선(U+2500–257F) · ⎿ ⏺ ● • · 묶음표 « » 「 」 『 』 《 》 〈 〉 【 】 (에이전트 화면 장식)
const CUT = /[\s'"`<>|()[\]{}=\u2500-\u257f\u23bf\u23fa\u25cf\u2022«»「」『』《》〈〉【】]+/;
const GLOB = /[*?[\\]/;
const CTRL = /[\u0000-\u001f\u007f]/;
const WORD = /[\p{L}\p{N}]/u;                      // 확장자 바로 뒤에 붙은 글자(영숫자 · 한글 …)

// 끝의 `.,;:` 와 줄 위치 꼬리(`:줄` · `:줄:열` · `:줄-줄` · `#L줄` · `#L줄-L줄` · `#L줄C열` · `#L줄C열-L줄C열`)를 뗀다(더 뗄 게 없을 때까지). 끝에서 한 번씩 훑는다 — 점이 긴 토큰도 선형.
const isDigit = (ch) => ch >= "0" && ch <= "9";
const digitsBack = (s, e) => { while (e > 0 && isDigit(s[e - 1])) e--; return e; };
// `L<줄>[C<열>]` 이 e 에서 끝나면 그 L 의 위치, 아니면 -1.
function lineRefBack(s, e) {
  let q = digitsBack(s, e);
  if (q === e) return -1;
  if (q > 0 && s[q - 1] === "C") { const d = digitsBack(s, q - 1); if (d < q - 1) q = d; else return -1; }
  return q > 0 && s[q - 1] === "L" ? q - 1 : -1;
}
// e 에서 끝나는 줄 위치 꼬리가 있으면 그 앞 위치, 없으면 e.
function locBack(s, e) {
  const i = digitsBack(s, e);
  if (i < e && i > 0) {
    if (s[i - 1] === ":") { const j = i - 1, k = digitsBack(s, j); return k < j && k > 0 && s[k - 1] === ":" ? k - 1 : j; }
    if (s[i - 1] === "-") {                                    // `:줄-줄` · `#L줄-줄`
      const k = digitsBack(s, i - 1);
      if (k < i - 1 && k > 0 && s[k - 1] === ":") return k - 1;
      const t = lineRefBack(s, i - 1);
      if (t > 0 && s[t - 1] === "#") return t - 1;
    }
  }
  const a = lineRefBack(s, e);
  if (a > 0) {
    if (s[a - 1] === "#") return a - 1;
    if (s[a - 1] === "-") { const t = lineRefBack(s, a - 1); if (t > 0 && s[t - 1] === "#") return t - 1; }
  }
  return e;
}
// 끝 위치(e)에서 꼬리를 뗀 새 끝 위치. 자르지 않고 인덱스만 옮긴다 — QuickJS 의 slice 는 복사라 반복 slice 는 제곱 비용.
function trimEnd(s, e) {
  for (;;) {
    const before = e;
    while (e > 0 && ".,;:".includes(s[e - 1])) e--;
    e = locBack(s, e);
    if (e === before) return e;
  }
}
// [주의] 운영 코드에서는 더 안 부른다(stripDeco 가 trimEnd 를 직접 호출) — 테스트 이음새로만 export 유지.
export function trimTail(s) {
  return s.slice(0, trimEnd(s, s.length));
}

// 마크다운 굵게(`**a.md**`) · 끝 `? ! 。 、` 장식을 뗀다(GLOB 검사 전). 앞 `*` 한 개는 글롭(`ls *a.md` → 나오지 않음) · 두 개 이상은 굵게로 떼되, 그 뒤가 `.` · `/` 이거나 `*` 뿐이면 글롭(`*.ts` · `**/a.md`)이라 버린다. 뒤쪽 `*` 짝은 맞추지 않는다. 선형 루프만 쓴다.
const DECO = "*?!。、";
function stripDeco(s) {
  let b = 0;
  while (b < s.length && s[b] === "*") b++;
  if (b === 1 || (b > 1 && (b === s.length || s[b] === "." || s[b] === "/"))) return "";
  // 끝 인덱스만 옮기고 마지막에 한 번만 slice 한다(b 앞은 `*` 뿐이라 trimEnd 가 b 를 넘어 먹지 않는다).
  let e = s.length;
  for (;;) {
    const before = e;
    while (e > b && DECO.includes(s[e - 1])) e--;
    e = trimEnd(s, e);
    if (e === before) return s.slice(b, e);
  }
}

const isCode = (p) => CODE_EXTS.has(extOf(p));
const ASCII_ALNUM = /[A-Za-z0-9]/;

// 토큰 하나 → 후보들(긴 것 먼저). 붙은 확장자(`a.pdfreport/b.pdf`)는 앞 조각을 후보로 쓰고 뒤 조각을 이어 본다.
// memo = scanText 한 번 안에서만 쓰는 Map(토큰 → 결과 배열) · 반환 배열은 호출 쪽이 바꾸지 않는다.
function fromToken(tok, memo) {
  const hit = memo?.get(tok);
  if (hit) return hit;
  const r = fromTokenRaw(tok);
  memo?.set(tok, r);
  return r;
}
function fromTokenRaw(tok) {
  if (tok.includes("://") && !tok.startsWith("file://")) return [];   // URL 이 후보 · 찾기 자리를 먹지 않게
  if (tok.startsWith("file://")) {
    try { tok = decodeURIComponent(tok.slice(7)); } catch { return []; }
  }
  if (!tok || utf8Len(tok) > MAX_TOKEN_BYTES) return [];
  tok = stripDeco(tok);
  if (!tok || GLOB.test(tok) || CTRL.test(tok)) return [];
  const lower = tok.toLowerCase();
  // 경계: `.<ext>` 의 끝 위치. 같은 점에서는 가장 긴 확장자 하나. 뒤가 토큰 끝이거나 글자(붙은 확장자)일 때만 경계다 —
  // `report.html.bak` 의 `.html` 뒤는 `.` 이므로 경계가 아니다(= `.bak` 백업은 후보가 아니다).
  // 코드 확장자는 영숫자(ASCII)가 바로 붙으면 경계가 아니다 — `x.config` 가 `x.conf` 로, `a.class` 가 `a.c` 로 잘리지 않게(한글 등은 붙은 확장자로 본다).
  const ends = [];
  for (let i = lower.indexOf("."); i >= 0; i = lower.indexOf(".", i + 1)) {
    // 점 뒤 [a-z0-9] 줄(최대 MAX_EXT_LEN)을 읽고 긴 쪽부터 Set 조회 — 첫 적중이 그 점의 가장 긴 확장자.
    let run = 0;
    while (run < MAX_EXT_LEN) { const c = lower.charCodeAt(i + 1 + run); if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) run++; else break; }
    let ext = null;
    for (let n = run; n >= 1; n--) { const x = lower.slice(i + 1, i + 1 + n); if (TERM_EXTS.has(x)) { ext = x; break; } }
    if (!ext) continue;
    const end = i + 1 + ext.length, nextCp = tok.codePointAt(end);
    if (nextCp === undefined) { ends.push(end); continue; }
    const ch = String.fromCodePoint(nextCp);
    if (WORD.test(ch) && !(CODE_EXTS.has(ext) && ASCII_ALNUM.test(ch))) ends.push(end);
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

// ── 줄바꿈으로 잘린 경로 이어 보기 ──
// 에이전트는 긴 줄을 하드 랩한다(Claude Code 는 2~6 칸 들여쓴 다음 줄 · Gemini 는 `│ … │` 상자 · Codex 는 들여쓰기). 위 줄 끝 토큰 + 아래 줄 머리 토큰을 붙여 본다.
// [주의] 단어 경계에서 접힌 것과 토큰 중간에서 잘린 것은 글자만으론 구별이 안 된다 → 붙인 후보는 «추측»(guesses) — 호출 쪽이 직접 풀기만 하고 찾기(find)에는 넘기지 않는다.
const isCut = (ch) => CUT.test(ch);
const isBox = (ch) => ch >= "─" && ch <= "╿";
const WS = /\s/;
const SEP = "/._-~";
const hasSep = (s) => { for (let i = 0; i < s.length; i++) if (SEP.includes(s[i])) return true; return false; };
// 줄 끝: 공백 → 상자선 → 공백을 뗀 글.
function coreEnd(line) {
  let e = line.length;
  while (e > 0 && WS.test(line[e - 1])) e--;
  while (e > 0 && isBox(line[e - 1])) e--;
  while (e > 0 && WS.test(line[e - 1])) e--;
  return line.slice(0, e);
}
// 줄 머리: 공백 → (상자선 · ⎿ + 공백) 최대 두 번을 뗀 글.
function coreStart(line) {
  let s = 0;
  while (s < line.length && WS.test(line[s])) s++;
  for (let n = 0; n < 2 && s + 1 < line.length; n++) {
    if (!(isBox(line[s]) || line[s] === "⎿") || !WS.test(line[s + 1])) break;
    s++;
    while (s < line.length && WS.test(line[s])) s++;
  }
  return line.slice(s);
}
const lastTok = (core) => { const t = core.split(CUT); for (let i = t.length - 1; i >= 0; i--) if (t[i]) return t[i]; return ""; };
const firstTok = (core) => { const t = core.split(CUT); for (let i = 0; i < t.length; i++) if (t[i]) return t[i]; return ""; };
// 조각들을 이어 만든 후보 중 조각 하나만으로는 안 나오는 것.
function joined(pieces, memo) {
  for (const p of pieces) if (utf8Len(p) > MAX_TOKEN_BYTES) return [];   // 너무 긴 조각은 잇지 않는다(stripDeco 전에 거른다)
  const own = new Set();
  for (const p of pieces) for (const c of fromToken(p, memo)) own.add(c);
  return fromToken(pieces.join(""), memo).filter(c => !own.has(c));
}
// 위 줄 끝 토큰이 이미 «끝난 이름»(확장자로 끝남)이면 이을 이유가 없다 — 파일 목록 줄들이 서로 붙어 가짜 후보가 되지 않게.
// 너무 긴 조각은 «이을 수 없음» → complete 로 친다(stripDeco 전에 길이부터 본다).
const complete = (tail, memo) => { if (utf8Len(tail) > MAX_TOKEN_BYTES) return true; const t = stripDeco(tail); return fromToken(tail, memo).some(c => t.endsWith(c)); };

// 터미널 글자 → { cands: 후보 이름 배열, guesses: 줄 잇기로만 나온 후보 Set }. 아래 줄이 더 최근 · 가장 최근 것부터 · 중복 없이.
// 상한: 일반 파일 max(40)개 + 코드 파일 maxCode(20)개.
export function scanText(text, { max = 40, maxCode = 20 } = {}) {
  const lines = String(text ?? "").split(/\r\n|\n|\r/);
  const memo = new Map();   // 이 호출 안에서만 — 같은 토큰을 줄 잇기가 여러 번 다시 풀지 않게
  const info = lines.map(l => ({ toks: l.split(CUT).filter(Boolean), end: coreEnd(l), start: coreStart(l) }));
  // 줄 i 의 머리에서 낼 «이은 후보»: 두 줄(i-1, i) 과 세 줄(i-2, i-1, i) 이음. 세 줄은 가운데 줄이 토큰 하나뿐일 때만.
  const joinAt = (i) => {
    const out = [], b = info[i].start;
    if (i < 1 || !b || isCut(b[0])) return out;
    const bHead = firstTok(b);
    const a = info[i - 1].end;
    if (a && !isCut(a[a.length - 1])) {                          // 두 줄
      const aTail = lastTok(a);
      if (hasSep(aTail) && !complete(aTail, memo)) out.push(...joined([aTail, bHead], memo));
    }
    if (i >= 2) {                                                // 세 줄
      const m = info[i - 1].start, a2 = info[i - 2].end, mp = coreEnd(m);   // 가운데 조각 = 뒤 공백 · 상자 가장자리를 뗀 글
      if (mp && a2 && !isCut(m[0]) && !isCut(a2[a2.length - 1]) && mp.split(CUT).filter(Boolean).length === 1 && !isCut(mp[mp.length - 1])) {
        const aTail = lastTok(a2);
        if (hasSep(aTail) && !complete(aTail, memo)) out.unshift(...joined([aTail, mp, bHead], memo));
      }
    }
    return out;
  };
  const seen = new Set(), cands = [], guesses = new Set();
  let nPlain = 0, nCode = 0;
  const add = (c, viaJoin) => {
    if (seen.has(c)) { if (!viaJoin) guesses.delete(c); return; }   // 직접 나온 적이 있으면 추측이 아니다
    const code = isCode(c);
    if (code ? nCode >= maxCode : nPlain >= max) return;
    seen.add(c); cands.push(c);
    if (code) nCode++; else nPlain++;
    if (viaJoin) guesses.add(c);
  };
  for (let i = lines.length - 1; i >= 0 && (nPlain < max || nCode < maxCode); i--) {
    const toks = info[i].toks;
    for (let j = toks.length - 1; j >= 0; j--) {
      if (j === 0) for (const c of joinAt(i)) add(c, true);          // 이은 후보는 이 줄 머리 토큰의 자리(머리 토큰 자기 후보 바로 앞)
      for (const c of fromToken(toks[j], memo)) add(c, false);
      if (nPlain >= max && nCode >= maxCode) break;
    }
  }
  return { cands, guesses };
}

// 후보 이름 배열(scanText(...).cands).
export function candidates(text, opts) {
  return scanText(text, opts).cands;
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
// skip = 찾기에 넘기지 않을 이름(줄 잇기 추측 — scanText 의 guesses). 건너뛴 것은 max 에 세지 않는다.
export function unresolved(stdout, { max = 10, skip } = {}) {
  const out = [];
  for (const r of String(stdout ?? "").split("\0")) {
    if (out.length >= max) break;
    if (r.startsWith("?") && r.length > 1 && !CTRL.test(r) && !skip?.has(r.slice(1))) out.push(r.slice(1));
  }
  return out;
}

// 눌린 터미널이 있는 머신: main.js location() 과 같은 규칙(터미널만 눌렸으면 주소 앞부분 · 아니면 활성 space 의 machine) — space 가 머신을 안 알려 주면 주소 앞부분으로.
export function terminalMachine(f, space, addr) {
  const pre = typeof addr === "string" && addr.includes("/") ? addr.split("/")[0] : null;
  return f?.pane === null ? pre : space?.machine ?? pre;
}

// 줄 수 상한: max 를 넘으면 일반 파일(문서 · 이미지 …)을 먼저 채우고 남는 자리에 코드 파일 — 원래 순서로 돌려준다(코드 파일이 문서를 밀어내지 않게).
export function pickRows(list, max) {
  if (list.length <= max) return list;
  const keep = new Set(), plain = list.filter(p => !isCode(p)), code = list.filter(isCode);
  for (const p of [...plain, ...code]) { if (keep.size >= max) break; keep.add(p); }
  return list.filter(p => keep.has(p));
}

// 가벼운 다시 훑기 병합: 새 결과를 먼저(pickRows) 두고 남는 자리에 앞 목록의 줄을 앞 순서대로 채운다 — 옛 문서 줄이 새 코드 줄을 밀어내지 않게.
export function mergeLight(fresh, prev, max) {
  const out = pickRows(fresh, max);
  if (out.length >= max) return out;
  const have = new Set(out);
  const rest = [];
  for (const p of prev) { if (out.length + rest.length >= max) break; if (!have.has(p)) { have.add(p); rest.push(p); } }
  return [...out, ...rest];
}

// 1단계 결과 + 2단계 결과(실패·건너뜀이면 null) → 한 목록. 2단계가 없어도 1단계 결과는 남는다. 상한은 pickRows.
export function mergeResolved(direct, search, { max = 8 } = {}) {
  return pickRows(parseResolved(`${direct ?? ""}\0${search ?? ""}`, { max: Infinity }), max);
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

// 같은 터미널(주소 동일)에서 working → 다른 상태로 바뀌었는지(빚 판정). 주소가 다르거나 앞 값이 없으면 false.
export function endedWorking(prev, cur) {
  return !!prev && !!cur && prev.addr === cur.addr && prev.status === "working" && cur.status !== "working";
}

// 훑기가 «멎었다» 고 보는 시간. 정상 훑기 최악 = hc read 5 s + 풀기 10 s + 찾기 10 s = 25 s → 여유를 두어 30 s.
export const TF_STUCK_MS = 30000;
// 훑기 시작 관문(순수): "start" = 바로 시작 · "abandon" = 앞 훑기를 버리고 새로 시작(멎음 — busyAt 이 숫자가 아니어도) · "skip" = 가벼운 훑기는 그냥 버림 · "again" = 전체 훑기는 끝난 뒤 한 번 더.
export function scanGate({ busy, busyAt, now, light, stuckMs = TF_STUCK_MS }) {
  if (!busy) return "start";
  if (!Number.isFinite(busyAt) || !Number.isFinite(now) || now - busyAt >= stuckMs) return "abandon";
  return light ? "skip" : "again";
}

// 오류 → 진단 기록용 분류(허용 목록). [경고] 메시지 글은 절대 돌려주지 않는다 — 경로 · 호스트 이름이 섞일 수 있다. 시간 초과 · 글자만으로 된 오류 이름 · "error" 중 하나.
export function errClass(e) {
  try {
    const m = String(e?.message ?? ""), n = String(e?.name ?? "");
    if (/time(d)?\s?out/i.test(m)) return "timeout";
    return /^[A-Za-z]{1,40}$/.test(n) ? n : "error";
  } catch { return "error"; }
}

// 틱·스캔이 같이 쓰는 대상 key(주소|머신|폴더|상태) — 스캔이 «자기가 읽는 대상» 의 key 를 직접 만들 수 있게 순수 함수로 둔다.
export function termKey(t) {
  return t ? `${t.addr}|${t.on}|${t.cwd}|${t.status}` : "";
}

// 멎음 감시 백오프: 연속으로 버린 횟수(run)가 늘수록 기다림을 두 배씩(30 s · 60 s · 120 s · 240 s · 480 s 상한). run 이 숫자가 아니거나 음수면 base.
// [주의] 버려도 원격 exec 는 못 끊는다 — 감시가 멎은 머신에 find 를 계속 쌓지 않게 간격을 넓힌다.
export function stuckAfter(run, base = TF_STUCK_MS) {
  return Number.isFinite(run) && run >= 0 ? base * 2 ** Math.min(run, 4) : base;
}

// 진단 기록을 쓸지(순수). prev · next = at 뺀 기록. 처음 · 분류가 바뀜 · 개수(cands · found · shown) 중 하나가 0 이 되거나 0 에서 벗어남 → 바로 · 그 밖에 개수 크기만 바뀌면(1 → 2) minGap 이 지났을 때만 · 같으면 안 쓴다.
// 0 여부를 분류에 넣는 이유: «3 → 0» 이 minGap 에 막힌 채 훑기가 더 없으면 기록은 영영 3 인데 띠는 «· 0» 이 되는 증상을 숨긴다.
// [주의] setShared 는 shared.json 을 다시 쓰고 모든 모드를 다시 그린다 — 개수만 자주 바뀌는 기록으로 쓰기가 쏟아지지 않게.
const COUNT_KEYS = ["cands", "found", "shown"];
const sigNoCounts = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, COUNT_KEYS.includes(k) ? Number(v) > 0 : v])));
export function noteWrite(prev, next, now, lastAt, minGap = 15000) {
  if (prev == null) return true;
  if (sigNoCounts(prev) !== sigNoCounts(next)) return true;
  if (JSON.stringify(prev) === JSON.stringify(next)) return false;
  return !Number.isFinite(now - lastAt) || now - lastAt >= minGap;
}
