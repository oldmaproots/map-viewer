// ============================================================
// 都市計画図 > 熊本県
// 熊本県の都市計画データ
// (国土交通省の都市計画決定GISデータ・令和7年度)を表示する。
// 元データは市町村ごと・種類ごとに分かれているので、
// scripts/build_kumamoto_data.py で種類ごとに1ファイルへまとめ、
// data/kumamoto/ に置いてある。
// チェックを入れたときに初めて読み込む(遅延読み込み)。
//
// このファイルには「凡例」の仕組みも入っている:
//  - 都市計画レイヤーをONにすると右下に凡例が出る
//  - 凡例は折り畳める
//  - 凡例の項目ごとに、地図上の表示/非表示を切り替えられる
// ============================================================

const KUMAMOTO_DATA_BASE = "data/kumamoto/";
const KUMAMOTO_ATTRIBUTION =
  '都市計画データ: <a href="https://www.mlit.go.jp/toshi/tosiko/toshi_tosiko_tk_000087.html" target="_blank">' +
  '都市計画決定GISデータ(国土交通省)令和7年度</a>を加工して作成';

// ---- 用途地域の色（都市計画総括図の公式凡例に準拠） ----
// 熊本県の都市計画総括図の凡例（用途地域凡例.pdf）から実測した色をそのまま使う。
// 並べた順番が、そのまま凡例に表示する順番になる（住居系→商業系→工業系）。
const YOUTO_CHIIKI_FILL = {
  第１種低層住居専用地域: "#95C5C7", // 青緑
  第２種低層住居専用地域: "#C8E8E7", // うすい青緑
  第１種中高層住居専用地域: "#B6D48E", // 黄緑
  第２種中高層住居専用地域: "#E0F3DF", // うすい黄緑
  第１種住居地域: "#FAF3AF", // 黄
  第２種住居地域: "#F3DEC9", // うすい黄
  準住居地域: "#F5CEA3", // 橙
  田園住居地域: "#C8A55D", // うすい茶（熊本県内に指定なし。将来のために用意）
  近隣商業地域: "#FCE8F3", // 桃
  商業地域: "#F6C4C7", // 赤
  準工業地域: "#C4C5E1", // 紫
  工業地域: "#CBEBF8", // 水色
  工業専用地域: "#67C2EE", // 青
};

