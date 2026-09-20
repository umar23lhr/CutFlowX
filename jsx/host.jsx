/**
 * CutFlowX — ExtendScript host (runs inside Premiere Pro).
 * ExtendScript is ES3: no JSON object, no let/const, no Array.forEach.
 * Every function returns a JSON string: {"ok":true,...} or {"ok":false,"error":"...","detail":"..."}.
 * Tick values stay STRINGS end to end: ExtendScript numbers are doubles and would lose precision.
 */

function CutFlowX_esc(s) {
  s = String(s);
  var out = "";
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    var code = s.charCodeAt(i);
    if (c === "\\") out += "\\\\";
    else if (c === "\"") out += "\\\"";
    else if (c === "\n") out += "\\n";
    else if (c === "\r") out += "\\r";
    else if (c === "\t") out += "\\t";
    else if (code < 32) out += "\\u" + ("0000" + code.toString(16)).slice(-4);
    else out += c;
  }
  return "\"" + out + "\"";
}

function CutFlowX_fail(message, detail) {
  return "{\"ok\":false,\"error\":" + CutFlowX_esc(message) + ",\"detail\":" + CutFlowX_esc(detail || "") + "}";
}

/**
 * Premiere reports an UNSET In/Out point as a huge negative sentinel
 * (-101606400000000000 ticks). Unset In = sequence start; unset Out = sequence end.
 */
function CutFlowX_inTicks(seq) {
  var t = "0";
  try { t = String(seq.getInPointAsTime().ticks); } catch (e) { t = "0"; }
  return t.charAt(0) === "-" ? "0" : t;
}
function CutFlowX_outTicks(seq) {
  var t = String(seq.end);
  try { t = String(seq.getOutPointAsTime().ticks); } catch (e) { t = String(seq.end); }
  return (t.charAt(0) === "-" || t === "0") ? String(seq.end) : t;
}

/** Connection check: proves the panel can execute code inside Premiere. */
function CutFlowX_ping() {
  try {
    return "{\"ok\":true,\"appVersion\":" + CutFlowX_esc(app.version) + "}";
  } catch (e) {
    return CutFlowX_fail("Premiere did not respond.", e.toString());
  }
}

/** Describes the active sequence without changing anything. */
function CutFlowX_getSequenceInfo() {
  try {
    if (!app.project) return CutFlowX_fail("No project is open.", "app.project is null");
    var seq = app.project.activeSequence;
    if (!seq) return CutFlowX_fail("No sequence detected.", "activeSequence is null");

    var inTicks = CutFlowX_inTicks(seq);
    var outTicks = CutFlowX_outTicks(seq);

    var audio = "";
    for (var a = 0; a < seq.audioTracks.numTracks; a++) {
      var at = seq.audioTracks[a];
      var muted = false;
      try { muted = at.isMuted(); } catch (e3) {}
      if (a > 0) audio += ",";
      audio += "{\"index\":" + a +
        ",\"name\":" + CutFlowX_esc(at.name) +
        ",\"muted\":" + (muted ? "true" : "false") +
        ",\"clips\":" + at.clips.numItems + "}";
    }

    var videoClips = 0;
    for (var v = 0; v < seq.videoTracks.numTracks; v++) videoClips += seq.videoTracks[v].clips.numItems;

    return "{\"ok\":true" +
      ",\"name\":" + CutFlowX_esc(seq.name) +
      ",\"sequenceId\":" + CutFlowX_esc(seq.sequenceID) +
      ",\"timebaseTicks\":" + CutFlowX_esc(seq.timebase) +
      ",\"endTicks\":" + CutFlowX_esc(seq.end) +
      ",\"inTicks\":" + CutFlowX_esc(inTicks) +
      ",\"outTicks\":" + CutFlowX_esc(outTicks) +
      ",\"width\":" + seq.frameSizeHorizontal +
      ",\"height\":" + seq.frameSizeVertical +
      ",\"videoTracks\":" + seq.videoTracks.numTracks +
      ",\"videoClips\":" + videoClips +
      ",\"audioTracks\":[" + audio + "]" +
      "}";
  } catch (e) {
    return CutFlowX_fail("Could not read the active sequence.", e.toString() + (e.line ? " (host.jsx line " + e.line + ")" : ""));
  }
}

