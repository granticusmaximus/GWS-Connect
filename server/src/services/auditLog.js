import db from '../database.js';

export const logAuditEvent = ({
	actorId,
	action,
	targetType,
	targetId = null,
	metadata = {},
}) => {
	db.prepare(
		`INSERT INTO audit_log (actorId, action, targetType, targetId, metadata)
     VALUES (?, ?, ?, ?, ?)`,
	).run(
		actorId,
		String(action || '').trim() || 'unknown',
		String(targetType || '').trim() || 'unknown',
		targetId === null || targetId === undefined ? null : String(targetId),
		JSON.stringify(metadata || {}),
	);
};

export const listAuditEvents = (limit = 250) =>
	db
		.prepare(
			`SELECT
        a.id,
        a.action,
        a.targetType,
        a.targetId,
        a.metadata,
        a.createdAt,
        u.id AS actorId,
        u.username AS actorUsername,
        u.avatar AS actorAvatar
      FROM audit_log a
      JOIN users u ON u.id = a.actorId
      ORDER BY datetime(a.createdAt) DESC, a.id DESC
      LIMIT ?`,
		)
		.all(limit)
		.map((row) => ({
			...row,
			metadata: (() => {
				try {
					return JSON.parse(row.metadata || '{}');
				} catch {
					return {};
				}
			})(),
		}));
