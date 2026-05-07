// ════════════════════════════════════════════════════════
// MORNING ROUND DIGITAL — script.js
// PT. RISKI HARIYANTO
// ════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════
// CONSTANTS & STATE
// ════════════════════════════════════════════════════════
const ALL_SCREENS = [
  's-login','s-dashboard','s-form','s-success',
  's-history','s-detail','s-supervisor','s-verif',
  's-notif','s-profil','s-open-findings','s-close-finding'
];

const AREAS = [
  'Area Produksi Line 1','Area Produksi Line 2','Area Pengemasan',
  'Area Mixing / Blending','Gudang Bahan Baku','Gudang Produk Jadi',
  'Area QC Lab','Workshop Maintenance','Area Utilitas','Area HSE / K3',
  'Toilet & Kantin','Area Loading Dock'
];

const ITEMS_5R = [
  { key:'ringkas', label:'Ringkas (Seiri)',   desc:'Bebas dari barang tidak diperlukan' },
  { key:'rapi',    label:'Rapi (Seiton)',     desc:'Setiap barang ada tempatnya yang jelas' },
  { key:'resik',   label:'Resik (Seiso)',     desc:'Area bersih, bebas debu & kotoran' },
  { key:'rawat',   label:'Rawat (Seiketsu)', desc:'Peralatan terawat & standar terjaga' },
  { key:'rajin',   label:'Rajin (Shitsuke)',  desc:'Standar dijalankan secara konsisten' }
];

const CATEGORIES = ['Delivery','Quality','Safety','Efisiensi','Moral'];
const DEPARTMENTS = ['IRGA','Produksi','Teknik / Maintenance','QC / QA','HSE','Gudang','Lainnya'];
const PRIO_LABELS = { High:'Tinggi', Medium:'Sedang', Low:'Rendah' };
const PRIO_DAYS   = { High: 1, Medium: 3, Low: 7 }; // escalation thresholds

const USERS = {
  petugas: {
    uid:'u1', displayName:'Riski Hariyanto', role:'petugas',
    email:'riski.hariyanto@riski-hariyanto.id', jabatan:'Petugas Produksi',
    initials:'RH', dept:'Produksi'
  },
  supervisor: {
    uid:'u2', displayName:'Yanti Puspita', role:'supervisor',
    email:'yanti.puspita@riski-hariyanto.id', jabatan:'Supervisor Produksi',
    initials:'YP', dept:'Produksi'
  }
};

let currentUser    = null;
let cl5R           = {};
let findingsData   = {};   // 5R findings per key
let extraFindings  = [];   // additional non-5R findings
let photoData      = { before: null, after: null };
let currentShift   = 'PAGI';
let selectedReport = null;
let histFilter     = 'today';
let findingsFilter = 'all';

// Close Finding State
let cfReportId   = null;
let cfFindingKey = null;
let cfIsExtra    = false;
let cfPhotoData  = null;

let extraFindingIdCounter = 0;

// ════════════════════════════════════════════════════════
// FIREBASE + LOCAL STORAGE HYBRID BACKEND
// Arsitektur:
//   • Firestore  = sumber kebenaran utama (source of truth)
//   • localStorage = cache offline & fallback saat Firebase belum siap
//   • Setiap tulis = 1 dokumen saja (bukan upload ulang seluruh array)
//   • onSnapshot   = satu-satunya yang memperbarui cache lokal & UI
// ════════════════════════════════════════════════════════

// ── Guard: cek apakah semua fungsi Firebase sudah di-inject ──────────
function _fbReady() {
  return !!(
    window.db &&
    window.firebaseSetDoc &&
    window.firebaseDoc &&
    window.firebaseCollection &&
    window.firebaseOnSnapshot
  );
}

// ── Shorthand ke fungsi Firebase dari window ─────────────────────────
const _db    = () => window.db;
const _col   = () => window.firebaseCollection;
const _setDoc= () => window.firebaseSetDoc;
const _doc   = () => window.firebaseDoc;
const _snap  = () => window.firebaseOnSnapshot;

// ── Cache status error sync (satu toast saja, tidak spam) ────────────
let _fbSyncError = false;

// ════════════════════════════════════════════════════════
// LOCAL STORAGE — cache offline & pembacaan saat offline
// ════════════════════════════════════════════════════════
function getReports() {
  try { return JSON.parse(localStorage.getItem('mr_v2_reports') || '[]'); } catch { return []; }
}
function _cacheReports(arr) {
  // Hanya tulis ke localStorage — TIDAK ke Firestore
  // (Firestore ditulis hanya via fbSaveReport / fbSaveReportById)
  localStorage.setItem('mr_v2_reports', JSON.stringify(arr));
}

function getNotifs() {
  try { return JSON.parse(localStorage.getItem('mr_v2_notifs') || '[]'); } catch { return []; }
}
function saveNotifs(notifsArray) {
  localStorage.setItem('mr_v2_notifs', JSON.stringify(notifsArray));
  // Sinkronisasi tiap notif ke Firestore (notif kecil, aman dikirim semua)
  if (_fbReady() && Array.isArray(notifsArray)) {
    notifsArray.forEach(n => fbSaveNotif(n));
  }
}

// ════════════════════════════════════════════════════════
// FIRESTORE WRITE — selalu tulis SATU dokumen, bukan array
// ════════════════════════════════════════════════════════

/**
 * Simpan SATU laporan ke Firestore.
 * Dipanggil oleh: submitForm, submitCloseFinding, doVerif, fbSaveReportById
 */
async function fbSaveReport(report) {
  if (!_fbReady()) {
    // Antrian ke localStorage saja; onSnapshot akan sync saat online kembali
    console.warn('[Firebase] Belum siap, laporan tersimpan lokal saja:', report.id);
    return;
  }
  try {
    const clean = JSON.parse(JSON.stringify(report)); // buang undefined
    await _setDoc()(_doc()(_db(), 'reports', clean.id), clean);
    _fbSyncError = false;
    console.log('[Firebase] Laporan tersimpan:', clean.id);
  } catch (e) {
    console.error('[Firebase] Gagal menyimpan laporan:', e);
    if (!_fbSyncError) {
      _fbSyncError = true;
      toast('⚠ Sync Firebase gagal — data tersimpan lokal', 'yellow');
    }
  }
}

/**
 * Ambil laporan dari cache lokal berdasarkan ID lalu push ke Firestore.
 * Dipakai oleh submitCloseFinding & doVerif yang memodifikasi report di array cache.
 */
async function fbSaveReportById(reportId) {
  const cached = getReports().find(r => r.id === reportId);
  if (cached) await fbSaveReport(cached);
}

/**
 * Simpan SATU notif ke Firestore.
 */
async function fbSaveNotif(notif) {
  if (!_fbReady()) return;
  try {
    const clean = JSON.parse(JSON.stringify(notif));
    await _setDoc()(_doc()(_db(), 'notifs', clean.id), clean);
  } catch (e) {
    console.error('[Firebase] Gagal menyimpan notif:', e);
  }
}

// ════════════════════════════════════════════════════════
// saveReports — HANYA menulis ke localStorage cache
// Penulisan ke Firestore WAJIB dilakukan eksplisit via fbSaveReport(report)
// Ini mencegah upload ulang seluruh array setiap kali ada perubahan kecil
// ════════════════════════════════════════════════════════
function saveReports(reportsArray) {
  _cacheReports(reportsArray);
}

// ════════════════════════════════════════════════════════
// REALTIME LISTENER — Firestore → localStorage cache → UI
// Didaftarkan sekali saat init. Jika Firebase belum siap,
// di-retry dengan backoff eksponensial (bukan polling tetap).
// ════════════════════════════════════════════════════════
function initFirebaseListeners(attempt) {
  attempt = attempt || 1;

  if (!_fbReady()) {
    // Backoff: 500ms, 1s, 2s, 4s … maks 8s
    const delay = Math.min(500 * Math.pow(2, attempt - 1), 8000);
    console.log(`[Firebase] Belum siap, retry ke-${attempt} dalam ${delay}ms…`);
    setTimeout(() => initFirebaseListeners(attempt + 1), delay);
    return;
  }

  // ── Listener: collection "reports" ──────────────────────────────────
  _snap()(_col()(_db(), 'reports'), (snapshot) => {
    try {
      const fbReports = [];
      snapshot.forEach(docSnap => fbReports.push(docSnap.data()));

      // Firebase = sumber kebenaran → overwrite cache lokal
      _cacheReports(fbReports);
      _fbSyncError = false;

      // Re-render screen yang sedang aktif
      const activeScreen = ALL_SCREENS.find(s => {
        const el = document.getElementById(s);
        return el && el.classList.contains('active');
      });
      if (activeScreen === 's-dashboard')     renderDashboard();
      if (activeScreen === 's-history')       renderHistory();
      if (activeScreen === 's-supervisor')    renderSupervisorDash();
      if (activeScreen === 's-open-findings') renderOpenFindings();

    } catch (e) {
      console.error('[Firebase] Error memproses snapshot reports:', e);
    }
  }, (err) => {
    console.error('[Firebase] Listener reports error:', err);
    toast('⚠ Koneksi Firebase terputus — mode offline aktif', 'yellow');
  });

  // ── Listener: collection "notifs" ───────────────────────────────────
  _snap()(_col()(_db(), 'notifs'), (snapshot) => {
    try {
      const fbNotifs = [];
      snapshot.forEach(docSnap => fbNotifs.push(docSnap.data()));
      fbNotifs.sort((a, b) => (b.id || '').localeCompare(a.id || ''));

      // Tulis ke cache lokal (tanpa trigger upload balik ke Firestore)
      localStorage.setItem('mr_v2_notifs', JSON.stringify(fbNotifs));

      // Update badge notif
      const unread = fbNotifs.filter(n => !n.read).length;
      ['dash-notif-dot', 'sup-notif-dot'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = unread ? 'block' : 'none';
      });

      const activeScreen = ALL_SCREENS.find(s => {
        const el = document.getElementById(s);
        return el && el.classList.contains('active');
      });
      if (activeScreen === 's-notif') renderNotifs();

    } catch (e) {
      console.error('[Firebase] Error memproses snapshot notifs:', e);
    }
  }, (err) => {
    console.error('[Firebase] Listener notifs error:', err);
  });

  console.log('[Firebase] Realtime listeners aktif ✅');
}

