// ECMAScript leaves Math.sin, cos, atan2 and hypot to the engine, so two
// browsers can disagree in the last bit and a replay diverges after a few
// collisions. These are ports of fdlibm (the code V8 and SpiderMonkey use)
// written with IEEE 754 exact operations only: + - * / sqrt, comparisons and
// the raw words of a double. Every engine computes the same bits.
const view = new DataView(new ArrayBuffer(8));
const highWord = (x) => {
  view.setFloat64(0, x);
  return view.getInt32(0);
};
const fromWords = (high, low) => {
  view.setInt32(0, high);
  view.setUint32(4, low);
  return view.getFloat64(0);
};

const S1 = -1.66666666666666324348e-1,
  S2 = 8.33333333332248946124e-3,
  S3 = -1.98412698298579493134e-4,
  S4 = 2.75573137070700676789e-6,
  S5 = -2.50507602534068634195e-8,
  S6 = 1.58969099521155010221e-10;
// Polynomial on |x| <= pi/4; y is the tail of a reduced argument.
function kernelSin(x, y, iy) {
  const ix = highWord(x) & 0x7fffffff;
  if (ix < 0x3e400000) return x;
  const z = x * x,
    v = z * x,
    r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

const C1 = 4.16666666666666019037e-2,
  C2 = -1.38888888888741095749e-3,
  C3 = 2.48015872894767294178e-5,
  C4 = -2.75573143513906633035e-7,
  C5 = 2.0875723212981748279e-9,
  C6 = -1.13596475577881948265e-11;
function kernelCos(x, y) {
  const ix = highWord(x) & 0x7fffffff;
  if (ix < 0x3e400000) return 1;
  const z = x * x,
    r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));
  const qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0);
  const hz = 0.5 * z - qx,
    a = 1 - qx;
  return a - (hz - (z * r - x * y));
}

const INV_PIO2 = 6.36619772367581382433e-1,
  PIO2_1 = 1.57079632673412561417,
  PIO2_1T = 6.07710050650619224932e-11,
  PIO2_2 = 6.0771005063039659766e-11,
  PIO2_2T = 2.02226624879595063154e-21,
  PIO2_3 = 2.0222662487111664558e-21,
  PIO2_3T = 8.47842766036889956997e-32;
// High words of n * pi/2 for n = 1..32: the only multiples where the first
// reduction round can cancel enough to need a second one.
const NPIO2_HW = [
  0x3ff921fb, 0x400921fb, 0x4012d97c, 0x401921fb, 0x401f6a7a, 0x4022d97c,
  0x4025fdbb, 0x402921fb, 0x402c463a, 0x402f6a7a, 0x4031475c, 0x4032d97c,
  0x40346b9c, 0x4035fdbb, 0x40378fdb, 0x403921fb, 0x403ab41b, 0x403c463a,
  0x403dd85a, 0x403f6a7a, 0x40407e4c, 0x4041475c, 0x4042106c, 0x4042d97c,
  0x4043a28c, 0x40446b9c, 0x404534ac, 0x4045fdbb, 0x4046c6cb, 0x40478fdb,
  0x404858eb, 0x404921fb,
];
const reduced = [0, 0];
// Writes x - n * pi/2 into `reduced` as a head and a tail, returns n.
function remPio2(x) {
  let hx = highWord(x),
    ix = hx & 0x7fffffff;
  if (ix > 0x413921fb) {
    // Beyond 2^19 * pi/2 fdlibm switches to Payne-Hanek. The arena never gets
    // there, so a coarse but deterministic reduction is enough.
    x = x % (2 * Math.PI);
    hx = highWord(x);
    ix = hx & 0x7fffffff;
  }
  if (ix <= 0x3fe921fb) {
    reduced[0] = x;
    reduced[1] = 0;
    return 0;
  }
  if (ix < 0x4002d97c) {
    // |x| < 3pi/4: n is +-1 and a two or three part pi/2 keeps the tail exact.
    let z;
    if (hx > 0) {
      z = x - PIO2_1;
      if (ix !== 0x3ff921fb) {
        reduced[0] = z - PIO2_1T;
        reduced[1] = z - reduced[0] - PIO2_1T;
      } else {
        z -= PIO2_2;
        reduced[0] = z - PIO2_2T;
        reduced[1] = z - reduced[0] - PIO2_2T;
      }
      return 1;
    }
    z = x + PIO2_1;
    if (ix !== 0x3ff921fb) {
      reduced[0] = z + PIO2_1T;
      reduced[1] = z - reduced[0] + PIO2_1T;
    } else {
      z += PIO2_2;
      reduced[0] = z + PIO2_2T;
      reduced[1] = z - reduced[0] + PIO2_2T;
    }
    return -1;
  }
  let t = Math.abs(x);
  const n = Math.floor(t * INV_PIO2 + 0.5),
    fn = n;
  let r = t - fn * PIO2_1,
    w = fn * PIO2_1T,
    y0 = r - w;
  if (!(n < 32 && ix !== NPIO2_HW[n - 1])) {
    const j = ix >> 20;
    let i = j - ((highWord(y0) >> 20) & 0x7ff);
    if (i > 16) {
      t = r;
      w = fn * PIO2_2;
      r = t - w;
      w = fn * PIO2_2T - (t - r - w);
      y0 = r - w;
      i = j - ((highWord(y0) >> 20) & 0x7ff);
      if (i > 49) {
        t = r;
        w = fn * PIO2_3;
        r = t - w;
        w = fn * PIO2_3T - (t - r - w);
        y0 = r - w;
      }
    }
  }
  const y1 = r - y0 - w;
  if (hx < 0) {
    reduced[0] = -y0;
    reduced[1] = -y1;
    return -n;
  }
  reduced[0] = y0;
  reduced[1] = y1;
  return n;
}

