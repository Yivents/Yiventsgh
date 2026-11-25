// Static Yivents web app. No build step: GitHub Pages serves these files and
// the browser talks directly to Firebase Auth, Firestore and Storage.
import {
  auth, db, storage, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail, signInAnonymously,
  doc, getDoc, getDocs, addDoc, updateDoc, writeBatch, serverTimestamp,
  collection, query, where, limit, ref, uploadBytes, getDownloadURL,
} from './firebase.js';
import { SUPPORT_EMAIL } from './config.js';

const $ = (sel, root = document) => root.querySelector(sel);
const page = document.body.dataset.page || 'home';
const params = new URLSearchParams(location.search);

function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v ?? '';
    else if (k === 'href') n.setAttribute('href', v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

function message(container, text, kind = 'info') {
  container.replaceChildren(el('div', { class: `notice-box ${kind}`, text }));
}

function money(pesewas) {
  const n = Number(pesewas || 0);
  return `GH₵ ${(n / 100).toFixed(2)}`;
}

function slugify(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function randomCode() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function isoLabel(iso) {
  if (!iso) return 'Date to be announced';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Date to be announced' : d.toLocaleString('en-GB', { timeZone: 'Africa/Accra', dateStyle: 'medium', timeStyle: 'short' });
}

function card(item) {
  const link = el('a', { class: 'btn btn-outline', href: `event.html?slug=${encodeURIComponent(item.slug || item.id)}`, text: 'View event' });
  return el('article', { class: 'card' },
    el('div', { class: 'flyer', text: item.title || 'Event' }),
    el('div', { class: 'body' },
      el('h3', { text: item.title || 'Event' }),
      el('p', { class: 'muted tiny', text: `${isoLabel(item.startAt)}${item.venue ? ` · ${item.venue}` : ''}` }),
      el('div', { class: 'row' },
        el('span', { class: 'pill', text: item.mode || 'in_person' }),
        item.ticketPricePesewas != null ? el('span', { class: 'pill price', text: money(item.ticketPricePesewas) }) : null,
      ),
      el('p', { class: 'muted tiny', text: item.summary || '' }),
      link,
    ),
  );
}

async function ensureUser() {
  if (auth.currentUser) return auth.currentUser;
  return (await signInAnonymously(auth)).user;
}

let started = false;
onAuthStateChanged(auth, async (user) => {
  const label = $('#auth-label');
  const link = $('#auth-link');
  if (label) label.textContent = user ? (user.email || 'Guest session') : 'Sign in';
  if (link) {
    link.href = user && !user.isAnonymous ? 'app.html' : (user ? 'app.html' : 'login.html');
    link.textContent = user ? 'Dashboard' : 'Sign in';
  }
  if (started) return;
  started = true;
  try {
    if (page === 'home') await initHome();
    if (page === 'event') await initEvent();
    if (page === 'login') initLogin();
    if (page === 'app') await initApp(user);
    if (page === 'admin') await initAdmin(user);
    if (page === 'ticket') await initTicket();
  } catch (err) {
    console.error(err);
    const fallback = $('#page-message');
    if (fallback) message(fallback, `Could not load this page: ${err?.message || err}`, 'error');
    else {
      const box = el('div', { class: 'container' });
      message(box, `Could not load this page: ${err?.message || err}`, 'error');
      document.body.prepend(box);
    }
  }
});

async function initHome() {
  const host = $('#event-list');
  if (!host) return;
  const term = (params.get('q') || '').toLowerCase().trim();
  const searchLabel = $('#search-label');
  if (searchLabel) searchLabel.textContent = term ? `Results for “${term}”` : 'Upcoming events';
  const snap = await getDocs(query(collection(db, 'publicListings'), where('approvalStatus', '==', 'approved'), limit(50)));
  let items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((i) => ['upcoming', 'ongoing'].includes(i.status || 'upcoming'))
    .sort((a, b) => String(b.listedAt || '').localeCompare(String(a.listedAt || '')));
  if (term) items = items.filter((i) => String(i.title || '').toLowerCase().includes(term));
  host.replaceChildren();
  if (!items.length) {
    host.append(el('div', { class: 'notice-box info', text: 'No public events yet. Events appear here once an admin approves them.' }));
    return;
  }
  items.forEach((item) => host.append(card(item)));
}

async function initEvent() {
  const slug = params.get('slug');
  const host = $('#event-detail');
  if (!host || !slug) return message(host, 'No event selected.', 'error');
  const snap = await getDoc(doc(db, 'publicPrograms', slug));
  if (!snap.exists()) return message(host, 'Event not found. Check the link with the organizer.', 'error');
  const p = snap.data();
  $('#event-title').textContent = p.title || 'Event';
  $('#event-summary').textContent = p.summary || '';
  $('#event-date').textContent = isoLabel(p.startAt);
  $('#event-venue').textContent = p.venue || 'Venue to be announced';

  const fieldsSnap = await getDocs(collection(db, 'publicPrograms', slug, 'formFields'));
  const paySnap = await getDocs(collection(db, 'publicPrograms', slug, 'paymentMethods'));
  const form = $('#registration-form');
  const fieldsHost = $('#form-fields');
  fieldsHost.replaceChildren();
  fieldsSnap.docs.forEach((d) => {
    const f = d.data();
    const props = { name: `f_${d.id}`, placeholder: f.placeholder || '' };
    if (f.required) props.required = 'required';
    const input = el('input', props);
    fieldsHost.append(el('div', { class: 'field' }, el('label', { text: f.label || 'Question' }), input));
  });
  const payHost = $('#payment-methods');
  payHost.replaceChildren();
  if (!paySnap.docs.length) payHost.append(el('p', { class: 'muted', text: 'No payment details published. This event may be free.' }));
  paySnap.docs.forEach((d) => {
    const m = d.data();
    payHost.append(el('div', { class: 'panel' },
      el('h3', { text: m.name || 'Payment method' }),
      el('p', { text: m.details || '' }),
      m.accountNumber ? el('p', { class: 'tiny', text: `Account: ${m.accountNumber}` }) : null,
    ));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#register-button');
    btn.disabled = true;
    try {
      const user = await ensureUser();
      const answers = {};
      fieldsSnap.docs.forEach((d) => { answers[d.id] = String(form.elements[`f_${d.id}`]?.value || '').slice(0, 500); });
      const data = {
        programId: p.programId,
        slug,
        submitterUid: user.uid,
        status: 'pending',
        ticketPricePesewas: Number(p.ticketPricePesewas || 0),
        contact: {
          name: String(form.elements.fullName.value || '').slice(0, 120),
          email: String(form.elements.email.value || '').slice(0, 160),
          phone: String(form.elements.phone.value || '').slice(0, 40),
        },
        answers,
        createdAt: serverTimestamp(),
      };
      const shot = form.elements.screenshot.files[0];
      if (shot) {
        const path = `uploads/${p.programId}/${user.uid}/${Date.now()}-${shot.name.replace(/[^\w.-]/g, '_')}`;
        await uploadBytes(ref(storage, path), shot, { contentType: shot.type });
        data.screenshotPath = path;
      }
      await addDoc(collection(db, 'programs', p.programId, 'registrations'), data);
      message($('#registration-message'), 'Registration submitted. The organizer will review your payment and approve you.', 'ok');
      form.reset();
    } catch (err) {
      message($('#registration-message'), err?.message || String(err), 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

function initLogin() {
  const signup = $('#signup-form');
  const signin = $('#signin-form');
  const reset = $('#reset-button');
  if (signup) signup.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const email = signup.elements.email.value;
      const password = signup.elements.password.value;
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfileSafe(cred.user, signup.elements.name.value);
      location.href = 'app.html';
    } catch (err) { message($('#login-message'), err.message, 'error'); }
  });
  if (signin) signin.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, signin.elements.email.value, signin.elements.password.value);
      location.href = 'app.html';
    } catch (err) { message($('#login-message'), err.message, 'error'); }
  });
  if (reset) reset.addEventListener('click', async () => {
    const email = $('#reset-email')?.value;
    if (!email) return message($('#login-message'), 'Enter your email first.', 'error');
    try { await sendPasswordResetEmail(auth, email); message($('#login-message'), 'Reset email sent.', 'ok'); }
    catch (err) { message($('#login-message'), err.message, 'error'); }
  });
}