/**
 * Renders the active sequence's In→Out range to a WAV using the bundled preset.
 * Read-only for the timeline. Sample 0 of the WAV corresponds to the In point.
 * exportAsMediaDirect is synchronous: Premiere is busy until it returns.
 */
function CutFlowX_exportAudio(outPath, presetPath) {
  try {
    if (!app.project) return CutFlowX_fail("No project is open.", "app.project is null");
    var seq = app.project.activeSequence;
    if (!seq) return CutFlowX_fail("No sequence detected.", "activeSequence is null");

    var preset = new File(presetPath);
    if (!preset.exists) return CutFlowX_fail("The CutFlowX export preset is missing. Reinstall CutFlowX.", preset.fsName);

    var out = new File(outPath);
    if (out.exists) out.remove();

    var inTicks = CutFlowX_inTicks(seq);
    var outTicks = CutFlowX_outTicks(seq);
    var mode = (app.encoder && app.encoder.ENCODE_IN_TO_OUT !== undefined) ? app.encoder.ENCODE_IN_TO_OUT : 1;

    var result = seq.exportAsMediaDirect(out.fsName, preset.fsName, mode);

    out = new File(outPath);
    if (!out.exists) {
      return CutFlowX_fail("Premiere could not export the audio.", "Premiere finished without creating the file (exportAsMediaDirect returned: \"" + String(result) + "\"). Check free disk space, then try again.");
    }
    return "{\"ok\":true" +
      ",\"path\":" + CutFlowX_esc(out.fsName) +
      ",\"sequenceId\":" + CutFlowX_esc(seq.sequenceID) +
      ",\"timebaseTicks\":" + CutFlowX_esc(seq.timebase) +
      ",\"inTicks\":" + CutFlowX_esc(inTicks) +
      ",\"outTicks\":" + CutFlowX_esc(outTicks) +
      ",\"endTicks\":" + CutFlowX_esc(String(seq.end)) +
      ",\"exportResult\":" + CutFlowX_esc(result) +
      "}";
  } catch (e) {
    return CutFlowX_fail("Premiere could not export the audio.", e.toString() + (e.line ? " (host.jsx line " + e.line + ")" : ""));
  }
}

/** Moves the playhead (only). Used to audition a planned cut. */
function CutFlowX_setPlayhead(ticks) {
  try {
    var seq = app.project && app.project.activeSequence;
    if (!seq) return CutFlowX_fail("No sequence detected.", "activeSequence is null");
    seq.setPlayerPosition(String(ticks));
    return "{\"ok\":true}";
  } catch (e) {
    return CutFlowX_fail("Could not move the playhead.", e.toString());
  }
}

// ======================================================================
// Phase 3a: ONE test cut with full before/after verification.
// Ticks are handled as Numbers here: exact for integers below 2^53
// (sequences shorter than ~9.8 hours). Longer sequences are refused.
// ======================================================================

var CutFlowX_MAX_SAFE = 9007199254740991;

function CutFlowX_snapshot(seq) {
  var out = [];
  var kinds = [["V", seq.videoTracks], ["A", seq.audioTracks]];
  for (var k = 0; k < kinds.length; k++) {
    var tracks = kinds[k][1];
    for (var i = 0; i < tracks.numTracks; i++) {
      var t = tracks[i];
      var locked = false;
      try { locked = t.isLocked(); } catch (e) {}
      var items = [];
      for (var j = 0; j < t.clips.numItems; j++) {
        var c = t.clips[j];
        items.push({ s: Number(c.start.ticks), e: Number(c.end.ticks), name: String(c.name) });
      }
      items.sort(function (a, b) { return a.s - b.s; });
      out.push({ kind: kinds[k][0], index: i, locked: locked, items: items });
    }
  }
  return out;
}

