import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { canSendMessage, getUserRole, requireWorkspaceRole } from '../middleware/roles.js';
import { canAccessChannel, getChannelMembers } from '../models/Channel.js';
import {
	computeExpiresAt,
	createMessage,
	getConversationTtlSeconds,
	syncMessageMentions,
} from '../models/Message.js';
import {
	createCommand,
	deleteCommand,
	findCommandForWorkspace,
	listCommandsForWorkspace,
} from '../models/CustomCommand.js';
import { isWorkspaceMember } from '../models/Workspace.js';
import { createMentionNotifications } from '../services/inAppNotifications.js';
import { sendPushToUser } from '../services/push.js';
import { logAuditEvent } from '../services/auditLog.js';

const router = express.Router();

const COMMAND_PATTERN = /^[a-z0-9-]{1,32}$/;
const EXECUTE_TIMEOUT_MS = 5000;
const MAX_RESPONSE_TEXT_LENGTH = 4000;
// Built-in commands the client already intercepts before ever checking the
// registered-command list (client/src/components/MessageInput.tsx) - a
// custom command with one of these names would be unreachable.
const RESERVED_COMMAND_NAMES = new Set(['poll', 'gif', 'schedule', 'shrug', 'me']);

const normalizeCommandName = (value) =>
	String(value || '')
		.trim()
		.replace(/^\//, '')
		.toLowerCase();

// List commands registered for a workspace - any member can see the list
// (they need it to know what's available), but not the secret.
router.get('/', authenticateToken, (req, res) => {
	try {
		const workspaceId = req.query.workspaceId;
		if (!workspaceId || !isWorkspaceMember(workspaceId, req.user.id)) {
			return res.status(403).json({ message: 'Not a member of this workspace' });
		}

		res.json(listCommandsForWorkspace(workspaceId));
	} catch (error) {
		console.error('List custom commands error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

router.post(
	'/',
	authenticateToken,
	requireWorkspaceRole('admin'),
	(req, res) => {
		try {
			const command = normalizeCommandName(req.body?.command);
			const targetUrl = String(req.body?.targetUrl || '').trim();

			if (!COMMAND_PATTERN.test(command)) {
				return res.status(400).json({
					message: 'Command must be 1-32 lowercase letters, numbers, or hyphens',
				});
			}

			if (RESERVED_COMMAND_NAMES.has(command)) {
				return res.status(400).json({
					message: `/${command} is a built-in command and can't be overridden`,
				});
			}

			if (!/^https?:\/\//i.test(targetUrl)) {
				return res.status(400).json({ message: 'targetUrl must be a valid http(s) URL' });
			}

			if (findCommandForWorkspace(req.body.workspaceId, command)) {
				return res.status(409).json({ message: 'That command is already registered' });
			}

			const created = createCommand(
				req.body.workspaceId,
				command,
				targetUrl,
				req.user.id,
			);

			logAuditEvent({
				actorId: req.user.id,
				action: 'custom-command.create',
				targetType: 'custom_command',
				targetId: created.id,
				metadata: { workspaceId: String(req.body.workspaceId), command },
			});

			res.status(201).json(created);
		} catch (error) {
			console.error('Create custom command error:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

router.delete(
	'/:commandId',
	authenticateToken,
	requireWorkspaceRole('admin'),
	(req, res) => {
		try {
			const result = deleteCommand(req.params.commandId, req.body.workspaceId);
			if (result.changes === 0) {
				return res.status(404).json({ message: 'Command not found' });
			}

			logAuditEvent({
				actorId: req.user.id,
				action: 'custom-command.delete',
				targetType: 'custom_command',
				targetId: req.params.commandId,
				metadata: { workspaceId: String(req.body.workspaceId) },
			});

			res.json({ ok: true });
		} catch (error) {
			console.error('Delete custom command error:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

router.post('/execute', authenticateToken, async (req, res) => {
	try {
		const { channelId, workspaceId } = req.body;
		const command = normalizeCommandName(req.body?.command);
		const args = String(req.body?.args || '').slice(0, 2000);

		if (!channelId || !workspaceId || !command) {
			return res
				.status(400)
				.json({ message: 'channelId, workspaceId, and command are required' });
		}

		const access = canAccessChannel(
			channelId,
			req.user.id,
			getUserRole(req.user.id),
			workspaceId,
		);
		if (!access.channel) {
			return res.status(404).json({ message: 'Channel not found' });
		}
		if (!access.allowed) {
			return res.status(403).json({ message: access.reason });
		}

		const sendCheck = canSendMessage(channelId, req.user.id);
		if (!sendCheck.allowed) {
			return res.status(403).json({ message: sendCheck.reason });
		}

		const registeredCommand = findCommandForWorkspace(workspaceId, command);
		if (!registeredCommand) {
			return res.status(404).json({ message: `/${command} is not a registered command` });
		}

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), EXECUTE_TIMEOUT_MS);

		let targetResponse;
		try {
			targetResponse = await fetch(registeredCommand.targetUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-gws-command-token': registeredCommand.secret,
				},
				body: JSON.stringify({
					command,
					text: args,
					userId: String(req.user.id),
					username: req.user.username,
					channelId: String(channelId),
				}),
				signal: controller.signal,
			});
		} catch (error) {
			const timedOut = error?.name === 'AbortError';
			return res.status(502).json({
				message: timedOut
					? `/${command} timed out waiting for a response`
					: `/${command} target is unreachable`,
			});
		} finally {
			clearTimeout(timeout);
		}

		if (!targetResponse.ok) {
			return res
				.status(502)
				.json({ message: `/${command} returned an error (${targetResponse.status})` });
		}

		let responseBody;
		try {
			responseBody = await targetResponse.json();
		} catch {
			return res.status(502).json({ message: `/${command} returned an invalid response` });
		}

		const replyText = String(responseBody?.text || '')
			.trim()
			.slice(0, MAX_RESPONSE_TEXT_LENGTH);
		if (!replyText) {
			return res.status(502).json({ message: `/${command} returned an empty response` });
		}

		const senderName = String(responseBody?.senderName || `/${command}`).slice(0, 60);
		const senderAvatar = responseBody?.senderAvatar
			? String(responseBody.senderAvatar).slice(0, 500)
			: null;

		const messageExpiresAt = computeExpiresAt(getConversationTtlSeconds({ channelId }));
		const messageId = createMessage(
			replyText,
			req.user.id,
			channelId,
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
			senderName,
			senderAvatar,
		);
		const mentions = syncMessageMentions(messageId, replyText);
		const message = {
			id: String(messageId),
			content: replyText,
			senderId: String(req.user.id),
			senderName,
			senderAvatar,
			channelId: String(channelId),
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
		io.to(`channel:${channelId}`).emit('message', message);

		await Promise.all(
			getChannelMembers(channelId)
				.filter((member) => String(member.id) !== String(req.user.id))
				.map((member) =>
					sendPushToUser(
						member.id,
						{
							title: senderName,
							body: replyText.length > 120 ? `${replyText.slice(0, 117)}...` : replyText,
							icon: senderAvatar || '/gws-connect-favicon.svg',
							url: '/dashboard',
						},
						{ targetType: 'channel', targetId: String(channelId) },
					),
				),
		);

		if (mentions.length > 0) {
			createMentionNotifications(io, {
				actorId: req.user.id,
				messageId: String(messageId),
				channelId: String(channelId),
				mentions,
			});
		}

		res.json({ ok: true, messageId: String(messageId) });
	} catch (error) {
		console.error('Execute custom command error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

export default router;
