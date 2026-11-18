---
name: herdr-team
description: 팀워크 기본 운영 방식. 일을 받으면 먼저 «혼자·나눔·같이»를 판정하고, 나누거나 같이 할 일이면 herdr-core(hc) 터미널로 Herdr 앱의 옆 페인·탭에 도우미 에이전트(claude·codex·agy·grok·opencode 중 이 상자에 깔린 것)를 띄워 일에 맞게 맡긴 뒤 결과를 대조하고 페인을 닫는다. 사용자가 「옆에」「탭」「옆 팬에 시켜」「클러드 켜서」라고 하면 반드시 이 스킬을 쓴다. 단 도우미 페인 안(환경 변수 HERDR_TEAM_HELPER=1)에서는 페인을 만들지 말고 자기 CLI 의 하위 에이전트·에이전트 팀 팀원으로 나눈다. 갈래가 둘 이상인 조사, 검수가 필요한 산출물, 오래 도는 실행처럼 여러 단계인 일이면 사용자가 말하지 않아도 쓴다.
---

# herdr-team — 옆 페인에 일을 나누고 같이 하기

도구: `~/.claude/skills/herdr-team/team.sh` (아래 `T`) · hc 매뉴얼: `hc --skill`

## 0. 먼저 — 무엇이 깔렸나

```bash
T=~/.claude/skills/herdr-team/team.sh
$T doctor
# ok hc 0.1.19 /usr/local/bin/hc
# ok lead hc 터미널 t10f            ← Herdr 앱에서 연 터미널 안이어야 spawn 이 된다
# ok claude 2.1.326 (Claude Code) …
# missing grok                       ← 없는 종류는 고르지 않는다(spawn 이 rc 2 로 거절한다)
```

- 도우미 종류는 `doctor` 가 `ok` 로 보인 것 중에서만 고른다. 없는 CLI 를 띄우면 `spawn` 이 «이 상자에 없다»로 거절한다(rc 2).
- **띄우기 전에 그 CLI 를 새 판으로 올린다**(`update-clis.sh <종류>` · 같은 종류는 1시간에 한 번만 확인 · 실패해도 띄운다). 결과 한 줄(`updated`·`same`·`stale`·`skip`·`fail`)이 stderr 로 나온다. 교대(`session-rotate`)는 후임을 띄우기 전에 깔린 것 전부를 올린다.
  - 명령: `claude update` · `codex update` · `agy update` · `grok update` · `opencode upgrade`. 판정은 PATH 판의 `--version` 을 앞뒤로 비교한다 — 업데이트 도구가 «됐다»고 해도 새 판이 다른 자리(예 grok → `~/.grok/bin`)에 깔리고 PATH 앞쪽은 옛 판일 수 있다(`stale`).
  - 설정 `~/.config/herdr-team/update.conf`(«키=값» · 환경 변수 `HERDR_UPDATE*` 가 앞선다): `enabled=0` 끄기 · `every=3600` 확인 간격(초) · `timeout=180` · `skip_prefixes=/opt/x:/opt/y` 그 폴더에 깔린 CLI 는 건드리지 않음(배포가 판을 고정한 트리) · `sudo=1` 이면 `stale` 일 때 새 판을 PATH 자리에 `sudo -n` 으로 바꿔 끼움.
  - 손으로: `~/.claude/skills/herdr-team/update-clis.sh [--force] [종류…]`(간격 무시는 `--force`) · 기록 `~/.cache/herdr-team/update/<종류>.log`.
- 세션은 **herdr-core(`hc`) 터미널** 안에서 돈다(`$HC_TERMINAL_ID`). 창은 Mac 의 **Herdr 앱**이 원격으로 그린다. 옛 `herdr pane …`·`herdr agent …` 명령은 쓰지 않는다.
- 도우미 = 리드의 자식 hc 터미널이다. `team.sh` 가 `hc run --bg --no-notify --name <이름> --label herdr.space=… [--label herdr.tab=…] -- env PATH=… HERDR_TEAM_HELPER=1 <CLI>` 로 띄운다.
  - **자리는 라벨로 정한다**: `herdr.space`+`herdr.tab` 을 리드와 같게 주면 앱이 리드 탭 오른쪽에 붙인다. `herdr.space` 만 주면 같은 스페이스의 새 탭이 된다. 리드에 라벨이 없으면(앱 밖에서 띄운 터미널) 창에는 안 나오고 앱 사이드바의 하위 에이전트로만 보인다.
  - 코어는 systemd 가 띄워 PATH 가 짧다 → 리드의 PATH 를 `env` 로 넘긴다(안 그러면 `spawn_failed`).
  - codex 는 `--no-daemon` 을 붙여야 명령이 hc 터미널 안에서 돈다(team.sh 가 붙인다).
  - 도우미는 **리드 터미널이 끝나면 같이 끝난다.** 리드 셸에서 claude 만 다시 떠도(교대) 산다. 셸 없는 리드(claude 가 터미널의 처음 프로그램)의 도우미는 `--outlive-parent` 로 띄우고, 교대 스크립트가 `team.sh handover <새 주소>` 로 목록을 넘긴다.
  - `--no-notify` 로 띄운다. 안 그러면 hc 가 도우미의 끝·막힘을 리드 입력칸에 쳐 넣어 한가한 리드에 새 차례가 생긴다.
