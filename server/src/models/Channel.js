import db from '../database.js';

const ensureChannelVisitsForUser = (userId, channelIds) => {
	if (!Array.isArray(channelIds) || channelIds.length === 0) {
		return;
	}

	const insert = db.prepare(`
    INSERT OR IGNORE INTO channel_visits (userId, channelId, lastVisitedAt)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `);

	channelIds.forEach((channelId) => {
		insert.run(userId, channelId);
	});
};

const attachChannelReadState = (channels, userId) => {
	if (!Array.isArray(channels) || channels.length === 0) {
		return [];
	}

	const channelIds = channels.map((channel) => channel.id);
	ensureChannelVisitsForUser(userId, channelIds);

	const placeholders = channelIds.map(() => '?').join(', ');
	const unreadRows = db
		.prepare(
			`
      SELECT
        m.channelId,
        COUNT(*) AS unreadCount
      FROM messages m
      JOIN channel_visits cv
        ON cv.channelId = m.channelId
       AND cv.userId = ?
      WHERE m.channelId IN (${placeholders})
        AND m.isArchived = 0
        AND m.senderId != ?
        AND datetime(m.createdAt) > datetime(cv.lastVisitedAt)
      GROUP BY m.channelId
    `,
		)
		.all(userId, ...channelIds, userId);

	const unreadByChannelId = unreadRows.reduce((map, row) => {
		map.set(String(row.channelId), Number(row.unreadCount) || 0);
		return map;
	}, new Map());

	const lastMessageRows = db
		.prepare(
			`
      SELECT channelId, MAX(createdAt) AS lastMessageAt
      FROM messages
      WHERE channelId IN (${placeholders})
        AND isArchived = 0
      GROUP BY channelId
    `,
		)
		.all(...channelIds);

	const lastMessageByChannelId = lastMessageRows.reduce((map, row) => {
		map.set(String(row.channelId), row.lastMessageAt || null);
		return map;
	}, new Map());

	return channels.map((channel) => ({
		...channel,
		unreadCount: unreadByChannelId.get(String(channel.id)) || 0,
		lastMessageAt: lastMessageByChannelId.get(String(channel.id)) || null,
	}));
};

export const createChannel = (
	name,
	description,
	createdBy,
	status = 'approved',
	isPrivate = 0,
	userRole = 'user',
) => {
	const stmt = db.prepare(`
    INSERT INTO channels (name, description, createdBy, status, isPrivate)
    VALUES (?, ?, ?, ?, ?)
  `);
	const result = stmt.run(name, description, createdBy, status, isPrivate);
	const channelId = result.lastInsertRowid;

	// Add creator as a member
	const memberStmt = db.prepare(`
    INSERT INTO channel_members (channelId, userId)
    VALUES (?, ?)
  `);
	memberStmt.run(channelId, createdBy);

	if (userRole === 'manager') {
		const managerStmt = db.prepare(`
      INSERT OR IGNORE INTO channel_managers (channelId, userId, assignedBy)
      VALUES (?, ?, ?)
    `);
		managerStmt.run(channelId, createdBy, createdBy);
	}

	return channelId;
};

export const findAllChannels = () => {
	const stmt = db.prepare(`
    SELECT c.*, u.username as creatorUsername, u.avatar as creatorAvatar
    FROM channels c
    JOIN users u ON c.createdBy = u.id
    ORDER BY c.createdAt DESC
  `);
	return stmt.all();
};

export const findChannelById = (id) => {
	const stmt = db.prepare('SELECT * FROM channels WHERE id = ?');
	return stmt.get(id);
};

export const addChannelMember = (channelId, userId) => {
	const stmt = db.prepare(`
    INSERT OR IGNORE INTO channel_members (channelId, userId)
    VALUES (?, ?)
  `);
	return stmt.run(channelId, userId);
};

export const upsertChannelKeys = (channelId, keys = []) => {
	const stmt = db.prepare(`
    INSERT INTO channel_keys (channelId, userId, wrappedKey, wrappedIv, wrappedByUserId)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(channelId, userId) DO UPDATE SET
      wrappedKey = excluded.wrappedKey,
      wrappedIv = excluded.wrappedIv,
      wrappedByUserId = excluded.wrappedByUserId
  `);

	keys.forEach(({ userId, wrappedKey, wrappedIv, wrappedByUserId }) => {
		stmt.run(channelId, userId, wrappedKey, wrappedIv, wrappedByUserId);
	});
};

export const getChannelKeyForUser = (channelId, userId) => {
	return db
		.prepare(
			'SELECT wrappedKey, wrappedIv, wrappedByUserId FROM channel_keys WHERE channelId = ? AND userId = ?',
		)
		.get(channelId, userId);
};

export const getChannelMembers = (channelId) => {
	const stmt = db.prepare(`
    SELECT u.id, u.username, u.avatar
    FROM users u
    JOIN channel_members cm ON u.id = cm.userId
    WHERE cm.channelId = ?
	`);
	return stmt.all(channelId);
};

