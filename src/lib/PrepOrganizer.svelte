<script>
  // page-logic.js から organizeWithPREP 関数をインポートするために
  // ストアのインスタンスを作成します。
  // 本来は getContext/setContext や props で渡すのが望ましいですが、
  // ここではコンポーネント内で直接インスタンス化します。
  import { createInterviewStore } from './page-logic.js';

  const { organizeWithPREP } = createInterviewStore();

  let inputText = '';
  let resultText = '';

  let isLoading = false;
  let processError = '';

  async function handleOrganizeAndProofread() {
    if (!inputText.trim()) return;

    isLoading = true;
    processError = '';
    resultText = '';

    const yahooAppId = import.meta.env.VITE_YAHOO_APP_ID;
    if (!yahooAppId) {
      processError = 'Yahoo! JAPANのアプリケーションIDが設定されていません。';
      isLoading = false;
      return;
    }

    // 1. PREP法で整理
    const organizedText = organizeWithPREP(inputText);
    if (!organizedText) {
      isLoading = false;
      return;
    }

    // 2. Yahoo! APIで校正
    try {
      const response = await fetch('https://jlp.yahooapis.jp/KouseiService/V2/kousei', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `Yahoo AppID: ${yahooAppId}`
        },
        body: JSON.stringify({
          id: '1',
          jsonrpc: '2.0',
          method: 'jlp.kouseiservice.v2.kousei',
          params: { q: organizedText }
        })
      });

      if (!response.ok) throw new Error(`APIエラー: ${response.statusText}`);

      const data = await response.json();
      if (data.result && data.result.suggestions) {
        let parts = [];
        let lastIndex = 0;
        // start_posが小さい順にソートされていることを前提とする
        for (const suggestion of data.result.suggestions) {
          parts.push(organizedText.substring(lastIndex, suggestion.start_pos));
          parts.push(suggestion.suggestion);
          lastIndex = suggestion.start_pos + suggestion.length;
        }
        parts.push(organizedText.substring(lastIndex));
        resultText = parts.join('');
      } else {
        // 校正候補がない場合は、PREP整理後のテキストをそのまま表示
        resultText = organizedText;
      }
    } catch (error) {
      processError = `処理中にエラーが発生しました: ${error.message}`;
    } finally {
      isLoading = false;
    }
  }
</script>

<div class="prep-organizer my-8 p-6 border rounded-lg shadow-md bg-gray-50">
  <h2 class="text-2xl font-bold mb-4 text-gray-800">PREP法 構成チェッカー</h2>
  <p class="mb-4 text-gray-600">
    自己PRや志望動機などを下のテキストエリアに入力し、「整理と校正」ボタンを押してください。<br />
    PREP法（結論→理由→具体例→再結論）の構成に並べ替え、文章の校正を行います。
  </p>
  <textarea
    bind:value={inputText}
    class="w-full h-48 p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
    placeholder="ここに文章を入力してください..."
  />
  <div class="mt-4">
    <button on:click={handleOrganizeAndProofread} disabled={isLoading} class="px-6 py-2 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors disabled:bg-gray-400">
      {#if isLoading}
        処理中...
      {:else}
        整理と校正
      {/if}
    </button>
  </div>

  {#if processError}
    <p class="mt-4 text-red-600">{processError}</p>
  {/if}

  {#if resultText}
    <div class="mt-6 p-4 border-t border-gray-200">
      <h3 class="text-xl font-bold mb-2 text-gray-800">整理・校正後の文章</h3>
      <p class="p-4 bg-white border rounded-md text-gray-700 whitespace-pre-wrap">{resultText}</p>
    </div>
  {/if}
</div>