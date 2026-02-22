/**
 * Migrate data from local SQLite (flatcare.db) to MongoDB Atlas.
 * Run: node migrate-sqlite-to-mongo.js
 */
require('dotenv').config();
const Database = require('better-sqlite3');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');

const SALT_ROUNDS = 12;
const DB_PATH = path.join(__dirname, 'flatcare.db');

// ── Mongoose Schemas (same as database.js) ──

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
    amount_expected: { type: Number, required: true },
    amount_paid: { type: Number, default: 0 },
    garbage_charge: { type: Number, default: 0 },
    status: { type: String, enum: ['Paid', 'Pending'], default: 'Pending' },
    date_paid: { type: String, default: null }
});
paymentSchema.index({ flat_id: 1, month: 1, year: 1 }, { unique: true });

const expenseSchema = new mongoose.Schema({
    category: { type: String, required: true },
    description: { type: String, default: '' },
    amount: { type: Number, required: true },
    date: { type: String, required: true },
    month: { type: Number, required: true },
    year: { type: Number, required: true },
    is_recurring: { type: Number, default: 0 },
    recurring_type: { type: String, default: '' },
    payment_mode: { type: String, default: 'Cash' },
    reference_id: { type: String, default: '' },
    attachment_path: { type: String, default: '' }
});

const monthlySummarySchema = new mongoose.Schema({
    month: { type: Number, required: true },
    year: { type: Number, required: true },
    opening_balance: { type: Number, default: 0 },
    total_collection: { type: Number, default: 0 },
    total_expenses: { type: Number, default: 0 },
    closing_balance: { type: Number, default: 0 }
});
monthlySummarySchema.index({ month: 1, year: 1 }, { unique: true });

const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password_hash: { type: String, required: true },
    role: { type: String, default: 'viewer' },
    display_name: { type: String, default: '' },
    email: { type: String, default: '' },
    is_active: { type: Number, default: 1 },
    created_at: { type: String, default: () => new Date().toISOString() },
    last_login: { type: String, default: null }
});

const auditLogSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    username: { type: String },
    action: { type: String, required: true },
    entity: { type: String, default: null },
    entity_id: { type: String, default: null },
    details: { type: String, default: '' },
    timestamp: { type: String, default: () => new Date().toISOString() }
});

const Flat = mongoose.model('Flat', flatSchema);
const Payment = mongoose.model('Payment', paymentSchema);
const Expense = mongoose.model('Expense', expenseSchema);
const MonthlySummary = mongoose.model('MonthlySummary', monthlySummarySchema);
const User = mongoose.model('User', userSchema);
const AuditLog = mongoose.model('AuditLog', auditLogSchema);

