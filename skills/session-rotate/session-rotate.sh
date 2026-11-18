#!/usr/bin/env bash
# session-rotate.sh — Claude Code 세션 자기 교대(herdr-core hc 터미널 안 · herdr-option 세트).
#
#   session-rotate.sh [--terminal <hc 주소>] [--session <uuid>] [--goal <글>] [--if-requested] [--skip-prep-check] [--dry-run]
#   인자를 안 주면 자기 좌표($HC_TERMINAL_ID · $CLAUDE_CODE_SESSION_ID)를 쓴다 — 자기 교대 전용이다.
#
# 하는 일: 그 터미널 앞쪽의 claude 를 `/exit` 로 내리고, 셸로 돌아온 같은 터미널에 `claude` 를 쳐서 후임을 띄운다.
#   --goal 을 주면 후임에게 `/goal <글>` 을 다시 건다. 인계 내용은 나르지 않는다 — Auto Memory(MEMORY.md)와
#   프로젝트 문서(STATE.md 등)가 나른다. 셸 없는 터미널(claude 가 처음 프로그램)이면 같은 탭에 새 셸 터미널을 열고 거기 띄운다.
# 신원 = 그 터미널 앞쪽 프로그램이 claude 이고, 그 pid 의 `~/.claude/sessions/<pid>.json` sessionId 가 맞고,
#   호출 셸이 그 claude 의 자손이다. SIGTERM 은 어떤 경로로도 보내지 않는다.
# ⚠ 신뢰 경계: 호출자 결속은 환경변수를 읽는다. 같은 Unix 계정 안에서는 위조 가능하다 — 막는 것은 «오입력·잘못된 좌표»다.
#
# 종료 코드: 0 교대 끝 · 1 거절(감사 기록에 까닭) · 2 감사 기록 실패 · 64 사용법.
# 필요: hc · jq · ps · pgrep · (셸 없는 터미널이면) systemd-run --user.
set -uo pipefail

HC="${HC_BIN:-$(command -v hc || echo "$HOME/.local/bin/hc")}"   # 상자에 따라 /usr/local/bin/hc 에 있다(11-06)
SESS_DIR="${CLAUDE_SESSIONS_DIR:-$HOME/.claude/sessions}"   # Claude Code 가 pid 마다 sessionId 를 적는 곳
AUDIT_DIR="${ROTATE_AUDIT_DIR:-$HOME/.cache/session-rotate/audit}"
REQ="${ROTATE_REQUEST:-$HOME/.cache/session-rotate/request.json}"
STEP_WAIT="${ROTATE_STEP_WAIT:-3}"     # pty 단계 사이 대기(초)
EXIT_WAIT="${ROTATE_EXIT_WAIT:-90}"    # 소멸 관측 상한(초)
START_TMO="${ROTATE_START_TIMEOUT:-180}"
START_TRIES="${ROTATE_START_TRIES:-2}"
TEAM_SH="${ROTATE_TEAM_SH:-$HOME/.claude/skills/herdr-team/team.sh}"

REC=""; OK=0; WHY=""; TO_SESSION=""; TO_TERMINAL=""; SHELLLESS=0; HANDOVER_WARN=""

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }

# ── 감사 ────────────────────────────────────────────────────────────────
step() {  # step <name> <json-fragment>
  REC="${REC}${REC:+,}$(jq -cn --arg s "$1" --arg at "$(date -u +%FT%TZ)" \
        --argjson kv "${2:-\{\}}" '{step:$s, at:$at} + $kv')"
}
audit_path() { printf '%s/session-rotate-%s-%s.json' "$AUDIT_DIR" \
  "$(date -u +%Y%m%dT%H%M%SZ)" "$$"; }
write_audit() {  # write_audit <ok> <why> [suffix]
  local p; p="$(audit_path)${3:-}"
  mkdir -p "$AUDIT_DIR" 2>/dev/null   # 새 상자에는 감사 폴더가 없다 — 이른 거절·dry-run 도 기록을 남겨야 한다
  jq -n --arg terminal "$FROM_TERMINAL" --arg to_terminal "$TO_TERMINAL" --arg from "$SESSION" --arg to "$TO_SESSION" \
        --arg goal "$GOAL" --argjson ok "$1" --arg why "$2" \
        --argjson steps "[${REC}]" --arg at "$(date -u +%FT%TZ)" \
     '{schema:"herdr-option.session-rotate/1", at:$at, terminal:$terminal, to_terminal:$to_terminal, from_session:$from,
       to_session:$to, goal:$goal, ok:($ok==1), why:$why, steps:$steps}' > "$p" 2>/dev/null || return 1
  log "감사 기록: $p"; return 0
}
finish() {  # finish <ok:0|1> <why>
  if ! write_audit "$1" "$2"; then
    # 감사는 선택이 아니다. 기록 실패는 성공으로 접지 않는다(검수 결함5).
    log "⚠ 감사 기록 실패 — 레코드 전문을 stderr 로 남긴다"
    jq -n --argjson steps "[${REC}]" --arg why "$2" '{why:$why, steps:$steps}' >&2
    exit 2
  fi
  [ "$1" = "1" ] && exit 0 || exit 1
}

# ── hc 조회 3상태: present | absent | unknown ───────────────────────────
#    «관측된 부재» 와 «관측 불가» 를 뭉개면 조회 장애를 소멸로 오판한다(검수 결함3).
#    present = 터미널 앞쪽이 claude 이고 그 pid 의 세션 파일에서 sessionId 를 읽었다.
#    absent  = 터미널은 살아 있고 앞쪽이 그 터미널의 처음 프로그램(셸)이다 — 셸 프롬프트로 돌아왔다.
#    other   = 앞쪽이 claude 도 셸도 아니다(vim·less 등) — 소멸로 치지 않고, `claude` 를 치지도 키를 보내지도 않는다(codex 검수 10-30).
#    unknown = hc 조회 실패 · 터미널이 끝남 · 형 어긋남 · claude 인데 세션 파일을 못 읽음.
agent_state() {  # echo "<state>\t<session>\t<kind>\t<status>\t<pid>"
  local out a0 pid root s st
  out="$("$HC" get "$TERMINAL" --json 2>/dev/null)" || { printf 'unknown\t\t\t\t\n'; return; }
  printf '%s' "$out" | jq -e '.state == "live"' >/dev/null 2>&1 || { printf 'unknown\t\t\t\t\n'; return; }
  a0="$(printf '%s' "$out" | jq -r '.foreground.argv[0] // ""')"
  pid="$(printf '%s' "$out" | jq -r '.foreground.pid // ""')"
  root="$(printf '%s' "$out" | jq -r '.pid // ""')"
  [ -n "$a0" ] && [ -n "$pid" ] || { printf 'unknown\t\t\t\t\n'; return; }
  if [ "${a0##*/}" != "claude" ]; then
    if [ -n "$root" ] && [ "$pid" = "$root" ]; then printf 'absent\t\t\t\t%s\n' "$pid"; else printf 'other\t\t\t\t%s\n' "$pid"; fi
    return
  fi
  s="$(jq -r '.sessionId // ""' "$SESS_DIR/$pid.json" 2>/dev/null)"
  [ -n "$pid" ] && [ -n "$s" ] || { printf 'unknown\t\t\t\t\n'; return; }
  st="$(printf '%s' "$out" | jq -r '.status.state // ""')"   # claude 가 보내는 OSC 7501(idle·working·done·blocked)
  printf 'present\t%s\tclaude\t%s\t%s\t%s\n' "$s" "$st" "$pid" "$root"
}
f_state() { printf '%s' "$1" | cut -f1; }
f_sess()  { printf '%s' "$1" | cut -f2; }
f_kind()  { printf '%s' "$1" | cut -f3; }
f_pid()   { printf '%s' "$1" | cut -f5; }
f_root()  { printf '%s' "$1" | cut -f6; }   # 터미널의 처음 프로그램 pid(present 때만)
# 터미널이 끝났다(hc 가 답했고 state=finished) — 셸 없는 터미널에서는 이것이 «관측된 부재» 다.
#   hc 조회 자체가 실패하면 끝남이 아니다(unknown 과 섞지 않는다).
#   끝났으면 그 까닭(`reason` · 예 `exited`·`killed`)을 stdout 으로 낸다. `/exit` 로 끝났는지 아닌지는 부르는 쪽이 가른다.
term_finished() {  # term_finished <주소> ; echo <reason> · 0=끝남 1=안 끝남·조회 실패
  local out; out="$("$HC" get "$1" --json 2>/dev/null)" || return 1
  printf '%s' "$out" | jq -e '.state == "finished"' >/dev/null 2>&1 || return 1
  printf '%s' "$out" | jq -r '.reason // ""'
}
# 호출 셸이 그 claude 의 자손인가 — 남의 터미널·세션 좌표를 넣은 호출을 막는다(오입력 방지 · 보안 경계 아님)
descends_from() {  # descends_from <pid>
  local p=$$
  while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null; do
    [ "$p" = "$1" ] && return 0
    p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"
  done
  return 1
}

