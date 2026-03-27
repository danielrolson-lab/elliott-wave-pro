const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Config plugin: patch CocoaPods for Xcode 26 local simulator build compatibility.
 *
 * 1. All pods: set IPHONEOS_DEPLOYMENT_TARGET = 14.0
 * 2. fmt: CLANG_CXX_LANGUAGE_STANDARD = c++17, CLANG_CXX_LIBRARY = libc++
 *    Fixes "Call to consteval function is not a constant expression" in Xcode 26.
 */
function withXcode26Fixes(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');

      const postInstallPatch = `
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '14.0'
      end
      if target.name == 'fmt'
        target.build_configurations.each do |config|
          config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
          config.build_settings['CLANG_CXX_LIBRARY'] = 'libc++'
        end
      end
    end

`;

      const marker = '# This is necessary for Xcode 14';
      if (!contents.includes("'fmt'") && contents.includes(marker)) {
        contents = contents.replace(marker, postInstallPatch + '    ' + marker);
        fs.writeFileSync(podfilePath, contents);
      }

      return cfg;
    },
  ]);
}

// Re-export app.json config with the plugin applied
const appJson = require('./app.json');
module.exports = withXcode26Fixes(appJson.expo);
