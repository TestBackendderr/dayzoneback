-- Обновление ролей пользователей для DayZone
-- Добавление новых ролей сталкеров

-- Сначала обновляем существующих пользователей на новые роли
UPDATE users SET role = 'Admin' WHERE username = 'admin';
UPDATE users SET role = 'Neutral' WHERE username = 'Makarov';

-- Добавляем ограничение на роли (если его еще нет)
DO $$ 
BEGIN
    -- Проверяем, существует ли уже ограничение
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'users_role_check' 
        AND table_name = 'users'
    ) THEN
        -- Добавляем ограничение на допустимые роли
        ALTER TABLE users ADD CONSTRAINT users_role_check 
        CHECK (role IN ('Neutral', 'Dolg', 'Svoboda', 'Voen', 'Admin', 'Bandity'));
    END IF;
END $$;

-- Обновляем комментарий к таблице
COMMENT ON COLUMN users.role IS 'Роль пользователя: Neutral, Dolg, Svoboda, Voen, Admin, Bandity';
