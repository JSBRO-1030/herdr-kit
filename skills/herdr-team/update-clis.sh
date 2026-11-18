#!/usr/bin/env bash
# update-clis.sh — 깔린 도우미 CLI 를 새 판이 있으면 올린다. team.sh spawn(그 종류만)과 session-rotate(전부)가 부른다.
#   update-clis.sh [--force] [종류…]      종류 = claude codex agy grok opencode (안 주면 깔린 것 전부)
#
# 한 종류에 한 줄(stdout):
#   updated <종류> <전> → <후>          PATH 의 그 CLI 판이 바뀌었다
#   same    <종류> <판>                  새 판이 없다(또는 올렸는데 PATH 판이 그대로라 아래 stale)
#   stale   <종류> <PATH 판> · 새 판 <판> <자리> — …   새 판이 다른 자리에 깔렸고 PATH 자리에 쓸 수 없다
#   skip    <종류> <까닭>                없음 · 건너뛸 자리 · 최근에 확인함(간격 안)
#   fail    <종류> rc=<n> <로그>         업데이트 명령이 실패했다(시한 초과 rc=124)
# 언제나 종료 코드 0 — 업데이트가 안 돼도 띄우기·교대는 진행한다.
#
# 설정(파일 ~/.config/herdr-team/update.conf 의 «키=값» 줄 · 같은 이름의 환경 변수가 앞선다):
#   enabled=1          HERDR_UPDATE           0 이면 아무것도 안 한다
#   every=3600         HERDR_UPDATE_EVERY     같은 종류를 다시 확인할 간격(초) · --force 면 무시
#   timeout=180        HERDR_UPDATE_TIMEOUT   업데이트 명령 하나의 시한(초)
#   skip_prefixes=     HERDR_UPDATE_SKIP_PREFIXES   «:» 로 나눈 폴더 — 실제 파일이 그 안에 있는 CLI 는 건드리지 않는다
#   sudo=0             HERDR_UPDATE_SUDO      1 이면 stale 일 때 새 판을 PATH 자리에 sudo -n 으로 바꿔 끼운다(쓸 수 없는 자리만)
# 업데이트 명령(각 CLI 의 것): claude update · codex update · agy update · grok update · opencode upgrade
set -uo pipefail

KINDS="claude codex agy grok opencode"
CONF="${HERDR_UPDATE_CONF:-$HOME/.config/herdr-team/update.conf}"
DIR="${HERDR_TEAM_DIR:-$HOME/.cache/herdr-team}/update"
mkdir -p "$DIR" 2>/dev/null || { echo "skip all 기록 폴더를 못 만든다($DIR)"; exit 0; }

conf() {  # conf <키> <환경 변수> <기본> — 환경 변수 › 설정 파일 › 기본
  local v="${!2:-}"
  if [ -z "$v" ] && [ -f "$CONF" ]; then v="$(awk -F= -v k="$1" '$0 !~ /^[[:space:]]*#/ && $1==k {sub(/^[^=]*=/, ""); print; exit}' "$CONF")"; fi
  printf '%s' "${v:-$3}"
}
ENABLED="$(conf enabled HERDR_UPDATE 1)"
EVERY="$(conf every HERDR_UPDATE_EVERY 3600)"
TMO="$(conf timeout HERDR_UPDATE_TIMEOUT 180)"
SKIPS="$(conf skip_prefixes HERDR_UPDATE_SKIP_PREFIXES "")"
SUDO="$(conf sudo HERDR_UPDATE_SUDO 0)"

FORCE=0; want=()
for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;;
    claude|codex|agy|grok|opencode) want+=("$a") ;;
    *) echo "skip $a 모르는 종류(${KINDS// /·})"; ;;
  esac
