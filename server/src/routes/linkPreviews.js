import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getLinkPreview } from '../services/linkPreview.js';

const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
	try {
		const rawUrl = String(req.query?.url || '').trim();
		if (!rawUrl) {
			return res.status(400).json({ message: 'URL is required' });
		}

		const preview = await getLinkPreview(rawUrl);
		return res.json(preview);
	} catch (error) {
		console.error('Link preview error:', error);
		return res.status(500).json({ message: 'Unable to load link preview' });
	}
});

export default router;