- 상태는 프로그램이 보내는 OSC 7501 이다. claude·codex·grok·agy 는 보내고, **opencode 는 보내지 않는다** → `team.sh` 는 opencode 맨 아래 줄(`… · ctrl+p menu`)에 `esc interrupt` 가 있으면 `working`, 없으면 `idle` 로 읽는다.
- 닫기는 `hc kill` → `hc rm` 이다. 앱이 그 페인을 치운다.
- **다른 세션에 넘기기**: `hc ls` 의 주소(예 `t11`)로 `hc send <주소> "…"`. 받는 쪽에는 `<hc from="t…">…</hc>` 로 들어간다. 슬래시 명령(`/status` 등)은 꼬리표 없이 `env -u HC_TERMINAL_ID hc send <주소> "/…"` — 그냥 보내면 일반 메시지가 되어 모델이 한 차례를 돈다. 보내기 전에 `hc read <주소> | tail -6` 로 입력칸이 비었는지 본다.
- **탭 이름은 저절로 바뀐다**(앱 auto-tabs 모드). 터미널은 탭 이름이 아니라 **주소(`t…`·`--name`)로** 찾는다.
- 사용자에게 문서(HTML·Markdown)를 보일 때는 **`herdr-open` 스킬**을 쓴다.

## 1. 판정 — 일을 받으면 먼저, 한 줄로 말한다

예: `판정: 나눔 — 옆 페인 claude(조사 B) · codex(검수)`

| 판정 | 언제 | 어떻게 |
|---|---|---|
| **그대로** | 사용자가 「옆에」「탭」「옆 팬에 시켜」「클러드 켜서」라고 했다 | 말한 그대로 한다. ⛔ 「필요 없다」고 되받거나 보이지 않는 서브에이전트로 바꾸지 않는다 |
| **혼자** | 몇 분이면 끝난다 · 한 갈래를 차례로 한다 · 같은 파일을 고친다 · 사용자와 대화 중이다 | 직접 한다 |
| **나눔** | 서로 기다리지 않는 갈래가 둘 이상이고 각각 길다 · 폴더·저장소가 다르다 · 오래 도는 실행·대기가 있다 · 많이 읽어야 해서 내 문맥을 아껴야 한다 | 갈래마다 도우미 하나. 나는 지시·대조·종합을 맡는다 |
| **같이** | 되돌리기 어렵거나 남에게 갈 산출물 → 다른 모델이 검수한다(저자≠검증자) · 원인을 모른다 → 가설마다 도우미 하나를 두고 서로 반박하게 한다 | 검수자를 옆에 둔다 · 가설 도우미 둘 |

- 보이지 않는 Agent 도구 서브에이전트는 «결과만 필요하고 사용자가 볼 필요 없는 짧은 조사»에만 쓴다.
- 동시 도우미는 3개까지다(스크립트가 막는다 · `HERDR_TEAM_MAX` 로 바꾼다).

## 2. 도우미 고르기 — 깔린 것 중에서, 일에 따라

원칙: 그 일을 해낼 수 있는 것 가운데 **사용량 부담이 가장 작은 것**을 고른다. 판단이 무거운 일은 claude 가 맡는다. 검수는 짓기와 **다른 회사 모델**에 맡긴다.

| 일 | 먼저 | 다음 후보 |
|---|---|---|
| 어려운 판단·설계·원인 분석 | `claude` | `codex` |
| 단순 코드 작성·버그 고치기 | `opencode -- mini -m <무료 모델>` | `claude -- --model sonnet` |
| 조사·문서 정리 | `claude -- --model sonnet` | `opencode` |
| 검수·대조(저자≠검증자) | `codex` | `grok` · `opencode` |
| 긴 글 읽기·요약 | `agy` | `opencode` |
| 파일을 다루는 대량 단순 반복 | `opencode` | `grok` |

