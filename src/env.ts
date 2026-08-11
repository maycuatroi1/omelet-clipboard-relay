const env = {
  PORT: Number(process.env.PORT ?? 3000),
  LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  TURN_STATIC_AUTH_SECRET: process.env.TURN_STATIC_AUTH_SECRET,
  COMMIT_SHA: process.env.COMMIT_SHA,
  APP_VERSION: process.env.APP_VERSION,
} as const;

export type Env = typeof env;

export default env;
