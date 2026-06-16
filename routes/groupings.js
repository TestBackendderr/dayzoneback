const express = require('express');
const pool = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { DEFAULT_COLORS } = require('../utils/groupings');

const router = express.Router();

const normalizeCode = (code) => String(code || '').trim();

router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT g.id, g.name, g.code, g.color, g.created_at,
              COUNT(u.id)::int AS users_count
       FROM groupings g
       LEFT JOIN users u ON u.role = g.code
       GROUP BY g.id
       ORDER BY g.name ASC`
    );

    res.json({
      groups: result.rows,
      total: result.rows.length,
    });
  } catch (error) {
    console.error('Ошибка получения групп:', error);
    res.status(500).json({ message: 'Ошибка получения списка групп' });
  }
});

router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, code, color } = req.body;
    const normalizedCode = normalizeCode(code);
    const normalizedName = String(name || '').trim();

    if (!normalizedName || !normalizedCode) {
      return res.status(400).json({ message: 'Название и ID группы обязательны' });
    }

    if (!/^[a-zA-Z0-9_-]{2,50}$/.test(normalizedCode)) {
      return res.status(400).json({
        message: 'ID группы может содержать только латиницу, цифры, _ и - (2-50 символов)',
      });
    }

    const existing = await pool.query(
      'SELECT id FROM groupings WHERE code = $1',
      [normalizedCode]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'Группа с таким ID уже существует' });
    }

    const countResult = await pool.query('SELECT COUNT(*)::int AS count FROM groupings');
    const nextColor = color || DEFAULT_COLORS[countResult.rows[0].count % DEFAULT_COLORS.length];

    const result = await pool.query(
      `INSERT INTO groupings (name, code, color)
       VALUES ($1, $2, $3)
       RETURNING id, name, code, color, created_at`,
      [normalizedName, normalizedCode, nextColor]
    );

    res.status(201).json({
      message: 'Группа успешно создана',
      group: result.rows[0],
    });
  } catch (error) {
    console.error('Ошибка создания группы:', error);
    res.status(500).json({ message: 'Ошибка создания группы' });
  }
});

router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, color } = req.body;
    const normalizedName = String(name || '').trim();

    if (!normalizedName) {
      return res.status(400).json({ message: 'Название группы обязательно' });
    }

    const existing = await pool.query(
      'SELECT id, code FROM groupings WHERE id = $1',
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Группа не найдена' });
    }

    const result = await pool.query(
      `UPDATE groupings
       SET name = $1, color = COALESCE($2, color)
       WHERE id = $3
       RETURNING id, name, code, color, created_at`,
      [normalizedName, color || null, id]
    );

    res.json({
      message: 'Группа успешно обновлена',
      group: result.rows[0],
    });
  } catch (error) {
    console.error('Ошибка обновления группы:', error);
    res.status(500).json({ message: 'Ошибка обновления группы' });
  }
});

router.post('/:id/assign-users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { userIds } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ message: 'Выберите хотя бы одного пользователя' });
    }

    const groupResult = await pool.query(
      'SELECT id, code, name FROM groupings WHERE id = $1',
      [id]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ message: 'Группа не найдена' });
    }

    const group = groupResult.rows[0];

    const result = await pool.query(
      `UPDATE users
       SET role = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ANY($2::int[]) AND role != 'Admin'
       RETURNING id, username, role, created_at`,
      [group.code, userIds]
    );

    res.json({
      message: `Пользователи добавлены в группу "${group.name}"`,
      users: result.rows,
      group,
    });
  } catch (error) {
    console.error('Ошибка назначения пользователей в группу:', error);
    res.status(500).json({ message: 'Ошибка назначения пользователей в группу' });
  }
});

router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await pool.query(
      'SELECT id, code, name FROM groupings WHERE id = $1',
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Группа не найдена' });
    }

    const group = existing.rows[0];

    const usersInGroup = await pool.query(
      'SELECT COUNT(*)::int AS count FROM users WHERE role = $1',
      [group.code]
    );

    if (usersInGroup.rows[0].count > 0) {
      return res.status(400).json({
        message: 'Нельзя удалить группу, в которой есть пользователи',
      });
    }

    await pool.query('DELETE FROM groupings WHERE id = $1', [id]);

    res.json({ message: 'Группа успешно удалена' });
  } catch (error) {
    console.error('Ошибка удаления группы:', error);
    res.status(500).json({ message: 'Ошибка удаления группы' });
  }
});

module.exports = router;
