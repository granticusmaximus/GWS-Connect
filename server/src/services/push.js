import webpush from 'web-push';
import db from '../database.js';
import { getNotificationPreference } from '../models/NotificationPreference.js';

const publicKey = process.env.VAPID_PUBLIC_KEY || '';
const privateKey = process.env.VAPID_PRIVATE_KEY || '';
const subject = process.env.VAPID_SUBJECT || 'mailto:admin@gwsapp.net';

if (publicKey && privateKey) {
	webpush.setVapidDetails(subject, publicKey, privateKey);
}

const removeSubscription = (endpoint) => {
	const stmt = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?');
	stmt.run(endpoint);
};

const isDndActive = (userId) => {
	const user = db
		.prepare('SELECT dndUntil FROM users WHERE id = ?')
		.get(userId);

	if (!user?.dndUntil) {
		return false;
	}

	const dndUntil = new Date(user.dndUntil).getTime();
	if (Number.isNaN(dndUntil) || dndUntil <= Date.now()) {
		db.prepare('UPDATE users SET dndUntil = NULL WHERE id = ?').run(userId);
		return false;
	}

	return true;
};

const shouldSuppressForPreference = (
	userId,
	{ targetType = null, targetId = null, isMention = false } = {},
) => {
	if (!targetType || targetId === null || targetId === undefined) {
		return false;
	}

	const preference = getNotificationPreference(userId, targetType, targetId)?.preference;
	if (!preference || preference === 'all') {
		return false;
	}

	if (preference === 'mentions') {
		return !isMention;
	}

	return true;
};

export const sendPushToUser = async (userId, payload, options = {}) => {
	if (!publicKey || !privateKey) return;
	if (isDndActive(userId)) return;
	if (shouldSuppressForPreference(userId, options)) return;

	const stmt = db.prepare(
		'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE userId = ?',
	);
	const subs = stmt.all(userId);

	await Promise.all(
		subs.map(async (sub) => {
			const subscription = {
				endpoint: sub.endpoint,
				expirationTime: null,
				keys: {
					p256dh: sub.p256dh,
					auth: sub.auth,
				},
			};

			try {
				await webpush.sendNotification(subscription, JSON.stringify(payload));
			} catch (error) {
				if (error?.statusCode === 410 || error?.statusCode === 404) {
					removeSubscription(sub.endpoint);
				}
			}
		}),
	);
};