async function updateProfileSafe(user, name) {
  try {
    const { updateProfile } = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js');
    await updateProfile(user, { displayName: String(name || '').slice(0, 80) });
    await setUserDoc(user);
  } catch { /* profile is optional */ }
}

async function setUserDoc(user) {
  await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js').then(async ({ setDoc }) => {
    await setDoc(doc(db, 'users', user.uid), {
      uid: user.uid, email: user.email || '', displayName: user.displayName || '', createdAt: serverTimestamp(),
    }, { merge: true });
  });
}

async function initApp(user) {
  const host = $('#app-content');
  if (!host) return;
  if (!user) return message(host, 'Please sign in to open the organizer dashboard.', 'info');
  const id = params.get('id');
  if (id) return initProgram(user, id);
  await initPrograms(user);
}

async function initPrograms(user) {
  const host = $('#app-content');
  host.replaceChildren();
  const snap = await getDocs(query(collection(db, 'programs'), where('ownerUid', '==', user.uid), limit(50)));
  host.append(el('div', { class: 'spread' },
    el('h2', { text: 'Your programs' }),
    el('a', { class: 'btn btn-primary', href: 'logout.html', text: 'Sign out' }),
  ));
  const list = el('div', { class: 'grid grid-3' });
  snap.docs.forEach((d) => {
    const p = d.data();
    list.append(el('article', { class: 'card' },
      el('div', { class: 'body' },
        el('h3', { text: p.title || 'Untitled program' }),
        el('p', { class: 'muted tiny', text: `/e/${p.slug || d.id}` }),
        el('span', { class: `pill ${p.approvalStatus === 'approved' ? 'price' : 'warn'}`, text: p.approvalStatus || 'pending' }),
        el('a', { class: 'btn btn-outline', href: `app.html?id=${encodeURIComponent(d.id)}`, text: 'Manage' }),
      ),
    ));
  });
  if (!snap.docs.length) list.append(el('div', { class: 'notice-box info', text: 'No programs yet. Create your first one below.' }));
  host.append(list);

  const form = $('#new-program-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#new-program-button');
    btn.disabled = true;
    try {
      const title = String(form.elements.title.value || '').slice(0, 120);
      const description = String(form.elements.description.value || '').slice(0, 500);
      const base = slugify(title) || 'event';
      const slug = `${base}-${randomCode().slice(0, 6)}`;
      const programRef = doc(collection(db, 'programs'));
      const batch = writeBatch(db);
      batch.set(programRef, {
        ownerUid: user.uid, slug, title, description,
        visibility: 'private_link', approvalStatus: 'pending', status: 'upcoming',
        settings: { acceptingRegistrations: true },
        capacity: Number(form.elements.capacity.value || 0),
        counters: { confirmed: 0 },
        branding: { primaryColor: '#104080', accentColor: '#F08010' },
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'publicPrograms', slug), {
        programId: programRef.id, slug, title, summary: description, status: 'upcoming',
        branding: { primaryColor: '#104080', accentColor: '#F08010' },
        startAt: String(form.elements.startAt.value || ''),
        createdAt: serverTimestamp(),
      });
      batch.set(doc(db, 'publicListings', programRef.id), {
        programId: programRef.id, slug, title, summary: description,
        approvalStatus: 'pending', status: 'upcoming', listedAt: serverTimestamp(),
      });
      await batch.commit();
      location.href = `app.html?id=${programRef.id}`;
    } catch (err) { message($('#app-message'), err.message, 'error'); btn.disabled = false; }
  });
}

