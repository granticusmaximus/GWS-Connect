import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../data/gws-connect.db');
const db = new Database(dbPath);

console.log('Running migration: add message reactions');

try {
	db.prepare('BEGIN').run();

	const tables = db
		.prepare("SELECT name FROM sqlite_master WHERE type='table'")
		.all()
		.map((row) => row.name);

	if (!tables.includes('message_reactions')) {
		db.prepare(
			`
      CREATE TABLE message_reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        messageId INTEGER NOT NULL,
        userId INTEGER NOT NULL,
        reaction TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (messageId) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      )
    `,
		).run();
		console.log('✓ Created message_reactions table');
	}

	const indexes = db
		.prepare("SELECT name FROM sqlite_master WHERE type='index'")
		.all()
		.map((row) => row.name);

	if (!indexes.includes('idx_message_reactions_message')) {
		db.prepare(
			'CREATE INDEX idx_message_reactions_message ON message_reactions(messageId)',
		).run();
		console.log('✓ Added idx_message_reactions_message');
	}

	if (!indexes.includes('idx_message_reactions_user')) {
		db.prepare(
			'CREATE INDEX idx_message_reactions_user ON message_reactions(userId)',
		).run();
		console.log('✓ Added idx_message_reactions_user');
	}

	if (!indexes.includes('uniq_message_reactions')) {
		db.prepare(
			'CREATE UNIQUE INDEX uniq_message_reactions ON message_reactions(messageId, userId, reaction)',
		).run();
		console.log('✓ Added uniq_message_reactions');
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
