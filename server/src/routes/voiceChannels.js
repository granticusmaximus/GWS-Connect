import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getUserRole } from '../middleware/roles.js';
import { listVoiceChannelsForUser } from '../models/VoiceChannel.js';
import { findUserById } from '../models/User.js';

const router = express.Router();

router.get('/', authenticateToken, (req, res) => {
	try {
		const voiceChannels = listVoiceChannelsForUser(
			req.user.id,
			getUserRole(req.user.id),
		);
		const callSessions = req.app.get('callSessions') || new Map();

		res.json(
			voiceChannels.map((voiceChannel) => {
				const session = callSessions.get(`voice:${voiceChannel.id}`);
				const participants = session
					? Array.from(session.participants.entries()).map(([userId, participant]) => {
							const user = findUserById(userId);
							return {
								userId: String(userId),
								username: participant.username,
								avatar: user?.avatar || null,
							};
						})
					: [];

				return {
					...voiceChannel,
					participants,
				};
			}),
		);
	} catch (error) {
		console.error('Voice channel list error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

export default router;
