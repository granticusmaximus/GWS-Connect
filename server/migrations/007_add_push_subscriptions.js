import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../data/gws-connect.db');
const db = new Database(dbPath);

console.log('Running migration: add push subscriptions');

try {
	db.prepare('BEGIN').run();

	const tables = db
		.prepare("SELECT name FROM sqlite_master WHERE type='table'")
		.all()
		.map((row) => row.name);

	if (!tables.includes('push_subscriptions')) {
		db.prepare(
			`
      CREATE TABLE push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        userAgent TEXT DEFAULT '',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      )
    `,
		).run();
		console.log('✓ Created push_subscriptions table');
	}

	const columns = db.prepare("PRAGMA table_info('push_subscriptions')").all();
	const hasIndex = db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type='index' AND name='idx_push_subscriptions_user'",
		)
		.get();

	if (!hasIndex && columns.length > 0) {
		db.prepare(
			'CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(userId)',
		).run();
		console.log('✓ Added idx_push_subscriptions_user');
	}

	db.prepare('COMMIT').run();
	console.log('✓ Migration completed successfully');
} catch (error) {
	db.prepare('ROLLBACK').run();
	console.error('✗ Migration failed:', error.message);
	process.exit(1);
} finally {
	db.close();
}
