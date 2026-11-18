# files-plus 팝업 개편 설계 (2026-11-15)

확정 시안: C2 (원본 mod 프로젝트의 `designs/files-plus-popups-20261115/mock-C2-default.png` · `mock-C2-open.png`).
화면 글자는 모두 한글. 키 이름(Esc · ←→)과 앱 이름 Finder 만 그대로.

## 1. 구조 — 한 mod, 세 모드

같은 `files-plus` 폴더를 `props.mode` 로 나눈다(`agents` mod 의 `sortMenu` 선례 · `herdr.d.ts` OverlaySpec).

| 모드 | 뜨는 곳 | 하는 일 | 파일 |
|---|---|---|---|
| panel (props 없음) | 레이아웃 블록 | 트리 · 전송 큐 실행(주인) · 진행 게시 · 요청 처리 · 팝업 열기 | `main.js` |
| `preview` | `openOverlay kind:"window" frame:"none"` — **overlay key 없음** · 가운데 `at`(`previewSpec`) · 주인당 하나는 shared `files-plus.preview/<owner>` 에 «지금 열린 id» 를 적어 지킨다 | 미리보기 · 목록/정보 칸 · 아이콘 줄 · 키 | `preview.js` |
| `jobs` | `openOverlay kind:"window" frame:"none" key:"files-plus-jobs/<owner>"` | 전송 막대 · 펼침 목록 · 기록 · 아이콘 4개 | `jobs-view.js` |

- 전송은 **패널만** 돌린다. 팝업 copy 의 작업은 팝업을 닫으면 죽는다(AGENTS.md mod lifetime). 팝업은 보여 주고 요청만 보낸다.
- 공통 계약(공유 키 · 요청함 · 요약 · 막대 · 기록)은 `state.js`(herdr 를 import 하지 않는 순수 모듈, node 시험 가능).
- `main.js` 의 default export View 가 모드를 가른다:

```js
init(props, cx) {
  if (props?.mode === "preview") { this.impl = new Preview(props, cx); return; }
  if (props?.mode === "jobs") { this.impl = new JobsWindow(props, cx); return; }
  // …패널
}
render(cx) { return this.impl ? this.impl.render(cx) : this.panelRender(cx); }
async close(cx) {
  if (this.impl) { await this.impl.close?.(cx); return; }   // 팝업: 비동기 OK
  // 패널: 동기로만(§3 close) — closed = true · 늦춤 취소 · 작업 맺기 · 기록 쓰기 · owner 키 null
}
```

**mod props 는 `props()` 로 읽는다(P0)**: 앱 루트 mod 의 `init(props, cx)` 인자는 호스트가 mod props 로 채우지 않는다(`gpui-kit.d.ts` View.init 의 props = gpui-shell 중첩 뷰 Props · 기본 mod `confirm` 은 `init(_props, cx)` + `herdr` 의 `props()`). 그래서 `main.js` 는 `props as modProps` 를 import 해 `const p = modProps() ?? initProps ?? {}` 로 갈라 `p` 를 `Preview`·`JobsWindow` 에 넘긴다(`herdr-app check` 같은 대역이 인자로 줄 때를 위해 인자는 대비로만). overlay id 는 `props()?.overlay`. 패널 모드는 props 를 읽지 않는다. 이걸 인자로 읽으면 실제 앱에서 팝업이 패널(파일 트리)로 뜬다.

`Preview` · `JobsWindow` 는 View 가 아닌 평범한 class: `constructor(props, cx)` · `render(cx)` → 요소 · `close(cx)`(선택). 오버레이 id 는 `props.overlay`.

## 2. state.js — 공통 계약 (정확히 이 이름·꼴)

