// Hand Theremin - rich synth voice
(function () {
  'use strict';
  var video = document.getElementById('webcam');
  var canvas = document.getElementById('hand-canvas');
  var ctx = canvas.getContext('2d');
  var threeDiv = document.getElementById('three-container');
  var loading = document.getElementById('loading');
  var loadText = document.getElementById('loading-text');
  var badgeFist = document.getElementById('badge-fist');
  var badgeOpen = document.getElementById('badge-open');
  var noteDisplay = document.getElementById('note-display');
  var freqDisplay = document.getElementById('freq-display');
  var pitchThumb = document.getElementById('pitch-thumb');
  var handDetected = false;
  var isFist = true;
  var handCenterX = 0.5;
  var targetVol = 0;
  var currentVol = 0;
  var targetFreq = 440;
  var currentFreq = 440;
  var SMOOTH = 0.12;
  var FILTER_SMOOTH = 0.08;
  var targetFilterFreq = 2000;
  var currentFilterFreq = 2000;
  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // ============================================================
  //  RICH SYNTH VOICE
  //  2x detuned saw + tri sub + vibrato LFO
  //  + key-tracking LP filter + delay + compressor
  // ============================================================
  var audioCtx;
  var oscSaw1, oscSaw2, oscSub, oscLfo;
  var gainSaw1, gainSaw2, gainSub;
  var lfoGain, lfoDepthGain;
  var filterNode, envGain, compressor;
  var delayNode, delayFeedback, dryGain, wetGain;

  function initAudio() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Oscillator bank
    oscSaw1 = audioCtx.createOscillator();
    oscSaw2 = audioCtx.createOscillator();
    oscSaw1.type = 'sawtooth'; oscSaw2.type = 'sawtooth';
    oscSaw1.frequency.value = 440;
    oscSaw2.frequency.value = 440;
    gainSaw1 = audioCtx.createGain(); gainSaw1.gain.value = 0;
    gainSaw2 = audioCtx.createGain(); gainSaw2.gain.value = 0;
    oscSaw1.connect(gainSaw1);
    oscSaw2.connect(gainSaw2);

    // Sub: triangle one octave down
    oscSub = audioCtx.createOscillator();
    oscSub.type = 'triangle';
    oscSub.frequency.value = 220;
    gainSub = audioCtx.createGain(); gainSub.gain.value = 0;
    oscSub.connect(gainSub);

    // Vibrato LFO: sine 5.5 Hz
    oscLfo = audioCtx.createOscillator();
    oscLfo.type = 'sine';
    oscLfo.frequency.value = 5.5;
    lfoGain = audioCtx.createGain(); lfoGain.gain.value = 0;
    lfoDepthGain = audioCtx.createGain(); lfoDepthGain.gain.value = 1;
    oscLfo.connect(lfoGain);
    lfoGain.connect(lfoDepthGain);
    lfoDepthGain.connect(oscSaw1.frequency);
    lfoDepthGain.connect(oscSaw2.frequency);
    lfoDepthGain.connect(oscSub.frequency);

    // Mixer
    var voiceMix = audioCtx.createGain(); voiceMix.gain.value = 1;
    gainSaw1.connect(voiceMix);
    gainSaw2.connect(voiceMix);
    gainSub.connect(voiceMix);

    // Key-tracking lowpass filter
    filterNode = audioCtx.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.frequency.value = 2000;
    filterNode.Q.value = 4;
    voiceMix.connect(filterNode);

    // Envelope gain
    envGain = audioCtx.createGain(); envGain.gain.value = 0;
    filterNode.connect(envGain);

    // Delay
    delayNode = audioCtx.createDelay(1.0);
    delayNode.delayTime.value = 0.28;
    delayFeedback = audioCtx.createGain(); delayFeedback.gain.value = 0.35;
    dryGain = audioCtx.createGain(); dryGain.gain.value = 0.58;
    wetGain = audioCtx.createGain(); wetGain.gain.value = 0.42;
    envGain.connect(dryGain);
    envGain.connect(wetGain);
    wetGain.connect(delayNode);
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode);
    delayNode.connect(audioCtx.destination);

    // Compressor on dry path
    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 8;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.15;
    dryGain.connect(compressor);
    compressor.connect(audioCtx.destination);

    oscSaw1.start(); oscSaw2.start(); oscSub.start(); oscLfo.start();
  }

  function updateSynthParams(freq, vol) {
    if (!audioCtx) return;
    var detuneHz = freq * (Math.pow(2, 7/1200) - 1);
    oscSaw1.frequency.value = freq;
    oscSaw2.frequency.value = freq + detuneHz;
    oscSub.frequency.value = freq / 2;
    var vibratoHz = freq * (Math.pow(2, 3.5/1200) - 1);
    lfoGain.gain.value = vibratoHz * vol * 14;
    gainSaw1.gain.value = vol * 0.18;
    gainSaw2.gain.value = vol * 0.14;
    gainSub.gain.value = vol * 0.09;
    var filterRatio = 1.5 + vol * 8;
    targetFilterFreq = Math.min(freq * filterRatio, 8000);
    currentFilterFreq += (targetFilterFreq - currentFilterFreq) * FILTER_SMOOTH;
    filterNode.frequency.value = currentFilterFreq;
    filterNode.Q.value = 3 + vol * 14;
    envGain.gain.value = vol * 0.9;
  }

  var NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  function midiToNote(midi) { return NOTE_NAMES[midi%12] + Math.floor(midi/12-1); }
  function midiToFreq(midi) { return 440 * Math.pow(2, (midi-69)/12); }

  // --- Three.js ---
  var scene, camera, renderer, orbGroup, orbMat, orbGlow, particles;
  var trailGroup, trailParticles = [];

  function initThreeJS() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 50);
    camera.position.z = 8;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    threeDiv.appendChild(renderer.domElement);

    orbGroup = new THREE.Group();
    var geo = new THREE.SphereGeometry(1, 48, 48);
    orbMat = new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.35 });
    orbGroup.add(new THREE.Mesh(geo, orbMat));
    var wireGeo = new THREE.SphereGeometry(1.08, 32, 32);
    var wireMat = new THREE.MeshBasicMaterial({ color: 0x88bbff, wireframe: true, transparent: true, opacity: 0.25 });
    orbGlow = new THREE.Mesh(wireGeo, wireMat);
    orbGroup.add(orbGlow);
    scene.add(orbGroup);

    var pGeo = new THREE.BufferGeometry();
    var count = 200;
    var pos = new Float32Array(count * 3);
    for (var i = 0; i < count; i++) {
      var a = (i / count) * Math.PI * 2;
      var r = 1.6 + Math.random() * 0.4;
      pos[i*3] = Math.cos(a)*r;
      pos[i*3+1] = (Math.random()-0.5)*1.2;
      pos[i*3+2] = Math.sin(a)*r;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var pMat = new THREE.PointsMaterial({ color: 0x88ccff, size: 0.04, transparent: true, opacity: 0.7 });
    particles = new THREE.Points(pGeo, pMat);
    orbGroup.add(particles);

    initTrailSystem();
  }

  function initTrailSystem() {
    trailGroup = new THREE.Group();
    scene.add(trailGroup);
    var MAX = 500;
    for (var i = 0; i < MAX; i++) {
      var g = new THREE.SphereGeometry(0.03, 6, 6);
      var m = new THREE.MeshBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0, depthWrite: false });
      var dot = new THREE.Mesh(g, m);
      dot.visible = false;
      trailGroup.add(dot);
      trailParticles.push({
        mesh: dot, life: 0, maxLife: 0,
        vx: 0, vy: 0, vz: 0,
        baseSize: 0.02 + Math.random() * 0.04
      });
    }
  }

  function landmarkToWorld(lm, index, aspect) {
    var wx = (0.5 - lm[index].x) * 9.2;
    var wy = (0.5 - lm[index].y) * (9.2 / aspect);
    return { x: wx, y: wy };
  }

  function spawnTrailParticle(x, y, z) {
    for (var i = 0; i < trailParticles.length; i++) {
      var tp = trailParticles[i];
      if (tp.life <= 0) {
        tp.mesh.position.set(x, y, z);
        tp.mesh.visible = true;
        tp.life = 0.5 + Math.random() * 0.8;
        tp.maxLife = tp.life;
        tp.vx = (Math.random()-0.5) * 0.4;
        tp.vy = (Math.random()-0.5) * 0.4 + 0.15;
        tp.vz = (Math.random()-0.5) * 0.25;
        tp.mesh.scale.setScalar(tp.baseSize / 0.03);
        return;
      }
    }
  }

  function updateTrailParticles() {
    var dt = 0.016;
    for (var i = 0; i < trailParticles.length; i++) {
      var tp = trailParticles[i];
      if (tp.life > 0) {
        tp.life -= dt;
        var ratio = Math.max(0, tp.life / tp.maxLife);
        tp.mesh.material.opacity = ratio * 0.65;
        tp.mesh.position.x += tp.vx * dt;
        tp.mesh.position.y += tp.vy * dt;
        tp.mesh.position.z += tp.vz * dt;
        if (tp.life <= 0) tp.mesh.visible = false;
      }
    }
  }

  function animateThree() {
    requestAnimationFrame(animateThree);
    if (!orbGroup) return;
    var t = performance.now() * 0.001;
    orbGroup.rotation.y += 0.005;
    orbGroup.rotation.x = Math.sin(t * 0.4) * 0.15;
    var pulse = 1 + currentVol * 0.25;
    orbGroup.scale.setScalar(pulse);
    var hue = ((currentFreq - 130) / 900) * 0.55 + 0.55;
    var col = new THREE.Color().setHSL(hue % 1, 0.8, 0.55 + currentVol * 0.3);
    orbMat.color.copy(col);
    orbGlow.material.color.copy(col).multiplyScalar(1.3);
    orbGlow.material.opacity = 0.12 + currentVol * 0.4;
    orbMat.opacity = 0.2 + currentVol * 0.4;
    particles.material.opacity = 0.3 + currentVol * 0.7;
    updateTrailParticles();
    renderer.render(scene, camera);
  }

  // --- Gesture ---
  function getPalmCenter(lm) {
    var keys = [0,5,9,13,17];
    var cx=0, cy=0, cz=0;
    for (var i=0;i<keys.length;i++) { var k=keys[i]; cx+=lm[k].x; cy+=lm[k].y; cz+=lm[k].z; }
    return { x:cx/5, y:cy/5, z:cz/5 };
  }

  function detectFist(lm) {
    var palm = getPalmCenter(lm);
    var tips = [4,8,12,16,20];
    var curled = 0;
    for (var i=0;i<tips.length;i++) {
      var t = tips[i];
      var dx = lm[t].x-palm.x, dy = lm[t].y-palm.y, dz = lm[t].z-palm.z;
      if (Math.sqrt(dx*dx+dy*dy+dz*dz) < 0.18) curled++;
    }
    return curled >= 4;
  }

  function getHandCenter(lm) {
    var cx=0, cy=0;
    for (var i=0;i<lm.length;i++) { cx+=lm[i].x; cy+=lm[i].y; }
    return { x:cx/21, y:cy/21 };
  }

  // --- Drawing ---
  var CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
    [0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],
    [0,17],[17,18],[18,19],[19,20],[0,5],[5,9],[9,13],[13,17]
  ];

  function drawHand(lm) {
    var w=canvas.width, h=canvas.height;
    var lw=Math.max(1.5,Math.min(4,Math.min(w,h)/350));
    var ps=Math.max(2,Math.min(6,Math.min(w,h)/300));
    var color=isFist?'rgba(255,100,80,0.9)':'rgba(100,220,255,0.9)';
    ctx.lineWidth=lw; ctx.strokeStyle=color;
    for (var i=0;i<CONNECTIONS.length;i++) {
      var c=CONNECTIONS[i];
      ctx.beginPath();
      ctx.moveTo(lm[c[0]].x*w, lm[c[0]].y*h);
      ctx.lineTo(lm[c[1]].x*w, lm[c[1]].y*h);
      ctx.stroke();
    }
    for (var j=0;j<lm.length;j++) {
      var isTip = [4,8,12,16,20].indexOf(j)>=0;
      ctx.fillStyle = isTip?'#fff':color;
      ctx.beginPath();
      ctx.arc(lm[j].x*w, lm[j].y*h, isTip?ps*1.3:ps, 0, Math.PI*2);
      ctx.fill();
    }
  }

  // --- HUD ---
  function updateHUD() {
    if (isFist) {
      badgeFist.classList.add('active','fist');
      badgeOpen.classList.remove('active','open');
    } else {
      badgeOpen.classList.add('active','open');
      badgeFist.classList.remove('active','fist');
    }
    if (handDetected) {
      var midi = Math.round(48 + handCenterX * 36);
      var clampedMidi = Math.max(48, Math.min(84, midi));
      noteDisplay.textContent = midiToNote(clampedMidi);
      freqDisplay.textContent = Math.round(currentFreq) + ' Hz';
      pitchThumb.style.left = (handCenterX * 100) + '%';
    } else {
      noteDisplay.textContent = '--';
      freqDisplay.textContent = '-- Hz';
    }
  }

  // --- Main loop ---
  var EMIT_TIPS     = [4, 8, 12, 16, 20];
  var EMIT_KNUCKLES = [3, 6, 10, 14, 18];
  var EMIT_PALM     = [0, 5, 9, 13, 17];

  function onResults(results) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    resizeCanvas();
    handDetected = !!(results.multiHandLandmarks && results.multiHandLandmarks.length > 0);
    if (handDetected) {
      var lm = results.multiHandLandmarks[0];
      isFist = detectFist(lm);
      var center = getHandCenter(lm);
      handCenterX = Math.max(0, Math.min(1, center.x));
      var aspect = window.innerWidth / window.innerHeight;

      var midi = 48 + handCenterX * 36;
      targetFreq = midiToFreq(midi);
      targetVol = isFist ? 0 : 0.28;

      // Multi-point particle emission
      var perTip = isFist ? 1 : 2;
      var knuckleRate = isFist ? 0 : 0.5;
      var palmRate = isFist ? 0 : 0.3;

      for (var ti = 0; ti < EMIT_TIPS.length; ti++) {
        var tw = landmarkToWorld(lm, EMIT_TIPS[ti], aspect);
        for (var ts = 0; ts < perTip; ts++) {
          spawnTrailParticle(tw.x + (Math.random()-0.5)*0.12, tw.y + (Math.random()-0.5)*0.12, (Math.random()-0.5)*0.08);
        }
      }
      for (var ki = 0; ki < EMIT_KNUCKLES.length; ki++) {
        if (Math.random() < knuckleRate) {
          var kw = landmarkToWorld(lm, EMIT_KNUCKLES[ki], aspect);
          spawnTrailParticle(kw.x + (Math.random()-0.5)*0.12, kw.y + (Math.random()-0.5)*0.12, (Math.random()-0.5)*0.08);
        }
      }
      for (var pi = 0; pi < EMIT_PALM.length; pi++) {
        if (Math.random() < palmRate) {
          var pw = landmarkToWorld(lm, EMIT_PALM[pi], aspect);
          spawnTrailParticle(pw.x + (Math.random()-0.5)*0.25, pw.y + (Math.random()-0.5)*0.25, (Math.random()-0.5)*0.12);
        }
      }

      drawHand(lm);
    } else {
      isFist = true;
      targetVol = 0;
    }
    currentVol += (targetVol - currentVol) * SMOOTH;
    currentFreq += (targetFreq - currentFreq) * SMOOTH;
    updateSynthParams(currentFreq, currentVol);
    updateHUD();
  }

  // --- Webcam ---
  async function initWebcam() {
    var stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
    });
    video.srcObject = stream;
    return new Promise(function(resolve) { video.onloadedmetadata = function() { resolve(video); }; });
  }

  // --- MediaPipe ---
  async function initHands() {
    loadText.textContent = 'Downloading hand model...';
    var hands = new Hands({
      locateFile: function(file) { return 'lib/' + file; }
    });
    hands.setOptions({
      maxNumHands: 1, modelComplexity: 1,
      minDetectionConfidence: 0.6, minTrackingConfidence: 0.5
    });
    await hands.initialize();
    loadText.textContent = 'Starting camera...';
    return hands;
  }

  // --- Boot ---
  async function start() {
    try {
      initAudio();
      initThreeJS();
      animateThree();
      await initWebcam();
      var hands = await initHands();
      hands.onResults(onResults);
      var cam = new Camera(video, {
        onFrame: async function() { await hands.send({ image: video }); },
        width: 1280, height: 720
      });
      cam.start();
      loading.classList.add('hidden');
      document.addEventListener('click', function() {
        if (audioCtx.state === 'suspended') audioCtx.resume();
      }, { once: true });
    } catch (err) {
      loadText.textContent = 'Error: ' + err.message;
      console.error(err);
    }
  }

  start();
})();
