<script>
  import { onMount, onDestroy } from "svelte";
  import { filterWords } from "$lib/filterwords.js";

  // --- 設定 ---
  const GOOD_MIN = 280;
  const GOOD_MAX = 320;
  const FILLER_THRESHOLD = 3; // 同一ワードの検出閾値

  // --- 状態 ---
  let recording = false;
  let analysis = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let stream = null;
  let recognition = null;
  let transcript = "";
  let audioBlob = null;
  let audioURL = "";
  let recordingStartTime = 0;
  let currentQuestion = "";
  let questionInProgress = false;
  let newQuestionInput = "";
  let editingQuestions = false;

  let questions = [
    // (質問リストは変更なし)
    "自己紹介をしてください。",
    "あなたの長所と短所を教えてください。",
    "学生時代に最も打ち込んだことは何ですか？",
    "志望動機を教えてください。",
    "当社の事業内容について、どのような印象をお持ちですか？",
    "入社後に挑戦したいことは何ですか？",
    "チームで何かを成し遂げた経験はありますか？",
    "これまでの人生で最も困難だったことは何ですか？それをどう乗り越えましたか？",
    "周りの人からどのような人だと言われることが多いですか？",
    "あなたのキャリアプランを教えてください。"
  ];

  // --- 視線分析用 ---
  let videoElement = null;
  let isFaceApiReady = false;
  let gazeAnalysisInterval = null;
  let gazeData = { lookingCenter: 0, total: 0 };

  // --- 初期化 ---
  onMount(async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      if (videoElement) {
        videoElement.srcObject = stream;
      }
      loadFaceApi();
    } catch (err) {
      console.error("マイクへのアクセスが拒否されました:", err);
      alert("マイクへのアクセスを許可してください。");
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("ブラウザがSpeechRecognitionをサポートしていません。文字起こし機能は利用できません。");
      recognition = null;
      return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "ja-JP";

    recognition.onresult = (event) => {
      let finalTranscript = "";
      let interimTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }
      // 表示用（暫定＋確定）
      transcript = (finalTranscript + interimTranscript).trim();
    };

    recognition.onerror = (event) => {
      console.error("音声認識エラー:", event.error);
    };

    recognition.onspeechend = () => {
      // 発話が終了したら自動的に録音を停止する
      if (recording) {
        stopRecording();
      }
    };
  });

  async function loadFaceApi() {
    if (typeof faceapi === "undefined") {
      console.warn("face-api.jsがロードされていません。");
      return;
    }
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri('/models')
      ]);
      isFaceApiReady = true;
      console.log("FaceAPIのモデルをロードしました。");
    } catch (error) {
      console.error("FaceAPIモデルのロードに失敗しました:", error);
    }
  }

  onDestroy(() => {
    stopRecognitionIfNeeded();
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
  });

  // --- 録音制御 ---
  function startRecording() {
    if (!stream) {
      alert("マイクが利用できません。");
      return;
    }
    if (!mediaRecorder) {
      try {
        mediaRecorder = new MediaRecorder(stream);
      } catch (err) {
        console.error("MediaRecorder の作成に失敗:", err);
        alert("録音を開始できませんでした。");
        return;
      }
    }

    recording = true;
    analysis = null;
    transcript = "";
    audioBlob = null;
    audioURL = "";
    audioChunks = [];
    recordingStartTime = Date.now();
    questionInProgress = true;
    startGazeAnalysis();

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = handleRecordingStop;
    mediaRecorder.start();

    if (recognition) {
      try {
        recognition.start();
      } catch (e) {
        console.warn("recognition.start() error:", e);
      }
    }
  }

  function stopRecording() {
    if (mediaRecorder && recording) {
      try {
        mediaRecorder.stop();
      } catch (e) {
        console.warn("mediaRecorder.stop() error:", e);
      }
    }
    stopRecognitionIfNeeded();
    stopGazeAnalysis();
    // 状態は onstop ハンドラで更新
  }

  function stopRecognitionIfNeeded() {
    if (recognition) {
      try {
        recognition.stop();
      } catch (e) {
        // ignore
      }
    }
  }

  function handleRecordingStop() {
    const totalRecordingTime = Date.now() - recordingStartTime; // ms
    audioBlob = new Blob(audioChunks, { type: "audio/webm" });
    audioURL = URL.createObjectURL(audioBlob);

    // フィラー語検出
    const foundFillerWords = filterWords
      .map(word => {
        const occurrences = (transcript.match(new RegExp(word, "g")) || []).length;
        return { word, occurrences };
      })
      .filter(x => x.occurrences >= FILLER_THRESHOLD)
      .map(x => x.word);

    // 視線分析結果
    const lookingCenterPercentage = gazeData.total > 0
      ? Math.round((gazeData.lookingCenter / gazeData.total) * 100)
      : 0;

    // 話速計算（文字/分）
    const speakingTimeSec = Math.max(1, Math.round(totalRecordingTime / 1000)); // 0除算回避
    const characterCount = transcript.length;
    const speakingRate = Math.round((characterCount / speakingTimeSec) * 60);

    // 文字起こしの校正
    let correctedTranscript = transcript;
    // 1. フィラーワードを削除
    filterWords.forEach(word => {
      correctedTranscript = correctedTranscript.replace(new RegExp(word, "g"), "");
    });
    // 2. 文頭・文末の空白を削除し、文末に句読点を追加（既にあれば追加しない）
    correctedTranscript = correctedTranscript.trim();
    if (correctedTranscript && !/[。？！]$/.test(correctedTranscript)) {
      correctedTranscript += "。";
    }

    analysis = {
      gaze: {
        lookingCenterPercentage,
        isGood: lookingCenterPercentage >= 80 // 80%以上でgood
      },
      fillerWords: foundFillerWords,
      speakingRate,
      correctedTranscript
    };

    recording = false;
    questionInProgress = false;
  }

  // --- 視線分析制御 ---
  function startGazeAnalysis() {
    if (!isFaceApiReady || !videoElement) return;

    gazeData = { lookingCenter: 0, total: 0 };

    gazeAnalysisInterval = setInterval(async () => {
      const detections = await faceapi.detectAllFaces(videoElement, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks(true);

      if (detections && detections.length > 0) {
        const landmarks = detections[0].landmarks;
        const nose = landmarks.getNose();
        const leftEye = landmarks.getLeftEye();
        const rightEye = landmarks.getRightEye();

        // 簡易的な中心判定: 鼻が両目の間にあれば中心とみなす
        const isLookingCenter = nose[0].x > leftEye[0].x && nose[0].x < rightEye[3].x;

        gazeData.total++;
        if (isLookingCenter) {
          gazeData.lookingCenter++;
        }
      }
    }, 500); // 0.5秒ごとにチェック
  }

  function stopGazeAnalysis() {
    if (gazeAnalysisInterval) {
      clearInterval(gazeAnalysisInterval);
      gazeAnalysisInterval = null;
    }
  }



  // --- 質問操作 ---
  function nextQuestion() {
    // 直前の状態をリセット
    recording = false;
    analysis = null;
    transcript = "";
    audioBlob = null;
    audioURL = "";
    audioChunks = [];
    questionInProgress = true;

    if (questions.length === 0) {
      currentQuestion = "";
      questionInProgress = false;
      return;
    }

    if (questions.length === 1) {
      currentQuestion = questions[0];
      return;
    }

    let newQuestion;
    do {
      newQuestion = questions[Math.floor(Math.random() * questions.length)];
    } while (newQuestion === currentQuestion);
    currentQuestion = newQuestion;
  }

  function addQuestion() {
    if (newQuestionInput.trim() === "") return;
    questions = [...questions, newQuestionInput.trim()];
    newQuestionInput = "";
  }

  function deleteQuestion(index) {
    questions = questions.filter((_, i) => i !== index);
    // currentQuestion が消えたら解除
    if (questions.length === 0) currentQuestion = "";
  }

  // 補助: UI 用の判定
  function speakingRateLabel(rate) {
    if (rate >= GOOD_MIN && rate <= GOOD_MAX) return "good";
    if (rate < GOOD_MIN) return "slowly";
    return "fast";
  }
</script>

<main class="max-w-6xl mx-auto p-8">
  <h1 class="text-3xl font-bold text-center">面接練習WEBアプリ</h1>

  <div class="mt-8 flex flex-col md:flex-row gap-8">
    <!-- メインコンテンツ (左側) -->
    <div class="flex-grow flex flex-col gap-8">
      {#if currentQuestion}
        <section class="bg-white rounded-lg shadow-md p-6">
          <h2 class="text-2xl font-semibold mb-4">質問</h2>
          <p class="text-lg text-gray-800">{currentQuestion}</p>
        </section>
      {/if}

      <!-- Video Feed -->
      <section class="bg-white rounded-lg shadow-md p-6" hidden={!analysis}>
        <h2 class="text-2xl font-semibold mb-4">カメラ映像</h2>
        <!-- svelte-ignore a11y-media-has-caption -->
        <video bind:this={videoElement} autoplay muted playsinline class="w-full h-auto rounded-md bg-gray-900" />
      </section>

      <!-- Controls -->
      <section class="bg-white rounded-lg shadow-md p-6">
        <h2 class="text-2xl font-semibold mb-4">コントロール</h2>

        <div class="flex flex-col md:flex-row md:items-center gap-4">
          <div class="flex items-center gap-4 flex-shrink-0">
            <button
              on:click={nextQuestion}
              class="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded transition-colors"
              disabled={questions.length === 0 || recording}
              aria-disabled={questions.length === 0 || recording}
            >
              次の質問へ
            </button>

            <button
              on:click={recording ? stopRecording : startRecording}
              class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-colors"
              disabled={!currentQuestion && !questionInProgress}
              aria-pressed={recording}
            >
              {recording ? "録音停止" : "回答を録音"}
            </button>
          </div>

          <div class="flex-grow">
            {#if audioURL && !recording}
              <audio controls src={audioURL} class="w-full" aria-label="録音の再生"></audio>
            {/if}
          </div>
        </div>

        {#if recording}
          <p class="mt-4 text-red-500 font-bold animate-pulse">録音中...</p>
        {/if}
      </section>

      <!-- 文字起こし -->
      {#if transcript}
        <section class="bg-white rounded-lg shadow-md p-6">
          <h2 class="text-2xl font-semibold mb-4">文字起こし結果</h2>
          <p class="text-gray-700 whitespace-pre-wrap">{transcript}</p>
        </section>
      {/if}

      <!-- 分析結果 -->
      {#if analysis}
        <section class="bg-white rounded-lg shadow-md p-6">
          <h2 class="text-2xl font-semibold mb-4">分析結果</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="bg-gray-100 p-4 rounded">
              <h3 class="font-bold mb-2">口癖</h3>
              {#if analysis.fillerWords.length > 0}
                <ul class="list-disc list-inside">
                  {#each analysis.fillerWords as word}
                    <li>{word}</li>
                  {/each}
                </ul>
              {:else}
                <p>口癖は見つかりませんでした。</p>
              {/if}
            </div>

            <div class="bg-gray-100 p-4 rounded">
              <h3 class="font-bold mb-2 flex items-center">
                <span>視線</span>
                 {#if analysis.gaze.isGood}
                  <span class="ml-2 text-sm font-bold text-white bg-green-500 px-2 py-1 rounded-full">good</span>
                {:else}
                  <span class="ml-2 text-sm font-bold text-white bg-yellow-500 px-2 py-1 rounded-full">check</span>
                {/if}
              </h3>
              <p class="text-lg">
                {analysis.gaze.lookingCenterPercentage}%
                <span class="text-sm text-gray-600"> (正面)</span>
              </p>
            </div>

            <div class="bg-gray-100 p-4 rounded">
              <h3 class="font-bold mb-2 flex items-center">
                <span>話す速さ</span>
                {#if analysis.speakingRate >= GOOD_MIN && analysis.speakingRate <= GOOD_MAX}
                  <span class="ml-2 text-sm font-bold text-white bg-green-500 px-2 py-1 rounded-full">good</span>
                {:else if analysis.speakingRate < GOOD_MIN}
                  <span class="ml-2 text-sm font-bold text-white bg-yellow-500 px-2 py-1 rounded-full">slowly</span>
                {:else}
                  <span class="ml-2 text-sm font-bold text-white bg-red-500 px-2 py-1 rounded-full">fast</span>
                {/if}
              </h3>
              <p class="text-lg">{analysis.speakingRate} 文字/分</p>
            </div>
          </div>
        </section>

        <section class="bg-white rounded-lg shadow-md p-6">
          <h2 class="text-2xl font-semibold mb-4">フィードバック</h2>
          {#if analysis.correctedTranscript}
            <div class="mb-4 p-4 bg-gray-100 rounded">
              <h3 class="font-bold mb-2">校正例</h3>
              <p class="text-lg">{analysis.correctedTranscript}</p>
              <p class="text-sm text-gray-600 mt-2">（口癖などを除き、句読点を追加した文章の例です）</p>
            </div>
          {/if}
          {#if analysis.speakingRate >= GOOD_MIN && analysis.speakingRate <= GOOD_MAX}
            <p class="text-lg">素晴らしい速さです！このペースを維持しましょう。</p>
          {:else if analysis.speakingRate < GOOD_MIN}
            <p class="text-lg">もう少しハキハキと、少しだけ速く話すことを意識すると、より自信があるように聞こえます。</p>
          {:else}
            <p class="text-lg">少し早口のようです。相手が聞き取りやすいように、もう少しゆっくり話すことを意識しましょう。</p>
          {#if analysis.gaze}
             <div class="mb-4">
               <h3 class="font-bold">視線について</h3>
               {#if analysis.gaze.isGood}
                 <p class="text-lg">素晴らしいです！しっかりと正面を向いて話せています。自信がある印象を与えられます。</p>
               {:else}
                 <p class="text-lg">もう少しカメラ（相手の目）を見て話すことを意識しましょう。視線が泳ぐと、自信がなさそうに見えたり、集中していない印象を与えたりする可能性があります。</p>
               {/if}
             </div>
          {/if}
         {/if}
        </section>
      {/if}
    </div>

    <!-- サイドバー (右側) -->
    <div class="md:w-96 flex-shrink-0">
      <!-- 質問リスト編集 -->
      <section class="bg-white rounded-lg shadow-md p-6 sticky top-8">
        <h2 class="text-2xl font-semibold mb-4">質問リストの管理</h2>

        <div class="flex items-center gap-4">
          <button
            on:click={() => editingQuestions = !editingQuestions}
            class="text-sm text-blue-500 hover:underline"
            aria-expanded={editingQuestions}
          >
            {editingQuestions ? '編集を閉じる' : '質問を編集'}
          </button>
          <div class="text-sm text-gray-600">計 {questions.length} 件</div>
        </div>

        {#if editingQuestions}
          <div class="mt-4">
            <div class="flex gap-2 mb-4">
              <input
                type="text"
                bind:value={newQuestionInput}
                placeholder="新しい質問を追加"
                class="flex-grow border rounded px-2 py-1"
                on:keydown={(e) => e.key === 'Enter' && addQuestion()}
                aria-label="新しい質問"
              />
              <button on:click={addQuestion} class="bg-green-500 hover:bg-green-700 text-white font-bold py-1 px-3 rounded">追加</button>
            </div>

            <ul class="list-disc list-inside space-y-2">
              {#each questions as question, i}
                <li class="flex items-center justify-between">
                  <span class="truncate max-w-xs" title={question}>{question}</span>
                  <div class="flex items-center gap-2">
                    <button on:click={() => { currentQuestion = question; editingQuestions = false; }} class="text-sm text-blue-500 hover:underline">選択</button>
                    <button on:click={() => deleteQuestion(i)} class="text-red-500 hover:text-red-700 text-xl" aria-label="削除">&times;</button>
                  </div>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </section>
    </div>
  </div>
</main>
