const { Pool } = require('pg');

// Подключение к базе данных
const pool = new Pool({
  connectionString: 'postgresql://root:Makarov1488@85.215.53.87:5432/fullstack'
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('☢ Подключение к базе данных установлено');
    await client.query('BEGIN');

    // Создание таблицы пользователей
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'Neutral',
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
        role VARCHAR(50) NOT NULL DEFAULT 'Neutral',
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

    // Создание таблицы розыска сталкеров
    await client.query(`
      CREATE TABLE IF NOT EXISTS wanted_stalkers (
        id SERIAL PRIMARY KEY,
        callsign VARCHAR(100) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        face_id VARCHAR(50) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'Neutral',
        reward DECIMAL(15,2) NOT NULL,
        last_seen VARCHAR(255) NOT NULL,
        reason TEXT NOT NULL,
        photo_path VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Создание индексов
    await client.query('CREATE INDEX IF NOT EXISTS idx_stalkers_callsign ON stalkers(callsign)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_stalkers_face_id ON stalkers(face_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_financial_user_id ON financial_operations(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_financial_created_at ON financial_operations(created_at)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_wanted_callsign ON wanted_stalkers(callsign)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_wanted_face_id ON wanted_stalkers(face_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_wanted_created_at ON wanted_stalkers(created_at)');

    // Вставка администратора по умолчанию
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash('admin', 10);
    
    await client.query(
      `INSERT INTO users (username, password, role) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (username) DO NOTHING`,
      ['admin', hashedPassword, 'Admin']
    );

    // Вставка тестовых сталкеров
    const sampleStalkers = [
      ['Снайпер', 'Иванов Иван Иванович', 'ST001', 'Freedom', 'Опытный сталкер, специализируется на дальних переходах'],
      ['Волк', 'Петров Петр Петрович', 'ST002', 'Duty', 'Бывший военный, знает зону как свои пять пальцев'],
      ['Тень', 'Сидоров Сидор Сидорович', 'ST003', 'Neutral', 'Мастер скрытности, работает в одиночку'],
      ['Охотник', 'Козлов Козел Козлович', 'ST004', 'Mercenary', 'Специалист по артефактам, имеет связи с учеными']
    ];

    for (const [callsign, fullName, faceId, role, note] of sampleStalkers) {
      await client.query(
        `INSERT INTO stalkers (callsign, full_name, face_id, role, note) 
         VALUES ($1, $2, $3, $4, $5) 
         ON CONFLICT (face_id) DO NOTHING`,
        [callsign, fullName, faceId, role, note]
      );
    }

    // Вставка тестовых данных для розыска
    const wantedStalkers = [
      ['Бандит', 'Криминальный Криминал Криминалович', 'W001', 'Bandit', 50000.00, 'Территория бандитов', 'Нападение на торговцев'],
      ['Предатель', 'Изменник Измен Изменович', 'W002', 'Neutral', 25000.00, 'Бар "100 рентген"', 'Кража артефактов'],
      ['Убийца', 'Хладнокровный Холод Холодович', 'W003', 'Mercenary', 75000.00, 'Заброшенная лаборатория', 'Убийство сталкеров'],
      ['Шпион', 'Скрытный Секрет Секретович', 'W004', 'Duty', 30000.00, 'Военная база', 'Шпионаж в пользу Свободы']
    ];

    for (const [callsign, fullName, faceId, role, reward, lastSeen, reason] of wantedStalkers) {
      await client.query(
        `INSERT INTO wanted_stalkers (callsign, full_name, face_id, role, reward, last_seen, reason) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         ON CONFLICT DO NOTHING`,
        [callsign, fullName, faceId, role, reward, lastSeen, reason]
      );
    }

    await client.query('COMMIT');
    console.log('☢ Миграция выполнена успешно!');
    console.log('☢ Созданы таблицы: users, stalkers, financial_operations, wanted_stalkers');
    console.log('☢ Добавлен администратор: admin/admin');
    console.log('☢ Добавлены тестовые сталкеры и розыскные данные');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка миграции:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch(console.error);
