interface ReplyLike {
  content?: string | null
  fileName?: string | null
  fileType?: string | null
  pollQuestion?: string | null
  poll?: {
    question?: string
  } | null
  isDeleted?: number | boolean
  isEncrypted?: number | boolean
}

export const getReplyPreviewText = (message: ReplyLike | null | undefined) => {
  if (!message) return 'Original message unavailable'
  if (message.isDeleted === 1 || message.isDeleted === true) return 'Original message deleted'
  if (message.isEncrypted === 1 || message.isEncrypted === true) return 'Encrypted message'

  const pollQuestion = message.poll?.question || message.pollQuestion
  if (pollQuestion) return `Poll: ${pollQuestion}`
  if (message.fileType?.startsWith('image/')) return message.fileName || 'Image'
  if (message.fileType?.startsWith('video/')) return message.fileName || 'Video'
  if (message.fileName) return message.fileName

  const trimmedContent = String(message.content || '').trim()
  if (trimmedContent) return trimmedContent

  return 'Message unavailable'
}

export const getThreadKey = (threadRootMessageId?: string | null) =>
  threadRootMessageId || null
