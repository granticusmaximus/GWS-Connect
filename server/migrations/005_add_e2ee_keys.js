import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../data/gws-connect.db');
const db = new Database(dbPath);

console.log('Running migration: add E2EE keys to users');

try {
	db.prepare('BEGIN').run();

	const columns = db.prepare("PRAGMA table_info('users')").all();
	const hasPublicKey = columns.some(
		(column) => column.name === 'e2eePublicKey',
	);
	const hasEncryptedKey = columns.some(
		(column) => column.name === 'e2eeEncryptedPrivateKey',
	);
	const hasSalt = columns.some((column) => column.name === 'e2eeSalt');
	const hasIv = columns.some((column) => column.name === 'e2eeIv');

	if (!hasPublicKey) {
		db.prepare('ALTER TABLE users ADD COLUMN e2eePublicKey TEXT').run();
		console.log('✓ Added e2eePublicKey');
	}
	if (!hasEncryptedKey) {
		db.prepare(
			'ALTER TABLE users ADD COLUMN e2eeEncryptedPrivateKey TEXT',
		).run();
		console.log('✓ Added e2eeEncryptedPrivateKey');
	}
	if (!hasSalt) {
		db.prepare('ALTER TABLE users ADD COLUMN e2eeSalt TEXT').run();
		console.log('✓ Added e2eeSalt');
	}
	if (!hasIv) {
		db.prepare('ALTER TABLE users ADD COLUMN e2eeIv TEXT').run();
		console.log('✓ Added e2eeIv');
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
