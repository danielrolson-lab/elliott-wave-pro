module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      'babel-preset-expo',
    ],
    plugins: [
      // NativeWind v4 / react-native-css-interop transform (className support).
      // We inline this instead of using 'nativewind/babel' to avoid loading
      // react-native-worklets/plugin which is only needed for reanimated 4+.
      require('react-native-css-interop/dist/babel-plugin').default,
      [
        '@babel/plugin-transform-react-jsx',
        { runtime: 'automatic', importSource: 'react-native-css-interop' },
      ],
      // react-native-reanimated/plugin MUST be last
      'react-native-reanimated/plugin',
    ],
  };
};
