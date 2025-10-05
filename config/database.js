const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || '85.215.53.87',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'fullstack',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'Makarov1488',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Если есть DATABASE_URL, используем его
if (process.env.DATABASE_URL) {
  const config = {
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  };
  Object.assign(pool.options, config);
}

// Test database connection
pool.on('connect', () => {
  console.log('☢ Подключение к базе данных DayZone установлено');
});

pool.on('error', (err) => {
  console.error('❌ Ошибка подключения к базе данных:', err);
});

module.exports = pool;
