import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../data/gws-connect.db');
const db = new Database(dbPath);

console.log('Running migration: add polls');

try {
	db.prepare('BEGIN').run();

	const tables = db
		.prepare("SELECT name FROM sqlite_master WHERE type='table'")
		.all()
		.map((row) => row.name);

	if (!tables.includes('polls')) {
		db.prepare(
			`
      CREATE TABLE polls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        messageId INTEGER NOT NULL,
        createdBy INTEGER NOT NULL,
        question TEXT NOT NULL,
        expiresAt DATETIME,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (messageId) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE CASCADE
      )
    `,
		).run();
		console.log('✓ Created polls table');
	}

	if (!tables.includes('poll_options')) {
		db.prepare(
			`
      CREATE TABLE poll_options (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pollId INTEGER NOT NULL,
        optionText TEXT NOT NULL,
        FOREIGN KEY (pollId) REFERENCES polls(id) ON DELETE CASCADE
      )
    `,
		).run();
		console.log('✓ Created poll_options table');
	}

	if (!tables.includes('poll_votes')) {
		db.prepare(
			`
      CREATE TABLE poll_votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pollId INTEGER NOT NULL,
        optionId INTEGER NOT NULL,
        userId INTEGER NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (pollId) REFERENCES polls(id) ON DELETE CASCADE,
        FOREIGN KEY (optionId) REFERENCES poll_options(id) ON DELETE CASCADE,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      )
    `,
		).run();
		console.log('✓ Created poll_votes table');
	}

	const pollIndexes = db
		.prepare("SELECT name FROM sqlite_master WHERE type='index'")
		.all()
		.map((row) => row.name);

	if (!pollIndexes.includes('idx_polls_message')) {
		db.prepare('CREATE INDEX idx_polls_message ON polls(messageId)').run();
		console.log('✓ Added idx_polls_message');
	}

	if (!pollIndexes.includes('idx_poll_options_poll')) {
		db.prepare(
			'CREATE INDEX idx_poll_options_poll ON poll_options(pollId)',
		).run();
		console.log('✓ Added idx_poll_options_poll');
	}

	if (!pollIndexes.includes('idx_poll_votes_poll')) {
		db.prepare('CREATE INDEX idx_poll_votes_poll ON poll_votes(pollId)').run();
		console.log('✓ Added idx_poll_votes_poll');
	}

	if (!pollIndexes.includes('idx_poll_votes_user')) {
		db.prepare('CREATE INDEX idx_poll_votes_user ON poll_votes(userId)').run();
		console.log('✓ Added idx_poll_votes_user');
	}

	if (!pollIndexes.includes('uniq_poll_votes_user')) {
		db.prepare(
			'CREATE UNIQUE INDEX uniq_poll_votes_user ON poll_votes(pollId, userId)',
		).run();
		console.log('✓ Added uniq_poll_votes_user');
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
