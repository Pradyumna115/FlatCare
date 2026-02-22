/**
 * excel-sync.js — Monthly Excel Database Sync
 *
 * DATA SAFETY DESIGN:
 * ───────────────────
 * 1. SQLite is the PRIMARY, authoritative source of truth. All reads/writes
 *    hit SQLite first. Data is NEVER lost even if Excel generation fails.
 *
 * 2. Excel files are a SECONDARY copy — auto-generated snapshots for
 *    sharing, auditing, and offline access. They are created in the
 *    `data/` directory with filenames like "February 2026.xlsx".
 *
 * 3. On every data mutation (payment update, expense add/delete, flat
 *    change), the Excel file for that month is REGENERATED from
 *    SQLite. This means the Excel file always reflects the current
 *    state of the database.
 *
 * 4. If an Excel file is accidentally deleted, it is automatically
 *    recreated on the next data mutation. No data is lost.
 *
 * 5. Each monthly Excel file contains 5 sheets with full formatting:
 *    - Flats & Residents     (all 30 flats with status)
 *    - Payments              (per-flat payment status for the month)
 *    - Expenses              (all expense entries with payment mode)
 *    - Monthly Summary       (financial overview & balances)
 *    - Statistics             (aggregated stats, charts data)
 */

const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.VERCEL ? '/tmp/data' : path.join(__dirname, 'data');

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Sync all data for a given month/year to an Excel file.
 * Called automatically after every data mutation.
 */
