import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth.js';
import {
	computeExpiresAt,
	createMessage,
	getChannelMessages,
	getConversationTtlSeconds,
	getDirectConversationSummaries,
	getDirectMessages,
	getDirectMessageSettings,
	getDirectMessageVisit,
	getGroupChatMessages,
	getGroupChatVisits,
	getMessageFileById,
	getChannelFiles,
	getDirectFiles,
	getMessageThreadRecordById,
	getMessageMentions,
	getPinnedMessages,
	getReplyContextsByMessageIds,
	markDirectConversationVisited,
	searchMessages,
	setDirectMessageSettings,
	syncMessageMentions,
	updateMessageFileInfo,
} from '../models/Message.js';
import { getPollByMessageId, getPollSummary } from '../models/Poll.js';
import { getMessageReactions } from '../models/Reaction.js';
import {
	canAccessChannel,
	getChannelMembers,
	getCurrentChannelKeyGeneration,
	markChannelVisited,
} from '../models/Channel.js';
import { canAccessGroupChat, getCurrentGroupChatKeyGeneration, getGroupChatMembers, markGroupChatVisited } from '../models/GroupChat.js';
import { canSendMessage, getUserRole } from '../middleware/roles.js';
import { findUserById } from '../models/User.js';
import {
	createMentionNotifications,
	createReplyNotification,
} from '../services/inAppNotifications.js';
import { sendErrorNotification } from '../services/errorReporter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir =
	process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');
mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
	destination: uploadsDir,
	filename: (req, file, cb) => {
		const ext = path.extname(file.originalname);
		const safeName = `${Date.now()}-${Math.random()
			.toString(36)
			.slice(2)}${ext}`;
		cb(null, safeName);
	},
});

const upload = multer({
	storage,
	limits: { fileSize: 250 * 1024 * 1024 }, // 250MB for medium/large videos
});

const router = express.Router();

const buildMentionsMap = (messageIds) => {
	const mentions = getMessageMentions(messageIds);
	return mentions.reduce((accumulator, mention) => {
		const existing = accumulator.get(mention.messageId) || [];
		existing.push({
			userId: mention.userId,
			username: mention.username,
			avatar: mention.avatar,
			startIndex: mention.startIndex,
			endIndex: mention.endIndex,
		});
		accumulator.set(mention.messageId, existing);
		return accumulator;
	}, new Map());
};

const normalizeId = (value) =>
	value === null || value === undefined ? null : String(value);

const replyBelongsToConversation = ({
	replyMessage,
	channelId,
	recipientId,
	groupChatId,
	currentUserId,
}) => {
	if (channelId) {
		return normalizeId(replyMessage.channelId) === normalizeId(channelId);
	}

	if (groupChatId) {
		return normalizeId(replyMessage.groupChatId) === normalizeId(groupChatId);
	}

	if (!recipientId) {
		return false;
	}

	const normalizedRecipientId = normalizeId(recipientId);
	const normalizedCurrentUserId = normalizeId(currentUserId);

	return (
		(normalizeId(replyMessage.senderId) === normalizedCurrentUserId &&
			normalizeId(replyMessage.recipientId) === normalizedRecipientId) ||
		(normalizeId(replyMessage.senderId) === normalizedRecipientId &&
			normalizeId(replyMessage.recipientId) === normalizedCurrentUserId)
	);
};

const resolveReplyState = ({
	replyToMessageId,
	channelId,
	recipientId,
	groupChatId,
	currentUserId,
}) => {
	if (!replyToMessageId) {
		return {
			replyToMessageId: null,
			threadRootMessageId: null,
			replyContext: null,
		};
	}

	const replyMessage = getMessageThreadRecordById(replyToMessageId);

	if (!replyMessage || replyMessage.isArchived) {
		return { error: 'Message unavailable for reply' };
	}

	if (
		!replyBelongsToConversation({
			replyMessage,
			channelId,
			recipientId,
			groupChatId,
			currentUserId,
		})
	) {
		return { error: 'Reply target is not in this conversation' };
	}

	return {
		replyToMessageId: normalizeId(replyMessage.id),
		threadRootMessageId: normalizeId(
			replyMessage.threadRootMessageId || replyMessage.id,
		),
		replyContext: getReplyContextsByMessageIds([replyMessage.id]).get(
			normalizeId(replyMessage.id),
		),
	};
};

