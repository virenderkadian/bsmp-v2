// Standard Expo Metro config. The shared API contract (../src/lib/driver-api-types.ts)
// is imported type-only, so Babel strips those imports and Metro never has to
// resolve anything outside this project at runtime — tsconfig `paths` handles
// type-checking. That's why no `watchFolders` entry is needed here.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

module.exports = config;
