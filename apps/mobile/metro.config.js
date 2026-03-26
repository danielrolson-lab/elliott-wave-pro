// metro.config.js
// NativeWind v4 requires the Metro transformer to process global.css.
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind }   = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: './global.css' });
