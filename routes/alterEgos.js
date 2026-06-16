const express = require('express');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { isValidUserRole } = require('../utils/groupings');

const router = express.Router();

const VALID_STATUSES = ['active', 'inactive'];

const alterEgoSelect = `
  SELECT ae.*, g.name AS group_name
  FROM alter_egos ae
  LEFT JOIN groupings g ON ae.group_code = g.code
`;

const mapAlterEgo = (row) => ({
  id: row.id,
  groupCode: row.group_code,
  groupName: row.group_name || row.group_code,
  realCallsign: row.real_callsign,
  alterEgo: row.alter_ego,
  shortHistory: row.short_history || '',
  status: row.status,
  notes: row.notes || '',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

async function resolveGroupAccess(req) {
  if (req.user.role === 'Admin') {
    return { isAdmin: true, groupCode: null };
  }

  const valid = await isValidUserRole(req.user.role);
  if (!valid) {
    return { error: { status: 403, message: 'Нет доступа к альтерэго группы' } };
  }

  return { isAdmin: false, groupCode: req.user.role };
}

async function getAlterEgoForUser(id, access) {
  const result = await pool.query(`${alterEgoSelect} WHERE ae.id = $1`, [id]);
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

    const { searchBy, searchTerm, status } = req.query;
    let query = `${alterEgoSelect} WHERE 1=1`;
    const params = [];

    if (!access.isAdmin) {
      params.push(access.groupCode);
      query += ` AND ae.group_code = $${params.length}`;
    }

    if (status && VALID_STATUSES.includes(status)) {
      params.push(status);
      query += ` AND ae.status = $${params.length}`;
    }

    if (searchTerm) {
      const term = `%${String(searchTerm).trim()}%`;
      params.push(term);
      if (searchBy === 'alterEgo') {
        query += ` AND ae.alter_ego ILIKE $${params.length}`;
      } else {
        query += ` AND ae.real_callsign ILIKE $${params.length}`;
      }
    }

    query += ' ORDER BY ae.updated_at DESC';

    const result = await pool.query(query, params);
    res.json({
      alterEgos: result.rows.map(mapAlterEgo),
      total: result.rows.length,
    });
  } catch (error) {
    console.error('Ошибка получения альтерэго:', error);
    res.status(500).json({ message: 'Ошибка получения списка альтерэго' });
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const access = await resolveGroupAccess(req);
    if (access.error) {
      return res.status(access.error.status).json({ message: access.error.message });
    }

    const found = await getAlterEgoForUser(req.params.id, access);
    if (found.error) {
      return res.status(found.error.status).json({ message: found.error.message });
    }

    res.json({ alterEgo: mapAlterEgo(found.item) });
  } catch (error) {
    console.error('Ошибка получения альтерэго:', error);
    res.status(500).json({ message: 'Ошибка получения записи' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const access = await resolveGroupAccess(req);
    if (access.error) {
      return res.status(access.error.status).json({ message: access.error.message });
    }
    if (access.isAdmin) {
      return res.status(403).json({ message: 'Администратор не создаёт записи альтерэго' });
    }

    const { realCallsign, alterEgo, shortHistory, status, notes } = req.body;
    const normalizedReal = String(realCallsign || '').trim();
    const normalizedAlter = String(alterEgo || '').trim();

    if (!normalizedReal || !normalizedAlter) {
      return res.status(400).json({ message: 'Реальный позывной и альтерэго обязательны' });
    }

    const newStatus = VALID_STATUSES.includes(status) ? status : 'active';

    const result = await pool.query(
      `INSERT INTO alter_egos
        (group_code, real_callsign, alter_ego, short_history, status, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        access.groupCode,
        normalizedReal,
        normalizedAlter,
        String(shortHistory || '').trim() || null,
        newStatus,
        String(notes || '').trim() || null,
        req.user.id,
      ]
    );

    const full = await pool.query(`${alterEgoSelect} WHERE ae.id = $1`, [result.rows[0].id]);
    res.status(201).json({
      message: 'Альтерэго добавлено',
      alterEgo: mapAlterEgo(full.rows[0]),
    });
  } catch (error) {
    console.error('Ошибка создания альтерэго:', error);
    res.status(500).json({ message: 'Ошибка создания записи' });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const access = await resolveGroupAccess(req);
    if (access.error) {
      return res.status(access.error.status).json({ message: access.error.message });
    }
    if (access.isAdmin) {
      return res.status(403).json({ message: 'Администратор не редактирует альтерэго' });
    }

    const found = await getAlterEgoForUser(req.params.id, access);
    if (found.error) {
      return res.status(found.error.status).json({ message: found.error.message });
    }

    const { realCallsign, alterEgo, shortHistory, status, notes } = req.body;
    const normalizedReal = String(realCallsign || '').trim();
    const normalizedAlter = String(alterEgo || '').trim();

    if (!normalizedReal || !normalizedAlter) {
      return res.status(400).json({ message: 'Реальный позывной и альтерэго обязательны' });
    }

    const newStatus = VALID_STATUSES.includes(status) ? status : found.item.status;

    await pool.query(
      `UPDATE alter_egos SET
        real_callsign = $1, alter_ego = $2, short_history = $3,
        status = $4, notes = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6`,
      [
        normalizedReal,
        normalizedAlter,
        String(shortHistory || '').trim() || null,
        newStatus,
        String(notes || '').trim() || null,
        req.params.id,
      ]
    );

    const full = await pool.query(`${alterEgoSelect} WHERE ae.id = $1`, [req.params.id]);
    res.json({ message: 'Альтерэго обновлено', alterEgo: mapAlterEgo(full.rows[0]) });
  } catch (error) {
    console.error('Ошибка обновления альтерэго:', error);
    res.status(500).json({ message: 'Ошибка обновления записи' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const access = await resolveGroupAccess(req);
    if (access.error) {
      return res.status(access.error.status).json({ message: access.error.message });
    }
    if (access.isAdmin) {
      return res.status(403).json({ message: 'Администратор не удаляет альтерэго' });
    }

    const found = await getAlterEgoForUser(req.params.id, access);
    if (found.error) {
      return res.status(found.error.status).json({ message: found.error.message });
    }

    await pool.query('DELETE FROM alter_egos WHERE id = $1', [req.params.id]);
    res.json({ message: 'Альтерэго удалено' });
  } catch (error) {
    console.error('Ошибка удаления альтерэго:', error);
    res.status(500).json({ message: 'Ошибка удаления записи' });
  }
});

module.exports = router;
