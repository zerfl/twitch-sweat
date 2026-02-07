import { env } from '../env';

function trimTrailingSlashes(input: string): string {
	return input.replace(/\/+$/, '');
}

export function buildPublicCloudflareUrl(imageId: string): string {
	const trimmedId = imageId.trim();
	if (!trimmedId) {
		throw new Error('Cloudflare image id is required');
	}
	return `${trimTrailingSlashes(env.CLOUDFLARE_IMAGES_URL)}/${trimmedId}.png`;
}

function extractFromImagedeliveryUrl(parsed: URL): string | null {
	const hostname = parsed.hostname.toLowerCase();
	if (hostname !== 'imagedelivery.net' && !hostname.endsWith('.imagedelivery.net')) {
		return null;
	}
	const segments = parsed.pathname.split('/').filter(Boolean);
	if (segments.length < 2) {
		return null;
	}
	const id = segments[1];
	return id && id.trim().length > 0 ? id : null;
}

function extractFromLegacyPublicUrl(parsed: URL): string | null {
	const publicBase = new URL(env.CLOUDFLARE_IMAGES_URL);
	if (parsed.origin !== publicBase.origin) {
		return null;
	}
	const normalizedBasePath = publicBase.pathname.replace(/\/+$/, '');
	const requiredPrefix = normalizedBasePath ? `${normalizedBasePath}/` : '/';
	if (!parsed.pathname.startsWith(requiredPrefix)) {
		return null;
	}
	const relativePath = parsed.pathname.slice(requiredPrefix.length);
	if (!relativePath.endsWith('.png')) {
		return null;
	}
	const imageId = relativePath.slice(0, -4);
	if (!imageId || imageId.includes('/')) {
		return null;
	}
	return imageId;
}

export function extractCloudflareImageIdFromStoredUrl(storedUrl: string): string {
	let parsed: URL;
	try {
		parsed = new URL(storedUrl);
	} catch {
		throw new Error(`Unable to parse Cloudflare stored URL: ${storedUrl}`);
	}

	const imagedeliveryId = extractFromImagedeliveryUrl(parsed);
	if (imagedeliveryId) {
		return imagedeliveryId;
	}

	const legacyId = extractFromLegacyPublicUrl(parsed);
	if (legacyId) {
		return legacyId;
	}

	throw new Error(`Unable to extract Cloudflare image id from URL: ${storedUrl}`);
}

export function toPublicCloudflareUrlFromStored(storedUrl: string): string {
	return buildPublicCloudflareUrl(extractCloudflareImageIdFromStoredUrl(storedUrl));
}
