import { useAuthStore } from '../store/authStore';
import { usePreferencesStore } from '../store/preferencesStore';
import { useState, useEffect } from 'react';
import axios from 'axios';
import Header from '../components/Header';
import { API_URL } from '../config/runtime';
import { formatDate } from '../utils/dateFormat';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface User {
	id: number;
	username: string;
	email: string;
	role: 'user' | 'manager' | 'admin';
	avatar?: string;
}

interface PendingChannel {
	id: number;
	name: string;
	description: string;
	isPrivate?: number;
	createdAt: string;
	creatorUsername: string;
	creatorAvatar: string;
}

interface PasswordResetRequest {
	id: number;
	userId?: number | null;
	email: string;
	requestedAt: string;
	username?: string | null;
	avatar?: string | null;
}

export default function AdminPanel() {
	const user = useAuthStore((state) => state.user);
	const [users, setUsers] = useState<User[]>([]);
	const [pendingChannels, setPendingChannels] = useState<PendingChannel[]>([]);
	const [passwordResetRequests, setPasswordResetRequests] = useState<
		PasswordResetRequest[]
	>([]);
	const [loading, setLoading] = useState(true);
	const [newUser, setNewUser] = useState({
		username: '',
		email: '',
		role: 'user',
	});
	const [creatingUser, setCreatingUser] = useState(false);
	const [isAddUserOpen, setIsAddUserOpen] = useState(false);
	const [createdTempPassword, setCreatedTempPassword] = useState<string | null>(
		null,
	);
	const dateFormat = usePreferencesStore((state) => state.dateFormat);
	const [isResetModalOpen, setIsResetModalOpen] = useState(false);
	const [resetUser, setResetUser] = useState<User | null>(null);
	const [resettingUser, setResettingUser] = useState(false);
	const [resetSuccess, setResetSuccess] = useState(false);
	const [deletingUserId, setDeletingUserId] = useState<number | null>(null);
	const [processingResetRequestId, setProcessingResetRequestId] = useState<
		number | null
	>(null);

	useEffect(() => {
		if (user?.role === 'admin') {
			loadData();
		}
	}, [user]);

	const loadData = async () => {
		try {
			const [usersRes, channelsRes, resetRequestsRes] = await Promise.all([
				axios.get(`${API_URL}/admin/users`),
				axios.get(`${API_URL}/admin/channels/pending`),
				axios.get(`${API_URL}/admin/password-reset-requests`),
			]);
			setUsers(usersRes.data);
			setPendingChannels(channelsRes.data);
			setPasswordResetRequests(resetRequestsRes.data);
		} catch (error) {
			console.error('Admin panel load error:', error);
		} finally {
			setLoading(false);
		}
	};

	const updateUserRole = async (userId: number, newRole: string) => {
		try {
			await axios.put(`${API_URL}/admin/users/${userId}/role`, {
				role: newRole,
			});
			await loadData();
		} catch (error) {
			console.error('Update role error:', error);
			alert('Failed to update user role');
		}
	};

	const createUser = async () => {
		if (!newUser.username || !newUser.email) {
			alert('Username and email are required');
			return;
		}

		setCreatingUser(true);
		try {
			const response = await axios.post(`${API_URL}/admin/users`, newUser);
			setNewUser({ username: '', email: '', role: 'user' });
			setCreatedTempPassword(response.data?.tempPassword || null);
			await loadData();
		} catch (error) {
			console.error('Create user error:', error);
			alert('Failed to create user');
		} finally {
			setCreatingUser(false);
		}
	};

	const approveChannel = async (channelId: number) => {
		try {
			await axios.post(`${API_URL}/admin/channels/${channelId}/approve`);
			await loadData();
		} catch (error) {
			console.error('Approve channel error:', error);
			alert('Failed to approve channel');
		}
	};

	const rejectChannel = async (channelId: number) => {
		try {
			await axios.post(`${API_URL}/admin/channels/${channelId}/reject`);
			await loadData();
		} catch (error) {
			console.error('Reject channel error:', error);
			alert('Failed to reject channel');
		}
	};

	const openResetModal = (target: User) => {
		setResetUser(target);
		setResetSuccess(false);
		setIsResetModalOpen(true);
	};

	const sendResetEmail = async () => {
		if (!resetUser) return;
		setResettingUser(true);
		try {
			await axios.post(`${API_URL}/admin/users/${resetUser.id}/reset-password`);
			setResetSuccess(true);
			await loadData();
		} catch (error) {
			console.error('Reset password error:', error);
			alert('Failed to send reset email');
		} finally {
			setResettingUser(false);
		}
	};

	const resolvePasswordResetRequest = async (
		request: PasswordResetRequest,
	) => {
		const displayName = request.username || request.email;
		if (
			!confirm(`Send a temporary password to ${displayName}?`)
		) {
			return;
		}

		setProcessingResetRequestId(request.id);
		try {
			await axios.post(
				`${API_URL}/admin/password-reset-requests/${request.id}/resolve`,
			);
			await loadData();
		} catch (error) {
			console.error('Resolve password reset request error:', error);
			alert('Failed to send the temporary password');
		} finally {
			setProcessingResetRequestId(null);
		}
	};

	const deleteUser = async (target: User) => {
		if (!confirm(`Delete ${target.username}? This cannot be undone.`)) return;
		setDeletingUserId(target.id);
		try {
			await axios.delete(`${API_URL}/admin/users/${target.id}`);
			await loadData();
		} catch (error) {
			console.error('Delete user error:', error);
			alert('Failed to delete user');
		} finally {
			setDeletingUserId(null);
		}
	};

	if (user?.role !== 'admin') {
		return (
			<div className="min-h-screen bg-gray-100 dark:bg-gray-900">
				<Header />
				<div className="flex items-center justify-center py-12">
					<p className="text-gray-500 dark:text-gray-400">
						Access denied. Admin only.
					</p>
				</div>
			</div>
		);
	}

	if (loading) {
		return (
			<div className="min-h-screen bg-gray-100 dark:bg-gray-900">
				<Header />
				<div className="flex items-center justify-center py-12">
					<p className="text-gray-500 dark:text-gray-400">Loading...</p>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-gray-100 dark:bg-gray-900">
			<Header />
			<div className="max-w-6xl mx-auto p-4 sm:p-6 safe-area-top safe-area-bottom">
				<h1 className="text-2xl sm:text-3xl font-bold mb-6 sm:mb-8 text-gray-900 dark:text-white">
					Admin Panel
				</h1>

			{/* Create User */}
			<section className="mb-8">
				<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
					<h2 className="text-lg sm:text-2xl font-semibold text-gray-900 dark:text-white">
						Add User
					</h2>
					<button
						onClick={() => {
							setIsAddUserOpen(true);
							setCreatedTempPassword(null);
						}}
						className="min-h-12 sm:min-h-auto px-4 py-3 sm:py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium tap-highlight-none transition-colors w-full sm:w-auto text-center sm:text-left"
					>
						Add New User
					</button>
				</div>
			</section>

			{/* Pending Channels */}
			<section className="mb-8">
				<h2 className="text-lg sm:text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
					Pending Channel Approvals ({pendingChannels.length})
				</h2>
				{pendingChannels.length === 0 ? (
					<p className="text-sm text-gray-500 dark:text-gray-400">
						No pending channels
					</p>
				) : (
					<div className="space-y-3">
						{pendingChannels.map((channel) => (
							<div
								key={channel.id}
								className="bg-white dark:bg-gray-800 p-4 sm:p-4 rounded-lg sm:rounded-lg shadow"
							>
								<div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
									<div className="flex-1 min-w-0">
										<h3 className="font-bold text-base sm:text-lg text-gray-900 dark:text-white break-words">
											#{channel.name}
										</h3>
										<span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
											channel.isPrivate ? 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200' : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200'
										}`}>
											{channel.isPrivate ? 'Private' : 'Public'}
										</span>
										<p className="text-sm text-gray-600 dark:text-gray-300 mt-2 break-words">
											{channel.description}
										</p>
										<p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
											Created by {channel.creatorUsername} •{' '}
											{formatDate(new Date(channel.createdAt), dateFormat)}
										</p>
									</div>
									<div className="flex gap-2 min-h-10 sm:min-h-auto">
										<button
											onClick={() => approveChannel(channel.id)}
											className="flex-1 sm:flex-none px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs sm:text-sm font-medium transition-colors tap-highlight-none min-h-10 sm:min-h-auto flex items-center justify-center"
										>
											Approve
										</button>
										<button
											onClick={() => rejectChannel(channel.id)}
											className="flex-1 sm:flex-none px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs sm:text-sm font-medium transition-colors tap-highlight-none min-h-10 sm:min-h-auto flex items-center justify-center"
										>
											Reject
										</button>
									</div>
								</div>
							</div>
						))}
					</div>
				)}
			</section>

			<section className="mb-8">
				<h2 className="text-lg sm:text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
					Password Reset Requests ({passwordResetRequests.length})
				</h2>
				{passwordResetRequests.length === 0 ? (
					<p className="text-sm text-gray-500 dark:text-gray-400">
						No pending password reset requests
					</p>
				) : (
					<div className="space-y-3">
						{passwordResetRequests.map((request) => (
							<div
								key={request.id}
								className="rounded-lg bg-white p-4 shadow dark:bg-gray-800"
							>
								<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
									<div className="flex min-w-0 items-center gap-3">
										<img
											src={request.avatar || '/image.png'}
											alt={request.username || request.email}
											className="h-10 w-10 rounded-full flex-shrink-0"
										/>
										<div className="min-w-0">
											<div className="text-sm font-semibold text-gray-900 dark:text-white">
												{request.username || 'Unknown user'}
											</div>
											<div className="mt-1 text-sm text-gray-600 dark:text-gray-300 break-words">
												{request.email}
											</div>
											<div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
												Requested {formatDate(new Date(request.requestedAt), dateFormat)}
											</div>
										</div>
									</div>
									<button
										onClick={() => resolvePasswordResetRequest(request)}
										disabled={processingResetRequestId === request.id || !request.userId}
										className="min-h-10 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-60"
									>
										{processingResetRequestId === request.id
											? 'Sending...'
											: 'Send Temporary Password'}
									</button>
								</div>
							</div>
						))}
					</div>
				)}
			</section>

			{/* User Management */}
			<section>
				<h2 className="text-lg sm:text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
					User Management ({users.length})
				</h2>
				<div className="bg-white dark:bg-gray-800 rounded-lg sm:rounded-lg shadow overflow-x-auto">
					<table className="w-full min-w-max sm:table-auto">
						<thead className="bg-gray-50 dark:bg-gray-700">
							<tr>
								<th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
									User
								</th>
								<th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider hidden sm:table-cell">
									Email
								</th>
								<th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
									Role
								</th>
								<th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
									Actions
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-gray-200 dark:divide-gray-700">
							{users.map((u) => (
								<tr key={u.id}>
									<td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
										<div className="flex items-center gap-2 sm:gap-3 min-w-0">
											<img
												src={u.avatar || '/image.png'}
												alt={u.username}
												className="h-8 w-8 rounded-full flex-shrink-0"
											/>
											<span className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white truncate">
												{u.username}
											</span>
										</div>
									</td>
									<td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-500 dark:text-gray-400 hidden sm:table-cell">
										{u.email}
									</td>
									<td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
										<select
											value={u.role}
											onChange={(e) => updateUserRole(u.id, e.target.value)}
											title={`Role for ${u.username}`}
											aria-label={`Role for ${u.username}`}
											className="text-xs sm:text-sm border rounded px-2 py-1.5 sm:py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 min-h-10 sm:min-h-auto tap-highlight-none"
											disabled={String(u.id) === String(user?.id)}
										>
											<option value="user">User</option>
											<option value="manager">Manager</option>
											<option value="admin">Admin</option>
										</select>
									</td>
									<td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm">
										{String(u.id) === String(user?.id) ? (
											<span className="text-gray-500 dark:text-gray-400">
												(You)
											</span>
										) : (
											<div className="flex items-center gap-1 sm:gap-2">
												<button
													onClick={() => openResetModal(u)}
													className="px-2 sm:px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors min-h-10 sm:min-h-auto tap-highlight-none"
												>
													Edit
												</button>
												<button
													onClick={() => deleteUser(u)}
													disabled={deletingUserId === u.id}
													className="px-2 sm:px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-xs text-white disabled:opacity-60 transition-colors min-h-10 sm:min-h-auto tap-highlight-none"
												>
													{deletingUserId === u.id ? 'Del...' : 'Delete'}
												</button>
											</div>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>

			{isAddUserOpen && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-4 sm:py-0">
					<div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900 my-auto">
						<div className="flex items-center justify-between mb-4">
							<h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
								Add New User
							</h3>
							<button
								onClick={() => {
									setIsAddUserOpen(false);
									setNewUser({ username: '', email: '', role: 'user' });
									setCreatedTempPassword(null);
								}}
								title="Close add user modal"
								aria-label="Close add user modal"
								className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 tap-highlight-none p-2 -m-2"
							>
								<XMarkIcon className="w-5 h-5" />
							</button>
						</div>

						<div className="mt-4 space-y-4">
							<input
								disabled={creatingUser || !!createdTempPassword}
								value={newUser.username}
								onChange={(e) =>
									setNewUser((prev) => ({ ...prev, username: e.target.value }))
								}
								placeholder="Username"
								className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent min-h-12 sm:min-h-auto transition-colors"
							/>
							<input
								disabled={creatingUser || !!createdTempPassword}
								value={newUser.email}
								onChange={(e) =>
									setNewUser((prev) => ({ ...prev, email: e.target.value }))
								}
								type="email"
								placeholder="Email"
								className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent min-h-12 sm:min-h-auto transition-colors"
							/>
							<select
								disabled={creatingUser || !!createdTempPassword}
								value={newUser.role}
								onChange={(e) =>
									setNewUser((prev) => ({ ...prev, role: e.target.value }))
								}
								title="Role for new user"
								aria-label="Role for new user"
								className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent min-h-12 sm:min-h-auto transition-colors"
							>
								<option value="user">User</option>
								<option value="manager">Manager</option>
								<option value="admin">Admin</option>
							</select>
						</div>

						{createdTempPassword && (
							<div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-200">
								<p className="text-xs sm:text-sm mb-2">Temporary password sent. Share this only if needed:</p>
								<div className="mt-2 font-mono text-sm sm:text-base break-all">
									{createdTempPassword}
								</div>
							</div>
						)}

						<div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-0">
							<button
								onClick={() => {
									setIsAddUserOpen(false);
									setNewUser({ username: '', email: '', role: 'user' });
									setCreatedTempPassword(null);
								}}
								className="px-4 py-3 sm:py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium min-h-12 sm:min-h-auto tap-highlight-none transition-colors"
							>
								Cancel
							</button>
							<button
								onClick={createUser}
								disabled={creatingUser || !!createdTempPassword}
								className="px-4 py-3 sm:py-2 mr-0 sm:mr-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium disabled:opacity-60 min-h-12 sm:min-h-auto tap-highlight-none transition-colors"
							>
								{creatingUser ? 'Creating...' : 'Save'}
							</button>
						</div>
					</div>
				</div>
			)}

			{isResetModalOpen && resetUser && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-4 sm:py-0">
					<div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900 my-auto">
						<div className="flex items-center justify-between mb-4">
							<h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
								Reset Password
							</h3>
							<button
								onClick={() => {
									setIsResetModalOpen(false);
									setResetUser(null);
									setResetSuccess(false);
								}}
								title="Close reset password modal"
								aria-label="Close reset password modal"
								className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 tap-highlight-none p-2 -m-2"
							>
								<XMarkIcon className="w-5 h-5" />
							</button>
						</div>

						<div className="mt-4 space-y-3 text-xs sm:text-sm text-gray-600 dark:text-gray-300">
							<p>
								Send a temporary 8-character password to{' '}
								<span className="font-semibold text-gray-900 dark:text-white">
									{resetUser.username}
								</span>{' '}
								({resetUser.email}).
							</p>
							<p>
								The email instructs them to log in and immediately set a new
								password with at least 8 characters, one number, one uppercase
								letter, and one special character.
							</p>
						</div>

						{resetSuccess && (
							<div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-200">
								Temporary password email sent.
							</div>
						)}

						<div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-0">
							<button
								onClick={() => {
									setIsResetModalOpen(false);
									setResetUser(null);
									setResetSuccess(false);
								}}
								className="px-4 py-3 sm:py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium min-h-12 sm:min-h-auto tap-highlight-none transition-colors"
							>
								Cancel
							</button>
							<button
								onClick={sendResetEmail}
								disabled={resettingUser}
								className="px-4 py-3 sm:py-2 mr-0 sm:mr-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium disabled:opacity-60 min-h-12 sm:min-h-auto tap-highlight-none transition-colors"
							>
								{resettingUser ? 'Sending...' : 'Send Reset Email'}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
		</div>
	);
}
