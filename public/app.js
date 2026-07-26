// app.js — talks to the /api/loans endpoints and renders the ledger table.

let DASH_PASSWORD = sessionStorage.getItem('dashPassword') || '';

const lockScreen = document.getElementById('lockScreen');
const app = document.getElementById('app');
const passwordInput = document.getElementById('passwordInput');
const unlockBtn = document.getElementById('unlockBtn');
const lockError = document.getElementById('lockError');

const openFormBtn = document.getElementById('openFormBtn');
const cancelFormBtn = document.getElementById('cancelFormBtn');
const formOverlay = document.getElementById('formOverlay');
const loanForm = document.getElementById('loanForm');
const formError = document.getElementById('formError');
const ledgerBody = document.getElementById('ledgerBody');
const summaryRow = document.getElementById('summaryRow');
const runCheckBtn = document.getElementById('runCheckBtn');

function fmtMoney(n) {
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-dashboard-password': DASH_PASSWORD,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    sessionStorage.removeItem('dashPassword');
    showLock('Password incorrect or session expired. Try again.');
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function showLock(message) {
  lockScreen.classList.remove('hidden');
  app.classList.add('hidden');
  lockError.textContent = message || '';
}

function showApp() {
  lockScreen.classList.add('hidden');
  app.classList.remove('hidden');
  loadLoans();
}

unlockBtn.addEventListener('click', async () => {
  DASH_PASSWORD = passwordInput.value;
  try {
    await api('/api/loans'); // will throw if wrong password
    sessionStorage.setItem('dashPassword', DASH_PASSWORD);
    showApp();
  } catch (err) {
    if (err.message !== 'unauthorized') lockError.textContent = err.message;
  }
});
passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') unlockBtn.click(); });

openFormBtn.addEventListener('click', () => {
  loanForm.reset();
  formError.textContent = '';
  const today = new Date().toISOString().slice(0, 10);
  loanForm.startDate.value = today;
  formOverlay.classList.remove('hidden');
});
cancelFormBtn.addEventListener('click', () => formOverlay.classList.add('hidden'));
formOverlay.addEventListener('click', (e) => { if (e.target === formOverlay) formOverlay.classList.add('hidden'); });

loanForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.textContent = '';
  const data = Object.fromEntries(new FormData(loanForm).entries());
  data.principal = Number(data.principal);
  data.monthlyRate = Number(data.monthlyRate);

  if (new Date(data.dueDate) < new Date(data.startDate)) {
    formError.textContent = 'Due date must be on or after the date lent.';
    return;
  }

  try {
    await api('/api/loans', { method: 'POST', body: JSON.stringify(data) });
    formOverlay.classList.add('hidden');
    loadLoans();
  } catch (err) {
    formError.textContent = err.message;
  }
});

runCheckBtn.addEventListener('click', async () => {
  runCheckBtn.textContent = 'Running…';
  try {
    await api('/api/run-check', { method: 'POST' });
    runCheckBtn.textContent = 'Done ✓';
  } catch (err) {
    runCheckBtn.textContent = 'Failed';
  }
  setTimeout(() => (runCheckBtn.textContent = 'Run check now (test)'), 2000);
});

async function markPaid(id, paid) {
  await api(`/api/loans/${id}`, { method: 'PATCH', body: JSON.stringify({ status: paid ? 'paid' : 'pending' }) });
  loadLoans();
}

async function sendEmailNow(id) {
  if (!confirm('Send a payment request email to this person right now?')) return;
  try {
    const result = await api(`/api/loans/${id}/send-email`, { method: 'POST' });
    alert(result.message || 'Email sent.');
  } catch (err) {
    alert('Could not send email: ' + err.message);
  }
}

async function recordPayment(id) {
  const input = prompt('How much did they pay back (₹)?');
  if (input === null) return; // cancelled
  const amount = Number(input);
  if (!amount || amount <= 0) {
    alert('Enter a valid amount greater than 0.');
    return;
  }
  try {
    await api(`/api/loans/${id}/payments`, { method: 'POST', body: JSON.stringify({ amount }) });
    loadLoans();
  } catch (err) {
    alert(err.message);
  }
}

