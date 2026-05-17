// ─── INIT ──────────────────────────────────────────────────
async function init() {
  State.init();

  // Load doc types from server
  try {
    const types = await API.getDocTypes();
    State.docTypes = {};
    types.forEach(t => { State.docTypes[t.slug] = t; });
  } catch {
    State.docTypes = {};
  }

  // Ensure demo user in place if no auth
  if (!State.user) {
    State.setUser({ name: 'Demo User', email: 'demo@draftbox.app', plan: 'free', profession: '', voiceProfile: '' });
  }

  // Load docs from server (authoritative), fall back to localStorage cache
  try {
    const result = await API.getDocs();
    if (result.success) State.setDocs(result.docs);
  } catch {
    // localStorage docs already loaded by State.init()
  }

  updateUserUI();
  renderSidebarLibrary();
  showDashboard();
  updateStats();
  updateUsage();
  populateDocTypeDropdown();
}

// ─── USER UI ───────────────────────────────────────────────
function updateUserUI() {
  const u = State.user;
  if (!u) return;
  const initials = u.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  el('user-avatar').textContent = initials;
  el('user-name').textContent = u.name;
  el('user-plan').textContent = planDisplayName(u.plan);
  if (u.plan !== 'free') el('upgrade-section').style.display = 'none';
}

function planDisplayName(plan) {
  return { free: 'Free trial', solo: 'Solo plan', starter: 'Starter plan', pro: 'Pro plan', business: 'Business plan', agency: 'Agency plan' }[plan] || 'Free trial';
}

// ─── DOCUMENT TYPE DROPDOWN ────────────────────────────────
function populateDocTypeDropdown() {
  const select = el('doc-type');
  if (!select) return;
  select.innerHTML = '';
  const categories = { proposals: 'Proposals', contracts: 'Contracts', governance: 'Governance', closeout: 'Closeout' };
  Object.entries(categories).forEach(([cat, label]) => {
    const types = Object.values(State.docTypes).filter(t => t.category === cat);
    if (!types.length) return;
    const group = document.createElement('optgroup');
    group.label = label;
    types.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.slug;
      opt.textContent = t.label;
      group.appendChild(opt);
    });
    select.appendChild(group);
  });
  // Render form for the default selected type
  const firstSlug = select.value;
  if (firstSlug) renderDocForm(firstSlug);
}

// ─── DYNAMIC FORM ──────────────────────────────────────────
function renderDocForm(slug) {
  const docType = State.docTypes[slug];
  const container = el('dynamic-fields');
  if (!docType || !container) return;

  const allFields = [...(docType.requiredFields || []), ...(docType.optionalFields || [])];
  const rows = [];
  for (let i = 0; i < allFields.length; i += 2) {
    const left = allFields[i];
    const right = allFields[i + 1];
    rows.push(`<div class="form-row">
      ${buildFieldInput(left, docType.requiredFields.includes(left))}
      ${right ? buildFieldInput(right, docType.requiredFields.includes(right)) : '<div></div>'}
    </div>`);
  }
  container.innerHTML = rows.join('');
}

function buildFieldInput(field, required) {
  const req = required ? ' <span style="color:var(--rust)">*</span>' : '';
  const id = `field-${field.key}`;

  let input;
  if (field.type === 'textarea' || field.type === 'multiline-list') {
    input = `<textarea id="${id}" name="${field.key}" placeholder="${esc(field.placeholder || '')}" rows="3"></textarea>`;
  } else if (field.type === 'select' && field.options) {
    const opts = field.options.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
    input = `<select id="${id}" name="${field.key}">${opts}</select>`;
  } else {
    const inputType = field.type === 'date' ? 'date' : 'text';
    input = `<input type="${inputType}" id="${id}" name="${field.key}" placeholder="${esc(field.placeholder || '')}">`;
  }

  return `<div class="form-group">
    <label for="${id}">${esc(field.label)}${req}</label>
    ${input}
    ${field.helpText ? `<p style="font-size:0.72rem;color:var(--muted);margin-top:0.2rem">${esc(field.helpText)}</p>` : ''}
  </div>`;
}

function collectFormValues(slug) {
  const docType = State.docTypes[slug];
  if (!docType) return {};
  const allFields = [...(docType.requiredFields || []), ...(docType.optionalFields || [])];
  const values = {};
  allFields.forEach(f => {
    const input = document.querySelector(`#dynamic-fields [name="${f.key}"]`);
    if (input) values[f.key] = input.value.trim();
  });
  return values;
}

