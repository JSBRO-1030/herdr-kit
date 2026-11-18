#!/usr/bin/env python3
"""Multi-line Claude Code status line.

Line 1: session title - repo:branch - cwd - model - context gauge+% - tags
Line 2: Claude side - elapsed - cost - tokens up/down - lines +/- - 5h/7d limit %
Line 3: Codex side - model+effort - 5h/7d limit % + reset - live jobs - gate
Line 4: agy side - each model group's 5h/7d limit % + reset (agy's own /usage)
Lines 3 and 4 appear only when codex / agy is installed on this machine.

Color convention (threshold channel kept separate from identity channel):
  green -> yellow -> red : safe -> caution -> danger   (gauge, elapsed, limits)
  orange                 : separate warning channel    (fast mode)
  gray / dim             : non-alerting info           (cost, tokens, diff)
  blue / cyan / magenta  : identity                    (model, session, repo, cwd)
                           plum for the Codex/GPT side
                           never threshold-colored
"""
import base64
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import tomllib
from datetime import datetime
from functools import lru_cache
from pathlib import Path

HOME = Path.home()

# --- identity channel -------------------------------------------------------
C_SESSION = 213   # magenta
C_REPO = 80       # cyan
C_CWD = 75        # blue
C_MODEL = 111     # blue-violet
C_GPT = 176       # plum, the Codex/GPT side of the identity channel
# --- threshold channel ------------------------------------------------------
C_OK = 114        # green
C_WARN = 179      # yellow
C_DANGER = 203    # red
# --- other channels ---------------------------------------------------------
C_FAST = 214      # orange, warning channel of its own
C_DIM = 245       # gray, non-alerting
C_SEP = 240       # separator

SEP = "│"    # │
BRANCH_ICON = "⎇"  # ⎇


def use_color():
    if os.environ.get("NO_COLOR"):
        return False
    return os.environ.get("CLAUDE_STATUSLINE_ANSI", "1").lower() not in ("0", "false", "no")


COLOR = use_color()


def c(text, code, bold=False):
    if not COLOR or text == "":
        return text
    return f"\033[{1 if bold else 0};38;5;{code}m{text}\033[0m"


def dim(text):
    return c(text, C_DIM)


def threshold(pct, warn=60, danger=85):
    """Map a 0-100 value onto the safe/caution/danger channel."""
    if pct >= danger:
        return C_DANGER
    if pct >= warn:
        return C_WARN
    return C_OK


def get(d, *path, default=None):
    cur = d
    for key in path:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(key)
    return cur if cur is not None else default


def as_int(value, default=0):
    try:
        return int(value)
    except Exception:
        return default


def as_float(value, default=0.0):
    try:
        return float(value)
    except Exception:
        return default


# --- formatters -------------------------------------------------------------

def fmt_tokens(n):
    n = as_int(n)
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}K"
    return str(n)


def fmt_duration(ms):
    total = as_int(ms) // 1000
    if total < 60:
        return f"{total}s"
    minutes, seconds = divmod(total, 60)
    if minutes < 60:
        return f"{minutes}m" if seconds < 30 else f"{minutes}m"
    hours, minutes = divmod(minutes, 60)
    return f"{hours}h{minutes:02d}m"


def fmt_window(minutes):
    """Rate-limit window length the way codex labels it: 300 -> '5h', 10080 -> '7d'."""
    m = as_int(minutes)
    if m <= 0:
        return "?"
    if m % 1440 == 0:
        return f"{m // 1440}d"
    if m % 60 == 0:
        return f"{m // 60}h"
    return f"{m}m"


def fmt_reset(resets_at):
    """Countdown to a reset: an epoch stamp, or seconds-from-now when it is small."""
    value = as_float(resets_at, -1.0)
    if value < 0:
        return ""
    left = max(0.0, value - time.time() if value > 1e9 else value)
    # rounded to the minute, so a stamp 2h49m out never reads as 2h48m
    days, rest = divmod(int(round(left / 60)), 1440)
    hours, minutes = divmod(rest, 60)
    if days:
        return f"{days}d{hours}h{minutes:02d}m"
    if hours:
        return f"{hours}h{minutes:02d}m"
    return f"{minutes}m"


