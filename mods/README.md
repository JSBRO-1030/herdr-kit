# mods — Herdr 앱(Mac) mod

> 세트 전체 안내는 저장소 맨 위 `README.md`.

원격 머신의 파일을 Herdr 앱(Mac)에서 보고 주고받게 하는 herdr 앱 mod 입니다. **files-plus(파일+)** 와 **panel-tabs(패널 탭 줄)** 가 들어 있습니다.

## files-plus 가 하는 일

지금 눌린 터미널이 있는 폴더를 트리로 보여 줍니다. 원격 머신 터미널이면 그 원격 폴더가 보입니다. 파일을 누르면 **미리보기 팝업**이 뜨고, 전송은 **전송 창**에 FTP 처럼 %로 보입니다.

| 일 | 내용 |
|---|---|
| 글자 파일 보기 | 기본 Files 와 같다(1 MiB까지) |
| 이미지 보기 | png · jpg · gif · webp · bmp · svg · ico · tiff · pnm(16 MiB까지) · HEIC/HEIF/AVIF 는 Mac 에서 PNG 로 바꿔 보여 준다 |
| 문서 첫 쪽 | pdf · docx · xlsx · pptx · key · pages · hwp 등. Mac 빠른 보기로 첫 쪽만 그림으로 보여 준다(200 MiB까지) |
| 내려받기 | 원격 파일 → Mac `~/Downloads`. 같은 이름이 있으면 `이름 (1).확장자` |
| Mac에서 열기 | 원격 파일을 받아 Mac 기본 앱으로 연다 |
| 터미널에 나온 파일 이름 | 이름을 더블클릭하면 미리보기 팝업으로 연다(원격 머신 터미널도 · 규칙은 `files-plus/RECIPE.md`). Herdr 자체의 ⌘+클릭은 다르다: 슬래시가 든 경로(`/…/a.md` · `./a.md` · `docs/a.md`)만 링크가 되고, **Mac 디스크의 같은 경로**를 Mac 기본 앱으로 연다 — 이름만 있는 `a.md` 는 링크가 아니고, 원격 머신 터미널의 경로는 원격 파일이 아니라 Mac 쪽 같은 경로를 연다(없으면 안 열림 · Herdr 0.1.16 시험 VM 에서 확인) |
| 올리기 | Finder 에서 패널로 «끌어다 놓기» 또는 아래 «올리기» 아이콘(고르기 창에서 파일 · 폴더 · 여러 개 · 섞어 고르기). **폴더는 구조 그대로**(빈 폴더 포함) 올라갑니다. 같은 이름이 있으면 덮어쓰지 않고 파일은 `이름 (1).확장자` · 폴더는 새 폴더 `이름 (1)`(병합 안 함) |
| 새 폴더 · 이름 바꾸기 · 지우기 | 트리 줄을 오른쪽 클릭 → 메뉴(빈 곳은 «새 폴더» 하나) · 아래 «새 폴더» 아이콘. 이름 입력 창 / 확인 창이 뜨고 결과는 알림으로. 지우기는 그 머신에 휴지통 도구(macOS `trash` · `gio` · `trash-put`)가 있으면 휴지통으로, 없으면 «영구히 지울까?» 창에서 «영구 삭제» 단추를 눌러야만(Enter 로는 안 지워짐). 같은 이름은 덮어쓰지 않고 거절하며, 전송이 도는 동안 이름 바꾸기·지우기는 거절한다. 이 컴퓨터와 원격 모두 |
| md · html 페이지 | «페이지로» 아이콘 → html-viewer mod 를 옆 페인으로 연다(깔려 있을 때만) |

### 미리보기 팝업

- 파일 줄을 누르면 미리보기 창이 뜹니다(어둡게 하지 않는 떠 있는 창 · 패널당 하나 — 다른 파일을 누르면 앞 창을 닫고 새로 엽니다). **열 때마다 가운데에서 뜨고**(놓은 자리를 기억하지 않습니다 — 화면 밖으로 끌어 둔 창이 그대로 다시 뜨지 않습니다) **Esc · ✕ 로 닫고, 머리줄을 끌어 옮깁니다.** 창 옆(전송 창 등)을 눌러도 닫히지 않습니다. 같은 폴더의 파일(폴더 제외)을 트리 순서로 넘겨 봅니다.
- 이동 키: **→ · 스페이스** 다음 / **←** 이전 / **Esc** 닫기. 그림·문서 등에서는 **↓** 다음 · **↑** 이전 · **Home · End** 처음 · 끝도 됩니다. 끝에서 멈춥니다(돌지 않음). **글자·마크다운에서는 ↑ ↓ PageUp PageDown Home End 를 파일 넘기기에 쓰지 않습니다** — 글 칸(Editor·TextView)은 프로그램에서 포커스를 줄 수 없어서, 글 칸을 눌러야 이 키들이 글을 스크롤합니다(위·아래 줄을 누르면 포커스가 겉으로 돌아와 ← → · 스페이스로 파일을 넘깁니다). 키를 누르고 있어도 열기·내려받기·크게 보기·토글은 한 번만 일어납니다.
- 동작 키: **Enter · ⌘O** Mac에서 열기(이름이 실행 형식이거나 **기본 앱이 터미널·설치기·실행기면 열지 않고 Finder 에서 보여 준다** — 아래 «Mac에서 열기 규칙») / **⌘S** 내려받기 / **⌘C** 경로 복사 / **I** 정보 / **L** 목록 / **P** 페이지로 / **F** 크게 보기(0.98) ↔ 보통 / **M** 마크다운 렌더 ↔ 원문 / **?** 단축키 패널.
- 그림: **+ =** 확대 · **-** 축소 · **0** 맞춤(⌘+ · ⌘− · ⌘0 은 앱 전체 확대(Herdr 0.1.16)라 미리보기에 오지 않는다) · **1** 실제 크기 · 커졌을 때 끌기 · 휠로 이동 · **⌘/Ctrl+휠** 커서 기준 확대 · 더블클릭 맞춤 ↔ 100%.
- 글자 크기(글자 보기): **+ · - · 0** 글자 크게 · 작게 · 기본 — 아래 «창 크기 · 글자 크기».
- 창 크기: 오른쪽·아래 **가장자리**나 오른쪽 아래 **모서리**를 끌면 크기가 바뀌고, **모서리를 두 번 누르면** 기본 크기로 돌아갑니다(Esc = 끌기 취소).
- 마크다운(.md)은 렌더로 열립니다. 링크는 http(s) 만 Mac 에서 열립니다. **그림은 불러오지 않습니다**: `![alt](주소)` 는 `[그림: alt](주소)` 링크로, `<img>` 같은 태그는 `[그림]` 으로 바뀝니다(읽기만 해도 IP 가 새거나 안쪽 주소로 요청이 나가지 않게). 렌더는 앞 200 KB 까지이고 뒤는 «원문 보기(M)» 로 봅니다(원문 칸은 400K 글자). 경로에 줄바꿈 · 제어 문자가 든 파일은 «경로 복사» 를 거절합니다. 가로×세로가 1억 화소를 넘는 그림은 그리지 않고 «너무 큰 그림» 으로 알립니다.
- 위에 이름 · 크기 · 치수 · 머신, 아래에 종류별 키 안내(`←→ 이동 · ? 단축키 · Esc 닫기` …)와 `3/12`.
- 오른쪽 아이콘 줄(위 → 아래, 마우스를 올리면 한글 설명):
  - 목록 · 정보: 켜고 끄는 칸(기본 꺼짐). 목록 = 같은 폴더 파일, 정보 = 이름 · 크기 · 종류 · 치수 · 위치 · 수정 시각
  - 확대 · 축소 · 맞춤 · 실제 크기(그림) · 원문/렌더(마크다운) · 크게 보기 · 경로 복사 · 내려받기 · Mac에서 열기 · 페이지로(md·html 이고 html-viewer 가 있을 때만) · 단축키

