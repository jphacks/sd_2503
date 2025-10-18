import { writable } from 'svelte/store';
import { filterWords } from "$lib/filterwords.js";

// --- 定数 ---
const GOOD_MIN = 280;
const GOOD_MAX = 320;
const FILLER_THRESHOLD = 3;
const ANALYSIS_INTERVAL = 100; // ms

export function createInterviewStore() {
  // --- ストア ---
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

  // --- 内部状態 ---
  let mediaRecorder = null;
  let recordedChunks = [];
  let stream = null;
  let recognition = null;
  let recordedBlob = null;
  let recordingStartTime = 0;
  let localQuestions = [];
  let localCurrentQuestion = '';

  // 音声分析関連
  let audioContext = null;
  let analyser = null;
  let sourceNode = null;
  let audioAnalysisInterval = null;
  let volumeData = [];
  let pitchData = [];

  questions.subscribe(value => { localQuestions = value; });
  currentQuestion.subscribe(value => { localCurrentQuestion = value; });

  // --- 内部ロジック ---
  function stopRecognitionIfNeeded() {
    if (recognition) {
      try { recognition.stop(); } catch (e) { /* ignore */ }
    }
  }

  function analyzeAudioFrame() {
    if (!analyser) return;

    // Volume (RMS)
    const timeDomainData = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(timeDomainData);
    let sumSquares = 0.0;
    for (const amplitude of timeDomainData) {
      const normalized = (amplitude / 128.0) - 1.0; // -1.0 to 1.0
      sumSquares += normalized * normalized;
    }
    const rms = Math.sqrt(sumSquares / timeDomainData.length);
    volumeData.push(rms);

    // Pitch (Fundamental Frequency)
    const freqData = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(freqData);
    let maxIndex = 0;
    let maxVal = -1;
    for (let i = 0; i < analyser.frequencyBinCount; i++) {
      if (freqData[i] > maxVal) {
        maxVal = freqData[i];
        maxIndex = i;
      }
    }
    const pitch = maxIndex * (audioContext.sampleRate / analyser.fftSize);
    // 人間の声の基本的な範囲にない場合は0とする
    pitchData.push(pitch > 80 && pitch < 1000 ? pitch : 0);
  }

  function handleRecordingStop() {
    const totalRecordingTime = Date.now() - recordingStartTime;
    recordedBlob = new Blob(recordedChunks, { type: "video/webm" });
    videoURL.set(URL.createObjectURL(recordedBlob));

    let currentTranscript = '';
    transcript.subscribe(s => currentTranscript = s)();

    const foundFillerWords = filterWords
      .map(word => ({ word, occurrences: (currentTranscript.match(new RegExp(word, "g")) || []).length }))
      .filter(x => x.occurrences > 0)
      .map(x => `${x.word}(${x.occurrences}回)`);

    const speakingTimeSec = Math.max(1, Math.round(totalRecordingTime / 1000));
    const characterCount = currentTranscript.length;
    const speakingRate = Math.round((characterCount / speakingTimeSec) * 60);

    // --- 5段階評価の計算ロジック ---
    const scale = (value, min, max) => {
      if (value === undefined || value === null || isNaN(value)) return 1;
      const clampedValue = Math.max(min, Math.min(value, max));
      return Math.round((clampedValue - min) / (max - min) * 4) + 1;
    };

    // 1. 抑揚 (Intonation) - ピッチの範囲
    const validPitches = pitchData.filter(p => p > 0);
    let intonationScore = 1;
    if (validPitches.length > 1) {
      const minPitch = Math.min(...validPitches);
      const maxPitch = Math.max(...validPitches);
      const pitchRange = maxPitch - minPitch;
      intonationScore = scale(pitchRange, 50, 250); // 範囲 50Hz (単調) ~ 250Hz (抑揚豊か)
    }

    // 2. 声量 (Volume) - 平均音量
    const speakingVolume = volumeData.filter(v => v > 0.01); // 無音区間を除外
    const avgVolume = speakingVolume.length > 0 ? speakingVolume.reduce((a, b) => a + b, 0) / speakingVolume.length : 0;
    const volumeScore = scale(avgVolume, 0.02, 0.1); // 0.02 (小声) ~ 0.1 (大声) を基準

    // 3. 適切な間 (Appropriate Pauses)
    const silenceThreshold = 0.02;
    const minPauseDuration = 5; // 500ms (ANALYSIS_INTERVAL * 5)
    let pauseCount = 0;
    let currentSilenceLength = 0;
    for (const volume of volumeData) {
      if (volume < silenceThreshold) {
        currentSilenceLength++;
      } else {
        if (currentSilenceLength >= minPauseDuration) {
          pauseCount++;
        }
        currentSilenceLength = 0;
      }
    }
    if (currentSilenceLength >= minPauseDuration) pauseCount++;
    const pausesPerMinute = speakingTimeSec > 0 ? (pauseCount / speakingTimeSec) * 60 : 0;
    let pauseScore;
    if (pausesPerMinute >= 5 && pausesPerMinute <= 15) { // 1分あたり5-15回を理想とする
      pauseScore = 5;
    } else if (pausesPerMinute < 5) {
      pauseScore = scale(pausesPerMinute, 0, 5);
    } else {
      pauseScore = 5 - scale(pausesPerMinute, 15, 30);
    }
    pauseScore = Math.max(1, Math.min(5, Math.round(pauseScore)));

    // 4. 話すスピードの緩急 (Variation in Speed) - 音量の標準偏差を代用
    let speedVariationScore = 1;
    if (speakingVolume.length > 1) {
      const mean = avgVolume;
      const stdDevVolume = Math.sqrt(speakingVolume.map(v => Math.pow(v - mean, 2)).reduce((a, b) => a + b, 0) / speakingVolume.length);
      speedVariationScore = scale(stdDevVolume, 0.01, 0.05); // 標準偏差 0.01 (単調) ~ 0.05 (緩急あり)
    }

    analysis.set({
      fillerWords: foundFillerWords,
      speakingRate,
      volumeData,
      pitchData,
      radarChartData: {
        labels: ['抑揚', '声量', '適切な間', 'スピードの緩急'],
        datasets: [{
          label: 'あなたのスキル',
          data: [intonationScore, volumeScore, pauseScore, speedVariationScore],
          backgroundColor: 'rgba(59, 130, 246, 0.2)',
          borderColor: 'rgba(59, 130, 246, 1)',
          borderWidth: 2,
        }]
      }
    });

    recording.set(false);
    questionInProgress.set(false);
  }

  // --- 公開メソッド ---
  async function init(videoElement) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      if (videoElement) videoElement.srcObject = stream;

      // Web Audio APIのセットアップ
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      sourceNode = audioContext.createMediaStreamSource(stream);
      sourceNode.connect(analyser);

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
      alert("マイクが利用できません。");
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

    // 音声分析を開始
    volumeData = [];
    pitchData = [];
    audioAnalysisInterval = setInterval(analyzeAudioFrame, ANALYSIS_INTERVAL);

    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = handleRecordingStop;
    mediaRecorder.start();

    if (recognition) {
      try { recognition.start(); } catch (e) { console.warn("recognition.start() error:", e); }
    }
  }

  function stopRecording() {
    if (audioAnalysisInterval) clearInterval(audioAnalysisInterval);

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
    if (audioContext) {
      audioContext.close();
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
