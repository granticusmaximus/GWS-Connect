const path = require('path');
const { spawn } = require('child_process');
const electronBinary = require('electron');

const appRoot = path.resolve(__dirname, '..');

const child = spawn(electronBinary, ['.'], {
	stdio: 'inherit',
	cwd: appRoot,
	env: {
		...process.env,
		GWS_CONNECT_DESKTOP_DEV: '1',
	},
});

child.once('exit', (code) => {
	process.exit(code ?? 0);
});
