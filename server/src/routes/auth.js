import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { generateSecret, generate, verify, generateURI } from 'otplib';
import QRCode from 'qrcode';
import { body, validationResult } from 'express-validator';
import db from '../database.js';
import {
	anonymizeUser,
	createUser,
	deleteUserPersonalData,
	findUserByEmail,
	findUserByUsername,
} from '../models/User.js';
import {
	createSession,
	listActiveSessions,
	revokeAllSessions,
	revokeOtherSessions,
	revokeSession,
} from '../models/Session.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();
const getJwtSecret = () => {
	const secret = process.env.JWT_SECRET;
	if (!secret) {
		throw new Error('JWT_SECRET environment variable is required');
	}
	return secret;
};

// Short-lived, server-side-only record of "this user proved their password,
// now waiting on a second factor." Deliberately an opaque random ID rather
// than a JWT - a JWT signed with the normal secret would pass
// authenticateToken as a real bearer token regardless of any custom claim,
// which would make this a privilege-escalation bug if any other route ever
// forgot to check that claim. An opaque ID has no such risk.
const TWO_FACTOR_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const twoFactorChallenges = new Map();

const createTwoFactorChallenge = (userId) => {
	const challengeId = crypto.randomBytes(32).toString('hex');
	twoFactorChallenges.set(challengeId, {
		userId,
		expiresAt: Date.now() + TWO_FACTOR_CHALLENGE_TTL_MS,
	});
	return challengeId;
};

const consumeTwoFactorChallenge = (challengeId) => {
	const challenge = twoFactorChallenges.get(challengeId);
	if (!challenge) {
		return null;
	}
	twoFactorChallenges.delete(challengeId);
	if (challenge.expiresAt < Date.now()) {
		return null;
	}
	return challenge;
};

const buildLoginResponse = (user, req) => {
	// findUserById (used by register) already parses these JSON columns;
	// findUserByEmail (used by login) does not - handle both shapes.
	if (typeof user.interests === 'string') {
		user.interests = JSON.parse(user.interests || '[]');
	}
	if (typeof user.socialLinks === 'string') {
		user.socialLinks = JSON.parse(user.socialLinks || '{}');
	}
	if (typeof user.contactInfo === 'string') {
		user.contactInfo = JSON.parse(user.contactInfo || '{}');
	}
	if (user.e2eePublicKey && typeof user.e2eePublicKey === 'string') {
		user.e2eePublicKey = JSON.parse(user.e2eePublicKey);
	}

	const sessionId = createSession(user.id, {
		userAgent: req.headers['user-agent'],
		ipAddress: req.ip,
	});

	const token = jwt.sign(
		{
			id: user.id,
			username: user.username,
			email: user.email,
			role: user.role || 'user',
			sid: sessionId,
		},
		getJwtSecret(),
		{ expiresIn: '7d' },
	);

	return {
		token,
		user: {
			id: user.id,
			username: user.username,
			email: user.email,
			e2eePublicKey: user.e2eePublicKey,
			e2eeEncryptedPrivateKey: user.e2eeEncryptedPrivateKey,
			e2eeSalt: user.e2eeSalt,
			e2eeIv: user.e2eeIv,
			theme: user.theme || 'light',
			appearOffline: user.appearOffline ? 1 : 0,
			avatar: user.avatar,
			banner: user.banner,
			bio: user.bio,
			interests: user.interests,
			socialLinks: user.socialLinks,
			contactInfo: user.contactInfo,
			role: user.role || 'user',
			mustChangePassword: user.mustChangePassword || 0,
			twoFactorEnabled: user.twoFactorEnabled ? 1 : 0,
		},
	};
};

const generateBackupCodes = (count = 8) => {
	const codes = [];
	for (let i = 0; i < count; i += 1) {
		const part1 = crypto.randomBytes(3).toString('hex').toUpperCase();
		const part2 = crypto.randomBytes(3).toString('hex').toUpperCase();
		codes.push(`${part1}-${part2}`);
	}
	return codes;
};

