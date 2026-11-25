#!/bin/sh
# files-plus(파일+) 를 이 Mac 의 herdr 앱에 깔고 화면에 띄운다. 여러 번 돌려도 결과가 같다.
#   1. files-plus 폴더를 앱 mods/ 로 복사하고 `herdr-app check`
#   2. 지금 레이아웃(또는 인자로 준 이름)의 오른쪽 패널 스택 `panel-body` 에 files-plus 블록을 더한다(Files 바로 뒤)
#   3. 탭바 mod `auto-tabs`(tabs 복제본)가 있으면 «Files+» 패널 단추를 더한다 · check 가 떨어지면 되돌린다
#   4. 그 레이아웃이 지금 떠 있으면 패널을 files-plus 로 연다
#   (선택) --hide-files: auto-tabs 에서 기본 Files 단추를 뺀다(블록은 남겨 되돌릴 수 있다) · --show-files: 되돌린다
#   (선택) --panel-tabs: 위 일에 더해 mods/panel-tabs(패널 탭 줄)를 같은 방식으로 깔고(check · 사본 · 바꿔 끼우기 · 사본 폴더 .panel-tabs-backup/<시각>-<PID>) panel-body 스택에 header 를 더하거나 고친다(레이아웃은 블록과 함께 한 번만 저장).
#     header = {content:{mod:panel-tabs, props:{stack:panel-body, hideFiles:<bool>}}, height:32} · hideFiles = 같은 패처가 예측한 이번 실행 뒤 Files 상태(숨김=true · 보임=false · 변환 거절이면 현재 상태 · auto-tabs 없으면 false)
#     panel-body 에 panel-tabs 가 아닌 header 가 이미 있으면 아무것도 바꾸기 전에 거절한다 · Herdr 앱 0.1.17 이상만(header 꼴을 0.1.17 에서 확인) · 그 레이아웃이 떠 있으면 쓴 뒤 `herdr-app status` 의 errors 에 layouts/<이름>.json 오류가 생기는지 2초 본다(생기면 사본으로 되돌리고 실패 · 안 떠 있으면 검사 못 함을 알림).
#   (선택) --remove-panel-tabs: panel-body 의 header 가 panel-tabs 것일 때만 뺀다(사본 + 통째로 바꿔 끼우기). mod 를 복사하지 않고 auto-tabs · 패널 열기도 안 한다 · mods/panel-tabs 폴더는 그대로 둔다(place:none 이라 해가 없다) · --panel-tabs · --hide-files · --show-files 와 함께 못 쓴다.
#   (선택) --panel-tabs 의 M2(옮기기 · 닫기 · 「+」): Herdr 0.1.18 이상 **이고** 대상 레이아웃에 content.mod 가 auto-tabs 인 블록이 있을 때만 돈다(아니면 한 줄 알림 뒤 위 M1 그대로).
#     (a) kit 판 auto-tabs(저장소 mods/auto-tabs)로 바꿔 끼운다: 지금 폴더 통째 사본 .auto-tabs-backup/<시각>-<PID>/ → 숨긴 폴더 `herdr-app check` → 같은 게시 엔진. 관리 파일 = mod.json · main.js · owner.js · panels.js · names.js · config.js · win-*.svg · LICENSE-herdr-app (그 밖 파일은 그대로).
#         config.js 는 설치기가 만든다: names = 옛 main.js 에 syncNames 가 있으면 true(옛 main.js 가 kit 판이면 옛 config.js 의 names) · hideFiles = 위 예측(옛 필터 · 옛 kit config · --hide-files/--show-files).
#     (b) 레이아웃 work 열의 status 바로 앞(없으면 끝)에 아래 패널 스택 panel-bottom 을 더한다(우리 것이면 header props 만 맞춤 · 우리 것이 아니거나 work 열이 없으면 이 부분만 거절하고 M1 header 는 그대로 · 도구 id 가 panel-body 와 panel-bottom 양쪽에 있으면 아무것도 바꾸기 전에 거절). files-plus 블록은 레이아웃 어디에도 id 가 없을 때만 panel-body 에 더한다.
#     (c) 4단계는 files-plus 가 있는 쪽(panel 또는 panel-bottom)을 연다.
#     kit 판 auto-tabs 가 이미 깔려 있으면(첫 줄 `// herdr-kit auto-tabs 2`) 옛 단추·필터 패처는 건너뛰고 --hide-files/--show-files 는 config.js 와 두 스택 header 의 hideFiles 를 고친다(--panel-tabs 없이도).
#   --remove-panel-tabs 는 panel-bottom(우리 것)의 도구를 순서대로 panel-body 끝으로 옮기고(id 가 겹치면 쓰기 전에 거절) panel-bottom 을 지운 뒤 panel-body header 도 뺀다. kit 판 auto-tabs 는 그대로 두고 옛 판 사본 경로(.auto-tabs-backup 의 가장 새 것)를 알린다.
# 고치는 파일마다 먼저 사본을 둔다: layouts/<이름>.json.bak-files-plus-<시각>-<PID>(레이아웃 링크가 있는 폴더) · .main.js.bak-files-plus-<시각>-<PID>(실제 main.js 가 있는 폴더 = 보통 mods/auto-tabs/, main.js 가 링크면 링크가 가리키는 폴더)
# [주의] 앱이 mod 폴더의 낯선 파일을 읽는지 모른다 → 링크 대상 폴더(다른 체크아웃일 수 있음)에도 사본을 두는 대신 «실제로 쓰는 파일 옆» 에 둔다.
# 앱이 싣는 레이아웃(main · terminals · win98)은 고치지 않는다 — 앱이 다음 시작에 되돌린다. 복제본 이름을 준다.
# 심볼릭 링크: mods/files-plus 가 링크면 다른 체크아웃을 덮어쓰게 되므로 거절한다 · 레이아웃 파일·auto-tabs/main.js 가 링크면 링크가 가리키는 실제 파일에 쓴다(링크는 그대로).
# 파일 모드(0644 등)와 줄 끝(CRLF)은 그대로 둔다. 레이아웃 JSON 은 같은 폴더의 임시 파일 → os.replace 로 통째 바꿔 끼운다(쓰는 중 죽어도 원본 또는 새 파일 하나만 남는다 · 링크 대상 파일 모드/소유자 유지). 하드링크(link 수>1)면 inode 를 지키려고 제자리로 덮어쓴다. 들여쓰기 꼴(공백 수 · 탭)·키 순서·끝 줄바꿈을 지킨다.
# 쓰는 법: sh install-mac.sh [레이아웃 이름] [--hide-files | --show-files] [--panel-tabs]  또는  sh install-mac.sh [레이아웃 이름] --remove-panel-tabs   (옵션은 이름 앞뒤 아무 데나 · 앱 폴더를 바꾸려면 HERDR_APP_HOME=<폴더>)
set -eu

usage() {
  echo "쓰는 법: sh install-mac.sh [레이아웃 이름] [--hide-files | --show-files] [--panel-tabs]" >&2
  echo "       sh install-mac.sh [레이아웃 이름] --remove-panel-tabs   (다른 옵션과 함께 못 씀)" >&2
  exit 2
}
LAYOUT_ARG=
FILES_MODE=
PANEL_TABS=
REMOVE_PT=
for arg in "$@"; do
  case $arg in
    --hide-files|--show-files)
      [ -z "$FILES_MODE" ] || [ "$FILES_MODE" = "${arg#--}" ] || usage
      FILES_MODE=${arg#--} ;;
    --panel-tabs) PANEL_TABS=1 ;;
    --remove-panel-tabs) REMOVE_PT=1 ;;
    -*) echo "모르는 옵션: $arg" >&2; usage ;;
    *) [ -z "$LAYOUT_ARG" ] || usage
       LAYOUT_ARG=$arg ;;
  esac
done
# 제거는 다른 옵션과 함께 못 쓴다(깔기 · Files 단추 일을 섞지 않는다).
[ -z "$REMOVE_PT" ] || [ -z "$PANEL_TABS$FILES_MODE" ] || { echo "--remove-panel-tabs 는 --panel-tabs · --hide-files · --show-files 와 함께 쓸 수 없다" >&2; usage; }
# --panel-tabs 가 쓸 저장소 mod 폴더: 깔기 전에(아무것도 바꾸기 전에) 있는지 본다.
if [ -n "$PANEL_TABS" ]; then
  _pt_src=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)/panel-tabs
  [ -f "$_pt_src/mod.json" ] && [ -f "$_pt_src/main.js" ] || { echo "저장소에 mods/panel-tabs(mod.json · main.js)가 없다: $_pt_src — 저장소를 새로 받는다. 손댄 것 없음." >&2; exit 1; }
fi
PT_MODE=
[ -z "$PANEL_TABS" ] || PT_MODE=install
[ -z "$REMOVE_PT" ] || PT_MODE=remove

APP=${HERDR_APP_HOME:-"$HOME/.config/herdr-app"}
REPO=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
TS=$(date +%Y%m%d%H%M%S)

# herdr-app: PATH 에 없으면(비로그인 셸 등) 설치 기본 위치 ~/.local/bin 도 본다 — 이후 호출은 모두 $HERDR_APP 으로.
if command -v herdr-app >/dev/null 2>&1; then HERDR_APP=herdr-app
elif [ -x "$HOME/.local/bin/herdr-app" ]; then HERDR_APP="$HOME/.local/bin/herdr-app"
else echo "herdr-app 이 없다" >&2; exit 1; fi
# 안내 문구에 찍을 이름: 실제로 쓰는 경로($HERDR_APP) — 공백 등이 있으면 따옴표로 감싼다.
case $HERDR_APP in *[!A-Za-z0-9_./:@%+=-]*) HERDR_APP_Q="'$(printf %s "$HERDR_APP" | sed "s/'/'\\\\''/g")'" ;; *) HERDR_APP_Q=$HERDR_APP ;; esac
command -v python3 >/dev/null 2>&1 || { echo "python3 이 없다" >&2; exit 1; }
[ -d "$APP" ] || { echo "앱 폴더가 없다: $APP (앱을 한 번 띄운 뒤 다시)" >&2; exit 1; }

# --panel-tabs: header 꼴은 Herdr 0.1.17 에서 확인했다 → 그보다 낮거나 버전을 못 읽으면 아무것도 하기 전에 거절한다(짐작하지 않는다).
if [ -n "$PANEL_TABS" ]; then
  PT_VER_RAW=$("$HERDR_APP" --version 2>/dev/null) || PT_VER_RAW=
  PT_VER_OK=$(printf %s "$PT_VER_RAW" | python3 -c 'import re, sys
m = re.search(r"(\d+)\.(\d+)\.(\d+)", sys.stdin.read())
v = tuple(map(int, m.groups())) if m else None
print("?" if not m else ("ok18" if v >= (0, 1, 18) else "ok" if v >= (0, 1, 17) else "old"))' 2>/dev/null) || PT_VER_OK="?"
  case $PT_VER_OK in
    ok|ok18) ;;
    old) echo "herdr-app 이 너무 낮다($PT_VER_RAW) — --panel-tabs 는 0.1.17 이상만 확인했다. 앱을 올린 뒤 다시. 손댄 것 없음." >&2; exit 1 ;;
    *) echo "herdr-app 버전을 읽을 수 없다('$HERDR_APP --version' → «${PT_VER_RAW}») — --panel-tabs 는 0.1.17 이상만 확인했다. 손댄 것 없음." >&2; exit 1 ;;
  esac
fi

LOCK="$APP/.files-plus-install.lock"
STAGE=
TABS_STAGE=
PT_STAGE=
LOCKED=
# [주의] 잠금·임시 폴더는 어떤 경로로 끝나도(오류 · INT · TERM) 치운다. 잠금 플래그(uchg)·읽기 전용이 남은 임시 폴더도 풀고 지운다. 내가 잡은 잠금만 푼다.
cleanup() {
  for _d in "$STAGE" "$TABS_STAGE" "$PT_STAGE"; do
    [ -z "$_d" ] || { chflags -R nouchg,noschg "$_d" 2>/dev/null; chmod -R u+rwX "$_d" 2>/dev/null; rm -r -f "$_d" 2>/dev/null; } || true
  done
  [ -z "$LOCKED" ] || rmdir "$LOCK" 2>/dev/null || true
}
trap cleanup 0
trap 'exit 130' INT
trap 'exit 143' TERM
# [주의] dash 는 HUP(터미널 닫힘 · ssh 끊김)에서 EXIT 트랩을 돌리지 않는다 → HUP 도 명시해 같은 정리 후 129 로 끝낸다.
trap 'exit 129' HUP
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "설치 잠금이 있다: $LOCK — 남은 잠금이면 지운다: $LOCK" >&2
  exit 1
