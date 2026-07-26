// interest.js
// Simple monthly interest calculation.
// monthlyRate is stored as a plain percentage number, e.g. 2 means 2% per month.

function daysBetween(dateA, dateB) {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  const a = new Date(dateA.getFullYear(), dateA.getMonth(), dateA.getDate());
  const b = new Date(dateB.getFullYear(), dateB.getMonth(), dateB.getDate());
  return Math.round((b - a) / MS_PER_DAY);
}

// Number of months interest is owed for, counting any started month as a full month.
// A loan starts accruing its first month's interest the moment it's created (day 0),
// not after 30 days pass - that's how informal monthly-interest lending normally works.
// Example: 0 days elapsed -> 1 month. 35 days elapsed -> 2 months.
function monthsElapsed(startDate, asOfDate) {
  const days = daysBetween(new Date(startDate), new Date(asOfDate));
  if (days < 0) return 0; // loan hasn't started yet
  return Math.max(1, Math.ceil(days / 30));
}

// Returns { months, interest, total } as of a given date.
function calculateDue(principal, monthlyRatePercent, startDate, asOfDate = new Date()) {
  const months = monthsElapsed(startDate, asOfDate);
  const rate = monthlyRatePercent / 100;
  const interest = Math.round(principal * rate * months * 100) / 100;
  const total = Math.round((principal + interest) * 100) / 100;
  return { months, interest, total };
}

module.exports = { calculateDue, monthsElapsed, daysBetween };
