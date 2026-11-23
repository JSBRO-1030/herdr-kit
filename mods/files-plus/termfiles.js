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
  // [주의] toLowerCase() 는 `İ`(U+0130) 같은 글자의 길이를 바꿔 인덱스가 tok 와 어긋난다 → 길이를 지키는 ASCII A–Z 만 접는다(TERM_EXTS 는 전부 ASCII).
  const lower = tok.replace(/[A-Z]+/g, s => s.toLowerCase());
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
//     맨 앞에 `=<cwd 실제 경로>` 레코드 하나(dcChoose 가 상대 후보의 기대 경로를 만든다 · parseResolved · unresolved 는 무시). 못 찾은 «상대» 후보는 `?후보` 레코드로 돌려준다(unresolved) — 절대 · `~/` 는 찾지 않는다.
//  2) SEARCH_SCRIPT(느릴 수 있음): 1) 이 못 찾은 이름만 find 한 번으로 — cwd 아래 깊이 3(경로 후보는 그 조각 수 + 2, 최대 6) · -xdev · .git/node_modules 는 들어가지 않는다.
//     `/` 없는 이름 = 이름이 같은 파일 · `/` 든 상대 경로 = 경로 끝이 같은 파일(`*/src/a.json`). 이름 하나당 3개 · 전체 24개까지.
//     cwd 가 `/` 이거나 실제 $HOME 이거나 $HOME 의 조상이면 아예 찾지 않는다. 이름은 10개까지.
// 개행·제어문자가 든 경로는 내지 않는다(예외: `=<root>` 기록 — dcChoose 의 CTRL 검사가 거른다) · cwd 가 폴더가 아니면 exit 3. parseResolved 는 `/` 로 시작하는 레코드만 쓴다(`?` 레코드 무시).
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
printf '=%s\\0' "$root"
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

// ── 터미널에서 파일 이름을 더블클릭 → 미리보기 ──
// 순수 함수만 둔다(입출력 없음). 호출은 main.js dcTick. 클립보드 글은 «터미널 글자에서 찾은 후보 중 하나를 고르는 데만» 쓴다 — 클립보드에서만 온 글은 exec 로 가지 않는다(dcPick 이 터미널의 사본을 돌려준다).

// 화면 칸 수: 동아시아 와이드(한글 · CJK · 전각 …) 2 · 결합 문자 · 폭 없는 글 0 · 나머지 1.
const WIDE = [[0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1f64f], [0x1f900, 0x1f9ff], [0x20000, 0x3fffd]];
const ZERO = [[0x0300, 0x036f], [0x200b, 0x200f], [0xfe00, 0xfe0f], [0x1ab0, 0x1aff], [0x20d0, 0x20ff], [0x1160, 0x11ff], [0xd7b0, 0xd7ff], [0x3099, 0x309a], [0x302a, 0x302f]];   // 일본어 탁점 결합(NFD) · 한자 성조 표시 포함
const inRanges = (cp, rs) => { for (let k = 0; k < rs.length; k++) if (cp >= rs[k][0] && cp <= rs[k][1]) return true; return false; };   // 색인 루프(해석기에서 구조 분해보다 몇 배 빠르다)
export function cellWidth(s) {
  let w = 0;
  for (const ch of String(s ?? "")) {
    const cp = ch.codePointAt(0);
    w += inRanges(cp, ZERO) ? 0 : inRanges(cp, WIDE) ? 2 : 1;
  }
  return w;
}

const okCell = (c) => Number.isInteger(c?.row) && Number.isInteger(c?.col) && c.row >= 0 && c.col >= 0;
// 시작 ≤ 끝 이 되게 순서를 바로잡는다. 잘못된 모양이면 null.
function orderSel(sel) {
  if (!okCell(sel?.start) || !okCell(sel?.end)) return null;
  const a = sel.start, b = sel.end;
  return a.row < b.row || (a.row === b.row && a.col <= b.col) ? { s: a, e: b } : { s: b, e: a };
}

// 선택된 칸 수(양끝 포함). 모르겠으면 null: 모양이 틀림 · cols 가 양의 정수가 아님 · 칸이 cols 밖 · maxRows 줄 넘음 · 전체 선택(Cmd+A: 0,0 에서 시작하는 여러 줄).
export function selSpan(sel, cols, { maxRows = 3 } = {}) {
  if (!Number.isInteger(cols) || cols <= 0) return null;
  const o = orderSel(sel);
  if (!o) return null;
  const { s, e } = o;
  if (s.col >= cols || e.col >= cols) return null;
  const rows = e.row - s.row + 1;
  if (rows > maxRows) return null;
  if (rows === 1) return e.col - s.col + 1;
  if (s.row === 0 && s.col === 0) return null;
  return (cols - s.col) + (rows - 2) * cols + e.col + 1;
}

export const selKey = (sel) => (okCell(sel?.start) && okCell(sel?.end)
  ? `${sel.start.row}:${sel.start.col}-${sel.end.row}:${sel.end.col}` : null);
// 더블클릭 선택 감지(순수). state 는 호출 쪽이 들고 있다가 그대로 돌려준다 → { state, fire }. fire 는 같은 선택에서 많아야 한 번.
//  · 처음 본 것은 기준선일 뿐이다(이미 있던 선택은 «새 것» 이 아니다). 주소가 바뀐 것도 기준선 — 단 prevKey(앞 틱 terminals() 에서 이 주소의 key · undefined = 모름)가 있고 지금 key 와 다르면
//    포커스 이동과 같은 틱에 선택이 선 것(포커스 없는 창 더블클릭) → 새 선택으로 본다.
//  · 앞 관찰과 다른 선택(null 뒤 · 다른 선택 · 아직 변하던 선택)이 새 것 → settleMs 동안 똑같이 머물러야 fire(바뀌면 시계 다시).
//  · null 을 보면 fire 기억을 지운다 → 같은 낱말을 다시 더블클릭하면 또 fire.
//  · 같은 주소에서 cols(칸 수)가 바뀌면 기준선(fire 없음) · 그 뒤 reflowMs 안의 key 변화도 기준선 — 줄바꿈이 다시 돼 선택이 밀린 것이지 새 더블클릭이 아니다. cols 를 모르면(undefined) 이 규칙은 없다.
// [주의] 끌기(drag)와 더블클릭은 구별되지 않는다 — 끌다 놓아 settleMs 머문 선택도 fire 한다.
export function dcStep(state, { addr, sel, cols, now, prevKey }, { settleMs = 400, reflowMs = 1000 } = {}) {
  const key = selKey(sel);
  if (!state) return { state: { addr, key, cols, since: now, fired: true }, fire: false };
  if (state.addr !== addr) {
    if (prevKey === undefined || prevKey === key) return { state: { addr, key, cols, since: now, fired: true }, fire: false };
    return { state: { addr, key, cols, since: now, fired: false }, fire: false };
  }
  const c = cols ?? state.cols, ra = state.reflowAt;
  const keep = ra === undefined ? {} : { reflowAt: ra };
  // 칸 수가 바뀌면(창 크기) 터미널이 글을 다시 줄바꿈해 선택이 밀린다 → 새 선택이 아니라 기준선. 그 직후 reflowMs 동안 바뀌는 key 도 같다.
  if (cols !== undefined && state.cols !== undefined && cols !== state.cols) return { state: { addr, key, cols, since: now, fired: true, reflowAt: now }, fire: false };
  if (key === null) return { state: { addr, key: null, cols: c, since: now, fired: false, ...keep }, fire: false };
  if (key !== state.key) {
    if (ra !== undefined && now - ra < reflowMs) return { state: { addr, key, cols: c, since: now, fired: true, reflowAt: ra }, fire: false };
    return { state: { addr, key, cols: c, since: now, fired: false, ...keep }, fire: false };
  }
  if (!state.fired && now - state.since >= settleMs) return { state: { ...state, cols: c, fired: true }, fire: true };
  return { state, fire: false };
}

