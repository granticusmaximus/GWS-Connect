import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireWorkspaceRole } from '../middleware/roles.js';
import {
	addWorkspaceMember,
	createWorkspace,
	findWorkspaceById,
	getUserRoleInWorkspace,
	listWorkspaceMembers,
	listWorkspacesForUser,
	removeWorkspaceMember,
} from '../models/Workspace.js';
import { findUserByUsername } from '../models/User.js';

const router = express.Router();

// List workspaces the current user belongs to
router.get('/', authenticateToken, async (req, res) => {
	try {
		res.json(listWorkspacesForUser(req.user.id));
	} catch (error) {
		console.error('List workspaces error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Create a new workspace - creator becomes its admin
router.post('/', authenticateToken, async (req, res) => {
	try {
		const { name } = req.body;
		if (!name || !name.trim()) {
			return res.status(400).json({ message: 'Workspace name is required' });
		}

		const workspace = createWorkspace(name.trim(), req.user.id);
		res.status(201).json(workspace);
	} catch (error) {
		console.error('Create workspace error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Members of a workspace - any member can view the roster
router.get('/:workspaceId/members', authenticateToken, requireWorkspaceRole('guest'), async (req, res) => {
	try {
		const workspace = findWorkspaceById(req.params.workspaceId);
		if (!workspace) {
			return res.status(404).json({ message: 'Workspace not found' });
		}

		res.json(listWorkspaceMembers(req.params.workspaceId));
	} catch (error) {
		console.error('List workspace members error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

// Add a member by username - workspace admins only
router.post(
	'/:workspaceId/members',
	authenticateToken,
	requireWorkspaceRole('admin'),
	async (req, res) => {
		try {
			const { username, role = 'user' } = req.body;
			const targetUser = findUserByUsername(username);
			if (!targetUser) {
				return res.status(404).json({ message: 'User not found' });
			}

			addWorkspaceMember(req.params.workspaceId, targetUser.id, role);
			res.json({ message: 'Member added', role });
		} catch (error) {
			console.error('Add workspace member error:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

// Remove a member - workspace admins only, can't remove yourself this way
router.delete(
	'/:workspaceId/members/:userId',
	authenticateToken,
	requireWorkspaceRole('admin'),
	async (req, res) => {
		try {
			if (String(req.params.userId) === String(req.user.id)) {
				return res
					.status(400)
					.json({ message: 'Use a different account to remove the last admin' });
			}

			removeWorkspaceMember(req.params.workspaceId, req.params.userId);
			res.json({ message: 'Member removed' });
		} catch (error) {
			console.error('Remove workspace member error:', error);
			res.status(500).json({ message: 'Server error' });
		}
	},
);

// Current user's role within a workspace (used by the client to gate UI)
router.get('/:workspaceId/role', authenticateToken, async (req, res) => {
	try {
		const role = getUserRoleInWorkspace(req.params.workspaceId, req.user.id);
		if (!role) {
			return res.status(403).json({ message: 'Not a member of this workspace' });
		}
		res.json({ role });
	} catch (error) {
		console.error('Get workspace role error:', error);
		res.status(500).json({ message: 'Server error' });
	}
});

export default router;
