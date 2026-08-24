// store.js
// Same function names/shapes as before (readLoans, addLoan, updateLoan, deleteLoan),
// but now backed by Postgres (Neon) instead of a JSON file. Every function is async now.

const pool = require('./db');

// Maps the camelCase field names used throughout the app to actual DB column names.
const FIELD_MAP = {
  name: 'name',
  email: 'email',
  principal: 'principal',
  monthlyRate: 'monthly_rate',
  startDate: 'start_date',
  dueDate: 'due_date',
  status: 'status',
  amountPaid: 'amount_paid',
  dueReminderSentOn: 'due_reminder_sent_on',
  lastUpcomingReminderOn: 'last_upcoming_reminder_on',
  lastOverdueEmailOn: 'last_overdue_email_on',
  lastComputedTotal: 'last_computed_total',
  lastPaymentOn: 'last_payment_on',
  lastManualEmailOn: 'last_manual_email_on',
};

function toDateStr(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

// Converts a raw Postgres row (snake_case) into the camelCase loan object
// the rest of the app already expects (same shape as the old loans.json entries).
function rowToLoan(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    principal: Number(row.principal),
    monthlyRate: Number(row.monthly_rate),
    startDate: toDateStr(row.start_date),
    dueDate: toDateStr(row.due_date),
    status: row.status,
    amountPaid: Number(row.amount_paid || 0),
    dueReminderSentOn: toDateStr(row.due_reminder_sent_on),
    lastUpcomingReminderOn: toDateStr(row.last_upcoming_reminder_on),
    lastOverdueEmailOn: toDateStr(row.last_overdue_email_on),
    lastComputedTotal: row.last_computed_total !== null ? Number(row.last_computed_total) : null,
    lastPaymentOn: toDateStr(row.last_payment_on),
    lastManualEmailOn: row.last_manual_email_on ? row.last_manual_email_on.toISOString() : null,
    createdAt: row.created_at ? row.created_at.toISOString() : null,
  };
}

async function readLoans() {
  const { rows } = await pool.query('SELECT * FROM loans ORDER BY due_date ASC');
  return rows.map(rowToLoan);
}

async function addLoan(loan) {
  const { rows } = await pool.query(
    `INSERT INTO loans (id, name, email, principal, monthly_rate, start_date, due_date, status, amount_paid, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      loan.id,
      loan.name,
      loan.email,
      loan.principal,
      loan.monthlyRate,
      loan.startDate,
      loan.dueDate,
      loan.status || 'pending',
      loan.amountPaid || 0,
      loan.createdAt || new Date().toISOString(),
    ]
  );
  return rowToLoan(rows[0]);
}

async function updateLoan(id, updates) {
  const keys = Object.keys(updates).filter((k) => FIELD_MAP[k]);

  if (keys.length === 0) {
    const { rows } = await pool.query('SELECT * FROM loans WHERE id = $1', [id]);
    return rowToLoan(rows[0]);
  }

  const setClause = keys.map((key, i) => `${FIELD_MAP[key]} = $${i + 2}`).join(', ');
  const values = keys.map((key) => updates[key]);

  const { rows } = await pool.query(
    `UPDATE loans SET ${setClause} WHERE id = $1 RETURNING *`,
    [id, ...values]
  );
  return rowToLoan(rows[0]); // null if no row matched that id
}

async function deleteLoan(id) {
  const { rowCount } = await pool.query('DELETE FROM loans WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = { readLoans, addLoan, updateLoan, deleteLoan };