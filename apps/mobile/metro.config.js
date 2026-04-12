// metro.config.js
// NativeWind v4 requires the Metro transformer to process global.css.
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind }   = require('nativewind/metro');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

// Use pnpm's symlink in node_modules (portable — works locally and on EAS).
// pnpm creates apps/mobile/node_modules/@shopify/react-native-skia as a symlink
// to the patched virtual-store entry, so we resolve through the symlink rather
// than hardcoding the virtual-store path (which differs per machine/patch-hash).
const SKIA_PATH = path.resolve(projectRoot, 'node_modules/@shopify/react-native-skia');
const ASSETS_REGISTRY_PATH = path.resolve(
  projectRoot,
  'node_modules/@react-native/assets-registry'
);

const config = getDefaultConfig(projectRoot);

// pnpm monorepo: Metro must watch the root node_modules (virtual store) so it
// can follow symlinks from apps/mobile/node_modules → ../../node_modules/.pnpm/…
config.watchFolders = [workspaceRoot];

// Ensure module resolution prefers the app-level node_modules first, then root.
config.resolver = {
  ...config.resolver,
  // Required for pnpm: Metro must follow symlinks into the virtual store
  unstable_enableSymlinks: true,
  nodeModulesPaths: [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'node_modules'),
  ],
  extraNodeModules: {
    ...config.resolver?.extraNodeModules,
    '@react-native/assets-registry': ASSETS_REGISTRY_PATH,
    '@shopify/react-native-skia': SKIA_PATH,
  },
  // resolveRequest runs BEFORE withNativeWind's resolver override.
  // react-native-css-interop captures this as `originalResolver` and calls it
  // first, so our Skia redirect survives the withNativeWind wrapping.
  resolveRequest: (context, moduleName, platform) => {
    if (moduleName === '@shopify/react-native-skia') {
      const pkgJson = require(path.join(SKIA_PATH, 'package.json'));
      const entry = pkgJson['react-native'] || pkgJson['main'];
      return {
        filePath: path.join(SKIA_PATH, entry),
        type: 'sourceFile',
      };
    }
    // Fall through to default Metro resolution
    return context.resolveRequest(context, moduleName, platform);
  },
};

module.exports = withNativeWind(config, { input: './global.css' });
