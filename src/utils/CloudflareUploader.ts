import Cloudflare, { APIError, toFile } from 'cloudflare';
import { nanoid } from 'nanoid';

export interface CloudflareUploadSuccess {
	success: true;
	result: {
		id: string;
		filename: string;
		uploaded?: string;
		requireSignedURLs?: boolean;
		variants: string[];
	};
}

export interface CloudflareUploadError {
	success: false;
	errors: { message: string }[];
}

export type CloudflareUploadResponse = CloudflareUploadSuccess | CloudflareUploadError;

function truncateText(input: string, maxLength: number): string {
	if (input.length <= maxLength) {
		return input;
	}
	return `${input.slice(0, maxLength - 3)}...`;
}

function redactSensitiveData(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => redactSensitiveData(entry));
	}
	if (value && typeof value === 'object') {
		const redacted: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			if (/token|authorization|secret|api[_-]?key/i.test(key)) {
				redacted[key] = '[redacted]';
				continue;
			}
			redacted[key] = redactSensitiveData(entry);
		}
		return redacted;
	}
	return value;
}

function payloadDiagnostics(payload: unknown): string {
	try {
		const serialized = JSON.stringify(redactSensitiveData(payload));
		return truncateText(serialized, 350);
	} catch {
		return '[unserializable payload]';
	}
}

export class CloudflareUploader {
	private readonly client: Cloudflare;

	constructor(
		private accountId: string,
		private apiToken: string,
	) {
		if (!accountId || !apiToken) {
			throw new Error('Cloudflare account ID and API token are required.');
		}
		this.client = new Cloudflare({
			apiToken,
			maxRetries: 0,
		});
	}

	private normalizeSuccessResponse(image: {
		id?: string;
		filename?: string;
		uploaded?: string;
		requireSignedURLs?: boolean;
		variants?: string[];
	}): CloudflareUploadResponse {
		if (!image.id) {
			return {
				success: false,
				errors: [
					{
						message: `Cloudflare API returned a success payload without image id (raw=${payloadDiagnostics(image)}).`,
					},
				],
			};
		}
		const result: CloudflareUploadSuccess['result'] = {
			id: image.id,
			filename: image.filename ?? `${image.id}.png`,
			variants: image.variants ?? [],
		};
		if (image.uploaded) {
			result.uploaded = image.uploaded;
		}
		if (typeof image.requireSignedURLs === 'boolean') {
			result.requireSignedURLs = image.requireSignedURLs;
		}
		return { success: true, result };
	}

	private async sendRequest(params: {
		url?: string;
		file?: Awaited<ReturnType<typeof toFile>>;
		metadata: Record<string, unknown>;
		id: string;
	}): Promise<CloudflareUploadResponse> {
		try {
			const metadata = JSON.stringify(params.metadata);
			const createParams: {
				account_id: string;
				id: string;
				metadata: string;
				url?: string;
				file?: Awaited<ReturnType<typeof toFile>>;
			} = {
				account_id: this.accountId,
				id: params.id,
				metadata,
			};
			if (params.url) {
				createParams.url = params.url;
			}
			if (params.file) {
				createParams.file = params.file;
			}
			const result = await this.client.images.v1.create(createParams);
			return this.normalizeSuccessResponse(result);
		} catch (error) {
			if (error instanceof APIError) {
				const status = error.status ?? 'unknown';
				const messageSummary = error.errors
					.map((entry) => entry.message)
					.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
					.join('; ');
				const body = error.error ? ` body=${payloadDiagnostics(error.error)}` : '';
				return {
					success: false,
					errors: [
						{
							message: `Cloudflare API error: ${status}.${messageSummary ? ` errors=${messageSummary}.` : ''}${body}`,
						},
					],
				};
			}
			return { success: false, errors: [{ message: 'An unexpected error occurred during the upload process.' }] };
		}
	}

	public async uploadImageFromUrl(
		url: string,
		metadata: Record<string, unknown> = {},
	): Promise<CloudflareUploadResponse> {
		return this.sendRequest({
			url,
			metadata,
			id: nanoid(10),
		});
	}

	public async uploadImageFromBase64(
		base64: string,
		metadata: Record<string, unknown> = {},
	): Promise<CloudflareUploadResponse> {
		const buffer = Buffer.from(base64, 'base64');
		const file = await toFile(buffer, 'image.png', { type: 'image/png' });

		return this.sendRequest({
			file,
			metadata,
			id: nanoid(10),
		});
	}
}
