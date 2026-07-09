import crypto from 'crypto';
import db from '../database.js';

const normalizeWebhook = (row) =>
	row
		? {
				...row,
				id: String(row.id),
				channelId: String(row.channelId),
				createdBy: String(row.createdBy),
				token: String(row.token),
				avatarUrl: row.avatarUrl || '',
			}
		: null;

export const listWebhooksForChannel = (channelId) =>
	db
		.prepare(
			`SELECT id, channelId, createdBy, name, token, avatarUrl, createdAt, revokedAt
       FROM webhooks
       WHERE channelId = ?
       ORDER BY CASE WHEN revokedAt IS NULL THEN 0 ELSE 1 END, datetime(createdAt) DESC, id DESC`,
		)
		.all(channelId)
		.map(normalizeWebhook);

export const findWebhookById = (webhookId) =>
	normalizeWebhook(
		db
			.prepare(
				`SELECT id, channelId, createdBy, name, token, avatarUrl, createdAt, revokedAt
         FROM webhooks
         WHERE id = ?`,
			)
			.get(webhookId),
	);

export const findActiveWebhookByToken = (token) =>
	normalizeWebhook(
		db
			.prepare(
				`SELECT id, channelId, createdBy, name, token, avatarUrl, createdAt, revokedAt
         FROM webhooks
         WHERE token = ? AND revokedAt IS NULL`,
			)
			.get(token),
	);

export const createWebhook = (channelId, name, createdBy, avatarUrl = '') => {
	const token = crypto.randomBytes(24).toString('hex');
	const result = db
		.prepare(
			`INSERT INTO webhooks (channelId, createdBy, name, token, avatarUrl)
       VALUES (?, ?, ?, ?, ?)`,
		)
		.run(channelId, createdBy, name, token, avatarUrl || '');
	return findWebhookById(result.lastInsertRowid);
};

export const revokeWebhook = (webhookId) =>
	db
		.prepare(
			`UPDATE webhooks
       SET revokedAt = CURRENT_TIMESTAMP
       WHERE id = ? AND revokedAt IS NULL`,
		)
		.run(webhookId);
