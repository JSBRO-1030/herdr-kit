# 세트가 쓰는 hc 명령 ↔ hc 매뉴얼 대조

기준: hc 0.1.19 · `hc --skill` 출력 · 명령별 `hc <명령> --help` · 2026-11-17 확인.
hc 를 올리면 `hc --skill` 로 새 매뉴얼을 보고 이 표를 다시 맞춘다.

| 쓰는 것 | 쓰는 곳 | 매뉴얼 | `--help` | 비고 |
|---|---|---|---|---|
| `hc run --bg --json --no-notify --name --cwd -- <명령>` | team.sh spawn | 있음 | 있음 | |
| `hc run --label K=V` | team.sh spawn · session-rotate.sh | 없음(`hc label` 만) | 있음 | |
| `hc run --outlive-parent` | team.sh spawn(셸 없는 리드) | 있음 | 있음 | |
| `hc run --no-parent --keep` | session-rotate.sh(셸 없는 터미널) | `--keep` 만 | 둘 다 있음 | |
| `hc get <t> --json`(`state`·`pid`·`foreground.pid`·`foreground.argv`·`status.state`·`labels`·`cols`·`cwd`·`die_with_parent`·`reason`) | 셋 다 | `foreground` 있음 | 있음 | 필드는 실측 |
| `hc read` · `hc keys` · `hc send` | team.sh · session-rotate.sh | 있음 | 있음 | `send` 는 막힌 프로그램에 rc 9(매뉴얼 끝 종료 코드 표) |
| `hc kill` → `hc rm` | team.sh close | 있음 | 있음 | |
| `hc ls` | 안내 문서 | 있음 | 있음 | |
| 상태 OSC 7501(`idle`·`working`·`done`·`blocked`·`error`) | team.sh · session-rotate.sh | 있음 | — | opencode 는 보내지 않는다 |
| `codex --no-daemon` | team.sh spawn | 있음 | — | |
| `hc connect`(표준 입출력 JSON-RPC) | herdr-open open.py | 없음 | 있음 | 프로토콜 본문은 문서에 없다 |
| RPC `doc.get` · `doc.set`(문서 `herdr-app` · 버전 CAS · 충돌은 `data.kind=conflict`) | herdr-open open.py | **없음** | **없음** | Herdr 앱 쪽 약속 — 앱 판이 바뀌면 깨질 수 있다 |
| 라벨 `herdr.space` · `herdr.tab`(앱이 그 탭 오른쪽에 붙임) | team.sh · session-rotate.sh | **없음** | **없음** | Herdr 앱 쪽 약속(앱 `src/window.rs` adopt) |

빠진 것 0 · 문서에 없는 앱 쪽 약속 2(`doc.get`/`doc.set`, `herdr.*` 라벨) — 이 둘이 깨지면 herdr-open(문서 쓰기)과 도우미 자리 잡기(옆 페인)가 먼저 어긋난다.
