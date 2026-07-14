import { useAuthStore } from '../store/authStore';
import { usePreferencesStore } from '../store/preferencesStore';
import { useEffect, useState } from 'react';
import axios from 'axios';
import Header from '../components/Header';
import { API_URL } from '../config/runtime';
import { formatDate } from '../utils/dateFormat';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface User {
	id: number;
	username: string;
	email: string;
	role: 'user' | 'manager' | 'admin' | 'guest';
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

interface AuditEvent {
	id: number;
	action: string;
	targetType: string;
	targetId?: string | null;
	metadata?: Record<string, string>;
	createdAt: string;
	actorId: number;
	actorUsername: string;
	actorAvatar?: string | null;
}

interface WorkspaceEmoji {
	id: string;
	name: string;
	imageUrl: string;
	createdAt?: string;
}

type AdminTab = 'overview' | 'reports' | 'audit';

const formatAuditAction = (action: string) =>
	String(action || '')
		.split('.')
		.filter(Boolean)
		.map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
		.join(' ');

const formatAuditTarget = (event: AuditEvent) => {
	if (!event.targetType) {
		return 'Unknown target';
	}

	if (!event.targetId) {
		return event.targetType;
	}

	return `${event.targetType} ${event.targetId}`;
};

export default function AdminPanel() {
	const user = useAuthStore((state) => state.user);
	const dateFormat = usePreferencesStore((state) => state.dateFormat);
	const [activeTab, setActiveTab] = useState<AdminTab>('overview');
	const [users, setUsers] = useState<User[]>([]);
	const [pendingChannels, setPendingChannels] = useState<PendingChannel[]>([]);
	const [passwordResetRequests, setPasswordResetRequests] = useState<
		PasswordResetRequest[]
	>([]);
	const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
	const [loading, setLoading] = useState(true);
	const [newUser, setNewUser] = useState<{
		username: string;
		email: string;
		role: 'user' | 'manager' | 'admin' | 'guest';
	}>({
		username: '',
		email: '',
		role: 'user',
	});
	const [creatingUser, setCreatingUser] = useState(false);
	const [isAddUserOpen, setIsAddUserOpen] = useState(false);
	const [createdTempPassword, setCreatedTempPassword] = useState<string | null>(
		null,
	);
	const [isResetModalOpen, setIsResetModalOpen] = useState(false);
	const [resetUser, setResetUser] = useState<User | null>(null);
	const [resettingUser, setResettingUser] = useState(false);
	const [resetSuccess, setResetSuccess] = useState(false);
	const [deletingUserId, setDeletingUserId] = useState<number | null>(null);
	const [processingResetRequestId, setProcessingResetRequestId] = useState<
		number | null
	>(null);
	const [reports, setReports] = useState<
		{
			id: number;
			messageId: number;
			reason: string;
			content: string;
			status: string;
			createdAt: string;
			channelId?: number;
			recipientId?: number;
			groupChatId?: number;
			reporterUsername: string;
			reporterAvatar?: string;
			senderUsername?: string;
		}[]
	>([]);
	const [actioningReportId, setActioningReportId] = useState<number | null>(
		null,
	);
	const [workspaceEmoji, setWorkspaceEmoji] = useState<WorkspaceEmoji[]>([]);
	const [emojiName, setEmojiName] = useState('');
	const [emojiFile, setEmojiFile] = useState<File | null>(null);
	const [uploadingEmoji, setUploadingEmoji] = useState(false);
	const [deletingEmojiId, setDeletingEmojiId] = useState<string | null>(null);
	const [dataSyncLoading, setDataSyncLoading] = useState(false);
	const [dataSyncMessage, setDataSyncMessage] = useState<string | null>(null);

	useEffect(() => {
		if (user?.role === 'admin') {
			void loadData();
		}
	}, [user]);

	const loadData = async () => {
		try {
			const [
				usersRes,
				channelsRes,
				resetRequestsRes,
				reportsRes,
				auditRes,
				workspaceEmojiRes,
			] = await Promise.all([
				axios.get(`${API_URL}/admin/users`),
				axios.get(`${API_URL}/admin/channels/pending`),
				axios.get(`${API_URL}/admin/password-reset-requests`),
				axios.get(`${API_URL}/admin/reports`),
				axios.get(`${API_URL}/admin/audit-log`, { params: { limit: 250 } }),
				axios.get(`${API_URL}/workspace-emoji`),
			]);
			setUsers(usersRes.data);
			setPendingChannels(channelsRes.data);
			setPasswordResetRequests(resetRequestsRes.data);
			setReports(reportsRes.data);
			setAuditEvents(auditRes.data);
			setWorkspaceEmoji(workspaceEmojiRes.data);
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
		if (!confirm(`Send a temporary password to ${displayName}?`)) {
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

	const actionReport = async (reportId: number, action: 'review' | 'dismiss') => {
		setActioningReportId(reportId);
		try {
			await axios.post(`${API_URL}/admin/reports/${reportId}/${action}`);
			setReports((prev) => prev.filter((report) => report.id !== reportId));
			await loadData();
		} catch (error) {
			console.error('Report action error:', error);
			alert('Failed to action report');
		} finally {
			setActioningReportId(null);
		}
	};

	const uploadWorkspaceEmoji = async () => {
		if (!emojiName.trim() || !emojiFile) {
			alert('Emoji name and image file are required');
			return;
		}

		setUploadingEmoji(true);
		try {
			const formData = new FormData();
			formData.append('name', emojiName.trim());
			formData.append('file', emojiFile);
			const response = await axios.post(`${API_URL}/workspace-emoji`, formData, {
				headers: { 'Content-Type': 'multipart/form-data' },
			});
			setWorkspaceEmoji((current) =>
				[response.data, ...current].sort((left, right) =>
					left.name.localeCompare(right.name),
				),
			);
			setEmojiName('');
			setEmojiFile(null);
			await loadData();
		} catch (error) {
			console.error('Workspace emoji upload error:', error);
			alert('Failed to upload emoji');
		} finally {
			setUploadingEmoji(false);
		}
	};

	const removeWorkspaceEmoji = async (emoji: WorkspaceEmoji) => {
		setDeletingEmojiId(emoji.id);
		try {
			await axios.delete(`${API_URL}/workspace-emoji/${emoji.id}`);
			setWorkspaceEmoji((current) =>
				current.filter((entry) => entry.id !== emoji.id),
			);
			await loadData();
		} catch (error) {
			console.error('Workspace emoji delete error:', error);
			alert('Failed to delete emoji');
		} finally {
			setDeletingEmojiId(null);
		}
	};

	const exportLocalDataSnapshot = async () => {
		setDataSyncLoading(true);
		setDataSyncMessage(null);

		try {
			const response = await axios.get(`${API_URL}/admin/data-sync/export`, {
				responseType: 'blob',
			});
			const blob = new Blob([response.data], {
				type: response.headers['content-type'] || 'application/gzip',
			});
			const objectUrl = window.URL.createObjectURL(blob);
			const link = document.createElement('a');
			const contentDisposition = String(response.headers['content-disposition'] || '');
			const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
			link.href = objectUrl;
			link.download = filenameMatch?.[1] || 'gws-connect-data-snapshot.tar.gz';
			document.body.appendChild(link);
			link.click();
			link.remove();
			window.URL.revokeObjectURL(objectUrl);
			setDataSyncMessage('Local snapshot exported');
		} catch (error) {
			console.error('Data snapshot export error:', error);
			alert('Failed to export local snapshot');
		} finally {
			setDataSyncLoading(false);
		}
	};

	const pushLocalDataToProduction = async () => {
		if (!confirm('Push the current local data snapshot to production?')) {
			return;
		}

		setDataSyncLoading(true);
		setDataSyncMessage(null);

		try {
			const response = await axios.post(`${API_URL}/admin/data-sync/push`);
			setDataSyncMessage(response.data?.message || 'Production data sync completed');
			await loadData();
		} catch (error) {
			console.error('Data snapshot push error:', error);
			alert('Failed to push local data to production');
		} finally {
			setDataSyncLoading(false);
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
			<div className="mx-auto max-w-6xl p-4 safe-area-top safe-area-bottom sm:p-6">
				<div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
					<h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">
						Admin Panel
					</h1>
					<div className="flex flex-wrap gap-2">
						{[
							{
								id: 'overview' as const,
								label: 'Overview',
								count:
									pendingChannels.length +
									passwordResetRequests.length +
									users.length,
							},
							{
								id: 'reports' as const,
								label: 'Reports',
								count: reports.length,
							},
							{
								id: 'audit' as const,
								label: 'Audit Log',
								count: auditEvents.length,
							},
						].map((tab) => (
							<button
								key={tab.id}
								type="button"
								onClick={() => setActiveTab(tab.id)}
								className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
									activeTab === tab.id
										? 'bg-primary-600 text-white'
										: 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
								}`}
							>
								{tab.label}
								<span className="ml-2 rounded-full bg-black/10 px-2 py-0.5 text-xs dark:bg-white/10">
									{tab.count}
								</span>
							</button>
						))}
					</div>
				</div>

				{activeTab === 'overview' && (
					<>
						<section className="mb-8 rounded-2xl border border-primary-200 bg-primary-50 p-4 shadow-sm dark:border-primary-900/40 dark:bg-primary-900/10 sm:p-6">
							<div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
								<div className="min-w-0">
									<h2 className="text-lg font-semibold text-gray-900 dark:text-white sm:text-2xl">
										Data Snapshot Sync
									</h2>
									<p className="mt-2 max-w-3xl text-sm text-gray-600 dark:text-gray-300">
										Export the current local SQLite data and uploads, or push that snapshot directly to production using the server-side sync pipeline.
									</p>
									{dataSyncMessage && (
										<p className="mt-2 text-sm font-medium text-primary-700 dark:text-primary-200">
											{dataSyncMessage}
										</p>
									)}
								</div>
								<div className="flex flex-col gap-2 sm:flex-row">
									<button
										type="button"
										onClick={() => void exportLocalDataSnapshot()}
										disabled={dataSyncLoading}
										className="rounded-lg border border-primary-300 bg-white px-4 py-3 text-sm font-medium text-primary-700 transition hover:bg-primary-50 disabled:opacity-60 dark:border-primary-700 dark:bg-gray-900 dark:text-primary-200 dark:hover:bg-gray-800 sm:py-2"
									>
										Export Snapshot
									</button>
									<button
										type="button"
										onClick={() => void pushLocalDataToProduction()}
										disabled={dataSyncLoading}
										className="rounded-lg bg-primary-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-primary-700 disabled:opacity-60 sm:py-2"
									>
										{dataSyncLoading ? 'Syncing...' : 'Push to Production'}
									</button>
								</div>
							</div>
						</section>

						<section className="mb-8">
							<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
								<h2 className="text-lg font-semibold text-gray-900 dark:text-white sm:text-2xl">
									Add User
								</h2>
								<button
									onClick={() => {
										setIsAddUserOpen(true);
										setCreatedTempPassword(null);
									}}
									className="w-full rounded-lg bg-primary-600 px-4 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-primary-700 sm:w-auto sm:py-2 sm:text-left"
								>
									Add New User
								</button>
							</div>
						</section>

						<section className="mb-8">
							<h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white sm:text-2xl">
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
											className="rounded-lg bg-white p-4 shadow dark:bg-gray-800"
										>
											<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
												<div className="min-w-0 flex-1">
													<h3 className="break-words text-base font-bold text-gray-900 dark:text-white sm:text-lg">
														#{channel.name}
													</h3>
													<span
														className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${
															channel.isPrivate
																? 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
																: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200'
														}`}
													>
														{channel.isPrivate ? 'Private' : 'Public'}
													</span>
													<p className="mt-2 break-words text-sm text-gray-600 dark:text-gray-300">
														{channel.description}
													</p>
													<p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
														Created by {channel.creatorUsername} •{' '}
														{formatDate(new Date(channel.createdAt), dateFormat)}
													</p>
												</div>
												<div className="flex min-h-10 gap-2 sm:min-h-auto">
													<button
														onClick={() => approveChannel(channel.id)}
														className="flex flex-1 items-center justify-center rounded-lg bg-green-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-green-700 sm:flex-none sm:text-sm"
													>
														Approve
													</button>
													<button
														onClick={() => rejectChannel(channel.id)}
														className="flex flex-1 items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-red-700 sm:flex-none sm:text-sm"
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
							<h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white sm:text-2xl">
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
														className="h-10 w-10 flex-shrink-0 rounded-full"
													/>
													<div className="min-w-0">
														<div className="text-sm font-semibold text-gray-900 dark:text-white">
															{request.username || 'Unknown user'}
														</div>
														<div className="mt-1 break-words text-sm text-gray-600 dark:text-gray-300">
															{request.email}
														</div>
														<div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
															Requested{' '}
															{formatDate(
																new Date(request.requestedAt),
																dateFormat,
															)}
														</div>
													</div>
												</div>
												<button
													onClick={() => resolvePasswordResetRequest(request)}
													disabled={
														processingResetRequestId === request.id ||
														!request.userId
													}
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

						<section>
							<h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white sm:text-2xl">
								User Management ({users.length})
							</h2>
							<div className="overflow-x-auto rounded-lg bg-white shadow dark:bg-gray-800">
								<table className="w-full min-w-max sm:table-auto">
									<thead className="bg-gray-50 dark:bg-gray-700">
										<tr>
											<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300 sm:px-6">
												User
											</th>
											<th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300 sm:table-cell sm:px-6">
												Email
											</th>
											<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300 sm:px-6">
												Role
											</th>
											<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300 sm:px-6">
												Actions
											</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-gray-200 dark:divide-gray-700">
										{users.map((entry) => (
											<tr key={entry.id}>
												<td className="whitespace-nowrap px-4 py-3 sm:px-6 sm:py-4">
													<div className="flex min-w-0 items-center gap-2 sm:gap-3">
														<img
															src={entry.avatar || '/image.png'}
															alt={entry.username}
															className="h-8 w-8 flex-shrink-0 rounded-full"
														/>
														<span className="truncate text-xs font-medium text-gray-900 dark:text-white sm:text-sm">
															{entry.username}
														</span>
													</div>
												</td>
												<td className="hidden whitespace-nowrap px-4 py-3 text-xs text-gray-500 dark:text-gray-400 sm:table-cell sm:px-6 sm:py-4 sm:text-sm">
													{entry.email}
												</td>
												<td className="whitespace-nowrap px-4 py-3 sm:px-6 sm:py-4">
													<select
														value={entry.role}
														onChange={(e) => updateUserRole(entry.id, e.target.value)}
														title={`Role for ${entry.username}`}
														aria-label={`Role for ${entry.username}`}
														className="min-h-10 rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white sm:min-h-auto sm:py-1 sm:text-sm"
														disabled={String(entry.id) === String(user?.id)}
													>
														<option value="user">User</option>
														<option value="guest">Guest</option>
														<option value="manager">Manager</option>
														<option value="admin">Admin</option>
													</select>
												</td>
												<td className="whitespace-nowrap px-4 py-3 text-xs sm:px-6 sm:py-4 sm:text-sm">
													{String(entry.id) === String(user?.id) ? (
														<span className="text-gray-500 dark:text-gray-400">
															(You)
														</span>
													) : (
														<div className="flex items-center gap-1 sm:gap-2">
															<button
																onClick={() => openResetModal(entry)}
																className="rounded-lg border border-gray-300 px-2 py-2 text-xs text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700 sm:px-3"
															>
																Edit
															</button>
															<button
																onClick={() => deleteUser(entry)}
																disabled={deletingUserId === entry.id}
																className="rounded-lg bg-red-600 px-2 py-2 text-xs text-white transition-colors hover:bg-red-700 disabled:opacity-60 sm:px-3"
															>
																{deletingUserId === entry.id ? 'Del...' : 'Delete'}
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

						<section className="mt-8">
							<h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white sm:text-2xl">
								Workspace Emoji ({workspaceEmoji.length})
							</h2>
							<div className="rounded-xl bg-white p-4 shadow dark:bg-gray-800">
								<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr),minmax(0,1fr),auto]">
									<input
										type="text"
										value={emojiName}
										onChange={(e) => setEmojiName(e.target.value)}
										placeholder="emoji_name"
										className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
									/>
									<input
										type="file"
										accept="image/*"
										onChange={(e) => setEmojiFile(e.target.files?.[0] || null)}
										className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
									/>
									<button
										type="button"
										onClick={() => void uploadWorkspaceEmoji()}
										disabled={uploadingEmoji || !emojiName.trim() || !emojiFile}
										className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-700 disabled:opacity-60"
									>
										{uploadingEmoji ? 'Uploading...' : 'Upload'}
									</button>
								</div>

								<div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
									{workspaceEmoji.length === 0 ? (
										<div className="text-sm text-gray-500 dark:text-gray-400">
											No custom emoji uploaded yet.
										</div>
									) : (
										workspaceEmoji.map((emoji) => (
											<div
												key={emoji.id}
												className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-3 dark:border-gray-700"
											>
												<div className="flex min-w-0 items-center gap-3">
													<img
														src={emoji.imageUrl}
														alt={`:${emoji.name}:`}
														className="h-8 w-8 object-contain"
													/>
													<div className="min-w-0">
														<div className="truncate font-mono text-sm text-gray-900 dark:text-white">
															:{emoji.name}:
														</div>
														{emoji.createdAt && (
															<div className="text-xs text-gray-500 dark:text-gray-400">
																{new Date(emoji.createdAt).toLocaleString()}
															</div>
														)}
													</div>
												</div>
												<button
													type="button"
													onClick={() => void removeWorkspaceEmoji(emoji)}
													disabled={deletingEmojiId === emoji.id}
													className="rounded-lg border border-red-300 px-3 py-2 text-xs font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900/40 dark:text-red-300 dark:hover:bg-red-900/20 disabled:opacity-60"
												>
													{deletingEmojiId === emoji.id ? 'Deleting...' : 'Delete'}
												</button>
											</div>
										))
									)}
								</div>
							</div>
						</section>
					</>
				)}

				{activeTab === 'reports' && (
					<section className="mb-8">
						<h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white sm:text-2xl">
							Message Reports{' '}
							{reports.length > 0 && (
								<span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-sm font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">
									{reports.length}
								</span>
							)}
						</h2>
						{reports.length === 0 ? (
							<p className="text-sm text-gray-500 dark:text-gray-400">
								No pending reports.
							</p>
						) : (
							<div className="space-y-4">
								{reports.map((report) => (
									<div
										key={report.id}
										className="space-y-2 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
									>
										<div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
											<span className="font-medium text-gray-900 dark:text-white">
												{report.reporterUsername}
											</span>
											<span>reported a message</span>
											{report.senderUsername && (
												<span>
													from{' '}
													<span className="font-medium text-gray-700 dark:text-gray-300">
														{report.senderUsername}
													</span>
												</span>
											)}
											<span>·</span>
											<span>{new Date(report.createdAt).toLocaleString()}</span>
											{report.channelId && <span>· Channel #{report.channelId}</span>}
											{report.groupChatId && <span>· Group chat</span>}
											{report.recipientId && <span>· Direct message</span>}
										</div>
										{report.reason && (
											<p className="text-sm text-gray-600 dark:text-gray-300">
												<span className="font-medium">Reason:</span>{' '}
												{report.reason}
											</p>
										)}
										<div className="break-words rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
											{report.content || (
												<em className="text-gray-400">No content</em>
											)}
										</div>
										<div className="flex gap-2 pt-1">
											<button
												type="button"
												onClick={() => void actionReport(report.id, 'review')}
												disabled={actioningReportId === report.id}
												className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-60"
											>
												Mark reviewed
											</button>
											<button
												type="button"
												onClick={() => void actionReport(report.id, 'dismiss')}
												disabled={actioningReportId === report.id}
												className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700 disabled:opacity-60"
											>
												Dismiss
											</button>
										</div>
									</div>
								))}
							</div>
						)}
					</section>
				)}

				{activeTab === 'audit' && (
					<section className="mb-8">
						<div className="mb-4 flex items-center justify-between gap-3">
							<h2 className="text-lg font-semibold text-gray-900 dark:text-white sm:text-2xl">
								Audit Log
							</h2>
							<button
								type="button"
								onClick={() => void loadData()}
								className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
							>
								Refresh
							</button>
						</div>
						{auditEvents.length === 0 ? (
							<p className="text-sm text-gray-500 dark:text-gray-400">
								No audit events yet.
							</p>
						) : (
							<div className="space-y-3">
								{auditEvents.map((event) => {
									const metadataEntries = Object.entries(event.metadata || {});
									return (
										<div
											key={event.id}
											className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
										>
											<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
												<div className="flex min-w-0 items-start gap-3">
													<img
														src={event.actorAvatar || '/image.png'}
														alt={event.actorUsername}
														className="h-10 w-10 flex-shrink-0 rounded-full"
													/>
													<div className="min-w-0">
														<div className="flex flex-wrap items-center gap-2">
															<span className="text-sm font-semibold text-gray-900 dark:text-white">
																{event.actorUsername}
															</span>
															<span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-200">
																{formatAuditAction(event.action)}
															</span>
														</div>
														<div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
															{formatAuditTarget(event)}
														</div>
														{metadataEntries.length > 0 && (
															<div className="mt-2 flex flex-wrap gap-2">
																{metadataEntries.map(([key, value]) => (
																	<span
																		key={`${event.id}-${key}`}
																		className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-200"
																	>
																		{key}: {String(value)}
																	</span>
																))}
															</div>
														)}
													</div>
												</div>
												<div className="text-xs text-gray-500 dark:text-gray-400">
													{new Date(event.createdAt).toLocaleString()}
												</div>
											</div>
										</div>
									);
								})}
							</div>
						)}
					</section>
				)}

				{isAddUserOpen && (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-4 sm:py-0">
						<div className="my-auto w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900">
							<div className="mb-4 flex items-center justify-between">
								<h3 className="text-base font-semibold text-gray-900 dark:text-white sm:text-lg">
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
									className="-m-2 p-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
								>
									<XMarkIcon className="h-5 w-5" />
								</button>
							</div>

							<div className="mt-4 space-y-4">
								<input
									disabled={creatingUser || !!createdTempPassword}
									value={newUser.username}
									onChange={(e) =>
										setNewUser((prev) => ({
											...prev,
											username: e.target.value,
										}))
									}
									placeholder="Username"
									className="min-h-12 w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-base text-gray-900 transition-colors focus:border-transparent focus:ring-2 focus:ring-primary-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white sm:min-h-auto sm:py-2 sm:text-sm"
								/>
								<input
									disabled={creatingUser || !!createdTempPassword}
									value={newUser.email}
									onChange={(e) =>
										setNewUser((prev) => ({
											...prev,
											email: e.target.value,
										}))
									}
									type="email"
									placeholder="Email"
									className="min-h-12 w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-base text-gray-900 transition-colors focus:border-transparent focus:ring-2 focus:ring-primary-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white sm:min-h-auto sm:py-2 sm:text-sm"
								/>
								<select
									disabled={creatingUser || !!createdTempPassword}
									value={newUser.role}
									onChange={(e) =>
										setNewUser((prev) => ({
											...prev,
											role: e.target.value as 'user' | 'guest' | 'manager' | 'admin',
										}))
									}
									title="Role for new user"
									aria-label="Role for new user"
									className="min-h-12 w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-base text-gray-900 transition-colors focus:border-transparent focus:ring-2 focus:ring-primary-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white sm:min-h-auto sm:py-2 sm:text-sm"
								>
									<option value="user">User</option>
									<option value="guest">Guest</option>
									<option value="manager">Manager</option>
									<option value="admin">Admin</option>
								</select>
							</div>

							{createdTempPassword && (
								<div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-200">
									<p className="mb-2 text-xs sm:text-sm">
										Temporary password sent. Share this only if needed:
									</p>
									<div className="mt-2 break-all font-mono text-sm sm:text-base">
										{createdTempPassword}
									</div>
								</div>
							)}

							<div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-0">
								<button
									onClick={() => {
										setIsAddUserOpen(false);
										setNewUser({ username: '', email: '', role: 'user' });
										setCreatedTempPassword(null);
									}}
									className="min-h-12 rounded-lg border border-gray-300 px-4 py-3 font-medium text-gray-700 transition-colors dark:border-gray-700 dark:text-gray-300 sm:min-h-auto sm:py-2"
								>
									Cancel
								</button>
								<button
									onClick={createUser}
									disabled={creatingUser || !!createdTempPassword}
									className="mr-0 min-h-12 rounded-lg bg-primary-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-60 sm:mr-2 sm:min-h-auto sm:py-2"
								>
									{creatingUser ? 'Creating...' : 'Save'}
								</button>
							</div>
						</div>
					</div>
				)}

				{isResetModalOpen && resetUser && (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-4 sm:py-0">
						<div className="my-auto w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900">
							<div className="mb-4 flex items-center justify-between">
								<h3 className="text-base font-semibold text-gray-900 dark:text-white sm:text-lg">
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
									className="-m-2 p-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
								>
									<XMarkIcon className="h-5 w-5" />
								</button>
							</div>

							<div className="mt-4 space-y-3 text-xs text-gray-600 dark:text-gray-300 sm:text-sm">
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

							<div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-0">
								<button
									onClick={() => {
										setIsResetModalOpen(false);
										setResetUser(null);
										setResetSuccess(false);
									}}
									className="min-h-12 rounded-lg border border-gray-300 px-4 py-3 font-medium text-gray-700 transition-colors dark:border-gray-700 dark:text-gray-300 sm:min-h-auto sm:py-2"
								>
									Cancel
								</button>
								<button
									onClick={sendResetEmail}
									disabled={resettingUser}
									className="mr-0 min-h-12 rounded-lg bg-primary-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-60 sm:mr-2 sm:min-h-auto sm:py-2"
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