# ── 입력: hc send = 붙여 넣기 + Enter 한 번에 ───────────────────────────
#    옛 herdr 는 글자와 Enter 를 나눠 보내고 사이에 «들어갔나» 를 확인했다. hc 에는 Enter 없이 넣는 길이
#    없다(CLI·API `terminal.send` 둘 다 «Pasted, then submitted with Enter» · 10-30 스키마 확인).
#    ⇒ 확인은 «보낸 뒤 화면에 보이나» 로 하고, 결과는 판정이 아니라 기록이다(rc 2 = 보냈는데 화면에서 못 봤다).
#    hc send 는 막힌(blocked) 프로그램에는 치지 않고 rc 9 를 낸다 — --force 로 확인창을 넘기지 않는다.
# ⭐⭐ **확인 문자열은 «내가 보낸 것» 이 아니라 «TUI 가 그리는 것» 과 대조해야 한다**
#    (실측 2026-08-27 · 문서 §6.2): 큰 텍스트는 TUI 가 **`[Pasted text #N]` 으로 접어서** 원문이 화면에 남지 않는다.
#    ⇒ 접힘 표시를 착지 증거로 인정하되 **어느 증거로 통과했는지를 `PTY_CONFIRMED_VIA` 에 남긴다**.
#    ⛔ 대체 문면은 **그 호출에만** 준다 — 전역으로 열면 스크롤백에 남은 낡은 접힘 표시가 거짓 확인한다.
PTY_CONFIRMED_VIA=""   # literal | paste_fold | none | ""(확인 안 함)
pty_line() {  # pty_line <text> <expect-substring|""> [alt-expect(접힘 표시)]
  local text="$1" expect="${2:-}" alt="${3:-}" seen=""
  PTY_CONFIRMED_VIA=""
  "$HC" send "$TERMINAL" "$text" >/dev/null 2>&1 || return 1
  sleep "$STEP_WAIT"
  if [ -n "$expect" ]; then
    seen="$("$HC" read "$TERMINAL" 2>/dev/null | tail -40)"
    if printf '%s' "$seen" | grep -qF -- "$expect"; then
      PTY_CONFIRMED_VIA="literal"
    elif [ -n "$alt" ] && printf '%s' "$seen" | grep -qF -- "$alt"; then
      PTY_CONFIRMED_VIA="paste_fold"
    else
      PTY_CONFIRMED_VIA="none"; return 2
    fi
  fi
  return 0
}

# 감사 조각 — 배터리가 «그 값을 실제로 소비하는 함수» 를 부를 수 있게 함수로 낸다(§6.1)
pty_step_json() {  # pty_step_json <rc> [extra-json-object]
  local ex="${2:-}"; [ -n "$ex" ] || ex='{}'
  jq -cn --argjson rc "$1" --arg via "$PTY_CONFIRMED_VIA" \
         --argjson ex "$ex" '{rc:$rc, confirmed_via:$via} + $ex'
}

