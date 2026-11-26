#!/usr/bin/env bash
# Downloads what Finy's "ears" need into modules/finy-voice (not in git: ~60 MB):
#   - sherpa-onnx (Apache-2.0) v2.0.1: the Kotlin classes and the arm64 native libraries
#   - the keyword-spotting model (zipformer zh-en, phones) that hears "Finy"
#   - the speaker model (3D-Speaker CAM++, zh+en) that tells the owner's voice apart
#   - Silero VAD, which tells speech from silence and noise
# Every download is checked against the SHA-256 published with the release.
set -euo pipefail
cd "$(dirname "$0")/.."

MOD=modules/finy-voice/android
ASSETS=$MOD/src/main/assets/finy-ears
JNI=$MOD/src/main/jniLibs/arm64-v8a
LIBS=$MOD/libs
if [ -f "$LIBS/sherpa-onnx-2.0.1-classes.jar" ] && [ -f "$JNI/libsherpa-onnx-jni.so" ] && [ -f "$ASSETS/speaker.onnx" ] && [ -f "$ASSETS/kws/encoder.int8.onnx" ] && [ -f "$ASSETS/silero_vad.onnx" ]; then
  exit 0
fi

REL=https://github.com/k2-fsa/sherpa-onnx/releases/download
AAR_SHA=a8d09d1d32f3eb8520482c6d3d43fae674681c5b050385967c70a3c2c9bf0ee7
KWS_SHA=68447f4fbc67e70eee3a93961f36e81e98f47aef73ce7e7ca00885c6cd3616a6
SPK_SHA=53cab20ba8f2eb2f6e2d89ecc18e88ef3222169b61b4419cbc13666744a4574b
VAD_SHA=9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6

DL=$(mktemp -d "${TMPDIR:-/tmp}/finy-ears.XXXXXX")
trap 'rm -rf "$DL"' EXIT

fetch() { # url sha file
  curl -fsSL -o "$DL/$3" "$1"
  echo "$2  $DL/$3" | shasum -a 256 -c - >/dev/null || { echo "Checksum mismatch: $1" >&2; exit 1; }
}

echo "Downloading sherpa-onnx and the voice models…"
fetch "$REL/v2.0.1/sherpa-onnx-2.0.1.aar" $AAR_SHA aar.zip
fetch "$REL/kws-models/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20.tar.bz2" $KWS_SHA kws.tar.bz2
fetch "$REL/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx" $SPK_SHA speaker.onnx
fetch "$REL/asr-models/silero_vad.onnx" $VAD_SHA silero_vad.onnx

mkdir -p "$DL/aar" "$DL/kws" "$ASSETS/kws" "$JNI" "$LIBS"
unzip -q -o "$DL/aar.zip" classes.jar 'jni/arm64-v8a/libsherpa-onnx-jni.so' 'jni/arm64-v8a/libonnxruntime.so' -d "$DL/aar"
cp "$DL/aar/classes.jar" "$LIBS/sherpa-onnx-2.0.1-classes.jar"
cp "$DL/aar/jni/arm64-v8a/libsherpa-onnx-jni.so" "$DL/aar/jni/arm64-v8a/libonnxruntime.so" "$JNI/"

tar xjf "$DL/kws.tar.bz2" -C "$DL/kws"
K="$DL/kws/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20"
cp "$K/encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx" "$ASSETS/kws/encoder.int8.onnx"
cp "$K/decoder-epoch-13-avg-2-chunk-16-left-64.onnx" "$ASSETS/kws/decoder.onnx"
cp "$K/joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx" "$ASSETS/kws/joiner.int8.onnx"
cp "$K/tokens.txt" "$ASSETS/kws/tokens.txt"
cp "$DL/speaker.onnx" "$ASSETS/speaker.onnx"
cp "$DL/silero_vad.onnx" "$ASSETS/silero_vad.onnx"
echo "Voice models ready."
