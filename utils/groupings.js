const pool = require('../config/database');

const ADMIN_ROLE = 'Admin';

const DEFAULT_COLORS = [
  '#ff6600', '#00ff00', '#ff0000', '#ffff00', '#6600ff',
  '#00ffff', '#ff0066', '#666666', '#ff9900', '#3399ff',
];

async function getGroupingsAsRoles() {
  const result = await pool.query(
    'SELECT id, name, code, color FROM groupings ORDER BY name ASC'
  );

  return result.rows.map((group, index) => ({
    id: group.id,
    value: group.code,
    label: group.name,
    color: group.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length],
  }));
}

async function isValidUserRole(role) {
  if (role === ADMIN_ROLE) {
    return true;
  }

  const result = await pool.query(
    'SELECT id FROM groupings WHERE code = $1',
    [role]
  );

  return result.rows.length > 0;
}

async function getGroupingByCode(code) {
  const result = await pool.query(
    'SELECT id, name, code, color, created_at FROM groupings WHERE code = $1',
    [code]
  );

  return result.rows[0] || null;
}

module.exports = {
  ADMIN_ROLE,
  DEFAULT_COLORS,
  getGroupingsAsRoles,
  isValidUserRole,
  getGroupingByCode,
};
