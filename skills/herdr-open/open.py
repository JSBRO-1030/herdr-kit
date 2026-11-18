#!/usr/bin/env python3
"""herdr-open — 이 상자의 HTML·Markdown 파일을 오너 Mac Herdr 앱의 html-viewer 패널로 연다.

길: 이 머신 코어의 `herdr-app` 문서(앱이 이 머신의 공간·탭·분할을 저장하는 곳)에
html-viewer 블록을 써 넣는다. 앱은 doc 이벤트를 받으면 문서를 다시 읽어 화면을 바꾼다
(herdr-app v0.1.10~0.1.12 `src/mirror_sync.rs` read · `src/mirror.rs` Document::replace).
근거·실측·함정은 같은 폴더 SKILL.md.

  open.py open <파일> [--tab] [--dry-run]   내 탭 오른쪽(기본) 또는 새 탭에 연다
  open.py close [블록id ...]                 이 도구가 연 뷰어를 닫는다(id 없으면 전부)
  open.py ls                                 문서 안의 html-viewer 블록 목록
  open.py restore <백업 파일>                 비상용: 백업한 문서로 되돌린다
"""
import argparse
import copy
import datetime as dt
import json
import os
import pathlib
import secrets
import subprocess
import sys
import time

PEERS = pathlib.Path.home() / ".local" / "state" / "herdr-core" / "default" / "peers.json"
MOD = "html-viewer"
DOC = "herdr-app"
STATE = pathlib.Path.home() / ".cache" / "herdr-open"
OPENED = STATE / "opened.jsonl"
BACKUP = STATE / "backup"
KEEP_BACKUPS = 30
EXT = {".md", ".markdown", ".html", ".htm"}
TRIES = 6


class Conflict(Exception):
    pass


def die(msg, code=1):
    print(f"herdr-open: {msg}", file=sys.stderr)
    sys.exit(code)


def app_machine():
    """Mac 앱이 이 머신을 부르는 이름. HERDR_APP_MACHINE 이 있으면 그것, 없으면 코어 peers.json 의 calls_me."""
    if os.environ.get("HERDR_APP_MACHINE"):
        return os.environ["HERDR_APP_MACHINE"]
    try:
        peers = json.loads(PEERS.read_text())
    except (OSError, json.JSONDecodeError) as e:
        die(f"{PEERS} 를 못 읽음({e}) — HERDR_APP_MACHINE 으로 이름을 줘라")
    names = {p.get("calls_me") for p in peers.values() if isinstance(p, dict) and p.get("calls_me")}
    if len(names) != 1:
        die(f"{PEERS} 의 calls_me 가 하나가 아니다({sorted(names) or '없음'}) — HERDR_APP_MACHINE 으로 이름을 줘라")
    return names.pop()


def rpc(method, params):
    line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, ensure_ascii=False)
    try:
        p = subprocess.run(["hc", "connect"], input=line + "\n", capture_output=True, text=True, timeout=20)
    except subprocess.TimeoutExpired:
        die(f"{method}: hc connect 20초 안에 답 없음")
    for raw in p.stdout.splitlines():
        raw = raw.strip()
        if not raw:
            continue
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if msg.get("id") != 1:
            continue
        if "error" in msg:
            err = msg["error"]
            if (err.get("data") or {}).get("kind") == "conflict":
                raise Conflict(err.get("message", ""))
            die(f"{method} 실패: {err.get('message')} {err.get('data')}")
        return msg["result"]
    die(f"{method}: hc connect 응답 없음 (rc={p.returncode}) {p.stderr.strip()[:300]}")


def read_doc():
    r = rpc("doc.get", {"name": DOC})
    if not isinstance(r.get("value"), dict) or not isinstance(r["value"].get("spaces"), list):
        die("이 머신의 앱 구조 문서가 비었거나 꼴이 다르다 — 앱이 이 머신에 붙은 적이 없거나 앱 판이 바뀌었다")
    return r["value"], r["version"]


def write_doc(value, version):
    return rpc("doc.set", {"name": DOC, "value": value, "version": version})["version"]