# ── /exit 뒤 물음 — 소멸을 막는 화면 둘에 키를 하나씩 보낸다 ─────────────
#    ⭐ 실측 2026-09-08: 「Background work is running」 → Enter(기본 선택 1 Exit and stop tasks).
#    ⭐ 실측 2026-10-26(v2.1.310): 세션이 SendFeedback 초안을 남겼으면 `/exit` 뒤
#      「You have N unsent feedback draft · Enter to review & send · Esc to discard and exit」 가 떠서
#      소멸이 관측되지 않는다(10-25 stock 교대 감사 `…065410Z` — 그 화면에서 22시간 멈춤).
#      Esc 한 번 = 그 세션 초안을 버리고 종료(2초). Enter 가 들어가면 「Feedback drafts … Esc to close」
#      목록이 되는데 거기서도 Esc 한 번에 종료한다(초안은 남는다). 피드백 초안은 보내지 않고 Esc 로 버린다.
#    ⛔ 떠 있는 물음 = 버퍼에서 **더 아래** 표식이다 — 위쪽 표식은 낡은 스크롤백(직전 교대의 초안 물음 ·
#      대화에 인용된 문구)이다. 낡은 Background 글자에 걸린 CR 이 초안 물음에 들어가면 목록이 열리고,
#      낡은 초안 글자에 걸린 Esc 가 Background 물음에 들어가면 종료가 안 된다(grok 검수 P1 · 10-26).
#    ⛔ 키는 종류마다 한 번 · 전송이 된 때만 셈 · 점유가 보일 때만 — 셸로 돌아간 뒤 키가 셸에 들어가지 않게.
#      셸에 샌 Esc 는 readline 의 Meta 접두라 다음에 치는 `claude` 의 c 를 먹는다(실측 10-27 «laude»).
#    ⭐ 실측 2026-10-27(v2.1.311 · 버리는 세션 넷): 바쁜 중에 `/exit` 가 들어가면 초안 물음 아래 입력창이
#      살아 있고 **Esc 가 먹지 않는다**(Esc 두 번 · 20초 그대로 · ⓐ 교대 `…111035Z` 는 Esc 뒤 36초를 머물렀다).
#      그 상태에서도 Enter → 목록 → Esc → (끝난 도구가 남긴) Background 물음 → CR 이면 0.5초 안에 끝난다.
#      ⇒ Esc 뒤 다음 바퀴에도 초안 물음이 맨 아래면 Enter 를 한 번(셸에 새도 빈 줄이다) · 목록이 맨 아래면 Esc 한 번.
EXIT_PROMPT=0   # Background 물음에 CR 을 보낸 바퀴(0=안 봄)
DRAFTS=0        # 초안 물음에 Esc 를 보낸 바퀴(0=안 봄)
DRAFTS_ENTER=0  # Esc 가 안 먹은 초안 물음에 Enter 를 보낸 바퀴(0=안 보냄)
DRAFTS_LIST=0   # 초안 목록에 Esc 를 보낸 바퀴(0=안 봄)
answer_exit_prompts() {  # answer_exit_prompts [바퀴=8]
  local i scr q l b r
  EXIT_PROMPT=0; DRAFTS=0; DRAFTS_ENTER=0; DRAFTS_LIST=0
  for i in $(seq 1 "${1:-8}"); do
    sleep "$STEP_WAIT"
    # 셸 없는 터미널은 /exit 로 터미널째 끝난다. term_finished 가 이제 까닭을 stdout 으로 내므로 여기서는 버린다(rc 뜻 그대로).
    [ "$SHELLLESS" = 1 ] && term_finished "$TERMINAL" >/dev/null && return 0
    case "$(f_state "$(agent_state)")" in absent|other) return 0 ;; unknown) continue ;; esac
    scr="$("$HC" read "$TERMINAL" 2>/dev/null | tail -40)"
    q="$(grep -nF 'Esc to discard and exit' <<<"$scr" | tail -1 | cut -d: -f1)"
    l="$(grep -nF 'd to discard · Esc to close' <<<"$scr" | tail -1 | cut -d: -f1)"
    b="$(grep -nF 'Background work is running' <<<"$scr" | tail -1 | cut -d: -f1)"
    r="$(grep -nF 'Resume this session with' <<<"$scr" | tail -1 | cut -d: -f1)"
    # 끝난 세션의 꼬리(셸)가 맨 아래면 hc 가 아직 claude 를 앞쪽으로 보여도 키를 보내지 않는다(grok 검수 P1 · 10-27)
    if [ "${r:-0}" -gt "${q:-0}" ] && [ "${r:-0}" -gt "${l:-0}" ] && [ "${r:-0}" -gt "${b:-0}" ]; then continue; fi
    if [ "${l:-0}" -gt "${q:-0}" ] && [ "${l:-0}" -gt "${b:-0}" ]; then
      [ "$DRAFTS_LIST" = 0 ] && "$HC" keys "$TERMINAL" esc >/dev/null 2>&1 && DRAFTS_LIST=$i
    elif [ "${q:-0}" -gt "${b:-0}" ]; then
      if [ "$DRAFTS" = 0 ]; then
        "$HC" keys "$TERMINAL" esc >/dev/null 2>&1 && DRAFTS=$i
      elif [ "$DRAFTS_ENTER" = 0 ]; then
        "$HC" keys "$TERMINAL" enter >/dev/null 2>&1 && DRAFTS_ENTER=$i
      fi
    elif [ "${b:-0}" -gt 0 ]; then
      [ "$EXIT_PROMPT" = 0 ] && "$HC" keys "$TERMINAL" enter >/dev/null 2>&1 && EXIT_PROMPT=$i
    fi
  done
}
exit_prompts_json() {
  jq -cn --argjson i "$EXIT_PROMPT" --argjson d "$DRAFTS" --argjson e "$DRAFTS_ENTER" --argjson l "$DRAFTS_LIST" \
    '{seen:($i>0), sent:(if $i>0 then "enter" else "" end), attempt:$i,
      drafts_seen:($d>0), drafts_sent:(if $d>0 then "esc" else "" end), drafts_attempt:$d,
      drafts_enter_attempt:$e, drafts_list_attempt:$l}'
}

# ── 한가해질 때까지 기다린다 ────────────────────────────────────────────
#    ⭐ 바쁜(working) 세션에 `/exit` 을 보내면 **입력창에 쌓이기만 한다**(실측 2026-08-24).
#    «시간을 두고 확인해서 진행» 의 첫 조건이다.
# ⭐⭐ **관측을 남긴다** — `M-12` 판정(2026-08-26)의 잔여 구멍이 이것이었다.
#    이 함수는 상태 필드가 **빈 문자열이어도 «한가함»** 으로 친다(조회는 됐는데 status 를
#    못 읽은 경우까지 통과시키는 관대한 판정이다). 그런데 감사에는 **불리언만** 남았다
#    ⇒ 「idle 이라서 참」과 「못 읽어서 참」이 기록만으로 안 갈렸다.
#    ⛔ 판정을 조이지 않는다(빈 값을 red 로 바꾸면 정상 교대가 막힐 수 있다) —
#       **관측을 기록해서 다음 사람이 가릴 수 있게** 한다.
AWAIT_OBSERVED=""      # 마지막으로 관측한 status 필드 원문
AWAIT_EMPTY=false      # 그 원문이 빈 문자열이었는가(= «못 읽어서 참» 후보)
AWAIT_WAITED=0
await_idle() {  # await_idle <limit-sec> ; 0=한가함 1=시한초과
  local waited=0 st s v
  AWAIT_OBSERVED=""; AWAIT_EMPTY=false; AWAIT_WAITED=0
  while [ "$waited" -lt "$1" ]; do
    s="$(agent_state)"; st="$(f_state "$s")"
    if [ "$st" != "present" ]; then
      AWAIT_OBSERVED="__${st}__"; AWAIT_WAITED=$waited; return 1
    fi
    v="$(printf '%s' "$s" | cut -f4)"
    AWAIT_OBSERVED="$v"; AWAIT_WAITED=$waited
    case "$v" in
      "") AWAIT_EMPTY=true; return 0 ;;
      idle|done|waiting|ready) return 0 ;;
    esac
    sleep 3; waited=$((waited+3))
  done
  AWAIT_WAITED=$waited
  return 1
}

await_step() {  # await_step <idle-bool> [단계 이름] — 관측을 감사에 싣는다
  step "${2:-await_idle}" "$(jq -cn --argjson i "$1" --arg obs "$AWAIT_OBSERVED" \
        --argjson e "$AWAIT_EMPTY" --argjson w "$AWAIT_WAITED" \
        '{idle:$i, observed:$obs, empty_state:$e, waited_s:$w,
          why:"empty_state=true 면 «idle 이라서 참» 이 아니라 «status 를 못 읽어서 참» 이다(M-12 잔여)"}')"
}

# ── 요청 판독(트리거 기동) ──────────────────────────────────────────────
usage() { echo "usage: $0 [--terminal <hc 주소>] [--session <uuid>] [--goal <t>] [--if-requested] [--skip-prep-check] [--dry-run]" >&2; exit 64; }
TERMINAL=""; SESSION=""; GOAL="${ROTATE_GOAL:-}"; DRY=0; FROM_REQ=0; SKIP_PREP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --if-requested) FROM_REQ=1; shift ;;
    --terminal) TERMINAL="${2:-}"; shift 2 ;;
    --session) SESSION="${2:-}"; shift 2 ;;
    --goal) GOAL="${2:-}"; shift 2 ;;
    --skip-prep-check) SKIP_PREP=1; shift ;;
    --dry-run) DRY=1; shift ;;
    *) usage ;;
  esac
