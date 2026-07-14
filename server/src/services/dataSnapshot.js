import crypto from 'crypto';
import { createReadStream } from 'fs';
import {
	copyFile,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from 'fs/promises';
import os from 'os';
import path from 'path';
import { c as tarCreate, x as tarExtract } from 'tar';
import { getDatabasePath, reloadDatabase } from '../database.js';

const DEFAULT_BUNDLE_NAME = 'gws-connect-data-snapshot.tar.gz';

const getUploadsDirectory = () =>
	path.resolve(path.dirname(getDatabasePath()), '..', 'uploads');

const getBackupRoot = () =>
	path.join(path.dirname(getDatabasePath()), 'backups');

const hashFile = (filePath) =>
	new Promise((resolve, reject) => {
		const hash = crypto.createHash('sha256');
		const stream = createReadStream(filePath);

		stream.on('data', (chunk) => hash.update(chunk));
		stream.on('end', () => resolve(hash.digest('hex')));
		stream.on('error', reject);
	});

const safeReadJson = async (filePath) => {
	try {
		return JSON.parse(await readFile(filePath, 'utf8'));
	} catch {
		return null;
	}
};

const copyDirectoryContents = async (sourceDir, targetDir) => {
	await mkdir(targetDir, { recursive: true });

	let entries = [];
	try {
		entries = await readdir(sourceDir, { withFileTypes: true });
	} catch (error) {
		if (error?.code === 'ENOENT') {
			return;
		}

		throw error;
	}

	for (const entry of entries) {
		const sourcePath = path.join(sourceDir, entry.name);
		const targetPath = path.join(targetDir, entry.name);

		if (entry.isDirectory()) {
			await mkdir(targetPath, { recursive: true });
			await copyDirectoryContents(sourcePath, targetPath);
			continue;
		}

		if (entry.isFile()) {
			await copyFile(sourcePath, targetPath);
		}
	}
};

const buildManifest = ({ source }) => ({
	schemaVersion: 1,
	bundleType: 'gws-connect-data-snapshot',
	createdAt: new Date().toISOString(),
	source,
	databasePath: path.basename(getDatabasePath()),
	uploadsPath: path.basename(getUploadsDirectory()),
	commitSha:
		process.env.GITHUB_SHA ||
		process.env.COMMIT_SHA ||
		process.env.VCS_REF ||
		process.env.SOURCE_REVISION ||
		null,
});

export const buildDataSnapshotBundle = async ({
	source = 'local-admin',
} = {}) => {
	const workspaceRoot = await mkdtemp(
		path.join(os.tmpdir(), 'gws-connect-snapshot-'),
	);
	const payloadRoot = path.join(workspaceRoot, 'payload');
	const databaseDir = path.join(payloadRoot, 'database');
	const uploadsDir = path.join(payloadRoot, 'uploads');
	const bundlePath = path.join(workspaceRoot, DEFAULT_BUNDLE_NAME);
	const manifestPath = path.join(payloadRoot, 'manifest.json');
	const manifest = buildManifest({ source });

	await mkdir(databaseDir, { recursive: true });
	await mkdir(uploadsDir, { recursive: true });
	await copyFile(
		getDatabasePath(),
		path.join(databaseDir, path.basename(getDatabasePath())),
	);
	await copyDirectoryContents(getUploadsDirectory(), uploadsDir);
	await mkdir(payloadRoot, { recursive: true });
	await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
	await tarCreate({ gzip: true, file: bundlePath, cwd: payloadRoot }, [
		'manifest.json',
		'database',
		'uploads',
	]);

	const checksum = await hashFile(bundlePath);

	return {
		bundlePath,
		bundleName: DEFAULT_BUNDLE_NAME,
		checksum,
		manifest,
		workspaceRoot,
	};
};

export const cleanupSnapshotWorkspace = async (workspaceRoot) => {
	if (!workspaceRoot) {
		return;
	}

	await rm(workspaceRoot, { recursive: true, force: true });
};

export const applyDataSnapshotBundle = async ({ bundlePath }) => {
	const workspaceRoot = await mkdtemp(
		path.join(os.tmpdir(), 'gws-connect-import-'),
	);
	const liveDbPath = getDatabasePath();
	const liveUploadsPath = getUploadsDirectory();
	const extractedDatabasePath = path.join(
		workspaceRoot,
		'database',
		path.basename(liveDbPath),
	);
	const extractedUploadsPath = path.join(workspaceRoot, 'uploads');
	const manifestPath = path.join(workspaceRoot, 'manifest.json');
	const backupRoot = path.join(
		getBackupRoot(),
		`sync-${new Date().toISOString().replace(/[:.]/g, '-')}`,
	);
	const backupDatabaseDir = path.join(backupRoot, 'database');
	const backupUploadsDir = path.join(backupRoot, 'uploads');
	const replacementDbPath = `${liveDbPath}.next`;

	try {
		await tarExtract({ file: bundlePath, cwd: workspaceRoot });

		const manifest = await safeReadJson(manifestPath);
		if (!manifest || manifest.bundleType !== 'gws-connect-data-snapshot') {
			throw new Error('Invalid data snapshot manifest');
		}

		await mkdir(backupDatabaseDir, { recursive: true });
		await mkdir(backupUploadsDir, { recursive: true });

		try {
			await copyFile(
				liveDbPath,
				path.join(backupDatabaseDir, path.basename(liveDbPath)),
			);
		} catch (error) {
			if (error?.code !== 'ENOENT') {
				throw error;
			}
		}

		await copyDirectoryContents(liveUploadsPath, backupUploadsDir);

		await copyFile(extractedDatabasePath, replacementDbPath);
		await rename(replacementDbPath, liveDbPath);

		await rm(liveUploadsPath, { recursive: true, force: true });
		await mkdir(liveUploadsPath, { recursive: true });
		await copyDirectoryContents(extractedUploadsPath, liveUploadsPath);

		reloadDatabase(liveDbPath);

		return {
			manifest,
			backupRoot,
			liveDbPath,
			liveUploadsPath,
		};
	} finally {
		await rm(workspaceRoot, { recursive: true, force: true });
	}
};

export const pushDataSnapshotToProduction = async () => {
	const productionBaseUrl = (process.env.PRODUCTION_SYNC_URL || '')
		.trim()
		.replace(/\/+$/, '');
	const sharedSecret = (process.env.DATA_SYNC_SHARED_SECRET || '').trim();

	if (!productionBaseUrl) {
		throw new Error(
			'PRODUCTION_SYNC_URL is required to push data to production',
		);
	}

	if (!sharedSecret) {
		throw new Error(
			'DATA_SYNC_SHARED_SECRET is required to push data to production',
		);
	}

	const snapshot = await buildDataSnapshotBundle({ source: 'admin-panel' });
	const importUrl = `${productionBaseUrl}/api/internal/data-sync/import`;

	try {
		const response = await fetch(importUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/gzip',
				'x-gws-sync-token': sharedSecret,
				'x-gws-sync-checksum': snapshot.checksum,
				'x-gws-sync-source': 'admin-panel',
			},
			body: createReadStream(snapshot.bundlePath),
			duplex: 'half',
		});

		const responseText = await response.text();
		if (!response.ok) {
			throw new Error(
				`Production data import failed (${response.status}): ${responseText}`,
			);
		}

		return {
			snapshot,
			response: responseText ? JSON.parse(responseText) : null,
		};
	} finally {
		await cleanupSnapshotWorkspace(snapshot.workspaceRoot);
	}
};