#### 창 크기 · 글자 크기

**창 크기 조절.** 미리보기 창(그림 · 글자 · 문서 모두)의 오른쪽 가장자리 · 아래 가장자리 · 오른쪽 아래 모서리를 끌면 창 크기가 바뀐다. 끄는 동안 앱 전체에 투명한 «크기 틀»이 뜨고 틀 안에 `너비 × 높이`와 테두리가 보이며, 놓으면 그 크기로 창이 다시 열린다(창 왼쪽 위는 고정). 최소 420×300 이고 앱 창 밖으로는 나가지 않는다. 끄는 도중 Esc 를 누르면 취소(창은 그대로), 15 초 동안 움직이지 않거나 파일+ 패널이 닫혀도 틀이 스스로 닫힌다.

**크기 기억 · 기본 크기.** 고른 크기는 기억되어(`files-plus.previewSize`) 다음 미리보기도 같은 크기로 열린다. 자리는 기억하지 않고 늘 가운데에서 연다. 오른쪽 아래 모서리를 **두 번 누르면** 기억한 크기를 지우고 기본 크기(앱 창의 82%)로 되돌린다. «크게 보기»(F)는 그대로 쓸 수 있고, 다시 F 를 누르면 기억한 크기로 돌아온다.

**글자 크기.** 글자 보기(마크다운 렌더 · 원문 · 코드 · 글자 파일)에서 `+` · `-` · `0` 키로 글자를 크게 · 작게 · 기본으로 바꾼다. 오른쪽 아이콘 줄의 «글자 크게 · 작게 · 기본» 단추도 같다. 9~32px 의 14단계이고 기본은 렌더 13px · 원문/코드 12px. 렌더와 원문/코드는 각각 따로 기억되며(`files-plus.fontSize`) 바꿀 때마다 바닥줄에 «글자 15px» 처럼 알려 준다. 그림 보기에서는 `+` · `-` · `0` 이 그림 확대·축소·맞춤이다. ⌘+ · ⌘− · ⌘0 은 앱 전체 확대(Herdr 0.1.16)라 미리보기에 오지 않는다(글자 · 그림 모두). 렌더된 마크다운 안의 코드 블록은 글자 크기를 바꿔도 커지지 않는다(호스트 렌더러). 원문/코드 칸은 글자 크기를 바꾸면 스크롤이 맨 위로 돌아간다.

### 전송 창

- 전송이 생기면 작은 창이 위에 뜹니다. 한 줄 막대 `↑↓ 전송 2/5 ▓▓▓▓░░░░ 42%` 를 펼치면 파일별 줄이 보입니다: 방향 · 이름 · % · 속도 · 남은 시간 · 상태(대기 · 진행 · 검증 중 · 끝 · 실패 · 취소).
- 줄 끝 단추: 대기·진행 = 취소 · 실패 = «다시 시도» · 끝난 내려받기 = Finder 에서 보기.
- 아래 아이콘 넷: **모두 지우기**(끝난 줄 · 기록 보기에서는 기록) · **모두 취소** · **Finder 열기**(`~/Downloads`) · **기록**(지난 전송 목록, 오늘 · 어제 · 날짜별).
- 전송은 패널이 돌리므로 패널이 닫히면 창에 «패널 닫힘» 이 뜨고 도는 전송은 취소됩니다. 패널 아래 줄의 칩 `↑↓ 2 · 42%` 를 누르면 창이 다시 펼쳐집니다.
- 진행 중이거나 실패한 것이 없으면 5초 뒤 접힙니다.

### 끌어다 놓기 · 격리

