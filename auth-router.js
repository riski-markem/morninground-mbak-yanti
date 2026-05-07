// ════════════════════════════════════════════════════════
// auth-router.js
// MORNING ROUND DIGITAL — PT. RISKI HARIYANTO
// Fokus: Konstanta global, state, autentikasi & navigasi
// ════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════
const ALL_SCREENS = [
  's-login','s-dashboard','s-form','s-success',
  's-history','s-detail','s-dept-head','s-verif',
  's-notif','s-profil','s-open-findings','s-close-finding',
  's-manager'
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
  { key:'rawat',   label:'Rawat (Seiketsu)',  desc:'Peralatan terawat & standar terjaga' },
  { key:'rajin',   label:'Rajin (Shitsuke)',  desc:'Standar dijalankan secara konsisten' }
];

const CATEGORIES  = ['Delivery','Quality','Safety','Efisiensi','Moral'];
const DEPARTMENTS = ['IRGA','Produksi','Teknik / Maintenance','QC / QA','HSE','Gudang','Lainnya'];
const PRIO_LABELS = { High:'Tinggi', Medium:'Sedang', Low:'Rendah' };
const PRIO_DAYS   = { High: 1, Medium: 3, Low: 7 };

const USERS = {
  petugas: {
    uid:'u1', displayName:'Riski Hariyanto', role:'petugas',
    email:'riski.hariyanto@riski-hariyanto.id', jabatan:'Petugas Produksi',
    initials:'RH', dept:'Produksi'
  },
  dept_head: {
    uid:'u2', displayName:'Yanti Puspita', role:'dept_head',
    email:'yanti.puspita@riski-hariyanto.id', jabatan:'Dept Head',
    initials:'YP', dept:'Produksi'
  },
  factory_manager: {
    uid:'u3', displayName:'Bapak Direktur', role:'factory_manager',
    email:'direktur@riski-hariyanto.id', jabatan:'Factory Manager',
    initials:'BD', dept:'Manajemen'
  }
};

// ════════════════════════════════════════════════════════
// MUTABLE STATE (diakses oleh app.js via window.)
// ════════════════════════════════════════════════════════
let currentUser   = null;
let cl5R          = {};
let findingsData  = {};
let extraFindings = [];
let photoData     = { before: null, after: null };
let currentShift  = 'PAGI';
let selectedReport = null;
let histFilter    = 'today';
let findingsFilter = 'all';

// Close Finding State
let cfReportId   = null;
let cfFindingKey = null;
let cfIsExtra    = false;
let cfPhotoData  = null;

let extraFindingIdCounter = 0;

// ════════════════════════════════════════════════════════
// SCREEN NAVIGATION — dengan Interceptor Role yang Cerdas
// ════════════════════════════════════════════════════════
function goTo(id) {
  // ═══════════════════════════════════════════════════════
  // INTERCEPTOR: Redirect berdasarkan role pengguna
  // Semua navigasi ke 's-dashboard' akan diarahkan ke screen
  // yang sesuai dengan role pengguna saat ini
  // ═══════════════════════════════════════════════════════
  if (id === 's-dashboard' && currentUser) {
    if (currentUser.role === 'factory_manager') {
      id = 's-manager';
      console.log('[Interceptor] Dashboard → s-manager (Factory Manager)');
    } else if (currentUser.role === 'dept_head') {
      id = 's-dept-head';
      console.log('[Interceptor] Dashboard → s-dept-head (Dept Head)');
    }
    // Role 'petugas' tetap ke s-dashboard (default)
  }

  // ═══════════════════════════════════════════════════════
  // Sembunyikan semua screen & hapus kelas active
  // ═══════════════════════════════════════════════════════
  ALL_SCREENS.forEach(s => {
    const el = document.getElementById(s);
    if (el) { 
      el.style.display = 'none'; 
      el.classList.remove('active'); 
    }
  });

  // ═══════════════════════════════════════════════════════
  // Tampilkan screen yang dituju & tambah kelas active
  // ═══════════════════════════════════════════════════════
  const t = document.getElementById(id);
  if (t) {
    t.style.display = 'flex';
    t.classList.add('active');
    
    // Scroll ke atas
    const sb = t.querySelector('.screen-body');
    if (sb) sb.scrollTop = 0;
  } else {
    console.error('[goTo] Screen tidak ditemukan:', id);
  }

  // ═══════════════════════════════════════════════════════
  // FAB (tombol +) — hanya tampil untuk petugas
  // ═══════════════════════════════════════════════════════
  const fab = document.querySelector('.nb-fab');
  if (fab) {
    fab.style.display = (currentUser && currentUser.role === 'petugas') ? 'flex' : 'none';
  }

  // ═══════════════════════════════════════════════════════
  // ROLE-AWARE NAVBAR — render ulang semua navbar sesuai role
  // ═══════════════════════════════════════════════════════
  renderRoleNav(id);

  // ═══════════════════════════════════════════════════════
  // SIDE-EFFECTS: Panggil render function untuk tiap screen
  // Ini memastikan data langsung muncul saat screen dibuka
  // ═══════════════════════════════════════════════════════
  if (id === 's-form')          window.initForm && window.initForm();
  if (id === 's-history')       window.renderHistory && window.renderHistory();
  if (id === 's-notif')         window.renderNotifs && window.renderNotifs();
  if (id === 's-dept-head')     window.renderDeptHeadDash && window.renderDeptHeadDash();
  if (id === 's-dashboard')     window.renderDashboard && window.renderDashboard();
  if (id === 's-open-findings') window.renderOpenFindings && window.renderOpenFindings();
  if (id === 's-profil')        window.renderProfil && window.renderProfil();
  
  // ★★★ PENTING: Panggil renderManagerDash untuk Factory Manager ★★★
  if (id === 's-manager')       window.renderManagerDash && window.renderManagerDash();
}