```js
export const KEY = {
  jobs: owner => `files-plus.jobs/${owner}`,        // 패널이 쓴다 · 팝업이 읽는다
  req: (owner, from) => `files-plus.req/${owner}/${from}`,  // from = "preview" | "jobs" · 그 팝업만 쓴다
  ack: (owner, from) => `files-plus.ack/${owner}/${from}`,  // 패널만 쓴다
  win: owner => `files-plus.win/${owner}`,          // 전송 창이 쓴다: 열림 {t: 토큰, expanded} · 닫히면 null
  history: "files-plus.history",                    // 패널만 쓴다(기록 지우기 요청도 패널이 처리)
};
export function newOwner(): string                  // 8자 무작위(restoreOwner 가 처음 한 번만 짓는다)
// 작업 상태: "wait" | "run" | "verify" | "ok" | "fail" | "cancel"
// 게시 꼴(평범한 JSON 만):
//   { owner, on, updated: ms, jobs: [{ id, dir: "up"|"down", name, total, done, state, note, speed, eta, where, on, cancelling }] }
//   on = 그 전송이 실제로 쓴 머신("" = 이 컴퓨터) · cancelling = 취소가 눌렸고 아직 못 맺은 대기·진행 작업
export function snapshot(owner, on, jobs, now, { life, activeCap = 100, keep = 30 }): object
//   크기 상한: 활성(wait·run·verify)은 run·verify 먼저 + 대기는 id 작은 순 activeCap 개 · 끝난 것은 앞 keep 개. 잘린 나머지는
//   more = { wait, run, verify, ok, fail, cancel, tot, got } 로만 센다(있을 때만). 1000개 드롭 스냅샷 ≈ 154 KB → ~20 KB. 작업에 noHistory(«Mac에서 열기» 사본)·스냅샷에 life 를 싣는다.
export function readShared(shared, key, onError = null)   // 모든 shared 읽기 — 호스트 shared() 는 값에 `toString` 키가 있으면 던진다
export function startLife(storage, owner) → { life, gated } / lifeCurrent(storage, owner, life, gated)   // §3 삶 토큰(키 `files-plus.life/<owner>`)
export function seenJids(history)                                // 기록의 jid · jids 집합
export function summary(jobs, more?): { total, finished, running, waiting, failed, pct, text }
//   pct = 바이트 가중(크기 모르는 건 빼고) 0..100 정수 · text 예 "전송 2/5 · 42%" · 작업 없으면 "전송 없음"
export function bar(pct, width = 8): string          // "▓▓▓░░░░░"
export function speedometer(): { sample(bytes, now) → { speed /*B/s|null*/, eta /*s|null*/ }, reset() }
//   최근 5초 이동평균 · 시작 3초 안은 speed null("계산 중")
export function send(shared, setShared, owner, from, action, args = {}): number   // 요청 id 반환
//   목록 = shared(req) ?? [] · ack 이하 지우고 {id: 마지막+1, action, args} 덧붙여 setShared
export function drain(shared, setShared, owner, from): Array<{ id, action, args }>
//   ack 보다 큰 것만 돌려주고 ack 를 마지막 id 로 올린다(패널 전용)
//   (M7) ack 가 MAX_SAFE_INTEGER 근처로 망가져 새 id 가 안전한 정수를 넘으면 send 가 요청함을 처음부터 다시 시작한다: req=[{id:1}] 를 먼저 쓰고 ack=0 — 이 복구에 한해 팝업이 ack 를 쓴다
export function pushHistory(list, entry, max = 200): Array   // 새것이 앞
//   entry = { at: ms, dir: "up"|"down"|"both", name, size, state: "ok"|"fail"|"cancel", where, on, note }
//   dir "both" = 방향이 섞인 «외 N개» 묶음 줄(화면 ↑↓ · note «묶음 · ↑3 ↓2»). pushHistoryGroup(list, entries) = 묶음 규칙.
export function restoreOwner(storage, taken): { owner, restored }   // §3
export function orphanedJobs(snap, now, seen): { entries, groups, seq }   // §3 다시 불러옴 · groups = 상태별 묶음(각각 따로 pushHistoryGroup)
export const own = (map, key)                                       // Object.hasOwn 조회 — 저장·원격 문자열로 맵을 찾는 곳은 모두 이것(constructor · __proto__ 방지)
export function groupHistory(list, now): Array<{ label /* "오늘" | "어제" | "YYYY-MM-DD" */, items }>
export function stateLabel(state): string            // 대기 · 진행 · 검증 중 · 끝 · 실패 · 취소
export function throttle(fn, ms /* 숫자 | () => 숫자 */, timers /* 필수 */): fn   // 앞 호출은 바로 · 창 안은 마지막 인자로 창 끝에 한 번(trailing)
//   timers = { setTimeout(fn, ms) → 핸들, clearTimeout(핸들) } 필수 — herdr 에는 전역 setTimeout 이 없다(cx.timer.after 를 감싸 넘긴다). 빠뜨리면 만들 때 던진다.
//   t.flush()       밀린 호출을 지금 돌리고 창을 새로 연다(밀린 게 없으면 무동작)
//   t.dropPending() 밀린 호출만 버린다 — 창은 그대로(즉시 게시가 창을 풀어 쓰기가 폭주하지 않게)
//   t.cancel()      밀린 호출도 창도 버린다
```

`shared` · `setShared` 는 인자로 받는다(시험에서 Map 대역).

### 요청 (팝업 → 패널)

| action | args | 패널이 하는 일 |
|---|---|---|
| `download` | `{ abs, name, on }` | 기존 `download` (on 은 요청에 실린 값 사용) |
| `open` | `{ abs, name, on }` | 기존 `openHere` |
| `cancel` | `{ id }` | 그 작업 `cancelled = true` |
| `cancelAll` | — | 대기·진행 모두 취소 |
| `clear` | — | 끝난 작업(ok·fail·cancel) 목록에서 지움 |
| `retry` | `{ id }` | 실패 작업을 같은 일로 다시 줄 세움 |
| `clearHistory` | — | `KEY.history` 를 [] |

`페이지로`(`run("pane.split", …)`) · Finder 열기(`exec("open", [...])`) 는 오래 걸리지 않아 팝업이 바로 한다.

패널은 `cx.timer.every(300)` 로 `drain(…, "preview")` · `drain(…, "jobs")` 를 돈다(숨은 copy 도 타이머는 돈다).

## 3. 패널 (main.js)

