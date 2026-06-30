import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const DEFAULT_AVATAR = '/image.png';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath =
	process.env.DB_PATH || path.join(__dirname, '..', 'data', 'gws-connect.db');

// Ensure the data directory exists
const dbDir = path.dirname(dbPath);
mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user' CHECK(role IN ('user', 'manager', 'admin')),
    avatar TEXT DEFAULT '${DEFAULT_AVATAR}',
    banner TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    e2eePublicKey TEXT,
    e2eeEncryptedPrivateKey TEXT,
    e2eeSalt TEXT,
    e2eeIv TEXT,
    theme TEXT DEFAULT 'light' CHECK(theme IN ('light', 'dark')),
    interests TEXT DEFAULT '[]',
    socialLinks TEXT DEFAULT '{}',
    contactInfo TEXT DEFAULT '{}',
    mustChangePassword INTEGER DEFAULT 0 CHECK(mustChangePassword IN (0, 1)),
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    createdBy INTEGER NOT NULL,
    isPrivate INTEGER DEFAULT 0 CHECK(isPrivate IN (0, 1)),
    status TEXT DEFAULT 'approved' CHECK(status IN ('pending', 'approved', 'rejected')),
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS channel_members (
    channelId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    joinedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (channelId, userId),
    FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS channel_managers (
    channelId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    assignedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    assignedBy INTEGER NOT NULL,
    PRIMARY KEY (channelId, userId),
    FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (assignedBy) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS channel_bans (
    channelId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    bannedBy INTEGER NOT NULL,
    bannedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    reason TEXT,
    PRIMARY KEY (channelId, userId),
    FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (bannedBy) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS channel_mutes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channelId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    mutedBy INTEGER NOT NULL,
    mutedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    expiresAt DATETIME NOT NULL,
    reason TEXT,
    FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (mutedBy) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    senderId INTEGER NOT NULL,
    channelId INTEGER,
    recipientId INTEGER,
    replyToMessageId INTEGER,
    threadRootMessageId INTEGER,
    fileUrl TEXT,
    fileName TEXT,
    fileType TEXT,
    filePath TEXT,
    cipherText TEXT,
    cipherIv TEXT,
    isEncrypted INTEGER DEFAULT 0 CHECK(isEncrypted IN (0, 1)),
    editedAt DATETIME,
    isDeleted INTEGER DEFAULT 0 CHECK(isDeleted IN (0, 1)),
    deletedAt DATETIME,
    isArchived INTEGER DEFAULT 0 CHECK(isArchived IN (0, 1)),
    archivedAt DATETIME,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (senderId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE,
    FOREIGN KEY (recipientId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (replyToMessageId) REFERENCES messages(id) ON DELETE SET NULL,
    FOREIGN KEY (threadRootMessageId) REFERENCES messages(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channelId);
  CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipientId);
  CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(senderId);
  CREATE INDEX IF NOT EXISTS idx_messages_file ON messages(fileUrl);
  CREATE TABLE IF NOT EXISTS message_mentions (
    messageId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    username TEXT NOT NULL,
    startIndex INTEGER NOT NULL,
    endIndex INTEGER NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (messageId, startIndex, endIndex),
    FOREIGN KEY (messageId) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_message_mentions_message ON message_mentions(messageId);
  CREATE INDEX IF NOT EXISTS idx_message_mentions_user ON message_mentions(userId);
  CREATE INDEX IF NOT EXISTS idx_channel_managers ON channel_managers(channelId, userId);
  CREATE INDEX IF NOT EXISTS idx_channel_bans ON channel_bans(channelId, userId);
  CREATE INDEX IF NOT EXISTS idx_channel_mutes ON channel_mutes(channelId, userId, expiresAt);

  CREATE TABLE IF NOT EXISTS message_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    messageId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    reaction TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (messageId) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(messageId);
  CREATE INDEX IF NOT EXISTS idx_message_reactions_user ON message_reactions(userId);
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_message_reactions ON message_reactions(messageId, userId, reaction);

  CREATE TABLE IF NOT EXISTS polls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    messageId INTEGER NOT NULL,
    createdBy INTEGER NOT NULL,
    question TEXT NOT NULL,
    expiresAt DATETIME,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (messageId) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS poll_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pollId INTEGER NOT NULL,
    optionText TEXT NOT NULL,
    FOREIGN KEY (pollId) REFERENCES polls(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS poll_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pollId INTEGER NOT NULL,
    optionId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pollId) REFERENCES polls(id) ON DELETE CASCADE,
    FOREIGN KEY (optionId) REFERENCES poll_options(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_polls_message ON polls(messageId);
  CREATE INDEX IF NOT EXISTS idx_poll_options_poll ON poll_options(pollId);
  CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON poll_votes(pollId);
  CREATE INDEX IF NOT EXISTS idx_poll_votes_user ON poll_votes(userId);
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_poll_votes_user ON poll_votes(pollId, userId);

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    userAgent TEXT DEFAULT '',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(userId);

  CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    userAgent TEXT DEFAULT '',
    ipAddress TEXT DEFAULT '',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    lastSeenAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    revokedAt DATETIME,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(userId, revokedAt);

  CREATE TABLE IF NOT EXISTS user_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('mention', 'reaction', 'reply')),
    actorId INTEGER NOT NULL,
    messageId INTEGER NOT NULL,
    sourceMessageId INTEGER,
    channelId INTEGER,
    directUserId INTEGER,
    reaction TEXT,
    isRead INTEGER DEFAULT 0 CHECK(isRead IN (0, 1)),
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    readAt DATETIME,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (actorId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (messageId) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (sourceMessageId) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE,
    FOREIGN KEY (directUserId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created
    ON user_notifications(userId, createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_user_notifications_user_read
    ON user_notifications(userId, isRead, createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_user_notifications_message
    ON user_notifications(messageId);

  CREATE TABLE IF NOT EXISTS password_reset_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    email TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'dismissed')),
    requestedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolvedAt DATETIME,
    resolvedBy INTEGER,
    notes TEXT DEFAULT '',
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (resolvedBy) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_password_reset_requests_status ON password_reset_requests(status, requestedAt);
  CREATE INDEX IF NOT EXISTS idx_password_reset_requests_user ON password_reset_requests(userId, status);

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

  CREATE INDEX IF NOT EXISTS idx_friends_userId ON friends(userId);
  CREATE INDEX IF NOT EXISTS idx_friends_friendId ON friends(friendId);
  CREATE INDEX IF NOT EXISTS idx_friends_status ON friends(status);
`);

const channelColumns = db
	.prepare("PRAGMA table_info('channels')")
	.all()
	.map((column) => column.name);

if (!channelColumns.includes('slowModeSeconds')) {
	db.prepare(
		'ALTER TABLE channels ADD COLUMN slowModeSeconds INTEGER DEFAULT 0',
	).run();
}

if (!channelColumns.includes('disappearingMessagesSeconds')) {
	db.prepare(
		'ALTER TABLE channels ADD COLUMN disappearingMessagesSeconds INTEGER DEFAULT 0',
	).run();
}

if (!channelColumns.includes('currentKeyGeneration')) {
	db.prepare(
		'ALTER TABLE channels ADD COLUMN currentKeyGeneration INTEGER DEFAULT 1',
	).run();
}

if (!channelColumns.includes('keyGenerationRotatedAt')) {
	// SQLite can reject a non-constant ALTER TABLE ADD COLUMN default
	// (CURRENT_TIMESTAMP) depending on the table's on-disk history - add the
	// column bare, then backfill, rather than relying on the ALTER's default.
	db.prepare('ALTER TABLE channels ADD COLUMN keyGenerationRotatedAt DATETIME').run();
	db.prepare(
		'UPDATE channels SET keyGenerationRotatedAt = CURRENT_TIMESTAMP WHERE keyGenerationRotatedAt IS NULL',
	).run();
}

const messageColumns = db
	.prepare("PRAGMA table_info('messages')")
	.all()
	.map((column) => column.name);

if (!messageColumns.includes('replyToMessageId')) {
	db.prepare('ALTER TABLE messages ADD COLUMN replyToMessageId INTEGER').run();
}

if (!messageColumns.includes('threadRootMessageId')) {
	db.prepare('ALTER TABLE messages ADD COLUMN threadRootMessageId INTEGER').run();
}

const userColumns = db
	.prepare("PRAGMA table_info('users')")
	.all()
	.map((column) => column.name);

if (!userColumns.includes('failedLoginAttempts')) {
	db.prepare(
		'ALTER TABLE users ADD COLUMN failedLoginAttempts INTEGER DEFAULT 0',
	).run();
}

if (!userColumns.includes('lockedUntil')) {
	db.prepare('ALTER TABLE users ADD COLUMN lockedUntil DATETIME').run();
}

if (!userColumns.includes('twoFactorEnabled')) {
	db.prepare(
		'ALTER TABLE users ADD COLUMN twoFactorEnabled INTEGER DEFAULT 0',
	).run();
}

if (!userColumns.includes('twoFactorSecret')) {
	db.prepare('ALTER TABLE users ADD COLUMN twoFactorSecret TEXT').run();
}

if (!userColumns.includes('pendingTwoFactorSecret')) {
	db.prepare(
		'ALTER TABLE users ADD COLUMN pendingTwoFactorSecret TEXT',
	).run();
}

db.exec(`
  CREATE TABLE IF NOT EXISTS two_factor_backup_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    codeHash TEXT NOT NULL,
    usedAt DATETIME,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_two_factor_backup_codes_user ON two_factor_backup_codes(userId);
`);

if (!messageColumns.includes('isPinned')) {
	db.prepare('ALTER TABLE messages ADD COLUMN isPinned INTEGER DEFAULT 0').run();
}

if (!messageColumns.includes('pinnedAt')) {
	db.prepare('ALTER TABLE messages ADD COLUMN pinnedAt DATETIME').run();
}

if (!messageColumns.includes('pinnedBy')) {
	db.prepare('ALTER TABLE messages ADD COLUMN pinnedBy INTEGER').run();
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_messages_pinned ON messages(channelId, recipientId, isPinned);
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(replyToMessageId);
  CREATE INDEX IF NOT EXISTS idx_messages_thread_root ON messages(threadRootMessageId);

  CREATE TABLE IF NOT EXISTS channel_visits (
    userId INTEGER NOT NULL,
    channelId INTEGER NOT NULL,
    lastVisitedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (userId, channelId),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_channel_visits_channel
    ON channel_visits(channelId, userId, lastVisitedAt);

  CREATE TABLE IF NOT EXISTS direct_message_visits (
    userId INTEGER NOT NULL,
    peerUserId INTEGER NOT NULL,
    lastVisitedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (userId, peerUserId),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (peerUserId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_direct_message_visits_peer
    ON direct_message_visits(peerUserId, userId, lastVisitedAt);

  CREATE TABLE IF NOT EXISTS group_chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    createdBy INTEGER NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS group_chat_members (
    groupChatId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    joinedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (groupChatId, userId),
    FOREIGN KEY (groupChatId) REFERENCES group_chats(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_group_chat_members_user ON group_chat_members(userId);

  CREATE TABLE IF NOT EXISTS group_chat_visits (
    userId INTEGER NOT NULL,
    groupChatId INTEGER NOT NULL,
    lastVisitedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (userId, groupChatId),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (groupChatId) REFERENCES group_chats(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_group_chat_visits_group
    ON group_chat_visits(groupChatId, userId, lastVisitedAt);

  CREATE TABLE IF NOT EXISTS group_chat_keys (
    groupChatId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    wrappedKey TEXT NOT NULL,
    wrappedIv TEXT NOT NULL,
    wrappedByUserId INTEGER NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (groupChatId, userId),
    FOREIGN KEY (groupChatId) REFERENCES group_chats(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (wrappedByUserId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS channel_keys (
    channelId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    wrappedKey TEXT NOT NULL,
    wrappedIv TEXT NOT NULL,
    wrappedByUserId INTEGER NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (channelId, userId),
    FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (wrappedByUserId) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Superset of group_chat_keys/channel_keys: keeps every key generation
  -- rather than just the latest, so key rotation (on membership removal or
  -- periodically) can't break decryption of messages sent under an older
  -- generation. The older tables above are left in place but unused by new
  -- code going forward.
  CREATE TABLE IF NOT EXISTS group_chat_key_generations (
    groupChatId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    keyGeneration INTEGER NOT NULL,
    wrappedKey TEXT NOT NULL,
    wrappedIv TEXT NOT NULL,
    wrappedByUserId INTEGER NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (groupChatId, userId, keyGeneration),
    FOREIGN KEY (groupChatId) REFERENCES group_chats(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (wrappedByUserId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS channel_key_generations (
    channelId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    keyGeneration INTEGER NOT NULL,
    wrappedKey TEXT NOT NULL,
    wrappedIv TEXT NOT NULL,
    wrappedByUserId INTEGER NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (channelId, userId, keyGeneration),
    FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (wrappedByUserId) REFERENCES users(id) ON DELETE CASCADE
  );

  INSERT OR IGNORE INTO channel_key_generations
    (channelId, userId, keyGeneration, wrappedKey, wrappedIv, wrappedByUserId, createdAt)
  SELECT channelId, userId, 1, wrappedKey, wrappedIv, wrappedByUserId, createdAt
  FROM channel_keys;

  INSERT OR IGNORE INTO group_chat_key_generations
    (groupChatId, userId, keyGeneration, wrappedKey, wrappedIv, wrappedByUserId, createdAt)
  SELECT groupChatId, userId, 1, wrappedKey, wrappedIv, wrappedByUserId, createdAt
  FROM group_chat_keys;

  CREATE TABLE IF NOT EXISTS invite_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    targetType TEXT NOT NULL CHECK(targetType IN ('channel', 'group')),
    targetId INTEGER NOT NULL,
    createdBy INTEGER NOT NULL,
    maxUses INTEGER,
    useCount INTEGER DEFAULT 0,
    expiresAt DATETIME,
    revokedAt DATETIME,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_invite_links_target ON invite_links(targetType, targetId);
`);

if (!messageColumns.includes('groupChatId')) {
	db.prepare('ALTER TABLE messages ADD COLUMN groupChatId INTEGER').run();
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_messages_group_chat ON messages(groupChatId);
`);

const groupChatColumns = db
	.prepare("PRAGMA table_info('group_chats')")
	.all()
	.map((column) => column.name);

if (!groupChatColumns.includes('disappearingMessagesSeconds')) {
	db.prepare(
		'ALTER TABLE group_chats ADD COLUMN disappearingMessagesSeconds INTEGER DEFAULT 0',
	).run();
}

if (!groupChatColumns.includes('currentKeyGeneration')) {
	db.prepare(
		'ALTER TABLE group_chats ADD COLUMN currentKeyGeneration INTEGER DEFAULT 1',
	).run();
}

if (!groupChatColumns.includes('keyGenerationRotatedAt')) {
	db.prepare('ALTER TABLE group_chats ADD COLUMN keyGenerationRotatedAt DATETIME').run();
	db.prepare(
		'UPDATE group_chats SET keyGenerationRotatedAt = CURRENT_TIMESTAMP WHERE keyGenerationRotatedAt IS NULL',
	).run();
}

if (!messageColumns.includes('expiresAt')) {
	db.prepare('ALTER TABLE messages ADD COLUMN expiresAt DATETIME').run();
}

if (!messageColumns.includes('fileIv')) {
	db.prepare('ALTER TABLE messages ADD COLUMN fileIv TEXT').run();
}

if (!messageColumns.includes('keyGeneration')) {
	db.prepare('ALTER TABLE messages ADD COLUMN keyGeneration INTEGER').run();
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_messages_expires_at ON messages(expiresAt);

  CREATE TABLE IF NOT EXISTS direct_message_settings (
    userId1 INTEGER NOT NULL,
    userId2 INTEGER NOT NULL,
    disappearingMessagesSeconds INTEGER DEFAULT 0,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (userId1, userId2),
    FOREIGN KEY (userId1) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (userId2) REFERENCES users(id) ON DELETE CASCADE
  );
`);

db.prepare(
	`UPDATE users
   SET avatar = ?
   WHERE avatar IS NULL OR TRIM(avatar) = ''`,
).run(DEFAULT_AVATAR);

// FTS5 full-text search was removed because all messages are now E2EE
// (server never has access to decrypted content). The virtual table and
// triggers are dropped if they exist from a previous install so they no
// longer add overhead to every message INSERT/DELETE/UPDATE.
db.exec(`
  DROP TRIGGER IF EXISTS messages_fts_ai;
  DROP TRIGGER IF EXISTS messages_fts_ad;
  DROP TRIGGER IF EXISTS messages_fts_au;
  DROP TABLE IF EXISTS messages_fts;
`);

console.log('SQLite database initialized at:', dbPath);

export default db;
