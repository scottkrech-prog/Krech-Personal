import 'dotenv/config';
import express from 'express';
import nodemailer from 'nodemailer';
import { z } from 'zod';

const app = express();
const PORT = process.env.PORT || 3000;
const OWNER_EMAIL = process.env.OWNER_EMAIL || '';
const FROM_EMAIL = process.env.FROM_EMAIL || OWNER_EMAIL || 'no-reply@charlottepropertydetailing.com';

app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

const schema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName: z.string().trim().min(1, 'Last name is required').max(80),
  streetAddress: z.string().trim().min(3, 'Street address is required').max(180),
  city: z.string().trim().min(1, 'City is required').max(80),
  state: z.string().trim().min(2, 'State is required').max(40),
  zip: z.string().trim().min(5, 'Zip is required').max(20),
  mobilePhone: z.string().trim().min(7, 'Mobile phone is required').max(30),
  email: z.string().trim().email('Valid email is required').max(160),
  service: z.string().trim().min(1, 'Service performed is required').max(120),
  amount: z.coerce.number().min(0, 'Amount must be 0 or more').max(100000),
  notes: z.string().trim().max(1000).optional().default(''),
  signatureDataUrl: z.string().startsWith('data:image/png;base64,', 'Signature is required'),
  signedAt: z.string().trim().max(80).optional().default('')
});

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function money(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

function buildEmail(data) {
  const serviceDate = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const safe = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, escapeHtml(v)]));
  const formattedAddress = `${safe.streetAddress}<br>${safe.city}, ${safe.state} ${safe.zip}`;
  return `
  <div style="font-family:Arial,sans-serif;color:#111;line-height:1.45;max-width:720px;margin:auto">
    <h2 style="margin-bottom:4px">Charlotte Property Detailing and Pressure Washing</h2>
    <p style="margin-top:0;color:#555">Service record and customer acknowledgement</p>
    <table style="border-collapse:collapse;width:100%;margin:18px 0">
      <tr><td style="padding:8px;border:1px solid #ddd"><b>Customer</b></td><td style="padding:8px;border:1px solid #ddd">${safe.firstName} ${safe.lastName}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd"><b>Service Address</b></td><td style="padding:8px;border:1px solid #ddd">${formattedAddress}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd"><b>Mobile</b></td><td style="padding:8px;border:1px solid #ddd">${safe.mobilePhone}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd"><b>Email</b></td><td style="padding:8px;border:1px solid #ddd">${safe.email}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd"><b>Service</b></td><td style="padding:8px;border:1px solid #ddd">${safe.service}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd"><b>Amount</b></td><td style="padding:8px;border:1px solid #ddd">${money(data.amount)}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd"><b>Date/time</b></td><td style="padding:8px;border:1px solid #ddd">${escapeHtml(data.signedAt || serviceDate)}</td></tr>
      ${data.notes ? `<tr><td style="padding:8px;border:1px solid #ddd"><b>Notes</b></td><td style="padding:8px;border:1px solid #ddd">${escapeHtml(data.notes)}</td></tr>` : ''}
    </table>
    <p><b>Customer digital signature:</b></p>
    <img alt="Customer signature" src="${data.signatureDataUrl}" style="border:1px solid #ccc;max-width:420px;width:100%;height:auto" />
    <hr style="border:none;border-top:1px solid #eee;margin:22px 0" />
    <p style="font-size:13px;color:#555">Jerry Johnson • 980-290-8919 • Soft house washing, deck staining, concrete cleaning, and concrete sealing.</p>
  </div>`;
}

function getTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

app.post('/api/send-service-record', async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message || 'Invalid form' });
  }
  if (!OWNER_EMAIL) return res.status(500).json({ ok: false, error: 'OWNER_EMAIL is not configured yet.' });
  const transporter = getTransporter();
  if (!transporter) return res.status(500).json({ ok: false, error: 'SMTP email settings are not configured yet.' });

  const data = parsed.data;
  const html = buildEmail(data);
  const subject = `Service record: ${data.firstName} ${data.lastName} - ${money(data.amount)}`;

  await transporter.sendMail({
    from: `Charlotte Property Detailing <${FROM_EMAIL}>`,
    to: data.email,
    cc: OWNER_EMAIL,
    replyTo: OWNER_EMAIL,
    subject,
    html
  });

  res.json({ ok: true });
});

app.get('/health', (_req, res) => res.json({ ok: true, ownerEmailConfigured: Boolean(OWNER_EMAIL), smtpConfigured: Boolean(getTransporter()) }));

app.listen(PORT, () => console.log(`Charlotte Property Detailing app running on :${PORT}`));
