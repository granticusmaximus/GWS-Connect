import db from '../database.js';

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

const decodeHtmlEntities = (value = '') =>
	value
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>');

const normalizeWhitespace = (value = '') =>
	decodeHtmlEntities(String(value || ''))
		.replace(/\s+/g, ' ')
		.trim();

const readMetaContent = (html, key) => {
	const patterns = [
		new RegExp(
			`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`,
			'i',
		),
		new RegExp(
			`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["'][^>]*>`,
			'i',
		),
	];

	for (const pattern of patterns) {
		const match = html.match(pattern);
		if (match?.[1]) {
			return normalizeWhitespace(match[1]);
		}
	}

	return '';
};

const readTitle = (html) => {
	const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
	return match?.[1] ? normalizeWhitespace(match[1]) : '';
};

const readFavicon = (html) => {
	const match = html.match(
		/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/i,
	);
	return match?.[1] ? match[1].trim() : '';
};

const toAbsoluteUrl = (value, baseUrl) => {
	if (!value) {
		return null;
	}

	try {
		return new URL(value, baseUrl).toString();
	} catch {
		return null;
	}
};

const getCachedPreview = (url) =>
	db
		.prepare(
			`SELECT *
       FROM link_previews
       WHERE url = ?
         AND (expiresAt IS NULL OR datetime(expiresAt) > datetime('now'))`,
		)
		.get(url);

const upsertPreview = (preview) => {
	db.prepare(
		`INSERT INTO link_previews (
        url,
        resolvedUrl,
        title,
        description,
        imageUrl,
        siteName,
        faviconUrl,
        fetchedAt,
        expiresAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(url) DO UPDATE SET
        resolvedUrl = excluded.resolvedUrl,
        title = excluded.title,
        description = excluded.description,
        imageUrl = excluded.imageUrl,
        siteName = excluded.siteName,
        faviconUrl = excluded.faviconUrl,
        fetchedAt = CURRENT_TIMESTAMP,
        expiresAt = excluded.expiresAt`,
	).run(
		preview.url,
		preview.resolvedUrl,
		preview.title,
		preview.description,
		preview.imageUrl,
		preview.siteName,
		preview.faviconUrl,
		preview.expiresAt,
	);
};

export const getLinkPreview = async (rawUrl) => {
	const parsedUrl = new URL(String(rawUrl || '').trim());
	if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
		throw new Error('Only http and https URLs are supported');
	}

	const normalizedUrl = parsedUrl.toString();
	const cached = getCachedPreview(normalizedUrl);
	if (cached) {
		return cached;
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(normalizedUrl, {
			redirect: 'follow',
			headers: {
				'User-Agent': 'GWS-Connect-LinkPreview/1.0',
				Accept: 'text/html,application/xhtml+xml',
			},
			signal: controller.signal,
		});

		const resolvedUrl = response.url || normalizedUrl;
		const contentType = response.headers.get('content-type') || '';
		if (!response.ok || !contentType.toLowerCase().includes('text/html')) {
			const fallback = {
				url: normalizedUrl,
				resolvedUrl,
				title: parsedUrl.hostname,
				description: '',
				imageUrl: null,
				siteName: parsedUrl.hostname,
				faviconUrl: toAbsoluteUrl('/favicon.ico', resolvedUrl),
				expiresAt: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
			};
			upsertPreview(fallback);
			return fallback;
		}

		const html = await response.text();
		const preview = {
			url: normalizedUrl,
			resolvedUrl,
			title:
				readMetaContent(html, 'og:title') ||
				readMetaContent(html, 'twitter:title') ||
				readTitle(html) ||
				parsedUrl.hostname,
			description:
				readMetaContent(html, 'og:description') ||
				readMetaContent(html, 'description') ||
				readMetaContent(html, 'twitter:description') ||
				'',
			imageUrl: toAbsoluteUrl(
				readMetaContent(html, 'og:image') ||
					readMetaContent(html, 'twitter:image'),
				resolvedUrl,
			),
			siteName:
				readMetaContent(html, 'og:site_name') ||
				new URL(resolvedUrl).hostname ||
				parsedUrl.hostname,
			faviconUrl: toAbsoluteUrl(readFavicon(html) || '/favicon.ico', resolvedUrl),
			expiresAt: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
		};

		upsertPreview(preview);
		return preview;
	} finally {
		clearTimeout(timeoutId);
	}
};