// ── 선택 ↔ 터미널 글자 묶기(dcBind) ──
// 선택 칸(행 · 열)을 hc read 글의 «한 줄 안 글자 범위» 로 바꾼다. 묶이면 dcPick · dcLonger 가 «그 자리의 앞뒤 글» 로만 판단한다(전체 글 훑기 · 낡은 쌍 오탐 없음).
// 행 = 가장 오래된 기록부터 지금 화면까지 센 줄(소프트 랩 포함). hc read 의 줄은 «논리 줄» 이라 한 줄이 여러 행을 차지한다 — 칸 걸음(cell walk)으로 센다.
// [경고] 클립보드(clip)는 «자체 검사» 에만 쓴다 — 돌려주는 값은 글(text)에서 나온 줄 · 숫자뿐이다.
// [주의] 같은 열의 같은 낱말이 한 화면 안 다른 행에 또 있으면 닻이 어긋났을 때 잘못 묶일 수 있다 → 모호함 가드(dcBind)가 그런 경우를 묶지 않는다.
const posInt = (n) => Number.isInteger(n) && n > 0;

// 행 계산 전용 폭 범위 [lo, hi] — Herdr 0.1.16 VM 실측(유니코드 표준 폭: 동아시아 넓음 · 그림 글자 기본 표시 = 2 · 결합 글자 = 0 · 이형 선택자 VS16 = 앞 글자를 2 칸으로 넓힘). cellWidth · WIDE · ZERO 는 건드리지 않는다(칸 수 검사가 쓴다).
// 확실한 것은 lo = hi · 불확실하면 lo ≠ hi. 한 번도 안 본 글자는 [0, 2].
const W11 = [1, 1], W22 = [2, 2], W00 = [0, 0], W01 = [0, 1], W12 = [1, 2], W02 = [0, 2];
const RNG_ONE = new Set([0x23FA, 0x23BF, 0x273B, 0x25CF, 0x2014, 0x2026, 0x2713, 0x2714, 0x2717, 0x26A0, 0x2605, 0x25B6, 0x276F, 0x2139]);   // 실측 1 칸 낱개
const RNG_TWO = new Set([0x2705, 0x274C, 0x26A1, 0x2728, 0x2B50, 0x1F680, 0x1F525, 0x1F4C1, 0x1F7E2, 0x1FA84]);                           // 실측 2 칸 낱개
const RNG_ONE_BLOCKS = [[0x0370, 0x03ff], [0x0400, 0x0482], [0x048a, 0x052f], [0x1e00, 0x1eff], [0x2010, 0x2027], [0x2030, 0x205e], [0x2190, 0x21ff], [0x2500, 0x259f], [0x2800, 0x28ff]];   // 표준 폭 1 · 그림 글자 기본 표시 없음
const RNG_PICT = [[0x1f300, 0x1f64f], [0x1f900, 0x1f9ff]];   // WIDE 중 그림 글자 두 범위 — 2 칸 아닌 것이 섞여 있다
// 표(WIDE · ZERO)가 «확실» 이라 했지만 Herdr 가 다르게 그리는 글자 — 불확실 [0, 2] 로 내린다(하한 0 → 행 수 하한이 참으로 남고 · 칸 걸음은 DC_UNSURE → null → 옛 길).
// 출처: 낱개(U+3248–324F · FF00 · 3097 · A48D · 3130 · 318F · 321F · FE53 · 2E9A · 31E6 · A97D 는 1 칸 · U+3164 · 115F 는 0 칸)는 Herdr 0.1.16 VM 실측 ·
//   나머지 범위(배정 안 된 글자 · 채움 글자 · 폭 0 인 글자)는 유니코드 17 전 글자를 터미널 폭 규칙(Ghostty 쪽 wcwidth)에 대 훑은 것 중 표와 어긋난 것 전부. U+302E–302F 는 한글 성조 표시(Mc · 칸 차지 글자)인데 모델은 0 칸으로 본다 → 불확실.
// [주의] 표와 «맞는» 글자(U+FA6E · 2A6E0 · 배정 안 된 것 · U+31E3–31E5 · 31EF · 2FFC · 2FFF 는 배정된 So 글자 · 실측 2 칸)는 여기 넣지 않는다.
const WIDE_UNSURE = [[0x115f, 0x115f], [0x2e9a, 0x2e9a], [0x2ef4, 0x2eff], [0x2fd6, 0x2fef], [0x3097, 0x3098], [0x3100, 0x3104], [0x3130, 0x3130], [0x3164, 0x3164], [0x318f, 0x318f], [0x31e6, 0x31ee], [0x321f, 0x321f], [0x3248, 0x324f], [0xa48d, 0xa48f], [0xa4c7, 0xa4cf], [0xa97d, 0xa97f], [0xfe53, 0xfe53], [0xfe67, 0xfe67], [0xfe6c, 0xfe6f], [0xff00, 0xff00], [0x2fffe, 0x2ffff]];
const ZERO_UNSURE = [[0x1ade, 0x1adf], [0x1aec, 0x1aff], [0x20f1, 0x20ff], [0x302e, 0x302f], [0xd7c7, 0xd7ca], [0xd7fc, 0xd7ff]];
// 뜨거운 길: 목록 훑기(20 개) 대신 로드 때 범위를 펼친 Set 조회(상수 시간) — 범위 배열이 원본이고 Set 은 거기서만 만든다(어긋날 수 없다).
const rangeSet = (rs) => { const s = new Set(); for (const [lo, hi] of rs) for (let c = lo; c <= hi; c++) s.add(c); return s; };
const WIDE_UNSURE_SET = rangeSet(WIDE_UNSURE), ZERO_UNSURE_SET = rangeSet(ZERO_UNSURE);
const cpRange = (cp) => {
  if (cp < 0x300) return W11;   // 제어 문자(U+0000–001F · 007F–009F)는 터미널이 실행하고 칸에 저장하지 않아 `hc read` 글에 나오지 않는다 — 빠른 길이 기대므로 그대로 둔다
  if (RNG_ONE.has(cp)) return W11;
  if (RNG_TWO.has(cp)) return W22;
  if (cp >= 0xfe00 && cp <= 0xfe0f) return W01;
  if (inRanges(cp, ZERO)) return ZERO_UNSURE_SET.has(cp) ? W02 : W00;
  if (inRanges(cp, RNG_PICT)) return W12;
  if (inRanges(cp, WIDE)) return WIDE_UNSURE_SET.has(cp) ? W02 : W22;
  if (inRanges(cp, RNG_ONE_BLOCKS)) return W11;
  return W02;
};
// 묶음 위험 줄: Herdr 는 폭을 글자 묶음(grapheme cluster) 단위로 잰다 → 표 합과 어긋나는 열이 든 줄(실측 0.1.16: 🚀 ZWJ 🔥 = 2 칸(표 4) · ✅ VS15 = 1(표 2) · 첫소리 겹침 ᄀᄀ = 1(표 4) · 피부색 ✋🏻 = 2 · 🇰🇷 = 2).
//  ZWJ(U+200D) · VS15(U+FE0E) · 3 칸 줄표 U+2E3B(⸻ · 폭 모델 3 칸 · 표 [0, 2] 라 행 수가 모자랄 수 있다 · 실측 아님 → 예방으로 위험) · 피부색 수식(U+1F3FB–1F3FF) · 중성 자모(1160–11A7 · D7B0–D7C6)가 «바로 뒤에 없는» 첫소리 자모(1100–115F · A960–A97F: 홀로 · 첫소리 겹침 · 완성형 음절 앞 · 끝소리 앞 · 줄 끝) · 앞이 한글이 아니거나 줄 머리인 중성/끝소리 자모(1160–11FF · D7B0–D7FF).
//  홀로 첫소리는 실측(0.1.16) ASCII x 앞 · 공백 앞 · 한자 앞 · 줄 끝(다음 행으로 넘어감)에서 모두 2 칸 = 표(W22)와 같다. 그래도 첫소리 겹침이 1 칸으로 좁아지는 걸 보면 첫소리 처리가 폭 표와 다르고 끝소리 앞 등은 안 재서 — 닫는 쪽(fail-closed)으로 위험 줄 = 옛 길.
//  표준 NFD 한글(첫소리 + 중성 [+ 끝소리] · macOS 파일 이름)은 위험이 아니다. 정규식은 ASCII · \uXXXX 만(QuickJS: `u` 플래그 없음).
const DC_HAZARD = /\u200D|\uFE0E|\u2E3B|\uD83C[\uDFFB-\uDFFF]|[\u1100-\u115F\uA960-\uA97F](?![\u1160-\u11A7\uD7B0-\uD7C6])|(?:^|[^\u1100-\u11FF\uA960-\uA97F\uD7B0-\uD7FF\uAC00-\uD7A3])[\u1160-\u11FF\uD7B0-\uD7FF]/;
const dcHazard = (line) => DC_HAZARD.test(line);
// 한 줄이 차지하는 행 수: 다음 글자가 그 행의 남은 칸에 안 들어가면 새 행(너비 2 글자는 마지막 칸이면 일찍 넘어간다) · 빈 줄 = 1 행 · 폭 0 글자는 칸을 안 쓴다.
// 폭 lo 걸음과 hi 걸음 두 행 수를 한 번에 센다(걸음은 폭에 단조 → 진짜 행 수는 둘 사이). 같으면 그 값 · 다르면 «불확실» = 음수(−lo 행 수).
// VS16(U+FE0F)은 hi 걸음에서 앞 글자를 1 칸 넓히고(마지막 칸이면 그 글자째 다음 행) · lo 걸음에서는 칸을 안 쓴다.
// bud = { left } 걸음 예산(UTF-16 단위) — 빠른 길(위 둘)이 아닌 줄은 cpRange 루프 «전에» 그 줄 길이 전체를 예산에서 빼고, 모자라면 0 을 돌려준다(줄 수는 ≥ 1 이라 0 은 겹치지 않는다).
// 0 = 예산 초과 또는 묶음 위험 줄(빠른 길 아님) — 위험 줄의 진짜 행 수는 하한보다 «적을 수» 있어 하한으로 쓸 수 없다. 묶음 위험은 줄마다 한 번만 돈다.
function dcRowsOf(line, cols, bud) {
  if (2 * line.length <= cols) return 1;   // UTF-16 단위 하나는 많아야 2 칸 → 넘칠 수 없다(빈 줄도 1)
  const n = line.length;
  let k = 0;
  while (k < n && line.charCodeAt(k) < 0x300) k++;
  if (k === n) return Math.ceil(n / cols);   // 전부 폭 1 → 글자 수 = 칸 수
  if ((bud.left -= n) < 0) return 0;         // 느린 걸음 예산 초과
  let lr = 1, lc = 0, hr = 1, hc = 0, hp = 0;
  for (k = 0; k < n;) {
    const cp = line.codePointAt(k);
    k += cp > 0xffff ? 2 : 1;
    const r = cpRange(cp), a = r[0], b = r[1];
    if (a > 0) { if (lc > 0 && lc + a > cols) { lr++; lc = 0; } lc += a; }
    if (cp === 0xfe0f) {
      if (hp > 0) { if (hc + 1 > cols) { hr++; hc = hp + 1; } else hc++; hp = 0; }
    } else if (b > 0) {
      if (hc > 0 && hc + b > cols) { hr++; hc = 0; }
      hc += b; hp = b;
    }
  }
  if (dcHazard(line)) return 0;   // 묶음 위험 줄: 행 수가 하한보다 적을 수 있다 → 호출 쪽이 null(위 빠른 길은 넘칠 수 없어 예외)
  return lr === hr ? lr : -lr;    // 확실 = 그 값 · 불확실 = 음수(−lo 행 수)
}
// 칸 걸음용 글자 폭: 확실(cpRange 가 lo = hi)하면 그 폭 · 아니면 -1. 예외 하나 — U+FE0F 바로 앞 글자의 범위가 [2,2] 면 그 FE0F 는 0(앞 칸에 붙음 · 실측 U+2705 + FE0F = 2 칸). prev = 줄 안 바로 앞 글자(없으면 -1).
// 1 칸 글자 + FE0F 는 FE0F 가 불확실이라 -1 이다(옛 추정 «2 칸» 은 쓰지 않는다).
function dcW(cp, prev) {
  if (cp === 0xfe0f && prev >= 0) { const p = cpRange(prev); if (p[0] === 2 && p[1] === 2) return 0; }
  const r = cpRange(cp);
  return r[0] === r[1] ? r[0] : -1;
}
const DC_UNSURE = Object.freeze({ unsure: true });   // dcCells · dcPos 가 «칸 폭 불확실로 못 가림» 을 알리는 값(null = 그 자리에 없음과 구별)
// 줄 안 (행 sr, 열 sc) 에서 «시작하는» 글자 ~ (행 er, 열 ec) 칸을 덮는 글자(+ 뒤따르는 폭 0 글자) 끝까지의 UTF-16 범위. 그런 글자가 없으면 null · 폭이 불확실하면 DC_UNSURE.
// 지나는 글자(시작 칸 · 끝 칸 글자까지 포함)는 모두 폭이 확실해야 한다(dcW). 끝 칸 글자 뒤: 폭 0 확실은 범위에 붙이고 계속 · 폭 하한 > 0 이면 거기서 끝 · 하한 0 < 상한이면 DC_UNSURE.
// [주의] 불확실이면 묶지 않는다(dcBind 가 null) — 불확실 글자를 추정 폭으로 걷지 않는다.
function dcCells(line, cols, sr, sc, er, ec) {
  let row = 0, col = 0, a = -1, b = -1, prev = -1;
  for (let k = 0; k < line.length;) {
    const cp = line.codePointAt(k), len = cp > 0xffff ? 2 : 1, w = dcW(cp, prev);
    prev = cp;
    if (b >= 0) {
      if (w === 0) { b = k + len; k += len; continue; }   // 폭 0 확실 글자는 끝 칸 글자에 붙는다
      if (w > 0 || (w < 0 && cpRange(cp)[0] > 0)) break;   // 폭 하한 > 0 → 새 칸에서 시작 = 범위 끝
      return DC_UNSURE;                                    // 하한 0 < 상한: 앞 칸에 붙는지 모른다
    }
    if (w < 0) return DC_UNSURE;
    if (w === 0) { k += len; continue; }
    if (col > 0 && col + w > cols) { row++; col = 0; }
    if (a < 0) {
      if (row === sr && col === sc) a = k;
      else if (row > sr || (row === sr && col > sc)) return null;   // 시작 칸에서 시작하는 글자가 없음(글자 가운데 · 빈 칸)
    }
    if (a >= 0) {
      if (row === er && col <= ec && ec < col + w) b = k + len;
      else if (row > er || (row === er && col > ec)) return null;   // 끝 칸을 덮는 글자가 없음
    }
    col += w; k += len;
  }
  return a >= 0 && b >= 0 ? { a, b } : null;
}
// 줄 안 UTF-16 위치 ks(오름차순)에서 시작하는 글자의 (행, 열)을 한 번의 걸음으로 구한다(가드용). 그 글자까지(포함) 폭이 모두 확실해야 한다 · 아니면 DC_UNSURE(글자 가운데 위치도 같다).
function dcPos(line, cols, ks) {
  const out = [];
  let row = 0, col = 0, prev = -1, j = 0;
  for (let k = 0; k < line.length && j < ks.length;) {
    if (ks[j] < k) return DC_UNSURE;
    const cp = line.codePointAt(k), len = cp > 0xffff ? 2 : 1, w = dcW(cp, prev);
    prev = cp;
    if (w < 0) return DC_UNSURE;
    if (w > 0 && col > 0 && col + w > cols) { row++; col = 0; }
    if (ks[j] === k) { out.push([row, col]); j++; }
    col += w; k += len;
  }
  return j === ks.length ? out : DC_UNSURE;
}
// 줄 수 제한(--lines n)에 걸린 읽기인가: text 의 논리 줄 수(끝 개행의 빈 조각은 줄이 아님)가 n 이상이면 앞이 잘렸을 수 있다 → true(아래 붙임만). n 이 양의 정수가 아니거나 text 가 글이 아니면 true(보수).
// split 없이 줄 끝(`\r\n` · `\n` · `\r`)을 세다가 n 에 닿으면 바로 true.
export function dcReadCut(text, n) {
  if (typeof text !== "string" || !posInt(n)) return true;
  let br = 0, k = 0;
  const len = text.length;
  while (k < len) {
    const c = text.charCodeAt(k++);
    if (c === 13 && text.charCodeAt(k) === 10) k++;
    if (c === 10 || c === 13) { if (++br >= n) return true; }
  }
  const endsBr = len > 0 && (text.charCodeAt(len - 1) === 10 || text.charCodeAt(len - 1) === 13);
  return (br > 0 && endsBr ? br : br + 1) >= n;
}
export const DC_WIN_MAX = 64 * 1024;   // = main.js TF_TEXT(옛 길이 보는 글 상한)
export const DC_BIND_MAX = 512 * 1024;   // 묶기가 걸음을 도는 글 상한(UTF-16) — 넘으면 묶지 않는다(행 계산 전체 걸음이 이 안에서만 돈다)
export const DC_WALK_MAX = 64 * 1024;    // dcBind 한 번에 «느린 걸음»(행 수 cpRange 루프 · 묶인 줄 칸 걸음 · 가드 찾기 · 가드 걸음)이 지나는 UTF-16 단위 합의 상한 — 넘으면 null(옛 길)
export const DC_FIND_DIV = 1024;         // 가드 `indexOf` 한 줄 비용 = 줄 길이 × 낱말 길이 글자 비교(QuickJS 순진한 탐색) → 예산 1 단위 = 비교 DC_FIND_DIV 번. 필요한 성질: «비교 1024 번 ≤ cpRange 걸음 1 번» → 찾기가 걸음 예산이 허용하는 시간보다 오래 걸릴 수 없다. 실측(Herdr 0.1.16 QuickJS): 상한 근처 찾기 입력(낱말 1002 자 · 62000 자 줄 · cols 334) dcBind 91 ms · 걸음 상한 입력 204–271 ms. [주의] `node --jitless` 는 찾기 비용을 못 본다(V8 indexOf 는 빠름) — 찾기 값은 `indexOf` 를 감싼 합 시험으로 확인한다
// { sel, cols, rows, text, clip, total, cut } → { lines, i, a, b } | null. lines = text.split(/\r\n|\n|\r/) · lines[i].slice(a, b) 가 선택한 글 그대로(dcWord(clip, sel) 와 같아야 한다).
//  · total = 그 터미널의 전체 행 수(panes() scroll.total · 양의 정수) · cut = text 앞을 잘랐음(줄 수 제한에 걸린 읽기 포함 — dcReadCut). total 을 모르면(양의 정수가 아님) 묶지 않는다(null).
//  · 닻 하나: d = total − R(글의 행 수). d < 0 이면 null(total 과 글이 어긋남 · cut 이든 아니든). 안 잘렸으면(!cut) d > rows 도 null(끝 빈 행이 화면보다 많은 경우 포함) · 0 ≤ d ≤ rows 면 위 붙임(오프셋 0 · 첫 줄 = 0 행). 잘렸으면 아래 붙임(오프셋 d · 마지막 줄이 total − 1 행에서 끝남).
//    이 닻으로 선택을 줄 안 글자 범위로 바꾸고 클립보드와 글자가 같아야 한다(자체 검사).
//  · 행 수 불확실 줄(dcRowsOf < 0): 안 잘린 읽기는 묶인 줄의 위치가 «위» 줄들의 행 수에 기대므로 글 안 어느 줄이든 있으면 null. 잘린 읽기는 j0(행 o.s.row − d 를 [0, R−1] 로 자른 행이 든 줄)부터 끝 줄까지 있으면 null —
//    j0 위 줄의 오차는 st(앞 줄 합)와 R(전체 합)이 같이 나눠 가져 st + d 에서 상쇄된다(진짜 행 수 ≥ 하한이라 진짜 d ≤ 계산 d → 가드 범위 [0, d] 가 진짜 오프셋을 덮는다). [주의] 이 상쇄는 아래 붙임에서만 성립한다(위 붙임은 st 만 쓴다).
//  · 묶음 위험 줄(빠른 길이 아닌 것 · dcRowsOf = 0)은 «하한» 이 아니다 — 진짜 행 수가 표 하한보다 적을 수 있어(실측 🚀 ZWJ 🔥 = 2 칸 · 표 4) 위 근거가 깨진다 → 잘린 읽기에서도 글 안 어디에 있든 null(짧은 줄 = 1 행 빠른 길은 예외).
//  · 칸 불확실: 시작 칸 · 끝 칸 글자까지 지나는 글자 중 폭이 불확실한 것(dcW)이 있으면 null.
//  · 모호함 가드(같은 열 다른 등장): 가능한 오프셋 = [0, d](글 첫 줄은 0 행보다 앞일 수 없고 글 끝은 total 을 넘을 수 없다 — 끝 빈 행 수와 무관). 그 오프셋을 낼 수 있는 등장은 첫 글자의 글 기준 행이 [o.s.row − d, o.s.row] 안인 것뿐 → 그 행과 겹치는 줄만 본다(잘린 읽기는 묶인 줄부터 아래 · 안 잘린 읽기는 d 행 이내 위 · 범위 밖 줄은 걷지도 세지도 않는다).
//    그 줄들에서 클립보드 글(w)의 다른 등장(겹침 포함 · 닻이 묶은 등장 하나만 뺀다)의 (행, 열)을 줄마다 한 번의 걸음(dcPos)으로 구해, 열이 선택 시작 열과 같고 암시 오프셋 o.s.row − (st[L] + r)이 [0, d] 안이면 null · 걸음 중 폭 불확실도 null.
//  · 상한(넘으면 null): 걸음 예산 DC_WALK_MAX — 한 번의 더블클릭이 지나는 느린 걸음 합(UTF-16): ① 행 수 걸음(빠른 길 아닌 줄의 길이 전체 · 걷기 전에 뺀다) ② 묶인 줄 칸 걸음(줄 길이) ③ 가드 찾기(범위 안 «모든» 줄 · ceil(줄 길이 × 낱말 길이 ÷ DC_FIND_DIV) · `indexOf` 앞에 뺌 · 빈 줄 0) ④ 가드 등장 줄(등장이 있는 줄은 줄 길이 «전체» · 위험 줄 검사(정규식이 줄 전체를 훑음)와 dcPos 걸음 «앞» 에 뺌) ≤ DC_WALK_MAX — 넘으면 옛 길(긴 비ASCII 기록 · 64K 넘는 비ASCII 한 줄).
//    ③ 은 찾기만 덮고(등장 없는 줄은 걷지도 훑지도 않는다 → 긴 줄 위 이름도 닿는다) 등장이 있는 줄의 훑기·걸음은 ④ 가 센다. 가드 범위 안 등장 수 ≤ 256 · DC_WIN_MAX 보다 긴 줄에 등장이 있으면 null. 한 줄은 닻에서 한 번 + 가드에서 많아야 한 번 걷는다(비용은 rows 와 무관).
//  · 묶인 줄 + 앞 줄 + 뒤 DC_WRAP_ROWS 줄 길이 합(UTF-16)이 DC_WIN_MAX 를 넘으면 null(옛 길) · 닻이 DC_WIN_MAX 보다 긴 줄에 닿으면 칸 걸음 전에 null · text 가 DC_BIND_MAX 를 넘으면 처음부터 null.
//  · 끝 칸도 같은 논리 줄이어야 한다(아니면 null) · 시작 칸에서 «시작하는» 글자가 없으면 null.
// [주의] 글 끝의 개행이 만드는 빈 조각은 줄로 세지 않는다(마지막 개행 = 종결 부호).
// [주의] 가드: 같은 열에 같은 낱말이 화면 위치로 가능한 오프셋 안에 또 있으면 묶지 않고 옛 길(032f193)로 간다.
export function dcBind({ sel, cols, rows, text, clip, total, cut } = {}) {
  const o = orderSel(sel);
  if (!o || !posInt(cols) || !posInt(rows) || typeof text !== "string" || o.s.col >= cols || o.e.col >= cols || !posInt(total)) return null;
  if (text.length > DC_BIND_MAX) return null;
  const w = dcWord(clip, sel);
  if (w === null) return null;
  const lines = text.split(/\r\n|\n|\r/);
  const n = lines.length > 1 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
  const rc = new Array(n), st = new Array(n + 1);   // st[j] = 줄 j 의 시작 행(글 기준 · 불확실 줄은 lo 폭 행 수)
  st[0] = 0;
  const bud = { left: DC_WALK_MAX };                 // 느린 걸음 예산(행 수 · 칸 걸음 · 가드 찾기 · 가드 걸음이 같이 쓴다)
  let unc = -1;                                      // 행 수가 불확실한 마지막 줄
  for (let j = 0; j < n; j++) {
    const r = dcRowsOf(lines[j], cols, bud);
    if (r === 0) return null;                        // 예산 초과 또는 묶음 위험 줄(잘린 읽기에서도 하한이 아니다)
    if (r < 0) { if (!cut) return null; unc = j; }   // 안 잘린 읽기(위 붙임)는 «위» 줄 행 수에 기댄다 → 하나라도 불확실이면 null
    st[j + 1] = st[j] + (rc[j] = r < 0 ? -r : r);
  }
  const R = st[n], d = total - R;
  if (d < 0 || (!cut && d > rows)) return null;      // 글이 total 보다 큼 · 안 잘린 읽기는 끝 빈 행 ≤ rows 만
  const find = (row) => {
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (st[mid] <= row) lo = mid; else hi = mid - 1; }
    return lo;
  };
  const rLo = Math.min(Math.max(o.s.row - d, 0), R - 1), rHi = Math.min(o.s.row, R - 1);   // 가능한 오프셋 [0, d] 가 낼 수 있는 첫 글자의 글 기준 행 범위(rLo ≤ rHi)
  const L0 = find(rLo);
  if (unc >= L0) return null;                        // 잘린 읽기: j0 = L0 부터 끝 줄까지 행 수 불확실이 없어야 한다
  const off = !cut ? 0 : d;
  const row = o.s.row - off;
  if (row < 0 || row >= R) return null;
  const hi = find(row);
  if (lines[hi].length > DC_WIN_MAX || dcHazard(lines[hi])) return null;    // 큰 줄은 걸음을 안 돈다(동기 상한) · 묶음 위험 줄은 칸을 믿지 않는다
  const start = st[hi] + off;
  if (o.e.row >= start + rc[hi]) return null;
  if ((bud.left -= lines[hi].length) < 0) return null;   // 묶인 줄 칸 걸음 예산
  const rg = dcCells(lines[hi], cols, o.s.row - start, o.s.col, o.e.row - start, o.e.col);
  if (!rg || rg === DC_UNSURE || lines[hi].slice(rg.a, rg.b) !== w) return null;   // 자체 검사: 그 자리 글자가 선택한 글과 다르면 묶지 않는다
  let win = lines[hi].length;
  if (hi > 0) win += lines[hi - 1].length;
  for (let j = hi + 1; j <= hi + DC_WRAP_ROWS && j < n; j++) win += lines[j].length;
  if (win > DC_WIN_MAX) return null;
  // 모호함 가드: 범위 안 줄의 다른 등장(닻이 묶은 하나만 뺀다)
  let occ = 0;
  for (let L = L0, Le = find(rHi); L <= Le; L++) {
    const line = lines[L], ks = [];
    // 가드 찾기 예산: indexOf 는 QuickJS 에서 순진한 탐색(비교 ≈ 줄 길이 × 낱말 길이)이라 «찾기 전에» 모든 줄(묶인 줄 · 행 수 느린 길 줄 포함)에서 뺀다. 빈 줄 = 0.
    if ((bud.left -= Math.ceil(line.length * w.length / DC_FIND_DIV)) < 0) return null;
    for (let k = line.indexOf(w); k >= 0; k = line.indexOf(w, k + 1)) {
      if (L === hi && k === rg.a) continue;
      if (++occ > 256) return null;
      ks.push(k);
    }
    if (!ks.length) continue;
    if ((bud.left -= line.length) < 0) return null;   // 등장이 있는 줄은 줄 전체를 뺀다 — 위험 줄 검사(정규식이 줄 전체를 훑는다)와 dcPos 걸음을 덮는다(찾기 값은 이 둘을 덮지 않는다) · 검사 «앞»
    if (line.length > DC_WIN_MAX || dcHazard(line)) return null;
    const ps = dcPos(line, cols, ks);
    if (ps === DC_UNSURE) return null;
    for (const [r, c] of ps) {
      if (c !== o.s.col) continue;
      const imp = o.s.row - (st[L] + r);
      if (imp >= 0 && imp <= d) return null;
    }
  }
  return { lines, i: hi, a: rg.a, b: rg.b };
}

