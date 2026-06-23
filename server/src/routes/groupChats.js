import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
	addGroupChatMember,
	canAccessGroupChat,
	createGroupChat,
	findGroupChatById,
	findGroupChatsForUser,
	getGroupChatKeyForUser,
	getGroupChatMembers,
	markGroupChatVisited,
	removeGroupChatMember,
	upsertGroupChatKeys,
} from '../models/GroupChat.js';

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
			upsertGroupChatKeys(groupChatId, validKeys);
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

router.get('/:groupChatId/keys/me', authenticateToken, async (req, res) => {
	try {
		const access = canAccessGroupChat(req.params.groupChatId, req.user.id);
		if (!access.groupChat) {
			return res.status(404).json({ message: 'Group chat not found' });
		}
		if (!access.allowed) {
			return res.status(403).json({ message: access.reason });
		}

		const key = getGroupChatKeyForUser(req.params.groupChatId, req.user.id);
		if (!key) {
			return res.status(404).json({ message: 'Encryption key not yet available' });
		}

		res.json(key);
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

		markGroupChatVisited(req.user.id, req.params.groupChatId);
		res.json({ ok: true });
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
			upsertGroupChatKeys(req.params.groupChatId, [
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

		res.json({ ok: true });
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

export default router;