// ─── SIDEBAR LIBRARY ───────────────────────────────────────
function renderSidebarLibrary() {
  const container = el('library-links');
  if (!container || !State.docTypes) return;
  const categories = { proposals: 'Proposals', contracts: 'Contracts', governance: 'Governance', closeout: 'Closeout' };
  container.innerHTML = Object.entries(categories).map(([cat, label]) => {
    const types = Object.values(State.docTypes).filter(t => t.category === cat);
    if (!types.length) return '';
    return `<span class="sidebar-section">${label}</span>` +
      types.map(t => `<button class="sidebar-link" id="nav-${t.slug}" onclick="filterDocs('${t.slug}')">${t.label}</button>`).join('');
  }).join('');
}

// ─── STATS & USAGE ─────────────────────────────────────────
function updateStats() {
  el('stat-total').textContent = State.docs.length;
  const now = new Date();
  const monthCount = State.docs.filter(d => {
    const dd = new Date(d.created);
    return dd.getMonth() === now.getMonth() && dd.getFullYear() === now.getFullYear();
  }).length;
  el('stat-month').textContent = monthCount;

  if (State.docs.length > 0) {
    const counts = {};
    State.docs.forEach(d => counts[d.type] = (counts[d.type] || 0) + 1);
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    const topType = State.docTypes[top];
    el('stat-type').textContent = topType ? topType.label : top;
  } else {
    el('stat-type').textContent = '—';
  }
}

function updateUsage() {
  const plan = State.user?.plan || 'free';
  const now = new Date();
  let used, limit, period;

  if (plan === 'free') {
    used = State.docs.length;
    limit = 2;
    period = 'total';
  } else if (plan === 'solo' || plan === 'starter') {
    used = State.docs.filter(d => { const dd = new Date(d.created); return dd.getMonth() === now.getMonth() && dd.getFullYear() === now.getFullYear(); }).length;
    limit = 15;
    period = 'monthly';
  } else {
    el('upgrade-section').style.display = 'none';
    el('docs-used-label').textContent = 'Unlimited documents';
    return;
  }

  const remaining = Math.max(0, limit - used);
  el('docs-used-label').textContent = `${used} of ${limit} used${period === 'monthly' ? ' this month' : ''}`;

  const upgradeCard = el('upgrade-section');
  if (upgradeCard) {
    const p = upgradeCard.querySelector('p');
    if (p) p.innerHTML = `${remaining} document${remaining !== 1 ? 's' : ''} remaining on ${planDisplayName(plan)}.`;
  }
}

