// web/runtime/worklet.ts
var QUANTUM = 128;
function readCString(mem, ptr) {
  const bytes = new Uint8Array(mem.buffer);
  let end = ptr;
  while (bytes[end] !== 0) end++;
  let s = "";
  for (let i = ptr; i < end; ) {
    const b0 = bytes[i] ?? 0;
    if (b0 < 128) {
      s += String.fromCharCode(b0);
      i += 1;
    } else if (b0 < 224) {
      s += String.fromCharCode((b0 & 31) << 6 | (bytes[i + 1] ?? 0) & 63);
      i += 2;
    } else if (b0 < 240) {
      s += String.fromCharCode((b0 & 15) << 12 | ((bytes[i + 1] ?? 0) & 63) << 6 | (bytes[i + 2] ?? 0) & 63);
      i += 3;
    } else {
      const cp = (b0 & 7) << 18 | ((bytes[i + 1] ?? 0) & 63) << 12 | ((bytes[i + 2] ?? 0) & 63) << 6 | (bytes[i + 3] ?? 0) & 63;
      s += String.fromCodePoint(cp);
      i += 4;
    }
  }
  return s;
}
var SynthlandProcessor = class extends AudioWorkletProcessor {
  ex = null;
  engine = 0;
  heap = null;
  outPtr = [0, 0];
  inPtr = [0, 0];
  kind;
  audioInput = false;
  telPtr = 0;
  pending = [];
  peakL = 0;
  peakR = 0;
  meterEvery;
  quantaSinceMeter = 0;
  alive = true;
  constructor(options) {
    super();
    const po = options?.processorOptions ?? {};
    this.kind = po.kind ?? "synth";
    this.audioInput = po.audioInput === true;
    const hz = po.meterHz && po.meterHz > 0 ? po.meterHz : 20;
    this.meterEvery = Math.max(1, Math.round(sampleRate / hz / QUANTUM));
    this.port.onmessage = (ev) => {
      const m = ev.data;
      if (m.t === "close") {
        this.alive = false;
        if (this.ex && this.engine) this.ex.sl_destroy(this.engine);
        this.engine = 0;
        return;
      }
      this.pending.push(m);
    };
    if (po.wasmBytes) {
      void this.boot(po.wasmBytes, po.seed ?? 1, po.initial ?? []);
    } else {
      this.post({ t: "error", message: "no wasm bytes in processorOptions" });
    }
  }
  post(m) {
    this.port.postMessage(m);
  }
  async boot(bytes, seed, initial) {
    try {
      const imports = {
        // Standalone wasm only needs WASI stubs (printf paths are never hit in practice).
        wasi_snapshot_preview1: {
          fd_write: () => 0,
          fd_close: () => 0,
          fd_seek: () => 0,
          proc_exit: () => void 0,
          environ_sizes_get: () => 0,
          environ_get: () => 0
        },
        env: {
          emscripten_notify_memory_growth: () => void 0,
          abort: () => {
            throw new Error("wasm abort");
          }
        }
      };
      const { instance } = await WebAssembly.instantiate(bytes, imports);
      const ex = instance.exports;
      ex._initialize?.();
      if (!this.alive) return;
      const engine = ex.sl_create();
      ex.sl_set_seed(engine, seed >>> 0);
      ex.sl_prepare(engine, sampleRate, QUANTUM);
      for (const [i, v] of initial) ex.sl_set_param(engine, i, v);
      this.heap = new Float32Array(ex.memory.buffer);
      this.outPtr = [ex.sl_out_ptr(engine, 0) >> 2, ex.sl_out_ptr(engine, 1) >> 2];
      this.inPtr = [ex.sl_in_ptr(engine, 0) >> 2, ex.sl_in_ptr(engine, 1) >> 2];
      this.telPtr = ex.sl_telemetry_ptr ? ex.sl_telemetry_ptr(engine) >> 2 : 0;
      const params = JSON.parse(readCString(ex.memory, ex.sl_param_json(engine)));
      this.ex = ex;
      this.engine = engine;
      this.post({ t: "ready", params, isSynth: ex.sl_is_synth(engine) === 1, tail: ex.sl_tail_seconds(engine) });
    } catch (err) {
      this.post({ t: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }
  drain() {
    const ex = this.ex;
    if (!ex) return;
    const e = this.engine;
    for (const m of this.pending) {
      switch (m.t) {
        case "param":
          ex.sl_set_param(e, m.i, m.v);
          break;
        case "params":
          for (const [i, v] of m.values) ex.sl_set_param(e, i, v);
          break;
        case "midi":
          ex.sl_midi(e, m.type, m.ch, m.d1, m.d2, m.bend, 0);
          break;
        case "reset":
          ex.sl_reset(e);
          break;
        case "seed":
          ex.sl_set_seed(e, m.seed >>> 0);
          break;
        case "close":
          break;
      }
    }
    this.pending.length = 0;
  }
  process(inputs, outputs) {
    if (!this.alive) return false;
    const out = outputs[0];
    const ex = this.ex;
    const heap = this.heap;
    if (!ex || !heap || !out || out.length === 0) return true;
    this.drain();
    let numIn = 0;
    if (this.kind === "effect") {
      const inp = inputs[0];
      if (inp && inp.length > 0 && inp[0] && inp[0].length > 0) {
        numIn = Math.min(2, inp.length);
        for (let c = 0; c < 2; c++) {
          const src = inp[Math.min(c, inp.length - 1)];
          if (src) heap.set(src.subarray(0, QUANTUM), this.inPtr[c] ?? 0);
        }
        numIn = 2;
      } else {
        heap.fill(0, this.inPtr[0], this.inPtr[0] + QUANTUM);
        heap.fill(0, this.inPtr[1], this.inPtr[1] + QUANTUM);
        numIn = 2;
      }
    } else if (this.audioInput) {
      const inp = inputs[0];
      if (inp && inp.length > 0 && inp[0] && inp[0].length > 0) {
        for (let c = 0; c < 2; c++) {
          const src = inp[Math.min(c, inp.length - 1)];
          if (src) heap.set(src.subarray(0, QUANTUM), this.inPtr[c] ?? 0);
        }
        numIn = 2;
      }
    }
    ex.sl_process(this.engine, numIn, QUANTUM);
    const l = heap.subarray(this.outPtr[0], this.outPtr[0] + QUANTUM);
    const r = heap.subarray(this.outPtr[1], this.outPtr[1] + QUANTUM);
    const o0 = out[0];
    const o1 = out[1] ?? out[0];
    if (o0) o0.set(l);
    if (o1 && o1 !== o0) o1.set(r);
    let pl = this.peakL;
    let pr = this.peakR;
    for (let i = 0; i < QUANTUM; i++) {
      const a = Math.abs(l[i] ?? 0);
      const b = Math.abs(r[i] ?? 0);
      if (a > pl) pl = a;
      if (b > pr) pr = b;
    }
    this.peakL = pl;
    this.peakR = pr;
    if (++this.quantaSinceMeter >= this.meterEvery) {
      this.quantaSinceMeter = 0;
      let telemetry;
      if (ex.sl_telemetry && this.telPtr) {
        const n = ex.sl_telemetry(this.engine);
        if (n > 0) telemetry = Array.from(heap.subarray(this.telPtr, this.telPtr + n));
      }
      this.post({ t: "meter", voices: ex.sl_active_voices(this.engine), outL: this.peakL, outR: this.peakR, telemetry });
      this.peakL = 0;
      this.peakR = 0;
    }
    return true;
  }
};
registerProcessor("synthland-engine", SynthlandProcessor);
//# sourceMappingURL=worklet.js.map
