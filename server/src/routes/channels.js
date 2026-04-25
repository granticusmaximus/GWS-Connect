import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getUserRole } from '../middleware/roles.js';
import {
	createChannel,
	findChannelById,
	addChannelMember,
	canAccessChannel,
	findVisibleChannelsForUser,
	getChannelRoster,
	markChannelVisited,
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
		const { name, description, isPrivate } = req.body;
		const userRole = getUserRole(req.user.id);
		const privacyValue = isPrivate ? 1 : 0;

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

		res.json(access.channel);
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
