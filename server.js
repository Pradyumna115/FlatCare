require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const multer = require('multer');
const nodemailer = require('nodemailer');
const { MongoStore } = require('connect-mongo');
const db = require('./database');
const { authenticate, requireAuth, requireRole } = require('./auth');
const { syncMonthlyExcel, generateExcelBuffer } = require('./excel-sync');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Multer setup for expense attachments ──
const storage = multer.memoryStorage(); // Use memory storage to store files as Base64 in MongoDB

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const allowed = ['.jpg', '.jpeg', '.png', '.pdf', '.webp'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) cb(null, true);
        else cb(new Error('Only JPG, PNG, PDF, WEBP files allowed'));
    }
});

// ── Nodemailer transporter ──
const smtpPort = parseInt(process.env.SMTP_PORT || '465');
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

// Verify SMTP connection on startup
transporter.verify().then(() => {
    console.log('✅ SMTP connection verified');
}).catch(err => {
    console.error('❌ SMTP connection failed:', err.message);
});

// ── OTP Store (in-memory with TTL) ──
const otpStore = new Map();
const OTP_TTL = 5 * 60 * 1000; // 5 minutes

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function storeOTP(username, otp) {
    otpStore.set(username, { otp, expiresAt: Date.now() + OTP_TTL });
    // Auto-cleanup
    setTimeout(() => otpStore.delete(username), OTP_TTL);
}

function verifyOTP(username, otp) {
    const entry = otpStore.get(username);
    if (!entry) return { valid: false, reason: 'OTP expired or not found' };
    if (Date.now() > entry.expiresAt) {
        otpStore.delete(username);
        return { valid: false, reason: 'OTP expired' };
    }
    if (entry.otp !== otp) return { valid: false, reason: 'Invalid OTP' };
    otpStore.delete(username);
    return { valid: true };
}

function getOTPEmailRecipients(user) {
    // Admin always sends to these two addresses
    if (user.role === 'admin') {
        return ['tgmurali.kaswa@gmail.com', 'pradyumnatg115@gmail.com'];
    }
    // Other users: send to their registered email (if present)
    if (user.email) return [user.email];
    return [];
}

function maskEmail(email) {
    const [name, domain] = email.split('@');
    const masked = name[0] + '***' + name[name.length - 1];
    return masked + '@' + domain;
}