- 위 표는 예시다. `doctor` 에 없는 칸은 건너뛰고 다음 후보로 간다. 무료 모델 이름은 자주 바뀐다 — `opencode models` 로 본다.
- ⛔ opencode v2 의 첫 화면 명령에는 `-m` 이 없다 — `opencode -m …` 은 `Unrecognized flag: -m` 으로 끝나고 `spawn` 은 `blocked` 를 낸다. **`mini -m <모델>`** 로 띄운다. 셸에서 부르는 `opencode run -m` 은 그대로다.
- ⛔ agy 웹 조사는 출처를 지어낼 수 있다(인용 주소 13개 중 8개가 404였던 실측). agy 에 웹 조사를 맡기면 주소를 직접 열어 대조한 것만 쓴다.
- 한 번 멈췄다고 그 모델을 빼지 말고, `ask` 가 시간 초과로 끝나면 화면을 본 뒤 다음 후보로 넘긴다.

## 3. 쓰는 법

```bash
T=~/.claude/skills/herdr-team/team.sh
$T doctor                                    # 깔린 것 확인
~/.claude/skills/herdr-team/update-clis.sh --force   # 깔린 CLI 전부 지금 새 판 확인·올리기
$T spawn res-a claude -- --model sonnet      # 띄우기 → "ready res-a addr=t1q place=side kind=claude"
$T spawn chk codex
$T spawn fx opencode -- mini -m opencode/<무료 모델>
$T ask res-a "…할 일… (읽기만 하라 / 고칠 파일은 X 뿐이다 등 범위를 적는다)" 1800
$T ask res-a @/path/지시서.md                # 긴 지시는 파일로
$T watch 10800                               # 긴 ask 곁에 백그라운드로 — 막히면(blocked) 바로 끝난다
$T ask --queue res-a @/path/다음.md          # 일하는 중이면 끝날 때까지 기다렸다 보낸다
$T ls                                        # 내가 띄운 도우미와 상태
$T close res-a      # 또는 close --all · close --idle(끝난 것만 · 교대 스크립트가 쓴다)
```

- 자리(`place`): 첫 도우미는 내 탭 오른쪽(`side` · 내 폭 160칸 이상일 때), 그 밖은 같은 스페이스의 새 탭(`tab`)이다. `TEAM_PLACE=tab` 이면 늘 새 탭. 앱은 라벨로 찾은 터미널을 오른쪽에만 붙인다 — 아래로 나누기는 없다.
- `ask` 는 결과를 `~/.cache/herdr-team/<이름>-<시각>.md` 로 받고 그 경로를 찍는다. 완료 판정은 화면 표식(`DONE-<숫자>`) **3초 간격 두 번** + **결과 파일이 비어 있지 않음**이다. 표식을 못 읽어도 결과 파일이 있고 상태가 `idle`·`done` 이며 파일이 30초 그대로면 받는다.
- **인계 칸**: `ask` 는 도우미에게 캐시 파일 맨 끝에 `## 인계` 와 열 칸(목표 / 접근 / 한 일 / 막힌 곳 / 주요 결과 / 파일 / 결정(까닭) / 검증 / 지금 상태 / 다음)을 쓰게 한다. 해당 없는 칸은 «없음», 증거 없는 검증은 «미검증». 다른 도우미가 이어 받으면 앞 도우미의 `## 인계` 를 지시에 그대로 싣는다.
- 첫 낱말과 종료 코드: `ok`(0) · `marker-only`(0 · 결과 파일 없이 화면 답) · `blocked`(6 · 화면 끝 14줄을 비밀값을 가려 찍는다) · `gone`(7) · `timeout`(4) · `error`(8) · 거절(2).
- 긴 일은 `ask` 를 **백그라운드**(Bash `run_in_background`)로 돌리고 **`watch` 도 같이 백그라운드로 건다.** `watch` 는 첫 사건에서 끝나므로 처리한 뒤 다시 건다.
- 여러 갈래는 `ask` 여러 개를 동시에 돌린다.
- **10분 안에 끝나는 짧은 일은 페인 대신 껍데기 에이전트로**: `agy-worker` · `grok-worker` · `opencode-worker-free`(설치기가 깔린 CLI 것만 넣는다 · haiku 껍데기 → `cli-worker.sh`). Agent 도구로 부르면 결과가 도구 결과로 돌아온다. 기본 읽기 전용이고, 고치기는 지시에 폴더를 밝혔을 때만이다. **540초 시한이나 크기 상한(120KB)에 걸리면 `cli-worker.sh` 가 같은 지시를 탭(`team.sh spawn` + `ask`)으로 넘기고 바로 돌아온다**(hc 리드 터미널 안일 때만). 부른 쪽은 출력의 «기다리기» 명령을 그대로 Bash `run_in_background` 로 걸고, `ok <이름> <결과 파일>` 을 받으면 `team.sh close <이름>` 으로 닫는다. 같은 지시를 다시 보내지 마라.

## 4. 두 층 — 페인은 리드만, 그 아래는 각 CLI 의 하위 에이전트

