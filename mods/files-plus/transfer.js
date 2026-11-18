// 올리기·내려받기 — 다른 머신과는 `hc exec` 로 바이트를 그대로 옮긴다(html-viewer 가 PNG 를 받는 길과 같다).
// herdr 모듈을 쓰지 않는다: makeTransfer(exec) 에 herdr 의 exec 를 넘긴다. node 시험은 같은 꼴의 대역을 넘긴다.
//
// 실측(2026-11-13 · hc 0.1.19): `hc exec` 는 한 번에 출력 8 MiB · 입력 8 MB 까지다.
//   출력이 넘치면 «[hc] output cut» 만 찍고 rc 0 으로 잘린 채 끝난다. `hc put`(앱의 끌어 놓기 업로드)도 8 MB 까지다.
//   → 4 MiB 조각으로 나눠 보내고, 조각마다 받은 쪽 크기를 기대값과 맞추고, 끝에 sha256 을 맞춘 뒤에만 이름을 바꾼다.
// 이 컴퓨터(Mac)에서 도는 명령은 POSIX 만 쓴다: dd bs/skip/count · wc -c · sha256sum 없으면 shasum -a 256.
// 경로는 늘 sh -c 의 위치 인자로만 넘긴다(따옴표·공백·$ 가 든 이름).

import { safeName } from "./state.js";
import { treePlan, placedDir, batches, isInside } from "./tree.js";

export const CHUNK = 4 * 1024 * 1024;
const TIMEOUT = 600000;   // herdr exec 상한(10분)

// sha256 — 파일을 표준 입력으로 준다(GNU sha256sum 은 \ 가 든 이름이면 줄 앞에 \ 를 붙인다).
const SUM = 'sum() { { sha256sum 2>/dev/null || shasum -a 256 2>/dev/null; } < "$1" | cut -d" " -f1; }';

// 크기와 해시: «바이트수 sha256» 한 줄.
export const META = `${SUM}
[ -f "$1" ] || { echo "파일이 아니다(폴더이거나 없음): $1" >&2; exit 3; }
[ -r "$1" ] || { echo "읽을 수 없다: $1" >&2; exit 3; }
n=$(wc -c < "$1" | tr -d ' ')
h=$(sum "$1")
[ \${#h} -eq 64 ] || { echo "sha256 도구(sha256sum·shasum)가 없다" >&2; exit 5; }
printf '%s %s\\n' "$n" "$h"`;

// 받는 쪽 준비: 폴더가 있고 쓸 수 있으면 빈 조각 파일을 만든다. MKDIR=1 이면 폴더를 만든다(내려받기 폴더).
export const PREP = `d=$1; part=$2
[ "$3" = 1 ] && mkdir -p "$d"
[ -d "$d" ] || { echo "폴더가 없다: $d" >&2; exit 6; }
[ -w "$d" ] || { echo "쓸 수 없는 폴더: $d" >&2; exit 6; }
# noclobber: 이미 있는 파일·심볼릭 링크는 따라가 잘라 쓰지 않고 거절한다(set -C 는 O_EXCL 로 연다)
( set -C; : > "$part" ) 2>/dev/null || { echo "조각 파일이 이미 있다: $part" >&2; exit 10; }`;

// 이 컴퓨터에서 돈다: 원격 파일의 i 번째 조각을 조각 파일 끝에 붙이고, 조각 파일 크기를 찍는다.
// m 이 비면 --on 없이(이 컴퓨터의 hc exec) — 시험이 이 길로 진짜 hc 를 탄다.
export const PULL = `m=$1; f=$2; part=$3; i=$4; bs=$5
x() { if [ -n "$m" ]; then hc exec --on "$m" "$@"; else hc exec "$@"; fi; }
x --timeout 300 -- sh -c 'dd if="$1" bs="$2" skip="$3" count=1 2>/dev/null' sh "$f" "$bs" "$i" >> "$part" || exit $?
wc -c < "$part" | tr -d ' '`;

