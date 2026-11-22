// Config plugin: sign release builds with the private keystore described in
// secrets/keystore.properties (created by scripts/build-apk.sh) instead of the
// publicly known debug keystore that the React Native template ships with.
const { withAppBuildGradle } = require('expo/config-plugins');

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