- **위 층(리드 = 사용자 터미널)**: `team.sh` 로 Herdr 앱의 옆 페인·탭에 도우미(hc 터미널)를 띄운다.
- **아래 층(도우미)**: 터미널·페인을 만들지 않는다. 자기 CLI 의 하위 에이전트로 나눈다. `team.sh spawn` 이 도우미 안(`HERDR_TEAM_HELPER=1`)에서는 거부한다(rc 5).

| 도우미 | 하위 에이전트 |
|---|---|
| claude | `Agent` 도구(서브에이전트) · 에이전트 팀 팀원(도우미 페인에서 켜짐) |
| codex | `spawn_agent` · `wait_agent` |
| grok | `spawn_subagent` |
| agy | `manage_subagents` · `invoke_subagent` |
| opencode | `task` 도구로 `explore` · `general` |

- ⚠ 「에이전트 팀」은 claude 의 기능 이름이다. 위 층의 hc 도우미와 섞지 않는다.
- ⚠ 도우미의 「대조했다」는 믿지 않는다. 리드가 원본과 대조한다.

## 5. 지킬 것 — 실측으로 깨졌던 자리

1. **완료를 상태(`done`·`idle`)만으로 판정하지 않는다.** 표식 + 결과 파일로 판정한다(`ask` 가 한다). grok 은 생각 속에 표식을 미리 적고, 답을 칸 폭에서 접어 「…DONE-」/「12868」 두 줄로 가르기도 한다. agy 는 진행 표시줄에 「⣟ DONE-….」을 찍는다. opencode 는 생각 글이 흘러나오는 도중에 표식이 읽힌다. `ask` 는 이 꼴들을 다 걸러 낸다.
2. **처음 쓰는 폴더의 신뢰 확인창**은 화면에 띄운 그 폴더가 정확히 적혀 있고 커서가 Yes 에 있을 때만 `spawn` 이 「Yes」를 누른다. codex 업데이트 창은 띄우는 중에는 「Skip」을 고른다. 모르는 창이면 `spawn` 이 `blocked` 로 멈춘다 → 사용자에게 묻는다.
3. **timeout 은 «안 갔다»가 아니다.** `hc read <주소>` 로 화면을 보고 판단한다. 같은 지시를 그냥 다시 보내지 않는다.
4. **화면을 통째로 읽지 않는다.** 옆 창 화면에서 비밀값이 부모 문맥으로 샐 수 있다. 결과는 파일로 받는다.
5. **도우미가 낸 숫자·주장은 원본과 대조한 뒤** 보고한다.
6. **내가 띄운 도우미는 결과를 회수하면 닫는다.** 사용자가 남기라고 하면 남긴다. 교대(`session-rotate`) 때는 교대 스크립트가 `close --idle` 로 일을 끝낸 도우미만 닫는다.
7. **교대 뒤에는 도우미 이름으로 `SendMessage` 가 닿지 않는다.** hc 명령(`hc send`·`T ask`)을 쓴다.
8. **`opencode run` 을 셸에서 직접 부를 때는 `</dev/null` 을 붙인다.** 안 붙이면 120초 동안 매달린다.
9. **agy 를 셸에서 직접 부르면 파일 도구가 자동 거부된다**(출력이 비고 rc 0). 화면 모드에서도 agy 는 작업 폴더 밖 읽기·쓰기와 셸 명령마다 허락을 물어 탭이 멈춘다 → `spawn … agy` 는 기본으로 `--dangerously-skip-permissions` 를 붙인다(`HERDR_TEAM_AGY_SKIP_PERMS=0` 이면 끈다 · 그때 agy 탭은 확인창에서 `blocked` 로 선다). 탭의 읽기 전용은 지시문으로 지킨다.
10. **긴 `ask` 를 걸면 반드시 `watch` 도 같이 건다.** 도우미(또는 그 하위 에이전트)가 확인창에서 멈추면 `ask`·`watch` 가 `blocked` 와 화면 끝 줄로 끝난다. 막힌 창의 판단은 부모가 직접 한다. 범위 밖이거나 되돌릴 수 없을 때만 사용자에게 묻는다.
11. **결과 파일은 `ask` 가 찍은 경로로만 찾는다.** 시작 시각으로 이름을 짐작해 글롭하지 않는다.
12. **`team.sh` 를 고칠 때는 새 파일에 쓰고 `mv` 로 한 번에 바꾼다.** 돌고 있는 `ask` 가 고치는 도중의 파일을 읽어 문법 오류로 죽었다.
13. **차례가 API 오류로 끝나면(hc 상태 `error`) `ask` 가 저절로 이어 한다** — `error` 가 9초 이어지고 화면 끝이 API·연결 오류면 60·120·180초 쉬고 «이어서 마무리»를 보낸다(3번까지). 그 밖의 오류이거나 3번을 다 쓰면 rc 8.