async function migrate() {
    // Connect to MongoDB
    const uri = process.env.MONGODB_URI;
    if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(uri);
    console.log('✅ MongoDB connected');

    // Open SQLite
    let db;
    try {
        db = new Database(DB_PATH, { readonly: true });
        console.log('✅ SQLite database opened');
    } catch (err) {
        console.error('❌ Could not open SQLite database:', err.message);
        console.log('No local SQLite data to migrate.');
        process.exit(0);
    }

    // Check what tables exist
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    console.log('SQLite tables found:', tables);

    // ── 1. Migrate Flats ──
    if (tables.includes('flats')) {
        const sqlFlats = db.prepare('SELECT * FROM flats ORDER BY id').all();
        console.log(`\n📋 Flats: ${sqlFlats.length} rows in SQLite`);

        if (sqlFlats.length > 0) {
            // Clear existing MongoDB flats and re-insert
            await Flat.deleteMany({});
            console.log('   Cleared existing MongoDB flats');

            const insertedFlats = [];
            for (const f of sqlFlats) {
                const doc = await Flat.create({
                    flat_number: f.flat_number,
                    owner_name: f.owner_name || '',
                    contact: f.contact || '',
                    status: f.status || 'Vacant'
                });
                insertedFlats.push({ sqliteId: f.id, mongoId: doc._id, flat_number: f.flat_number });
            }
            console.log(`   ✅ Migrated ${insertedFlats.length} flats`);

            // Build ID mapping: SQLite ID → MongoDB ObjectId
            const flatIdMap = {};
            for (const f of insertedFlats) {
                flatIdMap[f.sqliteId] = f.mongoId;
            }

            // ── 2. Migrate Payments ──
            if (tables.includes('payments')) {
                const sqlPayments = db.prepare('SELECT * FROM payments ORDER BY id').all();
                console.log(`\n💰 Payments: ${sqlPayments.length} rows in SQLite`);

                if (sqlPayments.length > 0) {
                    await Payment.deleteMany({});
                    let paymentCount = 0;
                    for (const p of sqlPayments) {
                        const flatMongoId = flatIdMap[p.flat_id];
                        if (!flatMongoId) {
                            console.warn(`   ⚠️ Skipped payment id=${p.id}: flat_id=${p.flat_id} not found`);
                            continue;
                        }
                        await Payment.create({
                            flat_id: flatMongoId,
                            month: p.month,
                            year: p.year,
                            amount_expected: p.amount_expected,
                            amount_paid: p.amount_paid || 0,
                            garbage_charge: p.garbage_charge || 0,
                            status: p.status || 'Pending',
                            date_paid: p.date_paid || null
                        });
                        paymentCount++;
                    }
                    console.log(`   ✅ Migrated ${paymentCount} payments`);
                }
            }
        }
    }

    // ── 3. Migrate Expenses ──
    if (tables.includes('expenses')) {
        const sqlExpenses = db.prepare('SELECT * FROM expenses ORDER BY id').all();
        console.log(`\n🧾 Expenses: ${sqlExpenses.length} rows in SQLite`);

        if (sqlExpenses.length > 0) {
            await Expense.deleteMany({});
            for (const e of sqlExpenses) {
                await Expense.create({
                    category: e.category,
                    description: e.description || '',
                    amount: e.amount,
                    date: e.date,
                    month: e.month,
                    year: e.year,
                    is_recurring: e.is_recurring || 0,
                    recurring_type: e.recurring_type || '',
                    payment_mode: e.payment_mode || 'Cash',
                    reference_id: e.reference_id || '',
                    attachment_path: e.attachment_path || ''
                });
            }
            console.log(`   ✅ Migrated ${sqlExpenses.length} expenses`);
        }
    }

    // ── 4. Migrate Monthly Summaries ──
    if (tables.includes('monthly_summaries')) {
        const sqlSummaries = db.prepare('SELECT * FROM monthly_summaries ORDER BY year, month').all();
        console.log(`\n📊 Monthly Summaries: ${sqlSummaries.length} rows in SQLite`);

        if (sqlSummaries.length > 0) {
            await MonthlySummary.deleteMany({});
            for (const s of sqlSummaries) {
                await MonthlySummary.create({
                    month: s.month,
                    year: s.year,
                    opening_balance: s.opening_balance || 0,
                    total_collection: s.total_collection || 0,
                    total_expenses: s.total_expenses || 0,
                    closing_balance: s.closing_balance || 0
                });
            }
            console.log(`   ✅ Migrated ${sqlSummaries.length} monthly summaries`);
        }
    }

    // ── 5. Migrate Users (re-hash passwords) ──
    if (tables.includes('users')) {
        const sqlUsers = db.prepare('SELECT * FROM users ORDER BY id').all();
        console.log(`\n👤 Users: ${sqlUsers.length} rows in SQLite`);

        if (sqlUsers.length > 0) {
            // Don't delete existing MongoDB users; update or create
            for (const u of sqlUsers) {
                const existing = await User.findOne({ username: u.username });
                if (existing) {
                    // Update with SQLite data but keep MongoDB password
                    existing.display_name = u.display_name || existing.display_name;
                    existing.email = u.email || existing.email;
                    existing.role = u.role || existing.role;
                    existing.is_active = u.is_active !== undefined ? u.is_active : 1;
                    await existing.save();
                    console.log(`   Updated user: ${u.username}`);
                } else {
                    // Create new - copy password hash directly
                    await User.create({
                        username: u.username,
                        password_hash: u.password_hash,
                        role: u.role || 'viewer',
                        display_name: u.display_name || '',
                        email: u.email || '',
                        is_active: u.is_active !== undefined ? u.is_active : 1,
                        created_at: u.created_at || new Date().toISOString(),
                        last_login: u.last_login || null
                    });
                    console.log(`   Created user: ${u.username}`);
                }
            }
            console.log(`   ✅ Migrated ${sqlUsers.length} users`);
        }
    }

    // ── 6. Migrate Audit Log (optional, just recent ones) ──
    if (tables.includes('audit_log')) {
        const sqlLogs = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200').all();
        console.log(`\n📝 Audit Logs: ${sqlLogs.length} recent rows in SQLite`);

        if (sqlLogs.length > 0) {
            await AuditLog.deleteMany({});
            for (const log of sqlLogs) {
                await AuditLog.create({
                    username: log.username || '',
                    action: log.action,
                    entity: log.entity || null,
                    entity_id: log.entity_id ? String(log.entity_id) : null,
                    details: log.details || '',
                    timestamp: log.timestamp || new Date().toISOString()
                });
            }
            console.log(`   ✅ Migrated ${sqlLogs.length} audit log entries`);
        }
    }

    // ── Summary ──
    console.log('\n══════════════════════════════════════════');
    console.log('✅ Migration complete!');
    const flatCount = await Flat.countDocuments();
    const paymentCount = await Payment.countDocuments();
    const expenseCount = await Expense.countDocuments();
    const summaryCount = await MonthlySummary.countDocuments();
    const userCount = await User.countDocuments();
    console.log(`   Flats: ${flatCount}`);
    console.log(`   Payments: ${paymentCount}`);
    console.log(`   Expenses: ${expenseCount}`);
    console.log(`   Monthly Summaries: ${summaryCount}`);
    console.log(`   Users: ${userCount}`);
    console.log('══════════════════════════════════════════');

    db.close();
    process.exit(0);
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
