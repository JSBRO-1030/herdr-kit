---
name: session-rotate
description: 이 Claude Code 세션을 스스로 끝내고 같은 hc 터미널(또는 같은 탭의 새 터미널)에 후임 세션을 띄운다(자기 교대). 사용자가 「로테이션」「교대」「세션 저장하고 넘겨」라고 하거나, 회차가 3시간을 넘거나 컨텍스트 50%에 가까워졌을 때 쓴다. 스크립트는 ~/.claude/skills/session-rotate/session-rotate.sh 이고, 교대를 띄운 뒤에는 어떤 도구도 더 호출하면 안 된다.
---

# 세션 교대 (self-rotation)

스크립트: `~/.claude/skills/session-rotate/session-rotate.sh` (아래 `R`) · 필요: `hc` · `jq` · (셸 없는 터미널이면) `systemd-run --user`

세션은 hc 터미널(`$HC_TERMINAL_ID`) 안에서 돈다. 스크립트는 그 터미널 앞쪽의 claude 를 `/exit` 로 내리고, **깔린 CLI(claude·codex·agy·grok·opencode)에 새 판이 있으면 올린 뒤**(herdr-team `update-clis.sh` · 실패해도 진행), 셸로 돌아온 같은 터미널에 `claude` 를 쳐서 후임을 띄우고, `--goal` 을 줬으면 `/goal` 을 다시 건다.
신원은 세 겹으로 본다: ① 앞쪽 프로그램이 claude 다, ② 그 pid 의 `~/.claude/sessions/<pid>.json` sessionId 가 내 세션이다, ③ 호출한 셸이 그 claude 의 자손이다. 자기 교대 전용이라 남의 터미널은 못 넘긴다.

## 언제

- 사용자가 「로테이션」·「교대」·「세션 저장하고 넘겨」라고 할 때
- 회차 **3시간 초과** 또는 **컨텍스트 50% 이상** — 둘 다 임계가 아니라 **예상선**이다. 그 즈음이 오는 것을 미리 보고 작업을 그 안에 끝나는 단위로 끊는다. 임계 근처에서 새 작업을 벌이지 않는다.

## 순서 — 이 순서를 지킨다

### 1. 인계부터 쓴다 (스크립트는 인계를 나르지 않는다)

스크립트가 넘기는 것은 **`/goal` 한 줄뿐**이다(`--goal` 을 줬을 때). 나머지는 Auto Memory 와 프로젝트 문서가 나른다. 후임이 이어받지 못하면 교대가 아니라 사고다.

- 프로젝트 `STATE.md`(또는 그 프로젝트의 인계 문서) 맨 위에 **「다음 세션 첫 수」** — 지금 상태, 막힌 것, 다음 한 수
- `~/.claude/projects/<slug>/memory/` 갱신 + `MEMORY.md` 색인 한 줄
- 산출물 주소(파일 경로·링크)를 남긴다
- 커밋하고 푸시한다(준비 게이트가 잰다)

### 2. 좌표를 확인한다 — 둘 다 없으면 exit 64

```bash
echo "$HC_TERMINAL_ID" "$CLAUDE_CODE_SESSION_ID"
pid=$(hc get "$HC_TERMINAL_ID" --json | jq -r .foreground.pid); jq -r .sessionId ~/.claude/sessions/$pid.json
```

마지막 줄이 `$CLAUDE_CODE_SESSION_ID` 와 **같아야** 한다.

**셸 없는 터미널도 교대한다** — `hc get "$HC_TERMINAL_ID" --json | jq '.pid, .foreground.pid'` 두 값이 같으면(터미널을 claude 로 바로 띄움) `/exit` 가 터미널째 끝낸다. 그래서 이 모양이면 스크립트가 ① `systemd-run --user` 로 hc 밖에서 분리하고 ② `/exit` 직전에 같은 스페이스·탭에 셸 터미널을 새로 열고 ③ 전임 터미널이 끝난 것을 소멸로 보고 ④ 새 터미널의 셸에 `claude` 를 쳐 후임을 띄운다. 일하던 herdr-team 도우미는 `--outlive-parent` 로 떠 있어 살고, `team.sh handover` 로 목록이 후임에게 넘어간다. 그 플래그 없이 뜬 도우미가 일하는 중이면 분리 전에 멈춘다(`helpers_outlive.doomed`) — 그 일이 끝난 뒤 다시 부른다.

### 3. 배경 셸을 0으로 만든다

```bash
pgrep -af '[u]ntil '     # 대괄호 무늬 — pkill -f 는 자기 셸까지 죽인다
```

남아 있으면 `/exit` 뒤에 「Background work is running」 물음이 떠서 교대가 «전임 생존»으로 접힌다(스크립트가 받아 주지만 안 남기는 쪽이 낫다).

### 4. 게이트만 먼저 본다

```bash
R=~/.claude/skills/session-rotate/session-rotate.sh
$R --goal "<다음 회차 목표>" --dry-run
```

`terminal_shape.shape`(`shell`·`shellless`)로 모양을 본다. 감사 기록은 `~/.cache/session-rotate/audit/session-rotate-*.json`.

### 5. 교대한다 — **이것이 이 회차의 마지막 도구 호출이다**

```bash
$R --goal "<다음 회차 목표>"
```

⛔ **`run_in_background` 로 띄우지 마라. 포그라운드로 부르고 그대로 멈춘다.** 부모는 분리하면서 exit 0 을 낸다. 배경 작업으로 띄우면 그 종료 알림이 세션을 다시 `working` 으로 만들어 `await_idle` 을 깨뜨린다.

