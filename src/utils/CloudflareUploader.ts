import axios from 'axios';
import FormData from 'form-data';
import { nanoid } from 'nanoid';
import { z } from 'zod';

export interface CloudflareUploadSuccess {
	success: true;
	result: {
		id: string;
		filename: string;
		uploaded: boolean;
		requiredSignedURLs: boolean;
	};
}

export interface CloudflareUploadError {
	success: false;
	errors: { message: string }[];
}

export type CloudflareUploadResponse = CloudflareUploadSuccess | CloudflareUploadError;

const uploadSuccessSchema = z.object({
	success: z.literal(true),
	result: z.object({
		id: z.string(),
		filename: z.string(),
		uploaded: z.boolean(),
		requiredSignedURLs: z.boolean(),
	}),
});

const uploadErrorSchema = z.object({
	success: z.literal(false),
	errors: z.array(z.object({ message: z.string() })),
});

const uploadResponseSchema = z.union([uploadSuccessSchema, uploadErrorSchema]);

export class CloudflareUploader {
	private readonly baseUrl = 'https://api.cloudflare.com/client/v4/accounts';

	constructor(
		private accountId: string,
		private apiToken: string,
	) {
		if (!accountId || !apiToken) {
			throw new Error('Cloudflare account ID and API token are required.');
		}
	}

	private async sendRequest(formData: FormData): Promise<CloudflareUploadResponse> {
		try {
			const url = `${this.baseUrl}/${this.accountId}/images/v1`;
			const headers = { ...formData.getHeaders(), Authorization: `Bearer ${this.apiToken}` };
			const response = await axios.post<unknown>(url, formData, { headers });
			const parsed = uploadResponseSchema.safeParse(response.data);
			if (!parsed.success) {
				return {
					success: false,
					errors: [{ message: 'Cloudflare API returned an invalid response payload.' }],
				};
			}
			return parsed.data;
		} catch (error) {
			if (axios.isAxiosError(error)) {
				return {
					success: false,
					errors: [{ message: `Cloudflare API error: ${error.response?.status} ${error.response?.statusText}` }],
				};
			} else {
				return { success: false, errors: [{ message: 'An unexpected error occurred during the upload process.' }] };
			}
		}
	}

	public async uploadImageFromUrl(
		url: string,
		metadata: Record<string, unknown> = {},
	): Promise<CloudflareUploadResponse> {
		const formData = new FormData();
		formData.append('url', url);
		formData.append('id', nanoid(10));
		formData.append('metadata', JSON.stringify(metadata));

		return this.sendRequest(formData);
	}

	public async uploadImageFromBase64(
		base64: string,
		metadata: Record<string, unknown> = {},
	): Promise<CloudflareUploadResponse> {
		const formData = new FormData();
		const buffer = Buffer.from(base64, 'base64');
		formData.append('file', buffer, { filename: 'image.png', contentType: 'image/png' });
		formData.append('id', nanoid(10));
		formData.append('metadata', JSON.stringify(metadata));

		return this.sendRequest(formData);
	}
}
