import db from '../database.js';

const mapEmojiRow = (row) =>
	row
		? {
				id: String(row.id),
				name: row.name,
				mimeType: row.mimeType,
				filePath: row.filePath,
				createdBy: String(row.createdBy),
				createdAt: row.createdAt,
				imageUrl: `/api/workspace-emoji/${row.id}/file`,
			}
		: null;

export const listWorkspaceEmoji = () =>
	db
		.prepare(
			`SELECT id, name, mimeType, filePath, createdBy, createdAt
       FROM workspace_emoji
       ORDER BY name COLLATE NOCASE ASC, id ASC`,
		)
		.all()
		.map(mapEmojiRow);

export const findWorkspaceEmojiById = (emojiId) =>
	mapEmojiRow(
		db
			.prepare(
				`SELECT id, name, mimeType, filePath, createdBy, createdAt
         FROM workspace_emoji
         WHERE id = ?`,
			)
			.get(emojiId),
	);

export const createWorkspaceEmoji = (name, filePath, mimeType, createdBy) => {
	const result = db
		.prepare(
			`INSERT INTO workspace_emoji (name, filePath, mimeType, createdBy)
       VALUES (?, ?, ?, ?)`,
		)
		.run(name, filePath, mimeType, createdBy);
	return findWorkspaceEmojiById(result.lastInsertRowid);
};

export const deleteWorkspaceEmoji = (emojiId) =>
	db.prepare('DELETE FROM workspace_emoji WHERE id = ?').run(emojiId);