// ─── DOCUMENT GRID ─────────────────────────────────────────
function renderDocs(filterSlug) {
  const grid = el('doc-grid');
  let list = filterSlug ? State.docs.filter(d => d.type === filterSlug) : State.docs;
  list = [...list].sort((a, b) => b.created - a.created);

  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <h3 class="empty-title">No documents yet</h3>
      <p class="empty-sub">Create your first document in seconds</p>
      <button class="btn-ghost" onclick="openNewDoc()">Create document →</button>
    </div>`;
    return;
  }

  grid.innerHTML = list.map(doc => {
    const docType = State.docTypes[doc.type] || {};
    const badgeBg = docType.badgeColor?.bg || '#f5f2ec';
    const badgeText = docType.badgeColor?.text || '#7a756e';
    return `<div class="doc-card" onclick="openDoc('${doc.id}')">
      <span class="doc-type-badge" style="background:${badgeBg};color:${badgeText}">${esc(docType.label || doc.type)}</span>
      <h3 class="doc-title">${esc(doc.title || doc.type)}</h3>
      <p class="doc-client">${esc(doc.client || primaryFieldValue(doc))}</p>
      <div class="doc-footer">
        <span class="doc-date">${formatDate(doc.created)}</span>
        <div class="doc-actions" onclick="event.stopPropagation()">
          <button class="doc-btn" onclick="saveAsTemplate('${doc.id}')">Template</button>
          <button class="doc-btn" onclick="copyDocById('${doc.id}')">Copy</button>
          <button class="doc-btn" onclick="deleteDoc('${doc.id}')">Delete</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function primaryFieldValue(doc) {
  if (doc.fields) {
    const val = doc.fields.client || doc.fields.companyName || doc.fields.hiringParty || doc.fields.issuingOrg || doc.fields.disclosingParty;
    if (val) return val;
  }
  return doc.client || '';
}

// ─── VIEWS ─────────────────────────────────────────────────
function showDashboard() {
  State.currentView = 'dashboard';
  State.currentFilter = null;
  el('page-title').textContent = 'Your documents';
  el('docs-section-title').textContent = 'Recent documents';
  el('doc-grid').style.display = '';
  el('templates-view') && (el('templates-view').style.display = 'none');
  renderDocs();
  updateActiveNav('dashboard');
}

function filterDocs(slug) {
  State.currentView = 'library';
  State.currentFilter = slug;
  const docType = State.docTypes[slug];
  const label = docType ? docType.label : slug;
  el('page-title').textContent = label + ' library';
  el('docs-section-title').textContent = label + 's';
  el('doc-grid').style.display = '';
  el('templates-view') && (el('templates-view').style.display = 'none');
  renderDocs(slug);
  updateActiveNav(slug);
}

function showTemplates() {
  State.currentView = 'templates';
  State.currentFilter = null;
  el('page-title').textContent = 'Templates';
  el('docs-section-title').textContent = 'Saved templates';
  el('doc-grid').style.display = 'none';
  renderTemplatesView();
  updateActiveNav('templates');
}

function showVoice() {
  State.currentView = 'voice';
  el('page-title').textContent = 'Voice training';
  el('docs-section-title').textContent = 'Writing voice';
  el('doc-grid').style.display = '';
  el('templates-view') && (el('templates-view').style.display = 'none');
  renderVoiceTraining();
  updateActiveNav('voice');
}

function updateActiveNav(key) {
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  const active = el(`nav-${key}`);
  if (active) active.classList.add('active');
}

// ─── TEMPLATES ─────────────────────────────────────────────
function saveAsTemplate(docId) {
  const doc = State.docs.find(d => d.id === docId);
  if (!doc) return;
  const templates = JSON.parse(localStorage.getItem('draftbox_templates') || '[]');
  if (templates.find(t => t.id === docId)) { showToast('Already saved as template'); return; }
  templates.push({ ...doc, templateId: 'tpl_' + Date.now() });
  localStorage.setItem('draftbox_templates', JSON.stringify(templates));
  showToast('Saved as template ✓');
}

function renderTemplatesView() {
  const grid = el('doc-grid');
  const templates = JSON.parse(localStorage.getItem('draftbox_templates') || '[]');
  grid.style.display = '';

  if (!templates.length) {
    grid.innerHTML = `<div class="empty-state">
      <h3 class="empty-title">No templates yet</h3>
      <p class="empty-sub">Generate a document and click "Template" to save it for reuse</p>
      <button class="btn-ghost" onclick="openNewDoc()">Create a document →</button>
    </div>`;
    return;
  }

  grid.innerHTML = templates.map(tpl => {
    const docType = State.docTypes[tpl.type] || {};
    const badgeBg = docType.badgeColor?.bg || '#f5f2ec';
    const badgeText = docType.badgeColor?.text || '#7a756e';
    return `<div class="doc-card">
      <span class="doc-type-badge" style="background:${badgeBg};color:${badgeText}">${esc(docType.label || tpl.type)}</span>
      <h3 class="doc-title">${esc(tpl.title || tpl.type)}</h3>
      <p class="doc-client">${esc(primaryFieldValue(tpl))}</p>
      <div class="doc-footer">
        <span class="doc-date">Saved ${formatDate(tpl.created)}</span>
        <div class="doc-actions">
          <button class="doc-btn" onclick="openFromTemplate('${tpl.templateId}')">Use</button>
          <button class="doc-btn" onclick="deleteTemplate('${tpl.templateId}')">Delete</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function openFromTemplate(templateId) {
  const templates = JSON.parse(localStorage.getItem('draftbox_templates') || '[]');
  const tpl = templates.find(t => t.templateId === templateId);
  if (!tpl) return;
  State.templatePrefill = tpl;
  openNewDoc();
  // After modal opens, select the type and prefill fields
  setTimeout(() => {
    const select = el('doc-type');
    if (select) { select.value = tpl.type; renderDocForm(tpl.type); }
    if (tpl.fields) {
      Object.entries(tpl.fields).forEach(([key, val]) => {
        const input = document.querySelector(`#dynamic-fields [name="${key}"]`);
        if (input) input.value = val;
      });
    }
  }, 50);
}