- `this.owner` — **copy 의 `localStorage`(`files-plus.owner`)에 저장해 이어 쓴다**(`restoreOwner`). 근거: AGENTS.md «Saving any file reloads every copy in place» + `close()` 는 다시 불러오기에 불리지 않는다(pane·tab·slot·overlay 가 사라질 때와 앱 종료에만) · «Each copy still gets its own instance, tasks and localStorage» · localStorage 는 «a file … survives a restart» (gpui-kit.d.ts). 매 panelInit 마다 새 owner 를 지으면 옛 owner 의 `jobs` 키가 객체로 남아 `alive()` 가 영영 참 → 전송 창이 얼어붙은 «진행» 을 보이고 요청이 조용히 사라지며 창이 둘 뜬다. (확인 필요: 블록을 지웠다 다시 만들 때 localStorage 가 새로인지 — 새라면 새 owner, 옛 블록은 close() 가 키를 치운다.)
  - 값이 없거나 `^[a-z0-9]{8}$` 가 아니면 새로 지어 저장한다. localStorage 가 없거나 던지면(예외) 그 삶만 새 owner(옛 방식).
  - 같은 모듈 버전의 살아 있는 다른 copy 가 쓰는 owner(`LIVE` 집합)면 겹침으로 보고 새 owner 를 짓는다(저장은 그대로). 새 모듈 버전(다시 불러오기)은 빈 집합이라 옛 owner 를 이어 쓴다.
  - **다시 불러온 직후(panelInit)**: ① 옛 스냅샷의 wait·run·verify 작업은 전송이 이미 끊겼으므로 기록에 `실패 · 다시 불러옴` 으로 한 번 남긴다(`orphanedJobs`) · 작업 목록은 비우고 새로 시작(`seq` 는 옛 최대 id 에서 이어 — 열려 있는 창의 옛 id 요청이 새 작업에 닿지 않게). ② 옛 `req`/`ack` 를 `drain` 으로 버린다(ack = 최대 요청 id → 옛 요청 재생 없음). ③ 옛 `win` 깃발은 치운다(크래시·재시작 뒤 깃발이 남아 새 작업이 창을 못 여는 일을 막는다 · 창이 실제로 열려 있었다면 다음 새 작업이 같은 key 로 그 자리에서 바꾼다). ④ 곧바로 새 스냅샷을 게시 → 열려 있는 창은 얼어붙지 않고 «전송 없음» 으로 바뀐다.
  - **삶 토큰(P5)**: 제자리 다시 불러온 뒤에도 옛 빌드의 돌던 전송(끊을 수 없다)은 `publishNow`·`writeHistory`·`inbox` 를 계속 부른다 → 새 삶의 스냅샷을 «실패» 로 덮거나 실패 줄을 두 번 쓴다. 그래서 panelInit 이 새 토큰을 만들어 이 copy 의 localStorage(`files-plus.life/<owner>` — 주인별 키라 저장소가 copy 끼리 겹쳐 보여도 다른 copy 가 내 토큰을 덮지 않는다)와 스냅샷(`life`)에 쓰고 «다시 읽어» 같은지 본다(다르면 — 쓰기 실패 + 옛 토큰 — `gated=false` 로 게이트를 끈다: 안 그러면 새 삶이 영영 막힌다), 패널은 shared 에 쓰기(스냅샷·기록·ack·기록 지우기·close 의 키 치우기) 전에 «저장소의 토큰 == 내 토큰» 인지 본다(`lifeCurrent`: 다른 문자열이 저장돼 있을 때만 낡은 삶 · 저장소가 없거나 비면 막지 않는다). 낡은 삶은 요청함도 비우지 않아 새 삶의 요청을 가로채지 않고, **줄 서 있던 작업도 더 돌리지 않는다**(`line` 콜백이 `!lifeOk()` 면 던진다 — 안 그러면 파일이 놓이고도 기록은 «실패 · 다시 불러옴» 이 돼 다시 올리면 `이름 (1)`).
  - **기록 id · 중복 제거(P6·P7)**: 기록 항목에 `jid = "<삶 토큰>:<작업 id>"`(묶음 줄은 접힌 것들의 `jids` 150개까지). panelInit 의 `orphanedJobs(old, now, seenJids(history))`: wait·run → 실패 «다시 불러옴» · **verify → 취소 «다시 불러옴 · 검증 중»**(close 와 같은 규칙 — PLACE 는 계속 돌아 파일이 놓였을 수 있다) · 이미 끝난(ok·fail·cancel) 작업 중 기록에 없는 것(늦춤 쓰기 전에 다시 불러옴)은 그 상태로 한 번 · 스냅샷이 잘라 낸 `more` 는 상태별로 «외 N개» 한 줄씩(wait·run → 실패, verify → 취소 — 한 묶음에 섞으면 접힌 줄이 첫 항목의 상태를 따라 실패 56개가 취소 7개로 보인다). 이미 기록된 jid 는 wait·run·verify 에서도 건너뛴다. 스냅샷은 `noHistory` 를 싣고 `orphanedJobs` 가 건너뛴다(«Mac에서 열기» 사본이 기록에 오르지 않는다).
  - **읽기 방어(P3)**: 모든 shared 읽기는 `readShared`(던지면 null). close 는 읽기가 던지는 키도 null 로 치운다 — `writeHistory` 가 던져도 키 치우기는 `finally` 에서 돈다.
  - **throttle 창(P8)**: `활성(wait·run·verify) 수 > 30` 일 때만 1 s(끝난 작업 30개가 이후 모든 전송을 1 s 로 묶지 않는다).
  - `close()` 가 `ownerKeys(owner)`(jobs · win · req/ack × preview/jobs = 6개) 를 `null` 로 치운다(값이 있는 것만 · 닫힌 뒤 `publishNow` 는 막혀 되살리지 않는다). 열려 있는 팝업은 `alive(shared, owner)`(jobs 키가 객체인가)로 패널 생존을 본다. 죽었으면 download/open/cancel/retry/clear 요청 대신 `notify`(«파일+ 패널이 닫혀 있다») · 막대는 «패널 닫힘».
  - **tombstone 상한**: shared 는 `setShared(key, null)` 도 `null` 로 영속한다(키가 사라지지 않는다 · 키 목록 API 없음). owner 가 copy 에 붙어 있으므로 키 수 ≤ 6 × (지금까지 만든 서로 다른 패널 블록 수) — 다시 불러오기·앱 재시작 횟수에는 비례하지 않는다. (localStorage 가 없는 환경이면 삶마다 6개씩 는다 — 이 앱에서는 해당 없음, 위 probe 로 확인.)
  - **알려진 한계**: ① 크래시·강제 종료로 `close()` 가 못 돈 owner 키는 값이 남는다(다음 실행에서 같은 owner 를 이어 받아 덮어쓰므로 그 copy 는 정리됨 · copy 가 없어졌다면 고아로 남는다). ② 크래시로 남은 `.part` · 다시 불러오기(close 가 안 불림)로 남은 `.part` 는 자동으로 지우지 않는다 — 설계상 init·glob 삭제 없음(정확한 경로만 지운다). ② 갱신: 죽은 삶(life 토큰이 지금과 다름)의 스냅샷에는 도는(run) 작업의 `part`·`partOn` 이 실려 있다(`snapshot` — 조각 이름 꼴일 때만). panelInit 이 `orphanParts(old, life)` 로 그 정확한 경로만 고르고(wait·verify 는 제외 · 폴더/glob 없음 · `isPartPath`: 절대 경로 + `.<fnv8>.files-plus-<rand8>.part` · `..` 없음) 이 컴퓨터는 `/bin/rm -f --`, 원격은 `exec("rm", ["-f","--",path], {on})` 로 지운다. 다른 owner 의 키 · 조각은 **주인 등록부**(G3)로 치운다: 공용 키 `files-plus.owners` = `[{owner, at}]` ≤ 20, 산 copy 가 init 에 올리고 15 s 마다(더 자주 금지 — setShared 가 모든 mod 를 다시 그린다) `at` 을 갱신. init 과 60 s 마다, 내가 아니고 · 이 프로세스 `LIVE` 에 없고 · `at` 이 60 s 넘게 낡은(쓰레기·먼 미래 `at` 은 «처음 본 때» 로 60 s) 주인의 뒷정리를 내 이전 삶과 똑같이 한다(`ownerCleanupPlan`: `orphanedJobs` → 기록(jid 중복 제외) · `orphanParts(snap, null)` + `files-plus.parts/<owner>` → `rmPart`(즉시 + ~10 s · ~60 s) · `ownerKeys` + parts 키 → null) 뒤 등록부에서 뺀다. 산 주인은 건드리지 않는다. **정리는 패널이 초기화될 때만 돈다(G4): 앱을 다시 켠 뒤 패널이 자동으로 안 열리면 열 때까지 기다린다.** (옛 한계: 제자리 다시 불러오기 뒤 새 copy 가 옛 owner 가 «살아 있어서» 새 owner 를 받으면, 크래시 뒤 다시 뜬 패널이 저장소의 옛 owner 만 이어 받아 새 owner 의 jobs · .part 가 아무에게도 안 치워졌다 — VM 확인.) 그 owner 의 localStorage(삶 토큰)는 copy 별 저장소라 못 건드린다. ②-1 `close()` 의 `rm -f` 는 PREP·PUSH 가 조각을 여는 순간과 경합할 수 있어 지운 조각이 다시 나타날 수 있다. ③ 미리보기의 변환(`qlmanage`·`sips`)은 취소할 수 없다(최대 120 초) — `exec` 에 Task·AbortSignal·kill 이 없다(herdr.d.ts `exec`: `{cwd, on, timeout}` 뿐). 파일을 넘기거나 창을 닫으면 결과만 버린다. ④ 패널 숨김(`layout.hide`)을 mod 가 알 방법이 없다(`layout()` 의 모양이 문서에 없고 가시성 콜백도 없다) → 미리보기 창이 남는다(Esc · ✕).