async function initProgram(user, id) {
  const host = $('#app-content');
  const createSection = $('#create-section');
  if (createSection) createSection.hidden = true;
  ['field-section', 'payment-section', 'flyer-section'].forEach((sid) => {
    const section = $(`#${sid}`);
    if (section) section.hidden = false;
  });
  const snap = await getDoc(doc(db, 'programs', id));
  if (!snap.exists() || snap.data().ownerUid !== user.uid) return message(host, 'Program not found or not yours.', 'error');
  const p = snap.data();
  host.replaceChildren();
  host.append(el('div', { class: 'spread' },
    el('div', {}, el('h2', { text: p.title || 'Program' }), el('p', { class: 'muted', text: `Private link: /e/${p.slug || id}` })),
    el('a', { class: 'btn btn-outline', href: 'app.html', text: '← All programs' }),
  ));
  host.append(el('div', { class: `notice-box ${p.approvalStatus === 'approved' ? 'ok' : 'warn'}`, text: p.approvalStatus === 'approved' ? 'Approved for public listing.' : 'Pending admin approval before it appears on the homepage.' }));

  const regs = await getDocs(collection(db, 'programs', id, 'registrations'));
  const table = el('table');
  table.append(el('thead', {}, el('tr', {}, el('th', { text: 'Name' }), el('th', { text: 'Status' }), el('th', { text: 'Amount' }), el('th', { text: 'Action' }))));
  const tbody = el('tbody');
  regs.docs.forEach((d) => {
    const r = d.data();
    const action = r.status === 'approved'
      ? el('span', { class: 'pill price', text: r.ticketCode || 'Approved' })
      : el('button', { class: 'primary', onclick: () => approve(d, r) }, 'Approve');
    tbody.append(el('tr', {},
      el('td', { text: r.contact?.name || r.contact?.email || 'Registrant' }),
      el('td', { text: r.status || 'pending' }),
      el('td', { text: money(r.ticketPricePesewas) }),
      el('td', {}, action),
    ));
  });
  table.append(tbody);
  host.append(el('div', { class: 'panel' }, el('h3', { text: 'Registrations' }), table));

  async function approve(regRef, r) {
    if (!confirm(`Approve ${r.contact?.name || 'this registrant'}?`)) return;
    const code = randomCode();
    const batch = writeBatch(db);
    batch.update(regRef, { status: 'approved', ticketCode: code, approvedAt: serverTimestamp() });
    batch.set(doc(db, 'tickets', code), { code, programId: id, registrationId: regRef.id, status: 'valid', createdAt: serverTimestamp() });
    await batch.commit();
    location.reload();
  }

  const fieldForm = $('#program-field-form');
  if (fieldForm) fieldForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await addDoc(collection(db, 'programs', id, 'formFields'), {
      label: String(fieldForm.elements.label.value).slice(0, 120),
      type: fieldForm.elements.type.value,
      required: fieldForm.elements.required.checked,
      createdAt: serverTimestamp(),
    });
    await addDoc(collection(db, 'publicPrograms', p.slug, 'formFields'), {
      label: String(fieldForm.elements.label.value).slice(0, 120),
      type: fieldForm.elements.type.value,
      required: fieldForm.elements.required.checked,
    });
    fieldForm.reset();
    location.reload();
  });

  const payForm = $('#payment-form');
  if (payForm) payForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = { name: String(payForm.elements.name.value).slice(0, 120), details: String(payForm.elements.details.value).slice(0, 500), createdAt: serverTimestamp() };
    await addDoc(collection(db, 'programs', id, 'paymentMethods'), data);
    await addDoc(collection(db, 'publicPrograms', p.slug, 'paymentMethods'), { name: data.name, details: data.details });
    payForm.reset();
    location.reload();
  });

  const flyer = $('#flyer-form');
  if (flyer) flyer.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = flyer.elements.flyer.files[0];
    if (!file) return;
    const path = `public/${id}/flyer-${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`;
    await uploadBytes(ref(storage, path), file, { contentType: file.type });
    const url = await getDownloadURL(ref(storage, path));
    await updateDoc(doc(db, 'programs', id), { 'branding.coverUrl': url, updatedAt: serverTimestamp() });
    await updateDoc(doc(db, 'publicPrograms', p.slug), { coverUrl: url });
    location.reload();
  });
}

