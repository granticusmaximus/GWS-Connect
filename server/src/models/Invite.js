import crypto from 'crypto';
import db from '../database.js';

const generateCode = () => crypto.randomBytes(6).toString('base64url');

export const createInviteLink = (
	targetType,
	targetId,
	createdBy,
	{ maxUses = null, expiresInHours = null } = {},
) => {
	const code = generateCode();
	const expiresAt = expiresInHours
		? new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString()
		: null;

	db.prepare(
		`INSERT INTO invite_links (code, targetType, targetId, createdBy, maxUses, expiresAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
	).run(code, targetType, targetId, createdBy, maxUses, expiresAt);

	return findInviteByCode(code);
};

export const findInviteByCode = (code) => {
	return db.prepare('SELECT * FROM invite_links WHERE code = ?').get(code);
};

export const getInviteStatus = (invite) => {
	if (!invite) {
		return { valid: false, reason: 'Invite not found' };
	}
	if (invite.revokedAt) {
		return { valid: false, reason: 'Invite has been revoked' };
	}
	if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
		return { valid: false, reason: 'Invite has expired' };
	}
	if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
		return { valid: false, reason: 'Invite has reached its use limit' };
	}
	return { valid: true };
};

export const incrementInviteUse = (inviteId) => {
	db.prepare('UPDATE invite_links SET useCount = useCount + 1 WHERE id = ?').run(
		inviteId,
	);
};

export const revokeInviteLink = (inviteId) => {
	db.prepare('UPDATE invite_links SET revokedAt = CURRENT_TIMESTAMP WHERE id = ?').run(
		inviteId,
	);
};

export const getInviteLinksForTarget = (targetType, targetId) => {
	return db
		.prepare(
			`SELECT * FROM invite_links
       WHERE targetType = ? AND targetId = ? AND revokedAt IS NULL
       ORDER BY createdAt DESC`,
		)
		.all(targetType, targetId);
};