function CutFlowX_timecode(seq, ticks) {
  var t = new Time();
  t.ticks = String(ticks);
  var st = seq.getSettings();
  return t.getFormatted(st.videoFrameRate, st.videoDisplayFormat);
}

function CutFlowX_trackObj(seq, kind, index) {
  return kind === "V" ? seq.videoTracks[index] : seq.audioTracks[index];
}

/** Items fully inside [s, e] on one track, removed last-to-first with ripple. Returns how many. */
function CutFlowX_removeInside(seq, kind, index, s, e) {
  var track = CutFlowX_trackObj(seq, kind, index);
  var removed = 0;
  for (var j = track.clips.numItems - 1; j >= 0; j--) {
    var c = track.clips[j];
    var cs = Number(c.start.ticks), ce = Number(c.end.ticks);
    if (cs >= s && ce <= e) { c.remove(true, true); removed++; }
  }
  return removed;
}

/** Checks the plan still describes the active sequence exactly. Returns "" when valid, else a fail JSON. */
function CutFlowX_checkPlan(seq, sequenceId, timebaseTicks, inTicks, outTicks) {
  if (String(seq.sequenceID) !== String(sequenceId)) return CutFlowX_fail("A different sequence is active. Analyze again.", "sequenceID changed");
  if (String(seq.timebase) !== String(timebaseTicks)) return CutFlowX_fail("The sequence frame rate changed. Analyze again.", "timebase changed");
  if (CutFlowX_inTicks(seq) !== String(inTicks) || CutFlowX_outTicks(seq) !== String(outTicks)) {
    return CutFlowX_fail("The In/Out range changed since the analysis. Analyze again.", "in/out changed");
  }
  if (Number(seq.end) > CutFlowX_MAX_SAFE) return CutFlowX_fail("This sequence is too long for CutFlowX (over 9 hours).", "ticks beyond 2^53");
  var snap = CutFlowX_snapshot(seq);
  for (var i = 0; i < snap.length; i++) {
    if (snap[i].locked && snap[i].items.length > 0) {
      return CutFlowX_fail("Track " + snap[i].kind + (snap[i].index + 1) + " is locked. Unlock all tracks, then try again.", "locked track");
    }
  }
  return "";
}

