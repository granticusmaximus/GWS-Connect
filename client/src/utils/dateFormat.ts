export type DateFormat = 'MDY' | 'DMY' | 'YMD'
export type TimeFormat = '12h' | '24h'

const getNumericDateParts = (date: Date) => {
    const parts = new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date)

    const lookup: Record<string, string> = {}
    parts.forEach((part) => {
        if (part.type !== 'literal') {
            lookup[part.type] = part.value
        }
    })

    return {
        year: lookup.year,
        month: lookup.month,
        day: lookup.day,
    }
}

export const formatDate = (date: Date, format: DateFormat) => {
    const { year, month, day } = getNumericDateParts(date)
    if (format === 'DMY') {
        return `${day}/${month}/${year}`
    }
    if (format === 'YMD') {
        return `${year}-${month}-${day}`
    }
    return `${month}/${day}/${year}`
}

export const formatTime = (date: Date, format: TimeFormat) =>
    date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: format === '12h',
    })

export const formatDateTime = (date: Date, dateFormat: DateFormat, timeFormat: TimeFormat) =>
    `${formatDate(date, dateFormat)} ${formatTime(date, timeFormat)}`
