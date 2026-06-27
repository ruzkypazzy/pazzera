/**
 * Vitest setup — runs before every test file.
 * Forces in-memory SQLite + test secrets so tests are isolated + reproducible.
 */
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-jwt-secret-32-bytes-padding';
process.env.ENCRYPTION_KEY = 'test-enc-key-32-bytes-padding';
process.env.NODE_ENV = 'test';
process.env.PUBLIC_BASE_URL = 'http://localhost:3001';