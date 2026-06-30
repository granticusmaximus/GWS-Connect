import { existsSync } from 'fs';
import path from 'path';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import './database.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import channelRoutes from './routes/channels.js';
import groupChatRoutes from './routes/groupChats.js';
import messageRoutes from './routes/messages.js';
import adminRoutes from './routes/admin.js';
import managerRoutes from './routes/manager.js';
import friendRoutes from './routes/friends.js';
import notificationRoutes from './routes/notifications.js';
import pollRoutes from './routes/polls.js';
import gifRoutes from './routes/gifs.js';
import inviteRoutes from './routes/invites.js';
import { authenticateSocket } from './middleware/auth.js';
import { canSendMessage, getUserRole } from './middleware/roles.js';
import { canAccessChannel } from './models/Channel.js';
import { canAccessGroupChat, findGroupChatsForUser } from './models/GroupChat.js';
import {
	getMessageThreadRecordById,
	getReplyContextByMessageId,
} from './models/Message.js';
import { findUserById } from './models/User.js';
import {
	createMentionNotifications,
	createReactionNotification,
	createReplyNotification,
} from './services/inAppNotifications.js';
import { sendErrorNotification } from './services/errorReporter.js';
import { logSocketError, errorLoggingMiddleware } from './utils/logger.js';

dotenv.config();

const requiredEnvVars = ['JWT_SECRET'];
const missingEnvVars = requiredEnvVars.filter(
	(name) => !process.env[name] || !String(process.env[name]).trim(),
);

if (missingEnvVars.length > 0) {
	console.error(
		`Missing required environment variables: ${missingEnvVars.join(', ')}`,
	);
	process.exit(1);
}

const app = express();
// Behind a single reverse proxy (nginx/traefik) in production — trust only
// the first hop's X-Forwarded-For so rate limiting keys on the real client IP.
app.set('trust proxy', 1);
const httpServer = createServer(app);
const rawOrigins = process.env.CLIENT_URL || 'http://localhost:5173';
const allowedOrigins = rawOrigins.split(',').map((origin) => origin.trim());
const PRIVATE_IPV4_ORIGIN_PATTERN =
	/^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})$/;
const DEV_CLIENT_PORTS = new Set(['5173', '5157']);

const isAllowedOrigin = (origin) => {
	if (!origin) {
		return true;
	}

	if (allowedOrigins.includes(origin)) {
		return true;
	}

	try {
		const parsedOrigin = new URL(origin);
		return (
			parsedOrigin.protocol === 'http:' &&
			DEV_CLIENT_PORTS.has(parsedOrigin.port) &&
			(parsedOrigin.hostname === 'localhost' ||
				parsedOrigin.hostname === '127.0.0.1' ||
				PRIVATE_IPV4_ORIGIN_PATTERN.test(parsedOrigin.hostname))
		);
	} catch {
		return false;
	}
};

const corsOrigin = (origin, callback) => {
	if (isAllowedOrigin(origin)) {
		callback(null, true);
		return;
	}

	callback(new Error(`Origin ${origin} is not allowed by CORS`));
};

const io = new Server(httpServer, {
	cors: {
		origin: corsOrigin,
		credentials: true,
	},
});

app.set('io', io);

// Middleware
// Matches the CSP set in client/nginx.conf for the web deployment - this
// copy is what actually governs the HTML page when the Electron desktop
// build spawns this server and has it serve the static client bundle
// directly (see the DESKTOP_CLIENT_DIST block below), since nginx isn't in
// that path at all. style-src allows 'unsafe-inline' for a handful of
// components that need dynamic inline styles (poll bar width, hover-card
// position) that can't be static Tailwind classes - script-src stays
// strict with no exceptions, since that's the directive that actually
// prevents XSS code execution.
app.use(
	helmet({
		// Static assets and the desktop bundle are served cross-origin from file://
		crossOriginResourcePolicy: { policy: 'cross-origin' },
		contentSecurityPolicy: {
			directives: {
				defaultSrc: ["'self'"],
				scriptSrc: ["'self'"],
				styleSrc: ["'self'", "'unsafe-inline'"],
				imgSrc: ["'self'", 'data:', 'blob:', 'https://*.giphy.com'],
				fontSrc: ["'self'"],
				connectSrc: ["'self'"],
				workerSrc: ["'self'"],
				frameSrc: ["'self'", 'blob:'],
				objectSrc: ["'none'"],
				baseUri: ["'self'"],
				formAction: ["'self'"],
				frameAncestors: ["'self'"],
			},
		},
	}),
);
app.use(
	cors({
		origin: corsOrigin,
		credentials: true,
	}),
);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const apiRateLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 300,
	standardHeaders: true,
	legacyHeaders: false,
});
app.use('/api', apiRateLimiter);

const authRateLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 20,
	standardHeaders: true,
	legacyHeaders: false,
	message: { message: 'Too many attempts, please try again later' },
});
app.use('/api/auth/login', authRateLimiter);
app.use('/api/auth/register', authRateLimiter);
app.use('/api/auth/forgot-password-request', authRateLimiter);
app.use('/api/auth/2fa/challenge', authRateLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/group-chats', groupChatRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/manager', managerRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/polls', pollRoutes);
app.use('/api/gifs', gifRoutes);
app.use('/api/invites', inviteRoutes);

const desktopClientDist = process.env.DESKTOP_CLIENT_DIST;
if (desktopClientDist && existsSync(desktopClientDist)) {
	const desktopIndexFile = path.join(desktopClientDist, 'index.html');

	app.use(express.static(desktopClientDist));
	app.get('*', (req, res, next) => {
		if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
			next();
			return;
		}

		res.sendFile(desktopIndexFile);
	});
}

// Error handling middleware (must be after all routes)
app.use(errorLoggingMiddleware);

// Socket.io connection handling
const onlineUsers = new Map();
const onlineSocketUsers = new Map();
const userPresence = new Map(); // userId -> 'online' | 'idle'

// WebRTC call sessions, keyed by callId.
// callId is `channel:<channelId>` for channel calls, `group:<groupChatId>` for
// group chat calls, or `dm:<sortedUserIdA>-<sortedUserIdB>` for DM calls.
// participants: Map<userId, { username, withVideo }>
const callSessions = new Map();

