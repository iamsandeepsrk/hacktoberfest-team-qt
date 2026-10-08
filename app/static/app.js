/**
 * Touch Grass Outdoor Fitness Coach
 * Real-time Edge Pose Landmark Biomechanics & Hands-Free Audio Engine
 */

(function () {
  'use strict';

  // --- State Management ---
  const state = {
    currentExercise: 'squats',
    repCount: 0,
    currentStage: 'up', // 'up' or 'down' (or 'open' / 'closed')
    formQuality: 'Good',
    trackedAngle: null,
    isCameraRunning: false,
    isOffScreenMode: false,
    audioEnabled: true,
    speechRate: 1.0,
    speechPitch: 1.0,
    sessionStartTime: null,
    sessionTimerInterval: null,
    lastRepTimestamp: 0,
    minRepIntervalMs: 600, // Debounce rapid glitches
    history: []
  };

  // Exercise definitions & biomechanical threshold criteria
  const EXERCISE_CONFIGS = {
    squats: {
      title: 'Squat Biomechanics Standard',
      description: 'Keep heels grounded. Flex hips and knees until knee angle drops below 95°. Return to full upright lockout (>160°).',
      flexTarget: '< 95°',
      extTarget: '> 160°',
      flexThreshold: 95,
      extThreshold: 160,
      cues: {
        inflection: 'Drive up!',
        rep: (r) => `${r}`,
        formAlert: 'Form check: squat lower!'
      }
    },
    pushups: {
      title: 'Push-Up Biomechanics Standard',
      description: 'Maintain strict plank alignment. Lower chest until elbows break 90°. Push to full elbow lockout (>155°).',
      flexTarget: '< 90°',
      extTarget: '> 155°',
      flexThreshold: 90,
      extThreshold: 155,
      cues: {
        inflection: 'Push hard!',
        rep: (r) => `${r}`,
        formAlert: 'Form check: keep your hips straight!'
      }
    },
    pullups: {
      title: 'Pull-Up Biomechanics Standard',
      description: 'Hang from full dead hang (>150°). Pull chest up until elbows break below 75° and chin clears bar.',
      flexTarget: '< 75°',
      extTarget: '> 150°',
      flexThreshold: 75,
      extThreshold: 150,
      cues: {
        inflection: 'Over the bar!',
        rep: (r) => `${r}`,
        formAlert: 'Full range of motion!'
      }
    },
    jumping_jacks: {
      title: 'Jumping Jack Biomechanics Standard',
      description: 'Start feet together, arms by hips. Jump wide extending legs while clapping hands overhead.',
      flexTarget: 'Overhead',
      extTarget: 'Neutral',
      flexThreshold: 0.25,
      extThreshold: 0.12,
      cues: {
        inflection: 'Hands high!',
        rep: (r) => `${r}`,
        formAlert: 'Wider stance!'
      }
    }
  };

  // --- DOM Element References ---
  const elements = {
    video: document.getElementById('webcam-video'),
    canvas: document.getElementById('output-canvas'),
    placeholder: document.getElementById('camera-placeholder'),
    btnStartCamera: document.getElementById('btn-start-camera'),
    hudOverlay: document.getElementById('hud-overlay'),
    hudRepCount: document.getElementById('hud-rep-count'),
    hudStageLabel: document.getElementById('hud-stage-label'),
    hudAngleReadout: document.getElementById('hud-angle-readout'),
    formQualityBadge: document.getElementById('form-quality-badge'),
    sessionTimer: document.getElementById('session-timer'),
    sessionCalories: document.getElementById('session-calories'),
    btnResetReps: document.getElementById('btn-reset-reps'),
    btnLogWorkout: document.getElementById('btn-log-workout'),
    toggleAudioBtn: document.getElementById('toggle-audio-btn'),
    audioIcon: document.getElementById('audio-icon'),
    audioLabel: document.getElementById('audio-label'),
    voiceRateInput: document.getElementById('voice-rate'),
    voicePitchInput: document.getElementById('voice-pitch'),
    btnTestVoice: document.getElementById('btn-test-voice'),
    btnScreenOff: document.getElementById('btn-screen-off'),
    offScreenOverlay: document.getElementById('off-screen-overlay'),
    offScreenRepCount: document.getElementById('off-screen-rep-count'),
    offScreenExerciseName: document.getElementById('off-screen-exercise-name'),
    formGuideTitle: document.getElementById('form-guide-title'),
    formGuideDescription: document.getElementById('form-guide-description'),
    guideFlexTarget: document.getElementById('guide-flex-target'),
    guideExtTarget: document.getElementById('guide-ext-target'),
    workoutHistoryList: document.getElementById('workout-history-list'),
    btnRefreshHistory: document.getElementById('btn-refresh-history'),
    toastMessage: document.getElementById('toast-message'),
    exerciseButtons: document.querySelectorAll('.exercise-btn')
  };

  const canvasCtx = elements.canvas ? elements.canvas.getContext('2d') : null;

  // --- Voice / Audio Feedback Engine ---
  const AudioEngine = {
    synth: window.speechSynthesis,
    voice: null,

    init() {
      if (!('speechSynthesis' in window)) {
        console.warn('SpeechSynthesis API not supported on this browser.');
        if (elements.audioLabel) elements.audioLabel.textContent = 'Voice: Unsupported';
        return;
      }
      this.loadVoice();
      if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = () => this.loadVoice();
      }
    },

    loadVoice() {
      if (!this.synth) return;
      const voices = this.synth.getVoices();
      // Select an assertive, clear English voice if available
      this.voice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Enhanced'))) ||
                   voices.find(v => v.lang.startsWith('en')) ||
                   voices[0];
    },

    speak(text, priority = false) {
      if (!state.audioEnabled || !this.synth) return;

      if (priority && this.synth.speaking) {
        this.synth.cancel(); // Stop current speech immediately for urgent cues
      }

      const utterance = new SpeechSynthesisUtterance(text);
      if (this.voice) utterance.voice = this.voice;
      utterance.rate = state.speechRate;
      utterance.pitch = state.speechPitch;
      utterance.volume = 1.0;

      this.synth.speak(utterance);
    }
  };

  // --- Biomechanical Angle Math ---
  /**
   * Calculates 2D angle (in degrees) between three landmark points A, B, C (vertex at B).
   */
  function calculateAngle(a, b, c) {
    if (!a || !b || !c) return 0;
    const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let angle = Math.abs((radians * 180.0) / Math.PI);
    if (angle > 180.0) {
      angle = 360.0 - angle;
    }
    return Math.round(angle);
  }

  // --- Pose Landmark Landmark Processor ---
  function processPoseLandmarks(landmarks) {
    if (!landmarks || landmarks.length < 33) return;

    const exercise = state.currentExercise;
    const config = EXERCISE_CONFIGS[exercise];
    let angle = 0;
    let isInflection = false;
    let isLockout = false;
    let formValid = true;
    let formNote = 'Good Form';

    // Extract landmarks by index (MediaPipe standard)
    // 11: left shoulder, 12: right shoulder
    // 13: left elbow, 14: right elbow
    // 15: left wrist, 16: right wrist
    // 23: left hip, 24: right hip
    // 25: left knee, 26: right knee
    // 27: left ankle, 28: right ankle
    const ls = landmarks[11], rs = landmarks[12];
    const le = landmarks[13], re = landmarks[14];
    const lw = landmarks[15], rw = landmarks[16];
    const lh = landmarks[23], rh = landmarks[24];
    const lk = landmarks[25], rk = landmarks[26];
    const la = landmarks[27], ra = landmarks[28];

    if (exercise === 'squats') {
      // Use the leg with better visibility
      const leftVis = (lh.visibility || 0) + (lk.visibility || 0) + (la.visibility || 0);
      const rightVis = (rh.visibility || 0) + (rk.visibility || 0) + (ra.visibility || 0);
      
      const [hip, knee, ankle, shoulder] = leftVis >= rightVis 
        ? [lh, lk, la, ls] 
        : [rh, rk, ra, rs];

      angle = calculateAngle(hip, knee, ankle);
      state.trackedAngle = `${angle}°`;

      // Form validation: Check back alignment (Shoulder - Hip - Knee)
      const torsoAngle = calculateAngle(shoulder, hip, knee);
      if (torsoAngle < 60) {
        formValid = false;
        formNote = 'Chest too low!';
      }

      isInflection = angle <= config.flexThreshold;
      isLockout = angle >= config.extThreshold;

    } else if (exercise === 'pushups') {
      // Elbow angle (Shoulder - Elbow - Wrist)
      const leftVis = (ls.visibility || 0) + (le.visibility || 0) + (lw.visibility || 0);
      const rightVis = (rs.visibility || 0) + (re.visibility || 0) + (rw.visibility || 0);

      const [shoulder, elbow, wrist, hip, ankle] = leftVis >= rightVis
        ? [ls, le, lw, lh, la]
        : [rs, re, rw, rh, ra];

      angle = calculateAngle(shoulder, elbow, wrist);
      state.trackedAngle = `${angle}°`;

      // Check spinal plank alignment (Shoulder - Hip - Ankle)
      const bodyLine = calculateAngle(shoulder, hip, ankle);
      if (bodyLine < 145) {
        formValid = false;
        formNote = 'Hips sagging! Tighten core';
      }

      isInflection = angle <= config.flexThreshold;
      isLockout = angle >= config.extThreshold;

    } else if (exercise === 'pullups') {
      // Elbow angle (Shoulder - Elbow - Wrist)
      const [shoulder, elbow, wrist] = (ls.visibility || 0) >= (rs.visibility || 0)
        ? [ls, le, lw]
        : [rs, re, rw];

      angle = calculateAngle(shoulder, elbow, wrist);
      state.trackedAngle = `${angle}°`;

      isInflection = angle <= config.flexThreshold;
      isLockout = angle >= config.extThreshold;

    } else if (exercise === 'jumping_jacks') {
      // Relative wrist elevation and ankle distance
      const wristAvgY = (lw.y + rw.y) / 2;
      const shoulderAvgY = (ls.y + rs.y) / 2;
      const ankleDist = Math.abs(la.x - ra.x);
      const hipDist = Math.abs(lh.x - rh.x) || 0.1;

      const armsUp = wristAvgY < shoulderAvgY; // Canvas coordinates: y=0 is top
      const legsOpen = ankleDist > (hipDist * 1.6);

      state.trackedAngle = armsUp && legsOpen ? 'OPEN' : 'CLOSED';

      isInflection = armsUp && legsOpen;
      isLockout = !armsUp && !legsOpen;
    }

    // --- State Machine & Rep Counter ---
    const now = Date.now();

    if (isInflection && state.currentStage !== 'down') {
      state.currentStage = 'down';
      updateStageUI('DOWN');
      if (!formValid && now - state.lastRepTimestamp > 1500) {
        AudioEngine.speak(formNote, false);
      }
    } else if (isLockout && state.currentStage === 'down') {
      if (now - state.lastRepTimestamp > state.minRepIntervalMs) {
        state.currentStage = 'up';
        state.repCount += 1;
        state.lastRepTimestamp = now;

        updateRepUI(state.repCount);
        updateStageUI('UP');

        // Dynamic Spoken Coaching Cue
        const repText = config.cues.rep(state.repCount);
        AudioEngine.speak(repText, true);

        // Milestone audio cues
        if (state.repCount % 5 === 0) {
          setTimeout(() => {
            AudioEngine.speak(`${state.repCount} reps, stay strong!`);
          }, 600);
        }

        updateCalories();
      }
    }

    // Update Form Badge
    if (elements.formQualityBadge) {
      if (!formValid) {
        elements.formQualityBadge.textContent = formNote;
        elements.formQualityBadge.className = 'bg-amber-500 text-black font-black text-xs px-3.5 py-1.5 rounded-full shadow-lg';
      } else {
        elements.formQualityBadge.textContent = state.currentStage === 'down' ? 'PEAK CONTRACTION' : 'READY';
        elements.formQualityBadge.className = 'bg-grass-500 text-black font-black text-xs px-3.5 py-1.5 rounded-full shadow-lg';
      }
    }

    if (elements.hudAngleReadout) {
      elements.hudAngleReadout.textContent = state.trackedAngle || '--°';
    }
  }

  // --- Rendering Pipeline (Skeleton on Canvas) ---
  function drawPoseLandmarks(landmarks) {
    if (!canvasCtx || state.isOffScreenMode) return;

    const canvas = elements.canvas;
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

    if (!landmarks) return;

    // Connections to draw
    const connections = [
      [11, 12], // Shoulders
      [11, 13], [13, 15], // Left arm
      [12, 14], [14, 16], // Right arm
      [11, 23], [12, 24], // Torso
      [23, 24], // Hips
      [23, 25], [25, 27], // Left leg
      [24, 26], [26, 28]  // Right leg
    ];

    canvasCtx.lineWidth = 4;
    canvasCtx.strokeStyle = '#a3e635'; // Neon lime
    canvasCtx.fillStyle = '#22d3ee';   // Cyan for joints

    // Draw connecting bones
    connections.forEach(([i, j]) => {
      const p1 = landmarks[i];
      const p2 = landmarks[j];
      if (p1 && p2 && (p1.visibility || 1) > 0.4 && (p2.visibility || 1) > 0.4) {
        canvasCtx.beginPath();
        canvasCtx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
        canvasCtx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
        canvasCtx.stroke();
      }
    });

    // Draw joints
    [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].forEach((i) => {
      const p = landmarks[i];
      if (p && (p.visibility || 1) > 0.4) {
        canvasCtx.beginPath();
        canvasCtx.arc(p.x * canvas.width, p.y * canvas.height, 6, 0, 2 * Math.PI);
        canvasCtx.fill();
        canvasCtx.strokeStyle = '#000000';
        canvasCtx.lineWidth = 2;
        canvasCtx.stroke();
      }
    });
  }

  // --- UI Update Helpers ---
  function updateRepUI(count) {
    if (elements.hudRepCount) {
      elements.hudRepCount.textContent = count;
      elements.hudRepCount.classList.remove('rep-pop');
      void elements.hudRepCount.offsetWidth; // Trigger reflow
      elements.hudRepCount.classList.add('rep-pop');
    }
    if (elements.offScreenRepCount) {
      elements.offScreenRepCount.textContent = count;
    }
  }

  function updateStageUI(stage) {
    if (elements.hudStageLabel) {
      elements.hudStageLabel.textContent = stage;
      elements.hudStageLabel.className = stage === 'DOWN'
        ? 'text-base sm:text-xl font-black text-amber-400 uppercase tracking-wider'
        : 'text-base sm:text-xl font-black text-grass-400 uppercase tracking-wider';
    }
  }

  function updateCalories() {
    // Estimated calories: approx 0.32 kcal per squat, 0.4 kcal per pushup, 0.6 kcal per pullup
    const calPerRep = {
      squats: 0.35,
      pushups: 0.45,
      pullups: 0.70,
      jumping_jacks: 0.20
    };
    const rate = calPerRep[state.currentExercise] || 0.35;
    const calories = Math.round(state.repCount * rate * 10) / 10;
    if (elements.sessionCalories) {
      elements.sessionCalories.textContent = `${calories} kcal`;
    }
  }

  function showToast(message) {
    if (!elements.toastMessage) return;
    elements.toastMessage.textContent = message;
    elements.toastMessage.classList.remove('translate-y-20', 'opacity-0');
    elements.toastMessage.classList.add('translate-y-0', 'opacity-100');
    setTimeout(() => {
      elements.toastMessage.classList.remove('translate-y-0', 'opacity-100');
      elements.toastMessage.classList.add('translate-y-20', 'opacity-0');
    }, 3000);
  }

  // --- Session Timer ---
  function startSessionTimer() {
    if (state.sessionTimerInterval) return;
    state.sessionStartTime = Date.now();
    state.sessionTimerInterval = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - state.sessionStartTime) / 1000);
      const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
      const secs = String(elapsedSec % 60).padStart(2, '0');
      if (elements.sessionTimer) {
        elements.sessionTimer.textContent = `${mins}:${secs}`;
      }
    }, 1000);
  }

  function resetSessionTimer() {
    if (state.sessionTimerInterval) {
      clearInterval(state.sessionTimerInterval);
      state.sessionTimerInterval = null;
    }
    state.sessionStartTime = null;
    if (elements.sessionTimer) elements.sessionTimer.textContent = '00:00';
    if (elements.sessionCalories) elements.sessionCalories.textContent = '0 kcal';
  }

  // --- Exercise Switcher ---
  function switchExercise(exerciseKey) {
    if (!EXERCISE_CONFIGS[exerciseKey]) return;
    state.currentExercise = exerciseKey;
    state.repCount = 0;
    state.currentStage = 'up';
    updateRepUI(0);
    updateStageUI('READY');

    const config = EXERCISE_CONFIGS[exerciseKey];
    if (elements.formGuideTitle) elements.formGuideTitle.textContent = config.title;
    if (elements.formGuideDescription) elements.formGuideDescription.textContent = config.description;
    if (elements.guideFlexTarget) elements.guideFlexTarget.textContent = config.flexTarget;
    if (elements.guideExtTarget) elements.guideExtTarget.textContent = config.extTarget;
    if (elements.offScreenExerciseName) elements.offScreenExerciseName.textContent = exerciseKey.replace('_', ' ');

    elements.exerciseButtons.forEach(btn => {
      const isCurrent = btn.dataset.exercise === exerciseKey;
      btn.className = isCurrent
        ? 'exercise-btn px-4 py-2 rounded-lg text-xs font-bold transition bg-grass-500 text-black shadow-md shadow-grass-500/20'
        : 'exercise-btn px-4 py-2 rounded-lg text-xs font-bold transition bg-slate-800 text-slate-300 hover:bg-slate-700';
    });

    AudioEngine.speak(`Switched to ${exerciseKey.replace('_', ' ')}. Let's work!`);
  }

  // --- "Off-Screen" Mode Feature ---
  function toggleOffScreenMode(enable) {
    state.isOffScreenMode = typeof enable === 'boolean' ? enable : !state.isOffScreenMode;
    if (elements.offScreenOverlay) {
      if (state.isOffScreenMode) {
        elements.offScreenOverlay.classList.add('active');
        AudioEngine.speak('Off-screen mode enabled. Audio coaching active.');
      } else {
        elements.offScreenOverlay.classList.remove('active');
        AudioEngine.speak('Display restored.');
      }
    }
  }

  // --- Camera & MediaPipe Initialization ---
  let poseInstance = null;
  let cameraInstance = null;

  async function initCameraAndPose() {
    try {
      if (elements.btnStartCamera) elements.btnStartCamera.disabled = true;

      // Request Webcam Media Stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        },
        audio: false
      });

      elements.video.srcObject = stream;
      await elements.video.play();

      // Configure Canvas Dimensions to match stream
      elements.canvas.width = elements.video.videoWidth || 640;
      elements.canvas.height = elements.video.videoHeight || 480;

      // Hide Placeholder, Reveal HUD
      if (elements.placeholder) elements.placeholder.style.display = 'none';
      if (elements.hudOverlay) elements.hudOverlay.style.display = 'flex';

      state.isCameraRunning = true;
      startSessionTimer();

      // Check if MediaPipe Pose class is present
      if (typeof Pose !== 'undefined') {
        poseInstance = new Pose({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
        });

        poseInstance.setOptions({
          modelComplexity: 1,
          smoothLandmarks: true,
          enableSegmentation: false,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        poseInstance.onResults((results) => {
          if (!results.poseLandmarks) return;
          processPoseLandmarks(results.poseLandmarks);
          drawPoseLandmarks(results.poseLandmarks);
        });

        // Use MediaPipe Camera helper if available, otherwise native requestAnimationFrame loop
        if (typeof Camera !== 'undefined') {
          cameraInstance = new Camera(elements.video, {
            onFrame: async () => {
              if (state.isCameraRunning) {
                await poseInstance.send({ image: elements.video });
              }
            },
            width: 1280,
            height: 720
          });
          cameraInstance.start();
        } else {
          // Native frame processing fallback
          async function renderLoop() {
            if (state.isCameraRunning) {
              await poseInstance.send({ image: elements.video });
              requestAnimationFrame(renderLoop);
            }
          }
          requestAnimationFrame(renderLoop);
        }
      } else {
        console.warn('MediaPipe Pose library not loaded from CDN, running in visual camera mode.');
      }

      AudioEngine.speak('Outdoor camera connected. Step back and begin!');
      showToast('Camera feed live. Pose tracking engaged!');

    } catch (err) {
      console.error('Camera initialization error:', err);
      if (elements.btnStartCamera) elements.btnStartCamera.disabled = false;
      const statusTitle = document.getElementById('cam-status-title');
      if (statusTitle) statusTitle.textContent = 'Camera Access Blocked';
      const statusDesc = document.getElementById('cam-status-desc');
      if (statusDesc) statusDesc.textContent = 'Please enable camera permissions in your browser to start tracking.';
      showToast('Camera error: ' + err.message);
    }
  }

  // --- Backend REST API Integration ---
  async function logWorkoutSession() {
    const duration = state.sessionStartTime
      ? Math.round((Date.now() - state.sessionStartTime) / 1000)
      : 0;

    const payload = {
      exercise_type: state.currentExercise,
      rep_count: state.repCount,
      duration_seconds: duration,
      calories_est: parseFloat(elements.sessionCalories ? elements.sessionCalories.textContent : '0') || 0
    };

    try {
      const response = await fetch('/api/workouts/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();
      showToast(`Logged ${data.rep_count} ${data.exercise_type} reps!`);
      AudioEngine.speak(`Workout saved! Total ${data.rep_count} reps logged.`);

      // Reset state for new round
      state.repCount = 0;
      updateRepUI(0);
      resetSessionTimer();
      startSessionTimer();

      // Refresh list
      loadWorkoutHistory();
    } catch (err) {
      console.error('Error logging workout:', err);
      showToast('Failed to save workout session.');
    }
  }

  async function loadWorkoutHistory() {
    if (!elements.workoutHistoryList) return;
    try {
      const response = await fetch('/api/workouts/history?limit=15');
      if (!response.ok) throw new Error('Network error');
      const data = await response.json();
      state.history = data;

      if (data.length === 0) {
        elements.workoutHistoryList.innerHTML = `
          <div class="text-xs text-slate-500 text-center py-6">
            No logged workouts yet. Get out there and touch grass!
          </div>
        `;
        return;
      }

      elements.workoutHistoryList.innerHTML = data.map(item => {
        const date = new Date(item.created_at);
        const timeStr = isNaN(date.getTime()) ? 'Recently' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const icon = item.exercise_type === 'pushups' ? '💪' :
                     item.exercise_type === 'pullups' ? '🧗' :
                     item.exercise_type === 'jumping_jacks' ? '⚡' : '🦵';
        return `
          <div class="bg-slate-950 border border-slate-800 rounded-lg p-2.5 flex items-center justify-between hover:border-slate-700 transition">
            <div class="flex items-center space-x-2.5">
              <span class="text-base">${icon}</span>
              <div>
                <div class="text-xs font-bold text-white uppercase">${item.exercise_type.replace('_', ' ')}</div>
                <div class="text-[10px] text-slate-400">${Math.round(item.duration_seconds)}s • ${item.calories_est} kcal</div>
              </div>
            </div>
            <div class="text-right">
              <div class="text-sm font-black text-grass-400">${item.rep_count} reps</div>
              <div class="text-[10px] text-slate-500">${timeStr}</div>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      console.error('Failed to load history:', err);
      elements.workoutHistoryList.innerHTML = `
        <div class="text-xs text-red-400 text-center py-4">
          Could not load recent history.
        </div>
      `;
    }
  }

  // --- Event Listeners Setup ---
  function setupEventListeners() {
    // Start Camera
    if (elements.btnStartCamera) {
      elements.btnStartCamera.addEventListener('click', () => initCameraAndPose());
    }

    // Exercise Switcher
    elements.exerciseButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget;
        switchExercise(target.dataset.exercise);
      });
    });

    // Reset Reps
    if (elements.btnResetReps) {
      elements.btnResetReps.addEventListener('click', () => {
        state.repCount = 0;
        updateRepUI(0);
        showToast('Reps reset to 0');
        AudioEngine.speak('Rep counter reset.');
      });
    }

    // Log Workout
    if (elements.btnLogWorkout) {
      elements.btnLogWorkout.addEventListener('click', () => logWorkoutSession());
    }

    // Refresh History
    if (elements.btnRefreshHistory) {
      elements.btnRefreshHistory.addEventListener('click', () => loadWorkoutHistory());
    }

    // Toggle Audio Coach
    if (elements.toggleAudioBtn) {
      elements.toggleAudioBtn.addEventListener('click', () => {
        state.audioEnabled = !state.audioEnabled;
        elements.audioIcon.textContent = state.audioEnabled ? '🔊' : '🔇';
        elements.audioLabel.textContent = state.audioEnabled ? 'Voice Coach: ON' : 'Voice Coach: OFF';
        elements.toggleAudioBtn.className = state.audioEnabled
          ? 'flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-700 bg-slate-800/80 hover:bg-slate-700 transition'
          : 'flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-red-500/40 bg-red-500/20 text-red-300 hover:bg-red-500/30 transition';
        if (state.audioEnabled) AudioEngine.speak('Voice coaching enabled.');
      });
    }

    // Pitch & Rate Inputs
    if (elements.voiceRateInput) {
      elements.voiceRateInput.addEventListener('input', (e) => {
        state.speechRate = parseFloat(e.target.value);
      });
    }
    if (elements.voicePitchInput) {
      elements.voicePitchInput.addEventListener('input', (e) => {
        state.speechPitch = parseFloat(e.target.value);
      });
    }

    // Test Voice
    if (elements.btnTestVoice) {
      elements.btnTestVoice.addEventListener('click', () => {
        AudioEngine.speak('Touch grass and push hard!', true);
      });
    }

    // Off-Screen Battery Saver Mode
    if (elements.btnScreenOff) {
      elements.btnScreenOff.addEventListener('click', () => toggleOffScreenMode(true));
    }
    if (elements.offScreenOverlay) {
      elements.offScreenOverlay.addEventListener('click', () => toggleOffScreenMode(false));
    }

    // Expose state for automated testing / debugging
    window.__TOUCH_GRASS__ = {
      state,
      AudioEngine,
      calculateAngle,
      processPoseLandmarks,
      switchExercise,
      logWorkoutSession,
      toggleOffScreenMode
    };
  }

  // --- App Bootstrap ---
  window.addEventListener('DOMContentLoaded', () => {
    AudioEngine.init();
    setupEventListeners();
    loadWorkoutHistory();
  });

})();
