import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../data/gws-connect.db');
const db = new Database(dbPath);

console.log('Running migration: add theme preference to users');

try {
	db.prepare('BEGIN').run();

	const columns = db.prepare("PRAGMA table_info('users')").all();
	const hasTheme = columns.some((column) => column.name === 'theme');

	if (!hasTheme) {
		db.prepare(
			"ALTER TABLE users ADD COLUMN theme TEXT DEFAULT 'light' CHECK(theme IN ('light', 'dark'))",
		).run();
		console.log('✓ Added theme column to users');
	} else {
		console.log('✓ Theme column already exists, skipping');
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
