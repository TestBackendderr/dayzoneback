const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/wanted');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'wanted-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5242880 // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Разрешены только изображения'), false);
    }
  }
});

// Получить всех разыскиваемых
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { searchBy, searchTerm } = req.query;
    let query = 'SELECT * FROM wanted_stalkers';
    const params = [];

    if (searchTerm) {
      if (searchBy === 'callsign') {
        query += ' WHERE callsign ILIKE $1';
        params.push(`%${searchTerm}%`);
      } else if (searchBy === 'faceId') {
        query += ' WHERE face_id ILIKE $1';
        params.push(`%${searchTerm}%`);
      } else if (searchBy === 'fullName') {
        query += ' WHERE full_name ILIKE $1';
        params.push(`%${searchTerm}%`);
      }
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    
    // Добавляем полный URL для фото
    const wanted = result.rows.map(person => ({
      ...person,
      photo: person.photo_path ? `/uploads/wanted/${path.basename(person.photo_path)}` : null
    }));

    res.json({
      wanted,
      total: result.rows.length
    });

  } catch (error) {
    console.error('Ошибка получения списка розыска:', error);
    res.status(500).json({ message: 'Ошибка получения списка розыска' });
  }
});

// Получить разыскиваемого по ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM wanted_stalkers WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Разыскиваемый не найден' });
    }

    const wanted = result.rows[0];
    wanted.photo = wanted.photo_path ? `/uploads/wanted/${path.basename(wanted.photo_path)}` : null;

    res.json({ wanted });

  } catch (error) {
    console.error('Ошибка получения информации о разыскиваемом:', error);
    res.status(500).json({ message: 'Ошибка получения информации о разыскиваемом' });
  }
});

// Добавить в розыск
router.post('/', authenticateToken, requireAdmin, upload.single('photo'), async (req, res) => {
  try {
    const { callsign, fullName, faceId, reward, lastSeen, reason } = req.body;

    if (!callsign || !fullName || !faceId || !reward || !lastSeen || !reason) {
      return res.status(400).json({ 
        message: 'Все поля обязательны для заполнения' 
      });
    }

    // Проверяем числовое значение награды
    const rewardValue = parseFloat(reward);
    if (isNaN(rewardValue) || rewardValue < 0) {
      return res.status(400).json({ 
        message: 'Награда должна быть положительным числом' 
      });
    }

    // Проверяем уникальность ID лица
    const existingWanted = await pool.query(
      'SELECT id FROM wanted_stalkers WHERE face_id = $1',
      [faceId]
    );

    if (existingWanted.rows.length > 0) {
      return res.status(409).json({ 
        message: 'Человек с таким ID лица уже находится в розыске' 
      });
    }

    const photoPath = req.file ? req.file.path : null;

    const result = await pool.query(
      'INSERT INTO wanted_stalkers (callsign, full_name, face_id, reward, last_seen, reason, photo_path) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [callsign, fullName, faceId, rewardValue, lastSeen, reason, photoPath]
    );

    const wanted = result.rows[0];
    wanted.photo = wanted.photo_path ? `/uploads/wanted/${path.basename(wanted.photo_path)}` : null;

    res.status(201).json({
      message: 'Человек успешно добавлен в розыск',
      wanted
    });

  } catch (error) {
    console.error('Ошибка добавления в розыск:', error);
    res.status(500).json({ message: 'Ошибка добавления в розыск' });
  }
});

// Обновить информацию о разыскиваемом
router.put('/:id', authenticateToken, requireAdmin, upload.single('photo'), async (req, res) => {
  try {
    const { id } = req.params;
    const { callsign, fullName, faceId, reward, lastSeen, reason } = req.body;

    if (!callsign || !fullName || !faceId || !reward || !lastSeen || !reason) {
      return res.status(400).json({ 
        message: 'Все поля обязательны для заполнения' 
      });
    }

    // Проверяем числовое значение награды
    const rewardValue = parseFloat(reward);
    if (isNaN(rewardValue) || rewardValue < 0) {
      return res.status(400).json({ 
        message: 'Награда должна быть положительным числом' 
      });
    }

    // Проверяем, существует ли разыскиваемый
    const existingWanted = await pool.query(
      'SELECT * FROM wanted_stalkers WHERE id = $1',
      [id]
    );

    if (existingWanted.rows.length === 0) {
      return res.status(404).json({ message: 'Разыскиваемый не найден' });
    }

    // Проверяем уникальность ID лица (исключая текущего)
    const duplicateCheck = await pool.query(
      'SELECT id FROM wanted_stalkers WHERE face_id = $1 AND id != $2',
      [faceId, id]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(409).json({ 
        message: 'Человек с таким ID лица уже находится в розыске' 
      });
    }

    let photoPath = existingWanted.rows[0].photo_path;

    // Если загружено новое фото, удаляем старое и сохраняем новое
    if (req.file) {
      if (photoPath && fs.existsSync(photoPath)) {
        fs.unlinkSync(photoPath);
      }
      photoPath = req.file.path;
    }

    const result = await pool.query(
      'UPDATE wanted_stalkers SET callsign = $1, full_name = $2, face_id = $3, reward = $4, last_seen = $5, reason = $6, photo_path = $7, updated_at = CURRENT_TIMESTAMP WHERE id = $8 RETURNING *',
      [callsign, fullName, faceId, rewardValue, lastSeen, reason, photoPath, id]
    );

    const wanted = result.rows[0];
    wanted.photo = wanted.photo_path ? `/uploads/wanted/${path.basename(wanted.photo_path)}` : null;

    res.json({
      message: 'Информация о разыскиваемом успешно обновлена',
      wanted
    });

  } catch (error) {
    console.error('Ошибка обновления информации о разыскиваемом:', error);
    res.status(500).json({ message: 'Ошибка обновления информации о разыскиваемом' });
  }
});

// Удалить из розыска
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Проверяем, существует ли разыскиваемый
    const existingWanted = await pool.query(
      'SELECT photo_path FROM wanted_stalkers WHERE id = $1',
      [id]
    );

    if (existingWanted.rows.length === 0) {
      return res.status(404).json({ message: 'Разыскиваемый не найден' });
    }

    // Удаляем фото, если оно есть
    const photoPath = existingWanted.rows[0].photo_path;
    if (photoPath && fs.existsSync(photoPath)) {
      fs.unlinkSync(photoPath);
    }

    await pool.query('DELETE FROM wanted_stalkers WHERE id = $1', [id]);

    res.json({ message: 'Человек успешно удален из розыска' });

  } catch (error) {
    console.error('Ошибка удаления из розыска:', error);
    res.status(500).json({ message: 'Ошибка удаления из розыска' });
  }
});

module.exports = router;