// Register
router.post(
	'/register',
	[
		body('username')
			.trim()
			.isLength({ min: 3 })
			.withMessage('Username must be at least 3 characters'),
		body('email').isEmail().withMessage('Invalid email address'),
		body('password')
			.isLength({ min: 6 })
			.withMessage('Password must be at least 6 characters'),
	],
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		try {
			const {
				username,
				email,
				password,
				e2eePublicKey,
				e2eeEncryptedPrivateKey,
				e2eeSalt,
				e2eeIv,
			} = req.body;

			if (!e2eePublicKey || !e2eeEncryptedPrivateKey || !e2eeSalt || !e2eeIv) {
				return res
					.status(400)
					.json({ message: 'Missing end-to-end encryption keys' });
			}

			// Check if user exists
			const existingUserByEmail = findUserByEmail(email);
			const existingUserByUsername = findUserByUsername(username);

			if (existingUserByEmail || existingUserByUsername) {
				return res.status(400).json({ message: 'User already exists' });
			}

			// Hash password
			const salt = await bcrypt.genSalt(10);
			const hashedPassword = await bcrypt.hash(password, salt);

			// Create user
			const userId = createUser(
				username,
				email,
				hashedPassword,
				JSON.stringify(e2eePublicKey),
				e2eeEncryptedPrivateKey,
				e2eeSalt,
				e2eeIv,
			);

			// Retrieve full user object
			const { findUserById } = await import('../models/User.js');
			const newUser = findUserById(userId);
			newUser.e2eePublicKey = JSON.parse(newUser.e2eePublicKey);

			res.status(201).json(buildLoginResponse(newUser, req));
		} catch (error) {
			console.error('Registration error:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

// Login
router.post(
	'/login',
	[
		body('email').isEmail().withMessage('Invalid email address'),
		body('password').notEmpty().withMessage('Password is required'),
	],
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		try {
			const { email, password } = req.body;

			// Find user
			const user = findUserByEmail(email);
			if (!user) {
				return res.status(400).json({ message: 'Invalid credentials' });
			}

			if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
				return res.status(429).json({
					message:
						'Account temporarily locked due to repeated failed login attempts. Please try again later.',
				});
			}

			// Check password
			const isMatch = await bcrypt.compare(password, user.password);
			if (!isMatch) {
				const attempts = (user.failedLoginAttempts || 0) + 1;
				const lockedUntil =
					attempts >= MAX_FAILED_LOGIN_ATTEMPTS
						? new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString()
						: null;

				db.prepare(
					'UPDATE users SET failedLoginAttempts = ?, lockedUntil = ? WHERE id = ?',
				).run(attempts, lockedUntil, user.id);

				return res.status(400).json({ message: 'Invalid credentials' });
			}

			if (user.failedLoginAttempts || user.lockedUntil) {
				db.prepare(
					'UPDATE users SET failedLoginAttempts = 0, lockedUntil = NULL WHERE id = ?',
				).run(user.id);
			}

			if (user.twoFactorEnabled) {
				const challengeId = createTwoFactorChallenge(user.id);
				return res.json({ requiresTwoFactor: true, challengeId });
			}

			res.json(buildLoginResponse(user, req));
		} catch (error) {
			console.error('Login error:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

// Accepts either a valid TOTP code or an unused backup code (consuming it on
// success). Shared by the login challenge and account deletion, both of
// which need "prove you still hold the second factor."
const verifyTwoFactorCode = async (user, code) => {
	const normalizedCode = String(code || '').trim();
	// verify() throws on malformed input (e.g. a backup code's length) rather
	// than returning { valid: false } - a backup code is valid to submit here,
	// just not a valid TOTP, so treat any throw as "not a valid TOTP" and fall
	// through to the backup-code check.
	const totpResult = await verify({ secret: user.twoFactorSecret, token: normalizedCode }).catch(() => ({ valid: false }));
	if (totpResult.valid) {
		return true;
	}

	const backupCodes = db
		.prepare(
			'SELECT id, codeHash FROM two_factor_backup_codes WHERE userId = ? AND usedAt IS NULL',
		)
		.all(user.id);

	for (const backupCode of backupCodes) {
		if (await bcrypt.compare(normalizedCode, backupCode.codeHash)) {
			db.prepare(
				'UPDATE two_factor_backup_codes SET usedAt = CURRENT_TIMESTAMP WHERE id = ?',
			).run(backupCode.id);
			return true;
		}
	}

	return false;
};

router.post(
	'/2fa/challenge',
	[
		body('challengeId').notEmpty().withMessage('challengeId is required'),
		body('code').notEmpty().withMessage('code is required'),
	],
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		try {
			const { challengeId, code } = req.body;
			const challenge = consumeTwoFactorChallenge(challengeId);
			if (!challenge) {
				return res.status(400).json({ message: 'Invalid or expired login session, please log in again' });
			}

			const user = db
				.prepare('SELECT * FROM users WHERE id = ?')
				.get(challenge.userId);
			if (!user || !user.twoFactorEnabled) {
				return res.status(400).json({ message: 'Invalid or expired login session, please log in again' });
			}

			const isValid = await verifyTwoFactorCode(user, code);
			if (isValid) {
				return res.json(buildLoginResponse(user, req));
			}

			res.status(400).json({ message: 'Invalid authentication code' });
		} catch (error) {
			console.error('2FA challenge error:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

router.post('/2fa/setup', authenticateToken, async (req, res) => {
	try {
		const user = db
			.prepare('SELECT id, email FROM users WHERE id = ?')
			.get(req.user.id);
		if (!user) {
			return res.status(404).json({ message: 'User not found' });
		}

		const secret = generateSecret();
		db.prepare('UPDATE users SET pendingTwoFactorSecret = ? WHERE id = ?').run(
			secret,
			user.id,
		);

		const uri = generateURI({ issuer: 'GWS Connect', label: user.email, secret });
		const qrCodeDataUrl = await QRCode.toDataURL(uri);

		res.json({ secret, qrCodeDataUrl });
	} catch (error) {
		console.error('2FA setup error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

router.post('/2fa/verify-setup', authenticateToken, async (req, res) => {
	try {
		const { code } = req.body;
		if (!code) {
			return res.status(400).json({ message: 'code is required' });
		}

		const user = db
			.prepare('SELECT id, pendingTwoFactorSecret FROM users WHERE id = ?')
			.get(req.user.id);
		if (!user || !user.pendingTwoFactorSecret) {
			return res.status(400).json({ message: 'No two-factor setup in progress' });
		}

		const result = await verify({ secret: user.pendingTwoFactorSecret, token: String(code).trim() }).catch(() => ({ valid: false }));
		if (!result.valid) {
			return res.status(400).json({ message: 'Invalid authentication code' });
		}

		db.prepare('DELETE FROM two_factor_backup_codes WHERE userId = ?').run(user.id);

		const backupCodes = generateBackupCodes();
		const insertBackupCode = db.prepare(
			'INSERT INTO two_factor_backup_codes (userId, codeHash) VALUES (?, ?)',
		);
		for (const backupCode of backupCodes) {
			const hash = await bcrypt.hash(backupCode, 10);
			insertBackupCode.run(user.id, hash);
		}

		db.prepare(
			'UPDATE users SET twoFactorEnabled = 1, twoFactorSecret = ?, pendingTwoFactorSecret = NULL WHERE id = ?',
		).run(user.pendingTwoFactorSecret, user.id);

		res.json({ message: 'Two-factor authentication enabled', backupCodes });
	} catch (error) {
		console.error('2FA verify-setup error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

router.post('/2fa/disable', authenticateToken, async (req, res) => {
	try {
		const { currentPassword } = req.body;
		if (!currentPassword) {
			return res.status(400).json({ message: 'Current password required' });
		}

		const user = db
			.prepare('SELECT id, password FROM users WHERE id = ?')
			.get(req.user.id);
		if (!user) {
			return res.status(404).json({ message: 'User not found' });
		}

		const isMatch = await bcrypt.compare(currentPassword, user.password);
		if (!isMatch) {
			return res.status(400).json({ message: 'Invalid current password' });
		}

		db.prepare(
			'UPDATE users SET twoFactorEnabled = 0, twoFactorSecret = NULL, pendingTwoFactorSecret = NULL WHERE id = ?',
		).run(user.id);
		db.prepare('DELETE FROM two_factor_backup_codes WHERE userId = ?').run(user.id);

		res.json({ message: 'Two-factor authentication disabled' });
	} catch (error) {
		console.error('2FA disable error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

router.post(
	'/forgot-password-request',
	[body('email').isEmail().withMessage('Invalid email address')],
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		try {
			const { email } = req.body;
			const normalizedEmail = String(email || '')
				.trim()
				.toLowerCase();
			const user = findUserByEmail(normalizedEmail);

			if (user) {
				const existingRequest = db
					.prepare(
						`SELECT id
						 FROM password_reset_requests
						 WHERE userId = ? AND status = 'pending'
						 LIMIT 1`,
					)
					.get(user.id);

				if (existingRequest) {
					db.prepare(
						`UPDATE password_reset_requests
						 SET requestedAt = CURRENT_TIMESTAMP
						 WHERE id = ?`,
					).run(existingRequest.id);
				} else {
					db.prepare(
						`INSERT INTO password_reset_requests (userId, email)
						 VALUES (?, ?)`,
					).run(user.id, user.email);
				}
			}

			return res.json({
				message:
					'If an account exists for that email, your password reset request has been sent to an administrator.',
			});
		} catch (error) {
			console.error('Forgot password request error:', error);
			return res.status(500).json({ message: 'Server error' });
		}
	},
);

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

const isStrongPassword = (password) =>
	/^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/.test(password);

router.post(
	'/change-password',
	authenticateToken,
	[
		body('currentPassword').notEmpty().withMessage('Current password required'),
		body('newPassword').notEmpty().withMessage('New password required'),
	],
	async (req, res) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		try {
			const {
				currentPassword,
				newPassword,
				e2eePublicKey,
				e2eeEncryptedPrivateKey,
				e2eeSalt,
				e2eeIv,
			} = req.body;

			if (!isStrongPassword(newPassword)) {
				return res.status(400).json({
					message:
						'Password must be at least 8 characters and include letters, numbers, and a special character',
				});
			}

			const e2eeBundle = [
				e2eePublicKey,
				e2eeEncryptedPrivateKey,
				e2eeSalt,
				e2eeIv,
			];
			const e2eeBundleProvided = e2eeBundle.filter(
				(field) => field !== undefined && field !== null,
			);
			if (e2eeBundleProvided.length > 0 && e2eeBundleProvided.length < 4) {
				return res
					.status(400)
					.json({ message: 'Incomplete encryption key update' });
			}

			const user = findUserByEmail(req.user.email);
			if (!user) {
				return res.status(404).json({ message: 'User not found' });
			}

			const isMatch = await bcrypt.compare(currentPassword, user.password);
			if (!isMatch) {
				return res.status(400).json({ message: 'Invalid current password' });
			}

			const salt = await bcrypt.genSalt(10);
			const hashedPassword = await bcrypt.hash(newPassword, salt);

			const updates = {
				password: hashedPassword,
				mustChangePassword: 0,
			};
			if (e2eeBundleProvided.length === 4) {
				updates.e2eePublicKey = JSON.stringify(e2eePublicKey);
				updates.e2eeEncryptedPrivateKey = e2eeEncryptedPrivateKey;
				updates.e2eeSalt = e2eeSalt;
				updates.e2eeIv = e2eeIv;
			}

			const { updateUser } = await import('../models/User.js');
			updateUser(user.id, updates);

			res.json({ message: 'Password updated', mustChangePassword: 0 });
		} catch (error) {
			console.error('Change password error:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

const disconnectSocketsForSession = (io, userId, sessionId) => {
	for (const socket of io.sockets.sockets.values()) {
		if (String(socket.user?.id) === String(userId) && socket.user?.sid === sessionId) {
			socket.disconnect(true);
		}
	}
};

const disconnectOtherSockets = (io, userId, exceptSessionId) => {
	for (const socket of io.sockets.sockets.values()) {
		if (String(socket.user?.id) === String(userId) && socket.user?.sid !== exceptSessionId) {
			socket.disconnect(true);
		}
	}
};

const disconnectAllSocketsForUser = (io, userId) => {
	for (const socket of io.sockets.sockets.values()) {
		if (String(socket.user?.id) === String(userId)) {
			socket.disconnect(true);
		}
	}
};

// List this user's active sessions/devices.
router.get('/sessions', authenticateToken, async (req, res) => {
	try {
		const sessions = listActiveSessions(req.user.id).map((session) => ({
			...session,
			isCurrent: session.id === req.user.sid,
		}));
		res.json(sessions);
	} catch (error) {
		console.error('List sessions error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Revoke a single session (e.g. a stolen/lost device) and immediately
// disconnect any live socket tied to it.
router.delete('/sessions/:sessionId', authenticateToken, async (req, res) => {
	try {
		const sessionId = Number(req.params.sessionId);
		const revoked = revokeSession(sessionId, req.user.id);
		if (!revoked) {
			return res.status(404).json({ message: 'Session not found' });
		}

		const io = req.app.get('io');
		disconnectSocketsForSession(io, req.user.id, sessionId);

		res.json({ message: 'Session revoked' });
	} catch (error) {
		console.error('Revoke session error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// "Log out all other devices" - revoke everything except the caller's own
// current session.
router.delete('/sessions', authenticateToken, async (req, res) => {
	try {
		const revokedCount = revokeOtherSessions(req.user.id, req.user.sid);

		const io = req.app.get('io');
		disconnectOtherSockets(io, req.user.id, req.user.sid);

		res.json({ message: 'Other sessions revoked', revokedCount });
	} catch (error) {
		console.error('Revoke other sessions error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Real server-side logout - revokes the current session so the token can't
// be reused even though it hasn't naturally expired yet.
router.post('/logout', authenticateToken, async (req, res) => {
	try {
		revokeSession(req.user.sid, req.user.id);
		res.json({ message: 'Logged out' });
	} catch (error) {
		console.error('Logout error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Self-service account deletion - anonymizes the user in place (see
// anonymizeUser/deleteUserPersonalData in models/User.js) rather than
// hard-deleting, so channels/groups/messages this user created or sent
// stay intact for other members instead of cascading away.
router.post('/delete-account', authenticateToken, async (req, res) => {
	try {
		const { currentPassword, code } = req.body;
		if (!currentPassword) {
			return res.status(400).json({ message: 'Current password required' });
		}

		const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
		if (!user) {
			return res.status(404).json({ message: 'User not found' });
		}

		const isMatch = await bcrypt.compare(currentPassword, user.password);
		if (!isMatch) {
			return res.status(400).json({ message: 'Invalid current password' });
		}

		if (user.twoFactorEnabled) {
			if (!code) {
				return res.status(400).json({ message: 'Authentication code required' });
			}
			const isCodeValid = await verifyTwoFactorCode(user, code);
			if (!isCodeValid) {
				return res.status(400).json({ message: 'Invalid authentication code' });
			}
		}

		deleteUserPersonalData(user.id);
		anonymizeUser(user.id);
		revokeAllSessions(user.id);

		const io = req.app.get('io');
		disconnectAllSocketsForUser(io, user.id);

		res.json({ message: 'Account deleted' });
	} catch (error) {
		console.error('Delete account error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

export default router;
