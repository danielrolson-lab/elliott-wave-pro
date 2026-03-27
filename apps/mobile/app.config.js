const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Config plugin: patch CocoaPods for Xcode 26 local simulator build compatibility.
 *
 * 1. fmt: force c++17 to resolve consteval errors
 * 2. PurchasesHybridCommon: Swift 5.9 + disable availability checking +
 *    minimal strict concurrency to fix SubscriptionPeriod ambiguous type errors
 * 3. All pods: set minimum deployment target to 14.0 to suppress warnings
 */
function withXcode26Fixes(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');

      // post_integrate block — injected before the first target block
      const postIntegrate = `
post_integrate do |installer|
  installer.pods_project.targets.each do |target|
    if target.name == 'PurchasesHybridCommon'
      target.build_configurations.each do |config|
        config.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'minimal'
      end
    end
  end
end

`;

      // post_install patches — injected inside the existing post_install hook
      const postInstallPatch = `
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
          config.build_settings['SWIFT_VERSION'] = '5.9'
          config.build_settings['OTHER_SWIFT_FLAGS'] = '$(inherited) -Xfrontend -disable-availability-checking'
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

      const targetMarker = "target 'ElliottWavePro' do";
      const postInstallMarker = '# This is necessary for Xcode 14';

      if (!contents.includes('PurchasesHybridCommon')) {
        // Inject post_integrate before the target block
        if (contents.includes(targetMarker)) {
          contents = contents.replace(targetMarker, postIntegrate + targetMarker);
        }
        // Inject post_install patches inside the existing post_install hook
        if (contents.includes(postInstallMarker)) {
          contents = contents.replace(postInstallMarker, postInstallPatch + '    ' + postInstallMarker);
        }
        fs.writeFileSync(podfilePath, contents);
      }

      return cfg;
    },
  ]);
}

// Re-export app.json config with the plugin applied
const appJson = require('./app.json');
module.exports = withXcode26Fixes(appJson.expo);