def fmt_cwd(path):
    """Shorten to ~/... and keep at most the last two segments."""
    if not path:
        return ""
    try:
        p = Path(path)
    except Exception:
        return str(path)
    try:
        rel = p.relative_to(HOME)
        parts = rel.parts
        if not parts:
            return "~"
        if len(parts) <= 2:
            return "~/" + "/".join(parts)
        return "~/…/" + "/".join(parts[-2:])
    except Exception:
        parts = p.parts
        if len(parts) <= 3:
            return str(p)
        return "/…/" + "/".join(parts[-2:])


def short_model(name):
    """'Opus 5 (1M context)' -> 'Opus 5 (1M)'."""
    if not name:
        return ""
    return name.replace(" context)", ")").strip()


def gauge(pct, width=10):
    pct = max(0, min(100, as_int(pct)))
    filled = int(round(pct / 100 * width))
    filled = min(width, max(0, filled))
    return "█" * filled + "░" * (width - filled)


@lru_cache(maxsize=4)
def git_repo(cwd):
    """Return (toplevel, 'repo:branch') for cwd, or ('', '') outside a work tree."""
    if not cwd or not os.path.isdir(cwd):
        return "", ""
    try:
        out = subprocess.run(
            ["git", "-C", cwd, "rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, timeout=1.0,
        )
    except Exception:
        return "", ""
    if out.returncode != 0:
        return "", ""
    lines = [ln.strip() for ln in out.stdout.splitlines() if ln.strip()]
    if len(lines) < 2:
        return "", ""
    top = lines[0]
    branch = lines[1]
    if branch == "HEAD":
        branch = "detached"
    return top, f"{Path(top).name}:{branch}"


@lru_cache(maxsize=4)
def git_toplevel(cwd):
    """Toplevel only, mirroring the codex plugin's ensureGitRepository().

    git_repo() also resolves the branch and gives up when HEAD is unborn, which
    would point the codex state lookup at a subdirectory the plugin never uses.
    """
    if not cwd or not os.path.isdir(cwd):
        return ""
    try:
        out = subprocess.run(
            ["git", "-C", cwd, "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=1.0,
        )
    except Exception:
        return ""
    return out.stdout.strip() if out.returncode == 0 else ""


# --- codex / gpt ------------------------------------------------------------

def codex_home():
    return Path(os.environ.get("CODEX_HOME") or HOME / ".codex")


def codex_settings(home):
    """(model, reasoning effort) from config.toml, active profile winning."""
    try:
        cfg = tomllib.loads((home / "config.toml").read_text(encoding="utf-8"))
    except Exception:
        return None, None

    def pick(table, key):
        value = table.get(key) if isinstance(table, dict) else None
        return value.strip() if isinstance(value, str) and value.strip() else None

    layers = [cfg]
    profile = pick(cfg, "profile")
    if profile:
        profiles = cfg.get("profiles")
        if isinstance(profiles, dict) and isinstance(profiles.get(profile), dict):
            layers.insert(0, profiles[profile])
    model = next((pick(l, "model") for l in layers if pick(l, "model")), None)
    effort = next((pick(l, "model_reasoning_effort") for l in layers
                   if pick(l, "model_reasoning_effort")), None)
    return model, effort


def codex_auth(home):
    """Short auth marker ('pro', 'key', ...) or None when not authenticated."""
    try:
        data = json.loads((home / "auth.json").read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    tokens = data.get("tokens")
    if isinstance(tokens, dict) and tokens.get("id_token"):
        claims = {}
        try:
            payload = str(tokens["id_token"]).split(".")[1]
            payload += "=" * (-len(payload) % 4)
            claims = json.loads(base64.urlsafe_b64decode(payload))
        except Exception:
            claims = {}
        plan = get(claims, "https://api.openai.com/auth", "chatgpt_plan_type")
        return str(plan).lower() if plan else "chatgpt"
    if data.get("OPENAI_API_KEY"):
        return "key"
    return None


def codex_state_db(home):
    """Newest ~/.codex/state_<n>.sqlite; codex bumps <n> on schema changes."""
    best, best_version = None, -1
    for path in home.glob("state_*.sqlite"):
        m = re.fullmatch(r"state_(\d+)\.sqlite", path.name)
        version = int(m.group(1)) if m else -1
        if version > best_version:
            best, best_version = path, version
    return best


def codex_threads(home, cwd=""):
    """Recent (model, effort, rollout path) thread rows, read-only, newest first.

    config.toml usually omits `model` and `codex doctor` only says `<default>`,
    so the thread rows are the only local record of what codex resolved it to;
    `reasoning_effort` is null there whenever codex ran on the model default.
    Threads of this workspace sort ahead of the rest, so a session left open in
    another project cannot report that project's model as this one's.
    """
    db = codex_state_db(home)
    if not db:
        return []
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=0.1)
        try:
            rows = con.execute(
                "select model, reasoning_effort, rollout_path, cwd from threads "
                "order by updated_at_ms desc limit 24").fetchall()
        finally:
            con.close()
    except Exception:
        return []

    def text(value):
        return value.strip() if isinstance(value, str) and value.strip() else None

    root = ""
    if cwd:
        try:
            root = os.path.realpath(git_toplevel(cwd) or cwd)
        except Exception:
            root = ""

    here, elsewhere = [], []
    for row in rows:
        bucket = elsewhere
        thread_cwd = text(row[3])
        if root and thread_cwd:
            try:
                if os.path.commonpath([root, os.path.realpath(thread_cwd)]) == root:
                    bucket = here
            except Exception:
                pass
        bucket.append((text(row[0]), text(row[1]), text(row[2])))
    return (here + elsewhere)[:8]


def codex_limits(rollout_paths):
    """Newest rate-limit snapshot codex wrote, as [(label, used %, resets_at)].

    The windows are account-wide but only ride along on `token_count` events in
    a rollout, so a thread that has not taken a turn yet - or whose rollout has
    been pruned - carries none, and the next most recent one answers instead.
    """
    for path in rollout_paths:
        windows = rollout_limits(path)
        if windows:
            return windows
    return []


def rollout_limits(rollout_path):
    """Rate-limit windows from one rollout JSONL: RateLimitSnapshot{primary,
    secondary, ...} of RateLimitWindow{used_percent, window_minutes, resets_at}.

    Only the tail is read; the file grows by a turn's worth of items each turn.
    """
    if not rollout_path:
        return []
    try:
        with open(rollout_path, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            fh.seek(max(0, size - 262144))
            tail = fh.read().decode("utf-8", "replace").splitlines()
    except Exception:
        return []

    snapshot = None
    for line in reversed(tail):
        if '"rate_limits"' not in line:
            continue
        try:
            found = json.loads(line)
        except Exception:
            continue
        snapshot = get(found, "payload", "rate_limits") or found.get("rate_limits")
        if isinstance(snapshot, dict):
            break
        snapshot = None
    if not snapshot:
        return []

    windows = []
    for key in ("primary", "secondary"):
        window = snapshot.get(key)
        if not isinstance(window, dict) or window.get("used_percent") is None:
            continue
        windows.append((
            fmt_window(window.get("window_minutes")),
            as_int(round(as_float(window.get("used_percent")))),
            window.get("resets_at"),
        ))
    return windows


def codex_state_file(cwd):
    """Mirror the codex plugin's resolveStateDir(): <root>/<slug>-<sha256[:16]>."""
    root = git_toplevel(cwd) or cwd
    if not root:
        return None
    try:
        canonical = os.path.realpath(root)
    except Exception:
        canonical = root
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", Path(root).name or "workspace").strip("-")
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
    tail = Path(f"{slug or 'workspace'}-{digest}") / "state.json"

    roots = []
    plugin_data = os.environ.get("CLAUDE_PLUGIN_DATA")
    if plugin_data:
        roots.append(Path(plugin_data) / "state")
    try:
        roots += sorted(d / "state" for d in (HOME / ".claude" / "plugins" / "data").glob("*codex*"))
    except Exception:
        pass
    roots.append(Path(tempfile.gettempdir()) / "codex-companion")

    for base in roots:
        candidate = base / tail
        if candidate.is_file():
            return candidate
    return None


def pid_alive(pid):
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except Exception:
        return True
    return True


def codex_jobs(cwd):
    """(live job count, phase of a lone live job, review gate enabled)."""
    state_file = codex_state_file(cwd)
    if not state_file:
        return 0, None, False
    try:
        state = json.loads(state_file.read_text(encoding="utf-8"))
    except Exception:
        return 0, None, False

    live = []
    for job in state.get("jobs") or []:
        if not isinstance(job, dict) or job.get("status") not in ("running", "queued"):
            continue
        # pid is cleared on completion; a dead pid means the record went stale.
        if job.get("pid") is not None and not pid_alive(job.get("pid")):
            continue
        live.append(job)

    phase = str(live[0].get("phase") or "") if len(live) == 1 else ""
    return len(live), phase or None, bool(get(state, "config", "stopReviewGate", default=False))


# --- agy / antigravity -------------------------------------------------------
# agy answers `agy -p "/usage" --output-format json` itself: no model turn, no
# tokens (agy 1.5.3, ~4s). The status line redraws every second in every
# session, so one detached run refreshes a shared cache at most every AGY_TTL
# and every line only reads that file.

AGY_CACHE = HOME / ".cache" / "claude-statusline" / "agy-usage.json"
AGY_TTL = 300          # seconds between background /usage reads
AGY_LOCK_STALE = 120   # a refresh lock older than this was left by a dead run


def agy_bin():
    found = shutil.which("agy")
    if found:
        return found
    local = HOME / ".local" / "bin" / "agy"
    return str(local) if local.is_file() else ""


def agy_read_cache():
    try:
        cache = json.loads(AGY_CACHE.read_text(encoding="utf-8"))
        return cache if isinstance(cache, dict) else {}
    except Exception:
        return {}


def agy_refresh():
    """Detached child: read agy's /usage once, keep the last good groups on failure."""
    lock = AGY_CACHE.with_suffix(".lock")
    try:
        out = agy_read_cache()
        try:
            proc = subprocess.run(
                [agy_bin(), "-p", "/usage", "--output-format", "json"],
                stdin=subprocess.DEVNULL, capture_output=True, text=True,
                timeout=60, cwd=str(AGY_CACHE.parent),
            )
            data = json.loads(proc.stdout)
            groups = get(data, "command", "data", "groups")
            if data.get("status") != "SUCCESS" or not isinstance(groups, list):
                raise ValueError(str(data.get("status") or "no groups"))
            out["groups"] = [
                {"name": str(g.get("name") or ""),
                 "buckets": [{"window": b.get("window"),
                              "remaining": b.get("remaining_fraction"),
                              "reset": b.get("reset_time")}
                             for b in g.get("buckets") or [] if isinstance(b, dict)]}
                for g in groups if isinstance(g, dict)
            ]
            out["at"] = time.time()
            out.pop("error", None)
            out.pop("error_at", None)
        except Exception as exc:
            out["error"] = type(exc).__name__
            out["error_at"] = time.time()
        tmp = AGY_CACHE.with_suffix(".tmp")
        tmp.write_text(json.dumps(out), encoding="utf-8")
        os.replace(tmp, AGY_CACHE)
    finally:
        lock.unlink(missing_ok=True)


def agy_spawn_refresh():
    """Start one detached agy_refresh unless another status line already has."""
    lock = AGY_CACHE.with_suffix(".lock")
    try:
        AGY_CACHE.parent.mkdir(parents=True, exist_ok=True)
        try:
            if time.time() - lock.stat().st_mtime > AGY_LOCK_STALE:
                lock.unlink()
        except FileNotFoundError:
            pass
        os.close(os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600))
    except Exception:
        return
    try:
        subprocess.Popen(
            [sys.executable, str(Path(__file__).resolve()), "--agy-refresh"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=True, close_fds=True,
        )
    except Exception:
        lock.unlink(missing_ok=True)


def agy_usage():
    """Last /usage reading; kicks off a background refresh when it is older than AGY_TTL."""
    cache = agy_read_cache()
    tried = max(as_float(cache.get("at")), as_float(cache.get("error_at")))
    if time.time() - tried > AGY_TTL:
        agy_spawn_refresh()
    return cache


def iso_epoch(value):
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def agy_group_label(name):
    """'Gemini Models' -> 'Gemini', 'Claude and GPT models' -> 'Claude·GPT'."""
    label = re.sub(r"\s+models?$", "", str(name or ""), flags=re.I).strip()
    return label.replace(" and ", "·") or "?"


# --- line builders ----------------------------------------------------------

def session_cwd(s):
    return get(s, "workspace", "current_dir", default="") or get(s, "cwd", default="") or ""



def build_line1(s):
    parts = []

    title = str(get(s, "session_name", default="") or "").strip()
    if title:
        parts.append(c(title, C_SESSION, bold=True))

    cwd = session_cwd(s)

    repo = git_repo(cwd)[1]
    if repo:
        parts.append(c(f"{BRANCH_ICON} {repo}", C_REPO))

    cwd_text = fmt_cwd(cwd)
    if cwd_text:
        parts.append(c(cwd_text, C_CWD))

    model = short_model(get(s, "model", "display_name", default=""))
    if model:
        parts.append(c(model, C_MODEL))

    pct = get(s, "context_window", "used_percentage")
    if pct is not None:
        code = threshold(as_int(pct))
        parts.append(f"{c(gauge(pct), code)} {c(f'{as_int(pct)}%', code)}")

    tags = []
    if get(s, "fast_mode", default=False):
        tags.append(c("⚡fast", C_FAST, bold=True))
    effort = get(s, "effort", "level", default="")
    if effort:
        tags.append(c(f"⚙ {effort}", C_DIM))
    if get(s, "thinking", "enabled", default=False):
        tags.append(c("◈think", C_DIM))
    vim = get(s, "vim_mode", default="") or get(s, "editor_mode", default="")
    if vim:
        tags.append(c(f"vim:{vim}", C_DIM))
    if tags:
        parts.append(" ".join(tags))

    return f" {c(SEP, C_SEP)} ".join(p for p in parts if p)


def build_line2(s):
    parts = []

    duration = get(s, "cost", "total_duration_ms")
    if duration is not None:
        secs = as_int(duration) / 1000
        # 0-2h mapped onto the threshold channel
        parts.append(c(fmt_duration(duration), threshold(min(100, secs / 7200 * 100))))

    cost = get(s, "cost", "total_cost_usd")
    if cost is not None:
        parts.append(dim(f"${as_float(cost):.3f}"))

    tin = get(s, "context_window", "total_input_tokens")
    tout = get(s, "context_window", "total_output_tokens")
    if tin is not None or tout is not None:
        parts.append(dim(f"{fmt_tokens(tin)}↑ {fmt_tokens(tout)}↓"))

    added = get(s, "cost", "total_lines_added")
    removed = get(s, "cost", "total_lines_removed")
    if added is not None or removed is not None:
        parts.append(dim(f"+{as_int(added)} -{as_int(removed)}"))

    limits = []
    for key, label in (("five_hour", "5h"), ("seven_day", "7d")):
        pct = get(s, "rate_limits", key, "used_percentage")
        if pct is None:
            continue
        limit = c(f"{label}:{as_int(pct)}%", threshold(as_int(pct)))
        reset = fmt_reset(get(s, "rate_limits", key, "resets_at"))
        if reset:
            limit += " " + dim(reset)
        limits.append(limit)
    if limits:
        parts.append(" ".join(limits))

    return f" {c(SEP, C_SEP)} ".join(p for p in parts if p)


def build_line3(s):
    """Codex line: model+effort, its own 5h/7d limits + resets, live jobs, gate."""
    try:
        home = codex_home()
        if not home.is_dir() and not shutil.which("codex"):
            return ""

        parts = [dim("Codex")]

        threads = codex_threads(home, session_cwd(s))
        model, effort = codex_settings(home)
        if threads:
            model = model or threads[0][0]
            effort = effort or threads[0][1]
        if model:
            ident = c(model, C_GPT)
            if effort:
                ident += " " + dim(f"\u2699 {effort}")
            parts.append(ident)

        if not codex_auth(home):
            parts.append(c("no-auth", C_WARN))

        limits = []
        for label, used, resets_at in codex_limits([t[2] for t in threads]):
            limit = c(f"{label}:{used}%", threshold(used))
            reset = fmt_reset(resets_at)
            if reset:
                limit += " " + dim(reset)
            limits.append(limit)
        parts.append(" ".join(limits) if limits else dim("5h:- 7d:-"))

        live, phase, gate = codex_jobs(session_cwd(s))
        state = []
        if live:
            state.append(c(f"\u27f3{phase if live == 1 and phase else live}", C_GPT))
        if gate:
            state.append(dim("\u26e8gate"))
        if state:
            parts.append(" ".join(state))

        return f" {c(SEP, C_SEP)} ".join(parts)
    except Exception:
        return ""


def build_line4(s):
    """agy line: each model group's 5h/7d used % + reset, from the shared /usage cache.

    agy's own "Claude and GPT models" group is left out: it read as
    Claude Max usage, which line 2 already shows."""
    try:
        if not agy_bin():
            return ""
        cache = agy_usage()
        now = time.time()
        parts = [dim("Agy")]
        for group in cache.get("groups") or []:
            if re.search(r"claude|gpt", str(group.get("name") or ""), re.I):
                continue
            buckets ={b.get("window"): b for b in group.get("buckets") or [] if isinstance(b, dict)}
            limits = []
            for window, label in (("5h", "5h"), ("weekly", "7d")):
                bucket = buckets.get(window)
                if not bucket or bucket.get("remaining") is None:
                    continue
                reset = iso_epoch(bucket.get("reset"))
                renewed = 0 < reset <= now  # its reset has passed: empty again
                used = 0 if renewed else as_int(round((1 - as_float(bucket.get("remaining"))) * 100))
                limit = c(f"{label}:{used}%", threshold(used))
                # an untouched window (all left) renews its whole span from now: no countdown
                if reset > now and as_float(bucket.get("remaining")) < 1:
                    limit += " " + dim(fmt_reset(reset))
                limits.append(limit)
            if limits:
                parts.append(dim(agy_group_label(group.get("name"))) + " " + " ".join(limits))
        if len(parts) == 1:
            parts.append(dim("5h:- 7d:-"))
        at = as_float(cache.get("at"))
        if as_float(cache.get("error_at")) > at:
            parts.append(c("err", C_WARN))
        elif at and now - at > 3 * AGY_TTL:
            parts.append(dim(f"⏱{fmt_reset(now - at)}"))
        return f" {c(SEP, C_SEP)} ".join(parts)
    except Exception:
        return ""


def main():
    if sys.argv[1:] == ["--agy-refresh"]:
        agy_refresh()
        return
    raw = sys.stdin.read()
    try:
        session = json.loads(raw)
        if not isinstance(session, dict):
            session = {}
    except Exception:
        session = {}

    lines = [build_line1(session), build_line2(session), build_line3(session), build_line4(session)]
    print("\n".join(ln for ln in lines if ln))


if __name__ == "__main__":
    main()
