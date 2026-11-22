import type { ConfigContext, ExpoConfig } from 'expo/config';

// EAS file environment variables resolve to a build-local path. Never embed FCM credentials.
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? 'Lucrari',
  slug: config.slug ?? 'Lucrari',
  android: {
    ...config.android,
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
  },
});