function deleteTemplate(templateId) {
  if (!confirm('Remove this template?')) return;
  let templates = JSON.parse(localStorage.getItem('draftbox_templates') || '[]');
  templates = templates.filter(t => t.templateId !== templateId);
  localStorage.setItem('draftbox_templates', JSON.stringify(templates));
  renderTemplatesView();
  showToast('Template removed');
}

// ─── VOICE TRAINING ────────────────────────────────────────
function renderVoiceTraining() {
  const grid = el('doc-grid');
  const plan = State.user?.plan || 'free';
  const hasPro = ['pro', 'business', 'agency'].includes(plan);

  if (hasPro) {
    const existing = State.user?.voiceProfile || '';
    grid.innerHTML = `<div class="voice-panel">
      <h3>Your writing voice</h3>
      <p>Describe your style and preferences. DraftBox will apply this guidance to every document it generates for you.</p>
      <textarea id="voice-input" placeholder="E.g. Direct and confident. Avoid corporate jargon. My proposals lead with client outcomes, not our process. Formal for contracts, warmer for proposals.">${esc(existing)}</textarea>
      <button class="voice-save-btn" onclick="saveVoiceProfile()">Save voice profile</button>
    </div>`;
  } else {
    grid.innerHTML = `<div class="empty-state">
      <h3 class="empty-title">Voice training is a Business feature</h3>
      <p class="empty-sub">Upgrade to Business to save your writing style and have DraftBox match your voice across every document.</p>
      <button class="btn-ghost" onclick="changePlan('business')">Upgrade to Business →</button>
    </div>`;
  }
}

async function saveVoiceProfile() {
  const text = el('voice-input')?.value?.trim() || '';
  try {
    await API.updateVoice(text);
    State.user.voiceProfile = text;
    State.setUser(State.user);
    showToast('Voice profile saved ✓');
  } catch (err) {
    showToast(err.message || 'Could not save voice profile');
  }
}

// ─── NEW DOC MODAL ─────────────────────────────────────────
function openNewDoc() {
  el('new-doc-modal').classList.add('open');
}

function closeNewDoc() {
  el('new-doc-modal').classList.remove('open');
  State.templatePrefill = null;
}

// ─── GENERATE ──────────────────────────────────────────────
async function generateDocument() {
  const typeSlug = el('doc-type').value;
  const docType = State.docTypes[typeSlug];
  if (!docType) return;

  const fields = collectFormValues(typeSlug);

  // Client-side required field check
  const missing = (docType.requiredFields || []).filter(f => !fields[f.key]);
  if (missing.length) {
    showToast(`Please fill in: ${missing.map(f => f.label).join(', ')}`);
    return;
  }

  // Free plan total limit check
  const plan = State.user?.plan || 'free';
  if (plan === 'free' && State.docs.length >= 2) {
    showToast('Free trial limit reached. Upgrade to continue.');
    return;
  }

  const btn = el('generate-btn');
  btn.textContent = 'Generating…';
  btn.disabled = true;

  closeNewDoc();

  // Optimistic local doc entry for immediate viewer open
  const localId = 'doc_' + Date.now();
  const title = `${docType.label}${fields.client || fields.companyName || fields.issuingOrg ? ' — ' + (fields.client || fields.companyName || fields.issuingOrg) : ''}`;
  State.currentDoc = { id: localId, type: typeSlug, title, fields, content: '', created: Date.now() };

  openViewer(State.currentDoc, true);

  try {
    const result = await API.generate({ type: typeSlug, fields, docId: localId });
    const content = result.content;
    const finalId = result.docId || localId;
    const finalTitle = result.title || title;

    State.currentDoc = { ...State.currentDoc, id: finalId, title: finalTitle, content };
    State.upsertDoc(State.currentDoc);

    document.getElementById('generating-state').style.display = 'none';
    const editor = el('doc-editor');
    editor.style.display = 'block';
    await typeWriter(editor, content);

    updateViewerAfterGenerate();
    updateStats();
    updateUsage();
    renderDocs(State.currentFilter);

  } catch (err) {
    // Client-side fallback for demo/offline
    const fallback = buildFallbackContent(docType, fields);
    State.currentDoc.content = fallback;
    State.upsertDoc(State.currentDoc);

    document.getElementById('generating-state').style.display = 'none';
    const editor = el('doc-editor');
    editor.style.display = 'block';
    await typeWriter(editor, fallback);
    showToast('Live AI is unavailable — showing local demo draft.');
    updateViewerAfterGenerate();
    updateStats();
    updateUsage();
    renderDocs(State.currentFilter);
  }

  btn.textContent = 'Generate document →';
  btn.disabled = false;
}

