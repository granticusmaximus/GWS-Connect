import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
	sendFriendRequest,
	acceptFriendRequest,
	rejectFriendRequest,
	cancelFriendRequest,
	removeFriend,
	getFriends,
	getPendingRequests,
	getSentRequests,
	getFriendshipStatus,
	getMutualFriends,
	searchUsers,
} from '../models/Friend.js';

const router = express.Router();

// Search users
router.get('/search', authenticateToken, (req, res) => {
	try {
		const { q } = req.query;
		if (!q || q.trim().length === 0) {
			return res.json([]);
		}
		const users = searchUsers(q, req.user.id);
		res.json(users);
	} catch (error) {
		console.error('Search users error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Get all friends
router.get('/', authenticateToken, (req, res) => {
	try {
		const friends = getFriends(req.user.id);
		res.json(friends);
	} catch (error) {
		console.error('Get friends error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Get pending friend requests
router.get('/requests/pending', authenticateToken, (req, res) => {
	try {
		const requests = getPendingRequests(req.user.id);
		res.json(requests);
	} catch (error) {
		console.error('Get pending requests error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Get sent friend requests
router.get('/requests/sent', authenticateToken, (req, res) => {
	try {
		const requests = getSentRequests(req.user.id);
		res.json(requests);
	} catch (error) {
		console.error('Get sent requests error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Get friendship status with specific user
router.get('/status/:userId', authenticateToken, (req, res) => {
	try {
		const status = getFriendshipStatus(req.user.id, req.params.userId);
		res.json(status || { status: 'none' });
	} catch (error) {
		console.error('Get friendship status error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Get mutual friends
router.get('/mutual/:userId', authenticateToken, (req, res) => {
	try {
		const mutualFriends = getMutualFriends(req.user.id, req.params.userId);
		res.json(mutualFriends);
	} catch (error) {
		console.error('Get mutual friends error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Send friend request
router.post('/request/:userId', authenticateToken, (req, res) => {
	try {
		const friendId = parseInt(req.params.userId);
		if (friendId === req.user.id) {
			return res
				.status(400)
				.json({ message: 'Cannot send friend request to yourself' });
		}

		// Check if friendship already exists
		const existingStatus = getFriendshipStatus(req.user.id, friendId);
		if (existingStatus) {
			return res.status(400).json({ message: 'Friend request already sent' });
		}

		sendFriendRequest(req.user.id, friendId);
		res.json({ message: 'Friend request sent' });
	} catch (error) {
		console.error('Send friend request error:', error);
		if (error.code === 'SQLITE_CONSTRAINT') {
			return res.status(400).json({ message: 'Friend request already exists' });
		}
		res.status(500).json({ message: 'Server error' });
	}
});

// Accept friend request
router.post('/accept/:userId', authenticateToken, (req, res) => {
	try {
		const friendId = parseInt(req.params.userId);
		acceptFriendRequest(req.user.id, friendId);
		res.json({ message: 'Friend request accepted' });
	} catch (error) {
		console.error('Accept friend request error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Reject friend request
router.post('/reject/:userId', authenticateToken, (req, res) => {
	try {
		const friendId = parseInt(req.params.userId);
		rejectFriendRequest(req.user.id, friendId);
		res.json({ message: 'Friend request rejected' });
	} catch (error) {
		console.error('Reject friend request error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Cancel sent friend request
router.post('/cancel/:userId', authenticateToken, (req, res) => {
	try {
		const friendId = parseInt(req.params.userId);
		cancelFriendRequest(req.user.id, friendId);
		res.json({ message: 'Friend request cancelled' });
	} catch (error) {
		console.error('Cancel friend request error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Remove friend
router.delete('/:userId', authenticateToken, (req, res) => {
	try {
		const friendId = parseInt(req.params.userId);
		removeFriend(req.user.id, friendId);
		res.json({ message: 'Friend removed' });
	} catch (error) {
		console.error('Remove friend error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

export default router;
