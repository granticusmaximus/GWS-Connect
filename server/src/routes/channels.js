import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getUserRole } from '../middleware/roles.js';
import {
	createChannel,
	findChannelById,
	addChannelMember,
	canAccessChannel,
	channelHasAnyKeyGeneration,
	findVisibleChannelsForUser,
	getChannelKeyForUserAtGeneration,
	getChannelRoster,
	getCurrentChannelKeyGeneration,
	insertChannelKeyGenerations,
	isChannelMember,
	markChannelVisited,
	rotateChannelKey,
} from '../models/Channel.js';
import { resolveActiveWorkspaceId } from '../models/Workspace.js';

const router = express.Router();

const resolveRequestWorkspaceId = (req) =>
	resolveActiveWorkspaceId(req.user.id, req.query.workspaceId || req.body?.workspaceId);

// Get all channels (approved only for regular users) within the caller's
// active workspace.
router.get('/', authenticateToken, async (req, res) => {
	try {
		const userRole = getUserRole(req.user.id);
		const workspaceId = resolveRequestWorkspaceId(req);
		const channels = findVisibleChannelsForUser(req.user.id, userRole, workspaceId);
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
		const workspaceId = resolveRequestWorkspaceId(req);

		if (userRole === 'guest') {
			return res.status(403).json({
				message: 'Guest accounts cannot create channels',
			});
		}

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
			workspaceId,
		);
		const channel = findChannelById(channelId);
		channel.status = status;

		insertChannelKeyGenerations(channelId, 1, [
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

		if (getUserRole(req.user.id) === 'guest') {
			return res.status(403).json({
				message: 'Guest accounts cannot join channels unless assigned by a manager or admin',
			});
		}

		addChannelMember(req.params.channelId, req.user.id);

		// Every channel is E2EE now, so every new joiner needs a key from an
		// online member regardless of the channel's visibility setting. New
		// joiners only ever receive the *current* generation - they can't
		// retroactively decrypt history from before they joined.
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

		const currentGeneration = getCurrentChannelKeyGeneration(req.params.channelId) || 1;
		const key = getChannelKeyForUserAtGeneration(req.params.channelId, req.user.id, currentGeneration);
		if (!key) {
			return res.status(404).json({
				message: 'Encryption key not yet available',
				hasAnyKey: channelHasAnyKeyGeneration(req.params.channelId),
			});
		}

		res.json(key);
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Fetch my key for a specific (possibly historical) generation - used when
// decrypting an older message encrypted before the most recent rotation.
router.get('/:channelId/keys/me/:generation', authenticateToken, async (req, res) => {
	try {
		const access = canAccessChannel(req.params.channelId, req.user.id, getUserRole(req.user.id));
		if (!access.channel) {
			return res.status(404).json({ message: 'Channel not found' });
		}
		if (!access.allowed) {
			return res.status(403).json({ message: access.reason });
		}

		const generation = Number(req.params.generation);
		if (!Number.isInteger(generation) || generation < 1) {
			return res.status(400).json({ message: 'Invalid key generation' });
		}

		const key = getChannelKeyForUserAtGeneration(req.params.channelId, req.user.id, generation);
		if (!key) {
			return res.status(404).json({ message: 'Encryption key not available for this generation' });
		}

		res.json(key);
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Grant key access to a fellow member who joined without one - always at the
// current generation, never a past one.
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

		const currentGeneration = getCurrentChannelKeyGeneration(req.params.channelId) || 1;
		insertChannelKeyGenerations(req.params.channelId, currentGeneration, [
			{ userId: targetUserId, wrappedKey: String(wrappedKey), wrappedIv: String(wrappedIv), wrappedByUserId: req.user.id },
		]);

		res.json({ ok: true });
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Rotate the channel key to a new generation, wrapping it for every current
// member. Triggered after a member is removed, or periodically by a client
// noticing the current generation is stale. Optimistic-concurrency protected
// so that if two members race to rotate at once, only one succeeds.
router.post('/:channelId/keys/rotate', authenticateToken, async (req, res) => {
	try {
		const access = canAccessChannel(req.params.channelId, req.user.id, getUserRole(req.user.id));
		if (!access.channel) {
			return res.status(404).json({ message: 'Channel not found' });
		}
		if (!access.allowed) {
			return res.status(403).json({ message: access.reason });
		}

		const { generation, wraps } = req.body;
		const newGeneration = Number(generation);
		if (!Number.isInteger(newGeneration) || newGeneration < 2) {
			return res.status(400).json({ message: 'Invalid target generation' });
		}
		if (!Array.isArray(wraps) || wraps.length === 0) {
			return res.status(400).json({ message: 'At least one wrapped key is required' });
		}

		const currentGeneration = getCurrentChannelKeyGeneration(req.params.channelId) || 1;
		if (newGeneration !== currentGeneration + 1) {
			return res.status(409).json({ message: 'Channel key generation has already moved on' });
		}

		const validatedWraps = [];
		for (const wrap of wraps) {
			const wrapUserId = Number(wrap?.userId);
			if (!Number.isInteger(wrapUserId) || !wrap?.wrappedKey || !wrap?.wrappedIv) {
				return res.status(400).json({ message: 'Each wrap requires userId, wrappedKey, and wrappedIv' });
			}
			if (!isChannelMember(req.params.channelId, wrapUserId)) {
				continue; // skip stale entries for members who left/were removed mid-rotation
			}
			validatedWraps.push({
				userId: wrapUserId,
				wrappedKey: String(wrap.wrappedKey),
				wrappedIv: String(wrap.wrappedIv),
				wrappedByUserId: req.user.id,
			});
		}

		const rotated = rotateChannelKey(
			req.params.channelId,
			currentGeneration,
			newGeneration,
			validatedWraps,
		);

		if (!rotated) {
			return res.status(409).json({ message: 'Channel key generation has already moved on' });
		}

		const io = req.app.get('io');
		io.to(`channel:${req.params.channelId}`).emit('channel-key-rotated', {
			channelId: String(req.params.channelId),
			generation: newGeneration,
		});

		res.json({ ok: true, generation: newGeneration });
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