const formatMessages = (messages, viewerId) => {
	const mentionsByMessageId = buildMentionsMap(
		messages.map((message) => message.id),
	);
	const replyMessageIds = [
		...new Set(
			messages
				.map((message) => message.replyToMessageId)
				.filter((messageId) => messageId !== null && messageId !== undefined),
		),
	];
	const replyContextsById = getReplyContextsByMessageIds(replyMessageIds);

	return messages.map((msg) => {
		const poll = getPollByMessageId(msg.id);
		const pollSummary = poll ? getPollSummary(poll.id, viewerId, true) : null;
		const reactions = getMessageReactions(msg.id, viewerId);

		return {
			id: msg.id.toString(),
			content: msg.content,
			senderId: msg.senderId,
			senderName: msg.senderUsername,
			senderAvatar: msg.senderAvatar,
			channelId: msg.channelId,
			recipientId: msg.recipientId,
			groupChatId: msg.groupChatId,
			cipherText: msg.cipherText,
			cipherIv: msg.cipherIv,
			isEncrypted: msg.isEncrypted,
			timestamp: msg.createdAt,
			editedAt: msg.editedAt,
			isDeleted: msg.isDeleted,
			deletedAt: msg.deletedAt,
			fileUrl: msg.fileUrl,
			fileName: msg.fileName,
			fileType: msg.fileType,
			poll: pollSummary,
			reactions,
			isPinned: Boolean(msg.isPinned),
			pinnedAt: msg.pinnedAt,
			mentions: mentionsByMessageId.get(msg.id.toString()) || [],
			replyToMessageId: normalizeId(msg.replyToMessageId),
			threadRootMessageId: normalizeId(msg.threadRootMessageId),
			replyContext: msg.replyToMessageId
				? replyContextsById.get(normalizeId(msg.replyToMessageId))
				: null,
		};
	});
};

// Get channel messages
router.get('/channel/:channelId', authenticateToken, async (req, res) => {
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

		const messages = getChannelMessages(req.params.channelId);
		const formattedMessages = formatMessages(messages, req.user.id);
		markChannelVisited(req.user.id, req.params.channelId);
		res.json(formattedMessages);
	} catch (error) {
		void sendErrorNotification({
			error,
			context: {
				source: 'http',
				route: 'GET /api/messages/channel/:channelId',
				userId: req.user?.id,
				params: req.params,
				query: req.query,
			},
		});
		res.status(500).json({ message: 'Server error' });
	}
});

router.post(
	'/channel/:channelId/visit',
	authenticateToken,
	async (req, res) => {
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
	},
);

