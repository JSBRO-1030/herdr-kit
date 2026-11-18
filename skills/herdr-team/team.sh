#!/usr/bin/env bash
# herdr-team — 옆 페인·탭에 도우미 에이전트를 띄워 일을 맡기고, 끝나면 회수해 닫는다.
# herdr-option 세트(공유판) — 사용법·설치: 저장소 README.md · skills/herdr-team/SKILL.md
#
#   team.sh doctor                                    이 상자에 깔린 도우미 CLI 와 hc 확인(띄우기 전에 먼저)
#   team.sh spawn <이름> <종류> [-- 원래 CLI 인자…]   도우미 띄우기 (claude·codex·agy·grok·opencode 중 깔린 것)
#                 띄우기 전에 그 CLI 에 새 판이 있으면 올린다(update-clis.sh · 줄은 stderr · 끄기 HERDR_UPDATE=0)
#   team.sh ask   [--queue] <이름> <지시문 | @지시서파일> [시한초=1800]   일 맡기기 → 결과 파일 경로를 찍는다
#                 (--queue = 도우미가 일하는 중이면 끝날 때까지 기다렸다 보낸다)
#   team.sh watch [시한초=10800]                         띄운 도우미 전체를 지켜보다 첫 사건(blocked·done·gone·error 4분)에서 끝난다
#   team.sh close <이름> | --all | --idle               내가 띄운 도우미 닫기(--idle = 일 끝난 것만 · 교대용)
#   team.sh ls                                         내가 띄운 도우미와 상태
#   team.sh handover <새 터미널 주소>                   내 도우미 목록을 그 터미널로 넘긴다(셸 없는 리드의 교대용)
#
# 종료 코드: 0 끝(ok · marker-only · done) · 2 거절 · 3 모르는 창(spawn) · 4 시한 초과 · 6 blocked · 7 도우미 사라짐 · 8 error(이어 하기 못 함)
# 2026-10-30 herdr-core(hc 0.1.14)로 옮겼다. 리드는 hc 터미널($HC_TERMINAL_ID)이고, 창은 Mac 의 Herdr 앱이 그린다.
#   도우미 = 리드의 자식 hc 터미널(리드 터미널이 끝나면 같이 끝난다 · 리드 셸에서 claude 만 다시 떠도 산다 — 실측).
#   단 셸 없는 리드(claude 가 터미널 처음 프로그램)의 도우미는 --outlive-parent 로 띄운다 — 교대가 후임을 새 터미널에 띄우고
#   `handover` 로 목록을 넘긴다(11-06).
#   화면 자리는 라벨로 정한다(herdr-app src/window.rs adopt): herdr.space+herdr.tab = 리드 탭 오른쪽에 붙는다 ·
#   herdr.space 만 = 같은 스페이스의 새 탭. 옛 herdr(pane split · agent prompt) 길은 지웠다.
# ⛔ 이 파일을 고칠 때는 새 파일에 쓰고 mv 로 한 번에 바꾼다. 돌고 있는 ask 가 고치는 도중의 파일을 읽어
#    문법 오류로 죽었다(turboflow 10-21 18:44). 본문은 main 안에 있어 시작할 때 전부 읽힌다.
set -euo pipefail

HC="${HC_BIN:-$(command -v hc || echo "$HOME/.local/bin/hc")}"
DIR="${HERDR_TEAM_DIR:-$HOME/.cache/herdr-team}"
MAX_HELPERS="${HERDR_TEAM_MAX:-3}"   # 리드 한 명당 동시 도우미 수
KINDS="claude codex agy grok opencode"
# agy 는 화면 모드에서도 작업 폴더 밖 읽기·쓰기와 셸 명령마다 허락을 물어 탭이 멈춘다 → 기본으로 --dangerously-skip-permissions 를 붙인다.
# 끄려면 HERDR_TEAM_AGY_SKIP_PERMS=0 (그러면 agy 탭은 확인창에서 blocked 로 선다).
AGY_SKIP_PERMS="${HERDR_TEAM_AGY_SKIP_PERMS:-1}"
mkdir -p "$DIR/state"

die() { echo "herdr-team: $*" >&2; exit "${2:-1}"; }
need_hc() { [ -n "${HC_TERMINAL_ID:-}" ] || die "herdr-core(hc) 터미널 안이 아니다(HC_TERMINAL_ID 없음)"; }
state() { echo "$DIR/state/hc-${HC_TERMINAL_ID//\//_}.tsv"; }   # 이름 \t 주소 \t 자리(side·tab·hidden) \t 종류
py() { python3 -I -c "$1" "${@:2}"; }

