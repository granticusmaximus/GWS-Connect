import { create } from 'zustand'

export type TimeFormat = '12h' | '24h'
export type DateFormat = 'MDY' | 'DMY' | 'YMD'

const TIME_FORMAT_STORAGE_KEY = 'timeFormat'
const TIME_FORMAT_MIGRATION_KEY = 'timeFormatMigratedTo24h'

interface PreferencesState {
    timeFormat: TimeFormat
    dateFormat: DateFormat
    setTimeFormat: (format: TimeFormat) => void
    toggleTimeFormat: () => void
    setDateFormat: (format: DateFormat) => void
}

const getInitialTimeFormat = (): TimeFormat => {
    const stored = localStorage.getItem(TIME_FORMAT_STORAGE_KEY)

    if (stored === '24h') {
        localStorage.setItem(TIME_FORMAT_MIGRATION_KEY, 'true')
        return '24h'
    }

    // Migrate legacy installs that defaulted to 12-hour time.
    if (stored === '12h' && localStorage.getItem(TIME_FORMAT_MIGRATION_KEY) !== 'true') {
        localStorage.setItem(TIME_FORMAT_STORAGE_KEY, '24h')
        localStorage.setItem(TIME_FORMAT_MIGRATION_KEY, 'true')
        return '24h'
    }

    if (stored === '12h') {
        return '12h'
    }

    localStorage.setItem(TIME_FORMAT_STORAGE_KEY, '24h')
    localStorage.setItem(TIME_FORMAT_MIGRATION_KEY, 'true')
    return '24h'
}

const getInitialDateFormat = (): DateFormat => {
    const stored = localStorage.getItem('dateFormat')
    if (stored === 'DMY' || stored === 'YMD') return stored
    return 'MDY'
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
    timeFormat: getInitialTimeFormat(),
    dateFormat: getInitialDateFormat(),

    setTimeFormat: (format) => {
        localStorage.setItem(TIME_FORMAT_STORAGE_KEY, format)
        localStorage.setItem(TIME_FORMAT_MIGRATION_KEY, 'true')
        set({ timeFormat: format })
    },

    toggleTimeFormat: () => {
        set((state) => {
            const next = state.timeFormat === '24h' ? '12h' : '24h'
            localStorage.setItem(TIME_FORMAT_STORAGE_KEY, next)
            localStorage.setItem(TIME_FORMAT_MIGRATION_KEY, 'true')
            return { timeFormat: next }
        })
    },

    setDateFormat: (format) => {
        localStorage.setItem('dateFormat', format)
        set({ dateFormat: format })
    },
}))
