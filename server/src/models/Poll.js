import db from '../database.js';

export const createPoll = (
	messageId,
	createdBy,
	question,
	expiresAt = null,
) => {
	const stmt = db.prepare(
		`INSERT INTO polls (messageId, createdBy, question, expiresAt)
     VALUES (?, ?, ?, ?)`,
	);
	const result = stmt.run(messageId, createdBy, question, expiresAt);
	return result.lastInsertRowid;
};

export const createPollOption = (pollId, optionText) => {
	const stmt = db.prepare(
		`INSERT INTO poll_options (pollId, optionText)
     VALUES (?, ?)`,
	);
	const result = stmt.run(pollId, optionText);
	return result.lastInsertRowid;
};

export const getPollByMessageId = (messageId) => {
	const stmt = db.prepare(
		`SELECT id, messageId, createdBy, question, expiresAt, createdAt
     FROM polls
     WHERE messageId = ?`,
	);
	return stmt.get(messageId);
};

export const getPollById = (pollId) => {
	const stmt = db.prepare(
		`SELECT id, messageId, createdBy, question, expiresAt, createdAt
     FROM polls
     WHERE id = ?`,
	);
	return stmt.get(pollId);
};

export const getPollOptions = (pollId) => {
	const stmt = db.prepare(
		`SELECT id, optionText
     FROM poll_options
     WHERE pollId = ?
     ORDER BY id ASC`,
	);
	return stmt.all(pollId);
};

export const getPollVoteCounts = (pollId) => {
	const stmt = db.prepare(
		`SELECT optionId, COUNT(*) as count
     FROM poll_votes
     WHERE pollId = ?
     GROUP BY optionId`,
	);
	const rows = stmt.all(pollId);
	return rows.reduce((acc, row) => {
		acc[row.optionId] = row.count;
		return acc;
	}, {});
};

export const getUserVoteOptionId = (pollId, userId) => {
	const stmt = db.prepare(
		`SELECT optionId
     FROM poll_votes
     WHERE pollId = ? AND userId = ?`,
	);
	const row = stmt.get(pollId, userId);
	return row?.optionId || null;
};

export const getPollVotersByOption = (pollId) => {
	const stmt = db.prepare(
		`SELECT pv.optionId, u.id as userId, u.username, u.avatar
     FROM poll_votes pv
     JOIN users u ON pv.userId = u.id
     WHERE pv.pollId = ?
     ORDER BY pv.optionId ASC, u.username ASC`,
	);
	const rows = stmt.all(pollId);
	return rows.reduce((acc, row) => {
		if (!acc[row.optionId]) acc[row.optionId] = [];
		acc[row.optionId].push({
			id: row.userId,
			username: row.username,
			avatar: row.avatar,
		});
		return acc;
	}, {});
};

export const upsertPollVote = (pollId, optionId, userId) => {
	const stmt = db.prepare(
		`INSERT INTO poll_votes (pollId, optionId, userId)
     VALUES (?, ?, ?)
     ON CONFLICT(pollId, userId) DO UPDATE SET optionId = excluded.optionId`,
	);
	stmt.run(pollId, optionId, userId);
};

export const getPollSummary = (pollId, viewerId, includeVoters = false) => {
	const poll = getPollById(pollId);
	if (!poll) return null;

	const options = getPollOptions(pollId);
	const counts = getPollVoteCounts(pollId);
	const userVoteOptionId = viewerId
		? getUserVoteOptionId(pollId, viewerId)
		: null;
	const votersByOption =
		includeVoters && viewerId === poll.createdBy
			? getPollVotersByOption(pollId)
			: {};

	const formattedOptions = options.map((option) => ({
		id: option.id.toString(),
		text: option.optionText,
		count: counts[option.id] || 0,
		voters: votersByOption[option.id] || [],
	}));

	return {
		id: poll.id.toString(),
		question: poll.question,
		createdBy: poll.createdBy,
		expiresAt: poll.expiresAt,
		createdAt: poll.createdAt,
		options: formattedOptions,
		userVoteOptionId: userVoteOptionId ? userVoteOptionId.toString() : null,
	};
};
