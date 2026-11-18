---
name: herdr-open
description: 이 상자(원격 리눅스)의 HTML·Markdown 파일을 사용자 Mac 의 Herdr 앱 화면에 html-viewer 패널로 자동으로 연다 — 리드 탭 오른쪽 또는 같은 공간의 새 탭. 사용자가 «앱에서 열어줘»「보여줘」「띄워줘」라고 하거나, 기획서·보고서·문서 파일을 사용자에게 보여 줄 때 쓴다. Mac 에 `herdr-app do tab.new …` 를 돌려 달라고 안내하지 않는다.
---

# herdr-open — 문서를 Herdr 앱 화면에 연다

도구: `~/.claude/skills/herdr-open/open.py` (아래 `O`) · 시험: `python3 -I test_open.py`(앱·코어 없이 8개)

```bash
O=~/.claude/skills/herdr-open/open.py
$O open docs/기획.md            # 내 탭 오른쪽에 뷰어 패널(기본) — 내 터미널 폭이 반으로 준다
$O open docs/기획.md --tab      # 같은 공간의 새 탭(앱이 포커스를 옮기지 않는다 — 사용자가 눌러야 보인다)
$O open docs/기획.md --dry-run  # 쓰지 않고 바뀔 공간만 보인다
$O ls                           # 문서 안 html-viewer 블록(mine = 이 도구가 연 것 · 머신 · 파일)
$O close                        # 이 터미널($HC_TERMINAL_ID)이 연 뷰어를 닫는다 · close <블록id> 로 하나만
$O restore ~/.cache/herdr-open/backup/<파일>.json   # 비상용(아래 «되돌리기»)
```

- 필요: 이 상자의 hc 터미널 안(`$HC_TERMINAL_ID`) · Mac Herdr 앱에 **html-viewer** mod 가 깔려 있을 것 · 파일을 그릴 이 상자에 `node`.
- `open`·`close` 출력 첫 낱말: `ok`(썼다 · 뒤에 렌더 판정) · `already`(이 공간에 같은 파일 · 같은 머신의 뷰어가 이미 열려 있다) · `closed`. 실패는 `herdr-open: …` 을 stderr 로 찍고 rc 1.
- 내 터미널이 문서에 없고 공간 라벨만 맞으면 그 공간의 새 탭으로 연다.
- 파일 하나를 보여 준 뒤 일이 끝나면 `close` 로 닫는다(사용자가 남기라고 하면 남긴다).

## files-plus 와 같은 꼴

같은 저장소 `mods/files-plus` 의 «페이지로»(`preview.js` `toPage`)는 html-viewer 를 `{space, machine, file}` 로 연다. 이 도구도 같은 꼴로 쓴다:

```json
{"id":"p<32hex>","type":"block","content":{"mod":"html-viewer","props":{"space":"<머신>/sp…","machine":"<머신>","file":"/절대/경로.md"}},"size":{"weight":1.0}}
```

- html-viewer(`place.js` `placeOf`)는 `props.machine` 이 있으면 그 머신의 파일을 그린다(`null` = Mac 자신). 없으면 공간의 머신, 그다음 `space` 앞부분.
- `already`·`ls` 도 같은 순서로 머신을 읽는다. 그래서 files-plus 가 연 뷰어든 이 도구가 연 뷰어든 «같은 파일 · 같은 머신»이면 `already` 다. Mac 의 같은 경로 파일(`machine: null`)이나 다른 머신의 뷰어는 별개로 본다.
- Mac 에서 확인하는 순서: 저장소 `docs/test-herdr-open-on-mac.md`.

## 머신 이름

`props.space` 앞부분과 `props.machine` 은 **Mac 앱이 이 머신을 부르는 이름**이어야 한다. 코어 `~/.local/state/herdr-core/default/peers.json` 의 `calls_me` 에서 읽는다(Mac 하나가 붙어 있으면 하나). 하나가 아니거나 못 읽으면 `open.py` 가 멈추니 `HERDR_APP_MACHINE=<이름>` 으로 준다. 이름이 틀리면 앱이 «unknown machine "<이름>"» 을 낸다.

