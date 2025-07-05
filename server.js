// server.js - versi lengkap dengan fitur admin
const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const fetch = require('node-fetch');
const FormData = require('form-data');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'database.json');

app.use(bodyParser.json());
app.use(express.static('public'));

// Middleware proteksi domain
app.use((req, res, next) => {
  const host = req.headers.host;
  if (!host.includes('lyshortlink-production.up.railway.app') && !host.includes('lys.my.id')) {
    return res.status(403).send('❌ Akses ditolak. Domain tidak diizinkan.');
  }
  next();
});

function loadDB() {
  try {
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function kirimNotifikasiPesan(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

async function kirimFileKeTelegram(filepath) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('document', fs.createReadStream(filepath));

  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    body: form
  });

  if (!res.ok) throw new Error(`Telegram API error: ${res.statusText}`);
}

function generateShortId(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// === API ===

app.post('/api/shorten', (req, res) => {
  const { originalUrl, password } = req.body;
  if (!originalUrl) return res.status(400).json({ error: 'URL tidak boleh kosong.' });

  const shortId = generateShortId();
  const date = new Date().toISOString();
  const db = loadDB();

  const shortUrl = `https://lys.my.id/${shortId}`;
  const data = { shortId, originalUrl, shortUrl, date, clicks: 0, lastAccess: null, password: password || null };

  db.push(data);
  saveDB(db);

  const notif = `🔗 Shortlink baru dibuat:\n\n📎 Original: ${originalUrl}\n🆔 Slug: ${shortId}\n🔐 Password: ${password ? 'YA' : 'TIDAK'}\n📅 Tanggal: ${date}`;
  kirimNotifikasiPesan(notif).catch(console.error);

  res.json(data);
});

app.post('/api/verify-password', (req, res) => {
  const { shortId, password } = req.body;
  const db = loadDB();
  const item = db.find((i) => i.shortId === shortId);
  if (!item) return res.status(404).json({ error: 'Shortlink tidak ditemukan' });

  if (item.password === password) {
    item.clicks = (item.clicks || 0) + 1;
    item.lastAccess = new Date().toISOString();
    saveDB(db);
    return res.json({ success: true, redirect: item.originalUrl });
  } else {
    return res.status(403).json({ error: 'Password salah' });
  }
});

app.get('/api/admin/backup', async (req, res) => {
  try {
    await kirimFileKeTelegram(DB_PATH);
    res.json({ success: true, message: 'Backup terkirim ke Telegram!' });
  } catch (e) {
    res.status(500).json({ error: 'Gagal kirim backup: ' + e.message });
  }
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Simpan session login admin
let isAdminLoggedIn = false;

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    isAdminLoggedIn = true;
    return res.json({ success: true });
  } else {
    return res.status(403).json({ success: false, error: 'Password admin salah' });
  }
});

// Middleware proteksi admin
function verifyAdmin(req, res, next) {
  if (!isAdminLoggedIn) {
    return res.status(403).json({ error: 'Akses ditolak. Login dulu.' });
  }
  next();
}

// Semua endpoint admin pakai middleware ini
app.get('/api/admin/all', verifyAdmin, (req, res) => {
  res.json(loadDB());
});

app.delete('/api/admin/delete/:id', verifyAdmin, (req, res) => {
  const db = loadDB();
  const filtered = db.filter(i => i.shortId !== req.params.id);
  saveDB(filtered);
  res.json({ success: true });
});

app.get('/api/admin/export', verifyAdmin, (req, res) => {
  const type = req.query.type;
  const db = loadDB();

  if (type === 'csv') {
    const csv = db.map(i => `${i.shortId},${i.originalUrl},${i.clicks},${i.lastAccess || ''},${i.password ? 'YES' : 'NO'}`).join('\n');
    res.setHeader('Content-Disposition', 'attachment; filename=shortlinks.csv');
    res.setHeader('Content-Type', 'text/csv');
    return res.send(`shortId,url,clicks,lastAccess,password\n${csv}`);
  } else {
    res.setHeader('Content-Disposition', 'attachment; filename=shortlinks.json');
    res.setHeader('Content-Type', 'application/json');
    return res.send(JSON.stringify(db, null, 2));
  }
});

app.get('/api/admin/backup', verifyAdmin, async (req, res) => {
  try {
    await kirimFileKeTelegram(DB_PATH);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/all', (req, res) => {
  const db = loadDB();
  res.json(db);
});

app.delete('/api/admin/delete/:shortId', (req, res) => {
  let db = loadDB();
  const shortId = req.params.shortId;
  db = db.filter((item) => item.shortId !== shortId);
  saveDB(db);
  res.json({ success: true, message: `Shortlink ${shortId} dihapus.` });
});

app.get('/api/admin/export', (req, res) => {
  const db = loadDB();
  const type = req.query.type;

  if (type === 'csv') {
    const csv = [
      'shortId,originalUrl,shortUrl,date,clicks,lastAccess,password',
      ...db.map(d => `"${d.shortId}","${d.originalUrl}","${d.shortUrl}","${d.date}",${d.clicks},"${d.lastAccess || ''}","${d.password || ''}"`)
    ].join('\n');

    res.setHeader('Content-Disposition', 'attachment; filename="shortlinks.csv"');
    res.setHeader('Content-Type', 'text/csv');
    return res.send(csv);
  }

  res.setHeader('Content-Disposition', 'attachment; filename="shortlinks.json"');
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(db, null, 2));
});

// Tampilkan halaman admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin.html'));
});

app.get('/:shortId', (req, res) => {
  const db = loadDB();
  const item = db.find((i) => i.shortId === req.params.shortId);
  if (!item) return res.status(404).send('Halaman tidak ditemukan');

  if (item.password) {
    return res.redirect(`/password.html?id=${item.shortId}`);
  }

  item.clicks = (item.clicks || 0) + 1;
  item.lastAccess = new Date().toISOString();
  saveDB(db);
  res.redirect(item.originalUrl);
});

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
