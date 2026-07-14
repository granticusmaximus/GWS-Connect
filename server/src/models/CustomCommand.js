import crypto from 'crypto';
import db from '../database.js';

const normalizeCommand = (row) =>
	row
		? {
				...row,
				id: String(row.id),
				workspaceId: String(row.workspaceId),
				createdBy: String(row.createdBy),
			}
		: null;

// listCommandsForWorkspace excludes `secret` at the SQL level (below) so it
// never round-trips after creation - createCommand is the one place that
// returns it, shown to the admin once so they can configure the target
// service, the same reveal-once pattern as a GitHub PAT or Slack signing
// secret.
export const listCommandsForWorkspace = (workspaceId) =>
	db
		.prepare(
			`SELECT id, workspaceId, command, targetUrl, createdBy, createdAt
       FROM custom_commands
       WHERE workspaceId = ?
       ORDER BY command ASC`,
		)
		.all(workspaceId)
		.map(normalizeCommand);

export const findCommandById = (commandId) =>
	normalizeCommand(
		db.prepare('SELECT * FROM custom_commands WHERE id = ?').get(commandId),
	);

export const findCommandForWorkspace = (workspaceId, command) =>
	normalizeCommand(
		db
			.prepare(
				'SELECT * FROM custom_commands WHERE workspaceId = ? AND command = ?',
			)
			.get(workspaceId, command),
	);

export const createCommand = (workspaceId, command, targetUrl, createdBy) => {
	const secret = crypto.randomBytes(24).toString('hex');
	const result = db
		.prepare(
			`INSERT INTO custom_commands (workspaceId, command, targetUrl, secret, createdBy)
       VALUES (?, ?, ?, ?, ?)`,
		)
		.run(workspaceId, command, targetUrl, secret, createdBy);
	return findCommandById(result.lastInsertRowid);
};

export const deleteCommand = (commandId, workspaceId) =>
	db
		.prepare('DELETE FROM custom_commands WHERE id = ? AND workspaceId = ?')
		.run(commandId, workspaceId);
