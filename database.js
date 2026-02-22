// ══════════════════════════════════════════
// FlatCare – MongoDB Database Layer (Mongoose)
// ══════════════════════════════════════════

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

// ── Mongoose Schemas ──

const flatSchema = new mongoose.Schema({
  flat_number: { type: String, unique: true, required: true },
  owner_name: { type: String, default: '' },
  contact: { type: String, default: '' },
  status: { type: String, enum: ['Occupied', 'Vacant'], default: 'Vacant' }
});

const paymentSchema = new mongoose.Schema({
  flat_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Flat', required: true },
  month: { type: Number, required: true },
  year: { type: Number, required: true },
  amount_expected: { type: Number, required: true }, // Current month maintenance
  amount_paid: { type: Number, default: 0 },
  garbage_charge: { type: Number, default: 0 },
  extra_payment: { type: Number, default: 0 }, // For advances, donations, etc.
  previous_arrears: { type: Number, default: 0 }, // Unpaid from previous months
  status: { type: String, enum: ['Pending', 'Paid'], default: 'Pending' },
  date_paid: { type: String, default: null }
}, { timestamps: true });
paymentSchema.index({ flat_id: 1, month: 1, year: 1 }, { unique: true });
paymentSchema.index({ month: 1, year: 1 });
paymentSchema.index({ status: 1 });

const expenseSchema = new mongoose.Schema({
  category: { type: String, required: true },
  description: { type: String, default: '' },
  amount: { type: Number, required: true },
  date: { type: String, required: true },
  month: { type: Number, required: true },
  year: { type: Number, required: true },
  is_recurring: { type: Number, default: 0 },
  recurring_type: { type: String, enum: ['', 'monthly', 'six-month'], default: '' },
  payment_mode: { type: String, default: 'Cash' },
  reference_id: { type: String, default: '' },
  attachment_path: { type: String, default: '' }
});
expenseSchema.index({ month: 1, year: 1 });

const monthlySummarySchema = new mongoose.Schema({
  month: { type: Number, required: true },
  year: { type: Number, required: true },
  opening_balance: { type: Number, default: 0 },
  total_collection: { type: Number, default: 0 },
  total_expenses: { type: Number, default: 0 },
  closing_balance: { type: Number, default: 0 },
  balance_date: { type: String, default: '' }
});
monthlySummarySchema.index({ month: 1, year: 1 }, { unique: true });

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password_hash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'manager', 'viewer'], default: 'viewer' },
  display_name: { type: String, default: '' },
  email: { type: String, default: '' },
  is_active: { type: Number, default: 1 },
  created_at: { type: String, default: () => new Date().toISOString() },
  last_login: { type: String, default: null }
});
// username index is already created by unique:true in schema

const auditLogSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, default: null },
  username: { type: String },
  action: { type: String, required: true },
  entity: { type: String, default: null },
  entity_id: { type: String, default: null },
  details: { type: String, default: '' },
  timestamp: { type: String, default: () => new Date().toISOString() }
});
auditLogSchema.index({ timestamp: -1 });

// ── Models ──
const Flat = mongoose.model('Flat', flatSchema);
const Payment = mongoose.model('Payment', paymentSchema);
const Expense = mongoose.model('Expense', expenseSchema);
const MonthlySummary = mongoose.model('MonthlySummary', monthlySummarySchema);
const User = mongoose.model('User', userSchema);
const AuditLog = mongoose.model('AuditLog', auditLogSchema);

// ── Connect ──
let isConnected = false;

async function connectDB() {
  if (isConnected) return;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set in .env');
  await mongoose.connect(uri);
  isConnected = true;
  console.log('✅ MongoDB connected');
  await initializeDatabase();
}

// Helper: convert Mongoose doc to plain object with `id` field
function toPlain(doc) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  obj.id = (obj._id || '').toString();
  delete obj.__v;
  return obj;
}

function toPlainArray(docs) {
  return docs.map(toPlain);
}

// ══════════════════════════════════════════
// INITIALIZATION
// ══════════════════════════════════════════