export const getChannelRoster = (channelId) => {
	const channel = findChannelById(channelId);
	if (!channel) {
		return [];
	}

	if (channel.isPrivate) {
		return db
			.prepare(
				`
        SELECT DISTINCT u.id, u.username, u.avatar, u.role
        FROM users u
        JOIN channel_members cm ON u.id = cm.userId
        WHERE cm.channelId = ?
        ORDER BY u.username ASC
      `,
			)
			.all(channelId);
	}

	return db
		.prepare(
			`
        SELECT DISTINCT u.id, u.username, u.avatar, u.role
        FROM users u
        LEFT JOIN channel_bans cb ON cb.channelId = ? AND cb.userId = u.id
        WHERE cb.userId IS NULL
        ORDER BY u.username ASC
      `,
		)
		.all(channelId);
};

export const getChannelNotificationRecipients = (channelId) => {
	const channel = findChannelById(channelId);
	if (!channel) {
		return [];
	}

	if (channel.isPrivate) {
		return db
			.prepare(
				`
        SELECT DISTINCT u.id, u.username, u.avatar
        FROM users u
        LEFT JOIN channel_members cm
          ON cm.userId = u.id
         AND cm.channelId = ?
        WHERE cm.userId IS NOT NULL
           OR u.role IN ('admin', 'manager')
        ORDER BY u.username ASC
      `,
			)
			.all(channelId);
	}

	return db
		.prepare(
			`
        SELECT DISTINCT u.id, u.username, u.avatar
        FROM users u
        LEFT JOIN channel_bans cb
          ON cb.channelId = ?
         AND cb.userId = u.id
        WHERE cb.userId IS NULL
        ORDER BY u.username ASC
      `,
		)
		.all(channelId);
};

export const isChannelMember = (channelId, userId) => {
	const stmt = db.prepare(`
    SELECT 1 FROM channel_members 
    WHERE channelId = ? AND userId = ?
  `);
	return stmt.get(channelId, userId) !== undefined;
};

export const isChannelBanned = (channelId, userId) => {
	const stmt = db.prepare(`
    SELECT 1 FROM channel_bans
    WHERE channelId = ? AND userId = ?
  `);
	return stmt.get(channelId, userId) !== undefined;
};

const isChannelManagerForAccess = (channelId, userId) => {
	const stmt = db.prepare(`
    SELECT 1 FROM channel_managers
    WHERE channelId = ? AND userId = ?
  `);
	return stmt.get(channelId, userId) !== undefined;
};

export const canAccessChannel = (channelId, userId, role = 'user') => {
	const channel = findChannelById(channelId);
	if (!channel) {
		return { allowed: false, reason: 'Channel not found', channel: null };
	}

	if (role === 'admin') {
		return { allowed: true, channel };
	}

	const isCreator = String(channel.createdBy) === String(userId);
	const isAssignedManager = isChannelManagerForAccess(channelId, userId);
	const isMember = isChannelMember(channelId, userId);
	const isBanned = isChannelBanned(channelId, userId);

	if (isBanned && !isCreator && !isAssignedManager) {
		return { allowed: false, reason: 'Channel access denied', channel };
	}

	if (channel.isPrivate && !isMember && !isCreator && !isAssignedManager) {
		return { allowed: false, reason: 'Private channel access denied', channel };
	}

	return { allowed: true, channel };
};

export const findVisibleChannelsForUser = (userId, role) => {
	let channels = [];

	if (role === 'admin') {
		const stmt = db.prepare(`
      SELECT c.*, u.username as creatorUsername, u.avatar as creatorAvatar
      FROM channels c
      JOIN users u ON c.createdBy = u.id
      ORDER BY c.createdAt DESC
    `);
		channels = stmt.all();
		return attachChannelReadState(channels, userId);
	}

	if (role === 'manager') {
		const stmt = db.prepare(`
      SELECT c.*, u.username as creatorUsername, u.avatar as creatorAvatar
      FROM channels c
      JOIN users u ON c.createdBy = u.id
      LEFT JOIN channel_members cm ON cm.channelId = c.id AND cm.userId = ?
      LEFT JOIN channel_managers m ON m.channelId = c.id AND m.userId = ?
      LEFT JOIN channel_bans cb ON cb.channelId = c.id AND cb.userId = ?
      WHERE c.createdBy = ?
         OR m.userId IS NOT NULL
         OR (c.status = 'approved' AND cb.userId IS NULL AND (c.isPrivate = 0 OR cm.userId IS NOT NULL))
      ORDER BY c.createdAt DESC
    `);
		channels = stmt.all(userId, userId, userId, userId);
		return attachChannelReadState(channels, userId);
	}

	const stmt = db.prepare(`
    SELECT c.*, u.username as creatorUsername, u.avatar as creatorAvatar
    FROM channels c
    JOIN users u ON c.createdBy = u.id
    LEFT JOIN channel_members cm ON cm.channelId = c.id AND cm.userId = ?
    LEFT JOIN channel_bans cb ON cb.channelId = c.id AND cb.userId = ?
    WHERE c.status = 'approved'
      AND cb.userId IS NULL
      AND (c.isPrivate = 0 OR cm.userId IS NOT NULL)
    ORDER BY c.createdAt DESC
  `);
	channels = stmt.all(userId, userId);
	return attachChannelReadState(channels, userId);
};

export const markChannelVisited = (userId, channelId) => {
	db.prepare(
		`
      INSERT INTO channel_visits (userId, channelId, lastVisitedAt)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(userId, channelId) DO UPDATE SET
        lastVisitedAt = CURRENT_TIMESTAMP
    `,
	).run(userId, channelId);
};
