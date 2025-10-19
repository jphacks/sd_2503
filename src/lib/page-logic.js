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
  let finalTranscriptContent = ''; // 確定した文字起こしを保持する変数

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

  async function handleRecordingStop() {
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

    // --- 校正APIを呼び出す処理 ---
    let correctedTranscript = currentTranscript; // フォールバック用に元のテキストを保持
    let grammaticalErrors = [];

    if (currentTranscript) {
      try {
        const response = await fetch('/api/proofread', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ sentence: currentTranscript })
        });

        if (!response.ok) {
          throw new Error(`校正APIエラー: ${response.statusText}`);
        }

        const data = await response.json();
        if (data.error) {
          console.error("校正APIから返されたエラー:", data.error);
          throw new Error(`校正APIからのエラー: ${JSON.stringify(data.error)}`);
        }

        if (data.result && data.result.suggestions && data.result.suggestions.length > 0) {
          // オフセットの降順でソートして、後ろから置換していく
          // これにより、文字列の長さが変わっても後続の置換箇所のオフセットがずれない
          const sortedSuggestions = data.result.suggestions.sort((a, b) => parseInt(b.offset, 10) - parseInt(a.offset, 10));

          let corrected = currentTranscript;
          for (const suggestion of sortedSuggestions) {
            const start = parseInt(suggestion.offset, 10);
            const len = parseInt(suggestion.length, 10);
            // suggestion.suggestion が空の場合もあるため、空文字列をデフォルト値とする
            const suggestionText = suggestion.suggestion || '';
            corrected = corrected.substring(0, start) + suggestionText + corrected.substring(start + len);
          }
          correctedTranscript = corrected;

          // 文法エラーのフィードバックを作成
          for (const suggestion of data.result.suggestions) {
            if (suggestion.rule === 'ら抜き') {
              grammaticalErrors.push(`「${suggestion.word}」は「ら抜き言葉」です。正しくは「${suggestion.suggestion}」です。`);
            }
            // 他のルールに関するフィードバックもここに追加可能
          }
        }
      } catch (error) {
        console.error("校正APIの呼び出しに失敗しました。フォールバック処理を実行します:", error);
        // 既存のフォールバック処理を維持
        correctedTranscript = correctedTranscript.replace(new RegExp(filterWords.join('|'), "g"), "").trim();
        if (correctedTranscript && !/[。？！]$/.test(correctedTranscript)) correctedTranscript += "。";
      }
    }
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
      correctedTranscript,
      pitchData,
      grammaticalErrors, // ここで追加
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
      let interimTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscriptContent += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }
      transcript.set((finalTranscriptContent + interimTranscript).trim());
    };

    recognition.onerror = (event) => console.error("音声認識エラー:", event.error);
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
    finalTranscriptContent = ''; // 録画開始時に確定文字起こしをリセット
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

    // 録画状態を即座に false に更新し、UIの連打を防止する
    let isRec = false;
    recording.subscribe(v => isRec = v)();
    if (mediaRecorder && isRec) {
      try { mediaRecorder.stop(); } catch (e) { console.warn("mediaRecorder.stop() error:", e); }
    }
    if (!isRec) return; // すでに停止処理が始まっている場合は何もしない
    recording.set(false);

    if (mediaRecorder) try { mediaRecorder.stop(); } catch (e) { console.warn("mediaRecorder.stop() error:", e); }
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

  /**
   * PREP法に基づいてテキストを整理する
   * @param {string} text 整理対象のテキスト
   * @returns {string} 整理後のテキスト
   */
  function organizeWithPREP(text) {
    if (!text || text.trim() === "") {
      return "";
    }

    const sentences = text.split(/([。？！])/g).reduce((acc, part, i) => {
      if (i % 2 === 0) {
        if (part.trim()) acc.push(part.trim());
      } else {
        if (acc.length > 0) acc[acc.length - 1] += part;
      }
      return acc;
    }, []);

    if (sentences.length === 0) return "";

    const prep = {
      point: [],
      reason: [],
      example: [],
      conclusion: [],
      unclassified: []
    };

    const keywords = {
      reason: /^(なぜなら|理由は|その背景には|と申しますのも|というのも)/,
      example: /^(例えば|具体的には|私の経験では|実際に|特に)/,
      conclusion: /^(したがって|以上のことから|このように|まとめると|最後に|その結果)/,
      point: /^(結論から言うと|まず結論として|私の考えは)/
    };

    let currentSection = 'point'; // 最初の文は結論と仮定

    sentences.forEach((sentence, index) => {
      if (index === 0 && !Object.values(keywords).some(re => re.test(sentence))) {
        prep.point.push(sentence);
        return;
      }

      if (keywords.point.test(sentence)) { currentSection = 'point'; }
      else if (keywords.reason.test(sentence)) { currentSection = 'reason'; }
      else if (keywords.example.test(sentence)) { currentSection = 'example'; }
      else if (keywords.conclusion.test(sentence)) { currentSection = 'conclusion'; }

      prep[currentSection] ? prep[currentSection].push(sentence) : prep.unclassified.push(sentence);
    });

    return [prep.point, prep.reason, prep.example, prep.conclusion, prep.unclassified].flat().join(' ').trim();
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
    speakingRateLabel,
    organizeWithPREP
  };
}
