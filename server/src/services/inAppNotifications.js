import { createUserNotification } from '../models/Notification.js';

export const createAndEmitNotification = (io, params) => {
  if (!io) {
    return null;
  }

  if (String(params.userId) === String(params.actorId)) {
    return null;
  }

  const notification = createUserNotification(params);
  if (!notification) {
    return null;
  }

  io.to(String(params.userId)).emit('notification:new', notification);
  return notification;
};

export const createMentionNotifications = (
  io,
  { actorId, mentionedUserIds, messageId, channelId },
) => {
  const uniqueUserIds = [...new Set((mentionedUserIds || []).map(String))];

  uniqueUserIds.forEach((userId) => {
    createAndEmitNotification(io, {
      userId,
      type: 'mention',
      actorId,
      messageId,
      channelId,
    });
  });
};

export const createReplyNotification = (
  io,
  { actorId, replyRecipientUserId, messageId, sourceMessageId, channelId, directUserId },
) => {
  return createAndEmitNotification(io, {
    userId: replyRecipientUserId,
    type: 'reply',
    actorId,
    messageId,
    sourceMessageId,
    channelId: channelId || null,
    directUserId: directUserId || null,
  });
};

export const createReactionNotification = (
  io,
  {
    actorId,
    notificationUserId,
    messageId,
    sourceMessageId,
    channelId,
    reaction,
  },
) =>
  createAndEmitNotification(io, {
    userId: notificationUserId,
    type: 'reaction',
    actorId,
    messageId,
    sourceMessageId,
    channelId,
    reaction,
  });