- 파일 줄 클릭 → `openPreview(path)`: 그 파일 폴더의 **파일만**(폴더 제외, 트리와 같은 정렬) 이름 배열과 index 를 props 로.
  ```js
  openOverlay(previewSpec({ mod: "files-plus", owner, full: false, viewport,   // kind:"window" frame:"none"(key 없음) width/height 0.82 · at = 가운데(앱 창 크기로 계산)
    props: { mode: "preview", owner, root, on, space, dir, files, index, mac, viewer } }));
  ```
  - 창(window): 어둡게 하지 않고, 옆을 눌러도 안 닫히며, Esc 는 mod 로 온다. 닫기 = **Esc · ✕**, 옮기기 = **머리줄·바닥줄을 끈다**(본문 칸은 `stop_propagation`). overlay `key` 를 쓰지 않는다 — key 를 주면 호스트가 «마지막 놓은 자리» 를 기억해 `at` 보다 앞서 쓰므로 화면 밖으로 끈 창이 그대로 다시 열리고 «크게 보기»(0.98)가 옛 0.82 자리에서 커져 오른쪽(레일 · ✕)이 잘린다. 그래서 **열 때마다 가운데**. 주인당 하나는 `openPreviewWindow` 가 shared `previewKey(owner)`(값 `{id, at}`)의 옛 id 를 «`at` 이 5 s 안(살아 있는 창이 0.5 s 확인 중 세 번에 한 번 = 1.5 s 마다 `at` 을 갱신 — setShared 마다 모든 mod 가 다시 그려진다)일 때만» 먼저 닫고(try/catch) 새 `{id, at}` 를 적어서 지킨다 — 크래시로 남은 낡은 id 는 호스트가 다른 창에 재사용했을 수 있어 닫지 않고 덮어쓴다(E5)(크게 보기는 새 창을 먼저 열고 자기를 닫는다 · 새 id 를 적으므로 주인 `close()` 도 옳은 창을 닫는다 · 창 `close()` 는 자기 id 일 때만 키를 지운다). 그림자는 `shadow_2xl` + 1px 테두리. 패널이 닫히면 `closeOverlay(id)` + 창 쪽 0.5 s 확인으로 닫는다. «크게 보기» 도 같은 `openPreviewWindow` 로 다시 연다.
- 패널에서 뺀다: `this.file` · ← 단추 · `show/text/picture/render/preview` 화면 · 하단 `jobsView`(→ preview.js · jobs-view.js 로).
- 그대로 둔다: 트리 · watch · git 표시 · `on_drop` 올리기 · `transfer()` · `oneAtATime` · `download/openHere/upload/pick`.
- `transfer()` 보강:
  - 상태 `wait`(줄 대기) → `run` → `verify`(해시·자리 잡기 중 · 아래 `placing`) → `ok`/`fail`/`cancel`.
  - `speedometer` 로 speed · eta.
  - 게시: `throttle(publishNow, () => 활성작업수>30 ? 1000 : 250, timers)`. 작업 생성 · 시작 · 진행 · **verify 진입 · 끝 상태(ok/fail/cancel)** 는 모두 늦춤 게시. 사용자 동작(취소 · 모두 취소 · 지우기 · 다시 시도)만 `publishNow()` 로 바로 — 이때는 `dropPending()` 으로 밀린 늦춤 호출만 버리고 **창은 풀지 않는다**(예전엔 `cancel()` 이 창까지 풀어 파일마다 쓰기 4번 → 200개 드롭 ≈ 800번 · 20 MB). 마지막 상태는 `finish()` 가 활성 작업이 0 이 되는 순간 `flush()` 로 바로 올리고, `close()` 는 jobs 키를 null 로 치운다. 실측(시뮬레이터 · 200개 드롭): jobs 키 600 → 18~2번 · 기록 200 → 17~2번 · 20 MB → 0.7 MB.
  - 끝나면 `settle()`(상태 확정 1회) → `record(entries)` = 모아 두기(늦춤 1 s) → `writeHistory()` 가 모은 묶음마다 `pushHistoryGroup` 으로 앞에 붙여 `setShared(KEY.history, …)` **한 번**. 활성 작업이 0 이 되면 · `close()` 에서는 즉시 쓴다. `clearHistory` 는 모아 둔 것도 버린다. `where` = 내려받기는 Mac 경로, 올리기는 원격 경로. 작업의 `on` 은 `transfer()` 에 넘긴 인자(실제 쓴 머신) — 다시 시도도 같은 값.
  - verify 진입 = 받은 조각의 해시를 맞추고 자리 잡기를 시작할 때(`transfer.js` 가 `job.placing()` 을 부른다 · **크기 0 이어도**). 그 전(run)에는 취소 단추가 있고, 그 뒤(verify)는 되돌릴 수 없어 숨는다.
  - `job.redo` = 같은 일을 다시 거는 함수(retry 용).
  - 전송 창 열기: **새 작업**은 깃발(`KEY.win`)이 **없을 때만** 펼친 채 연다 — 깃발이 있으면 접혀 있어도 아무것도 하지 않는다(기록/접힘 상태 유지 · 접힌 창은 칩으로만 펼친다). 가장 위에서 검사하므로 드롭 한 번에 파일이 몇 개든 `openOverlay` 는 많아야 1번. 사용자가 닫으면(깃발 null) 다음 새 작업에 다시 연다. 방금(1.5초) 연 직후는 깃발이 오기 전이라 다시 열지 않는다. 열 때 `history` 를 항상 props 로 넘긴다.
  - **칩 클릭**(명시 동작): 깃발이 있으면 1.5초 안이어도 같은 key 로 펼친 채 그 자리에서 바꾼다(`history` 이어 줌 · 중복 창 없음 · 깃발이 낡았어도 복구). 깃발이 없으면 새 작업과 같은 규칙.
  - 깃발 = `{t, expanded, history}` — 창 생성자에서 쓰고(패널이 **살아 있을 때만**: 닫힌 패널이 치운 깃발을 창이 되살리지 않는다) 기록 토글 때 갱신, close 에서 자기 토큰일 때만 null(같은 key 로 바꿔 열면 옛 창 close 가 새 창 init 뒤에 올 수 있다). 하트비트 없음. 호스트에 열린 overlay 를 묻는 API 는 없다. 5초 유휴 자동 접기는 기록 보기 중 · 호버 중 · 패널이 닫힌 뒤에는 하지 않는다.
  - 일괄 취소(`cancelMany`): 전부 바꾼 뒤 게시 1번 · 기록 1번. 기록 항목이 5개를 넘으면 앞 4개 + «외 N개»(note «묶음») 한 줄로 묶어 200개 상한을 밀어내지 않는다. 줄 대기는 바로 cancel, 도는 것은 «취소 중» 표시만, verify 는 건너뛴다.
