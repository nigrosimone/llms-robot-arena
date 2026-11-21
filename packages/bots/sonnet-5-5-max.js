// sonnet-5-5-max: a hazard-aware model-predictive controller.
//
// Every tick it scores a handful of candidate policies by rolling our own motion (and a simple
// pursuer model of the opponent) forward about 1.3 s, then plays the cheapest one.
// Hard constraints: never end up outside the arena, in a hole, or on a tile about to open.
// Soft goals: avoid contact and flank/rear hits, take flips, use holes and the edge against a blind
// pursuer, recharge when low, keep moving off worn floor.

const PI = Math.PI;
const TAU = 2 * PI;
const cos = Math.cos;
const sin = Math.sin;
const atan2 = Math.atan2;
const sqrt = Math.sqrt;
const abs = Math.abs;
const exp = Math.exp;
const round = Math.round;

// Planning steps (seconds): fine near-term steps for accurate contact timing, coarser later ones.
const HS = [0.1, 0.12, 0.16, 0.2, 0.26, 0.3];
const N = HS.length;
const HORIZON = 1.14;
const TK = [0.1, 0.22, 0.38, 0.58, 0.84, 1.14]; // time at the end of each step
// exact discretisation of speed (rate 1.6/s) and turn rate (rate 1.8/s) for a held command
const AS = HS.map((h) => exp(-1.6 * h));
const BS = HS.map((h) => exp(-1.8 * h));
const CS = HS.map((h, i) => (1 - BS[i]) / 1.8);
const DS = HS.map((h, i) => (1 - AS[i]) / 1.6);
const NPOL = 10;

function wrap(a) {
  return a - TAU * round(a / TAU);
}
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function lev(a) {
  return a < 1.2217 ? 0.6 : a < 2.5307 ? 1 : 0.85;
}
// clamp to [-1, 1] and never return NaN
function fin(v) {
  return v > 1 ? 1 : v < -1 ? -1 : v === v ? v : 0;
}

