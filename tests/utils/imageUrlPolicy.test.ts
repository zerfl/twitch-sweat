import { describe, expect, it } from 'vitest';
import {
	buildPublicCloudflareUrl,
	extractCloudflareImageIdFromStoredUrl,
	toPublicCloudflareUrlFromStored,
} from '../../src/utils/imageUrlPolicy';

describe('imageUrlPolicy', () => {
	it('extracts id from imagedelivery variant URL', () => {
		expect(extractCloudflareImageIdFromStoredUrl('https://imagedelivery.net/account123/my-image-id/public')).toBe('my-image-id');
	});

	it('extracts id from configured legacy/public URL', () => {
		const stored = buildPublicCloudflareUrl('legacy-id');
		expect(extractCloudflareImageIdFromStoredUrl(stored)).toBe('legacy-id');
	});

	it('builds canonical public URL from id', () => {
		const normalizedBase = process.env.CLOUDFLARE_IMAGES_URL!.replace(/\/+$/, '');
		expect(buildPublicCloudflareUrl('abc123')).toBe(`${normalizedBase}/abc123.png`);
	});

	it('translates stored variant URL to canonical public URL', () => {
		const stored = 'https://imagedelivery.net/account123/variant-id/public';
		const normalizedBase = process.env.CLOUDFLARE_IMAGES_URL!.replace(/\/+$/, '');
		expect(toPublicCloudflareUrlFromStored(stored)).toBe(`${normalizedBase}/variant-id.png`);
	});

	it('throws for unsupported URL format', () => {
		expect(() => extractCloudflareImageIdFromStoredUrl('https://example.com/not-cloudflare.jpg')).toThrow(
			'Unable to extract Cloudflare image id from URL',
		);
	});
});