rec() { "$HC" get "$1" --json 2>/dev/null; }
alive() { rec "$1" | py 'import sys,json; sys.exit(0 if json.load(sys.stdin).get("state")=="live" else 1)' 2>/dev/null; }
screen() { "$HC" read "$1" 2>/dev/null || true; }
# 상태 = 프로그램이 보내는 OSC 7501(idle·working·done·blocked·error). opencode 는 보내지 않는다(10-30 · v2.2.5 도 11-04 실측).
# → 그때는 맨 아래 줄로 읽는다: opencode 의 「… · ctrl+p menu」 줄에 「esc interrupt」 가 있으면 working, 없으면 idle.
#   셸 sleep 25 동안 화면이 24초 그대로였는데 그 줄은 내내 「esc interrupt」였다(11-04 화면 26장 · 일 전후 0장).
#   그 줄이 안 보이면(뜨는 중 · 좁은 칸에서 잘림) 예전처럼 unknown.
status() {
  local s foot
  s="$(rec "$1" | py 'import sys,json
d=json.load(sys.stdin)
print(((d.get("status") or {}).get("state") or "unknown") if d.get("state")=="live" else "gone")' 2>/dev/null)" || s=gone
  [ -n "$s" ] || s=gone
  if [ "$s" = unknown ]; then
    foot="$(screen "$1" | { grep -v '^\s*$' || true; } | tail -1)"
    case "$foot" in *"ctrl+p menu"*) case "$foot" in *"esc interrupt"*) s=working ;; *) s=idle ;; esac ;; esac
  fi
  echo "$s"
}
keys() { "$HC" keys "$@" >/dev/null; }
addr_of() { awk -F'\t' -v n="$1" '$1==n{print $2}' "$(state)" 2>/dev/null | tail -1; }
end_term() { "$HC" kill "$1" >/dev/null 2>&1 || true; "$HC" rm "$1" >/dev/null 2>&1 || true; }
# 비밀값은 열 이름이 아니라 값 무늬로 가린다(sk-·nvapi-·eyJ·봇 토큰·://user:pass@ 등) — 화면 끝 줄을 부모에게 보일 때만 쓴다.
mask() { py 'import re,sys
P=r"(sk-[\w-]{8,}|nvapi-[\w-]{8,}|eyJ[\w-]{10,}\.[\w.-]+|gh[pousr]_\w{20,}|xox[abpr]-[\w-]+|\b\d{8,10}:[\w-]{30,}|AKIA[0-9A-Z]{16}|(?<=://)[^/\s:@]+:[^@\s]+(?=@)|(?i:(?:api[_-]?key|secret|token|password|passwd)\s*[=:]\s*)\S+)"
for l in sys.stdin: sys.stdout.write(re.sub(P,"[가림]",l.rstrip("\n")[:200])+"\n")'; }   # 줄 자르기도 여기서(cut -c 는 바이트라 한글이 깨졌다)
# 빈 화면이면 grep -v 가 1 을 내고 pipefail 로 죽어 blocked(6) 대신 rc 1 이 났다(codex 검수 10-30) → || true
tail_masked() { screen "$1" | { grep -v '^\s*$' || true; } | tail -"${2:-14}" | mask; }
# 상태를 안 보내는 도우미(opencode)가 쉬는지 — 화면이 3초 간격 세 번 그대로면 쉰다고 본다(codex 검수 10-30).
quiet() { local p="" s i; for i in 1 2 3; do s="$(screen "$1")"; [ "$i" -gt 1 ] && [ "$s" != "$p" ] && return 1; p="$s"; [ "$i" -lt 3 ] && sleep 3; done; return 0; }

# 확인창 처리. 0=입력 가능 · 3=모르는 창(오너에게 물어라)
settle() {
  local a="$1" kind="$2" s i prev="" same=0
  for i in $(seq 1 30); do
    s="$(screen "$a")"
    # 폴더 신뢰 — 띄운 그 폴더가 정확히 적혀 있고 커서가 Yes 에 있을 때만 (오너 2026-10-21 「니가 눌러」)
    if grep -qi 'trust' <<<"$s" && grep -qF "$PWD" <<<"$s"; then
      # grok 1.0.67 은 커서 없이 단축키 꼴(「Yes, proceed   y」)이다 — 그 줄이 있으면 y(10-23 실측 · y 로 입력 칸이 떴다)
      if grep -qE '^\s*Yes, proceed\s+y\s*$' <<<"$s"; then keys "$a" y; sleep 2; continue; fi
      grep -E '^\s*(>|❯|›)' <<<"$s" | grep -q 'Yes' || { echo "$s" | tail -8; return 3; }
      keys "$a" enter; sleep 2; continue
    fi
    # codex 업데이트 안내 — 띄우기 전에 update-clis.sh 가 이미 올렸다. 그래도 뜨면(올리기 실패 · 건너뛸 자리) 여기서는 Skip.
    if grep -q 'Update now' <<<"$s" && grep -q 'Skip' <<<"$s"; then
      keys "$a" down; sleep 0.5
      screen "$a" | grep -E '^\s*(>|❯|›)' | grep -q 'Skip' || { screen "$a" | tail -8; return 3; }
      keys "$a" enter; sleep 2; continue
    fi
    case "$(status "$a")" in
      idle|done) sleep 2; return 0 ;;
      blocked) [ "$i" -ge 5 ] && { echo "$s" | tail -8; return 3; } ;;
      gone) echo "$s" | tail -8; return 3 ;;
      # 상태를 안 보내는 opencode 만 — 위 확인창이 없고 화면이 세 번 연달아 그대로면 입력 가능으로 본다.
      # 상태를 보내는 도우미의 unknown 은 «아직 뜨는 중»이라 기다린다.
      unknown) [ "$kind" = opencode ] || { sleep 1; continue; }
        if [ "$s" = "$prev" ] && [ -n "${s//[[:space:]]/}" ]; then same=$((same+1)); else same=0; fi
        prev="$s"; [ "$same" -ge 3 ] && return 0 ;;
    esac
    sleep 1
  done
  echo "$s" | tail -8; return 3
}

