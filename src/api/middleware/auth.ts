import type { NextFunction, Request, Response } from 'express';

export function createBearerAuthMiddleware(token: string) {
	return (req: Request, res: Response, next: NextFunction): void => {
		const authHeader = req.headers.authorization;
		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			res.status(401).json({ error: 'Unauthorized' });
			return;
		}
		const value = authHeader.slice('Bearer '.length);
		if (value !== token) {
			res.status(403).json({ error: 'Forbidden' });
			return;
		}
		next();
	};
}
