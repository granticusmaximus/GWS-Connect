import { create } from 'zustand'

interface ThemeState {
    isDarkMode: boolean
    autoCloseSidebarOnSelect: boolean
    toggleTheme: () => boolean
    setTheme: (isDark: boolean) => void
    toggleAutoCloseSidebar: () => boolean
    setAutoCloseSidebar: (autoClose: boolean) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
    isDarkMode: localStorage.getItem('theme') === 'dark' ||
        (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches),

    autoCloseSidebarOnSelect: localStorage.getItem('autoCloseSidebarOnSelect') === 'true',

    toggleTheme: () => {
        let nextMode = false
        set((state) => {
            nextMode = !state.isDarkMode
            localStorage.setItem('theme', nextMode ? 'dark' : 'light')
            document.documentElement.classList.toggle('dark', nextMode)
            return { isDarkMode: nextMode }
        })
        return nextMode
    },

    setTheme: (isDark: boolean) => {
        localStorage.setItem('theme', isDark ? 'dark' : 'light')
        document.documentElement.classList.toggle('dark', isDark)
        set({ isDarkMode: isDark })
    },

    toggleAutoCloseSidebar: () => {
        let nextMode = false
        set((state) => {
            nextMode = !state.autoCloseSidebarOnSelect
            localStorage.setItem('autoCloseSidebarOnSelect', nextMode ? 'true' : 'false')
            return { autoCloseSidebarOnSelect: nextMode }
        })
        return nextMode
    },

    setAutoCloseSidebar: (autoClose: boolean) => {
        localStorage.setItem('autoCloseSidebarOnSelect', autoClose ? 'true' : 'false')
        set({ autoCloseSidebarOnSelect: autoClose })
    },
}))
