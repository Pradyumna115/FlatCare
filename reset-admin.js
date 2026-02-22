require('dotenv').config();
const db = require('./database');

async function reset() {
    try {
        await db.connectDB();
        console.log('Connected to DB');

        const adminUsername = process.env.ADMIN_USER || 'admin';
        const newPassword = process.env.ADMIN_PASS || 'murali@flatcare';

        const user = await db.getUserByUsername(adminUsername);

        if (user) {
            console.log(`Found user: ${adminUsername} (ID: ${user.id}). Resetting password...`);
            await db.changePassword(user.id, newPassword);
            console.log('Password reset successfully!');
        } else {
            console.log(`User ${adminUsername} not found. Creating new admin user...`);
            const newUser = await db.createUser({
                username: adminUsername,
                password: newPassword,
                role: 'admin',
                display_name: 'Administrator',
                email: 'admin@flatcare.local'
            });
            console.log('Admin user created successfully!');
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        process.exit();
    }
}

reset();
