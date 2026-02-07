import { afterEach, describe, expect, it, vi } from 'vitest';

const cloudflareMocks = vi.hoisted(() => {
	const create = vi.fn();
	const toFile = vi.fn(async () => ({ name: 'image.png' }));

	class MockAPIError extends Error {
		status: number | undefined;
		headers: unknown;
		error: unknown;
		errors: Array<{ message?: string }>;

		constructor(status: number | undefined, error: unknown, message?: string, headers?: unknown) {
			super(message ?? 'Cloudflare API error');
			this.status = status;
			this.headers = headers;
			this.error = error;
			this.errors =
				typeof error === 'object' && error !== null && Array.isArray((error as { errors?: unknown }).errors)
					? ((error as { errors: Array<{ message?: string }> }).errors)
					: [];
		}
	}

	class MockCloudflare {
		images = { v1: { create } };

		constructor(_options: unknown) {}
	}

	return { create, toFile, MockAPIError, MockCloudflare };
});

vi.mock('cloudflare', () => ({
	default: cloudflareMocks.MockCloudflare,
	APIError: cloudflareMocks.MockAPIError,
	toFile: cloudflareMocks.toFile,
}));

import { CloudflareUploader } from '../../src/utils/CloudflareUploader';

describe('CloudflareUploader', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		cloudflareMocks.create.mockReset();
		cloudflareMocks.toFile.mockReset();
		cloudflareMocks.toFile.mockResolvedValue({ name: 'image.png' });
	});

	it('uploads base64 images through the SDK and preserves timestamp upload metadata', async () => {
		cloudflareMocks.create.mockResolvedValueOnce({
			id: 'img_123',
			uploaded: '2026-02-07T21:07:18.704Z',
			requireSignedURLs: false,
			variants: ['https://imagedelivery.net/example/img_123/public'],
		});

		const uploader = new CloudflareUploader('account-id', 'api-token');
		const result = await uploader.uploadImageFromBase64('aGVsbG8=', { style: 'glitch' });

		expect(cloudflareMocks.toFile).toHaveBeenCalledTimes(1);
		expect(cloudflareMocks.create).toHaveBeenCalledWith({
			account_id: 'account-id',
			id: expect.any(String),
			metadata: JSON.stringify({ style: 'glitch' }),
			file: expect.any(Object),
		});
		expect(result).toEqual({
			success: true,
			result: {
				id: 'img_123',
				filename: 'img_123.png',
				uploaded: '2026-02-07T21:07:18.704Z',
				requireSignedURLs: false,
				variants: ['https://imagedelivery.net/example/img_123/public'],
			},
		});
	});

	it('uploads URL images through the SDK', async () => {
		cloudflareMocks.create.mockResolvedValueOnce({
			id: 'img_abc',
			filename: 'custom-name.png',
			variants: ['https://imagedelivery.net/example/img_abc/public'],
		});

		const uploader = new CloudflareUploader('account-id', 'api-token');
		const result = await uploader.uploadImageFromUrl('https://example.com/image.png');

		expect(cloudflareMocks.toFile).not.toHaveBeenCalled();
		expect(cloudflareMocks.create).toHaveBeenCalledWith({
			account_id: 'account-id',
			id: expect.any(String),
			metadata: JSON.stringify({}),
			url: 'https://example.com/image.png',
		});
		expect(result).toEqual({
			success: true,
			result: {
				id: 'img_abc',
				filename: 'custom-name.png',
				variants: ['https://imagedelivery.net/example/img_abc/public'],
			},
		});
	});

	it('returns diagnostics when Cloudflare success payload is missing id', async () => {
		cloudflareMocks.create.mockResolvedValueOnce({
			filename: 'missing-id.png',
		});

		const uploader = new CloudflareUploader('account-id', 'api-token');
		const result = await uploader.uploadImageFromUrl('https://example.com/image.png');

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.errors[0]?.message).toContain('success payload without image id');
			expect(result.errors[0]?.message).toContain('raw=');
		}
	});

	it('maps API errors and redacts sensitive diagnostics', async () => {
		cloudflareMocks.create.mockRejectedValueOnce(
			new cloudflareMocks.MockAPIError(500, {
				errors: [{ message: 'upstream issue' }],
				apiKey: 'secret-value',
			}),
		);

		const uploader = new CloudflareUploader('account-id', 'api-token');
		const result = await uploader.uploadImageFromUrl('https://example.com/image.png');

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.errors[0]?.message).toContain('Cloudflare API error: 500.');
			expect(result.errors[0]?.message).toContain('upstream issue');
			expect(result.errors[0]?.message).toContain('[redacted]');
		}
	});

	it('handles unexpected non-API exceptions', async () => {
		cloudflareMocks.create.mockRejectedValueOnce(new Error('boom'));

		const uploader = new CloudflareUploader('account-id', 'api-token');
		const result = await uploader.uploadImageFromUrl('https://example.com/image.png');

		expect(result).toEqual({
			success: false,
			errors: [{ message: 'An unexpected error occurred during the upload process.' }],
		});
	});

	it('requires account id and token at construction time', () => {
		expect(() => new CloudflareUploader('', 'token')).toThrow('Cloudflare account ID and API token are required.');
		expect(() => new CloudflareUploader('account', '')).toThrow('Cloudflare account ID and API token are required.');
	});
});