async function initializeDatabase() {
  // Seed 30 flats if none exist
  const flatCount = await Flat.countDocuments();
  if (flatCount === 0) {
    const flats = [];
    for (let floor = 1; floor <= 5; floor++) {
      for (let unit = 1; unit <= 6; unit++) {
        flats.push({ flat_number: `${floor}0${unit}`, owner_name: '', contact: '', status: 'Vacant' });
      }
    }
    await Flat.insertMany(flats);
    console.log('Seeded 30 flats (101-506).');
  }

  // Seed default admin user if no users exist
  const userCount = await User.countDocuments();
  if (userCount === 0) {
    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminPass = process.env.ADMIN_PASS || 'murali@flatcare';
    const hash = bcrypt.hashSync(adminPass, SALT_ROUNDS);
    await User.create({
      username: adminUser,
      password_hash: hash,
      role: 'admin',
      display_name: 'Administrator',
      email: 'admin@flatcare.local'
    });
    console.log(`Seeded default admin user (${adminUser} / ${adminPass}).`);
  }
}

// For backward compatibility — called by server.js
function getDb() {
  // No-op for MongoDB; kept for API compatibility
  return true;
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

async function getAllFlats() {
  const docs = await Flat.find().sort({ flat_number: 1 }).lean();
  return docs.map(d => ({ ...d, id: d._id.toString() }));
}

async function getFlatById(id) {
  const doc = await Flat.findById(id).lean();
  if (!doc) return null;
  return { ...doc, id: doc._id.toString() };
}

async function updateFlat(id, { owner_name, contact, status }) {
  await Flat.findByIdAndUpdate(id, { owner_name, contact, status });

  // Auto-update pending payments for current month
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const charges = calculateCharges(status);
  await Payment.updateMany(
    { flat_id: id, month, year, status: 'Pending' },
    { amount_expected: charges.maintenance_charge, garbage_charge: charges.garbage_charge }
  );

  await updateMonthlySummary(month, year);
  return getFlatById(id);
}

// ══════════════════════════════════════════
// PAYMENT OPERATIONS
// ══════════════════════════════════════════

async function initializeMonthPayments(month, year) {
  const existing = await Payment.countDocuments({ month, year });
  if (existing > 0) return { message: 'Month already initialized' };

  const flats = await Flat.find().lean();

  // Calculate arrears for each flat up to this month
  const arrearsMap = {};
  for (const flat of flats) {
    const prevPayments = await Payment.find({
      flat_id: flat._id,
      $or: [
        { year: { $lt: year } },
        { year: year, month: { $lt: month } }
      ]
    }).lean();

    let flatArrears = 0;
    for (const p of prevPayments) {
      if (p.status === 'Pending') {
        const totalDue = (p.amount_expected || 0) + (p.garbage_charge || 0) + (p.previous_arrears || 0);
        flatArrears += Math.max(0, totalDue - (p.amount_paid || 0));
      }
    }
    arrearsMap[flat._id.toString()] = flatArrears;
  }

  const ops = flats.map(flat => {
    const charges = calculateCharges(flat.status);
    return {
      flat_id: flat._id,
      month, year,
      amount_expected: charges.maintenance_charge,
      garbage_charge: charges.garbage_charge,
      extra_payment: 0,
      previous_arrears: arrearsMap[flat._id.toString()] || 0,
      status: 'Pending'
    };
  });
  await Payment.insertMany(ops);

  // Initialize monthly summary
  let openingBalance = 0;
  const prevSummary = await getPreviousMonthSummary(month, year);
  if (prevSummary) {
    openingBalance = prevSummary.closing_balance;
  }

  await MonthlySummary.findOneAndUpdate(
    { month, year },
    { $setOnInsert: { month, year, opening_balance: openingBalance, total_collection: 0, total_expenses: 0, closing_balance: openingBalance } },
    { upsert: true }
  );

  return { message: 'Month initialized successfully' };
}

async function getPaymentsForMonth(month, year) {
  const payments = await Payment.find({ month, year })
    .populate('flat_id')
    .lean();

  return payments.map(p => ({
    ...p,
    id: p._id.toString(),
    flat_number: p.flat_id?.flat_number || '',
    owner_name: p.flat_id?.owner_name || '',
    contact: p.flat_id?.contact || '',
    flat_status: p.flat_id?.status || 'Vacant',
    flat_id: p.flat_id?._id?.toString() || p.flat_id?.toString()
  })).sort((a, b) => (a.flat_number || '').localeCompare(b.flat_number || ''));
}

async function markPaymentPaid(paymentId) {
  const payment = await Payment.findById(paymentId);
  if (!payment) return null;

  const now = new Date().toISOString().split('T')[0];
  payment.status = 'Paid';
  payment.amount_paid = (payment.amount_expected || 0) + (payment.garbage_charge || 0) + (payment.previous_arrears || 0) + (payment.extra_payment || 0);
  payment.date_paid = now;
  await payment.save();

  await updateMonthlySummary(payment.month, payment.year);
  const updated = await Payment.findById(paymentId).lean();
  return { ...updated, id: updated._id.toString() };
}

async function markPaymentUnpaid(paymentId) {
  const payment = await Payment.findById(paymentId);
  if (!payment) return null;

  payment.status = 'Pending';
  payment.amount_paid = 0;
  payment.date_paid = null;
  await payment.save();

  await updateMonthlySummary(payment.month, payment.year);
  const updated = await Payment.findById(paymentId).lean();
  return { ...updated, id: updated._id.toString() };
}

async function updatePayment(paymentId, { amount_paid, extra_payment, status, date_paid }) {
  const payment = await Payment.findById(paymentId);
  if (!payment) return null;

  if (amount_paid !== undefined) payment.amount_paid = amount_paid;
  if (extra_payment !== undefined) payment.extra_payment = extra_payment;
  if (status !== undefined) payment.status = status;
  if (date_paid !== undefined) payment.date_paid = date_paid || null;
  await payment.save();

  await updateMonthlySummary(payment.month, payment.year);
  const updated = await Payment.findById(paymentId).lean();
  return { ...updated, id: updated._id.toString() };
}

async function getPaymentHistoryForFlat(flatId) {
  const payments = await Payment.find({ flat_id: flatId })
    .populate('flat_id')
    .sort({ year: -1, month: -1 })
    .lean();

  return payments.map(p => ({
    ...p,
    id: p._id.toString(),
    flat_number: p.flat_id?.flat_number || '',
    owner_name: p.flat_id?.owner_name || '',
    flat_id: p.flat_id?._id?.toString() || p.flat_id?.toString()
  }));
}

// ══════════════════════════════════════════
// EXPENSE OPERATIONS
// ══════════════════════════════════════════

async function getExpensesForMonth(month, year) {
  const docs = await Expense.find({ month, year }).sort({ date: -1 }).lean();
  return docs.map(d => ({ ...d, id: d._id.toString() }));
}

async function addExpense({ category, description, amount, date, month, year, is_recurring, recurring_type, payment_mode, reference_id, attachment_path }) {
  const expense = await Expense.create({
    category, description: description || '', amount, date,
    month, year,
    is_recurring: is_recurring || 0,
    recurring_type: recurring_type || '',
    payment_mode: payment_mode || 'Cash',
    reference_id: reference_id || '',
    attachment_path: attachment_path || ''
  });

  await updateMonthlySummary(month, year);
  const doc = await Expense.findById(expense._id).lean();
  return { ...doc, id: doc._id.toString() };
}

async function deleteExpense(id) {
  const expense = await Expense.findById(id).lean();
  if (!expense) return null;

  await Expense.findByIdAndDelete(id);
  await updateMonthlySummary(expense.month, expense.year);
  return { ...expense, id: expense._id.toString() };
}

// ══════════════════════════════════════════
// MONTHLY SUMMARY OPERATIONS
// ══════════════════════════════════════════

async function getPreviousMonthSummary(month, year) {
  let prevMonth = month - 1;
  let prevYear = year;
  if (prevMonth === 0) { prevMonth = 12; prevYear = year - 1; }
  const doc = await MonthlySummary.findOne({ month: prevMonth, year: prevYear }).lean();
  if (!doc) return null;
  return { ...doc, id: doc._id.toString() };
}

async function getMonthlySummary(month, year) {
  const doc = await MonthlySummary.findOne({ month, year }).lean();
  if (!doc) return null;
  return { ...doc, id: doc._id.toString() };
}

async function updateMonthlySummary(month, year) {
  const summary = await MonthlySummary.findOne({ month, year });
  if (!summary) return;

  const paymentAgg = await Payment.aggregate([
    { $match: { month, year } },
    { $group: { _id: null, total_collected: { $sum: '$amount_paid' } } }
  ]);
  const totalCollected = paymentAgg[0]?.total_collected || 0;

  const expenseAgg = await Expense.aggregate([
    { $match: { month, year } },
    { $group: { _id: null, total_expenses: { $sum: '$amount' } } }
  ]);
  const totalExpenses = expenseAgg[0]?.total_expenses || 0;

  const closingBalance = summary.opening_balance + totalCollected - totalExpenses;

  summary.total_collection = totalCollected;
  summary.total_expenses = totalExpenses;
  summary.closing_balance = closingBalance;
  await summary.save();

  // PROACTIVE ROLL-OVER: Update next month's opening balance if it exists
  let nextMonth = month + 1;
  let nextYear = year;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear = year + 1;
  }
  const nextSummary = await MonthlySummary.findOne({ month: nextMonth, year: nextYear });
  if (nextSummary) {
    nextSummary.opening_balance = closingBalance;
    await nextSummary.save();
    // Recursive update for next month
    await updateMonthlySummary(nextMonth, nextYear);
  }
}