done
if [ "$FROM_REQ" = "1" ]; then
  [ -f "$REQ" ] || { log "요청 없음 — 아무것도 하지 않는다"; exit 0; }
  jq -e . "$REQ" >/dev/null 2>&1 || { log "요청 파싱 불능"; exit 1; }
  TERMINAL="$(jq -r '.terminal // ""' "$REQ")"
  SESSION="$(jq -r '.session // ""' "$REQ")"
  GOAL="$(jq -r '.goal // ""' "$REQ")"
fi
# 인자를 안 주면 **자기 좌표**를 쓴다 — 자기 교대 전용이므로 그것이 유일한 정답이다.
[ -n "$TERMINAL" ] || TERMINAL="${HC_TERMINAL_ID:-}"
[ -n "$SESSION" ] || SESSION="${CLAUDE_CODE_SESSION_ID:-}"
[ -n "$TERMINAL" ] && [ -n "$SESSION" ] || usage
FROM_TERMINAL="$TERMINAL"   # 감사의 terminal — 셸 없는 터미널이면 후임은 TO_TERMINAL 에 뜬다

# ── 준비 완료 게이트 ────────────────────────────────────────────────────
#    규약: 교대는 «준비가 다 끝나면» 부른다(커밋·푸시·인계 메모).
#    «끝났다» 를 말로 두지 않고 **기계가 잰다**. 커밋 안 된 작업을 안고 교대하면
#    후임에게는 그것을 복구할 방법이 없다.
# 프로젝트 폴더 = 그 터미널 앞쪽 claude 프로세스의 cwd(Claude Code 는 띄운 폴더에 머문다 · Bash 도구의 cd 는 자식 셸 몫).
claude_cwd() {
  local pid; pid="$("$HC" get "$TERMINAL" --json 2>/dev/null | jq -r '.foreground.pid // ""')"
  [ -n "$pid" ] && readlink "/proc/$pid/cwd" 2>/dev/null
}
prep_check() {
  local v="" cwd root mem slug
  cwd="$(claude_cwd)"
  root="${ROTATE_REPO:-$(git -C "${cwd:-.}" rev-parse --show-toplevel 2>/dev/null)}"
  # git 저장소가 아니면 커밋 검사는 건너뛴다(감사에는 no_repo 로 남는다 · 위반 아님).
  if [ -n "$root" ] && git -C "$root" rev-parse --git-dir >/dev/null 2>&1; then
    [ -n "$(git -C "$root" status --porcelain 2>/dev/null)" ] && v="$v dirty_tree"
    if git -C "$root" rev-parse '@{u}' >/dev/null 2>&1; then
      [ -n "$(git -C "$root" log '@{u}..' --oneline 2>/dev/null)" ] && v="$v unpushed_commits"
    fi
  fi
  # Auto Memory 자리 = ~/.claude/projects/<cwd 의 영문자·숫자 밖 글자를 «-» 로>/memory/MEMORY.md (Claude Code 꼴).
  if [ -n "$cwd" ]; then
    slug="$(printf '%s' "$cwd" | sed 's/[^A-Za-z0-9]/-/g')"
    mem="$HOME/.claude/projects/$slug/memory/MEMORY.md"
    if [ -f "$mem" ]; then
      [ -n "$(find "$mem" -mmin -1440 2>/dev/null)" ] || v="$v memory_stale"
    else
      v="$v memory_missing"
    fi
  else
    v="$v cwd_unreadable"
  fi
  printf '%s' "${v# }"
}
PREP="$(prep_check)"
step prep_check "$(jq -cn --arg v "$PREP" --argjson sk "$SKIP_PREP" '{violations:$v, skipped:($sk==1)}')"
if [ -n "$PREP" ] && [ "$SKIP_PREP" != "1" ]; then
  finish 0 "준비 미완 — [$PREP]. 커밋·푸시·인계 메모를 끝내고 다시 부르라(무시: --skip-prep-check)"
fi

# ── 0) 호출자 결속 — 오입력 방지(보안 경계 아님·위 배너 참조) ───────────
step caller_binding "$(jq -cn --arg t "${HC_TERMINAL_ID:-}" --arg s "${CLAUDE_CODE_SESSION_ID:-}" \
                        '{env_terminal:$t, env_session:$s}')"
if [ "${HC_TERMINAL_ID:-}" != "$TERMINAL" ] || [ "${CLAUDE_CODE_SESSION_ID:-}" != "$SESSION" ]; then
  finish 0 "호출자≠대상 — 자기 교대 전용이다(env terminal=${HC_TERMINAL_ID:-} session=${CLAUDE_CODE_SESSION_ID:-})"
fi

# ── 1) 정체 게이트 ──────────────────────────────────────────────────────
S="$(agent_state)"
# 분리 뒤 재실행은 조상이 끊긴다(setsid) — 분리 전 부모가 잰 pid 와 «같은 pid» 일 때만 그 판정을 잇는다(codex 검수 10-30).
DESC=false
if [ "${ROTATE_DETACHED:-0}" = "1" ]; then
  [ -n "${ROTATE_FG_PID:-}" ] && [ "$(f_pid "$S")" = "$ROTATE_FG_PID" ] && DESC=true
elif descends_from "$(f_pid "$S")"; then DESC=true; fi
FG_PID="$(f_pid "$S")"   # 승인한 claude pid — 아래 재판정이 같은 pid 인지 본다
step identity_gate "$(jq -cn --arg st "$(f_state "$S")" --arg se "$(f_sess "$S")" --arg k "$(f_kind "$S")" \
                       --arg pid "$(f_pid "$S")" --argjson d "$DESC" '{state:$st, seen_session:$se, kind:$k, pid:$pid, caller_descends:$d}')"
if [ "$(f_state "$S")" != "present" ] || [ "$(f_kind "$S")" != "claude" ] \
   || [ "$(f_sess "$S")" != "$SESSION" ] || [ "$DESC" != "true" ]; then
  finish 0 "정체 불일치 — state=$(f_state "$S") kind=$(f_kind "$S") session=$(f_sess "$S") caller_descends=$DESC"
fi
# ── 1b) 터미널 모양 — claude 아래에 셸이 있는가 ─────────────────────────
#    ⭐ 실측 2026-11-06(실제 상자 t1 = `env PATH=… claude`): claude 가 터미널의 처음 프로그램이면
#    `/exit` 가 터미널째 끝낸다 → hc 가 그 터미널에서 분리한 이 스크립트까지 끝낸다(setsid 도 못 버팀 · 시험함)
#    → 최종 감사 0 · 후임 0 · 산 터미널이 0 이 된 Herdr 스페이스가 사라졌다.
#    ⇒ 거절하지 않는다(11-06): 분리는 hc 밖(`systemd-run --user` · 시험함)에서 하고, `/exit` 전에 같은 스페이스·탭에
#      셸 터미널을 새로 열어 거기에 후임을 띄운다 — 스페이스에 산 터미널이 0 인 순간이 없게.
[ "$(f_pid "$S")" = "$(f_root "$S")" ] && SHELLLESS=1
step terminal_shape "$(jq -cn --arg pid "$(f_pid "$S")" --arg root "$(f_root "$S")" --argjson sl "$SHELLLESS" \
                        '{fg_pid:$pid, root_pid:$root, shape:(if $sl==1 then "shellless" else "shell" end)}')"
