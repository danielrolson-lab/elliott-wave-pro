const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Config plugin: patch CocoaPods post_install for Xcode 26 local simulator builds.
 *
 * Issue 1: EXConstants — skip Metro-dependent "Generate app.config" script phase.
 * Issue 2: fmt — CLANG_CXX_LANGUAGE_STANDARD=c++17 + CLANG_CXX_LIBRARY=libc++
 *           fixes "Call to consteval function is not a constant expression".
 * Issue 3: All pods — IPHONEOS_DEPLOYMENT_TARGET=14.0 suppresses warnings.
 */
function withXcode26Fixes(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');

      const patch = `
    # Issue 1: EXConstants — skip Metro-dependent app.config generation script
    # for local simulator builds where Metro is not running.
    installer.pods_project.targets.each do |target|
      if target.name == 'EXConstants'
        target.build_configurations.each do |config|
          config.build_settings['EXPO_UPDATES_FINGERPRINT_OVERRIDE'] = '1'
        end
        target.shell_script_build_phases.each do |phase|
          if phase.name.include?('Generate app.config')
            phase.shell_script = 'echo "Skipped for local build"'
          end
        end
      end
    end

    # Issue 2: fmt — fix C++ consteval errors in Xcode 26.
    installer.pods_project.targets.each do |target|
      if target.name == 'fmt'
        target.build_configurations.each do |config|
          config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
          config.build_settings['CLANG_CXX_LIBRARY'] = 'libc++'
        end
      end
    end

    # Issue 3: Set minimum deployment target to 14.0 for all pods.
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '14.0'
      end
    end

`;

      const marker = '# This is necessary for Xcode 14';
      if (!contents.includes("'EXConstants'") && contents.includes(marker)) {
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