// 色を暗くする。境界線の色を塗りつぶし色から自動で作るために使う
// （公式凡例は塗りつぶし色しか決めていないため）。
function darkenColor(hex, ratio) {
  const n = parseInt(hex.slice(1), 16);
  return (
    "#" +
    [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      .map((v) => Math.round(v * ratio).toString(16).padStart(2, "0"))
      .join("")
  );
}

// 種別ごとの色分け。
//  - 区域区分（市街化区域・調整区域）は公式総括図凡例に無いので従来の色のまま残す。
//  - 防火地域・準防火地域・特別用途地区・公園などは、
//    「熊本県 都市計画総括図の凡例（令和2年2月）」の色をPDFから実測して合わせた。
//    ※斜線ハッチや点線枠での表現は各レイヤー定義（KUMAMOTO_LAYER_DEFS）側の
//      hatch / frameOnly といった目印で切り替える。ここでは色だけを決める。
const KUMAMOTO_CATEGORY_COLORS = {
  // 区域区分（公式凡例に無いため従来の色のまま。ユーザー確認済み）
  市街化区域: { color: "#d94b3f", fillColor: "#f2a89e" },
  市街化調整区域: { color: "#3f7fd9", fillColor: "#a9c8f2" },
  // 防火地域・準防火地域（公式凡例の斜線ハッチ。fillColor=斜線の色、color=枠線）
  防火地域: { color: "#6f6c9c", fillColor: "#8c89b8" },   // 灰紫
  準防火地域: { color: "#d05f9c", fillColor: "#e27bb0" }, // 桃
  // 特別用途地区（公式凡例の色付き点線枠。5種。線の色＝そのままの色）
  大規模集客施設制限地区: { color: "#8dba1e", fillColor: "#8dba1e" }, // 黄緑
  特別工業地区: { color: "#e0b000", fillColor: "#f2c206" },           // 金
  文教地区: { color: "#0a6cc0", fillColor: "#0a6cc0" },               // 青
  娯楽レクリエーション地区: { color: "#e30d2e", fillColor: "#e30d2e" }, // 赤
  "行政・文化拠点地区": { color: "#b53877", fillColor: "#b53877" },     // 紫
  // 公園・緑地・墓園（公式凡例は緑の枠線。3種とも同じ緑）
  公園: { color: "#2e8b57", fillColor: "#2e8b57" },
  緑地: { color: "#2e8b57", fillColor: "#2e8b57" },
  墓園: { color: "#2e8b57", fillColor: "#2e8b57" },
};

// 用途地域を上の表に流し込む（塗りつぶしは公式色、境界線はそれを暗くした色）
Object.entries(YOUTO_CHIIKI_FILL).forEach(([name, fill]) => {
  KUMAMOTO_CATEGORY_COLORS[name] = { color: darkenColor(fill, 0.55), fillColor: fill };
});

// 凡例に並べる順番。用途地域は公式凡例の順、それ以外は五十音順にする
const YOUTO_CHIIKI_ORDER = Object.keys(YOUTO_CHIIKI_FILL);

function compareLegendItems(a, b) {
  const ia = YOUTO_CHIIKI_ORDER.indexOf(a);
  const ib = YOUTO_CHIIKI_ORDER.indexOf(b);
  if (ia >= 0 && ib >= 0) return ia - ib; // どちらも用途地域 → 公式凡例の順
  if (ia >= 0) return -1; // 用途地域を先に
  if (ib >= 0) return 1;
  return a.localeCompare(b, "ja");
}

const KUMAMOTO_FALLBACK_PALETTE = [
  { color: "#888888", fillColor: "#cccccc" },
  { color: "#c9691f", fillColor: "#f0cba0" },
  { color: "#1f8fc9", fillColor: "#a7dcf2" },
  { color: "#8f1fc9", fillColor: "#dba7f2" },
  { color: "#1fc98f", fillColor: "#a7f2d3" },
  { color: "#c91f5f", fillColor: "#f2a7c3" },
];

// 表示できるレイヤーの一覧(02プロジェクトのv2と同じ内容)
//  スタイルの目印(公式凡例に合わせるために追加した項目):
//    hatch:true     … 縁を斜線ハッチで縁取りする（防火・風致・特定用途制限・地区計画）
//    hatchDir       … 斜線の向き。"/"=右上がり、"\\"=右下がり。省略すると"/"。
//                     公式凡例の見本から実測した向きに合わせている（下の各行のコメント参照）
//    frameOnly:true … 塗りつぶさず枠線だけにする（公園=緑の枠、特別用途地区=点線の枠）
//    color/fillColor… レイヤー全体で色を1つに固定する（種別ごとに分けない）ときに指定
const KUMAMOTO_LAYER_DEFS = [
  // 都市計画区域の境界は公式凡例では「黒の一点鎖線」。dashArrayで一点鎖線を再現する
  { key: "toshikeikaku_kuiki", file: "toshikeikaku_kuiki.geojson", label: "都市計画区域(境界)",
    categoryFields: [], fillOpacity: 0, weight: 2, dashArray: "14 5 2 5", color: "#333333" },
  // 準都市計画区域は公式凡例では「二点鎖線」(長い線→点2つ)。都市計画区域の一点鎖線と
  // 点の数で見分ける決まりなので、太さや色は都市計画区域とそろえる
  { key: "jun_toshikeikaku_kuiki", file: "jun_toshikeikaku_kuiki.geojson", label: "準都市計画区域(境界)",
    categoryFields: [], fillOpacity: 0, weight: 2, dashArray: "14 5 2 5 2 5", color: "#333333" },
  { key: "kuiki_kubun", file: "kuiki_kubun.geojson", label: "区域区分(市街化区域・調整区域)",
    categoryFields: ["AreaType"], fillOpacity: 0.35 },
  // 公式凡例の色は淡いものが多いため、背景地図に埋もれないよう濃いめに塗る
  { key: "youto_chiiki", file: "youto_chiiki.geojson", label: "用途地域",
    categoryFields: ["YoutoName", "AreaType"], fillOpacity: 0.7 },
  // 防火・準防火地域は公式凡例では「右下がり」の斜線。種別(AreaType)ごとに灰紫/桃で塗り分ける
  { key: "bouka_chiiki", file: "bouka_chiiki.geojson", label: "防火地域・準防火地域",
    categoryFields: ["AreaType"], fillOpacity: 0.85, weight: 1, hatch: true, hatchDir: "\\" },
  // 地区計画は公式凡例では1つの茶色の「右上がり」の斜線。区域名では色分けせず1色にする
  { key: "chiku_keikaku", file: "chiku_keikaku.geojson", label: "地区計画",
    categoryFields: [], fillOpacity: 0.85, weight: 1, hatch: true, hatchDir: "/",
    fillColor: "#b98a52", color: "#8a6330" },
  // 特別用途地区は公式凡例では色付きの点線の枠。種別ごとに色を変える
  { key: "tokubetsu_youto_chiku", file: "tokubetsu_youto_chiku.geojson", label: "特別用途地区",
    categoryFields: ["YoutoName"], fillOpacity: 0, weight: 3, frameOnly: true, dashArray: "1 5" },
  // 特定用途制限地域は公式凡例では1つの橙色の「右上がり」の斜線。1色にする
  { key: "tokutei_youto_seigen", file: "tokutei_youto_seigen.geojson", label: "特定用途制限地域",
    categoryFields: [], fillOpacity: 0.85, weight: 1, hatch: true, hatchDir: "/",
    fillColor: "#e0b45a", color: "#c78a2e" },
  { key: "ricchi_tekiseika_keikaku", file: "ricchi_tekiseika_keikaku.geojson", label: "立地適正化計画区域",
    categoryFields: ["AreaType"], fillOpacity: 0.2 },
  // 公園・緑地・墓園は公式凡例では緑の枠線。塗らずに枠だけにする
  { key: "toshikeikaku_koen", file: "toshikeikaku_koen.geojson", label: "都市計画公園・緑地",
    categoryFields: ["ParkType"], fillOpacity: 0, weight: 2, frameOnly: true },
  // 都市計画道路は公式凡例では黒い線
  { key: "toshikeikaku_douro", file: "toshikeikaku_douro.geojson", label: "都市計画道路",
    categoryFields: [], fillOpacity: 0, weight: 2, color: "#333333" },
  // 風致地区は公式凡例では緑の「右下がり」の斜線
  { key: "fuuchi_chiku", file: "fuuchi_chiku.geojson", label: "風致地区",
    categoryFields: [], fillOpacity: 0.85, weight: 1, hatch: true, hatchDir: "\\",
    fillColor: "#67b698", color: "#3f8f6d" },
  { key: "koudo_riyou_chiku", file: "koudo_riyou_chiku.geojson", label: "高度利用地区",
    categoryFields: [], fillOpacity: 0.3 },
  { key: "tochikukaku_seiri", file: "tochikukaku_seiri.geojson", label: "土地区画整理事業",
    categoryFields: ["DistName"], fillOpacity: 0.3 },
];

// ============================================================
// 斜線ハッチを描けるCanvasレンダラー
// ------------------------------------------------------------
// 用途地域(6.9MB)や都市計画道路(5.2MB)のような大きなデータでも軽く動くよう、
// 描画はSVGではなくCanvas(L.canvas)を使う。
// ただし素のL.canvasは「べた塗り」しかできないので、斜線ハッチを塗れるように
// 塗りつぶし処理(_fillStroke)だけ差し替えたレンダラーを用意する。
//
// 斜線は「8×8の小さなcanvasに斜め線を1本描いたタイル」を作り、
// それを ctx.createPattern() で敷き詰めて塗る。
// タイルは色ごとにキャッシュして使い回すので動作は軽い。
// ============================================================

// 縁取りの帯の幅(画面上のピクセル)。ズームしても一定の太さになる
const HATCH_BAND_WIDTH = 12;

// 斜線タイル(オフスクリーンcanvas)を「色＋向き」ごとに覚えておく入れ物
const hatchTileCache = new Map(); // "色|向き" -> 8×8のcanvas

// 指定色・指定の向きの斜線タイルを1枚作る(または使い回す)
//   dir "/"  … 右上がり(左下から右上へ)
//   dir "\\" … 右下がり(左上から右下へ)
function getHatchTile(color, dir) {
  const key = `${color}|${dir}`;
  if (hatchTileCache.has(key)) return hatchTileCache.get(key);
  const size = 8;
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const c = tile.getContext("2d");
  c.strokeStyle = color;
  c.lineWidth = 1.5;
  // タイルの継ぎ目でも線がつながるよう、角の外側にもはみ出して引く
  c.beginPath();
  if (dir === "\\") {
    // 右下がり: 左上(0,0)から右下(size,size)へ
    c.moveTo(0, 0); c.lineTo(size, size);
    c.moveTo(-size, 0); c.lineTo(size, size * 2);
    c.moveTo(0, -size); c.lineTo(size * 2, size);
  } else {
    // 右上がり: 左下(0,size)から右上(size,0)へ
    c.moveTo(0, size); c.lineTo(size, 0);
    c.moveTo(-size, size); c.lineTo(size, -size);
    c.moveTo(0, size * 2); c.lineTo(size * 2, 0);
  }
  c.stroke();
  hatchTileCache.set(key, tile);
  return tile;
}

// canvasごとに作った塗りパターンを覚えておく(図形のたびに作り直さないため)
const hatchPatternCache = new WeakMap(); // ctx -> Map("色|向き" -> CanvasPattern)

function getHatchPattern(ctx, color, dir) {
  let perCtx = hatchPatternCache.get(ctx);
  if (!perCtx) {
    perCtx = new Map();
    hatchPatternCache.set(ctx, perCtx);
  }
  const key = `${color}|${dir}`;
  if (!perCtx.has(key)) {
    perCtx.set(key, ctx.createPattern(getHatchTile(color, dir), "repeat"));
  }
  return perCtx.get(key);
}

// L.Canvasを継承し、hatch:true のときだけ「縁を斜線で縁取りする」描き方に差し替える。
// それ以外はLeaflet 1.9.4の元の _fillStroke とまったく同じ挙動にしてある。
//
// 縁取りの作り方(公式総括図と同じ、中は塗らない表現):
//   1. ctx.clip() で「この図形の内側」だけを描画対象に限定する
//   2. その状態で図形の輪郭を、とても太い線(帯の幅の2倍)でなぞる
//   3. 太い線の外半分はclipで消えるので、内側にだけ帯が残る
// 図形より帯のほうが太い小さな区域は、そのまま全体が斜線になる(消えない)。
const HatchCanvas = L.Canvas.extend({
  _fillStroke(ctx, layer) {
    const options = layer.options;

    if (options.fill) {
      if (options.hatch) {
        ctx.save();
        ctx.globalAlpha = options.fillOpacity;
        ctx.clip(options.fillRule || "evenodd"); // 図形の内側だけに描く(穴あきにも対応)
        ctx.strokeStyle = getHatchPattern(
          ctx,
          options.hatchColor || options.fillColor || options.color,
          options.hatchDir || "/"
        );
        ctx.lineWidth = HATCH_BAND_WIDTH * 2; // 外半分はclipで捨てられる
        ctx.setLineDash([]);                  // 帯は実線でなぞる(輪郭の破線設定を引きずらない)
        ctx.stroke();
        ctx.restore();                        // clipと透明度を元に戻す
      } else {
        ctx.globalAlpha = options.fillOpacity;
        ctx.fillStyle = options.fillColor || options.color;
        ctx.fill(options.fillRule || "evenodd");
      }
    }

    if (options.stroke && options.weight !== 0) {
      if (ctx.setLineDash) {
        ctx.setLineDash((layer.options && layer.options._dashArray) || []);
      }
      ctx.globalAlpha = options.opacity;
      ctx.lineWidth = options.weight;
      ctx.strokeStyle = options.color;
      ctx.lineCap = options.lineCap;
      ctx.lineJoin = options.lineJoin;
      ctx.stroke();
    }
  },
});

// レイヤーごとに専用のHatchCanvasレンダラーを作る。
// 重ね順(pane)をレイヤーごとに変えられるよう、共有せずに1レイヤー1つ作る。
function createKumamotoRenderer(paneName) {
  return new HatchCanvas({ padding: 0.5, pane: paneName || "overlayPane" });
}

// 色が決まっていない種別にも一貫した色を割り当てるためのキャッシュ
const kumamotoColorCache = new Map();
function kumamotoColorFor(layerKey, name, fallbackIndex) {
  if (!name) return KUMAMOTO_FALLBACK_PALETTE[fallbackIndex % KUMAMOTO_FALLBACK_PALETTE.length];
  if (KUMAMOTO_CATEGORY_COLORS[name]) return KUMAMOTO_CATEGORY_COLORS[name];
  const cacheKey = `${layerKey}::${name}`;
  if (!kumamotoColorCache.has(cacheKey)) {
    kumamotoColorCache.set(
      cacheKey,
      KUMAMOTO_FALLBACK_PALETTE[kumamotoColorCache.size % KUMAMOTO_FALLBACK_PALETTE.length]
    );
  }
  return kumamotoColorCache.get(cacheKey);
}

function kumamotoCategoryName(properties, categoryFields) {
  for (const key of categoryFields) {
    if (properties && properties[key]) return String(properties[key]);
  }
  return null;
}

// 凡例で項目を非表示にしたときの目印。項目名がこのSetに入っていたら描かない。
// 種別を持たないレイヤー(都市計画道路など)は「__all__」という名前で扱う。
function kumamotoItemName(def, feature) {
  return kumamotoCategoryName(feature.properties, def.categoryFields) ?? "__all__";
}

// 1つの図形(feature)のスタイルを計算する。
// 凡例で非表示にされた項目は透明にして見えなくする。
function computeKumamotoStyle(def, feature) {
  const itemName = kumamotoItemName(def, feature);
  if (def._hiddenItems && def._hiddenItems.has(itemName)) {
    return { opacity: 0, fillOpacity: 0 }; // 非表示(透明)
  }
  const name = kumamotoCategoryName(feature.properties, def.categoryFields);
  const defIndex = KUMAMOTO_LAYER_DEFS.indexOf(def);

  // 色を決める。
  //  - レイヤー全体で色を固定している場合(def.color / def.fillColor)はそれを使う
  //  - そうでなければ種別ごとの色(公式色 or 自動割り当て)を使う
  let strokeColor, fillColor;
  if (def.color || def.fillColor) {
    fillColor = def.fillColor || def.color;
    strokeColor = def.color || darkenColor(def.fillColor, 0.7);
  } else {
    const c = kumamotoColorFor(def.key, name, defIndex);
    fillColor = c.fillColor;
    strokeColor = c.color;
  }

  return {
    color: strokeColor,
    fillColor: fillColor,
    weight: def.weight ?? 1,
    dashArray: def.dashArray,
    // frameOnly(枠だけ)のレイヤーは塗らない
    fillOpacity: def.frameOnly ? 0 : def.fillOpacity,
    // 自作HatchCanvasレンダラーが読む目印。斜線で縁取りするか、その色と向き
    hatch: !!def.hatch,
    hatchColor: fillColor,
    hatchDir: def.hatchDir || "/",
  };
}

// チェックを入れたときに初めてGeoJSONを取得してレイヤーを作る。
// paneName … このレイヤー専用の描画面(重ね順を変えるために使う)。script.jsが渡す。
function ensureKumamotoLayer(def, paneName) {
  if (def._loadPromise) return def._loadPromise;
  def._loadPromise = fetch(KUMAMOTO_DATA_BASE + def.file)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((geojson) => {
      def._hiddenItems = new Set();

      // 凡例に並べる項目名の一覧を集めておく(データに実際に出てくる種別)
      const names = new Set();
      geojson.features.forEach((f) => names.add(kumamotoItemName(def, f)));
      def._itemNames = [...names].sort(compareLegendItems);

      def._layer = L.geoJSON(geojson, {
        // このレイヤー専用のレンダラー(専用paneに描く)。重ね順の変更に対応する
        renderer: createKumamotoRenderer(paneName),
        attribution: KUMAMOTO_ATTRIBUTION,
        style: (feature) => computeKumamotoStyle(def, feature),
      });
      return def._layer;
    })
    .catch((err) => {
      def._loadPromise = null; // 次回チェック時に再試行できるようにする
      alert(`「${def.label}」の読み込みに失敗しました`);
      throw err;
    });
  return def._loadPromise;
}

// 凡例のチェックで項目の表示/非表示を切り替える
function setKumamotoItemVisible(def, itemName, visible) {
  if (!def._hiddenItems) def._hiddenItems = new Set();
  if (visible) def._hiddenItems.delete(itemName);
  else def._hiddenItems.add(itemName);
  // スタイルを計算し直して描き直す
  def._layer.setStyle((feature) => computeKumamotoStyle(def, feature));
}

// ---- クリックした地点の区域名を調べる(script.jsのクリック処理から呼ぶ) ----
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeometry(lng, lat, geometry) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates;
    if (!pointInRing(lng, lat, rings[0])) return false;
    for (let k = 1; k < rings.length; k++) {
      if (pointInRing(lng, lat, rings[k])) return false; // 穴の中
    }
    return true;
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((poly) =>
      pointInGeometry(lng, lat, { type: "Polygon", coordinates: poly })
    );
  }
  return false;
}

