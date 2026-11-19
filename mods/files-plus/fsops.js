// files-plus 파일 다루기 — 새 폴더 · 이름 바꾸기 · 지우기의 순수 부분(herdr 모듈을 쓰지 않는다 · node 와 QuickJS 둘 다 돈다).
// 스크립트는 `sh -c SCRIPT files-plus <인자…>` 로 돈다: 경로·이름은 늘 위치 인자 — 스크립트 글자에 값을 끼워 넣지 않는다.
// 종료 코드: 0 성공 · 2 잘못된 인자 · 3 대상 없음 · 6 폴더/쓰기/실행 오류 · 7 이름 충돌 · 8 보호(홈) · 9 결과 확인 실패 · 10 확인한 뒤 대상이 바뀜 · 11 일부만 지워짐 · 12 안에 다른 볼륨(마운트)이 붙어 있어 지우지 않음. 오류는 stderr 한 줄(한국어).
// 설계: docs/popups-design.md §8.
import { safeName } from "./state.js";

export const MOD = "files-plus";              // main.js 의 NAME 과 같아야 한다
export const TOOLS = ["trash", "gio", "trash-put", "none"];

// ── 스크립트 ─────────────────────────────────────────────────────────
// 대상의 «종류:dev:ino» — 지우기 확인(PROBE)과 실행(REMOVE)을 묶는 id. 종류 d 폴더 / l 링크 / f 그 밖. 링크를 따라가지 않는다(stat 기본 · ls -d).
// GNU 꼴(stat -c)을 먼저 — 순서가 반대면 GNU 의 stat -f 가 «파일시스템 정보»로 성공해 버린다. 둘 다 안 되면 «-:ino»(ls -di). 그것도 안 되면 실패(return 1).
const FID = `fid() {
  if [ -L "$1" ]; then fk=l; elif [ -d "$1" ]; then fk=d; else fk=f; fi
  fx=$(stat -c '%d:%i' -- "$1" 2>/dev/null)
  case $fx in ''|*[!0-9:]*|:*|*:|*:*:*) fx=$(stat -f '%d:%i' -- "$1" 2>/dev/null);; esac
  case $fx in ''|*[!0-9:]*|:*|*:|*:*:*) fx=;; esac
  if [ -z "$fx" ]; then
    fx=$(ls -di -- "$1" 2>/dev/null | { read -r fn _; printf '%s' "$fn"; })
    case $fx in ''|*[!0-9]*) return 1;; esac
    fx=-:$fx
  fi
  printf '%s:%s' "$fk" "$fx"
}`;

// $1 = 부모 폴더(절대) · $2 = 새 이름. `mkdir -p` 금지(없는 부모를 만들거나 링크를 따라가지 않는다).
export const MKDIR = `[ $# -eq 2 ] || { echo "인자가 틀렸다" >&2; exit 2; }
d=$1; n=$2
case $d in /*) ;; *) echo "절대 경로가 아니다" >&2; exit 2;; esac
case $n in ''|.|..|*/*) echo "쓸 수 없는 이름이다" >&2; exit 2;; esac
[ -d "$d" ] || { echo "폴더가 없다" >&2; exit 6; }
{ [ -w "$d" ] && [ -x "$d" ]; } || { echo "쓸 수 없는 폴더다" >&2; exit 6; }
t=$d/$n
if [ -e "$t" ] || [ -L "$t" ]; then echo "같은 이름이 이미 있다" >&2; exit 7; fi
# [주의] 위 확인과 mkdir 사이 TOCTOU — mkdir 자체가 있는 이름에 실패하므로 아래에서 이름이 있는지 다시 본다
if mkdir -- "$t" 2>/dev/null; then exit 0; fi
if [ -e "$t" ] || [ -L "$t" ]; then echo "같은 이름이 이미 있다" >&2; exit 7; fi
echo "폴더를 만들지 못했다" >&2; exit 6`;

