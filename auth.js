// ══════════════════════════════════════════
// FlatCare – Authentication & Authorization
// ══════════════════════════════════════════

const bcrypt = require('bcryptjs');

let dbModule;

function getDbModule() {
    if (!dbModule) {
        dbModule = require('./database');
    }
    return dbModule;
}

/**
 * Authenticate a user against the database.
 * Returns user object (without password_hash) on success, null on failure.
 */
async function authenticate(username, password) {
    const db = getDbModule();
    const user = await db.getUserByUsername(username);

    if (!user) return null;
    if (!user.is_active) return null;
    if (!bcrypt.compareSync(password, user.password_hash)) return null;

    // Update last login timestamp
    await db.updateLastLogin(user.id);

    // Return safe user object (no password hash)
    return {
        id: user.id,
        username: user.username,
        role: user.role,
        display_name: user.display_name,
        email: user.email
    };
}

/**
 * Middleware: require authenticated session.
 */
function requireAuth(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.redirect('/login.html');
}

/**
 * Middleware factory: require a specific role.
 * Usage: app.get('/api/users', requireRole('admin'), handler)
 */
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.session || !req.session.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        if (!roles.includes(req.session.user.role)) {
            return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
        }
        return next();
    };
}

module.exports = { authenticate, requireAuth, requireRole };