- Finder 파일을 패널에 놓으면 올라갑니다. 폴더 줄 위 = 그 폴더, 파일 줄 위 = 그 파일의 폴더, 빈 곳 = 맨 위 폴더. 여러 파일은 한 파일씩 차례로 가고 나머지는 «대기»입니다.
- **폴더 · 여러 항목 올리기**: 폴더 · 파일 여러 개 · 섞어 놓아도 같습니다(고르기 창도 같음). 폴더는 «폴더 만들기» 작업 1개 + 안의 파일마다 작업 1개로 한 파일씩 올라가고, 끝 기록은 «외 N개» 로 묶입니다. 하위 폴더는 빈 폴더까지 만듭니다. 받는 곳에 같은 이름(파일 · 폴더 · 링크)이 있으면 새 폴더 `이름 (1)` · `이름 (2)` … (폴더 이름은 확장자를 나누지 않음 · `v1.2` → `v1.2 (1)`). 이름은 바이트 그대로(NFC 변환 없음). 폴더 안에서 **건너뛰는 것**: 심볼릭 링크(따라가지 않음) · 소켓 · FIFO · 장치 · `.DS_Store` · `._*` · `Icon\r`(그 밖 dotfile 은 올림) — 건너뛴 수는 작업 note 와 알림에. 끌어 놓은 맨 위 항목 자체가 링크면 따라갑니다. 읽을 수 없는 하위 폴더는 빈 폴더로 만들고 나머지는 올리며 «읽지 못한 곳 N개» 로 알립니다. **상한**: 한 번에 올리는 폴더 안 파일 합계 5000개(맨 위에 놓은 낱개 파일은 합계에 안 듦 · 넘으면 그 폴더가 «파일이 너무 많다» 로 실패) · 폴더마다 하위 폴더 2000개. 폴더와 그 안 항목을 함께 놓으면 안쪽은 뺍니다. 이 컴퓨터 안 복사에서 올리는 폴더 자신이나 그 안으로는 거절합니다.
- 폴더로 끌어 놓은 앱 번들(`.app` · `.framework` 등)은 폴더로 올라가고 그 안 심볼릭 링크는 건너뛰므로, 받는 곳에서 실행되지 않을 수 있습니다.
- Mac 에 받은 파일(내려받기 · «Mac에서 열기» 사본)에는 macOS 격리 속성(`com.apple.quarantine`)을 답니다. 처음 열 때 «인터넷에서 받은 앱/파일» 확인창이 뜰 수 있습니다. 올리기에는 달지 않고, 이 컴퓨터 안의 파일(원격이 아닌 것)에도 달지 않습니다. 이 컴퓨터의 파일을 «Mac에서 열기» 로 열 때 `.command` · `.terminal` · `.app` · `.workflow` · `.scpt` · `.sh` · `.pkg` · `.dmg` 같은 실행되는 형식은 열지 않고 Finder 에서 보여 줍니다(`open -R` · 알림 «Finder 에서 보여 준다»). 원격에서 받은 것은 격리 속성이 있어 Gatekeeper 가 묻습니다.
- **Mac에서 열기 규칙(Enter · ⌘O)**: 열기 직전 ① 이름이 실행 형식(`.command` · `.app` · `.sh` · `.pkg` · `.dmg` · `.iso` · `.img` · `.sparseimage` · `.sparsebundle` …)이면 열지 않고 ② 보통 파일 · 심볼릭 링크 아님 · 실행 비트 없음을 보고 ③ **OS 에 «이 파일을 어느 앱이 여나» 를 묻습니다**(macOS `NSWorkspace` — `osascript -l JavaScript`, 경로는 인자로만 · Linux `xdg-mime query filetype` → `query default`). 그 앱이 터미널(Terminal · iTerm2 · Ghostty · Alacritty · kitty · WezTerm · Warp · Hyper · Tabby · Herdr) · 설치기(Installer) · 실행기(Python Launcher · Automator · Jar Launcher · Java Web Start) · 디스크 마운터(DiskImageMounter)면 **열지 않고 Finder 에서 보여 줍니다**(Linux 는 폴더를 엽니다). **Finder 별칭(alias) 파일**은 `NSURLIsAliasFileKey` 로 먼저 가려 대상이 무엇이든(계산기 · `.webloc` · `.shortcut` · `.mobileconfig`) 열지 않고 보여 줍니다. 기본 앱이 없거나 · 물음이 실패 · 시간 초과(5 초) · 해석 불가여도 열지 않습니다. Linux 는 mime(`.deb` · `.rpm` · flatpak · AppImage · 셸 스크립트 …)과 기본 앱(소프트웨어 센터 · 패키지 설치기 · 터미널 에뮬레이터)도 같은 방식으로 거릅니다. 이 컴퓨터 파일과 원격에서 받은 사본 모두 같습니다.
- **크래시 뒤 정리**: 앱이 죽어 못 지운 `.part` 는, 다음에 패널이 뜰 때 죽은 삶의 스냅샷에 적혀 있던 «도는 전송» 의 `.part` **정확한 경로 하나씩만** 지웁니다(이름이 `.<8자리>.files-plus-<8자>.part` 꼴일 때만 · 폴더는 안 지움 · 훑기·glob 없음 · 원격이면 그 머신에서). 조각 경로는 **정해지는 즉시**(`job.onPart` → 즉시 게시) 스냅샷에 올라갑니다. 닫힘 때 도는 전송의 조각 경로는 공용 키 `files-plus.parts/<owner>` 에도 남겨 다음 시작이 한 번 더 지웁니다(닫힘 뒤 늦게 끝난 청크 `>>` 가 되살리는 경우). 자리 잡기(verify)는 즉시 게시되고 `PLACE` 는 조각이 사라지면 성공 대신 실패(rc 11)로 끝납니다. 다른 패널(owner)의 흔적은 **주인 등록부**(`files-plus.owners` · 최대 20 · 15 s 마다 `at` 갱신)로 치웁니다: 패널이 뜰 때와 60 s 마다, 60 s 넘게 갱신이 없고 이 프로세스에도 없는 주인의 끝나지 못한 작업(기록)·`.part`·shared 키를 내 이전 삶과 똑같이 치웁니다(산 주인은 건드리지 않음). **패널이 초기화될 때만 돈다 — 앱을 다시 켠 뒤 패널이 자동으로 안 열리면 패널을 열 때까지 정리는 기다립니다.**

- 앱 자체의 끌어 놓기 업로드(`hc put`)는 한 파일 8 MB까지이고, 원격 → Mac 내려받기는 앱에 없습니다. 이 mod 는 `hc exec` 로 4 MiB 조각씩 옮겨서 큰 파일도 올리고 내려받습니다. 끝에 sha256 으로 맞춥니다.

## Mac 에 깔기

공개 저장소라 로그인 없이 받을 수 있습니다. `gh` 가 없으면 `git clone https://github.com/JSBRO-1030/herdr-kit.git ~/herdr-option` 으로 받아도 됩니다.

```sh
herdr-app --version; hc --version      # 만든 기준: 앱 0.1.15 · hc 0.1.19
gh repo clone JSBRO-1030/herdr-kit ~/herdr-option
mkdir -p ~/.config/herdr-app/mods
cp -R ~/herdr-option/mods/files-plus ~/.config/herdr-app/mods/
herdr-app check ~/.config/herdr-app/mods/files-plus     # «check passed» 가 나와야 한다
```

- 한 번 열기: `herdr-app do pane.split '{"direction":"right","mod":"files-plus"}'` (지금 탭 오른쪽) 또는 `herdr-app do tab.new '{"mod":"files-plus"}'` (새 탭)
- 지우기: `~/.config/herdr-app/mods/files-plus` 폴더를 지웁니다(아래 «화면에 띄우기» 로 더한 블록·단추도 함께 뺍니다).
- `check` 가 떨어지면 앱부터 올립니다. 0.1.15 아래 판은 확인하지 않았습니다.

