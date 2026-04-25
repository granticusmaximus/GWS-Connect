import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../data/gws-connect.db');
const db = new Database(dbPath);

console.log('Running migration: add message state fields');

try {
	db.prepare('BEGIN').run();

	const columns = db.prepare("PRAGMA table_info('messages')").all();
	const hasEditedAt = columns.some((col) => col.name === 'editedAt');
	const hasDeleted = columns.some((col) => col.name === 'isDeleted');
	const hasDeletedAt = columns.some((col) => col.name === 'deletedAt');
	const hasArchived = columns.some((col) => col.name === 'isArchived');
	const hasArchivedAt = columns.some((col) => col.name === 'archivedAt');

	if (!hasEditedAt) {
		db.prepare('ALTER TABLE messages ADD COLUMN editedAt DATETIME').run();
		console.log('✓ Added editedAt');
	}

	if (!hasDeleted) {
		db.prepare(
			'ALTER TABLE messages ADD COLUMN isDeleted INTEGER DEFAULT 0',
		).run();
		console.log('✓ Added isDeleted');
	}

	if (!hasDeletedAt) {
		db.prepare('ALTER TABLE messages ADD COLUMN deletedAt DATETIME').run();
		console.log('✓ Added deletedAt');
	}

	if (!hasArchived) {
		db.prepare(
			'ALTER TABLE messages ADD COLUMN isArchived INTEGER DEFAULT 0',
		).run();
		console.log('✓ Added isArchived');
	}

	if (!hasArchivedAt) {
		db.prepare('ALTER TABLE messages ADD COLUMN archivedAt DATETIME').run();
		console.log('✓ Added archivedAt');
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
