<script>
  import { onMount, onDestroy, tick } from "svelte";
  import { createInterviewStore } from "$lib/page-logic.js";
  import PrepOrganizer from "../lib/PrepOrganizer.svelte";
  import { writable } from 'svelte/store';

  const store = createInterviewStore();
  const {
    // Stores
    recording,
    analysis,
    transcript,
    videoURL,
    currentQuestion,
    questionInProgress,
    questions,
    editingQuestions,
    // Methods
    init,
    startRecording,
    stopRecording,
    nextQuestion,
    addQuestion,
    deleteQuestion,
    destroy,
    speakingRateLabel
  } = store;

  let videoElement;
  let newQuestionInput = "";
  let radarCanvas;
  let isEditingQuestions = false;
  // 面接のコツ表示用のローカルstore
  const knacks = writable(false);
  let isKnacks = false;
  knacks.subscribe(v => isKnacks = v);

  // subscribe to editingQuestions store to avoid using $editingQuestions shorthand
  editingQuestions.subscribe(v => isEditingQuestions = v);

  onMount(() => {
    init(videoElement);
    nextQuestion();
  });

  onDestroy(() => {
    destroy();
  });

  function handleAddQuestion() {
    addQuestion(newQuestionInput);
    newQuestionInput = "";
  }

  // $: リアクティブ宣言で、analysisが更新されたらグラフを描画
  $: if ($analysis && $analysis.radarChartData) {
    (async () => {
      await tick(); // DOMの更新を待つ
      drawRadarChart($analysis.radarChartData);
    })();
  }

  function drawRadarChart(chartData) {
    if (!radarCanvas) return;
    const ctx = radarCanvas.getContext('2d');
    const width = radarCanvas.width;
    const height = radarCanvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 * 0.65;
    const levels = 5;
    const sides = chartData.labels.length;

    // 背景をクリア
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height);

    // グリッドを描画
    ctx.strokeStyle = '#e5e7eb'; // gray-200
    ctx.lineWidth = 1;
    for (let level = 1; level <= levels; level++) {
      ctx.beginPath();
      for (let i = 0; i < sides; i++) {
        const angle = (i / sides) * 2 * Math.PI - Math.PI / 2;
        const r = radius * (level / levels);
        const x = centerX + r * Math.cos(angle);
        const y = centerY + r * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // 軸を描画
    ctx.strokeStyle = '#d1d5db'; // gray-300
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * 2 * Math.PI - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle));
      ctx.stroke();
    }

    // ラベルを描画
    ctx.fillStyle = '#374151'; // gray-700
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    chartData.labels.forEach((label, i) => {
      const angle = (i / sides) * 2 * Math.PI - Math.PI / 2;
      const r = radius * 1.15;
      const x = centerX + r * Math.cos(angle);
      const y = centerY + r * Math.sin(angle);
      ctx.fillText(label, x, y);
    });

    // データセットを描画
    chartData.datasets.forEach(dataset => {
      ctx.beginPath();
      dataset.data.forEach((value, i) => {
        const angle = (i / sides) * 2 * Math.PI - Math.PI / 2;
        const r = radius * (value / levels);
        const x = centerX + r * Math.cos(angle);
        const y = centerY + r * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      
      ctx.fillStyle = dataset.backgroundColor || 'rgba(59, 130, 246, 0.2)';
      ctx.fill();
      ctx.strokeStyle = dataset.borderColor || 'rgba(59, 130, 246, 1)';
      ctx.lineWidth = dataset.borderWidth || 2;
      ctx.stroke();
    });
  }

</script>

<main class="max-w-6xl mx-auto p-8">
  <h1 class="text-3xl font-bold text-center">Re:view</h1>

  <div class="mt-8 flex flex-col md:flex-row gap-8">
    <!-- メインコンテンツ (左側) -->
    <div class="flex-grow flex flex-col gap-8">
      <!-- Video Feed -->
      <section class="bg-white rounded-lg shadow-md p-6">
        <h2 class="text-2xl font-semibold mb-4">{$videoURL && !$recording ? '録画の再生' : 'カメラ映像'}</h2>
        
        {#if $videoURL && !$recording}
          <!-- svelte-ignore a11y-media-has-caption -->
          <video src={$videoURL} controls class="w-full h-auto rounded-md bg-gray-900"></video>
        {:else}
          <!-- svelte-ignore a11y-media-has-caption -->
          <video bind:this={videoElement} autoplay muted playsinline class="w-full h-auto rounded-md bg-gray-900"></video>
        {/if}
      </section>

      <!-- Controls -->
      <section class="bg-white rounded-lg shadow-md p-6">
        <h2 class="text-2xl font-semibold mb-4">コントロール</h2>

        <div class="flex flex-col md:flex-row md:items-center gap-4">
          <div class="flex items-center gap-4 flex-shrink-0">
            <button
              on:click={nextQuestion}
              class="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded transition-colors"
              disabled={$questions.length === 0 || $recording}
              aria-disabled={$questions.length === 0 || $recording}
            >
              次の質問へ
            </button>

            <button
              on:click={$recording ? stopRecording : startRecording}
              class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-colors"
              disabled={!$currentQuestion && !$questionInProgress}
              aria-pressed={$recording}
            >
              {$recording ? "録画停止" : "回答を録画"}
            </button>
          </div>

          <div class="flex-grow">
            <!-- 録画再生エリアはカメラ映像のセクションに統合された -->
          </div>
        </div>

        {#if $recording}
          <p class="mt-4 text-red-500 font-bold animate-pulse">録画中...</p>
        {/if}
      </section>

      {#if $currentQuestion}
        <section class="bg-white rounded-lg shadow-md p-6">
          <h2 class="text-2xl font-semibold mb-4">質問</h2>
          <p class="text-lg text-gray-800">{$currentQuestion}</p>
        </section>
      {/if}

      <!-- 文字起こし -->
      {#if $transcript}
        <section class="bg-white rounded-lg shadow-md p-6">
          <h2 class="text-2xl font-semibold mb-4">文字起こし結果</h2>
          <p class="text-gray-700 whitespace-pre-wrap">{$transcript}</p>
        </section>
      {/if}

      <!-- 分析結果 -->
      {#if $analysis}
        {@const rateLabel = speakingRateLabel($analysis.speakingRate)}
        <section class="bg-white rounded-lg shadow-md p-6">
          <h2 class="text-2xl font-semibold mb-4">分析結果</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="bg-gray-100 p-4 rounded">
              <h3 class="font-bold mb-2">口癖</h3>
              {#if $analysis.fillerWords.length > 0}
                <ul class="list-disc list-inside">
                  {#each $analysis.fillerWords as word}
                    <li>{word}</li>
                  {/each}
                </ul>
              {:else}
                <p>口癖は見つかりませんでした。</p>
              {/if}
            </div>

            <div class="bg-gray-100 p-4 rounded">
              <h3 class="font-bold mb-2 flex items-center">
                <span>話す速さ</span>
                {#if rateLabel === 'good'}
                  <span class="ml-2 text-sm font-bold text-white bg-green-500 px-2 py-1 rounded-full">good</span>
                {:else if rateLabel === 'slowly'}
                  <span class="ml-2 text-sm font-bold text-white bg-yellow-500 px-2 py-1 rounded-full">slowly</span>
                {:else}
                  <span class="ml-2 text-sm font-bold text-white bg-red-500 px-2 py-1 rounded-full">fast</span>
                {/if}
              </h3>
              <p class="text-lg">{$analysis.speakingRate} 文字/分</p>
            </div>
          </div>
        </section>

        <!-- 声の分析グラフ -->
        <section class="bg-white rounded-lg shadow-md p-6">
          <h2 class="text-2xl font-semibold mb-4">総合評価</h2>
          <canvas bind:this={radarCanvas} width="400" height="400" class="w-full max-w-md mx-auto h-auto"></canvas>
          <div class="mt-6 text-sm text-gray-600">
            <h3 class="font-bold text-base text-gray-700 mb-2">評価基準について</h3>
            <ul class="list-disc list-inside space-y-1">
              <li><strong>抑揚:</strong> 声の高さの幅を評価します。様々な高さの声を使うと高評価になります。</li>
              <li><strong>声量:</strong> 話している間の平均的な声の大きさを評価します。小さすぎず、大きすぎない声が理想です。</li>
              <li><strong>適切な間:</strong> 1分間あたりの間の回数を評価します。適度な間を取ることで、聞き手が内容を理解しやすくなります。</li>
              <li><strong>スピードの緩急:</strong> 話すスピードの変化を評価します。一本調子ではなく、話の内容に合わせてスピードに変化があると高評価になります。</li>
            </ul>
          </div>
        </section>

        <section class="bg-white rounded-lg shadow-md p-6">
          <h2 class="text-2xl font-semibold mb-4">フィードバック</h2>
          {#if $analysis.correctedTranscript}
            <div class="mb-4 p-4 bg-gray-100 rounded">
              <h3 class="font-bold mb-2">校正例</h3>
              <p class="text-lg">{$analysis.correctedTranscript}</p>
              <p class="text-sm text-gray-600 mt-2">（口癖などを除き、句読点を追加した文章の例です）</p>
            </div>
          {/if}

          {#if $analysis.grammaticalErrors && $analysis.grammaticalErrors.length > 0}
            <div class="mb-4 p-4 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 rounded">
              <h3 class="font-bold mb-2">文法に関する指摘</h3>
              <ul class="list-disc list-inside">
                {#each $analysis.grammaticalErrors as error}
                  <li>{error}</li>
                {/each}
              </ul>
            </div>
          {/if}

          {#if rateLabel === 'good'}
            <p class="text-lg">素晴らしい速さです！このペースを維持しましょう。</p>
          {:else if rateLabel === 'slowly'}
            <p class="text-lg">もう少しハキハキと、少しだけ速く話すことを意識すると、より自信があるように聞こえます。</p>
          {:else}
            <p class="text-lg">少し早口のようです。相手が聞き取りやすいように、もう少しゆっくり話すことを意識しましょう。</p>
          {/if}
        </section>
      {/if}
    </div>

    <!-- サイドバー (右側) -->
    <div class="md:w-96 flex-shrink-0 flex flex-col gap-8">
      <!-- PREP法 構成チェッカー -->
      <section class="bg-white rounded-lg shadow-md">
        <PrepOrganizer />
      </section>
      <!-- 質問リスト編集 -->
      <section class="bg-white rounded-lg shadow-md p-6">
        <h2 class="text-2xl font-semibold mb-4">質問リストの管理</h2>

        <div class="flex items-center gap-4">
          <button
            on:click={() => editingQuestions.update(v => !v)}
            class="text-sm text-blue-500 hover:underline"
            aria-expanded={$editingQuestions}
          >
            {$editingQuestions ? '編集を閉じる' : '質問を編集'}
          </button>
          <div class="text-sm text-gray-600">計 {$questions.length} 件</div>
        </div>

        {#if $editingQuestions}
          <div class="mt-4">
            <div class="flex gap-2 mb-4">
              <input
                type="text"
                bind:value={newQuestionInput}
                placeholder="新しい質問を追加"
                class="flex-grow border rounded px-2 py-1"
                on:keydown={(e) => e.key === 'Enter' && handleAddQuestion()}
                aria-label="新しい質問"
              />
              <button on:click={handleAddQuestion} class="bg-green-500 hover:bg-green-700 text-white font-bold py-1 px-3 rounded">追加</button>
            </div>

            <ul class="list-disc list-inside space-y-2">
              {#each $questions as question, i}
                <li class="flex items-center justify-between">
                  <span class="truncate max-w-xs" title={question}>{question}</span>
                  <div class="flex items-center gap-2">
                    <button on:click={() => { currentQuestion.set(question); editingQuestions.set(false); }} class="text-sm text-blue-500 hover:underline">選択</button>
                    <button on:click={() => deleteQuestion(i)} class="text-red-500 hover:text-red-700 text-xl" aria-label="削除">&times;</button>
                  </div>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </section>
      
      <!-- 面接のコツセクション -->
      <section class="bg-white rounded-lg shadow-md p-6">
        <h2 class="text-2xl font-semibold mb-4">面接のコツ</h2>

        <div class="flex items-center gap-4">
          <button
            on:click={() => knacks.update(v => !v)}
            class="text-sm text-blue-500 hover:underline"
            aria-expanded={isKnacks}
          >
            {isKnacks ? 'コツを閉じる' : 'コツを見る'}
          </button>

        </div>

        {#if isKnacks}
          <div class="mt-4 text-gray-700 text-sm space-y-3">
            <p class="font-semibold">長所･短所を話すときの小さなコツ</p>
            <ul class="list-disc list-inside">
              <li>伝えるポイントは1つに絞る</li>
              <li>「結論→エピソード→どう活かすか」の順に話る</li>
              <li>自分だけのエピソードに落とし込む</li>
            </ul>
            <p class="font-semibold mt-4">話し方のポイント</p>
            <ul class="list-disc list-inside">
              <li>繰り返し練習する</li>
              <li>結論から話し、要点をまとめて話す</li>
              <li>話すことを丸暗記しない</li>
            </ul>
            <p class="font-semibold mt-4">緊張したときは</p>
            <ul class="list-disc list-inside">
              <li>深呼吸をしてリラックスする。</li>
              <li>ゆっくり話すことを意識する。</li>
              <li>完璧を目指さず、自然体で臨む。</li>
            </ul>
          </div>
        {/if}
      </section>
    </div>
  </div>
</main>