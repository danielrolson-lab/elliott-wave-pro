const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Config plugin: patch CocoaPods for Xcode 26 local simulator build compatibility.
 *
 * 1. fmt: force c++17 to resolve consteval errors
 * 2. PurchasesHybridCommon: pin Swift 5.0, suppress warnings-as-errors for
 *    SubscriptionPeriod ambiguous type errors
 * 3. All pods: set minimum deployment target to 14.0 to suppress
 *    IPHONEOS_DEPLOYMENT_TARGET warnings
 */
function withXcode26Fixes(config) {
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
        end
      end
    end

    # Fix PurchasesHybridCommon SubscriptionPeriod ambiguous type error (Xcode 26)
    installer.pods_project.targets.each do |target|
      if target.name == 'PurchasesHybridCommon'
        target.build_configurations.each do |config|
          config.build_settings['SWIFT_VERSION'] = '5.0'
          config.build_settings['SWIFT_TREAT_WARNINGS_AS_ERRORS'] = 'NO'
        end
      end
    end

    # Set minimum deployment target to 14.0 for all pods to suppress warnings
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        if config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < 14.0
          config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '14.0'
        end
      end
    end
`;

      const marker = '# This is necessary for Xcode 14';
      if (!contents.includes('PurchasesHybridCommon') && contents.includes(marker)) {
        contents = contents.replace(marker, patch + '    ' + marker);
        fs.writeFileSync(podfilePath, contents);
      }

      return cfg;
    },
  ]);
}

// Re-export app.json config with the plugin applied
const appJson = require('./app.json');
module.exports = withXcode26Fixes(appJson.expo);
