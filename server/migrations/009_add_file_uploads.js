import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../data/gws-connect.db');
const db = new Database(dbPath);

console.log('Running migration: add file uploads');

try {
	db.prepare('BEGIN').run();

	const columns = db.prepare("PRAGMA table_info('messages')").all();
	const hasFilePath = columns.some((col) => col.name === 'filePath');

	if (!hasFilePath) {
		db.prepare('ALTER TABLE messages ADD COLUMN filePath TEXT').run();
		console.log('✓ Added filePath to messages');
	}

	const indexes = db
		.prepare("SELECT name FROM sqlite_master WHERE type='index'")
		.all()
		.map((row) => row.name);

	if (!indexes.includes('idx_messages_file')) {
		db.prepare('CREATE INDEX idx_messages_file ON messages(fileUrl)').run();
		console.log('✓ Added idx_messages_file');
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