function buildFallbackContent(docType, fields) {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const header = `${docType.label.toUpperCase()}\nVersion v1.0 | ${today}\n\n${'—'.repeat(50)}\n\n`;
  const sections = (docType.outputStructure || []).map(s =>
    `${s.toUpperCase()}\n${'—'.repeat(40)}\n\n[This section will be generated by AI when the API connection is available.]\n`
  ).join('\n');
  return header + sections;
}

// ─── TYPEWRITER ────────────────────────────────────────────
async function typeWriter(el, text) {
  el.value = '';
  const speed = Math.max(3, Math.floor(2500 / text.length));
  for (let i = 0; i < text.length; i++) {
    el.value += text[i];
    el.scrollTop = el.scrollHeight;
    if (i % 10 === 0) await new Promise(r => setTimeout(r, speed));
  }
}

// ─── DOCUMENT VIEWER ───────────────────────────────────────
function openViewer(doc, generating = false) {
  el('viewer-title').textContent = doc.title;
  const editor = el('doc-editor');

  if (generating) {
    el('generating-state').style.display = 'flex';
    editor.style.display = 'none';
    editor.value = '';
  } else {
    el('generating-state').style.display = 'none';
    editor.style.display = 'block';
    editor.value = doc.content;
  }

  el('doc-viewer').classList.add('open');
  State.currentDoc = doc;

  // Legal disclaimer
  updateLegalBanner(doc.type);
  // Section nav (only when content is ready)
  if (!generating && doc.content) renderSectionNav(doc);
  else clearSectionNav();

  // DOCX button visibility
  updateDocxButton();
}

function updateViewerAfterGenerate() {
  if (!State.currentDoc) return;
  renderSectionNav(State.currentDoc);
  updateLegalBanner(State.currentDoc.type);
}

function openDoc(id) {
  const doc = State.docs.find(d => d.id === id);
  if (doc) openViewer(doc, false);
}

function closeViewer() {
  if (State.currentDoc) {
    const content = el('doc-editor').value;
    State.currentDoc.content = content;
    State.upsertDoc(State.currentDoc);
    // Persist edit to server (fire and forget)
    API.updateDoc(State.currentDoc.id, content).catch(() => {});
  }
  el('doc-viewer').classList.remove('open');
  clearSectionNav();
}

async function regenerateDoc() {
  if (!State.currentDoc) return;
  const editor = el('doc-editor');
  el('generating-state').style.display = 'flex';
  editor.style.display = 'none';

  try {
    const result = await API.generate({
      type: State.currentDoc.type,
      fields: State.currentDoc.fields || {},
    });
    State.currentDoc.content = result.content;
  } catch {
    State.currentDoc.content = buildFallbackContent(
      State.docTypes[State.currentDoc.type] || { label: State.currentDoc.type, outputStructure: [] },
      State.currentDoc.fields || {}
    );
  }

  State.upsertDoc(State.currentDoc);
  API.updateDoc(State.currentDoc.id, State.currentDoc.content).catch(() => {});

  el('generating-state').style.display = 'none';
  editor.style.display = 'block';
  await typeWriter(editor, State.currentDoc.content);
  renderSectionNav(State.currentDoc);
}

// ─── SECTION NAVIGATOR ─────────────────────────────────────
function parseSections(content, outputStructure) {
  const lines = content.split('\n');
  const sections = [];
  outputStructure.forEach((name, idx) => {
    // Find line index matching this section header (case-insensitive)
    const lineIdx = lines.findIndex(l => l.trim().toUpperCase() === name.toUpperCase());
    sections.push({ name, lineIdx });
  });
  return sections.filter(s => s.lineIdx >= 0);
}

function renderSectionNav(doc) {
  const nav = el('section-nav');
  if (!nav) return;
  const docType = State.docTypes[doc.type];
  if (!docType || !doc.content) { nav.innerHTML = ''; return; }

  const sections = parseSections(doc.content, docType.outputStructure);
  if (!sections.length) { nav.innerHTML = ''; return; }

  nav.innerHTML = sections.map((s, i) =>
    `<button class="section-nav-link" onclick="scrollToSection(${i}, '${esc(s.name)}')" title="${esc(s.name)}">${esc(s.name)}</button>
     <button class="section-regen-btn" onclick="regenSection('${esc(s.name)}')" title="Regenerate this section">↺</button>`
  ).join('');
}

