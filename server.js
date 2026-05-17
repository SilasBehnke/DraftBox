const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const supabase = require('./lib/db');
const DOC_TYPES = require('./lib/documentTypes');
const { buildPrompt } = require('./lib/promptBuilder');
const { exportToDocx } = require('./lib/docxExporter');

const app = express();
app.use(cors());
app.use(express.json());

// ─── CONFIG ────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'draftbox_secret_change_in_prod';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;

const VALID_PLANS = new Set(['free', 'solo', 'starter', 'pro', 'business', 'agency']);

// ─── PLAN HELPERS ──────────────────────────────────────────
function planModel(plan) {
  return (plan === 'free') ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6';
}

function planLimit(plan) {
  if (plan === 'free')                         return { count: 2,       period: 'total' };
  if (plan === 'solo' || plan === 'starter')   return { count: 15,      period: 'monthly' };
  return                                              { count: Infinity, period: 'monthly' };
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

// ─── STATIC & PAGE ROUTES ─────────────────────────────────
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

app.use(express.static(ROOT_DIR, { index: false }));

// ─── DOCUMENT TYPE REGISTRY ────────────────────────────────
app.get('/api/doc-types', (req, res) => {
  res.json(Object.values(DOC_TYPES));
});

// ─── AUTH ──────────────────────────────────────────────────
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password, profession, plan } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Missing required fields' });

    const { data: existing } = await supabase.from('users').select('id').eq('email', email).single();
    if (existing) return res.status(400).json({ error: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 10);
    const selectedPlan = VALID_PLANS.has(plan) ? plan : 'free';
    const user = {
      id: 'u_' + Date.now(),
      name,
      email,
      password: hashed,
      profession: profession || '',
      plan: selectedPlan,
      voice_profile: '',
      created: Date.now(),
    };
    const { error } = await supabase.from('users').insert(user);
    if (error) throw error;

    const token = jwt.sign({ id: user.id, email, plan: user.plan }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { id: user.id, name, email, plan: user.plan, profession: user.profession, voiceProfile: '' } });
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data: user } = await supabase.from('users').select('*').eq('email', email).single();
    if (!user) return res.status(400).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ id: user.id, email, plan: user.plan }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { id: user.id, name: user.name, email, plan: user.plan, profession: user.profession, voiceProfile: user.voice_profile || '' } });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── ACCOUNT ───────────────────────────────────────────────