// 이 컴퓨터에서 돈다: 이 컴퓨터 파일의 i 번째 조각을 원격 조각 파일 끝에 붙이고, 원격 조각 파일 크기를 찍는다.
export const PUSH = `m=$1; src=$2; part=$3; i=$4; bs=$5
x() { if [ -n "$m" ]; then hc exec --on "$m" "$@"; else hc exec "$@"; fi; }
dd if="$src" bs="$bs" skip="$i" count=1 2>/dev/null | x -i --timeout 300 -- sh -c 'cat >> "$1" && wc -c < "$1" | tr -d " "' sh "$part"`;

// 받는 쪽에서 돈다: 해시가 맞으면 덮어쓰지 않는 이름(«이름 (k).확장자»)으로 옮기고 k 를 찍는다(0 = 원래 이름).
// 경로를 찍지 않는다 — 줄바꿈이 든 이름이면 줄로 읽은 경로가 틀린다(codex 검수 11-13). 이름은 JS 가 placed() 로 같은 규칙으로 짓는다.
// 이름 차지 — 「없나 보고 mv」는 동시에 끝난 두 전송이 같은 이름을 보고 뒤가 앞을 덮었다(codex 검수 11-13).
//   먼저 ln(하드링크 · 있으면 실패 · 원자적): 다 받아 해시를 맞춘 조각을 진짜 이름에 건다 — 도중에 죽어도 진짜 이름엔
//   온전한 파일만 보인다(남는 건 숨긴 .part 뿐). set -C 빈 자리표를 진짜 이름에 먼저 두던 판은 mv 전에 죽으면
//   0바이트 파일이 진짜 이름으로 남았다(codex 재검수 11-13).
//   하드링크를 못 거는 곳(FAT·exFAT 등)은 mv -n(있으면 안 옮김)으로 간다 — 빈 자리표를 진짜 이름에 두지 않는다
//   (set -C 자리표 판도 mv 전에 죽으면 0바이트가 남았다 · codex 3차 11-13). 조각이 그대로면 이름이 찼거나(다음 번호)
//   쓸 수 없는 폴더(rc 6 · 999번 돌지 않는다). 조각은 늘 받는 폴더 안이라 mv -n 은 rename 이다.
//   mv -n 은 원자적 차지가 아니다(확인 뒤 rename · codex 4차 11-13) → 이 길만 받는 폴더의 mkdir 잠금
//   `.files-plus.lock`(mkdir 은 어느 FS 에서나 원자적)으로 한 줄로 세운다. 10초 넘게 안 풀리면 rc 9.
//   비었나 본 뒤 그 이름으로 폴더가 생기면 ln·mv 가 그 안에 넣고 성공한다(codex 3차) → -ef·-d 로 진짜 그 이름인지 보고,
//   폴더 안에 들어갔으면 되돌리고 다음 번호.
export const PLACE = `${SUM}
part=$1; d=$2; name=$3; want=$4
# 조각이 사라졌으면(충돌 뒤 정리 · 패널 닫힘이 지움) 해시도 자리 잡기도 하지 않고 «실패» 로 끝낸다 — 성공으로 보고하면 파일이 없다.
gone() { echo "조각 파일이 사라졌다: $part" >&2; exit 11; }
[ -e "$part" ] || gone
h=$(sum "$part")
[ "$h" = "$want" ] || { rm -f "$part"; echo "해시가 다르다(받은 쪽 $h)" >&2; exit 4; }
case $name in ?*.*) base=\${name%.*}; ext=.\${name##*.} ;; *) base=$name; ext= ;; esac
t=$d/$name; k=0; pb=\${part##*/}
while :; do
  [ -e "$part" ] || gone
  if [ ! -e "$t" ] && [ ! -L "$t" ]; then
    if ln "$part" "$t" 2>/dev/null; then
      if [ ! -d "$t" ] && [ "$t" -ef "$part" ]; then rm -f "$part"; break; fi
      # ln 직후 조각이 밖에서 지워지면(-ef 는 조각이 있어야 참) 놓인 $t 는 온전한 파일이다 → 해시가 맞으면 성공(옛 코드는 rc 11 «사라졌다»).
      if [ ! -d "$t" ] && [ ! -e "$part" ] && [ -f "$t" ] && [ ! -L "$t" ] && [ "$(sum "$t")" = "$want" ]; then break; fi
      rm -f "$t/$pb"
    elif [ ! -e "$t" ] && [ ! -L "$t" ]; then
      lk=$d/.files-plus.lock; n=0
      while ! mkdir "$lk" 2>/dev/null; do
        if [ ! -d "$lk" ]; then mkdir "$lk" 2>/dev/null && break; rm -f "$part"; echo "쓸 수 없는 폴더: $d" >&2; exit 6; fi
        n=$((n+1)); [ "$n" -gt 50 ] && { rm -f "$part"; echo "잠금이 10초 넘게 안 풀린다(남은 잠금이면 지운다): $lk" >&2; exit 9; }
        sleep 0.2
      done
      [ -e "$part" ] || { rmdir "$lk" 2>/dev/null; gone; }
      [ -e "$t" ] || [ -L "$t" ] || mv -n "$part" "$t" 2>/dev/null
      rmdir "$lk" 2>/dev/null
      if [ ! -e "$part" ]; then
        if [ -d "$t" ]; then mv "$t/$pb" "$part" || exit 8; else break; fi
      elif [ ! -e "$t" ] && [ ! -L "$t" ]; then rm -f "$part"; echo "쓸 수 없는 폴더: $d" >&2; exit 6; fi
    fi
  fi
  k=$((k+1))
  [ "$k" -gt 999 ] && { rm -f "$part"; echo "같은 이름이 너무 많다: $name" >&2; exit 7; }
  t="$d/$base ($k)$ext"
done
# 끝 확인: 놓인 이름이 정말 있어야 성공이다(조각이 그 사이 사라졌는데 mv 가 조용히 실패한 경우를 거른다).
[ -e "$t" ] || gone
printf '%s\\n' "$k"`;