fi
LOCKED=1
# 앞 단계가 이미 바꾼 것 — 뒤 단계 실패 메시지가 «바뀐 것 없음» 대신 이것을 말한다.
CHANGED_LIST=
FP_NOTE="바뀐 것 없음"
export FP_NOTE
late_fail() {
  [ -z "$CHANGED_LIST" ] || echo "참고: 앞 단계에서 이미 바뀐 것 —$CHANGED_LIST" >&2
  exit "$1"
}

# mods/files-plus 가 심볼릭 링크면(다른 체크아웃을 가리킴) 파일을 바꿔 끼우다 그쪽을 덮어쓴다 → 아무것도 하기 전에 거절한다.
if [ -z "$REMOVE_PT" ] && [ -L "$APP/mods/files-plus" ]; then
  echo "mods/files-plus 가 심볼릭 링크다($APP/mods/files-plus) — 링크가 가리키는 폴더를 덮어쓰지 않으려고 멈췄다. 링크를 치우고(또는 그 폴더를 직접 갱신하고) 다시 돌린다. 손댄 것 없음." >&2
  exit 1
fi
# panel-tabs 도 같은 규칙: 링크면 다른 체크아웃을 덮어쓰게 된다.
if [ -n "$PANEL_TABS" ] && [ -L "$APP/mods/panel-tabs" ]; then
  echo "mods/panel-tabs 가 심볼릭 링크다($APP/mods/panel-tabs) — 링크가 가리키는 폴더를 덮어쓰지 않으려고 멈췄다. 링크를 치우고(또는 그 폴더를 직접 갱신하고) 다시 돌린다. 손댄 것 없음." >&2
  exit 1
fi

# auto-tabs 안에 끊어진 심볼릭 링크가 있으면 3단계 cp -RL 이 실패한다(앞 단계가 이미 바꾼 뒤) → 아무것도 하기 전에 거절한다.
if [ -z "$REMOVE_PT" ] && [ -f "$APP/mods/auto-tabs/main.js" ]; then
  DANGLING=$(find -L "$APP/mods/auto-tabs" -type l 2>/dev/null)
  if [ -n "$DANGLING" ]; then
    echo "auto-tabs 안에 끊어진 심볼릭 링크가 있다(복사할 수 없음) — 링크를 치우거나 고치고 다시 돌린다. 바뀐 것 없음:" >&2
    printf '  %s\n' "$DANGLING" >&2
    exit 1
  fi
fi

# auto-tabs main.js 검사·고치기(3단계) — 인자: <main.js> <모드> <결과 파일>. 모드 probe 는 «지금 우리 Files 숨김 필터가 있나» 만 읽고 아무것도 쓰지 않는다(--panel-tabs 의 hideFiles 판정용).
autotabs_py() {
  python3 - "$@" <<'PY'
import os, re, sys, shutil, tempfile

path, mode, result_file = sys.argv[1:4]
predict = mode.startswith("predict:")
if predict:
    mode = mode[len("predict:"):]
try:
    with open(path, encoding="utf-8", newline="") as f:      # 줄 끝(CRLF)을 그대로 읽고 그대로 쓴다
        s = f.read()
except (OSError, UnicodeDecodeError) as exc:
    sys.exit(f"auto-tabs: main.js 를 읽을 수 없다: {exc}")
orig = s
nl = "\r\n" if "\r\n" in s else "\n"
res = []
CODE, COMMENT, TEXT = ord("c"), ord("m"), ord("s")

# JS 자리 지도: 글자마다 코드(c) · 주석(m) · 문자열/템플릿/정규식 안(s). 정규식 리터럴은 «앞 토큰이 연산자·여는 괄호·키워드·파일 처음» 일 때만 정규식으로 본다(어림). 짝이 안 맞거나 줄 안에서 안 닫히는 정규식이면 ok=False → 아무것도 바꾸지 않는다.
RE_KEYWORDS = {"return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await"}
RE_PREV = set("(,=:[!&|?{};+-*%<>~^")
def scan(text):
    n = len(text)
    kind = bytearray(b"c" * n)
    ctx = [["code", 0]]
    rx = True                       # 지금 `/` 가 정규식을 열 수 있는 자리인가(파일 처음 · 연산자 뒤)
    i = 0
    while i < n:
        top = ctx[-1]; mode_ = top[0]; ch = text[i]
        if mode_ in ("code", "expr"):
            if text.startswith("//", i):
                j = text.find("\n", i); j = n if j < 0 else j
                kind[i:j] = b"m" * (j - i); i = j; continue
            if text.startswith("/*", i):
                j = text.find("*/", i + 2)
                if j < 0: return kind, False
                kind[i:j + 2] = b"m" * (j + 2 - i); i = j + 2; continue
            if ch in "\"'":
                ctx.append([ch, 0]); i += 1; continue          # 여는 따옴표는 코드 쪽 · 안쪽과 닫는 따옴표는 문자열
            if ch == "`":
                ctx.append(["tpl", 0]); i += 1; continue
            if ch == "/":
                if not rx:
                    rx = True; i += 1; continue                 # 나눗셈
                j = i + 1; cls = False
                while True:
                    if j >= n or text[j] == "\n": return kind, False   # 줄 안에서 안 닫히는 정규식 → 믿을 수 없다
                    c = text[j]
                    if c == "\\":
                        if j + 1 >= n or text[j + 1] == "\n": return kind, False
                        j += 2; continue
                    if c == "[": cls = True
                    elif c == "]": cls = False
                    elif c == "/" and not cls: break
                    j += 1
                kind[i + 1:j + 1] = b"s" * (j - i)              # 여는 `/` 는 코드 · 본문과 닫는 `/` 는 문자열 취급
                i = j + 1
                while i < n and (text[i].isalnum() or text[i] in "_$"): i += 1   # 플래그는 코드
                rx = False; continue
            if mode_ == "expr":
                if ch == "{": top[1] += 1
                elif ch == "}":
                    if top[1] == 0: ctx.pop(); i += 1; continue
                    else: top[1] -= 1
            if ch.isspace():
                i += 1; continue
            if ch.isalnum() or ch in "_$" or ord(ch) > 127:     # 낱말: 키워드면 뒤에 정규식 가능 · 앞이 `.` 이면 속성 이름
                j = i
                while j < n and (text[j].isalnum() or text[j] in "_$" or ord(text[j]) > 127): j += 1
                dot = i > 0 and text[i - 1] == "."
                rx = text[i:j] in RE_KEYWORDS and not dot
                i = j; continue
            if ch in "+-" and text.startswith(ch * 2, i):       # ++ -- 는 뒤에 값이 온 꼴로(나눗셈 쪽)
                rx = False; i += 2; continue
            if text.startswith("...", i):                     # 펼침·나머지 연산자 뒤에는 식이 온다 → 정규식 가능
                rx = True; i += 3; continue
            rx = ch in RE_PREV                                    # `)` `]` 등은 값 → 다음 `/` 는 나눗셈
            i += 1; continue
        kind[i] = TEXT
        if ch == "\\":
            if i + 1 < n: kind[i + 1] = TEXT
            i += 2; continue
        if mode_ == "tpl":
            if ch == "`": ctx.pop(); rx = False
            elif text.startswith("${", i):
                kind[i + 1] = CODE; ctx.append(["expr", 0]); rx = True; i += 2; continue   # ${…} 괄호도 코드 깊이에 포함
        else:
            if ch == mode_: ctx.pop(); rx = False
            elif ch == "\n": return kind, False                 # 닫히지 않은 따옴표
        i += 1
    return kind, len(ctx) == 1

# 코드(주석 · 문자열 밖)에서 시작하는 일치만 — group 은 «시작 위치» 를 재는 묶음.
def live_hits(text, kind, pattern, group=0, flags=0):
    return [m for m in re.finditer(pattern, text, flags) if kind[m.start(group)] == CODE]

# «Files+» 단추
# 살아 있는 enabled 선언은 하나만 허용한다. 배열에서는 맨 위 문자열 요소만 graph 로 센다.
STOCK_ENABLED = 'shared("workspace.panels") ?? ["files", "changes"]'
def enabled_elements(text, kind):
    masked = ''.join(' ' if kind[i] == COMMENT else ch for i, ch in enumerate(text))
    decls = [m for m in re.finditer(r'(?<![\w$])const\s+enabled\s*=\s*', masked)
             if all(kind[i] == CODE for i in range(m.start(), m.end()) if not masked[i].isspace())]
    if len(decls) != 1: return None
    start = decls[0].end()
    if text.startswith(STOCK_ENABLED + ';', start):
        end = start + len(STOCK_ENABLED)
        return {"files-plus": False, "graph": [], "stock": (start, end), "template": False, "escaped": False}
    if start >= len(text) or text[start] != '[' or kind[start] != CODE: return None
    stack = []; element = start + 1; spans = []; template = False
    for i in range(start, len(text)):
        if kind[i] != CODE: continue
        ch = text[i]
        if ch == '`': template = True
        if ch in '([{': stack.append(ch)
        elif ch in ')]}':
            if not stack or stack.pop() != {')': '(', ']': '[', '}': '{'}[ch]: return None
            if not stack:
                spans.append((element, i))
                end = i
                break
        elif ch == ',' and len(stack) == 1:
            spans.append((element, i)); element = i + 1
    else:
        return None
    # 줄바꿈도 실제 문장 끝일 때만 허용한다. 다음 줄의 연결 호출·연산자는 거절한다.
    tail = end + 1; newline = False
    while tail < len(text) and (kind[tail] == COMMENT or text[tail].isspace()):
        newline = newline or text[tail] in '\r\n'
        tail += 1
    if tail < len(text) and text[tail] != ';':
        if (not newline or text[tail] in '.([`+-*/%<>=!&|^?:,\\'
                or re.match(r'(?:in|instanceof)\b', text[tail:])): return None
    # 이스케이프는 해석하지 않는다. 정확한 기존 항목이 없으면 배열을 바꾸지 않는다.
    escaped = any(kind[j] == TEXT and text[j] == "\\" for j in range(start + 1, end))
    # 중첩 리터럴만 있으면 실제 enabled 항목인지 결정하지 않는다.
    has_literal = any(text[j] in "\"'`" and kind[j] == CODE
                        and text.startswith(text[j] + 'files-plus' + text[j], j)
                        and all(kind[k] == TEXT for k in range(j + 1, j + 12))
                        for j in range(start + 1, end - 11))
    found = {"files-plus": False, "graph": [], "stock": None, "template": template, "escaped": escaped}
    last = None
    for lo, hi in spans:
        part = ''.join(' ' if kind[j] == COMMENT else text[j] for j in range(lo, hi))
        if part.strip():
            last = lo + len(part.rstrip())
        # files-plus 는 요소 전체가 정확한 리터럴인 경우만 인정한다(괄호 허용).
        value = part.strip()
        offset = len(part) - len(part.lstrip())
        while value.startswith('(') and value.endswith(')'):
            inner = value[1:-1]
            offset += 1 + len(inner) - len(inner.lstrip())
            value = inner.strip()
        if value in ('"files-plus"', "'files-plus'", '`files-plus`'):
            pos = lo + offset
            if kind[pos] == CODE and all(kind[j] == TEXT for j in range(pos + 1, pos + len(value))):
                found["files-plus"] = True
        # graph 는 요소 전체가 문자열 리터럴인 경우만 인정한다.
        m = re.fullmatch(r'\s*(["\'])graph\1\s*', part)
        if m:
            pos = lo + m.start(1)
            stop = lo + len(part.rstrip())
            if kind[pos] == CODE and all(kind[j] == TEXT for j in range(pos + 1, stop)):
                found["graph"].append(pos)
    if has_literal and not found["files-plus"]: return None
    found["append"] = (last if last is not None else start + 1, ', "files-plus"' if last is not None else '"files-plus"')
    return found
# 단추 자리 = 살아 있는 Files · Changes 두 줄 사이. Git 단추 유무는 관계없다.
A_FILES = r'^[ \t]*(?P<files>\.when\(enabled\.includes\("files"\))[^\n]*\n'
A_CHANGES = r'(?P<indent>[ \t]*)(?P<changes>\.when\(enabled\.includes\("changes"\))[^\n]*\n'
ANCHOR = A_FILES + A_CHANGES                                 # 넣기 전
BUTTON_HAS = r"\.child\s*\(\s*panelButton\s*\(\s*(?:\"files-plus\"|'files-plus'|`files-plus`)"
ANCHOR_AFTER = A_FILES + r'[ \t]*(?P<button>' + BUTTON_HAS + r')[^\n]*\n' + A_CHANGES   # 넣은 뒤
def complete_line(text, kind, pos):
    start = text.rfind('\n', 0, pos) + 1
    end = text.find('\n', pos)
    if end < 0: end = len(text)
    stack = []
    for i in range(start, end):
        if kind[i] != CODE: continue
        ch = text[i]
        if ch in '([{': stack.append(ch)
        elif ch in ')]}':
            if not stack or stack.pop() != {')': '(', ']': '[', '}': '{'}[ch]: return False
    return not stack

def live_anchors(text, kind, pattern=ANCHOR):
    return [m for m in re.finditer(pattern, text, re.M)
            if all(kind[m.start(name)] == CODE for name in m.groupdict() if name != "indent")
            and all(complete_line(text, kind, m.start(name)) for name in ("files", "changes"))]
button = '      .child(panelButton("files-plus", "Files+", "mods/files-plus/folder.svg"))' + nl

kind, ok = scan(s)
elements = enabled_elements(s, kind) if ok else None
if not ok or elements is None:
    res.append("btn:mismatch")      # 주석 · 문자열의 짝이 안 맞는 파일은 자리를 믿을 수 없다
else:
    need_enabled = not elements["files-plus"]
    buttons = live_hits(s, kind, BUTTON_HAS)
    need_button = not buttons
    anchors = live_anchors(s, kind) if need_button else live_anchors(s, kind, ANCHOR_AFTER)
    if (len(elements["graph"]) > 1 or (need_enabled and (elements["template"] or elements["escaped"]))
            or len(anchors) != 1 or len(buttons) > 1):
        res.append("btn:mismatch")
    elif not need_enabled and not need_button:
        res.append("btn:exists")
    else:
        edits = []
        if need_enabled:
            if elements["stock"]:
                st, en = elements["stock"]
                edits.append((st, en, '[...(' + STOCK_ENABLED + '), "files-plus"]'))
            elif elements["graph"]:
                pos = elements["graph"][0]
                edits.append((pos, pos, '"files-plus", '))
            else:
                pos, txt = elements["append"]
                edits.append((pos, pos, txt))
        if need_button: edits.append((anchors[0].start("indent"), anchors[0].start("indent"), button))
        t = s
        for st, en, txt in sorted(edits, reverse=True):       # 뒤에서부터 — 앞 위치가 밀리지 않게
            t = t[:st] + txt + t[en:]
        # 쓴 뒤 다시 확인: enabled 와 Files · 단추 · Changes 자리를 다시 읽고, 실패하면 원본을 유지한다.
        k2, ok2 = scan(t)
        after = enabled_elements(t, k2) if ok2 else None
        good = (ok2 and after is not None and after["files-plus"] and len(after["graph"]) <= 1
                and len(live_hits(t, k2, BUTTON_HAS)) == 1
                and len(live_anchors(t, k2, ANCHOR_AFTER)) == 1)
        if good:
            s = t; res.append("btn:added")
        else:
            res.append("btn:mismatch")

# 기본 Files 숨김: enabled 에서 files 를 거른다(.when(enabled.includes("files")) 단추와 syncPanel 복원이 함께 빠진다)
# 이 설치기가 쓰는 꼴 `.filter(p => p !== "files")` (공백 · 따옴표 · 변수 이름 차이는 같은 것으로)만 «우리가 숨김» 으로 본다.
# 그 밖에 줄에 files 가 든 .filter(…)(예: 남기는 필터)는 «사용자 필터» — 바꾸지 않는다.
shown = '(shared("workspace.panels") ?? ["files", "changes"])'
OUR_FILTER = '.filter(p => p !== "files")'
FILTER_OURS = r'\s*\.filter\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*\1\s*!==?\s*(["\'])files\2\s*\)'
if mode in ("hide-files", "show-files", "probe"):
    def tail(text, kd, end):        # «shown» 뒤 파일 끝까지 · 주석은 공백으로 가린다(길이는 그대로) → 줄을 넘는 필터도 한 덩이로 본다
        return "".join(" " if kd[i] == COMMENT else text[i] for i in range(end, len(text)))
    kind, ok = scan(s)
    hits = live_hits(s, kind, re.escape(shown)) if ok else []
    if len(hits) != 1:
        res.append("files:mismatch")
    else:
        end = hits[0].end()
        rest = tail(s, kind, end)
        eol = rest.find("\n"); line_rest = rest if eol < 0 else rest[:eol]
        mo = re.match(FILTER_OURS, rest)
        foreign = mo is None and (re.search(r'\.filter\([^)]*["\']files["\']', line_rest) is not None
                                  or re.match(r'\s*\.filter\([^)]*["\']files["\']', rest) is not None)
        def ours_after(text):           # 바꾼 글에서 «shown» 이 정확히 한 번이고 그 뒤에 우리 필터가 있는가(없는가)
            kd, good = scan(text)
            hh = live_hits(text, kd, re.escape(shown)) if good else []
            return (len(hh) == 1, bool(len(hh) == 1 and re.match(FILTER_OURS, tail(text, kd, hh[0].end()))))
        if mode == "probe":
            res.append("probe:hidden" if mo else "probe:shown")      # 읽기만 — 우리 .filter 가 있으면 «숨김»
        elif mode == "hide-files":
            if mo:
                res.append("files:hidden-already")
            elif foreign:
                res.append("files:hidden-custom")
            else:
                t = s[:end] + OUR_FILTER + s[end:]
                one, has = ours_after(t)
                if one and has:
                    s = t; res.append("files:hidden")
                else:
                    res.append("files:mismatch")
        else:
            if mo:
                # 우리 필터 호출 글자(+ 그것에 딸린 앞 공백)만 지운다 — 사이에 낀 주석 · 다른 글은 그대로
                fs = end + (len(rest[:mo.end()]) - len(rest[:mo.end()].lstrip()))
                cut = fs
                if not s[end:fs].strip(): cut = end
                else:
                    while cut > end and s[cut - 1] in " \t" and kind[cut - 1] != COMMENT: cut -= 1
                t = s[:cut] + s[end + mo.end():]
                one, has = ours_after(t)
                if one and not has:
                    s = t; res.append("files:shown")
                else:
                    res.append("files:mismatch")
            elif foreign:
                res.append("files:mismatch")
            else:
                res.append("files:shown-already")

if result_file == "-":
    print("\n".join(res))
else:
    with open(result_file, "w", encoding="utf-8") as f:
        f.write("\n".join(res) + "\n")
if predict or mode == "probe" or s == orig:      # 예측 · probe 는 원본을 쓰지 않는다
    sys.exit(10)
# 숨긴 임시 파일은 앱이 다시 읽지 않는다 — 다 쓴 뒤 바꿔 끼운다(mkstemp 는 0600 → 모드를 되살린다).
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".", suffix=".files-plus-tmp")
try:
    with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
        f.write(s)
    shutil.copymode(path, tmp)
    os.replace(tmp, path)