if [ "$SHELLLESS" = 1 ]; then
  command -v systemd-run >/dev/null || finish 0 "셸 없는 터미널인데 systemd-run 이 없다 — hc 밖으로 분리할 수 없어 /exit 를 보내지 않았다"
  # 일하는 도우미가 전임 터미널과 같이 끝나는 꼴(--outlive-parent 없이 뜸 · 뜬 뒤에는 못 바꾼다 — hc 스키마)이면 여기서 멈춘다.
  #   분리 뒤에 접으면 전임이 모른다. team.sh 는 셸 없는 리드의 도우미를 --outlive-parent 로 띄운다(11-06).
  DOOMED=""
  if [ -x "$TEAM_SH" ]; then
    while read -r hn _ ha hp hs; do
      { [ "$hp" = "(닫힘)" ] || [ -z "$ha" ]; } && continue
      case "$hs" in idle|done) continue ;; esac   # close --idle 이 닫을 것
      [ "$("$HC" get "$ha" --json 2>/dev/null | jq -r '.die_with_parent')" = "false" ] || DOOMED="$DOOMED $hn($ha)"
    done < <(HC_TERMINAL_ID="$TERMINAL" HC_BIN="$HC" "$TEAM_SH" ls 2>/dev/null)
  fi
  step helpers_outlive "$(jq -cn --arg d "${DOOMED# }" '{doomed:$d}')"
  [ -z "$DOOMED" ] || finish 0 "셸 없는 터미널 · 일하는 도우미[${DOOMED# }]가 전임 터미널과 같이 끝난다 — 그 일이 끝난 뒤 다시 부르라"
fi
[ "$DRY" = "1" ] && finish 1 "dry-run — 게이트 통과까지만"

# ── 2) 감사 가능성 선확인 + 진행중 기록 ─────────────────────────────────
#    detach 뒤에는 rc·stderr 가 아무 데도 안 간다. 그래서 **분리 전에** 쓸 수 있는지 재고
#    진행중 레코드를 먼저 남긴다 — 이후 전 구간이 관측 공백이 되지 않게(검수 2-결함2).
mkdir -p "$AUDIT_DIR" 2>/dev/null
if ! write_audit 0 "in_flight — 분리 직전. 이 파일이 마지막이면 이후 단계에서 관측 공백이 났다는 뜻" ".inflight"; then
  log "⚠ 감사 디렉터리에 쓸 수 없다 — 교대를 시작하지 않는다"; exit 2
fi
rm -f "$REQ" 2>/dev/null   # 요청 소비(중복 발화 방지)

# ── 자기 분리 — **호출자보다 오래 살아야 한다.** 호출자가 setsid 를 잊으면
#    자기가 죽인 세션과 함께 죽어 터미널이 claude 없는 셸로 남는다(최악).
#    잊을 수 없게 스크립트가 스스로 분리한다.
# 셸 없는 터미널 — setsid 로는 hc 를 못 벗어난다(11-06 시험 1: 터미널이 끝나자 setsid 자식도 끝남).
#   systemd 사용자 유닛으로 다시 띄운다(시험 2: 터미널이 끝난 뒤에도 산다). 유닛은 호출 환경을 물려받지 않으므로
#   이 스크립트·team.sh 가 읽는 변수를 **이름 하나씩** 넘긴다(아래 case 목록):
#     PATH · HC_TERMINAL_ID · HC_TERMINAL_SOCKET · CLAUDE_CODE_SESSION_ID · CLAUDE_SESSIONS_DIR ·
#     HERDR_TEAM_DIR · HERDR_TEAM_MAX · ROTATE_AUDIT_DIR · ROTATE_REPO · ROTATE_TEAM_SH · ROTATE_* 여섯.
#   ⛔ 앞머리 통째 허락(`CLAUDE_*` · `ROTATE_*` · `HERDR_*`)으로 열지 않는다 — `CLAUDE_CODE_MESSAGING_TOKEN` 같은
#      값이 `systemd-run --setenv` 인자 · 유닛 속성에 실려 나간다(11-06 codex 검수 높음).
#   ⛔ HERDR_TEAM_HELPER 는 넘기지 않는다 — 후임이 도우미로 오인한다.
#   ⛔ HC_SCOPE 는 넘기지 않는다 — hc 는 그 표식을 단 프로세스를 그 터미널과 같이 끝낸다(11-06 실측: 실물 1회차 유닛이
#      /exit 직후 감사 없이 사라짐 · 유닛 넷 시험에서 HC_SCOPE 단 것만 죽고 HC_TERMINAL_ID·소켓·빈 것은 삶). HC_* 는 허락 목록으로만.
if [ "$SHELLLESS" = 1 ] && [ "${ROTATE_DETACHED:-0}" != "1" ]; then
  UNIT="session-rotate-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  SETENV=(--setenv=ROTATE_DETACHED=1 --setenv="ROTATE_FG_PID=$FG_PID" --setenv="HC_BIN=$HC" --setenv="ROTATE_UNIT=$UNIT")
  while IFS= read -r -d '' kv; do
    case "${kv%%=*}" in
      ROTATE_DETACHED|ROTATE_FG_PID|ROTATE_UNIT|HC_BIN) ;;
      PATH|HC_TERMINAL_ID|HC_TERMINAL_SOCKET|CLAUDE_CODE_SESSION_ID|CLAUDE_SESSIONS_DIR|\
      HERDR_TEAM_DIR|HERDR_TEAM_MAX|ROTATE_AUDIT_DIR|ROTATE_REPO|ROTATE_TEAM_SH|ROTATE_UPDATE|ROTATE_UPDATE_SH|HERDR_UPDATE_CONF|HERDR_UPDATE|HERDR_UPDATE_EVERY|HERDR_UPDATE_TIMEOUT|HERDR_UPDATE_SKIP_PREFIXES|HERDR_UPDATE_SUDO|\
      ROTATE_REQUEST|ROTATE_EXIT_WAIT|ROTATE_IDLE_WAIT|ROTATE_START_TIMEOUT|\
      ROTATE_START_TRIES|ROTATE_STEP_WAIT) SETENV+=(--setenv="$kv") ;;
    esac
  done < <(env -0)
  if systemd-run --user --quiet --collect --unit="$UNIT" "${SETENV[@]}" "$(readlink -f "$0")" --terminal "$TERMINAL" \
       --session "$SESSION" --goal "$GOAL" $([ "$SKIP_PREP" = "1" ] && printf -- --skip-prep-check) >/dev/null 2>&1; then
    log "자기 분리(systemd-run --user · $UNIT) 후 재실행"; exit 0
  fi
  finish 0 "셸 없는 터미널 — systemd-run --user 로 분리하지 못했다 · /exit 를 보내지 않았다"
