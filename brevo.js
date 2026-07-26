// brevo.js
// Sends transactional emails using the Brevo (formerly Sendinblue) API.
// Docs: https://developers.brevo.com/reference/sendtransacemail

const axios = require('axios');

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

async function sendEmail({ toEmail, toName, subject, htmlContent }) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.SENDER_EMAIL;
  const senderName = process.env.SENDER_NAME || 'Loan Tracker';

  if (!apiKey || !senderEmail) {
    throw new Error(
      'Missing BREVO_API_KEY or SENDER_EMAIL in your .env file. Copy .env.example to .env and fill it in.'
    );
  }

  const payload = {
    sender: { name: senderName, email: senderEmail },
    to: [{ email: toEmail, name: toName || toEmail }],
    subject,
    htmlContent,
  };

  const response = await axios.post(BREVO_URL, payload, {
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  return response.data;
}

module.exports = { sendEmail };