finally:
    if os.path.exists(tmp):
        os.unlink(tmp)
PY
}

# 레이아웃: 인자 > shared.json 의 지금 레이아웃 > main. 앱 원본은 먼저 거른다.
ACTIVE=$(python3 -c 'import json, sys
try: print(json.load(open(sys.argv[1], encoding="utf-8")).get("layout") or "")
except Exception: print("")' "$APP/shared.json")
LAYOUT=${LAYOUT_ARG:-${ACTIVE:-main}}
# kit 판 auto-tabs 설정(config.js) 읽기·쓰기·names 판정 — 모드: read <config> · write <config> <names> <hide> · names <main.js> <config>
# config.js 꼴(고정): [주석 한 줄] export default { names: <true|false>, hideFiles: <true|false> };
cfg_py() {
  python3 - "$@" <<'PY'
import re, sys

CFG = re.compile(r"\A(?://[^\n]*\n)?export default \{ names: (true|false), hideFiles: (true|false) \};\n?\Z")
def read_cfg(path):
    try:
        with open(path, encoding="utf-8") as f:
            m = CFG.match(f.read().replace("\r\n", "\n"))
    except OSError:
        return None
    return m.groups() if m else None

mode = sys.argv[1]
if mode == "read":
    g = read_cfg(sys.argv[2])
    if g is None:
        sys.exit(3)
    print(g[0], g[1])
elif mode == "write":
    path, names, hide = sys.argv[2:5]
    with open(path, "w", encoding="utf-8") as f:
        f.write("// herdr-kit auto-tabs 설정 — install-mac.sh 가 쓴다(--hide-files · --show-files · 이름 동기화)\n")
        f.write("export default { names: %s, hideFiles: %s };\n" % (names, hide))
elif mode == "names":
    main, cfg = sys.argv[2:4]
    try:
        with open(main, encoding="utf-8", errors="replace") as f:
            text = f.read()
    except OSError:
        print("false"); sys.exit(0)
    if text.startswith("// herdr-kit auto-tabs 2"):        # kit 판: 옛 config.js 의 names 만 본다(main.js 글에는 syncNames 가 늘 있다)
        g = read_cfg(cfg)
        print("true" if g and g[0] == "true" else "false")
    else:
        print("true" if "syncNames" in text else "false")
PY
}

# 레이아웃에 content.mod 가 auto-tabs 인 블록이 있나: yes · no · err(못 읽음)
gate_py() {
  python3 - "$1" <<'PY'
import json, sys

def has(node):
    if isinstance(node, dict):
        c = node.get("content")
        if isinstance(c, dict) and c.get("mod") == "auto-tabs":
            return True
        return any(has(v) for v in node.values())
    if isinstance(node, list):
        return any(has(v) for v in node)
    return False

try:
    with open(sys.argv[1], encoding="utf-8") as f:
        print("yes" if has(json.load(f)) else "no")
except Exception:
    print("err")
PY
}

# 지금 깔린 auto-tabs 가 kit 판인가(main.js 첫 줄 표식)
KIT_NOW=
if [ -f "$APP/mods/auto-tabs/main.js" ]; then
  case $(head -n 1 "$APP/mods/auto-tabs/main.js" 2>/dev/null) in
    "// herdr-kit auto-tabs 2"*) KIT_NOW=1 ;;
  esac
fi
# M2 문: --panel-tabs 이고 Herdr 0.1.18 이상이고 레이아웃에 content.mod 가 auto-tabs 인 블록이 있을 때만(아니면 한 줄 알림 뒤 M1 그대로).
M2=
if [ -n "$PANEL_TABS" ]; then
  if [ "$PT_VER_OK" != ok18 ]; then
    echo "Herdr 0.1.18 미만 — 옮기기·닫기·+ 는 꺼짐"
  else
    M2_GATE=$(gate_py "$APP/layouts/$LAYOUT.json") || M2_GATE=err
    case $M2_GATE in
      yes) M2=1 ;;
      no) echo "위쪽 바가 auto-tabs 가 아니라 옮기기·닫기·+ 는 꺼짐(M1 탭 줄만)" ;;
    esac
  fi