export function sin(x) {
  const ix = highWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelSin(x, 0, 0);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  switch (n & 3) {
    case 0:
      return kernelSin(reduced[0], reduced[1], 1);
    case 1:
      return kernelCos(reduced[0], reduced[1]);
    case 2:
      return -kernelSin(reduced[0], reduced[1], 1);
    default:
      return -kernelCos(reduced[0], reduced[1]);
  }
}

export function cos(x) {
  const ix = highWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelCos(x, 0);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  switch (n & 3) {
    case 0:
      return kernelCos(reduced[0], reduced[1]);
    case 1:
      return -kernelSin(reduced[0], reduced[1], 1);
    case 2:
      return -kernelCos(reduced[0], reduced[1]);
    default:
      return kernelSin(reduced[0], reduced[1], 1);
  }
}

const ATAN_HI = [
  4.63647609000806093515e-1,
  7.85398163397448278999e-1,
  9.82793723247329054082e-1,
  1.570796326794896558,
];
const ATAN_LO = [
  2.26987774529616870924e-17,
  3.06161699786838301793e-17,
  1.39033110312309984516e-17,
  6.12323399573676603587e-17,
];
const AT = [
  3.33333333333329318027e-1,
  -1.99999999998764832476e-1,
  1.42857142725034663711e-1,
  -1.1111110405462355788e-1,
  9.09088713343650656196e-2,
  -7.69187620504482999495e-2,
  6.66107313738753120669e-2,
  -5.83357013379057348645e-2,
  4.97687799461593236017e-2,
  -3.6531572744216915527e-2,
  1.62858201153657823623e-2,
];
export function atan(x) {
  if (x !== x) return x;
  const hx = highWord(x),
    ix = hx & 0x7fffffff;
  if (ix >= 0x44100000)
    return hx > 0 ? ATAN_HI[3] + ATAN_LO[3] : -ATAN_HI[3] - ATAN_LO[3];
  let id;
  if (ix < 0x3fdc0000) {
    if (ix < 0x3e400000) return x;
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) {
        id = 0;
        x = (2 * x - 1) / (2 + x);
      } else {
        id = 1;
        x = (x - 1) / (x + 1);
      }
    } else if (ix < 0x40038000) {
      id = 2;
      x = (x - 1.5) / (1 + 1.5 * x);
    } else {
      id = 3;
      x = -1 / x;
    }
  }
  const z = x * x,
    w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const r = ATAN_HI[id] - (x * (s1 + s2) - ATAN_LO[id] - x);
  return hx < 0 ? -r : r;
}

const PI = 3.141592653589793116,
  PI_O_2 = 1.570796326794896558,
  PI_O_4 = 7.85398163397448279e-1,
  PI_LO = 1.2246467991473531772e-16;
export function atan2(y, x) {
  if (x !== x || y !== y) return x + y;
  const hx = highWord(x),
    ix = hx & 0x7fffffff;
  const hy = highWord(y),
    iy = hy & 0x7fffffff;
  if (x === 1) return atan(y);
  let m = ((hy >> 31) & 1) | ((hx >> 30) & 2);
  if (y === 0) {
    switch (m) {
      case 0:
      case 1:
        return y;
      case 2:
        return PI;
      default:
        return -PI;
    }
  }
  if (x === 0) return hy < 0 ? -PI_O_2 : PI_O_2;
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) {
      switch (m) {
        case 0:
          return PI_O_4;
        case 1:
          return -PI_O_4;
        case 2:
          return 3 * PI_O_4;
        default:
          return -3 * PI_O_4;
      }
    }
    switch (m) {
      case 0:
        return 0;
      case 1:
        return -0;
      case 2:
        return PI;
      default:
        return -PI;
    }
  }
  if (iy === 0x7ff00000) return hy < 0 ? -PI_O_2 : PI_O_2;
  const k = (iy - ix) >> 20;
  let z;
  if (k > 60) {
    z = PI_O_2 + 0.5 * PI_LO;
    m &= 1;
  } else if (hx < 0 && k < -60) z = 0;
  else z = atan(Math.abs(y / x));
  switch (m) {
    case 0:
      return z;
    case 1:
      return -z;
    case 2:
      return PI - (z - PI_LO);
    default:
      return z - PI_LO - PI;
  }
}

// Math.hypot scales its inputs before the square root; arena distances stay
// far from overflow, so the plain form is exact enough and identical everywhere.
export const hypot = (x, y) => Math.sqrt(x * x + y * y);
