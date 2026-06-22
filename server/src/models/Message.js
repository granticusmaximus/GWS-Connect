import db from '../database.js';
import { findUserByUsername } from './User.js';

const mentionRegex = /@([A-Za-z0-9._-]+)/g;
const messageThreadSelect = `
    SELECT
      m.id,
      m.senderId,
      m.channelId,
      m.recipientId,
      m.replyToMessageId,
      m.threadRootMessageId,
      m.content,
      m.fileUrl,
      m.fileName,
      m.fileType,
      m.isEncrypted,
      m.isDeleted,
      m.isArchived,
      m.createdAt,
      u.username as senderUsername,
      u.avatar as senderAvatar,
      p.question as pollQuestion
    FROM messages m
    JOIN users u ON m.senderId = u.id
    LEFT JOIN polls p ON p.messageId = m.id
`;

const toReplyContext = (message) => {
	if (!message) return null;

	return {
		id: message.id.toString(),
		senderId: message.senderId?.toString?.() || String(message.senderId),
		senderName: message.senderUsername,
		senderAvatar: message.senderAvatar || null,
		content: message.content,
		fileUrl: message.fileUrl || null,
		fileName: message.fileName || null,
		fileType: message.fileType || null,
		pollQuestion: message.pollQuestion || null,
		isEncrypted: message.isEncrypted,
		isDeleted: message.isDeleted,
		timestamp: message.createdAt,
	};
};