fi
# 요청이 거절될 수 있으므로 같은 패처로 읽기 전용 예측 → 거절 · 불명은 현재 상태 유지.
PT_HIDE=false
PT_BEFORE=false
KIT_CFG=            # kit 판이 이미 있고 M2 가 아닐 때 --hide-files/--show-files 는 config.js 와 header 만 고친다
KIT_SYNC=           # kit 판 + 플래그: 두 스택 header 의 hideFiles 도 맞춘다
if [ -z "$REMOVE_PT" ] && [ -n "$KIT_NOW" ] && { [ -n "$PANEL_TABS" ] || [ -n "$FILES_MODE" ]; }; then
  KIT_CFG_RAW=$(cfg_py read "$APP/mods/auto-tabs/config.js" 2>/dev/null) || { echo "auto-tabs: config.js 모양이 kit 판 꼴이 아니다($APP/mods/auto-tabs/config.js) — 덮어쓰지 않으려고 멈췄다. 손댄 것 없음." >&2; exit 1; }
  PT_HIDE=${KIT_CFG_RAW#* }
  PT_BEFORE=$PT_HIDE
  case $FILES_MODE in hide-files) PT_HIDE=true ;; show-files) PT_HIDE=false ;; esac
  [ -n "$M2" ] || [ -z "$FILES_MODE" ] || KIT_CFG=1
  [ -z "$FILES_MODE" ] || KIT_SYNC=1
elif [ -n "$PANEL_TABS" ] && [ -f "$APP/mods/auto-tabs/main.js" ]; then
  PT_PROBE=$(autotabs_py "$APP/mods/auto-tabs/main.js" probe - 2>/dev/null) || true
  case $PT_PROBE in *probe:hidden*) PT_HIDE=true ;; esac
  PT_BEFORE=$PT_HIDE
  PT_PREDICT=$(autotabs_py "$APP/mods/auto-tabs/main.js" "predict:$FILES_MODE" - 2>/dev/null) || true
  case $PT_PREDICT in
    *files:hidden-already*|*files:hidden*)
      case $PT_PREDICT in *files:hidden-custom*) ;; *) PT_HIDE=true ;; esac ;;
    *files:shown-already*|*files:shown*) PT_HIDE=false ;;
  esac
elif [ -n "$M2" ]; then
  [ "$FILES_MODE" != hide-files ] || PT_HIDE=true      # 옛 main.js 가 없다: 플래그만
fi
# M2 또는 kit 판이 있으면 옛 단추·필터 패처(autotabs_py)는 건너뛴다.
KIT_MODE=
[ -z "$M2$KIT_NOW" ] || KIT_MODE=1
python3 - "$APP" "$LAYOUT" "$HERDR_APP_Q" "$FILES_MODE" "$REPO/files-plus" "$PT_MODE" "$PT_HIDE" "$REPO/panel-tabs" "$HERDR_APP" "$M2" "$KIT_MODE" "$REPO/auto-tabs" <<'PY'
import filecmp, json, os, re, stat, subprocess, sys, time

app, name, herdr, files_mode, repo, pt_mode, pt_hide, pt_repo, herdr_bin, m2, kit_mode, at_repo = sys.argv[1:13]
want_hide = pt_hide == "true"
if not name or name in {".", ".."} or os.path.basename(name) != name:
    sys.exit("레이아웃 이름에 경로를 쓸 수 없다")
try:
    with open(os.path.join(app, "installed.json"), encoding="utf-8") as f:
        installed = json.load(f)
    if not isinstance(installed, dict):
        raise ValueError("JSON 객체가 아니다")
except Exception:
    sys.exit("installed.json 을 읽을 수 없거나 JSON 객체가 아니다 — 설치를 멈췄다")
if name in {"main", "terminals", "win98"} or f"layout:{name}" in installed:
    sys.exit(f"«{name}» 는 앱이 싣는 레이아웃이라 고쳐도 앱이 되돌린다. 먼저 복제한다:\n"
             f"  {herdr} do layout.clone '{{\"name\":\"{name}\",\"as\":\"my-{name}\"}}'\n"
             f"  sh install-mac.sh my-{name}")

# 폴더 점검 · 남은 임시 파일 청소(아래 3곳이 같은 꼴을 쓴다). [주의] 청소는 이 설치기의 임시 이름 꼴(.<8자>.files-plus-tmp)과 정확히 같은 «일반 파일»(링크 아님 · lstat) · 내 소유 · 10분 넘은 것만 지운다.
IMMUTABLE = getattr(stat, "UF_IMMUTABLE", 0) | getattr(stat, "SF_IMMUTABLE", 0) | getattr(stat, "UF_APPEND", 0) | getattr(stat, "SF_APPEND", 0)
TMP_RE = re.compile(r"^\.[a-z0-9_]{8}\.files-plus-tmp$")
def unwritable(d):
    try:
        if getattr(os.stat(d), "st_flags", 0) & IMMUTABLE:
            return "잠금 플래그(uchg 등)"
        if not os.access(d, os.W_OK | os.X_OK):
            return "쓰기 권한 없음"
    except OSError as exc:
        return str(exc)
    return None
def sweep(d):
    try:
        names = os.listdir(d)
    except OSError:
        return
    for n in names:
        if not TMP_RE.match(n):
            continue
        fp = os.path.join(d, n)
        try:
            st = os.lstat(fp)
            if stat.S_ISREG(st.st_mode) and st.st_uid == os.geteuid() and time.time() - st.st_mtime > 600:
                os.unlink(fp)
        except OSError:
            pass
path = os.path.join(app, "layouts", name + ".json")
if not os.path.isfile(path):
    sys.exit(f"레이아웃 파일이 없다: {path}")
# 아무것도 바꾸기 전에 거른다: 단추(togglePanel)와 자동 열기(layout.select)는 블록 id «files-plus» 로 찾는다.
try:
    with open(path, encoding="utf-8") as f:
        layout = json.load(f)
except Exception as exc:
    sys.exit(f"레이아웃 파일을 읽을 수 없다: {path}: {exc}")

def find(node, id_):
    if isinstance(node, dict):
        if node.get("id") == id_:
            return node
        for child in node.get("children") or []:
            hit = find(child, id_)
            if hit:
                return hit
    return None

body = find(layout, "panel-body")
if pt_mode != "remove" and isinstance(body, dict) and body.get("type") == "stack":
    if body.get("children") is not None and not isinstance(body.get("children"), list):
        sys.exit(f"레이아웃 {name}: panel-body 의 children 이 목록이 아니다 — 손으로 고친다. 손댄 것 없음.")
    kids = [c for c in body.get("children") or [] if isinstance(c, dict)]
    mods = [c for c in kids if (c.get("content") or {}).get("mod") == "files-plus"]
    if mods and not any(c.get("id") == "files-plus" for c in mods):
        bad = mods[0].get("id")
        sys.exit(f"레이아웃 {name}: files-plus mod 블록의 id 가 «{bad}» 다 — 탭바 단추와 자동 열기는 id «files-plus» 로 찾아 동작하지 않는다.\n"
                 f"  {path} 에서 그 블록의 id 를 «files-plus» 로 바꾼 뒤 다시 돌린다. 손댄 것 없음.")
    need_layout = find(layout, "files-plus") is None      # id files-plus 가 레이아웃 어디에도 없을 때만 더한다(panel-bottom 에 있으면 그대로)
else:
    need_layout = False
# panel-tabs header: 설치 = 더하기 · 고치기가 필요한가 / panel-tabs 가 아닌 header 가 있으면 아무것도 바꾸기 전에 거절한다. 제거 = 우리 header 가 있을 때만 쓴다.
def ours_header(h):
    return isinstance(h, dict) and isinstance(h.get("content"), dict) and h["content"].get("mod") == "panel-tabs"
def header_differs(h, hide):
    if not ours_header(h):
        return True
    props = h["content"].get("props")
    return not (isinstance(props, dict) and props.get("stack") == "panel-body" and props.get("hideFiles") is hide and h.get("height") == 32)
need_header = need_remove = False
if pt_mode == "install":
    if not (isinstance(body, dict) and body.get("type") == "stack"):
        sys.exit(f"레이아웃 {name}: 오른쪽 패널 스택(id panel-body)이 없어 panel-tabs header 를 달 곳이 없다. 손댄 것 없음.")
    cur_header = body.get("header")
    if cur_header is not None and not ours_header(cur_header):
        sys.exit(f"레이아웃 {name}: panel-body 에 panel-tabs 가 아닌 header 가 이미 있다({json.dumps(cur_header, ensure_ascii=False)[:160]}) — 덮어쓰지 않으려고 멈췄다.\n"
                 f"  {path} 에서 그 header 를 치우거나 옮긴 뒤 다시 돌린다. 손댄 것 없음.")
    need_header = header_differs(cur_header, want_hide)
elif pt_mode == "remove":
    need_remove = isinstance(body, dict) and ours_header(body.get("header"))
    _rb = find(layout, "panel-bottom")
    need_remove = need_remove or (isinstance(_rb, dict) and _rb.get("type") == "stack" and ours_header(_rb.get("header")))
TOOL_IDS = ("files", "files-plus", "changes", "graph")
def stack_ids(node):
    return {c.get("id") for c in (node.get("children") or []) if isinstance(c, dict)} if isinstance(node, dict) and isinstance(node.get("children"), list) else set()
# M2: 같은 도구 id 가 오른쪽 · 아래 스택에 둘 다 있으면 어느 쪽이 맞는지 모른다 → 아무것도 바꾸기 전에 거절한다.
bottom = find(layout, "panel-bottom")
if pt_mode == "remove" and isinstance(bottom, dict) and bottom.get("type") == "stack" and ours_header(bottom.get("header")):
    if isinstance(body, dict) and body.get("type") == "stack":
        for c in bottom.get("children") or []:
            if isinstance(c, dict) and c.get("id") in stack_ids(body):
                sys.exit(f"레이아웃 {name}: id {c.get('id')} 가 panel-body 와 panel-bottom 양쪽에 있다 — 손으로 고친다. 손댄 것 없음.")
need_m2 = False
if m2 and pt_mode == "install":
    dup = sorted((stack_ids(body) & stack_ids(bottom)) & set(TOOL_IDS))
    if dup:
        sys.exit(f"레이아웃 {name}: 도구 id {', '.join(dup)} 가 panel-body 와 panel-bottom 양쪽에 있다 — 어느 쪽이 맞는지 알 수 없어 멈췄다. {path} 에서 한쪽만 남긴 뒤 다시 돌린다. 손댄 것 없음.")
    _work = find(layout, "work")
    _ours = isinstance(bottom, dict) and bottom.get("type") == "stack" and ours_header(bottom.get("header"))
    if bottom is None:
        need_m2 = isinstance(_work, dict) and _work.get("type") == "column" and isinstance(_work.get("children"), list)
    elif _ours:
        _p = bottom["header"]["content"].get("props")
        need_m2 = not (isinstance(_p, dict) and _p.get("stack") == "panel-bottom" and _p.get("hideFiles") is want_hide and bottom["header"].get("height") == 32)
# [주의] 이미 거절된 현재 레이아웃은 먼저 고친다 — mod 게시 · 청소보다 앞에서 멈춘다.
if pt_mode:
    try:
        r = subprocess.run([herdr_bin, "status"], capture_output=True, text=True, timeout=5)
        status = json.loads(r.stdout) if r.returncode == 0 else None
    except Exception:
        status = None
    if isinstance(status, dict) and status.get("layout") == name:
        errors = status.get("errors")
        hits = [e for e in (errors if isinstance(errors, list) else [])
                if isinstance(e, str) and re.match(r"^" + re.escape(f"layouts/{name}.json") + r"(?:\s|:|$)", e)]
        if hits:
            sys.exit("\n".join(hits) + f"\n[경고] {path} 을 먼저 고친 뒤 다시 돌린다. 손댄 것 없음.")
# [주의] panel-tabs 는 백업 · 복원이 링크를 일반 파일로 바꿀 수 있어 기존 링크를 거절한다.
# [주의] files-plus 에도 같은 기존 제한이 있으나 기본 설치 동작은 그대로 둔다.
if pt_mode == "install":
    for base, dirs, names in os.walk(os.path.join(app, "mods", "panel-tabs")):
        for entry in dirs + names:
            p = os.path.join(base, entry)
            st = os.lstat(p)
            if stat.S_ISLNK(st.st_mode) or (stat.S_ISREG(st.st_mode) and st.st_nlink > 1):
                sys.exit(f"[경고] panel-tabs 기존 파일이 심볼릭 링크 또는 하드링크다: {p} — 링크를 고친 뒤 다시 돌린다. 손댄 것 없음.")
