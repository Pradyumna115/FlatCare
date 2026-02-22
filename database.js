require('dotenv').config();
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = process.env.VERCEL ? '/tmp/flatcare.db' : path.join(__dirname, 'flatcare.db');
const SALT_ROUNDS = 12;

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initializeDatabase();
  }
  return db;
}

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS flats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      flat_number TEXT UNIQUE NOT NULL,
      owner_name TEXT DEFAULT '',
      contact TEXT DEFAULT '',
      status TEXT DEFAULT 'Vacant' CHECK(status IN ('Occupied', 'Vacant'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      flat_id INTEGER NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      amount_expected REAL NOT NULL,
      amount_paid REAL DEFAULT 0,
      garbage_charge REAL DEFAULT 0,
      status TEXT DEFAULT 'Pending' CHECK(status IN ('Paid', 'Pending')),
      date_paid TEXT,
      FOREIGN KEY (flat_id) REFERENCES flats(id),
      UNIQUE(flat_id, month, year)
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      description TEXT DEFAULT '',
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      is_recurring INTEGER DEFAULT 0,
      recurring_type TEXT DEFAULT '' CHECK(recurring_type IN ('', 'monthly', 'six-month')),
      payment_mode TEXT DEFAULT 'Cash',
      reference_id TEXT DEFAULT '',
      attachment_path TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS monthly_summary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      opening_balance REAL DEFAULT 0,
      total_collection REAL DEFAULT 0,
      total_expenses REAL DEFAULT 0,
      closing_balance REAL DEFAULT 0,
      UNIQUE(month, year)
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'viewer' CHECK(role IN ('admin', 'manager', 'viewer')),
      display_name TEXT DEFAULT '',
      email TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id INTEGER,
      details TEXT DEFAULT '',
      timestamp TEXT DEFAULT (datetime('now'))
    );
  `);

  // ── Performance Indexes ──
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_payments_month_year ON payments(month, year);
    CREATE INDEX IF NOT EXISTS idx_payments_flat_id ON payments(flat_id);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
    CREATE INDEX IF NOT EXISTS idx_expenses_month_year ON expenses(month, year);
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  `);

  // ── Add new expense columns if they don't exist (migration) ──
  try {
    db.exec(`ALTER TABLE expenses ADD COLUMN payment_mode TEXT DEFAULT 'Cash'`);
  } catch (e) { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE expenses ADD COLUMN reference_id TEXT DEFAULT ''`);
  } catch (e) { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE expenses ADD COLUMN attachment_path TEXT DEFAULT ''`);
  } catch (e) { /* column already exists */ }

  // ── Flat numbering migration: F-01..F-30 → 101..506 ──
  migrateFlatNumbers();

  // ── Seed 30 flats if not already seeded (5 floors × 6 flats) ──
  const flatCount = db.prepare('SELECT COUNT(*) as cnt FROM flats').get();
  if (flatCount.cnt === 0) {
    const insert = db.prepare('INSERT INTO flats (flat_number, owner_name, contact, status) VALUES (?, ?, ?, ?)');
    const seedMany = db.transaction(() => {
      for (let floor = 1; floor <= 5; floor++) {
        for (let unit = 1; unit <= 6; unit++) {
          const flatNum = `${floor}0${unit}`;
          insert.run(flatNum, '', '', 'Vacant');
        }
      }
    });
    seedMany();
    console.log('Seeded 30 flats (101-506).');
  }

  // ── Seed default admin user if no users exist ──
  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
  if (userCount.cnt === 0) {
    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminPass = process.env.ADMIN_PASS || 'murali@flatcare';
    const hash = bcrypt.hashSync(adminPass, SALT_ROUNDS);
    db.prepare(
      'INSERT INTO users (username, password_hash, role, display_name, email) VALUES (?, ?, ?, ?, ?)'
    ).run(adminUser, hash, 'admin', 'Administrator', 'admin@flatcare.local');
    console.log(`Seeded default admin user (${adminUser} / ${adminPass}).`);
  } else {
    // Update existing admin password to new one if it was the old default
    const admin = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
    if (admin && bcrypt.compareSync('flatcare123', admin.password_hash)) {
      const newPass = process.env.ADMIN_PASS || 'murali@flatcare';
      const hash = bcrypt.hashSync(newPass, SALT_ROUNDS);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, admin.id);
      console.log(`Updated admin password to new default.`);
    }
  }
}