fi
[ -n "${ROTATE_UNIT:-}" ] && step detached "$(jq -cn --arg u "$ROTATE_UNIT" '{via:"systemd-run --user", unit:$u}')"
if [ "${ROTATE_DETACHED:-0}" != "1" ] && [ "$(ps -o sid= -p $$ | tr -d ' ')" != "$$" ]; then
  log "자기 분리(setsid) 후 재실행"
  ROTATE_DETACHED=1 ROTATE_FG_PID="$FG_PID" setsid nohup "$0" --terminal "$TERMINAL" --session "$SESSION" \
      --goal "$GOAL" $([ "$SKIP_PREP" = "1" ] && printf -- --skip-prep-check) \
      >/dev/null 2>&1 </dev/null &
  exit 0
fi

# ── 3) 우아한 종료 — pty 로 텍스트/Enter 를 나눠 보내고 사이를 확인 ─────
S2="$(agent_state)"   # 전송 직전 재판정(TOCTOU 창 축소) — 세션만이 아니라 승인한 pid 와 같은 프로세스인지도 본다
step recheck_before_exit "$(jq -cn --arg st "$(f_state "$S2")" --arg se "$(f_sess "$S2")" --arg pid "$(f_pid "$S2")" \
                            --arg want "$FG_PID" '{state:$st, seen_session:$se, pid:$pid, approved_pid:$want}')"
if [ "$(f_state "$S2")" != "present" ] || [ "$(f_sess "$S2")" != "$SESSION" ] || [ "$(f_pid "$S2")" != "$FG_PID" ]; then
  finish 0 "전송 직전 점유자가 바뀌었다 — 보내지 않았다"
fi
# ⭐⭐ **`/goal` 훅을 먼저 내린다 — 이것이 없어서 자기 교대가 성립하지 않았다**
#    (실측 2026-08-25): `/goal` Stop 훅은 조건이 찰 때까지 **종료를 막고 모델을 다시 부른다**.
#    그래서 세션이 계속 `working` 으로 남고 `await_idle` 이 300초를 채운 뒤 fail-loud 로 끝났다.
#    ⇒ 한가해지길 기다리기 **전에** 훅을 내린다. «/goal clear» 도 같은 길(hc send)로 보낸다.
#    ⚠ 실패해도 멈추지 않는다 — 훅이 애초에 없는 세션에서는 이 단계가 무의미하고,
#      「한가함」 판정은 어차피 `await_idle` 이 다시 한다(두 번째 진실을 만들지 않는다).
pty_line "/goal clear" "/goal"; GR=$?
step clear_goal "$(pty_step_json "$GR" "$(jq -cn '{why:"Stop 훅이 종료를 막아 await_idle 이 시한을 채운다(실측 2026-08-25)", fatal:false}')")"

if ! await_idle "${ROTATE_IDLE_WAIT:-300}"; then
  await_step false
  finish 0 "세션이 한가해지지 않았다 — /goal clear rc=$GR 이후에도 working 이면 훅 외 원인이다"
fi
await_step true
# ── 3b) 배경 셸 정리 — 이 세션이 띄운 bash 를 끝낸다 ───────────────────────
#    ⭐ 실측 2026-09-08: 세션이 남긴 배경 셸(`until … sleep` 대기 셋)이 있으면 `/exit` 뒤
#    「Background work is running · 1. Exit and stop tasks / 2. Move to background / 3. Stay」
#    물음이 떠서 소멸이 관측되지 않고 90s 시한 → 「전임 생존」으로 교대 실패. 세션 소속은
#    /proc/<pid>/environ 의 CLAUDE_CODE_SESSION_ID 로 가린다(다른 세션 셸은 안 건드린다).
kill_session_shells() {  # echo <죽인 수>
  local n=0 p pp
  for p in $(pgrep -x bash); do
    [ "$p" = "$$" ] && continue
    pp="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"; [ "$pp" = "$$" ] && continue
    if tr '\0' '\n' < "/proc/$p/environ" 2>/dev/null | grep -qx "CLAUDE_CODE_SESSION_ID=$SESSION"; then
      pkill -P "$p" 2>/dev/null; kill "$p" 2>/dev/null && n=$((n+1))
    fi
  done
  printf '%s' "$n"
}
KILLED="$(kill_session_shells)"
step kill_bg_shells "$(jq -cn --argjson n "${KILLED:-0}" '{killed:$n}')"
sleep 2

# ── 3c) 도우미 정리 — 이 세션이 herdr-team 으로 띄운 도우미(hc 자식 터미널) 중 «일을 끝낸 것»만 닫는다 ──
#    ⭐ 기록 조사(2026-10-21): 교대 뒤 전임의 옆 페인이 쌓였고, 후임은 herdr 이름으로 SendMessage 를
#    보내다 «not reachable» 로 실패했다. 도우미 목록은 hc 터미널 주소로 묶여 있고 후임은 같은 터미널에서
#    뜬다 ⇒ 일하는 중인 도우미는 남겨 후임이 `team.sh ls` 로 이어받게 하고, 끝난 것만 닫는다.
#    도구가 없으면 건너뛴다(선택 기능 — 교대를 막지 않는다). TEAM_SH 는 맨 위(1b 관문도 씀).
HELPERS=""
[ -x "$TEAM_SH" ] && HELPERS="$(HC_TERMINAL_ID="$TERMINAL" HC_BIN="$HC" "$TEAM_SH" close --idle 2>/dev/null)"
step close_helpers "$(jq -cn --argjson have "$([ -x "$TEAM_SH" ] && echo true || echo false)" \
  --argjson c "$(grep -c '^closed ' <<<"$HELPERS")" --argjson k "$(grep -c '^kept ' <<<"$HELPERS")" \
  '{tool:$have, closed:$c, kept:$k}')"

# ── 3d) /exit 직전 한가함 다시 — 배경 셸을 죽이면 그 알림이 전임에게 새 턴을 연다 ──
#    ⭐ 실측 2026-10-27(ⓐ 교대 `…111035Z`): await_idle 11:09:34 통과 → kill_bg_shells 11:09:35 →
#    「Background command … failed」 알림 턴 11:09:35~41 → `/exit` 11:09:40 접수(바쁜 중) →
#    초안 물음에서 Esc 가 먹지 않았다(위 answer_exit_prompts 머리말).
if ! await_idle "${ROTATE_IDLE_WAIT:-300}"; then
  await_step false await_idle_before_exit
  finish 0 "/exit 직전 세션이 한가해지지 않았다 — 배경 셸 정리 뒤 턴이 끝나지 않는다"
fi
await_step true await_idle_before_exit

