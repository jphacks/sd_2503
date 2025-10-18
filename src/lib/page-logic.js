import { writable } from 'svelte/store';
import { filterWords } from "$lib/filterwords.js";

// --- 定数 ---
const GOOD_MIN = 280;
const GOOD_MAX = 320;
const FILLER_THRESHOLD = 3;

export function createInterviewStore() {
  // --- ストア (コンポーネントと共有するリアクティブな状態) ---
  const recording = writable(false);
  const analysis = writable(null);
  const transcript = writable("");
  const videoURL = writable("");
  const currentQuestion = writable("");
  const questionInProgress = writable(false);
  const questions = writable([
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
  ]);
  const editingQuestions = writable(false);

  // --- 内部状態 (このモジュール内でのみ使用) ---
  let mediaRecorder = null;
  let recordedChunks = [];
  let stream = null;
  let recognition = null;
  let recordedBlob = null;
  let recordingStartTime = 0;
  let localQuestions = [];
  let localCurrentQuestion = '';

  questions.subscribe(value => { localQuestions = value; });
  currentQuestion.subscribe(value => { localCurrentQuestion = value; });

  // --- 内部ロジック ---
  function stopRecognitionIfNeeded() {
    if (recognition) {
      try { recognition.stop(); } catch (e) { /* ignore */ }
    }
  }

  function handleRecordingStop() {
    const totalRecordingTime = Date.now() - recordingStartTime;
    recordedBlob = new Blob(recordedChunks, { type: "video/webm" });
    videoURL.set(URL.createObjectURL(recordedBlob));

    let currentTranscript = '';
    transcript.subscribe(s => currentTranscript = s)(); // get current value

    const foundFillerWords = filterWords
      .map(word => ({ word, occurrences: (currentTranscript.match(new RegExp(word, "g")) || []).length }))
      .filter(x => x.occurrences >= FILLER_THRESHOLD)
      .map(x => x.word);

    const speakingTimeSec = Math.max(1, Math.round(totalRecordingTime / 1000));
    const characterCount = currentTranscript.length;
    const speakingRate = Math.round((characterCount / speakingTimeSec) * 60);

    analysis.set({
      fillerWords: foundFillerWords,
      speakingRate
    });

    recording.set(false);
    questionInProgress.set(false);
  }

  // --- 公開メソッド (コンポーネントから呼び出す) ---
  async function init(videoElement) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      if (videoElement) videoElement.srcObject = stream;
    } catch (err) {
      console.error("メディアデバイスへのアクセスが拒否されました:", err);
      alert("カメラとマイクへのアクセスを許可してください。");
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("ブラウザがSpeechRecognitionをサポートしていません。");
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
        if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
        else interimTranscript += event.results[i][0].transcript;
      }
      transcript.set((finalTranscript + interimTranscript).trim());
    };

    recognition.onerror = (event) => console.error("音声認識エラー:", event.error);
    recognition.onspeechend = () => { stopRecording(); };
  }

  function startRecording() {
    if (!stream) {
      alert("マイクまたは画面共有が利用できません。");
      return;
    }
    
    try {
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    } catch (err) {
      console.error("MediaRecorderの作成に失敗:", err);
      alert("録画を開始できませんでした。");
      return;
    }

    recording.set(true);
    analysis.set(null);
    transcript.set("");
    recordedBlob = null;
    videoURL.set("");
    recordedChunks = [];
    recordingStartTime = Date.now();
    questionInProgress.set(true);

    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = handleRecordingStop;
    mediaRecorder.start();

    if (recognition) {
      try { recognition.start(); } catch (e) { console.warn("recognition.start() error:", e); }
    }
  }

  function stopRecording() {
    let isRec = false;
    recording.subscribe(v => isRec = v)();
    if (mediaRecorder && isRec) {
      try { mediaRecorder.stop(); } catch (e) { console.warn("mediaRecorder.stop() error:", e); }
    }
    stopRecognitionIfNeeded();
  }

  function nextQuestion() {
    recording.set(false);
    analysis.set(null);
    transcript.set("");
    recordedBlob = null;
    videoURL.set("");
    recordedChunks = [];
    questionInProgress.set(true);

    if (localQuestions.length === 0) {
      currentQuestion.set("");
      questionInProgress.set(false);
      return;
    }
    if (localQuestions.length === 1) {
      currentQuestion.set(localQuestions[0]);
      return;
    }
    let newQuestion;
    do {
      newQuestion = localQuestions[Math.floor(Math.random() * localQuestions.length)];
    } while (newQuestion === localCurrentQuestion);
    currentQuestion.set(newQuestion);
  }

  function addQuestion(newQuestionInput) {
    if (newQuestionInput.trim() === "") return;
    questions.update(q => [...q, newQuestionInput.trim()]);
  }

  function deleteQuestion(index) {
    questions.update(q => q.filter((_, i) => i !== index));
    if (localQuestions.length === 0) currentQuestion.set("");
  }

  function destroy() {
    stopRecognitionIfNeeded();
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
  }

  function speakingRateLabel(rate) {
    if (rate >= GOOD_MIN && rate <= GOOD_MAX) return "good";
    if (rate < GOOD_MIN) return "slowly";
    return "fast";
  }

  return {
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
  };
}