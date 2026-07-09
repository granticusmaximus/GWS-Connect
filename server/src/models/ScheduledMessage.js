import db from '../database.js';

export const createScheduledMessage = ({
	userId,
	channelId = null,
	recipientId = null,
	groupChatId = null,
	content = '',
	cipherText = null,
	cipherIv = null,
	isEncrypted = 0,
	keyGeneration = null,
	replyToMessageId = null,
	threadRootMessageId = null,
	deliverAt,
}) => {
	const result = db
		.prepare(
			`INSERT INTO scheduled_messages (
        userId,
        channelId,
        recipientId,
        groupChatId,
        content,
        cipherText,
        cipherIv,
        isEncrypted,
        keyGeneration,
        replyToMessageId,
        threadRootMessageId,
        deliverAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			userId,
			channelId,
			recipientId,
			groupChatId,
			content,
			cipherText,
			cipherIv,
			isEncrypted ? 1 : 0,
			keyGeneration,
			replyToMessageId,
			threadRootMessageId,
			deliverAt,
		);

	return String(result.lastInsertRowid);
};

export const getDueScheduledMessages = (limit = 20) =>
	db
		.prepare(
			`SELECT *
       FROM scheduled_messages
       WHERE status = 'pending'
         AND datetime(deliverAt) <= datetime('now')
       ORDER BY datetime(deliverAt) ASC, id ASC
       LIMIT ?`,
		)
		.all(limit);

export const markScheduledMessageSent = (scheduledMessageId, sentMessageId) => {
	db.prepare(
		`UPDATE scheduled_messages
       SET status = 'sent',
           sentMessageId = ?,
           sentAt = CURRENT_TIMESTAMP,
           errorMessage = NULL
       WHERE id = ?`,
	).run(sentMessageId, scheduledMessageId);
};

export const markScheduledMessageFailed = (scheduledMessageId, errorMessage) => {
	db.prepare(
		`UPDATE scheduled_messages
       SET status = 'failed',
           errorMessage = ?,
           sentAt = CURRENT_TIMESTAMP
       WHERE id = ?`,
	).run(String(errorMessage || 'Failed to deliver scheduled message'), scheduledMessageId);
};
