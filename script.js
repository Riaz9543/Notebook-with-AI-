import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, updateProfile, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getDatabase, ref, push, set, update, remove, onValue, runTransaction } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-database.js";
import { getAI, getGenerativeModel } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-ai.js";

const firebaseConfig = {
  apiKey:"AIzaSyCyCMIDiiaDMkyJHos7DICCGN36is2DmYI",
  authDomain:"note-7e2e9.firebaseapp.com",
  databaseURL:"https://note-7e2e9-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:"note-7e2e9",
  storageBucket:"note-7e2e9.firebasestorage.app",
  messagingSenderId:"607708912317",
  appId:"1:607708912317:web:8c8c9764ceebda366575d4",
  measurementId:"G-CHJJZ43FDM"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const ai = getAI(app);
const aiModel = getGenerativeModel(ai, { 
  model: "gemini-2.5-flash",
  systemInstruction: "You are a helpful notebook assistant. You can answer any question the user asks — both general knowledge and questions about their notes. When answering, write in plain text without markdown bold (**text**). Be concise and friendly."
});

let currentUser = null;
let allNotes = [];
let editingNoteId = null;
let detailNoteId = null;
let notesListener = null;
const googleProvider = new GoogleAuthProvider();

const AI_PROVIDERS = [
  { id:'chatgpt',    name:'ChatGPT',    url:'https://chatgpt.com/?q=' },
  { id:'claude',     name:'Claude',     url:'https://claude.ai/new?q=' },
  { id:'gemini',     name:'Gemini',     url:'https://gemini.google.com/app?q=' },
  { id:'deepseek',   name:'DeepSeek',   url:'https://chat.deepseek.com/?q=' },
  { id:'perplexity', name:'Perplexity', url:'https://www.perplexity.ai/search?q=' }
];

async function getNextSerial(userId) {
  const counterRef = ref(db, `counters/${userId}/noteSerial`);
  try {
    const result = await runTransaction(counterRef, (current) => (current || 0) + 1);
    return result.snapshot.val();
  } catch (e) { console.error(e); return null; }
}

onAuthStateChanged(auth, user => {
  document.getElementById('loading-screen').classList.add('hidden');
  if (user) {
    currentUser = user;
    showApp(user);
    subscribeNotes(user.uid);
  } else {
    currentUser = null;
    if (notesListener) { notesListener(); notesListener = null; }
    allNotes = [];
    renderNotes([]);
    showAuth();
    document.getElementById('chat-widget').classList.remove('open');
    document.getElementById('chat-fab').style.display = 'none';
  }
});

function showApp(user) {
  document.getElementById('auth-view').classList.remove('active');
  document.getElementById('app-view').classList.add('active');
  document.getElementById('chat-fab').style.display = 'flex';
  const dn = user.displayName || user.email;
  document.getElementById('user-email-display').textContent = dn;
  const av = document.getElementById('user-avatar');
  if (user.photoURL) av.innerHTML = `<img src="${user.photoURL}" alt=""/>`;
  else av.textContent = (dn[0] || '?').toUpperCase();
}
function showAuth() {
  document.getElementById('app-view').classList.remove('active');
  document.getElementById('auth-view').classList.add('active');
}

function subscribeNotes(uid) {
  notesListener = onValue(ref(db, `notes/${uid}`), snap => {
    const d = snap.val() || {};
    allNotes = Object.entries(d).map(([id,n]) => ({id, ...n})).sort((a,b) => (b.createdAt||0)-(a.createdAt||0));
    filterNotes();
  }, err => { console.error(err); showToast('Could not load notes'); });
}

window.filterNotes = function() {
  const q = (document.getElementById('search-input').value || '').toLowerCase().trim();
  let filtered = q ? allNotes.filter(n => (n.title||'').toLowerCase().includes(q)) : [...allNotes];
  const sortBy = document.getElementById('sort-select').value;
  switch(sortBy) {
    case 'newest': filtered.sort((a,b) => (b.createdAt||0) - (a.createdAt||0)); break;
    case 'oldest': filtered.sort((a,b) => (a.createdAt||0) - (b.createdAt||0)); break;
    case 'title_asc': filtered.sort((a,b) => (a.title||'').localeCompare(b.title||'')); break;
    case 'title_desc': filtered.sort((a,b) => (b.title||'').localeCompare(a.title||'')); break;
    case 'category_asc': filtered.sort((a,b) => (a.category||'Uncategorized').localeCompare(b.category||'Uncategorized')); break;
    case 'serial_asc': filtered.sort((a,b) => (a.serial||Infinity) - (b.serial||Infinity)); break;
    case 'serial_desc': filtered.sort((a,b) => (b.serial||-Infinity) - (a.serial||-Infinity)); break;
  }
  renderNotes(filtered);
};

function renderNotes(notes) {
  const grid = document.getElementById('notes-grid');
  const count = document.getElementById('notes-count');
  count.textContent = `${notes.length} ${notes.length===1?'entry':'entries'}`;
  if (!notes.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📖</div><h3>No notes yet</h3><p>Add your first note using the form.</p></div>`;
    return;
  }
  grid.innerHTML = notes.map((n,i) => {
    const date = n.createdAt ? new Date(n.createdAt).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—';
    const serial = n.serial ? `#${n.serial}` : '—';
    return `<div class="note-card" style="animation-delay:${i*.04}s" onclick="openNoteDetail('${n.id}')">
      <div class="note-title">${esc(n.title||'Untitled')}</div>
      <div class="note-desc">${esc(n.description||'')}</div>
      <div class="note-meta">
        <span class="note-badge">${esc(n.category||'Uncategorized')}</span>
        <span class="note-badge">${esc(serial)}</span>
        <span class="note-date">${date}</span>
      </div>
    </div>`;
  }).join('');
}
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }

