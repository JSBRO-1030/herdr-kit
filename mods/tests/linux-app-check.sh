#!/bin/sh
# 리눅스 herdr-app 의 `check` 를 이 상자에서 격리해 돌린다(시스템 설치 0).
#   HAPP=<준비한 폴더> sh linux-app-check.sh <mod 폴더>
# HAPP 준비(2026-11-13 앱 0.1.15 로 함):
#   pkg/   latest.json 의 리눅스 tarball(sha256 맞춤)을 푼 것 → pkg/herdr-app/herdr-app
#   libs/  `apt-get download libxkbcommon-x11-0 libxcb-xkb1` 을 `dpkg-deb -x <deb> libs/root` 로 푼 것
#   home/  빈 폴더(HOME · 앱 홈 · XDG 가 전부 여기로 간다)
# 네트워크를 끊고(unshare -rn) PATH 에서 hc 를 빼고, Xvfb + lavapipe(소프트웨어 Vulkan)로 한 번 그린다.
# check 는 한 번 그릴 뿐이다 — 갈래(이미지 · 전송 중 등)는 상태를 박은 사본으로 따로 돌린다.
S=${HAPP:?HAPP 에 준비한 폴더를 준다}; H=$S/home
exec env -i HOME="$H" HERDR_APP_HOME="$H/.config/herdr-app" XDG_CONFIG_HOME="$H/.config" XDG_STATE_HOME="$H/.state" \
  XDG_DATA_HOME="$H/.data" XDG_CACHE_HOME="$H/.cache" XDG_RUNTIME_DIR="$H/run" PATH=/usr/bin:/bin DO_NOT_TRACK=1 HERDR_TELEMETRY=0 \
  LD_LIBRARY_PATH="$S/libs/root/usr/lib/x86_64-linux-gnu" VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json \
  timeout 120 unshare -rn sh -c 'ip link set lo up 2>/dev/null; xvfb-run -a -s "-screen 0 1280x800x24" "$1/pkg/herdr-app/herdr-app" check "$2"' sh "$S" "$1"
