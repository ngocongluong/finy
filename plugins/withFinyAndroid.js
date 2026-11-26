// Config plugin with two jobs:
// 1. Sign release builds with the private keystore described in
//    secrets/keystore.properties (created by scripts/build-apk.sh) instead of
//    the publicly known debug keystore that the React Native template ships with.
// 2. Set FLAG_SECURE in MainActivity.onCreate, before any JavaScript runs.
//    React Native dialogs (the lock screen, every form) copy the flag from the
//    activity when they are created, so it has to be there from the first frame;
//    setting it from JS is too late for the lock screen shown at startup.
const { withAppBuildGradle, withMainActivity } = require('expo/config-plugins');

const SECURE_LINE =
  '    window.setFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE, android.view.WindowManager.LayoutParams.FLAG_SECURE) // finy-secure';

function withSecureWindow(config) {
  return withMainActivity(config, (cfg) => {
    // Idempotent: drop a line added by an earlier prebuild, then add it back unless this is a screenshot test build.
    let src = cfg.modResults.contents
      .split('\n')
      .filter((line) => !line.includes('// finy-secure'))
      .join('\n');
    if (process.env.FINY_ALLOW_SCREENSHOTS !== '1') {
      const anchor = /^(\s*)super\.onCreate\(.*\)\s*$/m;
      if (!anchor.test(src)) throw new Error('withFinyAndroid: cannot find super.onCreate in MainActivity');
      src = src.replace(anchor, (line) => `${line}\n${SECURE_LINE}`);
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

const LOAD_PROPS = `
def finyKeystoreProps = new Properties()
def finyKeystoreFile = rootProject.file("../secrets/keystore.properties")
if (finyKeystoreFile.exists()) {
    finyKeystoreFile.withInputStream { finyKeystoreProps.load(it) }
}
`;

const RELEASE_SIGNING = `
        release {
            if (finyKeystoreFile.exists()) {
                storeFile file(finyKeystoreProps['storeFile'])
                storePassword finyKeystoreProps['storePassword']
                keyAlias finyKeystoreProps['keyAlias']
                keyPassword finyKeystoreProps['keyPassword']
            }
        }`;

module.exports = function withFinyAndroid(config) {
  config = withSecureWindow(config);
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes('finyKeystoreProps')) return cfg;

    src = src.replace(/\nandroid \{/, `${LOAD_PROPS}\nandroid {`);
    src = src.replace(/signingConfigs \{/, `signingConfigs {${RELEASE_SIGNING}`);

    // Only the release build type switches keystore; debug keeps the debug key.
    const marker = 'signingConfig signingConfigs.debug';
    const first = src.indexOf(marker);
    const second = src.indexOf(marker, first + marker.length);
    if (first === -1 || second === -1) {
      throw new Error('withFinyAndroid: unexpected app/build.gradle layout, cannot set release signing');
    }
    src =
      src.slice(0, second) +
      'signingConfig finyKeystoreFile.exists() ? signingConfigs.release : signingConfigs.debug' +
      src.slice(second + marker.length);

    cfg.modResults.contents = src;
    return cfg;
  });
};
