import { findUserByUsername } from '../models/User.js';

const mentionRegex = /@([A-Za-z0-9._-]+)/g;

/**
 * Extract @mentions from message content
 * @param {string} content - The message content
 * @returns {string[]} Array of mentioned usernames
 */
export const extractMentions = (content) => {
	if (!content) return [];

	const mentions = [];
	let match;
	mentionRegex.lastIndex = 0;

	while ((match = mentionRegex.exec(content)) !== null) {
		mentions.push(match[1]);
	}

	return mentions;
};

/**
 * Get user IDs for mentioned usernames
 * @param {string[]} usernames - Array of usernames to look up
 * @returns {number[]} Array of user IDs for found users
 */
export const getMentionedUserIds = (usernames) => {
	const uniqueUsernames = [...new Set(usernames)];
	const userIds = [];

	for (const username of uniqueUsernames) {
		try {
			const user = findUserByUsername(username);
			if (user) {
				userIds.push(user.id);
			}
		} catch (error) {
			// User not found, skip
		}
	}

	return userIds;
};

/**
 * Check if text contains any mentions
 * @param {string} content - The message content
 * @returns {boolean}
 */
export const hasMentions = (content) => {
	mentionRegex.lastIndex = 0;
	return mentionRegex.test(content);
};
