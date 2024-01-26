import FormData from 'form-data';
import axios from 'axios';

interface Response {
	error: boolean;
	success: boolean;
}

interface SuccessResponse extends Response {
	success: true;
	result: {
		filename: string;
		id: string;
		requiredSignedURLs: boolean;
		uploaded: boolean;
	};
}

interface ErrorResponse extends Response {
	success: false;
	message: string;
}

type ImageResponse = SuccessResponse | ErrorResponse;

export class CloudflareUploader {
	private readonly accountId: string;
	private readonly apiToken: string;

	constructor(accountId: string, apiToken: string) {
		if (!(accountId && apiToken)) throw new Error('You need to provide both the account id and the api token.');

		this.accountId = accountId;
		this.apiToken = apiToken;
	}

	private sendRequest = async (formData: FormData) => {
		const options = {
			method: 'POST',
			url: `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/images/v1`,
			headers: {
				'Content-Type': 'multipart/form-data',
				Authorization: `Bearer ${this.apiToken}`,
			},
			data: formData,
		};
		return (await axios.request(options))?.data;
	};

	public fromURL = (url: string): Promise<ImageResponse> => {
		return new Promise((resolve, reject) => {
			const formData = new FormData();
			formData.append('url', url);
			this.sendRequest(formData)
				.then((data) => {
					resolve(data);
				})
				.catch((err) => {
					reject({
						message: err?.toString(),
					});
				});
		});
	};
}