done
[ ${#want[@]} -gt 0 ] || read -r -a want <<<"$KINDS"
[ "$ENABLED" = 0 ] && { for k in "${want[@]}"; do echo "skip $k 꺼 둠(enabled=0)"; done; exit 0; }

ver() { timeout 15 "$1" --version </dev/null 2>/dev/null | head -1 | tr -s ' ' | cut -c1-60 || true; }
upd_cmd() { case "$1" in opencode) echo "opencode upgrade" ;; *) echo "$1 update" ;; esac; }

# 여러 띄우기·교대가 한꺼번에 올리지 않게 — 기다리다 못 잡으면 이번에는 건너뛴다
exec 9>"$DIR/.lock"
flock -w "$((TMO + 30))" 9 || { for k in "${want[@]}"; do echo "skip $k 다른 업데이트가 아직 돈다"; done; exit 0; }

for k in "${want[@]}"; do
  bin="$(command -v "$k" 2>/dev/null)" || { echo "skip $k 없음"; continue; }
  real="$(readlink -f "$bin")"
  hit=""; IFS=: read -r -a pre <<<"$SKIPS"
  for p in "${pre[@]}"; do [ -n "$p" ] && case "$real" in "${p%/}"/*) hit="$p" ;; esac; done
  [ -n "$hit" ] && { echo "skip $k 건너뛸 자리($real · skip_prefixes $hit)"; continue; }
  st="$DIR/$k.stamp"
  if [ "$FORCE" = 0 ] && [ -f "$st" ] && [ $(( $(date +%s) - $(stat -c %Y "$st") )) -lt "$EVERY" ]; then
    echo "skip $k 최근에 확인함($(( ($(date +%s) - $(stat -c %Y "$st")) / 60 ))분 전 · 간격 ${EVERY}초)"; continue
  fi
  before="$(ver "$k")"; log="$DIR/$k.log"
  # shellcheck disable=SC2046
  (cd /tmp && timeout "$TMO" $(upd_cmd "$k") </dev/null >"$log" 2>&1); rc=$?
  touch "$st"
  hash -r; after="$(ver "$k")"
  if [ "$rc" != 0 ]; then echo "fail $k rc=$rc $log"; continue; fi
  if [ -n "$after" ] && [ "$after" != "$before" ]; then echo "updated $k $before → $after"; continue; fi
  # PATH 판이 그대로다. 새 판이 사용자 자리(~/.<종류>/bin · ~/.local/bin)에 깔렸으면 stale 로 알리고, 허락됐으면 바꿔 끼운다.
  new=""; for c in "$HOME/.$k/bin/$k" "$HOME/.local/bin/$k"; do
    [ -x "$c" ] && [ "$(readlink -f "$c")" != "$real" ] && [ -n "$(ver "$c")" ] && [ "$(ver "$c")" != "$before" ] && { new="$c"; break; }
  done
  if [ -z "$new" ]; then echo "same $k ${after:-$before}"; continue; fi
  nv="$(ver "$new")"
  if [ -w "$(dirname "$real")" ]; then
    echo "stale $k ${before} · 새 판 $nv $new — PATH 앞쪽 $bin 이 옛 판이다(PATH 순서를 바꾸거나 그 파일을 지운다)"; continue
  fi
  if [ "$SUDO" = 1 ] && sudo -n true 2>/dev/null; then
    tmp="$(dirname "$real")/.$k.herdr-update.$$"
    if sudo -n install -m 755 "$new" "$tmp" && sudo -n mv -f "$tmp" "$real"; then
      hash -r; after="$(ver "$k")"; echo "updated $k $before → $after (새 판 $new 를 sudo 로 $real 에 바꿔 끼움)"
    else
      sudo -n rm -f "$tmp" 2>/dev/null; echo "fail $k rc=sudo 바꿔 끼우기 실패($new → $real)"
    fi
  else
    echo "stale $k ${before} · 새 판 $nv $new — $real 에 쓸 수 없다(설정 sudo=1 이면 바꿔 끼운다 · 아니면 그 자리 주인이 올린다)"
  fi
done
exit 0
