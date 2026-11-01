#!/bin/bash
# Copies offline-checkout.html from this folder to ~/Library/Application Support/OfflineCheckout and
# builds two launcher apps for it in ~/Applications. Run it again from a new version's folder to
# update. Written for the bash 3.2 that macOS ships.
set -euo pipefail

fail() {
  printf '\nCould not create the shortcuts: %s\n' "$1" >&2
  exit 1
}

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
for file in offline-checkout.html icons/offline-checkout.icns icons/offline-checkout-printer.icns; do
  [ -f "$here/$file" ] ||
    fail "$file is not in $here. Keep this script in the folder it was extracted to and run it again."
done

support="$HOME/Library/Application Support"
install_dir="$support/OfflineCheckout"
installed="$install_dir/offline-checkout.html"
mkdir -p "$install_dir"
# -X leaves the download's quarantine flag behind.
cp -X "$here/offline-checkout.html" "$installed"
version=$(sed -n 's/.*<meta name="offline-checkout-version" content="\([^"]*\)".*/\1/p' "$installed" | head -n 1)

# Chrome first, Edge if Chrome is not installed.
browser=
profile_name=
for candidate in "Google Chrome:OfflineCheckoutChrome" "Microsoft Edge:OfflineCheckoutEdge"; do
  for dir in /Applications "$HOME/Applications"; do
    if [ -d "$dir/${candidate%%:*}.app" ]; then
      browser="$dir/${candidate%%:*}.app"
      profile_name=${candidate##*:}
      break 2
    fi
  done
done
[ -n "$browser" ] || fail "Neither Google Chrome nor Microsoft Edge is installed on this Mac."

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

# Quotes a value for a single-quoted sh string.
sh_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

xml_escape() {
  printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'
}

url=$(file_url "$installed")
profile_dir="$support/$profile_name"
apps="$HOME/Applications"
mkdir -p "$apps"

make_app() {
  local name=$1 id=$2 icon=$3 extra=$4
  local app="$apps/$name.app"
  rm -rf "$app"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
  cp -X "$here/icons/$icon.icns" "$app/Contents/Resources/$icon.icns"
  cat >"$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIconFile</key><string>$icon</string>
  <key>CFBundleIdentifier</key><string>$id</string>
  <key>CFBundleName</key><string>$(xml_escape "$name")</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$(xml_escape "${version:-0}")</string>
</dict>
</plist>
PLIST
  # open -n starts the browser with these flags even when it already runs with another profile.
  cat >"$app/Contents/MacOS/launch" <<LAUNCH
#!/bin/sh
exec open -na $(sh_quote "$browser") --args $(sh_quote "--app=$url") $(sh_quote "--user-data-dir=$profile_dir") --start-maximized --no-first-run --no-default-browser-check$extra
LAUNCH
  chmod +x "$app/Contents/MacOS/launch"
  xattr -cr "$app" 2>/dev/null || true
  # Makes Finder and the Dock pick up a changed icon straight away.
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app" 2>/dev/null || true
  touch "$app"
}

make_app "Offline Checkout" io.github.benddailey.offline-checkout offline-checkout " --kiosk-printing"
make_app "Offline Checkout - printer setup" io.github.benddailey.offline-checkout.printer-setup \
  offline-checkout-printer ""

cat <<DONE

Installed Offline Checkout version ${version:-unknown}

Apps created in your Applications folder ($apps):
  Offline Checkout                   everyday use; receipts print without a dialog
  Offline Checkout - printer setup   use once to choose the receipt printer
Drag both to the Dock to keep them handy.

App file:   $installed
Browser:    $browser

Choose the receipt printer once on this Mac:
  1. Quit every Offline Checkout window.
  2. Open "Offline Checkout - printer setup", start a session and print the
     scanner card to the Receipt printer. Pick the receipt printer and click Print.
  3. Close that window. From now on use "Offline Checkout".

To update, run this script from the new version's folder. Your sessions are kept.
DONE
open "$apps" 2>/dev/null || true