function clearSectionNav() {
  const nav = el('section-nav');
  if (nav) nav.innerHTML = '';
}

function scrollToSection(idx, name) {
  const editor = el('doc-editor');
  const lines = editor.value.split('\n');
  let charPos = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toUpperCase() === name.toUpperCase()) {
      editor.focus();
      editor.setSelectionRange(charPos, charPos);
      // Approximate scroll
      const lineHeight = 22;
      editor.scrollTop = i * lineHeight;
      return;
    }
    charPos += lines[i].length + 1;
  }
}

async function regenSection(sectionName) {
  if (!State.currentDoc) return;
  const editor = el('doc-editor');
  showToast(`Regenerating "${sectionName}"…`);

  try {
    const result = await API.generateSection({
      type: State.currentDoc.type,
      fields: State.currentDoc.fields || {},
      sectionName,
      currentContent: editor.value,
    });
    editor.value = result.content;
    State.currentDoc.content = result.content;
    State.upsertDoc(State.currentDoc);
    API.updateDoc(State.currentDoc.id, result.content).catch(() => {});
    showToast(`"${sectionName}" updated ✓`);
  } catch (err) {
    showToast(err.message || 'Section regeneration failed');
  }
}

// ─── LEGAL DISCLAIMER ──────────────────────────────────────
function updateLegalBanner(typeSlug) {
  const banner = el('legal-banner');
  if (!banner) return;
  const docType = State.docTypes[typeSlug];
  if (docType?.legalDisclaimer) {
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }
}

// ─── DOCX EXPORT ───────────────────────────────────────────
function updateDocxButton() {
  const btn = el('docx-btn');
  if (!btn) return;
  const plan = State.user?.plan || 'free';
  const canExport = ['pro', 'business', 'agency'].includes(plan);
  btn.title = canExport ? 'Download DOCX' : 'Upgrade to Business to export DOCX';
  btn.style.opacity = canExport ? '1' : '0.45';
}

async function downloadDocx() {
  if (!State.currentDoc) return;
  const plan = State.user?.plan || 'free';
  if (!['pro', 'business', 'agency'].includes(plan)) {
    showToast('DOCX export requires Business plan — upgrade to unlock.');
    return;
  }
  try {
    showToast('Preparing DOCX…');
    const blob = await API.exportDocx(State.currentDoc.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (State.currentDoc.title || 'document').replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.docx';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast(err.message || 'Export failed');
  }
}

// ─── COPY / DOWNLOAD / DELETE ──────────────────────────────
function copyDoc() {
  navigator.clipboard.writeText(el('doc-editor').value).then(() => showToast('Copied to clipboard ✓'));
}

function copyDocById(id) {
  const doc = State.docs.find(d => d.id === id);
  if (doc) navigator.clipboard.writeText(doc.content || '').then(() => showToast('Copied to clipboard ✓'));
}

function downloadDoc() {
  if (!State.currentDoc) return;
  const blob = new Blob([el('doc-editor').value], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (State.currentDoc.title || 'document').replace(/[^a-z0-9]/gi, '_') + '.txt';
  a.click();
  URL.revokeObjectURL(url);
}

async function deleteDoc(id) {
  if (!confirm('Delete this document?')) return;
  try {
    await API.deleteDoc(id);
  } catch { /* demo or offline — proceed locally */ }
  State.removeDoc(id);
  renderDocs(State.currentFilter);
  updateStats();
  updateUsage();
  showToast('Document deleted');
}

// ─── PLAN ──────────────────────────────────────────────────
async function changePlan(plan) {
  try {
    const result = await API.updatePlan(plan);
    State.setUser(result.user);
    if (result.token) localStorage.setItem('draftbox_token', result.token);
    updateUserUI();
    updateUsage();
    if (State.currentView === 'voice') renderVoiceTraining();
    else showDashboard();
    showToast(`${planDisplayName(plan)} enabled ✓`);
  } catch (err) {
    showToast(err.message || 'Unable to change plan');
  }
}

function showUpgrade() { changePlan('starter'); }

// ─── HELPERS ───────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

function esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function showToast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

// Close modal on overlay click
document.addEventListener('DOMContentLoaded', () => {
  el('new-doc-modal')?.addEventListener('click', function(e) { if (e.target === this) closeNewDoc(); });
  el('doc-type')?.addEventListener('change', e => renderDocForm(e.target.value));
  init();
});
