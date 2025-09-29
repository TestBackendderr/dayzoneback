const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

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

module.exports = router;