// PLACE 가 찍은 k 로 놓인 이름 — 셸의 case ?*.* · \${name%.*} 와 같은 규칙.
export function placed(name, k) {
  if (k === 0) return name;
  const i = name.lastIndexOf(".");
  return i > 0 ? `${name.slice(0, i)} (${k})${name.slice(i)}` : `${name} (${k})`;
}

// 미리보기 사본: 해시가 맞으면 정해 둔 자리로 옮긴다(내용 주소라 덮어써도 같은 내용).
export const CACHE_PLACE = `${SUM}
part=$1; out=$2; want=$3
[ -e "$part" ] || { echo "조각 파일이 사라졌다: $part" >&2; exit 11; }
[ "$(sum "$part")" = "$want" ] || { rm -f "$part"; echo "해시가 다르다" >&2; exit 4; }
mkdir -p "\${out%/*}" && mv -f "$part" "$out"`;

// ── 폴더 올리기 ──────────────────────────────────────────────────────
// 이 컴퓨터에서 돈다: 인자마다 순서대로 d(폴더 · 링크면 따라감) / f / x 를 NUL 로 끝맺어 찍는다.
export const KINDS = `for p; do
  if [ -d "$p" ]; then printf 'd\\0'; elif [ -f "$p" ]; then printf 'f\\0'; else printf 'x\\0'; fi
done`;

// 이 컴퓨터에서 돈다: 폴더 $1 안을 «종류 NUL ./상대경로 NUL» 로 찍는다(d 폴더 · f 파일 · l 링크 · o 그 밖). find 는 링크를 따라가지 않는다(-P).
// find 의 종료 코드는 끝 표지 «E NUL rc NUL» 로 넘긴다(읽을 수 없는 하위 폴더가 있어도 나머지 목록은 쓴다) — 표지가 없으면 목록이 잘린 것.
// -exec printf … {} + : 인자가 많으면 형식이 되풀이된다. 이름에 줄바꿈이 있어도 NUL 이라 안전하다. macOS find · GNU find 공통.
export const LIST = `cd -P -- "$1" 2>/dev/null || { echo "폴더를 열 수 없다: $1" >&2; exit 3; }
find . -mindepth 1 \\( -type d -exec printf 'd\\0%s\\0' {} + \\) -o \\( -type f -exec printf 'f\\0%s\\0' {} + \\) -o \\( -type l -exec printf 'l\\0%s\\0' {} + \\) -o -exec printf 'o\\0%s\\0' {} +
rc=$?
printf 'E\\0%s\\0' "$rc"`;

