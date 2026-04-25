import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../data/gws-connect.db');
const db = new Database(dbPath);

console.log('Running migration: add channel privacy');

try {
	db.prepare('BEGIN').run();

	const columns = db.prepare("PRAGMA table_info('channels')").all();
	const hasIsPrivate = columns.some((column) => column.name === 'isPrivate');

	if (!hasIsPrivate) {
		db.prepare(
			'ALTER TABLE channels ADD COLUMN isPrivate INTEGER DEFAULT 0 CHECK(isPrivate IN (0, 1))',
		).run();
		console.log('✓ Added isPrivate column to channels');
	} else {
		console.log('✓ isPrivate column already exists, skipping');
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