## 화면에 띄우기 (Mac · 늘)

`mod.json` 이 `"place": "none"` 이라 깔기만 하면 화면에 붙지 않습니다. `install-mac.sh` 가 깔기부터 띄우기까지 한 번에 합니다. 여러 번 돌려도 같습니다.

```sh
sh ~/herdr-option/mods/install-mac.sh            # 지금 레이아웃(shared.json 의 layout)
sh ~/herdr-option/mods/install-mac.sh my-main    # 이름을 줄 때
sh ~/herdr-option/mods/install-mac.sh --hide-files    # 기본 Files 단추를 뺀다(옵션은 이름 앞뒤 아무 데나)
sh ~/herdr-option/mods/install-mac.sh --show-files    # 되돌린다
```

하는 일:

1. `files-plus` 를 `~/.config/herdr-app/mods/` 로 복사하고 `check` 합니다.
2. 레이아웃의 오른쪽 패널 스택 `panel-body` 에 블록을 더합니다(기본 `files` 바로 뒤).
   ```json
   { "id": "files-plus", "type": "block", "content": { "mod": "files-plus" } }
   ```
3. 탭바 mod `auto-tabs`(앱 `tabs` 복제본)가 있으면 «Files+» 패널 단추를 더하고 `check` 합니다. 순정 `tabs` 를 복제한 그대로여도, Git 단추를 더한 상태여도 됩니다(`"graph"` 는 선택). 떨어지면 **auto-tabs 의 이 변경만** 되돌립니다 — 앞에서 바꾼 mod 파일 · 레이아웃 블록은 그대로 남습니다(그 둘은 따로 `check` · 복원을 거쳤습니다).
   ```js
   const enabled = [...(shared("workspace.panels") ?? ["files", "changes"]), "files-plus"];
   .child(panelButton("files-plus", "Files+", "mods/files-plus/folder.svg"))   // Files 단추 바로 뒤
   ```
4. 그 레이아웃이 떠 있으면 패널을 files-plus 로 엽니다(`layout.select` + `layout.show`). 패널이 files 를 보이던 중이어도 files-plus 로 바뀝니다.

- 고치기 전에 사본을 둡니다: `layouts/<이름>.json.bak-files-plus-<시각>-<PID>` · auto-tabs 는 실제 main.js 옆(`.main.js.bak-files-plus-<시각>-<PID>`, main.js 가 링크면 링크 대상 폴더) · 바뀌는 mod 파일은 `.files-plus-backup/<시각>-<PID>/`.
- 레이아웃 JSON 은 임시 파일에 쓴 뒤 통째로 바꿔 끼웁니다(쓰는 중 죽어도 원본 유지 · 링크면 링크 대상에). 하드링크된 파일만 inode 를 지키려고 제자리에 덮어씁니다. 들여쓰기(공백 수 · 탭) · 키 순서 · 끝 줄바꿈 · CRLF 는 원본대로이고, 한 줄로 쓴 배열 같은 자유 서식은 정리될 수 있습니다.
- 읽기 전용 · 잠긴(uchg) 파일이나 쓸 수 없는 폴더(레이아웃 · mods · auto-tabs)면 아무것도 바꾸기 전에 «쓸 수 없다 … 바뀐 것 없음» 을 내고 멈춥니다. 소유자를 못 맞추면 제자리 쓰기로 소유자를 지킵니다.
- kill 로 남은 임시 파일 `.<8자>.files-plus-tmp` 는 10분이 지나면 다음 실행이 치웁니다(내 소유 일반 파일만).
- `--show-files` 는 이 설치기가 넣은 `.filter(p => p !== "files")` 만 지웁니다. 사이에 낀 주석은 그대로 둡니다.
- 탭바 단추는 살아 있는 «Files · Changes» 두 줄이 이어진 사이에 더합니다. Git 단추는 있어도 없어도 됩니다. 주변이 다르면 손대지 않고 «모양이 예상과 달라» 로 알립니다.
- 새 판은 숨긴 사본 폴더에서 먼저 `check` 하고, 통과해야 파일마다 바꿔 끼웁니다(실패하면 되돌림). `auto-tabs` 도 사본에서 `check` 가 통과해야 반영합니다. 동시에 두 번 돌리면 잠금(`.files-plus-install.lock`)으로 하나만 돕니다.
- 패널 스택에 files-plus mod 블록이 있는데 id 가 `files-plus` 가 아니면 멈춥니다(아무것도 바꾸기 전에). 탭바 단추와 자동 열기가 id 로 찾기 때문입니다. 그 블록 id 를 `files-plus` 로 고친 뒤 다시 돌립니다.
- `installed.json` 을 못 읽으면 기본 레이아웃인지 알 수 없으니 멈춥니다.
- 앱이 싣는 레이아웃(`main` · `terminals` · `win98`)은 고치지 않습니다. 앱이 다음 시작에 되돌리기 때문입니다. `herdr-app do layout.clone '{"name":"main","as":"my-main"}'` 로 복제한 뒤 그 이름을 줍니다.
- `auto-tabs` 모양이 위와 다르면 손대지 않고 알립니다. 그때는 위 두 줄을 손으로 더합니다.
- 옵션을 안 주면 Files 보임/숨김은 그대로입니다. 모르는 옵션 · 둘 다 준 경우 · 이름이 둘이면 사용법을 찍고 종료 코드 2 입니다.
- 새 판 받기: `git -C ~/herdr-option pull && sh ~/herdr-option/mods/install-mac.sh`

### 기본 Files 숨기기 (`--hide-files` / `--show-files`)

- `--hide-files`: `auto-tabs` 의 `enabled` 에서 `files` 를 걸러 «Files» 단추를 뺍니다. 탭바가 Files 를 복원하지도 않습니다. 같은 `check` · 사본 · 바꿔 끼우기 절차를 탑니다.
  ```js
  const enabled = [...(shared("workspace.panels") ?? ["files", "changes"]).filter(p => p !== "files"), "files-plus", "graph"];
  ```
