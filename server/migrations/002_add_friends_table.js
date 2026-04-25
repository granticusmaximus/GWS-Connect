import db from '../src/database.js';

console.log('Running migration: Add friends table');

try {
	// Create friends table
	db.exec(`
    CREATE TABLE IF NOT EXISTS friends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      friendId INTEGER NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (friendId) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(userId, friendId)
    );
  `);

	// Create index for faster lookups
	db.exec(`
    CREATE INDEX IF NOT EXISTS idx_friends_userId ON friends(userId);
    CREATE INDEX IF NOT EXISTS idx_friends_friendId ON friends(friendId);
    CREATE INDEX IF NOT EXISTS idx_friends_status ON friends(status);
  `);

	console.log('✓ Friends table created successfully');
	console.log('✓ Friends indexes created successfully');
} catch (error) {
	console.error('Migration failed:', error);
	throw error;
}
