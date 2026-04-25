import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getPollSummary, getPollById } from '../models/Poll.js';

const router = express.Router();

router.get('/:pollId', authenticateToken, (req, res) => {
	const pollId = req.params.pollId;
	const poll = getPollById(pollId);
	if (!poll) {
		return res.status(404).json({ message: 'Poll not found' });
	}

	const summary = getPollSummary(pollId, req.user.id, true);
	if (!summary) {
		return res.status(404).json({ message: 'Poll not found' });
	}

	if (poll.createdBy !== req.user.id) {
		return res.status(403).json({ message: 'Not allowed to view poll voters' });
	}

	return res.json(summary);
});

export default router;