def backup(value, version):
    BACKUP.mkdir(parents=True, exist_ok=True)
    os.chmod(STATE, 0o700)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    path = BACKUP / f"{stamp}-v{version}.json"
    path.write_text(json.dumps({"version": version, "value": value}, ensure_ascii=False))
    for old in sorted(BACKUP.glob("*.json"))[:-KEEP_BACKUPS]:
        old.unlink()
    return path


def tabs(doc):
    for s in doc["spaces"]:
        for t in s.get("tabs", []):
            yield s, t


def nodes(node):
    yield node
    for c in node.get("children", []) or []:
        yield from nodes(c)


def me():
    tid = os.environ.get("HC_TERMINAL_ID")
    if not tid:
        die("hc 터미널 안이 아니다($HC_TERMINAL_ID 없음)")
    return tid


def my_place(doc):
    """내 터미널이 있는 공간·탭. 문서 안 터미널 id로 먼저 찾고, 없으면 hc 라벨로.
    공간 라벨만 맞고 탭을 모르면 (공간, None) — 부른 쪽이 새 탭으로 연다."""
    tid = me()
    for s, t in tabs(doc):
        for n in nodes(t.get("root") or {}):
            if (n.get("content") or {}).get("terminal") == tid:
                return s, t
    g = subprocess.run(["hc", "get", tid, "--json"], capture_output=True, text=True)
    labels = (json.loads(g.stdout or "{}").get("labels") or {}) if g.returncode == 0 else {}
    sp, tb = labels.get("herdr.space"), labels.get("herdr.tab")
    for s in doc["spaces"]:
        if s.get("id") == sp:
            return s, next((t for t in s.get("tabs", []) if t.get("id") == tb), None)
    die(f"내 터미널 {tid}이 앱 화면 구조에 없다(앱에 안 보이는 터미널) — 공간 라벨 {sp}")


def viewer_block(space_id, path):
    # files-plus «페이지로»(mods/files-plus/preview.js)와 같은 꼴 {space, machine, file}.
    # html-viewer(place.js placeOf)는 props 에 machine 이 있으면 그것을 그 파일의 머신으로 쓴다.
    m = app_machine()
    return {
        "id": "p" + secrets.token_hex(16),
        "type": "block",
        "content": {"mod": MOD, "props": {"space": f"{m}/{space_id}", "machine": m, "file": path}},
        "size": {"weight": 1.0},
    }


def viewer_machine(props):
    """html-viewer 가 파일을 찾는 머신 — place.js placeOf 와 같은 순서: props.machine(None = Mac 자신),
    없으면 space id 앞부분(`<머신>/sp…`). files-plus 가 연 뷰어와 이 도구가 연 뷰어를 같은 잣대로 본다."""
    if "machine" in props:
        return props["machine"]
    sp = props.get("space") or ""
    return sp.split("/", 1)[0] if "/" in sp else None


def is_viewer(n, path=None):
    c = n.get("content") or {}
    if c.get("mod") != MOD:
        return False
    if path is None:
        return True
    props = c.get("props") or {}
    return props.get("file") == path and viewer_machine(props) == app_machine()


def record(entry):
    STATE.mkdir(parents=True, exist_ok=True)
    with OPENED.open("a") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def opened():
    if not OPENED.exists():
        return []
    return [json.loads(l) for l in OPENED.read_text().splitlines() if l.strip()]


def render_started(since):
    """html-viewer는 파일이 있는 이 머신에서 node 렌더러를 띄운다 — 그 시작이 «앱이 그렸다»의 증거."""
    end = time.time() + 20
    while time.time() < end:
        j = subprocess.run(
            ["journalctl", "--user", "--since", f"@{int(since)}", "--no-pager", "-o", "cat", "-u", "herdr-html-*"],
            capture_output=True, text=True,
        )
        if "Started herdr-html-" in j.stdout:
            return "started"
        time.sleep(2)
    a = subprocess.run(
        ["systemctl", "--user", "list-units", "--state=active", "--no-legend", "herdr-html-*"],
        capture_output=True, text=True,
    )
    return "running" if a.stdout.strip() else "none"


