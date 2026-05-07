// ════════════════════════════════════════════════════════
// firebase-handler.js
// MORNING ROUND DIGITAL — PT. RISKI HARIYANTO
// Fokus: Firebase Firestore + LocalStorage hybrid backend
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
const _db     = () => window.db;
const _col    = () => window.firebaseCollection;
const _setDoc = () => window.firebaseSetDoc;
const _doc    = () => window.firebaseDoc;
const _snap   = () => window.firebaseOnSnapshot;

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
  localStorage.setItem('mr_v2_reports', JSON.stringify(arr));
}

function getNotifs() {
  try { return JSON.parse(localStorage.getItem('mr_v2_notifs') || '[]'); } catch { return []; }
}
function saveNotifs(notifsArray) {
  localStorage.setItem('mr_v2_notifs', JSON.stringify(notifsArray));
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
    console.warn('[Firebase] Belum siap, laporan tersimpan lokal saja:', report.id);
    return;
  }
  try {
    const clean = JSON.parse(JSON.stringify(report));
    await _setDoc()(_doc()(_db(), 'reports', clean.id), clean);
    _fbSyncError = false;
    console.log('[Firebase] Laporan tersimpan:', clean.id);
  } catch (e) {
    console.error('[Firebase] Gagal menyimpan laporan:', e);
    if (!_fbSyncError) {
      _fbSyncError = true;
      window.toast('⚠ Sync Firebase gagal — data tersimpan lokal', 'yellow');
    }
  }
}

/**
 * Ambil laporan dari cache lokal berdasarkan ID lalu push ke Firestore.
 * Dipakai oleh submitCloseFinding & doVerif.
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
// ════════════════════════════════════════════════════════
function saveReports(reportsArray) {
  _cacheReports(reportsArray);
}

// ════════════════════════════════════════════════════════
// REALTIME LISTENER — Firestore → localStorage cache → UI
// ════════════════════════════════════════════════════════
function initFirebaseListeners(attempt) {
  attempt = attempt || 1;

  if (!_fbReady()) {
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
      _cacheReports(fbReports);
      _fbSyncError = false;

      // Re-render screen yang sedang aktif
      const activeScreen = window.ALL_SCREENS.find(s => {
        const el = document.getElementById(s);
        return el && el.classList.contains('active');
      });
      if (activeScreen === 's-dashboard')     window.renderDashboard();
      if (activeScreen === 's-history')       window.renderHistory();
      if (activeScreen === 's-dept-head')     window.renderDeptHeadDash();
      if (activeScreen === 's-open-findings') window.renderOpenFindings();

    } catch (e) {
      console.error('[Firebase] Error memproses snapshot reports:', e);
    }
  }, (err) => {
    console.error('[Firebase] Listener reports error:', err);
    window.toast('⚠ Koneksi Firebase terputus — mode offline aktif', 'yellow');
  });

  // ── Listener: collection "notifs" ───────────────────────────────────
  _snap()(_col()(_db(), 'notifs'), (snapshot) => {
    try {
      const fbNotifs = [];
      snapshot.forEach(docSnap => fbNotifs.push(docSnap.data()));
      fbNotifs.sort((a, b) => (b.id || '').localeCompare(a.id || ''));
      localStorage.setItem('mr_v2_notifs', JSON.stringify(fbNotifs));

      const unread = fbNotifs.filter(n => !n.read).length;
      ['dash-notif-dot', 'sup-notif-dot'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = unread ? 'block' : 'none';
      });

      const activeScreen = window.ALL_SCREENS.find(s => {
        const el = document.getElementById(s);
        return el && el.classList.contains('active');
      });
      if (activeScreen === 's-notif') window.renderNotifs();

    } catch (e) {
      console.error('[Firebase] Error memproses snapshot notifs:', e);
    }
  }, (err) => {
    console.error('[Firebase] Listener notifs error:', err);
  });

  console.log('[Firebase] Realtime listeners aktif ✅');
}

// ════════════════════════════════════════════════════════
// DATE & DUE DATE UTILITIES
// ════════════════════════════════════════════════════════
function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function todayLabel() {
  return new Date().toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' });
}

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
  if (days < 0)   return `⚠ Overdue ${Math.abs(days)}h`;
  if (days === 0) return '⚡ Hari Ini!';
  if (days === 1) return '⏰ Besok';
  return `${fmtDate(str)} (${days}h lagi)`;
}

// ── Expose ke window agar bisa dipanggil dari file lain ──────────────
window.getReports          = getReports;
window.saveReports         = saveReports;
window.getNotifs           = getNotifs;
window.saveNotifs          = saveNotifs;
window.fbSaveReport        = fbSaveReport;
window.fbSaveReportById    = fbSaveReportById;
window.fbSaveNotif         = fbSaveNotif;
window.initFirebaseListeners = initFirebaseListeners;
window.today               = today;
window.todayLabel          = todayLabel;
window.fmtDate             = fmtDate;
window.getDueDaysLeft      = getDueDaysLeft;
window.dueDateClass        = dueDateClass;
window.dueDateLabel        = dueDateLabel;