// 받는 쪽에서 돈다: 새 맨 위 폴더를 차지하고 번호 k 를 찍는다(0 = 원래 이름). mkdir(-p 없음)은 원자적이고 링크를 따라가지 않는다 →
// 같은 이름(파일·폴더·링크)이 있으면 «이름 (k)» 로 넘어간다(병합 안 함). 폴더 이름은 확장자를 나누지 않는다.
export const MKTOP = `d=$1; name=$2
[ -d "$d" ] || { echo "폴더가 없다: $d" >&2; exit 6; }
[ -w "$d" ] || { echo "쓸 수 없는 폴더: $d" >&2; exit 6; }
t="$d/$name"; k=0
while :; do
  if mkdir "$t" 2>/dev/null; then printf '%s\\n' "$k"; exit 0; fi
  [ -e "$t" ] || [ -L "$t" ] || { echo "폴더를 만들 수 없다: $t" >&2; exit 6; }
  k=$((k+1))
  [ "$k" -gt 999 ] && { echo "같은 이름이 너무 많다: $name" >&2; exit 7; }
  t="$d/$name ($k)"
done`;

// 받는 쪽에서 돈다: root($1) 아래 하위 폴더들($2…)을 만든다(빈 폴더용).
// [주의] mkdir -p 는 중간 링크를 따라간다 — 방금 MKTOP 이 만든 새 root 안이라 다른 쓰기 주체가 링크를 심어 두지 않는 한 안전하지만(그 사이 TOCTOU 는 막지 못한다), 그런 주체가 있으면 root 밖에 폴더가 생길 수 있다. 설계는 바꾸지 않는다.
export const MKDIRS = `d=$1; shift
for r; do mkdir -p "$d/$r" || exit 6; done`;

// 이 컴퓨터에서 돈다: 두 경로의 실경로(링크 풀기)를 NUL 로 끝맺어 찍는다. 하나라도 못 풀면 rc 3.
const REAL = `a=$(cd -P -- "$1" 2>/dev/null && pwd -P) || exit 3
b=$(cd -P -- "$2" 2>/dev/null && pwd -P) || exit 3
printf '%s\\0%s\\0' "$a" "$b"`;

const last = (s) => s.trim().split("\n").pop() ?? "";

// 전송을 한 줄로 세운다(앱의 끌어 놓기 업로드도 한 파일씩 보낸다). 앞 것이 실패해도 다음 것은 돈다.
export function oneAtATime() {
  let tail = Promise.resolve();
  return fn => { const run = tail.then(fn); tail = run.catch(() => {}); return run; };
}

// 조각 이름: 원래 이름을 넣지 않는다 — 이름 231~255 바이트면 «이름 + 덧붙임» 이 255 를 넘어 «File name too long» 이 났다.
// 숨김(.) · 고정 길이(약 35 바이트): 이름의 FNV-1a 32비트(어느 파일 조각인지 알아보는 용) + 무작위 8자(겹치지 않게).
export function partName(name, rand = Math.random().toString(36).slice(2, 10).padEnd(8, "0")) {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `.${h.toString(16).padStart(8, "0")}.files-plus-${rand}.part`;
}

export class TooBig extends Error {
  constructor(size, limit) { super(`파일이 크다(${size} 바이트 · 미리보기 상한 ${limit})`); this.size = size; this.limit = limit; }
}

