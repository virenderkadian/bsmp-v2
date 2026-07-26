module.exports = function (api) {
  api.cache(true);
  // babel-preset-expo (SDK 54) bundles the Reanimated/Worklets plugin, so the
  // slide-to-confirm gestures work without an extra plugin entry here.
  return {
    presets: ["babel-preset-expo"],
  };
};
