import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import db from '../database.js';
import {
	createUser,
	findUserByEmail,
	findUserByUsername,
} from '../models/User.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();
const getJwtSecret = () => {
	const secret = process.env.JWT_SECRET;
	if (!secret) {
		throw new Error('JWT_SECRET environment variable is required');
	}
	return secret;
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
				e2eePublicKey,
				e2eeEncryptedPrivateKey,
				e2eeSalt,
				e2eeIv,
			);

			// Retrieve full user object
			const { findUserById } = await import('../models/User.js');
			const newUser = findUserById(userId);

			// Create token
			const token = jwt.sign(
				{
					id: newUser.id,
					username: newUser.username,
					email: newUser.email,
					role: newUser.role || 'user',
				},
				getJwtSecret(),
				{
					expiresIn: '7d',
				},
			);

			res.status(201).json({
				token,
				user: {
					id: newUser.id,
					username: newUser.username,
					email: newUser.email,
					e2eePublicKey: newUser.e2eePublicKey,
					e2eeEncryptedPrivateKey: newUser.e2eeEncryptedPrivateKey,
					e2eeSalt: newUser.e2eeSalt,
					e2eeIv: newUser.e2eeIv,
					theme: newUser.theme || 'light',
					avatar: newUser.avatar || '',
					role: newUser.role || 'user',
					mustChangePassword: newUser.mustChangePassword || 0,
				},
			});
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

			// Check password
			const isMatch = await bcrypt.compare(password, user.password);
			if (!isMatch) {
				return res.status(400).json({ message: 'Invalid credentials' });
			}

			// Parse JSON fields
			user.interests = JSON.parse(user.interests || '[]');
			user.socialLinks = JSON.parse(user.socialLinks || '{}');
			user.contactInfo = JSON.parse(user.contactInfo || '{}');

			// Create token
			const token = jwt.sign(
				{
					id: user.id,
					username: user.username,
					email: user.email,
					role: user.role || 'user',
				},
				getJwtSecret(),
				{ expiresIn: '7d' },
			);

			res.json({
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
					avatar: user.avatar,
					banner: user.banner,
					bio: user.bio,
					interests: user.interests,
					socialLinks: user.socialLinks,
					contactInfo: user.contactInfo,
					role: user.role || 'user',
					mustChangePassword: user.mustChangePassword || 0,
				},
			});
		} catch (error) {
			console.error('Login error:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

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
			const { currentPassword, newPassword } = req.body;

			if (!isStrongPassword(newPassword)) {
				return res.status(400).json({
					message:
						'Password must be at least 8 characters and include letters, numbers, and a special character',
				});
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

			const { updateUser } = await import('../models/User.js');
			updateUser(user.id, {
				password: hashedPassword,
				mustChangePassword: 0,
			});

			res.json({ message: 'Password updated', mustChangePassword: 0 });
		} catch (error) {
			console.error('Change password error:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

export default router;
