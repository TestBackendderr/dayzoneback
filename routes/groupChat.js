const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { isValidUserRole, getGroupingByCode } = require('../utils/groupings');

const router = express.Router();

const CHAT_TITLE = 'КПК — группа';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/group-chat');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'chat-' + uniqueSuffix + path.extname(file.originalname));
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
  message: row.message || '',
  photo: row.photo_path ? `/uploads/group-chat/${path.basename(row.photo_path)}` : null,
  createdAt: row.created_at,
});

async function resolveChatGroup(req, groupCodeParam) {
  if (req.user.role === 'Admin') {
    const code = String(groupCodeParam || '').trim();
    if (!code) {
      return { error: { status: 400, message: 'Укажите группу для чата' } };
    }
    const group = await getGroupingByCode(code);
    if (!group) {
      return { error: { status: 404, message: 'Группа не найдена' } };
    }
    return { groupCode: code, groupName: group.name, isAdmin: true };
  }

  const valid = await isValidUserRole(req.user.role);
  if (!valid) {
    return { error: { status: 403, message: 'Нет доступа к чату группы' } };
  }

  const group = await getGroupingByCode(req.user.role);
  return {
    groupCode: req.user.role,
    groupName: group?.name || req.user.role,
    isAdmin: false,
  };
}

router.get('/', authenticateToken, async (req, res) => {
  try {
    const scope = await resolveChatGroup(req, req.query.groupCode);
    if (scope.error) {
      return res.status(scope.error.status).json({ message: scope.error.message });
    }

    const { after, limit } = req.query;
    let query = `
      SELECT id, group_code, user_id, username, message, photo_path, created_at
      FROM group_chat_messages
      WHERE group_code = $1
    `;
    const params = [scope.groupCode];

    if (after) {
      const afterId = parseInt(after, 10);
      if (!isNaN(afterId)) {
        params.push(afterId);
        query += ` AND id > $${params.length}`;
      }
    }

    query += ' ORDER BY created_at ASC';

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
      groupCode: scope.groupCode,
      groupName: scope.groupName,
      messages: result.rows.map(mapMessage),
      total: result.rows.length,
    });
  } catch (error) {
    console.error('Ошибка получения чата группы:', error);
    res.status(500).json({ message: 'Ошибка загрузки чата' });
  }
});

router.post('/', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
    const scope = await resolveChatGroup(req, req.body.groupCode);
    if (scope.error) {
      return res.status(scope.error.status).json({ message: scope.error.message });
    }

    const message = String(req.body.message || '').trim();
    if (!message && !req.file) {
      return res.status(400).json({ message: 'Введите текст или прикрепите фото' });
    }
    if (message.length > 4000) {
      return res.status(400).json({ message: 'Сообщение слишком длинное' });
    }

    const result = await pool.query(
      `INSERT INTO group_chat_messages (group_code, user_id, username, message, photo_path)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        scope.groupCode,
        req.user.id,
        req.user.username,
        message,
        req.file ? req.file.path : null,
      ]
    );

    res.status(201).json({
      message: 'Сообщение отправлено',
      chatMessage: mapMessage(result.rows[0]),
    });
  } catch (error) {
    console.error('Ошибка отправки сообщения:', error);
    res.status(500).json({ message: 'Ошибка отправки сообщения' });
  }
});

module.exports = router;
