/* Soundscapes, synthesised in the browser.
 *
 * No audio files ship with this build, and none need to: everything here is
 * generated with the Web Audio API, so there is nothing to download, nothing
 * to licence, and it works offline.
 *
 * Browsers will not start audio until the user has interacted with the page,
 * so every track starts from a click and the context is resumed on the way in.
 */
window.VH = window.VH || {};

(function (VH) {
  'use strict';

  var context = null;
  var nodes = [];
  var current = null;
  var fadeSeconds = 0.4;

  /* Two seconds of noise, looped. Brown noise is white noise integrated, which
   * rolls off the harshness and is what "rain" and "library hum" are built on. */
  function noiseBuffer(brown) {
    var length = context.sampleRate * 2;
    var buffer = context.createBuffer(1, length, context.sampleRate);
    var data = buffer.getChannelData(0);
    var last = 0;
    for (var i = 0; i < length; i += 1) {
      var white = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else {
        data[i] = white;
      }
    }
    return buffer;
  }

  function master(volume) {
    var gain = context.createGain();
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(volume, context.currentTime + fadeSeconds);
    gain.connect(context.destination);
    nodes.push(gain);
    return gain;
  }

  /* Two tones a few hertz apart, one per ear. The "beat" is perceptual - it
   * only works on headphones, which is why the label says so. */
  function binaural(carrier, beat, gain) {
    [carrier - beat / 2, carrier + beat / 2].forEach(function (frequency, index) {
      var osc = context.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      if (context.createStereoPanner) {
        var pan = context.createStereoPanner();
        pan.pan.value = index === 0 ? -1 : 1;
        osc.connect(pan).connect(gain);
        nodes.push(pan);
      } else {
        osc.connect(gain);
      }
      osc.start();
      nodes.push(osc);
    });
  }

  function noise(brown, filter, gain) {
    var source = context.createBufferSource();
    source.buffer = noiseBuffer(brown);
    source.loop = true;
    if (filter) {
      var biquad = context.createBiquadFilter();
      biquad.type = filter.type;
      biquad.frequency.value = filter.frequency;
      biquad.Q.value = filter.q || 0.7;
      source.connect(biquad).connect(gain);
      nodes.push(biquad);
    } else {
      source.connect(gain);
    }
    source.start();
    nodes.push(source);
  }

  /* A slow amplitude wobble, for the tracks that should breathe rather than
   * sit flat. */
  function tremolo(target, rate, depth) {
    var lfo = context.createOscillator();
    var lfoGain = context.createGain();
    lfo.frequency.value = rate;
    lfoGain.gain.value = depth;
    lfo.connect(lfoGain).connect(target.gain);
    lfo.start();
    nodes.push(lfo, lfoGain);
  }

  var TRACKS = {
    /* Focus Mode */
    theta: function () { binaural(220, 6, master(0.07)); },
    library: function () { noise(true, null, master(0.05)); },
    rain: function () {
      var gain = master(0.07);
      noise(false, { type: 'bandpass', frequency: 1400, q: 0.6 }, gain);
      tremolo(gain, 0.08, 0.02);
    },

    /* Wellbeing page */
    alpha: function () { binaural(220, 10, master(0.07)); },
    theta432: function () { binaural(432, 6, master(0.06)); },
    vagus: function () {
      var gain = master(0.09);
      var osc = context.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 110;
      osc.connect(gain);
      osc.start();
      nodes.push(osc);
      tremolo(gain, 0.15, 0.03);
    },
    nsdr: function () {
      /* A quiet bed to lie still to: brown noise low-passed, breathing slowly. */
      var gain = master(0.045);
      noise(true, { type: 'lowpass', frequency: 500 }, gain);
      tremolo(gain, 0.05, 0.015);
    }
  };

  VH.audio = {
    tracks: Object.keys(TRACKS),

    supported: function () {
      return !!(window.AudioContext || window.webkitAudioContext);
    },

    current: function () { return current; },

    stop: function () {
      nodes.forEach(function (node) {
        try { node.stop(); } catch (e) { /* gain nodes have no stop() */ }
        try { node.disconnect(); } catch (e) { /* already detached */ }
      });
      nodes = [];
      current = null;
    },

    /* Returns the track now playing, or null if this call stopped it.
     * Clicking the track that is already playing toggles it off. */
    play: function (kind) {
      if (!VH.audio.supported()) {
        if (VH.toast) VH.toast('This browser has no Web Audio support.', 'error');
        return null;
      }
      var wasPlaying = current;
      VH.audio.stop();
      if (!kind || kind === 'mute' || kind === wasPlaying) return null;
      if (!TRACKS[kind]) return null;

      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!context) context = new Ctor();
      /* Autoplay policy: the context starts suspended until a gesture. */
      if (context.state === 'suspended') context.resume();

      TRACKS[kind]();
      current = kind;
      return kind;
    }
  };

  window.addEventListener('beforeunload', VH.audio.stop);
})(window.VH);
