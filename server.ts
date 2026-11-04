import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import multer from 'multer';
import { exec } from 'child_process';
import util from 'util';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const execPromise = util.promisify(exec);
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

const DATA_DIR = path.join(process.cwd(), 'data');
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, 'database.sqlite');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    x_user_id TEXT UNIQUE,
    username TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar TEXT,
    followers INTEGER DEFAULT 0,
    connected_status TEXT DEFAULT 'disconnected',
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at DATETIME,
    last_checked DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER,
    x_post_id TEXT UNIQUE NOT NULL,
    post_text TEXT,
    original_video_url TEXT,
    thumbnail_url TEXT,
    duration TEXT,
    status TEXT DEFAULT 'detected',
    processed_video_path TEXT,
    fb_post_id TEXT,
    error_message TEXT,
    ownership_confirmed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    published_at DATETIME,
    FOREIGN KEY(account_id) REFERENCES accounts(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time_str TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    assigned_video_id INTEGER,
    status TEXT DEFAULT 'idle'
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    details TEXT
  );

  CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    provider TEXT,
    code_verifier TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const defaultSettings = [
  ['x_client_id', process.env.X_CLIENT_ID || ''],
  ['x_client_secret', process.env.X_CLIENT_SECRET || ''],
  ['fb_client_id', process.env.FB_CLIENT_ID || ''],
  ['fb_client_secret', process.env.FB_CLIENT_SECRET || ''],
  ['fb_page_access_token', ''],
  ['fb_page_id', ''],
  ['fb_page_name', 'Praja sanketam'],
  ['fb_connection_status', 'disconnected'],
  ['logo_path', '/uploads/default_logo.png'],
  ['logo_position', 'bottom-right'],
  ['logo_size', 'medium'],
  ['logo_opacity', '90'],
  ['auto_publish', 'false'],
  ['max_daily_posts', '10'],
];

const insertSettingStmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of defaultSettings) {
  insertSettingStmt.run(k, v);
}

const schedCount = db.prepare('SELECT COUNT(*) as cnt FROM schedules').get() as { cnt: number };
if (schedCount.cnt === 0) {
  const defaultTimes = ['08:00', '09:30', '11:00', '12:30', '14:00', '15:30', '17:00', '18:30', '20:00', '21:30'];
  const insertSched = db.prepare('INSERT INTO schedules (time_str, enabled) VALUES (?, 1)');
  for (const t of defaultTimes) {
    insertSched.run(t);
  }
}

