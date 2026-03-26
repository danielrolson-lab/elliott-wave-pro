module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      'babel-preset-expo',
      'nativewind/babel', // NativeWind v4 — must come after expo preset
    ],
    // react-native-reanimated/plugin MUST be last
    plugins: ['react-native-reanimated/plugin'],
  };
};
