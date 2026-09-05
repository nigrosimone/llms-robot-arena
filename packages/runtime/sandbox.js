import { newQuickJSWASMModule } from "quickjs-emscripten";
import variant from "@jitl/quickjs-singlefile-browser-release-sync";
import { SPEC as S } from "../sim/spec.js";
let modulePromise;
const getModule = () => (modulePromise ??= newQuickJSWASMModule(variant));
// Trusted host code never gives bot code a bridge to the JS host or the DOM.
const lockdown = `(() => {
  const root=globalThis;
  const keep=new Set(['Object','Array','Number','String','Boolean','Math','JSON','Infinity','NaN','undefined','parseInt','parseFloat','isFinite','isNaN','Error','TypeError','RangeError','SyntaxError','ReferenceError','URIError','EvalError','RegExp','Map','Set','WeakMap','WeakSet','BigInt','Symbol','Uint8Array','Uint16Array','Uint32Array','Int8Array','Int16Array','Int32Array','Float32Array','Float64Array','ArrayBuffer','DataView']);
  const constructors=[Function,(async()=>{}).constructor,(function*(){}).constructor,(async function*(){}).constructor];
  for(const c of constructors)Object.defineProperty(c.prototype,'constructor',{value:undefined,writable:false,configurable:false});
  Object.defineProperty(Math,'random',{value:undefined,writable:false,configurable:false});
  const seen=new Set();
  function freeze(o){if(!o||(typeof o!=='object'&&typeof o!=='function')||seen.has(o))return;seen.add(o);for(const k of Reflect.ownKeys(o)){const d=Object.getOwnPropertyDescriptor(o,k);if(d&&'value'in d)freeze(d.value);}Object.freeze(o);}
  for(const key of keep)freeze(root[key]);
  for(const key of Object.getOwnPropertyNames(root))if(!keep.has(key)){try{Object.defineProperty(root,key,{value:undefined,writable:false,configurable:false});}catch{}}
})()`;
export async function createSandbox(compiled, { budgetMode = "fuel" } = {}) {
  const mod = await getModule(),
    rt = mod.newRuntime();
  rt.setMemoryLimit(16 * 1024 * 1024);
  rt.setMaxStackSize(256 * 1024);
  const ctx = rt.newContext();
  let deadline = Infinity,
    cycles = 0,
    cycleLimit = Infinity;
  rt.setInterruptHandler(
    () =>
      ++cycles > cycleLimit ||
      (budgetMode === "wall" && performance.now() > deadline),
  );
  const evaluate = (code) => {
    const r = ctx.evalCode(code);
    if (r.error) {
      const e = ctx.dump(r.error);
      r.error.dispose();
      throw new Error(e.message ?? "Sandbox error");
    }
    return r.value;
  };
  let runner;
  try {
    evaluate(lockdown).dispose();
    // Construct a fresh module scope on every call; only the serialized memory persists.
    const src = `(function(input, prior) {
      'use strict';
      const s=JSON.parse(input), m=JSON.parse(prior);
      const freeze=v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const k of Object.keys(v))freeze(v[k]);Object.freeze(v);}};
      freeze(s);freeze(m);
      const factory=()=>{${compiled}\n;return tick;};
      const out=factory()(s,m);
      const problems=[];
      let thrust=out?.actions?.thrust,turn=out?.actions?.turn;
      if(typeof thrust!=='number'||!Number.isFinite(thrust)){thrust=0;problems.push('invalid-thrust');}
      if(typeof turn!=='number'||!Number.isFinite(turn)){turn=0;problems.push('invalid-turn');}
      let memory=prior;
      try {
        const stack=new Set();
        let visited=0;
        function check(v){
          if(++visited>65536)throw Error('memory-limit');
          if(v===null||typeof v==='string'||typeof v==='boolean')return;
          if(typeof v==='number'&&Number.isFinite(v))return;
          if(typeof v!=='object'||stack.has(v))throw Error('memory-not-json');
          if(!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)throw Error('memory-not-json');
          stack.add(v);for(const k of Object.keys(v))check(v[k]);stack.delete(v);
        }
        check(out.memory);
        const encoded=JSON.stringify(out.memory);
        if(typeof encoded!=='string'||encoded.length>65536)throw Error('memory-limit');
        const bytes=encoded.replace(/[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]/g,'xxxx').replace(/[\\u0800-\\uFFFF]/g,'xxx').replace(/[\\u0080-\\u07FF]/g,'xx').length;
        if(bytes>65536)throw Error('memory-limit');
        memory=encoded;
      }catch{problems.push('invalid-memory');}
      return JSON.stringify({actions:{thrust:Math.max(-1,Math.min(1,thrust)),turn:Math.max(-1,Math.min(1,turn))},memory,violations:problems});
    })`;
    const start = performance.now();
    deadline = start + S.INIT_BUDGET_MS;
    cycles = 0;
    cycleLimit = 200;
    runner = evaluate(src);
    if (budgetMode === "wall" && performance.now() - start > S.INIT_BUDGET_MS)
      throw new Error("init-budget");
  } catch (e) {
    runner?.dispose();
    ctx.dispose();
    rt.dispose();
    throw e;
  }
  let memory = "null";
  return {
    call(sensors, explicitMemory) {
      const previous =
        explicitMemory === undefined ? memory : JSON.stringify(explicitMemory);
      const input = ctx.newString(JSON.stringify(sensors)),
        prior = ctx.newString(previous);
      cycles = 0;
      cycleLimit = 8;
      const start = performance.now();
      deadline = start + S.TICK_BUDGET_MS;
      let output;
      try {
        const r = ctx.callFunction(runner, ctx.undefined, input, prior);
        const duration = performance.now() - start;
        if (r.error) {
          const e = ctx.dump(r.error);
          r.error.dispose();
          output = {
            actions: { thrust: 0, turn: 0 },
            memory: previous,
            violations: [
              /interrupt/.test(e.message ?? "") ? "tick-budget" : "exception",
            ],
          };
        } else {
          const raw = ctx.getString(r.value);
          r.value.dispose();
          output = JSON.parse(raw);
          if (budgetMode === "wall" && duration > S.TICK_BUDGET_MS)
            output = {
              actions: { thrust: 0, turn: 0 },
              memory: previous,
              violations: ["tick-budget"],
            };
        }
        output.duration = duration;
      } catch {
        output = {
          actions: { thrust: 0, turn: 0 },
          memory: previous,
          violations: ["exception"],
          duration: performance.now() - start,
        };
      } finally {
        input.dispose();
        prior.dispose();
        deadline = Infinity;
        cycleLimit = Infinity;
      }
      if (explicitMemory === undefined) memory = output.memory;
      return output;
    },
    dispose() {
      runner.dispose();
      ctx.dispose();
      rt.dispose();
    },
  };
}
