#!/usr/bin/env bash
# update-clis.sh 시험 — 가짜 CLI(판 파일을 읽고 update 때 판을 바꾸는 셸 스크립트)로 갈래마다 한 번씩.
#   bash skills/herdr-team/test_update_clis.sh      → 끝 줄 «pass N/N»
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; U="$HERE/update-clis.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/ro" "$T/home/.grok/bin" "$T/v"
fake() {  # fake <자리> <종류> <판 파일> <update 동작: bump|none|fail|hang|elsewhere>
  cat >"$1/$2" <<EOF
#!/bin/bash
case "\${1:-}" in
  --version) cat "$3" ;;
  update|upgrade) case "$4" in
      bump) echo "\$(cat "$3")-new" >"$3" ;;
      none) echo "already latest" ;;
      fail) echo "boom" >&2; exit 3 ;;
      hang) sleep 30 ;;
      elsewhere) printf '#!/bin/bash\necho $2 9.9\n' >"$T/home/.grok/bin/grok"; chmod +x "$T/home/.grok/bin/grok" ;;
    esac ;;
esac
EOF
  chmod +x "$1/$2"
}
echo "claude 1.0" >"$T/v/claude"; fake "$T/bin" claude "$T/v/claude" bump
echo "codex 1.0" >"$T/v/codex";   fake "$T/bin" codex "$T/v/codex" none
echo "agy 1.0" >"$T/v/agy";       fake "$T/bin" agy "$T/v/agy" fail
echo "grok 1.0" >"$T/v/grok";     fake "$T/ro" grok "$T/v/grok" elsewhere; chmod 555 "$T/ro"
mkdir -p "$T/skip"; echo "opencode 1.0" >"$T/v/opencode"; fake "$T/skip" opencode "$T/v/opencode" bump
run() { env -i HOME="$T/home" PATH="$T/bin:$T/ro:$T/skip:/usr/bin:/bin" HERDR_TEAM_DIR="$T/cache" HERDR_UPDATE_CONF="$T/none.conf" "$@"; }
pass=0; n=0
check() { n=$((n+1)); if grep -qE "$2" <<<"$1"; then pass=$((pass+1)); else echo "FAIL $3: 바란 꼴 /$2/ · 받은 것:"; echo "$1" | sed 's/^/  /'; fi; }

out="$(run HERDR_UPDATE_SKIP_PREFIXES="$T/skip" bash "$U")"
check "$out" '^updated claude claude 1\.0 → claude 1\.0-new$' "updated"
check "$out" '^same codex codex 1\.0$' "same"
check "$out" "^fail agy rc=3 $T/cache/update/agy.log\$" "fail"
check "$out" "^stale grok grok 1\.0 · 새 판 grok 9\.9 $T/home/.grok/bin/grok — .*쓸 수 없다" "stale(쓸 수 없는 자리 · sudo 꺼짐)"
check "$out" "^skip opencode 건너뛸 자리" "skip_prefixes"
check "$(cat "$T/v/opencode")" '^opencode 1\.0$' "건너뛴 것은 손대지 않음"

out="$(run bash "$U" claude)"
check "$out" '^skip claude 최근에 확인함' "간격 안이면 다시 안 함"
out="$(run bash "$U" --force claude)"
check "$out" '^updated claude claude 1\.0-new → claude 1\.0-new-new$' "--force 는 간격 무시"

fake "$T/bin" codex "$T/v/codex" hang
out="$(run HERDR_UPDATE_TIMEOUT=2 bash "$U" --force codex)"
check "$out" '^fail codex rc=124 ' "시한 초과"

out="$(run bash "$U" nosuch grok)"
check "$out" '^skip nosuch 모르는 종류' "모르는 종류"
out="$(env -i HOME="$T/home" PATH="/usr/bin:/bin" HERDR_TEAM_DIR="$T/cache" bash "$U" grok)"
check "$out" '^skip grok 없음$' "없는 CLI"

printf 'enabled=0\n' >"$T/off.conf"
out="$(run HERDR_UPDATE_CONF="$T/off.conf" bash "$U" claude)"
check "$out" '^skip claude 꺼 둠' "설정 파일로 끄기"

run bash "$U" --force agy >/dev/null; rc=$?
n=$((n+1)); [ "$rc" = 0 ] && pass=$((pass+1)) || echo "FAIL 실패해도 종료 코드 0: rc=$rc"
chmod 755 "$T/ro"
echo "pass $pass/$n"; [ "$pass" = "$n" ]
