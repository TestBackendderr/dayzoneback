const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { isValidUserRole } = require('../utils/groupings');

const router = express.Router();

const infoSelect = `
  SELECT gi.*, g.name AS group_name
  FROM group_info gi
  LEFT JOIN groupings g ON gi.group_code = g.code
`;

const chatNoteRow = (row) => ({
  id: row.id,
  userId: row.user_id,
  username: row.username,
  message: row.message,
  createdAt: row.created_at,
});

const infoItem = (row, notes = []) => ({
  id: row.id,
  groupCode: row.group_code,
  groupName: row.group_name || row.group_code,
  title: row.title,
  body: row.body || '',
  photo: row.photo_path ? `/uploads/group-info/${path.basename(row.photo_path)}` : null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  notes,
});

async function fetchNotesForItems(infoIds) {
  if (!infoIds.length) return {};

  const result = await pool.query(
    `SELECT id, info_id, user_id, username, message, created_at
     FROM group_info_notes
     WHERE info_id = ANY($1)
     ORDER BY created_at ASC`,
    [infoIds]
  );

  const grouped = {};
  result.rows.forEach((row) => {
    if (!grouped[row.info_id]) grouped[row.info_id] = [];
    grouped[row.info_id].push(chatNoteRow(row));
  });
  return grouped;
}

async function fetchNotes(infoId) {
  const result = await pool.query(
    `SELECT id, info_id, user_id, username, message, created_at
     FROM group_info_notes
     WHERE info_id = $1
     ORDER BY created_at ASC`,
    [infoId]
  );
  return result.rows.map(chatNoteRow);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/group-info');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'info-' + uniqueSuffix + path.extname(file.originalname));
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
    return { error: { status: 403, message: 'Нет доступа к информации группы' } };
  }

  return { isAdmin: false, groupCode: req.user.role };
}

async function getInfoForUser(id, access) {
  const result = await pool.query(`${infoSelect} WHERE gi.id = $1`, [id]);
  if (result.rows.length === 0) {
    return { error: { status: 404, message: 'Запись не найдена' } };
  }

  const item = result.rows[0];
  if (!access.isAdmin && item.group_code !== access.groupCode) {
    return { error: { status: 403, message: 'Нет доступа к этой записи' } };
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
    let query = `${infoSelect} WHERE 1=1`;
    const params = [];

    if (!access.isAdmin) {
      params.push(access.groupCode);
      query += ` AND gi.group_code = $${params.length}`;
    }

    if (searchTerm) {
      params.push(`%${String(searchTerm).trim()}%`);
      query += ` AND (gi.title ILIKE $${params.length} OR gi.body ILIKE $${params.length})`;
    }

    query += ' ORDER BY gi.updated_at DESC';

    const result = await pool.query(query, params);
    const ids = result.rows.map((row) => row.id);
    const notesByItem = await fetchNotesForItems(ids);

    res.json({
      items: result.rows.map((row) => infoItem(row, notesByItem[row.id] || [])),
      total: result.rows.length,
    });
  } catch (error) {
    console.error('Ошибка получения информации:', error);
    res.status(500).json({ message: 'Ошибка получения списка' });
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const access = await resolveGroupAccess(req);
    if (access.error) {
      return res.status(access.error.status).json({ message: access.error.message });
    }

    const found = await getInfoForUser(req.params.id, access);
    if (found.error) {
      return res.status(found.error.status).json({ message: found.error.message });
    }

    const notes = await fetchNotes(req.params.id);
    res.json({ item: infoItem(found.item, notes) });
  } catch (error) {
    console.error('Ошибка получения записи:', error);
    res.status(500).json({ message: 'Ошибка получения записи' });
  }
});

router.post('/', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
    const access = await resolveGroupAccess(req);
    if (access.error) {
      return res.status(access.error.status).json({ message: access.error.message });
    }
    if (access.isAdmin) {
      return res.status(403).json({ message: 'Администратор не создаёт записи' });
    }

    const title = String(req.body.title || '').trim();
    const body = String(req.body.body || '').trim();

    if (!title) {
      return res.status(400).json({ message: 'Название обязательно' });
    }
    if (!body) {
      return res.status(400).json({ message: 'Текст заметки обязателен' });
    }

    const result = await pool.query(
      `INSERT INTO group_info (group_code, title, body, photo_path, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        access.groupCode,
        title,
        body,
        req.file ? req.file.path : null,
        req.user.id,
      ]
    );

    const infoId = result.rows[0].id;
    const full = await pool.query(`${infoSelect} WHERE gi.id = $1`, [infoId]);
    res.status(201).json({ message: 'Запись добавлена', item: infoItem(full.rows[0], []) });
  } catch (error) {
    console.error('Ошибка создания записи:', error);
    res.status(500).json({ message: 'Ошибка создания записи' });
  }
});

router.put('/:id', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
    const access = await resolveGroupAccess(req);
    if (access.error) {
      return res.status(access.error.status).json({ message: access.error.message });
    }
    if (access.isAdmin) {
      return res.status(403).json({ message: 'Администратор не редактирует записи' });
    }

    const found = await getInfoForUser(req.params.id, access);
    if (found.error) {
      return res.status(found.error.status).json({ message: found.error.message });
    }

    const title = String(req.body.title || found.item.title).trim();
    const body = String(req.body.body ?? found.item.body ?? '').trim();

    if (!title) {
      return res.status(400).json({ message: 'Название обязательно' });
    }
    if (!body) {
      return res.status(400).json({ message: 'Текст заметки обязателен' });
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
      `UPDATE group_info SET title = $1, body = $2, photo_path = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
      [title, body, photoPath, req.params.id]
    );

    const full = await pool.query(`${infoSelect} WHERE gi.id = $1`, [req.params.id]);
    const notes = await fetchNotes(req.params.id);
    res.json({ message: 'Запись обновлена', item: infoItem(full.rows[0], notes) });
  } catch (error) {
    console.error('Ошибка обновления записи:', error);
    res.status(500).json({ message: 'Ошибка обновления записи' });
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

    const found = await getInfoForUser(req.params.id, access);
    if (found.error) {
      return res.status(found.error.status).json({ message: found.error.message });
    }

    const message = String(req.body.message || '').trim();
    if (!message) {
      return res.status(400).json({ message: 'Сообщение не может быть пустым' });
    }

    const result = await pool.query(
      `INSERT INTO group_info_notes (info_id, user_id, username, message)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.params.id, req.user.id, req.user.username, message]
    );

    await pool.query(
      'UPDATE group_info SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [req.params.id]
    );

    res.status(201).json({
      message: 'Заметка добавлена',
      note: chatNoteRow(result.rows[0]),
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
      return res.status(403).json({ message: 'Администратор не удаляет записи' });
    }

    const found = await getInfoForUser(req.params.id, access);
    if (found.error) {
      return res.status(found.error.status).json({ message: found.error.message });
    }

    if (found.item.photo_path && fs.existsSync(found.item.photo_path)) {
      fs.unlinkSync(found.item.photo_path);
    }

    await pool.query('DELETE FROM group_info WHERE id = $1', [req.params.id]);
    res.json({ message: 'Запись удалена' });
  } catch (error) {
    console.error('Ошибка удаления записи:', error);
    res.status(500).json({ message: 'Ошибка удаления записи' });
  }
});

module.exports = router;