// ── Migrate old flat numbers (F-01..F-30) to new format (101..506) ──
function migrateFlatNumbers() {
  const oldFlats = db.prepare("SELECT id, flat_number FROM flats WHERE flat_number LIKE 'F-%'").all();
  if (oldFlats.length === 0) return;

  console.log(`Migrating ${oldFlats.length} flat numbers from F-XX to floor-based format...`);

  const update = db.prepare('UPDATE flats SET flat_number = ? WHERE id = ?');
  const migrate = db.transaction(() => {
    // Sort by old number to get sequential order
    oldFlats.sort((a, b) => {
      const numA = parseInt(a.flat_number.replace('F-', ''));
      const numB = parseInt(b.flat_number.replace('F-', ''));
      return numA - numB;
    });

    for (let i = 0; i < oldFlats.length; i++) {
      const floor = Math.floor(i / 6) + 1;
      const unit = (i % 6) + 1;
      const newNumber = `${floor}0${unit}`;
      update.run(newNumber, oldFlats[i].id);
    }
  });
  migrate();
  console.log('Flat number migration complete.');
}

// ══════════════════════════════════════════
// CHARGES COMPUTATION
// ══════════════════════════════════════════

function calculateCharges(status) {
  const isOccupied = status === 'Occupied';
  return {
    maintenance_charge: 1500,
    garbage_charge: isOccupied ? 100 : 0
  };
}

// ══════════════════════════════════════════
// FLAT OPERATIONS
// ══════════════════════════════════════════

function getAllFlats() {
  return getDb().prepare('SELECT * FROM flats ORDER BY flat_number').all();
}

function getFlatById(id) {
  return getDb().prepare('SELECT * FROM flats WHERE id = ?').get(id);
}

function updateFlat(id, { owner_name, contact, status }) {
  const d = getDb();
  d.prepare(
    'UPDATE flats SET owner_name = ?, contact = ?, status = ? WHERE id = ?'
  ).run(owner_name, contact, status, id);

  // Auto-update pending payments for current month based on explicit status (Occupied vs Vacant)
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const charges = calculateCharges(status);
  const newExpected = charges.maintenance_charge;
  const newGarbage = charges.garbage_charge;

  // Update any pending payment for this flat in the current month
  d.prepare(`
    UPDATE payments SET amount_expected = ?, garbage_charge = ?
    WHERE flat_id = ? AND month = ? AND year = ? AND status = 'Pending'
  `).run(newExpected, newGarbage, id, month, year);

  updateMonthlySummary(month, year);
  return getFlatById(id);
}

// ══════════════════════════════════════════
// PAYMENT OPERATIONS
// ══════════════════════════════════════════

function initializeMonthPayments(month, year) {
  const d = getDb();
  const flats = getAllFlats();

  const existing = d.prepare(
    'SELECT COUNT(*) as cnt FROM payments WHERE month = ? AND year = ?'
  ).get(month, year);

  if (existing.cnt > 0) return { message: 'Month already initialized' };

  const insert = d.prepare(
    'INSERT INTO payments (flat_id, month, year, amount_expected, garbage_charge, status) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const initAll = d.transaction(() => {
    for (const flat of flats) {
      // Dynamic pricing: ₹1500 base maintenance + ₹100 garbage (if occupied)
      const charges = calculateCharges(flat.status);
      const expected = charges.maintenance_charge;
      const garbage = charges.garbage_charge;
      insert.run(flat.id, month, year, expected, garbage, 'Pending');
    }
  });

  initAll();

  // Initialize monthly summary
  const prevSummary = getPreviousMonthSummary(month, year);
  const openingBalance = prevSummary ? prevSummary.closing_balance : 0;

  d.prepare(
    'INSERT OR IGNORE INTO monthly_summary (month, year, opening_balance) VALUES (?, ?, ?)'
  ).run(month, year, openingBalance);

  return { message: 'Month initialized successfully' };
}