# 층은 둘이다 — 도우미 터미널은 리드(오너 터미널)만 만든다. 도우미는 자기 CLI 의 하위 에이전트로 나눈다(10-21 실측).
NATIVE="도우미는 hc 터미널·herdr 페인을 만들지 않는다 — 네 CLI 의 하위 에이전트로 나눠라:
  claude = Agent 도구(서브에이전트) · 에이전트 팀 팀원(이 터미널은 켜져 있다)
  codex = spawn_agent / wait_agent    grok = spawn_subagent
  agy = invoke_subagent               opencode = task 도구(explore · general)"

cmd_spawn() {
  need_hc
  [ "${HERDR_TEAM_HELPER:-}" = 1 ] && die "$NATIVE" 5
  local name="$1" kind="$2"; shift 2; [ "${1:-}" = "--" ] && shift
  [[ "$name" =~ ^[a-z][a-z0-9_-]{0,31}$ ]] || die "이름은 [a-z][a-z0-9_-]{0,31}"
  case " $KINDS " in *" $kind "*) ;; *) die "종류는 ${KINDS// /·}" 2 ;; esac
  local bin="$kind"
  command -v "$bin" >/dev/null || die "$kind 가 이 상자에 없다(PATH) — team.sh doctor 로 깔린 것을 보고 그중에서 고른다" 2
  # 새 판이 있으면 올리고 띄운다(같은 종류는 1시간에 한 번만 확인 · 실패해도 띄운다 · 결과 줄은 stderr 로 — stdout 첫 줄은 ready/blocked)
  "$(dirname "$(readlink -f "$0")")/update-clis.sh" "$kind" >&2 || true
  alive "$name" && die "살아 있는 터미널이 이미 이름 $name 을 쓴다 — team.sh close $name 하거나 다른 이름으로" 2
  local st; st="$(state)"; touch "$st"
  local live=0 side=0 a pl
  while IFS=$'\t' read -r _ a pl _; do alive "$a" && { live=$((live+1)); [ "$pl" = side ] && side=$((side+1)); }; done <"$st"
  [ "$live" -ge "$MAX_HELPERS" ] && die "동시 도우미 ${MAX_HELPERS}개 상한 — 하나 닫고 띄워라" 2

  # 자리: 리드 탭에 도우미가 없고 리드 폭이 160칸 이상이면 리드 오른쪽(같은 탭) · 그 밖은 같은 스페이스의 새 탭.
  # 앱은 라벨로 찾은 터미널을 그 탭 마지막 페인 «오른쪽»에만 붙인다 — 아래로 나누기는 라벨로 못 한다.
  # 리드에 라벨이 없으면(앱 밖에서 띄움) 라벨 없이 띄운다 — 창에는 안 나오고 앱 사이드바의 하위 에이전트로만 보인다.
  local me space tab cols bare place labels=() outlive=()
  me="$(rec "$HC_TERMINAL_ID")" || die "hc 가 리드 터미널 $HC_TERMINAL_ID 를 모른다(hc get 실패)" 1
  read -r space tab cols bare < <(py 'import sys,json
d=json.load(sys.stdin); l=d.get("labels") or {}; p=d.get("pid")
print(l.get("herdr.space") or "-", l.get("herdr.tab") or "-", d.get("cols") or 0,
      1 if p and p==(d.get("foreground") or {}).get("pid") else 0)' <<<"$me")
  # 셸 없는 리드(claude 가 터미널의 처음 프로그램 · `.pid == .foreground.pid`)는 교대 때 터미널째 끝나고 후임은 새 셸 터미널에 뜬다
  # (session-rotate 스킬 session-rotate.sh 11-06). 기본 자식은 부모가 끝나면 SIGHUP 으로 같이 끝난다(11-06 측정) → 일하던 도우미의 결과가
  # 후임에게 못 간다. 그래서 이 모양의 리드만 --outlive-parent 로 띄운다(뜬 뒤에는 못 바꾼다 — hc 스키마). 교대가 `handover` 로
  # 목록을 후임에게 넘긴다. 셸 있는 리드는 그대로(리드 탭을 닫으면 도우미도 닫힌다).
  [ "$bare" = 1 ] && outlive=(--outlive-parent)
  if [ "$space" = - ]; then place=hidden
  # TEAM_PLACE=tab — 오너가 «새 탭»이라고 하면 폭과 상관없이 새 탭으로(11-10 오너).
  elif [ "${TEAM_PLACE:-}" != tab ] && [ "$side" = 0 ] && [ "$tab" != - ] && [ "$cols" -ge 160 ]; then place=side; labels=(--label "herdr.space=$space" --label "herdr.tab=$tab")
  else place=tab; labels=(--label "herdr.space=$space")
  fi

  # 코어는 systemd 가 띄워 PATH 가 짧다(~/.local/bin·npm 없음 → spawn_failed · 10-30 실측) → 리드의 PATH 를 env 로 넘긴다.
  # 도우미 표시 HERDR_TEAM_HELPER=1 — 그 안에서 team.sh spawn 은 거부된다. claude 도우미는 에이전트 팀을 켠다(오너 10-21).
  # codex 는 --no-daemon 이어야 명령이 hc 터미널 안에서 돈다(hc --skill).
  # --no-notify — hc 가 도우미의 끝·막힘을 리드 입력칸에 쳐 넣지 않게 한다. 한가한 리드에 새 차례가 생기고
  #   교대의 await_idle 이 깨진다. 막힘은 ask·watch 가 잡는다.
  local envs=(PATH="$PATH" HERDR_TEAM_HELPER=1) args=("$@") addr
  [ "$kind" = claude ] && envs+=(CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1)
  [ "$kind" = codex ] && args=(--no-daemon "${args[@]}")
  # agy(1.4.12)는 작업 폴더 밖(지시서·결과 파일이 있는 $DIR)을 읽고 쓸 때마다, 셸 명령마다 허락을 물어 탭이 매번 멈췄다
  # (11-04 실측 3/3 · --add-dir 로 파일은 풀려도 `ls` 에서 또 멈춤). 다른 도우미와 같은 기준으로 띄운다 —
  # grok ui.yolo · claude bypassPermissions · codex approval never. 탭의 읽기 전용은 지시문으로 지킨다(grok 과 같다).
  [ "$kind" = agy ] && [ "$AGY_SKIP_PERMS" = 1 ] && [[ " ${args[*]} " != *" --dangerously-skip-permissions "* ]] && args=(--dangerously-skip-permissions "${args[@]}")
  addr="$("$HC" run --bg --json --no-notify "${outlive[@]}" --name "$name" --cwd "$PWD" "${labels[@]}" -- env "${envs[@]}" "$bin" "${args[@]}" \
    | py 'import sys,json;print(json.load(sys.stdin)["address"])')" || die "hc run 실패 — $kind" 1
  printf '%s\t%s\t%s\t%s\n' "$name" "$addr" "$place" "$kind" >>"$st"
  if settle "$addr" "$kind"; then echo "ready $name addr=$addr place=$place kind=$kind"
  else echo "blocked $name addr=$addr — 위 화면을 보고 오너에게 물어라"; exit 3; fi
}