# [주의] M2: kit 판 auto-tabs 를 바꿔 끼우므로 panel-tabs 와 같은 규칙으로 링크 · 하드링크를 거절한다. 저장소 쪽 파일도 아무것도 바꾸기 전에 본다.
if m2 and pt_mode == "install":
    at_live = os.path.join(app, "mods", "auto-tabs")
    if os.path.islink(at_live):
        sys.exit(f"[경고] mods/auto-tabs 가 심볼릭 링크다({at_live}) — 링크가 가리키는 폴더를 덮어쓰지 않으려고 멈췄다. 손댄 것 없음.")
    for base, dirs, names in os.walk(at_live):
        for entry in dirs + names:
            p = os.path.join(base, entry)
            st = os.lstat(p)
            if stat.S_ISLNK(st.st_mode) or (stat.S_ISREG(st.st_mode) and st.st_nlink > 1):
                sys.exit(f"[경고] auto-tabs 기존 파일이 심볼릭 링크 또는 하드링크다: {p} — 링크를 고친 뒤 다시 돌린다. 손댄 것 없음.")
    _mj, _mm = os.path.join(at_repo, "mod.json"), os.path.join(at_repo, "main.js")
    try:
        with open(_mm, encoding="utf-8") as f:
            _first = f.readline()
    except OSError:
        _first = None
    if not os.path.isfile(_mj) or _first is None:
        sys.exit(f"저장소에 mods/auto-tabs(mod.json · main.js)가 없다: {at_repo} — 저장소를 새로 받는다. 손댄 것 없음.")
    if not _first.startswith("// herdr-kit auto-tabs 2"):
        sys.exit(f"저장소 mods/auto-tabs/main.js 첫 줄이 kit 표식(// herdr-kit auto-tabs 2)이 아니다 — 저장소를 새로 받는다. 손댄 것 없음.")
# 점검: 쓸 폴더 · 고칠 «파일» 을 아무것도 바꾸기 전에 본다(traceback 없이). 폴더 = 레이아웃 링크 폴더 · 실제 파일 폴더 · 실제 main.js 폴더 · 바뀔 mods/files-plus 파일의 폴더. 파일 = 레이아웃 실제 파일 · (단추를 더해야 하면) main.js 실제 파일 · 바뀔 mods/files-plus 파일(잠금 플래그만 — 바꿔 끼우기는 읽기 전용 파일도 된다).
def file_block(p, need_w=True):
    try:
        if getattr(os.stat(p), "st_flags", 0) & IMMUTABLE:
            return "잠금 플래그(uchg 등)"
        if need_w and not os.access(p, os.W_OK):
            return "쓰기 권한 없음(읽기 전용 · 소유자)"
    except OSError as exc:
        return str(exc)
    return None
def repo_files(root):
    # .cache 는 설치기가 만들지도 건드리지도 않는다 → 점검 · 청소 밖
    for base, dirs, names in os.walk(root):
        if base == root and ".cache" in dirs:
            dirs.remove(".cache")
        for n in names:
            if base != root or n != ".cache":
                yield os.path.relpath(os.path.join(base, n), root)
def nearest_dir(d):
    while d and not os.path.isdir(d):
        up = os.path.dirname(d)
        if up == d:
            break
        d = up
    return d
live = os.path.join(app, "mods", "files-plus")
changed = [] if pt_mode == "remove" else [rel for rel in repo_files(repo)
           if not os.path.isfile(os.path.join(live, rel))
           or not filecmp.cmp(os.path.join(repo, rel), os.path.join(live, rel), shallow=False)]
checks, file_checks = [], []
if changed:
    checks.append(nearest_dir(os.path.dirname(live)))
    for rel in changed:
        dst = os.path.join(live, rel)
        checks.append(nearest_dir(os.path.dirname(dst)))
        if os.path.isfile(dst):
            file_checks.append((dst, False))
# panel-tabs mod 폴더: files-plus 와 같은 점검(바뀔 파일의 폴더 · 잠금 플래그)
pt_live = os.path.join(app, "mods", "panel-tabs")
pt_changed = [rel for rel in repo_files(pt_repo)
              if not os.path.isfile(os.path.join(pt_live, rel))
              or not filecmp.cmp(os.path.join(pt_repo, rel), os.path.join(pt_live, rel), shallow=False)] if pt_mode == "install" else []
if pt_changed:
    checks.append(nearest_dir(os.path.dirname(pt_live)))
    for rel in pt_changed:
        dst = os.path.join(pt_live, rel)
        checks.append(nearest_dir(os.path.dirname(dst)))
        if os.path.isfile(dst):
            file_checks.append((dst, False))
if need_layout or need_header or need_remove or need_m2 or (kit_mode and files_mode):
    checks += [os.path.dirname(path), os.path.dirname(os.path.realpath(path))]
    file_checks.append((os.path.realpath(path), True))
sweeps = [os.path.dirname(path), os.path.dirname(os.path.realpath(path))]
tabs_js = os.path.join(app, "mods", "auto-tabs", "main.js")
if pt_mode != "remove" and not kit_mode and os.path.isfile(tabs_js):
    tabs_dir = os.path.dirname(os.path.realpath(tabs_js))
    sweeps.append(tabs_dir)
    try:
        with open(tabs_js, encoding="utf-8", errors="replace") as f:
            has_btn = 'panelButton("files-plus"' in f.read()
    except OSError:
        has_btn = False
    if files_mode or not has_btn:
        checks.append(tabs_dir)
    if not has_btn:
        file_checks.append((os.path.realpath(tabs_js), True))   # 단추를 더하면 확실히 쓴다(--hide/--show 만이면 쓸지 모르니 쓰는 때 다시 본다)
for d in dict.fromkeys(checks):
    why = unwritable(d)
    if why:
        sys.exit(f"쓸 수 없다: {d} ({why}) · 바뀐 것 없음")
for fp, need_w in dict.fromkeys(file_checks):
    why = file_block(fp, need_w)
    if why:
        sys.exit(f"쓸 수 없다: {fp} ({why}) · 바뀐 것 없음")
for d in dict.fromkeys(sweeps):
    if unwritable(d) is None:
        sweep(d)
PY

# 1. 숨긴 폴더에서 check 한 뒤 파일마다 바꿔 끼운다. .cache 는 그대로 둔다.
# publish_mod <mod 이름> <저장소 폴더> <stage 폴더> <사본 상위 폴더 이름> <먼저 게시할 파일> <마지막에 게시할 파일> — files-plus · panel-tabs 가 같은 엔진을 쓴다.
# [주의] 변경 표시($3/.changed) · 임시 파일 꼴(.<8자>.<이름>-tmp) · 사본 폴더는 mod 마다 따로다 — stage · 표시를 두 mod 가 나눠 쓰지 않는다.
publish_mod() {
  python3 - "$APP" "$3" "$TS-$$" "$2" "$1" "$3/.changed" "$4" "$5" "$6" <<'PY'
import filecmp, os, re, shutil, signal, stat, sys, tempfile, time

app, stage, stamp, repo, name, mark, backup_root, first, last = sys.argv[1:10]
live = os.path.join(app, "mods", name)
backup = os.path.join(app, backup_root, stamp)

# 폴더 점검 · 남은 임시 파일 청소(아래 3곳이 같은 꼴을 쓴다). [주의] 청소는 이 설치기의 임시 이름 꼴(.<8자>.files-plus-tmp)과 정확히 같은 «일반 파일»(링크 아님 · lstat) · 내 소유 · 10분 넘은 것만 지운다.
IMMUTABLE = getattr(stat, "UF_IMMUTABLE", 0) | getattr(stat, "SF_IMMUTABLE", 0) | getattr(stat, "UF_APPEND", 0) | getattr(stat, "SF_APPEND", 0)
TMP_RE = re.compile(r"^\.[a-z0-9_]{8}\." + re.escape(name) + r"-tmp$")
def unwritable(d):
    try:
        if getattr(os.stat(d), "st_flags", 0) & IMMUTABLE:
            return "잠금 플래그(uchg 등)"
        if not os.access(d, os.W_OK | os.X_OK):
            return "쓰기 권한 없음"
    except OSError as exc:
        return str(exc)
    return None
def sweep(d):
    try:
        names = os.listdir(d)
    except OSError:
        return
    for n in names:
        if not TMP_RE.match(n):
            continue
        fp = os.path.join(d, n)
        try:
            st = os.lstat(fp)
            if stat.S_ISREG(st.st_mode) and st.st_uid == os.geteuid() and time.time() - st.st_mtime > 600:
                os.unlink(fp)
        except OSError:
            pass

def files(root):
    for base, dirs, names in os.walk(root):
        if base == root and ".cache" in dirs:
            dirs.remove(".cache")
        for name in names:
            if base != root or name != ".cache":
                yield os.path.relpath(os.path.join(base, name), root)

def publish(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(dst), prefix=".", suffix=f".{name}-tmp")
    os.close(fd)
    try:
        shutil.copy2(src, tmp)
        os.replace(tmp, dst)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)

changed = [rel for rel in files(repo)
           if not os.path.isfile(os.path.join(live, rel))
           or not filecmp.cmp(os.path.join(stage, rel), os.path.join(live, rel), shallow=False)]
if not changed:
    sys.exit(0)
# 게시 순서: first(mod.json) → 나머지 → last(main.js). [주의] os.walk 순서는 보장이 없고, main.js 가 mod.json 보다 먼저 놓이면 Herdr 가 «place» 를 모른 채 사본을 자동으로 붙인다. 둘 다 비면 순서는 그대로.
_first, _last = first.split(), last.split()
changed = [r for r in _first if r in changed] + [r for r in changed if r not in _first and r not in _last] + [r for r in _last if r in changed]
# 바뀔 파일이 들어갈 폴더만 본다. .cache 와 설치기가 만들지 않은 폴더는 점검 · 청소 밖(그 안이 쓰기 불가여도 설치는 된다).
def nearest_dir(d):
    while d and not os.path.isdir(d):
        up = os.path.dirname(d)
        if up == d:
            break
        d = up
    return d
need_dirs = [nearest_dir(os.path.dirname(live))] + [nearest_dir(os.path.dirname(os.path.join(live, rel))) for rel in changed]
for d in dict.fromkeys(need_dirs):
    why = unwritable(d)
    if why:
        sys.exit(f"쓸 수 없다: {d} ({why}) · {os.environ.get('FP_NOTE', '바뀐 것 없음')}")
for rel in changed:
    dst = os.path.join(live, rel)
    if os.path.isfile(dst) and getattr(os.stat(dst), "st_flags", 0) & IMMUTABLE:
        sys.exit(f"쓸 수 없다: {dst} (잠금 플래그(uchg 등)) · 바뀐 것 없음")
for b, dirs, _ in os.walk(live):
    if b == live and ".cache" in dirs:
        dirs.remove(".cache")
    if unwritable(b) is None:
        sweep(b)
try:
    # 기존 사용자 파일도 보관한다. 원본 백업 완료 전에는 live 를 고치지 않는다.
    for rel in files(live):
        dst = os.path.join(backup, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(os.path.join(live, rel), dst)
except Exception as exc:
    sys.exit(f"{name}: 백업 실패 — 손대지 않았다: {exc}")
def interrupted(signum, frame):
    raise RuntimeError(f"중단 신호 {signum}")

touched = []
try:
    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGHUP, interrupted)      # 터미널 닫힘 · ssh 끊김: INT/TERM 과 똑같이 되돌린다
    for rel in changed:
        dst = os.path.join(live, rel)
        existed = os.path.lexists(dst)
        if existed and not os.path.isfile(dst):
            raise OSError(f"파일 자리에 폴더가 있다: {dst}")
        touched.append((rel, existed))
        publish(os.path.join(stage, rel), dst)
except BaseException as exc:
    # 복원 중에는 추가 중단 신호를 무시한다.
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    errors = []
    for rel, existed in reversed(touched):
        dst = os.path.join(live, rel)
        try:
            if existed:
                publish(os.path.join(backup, rel), dst)
            elif os.path.lexists(dst):
                os.unlink(dst)
        except Exception as restore_exc:
            errors.append(str(restore_exc))
    if errors:
        sys.exit(f"{name}: 복원 실패 — 백업: {backup}: {'; '.join(errors)}")
    sys.exit(f"{name}: 바꾸다 실패해 되돌렸다: {exc}")
