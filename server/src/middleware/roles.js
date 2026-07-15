import db from '../database.js';
import { getUserRoleInWorkspace } from '../models/Workspace.js';
import { checkMessageRateLimit } from '../services/rateLimit.js';

// Check if user is admin
export const requireAdmin = (req, res, next) => {
	const stmt = db.prepare('SELECT role FROM users WHERE id = ?');
	const user = stmt.get(req.user.id);

	if (!user || user.role !== 'admin') {
		console.warn(
			'Admin check failed:',
			req.user?.id,
			user?.role || 'missing',
			req.method,
			req.originalUrl,
		);
		return res.status(403).json({ message: 'Admin privileges required' });
	}

	next();
};

// Check if user is manager or admin
export const requireManagerOrAdmin = (req, res, next) => {
	const stmt = db.prepare('SELECT role FROM users WHERE id = ?');
	const user = stmt.get(req.user.id);

	if (!user || (user.role !== 'manager' && user.role !== 'admin')) {
		return res
			.status(403)
			.json({ message: 'Manager or admin privileges required' });
	}

	req.userRole = user.role;
	next();
};

// Check if user is manager of specific channel or admin
export const requireChannelManagerOrAdmin = (channelIdParam = 'channelId') => {
	return (req, res, next) => {
		const channelId = req.params[channelIdParam] || req.body.channelId;

		if (!channelId) {
			return res.status(400).json({ message: 'Channel ID required' });
		}

		// Check user role
		const userStmt = db.prepare('SELECT role FROM users WHERE id = ?');
		const user = userStmt.get(req.user.id);

		if (!user) {
			return res.status(404).json({ message: 'User not found' });
		}

		// Admins can manage any channel
		if (user.role === 'admin') {
			req.userRole = 'admin';
			return next();
		}

		// Check if user is manager of this specific channel
		const managerStmt = db.prepare(
			'SELECT 1 FROM channel_managers WHERE channelId = ? AND userId = ?',
		);
		const isManager = managerStmt.get(channelId, req.user.id);

		if (!isManager) {
			return res.status(403).json({
				message: 'You must be a manager of this channel or an admin',
			});
		}

		req.userRole = 'manager';
		next();
	};
};

// Require the requesting user to hold at least `minRole` within the
// workspace named by `workspaceIdParam` (route param or body field).
// Instance-level 'admin' (users.role) always passes, same as the
// channel-scoped middleware above.
const workspaceRoleRank = { guest: 0, user: 1, manager: 2, admin: 3 };

export const requireWorkspaceRole = (minRole = 'user', workspaceIdParam = 'workspaceId') => {
	return (req, res, next) => {
		const workspaceId = req.params[workspaceIdParam] || req.body.workspaceId;

		if (!workspaceId) {
			return res.status(400).json({ message: 'Workspace ID required' });
		}

		const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id);
		if (!user) {
			return res.status(404).json({ message: 'User not found' });
		}

		if (user.role === 'admin') {
			req.workspaceRole = 'admin';
			return next();
		}

		const workspaceRole = getUserRoleInWorkspace(workspaceId, req.user.id);
		if (!workspaceRole || workspaceRoleRank[workspaceRole] < workspaceRoleRank[minRole]) {
			return res.status(403).json({ message: 'Insufficient workspace role' });
		}

		req.workspaceRole = workspaceRole;
		next();
	};
};

// Check if user can send messages in channel (not banned/muted/slow-moded)
export const canSendMessage = (channelId, userId) => {
	// Check if banned
	const banStmt = db.prepare(
		'SELECT 1 FROM channel_bans WHERE channelId = ? AND userId = ?',
	);
	const isBanned = banStmt.get(channelId, userId);

	if (isBanned) {
		return { allowed: false, reason: 'You are banned from this channel' };
	}

	// Check if muted
	const muteStmt = db.prepare(
		"SELECT expiresAt FROM channel_mutes WHERE channelId = ? AND userId = ? AND expiresAt > datetime('now')",
	);
	const mute = muteStmt.get(channelId, userId);

	if (mute) {
		return {
			allowed: false,
			reason: `You are muted until ${new Date(mute.expiresAt).toLocaleString()}`,
		};
	}

	const slowModeResult = checkSlowMode(channelId, userId);
	if (!slowModeResult.allowed) {
		return slowModeResult;
	}

	// Global anti-spam guard, independent of any single channel's slow mode -
	// admins are exempt, same as slow mode's exemption above.
	if (getUserRole(userId) !== 'admin') {
		const rateLimitResult = checkMessageRateLimit(userId);
		if (!rateLimitResult.allowed) {
			return rateLimitResult;
		}
	}

	return { allowed: true };
};

const checkSlowMode = (channelId, userId) => {
	const channel = db
		.prepare('SELECT createdBy, slowModeSeconds FROM channels WHERE id = ?')
		.get(channelId);

	if (!channel || !channel.slowModeSeconds) {
		return { allowed: true };
	}

	const role = getUserRole(userId);
	const isExempt =
		role === 'admin' ||
		String(channel.createdBy) === String(userId) ||
		isChannelManager(channelId, userId);

	if (isExempt) {
		return { allowed: true };
	}

	const lastMessage = db
		.prepare(
			`SELECT createdAt FROM messages
		 WHERE channelId = ? AND senderId = ? AND isDeleted = 0
		 ORDER BY datetime(createdAt) DESC LIMIT 1`,
		)
		.get(channelId, userId);

	if (!lastMessage) {
		return { allowed: true };
	}

	const elapsedMs = Date.now() - new Date(`${lastMessage.createdAt}Z`).getTime();
	const remainingSeconds = channel.slowModeSeconds - Math.floor(elapsedMs / 1000);

	if (remainingSeconds > 0) {
		return {
			allowed: false,
			reason: `Slow mode is active. Wait ${remainingSeconds}s before sending again.`,
		};
	}

	return { allowed: true };
};

// Check user role
export const getUserRole = (userId) => {
	const stmt = db.prepare('SELECT role, isGuest FROM users WHERE id = ?');
	const user = stmt.get(userId);
	if (!user) {
		return 'user';
	}
	return user.isGuest ? 'guest' : user.role || 'user';
};

// Check if user is manager of channel
export const isChannelManager = (channelId, userId) => {
	const stmt = db.prepare(
		'SELECT 1 FROM channel_managers WHERE channelId = ? AND userId = ?',
	);
	return !!stmt.get(channelId, userId);
};