// $1 = 부모(절대) · $2 = 지금 이름 · $3 = 새 이름(같은 폴더 안에서만).
// 같은 inode 위로의 이름 바꿈(대소문자·정규화만 다른 이름 · 하드링크)은 숨긴 임시 이름을 거치는 두 단계로 한다.
// [주의] 확인과 mv 사이 TOCTOU — 끝의 사후 확인(inode + 목록의 정확한 이름)으로 잡는다. mv -n 은 있는 이름을 덮어쓰지 않는다.
export const RENAME = `[ $# -eq 3 ] || { echo "인자가 틀렸다" >&2; exit 2; }
d=$1; a=$2; b=$3
case $d in /*) ;; *) echo "절대 경로가 아니다" >&2; exit 2;; esac
for x in "$a" "$b"; do case $x in ''|.|..|*/*) echo "쓸 수 없는 이름이다" >&2; exit 2;; esac; done
[ "$a" = "$b" ] && exit 0
s=$d/$a; t=$d/$b
[ -d "$d" ] || { echo "폴더가 없다" >&2; exit 6; }
{ [ -e "$s" ] || [ -L "$s" ]; } || { echo "바꿀 대상이 없다" >&2; exit 3; }
{ [ -w "$d" ] && [ -x "$d" ]; } || { echo "쓸 수 없는 폴더다" >&2; exit 6; }
ino() { ls -di -- "$1" 2>/dev/null | { read -r i _; printf '%s' "$i"; }; }
has() { for x in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$x" ] || [ -L "$x" ] || continue; [ "\${x##*/}" = "$2" ] && return 0; done; return 1; }
gnu=; mv --version >/dev/null 2>&1 && gnu=1
i0=$(ino "$s")
[ -n "$i0" ] || { echo "대상 정보를 읽지 못했다" >&2; exit 6; }
if [ -e "$t" ] || [ -L "$t" ]; then
  [ "$(ino "$t")" = "$i0" ] || { echo "같은 이름이 이미 있다" >&2; exit 7; }
  tmp=$d/.files-plus-rename-$$
  if [ -e "$tmp" ] || [ -L "$tmp" ]; then echo "임시 이름이 이미 있다" >&2; exit 6; fi
  mv -n -- "$s" "$tmp" 2>/dev/null
  if [ ! -e "$tmp" ] && [ ! -L "$tmp" ]; then echo "이름을 바꾸지 못했다" >&2; exit 6; fi
  if [ -e "$t" ] || [ -L "$t" ]; then
    mv -n -- "$tmp" "$s" 2>/dev/null
    echo "같은 이름이 이미 있다" >&2; exit 7
  fi
  if [ -n "$gnu" ]; then mv -n -T -- "$tmp" "$t" 2>/dev/null; else mv -n -- "$tmp" "$t" 2>/dev/null; fi
  if [ "$(ino "$t")" != "$i0" ]; then
    # 둘째 mv 가 이름을 못 줬다(두 mv 사이에 새 이름이 생김) → 임시 이름 · 또는 새로 생긴 폴더 안으로 들어간 것을 원래 이름으로 되돌린다
    # [주의] 대소문자·정규화만 다른 이름은 새로 생긴 것과 원래 이름이 같은 항목이라 되돌릴 자리가 없을 수 있다 → 임시 이름으로 남았다고 알린다.
    if [ -e "$tmp" ] || [ -L "$tmp" ]; then mv -n -- "$tmp" "$s" 2>/dev/null
    elif [ -d "$t" ] && [ "$(ino "$t/\${tmp##*/}")" = "$i0" ]; then mv -n -- "$t/\${tmp##*/}" "$s" 2>/dev/null; fi
    left=
    if [ -e "$tmp" ] || [ -L "$tmp" ]; then left=\${tmp##*/}; elif [ -d "$t" ] && [ "$(ino "$t/\${tmp##*/}")" = "$i0" ]; then left=$b/\${tmp##*/}; fi
    if { [ -e "$t" ] || [ -L "$t" ]; } && [ "$(ino "$t")" != "$i0" ]; then m="같은 이름이 이미 있다"; c=7; else m="이름을 바꾸지 못했다"; c=6; fi
    [ -n "$left" ] && m="$m · 원래 항목이 임시 이름으로 남았다: $left"
    echo "$m" >&2; exit $c
  fi
  if has "$d" "$b" && ! has "$d" "$a"; then exit 0; fi
  echo "결과를 확인하지 못했다" >&2; exit 9
fi
if [ -n "$gnu" ]; then mv -n -T -- "$s" "$t" 2>/dev/null; else mv -n -- "$s" "$t" 2>/dev/null; fi
if [ ! -e "$s" ] && [ ! -L "$s" ]; then
  if [ "$(ino "$t")" = "$i0" ]; then
    if has "$d" "$b" && ! has "$d" "$a"; then exit 0; fi
    echo "결과를 확인하지 못했다" >&2; exit 9
  fi
  # 그새 같은 이름의 폴더가 생겨 BSD mv 가 그 안으로 넣었다 → 되돌린다
  if [ -d "$t" ] && [ "$(ino "$t/$a")" = "$i0" ]; then
    mv -n -- "$t/$a" "$s" 2>/dev/null
    echo "같은 이름이 이미 있다" >&2; exit 7
  fi
  echo "결과를 확인하지 못했다" >&2; exit 9
fi
if [ -e "$t" ] || [ -L "$t" ]; then echo "같은 이름이 이미 있다" >&2; exit 7; fi
echo "이름을 바꾸지 못했다" >&2; exit 6`;

