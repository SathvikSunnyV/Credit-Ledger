// server.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');

const { readLoans, addLoan, updateLoan, deleteLoan } = require('./store');
const { calculateDue, daysBetween } = require('./interest');
const { startCron, runDailyCheck } = require('./cron');
const { sendEmail } = require('./brevo');
const {
  manualReminderEmail,
  paymentReceiptEmail,
  loanCreatedEmail,
  loanReopenedEmail,
  loanDeletedEmail,
} = require('./templates');

// Every action on a loan sends mail. This one helper does the actual send + logging
// so each notify* function below just has to build the subject/htmlContent.
// Fire-and-forget from the caller's perspective - errors are logged but never block
// the API response, since the underlying action has already been recorded either way.
async function notify(loan, { subject, htmlContent }, label) {
  try {
    await sendEmail({ toEmail: loan.email, toName: loan.name, subject, htmlContent });
    console.log(`[${label}] Sent email to ${loan.email}`);
  } catch (err) {
    console.error(`[${label}] Failed to send email to ${loan.email}:`, err.message);
  }
}

function notifyLoanCreated(loan) {
  const { subject, htmlContent } = loanCreatedEmail({
    name: loan.name,
    principal: loan.principal,
    monthlyRate: loan.monthlyRate,
    startDate: loan.startDate,
    dueDate: loan.dueDate,
    lenderName: process.env.SENDER_NAME || 'Your Lender',
  });
  return notify(loan, { subject, htmlContent }, 'created');
}

function notifyPaymentReceived(loan, { amountThisPayment, totalPaid, remaining }) {
  const { subject, htmlContent } = paymentReceiptEmail({
    name: loan.name,
    principal: loan.principal,
    monthlyRate: loan.monthlyRate,
    amountThisPayment,
    totalPaid,
    remaining,
    lenderName: process.env.SENDER_NAME || 'Your Lender',
  });
  return notify(loan, { subject, htmlContent }, 'payment');
}

function notifyLoanReopened(loan, remaining) {
  const { subject, htmlContent } = loanReopenedEmail({
    name: loan.name,
    principal: loan.principal,
    monthlyRate: loan.monthlyRate,
    remaining,
    lenderName: process.env.SENDER_NAME || 'Your Lender',
  });
  return notify(loan, { subject, htmlContent }, 'reopened');
}

function notifyLoanDeleted(loan) {
  const { subject, htmlContent } = loanDeletedEmail({
    name: loan.name,
    principal: loan.principal,
    lenderName: process.env.SENDER_NAME || 'Your Lender',
  });
  return notify(loan, { subject, htmlContent }, 'deleted');
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Very simple password check for personal use ---
// The dashboard sends the password in a header on every API request.
function checkPassword(req, res, next) {
  const configured = process.env.DASHBOARD_PASSWORD;
  if (!configured) return next(); // no password set = open (fine for local personal use)
  const given = req.header('x-dashboard-password');
  if (given !== configured) {
    return res.status(401).json({ error: 'Invalid dashboard password' });
  }
  next();
}

// Wraps async route handlers so thrown errors/rejected promises become clean
// 500 responses instead of crashing the server or hanging the request.
function asyncRoute(handler) {
  return (req, res, next) => handler(req, res, next).catch(next);
}

// GET all loans, with live-calculated amounts included
app.get('/api/loans', checkPassword, asyncRoute(async (req, res) => {
  const loans = await readLoans();
  const enriched = loans.map((loan) => {
    const { months, interest, total } = calculateDue(loan.principal, loan.monthlyRate, loan.startDate);
    const paid = loan.amountPaid || 0;
    const remaining = Math.max(0, Math.round((total - paid) * 100) / 100);
    return { ...loan, computed: { months, interest, total, paid, remaining } };
  });
  res.json(enriched);
}));

// POST a new loan entry
app.post('/api/loans', checkPassword, asyncRoute(async (req, res) => {
  const { name, email, principal, monthlyRate, startDate, dueDate } = req.body;

  if (!name || !email || !principal || monthlyRate === undefined || !startDate || !dueDate) {
    return res.status(400).json({ error: 'name, email, principal, monthlyRate, startDate, and dueDate are all required' });
  }
  if (Number(principal) <= 0) {
    return res.status(400).json({ error: 'principal must be greater than 0' });
  }
  if (Number(monthlyRate) < 0) {
    return res.status(400).json({ error: 'monthlyRate cannot be negative' });
  }

  const loan = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    email: String(email).trim(),
    principal: Number(principal),
    monthlyRate: Number(monthlyRate), // percentage per month, e.g. 2 = 2%
    startDate, // YYYY-MM-DD
    dueDate, // YYYY-MM-DD
    status: 'pending',
    amountPaid: 0,
    createdAt: new Date().toISOString(),
  };

  const saved = await addLoan(loan);
  res.status(201).json(saved);

  // Every new entry gets an email confirming the loan terms.
  notifyLoanCreated(saved);
}));

