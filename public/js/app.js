/* ══════════════════════════════════════════════════════════════
   FlatCare – Shared Frontend JavaScript v2.0
   ══════════════════════════════════════════════════════════════ */

// ── Constants ──

const MONTH_NAMES = [
    '', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

const EXPENSE_CATEGORIES = {
    monthly: [
        'Electricity Bill (Common Area)',
        'Garbage Lifting Charges',
        'Cleaning Expenses',
        'Plumbing Repairs',
        'Minor Repairs',
        'Miscellaneous'
    ],
    sixMonth: ['Lift Maintenance Charges'],
    optional: [
        'Security Salary', 'Water Tanker Charges', 'Generator Diesel',
        'CCTV Maintenance', 'Pest Control', 'Emergency Repairs'
    ]
};

function getAllExpenseCategories() {
    return [...EXPENSE_CATEGORIES.monthly, ...EXPENSE_CATEGORIES.sixMonth, ...EXPENSE_CATEGORIES.optional];
}

// ── SVG Icons Library ──

const ICONS = {
    dashboard: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
    flats: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    payments: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
    expenses: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    reports: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
    logout: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    search: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    close: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    check: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    warning: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    error: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    menu: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
    sun: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
    moon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    money: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    download: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    plus: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    edit: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    trash: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    users: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    account: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    eye: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
    eyeOff: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"></path></svg>',
};

// ── Utility Functions ──

function getCurrentMonth() { return new Date().getMonth() + 1; }
function getCurrentYear() { return new Date().getFullYear(); }

function formatCurrency(amount) {
    const num = parseFloat(amount);
    if (isNaN(num)) return '₹0';
    return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── API Helpers ──

async function apiFetch(url, options = {}) {
    try {
        const fetchOptions = { ...options };

        // Block modification requests for viewer role
        if (fetchOptions.method && fetchOptions.method !== 'GET') {
            const user = await getCurrentUser();
            if (user && user.role === 'viewer') {
                showToast('Viewers cannot modify data', 'error');
                return null;
            }
        }

        // Only set Content-Type for JSON requests (not GET, not FormData)
        if (options.body && typeof options.body === 'string') {
            fetchOptions.headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
        }
        const res = await fetch(url, fetchOptions);
        if (res.status === 401) {
            window.location.href = '/login.html';
            return null;
        }
        return res;
    } catch (err) {
        console.error('API Error:', err);
        showToast('Connection error. Please check the server.', 'error');
        return null;
    }
}

async function apiGet(url) {
    const res = await apiFetch(url);
    if (!res) return null;
    return res.json();
}

async function apiPost(url, data) {
    const res = await apiFetch(url, { method: 'POST', body: JSON.stringify(data) });
    if (!res) return null;
    return res.json();
}

async function apiPut(url, data) {
    const res = await apiFetch(url, { method: 'PUT', body: JSON.stringify(data) });
    if (!res) return null;
    return res.json();
}

async function apiDelete(url) {
    const res = await apiFetch(url, { method: 'DELETE' });
    if (!res) return null;
    return res.json();
}

// ── Logout ──

async function logout() {
    await apiFetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
}

// ── Current User ──

let _cachedUser = null;

async function getCurrentUser() {
    if (_cachedUser) return _cachedUser;
    _cachedUser = await apiGet('/api/me');
    return _cachedUser;
}

// ── Month/Year Selector ──

function populateMonthSelector(monthSelectId, yearSelectId) {
    const monthSelect = document.getElementById(monthSelectId);
    const yearSelect = document.getElementById(yearSelectId);

    if (monthSelect) {
        for (let i = 1; i <= 12; i++) {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = MONTH_NAMES[i];
            if (i === getCurrentMonth()) opt.selected = true;
            monthSelect.appendChild(opt);
        }
    }

    if (yearSelect) {
        const current = getCurrentYear();
        for (let y = current - 2; y <= current + 1; y++) {
            const opt = document.createElement('option');
            opt.value = y;
            opt.textContent = y;
            if (y === current) opt.selected = true;
            yearSelect.appendChild(opt);
        }
    }
}

function getSelectedMonth(id) { return parseInt(document.getElementById(id).value); }
function getSelectedYear(id) { return parseInt(document.getElementById(id).value); }

// ══════════════════════════════════════════
// SIDEBAR & NAVIGATION
// ══════════════════════════════════════════

function buildAppShell(pageTitle) {
    const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';

    const navItems = [
        { href: '/dashboard.html', icon: ICONS.dashboard, label: 'Dashboard' },
        { href: '/flats.html', icon: ICONS.flats, label: 'Flats' },
        { href: '/payments.html', icon: ICONS.payments, label: 'Payments' },
        { href: '/expenses.html', icon: ICONS.expenses, label: 'Expenses' },
        { href: '/reports.html', icon: ICONS.reports, label: 'Reports' },
        { href: '/account.html', icon: ICONS.account, label: 'Account' },
    ];

    const navLinks = navItems.map(item => {
        const isActive = item.href.includes(currentPage) ? 'active' : '';
        return `<a href="${item.href}" class="${isActive}">
      <span class="nav-icon">${item.icon}</span>
      <span>${item.label}</span>
    </a>`;
    }).join('');

    // Add admin-only Users nav after shell is built
    setTimeout(async () => {
        const user = await getCurrentUser();
        if (user && user.role === 'admin') {
            const sidebarNav = document.querySelector('.sidebar-nav');
            if (sidebarNav) {
                const isActive = currentPage === 'users.html' ? 'active' : '';
                const usersLink = document.createElement('a');
                usersLink.href = '/users.html';
                usersLink.className = isActive;
                usersLink.innerHTML = `<span class="nav-icon">${ICONS.users}</span><span>Users</span>`;
                sidebarNav.appendChild(usersLink);
            }
            // Show user info in topbar
            const topbarRight = document.getElementById('topbarRight');
            if (topbarRight) {
                topbarRight.innerHTML = `<span style="font-size:13px;color:var(--text-muted);">Signed in as <strong style="color:var(--text);">Hello Murali</strong> <span class="badge badge-info" style="font-size:10px;margin-left:4px;">${user.role}</span></span>`;
            }
        } else if (user) {
            const topbarRight = document.getElementById('topbarRight');
            if (topbarRight) {
                const displayName = user.display_name || user.username;
                topbarRight.innerHTML = `<span style="font-size:13px;color:var(--text-muted);">Signed in as <strong style="color:var(--text);">Hello ${displayName}</strong></span>`;
            }
        }
    }, 0);

    const savedTheme = localStorage.getItem('flatcare-theme') || 'light';
    const isDark = savedTheme === 'dark';

    // Build the shell HTML
    const shellHTML = `
    <div class="sidebar-overlay" id="sidebarOverlay"></div>
    <aside class="sidebar" id="sidebar">
      <a href="/dashboard.html" class="sidebar-brand">
        <svg class="brand-icon" viewBox="0 0 64 64" fill="none">
          <rect width="64" height="64" rx="14" fill="#0ea5e9"/>
          <path d="M32 14L12 28v4l20-14 20 14v-4L32 14z" fill="#fff"/>
          <rect x="18" y="30" width="28" height="20" rx="2" fill="#fff" opacity="0.9"/>
          <rect x="24" y="36" width="6" height="8" rx="1" fill="#0ea5e9" opacity="0.6"/>
          <rect x="34" y="36" width="6" height="8" rx="1" fill="#0ea5e9" opacity="0.6"/>
          <rect x="28" y="42" width="8" height="8" rx="1" fill="#0284c7" opacity="0.8"/>
        </svg>
        <div>
          <span class="brand-text">FlatCare</span>
          <span class="brand-sub">Management Suite</span>
        </div>
      </a>
      <nav class="sidebar-nav">
        ${navLinks}
      </nav>
      <div class="sidebar-footer">
        <div class="theme-toggle">
          <span>${isDark ? 'Dark Mode' : 'Light Mode'}</span>
          <button class="theme-switch ${isDark ? 'active' : ''}" id="themeSwitch" onclick="toggleTheme()" aria-label="Toggle theme"></button>
        </div>
        <button class="logout-btn" onclick="logout()">
          <span>${ICONS.logout}</span>
          Sign Out
        </button>
      </div>
    </aside>
    <main class="main-content">
      <header class="topbar">
        <div class="topbar-left">
          <button class="hamburger" id="hamburger" onclick="toggleSidebar()" aria-label="Toggle sidebar">
            ${ICONS.menu}
          </button>
          <h1 class="page-title">${pageTitle}</h1>
        </div>
        <div class="topbar-right" id="topbarRight"></div>
      </header>
      <div class="container" id="pageContainer"></div>
    </main>
  `;

    // Wrap body content
    const pageContent = document.getElementById('pageContent');
    const appLayout = document.createElement('div');
    appLayout.className = 'app-layout';
    appLayout.innerHTML = shellHTML;

    // Move page content into container
    const container = appLayout.querySelector('#pageContainer');
    if (pageContent) {
        container.appendChild(pageContent);
        pageContent.style.display = 'block';
    }

    document.body.prepend(appLayout);

    // Add toast container
    if (!document.getElementById('toastContainer')) {
        const tc = document.createElement('div');
        tc.className = 'toast-container';
        tc.id = 'toastContainer';
        document.body.appendChild(tc);
    }

    // Apply saved theme
    if (isDark) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
}

// ── Sidebar Toggle ──

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
}

document.addEventListener('click', (e) => {
    if (e.target.id === 'sidebarOverlay') {
        toggleSidebar();
    }
});

// ── Theme Toggle ──

function toggleTheme() {
    const html = document.documentElement;
    const switchBtn = document.getElementById('themeSwitch');
    const label = switchBtn.parentElement.querySelector('span');
    const isDark = html.getAttribute('data-theme') === 'dark';

    if (isDark) {
        html.removeAttribute('data-theme');
        switchBtn.classList.remove('active');
        label.textContent = 'Light Mode';
        localStorage.setItem('flatcare-theme', 'light');
    } else {
        html.setAttribute('data-theme', 'dark');
        switchBtn.classList.add('active');
        label.textContent = 'Dark Mode';
        localStorage.setItem('flatcare-theme', 'dark');
    }
}

// Apply theme on page load
(function applyTheme() {
    const saved = localStorage.getItem('flatcare-theme');
    if (saved === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
})();

// ══════════════════════════════════════════
// TOAST NOTIFICATIONS
// ══════════════════════════════════════════

function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const iconMap = {
        success: ICONS.check,
        error: ICONS.error,
        warning: ICONS.warning,
        info: ICONS.info
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `${iconMap[type] || iconMap.info}<span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ══════════════════════════════════════════
// MODAL DIALOG
// ══════════════════════════════════════════

function showModal(title, contentHTML, onConfirm, confirmText = 'Confirm', confirmClass = 'btn-primary') {
    // Remove existing modal
    const existing = document.getElementById('appModal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'appModal';
    overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>${title}</h3>
        <button class="modal-close" onclick="closeModal()">${ICONS.close}</button>
      </div>
      <div class="modal-body">${contentHTML}</div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn ${confirmClass}" id="modalConfirmBtn">${confirmText}</button>
      </div>
    </div>
  `;

    document.body.appendChild(overlay);

    // Animate in
    requestAnimationFrame(() => overlay.classList.add('active'));

    // Bind confirm
    document.getElementById('modalConfirmBtn').addEventListener('click', () => {
        if (onConfirm) onConfirm();
        closeModal();
    });

    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    // Close on Escape
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

function closeModal() {
    const modal = document.getElementById('appModal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.remove(), 200);
    }
}

// ══════════════════════════════════════════
// ANIMATED COUNTER
// ══════════════════════════════════════════

function animateCounter(element, target, duration = 800) {
    if (!element) return;
    const start = 0;
    const startTime = performance.now();

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Ease out cubic
        const ease = 1 - Math.pow(1 - progress, 3);
        const current = Math.floor(start + (target - start) * ease);
        element.textContent = formatCurrency(current);
        if (progress < 1) {
            requestAnimationFrame(update);
        } else {
            element.textContent = formatCurrency(target);
        }
    }

    requestAnimationFrame(update);
}

function animateNumber(element, target, duration = 800) {
    if (!element) return;
    const startTime = performance.now();

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        element.textContent = Math.floor(target * ease);
        if (progress < 1) requestAnimationFrame(update);
        else element.textContent = target;
    }

    requestAnimationFrame(update);
}

// ══════════════════════════════════════════
// SEARCH FILTER
// ══════════════════════════════════════════

function setupTableSearch(inputId, tableId) {
    const input = document.getElementById(inputId);
    const table = document.getElementById(tableId);
    if (!input || !table) return;

    input.addEventListener('input', () => {
        const query = input.value.toLowerCase().trim();
        const rows = table.querySelectorAll('tbody tr');

        rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(query) ? '' : 'none';
        });
    });
}