with open(mark, "w") as f:        # 이 단계에서 실제로 바뀌었다는 표시(뒤 단계 실패 메시지용)
    f.write("1\n")
PY
}
if [ -z "$REMOVE_PT" ]; then
STAGE=$(mktemp -d "$APP/.files-plus-stage.XXXXXX")
cp -R "$REPO/files-plus/." "$STAGE/"
if ! "$HERDR_APP" check "$STAGE"; then
  echo "files-plus: check 가 떨어져 손대지 않았다" >&2
  exit 1
fi
publish_mod files-plus "$REPO/files-plus" "$STAGE" .files-plus-backup "" ""
if [ -e "$STAGE/.changed" ]; then
  CHANGED_LIST="$CHANGED_LIST mods/files-plus 갱신됨(원본 백업 $APP/.files-plus-backup/$TS-$$);"
  FP_NOTE="앞 단계에서 mods/files-plus 는 이미 갱신됨(원본 백업 $APP/.files-plus-backup/$TS-$$)"
fi
if [ -n "$PANEL_TABS" ]; then
  # panel-tabs mod: 레이아웃 header 가 이 mod 를 가리키므로 레이아웃보다 먼저 깐다.
  PT_STAGE=$(mktemp -d "$APP/.panel-tabs-stage.XXXXXX")
  cp -R "$REPO/panel-tabs/." "$PT_STAGE/"
  if ! "$HERDR_APP" check "$PT_STAGE"; then
    echo "panel-tabs: check 가 떨어져 손대지 않았다 — $FP_NOTE" >&2
    late_fail 1
  fi
  publish_mod panel-tabs "$REPO/panel-tabs" "$PT_STAGE" .panel-tabs-backup mod.json main.js || late_fail $?
  if [ -e "$PT_STAGE/.changed" ]; then
    CHANGED_LIST="$CHANGED_LIST mods/panel-tabs 갱신됨(원본 백업 $APP/.panel-tabs-backup/$TS-$$);"
    PT_MSG="앞 단계에서 mods/panel-tabs 는 이미 갱신됨(원본 백업 $APP/.panel-tabs-backup/$TS-$$)"
    if [ "$FP_NOTE" = "바뀐 것 없음" ]; then FP_NOTE=$PT_MSG; else FP_NOTE="$FP_NOTE · $PT_MSG"; fi
    export FP_NOTE
  fi
fi
# kit 판 auto-tabs: M2 = 저장소 판으로 바꿔 끼움(관리 파일만 · 그 밖 파일은 그대로) / kit 판이 이미 있고 --hide-files · --show-files = config.js 만 고침.
# [주의] 레이아웃(2단계)보다 먼저 한다 — check 가 떨어지면 레이아웃은 손대지 않은 채 멈춘다. hideFiles 는 예측값($PT_HIDE)을 config.js 에 그대로 써서 header 와 어긋나지 않는다.
if [ -n "$M2" ] || [ -n "$KIT_CFG" ]; then
  TABS_STAGE=$(mktemp -d "$APP/.auto-tabs-stage.XXXXXX") || late_fail $?
  if [ -n "$M2" ]; then
    for _f in mod.json main.js owner.js panels.js names.js config.js win-close.svg win-max.svg win-min.svg win-restore.svg LICENSE-herdr-app; do
      [ ! -f "$REPO/auto-tabs/$_f" ] || cp "$REPO/auto-tabs/$_f" "$TABS_STAGE/$_f" || late_fail $?
    done
    if [ -f "$APP/mods/auto-tabs/main.js" ]; then
      AT_NAMES=$(cfg_py names "$APP/mods/auto-tabs/main.js" "$APP/mods/auto-tabs/config.js")
    else
      AT_NAMES=false
    fi
  else
    # [주의] -p 를 쓰지 않는다(잠금 플래그가 임시 폴더로 옮겨 가 치우지 못한다). 링크는 내용으로 복사한다.
    cp -RL "$APP/mods/auto-tabs/." "$TABS_STAGE/" || { echo "auto-tabs: 검사용 사본을 만들지 못했다 — $FP_NOTE" >&2; late_fail 1; }
    AT_NAMES=$(cfg_py names "$APP/mods/auto-tabs/main.js" "$APP/mods/auto-tabs/config.js")
  fi
  cfg_py write "$TABS_STAGE/config.js" "$AT_NAMES" "$PT_HIDE" || late_fail $?
  if ! "$HERDR_APP" check "$TABS_STAGE"; then
    echo "auto-tabs: check 가 떨어져 손대지 않았다 — $FP_NOTE" >&2
    late_fail 1
  fi
  publish_mod auto-tabs "$TABS_STAGE" "$TABS_STAGE" .auto-tabs-backup mod.json main.js || late_fail $?
  if [ -e "$TABS_STAGE/.changed" ]; then
    CHANGED_LIST="$CHANGED_LIST mods/auto-tabs 갱신됨(원본 폴더 통째 사본 $APP/.auto-tabs-backup/$TS-$$);"
    AT_MSG="앞 단계에서 mods/auto-tabs 는 이미 갱신됨(원본 폴더 통째 사본 $APP/.auto-tabs-backup/$TS-$$)"
    if [ "$FP_NOTE" = "바뀐 것 없음" ]; then FP_NOTE=$AT_MSG; else FP_NOTE="$FP_NOTE · $AT_MSG"; fi
    export FP_NOTE
    echo "auto-tabs: kit 판으로 갱신했다(names=$AT_NAMES hideFiles=$PT_HIDE · 옛 폴더 사본 $APP/.auto-tabs-backup/$TS-$$)"
  else
    echo "auto-tabs: kit 판이 이미 같다(names=$AT_NAMES hideFiles=$PT_HIDE)"
  fi
fi
LAYOUT_MARK="$STAGE/.layout-changed"
else
  # 제거 모드: mod 는 건드리지 않는다. 레이아웃 변경 표시만 둘 임시 폴더.
  PT_STAGE=$(mktemp -d "$APP/.panel-tabs-stage.XXXXXX")
  LAYOUT_MARK="$PT_STAGE/.layout-changed"
fi
export LAYOUT_MARK