router.get('/search', authenticateToken, async (req, res) => {
	try {
		const query = String(req.query.q || '').trim();
		const { channelId, recipientId, groupChatId } = req.query;

		if (query.length < 2) {
			return res.status(400).json({ message: 'Search query must be at least 2 characters' });
		}

		if (channelId) {
			const access = canAccessChannel(channelId, req.user.id, getUserRole(req.user.id));
			if (!access.channel) {
				return res.status(404).json({ message: 'Channel not found' });
			}
			if (!access.allowed) {
				return res.status(403).json({ message: access.reason });
			}
		} else if (groupChatId) {
			const access = canAccessGroupChat(groupChatId, req.user.id);
			if (!access.groupChat) {
				return res.status(404).json({ message: 'Group chat not found' });
			}
			if (!access.allowed) {
				return res.status(403).json({ message: access.reason });
			}
		} else if (!recipientId) {
			return res.status(400).json({ message: 'channelId, recipientId, or groupChatId is required' });
		}

		const messages = searchMessages(query, {
			channelId: channelId || null,
			recipientId: recipientId || null,
			groupChatId: groupChatId || null,
			currentUserId: req.user.id,
		});
		res.json(formatMessages(messages, req.user.id));
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

router.get('/channel/:channelId/pinned', authenticateToken, async (req, res) => {
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

		const messages = getPinnedMessages(req.params.channelId, null, req.user.id);
		res.json(formatMessages(messages, req.user.id));
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

router.get('/direct/:userId/pinned', authenticateToken, async (req, res) => {
	try {
		const messages = getPinnedMessages(null, req.params.userId, req.user.id);
		res.json(formatMessages(messages, req.user.id));
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

router.get('/direct-conversations', authenticateToken, async (req, res) => {
	try {
		const conversations = getDirectConversationSummaries(req.user.id);
		res.json(conversations);
	} catch (error) {
		void sendErrorNotification({
			error,
			context: {
				source: 'http',
				route: 'GET /api/messages/direct-conversations',
				userId: req.user?.id,
			},
		});
		res.status(500).json({ message: 'Server error' });
	}
});

// Get direct messages
router.get('/direct/:userId', authenticateToken, async (req, res) => {
	try {
		const messages = getDirectMessages(req.user.id, req.params.userId);
		const formattedMessages = formatMessages(messages, req.user.id);
		markDirectConversationVisited(req.user.id, req.params.userId);
		res.json(formattedMessages);
	} catch (error) {
		void sendErrorNotification({
			error,
			context: {
				source: 'http',
				route: 'GET /api/messages/direct/:userId',
				userId: req.user?.id,
				params: req.params,
				query: req.query,
			},
		});
		res.status(500).json({ message: 'Server error' });
	}
});

router.post('/direct/:userId/visit', authenticateToken, async (req, res) => {
	try {
		const visitedAt = new Date().toISOString();
		markDirectConversationVisited(req.user.id, req.params.userId);

		const io = req.app.get('io');
		io.to(String(req.params.userId)).emit('dm-read', {
			readerId: String(req.user.id),
			peerId: String(req.params.userId),
			lastVisitedAt: visitedAt,
		});

		return res.json({ ok: true });
	} catch (error) {
		return res.status(500).json({ message: 'Server error' });
	}
});

router.get('/direct/:userId/read-state', authenticateToken, async (req, res) => {
	try {
		const visit = getDirectMessageVisit(req.params.userId, req.user.id);
		res.json({ lastVisitedAt: visit?.lastVisitedAt || null });
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

router.get('/direct/:userId/settings', authenticateToken, async (req, res) => {
	try {
		const settings = getDirectMessageSettings(req.user.id, req.params.userId);
		res.json({ disappearingMessagesSeconds: settings?.disappearingMessagesSeconds || 0 });
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

router.put('/direct/:userId/settings', authenticateToken, async (req, res) => {
	try {
		const { disappearingMessagesSeconds } = req.body;
		const normalizedTtl = Math.max(0, Number(disappearingMessagesSeconds) || 0);
		setDirectMessageSettings(req.user.id, req.params.userId, normalizedTtl);

		const io = req.app.get('io');
		io.to(String(req.params.userId)).emit('dm-settings-updated', {
			peerId: String(req.user.id),
			disappearingMessagesSeconds: normalizedTtl,
		});
		io.to(String(req.user.id)).emit('dm-settings-updated', {
			peerId: String(req.params.userId),
			disappearingMessagesSeconds: normalizedTtl,
		});

		res.json({ disappearingMessagesSeconds: normalizedTtl });
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

router.get('/group/:groupChatId', authenticateToken, async (req, res) => {
	try {
		const access = canAccessGroupChat(req.params.groupChatId, req.user.id);
		if (!access.groupChat) {
			return res.status(404).json({ message: 'Group chat not found' });
		}
		if (!access.allowed) {
			return res.status(403).json({ message: access.reason });
		}

		const messages = getGroupChatMessages(req.params.groupChatId);
		const formattedMessages = formatMessages(messages, req.user.id);
		markGroupChatVisited(req.user.id, req.params.groupChatId);
		res.json(formattedMessages);
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

router.post('/group/:groupChatId/visit', authenticateToken, async (req, res) => {
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

router.get('/group/:groupChatId/pinned', authenticateToken, async (req, res) => {
	try {
		const access = canAccessGroupChat(req.params.groupChatId, req.user.id);
		if (!access.groupChat) {
			return res.status(404).json({ message: 'Group chat not found' });
		}
		if (!access.allowed) {
			return res.status(403).json({ message: access.reason });
		}

		const messages = getPinnedMessages(null, null, req.user.id, req.params.groupChatId);
		res.json(formatMessages(messages, req.user.id));
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

router.get('/:messageId', authenticateToken, async (req, res) => {
	try {
		const message = getMessageThreadRecordById(req.params.messageId);
		if (!message || message.isArchived) {
			return res.status(404).json({ message: 'Message not found' });
		}

		if (message.channelId) {
			const access = canAccessChannel(
				message.channelId,
				req.user.id,
				getUserRole(req.user.id),
			);
			if (!access.channel) {
				return res.status(404).json({ message: 'Channel not found' });
			}
			if (!access.allowed) {
				return res.status(403).json({ message: access.reason });
			}
		} else if (
			String(message.senderId) !== String(req.user.id) &&
			String(message.recipientId) !== String(req.user.id)
		) {
			return res.status(403).json({ message: 'Access denied' });
		}

		const formattedMessage = formatMessages([message], req.user.id)[0];
		res.json(formattedMessage);
	} catch (error) {
		void sendErrorNotification({
			error,
			context: {
				source: 'http',
				route: 'GET /api/messages/:messageId',
				userId: req.user?.id,
				params: req.params,
			},
		});
		res.status(500).json({ message: 'Server error' });
	}
});

router.post('/', authenticateToken, async (req, res) => {
	try {
		const {
			content,
			channelId = null,
			recipientId = null,
			replyToMessageId = null,
			cipherText = null,
			cipherIv = null,
			isEncrypted = false,
		} = req.body || {};

		if (!channelId && !recipientId) {
			return res.status(400).json({ message: 'Conversation target required' });
		}

		if (channelId && recipientId) {
			return res.status(400).json({
				message: 'Provide either channelId or recipientId, not both',
			});
		}

		if (recipientId && String(recipientId) === String(req.user.id)) {
			return res.status(400).json({ message: 'Invalid direct message target' });
		}

		if (!isEncrypted && !String(content || '').trim()) {
			return res.status(400).json({ message: 'Message content required' });
		}

		if (channelId) {
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

			const permissionCheck = canSendMessage(channelId, req.user.id);
			if (!permissionCheck.allowed) {
				return res.status(403).json({ message: permissionCheck.reason });
			}
		}

		const replyState = resolveReplyState({
			replyToMessageId,
			channelId,
			recipientId,
			currentUserId: req.user.id,
		});

		if (replyState.error) {
			return res.status(400).json({ message: replyState.error });
		}

		const safeContent = isEncrypted ? '' : String(content || '').trim();
		const ttlSeconds = getConversationTtlSeconds({
			channelId,
			recipientId,
			groupChatId: null,
			currentUserId: req.user.id,
		});
		const messageExpiresAt = computeExpiresAt(ttlSeconds);
		const messageId = createMessage(
			safeContent,
			req.user.id,
			channelId || null,
			recipientId || null,
			null,
			null,
			null,
			null,
			cipherText || null,
			cipherIv || null,
			isEncrypted ? 1 : 0,
			replyState.replyToMessageId,
			replyState.threadRootMessageId,
			null,
			messageExpiresAt,
		);
		const mentions = syncMessageMentions(messageId, safeContent);

		const sender = findUserById(req.user.id);
		const replyRecipientUserId = replyState.replyContext?.senderId;
		const message = {
			id: messageId.toString(),
			content: safeContent,
			senderId: req.user.id,
			senderName: req.user.username,
			senderAvatar: sender?.avatar || null,
			timestamp: new Date(),
			channelId,
			recipientId,
			expiresAt: messageExpiresAt,
			cipherText: cipherText || null,
			cipherIv: cipherIv || null,
			isEncrypted: isEncrypted ? 1 : 0,
			reactions: [],
			mentions,
			replyToMessageId: replyState.replyToMessageId,
			threadRootMessageId: replyState.threadRootMessageId,
			replyContext: replyState.replyContext,
		};

		const io = req.app.get('io');
		const { sendPushToUser } = await import('../services/push.js');

		if (channelId) {
			io.to(`channel:${channelId}`).emit('message', message);

			const members = getChannelMembers(channelId);
			const channel = findChannelById(channelId);
			const payload = {
				title: 'GWS Connect',
				body: 'You have a new message',
				icon: '/gws-connect-favicon.svg',
				url: '/dashboard',
			};

			await Promise.all(
				members
					.filter((member) => String(member.id) !== String(req.user.id))
					.map((member) => sendPushToUser(member.id, payload)),
			);

			if (mentions.length > 0) {
				const mentionedUserIds = [
					...new Set(mentions.map((mention) => mention.userId)),
				];
				createMentionNotifications(io, {
					actorId: req.user.id,
					mentionedUserIds,
					messageId: messageId.toString(),
					channelId,
				});
			}
		} else if (recipientId) {
			io.to(String(recipientId)).emit('message', message);
			io.to(String(req.user.id)).emit('message', message);

			await sendPushToUser(recipientId, {
				title: 'GWS Connect',
				body: 'You have a new message',
				icon: '/gws-connect-favicon.svg',
				url: '/dashboard',
			});
		}

		if (
			replyState.replyToMessageId &&
			replyRecipientUserId &&
			String(replyRecipientUserId) !== String(req.user.id)
		) {
			createReplyNotification(io, {
				actorId: req.user.id,
				replyRecipientUserId,
				messageId: messageId.toString(),
				sourceMessageId: replyState.replyToMessageId,
				channelId: channelId || null,
				directUserId: recipientId ? String(req.user.id) : null,
			});
		}

		return res.json({ ok: true, message });
	} catch (error) {
		void sendErrorNotification({
			error,
			context: {
				source: 'http',
				route: 'POST /api/messages',
				userId: req.user?.id,
				payload: req.body,
			},
		});
		return res.status(500).json({ message: 'Server error' });
	}
});

router.post(
	'/upload',
	authenticateToken,
	upload.single('file'),
	async (req, res) => {
		try {
			const {
				channelId,
				recipientId,
				groupChatId,
				content,
				replyToMessageId,
				fileIv,
				encryptedFileMeta,
				fileMetaIv,
			} = req.body || {};
			const file = req.file;

			if (!file) {
				return res.status(400).json({ message: 'File required' });
			}

			// Every attachment is E2EE - never store one without the client
			// having encrypted it first, the same stance taken for channel text
			// messages.
			if (!fileIv || !encryptedFileMeta || !fileMetaIv) {
				return res
					.status(400)
					.json({ message: 'Attachment encryption metadata is required' });
			}

			const targetCount = [channelId, recipientId, groupChatId].filter(Boolean).length;

			if (targetCount === 0) {
				return res
					.status(400)
					.json({ message: 'Conversation target required' });
			}

			if (targetCount > 1) {
				return res.status(400).json({
					message: 'Provide exactly one of channelId, recipientId, or groupChatId',
				});
			}

			if (recipientId && String(recipientId) === String(req.user.id)) {
				return res
					.status(400)
					.json({ message: 'Invalid direct message target' });
			}

			if (channelId) {
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

				const permissionCheck = canSendMessage(channelId, req.user.id);
				if (!permissionCheck.allowed) {
					return res.status(403).json({ message: permissionCheck.reason });
				}
			}

			if (groupChatId) {
				const access = canAccessGroupChat(groupChatId, req.user.id);
				if (!access.groupChat) {
					return res.status(404).json({ message: 'Group chat not found' });
				}
				if (!access.allowed) {
					return res.status(403).json({ message: access.reason });
				}
			}

			const replyState = resolveReplyState({
				replyToMessageId,
				channelId,
				recipientId,
				groupChatId,
				currentUserId: req.user.id,
			});

			if (replyState.error) {
				return res.status(400).json({ message: replyState.error });
			}

			let messageKeyGeneration = null;
			if (channelId) {
				messageKeyGeneration = getCurrentChannelKeyGeneration(channelId) || 1;
			} else if (groupChatId) {
				messageKeyGeneration = getCurrentGroupChatKeyGeneration(groupChatId) || 1;
			}

			const ttlSeconds = getConversationTtlSeconds({
				channelId,
				recipientId,
				groupChatId,
				currentUserId: req.user.id,
			});
			const messageExpiresAt = computeExpiresAt(ttlSeconds);
			const messageId = createMessage(
				content || '',
				req.user.id,
				channelId || null,
				recipientId || null,
				null,
				encryptedFileMeta,
				null,
				file.filename,
				null,
				fileMetaIv,
				1,
				replyState.replyToMessageId,
				replyState.threadRootMessageId,
				groupChatId || null,
				messageExpiresAt,
				fileIv,
				messageKeyGeneration,
			);

			const fileUrl = `/api/messages/file/${messageId}`;
			updateMessageFileInfo(messageId, fileUrl, file.filename);
			const mentions = syncMessageMentions(messageId, content || '');

			const sender = findUserById(req.user.id);
			const replyRecipientUserId = replyState.replyContext?.senderId;
			const message = {
				id: messageId.toString(),
				content: content || '',
				senderId: req.user.id,
				senderName: sender?.username || 'Unknown',
				senderAvatar: sender?.avatar || null,
				channelId: channelId || null,
				recipientId: recipientId || null,
				groupChatId: groupChatId || null,
				expiresAt: messageExpiresAt,
				fileUrl,
				fileName: encryptedFileMeta,
				fileType: null,
				fileIv,
				cipherIv: fileMetaIv,
				isEncrypted: 1,
				keyGeneration: messageKeyGeneration,
				timestamp: new Date(),
				reactions: [],
				mentions,
				replyToMessageId: replyState.replyToMessageId,
				threadRootMessageId: replyState.threadRootMessageId,
				replyContext: replyState.replyContext,
			};

			const io = req.app.get('io');
			if (groupChatId) {
				io.to(`group:${groupChatId}`).emit('message', message);

				const { sendPushToUser } = await import('../services/push.js');
				const members = getGroupChatMembers(groupChatId);
				await Promise.all(
					members
						.filter((member) => String(member.id) !== String(req.user.id))
						.map((member) =>
							sendPushToUser(member.id, {
								title: 'GWS Connect',
								body: 'You have a new message',
								icon: '/gws-connect-favicon.svg',
								url: '/dashboard',
							}),
						),
				);
			} else if (channelId) {
				io.to(`channel:${channelId}`).emit('message', message);

				// Send mention notifications for file uploads with content
				if (mentions.length > 0) {
					const { findChannelById: findCh } =
						await import('../models/Channel.js');
					const { sendPushToUser } = await import('../services/push.js');

					const mentionedUserIds = [
						...new Set(mentions.map((mention) => mention.userId)),
					];
					createMentionNotifications(io, {
						actorId: req.user.id,
						mentionedUserIds,
						messageId: messageId.toString(),
						channelId: String(channelId),
					});
					const channel = findCh(channelId);
					const mentionPayload = {
						title: 'GWS Connect',
						body: 'You were mentioned',
						icon: '/gws-connect-favicon.svg',
						url: '/dashboard',
						tag: `mention-${messageId}`,
					};

					await Promise.all(
						mentionedUserIds.map((userId) =>
							sendPushToUser(userId, mentionPayload),
						),
					);
				}
			} else if (recipientId) {
				io.to(String(recipientId)).emit('message', message);
				io.to(String(req.user.id)).emit('message', message);
			}

			if (
				replyState.replyToMessageId &&
				replyRecipientUserId &&
				String(replyRecipientUserId) !== String(req.user.id)
			) {
				createReplyNotification(io, {
					actorId: req.user.id,
					replyRecipientUserId,
					messageId: messageId.toString(),
					sourceMessageId: replyState.replyToMessageId,
					channelId: channelId ? String(channelId) : null,
					directUserId: recipientId ? String(req.user.id) : null,
				});
			}

			return res.json({ messageId: messageId.toString(), fileUrl });
		} catch (error) {
			console.error('File upload error:', error);
			void sendErrorNotification({
				error,
				context: {
					source: 'http',
					route: 'POST /api/messages/upload',
					userId: req.user?.id,
					payload: {
						channelId: req.body?.channelId,
						recipientId: req.body?.recipientId,
						content: req.body?.content,
						fileName: req.file?.originalname,
					},
				},
			});
			return res.status(500).json({ message: 'Upload failed' });
		}
	},
);

router.get('/channel/:channelId/files', authenticateToken, async (req, res) => {
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

		const files = getChannelFiles(req.params.channelId).map((row) => ({
			id: row.id.toString(),
			fileUrl: row.fileUrl,
			fileName: row.fileName,
			fileType: row.fileType,
			timestamp: row.createdAt,
			senderName: row.senderUsername,
			senderAvatar: row.senderAvatar,
		}));

		return res.json(files);
	} catch (error) {
		void sendErrorNotification({
			error,
			context: {
				source: 'http',
				route: 'GET /api/messages/channel/:channelId/files',
				userId: req.user?.id,
				params: req.params,
				query: req.query,
			},
		});
		return res.status(500).json({ message: 'Server error' });
	}
});

router.get('/direct/:userId/files', authenticateToken, async (req, res) => {
	try {
		const files = getDirectFiles(req.user.id, req.params.userId).map((row) => ({
			id: row.id.toString(),
			fileUrl: row.fileUrl,
			fileName: row.fileName,
			fileType: row.fileType,
			timestamp: row.createdAt,
			senderName: row.senderUsername,
			senderAvatar: row.senderAvatar,
		}));

		return res.json(files);
	} catch (error) {
		void sendErrorNotification({
			error,
			context: {
				source: 'http',
				route: 'GET /api/messages/direct/:userId/files',
				userId: req.user?.id,
				params: req.params,
				query: req.query,
			},
		});
		return res.status(500).json({ message: 'Server error' });
	}
});

router.get('/file/:messageId', authenticateToken, async (req, res) => {
	try {
		const message = getMessageFileById(req.params.messageId);
		if (!message || !message.filePath) {
			return res.status(404).json({ message: 'File not found' });
		}

		if (message.channelId) {
			const access = canAccessChannel(
				message.channelId,
				req.user.id,
				getUserRole(req.user.id),
			);
			if (!access.channel) {
				return res.status(404).json({ message: 'Channel not found' });
			}
			if (!access.allowed) {
				return res.status(403).json({ message: access.reason });
			}
		} else if (message.recipientId) {
			if (
				String(message.recipientId) !== String(req.user.id) &&
				String(message.senderId) !== String(req.user.id)
			) {
				return res.status(403).json({ message: 'Access denied' });
			}
		} else if (message.groupChatId) {
			const access = canAccessGroupChat(message.groupChatId, req.user.id);
			if (!access.groupChat) {
				return res.status(404).json({ message: 'Group chat not found' });
			}
			if (!access.allowed) {
				return res.status(403).json({ message: access.reason });
			}
		} else {
			return res.status(403).json({ message: 'Access denied' });
		}

		const absolutePath = path.join(uploadsDir, message.filePath);
		return res.sendFile(absolutePath);
	} catch (error) {
		void sendErrorNotification({
			error,
			context: {
				source: 'http',
				route: 'GET /api/messages/file/:messageId',
				userId: req.user?.id,
				params: req.params,
				query: req.query,
			},
		});
		return res.status(500).json({ message: 'Server error' });
	}
});

export default router;