export const createMessage = (
	content,
	senderId,
	channelId = null,
	recipientId = null,
	fileUrl = null,
	fileName = null,
	fileType = null,
	filePath = null,
	cipherText = null,
	cipherIv = null,
	isEncrypted = 0,
	replyToMessageId = null,
	threadRootMessageId = null,
	groupChatId = null,
) => {
	const stmt = db.prepare(`
    INSERT INTO messages (content, senderId, channelId, recipientId, groupChatId, replyToMessageId, threadRootMessageId, fileUrl, fileName, fileType, filePath, cipherText, cipherIv, isEncrypted)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
	const result = stmt.run(
		content,
		senderId,
		channelId,
		recipientId,
		groupChatId,
		replyToMessageId,
		threadRootMessageId,
		fileUrl,
		fileName,
		fileType,
		filePath,
		cipherText,
		cipherIv,
		isEncrypted,
	);
	return result.lastInsertRowid;
};

export const getGroupChatMessages = (groupChatId, limit = 100) => {
	const stmt = db.prepare(`
    SELECT *
    FROM (
      SELECT m.*, u.username as senderUsername, u.avatar as senderAvatar
      FROM messages m
      JOIN users u ON m.senderId = u.id
      WHERE m.groupChatId = ? AND m.isArchived = 0
      ORDER BY datetime(m.createdAt) DESC, m.id DESC
      LIMIT ?
    ) recent_messages
    ORDER BY datetime(createdAt) ASC, id ASC
  `);
	return stmt.all(groupChatId, limit);
};

export const getChannelMessages = (channelId, limit = 100) => {
	const stmt = db.prepare(`
    SELECT *
    FROM (
      SELECT m.*, u.username as senderUsername, u.avatar as senderAvatar
      FROM messages m
      JOIN users u ON m.senderId = u.id
      WHERE m.channelId = ? AND m.isArchived = 0
      ORDER BY datetime(m.createdAt) DESC, m.id DESC
      LIMIT ?
    ) recent_messages
    ORDER BY datetime(createdAt) ASC, id ASC
  `);
	return stmt.all(channelId, limit);
};

export const getDirectMessages = (userId1, userId2, limit = 100) => {
	const stmt = db.prepare(`
    SELECT *
    FROM (
      SELECT m.*, u.username as senderUsername, u.avatar as senderAvatar
      FROM messages m
      JOIN users u ON m.senderId = u.id
      WHERE (
        (m.senderId = ? AND m.recipientId = ?)
        OR (m.senderId = ? AND m.recipientId = ?)
      )
      AND m.isArchived = 0
      ORDER BY datetime(m.createdAt) DESC, m.id DESC
      LIMIT ?
    ) recent_messages
    ORDER BY datetime(createdAt) ASC, id ASC
  `);
	return stmt.all(userId1, userId2, userId2, userId1, limit);
};

const ensureDirectConversationVisitsForUser = (userId, peerUserIds) => {
	if (!Array.isArray(peerUserIds) || peerUserIds.length === 0) {
		return;
	}

	const insert = db.prepare(`
    INSERT OR IGNORE INTO direct_message_visits (userId, peerUserId, lastVisitedAt)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `);

	peerUserIds.forEach((peerUserId) => {
		insert.run(userId, peerUserId);
	});
};

export const getDirectConversationSummaries = (userId) => {
	const conversationRows = db
		.prepare(
			`
      SELECT
        CASE
          WHEN m.senderId = ? THEN m.recipientId
          ELSE m.senderId
        END AS peerUserId,
        MAX(m.createdAt) AS lastMessageAt
      FROM messages m
      WHERE m.recipientId IS NOT NULL
        AND m.isArchived = 0
        AND (m.senderId = ? OR m.recipientId = ?)
      GROUP BY peerUserId
      ORDER BY lastMessageAt DESC
    `,
		)
		.all(userId, userId, userId);

	const peerUserIds = conversationRows
		.map((row) => row.peerUserId)
		.filter((value) => value !== null && value !== undefined);

	ensureDirectConversationVisitsForUser(userId, peerUserIds);

	const unreadByPeerUserId = new Map();

	if (peerUserIds.length > 0) {
		const placeholders = peerUserIds.map(() => '?').join(', ');
		const unreadRows = db
			.prepare(
				`
          SELECT
            m.senderId AS peerUserId,
            COUNT(*) AS unreadCount
          FROM messages m
          JOIN direct_message_visits dv
            ON dv.peerUserId = m.senderId
           AND dv.userId = ?
          WHERE m.senderId IN (${placeholders})
            AND m.recipientId = ?
            AND m.isArchived = 0
            AND datetime(m.createdAt) > datetime(dv.lastVisitedAt)
          GROUP BY m.senderId
        `,
			)
			.all(userId, ...peerUserIds, userId);

		unreadRows.forEach((row) => {
			unreadByPeerUserId.set(String(row.peerUserId), Number(row.unreadCount) || 0);
		});
	}

	return conversationRows.map((row) => {
		const peerUserId = String(row.peerUserId);
		const user = db
			.prepare(
				`
          SELECT id, username, avatar
          FROM users
          WHERE id = ?
        `,
			)
			.get(row.peerUserId);

		return {
			id: peerUserId,
			userId: peerUserId,
			username: user?.username || 'Unknown',
			avatar: user?.avatar || null,
			lastMessageAt: row.lastMessageAt || null,
			unreadCount: unreadByPeerUserId.get(peerUserId) || 0,
		};
	});
};

export const markDirectConversationVisited = (userId, peerUserId) => {
	db.prepare(
		`
      INSERT INTO direct_message_visits (userId, peerUserId, lastVisitedAt)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(userId, peerUserId) DO UPDATE SET
        lastVisitedAt = CURRENT_TIMESTAMP
    `,
	).run(userId, peerUserId);
};

export const getMessageById = (messageId) => {
	const stmt = db.prepare(
		`SELECT id, senderId, channelId, recipientId, replyToMessageId, threadRootMessageId, content, fileUrl, fileName, fileType, isDeleted, isArchived, isEncrypted
     FROM messages
     WHERE id = ?`,
	);
	return stmt.get(messageId);
};

export const getMessageThreadRecordById = (messageId) => {
	const stmt = db.prepare(`${messageThreadSelect} WHERE m.id = ?`);
	return stmt.get(messageId);
};

export const getMessageThreadRecordsByIds = (messageIds) => {
	if (!Array.isArray(messageIds) || messageIds.length === 0) {
		return [];
	}

	const placeholders = messageIds.map(() => '?').join(', ');
	const stmt = db.prepare(
		`${messageThreadSelect}
     WHERE m.id IN (${placeholders})
     ORDER BY m.createdAt ASC`,
	);
	return stmt.all(...messageIds);
};

export const getReplyContextByMessageId = (messageId) =>
	toReplyContext(getMessageThreadRecordById(messageId));

export const getMessageFileById = (messageId) => {
	const stmt = db.prepare(
		`SELECT id, senderId, channelId, recipientId, fileUrl, fileName, fileType, filePath, createdAt
     FROM messages
     WHERE id = ?`,
	);
	return stmt.get(messageId);
};

export const updateMessageFileInfo = (messageId, fileUrl, filePath) => {
	const stmt = db.prepare(
		`UPDATE messages
     SET fileUrl = ?, filePath = ?
     WHERE id = ?`,
	);
	stmt.run(fileUrl, filePath, messageId);
};

export const updateMessageContent = (messageId, content) => {
	const stmt = db.prepare(
		`UPDATE messages
	 SET content = ?, editedAt = CURRENT_TIMESTAMP
	 WHERE id = ?`,
	);
	stmt.run(content, messageId);
};

export const syncMessageMentions = (messageId, content) => {
	const deleteStmt = db.prepare(
		'DELETE FROM message_mentions WHERE messageId = ?',
	);
	deleteStmt.run(messageId);

	if (!content) {
		return [];
	}

	const insertStmt = db.prepare(
		`INSERT INTO message_mentions (messageId, userId, username, startIndex, endIndex)
		 VALUES (?, ?, ?, ?, ?)`,
	);
	const mentions = [];
	let match;

	mentionRegex.lastIndex = 0;

	while ((match = mentionRegex.exec(content)) !== null) {
		const mentionedUser = findUserByUsername(match[1]);
		if (!mentionedUser) {
			continue;
		}

		insertStmt.run(
			messageId,
			mentionedUser.id,
			mentionedUser.username,
			match.index,
			mentionRegex.lastIndex,
		);

		mentions.push({
			userId: mentionedUser.id.toString(),
			username: mentionedUser.username,
			avatar: mentionedUser.avatar || null,
			startIndex: match.index,
			endIndex: mentionRegex.lastIndex,
		});
	}

	return mentions;
};

export const getMessageMentions = (messageIds) => {
	if (!Array.isArray(messageIds) || messageIds.length === 0) {
		return [];
	}

	const placeholders = messageIds.map(() => '?').join(', ');
	const stmt = db.prepare(
		`SELECT
			mm.messageId,
			mm.userId,
			mm.username,
			mm.startIndex,
			mm.endIndex,
			u.avatar
		 FROM message_mentions mm
		 JOIN users u ON u.id = mm.userId
		 WHERE mm.messageId IN (${placeholders})
		 ORDER BY mm.messageId ASC, mm.startIndex ASC`,
	);

	return stmt.all(...messageIds).map((row) => ({
		messageId: row.messageId.toString(),
		userId: row.userId.toString(),
		username: row.username,
		avatar: row.avatar || null,
		startIndex: row.startIndex,
		endIndex: row.endIndex,
	}));
};

export const getReplyContextsByMessageIds = (messageIds) =>
	getMessageThreadRecordsByIds(messageIds).reduce((accumulator, message) => {
		accumulator.set(message.id.toString(), toReplyContext(message));
		return accumulator;
	}, new Map());

export const markMessageDeleted = (messageId) => {
	const stmt = db.prepare(
		`UPDATE messages
	 SET content = '',
		 fileUrl = NULL,
		 fileName = NULL,
		 fileType = NULL,
		 filePath = NULL,
		 cipherText = NULL,
		 cipherIv = NULL,
		 isDeleted = 1,
		 deletedAt = CURRENT_TIMESTAMP
	 WHERE id = ?`,
	);
	stmt.run(messageId);
};

export const markMessageArchived = (messageId) => {
	const stmt = db.prepare(
		`UPDATE messages
	 SET isArchived = 1,
		 archivedAt = CURRENT_TIMESTAMP
	 WHERE id = ?`,
	);
	stmt.run(messageId);
};

export const togglePinMessage = (messageId, userId) => {
	const message = db.prepare('SELECT isPinned FROM messages WHERE id = ?').get(messageId);
	if (!message) {
		return null;
	}

	const nextPinned = message.isPinned ? 0 : 1;
	db.prepare(
		`UPDATE messages
	 SET isPinned = ?,
		 pinnedAt = ?,
		 pinnedBy = ?
	 WHERE id = ?`,
	).run(
		nextPinned,
		nextPinned ? new Date().toISOString() : null,
		nextPinned ? userId : null,
		messageId,
	);

	return { isPinned: nextPinned, pinnedAt: nextPinned ? new Date().toISOString() : null };
};

export const searchMessages = (
	query,
	{ channelId = null, recipientId = null, groupChatId = null, currentUserId },
) => {
	const likeTerm = `%${query.replace(/[%_]/g, '\\$&')}%`;

	if (channelId) {
		return db
			.prepare(
				`SELECT m.*, u.username as senderUsername, u.avatar as senderAvatar
		 FROM messages m
		 JOIN users u ON m.senderId = u.id
		 WHERE m.channelId = ?
		   AND m.isDeleted = 0 AND m.isEncrypted = 0
		   AND m.content LIKE ? ESCAPE '\\'
		 ORDER BY datetime(m.createdAt) DESC
		 LIMIT 50`,
			)
			.all(channelId, likeTerm);
	}

	if (groupChatId) {
		return db
			.prepare(
				`SELECT m.*, u.username as senderUsername, u.avatar as senderAvatar
		 FROM messages m
		 JOIN users u ON m.senderId = u.id
		 WHERE m.groupChatId = ?
		   AND m.isDeleted = 0 AND m.isEncrypted = 0
		   AND m.content LIKE ? ESCAPE '\\'
		 ORDER BY datetime(m.createdAt) DESC
		 LIMIT 50`,
			)
			.all(groupChatId, likeTerm);
	}

	return db
		.prepare(
			`SELECT m.*, u.username as senderUsername, u.avatar as senderAvatar
	 FROM messages m
	 JOIN users u ON m.senderId = u.id
	 WHERE m.recipientId IS NOT NULL
	   AND m.isDeleted = 0 AND m.isEncrypted = 0
	   AND ((m.senderId = ? AND m.recipientId = ?) OR (m.senderId = ? AND m.recipientId = ?))
	   AND m.content LIKE ? ESCAPE '\\'
	 ORDER BY datetime(m.createdAt) DESC
	 LIMIT 50`,
		)
		.all(currentUserId, recipientId, recipientId, currentUserId, likeTerm);
};

export const getPinnedMessages = (channelId, recipientId, currentUserId, groupChatId = null) => {
	if (channelId) {
		return db
			.prepare(
				`SELECT m.*, u.username as senderUsername, u.avatar as senderAvatar
		 FROM messages m
		 JOIN users u ON m.senderId = u.id
		 WHERE m.channelId = ? AND m.isPinned = 1 AND m.isDeleted = 0
		 ORDER BY datetime(m.pinnedAt) DESC`,
			)
			.all(channelId);
	}

	if (groupChatId) {
		return db
			.prepare(
				`SELECT m.*, u.username as senderUsername, u.avatar as senderAvatar
		 FROM messages m
		 JOIN users u ON m.senderId = u.id
		 WHERE m.groupChatId = ? AND m.isPinned = 1 AND m.isDeleted = 0
		 ORDER BY datetime(m.pinnedAt) DESC`,
			)
			.all(groupChatId);
	}

	return db
		.prepare(
			`SELECT m.*, u.username as senderUsername, u.avatar as senderAvatar
	 FROM messages m
	 JOIN users u ON m.senderId = u.id
	 WHERE m.recipientId IS NOT NULL
	   AND m.isPinned = 1 AND m.isDeleted = 0
	   AND ((m.senderId = ? AND m.recipientId = ?) OR (m.senderId = ? AND m.recipientId = ?))
	 ORDER BY datetime(m.pinnedAt) DESC`,
		)
		.all(currentUserId, recipientId, recipientId, currentUserId);
};

export const getChannelFiles = (channelId, limit = 200) => {
	const stmt = db.prepare(
		`SELECT m.id, m.fileUrl, m.fileName, m.fileType, m.createdAt,
            u.username as senderUsername, u.avatar as senderAvatar
     FROM messages m
     JOIN users u ON m.senderId = u.id
     WHERE m.channelId = ? AND m.fileUrl IS NOT NULL
     ORDER BY m.createdAt DESC
     LIMIT ?`,
	);
	return stmt.all(channelId, limit);
};

export const getDirectFiles = (userId1, userId2, limit = 200) => {
	const stmt = db.prepare(
		`SELECT m.id, m.fileUrl, m.fileName, m.fileType, m.createdAt,
            u.username as senderUsername, u.avatar as senderAvatar
     FROM messages m
     JOIN users u ON m.senderId = u.id
     WHERE ((m.senderId = ? AND m.recipientId = ?) OR (m.senderId = ? AND m.recipientId = ?))
       AND m.fileUrl IS NOT NULL
     ORDER BY m.createdAt DESC
     LIMIT ?`,
	);
	return stmt.all(userId1, userId2, userId2, userId1, limit);
};
