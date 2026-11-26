#!/usr/bin/env bash
# Builds a signed release APK at dist/finy.apk.
# Creates a private signing keystore in secrets/ on first run (gitignored).
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p secrets dist

if [ ! -f secrets/finy.keystore ]; then
  PASS="$(openssl rand -hex 16)"
  keytool -genkeypair -keystore secrets/finy.keystore -alias finy \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$PASS" -keypass "$PASS" -dname "CN=Finy" >/dev/null 2>&1
  printf 'storeFile=%s\nstorePassword=%s\nkeyAlias=finy\nkeyPassword=%s\n' \
    "$PWD/secrets/finy.keystore" "$PASS" "$PASS" > secrets/keystore.properties
  echo "Created signing keystore: secrets/finy.keystore"
fi

if [ ! -s .credentials ]; then
  echo "Warning: .credentials is empty - the Claude features will ask for a key in Settings." >&2
fi

# sherpa-onnx and the voice models (not in git): downloaded once, checked against their SHA-256.
bash scripts/fetch-ears.sh

npx expo prebuild --platform android --no-install
# The Galaxy S23 (and every recent phone) is arm64. Building one ABI keeps the
# build small and fast; set FINY_ARCHS to build more (comma separated).
ARCHS="${FINY_ARCHS:-arm64-v8a}"
(cd android && ./gradlew assembleRelease -PreactNativeArchitectures="$ARCHS" --console=plain -q)

cp android/app/build/outputs/apk/release/app-release.apk dist/finy.apk
echo
echo "APK: dist/finy.apk"
echo "Signing certificate SHA-1 (register this in Google Cloud for Gmail access):"
STOREPASS="$(grep '^storePassword=' secrets/keystore.properties | cut -d= -f2)"
keytool -list -v -keystore secrets/finy.keystore -alias finy -storepass "$STOREPASS" 2>/dev/null | grep 'SHA1:' | sed 's/^[[:space:]]*//'
echo "Install on a connected phone: adb install -r dist/finy.apk"