# blocked 는 연달아 3번(약 9초) 보일 때만 믿는다 — codex 는 지시 1초 뒤 일하는 중인데도 blocked 로 나왔다(10-21 실측).
# blocked_tick <주소> <변수명> <이름> → 3번째면 화면 끝 줄(가림)을 찍고 rc 6 으로 끝낸다.
# 막힘 = hc 상태 blocked 이거나, 화면 끝에 선택창이 떠 있다.
# ⛔ codex 의 「Switch to gpt-6-luna for lower credit usage?」 선택창(enter select · esc back)을 옛 herdr 는 done 으로 보였다
#    → watch 가 done 으로 끝나고 ask 는 표식만 기다렸다(10-21 20:0x 실측). claude 선택창은 「Enter to select」.
is_blocked() {
  [ "$(status "$1")" = blocked ] && return 0
  screen "$1" | grep -v '^\s*$' | tail -8 | grep -qE '[Ee]nter (to )?select|Do you want to proceed'
}
blocked_tick() {
  local -n c="$2"
  if is_blocked "$1"; then c=$((c+1)); else c=0; fi
  [ "$c" -ge 3 ] || return 0
  echo "blocked $3 — 확인창에서 멈췄다. 판단은 부모가 한다(범위 밖·되돌릴 수 없을 때만 오너에게):"
  tail_masked "$1"; exit 6
}

# hc send 는 막힌 프로그램에는 치지 않고 rc 9 를 낸다 — --force 로 확인창을 넘기지 않는다(hc --skill).
hc_send() {
  local rc=0; "$HC" send "$1" "$2" >/dev/null 2>&1 || rc=$?
  [ "$rc" = 0 ] && return 0
  [ "$rc" = 9 ] && { echo "blocked $3 — 확인창이 떠 있어 지시를 보내지 않았다. 판단은 부모가 한다:"; tail_masked "$1"; exit 6; }
  die "hc send 실패 rc=$rc — $3" 1
}

