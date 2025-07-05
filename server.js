// server.js - versi lengkap dengan notifikasi Telegram, backup, proteksi domain & input fix
const express = require('express');
const fs = require('fs');
const path = require('path');
const { nanoid } = require('nanoid');
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
  if (!host.includes('lys.my.id') && !host.includes('localhost')) {
    return res.status(403).send('❌ Akses ditolak. Domain tidak diizinkan.');
  }
  next();
});

// Load database
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

// === Telegram Notif Helper ===
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

// API to create shortlink
app.post('/api/shorten', (req, res) => {
  const { originalUrl, password } = req.body;

  if (!originalUrl) return res.status(400).json({ error: 'URL tidak boleh kosong.' });

  const shortId = nanoid(6);
  const date = new Date().toISOString();

  const db = loadDB();
  const shortUrl = `https://lys.my.id/${shortId}`;
  const data = {
    shortId,
    originalUrl,
    shortUrl,
    date,
    clicks: 0,
    lastAccess: null,
    password: password || null
  };

  db.push(data);
  saveDB(db);

  // Kirim notifikasi ke Telegram
  const notif = `🔗 Shortlink baru dibuat:\n\n` +
                `📎 Original: ${originalUrl}\n` +
                `🆔 Slug: ${shortId}\n` +
                `🔐 Password: ${password ? 'YA' : 'TIDAK'}\n` +
                `📅 Tanggal: ${date}`;
  kirimNotifikasiPesan(notif).catch(console.error);

  res.json(data);
});

// API untuk kirim backup DB ke Telegram
app.get('/api/admin/backup', async (req, res) => {
  try {
    await kirimFileKeTelegram(DB_PATH);
    res.json({ success: true, message: 'Backup terkirim ke Telegram!' });
  } catch (e) {
    res.status(500).json({ error: 'Gagal kirim backup: ' + e.message });
  }
});

// Proteksi akses halaman tertentu
app.get(['/admin', '/dashboard', '/settings'], (req, res) => {
  res.status(403).send('🚫 Akses ditolak. Halaman ini dilindungi.');
});

// Route redirect berdasarkan shortId
app.get('/:shortId', (req, res) => {
  const db = loadDB();
  const item = db.find((i) => i.shortId === req.params.shortId);
  if (!item) return res.status(404).send('Shortlink tidak ditemukan');

  // Hitung klik
  item.clicks = (item.clicks || 0) + 1;
  item.lastAccess = new Date().toISOString();
  saveDB(db);

  // Jika ada password, arahkan ke halaman verifikasi
  if (item.password) {
    return res.redirect(`/password.html?id=${item.shortId}`);
  }

  res.redirect(item.originalUrl);
});

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
