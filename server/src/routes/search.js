import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
	getChannelMessages,
	getDirectMessages,
	getGroupChatMessages,
} from '../models/Message.js';
import { canAccessChannel } from '../models/Channel.js';
import { canAccessGroupChat } from '../models/GroupChat.js';
import { getUserRole } from '../middleware/roles.js';
import { findUserById } from '../models/User.js';

const router = express.Router();

const parseSearchQuery = (rawQuery) => {
	const raw = String(rawQuery || '');
	const filters = {
		from: null,
		in: null,
		before: null,
		after: null,
	};

	const text = raw.replace(
		/(?:^|\s)(from|in|before|after):("[^"]+"|\S+)/gi,
		(_, key, value) => {
			const normalizedValue = String(value || '').replace(/^"|"$/g, '');
			filters[key.toLowerCase()] = normalizedValue;
			return ' ';
		},
	);

	return {
		...filters,
		text: text.replace(/\s+/g, ' ').trim(),
	};
};

const toSearchResultMessage = (message) => ({
	id: String(message.id),
	content: message.content,
	senderId: String(message.senderId),
	senderName: message.senderUsername,
	senderAvatar: message.senderAvatar || null,
	channelId: message.channelId ? String(message.channelId) : undefined,
	recipientId: message.recipientId ? String(message.recipientId) : undefined,
	groupChatId: message.groupChatId ? String(message.groupChatId) : undefined,
	cipherText: message.cipherText || null,
	cipherIv: message.cipherIv || null,
	isEncrypted: message.isEncrypted,
	keyGeneration:
		message.keyGeneration === null || message.keyGeneration === undefined
			? null
			: Number(message.keyGeneration),
	timestamp: message.createdAt,
	fileUrl: message.fileUrl || null,
	fileName: message.fileName || null,
	fileType: message.fileType || null,
	fileIv: message.fileIv || null,
});

router.get('/', authenticateToken, async (req, res) => {
	try {
		const chatType = String(req.query?.chatType || '').trim();
		const chatId = String(req.query?.chatId || '').trim();
		const filters = parseSearchQuery(req.query?.q);

		if (!chatType || !chatId) {
			return res.status(400).json({ message: 'chatType and chatId are required' });
		}

		let messages = [];
		let contextLabel = '';

		if (chatType === 'channel') {
			const access = canAccessChannel(chatId, req.user.id, getUserRole(req.user.id));
			if (!access.channel) {
				return res.status(404).json({ message: 'Channel not found' });
			}
			if (!access.allowed) {
				return res.status(403).json({ message: access.reason });
			}
			messages = getChannelMessages(chatId, 500);
			contextLabel = access.channel.name || chatId;
		} else if (chatType === 'group') {
			const access = canAccessGroupChat(chatId, req.user.id);
			if (!access.groupChat) {
				return res.status(404).json({ message: 'Group chat not found' });
			}
			if (!access.allowed) {
				return res.status(403).json({ message: access.reason });
			}
			messages = getGroupChatMessages(chatId, 500);
			contextLabel = access.groupChat.name || chatId;
		} else if (chatType === 'dm') {
			if (String(chatId) === String(req.user.id)) {
				return res.status(400).json({ message: 'Invalid direct message target' });
			}
			messages = getDirectMessages(req.user.id, chatId, 500);
			contextLabel = findUserById(chatId)?.username || chatId;
		} else {
			return res.status(400).json({ message: 'Invalid chatType' });
		}

		const beforeTime = filters.before ? new Date(filters.before).getTime() : null;
		const afterTime = filters.after ? new Date(filters.after).getTime() : null;
		const normalizedFrom = filters.from?.toLowerCase() || '';
		const normalizedIn = filters.in?.toLowerCase() || '';
		const searchableContextLabel = contextLabel.toLowerCase();

		const filteredMessages = messages.filter((message) => {
			const messageTime = new Date(message.createdAt).getTime();
			if (beforeTime && Number.isFinite(beforeTime) && messageTime >= beforeTime) {
				return false;
			}
			if (afterTime && Number.isFinite(afterTime) && messageTime <= afterTime) {
				return false;
			}
			if (
				normalizedFrom &&
				!String(message.senderUsername || '').toLowerCase().includes(normalizedFrom)
			) {
				return false;
			}
			if (normalizedIn && !searchableContextLabel.includes(normalizedIn)) {
				return false;
			}
			return true;
		});

		return res.json({
			query: filters.text,
			messages: filteredMessages.map(toSearchResultMessage),
		});
	} catch (error) {
		console.error('Search route error:', error);
		return res.status(500).json({ message: 'Server error' });
	}
});

export default router;