# 차례가 오류로 끝남(hc 상태 error) — 11-06 실측: 모델 서버가 upstream 오류 두 번 · timeout 뒤 502 all_failed 를 내자
# Claude Code 가 «API Error: 502 …» 로 차례를 끝내고 입력칸에서 섰다. ask 는 표식만 · watch 는 blocked·done·gone 만 봐서
# 26분 일한 검수가 25분 넘게 서 있었고 오너가 먼저 봤다(«클러드 3번째 탭 멈췄는데»).
# → ask: error 가 3번(약 9초) 이어지고 화면 끝이 API·연결 오류면 60·120·180초 쉬고 «이어서 마무리» 를 보낸다(3번까지).
#   그 밖의 error 이거나 3번을 다 쓰면 rc 8. watch: error 가 4분 이어지면(이어 하기도 못 살림 · ask 없음) rc 8.
api_err() { screen "$1" | { grep -v '^\s*$' || true; } | tail -14 | grep -qiE 'API Error|overloaded|rate.?limit|timed? ?out|all_failed|ECONNRESET|socket hang up|fetch failed|\b(429|5[0-9]{2})\b'; }

cmd_ask() {
  need_hc
  local queue=0; [ "${1:-}" = --queue ] && { queue=1; shift; }
  [ $# -ge 2 ] || die "ask [--queue] <이름> <지시문|@파일> [시한초]"
  local name="$1" task="$2" limit="${3:-1800}" addr n marker out prompt i s blk=0
  addr="$(addr_of "$name")"; [ -n "$addr" ] || die "모르는 도우미: $name (team.sh ls)"
  s="$(status "$addr")"
  # unknown = 상태를 안 보내는 opencode — 화면이 멈춰 있을 때만 쉬는 것으로 본다. 그냥 보내면 일하는 중에 둘째 지시가 섞였다(codex 검수 10-30).
  [ "$s" = unknown ] && { quiet "$addr" && s=idle || s=working; }
  case "$s" in
    idle|done|error) ;;
    working) [ "$queue" = 1 ] || die "$name 상태가 working — hc read $addr 로 먼저 봐라(앞 일이 끝나면 보내려면 --queue)" 2
      # 겹친 지시는 막되, 앞 일이 끝나면 보낸다(turboflow 10-21 제안). 기다리는 동안 막히면 바로 알린다.
      local qd=$(( $(date +%s) + limit ))
      while :; do
        [ "$(date +%s)" -lt "$qd" ] || { echo "timeout $name 앞 일이 ${limit}s 안에 안 끝났다 — 보내지 않았다"; exit 4; }
        alive "$addr" || { echo "gone $name $addr"; exit 7; }
        blocked_tick "$addr" blk "$name"
        case "$(status "$addr")" in idle|done|error) break ;; unknown) quiet "$addr" && break ;; esac
        sleep 3
      done ;;
    *) die "$name 상태가 $s — hc read $addr 로 먼저 봐라" 2 ;;
  esac
  n=$(( (RANDOM % 9000) + 1000 )); marker="DONE-$((n*2))"
  out="$DIR/$name-$(date +%m%d-%H%M%S).md"
  [ "${task:0:1}" = "@" ] && task="지시서 ${task:1} 를 읽고 그대로 수행하라."
  # 표식 숫자는 지시문에 «DONE-숫자» 꼴로 쓰지 않는다 — 지시문이 화면에 되울려도 대기가 잘못 끝나지 않게.
  # 결과 경로: 과제가 정한 경로가 우선이다. 캐시 파일에만 쓰고 과제 경로를 비운 일이 있었다(turboflow 10-21 inv-sss).
  # 캐시 파일($out)은 늘 쓰게 한다 — 끝 판정이 그 파일을 본다.
  # 인계 칸(11-13 오너 «episode 칸 목록 herdr-team 도우미 형식에») — nac 워커 프롬프트(arcee-ai/nac dev af6bedd
  #   crates/nac-core/src/agent/prompts/nac_worker.md)의 episode 칸을 옮겼다. 리드가 빠진 칸을 바로 보게 칸은 늘 쓰고 없으면 «없음».
  #   $out 끝에만 붙인다 — 과제가 정한 결과 경로는 오너에게 갈 보고서일 수 있다. 한 줄로 둔다(줄바꿈·백틱 없이).
  prompt="$task 갈래가 둘 이상이고 각각 길면 네 CLI 의 하위 에이전트(팀원)로 나눠라 — hc 터미널·herdr 페인은 만들지 마라. 결과 파일: 이 과제가 결과 파일 경로를 정했으면 결과는 그 경로에 쓰고, $out 에는 3줄 요약과 그 경로를 써라. 정하지 않았으면 결과 전문을 $out 에 마크다운으로 써라. 어느 쪽이든 $out 맨 끝에 ## 인계 제목을 달고 아래 열 칸을 이 순서로 한 칸에 한 줄씩 «- 칸 이름: 내용» 꼴로 써라(과제가 정한 결과 경로의 파일에는 넣지 마라): 목표 / 접근 / 한 일 / 막힌 곳 / 주요 결과 / 파일(만들거나 고친 경로 · 근거로 읽은 주요 경로) / 결정(까닭과 함께) / 검증(돌린 명령과 그 결과 숫자 — 증거가 없으면 미검증이라 쓴다. 증거 없이 끝났다고 하지 마라) / 지금 상태(알려진 정상과 고장 · 설치·기준선·검증 일이면 정확한 명령과 환경 주의점도) / 다음(남은 문제와 다음에 이어 할 자리). 해당 없는 칸도 지우지 말고 없음 이라 써라. 도구 출력 원문은 붙이지 마라. 화면에는 3줄 이내 요약. 다 끝나면 화면 맨 마지막 줄에 영어 DONE, 하이픈, 숫자 $((n*2)) 를 붙여 한 단어로 써라."
  hc_send "$addr" "$prompt" "$name"
  # 첫 지시가 사라진 실측이 있다(옛 herdr) — 받았는지 보고, 아무 흔적이 없을 때만 한 번 더 보낸다.
  # 흔적 = 화면에 지시가 되울림(줄바꿈·테두리를 지우고 찾는다) · 표식이 이미 나옴 · 상태 working.
  # 다시 보내기는 상태를 아는 도우미가 한가할 때만 — opencode(unknown)는 받았는지 알 수 없어 두 번 보내지 않는다.
  for i in 1 2 3; do sleep 2
    screen "$addr" | py 'import re,sys
