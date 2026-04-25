import db from '../database.js';

export const DEFAULT_AVATAR = '/image.png';

const normalizeAvatar = (avatar) =>
	typeof avatar === 'string' && avatar.trim()
		? avatar
		: DEFAULT_AVATAR;

const normalizeUserRecord = (user) => {
	if (!user) return null;

	return {
		...user,
		avatar: normalizeAvatar(user.avatar),
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
