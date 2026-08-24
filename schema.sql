-- schema.sql
-- Run this once against your Neon database before starting the app.
-- Easiest way: open your Neon project -> SQL Editor -> paste this in -> Run.

CREATE TABLE IF NOT EXISTS loans (
  id                     UUID PRIMARY KEY,
  name                   TEXT NOT NULL,
  email                  TEXT NOT NULL,
  principal              NUMERIC(12, 2) NOT NULL,
  monthly_rate           NUMERIC(6, 3) NOT NULL,
  start_date             DATE NOT NULL,
  due_date               DATE NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending',
  amount_paid            NUMERIC(12, 2) NOT NULL DEFAULT 0,
  due_reminder_sent_on   DATE,
  last_upcoming_reminder_on DATE,
  last_overdue_email_on  DATE,
  last_computed_total    NUMERIC(12, 2),
  last_payment_on        DATE,
  last_manual_email_on   TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loans_status ON loans (status);
CREATE INDEX IF NOT EXISTS idx_loans_due_date ON loans (due_date);

-- Migration: if your table already existed before this column was added,
-- this line adds it without touching anything else. Safe to run any number of times.
ALTER TABLE loans ADD COLUMN IF NOT EXISTS last_upcoming_reminder_on DATE;