async function syncMonthlyExcel(month, year) {
    // Lazy-load db to avoid circular dependency
    const db = require('./database');

    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }

        const monthName = MONTH_NAMES[month] || `Month${month}`;
        const fileName = `${monthName} ${year}.xlsx`;
        const filePath = path.join(DATA_DIR, fileName);

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'FlatCare System';
        workbook.created = new Date();
        workbook.modified = new Date();

        // ── Sheet 1: Executive Dashboard ──
        const dashboardSheet = workbook.addWorksheet('Dashboard', {
            properties: { tabColor: { argb: 'F97316' } }
        });

        const reportData = await db.getDashboardData(month, year);
        const paymentsArray = await db.getPaymentsForMonth(month, year);
        const paidCnt = paymentsArray.filter(p => p.status === 'Paid').length;
        const pndCnt = paymentsArray.filter(p => p.status === 'Pending').length;

        dashboardSheet.columns = [
            { header: 'Key Metrics', key: 'metric', width: 35 },
            { header: 'Current Value', key: 'val', width: 25 },
        ];

        const dashMetrics = [
            { metric: 'Report Generated At', val: new Date().toLocaleString('en-IN') },
            { metric: 'Total Flats', val: reportData.flat_stats.total },
            { metric: 'Occupancy Rate', val: `${Math.round((reportData.flat_stats.occupied / reportData.flat_stats.total) * 100)}%` },
            { metric: 'Payments Collected', val: `${paidCnt} / ${paymentsArray.length}` },
            { metric: 'Payments Pending', val: pndCnt },
            { metric: '---', val: '---' }, // separator
            { metric: 'Total Expected Collection', val: reportData.total_expected || 0 },
            { metric: 'Total Received (Included Arrears)', val: reportData.total_received || 0 },
            { metric: 'Total Pending Current Month', val: reportData.total_pending || 0 },
            { metric: 'Total Expenses Paid', val: reportData.total_expenses || 0 },
            { metric: 'Net Balance for Month', val: reportData.remaining_balance || 0 },
        ];
        dashboardSheet.addRows(dashMetrics);
        applyEnterpriseHeader(dashboardSheet, 'Executive Dashboard');

        for (let i = 5; i <= dashboardSheet.rowCount; i++) {
            const row = dashboardSheet.getRow(i);
            if (row.getCell('metric').value && row.getCell('metric').value.toString().startsWith('Total') || row.getCell('metric').value === 'Net Balance for Month') {
                row.getCell('val').numFmt = '₹#,##0.00';
            }
            if (row.getCell('metric').value === 'Net Balance for Month') {
                row.font = { bold: true };
                row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'DCFCE7' } };
            }
        }

        // ── Sheet 2: Flats & Residents ──
        const flatsSheet = workbook.addWorksheet('Flats & Residents', {
            properties: { tabColor: { argb: '0EA5E9' } }
        });

        const flats = await db.getAllFlats();
        flatsSheet.columns = [
            { header: 'Flat No', key: 'flat_number', width: 12 },
            { header: 'Owner/Resident Name', key: 'owner_name', width: 30 },
            { header: 'Contact', key: 'contact', width: 18 },
            { header: 'Status', key: 'status', width: 12 },
            { header: 'Maintenance (₹)', key: 'maintenance', width: 18 },
            { header: 'Garbage (₹)', key: 'garbage', width: 14 },
        ];

        applyEnterpriseHeader(flatsSheet, 'Flats & Residents Directory');

        for (const f of flats) {
            const charges = db.calculateCharges(f.status);
            flatsSheet.addRow({
                flat_number: f.flat_number,
                owner_name: f.owner_name || '',
                contact: f.contact || '',
                status: f.status,
                maintenance: charges.maintenance_charge,
                garbage: charges.garbage_charge,
            });
        }
        applyCurrencyFormat(flatsSheet, ['E', 'F']);

        // ── Sheet 2: Payments ──
        const paymentsSheet = workbook.addWorksheet('Payments', {
            properties: { tabColor: { argb: '22C55E' } }
        });

        const payments = await db.getPaymentsForMonth(month, year);
        paymentsSheet.columns = [
            { header: 'Flat No', key: 'flat_number', width: 12 },
            { header: 'Owner', key: 'owner_name', width: 22 },
            { header: 'Maintenance (₹)', key: 'amount_expected', width: 16 },
            { header: 'Garbage (₹)', key: 'garbage_charge', width: 14 },
            { header: 'Arrears from Previous (₹)', key: 'previous_arrears', width: 18 },
            { header: 'Extra Payment (₹)', key: 'extra_payment', width: 16 },
            { header: 'Total Due (₹)', key: 'total_due', width: 16 },
            { header: 'Paid (₹)', key: 'amount_paid', width: 14 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Date Paid', key: 'date_paid', width: 18 },
        ];

        applyEnterpriseHeader(paymentsSheet, `Payment Records - ${monthName} ${year}`);

        for (const p of payments) {
            const row = paymentsSheet.addRow({
                flat_number: p.flat_number,
                owner_name: p.owner_name || '',
                amount_expected: p.amount_expected,
                garbage_charge: p.garbage_charge,
                previous_arrears: p.previous_arrears,
                extra_payment: p.extra_payment,
                total_due: (p.amount_expected || 0) + (p.garbage_charge || 0) + (p.previous_arrears || 0) + (p.extra_payment || 0),
                amount_paid: p.amount_paid,
                status: p.status,
                date_paid: p.date_paid || '',
            });
            // Color code status
            const statusCell = row.getCell('status');
            if (p.status === 'Paid') {
                statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'DCFCE7' } };
                statusCell.font = { color: { argb: '16A34A' }, bold: true };
            } else {
                statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEE2E2' } };
                statusCell.font = { color: { argb: 'DC2626' }, bold: true };
            }
        }
        applyCurrencyFormat(paymentsSheet, ['C', 'D', 'E', 'F', 'G', 'H']);

        // Totals row using formulas
        const lastRow = paymentsSheet.rowCount;
        const paidCount = payments.filter(p => p.status === 'Paid').length;
        const pendingCount = payments.filter(p => p.status === 'Pending').length;

        const totalsRow = paymentsSheet.addRow({
            flat_number: 'TOTALS',
            owner_name: `${paidCount} Paid / ${pendingCount} Pending`,
            amount_expected: { formula: `SUM(C7:C${lastRow})` },
            garbage_charge: { formula: `SUM(D7:D${lastRow})` },
            previous_arrears: { formula: `SUM(E7:E${lastRow})` },
            extra_payment: { formula: `SUM(F7:F${lastRow})` },
            total_due: { formula: `SUM(G7:G${lastRow})` },
            amount_paid: { formula: `SUM(H7:H${lastRow})` },
            status: '',
            date_paid: 'Grand Total',
        });
        totalsRow.font = { bold: true, size: 11 };
        totalsRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };

        // ── Sheet 3: Expenses ──
        const expensesSheet = workbook.addWorksheet('Expenses', {
            properties: { tabColor: { argb: 'EF4444' } }
        });

        const expenses = await db.getExpensesForMonth(month, year);
        expensesSheet.columns = [
            { header: '#', key: 'num', width: 6 },
            { header: 'Date', key: 'date', width: 14 },
            { header: 'Category', key: 'category', width: 18 },
            { header: 'Description', key: 'description', width: 30 },
            { header: 'Amount (₹)', key: 'amount', width: 14 },
            { header: 'Payment Mode', key: 'payment_mode', width: 16 },
            { header: 'Reference ID', key: 'reference_id', width: 18 },
        ];

        expenses.forEach((e, i) => {
            expensesSheet.addRow({
                num: i + 1,
                date: e.date,
                category: e.category,
                description: e.description || '',
                amount: e.amount,
                payment_mode: e.payment_mode || 'Cash',
                reference_id: e.reference_id || '',
            });
        });
        applyCurrencyFormat(expensesSheet, ['E']);

        applyEnterpriseHeader(expensesSheet, 'Expense Records');

        // Expense totals
        const expTotal = expenses.reduce((s, e) => s + e.amount, 0);
        const expTotalsRow = expensesSheet.addRow({
            num: '', date: '', category: '', description: 'TOTAL EXPENSES',
            amount: expTotal, payment_mode: '', reference_id: '',
        });
        expTotalsRow.font = { bold: true, size: 11 };
        expTotalsRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEE2E2' } };

        // ── Sheet 4: Monthly Summary ──
        const summarySheet = workbook.addWorksheet('Monthly Summary', {
            properties: { tabColor: { argb: '6366F1' } }
        });

        summarySheet.columns = [
            { header: 'Item', key: 'item', width: 35 },
            { header: 'Amount (₹)', key: 'amount', width: 20 },
        ];

        const summaryItems = [
            { item: 'Opening Balance', amount: reportData.opening_balance || 0 },
            { item: 'Total Expected Collection', amount: reportData.total_expected || 0 },
            { item: 'Total Received', amount: reportData.total_received || 0 },
            { item: 'Total Pending', amount: reportData.total_pending || 0 },
            { item: 'Total Garbage Charges', amount: reportData.total_garbage || 0 },
            { item: 'Total Expenses', amount: reportData.total_expenses || 0 },
            { item: 'Total Arrears (Previous Months)', amount: reportData.total_arrears || 0 },
            { item: 'Closing Balance', amount: reportData.closing_balance || 0 },
            { item: 'Net Balance (Opening + Received - Expenses)', amount: reportData.remaining_balance || 0 },
        ];

        for (const si of summaryItems) {
            const row = summarySheet.addRow(si);
            if (si.item === 'Closing Balance' || si.item.startsWith('Net Balance')) {
                row.font = { bold: true, size: 12 };
                row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'DBEAFE' } };
            }
        }
        applyCurrencyFormat(summarySheet, ['B']);

        applyEnterpriseHeader(summarySheet, 'Monthly Financial Summary');

        // ── Add Statistics to bottom of summary or ignore as Dashboard handles it ──

        // Save
        await workbook.xlsx.writeFile(filePath);
        console.log(`✅ Monthly Excel synced: ${fileName}`);
        return filePath;

    } catch (err) {
        console.error('⚠️ Excel sync failed (data is safe in SQLite):', err.message);
        return null;
    }
}

