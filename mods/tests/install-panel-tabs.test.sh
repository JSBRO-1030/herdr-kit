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
# ---- M2 (옮기기 · 닫기 · 「+」): kit 판 auto-tabs 바꿔 끼우기 + panel-bottom ----
# 저장소 mods/auto-tabs 가 아직 덜 채워졌어도 시험이 돌도록 임시 저장소 사본에 있는 것은 복사하고 없는 관리 파일만 시험용으로 만든다(저장소 파일은 건드리지 않는다).
K="$TMP/k"
mkdir -p "$K/auto-tabs"
cp "$INSTALL" "$K/install-mac.sh"
cp -R "$REPO/files-plus" "$K/files-plus"
cp -R "$REPO/panel-tabs" "$K/panel-tabs"
for f in mod.json main.js owner.js panels.js names.js config.js win-close.svg win-max.svg win-min.svg win-restore.svg panel-right.svg panel-bottom.svg LICENSE-herdr-app; do
  if [ -f "$REPO/auto-tabs/$f" ]; then cp "$REPO/auto-tabs/$f" "$K/auto-tabs/$f"
  else case $f in
    mod.json) printf '{"name":"auto-tabs","place":"tabs"}\n' > "$K/auto-tabs/$f" ;;
    main.js) printf '// herdr-kit auto-tabs 2 (test fixture)\nimport config from "./config.js";\n// syncNames\n' > "$K/auto-tabs/$f" ;;
    config.js) printf 'export default { names: false, hideFiles: false };\n' > "$K/auto-tabs/$f" ;;
    *) printf 'fixture %s\n' "$f" > "$K/auto-tabs/$f" ;;
  esac; fi
