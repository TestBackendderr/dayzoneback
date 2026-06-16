const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { isValidUserRole } = require('../utils/groupings');

const router = express.Router();

const mapSelect = `
  SELECT gm.*, g.name AS group_name
  FROM group_maps gm
  LEFT JOIN groupings g ON gm.group_code = g.code
`;

const mapNoteRow = (row) => ({
  id: row.id,
  userId: row.user_id,
  username: row.username,
  message: row.message,
  createdAt: row.created_at,
});

const mapItem = (row, notes = []) => ({
  id: row.id,
  groupCode: row.group_code,
  groupName: row.group_name || row.group_code,
  title: row.title,
  photo: row.photo_path ? `/uploads/group-maps/${path.basename(row.photo_path)}` : null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  notes,
});

async function fetchNotesForMaps(mapIds) {
  if (!mapIds.length) return {};

  const result = await pool.query(
    `SELECT id, map_id, user_id, username, message, created_at
     FROM group_map_notes
     WHERE map_id = ANY($1)
     ORDER BY created_at ASC`,
    [mapIds]
  );

  const grouped = {};
  result.rows.forEach((row) => {
    if (!grouped[row.map_id]) grouped[row.map_id] = [];
    grouped[row.map_id].push(mapNoteRow(row));
  });
  return grouped;
}

async function fetchNotes(mapId) {
  const result = await pool.query(
    `SELECT id, map_id, user_id, username, message, created_at
     FROM group_map_notes
     WHERE map_id = $1
     ORDER BY created_at ASC`,
    [mapId]
  );
  return result.rows.map(mapNoteRow);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/group-maps');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'map-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 10485760 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Разрешены только изображения'), false);
    }
  },
});

async function resolveGroupAccess(req) {
  if (req.user.role === 'Admin') {
    return { isAdmin: true, groupCode: null };
  }

  const valid = await isValidUserRole(req.user.role);
  if (!valid) {
    return { error: { status: 403, message: 'Нет доступа к картам группы' } };
  }

  return { isAdmin: false, groupCode: req.user.role };
}

async function getMapForUser(id, access) {
  const result = await pool.query(`${mapSelect} WHERE gm.id = $1`, [id]);
  if (result.rows.length === 0) {
    return { error: { status: 404, message: 'Карта не найдена' } };
  }

  const item = result.rows[0];
  if (!access.isAdmin && item.group_code !== access.groupCode) {
    return { error: { status: 403, message: 'Нет доступа к этой карте' } };
  }

  return { item };
}

router.get('/', authenticateToken, async (req, res) => {
  try {
    const access = await resolveGroupAccess(req);
    if (access.error) {
      return res.status(access.error.status).json({ message: access.error.message });
    }

    const { searchTerm } = req.query;
    let query = `${mapSelect} WHERE 1=1`;
    const params = [];

    if (!access.isAdmin) {
      params.push(access.groupCode);
      query += ` AND gm.group_code = $${params.length}`;
    }

    if (searchTerm) {
      params.push(`%${String(searchTerm).trim()}%`);
      query += ` AND gm.title ILIKE $${params.length}`;
    }

    query += ' ORDER BY gm.updated_at DESC';

    const result = await pool.query(query, params);
    const mapIds = result.rows.map((row) => row.id);
    const notesByMap = await fetchNotesForMaps(mapIds);

    res.json({
      maps: result.rows.map((row) => mapItem(row, notesByMap[row.id] || [])),
      total: result.rows.length,
    });
  } catch (error) {
    console.error('Ошибка получения карт:', error);
    res.status(500).json({ message: 'Ошибка получения списка карт' });
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const access = await resolveGroupAccess(req);
    if (access.error) {
      return res.status(access.error.status).json({ message: access.error.message });
    }

    const found = await getMapForUser(req.params.id, access);
    if (found.error) {
      return res.status(found.error.status).json({ message: found.error.message });
    }

    const notes = await fetchNotes(req.params.id);
    res.json({ map: mapItem(found.item, notes) });
  } catch (error) {
    console.error('Ошибка получения карты:', error);
    res.status(500).json({ message: 'Ошибка получения карты' });
  }
});

