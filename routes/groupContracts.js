const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { isValidUserRole } = require('../utils/groupings');

const router = express.Router();

const VALID_STATUSES = ['active', 'completed', 'cancelled'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/group-contracts');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'gc-' + uniqueSuffix + path.extname(file.originalname));
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

const contractSelect = `
  SELECT gc.*,
         u.username AS created_by_username,
         g.name AS group_name
  FROM group_contracts gc
  LEFT JOIN users u ON gc.created_by = u.id
  LEFT JOIN groupings g ON gc.group_code = g.code
`;

const mapContract = (row, notes = []) => ({
  id: row.id,
  groupCode: row.group_code,
  groupName: row.group_name || row.group_code,
  title: row.title,
  amount: parseFloat(row.amount),
  goal: row.goal,
  details: row.details || '',
  docxLink: row.docx_link || '',
  photo: row.photo_path ? `/uploads/group-contracts/${path.basename(row.photo_path)}` : null,
  status: row.status,
  createdByUsername: row.created_by_username || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  notes,
});

async function fetchNotes(contractId) {
  const result = await pool.query(
    `SELECT id, contract_id, user_id, username, message, created_at
     FROM group_contract_notes
     WHERE contract_id = $1
     ORDER BY created_at ASC`,
    [contractId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    username: row.username,
    message: row.message,
    createdAt: row.created_at,
  }));
}

async function resolveGroupAccess(req) {
  if (req.user.role === 'Admin') {
    return { isAdmin: true, groupCode: null };
  }

  const valid = await isValidUserRole(req.user.role);
  if (!valid) {
    return { error: { status: 403, message: 'Ваша группа не имеет доступа к контрактам' } };
  }

  return { isAdmin: false, groupCode: req.user.role };
}

async function getContractForUser(id, access) {
  const result = await pool.query(`${contractSelect} WHERE gc.id = $1`, [id]);
  if (result.rows.length === 0) {
    return { error: { status: 404, message: 'Контракт не найден' } };
  }

  const contract = result.rows[0];
  if (!access.isAdmin && contract.group_code !== access.groupCode) {
    return { error: { status: 403, message: 'Нет доступа к этому контракту' } };
  }

  return { contract };
}

router.get('/', authenticateToken, async (req, res) => {
  try {
    const access = await resolveGroupAccess(req);
    if (access.error) {
      return res.status(access.error.status).json({ message: access.error.message });
    }

    const { status } = req.query;
    let query = `${contractSelect} WHERE 1=1`;
    const params = [];

    if (!access.isAdmin) {
      params.push(access.groupCode);
      query += ` AND gc.group_code = $${params.length}`;
    }

    if (status && VALID_STATUSES.includes(status)) {
      params.push(status);
      query += ` AND gc.status = $${params.length}`;
    }

    query += ' ORDER BY gc.updated_at DESC';

    const result = await pool.query(query, params);
    res.json({
      contracts: result.rows.map((row) => mapContract(row)),
      total: result.rows.length,
    });
  } catch (error) {
    console.error('Ошибка получения контрактов группы:', error);
    res.status(500).json({ message: 'Ошибка получения контрактов группы' });
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const access = await resolveGroupAccess(req);
    if (access.error) {
      return res.status(access.error.status).json({ message: access.error.message });
    }

    const { id } = req.params;
    const found = await getContractForUser(id, access);
    if (found.error) {
      return res.status(found.error.status).json({ message: found.error.message });
    }

    const notes = await fetchNotes(id);
    res.json({ contract: mapContract(found.contract, notes) });
  } catch (error) {
    console.error('Ошибка получения контракта группы:', error);
    res.status(500).json({ message: 'Ошибка получения контракта' });
  }
});

router.post('/', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
    const access = await resolveGroupAccess(req);
    if (access.error) {
      return res.status(access.error.status).json({ message: access.error.message });
    }
    if (access.isAdmin) {
      return res.status(403).json({ message: 'Администратор не создаёт контракты группы' });
    }

    const { title, amount, goal, details, docxLink } = req.body;
    const normalizedTitle = String(title || '').trim();
    const normalizedGoal = String(goal || '').trim();

    if (!normalizedTitle || !normalizedGoal) {
      return res.status(400).json({ message: 'Название и общая цель обязательны' });
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum < 0) {
      return res.status(400).json({ message: 'Сумма должна быть неотрицательным числом' });
    }

    const result = await pool.query(
      `INSERT INTO group_contracts
        (group_code, title, amount, goal, details, docx_link, photo_path, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8)
       RETURNING id`,
      [
        access.groupCode,
        normalizedTitle,
        amountNum,
        normalizedGoal,
        String(details || '').trim() || null,
        String(docxLink || '').trim() || null,
        req.file ? req.file.path : null,
        req.user.id,
      ]
    );

    const full = await pool.query(`${contractSelect} WHERE gc.id = $1`, [result.rows[0].id]);
    res.status(201).json({
      message: 'Контракт группы создан',
      contract: mapContract(full.rows[0]),
    });
  } catch (error) {
    console.error('Ошибка создания контракта группы:', error);
    res.status(500).json({ message: 'Ошибка создания контракта' });
  }
});

