import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import db from '../database.js';
import {
	getNotificationsForUser,
	markNotificationRead,
} from '../models/Notification.js';

const router = express.Router();

const getVapidPublicKey = () => process.env.VAPID_PUBLIC_KEY || '';

router.get('/', authenticateToken, (req, res) => {
	try {
		const notifications = getNotificationsForUser(req.user.id);
		res.json(notifications);
	} catch (error) {
		console.error('Get notifications error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

router.post('/:notificationId/read', authenticateToken, (req, res) => {
	try {
		const notification = markNotificationRead(
			req.params.notificationId,
			req.user.id,
		);

		if (!notification) {
			return res.status(404).json({ message: 'Notification not found' });
		}

		res.json(notification);
	} catch (error) {
		console.error('Mark notification read error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

router.get('/vapid-public-key', authenticateToken, (req, res) => {
	const key = getVapidPublicKey();
	if (!key) {
		return res.status(500).json({ message: 'VAPID public key missing' });
	}
	res.json({ publicKey: key });
});

router.post('/subscribe', authenticateToken, (req, res) => {
	const { endpoint, keys, userAgent } = req.body || {};
	if (!endpoint || !keys?.p256dh || !keys?.auth) {
		return res.status(400).json({ message: 'Invalid subscription' });
	}

	try {
		const stmt = db.prepare(`
      INSERT INTO push_subscriptions (userId, endpoint, p256dh, auth, userAgent)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET userId = excluded.userId
    `);
		stmt.run(req.user.id, endpoint, keys.p256dh, keys.auth, userAgent || '');
		res.json({ message: 'Subscribed' });
	} catch (error) {
		console.error('Push subscribe error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

router.post('/unsubscribe', authenticateToken, (req, res) => {
	const { endpoint } = req.body || {};
	if (!endpoint) {
		return res.status(400).json({ message: 'Endpoint required' });
	}

	try {
		const stmt = db.prepare(
			'DELETE FROM push_subscriptions WHERE endpoint = ? AND userId = ?',
		);
		stmt.run(endpoint, req.user.id);
		res.json({ message: 'Unsubscribed' });
	} catch (error) {
		console.error('Push unsubscribe error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

export default router;
