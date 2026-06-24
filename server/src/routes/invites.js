import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import db from '../database.js';
import { getUserRole } from '../middleware/roles.js';
import {
	createInviteLink,
	findInviteByCode,
	getInviteLinksForTarget,
	getInviteStatus,
	incrementInviteUse,
	revokeInviteLink,
} from '../models/Invite.js';
import {
	addChannelMember,
	canAccessChannel,
	findChannelById,
	findVisibleChannelsForUser,
	isChannelMember,
} from '../models/Channel.js';
import {
	addGroupChatMember,
	canAccessGroupChat,
	findGroupChatById,
	getGroupChatMembers,
	isGroupChatMember,
} from '../models/GroupChat.js';

const router = express.Router();

const requireMembership = (targetType, targetId, userId) => {
	if (targetType === 'channel') {
		const access = canAccessChannel(targetId, userId, getUserRole(userId));
		if (!access.channel) {
			return { ok: false, status: 404, message: 'Channel not found' };
		}
		if (!isChannelMember(targetId, userId) && getUserRole(userId) !== 'admin') {
			return { ok: false, status: 403, message: 'You must be a member to create an invite' };
		}
		return { ok: true, target: access.channel };
	}

	const access = canAccessGroupChat(targetId, userId);
	if (!access.groupChat) {
		return { ok: false, status: 404, message: 'Group chat not found' };
	}
	if (!access.allowed) {
		return { ok: false, status: 403, message: access.reason };
	}
	return { ok: true, target: access.groupChat };
};

// Create an invite link for a channel or group chat
router.post('/', authenticateToken, async (req, res) => {
	try {
		const { targetType, targetId, maxUses, expiresInHours } = req.body;

		if (targetType !== 'channel' && targetType !== 'group') {
			return res.status(400).json({ message: 'targetType must be "channel" or "group"' });
		}

		const membership = requireMembership(targetType, targetId, req.user.id);
		if (!membership.ok) {
			return res.status(membership.status).json({ message: membership.message });
		}

		const invite = createInviteLink(targetType, targetId, req.user.id, {
			maxUses: maxUses ? Number(maxUses) : null,
			expiresInHours: expiresInHours ? Number(expiresInHours) : null,
		});

		res.status(201).json(invite);
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

// List active invites for a channel/group (so members can manage them)
router.get('/target/:targetType/:targetId', authenticateToken, async (req, res) => {
	try {
		const { targetType, targetId } = req.params;
		const membership = requireMembership(targetType, targetId, req.user.id);
		if (!membership.ok) {
			return res.status(membership.status).json({ message: membership.message });
		}

		res.json(getInviteLinksForTarget(targetType, targetId));
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Preview an invite without redeeming it
router.get('/:code', authenticateToken, async (req, res) => {
	try {
		const invite = findInviteByCode(req.params.code);
		const status = getInviteStatus(invite);
		if (!status.valid) {
			return res.status(410).json({ message: status.reason });
		}

		const target =
			invite.targetType === 'channel'
				? findChannelById(invite.targetId)
				: findGroupChatById(invite.targetId);

		if (!target) {
			return res.status(404).json({ message: 'Invite target no longer exists' });
		}

		res.json({
			targetType: invite.targetType,
			targetId: String(invite.targetId),
			name: target.name,
		});
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Redeem an invite: joins the current user to the channel/group
router.post('/:code/redeem', authenticateToken, async (req, res) => {
	try {
		const invite = findInviteByCode(req.params.code);
		const status = getInviteStatus(invite);
		if (!status.valid) {
			return res.status(410).json({ message: status.reason });
		}

		const io = req.app.get('io');

		if (invite.targetType === 'channel') {
			const channel = findChannelById(invite.targetId);
			if (!channel) {
				return res.status(404).json({ message: 'Channel no longer exists' });
			}

			addChannelMember(invite.targetId, req.user.id);
			incrementInviteUse(invite.id);

			io.in(String(req.user.id)).socketsJoin(`channel:${invite.targetId}`);
			io.to(String(req.user.id)).emit(
				'channels',
				findVisibleChannelsForUser(req.user.id, getUserRole(req.user.id)),
			);

			if (channel.isPrivate) {
				io.to(`channel:${invite.targetId}`).emit('channel-key-needed', {
					channelId: String(invite.targetId),
					userId: String(req.user.id),
				});
			}

			return res.json({ targetType: 'channel', targetId: String(invite.targetId) });
		}

		const groupChat = findGroupChatById(invite.targetId);
		if (!groupChat) {
			return res.status(404).json({ message: 'Group chat no longer exists' });
		}

		if (isGroupChatMember(invite.targetId, req.user.id)) {
			return res.json({ targetType: 'group', targetId: String(invite.targetId) });
		}

		addGroupChatMember(invite.targetId, req.user.id);
		incrementInviteUse(invite.id);

		const members = getGroupChatMembers(invite.targetId);

		io.in(String(req.user.id)).socketsJoin(`group:${invite.targetId}`);
		io.to(String(req.user.id)).emit('group-chat-created', {
			...groupChat,
			members,
			unreadCount: 0,
			lastMessageAt: null,
		});

		// The new member has no wrapped encryption key yet. Ask any other
		// online member to wrap and upload the group key for them.
		io.to(`group:${invite.targetId}`).emit('group-chat-key-needed', {
			groupChatId: String(invite.targetId),
			userId: String(req.user.id),
		});

		res.json({ targetType: 'group', targetId: String(invite.targetId) });
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Revoke an invite link
router.delete('/:inviteId', authenticateToken, async (req, res) => {
	try {
		const invite = db.prepare('SELECT * FROM invite_links WHERE id = ?').get(req.params.inviteId);
		if (!invite) {
			return res.status(404).json({ message: 'Invite not found' });
		}

		const membership = requireMembership(invite.targetType, invite.targetId, req.user.id);
		if (!membership.ok) {
			return res.status(membership.status).json({ message: membership.message });
		}

		revokeInviteLink(invite.id);
		res.json({ ok: true });
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

export default router;
