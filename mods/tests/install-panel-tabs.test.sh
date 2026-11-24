#!/bin/sh
# 실제 앱 대신 PATH 맨 앞 스텁만 사용한다. 테스트 데이터는 임시 폴더 안에만 둔다.
set -eu
REPO=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
INSTALL="$REPO/install-mac.sh"
TMP=$(mktemp -d)
trap 'rm -r -f "$TMP"' 0
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir "$TMP/bin"
cat > "$TMP/bin/herdr-app" <<'STUB'
#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$STUB_LOG"
case ${1-} in
  --version) printf '%s\n' "${STUB_VERSION:-herdr-app 0.1.17}" ;;
  check)
    case ${2-} in
      *.auto-tabs-stage.*)
        if [ -f "$STUB_CONTROL/auto-check-fail" ]; then
          cp "$HERDR_APP_HOME/layouts/my-main.json" "$STUB_CONTROL/check-layout"
          python3 - "$HERDR_APP_HOME/layouts/my-main.json" > "$STUB_CONTROL/check-inode" <<'PY_INODE'
import os,sys
print(os.stat(sys.argv[1]).st_ino)
PY_INODE
          if [ -f "$STUB_CONTROL/repair-fail" ]; then
            mv "$HERDR_APP_HOME/layouts/my-main.json" "$STUB_CONTROL/blocked-layout"
            mkdir "$HERDR_APP_HOME/layouts/my-main.json"
          fi
          exit 91
        fi ;;
    esac
    exit 0 ;;
  status)
    # 레이아웃 쓰기 직후 오류 전환 → 첫 post-write 응답의 오류도 복구해야 한다.
    if [ -f "$STUB_CONTROL/post-error" ] && ! cmp -s "$HERDR_APP_HOME/layouts/my-main.json" "$STUB_CONTROL/original"; then
      cat "$STUB_CONTROL/post-status"
    else
      cat "$STUB_CONTROL/status"
    fi ;;
  do) exit 0 ;;
  *) exit 97 ;;