async function generateAndStoreSuggestions(noteId, title, description) {
  try {
    const prompt = `Note Title: ${title}\nNote Content: ${description || '(empty)'}\n\nGive 3 to 5 specific, actionable tips to improve or expand this idea. Use numbered points. Write in plain text only, no bold or markdown.`;
    const result = await aiModel.generateContent(prompt);
    const suggestions = result.response.text();
    await update(ref(db, `notes/${currentUser.uid}/${noteId}`), { aiSuggestions: suggestions });
    return suggestions;
  } catch (e) { console.error(e); return "Could not generate suggestions right now."; }
}

window.addNote = async function() {
  const title = document.getElementById('note-title').value.trim();
  const desc = document.getElementById('note-desc').value.trim();
  const category = document.getElementById('note-category').value;
  const err = document.getElementById('add-error');
  err.classList.remove('visible');
  if (!title) { err.textContent='Title is required.'; err.classList.add('visible'); return; }
  const btn = document.getElementById('btn-add');
  btn.disabled=true; btn.textContent='Saving…';
  try {
    const newRef = push(ref(db,`notes/${currentUser.uid}`));
    const serial = await getNextSerial(currentUser.uid);
    await set(newRef, {title, description:desc, category, serial, createdAt:Date.now()});
    generateAndStoreSuggestions(newRef.key, title, desc).catch(console.error);
    document.getElementById('note-title').value='';
    document.getElementById('note-desc').value='';
    document.getElementById('note-category').value='Uncategorized';
    showToast('Note saved ✓');
  } catch(e) { err.textContent=e.message; err.classList.add('visible'); }
  btn.disabled=false;
  btn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Save Note';
};

