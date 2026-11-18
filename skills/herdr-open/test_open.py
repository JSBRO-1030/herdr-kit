"""herdr-open 시험 — 앱·코어 없이 문서(doc.get/doc.set)를 가짜로 바꿔 끼워 블록 꼴과 «이미 열림» 판정을 본다.

    python3 -I skills/herdr-open/test_open.py

files-plus «페이지로»(mods/files-plus/preview.js)가 여는 html-viewer 블록은 props {space, machine, file} 이다.
이 도구도 같은 꼴로 쓰고, 어느 쪽이 연 뷰어든 같은 파일 · 같은 머신이면 «이미 열림»으로 본다.
"""
import contextlib
import copy
import importlib.util
import io
import os
import pathlib
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("herdr_open", HERE / "open.py")
O = importlib.util.module_from_spec(spec)
spec.loader.exec_module(O)

M = "box-a"   # Mac 앱이 이 머신을 부르는 이름(시험용)


def doc_with(*extra):
    return {"spaces": [{"id": "sp1", "tabs": [{"id": "tb1", "root": {"id": "tb1", "type": "row", "children": [
        {"id": "pt", "type": "block", "content": {"terminal": "t1"}, "size": {"weight": 1.0}}, *extra]}}]}]}


def files_plus_viewer(path, machine):
    # preview.js toPage(): run("pane.split", {mod:"html-viewer", props:{space, machine: this.on ?? null, file}})
    return {"id": "pfp", "type": "block", "content": {"mod": "html-viewer",
            "props": {"space": f"{M}/sp1", "machine": machine, "file": path}}, "size": {"weight": 1.0}}


class Fake:
    def __init__(self, doc):
        self.doc, self.ver, self.writes = doc, 7, []

    def read(self):
        return copy.deepcopy(self.doc), self.ver

    def write(self, value, version):
        assert version == self.ver
        self.doc, self.ver = copy.deepcopy(value), self.ver + 1
        self.writes.append(value)
        return self.ver


class HerdrOpen(unittest.TestCase):
    def setUp(self):
        os.environ["HERDR_APP_MACHINE"] = M
        os.environ["HC_TERMINAL_ID"] = "t1"
        self.tmp = tempfile.TemporaryDirectory()
        self.md = os.path.join(self.tmp.name, "a.md")
        pathlib.Path(self.md).write_text("# a\n")
        self.md = str(pathlib.Path(self.md).resolve())

    def tearDown(self):
        self.tmp.cleanup()

    def run_open(self, fake):
        saved = {k: getattr(O, k) for k in ("read_doc", "write_doc", "backup", "record", "render_started")}
        O.read_doc, O.write_doc = fake.read, fake.write
        O.backup = lambda value, version: "/dev/null"
        O.record = lambda entry: None
        O.render_started = lambda since: "started"
        out = io.StringIO()
        try:
            with contextlib.redirect_stdout(out):
                O.cmd_open(type("A", (), {"file": self.md, "tab": False, "dry_run": False})())
        finally:
            for k, v in saved.items():
                setattr(O, k, v)
        return out.getvalue()

    def test_block_shape_matches_files_plus(self):
        props = O.viewer_block("sp1", self.md)["content"]["props"]
        self.assertEqual(props, {"space": f"{M}/sp1", "machine": M, "file": self.md})
        self.assertEqual(sorted(props), sorted(files_plus_viewer(self.md, M)["content"]["props"]))

    def test_viewer_machine_follows_place_js(self):
        self.assertEqual(O.viewer_machine({"space": "m1/sp", "machine": "m2"}), "m2")   # machine 이 앞선다
        self.assertIsNone(O.viewer_machine({"space": "m1/sp", "machine": None}))        # None = Mac 자신의 파일
        self.assertEqual(O.viewer_machine({"space": "m1/sp"}), "m1")                     # 옛 꼴 = space 앞부분
        self.assertIsNone(O.viewer_machine({"space": "sp"}))

    def test_open_writes_machine(self):
        fake = Fake(doc_with())
        out = self.run_open(fake)
        self.assertTrue(out.startswith("ok side"), out)
        kids = fake.doc["spaces"][0]["tabs"][0]["root"]["children"]
        self.assertEqual(kids[-1]["content"]["props"]["machine"], M)

    def test_files_plus_viewer_counts_as_already(self):
        fake = Fake(doc_with(files_plus_viewer(self.md, M)))
        out = self.run_open(fake)
        self.assertTrue(out.startswith("already"), out)
        self.assertEqual(fake.writes, [])

    def test_old_shape_viewer_counts_as_already(self):
        old = files_plus_viewer(self.md, M)
        del old["content"]["props"]["machine"]          # 고치기 전 herdr-open 이 쓴 꼴
        out = self.run_open(Fake(doc_with(old)))
        self.assertTrue(out.startswith("already"), out)

    def test_same_path_on_mac_is_not_already(self):
        fake = Fake(doc_with(files_plus_viewer(self.md, None)))   # Mac 의 같은 경로 파일
        out = self.run_open(fake)
        self.assertTrue(out.startswith("ok side"), out)
        self.assertEqual(len(fake.writes), 1)

    def test_same_path_other_machine_is_not_already(self):
        out = self.run_open(Fake(doc_with(files_plus_viewer(self.md, "box-b"))))
        self.assertTrue(out.startswith("ok side"), out)

    def test_close_force_on_fresh_box(self):
        # 처음 쓰는 상자(기록 폴더 없음)에서 지울 것이 없는 close <id> --force 도 오류 없이 끝나야 한다
        fake = Fake(doc_with())
        saved = {k: getattr(O, k) for k in ("read_doc", "write_doc", "STATE", "OPENED", "BACKUP")}
        O.read_doc, O.write_doc = fake.read, fake.write
        O.STATE = pathlib.Path(self.tmp.name) / "state-not-yet"
        O.OPENED, O.BACKUP = O.STATE / "opened.jsonl", O.STATE / "backup"
        out = io.StringIO()
        try:
            with contextlib.redirect_stdout(out):
                O.cmd_close(type("A", (), {"ids": ["pnope"], "force": True})())
        finally:
            for k, v in saved.items():
                setattr(O, k, v)
        self.assertIn("이미 없음", out.getvalue())
        self.assertEqual(fake.writes, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