// 묶이지 않는 길(옛 규칙)이 보는 글: 깊게 읽은 전체 글에서 끝 keep 줄만 남기고(끝 개행은 종결 부호라 줄로 세지 않는다) 마지막 maxUnits 글자(UTF-16)만. keep 줄 이하 · maxUnits 이하면 글 그대로 — 032f193 이 읽던 것과 같다.
export function dcOldText(text, keep, maxUnits) {
  let t = String(text ?? "");
  if (Number.isInteger(keep) && keep >= 0) {
    let i = t.length > 0 && t.endsWith("\n") ? t.length - 1 : t.length;
    for (let k = 0; k < keep && i >= 0; k++) i = i > 0 ? t.lastIndexOf("\n", i - 1) : -1;
    if (i >= 0) t = t.slice(i + 1);
  }
  return t.length > maxUnits ? t.slice(-maxUnits) : t;
}

// dcPick allowlist(QuickJS: `u` 플래그·\p{} 없음 → \uXXXX 범위). pre = `*` · 여는 괄호/따옴표. post = `#L12C3` 꼬리 → 닫는 장식 → (한글·가나로 시작하는 조사 + 꼬리 한 부류).
// 이어짐 시작 = 한글·가나만(U+1100–115E · 3040–30FF · 3131–3163 · 3165–318E · AC00–D7A3 — 한자 시작 불허). 꼬리 = 한글 자모(1161–11FF · D7B0–D7FF 포함)·가나(결합 탁점 3099/309A 포함)·호환 자모·한자·완성형 한글·닫는 장식뿐.
// 보이지 않는 한글 채움 문자(U+115F · 1160 · 3164 · FFA0)는 시작에도 꼬리에도 불허 — `a.md` + 채움 + `사본` 이 공백으로 나뉜 선택처럼 보이지만 열리는 일이 없게. ASCII 글자·숫자·`/`·`=`·결합/제어 부호·공백도 어디서든 불허.
const DC_PRE = /^[*「『«“‘【《〈]*$/;
const DC_POST = /^(?:#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?)?[*?!。、.,;:」』»”’】》〉]*(?:[\u1100-\u115E\u3040-\u30FF\u3131-\u3163\u3165-\u318E\uAC00-\uD7A3][\u1100-\u115E\u1161-\u11FF\uD7B0-\uD7FF\u3040-\u30FF\u3131-\u3163\u3165-\u318E\u4E00-\u9FFF\uAC00-\uD7A3*?!。、.,;:」』»”’】》〉]*)?$/;
// 꼬리 «글자» 부류(장식 · 구두점 없음) = DC_POST 꼬리에서 글자만 · 시작 부류 = 글자 중 한자 · 자모 이음 부호를 뺀 것.
const DC_LETTER = /^[\u1100-\u115E\u1161-\u11FF\uD7B0-\uD7FF\u3040-\u30FF\u3131-\u3163\u3165-\u318E\u4E00-\u9FFF\uAC00-\uD7A3]$/;
const DC_HEAD = /^[\u1100-\u115E\u3040-\u30FF\u3131-\u3163\u3165-\u318E\uAC00-\uD7A3]$/;

// 클립보드 정리: 끝 개행 하나 · 여러 줄 선택이면 안쪽 개행도 뺀다 · 비었거나 1024 자 넘으면 null. (dcPick · dcLonger 가 같이 쓴다)
function dcWord(clip, sel) {
  if (typeof clip !== "string") return null;
  const o = orderSel(sel);
  if (!o) return null;
  let w = clip.replace(/\r?\n$/, "");
  if (o.e.row > o.s.row) w = w.replace(/\r?\n/g, "");
  return !w || w.length > 1024 ? null : w;
}
// 정리된 클립보드 → { own, pre, post }(공백이 있거나 후보가 정확히 하나가 아니면 null). 허용 목록은 부르는 쪽이 건다.
function dcParts(w) {
  if (/\s/.test(w)) return null;
  const own = scanText(w).cands;
  if (own.length !== 1) return null;
  const i = w.indexOf(own[0]);
  return i < 0 ? null : { own: own[0], pre: w.slice(0, i), post: w.slice(i + own[0].length) };
}

// 꼬리 앞 장식(`#L12C3` · 닫는 장식)을 뗀 나머지가 글자로 «바로» 시작할 때만 그 글자줄(글자 배열 · 첫 글자는 DC_HEAD · 나머지 DC_LETTER)을 돌려준다. 아니면 []. (dcPick · dcLonger 공용)
const DC_DECO = /^(?:#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?)?[*?!\u3002\u3001.,;:\u300D\u300F\u00BB\u201D\u2019\u3011\u300B\u3009]*/;
function dcTailRun(post) {
  const rest = post.replace(DC_DECO, "");
  if (!rest || rest !== post) return [];
  const run = [];
  for (const ch of rest) { if (!DC_LETTER.test(ch) || (run.length === 0 && !DC_HEAD.test(ch))) break; run.push(ch); }
  return run;
}
// 줄바꿈 탐침에 붙일 다음 줄 머리 모양(좁게): `.bak` 류 점 확장자 · 한글/가나 글자로 시작해 한글/가나/한자로 이어지는 1–8 글자(`사본`). 그 밖은 탐침을 만들지 않는다.
// [경고] 다음 줄의 임의 글이 exec 인자(프로세스 목록 · 원격 호스트)로 새지 않게 모양을 좁혔다.
// [주의] 짧은 소문자·숫자 토큰(`on` · `l` · 4 자리 코드)은 argv 로 가지 않는다(`I updated config.js` / `on the server` 가 `config.json` 을 오탐하는 것을 막음). 이름이 확장자 «안» 에서 갈린 경우(`data.json` / `l` · `a.md.` / `bak`)는 확인하지 않는다 → 짧은 이름이 열릴 수 있다.
const DC_WRAP_HEAD = /^\.[A-Za-z0-9_-]{1,15}$/;
function dcWrapHeadOk(h) {
  if (DC_WRAP_HEAD.test(h)) return true;
  const c = [...h];
  return c.length >= 1 && c.length <= 8 && DC_HEAD.test(c[0]) && c.slice(1).every(ch => DC_LETTER.test(ch));
}
// 묶인 모드(bd)는 앞 접두/거울 탐침 1 + 줄바꿈 사슬 DC_WRAP_ROWS 개 · 옛 모드는 줄바꿈 DC_MAX_WRAP 개 — 상한은 둘 중 큰 쪽(꼬리 9 + 4 = 13)이라 어느 탐침도 상한에 밀려 빠지지 않는다.
// 묶인 모드 구조상 최대 13(상한과 같음 → 어느 탐침도 밀려 빠지지 않는다): 줄바꿈 사슬이 서면 이름 뒤 글자줄이 8 자 이하라 꼬리 탐침은 걸음 8 + 선택한 꼬리 1 이하 → 9 + 접두/거울 1 + 사슬 3 · 사슬이 없으면 선택한 꼬리 1 + 전체 1 + 걸음 8 + 접두/거울 1 = 11. 시험이 만든 최대는 12.
export const NAME_MAX_UNITS = 255, DC_TAIL_STEPS = 8, DC_MAX_WRAP = 4, DC_WRAP_ROWS = 3, DC_MAX_PROBES = (DC_TAIL_STEPS + 1) + Math.max(DC_MAX_WRAP, 1 + DC_WRAP_ROWS);

// ── 묶인 모드(bd !== null) 공용 ──
// 이름 오른쪽 «이어짐»: 영숫자 · `_` · 결합 부호, 또는 `. - / +` 바로 뒤에 영숫자 · `_`(`data.json`+`l` · `a.md`+`.bak` · `x.js`+`-old`). 닫는 장식(`x.js.` · `x.js:42` · `x.js)` · `**x.js**` · `x.js#L4`)은 이어짐이 아니다.
const DC_CONT = /^(?:[A-Za-z0-9_]|[\u0300-\u036F]|[.\-/+][A-Za-z0-9_])/;
const DC_LEFT_CH = /[A-Za-z0-9._~/-]/, DC_PRE_CH = /^[*\u300C\u300E\u00AB\u201C\u2018\u3010\u300A\u3008]$/;
const DC_PREFIX = /^(?:\/|~\/)?(?:[A-Za-z0-9._-]{1,64}\/){0,8}$/, DC_MIRROR = /^(?:\/|~\/)?(?:[A-Za-z0-9._-]{1,64}\/){1,8}$/;
const DC_PATH_MAX = 128;
// 이름 바로 왼쪽이 `/` 일 때 그 폴더 접두: 줄에서 os 앞 `[A-Za-z0-9._~/-]` 최대 연속(P) — 줄 머리 · 공백 · 상자선 · 허용 앞 장식 바로 뒤에서 시작하는 «한 토큰» 이고 모양 · 128 자가 맞을 때만. 아니면 null.
function dcLeftPrefix(line, os) {
  const B = line.slice(Math.max(0, os - DC_PATH_MAX - 3), os);
  let s = B.length;
  while (s > 0 && DC_LEFT_CH.test(B[s - 1])) s--;
  const P = B.slice(s);
  if (!P.endsWith("/") || P.length > DC_PATH_MAX || !DC_PREFIX.test(P)) return null;
  if (s > 0) { const c = B[s - 1]; if (!WS.test(c) && !isBox(c) && !DC_PRE_CH.test(c)) return null; }
  return P;
}
const onlyWsBox = (s) => { for (let i = 0; i < s.length; i++) if (!WS.test(s[i]) && !isBox(s[i])) return false; return true; };
// bd 에서 이름(own)이 줄 안에서 차지하는 범위와 앞 줄 · 뒤 줄들. 자체 검사를 한 번 더 한다(방어: bd 가 이 선택 · 클립보드 것이 아니면 null).
function dcBound(bd, w, p) {
  const line = bd?.lines?.[bd.i];
  if (typeof line !== "string" || !Number.isInteger(bd.a) || line.slice(bd.a, bd.b) !== w) return null;
  const os = bd.a + p.pre.length;
  return { line, os, oe: os + p.own.length, prev: bd.i > 0 ? bd.lines[bd.i - 1] : null, next: bd.lines.slice(bd.i + 1, bd.i + 1 + DC_WRAP_ROWS) };
}

// dcPick 앞부분(터미널 글을 안 본다): 정리 · 칸 수 · 후보 하나 · 장식/조사 허용 목록 → { w, p } | null. 장식 · 붙은 조사만 허용 — `data.jsonl` 처럼 이름이 라틴 글자·숫자로 더 이어지면 다른 파일.
function dcShape(clip, sel, cols) {
  const w = dcWord(clip, sel);
  if (w === null) return null;
  const span = selSpan(sel, cols);
  if (span === null || cellWidth(w) !== span) return null;
  const p = dcParts(w);
  return !p || !DC_PRE.test(p.pre) || !DC_POST.test(p.post) ? null : { w, p };
}
// 깊게 읽기 전 싼 검사: 클립보드 모양이 dcPick 앞부분을 통과하는지 참/거짓만(글 · 조각은 밖으로 내지 않는다).
export function dcClipShape({ clip, sel, cols } = {}) { return dcShape(clip, sel, cols) !== null; }

// 클립보드 + 선택 + 터미널 글자 → 풀어 볼 후보 글(없으면 null). 클립보드는 고르는 데만 쓴다:
//  1) 정리(dcWord) · 2) cellWidth(clip) === selSpan 이어야 한다(다르면 선택과 클립보드가 다른 것 — 낡은 클립보드)
//  3) 공백이 든 글은 null · scanText(clip) 후보가 정확히 하나(own)여야 한다. clip = 앞 `*` + own + 뒤 장식(`#L12C3` · `#L1-L3` · `*?!。、.,;:」`) · 앞 `*「` · 붙은 한글/가나/CJK 조사(`plan.md를`)뿐일 때만 통과(allowlist) — 그 밖의 앞뒤 글자(`.jsonl` · `.bak` · `.gz`)가 있으면 다른 이름이라 null
//  4) 터미널 글자 전체(상한 없음)의 scanText(text).cands 에 own 이 그대로 있어야 한다 → 터미널 쪽 사본을 돌려준다
//  묶인 모드(bd = dcBind 결과): 4) 대신 «그 줄 + 앞 줄 + 뒤 DC_WRAP_ROWS 줄» 의 후보에 own 이 있어야 하고, 그 자리의 오른쪽(이어지는 이름 글자 → null) · 왼쪽(`myplan.md` 를 `plan.md` 로 끌어 고름 → null · `/` 면 폴더 접두 모양이 맞을 때만)을 본다. 한 줄 선택 꼬리 fail-closed 는 없다(꼬리는 묶인 줄에서 온다).
// [경고] 클립보드는 믿을 수 없는 입력(비밀번호 · 다른 앱의 글)이다. 터미널 글자에 없는 글은 절대 돌려주지 않는다 — 반환값은 늘 터미널 글자에서 나온 후보다.
// [주의] 허용 목록은 `data.csvの备份` · `보고서.pdf사본` 처럼 «더 긴 이름» 인 선택도 통과시킨다(승인된 `config.yamlを更新しました` 와 글자만으로는 구별 불가) → 더 긴 이름이 실제로 있는지는 dcLonger + dcChoose 가 파일 시스템으로 가린다.
export function dcPick({ clip, sel, cols, text, bd = null }) {
  const h = dcShape(clip, sel, cols);
  if (h === null) return null;
  const { w, p } = h;
  if (bd) {
    const g = dcBound(bd, w, p);
    if (!g) return null;
    if (DC_CONT.test(g.line.slice(g.oe, g.oe + 2))) return null;                  // 오른쪽에 이름이 더 이어진다(`data.json` + `l`)
    if (p.pre === "" && g.os > 0) {                                                  // 왼쪽: 앞 이름 글자가 붙어 있으면 낱말의 뒷부분만 고른 것
      const c = g.line[g.os - 1];
      if (/[A-Za-z0-9_.-]/.test(c) || (c === "/" && dcLeftPrefix(g.line, g.os) === null)) return null;
    }
    const win = (g.prev === null ? [] : [g.prev]).concat([g.line], g.next).join("\n");
    return scanText(win, { max: Infinity, maxCode: Infinity }).cands.includes(p.own) ? g.line.slice(g.os, g.oe) : null;   // 터미널 줄의 조각(= p.own)
  }
  const own = scanText(text, { max: Infinity, maxCode: Infinity }).cands.find(c => c === p.own) ?? null;
  if (own === null) return null;
  // [주의] 한 줄 선택에서 꼬리(글자줄)가 터미널 글자에 없으면 더 긴 이름을 확인할 수 없다(읽은 줄 밖 · 클립보드 NFC / 터미널 NFD 차이) → 짧은 파일도 열지 않는다(fail-closed). 여러 줄(줄바뀜) 선택은 그대로.
  const o = orderSel(sel), run = dcTailRun(p.post);
  if (o.s.row === o.e.row && run.length && !text.includes(own + run.join(""))) return null;
  return own;
}

// «더 긴 이름» 탐침(순수) — cand 에 글자가 더 붙은 이름이 진짜 있으면 열지 않기 위해(dcChoose) RESOLVE_SCRIPT 에 같이 보낼 글들. 최대 DC_MAX_PROBES(13) 개.
//  옛 모드(bd 없음 · 묶이지 않음):
//  · 꼬리 탐침: 클립보드 post 가 글자(한글·가나·한자)로 바로 시작하고 text 에 `cand + 글자줄` 이 그대로 있으면 → cand + 글자줄의 앞 k 글자(k=1..8) + 전체.
//    text 에 없으면 탐침 없음(한 줄 선택이면 dcPick 이 이미 null 로 막는다 · 여러 줄 선택은 줄바꿈 탐침만).
//  · 줄바꿈 탐침: 줄 끝 토큰이 cand(+ 허용 꼬리)로 끝나고 다음 줄 머리가 «좁은 이어짐 모양»(dcWrapHeadOk)이면 → cand + 그 꼬리 + 다음 줄 머리 토큰(`a.md` / `.bak` → `a.md.bak`). 최신 줄부터 4 개까지.
//  묶인 모드(bd = dcBind 결과 · 선택한 그 자리만 본다 · 전체 글 훑기 없음):
//  · 선택한 꼬리: 선택이 이름 뒤까지 닿았으면(bd.b > oe) line.slice(os, bd.b) — 선택한 글 그대로의 터미널 조각 — 을 가장 먼저.
//  · 꼬리: 그 줄에서 이름 오른쪽이 장식 없이 글자줄로 바로 시작하면 → 같은 꼬리 탐침(줄에서 자른다 · 클립보드 post 와 무관 · 선택 밖 글자는 많아야 DC_TAIL_STEPS).
//  · 왼쪽 접두: 이름 바로 왼쪽이 `/` 이면 그 폴더 접두 + 이름(`docs/` + `plan.md`). 모양 · 128 자 · 한 토큰 조건은 dcLeftPrefix. 접두 · 거울은 cand 가 «평범한 상대 이름»(`/` · `~/` 로 시작하지 않고 `.` · `..` 조각 없음)일 때만.
//  · 거울: 이름이 줄의 핵심 머리(왼쪽이 공백 · 상자선뿐)이고 앞 줄 끝 토큰이 `/` 로 끝나는 폴더 모양이면 → 그 토큰 + 이름. `/` 로 끝나지 않는 앞 줄 토큰은 절대 붙이지 않는다(앞 줄의 아무 글이 sh -c 인자로 새는 길).
//  · 줄바꿈 사슬: 이름(+ 같은 줄 꼬리 8 자 이하)이 줄의 마지막 토큰이고 줄 끝이 닫는 장식이 아니면 다음 줄 머리(dcWrapHeadOk) → 이름 + 꼬리 + h1. 그 줄의 핵심이 h1 뿐이면 다음 줄로 이어 h1+h2 · … DC_WRAP_ROWS 줄까지.
//  · 모든 탐침: 글롭 글자 · 제어문자 없음 · 마지막 조각 255 단위(UTF-16) 이하 · cand 와 이름이 같지 않음(접두 · 거울 탐침만 같은 이름 — 폴더만 다르다 · dcChoose 가 cand 의 기대 경로 E 하나만 있을 때만 연다).
// [경고] 클립보드는 믿을 수 없는 입력이다 — 모든 탐침은 text 에서 자른 조각 + cand(터미널 쪽 후보)로만 만든다. 클립보드 글 자체는 어떤 탐침에도 들어가지 않는다.
// [주의] 옛 모드의 줄바꿈은 바로 다음 한 줄만 본다 · 이름이 줄 머리에 있고 앞 줄이 `docs/` 로 끝나는 거울 경우는 묶인 모드에서만 본다.
export function dcLonger({ clip, sel, text, cand, bd = null }) {
  if (typeof cand !== "string" || !cand || typeof text !== "string") return [];
  const out = [], seen = new Set([cand]);
  const baseOf = (s) => s.slice(s.lastIndexOf("/") + 1);
  const cb = baseOf(cand);
  const push = (s, sameBase = false) => {
    // 방어: 호출 구조상 상한(13)에 닿아도 밀리는 탐침은 없다(옛 모드 꼬리 9 + 줄바꿈 4 · 묶인 모드 구조상 최대 13 = 위 DC_MAX_PROBES 주석)
    if (out.length >= DC_MAX_PROBES || seen.has(s) || CTRL.test(s) || GLOB.test(s) || utf8Len(s) > MAX_TOKEN_BYTES) return;
    const b = baseOf(s);
    // 방어: b === cb 는 seen(cand) 과 DC_POST 로 이미 걸러진다 — 접두 · 거울 탐침(sameBase)만 이름이 같다(폴더만 다름)
    if ((b === cb && !sameBase) || b.length > NAME_MAX_UNITS) return;
    seen.add(s); out.push(s);
  };
  if (bd) {
    const w = dcWord(clip, sel), p = w === null ? null : dcParts(w);
    if (!p || p.own !== cand || !DC_PRE.test(p.pre) || !DC_POST.test(p.post)) return out;
    const g = dcBound(bd, w, p);
    if (!g) return out;
    const { line, os, oe, prev, next } = g;
    // 선택한 꼬리 탐침: 선택이 이름 뒤까지 닿았으면(bd.b > oe) 선택한 글 그대로의 터미널 조각을 다른 꼬리 탐침보다 먼저 싣는다(선택한 더 긴 이름 확인 — 꼬리가 8 글자 걸음을 넘어도 빠지지 않게).
    if (bd.b > oe) push(line.slice(os, bd.b));
    // 꼬리 탐침(줄에서 자른다)
    // [경고] 선택 밖 꼬리 글자는 많아야 DC_TAIL_STEPS(8) — 줄 끝까지 긴 글자줄이 sh -c 인자로 새지 않게(줄바꿈 사슬과 같은 정책). 선택 안 글자(bd.b 앞)는 셈에서 뺀다.
    const run0 = dcTailRun(line.slice(oe, oe + NAME_MAX_UNITS + 1));
    let inside = 0;
    for (let k = 0, u = 0; k < run0.length && u < bd.b - oe; k++) { inside++; u += run0[k].length; }
    const run = run0.slice(0, inside + DC_TAIL_STEPS), full = run.join("");
    if (full) {
      push(line.slice(os, oe + full.length));
      let len = cand.length;
      for (let k = 0; k < Math.min(run.length, DC_TAIL_STEPS); k++) { len += run[k].length; push(line.slice(os, os + len)); }
    }
    // 왼쪽 접두 · 거울 — «평범한 상대 이름» cand 에만(`/` · `~/` 로 시작하거나 `.` · `..` 조각이 있으면 탐침 없음 → dcChoose 가 cand 하나만 본다)
    const plain = !cand.startsWith("/") && !cand.startsWith("~/") && !cand.split("/").some(c => c === "." || c === "..");
    if (!plain) { /* 접두 · 거울 탐침 없음 */ }
    else if (p.pre === "" && os > 0 && line[os - 1] === "/") {
      const P = dcLeftPrefix(line, os);
      if (P !== null) push(P + cand, true);
    } else if (prev !== null && onlyWsBox(line.slice(0, os))) {
      const pe = coreEnd(prev);
      if (pe && !isCut(pe[pe.length - 1])) {
        const Pv = lastTok(pe);
        if (Pv.length <= DC_PATH_MAX && DC_MIRROR.test(Pv)) push(Pv + cand, true);
      }
    }
    // 줄바꿈 사슬
    const ce = coreEnd(line);
    if (ce && !isCut(ce[ce.length - 1]) && next.length) {
      const ts = ce.length - lastTok(ce).length;
      if (os >= ts && oe <= ce.length) {
        const post = ce.slice(oe);
        // [경고] 같은 줄 이름 뒤 글은 «없음 · 글자 8 자 이하» 만(일본어 절 · `#L…` 숫자열이 sh -c 인자로 새지 않게)
        if (DC_PRE.test(ce.slice(ts, os)) && DC_POST.test(post) && (post === "" || (dcTailRun(post).join("") === post && [...post].length <= DC_TAIL_STEPS))) {
          let acc = cand + post;
          for (const nl of next) {
            const n = coreStart(nl);
            if (!n || isCut(n[0]) || WS.test(n[0])) break;
            const h = firstTok(n);
            if (!dcWrapHeadOk(h)) break;
            const after = n[h.length];
            if (after !== undefined && !WS.test(after) && !isBox(after)) break;   // 머리 토큰은 한 낱말 전체여야 한다
            acc += h; push(acc);
            if (coreEnd(n) !== h) break;                                           // 그 줄이 머리 토큰뿐일 때만 다음 줄로 이어 본다
          }
        }
      }
    }
    return out;
  }
  // 꼬리 탐침
  const w = dcWord(clip, sel), p = w === null ? null : dcParts(w);
  if (p && p.own === cand && DC_PRE.test(p.pre) && DC_POST.test(p.post)) {
    const run = dcTailRun(p.post), full = run.join(""), at = full ? text.indexOf(cand + full) : -1;
    if (at >= 0) {
      push(text.slice(at, at + cand.length + full.length));
      let len = cand.length;
      for (let k = 0; k < Math.min(run.length, DC_TAIL_STEPS); k++) { len += run[k].length; push(text.slice(at, at + len)); }
    }
  }
  // 줄바꿈 탐침
  const lines = text.split(/\r\n|\n|\r/);
  let nWrap = 0;
  for (let i = lines.length - 2; i >= 0 && nWrap < DC_MAX_WRAP; i--) {
    const ce = coreEnd(lines[i]);
    if (!ce || isCut(ce[ce.length - 1])) continue;   // 줄 끝이 닫는 장식(`)` · `'` · `」` …)이면 이름이 줄 끝에서 끊긴 게 아니다 → 줄바꿈 탐침 없음
    const T = lastTok(ce), k = T.indexOf(cand);
    if (k < 0 || !DC_PRE.test(T.slice(0, k))) continue;
    const post = T.slice(k + cand.length);
    // [경고] 같은 줄 cand 뒤 글(post)은 «없음 · 글자 8 자 이하» 만 탐침에 싣는다 — 일본어 절 · `#L…` 숫자열 · 긴 글자열이 sh -c 인자로 새지 않게.
    if (!DC_POST.test(post)) continue;   // 방어: 아래 글자줄 검사가 더 좁다
    if (post !== "" && !(dcTailRun(post).join("") === post && [...post].length <= DC_TAIL_STEPS)) continue;
    const n = coreStart(lines[i + 1]);
    if (!n || isCut(n[0]) || WS.test(n[0])) continue;
    const h = firstTok(n);
    if (!dcWrapHeadOk(h)) continue;
    // [주의] 머리 토큰은 «한 낱말» 이어야 한다 — 뒤가 줄 끝 · 공백 · 상자선이 아니면(`abc=1 2` · `가나(마` · `.bak=1 2`) 낱말의 앞부분일 뿐이라 탐침 없음.
    const after = n[h.length];
    if (after !== undefined && !WS.test(after) && !isBox(after)) continue;
    const before = out.length;
    push(cand + post + h);
    if (out.length > before) nWrap++;
  }
  return out;
}

// RESOLVE_SCRIPT 출력 + cand + 탐침들 → 열 절대 경로(없으면 null). 레코드 이름(= 준 이름의 마지막 조각)으로 짝을 짓는다.
//  · 탐침(더 긴 이름) 이름의 파일이 하나라도 나오면 null — 더 긴 파일만 있어도 연다 안 한다(미리보기 못 하는 종류일 수 있고 원격이면 내려받는다)
//  · 아니면 cand 이름의 레코드가 정확히 하나일 때만 그 경로
//  · 같은 이름 탐침(S: 접두 · 거울 — 폴더만 다름)이 있으면: `=` 레코드의 cwd 실제 경로로 cand 의 기대 경로 E 를 만들어(상대 = root/cand · 절대 = cand · `~/` = null) 같은 이름 레코드가 정확히 E 하나일 때만 연다.
//    다른 같은 이름 레코드(= 접두 파일)가 있거나 E 가 없으면(접두 파일만 있음 · 링크 폴더로 경로가 다름) null — 더 긴 이름을 확인하지 못했거나 있으면 열지 않는다. `=` 가 없거나 제어문자가 들면 null.
export function dcChoose(stdout, cand, longer = []) {
  if (typeof cand !== "string" || !cand) return null;
  const baseOf = (s) => s.slice(s.lastIndexOf("/") + 1);
  const cb = baseOf(cand), lb = new Set(longer.map(baseOf));
  let E = null;
  if (longer.some(l => baseOf(l) === cb)) {
    const eq = String(stdout ?? "").split("\0").find(r => r.startsWith("="));
    const root = eq === undefined ? "" : eq.slice(1);
    if (!root.startsWith("/") || CTRL.test(root) || cand.startsWith("~/")) return null;
    E = cand.startsWith("/") ? cand : (root === "/" ? "/" : root + "/") + cand;
  }
  const hits = [];
  for (const r of parseResolved(stdout, { max: Infinity })) {
    const b = baseOf(r);
    if (lb.has(b) && b !== cb) return null;
    if (b === cb) hits.push(r);
  }
  if (E !== null) return hits.length === 1 && hits[0] === E ? E : null;
  return hits.length === 1 ? hits[0] : null;
}
