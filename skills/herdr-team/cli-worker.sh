#!/bin/bash
# cli-worker — grok · agy · opencode 를 화면 없이 한 번 부른다(깔린 것만 · team.sh doctor). Claude 껍데기 에이전트(~/.claude/agents/*-worker*.md)가 쓴다(오너 2026-10-23).
#   cli-worker.sh <grok|agy|opencode> [--write] [--dir <폴더>] [--model <모델>] [--file <경로>]...  < 지시(표준 입력)
# 기본은 읽기 전용: grok --permission-mode plan · opencode --agent plan · agy 는 빈 임시 폴더에서 --file 내용을 지시에 실어 보낸다.
# --write 는 지시에 고칠 폴더가 있을 때만: grok --always-approve · opencode --auto · agy --dangerously-skip-permissions (모두 --dir 에서).
# 실측 2026-10-23(빈 폴더 · a.txt 읽기 · b.txt 만들기):
#   플래그가 없으면 셋 다 파일을 쓴다 · grok·opencode 는 plan 이면 읽기만 된다 · agy 는 plan 이면 계획서만 내고,
#   플래그가 없으면 셸 명령을 고를 때 권한을 못 물어 읽기가 2번 중 1번만 된다 · agy 는 표준 입력을 글로 받지 않는다 ·
#   인자 하나는 128KB 상한(110KB 를 실어 11초에 끝 줄까지 읽음).
# 시한(rc 124)이나 크기 상한에 걸리면 같은 지시를 Herdr 탭(team.sh spawn + ask · hc 터미널)으로 넘긴다 — 배경으로 띄우고 바로 돌아온다
#   (오너 10-23 «1차로 해서 안되면 탭에 띄워서 전달» · grok 540초 시한에 두 번 끊김). hc 리드 터미널 안일 때만(도우미 안이면 안 넘김).
set -u
cli=${1:-}; shift || true
write=0; dir=$PWD; model=""; files=()
while [ $# -gt 0 ]; do
  case $1 in
    --write) write=1; shift ;;
    --dir) dir=${2:?}; shift 2 ;;
    --model) model=${2:?}; shift 2 ;;
    --file) files+=("${2:?}"); shift 2 ;;
    *) echo "모르는 인자: $1" >&2; exit 2 ;;
  esac
done
case $cli in grok|agy|opencode) ;; *) echo "usage: cli-worker.sh <grok|agy|opencode> [--write] [--dir D] [--model M] [--file F]... < 지시" >&2; exit 2 ;; esac
command -v "$cli" >/dev/null || { echo "[cli-worker $cli 가 이 상자에 없다(PATH) — 깔린 것은 team.sh doctor 로 본다. 다른 일꾼을 고르라]" >&2; exit 2; }
task=$(cat)
[ -n "${task//[[:space:]]/}" ] || { echo "지시가 비었다(표준 입력)" >&2; exit 2; }
orig=$task
[ -d "$dir" ] || { echo "폴더 없음: $dir" >&2; exit 2; }
for f in "${files[@]}"; do [ -f "$f" ] || { echo "파일 없음: $f" >&2; exit 2; }; done
T=${CLI_WORKER_TIMEOUT:-540}   # 껍데기의 Bash 한 번(최대 600초) 안에 끝나게
MAX=120000
# 크기는 바이트로 센다 — ${#v} 는 글자 수라 한글 222,520바이트가 102,908 로 재져 상한을 통과했고
#   agy 가 «Argument list too long»(rc 126)으로 죽어 탭으로도 안 넘어갔다(11-04 껍데기 시험).
nbytes() { printf %s "$1" | wc -c; }
mode=$([ $write = 1 ] && echo write || echo read)
s=$(date +%s)
strip() { sed 's/\x1b\[[0-9;]*[A-Za-z]//g'; }

