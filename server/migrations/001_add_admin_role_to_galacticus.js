import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../data/gws-connect.db');
const db = new Database(dbPath);

console.log(
	'Running migration: Add role system and promote galacticus to admin',
);

try {
	// Start a transaction
	db.prepare('BEGIN').run();

	// 1. Add role column to users table if it doesn't exist
	try {
		db.prepare(
			`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user' CHECK(role IN ('user', 'manager', 'admin'))`,
		).run();
		console.log('✓ Added role column to users table');
	} catch (error) {
		if (error.message.includes('duplicate column')) {
			console.log('ℹ Role column already exists in users table');
		} else {
			throw error;
		}
	}

	// 2. Add status column to channels table if it doesn't exist
	try {
		db.prepare(
			`ALTER TABLE channels ADD COLUMN status TEXT DEFAULT 'approved' CHECK(status IN ('pending', 'approved', 'rejected'))`,
		).run();
		console.log('✓ Added status column to channels table');
	} catch (error) {
		if (error.message.includes('duplicate column')) {
			console.log('ℹ Status column already exists in channels table');
		} else {
			throw error;
		}
	}

	// 3. Create channel_managers table if it doesn't exist
	db.prepare(
		`CREATE TABLE IF NOT EXISTS channel_managers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channelId INTEGER NOT NULL,
      userId INTEGER NOT NULL,
      assignedBy INTEGER NOT NULL,
      assignedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (assignedBy) REFERENCES users(id),
      UNIQUE(channelId, userId)
    )`,
	).run();
	console.log('✓ Created channel_managers table');

	// 4. Create channel_bans table if it doesn't exist
	db.prepare(
		`CREATE TABLE IF NOT EXISTS channel_bans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channelId INTEGER NOT NULL,
      userId INTEGER NOT NULL,
      bannedBy INTEGER NOT NULL,
      reason TEXT DEFAULT '',
      bannedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (bannedBy) REFERENCES users(id),
      UNIQUE(channelId, userId)
    )`,
	).run();
	console.log('✓ Created channel_bans table');

	// 5. Create channel_mutes table if it doesn't exist
	db.prepare(
		`CREATE TABLE IF NOT EXISTS channel_mutes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channelId INTEGER NOT NULL,
      userId INTEGER NOT NULL,
      mutedBy INTEGER NOT NULL,
      reason TEXT DEFAULT '',
      expiresAt DATETIME NOT NULL,
      mutedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (mutedBy) REFERENCES users(id),
      UNIQUE(channelId, userId)
    )`,
	).run();
	console.log('✓ Created channel_mutes table');

	// 6. Create indexes for better performance
	const indexes = [
		`CREATE INDEX IF NOT EXISTS idx_channel_managers_channel ON channel_managers(channelId)`,
		`CREATE INDEX IF NOT EXISTS idx_channel_managers_user ON channel_managers(userId)`,
		`CREATE INDEX IF NOT EXISTS idx_channel_bans_channel ON channel_bans(channelId)`,
		`CREATE INDEX IF NOT EXISTS idx_channel_bans_user ON channel_bans(userId)`,
		`CREATE INDEX IF NOT EXISTS idx_channel_mutes_channel ON channel_mutes(channelId)`,
		`CREATE INDEX IF NOT EXISTS idx_channel_mutes_user ON channel_mutes(userId)`,
	];

	indexes.forEach((indexSql) => {
		db.prepare(indexSql).run();
	});
	console.log('✓ Created indexes');

	// 7. Update existing channels to 'approved' status if they don't have a status
	const channelUpdate = db
		.prepare(`UPDATE channels SET status = 'approved' WHERE status IS NULL`)
		.run();
	if (channelUpdate.changes > 0) {
		console.log(
			`✓ Updated ${channelUpdate.changes} existing channel(s) to approved status`,
		);
	}

	// 8. Update user 'galacticus' to admin role
	const result = db
		.prepare(
			`UPDATE users 
       SET role = 'admin' 
       WHERE username = 'galacticus'`,
		)
		.run();

	if (result.changes > 0) {
		console.log(`✓ Successfully updated user 'galacticus' to admin role`);
	} else {
		// Check if user exists
		const user = db
			.prepare(`SELECT username, role FROM users WHERE username = 'galacticus'`)
			.get();

		if (user) {
			if (user.role === 'admin') {
				console.log(`ℹ User 'galacticus' already has admin role`);
			} else {
				console.log(`⚠ Found user but role update failed`);
			}
		} else {
			console.log(`⚠ User 'galacticus' not found in database`);
		}
	}

	// Commit transaction
	db.prepare('COMMIT').run();

	// Display updated user info
	const updatedUser = db
		.prepare(
			`SELECT id, username, email, role FROM users WHERE username = 'galacticus'`,
		)
		.get();

	if (updatedUser) {
		console.log('\nUpdated user details:');
		console.log(`  ID: ${updatedUser.id}`);
		console.log(`  Username: ${updatedUser.username}`);
		console.log(`  Email: ${updatedUser.email}`);
		console.log(`  Role: ${updatedUser.role}`);
	}

	console.log('\n✓ Migration completed successfully');
} catch (error) {
	// Rollback on error
	db.prepare('ROLLBACK').run();
	console.error('✗ Migration failed:', error.message);
	process.exit(1);
} finally {
	db.close();
}
