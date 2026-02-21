// Test setup: configure env for :memory: SQLite before anything else loads
process.env.NODE_ENV = "test";
process.env.DB_URL = ":memory:";
process.env.DB_DRIVER = "sqlite";
process.env.JWT_SECRET = "test-secret-at-least-32-characters-long!!!";
process.env.JWT_ACCESS_TTL_SEC = "900";
process.env.JWT_REFRESH_TTL_SEC = "604800";
process.env.HOST = "127.0.0.1";
process.env.PORT = "3000";
