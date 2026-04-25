import sharp from 'sharp';

const conversionTasks = [
	{
		input: 'public/gws-connect-favicon.svg',
		output: 'public/favicon-180.png',
		size: 180,
	},
	{
		input: 'public/gws-connect-favicon.svg',
		output: 'public/favicon-192.png',
		size: 192,
	},
	{ input: 'public/pwa-192.svg', output: 'public/pwa-192.png', size: 192 },
	{ input: 'public/pwa-512.svg', output: 'public/pwa-512.png', size: 512 },
];

async function convertIcons() {
	for (const task of conversionTasks) {
		try {
			console.log(
				`Converting ${task.input} to ${task.output} (${task.size}x${task.size})...`,
			);
			await sharp(task.input)
				.resize(task.size, task.size, {
					fit: 'contain',
					background: { r: 255, g: 255, b: 255, alpha: 1 },
				})
				.png()
				.toFile(task.output);
			console.log(`✓ Created ${task.output}`);
		} catch (error) {
			console.error(`✗ Failed to convert ${task.input}:`, error.message);
		}
	}
	console.log('\nIcon conversion complete!');
}

convertIcons();
