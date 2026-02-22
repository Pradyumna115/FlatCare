require('dotenv').config();
const db = require('./database');
const bcrypt = require('bcryptjs');

async function investigate() {
    try {
        await db.connectDB();
        const username = process.env.ADMIN_USER || 'admin';
        const password = process.env.ADMIN_PASS || 'murali@flatcare';

        console.log(`Investigating login for: ${username}`);

        const user = await db.getUserByUsername(username);
        console.log('User record from DB:', user);

        if (!user) {
            console.log('User not found.');
            return;
        }

        console.log('Is active?', !!user.is_active);

        const isMatch = bcrypt.compareSync(password, user.password_hash);
        console.log(`Password match for ${password} against hash ${user.password_hash}:`, isMatch);

        // Also let's see if there are other users?
        const users = await db.getAllUsers();
        console.log(`Total users in DB: ${users.length}`);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        process.exit();
    }
}

investigate();
