import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getUserRole, isChannelManager, requireChannelManagerOrAdmin } from '../middleware/roles.js';
import { canAccessChannel, getChannelMembers } from '../models/Channel.js';
import {
	computeExpiresAt,
	createMessage,
	getConversationTtlSeconds,
	syncMessageMentions,
} from '../models/Message.js';
import {
	createWebhook,
	findActiveWebhookByToken,
	findWebhookById,
	listWebhooksForChannel,
	revokeWebhook,
} from '../models/Webhook.js';
import { createMentionNotifications } from '../services/inAppNotifications.js';
import { sendPushToUser } from '../services/push.js';
import { logAuditEvent } from '../services/auditLog.js';

const router = express.Router();

const normalizeWebhookName = (value) =>
	String(value || '')
		.trim()
		.slice(0, 60);

const normalizeWebhookAvatar = (value) =>
	String(value || '')
		.trim()
		.slice(0, 500);

router.post('/:token/incoming', async (req, res) => {
	try {
		const webhook = findActiveWebhookByToken(req.params.token);
		if (!webhook) {
			return res.status(404).json({ message: 'Webhook not found' });
		}

		const content = String(req.body?.content || req.body?.text || '')
			.trim()
			.slice(0, 4000);
		if (!content) {
			return res.status(400).json({ message: 'content is required' });
		}

		const messageExpiresAt = computeExpiresAt(
			getConversationTtlSeconds({ channelId: webhook.channelId }),
		);
		const senderNameOverride =
			normalizeWebhookName(req.body?.username) || webhook.name;
		const senderAvatarOverride =
			normalizeWebhookAvatar(req.body?.avatarUrl) ||
			normalizeWebhookAvatar(webhook.avatarUrl) ||
			null;
		const messageId = createMessage(
			content,
			webhook.createdBy,
			webhook.channelId,
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			0,
			null,
			null,
			null,
			messageExpiresAt,
			null,
			null,
			senderNameOverride,
			senderAvatarOverride,
		);
		const mentions = syncMessageMentions(messageId, content);
		const message = {
			id: String(messageId),
			content,
			senderId: String(webhook.createdBy),
			senderName: senderNameOverride,
			senderAvatar: senderAvatarOverride || null,
			channelId: String(webhook.channelId),
			recipientId: null,
			groupChatId: null,
			expiresAt: messageExpiresAt,
			cipherText: null,
			cipherIv: null,
			isEncrypted: 0,
			keyGeneration: null,
			reactions: [],
			mentions,
			replyToMessageId: null,
			threadRootMessageId: null,
			replyContext: null,
			timestamp: new Date(),
		};

		const io = req.app.get('io');
		io.to(`channel:${webhook.channelId}`).emit('message', message);

		await Promise.all(
			getChannelMembers(webhook.channelId)
				.filter((member) => String(member.id) !== String(webhook.createdBy))
				.map((member) =>
					sendPushToUser(
						member.id,
						{
							title: senderNameOverride,
							body: content.length > 120 ? `${content.slice(0, 117)}...` : content,
							icon: senderAvatarOverride || '/gws-connect-favicon.svg',
							url: '/dashboard',
						},
						{
							targetType: 'channel',
							targetId: String(webhook.channelId),
						},
					),
				),
		);

		if (mentions.length > 0) {
			createMentionNotifications(io, {
				actorId: webhook.createdBy,
				messageId: String(messageId),
				channelId: String(webhook.channelId),
				mentions,
			});
		}

		return res.status(202).json({ ok: true, messageId: String(messageId) });
	} catch (error) {
		console.error('Webhook incoming error:', error);
		return res.status(500).json({ message: 'Server error' });
	}
});

router.get(
	'/channel/:channelId',
	authenticateToken,
	requireChannelManagerOrAdmin('channelId'),
	(req, res) => {
		try {
			res.json(listWebhooksForChannel(req.params.channelId));
		} catch (error) {
			console.error('Webhook list error:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

router.post(
	'/channel/:channelId',
	authenticateToken,
	requireChannelManagerOrAdmin('channelId'),
	(req, res) => {
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

			const name = normalizeWebhookName(req.body?.name);
			if (!name) {
				return res.status(400).json({ message: 'Webhook name is required' });
			}

			const webhook = createWebhook(
				req.params.channelId,
				name,
				req.user.id,
				normalizeWebhookAvatar(req.body?.avatarUrl),
			);
			logAuditEvent({
				actorId: req.user.id,
				action: 'webhook.create',
				targetType: 'webhook',
				targetId: webhook.id,
				metadata: {
					channelId: String(req.params.channelId),
					name: webhook.name,
				},
			});

			res.status(201).json(webhook);
		} catch (error) {
			console.error('Webhook create error:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

router.delete('/:webhookId', authenticateToken, (req, res) => {
	try {
		const webhook = findWebhookById(req.params.webhookId);
		if (!webhook) {
			return res.status(404).json({ message: 'Webhook not found' });
		}

		const role = getUserRole(req.user.id);
		if (role !== 'admin' && !isChannelManager(webhook.channelId, req.user.id)) {
			return res.status(403).json({ message: 'Access denied' });
		}

		const result = revokeWebhook(req.params.webhookId);
		if (result.changes === 0) {
			return res.status(404).json({ message: 'Webhook already revoked' });
		}

		logAuditEvent({
			actorId: req.user.id,
			action: 'webhook.revoke',
			targetType: 'webhook',
			targetId: String(req.params.webhookId),
			metadata: {
				channelId: webhook.channelId,
				name: webhook.name,
			},
		});

		return res.json({ ok: true });
	} catch (error) {
		console.error('Webhook revoke error:', error);
		return res.status(500).json({ message: 'Server error' });
	}
});

export default router;