esac
STUB
chmod +x "$TMP/bin/herdr-app"
PATH="$TMP/bin:$PATH"
export PATH
PASS=0
FAIL=0
CASE=0
setup() {
  CASE=$((CASE + 1))
  CONTROL="$TMP/case-$CASE"
  APP="$CONTROL/app"
  mkdir -p "$APP/layouts" "$APP/mods/auto-tabs"
  HERDR_APP_HOME=$APP STUB_CONTROL=$CONTROL STUB_LOG="$CONTROL/stub.log"
  export HERDR_APP_HOME STUB_CONTROL STUB_LOG
  unset STUB_VERSION
  : > "$STUB_LOG"
  printf '{"layout":"my-main"}\n' > "$APP/shared.json"
  printf '{}\n' > "$APP/installed.json"
  printf '{"layout":"my-main","errors":[]}\n' > "$CONTROL/status"
  printf '{"layout":"my-main","errors":["layouts/my-main.json was not applied: rejected"]}\n' > "$CONTROL/post-status"
  python3 - "$APP/layouts/my-main.json" <<'PY'
import json,sys
body={"id":"panel-body","type":"stack","active":"files","children":[{"id":n,"type":"block","content":{"mod":n}} for n in ["files","files-plus","changes","graph"]]}
panel={"id":"panel","type":"column","size":{"px":368},"children":[body]}
with open(sys.argv[1],"w") as f: json.dump({"id":"root","type":"row","children":[panel]},f,indent=2); f.write("\n")
PY
  cat > "$APP/mods/auto-tabs/main.js" <<'JS'
const enabled = ["files", "changes", "graph"];
const panels = (shared("workspace.panels") ?? ["files", "changes"]);
const bar = row()
      .when(enabled.includes("files"), b => b.child(panelButton("files", "Files", "folder.svg")))
      .when(enabled.includes("changes"), b => b.child(panelButton("changes", "Changes", "changes.svg")));
JS
  printf '{"name":"auto-tabs","place":"tabs"}\n' > "$APP/mods/auto-tabs/mod.json"
}
run() {
  RC=0
  sh "$INSTALL" "$@" > "$CONTROL/output" 2>&1 || RC=$?
}
header() {
  python3 - "$APP/layouts/my-main.json" "$1" <<'PY'
import json,sys
b=json.load(open(sys.argv[1]))["children"][0]["children"][0]
h=b.get("header")
if sys.argv[2]=="none": assert h is None, h
else: assert h=={"content":{"mod":"panel-tabs","props":{"stack":"panel-body","hideFiles":sys.argv[2]=="true"}},"height":32},h
PY
}
snapshot() {
  python3 - "$APP" <<'PY'
import os,sys,stat,hashlib,json
root=sys.argv[1]; result=[]
for base,dirs,names in os.walk(root):
    for n in sorted(dirs+names):
        p=os.path.join(base,n); s=os.lstat(p)
        value=os.readlink(p) if stat.S_ISLNK(s.st_mode) else hashlib.sha256(open(p,"rb").read()).hexdigest() if stat.S_ISREG(s.st_mode) else None
        result.append((os.path.relpath(p,root),s.st_mode,s.st_nlink,value))
print(json.dumps(sorted(result)))
PY
}
unchanged_refusal() {
  snapshot > "$CONTROL/before"
  run "$@"
  [ "$RC" -eq 1 ] || return 1
  snapshot > "$CONTROL/after"
  cmp -s "$CONTROL/before" "$CONTROL/after"
}
report() {
  label=$1
  shift
  if "$@"; then PASS=$((PASS + 1)); printf 'PASS %s\n' "$label"
  else FAIL=$((FAIL + 1)); printf 'FAIL %s\n' "$label"; cat "$CONTROL/output" 2>/dev/null || true; fi
}
fresh() {
  run --panel-tabs
  [ "$RC" -eq 0 ] && header false && [ -f "$APP/mods/panel-tabs/main.js" ] &&
    [ -f "$APP/mods/files-plus/main.js" ] && grep -q '^--version$' "$STUB_LOG" &&
    grep -q '^check ' "$STUB_LOG" && grep -q '^status$' "$STUB_LOG" && grep -q '^do ' "$STUB_LOG"
}
rerun() {
  cp "$APP/layouts/my-main.json" "$CONTROL/layout-before"
  run --panel-tabs
  [ "$RC" -eq 0 ] && cmp -s "$CONTROL/layout-before" "$APP/layouts/my-main.json"
}
flip() {
  run --panel-tabs "$1"
  [ "$RC" -eq 0 ] && header "$2" || return 1
  if [ "$2" = true ]; then grep -q 'filter(p => p !== "files")' "$APP/mods/auto-tabs/main.js"
  else ! grep -q 'filter(p => p !== "files")' "$APP/mods/auto-tabs/main.js"; fi
}
refused_transform() {
  python3 - "$APP/mods/auto-tabs/main.js" "$1" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
if sys.argv[2]=="custom": s=s.replace('const panels = (shared("workspace.panels") ?? ["files", "changes"]);','const panels = (shared("workspace.panels") ?? ["files", "changes"]).filter(p => p === "files");')
else: s=s.replace('const panels = (shared("workspace.panels") ?? ["files", "changes"]);','const panels = customPanels;')
open(p,"w").write(s)
PY
  run --panel-tabs --hide-files
  [ "$RC" -eq 0 ] && header false && grep -q "$2" "$CONTROL/output"
}
no_auto() {
  rm -r "$APP/mods/auto-tabs"
  run --panel-tabs --hide-files
  [ "$RC" -eq 0 ] && header false
}
no_flag_hidden() {
  run --panel-tabs
  [ "$RC" -eq 0 ] && header true
}
foreign() {
  python3 - "$APP/layouts/my-main.json" <<'PY'
import json,sys
p=sys.argv[1]; d=json.load(open(p)); d["children"][0]["children"][0]["header"]={"content":{"mod":"custom"},"height":40}; json.dump(d,open(p,"w"))
PY
  unchanged_refusal --panel-tabs
}
remove() {
  run --remove-panel-tabs
  [ "$RC" -eq 0 ] && header none && [ -f "$APP/mods/panel-tabs/main.js" ]
}
remove_again() {
  cp "$APP/layouts/my-main.json" "$CONTROL/layout-before"
  run --remove-panel-tabs
  [ "$RC" -eq 0 ] && cmp -s "$CONTROL/layout-before" "$APP/layouts/my-main.json"
}
old_version() {
  STUB_VERSION='herdr-app 0.1.16'; export STUB_VERSION
  unchanged_refusal --panel-tabs
}
link_refusal() {
  mkdir -p "$APP/mods/panel-tabs/nested"
  printf 'existing\n' > "$CONTROL/link-target"
  if [ "$1" = symlink ]; then ln -s "$CONTROL/link-target" "$APP/mods/panel-tabs/nested/custom.js"
  else ln "$CONTROL/link-target" "$APP/mods/panel-tabs/nested/custom.js"; fi
  unchanged_refusal --panel-tabs && grep -q '링크' "$CONTROL/output"
}
pre_error() {
  cp "$CONTROL/post-status" "$CONTROL/status"
  unchanged_refusal "$1" && grep -q 'layouts/my-main.json was not applied: rejected' "$CONTROL/output" && grep -q '먼저 고친' "$CONTROL/output"
}
post_error() {
  cp "$APP/layouts/my-main.json" "$CONTROL/original"
  : > "$CONTROL/post-error"
  run --panel-tabs
  [ "$RC" -eq 1 ] && cmp -s "$CONTROL/original" "$APP/layouts/my-main.json" && grep -q '되돌렸다' "$CONTROL/output"
}
exact_match() {
  printf '{"layout":"my-main","errors":["layouts/my-main.json.bak was not applied: other","layouts/my-main2.json was not applied: other"]}\n' > "$CONTROL/status"
  run --panel-tabs
  [ "$RC" -eq 0 ] && header false
}
auto_failure() {
  mode=$1 before=$2
  if [ "$before" = true ]; then
    python3 - "$APP/mods/auto-tabs/main.js" "$APP/layouts/my-main.json" <<'PY_HIDDEN'
import json,sys
p=sys.argv[1]; s=open(p).read(); s=s.replace('const panels = (shared("workspace.panels") ?? ["files", "changes"]);', 'const panels = (shared("workspace.panels") ?? ["files", "changes"]).filter(p => p !== "files");'); open(p,"w").write(s)
p=sys.argv[2]; d=json.load(open(p)); d["children"][0]["children"][0]["header"]={"content":{"mod":"panel-tabs","props":{"stack":"panel-body","hideFiles":True}},"height":32}; json.dump(d,open(p,"w"),indent=2)
PY_HIDDEN
  fi
  cp "$APP/mods/auto-tabs/main.js" "$CONTROL/auto-before"
  : > "$CONTROL/auto-check-fail"
  run --panel-tabs "$mode"
  [ "$RC" -ne 0 ] && header "$before" &&
    cmp -s "$CONTROL/auto-before" "$APP/mods/auto-tabs/main.js" &&
    grep -q "panel-tabs header hideFiles=$before 로 복구됨" "$CONTROL/output" &&
    [ "$(find "$APP/layouts" -name '*.bak-files-plus-*' | wc -l | tr -d ' ')" = 1 ]
}
auto_failure_unchanged() {
  : > "$CONTROL/auto-check-fail"
  cp "$APP/mods/auto-tabs/main.js" "$CONTROL/auto-before"
  run --panel-tabs --show-files
  [ "$RC" -ne 0 ] && header false &&
    cmp -s "$CONTROL/auto-before" "$APP/mods/auto-tabs/main.js" &&
    cmp -s "$CONTROL/check-layout" "$APP/layouts/my-main.json" &&
    ! grep -q 'hideFiles.*복구' "$CONTROL/output" || return 1
  python3 - "$APP/layouts/my-main.json" "$CONTROL/check-inode" <<'PY_INODE'
import os,sys
assert os.stat(sys.argv[1]).st_ino == int(open(sys.argv[2]).read())
PY_INODE
}
auto_failure_hardlink() {
  python3 - "$APP/layouts/my-main.json" <<'PY_CRLF'
import sys
p=sys.argv[1]; b=open(p,"rb").read().replace(b"  ",b"\t").replace(b"\n",b"\r\n"); open(p,"wb").write(b)
PY_CRLF
  ln "$APP/layouts/my-main.json" "$CONTROL/layout-link"
  auto_failure --hide-files false || return 1
  python3 - "$APP/layouts/my-main.json" "$CONTROL/layout-link" "$CONTROL/check-layout" <<'PY_CRLF'
import os,sys
p,link,staged=sys.argv[1:]; b=open(p,"rb").read()
assert os.stat(p).st_ino == os.stat(link).st_ino
assert b"\r\n" in b and b"\n" not in b.replace(b"\r\n",b"") and b"\t" in b
assert b == open(staged,"rb").read().replace(b'"hideFiles": true',b'"hideFiles": false')
PY_CRLF
}
auto_failure_repair_error() {
  : > "$CONTROL/auto-check-fail"
  : > "$CONTROL/repair-fail"
  run --panel-tabs --hide-files
  [ "$RC" -ne 0 ] && grep -q '\[경고\].*hideFiles 복구 실패.*2단계 사본:' "$CONTROL/output" &&
    grep -q "$APP/layouts/my-main.json.bak-files-plus-" "$CONTROL/output" &&
    [ "$(find "$APP/layouts" -name '*.bak-files-plus-*' | wc -l | tr -d ' ')" = 1 ]
}
conflict() {
  snapshot > "$CONTROL/before"
  run "$@"
  [ "$RC" -eq 2 ] || return 1
  snapshot > "$CONTROL/after"
  cmp -s "$CONTROL/before" "$CONTROL/after" && [ ! -s "$STUB_LOG" ]
}
setup
report 'fresh install / stub invocation log' fresh
report 'rerun preserves layout bytes' rerun
report 'hide Files' flip --hide-files true
report 'no Files flag preserves detected hidden state' no_flag_hidden
report 'show Files' flip --show-files false
report 'remove header' remove
report 'remove again preserves layout bytes' remove_again
setup; report 'fresh install and hide Files together' flip --hide-files true
setup; report 'F1 refused custom transform keeps current state' refused_transform custom '사용자 .filter'
setup; report 'F1 refused mismatch keeps current state' refused_transform mismatch '모양이 달라'
setup; report 'stock top bar hideFiles=false' no_auto
setup; report 'foreign header refusal changes nothing' foreign
setup; report 'version 0.1.16 refusal changes nothing' old_version
setup; report 'F2 nested symlink refusal changes nothing' link_refusal symlink
setup; report 'F2 nested hardlink refusal changes nothing' link_refusal hardlink
setup; report 'F3 pre-existing shown error refusal changes nothing' pre_error --panel-tabs
setup; report 'F3 remove pre-existing error refusal changes nothing' pre_error --remove-panel-tabs
setup; report 'F3 first post-write error restores original bytes' post_error
setup; report 'F3 exact layout filename matching' exact_match
setup; report 'flag conflict install/remove' conflict --panel-tabs --remove-panel-tabs
setup; report 'flag conflict remove/hide' conflict --remove-panel-tabs --hide-files
setup; report 'flag conflict remove/show' conflict --remove-panel-tabs --show-files
setup; report 'flag conflict hide/show' conflict --hide-files --show-files
setup; report 'F4 hide check failure restores shown header' auto_failure --hide-files false
setup; report 'F4 show check failure restores hidden header' auto_failure --show-files true
setup; report 'F4 unchanged hideFiles skips repair write' auto_failure_unchanged
setup; report 'F4 repair preserves hardlink / tabs / CRLF' auto_failure_hardlink
setup; report 'F4 repair failure reports step-2 backup' auto_failure_repair_error
printf '%s PASS, %s FAIL\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
