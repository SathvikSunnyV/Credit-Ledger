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
const formTitle = document.getElementById('formTitle');
const amountPaidField = document.getElementById('amountPaidField');
const borrowerListEl = document.getElementById('borrowerList');
const borrowerFilter = document.getElementById('borrowerFilter');
const ledgerBody = document.getElementById('ledgerBody');
const summaryRow = document.getElementById('summaryRow');
const runCheckBtn = document.getElementById('runCheckBtn');

// Holds the last loaded loans so click handlers (edit/renew) and the search
// box can work off the same data without re-fetching.
let currentLoans = [];
// Name -> email, built from existing entries, used to autofill the form
// when you pick a borrower who's already in the ledger.
let borrowerEmailByName = new Map();
// null = the form is creating a new entry; otherwise the id being edited.
let editingLoanId = null;

function fmtMoney(n) {
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Adds `months` calendar months to a YYYY-MM-DD date string and returns the
// result in the same format. Used only to suggest a default renew date.
function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
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

function openFormForCreate() {
  editingLoanId = null;
  loanForm.reset();
  formError.textContent = '';
  formTitle.textContent = 'New ledger entry';
  amountPaidField.classList.add('hidden');
  const today = new Date().toISOString().slice(0, 10);
  loanForm.startDate.value = today;
  formOverlay.classList.remove('hidden');
  loanForm.name.focus();
}

function openFormForEdit(loan) {
  editingLoanId = loan.id;
  formError.textContent = '';
  formTitle.textContent = 'Edit ledger entry';
  loanForm.name.value = loan.name;
  loanForm.email.value = loan.email;
  loanForm.principal.value = loan.principal;
  loanForm.monthlyRate.value = loan.monthlyRate;
  loanForm.startDate.value = loan.startDate;
  loanForm.dueDate.value = loan.dueDate;
  loanForm.amountPaid.value = loan.amountPaid || 0;
  amountPaidField.classList.remove('hidden');
  formOverlay.classList.remove('hidden');
  loanForm.name.focus();
}

openFormBtn.addEventListener('click', openFormForCreate);
cancelFormBtn.addEventListener('click', () => formOverlay.classList.add('hidden'));
formOverlay.addEventListener('click', (e) => { if (e.target === formOverlay) formOverlay.classList.add('hidden'); });

// Picking (or typing) a name that already exists in the ledger auto-fills
// their email, so a repeat borrower doesn't need to be retyped from scratch.
loanForm.name.addEventListener('input', () => {
  if (editingLoanId) return; // don't clobber an edit in progress
  const match = borrowerEmailByName.get(loanForm.name.value.trim());
  if (match && !loanForm.email.value.trim()) {
    loanForm.email.value = match;
  }
});

loanForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.textContent = '';
  const data = Object.fromEntries(new FormData(loanForm).entries());
  data.principal = Number(data.principal);
  data.monthlyRate = Number(data.monthlyRate);

  if (editingLoanId) {
    data.amountPaid = Number(data.amountPaid || 0);
  } else {
    delete data.amountPaid; // new entries always start at 0, set server-side
  }

  if (new Date(data.dueDate) < new Date(data.startDate)) {
    formError.textContent = 'Due date must be on or after the date lent.';
    return;
  }

  try {
    if (editingLoanId) {
      await api(`/api/loans/${editingLoanId}`, { method: 'PATCH', body: JSON.stringify(data) });
    } else {
      await api('/api/loans', { method: 'POST', body: JSON.stringify(data) });
    }
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

borrowerFilter.addEventListener('input', () => renderLoans(currentLoans));

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

function editLoan(id) {
  const loan = currentLoans.find((l) => l.id === id);
  if (!loan) return;
  openFormForEdit(loan);
}

// Debtor paid this period's interest and is continuing the debt to next
// month - record the interest received and push the due date forward,
// instead of letting it sit flagged as overdue.
async function renewLoan(id) {
  const loan = currentLoans.find((l) => l.id === id);
  if (!loan) return;

  const interestInput = prompt('Interest paid now (₹)? Leave blank if none was paid:', '');
  if (interestInput === null) return; // cancelled
  const interestPaid = interestInput.trim() === '' ? 0 : Number(interestInput);
  if (isNaN(interestPaid) || interestPaid < 0) {
    alert('Enter a valid amount (0 or more).');
    return;
  }

  const suggestedDueDate = addMonths(loan.dueDate, 1);
  const newDueDate = prompt('New repayment date (YYYY-MM-DD):', suggestedDueDate);
  if (newDueDate === null) return; // cancelled
  if (isNaN(Date.parse(newDueDate))) {
    alert("That doesn't look like a valid date - use YYYY-MM-DD.");
    return;
  }

  try {
    await api(`/api/loans/${id}/renew`, { method: 'POST', body: JSON.stringify({ interestPaid, newDueDate }) });
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

// "continuing" only shows while the renewed schedule is still being honored -
// if a renewed loan blows past its (new) due date too, it goes back to
// "overdue" since that's a fresh problem needing attention again.
function statusFor(loan) {
  if (loan.status === 'paid') return 'paid';
  const due = new Date(loan.dueDate);
  const today = new Date();
  due.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  if (today > due) return 'overdue';
  if (loan.renewalCount > 0) return 'continuing';
  return 'pending';
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

// Rebuilds the name -> email map and the <datalist> options used by the
// "New entry" form's autocomplete, from whatever is currently in the ledger.
function updateBorrowerDirectory(loans) {
  const seen = new Map();
  loans.forEach((l) => { if (!seen.has(l.name)) seen.set(l.name, l.email); });
  borrowerEmailByName = seen;
  borrowerListEl.innerHTML = Array.from(seen.keys())
    .map((n) => `<option value="${escapeHtml(n)}"></option>`)
    .join('');
}

// Orders loans so the same borrower's entries sit together (since they're the
// same person with two separate agreements), while still surfacing whichever
// group needs attention soonest first. Each loan stays a fully independent
// row underneath - own status, own buttons - only the display is clustered.
function orderForDisplay(loans) {
  const groups = new Map();
  loans.forEach((loan) => {
    const key = loan.email.trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(loan);
  });

  const groupList = Array.from(groups.values()).map((list) => {
    list.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    const unpaid = list.filter((l) => l.status !== 'paid');
    const reference = unpaid.length > 0 ? unpaid : list;
    const earliest = Math.min(...reference.map((l) => new Date(l.dueDate).getTime()));
    return { earliest, list };
  });
  groupList.sort((a, b) => a.earliest - b.earliest);

  const ordered = [];
  groupList.forEach(({ list }) => {
    list.forEach((loan, i) => ordered.push({ loan, isGroupStart: i === 0, groupSize: list.length }));
  });
  return ordered;
}

function renderLoans(loans) {
  const query = borrowerFilter.value.trim().toLowerCase();
  const visible = query
    ? loans.filter((l) => l.name.toLowerCase().includes(query) || l.email.toLowerCase().includes(query))
    : loans;

  if (loans.length === 0) {
    ledgerBody.innerHTML = '<p class="empty-state">No entries yet. Add someone above and the ledger will start tracking them automatically.</p>';
    return;
  }
  if (visible.length === 0) {
    ledgerBody.innerHTML = '<p class="empty-state">No borrowers match that search.</p>';
    return;
  }

  ledgerBody.innerHTML = orderForDisplay(visible)
    .map(({ loan, isGroupStart, groupSize }) => {
      const status = statusFor(loan);
      const remaining = loan.computed.remaining;
      const paid = loan.computed.paid;
      const isPaid = loan.status === 'paid';
      const countBadge = isGroupStart && groupSize > 1 ? `<span class="loan-count">${groupSize} loans</span>` : '';
      return `
      <div class="ledger-row ${isGroupStart ? '' : 'grouped'}">
        <span data-label="Borrower" class="name">${escapeHtml(loan.name)}${countBadge}<span class="email">${escapeHtml(loan.email)}</span></span>
        <span data-label="Principal" class="amount">${fmtMoney(loan.principal)}</span>
        <span data-label="Rate">${loan.monthlyRate}%</span>
        <span data-label="Due">${fmtDate(loan.dueDate)}</span>
        <span data-label="Paid" class="paid-amt">${paid > 0 ? fmtMoney(paid) : '—'}</span>
        <span data-label="Remaining" class="total ${remaining <= 0 ? 'cleared' : ''}">${fmtMoney(remaining)}</span>
        <span data-label="Status"><span class="badge ${status}">${status}</span></span>
        <span class="row-actions">
          <button class="icon-btn" title="Edit entry" onclick="editLoan('${loan.id}')">✎</button>
          <button class="icon-btn" title="Renew — record interest paid and continue to next month" onclick="renewLoan('${loan.id}')" ${isPaid ? 'disabled' : ''}>⟳</button>
          <button class="icon-btn" title="Email this person now" onclick="sendEmailNow('${loan.id}')" ${isPaid ? 'disabled' : ''}>✉</button>
          <button class="icon-btn" title="Record a payment" onclick="recordPayment('${loan.id}')" ${isPaid ? 'disabled' : ''}>₹+</button>
          <button class="icon-btn" title="${isPaid ? 'Mark unpaid' : 'Mark fully paid'}" onclick="markPaid('${loan.id}', ${!isPaid})">${isPaid ? '↺' : '✓'}</button>
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
    currentLoans = loans;
    updateBorrowerDirectory(loans);
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
window.editLoan = editLoan;
window.renewLoan = renewLoan;