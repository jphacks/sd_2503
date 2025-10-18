import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const YAHOO_APP_ID = env.PRIVATE_YAHOO_APP_ID;

export async function POST({ request }) {
  if (!YAHOO_APP_ID) {
    return json({ error: 'Yahoo App ID is not configured on the server. Check your .env file for PRIVATE_YAHOO_APP_ID.' }, { status: 500 });
  }

  const { sentence } = await request.json();

  if (!sentence) {
    return json({ error: 'Sentence to proofread is required.' }, { status: 400 });
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
      return json({ error: `Yahoo! 校正APIエラー: ${response.statusText}` }, { status: response.status });
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