async function setOpeningBalance(month, year, amount, balanceDate) {
  let summary = await MonthlySummary.findOne({ month, year });
  if (!summary) {
    // Create the summary if it doesn't exist yet
    summary = await MonthlySummary.create({
      month, year,
      opening_balance: amount,
      total_collection: 0,
      total_expenses: 0,
      closing_balance: amount,
      balance_date: balanceDate || `${year}-${String(month).padStart(2, '0')}-01`
    });
  } else {
    summary.opening_balance = amount;
    if (balanceDate) summary.balance_date = balanceDate;
    await summary.save();
  }
  // Recalculate closing balance
  await updateMonthlySummary(month, year);
  const updated = await MonthlySummary.findOne({ month, year }).lean();
  return { ...updated, id: updated._id.toString() };
}

// ══════════════════════════════════════════
// ARREARS / DUES OPERATIONS
// ══════════════════════════════════════════

async function getArrearsForFlats(month, year) {
  const payments = await Payment.find({
    status: 'Pending',
    $or: [
      { year: { $lt: year } },
      { year: year, month: { $lt: month } }
    ]
  }).populate('flat_id').sort({ year: 1, month: 1 }).lean();

  return payments.map(p => {
    const totalExpected = (p.amount_expected || 0) + (p.garbage_charge || 0) + (p.previous_arrears || 0) + (p.extra_payment || 0);
    const dueAmount = totalExpected - (p.amount_paid || 0);
    return {
      flat_id: p.flat_id?._id?.toString(),
      flat_number: p.flat_id?.flat_number || '',
      owner_name: p.flat_id?.owner_name || '',
      contact: p.flat_id?.contact || '',
      month: p.month,
      year: p.year,
      amount_expected: p.amount_expected,
      amount_paid: p.amount_paid,
      garbage_charge: p.garbage_charge,
      extra_payment: p.extra_payment,
      previous_arrears: p.previous_arrears,
      due_amount: dueAmount > 0 ? dueAmount : 0
    };
  });
}