async function sendOTPEmail(recipients, otp, displayName) {
    const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:480px;margin:0 auto;">
      <div style="background:#0ea5e9;color:#fff;padding:20px 30px;border-radius:8px 8px 0 0;text-align:center;">
        <h1 style="margin:0;font-size:22px;">FlatCare Login OTP</h1>
      </div>
      <div style="background:#f8fafc;padding:30px;border:1px solid #e2e8f0;border-top:none;text-align:center;">
        <p style="color:#0f172a;font-size:15px;">Hello <strong>${displayName}</strong>,</p>
        <p style="color:#64748b;font-size:14px;">Your one-time verification code is:</p>
        <div style="background:#0f172a;color:#0ea5e9;font-size:36px;font-weight:700;letter-spacing:8px;padding:18px 30px;border-radius:8px;display:inline-block;margin:15px 0;">
          ${otp}
        </div>
        <p style="color:#94a3b8;font-size:12px;margin-top:15px;">This code expires in <strong>5 minutes</strong>. Do not share it with anyone.</p>
      </div>
      <div style="background:#0f172a;color:#94a3b8;padding:12px 30px;border-radius:0 0 8px 8px;font-size:11px;text-align:center;">
        FlatCare • Apartment Management System
      </div>
    </div>`;

    for (const to of recipients) {
        await transporter.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to,
            subject: `FlatCare Login OTP: ${otp}`,
            html,
        });
    }
}

// ── Middleware ──
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'flatcare-secret',
    resave: false,
    saveUninitialized: false,
    store: process.env.MONGODB_URI ? MongoStore.create({ mongoUrl: process.env.MONGODB_URI }) : undefined,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ── Public routes (before auth) ──
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));

app.get('/favicon.svg', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'favicon.svg'));
});
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/', (req, res) => {
    if (req.session && req.session.user) return res.redirect('/dashboard.html');
    return res.redirect('/login.html');
});

// ── Auth routes ──
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await authenticate(username, password);
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        const recipients = getOTPEmailRecipients(user);

        // If user has no email (and not admin), skip OTP
        if (recipients.length === 0) {
            req.session.user = user;
            return res.json({ success: true, user });
        }

        // Generate & send OTP
        const otp = generateOTP();
        storeOTP(username, otp);

        try {
            await sendOTPEmail(recipients, otp, user.display_name || user.username);
        } catch (emailErr) {
            console.error('OTP email failed:', emailErr.message);
            // Fallback: log in without OTP if email fails
            req.session.user = user;
            return res.json({ success: true, user, otpSkipped: true, reason: 'Email service unavailable' });
        }

        const masked = recipients.map(maskEmail).join(', ');
        res.json({ otpRequired: true, username, maskedEmail: masked });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error during login' });
    }
});

app.post('/api/verify-otp', async (req, res) => {
    try {
        const { username, otp } = req.body;
        if (!username || !otp) return res.status(400).json({ error: 'Username and OTP required' });

        const result = verifyOTP(username, otp.toString().trim());
        if (!result.valid) {
            return res.status(401).json({ error: result.reason });
        }

        // OTP valid — create session
        const dbModule = require('./database');
        const fullUser = await dbModule.getUserByUsername(username);
        if (!fullUser) return res.status(401).json({ error: 'User not found' });

        await dbModule.updateLastLogin(fullUser.id);
        const sessionUser = {
            id: fullUser.id,
            username: fullUser.username,
            role: fullUser.role,
            display_name: fullUser.display_name,
            email: fullUser.email
        };
        req.session.user = sessionUser;
        res.json({ success: true, user: sessionUser });
    } catch (err) {
        console.error('OTP verify error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/resend-otp', async (req, res) => {
    try {
        const { username } = req.body;
        if (!username) return res.status(400).json({ error: 'Username required' });

        const user = await authenticate(username, req.body.password);
        // For resend, we just regenerate if there's an existing entry or the user exists
        const dbModule = require('./database');
        const dbUser = await dbModule.getUserByUsername(username);
        if (!dbUser || !dbUser.is_active) return res.status(401).json({ error: 'Invalid user' });

        const userInfo = {
            id: dbUser.id, username: dbUser.username, role: dbUser.role,
            display_name: dbUser.display_name, email: dbUser.email
        };
        const recipients = getOTPEmailRecipients(userInfo);
        if (recipients.length === 0) return res.status(400).json({ error: 'No email configured' });

        const otp = generateOTP();
        storeOTP(username, otp);
        await sendOTPEmail(recipients, otp, dbUser.display_name || dbUser.username);

        res.json({ success: true, message: 'OTP resent' });
    } catch (err) {
        console.error('Resend OTP error:', err);
        res.status(500).json({ error: 'Failed to resend OTP' });
    }
});


app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/check-auth', (req, res) => {
    if (req.session && req.session.user) return res.json({ authenticated: true, user: req.session.user });
    res.json({ authenticated: false });
});

// ── Protect all remaining routes ──
app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));
// app.use('/uploads', express.static(uploadDir)); // Removed for Vercel compatibility (using Base64 in MongoDB)

// ── Current user ──
app.get('/api/me', (req, res) => {
    res.json(req.session.user);
});

// ══════════════════════════════════════════
//  FLAT ROUTES
// ══════════════════════════════════════════

app.get('/api/flats', async (req, res) => {
    try {
        const { floor, status, search } = req.query;
        let flats = await db.getAllFlats();

        // Filter by floor
        if (floor && floor !== 'all') {
            flats = flats.filter(f => f.flat_number.startsWith(floor));
        }
        // Filter by status
        if (status && status !== 'all') {
            flats = flats.filter(f => f.status === status);
        }
        // Search by name or flat number
        if (search) {
            const q = search.toLowerCase();
            flats = flats.filter(f =>
                f.flat_number.toLowerCase().includes(q) ||
                (f.owner_name && f.owner_name.toLowerCase().includes(q)) ||
                (f.contact && f.contact.toLowerCase().includes(q))
            );
        }

        // Add computed maintenance/garbage fields
        flats = flats.map(f => {
            const charges = db.calculateCharges(f.status);
            return {
                ...f,
                maintenance_charge: charges.maintenance_charge,
                garbage_charge: charges.garbage_charge,
            };
        });

        res.json(flats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/flats/:id', async (req, res) => {
    try {
        const { owner_name, contact, status } = req.body;
        const flat = await db.updateFlat(req.params.id, { owner_name, contact, status });
        await db.logAction(req.session.user.id, req.session.user.username, 'UPDATE', 'flat', req.params.id, `Updated flat ${flat.flat_number}`);

        // Sync Excel for current month
        const now = new Date();
        syncMonthlyExcel(now.getMonth() + 1, now.getFullYear()).catch(() => { });

        const charges = db.calculateCharges(flat.status);
        res.json({
            ...flat,
            maintenance_charge: charges.maintenance_charge,
            garbage_charge: charges.garbage_charge,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Payment history for a specific flat
app.get('/api/flats/:id/payment-history', async (req, res) => {
    try {
        const history = await db.getPaymentHistoryForFlat(req.params.id);
        res.json(history);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ══════════════════════════════════════════
//  PAYMENT ROUTES
// ══════════════════════════════════════════

app.post('/api/months/initialize', async (req, res) => {
    try {
        const { month, year } = req.query;
        if (!month || !year) return res.status(400).json({ error: 'month and year required' });
        const result = await db.initializeMonthPayments(parseInt(month), parseInt(year));
        await db.logAction(req.session.user.id, req.session.user.username, 'INITIALIZE', 'month', null, `Initialized ${month}/${year}`);

        syncMonthlyExcel(parseInt(month), parseInt(year)).catch(() => { });

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/payments', async (req, res) => {
    try {
        const { month, year } = req.query;
        if (!month || !year) return res.status(400).json({ error: 'month and year required' });

        const payments = await db.getPaymentsForMonth(parseInt(month), parseInt(year));

        let total_received = 0;
        let total_pending = 0;
        for (const p of payments) {
            total_received += p.amount_paid || 0;
            if (p.status === 'Pending') {
                const totalDue = (p.amount_expected || 0) + (p.garbage_charge || 0) + (p.previous_arrears || 0) + (p.extra_payment || 0);
                const pending = totalDue - (p.amount_paid || 0);
                total_pending += pending > 0 ? pending : 0;
            }
        }

        res.json({ payments, total_received, total_pending });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Arrears list for dropdowns or modals
app.get('/api/arrears/summary', async (req, res) => {
    try {
        const { flat_id } = req.query;
        if (!flat_id) return res.status(400).json({ error: 'flat_id required' });

        const history = await db.getPaymentHistoryForFlat(flat_id);
        const arrears = history.filter(p => p.status === 'Pending').map(p => ({
            month: p.month,
            year: p.year,
            amount: (p.amount_expected || 0) + (p.garbage_charge || 0) + (p.previous_arrears || 0) - (p.amount_paid || 0)
        }));
        res.json(arrears);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Generic PUT for payment updates
app.put('/api/payments/:id', async (req, res) => {
    try {
        const { amount_paid, extra_payment, status, date_paid } = req.body;
        const payment = await db.updatePayment(req.params.id, {
            amount_paid: amount_paid !== undefined ? parseFloat(amount_paid) : undefined,
            extra_payment: extra_payment !== undefined ? parseFloat(extra_payment) : undefined,
            status,
            date_paid
        });
        if (!payment) return res.status(404).json({ error: 'Payment not found' });
        await db.logAction(req.session.user.id, req.session.user.username, 'UPDATE_PAYMENT', 'payment', req.params.id, `Payment ${status}`);

        syncMonthlyExcel(payment.month, payment.year).catch(() => { });

        res.json(payment);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Legacy routes
app.put('/api/payments/:id/pay', async (req, res) => {
    try {
        const payment = await db.markPaymentPaid(req.params.id);
        if (!payment) return res.status(404).json({ error: 'Payment not found' });
        await db.logAction(req.session.user.id, req.session.user.username, 'PAY', 'payment', req.params.id, 'Marked as Paid');
        syncMonthlyExcel(payment.month, payment.year).catch(() => { });
        res.json(payment);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/payments/:id/unpay', async (req, res) => {
    try {
        const payment = await db.markPaymentUnpaid(req.params.id);
        if (!payment) return res.status(404).json({ error: 'Payment not found' });
        await db.logAction(req.session.user.id, req.session.user.username, 'UNPAY', 'payment', req.params.id, 'Marked as Pending');
        syncMonthlyExcel(payment.month, payment.year).catch(() => { });
        res.json(payment);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ══════════════════════════════════════════
//  EXPENSE ROUTES
// ══════════════════════════════════════════

app.get('/api/expenses', async (req, res) => {
    try {
        const { month, year } = req.query;
        if (!month || !year) return res.status(400).json({ error: 'month and year required' });
        const expenses = await db.getExpensesForMonth(parseInt(month), parseInt(year));
        res.json(expenses);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/expenses', upload.single('attachment'), async (req, res) => {
    try {
        const { category, description, amount, date, month, year, is_recurring, recurring_type, payment_mode, reference_id } = req.body;
        if (!category || !amount || !date || !month || !year) {
            return res.status(400).json({ error: 'category, amount, date, month, year required' });
        }

        let attachment_path = '';
        if (req.file && req.file.buffer) {
            const b64 = req.file.buffer.toString('base64');
            attachment_path = `data:${req.file.mimetype};base64,${b64}`;
        }

        const expense = await db.addExpense({
            category, description: description || '', amount: parseFloat(amount),
            date, month: parseInt(month), year: parseInt(year),
            is_recurring: is_recurring ? 1 : 0, recurring_type: recurring_type || '',
            payment_mode: payment_mode || 'Cash',
            reference_id: reference_id || '',
            attachment_path
        });
        await db.logAction(req.session.user.id, req.session.user.username, 'ADD_EXPENSE', 'expense', expense.id, `${category}: ₹${amount}`);

        syncMonthlyExcel(parseInt(month), parseInt(year)).catch(() => { });

        res.json(expense);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/expenses/:id', async (req, res) => {
    try {
        const expense = await db.deleteExpense(req.params.id);
        if (!expense) return res.status(404).json({ error: 'Expense not found' });
        await db.logAction(req.session.user.id, req.session.user.username, 'DELETE_EXPENSE', 'expense', req.params.id, `${expense.category}: ₹${expense.amount}`);

        syncMonthlyExcel(expense.month, expense.year).catch(() => { });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ══════════════════════════════════════════
//  DASHBOARD ROUTE
// ══════════════════════════════════════════

// Set/Update Opening Balance (Admin only)
app.put('/api/monthly-summary/opening-balance', requireRole('admin'), async (req, res) => {
    try {
        const { month, year, amount, balance_date } = req.body;
        if (!month || !year || amount === undefined) {
            return res.status(400).json({ error: 'month, year, and amount are required' });
        }
        const result = await db.setOpeningBalance(parseInt(month), parseInt(year), parseFloat(amount), balance_date || '');
        await db.logAction(req.session.user.id, req.session.user.username, 'UPDATE', 'monthly_summary', null, `Set opening balance for ${month}/${year}: ₹${amount}`);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/dashboard', async (req, res) => {
    try {
        const { month, year } = req.query;
        if (!month || !year) return res.status(400).json({ error: 'month and year required' });
        const data = await db.getDashboardData(parseInt(month), parseInt(year));
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ══════════════════════════════════════════
//  ARREARS / DUES ROUTES
// ══════════════════════════════════════════

app.get('/api/arrears', async (req, res) => {
    try {
        const { month, year } = req.query;
        if (!month || !year) return res.status(400).json({ error: 'month and year required' });
        const arrearsByFlat = await db.getArrearsSummaryByFlat(parseInt(month), parseInt(year));
        const arrearsDetail = await db.getArrearsForFlats(parseInt(month), parseInt(year));
        const totalArrears = await db.getTotalArrears(parseInt(month), parseInt(year));
        res.json({ total_arrears: totalArrears, arrears_by_flat: arrearsByFlat, arrears_detail: arrearsDetail });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ══════════════════════════════════════════
//  USER MANAGEMENT ROUTES (Admin only)
// ══════════════════════════════════════════

app.get('/api/users', requireRole('admin'), async (req, res) => {
    try {
        res.json(await db.getAllUsers());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/users', requireRole('admin'), async (req, res) => {
    try {
        const { username, password, role, display_name, email } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        const result = await db.createUser({ username, password, role, display_name, email });
        if (result.error) return res.status(409).json(result);
        await db.logAction(req.session.user.id, req.session.user.username, 'CREATE_USER', 'user', result.id, `Created user ${username} (${role})`);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/users/:id', requireRole('admin'), async (req, res) => {
    try {
        const { username, display_name, email, role, is_active } = req.body;
        const user = await db.updateUser(req.params.id, { username, display_name, email, role, is_active });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.error) return res.status(409).json(user);
        await db.logAction(req.session.user.id, req.session.user.username, 'UPDATE_USER', 'user', req.params.id, `Updated user ${user.username}`);
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/users/:id/password', requireRole('admin'), async (req, res) => {
    try {
        const { password } = req.body;
        if (!password || password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        await db.changePassword(req.params.id, password);
        await db.logAction(req.session.user.id, req.session.user.username, 'CHANGE_PASSWORD', 'user', req.params.id, 'Password changed');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/users/:id', requireRole('admin'), async (req, res) => {
    try {
        if (req.params.id === req.session.user.id) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }
        const result = await db.deleteUser(req.params.id);
        if (!result) return res.status(404).json({ error: 'User not found' });
        await db.logAction(req.session.user.id, req.session.user.username, 'DELETE_USER', 'user', req.params.id, result.details);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Finalize Month
app.post('/api/months/finalize', requireRole('admin'), async (req, res) => {
    try {
        const { month, year } = req.body;
        if (!month || !year) return res.status(400).json({ error: 'month and year required' });

        await db.updateMonthlySummary(parseInt(month), parseInt(year));
        await syncMonthlyExcel(parseInt(month), parseInt(year));

        res.json({ success: true, message: 'Month summary recalculated and Excel synced' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ══════════════════════════════════════════
//  AUDIT LOG ROUTE
// ══════════════════════════════════════════

app.get('/api/audit-log', requireRole('admin'), async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        res.json(await db.getAuditLog(limit));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ══════════════════════════════════════════
//  REPORT ROUTES
// ══════════════════════════════════════════

app.get('/api/reports', async (req, res) => {
    try {
        const { month, year } = req.query;
        if (!month || !year) return res.status(400).json({ error: 'month and year required' });
        const report = await db.getReportData(parseInt(month), parseInt(year));
        res.json(report);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Chart data endpoint
app.get('/api/reports/chart-data', async (req, res) => {
    try {
        const { month, year } = req.query;
        if (!month || !year) return res.status(400).json({ error: 'month and year required' });
        const report = await db.getReportData(parseInt(month), parseInt(year));

        res.json({
            collection_vs_expenses: {
                labels: ['Received', 'Expenses', 'Pending'],
                data: [report.total_received, report.total_expenses, report.total_pending],
            },
            category_breakdown: report.category_breakdown,
            paid_vs_pending: {
                paid: report.payments.filter(p => p.status === 'Paid').length,
                pending: report.payments.filter(p => p.status === 'Pending').length,
            },
            floor_wise: report.floor_wise,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// CSV Export
app.get('/api/reports/csv', async (req, res) => {
    try {
        const { month, year } = req.query;
        if (!month || !year) return res.status(400).json({ error: 'month and year required' });

        const report = await db.getReportData(parseInt(month), parseInt(year));
        const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];
        const monthName = monthNames[parseInt(month)];

        let csv = `FlatCare - Monthly Financial Report\n`;
        csv += `Month: ${monthName} ${year}\n\n`;
        csv += `FINANCIAL SUMMARY\n`;
        csv += `Opening Balance,${report.opening_balance}\n`;
        csv += `Total Expected Collection,${report.total_expected}\n`;
        csv += `Total Received,${report.total_received}\n`;
        csv += `Total Pending,${report.total_pending}\n`;
        csv += `Total Garbage Charges,${report.total_garbage}\n`;
        csv += `Total Expenses,${report.total_expenses}\n`;
        csv += `Closing Balance,${report.closing_balance}\n`;
        csv += `Total Arrears (Previous Months),${report.total_arrears}\n\n`;

        csv += `EXPENSE BREAKDOWN\n`;
        csv += `Category,Amount\n`;
        for (const [cat, amt] of Object.entries(report.category_breakdown)) {
            csv += `${cat},${amt}\n`;
        }

        csv += `\nEXPENSE DETAILS\n`;
        csv += `Date,Category,Description,Amount,Payment Mode,Reference\n`;
        for (const exp of report.expenses) {
            csv += `${exp.date},"${exp.category}","${exp.description}",${exp.amount},"${exp.payment_mode || 'Cash'}","${exp.reference_id || ''}"\n`;
        }

        csv += `\nPAYMENT STATUS\n`;
        csv += `Flat,Owner,Expected,Paid,Status,Date Paid\n`;
        for (const p of report.payments) {
            csv += `${p.flat_number},"${p.owner_name}",${p.amount_expected},${p.amount_paid},${p.status},${p.date_paid || ''}\n`;
        }

        csv += `\nPENDING FLATS\n`;
        csv += `Flat,Owner,Amount\n`;
        for (const pf of report.pending_flats) {
            csv += `${pf.flat_number},"${pf.owner_name}",${pf.amount_expected}\n`;
        }

        csv += `\nARREARS / DUES (Previous Months)\n`;
        csv += `Flat,Owner,Total Arrears,Months Pending\n`;
        if (report.arrears_by_flat && report.arrears_by_flat.length > 0) {
            for (const af of report.arrears_by_flat) {
                csv += `${af.flat_number},"${af.owner_name}",${af.total_arrears},${af.months_pending}\n`;
            }
        }
        csv += `Total Arrears,${report.total_arrears}\n`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=FlatCare_Report_${monthName}_${year}.csv`);
        res.send(csv);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Excel Export