- `files` 블록은 레이아웃에 그대로 둡니다(단추가 없어 안 보일 뿐). `--show-files` 는 그 필터를 빼서 원문 그대로 되돌립니다(시험: 바이트가 같다). 여러 번 돌려도 같습니다.
- 앞뒤 모양이 예상과 다르면 `auto-tabs` 를 손대지 않고 알립니다. 그 줄에 사용자가 직접 단 `.filter(… files …)` 가 이미 있으면 `--hide-files` 는 «이미 숨겨진 것» 으로 보고 두 번째 필터를 덧붙이지 않으며, `--show-files` 는 우리 필터(`p !== "files"`)만 빼고 다른 모양은 «모양이 달라 손대지 않았다» 로 둡니다. 주석(`//`)으로 꺼 둔 줄은 «있는 것» 으로 세지 않습니다.
- **`--hide-files` 는 auto-tabs 를 쓰는 모든 레이아웃·공간에 적용됩니다**(전역). files-plus 블록이 없는 레이아웃에서는 Files 단추가 사라지고 «Files+» 도 아무 일을 하지 않습니다. 마지막으로 기억한 패널이 files 인 공간은 그 패널이 닫힙니다. 이런 레이아웃이 있으면 쓰지 않거나, 그 레이아웃에도 설치를 돌립니다.
- 안전: `mods/files-plus` 가 심볼릭 링크면(다른 체크아웃을 덮어쓰게 됨) 아무것도 하지 않고 멈춥니다. 레이아웃 파일 · `auto-tabs/main.js` 가 링크면 링크가 가리키는 실제 파일에 씁니다(링크는 유지). 파일 모드(0644 등)와 CRLF 줄 끝은 그대로 둡니다. 설치 끝의 `layout.select` 는 앱이 방금 고친 레이아웃을 다시 읽는 사이 실패할 수 있어 0.5초 간격으로 6번까지 다시 해 봅니다.
- **`auto-tabs` 를 쓰는 레이아웃에서만 듣습니다.** 앱이 싣는 `main` 레이아웃의 기본 `tabs` 는 읽기 전용이라 계속 Files 를 보여 줍니다.

- ⚠ 설치기는 auto-tabs 의 살아 있는 `const enabled` 선언 하나를 고칩니다. 배열의 맨 위 `"graph"` 항목이 하나면 그 바로 앞에 `"files-plus", ` 를 넣고, 없으면 마지막 항목 뒤에 더합니다. 순정 `const enabled = shared("workspace.panels") ?? ["files", "changes"];` 도 위 배열 꼴로 바꿉니다. Git 단추와 `"graph"` 는 필수가 아닙니다. 다음이면 «모양이 예상과 달라» 로 알리고 손대지 않으니, 위 `enabled` 항목과 단추 줄을 손으로 더합니다: 선언이 하나가 아님 · 맨 위 `"graph"` 항목이 여럿 · 배열에 템플릿 리터럴이나 `\` 이스케이프가 듦 · 배열 뒤에 호출·연산이 이어짐(`.concat(…)` 등) · `"files-plus"` 가 다른 항목 안쪽에만 있음 · Files · Changes 두 줄이 이어지지 않거나 한 줄 안에서 닫히지 않음.

늘 띄우는 법(손으로), 손 점검표, 옮기는 방식은 [`files-plus/RECIPE.md`](files-plus/RECIPE.md) 에 있습니다.

## panel-tabs (패널 탭 줄, M1 · M2)

오른쪽 패널 스택(`panel-body`)의 머리줄에 **칩**(패널 이름 단추)을 한 줄로 보여 줍니다. 칩을 누르면 그 패널로 바뀝니다. 폭이 좁으면 **아이콘만** 남습니다. 닫기 · `+` · 옮기기는 아래 «M2» 에서 더해집니다(M1 만으로는 없음).

```sh
sh ~/herdr-option/mods/install-mac.sh --panel-tabs [레이아웃]     # 깔고 header 를 단다 · 여러 번 돌려도 같다
sh ~/herdr-option/mods/install-mac.sh --remove-panel-tabs [레이아웃]   # header 만 뺀다
```

- **Herdr 앱 0.1.17 이상**이 필요합니다(header 꼴을 0.1.17 에서 확인). 낮거나 버전을 못 읽으면 아무것도 바꾸기 전에 멈춥니다.
- `--panel-tabs` 는 기본 설치(files-plus 깔기 · 블록 · 탭바 «Files+»)에 더해 `mods/panel-tabs` 를 같은 절차(숨긴 폴더 `check` → 사본 `.panel-tabs-backup/<시각>-<PID>/` → 바꿔 끼우기)로 깔고, 레이아웃의 `panel-body` 에 아래 header 를 더하거나 고칩니다. files-plus 블록과 header 는 **한 번에 계산해 한 번만 저장**합니다(사본 하나).
  ```json
  "header": { "content": { "mod": "panel-tabs", "props": { "stack": "panel-body", "hideFiles": false } }, "height": 32 }
  ```
- 칩은 탭바의 Files / Changes 보임 여부를 따릅니다: `hideFiles` = 이번 실행 뒤 탭바 Files 단추가 숨겨 있나. `--hide-files` / `--show-files` 변환 결과를 같은 패처로 미리 읽고, 변환을 거절하면 지금 상태를 유지합니다. 둘 다 없으면 `auto-tabs` 의 지금 상태이며, `auto-tabs` 가 없으면 옵션에 관계없이 false 입니다. 나중에 `--hide-files` / `--show-files` 만 돌리면 `hideFiles` 는 그대로이니, 바꿨으면 `--panel-tabs` 를 다시 돌립니다.
- 이미 panel-tabs 의 header 가 있으면 `hideFiles` · `stack` · `height` 만 다를 때 고치고 아니면 그대로 둡니다. **panel-tabs 가 아닌 header 가 이미 있으면** 아무것도 바꾸기 전에 멈춥니다(덮어쓰지 않음).
- `--panel-tabs` / `--remove-panel-tabs` 실행 전 떠 있는 대상 레이아웃에 `status` 오류가 이미 있으면 메시지를 출력하고 아무것도 바꾸기 전에 거절합니다(파일을 먼저 고친 뒤 재실행). 쓴 뒤 그 레이아웃이 떠 있으면 `herdr-app status` 의 `errors` 에 `layouts/<이름>.json was not applied` 가 생기는지 2초 봅니다. 생기면 사본으로 되돌리고(블록 · header 모두) 그 메시지와 함께 실패합니다. 안 떠 있는 레이아웃은 Herdr 가 파일을 보지 않아 검사할 수 없습니다 — 띄운 뒤 `herdr-app status` 를 봅니다. `status` 를 못 읽으면 «확인 못 함» 만 알립니다.
- `--remove-panel-tabs` 는 `panel-body` 의 header 가 panel-tabs 것일 때만 뺍니다(사본 + 통째로 바꿔 끼우기). mod 복사 · 패널 열기는 하지 않고(kit 판 `auto-tabs` 는 그대로 두며, 아래 «M2» 의 `panel-bottom` 이 우리 것이면 같이 지웁니다), `mods/panel-tabs` 폴더는 그대로 둡니다(`place: none` 이라 해가 없음 · 지우려면 폴더를 손으로). header 가 없으면 «없음, 바뀐 것 없음» 으로 끝납니다(종료 0). `--panel-tabs` · `--hide-files` · `--show-files` 와는 함께 못 씁니다(종료 2).
- `mods/panel-tabs` 가 심볼릭 링크이거나 그 안에 심볼릭 링크 · 하드링크 파일이 있으면 아무것도 바꾸기 전에 거절합니다. 게시는 `mod.json` 을 먼저, `main.js` 를 마지막에 합니다.
- 깐 뒤에는 **앱을 한 번 다시 띄우기**를 권합니다(아래 첫 한계).

### M2: 옮기기 · 닫기 · 「+」 (아래 패널)

`--panel-tabs` 가 아래 두 조건이 **모두** 맞을 때 M1 에 더해 M2 를 합니다. 하나라도 틀리면 한 줄 알림(«Herdr 0.1.18 미만 — 옮기기·닫기·+ 는 꺼짐» · «위쪽 바가 auto-tabs 가 아니라 옮기기·닫기·+ 는 꺼짐(M1 탭 줄만)») 뒤 M1 을 그대로 합니다.

- Herdr **0.1.18 이상**(M1 의 0.1.17 문은 그대로).
- 대상 레이아웃에 `content.mod` 가 `auto-tabs` 인 블록이 있음.

M2 가 하는 일:

1. **kit 판 `auto-tabs` 로 바꿔 끼웁니다.** 지금 `mods/auto-tabs/` 를 **폴더째** `.auto-tabs-backup/<시각>-<PID>/` 에 복사한 뒤, 저장소 `mods/auto-tabs/` 의 관리 파일(`mod.json` · `main.js` · `owner.js` · `panels.js` · `names.js` · `config.js` · `win-*.svg` · `LICENSE-herdr-app`)을 숨긴 폴더에 놓고 `check` 가 통과하면 같은 게시 엔진으로 바꿔 끼웁니다. `gpui-kit.d.ts` · `jsconfig.json` · 사용자 파일 같은 **관리 밖 파일은 그대로** 둡니다. 레이아웃보다 먼저 하므로 `check` 가 떨어지면 `auto-tabs` · 레이아웃 모두 손대지 않습니다. `mods/auto-tabs` 가 링크이거나 안에 링크 · 하드링크가 있으면 거절합니다.
   - `config.js`(`export default { names: <bool>, hideFiles: <bool> };`)는 설치기가 만듭니다. `names` = 옛 `main.js` 에 `syncNames` 가 있으면 true(옛 `main.js` 가 이미 kit 판이면 옛 `config.js` 의 값) · `hideFiles` = 옛 Files 숨김 필터(또는 옛 kit `config.js`) 뒤 `--hide-files` / `--show-files` 를 적용한 값. 두 `header` 의 `hideFiles` 도 같은 값입니다.
   - kit 판이 이미 깔려 있으면(`main.js` 첫 줄 `// herdr-kit auto-tabs 2`) 옛 «Files+» 단추 · Files 필터 패처는 건너뜁니다. `--hide-files` / `--show-files` 는 `config.js` 와 두 스택 `header` 의 `hideFiles` 를 함께 고칩니다(`--panel-tabs` 없이도).