// exec: herdr 의 exec(cmd, args, {on, timeout}) 과 같은 꼴.
// viaHc: 이 컴퓨터 파일도 hc exec 길로 옮긴다(시험 전용 — 원격 길을 이 상자에서 재려고).
// quarantine: 참(또는 참을 돌려주는 함수)이면 이 컴퓨터에 놓인 «받은 파일» 에 macOS 격리 속성을 단다(올리기는 아님).
export function makeTransfer(exec, { viaHc = false, quarantine = false } = {}) {
  const sh = (script, args, on) => exec("sh", ["-c", script, "sh", ...args], { on: on ?? null, timeout: TIMEOUT });
  const must = (r, what) => {
    if (r.code !== 0) throw new Error(`${what}: ${(r.stderr || r.stdout || "").trim().slice(0, 300) || `종료 코드 ${r.code}`}`);
    return r.stdout;
  };
  const far = (on) => on != null || viaHc;
  const part = (dir, name) => `${dir}/${partName(name)}`;
  // 원격에서 받은 파일: Gatekeeper 가 처음 열 때 묻도록 com.apple.quarantine 을 단다(macOS 만 · 경로는 위치 인자).
  // 실패해도 전송은 계속한다(던지지 않는다) — 대신 «달지 못했다» 를 돌려준다(false): 열기 길(cached 의 quarantineFailed)이 실패를 보고 열지 않고 Finder 에 보여 주게.
  // 달 필요가 없으면(이 컴퓨터 안 복사 · macOS 아님) true.
  // 값 = «플래그;유닉스 시각(16진);내려받은 앱;» — 브라우저가 다는 꼴과 같다.
  // remote = 원본이 다른 머신일 때만 참 — 이 컴퓨터 안의 복사(on == null)는 «받은 파일» 이 아니다(격리를 달면 멀쩡한 로컬 파일이 «인터넷에서 받은 것» 으로 보인다).
  const quarantined = async (path, remote) => {
    if (!remote || !(typeof quarantine === "function" ? quarantine() : quarantine) || !path.startsWith("/")) return true;
    const when = Math.floor(Date.now() / 1000).toString(16);
    const r = await exec("xattr", ["-w", "com.apple.quarantine", `0081;${when};files-plus;`, path], { timeout: 15000 }).catch(() => null);
    return r?.code === 0;
  };
  // 이름이 경로에 들어가는 곳(조각·사본·놓을 자리) 앞에서 늘 부른다 — 원격이 준 `/../x` 가 폴더 밖으로 나가지 못하게.
  const need = (name) => { if (!safeName(name)) throw new Error(`이름이 안전하지 않다: ${JSON.stringify(String(name).slice(0, 80))}`); return name; };
  // 조각 경로를 job 에 적고 «즉시» 알린다(job.onPart — 주인이 늦춤 없이 스냅샷을 게시한다). 이 뒤로 meta 가 아닌 긴 일(받기 · 올리기)이 돌므로,
  // 알리지 않으면 마지막 늦춤 게시에 조각 경로가 없어 충돌 뒤 정리(orphanParts)가 아무것도 못 찾는다. PREP(조각 만들기) «전» 에 알린다 — 만들기 전 충돌이면 rm -f 가 빈 손으로 끝날 뿐.
  const setPart = (job, p, on) => { if (!job) return; job.part = p; job.partOn = on; try { job.onPart?.(p, on); } catch { /* 알림 실패가 전송을 막지 않게 */ } };
  const drop = (path, on) => sh('rm -f "$1"', [path], on).catch(() => {});
  let stdin = null;

  async function meta(on, path) {
    const out = last(must(await sh(META, [path], on), "크기·해시"));
    const [n, h] = out.split(" ");
    const size = Number(n);
    if (!Number.isInteger(size) || !/^[0-9a-f]{64}$/.test(h ?? "")) throw new Error(`크기·해시를 못 읽었다: ${out.slice(0, 120)}`);
    return { size, sha: h };
  }

  async function place(p, dir, name, sha, on) {
    const k = Number(last(must(await sh(PLACE, [p, dir, name, sha], on), "자리 잡기")));
    if (!Number.isInteger(k) || k < 0) throw new Error("자리 잡기: 놓인 번호를 못 읽었다");
    return `${dir}/${placed(name, k)}`;
  }

  // 원격(on) 파일 src → 이 컴퓨터 조각 파일 p (p 는 PREP 로 비어 있다).
  async function pull(on, src, p, size, job) {
    if (!far(on)) { must(await sh('cat "$1" > "$2"', [src, p], null), "복사"); job?.progress?.(size); return; }
    const n = Math.ceil(size / CHUNK);
    for (let i = 0; i < n; i++) {
      if (job?.cancelled) throw new Error("취소했다");
      const r = await sh(PULL, [on ?? "", src, p, String(i), String(CHUNK)], null);
      const got = Number(last(must(r, `받기 ${i + 1}/${n}`)));
      const want = Math.min((i + 1) * CHUNK, size);
      if (got !== want) throw new Error(`받기 ${i + 1}/${n}: ${got} 바이트(기대 ${want}) ${(r.stderr || "").trim().slice(0, 200)}`);
      job?.progress?.(got);
    }
  }

  return {
    meta,

    // 이 컴퓨터 hc 가 `exec -i` 를 아는지(업로드 전에 한 번).
    async canPush() {
      if (stdin === null) {
        const r = await exec("hc", ["exec", "--help"], { timeout: 15000 }).catch(() => null);
        stdin = Boolean(r && /--stdin/.test(`${r.stdout}${r.stderr}`));
      }
      return stdin;
    },

    // 원격 파일 → 이 컴퓨터 폴더 dir(없으면 만든다) · 덮어쓰지 않는다. 놓인 경로를 돌려준다.
    async download(on, src, dir, name, job) {
      need(name);
      const { size, sha } = await meta(on, src);
      job?.start?.(size);
      const p = part(dir, name);
      setPart(job, p, null);
      must(await sh(PREP, [dir, p, "1"], null), "준비");
      try {
        await pull(on, src, p, size, job);
        // 격리 속성은 놓기 «전에» 조각에 단다: xattr 는 inode 에 붙어 ln · mv 로 이름이 바뀌어도 남는다.
        // 놓은 뒤에 달면 그 사이 패널이 닫혀도 PLACE 는 끝까지 돌아 격리 없는 파일이 Downloads 에 남는다.
        await quarantined(p, far(on));
        if (job?.cancelled) throw new Error("취소했다");
        job?.placing?.();
        return await place(p, dir, name, sha, null);
      } catch (e) { await drop(p, null); throw e; }
    },

    // 원격 파일 → 이 컴퓨터 미리보기 사본 <cacheDir>/<sha>/<name>. 이미 있으면 받지 않는다.
    async cached(on, src, cacheDir, name, limit, job) {
      need(name);
      const { size, sha } = await meta(on, src);
      if (size > limit) throw new TooBig(size, limit);
      const out = `${cacheDir}/${sha}/${name}`;
      if ((await sh('[ -f "$1" ]', [out], null)).code === 0) return { path: out, size, sha, quarantineFailed: !(await quarantined(out, far(on))) };
      job?.start?.(size);
      const p = part(cacheDir, sha);
      setPart(job, p, null);
      must(await sh(PREP, [cacheDir, p, "1"], null), "준비");
      try {
        await pull(on, src, p, size, job);
        const qok = await quarantined(p, far(on));           // 놓기 전에(위와 같은 이유) — CACHE_PLACE 의 mv -f 는 inode 를 그대로 옮긴다
        if (job?.cancelled) throw new Error("취소했다");
        job?.placing?.();
        must(await sh(CACHE_PLACE, [p, out, sha], null), "사본 자리");
        return { path: out, size, sha, quarantineFailed: !qok };
      } catch (e) { await drop(p, null); throw e; }
    },

    // 이 컴퓨터 경로들의 종류: 인자 순서대로 "d" | "f" | "x" 배열.
    async kinds(paths) {
      // 인자 한도(E2BIG)를 넘지 않게 묶음으로 나눠 부르고 순서대로 잇는다.
      const out = [];
      for (const b of batches(paths, 1000)) {
        const part = must(await sh(KINDS, b, null), "종류").split("\0").slice(0, -1);
        if (part.length !== b.length) throw new Error("종류: 개수가 맞지 않다");
        out.push(...part);
      }
      return out;
    },

    // 이 컴퓨터 폴더 src 를 걸어 올릴 계획을 만든다(tree.js treePlan). 읽지 못한 곳 수(stderr 줄 수)는 unreadable.
    // [주의] 로컬 find 한 번 — 파일이 아주 많으면(수십만) 120 s 시간 초과 · 출력 상한에 걸려 «목록이 잘렸다» 로 실패한다.
    async tree(src, { max = Infinity, maxDirs = Infinity } = {}) {
      const r = await exec("sh", ["-c", LIST, "sh", src], { on: null, timeout: 120000 });
      must(r, "폴더 목록");
      const plan = treePlan(r.stdout, { max, maxDirs });
      plan.unreadable = (r.stderr || "").split("\n").filter((l) => l.trim()).length;
      return plan;
    },

    // 받는 쪽(on)에 새 맨 위 폴더를 만들고 놓인 경로를 돌려준다(이름 충돌이면 «이름 (k)»).
    async makeTop(on, dir, name) {
      need(name);
      const k = Number(last(must(await sh(MKTOP, [dir, name], on), "폴더 만들기")));
      if (!Number.isInteger(k) || k < 0) throw new Error("폴더 만들기: 놓인 번호를 못 읽었다");
      return `${dir}/${placedDir(name, k)}`;
    },

    // root 아래 하위 폴더들을 만든다(인자 묶음으로 나눠).
    // job.cancelled 면 묶음 사이에서 멈춘다(던진다).
    async makeDirs(on, root, dirs, job) {
      for (const b of batches(dirs)) {
        if (job?.cancelled) throw new Error("취소했다");
        must(await sh(MKDIRS, [root, ...b], on), "하위 폴더");
      }
    },

    // 이 컴퓨터 안 복사에서 받는 폴더 dst 가 올리는 폴더 src 자신이거나 그 안인가(실경로 비교). 풀 수 없으면 거짓(뒤 단계가 제대로 실패한다).
    async inside(dst, src) {
      const r = await sh(REAL, [dst, src], null);
      if (r.code === 3) return false;
      const [a, b] = must(r, "실경로").split("\0");
      return isInside(a, b);
    },

    // 이 컴퓨터 파일 local → 원격(on) 폴더 dir · 덮어쓰지 않는다. 놓인 경로를 돌려준다.
    // mkdir=true 면 받는 폴더가 없을 때 만든다(폴더 올리기 안의 하위 폴더) — 맨 위 보통 파일 올리기는 false(없으면 rc 6).
    // [주의] 이 mkdir 옵션(PREP "1")은 mkdir -p 라 중간 링크를 따라간다 — MKTOP 이 만든 새 root 안에 다른 쓰기 주체가 링크를 심으면 root 밖에 만들어질 수 있다(TOCTOU · 한계로 둔다).
    async upload(on, local, dir, job, { mkdir = false } = {}) {
      const name = need(local.replace(/\/+$/, "").split("/").pop());
      const { size, sha } = await meta(null, local);
      job?.start?.(size);
      const p = part(dir, name);
      setPart(job, p, on ?? null);
      must(await sh(PREP, [dir, p, mkdir ? "1" : "0"], on), "준비");
      try {
        if (!far(on)) { must(await sh('cat "$1" > "$2"', [local, p], null), "복사"); job?.progress?.(size); }
        else {
          const n = Math.ceil(size / CHUNK);
          for (let i = 0; i < n; i++) {
            if (job?.cancelled) throw new Error("취소했다");
            const r = await sh(PUSH, [on ?? "", local, p, String(i), String(CHUNK)], null);
            const got = Number(last(must(r, `올리기 ${i + 1}/${n}`)));
            const want = Math.min((i + 1) * CHUNK, size);
            if (got !== want) throw new Error(`올리기 ${i + 1}/${n}: ${got} 바이트(기대 ${want}) ${(r.stderr || "").trim().slice(0, 200)}`);
            job?.progress?.(got);
          }
        }
        if (job?.cancelled) throw new Error("취소했다");
        job?.placing?.();
        return await place(p, dir, name, sha, on);
      } catch (e) { await drop(p, on); throw e; }
    },
  };
}
