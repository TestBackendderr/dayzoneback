const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { authenticateToken, requireAdmin, requireStalkerAccess } = require('../middleware/auth');

const router = express.Router();

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/stalkers');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'stalker-' + uniqueSuffix + path.extname(file.originalname));
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

// Получить всех сталкеров (фильтрация по роли пользователя)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { searchBy, searchTerm } = req.query;
    const userRole = req.user.role;
    
    let query = 'SELECT * FROM stalkers WHERE role = $1';
    const params = [userRole];
    let paramCount = 1;

    if (searchTerm) {
      paramCount++;
      if (searchBy === 'callsign') {
        query += ` AND callsign ILIKE $${paramCount}`;
        params.push(`%${searchTerm}%`);
      } else if (searchBy === 'faceId') {
        query += ` AND face_id ILIKE $${paramCount}`;
        params.push(`%${searchTerm}%`);
      } else if (searchBy === 'fullName') {
        query += ` AND full_name ILIKE $${paramCount}`;
        params.push(`%${searchTerm}%`);
      }
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    
    // Добавляем полный URL для фото
    const stalkers = result.rows.map(stalker => ({
      ...stalker,
      photo: stalker.photo_path ? `/uploads/stalkers/${path.basename(stalker.photo_path)}` : null
    }));

    res.json({
      stalkers,
      total: result.rows.length
    });

  } catch (error) {
    console.error('Ошибка получения сталкеров:', error);
    res.status(500).json({ message: 'Ошибка получения списка сталкеров' });
  }
});

// Получить сталкера по ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM stalkers WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Сталкер не найден' });
    }

    const stalker = result.rows[0];
    stalker.photo = stalker.photo_path ? `/uploads/stalkers/${path.basename(stalker.photo_path)}` : null;

    res.json({ stalker });

  } catch (error) {
    console.error('Ошибка получения сталкера:', error);
    res.status(500).json({ message: 'Ошибка получения информации о сталкере' });
  }
});

// Создать нового сталкера
router.post('/', authenticateToken, requireStalkerAccess, upload.single('photo'), async (req, res) => {
  try {
    const { callsign, fullName, faceId, note } = req.body;
    const userRole = req.user.role;

    if (!callsign || !fullName || !faceId) {
      return res.status(400).json({ 
        message: 'Позывной, ФИО и ID лица обязательны' 
      });
    }

    // Проверяем, что пользователь не пытается создать сталкера с другой ролью
    // (кроме Admin, который может создавать сталкеров любой фракции)
    if (userRole !== 'Admin' && req.body.role && req.body.role !== userRole) {
      return res.status(403).json({ 
        message: 'Вы можете создавать сталкеров только своей фракции' 
      });
    }

    // Проверяем уникальность позывного и ID лица
    const existingStalker = await pool.query(
      'SELECT id FROM stalkers WHERE callsign = $1 OR face_id = $2',
      [callsign, faceId]
    );

    if (existingStalker.rows.length > 0) {
      return res.status(409).json({ 
        message: 'Сталкер с таким позывным или ID лица уже существует' 
      });
    }

    const photoPath = req.file ? req.file.path : null;

    const result = await pool.query(
      'INSERT INTO stalkers (callsign, full_name, face_id, role, note, photo_path) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [callsign, fullName, faceId, userRole, note, photoPath]
    );

    const stalker = result.rows[0];
    stalker.photo = stalker.photo_path ? `/uploads/stalkers/${path.basename(stalker.photo_path)}` : null;

    res.status(201).json({
      message: 'Сталкер успешно добавлен',
      stalker
    });

  } catch (error) {
    console.error('Ошибка создания сталкера:', error);
    res.status(500).json({ message: 'Ошибка создания сталкера' });
  }
});

