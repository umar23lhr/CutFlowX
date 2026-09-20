# CutFlowX — Smart Silence Cutter for Premiere Pro

Developer: **M Umar Saeed**

This package is the **detection core**: pure TypeScript with no Premiere imports. The UXP panel and the C++ hybrid part both sit on top of it later, behind a Timeline Adapter.

```
Audio (PcmAudio, sample 0 = start of analyzed timeline range)
 → analyzer.ts        20 ms RMS windows, 5 ms hop, loudest channel wins
 → silenceDetector.ts threshold + hysteresis, click merging, conservative window→sample mapping
 → boundaryRefiner.ts edges move inward until level settles on the region's noise floor
 → engine.ts          min-duration filter → padding → INWARD frame snapping → ticks
 → cutValidation.ts   whole plan validated before anything touches Premiere
 → diagnostics.ts     detected / refined / padded / frames / ticks for every cut
```

## Guarantees enforced by tests

- No removed frame overlaps audible sound or its padding. Every test checks this against ground truth, including decaying word tails.
- Frame snapping only shrinks a cut. The start rounds up and the end rounds down.
- All timeline math is exact BigInt ticks. At 254,016,000,000 ticks/s every supported rate has an integer frame duration, and results stay exact past 10 hours.
- Speech on one channel only is never treated as silence.

Run the checks with `npm install && npm test && npm run typecheck`.

## Honest status

| Part | Status |
|---|---|
| Detection engine, refinement, frame conversion | Implemented. 30 synthetic tests pass. Mutation-checked. |
| Real human speech | **Not yet tested.** Needs WAV fixtures from your own recordings (§28). |
| Getting timeline audio into the engine | Not built. The plan is to have Premiere render the sequence range to WAV, then run `parseWav`. The UXP export path is unverified. |
| UXP panel / UI | Not started. |
| Razor via C++ | **Unverified: this is the go/no-go gate.** See below. |

## Hybrid route: what must be verified first

The UXP DOM has `createRemoveItemsAction` with ripple, but no split/razor as of 26.2.2 (community reports). The only known workaround is a Premiere **Control Surface** C++ plugin that triggers the host's internal "Add Edit" command. Adobe's public docs do not describe a command-dispatch function. That claim comes from a third-party developer. Before any C++ is written, the headers in `adobesdk/controlsurface/host` from the Premiere C++ SDK must be checked for such a suite.

Known costs of this route, even if it works:
- The Control Surface plugin is a separate binary. Users enable it under Preferences > Control Surface.
- It needs native builds for Windows x64, macOS (arm64 + x64) and possibly Windows ARM.
- Each Add Edit is likely its own undo step. This is unconfirmed.