# ── 3e) 셸 없는 터미널 — `/exit` 전에 같은 스페이스(·탭)에 셸 터미널을 연다 ──────────
#    `/exit` 하면 전임 터미널이 끝난다 → 산 터미널이 0 이 된 스페이스를 앱이 지운다(11-06 실측).
#    그래서 먼저 연다. argv 는 셸뿐(claude 를 넣지 않는다 — 후임은 아래 5단계가 그 셸에 친다).
#    --no-parent 필수: 이 유닛 환경의 HC_TERMINAL_ID 는 전임이라 기본 부모가 전임이 되어 같이 끝난다(11-06 측정).
#    라벨은 herdr.space·herdr.tab 만 넘긴다(where·herdr.seen 은 앱이 다시 쓴다). 둘 다 같으면 앱이 그 탭 오른쪽에 붙인다.
NEW_TERMINAL=""
if [ "$SHELLLESS" = 1 ]; then
  R="$("$HC" get "$TERMINAL" --json 2>/dev/null)"
  SPACE="$(printf '%s' "$R" | jq -r '.labels["herdr.space"] // ""' 2>/dev/null)"
  TAB="$(printf '%s' "$R" | jq -r '.labels["herdr.tab"] // ""' 2>/dev/null)"
  NCWD="$(printf '%s' "$R" | jq -r '.cwd // ""' 2>/dev/null)"   # 전임을 띄운 폴더 = 그 claude 의 프로젝트(메모리 자리)
  LBL=()
  [ -n "$SPACE" ] && LBL+=(--label "herdr.space=$SPACE")
  [ -n "$SPACE" ] && [ -n "$TAB" ] && LBL+=(--label "herdr.tab=$TAB")
  NEW_TERMINAL="$("$HC" run --bg --json --no-parent --keep --no-notify ${NCWD:+--cwd "$NCWD"} "${LBL[@]}" \
                  -- env PATH="$PATH" bash 2>/dev/null | jq -r '.address // ""' 2>/dev/null)"
  NS=""
  if [ -n "$NEW_TERMINAL" ]; then
    for i in $(seq 1 10); do
      NS="$(TERMINAL="$NEW_TERMINAL" agent_state)"; [ "$(f_state "$NS")" = "absent" ] && break; sleep 1
    done
  fi
  step open_shell_terminal "$(jq -cn --arg a "$NEW_TERMINAL" --arg sp "$SPACE" --arg tb "$TAB" --arg cwd "$NCWD" \
                               --arg st "$(f_state "$NS")" '{address:$a, space:$sp, tab:$tb, cwd:$cwd, state:$st}')"
  if [ "$(f_state "$NS")" != "absent" ]; then
    [ -n "$NEW_TERMINAL" ] && { "$HC" kill "$NEW_TERMINAL" >/dev/null 2>&1; "$HC" rm "$NEW_TERMINAL" >/dev/null 2>&1; }
    finish 0 "셸 터미널을 열지 못했다(주소=${NEW_TERMINAL:-없음} state=$(f_state "$NS")) — /exit 를 보내지 않았다"
  fi
fi

# /exit 는 화면 확인을 하지 않는다 — 들어갔는지는 아래 소멸 대기(관측된 부재)가 판정한다.
pty_line "/exit" ""; PR=$?
step send_exit "$(pty_step_json "$PR" "$(jq -cn '{method:"hc send(붙여 넣기+Enter)"}')")"
if [ "$PR" != "0" ]; then
  # 전임이 그대로 있다 — 방금 연 빈 셸 터미널은 치운다
  [ -n "$NEW_TERMINAL" ] && { "$HC" kill "$NEW_TERMINAL" >/dev/null 2>&1; "$HC" rm "$NEW_TERMINAL" >/dev/null 2>&1; }
  finish 0 "hc send 실패 rc=$PR — /exit 를 보내지 못했다"
fi

answer_exit_prompts
step exit_prompt "$(exit_prompts_json)"

# ── 4) 소멸 대기 — **관측된 부재만** 소멸이다 ───────────────────────────
#    셸 없는 터미널은 «끝남» 이 곧 소멸이지만, 끝난 까닭이 `/exit` 인지도 가른다:
#      reason=exited → /exit 로 끝났다(GONE=1).  그 밖(killed 등) → 후임을 띄우면 사람이 닫은 것을 되살린다(GONE=0).
GONE=0; WAITED=0; UNK=0; EXIT_REASON=""
while [ "$WAITED" -lt "$EXIT_WAIT" ]; do
  sleep 3; WAITED=$((WAITED+3))
  # 셸 없는 터미널: 셸 프롬프트로 돌아올 데가 없다 — «터미널이 끝남(hc 가 답한 finished)» 이 «관측된 부재» 다.
  if [ "$SHELLLESS" = 1 ] && EXIT_REASON="$(term_finished "$TERMINAL")"; then
    [ "$EXIT_REASON" = "exited" ] && GONE=1
    break   # 까닭이 exited 든 아니든 끝났다 — 더 기다리지 않는다
  fi
  EXIT_REASON=""
  C="$(agent_state)"; CS="$(f_state "$C")"
  [ "$CS" = "unknown" ] && { UNK=$((UNK+1)); continue; }
  if [ "$CS" = "absent" ]; then GONE=1; break; fi
  if [ "$(f_sess "$C")" != "$SESSION" ]; then
    # 다른 세션이 이미 앉았다 = 내가 만든 상태가 아니다. 그 위에 또 띄우지 않는다(검수 2-결함3 후단).
    step await_gone "$(jq -cn --argjson w "$WAITED" --arg other "$(f_sess "$C")" --arg r "$EXIT_REASON" '{gone:false, waited_s:$w, reason:$r, other_occupant:$other}')"
    finish 0 "다른 세션이 터미널을 점유했다($(f_sess "$C")) — 재기동하지 않는다${NEW_TERMINAL:+ · 새 셸 터미널 $NEW_TERMINAL 은 남겼다(스페이스 보존)}"
  fi
done
step await_gone "$(jq -cn --argjson g "$GONE" --argjson w "$WAITED" --argjson u "$UNK" --arg r "$EXIT_REASON" \
  '{gone:($g==1), waited_s:$w, reason:$r, unknown_polls:$u}')"
if [ -n "$EXIT_REASON" ] && [ "$EXIT_REASON" != "exited" ]; then
  finish 0 "전임이 /exit 말고 다른 까닭($EXIT_REASON)으로 끝났다 — 후임을 띄우지 않는다 · 새 셸 터미널 $NEW_TERMINAL 은 남겼다(스페이스 보존)"
fi
[ "$GONE" = "1" ] || finish 0 "${EXIT_WAIT}s 안에 관측된 소멸 없음(조회불능 ${UNK}회) — 전임 생존으로 본다. 신호로 승격하지 않는다${NEW_TERMINAL:+ · 새 셸 터미널 $NEW_TERMINAL 은 남겼다(스페이스 보존)}"

