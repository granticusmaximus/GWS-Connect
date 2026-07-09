import db from '../database.js';

const getVisibleOnlineUserEntries = (onlineUsers) => {
	if (!onlineUsers) {
		return [];
	}

	const entries = Array.from(onlineUsers.keys()).map((userId) => ({
		rawId: userId,
		userId: String(userId),
	}));

	if (entries.length === 0) {
		return [];
	}

	const placeholders = entries.map(() => '?').join(', ');
	const visibleRows = db
		.prepare(
			`SELECT id FROM users WHERE id IN (${placeholders}) AND COALESCE(appearOffline, 0) = 0`,
		)
		.all(...entries.map((entry) => entry.userId));
	const visibleUserIds = new Set(visibleRows.map((row) => String(row.id)));

	return entries.filter((entry) => visibleUserIds.has(entry.userId));
};

export const broadcastPresenceState = (io, onlineUsers, userPresence) => {
	if (!io) {
		return;
	}

	const visibleEntries = getVisibleOnlineUserEntries(onlineUsers);
	io.emit(
		'online-users',
		visibleEntries.map((entry) => entry.userId),
	);
	io.emit(
		'presence-update',
		Object.fromEntries(
			visibleEntries.map((entry) => [
				entry.userId,
				userPresence?.get(entry.rawId) || 'online',
			]),
		),
	);
};
