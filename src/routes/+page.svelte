<script>
  import { onMount } from "svelte";
  import { filterWords } from "$lib/filterwords.js";

  let recording = false;
  let analysis = null;
  let mediaRecorder;
  let audioChunks = [];
  let stream;
  let recognition;
  let transcript = "";
  let audioBlob = null;
  let audioURL = "";
  let recordingStartTime = 0;
  let currentQuestion = "";
  let questionInProgress = false;
  let newQuestionInput = "";
  let editingQuestions = false;

  let questions = [
    "自己紹介をしてください。",
    "あなたの長所と短所を教えてください。",
    "学生時代に最も打ち込んだことは何ですか？",
    "志望動機を教えてください。",
    "当社の事業内容について、どのような印象をお持ちですか？",
    "入社後に挑戦したいことは何ですか？",
    "チームで何かを成し遂げた経験はありますか？",
    "これまでの人生で最も困難だったことは何ですか？それをどう乗り越えましたか？",
    "周りの人からどのような人だと言われることが多いですか？",
    "あなたのキャリアプランを教えてください。",
  ];

  onMount(async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error("マイクへのアクセスが拒否されました:", err);
      alert("マイクへのアクセスを許可してください。");
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("お使いのブラウザは音声認識に対応していません。");
      return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true; // 継続的に認識
    recognition.interimResults = true; // 認識途中の結果も取得
    recognition.lang = "ja-JP"; // 言語を日本語に設定

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
      // 確定したテキストと認識途中のテキストを結合して表示
      transcript = finalTranscript + interimTranscript;
    };

    recognition.onerror = (event) => {
      console.error("音声認識エラー:", event.error);
    };
  });

  function startRecording() {
    if (!stream) {
      alert("マイクが利用できません。");
      return;
    }
    recording = true;
    analysis = null; // 前回の分析結果をクリア
    transcript = ""; // 前回の文字起こし結果をクリア
    audioBlob = null;
    audioURL = "";
    questionInProgress = true;

    recordingStartTime = Date.now(); // 録音開始時刻を記録

    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.start();
    console.log("Start recording...");

    mediaRecorder.addEventListener("dataavailable", (event) => {
      audioChunks.push(event.data);
    });

    mediaRecorder.addEventListener("stop", () => {
      const totalRecordingTime = Date.now() - recordingStartTime; // 録音全体の時間 (ms)
      audioBlob = new Blob(audioChunks, { type: "audio/webm" });
      audioURL = URL.createObjectURL(audioBlob);
      // TODO: audioBlobをサーバーに送信して分析する
      console.log("Audio Blob created:", audioBlob);

      const foundFillerWords = filterWords.filter(word => {
        const occurrences = (transcript.match(new RegExp(word, 'g')) || []).length;
        return occurrences >= 3;
      });

      // Simulate analysis after a delay
      setTimeout(() => {
        const speakingTimeSec = totalRecordingTime / 1000;
        const characterCount = transcript.length;
        // 0除算を避ける
        const speakingRate =
          speakingTimeSec > 0 ? Math.round((characterCount / speakingTimeSec) * 60) : 0;

        analysis = {
          fillerWords: foundFillerWords,
          speakingRate: speakingRate
        };
        recording = false; // 処理完了後に録音状態をfalseにする
      }, 1000); // 停止後すぐに結果を表示するため遅延を短くする
    });
    if (recognition) {
      recognition.start();
    }
  }

  function stopRecording() {
    mediaRecorder.stop();
    if (recognition) {
      recognition.stop();
    }
    questionInProgress = false;
    console.log("Stop recording...");
  }

  function nextQuestion() {
    recording = false;
    analysis = null;
    transcript = "";
    audioBlob = null;
    audioURL = "";
    questionInProgress = true;

    let newQuestion;
    if (questions.length === 1) {
      newQuestion = questions[0];
    } else {
      do {
        newQuestion = questions[Math.floor(Math.random() * questions.length)];
      } while (newQuestion === currentQuestion);
    }
    currentQuestion = newQuestion;
  }

  function addQuestion() {
    if (newQuestionInput.trim() === "") return;
    questions = [...questions, newQuestionInput.trim()];
    newQuestionInput = "";
  }

  function deleteQuestion(index) {
    questions.splice(index, 1);
    questions = questions; // for reactivity
  }
</script>

<main class="flex flex-col gap-8 max-w-3xl mx-auto p-8">
  <h1 class="text-3xl font-bold text-center">面接練習WEBアプリ</h1>

  {#if currentQuestion}
    <section class="bg-white rounded-lg shadow-md p-6">
        <h2 class="text-2xl font-semibold mb-4">質問</h2>
        <p class="text-lg text-gray-800">{currentQuestion}</p>
    </section>
  {/if}

  <section class="bg-white rounded-lg shadow-md p-6">
    <h2 class="text-2xl font-semibold mb-4">コントロール</h2>
    <div class="flex items-center gap-4">
      {#if !questionInProgress}
        <button on:click={nextQuestion} class="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded transition-colors" disabled={questions.length === 0}>
          次の質問へ
        </button>
      {:else}
        <button on:click={recording ? stopRecording : startRecording} class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-colors flex-shrink-0" disabled={!currentQuestion}>
          {recording ? "録音停止" : "回答を録音"}
        </button>
      {/if}
      {#if audioURL && !recording}
        <audio controls src={audioURL} class="w-full"></audio>
      {/if}
    </div>
    {#if recording}
      <p class="mt-4 text-red-500 font-bold animate-pulse">録音中...</p>
    {/if}
  </section>

  {#if transcript}
    <section class="bg-white rounded-lg shadow-md p-6">
      <h2 class="text-2xl font-semibold mb-4">文字起こし結果</h2>
      <p class="text-gray-700 whitespace-pre-wrap">{transcript}</p>
    </section>
  {/if}

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
            <span>話す速さ</span>
            {#if analysis.speakingRate >= 280 && analysis.speakingRate <= 320}
              <span class="ml-2 text-sm font-bold text-white bg-green-500 px-2 py-1 rounded-full">good</span>
            {:else if analysis.speakingRate < 280}
              <span class="ml-2 text-sm font-bold text-white bg-yellow-500 px-2 py-1 rounded-full">slowly</span>
            {:else}
              <span class="ml-2 text-sm font-bold text-white bg-red-500 px-2 py-1 rounded-full">fast</span>
            {/if}
          </h3>
          <p>{analysis.speakingRate} 文字/分</p>
        </div>
      </div>
    </section>

    <section class="bg-white rounded-lg shadow-md p-6">
      <h2 class="text-2xl font-semibold mb-4">フィードバック</h2>
      {#if analysis.speakingRate >= 280 && analysis.speakingRate <= 320}
        <p class="text-lg">素晴らしい速さです！このペースを維持しましょう。</p>
      {:else if analysis.speakingRate < 280}
        <p class="text-lg">もう少しハキハキと、少しだけ速く話すことを意識すると、より自信があるように聞こえます。</p>
      {:else}
        <p class="text-lg">少し早口のようです。相手が聞き取りやすいように、もう少しゆっくり話すことを意識しましょう。</p>
      {/if}
    </section>
  {/if}
</main>