const env = {
  PORT: Number(process.env.PORT ?? 3000),
  LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_ISSUER: process.env.JWT_ISSUER ?? "https://relay.clip.omelet.tech",
  REFRESH_TOKEN_TTL_DAYS: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
  GOOGLE_LOOPBACK_PORT: Number(process.env.GOOGLE_LOOPBACK_PORT ?? 8788),
  TURN_STATIC_AUTH_SECRET: process.env.TURN_STATIC_AUTH_SECRET,
  TURN_HOST: process.env.TURN_HOST ?? "turn.clip.omelet.tech",
  COMMIT_SHA: process.env.COMMIT_SHA,
  APP_VERSION: process.env.APP_VERSION,
  RELAY_BUFFER_TTL_MS: Number(process.env.RELAY_BUFFER_TTL_MS ?? 60_000),
  MAX_RELAY_ROOMS: Number(process.env.MAX_RELAY_ROOMS ?? 150),
  RELAY_RATE_LIMIT_CAPACITY: Number(process.env.RELAY_RATE_LIMIT_CAPACITY ?? 100),
  RELAY_RATE_LIMIT_RATE: Number(process.env.RELAY_RATE_LIMIT_RATE ?? 100),
} as const;

export type Env = typeof env;

export default env;
