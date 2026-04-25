import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../data/gws-connect.db');
const db = new Database(dbPath);

console.log('Running migration: add mustChangePassword');

try {
	db.prepare('BEGIN').run();

	const columns = db.prepare("PRAGMA table_info('users')").all();
	const hasMustChange = columns.some(
		(col) => col.name === 'mustChangePassword',
	);

	if (!hasMustChange) {
		db.prepare(
			'ALTER TABLE users ADD COLUMN mustChangePassword INTEGER DEFAULT 0',
		).run();
		console.log('✓ Added mustChangePassword');
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