// ══════════════════════════════════════════
// LOADING SKELETON
// ══════════════════════════════════════════

function showSkeleton(container, count = 3) {
    if (!container) return;
    let html = '';
    for (let i = 0; i < count; i++) {
        html += `<div class="skeleton skeleton-card" style="height:${80 + Math.random() * 40}px; margin-bottom:12px;"></div>`;
    }
    container.innerHTML = html;
}

function showStatsSkeleton(container) {
    if (!container) return;
    container.innerHTML = Array(4).fill(0).map(() =>
        `<div class="stat-card"><div class="skeleton skeleton-circle"></div><div class="skeleton skeleton-text" style="width:60%;margin-top:12px;"></div><div class="skeleton skeleton-text" style="width:40%;height:24px;"></div></div>`
    ).join('');
}

// ══════════════════════════════════════════
// PASSWORD TOGGLE
// ══════════════════════════════════════════

function togglePasswordVisibility(inputId) {
    const input = document.getElementById(inputId);
    const btn = input.parentElement.querySelector('.pwd-toggle');
    if (!input || !btn) return;

    if (input.type === 'password') {
        input.type = 'text';
        btn.innerHTML = ICONS.eyeOff;
    } else {
        input.type = 'password';
        btn.innerHTML = ICONS.eye;
    }
}

// ══════════════════════════════════════════
// INITIALIZATION
// ══════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    // Keyboard shortcut: Ctrl+K for search focus
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            const searchInput = document.querySelector('.search-box input');
            if (searchInput) searchInput.focus();
        }
    });
});
