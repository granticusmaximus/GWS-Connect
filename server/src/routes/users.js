import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
	findUserById,
	findUserByUsername,
	updateUser,
	searchUsers,
	getUserPublicKey,
} from '../models/User.js';

const router = express.Router();

const sanitizeUser = (user) => {
	if (!user) return null;
	delete user.password;
	return user;
};

router.get('/profile/username/:username', authenticateToken, async (req, res) => {
	try {
		const existingUser = findUserByUsername(req.params.username);
		const user = existingUser
			? sanitizeUser(findUserById(existingUser.id))
			: null;
		if (!user) {
			return res.status(404).json({ message: 'User not found' });
		}
		res.json(user);
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Get user profile
router.get('/profile/:userId', authenticateToken, async (req, res) => {
	try {
		const user = sanitizeUser(findUserById(req.params.userId));
		if (!user) {
			return res.status(404).json({ message: 'User not found' });
		}
		res.json(user);
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
	try {
		console.log('Profile update request from user:', req.user);
		console.log('Update data:', req.body);

		const updates = req.body;
		delete updates.password; // Don't allow password update through this route
		delete updates.email; // Don't allow email update

		const user = updateUser(req.user.id, updates);
		if (!user) {
			console.error('User not found:', req.user.id);
			return res.status(404).json({ message: 'User not found' });
		}

		console.log('Profile updated successfully:', user);
		res.json(sanitizeUser(user));
	} catch (error) {
		console.error('Profile update error:', error);
		res.status(500).json({ message: 'Server error: ' + error.message });
	}
});

// Search users
router.get('/search', authenticateToken, async (req, res) => {
	try {
		const { q } = req.query;
		const users = searchUsers(q);
		res.json(users);
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

// Get user public key
router.get('/public-key/:userId', authenticateToken, async (req, res) => {
	try {
		const record = getUserPublicKey(req.params.userId);
		if (!record || !record.e2eePublicKey) {
			return res.status(404).json({ message: 'Public key not found' });
		}
		res.json({ e2eePublicKey: JSON.parse(record.e2eePublicKey) });
	} catch (error) {
		res.status(500).json({ message: 'Server error' });
	}
});

export default router;
