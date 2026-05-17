const State = {
  docs: [],
  user: null,
  currentDoc: null,
  currentFilter: null,
  currentView: 'dashboard',

  init() {
    this.docs = JSON.parse(localStorage.getItem('draftbox_docs') || '[]');
    this.user = JSON.parse(localStorage.getItem('draftbox_user') || 'null');
  },

  setDocs(d) {
    this.docs = d;
    localStorage.setItem('draftbox_docs', JSON.stringify(d));
  },

  setUser(u) {
    this.user = u;
    if (u) localStorage.setItem('draftbox_user', JSON.stringify(u));
    else localStorage.removeItem('draftbox_user');
  },

  upsertDoc(doc) {
    const idx = this.docs.findIndex(d => d.id === doc.id);
    if (idx >= 0) this.docs[idx] = doc;
    else this.docs.unshift(doc);
    localStorage.setItem('draftbox_docs', JSON.stringify(this.docs));
  },

  removeDoc(id) {
    this.docs = this.docs.filter(d => d.id !== id);
    localStorage.setItem('draftbox_docs', JSON.stringify(this.docs));
  },
};