// $1 = 대상(절대). 한 줄 «<도구> <종류> <수> <id>» — 도구 trash(macOS /usr/bin/trash 만) > gio > trash-put > none · 종류 d 폴더 / l 심볼릭 링크(링크만 지운다) / f 그 밖 ·
// 수 = d 면 안의 항목 수(다른 볼륨 안은 세지 않는다 · 10001 에서 멈춘다) · f 면 바이트(정규 파일만 연다 · 못 읽거나 FIFO·장치면 -1) · l 이면 0 · id = «종류:dev:ino»(REMOVE 가 같은 대상인지 다시 본다). 읽기만 한다.
export const PROBE = `[ $# -eq 1 ] || { echo "인자가 틀렸다" >&2; exit 2; }
t=$1
case $t in /*) ;; *) echo "절대 경로가 아니다" >&2; exit 2;; esac
{ [ -e "$t" ] || [ -L "$t" ]; } || { echo "대상이 없다" >&2; exit 3; }
${FID}
id=$(fid "$t") || { echo "대상 정보를 읽지 못했다" >&2; exit 6; }
if [ "$(uname -s)" = Darwin ] && [ -x /usr/bin/trash ]; then tool=trash
elif command -v gio >/dev/null 2>&1; then tool=gio
elif command -v trash-put >/dev/null 2>&1; then tool=trash-put
else tool=none; fi
kind=\${id%%:*}
case $kind in
  l) n=0 ;;
  d) n=$(find "$t" -xdev -mindepth 1 -print0 2>/dev/null | tr -dc '\\000' | head -c 10001 | wc -c | tr -d ' ') ;;
  *) n=-1; if [ -f "$t" ]; then n=$({ wc -c < "$t"; } 2>/dev/null | tr -d ' '); [ -n "$n" ] || n=-1; fi ;;
esac
printf '%s %s %s %s\\n' "$tool" "$kind" "$n" "$id"`;

