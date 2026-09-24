#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: bash apps/desktop/scripts/smoke-linux-x64-deb.sh <OpenPets-version-linux-amd64.deb>" >&2
  exit 2
fi

package_path=$(realpath "$1")
if [[ ! -f "$package_path" ]]; then
  echo "DEB package does not exist: $package_path" >&2
  exit 2
fi

for command_name in dpkg-deb sudo xvfb-run dbus-run-session openbox xprop xdotool xwininfo pgrep setsid; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required Linux smoke-test command is missing: $command_name" >&2
    exit 2
  fi
done

sudo dpkg -i "$package_path"

smoke_root=$(mktemp -d "${TMPDIR:-/tmp}/openpets-deb-smoke.XXXXXX")
run_id="openpets-linux-smoke-$$-$RANDOM"
runner_pid=

cleanup() {
  local status=$?
  if [[ -n "$runner_pid" ]] && kill -0 "$runner_pid" 2>/dev/null; then
    kill -- "-$runner_pid" 2>/dev/null || true
    kill "$runner_pid" 2>/dev/null || true
    wait "$runner_pid" 2>/dev/null || true
  fi
  rm -rf -- "$smoke_root"
  exit "$status"
}
trap cleanup EXIT INT TERM

export OPENPETS_LINUX_SMOKE_ID="$run_id"
export OPENPETS_LINUX_SMOKE_HOME="$smoke_root/home"
mkdir -p "$OPENPETS_LINUX_SMOKE_HOME" \
  "$OPENPETS_LINUX_SMOKE_HOME/.config" \
  "$OPENPETS_LINUX_SMOKE_HOME/.cache" \
  "$OPENPETS_LINUX_SMOKE_HOME/.local/share" \
  "$OPENPETS_LINUX_SMOKE_HOME/.local/state"

