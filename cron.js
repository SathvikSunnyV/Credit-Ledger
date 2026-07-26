// cron.js
// This is the "automation" part. Once a day it looks at every loan stored in
// Postgres and decides, on its own, whether to send a "due today" email or an
// "overdue" email. You never have to manually trigger anything - just keep the server running.

const cron = require('node-cron');
const { readLoans, updateLoan } = require('./store');
const { calculateDue, daysBetween } = require('./interest');
const { sendEmail } = require('./brevo');
const { dueTodayEmail, overdueEmail } = require('./templates');

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function runDailyCheck() {
  console.log(`[cron] Running daily loan check at ${new Date().toISOString()}`);
  const loans = await readLoans();
  const today = new Date();
  const lenderName = process.env.SENDER_NAME || 'Your Lender';
  const overdueGapDays = Number(process.env.OVERDUE_REMINDER_GAP_DAYS || 3);

  for (const loan of loans) {
    if (loan.status === 'paid') continue;

    const dueDate = new Date(loan.dueDate);
    const diffDays = daysBetween(dueDate, today); // negative = before due date, 0 = today, positive = overdue
    const amountPaid = loan.amountPaid || 0;

    try {
      // If earlier partial payments already cover what's owed, close it out and move on.
      const precheck = calculateDue(loan.principal, loan.monthlyRate, loan.startDate, today);
      if (precheck.total - amountPaid <= 0) {
        await updateLoan(loan.id, { status: 'paid' });
        continue;
      }

      if (diffDays === 0 && loan.dueReminderSentOn !== todayStr()) {
        // Due exactly today
        const { months, interest, total } = precheck;
        const remaining = Math.round((total - amountPaid) * 100) / 100;
        const { subject, htmlContent } = dueTodayEmail({
          name: loan.name,
          principal: loan.principal,
          monthlyRate: loan.monthlyRate,
          months,
          interest,
          total,
          amountPaid,
          remaining,
          dueDate: loan.dueDate,
          lenderName,
        });
        await sendEmail({ toEmail: loan.email, toName: loan.name, subject, htmlContent });
        await updateLoan(loan.id, { dueReminderSentOn: todayStr(), lastComputedTotal: total });
        console.log(`[cron] Sent due-today email to ${loan.email}`);
      } else if (diffDays > 0) {
        // Overdue - only re-send every `overdueGapDays` days so we don't spam daily
        const lastSent = loan.lastOverdueEmailOn ? new Date(loan.lastOverdueEmailOn) : null;
        const gap = lastSent ? daysBetween(lastSent, today) : Infinity;

        if (gap >= overdueGapDays) {
          const { months, interest, total } = precheck;
          const remaining = Math.round((total - amountPaid) * 100) / 100;
          const { subject, htmlContent } = overdueEmail({
            name: loan.name,
            principal: loan.principal,
            monthlyRate: loan.monthlyRate,
            months,
            interest,
            total,
            amountPaid,
            remaining,
            dueDate: loan.dueDate,
            daysOverdue: diffDays,
            lenderName,
          });
          await sendEmail({ toEmail: loan.email, toName: loan.name, subject, htmlContent });
          await updateLoan(loan.id, { lastOverdueEmailOn: todayStr(), lastComputedTotal: total });
          console.log(`[cron] Sent overdue email to ${loan.email} (${diffDays} days late)`);
        }
      }
    } catch (err) {
      console.error(`[cron] Failed to email ${loan.email}:`, err.message);
    }
  }
}

function startCron() {
  const hour = Number(process.env.CHECK_HOUR || 9);
  // Runs every day at the configured hour, minute 0.
  const expression = `0 ${hour} * * *`;
  cron.schedule(expression, runDailyCheck);
  console.log(`[cron] Scheduled daily check for ${hour}:00 server time (expression: "${expression}")`);
}

module.exports = { startCron, runDailyCheck };