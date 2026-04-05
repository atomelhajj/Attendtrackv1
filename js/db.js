// ── AttendTrack DB ──
// IndexedDB-backed persistent storage with localStorage fallback

const DB_KEY = 'attendtrack_data';
const DB_VERSION = 2; // Increment this to force a clean reset on all devices

const DEFAULT_DATA = {
  employees: [
    // Only the admin account is pre-loaded.
    // Add real employees via Admin > Employees > Import/Sync, or manually.
    // IMPORTANT: Change the admin PIN from 9999 after first login.
    { id:'ADM-001', name:'Admin', dept:'Management', site:'All sites', role:'admin', pin:'9999', initials:'AD' },
  ],
  records: [],
  overrides: [],
  sites: [
    // Update these with your real site names.
    { id:'site-1', name:'Site 1', radius:80, auto:true, coords:{lat:25.2854,lng:51.5310} },
    { id:'site-2', name:'Site 2', radius:80, auto:true, coords:{lat:25.2948,lng:51.5190} },
  ],
  nextId: 100
};

let _db = null;

function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      _db = JSON.parse(raw);
      // Force reset if this is old demo data (version check)
      const isDemoData = _db.employees && _db.employees.some(e =>
        ['Ahmed Khalil','Sara Mohammed','Omar Farouq','Laila Hassan',
         'Rania Nabil','Khalid Ibrahim','Fatima Al-Zahra','Yusuf Hassan',
         'Nour Al-Rashid','Tariq Mansour'].includes(e.name)
      );
      if (isDemoData || _db.dbVersion !== DB_VERSION) {
        // Wipe demo data but preserve real attendance records if any
        const realRecords = (_db.records || []).filter(r =>
          !['Ahmed Khalil','Sara Mohammed','Omar Farouq','Laila Hassan',
            'Rania Nabil','Khalid Ibrahim','Fatima Al-Zahra','Yusuf Hassan',
            'Nour Al-Rashid','Tariq Mansour'].some(n => r.empName === n)
        );
        _db = JSON.parse(JSON.stringify(DEFAULT_DATA));
        _db.dbVersion = DB_VERSION;
        _db.records = realRecords;
        saveDB();
        return _db;
      }
      // Migrate: ensure all fields exist
      if (!_db.sites) _db.sites = DEFAULT_DATA.sites;
      if (!_db.nextId) _db.nextId = 100;
      _db.dbVersion = DB_VERSION;
    } else {
      _db = JSON.parse(JSON.stringify(DEFAULT_DATA));
      _db.dbVersion = DB_VERSION;
      saveDB();
    }
  } catch(e) {
    _db = JSON.parse(JSON.stringify(DEFAULT_DATA));
    _db.dbVersion = DB_VERSION;
  }
  return _db;
}

function saveDB() {
  try { localStorage.setItem(DB_KEY, JSON.stringify(_db)); } catch(e) {}
}

function getDB() { return _db || loadDB(); }

// ── Employee helpers ──
function getEmployee(id) { return getDB().employees.find(e => e.id === id); }
function getEmployeeByPin(pin) { return getDB().employees.find(e => e.pin === pin); }
function getAllStaff() { return getDB().employees.filter(e => e.role === 'staff'); }
function getSiteStaff(site) { return getDB().employees.filter(e => e.site === site && e.role === 'staff'); }
function getSupervisors() { return getDB().employees.filter(e => e.role === 'supervisor'); }

function addEmployee(data) {
  const db = getDB();
  db.nextId++;
  const prefix = data.role === 'supervisor' ? 'SUP' : data.role === 'admin' ? 'ADM' : 'EMP';
  const id = prefix + '-' + String(db.nextId).padStart(3, '0');
  const initials = data.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const emp = { ...data, id, initials, pin: data.pin || '1234' };
  db.employees.push(emp);
  saveDB();
  return emp;
}

function removeEmployee(id) {
  const db = getDB();
  db.employees = db.employees.filter(e => e.id !== id);
  saveDB();
}

function updateEmployeePin(id, newPin) {
  const emp = getEmployee(id);
  if (emp) { emp.pin = newPin; saveDB(); }
}

// ── Record helpers ──
function getActiveRecord(empId) {
  return getDB().records.find(r => r.empId === empId && !r.clockOut);
}

function getTodayRecords(empId) {
  const today = new Date().toDateString();
  return getDB().records.filter(r => r.empId === empId && new Date(r.clockIn).toDateString() === today);
}

function getAllTodayRecords(site) {
  const today = new Date().toDateString();
  const recs = getDB().records.filter(r => new Date(r.clockIn).toDateString() === today);
  return site ? recs.filter(r => r.site === site) : recs;
}

function getActiveOnSite(site) {
  const today = new Date().toDateString();
  return getDB().records.filter(r => r.site === site && !r.clockOut && new Date(r.clockIn).toDateString() === today);
}