router.post('/', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
    const access = await resolveGroupAccess(req);
    if (access.error) {
      return res.status(access.error.status).json({ message: access.error.message });
    }
    if (access.isAdmin) {
      return res.status(403).json({ message: 'Администратор не загружает карты' });
    }

    const title = String(req.body.title || '').trim();
    if (!title) {
      return res.status(400).json({ message: 'Название карты обязательно' });
    }
    if (!req.file) {
      return res.status(400).json({ message: 'Фото карты обязательно' });
    }

    const result = await pool.query(
      `INSERT INTO group_maps (group_code, title, photo_path, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [access.groupCode, title, req.file.path, req.user.id]
    );

    const mapId = result.rows[0].id;
    const initialNote = String(req.body.initialNote || req.body.notes || '').trim();
    if (initialNote) {
      await pool.query(
        `INSERT INTO group_map_notes (map_id, user_id, username, message)
         VALUES ($1, $2, $3, $4)`,
        [mapId, req.user.id, req.user.username, initialNote]
      );
    }

    const full = await pool.query(`${mapSelect} WHERE gm.id = $1`, [mapId]);
    const notes = await fetchNotes(mapId);
    res.status(201).json({ message: 'Карта добавлена', map: mapItem(full.rows[0], notes) });
  } catch (error) {
    console.error('Ошибка создания карты:', error);
    res.status(500).json({ message: 'Ошибка загрузки карты' });
  }
});

router.put('/:id', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
    const access = await resolveGroupAccess(req);
    if (access.error) {
      return res.status(access.error.status).json({ message: access.error.message });
    }
    if (access.isAdmin) {
      return res.status(403).json({ message: 'Администратор не редактирует карты' });
    }

    const found = await getMapForUser(req.params.id, access);
    if (found.error) {
      return res.status(found.error.status).json({ message: found.error.message });
    }

    const title = String(req.body.title || found.item.title).trim();
    if (!title) {
      return res.status(400).json({ message: 'Название карты обязательно' });
    }

    let photoPath = found.item.photo_path;
    if (req.file) {
      if (photoPath && fs.existsSync(photoPath)) {
        fs.unlinkSync(photoPath);
      }
      photoPath = req.file.path;
    } else if (req.body.removePhoto === 'true' || req.body.removePhoto === true) {
      if (photoPath && fs.existsSync(photoPath)) {
        fs.unlinkSync(photoPath);
      }
      photoPath = null;
    }

    await pool.query(
      `UPDATE group_maps SET title = $1, photo_path = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
      [title, photoPath, req.params.id]
    );

    const full = await pool.query(`${mapSelect} WHERE gm.id = $1`, [req.params.id]);
    const notes = await fetchNotes(req.params.id);
    res.json({ message: 'Карта обновлена', map: mapItem(full.rows[0], notes) });
  } catch (error) {
    console.error('Ошибка обновления карты:', error);
    res.status(500).json({ message: 'Ошибка обновления карты' });
  }
});

router.post('/:id/notes', authenticateToken, async (req, res) => {
  try {
    const access = await resolveGroupAccess(req);
    if (access.error) {
      return res.status(access.error.status).json({ message: access.error.message });
    }
    if (access.isAdmin) {
      return res.status(403).json({ message: 'Администратор не может добавлять заметки' });
    }

    const found = await getMapForUser(req.params.id, access);
    if (found.error) {
      return res.status(found.error.status).json({ message: found.error.message });
    }

    const message = String(req.body.message || '').trim();
    if (!message) {
      return res.status(400).json({ message: 'Сообщение не может быть пустым' });
    }

    const result = await pool.query(
      `INSERT INTO group_map_notes (map_id, user_id, username, message)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.params.id, req.user.id, req.user.username, message]
    );

    await pool.query(
      'UPDATE group_maps SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [req.params.id]
    );

    res.status(201).json({
      message: 'Заметка добавлена',
      note: mapNoteRow(result.rows[0]),
    });
  } catch (error) {
    console.error('Ошибка добавления заметки:', error);
    res.status(500).json({ message: 'Ошибка добавления заметки' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const access = await resolveGroupAccess(req);
    if (access.error) {
      return res.status(access.error.status).json({ message: access.error.message });
    }
    if (access.isAdmin) {
      return res.status(403).json({ message: 'Администратор не удаляет карты' });
    }

    const found = await getMapForUser(req.params.id, access);
    if (found.error) {
      return res.status(found.error.status).json({ message: found.error.message });
    }

    if (found.item.photo_path && fs.existsSync(found.item.photo_path)) {
      fs.unlinkSync(found.item.photo_path);
    }

    await pool.query('DELETE FROM group_maps WHERE id = $1', [req.params.id]);
    res.json({ message: 'Карта удалена' });
  } catch (error) {
    console.error('Ошибка удаления карты:', error);
    res.status(500).json({ message: 'Ошибка удаления карты' });
  }
});

module.exports = router;
