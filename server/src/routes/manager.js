import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getUserRole, requireChannelManagerOrAdmin } from '../middleware/roles.js';
import db from '../database.js';
import {
	findChannelById,
	findVisibleChannelsForUser,
	getChannelRoster,
} from '../models/Channel.js';

const router = express.Router();

const emitVisibleChannelsForUser = (io, userId) => {
	const channels = findVisibleChannelsForUser(userId, getUserRole(userId));
	io.to(String(userId)).emit('channels', channels);
};

const emitChannelMembersUpdated = (io, channelId) => {
	const members = getChannelRoster(channelId);
	io.to(`channel:${channelId}`).emit('channel-members-updated', {
		channelId: String(channelId),
		members,
	});
	return members;
};

const revokeChannelAccessForUser = (io, channelId, userId) => {
	io.in(String(userId)).socketsLeave(`channel:${channelId}`);
	io.to(String(userId)).emit('channel-access-removed', {
		channelId: String(channelId),
	});
	emitVisibleChannelsForUser(io, userId);
};

// Update channel details (name, description)
router.put(
	'/:channelId',
	authenticateToken,
	requireChannelManagerOrAdmin('channelId'),
	(req, res) => {
		try {
			const { name, description, isPrivate } = req.body;
			const updates = [];
			const values = [];

			if (name) {
				updates.push('name = ?');
				values.push(name);
			}
			if (description !== undefined) {
				updates.push('description = ?');
				values.push(description);
			}
			if (isPrivate !== undefined) {
				updates.push('isPrivate = ?');
				values.push(isPrivate ? 1 : 0);
			}

			if (updates.length === 0) {
				return res.status(400).json({ message: 'No updates provided' });
			}

			values.push(req.params.channelId);
			const stmt = db.prepare(
				`UPDATE channels SET ${updates.join(', ')} WHERE id = ?`,
			);
			stmt.run(...values);

			res.json({ message: 'Channel updated successfully' });
		} catch (error) {
			console.error('Error updating channel:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

// Delete channel (admin or channel manager)
router.delete(
	'/:channelId',
	authenticateToken,
	requireChannelManagerOrAdmin('channelId'),
	(req, res) => {
		try {
			const channelId = req.params.channelId;
			const stmt = db.prepare('DELETE FROM channels WHERE id = ?');
			const result = stmt.run(channelId);

			if (result.changes === 0) {
				return res.status(404).json({ message: 'Channel not found' });
			}

			res.json({ message: 'Channel deleted successfully' });
		} catch (error) {
			console.error('Error deleting channel:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

// Get channel members
router.get(
	'/:channelId/members',
	authenticateToken,
	requireChannelManagerOrAdmin('channelId'),
	(req, res) => {
		try {
			res.json(getChannelRoster(req.params.channelId));
		} catch (error) {
			console.error('Error fetching members:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

router.post(
	'/:channelId/members',
	authenticateToken,
	requireChannelManagerOrAdmin('channelId'),
	(req, res) => {
		try {
			const { userId } = req.body || {};
			const channelId = req.params.channelId;
			const channel = findChannelById(channelId);

			if (!channel) {
				return res.status(404).json({ message: 'Channel not found' });
			}

			if (!channel.isPrivate) {
				return res.status(400).json({
					message: 'Members can only be added directly to private channels',
				});
			}

			if (!userId) {
				return res.status(400).json({ message: 'User ID required' });
			}

			const targetUser = db
				.prepare('SELECT id, username, role FROM users WHERE id = ?')
				.get(userId);

			if (!targetUser) {
				return res.status(404).json({ message: 'User not found' });
			}

			db.prepare(
				`DELETE FROM channel_bans WHERE channelId = ? AND userId = ?`,
			).run(channelId, userId);
			db.prepare(
				`INSERT OR IGNORE INTO channel_members (channelId, userId) VALUES (?, ?)`,
			).run(channelId, userId);

			const io = req.app.get('io');
			emitVisibleChannelsForUser(io, userId);
			const members = emitChannelMembersUpdated(io, channelId);

			return res.json({
				message: 'User added successfully',
				members,
			});
		} catch (error) {
			console.error('Error adding channel member:', error);
			return res.status(500).json({ message: 'Server error' });
		}
	},
);

router.delete(
	'/:channelId/members/:userId',
	authenticateToken,
	requireChannelManagerOrAdmin('channelId'),
	(req, res) => {
		try {
			const channelId = req.params.channelId;
			const targetUserId = req.params.userId;
			const channel = findChannelById(channelId);

			if (!channel) {
				return res.status(404).json({ message: 'Channel not found' });
			}

			const targetUser = db
				.prepare('SELECT id, username, role FROM users WHERE id = ?')
				.get(targetUserId);

			if (!targetUser) {
				return res.status(404).json({ message: 'User not found' });
			}

			if (String(channel.createdBy) === String(targetUserId)) {
				return res.status(400).json({
					message: 'Channel creator cannot be removed from the channel',
				});
			}

			if (targetUser.role === 'admin') {
				return res.status(400).json({
					message: 'Admins cannot be removed from a channel',
				});
			}

			const isAssignedManager = db
				.prepare(
					'SELECT 1 FROM channel_managers WHERE channelId = ? AND userId = ?',
				)
				.get(channelId, targetUserId);

			if (isAssignedManager) {
				return res.status(400).json({
					message: 'Assigned channel managers cannot be removed from the channel',
				});
			}

			if (channel.isPrivate) {
				db.prepare(
					`DELETE FROM channel_members WHERE channelId = ? AND userId = ?`,
				).run(channelId, targetUserId);
			} else {
				db.prepare(
					`INSERT OR REPLACE INTO channel_bans (channelId, userId, bannedBy, reason)
					 VALUES (?, ?, ?, ?)`,
				).run(channelId, targetUserId, req.user.id, 'Removed from members list');
				db.prepare(
					`DELETE FROM channel_members WHERE channelId = ? AND userId = ?`,
				).run(channelId, targetUserId);
			}

			const io = req.app.get('io');
			revokeChannelAccessForUser(io, channelId, targetUserId);
			const members = emitChannelMembersUpdated(io, channelId);

			return res.json({
				message: 'User removed successfully',
				members,
			});
		} catch (error) {
			console.error('Error removing channel member:', error);
			return res.status(500).json({ message: 'Server error' });
		}
	},
);

// Mute user in channel
router.post(
	'/:channelId/mute',
	authenticateToken,
	requireChannelManagerOrAdmin('channelId'),
	(req, res) => {
		try {
			const { userId, duration, reason } = req.body; // duration in minutes

			if (!userId || !duration) {
				return res
					.status(400)
					.json({ message: 'User ID and duration required' });
			}

			// Calculate expiration time
			const expiresAt = new Date(
				Date.now() + duration * 60 * 1000,
			).toISOString();

			const stmt = db.prepare(`
      INSERT INTO channel_mutes (channelId, userId, mutedBy, expiresAt, reason)
      VALUES (?, ?, ?, ?, ?)
    `);
			stmt.run(
				req.params.channelId,
				userId,
				req.user.id,
				expiresAt,
				reason || '',
			);

			res.json({
				message: 'User muted successfully',
				expiresAt,
			});
		} catch (error) {
			console.error('Error muting user:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

// Unmute user in channel
router.delete(
	'/:channelId/mute/:userId',
	authenticateToken,
	requireChannelManagerOrAdmin('channelId'),
	(req, res) => {
		try {
			const stmt = db.prepare(
				`DELETE FROM channel_mutes WHERE channelId = ? AND userId = ?`,
			);
			stmt.run(req.params.channelId, req.params.userId);

			res.json({ message: 'User unmuted successfully' });
		} catch (error) {
			console.error('Error unmuting user:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

// Ban user from channel
router.post(
	'/:channelId/ban',
	authenticateToken,
	requireChannelManagerOrAdmin('channelId'),
	(req, res) => {
		try {
			const { userId, reason } = req.body;

			if (!userId) {
				return res.status(400).json({ message: 'User ID required' });
			}

			const stmt = db.prepare(`
      INSERT OR REPLACE INTO channel_bans (channelId, userId, bannedBy, reason)
      VALUES (?, ?, ?, ?)
    `);
			stmt.run(req.params.channelId, userId, req.user.id, reason || '');

			// Remove from channel members
			const removeMemberStmt = db.prepare(
				`DELETE FROM channel_members WHERE channelId = ? AND userId = ?`,
			);
			removeMemberStmt.run(req.params.channelId, userId);

			res.json({ message: 'User banned successfully' });
		} catch (error) {
			console.error('Error banning user:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

// Unban user from channel
router.delete(
	'/:channelId/ban/:userId',
	authenticateToken,
	requireChannelManagerOrAdmin('channelId'),
	(req, res) => {
		try {
			const stmt = db.prepare(
				`DELETE FROM channel_bans WHERE channelId = ? AND userId = ?`,
			);
			stmt.run(req.params.channelId, req.params.userId);

			res.json({ message: 'User unbanned successfully' });
		} catch (error) {
			console.error('Error unbanning user:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

// Get banned users
router.get(
	'/:channelId/bans',
	authenticateToken,
	requireChannelManagerOrAdmin('channelId'),
	(req, res) => {
		try {
			const stmt = db.prepare(`
      SELECT u.id, u.username, u.email, u.avatar, cb.bannedAt, cb.reason,
             bu.username as bannedByUsername
      FROM channel_bans cb
      JOIN users u ON cb.userId = u.id
      JOIN users bu ON cb.bannedBy = bu.id
      WHERE cb.channelId = ?
      ORDER BY cb.bannedAt DESC
    `);
			const bans = stmt.all(req.params.channelId);
			res.json(bans);
		} catch (error) {
			console.error('Error fetching bans:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

// Get muted users
router.get(
	'/:channelId/mutes',
	authenticateToken,
	requireChannelManagerOrAdmin('channelId'),
	(req, res) => {
		try {
			const stmt = db.prepare(`
      SELECT u.id, u.username, u.email, u.avatar, cm.mutedAt, cm.expiresAt, cm.reason,
             mu.username as mutedByUsername
      FROM channel_mutes cm
      JOIN users u ON cm.userId = u.id
      JOIN users mu ON cm.mutedBy = mu.id
      WHERE cm.channelId = ? AND cm.expiresAt > datetime('now')
      ORDER BY cm.mutedAt DESC
    `);
			const mutes = stmt.all(req.params.channelId);
			res.json(mutes);
		} catch (error) {
			console.error('Error fetching mutes:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

export default router;
