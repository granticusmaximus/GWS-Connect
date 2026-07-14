import crypto from 'crypto';
import express from 'express';
import { mkdtemp, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { authenticateToken } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/roles.js';
import {
	applyDataSnapshotBundle,
	buildDataSnapshotBundle,
	cleanupSnapshotWorkspace,
	pushDataSnapshotToProduction,
} from '../services/dataSnapshot.js';
import {
	isDataSyncInProgress,
	setDataSyncInProgress,
} from '../services/syncState.js';

const router = express.Router();

const getSharedSecret = () =>
	(process.env.DATA_SYNC_SHARED_SECRET || '').trim();

const hashBuffer = (buffer) =>
	crypto.createHash('sha256').update(buffer).digest('hex');

router.get(
	'/admin/data-sync/export',
	authenticateToken,
	requireAdmin,
	async (req, res) => {
		let snapshot;

		try {
			snapshot = await buildDataSnapshotBundle({ source: 'admin-export' });
			res.download(snapshot.bundlePath, snapshot.bundleName, async (error) => {
				await cleanupSnapshotWorkspace(snapshot?.workspaceRoot);
				if (error) {
					console.error('Data snapshot download error:', error);
				}
			});
		} catch (error) {
			if (snapshot?.workspaceRoot) {
				await cleanupSnapshotWorkspace(snapshot.workspaceRoot);
			}
			console.error('Data snapshot export error:', error);
			res.status(500).json({ message: 'Failed to export data snapshot' });
		}
	},
);

router.post(
	'/admin/data-sync/push',
	authenticateToken,
	requireAdmin,
	async (req, res) => {
		try {
			const result = await pushDataSnapshotToProduction();
			res.json({
				message: 'Production data sync completed',
				...result,
			});
		} catch (error) {
			console.error('Production data sync error:', error);
			res.status(500).json({
				message:
					error instanceof Error
						? error.message
						: 'Failed to push data to production',
			});
		}
	},
);

router.post(
	'/internal/data-sync/import',
	express.raw({ type: 'application/gzip', limit: '1gb' }),
	async (req, res) => {
		const sharedSecret = getSharedSecret();
		if (!sharedSecret) {
			return res.status(503).json({
				message: 'Data sync is not enabled on this environment',
			});
		}

		const incomingToken = String(req.headers['x-gws-sync-token'] || '').trim();
		if (incomingToken !== sharedSecret) {
			return res.status(403).json({ message: 'Invalid data sync token' });
		}

		if (isDataSyncInProgress()) {
			return res
				.status(409)
				.json({ message: 'A data sync is already in progress' });
		}

		if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
			return res.status(400).json({ message: 'Snapshot bundle is required' });
		}

		const expectedChecksum = String(
			req.headers['x-gws-sync-checksum'] || '',
		).trim();
		const actualChecksum = hashBuffer(req.body);
		if (expectedChecksum && expectedChecksum !== actualChecksum) {
			return res.status(400).json({ message: 'Snapshot checksum mismatch' });
		}

		setDataSyncInProgress(true);
		let workspaceRoot;

		try {
			workspaceRoot = await mkdtemp(
				path.join(os.tmpdir(), 'gws-connect-upload-'),
			);
			const bundlePath = path.join(workspaceRoot, 'incoming-snapshot.tar.gz');
			await writeFile(bundlePath, req.body);
			const result = await applyDataSnapshotBundle({ bundlePath });
			res.json({
				message: 'Data snapshot imported successfully',
				...result,
			});
		} catch (error) {
			console.error('Data snapshot import error:', error);
			res.status(500).json({
				message:
					error instanceof Error
						? error.message
						: 'Failed to import data snapshot',
			});
		} finally {
			setDataSyncInProgress(false);
			await cleanupSnapshotWorkspace(workspaceRoot);
		}
	},
);

export default router;
