// Extends app.json rather than replacing it. Everything static still lives
// there; this exists only to inject values that must NOT be committed.
//
// The Android Google Maps key is the one such value. react-native-maps renders
// nothing on Android without it — Expo Go's shared debug key covers local
// testing, but a real build needs your own. iOS needs no key: the app uses
// Apple Maps there (no PROVIDER_GOOGLE anywhere), so this is Android-only.
//
// Supplied as GOOGLE_MAPS_API_KEY — from mobile/.env locally, and from an EAS
// environment variable for builds (see eas.json). Deliberately omitted rather
// than written as an empty string when unset, so a build without it fails
// loudly at the point the map is used instead of silently shipping a blank map.
const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();

module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    ...(googleMapsApiKey
      ? {
          config: {
            ...config.android?.config,
            googleMaps: { apiKey: googleMapsApiKey },
          },
        }
      : {}),
  },
});
