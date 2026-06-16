const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { isValidUserRole, getGroupingByCode } = require('../utils/groupings');

const router = express.Router();

const CHAT_TITLE = 'КПК — организации';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/org-chat');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'org-chat-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 5242880 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Разрешены только изображения'), false);
    }
  },
});

const mapMessage = (row) => ({
  id: row.id,
  userId: row.user_id,
  username: row.username,
  authorRole: row.author_role,
  authorGroupName: row.author_group_name || (row.author_role === 'Admin' ? 'Администрация' : row.author_role),
  message: row.message || '',
  photo: row.photo_path ? `/uploads/org-chat/${path.basename(row.photo_path)}` : null,
  createdAt: row.created_at,
});

async function assertOrgChatAccess(req) {
  if (req.user.role === 'Admin') {
    return { ok: true, authorRole: 'Admin' };
  }

  const valid = await isValidUserRole(req.user.role);
  if (!valid) {
    return { error: { status: 403, message: 'Нет доступа к чату организации' } };
  }

  return { ok: true, authorRole: req.user.role };
}

router.get('/', authenticateToken, async (req, res) => {
  try {
    const access = await assertOrgChatAccess(req);
    if (access.error) {
      return res.status(access.error.status).json({ message: access.error.message });
    }

    const { after, limit } = req.query;
    let query = `
      SELECT m.id, m.user_id, m.username, m.author_role, m.message, m.photo_path, m.created_at,
             g.name AS author_group_name
      FROM org_chat_messages m
      LEFT JOIN groupings g ON m.author_role = g.code
      WHERE 1=1
    `;
    const params = [];

    if (after) {
      const afterId = parseInt(after, 10);
      if (!isNaN(afterId)) {
        params.push(afterId);
        query += ` AND m.id > $${params.length}`;
      }
    }

    query += ' ORDER BY m.created_at ASC';

    const limitNum = parseInt(limit, 10);
    if (!isNaN(limitNum) && limitNum > 0) {
      params.push(Math.min(limitNum, 500));
      query += ` LIMIT $${params.length}`;
    } else if (!after) {
      params.push(200);
      query += ` LIMIT $${params.length}`;
    }

    const result = await pool.query(query, params);

    res.json({
      title: CHAT_TITLE,
      messages: result.rows.map(mapMessage),
      total: result.rows.length,
    });
  } catch (error) {
    console.error('Ошибка получения чата организации:', error);
    res.status(500).json({ message: 'Ошибка загрузки чата' });
  }
});

router.post('/', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
    const access = await assertOrgChatAccess(req);
    if (access.error) {
      return res.status(access.error.status).json({ message: access.error.message });
    }

    const message = String(req.body.message || '').trim();
    if (!message && !req.file) {
      return res.status(400).json({ message: 'Введите текст или прикрепите фото' });
    }
    if (message.length > 4000) {
      return res.status(400).json({ message: 'Сообщение слишком длинное' });
    }

    const result = await pool.query(
      `INSERT INTO org_chat_messages (user_id, username, author_role, message, photo_path)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        req.user.id,
        req.user.username,
        access.authorRole,
        message,
        req.file ? req.file.path : null,
      ]
    );

    const full = await pool.query(
      `SELECT m.*, g.name AS author_group_name
       FROM org_chat_messages m
       LEFT JOIN groupings g ON m.author_role = g.code
       WHERE m.id = $1`,
      [result.rows[0].id]
    );

    res.status(201).json({
      message: 'Сообщение отправлено',
      chatMessage: mapMessage(full.rows[0]),
    });
  } catch (error) {
    console.error('Ошибка отправки сообщения:', error);
    res.status(500).json({ message: 'Ошибка отправки сообщения' });
  }
});

module.exports = router;