done
head -n 1 "$K/auto-tabs/main.js" | grep -q '^// herdr-kit auto-tabs 2' || { echo "kit main.js 첫 줄 표식이 없다" >&2; exit 1; }
setup2() {
  setup
  INSTALL="$K/install-mac.sh"
  STUB_VERSION='herdr-app 0.1.18'; export STUB_VERSION
  python3 - "$APP/layouts/my-main.json" <<'PY'
import json,sys
body={"id":"panel-body","type":"stack","active":"files","children":[{"id":n,"type":"block","content":{"mod":n}} for n in ["files","files-plus","changes","graph"]]}
panel={"id":"panel","type":"column","size":{"px":368},"hidden":True,"children":[body]}
work={"id":"work","type":"column","children":[{"id":"top","type":"block","content":{"mod":"auto-tabs"}},{"id":"term","type":"block","content":{"mod":"terminal"}},{"id":"status","type":"block","content":{"mod":"status"}}]}
with open(sys.argv[1],"w") as f: json.dump({"id":"root","type":"row","children":[work,panel]},f,indent=2); f.write("\n")
PY
}
# 레이아웃을 파이썬 식으로 고친다: lay '<식>' — d 는 레이아웃, find(id) 로 노드를 찾는다.
lay() {
  python3 - "$APP/layouts/my-main.json" "$1" <<'PY'
import json,sys
p=sys.argv[1]; d=json.load(open(p))
def find(n,i):
    if isinstance(n,dict):
        if n.get("id")==i: return n
        for c in n.get("children") or []:
            h=find(c,i)
            if h: return h
exec(sys.argv[2])
json.dump(d,open(p,"w"),indent=2); open(p,"a").write("\n")
PY
}
# 레이아웃을 검사한다: chk '<assert 식>'
chk() {
  python3 - "$APP/layouts/my-main.json" "$1" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
def find(n,i):
    if isinstance(n,dict):
        if n.get("id")==i: return n
        for c in n.get("children") or []:
            h=find(c,i)
            if h: return h
def ids(n): return [c["id"] for c in (find(d,n) or {}).get("children",[])]
exec(sys.argv[2])
PY
}
cfg_is() { grep -qF "export default { names: $1, hideFiles: $2 };" "$APP/mods/auto-tabs/config.js"; }
hdrs() {
  chk "
for sid in ('panel-body','panel-bottom'):
    h=find(d,sid)['header']
    assert h=={'content':{'mod':'panel-tabs','props':{'stack':sid,'hideFiles':$([ "$1" = true ] && echo True || echo False)}},'height':32},(sid,h)"
}
backups() { find "$APP/.auto-tabs-backup" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' '; }
m2_swap() {
  printf 'user\n' > "$APP/mods/auto-tabs/notes.txt"; printf 'dts\n' > "$APP/mods/auto-tabs/gpui-kit.d.ts"; printf 'old\n' > "$APP/mods/auto-tabs/panel-right.svg"
  cp "$APP/mods/auto-tabs/main.js" "$CONTROL/old-main"
  run --panel-tabs
  [ "$RC" -eq 0 ] || return 1
  head -n 1 "$APP/mods/auto-tabs/main.js" | grep -q '^// herdr-kit auto-tabs 2' || return 1
  cmp -s "$K/auto-tabs/main.js" "$APP/mods/auto-tabs/main.js" || return 1
  for _s in panel-right.svg panel-bottom.svg; do cmp -s "$K/auto-tabs/$_s" "$APP/mods/auto-tabs/$_s" || return 1; done
  [ "$(backups)" = 1 ] || return 1
  B=$(find "$APP/.auto-tabs-backup" -mindepth 1 -maxdepth 1 -type d)
  cmp -s "$B/main.js" "$CONTROL/old-main" && [ -f "$B/mod.json" ] && [ -f "$B/notes.txt" ] && [ -f "$B/gpui-kit.d.ts" ] && [ "$(cat "$B/panel-right.svg")" = old ] || return 1
  case $B in */.auto-tabs-backup/[0-9]*-[0-9]*) ;; *) return 1 ;; esac
  cfg_is false false && grep -q '^check .*auto-tabs-stage' "$STUB_LOG"
}
m2_keep_nonmanaged() {
  printf 'user\n' > "$APP/mods/auto-tabs/notes.txt"; printf 'dts\n' > "$APP/mods/auto-tabs/gpui-kit.d.ts"; printf '{}\n' > "$APP/mods/auto-tabs/jsconfig.json"
  run --panel-tabs
  [ "$RC" -eq 0 ] && [ "$(cat "$APP/mods/auto-tabs/notes.txt")" = user ] && [ "$(cat "$APP/mods/auto-tabs/gpui-kit.d.ts")" = dts ] && [ -f "$APP/mods/auto-tabs/jsconfig.json" ]
}
m2_names_true() {
  printf '\nsyncNames();\n' >> "$APP/mods/auto-tabs/main.js"
  run --panel-tabs
  [ "$RC" -eq 0 ] && cfg_is true false || return 1
  run --panel-tabs        # kit 판이 된 뒤에는 옛 config 의 names 를 이어 간다
  [ "$RC" -eq 0 ] && cfg_is true false
}
m2_names_false() {
  run --panel-tabs
  [ "$RC" -eq 0 ] && cfg_is false false || return 1
  grep -q syncNames "$APP/mods/auto-tabs/main.js" || return 1     # kit main.js 글에 syncNames 가 있어도 config 가 false 면 false
  run --panel-tabs
  [ "$RC" -eq 0 ] && cfg_is false false
}
m2_hide_from_old_filter() {
  python3 - "$APP/mods/auto-tabs/main.js" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read(); s=s.replace('const panels = (shared("workspace.panels") ?? ["files", "changes"]);','const panels = (shared("workspace.panels") ?? ["files", "changes"]).filter(p => p !== "files");'); open(p,"w").write(s)
PY
  run --panel-tabs
  [ "$RC" -eq 0 ] && cfg_is false true && hdrs true
}
m2_flags() {
  run --panel-tabs --hide-files
  [ "$RC" -eq 0 ] && cfg_is false true && hdrs true || return 1
  run --panel-tabs --show-files
  [ "$RC" -eq 0 ] && cfg_is false false && hdrs false || return 1
  # --panel-tabs 없이도(kit 판이 깔려 있으면) config.js 와 두 header 를 함께 고친다
  run --hide-files
  [ "$RC" -eq 0 ] && cfg_is false true && hdrs true || return 1
  run --show-files
  [ "$RC" -eq 0 ] && cfg_is false false && hdrs false
}
m2_shape() {
  run --panel-tabs
  [ "$RC" -eq 0 ] || return 1
  chk "
w=find(d,'work')['children']
i=[c['id'] for c in w].index('panel-bottom')
assert w[i+1]['id']=='status' and i==2,[c['id'] for c in w]
exp={'id':'panel-bottom','type':'stack','size':{'px':240},'hidden':True,'children':[],'header':{'content':{'mod':'panel-tabs','props':{'stack':'panel-bottom','hideFiles':False}},'height':32}}
assert json.dumps(w[i])==json.dumps(exp),w[i]"
}
m2_shape_no_status() {
  lay "find(d,'work')['children'].pop()"
  run --panel-tabs
  [ "$RC" -eq 0 ] && chk "assert ids('work')==['top','term','panel-bottom'],ids('work')"
}
m2_idempotent() {
  run --panel-tabs
  [ "$RC" -eq 0 ] || return 1
  lay "
b=find(d,'panel-bottom'); g=[c for c in find(d,'panel-body')['children'] if c['id']=='graph'][0]
find(d,'panel-body')['children'].remove(g); b['children'].append(g); b['hidden']=False; b['active']='graph'; b['size']={'px':300}"
  cp "$APP/layouts/my-main.json" "$CONTROL/layout-before"
  cp -R "$APP/mods" "$CONTROL/mods-before"
  run --panel-tabs
  [ "$RC" -eq 0 ] && cmp -s "$CONTROL/layout-before" "$APP/layouts/my-main.json" && [ "$(backups)" = 1 ] &&
    diff -r "$CONTROL/mods-before" "$APP/mods" >/dev/null &&
    chk "b=find(d,'panel-bottom'); assert ids('panel-bottom')==['graph'] and b['hidden'] is False and b['active']=='graph' and b['size']=={'px':300}"
}
m2_idempotent_fix_props() {
  # 우리 panel-bottom 은 header props 만 맞춘다(children · hidden · size · active 그대로)
  run --panel-tabs
  lay "
b=find(d,'panel-bottom'); b['children'].append({'id':'graph','type':'block','content':{'mod':'graph'}}); b['hidden']=False; b['active']='graph'
find(d,'panel-body')['children']=[c for c in find(d,'panel-body')['children'] if c['id']!='graph']
b['header']['content']['props']['hideFiles']=True; b['header']['height']=10"
  run --panel-tabs
  [ "$RC" -eq 0 ] && hdrs false && chk "b=find(d,'panel-bottom'); assert ids('panel-bottom')==['graph'] and b['hidden'] is False and b['active']=='graph' and b['size']=={'px':240}"
}
m2_foreign_bottom() {
  lay "find(d,'work')['children'].insert(1,{'id':'panel-bottom','type':'stack','children':[]})"
  run --panel-tabs
  [ "$RC" -eq 0 ] && grep -q 'panel-bottom 이 이미 있는데' "$CONTROL/output" &&
    chk "assert json.dumps(find(d,'panel-bottom'))==json.dumps({'id':'panel-bottom','type':'stack','children':[]}); assert find(d,'panel-body')['header']['content']['mod']=='panel-tabs'"
}
m2_no_work() {
  lay "find(d,'work')['id']='w2'"
  run --panel-tabs
  [ "$RC" -eq 0 ] && grep -q 'work 열' "$CONTROL/output" &&
    chk "assert find(d,'panel-bottom') is None; assert find(d,'panel-body')['header']['content']['mod']=='panel-tabs'"
}
m2_dup() {
  lay "
b={'id':'panel-bottom','type':'stack','hidden':True,'children':[{'id':'graph','type':'block','content':{'mod':'graph'}}],'header':{'content':{'mod':'panel-tabs','props':{'stack':'panel-bottom','hideFiles':False}},'height':32}}
find(d,'work')['children'].insert(2,b)"
  unchanged_refusal --panel-tabs && grep -q '양쪽' "$CONTROL/output"
}
m2_files_plus_in_bottom() {
  lay "
body=find(d,'panel-body'); fp=[c for c in body['children'] if c['id']=='files-plus'][0]; body['children'].remove(fp)
b={'id':'panel-bottom','type':'stack','hidden':True,'children':[fp],'header':{'content':{'mod':'panel-tabs','props':{'stack':'panel-bottom','hideFiles':False}},'height':32}}
find(d,'work')['children'].insert(2,b)"
  run --panel-tabs
  [ "$RC" -eq 0 ] && chk "assert ids('panel-body')==['files','changes','graph'] and ids('panel-bottom')==['files-plus']" &&
    grep -qF 'do layout.select {"stack":"panel-bottom","child":"files-plus"}' "$STUB_LOG" &&
    grep -qF 'do layout.show {"id":"panel-bottom"}' "$STUB_LOG" && ! grep -qF '{"id":"panel"}' "$STUB_LOG"
}
m2_open_right() {
  run --panel-tabs
  [ "$RC" -eq 0 ] && grep -qF 'do layout.select {"stack":"panel-body","child":"files-plus"}' "$STUB_LOG" &&
    grep -qF 'do layout.show {"id":"panel"}' "$STUB_LOG"
}
m2_foreign_files_plus() {
  lay "
body=find(d,'panel-body'); fp=[c for c in body['children'] if c['id']=='files-plus'][0]; body['children'].remove(fp)
find(d,'work')['children'].insert(2,{'id':'panel-bottom','type':'stack','hidden':True,'children':[fp]})"
  run --panel-tabs
  [ "$RC" -eq 0 ] && chk "assert ids('panel-bottom')==['files-plus'] and 'files-plus' not in ids('panel-body')" &&
    ! grep -q '^do layout.select ' "$STUB_LOG" && ! grep -q '^do layout.show ' "$STUB_LOG"
}
m2_remove() {
  run --panel-tabs
  lay "
b=find(d,'panel-bottom'); body=find(d,'panel-body')
g=[c for c in body['children'] if c['id']=='graph'][0]; ch=[c for c in body['children'] if c['id']=='changes'][0]
body['children']=[c for c in body['children'] if c['id'] not in ('graph','changes')]
b['children']=[g,{'id':'x1','type':'block','content':{'mod':'x'}},ch]"
  run --remove-panel-tabs
  [ "$RC" -eq 0 ] && chk "
assert find(d,'panel-bottom') is None
assert ids('panel-body')==['files','files-plus','graph','x1','changes'],ids('panel-body')
assert 'header' not in find(d,'panel-body')
assert ids('work')==['top','term','status']" &&
    head -n 1 "$APP/mods/auto-tabs/main.js" | grep -q '^// herdr-kit auto-tabs 2' &&
    grep -q "옛 판 사본: $APP/.auto-tabs-backup/" "$CONTROL/output"
}
m2_remove_collision() {
  run --panel-tabs
  [ "$RC" -eq 0 ] || return 1
  lay "find(d,'panel-bottom')['children']=[{'id':'files','type':'block','content':{'mod':'custom'}}]"
  cp "$APP/layouts/my-main.json" "$CONTROL/layout-before"
  run --remove-panel-tabs
  [ "$RC" -ne 0 ] && cmp -s "$CONTROL/layout-before" "$APP/layouts/my-main.json" &&
    grep -q 'files' "$CONTROL/output" && grep -q '손으로 고친다' "$CONTROL/output"
}
m2_remove_backup_none() {
  run --remove-panel-tabs
  [ "$RC" -eq 0 ] && grep -q '옛 판 사본: 없음' "$CONTROL/output"
}
m2_bytes_equal() {
  cp "$APP/layouts/my-main.json" "$CONTROL/orig"
  run --panel-tabs
  [ "$RC" -eq 0 ] && ! cmp -s "$CONTROL/orig" "$APP/layouts/my-main.json" || return 1
  run --remove-panel-tabs
  [ "$RC" -eq 0 ] && cmp -s "$CONTROL/orig" "$APP/layouts/my-main.json"
}
m2_no_auto_block() {
  lay "find(d,'work')['children']=[c for c in find(d,'work')['children'] if c['id']!='top']"
  run --panel-tabs
  [ "$RC" -eq 0 ] && grep -q '위쪽 바가 auto-tabs 가 아니라 옮기기·닫기·+ 는 꺼짐(M1 탭 줄만)' "$CONTROL/output" &&
    chk "assert find(d,'panel-bottom') is None; assert find(d,'panel-body')['header']['content']['mod']=='panel-tabs'" &&
    ! head -n 1 "$APP/mods/auto-tabs/main.js" | grep -q 'herdr-kit' && [ ! -d "$APP/.auto-tabs-backup" ]
}
m2_old_version() {
  STUB_VERSION='herdr-app 0.1.17'; export STUB_VERSION
  run --panel-tabs
  [ "$RC" -eq 0 ] && grep -q 'Herdr 0.1.18 미만 — 옮기기·닫기·+ 는 꺼짐' "$CONTROL/output" &&
    chk "assert find(d,'panel-bottom') is None; assert find(d,'panel-body')['header']['content']['mod']=='panel-tabs'" &&
    ! head -n 1 "$APP/mods/auto-tabs/main.js" | grep -q 'herdr-kit' && [ ! -d "$APP/.auto-tabs-backup" ]
}
m2_check_fail() {
  cp "$APP/mods/auto-tabs/main.js" "$CONTROL/auto-before"
  cp "$APP/layouts/my-main.json" "$CONTROL/layout-before"
  : > "$CONTROL/auto-check-fail"
  run --panel-tabs
  [ "$RC" -ne 0 ] && cmp -s "$CONTROL/auto-before" "$APP/mods/auto-tabs/main.js" &&
    cmp -s "$CONTROL/layout-before" "$APP/layouts/my-main.json" &&
    [ ! -f "$APP/mods/auto-tabs/config.js" ] && [ ! -d "$APP/.auto-tabs-backup" ] &&
    [ "$(find "$APP/mods/auto-tabs" -type f | wc -l | tr -d ' ')" = 2 ]
}
m2_link_refusal() {
  mkdir -p "$APP/mods/auto-tabs/nested"
  printf 'existing\n' > "$CONTROL/link-target"
  ln -s "$CONTROL/link-target" "$APP/mods/auto-tabs/nested/custom.js"
  unchanged_refusal --panel-tabs && grep -q '링크' "$CONTROL/output"
}
setup2; report 'M2 kit swap + full-folder backup' m2_swap
setup2; report 'M2 non-managed auto-tabs files are kept' m2_keep_nonmanaged
setup2; report 'M2 names=true when old main.js has syncNames (and sticks)' m2_names_true
setup2; report 'M2 names=false (kit main.js text with syncNames does not count)' m2_names_false
setup2; report 'M2 hideFiles carried from old filter' m2_hide_from_old_filter
setup2; report 'M2 hide/show flags rewrite config.js and both headers' m2_flags
setup2; report 'M2 panel-bottom exact shape before status' m2_shape
setup2; report 'M2 panel-bottom goes last without status' m2_shape_no_status
setup2; report 'M2 reinstall idempotent, moved tool + state survive' m2_idempotent
setup2; report 'M2 own panel-bottom: only header props fixed' m2_idempotent_fix_props
setup2; report 'M2 foreign panel-bottom refused, M1 header kept' m2_foreign_bottom
setup2; report 'M2 no work column skips bottom, M1 header kept' m2_no_work
setup2; report 'M2 duplicate tool id refused, nothing changed' m2_dup
setup2; report 'M2 files-plus in bottom not re-added, bottom opened' m2_files_plus_in_bottom
setup2; report 'M2 step 4 opens right panel when files-plus is in panel-body' m2_open_right
setup2; report 'F6 foreign panel-bottom files-plus skips select/show' m2_foreign_files_plus
setup2; report 'M2 remove moves tools back, deletes panel-bottom, keeps kit' m2_remove
setup2; report 'F2 remove colliding id refused, layout byte-equal' m2_remove_collision
setup2; report 'M2 remove without any backup says none' m2_remove_backup_none
setup2; report 'M2 install then remove is byte-equal to the backup' m2_bytes_equal
setup2; report 'layout without auto-tabs block skips M2 (M1 only)' m2_no_auto_block
setup2; report '0.1.17 skips M2 (M1 only)' m2_old_version
setup2; report 'M2 check failure leaves auto-tabs and layout untouched' m2_check_fail
setup2; report 'M2 nested symlink in auto-tabs refused' m2_link_refusal
printf '%s PASS, %s FAIL\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