/** One cut: razor every track at e then s, remove what is inside with ripple, verify every track. */
function CutFlowX_cutOnce(seq, s, e, tpf) {
  var endBefore = Number(seq.end);
  // Premiere can report an Out point one frame past the last clip. Nothing exists beyond the
  // sequence end, so a cut reaching past it is measured and verified only up to the real end.
  var clamped = false;
  var lastFrame = Math.floor(endBefore / tpf) * tpf;
  if (e > lastFrame) { e = lastFrame; clamped = true; }
  if (e <= s) {
    return { verified: true, json: "\"verified\":true,\"cutFrames\":0,\"endOffFrames\":0,\"skipped\":true,\"clampedToSequenceEnd\":true" +
      ",\"timecodes\":\"\",\"endOk\":true,\"tracks\":[]" };
  }
  var d = e - s;
  var before = CutFlowX_snapshot(seq);

  app.enableQE();
  var q = qe.project.getActiveSequence();
  var tcE = CutFlowX_timecode(seq, e), tcS = CutFlowX_timecode(seq, s);
  for (var v = 0; v < seq.videoTracks.numTracks; v++) { q.getVideoTrackAt(v).razor(tcE); q.getVideoTrackAt(v).razor(tcS); }
  for (var a = 0; a < seq.audioTracks.numTracks; a++) { q.getAudioTrackAt(a).razor(tcE); q.getAudioTrackAt(a).razor(tcS); }
  var razored = CutFlowX_snapshot(seq);

  var removedCounts = [];
  for (var r = 0; r < razored.length; r++) removedCounts.push(CutFlowX_removeInside(seq, razored[r].kind, razored[r].index, s, e));
  var after = CutFlowX_snapshot(seq);
  var endAfter = Number(seq.end);

  var trackJson = "", allOk = true;
  for (var t = 0; t < razored.length; t++) {
    var rz = razored[t], af = after[t];
    var razorOk = true, problem = "", detail = "";
    for (var x = 0; x < rz.items.length; x++) {
      var it = rz.items[x];
      if ((it.s < s && it.e > s) || (it.s < e && it.e > e)) { razorOk = false; problem = "The razor did not split '" + it.name + "' at the cut."; }
    }
    var expected = [];
    for (var y = 0; y < rz.items.length; y++) {
      var ri = rz.items[y];
      if (ri.e <= s) expected.push({ s: ri.s, e: ri.e });
      else if (ri.s >= e) expected.push({ s: ri.s - d, e: ri.e - d });
    }
    var ok = razorOk && expected.length === af.items.length;
    if (razorOk && !ok) problem = "Expected " + expected.length + " clips on this track after the cut, found " + af.items.length + ".";
    for (var z = 0; ok && z < expected.length; z++) {
      if (expected[z].s !== af.items[z].s || expected[z].e !== af.items[z].e) {
        ok = false;
        var off = (af.items[z].s - expected[z].s) / tpf;
        problem = "'" + af.items[z].name + "' is " + Math.abs(off) + " frames " + (off > 0 ? "late" : "early") + " (out of sync).";
        detail = "clip " + (z + 1) + " at " + af.items[z].s + "→" + af.items[z].e + ", expected " + expected[z].s + "→" + expected[z].e;
      }
    }
    if (!ok) allOk = false;
    if (t > 0) trackJson += ",";
    trackJson += "{\"track\":" + CutFlowX_esc(rz.kind + (rz.index + 1)) +
      ",\"clipsBefore\":" + before[t].items.length + ",\"clipsAfterRazor\":" + rz.items.length +
      ",\"removed\":" + removedCounts[t] + ",\"clipsAfter\":" + af.items.length +
      ",\"razorOk\":" + (razorOk ? "true" : "false") + ",\"ok\":" + (ok ? "true" : "false") +
      ",\"problem\":" + CutFlowX_esc(problem) + ",\"detail\":" + CutFlowX_esc(detail) + "}";
  }
  var endOk = endAfter === endBefore - d;
  if (!endOk) allOk = false;
  return {
    verified: allOk,
    json: "\"verified\":" + (allOk ? "true" : "false") +
      ",\"cutFrames\":" + (d / tpf) +
      ",\"clampedToSequenceEnd\":" + (clamped ? "true" : "false") +
      ",\"endOffFrames\":" + ((endAfter - (endBefore - d)) / tpf) +
      ",\"timecodes\":" + CutFlowX_esc(tcS + " → " + tcE) +
      ",\"endBefore\":" + CutFlowX_esc(String(endBefore)) + ",\"endAfter\":" + CutFlowX_esc(String(endAfter)) +
      ",\"endExpected\":" + CutFlowX_esc(String(endBefore - d)) + ",\"endOk\":" + (endOk ? "true" : "false") +
      ",\"tracks\":[" + trackJson + "]"
  };
}

