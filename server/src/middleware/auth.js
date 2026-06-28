import jwt from 'jsonwebtoken';
import { getActiveSession, touchSessionLastSeen } from '../models/Session.js';

const getJwtSecret = () => {
	const secret = process.env.JWT_SECRET;
	if (!secret) {
		throw new Error('JWT_SECRET environment variable is required');
	}
	return secret;
};

export const authenticateToken = (req, res, next) => {
	const authHeader = req.headers['authorization'];
	const headerToken = authHeader && authHeader.split(' ')[1];
	const token = headerToken;

	if (!token) {
		console.warn('Auth missing token:', req.method, req.originalUrl);
		return res.status(401).json({ message: 'Access token required' });
	}

	let jwtSecret;
	try {
		jwtSecret = getJwtSecret();
	} catch (error) {
		console.error('Auth configuration error:', error.message);
		return res.status(500).json({ message: 'Server configuration error' });
	}

	jwt.verify(token, jwtSecret, (err, user) => {
		if (err) {
			console.warn(
				'Auth invalid token:',
				err.name,
				req.method,
				req.originalUrl,
			);
			return res.status(403).json({ message: 'Invalid or expired token' });
		}

		// A valid signature isn't enough on its own - the session backing this
		// token must still be active, otherwise revoking a stolen/lost device
		// would do nothing until the token's 7-day expiry naturally arrives.
		if (!getActiveSession(user.sid)) {
			return res
				.status(401)
				.json({ message: 'Session expired or revoked, please log in again' });
		}
		touchSessionLastSeen(user.sid);

		req.user = user;
		next();
	});
};

export const authenticateSocket = (socket, next) => {
	const token = socket.handshake.auth.token;

	if (!token) {
		return next(new Error('Authentication error'));
	}

	let jwtSecret;
	try {
		jwtSecret = getJwtSecret();
	} catch {
		return next(new Error('Server configuration error'));
	}

	jwt.verify(token, jwtSecret, (err, user) => {
		if (err) {
			return next(new Error('Authentication error'));
		}

		if (!getActiveSession(user.sid)) {
			return next(new Error('Authentication error'));
		}
		touchSessionLastSeen(user.sid);

		socket.user = user;
		next();
	});
};
