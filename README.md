# The Ledger — Personal Loan Tracker

A small, self-contained web app for tracking money you've lent to people. You enter
a borrower's name, email, amount, and monthly interest rate once. From then on the
app runs on its own:

- Every day it checks all entries.
- On the **due date**, it emails the borrower a reminder with the exact amount owed
  (principal + interest accrued so far).
- If the due date passes and the loan is still marked unpaid, it emails an **overdue
  alert** every few days, recalculating the growing interest each time.
- You never trigger anything by hand — just mark an entry "paid" once someone
  actually pays you back, and the reminders stop.

No database to set up. Everything is stored in one JSON file (`data/loans.json`)
that the server reads and writes automatically.

## 1. Install

You need [Node.js](https://nodejs.org) 18 or newer installed.

```bash
cd loan-tracker
npm install
```

## 2. Configure

Copy the example environment file and fill in your real values:

```bash
cp .env.example .env
```

Open `.env` and set:

- `BREVO_API_KEY` — from [Brevo](https://app.brevo.com) → SMTP & API → API Keys.
- `SENDER_EMAIL` — the address emails will be sent *from*. It must be a
  verified sender in your Brevo account.
- `SENDER_NAME` — your name, shown as the sender and signed at the bottom of emails.
- `DASHBOARD_PASSWORD` — a simple password so random people can't open your
  dashboard if you ever host it somewhere public. Leave blank to disable.
- `PORT` — which port to run on (default 3000).
- `CHECK_HOUR` — the hour (0–23) the automated daily check runs, server time.
- `OVERDUE_REMINDER_GAP_DAYS` — how many days to wait between repeated overdue
  emails, so a borrower isn't emailed every single day.

## 3. Run

```bash
npm start
```

Then open **http://localhost:3000** in your browser. Enter your dashboard
password (if you set one) and you'll see the ledger.

Click **+ New entry** to add a borrower:

| Field | Meaning |
|---|---|
| Borrower's name / email | Who you lent money to, and where reminders go |
| Amount lent | The principal, in rupees |
| Interest per month | A plain percentage, e.g. `2` for 2% per month |
| Date lent | When the money went out |
| Repayment due date | When you expect to be paid back in full |

The ledger then shows, live, how much is owed today (principal + interest
accrued so far) for every entry — updated automatically without you doing
any math.

## 4. Keep it running

The daily email check only happens while the server (`npm start`) is
running. For a personal project, the simplest options are:

- Leave your computer/server running with the app open in a terminal.
- Use a process manager like [pm2](https://pm2.keymetrics.io/) so it
  restarts automatically:
  ```bash
  npm install -g pm2
  pm2 start server.js --name ledger
  pm2 save
  ```
- Deploy it to a small always-on host (Render, Railway, a cheap VPS, etc.)
  and set the same environment variables there.

## How interest is calculated

Interest is simple interest, compounding monthly:

```
months elapsed = ceil(days since "date lent" / 30)
interest = principal × (monthly rate / 100) × months elapsed
total due = principal + interest
```

This recalculates fresh every time the dashboard loads and every time an
email goes out, so the amount always reflects "as of today."

## Marking a loan as paid

Click the ✓ button next to an entry once the borrower has repaid you. This
stops all future reminder and overdue emails for that entry. Click ↺ to
reopen it if needed, or ✕ to delete the entry entirely.

## Testing without waiting a day

Click **"Run check now (test)"** at the bottom of the dashboard to manually
trigger the same logic the daily cron job runs, so you can confirm emails
are sending correctly before relying on the automation.

## Files

```
loan-tracker/
├── server.js        # Express server + API routes
├── cron.js          # Daily automated check (the "brain")
├── interest.js       # Interest math
├── brevo.js         # Sends emails via Brevo's API
├── templates.js      # Email HTML content
├── store.js          # Reads/writes data/loans.json
├── data/loans.json   # Your data — the only "database"
├── public/           # The dashboard (HTML/CSS/JS)
└── .env               # Your secrets (not committed to git)
```
