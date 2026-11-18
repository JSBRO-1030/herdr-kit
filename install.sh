#!/usr/bin/env bash
# herdr-option 설치기 — 원격 리눅스 상자(herdr-core 가 도는 곳)의 Claude Code 에 세트를 깐다.
#   bash install.sh [--dry-run] [--no-claude-md] [--no-statusline] [--replace-statusline]
#
# 하는 일(여러 번 돌려도 같다):
#   1. 필요한 것 확인 — hc · claude · python3 · jq (없으면 알린다 · claude·python3 이 없으면 멈춘다)
#   2. 스킬 셋을 ~/.claude/skills/ 에 이 저장소를 가리키는 링크로 — herdr-team · herdr-open · session-rotate
#   3. 껍데기 에이전트를 ~/.claude/agents/ 에 — 깔린 CLI(agy · grok · opencode) 것만
#   4. 상태줄 — settings.json 에 statusLine 이 없을 때만(있으면 --replace-statusline 일 때만 바꾼다 · 사본을 남긴다)
#   5. ~/.claude/CLAUDE.md 에 핵심 규칙 블록(claude/CLAUDE.md) — 표시선 사이만 넣거나 바꾼다(--no-claude-md 로 건너뜀)
#   6. team.sh doctor 로 쓸 수 있는 도우미를 보인다
# 이미 있는 남의 스킬·에이전트 파일(이 저장소 링크가 아닌 것)은 건드리지 않고 «건너뜀»으로 알린다.
# 지우기: README.md «지우기».
set -euo pipefail

REPO=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
DRY=0; CLAUDE_MD=1; STATUS=1; REPLACE_STATUS=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --no-claude-md) CLAUDE_MD=0 ;;
    --no-statusline) STATUS=0 ;;
    --replace-statusline) REPLACE_STATUS=1 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "모르는 옵션: $a" >&2; sed -n '2,3p' "$0" >&2; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }
do_() { if [ "$DRY" = 1 ]; then say "  (dry-run) $*"; else "$@"; fi; }
STAMP=$(date +%Y%m%d-%H%M%S)

say "== herdr-option 설치 ($REPO → $CLAUDE_DIR)$([ "$DRY" = 1 ] && echo ' · dry-run')"

# 1. 필요한 것
miss=0
for b in claude python3; do command -v "$b" >/dev/null || { say "missing $b — 먼저 깔아야 한다"; miss=1; }; done
[ "$miss" = 0 ] || exit 1
command -v hc >/dev/null || [ -x "$HOME/.local/bin/hc" ] || say "missing hc — herdr-core 가 없다. herdr-team·session-rotate·herdr-open 은 hc 터미널 안에서만 돈다"
command -v jq >/dev/null || say "missing jq — session-rotate 가 쓴다(apt install jq)"
command -v node >/dev/null || say "missing node — Herdr 앱 html-viewer 가 이 상자 문서를 그릴 때 쓴다(herdr-open)"

# 2. 스킬 — 링크
do_ mkdir -p "$CLAUDE_DIR/skills" "$CLAUDE_DIR/agents"
link() {  # link <원본> <자리>
  local src="$1" dst="$2"
  if [ -L "$dst" ] && [ "$(readlink -f "$dst")" = "$(readlink -f "$src")" ]; then say "same    $dst"; return 0; fi
  if [ -e "$dst" ] || [ -L "$dst" ]; then say "건너뜀  $dst — 이미 있다(이 저장소 것이 아님 · 지우거나 옮긴 뒤 다시)"; return 0; fi
  do_ ln -s "$src" "$dst"; say "linked  $dst → $src"
}
for s in herdr-team herdr-open session-rotate; do link "$REPO/skills/$s" "$CLAUDE_DIR/skills/$s"; done

