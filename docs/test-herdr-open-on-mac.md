# herdr-open × files-plus 시험 — Mac 에서

이 문서는 Mac 의 Claude 가 읽고 사용자에게 한 단계씩 안내하도록 썼다.
Mac Claude 에게: «`~/herdr-option/docs/test-herdr-open-on-mac.md` 대로 herdr-open 시험을 안내해 줘».

## 무엇을 확인하나

herdr-open(원격 상자 쪽 스킬)이 html-viewer 패널을 **files-plus «페이지로»와 같은 꼴**(`props {space, machine, file}`)로 열고, 어느 쪽이 연 뷰어든 «같은 파일 · 같은 머신»이면 하나로 알아보는지(`already`) 본다.

| # | 합격 |
|---|---|
| T0 | Mac 에서 `test_open.py` 7개 통과(앱·원격 없이) |
| T1 | 원격 상자에서 `open.py open` → Mac 앱의 그 탭 오른쪽에 뷰어가 뜨고 문서가 그려진다 |
| T2 | `open.py ls` 의 넷째 칸(머신)이 원격 상자 이름이다 |
| T3 | files-plus «페이지로»로 먼저 연 파일을 `open.py open` 하면 `already` 가 나오고 뷰어가 하나 더 생기지 않는다 |
| T4 | `open.py close` 는 자기가 연 뷰어만 닫고, files-plus 가 연 뷰어는 남긴다 |

## 준비

- Mac: Herdr 앱(0.1.15 이상) · **html-viewer** mod · **files-plus**(`sh ~/herdr-option/mods/install-mac.sh`). `herdr-app check ~/.config/herdr-app/mods/files-plus` 가 «check passed».
- Mac 에 저장소: `gh repo clone JSBRO-1030/herdr-kit ~/herdr-option`(공개 저장소 — 로그인 없이 받는다. `gh` 가 없으면 `git clone https://github.com/JSBRO-1030/herdr-kit.git ~/herdr-option`).
- 원격 상자(리눅스 · herdr-core): `bash ~/herdr-option/install.sh` 를 돌렸고, Herdr 앱에서 그 상자의 터미널 하나를 열어 둔다(그 터미널 = 아래 «상자 터미널»). 상자에 `node` 가 있어야 html-viewer 가 그린다.
- 시험 파일: 상자 터미널에서 `printf '# herdr-open 시험\n\n이 줄이 보이면 T1 통과\n' > ~/herdr-open-test.md`

## T0 — Mac 에서 시험 파일(앱 없이)

```sh
cd ~/herdr-option && python3 -I skills/herdr-open/test_open.py
```

`Ran 7 tests … OK`. 하나라도 FAIL 이면 여기서 멈추고 출력을 그대로 보인다.

## T1 · T2 — 상자에서 열기

상자 터미널에서(Herdr 앱 안의 그 터미널 — `$HC_TERMINAL_ID` 가 있어야 한다):

```sh
O=~/.claude/skills/herdr-open/open.py
$O open ~/herdr-open-test.md
# ok side block=p… tab=tb… version=… — 렌더 시작 확인(…)
$O ls
# p…  mine  sp…/tb…  <상자 이름>  /home/<사용자>/herdr-open-test.md
```

- Mac 화면: 상자 터미널 탭이 좌우로 나뉘고 오른쪽에 «herdr-open 시험» 이 그려지면 T1 통과.
- `ls` 넷째 칸이 상자 이름(앱 사이드바에 보이는 그 머신 이름)이면 T2 통과. `Mac` 이 나오면 실패다.
- `20초 안에 렌더 시작 없음` 이 나와도 화면이 그 탭을 보고 있지 않았을 수 있다 — 그 탭을 눌러 본다.
- 앱이 «unknown machine» 을 내면 머신 이름이 틀렸다 → 상자에서 `HERDR_APP_MACHINE=<앱이 부르는 이름>` 을 주고 다시.

정리: `$O close` → `closed p… version=…` · 오른쪽 패널이 사라진다.

## T3 — files-plus 로 먼저 열고, 상자에서 다시 열기

1. Mac 앱: 상자 터미널을 누른 채 탭바 «Files+» 로 files-plus 패널을 연다 → 상자 홈 폴더가 보인다.
2. `herdr-open-test.md` 를 눌러 미리보기 창을 띄우고 **P**(페이지로)를 누른다 → 오른쪽에 html-viewer 패널이 뜬다.
3. 상자 터미널에서:
   ```sh
   $O ls      # 그 블록이 보인다 — 둘째 칸 '-'(이 도구가 연 것 아님) · 넷째 칸 <상자 이름>
   $O open ~/herdr-open-test.md
   # already /home/<사용자>/herdr-open-test.md — 이 공간에 이미 열려 있음(…)
   ```
4. Mac 화면에 뷰어가 **하나만** 있으면 T3 통과. 둘이 되면 실패 — `$O ls` 출력과 함께 알린다.

## T4 — close 는 자기 것만

1. 다른 파일을 상자에서 연다: `printf '# 둘째\n' > ~/herdr-open-test2.md && $O open ~/herdr-open-test2.md`
2. `$O close` → `closed p…`(test2 뷰어만) · files-plus 가 연 test 뷰어는 화면에 남으면 T4 통과.
3. 남은 뷰어는 앱에서 패널을 닫는다.

## 되돌리기

- 앱에서 상자 공간이 통째로 사라지면(문서 꼴 오류): 상자에서 `ls -t ~/.cache/herdr-open/backup | head -1` 로 가장 최근 백업을 찾아 `$O restore ~/.cache/herdr-open/backup/<그 파일>`.
- 시험 파일 지우기: `rm ~/herdr-open-test.md ~/herdr-open-test2.md`

## 결과 적기

| # | 결과(통과·실패) | 메모(화면 · 출력 첫 줄) |
|---|---|---|
| T0 | | |
| T1 | | |
| T2 | | |
| T3 | | |
| T4 | | |
