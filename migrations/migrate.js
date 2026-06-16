const pool = require('../config/database');

async function createTables() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

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

    await client.query(`
      ALTER TABLE stalkers
      ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'Neutral'
    `);

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

    await client.query(`
      CREATE TABLE IF NOT EXISTS groupings (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        code VARCHAR(50) UNIQUE NOT NULL,
        color VARCHAR(20) DEFAULT '#ff6600',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS contracts (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        goal TEXT NOT NULL,
        details TEXT,
        notes TEXT,
        link VARCHAR(500),
        status VARCHAR(20) NOT NULL DEFAULT 'open'
          CHECK (status IN ('open', 'inwork', 'closed')),
        assigned_group_code VARCHAR(50),
        assigned_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        assigned_at TIMESTAMP,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS group_contracts (
        id SERIAL PRIMARY KEY,
        group_code VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        goal TEXT NOT NULL,
        details TEXT,
        docx_link VARCHAR(500),
        photo_path VARCHAR(500),
        status VARCHAR(20) NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'completed', 'cancelled')),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS group_contract_notes (
        id SERIAL PRIMARY KEY,
        contract_id INTEGER NOT NULL REFERENCES group_contracts(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        username VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS group_chat_messages (
        id SERIAL PRIMARY KEY,
        group_code VARCHAR(50) NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        username VARCHAR(50) NOT NULL,
        message TEXT DEFAULT '',
        photo_path VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      ALTER TABLE group_chat_messages
      ADD COLUMN IF NOT EXISTS photo_path VARCHAR(500)
    `);

    await client.query(`
      ALTER TABLE group_chat_messages
      ALTER COLUMN message DROP NOT NULL
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS org_chat_messages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        username VARCHAR(50) NOT NULL,
        author_role VARCHAR(50) NOT NULL,
        message TEXT DEFAULT '',
        photo_path VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS alter_egos (
        id SERIAL PRIMARY KEY,
        group_code VARCHAR(50) NOT NULL,
        real_callsign VARCHAR(100) NOT NULL,
        alter_ego VARCHAR(100) NOT NULL,
        short_history TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'inactive')),
        notes TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS group_maps (
        id SERIAL PRIMARY KEY,
        group_code VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        notes TEXT,
        photo_path VARCHAR(500) NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS group_map_notes (
        id SERIAL PRIMARY KEY,
        map_id INTEGER NOT NULL REFERENCES group_maps(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        username VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS group_info (
        id SERIAL PRIMARY KEY,
        group_code VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        photo_path VARCHAR(500),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS group_info_notes (
        id SERIAL PRIMARY KEY,
        info_id INTEGER NOT NULL REFERENCES group_info(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        username VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query('CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_contracts_assigned_group ON contracts(assigned_group_code)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_group_contracts_group ON group_contracts(group_code)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_group_contracts_status ON group_contracts(status)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_group_contract_notes_contract ON group_contract_notes(contract_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_group_chat_group ON group_chat_messages(group_code)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_group_chat_created ON group_chat_messages(created_at)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_org_chat_created ON org_chat_messages(created_at)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_alter_egos_group ON alter_egos(group_code)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_alter_egos_status ON alter_egos(status)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_group_maps_group ON group_maps(group_code)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_group_map_notes_map ON group_map_notes(map_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_group_info_group ON group_info(group_code)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_group_info_notes_info ON group_info_notes(info_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_stalkers_face_id ON stalkers(face_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_financial_user_id ON financial_operations(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_financial_created_at ON financial_operations(created_at)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_wanted_callsign ON wanted_stalkers(callsign)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_wanted_face_id ON wanted_stalkers(face_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_wanted_created_at ON wanted_stalkers(created_at)');

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

    const userCheck = await client.query('SELECT COUNT(*) FROM users');

    if (parseInt(userCheck.rows[0].count, 10) === 0) {
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash('admin', 10);

      await client.query(
        'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
        ['admin', hashedPassword, 'Admin']
      );

      console.log('☢ Создан администратор по умолчанию: admin/admin');
    }

    const stalkerCheck = await client.query('SELECT COUNT(*) FROM stalkers');

    if (parseInt(stalkerCheck.rows[0].count, 10) === 0) {
      const sampleStalkers = [
        ['Снайпер', 'Иванов Иван Иванович', 'ST001', 'Freedom', 'Опытный сталкер, специализируется на дальних переходах'],
        ['Волк', 'Петров Петр Петрович', 'ST002', 'Duty', 'Бывший военный, знает зону как свои пять пальцев'],
        ['Тень', 'Сидоров Сидор Сидорович', 'ST003', 'Neutral', 'Мастер скрытности, работает в одиночку'],
        ['Охотник', 'Козлов Козел Козлович', 'ST004', 'Mercenary', 'Специалист по артефактам, имеет связи с учеными'],
      ];

      for (const [callsign, fullName, faceId, role, note] of sampleStalkers) {
        await client.query(
          'INSERT INTO stalkers (callsign, full_name, face_id, role, note) VALUES ($1, $2, $3, $4, $5)',
          [callsign, fullName, faceId, role, note]
        );
      }

      console.log('☢ Добавлены тестовые сталкеры');
    }

    const wantedCheck = await client.query('SELECT COUNT(*) FROM wanted_stalkers');

    if (parseInt(wantedCheck.rows[0].count, 10) === 0) {
      const wantedStalkers = [
        ['Бандит', 'Криминальный Криминал Криминалович', 'W001', 'Bandit', 50000.0, 'Территория бандитов', 'Нападение на торговцев'],
        ['Предатель', 'Изменник Измен Изменович', 'W002', 'Neutral', 25000.0, 'Бар "100 рентген"', 'Кража артефактов'],
        ['Убийца', 'Хладнокровный Холод Холодович', 'W003', 'Mercenary', 75000.0, 'Заброшенная лаборатория', 'Убийство сталкеров'],
        ['Шпион', 'Скрытный Секрет Секретович', 'W004', 'Duty', 30000.0, 'Военная база', 'Шпионаж в пользу Свободы'],
      ];

      for (const [callsign, fullName, faceId, role, reward, lastSeen, reason] of wantedStalkers) {
        await client.query(
          'INSERT INTO wanted_stalkers (callsign, full_name, face_id, role, reward, last_seen, reason) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [callsign, fullName, faceId, role, reward, lastSeen, reason]
        );
      }

      console.log('☢ Добавлены тестовые данные розыска');
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