# 2. 레이아웃: files-plus 블록 + (--panel-tabs) panel-body header 추가/수정 · (--remove-panel-tabs) header 제거 — 한 번에 계산해 한 번만 저장한다(사본 하나).
layout_py() {
python3 - "$APP" "$LAYOUT" "$TS-$$" "$HERDR_APP_Q" "$1" "$2" "$HERDR_APP" "${3-}" "${4-}" <<'PY'
import json, os, re, shutil, signal, stat, subprocess, sys, tempfile, time

app, name, ts, herdr, pt_mode, pt_hide, herdr_bin, m2, sync = sys.argv[1:10]
want_hide = pt_hide == "true"
link = os.path.join(app, "layouts", name + ".json")
path = os.path.realpath(link)          # 링크면 가리키는 실제 파일에 쓴다(링크는 그대로 · 모드·줄 끝 유지)
with open(path, encoding="utf-8", newline="") as f:
    raw = f.read()
crlf = "\r\n" in raw
root = json.loads(raw)

def find(node, id_):
    if isinstance(node, dict):
        if node.get("id") == id_:
            return node
        for child in node.get("children") or []:
            hit = find(child, id_)
            if hit:
                return hit
    return None

def ours_header(h):
    return isinstance(h, dict) and isinstance(h.get("content"), dict) and h["content"].get("mod") == "panel-tabs"
def header_differs(h, hide):
    if not ours_header(h):
        return True
    props = h["content"].get("props")
    return not (isinstance(props, dict) and props.get("stack") == "panel-body" and props.get("hideFiles") is hide and h.get("height") == 32)

TOOL_IDS = ("files", "files-plus", "changes", "graph")
def remove_node(node, id_):
    # id 가 id_ 인 자식을 부모 children 에서 뺀다(첫 것만).
    if isinstance(node, dict) and isinstance(node.get("children"), list):
        for i, c in enumerate(node["children"]):
            if isinstance(c, dict) and c.get("id") == id_:
                del node["children"][i]
                return True
            if remove_node(c, id_):
                return True
    return False
def ours_stack(node):
    return isinstance(node, dict) and node.get("type") == "stack" and ours_header(node.get("header"))
def set_props(node, stack_id, hide):
    # 우리 header 의 stack · hideFiles · height 만 맞춘다(다른 키 · 순서는 그대로). 바뀌었으면 True.
    h = node["header"]
    if not isinstance(h["content"].get("props"), dict):
        h["content"]["props"] = {}
    p = h["content"]["props"]
    if p.get("stack") == stack_id and p.get("hideFiles") is hide and h.get("height") == 32:
        return False
    p["stack"] = stack_id
    p["hideFiles"] = hide
    h["height"] = 32
    return True

items = []                             # 이번에 바꾼 것: block · header-add · header-update · header-remove · bottom-add · bottom-update · bottom-remove (변경 표시 파일에 한 줄씩)
hide_txt = "true" if want_hide else "false"
body = find(root, "panel-body")
bottom = find(root, "panel-bottom")
if pt_mode == "repair":
    # auto-tabs 실패: 이번에 쓴 header 의 Files 값만 실행 전 상태로 되돌린다.
    h = body.get("header") if isinstance(body, dict) else None
    props = h["content"].get("props") if ours_header(h) else None
    if not isinstance(props, dict):
        sys.exit(f"{path}: 복구할 panel-tabs header props 가 없다")
    props["hideFiles"] = want_hide
elif pt_mode == "remove":
    # 제거: 우리 것(panel-bottom = stack + panel-tabs header · panel-body header = content.mod panel-tabs)만 건드린다. 그 밖(없음 · 다른 header)은 손대지 않는다.
    if ours_stack(bottom):
        if not (isinstance(body, dict) and body.get("type") == "stack"):
            print(f"레이아웃 {name}: panel-body 스택이 없어 panel-bottom 의 도구를 옮길 곳이 없다 — panel-bottom 은 그대로 둔다")
        else:
            if body.get("children") is None:
                body["children"] = []
            if not isinstance(body["children"], list):
                sys.exit(f"{path}: panel-body 의 children 이 목록이 아니다 — 손으로 고친다")
            have = {c.get("id") for c in body["children"] if isinstance(c, dict)}
            for c in bottom.get("children") or []:
                if isinstance(c, dict):
                    if c.get("id") in have:
                        sys.exit(f"레이아웃 {name}: id {c.get('id')} 가 panel-body 와 panel-bottom 양쪽에 있다 — 손으로 고친다. 손댄 것 없음.")
                    have.add(c.get("id"))
                body["children"].append(c)
            remove_node(root, "panel-bottom")
            items.append("bottom-remove")
    if isinstance(body, dict) and ours_header(body.get("header")):
        del body["header"]
        items.append("header-remove")
    if not items:
        print(f"레이아웃 {name}: panel-tabs header · panel-bottom 없음, 바뀐 것 없음")
        sys.exit(0)
else:
    if not body or body.get("type") != "stack":
        sys.exit(f"{path} 에 오른쪽 패널 스택(id panel-body)이 없다. 손으로 연다:\n"
                 f"  {herdr} do pane.split '{{\"direction\":\"right\",\"mod\":\"files-plus\"}}'")
    if body.get("children") is None:
        body["children"] = []
    kids = body["children"]
    if not isinstance(kids, list):
        sys.exit(f"{path}: panel-body 의 children 이 목록이 아니다 — 손으로 고친다")
    # files-plus 블록은 id «files-plus» 가 레이아웃 어디에도 없을 때만 panel-body 에 더한다(panel-bottom 안에 있으면 그대로).
    if find(root, "files-plus"):
        print(f"레이아웃 {name}: files-plus 블록이 이미 있다")
    else:
        at = next((i + 1 for i, c in enumerate(kids) if isinstance(c, dict) and c.get("id") == "files"), len(kids))
        kids.insert(at, {"id": "files-plus", "type": "block", "content": {"mod": "files-plus"}})
        items.append("block")
    if pt_mode == "install":
        cur = body.get("header")
        if cur is not None and not ours_header(cur):
            sys.exit(f"{path}: panel-body 에 panel-tabs 가 아닌 header 가 이미 있다 — 덮어쓰지 않는다")
        if cur is None:
            body["header"] = {"content": {"mod": "panel-tabs", "props": {"stack": "panel-body", "hideFiles": want_hide}}, "height": 32}
            items.append("header-add")
        elif header_differs(cur, want_hide):
            set_props(body, "panel-body", want_hide)
            items.append("header-update")
        else:
            print(f"레이아웃 {name}: panel-tabs header 가 이미 있다(hideFiles={hide_txt})")
        if m2 == "1":
            # M2: 아래 패널 스택 panel-bottom. 도구 id 가 두 스택에 겹치면 2단계 앞(점검)에서 이미 거절했다.
            work = find(root, "work")
            if bottom is not None and not ours_stack(bottom):
                print(f"레이아웃 {name}: id panel-bottom 이 이미 있는데 우리 것(stack + panel-tabs header)이 아니라 아래 패널은 건너뛴다 — 옮기기·닫기·+ 는 오른쪽 패널만(M1 header 는 그대로)")
            elif bottom is None and not (isinstance(work, dict) and work.get("type") == "column" and isinstance(work.get("children"), list)):
                print(f"레이아웃 {name}: work 열(id work · column)이 없어 아래 패널(panel-bottom)은 건너뛴다 — 옮기기·닫기·+ 는 오른쪽 패널만(M1 header 는 그대로)")
            elif bottom is None:
                node = {"id": "panel-bottom", "type": "stack", "size": {"px": 240}, "hidden": True, "children": [],
                        "header": {"content": {"mod": "panel-tabs", "props": {"stack": "panel-bottom", "hideFiles": want_hide}}, "height": 32}}
                wk = work["children"]
                at = next((i for i, c in enumerate(wk) if isinstance(c, dict) and c.get("id") == "status"), len(wk))
                wk.insert(at, node)
                items.append("bottom-add")
            elif set_props(bottom, "panel-bottom", want_hide):
                items.append("bottom-update")
    if sync == "1":
        # kit 판 auto-tabs + --hide-files/--show-files: 우리 header 가 있는 스택의 hideFiles 를 config.js 와 맞춘다.
        for node, sid in ((body, "panel-body"), (bottom, "panel-bottom")):
            if ours_stack(node) and isinstance(node["header"]["content"].get("props"), dict) \
                    and node["header"]["content"]["props"].get("hideFiles") is not want_hide:
                node["header"]["content"]["props"]["hideFiles"] = want_hide
                if "header-update" not in items:
                    items.append("header-update")
    if not items:
        sys.exit(0)
backup = os.path.join(os.path.dirname(link), os.path.basename(link) + f".bak-files-plus-{ts}")
# 들여쓰기 꼴: 원본의 첫 들여쓴 줄에서(탭 또는 공백 수) 읽고, 못 읽으면 2칸. 끝 줄바꿈 · CRLF 도 원본대로.
lf = raw.replace("\r\n", "\n")
mi = re.search(r"^([ \t]+)\S", lf, re.M)
if mi is None: unit = 2
elif mi.group(1).startswith("\t"): unit = "\t"
else: unit = len(mi.group(1))
text = json.dumps(root, ensure_ascii=False, indent=unit) + ("\n" if lf.endswith("\n") else "")
if crlf:
    text = text.replace("\n", "\r\n")
try:
    if json.loads(text) != root:
        raise ValueError("다시 읽은 값이 다르다")
except Exception as exc:
    sys.exit(f"{path}: 새 레이아웃 JSON 검증 실패 — 손대지 않았다: {exc}")
orig_bytes = raw.encode("utf-8")
new_bytes = text.encode("utf-8")
st = os.stat(path)
IMMUTABLE = getattr(stat, "UF_IMMUTABLE", 0) | getattr(stat, "SF_IMMUTABLE", 0) | getattr(stat, "UF_APPEND", 0) | getattr(stat, "SF_APPEND", 0)
def cannot(why):
    sys.exit(f"쓸 수 없다: {path} ({why}) · {os.environ.get('FP_NOTE', '바뀐 것 없음')}")
# 쓰기 전 점검: 읽기 전용(0444) · 잠금 플래그(uchg)는 새 파일로 바꿔 끼우면 우회되므로 먼저 멈춘다. 이때는 사본도 만들지 않는다.
if getattr(st, "st_flags", 0) & IMMUTABLE:
    cannot("잠금 플래그(uchg 등)")
if not os.access(path, os.W_OK):
    cannot("쓰기 권한 없음(읽기 전용 · 소유자)")
if pt_mode != "repair":
    shutil.copy2(path, backup)

def interrupted(signum, frame):
    raise RuntimeError(f"중단 신호 {signum}")
signal.signal(signal.SIGINT, interrupted)
signal.signal(signal.SIGTERM, interrupted)
signal.signal(signal.SIGHUP, interrupted)          # 터미널 닫힘 · ssh 끊김도 INT/TERM 처럼 되돌린다
SIGS = {signal.SIGINT, signal.SIGTERM, signal.SIGHUP}

def atomic_write():
    # 같은 폴더에 임시 파일 → fsync → 모드·소유자·플래그를 맞춘 뒤 실제 경로(링크가 아닌 가리키는 파일)에 os.replace. 죽어도 원본 또는 새 파일 하나만 남는다.
    try:
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".", suffix=".files-plus-tmp")
    except OSError:
        return False                      # 폴더에 임시 파일을 못 만든다(폴더 쓰기 권한 없음) → 제자리 쓰기로
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(new_bytes); f.flush(); os.fsync(f.fileno())
        shutil.copymode(path, tmp)
        ts_ = os.stat(tmp)
        if (ts_.st_uid, ts_.st_gid) != (st.st_uid, st.st_gid):
            try: os.chown(tmp, st.st_uid, st.st_gid)
            except OSError: return False  # 소유자를 못 맞추면(다른 사용자 소유) 바꿔 끼우면 소유자가 바뀐다 → 제자리 쓰기(inode · 소유자 유지)로
        if hasattr(os, "chflags") and getattr(st, "st_flags", 0):
            try: os.chflags(tmp, st.st_flags & ~IMMUTABLE)
            except OSError: pass
        os.replace(tmp, path)
        return True
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)

# [주의] 하드링크(link 수 > 1)는 새 파일로 바꾸면 다른 이름과 갈라지므로 제자리 쓰기(inode 유지)로 쓴다 — 쓰는 동안 죽으면 반쯤 쓴 파일이 남을 수 있다(사본으로 복구). 실패하면 원래 바이트를 다시 쓴다.
def inplace_write():
    try:
        f = open(path, "r+b")
    except OSError as exc:
        cannot(str(exc))
    with f:
        f.write(new_bytes)
        f.truncate()
        f.flush()
        os.fsync(f.fileno())

err_pattern = re.compile(r"^" + re.escape(f"layouts/{name}.json") + r"(?:\s|:|$)")
def herdr_status():
    try:
        r = subprocess.run([herdr_bin, "status"], capture_output=True, text=True, timeout=5)
        d = json.loads(r.stdout) if r.returncode == 0 else None
        return d if isinstance(d, dict) else None
    except Exception:
        return None
def layout_errors(d):
    errs = d.get("errors") if isinstance(d, dict) else None
    return [e for e in (errs if isinstance(errs, list) else []) if isinstance(e, str) and err_pattern.match(e)]
try:
    if st.st_nlink != 1 or not atomic_write():
        inplace_write()
except SystemExit:
    raise
except BaseException as exc:
    # 복원 중에는 중단 신호를 막아 두었다가 끝난 뒤 받는다(막힌 신호는 풀리면 그때 전달).
    signal.pthread_sigmask(signal.SIG_BLOCK, SIGS)
    try:
        with open(path, "r+b") as f:
            f.write(orig_bytes); f.truncate(); f.flush(); os.fsync(f.fileno())
    except Exception as exc2:
        sys.exit(f"{path}: 쓰다 실패, 되돌리기도 실패 — 사본: {backup}: {exc}; {exc2}")
    sys.exit(f"{path}: 쓰다 실패해 되돌렸다: {exc}")

if pt_mode == "repair":
    sys.exit(0)                       # 사본 · 변경 표시는 2단계 것을 유지한다

# [주의] Herdr 는 «지금 떠 있는» 레이아웃 파일이 틀리면 `herdr-app status` JSON 의 errors 에 "layouts/<이름>.json was not applied: …" 를 넣는다(0.1.17 실측 · 0.5초 안 · 고치면 사라짐). layouts/<이름>.error 파일은 쓰지 않는다(단일 layout.error 는 레이아웃을 바꿀 때만 생김).
# [주의] 떠 있지 않은 레이아웃은 Herdr 가 파일을 보지 않아 아무 신호도 없다 → 그때는 검사할 수 없다고 알리기만 한다. status 를 못 읽으면(실패 · JSON 아님) «확인 못 함» 경고만 하고 되돌리지 않는다.
if pt_mode:
    herdr_err = None
    st1 = herdr_status()
    if st1 is None:
        print(f"참고: `herdr-app status` 를 읽지 못해 Herdr 가 새 레이아웃을 받아들였는지 확인하지 못했다 — 직접 `{herdr} status` 로 본다", file=sys.stderr)
    elif st1.get("layout") != name:
        print(f"참고: 레이아웃 {name} 은 지금 떠 있지 않아 Herdr 가 파일을 아직 검사하지 않았다 — 띄운 뒤 `{herdr} status` 의 errors 를 확인한다")
    else:
        try:
            for attempt in range(9):
                if attempt:
                    time.sleep(0.25)
                cur_st = herdr_status() if attempt else st1
                hits = layout_errors(cur_st)
                if hits:
                    herdr_err = "\n".join(hits)
                    break
        except BaseException as exc:
            herdr_err = f"(기다리다 중단: {exc})"
    if herdr_err:
        signal.pthread_sigmask(signal.SIG_BLOCK, SIGS)
        new_bytes = orig_bytes
        try:
            if st.st_nlink != 1 or not atomic_write():
                inplace_write()
        except BaseException as exc2:
            sys.exit(f"{path}: Herdr 가 레이아웃을 거절했고 되돌리기도 실패 — 사본: {backup}: {exc2}\n  Herdr 메시지: {herdr_err}")
        sys.exit(f"레이아웃 {name}: Herdr 가 새 레이아웃을 받아들이지 않았다 — 사본으로 되돌렸다(같이 넣은 블록 · header 도 되돌아감 · mod 폴더는 그대로):\n{herdr_err}")
with open(os.environ["LAYOUT_MARK"], "w") as f:
    f.write("\n".join(items) + "\n")
if "block" in items:
    print(f"레이아웃 {name}: panel-body 에 files-plus 블록을 더했다")
if "header-add" in items:
    print(f"레이아웃 {name}: panel-body 에 panel-tabs header 를 더했다(hideFiles={hide_txt})")
if "header-update" in items:
    print(f"레이아웃 {name}: panel-tabs header 를 고쳤다(hideFiles={hide_txt})")
if "header-remove" in items:
    print(f"레이아웃 {name}: panel-body 에서 panel-tabs header 를 뺐다")
if "bottom-add" in items:
    print(f"레이아웃 {name}: work 열에 아래 패널 panel-bottom 을 더했다(hideFiles={hide_txt})")
if "bottom-update" in items:
    print(f"레이아웃 {name}: panel-bottom header 를 고쳤다(hideFiles={hide_txt})")
if "bottom-remove" in items:
    print(f"레이아웃 {name}: panel-bottom 의 도구를 panel-body 끝으로 옮기고 panel-bottom 을 지웠다")