async function getArrearsSummaryByFlat(month, year) {
  const result = await Payment.aggregate([
    {
      $match: {
        status: 'Pending',
        $or: [
          { year: { $lt: year } },
          { year: year, month: { $lt: month } }
        ]
      }
    },
    {
      $group: {
        _id: '$flat_id',
        // Calculate due completely per payment, max to 0
        total_arrears: {
          $sum: {
            $max: [
              {
                $subtract: [
                  { $add: ['$amount_expected', '$garbage_charge', '$previous_arrears', '$extra_payment'] },
                  '$amount_paid'
                ]
              },
              0
            ]
          }
        },
        months_pending: { $sum: 1 }
      }
    },
    { $match: { total_arrears: { $gt: 0 } } },
    { $sort: { total_arrears: -1 } },
    {
      $lookup: {
        from: 'flats',
        localField: '_id',
        foreignField: '_id',
        as: 'flat'
      }
    },
    { $unwind: '$flat' }
  ]);

  return result.map(r => ({
    flat_id: r._id.toString(),
    flat_number: r.flat?.flat_number || '',
    owner_name: r.flat?.owner_name || '',
    contact: r.flat?.contact || '',
    total_arrears: r.total_arrears,
    months_pending: r.months_pending
  }));
}

async function getTotalArrears(month, year) {
  const result = await Payment.aggregate([
    {
      $match: {
        status: 'Pending',
        $or: [
          { year: { $lt: year } },
          { year: year, month: { $lt: month } }
        ]
      }
    },
    {
      $group: {
        _id: null,
        total_arrears: {
          $sum: {
            $max: [
              {
                $subtract: [
                  { $add: ['$amount_expected', '$garbage_charge', '$previous_arrears', '$extra_payment'] },
                  '$amount_paid'
                ]
              },
              0
            ]
          }
        }
      }
    }
  ]);
  return result[0]?.total_arrears || 0;
}

