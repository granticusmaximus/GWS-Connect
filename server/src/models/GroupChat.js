import db from '../database.js';

const ensureGroupChatVisitsForUser = (userId, groupChatIds) => {
	if (!Array.isArray(groupChatIds) || groupChatIds.length === 0) {
		return;
	}

	const insert = db.prepare(`
    INSERT OR IGNORE INTO group_chat_visits (userId, groupChatId, lastVisitedAt)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `);

	groupChatIds.forEach((groupChatId) => {
		insert.run(userId, groupChatId);
	});
};

const attachGroupChatReadState = (groupChats, userId) => {
	if (!Array.isArray(groupChats) || groupChats.length === 0) {
		return [];
	}

	const groupChatIds = groupChats.map((group) => group.id);
	ensureGroupChatVisitsForUser(userId, groupChatIds);

	const placeholders = groupChatIds.map(() => '?').join(', ');
	const unreadRows = db
		.prepare(
			`
      SELECT
        m.groupChatId,
        COUNT(*) AS unreadCount
      FROM messages m
      JOIN group_chat_visits gv
        ON gv.groupChatId = m.groupChatId
       AND gv.userId = ?
      WHERE m.groupChatId IN (${placeholders})
        AND m.isArchived = 0
        AND m.senderId != ?
        AND datetime(m.createdAt) > datetime(gv.lastVisitedAt)
      GROUP BY m.groupChatId
    `,
		)
		.all(userId, ...groupChatIds, userId);

	const unreadByGroupChatId = unreadRows.reduce((map, row) => {
		map.set(String(row.groupChatId), Number(row.unreadCount) || 0);
		return map;
	}, new Map());

	const lastMessageRows = db
		.prepare(
			`
      SELECT groupChatId, MAX(createdAt) AS lastMessageAt
      FROM messages
      WHERE groupChatId IN (${placeholders})
        AND isArchived = 0
      GROUP BY groupChatId
    `,
		)
		.all(...groupChatIds);

	const lastMessageByGroupChatId = lastMessageRows.reduce((map, row) => {
		map.set(String(row.groupChatId), row.lastMessageAt || null);
		return map;
	}, new Map());

	return groupChats.map((group) => ({
		...group,
		unreadCount: unreadByGroupChatId.get(String(group.id)) || 0,
		lastMessageAt: lastMessageByGroupChatId.get(String(group.id)) || null,
	}));
};

export const createGroupChat = (name, createdBy, memberIds = []) => {
	const stmt = db.prepare(`
    INSERT INTO group_chats (name, createdBy)
    VALUES (?, ?)
  `);
	const result = stmt.run(name, createdBy);
	const groupChatId = result.lastInsertRowid;

	const memberStmt = db.prepare(`
    INSERT OR IGNORE INTO group_chat_members (groupChatId, userId)
    VALUES (?, ?)
  `);

	const uniqueMemberIds = [...new Set([createdBy, ...memberIds.map(Number)])];
	uniqueMemberIds.forEach((userId) => memberStmt.run(groupChatId, userId));

	return groupChatId;
};

export const findGroupChatById = (id) => {
	return db.prepare('SELECT * FROM group_chats WHERE id = ?').get(id);
};

export const getGroupChatMembers = (groupChatId) => {
	return db
		.prepare(
			`
      SELECT u.id, u.username, u.avatar
      FROM users u
      JOIN group_chat_members gm ON u.id = gm.userId
      WHERE gm.groupChatId = ?
      ORDER BY u.username ASC
    `,
		)
		.all(groupChatId);
};

export const isGroupChatMember = (groupChatId, userId) => {
	const row = db
		.prepare(
			'SELECT 1 FROM group_chat_members WHERE groupChatId = ? AND userId = ?',
		)
		.get(groupChatId, userId);
	return row !== undefined;
};

export const addGroupChatMember = (groupChatId, userId) => {
	return db
		.prepare(
			'INSERT OR IGNORE INTO group_chat_members (groupChatId, userId) VALUES (?, ?)',
		)
		.run(groupChatId, userId);
};

export const removeGroupChatMember = (groupChatId, userId) => {
	return db
		.prepare(
			'DELETE FROM group_chat_members WHERE groupChatId = ? AND userId = ?',
		)
		.run(groupChatId, userId);
};

export const canAccessGroupChat = (groupChatId, userId) => {
	const groupChat = findGroupChatById(groupChatId);
	if (!groupChat) {
		return { allowed: false, reason: 'Group chat not found', groupChat: null };
	}

	if (!isGroupChatMember(groupChatId, userId)) {
		return { allowed: false, reason: 'Not a member of this group chat', groupChat };
	}

	return { allowed: true, groupChat };
};

export const findGroupChatsForUser = (userId) => {
	const groupChats = db
		.prepare(
			`
      SELECT gc.*
      FROM group_chats gc
      JOIN group_chat_members gm ON gm.groupChatId = gc.id
      WHERE gm.userId = ?
      ORDER BY gc.createdAt DESC
    `,
		)
		.all(userId);

	const withReadState = attachGroupChatReadState(groupChats, userId);

	return withReadState.map((group) => ({
		...group,
		members: getGroupChatMembers(group.id),
	}));
};

export const markGroupChatVisited = (userId, groupChatId) => {
	db.prepare(
		`
      INSERT INTO group_chat_visits (userId, groupChatId, lastVisitedAt)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(userId, groupChatId) DO UPDATE SET
        lastVisitedAt = CURRENT_TIMESTAMP
    `,
	).run(userId, groupChatId);
};
