// ============================================================
// 都市計画図 > 熊本県
// 02KumamotoCityPlanning プロジェクトで作った熊本県の都市計画データ
// (国土数値情報 A55 をGeoJSON化したもの)を表示する。
// データは data/kumamoto/ にコピーしてあり、
// チェックを入れたときに初めて読み込む(遅延読み込み)。
//
// このファイルには「凡例」の仕組みも入っている:
//  - 都市計画レイヤーをONにすると右下に凡例が出る
//  - 凡例は折り畳める
//  - 凡例の項目ごとに、地図上の表示/非表示を切り替えられる
// ============================================================

const KUMAMOTO_DATA_BASE = "data/kumamoto/";
const KUMAMOTO_ATTRIBUTION =
  '都市計画データ: <a href="https://nlftp.mlit.go.jp/ksj/" target="_blank">国土数値情報(国土交通省)</a>を加工して作成';

// 区域区分・用途地域などの名称ごとの色分け(02プロジェクトと同じ配色)
const KUMAMOTO_CATEGORY_COLORS = {
  市街化区域: { color: "#d94b3f", fillColor: "#f2a89e" },
  市街化調整区域: { color: "#3f7fd9", fillColor: "#a9c8f2" },
  第１種低層住居専用地域: { color: "#2f7d32", fillColor: "#bfe3b4" },
  第２種低層住居専用地域: { color: "#4f9d4f", fillColor: "#cdeccb" },
  第１種中高層住居専用地域: { color: "#5a8f3c", fillColor: "#d3e8bf" },
  第２種中高層住居専用地域: { color: "#7ba648", fillColor: "#e0edc9" },
  第１種住居地域: { color: "#c9a227", fillColor: "#f2e3a3" },
  第２種住居地域: { color: "#d9b23f", fillColor: "#f5ecc0" },
  準住居地域: { color: "#d9c23f", fillColor: "#f5efc0" },
  田園住居地域: { color: "#8fae3f", fillColor: "#e3edc0" },
  近隣商業地域: { color: "#e08a2b", fillColor: "#f7cfa0" },
  商業地域: { color: "#d94b3f", fillColor: "#f2a89e" },
  準工業地域: { color: "#a15fc9", fillColor: "#dfc3f2" },
  工業地域: { color: "#6b5fc9", fillColor: "#c8c3f2" },
  工業専用地域: { color: "#3f4fc9", fillColor: "#b8c0f2" },
  防火地域: { color: "#b3271e", fillColor: "#e8a29c" },
  準防火地域: { color: "#d98c1f", fillColor: "#f2d19c" },
};

const KUMAMOTO_FALLBACK_PALETTE = [
  { color: "#888888", fillColor: "#cccccc" },
  { color: "#c9691f", fillColor: "#f0cba0" },
  { color: "#1f8fc9", fillColor: "#a7dcf2" },
  { color: "#8f1fc9", fillColor: "#dba7f2" },
  { color: "#1fc98f", fillColor: "#a7f2d3" },
  { color: "#c91f5f", fillColor: "#f2a7c3" },
];

// 表示できるレイヤーの一覧(02プロジェクトのv2と同じ内容)
const KUMAMOTO_LAYER_DEFS = [
  { key: "toshikeikaku_kuiki", file: "toshikeikaku_kuiki.geojson", label: "都市計画区域(境界)",
    categoryFields: [], fillOpacity: 0, weight: 3, dashArray: "10 6", color: "#283593" },
  { key: "kuiki_kubun", file: "kuiki_kubun.geojson", label: "区域区分(市街化区域・調整区域)",
    categoryFields: ["AreaType"], fillOpacity: 0.35 },
  { key: "youto_chiiki", file: "youto_chiiki.geojson", label: "用途地域",
    categoryFields: ["YoutoName", "AreaType"], fillOpacity: 0.45 },
  { key: "bouka_chiiki", file: "bouka_chiiki.geojson", label: "防火地域・準防火地域",
    categoryFields: ["AreaType"], fillOpacity: 0.35 },
  { key: "chiku_keikaku", file: "chiku_keikaku.geojson", label: "地区計画",
    categoryFields: ["DistName"], fillOpacity: 0.3 },
  { key: "tokubetsu_youto_chiku", file: "tokubetsu_youto_chiku.geojson", label: "特別用途地区",
    categoryFields: ["YoutoName"], fillOpacity: 0.3 },
  { key: "tokutei_youto_seigen", file: "tokutei_youto_seigen.geojson", label: "特定用途制限地域",
    categoryFields: ["DistName"], fillOpacity: 0.3 },
  { key: "ricchi_tekiseika_keikaku", file: "ricchi_tekiseika_keikaku.geojson", label: "立地適正化計画区域",
    categoryFields: ["AreaType"], fillOpacity: 0.2 },
  { key: "toshikeikaku_koen", file: "toshikeikaku_koen.geojson", label: "都市計画公園・緑地",
    categoryFields: ["ParkType"], fillOpacity: 0.4 },
  { key: "toshikeikaku_douro", file: "toshikeikaku_douro.geojson", label: "都市計画道路",
    categoryFields: [], fillOpacity: 0, weight: 2 },
  { key: "fuuchi_chiku", file: "fuuchi_chiku.geojson", label: "風致地区",
    categoryFields: [], fillOpacity: 0.25 },
  { key: "koudo_riyou_chiku", file: "koudo_riyou_chiku.geojson", label: "高度利用地区",
    categoryFields: [], fillOpacity: 0.3 },
  { key: "tochikukaku_seiri", file: "tochikukaku_seiri.geojson", label: "土地区画整理事業",
    categoryFields: ["DistName"], fillOpacity: 0.3 },
];

// 頂点数の多いポリゴンが多いのでSVGより速いcanvasで描く
const kumamotoRenderer = L.canvas({ padding: 0.5 });

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
  const c = def.color
    ? { color: def.color, fillColor: def.color }
    : kumamotoColorFor(def.key, name, defIndex);
  return {
    color: c.color,
    fillColor: c.fillColor,
    weight: def.weight ?? 1,
    dashArray: def.dashArray,
    fillOpacity: def.fillOpacity,
  };
}

// チェックを入れたときに初めてGeoJSONを取得してレイヤーを作る
function ensureKumamotoLayer(def) {
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
      def._itemNames = [...names].sort((a, b) => a.localeCompare(b, "ja"));

      def._layer = L.geoJSON(geojson, {
        renderer: kumamotoRenderer,
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

    // 色見本
    const defIndex = KUMAMOTO_LAYER_DEFS.indexOf(def);
    const c = def.color
      ? { color: def.color, fillColor: def.color }
      : kumamotoColorFor(def.key, itemName === "__all__" ? null : itemName, defIndex);
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = c.fillColor;
    swatch.style.borderColor = c.color;
    if (def.fillOpacity === 0) swatch.style.background = "transparent"; // 線だけのレイヤー

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