const buildDmCallId = (userIdA, userIdB) =>
	`dm:${[String(userIdA), String(userIdB)].sort().join('-')}`;

const resolveCallId = ({ chatType, chatId, currentUserId }) => {
	if (chatType === 'channel') return `channel:${chatId}`;
	if (chatType === 'group') return `group:${chatId}`;
	return buildDmCallId(currentUserId, chatId);
};

const getOrCreateCallSession = (callId, chatType, chatId) => {
	let session = callSessions.get(callId);
	if (!session) {
		session = { chatType, chatId: String(chatId), participants: new Map() };
		callSessions.set(callId, session);
	}
	return session;
};

const serializeParticipants = (session) =>
	Array.from(session.participants.entries()).map(([userId, info]) => ({
		userId,
		username: info.username,
		withVideo: info.withVideo,
	}));

const broadcastPresence = () => {
	io.emit(
		'presence-update',
		Object.fromEntries(
			Array.from(onlineUsers.keys()).map((userId) => [
				userId,
				userPresence.get(userId) || 'online',
			]),
		),
	);
};

const buildTypingPayload = ({ socket, channelId = null, groupChatId = null, chatId = null }) => {
	const user = findUserById(socket.user.id);

	return {
		chatId: chatId ? String(chatId) : null,
		channelId: channelId ? String(channelId) : null,
		groupChatId: groupChatId ? String(groupChatId) : null,
		userId: String(socket.user.id),
		username: socket.user.username,
		avatar: user?.avatar || null,
	};
};

const emitTypingIndicator = ({
	socket,
	eventName,
	channelId = null,
	recipientId = null,
	groupChatId = null,
}) => {
	if (channelId) {
		socket.to(`channel:${channelId}`).emit(
			eventName,
			buildTypingPayload({
				socket,
				channelId,
				chatId: channelId,
			}),
		);
		return;
	}

	if (groupChatId) {
		socket.to(`group:${groupChatId}`).emit(
			eventName,
			buildTypingPayload({
				socket,
				groupChatId,
				chatId: groupChatId,
			}),
		);
		return;
	}

	if (recipientId) {
		io.to(String(recipientId)).emit(
			eventName,
			buildTypingPayload({
				socket,
				chatId: socket.user.id,
			}),
		);
	}
};

const normalizeId = (value) =>
	value === null || value === undefined ? null : String(value);

const resolveChannelAccess = (channelId, userId) =>
	canAccessChannel(channelId, userId, getUserRole(userId));

const resolveGroupChatAccess = (groupChatId, userId) =>
	canAccessGroupChat(groupChatId, userId);

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
		replyContext: getReplyContextByMessageId(replyMessage.id),
	};
};

io.use(authenticateSocket);

