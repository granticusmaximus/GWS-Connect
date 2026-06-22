import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const tempDir = mkdtempSync(path.join(tmpdir(), 'gws-connect-test-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { createUser } = await import('./User.js');
const { createMessage, togglePinMessage, getPinnedMessages, searchMessages } = await import('./Message.js');

let senderId;
let recipientId;

before(() => {
	senderId = createUser('sender', 'sender@test.com', 'hashed', 'pub', 'priv', 'salt', 'iv');
	recipientId = createUser('recipient', 'recipient@test.com', 'hashed', 'pub', 'priv', 'salt', 'iv');
});

after(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

test('togglePinMessage pins and unpins a direct message', () => {
	const messageId = createMessage('hello there', senderId, null, recipientId);

	const pinned = togglePinMessage(messageId, senderId);
	assert.equal(pinned.isPinned, 1);

	const pinnedList = getPinnedMessages(null, recipientId, senderId);
	assert.equal(pinnedList.length, 1);
	assert.equal(pinnedList[0].id, messageId);

	const unpinned = togglePinMessage(messageId, senderId);
	assert.equal(unpinned.isPinned, 0);

	const afterUnpin = getPinnedMessages(null, recipientId, senderId);
	assert.equal(afterUnpin.length, 0);
});

test('togglePinMessage returns null for a missing message', () => {
	assert.equal(togglePinMessage(999999, senderId), null);
});

test('searchMessages finds matching direct messages and excludes encrypted ones', () => {
	createMessage('the quick brown fox', senderId, null, recipientId);
	createMessage('nothing relevant', senderId, null, recipientId);
	// Even if an encrypted row somehow retained plaintext content, search must exclude it.
	createMessage(
		'quick encrypted decoy',
		senderId,
		null,
		recipientId,
		null,
		null,
		null,
		null,
		'cipher-blob',
		'iv-blob',
		1,
	);

	const results = searchMessages('quick', { recipientId, currentUserId: senderId });
	assert.equal(results.length, 1);
	assert.match(results[0].content, /quick brown fox/);
});