window.openNoteDetail = async function(id) {
  const note = allNotes.find(n => n.id === id);
  if (!note) return;
  detailNoteId = id;
  document.getElementById('detail-date').textContent = note.createdAt ? new Date(note.createdAt).toLocaleDateString() : '';
  document.getElementById('detail-title').textContent = note.title;
  document.getElementById('detail-desc').textContent = note.description || 'No description.';
  document.getElementById('detail-serial').textContent = note.serial ? `#${note.serial}` : '—';
  document.getElementById('detail-category').textContent = note.category || 'Uncategorized';
  document.getElementById('detail-ai-chips').innerHTML = AI_PROVIDERS.map(p =>
    `<button class="ai-chip" onclick="event.stopPropagation();sendToAI('${p.id}')">${p.name}</button>`
  ).join('');
  const section = document.getElementById('detail-ai-suggestion-section');
  const contentDiv = document.getElementById('detail-ai-suggestion-content');
  section.style.display = 'block';
  if (note.aiSuggestions) {
    contentDiv.textContent = note.aiSuggestions;
  } else {
    contentDiv.textContent = '✨ Generating suggestions...';
    const newSuggestions = await generateAndStoreSuggestions(id, note.title, note.description || '');
    contentDiv.textContent = newSuggestions;
  }
  document.getElementById('detail-overlay').classList.add('open');
};

window.regenerateCurrentNoteSuggestions = async function() {
  if (!detailNoteId) return;
  const note = allNotes.find(n => n.id === detailNoteId);
  if (!note) return;
  const contentDiv = document.getElementById('detail-ai-suggestion-content');
  contentDiv.textContent = '✨ Regenerating...';
  const newSuggestions = await generateAndStoreSuggestions(detailNoteId, note.title, note.description || '');
  contentDiv.textContent = newSuggestions;
  showToast('Suggestions updated');
};

window.closeNoteDetail = () => { detailNoteId = null; document.getElementById('detail-overlay').classList.remove('open'); };
window.sendChat = async function() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  const messagesContainer = document.getElementById('chat-messages');
  messagesContainer.insertAdjacentHTML('beforeend', `<div class="chat-bubble user-bubble">${esc(msg)}</div>`);
  input.value = '';
  const loadingId = 'loading-' + Date.now();
  messagesContainer.insertAdjacentHTML('beforeend', `<div class="chat-bubble ai-bubble" id="${loadingId}">Thinking...</div>`);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  try {
    let notesCtx = allNotes.length
      ? "User's notes for context:\n" + allNotes.map(n => `- ${n.title} (${n.category||'Uncategorized'}): ${n.description||''}`).join('\n')
      : "The user has no notes yet.";
    if (detailNoteId) {
      const currentNote = allNotes.find(n => n.id === detailNoteId);
      if (currentNote && currentNote.aiSuggestions) notesCtx += `\n\nCurrently open note: "${currentNote.title}"\nIts AI suggestions: ${currentNote.aiSuggestions}`;
    }
    const result = await aiModel.generateContent(`${notesCtx}\n\nUser question: ${msg}`);
    document.getElementById(loadingId).innerText = result.response.text();
  } catch (e) { document.getElementById(loadingId).innerText = "Error: " + e.message; }
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
};
window.toggleChat = function() { document.getElementById('chat-widget').classList.toggle('open'); setTimeout(() => { document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight; document.getElementById('chat-input').focus(); }, 100); };
window.sendToAI = function(providerId) {
  const provider = AI_PROVIDERS.find(p => p.id === providerId);
  if (!provider) return;
  const currentNote = allNotes.find(n => n.id === detailNoteId);
  if (!currentNote) return;
  const query = encodeURIComponent(`I have a note titled "${currentNote.title}". ${currentNote.aiSuggestions ? `It has these suggestions: ${currentNote.aiSuggestions}. ` : ''}Can you help me expand on these ideas?`);
  window.open(provider.url + query, '_blank');
};
window.showToast = (m) => { const t=document.getElementById('toast'); t.textContent=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2800); };