io.on('connection', async (socket) => {
	console.log('User connected:', socket.user.id);

	onlineUsers.set(socket.user.id, socket.id);
	onlineSocketUsers.set(socket.id, {
		id: socket.user.id,
		username: socket.user.username,
	});
	userPresence.set(socket.user.id, 'online');
	io.emit('online-users', Array.from(onlineUsers.keys()));
	broadcastPresence();

	// Join user's personal room
	socket.join(String(socket.user.id));

	// Load and send available channels
	try {
		const { findVisibleChannelsForUser } = await import('./models/Channel.js');
		const userRole = getUserRole(socket.user.id);
		const channels = findVisibleChannelsForUser(socket.user.id, userRole);
		socket.emit('channels', channels);

		// Auto-join general channel if it exists
		const generalChannel = channels.find(
			(ch) => ch.name.toLowerCase() === 'general',
		);
		if (generalChannel) {
			socket.join(`channel:${generalChannel.id}`);
		}

		const groupChats = findGroupChatsForUser(socket.user.id);
		groupChats.forEach((groupChat) => {
			socket.join(`group:${groupChat.id}`);
		});
		socket.emit('group-chats', groupChats);
	} catch (error) {
		await logSocketError(error, {
			file: 'index.js',
			function: 'io.on(connection)',
			socketId: socket.id,
			userId: socket.user.id,
			eventName: 'initial-channel-load',
			operation: 'Loading visible channels for user on connection',
			additionalInfo: {
				username: socket.user.username,
				action: 'Finding visible channels and auto-joining general',
			},
		});
	}

	// Handle channel joining
	socket.on('join-channel', (channelId) => {
		const access = resolveChannelAccess(channelId, socket.user.id);
		if (!access.allowed) {
			socket.leave(`channel:${channelId}`);
			socket.emit('channel-access-removed', {
				channelId: String(channelId),
				message: access.reason,
			});
			return;
		}

		socket.join(`channel:${channelId}`);
		console.log(`User ${socket.user.id} joined channel ${channelId}`);
	});

	// Handle channel leaving
	socket.on('leave-channel', (channelId) => {
		socket.leave(`channel:${channelId}`);
		console.log(`User ${socket.user.id} left channel ${channelId}`);
	});

	// A member who lacks their wrapped channel key (e.g. they were offline when
	// it was distributed) asks any other online member to grant it, the same
	// way a brand-new joiner does.
	socket.on('request-channel-key', (channelId) => {
		const access = resolveChannelAccess(channelId, socket.user.id);
		if (!access.allowed) {
			return;
		}

		io.to(`channel:${channelId}`).emit('channel-key-needed', {
			channelId: String(channelId),
			userId: String(socket.user.id),
		});
	});

	socket.on('typing-start', async (data = {}) => {
		const { channelId = null, recipientId = null, groupChatId = null } = data;

		try {
			if (channelId) {
				const access = resolveChannelAccess(channelId, socket.user.id);
				if (!access.allowed) {
					return;
				}

				const permissionCheck = await canSendMessage(channelId, socket.user.id);
				if (!permissionCheck.allowed) {
					return;
				}
			}

			if (groupChatId) {
				const access = resolveGroupChatAccess(groupChatId, socket.user.id);
				if (!access.allowed) {
					return;
				}
			}

			if (recipientId && String(recipientId) === String(socket.user.id)) {
				return;
			}

			emitTypingIndicator({
				socket,
				eventName: 'typing-start',
				channelId,
				recipientId,
				groupChatId,
			});
		} catch (error) {
			await logSocketError(error, {
				file: 'index.js',
				function: 'socket.on(typing-start)',
				socketId: socket.id,
				userId: socket.user.id,
				eventName: 'typing-start',
				operation: 'Broadcasting typing indicator start',
				additionalInfo: {
					username: socket.user.username,
					channelId,
					recipientId,
					groupChatId,
				},
			});
		}
	});

	socket.on('typing-stop', async (data = {}) => {
		const { channelId = null, recipientId = null, groupChatId = null } = data;

		try {
			if (channelId) {
				const access = resolveChannelAccess(channelId, socket.user.id);
				if (!access.allowed) {
					return;
				}

				const permissionCheck = await canSendMessage(channelId, socket.user.id);
				if (!permissionCheck.allowed) {
					return;
				}
			}

			if (groupChatId) {
				const access = resolveGroupChatAccess(groupChatId, socket.user.id);
				if (!access.allowed) {
					return;
				}
			}

			if (recipientId && String(recipientId) === String(socket.user.id)) {
				return;
			}

			emitTypingIndicator({
				socket,
				eventName: 'typing-stop',
				channelId,
				recipientId,
				groupChatId,
			});
		} catch (error) {
			await logSocketError(error, {
				file: 'index.js',
				function: 'socket.on(typing-stop)',
				socketId: socket.id,
				userId: socket.user.id,
				eventName: 'typing-stop',
				operation: 'Broadcasting typing indicator stop',
				additionalInfo: {
					username: socket.user.username,
					channelId,
					recipientId,
					groupChatId,
				},
			});
		}
	});

	// Handle messages
	socket.on('message', async (data, callback) => {
		const {
			content,
			channelId,
			recipientId,
			groupChatId,
			replyToMessageId,
			cipherText,
			cipherIv,
			isEncrypted,
		} = data;

		try {
			// Check permissions for channel messages
			if (channelId) {
				const access = resolveChannelAccess(channelId, socket.user.id);
				if (!access.allowed) {
					socket.emit('message-error', {
						message: access.reason,
					});
					callback?.({ ok: false, message: access.reason });
					return;
				}

				const permissionCheck = await canSendMessage(channelId, socket.user.id);
				if (!permissionCheck.allowed) {
					socket.emit('message-error', {
						message: permissionCheck.reason,
					});
					callback?.({ ok: false, message: permissionCheck.reason });
					return;
				}

				// Every channel is E2EE - never trust the client's isEncrypted claim,
				// require real ciphertext to be present instead.
				if (!cipherText || !cipherIv) {
					const message =
						'This channel requires an encryption key - please reopen the channel and try again';
					socket.emit('message-error', { message });
					callback?.({ ok: false, message });
					return;
				}
			}

			if (groupChatId) {
				const access = resolveGroupChatAccess(groupChatId, socket.user.id);
				if (!access.allowed) {
					socket.emit('message-error', {
						message: access.reason,
					});
					callback?.({ ok: false, message: access.reason });
					return;
				}
			}

			const replyState = resolveReplyState({
				replyToMessageId,
				channelId,
				recipientId,
				groupChatId,
				currentUserId: socket.user.id,
			});

			if (replyState.error) {
				socket.emit('message-error', {
					message: replyState.error,
				});
				callback?.({ ok: false, message: replyState.error });
				return;
			}

			// Save message to database
			const { createMessage, syncMessageMentions, getConversationTtlSeconds, computeExpiresAt } =
				await import('./models/Message.js');
			// Channel messages are always encrypted (enforced above); for DMs and
			// group chats the client still controls this since both are already
			// always-encrypted by design on the client side.
			const resolvedIsEncrypted = channelId ? true : isEncrypted;
			const safeContent = resolvedIsEncrypted ? '' : String(content || '');

			// Stamp the key generation server-side - never trust the client's
			// claim, same posture as isEncrypted above. DMs aren't versioned.
			let messageKeyGeneration = null;
			if (channelId) {
				const { getCurrentChannelKeyGeneration } = await import('./models/Channel.js');
				messageKeyGeneration = getCurrentChannelKeyGeneration(channelId) || 1;
			} else if (groupChatId) {
				const { getCurrentGroupChatKeyGeneration } = await import('./models/GroupChat.js');
				messageKeyGeneration = getCurrentGroupChatKeyGeneration(groupChatId) || 1;
			}

			const ttlSeconds = getConversationTtlSeconds({
				channelId,
				recipientId,
				groupChatId,
				currentUserId: socket.user.id,
			});
			const messageExpiresAt = computeExpiresAt(ttlSeconds);
			const messageId = createMessage(
				safeContent,
				socket.user.id,
				channelId || null,
				recipientId || null,
				null,
				null,
				null,
				null,
				cipherText || null,
				cipherIv || null,
				resolvedIsEncrypted ? 1 : 0,
				replyState.replyToMessageId,
				replyState.threadRootMessageId,
				groupChatId || null,
				messageExpiresAt,
				null,
				messageKeyGeneration,
			);
			const mentions = syncMessageMentions(messageId, safeContent);

			// Get sender's avatar
			const { findUserById } = await import('./models/User.js');
			const sender = findUserById(socket.user.id);

			const message = {
				id: messageId.toString(),
				content: safeContent,
				senderId: socket.user.id,
				senderName: socket.user.username,
				senderAvatar: sender?.avatar || null,
				timestamp: new Date(),
				channelId,
				recipientId,
				groupChatId,
				expiresAt: messageExpiresAt,
				cipherText: cipherText || null,
				cipherIv: cipherIv || null,
				isEncrypted: resolvedIsEncrypted ? 1 : 0,
				keyGeneration: messageKeyGeneration,
				reactions: [],
				mentions,
				replyToMessageId: replyState.replyToMessageId,
				threadRootMessageId: replyState.threadRootMessageId,
				replyContext: replyState.replyContext,
			};

			const { sendPushToUser } = await import('./services/push.js');
			const replyRecipientUserId = replyState.replyContext?.senderId;

			if (groupChatId) {
				const { getGroupChatMembers } = await import('./models/GroupChat.js');
				io.to(`group:${groupChatId}`).emit('message', message);

				const members = getGroupChatMembers(groupChatId);
				await Promise.all(
					members
						.filter((member) => String(member.id) !== String(socket.user.id))
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
				// Send to channel
				io.to(`channel:${channelId}`).emit('message', message);
				console.log(`Message sent to channel ${channelId}:`, message);

				const { findChannelById, getChannelMembers } =
					await import('./models/Channel.js');
				const channel = findChannelById(channelId);
				const members = getChannelMembers(channelId);
				const payload = {
					title: 'GWS Connect',
					body: 'You have a new message',
					icon: '/gws-connect-favicon.svg',
					url: '/dashboard',
				};

				await Promise.all(
					members
						.filter((member) => String(member.id) !== String(socket.user.id))
						.map((member) => sendPushToUser(member.id, payload)),
				);

				// Send mention notifications
				if (mentions.length > 0) {
					const mentionedUserIds = [
						...new Set(mentions.map((mention) => mention.userId)),
					];
					createMentionNotifications(io, {
						actorId: socket.user.id,
						mentionedUserIds,
						messageId: messageId.toString(),
						channelId,
					});
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
				// Send to specific user (DM)
				io.to(recipientId).emit('message', message);
				socket.emit('message', message);
				console.log(`DM sent to user ${recipientId}:`, message);

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
				String(replyRecipientUserId) !== String(socket.user.id)
			) {
				createReplyNotification(io, {
					actorId: socket.user.id,
					replyRecipientUserId,
					messageId: messageId.toString(),
					sourceMessageId: replyState.replyToMessageId,
					channelId: channelId || null,
					directUserId: recipientId ? String(socket.user.id) : null,
				});
			}

			callback?.({ ok: true, message });
		} catch (error) {
			await logSocketError(error, {
				file: 'index.js',
				function: 'socket.on(message)',
				socketId: socket.id,
				userId: socket.user.id,
				channelId,
				eventName: 'message',
				operation: 'Processing and saving message',
				additionalInfo: {
					username: socket.user.username,
					isEncrypted,
					hasCipherText: Boolean(cipherText),
					messagePreview: content ? content.substring(0, 100) : 'empty',
					targetType: channelId ? 'channel' : groupChatId ? 'group-chat' : 'direct-message',
				},
			});
			socket.emit('error', { message: 'Failed to send message' });
			callback?.({ ok: false, message: 'Failed to send message' });
		}
	});

	// Handle GIF messages
	socket.on('gif-message', async (data, callback) => {
		const { gifUrl, title, channelId, recipientId, groupChatId, replyToMessageId } =
			data || {};

		try {
			if (!gifUrl) {
				callback?.({ ok: false, message: 'GIF URL required' });
				return;
			}

			if (channelId) {
				const access = resolveChannelAccess(channelId, socket.user.id);
				if (!access.allowed) {
					callback?.({ ok: false, message: access.reason });
					return;
				}

				const permissionCheck = await canSendMessage(channelId, socket.user.id);
				if (!permissionCheck.allowed) {
					callback?.({ ok: false, message: permissionCheck.reason });
					return;
				}
			}

			if (groupChatId) {
				const access = resolveGroupChatAccess(groupChatId, socket.user.id);
				if (!access.allowed) {
					callback?.({ ok: false, message: access.reason });
					return;
				}
			}

			const replyState = resolveReplyState({
				replyToMessageId,
				channelId,
				recipientId,
				groupChatId,
				currentUserId: socket.user.id,
			});

			if (replyState.error) {
				callback?.({ ok: false, message: replyState.error });
				return;
			}

			const { createMessage } = await import('./models/Message.js');
			const messageId = createMessage(
				'',
				socket.user.id,
				channelId || null,
				recipientId || null,
				gifUrl,
				title || 'GIF',
				'image/gif',
				null,
				null,
				null,
				0,
				replyState.replyToMessageId,
				replyState.threadRootMessageId,
				groupChatId || null,
			);

			const { findUserById } = await import('./models/User.js');
			const sender = findUserById(socket.user.id);
			const replyRecipientUserId = replyState.replyContext?.senderId;

			const message = {
				id: messageId.toString(),
				content: '',
				senderId: socket.user.id,
				senderName: socket.user.username,
				senderAvatar: sender?.avatar || null,
				timestamp: new Date(),
				channelId,
				recipientId,
				groupChatId,
				fileUrl: gifUrl,
				fileName: title || 'GIF',
				fileType: 'image/gif',
				reactions: [],
				replyToMessageId: replyState.replyToMessageId,
				threadRootMessageId: replyState.threadRootMessageId,
				replyContext: replyState.replyContext,
			};

			if (groupChatId) {
				io.to(`group:${groupChatId}`).emit('message', message);
			} else if (channelId) {
				io.to(`channel:${channelId}`).emit('message', message);
			} else if (recipientId) {
				io.to(recipientId).emit('message', message);
				socket.emit('message', message);
			}

			if (
				replyState.replyToMessageId &&
				replyRecipientUserId &&
				String(replyRecipientUserId) !== String(socket.user.id)
			) {
				createReplyNotification(io, {
					actorId: socket.user.id,
					replyRecipientUserId,
					messageId: messageId.toString(),
					sourceMessageId: replyState.replyToMessageId,
					channelId: channelId || null,
					directUserId: recipientId ? String(socket.user.id) : null,
				});
			}

			callback?.({ ok: true });
		} catch (error) {
			await logSocketError(error, {
				file: 'index.js',
				function: 'socket.on(gif-message)',
				socketId: socket.id,
				userId: socket.user.id,
				channelId,
				eventName: 'gif-message',
				operation: 'Processing and sending GIF message',
				additionalInfo: {
					username: socket.user.username,
					gifUrl: gifUrl ? 'provided' : 'missing',
					title: title || 'untitled',
					targetType: channelId ? 'channel' : groupChatId ? 'group-chat' : 'direct-message',
				},
			});
			callback?.({ ok: false, message: 'Failed to send GIF' });
		}
	});

	// Handle poll creation
	socket.on('poll-create', async (data, callback) => {
		const {
			question,
			options,
			channelId,
			recipientId,
			groupChatId,
			durationMinutes,
			replyToMessageId,
		} = data || {};

		try {
			if (!question || !Array.isArray(options) || options.length < 2) {
				callback?.({
					ok: false,
					message: 'Poll needs a question and two options',
				});
				return;
			}

			const trimmedOptions = options
				.map((option) => String(option).trim())
				.filter(Boolean);

			if (trimmedOptions.length < 2) {
				callback?.({ ok: false, message: 'Poll needs at least two options' });
				return;
			}

			if (channelId) {
				const access = resolveChannelAccess(channelId, socket.user.id);
				if (!access.allowed) {
					callback?.({ ok: false, message: access.reason });
					return;
				}

				const permissionCheck = await canSendMessage(channelId, socket.user.id);
				if (!permissionCheck.allowed) {
					callback?.({ ok: false, message: permissionCheck.reason });
					return;
				}
			}

			if (groupChatId) {
				const access = resolveGroupChatAccess(groupChatId, socket.user.id);
				if (!access.allowed) {
					callback?.({ ok: false, message: access.reason });
					return;
				}
			}

			const replyState = resolveReplyState({
				replyToMessageId,
				channelId,
				recipientId,
				groupChatId,
				currentUserId: socket.user.id,
			});

			if (replyState.error) {
				callback?.({ ok: false, message: replyState.error });
				return;
			}

			const duration = Number(durationMinutes);
			const expiresAt =
				Number.isFinite(duration) && duration > 0
					? new Date(Date.now() + duration * 60 * 1000).toISOString()
					: null;

			const { createMessage } = await import('./models/Message.js');
			const messageId = createMessage(
				question,
				socket.user.id,
				channelId || null,
				recipientId || null,
				null,
				null,
				null,
				null,
				null,
				null,
				0,
				replyState.replyToMessageId,
				replyState.threadRootMessageId,
				groupChatId || null,
			);

			const { createPoll, createPollOption, getPollSummary } =
				await import('./models/Poll.js');
			const pollId = createPoll(messageId, socket.user.id, question, expiresAt);
			trimmedOptions.forEach((option) => createPollOption(pollId, option));

			const pollSummary = getPollSummary(pollId, socket.user.id, false);
			const { findUserById } = await import('./models/User.js');
			const sender = findUserById(socket.user.id);
			const replyRecipientUserId = replyState.replyContext?.senderId;

			const message = {
				id: messageId.toString(),
				content: question,
				senderId: socket.user.id,
				senderName: socket.user.username,
				senderAvatar: sender?.avatar || null,
				timestamp: new Date(),
				channelId,
				recipientId,
				groupChatId,
				poll: pollSummary,
				reactions: [],
				replyToMessageId: replyState.replyToMessageId,
				threadRootMessageId: replyState.threadRootMessageId,
				replyContext: replyState.replyContext,
			};

			if (groupChatId) {
				io.to(`group:${groupChatId}`).emit('message', message);
			} else if (channelId) {
				io.to(`channel:${channelId}`).emit('message', message);
			} else if (recipientId) {
				io.to(recipientId).emit('message', message);
				socket.emit('message', message);
			}

			if (
				replyState.replyToMessageId &&
				replyRecipientUserId &&
				String(replyRecipientUserId) !== String(socket.user.id)
			) {
				createReplyNotification(io, {
					actorId: socket.user.id,
					replyRecipientUserId,
					messageId: messageId.toString(),
					sourceMessageId: replyState.replyToMessageId,
					channelId: channelId || null,
					directUserId: recipientId ? String(socket.user.id) : null,
				});
			}

			callback?.({ ok: true, messageId: messageId.toString() });
		} catch (error) {
			await logSocketError(error, {
				file: 'index.js',
				function: 'socket.on(poll-create)',
				socketId: socket.id,
				userId: socket.user.id,
				channelId,
				eventName: 'poll-create',
				operation: 'Creating poll and poll options',
				additionalInfo: {
					username: socket.user.username,
					questionPreview: question ? question.substring(0, 100) : 'empty',
					optionCount: options?.length || 0,
					durationMinutes: Number(durationMinutes),
					targetType: channelId ? 'channel' : groupChatId ? 'group-chat' : 'direct-message',
				},
			});
			callback?.({ ok: false, message: 'Failed to create poll' });
		}
	});

	// Handle poll voting
	socket.on('poll-vote', async (data, callback) => {
		const { pollId, optionId } = data || {};

		try {
			const { getPollById, getPollSummary, upsertPollVote, getPollOptions } =
				await import('./models/Poll.js');
			const { getMessageById } = await import('./models/Message.js');
			const poll = getPollById(pollId);
			if (!poll) {
				callback?.({ ok: false, message: 'Poll not found' });
				return;
			}

			const messageContext = getMessageById(poll.messageId);
			if (messageContext?.channelId) {
				const access = resolveChannelAccess(
					messageContext.channelId,
					socket.user.id,
				);
				if (!access.channel) {
					callback?.({ ok: false, message: 'Channel not found' });
					return;
				}
				if (!access.allowed) {
					callback?.({ ok: false, message: access.reason });
					return;
				}
			} else if (messageContext?.groupChatId) {
				const access = resolveGroupChatAccess(messageContext.groupChatId, socket.user.id);
				if (!access.allowed) {
					callback?.({ ok: false, message: access.reason });
					return;
				}
			}

			if (poll.expiresAt && Date.now() > new Date(poll.expiresAt).getTime()) {
				callback?.({ ok: false, message: 'Poll has ended' });
				return;
			}

			const options = getPollOptions(pollId);
			const hasOption = options.some(
				(option) => String(option.id) === String(optionId),
			);
			if (!hasOption) {
				callback?.({ ok: false, message: 'Invalid poll option' });
				return;
			}

			upsertPollVote(pollId, optionId, socket.user.id);

			const pollSummary = getPollSummary(pollId, socket.user.id, false);

			if (messageContext?.channelId) {
				io.to(`channel:${messageContext.channelId}`).emit('poll-update', {
					pollId: pollId.toString(),
					options: pollSummary?.options || [],
					expiresAt: poll.expiresAt,
				});
			} else if (messageContext?.groupChatId) {
				io.to(`group:${messageContext.groupChatId}`).emit('poll-update', {
					pollId: pollId.toString(),
					options: pollSummary?.options || [],
					expiresAt: poll.expiresAt,
				});
			} else if (messageContext?.recipientId) {
				io.to(String(messageContext.recipientId)).emit('poll-update', {
					pollId: pollId.toString(),
					options: pollSummary?.options || [],
					expiresAt: poll.expiresAt,
				});
				io.to(String(messageContext.senderId)).emit('poll-update', {
					pollId: pollId.toString(),
					options: pollSummary?.options || [],
					expiresAt: poll.expiresAt,
				});
			}

			callback?.({ ok: true });
		} catch (error) {
			await logSocketError(error, {
				file: 'index.js',
				function: 'socket.on(poll-vote)',
				socketId: socket.id,
				userId: socket.user.id,
				eventName: 'poll-vote',
				operation: 'Recording poll vote and broadcasting update',
				additionalInfo: {
					username: socket.user.username,
					pollId,
					optionId,
				},
			});
			callback?.({ ok: false, message: 'Failed to vote' });
		}
	});

	// Handle message edits
	socket.on('message-edit', async (data, callback) => {
		const { messageId, content } = data || {};

		try {
			const trimmed = String(content || '').trim();
			if (!messageId || !trimmed) {
				callback?.({ ok: false, message: 'Message content required' });
				return;
			}

			const { getMessageById, syncMessageMentions, updateMessageContent } =
				await import('./models/Message.js');
			const message = getMessageById(messageId);
			if (!message) {
				callback?.({ ok: false, message: 'Message not found' });
				return;
			}

			if (String(message.senderId) !== String(socket.user.id)) {
				callback?.({ ok: false, message: 'Not allowed' });
				return;
			}

			if (message.channelId) {
				const access = resolveChannelAccess(message.channelId, socket.user.id);
				if (!access.allowed) {
					callback?.({ ok: false, message: access.reason });
					return;
				}
			}

			if (message.isDeleted || message.isArchived || message.isEncrypted) {
				callback?.({ ok: false, message: 'Message cannot be edited' });
				return;
			}

			updateMessageContent(messageId, trimmed);
			const mentions = syncMessageMentions(messageId, trimmed);

			const updated = {
				id: messageId.toString(),
				content: trimmed,
				editedAt: new Date().toISOString(),
				mentions,
			};

			if (message.groupChatId) {
				io.to(`group:${message.groupChatId}`).emit('message-updated', updated);
			} else if (message.channelId) {
				io.to(`channel:${message.channelId}`).emit('message-updated', updated);
			} else if (message.recipientId) {
				io.to(String(message.recipientId)).emit('message-updated', updated);
				io.to(String(message.senderId)).emit('message-updated', updated);
			}

			callback?.({ ok: true, message: updated });
		} catch (error) {
			await logSocketError(error, {
				file: 'index.js',
				function: 'socket.on(message-edit)',
				socketId: socket.id,
				userId: socket.user.id,
				eventName: 'message-edit',
				operation: 'Updating message content and broadcasting change',
				additionalInfo: {
					username: socket.user.username,
					messageId,
				},
			});
			callback?.({ ok: false, message: 'Failed to edit message' });
		}
	});

	// Handle message deletes
	socket.on('message-delete', async (data, callback) => {
		const { messageId } = data || {};

		try {
			const { getMessageById, markMessageDeleted } =
				await import('./models/Message.js');
			const message = getMessageById(messageId);
			if (!message) {
				callback?.({ ok: false, message: 'Message not found' });
				return;
			}

			if (String(message.senderId) !== String(socket.user.id)) {
				callback?.({ ok: false, message: 'Not allowed' });
				return;
			}

			if (message.channelId) {
				const access = resolveChannelAccess(message.channelId, socket.user.id);
				if (!access.allowed) {
					callback?.({ ok: false, message: access.reason });
					return;
				}
			}

			if (message.isDeleted || message.isArchived) {
				callback?.({ ok: false, message: 'Message already removed' });
				return;
			}

			markMessageDeleted(messageId);
			const updated = {
				id: messageId.toString(),
				content: '',
				isDeleted: 1,
				deletedAt: new Date().toISOString(),
				fileUrl: null,
				fileName: null,
				fileType: null,
			};

			if (message.groupChatId) {
				io.to(`group:${message.groupChatId}`).emit('message-updated', updated);
			} else if (message.channelId) {
				io.to(`channel:${message.channelId}`).emit('message-updated', updated);
			} else if (message.recipientId) {
				io.to(String(message.recipientId)).emit('message-updated', updated);
				io.to(String(message.senderId)).emit('message-updated', updated);
			}

			callback?.({ ok: true });
		} catch (error) {
			await logSocketError(error, {
				file: 'index.js',
				function: 'socket.on(message-delete)',
				socketId: socket.id,
				userId: socket.user.id,
				eventName: 'message-delete',
				operation: 'Marking message as deleted and broadcasting update',
				additionalInfo: {
					username: socket.user.username,
					messageId,
				},
			});
			callback?.({ ok: false, message: 'Failed to delete message' });
		}
	});

	// Handle message archive
	socket.on('message-archive', async (data, callback) => {
		const { messageId } = data || {};

		try {
			const { getMessageById, markMessageArchived } =
				await import('./models/Message.js');
			const message = getMessageById(messageId);
			if (!message) {
				callback?.({ ok: false, message: 'Message not found' });
				return;
			}

			if (String(message.senderId) !== String(socket.user.id)) {
				callback?.({ ok: false, message: 'Not allowed' });
				return;
			}

			if (message.channelId) {
				const access = resolveChannelAccess(message.channelId, socket.user.id);
				if (!access.allowed) {
					callback?.({ ok: false, message: access.reason });
					return;
				}
			}

			if (message.isArchived) {
				callback?.({ ok: false, message: 'Message already archived' });
				return;
			}

			markMessageArchived(messageId);

			if (message.groupChatId) {
				io.to(`group:${message.groupChatId}`).emit('message-archived', {
					messageId: messageId.toString(),
				});
			} else if (message.channelId) {
				io.to(`channel:${message.channelId}`).emit('message-archived', {
					messageId: messageId.toString(),
				});
			} else if (message.recipientId) {
				io.to(String(message.recipientId)).emit('message-archived', {
					messageId: messageId.toString(),
				});
				io.to(String(message.senderId)).emit('message-archived', {
					messageId: messageId.toString(),
				});
			}

			callback?.({ ok: true });
		} catch (error) {
			await logSocketError(error, {
				file: 'index.js',
				function: 'socket.on(message-archive)',
				socketId: socket.id,
				userId: socket.user.id,
				eventName: 'message-archive',
				operation: 'Archiving message and broadcasting update',
				additionalInfo: {
					username: socket.user.username,
					messageId,
				},
			});
			callback?.({ ok: false, message: 'Failed to archive message' });
		}
	});

	// Handle pin/unpin
	socket.on('message-pin-toggle', async (data, callback) => {
		const { messageId } = data || {};

		try {
			const { getMessageById, togglePinMessage } = await import('./models/Message.js');
			const message = getMessageById(messageId);
			if (!message) {
				callback?.({ ok: false, message: 'Message not found' });
				return;
			}

			if (message.channelId) {
				const access = resolveChannelAccess(message.channelId, socket.user.id);
				if (!access.allowed) {
					callback?.({ ok: false, message: access.reason });
					return;
				}
			} else if (message.groupChatId) {
				const access = resolveGroupChatAccess(message.groupChatId, socket.user.id);
				if (!access.allowed) {
					callback?.({ ok: false, message: access.reason });
					return;
				}
			} else if (message.recipientId) {
				if (
					String(message.recipientId) !== String(socket.user.id) &&
					String(message.senderId) !== String(socket.user.id)
				) {
					callback?.({ ok: false, message: 'Access denied' });
					return;
				}
			}

			const result = togglePinMessage(messageId, socket.user.id);
			if (!result) {
				callback?.({ ok: false, message: 'Message not found' });
				return;
			}

			const update = {
				messageId: messageId.toString(),
				isPinned: result.isPinned,
				pinnedAt: result.pinnedAt,
			};

			if (message.groupChatId) {
				io.to(`group:${message.groupChatId}`).emit('message-pin-update', update);
			} else if (message.channelId) {
				io.to(`channel:${message.channelId}`).emit('message-pin-update', update);
			} else if (message.recipientId) {
				io.to(String(message.recipientId)).emit('message-pin-update', update);
				io.to(String(message.senderId)).emit('message-pin-update', update);
			}

			callback?.({ ok: true, ...update });
		} catch (error) {
			await logSocketError(error, {
				file: 'index.js',
				function: 'socket.on(message-pin-toggle)',
				socketId: socket.id,
				userId: socket.user.id,
				eventName: 'message-pin-toggle',
				operation: 'Toggling pinned state and broadcasting update',
				additionalInfo: { username: socket.user.username, messageId },
			});
			callback?.({ ok: false, message: 'Failed to update pin' });
		}
	});

	// Handle message reactions
	socket.on('reaction-toggle', async (data, callback) => {
		const { messageId, reaction } = data || {};

		try {
			const {
				isValidReaction,
				toggleReaction,
				getMessageReactions,
				hasReaction,
			} = await import('./models/Reaction.js');
			const { getMessageById } = await import('./models/Message.js');

			if (!messageId || !reaction || !isValidReaction(reaction)) {
				callback?.({ ok: false, message: 'Invalid reaction' });
				return;
			}

			const message = getMessageById(messageId);
			if (!message) {
				callback?.({ ok: false, message: 'Message not found' });
				return;
			}

			if (message.channelId) {
				const access = resolveChannelAccess(message.channelId, socket.user.id);
				if (!access.channel) {
					callback?.({ ok: false, message: 'Channel not found' });
					return;
				}
				if (!access.allowed) {
					callback?.({ ok: false, message: access.reason });
					return;
				}
			} else if (message.groupChatId) {
				const access = resolveGroupChatAccess(message.groupChatId, socket.user.id);
				if (!access.allowed) {
					callback?.({ ok: false, message: access.reason });
					return;
				}
			} else if (message.recipientId) {
				if (
					String(message.recipientId) !== String(socket.user.id) &&
					String(message.senderId) !== String(socket.user.id)
				) {
					callback?.({ ok: false, message: 'Access denied' });
					return;
				}
			}

			const hadReaction = hasReaction(messageId, socket.user.id, reaction);
			toggleReaction(messageId, socket.user.id, reaction);
			const reactionsForActor = getMessageReactions(
				messageId,
				socket.user.id,
				true,
			);
			const reactionsForBroadcast = getMessageReactions(messageId, null, false);

			if (message.channelId) {
				io.to(`channel:${message.channelId}`).emit('reaction-update', {
					messageId: messageId.toString(),
					reactions: reactionsForBroadcast,
				});

				if (
					!hadReaction &&
					String(message.senderId) !== String(socket.user.id)
				) {
					createReactionNotification(io, {
						actorId: socket.user.id,
						notificationUserId: String(message.senderId),
						messageId: messageId.toString(),
						sourceMessageId: messageId.toString(),
						channelId: String(message.channelId),
						reaction,
					});
				}
			} else if (message.groupChatId) {
				io.to(`group:${message.groupChatId}`).emit('reaction-update', {
					messageId: messageId.toString(),
					reactions: reactionsForBroadcast,
				});
			} else if (message.recipientId) {
				io.to(String(message.recipientId)).emit('reaction-update', {
					messageId: messageId.toString(),
					reactions: reactionsForBroadcast,
				});
				io.to(String(message.senderId)).emit('reaction-update', {
					messageId: messageId.toString(),
					reactions: reactionsForBroadcast,
				});
			}

			callback?.({ ok: true, reactions: reactionsForActor });
		} catch (error) {
			await logSocketError(error, {
				file: 'index.js',
				function: 'socket.on(reaction-toggle)',
				socketId: socket.id,
				userId: socket.user.id,
				eventName: 'reaction-toggle',
				operation: 'Toggling message reaction and broadcasting update',
				additionalInfo: {
					username: socket.user.username,
					messageId,
					reaction,
				},
			});
			callback?.({ ok: false, message: 'Failed to update reaction' });
		}
	});

	// Handle file messages
	socket.on('file-message', async (data) => {
		// File handling logic here
		console.log('File message received:', data);
	});

	// Handle WebRTC call signaling
	socket.on('call:join', async (data, callback) => {
		const { chatType, chatId, withVideo = false } = data || {};

		try {
			if (chatType !== 'channel' && chatType !== 'dm' && chatType !== 'group') {
				callback?.({ ok: false, message: 'Invalid chat type' });
				return;
			}

			if (chatType === 'channel') {
				const access = resolveChannelAccess(chatId, socket.user.id);
				if (!access.allowed) {
					callback?.({ ok: false, message: access.reason });
					return;
				}
			}

			if (chatType === 'group') {
				const access = resolveGroupChatAccess(chatId, socket.user.id);
				if (!access.allowed) {
					callback?.({ ok: false, message: access.reason });
					return;
				}
			}

			const callId = resolveCallId({ chatType, chatId, currentUserId: socket.user.id });
			const isNewSession = !callSessions.has(callId);
			const session = getOrCreateCallSession(callId, chatType, chatId);

			const existingParticipants = serializeParticipants(session);

			session.participants.set(String(socket.user.id), {
				username: socket.user.username,
				withVideo: Boolean(withVideo),
			});
			socket.join(`call:${callId}`);

			socket.to(`call:${callId}`).emit('call:peer-joined', {
				callId,
				userId: String(socket.user.id),
				username: socket.user.username,
				withVideo: Boolean(withVideo),
			});

			if (chatType === 'dm' && isNewSession) {
				io.to(String(chatId)).emit('call:incoming', {
					callId,
					chatType,
					chatId: String(socket.user.id),
					fromUserId: String(socket.user.id),
					fromUsername: socket.user.username,
					withVideo: Boolean(withVideo),
				});
			}

			callback?.({ ok: true, callId, participants: existingParticipants });
		} catch (error) {
			await logSocketError(error, {
				file: 'index.js',
				function: 'socket.on(call:join)',
				socketId: socket.id,
				userId: socket.user.id,
				eventName: 'call:join',
				operation: 'Joining a call session',
				additionalInfo: { username: socket.user.username, chatType, chatId },
			});
			callback?.({ ok: false, message: 'Failed to join call' });
		}
	});

	socket.on('call:signal', (data) => {
		const { callId, toUserId, signal } = data || {};
		if (!callId || !toUserId || !signal) return;

		io.to(String(toUserId)).emit('call:signal', {
			callId,
			fromUserId: String(socket.user.id),
			signal,
		});
	});

	socket.on('call:leave', (data) => {
		const { callId } = data || {};
		const session = callSessions.get(callId);
		if (!session) return;

		session.participants.delete(String(socket.user.id));
		socket.leave(`call:${callId}`);
		socket.to(`call:${callId}`).emit('call:peer-left', {
			callId,
			userId: String(socket.user.id),
		});

		if (session.participants.size === 0) {
			callSessions.delete(callId);
		}
	});

	socket.on('call:decline', (data) => {
		const { callId, toUserId } = data || {};
		if (!callId || !toUserId) return;

		io.to(String(toUserId)).emit('call:declined', {
			callId,
			userId: String(socket.user.id),
		});
		callSessions.delete(callId);
	});

	// Handle presence updates (idle/online) from client activity tracking
	socket.on('presence-set', (status) => {
		if (status !== 'online' && status !== 'idle') {
			return;
		}
		userPresence.set(socket.user.id, status);
		broadcastPresence();
	});

	// Handle disconnection
	socket.on('disconnect', () => {
		console.log('User disconnected:', socket.user.id);
		onlineUsers.delete(socket.user.id);
		onlineSocketUsers.delete(socket.id);
		userPresence.delete(socket.user.id);
		io.emit('online-users', Array.from(onlineUsers.keys()));
		broadcastPresence();

		for (const [callId, session] of callSessions.entries()) {
			if (!session.participants.has(String(socket.user.id))) continue;

			session.participants.delete(String(socket.user.id));
			io.to(`call:${callId}`).emit('call:peer-left', {
				callId,
				userId: String(socket.user.id),
			});

			if (session.participants.size === 0) {
				callSessions.delete(callId);
			}
		}
	});
});

const DISAPPEARING_MESSAGE_SWEEP_INTERVAL_MS = 30 * 1000;

const sweepExpiredMessages = async () => {
	try {
		const { getExpiredMessages, expireMessages } = await import('./models/Message.js');
		const expired = getExpiredMessages();
		if (expired.length === 0) {
			return;
		}

		expireMessages(expired.map((message) => message.id));

		for (const message of expired) {
			const updated = {
				id: message.id.toString(),
				content: '',
				isDeleted: 1,
				deletedAt: new Date().toISOString(),
				fileUrl: null,
				fileName: null,
				fileType: null,
			};

			if (message.groupChatId) {
				io.to(`group:${message.groupChatId}`).emit('message-updated', updated);
			} else if (message.channelId) {
				io.to(`channel:${message.channelId}`).emit('message-updated', updated);
			} else if (message.recipientId) {
				io.to(String(message.recipientId)).emit('message-updated', updated);
				io.to(String(message.senderId)).emit('message-updated', updated);
			}
		}
	} catch (error) {
		await logSocketError(error, {
			file: 'index.js',
			function: 'sweepExpiredMessages',
			operation: 'Expiring disappearing messages and broadcasting updates',
		});
	}
};

setInterval(() => void sweepExpiredMessages(), DISAPPEARING_MESSAGE_SWEEP_INTERVAL_MS);

process.on('unhandledRejection', (error) => {
	const logMessage = async () => {
		await logSocketError(error, {
			file: 'index.js',
			function: 'process.on(unhandledRejection)',
			operation: 'Handling unhandled promise rejection at process level',
			additionalInfo: {
				eventType: 'unhandledRejection',
				processPid: process.pid,
				nodeVersion: process.version,
			},
		});
	};
	void logMessage();
});

process.on('uncaughtException', (error) => {
	const logMessage = async () => {
		await logSocketError(error, {
			file: 'index.js',
			function: 'process.on(uncaughtException)',
			operation: 'Handling uncaught exception at process level',
			additionalInfo: {
				eventType: 'uncaughtException',
				processPid: process.pid,
				nodeVersion: process.version,
			},
		});
	};
	void logMessage();
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
});
