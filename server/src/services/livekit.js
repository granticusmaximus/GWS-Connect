import { AccessToken } from 'livekit-server-sdk';

// LiveKit room names are restricted to a safer character set than our
// internal callIds (which use ':' as a type-prefix separator, e.g.
// "voice:12", "dm:3-7") - derive a room name without touching the callId
// itself, since callId is still used for session/presence bookkeeping.
export const toLiveKitRoomName = (callId) => String(callId).replace(/:/g, '-');

export const isLiveKitConfigured = () =>
	Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);

export const mintLiveKitToken = async ({ roomName, userId, username }) => {
	const apiKey = process.env.LIVEKIT_API_KEY;
	const apiSecret = process.env.LIVEKIT_API_SECRET;

	if (!apiKey || !apiSecret) {
		throw new Error('LiveKit is not configured (missing LIVEKIT_API_KEY/LIVEKIT_API_SECRET)');
	}

	const token = new AccessToken(apiKey, apiSecret, {
		identity: String(userId),
		name: username,
		ttl: '4h',
	});

	token.addGrant({
		roomJoin: true,
		room: roomName,
		canPublish: true,
		canSubscribe: true,
	});

	return token.toJwt();
};