- 전송 창 열기:
  ```js
  openOverlay({ mod: "files-plus", kind: "window", frame: "none", key: `files-plus-jobs/${owner}`,
    width: 380, height: expanded ? 330 : 32, at: { x: 640, y: 46 },
    props: { mode: "jobs", owner, expanded } });
  ```
  `at` 은 처음 한 번만 의미 있다(key 가 끌어 놓은 자리를 기억). key 에 owner 가 들어 있어 패널이 둘이면 창도 둘이다.
- `close()` (레이아웃 전환 · 블록 제거 · 앱 종료 — 호스트는 close 뒤 ~250 ms 에 task 를 끊고 끊긴 약속은 영영 안 끝난다 → 기다리는 일 없이 **동기로만**):
  1. `closed = true`(이후 게시 차단) · 늦춤 게시 취소.
  2. verify 중이던 작업: 파일은 놓였을 수 있다 → 기록에 `cancel` · note «패널 닫힘 · 검증 중» 으로 남긴다.
  3. 줄 대기 · 도는 작업을 모두 취소로 맺고(`cancelMany(jobs, "패널 닫힘", true)`) 기록에 «패널 닫힘» 으로 남긴다(묶음 규칙 동일). 도는 작업은 `job.part`(그 작업이 쓰던 `.part` 정확한 경로 · 원격이면 `job.partOn`)를 `exec("sh", ["-c", 'rm -f "$1"', …])` 로 **fire-and-forget 삭제**한다 — 훑기·glob 삭제는 없다.
  4. 모아 둔 기록을 즉시 쓰고(`writeHistory`) owner 키를 null 로 치운다.
  - **닫힘 뒤 되살아남(E4)**: 돌던 청크의 `>>` 가 rm 뒤에 조각을 다시 만들 수 있다 → 닫힘이 도는 작업의 정확한 경로를 공용 키 `files-plus.parts/<owner>`(`[{path,on}]` · 최대 50 · `ownerKeys` 에 없어 키 치우기에서 살아남음)에 적고, 다음 `panelInit` 이 같은 규칙(`isPartPath` · `rmPart`)으로 init · ~10 s · ~60 s 뒤 세 번 지우고(G7: 죽은 삶의 늦은 `>>` 가 되살릴 수 있다 · 늦은 패스는 그때 살아 있는 작업 경로를 건너뜀) 마지막 패스 뒤에만 키를 비운다. 목록이 `PARTS_CAP` 를 넘으면 가장 새 것만 남는다. 취소·닫힘으로 끝난 작업은 청크 exec 가 끝나는 때(삶이 살아 있으면) 한 번 더 지운다.
  - **알려진 한계**: 돌던 `exec`(조각 전송)는 호스트가 끊지 못하고 끝까지 돈다 — 이미 열린 `.part` 는 지워도 그 exec 가 쓰던 inode 에 쓰고, 다음 조각은 시작되지 않는다. 크래시로 `close()` 가 못 돈 경우의 `.part` 는 남는다. 전송 창은 패널이 사라져도 그 자리에 남아 «패널 닫힘» 을 보인다.
- 패널 아래 줄: 왼쪽 올리기 아이콘(macOS · `pick`) + 흐린 글자 `끌어다 놓기` · 오른쪽 칩 `↑↓ 2 · 42%`(작업 있을 때만 · 누르면 전송 창 펼쳐 열기).
- 파일 고르기(`pick`): JXA(`osascript -l JavaScript`)가 경로 배열을 JSON 으로 찍는다 — 줄바꿈이 든 폴더 이름이 두 번째 경로(`/etc/passwd`)로 쪼개지지 않는다. 절대 경로가 아니거나 LF·CR·NUL 이 든 것은 올리지 않는다.
- 문구: 트리 비었을 때 `비어 있음` 아래 작게 `끌어다 놓기로 올리기`.

## 4. 미리보기 (preview.js · C2)