## ⛔ 교대를 띄운 뒤에는 아무 도구도 호출하지 않는다

교대는 **내가 아무것도 하지 않는 것**이 성립 조건이다. `await_idle` 이 세션이 한가해지기를 기다리는데, «교대 됐나» 확인하려고 `sleep`·파일 읽기를 하면 세션이 `working` 으로 붙잡혀 300초를 채우고 실패한다.

**마지막 호출 뒤에는 텍스트 응답 하나로 끝내고 멈춘다. 확인이 곧 실패다.** 결과는 다음 회차가 감사 기록으로 본다 — **`clear_goal.rc=0` ∧ `await_idle.idle=true` 쌍**. `.inflight` 파일은 «분리 직전»이라는 뜻이지 실패가 아니다.

## 단계

`prep_check` → `caller_binding` → `identity_gate` → `terminal_shape` → `recheck_before_exit` → `clear_goal` → `await_idle` → `kill_bg_shells` → `close_helpers` → `send_exit` → `exit_prompt` → `await_gone` → `update_clis` → `agent_start` → `rearm_goal`

`/goal` 이 걸려 있어도 된다 — `clear_goal` 이 지우고 `rearm_goal` 이 `--goal` 로 되돌려 준다. `--goal` 이 없으면 `rearm_goal` 은 보내지 않고 끝난다(후임은 메모리·문서로 이어 받는다).

## 플래그 · 환경 변수

| 플래그 | 뜻 |
| :-- | :-- |
| `--terminal` `--session` | 안 주면 `$HC_TERMINAL_ID`·`$CLAUDE_CODE_SESSION_ID`. 하나라도 없으면 exit 64 |
| `--goal` | 후임에게 다시 걸 목표(기본 `$ROTATE_GOAL` · 없으면 안 건다) |
| `--dry-run` | 게이트까지만(보내는 것 0) |
| `--if-requested` | `~/.cache/session-rotate/request.json`(키 `terminal`·`session`·`goal`)이 있을 때만 |
| `--skip-prep-check` | 준비 게이트만 건너뛴다 |

`ROTATE_UPDATE`(0 이면 업데이트 단계를 건너뜀 · 설정은 `~/.config/herdr-team/update.conf`) · `ROTATE_AUDIT_DIR`(감사 폴더) · `ROTATE_REPO`(준비 게이트가 잴 저장소 · 기본 = claude 프로세스 폴더의 git 최상위) · `ROTATE_TEAM_SH`(herdr-team 경로) · `ROTATE_IDLE_WAIT`(기본 300초) · `ROTATE_EXIT_WAIT`(90) · `ROTATE_START_TIMEOUT`(180) · `ROTATE_START_TRIES`(2) · `ROTATE_STEP_WAIT`(3).

## 준비 게이트(prep_check)가 재는 것

- 그 claude 가 떠 있는 폴더(`/proc/<pid>/cwd`)의 git 최상위: 커밋 안 한 변경(`dirty_tree`) · 푸시 안 한 커밋(`unpushed_commits`). git 저장소가 아니면 이 검사는 건너뛴다.
- 그 폴더의 Auto Memory `~/.claude/projects/<폴더를 «-» 로 바꾼 이름>/memory/MEMORY.md` 가 24시간 안에 고쳐졌나(`memory_stale`) · 있나(`memory_missing`).
- 남의 미완 작업을 대신 커밋하지 않는다. 내 인계를 끝냈는데 게이트가 남의 것으로 막히면 `--skip-prep-check` 를 쓰고 왜 건너뛰는지 사용자에게 한 줄로 말한다. ⛔ `--skip-prep-check` 는 준비 게이트용이지 idle 게이트용이 아니다.

## 실패를 읽는 법

| 증상 | 원인 | 할 일 |
| :-- | :-- | :-- |
| `prep_check` 에서 `dirty_tree`·`unpushed_commits` | 프로젝트 저장소가 더럽다 | 커밋·푸시 |
| `prep_check` 에서 `memory_stale`·`memory_missing` | 그 프로젝트 MEMORY.md 가 하루 넘게 안 바뀌었거나 없다 | 메모리를 갱신하거나 건너뛴다 |
| 교대 명령이 exit 0 | **분리 성공이지 교대 성공이 아니다** | 확인하지 말고 멈춘다 |
| `clear_goal.rc=0` 인데 `await_idle.idle=false` | **내가 도구를 계속 호출했다** | 띄운 뒤 아무것도 하지 않는다 |
| `clear_goal.rc≠0` 이고 `await_idle` 실패 | Stop 훅이 세션을 붙잡는다 | `/goal clear` 후 다시 |
| exit 64 | `--terminal`·`--session` 결측 | hc 좌표를 넣는다 |
| `identity_gate` 에서 `caller_descends=false` | 교대할 claude 의 자손이 아닌 셸에서 불렀다 | 교대할 세션 자신의 Bash 도구에서 부른다 |
| `clear_goal.rc=2`(`confirmed_via:none`) | 바쁜 중에 보낸 `/goal clear` 가 줄에 서 있어 확인 때 안 보였다(실행은 된다) | 그대로 둔다 |
| exit 2 | 감사 기록 실패 | stderr 에 레코드 전문이 나온다 |
| `agent_start` 2회 실패 · `state:absent` | 셸에 친 `claude` 가 안 떴다(PATH 등) | `hc read "$HC_TERMINAL_ID"` 로 화면을 보고 사람이 띄운다 |
