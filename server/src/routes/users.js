import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
	findUserById,
	findUserByUsername,
	updateUser,
	searchUsers,
	getUserPublicKey,
} from '../models/User.js';
import { broadcastPresenceState } from '../services/presence.js';
import db from '../database.js';

const router = express.Router();

const sanitizeUser = (user) => {
	if (!user) return null;
	delete user.password;
	return user;
};

router.get('/profile/username/:username', authenticateToken, async (req, res) => {
	try {
		const existingUser = findUserByUsername(req.params.username);
		const user = existingUser
			? sanitizeUser(findUserById(existingUser.id))
			: null;
		if (!user) {
			return res.status(404).json({ message: 'User not found' });
		}
		res.json(user);
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Get user profile
router.get('/profile/:userId', authenticateToken, async (req, res) => {
	try {
		const user = sanitizeUser(findUserById(req.params.userId));
		if (!user) {
			return res.status(404).json({ message: 'User not found' });
		}
		res.json(user);
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

router.put('/me/status', authenticateToken, async (req, res) => {
	try {
		const rawEmoji =
			typeof req.body?.statusEmoji === 'string' ? req.body.statusEmoji.trim() : '';
		const rawText =
			typeof req.body?.statusText === 'string' ? req.body.statusText.trim() : '';
		const statusEmoji = rawEmoji.slice(0, 16) || null;
		const statusText = rawText.slice(0, 80) || null;
		let statusClearsAt = null;

		if ((statusEmoji || statusText) && req.body?.statusClearsAt) {
			const parsedClearsAt = new Date(req.body.statusClearsAt);
			if (Number.isNaN(parsedClearsAt.getTime())) {
				return res.status(400).json({ message: 'Invalid status clear time' });
			}
			if (parsedClearsAt.getTime() <= Date.now()) {
				return res
					.status(400)
					.json({ message: 'Status clear time must be in the future' });
			}
			statusClearsAt = parsedClearsAt.toISOString();
		}

		const user = updateUser(req.user.id, {
			statusEmoji,
			statusText,
			statusClearsAt: statusEmoji || statusText ? statusClearsAt : null,
		});
		if (!user) {
			return res.status(404).json({ message: 'User not found' });
		}

		const io = req.app.get('io');
		if (io) {
			io.emit('user-status-updated', {
				userId: String(req.user.id),
				statusEmoji: user.statusEmoji || null,
				statusText: user.statusText || null,
				statusClearsAt: user.statusClearsAt || null,
			});
		}

		res.json(sanitizeUser(user));
	} catch (error) {
		console.error('Status update error:', error);
		res.status(500).json({ message: 'Server error: ' + error.message });
	}
});

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
	try {
		const updates = req.body;
		delete updates.password; // Don't allow password update through this route
		delete updates.email; // Don't allow email update

		const user = updateUser(req.user.id, updates);
		if (!user) {
			return res.status(404).json({ message: 'User not found' });
		}

		if (updates.appearOffline !== undefined) {
			broadcastPresenceState(
				req.app.get('io'),
				req.app.get('onlineUsers'),
				req.app.get('userPresence'),
			);
		}

		res.json(sanitizeUser(user));
	} catch (error) {
		console.error('Profile update error:', error);
		res.status(500).json({ message: 'Server error: ' + error.message });
	}
});

// Search users
router.get('/search', authenticateToken, async (req, res) => {
	try {
		const { q } = req.query;
		const users = searchUsers(q);
		res.json(users);
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Get user public key
router.get('/public-key/:userId', authenticateToken, async (req, res) => {
	try {
		const record = getUserPublicKey(req.params.userId);
		if (!record || !record.e2eePublicKey) {
			return res.status(404).json({ message: 'Public key not found' });
		}
		res.json({ e2eePublicKey: JSON.parse(record.e2eePublicKey) });
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

router.post('/me/mark-all-read', authenticateToken, (req, res) => {
	try {
		const userId = req.user.id;
		const now = new Date().toISOString();

		db.prepare(`
			INSERT INTO channel_visits (userId, channelId, lastVisitedAt)
			SELECT ?, channelId, ?
			FROM channel_members WHERE userId = ?
			ON CONFLICT(userId, channelId) DO UPDATE SET lastVisitedAt = excluded.lastVisitedAt
		`).run(userId, now, userId);

		db.prepare(`
			INSERT INTO group_chat_visits (userId, groupChatId, lastVisitedAt)
			SELECT ?, groupChatId, ?
			FROM group_chat_members WHERE userId = ?
			ON CONFLICT(userId, groupChatId) DO UPDATE SET lastVisitedAt = excluded.lastVisitedAt
		`).run(userId, now, userId);

		db.prepare(`
			UPDATE direct_message_visits SET lastVisitedAt = ? WHERE userId = ?
		`).run(now, userId);

		return res.json({ ok: true });
	} catch (error) {
		console.error('Error marking all read:', error);
		return res.status(500).json({ message: 'Server error' });
	}
});

export default router;