def cas(edit):
    """읽기 → 고치기 → 버전 맞춰 쓰기. 충돌(앱이 그 사이 문서를 바꿈)이면 다시 읽어 다시 고친다."""
    for _ in range(TRIES):
        doc, ver = read_doc()
        new = copy.deepcopy(doc)
        result = edit(new)
        if result is None:
            return None, ver, None
        bpath = backup(doc, ver)
        try:
            nver = write_doc(new, ver)
            return result, nver, bpath
        except Conflict:
            time.sleep(0.5)
    die(f"문서 쓰기 {TRIES}번 모두 충돌 — 잠시 뒤 다시")


def cmd_open(a):
    path = str(pathlib.Path(a.file).expanduser().resolve())
    if not os.path.isfile(path):
        die(f"파일 없음: {path}")
    if pathlib.Path(path).suffix.lower() not in EXT:
        die(f"html-viewer는 HTML·Markdown만 연다: {path}")
    mode = "tab" if a.tab else "side"
    info = {}

    def edit(doc):
        s, t = my_place(doc)
        root = (t or {}).get("root") or {}
        same_space = [n for tt in s.get("tabs", []) for n in nodes(tt.get("root") or {})]
        if any(is_viewer(n, path) for n in same_space):
            info.update(space=s["id"], already=True)
            return None
        block = viewer_block(s["id"], path)
        m = mode
        if m == "side" and (t is None or root.get("type") != "row"):
            m = "tab"  # 내 탭을 모르거나 위아래 나눔·겹침이면 구조를 건드리지 않고 새 탭으로
        if m == "side":
            root["children"].append(block)
            tab_id = t["id"]
        else:
            tab_id = "tb" + secrets.token_hex(16)
            new_tab = {"id": tab_id, "name": pathlib.Path(path).stem,
                       "root": {"id": tab_id, "type": "row", "children": [block]}}
            at = s["tabs"].index(t) + 1 if t is not None else len(s["tabs"])
            s["tabs"].insert(at, new_tab)
        info.update(space=s["id"], tab=tab_id, block=block["id"], mode=m)
        return info

    if a.dry_run:
        doc, ver = read_doc()
        new = copy.deepcopy(doc)
        r = edit(new)
        print(json.dumps({"version": ver, "change": r or info, "space": [x for x in new["spaces"] if x["id"] == info.get("space")]},
                         ensure_ascii=False, indent=1))
        return
    since = time.time() - 1
    r, ver, bpath = cas(edit)
    if r is None:
        print(f"already {path} — 이 공간에 이미 열려 있음(ls로 확인, close로 닫기)")
        return
    record({"t": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "by": me(), "file": path, **r})
    doc, _ = read_doc()
    if not any(n.get("id") == r["block"] for _, t in tabs(doc) for n in nodes(t.get("root") or {})):
        die(f"썼는데 다시 읽으니 블록 {r['block']}이 없다 — 앱이 바로 덮었을 수 있다(ls로 확인 · 백업 {bpath})")
    shown = render_started(since) if r["mode"] == "side" else "skip"
    word = {"started": "렌더 시작 확인(이 머신 herdr-html 유닛 시작)",
            "running": "렌더러가 이미 돌던 중 — 새 시작 기록은 없음, 화면에서 확인",
            "none": "20초 안에 렌더 시작 없음 — 앱이 꺼졌거나 Mac이 끊겼거나 머신 이름(HERDR_APP_MACHINE="
                    f"{app_machine()})이 틀림",
            "skip": "새 탭은 앱이 포커스를 옮기지 않는다 — 오너가 탭을 눌러야 그린다"}[shown]
    print(f"ok {r['mode']} block={r['block']} tab={r['tab']} version={ver} — {word}")
    print(f"backup {bpath}")


def prune(node, ids, gone):
    """ids에 든 html-viewer 블록을 빼고, 그 때문에 빈 row·column 자식도 뺀다(앱의 collapse와 같은 쪽).
    stack은 비어도 두고, 자식 하나짜리 풀기는 앱에 맡긴다."""
    kids = node.get("children")
    if not kids:
        return
    keep = []
    for c in kids:
        if c.get("id") in ids and is_viewer(c):
            gone.append(c["id"])
            continue
        before = len(gone)
        prune(c, ids, gone)
        if len(gone) > before and c.get("type") in ("row", "column") and not c.get("children"):
            continue
        keep.append(c)
    node["children"] = keep


