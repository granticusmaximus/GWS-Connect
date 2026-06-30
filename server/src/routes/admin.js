import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/roles.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import db from '../database.js';
import {
	createUser,
	findUserByEmail,
	findUserByUsername,
	findUserById,
	updateUser,
} from '../models/User.js';
import {
	sendTemporaryPasswordEmail,
	sendAdminResetPasswordEmail,
} from '../services/email.js';

const router = express.Router();

// Get all pending channels
router.get('/channels/pending', authenticateToken, requireAdmin, (req, res) => {
	try {
		const stmt = db.prepare(`
		SELECT c.*, u.username as creatorUsername, u.email as creatorEmail
      FROM channels c
      JOIN users u ON c.createdBy = u.id
      WHERE c.status = 'pending'
      ORDER BY c.createdAt DESC
    `);
		const channels = stmt.all();
		res.json(channels);
	} catch (error) {
		console.error('Error fetching pending channels:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Approve channel
router.post(
	'/channels/:channelId/approve',
	authenticateToken,
	requireAdmin,
	(req, res) => {
		try {
			const stmt = db.prepare(
				`UPDATE channels SET status = 'approved' WHERE id = ?`,
			);
			stmt.run(req.params.channelId);

			res.json({ message: 'Channel approved successfully' });
		} catch (error) {
			console.error('Error approving channel:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

// Reject channel
router.post(
	'/channels/:channelId/reject',
	authenticateToken,
	requireAdmin,
	(req, res) => {
		try {
			const stmt = db.prepare(
				`UPDATE channels SET status = 'rejected' WHERE id = ?`,
			);
			stmt.run(req.params.channelId);

			res.json({ message: 'Channel rejected' });
		} catch (error) {
			console.error('Error rejecting channel:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

// Assign manager to channel
router.post(
	'/channels/:channelId/managers',
	authenticateToken,
	requireAdmin,
	(req, res) => {
		try {
			const { userId } = req.body;

			if (!userId) {
				return res.status(400).json({ message: 'User ID required' });
			}

			// Check if user exists
			const userStmt = db.prepare('SELECT id FROM users WHERE id = ?');
			const user = userStmt.get(userId);

			if (!user) {
				return res.status(404).json({ message: 'User not found' });
			}

			// Add manager
			const stmt = db.prepare(`
      INSERT OR IGNORE INTO channel_managers (channelId, userId, assignedBy)
      VALUES (?, ?, ?)
    `);
			stmt.run(req.params.channelId, userId, req.user.id);

			res.json({ message: 'Manager assigned successfully' });
		} catch (error) {
			console.error('Error assigning manager:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

// Remove manager from channel
router.delete(
	'/channels/:channelId/managers/:userId',
	authenticateToken,
	requireAdmin,
	(req, res) => {
		try {
			const stmt = db.prepare(
				`DELETE FROM channel_managers WHERE channelId = ? AND userId = ?`,
			);
			stmt.run(req.params.channelId, req.params.userId);

			res.json({ message: 'Manager removed successfully' });
		} catch (error) {
			console.error('Error removing manager:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

// Get all users (for admin panel)
router.get('/users', authenticateToken, requireAdmin, (req, res) => {
	try {
		const stmt = db.prepare(`
      SELECT id, username, email, role, avatar, createdAt
      FROM users
      ORDER BY createdAt DESC
    `);
		const users = stmt.all();
		res.json(users);
	} catch (error) {
		console.error('Error fetching users:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

router.get(
	'/password-reset-requests',
	authenticateToken,
	requireAdmin,
	(req, res) => {
		try {
			const requests = db
				.prepare(
					`SELECT
						pr.id,
						pr.userId,
						pr.email,
						pr.requestedAt,
						u.username,
						u.avatar
					 FROM password_reset_requests pr
					 LEFT JOIN users u ON u.id = pr.userId
					 WHERE pr.status = 'pending'
					 ORDER BY pr.requestedAt DESC`,
				)
				.all();
			res.json(requests);
		} catch (error) {
			console.error('Error fetching password reset requests:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

// Update user role
router.put(
	'/users/:userId/role',
	authenticateToken,
	requireAdmin,
	(req, res) => {
		try {
			const { role } = req.body;

			if (!['user', 'manager', 'admin'].includes(role)) {
				return res.status(400).json({ message: 'Invalid role' });
			}

			const stmt = db.prepare(`UPDATE users SET role = ? WHERE id = ?`);
			stmt.run(role, req.params.userId);

			res.json({ message: 'User role updated successfully' });
		} catch (error) {
			console.error('Error updating user role:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

// Create user
router.post('/users', authenticateToken, requireAdmin, async (req, res) => {
	try {
		const { username, email, role } = req.body || {};
		const normalizedRole = role || 'user';

		if (!username || !email) {
			return res
				.status(400)
				.json({ message: 'Username and email are required' });
		}

		if (!['user', 'manager', 'admin'].includes(normalizedRole)) {
			return res.status(400).json({ message: 'Invalid role' });
		}

		const existingUserByEmail = findUserByEmail(email);
		const existingUserByUsername = findUserByUsername(username);

		if (existingUserByEmail || existingUserByUsername) {
			return res.status(400).json({ message: 'User already exists' });
		}

		const tempPassword = generateTempPassword();
		const salt = await bcrypt.genSalt(10);
		const hashedPassword = await bcrypt.hash(tempPassword, salt);

		const userId = createUser(
			username,
			email,
			hashedPassword,
			null,
			null,
			null,
			null,
			normalizedRole,
		);

		db.prepare('UPDATE users SET mustChangePassword = 1 WHERE id = ?').run(
			userId,
		);

		try {
			await sendTemporaryPasswordEmail({
				to: email,
				username,
				tempPassword,
			});
		} catch (emailError) {
			console.error('Error sending temporary password email:', emailError);
			db.prepare('DELETE FROM users WHERE id = ?').run(userId);
			return res
				.status(500)
				.json({ message: 'Failed to send temporary password email' });
		}

		const newUser = findUserById(userId);
		if (newUser) {
			delete newUser.password;
		}

		res.status(201).json({ user: newUser, tempPassword });
	} catch (error) {
		console.error('Error creating user:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

function generateTempPassword(length = 12) {
	const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
	const numbers = '23456789';
	const specials = '!@#$%^&*_-+=?';
	const all = `${letters}${numbers}${specials}`;

	const picks = [
		letters[crypto.randomInt(0, letters.length)],
		numbers[crypto.randomInt(0, numbers.length)],
		specials[crypto.randomInt(0, specials.length)],
	];

	while (picks.length < length) {
		picks.push(all[crypto.randomInt(0, all.length)]);
	}

	for (let i = picks.length - 1; i > 0; i -= 1) {
		const j = crypto.randomInt(0, i + 1);
		[picks[i], picks[j]] = [picks[j], picks[i]];
	}

	return picks.join('');
}

function generateAdminResetPassword(length = 8) {
	const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
	const numbers = '23456789';
	const all = `${letters}${numbers}`;
	const picks = [
		letters[crypto.randomInt(0, letters.length)],
		numbers[crypto.randomInt(0, numbers.length)],
	];

	while (picks.length < length) {
		picks.push(all[crypto.randomInt(0, all.length)]);
	}

	for (let i = picks.length - 1; i > 0; i -= 1) {
		const j = crypto.randomInt(0, i + 1);
		[picks[i], picks[j]] = [picks[j], picks[i]];
	}

	return picks.join('');
}

const markPasswordResetRequestsResolved = (userId, adminId) => {
	db.prepare(
		`UPDATE password_reset_requests
		 SET status = 'completed',
			 resolvedAt = CURRENT_TIMESTAMP,
			 resolvedBy = ?
		 WHERE userId = ? AND status = 'pending'`,
	).run(adminId, userId);
};

const issueAdminPasswordReset = async (targetUser, adminId) => {
	const tempPassword = generateAdminResetPassword();
	const salt = await bcrypt.genSalt(10);
	const hashedPassword = await bcrypt.hash(tempPassword, salt);

	updateUser(targetUser.id, {
		password: hashedPassword,
		mustChangePassword: true,
	});

	await sendAdminResetPasswordEmail({
		to: targetUser.email,
		username: targetUser.username,
		tempPassword,
	});

	markPasswordResetRequestsResolved(targetUser.id, adminId);
};

router.post(
	'/users/:userId/reset-password',
	authenticateToken,
	requireAdmin,
	async (req, res) => {
		try {
			const targetUser = findUserById(req.params.userId);
			if (!targetUser) {
				return res.status(404).json({ message: 'User not found' });
			}

			await issueAdminPasswordReset(targetUser, req.user.id);

			return res.json({ message: 'Temporary password sent' });
		} catch (error) {
			console.error('Reset password error:', error);
			return res.status(500).json({ message: 'Server error' });
		}
	},
);

// Recovery escape hatch for a user who has lost both their authenticator and
// backup codes - same trust tier as the password reset above.
router.post(
	'/users/:userId/2fa/disable',
	authenticateToken,
	requireAdmin,
	async (req, res) => {
		try {
			const targetUser = findUserById(req.params.userId);
			if (!targetUser) {
				return res.status(404).json({ message: 'User not found' });
			}

			db.prepare(
				'UPDATE users SET twoFactorEnabled = 0, twoFactorSecret = NULL, pendingTwoFactorSecret = NULL WHERE id = ?',
			).run(targetUser.id);
			db.prepare('DELETE FROM two_factor_backup_codes WHERE userId = ?').run(targetUser.id);

			return res.json({ message: 'Two-factor authentication disabled for user' });
		} catch (error) {
			console.error('Admin 2FA disable error:', error);
			return res.status(500).json({ message: 'Server error' });
		}
	},
);

router.post(
	'/password-reset-requests/:requestId/resolve',
	authenticateToken,
	requireAdmin,
	async (req, res) => {
		try {
			const request = db
				.prepare(
					`SELECT *
					 FROM password_reset_requests
					 WHERE id = ? AND status = 'pending'`,
				)
				.get(req.params.requestId);

			if (!request) {
				return res.status(404).json({ message: 'Password reset request not found' });
			}

			if (!request.userId) {
				db.prepare(
					`UPDATE password_reset_requests
					 SET status = 'dismissed',
						 resolvedAt = CURRENT_TIMESTAMP,
						 resolvedBy = ?,
						 notes = 'No matching user account was available when the request was processed.'
					 WHERE id = ?`,
				).run(req.user.id, request.id);
				return res
					.status(404)
					.json({ message: 'No matching user account for this request' });
			}

			const targetUser = findUserById(request.userId);
			if (!targetUser) {
				db.prepare(
					`UPDATE password_reset_requests
					 SET status = 'dismissed',
						 resolvedAt = CURRENT_TIMESTAMP,
						 resolvedBy = ?,
						 notes = 'The user account no longer exists.'
					 WHERE id = ?`,
				).run(req.user.id, request.id);
				return res.status(404).json({ message: 'User not found' });
			}

			await issueAdminPasswordReset(targetUser, req.user.id);
			return res.json({ message: 'Temporary password sent' });
		} catch (error) {
			console.error('Resolve password reset request error:', error);
			return res.status(500).json({ message: 'Server error' });
		}
	},
);

router.delete('/users/:userId', authenticateToken, requireAdmin, (req, res) => {
	try {
		if (String(req.user.id) === String(req.params.userId)) {
			return res
				.status(400)
				.json({ message: 'You cannot delete your own account' });
		}

		const user = findUserById(req.params.userId);
		if (!user) {
			return res.status(404).json({ message: 'User not found' });
		}

		db.prepare('DELETE FROM users WHERE id = ?').run(req.params.userId);
		return res.json({ message: 'User deleted' });
	} catch (error) {
		console.error('Delete user error:', error);
		return res.status(500).json({ message: 'Server error' });
	}
});

router.get('/reports', authenticateToken, requireAdmin, (req, res) => {
	try {
		const reports = db
			.prepare(
				`SELECT
          mr.id, mr.messageId, mr.reason, mr.content, mr.status, mr.createdAt,
          m.channelId, m.recipientId, m.groupChatId,
          reporter.id as reporterId, reporter.username as reporterUsername, reporter.avatar as reporterAvatar,
          sender.id as senderId, sender.username as senderUsername
         FROM message_reports mr
         JOIN users reporter ON reporter.id = mr.reporterId
         LEFT JOIN messages m ON m.id = mr.messageId
         LEFT JOIN users sender ON sender.id = m.senderId
         WHERE mr.status = 'pending'
         ORDER BY mr.createdAt DESC`,
			)
			.all();
		res.json(reports);
	} catch (error) {
		console.error('Error fetching reports:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

router.post('/reports/:reportId/review', authenticateToken, requireAdmin, (req, res) => {
	try {
		const result = db
			.prepare(
				`UPDATE message_reports
         SET status = 'reviewed', reviewedBy = ?, reviewedAt = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'pending'`,
			)
			.run(req.user.id, req.params.reportId);

		if (result.changes === 0) {
			return res.status(404).json({ message: 'Report not found or already actioned' });
		}
		res.json({ message: 'Report marked as reviewed' });
	} catch (error) {
		console.error('Error reviewing report:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

router.post('/reports/:reportId/dismiss', authenticateToken, requireAdmin, (req, res) => {
	try {
		const result = db
			.prepare(
				`UPDATE message_reports
         SET status = 'dismissed', reviewedBy = ?, reviewedAt = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'pending'`,
			)
			.run(req.user.id, req.params.reportId);

		if (result.changes === 0) {
			return res.status(404).json({ message: 'Report not found or already actioned' });
		}
		res.json({ message: 'Report dismissed' });
	} catch (error) {
		console.error('Error dismissing report:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

export default router;