// ══════════════════════════════════════════
// DASHBOARD & REPORT DATA
// ══════════════════════════════════════════

async function getDashboardData(month, year) {
  const summary = await getMonthlySummary(month, year);

  const paymentAgg = await Payment.aggregate([
    { $match: { month, year } },
    {
      $group: {
        _id: null,
        total_expected: { $sum: '$amount_expected' },
        total_received: { $sum: '$amount_paid' },
        total_pending: {
          $sum: {
            $max: [0, {
              $subtract: [
                { $add: ['$amount_expected', '$garbage_charge', '$previous_arrears', '$extra_payment'] },
                '$amount_paid'
              ]
            }]
          }
        },
        total_garbage: { $sum: '$garbage_charge' },
        total_extra: { $sum: '$extra_payment' }
      }
    }
  ]);
  const ps = paymentAgg[0] || { total_expected: 0, total_received: 0, total_pending: 0, total_garbage: 0, total_extra: 0 };

  const expenseAgg = await Expense.aggregate([
    { $match: { month, year } },
    { $group: { _id: null, total_expenses: { $sum: '$amount' } } }
  ]);
  const es = expenseAgg[0] || { total_expenses: 0 };

  const flatStats = await Flat.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        occupied: { $sum: { $cond: [{ $eq: ['$status', 'Occupied'] }, 1, 0] } },
        vacant: { $sum: { $cond: [{ $eq: ['$status', 'Vacant'] }, 1, 0] } }
      }
    }
  ]);
  const fs = flatStats[0] || { total: 0, occupied: 0, vacant: 0 };

  const pendingFlats = await Payment.find({ month, year, status: 'Pending' })
    .populate('flat_id')
    .lean();
  const pendingFlatsList = pendingFlats
    .map(p => ({
      flat_number: p.flat_id?.flat_number || '',
      owner_name: p.flat_id?.owner_name || '',
      amount_expected: p.amount_expected,
      garbage_charge: p.garbage_charge,
      previous_arrears: p.previous_arrears,
      extra_payment: p.extra_payment,
      amount_paid: p.amount_paid
    }))
    .sort((a, b) => a.flat_number.localeCompare(b.flat_number));

  const totalArrears = await getTotalArrears(month, year);
  const arrearsByFlat = await getArrearsSummaryByFlat(month, year);

  return {
    month, year,
    opening_balance: summary ? summary.opening_balance : 0,
    closing_balance: summary ? summary.closing_balance : 0,
    total_expected: ps.total_expected,
    total_received: ps.total_received,
    total_pending: ps.total_pending,
    total_garbage: ps.total_garbage,
    total_extra: ps.total_extra,
    total_expenses: es.total_expenses,
    remaining_balance: (summary ? summary.opening_balance : 0) + ps.total_received - es.total_expenses,
    flat_stats: fs,
    pending_flats: pendingFlatsList,
    total_arrears: totalArrears,
    arrears_by_flat: arrearsByFlat,
    is_initialized: !!summary
  };
}

