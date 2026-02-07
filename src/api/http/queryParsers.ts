export function parseIntWithBounds(value: string | undefined, fallback: number, min: number, max: number): number {
	if (!value) {
		return fallback;
	}
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed)) {
		return fallback;
	}
	return Math.max(min, Math.min(parsed, max));
}

export function parseOptionalInt(value: string | undefined): number | null {
	if (!value) {
		return null;
	}
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed)) {
		return null;
	}
	return parsed;
}

export function parseOptionalDate(value: string | undefined): Date | null {
	if (!value) {
		return null;
	}
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return null;
	}
	return parsed;
}
