// templates.js
// Builds the HTML content for the two kinds of emails we send.

function money(n) {
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function paymentRow(amountPaid) {
  if (!amountPaid) return '';
  return `<tr><td style="padding:6px 0; color:#3b6b3e;">Already paid</td><td style="padding:6px 0; text-align:right; color:#3b6b3e;">− ₹${money(amountPaid)}</td></tr>`;
}

function dueTodayEmail({ name, principal, monthlyRate, months, interest, total, amountPaid, remaining, dueDate, lenderName }) {
  const owed = remaining !== undefined ? remaining : total;
  const subject = `Payment reminder: ₹${money(owed)} due today`;
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto; color: #222;">
      <h2 style="color:#1a1a1a;">Payment Reminder</h2>
      <p>Hi ${name},</p>
      <p>This is a reminder that your repayment of <strong>₹${money(owed)}</strong> is due today (${dueDate}).</p>
      <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
        <tr><td style="padding:6px 0; color:#555;">Original amount</td><td style="padding:6px 0; text-align:right;">₹${money(principal)}</td></tr>
        <tr><td style="padding:6px 0; color:#555;">Interest (${monthlyRate}%/month × ${months} month${months === 1 ? '' : 's'})</td><td style="padding:6px 0; text-align:right;">₹${money(interest)}</td></tr>
        ${paymentRow(amountPaid)}
        <tr style="border-top: 1px solid #ddd; font-weight:bold;"><td style="padding:8px 0;">Total due</td><td style="padding:8px 0; text-align:right;">₹${money(owed)}</td></tr>
      </table>
      <p>Please arrange to pay this amount today to avoid additional interest.</p>
      <p>Thanks,<br/>${lenderName}</p>
    </div>
  `;
  return { subject, htmlContent };
}

function overdueEmail({ name, principal, monthlyRate, months, interest, total, amountPaid, remaining, dueDate, daysOverdue, lenderName }) {
  const owed = remaining !== undefined ? remaining : total;
  const subject = `Overdue: ₹${money(owed)} payment is ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} late`;
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto; color: #222;">
      <h2 style="color:#b00020;">Payment Overdue</h2>
      <p>Hi ${name},</p>
      <p>Your repayment was due on <strong>${dueDate}</strong> and is now <strong>${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue</strong>. Interest has continued to accrue.</p>
      <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
        <tr><td style="padding:6px 0; color:#555;">Original amount</td><td style="padding:6px 0; text-align:right;">₹${money(principal)}</td></tr>
        <tr><td style="padding:6px 0; color:#555;">Interest (${monthlyRate}%/month × ${months} month${months === 1 ? '' : 's'})</td><td style="padding:6px 0; text-align:right;">₹${money(interest)}</td></tr>
        ${paymentRow(amountPaid)}
        <tr style="border-top: 1px solid #ddd; font-weight:bold;"><td style="padding:8px 0;">Total now due</td><td style="padding:8px 0; text-align:right;">₹${money(owed)}</td></tr>
      </table>
      <p>Please pay the full amount including accrued interest as soon as possible.</p>
      <p>Thanks,<br/>${lenderName}</p>
    </div>
  `;
  return { subject, htmlContent };
}