// Event listeners binding
document.getElementById('btn-login').onclick = () => signInWithEmailAndPassword(auth,document.getElementById('login-email').value,document.getElementById('login-password').value).catch(e => { document.getElementById('login-error').textContent=e.message; document.getElementById('login-error').classList.add('visible'); });
document.getElementById('btn-google').onclick = () => signInWithPopup(auth,googleProvider);
document.getElementById('forgot-password-btn').onclick = () => {
  const email = document.getElementById('login-email').value;
  if (!email) { document.getElementById('login-error').textContent='Enter your email address first.'; document.getElementById('login-error').classList.add('visible'); return; }
  sendPasswordResetEmail(auth, email).then(() => showToast('Password reset email sent!')).catch(e => { document.getElementById('login-error').textContent=e.message; document.getElementById('login-error').classList.add('visible'); });
};
document.getElementById('btn-register').onclick = async () => {
  const email = document.getElementById('register-email').value;
  const password = document.getElementById('register-password').value;
  const name = document.getElementById('register-name').value;
  const errDiv = document.getElementById('register-error');
  errDiv.classList.remove('visible');
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name || email.split('@')[0] });
    showToast('Account created!');
  } catch(e) { errDiv.textContent=e.message; errDiv.classList.add('visible'); }
};
document.getElementById('logout-btn').onclick = () => signOut(auth);
document.getElementById('sort-select').onchange = () => filterNotes();
document.getElementById('search-input').oninput = () => filterNotes();
document.getElementById('detail-close-btn').onclick = () => closeNoteDetail();
document.getElementById('detail-btn-edit').onclick = () => {
  if (!detailNoteId) return;
  const note = allNotes.find(n => n.id === detailNoteId);
  if (note) { editingNoteId = detailNoteId; document.getElementById('edit-title').value = note.title || ''; document.getElementById('edit-category').value = note.category || 'Uncategorized'; document.getElementById('edit-desc').value = note.description || ''; document.getElementById('edit-modal').classList.add('open'); }
};
document.getElementById('detail-btn-delete').onclick = async () => { if(detailNoteId && confirm('Delete permanently?')){ await remove(ref(db, `notes/${currentUser.uid}/${detailNoteId}`)); closeNoteDetail(); showToast('Note deleted'); } };
window.saveEdit = async () => {
  const newTitle = document.getElementById('edit-title').value.trim();
  const newCategory = document.getElementById('edit-category').value;
  const newDesc = document.getElementById('edit-desc').value;
  if (!newTitle) { document.getElementById('edit-error').textContent='Title required'; document.getElementById('edit-error').classList.add('visible'); return; }
  try {
    await update(ref(db, `notes/${currentUser.uid}/${editingNoteId}`), { title: newTitle, category: newCategory, description: newDesc });
    closeEditModal(); showToast('Note updated');
    const note = allNotes.find(n => n.id === editingNoteId);
    if (note) generateAndStoreSuggestions(editingNoteId, newTitle, newDesc).catch(console.error);
  } catch(e) { document.getElementById('edit-error').textContent=e.message; document.getElementById('edit-error').classList.add('visible'); }
};
window.closeEditModal = () => { editingNoteId = null; document.getElementById('edit-modal').classList.remove('open'); };
document.getElementById('btn-save-edit').onclick = () => saveEdit();
document.getElementById('edit-cancel-btn').onclick = () => closeEditModal();
document.getElementById('modal-close-btn').onclick = () => closeEditModal();
document.getElementById('regenerate-suggestions-btn').onclick = () => regenerateCurrentNoteSuggestions();
document.getElementById('chat-fab').onclick = () => toggleChat();
document.getElementById('chat-close-btn').onclick = () => toggleChat();
document.getElementById('chat-send-btn').onclick = () => sendChat();
document.getElementById('chat-input').onkeydown = (e) => { if(e.key==='Enter') sendChat(); };
document.querySelectorAll('.auth-tab').forEach(btn => btn.addEventListener('click', () => {
  const tab = btn.getAttribute('data-tab');
  document.querySelectorAll('.auth-tab').forEach(el => el.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('panel-login').classList.toggle('active', tab === 'login');
  document.getElementById('panel-register').classList.toggle('active', tab === 'register');
}));