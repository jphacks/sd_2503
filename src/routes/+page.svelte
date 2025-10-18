<script>
  import { onMount } from "svelte";

  let recording = false;
  let analysis = null;
  let mediaRecorder;
  let audioChunks = [];
  let stream;
  let recognition;
  let transcript = "";

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

    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.start();
    console.log("Start recording...");

    mediaRecorder.addEventListener("dataavailable", (event) => {
      audioChunks.push(event.data);
    });

    mediaRecorder.addEventListener("stop", () => {
      const audioBlob = new Blob(audioChunks);
      // TODO: audioBlobをサーバーに送信して分析する
      console.log("Audio Blob created:", audioBlob);

      // Simulate analysis after a delay
      setTimeout(() => {
        analysis = {
          fillerWords: ["えーと", "あのー", "えーと"],
          speakingRate: 120,
          silenceDuration: 5.2,
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
    console.log("Stop recording...");
  }
</script>

<main class="flex flex-col gap-8 max-w-3xl mx-auto p-8">
  <h1 class="text-3xl font-bold text-center">面接練習WEBアプリ</h1>

  <section class="bg-white rounded-lg shadow-md p-6">
    <h2 class="text-2xl font-semibold mb-4">録音</h2>
    <button on:click={recording ? stopRecording : startRecording} class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-colors">
      {recording ? "録音停止" : "録音開始"}
    </button>
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
