import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../data/gws-connect.db');
const db = new Database(dbPath);

console.log('Running migration: add encrypted message fields');

try {
	db.prepare('BEGIN').run();

	const columns = db.prepare("PRAGMA table_info('messages')").all();
	const hasCipherText = columns.some((column) => column.name === 'cipherText');
	const hasCipherIv = columns.some((column) => column.name === 'cipherIv');
	const hasEncrypted = columns.some((column) => column.name === 'isEncrypted');

	if (!hasCipherText) {
		db.prepare('ALTER TABLE messages ADD COLUMN cipherText TEXT').run();
		console.log('✓ Added cipherText');
	}
	if (!hasCipherIv) {
		db.prepare('ALTER TABLE messages ADD COLUMN cipherIv TEXT').run();
		console.log('✓ Added cipherIv');
	}
	if (!hasEncrypted) {
		db.prepare(
			'ALTER TABLE messages ADD COLUMN isEncrypted INTEGER DEFAULT 0 CHECK(isEncrypted IN (0, 1))',
		).run();
		console.log('✓ Added isEncrypted');
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