function navTo(id, btn) {
  // navTo dipanggil dari navbar — langsung gunakan goTo yang sudah punya interceptor
  goTo(id);
  
  // Update tombol navbar yang aktif
  if (btn) {
    const parent = btn.closest('.nb-nav');
    if (parent) {
      parent.querySelectorAll('.nb-nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
  }
}

// ════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════
function quickLogin(role) {
  currentUser = USERS[role];
  localStorage.setItem('mr_v2_user', JSON.stringify(currentUser));
  enterApp();
  window.toast && window.toast('Selamat datang, ' + currentUser.displayName.split(' ')[0] + '! 👋', 'lime');
}

function doLogin() {
  const nama = document.getElementById('l-nama')?.value.trim() || '';
  const pin  = document.getElementById('l-pin')?.value.trim()  || '';

  if (!nama) { window.toast && window.toast('Nama lengkap wajib diisi!', 'red'); return; }
  if (!pin)  { window.toast && window.toast('PIN akses wajib diisi!', 'red'); return; }

  if (pin === '1111') {
    currentUser = { ...USERS.petugas, displayName: nama };
  } else if (pin === '5555') {
    currentUser = { ...USERS.dept_head, displayName: nama };
  } else if (pin === '9999') {
    currentUser = { ...USERS.factory_manager, displayName: nama };
  } else {
    window.toast && window.toast('PIN salah! Gunakan 1111 / 5555 / 9999', 'red');
    return;
  }

  // Perbarui initials dari nama yang diinput
  const parts = nama.trim().split(' ');
  currentUser.initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : nama.substring(0, 2).toUpperCase();

  localStorage.setItem('mr_v2_user', JSON.stringify(currentUser));
  enterApp();
  window.toast && window.toast('Selamat datang, ' + nama.split(' ')[0] + '! 👋', 'lime');
}

function enterApp() {
  // ═══════════════════════════════════════════════════════
  // Arahkan ke screen yang sesuai dengan role
  // Menggunakan goTo() yang sudah punya interceptor
  // ═══════════════════════════════════════════════════════
  if (currentUser.role === 'dept_head') {
    goTo('s-dept-head');
  } else if (currentUser.role === 'factory_manager') {
    goTo('s-manager');
  } else {
    goTo('s-dashboard');
  }
}

function logout() {
  currentUser = null;
  cl5R = {}; 
  findingsData = {}; 
  photoData = { before: null, after: null }; 
  extraFindings = [];
  localStorage.removeItem('mr_v2_user');

  // Bersihkan semua navbar sebelum ke login
  document.querySelectorAll('.nb-nav').forEach(nav => { nav.innerHTML = ''; });
  const fab = document.querySelector('.nb-fab');
  if (fab) fab.style.display = 'none';

  goTo('s-login');
}

// ═══════════════════════════════════════════════════════════════════
// EXPOSE SEMUA KE WINDOW — Agar bisa diakses dari file lain & onclick
// ═══════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════
// ROLE-AWARE NAVBAR RENDERER
// Dipanggil setiap kali goTo() berpindah screen.
// Menggantikan pendekatan "sembunyikan tombol setelah render"
// yang tidak reliable karena DOM belum tentu stabil.
// ════════════════════════════════════════════════════════
function renderRoleNav(activeScreenId) {
  if (!currentUser) return;

  const role = currentUser.role;

  // ── Definisi navbar per role ──────────────────────────
  // activeKey: nilai yang dicocokkan dengan screenId untuk menentukan tombol aktif
  const NAV_CONFIG = {
    petugas: [
      { label:'Dashboard', icon:'ti-home',        screen:'s-dashboard'     },
      { label:'Temuan',    icon:'ti-alert-circle', screen:'s-open-findings' },
      { label:'Input',     icon:'ti-circle-plus',  screen:'s-form',  extraStyle:'font-size:22px', isAction: true },
      { label:'Riwayat',  icon:'ti-clock-hour-4', screen:'s-history'       },
      { label:'Profil',   icon:'ti-user',          screen:'s-profil'        },
    ],
    dept_head: [
      { label:'Dashboard', icon:'ti-layout-dashboard', screen:'s-dept-head'     },
      { label:'Temuan',    icon:'ti-alert-circle',      screen:'s-open-findings' },
      { label:'Riwayat',  icon:'ti-clock-hour-4',      screen:'s-history'       },
      { label:'Profil',   icon:'ti-user',               screen:'s-profil'        },
    ],
    factory_manager: [
      { label:'Analitik', icon:'ti-chart-bar',    screen:'s-manager'       },
      { label:'Temuan',   icon:'ti-alert-circle', screen:'s-open-findings' },
      { label:'Riwayat', icon:'ti-clock-hour-4', screen:'s-history'       },
      { label:'Profil',  icon:'ti-user',          screen:'s-profil'        },
    ],
  };

  const items = NAV_CONFIG[role] || NAV_CONFIG.petugas;

  // ── Tentukan screen "home" untuk tombol Dashboard ─────
  // Tombol Dashboard selalu mengarah ke home screen role tsb
  const HOME_SCREEN = {
    petugas:          's-dashboard',
    dept_head:        's-dept-head',
    factory_manager:  's-manager',
  };

  // ── Build HTML tombol ─────────────────────────────────
  const btnHtml = items.map(item => {
    const isActive = activeScreenId === item.screen;
    const activeClass = isActive ? ' active' : '';
    const iconStyle   = item.extraStyle ? ` style="${item.extraStyle}"` : '';
    const onclick     = item.isAction
      ? `onclick="window.goTo('${item.screen}')"`
      : `onclick="window.navTo('${item.screen}', this)"`;

    return `<button class="nb-nav-btn${activeClass}" ${onclick}>
      <i class="ti ${item.icon}"${iconStyle}></i>${item.label}
    </button>`;
  }).join('');

  // ── Inject ke SEMUA .nb-nav di dalam screen aktif ─────
  // Kita target semua screen sekaligus agar saat user
  // scroll back tidak melihat navbar lama
  ALL_SCREENS.forEach(sid => {
    const screen = document.getElementById(sid);
    if (!screen) return;
    const navEls = screen.querySelectorAll('.nb-nav');
    navEls.forEach(nav => {
      nav.innerHTML = btnHtml;
    });
  });
}

window.renderRoleNav = renderRoleNav;
window.AREAS        = AREAS;
window.ITEMS_5R     = ITEMS_5R;
window.CATEGORIES   = CATEGORIES;
window.DEPARTMENTS  = DEPARTMENTS;
window.PRIO_LABELS  = PRIO_LABELS;
window.PRIO_DAYS    = PRIO_DAYS;
window.USERS        = USERS;

// State — getter/setter via window agar file lain bisa baca/tulis
Object.defineProperties(window, {
  currentUser:            { get: () => currentUser,            set: v => { currentUser = v; },            configurable: true },
  cl5R:                   { get: () => cl5R,                   set: v => { cl5R = v; },                   configurable: true },
  findingsData:           { get: () => findingsData,           set: v => { findingsData = v; },           configurable: true },
  extraFindings:          { get: () => extraFindings,          set: v => { extraFindings = v; },          configurable: true },
  photoData:              { get: () => photoData,              set: v => { photoData = v; },              configurable: true },
  currentShift:           { get: () => currentShift,           set: v => { currentShift = v; },           configurable: true },
  selectedReport:         { get: () => selectedReport,         set: v => { selectedReport = v; },         configurable: true },
  histFilter:             { get: () => histFilter,             set: v => { histFilter = v; },             configurable: true },
  findingsFilter:         { get: () => findingsFilter,         set: v => { findingsFilter = v; },         configurable: true },
  cfReportId:             { get: () => cfReportId,             set: v => { cfReportId = v; },             configurable: true },
  cfFindingKey:           { get: () => cfFindingKey,           set: v => { cfFindingKey = v; },           configurable: true },
  cfIsExtra:              { get: () => cfIsExtra,              set: v => { cfIsExtra = v; },              configurable: true },
  cfPhotoData:            { get: () => cfPhotoData,            set: v => { cfPhotoData = v; },            configurable: true },
  extraFindingIdCounter:  { get: () => extraFindingIdCounter,  set: v => { extraFindingIdCounter = v; },  configurable: true },
});

window.goTo       = goTo;
window.navTo      = navTo;
window.quickLogin = quickLogin;
window.doLogin    = doLogin;
window.enterApp   = enterApp;
window.logout     = logout;