function getPendingManual(site) {
  return getDB().records.filter(r => r.manual && !r.approved && (!site || r.site === site));
}

function clockIn(empId, note = '', manual = false) {
  const db = getDB();
  const emp = getEmployee(empId);
  if (!emp) return null;
  // close any open record first
  const open = getActiveRecord(empId);
  if (open) return null;
  const rec = {
    id: 'R' + Date.now(),
    empId,
    empName: emp.name,
    site: emp.site,
    dept: emp.dept,
    clockIn: new Date().toISOString(),
    clockOut: null,
    note,
    noteOut: '',
    manual,
    approved: !manual,
    absent: false,
    overrideBy: null
  };
  db.records.push(rec);
  saveDB();
  return rec;
}

function clockInAt(empId, timeStr, note = '', manual = true, overrideBy = null) {
  const db = getDB();
  const emp = getEmployee(empId);
  if (!emp) return null;
  const existing = getActiveRecord(empId);
  if (existing) return null;
  const d = new Date();
  const [h, m] = timeStr.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  const rec = {
    id: 'R' + Date.now(),
    empId,
    empName: emp.name,
    site: emp.site,
    dept: emp.dept,
    clockIn: d.toISOString(),
    clockOut: null,
    note,
    noteOut: '',
    manual: true,
    approved: false,
    absent: false,
    overrideBy
  };
  db.records.push(rec);
  saveDB();
  return rec;
}

function clockOut(empId, note = '') {
  const rec = getActiveRecord(empId);
  if (!rec) return null;
  rec.clockOut = new Date().toISOString();
  rec.noteOut = note;
  saveDB();
  return rec;
}

function approveRecord(recId) {
  const rec = getDB().records.find(r => r.id === recId);
  if (rec) { rec.approved = true; saveDB(); }
}

function rejectRecord(recId) {
  const db = getDB();
  db.records = db.records.filter(r => r.id !== recId);
  saveDB();
}

function markAbsent(empId, by) {
  const db = getDB();
  const emp = getEmployee(empId);
  if (!emp) return;
  const now = new Date();
  db.records.push({
    id: 'R' + Date.now(),
    empId,
    empName: emp.name,
    site: emp.site,
    dept: emp.dept,
    clockIn: now.toISOString(),
    clockOut: now.toISOString(),
    note: 'Marked absent by ' + (by || 'supervisor'),
    manual: true,
    approved: true,
    absent: true,
    overrideBy: by
  });
  saveDB();
}

function editRecord(recId, updates) {
  const rec = getDB().records.find(r => r.id === recId);
  if (rec) { Object.assign(rec, updates); saveDB(); }
}

function deleteRecord(recId) {
  const db = getDB();
  db.records = db.records.filter(r => r.id !== recId);
  saveDB();
}

// ── Reporting helpers ──
function getMonthRecords(empId, year, month) {
  return getDB().records.filter(r => {
    const d = new Date(r.clockIn);
    return r.empId === empId && d.getFullYear() === year && d.getMonth() === month;
  });
}

function calcHours(rec) {
  if (!rec.clockOut || rec.absent) return 0;
  return Math.floor((new Date(rec.clockOut) - new Date(rec.clockIn)) / 60000);
}

function getTotalMinutes(records) {
  return records.filter(r => r.clockOut && !r.absent).reduce((a, r) => a + calcHours(r), 0);
}

function minsToHM(m) {
  const h = Math.floor(m / 60);
  const mn = m % 60;
  return h + 'h ' + (mn < 10 ? '0' : '') + mn + 'm';
}

function fmtTime(iso) {
  if (!iso) return '--';
  return new Date(iso).toTimeString().slice(0, 5);
}

function fmtDate(iso) {
  if (!iso) return '--';
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtDateFull(iso) {
  if (!iso) return '--';
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function getInitials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// ── Sites ──
function getSites() { return getDB().sites; }
function getSite(name) { return getDB().sites.find(s => s.name === name); }

// ── Export to CSV ──
function exportAttendanceCSV(month, year) {
  const staff = getAllStaff();
  const rows = [['Employee ID', 'Name', 'Department', 'Site', 'Date', 'Clock In', 'Clock Out', 'Hours', 'Type', 'Note']];
  staff.forEach(emp => {
    const recs = getMonthRecords(emp.id, year, month);
    recs.forEach(r => {
      rows.push([
        emp.id, emp.name, emp.dept, emp.site,
        fmtDate(r.clockIn), fmtTime(r.clockIn),
        r.clockOut ? fmtTime(r.clockOut) : '',
        r.absent ? 'ABSENT' : minsToHM(calcHours(r)),
        r.manual ? 'Manual' : 'Auto',
        r.note || ''
      ]);
    });
  });
  const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'attendance_' + (month + 1) + '_' + year + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ── Reset (dev only) ──
function resetDB() {
  _db = JSON.parse(JSON.stringify(DEFAULT_DATA));
  saveDB();
}

// init on load
loadDB();