function today() { 
  const d = new Date();
  // Mengambil tanggal lokal HP, bukan waktu UTC
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function todayLabel() { return new Date().toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric' }); }
function fmtDate(d)   { return new Date(d).toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' }); }

function getDueDaysLeft(dueDateStr) {
  if (!dueDateStr) return null;
  const now = new Date(); now.setHours(0,0,0,0);
  const due = new Date(dueDateStr); due.setHours(0,0,0,0);
  return Math.round((due - now) / 86400000);
}

function dueDateClass(days) {
  if (days === null) return '';
  if (days < 0) return 'due-overdue';
  if (days <= 1) return 'due-soon';
  return 'due-ok';
}

function dueDateLabel(days, str) {
  if (days === null) return str || '—';
  if (days < 0)  return `⚠ Overdue ${Math.abs(days)}h`;
  if (days === 0) return '⚡ Hari Ini!';
  if (days === 1) return '⏰ Besok';
  return `${fmtDate(str)} (${days}h lagi)`;
}

// ════════════════════════════════════════════════════════
// COLLECT ALL OPEN FINDINGS (flat list across all reports)
// ════════════════════════════════════════════════════════
function getAllOpenFindings() {
  const reps = getReports();
  const result = [];
  reps.forEach(r => {
    // 5R findings
    Object.keys(r.findings || {}).forEach(k => {
      const f = r.findings[k];
      if (f.status !== 'Closed') {
        const item = ITEMS_5R.find(i => i.key === k);
        result.push({
          reportId: r.id,
          key: k,
          isExtra: false,
          label: item?.label || k,
          category: '5R',
          description: f.description || '—',
          priority: f.urgency || 'Medium',
          dueDate: f.dueDate || null,
          status: f.status || 'Open',
          area: r.area,
          tanggal: r.tanggal,
          photo: f.photo || null
        });
      }
    });
    // Extra findings
    (r.extraFindings || []).forEach(ef => {
      if (ef.status !== 'Closed') {
        result.push({
          reportId: r.id,
          key: ef.id,
          isExtra: true,
          label: ef.label || 'Temuan',
          category: ef.category || '5R',
          description: ef.description || '—',
          priority: ef.priority || 'Medium',
          dueDate: ef.dueDate || null,
          status: ef.status || 'Open',
          area: r.area,
          tanggal: r.tanggal,
          photo: ef.photo || null
        });
      }
    });
  });
  return result;
}

// ════════════════════════════════════════════════════════
// SCREEN NAVIGATION
// ════════════════════════════════════════════════════════
function goTo(id) {
  ALL_SCREENS.forEach(s => {
    const el = document.getElementById(s);
    if (el) { el.style.display = 'none'; el.classList.remove('active'); }
  });
  const t = document.getElementById(id);
  if (t) { t.style.display = 'flex'; t.classList.add('active'); const sb = t.querySelector('.screen-body'); if (sb) sb.scrollTop = 0; }
  if (id === 's-form')          initForm();
  if (id === 's-history')       renderHistory();
  if (id === 's-notif')         renderNotifs();
  if (id === 's-supervisor')    renderSupervisorDash();
  if (id === 's-dashboard')     renderDashboard();
  if (id === 's-open-findings') renderOpenFindings();
  if (id === 's-profil')        renderProfil();
}

function navTo(id, btn) {
  goTo(id);
}

// ════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════
function quickLogin(role) {
  currentUser = USERS[role];
  localStorage.setItem('mr_v2_user', JSON.stringify(currentUser));
  enterApp();
  toast('Selamat datang, ' + currentUser.displayName.split(' ')[0] + '! 👋', 'lime');
}

function doLogin() {
  const email = document.getElementById('l-email')?.value.trim() || '';
  currentUser = email.toLowerCase().includes('yanti') ? USERS.supervisor : USERS.petugas;
  localStorage.setItem('mr_v2_user', JSON.stringify(currentUser));
  enterApp();
  toast('Login berhasil!', 'lime');
}

function enterApp() {
  if (currentUser.role === 'supervisor') {
    goTo('s-supervisor');
  } else {
    goTo('s-dashboard');
  }
}

function logout() {
  currentUser = null; cl5R = {}; findingsData = {}; photoData = { before: null, after: null }; extraFindings = [];
  localStorage.removeItem('mr_v2_user');
  goTo('s-login');
}

// ════════════════════════════════════════════════════════
// CLOCK
// ════════════════════════════════════════════════════════
function updateClock() {
  const now = new Date();
  const str = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0') + ' WIB';
  const lbl = todayLabel() + ' — Shift ' + currentShift;
  ['date-display','sup-date-display'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent = lbl; });
  const fd = document.getElementById('form-date-display'); if (fd) fd.textContent = lbl;
}

// ════════════════════════════════════════════════════════
// OVERDUE CHECK
// ════════════════════════════════════════════════════════
function checkOverdue() {
  const openFindings = getAllOpenFindings();
  const overdue = openFindings.filter(f => {
    const days = getDueDaysLeft(f.dueDate);
    return days !== null && days < 0;
  });
  const highUndue = openFindings.filter(f => {
    const days = getDueDaysLeft(f.dueDate);
    return f.priority === 'High' && (days === null || days <= 1);
  });
  const count = Math.max(overdue.length, highUndue.length);
  const msg = overdue.length > 0
    ? `${overdue.length} temuan melewati batas waktu!`
    : highUndue.length > 0
    ? `${highUndue.length} temuan High priority mendekati deadline!`
    : '';

  ['dash-overdue-alert','sup-overdue-alert'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = count > 0 ? 'flex' : 'none';
  });
  ['dash-overdue-text','sup-overdue-text'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
  });
  return count;
}

// ════════════════════════════════════════════════════════
// DASHBOARD (PETUGAS)
// ════════════════════════════════════════════════════════
function renderDashboard() {
  if (!currentUser) return;
  const reps = getReports();
  const todayReps = reps.filter(r => r.tanggal === today() && r.status === 'Submitted');
  const selesai  = todayReps.length;
  const total    = AREAS.length;
  const pct      = total ? Math.round(selesai / total * 100) : 0;

  const g = document.getElementById('dash-greeting');
  if (g) g.textContent = currentUser.displayName.split(' ')[0];
  const av = document.getElementById('dash-avatar');
  if (av) av.textContent = currentUser.initials;

  document.getElementById('dash-selesai').textContent = selesai;
  document.getElementById('dash-belum').textContent   = total - selesai;
  document.getElementById('dash-progress-label').textContent = `${selesai} / ${total} area selesai`;
  document.getElementById('dash-progress-pct').textContent   = pct + '%';
  document.getElementById('dash-progress-bar').style.width   = pct + '%';

  const openF = getAllOpenFindings();
  document.getElementById('dash-open-temuan').textContent = openF.length;

  // Open findings widget
  const widget = document.getElementById('dash-open-findings-widget');
  const wList  = document.getElementById('dash-open-findings-list');
  if (openF.length > 0) {
    widget.style.display = 'block';
    const topFindings = openF.sort((a,b) => {
      const pMap = {High:0,Medium:1,Low:2};
      return (pMap[a.priority]||1) - (pMap[b.priority]||1);
    }).slice(0,3);
    wList.innerHTML = topFindings.map(f => {
      const days = getDueDaysLeft(f.dueDate);
      const dClass = dueDateClass(days);
      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px dashed #ddd;cursor:pointer" onclick="openFindingDetail('${f.reportId}','${f.key}',${f.isExtra})">
        <span class="nb-badge prio-${f.priority.toLowerCase()}" style="font-size:8px">${PRIO_LABELS[f.priority]||f.priority}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f.area}</div>
          <div style="font-size:10px;color:#777;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f.description}</div>
        </div>
        ${f.dueDate ? `<span class="${dClass}" style="font-size:9px;white-space:nowrap;font-family:'DM Mono',monospace">${days < 0 ? 'OD!' : days+'h'}</span>` : ''}
      </div>`;
    }).join('');
    wList.innerHTML += `<div style="height:5px"></div>`;
  } else {
    widget.style.display = 'none';
  }

  // Area list
  const cont = document.getElementById('area-list-dashboard');
  if (!cont) return;
  cont.innerHTML = '';
  AREAS.forEach(area => {
    const rep = todayReps.find(r => r.area === area);
    const done = !!rep;
    const color = done ? 'var(--lime)' : 'var(--cream)';
    const row = document.createElement('div');
    row.className = 'area-row';
    row.onclick = done ? () => openDetail(rep.id) : () => { goTo('s-form'); setTimeout(() => { const sel = document.getElementById('form-area'); if (sel) sel.value = area; }, 100); };
    row.innerHTML = `<div class="area-dot" style="background:${color}"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700">${area}</div>
        <div style="font-size:10px;color:var(--muted);font-family:'DM Mono',monospace">${done ? rep.user.displayName + ' · ' + rep.jam_submit : 'Belum diisi hari ini'}</div>
      </div>
      ${done ? `<span class="nb-badge" style="background:var(--lime);font-size:9px">${rep.skor5r}%</span>` : `<span class="nb-badge" style="background:#ddd;font-size:9px;color:#888">BELUM</span>`}
      <i class="ti ti-chevron-right" style="font-size:16px;color:#aaa"></i>`;
    cont.appendChild(row);
  });

  // Notif dot
  const notifs = getNotifs();
  const unread = notifs.filter(n => !n.read);
  const nd = document.getElementById('dash-notif-dot');
  if (nd) nd.style.display = unread.length ? 'block' : 'none';

  checkOverdue();
  updateClock();
}

// ════════════════════════════════════════════════════════
// OPEN FINDINGS SCREEN
// ════════════════════════════════════════════════════════
function setFindingsFilter(f, btn) {
  findingsFilter = f;
  document.querySelectorAll('.filter-bar .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderOpenFindings();
}

function renderOpenFindings() {
  let openF = getAllOpenFindings();

  if (findingsFilter === 'high')    openF = openF.filter(f => f.priority === 'High');
  else if (findingsFilter === 'med') openF = openF.filter(f => f.priority === 'Medium');
  else if (findingsFilter === 'low') openF = openF.filter(f => f.priority === 'Low');
  else if (findingsFilter === 'overdue') openF = openF.filter(f => { const d = getDueDaysLeft(f.dueDate); return d !== null && d < 0; });

  // Sort: priority then due date
  openF.sort((a,b) => {
    const pMap = {High:0,Medium:1,Low:2};
    const pd = (pMap[a.priority]||1) - (pMap[b.priority]||1);
    if (pd !== 0) return pd;
    if (a.dueDate && b.dueDate) return new Date(a.dueDate) - new Date(b.dueDate);
    return 0;
  });

  const countEl = document.getElementById('open-findings-count');
  if (countEl) { countEl.textContent = openF.length; countEl.style.background = openF.length > 0 ? 'var(--red)' : 'var(--lime)'; countEl.style.color = openF.length > 0 ? '#fff' : 'var(--black)'; }

  const cont = document.getElementById('open-findings-list');
  if (!cont) return;

  if (!openF.length) {
    cont.innerHTML = '<div style="text-align:center;padding:30px;color:#aaa;font-size:11px;font-weight:700;font-family:\'DM Mono\',monospace">Tidak ada temuan terbuka ✓<br><br>Semua temuan sudah ditangani!</div>';
    return;
  }

  cont.innerHTML = openF.map(f => {
    const days = getDueDaysLeft(f.dueDate);
    const dClass = dueDateClass(days);
    const catClass = 'cat-' + f.category.toLowerCase().replace('/','').split(' ')[0];
    const prioClass = 'prio-' + f.priority.toLowerCase();
    const borderColor = f.priority === 'High' ? 'var(--red)' : f.priority === 'Medium' ? 'var(--orange)' : 'var(--blue)';
    return `<div class="open-temuan-card" onclick="openFindingDetail('${f.reportId}','${f.key}',${f.isExtra})">
      <div style="display:flex">
        <div class="open-temuan-left" style="background:${borderColor}"></div>
        <div style="flex:1;padding:10px 11px">
          <div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:5px">
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:800">${f.area}</div>
              <div style="font-size:11px;color:var(--muted);font-family:'DM Mono',monospace">${f.tanggal}</div>
            </div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">
              <span class="nb-badge ${prioClass}" style="font-size:8px">${PRIO_LABELS[f.priority]||f.priority}</span>
              <span class="nb-badge ${catClass}" style="font-size:8px">${f.category}</span>
            </div>
          </div>
          <div style="font-size:12px;font-weight:600;margin-bottom:4px">${f.label}</div>
          <div style="font-size:11px;color:#666;margin-bottom:6px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${f.description}</div>
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="nb-badge" style="font-size:8px;${f.status === 'In Progress' ? 'background:#FFF5D9;color:#7A4400;border-color:#7A4400' : 'background:#FFE5E5;color:#AA0000;border-color:#AA0000'}">${f.status === 'In Progress' ? 'DALAM PROSES' : 'OPEN'}</span>
            ${f.dueDate ? `<span class="${dClass}" style="font-size:10px;font-family:'DM Mono',monospace">${dueDateLabel(days, f.dueDate)}</span>` : '<span style="font-size:9px;color:#aaa;font-family:\'DM Mono\',monospace">Belum ada target</span>'}
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  // Update sup preview
  const supPrev = document.getElementById('sup-open-findings-preview');
  if (supPrev) {
    const allOpen = getAllOpenFindings();
    if (!allOpen.length) {
      supPrev.innerHTML = '<div style="text-align:center;font-size:11px;color:#aaa;padding:8px">Tidak ada temuan terbuka ✓</div>';
    } else {
      const top = allOpen.slice(0,3);
      supPrev.innerHTML = top.map(f => {
        const days = getDueDaysLeft(f.dueDate);
        return `<div style="display:flex;align-items:center;gap:7px;padding:5px 0;border-bottom:1px dashed #ddd">
          <span class="nb-badge prio-${f.priority.toLowerCase()}" style="font-size:7px">${PRIO_LABELS[f.priority][0]}</span>
          <div style="flex:1;font-size:11px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.area} — ${f.label}</div>
          ${f.dueDate && days !== null ? `<span class="${dueDateClass(days)}" style="font-size:9px;font-family:'DM Mono',monospace">${days < 0 ? 'OD' : days+'h'}</span>` : ''}
        </div>`;
      }).join('');
    }
    const supOpen = document.getElementById('sup-open-temuan');
    if (supOpen) supOpen.textContent = allOpen.length;
  }
}

function openFindingDetail(reportId, key, isExtra) {
  openCloseFinding(reportId, key, isExtra);
}

// ════════════════════════════════════════════════════════
// CLOSE FINDING / CAPA
// ════════════════════════════════════════════════════════
function openCloseFinding(reportId, findingKey, isExtra) {
  const reps = getReports();
  const r = reps.find(x => x.id === reportId);
  if (!r) { toast('Laporan tidak ditemukan', 'red'); return; }

  let finding;
  if (isExtra) {
    finding = (r.extraFindings || []).find(ef => ef.id === findingKey);
  } else {
    finding = (r.findings || {})[findingKey];
  }
  if (!finding) { toast('Temuan tidak ditemukan', 'red'); return; }

  cfReportId   = reportId;
  cfFindingKey = findingKey;
  cfIsExtra    = isExtra;
  cfPhotoData  = null;

  // Back button
  const backBtn = document.getElementById('close-finding-back-btn');
  if (backBtn) backBtn.onclick = () => goTo('s-open-findings');

  // Fill header
  document.getElementById('cf-area-label').textContent = r.area;
  document.getElementById('cf-item-label').textContent = isExtra ? (finding.label||'Temuan') : (ITEMS_5R.find(i=>i.key===findingKey)?.label||findingKey);
  document.getElementById('cf-desc-preview').textContent = finding.description || '—';

  const badgesRow = document.getElementById('cf-badges-row');
  const prio = isExtra ? (finding.priority||'Medium') : (finding.urgency||'Medium');
  const cat  = isExtra ? (finding.category||'5R') : '5R';
  const catClass = 'cat-' + cat.toLowerCase().replace('/','').split(' ')[0];
  badgesRow.innerHTML = `
    <span class="nb-badge prio-${prio.toLowerCase()}" style="font-size:9px">${PRIO_LABELS[prio]||prio}</span>
    <span class="nb-badge ${catClass}" style="font-size:9px">${cat}</span>
    <span class="nb-badge" style="background:var(--yellow);font-size:9px">${r.tanggal}</span>`;

  const prioB = document.getElementById('close-finding-prio-badge');
  if (prioB) { prioB.textContent = (PRIO_LABELS[prio]||prio).toUpperCase(); prioB.className = 'nb-badge prio-' + prio.toLowerCase(); }

  // Pre-fill existing CAPA if any
  const existingCapa = finding.capa || {};
  document.getElementById('capa-immediate').value  = existingCapa.immediate  || '';
  document.getElementById('capa-corrective').value = existingCapa.corrective || '';
  document.getElementById('capa-preventive').value = existingCapa.preventive || '';
  document.getElementById('capa-corrective-pic').value = existingCapa.corrective_pic || '';
  document.getElementById('close-finding-status').value = finding.status === 'Closed' ? 'Closed' : 'In Progress';

  // Default due date based on priority
  const defDue = new Date();
  defDue.setDate(defDue.getDate() + (PRIO_DAYS[prio] || 3));
  document.getElementById('close-finding-due').value = finding.dueDate || defDue.toISOString().split('T')[0];
  document.getElementById('close-finding-by').value  = finding.closedBy || (currentUser?.displayName || '');

  // Photo preview
  const photoPrev = document.getElementById('close-finding-photo-prev');
  if (photoPrev) {
    photoPrev.innerHTML = finding.closingPhoto
      ? `<img src="${finding.closingPhoto}" style="width:100%;max-height:80px;object-fit:cover;border:var(--border);border-radius:var(--radius);margin-top:4px">
         <button onclick="cfPhotoData=null;document.getElementById('close-finding-photo-prev').innerHTML=''" style="font-size:10px;color:var(--red);background:none;border:none;cursor:pointer;font-weight:700;margin-top:2px">Hapus</button>`
      : '';
    if (finding.closingPhoto) cfPhotoData = finding.closingPhoto;
  }

  // Reset tab
  selectCapaTab(0, document.querySelector('.capa-tab-btn'));
  document.getElementById('close-finding-error').style.display = 'none';

  goTo('s-close-finding');
}

function selectCapaTab(idx, btn) {
  [0,1].forEach(i => {
    const el = document.getElementById('capa-tab-' + i);
    if (el) el.style.display = i === idx ? 'block' : 'none';
  });
  document.querySelectorAll('.capa-tab-btn').forEach((b,i) => {
    b.classList.toggle('active', i === idx);
  });
}

// 3. REVISI handleCloseFindingPhoto
function handleCloseFindingPhoto(input) {
  const file = input.files[0]; if (!file) return;
  compressImage(file, (compressedData) => {
    cfPhotoData = compressedData;
    const prev = document.getElementById('close-finding-photo-prev');
    if (prev) prev.innerHTML = `<img src="${compressedData}" style="width:100%;max-height:80px;object-fit:cover;border:var(--border);border-radius:var(--radius);margin-top:4px">
      <button onclick="cfPhotoData=null;document.getElementById('close-finding-photo-prev').innerHTML=''" style="font-size:10px;color:var(--red);background:none;border:none;cursor:pointer;font-weight:700;margin-top:2px">Hapus</button>`;
  });
}

function submitCloseFinding() {
  const errEl = document.getElementById('close-finding-error');
  const status   = document.getElementById('close-finding-status')?.value;
  const dueDate  = document.getElementById('close-finding-due')?.value;
  const closedBy = document.getElementById('close-finding-by')?.value.trim();
  const immediate  = document.getElementById('capa-immediate')?.value.trim();
  const corrective = document.getElementById('capa-corrective')?.value.trim();
  const preventive = document.getElementById('capa-preventive')?.value.trim();
  const corrPic    = document.getElementById('capa-corrective-pic')?.value;

  if (!dueDate) { errEl.style.display='block'; errEl.textContent='Target selesai wajib diisi!'; return; }
  if (!immediate && !corrective) { errEl.style.display='block'; errEl.textContent='Minimal isi Immediate Action atau Corrective Action!'; return; }
  if (status === 'Closed' && !cfPhotoData) { errEl.style.display='block'; errEl.textContent='Foto bukti perbaikan wajib diupload saat menutup temuan!'; return; }

  errEl.style.display = 'none';

  const reps = getReports().map(r => {
    if (r.id !== cfReportId) return r;
    if (cfIsExtra) {
      r.extraFindings = (r.extraFindings || []).map(ef => {
        if (ef.id !== cfFindingKey) return ef;
        return {
          ...ef,
          status,
          dueDate,
          closedBy,
          closingPhoto: cfPhotoData,
          closedAt: status === 'Closed' ? new Date().toISOString() : null,
          capa: { immediate, corrective, corrective_pic: corrPic, preventive }
        };
      });
    } else {
      if (r.findings && r.findings[cfFindingKey]) {
        r.findings[cfFindingKey] = {
          ...r.findings[cfFindingKey],
          status,
          dueDate,
          closedBy,
          closingPhoto: cfPhotoData,
          closedAt: status === 'Closed' ? new Date().toISOString() : null,
          capa: { immediate, corrective, corrective_pic: corrPic, preventive }
        };
      }
    }
    return r;
  });

  saveReports(reps);
  // ── Sinkronisasi dokumen yang diperbarui ke Firestore (satu dokumen saja) ──
  fbSaveReportById(cfReportId);
  if (status === 'Closed') {
    const notifs = getNotifs();
    notifs.unshift({ id:'n-'+Date.now(), type:'finding_closed', title:'Temuan berhasil ditutup', body:`${cfFindingKey} — ${cfReportId}`, time: new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})+' WIB', read:false });
    saveNotifs(notifs);
    toast('Temuan ditutup dengan bukti perbaikan ✅', 'lime');
  } else {
    toast('Tindakan perbaikan disimpan 💾', 'yellow');
  }

  goTo('s-open-findings');
  renderOpenFindings();
}

