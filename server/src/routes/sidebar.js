import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { canAccessChannel } from '../models/Channel.js';
import { getUserRole } from '../middleware/roles.js';
import {
	getSidebarSectionsForUser,
	replaceSidebarSectionsForUser,
} from '../models/Sidebar.js';

const router = express.Router();

router.get('/sections', authenticateToken, (req, res) => {
	try {
		res.json(getSidebarSectionsForUser(req.user.id));
	} catch (error) {
		console.error('Sidebar sections load error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

router.put('/sections', authenticateToken, (req, res) => {
	try {
		const sections = Array.isArray(req.body?.sections) ? req.body.sections : [];
		const visibleSections = sections.map((section) => ({
			name: String(section?.name || '').trim(),
			channelIds: Array.isArray(section?.channelIds)
				? section.channelIds.filter((channelId) =>
						canAccessChannel(
							channelId,
							req.user.id,
							getUserRole(req.user.id),
						).allowed,
				  )
				: [],
		}));

		res.json(replaceSidebarSectionsForUser(req.user.id, visibleSections));
	} catch (error) {
		console.error('Sidebar sections save error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

export default router;
