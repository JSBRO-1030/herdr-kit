# herdr-kit

Herdr 앱(Mac)과 herdr-core(`hc` · 원격 리눅스 상자)에서 Claude Code 를 «옆 페인에 도우미를 두고» 쓰는 한 벌입니다.
스킬 셋, 껍데기 에이전트, 상태줄, 핵심 CLAUDE.md 규칙, Mac 쪽 mod(files-plus), hc 명령 대조표를 함께 둡니다.

## 들어 있는 것

| 폴더 | 무엇 | 어디에 깔리나 |
|---|---|---|
| `skills/herdr-team/` | 옆 페인·탭에 도우미(claude · codex · agy · grok · opencode 중 깔린 것)를 띄워 일을 맡기고 결과를 받아 닫는다 · `team.sh doctor` 로 깔린 것 확인 | 상자 `~/.claude/skills/herdr-team` |
| `skills/herdr-open/` | 상자의 HTML·Markdown 을 Mac 앱 화면에 html-viewer 패널로 연다(files-plus «페이지로»와 같은 블록 꼴) | 상자 `~/.claude/skills/herdr-open` |
| `skills/session-rotate/` | 세션이 길어지면 스스로 `/exit` 하고 같은 터미널에 후임 세션을 띄운다 | 상자 `~/.claude/skills/session-rotate` |
| `agents/` | `agy-worker` · `grok-worker` · `opencode-worker-free` — Claude 의 Agent 도구로 그 CLI 에 짧은 일을 맡기는 껍데기 | 상자 `~/.claude/agents/`(깔린 CLI 것만) |
| `statusline/` | Claude Code 아래 상태줄: Claude 줄 + (깔렸으면) Codex 줄 · agy 줄 — 모델 · 5시간/7일 한도 · 초기화까지 남은 시간 | 상자 `~/.claude/settings.json` `statusLine` |
| `claude/CLAUDE.md` | 핵심 전역 규칙(팀워크 판정 · 도우미 다루기 · 작업 기본 규칙) | 상자 `~/.claude/CLAUDE.md` 의 표시선 블록 |
| `mods/` | Mac 앱 mod **files-plus** — 원격 파일 미리보기(PDF 쪽 넘기기는 Mac 앱만 · 격리 실행 아래에서 렌더) · 올리기 · 내려받기 · «터미널에 나온 파일» 줄 | Mac `~/.config/herdr-app/mods/files-plus` |
| `manual/` | 세트가 쓰는 hc 명령 대조표(매뉴얼은 `hc --skill`) | — |
| `docs/` | Mac 에서 herdr-open × files-plus 를 확인하는 순서 | — |

상자마다 따로 둔 도구와 개인 경로는 넣지 않았습니다.

## 깔기

필요: 상자 = herdr-core(`hc`) · Claude Code · python3 · jq · node(html-viewer 렌더) / Mac = Herdr 앱 0.1.15 이상 · html-viewer mod.
공개 저장소라 로그인 없이 받을 수 있습니다. `gh` 가 없으면 `git clone https://github.com/JSBRO-1030/herdr-kit.git ~/herdr-option` 으로 받아도 됩니다.

**원격 상자(리눅스)**

```sh
gh repo clone JSBRO-1030/herdr-kit ~/herdr-option
bash ~/herdr-option/install.sh --dry-run     # 무엇을 바꿀지 먼저 본다
bash ~/herdr-option/install.sh
```

- 스킬·에이전트는 이 저장소를 가리키는 **링크**로 깔립니다 — `git -C ~/herdr-option pull` 이면 새 판이 됩니다.
- 이미 같은 이름의 다른 스킬·에이전트가 있으면 건드리지 않고 «건너뜀»으로 알립니다.
- 상태줄은 `statusLine` 이 비어 있을 때만 넣습니다. 이미 다른 상태줄이 있으면 `--replace-statusline`(사본을 남김). 빼려면 `--no-statusline`.
- CLAUDE.md 는 `<!-- herdr-option:begin -->` ~ `<!-- herdr-option:end -->` 사이만 넣거나 바꿉니다(사본을 남김). 빼려면 `--no-claude-md`.
- 끝에 `team.sh doctor` 가 쓸 수 있는 도우미를 보입니다. 나중에 CLI 를 더 깔면 설치기를 다시 돌리면 그 에이전트가 들어갑니다.

