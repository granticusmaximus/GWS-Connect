const { app, BrowserWindow, dialog, nativeImage, shell } = require('electron');
const { mkdirSync } = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');

const isDev = process.env.GWS_CONNECT_DESKTOP_DEV === '1';
const devClientUrl =
	process.env.GWS_CONNECT_DEV_CLIENT_URL || 'http://localhost:5173';
const devServerUrl =
	process.env.GWS_CONNECT_DEV_SERVER_URL || 'http://localhost:3001';
const desktopServerPort = Number(process.env.GWS_CONNECT_DESKTOP_PORT || 3001);
const appRoot = path.resolve(__dirname, '..');

let mainWindow = null;
let serverProcess = null;
let isAppQuitting = false;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const requestUrl = (targetUrl) =>
	new Promise((resolve, reject) => {
		const transport = targetUrl.startsWith('https:') ? https : http;
		const request = transport.get(targetUrl, (response) => {
			response.resume();
			resolve(response.statusCode || 0);
		});

		request.on('error', reject);
		request.setTimeout(1500, () => {
			request.destroy(new Error(`Timeout waiting for ${targetUrl}`));
		});
	});

const waitForUrl = async (targetUrl, timeoutMs = 45000) => {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		try {
			await requestUrl(targetUrl);
			return;
		} catch {
			await wait(350);
		}
	}

	throw new Error(`Timed out waiting for ${targetUrl}`);
};

const getAppRoot = () => {
	if (app.isPackaged) {
		return process.resourcesPath;
	}

	return appRoot;
};

const getDesktopPaths = () => {
	const userDataDir = path.join(app.getPath('userData'), 'desktop-runtime');
	const dataDir = path.join(userDataDir, 'data');
	const uploadsDir = path.join(userDataDir, 'uploads');

	mkdirSync(dataDir, { recursive: true });
	mkdirSync(uploadsDir, { recursive: true });

	return {
		dataDir,
		uploadsDir,
		dbPath: path.join(dataDir, 'gws-connect.db'),
		clientDist: path.join(getAppRoot(), 'client', 'dist'),
		serverEntry: path.join(getAppRoot(), 'server', 'src', 'index.js'),
	};
};

const getDesktopIconPath = () => {
	if (app.isPackaged) {
		return path.join(getAppRoot(), 'client', 'dist', 'pwa-512.png');
	}

	return path.join(getAppRoot(), 'client', 'public', 'pwa-512.png');
};

const startDesktopServer = () => {
	if (isDev || serverProcess) {
		return;
	}

	const desktopPaths = getDesktopPaths();
	serverProcess = spawn(process.execPath, [desktopPaths.serverEntry], {
		env: {
			...process.env,
			ELECTRON_RUN_AS_NODE: '1',
			NODE_ENV: 'production',
			PORT: String(desktopServerPort),
			CLIENT_URL: `http://127.0.0.1:${desktopServerPort},${devClientUrl}`,
			DESKTOP_CLIENT_DIST: desktopPaths.clientDist,
			DB_PATH: desktopPaths.dbPath,
			UPLOADS_DIR: desktopPaths.uploadsDir,
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});

	serverProcess.stdout.on('data', (chunk) => {
		process.stdout.write(`[desktop-server] ${chunk}`);
	});

	serverProcess.stderr.on('data', (chunk) => {
		process.stderr.write(`[desktop-server] ${chunk}`);
	});

	serverProcess.once('exit', (code) => {
		if (isAppQuitting) {
			return;
		}

		const message = `The local GWS Connect server stopped unexpectedly (exit code ${code ?? 'unknown'}).`;
		dialog.showErrorBox('GWS Connect', message);
		serverProcess = null;
	});
};

const stopDesktopServer = () => {
	if (!serverProcess) {
		return;
	}

	const activeProcess = serverProcess;
	serverProcess = null;
	activeProcess.kill('SIGTERM');
	setTimeout(() => {
		if (activeProcess.exitCode === null && activeProcess.signalCode === null) {
			activeProcess.kill('SIGKILL');
		}
	}, 2500);
};

const createWindow = async () => {
	const iconPath = getDesktopIconPath();

	if (process.platform === 'darwin' && app.dock) {
		app.dock.setIcon(nativeImage.createFromPath(iconPath));
	}

	mainWindow = new BrowserWindow({
		width: 1440,
		height: 920,
		minWidth: 1120,
		minHeight: 760,
		backgroundColor: '#f3f4f6',
		show: false,
		title: 'GWS Connect',
		autoHideMenuBar: true,
		icon: iconPath,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			preload: path.join(__dirname, 'preload.cjs'),
		},
	});

	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: 'deny' };
	});

	mainWindow.once('ready-to-show', () => {
		mainWindow?.show();
	});

	if (isDev) {
		await Promise.all([
			waitForUrl(devServerUrl),
			waitForUrl(devClientUrl),
		]);
		await mainWindow.loadURL(devClientUrl);
		mainWindow.webContents.openDevTools({ mode: 'detach' });
		return;
	}

	startDesktopServer();
	const desktopUrl = `http://127.0.0.1:${desktopServerPort}`;
	await waitForUrl(desktopUrl);
	await mainWindow.loadURL(desktopUrl);
};

const boot = async () => {
	try {
		await createWindow();
	} catch (error) {
		dialog.showErrorBox(
			'GWS Connect',
			error instanceof Error ? error.message : 'Failed to start the desktop app.',
		);
		app.quit();
	}
};

app.setName('GWS Connect');

if (typeof app.setAppUserModelId === 'function') {
	app.setAppUserModelId('net.gwsapp.connect');
}

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on('second-instance', () => {
		if (!mainWindow) {
			return;
		}

		if (mainWindow.isMinimized()) {
			mainWindow.restore();
		}
		mainWindow.focus();
	});

	app.whenReady().then(boot);
}

app.on('activate', () => {
	if (BrowserWindow.getAllWindows().length === 0) {
		void boot();
	}
});

app.on('before-quit', () => {
	isAppQuitting = true;
	stopDesktopServer();
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});
