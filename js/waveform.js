/* CutFlowX waveform: real peaks from the rendered WAV, planned cuts overlaid at their exact frame positions. */
(function () {
  "use strict";

  var peakCache = { audio: null, buckets: 0, peaks: null };

  /** Loudest absolute sample per pixel column, across all channels. */
  function peaks(audio, buckets) {
    if (peakCache.audio === audio && peakCache.buckets === buckets) return peakCache.peaks;
    var n = audio.channels[0].length;
    var out = new Float32Array(buckets);
    var per = n / buckets;
    for (var b = 0; b < buckets; b++) {
      var start = Math.floor(b * per), end = Math.min(n, Math.floor((b + 1) * per));
      var m = 0;
      for (var c = 0; c < audio.channels.length; c++) {
        var ch = audio.channels[c];
        for (var i = start; i < end; i++) { var v = ch[i] < 0 ? -ch[i] : ch[i]; if (v > m) m = v; }
      }
      out[b] = m;
    }
    peakCache = { audio: audio, buckets: buckets, peaks: out };
    return out;
  }

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  /**
   * @param canvas  <canvas>
   * @param audio   PcmAudio
   * @param result  AnalysisResult from the engine (regions in frames relative to sample 0)
   */
  function draw(canvas, audio, result) {
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    if (cssW === 0) return;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var n = audio.channels[0].length;
    var sr = audio.sampleRate;
    var fr = result.frameRate;
    var xOfSample = function (s) { return (s / n) * cssW; };
    var sampleOfFrame = function (f) { return (f * sr * fr.den) / fr.num; };

    // Planned cuts behind the waveform: glowing amber bands.
    var amber = css("--silence") || "#e8973a";
    result.regions.forEach(function (r) {
      var x0 = xOfSample(sampleOfFrame(r.startFrame));
      var x1 = xOfSample(sampleOfFrame(r.endFrame));
      var w = Math.max(1.5, x1 - x0);
      var g = ctx.createLinearGradient(0, 0, 0, cssH);
      g.addColorStop(0, "rgba(232, 151, 58, 0.10)");
      g.addColorStop(0.5, "rgba(232, 151, 58, 0.38)");
      g.addColorStop(1, "rgba(232, 151, 58, 0.10)");
      ctx.save();
      ctx.shadowColor = "rgba(232, 151, 58, 0.75)";
      ctx.shadowBlur = 10;
      ctx.fillStyle = g;
      ctx.fillRect(x0, 0, w, cssH);
      ctx.restore();
      ctx.fillStyle = amber;
      ctx.fillRect(x0, 0, 1, cssH);
      ctx.fillRect(x0 + w - 1, 0, 1, cssH);
    });

    // Waveform (symmetric peaks, square-root scaled so quiet speech stays visible).
    var cols = Math.max(1, Math.floor(cssW));
    var p = peaks(audio, cols);
    var mid = cssH / 2;
    var bars = ctx.createLinearGradient(0, 0, 0, cssH);
    bars.addColorStop(0, "#f6f1e9");
    bars.addColorStop(0.5, "#b9b1a6");
    bars.addColorStop(1, "#f6f1e9");
    ctx.fillStyle = bars;
    for (var x = 0; x < cols; x++) {
      var h = Math.max(0.5, Math.sqrt(Math.min(1, p[x])) * (mid - 2));
      ctx.fillRect(x, mid - h, 1, h * 2);
    }
  }

  window.CutFlowXWaveform = { draw: draw };
})();
