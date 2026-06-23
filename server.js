import 'dotenv/config';
import express from 'express';
import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import crypto from 'crypto';
import { z } from 'zod';

const app = express();
const PORT = process.env.PORT || 3000;
const OWNER_EMAIL = process.env.OWNER_EMAIL || '';
const FROM_EMAIL = process.env.FROM_EMAIL || OWNER_EMAIL || 'no-reply@charlottepropertydetailing.com';
const invoices = new Map();
const SITE_PASSWORD = process.env.SITE_PASSWORD || '192837';
const AUTH_COOKIE = 'cpd_site_auth';
const AUTH_TTL_MS = 12 * 60 * 60 * 1000;

app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '2mb' }));

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        if (index === -1) return [part, ''];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function isAuthed(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies[AUTH_COOKIE] === SITE_PASSWORD;
}

function passwordPage(message = '', next = '/') {
  const safeMessage = escapeHtml(message);
  const safeNext = escapeHtml(next || '/');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Charlotte Property Detailing</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(135deg,#eef7fb,#f7fbf5);font-family:Arial,sans-serif;color:#17212b;padding:20px}.card{width:100%;max-width:420px;background:white;border-radius:20px;box-shadow:0 16px 50px rgba(15,95,143,.16);padding:28px}h1{font-size:24px;margin:0 0 8px;color:#0f5f8f}p{margin:0 0 18px;color:#607083;line-height:1.45}label{display:block;font-weight:700;margin:0 0 8px}input{width:100%;border:1px solid #cbd7e2;border-radius:12px;font-size:18px;padding:13px 14px;margin-bottom:14px}button{width:100%;border:0;border-radius:12px;background:#1d8a56;color:white;font-weight:800;font-size:16px;padding:14px;cursor:pointer}.error{background:#fff1f1;color:#a92323;border:1px solid #ffd0d0;border-radius:10px;padding:10px 12px;margin-bottom:14px;font-weight:700}
  </style>
</head>
<body>
  <main class="card">
    <h1>Charlotte Property Detailing</h1>
    <p>This site is password protected.</p>
    ${safeMessage ? `<div class="error">${safeMessage}</div>` : ''}
    <form method="post" action="/__site-login">
      <input type="hidden" name="next" value="${safeNext}">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" inputmode="numeric" autocomplete="current-password" autofocus required>
      <button type="submit">Enter Site</button>
    </form>
  </main>
</body>
</html>`;
}

function requireSitePassword(req, res, next) {
  if (!SITE_PASSWORD || isAuthed(req)) return next();
  res.status(401).send(passwordPage('', req.originalUrl || '/'));
}

app.get('/health', (_req, res) => res.json({ ok: true, ownerEmailConfigured: Boolean(OWNER_EMAIL), smtpConfigured: Boolean(getTransporter()) }));

app.post('/__site-login', (req, res) => {
  const nextUrl = String(req.body?.next || '/');
  if (String(req.body?.password || '') !== SITE_PASSWORD) {
    return res.status(401).send(passwordPage('Incorrect password. Please try again.', nextUrl));
  }
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  res.cookie(AUTH_COOKIE, SITE_PASSWORD, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: AUTH_TTL_MS
  });
  res.redirect(nextUrl.startsWith('/') ? nextUrl : '/');
});

app.use(requireSitePassword);
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

function invoiceNumber() {
  const now = new Date();
  const ymd = now.toISOString().slice(0, 10).replaceAll('-', '');
  return `CPD-${ymd}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function signatureBuffer(dataUrl) {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  return Buffer.from(base64, 'base64');
}

function buildInvoicePdf(data, number) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const paidDate = data.signedAt || new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
    const customerName = `${data.firstName} ${data.lastName}`;
    const address = `${data.streetAddress}\n${data.city}, ${data.state} ${data.zip}`;

    doc.fontSize(20).fillColor('#0f5f8f').text('Charlotte Property Detailing & Pressure Washing', { align: 'left' });
    doc.moveDown(0.3).fontSize(10).fillColor('#333').text('Jerry Johnson • 980-290-8919');
    doc.moveDown(1.2);

    doc.fontSize(26).fillColor('#1d8a56').text('PAID INVOICE', { align: 'right' });
    doc.fontSize(11).fillColor('#333').text(`Invoice #: ${number}`, { align: 'right' });
    doc.text(`Paid Date: ${paidDate}`, { align: 'right' });
    doc.moveDown(1.2);

    doc.fontSize(12).fillColor('#111').text('Bill To:', { underline: true });
    doc.moveDown(0.2).fontSize(11).text(customerName);
    doc.text(address);
    doc.text(data.mobilePhone);
    doc.text(data.email);
    doc.moveDown(1.2);

    const startY = doc.y;
    doc.rect(50, startY, 512, 28).fill('#0f5f8f');
    doc.fillColor('white').fontSize(11).text('Service', 60, startY + 9).text('Amount', 460, startY + 9);
    doc.rect(50, startY + 28, 512, 44).stroke('#d8e0e8');
    doc.fillColor('#111').fontSize(11).text(data.service, 60, startY + 43, { width: 340 });
    doc.text(money(data.amount), 460, startY + 43, { width: 90, align: 'right' });
    doc.moveDown(5);

    doc.fontSize(15).fillColor('#1d8a56').text(`Total Paid: ${money(data.amount)}`, { align: 'right' });
    if (data.notes) {
      doc.moveDown(1).fontSize(11).fillColor('#111').text('Notes:', { underline: true });
      doc.moveDown(0.2).text(data.notes, { width: 500 });
    }

    doc.moveDown(1.5).fontSize(11).fillColor('#111').text('Customer Digital Signature:', { underline: true });
    try {
      doc.image(signatureBuffer(data.signatureDataUrl), 50, doc.y + 8, { fit: [260, 90] });
    } catch {
      doc.text('[Signature captured]');
    }
    doc.moveDown(7);
    doc.fontSize(9).fillColor('#666').text('Thank you for choosing Charlotte Property Detailing & Pressure Washing. This paid invoice confirms the service record entered at completion.', { align: 'center' });

    // Large red paid stamp across the invoice page.
    doc.save();
    doc.rotate(-24, { origin: [306, 396] });
    doc.opacity(0.42).fontSize(86).fillColor('#cc0000').text('PAID', 140, 360, { width: 332, align: 'center' });
    doc.restore();

    doc.end();
  });
}

