const express = require('express');
const pool = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { isValidUserRole } = require('../utils/groupings');

const router = express.Router();

const VALID_STATUSES = ['open', 'inwork', 'closed'];

async function assertGroupActor(req) {
  if (req.user.role === 'Admin') {
    return { error: { status: 403, message: 'Администратор не может управлять контрактами от лица группы' } };
  }

  const validRole = await isValidUserRole(req.user.role);
  if (!validRole) {
    return { error: { status: 403, message: 'Ваша группа не может управлять контрактами' } };
  }

  return { role: req.user.role, userId: req.user.id };
}

const mapContract = (row) => ({
  id: row.id,
  title: row.title,
  amount: parseFloat(row.amount),
  goal: row.goal,
  details: row.details || '',
  notes: row.notes || '',
  link: row.link || '',
  status: row.status,
  assignedGroupCode: row.assigned_group_code,
  assignedGroupName: row.assigned_group_name || null,
  assignedByUsername: row.assigned_by_username || null,
  assignedAt: row.assigned_at,
  createdByUsername: row.created_by_username || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const contractSelect = `
  SELECT c.*,
         u_creator.username AS created_by_username,
         u_assign.username AS assigned_by_username,
         g.name AS assigned_group_name
  FROM contracts c
  LEFT JOIN users u_creator ON c.created_by = u_creator.id
  LEFT JOIN users u_assign ON c.assigned_by_user_id = u_assign.id
  LEFT JOIN groupings g ON c.assigned_group_code = g.code
`;

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { status } = req.query;
    let query = `${contractSelect} WHERE 1=1`;
    const params = [];

    if (status && VALID_STATUSES.includes(status)) {
      params.push(status);
      query += ` AND c.status = $${params.length}`;
    }

    query += ' ORDER BY c.created_at DESC';

    const result = await pool.query(query, params);
    res.json({
      contracts: result.rows.map(mapContract),
      total: result.rows.length,
    });
  } catch (error) {
    console.error('Ошибка получения контрактов:', error);
    res.status(500).json({ message: 'Ошибка получения списка контрактов' });
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`${contractSelect} WHERE c.id = $1`, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Контракт не найден' });
    }

    res.json({ contract: mapContract(result.rows[0]) });
  } catch (error) {
    console.error('Ошибка получения контракта:', error);
    res.status(500).json({ message: 'Ошибка получения контракта' });
  }
});

router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { title, amount, goal, details, notes, link } = req.body;

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
      `INSERT INTO contracts
        (title, amount, goal, details, notes, link, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', $7)
       RETURNING *`,
      [
        normalizedTitle,
        amountNum,
        normalizedGoal,
        String(details || '').trim() || null,
        String(notes || '').trim() || null,
        String(link || '').trim() || null,
        req.user.id,
      ]
    );

    const full = await pool.query(`${contractSelect} WHERE c.id = $1`, [result.rows[0].id]);

    res.status(201).json({
      message: 'Контракт создан',
      contract: mapContract(full.rows[0]),
    });
  } catch (error) {
    console.error('Ошибка создания контракта:', error);
    res.status(500).json({ message: 'Ошибка создания контракта' });
  }
});

router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, amount, goal, details, notes, link, status, assignedGroupCode } = req.body;

    const existing = await pool.query('SELECT * FROM contracts WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Контракт не найден' });
    }

    const normalizedTitle = String(title || '').trim();
    const normalizedGoal = String(goal || '').trim();

    if (!normalizedTitle || !normalizedGoal) {
      return res.status(400).json({ message: 'Название и общая цель обязательны' });
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum < 0) {
      return res.status(400).json({ message: 'Сумма должна быть неотрицательным числом' });
    }

    let newStatus = existing.rows[0].status;
    if (status && VALID_STATUSES.includes(status)) {
      newStatus = status;
    }

    let assignedGroup = existing.rows[0].assigned_group_code;
    let assignedBy = existing.rows[0].assigned_by_user_id;
    let assignedAt = existing.rows[0].assigned_at;

    if (assignedGroupCode === null || assignedGroupCode === '') {
      assignedGroup = null;
      assignedBy = null;
      assignedAt = null;
      if (newStatus === 'inwork') {
        newStatus = 'open';
      }
    } else if (assignedGroupCode) {
      const valid = await isValidUserRole(assignedGroupCode);
      if (!valid || assignedGroupCode === 'Admin') {
        return res.status(400).json({ message: 'Некорректная группа для назначения' });
      }
      assignedGroup = assignedGroupCode;
      if (newStatus === 'open') {
        newStatus = 'inwork';
      }
    }

    if (newStatus === 'closed') {
      // keep assignment
    } else if (newStatus === 'open') {
      assignedGroup = null;
      assignedBy = null;
      assignedAt = null;
    }

    await pool.query(
      `UPDATE contracts SET
        title = $1, amount = $2, goal = $3, details = $4, notes = $5, link = $6,
        status = $7, assigned_group_code = $8, assigned_by_user_id = $9,
        assigned_at = $10, updated_at = CURRENT_TIMESTAMP
       WHERE id = $11`,
      [
        normalizedTitle,
        amountNum,
        normalizedGoal,
        String(details || '').trim() || null,
        String(notes || '').trim() || null,
        String(link || '').trim() || null,
        newStatus,
        assignedGroup,
        assignedBy,
        assignedAt,
        id,
      ]
    );

    const full = await pool.query(`${contractSelect} WHERE c.id = $1`, [id]);
    res.json({ message: 'Контракт обновлён', contract: mapContract(full.rows[0]) });
  } catch (error) {
    console.error('Ошибка обновления контракта:', error);
    res.status(500).json({ message: 'Ошибка обновления контракта' });
  }
});