2. **레이아웃에 `panel-bottom` 을 더합니다**(같은 계산 · 한 번 저장 · 사본 하나). `work` 열 안 `status` 바로 앞(없으면 끝):
   ```json
   {"id":"panel-bottom","type":"stack","size":{"px":240},"hidden":true,"children":[],"header":{"content":{"mod":"panel-tabs","props":{"stack":"panel-bottom","hideFiles":false}},"height":32}}
   ```
   - 이미 우리 것(stack + panel-tabs header)이면 header 의 `stack` · `hideFiles` · `height` 만 맞춥니다. 담긴 도구 · `hidden` · `size` · `active` 는 그대로라, 옮겨 둔 도구와 열림 상태가 다시 돌려도 남습니다.
   - id `panel-bottom` 이 있는데 우리 것이 아니거나 `work` 열이 없으면 **아래 패널만** 건너뛰고 이유를 알립니다(M1 header 는 그대로).
   - 도구 id(`files` · `files-plus` · `changes` · `graph`)가 `panel-body` 와 `panel-bottom` 양쪽에 있으면 아무것도 바꾸기 전에 거절합니다.
   - `files-plus` 블록은 id 가 레이아웃 **어디에도** 없을 때만 `panel-body` 에 더합니다(`panel-bottom` 안에 있으면 그대로).
3. 설치 끝의 패널 열기는 `files-plus` 가 있는 쪽을 엽니다(오른쪽 = `panel-body` 선택 뒤 `panel` 보이기 · 아래 = 우리 `panel-bottom` 선택 뒤 `panel-bottom` 보이기). 우리 것이 아닌 아래 패널은 건드리지 않고, 오른쪽에도 `files-plus` 가 없으면 열기를 건너뜁니다.

`--remove-panel-tabs`: 우리 `panel-bottom` 의 도구를 순서대로 `panel-body` 끝으로 옮기고(같은 id 가 양쪽에 있으면 아무것도 바꾸기 전에 거절) `panel-bottom` 을 지운 뒤 `panel-body` header 도 뺍니다. 도구를 옮기지 않은 설치 → 지우기는 레이아웃이 설치 전 사본과 **바이트까지 같습니다**(들여쓰기 · 키 순서 · 끝 줄바꿈 유지). **kit 판 `auto-tabs` 는 그대로 두고**, 옛 판 사본 위치(`.auto-tabs-backup/` 의 가장 새 것, 없으면 «없음»)를 알립니다. 옛 판으로 되돌리려면 그 사본을 `mods/auto-tabs/` 에 손으로 복사합니다.

