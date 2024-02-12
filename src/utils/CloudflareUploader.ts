import FormData from 'form-data';
import axios from 'axios';
import { nanoid } from 'nanoid';

interface CloudflareUploadSuccess {
	success: true;
	result: {
		id: string;
		filename: string;
		uploaded: boolean;
		requiredSignedURLs: boolean;
	};
}

interface CloudflareUploadError {
	success: false;
	errors: { message: string }[];
}

type CloudflareUploadResponse = CloudflareUploadSuccess | CloudflareUploadError;

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
			const response = await axios.post(url, formData, { headers });
			return response.data;
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
}