// 表示中の都市計画レイヤーのうち、クリック地点に当たるものを列挙する
// (凡例で非表示にした項目は対象外)
function kumamotoMatchesAt(map, latlng) {
  const matches = [];
  KUMAMOTO_LAYER_DEFS.forEach((def) => {
    if (!def._layer || !map.hasLayer(def._layer)) return;
    def._layer.eachLayer((fl) => {
      const feature = fl.feature;
      if (!feature) return;
      if (def._hiddenItems && def._hiddenItems.has(kumamotoItemName(def, feature))) return;
      if (!pointInGeometry(latlng.lng, latlng.lat, feature.geometry)) return;
      const name = kumamotoCategoryName(feature.properties, def.categoryFields);
      matches.push(name ? `${def.label}: ${name}` : def.label);
    });
  });
  return matches;
}

// ============================================================
// 凡例(右下)。チェック中の都市計画レイヤーだけを載せる。
// ============================================================
let legendBody = null;      // 凡例の中身(折り畳み対象)
let legendContainer = null; // 凡例全体
let legendCollapsed = false;
let legendMap = null;

function buildLegendSection(def) {
  const section = document.createElement("div");
  section.className = "legend-section";

  const title = document.createElement("div");
  title.className = "legend-section-title";
  title.textContent = def.label;
  section.appendChild(title);

  def._itemNames.forEach((itemName) => {
    const row = document.createElement("label");
    row.className = "legend-item";

    // 表示/非表示のチェック
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !def._hiddenItems.has(itemName);
    checkbox.addEventListener("change", () => {
      setKumamotoItemVisible(def, itemName, checkbox.checked);
    });

    // 色見本。地図の見た目(べた塗り/斜線ハッチ/点線枠/枠線/線)に合わせて描く
    const defIndex = KUMAMOTO_LAYER_DEFS.indexOf(def);
    let strokeColor, fillColor;
    if (def.color || def.fillColor) {
      fillColor = def.fillColor || def.color;
      strokeColor = def.color || darkenColor(def.fillColor, 0.7);
    } else {
      const c = kumamotoColorFor(def.key, itemName === "__all__" ? null : itemName, defIndex);
      fillColor = c.fillColor;
      strokeColor = c.color;
    }
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.borderColor = strokeColor;

    if (def.hatch) {
      // 地図と同じ「縁だけ斜線」を小さな見本でも再現する。
      // CSSの角度は、45deg で右下がり「\」、-45deg で右上がり「/」になる
      // (グラデーションの軸と縞は直角の関係にあるため、見た目は逆向きになる)。
      const angle = (def.hatchDir === "\\") ? "45deg" : "-45deg";
      swatch.classList.add("legend-swatch-frame");
      swatch.style.background =
        `repeating-linear-gradient(${angle}, ${fillColor} 0 1.5px, transparent 1.5px 4px)`;
    } else if (def.frameOnly) {
      // 枠だけ(公園=実線の枠、特別用途地区=点線の枠)
      swatch.style.background = "transparent";
      swatch.style.borderStyle = def.dashArray ? "dotted" : "solid";
      swatch.style.borderColor = strokeColor;
    } else if (def.fillOpacity === 0) {
      // 線だけのレイヤー(都市計画区域の境界・都市計画道路)
      swatch.style.background = strokeColor;
    } else {
      swatch.style.background = fillColor;
    }

    const name = document.createElement("span");
    name.className = "legend-name";
    name.textContent = itemName === "__all__" ? "(全体)" : itemName;

    row.appendChild(checkbox);
    row.appendChild(swatch);
    row.appendChild(name);
    section.appendChild(row);
  });

  return section;
}

