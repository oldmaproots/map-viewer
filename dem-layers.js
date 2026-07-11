// ============================================================
// 数値標高タイル(DEM)を読み取り、手元(ブラウザ内)で地形を描く部品。
//
// 仕組み: 地理院やQ地図は「標高値を画像の色(RGB)に埋め込んだタイル」を
// 配信している。 標高 = (R×65536 + G×256 + B) × 0.01 メートル。
// この画像は目で見るためのものではなく、数値データの入れ物。
// これをcanvasで読み取って標高の表(配列)に戻し、
// 陰影・傾斜・色分けなどを自分で計算して描く。
// 全国Q地図の「基盤地図情報(標高)DEM1A/DEM5A」と同じ考え方の簡易版。
// ============================================================

// ---- 標高データの入手先(タイルソース) ----
const DEM_SOURCES = {
  dem1a: {
    name: "DEM1A(1mメッシュ)",
    urlTemplate: "https://qchizu3.xsrv.jp/mapdata/d52001/{z}/{x}/{y}.webp",
    tilePx: 512,          // 1タイルの画像サイズ(高解像度)
    maxNativeZoom: 16,    // タイルが用意されている最大ズーム
    attribution:
      '<a href="https://www.geospatial.jp/ckan/dataset/qchizu_94dem_99gsi" target="_blank">Q地図タイル(測量法に基づく国土地理院長承認(使用)R7JHs10)</a>',
  },
  dem5a: {
    name: "DEM5A(5mメッシュ)",
    urlTemplate: "https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/{z}/{x}/{y}.png",
    tilePx: 256,
    maxNativeZoom: 15,
    attribution:
      '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>',
  },
  dem10b: {
    name: "DEM10B(10mメッシュ)",
    urlTemplate: "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png",
    tilePx: 256,
    maxNativeZoom: 14,
    attribution:
      '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>',
  },
};

// ---- 標高タイルの読み込みとキャッシュ ----
// 同じタイルを何度も取りに行かないよう、一度読んだ結果を覚えておく。
const elevationCache = new Map(); // url -> Promise<{px, data(Float32Array)}>

function trimCache(cache, maxEntries) {
  // 増えすぎたら古いものから消す(Mapは追加順を覚えている)
  while (cache.size > maxEntries) {
    cache.delete(cache.keys().next().value);
  }
}

// 画像(標高タイル)を読み込んで、標高値の配列に変換する
function loadElevationTile(url, px) {
  if (elevationCache.has(url)) return elevationCache.get(url);

  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // 他サイトの画像のピクセルを読むために必要(CORS)
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = px;
      canvas.height = px;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, px, px);
      const rgba = ctx.getImageData(0, 0, px, px).data;

      // RGB → 標高(m)。無効値(海など)は NaN にする
      const data = new Float32Array(px * px);
      for (let i = 0; i < px * px; i++) {
        const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], a = rgba[i * 4 + 3];
        let x = r * 65536 + g * 256 + b;
        if (a === 0 || x === 8388608) {
          data[i] = NaN;            // データなし(2^23 が無効値の印)
        } else {
          if (x > 8388608) x -= 16777216; // 2^23より大きければ負の標高
          data[i] = x * 0.01;
        }
      }
      resolve({ px, data });
    };
    img.onerror = () => reject(new Error("標高タイルなし: " + url));
    img.src = url;
  });

  elevationCache.set(url, promise);
  trimCache(elevationCache, 120);
  // 失敗もキャッシュに残ると再試行できないため、失敗時は取り除く
  promise.catch(() => elevationCache.delete(url));
  return promise;
}

// ---- 標高の配列から絵を作る(描画モードごとの計算) ----

// 隣のピクセルとの標高差から、東西方向・南北方向の傾きを求める共通部品
function gradientAt(data, px, i, x, y, mpp) {
  const xl = x > 0 ? data[i - 1] : data[i];
  const xr = x < px - 1 ? data[i + 1] : data[i];
  const yu = y > 0 ? data[i - px] : data[i];
  const yd = y < px - 1 ? data[i + px] : data[i];
  // mpp = 1ピクセルが何メートルか
  return {
    dzdx: (xr - xl) / (2 * mpp),
    dzdy: (yd - yu) / (2 * mpp),
  };
}