export function tick(s, m) {
  const me = s.self;
  const op = s.opponent;
  const ar = s.arena;
  const t0 = s.time;
  const sx = me.x;
  const sy = me.y;
  const sh = me.heading;
  const sw0 = me.omega;
  const ss0 = me.vx * cos(sh) + me.vy * sin(sh);
  const ox = op.x;
  const oy = op.y;
  const oh = op.heading;
  const ow0 = op.omega;
  const os0 = op.vx * cos(oh) + op.vy * sin(oh);
  const dead = op.energy <= 0.5; // motors stopped: it can only coast, and its own tile will wear out
  const down = op.status === 'flipped'; // helpless for a few seconds
  const opAct = !dead && !down; // behaves like the pursuer model (active or recovering)
  const he0 = ar.halfExtent;
  const myE = me.energy;
  const lastPol = m && typeof m.p === 'number' ? m.p : -1;

  // ---------------------------------------------------------------- floor state (small prefiltered lists)
  const hz = []; // cx, cy, seconds until the tile is a hole (0 = already a hole)
  const wear = []; // cx, cy, integrity (worn but safe tiles)
  const flames = []; // cx, cy, active-from, active-until (seconds from now)
  const chargers = []; // cx, cy, seconds until ready
  const cells = ar.cells;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c.state === 'inactive') continue;
    if (c.type === 'floor' && c.collapseIn === null && c.integrity >= 0.7) continue; // barely worn floor
    const cx = c.x;
    const cy = c.y;
    if (abs(cx - sx) > 9 && abs(cx - ox) > 9) continue;
    if (c.type === 'hole') {
      hz.push(cx, cy, 0);
    } else if (c.collapseIn !== null) {
      hz.push(cx, cy, c.collapseIn);
    } else if (c.integrity < 0.7) {
      wear.push(cx, cy, c.integrity);
    }
    if (c.type === 'flame') {
      const tu = c.timeUntilChange === null ? 0 : c.timeUntilChange;
      if (c.state === 'flaming') flames.push(cx, cy, 0, tu);
      else if (c.state === 'warning') flames.push(cx, cy, tu, tu + 1.5);
      else if (tu < 1.5) flames.push(cx, cy, tu + 1, tu + 2.5);
    } else if (c.type === 'recharge') {
      chargers.push(cx, cy, c.state === 'ready' || c.timeUntilChange === null ? 0 : c.timeUntilChange);
    }
  }
  const nz = hz.length;
  const nw = wear.length;
  const nf = flames.length;
  const nc = chargers.length;

  // Hard hazard test at (x, y) at time t (used outside the hot loop).
  const hardAt = (x, y, t, he) => {
    if (x > he - 0.45 || x < 0.45 - he || y > he - 0.45 || y < 0.45 - he) return true;
    for (let i = 0; i < nz; i += 3) {
      if (t + 0.12 >= hz[i + 2] && abs(x - hz[i]) < 0.8 && abs(y - hz[i + 1]) < 0.8) return true;
    }
    return false;
  };

  // ---------------------------------------------------------------- opponent geometry
  const dxo = ox - sx;
  const dyo = oy - sy;
  const dOpp = sqrt(dxo * dxo + dyo * dyo);
  const bearO = atan2(dyo, dxo);
  const errP0 = wrap(bearO + PI - oh); // pursuer's aim error toward us
  const pursue = opAct && dOpp < 12;

  // ---------------------------------------------------------------- guidance point
  let gx = 0;
  let gy = 0;
  let gw = 3;
  let gmode = 0;
  if (dead) {
    // A frozen opponent loses its tile in about 15 s. Pushing it wastes our own energy: just stay safe,
    // keep a reserve, and step off worn floor (the wear cost in the rollouts does that).
    gx = sx;
    gy = sy;
    gw = 0.5;
    gmode = 4;
    if (dOpp < 2.2) {
      // do not wait next to it: its tile collapsing under both of us would be a draw
      const k = 2.6 / (dOpp + 1e-6);
      gx = clamp(ox - dxo * k, 1 - he0, he0 - 1);
      gy = clamp(oy - dyo * k, 1 - he0, he0 - 1);
      gw = 2;
    }
  } else if (down) {
    // push the helpless opponent toward the nearest exit (edge or hole)
    let bx = 0;
    let by = 0;
    let bd = 1e9;
    const ex = [he0 - ox, he0 + ox, he0 - oy, he0 + oy];
    const edx = [1, -1, 0, 0];
    const edy = [0, 0, 1, -1];
    for (let i = 0; i < 4; i++) {
      if (ex[i] < bd) {
        bd = ex[i];
        bx = edx[i];
        by = edy[i];
      }
    }
    for (let i = 0; i < nz; i += 3) {
      if (hz[i + 2] > 0) continue;
      const hx = hz[i] - ox;
      const hy = hz[i + 1] - oy;
      const hd = sqrt(hx * hx + hy * hy) - 0.4;
      if (hd < bd && hd > 0.2) {
        bd = hd;
        bx = hx / (hd + 0.4);
        by = hy / (hd + 0.4);
      }
    }
    gx = ox - bx * 1.1;
    gy = oy - by * 1.1;
    gmode = 3;
    gw = 6;
    // once lined up behind it, drive through it along the exit direction
    const lx = gx - sx;
    const ly = gy - sy;
    if (lx * lx + ly * ly < 0.5 && (ox - sx) * bx + (oy - sy) * by > 0) {
      gx = ox + bx * 1.5;
      gy = oy + by * 1.5;
    }
  } else {
    // trap: stand just behind a hole, seen from the pursuer, so its straight charge crosses it
    let bestD = 1e9;
    for (let i = 0; i < nz; i += 3) {
      if (hz[i + 2] > 0) continue;
      const hx = hz[i];
      const hy = hz[i + 1];
      let ux = hx - ox;
      let uy = hy - oy;
      const dc = sqrt(ux * ux + uy * uy);
      if (dc < 1.2) continue;
      ux /= dc;
      uy /= dc;
      const qx = hx + 1.5 * ux;
      const qy = hy + 1.5 * uy;
      if (abs(qx) > he0 - 1.0 || abs(qy) > he0 - 1.0) continue;
      if (hardAt(qx, qy, 0, he0 - 0.4)) continue;
      const dq = sqrt((qx - sx) * (qx - sx) + (qy - sy) * (qy - sy));
      // When the pursuer is still far, only go for a trap we can reach before it gets there; once it is
      // close, keep dancing around the nearest hole so that its straight charge crosses it.
      const tUs = dq / 4 + 0.3 + 0.25 * abs(wrap(atan2(qy - sy, qx - sx) - sh));
      const tP = (dc - 0.5) / 3.8 + 0.35 + (abs(errP0) > 0.3 ? 0.5 : 0);
      if (tUs > tP && dOpp > 3.5) continue;
      if (dq < bestD) {
        bestD = dq;
        gx = qx;
        gy = qy;
        gmode = 1;
        gw = 5;
      }
    }
  }
  if (gmode === 0 && myE < 170 && nc > 0) {
    let bestD = 1e9;
    for (let i = 0; i < nc; i += 3) {
      const cx = chargers[i];
      const cy = chargers[i + 1];
      const dq = sqrt((cx - sx) * (cx - sx) + (cy - sy) * (cy - sy)) + chargers[i + 2] * 3;
      if (dq < bestD && abs(cx) < he0 - 0.8 && abs(cy) < he0 - 0.8) {
        bestD = dq;
        gx = cx;
        gy = cy;
        gmode = 2;
        gw = 4;
      }
    }
  }

  // ---------------------------------------------------------------- rollouts
  const U0 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const W0 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const myFlips = me.flipsTaken;
  const opFlips = op.flipsTaken;
  const needE = myE < 240;
  const shrink = t0 >= 60 ? 0.07 : 0;

  const roll = (pol) => {
    // locals are cheaper to read than captured variables in the interpreter
    const Lhz = hz;
    const Lnz = nz;
    const Lwear = wear;
    const Lnw = nw;
    const Lfl = flames;
    const Lnf = nf;
    const Lch = chargers;
    const Lnc = nc;
    const Lgx = gx;
    const Lgy = gy;
    const Lhe0 = he0;
    const Lshr = shrink;
    const Lpur = pursue;
    const LmyFl = myFlips;
    const LopFl = opFlips;
    let x = sx;
    let y = sy;
    let th = sh;
    let w = sw0;
    let sp = ss0;
    let px = ox;
    let py = oy;
    let pth = oh;
    let pw = ow0;
    let psp = os0;
    let cost = 0;
    let ended = false;
    let gotE = false;
    let touched = false;
    for (let k = 0; k < N; k++) {
      const h = HS[k];
      const a1 = AS[k];
      const b1 = BS[k];
      const c1 = CS[k];
      const d1 = DS[k];
      const tk = TK[k];
      // ---- our command for this step
      let cu = 0;
      let cw = 0;
      if (pol === 3 || pol === 4) {
        cu = 1;
        cw = k < 4 ? (pol === 3 ? 1 : -1) : clamp(-w, -1, 1);
      } else if (pol === 6) {
        cu = 0.55;
        cw = 0.5;
      } else if (pol === 7) {
        cu = 0.55;
        cw = -0.5;
      } else if (pol === 1 || pol === 9) {
        const gdx = Lgx - x;
        const gdy = Lgy - y;
        const dg = sqrt(gdx * gdx + gdy * gdy);
        const hold = dg < 0.5 && pol === 1;
        let e = hold ? atan2(py - y, px - x) - th : atan2(gdy, gdx) - th;
        e -= TAU * round(e / TAU);
        const vd = hold ? 0 : (pol === 9 ? 3.5 : 3.2) * (dg < 2 ? dg / 2 : 1) * (e < 1.3 && e > -1.3 ? 1 : 0.15);
        let t1 = 3 * e - w;
        cw = t1 < -1 ? -1 : t1 > 1 ? 1 : t1;
        t1 = 0.2 * vd + 0.6 * (vd - sp);
        cu = t1 < -1 ? -1 : t1 > 1 ? 1 : t1;
      } else {
        // facing policies: 0 hold, 2 back off, 5 flee, 8 charge
        let e = atan2(py - y, px - x);
        if (pol === 5) e += PI;
        e -= th;
        e -= TAU * round(e / TAU);
        let t1 = 3 * e - w;
        cw = t1 < -1 ? -1 : t1 > 1 ? 1 : t1;
        if (pol === 0) {
          t1 = -0.7 * sp;
          cu = t1 < -1 ? -1 : t1 > 1 ? 1 : t1;
        } else if (pol === 2) cu = e < 0.9 && e > -0.9 ? -0.9 : 0; // only reverse while actually facing it
        else if (pol === 8) cu = e < 1.0 && e > -1.0 ? 1 : 0.2;
        else cu = e < 1.2 && e > -1.2 ? 1 : 0.3;
      }
      if (k === 0) {
        U0[pol] = cu;
        W0[pol] = cw;
      }
      // ---- our update
      const x0 = x;
      const y0 = y;
      const dth = w * c1 + 3 * cw * (h - c1);
      const dist = 5 * cu * (h - d1) + sp * d1;
      const thm = th + 0.5 * dth;
      x += dist * cos(thm);
      y += dist * sin(thm);
      w = w * b1 + 3 * cw * (1 - b1);
      sp = sp * a1 + 5 * cu * (1 - a1);
      th += dth;
      cost += 0.7 * (9 * cu * cu + 3 * cw * cw) * h;

      const he = Lhe0 - Lshr * tk;
      // ---- hazards for us: a catastrophic core (fall) plus a graded margin, so that even when pushed
      // into a margin the planner still prefers the option that leaves it fastest
      const axs = x < 0 ? -x : x;
      const ays = y < 0 ? -y : y;
      const em = he - (axs > ays ? axs : ays); // distance to the nearest edge
      let fall = em < 0.12;
      let pen = em < 0.7 && !fall ? 2600 * (0.7 - em) : 0;
      for (let i = 0; i < Lnz && !fall; i += 3) {
        if (tk + 0.12 >= Lhz[i + 2]) {
          let ax = x - Lhz[i];
          if (ax < 0) ax = -ax;
          let ay = y - Lhz[i + 1];
          if (ay < 0) ay = -ay;
          const dc = ax > ay ? ax : ay;
          if (dc < 0.56) fall = true;
          else if (dc < 1.0) pen += 3400 * (1 - dc);
          else if (dc < 1.5) pen += 8 * (1.5 - dc);
        }
      }
      if (fall) {
        cost += 60000 + 500 * (N - k);
        ended = true;
        break;
      }
      cost += pen;
      // ---- soft hazards for us
      if (em < 1.4) cost += 12 * (1.4 - em) * (1.4 - em);
      // keep room to dodge: stay out of the outer band while a pursuer is around
      if (Lpur && em < 2.6) cost += 7 * (2.6 - em) * (2.6 - em);
      for (let i = 0; i < Lnw; i += 3) {
        const dxw = x - Lwear[i];
        if (dxw < 0.5 && dxw > -0.5) {
          const dyw = y - Lwear[i + 1];
          if (dyw < 0.5 && dyw > -0.5) {
            const q = 0.7 - Lwear[i + 2];
            cost += 30 * q * q;
          }
        }
      }
      for (let i = 0; i < Lnf; i += 4) {
        if (tk >= Lfl[i + 2] && tk <= Lfl[i + 3] && abs(x - Lfl[i]) <= 0.5 && abs(y - Lfl[i + 1]) <= 0.5) {
          cost += 30 * h;
        }
      }
      if (needE && !gotE) {
        for (let i = 0; i < Lnc; i += 3) {
          if (
            Lch[i + 2] <= tk &&
            abs(x - Lch[i]) <= 0.5 &&
            abs(y - Lch[i + 1]) <= 0.5 &&
            !(abs(x0 - Lch[i]) <= 0.5 && abs(y0 - Lch[i + 1]) <= 0.5)
          ) {
            cost -= 0.8 * (300 - myE < 60 ? 300 - myE : 60);
            gotE = true;
            break;
          }
        }
      }
      // ---- pursuer update
      if (Lpur) {
        const rx0 = px - x0; // relative position at the start of this step
        const ry0 = py - y0;
        let pe = atan2(y - py, x - px) - pth;
        pe -= TAU * round(pe / TAU);
        const t2 = 1.5 * pe;
        const pcw = t2 < -1 ? -1 : t2 > 1 ? 1 : t2;
        const pcu = pe < 0.3 && pe > -0.3 ? 0.8 : 0.2;
        const pdth = pw * c1 + 3 * pcw * (h - c1);
        const pdist = 5 * pcu * (h - d1) + psp * d1;
        const pthm = pth + 0.5 * pdth;
        px += pdist * cos(pthm);
        py += pdist * sin(pthm);
        pw = pw * b1 + 3 * pcw * (1 - b1);
        psp = psp * a1 + 5 * pcu * (1 - a1);
        pth += pdth;
        // pursuer falls?
        let pfall = px > he || px < -he || py > he || py < -he;
        for (let i = 0; i < Lnz && !pfall; i += 3) {
          if (tk >= Lhz[i + 2]) {
            const dpx = px - Lhz[i];
            if (dpx <= 0.5 && dpx >= -0.5) {
              const dpy = py - Lhz[i + 1];
              if (dpy <= 0.5 && dpy >= -0.5) pfall = true;
            }
          }
        }
        if (pfall) {
          cost -= 1200 * (1 - 0.08 * k);
          ended = true;
          break;
        }
        // closest approach during this step (linear relative motion); a step moves the pair at most
        // ~2.7 m closer, so nothing can touch if both ends are farther than 2.3 m
        const rx1 = px - x;
        const ry1 = py - y;
        let dm2 = 9;
        let cx = 0;
        let cy = 0;
        if (rx0 * rx0 + ry0 * ry0 < 5.3 || rx1 * rx1 + ry1 * ry1 < 5.3) {
          const ddx = rx1 - rx0;
          const ddy = ry1 - ry0;
          const dd = ddx * ddx + ddy * ddy;
          let tm = dd > 1e-9 ? -(rx0 * ddx + ry0 * ddy) / dd : 1;
          tm = tm < 0 ? 0 : tm > 1 ? 1 : tm;
          cx = rx0 + tm * ddx;
          cy = ry0 + tm * ddy;
          dm2 = cx * cx + cy * cy;
        }
        if (dm2 < 0.7225) {
          const dm = sqrt(dm2) + 1e-6;
          const nx = cx / dm;
          const ny = cy / dm;
          const hx = cos(th);
          const hy = sin(th);
          const qx = cos(pth);
          const qy = sin(pth);
          const vsn = hx * sp * nx + hy * sp * ny;
          const vpn = qx * psp * nx + qy * psp * ny;
          const vc = vsn - vpn > 0 ? vsn - vpn : 0;
          if (!touched) {
            touched = true;
            const aS = abs(wrap(atan2(cy, cx) - th));
            const aP = abs(wrap(atan2(-cy, -cx) - pth));
            const inS = aS < 0.63;
            const inP = aP < 0.63;
            // contact costs energy and time; touching with anything but the wedge also means we cannot
            // resist the shove (and pay the extra leverage cost), so it is penalised more
            cost += 70 + 4 * vc + (inS ? 0 : 150);
            if (inS && !inP) {
              const p = clamp((vc * cos(aS) * lev(aP) - 2.1) / 1, 0, 1);
              cost -= p * (LopFl > 0 ? 3000 : 500);
            } else if (inP && !inS) {
              const p = clamp((vc * cos(aP) * lev(aS) - 2.1) / 1, 0, 1);
              cost += p * (LmyFl > 0 ? 9000 : 2500);
            }
          }
          cost += 8;
          // crude inelastic resolution: separate and share the normal velocity
          const ov = 0.85 - dm;
          if (ov > 0) {
            x -= nx * ov * 0.5;
            y -= ny * ov * 0.5;
            px += nx * ov * 0.5;
            py += ny * ov * 0.5;
          }
          if (vc > 0) {
            const cm = (vsn + vpn) * 0.5;
            sp += (cm - vsn) * (nx * hx + ny * hy);
            psp += (cm - vpn) * (nx * qx + ny * qy);
          }
        }
      } else {
        // passive opponent: it just coasts
        px += psp * d1 * cos(pth);
        py += psp * d1 * sin(pth);
        psp *= a1;
      }
    }
    if (!ended) {
      // terminal guidance and exposure
      const gdx = Lgx - x;
      const gdy = Lgy - y;
      cost += gw * sqrt(gdx * gdx + gdy * gdy);
      // coarse stopping check: braking distance along the heading must stay clear
      if (sp > 1) {
        const db = 0.05 * sp * sp + 0.15;
        if (hardAt(x + db * cos(th), y + db * sin(th), HORIZON + 0.3, Lhe0 - Lshr * HORIZON)) cost += 1200;
      }
      if (Lpur) {
        const rx = px - x;
        const ry = py - y;
        const dN = sqrt(rx * rx + ry * ry) + 1e-6;
        if (dN < 7) {
          const aS = abs(wrap(atan2(ry, rx) - th));
          const aP = abs(wrap(atan2(-ry, -rx) - pth));
          const vcl = (cos(th) * sp - cos(pth) * psp) * (rx / dN) + (sin(th) * sp - sin(pth) * psp) * (ry / dN);
          if (!touched && aP < 0.6 && vcl > 1) {
            // contact is imminent beyond the horizon
            const tc = (dN - 0.85) / vcl;
            if (tc < 1.2) {
              const f = (1.2 - tc) / 1.2;
              cost += (70 + 4 * vcl) * f;
              if (aS > 0.7 && vcl * cos(aP) * lev(aS) > 2.2) cost += (LmyFl > 0 ? 6000 : 2000) * f;
            }
          }
          if (aS < 0.5 && aP > 0.9 && vcl > 2 && dN < 3.5) cost -= 60;
        }
      }
    }
    return cost;
  };

  const shove = pursue && dOpp < 1.25 && abs(wrap(bearO - sh)) < 1.0;
  let best = 0;
  let bestC = 1e18;
  for (let pol = 0; pol < NPOL; pol++) {
    if (pol === 9 && gmode !== 3) continue;
    // far from a live pursuer only GOTO/HOLD are needed; against a frozen one every policy stays available so we can step off a wearing tile
    if (!pursue && !dead && pol !== 1 && pol !== 0) continue;
    let c = roll(pol);
    if (pol === lastPol) c -= 3;
    if (pol === 9) c -= 200;
    // Once touching the pursuer head-on, a steady full-thrust shove with the wedge forward wins the contest
    // (it only pushes at 0.8); dithering between policies while in contact loses it.
    if (pol === 8 && shove) c -= 400;
    if (c < bestC) {
      bestC = c;
      best = pol;
    }
  }

  return {
    actions: { thrust: fin(U0[best]), turn: fin(W0[best]) },
    memory: { p: best },
  };
}
