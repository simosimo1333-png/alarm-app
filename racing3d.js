// カートレース用の軽量WebGLレンダラー（依存ライブラリなし）
// ゲームロジック側(racing.js)から毎フレーム呼ばれ、3Dで世界を描く。
// 空はracing.js側の2Dキャンバス(背面レイヤー)が描くため、ここは透過クリア。
(() => {
  'use strict';

  // ===== 最小限の行列ユーティリティ（列優先） =====
  function mat4Mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] =
          a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
          a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }

  function perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ]);
  }

  function viewMatrix(eye, fwd, upHint) {
    // 正規化済みのfwdを想定
    let rx = fwd[1] * upHint[2] - fwd[2] * upHint[1];
    let ry = fwd[2] * upHint[0] - fwd[0] * upHint[2];
    let rz = fwd[0] * upHint[1] - fwd[1] * upHint[0];
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    const ux = ry * fwd[2] - rz * fwd[1];
    const uy = rz * fwd[0] - rx * fwd[2];
    const uz = rx * fwd[1] - ry * fwd[0];
    return new Float32Array([
      rx, ux, -fwd[0], 0,
      ry, uy, -fwd[1], 0,
      rz, uz, -fwd[2], 0,
      -(rx * eye[0] + ry * eye[1] + rz * eye[2]),
      -(ux * eye[0] + uy * eye[1] + uz * eye[2]),
      (fwd[0] * eye[0] + fwd[1] * eye[1] + fwd[2] * eye[2]),
      1,
    ]);
  }

  // 基底ベクトルからモデル行列を作る
  function basisMatrix(right, up, fwd, pos) {
    return new Float32Array([
      right[0], right[1], right[2], 0,
      up[0], up[1], up[2], 0,
      fwd[0], fwd[1], fwd[2], 0,
      pos[0], pos[1], pos[2], 1,
    ]);
  }

  function hexToRgb(hex) {
    return [
      parseInt(hex.slice(1, 3), 16) / 255,
      parseInt(hex.slice(3, 5), 16) / 255,
      parseInt(hex.slice(5, 7), 16) / 255,
    ];
  }

  function shadeRgb(rgb, amt) {
    return rgb.map((v) => Math.max(0, Math.min(1, v + amt)));
  }

  // ===== シェーダ =====
  const VS = `
attribute vec3 aPos;
attribute vec3 aNorm;
attribute vec2 aUV;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
varying vec3 vNorm;
varying vec2 vUV;
varying vec3 vWorld;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNorm = mat3(uModel) * aNorm;
  vUV = aUV;
  gl_Position = uProj * uView * w;
}`;

  const FS = `
precision mediump float;
uniform sampler2D uTex;
uniform float uUseTex;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uLit;
uniform vec3 uLightDir;
uniform vec3 uLightCol;
uniform float uAmbient;
uniform vec3 uFogCol;
uniform vec2 uFogRange;
uniform vec3 uCamPos;
varying vec3 vNorm;
varying vec2 vUV;
varying vec3 vWorld;
void main() {
  vec4 base = vec4(uColor, 1.0);
  if (uUseTex > 0.5) base *= texture2D(uTex, vUV);
  if (base.a < 0.06) discard;
  vec3 n = normalize(vNorm);
  float diff = max(dot(n, -uLightDir), 0.0);
  vec3 litCol = uLightCol * (uAmbient + diff * (1.05 - uAmbient));
  vec3 rgb = base.rgb * mix(vec3(1.0), litCol, uLit);
  float d = distance(vWorld, uCamPos);
  float f = clamp((d - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
  gl_FragColor = vec4(mix(rgb, uFogCol, f), base.a * uAlpha);
}`;

  // ===== ジオメトリ生成（interleaved: pos3 norm3 uv2） =====
  function buildCube(withUV) {
    // 各面: 法線つき。withUVなら0..1のUV
    const faces = [
      { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
      { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
      { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
      { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
      { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
      { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    ];
    const verts = [], idx = [];
    let vi = 0;
    for (const f of faces) {
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = [
          f.n[0] * 0.5 + f.u[0] * su * 0.5 + f.v[0] * sv * 0.5,
          f.n[1] * 0.5 + f.u[1] * su * 0.5 + f.v[1] * sv * 0.5,
          f.n[2] * 0.5 + f.u[2] * su * 0.5 + f.v[2] * sv * 0.5,
        ];
        verts.push(p[0], p[1], p[2], f.n[0], f.n[1], f.n[2],
          withUV ? (su + 1) / 2 : 0, withUV ? (sv + 1) / 2 : 0);
      }
      idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      vi += 4;
    }
    return { verts, idx };
  }

  function buildCylinderX(seg) {
    // X軸方向の円柱（タイヤ用）。半径1、x=-0.5..0.5
    const verts = [], idx = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const cy = Math.cos(a), cz = Math.sin(a);
      verts.push(-0.5, cy, cz, 0, cy, cz, 0, 0);
      verts.push(0.5, cy, cz, 0, cy, cz, 0, 0);
    }
    for (let i = 0; i < seg; i++) {
      const b = i * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    // 両端のフタ
    const c0 = verts.length / 8;
    verts.push(-0.5, 0, 0, -1, 0, 0, 0, 0);
    verts.push(0.5, 0, 0, 1, 0, 0, 0, 0);
    for (let i = 0; i < seg; i++) {
      idx.push(c0, i * 2, ((i + 1) % (seg + 1)) * 2);
      idx.push(c0 + 1, ((i + 1) % (seg + 1)) * 2 + 1, i * 2 + 1);
    }
    return { verts, idx };
  }

  function buildSphere(lat, lon) {
    const verts = [], idx = [];
    for (let i = 0; i <= lat; i++) {
      const th = (i / lat) * Math.PI;
      for (let j = 0; j <= lon; j++) {
        const ph = (j / lon) * Math.PI * 2;
        const x = Math.sin(th) * Math.cos(ph);
        const y = Math.cos(th);
        const z = Math.sin(th) * Math.sin(ph);
        verts.push(x, y, z, x, y, z, 0, 0);
      }
    }
    for (let i = 0; i < lat; i++) {
      for (let j = 0; j < lon; j++) {
        const a = i * (lon + 1) + j;
        const b = a + lon + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    return { verts, idx };
  }

  function buildQuadBottomPivot() {
    // ビルボード用: 底辺中央が原点、上方向に高さ1、幅1
    return {
      verts: [
        -0.5, 0, 0, 0, 0, 1, 0, 1,
        0.5, 0, 0, 0, 0, 1, 1, 1,
        0.5, 1, 0, 0, 0, 1, 1, 0,
        -0.5, 1, 0, 0, 0, 1, 0, 0,
      ],
      idx: [0, 1, 2, 0, 2, 3],
    };
  }

  function buildTerrainGrid(size, segs, hAt) {
    // 起伏のあるヘイトフィールド地形（法線つきでライティングが乗る）
    const verts = [], idx = [];
    const e = size / segs;
    for (let j = 0; j <= segs; j++) {
      for (let i = 0; i <= segs; i++) {
        const x = (i / segs) * size;
        const z = (j / segs) * size;
        const y = hAt(x, z);
        const nx = hAt(x - e, z) - hAt(x + e, z);
        const nz = hAt(x, z - e) - hAt(x, z + e);
        const ny = 2 * e;
        const l = Math.hypot(nx, ny, nz) || 1;
        verts.push(x, y, z, nx / l, ny / l, nz / l, i / segs, j / segs);
      }
    }
    for (let j = 0; j < segs; j++) {
      for (let i = 0; i < segs; i++) {
        const a = j * (segs + 1) + i;
        const b = a + segs + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    return { verts, idx };
  }

  function buildGroundQuad(size, uvRep) {
    // XZ平面 (0..size)、上向き
    return {
      verts: [
        0, 0, 0, 0, 1, 0, 0, 0,
        size, 0, 0, 0, 1, 0, uvRep, 0,
        size, 0, size, 0, 1, 0, uvRep, uvRep,
        0, 0, size, 0, 1, 0, 0, uvRep,
      ],
      idx: [0, 1, 2, 0, 2, 3],
    };
  }

  // ===== 本体 =====
  window.KartGL = {
    create(canvas, opts) {
      const gl = canvas.getContext('webgl', { alpha: true, antialias: true })
        || canvas.getContext('experimental-webgl', { alpha: true, antialias: true });
      if (!gl) return null;

      const W = canvas.width, H = canvas.height;
      const TEX = opts.worldSize;          // ワールドの一辺
      const HOR_FRAC = opts.horizonFrac;   // 画面上の地平線位置(0..1)
      const FOVY = 52 * Math.PI / 180;

      // --- プログラム ---
      function compile(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          throw new Error(gl.getShaderInfoLog(s));
        }
        return s;
      }
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
      gl.useProgram(prog);

      const U = {};
      for (const n of ['uProj', 'uView', 'uModel', 'uTex', 'uUseTex', 'uColor', 'uAlpha',
        'uLit', 'uLightDir', 'uLightCol', 'uAmbient', 'uFogCol', 'uFogRange', 'uCamPos']) {
        U[n] = gl.getUniformLocation(prog, n);
      }
      const A = {
        pos: gl.getAttribLocation(prog, 'aPos'),
        norm: gl.getAttribLocation(prog, 'aNorm'),
        uv: gl.getAttribLocation(prog, 'aUV'),
      };

      // --- メッシュ登録 ---
      function makeMesh(g) {
        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.verts), gl.STATIC_DRAW);
        const ibo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(g.idx), gl.STATIC_DRAW);
        return { vbo, ibo, n: g.idx.length };
      }
      const MESH = {
        cube: makeMesh(buildCube(false)),
        cubeUV: makeMesh(buildCube(true)),
        wheel: makeMesh(buildCylinderX(12)),
        sphere: makeMesh(buildSphere(7, 10)),
        bill: makeMesh(buildQuadBottomPivot()),
        ground: makeMesh(buildGroundQuad(TEX, 1)),
        surround: makeMesh(buildGroundQuad(40000, 290)),
      };

      function bindMesh(m) {
        gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
        gl.vertexAttribPointer(A.pos, 3, gl.FLOAT, false, 32, 0);
        gl.vertexAttribPointer(A.norm, 3, gl.FLOAT, false, 32, 12);
        gl.vertexAttribPointer(A.uv, 2, gl.FLOAT, false, 32, 24);
      }
      gl.enableVertexAttribArray(A.pos);
      gl.enableVertexAttribArray(A.norm);
      gl.enableVertexAttribArray(A.uv);

      // --- テクスチャ ---
      const texCache = new Map(); // canvas → WebGLTexture
      function canvasTex(cv) {
        let t = texCache.get(cv);
        if (t) return t;
        t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        texCache.set(cv, t);
        return t;
      }

      // コーステクスチャ（POTに詰め直してミップマップ）
      const stage = document.createElement('canvas');
      stage.width = stage.height = 2048;
      const stageCtx = stage.getContext('2d');
      let trackTex = gl.createTexture();
      let grassTex = gl.createTexture();
      let hAt = () => 0;            // 地形の高さ
      let terrainMesh = null;       // 起伏つき地面
      let light = { dir: [-0.45, -0.8, 0.35], color: [1, 1, 0.96], amb: 0.6 };
      let fogCol = [0.8, 0.9, 0.95];
      const FOG_RANGE = [650, 2100];

      function uploadPOT(tex, cv, repeat) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      }

      function setCourse(c) {
        // 地形（起伏メッシュ）を作り直す
        hAt = c.heightAt || (() => 0);
        if (terrainMesh) {
          gl.deleteBuffer(terrainMesh.vbo);
          gl.deleteBuffer(terrainMesh.ibo);
        }
        terrainMesh = makeMesh(buildTerrainGrid(TEX, 88, hAt));
        // 路面
        const norm = Math.sqrt(c.light.dir[0] ** 2 + c.light.dir[1] ** 2 + c.light.dir[2] ** 2);
        light = {
          dir: c.light.dir.map((v) => v / norm),
          color: c.light.color,
          amb: c.light.amb,
        };
        fogCol = c.fog.split(',').map((v) => parseInt(v, 10) / 255);
        stageCtx.drawImage(c.trackCanvas, 0, 0, 2048, 2048);
        uploadPOT(trackTex, stage, false);
        // 周囲の草地（市松タイル）
        const g = document.createElement('canvas');
        g.width = g.height = 128;
        const gg = g.getContext('2d');
        gg.fillStyle = c.grassA;
        gg.fillRect(0, 0, 128, 128);
        gg.fillStyle = c.grassB;
        gg.fillRect(0, 0, 64, 64);
        gg.fillRect(64, 64, 64, 64);
        uploadPOT(grassTex, g, true);
      }

      // 影・炎・シールド用の小さなスプライト
      function radialSprite(inner, outer, stops) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 64;
        const c2 = cv.getContext('2d');
        const rg = c2.createRadialGradient(32, 32, inner, 32, 32, outer);
        for (const [p, col] of stops) rg.addColorStop(p, col);
        c2.fillStyle = rg;
        c2.fillRect(0, 0, 64, 64);
        return cv;
      }
      const shadowCv = radialSprite(4, 30, [[0, 'rgba(0,0,0,0.42)'], [0.7, 'rgba(0,0,0,0.2)'], [1, 'rgba(0,0,0,0)']]);
      const flameCv = radialSprite(2, 30, [[0, 'rgba(255,240,160,0.95)'], [0.4, 'rgba(255,150,30,0.85)'], [1, 'rgba(255,80,0,0)']]);
      const canopyCv = (() => {
        // パラグライダーの傘（虹色のアーチ）
        const cv = document.createElement('canvas');
        cv.width = 96;
        cv.height = 40;
        const c2 = cv.getContext('2d');
        const cols = ['#ef5350', '#ffa726', '#ffee58', '#66bb6a', '#42a5f5'];
        for (let i = 0; i < 5; i++) {
          c2.fillStyle = cols[i];
          c2.beginPath();
          c2.moveTo(48, 36);
          c2.arc(48, 38, 44, Math.PI + (i / 5) * Math.PI, Math.PI + ((i + 1) / 5) * Math.PI);
          c2.closePath();
          c2.fill();
        }
        c2.strokeStyle = 'rgba(60,60,70,0.8)';
        c2.lineWidth = 1.5;
        c2.beginPath();
        c2.moveTo(10, 16); c2.lineTo(48, 40);
        c2.moveTo(86, 16); c2.lineTo(48, 40);
        c2.stroke();
        return cv;
      })();

      const ringCv = (() => {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 64;
        const c2 = cv.getContext('2d');
        c2.strokeStyle = 'rgba(80,220,255,0.9)';
        c2.lineWidth = 5;
        c2.beginPath();
        c2.arc(32, 32, 26, 0, Math.PI * 2);
        c2.stroke();
        c2.fillStyle = 'rgba(80,220,255,0.14)';
        c2.fill();
        return cv;
      })();

      // --- カートモデル（パーツ＝メッシュ+ローカル変換+色） ---
      const kartCache = new Map();
      function kartModel(body, helmet) {
        const key = body + helmet;
        let m = kartCache.get(key);
        if (m) return m;
        const B = hexToRgb(body), Hm = hexToRgb(helmet);
        const D = [0.09, 0.09, 0.11];       // タイヤ
        const RIM = [0.62, 0.66, 0.72];     // ホイールのハブ
        const SUIT = shadeRgb(Hm, -0.16);   // ドライバーのスーツ
        // [mesh, sx,sy,sz, px,py,pz, color]（前方 = +z）
        m = [
          // 下部シャシー（低く広く）
          [MESH.cube, 29, 4.5, 44, 0, 5.5, 0, shadeRgb(B, -0.2)],
          // メインボディ
          [MESH.cube, 24, 6.5, 30, 0, 9.5, -1, B],
          // ボンネット
          [MESH.cube, 18, 5, 17, 0, 9.8, 15, shadeRgb(B, 0.12)],
          // ノーズ先端
          [MESH.cube, 12, 3.6, 9, 0, 8.6, 23, shadeRgb(B, 0.2)],
          // サイドポンツーン
          [MESH.cube, 4.6, 6.5, 24, -12.8, 8.6, 1, shadeRgb(B, -0.12)],
          [MESH.cube, 4.6, 6.5, 24, 12.8, 8.6, 1, shadeRgb(B, -0.12)],
          // 上面のメタリック・ハイライト帯
          [MESH.cube, 15, 1.3, 27, 0, 13, 0, shadeRgb(B, 0.32)],
          // コックピット縁
          [MESH.cube, 15, 4.5, 15, 0, 12.6, -7, [0.12, 0.12, 0.15]],
          // ドライバー胴
          [MESH.cube, 9, 8, 9, 0, 15.5, -6, SUIT],
          // ヘルメット
          [MESH.sphere, 6.6, 6.6, 6.6, 0, 20.5, -4, Hm],
          // バイザー
          [MESH.cube, 7.6, 3, 2.4, 0, 20, 1.4, [0.07, 0.1, 0.16]],
          // リアウィング
          [MESH.cube, 27, 1.9, 9, 0, 20.5, -20, shadeRgb(B, -0.26)],
          [MESH.cube, 2.4, 6.5, 2.4, -8.5, 15.5, -20, shadeRgb(B, -0.32)],
          [MESH.cube, 2.4, 6.5, 2.4, 8.5, 15.5, -20, shadeRgb(B, -0.32)],
          // ヘッドライト
          [MESH.cube, 3, 2, 1.6, -5, 9.6, 24, [1, 0.97, 0.82]],
          [MESH.cube, 3, 2, 1.6, 5, 9.6, 24, [1, 0.97, 0.82]],
          // タイヤ4輪
          [MESH.wheel, 5.4, 6.6, 6.6, -14.8, 6.6, 13, D],
          [MESH.wheel, 5.4, 6.6, 6.6, 14.8, 6.6, 13, D],
          [MESH.wheel, 5.6, 7.4, 7.4, -15.2, 7.4, -13, D],
          [MESH.wheel, 5.6, 7.4, 7.4, 15.2, 7.4, -13, D],
          // ハブキャップ（外側の面に明るい円）
          [MESH.wheel, 1.3, 3.7, 3.7, -17.6, 6.6, 13, RIM],
          [MESH.wheel, 1.3, 3.7, 3.7, 17.6, 6.6, 13, RIM],
          [MESH.wheel, 1.3, 4.3, 4.3, -18.1, 7.4, -13, RIM],
          [MESH.wheel, 1.3, 4.3, 4.3, 18.1, 7.4, -13, RIM],
        ];
        kartCache.set(key, m);
        return m;
      }

      // --- 描画ヘルパ ---
      let proj = perspective(FOVY, W / H, 6, 4200);
      let view = null;
      let camPos = [0, 0, 0];

      function setCommon() {
        gl.uniformMatrix4fv(U.uProj, false, proj);
        gl.uniformMatrix4fv(U.uView, false, view);
        gl.uniform3fv(U.uLightDir, light.dir);
        gl.uniform3fv(U.uLightCol, light.color);
        gl.uniform1f(U.uAmbient, light.amb);
        gl.uniform3fv(U.uFogCol, fogCol);
        gl.uniform2fv(U.uFogRange, FOG_RANGE);
        gl.uniform3fv(U.uCamPos, camPos);
        gl.uniform1i(U.uTex, 0);
      }

      function draw(mesh, model, color, o) {
        o = o || {};
        bindMesh(mesh);
        gl.uniformMatrix4fv(U.uModel, false, model);
        gl.uniform3fv(U.uColor, color || [1, 1, 1]);
        gl.uniform1f(U.uAlpha, o.alpha !== undefined ? o.alpha : 1);
        gl.uniform1f(U.uLit, o.lit !== undefined ? o.lit : 1);
        if (o.tex) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, o.tex);
          gl.uniform1f(U.uUseTex, 1);
        } else {
          gl.uniform1f(U.uUseTex, 0);
        }
        gl.drawElements(gl.TRIANGLES, mesh.n, gl.UNSIGNED_SHORT, 0);
      }

      function scaleAt(sx, sy, sz, px, py, pz) {
        return new Float32Array([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, px, py, pz, 1]);
      }

      // ヨー回転（+前後傾roll）つきのパーツ用モデル行列
      function partMatrix(a, roll, base, part) {
        // part: [mesh,sx,sy,sz,px,py,pz,color]
        const [, sx, sy, sz, px, py, pz] = part;
        const fX = Math.cos(a), fZ = Math.sin(a); // 前方（ワールド）
        const rX = -fZ, rZ = fX;                   // 右
        const uX = rX * roll, uZ = rZ * roll;      // rollで傾いたup（小角近似）
        const wx = base[0] + px * rX + py * uX + pz * fX;
        const wy = base[1] + py - px * roll;
        const wz = base[2] + px * rZ + py * uZ + pz * fZ;
        return new Float32Array([
          sx * rX, -sx * roll, sx * rZ, 0,
          sy * uX, sy, sy * uZ, 0,
          sz * fX, 0, sz * fZ, 0,
          wx, wy, wz, 1,
        ]);
      }

      function billboard(x, y, z, w, h) {
        let fx = camPos[0] - x, fz = camPos[2] - z;
        const l = Math.hypot(fx, fz) || 1;
        fx /= l; fz /= l;
        // 右ベクトルは「カメラから見て右」= viewDir(-f) × up
        return new Float32Array([
          fz * w, 0, -fx * w, 0,
          0, h, 0, 0,
          fx, 0, fz, 0,
          x, y, z, 1,
        ]);
      }

      // --- メインレンダリング ---
      function render(f) {
        gl.viewport(0, 0, W, H);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.CULL_FACE);

        // カメラ: プレイヤーの後ろ上方。坂で地平線が合うようにピッチを調整
        const dx = Math.cos(f.heading), dz = Math.sin(f.heading);
        const ex = f.x - dx * 118, ez = f.z - dz * 118;
        const eye = [ex, Math.max(hAt(ex, ez), hAt(f.x, f.z)) + 58, ez];
        const basePitch = Math.atan((0.5 - HOR_FRAC) * 2 * Math.tan(FOVY / 2));
        const pitch = basePitch + (f.horShift / H) * FOVY;
        const cp = Math.cos(pitch), sp = Math.sin(pitch);
        const fwd = [dx * cp, -sp, dz * cp];
        camPos = eye;
        view = viewMatrix(eye, fwd, [0, 1, 0]);
        setCommon();

        // 地面
        gl.disable(gl.BLEND);
        // 地形を先に描き、周囲の草地は深度テストで隠れた分の塗りを省く
        draw(terrainMesh || MESH.ground, scaleAt(1, 1, 1, 0, 0, 0), [1, 1, 1], { tex: trackTex });
        draw(MESH.surround, scaleAt(1, 1, 1, -20000 + TEX / 2, -0.6, -20000 + TEX / 2), [1, 1, 1], { tex: grassTex });
        gl.enable(gl.BLEND);

        // 影（地面の上、デプス書き込みなし）
        gl.depthMask(false);
        const flatQuad = (x, z, s, alpha) => {
          draw(MESH.bill, new Float32Array([
            s, 0, 0, 0,
            0, 0, s, 0,
            0, 1, 0, 0,
            x, hAt(x, z) + 1.2, z - s / 2, 1,
          ]), [1, 1, 1], { tex: canvasTex(shadowCv), lit: 0, alpha });
        };
        for (const k of f.karts) {
          const s = Math.max(0.55, 1 - k.lift / 90);
          flatQuad(k.x, k.z, 38 * s, s);
        }
        for (const b of f.bananas) flatQuad(b.x, b.z, 20, 0.7);
        gl.depthMask(true);

        // カート（不透明）
        for (const k of f.karts) {
          const model = kartModel(k.body, k.helmet);
          const base = [k.x, hAt(k.x, k.z) + k.lift, k.z];
          for (const part of model) {
            draw(part[0], partMatrix(k.a, k.roll || 0, base, part), part[7]);
          }
        }

        // 半透明（奥から手前へ）
        const trans = [];
        const dist2 = (x, z) => (x - camPos[0]) ** 2 + (z - camPos[2]) ** 2;
        const FOG_FAR2 = FOG_RANGE[1] * FOG_RANGE[1];
        for (const d of f.decos) {
          const dd = dist2(d.x, d.z);
          if (dd > FOG_FAR2) continue; // フォグで見えない距離は描かない
          trans.push({ d: dd, fn: () => {
            draw(MESH.bill, billboard(d.x, d.y0 || 0, d.z, d.w, d.h), [1, 1, 1], { tex: canvasTex(d.canvas), lit: 0 });
          } });
        }
        const t = f.time;
        for (const b of f.boxes) {
          const near = Math.sqrt(dist2(b.x, b.z));
          const alpha = Math.max(0, Math.min(0.62, (near - 80) / 120));
          if (alpha <= 0.01) continue;
          const hue = (t * 80) % 360;
          const rgb = hslToRgb(hue / 360, 0.75, 0.6);
          trans.push({ d: dist2(b.x, b.z), fn: () => {
            const ang = t * 1.4 + b.x;
            const ca = Math.cos(ang), sa = Math.sin(ang);
            const s = 16;
            const bob = Math.sin(t * 2.5 + b.z) * 2.5;
            // 回転キューブ
            draw(MESH.cubeUV, new Float32Array([
              s * ca, 0, s * -sa, 0,
              0, s, 0, 0,
              s * sa, 0, s * ca, 0,
              b.x, (b.y0 || 0) + 15 + bob, b.z, 1,
            ]), rgb, { tex: canvasTex(f.sprites.star), alpha, lit: 0 });
          } });
        }
        for (const bn of f.bananas) {
          trans.push({ d: dist2(bn.x, bn.z), fn: () => {
            draw(MESH.bill, billboard(bn.x, hAt(bn.x, bn.z) + 0.5, bn.z, 17, 17), [1, 1, 1], { tex: canvasTex(f.sprites.banana), lit: 0 });
          } });
        }
        for (const s of f.shots) {
          trans.push({ d: dist2(s.x, s.z), fn: () => {
            draw(MESH.bill, billboard(s.x, hAt(s.x, s.z) + 4, s.z, 15, 15), [1, 1, 1], { tex: canvasTex(f.sprites.snowball), lit: 0 });
          } });
        }
        for (const k of f.karts) {
          const ky = hAt(k.x, k.z) + k.lift;
          if (k.boost > 0) {
            const bx = k.x - Math.cos(k.a) * 24, bz = k.z - Math.sin(k.a) * 24;
            trans.push({ d: dist2(bx, bz), fn: () => {
              const fs = 14 + Math.random() * 6;
              draw(MESH.bill, billboard(bx, ky + 2, bz, fs, fs), [1, 1, 1], { tex: canvasTex(flameCv), lit: 0, alpha: 0.9 });
            } });
          }
          if (k.glide) {
            // 滑空中はパラグライダーの傘を頭上に
            trans.push({ d: dist2(k.x, k.z), fn: () => {
              draw(MESH.bill, billboard(k.x, ky + 26, k.z, 52, 20), [1, 1, 1], { tex: canvasTex(canopyCv), lit: 0 });
            } });
          }
          if (k.shield > 0) {
            const a = k.shield < 1.5 ? 0.4 + 0.3 * Math.sin(t * 14) : 0.75;
            trans.push({ d: dist2(k.x, k.z), fn: () => {
              draw(MESH.bill, billboard(k.x, ky - 2, k.z, 52, 52), [1, 1, 1], { tex: canvasTex(ringCv), lit: 0, alpha: Math.max(0.15, a) });
            } });
          }
          if (k.label) {
            trans.push({ d: dist2(k.x, k.z), fn: () => {
              const lw = 13 * (k.label.width / k.label.height);
              draw(MESH.bill, billboard(k.x, ky + 28, k.z, lw, 13), [1, 1, 1], { tex: canvasTex(k.label), lit: 0 });
            } });
          }
          if (k.icon) {
            trans.push({ d: dist2(k.x, k.z), fn: () => {
              const bob = Math.sin(t * 11) * 2;
              draw(MESH.bill, billboard(k.x, ky + 40 + bob, k.z, 16, 16), [1, 1, 1], { tex: canvasTex(k.icon), lit: 0 });
            } });
          }
        }
        trans.sort((a, b) => b.d - a.d);
        gl.depthMask(false);
        for (const tr of trans) tr.fn();
        gl.depthMask(true);
      }

      function hslToRgb(h, s, l) {
        const f = (n) => {
          const k = (n + h * 12) % 12;
          return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        };
        return [f(0), f(8), f(4)];
      }

      return { setCourse, render };
    },
  };
})();
