import express from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

const GIPHY_API_KEY = process.env.GIPHY_API_KEY || '';

const buildGiphyUrl = (path, params) => {
	const searchParams = new URLSearchParams({
		api_key: GIPHY_API_KEY,
		...params,
	});
	return `https://api.giphy.com/v1/gifs/${path}?${searchParams.toString()}`;
};

const normalizeResults = (data) => {
	const results = Array.isArray(data?.data) ? data.data : [];
	return results
		.map((item) => {
			const images = item.images || {};
			const preview = images.fixed_width_small || images.fixed_height_small;
			const full = images.original || images.fixed_width || images.fixed_height;
			if (!full?.url) return null;
			return {
				id: item.id,
				title: item.title || 'GIF',
				url: full.url,
				previewUrl: preview?.url || full.url,
			};
		})
		.filter(Boolean);
};

router.get('/search', authenticateToken, async (req, res) => {
	try {
		if (!GIPHY_API_KEY) {
			return res.status(500).json({ message: 'GIPHY_API_KEY missing' });
		}

		const query = String(req.query.q || '').trim();
		if (!query) {
			return res.status(400).json({ message: 'Query required' });
		}

		const url = buildGiphyUrl('search', {
			q: query,
			limit: '24',
			rating: 'pg-13',
		});
		const response = await fetch(url);
		if (!response.ok) {
			return res.status(502).json({ message: 'Giphy request failed' });
		}
		const data = await response.json();
		return res.json({ results: normalizeResults(data) });
	} catch (error) {
		return res.status(500).json({ message: 'Server error' });
	}
});

router.get('/trending', authenticateToken, async (req, res) => {
	try {
		if (!GIPHY_API_KEY) {
			return res.status(500).json({ message: 'GIPHY_API_KEY missing' });
		}
		const url = buildGiphyUrl('trending', {
			limit: '24',
			rating: 'pg-13',
		});
		const response = await fetch(url);
		if (!response.ok) {
			return res.status(502).json({ message: 'Giphy request failed' });
		}
		const data = await response.json();
		return res.json({ results: normalizeResults(data) });
	} catch (error) {
		return res.status(500).json({ message: 'Server error' });
	}
});

export default router;
