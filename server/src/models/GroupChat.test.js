import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const tempDir = mkdtempSync(path.join(tmpdir(), 'gws-connect-test-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { createUser } = await import('./User.js');
const {
	createGroupChat,
	canAccessGroupChat,
	getGroupChatMembers,
	findGroupChatsForUser,
	removeGroupChatMember,
} = await import('./GroupChat.js');
const { createMessage, getGroupChatMessages } = await import('./Message.js');

let userA;
let userB;
let userC;

before(() => {
	userA = createUser('groupa', 'groupa@test.com', 'hashed', 'pub', 'priv', 'salt', 'iv');
	userB = createUser('groupb', 'groupb@test.com', 'hashed', 'pub', 'priv', 'salt', 'iv');
	userC = createUser('groupc', 'groupc@test.com', 'hashed', 'pub', 'priv', 'salt', 'iv');
});

after(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

test('createGroupChat adds the creator and given members', () => {
	const groupChatId = createGroupChat('Trio', userA, [userB, userC]);
	const members = getGroupChatMembers(groupChatId).map((member) => member.id);
	assert.deepEqual(members.sort(), [userA, userB, userC].sort());
});

test('canAccessGroupChat allows members and denies non-members', () => {
	const groupChatId = createGroupChat('Pair', userA, [userB]);
	assert.equal(canAccessGroupChat(groupChatId, userA).allowed, true);
	assert.equal(canAccessGroupChat(groupChatId, userB).allowed, true);
	assert.equal(canAccessGroupChat(groupChatId, userC).allowed, false);
});

test('findGroupChatsForUser only returns chats the user belongs to', () => {
	const groupChatId = createGroupChat('Just A and B', userA, [userB]);
	const forA = findGroupChatsForUser(userA).map((g) => g.id);
	const forC = findGroupChatsForUser(userC).map((g) => g.id);
	assert.ok(forA.includes(groupChatId));
	assert.ok(!forC.includes(groupChatId));
});

test('messages created with a groupChatId are scoped to that group', () => {
	const groupChatId = createGroupChat('Msg group', userA, [userB]);
	const otherGroupChatId = createGroupChat('Other group', userA, [userC]);

	createMessage('hello group', userA, null, null, null, null, null, null, null, null, 0, null, null, groupChatId);
	createMessage('other group message', userA, null, null, null, null, null, null, null, null, 0, null, null, otherGroupChatId);

	const messages = getGroupChatMessages(groupChatId);
	assert.equal(messages.length, 1);
	assert.equal(messages[0].content, 'hello group');
});

test('removeGroupChatMember revokes access', () => {
	const groupChatId = createGroupChat('Leaveable', userA, [userB]);
	assert.equal(canAccessGroupChat(groupChatId, userB).allowed, true);
	removeGroupChatMember(groupChatId, userB);
	assert.equal(canAccessGroupChat(groupChatId, userB).allowed, false);
});