t=re.sub(r"[\s┃│]","",sys.stdin.read()); sys.exit(0 if sys.argv[1] in t or sys.argv[2] in t else 1)' \
      "$(basename "$out")" "$marker" && break
    [ "$(status "$addr")" = working ] && break
    [ "$i" = 3 ] && case "$(status "$addr")" in idle|done) hc_send "$addr" "$prompt" "$name" ;; esac
  done
  # 끝 판정 = 표식 «바로 뒤에 글자·점이 붙지 않고» + 결과 파일이 비어 있지 않다. 화면을 3초마다 직접 읽는다.
  # ⛔ grok 은 생각을 화면에 그리며 「마지막 줄에 DONE-5506를」처럼 표식을 미리 적었다 → 일 중간에 끝으로 잘못 판정.
  # ⛔ 그렇다고 «단독 줄»이나 «줄 끝»으로 좁히면 grok 을 놓친다 — 표식을 문장 끝에 붙여 쓰고(「…적어 두었다. DONE-15170」)
  #    그 줄 오른쪽 끝에 시각(「5:17 PM」)을 그린다. 셋 다 10-21 실측.
  # ⛔ agy 는 진행 표시줄에 「⣟  DONE-12688...」을 찍었다 → 점자 진행 표시 줄은 빼고, 표식 뒤 «.»«…» 도 인정하지 않는다.
  # ⛔ 파일 없이 표식만 60초 보이면 끝으로 받던 규칙이 agy·grok 을 3~8분 일찍 끊었다(turboflow 10-21).
  #    → 파일이 없으면 «도우미가 쉬고 있을 때»(상태 idle·done 이거나 화면이 30초 그대로)만 marker-only 로 받는다.
  # ⛔ 생각 글은 흘러나오며 그려진다. 「…last line DONE-16404」까지 그려지고 「.」이 오기 전에 읽혀, 파일을 먼저 쓴
  #    opencode 가 아직 생각 중인데 ok 가 났다(10-21 19:11 실측) → 표식은 3초 간격 두 번 연달아 보여야 끝이다.
  # ⛔ grok 은 여러 줄 답을 한 문단으로 이어 칸 폭에서 접는다. 하이픈 뒤에서 끊겨 「…있다. DONE-」/「12868」 두 줄이 됐고,
  #    한 줄씩만 보던 판정이 표식을 영영 못 잡아 3600초 시한까지 기다렸다(11-03 party-luma · 재현함) → 이웃한 두 줄을 이어서도 본다.
  #    그래도 표식 모양은 또 바뀔 수 있어, 결과 파일 + 상태 done 이 30초 이어지면 받는다(아래 else).
  local deadline=$(( $(date +%s) + limit )) seen=0 still=0 hit=0 h last="" calm=0 fm fmt="" err=0 resumes=0 w
  while [ "$(date +%s)" -lt "$deadline" ]; do
    alive "$addr" || { echo "gone $name $addr — 도우미 터미널이 사라졌다"; exit 7; }
    blocked_tick "$addr" blk "$name"
    if [ "$(status "$addr")" = error ]; then err=$((err+1)); else err=0; fi
    if [ "$err" -ge 3 ] && [ ! -s "$out" ]; then
      if [ "$resumes" -lt 3 ] && api_err "$addr"; then
        resumes=$((resumes+1)); w=$((60*resumes))
        echo "resume $name $resumes/3 — API·연결 오류로 차례가 끝남 · ${w}s 쉬고 이어서 하라고 보낸다" >&2
        sleep "$w"
        [ "$(status "$addr")" = error ] && hc_send "$addr" "앞 차례가 API·연결 오류(모델 쪽 · 일시)로 끊겼다. 지금까지 한 것을 바탕으로 이어서 마무리하라. 처음 지시대로 결과 파일(과제가 정한 경로 · 그리고 $out)을 쓰고, 다 끝나면 화면 맨 마지막 줄에 영어 DONE, 하이픈, 숫자 $((n*2)) 를 붙여 한 단어로 써라." "$name"
        err=0; sleep 3; continue
      fi
      echo "error $name $addr — 차례가 오류로 끝났다(이어 하기 ${resumes}번 뒤) · 화면 끝(가림):"; tail_masked "$addr"; exit 8
    fi
    s="$(screen "$addr")"
    if py 'import re,sys