- 겉: 바탕 `theme().chrome`(없으면 `background`) · 위 2px `accent` 줄 · 모서리 4px · 그림자 없음.
- 머리줄(한 줄): `이름   2.4 MB   1920×1080   <머신>` · 오른쪽 닫기 아이콘(`close.svg`, `tooltip("닫기")`).
- 몸: `[목록 240px?] [본문 flex] [정보 220px?] [아이콘 줄 44px]`.
- 아이콘 줄(위→아래, 18px 선 아이콘 · 흐린 색 · 켜진 토글은 accent + 옅은 사각 바탕 · 모두 `tooltip` 한글):
  - 목록(`list.svg`, "목록") · 정보(`info.svg`, "정보") — 토글, **기본 꺼짐**
  - 가는 줄
  - (마크다운일 때만) 원문 보기(`code.svg`) / 렌더 보기(`render.svg`) "(M)"
  - (그림일 때만) 확대(`zoom-in.svg`, "확대 (+)") · 축소(`zoom-out.svg`, "축소 (−)") · 맞춤(`fit.svg`, "맞춤 (0)", 맞춤 상태면 켜진 모양) · 실제 크기(`actual.svg`, "실제 크기 (1)") + 가는 줄
  - 크게 보기(`full.svg` / 켜지면 `full-exit.svg`, "(F)") · 경로 복사(`copy.svg`, "(⌘C)")
  - 내려받기(`download.svg`, "(⌘S)") → `send(..., "download", {abs, name, on})`
  - Mac에서 열기(`open.svg`, "(Enter · ⌘O)") → `send(..., "open", …)` (mac 아닐 땐 "열기")
  - 페이지로(`page.svg`, "(P)") → md·html 이고 html-viewer 있을 때만 보임 · `run("pane.split", {direction:"right", mod:"html-viewer", props:{space, file: abs}})` 후 닫기
  - 단축키(`keyboard.svg`, "(?)") → 팝업 안 작은 패널(새 overlay 아님)에 모든 키를 한글로 나열. 아이콘 줄은 낮은 창에서 세로 스크롤.
- 목록 칸: `같은 폴더 · 12개` 머리 + 파일 줄(아이콘 · 이름 · 지금 것 accent 바탕) · 누르면 그 파일로.
- 정보 칸: 이름 / 크기 / 종류 / 치수(그림일 때) / 위치(`on:dir` 또는 경로). 수정 시각은 `stat` 한 번(`exec("sh", ["-c", 'stat -c %Y "$1" 2>/dev/null || stat -f %m "$1"', "sh", abs], {on})`) · 실패하면 줄 생략.
- 바닥 줄(흐린 글자, 종류별 · 알림이 있으면 1.6초 동안 accent 색 알림으로 바뀜): 왼쪽 그림 `←→ 이동 · +/− 확대 · 0 맞춤 · 1 실제 크기 · 끌어서 이동 · ? 단축키 · Esc 닫기` · 글자/마크다운 `←→ 이동 · M 원문/렌더 · ? 단축키 · Esc 닫기`(M 은 마크다운만) · 그 밖 `←→ 이동 · ? 단축키 · Esc 닫기` · 오른쪽 `3/12`.
- 키: `cx.focus_handle()` 를 init 에서 `focus()` · 겉 요소에 `.track_focus(h).on_key_down(...)`. 처리한 키만 `cx.stop_propagation()`. 끝에서 멈춤(돌지 않음). 파일이 바뀔 때 · 원문↔렌더(M · 아이콘) · 도움말 토글마다 `refocus`: `handle.focus()` 를 바로 + 50 ms 뒤 한 번 더(`!closed` 일 때만 — 보이던 Editor/TextView 가 트리에서 빠지면 포커스가 사라져 모든 키가 죽는 것 방지. 렌더된 TextView 는 마우스 누름에 포커스를 가져오지 않는다 — 글 선택 · ⌘C 선택 복사 유지). 타이머는 모두 저장해 `close()` 가 끊는다(0.5 s 주인 확인 포함) · 머리줄/바닥 줄을 누르면 겉 요소로 돌아온다.
  - 이동: `→` · `space` · `↓` 다음 / `←` · `↑` 이전 / `Home` 처음 / `End` 끝 / `Esc` 닫기(도움말이 열려 있으면 그것부터 닫음 · 도움말을 Esc 로 닫은 뒤 300 ms 는 Esc 를 삼킨다 — 누르고 있던 Esc 가 창까지 닫지 않게. 키 뗌 보정 경로도 같다). 수식키(⌘ · Ctrl · Alt · Shift)가 눌린 이동 키는 무시.
  - **글자·마크다운의 ↑↓ · PageUp/PageDown 과 포커스**: Editor/TextView 에는 스크롤을 코드에서 부르는 API 가 없다(`EditorState` 에 scroll 없음). 그래서 키보드를 누가 쥐었나로 가른다 — `handle.is_focused()`(겉 요소가 **직접** 쥠)이면 ↑↓ 는 파일 이동, 아니면(글 칸을 눌러 칸이 쥠) 겉 핸들러는 ↑↓ · PageUp/PageDown 을 소비하지 않고 칸에 맡긴다. 파일이 바뀌면 겉 요소가 다시 쥐므로 기본 상태에서 ↑↓ 는 파일 이동. 그림 · 그 밖 종류는 언제나 ↑↓ 가 파일 이동. (확인 필요: 읽기 전용 Editor 가 ←/→/스페이스를 소비하는지는 실제 앱에서 눌러 봐야 안다. 소비하면 글 칸을 누른 뒤에는 머리줄을 눌러 겉 요소로 돌아와야 이동 키가 먹는다.)
  - 동작: `Enter` · `⌘O` Mac에서 열기(**열기 직전 3중 검사** — ① 실행 형식 이름 `RUNNABLE`(`.iso` · `.img` · `.sparseimage` · `.sparsebundle` 포함) ② `[ -f ] && [ ! -L ] && [ ! -x ]` ③ OS 에 기본 앱을 물어 실행기면 거절: macOS `osascript -l JavaScript -e <MAC_HANDLER_SCRIPT> <경로>`(경로는 argv · `System Events` 쓰지 않음 · 5 초) → `macHandlerVerdict` · Linux `xdg-mime query filetype` → `query default` → `linuxHandlerVerdict`. 앱 없음 · 실패 · 시간 초과 · 해석 불가 · 실행기(터미널 · 설치기 · Python Launcher · Automator · Jar Launcher · DiskImageMounter · Ghostty 등) → 열지 않고 Finder 에서 보여 줌. 순수 판정 `isRunnerApp` 등은 kinds.js · node 시험. 원격 사본 경로도 같다. TOCTOU 는 한계) / `⌘S` 내려받기 / `⌘C` 경로 복사(원격이면 `<머신>:/절대경로`, `cx.write_to_clipboard`, 바닥 줄에 «경로를 복사했다» 1.6초 — `cx.timer.after`) / `I` 정보 칸 / `L` 목록 칸 / `P` 페이지로(그 동작이 있을 때만) / `F` 크게 보기 / `?` 단축키 패널 / `M` 마크다운 렌더↔원문. 글 칸이 쥔 상태의 `⌘C` 는 선택 복사에 맡긴다. 정보 칸에도 «경로 복사» 단추.
  - 크게 보기: 같은 overlay 를 0.98×0.98(다시 누르면 0.82)로 새로 열고(props: 같은 files + 지금 index + `zoom`(`"fit"` | 배율) + `full` + `list` · `info` · `raw`), 새 것이 뜬 뒤 `closeOverlay(props().overlay)` 로 자기를 닫는다(key 가 없으므로 «바꿔 끼우기» 가 아니라 «새로 열고 옛 것을 닫기» · 새 창은 늘 가운데). 이동(pan)은 이어 가지 않고 가운데에서 시작.
  - 수식키 규칙: 글자 키(`i l f p m 0 1` 등)는 ⌘ · Ctrl · Alt 가 없을 때만, `+` · `?` 는 Shift 허용. ⌘(Linux 는 Ctrl)가 눌린 것은 명시한 `⌘O ⌘S ⌘C ⌘+ ⌘- ⌘0` 만 쓰고 나머지는 흘려보낸다.