app.post('/api/send-service-record', async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message || 'Invalid form' });
  }

  const data = parsed.data;
  const number = invoiceNumber();
  const pdf = await buildInvoicePdf(data, number);
  invoices.set(number, { pdf, data, createdAt: new Date() });

  // Temporary mode: no email required until SMTP is configured.
  // If SMTP exists later, this will also email the customer/Jerry with the paid invoice attached.
  let emailSent = false;
  const transporter = getTransporter();
  if (transporter && OWNER_EMAIL) {
    const html = buildEmail(data);
    const subject = `Paid invoice: ${data.firstName} ${data.lastName} - ${money(data.amount)}`;
    await transporter.sendMail({
      from: `Charlotte Property Detailing <${FROM_EMAIL}>`,
      to: data.email,
      cc: OWNER_EMAIL,
      replyTo: OWNER_EMAIL,
      subject,
      html,
      attachments: [{ filename: `${number}.pdf`, content: pdf, contentType: 'application/pdf' }]
    });
    emailSent = true;
  }

  res.json({ ok: true, emailSent, invoiceUrl: `/invoice/${number}.pdf`, invoiceNumber: number });
});

app.get('/invoice/:number.pdf', (req, res) => {
  const invoice = invoices.get(req.params.number);
  if (!invoice) return res.status(404).send('Invoice not found or expired.');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${req.params.number}.pdf"`);
  res.send(invoice.pdf);
});

app.get('/qr.png', async (req, res) => {
  const target = String(req.query.url || '');
  if (!target.startsWith('http://') && !target.startsWith('https://')) return res.status(400).send('Missing QR URL');
  const png = await QRCode.toBuffer(target, { type: 'png', width: 720, margin: 2, errorCorrectionLevel: 'M' });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  res.send(png);
});

app.get('/qr', (req, res) => {
  const target = String(req.query.url || '');
  if (!target.startsWith('http://') && !target.startsWith('https://')) return res.status(400).send('Missing QR URL');
  const safeTarget = escapeHtml(target);
  const qrSrc = `/qr.png?url=${encodeURIComponent(target)}`;
  res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Customer QR Code</title>
  <style>
    body{margin:0;font-family:Arial,sans-serif;background:#f5f8fb;color:#17212b;display:grid;place-items:center;min-height:100vh;padding:18px}
    .card{background:white;max-width:520px;width:100%;border-radius:18px;box-shadow:0 8px 30px rgba(10,40,70,.12);padding:22px;text-align:center}
    h1{font-size:24px;margin:0 0 8px}.muted{color:#607083}.qr{width:100%;max-width:360px;border:1px solid #d8e0e8;border-radius:14px;padding:12px;margin:12px auto;display:block}
    a{color:#0f5f8f;font-weight:700;word-break:break-word}.btn{display:inline-block;margin-top:12px;background:#2f7d32;color:white;text-decoration:none;border-radius:12px;padding:12px 14px}
  </style>
</head>
<body>
  <div class="card">
    <h1>Scan to Open Customer Form</h1>
    <p class="muted">Have the customer scan this QR code with their phone.</p>
    <img class="qr" src="${qrSrc}" alt="QR code">
    <p><a href="${safeTarget}">${safeTarget}</a></p>
    <a class="btn" href="${safeTarget}">Open Form</a>
  </div>
</body>
</html>`);
});

app.listen(PORT, () => console.log(`Charlotte Property Detailing app running on :${PORT}`));