/** Parses "s1-e1,s2-e2" (ascending), validating every cut before anything is edited. */
function CutFlowX_parseCuts(csv, inTicks, outTicks, tpf) {
  var parts = String(csv).split(","), cuts = [], prevEnd = Number(inTicks);
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].split("-");
    var s = Number(p[0]), e = Number(p[1]);
    if (p.length !== 2 || isNaN(s) || isNaN(e)) return { error: "cut " + (i + 1) + " is malformed: " + parts[i] };
    if (!(e > s)) return { error: "cut " + (i + 1) + " is empty" };
    if (s < prevEnd) return { error: "cut " + (i + 1) + " overlaps or is out of order" };
    if (e > Number(outTicks)) return { error: "cut " + (i + 1) + " goes past the Out point" };
    if (s % tpf !== 0 || e % tpf !== 0) return { error: "cut " + (i + 1) + " is not on a frame boundary" };
    cuts.push({ s: s, e: e });
    prevEnd = e;
  }
  return { cuts: cuts };
}

function CutFlowX_testCut(sequenceId, timebaseTicks, inTicks, outTicks, startTicks, endTicks) {
  try {
    var seq = app.project && app.project.activeSequence;
    if (!seq) return CutFlowX_fail("No sequence detected.", "activeSequence is null");
    var bad = CutFlowX_checkPlan(seq, sequenceId, timebaseTicks, inTicks, outTicks);
    if (bad) return bad;
    var tpf = Number(timebaseTicks);
    var parsed = CutFlowX_parseCuts(startTicks + "-" + endTicks, inTicks, outTicks, tpf);
    if (parsed.error) return CutFlowX_fail("The cut plan is invalid. Analyze again.", parsed.error);
    var r = CutFlowX_cutOnce(seq, parsed.cuts[0].s, parsed.cuts[0].e, tpf);
    return "{\"ok\":true," + r.json + "}";
  } catch (err) {
    return CutFlowX_fail("The test cut stopped with an error.", err.toString() + (err.line ? " (host.jsx line " + err.line + ")" : ""));
  }
}

/**
 * Every planned cut, LAST FIRST so earlier positions never move. Each cut is verified;
 * on the first problem the run STOPS, leaving the earlier (untouched) part of the timeline intact.
 */
function CutFlowX_cutAll(sequenceId, timebaseTicks, inTicks, outTicks, cutsCsv) {
  var done = 0, total = 0, framesRemoved = 0, started = false;
  try {
    var seq = app.project && app.project.activeSequence;
    if (!seq) return CutFlowX_fail("No sequence detected.", "activeSequence is null");
    var bad = CutFlowX_checkPlan(seq, sequenceId, timebaseTicks, inTicks, outTicks);
    if (bad) return bad;
    var tpf = Number(timebaseTicks);
    var parsed = CutFlowX_parseCuts(cutsCsv, inTicks, outTicks, tpf);
    if (parsed.error) return CutFlowX_fail("The cut plan is invalid. Nothing was cut. Analyze again.", parsed.error);
    var cuts = parsed.cuts;
    total = cuts.length;

    for (var i = cuts.length - 1; i >= 0; i--) {
      started = true; // from here on the timeline may have changed, even if this cut fails
      var r = CutFlowX_cutOnce(seq, cuts[i].s, cuts[i].e, tpf);
      if (!r.verified) {
        return "{\"ok\":true,\"complete\":false,\"done\":" + done + ",\"total\":" + total +
          ",\"framesRemoved\":" + framesRemoved + ",\"failedCut\":" + (i + 1) + ",\"failure\":{" + r.json + "}}";
      }
      done++;
      framesRemoved += Number(r.json.match(/"cutFrames":(\d+)/)[1]);
    }
    return "{\"ok\":true,\"complete\":true,\"done\":" + done + ",\"total\":" + total + ",\"framesRemoved\":" + framesRemoved + "}";
  } catch (err) {
    return "{\"ok\":false,\"error\":" + CutFlowX_esc("Cutting stopped with an error after " + done + " of " + total + " cuts.") +
      ",\"detail\":" + CutFlowX_esc(err.toString() + (err.line ? " (host.jsx line " + err.line + ")" : "")) +
      ",\"done\":" + done + ",\"total\":" + total + ",\"started\":" + (started ? "true" : "false") + "}";
  }
}
