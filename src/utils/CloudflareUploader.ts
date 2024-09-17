import FormData from 'form-data';
import axios from 'axios';
import { nanoid } from 'nanoid';
import { sleep } from 'openai/core';

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

	private async getImageDetails(id: string): Promise<number> {
		try {
			const url = `${this.baseUrl}/${this.accountId}/images/v1/${id}`;
			const headers = { Authorization: `Bearer ${this.apiToken}` };
			const response = await axios.get(url, { headers });
			return response.status;
		} catch (error) {
			return 500;
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
		let uniqueId = nanoid(10);
		let details = await this.getImageDetails(uniqueId);

		console.log(`Generated image ID is in use? ${details === 200 ? 'Yes' : 'No'}`);

		while (details === 200) {
			console.log(`Image ID ${uniqueId} already exists, generating a new ID...`);
			uniqueId = nanoid(10);
			details = await this.getImageDetails(uniqueId);
			await sleep(1000);
		}

		const formData = new FormData();
		formData.append('url', url);
		formData.append('id', uniqueId);
		formData.append('metadata', JSON.stringify(metadata));

		return this.sendRequest(formData);
	}
}