def remove_blocks(doc, ids, made_tabs):
    gone = []
    for s in doc["spaces"]:
        for t in list(s.get("tabs", [])):
            root = t.get("root") or {}
            prune(root, ids, gone)
            if t["id"] in made_tabs and not root.get("children"):
                s["tabs"].remove(t)
    return gone


def cmd_close(a):
    every = opened()
    tid = me()
    if a.ids:
        known = {e["block"] for e in every}
        strange = [i for i in a.ids if i not in known]
        if strange and not a.force:
            die(f"이 도구가 연 기록이 없는 블록: {' '.join(strange)} — 오너가 연 것일 수 있다(정말이면 --force)")
        ids = set(a.ids)
    else:
        ids = {e["block"] for e in every if e.get("by") == tid}
    made = {e["tab"] for e in every if e.get("mode") == "tab"}
    if not ids:
        print(f"닫을 뷰어 없음(이 터미널 {tid}이 연 것 기준 · 다른 터미널 것은 ls 뒤 close <id>)")
        return
    out = {}

    def edit(doc):
        gone = remove_blocks(doc, ids, made)
        if not gone:
            return None
        out["gone"] = gone
        return out

    r, ver, bpath = cas(edit)
    if r is None:
        print("문서에 그 뷰어가 이미 없음")
    else:
        print(f"closed {' '.join(r['gone'])} version={ver}")
        print(f"backup {bpath}")
    still = set()
    doc, _ = read_doc()
    for _, t in tabs(doc):
        still |= {n.get("id") for n in nodes(t.get("root") or {}) if is_viewer(n)}
    STATE.mkdir(parents=True, exist_ok=True)  # 처음 쓰는 상자에서 지울 것이 없으면(backup 이 안 돌아) 폴더가 아직 없다
    OPENED.write_text("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in every if e["block"] in still))


def cmd_ls(a):
    doc, ver = read_doc()
    mine = {e["block"] for e in opened()}
    print(f"version {ver}")
    for s, t in tabs(doc):
        for n in nodes(t.get("root") or {}):
            if is_viewer(n):
                props = n["content"].get("props") or {}
                where = viewer_machine(props) or "Mac"
                print(f"{n['id']}\t{'mine' if n['id'] in mine else '-'}\t{s['id']}/{t['id']}\t{where}\t{props.get('file', '(목록 화면)')}")


def cmd_restore(a):
    saved = json.loads(pathlib.Path(a.backup).read_text())
    value = saved.get("value")
    if not isinstance(value, dict) or not isinstance(value.get("spaces"), list) or not value["spaces"]:
        die(f"백업 꼴이 아니다(spaces 목록 없음): {a.backup}")
    for _ in range(TRIES):
        r = rpc("doc.get", {"name": DOC})  # 지금 문서가 깨졌어도 읽어서 남긴다
        now_backup = backup(r.get("value"), r["version"])
        try:
            nver = write_doc(value, r["version"])
            break
        except Conflict:
            time.sleep(0.5)
    else:
        die(f"되돌리기 {TRIES}번 모두 충돌")
    print(f"restored {a.backup} (백업 당시 v{saved['version']}) → version={nver}")
    print(f"backup(되돌리기 전 문서) {now_backup}")


def main():
    p = argparse.ArgumentParser(prog="open.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    o = sub.add_parser("open")
    o.add_argument("file")
    o.add_argument("--tab", action="store_true", help="내 탭 옆이 아니라 같은 공간의 새 탭으로")
    o.add_argument("--dry-run", action="store_true", help="쓰지 않고 바뀔 공간만 보인다")
    c = sub.add_parser("close")
    c.add_argument("ids", nargs="*")
    c.add_argument("--force", action="store_true", help="이 도구 기록에 없는 블록 id도 닫는다")
    sub.add_parser("ls")
    r = sub.add_parser("restore")
    r.add_argument("backup")
    a = p.parse_args()
    {"open": cmd_open, "close": cmd_close, "ls": cmd_ls, "restore": cmd_restore}[a.cmd](a)


if __name__ == "__main__":
    main()
