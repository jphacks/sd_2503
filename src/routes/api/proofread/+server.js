import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const YAHOO_APP_ID = env.PRIVATE_YAHOO_APP_ID;

// Simple in-memory store for rate limiting
const rateLimitStore = new Map();

export async function POST({ request, getClientAddress }) {
  // Rate limiting
  const ip = getClientAddress();
  const now = Date.now();
  const limit = 5; // 5 requests
  const windowMs = 60 * 1000; // 1 minute

  const records = rateLimitStore.get(ip) || [];
  const recordsInWindow = records.filter(timestamp => now - timestamp < windowMs);

  if (recordsInWindow.length >= limit) {
    return json({ error: 'Too many requests, please try again later.' }, { status: 429 });
  }

  recordsInWindow.push(now);
  rateLimitStore.set(ip, recordsInWindow);


  if (!YAHOO_APP_ID) {
    return json({ error: 'Yahoo App ID is not configured on the server. Check your .env file for PRIVATE_YAHOO_APP_ID.' }, { status: 500 });
  }

  let { sentence } = await request.json();

  if (!sentence) {
    return json({ error: 'Sentence to proofread is required.' }, { status: 400 });
  }

  // Sanitize sentence: remove control characters to prevent potential injection attacks
  sentence = sentence.replace(/[\x00-\x1F\x7F]/g, '');

  if (sentence.length > 2000) {
	return json({ error: 'Sentence is too long. Please limit it to 2000 characters.' }, { status: 400 });
  }

  try {
    const response = await fetch('https://jlp.yahooapis.jp/KouseiService/V2/kousei', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `Yahoo AppID: ${YAHOO_APP_ID}`
      },
      body: JSON.stringify({
        id: '1',
        jsonrpc: '2.0',
        method: 'jlp.kouseiservice.kousei',
        params: { q: sentence }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Yahoo! 校正APIエラー: ${response.statusText}`, errorText);
      // 内部の詳細が漏洩するのを防ぐため、クライアントには汎用的なエラーメッセージを返す
      return json({ error: 'An error occurred while communicating with the proofreading service.' }, { status: 500 });
    }

    const data = await response.json();
    console.log("data", data);
    console.log("Response from Yahoo API:", JSON.stringify(data, null, 2));
    return json(data);

  } catch (error) {
    console.error("Yahoo! 校正APIの呼び出し中にサーバーでエラーが発生しました:", error);
    return json({ error: 'Failed to fetch from Yahoo API on the server.' }, { status: 500 });
  }
}
