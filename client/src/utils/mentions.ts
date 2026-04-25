export interface MessageMention {
    userId: string
    username: string
    avatar?: string | null
    startIndex: number
    endIndex: number
}

// Parse mentions from text and return parts with mention metadata
export interface MentionPart {
    type: 'text' | 'mention'
    content: string
    userId?: string
    username?: string
    avatar?: string | null
}

const mentionRegex = /@([A-Za-z0-9._-]+)/g

export function parseMentions(text: string, mentions: MessageMention[] = []): MentionPart[] {
    if (!text) return []

    const normalizedMentions = mentions
        .filter((mention) =>
            mention.startIndex >= 0 &&
            mention.endIndex > mention.startIndex &&
            mention.endIndex <= text.length,
        )
        .sort((left, right) => left.startIndex - right.startIndex)

    if (normalizedMentions.length > 0) {
        const parts: MentionPart[] = []
        let lastIndex = 0

        for (const mention of normalizedMentions) {
            if (mention.startIndex < lastIndex) {
                continue
            }

            if (mention.startIndex > lastIndex) {
                parts.push({
                    type: 'text',
                    content: text.slice(lastIndex, mention.startIndex),
                })
            }

            parts.push({
                type: 'mention',
                content: text.slice(mention.startIndex, mention.endIndex),
                userId: mention.userId,
                username: mention.username,
                avatar: mention.avatar,
            })

            lastIndex = mention.endIndex
        }

        if (lastIndex < text.length) {
            parts.push({
                type: 'text',
                content: text.slice(lastIndex),
            })
        }

        return parts.length > 0 ? parts : [{ type: 'text', content: text }]
    }

    const parts: MentionPart[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null

    mentionRegex.lastIndex = 0

    while ((match = mentionRegex.exec(text)) !== null) {
        // Add text before mention
        if (match.index > lastIndex) {
            parts.push({
                type: 'text',
                content: text.slice(lastIndex, match.index),
            })
        }

        // Add mention
        parts.push({
            type: 'mention',
            content: match[0], // Full match: @username
            username: match[1], // Captured group: username
        })

        lastIndex = mentionRegex.lastIndex
    }

    // Add remaining text
    if (lastIndex < text.length) {
        parts.push({
            type: 'text',
            content: text.slice(lastIndex),
        })
    }

    return parts.length > 0 ? parts : [{ type: 'text', content: text }]
}

// Extract @mentions from text
export function extractMentions(text: string): string[] {
    const mentions: string[] = []
    let match: RegExpExecArray | null

    mentionRegex.lastIndex = 0

    while ((match = mentionRegex.exec(text)) !== null) {
        mentions.push(match[1])
    }

    return mentions
}

// Check if text contains any mentions
export function hasMentions(text: string): boolean {
    mentionRegex.lastIndex = 0
    return mentionRegex.test(text)
}
