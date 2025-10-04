const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Регистрация нового пользователя
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Логин и пароль обязательны' });
    }

    if (username.length < 3 || password.length < 6) {
      return res.status(400).json({ 
        message: 'Логин должен содержать минимум 3 символа, пароль - 6 символов' 
      });
    }

    // Проверяем, не существует ли уже такой пользователь
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE username = $1',
      [username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ message: 'Пользователь с таким логином уже существует' });
    }

    // Хешируем пароль
    const hashedPassword = await bcrypt.hash(password, 10);

    // Создаем пользователя
    const result = await pool.query(
      'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role',
      [username, hashedPassword, 'Neutral']
    );

    const user = result.rows[0];

    // Создаем JWT токен
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    res.status(201).json({
      message: 'Пользователь успешно создан',
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      },
      token
    });

  } catch (error) {
    console.error('Ошибка регистрации:', error);
    res.status(500).json({ message: 'Ошибка создания пользователя' });
  }
});

// Вход в систему
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Логин и пароль обязательны' });
    }

    // Ищем пользователя
    const result = await pool.query(
      'SELECT id, username, password, role FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Неверный логин или пароль' });
    }

    const user = result.rows[0];

    // Проверяем пароль
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Неверный логин или пароль' });
    }

    // Создаем JWT токен
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    res.json({
      message: 'Вход выполнен успешно',
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      },
      token
    });

  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ message: 'Ошибка входа в систему' });
  }
});

// Получение информации о текущем пользователе
router.get('/me', authenticateToken, async (req, res) => {
  try {
    res.json({
      user: {
        id: req.user.id,
        username: req.user.username,
        role: req.user.role
      }
    });
  } catch (error) {
    console.error('Ошибка получения информации о пользователе:', error);
    res.status(500).json({ message: 'Ошибка получения информации о пользователе' });
  }
});

// Проверка токена
router.get('/verify', authenticateToken, (req, res) => {
  res.json({ 
    valid: true, 
    user: {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role
    }
  });
});

// Получить всех пользователей (только для админов)
router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, role, created_at FROM users ORDER BY created_at DESC'
    );

    res.json({
      users: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Ошибка получения пользователей:', error);
    res.status(500).json({ message: 'Ошибка получения списка пользователей' });
  }
});

// Создать нового пользователя (только для админов)
router.post('/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({ 
        message: 'Позывной, пароль и роль обязательны' 
      });
    }

    // Проверяем, что роль валидна
    const validRoles = ['Admin', 'Duty', 'Freedom', 'Neutral', 'Mercenary', 'Bandit', 'Monolith', 'ClearSky', 'Loner'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ 
        message: 'Неверная роль. Доступные роли: ' + validRoles.join(', ') 
      });
    }

    // Проверяем, что пользователь с таким именем не существует
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE username = $1',
      [username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ 
        message: 'Пользователь с таким позывным уже существует' 
      });
    }

    // Хешируем пароль
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Создаем пользователя
    const result = await pool.query(
      'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role, created_at',
      [username, hashedPassword, role]
    );

    res.status(201).json({
      message: 'Пользователь успешно создан',
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Ошибка создания пользователя:', error);
    res.status(500).json({ message: 'Ошибка создания пользователя' });
  }
});

// Обновить пользователя (только для админов)
router.put('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password, role } = req.body;

    if (!username || !role) {
      return res.status(400).json({ 
        message: 'Позывной и роль обязательны' 
      });
    }

    // Проверяем, что роль валидна
    const validRoles = ['Admin', 'Duty', 'Freedom', 'Neutral', 'Mercenary', 'Bandit', 'Monolith', 'ClearSky', 'Loner'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ 
        message: 'Неверная роль. Доступные роли: ' + validRoles.join(', ') 
      });
    }

    // Проверяем, что пользователь существует
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE id = $1',
      [id]
    );

    if (existingUser.rows.length === 0) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    // Проверяем уникальность имени пользователя (исключая текущего)
    const duplicateCheck = await pool.query(
      'SELECT id FROM users WHERE username = $1 AND id != $2',
      [username, id]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(409).json({ 
        message: 'Пользователь с таким позывным уже существует' 
      });
    }

    let query, params;
    
    if (password) {
      // Если пароль предоставлен, обновляем его тоже
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);
      query = 'UPDATE users SET username = $1, password = $2, role = $3 WHERE id = $4 RETURNING id, username, role, created_at';
      params = [username, hashedPassword, role, id];
    } else {
      // Если пароль не предоставлен, оставляем старый
      query = 'UPDATE users SET username = $1, role = $2 WHERE id = $3 RETURNING id, username, role, created_at';
      params = [username, role, id];
    }

    const result = await pool.query(query, params);

    res.json({
      message: 'Пользователь успешно обновлен',
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Ошибка обновления пользователя:', error);
    res.status(500).json({ message: 'Ошибка обновления пользователя' });
  }
});

// Удалить пользователя (только для админов)
router.delete('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Проверяем, что пользователь существует
    const existingUser = await pool.query(
      'SELECT username FROM users WHERE id = $1',
      [id]
    );

    if (existingUser.rows.length === 0) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    // Нельзя удалить самого себя
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ message: 'Нельзя удалить самого себя' });
    }

    await pool.query('DELETE FROM users WHERE id = $1', [id]);

    res.json({ message: 'Пользователь успешно удален' });

  } catch (error) {
    console.error('Ошибка удаления пользователя:', error);
    res.status(500).json({ message: 'Ошибка удаления пользователя' });
  }
});

module.exports = router;
