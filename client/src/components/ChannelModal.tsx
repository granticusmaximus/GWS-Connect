import { useState, useEffect } from 'react';
import { ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import axios from 'axios';
import { API_URL } from '../config/runtime';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';

interface Channel {
	id: number;
	name: string;
	description: string;
	isPrivate?: boolean;
	slowModeSeconds?: number;
	disappearingMessagesSeconds?: number;
	announcementOnly?: boolean;
}

interface ChannelModalProps {
	isOpen: boolean;
	onClose: () => void;
	onSuccess: () => void;
	channel?: Channel; // If provided, we're editing; otherwise creating
	mode: 'create' | 'edit';
}

export default function ChannelModal({
	isOpen,
	onClose,
	onSuccess,
	channel,
	mode,
}: ChannelModalProps) {
	const user = useAuthStore((state) => state.user);
	const createChannel = useChatStore((state) => state.createChannel);
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [isPrivate, setIsPrivate] = useState(false);
	const [slowModeSeconds, setSlowModeSeconds] = useState(0);
	const [disappearingMessagesSeconds, setDisappearingMessagesSeconds] = useState(0);
	const [announcementOnly, setAnnouncementOnly] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [toastMessage, setToastMessage] = useState('');

	useEffect(() => {
		if (mode === 'edit' && channel) {
			setName(channel.name);
			setDescription(channel.description);
			setIsPrivate(!!channel.isPrivate);
			setSlowModeSeconds(channel.slowModeSeconds || 0);
			setDisappearingMessagesSeconds(channel.disappearingMessagesSeconds || 0);
			setAnnouncementOnly(!!channel.announcementOnly);
		} else {
			setName('');
			setDescription('');
			setIsPrivate(false);
			setSlowModeSeconds(0);
			setDisappearingMessagesSeconds(0);
			setAnnouncementOnly(false);
		}
		setError('');
		setShowDeleteConfirm(false);
		setDeleting(false);
		setToastMessage('');
	}, [mode, channel, isOpen]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError('');

		if (!name.trim()) {
			setError('Channel name is required');
			return;
		}

		setLoading(true);

		try {
			if (mode === 'edit' && channel) {
				// Update existing channel
				await axios.put(
					`${API_URL}/manager/${channel.id}`,
					{
						name,
						description,
						isPrivate,
						slowModeSeconds,
						disappearingMessagesSeconds,
						announcementOnly,
					},
				);
				onSuccess();
				onClose();
			} else {
				// Create new channel
				const result = await createChannel(name, description, isPrivate);
				if (!result.ok) {
					setError(result.message || 'Failed to create channel');
					setLoading(false);
					return;
				}

				// Show success message based on user role
				if (user?.role === 'admin') {
					alert('Channel created successfully!');
				} else {
					alert(
						'Channel created and submitted for admin approval. You will be notified when it is approved.',
					);
				}

				onSuccess();
				onClose();
			}
		} catch (err: unknown) {
			console.error('Channel save error:', err);
			const error = err as { response?: { data?: { message?: string } } };
			setError(
				error.response?.data?.message ||
					'Failed to save channel. Please try again.',
			);
		} finally {
			setLoading(false);
		}
	};

	const handleDeleteChannel = async () => {
		if (!channel) return;
		setDeleting(true);
		setError('');

		try {
			await axios.delete(`${API_URL}/manager/${channel.id}`);
			setToastMessage(`Channel "${channel.name}" deleted`);
			onSuccess();
			setShowDeleteConfirm(false);
			setTimeout(() => {
				onClose();
				setToastMessage('');
			}, 1600);
		} catch (err: unknown) {
			console.error('Channel delete error:', err);
			const error = err as { response?: { data?: { message?: string } } };
			setError(
				error.response?.data?.message ||
					'Failed to delete channel. Please try again.',
			);
		} finally {
			setDeleting(false);
		}
	};

	if (!isOpen) return null;

	return (
		<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
			<div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6">
				<div className="flex items-center justify-between mb-4">
					<h2 className="text-xl font-bold text-gray-900 dark:text-white">
						{mode === 'edit' ? 'Edit Channel' : 'Create New Channel'}
					</h2>
					<button
						onClick={onClose}
						className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
						aria-label="Close"
					>
						<XMarkIcon className="w-6 h-6" />
					</button>
				</div>

				{toastMessage && (
					<div className="mb-4 rounded-lg bg-green-100 dark:bg-green-900/40 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-200 px-4 py-2 text-sm">
						{toastMessage}
					</div>
				)}

				<form onSubmit={handleSubmit}>
					<div className="space-y-4">
						{error && (
							<div className="bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-400 px-4 py-3 rounded">
								{error}
							</div>
						)}

						<div>
							<label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
								Channel Name
							</label>
							<input
								type="text"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="e.g., general, random, tech-talk"
								className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
								disabled={loading}
								maxLength={50}
							/>
							<p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
								No spaces or special characters (except hyphens)
							</p>
						</div>

						<div>
							<label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
								Description (optional)
							</label>
							<textarea
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder="What is this channel about?"
								rows={3}
								className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none"
								disabled={loading}
								maxLength={200}
							/>
							<p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
								{description.length}/200 characters
							</p>
						</div>

						<div>
							<label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
								Channel Visibility
							</label>
							<div className="flex items-center gap-3">
								<button
									type="button"
									onClick={() => setIsPrivate(false)}
									className={`flex-1 px-3 py-2 rounded-lg border transition-colors ${
										!isPrivate
											? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-200'
											: 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
									}`}
									disabled={loading || deleting}
								>
									Public
								</button>
								<button
									type="button"
									onClick={() => setIsPrivate(true)}
									className={`flex-1 px-3 py-2 rounded-lg border transition-colors ${
										isPrivate
											? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-200'
											: 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
									}`}
									disabled={loading || deleting}
								>
									Private
								</button>
							</div>
							<p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
								Private channels are visible to admins and approved members only.
							</p>
						</div>

						{mode === 'edit' && (
							<div>
								<label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
									Slow Mode
								</label>
								<select
									aria-label="Slow Mode"
									value={slowModeSeconds}
									onChange={(e) => setSlowModeSeconds(Number(e.target.value))}
									className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
									disabled={loading || deleting}
								>
									<option value={0}>Off</option>
									<option value={5}>5 seconds</option>
									<option value={10}>10 seconds</option>
									<option value={30}>30 seconds</option>
									<option value={60}>1 minute</option>
									<option value={300}>5 minutes</option>
									<option value={900}>15 minutes</option>
									<option value={3600}>1 hour</option>
								</select>
								<p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
									Members must wait between messages. Managers and admins are exempt.
								</p>
							</div>
						)}

						{mode === 'edit' && (
							<div>
								<label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
									Disappearing Messages
								</label>
								<select
									aria-label="Disappearing Messages"
									value={disappearingMessagesSeconds}
									onChange={(e) => setDisappearingMessagesSeconds(Number(e.target.value))}
									className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
									disabled={loading || deleting}
								>
									<option value={0}>Off</option>
									<option value={3600}>1 hour</option>
									<option value={86400}>1 day</option>
									<option value={604800}>7 days</option>
								</select>
								<p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
									New messages in this channel will automatically delete after this duration.
								</p>
							</div>
						)}

						{mode === 'edit' && (
							<div>
								<label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
									Announcement Channel
								</label>
								<div className="flex items-center gap-3">
									<button
										type="button"
										onClick={() => setAnnouncementOnly(false)}
										className={`flex-1 px-3 py-2 rounded-lg border transition-colors ${
											!announcementOnly
												? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-200'
												: 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
										}`}
										disabled={loading || deleting}
									>
										Off
									</button>
									<button
										type="button"
										onClick={() => setAnnouncementOnly(true)}
										className={`flex-1 px-3 py-2 rounded-lg border transition-colors ${
											announcementOnly
												? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-200'
												: 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
										}`}
										disabled={loading || deleting}
									>
										On
									</button>
								</div>
								<p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
									Only managers and admins can post. Members can read only.
								</p>
							</div>
						)}

						{mode === 'create' && user?.role !== 'admin' && (
							<div className="bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-400 dark:border-yellow-700 text-yellow-800 dark:text-yellow-400 px-4 py-3 rounded text-sm inline-flex items-start gap-2">
								<ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
								<span>Your channel will require admin approval before it becomes visible to others.</span>
							</div>
						)}
					</div>

					<div className="flex gap-3 mt-6">
						<button
							type="button"
							onClick={onClose}
							className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
							disabled={loading || deleting}
						>
							Cancel
						</button>
						{mode === 'edit' && (user?.role === 'admin' || user?.role === 'manager') && (
							<button
								type="button"
								onClick={() => setShowDeleteConfirm(true)}
								className="flex-1 px-4 py-2 border border-red-500 text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
								disabled={loading || deleting}
							>
								Delete
							</button>
						)}
						<button
							type="submit"
							className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
							disabled={loading || deleting}
						>
							{loading
								? 'Saving...'
								: mode === 'edit'
								  ? 'Save Changes'
								  : 'Create Channel'}
						</button>
					</div>
				</form>

				{showDeleteConfirm && channel && (
					<div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
						<div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-sm p-6">
							<h3 className="text-lg font-semibold text-gray-900 dark:text-white">
								Delete channel
							</h3>
							<p className="text-sm text-gray-600 dark:text-gray-300 mt-2">
								Are you sure you want to delete "{channel.name}"? This action
								cannot be undone.
							</p>
							<div className="flex gap-3 mt-6">
								<button
									type="button"
									onClick={() => setShowDeleteConfirm(false)}
									className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
									disabled={deleting}
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={handleDeleteChannel}
									className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
									disabled={deleting}
								>
									{deleting ? 'Deleting...' : 'Delete'}
								</button>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