async function getReportData(month, year) {
  const dashboard = await getDashboardData(month, year);
  const expenses = await getExpensesForMonth(month, year);
  const payments = await getPaymentsForMonth(month, year);

  const categoryBreakdown = {};
  for (const exp of expenses) {
    if (!categoryBreakdown[exp.category]) categoryBreakdown[exp.category] = 0;
    categoryBreakdown[exp.category] += exp.amount;
  }

  const floorWise = {};
  for (const p of payments) {
    const floor = p.flat_number ? Math.floor(parseInt(p.flat_number) / 100) : 0;
    if (!floorWise[floor]) floorWise[floor] = { expected: 0, received: 0, pending: 0, floor };

    const totalDue = (p.amount_expected || 0) + (p.garbage_charge || 0) + (p.previous_arrears || 0) + (p.extra_payment || 0);
    floorWise[floor].expected += totalDue;
    floorWise[floor].received += p.amount_paid || 0;
    const pending = totalDue - (p.amount_paid || 0);
    floorWise[floor].pending += pending > 0 ? pending : 0;
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

async function getUserByUsername(username) {
  const doc = await User.findOne({ username }).lean();
  if (!doc) return null;
  return { ...doc, id: doc._id.toString() };
}

async function getUserById(id) {
  const doc = await User.findById(id).select('-password_hash').lean();
  if (!doc) return null;
  return { ...doc, id: doc._id.toString() };
}

async function getAllUsers() {
  const docs = await User.find().select('-password_hash').sort({ _id: 1 }).lean();
  return docs.map(d => ({ ...d, id: d._id.toString() }));
}

async function createUser({ username, password, role, display_name, email }) {
  const existing = await User.findOne({ username });
  if (existing) return { error: 'Username already exists' };

  const hash = bcrypt.hashSync(password, SALT_ROUNDS);
  const user = await User.create({
    username, password_hash: hash,
    role: role || 'viewer',
    display_name: display_name || '',
    email: email || ''
  });

  return getUserById(user._id);
}

async function updateUser(id, { username, display_name, email, role, is_active }) {
  const user = await User.findById(id);
  if (!user) return null;

  if (username !== undefined && username !== user.username) {
    // Check for duplicate username
    const existing = await User.findOne({ username, _id: { $ne: id } });
    if (existing) return { error: 'Username already exists' };
    user.username = username;
  }
  if (display_name !== undefined) user.display_name = display_name;
  if (email !== undefined) user.email = email;
  if (role !== undefined) user.role = role;
  if (is_active !== undefined) user.is_active = is_active ? 1 : 0;
  await user.save();

  return getUserById(id);
}

async function changePassword(id, newPassword) {
  const hash = bcrypt.hashSync(newPassword, SALT_ROUNDS);
  await User.findByIdAndUpdate(id, { password_hash: hash });
  return { success: true };
}

async function updateLastLogin(id) {
  await User.findByIdAndUpdate(id, { last_login: new Date().toISOString() });
}

async function deleteUser(id) {
  const user = await User.findById(id);
  if (!user) return null;

  // Store details for logging before deletion
  const details = `Deleted user ${user.username} (${user.role})`;

  await User.findByIdAndDelete(id);
  return { success: true, details };
}

// ══════════════════════════════════════════
// AUDIT LOG
// ══════════════════════════════════════════

async function logAction(user_id, username, action, target_type, target_id, details) {
  try {
    await AuditLog.create({
      user_id: user_id || null,
      username,
      action,
      entity: target_type || null, // Map target_type to entity
      entity_id: target_id || null, // Map target_id to entity_id
      details: details || ''
    });
  } catch (err) {
    console.error('Failed to log action:', err);
  }
}

async function getAuditLog(limit = 100) {
  const docs = await AuditLog.find().sort({ timestamp: -1 }).limit(limit).lean();
  return docs.map(d => ({ ...d, id: d._id.toString() }));
}

async function clearLogs() {
  await AuditLog.deleteMany({});
  return { message: 'All logs deleted successfully' };
}

// ══════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════

module.exports = {
  connectDB,
  getDb,
  calculateCharges,
  getAllFlats, getFlatById, updateFlat,
  initializeMonthPayments, getPaymentsForMonth,
  markPaymentPaid, markPaymentUnpaid, updatePayment,
  getPaymentHistoryForFlat,
  getExpensesForMonth, addExpense, deleteExpense,
  getMonthlySummary, getDashboardData, getReportData, updateMonthlySummary, setOpeningBalance,
  getArrearsForFlats, getArrearsSummaryByFlat, getTotalArrears,
  getUserByUsername, getUserById, getAllUsers, createUser, updateUser,
  changePassword, updateLastLogin, deleteUser,
  logAction, getAuditLog, clearLogs
};
