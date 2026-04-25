import webpush from 'web-push';
import db from '../database.js';

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

export const sendPushToUser = async (userId, payload) => {
	if (!publicKey || !privateKey) return;

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
