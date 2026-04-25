import db from '../database.js';

const notificationSelect = `
  SELECT
    n.id,
    n.userId,
    n.type,
    n.actorId,
    n.messageId,
    n.sourceMessageId,
    n.channelId,
    n.directUserId,
    n.reaction,
    n.isRead,
    n.createdAt,
    n.readAt,
    actor.username AS actorUsername,
    actor.avatar AS actorAvatar,
    c.name AS channelName,
    targetMessage.content AS targetMessageContent,
    targetMessage.fileName AS targetMessageFileName,
    targetMessage.fileType AS targetMessageFileType,
    targetMessage.isDeleted AS targetMessageIsDeleted,
    targetPoll.question AS targetPollQuestion
  FROM user_notifications n
  JOIN users actor ON actor.id = n.actorId
  LEFT JOIN channels c ON c.id = n.channelId
  LEFT JOIN messages targetMessage ON targetMessage.id = n.messageId
  LEFT JOIN polls targetPoll ON targetPoll.messageId = targetMessage.id
`;

const formatTargetPreview = (row) => {
  if (row.targetMessageIsDeleted) {
    return 'Deleted message';
  }

  const content = String(row.targetMessageContent || '').trim();
  if (content) {
    return content.length > 120 ? `${content.slice(0, 117)}...` : content;
  }

  if (row.targetPollQuestion) {
    return row.targetPollQuestion;
  }

  if (row.targetMessageFileType === 'image/gif') {
    return row.targetMessageFileName || 'GIF';
  }

  if (row.targetMessageFileName) {
    return row.targetMessageFileName;
  }

  return '';
};

const formatNotificationBody = (row) => {
  if (row.type === 'mention') {
    return `mentioned you in #${row.channelName || 'channel'}`;
  }

  if (row.type === 'reaction') {
    return `reacted to your message in #${row.channelName || 'channel'}`;
  }

  if (row.type === 'reply') {
    if (row.channelId) {
      return `replied to your message in #${row.channelName || 'channel'}`;
    }

    return 'replied to your message';
  }

  return 'sent you a notification';
};

const formatNotification = (row) => ({
  id: String(row.id),
  type: row.type,
  createdAt: row.createdAt,
  isRead: Boolean(row.isRead),
  readAt: row.readAt || null,
  actor: {
    id: String(row.actorId),
    username: row.actorUsername,
    avatar: row.actorAvatar || null,
  },
  messageId: String(row.messageId),
  sourceMessageId:
    row.sourceMessageId === null || row.sourceMessageId === undefined
      ? null
      : String(row.sourceMessageId),
  reaction: row.reaction || null,
  target: row.channelId
    ? {
        type: 'channel',
        id: String(row.channelId),
        label: row.channelName || 'channel',
      }
    : {
        type: 'dm',
        id: String(row.directUserId),
        label: row.actorUsername,
      },
  title: row.actorUsername,
  body: formatNotificationBody(row),
  preview: formatTargetPreview(row),
});

export const createUserNotification = ({
  userId,
  type,
  actorId,
  messageId,
  sourceMessageId = null,
  channelId = null,
  directUserId = null,
  reaction = null,
}) => {
  const result = db
    .prepare(
      `INSERT INTO user_notifications (
        userId,
        type,
        actorId,
        messageId,
        sourceMessageId,
        channelId,
        directUserId,
        reaction
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      type,
      actorId,
      messageId,
      sourceMessageId,
      channelId,
      directUserId,
      reaction,
    );

  return getNotificationById(result.lastInsertRowid, userId);
};

export const getNotificationById = (notificationId, userId) => {
  const row = db
    .prepare(`${notificationSelect} WHERE n.id = ? AND n.userId = ?`)
    .get(notificationId, userId);

  return row ? formatNotification(row) : null;
};

export const getNotificationsForUser = (userId, limit = 50) => {
  const rows = db
    .prepare(
      `${notificationSelect}
       WHERE n.userId = ?
       ORDER BY n.createdAt DESC, n.id DESC
       LIMIT ?`,
    )
    .all(userId, limit);

  return rows.map(formatNotification);
};

export const markNotificationRead = (notificationId, userId) => {
  db.prepare(
    `UPDATE user_notifications
     SET isRead = 1,
         readAt = COALESCE(readAt, CURRENT_TIMESTAMP)
     WHERE id = ? AND userId = ?`,
  ).run(notificationId, userId);

  return getNotificationById(notificationId, userId);
};
