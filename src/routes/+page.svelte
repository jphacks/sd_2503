<script>
  let recording = false;
  let analysis = null;

  function toggleRecording() {
    recording = !recording;
    if (recording) {
      // TODO: Start recording
      console.log("Start recording...");
      // Simulate analysis after a delay
      setTimeout(() => {
        analysis = {
          fillerWords: ["えーと", "あのー", "えーと"],
          speakingRate: 120,
          silenceDuration: 5.2,
        };
      }, 3000);
    } else {
      // TODO: Stop recording and analyze
      console.log("Stop recording...");
    }
  }
</script>

<main class="flex flex-col gap-8 max-w-3xl mx-auto p-8">
  <h1 class="text-3xl font-bold text-center">面接練習WEBアプリ</h1>

  <section class="bg-white rounded-lg shadow-md p-6">
    <h2 class="text-2xl font-semibold mb-4">録音</h2>
    <button on:click={toggleRecording} class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-colors">
      {recording ? "録音停止" : "録音開始"}
    </button>
    {#if recording}
      <p class="mt-4 text-red-500 font-bold animate-pulse">録音中...</p>
    {/if}
  </section>

  {#if analysis}
    <section class="bg-white rounded-lg shadow-md p-6">
      <h2 class="text-2xl font-semibold mb-4">分析結果</h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="bg-gray-100 p-4 rounded">
          <h3 class="font-bold mb-2">口癖</h3>
          <ul class="list-disc list-inside">
            {#each analysis.fillerWords as word}
              <li>{word}</li>
            {/each}
          </ul>
        </div>
        <div class="bg-gray-100 p-4 rounded">
          <h3 class="font-bold mb-2">話す速さ</h3>
          <p>{analysis.speakingRate} words/min</p>
        </div>
        <div class="bg-gray-100 p-4 rounded">
          <h3 class="font-bold mb-2">沈黙の時間</h3>
          <p>{analysis.silenceDuration}s</p>
        </div>
      </div>
    </section>

    <section class="bg-white rounded-lg shadow-md p-6">
      <h2 class="text-2xl font-semibold mb-4">フィードバック</h2>
      <p class="text-lg">もう少しゆっくり話すことを意識しましょう。</p>
    </section>
  {/if}
</main>