/**
 * Generate a formatted Excel report for download/email attachment.
 * Same as sync but returns a buffer instead of writing to disk.
 */
async function generateExcelBuffer(month, year) {
    const filePath = await syncMonthlyExcel(month, year);
    if (!filePath) return null;
    return fs.readFileSync(filePath);
}

// ── Helper functions ──

function applyEnterpriseHeader(sheet, subtitle) {
    const colCount = Math.max(1, sheet.columns.length);

    // Insert 5 blank rows at top
    sheet.spliceRows(1, 0, [], [], [], [], []);

    // Row 1: App Name
    sheet.mergeCells(1, 1, 1, colCount);
    const titleRow = sheet.getRow(1);
    titleRow.getCell(1).value = 'Flat Care';
    titleRow.font = { name: 'Arial', size: 18, bold: true, color: { argb: '0F172A' } };
    titleRow.alignment = { horizontal: 'center', vertical: 'middle' };
    titleRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
    titleRow.height = 30;

    // Row 2: Association Name
    sheet.mergeCells(2, 1, 2, colCount);
    const assocRow = sheet.getRow(2);
    assocRow.getCell(1).value = 'Aditya Residency Welfare Association';
    assocRow.font = { name: 'Arial', size: 14, bold: true, color: { argb: '0F172A' } };
    assocRow.alignment = { horizontal: 'center', vertical: 'middle' };
    assocRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
    assocRow.height = 22;

    // Row 3: Address
    sheet.mergeCells(3, 1, 3, colCount);
    const addrRow = sheet.getRow(3);
    addrRow.getCell(1).value = 'Commercial Tax Colony, Kothapet, Hyderabad';
    addrRow.font = { name: 'Arial', size: 11, color: { argb: '475569' } };
    addrRow.alignment = { horizontal: 'center', vertical: 'middle' };
    addrRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
    addrRow.height = 18;

    // Row 4: Subtitle & Timestamp Footer Equivalent
    sheet.mergeCells(4, 1, 4, colCount);
    const subRow = sheet.getRow(4);
    subRow.getCell(1).value = `${subtitle} | Generated: ${new Date().toLocaleString('en-IN')}`;
    subRow.font = { name: 'Arial', size: 10, italic: true, color: { argb: '64748B' } };
    subRow.alignment = { horizontal: 'center', vertical: 'middle' };
    subRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
    subRow.height = 18;

    // Row 5: Spacer
    sheet.getRow(5).height = 10;

    // Row 6: Actual Table Headers (Pushed down by spliceRows)
    const headerRow = sheet.getRow(6);
    headerRow.font = { bold: true, size: 11, color: { argb: 'FFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F172A' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.height = 24;
    headerRow.eachCell((cell) => {
        cell.border = { bottom: { style: 'medium', color: { argb: '0EA5E9' } } };
    });

    // Auto-adjust columns nicely
    sheet.columns.forEach(column => {
        let maxLength = 0;
        column["eachCell"]({ includeEmpty: true }, function (cell) {
            let columnLength = cell.value ? cell.value.toString().length : 10;
            if (columnLength > maxLength) {
                maxLength = columnLength;
            }
        });
        column.width = Math.min(Math.max(maxLength + 2, 12), 40);
    });

    // Freeze top 6 rows
    sheet.views = [{ state: 'frozen', ySplit: 6 }];
}

function applyCurrencyFormat(sheet, columns) {
    for (const col of columns) {
        sheet.getColumn(col).numFmt = '₹#,##0.00';
        sheet.getColumn(col).alignment = { horizontal: 'right' };
    }
}

module.exports = { syncMonthlyExcel, generateExcelBuffer };