// ════════════════════════════════════════════════════════
// CHECKLIST 5R BUILDER
// ════════════════════════════════════════════════════════
function build5R() {
  const c = document.getElementById('checklist5r');
  if (!c) return;
  c.innerHTML = '';
  ITEMS_5R.forEach(item => {
    const div = document.createElement('div');
    div.className = 'nb-check-row';
    div.innerHTML = `
      <div class="nb-check-header">
        <div style="flex:1">
          <div style="font-size:12px;font-weight:700">${item.label}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:1px">${item.desc}</div>
        </div>
        <div class="nb-toggle-group" style="width:150px;flex-shrink:0;margin-left:8px">
          <button class="nb-toggle-opt${cl5R[item.key]==='ok'?' sel-ok':''}" onclick="set5R('${item.key}','ok',this)">OK</button>
          <button class="nb-toggle-opt${cl5R[item.key]==='no'?' sel-no':''}" onclick="set5R('${item.key}','no',this)">NO</button>
          <button class="nb-toggle-opt${cl5R[item.key]==='na'?' sel-na':''}" onclick="set5R('${item.key}','na',this)">N/A</button>
        </div>
      </div>
      <div class="finding-panel${cl5R[item.key]==='no'?' open':''}" id="fd-panel-${item.key}">
        <div style="font-size:11px;font-weight:800;color:var(--red);margin-bottom:7px">⚠ Detail Temuan — ${item.label}</div>
        <div class="grid-2" style="margin-bottom:7px">
          <div>
            <label class="nb-label">Kategori</label>
            <select class="nb-select" id="fd-cat-${item.key}" onchange="syncFinding('${item.key}')">
              ${CATEGORIES.map(c => `<option value="${c}" ${(findingsData[item.key]?.category||'Delivery')===c?'selected':''}>${c}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="nb-label">Prioritas</label>
            <select class="nb-select" id="fd-urg-${item.key}" onchange="syncFinding('${item.key}')">
              <option value="Low"    ${(findingsData[item.key]?.urgency||'Medium')==='Low'   ?'selected':''}>🔵 Rendah</option>
              <option value="Medium" ${(findingsData[item.key]?.urgency||'Medium')==='Medium'?'selected':''}>🟠 Sedang</option>
              <option value="High"   ${(findingsData[item.key]?.urgency||'Medium')==='High'  ?'selected':''}>🔴 Tinggi</option>
            </select>
          </div>
        </div>
        <div style="margin-bottom:7px">
          <label class="nb-label">Departemen (DEPT)</label>
          <select class="nb-select" id="fd-dept-${item.key}" onchange="syncFinding('${item.key}')">
            <option value="">— Pilih Dept —</option>
            ${DEPARTMENTS.map(d => `<option value="${d}" ${(findingsData[item.key]?.dept||'')===d?'selected':''}>${d}</option>`).join('')}
          </select>
        </div>
        <label class="nb-label">Deskripsi Temuan *</label>
        <textarea class="nb-textarea" id="fd-desc-${item.key}" rows="2"
          placeholder="Jelaskan temuan secara spesifik..."
          oninput="syncFinding('${item.key}')"
          style="margin-bottom:7px">${findingsData[item.key]?.description||''}</textarea>
        <div class="grid-2">
          <div>
            <label class="nb-label">Target Selesai *</label>
            <input class="nb-input" type="date" id="fd-due-${item.key}" value="${findingsData[item.key]?.dueDate||getDefaultDue(findingsData[item.key]?.urgency||'Medium')}" onchange="syncFinding('${item.key}')">
          </div>
          <div>
            <label class="nb-label">Foto Temuan</label>
            <label class="nb-btn nb-btn-full" style="cursor:pointer;padding:8px;font-size:10px">
              <i class="ti ti-camera"></i> Foto
              <input type="file" accept="image/*" style="display:none" onchange="handleFindingPhoto(this,'${item.key}')">
            </label>
            <div id="fd-photo-prev-${item.key}" style="margin-top:4px"></div>
          </div>
        </div>
      </div>`;
    c.appendChild(div);
  });
}

function getDefaultDue(urgency) {
  const days = PRIO_DAYS[urgency] || 3;
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function set5R(key, val, btn) {
  cl5R[key] = val;
  btn.closest('.nb-toggle-group').querySelectorAll('button').forEach(b => b.classList.remove('sel-ok','sel-no','sel-na'));
  btn.classList.add('sel-' + val);
  const panel = document.getElementById('fd-panel-' + key);
  if (panel) {
    if (val === 'no') {
      panel.classList.add('open');
      if (!findingsData[key]) findingsData[key] = { description:'', urgency:'Medium', category:'Delivery', dept:'', status:'Open', dueDate: getDefaultDue('Medium') };
    } else {
      panel.classList.remove('open');
      delete findingsData[key];
    }
  }
}

function syncFinding(key) {
  if (!findingsData[key]) findingsData[key] = { status:'Open' };
  const d    = document.getElementById('fd-desc-' + key);
  const u    = document.getElementById('fd-urg-'  + key);
  const cat  = document.getElementById('fd-cat-'  + key);
  const due  = document.getElementById('fd-due-'  + key);
  const dept = document.getElementById('fd-dept-' + key);
  if (d)    findingsData[key].description = d.value;
  if (u)    findingsData[key].urgency     = u.value;
  if (cat)  findingsData[key].category    = cat.value;
  if (due)  findingsData[key].dueDate     = due.value;
  if (dept) findingsData[key].dept        = dept.value;
}

// 2. REVISI handleFindingPhoto
function handleFindingPhoto(input, key) {
  const file = input.files[0]; if (!file) return;
  compressImage(file, (compressedData) => {
    if (!findingsData[key]) findingsData[key] = { status:'Open' };
    findingsData[key].photo = compressedData;
    const prev = document.getElementById('fd-photo-prev-' + key);
    if (prev) prev.innerHTML = `<img src="${compressedData}" style="width:100%;max-height:55px;object-fit:cover;border:var(--border);border-radius:3px">
      <button onclick="removeFindingPhoto('${key}')" style="font-size:9px;color:var(--red);background:none;border:none;cursor:pointer;font-weight:700;margin-top:2px">Hapus</button>`;
  });
}

function removeFindingPhoto(key) {
  if (findingsData[key]) delete findingsData[key].photo;
  const el = document.getElementById('fd-photo-prev-' + key); if (el) el.innerHTML = '';
}

// ════════════════════════════════════════════════════════
// EXTRA FINDINGS (non-5R)
// ════════════════════════════════════════════════════════
function addExtraFinding() {
  const id = 'ef-' + (++extraFindingIdCounter);
  extraFindings.push({ id, label:'', category:'Quality', dept:'', priority:'Medium', description:'', dueDate: getDefaultDue('Medium'), status:'Open', photo: null });
  renderExtraFindings();
}

function renderExtraFindings() {
  const cont = document.getElementById('extra-findings-list');
  if (!cont) return;
  if (!extraFindings.length) {
    cont.innerHTML = '<div style="text-align:center;font-size:11px;color:#aaa;padding:8px;font-family:\'DM Mono\',monospace">Belum ada temuan tambahan</div>';
    return;
  }
  cont.innerHTML = extraFindings.map((ef, idx) => `
    <div style="border:var(--border);border-radius:var(--radius);padding:9px;margin-bottom:7px;background:var(--cream)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:11px;font-weight:800;font-family:'DM Mono',monospace">TEMUAN #${idx+1}</span>
        <button class="nb-btn nb-btn-sm nb-btn-red" onclick="removeExtraFinding('${ef.id}')"><i class="ti ti-x"></i></button>
      </div>
      <label class="nb-label">Label / Judul Temuan</label>
      <input class="nb-input" type="text" placeholder="Contoh: Kebocoran oli mesin X..." style="margin-bottom:6px" value="${ef.label}" oninput="updateExtraFinding('${ef.id}','label',this.value)">
      <div class="grid-2" style="margin-bottom:6px">
        <div>
          <label class="nb-label">Kategori</label>
          <select class="nb-select" onchange="updateExtraFinding('${ef.id}','category',this.value)">
            ${CATEGORIES.map(c => `<option value="${c}" ${ef.category===c?'selected':''}>${c}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="nb-label">Prioritas</label>
          <select class="nb-select" onchange="updateExtraFinding('${ef.id}','priority',this.value);updateExtraFindingDue('${ef.id}',this.value)">
            <option value="Low" ${ef.priority==='Low'?'selected':''}>🔵 Rendah</option>
            <option value="Medium" ${ef.priority==='Medium'?'selected':''}>🟠 Sedang</option>
            <option value="High" ${ef.priority==='High'?'selected':''}>🔴 Tinggi</option>
          </select>
        </div>
      </div>
      <div style="margin-bottom:6px">
        <label class="nb-label">Departemen (DEPT)</label>
        <select class="nb-select" onchange="updateExtraFinding('${ef.id}','dept',this.value)">
          <option value="">— Pilih Dept —</option>
          ${DEPARTMENTS.map(d => `<option value="${d}" ${ef.dept===d?'selected':''}>${d}</option>`).join('')}
        </select>
      </div>
      <label class="nb-label">Deskripsi</label>
      <textarea class="nb-textarea" rows="2" placeholder="Detail temuan..." style="margin-bottom:6px" oninput="updateExtraFinding('${ef.id}','description',this.value)">${ef.description}</textarea>
      <label class="nb-label">Target Selesai</label>
      <input class="nb-input" type="date" value="${ef.dueDate}" onchange="updateExtraFinding('${ef.id}','dueDate',this.value)">
    </div>`).join('');
}

function updateExtraFinding(id, field, val) {
  const ef = extraFindings.find(e => e.id === id);
  if (ef) ef[field] = val;
}

function updateExtraFindingDue(id, prio) {
  const ef = extraFindings.find(e => e.id === id);
  if (ef) ef.dueDate = getDefaultDue(prio);
  setTimeout(renderExtraFindings, 50);
}

function removeExtraFinding(id) {
  extraFindings = extraFindings.filter(e => e.id !== id);
  renderExtraFindings();
}

function selShift(btn, shift) {
  currentShift = shift;
  ['shift-pagi','shift-siang','shift-malam'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('sel-ok');
  });
  btn.classList.add('sel-ok');
  const badge = document.getElementById('form-shift-badge');
  if (badge) badge.textContent = shift;
}

// ════════════════════════════════════════════════════════
// PHOTO CAPTURE
// ════════════════════════════════════════════════════════

// Fungsi Pembantu Kompresi Gambar
function compressImage(file, callback) {
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      const maxSize = 800; // Maksimal 800px

      if (width > height && width > maxSize) {
        height = Math.round(height * maxSize / width); width = maxSize;
      } else if (height > maxSize) {
        width = Math.round(width * maxSize / height); height = maxSize;
      }
      
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      
      // Kualitas 0.6 (60%) agar size sangat kecil (puluhan KB saja)
      callback(canvas.toDataURL('image/jpeg', 0.6));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function triggerPhoto(type) {
  document.getElementById('file-' + type).click();
}

// 1. REVISI handlePhotoUpload
function handlePhotoUpload(input, type) {
  const file = input.files[0]; if (!file) return;
  compressImage(file, (compressedData) => {
    photoData[type] = compressedData;
    const box = document.getElementById('pb-' + type);
    box.classList.add('filled');
    box.innerHTML = `<img src="${compressedData}"><div class="photo-label">${type==='before'?'SEBELUM':'SESUDAH'} ✓</div>`;
  });
}

// ════════════════════════════════════════════════════════
// SUBMIT FORM
// ════════════════════════════════════════════════════════
function submitForm(isDraft) {
  const errEl = document.getElementById('form-error');
  const area  = document.getElementById('form-area')?.value;
  if (!area) { errEl.style.display='block'; errEl.textContent='Pilih area terlebih dahulu!'; return; }

  if (!isDraft) {
    if (!photoData.before || !photoData.after) {
      errEl.style.display='block'; errEl.textContent='Foto Sebelum dan Sesudah wajib diisi!'; return;
    }
    const unanswered = ITEMS_5R.filter(i => !cl5R[i.key]);
    if (unanswered.length) {
      errEl.style.display='block'; errEl.textContent='Semua checklist 5R wajib dijawab (' + unanswered.map(i=>i.label).join(', ') + ')'; return;
    }
    let fdErr = false;
    ITEMS_5R.forEach(i => {
      if (cl5R[i.key] === 'no') {
        syncFinding(i.key);
        if (!(findingsData[i.key]?.description||'').trim()) {
          fdErr = true;
          toast('Deskripsi temuan wajib diisi: ' + i.label, 'red');
        }
        if (!findingsData[i.key]?.dueDate) {
          fdErr = true;
          toast('Target selesai wajib diisi: ' + i.label, 'red');
        }
      }
    });
    if (fdErr) return;

    // Validasi Extra Findings
    const invalidExtra = extraFindings.find(ef => !ef.label.trim() || !ef.description.trim());
    if (invalidExtra) {
      errEl.style.display = 'block'; 
      errEl.textContent = 'Label dan Deskripsi pada semua Temuan Tambahan wajib diisi!'; 
      return;
    }
  }
  errEl.style.display = 'none';

  // Hitung skor 5R
  let okCount = 0, totalAnswered = 0;
  ITEMS_5R.forEach(i => {
    if (cl5R[i.key] === 'ok') { okCount++; totalAnswered++; }
    else if (cl5R[i.key] === 'no') { totalAnswered++; }
  });
  const skor5r = totalAnswered > 0 ? Math.round(okCount / totalAnswered * 100) : 0;

  const now = new Date();
  const jamStr = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0') + ' WIB';
  const tsStr  = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear().toString().slice(-2)} – ${jamStr}`;
  const repId  = 'MR-' + Date.now();

  const report = {
    id: repId, tanggal: today(), jam_submit: jamStr,
    area, shift: currentShift,
    user: { uid: currentUser.uid, displayName: currentUser.displayName, role: currentUser.role },
    checklist: { ...cl5R },
    findings:  JSON.parse(JSON.stringify(findingsData)),
    extraFindings: JSON.parse(JSON.stringify(extraFindings)),
    foto_before: photoData.before, foto_after: photoData.after,
    catatan: document.getElementById('form-catatan')?.value || '',
    skor5r, status: isDraft ? 'Draft' : 'Submitted',
    verified: false, created_at: now.toISOString()
  };

  const reps = getReports();
  reps.push(report);
  saveReports(reps); // tulis ke localStorage cache

  // ── Kirim ke Firestore secara eksplisit (satu dokumen, bukan seluruh array) ──
  fbSaveReport(report);

  if (!isDraft) {
    const notifs = getNotifs();
    const totalFindings = Object.keys(report.findings).length + extraFindings.length;
    notifs.unshift({
      id: 'n-'+Date.now(), type:'new_report',
      title: 'Laporan baru menunggu verifikasi',
      body: currentUser.displayName + ' — ' + area + (totalFindings ? ` (${totalFindings} temuan)` : ''),
      time: jamStr, reportId: repId, read: false
    });
    saveNotifs(notifs);

    document.getElementById('success-area').textContent  = area;
    document.getElementById('success-id').textContent    = repId;
    document.getElementById('success-ts').textContent    = tsStr;
    document.getElementById('success-skor').textContent  = skor5r + '%';
    document.getElementById('success-temuan').textContent = totalFindings;

    cl5R = {}; findingsData = {}; extraFindings = []; photoData = { before:null, after:null };
    goTo('s-success');
    toast('Laporan terkirim! ✅', 'lime');
  } else {
    toast('Draft disimpan 💾', 'yellow');
    goTo('s-dashboard'); renderDashboard();
  }
}

function resetPhotoBox(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const type = id === 'pb-before' ? 'before' : 'after';
  el.classList.remove('filled');
  el.innerHTML = `<i class="ti ti-camera${type==='after'?'-check':''}" style="font-size:22px;color:#aaa"></i><span style="font-size:9px;font-weight:700;color:#aaa;font-family:'DM Mono',monospace">${type==='before'?'SEBELUM':'SESUDAH'}</span>`;
}

// ════════════════════════════════════════════════════════
// HISTORY
// ════════════════════════════════════════════════════════
function setHistFilter(filter, btn) {
  histFilter = filter;
  document.querySelectorAll('#s-history .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderHistory();
}

function renderHistory() {
  const cont = document.getElementById('history-list');
  if (!cont) return;
  cont.innerHTML = '';
  let reps = getReports();
  if (currentUser?.role === 'petugas') reps = reps.filter(r => r.user?.uid === currentUser.uid);

  const now = new Date();
  if (histFilter === 'today') reps = reps.filter(r => r.tanggal === today());
  else if (histFilter === 'week') { const wa = new Date(now-7*86400000).toISOString().split('T')[0]; reps = reps.filter(r => r.tanggal >= wa); }
  else if (histFilter === 'month') { const mo = new Date(now.getFullYear(),now.getMonth(),1).toISOString().split('T')[0]; reps = reps.filter(r => r.tanggal >= mo); }

  if (!reps.length) {
    cont.innerHTML = '<div style="text-align:center;padding:24px;border:var(--border);border-radius:var(--radius);background:var(--white);font-size:11px;color:#aaa;font-weight:700;font-family:\'DM Mono\',monospace">Belum ada laporan.</div>';
    return;
  }

  [...reps].reverse().forEach(r => {
    const isDraft    = r.status === 'Draft';
    const isVerified = r.verified;
    const stBg  = isDraft ? 'var(--cream)' : isVerified ? 'var(--blue)' : 'var(--lime)';
    const stCl  = isVerified ? '#fff' : 'var(--black)';
    const stLbl = isDraft ? 'DRAFT' : isVerified ? 'TERVERIF' : 'SUBMITTED';
    const totalF = Object.keys(r.findings||{}).length + (r.extraFindings||[]).length;
    const openF  = Object.values(r.findings||{}).filter(f=>f.status!=='Closed').length + (r.extraFindings||[]).filter(f=>f.status!=='Closed').length;

    const card = document.createElement('div');
    card.className = 'hist-card';
    card.onclick = () => isDraft ? resumeDraft(r.id) : openDetail(r.id);
    card.innerHTML = `
      <div style="display:flex">
        <div style="width:6px;background:${stBg};flex-shrink:0"></div>
        <div style="padding:10px;flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:3px">
            <div style="font-size:12px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px">${r.area}</div>
            <span class="nb-badge" style="background:${stBg};color:${stCl};border-color:${stBg};font-size:8px">${stLbl}</span>
          </div>
          <div style="font-size:10px;color:var(--muted);font-family:'DM Mono',monospace;margin-bottom:5px">${r.tanggal} · ${r.jam_submit} · Shift ${r.shift}</div>
          <div style="display:flex;gap:6px;align-items:center">
            <span class="nb-badge" style="background:${r.skor5r>=80?'var(--lime)':r.skor5r>=60?'var(--yellow)':'#FFE5E5'};font-size:9px">5R: ${r.skor5r}%</span>
            ${totalF > 0 ? `<span class="nb-badge" style="background:#FFE5E5;color:var(--red);border-color:var(--red);font-size:9px">${openF > 0 ? openF + ' Open' : totalF + ' Closed'}</span>` : ''}
            <span style="font-size:10px;color:var(--muted);font-family:'DM Mono',monospace">${r.user.displayName}</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;padding-right:10px"><i class="ti ti-chevron-right" style="font-size:16px;color:#aaa"></i></div>
      </div>`;
    cont.appendChild(card);
  });
}

function resumeDraft(reportId) {
  const reps = getReports();
  const r = reps.find(x => x.id === reportId);
  if (!r) return;

  // Tarik data ke form
  document.getElementById('form-area').value = r.area;
  currentShift = r.shift;
  ['shift-pagi','shift-siang','shift-malam'].forEach(id => document.getElementById(id)?.classList.remove('sel-ok'));
  document.getElementById('shift-' + r.shift.toLowerCase())?.classList.add('sel-ok');
  document.getElementById('form-shift-badge').textContent = r.shift;
  
  cl5R = { ...r.checklist };
  findingsData = JSON.parse(JSON.stringify(r.findings || {}));
  extraFindings = JSON.parse(JSON.stringify(r.extraFindings || []));
  photoData = { before: r.foto_before, after: r.foto_after };
  document.getElementById('form-catatan').value = r.catatan || '';

  // Render ulang UI form
  build5R();
  renderExtraFindings();

  if (photoData.before) {
    const box = document.getElementById('pb-before');
    box.classList.add('filled'); box.innerHTML = `<img src="${photoData.before}"><div class="photo-label">SEBELUM ✓</div>`;
  }
  if (photoData.after) {
    const box = document.getElementById('pb-after');
    box.classList.add('filled'); box.innerHTML = `<img src="${photoData.after}"><div class="photo-label">SESUDAH ✓</div>`;
  }

  // Hapus draft lama agar tidak double saat di-submit ulang
  saveReports(reps.filter(x => x.id !== reportId));
  
  goTo('s-form');
  toast('Melanjutkan draft sebelumnya...', 'yellow');
}

// ════════════════════════════════════════════════════════
// DETAIL LAPORAN
// ════════════════════════════════════════════════════════
function openDetail(reportId) {
  const reps = getReports();
  const r = reps.find(rep => rep.id === reportId);
  if (!r) return;
  selectedReport = r;

  const cont = document.getElementById('detail-content');
  const fdKeys = Object.keys(r.findings || {});
  const extraF = r.extraFindings || [];

  // 5R checklist
  let checkHtml = ITEMS_5R.map(item => {
    const val = r.checklist?.[item.key] || 'na';
    const bg  = val==='ok' ? 'var(--lime)' : val==='no' ? 'var(--red)' : '#d8d4cc';
    const cl  = val==='no' ? '#fff' : 'var(--black)';
    const lbl = val==='ok' ? 'OK' : val==='no' ? 'TIDAK' : 'N/A';
    return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
      <span style="font-size:12px;font-weight:700">${item.label}</span>
      <span class="nb-badge" style="background:${bg};color:${cl};border-color:${bg};font-size:8px">${lbl}</span>
    </div>`;
  }).join('');

  // 5R Findings
  let findHtml = fdKeys.map(k => {
    const f = r.findings[k];
    const item = ITEMS_5R.find(i => i.key === k);
    const days = getDueDaysLeft(f.dueDate);
    const dClass = dueDateClass(days);
    const isClosed = f.status === 'Closed';
    return `<div class="temuan-card">
      <div class="temuan-header">
        <div>
          <span style="font-size:12px;font-weight:800">${item?.label||k}</span>
          <span class="nb-badge cat-${(f.category||'5R').toLowerCase().replace('/','').split(' ')[0]}" style="font-size:8px;margin-left:5px">${f.category||'5R'}</span>
        </div>
        <div style="display:flex;gap:4px">
          <span class="nb-badge prio-${(f.urgency||'medium').toLowerCase()}" style="font-size:8px">${PRIO_LABELS[f.urgency]||f.urgency||'—'}</span>
          <span class="nb-badge" style="font-size:8px;${isClosed?'background:var(--lime);border-color:var(--lime)':'background:#FFE5E5;color:#AA0000;border-color:#AA0000'}">${isClosed?'CLOSED':'OPEN'}</span>
        </div>
      </div>
      <div class="temuan-body">
        <div style="font-size:12px;color:#555;margin-bottom:5px">${f.description||'—'}</div>
        ${f.dueDate ? `<div style="font-size:10px;font-family:'DM Mono',monospace" class="${dClass}">Target: ${dueDateLabel(days, f.dueDate)}</div>` : ''}
        ${f.photo ? `<img src="${f.photo}" style="width:100%;max-height:70px;object-fit:cover;border:var(--border);border-radius:3px;margin-top:7px">` : ''}
        ${isClosed && f.closingPhoto ? `<div style="margin-top:7px"><div style="font-size:9px;color:var(--muted);font-family:'DM Mono',monospace;margin-bottom:3px">FOTO BUKTI PERBAIKAN:</div><img src="${f.closingPhoto}" style="width:100%;max-height:70px;object-fit:cover;border:var(--border);border-radius:3px"></div>` : ''}
        ${isClosed && f.capa ? `<div style="margin-top:7px;padding:8px;background:#F5FFF0;border:1px dashed var(--lime);border-radius:3px">
          ${f.capa.immediate  ? `<div style="font-size:10px;margin-bottom:3px"><b>Immediate:</b> ${f.capa.immediate}</div>` : ''}
          ${f.capa.corrective ? `<div style="font-size:10px;margin-bottom:3px"><b>Corrective:</b> ${f.capa.corrective}</div>` : ''}
          ${f.capa.preventive ? `<div style="font-size:10px"><b>Preventive:</b> ${f.capa.preventive}</div>` : ''}
        </div>` : ''}
        ${!isClosed ? `<button class="nb-btn nb-btn-sm" style="margin-top:8px;background:var(--black);color:var(--white)" onclick="openCloseFinding('${r.id}','${k}',false)"><i class="ti ti-arrow-right"></i> Isi Tindakan Perbaikan</button>` : `<div style="font-size:10px;color:var(--muted);font-family:'DM Mono',monospace;margin-top:5px">Ditutup oleh: ${f.closedBy||'—'} · ${f.closedAt?fmtDate(f.closedAt):'—'}</div>`}
      </div>
    </div>`;
  }).join('');

  // Extra Findings
  let extraHtml = extraF.map(ef => {
    const days = getDueDaysLeft(ef.dueDate);
    const isClosed = ef.status === 'Closed';
    const catClass = 'cat-' + (ef.category||'5R').toLowerCase().replace('/','').split(' ')[0];
    return `<div class="temuan-card">
      <div class="temuan-header">
        <div>
          <span style="font-size:12px;font-weight:800">${ef.label||'Temuan'}</span>
          <span class="nb-badge ${catClass}" style="font-size:8px;margin-left:5px">${ef.category||'5R'}</span>
        </div>
        <div style="display:flex;gap:4px">
          <span class="nb-badge prio-${(ef.priority||'medium').toLowerCase()}" style="font-size:8px">${PRIO_LABELS[ef.priority]||ef.priority||'—'}</span>
          <span class="nb-badge" style="font-size:8px;${isClosed?'background:var(--lime);border-color:var(--lime)':'background:#FFE5E5;color:#AA0000;border-color:#AA0000'}">${isClosed?'CLOSED':'OPEN'}</span>
        </div>
      </div>
      <div class="temuan-body">
        <div style="font-size:12px;color:#555;margin-bottom:5px">${ef.description||'—'}</div>
        ${ef.dueDate ? `<div style="font-size:10px;font-family:'DM Mono',monospace" class="${dueDateClass(days)}">Target: ${dueDateLabel(days, ef.dueDate)}</div>` : ''}
        ${!isClosed ? `<button class="nb-btn nb-btn-sm" style="margin-top:8px;background:var(--black);color:var(--white)" onclick="openCloseFinding('${r.id}','${ef.id}',true)"><i class="ti ti-arrow-right"></i> Isi Tindakan Perbaikan</button>` : `<div style="font-size:10px;color:var(--muted);font-family:'DM Mono',monospace;margin-top:5px">Ditutup oleh: ${ef.closedBy||'—'}</div>`}
      </div>
    </div>`;
  }).join('');

  // Verif
  let verifHtml = '';
  if (r.verified) {
    verifHtml = `<div class="nb-card" style="padding:11px;border-left:4px solid var(--blue);margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:9px">
        <div class="profile-avatar" style="width:34px;height:34px;font-size:12px;background:var(--blue);color:#fff">YP</div>
        <div><div style="font-size:13px;font-weight:700">${USERS.supervisor.displayName}</div><div style="font-size:10px;color:var(--muted);font-family:'DM Mono',monospace">${USERS.supervisor.jabatan}</div></div>
        <span class="nb-badge" style="margin-left:auto;background:${r.verif_action==='approve'?'var(--lime)':'var(--red)'};color:${r.verif_action==='approve'?'var(--black)':'#fff'};border-color:${r.verif_action==='approve'?'var(--lime)':'var(--red)'};font-size:8px">${r.verif_action==='approve'?'DISETUJUI':'DITOLAK'}</span>
      </div>
      ${r.verif_catatan ? `<div style="margin-top:9px;padding-top:9px;border-top:1px dashed #ddd;font-size:12px;color:#555"><b>Catatan:</b> ${r.verif_catatan}</div>` : ''}
    </div>`;
  } else if (currentUser?.role === 'supervisor') {
    verifHtml = `<button class="nb-btn nb-btn-blue nb-btn-full" style="margin-bottom:8px" onclick="openVerif('${r.id}');goTo('s-verif')"><i class="ti ti-shield-check"></i> Approve sebagai FM / Dept Head</button>`;
  } else {
    verifHtml = `<div style="text-align:center;padding:10px;border:var(--border);border-radius:var(--radius);background:var(--white);margin-bottom:12px"><span class="nb-badge" style="background:var(--yellow);font-size:10px">Menunggu Persetujuan FM / Dept Head</span></div>`;
  }

  const totalF = fdKeys.length + extraF.length;
  const openF  = fdKeys.filter(k => r.findings[k]?.status !== 'Closed').length + extraF.filter(ef => ef.status !== 'Closed').length;

  cont.innerHTML = `
    <div class="nb-card-dark" style="padding:12px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="color:#888;font-size:9px;font-family:'DM Mono',monospace;letter-spacing:.5px;text-transform:uppercase">${r.area}</div>
          <div style="color:var(--yellow);font-size:17px;font-weight:800;margin:2px 0">Morning Round</div>
          <div style="color:#aaa;font-size:10px;font-family:'DM Mono',monospace">${r.user.displayName} · ${r.jam_submit} · Shift ${r.shift}</div>
        </div>
        <span class="nb-badge" style="background:${r.skor5r>=80?'var(--lime)':r.skor5r>=60?'var(--yellow)':'var(--red)'};color:${r.skor5r>=60?'var(--black)':'#fff'};font-size:12px;padding:5px 10px">${r.skor5r}%</span>
      </div>
      <div style="margin-top:7px;display:flex;gap:5px;flex-wrap:wrap">
        ${r.verified ? `<span class="nb-badge" style="background:var(--blue);color:#fff;border-color:var(--blue);font-size:8px"><i class="ti ti-shield-check"></i> TERVERIF</span>` : ''}
        ${totalF > 0 ? `<span class="nb-badge" style="${openF>0?'background:#FFE5E5;color:#AA0000;border-color:#AA0000':'background:var(--lime);border-color:var(--lime)'};font-size:8px">${openF > 0 ? openF + ' OPEN' : 'ALL CLOSED'}</span>` : ''}
        <span class="nb-badge" style="color:#aaa;border-color:#555;font-size:8px">${r.id}</span>
      </div>
    </div>

    <div class="sec-hdr">Foto Area</div>
    <div class="grid-2" style="margin-bottom:12px">
      <div style="border:var(--border);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow)">
        <div style="height:75px;${r.foto_before?'':'background:var(--cream);'}display:flex;align-items:center;justify-content:center;overflow:hidden">
          ${r.foto_before ? `<img src="${r.foto_before}" style="width:100%;height:100%;object-fit:cover">` : `<i class="ti ti-photo" style="font-size:22px;color:#bbb"></i>`}
        </div>
        <div style="padding:4px;background:var(--white);font-size:8px;font-weight:800;text-align:center;border-top:2px solid var(--black);font-family:'DM Mono',monospace;letter-spacing:.5px">SEBELUM</div>
      </div>
      <div style="border:var(--border);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow)">
        <div style="height:75px;${r.foto_after?'':'background:#d4f0d4;'}display:flex;align-items:center;justify-content:center;overflow:hidden">
          ${r.foto_after ? `<img src="${r.foto_after}" style="width:100%;height:100%;object-fit:cover">` : `<i class="ti ti-photo-check" style="font-size:22px;color:#2a7a00"></i>`}
        </div>
        <div style="padding:4px;background:var(--lime);font-size:8px;font-weight:800;text-align:center;border-top:2px solid var(--black);font-family:'DM Mono',monospace;letter-spacing:.5px">SESUDAH</div>
      </div>
    </div>

    <div class="sec-hdr">Checklist 5R</div>
    <div class="nb-card" style="padding:11px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px">
        <span style="font-size:12px;font-weight:700">Skor Kepatuhan</span>
        <span style="font-size:18px;font-weight:800;font-family:'DM Mono',monospace;color:${r.skor5r>=80?'#2a7a00':r.skor5r>=60?'#7a5000':'var(--red)'}">${r.skor5r}%</span>
      </div>
      <div class="nb-progress-bar" style="margin-bottom:10px"><div class="nb-progress-fill" style="width:${r.skor5r}%;background:${r.skor5r>=80?'var(--lime)':r.skor5r>=60?'var(--yellow)':'var(--red)'}"></div></div>
      ${checkHtml}
    </div>

    ${fdKeys.length || extraF.length ? `
    <div class="sec-hdr" style="color:var(--red)">Temuan (${totalF} total, ${openF} open)</div>
    <div style="margin-bottom:10px">${findHtml}${extraHtml}</div>` : ''}

    ${r.catatan ? `<div class="sec-hdr">Catatan</div><div class="nb-card" style="padding:11px;margin-bottom:10px"><div style="font-size:12px;color:#555">${r.catatan}</div></div>` : ''}

    <div class="sec-hdr">Persetujuan FM / Dept Head</div>
    ${verifHtml}
    <div style="height:14px"></div>`;

  goTo('s-detail');
}