function getPaymentsForMonth(month, year) {
  return getDb().prepare(`
    SELECT p.*, f.flat_number, f.owner_name, f.contact, f.status as flat_status
    FROM payments p
    JOIN flats f ON p.flat_id = f.id
    WHERE p.month = ? AND p.year = ?
    ORDER BY f.flat_number
  `).all(month, year);
}

function markPaymentPaid(paymentId) {
  const d = getDb();
  const payment = d.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  if (!payment) return null;

  const now = new Date().toISOString().split('T')[0];
  d.prepare(
    'UPDATE payments SET status = ?, amount_paid = amount_expected + garbage_charge, date_paid = ? WHERE id = ?'
  ).run('Paid', now, paymentId);

  updateMonthlySummary(payment.month, payment.year);
  return d.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
}

function markPaymentUnpaid(paymentId) {
  const d = getDb();
  const payment = d.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  if (!payment) return null;

  d.prepare(
    'UPDATE payments SET status = ?, amount_paid = 0, date_paid = NULL WHERE id = ?'
  ).run('Pending', paymentId);

  updateMonthlySummary(payment.month, payment.year);
  return d.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
}

function updatePayment(paymentId, { amount_paid, status, date_paid }) {
  const d = getDb();
  const payment = d.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  if (!payment) return null;

  d.prepare(
    'UPDATE payments SET amount_paid = ?, status = ?, date_paid = ? WHERE id = ?'
  ).run(amount_paid, status, date_paid || null, paymentId);

  updateMonthlySummary(payment.month, payment.year);
  return d.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
}

// Payment history for a specific flat
function getPaymentHistoryForFlat(flatId) {
  return getDb().prepare(`
    SELECT p.*, f.flat_number, f.owner_name
    FROM payments p
    JOIN flats f ON p.flat_id = f.id
    WHERE p.flat_id = ?
    ORDER BY p.year DESC, p.month DESC
  `).all(flatId);
}

// ══════════════════════════════════════════
// EXPENSE OPERATIONS
// ══════════════════════════════════════════

function getExpensesForMonth(month, year) {
  return getDb().prepare(
    'SELECT * FROM expenses WHERE month = ? AND year = ? ORDER BY date DESC'
  ).all(month, year);
}

function addExpense({ category, description, amount, date, month, year, is_recurring, recurring_type, payment_mode, reference_id, attachment_path }) {
  const d = getDb();
  const result = d.prepare(
    'INSERT INTO expenses (category, description, amount, date, month, year, is_recurring, recurring_type, payment_mode, reference_id, attachment_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(category, description, amount, date, month, year, is_recurring || 0, recurring_type || '',
    payment_mode || 'Cash', reference_id || '', attachment_path || '');

  updateMonthlySummary(month, year);
  return d.prepare('SELECT * FROM expenses WHERE id = ?').get(result.lastInsertRowid);
}

function deleteExpense(id) {
  const d = getDb();
  const expense = d.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
  if (!expense) return null;

  d.prepare('DELETE FROM expenses WHERE id = ?').run(id);
  updateMonthlySummary(expense.month, expense.year);
  return expense;
}

// ══════════════════════════════════════════
// MONTHLY SUMMARY OPERATIONS
// ══════════════════════════════════════════

function getPreviousMonthSummary(month, year) {
  let prevMonth = month - 1;
  let prevYear = year;
  if (prevMonth === 0) {
    prevMonth = 12;
    prevYear = year - 1;
  }
  return getDb().prepare(
    'SELECT * FROM monthly_summary WHERE month = ? AND year = ?'
  ).get(prevMonth, prevYear);
}

function getMonthlySummary(month, year) {
  return getDb().prepare(
    'SELECT * FROM monthly_summary WHERE month = ? AND year = ?'
  ).get(month, year);
}

