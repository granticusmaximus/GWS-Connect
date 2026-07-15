// Global per-user message rate limit (spam/flood protection). Unlike
// per-channel slow mode, this tracks a single bucket per user across every
// channel/DM/group at once, so it also catches a user flooding across many
// conversations rather than just one. In-memory only - same pattern as the
// callSessions/onlineUsers Maps in index.js - resets on server restart,
// which is fine for a "stop a burst right now" guard.
const BUCKET_CAPACITY = 10;
const REFILL_INTERVAL_MS = 2000; // 1 token every 2s (~30 msg/min sustained)

const buckets = new Map();

const getBucket = (userId) => {
	const key = String(userId);
	let bucket = buckets.get(key);

	if (!bucket) {
		bucket = { tokens: BUCKET_CAPACITY, lastRefillAt: Date.now() };
		buckets.set(key, bucket);
		return bucket;
	}

	const elapsedMs = Date.now() - bucket.lastRefillAt;
	const tokensToAdd = Math.floor(elapsedMs / REFILL_INTERVAL_MS);

	if (tokensToAdd > 0) {
		bucket.tokens = Math.min(BUCKET_CAPACITY, bucket.tokens + tokensToAdd);
		bucket.lastRefillAt = bucket.lastRefillAt + tokensToAdd * REFILL_INTERVAL_MS;
	}

	return bucket;
};

export const checkMessageRateLimit = (userId) => {
	const bucket = getBucket(userId);

	if (bucket.tokens <= 0) {
		return {
			allowed: false,
			reason: 'You are sending messages too quickly. Please slow down.',
		};
	}

	bucket.tokens -= 1;
	return { allowed: true };
};
