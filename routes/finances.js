const express = require('express');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Получить все финансовые операции текущего пользователя
router.get('/operations', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, type, currency } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT fo.*, u.username 
      FROM financial_operations fo
      JOIN users u ON fo.user_id = u.id
      WHERE fo.user_id = $1
    `;
    const params = [req.user.id];
    let paramCount = 1;

    // Фильтрация по типу операции
    if (type && (type === '+' || type === '-')) {
      paramCount++;
      query += ` AND fo.operation_type = $${paramCount}`;
      params.push(type);
    }

    // Фильтрация по валюте
    if (currency) {
      paramCount++;
      query += ` AND fo.currency = $${paramCount}`;
      params.push(currency);
    }

    query += ` ORDER BY fo.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Получаем общее количество операций для пагинации
    let countQuery = 'SELECT COUNT(*) FROM financial_operations WHERE user_id = $1';
    const countParams = [req.user.id];
    let countParamCount = 1;

    if (type && (type === '+' || type === '-')) {
      countParamCount++;
      countQuery += ` AND operation_type = $${countParamCount}`;
      countParams.push(type);
    }

    if (currency) {
      countParamCount++;
      countQuery += ` AND currency = $${countParamCount}`;
      countParams.push(currency);
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      operations: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Ошибка получения финансовых операций:', error);
    res.status(500).json({ message: 'Ошибка получения финансовых операций' });
  }
});

// Получить баланс текущего пользователя
router.get('/balance', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        currency,
        SUM(CASE WHEN operation_type = '+' THEN amount ELSE 0 END) as income,
        SUM(CASE WHEN operation_type = '-' THEN amount ELSE 0 END) as expense,
        SUM(CASE WHEN operation_type = '+' THEN amount ELSE -amount END) as balance
      FROM financial_operations 
      WHERE user_id = $1
      GROUP BY currency
      ORDER BY currency
    `, [req.user.id]);

    const balances = result.rows.map(row => ({
      currency: row.currency,
      income: parseFloat(row.income) || 0,
      expense: parseFloat(row.expense) || 0,
      balance: parseFloat(row.balance) || 0
    }));

    res.json({ balances });

  } catch (error) {
    console.error('Ошибка получения баланса:', error);
    res.status(500).json({ message: 'Ошибка получения баланса' });
  }
});

// Добавить новую финансовую операцию
router.post('/operations', authenticateToken, async (req, res) => {
  try {
    const { stalkerLogin, operationType, amount, currency, source } = req.body;

    // Валидация данных
    if (!stalkerLogin || !operationType || !amount || !currency || !source) {
      return res.status(400).json({ 
        message: 'Все поля обязательны для заполнения' 
      });
    }

    if (operationType !== '+' && operationType !== '-') {
      return res.status(400).json({ 
        message: 'Тип операции должен быть "+" или "-"' 
      });
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({ 
        message: 'Сумма должна быть положительным числом' 
      });
    }

    if (!['рубли', '$', 'евро'].includes(currency)) {
      return res.status(400).json({ 
        message: 'Поддерживаются валюты: рубли, $, евро' 
      });
    }

    // Создаем финансовую операцию
    const result = await pool.query(
      `INSERT INTO financial_operations 
       (user_id, stalker_login, operation_type, amount, currency, source) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [req.user.id, stalkerLogin, operationType, amountNum, currency, source]
    );

    const operation = result.rows[0];

    res.status(201).json({
      message: 'Финансовая операция успешно добавлена',
      operation
    });

  } catch (error) {
    console.error('Ошибка создания финансовой операции:', error);
    res.status(500).json({ message: 'Ошибка создания финансовой операции' });
  }
});

// Получить операцию по ID
router.get('/operations/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT fo.*, u.username 
       FROM financial_operations fo
       JOIN users u ON fo.user_id = u.id
       WHERE fo.id = $1 AND fo.user_id = $2`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Операция не найдена' });
    }

    res.json({ operation: result.rows[0] });

  } catch (error) {
    console.error('Ошибка получения операции:', error);
    res.status(500).json({ message: 'Ошибка получения операции' });
  }
});

// Обновить финансовую операцию
router.put('/operations/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { stalkerLogin, operationType, amount, currency, source } = req.body;

    // Проверяем, существует ли операция и принадлежит ли она пользователю
    const existingOperation = await pool.query(
      'SELECT * FROM financial_operations WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (existingOperation.rows.length === 0) {
      return res.status(404).json({ message: 'Операция не найдена' });
    }

    // Валидация данных
    if (!stalkerLogin || !operationType || !amount || !currency || !source) {
      return res.status(400).json({ 
        message: 'Все поля обязательны для заполнения' 
      });
    }

    if (operationType !== '+' && operationType !== '-') {
      return res.status(400).json({ 
        message: 'Тип операции должен быть "+" или "-"' 
      });
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({ 
        message: 'Сумма должна быть положительным числом' 
      });
    }

    if (!['рубли', '$', 'евро'].includes(currency)) {
      return res.status(400).json({ 
        message: 'Поддерживаются валюты: рубли, $, евро' 
      });
    }

    // Обновляем операцию
    const result = await pool.query(
      `UPDATE financial_operations 
       SET stalker_login = $1, operation_type = $2, amount = $3, currency = $4, source = $5
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [stalkerLogin, operationType, amountNum, currency, source, id, req.user.id]
    );

    res.json({
      message: 'Операция успешно обновлена',
      operation: result.rows[0]
    });

  } catch (error) {
    console.error('Ошибка обновления операции:', error);
    res.status(500).json({ message: 'Ошибка обновления операции' });
  }
});

// Удалить финансовую операцию
router.delete('/operations/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Проверяем, существует ли операция и принадлежит ли она пользователю
    const existingOperation = await pool.query(
      'SELECT * FROM financial_operations WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (existingOperation.rows.length === 0) {
      return res.status(404).json({ message: 'Операция не найдена' });
    }

    await pool.query(
      'DELETE FROM financial_operations WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    res.json({ message: 'Операция успешно удалена' });

  } catch (error) {
    console.error('Ошибка удаления операции:', error);
    res.status(500).json({ message: 'Ошибка удаления операции' });
  }
});

// Получить статистику по операциям
router.get('/statistics', authenticateToken, async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    
    let dateFilter = '';
    if (period === 'week') {
      dateFilter = 'AND fo.created_at >= NOW() - INTERVAL \'7 days\'';
    } else if (period === 'month') {
      dateFilter = 'AND fo.created_at >= NOW() - INTERVAL \'30 days\'';
    } else if (period === 'year') {
      dateFilter = 'AND fo.created_at >= NOW() - INTERVAL \'365 days\'';
    }

    const result = await pool.query(`
      SELECT 
        fo.currency,
        fo.operation_type,
        COUNT(*) as count,
        SUM(fo.amount) as total_amount,
        AVG(fo.amount) as avg_amount
      FROM financial_operations fo
      WHERE fo.user_id = $1 ${dateFilter}
      GROUP BY fo.currency, fo.operation_type
      ORDER BY fo.currency, fo.operation_type
    `, [req.user.id]);

    const statistics = result.rows.map(row => ({
      currency: row.currency,
      operationType: row.operation_type,
      count: parseInt(row.count),
      totalAmount: parseFloat(row.total_amount),
      averageAmount: parseFloat(row.avg_amount)
    }));

    res.json({ statistics, period });

  } catch (error) {
    console.error('Ошибка получения статистики:', error);
    res.status(500).json({ message: 'Ошибка получения статистики' });
  }
});

module.exports = router;