async function removeLoan(id) {
  if (!confirm('Delete this ledger entry? This cannot be undone.')) return;
  await api(`/api/loans/${id}`, { method: 'DELETE' });
  loadLoans();
}

function statusFor(loan) {
  if (loan.status === 'paid') return 'paid';
  const due = new Date(loan.dueDate);
  const today = new Date();
  due.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return today > due ? 'overdue' : 'pending';
}

function renderSummary(loans) {
  const active = loans.filter((l) => l.status !== 'paid');
  const totalOut = active.reduce((sum, l) => sum + l.computed.remaining, 0);
  const overdueCount = active.filter((l) => statusFor(l) === 'overdue').length;

  summaryRow.innerHTML = `
    <div class="summary-card">
      <p class="label">Active borrowers</p>
      <p class="value">${active.length}</p>
    </div>
    <div class="summary-card">
      <p class="label">Total owed to you</p>
      <p class="value">${fmtMoney(totalOut)}</p>
    </div>
    <div class="summary-card ${overdueCount > 0 ? 'overdue' : ''}">
      <p class="label">Overdue</p>
      <p class="value">${overdueCount}</p>
    </div>
  `;
}

function renderLoans(loans) {
  if (loans.length === 0) {
    ledgerBody.innerHTML = '<p class="empty-state">No entries yet. Add someone above and the ledger will start tracking them automatically.</p>';
    return;
  }

  ledgerBody.innerHTML = loans
    .slice()
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
    .map((loan) => {
      const status = statusFor(loan);
      const remaining = loan.computed.remaining;
      const paid = loan.computed.paid;
      return `
      <div class="ledger-row">
        <span data-label="Borrower" class="name">${escapeHtml(loan.name)}<span class="email">${escapeHtml(loan.email)}</span></span>
        <span data-label="Principal" class="amount">${fmtMoney(loan.principal)}</span>
        <span data-label="Rate">${loan.monthlyRate}%</span>
        <span data-label="Due">${fmtDate(loan.dueDate)}</span>
        <span data-label="Paid" class="paid-amt">${paid > 0 ? fmtMoney(paid) : '—'}</span>
        <span data-label="Remaining" class="total ${remaining <= 0 ? 'cleared' : ''}">${fmtMoney(remaining)}</span>
        <span data-label="Status"><span class="badge ${status}">${status}</span></span>
        <span class="row-actions">
          <button class="icon-btn" title="Email this person now" onclick="sendEmailNow('${loan.id}')" ${loan.status === 'paid' ? 'disabled' : ''}>✉</button>
          <button class="icon-btn" title="Record a payment" onclick="recordPayment('${loan.id}')" ${loan.status === 'paid' ? 'disabled' : ''}>₹+</button>
          <button class="icon-btn" title="${loan.status === 'paid' ? 'Mark unpaid' : 'Mark fully paid'}" onclick="markPaid('${loan.id}', ${loan.status !== 'paid'})">${loan.status === 'paid' ? '↺' : '✓'}</button>
          <button class="icon-btn" title="Delete" onclick="removeLoan('${loan.id}')">✕</button>
        </span>
      </div>
    `;
    })
    .join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function loadLoans() {
  try {
    const loans = await api('/api/loans');
    renderSummary(loans);
    renderLoans(loans);
  } catch (err) {
    if (err.message !== 'unauthorized') console.error(err);
  }
}

// Boot
if (DASH_PASSWORD) {
  showApp();
} else {
  // Try without password in case DASHBOARD_PASSWORD isn't set on the server
  api('/api/loans')
    .then(() => showApp())
    .catch(() => showLock());
}

window.markPaid = markPaid;
window.removeLoan = removeLoan;
window.recordPayment = recordPayment;
window.sendEmailNow = sendEmailNow;