# 3. 껍데기 에이전트 — 깔린 CLI 것만
for pair in agy:agy-worker grok:grok-worker opencode:opencode-worker-free; do
  cli=${pair%%:*}; agent=${pair#*:}
  if command -v "$cli" >/dev/null; then link "$REPO/agents/$agent.md" "$CLAUDE_DIR/agents/$agent.md"
  else say "없음    $cli — $agent 에이전트는 넣지 않았다(깔고 다시 돌리면 들어간다)"; fi
done

# 4. 상태줄
SETTINGS="$CLAUDE_DIR/settings.json"
if [ "$STATUS" = 1 ]; then
  # 경로에 공백·따옴표가 있어도 상태줄 명령이 깨지지 않게 POSIX 셸 인용으로 싼다
  STATUS_CMD="python3 $(python3 -I -c 'import shlex,sys; print(shlex.quote(sys.argv[1]))' "$REPO/statusline/statusline.py")"
  cur=""; bad=""
  if [ -f "$SETTINGS" ]; then
    cur=$(python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(((d.get("statusLine") or {}) if isinstance(d, dict) else {}).get("command",""))' "$SETTINGS" 2>/dev/null) \
      || bad="$SETTINGS 를 읽을 수 없다(JSON 이 아니거나 권한) — 고친 뒤 다시 돌린다"
  fi
  if [ -n "$bad" ]; then say "건너뜀  statusLine — $bad"
  elif [ -e "$SETTINGS" ] && [ ! -w "$SETTINGS" ]; then say "건너뜀  statusLine — $SETTINGS 에 쓸 수 없다"
  elif [ "$cur" = "$STATUS_CMD" ]; then say "same    statusLine"
  elif [ -n "$cur" ] && [ "$REPLACE_STATUS" != 1 ]; then say "건너뜀  statusLine — 이미 다른 상태줄이 있다($cur) · 바꾸려면 --replace-statusline"
  elif [ "$DRY" = 1 ]; then say "  (dry-run) statusLine → $STATUS_CMD"
  else
    [ -f "$SETTINGS" ] && cp -p "$SETTINGS" "$SETTINGS.bak-herdr-option-$STAMP"
    python3 -I - "$SETTINGS" "$STATUS_CMD" <<'PY'
import json, os, sys, tempfile
path, cmd = sys.argv[1], sys.argv[2]
d = json.load(open(path)) if os.path.exists(path) else {}
d["statusLine"] = {"type": "command", "command": cmd, "padding": 0, "refreshInterval": 1000}
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path) or ".", prefix=".settings.", suffix=".tmp")
with os.fdopen(fd, "w") as f:
    json.dump(d, f, indent=2, ensure_ascii=False); f.write("\n")
os.replace(tmp, path)
PY
    say "set     statusLine → $STATUS_CMD$([ -f "$SETTINGS.bak-herdr-option-$STAMP" ] && echo " (사본 $SETTINGS.bak-herdr-option-$STAMP)")"
  fi
fi

# 5. CLAUDE.md 블록
if [ "$CLAUDE_MD" = 1 ]; then
  MD="$CLAUDE_DIR/CLAUDE.md"
  r=$(python3 -I - "$MD" "$REPO/claude/CLAUDE.md" "$DRY" "$STAMP" 2>&1 <<'PY'
import os, re, shutil, sys
md, src, dry, stamp = sys.argv[1], sys.argv[2], sys.argv[3] == "1", sys.argv[4]
block = open(src).read().strip() + "\n"
old = open(md).read() if os.path.exists(md) else ""
pat = re.compile(r"<!-- herdr-option:begin.*?<!-- herdr-option:end -->\n?", re.S)
if pat.search(old):
    new = pat.sub(lambda m: block, old, count=1)
else:
    new = old + ("" if not old or old.endswith("\n\n") else ("\n" if old.endswith("\n") else "\n\n")) + block
if new == old:
    print("same"); sys.exit()
if not dry:
    if old:
        shutil.copy2(md, f"{md}.bak-herdr-option-{stamp}")
    tmp = md + ".herdr-option-tmp"
    open(tmp, "w").write(new); os.replace(tmp, md)
print("updated" if pat.search(old) else "added")
PY
) || r="error $(printf '%s' "$r" | tail -1)"
  case "$r" in
    same) say "same    $MD (herdr-option 블록)" ;;
    error*) say "건너뜀  $MD — 읽거나 쓰지 못했다(${r#error }) · 원래 파일은 그대로다" ;;
    *) say "$([ "$DRY" = 1 ] && echo '  (dry-run) ')$r $MD (herdr-option 블록 · 표시선 밖은 그대로)" ;;
  esac
fi

# 6. 쓸 수 있는 도우미
say "== team.sh doctor"
"$REPO/skills/herdr-team/team.sh" doctor || true
say "== 끝. Mac 쪽(files-plus mod): sh $REPO/mods/install-mac.sh  ·  안내: $REPO/README.md"