- 본문(기존 main.js 의 `show/text/picture/render/preview` 를 옮김 · 동작 그대로):
  - 그림: 원격이면 `tx.cached` 로 받아 `image(rel)` · 맞춤(키우지 않음, 가로·세로 모두 본문 안) · 아래 `1920×1080 · 2.4 MB`.
  - 그림 보기(그림·변환·문서 첫 쪽 공통, 즉시 · 애니메이션 없음 · 스크롤바 없음): `this.zoom` null=맞춤(안 키움) · 숫자=자연 크기 배율. 단계 `0.1 0.25 0.5 0.75 1 1.5 2 3 4 6 8` — 맞춤에서는 지금 맞춤 배율 위/아래 다음 단계로, 양끝에서 멈춤. 파일이 바뀌면 맞춤 · 이동 초기화(첫 파일만 props `zoom`: 숫자 | `"fit"`).
    - 위치: 그림 칸 `relative().overflow_hidden()`(= 본문 − 캡션 24px) 안에 그림을 `absolute().left(x).top(y)`. 작으면(그 축) 가운데 · 크면 `[칸−그림, 0]` 로 가둠(끌어 내도 화면 밖으로 안 나감). 모든 크기는 `this.box`(on_size_change) · `zoom` · `px/py` 로만 계산 — 내용에서 되먹임 없음.
    - 끌기: 그림이 칸보다 크면 왼쪽 단추 `on_mouse_down` 에서 시작점(`position`) 저장 → `on_mouse_move` 에서 `position` 차이만큼 이동 → `on_mouse_up` · 칸 밖으로 나감(`on_hover(false)`) · 겉 요소 `on_mouse_up` 에서 해제. `MouseMoveEvent` 에 누른 단추 정보가 없어 스스로 쥔 상태로만 판단. 커서 `cursor_grab` / 끄는 중 `cursor_grabbing`.
    - 휠: 그냥 휠 · 트랙패드 = 커졌을 때 이동(`delta` 픽셀, 위로 굴리면 그림이 아래로) · ⌘/Ctrl + 휠 = 한 칸 = 한 단계(줄 단위 장치 1칸 · 트랙패드는 40px 누적마다 한 단계, 누적값은 파일 변경 · 맞춤에서 0 으로). 기준점 = 이벤트의 `local_position`(핸들러가 달린 그림 칸 기준) — 그 점 아래의 그림 점이 제자리에 남는다. `local_position` 이 없으면 칸 가운데(확인 필요: 실제 앱에서 값이 오는지).
    - 더블클릭(`on_mouse_down` 의 `click_count>=2`)은 맞춤↔100%, 누른 점 기준. 아이콘 줄 확대/축소/맞춤/실제 크기는 칸 가운데 기준.
    - 키: `+` `=` `⌘+` 확대 · `-` `⌘-` 축소 · `0` `⌘0` 맞춤 · `1` 실제 크기(100%).
    - 캡션 `맞춤 · 37% · 1920×1080 · 2.4 MB` / `150% · …`.
  - HEIC/AVIF: `sips` → PNG · 문서: `qlmanage -t` 첫 쪽 + `첫 쪽만 보임 · 전체는 Mac에서 열기`.
  - 글자: 읽기 전용 Editor(1 MiB · 40만 자 자름).
  - 마크다운(`.md` · `.markdown`): 기본 렌더 — `TextView.markdown(id, text).selectable(true).scrollable(true)` 가 본문을 채움. `M` · 아이콘 줄(원문 보기/렌더 보기)로 렌더↔원문(Editor). 링크(`on_link_click`)는 `^https?://` 절대 주소(공백·제어문자 없음, 2048자 이하)만 Mac 에서 `exec("open", [url])`(위치 인자). 그 밖(상대 · `file:` · `javascript:` …)은 열지 않고 바닥 줄에 «열 수 없는 링크». 자동으로 열지 않는다.
  - 받는 중: `받는 중  ▓▓▓░░░░░ 42%  (3.1 MB / 12 MB)` · 오류는 본문 안 한 줄 + 팝업 유지.
  - 다른 파일로 넘기면 앞 요청 결과는 버린다(세대 번호). 닫힐 때 `code.release()`.
- 캐시 청소(하루 지난 `.cache`)는 패널 init 에서만.

## 5. 전송 창 (jobs-view.js · C2)

