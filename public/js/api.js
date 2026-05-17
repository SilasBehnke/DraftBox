const API = {
  _token() { return localStorage.getItem('draftbox_token') || 'demo'; },

  _headers() {
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this._token()}` };
  },

  async getDocTypes() {
    const r = await fetch('/api/doc-types');
    if (!r.ok) throw new Error('Failed to load document types');
    return r.json(); // returns array
  },

  async getDocs() {
    const r = await fetch('/api/docs', { headers: this._headers() });
    if (!r.ok) throw new Error('Failed to load documents');
    return r.json(); // { success, docs }
  },

  async generate(payload) {
    const r = await fetch('/api/generate', {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Generation failed');
    return data; // { success, content, title, docId }
  },

  async generateSection(payload) {
    const r = await fetch('/api/generate/section', {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Section regeneration failed');
    return data; // { success, content }
  },

  async updateDoc(id, content) {
    const r = await fetch(`/api/docs/${id}`, {
      method: 'PUT',
      headers: this._headers(),
      body: JSON.stringify({ content }),
    });
    if (!r.ok) throw new Error('Failed to save document');
    return r.json();
  },

  async deleteDoc(id) {
    const r = await fetch(`/api/docs/${id}`, {
      method: 'DELETE',
      headers: this._headers(),
    });
    if (!r.ok) throw new Error('Failed to delete document');
    return r.json();
  },

  async updatePlan(plan) {
    const r = await fetch('/api/account/plan', {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ plan }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Plan update failed');
    return data; // { success, user, token }
  },

  async updateVoice(voiceProfile) {
    const r = await fetch('/api/account/voice', {
      method: 'PUT',
      headers: this._headers(),
      body: JSON.stringify({ voiceProfile }),
    });
    if (!r.ok) throw new Error('Failed to save voice profile');
    return r.json();
  },

  async exportDocx(id) {
    const r = await fetch(`/api/docs/${id}/export/docx`, { headers: this._headers() });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.error || 'Export failed');
    }
    return r.blob(); // caller creates an object URL and triggers download
  },
};
