import { useEffect, useState } from 'react'
import { resolveAttachment, type ResolvedAttachment } from '../store/chatStore'

interface AttachmentLike {
    id: string
    fileUrl?: string | null
    fileName?: string | null
    fileType?: string | null
    fileIv?: string | null
    cipherIv?: string | null
    isEncrypted?: number | boolean
    keyGeneration?: number | null
}

interface AttachmentContext {
    channelId?: string | null
    recipientId?: string | null
    groupChatId?: string | null
}

export const useDecryptedAttachment = (item: AttachmentLike | null | undefined, context: AttachmentContext = {}) => {
    const [resolved, setResolved] = useState<ResolvedAttachment | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!item?.fileUrl) {
            setResolved(null)
            setError(null)
            return
        }

        let cancelled = false
        setLoading(true)
        setError(null)

        resolveAttachment(item, context)
            .then((result) => {
                if (!cancelled) setResolved(result)
            })
            .catch((err) => {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load attachment')
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })

        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item?.id, item?.fileUrl, item?.isEncrypted, item?.keyGeneration, context.channelId, context.recipientId, context.groupChatId])

    return { url: resolved?.url ?? '', name: resolved?.name ?? '', type: resolved?.type ?? '', loading, error }
}
