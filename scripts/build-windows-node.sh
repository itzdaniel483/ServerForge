#!/usr/bin/env bash
# Build ServerForge-Node-Setup.zip for Windows (claude, 2026-10-30). Runs here on Linux: every backend
# dependency is plain JavaScript (no native addons), so production node_modules work on Windows as-is.
#
#   scripts/build-windows-node.sh            -> release/ServerForge-Node-Setup.zip (+ .sha256)
#   scripts/build-windows-node.sh --outbox   -> also copies it to the server console Outbox
#
# Bundles Node.js win-x64 (pinned, SHA-256 checked against nodejs.org's SHASUMS256.txt), the backend
# with production modules, the built frontend, codex's service scripts and the Setup/Uninstall files.
set -euo pipefail

NODE_VERSION="v22.23.3"            # same major/minor as the panel host; bump deliberately
# WinSW (MIT) runs node.exe as a Windows service. GitHub publishes no checksum for this release, so the
# hash was pinned on 2026-10-30 from two separate downloads; a changed file fails the build.
WINSW_URL="https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe"
WINSW_SHA256="b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/release"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
PKG="$STAGE/ServerForge-Node-Setup"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/serverforge-build"
mkdir -p "$PKG"/{app/backend,app/frontend,runtime,service} "$OUT" "$CACHE"

say() { printf '\033[36m%s\033[0m\n' "$*"; }

# 1. Node.js for Windows, verified
ZIP="node-$NODE_VERSION-win-x64.zip"
if [ ! -f "$CACHE/$ZIP" ]; then
    say "Downloading $ZIP"
    curl -fsSL -o "$CACHE/$ZIP.part" "https://nodejs.org/dist/$NODE_VERSION/$ZIP"
    mv "$CACHE/$ZIP.part" "$CACHE/$ZIP"
fi
EXPECTED="$(curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" | awk -v f="$ZIP" '$2 == f { print $1 }')"
ACTUAL="$(sha256sum "$CACHE/$ZIP" | awk '{print $1}')"
[ -n "$EXPECTED" ] && [ "$EXPECTED" = "$ACTUAL" ] || { echo "Node.js checksum mismatch ($ACTUAL vs $EXPECTED); deleting the download" >&2; rm -f "$CACHE/$ZIP"; exit 1; }
say "Node.js $NODE_VERSION verified ($ACTUAL)"
python3 - "$CACHE/$ZIP" "$PKG/runtime" <<'PY'
import sys, zipfile, os
src, dest = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(src) as z:
    name = next(n for n in z.namelist() if n.endswith('/node.exe'))
    with z.open(name) as f, open(os.path.join(dest, 'node.exe'), 'wb') as out: out.write(f.read())
    lic = next((n for n in z.namelist() if n.endswith('/LICENSE')), None)
    if lic:
        with z.open(lic) as f, open(os.path.join(dest, 'NODE-LICENSE.txt'), 'wb') as out: out.write(f.read())
PY

# 2. Backend with production modules only (no tests, data, secrets)
say "Backend"
tar -C "$ROOT/backend" --exclude=node_modules --exclude=data --exclude=cache --exclude=servers --exclude=test \
    --exclude='.env*' --exclude='nodemon.json' --exclude='*.log' -cf - . | tar -C "$PKG/app/backend" -xf -
( cd "$PKG/app/backend" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error )
if find "$PKG/app/backend/node_modules" -name '*.node' | grep -q .; then echo "A native addon appeared in node_modules; it would not run on Windows" >&2; exit 1; fi

# 3. Frontend (fresh build)
say "Frontend"
( cd "$ROOT/frontend" && npx vite build --outDir "$PKG/app/frontend/dist" --emptyOutDir --logLevel error )

# 4. Windows service scripts (codex) and Setup (claude)
say "Installer files"
if [ -z "$(ls -A "$ROOT/installers/windows-node/service" 2>/dev/null)" ]; then
    if [ "${ALLOW_NO_SERVICE:-}" = 1 ]; then echo "WARNING: no service scripts yet (draft build)" >&2
    else echo "installers/windows-node/service/ is empty (codex's service scripts). Set ALLOW_NO_SERVICE=1 for a draft build." >&2; exit 1; fi
else
    cp -r "$ROOT/installers/windows-node/service/." "$PKG/service/"
