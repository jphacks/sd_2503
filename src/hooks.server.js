
import { building } from '$app/environment';

/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
	const response = await resolve(event);
	response.headers.set('X-Frame-Options', 'SAMEORIGIN');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

	// 事前レンダリングされるページには、ハイドレーションの問題を避けるためCSPヘッダーを追加しません。
	if (!building) {
		response.headers.set(
			'Content-Security-Policy',
			"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:;"
		);
	}

	return response;
}