사본 위치: 레이아웃 `layouts/<이름>.json.bak-files-plus-<시각>-<PID>` · 옛 auto-tabs 폴더 `.auto-tabs-backup/<시각>-<PID>/` · panel-tabs `.panel-tabs-backup/<시각>-<PID>/` · files-plus `.files-plus-backup/<시각>-<PID>/`.

M2 의 한계:

- 옮기기가 2초 안에 반영되지 않으면 알림을 띄우고 2초 동안 레이아웃이 조용해질 때까지 다음 옮기기를 미룹니다. Herdr 가 layout.set 반영 여부를 알려 주지 않아(run() 은 null), 그보다 더 늦게 닿은 옮기기는 다음 옮기기가 되돌릴 수 있습니다(시험에서는 3–9 ms 에 반영).
- 「+」 · 탭 메뉴 팝업은 열 때 한 번만 포커스를 잡습니다(앱 기본 메뉴와 같음). 키가 먹지 않으면 팝업을 한 번 누릅니다.
- 팝업 키(↑↓ Enter Esc)는 전파를 막지 않습니다. 0.1.18 시험에서 뒤 터미널 · 탭 줄로 새지 않았습니다.
- 공간을 바꾸면 이전 공간의 대기 toggle/open/close 는 버리고, 옮기기는 그대로 둡니다.
- `auto-tabs` 를 손으로 옛 판으로 되돌리면 마지막 생존 신호 뒤 60초가 지나 header 가 M1 으로 돌아갑니다(**×** · **「+」** 꺼짐 · 닫힌 목록 무시).
- **닫기는 «부드러운 닫기»** 입니다. 닫은 도구는 레이아웃에서 빠지지 않고 그 스택에 숨은 채 남습니다. 「+」 로 다시 열면 **같은 자리 · 보던 상태 그대로** 돌아옵니다.

알려진 한계(M1):

- **칩을 눌러도 패널이 안 바뀔 때가 있습니다(원인 미확인).** 오래 켜 둔 앱에 설치 · 지우기 · 레이아웃 오류 · mod 다시 읽기를 여러 번 겪은 뒤 시험 VM 에서 두 번 보였습니다. 그 상태에서도 `herdr-app do layout.select '{"stack":"panel-body","child":"changes"}'` 로는 바뀌었고(탭바 단추는 못 봄), **앱을 다시 띄우면 풀립니다**. 다시 띄운 뒤 같은 순서를 되풀이해서는 재현되지 않았습니다.
- `--panel-tabs` 가 header 를 저장한 뒤 `auto-tabs` 단계 도중 신호(Ctrl-C · 창 닫힘 · `kill`)로 끊기면 header 의 `hideFiles` 가 탭바 Files 상태와 어긋난 채 남을 수 있습니다(`auto-tabs` 가 실패로 끝날 때는 되돌립니다). `--panel-tabs` 를 다시 돌리면 맞춰집니다.

## 상태 (2026-11-16)

- 폴더 · 여러 항목 올리기(`tree.js` · 고르기 창 폴더 선택)를 코드에 넣었습니다(2026-11-16). 미리보기 창 크기 조절 · 글자 크기도 같은 날 넣었습니다. node 시험: `files-plus.test.mjs` 56/56 · `state.test.mjs` 56/56 = 112/112 통과(Mac) · `herdr-app check` 통과(앱 0.1.16) — macOS 시험 VM(Tart · 앱 0.1.16 · 원격 hc 경로)에서 실제 앱 시험 통과: 폴더 끌어 놓기 · 같은 이름 «(1)» · 파일+폴더 함께 · 고르기 창 · 창 크기 끌기 · 글자 크기. 렌더된 마크다운 안의 코드 블록은 글자 크기를 따라 커지지 않는다(호스트 렌더러).
- 원격 머신(리눅스)에서 만들고 시험했습니다.
- Mac(앱 0.1.15 · hc 0.1.21) 에 깔았습니다: `files-plus` · `auto-tabs` 모두 «check passed», 앱 `status` 오류 없음. 레이아웃 `my-main` 오른쪽 패널에 붙였고 탭바 «Files+» 로 엽니다. hc 0.1.21 은 `exec -i/--stdin` · `--timeout` 을 압니다. `qlmanage` · `sips` · `osascript` · `shasum` · `open` 이 있습니다.
- 팝업 개편(미리보기 · 전송 창 · 격리 · `--hide-files`)을 코드에 넣었습니다. node 시험 외에 macOS 시험 VM(Tart · 앱 0.1.15)에서 실제 앱으로 여러 차례 눌러 봤습니다: 미리보기 창(끌기 · 겹침 · Esc) · 키(스페이스 · ← → · Home/End · ⌘) · 휠 · 더블클릭 · 확대/축소 · 전송 창 · 이어받기 조각(.part) 정리 · 죽은 패널 흔적 정리 · 그림 크기 검사.
- `install-mac.sh` 시험(격리 앱 폴더, `herdr-app do` 는 가짜로 막음): 처음 돌림 = 손으로 고친 결과와 같음 · 다시 돌림 = 바뀌지 않음 · `main` 은 거절 · `auto-tabs` 모양이 다르면 손대지 않음 · `--hide-files` → 다시 → `--show-files` 로 `auto-tabs` 가 원문과 바이트까지 같음 · files-plus 블록 id 가 다르면 아무것도 안 바꾸고 거절 · 모르는 옵션은 종료 코드 2.
- **알려진 한계**
  - 그림은 크기를 확실히 읽을 수 있을 때만 그립니다. 크기를 모르면 «크기를 알 수 없는 그림이다» 로 미리보기를 거절합니다(열기 · 내려받기는 됨). SVG 는 DOCTYPE 내부 부분집합(Illustrator 의 ENTITY 포함) · em/ex 단위 · viewBox 없이 크기가 없거나 % · 접두 붙은 크기 속성 · 루트 태그 16 KB 초과 · svgz 가, ICO · TIFF · PNM 은 머리글이 이상한 파일이 여기에 걸립니다(이 Mac 의 실제 그림 2461 개 중 1 개 — 템플릿 변수가 든 SVG).
  - 설치기: 사전 점검은 원문에 `panelButton("files-plus"` 가 있는지로 보고, 3단계는 코드 안 단추 + `enabled` 배열로 봅니다. 단추가 주석에만 있거나 `enabled` 에 files-plus 가 없고 `auto-tabs/main.js` 가 읽기 전용이면, 앞 단계를 바꾼 뒤 실패합니다(바뀐 것은 정확히 알립니다).
  - 설치기: 레이아웃을 쓴 직후 출력이 끊기면(파이프가 닫힘) 마지막 안내가 레이아웃 변경을 빠뜨릴 수 있습니다. 사본(`.bak`)은 남습니다.
  - 설치기: `--hide-files` 를 적용하지 못해도(`auto-tabs` 모양이 다름) 종료 코드는 0 이고 경고만 stderr 에 나옵니다.
  - 렌더된 마크다운(호스트 `TextView`)은 키보드 스크롤이 없습니다 — 휠만 됩니다.
  - `**굵게**` 가 굵어 보이지 않을 수 있습니다(호스트 렌더러·글꼴 문제로 보임 — 확인 필요).
  - 핀치 · 회전 입력 API 가 없어 트랙패드 핀치 확대는 지원하지 않습니다(⌘/Ctrl + 휠 · 키 · 단추만).
  - 열기 검사와 실제 `open` 사이에 파일이 바뀔 수 있습니다(TOCTOU).
  - ⌘ 를 먼저 떼고 방향키를 250 ms 넘게 누르고 있으면, 글 칸을 누른 뒤에도 파일이 넘어갈 수 있습니다.
  - 패널을 숨겨도(`layout.hide` — mod 는 계속 돕니다) 열려 있는 미리보기 창은 남습니다. 패널이 숨겨졌는지 알려 주는 API 가 없습니다. Esc · ✕ 로 닫습니다.
  - 미리보기의 변환(`qlmanage` · `sips`, 최대 120 초)은 취소할 수 없습니다 — `exec` 에 취소 수단이 없습니다. 파일을 넘기거나 창을 닫아도 끝까지 돌고 결과만 버립니다.
  - 크래시로 남은 다른 패널(owner)의 흔적은 주인 등록부로 치웁니다(위 «크래시 뒤 정리»). 단 패널이 초기화돼야 돈다. 그 owner 의 localStorage(삶 토큰)는 copy 별 저장소라 못 치웁니다.