// 陰影起伏図: 北西の上空から光を当てたときの明るさ
function renderHillshade(data, px, mpp) {
  const out = new Uint8ClampedArray(px * px * 4);
  const azimuth = (315 * Math.PI) / 180;   // 光の方角(北西)
  const altitude = (45 * Math.PI) / 180;   // 光の高さ(45度)
  const zenith = Math.PI / 2 - altitude;
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const i = y * px + x;
      if (isNaN(data[i])) continue; // 透明のまま
      const { dzdx, dzdy } = gradientAt(data, px, i, x, y, mpp);
      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      let shade =
        Math.cos(zenith) * Math.cos(slope) +
        Math.sin(zenith) * Math.sin(slope) * Math.cos(azimuth - aspect);
      shade = Math.max(0, Math.min(1, shade));
      const v = Math.round(shade * 255);
      out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
    }
  }
  return new ImageData(out, px, px);
}

// 傾斜量図: 平ら=白、急=黒
function renderSlope(data, px, mpp) {
  const out = new Uint8ClampedArray(px * px * 4);
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const i = y * px + x;
      if (isNaN(data[i])) continue;
      const { dzdx, dzdy } = gradientAt(data, px, i, x, y, mpp);
      const slopeDeg = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
      const v = Math.round(255 * (1 - Math.min(slopeDeg / 60, 1)));
      out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
    }
  }
  return new ImageData(out, px, px);
}

// 赤色立体風(簡易版): 傾斜が急なほど赤く濃く、尾根は明るく谷は暗く。
// (本家の赤色立体地図(アジア航測)の厳密な計算ではなく、見た目を近づけた簡易版)
function renderRedRelief(data, px, mpp) {
  const out = new Uint8ClampedArray(px * px * 4);
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const i = y * px + x;
      const h = data[i];
      if (isNaN(h)) continue;
      const { dzdx, dzdy } = gradientAt(data, px, i, x, y, mpp);
      const slope = Math.atan(Math.hypot(dzdx, dzdy)); // 0〜π/2

      // 周囲との標高差(ラプラシアン)で尾根/谷を判定。尾根=正=明るく
      const xl = x > 0 ? data[i - 1] : h;
      const xr = x < px - 1 ? data[i + 1] : h;
      const yu = y > 0 ? data[i - px] : h;
      const yd = y < px - 1 ? data[i + px] : h;
      let curve = h - (xl + xr + yu + yd) / 4;   // m単位
      curve = Math.max(-1, Math.min(1, curve / (mpp * 0.5)));

      const value = Math.max(0.15, Math.min(1, 0.75 + curve * 0.45)); // 明るさ
      const sat = Math.min(1, slope / 0.9);                            // 赤の濃さ

      // HSV(色相0=赤)→RGB の簡易変換
      const r = value * 255;
      const gb = value * (1 - sat) * 255;
      out[i * 4] = Math.round(r);
      out[i * 4 + 1] = Math.round(gb);
      out[i * 4 + 2] = Math.round(gb);
      out[i * 4 + 3] = 255;
    }
  }
  return new ImageData(out, px, px);
}

// 自分で作る色別標高図: 最低〜最高標高を指定した色数で塗り分ける
const RELIEF_PALETTE = [
  [0, 90, 200],    // 低い: 青
  [60, 170, 230],
  [120, 210, 130],
  [230, 230, 120],
  [240, 170, 80],
  [220, 100, 60],
  [180, 60, 120],
  [255, 255, 255], // 高い: 白
];

