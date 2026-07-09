import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { canAccessChannel } from '../models/Channel.js';
import { canAccessGroupChat } from '../models/GroupChat.js';
import { getUserRole } from '../middleware/roles.js';
import {
	getNotificationPreference,
	getNotificationPreferencesForUser,
	setNotificationPreference,
} from '../models/NotificationPreference.js';

const router = express.Router();

const isValidPreference = (preference) =>
	['all', 'mentions', 'none'].includes(String(preference || ''));

const canAccessTarget = (req, targetType, targetId) => {
	if (targetType === 'channel') {
		const access = canAccessChannel(targetId, req.user.id, getUserRole(req.user.id));
		return access.allowed;
	}

	if (targetType === 'group') {
		const access = canAccessGroupChat(targetId, req.user.id);
		return access.allowed;
	}

	if (targetType === 'dm') {
		return String(targetId) !== String(req.user.id);
	}

	return false;
};

router.get('/', authenticateToken, (req, res) => {
	try {
		res.json(getNotificationPreferencesForUser(req.user.id));
	} catch (error) {
		console.error('Notification prefs list error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

router.get('/:type/:id', authenticateToken, (req, res) => {
	try {
		if (!canAccessTarget(req, req.params.type, req.params.id)) {
			return res.status(403).json({ message: 'Access denied' });
		}

		const preference =
			getNotificationPreference(req.user.id, req.params.type, req.params.id)
				?.preference || 'all';
		res.json({
			targetType: req.params.type,
			targetId: String(req.params.id),
			preference,
		});
	} catch (error) {
		console.error('Notification prefs read error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

router.put('/:type/:id', authenticateToken, (req, res) => {
	try {
		const { type, id } = req.params;
		const preference = String(req.body?.preference || '');

		if (!isValidPreference(preference)) {
			return res.status(400).json({ message: 'Invalid notification preference' });
		}

		if (!canAccessTarget(req, type, id)) {
			return res.status(403).json({ message: 'Access denied' });
		}

		const saved = setNotificationPreference(req.user.id, type, id, preference);
		if (!saved) {
			return res.status(400).json({ message: 'Unable to save preference' });
		}

		res.json(saved);
	} catch (error) {
		console.error('Notification prefs update error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

export default router;