// $1 = 도구(TOOLS) · $2 = 대상(절대 · 끝에 / 를 붙이지 않는다 — 링크를 따라가지 않게) · $3 = PROBE 가 본 id(지우기 직전 다시 계산해 다르면 10). 휴지통이 실패하면 영구 삭제로 넘어가지 않는다.
// [경고] none 은 되돌릴 수 없다(rm). 홈 폴더와 그 위 폴더는 어떤 도구로도 지우지 않는다. 폴더는 마운트 지점을 넘지 않는다 — Linux 는 rm 종류와 무관하게 /proc/self/mountinfo 로 «안에 마운트가 있으면 12» 로 먼저 거절하고(uutils rm 은 --one-file-system 을 받고 무시한다) GNU coreutils 면 OS 무관 --one-file-system 을 덧붙인다 · 아니면 Linux 는 플래그 없이, 그 밖 OS 는 -x. 플래그를 모르는 rm 이면 오류로 끝내고 플래그 없는 rm 으로 다시 시도하지 않는다(닫힘).
// FP_MOUNTINFO = 시험 전용(마운트 정보 파일 경로를 바꾼다 · 평소는 비워 둔다).
export const REMOVE = `[ $# -eq 3 ] || { echo "인자가 틀렸다" >&2; exit 2; }
tool=$1; t=$2; want=$3
case $t in /*) ;; *) echo "절대 경로가 아니다" >&2; exit 2;; esac
{ [ -e "$t" ] || [ -L "$t" ]; } || { echo "대상이 없다" >&2; exit 3; }
case $tool in trash|gio|trash-put|none) ;; *) echo "알 수 없는 지우기 도구다" >&2; exit 2;; esac
P=
if [ ! -L "$t" ] && [ -d "$t" ]; then P=$(cd -P -- "$t" 2>/dev/null && pwd -P); fi
if [ -n "$HOME" ]; then
  if [ "$t" -ef "$HOME" ]; then echo "홈 폴더나 그 위 폴더는 지우지 않는다" >&2; exit 8; fi
  if [ -n "$P" ]; then
    H=$(cd -P -- "$HOME" 2>/dev/null && pwd -P)
    if [ -n "$H" ]; then
      [ "$P" = / ] && { echo "홈 폴더나 그 위 폴더는 지우지 않는다" >&2; exit 8; }
      case "$H/" in "$P/"*) echo "홈 폴더나 그 위 폴더는 지우지 않는다" >&2; exit 8;; esac
    fi
  fi
fi
${FID}
now=$(fid "$t") || now=
if [ -z "$now" ] || [ "$now" != "$want" ]; then echo "확인한 뒤 대상이 바뀌었다 · 다시 열어 확인하라" >&2; exit 10; fi
dir=
case $tool in
  trash) err=$(/usr/bin/trash -s "$t" 2>&1); rc=$? ;;
  gio) err=$(gio trash -- "$t" 2>&1); rc=$? ;;
  trash-put) err=$(trash-put -- "$t" 2>&1); rc=$? ;;
  none)
    if [ -L "$t" ] || [ ! -d "$t" ]; then err=$(rm -f -- "$t" 2>&1); rc=$?
    else
      dir=1
      if [ "$(uname -s)" = Linux ]; then
        mi=\${FP_MOUNTINFO:-/proc/self/mountinfo}
        [ -n "$P" ] || { echo "대상 폴더의 실제 위치를 읽지 못해 지우지 않는다" >&2; exit 6; }
        [ -r "$mi" ] || { echo "마운트 정보를 읽지 못해 지우지 않는다" >&2; exit 6; }
        # 5번째 칸 = 마운트 지점(커널 이스케이프 \\040 공백 · \\011 탭 · \\012 줄바꿈 · \\134 역슬래시 — 세 자리 8진). P 는 ENVIRON 으로(-v 는 역슬래시를 해석한다). LC_ALL=C 로 바이트 단위 비교(gawk 의 UTF-8 재인코딩 방지). 줄이 하나도 없으면(NR=0) 못 읽은 것으로 본다. POSIX awk 만.
        hit=$(FP_P=$P LC_ALL=C awk 'BEGIN { p = ENVIRON["FP_P"] }
          { m = $5; o = ""
            while ((i = index(m, "\\\\")) > 0) {
              d = substr(m, i + 1, 3)
              if (d ~ /^[0-7][0-7][0-7]$/) { o = o substr(m, 1, i - 1) sprintf("%c", substr(d, 1, 1) * 64 + substr(d, 2, 1) * 8 + substr(d, 3, 1)); m = substr(m, i + 4) }
              else { o = o substr(m, 1, i); m = substr(m, i + 1) }
            }
            o = o m
            if (o == p || index(o, p "/") == 1) { print "1"; exit }
          }
          END { if (NR == 0) exit 2 }' "$mi") || { echo "마운트 정보를 읽지 못해 지우지 않는다" >&2; exit 6; }
        [ -z "$hit" ] || { echo "안에 다른 볼륨(마운트)이 붙어 있어 지우지 않는다" >&2; exit 12; }
      fi
      # GNU coreutils 면 OS 무관 --one-file-system(Darwin + brew coreutils 는 -x 를 모른다) · 아니면 Linux(uutils · busybox)는 플래그 없이, 그 밖 OS 는 -x.
      v=$(rm --version 2>/dev/null) || v=
      case $v in *"GNU coreutils"*) fl=--one-file-system;; *) if [ "$(uname -s)" = Linux ]; then fl=; else fl=-x; fi;; esac
      if [ -n "$fl" ]; then err=$(rm -r -f $fl -- "$t" 2>&1); rc=$?; else err=$(rm -r -f -- "$t" 2>&1); rc=$?; fi
    fi ;;
esac
if [ "$rc" -ne 0 ]; then
  last=$(printf '%s\\n' "$err" | tail -n 1)
  if [ -n "$dir" ] && { [ -e "$t" ] || [ -L "$t" ]; }; then echo "다 지우지 못했다 · 일부는 이미 지워졌을 수 있다(되돌릴 수 없다): \${last:-오류 줄 없음}" >&2; exit 11; fi
  echo "\${last:-지우지 못했다}" >&2; exit 6
fi
if [ -e "$t" ] || [ -L "$t" ]; then echo "다 지우지 못했다" >&2; exit 9; fi
exit 0`;