# to_tab <까닭> — 같은 지시(원문 + 파일 경로 + 모드 한 줄)를 Herdr 탭으로 넘긴다. spawn·ask 는 배경에서 돈다
# (껍데기의 Bash 한 번은 600초이고 1차 시도가 540초를 먹었다). 로그 끝 줄 «[탭 넘김 끝 rc=…]» 이 끝 표시다.
to_tab() {
  if [ -z "${HC_TERMINAL_ID:-}" ] || [ "${HERDR_TEAM_HELPER:-}" = 1 ]; then
    echo "[$1 — hc 리드 터미널 밖(또는 도우미 안)이라 탭으로 넘기지 않았다. 도우미 안이면 네 CLI 의 하위 에이전트로 나눠라]"; return 0
  fi
  local name d tf log targs=()
  name="$cli-$(date +%H%M%S)"; d="${HERDR_TEAM_DIR:-$HOME/.cache/herdr-team}"; mkdir -p "$d"
  tf="$d/$name-task.md"; log="$d/$name-handoff.log"
  {
    printf '%s\n' "$orig"
    if [ ${#files[@]} -gt 0 ]; then printf '\n읽을 파일:\n'; for f in "${files[@]}"; do printf -- '- %s\n' "$(realpath "$f")"; done; fi
    if [ $write = 1 ]; then printf '\n고치기: %s 안만 고쳐도 된다.\n' "$dir"
    else printf '\n읽기 전용: 결과 파일 말고는 아무 파일도 만들거나 고치지 마라.\n'; fi
  } >"$tf"
  case $cli in  # 확인한 띄우기 인자만(SKILL.md) — opencode 는 mini -m 이 있어야 뜬다
    opencode) targs=(mini -m "${model:-opencode/beam-free}") ;;
    grok) [ -n "$model" ] && targs=(-m "$model") ;;
    agy) [ -n "$model" ] && targs=(--model "$model") ;;
  esac
  # 재방향은 묶음 전체에 — `( cd && setsid … >로그 & )` 꼴은 배경 셸이 원래 출력 파이프를 쥔 채 spawn·ask 를 기다려
  # 껍데기의 Bash 가 그만큼 붙잡혔다(가짜 team.sh 20초×2 → 44초 · 10-23 실측)
  (cd "$dir" && exec setsid nohup bash -c 't=$1; n=$2; k=$3; f=$4; l=$5; shift 5
    "$t" spawn "$n" "$k" -- "$@" && "$t" ask "$n" "@$f" "$l"; echo "[탭 넘김 끝 rc=$?]"' \
    _ "$TEAM" "$name" "$cli" "$tf" "$TL" "${targs[@]}") >"$log" 2>&1 </dev/null &
  echo "[$1 → 같은 지시를 Herdr 탭 $name 으로 넘겼다(배경 · 시한 ${TL}초). 같은 지시를 다시 보내지 마라]"
  # 기다리기에도 시한을 건다(교대 규약 «대기 루프는 시한 필수») — ask 시한 + 여유 120초 · 끝 코드(시한 124)를 살린다.
  # 경로는 %q 로 — HERDR_TEAM_DIR 에 공백·따옴표가 있어도 복사한 명령이 그대로 돈다(codex 검수 11-03).
  local ql qt; printf -v ql '%q' "$log"; printf -v qt '%q' "$TEAM"
  echo "[기다리기(Bash run_in_background 로): timeout $((TL+120)) bash -c 'until grep -q \"^\\[탭 넘김 끝\" \"\$1\"; do sleep 5; done' _ $ql; r=\$?; tail -6 $ql; exit \$r]"
  echo "[로그의 «ok $name <결과 파일>» 줄이 결과다. 받으면 탭을 닫아라: $qt close $name]"
}
TEAM=${CLI_WORKER_TEAM:-$HOME/.claude/skills/herdr-team/team.sh}
TL=${CLI_WORKER_TAB_LIMIT:-3600}

if [ ${#files[@]} -gt 0 ] && [ "$cli" != agy -o $write = 1 ]; then  # agy 읽기 밖에서는 경로만 알려 준다
  task+=$'\n\n읽을 파일:'; for f in "${files[@]}"; do task+=$'\n- '"$(realpath "$f")"; done
fi

case $cli in
  grok)
    pf=$(mktemp); printf '%s' "$task" > "$pf"
    args=(--prompt-file "$pf"); [ -n "$model" ] && args=(-m "$model" "${args[@]}")
    if [ $write = 1 ]; then args=(--always-approve "${args[@]}"); else args=(--permission-mode plan "${args[@]}"); fi
    (cd "$dir" && timeout "$T" grok "${args[@]}" </dev/null 2>&1); rc=$?
    rm -f "$pf" ;;
  opencode)
    n=$(nbytes "$task"); [ "$n" -le $MAX ] || { to_tab "지시가 ${n}바이트 — $MAX 넘음(인자 상한)"; exit 3; }
    args=(run -m "${model:-opencode/beam-free}"); if [ $write = 1 ]; then args+=(--auto); else args+=(--agent plan); fi
    (cd "$dir" && timeout "$T" opencode "${args[@]}" "$task" </dev/null 2>&1 | strip; exit "${PIPESTATUS[0]}"); rc=$? ;;
  agy)
    margs=(); [ -n "$model" ] && margs=(--model "$model")
    if [ $write = 1 ]; then
      n=$(nbytes "$task"); [ "$n" -le $MAX ] || { to_tab "지시가 ${n}바이트 — $MAX 넘음(인자 상한)"; exit 3; }
      (cd "$dir" && timeout "$T" agy "${margs[@]}" --dangerously-skip-permissions -p "$task" </dev/null 2>&1); rc=$?
    else
      # 머리말 + 파일 이름 표지(경로를 보이면 agy 가 그 파일을 셸로 열려다 거부당해 출력을 비운다 — 실측 2/2 · 이 꼴은 3/3)
      p="The full content of every file you need is already included below between BEGIN/END markers. Do not use any tools, do not open files, do not run commands. Answer only from the text in this message."$'\n\nTask: '"$task"
      for f in "${files[@]}"; do b=$(basename "$f"); p+=$'\n\n---BEGIN FILE '"$b"$'---\n'"$(cat "$f")"$'\n---END FILE '"$b"'---'; done
      n=$(nbytes "$p"); [ "$n" -le $MAX ] || { to_tab "지시+파일이 ${n}바이트 — $MAX 넘음(인자 상한)"; exit 3; }
      tmp=$(mktemp -d)
      out=$(cd "$tmp" && timeout "$T" agy "${margs[@]}" -p "$p" </dev/null 2>&1); rc=$?
      printf '%s\n' "$out"
      case $out in *"no output produced"*) echo "[agy 가 읽기 모드에서 도구를 쓰려다 거부당해 답을 비웠다 — 고치기 일이면 --write 와 --dir 로, 아니면 지시에서 파일 열기·쓰기 요구를 빼라]" ;; esac
      left=$(cd "$tmp" && find . -mindepth 1 | head -20)
      [ -n "$left" ] && printf '[agy 가 빈 폴더에 남긴 것(지웠다): %s]\n' "$(echo $left)"
      rm -rf "$tmp"
    fi ;;
esac
[ $rc = 124 ] && to_tab "시한 ${T}초를 넘겨 끊었다"
echo "[cli-worker $cli $mode rc=$rc $(( $(date +%s) - s ))s dir=$dir]"
exit $rc
