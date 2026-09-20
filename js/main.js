/* CutFlowX panel — Phase 1: connection, system checks, sequence facts. Read-only: nothing here edits the timeline. */
(function () {
  "use strict";

  var cs = new CSInterface();
  var Engine = window.CutFlowXEngine;
  var $ = function (id) { return document.getElementById(id); };

  // ---------- Premiere bridge ----------

  var insidePremiere = typeof window.__adobe_cep__ !== "undefined";

  function evalHost(code) {
    return new Promise(function (resolve) {
      if (!insidePremiere) {
        resolve({ ok: false, error: "Not running inside Premiere Pro.", detail: "Open CutFlowX from Window > Extensions." });
        return;
      }
      cs.evalScript(code, function (raw) {
        if (raw === "EvalScript error." || raw === undefined || raw === null || raw === "") {
          resolve({ ok: false, error: "Premiere could not run a CutFlowX command.", detail: "evalScript returned: " + String(raw) + " for " + code });
          return;
        }
        try { resolve(JSON.parse(raw)); }
        catch (e) { resolve({ ok: false, error: "Premiere returned an unreadable answer.", detail: String(raw).slice(0, 300) }); }
      });
    });
  }

  /** Loads host.jsx explicitly as well, so a failed automatic ScriptPath load is recovered and reported. */
  function loadHostScript() {
    if (!insidePremiere) return Promise.resolve();
    var path = cs.getSystemPath(SystemPath.EXTENSION) + "/jsx/host.jsx";
    return new Promise(function (resolve) {
      cs.evalScript("$.evalFile(" + JSON.stringify(path) + ")", function () { resolve(); });
    });
  }

  // ---------- Theme: match Premiere's actual panel colour ----------

  function applyTheme() {
    try {
      var c = cs.hostEnvironment.appSkinInfo.panelBackgroundColor.color;
      var rgb = "rgb(" + Math.round(c.red) + "," + Math.round(c.green) + "," + Math.round(c.blue) + ")";
      document.documentElement.style.setProperty("--bg", rgb);
    } catch (e) { /* keep the default #232323 */ }
  }

  // ---------- System checks ----------

  function setCheck(id, state, value) {
    var li = $(id);
    li.classList.remove("ok", "bad");
    if (state) li.classList.add(state);
    li.querySelector(".c-value").textContent = value;
  }

  var errors = [];
  function showErrors() {
    var box = $("error-detail");
    box.hidden = errors.length === 0;
    box.textContent = errors.join("\n");
    // Collapsed when healthy; opens by itself the moment something needs attention.
    var bad = document.querySelectorAll(".checks li.bad").length;
    var ok = document.querySelectorAll(".checks li.ok").length;
    var total = document.querySelectorAll(".checks li").length;
    $("checks-summary").textContent = bad > 0 || errors.length > 0 ? "System: needs attention"
      : ok === total ? "System: all checks passed" : "System: checking…";
    if (bad > 0 || errors.length > 0) $("checks").open = true;
  }

  function checkNode() {
    try {
      if (typeof require !== "function") throw new Error("Node.js is disabled for this panel (manifest flags missing).");
      var fs = require("fs"), os = require("os"), path = require("path");
      // Phase 2 writes the sequence audio to a temporary WAV: prove that is possible now.
      var dir = fs.mkdtempSync(path.join(os.tmpdir(), "cutflowx-"));
      fs.writeFileSync(path.join(dir, "probe.txt"), "ok");
      fs.unlinkSync(path.join(dir, "probe.txt"));
      fs.rmdirSync(dir);
      setCheck("c-node", "ok", process.version);
    } catch (e) {
      setCheck("c-node", "bad", "Unavailable");
      errors.push("Node.js: " + e.message);
    }
  }

  function checkEngine() {
    if (!Engine) {
      setCheck("c-engine", "bad", "Not loaded");
      errors.push("Detection engine: js/engine.js did not load.");
      return;
    }
    var r = Engine.selfTest();
    if (r.ok) setCheck("c-engine", "ok", "Ready, v" + Engine.ENGINE_VERSION);
    else { setCheck("c-engine", "bad", "Self-test failed"); errors.push("Detection engine: " + r.message); }
  }

  // ---------- Sequence ----------

  function pct(part, whole) {
    var w = BigInt(whole);
    if (w === 0n) return 0;
    return Number((BigInt(part) * 100000n) / w) / 1000;
  }

  var GUIDANCE = {
    "No sequence detected.": "Open a sequence in the Timeline, then click refresh.",
    "No project is open.": "Open a project and a sequence, then click refresh.",
    "Not running inside Premiere Pro.": "Open CutFlowX from Window > Extensions inside Premiere Pro.",
    "Premiere could not run a CutFlowX command.": "Restart Premiere. If this keeps happening, reinstall CutFlowX; the details are below.",
    "Premiere returned an unreadable answer.": "Click refresh to try again. The details are below."
  };

  var lastInfo = null;

  function renderSequence(info) {
    lastInfo = info.ok ? info : null;
    markStaleIfChanged();
    var empty = $("seq-empty"), body = $("seq-body");
    if (!info.ok) {
      body.hidden = true;
      empty.hidden = false;
      $("seq-empty-title").textContent = info.error;
      $("seq-empty-body").textContent = GUIDANCE[info.error] || "Click refresh to try again. If it keeps failing, restart Premiere.";
      return;
    }
    empty.hidden = true;
    body.hidden = false;

    $("seq-name").textContent = info.name;
    $("seq-name").title = info.name;

    var tb = Engine.describeTimebase(info.timebaseTicks);
    var frames = Engine.ticksToFrames(info.endTicks, info.timebaseTicks);
    $("f-fps").textContent = tb.label;
    $("f-size").textContent = info.width + " × " + info.height;
    $("f-duration").textContent = Engine.formatTicks(info.endTicks) + "  (" + frames.toLocaleString("en-US") + " frames)";

    var whole = info.inTicks === "0" && BigInt(info.outTicks) >= BigInt(info.endTicks);
    $("f-range").textContent = whole ? "Whole sequence" : Engine.formatTicks(info.inTicks) + " → " + Engine.formatTicks(info.outTicks);

    var left = pct(info.inTicks, info.endTicks);
    var right = Math.min(100, pct(info.outTicks, info.endTicks));
    var range = $("strip-range");
    range.style.left = left + "%";
    range.style.width = Math.max(0.5, right - left) + "%";
    $("strip").setAttribute("aria-label", "Analysis range " + $("f-range").textContent + " of " + Engine.formatTicks(info.endTicks));
    $("strip-start").textContent = "00:00:00.000";
    $("strip-end").textContent = Engine.formatTicks(info.endTicks);

    var voiced = info.audioTracks.filter(function (t) { return !t.muted && t.clips > 0; }).length;
    $("tracks-summary").textContent = "Audio tracks (" + voiced + " of " + info.audioTracks.length + " will be analyzed)";

    var list = $("tracks");
    list.textContent = "";
    info.audioTracks.forEach(function (t) {
      var li = document.createElement("li");
      if (t.muted) li.classList.add("muted");
      var id = document.createElement("span"); id.className = "t-id"; id.textContent = "A" + (t.index + 1);
      var name = document.createElement("span"); name.className = "t-name"; name.textContent = t.name; name.title = t.name;
      var state = document.createElement("span"); state.className = "t-state";
      state.textContent = t.muted ? "Muted" : t.clips === 0 ? "Empty" : t.clips + (t.clips === 1 ? " clip" : " clips");
      li.appendChild(id); li.appendChild(name); li.appendChild(state);
      list.appendChild(li);
    });
    if (info.audioTracks.length === 0) {
      var li = document.createElement("li");
      li.textContent = "This sequence has no audio tracks.";
      list.appendChild(li);
    }
  }

  // ---------- Refresh ----------

  var busy = false;
  function refresh() {
    if (busy) return Promise.resolve();
    busy = true;
    $("refresh").classList.add("spinning");
    errors = errors.filter(function (e) { return e.indexOf("Connection:") !== 0; });

    return evalHost("CutFlowX_ping()")
      .then(function (ping) {
        if (!ping.ok) {
          setCheck("c-premiere", "bad", "Not connected");
          errors.push("Connection: " + (ping.detail || ping.error));
          renderSequence({ ok: false, error: ping.error, detail: ping.detail });
          return;
        }
        setCheck("c-premiere", "ok", "Premiere " + ping.appVersion);
        return evalHost("CutFlowX_getSequenceInfo()").then(function (info) {
          if (!info.ok && info.error !== "No sequence detected." && info.error !== "No project is open.") {
            errors.push("Connection: " + info.error + (info.detail ? " " + info.detail : ""));
          }
          renderSequence(info);
        });
      })
      .catch(function (e) {
        errors.push("Connection: unexpected panel error, " + (e && e.message ? e.message : e));
      })
      .then(function () {
        showErrors();
        $("refresh").classList.remove("spinning");
        busy = false;
      });
  }


  // =====================================================================
  // Phase 2: export → analyze → preview. Read-only for the timeline.
  // =====================================================================

  var SETTINGS_KEY = "cutflowx.settings.v1";
  var TICKS_PER_SECOND = 254016000000n;
  var SILENT_PEAK = Math.pow(10, -60 / 20); // whole export quieter than -60 dBFS = nothing audible

  var sliders = {
    thresholdDb: { input: $("s-threshold"), out: $("o-threshold"), fmt: function (v) { return v + " dB"; } },
    minSilenceMs: { input: $("s-min"), out: $("o-min"), fmt: function (v) { return v + " ms"; } },
    paddingBeforeMs: { input: $("s-before"), out: $("o-before"), fmt: function (v) { return v + " ms"; } },
    paddingAfterMs: { input: $("s-after"), out: $("o-after"), fmt: function (v) { return v + " ms"; } }
  };

  function loadSettings() {
    var d = Engine.DEFAULT_SETTINGS, saved = {};
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {}; } catch (e) { saved = {}; }
    Object.keys(sliders).forEach(function (k) {
      var v = typeof saved[k] === "number" ? saved[k] : d[k];
      sliders[k].input.value = String(v);
    });
    syncSliderLabels();
  }

  function currentSettings() {
    var s = {};
    Object.keys(sliders).forEach(function (k) { s[k] = Number(sliders[k].input.value); });
    return s;
  }

  function syncSliderLabels() {
    Object.keys(sliders).forEach(function (k) {
      var sl = sliders[k], v = Number(sl.input.value);
      sl.out.textContent = sl.fmt(v);
      var min = Number(sl.input.min), max = Number(sl.input.max);
      sl.input.style.setProperty("--fill", ((v - min) / (max - min)) * 100 + "%");
    });
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(currentSettings())); } catch (e) { /* not fatal */ }
  }

  function setStatus(text, bad) {
    var el = $("status");
    el.textContent = text || "";
    el.classList.toggle("bad", !!bad);
  }

  // The exported audio and the range it came from. Settings changes re-run on this without re-exporting.
  var state = { audio: null, source: null, result: null };

  function markStaleIfChanged() {
    if (!state.source) return;
    var changed = !lastInfo ||
      lastInfo.sequenceId !== state.source.sequenceId ||
      lastInfo.inTicks !== state.source.inTicks ||
      lastInfo.outTicks !== state.source.outTicks;
    $("stale").hidden = !changed;
  }

  function tempWavPath() {
    var fs = require("fs"), os = require("os"), path = require("path");
    var dir = path.join(os.tmpdir(), "CutFlowX");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    fs.readdirSync(dir).forEach(function (f) {
      if (/^analysis-\d+\.wav$/.test(f)) { try { fs.unlinkSync(path.join(dir, f)); } catch (e) { /* in use: ignore */ } }
    });
    return path.join(dir, "analysis-" + Date.now() + ".wav");
  }

  function analyze() {
    var btn = $("analyze");
    btn.disabled = true;
    setStatus("Exporting audio from Premiere. Premiere pauses briefly while it renders…");

    var outPath, presetPath;
    try {
      outPath = tempWavPath();
      presetPath = cs.getSystemPath(SystemPath.EXTENSION) + "/presets/CutFlowX_WAV.epr";
    } catch (e) {
      setStatus("Could not prepare a temporary file: " + e.message, true);
      btn.disabled = false;
      return Promise.resolve();
    }

    // Give the status line a frame to paint before Premiere blocks on the render.
    return new Promise(function (r) { setTimeout(r, 60); })
      .then(function () {
        return evalHost("CutFlowX_exportAudio(" + JSON.stringify(outPath) + "," + JSON.stringify(presetPath) + ")");
      })
      .then(function (res) {
        if (!res.ok) { throw { user: res.error, detail: res.detail }; }
        setStatus("Analyzing…");
        var fs = require("fs");
        var buf = fs.readFileSync(res.path);
        try { fs.unlinkSync(res.path); } catch (e) { /* cleaned next run */ }
        var audio = Engine.parseWav(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));

        var peak = 0;
        audio.channels.forEach(function (ch) { for (var i = 0; i < ch.length; i++) { var v = ch[i] < 0 ? -ch[i] : ch[i]; if (v > peak) peak = v; } });
        if (peak < SILENT_PEAK) {
          throw { user: "The exported audio is silent. Check that the voice track is not muted and has clips inside the In/Out range." };
        }

        state.audio = audio;
        state.source = {
          sequenceId: res.sequenceId, inTicks: res.inTicks, outTicks: res.outTicks,
          timebaseTicks: res.timebaseTicks, exportResult: res.exportResult, endTicks: res.endTicks,
          name: lastInfo ? lastInfo.name : ""
        };
        runAnalysis();
        $("stale").hidden = true;
        $("stale").textContent = "The sequence or its In/Out range changed. Analyze again to update.";
        $("test-report").hidden = true;
        setCutButtonsDisabled(false);
        $("results").scrollIntoView({ behavior: "smooth", block: "start" });
        setStatus("Ready. Adjust the settings to update the plan instantly.");
      })
      .catch(function (e) {
        var msg = e && e.user ? e.user : "Analysis failed: " + (e && e.message ? e.message : String(e));
        setStatus(msg, true);
        if (e && e.detail) { errors.push("Analyze: " + e.detail); showErrors(); }
      })
      .then(function () { btn.disabled = false; });
  }

  function runAnalysis() {
    if (!state.audio) return;
    var rate = Engine.describeTimebase(state.source.timebaseTicks).rate;
    var settings = currentSettings();
    var result;
    try {
      // At the real timeline start/end there is no word beyond the edge: no padding scrap on that side.
      var edges = {
        startsAtTimelineStart: state.source.inTicks === "0",
        endsAtTimelineEnd: BigInt(state.source.outTicks) >= BigInt(state.source.endTicks)
      };
      result = Engine.analyzeSilence(state.audio, settings, rate, undefined, edges);
      Engine.validateCutPlan(result);
    } catch (e) {
      setStatus(e.message + (e.detail ? " (" + e.detail + ")" : ""), true);
      return;
    }
    state.result = result;
    renderResults();
  }

  function secondsOfTicks(t) { return Number((BigInt(t) * 1000n) / TICKS_PER_SECOND) / 1000; }

  function renderResults() {
    var r = state.result, src = state.source, audio = state.audio;
    $("results").hidden = false;

    var n = r.regions.length;
    $("r-count").textContent = n === 1 ? "1 silence" : n + " silences";
    var rangeSec = audio.channels[0].length / audio.sampleRate;
    $("r-removal").innerHTML = "";
    var l1 = document.createElement("div"); l1.textContent = r.removableSec.toFixed(1) + " s removed";
    var l2 = document.createElement("div"); l2.textContent = "of " + rangeSec.toFixed(1) + " s analyzed";
    $("r-removal").appendChild(l1); $("r-removal").appendChild(l2);

    CutFlowXWaveform.draw($("wave"), audio, r);
    $("w-start").textContent = Engine.formatTicks(src.inTicks);
    $("w-end").textContent = Engine.formatTicks(src.outTicks);

    var inT = BigInt(src.inTicks);
    var list = $("regions");
    list.textContent = "";
    setCutButtonsDisabled(n === 0 || !$("test-report").hidden);
    $("cut-all").hidden = n === 0;
    $("cut-all").textContent = cutAllLabel();
    $("analyze").textContent = "Analyze again";
    $("analyze").classList.add("secondary");
    if ($("test-report").hidden) setStep(n === 0 ? 1 : 2);
    $("test-help").textContent = n === 0 ? "Nothing to cut with these settings."
      : "Cuts these " + n + " silences on '" + (state.source ? state.source.name : "") + "' and checks every track after each cut. " +
        "Save your project first (Ctrl+S). \"Test one cut first\" cuts only #" + n + ".";
    if (n === 0) {
      var li0 = document.createElement("li");
      li0.className = "empty-row";
      li0.textContent = "No silence long enough to remove with these settings. Try a shorter minimum.";
      list.appendChild(li0);
    }
    r.regions.forEach(function (c) {
      var start = inT + c.startTicks, end = inT + c.endTicks;
      var len = ((c.endFrame - c.startFrame) * r.frameRate.den) / r.frameRate.num;
      var li = document.createElement("li");
      var b = document.createElement("button");
      b.type = "button";
      b.title = "Move the playhead 1 s before this cut";
      var a = document.createElement("span"); a.className = "r-n"; a.textContent = String(c.index + 1);
      var t = document.createElement("span"); t.textContent = Engine.formatTicks(start.toString()) + " → " + Engine.formatTicks(end.toString());
      var d = document.createElement("span"); d.className = "r-len"; d.textContent = len.toFixed(2) + " s";
      b.appendChild(a); b.appendChild(t); b.appendChild(d);
      b.addEventListener("click", function () {
        var target = start - TICKS_PER_SECOND;
        if (target < inT) target = inT;
        evalHost("CutFlowX_setPlayhead(" + JSON.stringify(target.toString()) + ")").then(function (res) {
          if (!res.ok) setStatus(res.error, true);
        });
      });
      li.appendChild(b);
      list.appendChild(li);
    });

    // Diagnostics: engine trace plus the export facts needed to debug timing (§26).
    var expectedSec = secondsOfTicks((BigInt(src.outTicks) - inT).toString());
    var diffFrames = Math.round(Math.abs(rangeSec - expectedSec) * r.frameRate.num / r.frameRate.den);
    var head = [
      "Sequence:          " + src.name,
      "In → Out (ticks):  " + src.inTicks + " → " + src.outTicks,
      "In → Out:          " + Engine.formatTicks(src.inTicks) + " → " + Engine.formatTicks(src.outTicks) + " (" + expectedSec.toFixed(3) + " s)",
      "Rendered audio:    " + rangeSec.toFixed(3) + " s" + (diffFrames > 1 ? "   ⚠ differs from In → Out by " + diffFrames + " frames" : "   (matches In → Out)"),
      "Export result:     " + (src.exportResult === "" ? "(empty)" : src.exportResult),
      "Engine:            v" + Engine.ENGINE_VERSION,
      "Times below are relative to the In point.",
      ""
    ].join("\n");
    $("diag-text").textContent = head + Engine.formatDiagnostics(r, "sequence export (In → Out)");
  }

  function copyDiagnostics() {
    var ta = document.createElement("textarea");
    ta.value = $("diag-text").textContent;
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    $("copy-diag").textContent = ok ? "Copied" : "Copy failed: select the text and press Ctrl+C";
    setTimeout(function () { $("copy-diag").textContent = "Copy diagnostics"; }, 1800);
  }

  // ---------- Step guide: 1 Analyze → 2 Review → 3 Cut ----------

  function setStep(current, allDone) {
    Array.prototype.forEach.call(document.querySelectorAll("#steps li"), function (li) {
      var n = Number(li.getAttribute("data-step"));
      li.classList.toggle("done", allDone ? true : n < current);
      li.classList.toggle("current", !allDone && n === current);
      if (!allDone && n === current) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
    });
  }

  // ---------- Phase 3a: one verified test cut ----------

  var armTimer = null;
  function cutAllLabel() {
    var n = state.result ? state.result.regions.length : 0;
    return n === 1 ? "Cut 1 silence" : "Cut " + n + " silences";
  }
  function resetTestButton() {
    $("test-cut").classList.remove("armed");
    $("test-cut").textContent = "Test one cut first";
    $("cut-all").classList.remove("armed");
    $("cut-all").textContent = cutAllLabel();
    clearTimeout(armTimer);
  }
  function setCutButtonsDisabled(v) { $("test-cut").disabled = v; $("cut-all").disabled = v; }

  function planIsCurrent() {
    if (!$("stale").hidden) { setStatus("The sequence changed since the analysis. Analyze again first.", true); return false; }
    return true;
  }

  function testCut() {
    var b = $("test-cut");
    var r = state.result, src = state.source;
    if (!r || !src || r.regions.length === 0) return;
    if (!planIsCurrent()) return;
    var last = r.regions[r.regions.length - 1];
    var inT = BigInt(src.inTicks);
    var start = inT + last.startTicks, end = inT + last.endTicks;

    // Two-step confirmation: the first click arms, the second cuts.
    if (!b.classList.contains("armed")) {
      resetTestButton(); // disarm the other button: only one action can be armed at a time
      b.classList.add("armed");
      b.textContent = "Click again to cut " + Engine.formatTicks(start.toString()) + " → " + Engine.formatTicks(end.toString());
      armTimer = setTimeout(resetTestButton, 5000);
      return;
    }
    resetTestButton();
    setCutButtonsDisabled(true);
    setStatus("Cutting one silence and checking every track…");

    var call = "CutFlowX_testCut(" + [src.sequenceId, src.timebaseTicks, src.inTicks, src.outTicks, start.toString(), end.toString()]
      .map(function (v) { return JSON.stringify(String(v)); }).join(",") + ")";
    evalHost(call).then(function (res) {
      renderTestReport(res, last);
      $("diag-text").textContent += "\n\nTEST CUT RESULT\n" + JSON.stringify(res, null, 1);
      if (res.ok) {
        // The timeline changed: the current plan no longer matches it.
        $("stale").hidden = false;
        $("stale").textContent = "The sequence was edited by the test cut. Analyze again before cutting anything else.";
        setStatus(res.verified ? "Test cut done and verified." : "Test cut done, but the check found a problem. See the report.", !res.verified);
      } else {
        setStatus(res.error, true);
        setCutButtonsDisabled(false);
      }
    });
  }

  function cutAll() {
    var b = $("cut-all");
    var r = state.result, src = state.source;
    if (!r || !src || r.regions.length === 0) return;
    if (!planIsCurrent()) return;
    if (!b.classList.contains("armed")) {
      resetTestButton();
      b.classList.add("armed");
      b.textContent = "Click again to cut " + r.regions.length + " on '" + src.name + "'";
      setStep(3);
      armTimer = setTimeout(function () { resetTestButton(); setStep(2); }, 5000);
      return;
    }
    resetTestButton();
    setCutButtonsDisabled(true);
    var n = r.regions.length;
    setStatus("Cutting " + n + " silences and checking every track after each one. Premiere is busy until it finishes…");

    var inT = BigInt(src.inTicks);
    var csv = r.regions.map(function (c) { return (inT + c.startTicks).toString() + "-" + (inT + c.endTicks).toString(); }).join(",");
    var call = "CutFlowX_cutAll(" + [src.sequenceId, src.timebaseTicks, src.inTicks, src.outTicks, csv]
      .map(function (v) { return JSON.stringify(String(v)); }).join(",") + ")";

    setTimeout(function () {
      evalHost(call).then(function (res) {
        renderCutAllReport(res);
        $("diag-text").textContent += "\n\nCUT SILENCES RESULT\n" + JSON.stringify(res, null, 1);
        // Any cut that was attempted may have changed the timeline: never allow cutting again with this plan.
        var edited = res.ok || res.started === true || res.done > 0;
        if (edited) {
          $("stale").hidden = false;
          $("stale").textContent = "The sequence was edited. Analyze again before cutting anything else.";
        } else {
          setCutButtonsDisabled(false);
        }
        if (!res.ok) setStatus(res.error, true);
        else setStatus(res.complete ? "Done. All " + res.total + " cuts made and verified." : "Stopped at a problem. See the report.", !res.complete);
        if (res.ok && res.complete) setStep(3, true); else if (edited) setStep(3);
      });
    }, 60);
  }

  function renderCutAllReport(res) {
    var box = $("test-report");
    box.hidden = false;
    var list = $("report-tracks");
    list.textContent = "";
    var good = res.ok && res.complete;
    box.classList.toggle("bad", !good);
    var r = state.result;
    var secs = function (frames) { return ((frames * r.frameRate.den) / r.frameRate.num).toFixed(1); };
    if (!res.ok) {
      $("report-title").textContent = res.error;
      $("report-next").textContent = (res.detail ? "Details: " + res.detail + ". " : "") +
        (res.started ? (res.done > 0 ? "The last " + res.done + " cuts were made and verified; the one after them may be incomplete. " : "The first cut may be incomplete. ")
          : "Nothing was cut. ") + "Ctrl+Z undoes one step at a time (Window > History).";
      return;
    }
    if (good) {
      $("report-title").textContent = "Done. " + res.total + " silences cut, " + secs(res.framesRemoved) + " s removed. Every cut verified.";
      $("report-next").textContent = "Play through the edit. To undo, reopen the project saved before cutting, or press Ctrl+Z repeatedly.";
      return;
    }
    $("report-title").textContent = "Stopped at cut #" + res.failedCut + ". Cuts made and verified before it: " + res.done + " of " + res.total + ".";
    var f = res.failure;
    f.tracks.forEach(function (t) {
      if (t.clipsBefore === 0 || t.ok) return;
      var li = document.createElement("li");
      var k = document.createElement("span"); k.className = "tk"; k.textContent = t.track;
      var v = document.createElement("span"); v.className = "bad"; v.textContent = t.problem;
      li.appendChild(k); li.appendChild(v); list.appendChild(li);
    });
    if (!f.endOk) {
      var li2 = document.createElement("li");
      var k2 = document.createElement("span"); k2.className = "tk"; k2.textContent = "End";
      var v2 = document.createElement("span"); v2.className = "bad";
      v2.textContent = "Sequence is " + Math.abs(f.endOffFrames) + " frames " + (f.endOffFrames > 0 ? "longer" : "shorter") + " than it should be.";
      li2.appendChild(k2); li2.appendChild(v2); list.appendChild(li2);
    }
    $("report-next").textContent = "Cut #" + res.failedCut + " (at " + f.timecodes.split(" → ")[0] + ") needs checking; everything before it is untouched. " +
      "Undo the failed cut with Ctrl+Z (Window > History shows its razor and remove steps), then copy the diagnostics below and send them.";
  }

  function renderTestReport(res, cut) {
    var box = $("test-report");
    box.hidden = false;
    box.classList.toggle("bad", !(res.ok && res.verified));
    var list = $("report-tracks");
    list.textContent = "";
    if (!res.ok) {
      $("report-title").textContent = res.error;
      $("report-next").textContent = res.detail ? "Details: " + res.detail : "";
      return;
    }
    $("report-title").textContent = res.verified
      ? "Verified. " + res.cutFrames + " frames removed, every track moved correctly."
      : "Problem found. The cut did not come out as planned.";
    res.tracks.forEach(function (t) {
      if (t.clipsBefore === 0) return;
      var li = document.createElement("li");
      var k = document.createElement("span"); k.className = "tk"; k.textContent = t.track;
      var v = document.createElement("span");
      v.className = t.ok ? "ok" : "bad";
      v.textContent = t.ok ? "Correct (" + t.removed + " removed, " + t.clipsAfter + " clips)" : t.problem;
      li.appendChild(k); li.appendChild(v); list.appendChild(li);
    });
    var endLi = document.createElement("li");
    var ek = document.createElement("span"); ek.className = "tk"; ek.textContent = "End";
    var ev = document.createElement("span"); ev.className = res.endOk ? "ok" : "bad";
    ev.textContent = res.endOk ? "Sequence exactly " + res.cutFrames + " frames shorter"
      : "Sequence is " + Math.abs(res.endOffFrames) + " frames " + (res.endOffFrames > 0 ? "longer" : "shorter") + " than it should be.";
    endLi.appendChild(ek); endLi.appendChild(ev); list.appendChild(endLi);
    $("report-next").textContent = (res.verified
      ? "Listen across the cut at " + res.timecodes.split(" → ")[0] + ". "
      : "Please copy the diagnostics below and send them. ") +
      "To restore the sequence, press Ctrl+Z until the cut is gone (Window > History shows each step).";
  }

  var rerunTimer = null;
  Object.keys(sliders).forEach(function (k) {
    sliders[k].input.addEventListener("input", function () {
      syncSliderLabels();
      saveSettings();
      clearTimeout(rerunTimer);
      rerunTimer = setTimeout(runAnalysis, 60);
    });
  });
  $("reset-settings").addEventListener("click", function () {
    try { localStorage.removeItem(SETTINGS_KEY); } catch (e) { /* ignore */ }
    loadSettings();
    runAnalysis();
  });
  $("analyze").addEventListener("click", analyze);
  $("test-cut").addEventListener("click", testCut);
  $("cut-all").addEventListener("click", cutAll);
  $("copy-diag").addEventListener("click", copyDiagnostics);
  window.addEventListener("resize", function () {
    if (state.audio && state.result) CutFlowXWaveform.draw($("wave"), state.audio, state.result);
  });
  loadSettings();

  // ---------- Start ----------

  applyTheme();
  if (insidePremiere) cs.addEventListener(CSInterface.THEME_COLOR_CHANGED_EVENT, applyTheme);

  checkNode();
  checkEngine();
  showErrors();

  $("refresh").addEventListener("click", refresh);
  var focusTimer = null;
  window.addEventListener("focus", function () {
    clearTimeout(focusTimer);
    focusTimer = setTimeout(refresh, 250);
  });

  loadHostScript().then(refresh);
})();