router.post('/:id/take', authenticateToken, async (req, res) => {
  try {
    const actor = await assertGroupActor(req);
    if (actor.error) {
      return res.status(actor.error.status).json({ message: actor.error.message });
    }

    const { id } = req.params;
    const existing = await pool.query('SELECT * FROM contracts WHERE id = $1', [id]);

    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Контракт не найден' });
    }

    const contract = existing.rows[0];

    if (contract.status !== 'open' || contract.assigned_group_code) {
      return res.status(409).json({ message: 'Контракт уже занят или закрыт' });
    }

    await pool.query(
      `UPDATE contracts SET
        status = 'inwork',
        assigned_group_code = $1,
        assigned_by_user_id = $2,
        assigned_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [actor.role, actor.userId, id]
    );

    const full = await pool.query(`${contractSelect} WHERE c.id = $1`, [id]);
    res.json({ message: 'Контракт взят вашей группой', contract: mapContract(full.rows[0]) });
  } catch (error) {
    console.error('Ошибка взятия контракта:', error);
    res.status(500).json({ message: 'Ошибка взятия контракта' });
  }
});

router.post('/:id/complete', authenticateToken, async (req, res) => {
  try {
    const actor = await assertGroupActor(req);
    if (actor.error) {
      return res.status(actor.error.status).json({ message: actor.error.message });
    }

    const { id } = req.params;
    const existing = await pool.query('SELECT * FROM contracts WHERE id = $1', [id]);

    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Контракт не найден' });
    }

    const contract = existing.rows[0];

    if (contract.status !== 'inwork' || contract.assigned_group_code !== actor.role) {
      return res.status(403).json({ message: 'Контракт можно выполнить только вашей группой в статусе «В работе»' });
    }

    await pool.query(
      `UPDATE contracts SET
        status = 'closed',
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id]
    );

    const full = await pool.query(`${contractSelect} WHERE c.id = $1`, [id]);
    res.json({ message: 'Контракт выполнен', contract: mapContract(full.rows[0]) });
  } catch (error) {
    console.error('Ошибка выполнения контракта:', error);
    res.status(500).json({ message: 'Ошибка выполнения контракта' });
  }
});

router.post('/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const actor = await assertGroupActor(req);
    if (actor.error) {
      return res.status(actor.error.status).json({ message: actor.error.message });
    }

    const { id } = req.params;
    const existing = await pool.query('SELECT * FROM contracts WHERE id = $1', [id]);

    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Контракт не найден' });
    }

    const contract = existing.rows[0];

    if (contract.status !== 'inwork' || contract.assigned_group_code !== actor.role) {
      return res.status(403).json({ message: 'Контракт можно отменить только вашей группой в статусе «В работе»' });
    }

    await pool.query(
      `UPDATE contracts SET
        status = 'open',
        assigned_group_code = NULL,
        assigned_by_user_id = NULL,
        assigned_at = NULL,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id]
    );

    const full = await pool.query(`${contractSelect} WHERE c.id = $1`, [id]);
    res.json({ message: 'Контракт отменён и снова открыт', contract: mapContract(full.rows[0]) });
  } catch (error) {
    console.error('Ошибка отмены контракта:', error);
    res.status(500).json({ message: 'Ошибка отмены контракта' });
  }
});

router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM contracts WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Контракт не найден' });
    }

    res.json({ message: 'Контракт удалён' });
  } catch (error) {
    console.error('Ошибка удаления контракта:', error);
    res.status(500).json({ message: 'Ошибка удаления контракта' });
  }
});

module.exports = router;
