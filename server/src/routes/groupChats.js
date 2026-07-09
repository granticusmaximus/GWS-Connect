import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
	addGroupChatMember,
	canAccessGroupChat,
	createGroupChat,
	findGroupChatById,
	findGroupChatsForUser,
	getGroupChatKeyForUserAtGeneration,
	getGroupChatMembers,
	getCurrentGroupChatKeyGeneration,
	groupChatHasAnyKeyGeneration,
	insertGroupChatKeyGenerations,
	isGroupChatMember,
	markGroupChatVisited,
	removeGroupChatMember,
	rotateGroupChatKey,
	setGroupChatDisappearingSeconds,
} from '../models/GroupChat.js';
import { getUserRole } from '../middleware/roles.js';
import { getGroupChatVisits } from '../models/Message.js';

const router = express.Router();

// List the current user's group chats
router.get('/', authenticateToken, async (req, res) => {
	try {
		const groupChats = findGroupChatsForUser(req.user.id);
		res.json(groupChats);
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Create a group chat
router.post('/', authenticateToken, async (req, res) => {
	try {
		if (getUserRole(req.user.id) === 'guest') {
			return res.status(403).json({
				message: 'Guest accounts cannot create group chats',
			});
		}

		const { name, memberIds, keys } = req.body;
		const trimmedName = String(name || '').trim();

		if (!trimmedName) {
			return res.status(400).json({ message: 'Group name is required' });
		}

		const normalizedMemberIds = Array.isArray(memberIds)
			? memberIds.map(Number).filter((id) => Number.isInteger(id) && id !== req.user.id)
			: [];

		if (normalizedMemberIds.length === 0) {
			return res.status(400).json({ message: 'Select at least one other member' });
		}

		const groupChatId = createGroupChat(trimmedName, req.user.id, normalizedMemberIds);
		const groupChat = findGroupChatById(groupChatId);
		const members = getGroupChatMembers(groupChatId);
		const memberIdSet = new Set(members.map((member) => Number(member.id)));

		if (Array.isArray(keys)) {
			const validKeys = keys
				.filter((key) => memberIdSet.has(Number(key.userId)) && key.wrappedKey && key.wrappedIv)
				.map((key) => ({
					userId: Number(key.userId),
					wrappedKey: String(key.wrappedKey),
					wrappedIv: String(key.wrappedIv),
					wrappedByUserId: req.user.id,
				}));
			insertGroupChatKeyGenerations(groupChatId, 1, validKeys);
		}

		const payload = {
			...groupChat,
			members,
			unreadCount: 0,
			lastMessageAt: null,
		};

		const io = req.app.get('io');
		members.forEach((member) => {
			// Every connected socket already joins a room named after its own userId,
			// so this immediately subscribes existing sessions to the new group room.
			io.in(String(member.id)).socketsJoin(`group:${groupChatId}`);
			if (String(member.id) !== String(req.user.id)) {
				io.to(String(member.id)).emit('group-chat-created', payload);
			}
		});

		res.status(201).json(payload);
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Get group chat details
router.get('/:groupChatId', authenticateToken, async (req, res) => {
	try {
		const access = canAccessGroupChat(req.params.groupChatId, req.user.id);
		if (!access.groupChat) {
			return res.status(404).json({ message: 'Group chat not found' });
		}
		if (!access.allowed) {
			return res.status(403).json({ message: access.reason });
		}

		res.json({
			...access.groupChat,
			members: getGroupChatMembers(req.params.groupChatId),
		});
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Update group chat settings (currently just disappearing messages)
router.put('/:groupChatId/settings', authenticateToken, async (req, res) => {
	try {
		const access = canAccessGroupChat(req.params.groupChatId, req.user.id);
		if (!access.groupChat) {
			return res.status(404).json({ message: 'Group chat not found' });
		}
		if (!access.allowed) {
			return res.status(403).json({ message: access.reason });
		}

		const { disappearingMessagesSeconds } = req.body;
		if (disappearingMessagesSeconds !== undefined) {
			setGroupChatDisappearingSeconds(req.params.groupChatId, disappearingMessagesSeconds);
		}

		const io = req.app.get('io');
		io.to(`group:${req.params.groupChatId}`).emit('group-settings-updated', {
			groupChatId: String(req.params.groupChatId),
			disappearingMessagesSeconds: Math.max(0, Number(disappearingMessagesSeconds) || 0),
		});

		res.json(findGroupChatById(req.params.groupChatId));
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

router.get('/:groupChatId/keys/me', authenticateToken, async (req, res) => {
	try {
		const access = canAccessGroupChat(req.params.groupChatId, req.user.id);
		if (!access.groupChat) {
			return res.status(404).json({ message: 'Group chat not found' });
		}
		if (!access.allowed) {
			return res.status(403).json({ message: access.reason });
		}

		const currentGeneration = getCurrentGroupChatKeyGeneration(req.params.groupChatId) || 1;
		const key = getGroupChatKeyForUserAtGeneration(req.params.groupChatId, req.user.id, currentGeneration);
		if (!key) {
			return res.status(404).json({
				message: 'Encryption key not yet available',
				hasAnyKey: groupChatHasAnyKeyGeneration(req.params.groupChatId),
			});
		}

		res.json(key);
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Fetch my key for a specific (possibly historical) generation - used when
// decrypting an older message encrypted before the most recent rotation.
router.get('/:groupChatId/keys/me/:generation', authenticateToken, async (req, res) => {
	try {
		const access = canAccessGroupChat(req.params.groupChatId, req.user.id);
		if (!access.groupChat) {
			return res.status(404).json({ message: 'Group chat not found' });
		}
		if (!access.allowed) {
			return res.status(403).json({ message: access.reason });
		}

		const generation = Number(req.params.generation);
		if (!Number.isInteger(generation) || generation < 1) {
			return res.status(400).json({ message: 'Invalid key generation' });
		}

		const key = getGroupChatKeyForUserAtGeneration(req.params.groupChatId, req.user.id, generation);
		if (!key) {
			return res.status(404).json({ message: 'Encryption key not available for this generation' });
		}

		res.json(key);
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Grant key access to a fellow member who joined without one (e.g. via invite
// link redemption). Any existing member who already holds the group key may
// wrap and upload it for the target member - always at the current
// generation, never a past one.
router.post('/:groupChatId/keys', authenticateToken, async (req, res) => {
	try {
		const access = canAccessGroupChat(req.params.groupChatId, req.user.id);
		if (!access.groupChat) {
			return res.status(404).json({ message: 'Group chat not found' });
		}
		if (!access.allowed) {
			return res.status(403).json({ message: access.reason });
		}

		const { userId, wrappedKey, wrappedIv } = req.body;
		const targetUserId = Number(userId);
		if (!Number.isInteger(targetUserId) || !wrappedKey || !wrappedIv) {
			return res.status(400).json({ message: 'userId, wrappedKey, and wrappedIv are required' });
		}

		if (!isGroupChatMember(req.params.groupChatId, targetUserId)) {
			return res.status(400).json({ message: 'Target user is not a member of this group chat' });
		}

		const currentGeneration = getCurrentGroupChatKeyGeneration(req.params.groupChatId) || 1;
		insertGroupChatKeyGenerations(req.params.groupChatId, currentGeneration, [
			{ userId: targetUserId, wrappedKey: String(wrappedKey), wrappedIv: String(wrappedIv), wrappedByUserId: req.user.id },
		]);

		res.json({ ok: true });
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Rotate the group key to a new generation, wrapping it for every current
// member. Triggered after a member leaves/is removed, or periodically by a
// client noticing the current generation is stale.
router.post('/:groupChatId/keys/rotate', authenticateToken, async (req, res) => {
	try {
		const access = canAccessGroupChat(req.params.groupChatId, req.user.id);
		if (!access.groupChat) {
			return res.status(404).json({ message: 'Group chat not found' });
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

		const currentGeneration = getCurrentGroupChatKeyGeneration(req.params.groupChatId) || 1;
		if (newGeneration !== currentGeneration + 1) {
			return res.status(409).json({ message: 'Group key generation has already moved on' });
		}

		const validatedWraps = [];
		for (const wrap of wraps) {
			const wrapUserId = Number(wrap?.userId);
			if (!Number.isInteger(wrapUserId) || !wrap?.wrappedKey || !wrap?.wrappedIv) {
				return res.status(400).json({ message: 'Each wrap requires userId, wrappedKey, and wrappedIv' });
			}
			if (!isGroupChatMember(req.params.groupChatId, wrapUserId)) {
				continue;
			}
			validatedWraps.push({
				userId: wrapUserId,
				wrappedKey: String(wrap.wrappedKey),
				wrappedIv: String(wrap.wrappedIv),
				wrappedByUserId: req.user.id,
			});
		}

		const rotated = rotateGroupChatKey(
			req.params.groupChatId,
			currentGeneration,
			newGeneration,
			validatedWraps,
		);

		if (!rotated) {
			return res.status(409).json({ message: 'Group key generation has already moved on' });
		}

		const io = req.app.get('io');
		io.to(`group:${req.params.groupChatId}`).emit('group-key-rotated', {
			groupChatId: String(req.params.groupChatId),
			generation: newGeneration,
		});

		res.json({ ok: true, generation: newGeneration });
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

router.post('/:groupChatId/visit', authenticateToken, async (req, res) => {
	try {
		const access = canAccessGroupChat(req.params.groupChatId, req.user.id);
		if (!access.groupChat) {
			return res.status(404).json({ message: 'Group chat not found' });
		}
		if (!access.allowed) {
			return res.status(403).json({ message: access.reason });
		}

		const visitedAt = new Date().toISOString();
		markGroupChatVisited(req.user.id, req.params.groupChatId);

		const io = req.app.get('io');
		io.to(`group:${req.params.groupChatId}`).emit('group-read', {
			readerId: String(req.user.id),
			groupChatId: String(req.params.groupChatId),
			lastVisitedAt: visitedAt,
		});

		res.json({ ok: true });
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

router.get('/:groupChatId/read-state', authenticateToken, async (req, res) => {
	try {
		const access = canAccessGroupChat(req.params.groupChatId, req.user.id);
		if (!access.groupChat) {
			return res.status(404).json({ message: 'Group chat not found' });
		}
		if (!access.allowed) {
			return res.status(403).json({ message: access.reason });
		}

		const visits = getGroupChatVisits(req.params.groupChatId, req.user.id);
		res.json(
			visits.reduce((acc, visit) => {
				acc[String(visit.userId)] = visit.lastVisitedAt;
				return acc;
			}, {}),
		);
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Add a member (any current member may add others)
router.post('/:groupChatId/members', authenticateToken, async (req, res) => {
	try {
		const access = canAccessGroupChat(req.params.groupChatId, req.user.id);
		if (!access.groupChat) {
			return res.status(404).json({ message: 'Group chat not found' });
		}
		if (!access.allowed) {
			return res.status(403).json({ message: access.reason });
		}

		const userId = Number(req.body.userId);
		if (!Number.isInteger(userId)) {
			return res.status(400).json({ message: 'Invalid user id' });
		}

		addGroupChatMember(req.params.groupChatId, userId);

		const { wrappedKey, wrappedIv } = req.body;
		if (wrappedKey && wrappedIv) {
			const currentGeneration = getCurrentGroupChatKeyGeneration(req.params.groupChatId) || 1;
			insertGroupChatKeyGenerations(req.params.groupChatId, currentGeneration, [
				{ userId, wrappedKey: String(wrappedKey), wrappedIv: String(wrappedIv), wrappedByUserId: req.user.id },
			]);
		}

		const groupChat = findGroupChatById(req.params.groupChatId);
		const members = getGroupChatMembers(req.params.groupChatId);

		const io = req.app.get('io');
		io.in(String(userId)).socketsJoin(`group:${req.params.groupChatId}`);
		io.to(String(userId)).emit('group-chat-created', {
			...groupChat,
			members,
			unreadCount: 0,
			lastMessageAt: null,
		});

		res.json({ members });
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Leave a group chat
router.post('/:groupChatId/leave', authenticateToken, async (req, res) => {
	try {
		const access = canAccessGroupChat(req.params.groupChatId, req.user.id);
		if (!access.groupChat) {
			return res.status(404).json({ message: 'Group chat not found' });
		}

		removeGroupChatMember(req.params.groupChatId, req.user.id);

		const io = req.app.get('io');
		io.in(String(req.user.id)).socketsLeave(`group:${req.params.groupChatId}`);

		// A member just left, so the remaining members need a fresh key - the
		// one this member had access to must not keep working for them.
		const currentGeneration = getCurrentGroupChatKeyGeneration(req.params.groupChatId) || 1;
		io.to(`group:${req.params.groupChatId}`).emit('group-key-rotation-needed', {
			groupChatId: String(req.params.groupChatId),
			generation: currentGeneration + 1,
		});

		res.json({ ok: true });
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

export default router;
