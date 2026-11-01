#!/bin/bash
# Copies offline-checkout.html and its icons from this folder to ~/OfflineCheckout and creates the
# app menu and desktop launchers for it. Run it again from a new version's folder to update.
set -euo pipefail

fail() {
  printf '\nCould not create the shortcuts: %s\n' "$1" >&2
  exit 1
}

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
[ -f "$here/offline-checkout.html" ] ||
  fail "offline-checkout.html is not in $here. Keep this script in the folder it was extracted to and run it again."
for icon in offline-checkout.png offline-checkout-printer.png; do
  [ -f "$here/icons/$icon" ] ||
    fail "icons/$icon is not in $here. Keep this script in the folder it was extracted to and run it again."
done

# A visible folder, because Snap Chromium (Ubuntu's only Chromium) cannot read hidden ones like ~/.local.
install_dir="$HOME/OfflineCheckout"
installed="$install_dir/offline-checkout.html"
mkdir -p "$install_dir"
cp "$here/offline-checkout.html" "$install_dir/"
cp "$here/icons/offline-checkout.png" "$here/icons/offline-checkout-printer.png" "$install_dir/"
version=$(sed -n 's/.*<meta name="offline-checkout-version" content="\([^"]*\)".*/\1/p' "$installed" | head -n 1)

# Chromium first, then Chrome, then Edge; installed packages before Flatpaks.
browser=()
profile_name=
for candidate in chromium:Chromium chromium-browser:Chromium google-chrome-stable:Chrome \
  google-chrome:Chrome microsoft-edge-stable:Edge microsoft-edge:Edge; do
  if path=$(command -v "${candidate%%:*}"); then
    browser=("$path")
    profile_name=${candidate##*:}
    break
  fi
done
if [ ${#browser[@]} -eq 0 ] && command -v flatpak >/dev/null; then
  for candidate in org.chromium.Chromium:Chromium com.google.Chrome:Chrome com.microsoft.Edge:Edge; do
    if flatpak info "${candidate%%:*}" >/dev/null 2>&1; then
      browser=(flatpak run "--filesystem=$install_dir" "${candidate%%:*}")
      profile_name=${candidate##*:}
      break
    fi
  done
fi
[ ${#browser[@]} -gt 0 ] || fail "Chromium, Google Chrome or Microsoft Edge is not installed on this PC."

file_url() {
  local LC_ALL=C path=$1 out= char i
  for ((i = 0; i < ${#path}; i++)); do
    char=${path:i:1}
    case $char in
      [A-Za-z0-9/._~-]) out+=$char ;;
      *) out+=$(printf '%%%02X' "'$char") ;;
    esac
  done
  printf 'file://%s' "$out"
}

# Quotes one argument for a .desktop Exec line, then escapes it as a .desktop string value.
exec_arg() {
  local arg=$1
  arg=${arg//\\/\\\\}
  arg=${arg//\"/\\\"}
  arg=${arg//\`/\\\`}
  arg=${arg//\$/\\\$}
  arg=${arg//%/%%}
  arg="\"$arg\""
  printf '%s' "${arg//\\/\\\\}"
}

url=$(file_url "$installed")
profile_dir="$install_dir/profile-$profile_name"
common=("${browser[@]}" "--app=$url" "--user-data-dir=$profile_dir" --start-maximized --no-first-run
  --no-default-browser-check)

applications="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
desktop=$(xdg-user-dir DESKTOP 2>/dev/null || true)
[ -n "$desktop" ] || desktop="$HOME/Desktop"
mkdir -p "$applications"

write_launcher() {
  local file=$1 name=$2 icon=$3 comment=$4 exec= arg
  shift 4
  for arg in "$@"; do exec+="${exec:+ }$(exec_arg "$arg")"; done
  cat >"$applications/$file" <<DESKTOP
[Desktop Entry]
Type=Application
Version=1.0
Name=$name
Comment=$comment
Exec=$exec
Icon=$install_dir/$icon
Terminal=false
Categories=Office;
DESKTOP
  chmod +x "$applications/$file"
  if [ -d "$desktop" ]; then
    cp "$applications/$file" "$desktop/$file"
    chmod +x "$desktop/$file"
    # GNOME's desktop icons only start launchers marked as trusted.
    gio set "$desktop/$file" metadata::trusted true 2>/dev/null || true
  fi
}

write_launcher offline-checkout.desktop "Offline Checkout" offline-checkout.png \
  "Offline Checkout. Receipts print without a dialog." "${common[@]}" --kiosk-printing
write_launcher offline-checkout-printer-setup.desktop "Offline Checkout - printer setup" \
  offline-checkout-printer.png "Offline Checkout with the print dialog, to choose the receipt printer." \
  "${common[@]}"
update-desktop-database "$applications" 2>/dev/null || true

cat <<DONE

Installed Offline Checkout version ${version:-unknown}

Launchers created in the app menu$([ -d "$desktop" ] && printf ' and on the desktop'):
  Offline Checkout                   everyday use; receipts print without a dialog
  Offline Checkout - printer setup   use once to choose the receipt printer

App folder: $install_dir (keep it: the browser profile with the sessions is in it)
Browser:    ${browser[*]}

Choose the receipt printer once on this PC:
  1. Close every Offline Checkout window.
  2. Open "Offline Checkout - printer setup", start a session and print the
     scanner card to the Receipt printer. Pick the receipt printer and click Print.
  3. Close that window. From now on use "Offline Checkout".

To update, run this script from the new version's folder. Your sessions are kept.
DONE