fi
[ -f "$CACHE/WinSW.NET461.exe" ] || curl -fsSL -o "$CACHE/WinSW.NET461.exe" "$WINSW_URL"
echo "$WINSW_SHA256  $CACHE/WinSW.NET461.exe" | sha256sum -c --quiet - || { echo "WinSW checksum mismatch; deleting the download" >&2; rm -f "$CACHE/WinSW.NET461.exe"; exit 1; }
cp "$CACHE/WinSW.NET461.exe" "$PKG/service/WinSW.exe"
cp "$ROOT/installers/windows-node/"{Setup.cmd,Uninstall.cmd,setup.ps1,README.txt} "$PKG/"

# Optional release note shipped with the app (also changes the version): RELEASE_NOTE="..." scripts/build-windows-node.sh
if [ -n "${RELEASE_NOTE:-}" ]; then printf '%s\n%s\n' "$(date -u +%FT%TZ)" "$RELEASE_NOTE" > "$PKG/app/RELEASE.txt"; fi

# 4a. Version stamp + update signing key (one-click updates, Daniel 3591/3595).
VERSION="$(cd "$PKG/app" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-12)"
echo "$VERSION" > "$PKG/app/VERSION"
PUBKEY="${UPDATE_PUBKEY:-/var/lib/serverforge/data/update-signing-key.pub.pem}"
if sudo -n test -f "$PUBKEY" 2>/dev/null; then sudo -n cat "$PUBKEY" > "$PKG/service/update-key.pem"
elif [ -f "$PUBKEY" ]; then cp "$PUBKEY" "$PKG/service/update-key.pem"
else echo "No panel update key at $PUBKEY (start the panel once to create it); this build can't receive one-click updates" >&2; fi
say "Version $VERSION"

# 4b. Every PowerShell script must parse (claude, 2026-10-30: a stray apostrophe once shipped a broken setup.ps1).
PWSH="${PWSH:-$CACHE/pwsh/pwsh}"
if [ -x "$PWSH" ]; then
    say "Checking PowerShell syntax"
    for f in "$PKG"/setup.ps1 "$PKG"/service/*.ps1; do
        "$PWSH" -NoProfile -Command "\$e=\$null;\$t=\$null;[System.Management.Automation.Language.Parser]::ParseFile('$f',[ref]\$t,[ref]\$e)|Out-Null;if(\$e){\$e|%{'$(basename "$f") line '+\$_.Extent.StartLineNumber+': '+\$_.Message};exit 1}" || { echo "PowerShell syntax error in $(basename "$f"); not building" >&2; exit 1; }
    done
    LC_ALL=C grep -lP '[^\x00-\x7F]' "$PKG"/setup.ps1 "$PKG"/service/*.ps1 && { echo "Non-ASCII text in a .ps1 (Windows PowerShell 5.1 misreads it); not building" >&2; exit 1; } || true
else
    echo "WARNING: no PowerShell at $PWSH; skipping the syntax check" >&2
fi

# 5. Zip
say "Zipping"
python3 - "$STAGE" "$OUT/ServerForge-Node-Setup.zip" <<'PY'
import sys, os, zipfile
stage, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out + '.part', 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for base, _, files in os.walk(stage):
        for f in sorted(files):
            p = os.path.join(base, f)
            z.write(p, os.path.relpath(p, stage))
os.replace(out + '.part', out)
PY
( cd "$OUT" && sha256sum ServerForge-Node-Setup.zip > ServerForge-Node-Setup.zip.sha256 )
# App-only package the panel pushes to nodes ("Update" on the Nodes page).
python3 - "$PKG" "$OUT/node-update.zip" <<'PY'
import sys, os, zipfile
pkg, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out + '.part', 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for base, _, files in os.walk(os.path.join(pkg, 'app')):
        for f in sorted(files):
            p = os.path.join(base, f)
            z.write(p, os.path.relpath(p, pkg))
os.replace(out + '.part', out)
PY
echo "$VERSION" > "$OUT/node-update.version"
chmod 644 "$OUT/node-update.zip" "$OUT/node-update.version"
say "Built $OUT/ServerForge-Node-Setup.zip ($(du -h "$OUT/ServerForge-Node-Setup.zip" | cut -f1)), sha256 $(cut -c1-16 "$OUT/ServerForge-Node-Setup.zip.sha256")..."

if [ "${1:-}" = "--outbox" ]; then
    cp "$OUT/ServerForge-Node-Setup.zip" "$OUT/ServerForge-Node-Setup.zip.sha256" /srv/projects/shared/outbox/
    say "Copied to the server console Outbox"
fi
