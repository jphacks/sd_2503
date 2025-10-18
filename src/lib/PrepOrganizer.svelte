<script>
  // page-logic.js から organizeWithPREP 関数をインポートするために
  // ストアのインスタンスを作成します。
  // 本来は getContext/setContext や props で渡すのが望ましいですが、
  // ここではコンポーネント内で直接インスタンス化します。
  import { createInterviewStore } from './page-logic.js';

  const { organizeWithPREP } = createInterviewStore();

  let inputText = '';
  let resultText = '';
  let grammaticalErrors = [];

  let isLoading = false;
  let processError = '';

  async function handleOrganizeAndProofread() {
    if (!inputText.trim()) return;

    isLoading = true;
    processError = '';
    resultText = '';
    grammaticalErrors = [];

    // 1. PREP法で整理
    const organizedText = organizeWithPREP(inputText);
    if (!organizedText) {
      isLoading = false;
      return;
    }

    // 2. API経由で校正
    try {
      const response = await fetch('/api/proofread', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sentence: organizedText })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || `APIエラー: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.result && data.result.suggestions && data.result.suggestions.length > 0) {
        // オフセットの降順でソートして、後ろから置換していく
        const sortedSuggestions = data.result.suggestions.sort((a, b) => parseInt(b.offset, 10) - parseInt(a.offset, 10));

        let correctedText = organizedText;
        for (const suggestion of sortedSuggestions) {
          const start = parseInt(suggestion.offset, 10);
          const len = parseInt(suggestion.length, 10);
          const suggestionText = suggestion.suggestion || '';
          correctedText = correctedText.substring(0, start) + suggestionText + correctedText.substring(start + len);
        }
        resultText = correctedText;

        // 文法エラーのフィードバックを作成
        const newGrammaticalErrors = [];
        for (const suggestion of data.result.suggestions) {
          if (suggestion.rule === 'ら抜き') {
            newGrammaticalErrors.push(`「${suggestion.word}」は「ら抜き言葉」です。正しくは「${suggestion.suggestion}」です。`);
          }
          // 他のルールに関するフィードバックもここに追加可能
        }
        grammaticalErrors = newGrammaticalErrors;

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

  {#if grammaticalErrors && grammaticalErrors.length > 0}
    <div class="mt-4 p-4 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 rounded">
      <h3 class="font-bold mb-2">文法に関する指摘</h3>
      <ul class="list-disc list-inside">
        {#each grammaticalErrors as error}
          <li>{error}</li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