// 凡例を作り直す(レイヤーのON/OFFのたびに呼ぶ)
function rebuildKumamotoLegend() {
  if (!legendBody) return;
  legendBody.innerHTML = "";
  let count = 0;
  KUMAMOTO_LAYER_DEFS.forEach((def) => {
    if (!def._layer || !legendMap.hasLayer(def._layer)) return;
    legendBody.appendChild(buildLegendSection(def));
    count++;
  });
  // 表示中の都市計画レイヤーが1つもなければ凡例ごと隠す
  legendContainer.style.display = count > 0 ? "block" : "none";
}

// 凡例パネルをLeafletのコントロール(右下)として作る
function initKumamotoLegend(map) {
  legendMap = map;
  const LegendControl = L.Control.extend({
    onAdd() {
      legendContainer = L.DomUtil.create("div", "legend-panel");
      L.DomEvent.disableClickPropagation(legendContainer);
      L.DomEvent.disableScrollPropagation(legendContainer);

      const header = L.DomUtil.create("div", "legend-header", legendContainer);
      const titleSpan = document.createElement("span");
      titleSpan.textContent = "凡例";
      const toggleSpan = document.createElement("span");
      toggleSpan.className = "legend-toggle";
      toggleSpan.textContent = "▼";
      header.appendChild(titleSpan);
      header.appendChild(toggleSpan);

      legendBody = L.DomUtil.create("div", "legend-body", legendContainer);

      // ヘッダーをクリックすると折り畳み
      header.addEventListener("click", () => {
        legendCollapsed = !legendCollapsed;
        legendBody.style.display = legendCollapsed ? "none" : "block";
        toggleSpan.textContent = legendCollapsed ? "▲" : "▼";
      });

      legendContainer.style.display = "none"; // 最初は何もないので隠す
      return legendContainer;
    },
  });
  new LegendControl({ position: "bottomright" }).addTo(map);

  // 都市計画レイヤーが地図に足されたり消えたりしたら凡例を作り直す
  map.on("layeradd layerremove", (e) => {
    if (KUMAMOTO_LAYER_DEFS.some((def) => def._layer === e.layer)) {
      rebuildKumamotoLegend();
    }
  });
}