**Mac** — files-plus mod 와 앱 화면 붙이기는 [`mods/README.md`](mods/README.md):

```sh
gh repo clone JSBRO-1030/herdr-kit ~/herdr-option
sh ~/herdr-option/mods/install-mac.sh
```

## 쓰기

- 일을 시키면 Claude 가 먼저 «판정: 혼자 / 나눔 / 같이»를 말하고, 나누거나 같이 할 일이면 Herdr 앱 옆 페인·탭에 도우미를 띄웁니다(`skills/herdr-team/SKILL.md`). «옆에 claude 켜서 …», «탭에 codex 띄워서 검수해» 처럼 말해도 됩니다.
- 깔린 도우미 보기: `~/.claude/skills/herdr-team/team.sh doctor`
- **agy 를 에이전트로**: Claude 의 Agent 도구로 `agy-worker` 를 부르면 agy(Gemini)가 일을 하고 답을 돌려줍니다(실측: 13초 · rc 0). 10분 안의 짧은 일용입니다. 540초를 넘기면 스크립트가 같은 지시를 Herdr 탭으로 넘기고 돌아오니, 긴 일은 처음부터 `team.sh spawn <이름> agy` 로 탭에 띄웁니다. grok · opencode 도 같은 꼴입니다.
- 문서 보여 주기: «이 보고서 앱에서 열어 줘» → `herdr-open`.
- 교대: «로테이션 해» → `session-rotate`(인계를 먼저 쓰고 교대합니다).
- **업데이트**: 도우미를 띄울 때는 그 CLI 를, 교대할 때는 깔린 CLI 전부를 새 판이 있으면 올리고 진행합니다(`skills/herdr-team/update-clis.sh` · 실패해도 멈추지 않음). 배포가 판을 고정한 폴더는 `~/.config/herdr-team/update.conf` 의 `skip_prefixes=` 로 뺍니다 — `skills/herdr-team/SKILL.md` §0.

## 시험

```sh
python3 -I skills/herdr-open/test_open.py                         # herdr-open 8개(앱·코어 없이)
bash skills/herdr-team/test_update_clis.sh                         # 업데이트 판정 13개(가짜 CLI)
node --test mods/tests/files-plus.test.mjs mods/tests/state.test.mjs mods/tests/termfiles.test.mjs   # files-plus 291개(1개는 Linux 에서 건너뜀)
bash -n skills/herdr-team/*.sh skills/session-rotate/session-rotate.sh install.sh
skills/session-rotate/session-rotate.sh --dry-run --skip-prep-check   # hc 터미널 안의 claude 에서 — 게이트까지만
```

Mac 앱에서 herdr-open 과 files-plus 가 같은 뷰어로 맞물리는지는 [`docs/test-herdr-open-on-mac.md`](docs/test-herdr-open-on-mac.md) 순서대로 봅니다(Mac 의 Claude 에게 그 문서대로 안내해 달라고 하면 됩니다).

## 지우기

```sh
rm ~/.claude/skills/{herdr-team,herdr-open,session-rotate}            # 링크만 지운다
rm -f ~/.claude/agents/{agy-worker,grok-worker,opencode-worker-free}.md
# ~/.claude/CLAUDE.md 의 herdr-option 표시선 블록을 지우고, settings.json 의 statusLine 을 사본(.bak-herdr-option-*)으로 되돌린다
```

## hc 를 올렸을 때

`hc --skill` 로 새 매뉴얼을 보고 `manual/hc-usage-check.md` 표를 다시 맞춥니다. 문서에 없는 앱 쪽 약속(`doc.get`/`doc.set` · `herdr.space`/`herdr.tab` 라벨)이 먼저 깨질 수 있습니다.