async function initAdmin(user) {
  const host = $('#admin-content');
  if (!host) return;
  if (!user) return message(host, 'Sign in to open the admin area.', 'info');
  const token = await user.getIdTokenResult();
  const staff = token.claims.superAdmin || token.claims.admin || token.claims.support || token.claims.moderator;
  if (!staff) return message(host, 'Your account does not have an admin claim. Claims are set with the Admin SDK, never in the website.', 'error');
  const snap = await getDocs(query(collection(db, 'publicListings'), where('approvalStatus', '==', 'pending'), limit(50)));
  host.replaceChildren(el('h2', { text: 'Programs awaiting approval' }));
  if (!snap.docs.length) host.append(el('div', { class: 'notice-box info', text: 'Nothing to review.' }));
  snap.docs.forEach((d) => {
    const l = d.data();
    host.append(el('div', { class: 'panel' },
      el('h3', { text: l.title || 'Untitled' }),
      el('p', { class: 'muted', text: l.summary || '' }),
      el('button', { class: 'primary', onclick: async () => {
        await updateDoc(doc(db, 'publicListings', d.id), { approvalStatus: 'approved', reviewedAt: serverTimestamp() });
        await updateDoc(doc(db, 'programs', d.id), { approvalStatus: 'approved' });
        location.reload();
      } }, 'Approve listing'),
    ));
  });
}

async function initTicket() {
  const host = $('#ticket-content');
  const code = params.get('code');
  if (!host) return;
  if (!code) return message(host, 'No ticket code supplied.', 'error');
  const snap = await getDoc(doc(db, 'tickets', code));
  if (!snap.exists()) return message(host, 'Ticket not found. Check the code with the organizer.', 'error');
  const t = snap.data();
  const p = t.programId ? await getDoc(doc(db, 'programs', t.programId)) : null;
  host.append(el('div', { class: 'ticket' },
    el('div', { class: 'ticket-head' }, el('strong', { text: 'Yivents ticket' })),
    el('div', { class: 'ticket-body' },
      el('dl', { class: 'kv' },
        el('dt', { text: 'Event' }), el('dd', { text: p?.data()?.title || t.programId || 'Event' }),
        el('dt', { text: 'Code' }), el('dd', { text: t.code || code }),
        el('dt', { text: 'Status' }), el('dd', { text: t.status || 'valid' }),
      ),
      el('div', { class: 'qr', role: 'img', 'aria-label': 'QR code' }),
    ),
  ));
}

$('#logout-button')?.addEventListener('click', async () => {
  await signOut(auth);
  location.href = 'index.html';
});