function updateMonthlySummary(month, year) {
  const d = getDb();

  const summary = d.prepare(
    'SELECT * FROM monthly_summary WHERE month = ? AND year = ?'
  ).get(month, year);

  if (!summary) return;

  const paymentStats = d.prepare(`
    SELECT
      COALESCE(SUM(amount_paid), 0) as total_collected
    FROM payments
    WHERE month = ? AND year = ?
  `).get(month, year);

  const expenseStats = d.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total_expenses
    FROM expenses
    WHERE month = ? AND year = ?
  `).get(month, year);

  const closingBalance = summary.opening_balance + paymentStats.total_collected - expenseStats.total_expenses;

  d.prepare(`
    UPDATE monthly_summary
    SET total_collection = ?, total_expenses = ?, closing_balance = ?
    WHERE month = ? AND year = ?
  `).run(paymentStats.total_collected, expenseStats.total_expenses, closingBalance, month, year);
}

// ══════════════════════════════════════════
// ARREARS / DUES OPERATIONS
// ══════════════════════════════════════════

function getArrearsForFlats(month, year) {
  return getDb().prepare(`
    SELECT
      f.id as flat_id, f.flat_number, f.owner_name, f.contact,
      p.month, p.year, p.amount_expected, p.amount_paid,
      (p.amount_expected - p.amount_paid) as due_amount
    FROM payments p
    JOIN flats f ON p.flat_id = f.id
    WHERE p.status = 'Pending'
      AND (p.year < ? OR (p.year = ? AND p.month < ?))
    ORDER BY f.id, p.year, p.month
  `).all(year, year, month);
}

function getArrearsSummaryByFlat(month, year) {
  return getDb().prepare(`
    SELECT
      f.id as flat_id, f.flat_number, f.owner_name, f.contact,
      COALESCE(SUM(p.amount_expected - p.amount_paid), 0) as total_arrears,
      COUNT(p.id) as months_pending
    FROM flats f
    LEFT JOIN payments p ON p.flat_id = f.id
      AND p.status = 'Pending'
      AND (p.year < ? OR (p.year = ? AND p.month < ?))
    GROUP BY f.id
    HAVING total_arrears > 0
    ORDER BY total_arrears DESC
  `).all(year, year, month);
}

function getTotalArrears(month, year) {
  const result = getDb().prepare(`
    SELECT COALESCE(SUM(amount_expected - amount_paid), 0) as total_arrears
    FROM payments
    WHERE status = 'Pending'
      AND (year < ? OR (year = ? AND month < ?))
  `).get(year, year, month);
  return result.total_arrears;
}

// ══════════════════════════════════════════
// DASHBOARD & REPORT DATA
// ══════════════════════════════════════════

function getDashboardData(month, year) {
  const d = getDb();
  const summary = getMonthlySummary(month, year);

  const paymentStats = d.prepare(`
    SELECT
      COALESCE(SUM(amount_expected), 0) as total_expected,
      COALESCE(SUM(amount_paid), 0) as total_received,
      COALESCE(SUM(CASE WHEN status = 'Pending' THEN amount_expected ELSE 0 END), 0) as total_pending,
      COALESCE(SUM(garbage_charge), 0) as total_garbage
    FROM payments
    WHERE month = ? AND year = ?
  `).get(month, year);

  const expenseStats = d.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total_expenses
    FROM expenses
    WHERE month = ? AND year = ?
  `).get(month, year);

  const flatStats = d.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'Occupied' THEN 1 ELSE 0 END) as occupied,
      SUM(CASE WHEN status = 'Vacant' THEN 1 ELSE 0 END) as vacant
    FROM flats
  `).get();

  const pendingFlats = d.prepare(`
    SELECT f.flat_number, f.owner_name, p.amount_expected
    FROM payments p
    JOIN flats f ON p.flat_id = f.id
    WHERE p.month = ? AND p.year = ? AND p.status = 'Pending'
    ORDER BY f.flat_number
  `).all(month, year);

  const totalArrears = getTotalArrears(month, year);
  const arrearsByFlat = getArrearsSummaryByFlat(month, year);

  return {
    month, year,
    opening_balance: summary ? summary.opening_balance : 0,
    closing_balance: summary ? summary.closing_balance : 0,
    total_expected: paymentStats.total_expected,
    total_received: paymentStats.total_received,
    total_pending: paymentStats.total_pending,
    total_garbage: paymentStats.total_garbage,
    total_expenses: expenseStats.total_expenses,
    remaining_balance: (summary ? summary.opening_balance : 0) + paymentStats.total_received - expenseStats.total_expenses,
    flat_stats: flatStats,
    pending_flats: pendingFlats,
    total_arrears: totalArrears,
    arrears_by_flat: arrearsByFlat,
    is_initialized: !!summary
  };
}

function getReportData(month, year) {
  const dashboard = getDashboardData(month, year);
  const expenses = getExpensesForMonth(month, year);
  const payments = getPaymentsForMonth(month, year);

  const categoryBreakdown = {};
  for (const exp of expenses) {
    if (!categoryBreakdown[exp.category]) categoryBreakdown[exp.category] = 0;
    categoryBreakdown[exp.category] += exp.amount;
  }

  // Floor-wise collection data
  const floorWise = {};
  for (const p of payments) {
    const floor = p.flat_number ? Math.floor(parseInt(p.flat_number) / 100) : 0;
    if (!floorWise[floor]) floorWise[floor] = { expected: 0, received: 0, pending: 0, floor };
    floorWise[floor].expected += p.amount_expected || 0;
    floorWise[floor].received += p.amount_paid || 0;
    if (p.status === 'Pending') floorWise[floor].pending += p.amount_expected || 0;
  }

  return {
    ...dashboard, expenses, payments,
    category_breakdown: categoryBreakdown,
    floor_wise: Object.values(floorWise).sort((a, b) => a.floor - b.floor)
  };
}

// ══════════════════════════════════════════
// USER OPERATIONS
// ══════════════════════════════════════════

function getUserByUsername(username) {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getUserById(id) {
  return getDb().prepare('SELECT id, username, role, display_name, email, is_active, created_at, last_login FROM users WHERE id = ?').get(id);
}

function getAllUsers() {
  return getDb().prepare(
    'SELECT id, username, role, display_name, email, is_active, created_at, last_login FROM users ORDER BY id'
  ).all();
}

function createUser({ username, password, role, display_name, email }) {
  const d = getDb();
  const existing = d.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return { error: 'Username already exists' };

  const hash = bcrypt.hashSync(password, SALT_ROUNDS);
  const result = d.prepare(
    'INSERT INTO users (username, password_hash, role, display_name, email) VALUES (?, ?, ?, ?, ?)'
  ).run(username, hash, role || 'viewer', display_name || '', email || '');

  return getUserById(result.lastInsertRowid);
}

function updateUser(id, { display_name, email, role, is_active }) {
  const d = getDb();
  const user = d.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return null;

  d.prepare(
    'UPDATE users SET display_name = ?, email = ?, role = ?, is_active = ? WHERE id = ?'
  ).run(
    display_name !== undefined ? display_name : user.display_name,
    email !== undefined ? email : user.email,
    role !== undefined ? role : user.role,
    is_active !== undefined ? (is_active ? 1 : 0) : user.is_active,
    id
  );

  return getUserById(id);
}

function changePassword(id, newPassword) {
  const hash = bcrypt.hashSync(newPassword, SALT_ROUNDS);
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  return { success: true };
}

function updateLastLogin(id) {
  getDb().prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(id);
}

function toggleUserActive(id) {
  const d = getDb();
  const user = d.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return null;
  const newStatus = user.is_active ? 0 : 1;
  d.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(newStatus, id);
  return getUserById(id);
}

// ══════════════════════════════════════════
// AUDIT LOG
// ══════════════════════════════════════════

function logAction(userId, username, action, entity, entityId, details) {
  getDb().prepare(
    'INSERT INTO audit_log (user_id, username, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, username, action, entity || null, entityId || null, details || '');
}

function getAuditLog(limit = 100) {
  return getDb().prepare(
    'SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?'
  ).all(limit);
}

module.exports = {
  getDb,
  calculateCharges,
  getAllFlats, getFlatById, updateFlat,
  initializeMonthPayments, getPaymentsForMonth,
  markPaymentPaid, markPaymentUnpaid, updatePayment,
  getPaymentHistoryForFlat,
  getExpensesForMonth, addExpense, deleteExpense,
  getMonthlySummary, getDashboardData, getReportData, updateMonthlySummary,
  getArrearsForFlats, getArrearsSummaryByFlat, getTotalArrears,
  getUserByUsername, getUserById, getAllUsers, createUser, updateUser,
  changePassword, updateLastLogin, toggleUserActive,
  logAction, getAuditLog
};