- 읽기: `shared(KEY.jobs(owner))` · `shared(KEY.history)`. 폴링 금지(setShared 가 다시 그린다).
- 열림 깃발: 생성자에서 `KEY.win(owner)` 를 쓰고 close 에서 자기 토큰일 때만 null. 접기/펼치기(`reopen`)는 기록 보기 상태를 props `history` 로 이어 준다. 패널이 죽었으면(`alive` false) 막대에 «패널 닫힘» · 요청 단추는 `notify` 만 한다.
- 막대(32px · 접힘 상태도 이것만): `↑↓ 전송 2/5  ▓▓▓▓░░░░ 42%` + 펼치기/접기 아이콘(같은 key 로 height 만 바꿔 다시 연다) + 닫기 아이콘. 막대의 빈 곳은 끌어 옮기기(컨트롤만 `on_mouse_down` 에서 `stop_propagation`).
- 펼침 몸(대기열 보기):
  - 줄: `↑`/`↓` · 이름(잘림) · `▓▓▓▓▓░░░ 64%` · `3.1 MB/s` · `3초` · 상태 글자(`stateLabel`) · 끝 단추
  - 끝 단추: 대기·진행 → 취소 아이콘(`tooltip("취소")`) · 실패 → `다시 시도` · 끝난 내려받기 → Finder 아이콘(`open -R where`)
  - 색: 진행 accent · 끝 done · 실패 blocked(빨강) · 대기/취소 dim
  - 스냅샷이 잘라 낸 작업이 있으면(`more`) 목록 끝에 «외 N개 대기 · 외 N개 진행 · 끝난 N개 생략» 한 줄. 막대·요약은 `summary(jobs, more)` 로 전체를 센다.
  - 비었으면 `전송 없음`
- 기록 보기(기록 아이콘 켜짐): `오늘` / `어제` / 날짜 묶음 · 줄 `↓ 이름  1.2 MB  11:02  끝|실패` + 내려받기는 Finder 아이콘.
- 아래 아이콘 줄(같은 폭 4칸, 아이콘 + 한글):
  - `모두 지우기`(`clear.svg`) → 대기열 보기: `send("clear")` · 기록 보기: `send("clearHistory")`
  - `모두 취소`(`cancel.svg`) → `send("cancelAll")`
  - `Finder 열기`(`finder.svg`) → `exec("open", [home() + "/Downloads"])`
  - `기록`(`history.svg`) → 기록 보기 토글(켜지면 accent)
- 진행 중인 작업이 없고 실패도 없으면 5초 뒤 접는다(마우스가 위에 있으면 미룸).

## 6. 아이콘 (새 SVG · 16×16 viewBox · stroke=currentColor · 선 1.5 · fill none)

`list.svg` `info.svg` `download.svg` `open.svg` `page.svg` `close.svg` `upload.svg` `clear.svg` `cancel.svg` `finder.svg` `history.svg` `chevron-up.svg` `zoom-in.svg` `zoom-out.svg` `fit.svg` `actual.svg` `full.svg` `full-exit.svg` `copy.svg` `code.svg` `render.svg` `keyboard.svg`. 경로는 `mods/files-plus/<이름>.svg`, `svg(...)` 로 그리면 글자색으로 칠해진다.

## 7. 지키는 것

- `kinds.js` 는 바꾸지 않는다. `transfer.js` 는 **바뀌었다**(기존 시험 10개 유지 + 새 시험 1개):
  - `need(name)`: 이름이 경로에 닿는 곳(download · cached · upload)마다 `safeName` 검사.
  - 받기 뒤 취소 검사: 마지막 조각 뒤 · 자리 잡기(`place`) 전에 `job.cancelled` 를 다시 본다.
  - 조각 이름: `.<이름의 FNV-1a 8자리>.files-plus-<무작위 8자>.part`(`partName` · 약 35 바이트 고정) — 예전 `.<이름>.files-plus-….part` 는 이름 231~255 바이트에서 «File name too long».
  - `job.placing()`(자리 잡기 시작 · 크기 0 포함 · **즉시 게시** — 늦춤 게시면 ≤250 ms 동안 스냅샷이 run+part 로 남아 제자리 다시 불러오기가 PLACE 중인 조각을 지운다(E3) · verify 는 `orphanParts` 가 건드리지 않는다) · `job.part` / `job.partOn`(close 가 지울 정확한 조각 경로) · `job.onPart`(경로가 정해진 즉시 호출 → 주인이 `publishNow` · 마지막 늦춤 게시 뒤 긴 해시·받기가 이어져도 충돌 뒤 정리가 경로를 알게, E1).
  - `PLACE` · `CACHE_PLACE`: 시작 · 매 번호 시도 · 끝에 조각/놓인 이름이 있는지 보고 없으면 rc 11(`조각 파일이 사라졌다`) — 성공으로 보고하지 않는다.
  - PREP: `( set -C; : > "$part" )` — 이미 있는 조각 파일·심볼릭 링크를 따라가 자르지 않고 거절(rc 10 · «준비: 조각 파일이 이미 있다»). 이 거절은 try 밖이라 남의 파일을 `drop` 하지 않는다.
  - 격리 시점(P1·P2): **놓기 전에** 조각 파일에 단다(xattr 는 inode 에 붙어 `ln`·`mv -n`·`mv -f` 로 이름이 바뀌어도 남는다). 놓은 뒤에 달면 그 사이 패널이 닫혀도 PLACE 는 끝까지 돌아 격리 없는 파일이 남는다. 미리보기(`preview.js`)의 `makeTransfer` 에도 같은 옵션(`quarantine: () => mac`)을 줘 `CACHE_PLACE` 의 `mv -f` 가 격리 없는 inode 로 바꿔치지 못하게 한다. 이미 있는 사본은 그대로 한 번 더 단다.
  - 격리: `makeTransfer(exec, { quarantine })` — 참이면 이 컴퓨터에 놓인 받은 파일(내려받기 · «Mac에서 열기» 사본, 사본이 이미 있어도)에 `xattr -w com.apple.quarantine "0081;<초(16진)>;files-plus;" <경로>`(macOS 만 · 실패 무시 · 경로는 위치 인자). 올리기에는 달지 않는다.
- `state.js` 는 `tests/state.test.mjs` 로 시험(요청함 순서·중복·ack, 요약 바이트 가중, 막대, 속도, 기록 묶음·상한, throttle leading/trailing/flush/dropPending · restoreOwner · orphanedJobs · own · 묶음 방향 · partName).
- 화면 검사: `herdr-app check` 는 props 없이 한 번 그린다 → 패널. preview · jobs 는 scratch 사본의 `init` 에 가짜 props 를 넣어 각각 `check passed` 확인(저장소엔 넣지 않음).
- drag-over 이벤트가 없어 놓기 전 강조는 하지 않는다(gpui-kit.d.ts 에 `on_drop` 만 있음).
- 진행률은 4 MiB 조각 단위로 오른다.