pat=re.compile(r"(^|[\s•●⏺◆>*.-])"+re.escape(sys.argv[1])+r"(?![\w.…])")
spin=re.compile(r"^\s*[⠀-⣿✻✽✢✶✳]")
edge=re.compile(r"(\s+\d{1,2}:\d{2}\s?[AP]M)?[\s█│┃]*$")   # 줄 오른쪽 끝의 시각(「8:26 PM」)·스크롤바·테두리
L=sys.stdin.read().splitlines()
def hit(i):
    if spin.match(L[i]): return False
    if pat.search(L[i]): return True
    # 접힌 표식 — 이웃한 두 줄을 이어 붙여 다시 본다(뒤 확인은 그대로라 「…를」 같은 미리 적기는 여전히 막힌다)
    return i+1 < len(L) and not spin.match(L[i+1]) and bool(pat.search(edge.sub("", L[i]) + L[i+1].lstrip(" \t│┃")))
sys.exit(0 if any(hit(i) for i in range(len(L))) else 1)' "$marker" <<<"$s"; then
      hit=$((hit+1))
      [ -s "$out" ] && [ "$hit" -ge 2 ] && { echo "ok $name $out"; return 0; }
      h="$(md5sum <<<"$s")"; if [ "$h" = "$last" ]; then still=$((still+1)); else still=0; last="$h"; fi
      case "$(status "$addr")" in idle|done) seen=$((seen+1)) ;; *) [ "$still" -ge 10 ] && seen=$((seen+1)) ;; esac
      [ "$seen" -ge 10 ] && { echo "marker-only $name (결과 파일 $out 없음 — 화면 답 · 내용은 직접 확인하라)"; grep -v '^\s*$' <<<"$s" | grep -B12 "$marker" | head -12 | mask; return 0; }
    else hit=0
      # 표식을 못 읽어도 끝난 일을 시한까지 붙잡지 않는다 — 결과 파일이 있고, 상태가 idle·done 이고, 막히지 않았고,
      # 파일이 30초(10번) 그대로면 받는다. 상태를 못 읽으면(unknown) 빼고 표식만 기다린다.
      if [ -s "$out" ]; then
        fm="$(stat -c %Y "$out" 2>/dev/null || echo 0)"
        case "$(status "$addr")" in
          idle|done) if [ "$blk" = 0 ] && [ "$fm" = "$fmt" ]; then calm=$((calm+1)); else calm=0; fmt="$fm"; fi ;;
          *) calm=0 ;;
        esac
        [ "$calm" -ge 10 ] && { echo "ok $name $out (표식은 못 봤다 — 상태 idle·done · 결과 파일 30초 그대로 · 내용을 확인하라)"; return 0; }
      fi
    fi
    sleep 3
  done
  echo "timeout $name ${limit}s 상태=$(status "$addr") — hc read $addr 로 보고 판단하라(같은 지시를 그냥 다시 보내지 마라)"; exit 4
}

# 긴 ask 곁에 백그라운드로 걸어 둔다. ask 는 자기 도우미만 보므로, 하위 에이전트 확인창을 오너가 먼저 본 일이 있었다
# (turboflow 10-21 fix-batch 「선택하는게 나왔는데 이걸 관리감독 해야지」). 첫 사건에서 끝나니 다시 건다.
cmd_watch() {
  need_hc
  local limit="${1:-10800}" st name a s deadline
  st="$(state)"; [ -s "$st" ] || die "지켜볼 도우미가 없다(team.sh ls)"
  declare -A prev=() blk=() errc=()
  deadline=$(( $(date +%s) + limit ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    while IFS=$'\t' read -r name a _ _ <&3; do
      [ -n "$name" ] || continue
      if ! alive "$a"; then
        [ -n "${prev[$name]:-}" ] && [ "${prev[$name]}" != gone ] && { echo "gone $name $a"; exit 7; }
        prev[$name]=gone; continue
      fi
      s="$(status "$a")"
      if is_blocked "$a"; then blk[$name]=$(( ${blk[$name]:-0} + 1 )); else blk[$name]=0; fi
      [ "${blk[$name]}" -ge 3 ] && { echo "blocked $name $a — 확인창에서 멈췄다. 판단은 부모가 한다(범위 밖·되돌릴 수 없을 때만 오너에게):"; tail_masked "$a"; exit 6; }
      if [ "$s" = error ]; then errc[$name]=$(( ${errc[$name]:-0} + 1 )); else errc[$name]=0; fi
      [ "${errc[$name]}" -ge 48 ] && { echo "error $name $a — 4분째 오류 상태(ask 의 이어 하기도 못 살림 · 또는 ask 없음) · 화면 끝(가림):"; tail_masked "$a"; exit 8; }
      case "$s" in idle|done) [ "${prev[$name]:-}" = working ] && { echo "done $name $a"; exit 0; } ;; esac
      prev[$name]="$s"
    done 3<"$st"
    sleep 5
  done
  echo "timeout watch ${limit}s"; exit 4
}

cmd_close() {
  need_hc
  local st; st="$(state)"; [ -f "$st" ] || return 0
  local name a
  if [ "${1:-}" = "--all" ]; then
    while IFS=$'\t' read -r name a _ _; do alive "$a" && echo "closed $name $a"; end_term "$a"; done <"$st"
    : >"$st"
  elif [ "${1:-}" = "--idle" ]; then
    # 교대용 — 일을 끝낸 도우미만 닫는다. 일하는 중이면 남긴다(후임이 같은 터미널에서 `ls` 로 이어받는다).
    # unknown(opencode)은 일하는 중인지 몰라 남긴다.
    local line s keep=""
    while IFS= read -r line; do
      IFS=$'\t' read -r name a _ _ <<<"$line"
      s="$(status "$a")"
      case "$s" in
        idle|done) end_term "$a"; echo "closed $name $a" ;;
        gone) end_term "$a" ;;
        *) keep="$keep$line"$'\n'; echo "kept $name $a $s" ;;
      esac
    done <"$st"
    printf '%s' "$keep" >"$st"
  else
    a="$(addr_of "$1")"; [ -n "$a" ] || die "모르는 도우미: $1"
    end_term "$a"; echo "closed $1 $a"
    awk -F'\t' -v n="$1" '$1!=n' "$st" >"$st.tmp" && mv "$st.tmp" "$st"
  fi
}