PY
}
layout_py "$PT_MODE" "$PT_HIDE" "$M2" "$KIT_SYNC" || late_fail $?
if [ -e "$LAYOUT_MARK" ]; then
  LAYOUT_DESC=
  for _it in $(cat "$LAYOUT_MARK"); do
    case $_it in
      block) _ds="files-plus 블록 추가" ;;
      header-add) _ds="panel-tabs header 추가" ;;
      header-update) _ds="panel-tabs header 갱신" ;;
      header-remove) _ds="panel-tabs header 제거" ;;
      bottom-add) _ds="panel-bottom 추가" ;;
      bottom-update) _ds="panel-bottom header 갱신" ;;
      bottom-remove) _ds="panel-bottom 제거(도구는 panel-body 로)" ;;
      *) _ds= ;;
    esac
    [ -z "$_ds" ] || LAYOUT_DESC="${LAYOUT_DESC:+$LAYOUT_DESC · }$_ds"
  done
  CHANGED_LIST="$CHANGED_LIST 레이아웃 $LAYOUT 에 ${LAYOUT_DESC}됨(사본 .bak-files-plus-$TS-$$);"
  FP_NOTE="앞 단계에서 레이아웃 $LAYOUT 은 이미 바뀜(사본 .bak-files-plus-$TS-$$)${CHANGED_LIST:+ · $CHANGED_LIST}"
  export FP_NOTE
fi

# --remove-panel-tabs 는 여기서 끝: mod 복사 · auto-tabs · 패널 열기(4단계) 모두 하지 않는다.
if [ -n "$REMOVE_PT" ]; then
  AT_BACKUP=$(ls -1d "$APP"/.auto-tabs-backup/*/ 2>/dev/null | sort | tail -n 1 || true)
  AT_BACKUP=${AT_BACKUP%/}
  echo "kit 판 auto-tabs 는 그대로 둔다 — 옛 판 사본: ${AT_BACKUP:-없음}"
  [ ! -e "$LAYOUT_MARK" ] || echo "mods/panel-tabs 폴더는 그대로 둔다 — mod.json 이 place:none 이라 화면에 붙지 않는다(폴더까지 지우려면 $APP/mods/panel-tabs 를 지운다)"
  exit 0
fi

# [주의] auto-tabs 실패로 예측이 빗나가면 이번에 쓴 header 만 실행 전 Files 상태로 맞춘다.
auto_tabs_fail() {
  _tabs_rc=$1
  if [ -n "$PANEL_TABS" ] && [ "$PT_HIDE" != "$PT_BEFORE" ] && [ -f "$LAYOUT_MARK" ] && grep -Eq '^header-(add|update)$' "$LAYOUT_MARK"; then
    if layout_py repair "$PT_BEFORE"; then
      _repair="panel-tabs header hideFiles=$PT_BEFORE 로 복구됨(auto-tabs 실패 · 실행 전 Files 상태)"
      echo "[주의] $_repair" >&2
      CHANGED_LIST="$CHANGED_LIST $_repair;"
    else
      _repair="panel-tabs header hideFiles 복구 실패 — 2단계 사본: $APP/layouts/$LAYOUT.json.bak-files-plus-$TS-$$"
      echo "[경고] $_repair" >&2
      CHANGED_LIST="$CHANGED_LIST $_repair;"
    fi
  fi
  late_fail "$_tabs_rc"
}

# 3. auto-tabs 탭바: «Files+» 단추 · (선택) 기본 Files 숨김/보임
TABS_DIR="$APP/mods/auto-tabs"
if [ -n "$KIT_MODE" ]; then
  :   # kit 판(M2 로 방금 깔았거나 이미 깔려 있음): 옛 «Files+» 단추 · Files 필터 패처는 건너뛴다 — 단추 · 숨김은 kit 판 main.js 와 config.js 가 맡는다.
elif [ -f "$TABS_DIR/main.js" ]; then
  TABS_STAGE=$(mktemp -d "$APP/.auto-tabs-stage.XXXXXX") || { rc=$?; [ -z "$PANEL_TABS" ] && exit "$rc"; auto_tabs_fail "$rc"; }
  # [주의] -p 를 쓰지 않는다: -p 는 잠금 플래그(uchg)까지 임시 폴더로 옮겨 치우지 못하게 만든다. 모드는 최종 쓰기에서 원본(copymode)을 따른다.
  cp -RL "$TABS_DIR/." "$TABS_STAGE/" || { echo "auto-tabs: 검사용 사본을 만들지 못했다(읽을 수 없는 파일?) — $FP_NOTE" >&2; auto_tabs_fail 1; }   # 링크는 내용으로 복사한다(검사는 실제 내용으로)
  rc=0
  # 결과 파일 = 항목별 낱말(btn:… · files:…). 종료 0 = 바뀜 · 10 = 바꿀 것 없음.
  RESULT_FILE="$STAGE/.auto-tabs-result"
  autotabs_py "$TABS_STAGE/main.js" "$FILES_MODE" "$RESULT_FILE" || rc=$?
  case $rc in
    0)
      if ! "$HERDR_APP" check "$TABS_STAGE"; then
        echo "auto-tabs: check 가 떨어져 손대지 않았다" >&2
        auto_tabs_fail 1
      fi
      python3 - "$TABS_STAGE/main.js" "$TABS_DIR/main.js" "$TS-$$" <<'PY' || auto_tabs_fail $?
import os, shutil, stat, sys, tempfile

note = os.environ.get("FP_NOTE", "바뀐 것 없음")
src, dst, stamp = sys.argv[1:4]
dst = os.path.realpath(dst)            # main.js 가 링크면 가리키는 실제 파일에 쓴다
_imm = getattr(stat, "UF_IMMUTABLE", 0) | getattr(stat, "SF_IMMUTABLE", 0) | getattr(stat, "UF_APPEND", 0) | getattr(stat, "SF_APPEND", 0)
_d = os.path.dirname(dst)
if getattr(os.stat(_d), "st_flags", 0) & _imm or not os.access(_d, os.W_OK | os.X_OK):
    sys.exit(f"쓸 수 없다: {_d} ({'잠금 플래그(uchg 등)' if getattr(os.stat(_d), 'st_flags', 0) & _imm else '쓰기 권한 없음'}) · {note}")
if getattr(os.stat(dst), "st_flags", 0) & _imm:
    sys.exit(f"쓸 수 없다: {dst} (잠금 플래그(uchg 등)) · {note}")
if not os.access(dst, os.W_OK):
    sys.exit(f"쓸 수 없다: {dst} (쓰기 권한 없음(읽기 전용 · 소유자)) · {note}")
backup = os.path.join(os.path.dirname(dst), f".main.js.bak-files-plus-{stamp}")
tmp = None
try:
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(dst), prefix=".", suffix=".files-plus-tmp")
    os.close(fd)
    shutil.copy2(src, tmp)
    shutil.copy2(dst, backup)
    shutil.copymode(dst, tmp)          # 원래 파일의 모드(0644 등)를 되살린다(임시 파일은 0600)
    os.replace(tmp, dst)
except OSError as exc:
    sys.exit(f"auto-tabs: main.js 를 쓰지 못했다: {exc} · main.js {note if note != '바뀐 것 없음' else '는 그대로'}")
finally:
    if tmp and os.path.exists(tmp):
        os.unlink(tmp)
PY
      ;;
    10) ;;
    *) echo "auto-tabs: 고치다 실패해 손대지 않았다(rc $rc)" >&2; auto_tabs_fail 1 ;;
  esac
  for item in $(cat "$RESULT_FILE" 2>/dev/null); do
    case $item in
      btn:added) echo "auto-tabs: «Files+» 단추를 더했다" ;;
      btn:exists) echo "auto-tabs: «Files+» 단추가 이미 있다" ;;
      btn:mismatch) echo "auto-tabs: «Files+» 단추 자리의 모양이 예상과 달라 손대지 않았다 — 패널 단추는 손으로 더한다(README «화면에 띄우기»)" >&2 ;;
      files:hidden) echo "auto-tabs: 기본 Files 단추를 숨겼다(files 블록은 그대로 · --show-files 로 되돌림)" ;;
      files:hidden-already) echo "auto-tabs: 기본 Files 는 이미 숨겨 있다" ;;
      files:shown) echo "auto-tabs: 기본 Files 단추를 되돌렸다" ;;
      files:shown-already) echo "auto-tabs: 기본 Files 는 이미 보인다" ;;
      files:hidden-custom) echo "auto-tabs: 기본 Files 줄에 사용자 .filter(…files…) 가 있어 손대지 않았다(숨겨졌는지는 직접 확인)" ;;
      files:mismatch) echo "auto-tabs: Files 숨김 자리의 모양이 달라(사용자가 고친 필터 등) Files 는 손대지 않았다" >&2 ;;
    esac
  done
else
  echo "auto-tabs 가 없다 — 패널 단추 없이 연다: $HERDR_APP_Q do layout.select '{\"stack\":\"panel-body\",\"child\":\"files-plus\"}' 뒤 layout.show '{\"id\":\"panel\"}'"
  [ -z "$FILES_MODE" ] || echo "auto-tabs 가 없어 --$FILES_MODE 는 건너뛴다(auto-tabs 레이아웃에서만 듣는다)" >&2
fi

# 4. 지금 떠 있는 레이아웃이면 패널을 files-plus 로 연다 — files-plus 가 있는 쪽(오른쪽 panel-body · 아래 panel-bottom)을 연다.
OPEN_STACK=$(python3 - "$APP/layouts/$LAYOUT.json" <<'PY' 2>/dev/null
import json, sys

def find(node, id_):
    if isinstance(node, dict):
        if node.get("id") == id_:
            return node
        for child in node.get("children") or []:
            hit = find(child, id_)
            if hit:
                return hit

def ours_stack(node):
    h = node.get("header") if isinstance(node, dict) else None
    return isinstance(node, dict) and node.get("type") == "stack" and isinstance(h, dict) and isinstance(h.get("content"), dict) and h["content"].get("mod") == "panel-tabs"

def has_files(node):
    return isinstance(node, dict) and node.get("type") == "stack" and any(isinstance(c, dict) and c.get("id") == "files-plus" for c in node.get("children") or [])

try:
    with open(sys.argv[1], encoding="utf-8") as f:
        root = json.load(f)
    b = find(root, "panel-bottom")
    print("panel-bottom" if ours_stack(b) and has_files(b) else "panel-body" if has_files(find(root, "panel-body")) else "")
except Exception:
    print("")
PY
) || OPEN_STACK=
OPEN_VIS=panel
[ "$OPEN_STACK" != panel-bottom ] || OPEN_VIS=panel-bottom
if [ -z "$OPEN_STACK" ]; then
  echo "files-plus 가 있는 관리 패널 없음 — 열기 건너뜀"
elif [ "$LAYOUT" = "$ACTIVE" ]; then
  # 방금 레이아웃 파일을 고쳤다 → 앱이 다시 읽는 사이에는 select 가 실패할 수 있다: 몇 번 짧게 다시 해 본다.
  opened=
  for try in 1 2 3 4 5 6; do
    if "$HERDR_APP" do layout.select "{\"stack\":\"$OPEN_STACK\",\"child\":\"files-plus\"}" >/dev/null 2>&1 \
      && "$HERDR_APP" do layout.show "{\"id\":\"$OPEN_VIS\"}" >/dev/null 2>&1; then opened=1; break; fi
    sleep 0.5
  done
  if [ -n "$opened" ]; then
    echo "패널을 files-plus 로 열었다"
  else
    echo "앱이 안 떠 있는 듯하다 — 띄운 뒤 탭바 «Files+» 를 누른다"
  fi
else
  echo "레이아웃 $LAYOUT 은 지금 떠 있지 않다 — $HERDR_APP_Q do layout.switch '{\"name\":\"$LAYOUT\"}'"
fi

# Files 를 숨겼는데 레이아웃 파일의 패널이 files 에 맞춰져 있으면 알린다(블록은 남으니 단추 없이 그 패널이 뜰 수 있다)
if [ "$FILES_MODE" = hide-files ] && [ "$LAYOUT" != "$ACTIVE" ]; then
  python3 - "$APP/layouts/$LAYOUT.json" <<'PY'
import json, sys

def find(node, id_):
    if isinstance(node, dict):
        if node.get("id") == id_:
            return node
        for child in node.get("children") or []:
            hit = find(child, id_)
            if hit:
                return hit

try:
    with open(sys.argv[1], encoding="utf-8") as f:
        body = find(json.load(f), "panel-body")
    if body and body.get("active") == "files":
        print("참고: 이 레이아웃의 패널은 files 에 맞춰져 있다 — 띄운 뒤 탭바 «Files+» 를 누르면 바뀐다")
except Exception:
    pass
PY
fi