// Обновить сталкера
router.put('/:id', authenticateToken, requireStalkerAccess, upload.single('photo'), async (req, res) => {
  try {
    const { id } = req.params;
    const { callsign, fullName, faceId, note } = req.body;
    const userRole = req.user.role;

    if (!callsign || !fullName || !faceId) {
      return res.status(400).json({ 
        message: 'Позывной, ФИО и ID лица обязательны' 
      });
    }

    // Проверяем, существует ли сталкер
    const existingStalker = await pool.query(
      'SELECT * FROM stalkers WHERE id = $1',
      [id]
    );

    if (existingStalker.rows.length === 0) {
      return res.status(404).json({ message: 'Сталкер не найден' });
    }

    // Проверяем уникальность позывного и ID лица (исключая текущего сталкера)
    const duplicateCheck = await pool.query(
      'SELECT id FROM stalkers WHERE (callsign = $1 OR face_id = $2) AND id != $3',
      [callsign, faceId, id]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(409).json({ 
        message: 'Сталкер с таким позывным или ID лица уже существует' 
      });
    }

    let photoPath = existingStalker.rows[0].photo_path;

    // Если загружено новое фото, удаляем старое и сохраняем новое
    if (req.file) {
      if (photoPath && fs.existsSync(photoPath)) {
        fs.unlinkSync(photoPath);
      }
      photoPath = req.file.path;
    }

    const result = await pool.query(
      'UPDATE stalkers SET callsign = $1, full_name = $2, face_id = $3, note = $4, photo_path = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6 AND role = $7 RETURNING *',
      [callsign, fullName, faceId, note, photoPath, id, userRole]
    );

    const stalker = result.rows[0];
    stalker.photo = stalker.photo_path ? `/uploads/stalkers/${path.basename(stalker.photo_path)}` : null;

    res.json({
      message: 'Сталкер успешно обновлен',
      stalker
    });

  } catch (error) {
    console.error('Ошибка обновления сталкера:', error);
    res.status(500).json({ message: 'Ошибка обновления сталкера' });
  }
});

// Удалить сталкера
router.delete('/:id', authenticateToken, requireStalkerAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const userRole = req.user.role;

    // Проверяем, существует ли сталкер и принадлежит ли он текущей роли
    const existingStalker = await pool.query(
      'SELECT photo_path FROM stalkers WHERE id = $1 AND role = $2',
      [id, userRole]
    );

    if (existingStalker.rows.length === 0) {
      return res.status(404).json({ message: 'Сталкер не найден' });
    }

    // Удаляем фото, если оно есть
    const photoPath = existingStalker.rows[0].photo_path;
    if (photoPath && fs.existsSync(photoPath)) {
      fs.unlinkSync(photoPath);
    }

    await pool.query('DELETE FROM stalkers WHERE id = $1 AND role = $2', [id, userRole]);

    res.json({ message: 'Сталкер успешно удален' });

  } catch (error) {
    console.error('Ошибка удаления сталкера:', error);
    res.status(500).json({ message: 'Ошибка удаления сталкера' });
  }
});

// Получить все доступные роли для навигации
router.get('/roles/list', authenticateToken, async (req, res) => {
  try {
    const roles = [
      { value: 'Freedom', label: 'Свобода', color: '#00ff00' },
      { value: 'Duty', label: 'Долг', color: '#ff0000' },
      { value: 'Neutral', label: 'Нейтральный', color: '#ffff00' },
      { value: 'Mercenary', label: 'Наемник', color: '#ff6600' },
      { value: 'Monolith', label: 'Монолит', color: '#6600ff' },
      { value: 'Bandit', label: 'Бандит', color: '#ff0066' },
      { value: 'ClearSky', label: 'Чистое небо', color: '#00ffff' },
      { value: 'Loner', label: 'Одиночка', color: '#666666' }
    ];

    res.json({ roles });
  } catch (error) {
    console.error('Ошибка получения ролей:', error);
    res.status(500).json({ message: 'Ошибка получения списка ролей' });
  }
});

// Получить сталкеров конкретной роли (для админов)
router.get('/role/:role', authenticateToken, async (req, res) => {
  try {
    const { role } = req.params;
    const { searchBy, searchTerm } = req.query;
    
    let query = 'SELECT * FROM stalkers WHERE role = $1';
    const params = [role];
    let paramCount = 1;

    if (searchTerm) {
      paramCount++;
      if (searchBy === 'callsign') {
        query += ` AND callsign ILIKE $${paramCount}`;
        params.push(`%${searchTerm}%`);
      } else if (searchBy === 'faceId') {
        query += ` AND face_id ILIKE $${paramCount}`;
        params.push(`%${searchTerm}%`);
      } else if (searchBy === 'fullName') {
        query += ` AND full_name ILIKE $${paramCount}`;
        params.push(`%${searchTerm}%`);
      }
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    
    const stalkers = result.rows.map(stalker => ({
      ...stalker,
      photo: stalker.photo_path ? `/uploads/stalkers/${path.basename(stalker.photo_path)}` : null
    }));

    res.json({
      stalkers,
      total: result.rows.length,
      role
    });

  } catch (error) {
    console.error('Ошибка получения сталкеров роли:', error);
    res.status(500).json({ message: 'Ошибка получения списка сталкеров' });
  }
});

module.exports = router;