function manualReminderEmail({ name, principal, monthlyRate, months, interest, total, amountPaid, remaining, dueDate, daysOverdue, lenderName }) {
  const owed = remaining !== undefined ? remaining : total;
  const overdue = daysOverdue > 0;
  const subject = `Payment request: ₹${money(owed)}${overdue ? ' (overdue)' : ''}`;
  const dueLine = overdue
    ? `Your repayment was due on <strong>${dueDate}</strong> and is currently <strong>${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue</strong>.`
    : `Your repayment is due on <strong>${dueDate}</strong>.`;
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto; color: #222;">
      <h2 style="color:#1a1a1a;">Payment Request</h2>
      <p>Hi ${name},</p>
      <p>${dueLine} Here's a summary of what's currently owed:</p>
      <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
        <tr><td style="padding:6px 0; color:#555;">Original amount</td><td style="padding:6px 0; text-align:right;">₹${money(principal)}</td></tr>
        <tr><td style="padding:6px 0; color:#555;">Interest (${monthlyRate}%/month × ${months} month${months === 1 ? '' : 's'})</td><td style="padding:6px 0; text-align:right;">₹${money(interest)}</td></tr>
        ${paymentRow(amountPaid)}
        <tr style="border-top: 1px solid #ddd; font-weight:bold;"><td style="padding:8px 0;">Amount due</td><td style="padding:8px 0; text-align:right;">₹${money(owed)}</td></tr>
      </table>
      <p>Please let me know if you have any questions about this.</p>
      <p>Thanks,<br/>${lenderName}</p>
    </div>
  `;
  return { subject, htmlContent };
}

function paymentReceiptEmail({ name, principal, monthlyRate, amountThisPayment, totalPaid, remaining, lenderName }) {
  const fullyPaid = remaining <= 0;
  const subject = fullyPaid
    ? `Payment received — thank you!`
    : `Payment received: ₹${money(amountThisPayment)}`;

  const closingLine = fullyPaid
    ? `<p>This payment brings your loan of <strong>₹${money(principal)}</strong> (${monthlyRate}%/month interest) to <strong>fully repaid</strong>. Thank you for settling it — no further action is needed on your end.</p>`
    : `<p>Thanks for the payment. Here's where things stand on your loan of <strong>₹${money(principal)}</strong> (${monthlyRate}%/month interest):</p>`;

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto; color: #222;">
      <h2 style="color:#3b6b3e;">Payment Received</h2>
      <p>Hi ${name},</p>
      ${closingLine}
      <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
        <tr><td style="padding:6px 0; color:#555;">This payment</td><td style="padding:6px 0; text-align:right;">₹${money(amountThisPayment)}</td></tr>
        <tr><td style="padding:6px 0; color:#555;">Total paid so far</td><td style="padding:6px 0; text-align:right;">₹${money(totalPaid)}</td></tr>
        <tr style="border-top: 1px solid #ddd; font-weight:bold;"><td style="padding:8px 0;">${fullyPaid ? 'Remaining balance' : 'Still owed'}</td><td style="padding:8px 0; text-align:right; color:${fullyPaid ? '#3b6b3e' : '#b00020'};">₹${money(Math.max(0, remaining))}</td></tr>
      </table>
      <p>Thanks,<br/>${lenderName}</p>
    </div>
  `;
  return { subject, htmlContent };
}

function loanCreatedEmail({ name, principal, monthlyRate, startDate, dueDate, lenderName }) {
  const subject = `New loan recorded: ₹${money(principal)}`;
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto; color: #222;">
      <h2 style="color:#1a1a1a;">Loan Recorded</h2>
      <p>Hi ${name},</p>
      <p>This confirms a loan has been recorded between us. Here are the details:</p>
      <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
        <tr><td style="padding:6px 0; color:#555;">Amount</td><td style="padding:6px 0; text-align:right;">₹${money(principal)}</td></tr>
        <tr><td style="padding:6px 0; color:#555;">Interest</td><td style="padding:6px 0; text-align:right;">${monthlyRate}% per month</td></tr>
        <tr><td style="padding:6px 0; color:#555;">Date given</td><td style="padding:6px 0; text-align:right;">${startDate}</td></tr>
        <tr style="border-top: 1px solid #ddd; font-weight:bold;"><td style="padding:8px 0;">Repayment due</td><td style="padding:8px 0; text-align:right;">${dueDate}</td></tr>
      </table>
      <p>You'll get a reminder as the due date approaches. Let me know if anything here looks off.</p>
      <p>Thanks,<br/>${lenderName}</p>
    </div>
  `;
  return { subject, htmlContent };
}

function loanReopenedEmail({ name, principal, monthlyRate, remaining, lenderName }) {
  const subject = `Ledger update: balance reopened`;
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto; color: #222;">
      <h2 style="color:#b8891f;">Balance Reopened</h2>
      <p>Hi ${name},</p>
      <p>Your loan of <strong>₹${money(principal)}</strong> (${monthlyRate}%/month interest) has been reopened on the ledger — it was previously marked as fully paid, but that's been reversed.</p>
      <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
        <tr style="font-weight:bold;"><td style="padding:8px 0;">Currently owed</td><td style="padding:8px 0; text-align:right;">₹${money(remaining)}</td></tr>
      </table>
      <p>If you believe this is a mistake, please get in touch.</p>
      <p>Thanks,<br/>${lenderName}</p>
    </div>
  `;
  return { subject, htmlContent };
}

function loanDeletedEmail({ name, principal, lenderName }) {
  const subject = `Ledger update: entry removed`;
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto; color: #222;">
      <h2 style="color:#555;">Entry Removed</h2>
      <p>Hi ${name},</p>
      <p>Your loan record of <strong>₹${money(principal)}</strong> has been removed from the ledger. No further reminders will be sent about it.</p>
      <p>Thanks,<br/>${lenderName}</p>
    </div>
  `;
  return { subject, htmlContent };
}

module.exports = {
  dueTodayEmail,
  overdueEmail,
  manualReminderEmail,
  paymentReceiptEmail,
  loanCreatedEmail,
  loanReopenedEmail,
  loanDeletedEmail,
  money,
};