## 어떻게 여나

- 이 상자에는 `herdr-app` 명령이 없다(그건 Mac 쪽이다). 대신 앱은 **이 머신의 공간·탭·분할을 이 머신 코어의 문서 `herdr-app`** 에 둔다(`~/.local/state/herdr-core/default/docs.json` · `hc connect` 로 JSON-RPC `doc.get`/`doc.set`). 앱은 doc 이벤트를 받으면 문서를 다시 읽어 화면을 바꾼다 — 여러 화면이 한 배치를 나누는 정식 경로다.
- `open.py` 는 문서를 읽고 → 백업하고 → 내 탭(`$HC_TERMINAL_ID` 가 든 탭) `root.children` 에 블록 하나를 더하고 → 버전을 맞춰 쓴다(`doc.set` CAS · 충돌이면 다시 읽어 6번까지).
- ⚠ `doc.get`/`doc.set` 은 hc 매뉴얼(`hc --skill`)에 없는 앱 쪽 약속이다. 앱 판이 바뀌면 꼴이 바뀔 수 있다 — `manual/hc-usage-check.md`.

## 렌더 판정 — «썼다»와 «화면에 그렸다»는 다르다

- html-viewer 는 **파일이 있는 이 머신에서** node 렌더러를 띄운다 → journal 에 `Started herdr-html-<숫자>.service`. `open.py` 는 쓴 뒤 20초 동안 이것을 본다.
  - `렌더 시작 확인` = 그 20초 안에 이 머신의 html-viewer 렌더러가 시작됐다. 렌더러는 머신에 하나라 **방금 연 블록과 묶는 식별자가 없다** — 같은 순간 다른 뷰어가 열렸어도 이렇게 나온다(약한 관측 · 확실한 확인은 화면).
  - `렌더러가 이미 돌던 중` = 3분 안에 다른 뷰어가 돌았다 — 새 시작 기록이 없을 뿐이다.
  - `20초 안에 렌더 시작 없음` = 실패가 아닐 수 있다. **패널은 화면에 보일 때 만들어진다.** 사용자가 다른 공간·탭을 보고 있으면 그 탭을 볼 때 그린다.
- `--tab` 은 앱이 포커스를 옮기지 않는다 — 렌더 판정을 건너뛰고 «사용자가 탭을 눌러야 그린다»를 찍는다.
- `herdr-html-*.service`(node + 헤드리스 Chrome)는 죽이지 않는다. 3분 쉬면 스스로 끝난다.

## 지킬 것

1. **문서가 깨지면 이 머신의 공간 전부가 앱에서 사라진다**(`Cannot read this machine's layout` · 터미널은 계속 돈다). 그래서 기존 블록과 같은 꼴만 더하고, 내 탭의 `root.children` 밖은 건드리지 않는다.
2. 쓰기 전마다 `~/.cache/herdr-open/backup/<시각>-v<버전>.json`(폴더 0700, 30개 유지)에 남긴다.
3. 내 탭이 `row` 가 아니면(위아래 나눔·겹침) 구조를 건드리지 않고 새 탭으로 연다.
4. 사용자의 다른 공간·탭·직접 연 뷰어는 닫지 않는다 — 기본 `close` 는 `opened.jsonl` 에서 **이 터미널이 연** 블록만, `close <id>` 도 기록에 있는 id 만(`--force` 없이는) 지운다. 그 때문에 빈 row·column 은 같이 치운다. 이 도구가 만든 탭이 비면 탭도 지운다.

## 되돌리기

- 앱에서 이 머신 공간이 다 사라졌으면(문서 꼴 오류) `$O restore <가장 최근 백업>` — 지금 문서를 먼저 백업하고, 백업 당시 문서로 통째로 쓴다(그 뒤 앱이 바꾼 것은 사라진다 · 비상용). 그 뒤 `$O ls` 와 화면으로 확인한다.
- 뷰어 하나만 거두려면 `close`. 사용자가 앱에서 그 패널을 닫아도 된다(앱이 문서에서 지운다).
