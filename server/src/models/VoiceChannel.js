import db from '../database.js';
import { findVisibleChannelsForUser } from './Channel.js';

const syncVoiceChannels = () => {
	db.prepare(
		`INSERT OR IGNORE INTO voice_channels (channelId, createdBy)
     SELECT id, createdBy FROM channels`,
	).run();
};

export const listVoiceChannelsForUser = (userId, role, workspaceId = null) => {
	syncVoiceChannels();
	const visibleChannels = findVisibleChannelsForUser(userId, role, workspaceId);

	if (visibleChannels.length === 0) {
		return [];
	}

	const channelIds = visibleChannels.map((channel) => Number(channel.id));
	const placeholders = channelIds.map(() => '?').join(', ');
	const voiceRows = db
		.prepare(
			`SELECT vc.id, vc.channelId, vc.name, vc.createdBy, vc.createdAt
       FROM voice_channels vc
       WHERE vc.channelId IN (${placeholders})
       ORDER BY vc.channelId ASC`,
		)
		.all(...channelIds);
	const voiceByChannelId = new Map(
		voiceRows.map((row) => [String(row.channelId), row]),
	);

	return visibleChannels
		.map((channel) => {
			const voiceChannel = voiceByChannelId.get(String(channel.id));
			if (!voiceChannel) {
				return null;
			}

			return {
				id: String(voiceChannel.id),
				channelId: String(channel.id),
				name: voiceChannel.name || channel.name,
				description: channel.description || '',
				isPrivate: Boolean(channel.isPrivate),
			};
		})
		.filter(Boolean);
};

export const findVoiceChannelById = (voiceChannelId) => {
	syncVoiceChannels();
	const row = db
		.prepare(
			`SELECT
        vc.id,
        vc.channelId,
        vc.name,
        vc.createdBy,
        vc.createdAt,
        c.name AS channelName,
        c.description AS channelDescription,
        c.isPrivate
      FROM voice_channels vc
      JOIN channels c ON c.id = vc.channelId
      WHERE vc.id = ?`,
		)
		.get(voiceChannelId);

	if (!row) {
		return null;
	}

	return {
		id: String(row.id),
		channelId: String(row.channelId),
		name: row.name || row.channelName,
		description: row.channelDescription || '',
		isPrivate: Boolean(row.isPrivate),
		createdBy: String(row.createdBy),
		createdAt: row.createdAt,
	};
};
