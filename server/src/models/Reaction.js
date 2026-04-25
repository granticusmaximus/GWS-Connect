import db from '../database.js';

export const REACTION_EMOJIS = {
	like: '👍',
	love: '❤️',
	dislike: '👎',
	happy: '😄',
	sad: '😢',
	mad: '😡',
};

const REACTIONS = Object.keys(REACTION_EMOJIS);

export const isValidReaction = (reaction) => REACTIONS.includes(reaction);

export const getMessageReactions = (
	messageId,
	viewerId,
	includeViewer = true,
) => {
	const counts = db
		.prepare(
			`SELECT reaction, COUNT(*) as count
       FROM message_reactions
       WHERE messageId = ?
       GROUP BY reaction`,
		)
		.all(messageId);

	const viewerRows =
		viewerId && includeViewer
			? db
					.prepare(
						`SELECT reaction
           FROM message_reactions
           WHERE messageId = ? AND userId = ?`,
					)
					.all(messageId, viewerId)
			: [];

	const viewerSet = new Set(viewerRows.map((row) => row.reaction));
	const countMap = counts.reduce((acc, row) => {
		acc[row.reaction] = row.count;
		return acc;
	}, {});

	return REACTIONS.map((reaction) => {
		const entry = {
			type: reaction,
			emoji: REACTION_EMOJIS[reaction],
			count: countMap[reaction] || 0,
		};
		if (includeViewer && viewerId) {
			return { ...entry, reacted: viewerSet.has(reaction) };
		}
		return entry;
	}).filter((entry) => entry.count > 0 || entry.reacted);
};

export const addReaction = (messageId, userId, reaction) => {
	db.prepare(
		`INSERT INTO message_reactions (messageId, userId, reaction)
     VALUES (?, ?, ?)`,
	).run(messageId, userId, reaction);
};

export const removeReaction = (messageId, userId, reaction) => {
	db.prepare(
		`DELETE FROM message_reactions
     WHERE messageId = ? AND userId = ? AND reaction = ?`,
	).run(messageId, userId, reaction);
};

export const hasReaction = (messageId, userId, reaction) => {
	const row = db
		.prepare(
			`SELECT 1 FROM message_reactions
       WHERE messageId = ? AND userId = ? AND reaction = ?`,
		)
		.get(messageId, userId, reaction);
	return !!row;
};

export const toggleReaction = (messageId, userId, reaction) => {
	if (hasReaction(messageId, userId, reaction)) {
		removeReaction(messageId, userId, reaction);
		return false;
	}
	addReaction(messageId, userId, reaction);
	return true;
};
