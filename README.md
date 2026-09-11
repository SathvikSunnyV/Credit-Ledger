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

Data is stored in Postgres (a free [Neon](https://neon.tech) database works well).
You run `schema.sql` once to create the table, then the server reads/writes it
automatically from then on.

## 1. Install

You need [Node.js](https://nodejs.org) 18 or newer installed.

```bash
cd loan-tracker
npm install
```

## 2. Set up the database

Create a free [Neon](https://neon.tech) Postgres project, then run `schema.sql`
once against it — easiest way is Neon's dashboard → SQL Editor → paste the
contents of `schema.sql` → Run. It's safe to re-run any time (it only creates
things that don't already exist yet), so re-running it after pulling an update
is the way to pick up new columns.

## 3. Configure

Copy the example environment file and fill in your real values:

```bash
cp .env.example .env
```

Open `.env` and set:

- `DATABASE_URL` — your Neon connection string (Neon dashboard → Connection Details).
- `BREVO_API_KEY` — from [Brevo](https://app.brevo.com) → SMTP & API → API Keys.
- `SENDER_EMAIL` — the address emails will be sent *from*. It must be a
  verified sender in your Brevo account.
- `SENDER_NAME` — your name, shown as the sender and signed at the bottom of emails.
- `DASHBOARD_PASSWORD` — a simple password so random people can't open your
  dashboard if you ever host it somewhere public. Leave blank to disable.
- `PORT` — which port to run on (default 3000).
- `CHECK_HOUR` — the hour (0–23, IST) the automated daily check runs.
- `UPCOMING_REMINDER_DAYS` — how many days before the due date to start sending
  daily "upcoming" reminders (default 3).
- `OVERDUE_REMINDER_GAP_DAYS` — how many days to wait between repeated overdue
  emails, so a borrower isn't emailed every single day.

## 4. Run

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

If someone's already in the ledger and takes another loan, start typing their
name in **+ New entry** — it autocompletes from existing borrowers and fills
in their email for you. Use the search box above the ledger to pull up
everyone under one name at once.

## 5. Keep it running on Render's free tier

Render's free tier spins the app down after periods of inactivity, so it won't
be awake on its own at 9 AM to run the daily check. `.github/workflows/daily-render.yml`
handles this: it runs on GitHub's own schedule (free, independent of Render),
polls `/api/health` until Render finishes waking up, then calls
`POST /api/run-check` to run the same check the in-app cron would. It also
reruns 15 minutes later as a safety net in case the first attempt hit a slow
cold start. The Render URL is hardcoded in the workflow file itself (update it
there if you ever redeploy to a new URL); the only thing that needs to be set
is the `DASHBOARD_PASSWORD` secret under the repo's Settings → Secrets and
variables → Actions, matching whatever you set in `.env` on Render.

## How interest is calculated

Interest is simple interest, compounding monthly:

```
months elapsed = ceil(days since "date lent" / 30)
interest = principal × (monthly rate / 100) × months elapsed
total due = principal + interest
```

This recalculates fresh every time the dashboard loads and every time an
email goes out, so the amount always reflects "as of today."

## Editing an entry

Click ✎ to open the same form pre-filled with everything for that loan —
name, email, amount, rate, dates, and amount paid so far — and save your
corrections. Edits are validated the same way new entries are (amount must
be positive, due date can't be before the start date, etc.).

## Continuing a loan (renewals)

If a borrower pays this period's interest and you're both continuing the
debt into the next month rather than closing it out, click ⟳ **Renew**. You
enter how much interest was paid (optional) and a new repayment date — it
records the payment, moves the due date forward, and the status badge shows
**"continuing"** instead of pending/overdue. Reminder emails pick back up
relative to the new due date. If a renewed loan later passes its new due
date too without being renewed again, it goes back to showing "overdue".

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
├── server.js         # Express server + API routes
├── cron.js           # Daily automated check (the "brain")
├── interest.js       # Interest math
├── brevo.js          # Sends emails via Brevo's API
├── templates.js      # Email HTML content
├── store.js          # Reads/writes Postgres (Neon)
├── db.js             # Postgres connection pool
├── schema.sql        # Run once (and after updates) to set up/migrate the table
├── .github/workflows/daily-render.yml  # Wakes Render + triggers the daily check
├── public/           # The dashboard (HTML/CSS/JS)
└── .env              # Your secrets (not committed to git)
```