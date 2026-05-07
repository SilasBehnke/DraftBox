const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ─── CONFIG ────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'draftbox_secret_change_in_prod';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const VALID_PLANS = new Set(['free', 'solo', 'pro']);

// ─── SIMPLE FILE-BASED DB ──────────────────────────────────
const DB_FILE = path.join(__dirname, 'data', 'db.json');
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], docs: [] }));
}

function readDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ─── AUTH MIDDLEWARE ───────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || token === 'demo') {
    req.user = { id: 'demo', plan: 'free' };
    return next();
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ─── ROUTES ───────────────────────────────────────────────
function sendPage(res, file) {
  res.sendFile(path.join(ROOT_DIR, file));
}

app.get('/', (req, res) => sendPage(res, 'index.html'));
app.get('/privacy', (req, res) => sendPage(res, 'privacy.html'));
app.get('/terms', (req, res) => sendPage(res, 'terms.html'));
app.get('/app', (req, res) => res.redirect('/app/login'));
app.get('/app/signup', (req, res) => sendPage(res, 'signup.html'));
app.get('/app/login', (req, res) => sendPage(res, 'signup.html'));
app.get('/app/dashboard', (req, res) => sendPage(res, 'dashboard.html'));

// Serve any additional static files from the project root.
app.use(express.static(ROOT_DIR, { index: false }));

// SIGNUP
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password, profession, plan } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Missing required fields' });

    const db = readDB();
    if (db.users.find(u => u.email === email)) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const selectedPlan = VALID_PLANS.has(plan) ? plan : 'free';
    const user = { id: 'u_' + Date.now(), name, email, password: hashed, profession: profession || '', plan: selectedPlan, created: Date.now() };
    db.users.push(user);
    writeDB(db);

    const token = jwt.sign({ id: user.id, email, plan: user.plan }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { id: user.id, name, email, plan: user.plan, profession: user.profession } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.email === email);
    if (!user) return res.status(400).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ id: user.id, email, plan: user.plan }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { id: user.id, name: user.name, email, plan: user.plan, profession: user.profession } });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// PLAN UPGRADE (demo-friendly billing placeholder)
app.post('/api/account/plan', authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!VALID_PLANS.has(plan) || plan === 'free') {
      return res.status(400).json({ error: 'Invalid plan selection' });
    }

    if (req.user.id === 'demo') {
      return res.json({
        success: true,
        user: { id: 'demo', name: 'Demo User', email: 'demo@draftbox.app', profession: 'Freelancer', plan },
        token: 'demo'
      });
    }

    const db = readDB();
    const user = db.users.find(entry => entry.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.plan = plan;
    writeDB(db);

    const token = jwt.sign({ id: user.id, email: user.email, plan: user.plan }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email, profession: user.profession, plan: user.plan }
    });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// GENERATE DOCUMENT — core product endpoint
app.post('/api/generate', authMiddleware, async (req, res) => {
  const { type, client, project, budget, notes, sender, profession } = req.body;

  if (!client || !project) return res.status(400).json({ error: 'Missing client or project' });

  // Check plan limits
  if (req.user.id !== 'demo') {
    const db = readDB();
    const user = db.users.find(u => u.id === req.user.id);
    if (user) {
      const thisMonthDocs = (db.docs || []).filter(d => {
        if (d.userId !== user.id) return false;
        const docDate = new Date(d.created);
        const now = new Date();
        return docDate.getMonth() === now.getMonth() && docDate.getFullYear() === now.getFullYear();
      }).length;

      const limit = user.plan === 'free' ? 5 : user.plan === 'solo' ? 20 : 9999;
      if (thisMonthDocs >= limit) {
        return res.status(429).json({ error: 'Plan limit reached. Please upgrade.' });
      }
    }
  }

  // Build prompt based on document type
  const typePrompts = {
    proposal: `Write a professional project proposal`,
    sow: `Write a detailed Statement of Work (SOW)`,
    email: `Write a professional client email`,
    brief: `Write a project brief`,
    followup: `Write a follow-up email`,
    cold: `Write a compelling cold outreach email`
  };

  const docType = typePrompts[type] || `Write a professional ${type}`;
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const prompt = `${docType} with these details:

Client/Company: ${client}
Project: ${project}
${budget ? `Budget: ${budget}` : ''}
${notes ? `Key details: ${notes}` : ''}
${sender ? `From: ${sender}` : ''}
${profession ? `Service provider is a: ${profession}` : ''}
Today's date: ${today}

Requirements:
- Write in a confident, professional yet warm tone
- Be specific and concrete, not generic
- Include all relevant sections for this document type
- For proposals/SOWs: include scope, timeline, pricing breakdown, and next steps
- For emails: be direct, friendly, and end with a clear call to action
- Use plain text formatting with clear section headers using dashes or line breaks
- Do NOT use markdown asterisks or hashtags — use ALL CAPS for headers instead
- Length: comprehensive but not padded — say what needs to be said

Write the complete document now:`;

  try {
    if (!ANTHROPIC_API_KEY) throw new Error('No API key');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic API error:', err);
      throw new Error('API error');
    }

    const data = await response.json();
    const content = data.content[0].text;

    // Log usage
    if (req.user.id !== 'demo') {
      const db = readDB();
      if (!db.docs) db.docs = [];
      db.docs.push({ userId: req.user.id, type, client, created: Date.now() });
      writeDB(db);
    }

    res.json({ success: true, content });

  } catch (err) {
    console.error('Generate error:', err.message);
    res.status(500).json({ error: 'Generation failed', message: err.message });
  }
});

// STRIPE WEBHOOK (for subscription management)
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  // TODO: implement after Stripe setup
  // Handle checkout.session.completed to upgrade user plan
  res.json({ received: true });
});

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`DraftBox running on port ${PORT}`);
  console.log(`API key: ${ANTHROPIC_API_KEY ? 'configured ✓' : 'MISSING — set ANTHROPIC_API_KEY'}`);
});

module.exports = app;