# ── 4b) 셸 없는 터미널 — 후임 자리를 새 셸 터미널로 옮긴다 ─────────────────
#    일하던 도우미(3c 가 남긴 것)는 --outlive-parent 로 떠서 전임이 끝나도 산다 → team.sh 목록(터미널 주소로 묶임)을
#    새 터미널 앞으로 넘겨 후임이 `team.sh ls`·`ask` 로 이어받게 한다(11-06).
#    HC_TERMINAL_ID 를 지운다 — 전임 주소를 단 채 남의 터미널에 보내면 `/goal` 이 `<hc from=…>` 꼬리표 붙은 메시지가 되어
#    명령으로 돌지 않는다(herdr-team §0 «꼬리표 없이: env -u HC_TERMINAL_ID» · 10-30 실측).
if [ "$SHELLLESS" = 1 ]; then
  # 인계 실패를 버리지 않는다 — rc·stderr 를 받아 감사에 싣고, 실패면 후임은 띄우되 그 사실을 끝 줄에 남긴다.
  #   (stderr 는 임시 파일 — 끝나면 지운다. 도구가 없으면 rc=null.)
  HANDED=""; H_RC="-1"; H_ERR=""
  if [ -x "$TEAM_SH" ]; then
    H_ERRF="$(mktemp)" || H_ERRF=""
    HANDED="$(HC_TERMINAL_ID="$TERMINAL" HC_BIN="$HC" "$TEAM_SH" handover "$NEW_TERMINAL" 2>${H_ERRF:-/dev/null})"; H_RC=$?
    [ -n "$H_ERRF" ] && { H_ERR="$(head -c 300 "$H_ERRF")"; rm -f "$H_ERRF"; }
  fi
  HJ="[]"
  while read -r _ hn ha; do
    [ -n "$ha" ] || continue
    HJ="$(jq -c --arg n "$hn" --arg a "$ha" --arg st "$("$HC" get "$ha" --json 2>/dev/null | jq -r '.state // "unknown"')" \
          '. + [{name:$n, addr:$a, state:$st}]' <<<"$HJ")"
  done < <(grep '^handed ' <<<"$HANDED")
  step handover_helpers "$(jq -cn --argjson have "$([ -x "$TEAM_SH" ] && echo true || echo false)" --argjson h "$HJ" \
                            --arg to "$NEW_TERMINAL" --argjson rc "$H_RC" --arg err "$H_ERR" \
                            '{tool:$have, to:$to, rc:(if $rc<0 then null else $rc end), ok:($have and $rc==0), err:$err, handed:$h}')"
  if [ -x "$TEAM_SH" ] && [ "$H_RC" != "0" ]; then
    HANDOVER_WARN="⚠ 도우미 인계 실패(rc $H_RC) — 도우미는 살아 있을 수 있음 · hc ls 로 찾아 team.sh 목록에 손으로"
  fi
  TERMINAL="$NEW_TERMINAL"; unset HC_TERMINAL_ID
fi
TO_TERMINAL="$TERMINAL"

# ── 4b) 도구 업데이트 — 후임을 띄우기 전에 깔린 CLI(claude·codex·agy·grok·opencode)에 새 판이 있으면 올린다 ──
#    update-clis.sh(herdr-team)가 한 종류에 한 줄을 낸다. 실패·시한이어도 진행한다(감사에 줄을 남긴다). 끄기 ROTATE_UPDATE=0.
UPDATE_SH="${ROTATE_UPDATE_SH:-$(dirname "$TEAM_SH")/update-clis.sh}"
if [ "${ROTATE_UPDATE:-1}" != 0 ] && [ -x "$UPDATE_SH" ]; then
  UPD="$("$UPDATE_SH" 2>&1)"
  step update_clis "$(jq -cn --arg out "$UPD" '{ran:true, lines:($out | split("\n") | map(select(length > 0)))}')"
else
  step update_clis "$(jq -cn --arg p "$UPDATE_SH" '{ran:false, why:"ROTATE_UPDATE=0 이거나 update-clis.sh 가 없다", path:$p}')"
fi

# ── 5) 재기동 — 셸로 돌아온 이 터미널에 `claude` 를 친다 ──────────────
#    옛 herdr `agent start` 자리. hc 에는 «에이전트 띄우기» 가 없다 — 터미널의 셸에 명령을 보낸다.
#    떴다 = 앞쪽이 claude · 새 세션(세션 파일) · 상태 보고(idle|done). rc 가 아니라 관측으로 판정한다.
#    ⛔ 다시 치는 것은 앞쪽이 여전히 셸일 때만 — claude 가 떠 있는데 또 치면 그 입력칸에 들어간다(두 개가 뜨는 것과 같은 부류).
STARTED=0
for i in $(seq 1 "$START_TRIES"); do
  N="$(agent_state)"; RC=-1
  if [ "$(f_state "$N")" = "absent" ]; then "$HC" send "$TERMINAL" "claude" >/dev/null 2>&1; RC=$?; fi
  W=0
  while [ "$W" -lt "$START_TMO" ]; do
    sleep 3; W=$((W+3))
    N="$(agent_state)"
    if [ "$(f_state "$N")" = "present" ] && [ "$(f_sess "$N")" != "$SESSION" ]; then
      case "$(printf '%s' "$N" | cut -f4)" in idle|done) STARTED=1; break ;; esac
    fi
  done
  step agent_start "$(jq -cn --argjson i "$i" --argjson rc "$RC" --arg st "$(f_state "$N")" \
                       --arg se "$(f_sess "$N")" --argjson w "$W" '{attempt:$i, rc:$rc, state:$st, session:$se, waited_s:$w}')"
  [ "$STARTED" = "1" ] && { TO_SESSION="$(f_sess "$N")"; break; }
done
[ "$STARTED" = "1" ] || finish 0 "⚠⚠ 재기동 ${START_TRIES}회 실패 — 터미널에 claude 가 없거나 상태를 안 보냈다. 사람이 직접 띄워야 한다"

# ── 6) 목표 재무장 — 내용이 아니라 «무엇을 계속할지» 만 준다 ────────────
await_idle 120 || true          # 후임 기동 직후 잠깐 바쁠 수 있다(바쁘면 /goal 은 줄에 선다)
# 보내기 직전에 그 후임이 아직 앞쪽인지 본다 — 끝났거나 다른 프로그램이 앉았으면 보내지 않는다(codex 검수 10-30).
N="$(agent_state)"
if [ "$(f_state "$N")" != "present" ] || [ "$(f_sess "$N")" != "$TO_SESSION" ]; then
  step rearm_goal "$(jq -cn --arg st "$(f_state "$N")" --arg se "$(f_sess "$N")" '{rc:-1, state:$st, session:$se, sent:false}')"
  finish 0 "후임이 앞쪽에 없다(state=$(f_state "$N")) — 목표를 보내지 않았다"
fi
if [ -z "$GOAL" ]; then
  step rearm_goal "$(jq -cn '{sent:false, why:"--goal 없음 — 후임은 메모리·프로젝트 문서로 이어 받는다"}')"
  finish 1 "$HANDOVER_WARN"
fi
# ⭐ 대체 문면 `Pasted text` 는 **이 호출에만** — 목표는 회차마다 길어져 접힘이 기본값이다
pty_line "/goal $GOAL" "/goal" "Pasted text"; PR=$?
step rearm_goal "$(pty_step_json "$PR" "$(jq -cn --arg goal "$GOAL" '{goal:$goal}')")"
[ "$PR" != "0" ] && finish 0 "목표 재무장 실패 rc=$PR (1=보내지 못함 · 2=보냈는데 화면에서 못 봄 · 후임은 떠 있다)"

finish 1 "$HANDOVER_WARN"
