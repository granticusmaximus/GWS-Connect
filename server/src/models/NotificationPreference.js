import db from '../database.js';

const VALID_TARGET_TYPES = new Set(['channel', 'dm', 'group']);
const VALID_PREFERENCES = new Set(['all', 'mentions', 'none']);

const normalizeTargetType = (targetType) =>
	VALID_TARGET_TYPES.has(targetType) ? targetType : null;

const normalizePreference = (preference) =>
	VALID_PREFERENCES.has(preference) ? preference : null;

export const getNotificationPreference = (userId, targetType, targetId) => {
	const normalizedType = normalizeTargetType(targetType);
	if (!normalizedType || targetId === null || targetId === undefined) {
		return null;
	}

	return db
		.prepare(
			`SELECT preference
       FROM user_notification_prefs
       WHERE userId = ? AND targetType = ? AND targetId = ?`,
		)
		.get(userId, normalizedType, String(targetId));
};

export const setNotificationPreference = (
	userId,
	targetType,
	targetId,
	preference,
) => {
	const normalizedType = normalizeTargetType(targetType);
	const normalizedPreference = normalizePreference(preference);
	if (
		!normalizedType ||
		!normalizedPreference ||
		targetId === null ||
		targetId === undefined
	) {
		return null;
	}

	db.prepare(
		`INSERT INTO user_notification_prefs (
        userId,
        targetType,
        targetId,
        preference,
        updatedAt
      ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(userId, targetType, targetId) DO UPDATE SET
        preference = excluded.preference,
        updatedAt = CURRENT_TIMESTAMP`,
	).run(userId, normalizedType, String(targetId), normalizedPreference);

	return {
		targetType: normalizedType,
		targetId: String(targetId),
		preference: normalizedPreference,
	};
};

export const getNotificationPreferencesForUser = (userId) =>
	db
		.prepare(
			`SELECT targetType, targetId, preference, updatedAt
       FROM user_notification_prefs
       WHERE userId = ?
       ORDER BY updatedAt DESC`,
		)
		.all(userId)
		.map((entry) => ({
			targetType: entry.targetType,
			targetId: String(entry.targetId),
			preference: entry.preference,
			updatedAt: entry.updatedAt,
		}));