app.post('/api/account/plan', authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!VALID_PLANS.has(plan) || plan === 'free') {
      return res.status(400).json({ error: 'Invalid plan selection' });
    }

    if (req.user.id === 'demo') {
      return res.json({
        success: true,
        user: { id: 'demo', name: 'Demo User', email: 'demo@draftbox.app', profession: '', plan, voiceProfile: '' },
        token: 'demo',
      });
    }

    const { data: user } = await supabase.from('users').select('*').eq('id', req.user.id).single();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { error } = await supabase.from('users').update({ plan }).eq('id', req.user.id);
    if (error) throw error;

    const token = jwt.sign({ id: user.id, email: user.email, plan }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, profession: user.profession, plan, voiceProfile: user.voice_profile || '' } });
  } catch (err) {
    console.error('Plan update error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/account/voice', authMiddleware, async (req, res) => {
  try {
    const { voiceProfile } = req.body;
    if (typeof voiceProfile !== 'string') return res.status(400).json({ error: 'Invalid voice profile' });
    if (req.user.id === 'demo') return res.json({ success: true });

    const { data: user } = await supabase.from('users').select('id').eq('id', req.user.id).single();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { error } = await supabase.from('users').update({ voice_profile: voiceProfile.slice(0, 2000) }).eq('id', req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('Voice update error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── DOCUMENTS ─────────────────────────────────────────────
app.get('/api/docs', authMiddleware, async (req, res) => {
  try {
    if (req.user.id === 'demo') return res.json({ success: true, docs: [] });
    const { data: rows, error } = await supabase
      .from('docs')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created', { ascending: false });
    if (error) throw error;
    const docs = (rows || []).map(d => ({ ...d, userId: d.user_id }));
    res.json({ success: true, docs });
  } catch (err) {
    console.error('Get docs error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/docs/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.id === 'demo') return res.json({ success: true });
    const { content, title } = req.body;
    const { data: doc } = await supabase
      .from('docs')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const updates = {};
    if (typeof content === 'string') updates.content = content;
    if (typeof title === 'string') updates.title = title;

    const { error } = await supabase.from('docs').update(updates).eq('id', req.params.id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('Update doc error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/docs/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.id === 'demo') return res.json({ success: true });
    const { data: doc } = await supabase
      .from('docs')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const { error } = await supabase.from('docs').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('Delete doc error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DOCX EXPORT — Business/Agency only
app.get('/api/docs/:id/export/docx', authMiddleware, async (req, res) => {
  try {
    const { plan } = req.user;
    if (plan !== 'business' && plan !== 'agency' && plan !== 'pro') {
      return res.status(403).json({ error: 'DOCX export requires Business plan or higher.' });
    }
    if (req.user.id === 'demo') return res.status(403).json({ error: 'Not available in demo mode.' });

    const { data: doc } = await supabase
      .from('docs')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const docType = DOC_TYPES[doc.type];
    const buffer = await exportToDocx({
      ...doc,
      userId: doc.user_id,
      outputStructure: docType ? docType.outputStructure : [],
    });

    const filename = doc.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.docx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('DOCX export error:', err.message);
    res.status(500).json({ error: 'Export failed' });
  }
});

// ─── GENERATE ──────────────────────────────────────────────
app.post('/api/generate', authMiddleware, async (req, res) => {
  const { type, fields = {}, docId: clientDocId } = req.body;

  const docType = DOC_TYPES[type];
  if (!docType) return res.status(400).json({ error: 'Unknown document type' });

  const missing = (docType.requiredFields || []).filter(f => !fields[f.key] || !String(fields[f.key]).trim());
  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.map(f => f.label).join(', ')}` });
  }

  let voiceProfile = '';

  if (req.user.id !== 'demo') {
    const { data: user } = await supabase.from('users').select('*').eq('id', req.user.id).single();
    if (user) {
      voiceProfile = user.voice_profile || '';
      const { count, period } = planLimit(user.plan);

      if (count < Infinity) {
        const { data: userDocs } = await supabase.from('docs').select('id, created').eq('user_id', user.id);
        let usedCount;
        if (period === 'total') {
          usedCount = (userDocs || []).length;
        } else {
          const now = new Date();
          usedCount = (userDocs || []).filter(d => {
            const dd = new Date(d.created);
            return dd.getMonth() === now.getMonth() && dd.getFullYear() === now.getFullYear();
          }).length;
        }
        if (usedCount >= count) {
          return res.status(429).json({ error: 'Plan limit reached. Please upgrade.' });
        }
      }
    }
  }

  const { system, userMessage } = buildPrompt(docType, fields, voiceProfile);
  const model = planModel(req.user.plan);

  try {
    if (!ANTHROPIC_API_KEY) throw new Error('No API key');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2500,
        system,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic API error:', err);
      throw new Error('API error');
    }

    const data = await response.json();
    const content = data.content[0].text;

    const primaryKey = docType.requiredFields[0]?.key;
    const primaryVal = primaryKey ? (fields[primaryKey] || '') : '';
    const title = `${docType.label}${primaryVal ? ' — ' + primaryVal : ''}`;

    if (req.user.id !== 'demo') {
      const docId = clientDocId || ('doc_' + Date.now());
      const { error } = await supabase.from('docs').insert({
        id: docId,
        user_id: req.user.id,
        type,
        title,
        fields,
        content,
        created: Date.now(),
      });
      if (error) throw error;
      return res.json({ success: true, content, title, docId });
    }

    res.json({ success: true, content, title });
  } catch (err) {
    console.error('Generate error:', err.message);
    res.status(500).json({ error: 'Generation failed', message: err.message });
  }
});

// REGENERATE SINGLE SECTION
app.post('/api/generate/section', authMiddleware, async (req, res) => {
  try {
    const { type, fields = {}, sectionName, currentContent } = req.body;
    const docType = DOC_TYPES[type];
    if (!docType || !sectionName) return res.status(400).json({ error: 'Invalid request' });
    if (!ANTHROPIC_API_KEY) throw new Error('No API key');

    const model = planModel(req.user.plan);
    const { system } = buildPrompt(docType, fields, '');

    const userMessage = `Here is the current document:\n\n${currentContent}\n\n---\n\nRewrite ONLY the "${sectionName}" section of this document. Keep everything else unchanged. Return the full updated document.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: 2500, system, messages: [{ role: 'user', content: userMessage }] }),
    });

    if (!response.ok) throw new Error('API error');
    const data = await response.json();
    res.json({ success: true, content: data.content[0].text });
  } catch (err) {
    console.error('Section regen error:', err.message);
    res.status(500).json({ error: 'Section regeneration failed' });
  }
});

// STRIPE WEBHOOK (stub)
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  res.json({ received: true });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`DraftBox running on port ${PORT}`);
  console.log(`API key: ${ANTHROPIC_API_KEY ? 'configured ✓' : 'MISSING — set ANTHROPIC_API_KEY'}`);
});

module.exports = app;
