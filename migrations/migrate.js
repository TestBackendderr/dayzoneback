const pool = require('../config/database');

async function createTables() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Создание таблицы пользователей
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Создание таблицы сталкеров
    await client.query(`
      CREATE TABLE IF NOT EXISTS stalkers (
        id SERIAL PRIMARY KEY,
        callsign VARCHAR(100) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        face_id VARCHAR(50) UNIQUE NOT NULL,
        note TEXT,
        photo_path VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Создание таблицы финансовых операций
    await client.query(`
      CREATE TABLE IF NOT EXISTS financial_operations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        stalker_login VARCHAR(100) NOT NULL,
        operation_type VARCHAR(1) NOT NULL CHECK (operation_type IN ('+', '-')),
        amount DECIMAL(15,2) NOT NULL,
        currency VARCHAR(10) NOT NULL DEFAULT 'рубли',
        source VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Создание индексов для оптимизации
    await client.query('CREATE INDEX IF NOT EXISTS idx_stalkers_callsign ON stalkers(callsign)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_stalkers_face_id ON stalkers(face_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_financial_user_id ON financial_operations(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_financial_created_at ON financial_operations(created_at)');

    await client.query('COMMIT');
    console.log('☢ Таблицы базы данных созданы успешно');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка создания таблиц:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function seedData() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Проверяем, есть ли уже пользователи
    const userCheck = await client.query('SELECT COUNT(*) FROM users');
    
    if (parseInt(userCheck.rows[0].count) === 0) {
      // Создаем администратора по умолчанию
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash('admin', 10);
      
      await client.query(
        'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
        ['admin', hashedPassword, 'admin']
      );
      
      console.log('☢ Создан администратор по умолчанию: admin/admin');
    }

    // Проверяем, есть ли уже сталкеры
    const stalkerCheck = await client.query('SELECT COUNT(*) FROM stalkers');
    
    if (parseInt(stalkerCheck.rows[0].count) === 0) {
      // Добавляем тестовых сталкеров
      const sampleStalkers = [
        ['Снайпер', 'Иванов Иван Иванович', 'ST001', 'Опытный сталкер, специализируется на дальних переходах'],
        ['Волк', 'Петров Петр Петрович', 'ST002', 'Бывший военный, знает зону как свои пять пальцев'],
        ['Тень', 'Сидоров Сидор Сидорович', 'ST003', 'Мастер скрытности, работает в одиночку'],
        ['Охотник', 'Козлов Козел Козлович', 'ST004', 'Специалист по артефактам, имеет связи с учеными']
      ];

      for (const [callsign, fullName, faceId, note] of sampleStalkers) {
        await client.query(
          'INSERT INTO stalkers (callsign, full_name, face_id, note) VALUES ($1, $2, $3, $4)',
          [callsign, fullName, faceId, note]
        );
      }
      
      console.log('☢ Добавлены тестовые сталкеры');
    }

    await client.query('COMMIT');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка заполнения тестовыми данными:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function runMigrations() {
  try {
    await createTables();
    await seedData();
    console.log('☢ Миграции выполнены успешно');
  } catch (error) {
    console.error('❌ Ошибка выполнения миграций:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations();
}

module.exports = { createTables, seedData };
