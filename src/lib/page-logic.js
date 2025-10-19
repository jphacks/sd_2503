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
  let questionInitialized = false;

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

    // 音声が検出されなかった場合のエラー処理
    if (currentTranscript.trim().length === 0) {
      analysis.set({
        error: "音声が検出されませんでした。マイクがミュートになっていないか、マイクに正しく音声が入力されているか確認してください。"
      });
      recording.set(false);
      questionInProgress.set(false);
      return;
    }

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
          body: JSON.stringify({
            sentence: currentTranscript,
            rules: ['ra-nuki', 'i-nuki', 'sa-ire', 'sa-nuki', 'jodoushi']
          })
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
            const message = getFeedbackMessage(suggestion);
            grammaticalErrors.push(message);
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
    const minPauseDuration = 5; // 500ミリ秒 (ANALYSIS_INTERVAL * 5)
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

    const radarScores = [intonationScore, volumeScore, pauseScore, speedVariationScore];

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
          data: radarScores,
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
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }
    stopRecognitionIfNeeded();
    if (audioAnalysisInterval) {
      clearInterval(audioAnalysisInterval);
    }
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

    if (!questionInitialized) {
      currentQuestion.set(localQuestions[0]);
      questionInitialized = true;
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
    if (rate < 240) return "very_slowly";
    if (rate < GOOD_MIN) return "slowly";
    if (rate <= GOOD_MAX) return "good";
    if (rate <= 360) return "fast";
    return "very_fast";
  }

  /**
   * PREP法に基づいてテキストを整理する
   * @param {string} text 整理対象のテキスト
   * @returns {string} 整理後のテキスト
   */
  function getSpeakingRateFeedback(rate) {
    const label = speakingRateLabel(rate);
    const feedbacks = {
        good: [
            "素晴らしい速さです！聞き取りやすく、自信に満ちた印象を与えます。このペースを維持しましょう。",
            "ちょうど良いスピーチペースです。内容は聞き手にしっかりと伝わっているでしょう。",
            "理想的な話速です。落ち着いていて、かつ退屈させない、絶妙なバランスが取れています。"
        ],
        very_slowly: [
            "かなりゆっくりな話し方です。聞き手によっては、少し冗長に感じられるかもしれません。もう少しテンポを上げることを意識してみましょう。",
            "非常に丁寧な印象ですが、話のテンポが遅いようです。もう少しスピードを上げて、話に躍動感を持たせるとさらに良くなります。"
        ],
        slowly: [
            "もう少しハキハキと、少しだけ速く話すことを意識すると、より自信があるように聞こえます。",
            "少しゆっくりすぎるかもしれません。話にリズムを持たせ、重要な部分を少し速めに話すなど工夫してみましょう。",
            "丁寧な印象ですが、やや単調に聞こえる可能性があります。スピードに緩急をつけることを意識してみてください。"
        ],
        very_fast: [
            "非常に早口です。聞き手が内容を理解するのが難しいかもしれません。意識的に「間」を置くことを心がけましょう。",
            "熱意は素晴らしいですが、聞き手が追いつけないほどのスピードです。一度立ち止まって、ゆっくり話す練習をしてみましょう。"
        ],
        fast: [
            "少し早口のようです。相手が聞き取りやすいように、もう少しゆっくり話すことを意識しましょう。",
            "熱意は伝わりますが、少し早口で聞き取りにくいかもしれません。意識的に間を置くと、より内容が伝わりやすくなります。",
            "情報量が多い素晴らしい内容ですが、少しスピードを落とすことで、聞き手はより深く理解できます。"
        ]
    };
    const options = feedbacks[label];
    return options[Math.floor(Math.random() * options.length)];
  }

  function getRadarChartFeedback(radarChartData) {
    const feedbacks = [];
    const { labels, datasets } = radarChartData;
    const scores = datasets[0].data;

    const advice = {
      '抑揚': {
        1: '声が一本調子で、聞き手が退屈してしまう可能性があります。物語を読むように、感情を込めて話す練習をしてみましょう。',
        2: '声の高低差をもう少し意識してみましょう。重要なキーワードを少し高めの声で発音するだけでも、表現が豊かになります。'
      },
      '声量': {
        1: '声が小さく、聞き取りにくい部分があったようです。自信がない印象を与えかねません。背筋を伸ばし、お腹から声を出すことを意識してください。',
        2: 'もう少し大きな声で、自信を持って話してみましょう。相手にしっかりと声を届けるイメージを持つと効果的です。'
      },
      '適切な間': {
        1: '話が途切れず、聞き手が情報を整理する時間がなかったようです。句読点を意識し、1秒程度の「間」を意識的に作る練習をしましょう。',
        2: '話の区切りで、意識的に短い間（ポーズ）を取るように心がけてみてください。聞き手が内容を理解する助けになります。'
      },
      'スピードの緩急': {
        1: '終始同じスピードで話しており、単調な印象を与えてしまうかもしれません。一番伝えたいことは「ゆっくり、はっきりと」、補足情報は「少し速めに」といった変化を試してみましょう。',
        2: '一本調子にならないよう、話すスピードに変化をつけてみましょう。重要な部分を少しゆっくり話すだけでも、聞き手の注意を引くことができます。'
      }
    };

    labels.forEach((label, i) => {
      const score = scores[i];
      if (score <= 2 && advice[label] && advice[label][score]) {
        feedbacks.push(advice[label][score]);
      }
    });

    return feedbacks;
  }

  function getFeedbackMessage(s) {
    switch (s.rule) {
      case 'ra-nuki':
        return `「${s.word}」は「ら抜き言葉」です。正しくは「${s.suggestion}」と表現します。`;
      case 'i-nuki':
        return `「${s.word}」は「い抜き言葉」です。正しくは「${s.suggestion}」と表現します。`;
      case 'sa-ire':
        return `「${s.word}」は不要な「さ」が入る「さ入れ言葉」です。正しくは「${s.suggestion}」です。`;
      case 'sa-nuki':
        return `「${s.word}」は「さ」が抜けています。「さ抜き言葉」の可能性があります。正しくは「${s.suggestion}」です。`;
      case 'jodoushi':
        return `「${s.word}」は冗長な表現の可能性があります。「${s.suggestion}」のような、より簡潔な表現を検討しましょう。`;
      default:
        return `「${s.word}」は「${s.suggestion}」と修正すると、より自然な表現になります。(ルール: ${s.rule})`;
    }
  }

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
    organizeWithPREP,
    getSpeakingRateFeedback,
    getRadarChartFeedback,
    getFeedbackMessage
  };
}
