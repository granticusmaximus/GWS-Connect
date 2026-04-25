/**
 * Mobile and responsive detection utilities
 */

/**
 * Check if the device is currently on a mobile/small screen
 * Uses the same breakpoint as Tailwind CSS (640px = sm breakpoint)
 */
export const isMobileDevice = (): boolean => {
    return window.innerWidth < 640; // sm breakpoint from tailwind.config.js
};

/**
 * Hook-compatible function to get mobile status with media query
 */
export const useIsMobile = (): boolean => {
    // Check if window is defined (for SSR compatibility)
    if (typeof window === 'undefined') return false;

    // Use matchMedia for more reliable detection
    const mediaQuery = window.matchMedia('(max-width: 639px)'); // sm breakpoint
    return mediaQuery.matches;
};
