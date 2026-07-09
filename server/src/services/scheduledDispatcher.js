import {
	createMessage,
	getConversationTtlSeconds,
	computeExpiresAt,
	getReplyContextByMessageId,
	syncMessageMentions,
} from '../models/Message.js';
import {
	getDueScheduledMessages,
	markScheduledMessageFailed,
	markScheduledMessageSent,
} from '../models/ScheduledMessage.js';
import { canAccessChannel, getChannelMembers } from '../models/Channel.js';
import { canAccessGroupChat, getGroupChatMembers } from '../models/GroupChat.js';
import { findUserById } from '../models/User.js';
import { getUserRole } from '../middleware/roles.js';
import { sendPushToUser } from './push.js';
import {
	createMentionNotifications,
	createReplyNotification,
} from './inAppNotifications.js';

const DISPATCH_INTERVAL_MS = 15000;
let dispatcherHandle = null;
let dispatchInFlight = false;

const deliverScheduledMessage = async (io, scheduledMessage) => {
	if (scheduledMessage.channelId) {
		const access = canAccessChannel(
			scheduledMessage.channelId,
			scheduledMessage.userId,
			getUserRole(scheduledMessage.userId),
		);
		if (!access.allowed) {
			throw new Error(access.reason || 'Channel access unavailable');
		}
	}

	if (scheduledMessage.groupChatId) {
		const access = canAccessGroupChat(
			scheduledMessage.groupChatId,
			scheduledMessage.userId,
		);
		if (!access.allowed) {
			throw new Error(access.reason || 'Group chat access unavailable');
		}
	}

	const ttlSeconds = getConversationTtlSeconds({
		channelId: scheduledMessage.channelId,
		recipientId: scheduledMessage.recipientId,
		groupChatId: scheduledMessage.groupChatId,
		currentUserId: scheduledMessage.userId,
	});
	const expiresAt = computeExpiresAt(ttlSeconds);
	const safeContent = scheduledMessage.isEncrypted ? '' : String(scheduledMessage.content || '');
	const messageId = createMessage(
		safeContent,
		scheduledMessage.userId,
		scheduledMessage.channelId || null,
		scheduledMessage.recipientId || null,
		null,
		null,
		null,
		null,
		scheduledMessage.cipherText || null,
		scheduledMessage.cipherIv || null,
		scheduledMessage.isEncrypted ? 1 : 0,
		scheduledMessage.replyToMessageId || null,
		scheduledMessage.threadRootMessageId || null,
		scheduledMessage.groupChatId || null,
		expiresAt,
		null,
		scheduledMessage.keyGeneration || null,
	);

	const mentions = syncMessageMentions(messageId, safeContent);
	const sender = findUserById(scheduledMessage.userId);
	const replyRecipientUserId = scheduledMessage.replyToMessageId
		? getReplyContextByMessageId(scheduledMessage.replyToMessageId)?.senderId
		: null;

	const message = {
		id: String(messageId),
		content: safeContent,
		senderId: scheduledMessage.userId,
		senderName: sender?.username || 'Unknown',
		senderAvatar: sender?.avatar || null,
		timestamp: new Date(),
		channelId: scheduledMessage.channelId ? String(scheduledMessage.channelId) : null,
		recipientId: scheduledMessage.recipientId ? String(scheduledMessage.recipientId) : null,
		groupChatId: scheduledMessage.groupChatId ? String(scheduledMessage.groupChatId) : null,
		expiresAt,
		cipherText: scheduledMessage.cipherText || null,
		cipherIv: scheduledMessage.cipherIv || null,
		isEncrypted: scheduledMessage.isEncrypted ? 1 : 0,
		keyGeneration:
			scheduledMessage.keyGeneration === null ||
			scheduledMessage.keyGeneration === undefined
				? null
				: Number(scheduledMessage.keyGeneration),
		reactions: [],
		mentions,
		replyToMessageId: scheduledMessage.replyToMessageId
			? String(scheduledMessage.replyToMessageId)
			: null,
		threadRootMessageId: scheduledMessage.threadRootMessageId
			? String(scheduledMessage.threadRootMessageId)
			: null,
		replyContext: scheduledMessage.replyToMessageId
			? getReplyContextByMessageId(scheduledMessage.replyToMessageId)
			: null,
	};

	if (scheduledMessage.groupChatId) {
		io.to(`group:${scheduledMessage.groupChatId}`).emit('message', message);
		const members = getGroupChatMembers(scheduledMessage.groupChatId);
		await Promise.all(
			members
				.filter((member) => String(member.id) !== String(scheduledMessage.userId))
				.map((member) =>
					sendPushToUser(
						member.id,
						{
							title: 'GWS Connect',
							body: 'You have a new message',
							icon: '/gws-connect-favicon.svg',
							url: '/dashboard',
						},
						{
							targetType: 'group',
							targetId: scheduledMessage.groupChatId,
						},
					),
				),
		);
	} else if (scheduledMessage.channelId) {
		io.to(`channel:${scheduledMessage.channelId}`).emit('message', message);
		const members = getChannelMembers(scheduledMessage.channelId);
		await Promise.all(
			members
				.filter((member) => String(member.id) !== String(scheduledMessage.userId))
				.map((member) =>
					sendPushToUser(
						member.id,
						{
							title: 'GWS Connect',
							body: 'You have a new message',
							icon: '/gws-connect-favicon.svg',
							url: '/dashboard',
						},
						{
							targetType: 'channel',
							targetId: scheduledMessage.channelId,
						},
					),
				),
		);

		if (mentions.length > 0) {
			const mentionedUserIds = [...new Set(mentions.map((mention) => mention.userId))];
			createMentionNotifications(io, {
				actorId: scheduledMessage.userId,
				mentionedUserIds,
				messageId: String(messageId),
				channelId: String(scheduledMessage.channelId),
			});
		}
	} else if (scheduledMessage.recipientId) {
		io.to(String(scheduledMessage.recipientId)).emit('message', message);
		io.to(String(scheduledMessage.userId)).emit('message', message);
		await sendPushToUser(
			scheduledMessage.recipientId,
			{
				title: 'GWS Connect',
				body: 'You have a new message',
				icon: '/gws-connect-favicon.svg',
				url: '/dashboard',
			},
			{
				targetType: 'dm',
				targetId: scheduledMessage.userId,
			},
		);
	}

	if (
		scheduledMessage.replyToMessageId &&
		replyRecipientUserId &&
		String(replyRecipientUserId) !== String(scheduledMessage.userId)
	) {
		createReplyNotification(io, {
			actorId: scheduledMessage.userId,
			replyRecipientUserId,
			messageId: String(messageId),
			sourceMessageId: String(scheduledMessage.replyToMessageId),
			channelId: scheduledMessage.channelId
				? String(scheduledMessage.channelId)
				: null,
			directUserId: scheduledMessage.recipientId
				? String(scheduledMessage.userId)
				: null,
		});
	}

	markScheduledMessageSent(scheduledMessage.id, messageId);
};

const dispatchScheduledMessages = async (io) => {
	if (dispatchInFlight) {
		return;
	}

	dispatchInFlight = true;
	try {
		const dueMessages = getDueScheduledMessages();
		for (const scheduledMessage of dueMessages) {
			try {
				await deliverScheduledMessage(io, scheduledMessage);
			} catch (error) {
				console.error('Scheduled message dispatch failed:', error);
				markScheduledMessageFailed(
					scheduledMessage.id,
					error instanceof Error ? error.message : 'Dispatch failed',
				);
			}
		}
	} finally {
		dispatchInFlight = false;
	}
};

export const startScheduledMessageDispatcher = (io) => {
	if (dispatcherHandle) {
		return;
	}

	void dispatchScheduledMessages(io);
	dispatcherHandle = setInterval(() => {
		void dispatchScheduledMessages(io);
	}, DISPATCH_INTERVAL_MS);
};