// PATCH - mark as paid / unpaid, or edit fields
app.patch('/api/loans/:id', checkPassword, asyncRoute(async (req, res) => {
  const loans = await readLoans();
  const before = loans.find((l) => l.id === req.params.id);
  if (!before) return res.status(404).json({ error: 'Loan not found' });

  const updated = await updateLoan(req.params.id, req.body);
  res.json(updated);

  // If this update just transitioned the loan from unpaid -> paid, send a receipt email.
  const justPaid = req.body.status === 'paid' && before.status !== 'paid';
  if (justPaid) {
    const { total } = calculateDue(updated.principal, updated.monthlyRate, updated.startDate);
    const totalPaid = updated.amountPaid && updated.amountPaid > 0 ? updated.amountPaid : total;
    notifyPaymentReceived(updated, { amountThisPayment: totalPaid, totalPaid, remaining: 0 });
  }

  // If this update just reopened a previously-paid loan, notify about that too.
  const justReopened = req.body.status && req.body.status !== 'paid' && before.status === 'paid';
  if (justReopened) {
    const { total } = calculateDue(updated.principal, updated.monthlyRate, updated.startDate);
    const remaining = Math.max(0, Math.round((total - (updated.amountPaid || 0)) * 100) / 100);
    notifyLoanReopened(updated, remaining);
  }
}));

// POST record a payment (partial or full) against a loan
app.post('/api/loans/:id/payments', checkPassword, asyncRoute(async (req, res) => {
  const loans = await readLoans();
  const loan = loans.find((l) => l.id === req.params.id);
  if (!loan) return res.status(404).json({ error: 'Loan not found' });

  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }

  const { total } = calculateDue(loan.principal, loan.monthlyRate, loan.startDate);
  const newPaid = Math.round(((loan.amountPaid || 0) + amount) * 100) / 100;
  const remaining = Math.round((total - newPaid) * 100) / 100;

  const updates = {
    amountPaid: newPaid,
    lastPaymentOn: new Date().toISOString().slice(0, 10),
  };
  // Fully covered (or overpaid) -> automatically mark as paid, no manual step needed
  if (remaining <= 0) {
    updates.status = 'paid';
  }

  const updated = await updateLoan(loan.id, updates);
  res.json({ ...updated, computed: { total, paid: newPaid, remaining: Math.max(0, remaining) } });

  // Every recorded transaction gets a receipt email - partial payments show what's
  // still owed, full payoffs confirm the loan is settled.
  notifyPaymentReceived(updated, {
    amountThisPayment: amount,
    totalPaid: newPaid,
    remaining: Math.max(0, remaining),
  });
}));

// POST send an email to this borrower right now, whenever you want, outside the daily automation
app.post('/api/loans/:id/send-email', checkPassword, asyncRoute(async (req, res) => {
  const loans = await readLoans();
  const loan = loans.find((l) => l.id === req.params.id);
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  if (loan.status === 'paid') {
    return res.status(400).json({ error: 'This loan is already marked as paid.' });
  }

  try {
    const today = new Date();
    const { months, interest, total } = calculateDue(loan.principal, loan.monthlyRate, loan.startDate, today);
    const amountPaid = loan.amountPaid || 0;
    const remaining = Math.max(0, Math.round((total - amountPaid) * 100) / 100);
    const daysOverdue = daysBetween(new Date(loan.dueDate), today); // positive = overdue

    const { subject, htmlContent } = manualReminderEmail({
      name: loan.name,
      principal: loan.principal,
      monthlyRate: loan.monthlyRate,
      months,
      interest,
      total,
      amountPaid,
      remaining,
      dueDate: loan.dueDate,
      daysOverdue,
      lenderName: process.env.SENDER_NAME || 'Your Lender',
    });

    await sendEmail({ toEmail: loan.email, toName: loan.name, subject, htmlContent });
    await updateLoan(loan.id, { lastManualEmailOn: new Date().toISOString() });
    res.json({ ok: true, message: `Email sent to ${loan.email}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

// DELETE a loan entry
app.delete('/api/loans/:id', checkPassword, asyncRoute(async (req, res) => {
  const loans = await readLoans();
  const loan = loans.find((l) => l.id === req.params.id);
  if (!loan) return res.status(404).json({ error: 'Loan not found' });

  await deleteLoan(req.params.id);
  res.status(204).end();

  // Every removal gets an email too, so nothing happens silently.
  notifyLoanDeleted(loan);
}));

// Manually trigger the automated check right now (useful for testing)
app.post('/api/run-check', checkPassword, asyncRoute(async (req, res) => {
  await runDailyCheck();
  res.json({ ok: true, message: 'Check completed. See server logs for details.' });
}));

// Catch-all error handler for anything asyncRoute passed through, plus a
// simple health check Render (or you) can hit to confirm the DB connection works.
app.get('/api/health', asyncRoute(async (req, res) => {
  const pool = require('./db');
  await pool.query('SELECT 1');
  res.json({ ok: true, db: 'connected' });
}));

app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Something went wrong' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Loan tracker running at http://localhost:${PORT}`);
  startCron();
});