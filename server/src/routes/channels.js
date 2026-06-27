import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getUserRole } from '../middleware/roles.js';
import {
	createChannel,
	findChannelById,
	addChannelMember,
	canAccessChannel,
	channelHasAnyKey,
	findVisibleChannelsForUser,
	getChannelKeyForUser,
	getChannelRoster,
	isChannelMember,
	markChannelVisited,
	upsertChannelKeys,
} from '../models/Channel.js';

const router = express.Router();

// Get all channels (approved only for regular users)
router.get('/', authenticateToken, async (req, res) => {
	try {
		const userRole = getUserRole(req.user.id);
		const channels = findVisibleChannelsForUser(req.user.id, userRole);
		res.json(channels);
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Create channel
router.post('/', authenticateToken, async (req, res) => {
	try {
		const { name, description, isPrivate, wrappedKey, wrappedIv } = req.body;
		const userRole = getUserRole(req.user.id);
		const privacyValue = isPrivate ? 1 : 0;

		// All channels are E2EE, regardless of public/private visibility - the
		// creator wraps the channel key for themselves immediately; later
		// members receive it from an online member when they join (see
		// 'channel-key-needed').
		if (!wrappedKey || !wrappedIv) {
			return res
				.status(400)
				.json({ message: 'wrappedKey and wrappedIv are required' });
		}

		// Admins can create approved channels immediately
		const status = userRole === 'admin' ? 'approved' : 'pending';

		const channelId = createChannel(
			name,
			description || '',
			req.user.id,
			status,
			privacyValue,
			userRole,
		);
		const channel = findChannelById(channelId);
		channel.status = status;

		upsertChannelKeys(channelId, [
			{ userId: req.user.id, wrappedKey: String(wrappedKey), wrappedIv: String(wrappedIv), wrappedByUserId: req.user.id },
		]);

		const message =
			status === 'approved'
				? 'Channel created successfully'
				: 'Channel created and pending admin approval';

		res.status(201).json({ channel, message });
	} catch (error) {
		console.error('Channel creation error:', error);
		const message =
			process.env.NODE_ENV === 'production'
				? 'Server error'
				: `Server error: ${error.message}`;
		res.status(500).json({ message });
	}
});

// Join channel
router.post('/:channelId/join', authenticateToken, async (req, res) => {
	try {
		const access = canAccessChannel(
			req.params.channelId,
			req.user.id,
			getUserRole(req.user.id),
		);
		if (!access.channel) {
			return res.status(404).json({ message: 'Channel not found' });
		}
		if (!access.allowed) {
			return res.status(403).json({ message: access.reason });
		}

		addChannelMember(req.params.channelId, req.user.id);

		// Every channel is E2EE now, so every new joiner needs a key from an
		// online member regardless of the channel's visibility setting.
		const io = req.app.get('io');
		io.to(`channel:${req.params.channelId}`).emit('channel-key-needed', {
			channelId: String(req.params.channelId),
			userId: String(req.user.id),
		});

		res.json(access.channel);
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

router.get('/:channelId/keys/me', authenticateToken, async (req, res) => {
	try {
		const access = canAccessChannel(req.params.channelId, req.user.id, getUserRole(req.user.id));
		if (!access.channel) {
			return res.status(404).json({ message: 'Channel not found' });
		}
		if (!access.allowed) {
			return res.status(403).json({ message: access.reason });
		}

		const key = getChannelKeyForUser(req.params.channelId, req.user.id);
		if (!key) {
			return res.status(404).json({
				message: 'Encryption key not yet available',
				hasAnyKey: channelHasAnyKey(req.params.channelId),
			});
		}

		res.json(key);
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Grant key access to a fellow member who joined without one
router.post('/:channelId/keys', authenticateToken, async (req, res) => {
	try {
		const access = canAccessChannel(req.params.channelId, req.user.id, getUserRole(req.user.id));
		if (!access.channel) {
			return res.status(404).json({ message: 'Channel not found' });
		}
		if (!access.allowed) {
			return res.status(403).json({ message: access.reason });
		}

		const { userId, wrappedKey, wrappedIv } = req.body;
		const targetUserId = Number(userId);
		if (!Number.isInteger(targetUserId) || !wrappedKey || !wrappedIv) {
			return res.status(400).json({ message: 'userId, wrappedKey, and wrappedIv are required' });
		}

		if (!isChannelMember(req.params.channelId, targetUserId)) {
			return res.status(400).json({ message: 'Target user is not a member of this channel' });
		}

		upsertChannelKeys(req.params.channelId, [
			{ userId: targetUserId, wrappedKey: String(wrappedKey), wrappedIv: String(wrappedIv), wrappedByUserId: req.user.id },
		]);

		res.json({ ok: true });
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

router.post('/:channelId/visit', authenticateToken, async (req, res) => {
	try {
		const access = canAccessChannel(
			req.params.channelId,
			req.user.id,
			getUserRole(req.user.id),
		);
		if (!access.channel) {
			return res.status(404).json({ message: 'Channel not found' });
		}
		if (!access.allowed) {
			return res.status(403).json({ message: access.reason });
		}

		markChannelVisited(req.user.id, req.params.channelId);
		return res.json({ ok: true });
	} catch (error) {
		return res.status(500).json({ message: 'Server error' });
	}
});

// Get channel members
router.get('/:channelId/members', authenticateToken, (req, res) => {
	try {
		const channelId = req.params.channelId;
		const access = canAccessChannel(
			channelId,
			req.user.id,
			getUserRole(req.user.id),
		);

		if (!access.channel) {
			return res.status(404).json({ message: 'Channel not found' });
		}
		if (!access.allowed) {
			return res.status(403).json({ message: access.reason });
		}

		res.json(getChannelRoster(channelId));
	} catch (error) {
		console.error('Get channel members error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

export default router;
