import db from '../database.js';

const slugify = (name) =>
	String(name)
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-|-$)/g, '') || 'workspace';

const generateUniqueSlug = (name) => {
	const base = slugify(name);
	let slug = base;
	let suffix = 1;

	while (db.prepare('SELECT 1 FROM workspaces WHERE slug = ?').get(slug)) {
		suffix += 1;
		slug = `${base}-${suffix}`;
	}

	return slug;
};

export const createWorkspace = (name, createdBy) => {
	const slug = generateUniqueSlug(name);

	const createWithMembership = db.transaction(() => {
		const { lastInsertRowid: workspaceId } = db
			.prepare('INSERT INTO workspaces (name, slug, createdBy) VALUES (?, ?, ?)')
			.run(name, slug, createdBy);

		db.prepare(
			'INSERT INTO workspace_members (workspaceId, userId, role) VALUES (?, ?, ?)',
		).run(workspaceId, createdBy, 'admin');

		return workspaceId;
	});

	const workspaceId = createWithMembership();
	return findWorkspaceById(workspaceId);
};

// The instance's original workspace (created by the 1.1 migration backfill,
// or the first one an admin creates on a fresh install). New self-registered
// users are auto-joined to this one as a plain member - there's no
// workspace-picker in the signup flow, so without this they'd end up in no
// workspace at all (which the rest of the app treats as "no scoping",
// silently leaking every workspace's channels to them).
export const findEarliestWorkspace = () =>
	db.prepare('SELECT * FROM workspaces ORDER BY createdAt ASC, id ASC LIMIT 1').get() || null;

export const findWorkspaceById = (id) => {
	return db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
};

export const findWorkspaceBySlug = (slug) => {
	return db.prepare('SELECT * FROM workspaces WHERE slug = ?').get(slug);
};

export const listWorkspacesForUser = (userId) => {
	return db
		.prepare(
			`SELECT w.*, wm.role AS memberRole
			 FROM workspaces w
			 JOIN workspace_members wm ON wm.workspaceId = w.id
			 WHERE wm.userId = ?
			 ORDER BY w.createdAt ASC`,
		)
		.all(userId);
};

export const getUserRoleInWorkspace = (workspaceId, userId) => {
	const row = db
		.prepare(
			'SELECT role FROM workspace_members WHERE workspaceId = ? AND userId = ?',
		)
		.get(workspaceId, userId);
	return row?.role || null;
};

export const isWorkspaceMember = (workspaceId, userId) =>
	getUserRoleInWorkspace(workspaceId, userId) !== null;

export const addWorkspaceMember = (workspaceId, userId, role = 'user') => {
	db.prepare(
		`INSERT INTO workspace_members (workspaceId, userId, role)
		 VALUES (?, ?, ?)
		 ON CONFLICT(workspaceId, userId) DO UPDATE SET role = excluded.role`,
	).run(workspaceId, userId, role);
};

export const removeWorkspaceMember = (workspaceId, userId) => {
	db.prepare(
		'DELETE FROM workspace_members WHERE workspaceId = ? AND userId = ?',
	).run(workspaceId, userId);
};

export const listWorkspaceMembers = (workspaceId) => {
	return db
		.prepare(
			`SELECT u.id, u.username, u.avatar, wm.role, wm.joinedAt
			 FROM users u
			 JOIN workspace_members wm ON wm.userId = u.id
			 WHERE wm.workspaceId = ?
			 ORDER BY u.username ASC`,
		)
		.all(workspaceId);
};

export const countWorkspaces = () =>
	db.prepare('SELECT COUNT(*) AS count FROM workspaces').get().count;

export const getDefaultWorkspaceForUser = (userId) => {
	const workspaces = listWorkspacesForUser(userId);
	return workspaces[0] || null;
};

// Resolves which workspace a request applies to: an explicit id the caller
// actually belongs to, otherwise their default workspace. Shared by every
// route that scopes a list (channels, voice channels, ...) by workspace so
// the fallback rule can't drift between them.
export const resolveActiveWorkspaceId = (userId, requestedWorkspaceId) => {
	if (requestedWorkspaceId && isWorkspaceMember(requestedWorkspaceId, userId)) {
		return requestedWorkspaceId;
	}
	return getDefaultWorkspaceForUser(userId)?.id ?? null;
};
