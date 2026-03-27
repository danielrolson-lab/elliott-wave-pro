// metro.config.js
// NativeWind v4 requires the Metro transformer to process global.css.
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind }   = require('nativewind/metro');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Ensure @react-native/assets-registry resolves to the installed package,
// not to any generated noop shim.
config.resolver = {
  ...config.resolver,
  extraNodeModules: {
    ...config.resolver?.extraNodeModules,
    '@react-native/assets-registry': path.resolve(
      __dirname,
      'node_modules/@react-native/assets-registry'
    ),
  },
};

module.exports = withNativeWind(config, { input: './global.css' });
