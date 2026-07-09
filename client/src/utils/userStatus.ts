export interface CustomStatusLike {
    statusEmoji?: string | null
    statusText?: string | null
    statusClearsAt?: string | null
}

export const getActiveCustomStatus = (value?: CustomStatusLike | null) => {
    if (!value) {
        return null
    }

    const statusEmoji = typeof value.statusEmoji === 'string' ? value.statusEmoji.trim() : ''
    const statusText = typeof value.statusText === 'string' ? value.statusText.trim() : ''

    if (!statusEmoji && !statusText) {
        return null
    }

    if (value.statusClearsAt) {
        const clearsAt = new Date(value.statusClearsAt).getTime()
        if (Number.isNaN(clearsAt) || clearsAt <= Date.now()) {
            return null
        }
    }

    return {
        statusEmoji: statusEmoji || null,
        statusText: statusText || null,
        statusClearsAt: value.statusClearsAt || null,
    }
}

export const formatStatusForDisplay = (value?: CustomStatusLike | null) => {
    const status = getActiveCustomStatus(value)
    if (!status) {
        return null
    }

    return [status.statusEmoji, status.statusText].filter(Boolean).join(' ')
}

export const toDateTimeLocalValue = (isoString?: string | null) => {
    if (!isoString) {
        return ''
    }

    const date = new Date(isoString)
    if (Number.isNaN(date.getTime())) {
        return ''
    }

    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')

    return `${year}-${month}-${day}T${hours}:${minutes}`
}