router.put('/:id', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
    const access = await resolveGroupAccess(req);
    if (access.error) {
      return res.status(access.error.status).json({ message: access.error.message });
    }
    if (access.isAdmin) {
      return res.status(403).json({ message: 'Администратор не редактирует контракты группы' });
    }

    const { id } = req.params;
    const found = await getContractForUser(id, access);
    if (found.error) {
      return res.status(found.error.status).json({ message: found.error.message });
    }

    if (found.contract.status !== 'active') {
      return res.status(409).json({ message: 'Редактировать можно только активные контракты' });
    }

    const { title, amount, goal, details, docxLink, removePhoto } = req.body;
    const normalizedTitle = String(title || '').trim();
    const normalizedGoal = String(goal || '').trim();

    if (!normalizedTitle || !normalizedGoal) {
      return res.status(400).json({ message: 'Название и общая цель обязательны' });
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum < 0) {
      return res.status(400).json({ message: 'Сумма должна быть неотрицательным числом' });
    }

    let photoPath = found.contract.photo_path;
    if (req.file) {
      if (photoPath && fs.existsSync(photoPath)) {
        fs.unlinkSync(photoPath);
      }
      photoPath = req.file.path;
    } else if (removePhoto === 'true' || removePhoto === true) {
      if (photoPath && fs.existsSync(photoPath)) {
        fs.unlinkSync(photoPath);
      }
      photoPath = null;
    }

    await pool.query(
      `UPDATE group_contracts SET
        title = $1, amount = $2, goal = $3, details = $4, docx_link = $5,
        photo_path = $6, updated_at = CURRENT_TIMESTAMP
       WHERE id = $7`,
      [
        normalizedTitle,
        amountNum,
        normalizedGoal,
        String(details || '').trim() || null,
        String(docxLink || '').trim() || null,
        photoPath,
        id,
      ]
    );

    const full = await pool.query(`${contractSelect} WHERE gc.id = $1`, [id]);
    const notes = await fetchNotes(id);
    res.json({ message: 'Контракт обновлён', contract: mapContract(full.rows[0], notes) });
  } catch (error) {
    console.error('Ошибка обновления контракта группы:', error);
    res.status(500).json({ message: 'Ошибка обновления контракта' });
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

    const { id } = req.params;
    const found = await getContractForUser(id, access);
    if (found.error) {
      return res.status(found.error.status).json({ message: found.error.message });
    }

    const message = String(req.body.message || '').trim();
    if (!message) {
      return res.status(400).json({ message: 'Сообщение не может быть пустым' });
    }

    const result = await pool.query(
      `INSERT INTO group_contract_notes (contract_id, user_id, username, message)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, req.user.id, req.user.username, message]
    );

    await pool.query(
      'UPDATE group_contracts SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id]
    );

    const note = result.rows[0];
    res.status(201).json({
      message: 'Заметка добавлена',
      note: {
        id: note.id,
        userId: note.user_id,
        username: note.username,
        message: note.message,
        createdAt: note.created_at,
      },
    });
  } catch (error) {
    console.error('Ошибка добавления заметки:', error);
    res.status(500).json({ message: 'Ошибка добавления заметки' });
  }
});

router.post('/:id/complete', authenticateToken, async (req, res) => {
  try {
    const access = await resolveGroupAccess(req);
    if (access.error) {
      return res.status(access.error.status).json({ message: access.error.message });
    }
    if (access.isAdmin) {
      return res.status(403).json({ message: 'Администратор не управляет контрактами группы' });
    }

    const { id } = req.params;
    const found = await getContractForUser(id, access);
    if (found.error) {
      return res.status(found.error.status).json({ message: found.error.message });
    }

    if (found.contract.status !== 'active') {
      return res.status(409).json({ message: 'Контракт уже завершён или отменён' });
    }

    await pool.query(
      `UPDATE group_contracts SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id]
    );

    const full = await pool.query(`${contractSelect} WHERE gc.id = $1`, [id]);
    const notes = await fetchNotes(id);
    res.json({ message: 'Контракт выполнен', contract: mapContract(full.rows[0], notes) });
  } catch (error) {
    console.error('Ошибка выполнения контракта группы:', error);
    res.status(500).json({ message: 'Ошибка выполнения контракта' });
  }
});

router.post('/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const access = await resolveGroupAccess(req);
    if (access.error) {
      return res.status(access.error.status).json({ message: access.error.message });
    }
    if (access.isAdmin) {
      return res.status(403).json({ message: 'Администратор не управляет контрактами группы' });
    }

    const { id } = req.params;
    const found = await getContractForUser(id, access);
    if (found.error) {
      return res.status(found.error.status).json({ message: found.error.message });
    }

    if (found.contract.status !== 'active') {
      return res.status(409).json({ message: 'Контракт уже завершён или отменён' });
    }

    await pool.query(
      `UPDATE group_contracts SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id]
    );

    const full = await pool.query(`${contractSelect} WHERE gc.id = $1`, [id]);
    const notes = await fetchNotes(id);
    res.json({ message: 'Контракт отменён', contract: mapContract(full.rows[0], notes) });
  } catch (error) {
    console.error('Ошибка отмены контракта группы:', error);
    res.status(500).json({ message: 'Ошибка отмены контракта' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const access = await resolveGroupAccess(req);
    if (access.error) {
      return res.status(access.error.status).json({ message: access.error.message });
    }
    if (access.isAdmin) {
      return res.status(403).json({ message: 'Администратор не удаляет контракты группы' });
    }

    const { id } = req.params;
    const found = await getContractForUser(id, access);
    if (found.error) {
      return res.status(found.error.status).json({ message: found.error.message });
    }

    if (found.contract.photo_path && fs.existsSync(found.contract.photo_path)) {
      fs.unlinkSync(found.contract.photo_path);
    }

    await pool.query('DELETE FROM group_contracts WHERE id = $1', [id]);
    res.json({ message: 'Контракт удалён' });
  } catch (error) {
    console.error('Ошибка удаления контракта группы:', error);
    res.status(500).json({ message: 'Ошибка удаления контракта' });
  }
});

module.exports = router;
