import db from '../database.js';

const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

export const createSession = (userId, { userAgent, ipAddress } = {}) => {
	const stmt = db.prepare(`
    INSERT INTO user_sessions (userId, userAgent, ipAddress)
    VALUES (?, ?, ?)
  `);
	const result = stmt.run(userId, userAgent || '', ipAddress || '');
	return result.lastInsertRowid;
};

export const getActiveSession = (sessionId) => {
	return db
		.prepare('SELECT * FROM user_sessions WHERE id = ? AND revokedAt IS NULL')
		.get(sessionId);
};

export const touchSessionLastSeen = (sessionId) => {
	db.prepare(
		`UPDATE user_sessions
     SET lastSeenAt = CURRENT_TIMESTAMP
     WHERE id = ?
       AND (lastSeenAt IS NULL OR lastSeenAt < datetime('now', ?))`,
	).run(sessionId, `-${LAST_SEEN_THROTTLE_MS / 1000} seconds`);
};

export const listActiveSessions = (userId) => {
	return db
		.prepare(
			`SELECT id, userAgent, ipAddress, createdAt, lastSeenAt
       FROM user_sessions
       WHERE userId = ? AND revokedAt IS NULL
       ORDER BY lastSeenAt DESC`,
		)
		.all(userId);
};

export const revokeSession = (sessionId, userId) => {
	const result = db
		.prepare(
			`UPDATE user_sessions
       SET revokedAt = CURRENT_TIMESTAMP
       WHERE id = ? AND userId = ? AND revokedAt IS NULL`,
		)
		.run(sessionId, userId);
	return result.changes > 0;
};

export const revokeOtherSessions = (userId, exceptSessionId) => {
	const result = db
		.prepare(
			`UPDATE user_sessions
       SET revokedAt = CURRENT_TIMESTAMP
       WHERE userId = ? AND id != ? AND revokedAt IS NULL`,
		)
		.run(userId, exceptSessionId);
	return result.changes;
};
