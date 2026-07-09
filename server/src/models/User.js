import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import db from '../database.js';

export const DEFAULT_AVATAR = '/image.png';

const normalizeAvatar = (avatar) =>
	typeof avatar === 'string' && avatar.trim()
		? avatar
		: DEFAULT_AVATAR;

const clearExpiredStatusIfNeeded = (user) => {
	if (!user?.statusClearsAt) {
		return user;
	}

	const clearsAt = new Date(user.statusClearsAt).getTime();
	if (!Number.isFinite(clearsAt) || clearsAt > Date.now()) {
		return user;
	}

	db.prepare(
		'UPDATE users SET statusEmoji = NULL, statusText = NULL, statusClearsAt = NULL WHERE id = ?',
	).run(user.id);

	return {
		...user,
		statusEmoji: null,
		statusText: null,
		statusClearsAt: null,
	};
};

const normalizeUserRecord = (user) => {
	if (!user) return null;
	const withFreshStatus = clearExpiredStatusIfNeeded(user);

	return {
		...withFreshStatus,
		avatar: normalizeAvatar(withFreshStatus.avatar),
	};
};

export const createUser = (
	username,
	email,
	password,
	e2eePublicKey = null,
	e2eeEncryptedPrivateKey = null,
	e2eeSalt = null,
	e2eeIv = null,
	role = null,
) => {
	const insertWithRole = role !== null && role !== undefined;
	const stmt = db.prepare(
		insertWithRole
			? `
        INSERT INTO users (username, email, password, avatar, e2eePublicKey, e2eeEncryptedPrivateKey, e2eeSalt, e2eeIv, role)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
			: `
        INSERT INTO users (username, email, password, avatar, e2eePublicKey, e2eeEncryptedPrivateKey, e2eeSalt, e2eeIv)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
	);
	const result = insertWithRole
		? stmt.run(
				username,
				email,
				password,
				DEFAULT_AVATAR,
				e2eePublicKey,
				e2eeEncryptedPrivateKey,
				e2eeSalt,
				e2eeIv,
				role,
			)
		: stmt.run(
				username,
				email,
				password,
				DEFAULT_AVATAR,
				e2eePublicKey,
				e2eeEncryptedPrivateKey,
				e2eeSalt,
				e2eeIv,
			);
	return result.lastInsertRowid;
};

export const findUserByEmail = (email) => {
	const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
	return normalizeUserRecord(stmt.get(email));
};

export const findUserByUsername = (username) => {
	const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
	return normalizeUserRecord(stmt.get(username));
};

export const findUserById = (id) => {
	const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
	const user = stmt.get(id);
	if (user) {
		user.interests = JSON.parse(user.interests || '[]');
		user.socialLinks = JSON.parse(user.socialLinks || '{}');
		user.contactInfo = JSON.parse(user.contactInfo || '{}');
	}
	return normalizeUserRecord(user);
};

