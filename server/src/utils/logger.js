import { sendErrorNotification } from '../services/errorReporter.js';

/**
 * Enhanced logger utility with email notification support
 * Provides specific error context including file location, function name, and request details
 */

const getStackInfo = () => {
	const stack = new Error().stack;
	const lines = stack.split('\n');
	// lines[0] = "Error", lines[1] = current function, lines[2] = caller
	const caller = lines[3] || '';
	const match = caller.match(/\((.+?):(\d+):(\d+)\)$/);

	if (match) {
		const filepath = match[1].replace(process.cwd(), '');
		const line = match[2];
		const column = match[3];
		return { filepath, line, column };
	}

	return { filepath: 'unknown', line: 'unknown', column: 'unknown' };
};

const parseStackTrace = (error) => {
	if (!error || !error.stack) return [];

	return error.stack
		.split('\n')
		.slice(1)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.slice(0, 10); // Limit to first 10 frames
};

/**
 * Log error with specific context and send email notification
 * @param {Error|string} error - The error object or message
 * @param {Object} context - Additional context object
 * @param {string} context.file - File name/path
 * @param {string} context.function - Function name
 * @param {string} context.route - API route (if applicable)
 * @param {string} context.operation - What operation was being performed
 * @param {Object} context.requestData - Request body/params
 * @param {Object} context.userId - User ID if applicable
 * @param {string} context.socketId - Socket ID if applicable
 * @param {string} context.channelId - Channel ID if applicable
 * @param {boolean} notifyByEmail - Whether to send email notification (default: true)
 */
export const logError = async (error, context = {}, notifyByEmail = true) => {
	try {
		const stackInfo = getStackInfo();
		const parsedStack = parseStackTrace(error);

		const errorLog = {
			timestamp: new Date().toISOString(),
			message: error?.message || String(error),
			errorType: error?.name || 'Error',
			location: {
				file: context.file || stackInfo.filepath,
				function: context.function || 'anonymous',
				line: stackInfo.line,
				column: stackInfo.column,
			},
			operation: context.operation || 'unknown',
			route: context.route || null,
			stackTrace: parsedStack,
			context: {
				userId: context.userId || null,
				socketId: context.socketId || null,
				channelId: context.channelId || null,
				requestData: context.requestData
					? sanitizeData(context.requestData)
					: null,
				additionalInfo: context.additionalInfo || null,
			},
			environment: process.env.NODE_ENV || 'development',
		};

		// Always log to console with formatted output
		console.error(
			`\n❌ ERROR "${errorLog.errorType}" at ${errorLog.location.file}:${errorLog.location.line}:${errorLog.location.column}\n`,
			`📍 Operation: ${errorLog.operation}`,
			`${context.route ? `\n🔗 Route: ${context.route}` : ''}`,
			`\n💬 Message: ${errorLog.message}\n`,
		);

		// Send detailed email if configured
		if (notifyByEmail && process.env.SMTP_HOST) {
			await sendErrorNotification({
				error,
				context: errorLog,
				activeUsers: context.activeUsers || [],
			});
		}

		return errorLog;
	} catch (loggingError) {
		// Fallback: don't let logging errors break the app
		console.error('Logging system error:', loggingError);
	}
};

/**
 * Sanitize sensitive data from request/context objects
 */
const sanitizeData = (data) => {
	if (!data || typeof data !== 'object') return data;

	const sanitized = JSON.parse(JSON.stringify(data));
	const sensitiveFields = [
		'password',
		'token',
		'jwt',
		'apiKey',
		'secret',
		'auth',
	];

	const stripSensitive = (obj) => {
		Object.keys(obj).forEach((key) => {
			if (sensitiveFields.some((field) => key.toLowerCase().includes(field))) {
				obj[key] = '[REDACTED]';
			} else if (typeof obj[key] === 'object' && obj[key] !== null) {
				stripSensitive(obj[key]);
			}
		});
	};

	stripSensitive(sanitized);
	return sanitized;
};

/**
 * Wrap an async function with automatic error logging
 * @param {Function} fn - Async function to wrap
 * @param {Object} config - Configuration object
 */
export const withErrorLogging = (fn, config = {}) => {
	return async (...args) => {
		try {
			return await fn(...args);
		} catch (error) {
			await logError(error, {
				file: config.file || 'wrapped-function',
				function: config.function || fn.name || 'anonymous',
				operation: config.operation,
				route: config.route,
				...config,
			});
			throw error; // Re-throw so caller knows about it
		}
	};
};

/**
 * Create a middleware for Express error handling
 */
export const errorLoggingMiddleware = (err, req, res, next) => {
	const errorLog = {
		file: 'middleware/errorHandler',
		function: 'errorLoggingMiddleware',
		route: `${req.method} ${req.path}`,
		operation: `${req.method} request to ${req.path}`,
		userId: req.user?.id || null,
		requestData: {
			method: req.method,
			path: req.path,
			query: req.query,
			params: req.params,
			body: sanitizeData(req.body),
		},
		additionalInfo: err.statusCode || err.status || 'unknown',
	};

	logError(err, errorLog, true);

	// Send appropriate response
	const statusCode = err.statusCode || err.status || 500;
	const message = statusCode === 500 ? 'Internal server error' : err.message;

	res.status(statusCode).json({
		error: message,
		...(process.env.NODE_ENV === 'development' && {
			details: err.message,
			stack: err.stack,
		}),
	});
};

/**
 * Socket.io error logging wrapper
 */
export const logSocketError = async (error, context = {}) => {
	const socketContext = {
		file: context.file || 'socket-handler',
		function: context.function || 'socket-event',
		socketId: context.socketId,
		userId: context.userId,
		channelId: context.channelId,
		operation: context.operation || `Socket event: ${context.eventName}`,
		...context,
	};

	return logError(error, socketContext, true);
};

export default {
	logError,
	withErrorLogging,
	errorLoggingMiddleware,
	logSocketError,
};