app.get('/api/reports/excel', async (req, res) => {
    try {
        const { month, year } = req.query;
        if (!month || !year) return res.status(400).json({ error: 'month and year required' });

        const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];
        const monthName = monthNames[parseInt(month)];

        const buffer = await generateExcelBuffer(parseInt(month), parseInt(year));
        if (!buffer) return res.status(500).json({ error: 'Failed to generate Excel' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=FlatCare_Report_${monthName}_${year}.xlsx`);
        res.send(buffer);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Styled PDF Export
app.get('/api/reports/pdf', async (req, res) => {
    try {
        const { month, year } = req.query;
        if (!month || !year) return res.status(400).json({ error: 'month and year required' });

        const report = await db.getReportData(parseInt(month), parseInt(year));
        const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];
        const monthName = monthNames[parseInt(month)];

        const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=FlatCare_Report_${monthName}_${year}.pdf`);
        doc.pipe(res);

        // ── Branded Header ──
        doc.fillColor('#0f172a').fontSize(24).font('Helvetica-Bold').text('Flat Care', 0, 40, { align: 'center', width: 595.28 });
        doc.fontSize(16).font('Helvetica-Bold').text('Aditya Residency Welfare Association', 0, 70, { align: 'center', width: 595.28 });
        doc.fontSize(12).font('Helvetica').text('Commercial Tax Colony\nKothapet, Hyderabad', 0, 95, { align: 'center', width: 595.28 });

        doc.moveTo(50, 135).lineTo(545, 135).lineWidth(2).strokeColor('#0ea5e9').stroke();

        doc.fontSize(16).font('Helvetica-Bold').text(`Monthly Report — ${monthName} ${year}`, 0, 150, { align: 'center', width: 595.28 });
        doc.fontSize(10).font('Helvetica').fillColor('#64748b').text(`Date Generated: ${new Date().toLocaleString('en-IN')}`, 0, 175, { align: 'center', width: 595.28 });

        const y0 = 210;
        doc.y = y0;

        // ── Highlighted Summary Box ──
        let sy = doc.y;
        const summaryBoxHeight = 160;
        doc.rect(50, sy, 495, summaryBoxHeight).lineWidth(1).strokeColor('#94a3b8').stroke();
        sy += 15;

        doc.fontSize(14).font('Helvetica-Bold').fillColor('#0ea5e9').text('Financial Summary', 65, sy);
        sy += 25;

        doc.fontSize(11).fillColor('#0f172a');
        const summaryItems = [
            ['Opening Balance:', `Rs. ${(report.opening_balance || 0).toLocaleString('en-IN')}`],
            ['Total Expected Collection:', `Rs. ${(report.total_expected || 0).toLocaleString('en-IN')}`],
            ['Total Received:', `Rs. ${(report.total_received || 0).toLocaleString('en-IN')}`],
            ['Total Pending:', `Rs. ${(report.total_pending || 0).toLocaleString('en-IN')}`],
            ['Total Garbage Charges:', `Rs. ${(report.total_garbage || 0).toLocaleString('en-IN')}`],
            ['Total Expenses:', `Rs. ${(report.total_expenses || 0).toLocaleString('en-IN')}`],
            ['Total Arrears (Previous):', `Rs. ${(report.total_arrears || 0).toLocaleString('en-IN')}`],
            ['Closing Balance:', `Rs. ${(report.closing_balance || 0).toLocaleString('en-IN')}`],
        ];

        for (const [label, value] of summaryItems) {
            const isBold = label === 'Closing Balance:';
            doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica');
            doc.text(label, 70, sy, { width: 250 });
            doc.text(value, 320, sy, { width: 200, align: 'right' });
            sy += 16;
        }
        doc.y = sy + 30;

        // ── Expense Breakdown ──
        doc.fontSize(14).font('Helvetica-Bold').fillColor('#0ea5e9').text('Expense Breakdown');
        doc.moveDown(0.5);
        doc.fontSize(10).font('Helvetica').fillColor('#0f172a');

        const catEntries = Object.entries(report.category_breakdown);
        if (catEntries.length === 0) {
            doc.text('No expenses recorded.');
        } else {
            let ey = doc.y;
            doc.rect(50, ey - 2, 495, 16).fill('#e2e8f0');
            doc.fillColor('#0f172a').font('Helvetica-Bold');
            doc.text('Category', 60, ey, { width: 300 });
            doc.text('Amount', 360, ey, { width: 150, align: 'right' });
            ey += 18;
            doc.font('Helvetica');
            for (const [cat, amt] of catEntries.sort((a, b) => b[1] - a[1])) {
                doc.text(cat, 60, ey, { width: 300 });
                doc.text(`Rs. ${amt.toLocaleString('en-IN')}`, 360, ey, { width: 150, align: 'right' });
                ey += 16;
            }
            doc.rect(50, ey - 2, 495, 16).fill('#f1f5f9');
            doc.fillColor('#0f172a').font('Helvetica-Bold');
            doc.text('Total', 60, ey, { width: 300 });
            doc.text(`Rs. ${(report.total_expenses || 0).toLocaleString('en-IN')}`, 360, ey, { width: 150, align: 'right' });
            doc.y = ey + 25;
        }

        // ── Payment Status Table ──
        if (doc.y > 600) doc.addPage();
        doc.fontSize(14).font('Helvetica-Bold').fillColor('#0ea5e9').text('Payment Status');
        doc.moveDown(0.5);
        doc.fontSize(9).font('Helvetica').fillColor('#0f172a');

        let py = doc.y;
        doc.rect(50, py - 2, 495, 16).fill('#e2e8f0');
        doc.fillColor('#0f172a').font('Helvetica-Bold');
        doc.text('#', 55, py, { width: 20 });
        doc.text('Flat', 75, py, { width: 50 });
        doc.text('Owner', 130, py, { width: 120 });
        doc.text('Expected', 260, py, { width: 70, align: 'right' });
        doc.text('Paid', 340, py, { width: 70, align: 'right' });
        doc.text('Status', 420, py, { width: 50 });
        doc.text('Date', 475, py, { width: 70 });
        py += 16;
        doc.font('Helvetica').fontSize(8);

        report.payments.forEach((p, i) => {
            if (py > 750) { doc.addPage(); py = 50; }
            if (i % 2 === 0) {
                doc.rect(50, py - 2, 495, 14).fill('#f8fafc');
                doc.fillColor('#0f172a');
            }
            doc.text(`${i + 1}`, 55, py, { width: 20 });
            doc.text(p.flat_number, 75, py, { width: 50 });
            doc.text((p.owner_name || '-').substring(0, 18), 130, py, { width: 120 });
            doc.text(`Rs.${(p.amount_expected || 0).toLocaleString('en-IN')}`, 260, py, { width: 70, align: 'right' });
            doc.text(`Rs.${(p.amount_paid || 0).toLocaleString('en-IN')}`, 340, py, { width: 70, align: 'right' });
            doc.fillColor(p.status === 'Paid' ? '#16a34a' : '#dc2626');
            doc.text(p.status, 420, py, { width: 50 });
            doc.fillColor('#0f172a');
            doc.text(p.date_paid || '-', 475, py, { width: 70 });
            py += 14;
        });
        doc.y = py + 10;

        // ── Pending Payments ──
        if (doc.y > 650) doc.addPage();
        doc.fontSize(14).font('Helvetica-Bold').fillColor('#0ea5e9').text('Pending Payments');
        doc.moveDown(0.5);
        doc.fontSize(10).font('Helvetica').fillColor('#0f172a');

        if (report.pending_flats.length === 0) {
            doc.text('All payments collected!');
        } else {
            let pfy = doc.y;
            doc.rect(50, pfy - 2, 495, 16).fill('#e2e8f0');
            doc.fillColor('#0f172a').font('Helvetica-Bold');
            doc.text('Flat', 60, pfy, { width: 100 });
            doc.text('Owner', 160, pfy, { width: 200 });
            doc.text('Amount', 360, pfy, { width: 150, align: 'right' });
            pfy += 18;
            doc.font('Helvetica');
            for (const pf of report.pending_flats) {
                if (pfy > 750) { doc.addPage(); pfy = 50; }
                doc.text(pf.flat_number, 60, pfy, { width: 100 });
                doc.text(pf.owner_name || 'N/A', 160, pfy, { width: 200 });
                doc.text(`Rs. ${pf.amount_expected.toLocaleString('en-IN')}`, 360, pfy, { width: 150, align: 'right' });
                pfy += 16;
            }
            doc.y = pfy + 10;
        }

        // ── Arrears ──
        if (doc.y > 650) doc.addPage();
        doc.fontSize(14).font('Helvetica-Bold').fillColor('#0ea5e9').text('Arrears / Dues (Previous Months)');
        doc.moveDown(0.5);
        doc.fontSize(10).font('Helvetica').fillColor('#0f172a');

        if (!report.arrears_by_flat || report.arrears_by_flat.length === 0) {
            doc.text('No arrears from previous months.');
        } else {
            let ay = doc.y;
            doc.rect(50, ay - 2, 495, 16).fill('#e2e8f0');
            doc.fillColor('#0f172a').font('Helvetica-Bold');
            doc.text('Flat', 60, ay, { width: 80 });
            doc.text('Owner', 140, ay, { width: 170 });
            doc.text('Arrears', 310, ay, { width: 100, align: 'right' });
            doc.text('Months', 420, ay, { width: 80, align: 'right' });
            ay += 18;
            doc.font('Helvetica');
            for (const af of report.arrears_by_flat) {
                if (ay > 750) { doc.addPage(); ay = 50; }
                doc.text(af.flat_number, 60, ay, { width: 80 });
                doc.text(af.owner_name || 'N/A', 140, ay, { width: 170 });
                doc.text(`Rs. ${af.total_arrears.toLocaleString('en-IN')}`, 310, ay, { width: 100, align: 'right' });
                doc.text(`${af.months_pending}`, 420, ay, { width: 80, align: 'right' });
                ay += 16;
            }
            doc.rect(50, ay - 2, 495, 16).fill('#fef2f2');
            doc.fillColor('#ef4444').font('Helvetica-Bold');
            doc.text('Grand Total Arrears', 60, ay, { width: 250 });
            doc.text(`Rs. ${(report.total_arrears || 0).toLocaleString('en-IN')}`, 310, ay, { width: 100, align: 'right' });
            doc.y = ay + 25;
        }

        // ── Flat Stats ──
        doc.moveDown();
        doc.fillColor('#0f172a');
        doc.fontSize(14).font('Helvetica-Bold').fillColor('#0ea5e9').text('Flat Statistics');
        doc.moveDown(0.5);
        doc.fontSize(10).font('Helvetica').fillColor('#0f172a');
        doc.text(`Total Flats: ${report.flat_stats.total}`);
        doc.text(`Occupied: ${report.flat_stats.occupied} (Maintenance: Rs.1,500 + Garbage: Rs.100 = Rs.1,600)`);
        doc.text(`Vacant: ${report.flat_stats.vacant} (Maintenance: Rs.1,500 + Garbage: Rs.0 = Rs.1,500)`);

        // ── Page Numbers ──
        const pageCount = doc.bufferedPageRange().count;
        for (let i = 0; i < pageCount; i++) {
            doc.switchToPage(i);
            doc.fontSize(8).fillColor('#94a3b8');
            doc.text(
                `Generated by Flat Care Management System | Page ${i + 1} of ${pageCount}`,
                50, 780, { align: 'center', width: 495 }
            );
        }

        doc.end();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ══════════════════════════════════════════
//  EMAIL AUTOMATION
// ══════════════════════════════════════════

app.post('/api/reports/send-email', async (req, res) => {
    try {
        const { month, year } = req.body;
        if (!month || !year) return res.status(400).json({ error: 'month and year required' });

        const m = parseInt(month);
        const y = parseInt(year);
        const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];
        const monthName = monthNames[m];

        const report = await db.getReportData(m, y);

        // Generate Excel
        const excelBuffer = await generateExcelBuffer(m, y);

        // Generate PDF into buffer (full comprehensive report — same as download PDF)
        const pdfBuffer = await new Promise((resolve, reject) => {
            const chunks = [];
            const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            // ── Branded Header ──
            doc.fillColor('#0f172a').fontSize(24).font('Helvetica-Bold').text('Flat Care', 0, 40, { align: 'center', width: 595.28 });
            doc.fontSize(16).font('Helvetica-Bold').text('Aditya Residency Welfare Association', 0, 70, { align: 'center', width: 595.28 });
            doc.fontSize(12).font('Helvetica').text('Commercial Tax Colony\nKothapet, Hyderabad', 0, 95, { align: 'center', width: 595.28 });
            doc.moveTo(50, 135).lineTo(545, 135).lineWidth(2).strokeColor('#0ea5e9').stroke();
            doc.fontSize(16).font('Helvetica-Bold').text(`Monthly Report — ${monthName} ${y}`, 0, 150, { align: 'center', width: 595.28 });
            doc.fontSize(10).font('Helvetica').fillColor('#64748b').text(`Date Generated: ${new Date().toLocaleString('en-IN')}`, 0, 175, { align: 'center', width: 595.28 });

            doc.y = 210;

            // ── Financial Summary Box ──
            let sy = doc.y;
            const summaryBoxHeight = 160;
            doc.rect(50, sy, 495, summaryBoxHeight).lineWidth(1).strokeColor('#94a3b8').stroke();
            sy += 15;
            doc.fontSize(14).font('Helvetica-Bold').fillColor('#0ea5e9').text('Financial Summary', 65, sy);
            sy += 25;
            doc.fontSize(11).fillColor('#0f172a');
            const summaryItems = [
                ['Opening Balance:', `Rs. ${(report.opening_balance || 0).toLocaleString('en-IN')}`],
                ['Total Expected Collection:', `Rs. ${(report.total_expected || 0).toLocaleString('en-IN')}`],
                ['Total Received:', `Rs. ${(report.total_received || 0).toLocaleString('en-IN')}`],
                ['Total Pending:', `Rs. ${(report.total_pending || 0).toLocaleString('en-IN')}`],
                ['Total Garbage Charges:', `Rs. ${(report.total_garbage || 0).toLocaleString('en-IN')}`],
                ['Total Expenses:', `Rs. ${(report.total_expenses || 0).toLocaleString('en-IN')}`],
                ['Total Arrears (Previous):', `Rs. ${(report.total_arrears || 0).toLocaleString('en-IN')}`],
                ['Closing Balance:', `Rs. ${(report.closing_balance || 0).toLocaleString('en-IN')}`],
            ];
            for (const [label, value] of summaryItems) {
                const isBold = label === 'Closing Balance:';
                doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica');
                doc.text(label, 70, sy, { width: 250 });
                doc.text(value, 320, sy, { width: 200, align: 'right' });
                sy += 16;
            }
            doc.y = sy + 30;

            // ── Expense Breakdown ──
            doc.fontSize(14).font('Helvetica-Bold').fillColor('#0ea5e9').text('Expense Breakdown');
            doc.moveDown(0.5);
            doc.fontSize(10).font('Helvetica').fillColor('#0f172a');
            const catEntries = Object.entries(report.category_breakdown);
            if (catEntries.length === 0) {
                doc.text('No expenses recorded.');
            } else {
                let ey = doc.y;
                doc.rect(50, ey - 2, 495, 16).fill('#e2e8f0');
                doc.fillColor('#0f172a').font('Helvetica-Bold');
                doc.text('Category', 60, ey, { width: 300 });
                doc.text('Amount', 360, ey, { width: 150, align: 'right' });
                ey += 18;
                doc.font('Helvetica');
                for (const [cat, amt] of catEntries.sort((a, b) => b[1] - a[1])) {
                    doc.text(cat, 60, ey, { width: 300 });
                    doc.text(`Rs. ${amt.toLocaleString('en-IN')}`, 360, ey, { width: 150, align: 'right' });
                    ey += 16;
                }
                doc.rect(50, ey - 2, 495, 16).fill('#f1f5f9');
                doc.fillColor('#0f172a').font('Helvetica-Bold');
                doc.text('Total', 60, ey, { width: 300 });
                doc.text(`Rs. ${(report.total_expenses || 0).toLocaleString('en-IN')}`, 360, ey, { width: 150, align: 'right' });
                doc.y = ey + 25;
            }

            // ── Payment Status Table ──
            if (doc.y > 600) doc.addPage();
            doc.fontSize(14).font('Helvetica-Bold').fillColor('#0ea5e9').text('Payment Status');
            doc.moveDown(0.5);
            doc.fontSize(9).font('Helvetica').fillColor('#0f172a');

            let py = doc.y;
            doc.rect(50, py - 2, 495, 16).fill('#e2e8f0');
            doc.fillColor('#0f172a').font('Helvetica-Bold');
            doc.text('#', 55, py, { width: 20 });
            doc.text('Flat', 75, py, { width: 50 });
            doc.text('Owner', 130, py, { width: 120 });
            doc.text('Expected', 260, py, { width: 70, align: 'right' });
            doc.text('Paid', 340, py, { width: 70, align: 'right' });
            doc.text('Status', 420, py, { width: 50 });
            doc.text('Date', 475, py, { width: 70 });
            py += 16;
            doc.font('Helvetica').fontSize(8);

            report.payments.forEach((p, i) => {
                if (py > 750) { doc.addPage(); py = 50; }
                if (i % 2 === 0) {
                    doc.rect(50, py - 2, 495, 14).fill('#f8fafc');
                    doc.fillColor('#0f172a');
                }
                doc.text(`${i + 1}`, 55, py, { width: 20 });
                doc.text(p.flat_number, 75, py, { width: 50 });
                doc.text((p.owner_name || '-').substring(0, 18), 130, py, { width: 120 });
                doc.text(`Rs.${(p.amount_expected || 0).toLocaleString('en-IN')}`, 260, py, { width: 70, align: 'right' });
                doc.text(`Rs.${(p.amount_paid || 0).toLocaleString('en-IN')}`, 340, py, { width: 70, align: 'right' });
                doc.fillColor(p.status === 'Paid' ? '#16a34a' : '#dc2626');
                doc.text(p.status, 420, py, { width: 50 });
                doc.fillColor('#0f172a');
                doc.text(p.date_paid || '-', 475, py, { width: 70 });
                py += 14;
            });
            doc.y = py + 10;

            // ── Pending Payments ──
            if (doc.y > 650) doc.addPage();
            doc.fontSize(14).font('Helvetica-Bold').fillColor('#0ea5e9').text('Pending Payments');
            doc.moveDown(0.5);
            doc.fontSize(10).font('Helvetica').fillColor('#0f172a');
            if (report.pending_flats.length === 0) {
                doc.text('All payments collected!');
            } else {
                let pfy = doc.y;
                doc.rect(50, pfy - 2, 495, 16).fill('#e2e8f0');
                doc.fillColor('#0f172a').font('Helvetica-Bold');
                doc.text('Flat', 60, pfy, { width: 100 });
                doc.text('Owner', 160, pfy, { width: 200 });
                doc.text('Amount Due', 360, pfy, { width: 150, align: 'right' });
                pfy += 18;
                doc.font('Helvetica');
                for (const pf of report.pending_flats) {
                    if (pfy > 750) { doc.addPage(); pfy = 50; }
                    doc.text(pf.flat_number, 60, pfy, { width: 100 });
                    doc.text(pf.owner_name || 'N/A', 160, pfy, { width: 200 });
                    doc.text(`Rs. ${pf.amount_expected.toLocaleString('en-IN')}`, 360, pfy, { width: 150, align: 'right' });
                    pfy += 16;
                }
                doc.y = pfy + 10;
            }

            // ── Arrears ──
            if (doc.y > 650) doc.addPage();
            doc.fontSize(14).font('Helvetica-Bold').fillColor('#0ea5e9').text('Arrears / Dues (Previous Months)');
            doc.moveDown(0.5);
            doc.fontSize(10).font('Helvetica').fillColor('#0f172a');
            if (!report.arrears_by_flat || report.arrears_by_flat.length === 0) {
                doc.text('No arrears from previous months.');
            } else {
                let ay = doc.y;
                doc.rect(50, ay - 2, 495, 16).fill('#e2e8f0');
                doc.fillColor('#0f172a').font('Helvetica-Bold');
                doc.text('Flat', 60, ay, { width: 80 });
                doc.text('Owner', 140, ay, { width: 170 });
                doc.text('Arrears', 310, ay, { width: 100, align: 'right' });
                doc.text('Months', 420, ay, { width: 80, align: 'right' });
                ay += 18;
                doc.font('Helvetica');
                for (const af of report.arrears_by_flat) {
                    if (ay > 750) { doc.addPage(); ay = 50; }
                    doc.text(af.flat_number, 60, ay, { width: 80 });
                    doc.text(af.owner_name || 'N/A', 140, ay, { width: 170 });
                    doc.text(`Rs. ${af.total_arrears.toLocaleString('en-IN')}`, 310, ay, { width: 100, align: 'right' });
                    doc.text(`${af.months_pending}`, 420, ay, { width: 80, align: 'right' });
                    ay += 16;
                }
                doc.rect(50, ay - 2, 495, 16).fill('#fef2f2');
                doc.fillColor('#ef4444').font('Helvetica-Bold');
                doc.text('Grand Total Arrears', 60, ay, { width: 250 });
                doc.text(`Rs. ${(report.total_arrears || 0).toLocaleString('en-IN')}`, 310, ay, { width: 100, align: 'right' });
                doc.y = ay + 25;
            }

            // ── Flat Statistics ──
            doc.moveDown();
            doc.fillColor('#0f172a');
            doc.fontSize(14).font('Helvetica-Bold').fillColor('#0ea5e9').text('Flat Statistics');
            doc.moveDown(0.5);
            doc.fontSize(10).font('Helvetica').fillColor('#0f172a');
            doc.text(`Total Flats: ${report.flat_stats.total}`);
            doc.text(`Occupied: ${report.flat_stats.occupied} (Maintenance: Rs.1,500 + Garbage: Rs.100 = Rs.1,600)`);
            doc.text(`Vacant: ${report.flat_stats.vacant} (Maintenance: Rs.1,500 + Garbage: Rs.0 = Rs.1,500)`);

            // ── Page Numbers ──
            const pageCount = doc.bufferedPageRange().count;
            for (let i = 0; i < pageCount; i++) {
                doc.switchToPage(i);
                doc.fontSize(8).fillColor('#94a3b8');
                doc.text(
                    `Generated by Flat Care Management System | Page ${i + 1} of ${pageCount}`,
                    50, 780, { align: 'center', width: 495 }
                );
            }

            doc.end();
        });

        // Send to configured recipients
        const recipients = (process.env.REPORT_RECIPIENTS || 'tgmurali.kaswa@gmail.com,pradyumnatg115@gmail.com').split(',').map(e => e.trim()).filter(Boolean);
        if (recipients.length === 0) {
            return res.status(400).json({ error: 'No email recipients configured' });
        }

        const emailBody = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #0ea5e9; color: #fff; padding: 20px 30px; border-radius: 8px 8px 0 0;">
          <h1 style="margin:0; font-size:24px;">FlatCare Monthly Report</h1>
          <p style="margin:5px 0 0; opacity:0.9;">${monthName} ${year}</p>
        </div>
        <div style="background: #f8fafc; padding: 25px 30px; border: 1px solid #e2e8f0; border-top:none;">
          <h3 style="color:#0f172a; margin-top:0;">Financial Summary</h3>
          <table style="width:100%; border-collapse:collapse; font-size:14px;">
            <tr><td style="padding:6px 0;">Opening Balance</td><td style="text-align:right; font-weight:500;">₹${(report.opening_balance || 0).toLocaleString('en-IN')}</td></tr>
            <tr><td style="padding:6px 0;">Total Expected</td><td style="text-align:right;">₹${(report.total_expected || 0).toLocaleString('en-IN')}</td></tr>
            <tr><td style="padding:6px 0; color:#16a34a;">Total Received</td><td style="text-align:right; color:#16a34a; font-weight:600;">₹${(report.total_received || 0).toLocaleString('en-IN')}</td></tr>
            <tr><td style="padding:6px 0; color:#dc2626;">Total Pending</td><td style="text-align:right; color:#dc2626; font-weight:600;">₹${(report.total_pending || 0).toLocaleString('en-IN')}</td></tr>
            <tr><td style="padding:6px 0;">Total Expenses</td><td style="text-align:right;">₹${(report.total_expenses || 0).toLocaleString('en-IN')}</td></tr>
            <tr><td style="padding:6px 0; color:#f59e0b;">Total Arrears</td><td style="text-align:right; color:#f59e0b;">₹${(report.total_arrears || 0).toLocaleString('en-IN')}</td></tr>
            <tr style="border-top:2px solid #0ea5e9;"><td style="padding:10px 0; font-weight:700; font-size:16px;">Closing Balance</td><td style="text-align:right; font-weight:700; font-size:16px; color:#0ea5e9;">₹${(report.closing_balance || 0).toLocaleString('en-IN')}</td></tr>
          </table>
          <hr style="border:none; border-top:1px solid #e2e8f0; margin:20px 0;">
          <p style="font-size:12px; color:#64748b;">Flats: ${report.flat_stats.total} total (${report.flat_stats.occupied} occupied, ${report.flat_stats.vacant} vacant)</p>
          <p style="font-size:12px; color:#64748b;">Pending: ${report.pending_flats.length} flat(s)</p>
        </div>
        <div style="background:#0f172a; color:#94a3b8; padding:15px 30px; border-radius: 0 0 8px 8px; font-size:11px; text-align:center;">
          Generated by FlatCare • ${new Date().toLocaleString('en-IN')}
        </div>
      </div>
    `;

        const attachments = [
            { filename: `FlatCare_Report_${monthName}_${year}.pdf`, content: pdfBuffer },
        ];
        if (excelBuffer) {
            attachments.push({ filename: `FlatCare_Report_${monthName}_${year}.xlsx`, content: excelBuffer });
        }

        const results = [];
        for (const recipient of recipients) {
            try {
                await transporter.sendMail({
                    from: process.env.SMTP_FROM || process.env.SMTP_USER,
                    to: recipient,
                    subject: `FlatCare Monthly Report — ${monthName} ${year}`,
                    html: emailBody,
                    attachments,
                });
                results.push({ email: recipient, status: 'sent' });
                console.log(`📧 Email sent to ${recipient}`);
            } catch (emailErr) {
                results.push({ email: recipient, status: 'failed', error: emailErr.message });
                console.error(`❌ Failed to send email to ${recipient}:`, emailErr.message);
            }
        }

        await db.logAction(req.session.user.id, req.session.user.username, 'SEND_EMAIL', 'report', null,
            `Sent ${monthName} ${year} report to ${results.filter(r => r.status === 'sent').length}/${recipients.length} recipients`);

        res.json({
            success: true,
            message: `Reports sent to ${results.filter(r => r.status === 'sent').length} of ${recipients.length} recipients`,
            results
        });
    } catch (err) {
        console.error('Email error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ══════════════════════════════════════════
//  MONTHLY FINALIZE
// ══════════════════════════════════════════

app.post('/api/months/finalize', async (req, res) => {
    try {
        const { month, year } = req.body;
        if (!month || !year) return res.status(400).json({ error: 'month and year required' });

        const m = parseInt(month);
        const y = parseInt(year);

        // Recalculate and finalize summary
        await db.updateMonthlySummary(m, y);

        // Sync Excel
        syncMonthlyExcel(m, y).catch(() => { });

        await db.logAction(req.session.user.id, req.session.user.username, 'FINALIZE', 'month', null, `Finalized ${month}/${year}`);

        res.json({ success: true, message: 'Month finalized successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Clear Logs
app.delete('/api/logs', async (req, res) => {
    try {
        await db.clearLogs();
        await db.logAction(req.session.user.id, req.session.user.username, 'CLEAR_LOGS', 'audit_log', null, 'Cleared all audit logs');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

if (process.env.VERCEL) {
    db.connectDB().then(() => console.log('MongoDB ready for Vercel'));
    module.exports = app;
} else {
    // ── Start Server ──
    db.connectDB().then(() => {
        app.listen(PORT, () => {
            console.log(`\n  ╔══════════════════════════════════════════╗`);
            console.log(`  ║   FlatCare server running on port ${PORT}    ║`);
            console.log(`  ║   http://localhost:${PORT}                  ║`);
            console.log(`  ╚══════════════════════════════════════════╝\n`);
        });
    }).catch(err => {
        console.error('❌ Failed to connect to MongoDB:', err.message);
        process.exit(1);
    });
}
