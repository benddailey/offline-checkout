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
[ -r "$here" ] && ls "$here" >/dev/null 2>&1 ||
  fail "Terminal may not read $here. Allow it in System Settings > Privacy & Security > Files and Folders, or move the folder to the Desktop, and run this script again."
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
      # bash 3.2 reads bytes above 127 as negative.
      *) out+=$(printf '%%%02X' $(($(printf '%d' "'$char") & 255))) ;;
    esac
  done
  printf 'file://%s' "$out"
}

# Quotes a value for a single-quoted sh string.
sh_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

url=$(file_url "$installed")
profile_dir="$support/$profile_name"
apps="$HOME/Applications"
mkdir -p "$apps"

plist() {
  /usr/libexec/PlistBuddy -c "Set :$1 $2" "$3" 2>/dev/null ||
    /usr/libexec/PlistBuddy -c "Add :$1 string $2" "$3"
}

# An AppleScript applet has a native executable, so Apple Silicon Macs never ask for Rosetta.
make_app() {
  local name=$1 id=$2 icon=$3 kiosk=$4
  local app="$apps/$name.app"
  local resources="$app/Contents/Resources"
  local flags="--start-maximized --no-first-run --no-default-browser-check"
  [ "$kiosk" = 1 ] && flags="$flags --kiosk-printing"
  rm -rf "$app"
  osacompile -o "$app" \
    -e 'do shell script "/bin/sh " & quoted form of (POSIX path of (path to me) & "Contents/Resources/launch.sh")'
  cat >"$resources/launch.sh" <<LAUNCH
#!/bin/sh
# Chrome on macOS keeps running after its last window closes, and a running instance ignores new
# flags. So first stop an instance of this profile that the other launcher started.
profile=$(sh_quote "$profile_dir")
pids=\$(ps -axww -o pid= -o args= | while read -r pid args; do
  case "\$args" in *--type=*) continue ;; esac
  case "\$args" in *"--user-data-dir=\$profile "*) ;; *) continue ;; esac
  case "\$args" in *--kiosk-printing*) running=1 ;; *) running=0 ;; esac
  [ "\$running" = $kiosk ] || echo "\$pid"
done)
if [ -n "\$pids" ]; then
  kill \$pids 2>/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    kill -0 \$pids 2>/dev/null || break
    sleep 0.5
  done
fi
exec open -na $(sh_quote "$browser") --args $(sh_quote "--app=$url") \\
  $(sh_quote "--user-data-dir=$profile_dir") $flags
LAUNCH
  rm -f "$resources/Assets.car"
  cp -X "$here/icons/$icon.icns" "$resources/applet.icns"
  /usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$app/Contents/Info.plist" 2>/dev/null || true
  plist CFBundleIdentifier "$id" "$app/Contents/Info.plist"
  plist CFBundleShortVersionString "${version:-0}" "$app/Contents/Info.plist"
  # Editing the bundle breaks the applet's signature, and Apple Silicon only runs signed code.
  codesign --force --sign - "$app" 2>/dev/null || true
  xattr -cr "$app" 2>/dev/null || true
  # Makes Finder and the Dock pick up the icon straight away.
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app" 2>/dev/null || true
  touch "$app"
}

make_app "Offline Checkout" io.github.benddailey.offline-checkout offline-checkout 1
make_app "Offline Checkout - printer setup" io.github.benddailey.offline-checkout.printer-setup \
  offline-checkout-printer 0

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
