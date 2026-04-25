/** @type {import('tailwindcss').Config} */
export default {
	content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
	darkMode: 'class',
	theme: {
		extend: {
			colors: {
				primary: {
					50: '#FEF2F2',
					100: '#FEE2E2',
					200: '#FECACA',
					300: '#FCA5A5',
					400: '#F87171',
					500: '#EF4444',
					600: '#DC2626',
					700: '#B91C1C',
					800: '#991B1B',
					900: '#7F1D1D',
					950: '#450A0A',
				},
			},
			spacing: {
				safe: 'env(safe-area-inset-bottom)',
				'safe-t': 'env(safe-area-inset-top)',
				'safe-l': 'env(safe-area-inset-left)',
				'safe-r': 'env(safe-area-inset-right)',
			},
			minHeight: {
				touch: '44px',
				'screen-safe': 'calc(100vh - env(safe-area-inset-bottom))',
			},
			minWidth: {
				touch: '44px',
			},
			fontSize: {
				'touch-sm': ['0.875rem', { lineHeight: '1.25rem' }],
				'touch-base': ['1rem', { lineHeight: '1.5rem' }],
				'touch-lg': ['1.125rem', { lineHeight: '1.75rem' }],
			},
			maxWidth: {
				'screen-sm': '540px',
				'screen-md': '720px',
				'screen-lg': '960px',
				'screen-xl': '1140px',
			},
		},
	},
	plugins: [
		function ({ addUtilities }) {
			addUtilities({
				'.safe-area': {
					paddingBottom: 'env(safe-area-inset-bottom)',
					paddingLeft: 'env(safe-area-inset-left)',
					paddingRight: 'env(safe-area-inset-right)',
				},
				'.safe-area-top': {
					paddingTop: 'env(safe-area-inset-top)',
				},
				'.no-scrollbar': {
					'-ms-overflow-style': 'none',
					'scrollbar-width': 'none',
					'&::-webkit-scrollbar': {
						display: 'none',
					},
				},
				'.tap-highlight-none': {
					'-webkit-tap-highlight-color': 'transparent',
				},
				'.touch-device-friendly': {
					minWidth: '44px',
					minHeight: '44px',
					padding: '12px',
				},
				'.text-balance': {
					'text-wrap': 'balance',
				},
				'.smooth-scroll': {
					'scroll-behavior': 'smooth',
				},
			});
		},
	],
};