setsid dbus-run-session -- xvfb-run -a -s "-screen 0 1280x900x24 -nolisten tcp" bash -c '
  set -Eeuo pipefail
  export HOME="$OPENPETS_LINUX_SMOKE_HOME"
  export XDG_CONFIG_HOME="$HOME/.config"
  export XDG_CACHE_HOME="$HOME/.cache"
  export XDG_DATA_HOME="$HOME/.local/share"
  export XDG_STATE_HOME="$HOME/.local/state"

  binary=$(command -v openpets || true)
  if [[ -z "$binary" || ! -x "$binary" ]]; then
    echo "Installed OpenPets executable was not found on PATH." >&2
    exit 1
  fi
  binary=$(realpath "$binary")

  openbox --sm-disable >"$HOME/openbox.log" 2>&1 &
  openbox_pid=$!
  app_pid=
  cleanup_smoke() {
    local status=$?
    if [[ -n "$app_pid" ]]; then
      kill -- "-$app_pid" 2>/dev/null || true
      kill "$app_pid" 2>/dev/null || true
    fi
    # Electron may replace its initial process with a detached relaunch. Its
    # unique run marker is inherited only by this smoke-test process tree.
    for environ_path in /proc/[0-9]*/environ; do
      [[ -r "$environ_path" ]] || continue
      if grep -azFq "OPENPETS_LINUX_SMOKE_ID=$OPENPETS_LINUX_SMOKE_ID" "$environ_path" 2>/dev/null; then
        pid=${environ_path#/proc/}
        pid=${pid%/environ}
        [[ "$pid" == "$$" || "$pid" == "$PPID" ]] || kill "$pid" 2>/dev/null || true
      fi
    done
    kill "$openbox_pid" 2>/dev/null || true
    wait "$openbox_pid" 2>/dev/null || true
    exit "$status"
  }
  trap cleanup_smoke EXIT INT TERM

  for _ in $(seq 1 50); do
    if xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q "window id"; then break; fi
    sleep 0.1
  done

  # No Electron flags are supplied: this exercises the packaged launcher with
  # the normal sandbox policy.
  setsid "$binary" >"$HOME/openpets.log" 2>&1 &
  app_pid=$!

  main_pid=
  renderer_pid=
  pet_xid=
  for _ in $(seq 1 180); do
    if ! kill -0 "$app_pid" 2>/dev/null && ! pgrep -f -- "^$binary( |$)" >/dev/null; then
      echo "OpenPets exited before its renderer and pet window became ready." >&2
      cat "$HOME/openpets.log" >&2 || true
      exit 1
    fi

    main_pid=
    for pid in $(pgrep -f -- "^$binary( |$)" || true); do
      command_line=$(tr "\0" " " <"/proc/$pid/cmdline" 2>/dev/null || true)
      if [[ "$command_line" == "$binary" || "$command_line" == "$binary "* ]] && [[ "$command_line" != *"--type="* ]]; then
        main_pid=$pid
        break
      fi
    done
    renderer_pid=$(pgrep -f -- "^$binary .*--type=renderer" | head -n 1 || true)
    client_ids=$(xprop -root _NET_CLIENT_LIST 2>/dev/null | sed "s/.*# //" | tr "," " " || true)
    for xid in $client_ids; do
      state=$(xprop -id "$xid" _NET_WM_STATE 2>/dev/null || true)
      if grep -q "_NET_WM_STATE_SKIP_TASKBAR" <<<"$state" && grep -q "_NET_WM_STATE_SKIP_PAGER" <<<"$state"; then
        pet_xid=$xid
        break
      fi
    done
    if [[ -n "$main_pid" && -n "$renderer_pid" && -n "$pet_xid" ]]; then break; fi
    sleep 1
  done

  if [[ -z "$main_pid" ]] || ! kill -0 "$main_pid" 2>/dev/null; then
    echo "No live OpenPets main/replacement process appeared." >&2
    cat "$HOME/openpets.log" >&2 || true
    exit 1
  fi
  if [[ -z "$renderer_pid" ]]; then
    echo "No Electron renderer process appeared." >&2
    cat "$HOME/openpets.log" >&2 || true
    exit 1
  fi
  if [[ -z "$pet_xid" ]]; then
    echo "No pet window with both skip-taskbar and skip-pager states appeared." >&2
    cat "$HOME/openpets.log" >&2 || true
    xprop -root _NET_CLIENT_LIST >&2 || true
    exit 1
  fi
  if ! kill -0 "$renderer_pid" 2>/dev/null || ! kill -0 "$main_pid" 2>/dev/null; then
    echo "OpenPets main or renderer process exited during smoke validation." >&2
    exit 1
  fi
  if ! xwininfo -id "$pet_xid" 2>/dev/null | grep -q "Map State: IsViewable"; then
    echo "OpenPets pet window was not mapped and visible before the close test." >&2
    exit 1
  fi
  echo "OpenPets renderer PID $renderer_pid and pet window XID $pet_xid are live."

  xdotool windowclose "$pet_xid"
  for _ in $(seq 1 20); do
    window_info=$(xwininfo -id "$pet_xid" 2>/dev/null || true)
    if [[ -z "$window_info" ]] || grep -q "Map State: IsUnmapped" <<<"$window_info"; then break; fi
    sleep 0.25
  done
  window_info=$(xwininfo -id "$pet_xid" 2>/dev/null || true)
  if [[ -n "$window_info" ]] && ! grep -q "Map State: IsUnmapped" <<<"$window_info"; then
    echo "Pet window remained visible after the window-manager close request." >&2
    exit 1
  fi

  sleep 2
  if ! kill -0 "$renderer_pid" 2>/dev/null || ! kill -0 "$main_pid" 2>/dev/null; then
    echo "OpenPets exited when the pet window was closed; expected hide-with-app-alive behavior." >&2
    exit 1
  fi
  echo "Window-manager close hid the pet window while OpenPets remained alive."
' &
runner_pid=$!
wait "$runner_pid"
runner_pid=
echo "Linux x64 DEB desktop smoke test passed."