function renderCustomRelief(data, px, mpp, params) {
  const { minH, maxH, steps, shading } = params;
  const out = new Uint8ClampedArray(px * px * 4);
  const range = Math.max(0.01, maxH - minH);
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const i = y * px + x;
      const h = data[i];
      if (isNaN(h)) continue;

      // 標高を0〜1に正規化し、段数で区切って色を選ぶ
      let t = (h - minH) / range;
      t = Math.max(0, Math.min(1, t));
      const step = Math.min(steps - 1, Math.floor(t * steps));
      const pt = (step / (steps - 1 || 1)) * (RELIEF_PALETTE.length - 1);
      const pi = Math.floor(pt);
      const frac = pt - pi;
      const c0 = RELIEF_PALETTE[pi];
      const c1 = RELIEF_PALETTE[Math.min(pi + 1, RELIEF_PALETTE.length - 1)];
      let r = c0[0] + (c1[0] - c0[0]) * frac;
      let g = c0[1] + (c1[1] - c0[1]) * frac;
      let b = c0[2] + (c1[2] - c0[2]) * frac;

      // 陰影を重ねる(地形の凹凸が分かるように明るさを変える)
      if (shading) {
        const { dzdx, dzdy } = gradientAt(data, px, i, x, y, mpp);
        const slope = Math.atan(Math.hypot(dzdx, dzdy));
        const aspect = Math.atan2(dzdy, -dzdx);
        let shade =
          Math.cos(Math.PI / 4) * Math.cos(slope) +
          Math.sin(Math.PI / 4) * Math.sin(slope) * Math.cos((315 * Math.PI) / 180 - aspect);
        shade = 0.55 + 0.45 * Math.max(0, Math.min(1, shade));
        r *= shade; g *= shade; b *= shade;
      }
      out[i * 4] = Math.round(r);
      out[i * 4 + 1] = Math.round(g);
      out[i * 4 + 2] = Math.round(b);
      out[i * 4 + 3] = 255;
    }
  }
  return new ImageData(out, px, px);
}

// ---- 描いた結果のキャッシュ ----
const renderedCache = new Map(); // key -> canvas

// 標高タイル1枚を指定モードで描いたcanvasを返す
async function getRenderedTile(source, srcZ, srcX, srcY, mode, params, lat) {
  const paramsKey = params ? JSON.stringify(params) : "";
  const key = `${source.urlTemplate}|${srcZ}/${srcX}/${srcY}|${mode}|${paramsKey}`;
  if (renderedCache.has(key)) return renderedCache.get(key);

  const url = source.urlTemplate
    .replace("{z}", srcZ).replace("{x}", srcX).replace("{y}", srcY);
  const { px, data } = await loadElevationTile(url, source.tilePx);

  // 1ピクセルが何メートルに当たるか(緯度とズームで変わる)
  const mpp =
    (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, srcZ) / (px / 256);

  let imageData;
  if (mode === "hillshade") imageData = renderHillshade(data, px, mpp);
  else if (mode === "slope") imageData = renderSlope(data, px, mpp);
  else if (mode === "redrelief") imageData = renderRedRelief(data, px, mpp);
  else imageData = renderCustomRelief(data, px, mpp, params);

  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  canvas.getContext("2d").putImageData(imageData, 0, 0);
  renderedCache.set(key, canvas);
  trimCache(renderedCache, 120);
  return canvas;
}

// ---- Leafletレイヤー本体 ----
// タイルが用意されているズームを超えて拡大したときは、
// 手前のズームのタイルの該当部分を切り出して拡大表示する。
const DemLayer = L.GridLayer.extend({
  createTile(coords, done) {
    const tile = document.createElement("canvas");
    tile.width = 256;
    tile.height = 256;

    const source = this.options.source;
    const mode = this.options.mode;
    const params = this.options.params;

    // 実際に取りに行くタイルのズーム(用意されている範囲に丸める)
    const srcZ = Math.min(coords.z, source.maxNativeZoom);
    const factor = Math.pow(2, coords.z - srcZ); // 拡大率(1なら等倍)
    const srcX = Math.floor(coords.x / factor);
    const srcY = Math.floor(coords.y / factor);

    // このタイルの中心緯度(1ピクセル何メートルかの計算に使う)
    const n = Math.PI - (2 * Math.PI * (coords.y + 0.5)) / Math.pow(2, coords.z);
    const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));

    getRenderedTile(source, srcZ, srcX, srcY, mode, params, lat)
      .then((rendered) => {
        const ctx = tile.getContext("2d");
        // 元タイルの中の、このタイルに当たる部分を切り出して拡大
        const subPx = rendered.width / factor;
        const sx = (coords.x - srcX * factor) * subPx;
        const sy = (coords.y - srcY * factor) * subPx;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(rendered, sx, sy, subPx, subPx, 0, 0, 256, 256);
        done(null, tile);
      })
      .catch(() => {
        done(null, tile); // データがない場所は透明タイルのまま(エラーにしない)
      });
    return tile;
  },
});

// 使いやすい作成関数
function createDemLayer(sourceKey, mode, params) {
  const source = DEM_SOURCES[sourceKey];
  return new DemLayer({
    source,
    mode,
    params: params || null,
    maxZoom: 20,
    attribution: source.attribution,
  });
}