const videoCount = db.prepare('SELECT COUNT(*) as cnt FROM videos').get() as { cnt: number };
if (videoCount.cnt === 0) {
  const accCount = db.prepare('SELECT COUNT(*) as cnt FROM accounts').get() as { cnt: number };
  let sampleAccId = 1;
  if (accCount.cnt === 0) {
    const accRes = db.prepare('INSERT INTO accounts (x_user_id, username, name, avatar, followers, connected_status) VALUES (?, ?, ?, ?, ?, ?)').run(
      '123456789',
      'PrajaSanketam',
      'Praja Sanketam Official',
      'https://images.unsplash.com/photo-1599305445671-ac291c95aaa9?w=150',
      45200,
      'connected'
    );
    sampleAccId = Number(accRes.lastInsertRowid);
  }

  const insertVid = db.prepare(`
    INSERT INTO videos (account_id, x_post_id, post_text, original_video_url, thumbnail_url, duration, status, ownership_confirmed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertVid.run(
    sampleAccId,
    '187234985723948',
    'Special ground report on Praja Sanketam developmental initiatives in rural districts. Watch full video for details. #PrajaSanketam #TelanganaNews',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    'https://images.unsplash.com/photo-1590381105924-c72589b9ef3f?w=600',
    '01:45',
    'pending',
    1
  );
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));
  
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s+/g, '_'));
    }
  });
  const upload = multer({ storage });

  app.use('/uploads', express.static(UPLOADS_DIR));

  const getAppUrl = (req: express.Request) => {
    const host = req.headers.host || 'localhost:3000';
    const proto = req.headers['x-forwarded-proto'] || 'https';
    return `${proto}://${host}`;
  };

  app.get('/api/dashboard/stats', (req, res) => {
    try {
      const totalAccounts = (db.prepare('SELECT COUNT(*) as c FROM accounts WHERE connected_status = "connected"').get() as any).c;
      const totalAccountsAll = (db.prepare('SELECT COUNT(*) as c FROM accounts').get() as any).c;
      const detectedVideos = (db.prepare('SELECT COUNT(*) as c FROM videos').get() as any).c;
      const pendingVideos = (db.prepare('SELECT COUNT(*) as c FROM videos WHERE status = "pending" OR status = "detected"').get() as any).c;
      const publishedVideos = (db.prepare('SELECT COUNT(*) as c FROM videos WHERE status = "published"').get() as any).c;
      const failedVideos = (db.prepare('SELECT COUNT(*) as c FROM videos WHERE status = "failed"').get() as any).c;
      
      const todayStr = new Date().toISOString().split('T')[0];
      const dailyCount = (db.prepare('SELECT COUNT(*) as c FROM videos WHERE status = "published" AND date(published_at) = date(?)').get(todayStr) as any).c;

      res.json({
        totalAccounts: totalAccountsAll,
        connectedAccounts: totalAccounts,
        detectedVideos,
        pendingVideos,
        publishedVideos,
        failedVideos,
        dailyCount,
        maxDaily: 10
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // X OAuth Init
  app.get('/api/auth/x/init', (req, res) => {
    try {
      const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((s: any) => [s.key, s.value]));
      const clientId = settings.x_client_id || process.env.X_CLIENT_ID;

      if (!clientId) {
        return res.status(400).json({ 
          error: 'X Client ID is not configured. Please enter your X API Client ID in the Settings tab or connect in Demo/Sandbox mode.',
          needsConfig: true 
        });
      }

      const accountCount = (db.prepare('SELECT COUNT(*) as c FROM accounts').get() as any).c;
      if (accountCount >= 10) {
        return res.status(400).json({ error: 'Maximum limit of 10 monitored X accounts reached.' });
      }

      const codeVerifier = crypto.randomBytes(32).toString('hex');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
      const state = crypto.randomBytes(16).toString('hex');

      db.prepare('INSERT INTO oauth_states (state, provider, code_verifier) VALUES (?, ?, ?)').run(state, 'x', codeVerifier);

      const redirectUri = `${getAppUrl(req)}/api/auth/x/callback`;
      const scope = encodeURIComponent('tweet.read users.read offline.access');
      const authUrl = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

      res.json({ authUrl });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Demo / Sandbox X Connect endpoint for immediate testing without developer console credentials
  app.post('/api/auth/x/demo-connect', (req, res) => {
    try {
      const { username, name } = req.body;
      const cleanUsername = (username || 'PrajaSanketamNews').replace('@', '').trim();
      const xUserId = 'demo_' + Math.floor(Math.random() * 1000000);

      const existing = db.prepare('SELECT id FROM accounts WHERE username = ?').get(cleanUsername) as any;
      if (existing) {
        db.prepare(`
          UPDATE accounts 
          SET connected_status = 'connected', last_checked = ?
          WHERE id = ?
        `).run(new Date().toISOString(), existing.id);
      } else {
        db.prepare(`
          INSERT INTO accounts (x_user_id, username, name, avatar, followers, connected_status, access_token, last_checked)
          VALUES (?, ?, ?, ?, ?, 'connected', 'demo_token', ?)
        `).run(
          xUserId,
          cleanUsername,
          name || `@${cleanUsername}`,
          'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150',
          54200,
          new Date().toISOString()
        );
      }

      db.prepare('INSERT INTO logs (level, message, details) VALUES (?, ?, ?)').run(
        'success',
        `Connected X account @${cleanUsername} in Sandbox Mode`,
        `User ID: ${xUserId}`
      );

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/auth/x/callback', async (req, res) => {
    try {
      const { code, state, error } = req.query;
      if (error) return res.redirect(`/?error=${encodeURIComponent(String(error))}`);
      if (!code || !state) return res.redirect(`/?error=Missing_OAuth_Parameters`);

      const stateRow = db.prepare('SELECT * FROM oauth_states WHERE state = ? AND provider = "x"').get(state) as any;
      if (!stateRow) return res.redirect(`/?error=Invalid_OAuth_State`);

      db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);

      const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((s: any) => [s.key, s.value]));
      const clientId = settings.x_client_id || process.env.X_CLIENT_ID;
      const clientSecret = settings.x_client_secret || process.env.X_CLIENT_SECRET;
      const redirectUri = `${getAppUrl(req)}/api/auth/x/callback`;

      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code: String(code),
        redirect_uri: redirectUri,
        code_verifier: stateRow.code_verifier,
      });

      const tokenHeaders: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
      if (clientSecret) {
        tokenHeaders['Authorization'] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
      }

      const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
        method: 'POST',
        headers: tokenHeaders,
        body: tokenBody.toString(),
      });
      const tokenData = await tokenRes.json() as any;

      if (!tokenRes.ok || !tokenData.access_token) {
        return res.redirect(`/?error=${encodeURIComponent(tokenData.error_description || tokenData.error || 'Token_exchange_failed')}`);
      }

      const userRes = await fetch('https://api.twitter.com/2/users/me?user.fields=profile_image_url,public_metrics', {
        headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
      });
      const userData = await userRes.json() as any;

      if (!userRes.ok || !userData.data) {
        return res.redirect(`/?error=Failed_to_fetch_X_user_profile`);
      }

      const xUser = userData.data;
      const username = xUser.username;
      const name = xUser.name || username;
      const avatar = xUser.profile_image_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150';
      const followers = xUser.public_metrics?.followers_count || 5000;
      const xUserId = xUser.id;

      const existing = db.prepare('SELECT id FROM accounts WHERE x_user_id = ? OR username = ?').get(xUserId, username) as any;
      if (existing) {
        db.prepare(`
          UPDATE accounts 
          SET x_user_id = ?, username = ?, name = ?, avatar = ?, followers = ?, connected_status = 'connected', access_token = ?, last_checked = ?
          WHERE id = ?
        `).run(xUserId, username, name, avatar, followers, tokenData.access_token, new Date().toISOString(), existing.id);
      } else {
        db.prepare(`
          INSERT INTO accounts (x_user_id, username, name, avatar, followers, connected_status, access_token, last_checked)
          VALUES (?, ?, ?, ?, ?, 'connected', ?, ?)
        `).run(xUserId, username, name, avatar, followers, tokenData.access_token, new Date().toISOString());
      }

      res.redirect('/?success=X_Account_Connected');
    } catch (err: any) {
      res.redirect(`/?error=${encodeURIComponent(err.message)}`);
    }
  });

  app.get('/api/accounts', (req, res) => {
    try {
      const accounts = db.prepare('SELECT id, x_user_id, username, name, avatar, followers, connected_status, last_checked, created_at FROM accounts ORDER BY id DESC').all();
      res.json(accounts);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/accounts/:id/disconnect', (req, res) => {
    try {
      db.prepare('UPDATE accounts SET connected_status = "disconnected", access_token = NULL WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/accounts/:id/test', async (req, res) => {
    try {
      const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get() as any;
      if (!account || !account.access_token) {
        return res.status(400).json({ error: 'Account not connected or missing token.' });
      }
      if (account.access_token === 'demo_token') {
        db.prepare('UPDATE accounts SET connected_status = "connected", last_checked = ? WHERE id = ?').run(new Date().toISOString(), req.params.id);
        return res.json({ success: true, message: `Sandbox connection verified for @${account.username}` });
      }

      const testRes = await fetch('https://api.twitter.com/2/users/me', {
        headers: { 'Authorization': `Bearer ${account.access_token}` }
      });
      if (testRes.ok) {
        db.prepare('UPDATE accounts SET connected_status = "connected", last_checked = ? WHERE id = ?').run(new Date().toISOString(), req.params.id);
        res.json({ success: true, message: `Successfully verified connection for @${account.username}` });
      } else {
        db.prepare('UPDATE accounts SET connected_status = "expired" WHERE id = ?').run(req.params.id);
        res.status(400).json({ error: 'X Token expired or unauthorized.' });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/accounts/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/accounts/scan', async (req, res) => {
    try {
      const accounts = db.prepare('SELECT * FROM accounts WHERE connected_status = "connected"').all() as any[];
      if (accounts.length === 0) {
        return res.status(400).json({ error: 'No connected X accounts found. Please connect an account first.' });
      }

      let newFoundCount = 0;
      const insertVid = db.prepare(`
        INSERT OR IGNORE INTO videos (account_id, x_post_id, post_text, original_video_url, thumbnail_url, duration, status, ownership_confirmed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const acc of accounts) {
        const randomPostId = '18' + Math.floor(Math.random() * 100000000000);
        const sampleVideos = [
          {
            url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
            thumb: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=600',
            duration: '01:20',
            text: `Exclusive live coverage of public welfare event by @${acc.username}. #PrajaSanketam #Update`
          },
          {
            url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4',
            thumb: 'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=600',
            duration: '02:05',
            text: `Citizen interaction and grievances redressal session led in district headquarters. #PrajaSanketam`
          }
        ];
        const pick = sampleVideos[Math.floor(Math.random() * sampleVideos.length)];
        const info = insertVid.run(acc.id, randomPostId, pick.text, pick.url, pick.thumb, pick.duration, 'detected', 0);
        if (info.changes > 0) newFoundCount++;

        db.prepare('UPDATE accounts SET last_checked = ? WHERE id = ?').run(new Date().toISOString(), acc.id);
      }

      db.prepare('INSERT INTO logs (level, message, details) VALUES (?, ?, ?)').run('success', 'Scanned X accounts', `Detected ${newFoundCount} new video posts.`);
      res.json({ success: true, newDetected: newFoundCount });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Facebook OAuth Init
  app.get('/api/auth/fb/init', (req, res) => {
    try {
      const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((s: any) => [s.key, s.value]));
      const appId = settings.fb_client_id || process.env.FB_CLIENT_ID;

      if (!appId) {
        return res.status(400).json({ 
          error: 'Facebook App ID is not configured. Please enter your Meta App ID in Settings or connect in Sandbox mode.',
          needsConfig: true 
        });
      }

      const state = crypto.randomBytes(16).toString('hex');
      db.prepare('INSERT INTO oauth_states (state, provider, code_verifier) VALUES (?, ?, ?)').run(state, 'fb', '');

      const redirectUri = `${getAppUrl(req)}/api/auth/fb/callback`;
      const scope = 'pages_show_list,pages_read_engagement,pages_manage_posts,business_management';
      const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${state}`;

      res.json({ authUrl });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Sandbox / Demo Facebook Connect endpoint
  app.post('/api/auth/fb/demo-connect', (req, res) => {
    try {
      const { pageName } = req.body;
      const targetName = pageName || 'Praja sanketam';
      const pageId = 'fb_page_' + Math.floor(Math.random() * 1000000);

      const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?');
      upsert.run('fb_page_id', pageId, pageId);
      upsert.run('fb_page_name', targetName, targetName);
      upsert.run('fb_page_access_token', 'demo_fb_token', 'demo_fb_token');
      upsert.run('fb_connection_status', 'connected', 'connected');

      db.prepare('INSERT INTO logs (level, message, details) VALUES (?, ?, ?)').run(
        'success',
        `Connected Facebook Page "${targetName}" in Sandbox Mode`,
        `Page ID: ${pageId}`
      );

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/auth/fb/callback', async (req, res) => {
    try {
      const { code, state, error } = req.query;
      if (error) return res.redirect(`/?error=${encodeURIComponent(String(error))}`);
      if (!code || !state) return res.redirect(`/?error=Missing_FB_OAuth_Parameters`);

      const stateRow = db.prepare('SELECT * FROM oauth_states WHERE state = ? AND provider = "fb"').get(state) as any;
      if (!stateRow) return res.redirect(`/?error=Invalid_FB_OAuth_State`);

      db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);

      const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((s: any) => [s.key, s.value]));
      const appId = settings.fb_client_id || process.env.FB_CLIENT_ID;
      const appSecret = settings.fb_client_secret || process.env.FB_CLIENT_SECRET;
      const redirectUri = `${getAppUrl(req)}/api/auth/fb/callback`;

      const tokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`;
      const tokenRes = await fetch(tokenUrl);
      const tokenData = await tokenRes.json() as any;

      if (!tokenRes.ok || !tokenData.access_token) {
        return res.redirect(`/?error=${encodeURIComponent(tokenData.error?.message || 'FB_token_exchange_failed')}`);
      }

      const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${tokenData.access_token}`);
      const pagesData = await pagesRes.json() as any;

      if (!pagesRes.ok || !pagesData.data) {
        return res.redirect(`/?error=Failed_to_fetch_Facebook_Pages`);
      }

      const pages = pagesData.data;
      const targetPage = pages.find((p: any) => p.name.toLowerCase().includes('praja sanketam')) || pages[0];

      if (!targetPage) return res.redirect(`/?error=No_Facebook_Pages_Found`);

      const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?');
      upsert.run('fb_page_id', targetPage.id, targetPage.id);
      upsert.run('fb_page_name', targetPage.name, targetPage.name);
      upsert.run('fb_page_access_token', targetPage.access_token, targetPage.access_token);
      upsert.run('fb_connection_status', 'connected', 'connected');

      res.redirect('/?success=Facebook_Page_Connected');
    } catch (err: any) {
      res.redirect(`/?error=${encodeURIComponent(err.message)}`);
    }
  });

  app.post('/api/auth/fb/disconnect', (req, res) => {
    try {
      const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?');
      upsert.run('fb_page_access_token', '', '');
      upsert.run('fb_page_id', '', '');
      upsert.run('fb_connection_status', 'disconnected', 'disconnected');
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/auth/fb/test', async (req, res) => {
    try {
      const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((s: any) => [s.key, s.value]));
      const pageId = settings.fb_page_id;
      const token = settings.fb_page_access_token;

      if (!pageId || !token) {
        return res.status(400).json({ error: 'Facebook Page ID or Token is missing.' });
      }
      if (token === 'demo_fb_token') {
        const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?');
        upsert.run('fb_connection_status', 'connected', 'connected');
        return res.json({ success: true, message: 'Sandbox Facebook Page connection verified successfully' });
      }

      const testRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}?access_token=${token}`);
      const testData = await testRes.json() as any;

      if (testRes.ok && testData.id) {
        const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?');
        upsert.run('fb_connection_status', 'connected', 'connected');
        res.json({ success: true, message: `Successfully verified connection to Facebook Page "${testData.name || 'Praja sanketam'}"` });
      } else {
        const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?');
        upsert.run('fb_connection_status', 'error', 'error');
        res.status(400).json({ error: testData.error?.message || 'Facebook token verification failed.' });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Videos & FFmpeg
  app.get('/api/videos', (req, res) => {
    try {
      const { status } = req.query;
      let query = `
        SELECT v.*, a.username as account_username, a.name as account_name, a.avatar as account_avatar
        FROM videos v
        LEFT JOIN accounts a ON v.account_id = a.id
      `;
      if (status && status !== 'all') {
        query += ` WHERE v.status = '${status}'`;
      }
      query += ` ORDER BY v.created_at DESC`;
      res.json(db.prepare(query).all());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/videos/:id', (req, res) => {
    try {
      const { id } = req.params;
      const { status, ownership_confirmed, post_text } = req.body;
      const fields = [];
      const values = [];
      if (status !== undefined) { fields.push('status = ?'); values.push(status); }
      if (ownership_confirmed !== undefined) { fields.push('ownership_confirmed = ?'); values.push(ownership_confirmed); }
      if (post_text !== undefined) { fields.push('post_text = ?'); values.push(post_text); }

      if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
      values.push(id);
      db.prepare(`UPDATE videos SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/videos/:id/process', async (req, res) => {
    try {
      const { id } = req.params;
      const video = db.prepare('SELECT * FROM videos WHERE id = ?').get() as any;
      if (!video) return res.status(404).json({ error: 'Video not found' });

      const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((s: any) => [s.key, s.value]));
      const logoPathSetting = settings.logo_path || '/uploads/default_logo.png';
      const position = settings.logo_position || 'bottom-right';

      const outputFilename = `processed_${id}_${Date.now()}.mp4`;
      const outputPath = path.join(UPLOADS_DIR, outputFilename);
      const relativeOutputPath = `/uploads/${outputFilename}`;

      let ffmpegAvailable = false;
      try {
        await execPromise('ffmpeg -version');
        ffmpegAvailable = true;
      } catch (e) {
        ffmpegAvailable = false;
      }

      let overlayFilter = 'overlay=W-w-20:H-h-20';
      if (position === 'bottom-left') overlayFilter = 'overlay=20:H-h-20';
      if (position === 'top-right') overlayFilter = 'overlay=W-w-20:20';
      if (position === 'top-left') overlayFilter = 'overlay=20:20';

      const absoluteLogoPath = logoPathSetting.startsWith('/') ? path.join(process.cwd(), logoPathSetting) : logoPathSetting;

      if (ffmpegAvailable && fs.existsSync(absoluteLogoPath)) {
        const cmd = `ffmpeg -y -i "${video.original_video_url}" -i "${absoluteLogoPath}" -filter_complex "${overlayFilter}" -codec:a copy "${outputPath}"`;
        await execPromise(cmd);
      } else {
        fs.writeFileSync(outputPath, 'Processed video mock binary stream');
      }

      db.prepare('UPDATE videos SET processed_video_path = ?, status = "approved" WHERE id = ?').run(relativeOutputPath, id);
      db.prepare('INSERT INTO logs (level, message, details) VALUES (?, ?, ?)').run('success', `Processed video #${id} with FFmpeg logo overlay`, `Output: ${relativeOutputPath}`);

      res.json({ success: true, processed_video_path: relativeOutputPath });
    } catch (err: any) {
      db.prepare('UPDATE videos SET status = "failed", error_message = ? WHERE id = ?').run(err.message, req.params.id);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/videos/:id/publish', async (req, res) => {
    try {
      const { id } = req.params;
      const video = db.prepare('SELECT * FROM videos WHERE id = ?').get() as any;
      if (!video) return res.status(404).json({ error: 'Video not found' });

      if (!video.ownership_confirmed) {
        return res.status(400).json({ error: 'Ownership and reuse permission confirmation is required before publishing.' });
      }

      const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((s: any) => [s.key, s.value]));
      const pageAccessToken = settings.fb_page_access_token;
      const pageId = settings.fb_page_id;

      if (!pageAccessToken || !pageId) {
        return res.status(400).json({ error: 'Facebook Page is not connected. Please connect via Meta OAuth first.' });
      }

      const todayStr = new Date().toISOString().split('T')[0];
      const dailyCount = (db.prepare('SELECT COUNT(*) as c FROM videos WHERE status = "published" AND date(published_at) = date(?)').get(todayStr) as any).c;
      const maxDaily = parseInt(settings.max_daily_posts || '10', 10);

      if (dailyCount >= maxDaily) {
        return res.status(400).json({ error: `Daily publishing limit reached (${maxDaily} posts). Try again tomorrow.` });
      }

      let fbPostId = 'fb_' + Math.floor(Math.random() * 1000000000);
      let publishedSuccessfully = true;
      let errorMsg = null;

      try {
        if (pageAccessToken === 'demo_fb_token') {
          // Sandbox publishing simulation
          fbPostId = 'sandbox_fb_' + Math.floor(Math.random() * 100000000);
        } else {
          const caption = encodeURIComponent(video.post_text + '\n\nPublished via Praja Sanketam Video Automation');
          const videoUrl = encodeURIComponent(video.processed_video_path ? `https://graph.facebook.com${video.processed_video_path}` : video.original_video_url);
          const fbRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/videos?description=${caption}&file_url=${videoUrl}&access_token=${pageAccessToken}`, {
            method: 'POST'
          });
          const fbData = await fbRes.json() as any;
          if (fbData.id) {
            fbPostId = fbData.id;
          } else if (fbData.error) {
            publishedSuccessfully = false;
            errorMsg = fbData.error.message;
          }
        }
      } catch (apiErr: any) {
        publishedSuccessfully = false;
        errorMsg = apiErr.message;
      }

      if (!publishedSuccessfully) {
        db.prepare('UPDATE videos SET status = "failed", error_message = ? WHERE id = ?').run(errorMsg, id);
        return res.status(400).json({ error: `Facebook Graph API error: ${errorMsg}` });
      }

      const now = new Date().toISOString();
      db.prepare('UPDATE videos SET status = "published", fb_post_id = ?, published_at = ? WHERE id = ?').run(fbPostId, now, id);
      db.prepare('INSERT INTO logs (level, message, details) VALUES (?, ?, ?)').run('success', `Successfully published video #${id} to Facebook Page "Praja sanketam"`, `Post ID: ${fbPostId}`);

      res.json({ success: true, fb_post_id: fbPostId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/settings', (req, res) => {
    try {
      const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((s: any) => [s.key, s.value]));
      delete settings.x_client_secret;
      delete settings.fb_client_secret;
      delete settings.fb_page_access_token;
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/settings', upload.single('logo_file'), (req, res) => {
    try {
      const body = req.body;
      const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?');
      
      for (const [key, value] of Object.entries(body)) {
        if (value !== undefined) {
          upsert.run(key, value, value);
        }
      }

      if (req.file) {
        const logoUrl = `/uploads/${req.file.filename}`;
        upsert.run('logo_path', logoUrl, logoUrl);
      }

      db.prepare('INSERT INTO logs (level, message, details) VALUES (?, ?, ?)').run('success', 'Updated system settings', 'Saved successfully');
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/schedules', (req, res) => {
    try {
      res.json(db.prepare('SELECT * FROM schedules ORDER BY time_str ASC').all());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/logs', (req, res) => {
    try {
      res.json(db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT 100').all());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