// ════════════════════════════════════════════════════════
// SUPERVISOR DASHBOARD
// ════════════════════════════════════════════════════════
function renderSupervisorDash() {
  if (!currentUser) return;
  const reps = getReports();
  const todayReps = reps.filter(r => r.tanggal === today() && r.status === 'Submitted');
  const antrian   = todayReps.filter(r => !r.verified);

  const g = document.getElementById('sup-greeting');
  if (g) g.textContent = currentUser.displayName.split(' ')[0];
  const av = document.getElementById('sup-avatar');
  if (av) av.textContent = currentUser.initials;

  document.getElementById('sup-selesai').textContent = todayReps.length;
  document.getElementById('sup-antrian').textContent = antrian.length;

  const openF = getAllOpenFindings();
  document.getElementById('sup-open-temuan').textContent = openF.length;

  const nd = document.getElementById('sup-notif-dot');
  const notifs = getNotifs();
  if (nd) nd.style.display = notifs.filter(n=>!n.read).length ? 'block' : 'none';

  const sd = document.getElementById('sup-date-display');
  if (sd) sd.textContent = todayLabel() + ' — Shift ' + currentShift;

  // Chart bars
  const bars = document.getElementById('sup-chart-bars');
  if (bars) {
    if (!todayReps.length) {
      bars.innerHTML = '<div style="text-align:center;font-size:11px;color:#aaa;padding:10px;font-family:\'DM Mono\',monospace">Belum ada data hari ini</div>';
    } else {
      bars.innerHTML = '';
      AREAS.forEach(area => {
        const rep   = todayReps.find(r => r.area === area);
        const skor  = rep ? rep.skor5r : null;
        const pct   = skor != null ? skor : 0;
        const color = pct >= 80 ? 'var(--lime)' : pct >= 60 ? 'var(--yellow)' : pct > 0 ? 'var(--orange)' : '#ddd';
        const label = area.replace('Area ','').replace('Gudang ','Gdg ').replace('Workshop ','WS ').substring(0,12);
        const row = document.createElement('div');
        row.className = 'chart-bar-row';
        row.innerHTML = `<span class="chart-bar-label">${label}</span>
          <div class="chart-bar-bg"><div class="chart-bar-fill" style="width:${pct}%;background:${color}"></div></div>
          <span class="chart-bar-val">${skor != null ? skor+'%' : '—'}</span>`;
        bars.appendChild(row);
      });
    }
  }

  // Antrian
  const ant = document.getElementById('sup-antrian-list');
  if (ant) {
    if (!antrian.length) {
      ant.innerHTML = '<div style="text-align:center;padding:16px;color:#aaa;font-size:11px;font-weight:700;border:var(--border);border-radius:var(--radius);background:var(--white);font-family:\'DM Mono\',monospace">Tidak ada laporan menunggu verifikasi</div>';
    } else {
      ant.innerHTML = '';
      antrian.forEach(r => {
        const totalF = Object.keys(r.findings||{}).length + (r.extraFindings||[]).length;
        const card = document.createElement('div');
        card.className = 'verif-card';
        card.onclick = () => openVerif(r.id);
        card.innerHTML = `
          <div style="background:var(--black);padding:8px 11px;display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:12px;font-weight:800;color:var(--yellow);font-family:'DM Mono',monospace">${r.area}</span>
            ${totalF > 0 ? `<span class="nb-badge" style="background:var(--red);color:#fff;border-color:var(--red);font-size:8px">${totalF} TEMUAN</span>` : `<span class="nb-badge" style="background:var(--lime);font-size:8px">OK</span>`}
          </div>
          <div style="padding:9px 11px;display:flex;justify-content:space-between;align-items:center">
            <div><div style="font-size:12px;font-weight:700">${r.user.displayName}</div><div style="font-size:10px;color:var(--muted);font-family:'DM Mono',monospace">${r.jam_submit} · Skor: ${r.skor5r}%</div></div>
            <button class="nb-btn nb-btn-sm" style="background:var(--black);color:var(--yellow)" onclick="event.stopPropagation();openVerif('${r.id}')">Review <i class="ti ti-arrow-right"></i></button>
          </div>`;
        ant.appendChild(card);
      });
    }
  }

  renderOpenFindings();
  checkOverdue();
}