- 2026-11-16 VM 시험(원격 = VM 이 ssh 로 자기 자신에 붙은 hc 머신): 25 MB 내려받기(해시 일치 · `이름 (1)` · 격리 표식) · 200 MB 전송 중 취소(`.part` 안 남음) · Finder 끌어 놓기(1개 · 20개 한꺼번에 — 하나씩 돌고 나머지 대기 · 대기 줄 하나만 취소) · 원격 · 로컬 pdf · docx · xlsx · heic 미리보기와 «Mac에서 열기» 모두 통과.
- 아직 안 해 본 것: 네트워크를 건너는 실제 원격(느린 회선 · 끊김). VM 시험은 같은 디스크의 루프백이라 속도 · 망 오류는 보지 못했습니다.

## 시험 (원격 머신에서)

```sh
node --test tests/files-plus.test.mjs tests/state.test.mjs tests/termfiles.test.mjs tests/panel-tabs.test.mjs
sh tests/install-panel-tabs.test.sh   # stub herdr-app 사용 · 실제 앱에 손대지 않음(M1 + M2 설치기 시험)
```

- `files-plus.test.mjs`: mod 가 쓰는 `kinds.js` · `transfer.js` 를 그대로 불러, 진짜 `hc exec` 로 올리기 · 내려받기를 돌립니다. 크기 경계, 이상한 이름, 덮어쓰지 않기, 동시 전송, 취소, 격리 속성을 봅니다.
- `state.test.mjs`: 공통 계약 `state.js`(요청함 · 요약 · 막대 · 속도 · 기록 묶음 · throttle · owner 복원)를 봅니다.
- `panel-tabs.test.mjs`: panel-tabs 의 순수 모델(`model.js`)을 합성 데이터로 봅니다.
- `termfiles.test.mjs`: `termfiles.js` 순수 함수(파일 이름 후보 · 줄 잇기 · 풀기/찾기 스크립트 · 더블클릭 `cellWidth` · `selSpan` · `dcStep` · `dcBind`(`DC_BIND_MAX` 글 상한 · 칸/행 불확실 · 묶음 위험 줄 · 같은 열 가드) · `dcReadCut` · `dcClipShape` · `dcOldText` · `dcPick` · `dcLonger` · `dcChoose`)를 합성 경로로 봅니다.
- 결과(2026-11-15, Mac): `state.test.mjs` 32/32 통과 · `files-plus.test.mjs` 12/13 통과(실패 1 = `/dev/shm` 을 쓰는 리눅스 전용 시험이라 macOS 에서는 `mkdtemp` 가 못 만든다).
- 화면 검사: `HAPP=<준비한 폴더> sh tests/linux-app-check.sh files-plus` 로 리눅스 앱의 `herdr-app check` 를 격리해 돌립니다. 준비물은 그 파일 머리에 적었습니다.

## 폴더

```
files-plus/          mod 본체 + RECIPE.md
  main.js              패널(트리 · 전송 큐 실행 · 끌어다 놓기) · 모드 가름
  preview.js           미리보기 팝업(키 · 아이콘 줄 · 목록/정보 칸)
  jobs-view.js         전송 창(막대 · 대기열 · 기록 · 아이콘 넷)
  state.js             패널 ↔ 팝업 공통 계약(요청함 · 요약 · 기록 · throttle), herdr 를 import 하지 않음
  kinds.js · transfer.js  종류 판별 · 조각 전송
  *.svg                아이콘
panel-tabs/          mod 본체(패널 탭 줄: main.js · model.js · mod.json)
auto-tabs/           kit 판 위쪽 바(M2: main.js · owner.js · panels.js · names.js · config.js · win-*.svg · mod.json)
docs/                popups-design.md(팝업 개편 설계)
tests/               node 시험(files-plus · state · fsops) · 격리 check 스크립트
install-mac.sh       Mac 에 깔고 화면(오른쪽 패널 · 탭바 «Files+» · 선택 --panel-tabs)에 띄운다
```

## 라이선스

files-plus 의 폴더 읽기 · 트리와 아이콘 넷은 herdr-app 기본 mod `files`(herdr-app `ce0fd1b`)를 바탕으로 했습니다. 그 라이선스(Apache-2.0) 원문은 `files-plus/LICENSE-herdr-app` 에 있습니다.
