const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Config plugin: patch the fmt CocoaPod for Xcode 26 compatibility.
 *
 * Xcode 26 rejects `consteval` calls in fmt that were valid under c++20.
 * Forcing c++17 + FMT_HEADER_ONLY=1 on the fmt target resolves the errors.
 */
function withFmtXcode26Fix(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');

      const patch = `
    # Fix fmt library C++ consteval errors with Xcode 26
    installer.pods_project.targets.each do |target|
      if target.name == 'fmt'
        target.build_configurations.each do |config|
          config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
          config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= ['$(inherited)']
          config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] << 'FMT_HEADER_ONLY=1'
        end
      end
    end
`;

      const marker = '# This is necessary for Xcode 14';
      if (!contents.includes('FMT_HEADER_ONLY') && contents.includes(marker)) {
        contents = contents.replace(marker, patch + '    ' + marker);
        fs.writeFileSync(podfilePath, contents);
      }

      return cfg;
    },
  ]);
}

// Re-export app.json config with the plugin applied
const appJson = require('./app.json');
module.exports = withFmtXcode26Fix(appJson.expo);