// ════════════════════════════════════════════════════════
// VERIFIKASI
// ════════════════════════════════════════════════════════
function openVerif(reportId) {
  const reps = getReports();
  const r = reps.find(rep => rep.id === reportId);
  if (!r) return;
  selectedReport = r;

  const isVerified = r.verified;
  const badge = document.getElementById('verif-badge');
  if (badge) { badge.textContent = isVerified ? 'TERVERIF' : 'MENUNGGU'; badge.style.background = isVerified ? 'var(--lime)' : 'var(--blue)'; badge.style.color = isVerified ? 'var(--black)' : '#fff'; badge.style.borderColor = isVerified ? 'var(--lime)' : 'var(--blue)'; }

  const fdKeys = Object.keys(r.findings || {});
  const extraF = r.extraFindings || [];
  const totalF = fdKeys.length + extraF.length;
  const openF  = fdKeys.filter(k => r.findings[k]?.status !== 'Closed').length + extraF.filter(ef => ef.status !== 'Closed').length;

  let checkSum = ITEMS_5R.map(item => {
    const val = r.checklist?.[item.key] || 'na';
    const bg  = val==='ok'?'var(--lime)':val==='no'?'var(--red)':'#d8d4cc';
    const cl  = val==='no'?'#fff':'var(--black)';
    const lbl = val==='ok'?'OK':val==='no'?'NO':'N/A';
    return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
      <span style="font-size:11px;font-weight:700">${item.label}</span>
      <span class="nb-badge" style="background:${bg};color:${cl};border-color:${bg};font-size:8px">${lbl}</span>
    </div>`;
  }).join('');

  let findSum = '';
  if (totalF > 0) {
    findSum = `<div class="sec-hdr" style="color:var(--red);margin-top:10px">Temuan (${totalF}, ${openF} open)</div>`;
    fdKeys.forEach(k => {
      const f = r.findings[k];
      const item = ITEMS_5R.find(i => i.key === k);
      const isClosed = f.status === 'Closed';
      findSum += `<div style="display:flex;align-items:center;gap:7px;padding:6px;border:var(--border);border-radius:var(--radius);background:${isClosed?'#f0fff0':'#fff5f5'};margin-bottom:5px">
        <span class="nb-badge prio-${(f.urgency||'medium').toLowerCase()}" style="font-size:7px">${PRIO_LABELS[f.urgency]||'—'}</span>
        <span style="font-size:11px;font-weight:700;flex:1">${item?.label||k}</span>
        <span class="nb-badge" style="font-size:7px;${isClosed?'background:var(--lime)':'background:#FFE5E5;color:#AA0000;border-color:#AA0000'}">${isClosed?'CLOSED':'OPEN'}</span>
      </div>`;
    });
    extraF.forEach(ef => {
      const isClosed = ef.status === 'Closed';
      findSum += `<div style="display:flex;align-items:center;gap:7px;padding:6px;border:var(--border);border-radius:var(--radius);background:${isClosed?'#f0fff0':'#fff5f5'};margin-bottom:5px">
        <span class="nb-badge prio-${(ef.priority||'medium').toLowerCase()}" style="font-size:7px">${PRIO_LABELS[ef.priority]||'—'}</span>
        <span style="font-size:11px;font-weight:700;flex:1">${ef.label||'Temuan'}</span>
        <span class="nb-badge" style="font-size:7px;${isClosed?'background:var(--lime)':'background:#FFE5E5;color:#AA0000;border-color:#AA0000'}">${isClosed?'CLOSED':'OPEN'}</span>
      </div>`;
    });
  }

  const verifAction = isVerified
    ? `<div class="nb-card" style="padding:11px;border-left:4px solid var(--lime)">
        <span style="font-size:12px;font-weight:700">Status: </span>
        <span class="nb-badge" style="background:${r.verif_action==='approve'?'var(--lime)':'var(--red)'};color:${r.verif_action==='approve'?'var(--black)':'#fff'};border-color:${r.verif_action==='approve'?'var(--lime)':'var(--red)'};">${r.verif_action==='approve'?'DISETUJUI':'DITOLAK'}</span>
        ${r.verif_catatan ? `<div style="margin-top:7px;font-size:12px;color:#555"><b>Catatan:</b> ${r.verif_catatan}</div>` : ''}
      </div>`
    : `<div class="nb-card" style="padding:12px">
        <label class="nb-label">Catatan Verifikasi (opsional)</label>
        <textarea class="nb-textarea" id="verif-catatan" rows="2" placeholder="Temuan, rekomendasi, atau catatan untuk petugas..." style="margin-bottom:10px"></textarea>
        <label class="nb-label">Tanda Tangan Digital</label>
        <div class="sign-pad" id="verif-sign-pad"><canvas id="verif-canvas"></canvas><button class="sign-pad-clear" onclick="clearSign()">HAPUS</button><span style="font-size:11px;color:#aaa;font-family:'DM Mono',monospace;pointer-events:none">Tanda tangan di sini</span></div>
        <div class="grid-2" style="margin-top:10px">
          <button class="nb-btn nb-btn-red nb-btn-full" onclick="doVerif('reject')"><i class="ti ti-x"></i> Tolak</button>
          <button class="nb-btn nb-btn-lime nb-btn-full" onclick="doVerif('approve')"><i class="ti ti-check"></i> Setujui</button>
        </div>
      </div>`;

  document.getElementById('verif-content').innerHTML = `
    <div class="nb-card-dark" style="padding:12px;margin-bottom:10px">
      <div style="color:#888;font-size:9px;font-family:'DM Mono',monospace;text-transform:uppercase;letter-spacing:.5px">${r.area}</div>
      <div style="color:var(--yellow);font-size:15px;font-weight:800;margin:2px 0">${r.user.displayName}</div>
      <div style="color:#aaa;font-size:10px;font-family:'DM Mono',monospace">${r.tanggal} · ${r.jam_submit} · Shift ${r.shift} · Skor 5R: ${r.skor5r}%</div>
    </div>
    <div class="sec-hdr">Hasil Checklist 5R</div>
    <div class="nb-card" style="padding:11px;margin-bottom:10px">${checkSum}</div>
    ${findSum}
    <div class="sec-hdr" style="margin-top:10px">Keputusan FM / Dept Head</div>
    ${verifAction}
    <div style="height:14px"></div>`;

  goTo('s-verif');
  setTimeout(() => initSignPad(), 100);
}

// Sign pad
let signCanvas, signCtx, signing = false, hasSigned = false;
function initSignPad() {
  signCanvas = document.getElementById('verif-canvas');
  if (!signCanvas) return;
  signCtx = signCanvas.getContext('2d');
  signCanvas.width  = signCanvas.offsetWidth;
  signCanvas.height = signCanvas.offsetHeight;
  signCtx.strokeStyle = '#111'; signCtx.lineWidth = 2; signCtx.lineCap = 'round';
  const getPos = e => { const r = signCanvas.getBoundingClientRect(); const t = e.touches?.[0] || e; return { x: t.clientX - r.left, y: t.clientY - r.top }; };
  signCanvas.addEventListener('mousedown',  e => { signing=true; const p=getPos(e); signCtx.beginPath(); signCtx.moveTo(p.x,p.y); });
  signCanvas.addEventListener('mousemove',  e => { if(!signing) return; const p=getPos(e); signCtx.lineTo(p.x,p.y); signCtx.stroke(); hasSigned=true; document.getElementById('verif-sign-pad').classList.add('signed'); });
  signCanvas.addEventListener('mouseup',    () => signing = false);
  signCanvas.addEventListener('touchstart', e => { e.preventDefault(); signing=true; const p=getPos(e); signCtx.beginPath(); signCtx.moveTo(p.x,p.y); }, {passive:false});
  signCanvas.addEventListener('touchmove',  e => { e.preventDefault(); if(!signing) return; const p=getPos(e); signCtx.lineTo(p.x,p.y); signCtx.stroke(); hasSigned=true; document.getElementById('verif-sign-pad').classList.add('signed'); }, {passive:false});
  signCanvas.addEventListener('touchend',   () => signing = false);
}
function clearSign() { if (!signCanvas) return; signCtx.clearRect(0,0,signCanvas.width,signCanvas.height); hasSigned=false; document.getElementById('verif-sign-pad').classList.remove('signed'); }

function doVerif(action) {
  if (!selectedReport) return;
  const catatan = document.getElementById('verif-catatan')?.value || '';
  const ttd = hasSigned ? signCanvas?.toDataURL() : null;
  const reps = getReports().map(r => {
    if (r.id !== selectedReport.id) return r;
    r.verified     = true;
    r.verif_action = action;
    r.verif_catatan = catatan;
    r.verif_ttd    = ttd;
    r.verif_at     = new Date().toISOString();
    return r;
  });
  saveReports(reps);
  // ── Sinkronisasi dokumen yang diverifikasi ke Firestore (satu dokumen saja) ──
  fbSaveReportById(selectedReport.id);
  const notifs = getNotifs();
  notifs.unshift({ id:'n-'+Date.now(), type:'verif_done', title:`Laporan ${action==='approve'?'disetujui':'ditolak'}`, body: selectedReport.area + ' — ' + selectedReport.user.displayName, time: new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})+' WIB', read:false });
  saveNotifs(notifs);
  toast(action==='approve' ? 'Laporan disetujui ✅' : 'Laporan ditolak ❌', action==='approve'?'lime':'red');
  goTo('s-supervisor');
  renderSupervisorDash();
}

// ════════════════════════════════════════════════════════
// NOTIFIKASI
// ════════════════════════════════════════════════════════
function renderNotifs() {
  const cont = document.getElementById('notif-list');
  if (!cont) return;
  const notifs = getNotifs();
  if (!notifs.length) {
    cont.innerHTML = '<div style="text-align:center;padding:28px;color:#aaa;font-size:11px;font-weight:700;font-family:\'DM Mono\',monospace">Tidak ada notifikasi</div>';
    return;
  }
  cont.innerHTML = notifs.map(n => {
    const icon = n.type==='new_report'?'ti-file-plus':n.type==='verif_done'?'ti-shield-check':n.type==='finding_closed'?'ti-check':'ti-bell';
    const dotColor = n.read ? '#ddd' : 'var(--red)';
    return `<div class="notif-item" onclick="markNotifRead('${n.id}')">
      <div class="notif-dot" style="background:${dotColor}"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700">${n.title}</div>
        <div style="font-size:11px;color:#666">${n.body}</div>
        <div style="font-size:9px;color:var(--muted);font-family:'DM Mono',monospace;margin-top:3px">${n.time}</div>
      </div>
      <i class="ti ${icon}" style="font-size:16px;color:var(--muted);flex-shrink:0"></i>
    </div>`;
  }).join('');
}

function markNotifRead(id) {
  const notifs = getNotifs().map(n => n.id===id ? {...n,read:true} : n);
  saveNotifs(notifs);
  renderNotifs();
}

function clearNotifs() {
  saveNotifs(getNotifs().map(n => ({...n, read:true})));
  renderNotifs();
}

// ════════════════════════════════════════════════════════
// PROFIL
// ════════════════════════════════════════════════════════
function renderProfil() {
  if (!currentUser) return;
  const av = document.getElementById('profil-avatar');
  if (av) av.textContent = currentUser.initials;
  const nm = document.getElementById('profil-nama');     if (nm) nm.textContent = currentUser.displayName;
  const jb = document.getElementById('profil-jabatan'); if (jb) jb.textContent = currentUser.jabatan;
  const em = document.getElementById('profil-email');   if (em) em.textContent = currentUser.email;
  const dp = document.getElementById('profil-dept');    if (dp) dp.textContent = currentUser.dept || '—';

  let reps = getReports();
  const now = new Date();
  const mo = new Date(now.getFullYear(),now.getMonth(),1).toISOString().split('T')[0];
  reps = reps.filter(r => r.user?.uid === currentUser.uid && r.tanggal >= mo);
  const submitted = reps.filter(r => r.status === 'Submitted').length;
  const totalSkor = reps.reduce((s,r) => s + (r.skor5r||0), 0);
  const skorCount = reps.filter(r => r.skor5r != null).length;
  const temuanCount = reps.reduce((s,r) => s + Object.keys(r.findings||{}).length + (r.extraFindings||[]).length, 0);

  document.getElementById('profil-total-round').textContent = reps.length;
  document.getElementById('profil-submitted').textContent   = submitted;
  document.getElementById('profil-avg-skor').textContent    = skorCount ? Math.round(totalSkor/skorCount) + '%' : '—';
  document.getElementById('profil-temuan').textContent      = temuanCount;
}

// ════════════════════════════════════════════════════════
// EXPORT PDF
// ════════════════════════════════════════════════════════
function exportPDF() {
  if (!window.jspdf) { toast('Library PDF belum siap', 'red'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFont('helvetica','bold'); doc.setFontSize(13);
  doc.text('LAPORAN MORNING ROUND DIGITAL', 14, 16);
  doc.setFont('helvetica','normal'); doc.setFontSize(8);
  doc.text('PT. RISKI HARIYANTO — Dicetak: ' + new Date().toLocaleString('id-ID'), 14, 22);

  let reps = getReports();
  if (currentUser?.role === 'petugas') reps = reps.filter(r => r.user?.uid === currentUser.uid);
  if (!reps.length) { toast('Tidak ada laporan untuk diekspor', 'red'); return; }

  const data = reps.map(r => {
    const totalF = Object.keys(r.findings||{}).length + (r.extraFindings||[]).length;
    const openF  = Object.values(r.findings||{}).filter(f=>f.status!=='Closed').length + (r.extraFindings||[]).filter(ef=>ef.status!=='Closed').length;
    const cats = [
      ...Object.values(r.findings||{}).map(f=>f.category),
      ...(r.extraFindings||[]).map(ef=>ef.category)
    ].filter(Boolean);
    const catSummary = [...new Set(cats)].join(', ') || '—';
    return [ r.tanggal, r.area, r.user.displayName, r.shift, r.skor5r+'%', r.status, r.verified?'Ya':'Tidak', totalF+' ('+openF+' open)', catSummary ];
  });

  doc.autoTable({
    startY: 28,
    head: [['Tanggal','Area','Petugas','Shift','Skor 5R','Status','Verif FM','Temuan','Kategori']],
    body: data,
    styles: { fontSize: 6 },
    headStyles: { fillColor: [17,17,17], textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0:{cellWidth:20}, 1:{cellWidth:30}, 2:{cellWidth:24}, 3:{cellWidth:11}, 4:{cellWidth:14}, 5:{cellWidth:16}, 6:{cellWidth:12}, 7:{cellWidth:18}, 8:{cellWidth:22} }
  });

  doc.save('MorningRound_' + today() + '.pdf');
  toast('PDF berhasil diunduh 📄', 'lime');
}

function exportSinglePDF() {
  if (!selectedReport) { toast('Pilih laporan terlebih dahulu', 'red'); return; }
  if (!window.jspdf) { toast('Library PDF belum siap', 'red'); return; }
  const { jsPDF } = window.jspdf;
  const r = selectedReport;
  const doc = new jsPDF();
  const PAGE_W = doc.internal.pageSize.getWidth();

  // ── Header teks ──────────────────────────────────────────
  doc.setFont('helvetica','bold'); doc.setFontSize(13);
  doc.text('LAPORAN MORNING ROUND DIGITAL', 14, 16);
  doc.setFont('helvetica','normal'); doc.setFontSize(8);
  doc.text('PT. RISKI HARIYANTO', 14, 22);
  doc.text(`Area: ${r.area} | ${r.tanggal} | Shift: ${r.shift} | Petugas: ${r.user.displayName}`, 14, 28);
  doc.text(`Skor 5R: ${r.skor5r}% | Status: ${r.status} | Persetujuan FM / Dept Head: ${r.verified ? (r.verif_action==='approve'?'DISETUJUI':'DITOLAK') : 'Belum'}`, 14, 34);

  // ── Foto Area (Sebelum & Sesudah) ────────────────────────
  // Foto ditempatkan berdampingan di bawah header, lebar ~85mm masing-masing
  let nextY = 40;
  const fotoW = 85; // mm
  const fotoH = 48; // mm
  const fotoGap = 6;
  const fotoLabelH = 6;
  const hasPhotos = r.foto_before || r.foto_after;

  if (hasPhotos) {
    // Label judul section
    doc.setFont('helvetica','bold'); doc.setFontSize(7);
    doc.setFillColor(17,17,17); doc.setTextColor(255,255,255);
    doc.rect(14, nextY, PAGE_W - 28, 6, 'F');
    doc.text('DOKUMENTASI KONDISI AREA', 16, nextY + 4.2);
    doc.setTextColor(0,0,0); doc.setFont('helvetica','normal');
    nextY += 8;

    // Kotak foto Sebelum
    const xBefore = 14;
    doc.setDrawColor(17,17,17); doc.setLineWidth(0.4);
    doc.rect(xBefore, nextY, fotoW, fotoH + fotoLabelH);
    if (r.foto_before) {
      try { doc.addImage(r.foto_before, 'JPEG', xBefore + 1, nextY + 1, fotoW - 2, fotoH - 2); } catch(e) {}
    } else {
      doc.setFontSize(7); doc.setTextColor(180,180,180);
      doc.text('(Tidak Ada Foto)', xBefore + fotoW/2, nextY + fotoH/2, { align:'center' });
      doc.setTextColor(0,0,0);
    }
    // Label bawah Sebelum
    doc.setFillColor(240,240,240);
    doc.rect(xBefore, nextY + fotoH, fotoW, fotoLabelH, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(17,17,17);
    doc.text('SEBELUM', xBefore + fotoW/2, nextY + fotoH + 4, { align:'center' });

    // Kotak foto Sesudah
    const xAfter = 14 + fotoW + fotoGap;
    doc.setFont('helvetica','normal'); doc.setDrawColor(17,17,17);
    doc.rect(xAfter, nextY, fotoW, fotoH + fotoLabelH);
    if (r.foto_after) {
      try { doc.addImage(r.foto_after, 'JPEG', xAfter + 1, nextY + 1, fotoW - 2, fotoH - 2); } catch(e) {}
    } else {
      doc.setFontSize(7); doc.setTextColor(180,180,180);
      doc.text('(Tidak Ada Foto)', xAfter + fotoW/2, nextY + fotoH/2, { align:'center' });
      doc.setTextColor(0,0,0);
    }
    // Label bawah Sesudah
    doc.setFillColor(180,230,150);
    doc.rect(xAfter, nextY + fotoH, fotoW, fotoLabelH, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(17,17,17);
    doc.text('SESUDAH', xAfter + fotoW/2, nextY + fotoH + 4, { align:'center' });

    nextY += fotoH + fotoLabelH + 6;
  }

  // ── Tabel Checklist 5R ───────────────────────────────────
  const checkData = ITEMS_5R.map(i => [i.label, r.checklist?.[i.key]==='ok'?'OK':r.checklist?.[i.key]==='no'?'TIDAK':'N/A']);
  doc.autoTable({
    startY: nextY,
    head: [['Item 5R','Hasil']],
    body: checkData,
    styles: { fontSize: 7.5 },
    headStyles: { fillColor:[17,17,17], textColor:255, fontStyle:'bold' },
    columnStyles: { 0:{ cellWidth:120 }, 1:{ cellWidth:30, halign:'center' } }
  });

  // ── Tabel Temuan (dengan kolom Foto) ─────────────────────
  // Kolom index: 0=Item, 1=DEPT, 2=Kategori, 3=Prioritas, 4=Status, 5=Deskripsi, 6=Foto Temuan, 7=Foto Perbaikan
  const FOTO_COL_TEMUAN   = 6;
  const FOTO_COL_PERBAIKAN = 7;
  const FOTO_SIZE = 15; // mm — ukuran foto di dalam sel

  const allF = [
    ...Object.keys(r.findings||{}).map(k => {
      const f    = r.findings[k];
      const item = ITEMS_5R.find(i => i.key === k);
      return [
        item?.label || k,
        f.dept        || '—',
        f.category    || '—',
        PRIO_LABELS[f.urgency] || f.urgency || '—',
        f.status      || '—',
        f.description || '—',
        f.photo        || '',   // Foto Temuan (base64)
        f.closingPhoto || ''    // Foto Perbaikan (base64)
      ];
    }),
    ...(r.extraFindings||[]).map(ef => [
      ef.label       || 'Temuan',
      ef.dept        || '—',
      ef.category    || '—',
      PRIO_LABELS[ef.priority] || ef.priority || '—',
      ef.status      || '—',
      ef.description || '—',
      ef.photo        || '',
      ef.closingPhoto || ''
    ])
  ];

  if (allF.length) {
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 8,
      head: [['Item','DEPT','Kategori','Prioritas','Status','Deskripsi','Foto Temuan','Foto Perbaikan']],
      body: allF,
      styles: { fontSize: 6, minCellHeight: 20, valign: 'middle' },
      headStyles: { fillColor:[17,17,17], textColor:255, fontStyle:'bold' },
      columnStyles: {
        0: { cellWidth: 28 },
        1: { cellWidth: 20 },
        2: { cellWidth: 18 },
        3: { cellWidth: 16 },
        4: { cellWidth: 16 },
        5: { cellWidth: 40 },
        6: { cellWidth: 20, halign:'center' },
        7: { cellWidth: 20, halign:'center' }
      },
      // Sembunyikan teks pada kolom foto (gambar akan di-render via hook)
      didParseCell: function(data) {
        if (data.section === 'body' &&
           (data.column.index === FOTO_COL_TEMUAN || data.column.index === FOTO_COL_PERBAIKAN)) {
          data.cell.text = []; // kosongkan teks agar base64 tidak muncul sebagai tulisan
        }
      },
      // Render gambar ke dalam sel foto
      didDrawCell: function(data) {
        if (data.section !== 'body') return;
        if (data.column.index !== FOTO_COL_TEMUAN && data.column.index !== FOTO_COL_PERBAIKAN) return;
        const imgData = data.cell.raw;
        if (!imgData || typeof imgData !== 'string' || imgData.length < 10) return;
        try {
          const cellX = data.cell.x;
          const cellY = data.cell.y;
          const cellW = data.cell.width;
          const cellH = data.cell.height;
          // Posisikan foto di tengah sel
          const imgX = cellX + (cellW - FOTO_SIZE) / 2;
          const imgY = cellY + (cellH - FOTO_SIZE) / 2;
          doc.addImage(imgData, 'JPEG', imgX, imgY, FOTO_SIZE, FOTO_SIZE);
        } catch(e) {
          // Jika gambar gagal dirender, tampilkan placeholder teks
          doc.setFontSize(5); doc.setTextColor(150,150,150);
          doc.text('Gagal muat', data.cell.x + 2, data.cell.y + data.cell.height / 2);
          doc.setTextColor(0,0,0);
        }
      }
    });
  }

  doc.save(`MR_${r.area.replace(/ /g,'_')}_${r.tanggal}.pdf`);
  toast('PDF berhasil diunduh 📄', 'lime');
}

// ════════════════════════════════════════════════════════
// MODAL HELPERS
// ════════════════════════════════════════════════════════
function openModal(html) { document.getElementById('modal-content').innerHTML = html; document.getElementById('modal-overlay').classList.add('open'); }
function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }
function closeModalOutside(e) { if (e.target === document.getElementById('modal-overlay')) closeModal(); }

// ════════════════════════════════════════════════════════
// TOAST
// ════════════════════════════════════════════════════════
function toast(msg, type) {
  const zone = document.getElementById('toast-zone');
  const t    = document.createElement('div');
  const bg   = type==='lime'?'var(--lime)':type==='yellow'?'var(--yellow)':type==='red'?'var(--red)':type==='blue'?'var(--blue)':'var(--white)';
  const cl   = (type==='red'||type==='blue') ? '#fff' : 'var(--black)';
  t.className = 'toast-item';
  t.style.cssText = `background:${bg};color:${cl};pointer-events:auto;`;
  t.innerHTML = `<span>${msg}</span><button onclick="this.closest('.toast-item').remove()" style="background:none;border:none;font-size:15px;cursor:pointer;font-weight:900;flex-shrink:0;color:inherit;">×</button>`;
  zone.appendChild(t);
  setTimeout(() => { t.style.transition='opacity .3s'; t.style.opacity='0'; setTimeout(()=>t.remove(),300); }, 3000);
}

// ════════════════════════════════════════════════════════
// FORM INIT
// ════════════════════════════════════════════════════════
function initForm() {
  if (!currentUser) return;
  const fn = document.getElementById('form-nama');    if (fn) fn.textContent = currentUser.displayName;
  const fa = document.getElementById('form-avatar');  if (fa) fa.textContent = currentUser.initials;
  const fd = document.getElementById('form-date-display'); if (fd) fd.textContent = todayLabel() + ' — Shift PAGI';

  cl5R = {}; findingsData = {}; extraFindings = []; photoData = { before: null, after: null };
  extraFindingIdCounter = 0;
  build5R();
  renderExtraFindings();
  resetPhotoBox('pb-before');
  resetPhotoBox('pb-after');
  currentShift = 'PAGI';
  ['shift-pagi','shift-siang','shift-malam'].forEach(id => { const el=document.getElementById(id); if(el) el.classList.remove('sel-ok'); });
  const sp = document.getElementById('shift-pagi'); if (sp) sp.classList.add('sel-ok');
  const sb = document.getElementById('form-shift-badge'); if (sb) sb.textContent = 'PAGI';
  const errEl = document.getElementById('form-error'); if (errEl) errEl.style.display = 'none';

  // Populate area select
  const sel = document.getElementById('form-area');
  if (sel) {
    sel.innerHTML = '<option value="">— Pilih Area —</option>';
    AREAS.forEach(a => { const opt = document.createElement('option'); opt.value = a; opt.textContent = a; sel.appendChild(opt); });
  }
}

// ════════════════════════════════════════════════════════
// BOOT
// ════════════════════════════════════════════════════════
(function init() {
  ALL_SCREENS.forEach(s => {
    const el = document.getElementById(s);
    if (el) { el.style.display = 'none'; el.classList.remove('active'); }
  });

  try {
    const saved = localStorage.getItem('mr_v2_user');
    if (saved) { currentUser = JSON.parse(saved); enterApp(); }
    else goTo('s-login');
  } catch (e) {
    localStorage.removeItem('mr_v2_user'); goTo('s-login');
  }

  updateClock();
  setInterval(updateClock, 30000);

  // Aktifkan Firebase realtime listeners
  initFirebaseListeners();
})();
