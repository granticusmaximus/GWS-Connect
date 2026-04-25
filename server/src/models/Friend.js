import db from '../database.js';

// Send friend request
export const sendFriendRequest = (userId, friendId) => {
	const stmt = db.prepare(`
    INSERT INTO friends (userId, friendId, status)
    VALUES (?, ?, 'pending')
  `);
	const result = stmt.run(userId, friendId);
	return result.lastInsertRowid;
};

// Accept friend request
export const acceptFriendRequest = (userId, friendId) => {
	// Update the friend request to accepted
	const stmt = db.prepare(`
    UPDATE friends
    SET status = 'accepted'
    WHERE userId = ? AND friendId = ?
  `);
	stmt.run(friendId, userId);

	// Create reciprocal friendship
	try {
		const reciprocalStmt = db.prepare(`
      INSERT INTO friends (userId, friendId, status)
      VALUES (?, ?, 'accepted')
    `);
		reciprocalStmt.run(userId, friendId);
	} catch (error) {
		// If already exists, update it
		if (error.code === 'SQLITE_CONSTRAINT') {
			const updateStmt = db.prepare(`
        UPDATE friends
        SET status = 'accepted'
        WHERE userId = ? AND friendId = ?
      `);
			updateStmt.run(userId, friendId);
		} else {
			throw error;
		}
	}
};

// Reject friend request
export const rejectFriendRequest = (userId, friendId) => {
	const stmt = db.prepare(`
    UPDATE friends
    SET status = 'rejected'
    WHERE userId = ? AND friendId = ?
  `);
	return stmt.run(friendId, userId);
};

// Cancel sent friend request
export const cancelFriendRequest = (userId, friendId) => {
	const stmt = db.prepare(`
    DELETE FROM friends
    WHERE userId = ? AND friendId = ? AND status = 'pending'
  `);
	return stmt.run(userId, friendId);
};

// Remove friend
export const removeFriend = (userId, friendId) => {
	const stmt = db.prepare(`
    DELETE FROM friends
    WHERE (userId = ? AND friendId = ?)
       OR (userId = ? AND friendId = ?)
  `);
	return stmt.run(userId, friendId, friendId, userId);
};

// Get all friends (accepted only)
export const getFriends = (userId) => {
	const stmt = db.prepare(`
    SELECT u.id, u.username, u.avatar, u.bio
    FROM friends f
    JOIN users u ON f.friendId = u.id
    WHERE f.userId = ? AND f.status = 'accepted'
    ORDER BY u.username ASC
  `);
	return stmt.all(userId);
};

// Get pending friend requests (received)
export const getPendingRequests = (userId) => {
	const stmt = db.prepare(`
    SELECT u.id, u.username, u.avatar, u.bio, f.createdAt
    FROM friends f
    JOIN users u ON f.userId = u.id
    WHERE f.friendId = ? AND f.status = 'pending'
    ORDER BY f.createdAt DESC
  `);
	return stmt.all(userId);
};

// Get sent friend requests
export const getSentRequests = (userId) => {
	const stmt = db.prepare(`
    SELECT u.id, u.username, u.avatar, u.bio, f.status, f.createdAt
    FROM friends f
    JOIN users u ON f.friendId = u.id
    WHERE f.userId = ? AND f.status = 'pending'
    ORDER BY f.createdAt DESC
  `);
	return stmt.all(userId);
};

// Check friendship status
export const getFriendshipStatus = (userId, friendId) => {
	// Check if current user sent request to friend
	const outgoing = db
		.prepare(
			`
    SELECT status
    FROM friends
    WHERE userId = ? AND friendId = ?
  `,
		)
		.get(userId, friendId);

	if (outgoing) {
		return outgoing;
	}

	// Check if friend sent request to current user
	const incoming = db
		.prepare(
			`
    SELECT status
    FROM friends
    WHERE userId = ? AND friendId = ?
  `,
		)
		.get(friendId, userId);

	if (incoming && incoming.status === 'pending') {
		return { status: 'pending_incoming' };
	}

	if (incoming) {
		return incoming;
	}

	return null;
};

// Get mutual friends
export const getMutualFriends = (userId, otherUserId) => {
	const stmt = db.prepare(`
    SELECT DISTINCT u.id, u.username, u.avatar
    FROM friends f1
    JOIN friends f2 ON f1.friendId = f2.friendId
    JOIN users u ON f1.friendId = u.id
    WHERE f1.userId = ? AND f2.userId = ?
      AND f1.status = 'accepted' AND f2.status = 'accepted'
    ORDER BY u.username ASC
  `);
	return stmt.all(userId, otherUserId);
};

// Search for users (excluding current user)
export const searchUsers = (searchQuery, currentUserId) => {
	const stmt = db.prepare(`
    SELECT id, username, avatar, bio
    FROM users
    WHERE (username LIKE ? OR email LIKE ?)
      AND id != ?
    LIMIT 20
  `);
	return stmt.all(`%${searchQuery}%`, `%${searchQuery}%`, currentUserId);
};