// ── 이름 · 경로 검사 ─────────────────────────────────────────────────
// UTF-8 바이트 수 — 호스트(QuickJS)에는 문자열 인코더 전역이 없다 → 코드포인트를 센다.
export function utf8Len(s) {
  let n = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

const CTRL = /[\u0000-\u001f\u007f]/;

// 새 이름 문제 → null(괜찮다) | 한국어 사유. state.js 의 safeName 도 통과하는 이름만 null.
export function nameProblem(name) {
  if (typeof name !== "string" || name.trim() === "") return "이름이 비었다";
  if (name === "." || name === "..") return "쓸 수 없는 이름이다";
  if (name.includes("/")) return "이름에 / 를 쓸 수 없다";
  if (CTRL.test(name)) return "이름에 줄바꿈·제어 문자를 쓸 수 없다";
  if (utf8Len(name) > 255) return "이름이 너무 길다(255바이트까지)";
  return null;
}

// 트리 상대 경로: ""(맨 위)는 allowEmpty 일 때만 · 조각마다 safeName · 제어 문자 없음 · 4096 미만.
export function relOk(rel, { allowEmpty = false } = {}) {
  if (typeof rel !== "string") return false;
  if (rel === "") return allowEmpty === true;
  return rel.length < 4096 && !CTRL.test(rel) && rel.split("/").every(safeName);
}

export const parentRel = rel => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
export const joinAbs = (root, rel) => (!rel ? root : root.endsWith("/") ? root + rel : `${root}/${rel}`);
const joinRel = (dir, name) => (dir ? `${dir}/${name}` : name);
// 사람이 읽는 자리: 이 컴퓨터면 «이 컴퓨터 · /경로» · 원격이면 «머신:/경로».
export const placeLabel = (on, abs) => (on ? `${on}:${abs}` : `이 컴퓨터 · ${abs}`);

// ── 티켓(패널 메모리 · 1회용) ────────────────────────────────────────
// 팝업은 경로를 보내지 않는다 — 메뉴를 연 순간 패널이 {root, on, rel…} 를 티켓에 적어 두고 팝업은 토큰만 들고 있다. shared 로 오는 요청이 위조돼도 경로를 못 정한다.
// [주의] 토큰은 Math.random 기반 — 암호학적 비밀이 아니라 «낡은·엉뚱한 요청 거르기» 용이다.
export const TICKET_TTL = 10 * 60 * 1000;
export const TICKET_MAX = 20;
export function newToken() {
  const r = () => Math.random().toString(36).slice(2).padEnd(11, "0");
  return r() + r();
}
// data 를 티켓으로 둔다(오래된 것 · 상한 넘는 것은 버린다). 토큰을 돌려준다.
export function putTicket(map, data, now) {
  for (const [k, v] of [...map]) if (!(now - v.at <= TICKET_TTL)) map.delete(k);
  while (map.size >= TICKET_MAX) map.delete(map.keys().next().value);
  let token = newToken();
  while (map.has(token)) token = newToken();
  map.set(token, { ...data, at: now });
  return token;
}
// 쓰면 지운다(낡은 것도 지운다). 없거나 10분 넘었으면 null.
export function takeTicket(map, token, now) {
  if (typeof token !== "string" || token === "") return null;
  const t = map.get(token);
  if (!t) return null;
  map.delete(token);
  return now - t.at <= TICKET_TTL && now >= t.at ? t : null;
}

// ── 요청 계획 ────────────────────────────────────────────────────────
const TIMEOUT = { mkdir: 15000, rename: 15000, trash: 60000, none: 600000 };

// 티켓 + 요청 인자 → { ok: true, op, on, script, args, timeout, … } | { ok: false, why }.
// 티켓 값도 다시 검사한다. 실행은 늘 티켓의 root/on/rel 로 — this.root · 현재 위치로 다시 풀지 않는다.
export function opPlan(op, ticket, a) {
  const no = why => ({ ok: false, why });
  const t = ticket, q = a && typeof a === "object" ? a : {};
  if (!t || typeof t !== "object") return no("티켓이 없다");
  if (typeof t.root !== "string" || !t.root.startsWith("/") || t.root.includes("\0")) return no("폴더 경로가 이상하다");
  if (t.on != null && (typeof t.on !== "string" || t.on === "")) return no("머신 이름이 이상하다");
  const on = t.on ?? null, root = t.root;
  if (op === "mkdir") {
    if (!relOk(t.rel, { allowEmpty: true })) return no("경로가 이상하다");
    const dir = t.dir === true ? t.rel : parentRel(t.rel);
    const problem = checkName(q.name);
    if (problem) return no(problem);
    const dirAbs = joinAbs(root, dir);
    return { ok: true, op, on, root, parentRel: dir, name: q.name, newRel: joinRel(dir, q.name), dirAbs, script: MKDIR, args: [dirAbs, q.name], timeout: TIMEOUT.mkdir };
  }
  if (op === "rename" || op === "delete") {
    if (!relOk(t.rel)) return no("경로가 이상하다");
    const parent = parentRel(t.rel), from = t.rel.slice(parent ? parent.length + 1 : 0), dirAbs = joinAbs(root, parent);
    if (op === "rename") {
      const problem = checkName(q.to);
      if (problem) return no(problem);
      if (q.to === from) return no("이름이 그대로다");
      return { ok: true, op, on, root, rel: t.rel, parentRel: parent, from, to: q.to, newRel: joinRel(parent, q.to), isDir: t.dir === true, dirAbs, script: RENAME, args: [dirAbs, from, q.to], timeout: TIMEOUT.rename };
    }
    if (typeof q.tool !== "string" || !TOOLS.includes(q.tool)) return no("지우기 도구가 이상하다");
    if (!idOk(q.id)) return no("확인 정보가 이상하다");
    const abs = joinAbs(root, t.rel);
    return { ok: true, op, on, root, rel: t.rel, parentRel: parent, name: from, isDir: t.dir === true, abs, tool: q.tool, id: q.id, script: REMOVE, args: [q.tool, abs, q.id], timeout: q.tool === "none" ? TIMEOUT.none : TIMEOUT.trash };
  }
  return no("모르는 요청이다");
}

// PROBE 가 돌려준 id «종류:dev:ino» (dev 를 못 읽으면 «-»).
export const idOk = id => typeof id === "string" && /^[dfl]:(-|\d+):\d+$/.test(id);

// 대화창이 앞뒤 공백을 뺀 값을 보낸다 — 패널은 trim 하지 않고 공백으로 시작/끝나면 거절한다.
function checkName(name) {
  const p = nameProblem(name);
  if (p) return p;
  if (name !== name.trim()) return "이름 앞뒤에 공백을 둘 수 없다";
  return null;
}

// ── 트리 상태 갱신(새 Set/Map 을 돌려준다 · 인자는 바꾸지 않는다) ──────
const under = (key, rel) => key === rel || key.startsWith(rel + "/");

export function renameTree(folders, entries, oldRel, newRel) {
  const map = k => (under(k, oldRel) ? newRel + k.slice(oldRel.length) : k);
  return { folders: new Set([...folders].map(map)), entries: new Map([...entries].map(([k, v]) => [map(k), v])) };
}
export function dropTree(folders, entries, rel) {
  return { folders: new Set([...folders].filter(k => !under(k, rel))), entries: new Map([...entries].filter(([k]) => !under(k, rel))) };
}
// 폴더 먼저 · 이름순 — main.js loadFolder 와 같은 순서.
export const sortEntries = list => [...list].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
export const withEntry = (list, entry) => sortEntries([...list.filter(e => e.name !== entry.name), entry]);
export const withoutEntry = (list, name) => list.filter(e => e.name !== name);
export const renamedEntry = (list, from, to) => sortEntries(list.filter(e => e.name !== to).map(e => (e.name === from ? { ...e, name: to } : e)));

// base 가 taken(Set 또는 배열)에 없으면 base · 아니면 «base 2» · «base 3» … (999 까지 · 넘으면 base).
export function freeName(base, taken) {
  const has = n => (taken instanceof Set ? taken.has(n) : Array.isArray(taken) && taken.includes(n));
  if (!has(base)) return base;
  for (let i = 2; i <= 999; i++) if (!has(`${base} ${i}`)) return `${base} ${i}`;
  return base;
}

// 이름 바꾸기 창의 처음 선택 범위(UTF-16): 폴더 · 점으로 시작 · 확장자 없음 = 전체 · 아니면 마지막 «.» 앞까지.
export function stemRange(name, isDir) {
  const dot = name.lastIndexOf(".");
  return { start: 0, end: isDir || dot <= 0 ? name.length : dot };
}

// ── 메뉴 · 창 ────────────────────────────────────────────────────────
// ctx.empty(빈 곳) = «새 폴더» 하나 · 줄이면 셋.
export function menuItems(ctx) {
  const blank = ctx?.empty ?? !ctx?.rel;
  const all = [{ op: "mkdir", label: "새 폴더" }, { op: "rename", label: "이름 바꾸기" }, { op: "delete", label: "지우기…" }];
  return blank ? all.slice(0, 1) : all;
}

// 메뉴 ctx → 이름/확인 창 props. 보여 주기용 값만(경로 해석은 패널의 티켓이 한다).
export function askProps(ctx, op) {
  const abs = op === "mkdir" ? ctx.dirAbs : ctx.abs;
  return {
    op, token: ctx.token, owner: ctx.owner, on: ctx.on ?? null, abs, where: placeLabel(ctx.on ?? null, abs),
    name: ctx.name ?? "", dir: ctx.dir === true,
    taken: op === "rename" ? ctx.siblings ?? [] : op === "mkdir" ? ctx.taken ?? [] : [],
  };
}

export function askSpec(props) {
  return { mod: MOD, kind: "dialog", modal: true, width: 440, height: props.op === "delete" ? 250 : 220, props: { mode: "ask", ...props } };
}
export function menuSpec(props, n) {
  return { mod: MOD, kind: "popup", width: 200, height: 10 + 31 * n, props: { mode: "menu", ...props } };
}

// PROBE 출력 → { tool, kind, n, id } | null. id 의 종류 글자가 kind 와 다르면 null.
export function parseProbe(stdout) {
  const m = /^(trash|gio|trash-put|none) ([dfl]) (-?\d+) ([dfl]:(?:-|\d+):\d+)$/.exec(typeof stdout === "string" ? stdout.trim() : "");
  return m && TOOLS.includes(m[1]) && m[4][0] === m[2] ? { tool: m[1], kind: m[2], n: Number(m[3]), id: m[4] } : null;
}

// ── 대화창 제출 판단(순수) ───────────────────────────────────────────
// 창이 열린 뒤(지우기는 PROBE 결과가 온 뒤) 이 시간 안의 Enter 는 무시 — 누르고 있던 Enter 가 확인 없이 실행되는 것을 막는다. 단추 클릭은 그대로.
export const ENTER_GUARD_MS = 350;

// 이름 창의 입력 문제 → null(괜찮다) | 한국어 사유. 이름 바꾸기에서 손대지 않은 값(앞뒤 공백 포함)이나 trim 값이 지금 이름이면 문제 없음(제출은 «닫기»).
export function askProblem({ op, text, name, taken }) {
  const t = typeof text === "string" ? text : "";
  if (op === "rename" && (t === name || t.trim() === name)) return null;
  const v = t.trim();
  const bad = nameProblem(v);
  if (bad) return bad;
  if ((taken instanceof Set ? taken.has(v) : Array.isArray(taken) && taken.includes(v))) return "같은 이름이 이미 있다";
  return null;
}

// 제출 → { kind: "none" } | { kind: "close" } | { kind: "post", action, args }. args 에는 token 이 없다(창이 붙인다).
//  op · text(입력) · name(지금 이름) · taken · probe(지우기: null | { err } | parseProbe 결과) · enter(Enter 로 왔나) · now · readyAt(이 시각 전의 Enter 는 무시).
export function submitPlan({ op, text, name = "", taken, probe, enter, now, readyAt }) {
  const none = { kind: "none" };
  if (enter && !(typeof readyAt === "number" && typeof now === "number" && now >= readyAt)) return none;
  if (op === "delete") {
    if (!probe || probe.err || !TOOLS.includes(probe.tool) || !idOk(probe.id)) return none;
    if (enter && probe.tool === "none") return none;          // 영구 삭제는 단추만
    return { kind: "post", action: "delete", args: { tool: probe.tool, id: probe.id } };
  }
  if (op !== "mkdir" && op !== "rename") return none;
  if (askProblem({ op, text, name, taken })) return none;
  const t = String(text);
  if (op === "rename" && (t === name || t.trim() === name)) return { kind: "close" };
  const v = t.trim();
  return { kind: "post", action: op, args: op === "mkdir" ? { name: v } : { to: v } };
}

const CODE_TEXT = { 2: "잘못된 요청이다", 3: "대상이 없다", 6: "폴더에 쓸 수 없거나 실행하지 못했다", 7: "같은 이름이 이미 있다", 8: "홈 폴더나 그 위 폴더는 지우지 않는다", 9: "결과를 확인하지 못했다", 10: "확인한 뒤 대상이 바뀌었다 · 다시 열어 확인하라", 11: "다 지우지 못했다 · 일부는 이미 지워졌을 수 있다(되돌릴 수 없다)", 12: "안에 다른 볼륨(마운트)이 붙어 있어 지우지 않는다" };
// exec 결과 {code, stderr} → 사람 말: stderr 의 마지막 비지 않은 줄 · 없으면 코드별 문구.
export function opError(r) {
  const last = String(r?.stderr ?? "").split("\n").map(l => l.trim()).filter(Boolean).pop();
  return (last || CODE_TEXT[r?.code] || `실패했다(종료 코드 ${r?.code ?? "?"})`).slice(0, 200);
}