export const updateUser = (id, updates) => {
	const fields = [];
	const values = [];

	if (updates.username !== undefined) {
		fields.push('username = ?');
		values.push(updates.username);
	}
	if (updates.password !== undefined) {
		fields.push('password = ?');
		values.push(updates.password);
	}
	if (updates.bio !== undefined) {
		fields.push('bio = ?');
		values.push(updates.bio);
	}
	if (updates.avatar !== undefined) {
		fields.push('avatar = ?');
		values.push(normalizeAvatar(updates.avatar));
	}
	if (updates.banner !== undefined) {
		fields.push('banner = ?');
		values.push(updates.banner);
	}
	if (updates.theme !== undefined) {
		fields.push('theme = ?');
		values.push(updates.theme);
	}
	if (updates.appearOffline !== undefined) {
		fields.push('appearOffline = ?');
		values.push(updates.appearOffline ? 1 : 0);
	}
	if (updates.statusEmoji !== undefined) {
		fields.push('statusEmoji = ?');
		values.push(updates.statusEmoji);
	}
	if (updates.statusText !== undefined) {
		fields.push('statusText = ?');
		values.push(updates.statusText);
	}
	if (updates.statusClearsAt !== undefined) {
		fields.push('statusClearsAt = ?');
		values.push(updates.statusClearsAt);
	}
	if (updates.e2eePublicKey !== undefined) {
		fields.push('e2eePublicKey = ?');
		values.push(updates.e2eePublicKey);
	}
	if (updates.e2eeEncryptedPrivateKey !== undefined) {
		fields.push('e2eeEncryptedPrivateKey = ?');
		values.push(updates.e2eeEncryptedPrivateKey);
	}
	if (updates.e2eeSalt !== undefined) {
		fields.push('e2eeSalt = ?');
		values.push(updates.e2eeSalt);
	}
	if (updates.e2eeIv !== undefined) {
		fields.push('e2eeIv = ?');
		values.push(updates.e2eeIv);
	}
	if (updates.interests !== undefined) {
		fields.push('interests = ?');
		values.push(JSON.stringify(updates.interests));
	}
	if (updates.socialLinks !== undefined) {
		fields.push('socialLinks = ?');
		values.push(JSON.stringify(updates.socialLinks));
	}
	if (updates.contactInfo !== undefined) {
		fields.push('contactInfo = ?');
		values.push(JSON.stringify(updates.contactInfo));
	}
	if (updates.mustChangePassword !== undefined) {
		fields.push('mustChangePassword = ?');
		values.push(updates.mustChangePassword ? 1 : 0);
	}

	if (fields.length === 0) return null;

	values.push(id);
	const stmt = db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`);
	stmt.run(...values);

	return findUserById(id);
};

export const searchUsers = (searchTerm) => {
	const stmt = db.prepare(`
    SELECT id, username, email, avatar 
    FROM users 
    WHERE username LIKE ? OR email LIKE ?
    LIMIT 10
  `);
	return stmt
		.all(`%${searchTerm}%`, `%${searchTerm}%`)
		.map((user) => normalizeUserRecord(user));
};

export const getUserPublicKey = (id) => {
	const stmt = db.prepare('SELECT e2eePublicKey FROM users WHERE id = ?');
	return stmt.get(id);
};

// Self-service account deletion scrubs the user's identity in place rather
// than deleting the row - their messages and any channels/groups they
// created stay intact for other members, just attributed to a generic
// "Deleted User" instead of cascading the deletion out to other people's
// shared content. Login becomes permanently impossible (unique email and
// password are both replaced).
export const anonymizeUser = (id) => {
	const randomPassword = crypto.randomBytes(32).toString('hex');
	const passwordHash = bcrypt.hashSync(randomPassword, 10);

	db.prepare(
		`UPDATE users SET
      username = ?,
      email = ?,
      password = ?,
      avatar = ?,
      banner = '',
      bio = '',
      interests = '[]',
      socialLinks = '{}',
      contactInfo = '{}',
      e2eePublicKey = NULL,
      e2eeEncryptedPrivateKey = NULL,
      e2eeSalt = NULL,
      e2eeIv = NULL,
      role = 'user',
      mustChangePassword = 0,
      appearOffline = 0,
      statusEmoji = NULL,
      statusText = NULL,
      statusClearsAt = NULL,
      twoFactorEnabled = 0,
      twoFactorSecret = NULL,
      pendingTwoFactorSecret = NULL,
      failedLoginAttempts = 0,
      lockedUntil = NULL
    WHERE id = ?`,
	).run(`deleted-user-${id}`, `deleted-user-${id}@deleted.invalid`, passwordHash, DEFAULT_AVATAR, id);
};

// Removes the genuinely-personal data tied to this account (their own
// membership/keys/devices/relationships) without touching anything they
// created or sent that other users still rely on.
export const deleteUserPersonalData = (id) => {
	db.prepare('DELETE FROM channel_members WHERE userId = ?').run(id);
	db.prepare('DELETE FROM channel_managers WHERE userId = ?').run(id);
	db.prepare('DELETE FROM group_chat_members WHERE userId = ?').run(id);
	db.prepare('DELETE FROM channel_keys WHERE userId = ?').run(id);
	db.prepare('DELETE FROM channel_key_generations WHERE userId = ?').run(id);
	db.prepare('DELETE FROM group_chat_keys WHERE userId = ?').run(id);
	db.prepare('DELETE FROM group_chat_key_generations WHERE userId = ?').run(id);
	db.prepare('DELETE FROM two_factor_backup_codes WHERE userId = ?').run(id);
	db.prepare('DELETE FROM push_subscriptions WHERE userId = ?').run(id);
	db.prepare('DELETE FROM friends WHERE userId = ? OR friendId = ?').run(id, id);
	db.prepare('DELETE FROM password_reset_requests WHERE userId = ?').run(id);
};
