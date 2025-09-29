-- Инициализация базы данных DayZone
-- Этот файл выполняется при первом запуске PostgreSQL контейнера

-- Создание таблицы пользователей
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'Neutral',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Создание таблицы сталкеров
CREATE TABLE IF NOT EXISTS stalkers (
    id SERIAL PRIMARY KEY,
    callsign VARCHAR(100) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    face_id VARCHAR(50) UNIQUE NOT NULL,
    note TEXT,
    photo_path VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Создание таблицы финансовых операций
CREATE TABLE IF NOT EXISTS financial_operations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    stalker_login VARCHAR(100) NOT NULL,
    operation_type VARCHAR(1) NOT NULL CHECK (operation_type IN ('+', '-')),
    amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'рубли',
    source VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Создание таблицы розыска сталкеров
CREATE TABLE IF NOT EXISTS wanted_stalkers (
    id SERIAL PRIMARY KEY,
    callsign VARCHAR(100) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    face_id VARCHAR(50) NOT NULL,
    reward DECIMAL(15,2) NOT NULL,
    last_seen VARCHAR(255) NOT NULL,
    reason TEXT NOT NULL,
    photo_path VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Создание индексов для оптимизации
CREATE INDEX IF NOT EXISTS idx_stalkers_callsign ON stalkers(callsign);
CREATE INDEX IF NOT EXISTS idx_stalkers_face_id ON stalkers(face_id);
CREATE INDEX IF NOT EXISTS idx_financial_user_id ON financial_operations(user_id);
CREATE INDEX IF NOT EXISTS idx_financial_created_at ON financial_operations(created_at);
CREATE INDEX IF NOT EXISTS idx_wanted_callsign ON wanted_stalkers(callsign);
CREATE INDEX IF NOT EXISTS idx_wanted_face_id ON wanted_stalkers(face_id);
CREATE INDEX IF NOT EXISTS idx_wanted_created_at ON wanted_stalkers(created_at);

-- Вставка администратора по умолчанию
INSERT INTO users (username, password, role) 
VALUES ('admin', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Admin')
ON CONFLICT (username) DO NOTHING;

-- Вставка тестовых сталкеров
INSERT INTO stalkers (callsign, full_name, face_id, note) VALUES
('Снайпер', 'Иванов Иван Иванович', 'ST001', 'Опытный сталкер, специализируется на дальних переходах'),
('Волк', 'Петров Петр Петрович', 'ST002', 'Бывший военный, знает зону как свои пять пальцев'),
('Тень', 'Сидоров Сидор Сидорович', 'ST003', 'Мастер скрытности, работает в одиночку'),
('Охотник', 'Козлов Козел Козлович', 'ST004', 'Специалист по артефактам, имеет связи с учеными')
ON CONFLICT (face_id) DO NOTHING;
