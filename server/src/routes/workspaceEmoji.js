import path from 'path';
import { mkdirSync, unlink } from 'fs';
import { fileURLToPath } from 'url';
import express from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/roles.js';
import {
	createWorkspaceEmoji,
	deleteWorkspaceEmoji,
	findWorkspaceEmojiById,
	listWorkspaceEmoji,
} from '../models/WorkspaceEmoji.js';
import { logAuditEvent } from '../services/auditLog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, '..', '..', 'uploads', 'workspace-emoji');

mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
	destination: uploadsDir,
	filename: (req, file, cb) => {
		const ext = path.extname(file.originalname || '');
		cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
	},
});

const upload = multer({
	storage,
	limits: { fileSize: 2 * 1024 * 1024 },
});

const router = express.Router();

const normalizeEmojiName = (value) =>
	String(value || '')
		.trim()
		.toLowerCase();

router.get('/:emojiId/file', (req, res) => {
	try {
		const emoji = findWorkspaceEmojiById(req.params.emojiId);
		if (!emoji) {
			return res.status(404).json({ message: 'Emoji not found' });
		}

		return res.sendFile(path.join(uploadsDir, emoji.filePath));
	} catch (error) {
		console.error('Workspace emoji file error:', error);
		return res.status(500).json({ message: 'Server error' });
	}
});

router.get('/', authenticateToken, (req, res) => {
	try {
		res.json(listWorkspaceEmoji());
	} catch (error) {
		console.error('Workspace emoji list error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

router.post(
	'/',
	authenticateToken,
	requireAdmin,
	upload.single('file'),
	(req, res) => {
		try {
			const name = normalizeEmojiName(req.body?.name);
			if (!/^[a-z0-9_+\-]{2,32}$/.test(name)) {
				return res.status(400).json({
					message:
						'Emoji name must be 2-32 characters and use lowercase letters, numbers, +, -, or _',
				});
			}

			if (!req.file || !req.file.mimetype.startsWith('image/')) {
				return res.status(400).json({ message: 'Image file required' });
			}

			const emoji = createWorkspaceEmoji(
				name,
				req.file.filename,
				req.file.mimetype,
				req.user.id,
			);
			logAuditEvent({
				actorId: req.user.id,
				action: 'workspace-emoji.create',
				targetType: 'workspace-emoji',
				targetId: emoji.id,
				metadata: { name: emoji.name },
			});

			return res.status(201).json(emoji);
		} catch (error) {
			console.error('Workspace emoji create error:', error);
			if (String(error?.code || '').includes('SQLITE_CONSTRAINT')) {
				return res.status(409).json({ message: 'Emoji name already exists' });
			}
			return res.status(500).json({ message: 'Server error' });
		}
	},
);

router.delete('/:emojiId', authenticateToken, requireAdmin, (req, res) => {
	try {
		const emoji = findWorkspaceEmojiById(req.params.emojiId);
		if (!emoji) {
			return res.status(404).json({ message: 'Emoji not found' });
		}

		deleteWorkspaceEmoji(req.params.emojiId);
		logAuditEvent({
			actorId: req.user.id,
			action: 'workspace-emoji.delete',
			targetType: 'workspace-emoji',
			targetId: emoji.id,
			metadata: { name: emoji.name },
		});
		unlink(path.join(uploadsDir, emoji.filePath), () => {});

		return res.json({ ok: true });
	} catch (error) {
		console.error('Workspace emoji delete error:', error);
		return res.status(500).json({ message: 'Server error' });
	}
});

export default router;