cmd_ls() {
  need_hc
  local name a pl k
  [ -s "$(state)" ] || { echo "(없음)"; return 0; }
  while IFS=$'\t' read -r name a pl k; do
    if alive "$a"; then echo "$name $k $a $pl $(status "$a")"; else echo "$name $k $a (닫힘)"; fi
  done <"$(state)"
}

# 교대용(셸 없는 리드) — 내 목록(남은 도우미)을 후임 터미널 앞으로 옮긴다. 목록은 리드 터미널 주소로 묶여 있어
# 새 터미널에 뜬 후임은 그대로는 못 찾는다. 옮긴 줄마다 «handed 이름 주소» 를 찍는다.
cmd_handover() {
  need_hc
  local st to; st="$(state)"; to="$DIR/state/hc-${1//\//_}.tsv"
  [ -s "$st" ] || return 0
  [ "$st" = "$to" ] && return 0
  cat "$st" >>"$to"
  awk -F'\t' 'NF{print "handed", $1, $2}' "$st"
  : >"$st"
}

# doctor — 띄우기 전에 무엇이 깔렸는지 본다. 첫 낱말: ok(깔림) · missing(없음). 종료 코드 0 = hc 와 도우미 하나 이상 · 1 = 그 밖.
cmd_doctor() {
  local k b v n=0 hcok=0
  if command -v "$HC" >/dev/null 2>&1 || [ -x "$HC" ]; then
    hcok=1; echo "ok hc $("$HC" --version 2>/dev/null | awk '{print $2}') $HC"
  else echo "missing hc — herdr-core 가 없다(설치: herdr-core 안내)"; fi
  if [ -n "${HC_TERMINAL_ID:-}" ]; then echo "ok lead hc 터미널 $HC_TERMINAL_ID"
  else echo "missing lead — 지금 셸은 hc 터미널 밖이다(Herdr 앱에서 연 터미널 안에서 돌려야 spawn 이 된다)"; fi
  for k in $KINDS; do
    b="$(command -v "$k" 2>/dev/null)" || { echo "missing $k"; continue; }
    v="$(timeout 15 "$k" --version </dev/null 2>/dev/null | head -1 | tr -s ' ' | cut -c1-60)" || v=""   # set -e 아래 --version 실패·시한이 doctor 를 죽이지 않게
    echo "ok $k ${v:-버전?} $b"; n=$((n+1))
  done
  echo "도우미 ${n}종 · 상한 ${MAX_HELPERS}개 동시 · agy 권한 묻기 끔=${AGY_SKIP_PERMS}"
  [ "$hcok" = 1 ] && [ "$n" -gt 0 ]
}

main() {
  case "${1:-}" in
    spawn) shift; [ $# -ge 2 ] || die "spawn <이름> <종류> [-- 인자…]"; cmd_spawn "$@" ;;
    ask)   shift; cmd_ask "$@" ;;
    watch) shift; cmd_watch "$@" ;;
    close) shift; [ $# -ge 1 ] || die "close <이름>|--all|--idle"; cmd_close "$@" ;;
    ls)    cmd_ls ;;
    handover) shift; [ $# -ge 1 ] || die "handover <새 터미널 주소>"; cmd_handover "$1" ;;
    doctor) cmd_doctor ;;
    *) sed -n '2,15p' "$0"; exit 2 ;;
  esac
}
main "$@"; exit $?
