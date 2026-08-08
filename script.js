// ============================================================
// 地図ビューア本体
// 左サイドパネル(地理院地図・Q地図風)でレイヤーを選び、
// 選択中のレイヤーは透過スライダー付きの一覧で管理する。
//
// 各部品の役割:
//   konjaku-data.js … 今昔マップの全タイル一覧(自動生成)
//   dem-layers.js   … 標高タイルから地形を描く部品
//   timeseries.js   … 年代別写真の時系列スライダー
//   kumamoto.js     … 都市計画図(熊本県)のGeoJSONレイヤー
// ============================================================

const VIEW_STORAGE_KEY = "map-viewer-last-view";


// ---- 前回見ていた場所を復元(初回は熊本周辺) ----
function loadLastView() {
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_STORAGE_KEY));
    if (saved && typeof saved.lat === "number") return saved;
  } catch (e) { /* 壊れていたら初期値 */ }
  return { lat: 32.79, lng: 130.74, zoom: 10 };
}
const lastView = loadLastView();

// 出典は地図の隅ではなく、設定(⚙)の「出典」にまとめている。
// 地図を隠さずに済み、地区計画のように1地区ずつ出所が違うものは吹き出しで示せるため。
// Googleの背景地図だけはタイル画像にロゴが入っており、規約どおりそのまま表示される。
const map = L.map("map", {
  center: [lastView.lat, lastView.lng],
  zoom: lastView.zoom,
  maxZoom: 20, // 法務局地図(地番)は20まで拡大できる
  attributionControl: false,
});

L.control.scale({ imperial: false }).addTo(map);

// ============================================================
// 背景地図(どれか1つを選ぶ)
// ============================================================
const BASE_LAYERS = {
  // maxNativeZoom = タイルが実際に用意されているズーム。
  // これより拡大したときは、その画像を引き伸ばして maxZoom まで見せる
  標準地図: L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", {
    maxNativeZoom: 18, maxZoom: 20,
  }),
  淡色地図: L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", {
    maxNativeZoom: 18, maxZoom: 20,
  }),
  白地図: L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png", {
    maxNativeZoom: 14, maxZoom: 20,
  }),
  "空中写真": L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", {
    maxNativeZoom: 18, maxZoom: 20,
  }),
};

// ---- 基盤地図情報の背景地図(線の項目だけ) ----
// 国土地理院の基盤地図情報(基本項目)から、線の項目だけを取り出して
// ベクトルタイル(PMTiles)にしたもの。海岸線・行政界・道路縁・建築物の外周線などを
// 灰色一色で描く、白地図に近い下地。都市計画図を重ねて見るときに向いている。
//
// 元は1.5GBあるが、タイルにすると画面に映っている範囲の必要な分だけを読むので軽い。
// 作り方は 10FGDBaseMap/scripts/build_web_tiles.py を参照。

// PMTilesを読むための下ごしらえ。MapLibreに「pmtiles://」の読み方を教える
if (window.pmtiles && window.maplibregl) {
  maplibregl.addProtocol("pmtiles", new pmtiles.Protocol().tile);
}

// 背景地図なので、都市計画図などの重ねるレイヤーより奥に描く専用の面を用意する
// (タイルの面=200 と 重ねるレイヤーの面=410〜 の間に入れる)
map.createPane("base-vector");
map.getPane("base-vector").style.zIndex = "210";

BASE_LAYERS["基盤地図情報"] = L.maplibreGL({
  style: "fgd-basemap-style.json",
  pane: "base-vector",
});

// いま選んでいる背景地図。名前も覚えておく(保存・復元に使う)
let currentBaseName = "標準地図";
let currentBase = BASE_LAYERS[currentBaseName];
currentBase.addTo(map);

// 背景地図を切り替える。ラジオボタンからも、保存した状態を戻すときからも呼ぶ
function selectBaseLayer(name) {
  if (!BASE_LAYERS[name] || name === currentBaseName) return;
  map.removeLayer(currentBase);
  currentBaseName = name;
  currentBase = BASE_LAYERS[name];
  currentBase.addTo(map);
  if (baseRadioByName[name]) baseRadioByName[name].checked = true;
  saveLayerState();
}

// ============================================================
// 選択中のレイヤー一覧(透過スライダー付き)
// registerActiveLayer / unregisterActiveLayer は他のファイルからも呼ばれる
// ============================================================
const activeList = document.getElementById("active-layers-list");
const activeLayers = new Map(); // id -> { row, handle, slider, setVisible }

// ============================================================
// 選んだレイヤーを覚えておく(リロードしても消えないように)
// ------------------------------------------------------------
// 「どのレイヤーを選んでいるか」「重ね順」「透過」「隠しているか」と
// 背景地図の種類をブラウザに保存し、次に開いたときに戻す。
// 見ていた場所(中心とズーム)は別のキー(VIEW_STORAGE_KEY)で保存している。
// ============================================================
const LAYERS_STORAGE_KEY = "map-viewer-layers";

// idからチェックボックスを引くための表(buildLayerRowが登録する)
const layerControls = new Map(); // id -> { checkbox, applyCheck }

// 初めて開いたときに出しておくもの
const DEFAULT_LAYER_STATE = {
  base: "基盤地図情報",
  layers: [
    { id: "youto-circles" },          // 容積率・建ぺい率の丸印
    { id: "kumamoto-youto_chiiki" },  // 用途地域
  ],
};

// 保存を一時的に止めるための目印。
// 前回の状態を戻している最中は、途中経過を保存してしまわないようにする
let restoringLayers = false;

function saveLayerState() {
  if (restoringLayers) return;
  const layers = [...activeList.querySelectorAll(".active-row")].map((row) => {
    const id = row.dataset.layerId;
    const entry = activeLayers.get(id);
    return {
      id,
      opacity: entry && entry.slider ? Number(entry.slider.value) / 100 : 1,
      visible: !row.classList.contains("row-hidden"),
    };
  });
  try {
    localStorage.setItem(
      LAYERS_STORAGE_KEY,
      JSON.stringify({ base: currentBaseName, layers })
    );
  } catch (e) { /* 保存できなくても表示には影響しない */ }
}

// 背景地図の名前を短くしたときの読み替え表。
// 前の名前で保存されていても、次に開いたときに同じ背景地図に戻るようにする
const RENAMED_BASE_LAYERS = {
  "基盤地図情報(線)": "基盤地図情報",
  "空中写真(最新)": "空中写真",
};

function loadLayerState() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYERS_STORAGE_KEY));
    if (saved && Array.isArray(saved.layers)) {
      if (RENAMED_BASE_LAYERS[saved.base]) saved.base = RENAMED_BASE_LAYERS[saved.base];
      return saved;
    }
  } catch (e) { /* 壊れていたら初期設定で始める */ }
  return DEFAULT_LAYER_STATE;
}

// 前回の状態に戻す。すべてのカテゴリを作り終えたあとに1回だけ呼ぶ
async function restoreLayerState() {
  const state = loadLayerState();

  if (state.base && BASE_LAYERS[state.base] && state.base !== currentBaseName) {
    selectBaseLayer(state.base);
  }

  restoringLayers = true;
  // 上の行から順に足していく。あとから足したものは下に付くので、
  // この順番で足せば保存したときの重ね順がそのまま再現される
  for (const item of state.layers) {
    const control = layerControls.get(item.id);
    if (!control || control.checkbox.checked) continue;
    control.checkbox.checked = true;
    try {
      await control.applyCheck(); // 読み込みが終わるまで待つ
    } catch (e) {
      control.checkbox.checked = false;
      continue;
    }
    const entry = activeLayers.get(item.id);
    if (!entry) continue;
    if (typeof item.opacity === "number" && entry.slider) {
      entry.slider.value = Math.round(item.opacity * 100);
      entry.handle.setOpacity(item.opacity);
    }
    if (item.visible === false) entry.setVisible(false);
  }

  // 「いちばん手前に置く」レイヤーは足すと先頭へ入るので、
  // 最後に保存どおりの並びへ直しておく
  state.layers.forEach((item) => {
    const entry = activeLayers.get(item.id);
    if (entry) activeList.appendChild(entry.row);
  });
  applyLayerOrder();

  restoringLayers = false;
  saveLayerState();
}

// ============================================================
// レイヤーごとの専用ペイン(重ね順の変更に使う)
// ------------------------------------------------------------
// Leafletは「pane(ペイン)」という描画面の重なり順(z-index)で
// レイヤーの前後関係を決める。既定では tilePane=200 / overlayPane=400。
// ここではレイヤー1つにつき専用のペインを1つ作り、
// 「選択中のレイヤー」一覧の並び順からz-indexを決める。
// 一覧の上にあるものほど大きいz-index=地図で手前に描く(地理院地図と同じ向き)。
// ============================================================
const layerPanes = new Map(); // id -> ペイン名
let paneSeq = 0;

// idに対応する専用ペインを用意する(既にあれば使い回す)。ペイン名を返す。
function ensureLayerPane(id) {
  if (layerPanes.has(id)) return layerPanes.get(id);
  const paneName = `layer-pane-${paneSeq++}`;
  map.createPane(paneName);
  layerPanes.set(id, paneName);
  return paneName;
}

// 一覧の並び順どおりに、各ペインのz-indexを振り直す(上の行ほど手前)。
// 併せて▲▼ボタンの有効/無効も更新する(先頭は▲不可・末尾は▼不可)。
function applyLayerOrder() {
  const rows = [...activeList.querySelectorAll(".active-row")];
  const n = rows.length;
  rows.forEach((row, i) => {
    const paneName = layerPanes.get(row.dataset.layerId);
    const pane = paneName ? map.getPane(paneName) : null;
    // 手前(上の行)ほど大きい値。410〜(markerPane=600より小さく収める)
    if (pane) pane.style.zIndex = String(410 + (n - 1 - i) * 2);
    const up = row.querySelector(".order-up");
    const down = row.querySelector(".order-down");
    if (up) up.disabled = i === 0;
    if (down) down.disabled = i === n - 1;
  });
}

// ▲▼で行を1つ上/下へ動かして、重ね順を反映する
function moveActiveRow(row, dir) {
  if (dir < 0) {
    const prev = row.previousElementSibling;
    if (prev && prev.classList.contains("active-row")) activeList.insertBefore(row, prev);
  } else {
    const next = row.nextElementSibling;
    if (next && next.classList.contains("active-row")) activeList.insertBefore(next, row);
  }
  applyLayerOrder();
  saveLayerState();
}

function refreshActiveEmptyNote() {
  const note = activeList.querySelector(".empty-note");
  if (activeLayers.size === 0 && !note) {
    const div = document.createElement("div");
    div.className = "empty-note";
    div.textContent = "(下のカテゴリからレイヤーを選んでください)";
    activeList.appendChild(div);
  } else if (activeLayers.size > 0 && note) {
    note.remove();
  }
}

function registerActiveLayer(id, label, handle) {
  if (activeLayers.has(id)) return;
  ensureLayerPane(id); // 専用ペインを確保しておく(重ね順の変更に使う)

  const row = document.createElement("div");
  row.className = "active-row";
  row.dataset.layerId = id; // 並び順→ペインの対応付けに使う

  // 重ね順を変える▲▼ボタン(▲=手前へ / ▼=奥へ)
  const orderBtns = document.createElement("div");
  orderBtns.className = "order-btns";
  const upBtn = document.createElement("button");
  upBtn.className = "order-btn order-up";
  upBtn.textContent = "▲";
  upBtn.title = "ひとつ手前に移動";
  upBtn.addEventListener("click", () => moveActiveRow(row, -1));
  const downBtn = document.createElement("button");
  downBtn.className = "order-btn order-down";
  downBtn.textContent = "▼";
  downBtn.title = "ひとつ奥に移動";
  downBtn.addEventListener("click", () => moveActiveRow(row, +1));
  orderBtns.appendChild(upBtn);
  orderBtns.appendChild(downBtn);

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = label;
  name.title = label;

  // 透過スライダー。
  //  一番右(100)＝完全に不透明。
  //  初期位置はレイヤーごとの「ちょうどよい濃さ」(handle.defaultOpacity)にする。
  //  例: 用途地域は70%から始まるので、右へ動かせばもっと濃くできる。
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = 0;
  slider.max = 100;
  const startOpacity = handle.defaultOpacity ?? 1;
  slider.value = Math.round(startOpacity * 100);
  slider.title = "透過(右へ動かすほど濃くなる)";
  slider.addEventListener("input", () => {
    handle.setOpacity(slider.value / 100);
    saveLayerState();
  });
  handle.setOpacity(startOpacity); // 初期位置の濃さを地図にも反映しておく

  // 一覧に置いたまま、地図の表示だけを一時的に消すボタン。
  //  ✕ が「一覧から外す」なのに対し、こちらは設定(透過や重ね順)を保ったまま隠す。
  const eyeBtn = document.createElement("button");
  eyeBtn.className = "eye-btn";
  let visible = true;
  function refreshEye() {
    eyeBtn.textContent = visible ? "👁" : "🚫";
    eyeBtn.title = visible ? "地図から一時的に隠す" : "地図に表示する";
    eyeBtn.classList.toggle("is-hidden", !visible);
    row.classList.toggle("row-hidden", !visible);
  }
  eyeBtn.addEventListener("click", () => {
    setVisible(!visible);
    saveLayerState();
  });
  // 保存した状態から戻すときにも使う
  function setVisible(v) {
    visible = v;
    handle.setVisible?.(visible);
    refreshEye();
  }
  refreshEye();

  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-btn";
  removeBtn.textContent = "✕";
  removeBtn.title = "このレイヤーを消す";
  removeBtn.addEventListener("click", () => handle.remove());

  row.appendChild(orderBtns);
  row.appendChild(name);
  row.appendChild(slider);
  row.appendChild(eyeBtn);
  row.appendChild(removeBtn);
  // alwaysOnTop のレイヤー(容積率・建ぺい率の丸印など)は一覧の先頭に入れる。
  // 一覧の上＝地図で手前なので、あとから足しても必ず手前に描かれる。
  if (handle.alwaysOnTop) activeList.insertBefore(row, activeList.firstChild);
  else activeList.appendChild(row);

  // slider と setVisible は、保存した状態を戻すときに使う
  activeLayers.set(id, { row, handle, slider, setVisible });
  refreshActiveEmptyNote();
  applyLayerOrder(); // 追加した行を含めて重ね順とボタンの状態を整える
  saveLayerState();
}

function unregisterActiveLayer(id) {
  const entry = activeLayers.get(id);
  if (!entry) return;
  entry.row.remove();
  activeLayers.delete(id);
  refreshActiveEmptyNote();
  applyLayerOrder(); // 残った行の▲▼の有効/無効を整える
  saveLayerState();
}

// ---- チェックボックス式レイヤー行の共通部品 ----
// makeLayer(paneName) はチェックを入れたときに呼ばれ、
// Leafletレイヤー(またはPromise)を返す。
// paneName … このレイヤー専用の描画面(重ね順の変更に使う)。各レイヤーはこれを
//            pane オプションに渡すことで、専用ペインに描かれるようになる。
// defaultOpacity … 透過スライダーの初期位置(0〜1)。省略すると1(=完全に不透明)。
//                   都市計画図のように「薄く重ねたい」レイヤーだけ指定する。
// options.alwaysOnTop … true にすると「選択中のレイヤー」一覧の先頭に入る(=いちばん手前)。
//                   容積率・建ぺい率の丸印のように、下の色に隠れると困るものに使う。
function buildLayerRow(container, id, label, makeLayer, defaultOpacity, options) {
  const row = document.createElement("label");
  row.className = "layer-row";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  let layer = null;

  // チェックの入切で実際にレイヤーを足したり外したりする処理。
  // 前回の状態を戻すときにも同じ処理を使いたいので、関数として取り出してある
  // （読み込みが終わるまで待てるよう、Promiseを返すようにしている）。
  async function applyCheck() {
    if (checkbox.checked) {
      const paneName = ensureLayerPane(id); // 先に専用ペインを用意する
      try {
        layer = await makeLayer(paneName);
      } catch (e) {
        checkbox.checked = false;
        return;
      }
      if (!checkbox.checked) return; // 読み込み中に外された
      layer.addTo(map);
      registerActiveLayer(id, label, {
        defaultOpacity: defaultOpacity ?? 1,
        alwaysOnTop: !!(options && options.alwaysOnTop),
        // 透過はペインごと(=このレイヤーだけ)の不透明度で調整する。
        // これならタイル・ベクトル・GeoJSONなどレイヤーの種類を問わず同じ方法で効く。
        setOpacity(v) {
          const pane = map.getPane(paneName);
          if (pane) pane.style.opacity = String(v);
        },
        // 一覧に残したまま地図から消す/戻す。
        // CSSで隠すのではなく地図から本当に外すので、
        // クリックしたときの区域名の表示にも隠したレイヤーは出てこない。
        setVisible(v) {
          if (!layer) return;
          if (v) layer.addTo(map);
          else map.removeLayer(layer);
        },
        remove() { checkbox.checked = false; checkbox.dispatchEvent(new Event("change")); },
      });
    } else {
      if (layer) map.removeLayer(layer);
      unregisterActiveLayer(id);
    }
  }

  checkbox.addEventListener("change", applyCheck);
  // 前回の状態を戻すときに、idからこの行を呼び出せるようにしておく
  layerControls.set(id, { checkbox, applyCheck });

  row.appendChild(checkbox);
  row.appendChild(document.createTextNode(label));
  container.appendChild(row);
  return checkbox;
}

// ---- カテゴリ(アコーディオン)の共通部品 ----
const categoriesRoot = document.getElementById("categories");

// open を true にすると、サイトを開いたときから開いた状態になる
function buildCategory(title, open) {
  const details = document.createElement("details");
  details.className = "category";
  if (open) details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = title;
  details.appendChild(summary);
  const body = document.createElement("div");
  body.className = "category-body";
  details.appendChild(body);
  categoriesRoot.appendChild(details);
  return body;
}

function buildSubgroup(container, title, open) {
  const details = document.createElement("details");
  details.className = "subgroup";
  if (open) details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = title;
  details.appendChild(summary);
  const body = document.createElement("div");
  body.className = "subgroup-body";
  details.appendChild(body);
  container.appendChild(details);
  return body;
}

function addSourceNote(container, html) {
  const note = document.createElement("div");
  note.className = "source-note";
  note.innerHTML = html;
  container.appendChild(note);
}

// ============================================================
// 1. 都市計画図 > 熊本県
// このサイトの主役なので先頭に置き、開いた状態で始める。
// 出しておくレイヤー(用途地域と容積率・建ぺい率)は DEFAULT_LAYER_STATE で決めている。
// ============================================================
(function buildToshikeikakuCategory() {
  const body = buildCategory("1. 都市計画図", true);
  const sub = buildSubgroup(body, "熊本県", true);

  // 出典は設定(⚙)の「出典」にまとめている。
  // 地区計画は1地区ずつ出所が違うので、区域をクリックすると吹き出しに出る
  KUMAMOTO_LAYER_DEFS.forEach((def) => {
    buildLayerRow(
      sub,
      `kumamoto-${def.key}`,
      def.label,
      (paneName) => ensureKumamotoLayer(def, paneName),
      def.defaultOpacity // 透過スライダーの初期位置(レイヤーごとのちょうどよい濃さ)
    );

    // 用途地域のすぐ下に、容積率・建ぺい率の丸印の切り替えを置く
    if (def.key === "youto_chiiki") {
      buildLayerRow(
        sub,
        "youto-circles",
        "└ 容積率・建ぺい率",
        (paneName) => createYoutoCircleLayer(paneName),
        1,
        // 用途地域の色の上に重ねないと文字が読めないので、常にいちばん手前に置く
        { alwaysOnTop: true }
      );
      // 丸印の読み方と、公式凡例の注記は右下の凡例のほうに出す
      // （kumamoto.js の YOUTO_LEGEND_NOTES）
    }
  });
})();

// ============================================================
// 2. 新旧の地形図(今昔マップ【谷謙二氏】)
// ============================================================
(function buildKonjakuCategory() {
  const body = buildCategory("2. 新旧の地形図");
  const sub = buildSubgroup(body, "今昔マップ【谷謙二氏】", true);

  addSourceNote(
    sub,
    '時系列地形図閲覧サイト「<a href="https://ktgis.net/kjmapw/index.html" target="_blank">今昔マップ on the web</a>」((C)谷謙二)の地図タイルを表示します。' +
    '利用の際は<a href="https://ktgis.net/kjmapw/note.html" target="_blank">同サイトの規約</a>に従ってください。'
  );

  // 地域を選ぶセレクトボックス(58地域)
  const select = document.createElement("select");
  KONJAKU_REGIONS.forEach((region, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = region.name;
    select.appendChild(opt);
  });
  // 初期選択は熊本(見つからなければ先頭)
  const kumamotoIndex = KONJAKU_REGIONS.findIndex((r) => r.name === "熊本");
  select.value = kumamotoIndex >= 0 ? kumamotoIndex : 0;
  sub.appendChild(select);

  const eraContainer = document.createElement("div");
  sub.appendChild(eraContainer);

  function showRegion(regionIndex) {
    eraContainer.innerHTML = "";
    const region = KONJAKU_REGIONS[regionIndex];
    region.eras.forEach((era, i) => {
      const id = `konjaku-${regionIndex}-${i}`;
      buildLayerRow(eraContainer, id, `${region.name} ${era.era}`, (paneName) =>
        // {-y} が入ったURLはY座標が上下逆(TMS方式)。Leafletはそのまま解釈できる
        L.tileLayer(era.url, {
          minZoom: era.minZoom ?? 8,
          maxNativeZoom: era.maxNativeZoom ?? 16,
          maxZoom: 20,
          pane: paneName,
        })
      );
    });
  }
  select.addEventListener("change", () => showRegion(Number(select.value)));
  showRegion(Number(select.value));
})();

// ============================================================
// 3. 公図・地番図・地名(法務局地図【KotobaMedia】)
// ============================================================
(function buildMojCategory() {
  const body = buildCategory("3. 公図・地番図・地名");

  addSourceNote(
    body,
    "法務局の登記所備付地図(2026年公開)をKotobaMedia社が変換・配信しているベクトルタイルです。" +
    "ズーム16以上に拡大すると地番(土地の番号)の文字も表示されます。"
  );

  // MapLibre(ベクトルタイル)レイヤーを作る。スタイル定義はローカルのJSONファイル
  function makeMojLayer(styleFile, paneName) {
    const layer = L.maplibreGL({
      style: styleFile,
      pane: paneName, // 専用ペインに描く(重ね順の変更に対応)
    });
    return layer;
  }

  buildLayerRow(body, "moj-fill", "2026年 法務局地図(登記所備付地図)", (paneName) =>
    makeMojLayer("moj-style-2026-fill.json", paneName)
  );
  buildLayerRow(body, "moj-line", "└ 塗りつぶしなし(境界線と地番のみ)", (paneName) =>
    makeMojLayer("moj-style-2026-line.json", paneName)
  );
})();

// ============================================================
// 4. 地形(基盤地図情報の標高データから手元で描く)
// ============================================================
(function buildChikeiCategory() {
  const body = buildCategory("4. 地形");

  addSourceNote(
    body,
    "標高タイル(数値データ)をブラウザ内で計算して描く簡易版です。" +
    "DEM1Aは航空レーザ測量による1mメッシュ(Q地図タイル)、DEM5Aは5mメッシュ(地理院)。" +
    "整備されていない地域もあります。"
  );

  const modes = [
    { mode: "redrelief", label: "赤色立体風(簡易)" },
    { mode: "hillshade", label: "陰影起伏図(簡易)" },
    { mode: "slope", label: "傾斜量図(簡易)" },
  ];

  [
    { key: "dem1a", title: "基盤地図情報(標高)1mメッシュ(DEM1A)【Q地図】" },
    { key: "dem5a", title: "基盤地図情報(標高)5mメッシュ(DEM5A)【地理院】" },
  ].forEach(({ key, title }) => {
    const sub = buildSubgroup(body, title, key === "dem1a");
    modes.forEach(({ mode, label }) => {
      buildLayerRow(sub, `dem-${key}-${mode}`, `${label} (${DEM_SOURCES[key].name})`, (paneName) =>
        createDemLayer(key, mode, null, paneName)
      );
    });
  });
})();

// ============================================================
// 5. 年代別の写真(時系列表示)
// ============================================================
(function buildNendaiCategory() {
  const body = buildCategory("5. 年代別の写真");

  addSourceNote(
    body,
    "国土地理院の年代別空中写真(1928年頃〜最新)を、画面下のスライダーで年代を動かしながら見られます。" +
    "ズームレベル14以上で表示されます。緑の点はこの場所で写真がある年代です。"
  );

  const row = document.createElement("label");
  row.className = "layer-row";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      enableTimeseries(() => { checkbox.checked = false; });
    } else {
      disableTimeseries();
    }
  });
  row.appendChild(checkbox);
  row.appendChild(document.createTextNode("時系列表示(ZL14以上で表示)"));
  body.appendChild(row);
})();

// ============================================================
// 6. 標高・土地の凹凸
// ============================================================
(function buildHyokoCategory() {
  const body = buildCategory("6. 標高・土地の凹凸");

  // (a) 地理院の色別標高図(できあいのタイル)
  buildLayerRow(body, "relief", "色別標高図(地理院)", (paneName) =>
    L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/relief/{z}/{x}/{y}.png", {
      minZoom: 5,
      maxNativeZoom: 15,
      maxZoom: 20,
      pane: paneName,
    })
  );

  // (b) 自分で作る色別標高図(標高の範囲と段数を自分で決める)
  const settings = document.createElement("div");
  settings.className = "relief-settings";
  settings.innerHTML = `
    <div class="row"><span>最低標高</span><input type="number" id="relief-min" value="0"> m</div>
    <div class="row"><span>最高標高</span><input type="number" id="relief-max" value="1000"> m</div>
    <div class="row"><span>段数</span><input type="number" id="relief-steps" value="8" min="2" max="30"></div>
    <div class="row"><label><input type="checkbox" id="relief-shading" checked> 陰影を重ねる</label></div>
    <div class="row"><span>データ</span>
      <select id="relief-source">
        <option value="dem10b">自動(全国・10m)</option>
        <option value="dem5a">DEM5A(5m)</option>
        <option value="dem1a">DEM1A(1m・Q地図)</option>
      </select>
    </div>
    <div class="row"><button id="relief-apply">この設定で描き直す</button></div>
  `;

  let customLayer = null;

  function currentParams() {
    return {
      minH: Number(document.getElementById("relief-min").value),
      maxH: Number(document.getElementById("relief-max").value),
      steps: Math.max(2, Number(document.getElementById("relief-steps").value)),
      shading: document.getElementById("relief-shading").checked,
    };
  }

  const checkbox = buildLayerRow(body, "custom-relief", "自分で作る色別標高図", (paneName) => {
    const sourceKey = document.getElementById("relief-source").value;
    customLayer = createDemLayer(sourceKey, "custom", currentParams(), paneName);
    return customLayer;
  });

  body.appendChild(settings);

  // 「描き直す」ボタン: 一度消して新しい設定で作り直す
  settings.querySelector("#relief-apply").addEventListener("click", () => {
    if (!checkbox.checked) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change"));
      return;
    }
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
  });
})();

// ============================================================
// 7. 背景地図(ラジオボタンで1つだけ選ぶ)
// Googleマップは後から(APIの読み込みが済んだら)行を追加するので、
// 行を作る処理を関数として持っておく。
// ============================================================
let baseCategoryBody = null;
const baseRadioByName = {}; // 切り替え失敗時に標準地図へ戻すために覚えておく

function addBaseLayerRow(name) {
  const row = document.createElement("label");
  row.className = "layer-row";
  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = "base-layer";
  radio.checked = name === currentBaseName;
  radio.addEventListener("change", () => {
    if (radio.checked) selectBaseLayer(name);
  });
  baseRadioByName[name] = radio;
  row.appendChild(radio);
  row.appendChild(document.createTextNode(name));
  baseCategoryBody.appendChild(row);
}

(function buildBaseCategory() {
  baseCategoryBody = buildCategory("7. 背景地図");
  Object.keys(BASE_LAYERS).forEach(addBaseLayerRow);
})();

// ---- Googleマップ・Google航空写真の組み込み ----
// Google公式のAPIを読み込み、成功したら背景地図の選択肢に追加する。
// APIキーはGoogle Cloud側でリファラー制限・API制限・割り当て上限を設定済み
// (ブラウザ配布前提の公開可能な値。02都市計画マップと共用)
const GOOGLE_MAPS_API_KEY = "AIzaSyCtL-wwxXA-7Ag6ucXyguE8KH7HZtN9Fjk";

function setUpGoogleBaseLayers() {
  if (!GOOGLE_MAPS_API_KEY || typeof L.gridLayer.googleMutant !== "function") return;

  window.__onGoogleMapsLoaded = () => {
    BASE_LAYERS["Googleマップ"] = L.gridLayer.googleMutant({ type: "roadmap", maxZoom: 20 });
    BASE_LAYERS["Google航空写真"] = L.gridLayer.googleMutant({ type: "hybrid", maxZoom: 20 });
    addBaseLayerRow("Googleマップ");
    addBaseLayerRow("Google航空写真");
  };

  // 認証エラー(キーの制限にこのサイトが含まれていない等)のときは
  // 地図が真っ白になるのを防ぐため標準地図に戻す
  window.gm_authFailure = () => {
    showToast("Googleマップを利用できません(APIキーの設定を確認してください)");
    const radio = baseRadioByName["標準地図"];
    if (radio && !radio.checked) {
      radio.checked = true;
      radio.dispatchEvent(new Event("change"));
    }
  };

  const script = document.createElement("script");
  script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&loading=async&callback=__onGoogleMapsLoaded`;
  script.async = true;
  script.onerror = () => {
    console.warn("Google Maps APIの読み込みに失敗しました");
  };
  document.head.appendChild(script);
}
setUpGoogleBaseLayers();

// ============================================================
// 設定画面(⚙ボタン)
// ------------------------------------------------------------
// 開くたびに中身を作り直す。どの種別があるかは
// レイヤーを読み込んで初めて分かるため、その時点の状態で並べ直す。
// ============================================================
const settingsOverlay = document.getElementById("settings-overlay");
const settingsColors = document.getElementById("settings-colors");

function openSettings() {
  buildKumamotoColorSettings(settingsColors);
  settingsOverlay.classList.remove("hidden");
}

function closeSettings() {
  settingsOverlay.classList.add("hidden");
}

document.getElementById("settings-open").addEventListener("click", openSettings);
document.getElementById("settings-close").addEventListener("click", closeSettings);

// 背景の暗いところをクリックしても閉じる(中身のクリックでは閉じない)
settingsOverlay.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) closeSettings();
});

// Escキーでも閉じられるようにする
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !settingsOverlay.classList.contains("hidden")) closeSettings();
});

document.getElementById("settings-reset").addEventListener("click", () => {
  resetKumamotoColors();
  buildKumamotoColorSettings(settingsColors); // 色見本を選び直した状態に更新する
});

// ============================================================
// サイドパネルの開閉
// ============================================================
const sidebar = document.getElementById("sidebar");
const openBtn = document.getElementById("sidebar-open");
document.getElementById("sidebar-close").addEventListener("click", () => {
  sidebar.classList.add("hidden");
  openBtn.style.display = "block";
  map.invalidateSize(); // 地図の幅が変わったことをLeafletに伝える
});
openBtn.addEventListener("click", () => {
  sidebar.classList.remove("hidden");
  openBtn.style.display = "none";
  map.invalidateSize();
});

// ============================================================
// 一時的な通知(トースト)
// ============================================================
let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4000);
}

// ============================================================
// 住所・地名検索(国土地理院の住所検索API。無料・キー不要)
// ============================================================
const searchInput = document.getElementById("search-input");
const searchBtn = document.getElementById("search-btn");
const searchClearBtn = document.getElementById("search-clear");
const searchResults = document.getElementById("search-results");
let searchMarker = null;

// 地図に立てたピンを消す
function removeSearchMarker() {
  if (searchMarker) {
    searchMarker.remove();
    searchMarker = null;
  }
}

// 入力・検索結果・ピンをまとめて消す(✕ボタン)
function clearSearch() {
  searchInput.value = "";
  searchResults.innerHTML = "";
  searchResults.classList.add("hidden");
  removeSearchMarker();
  refreshSearchClearButton();
  searchInput.focus();
}

// 消すものが何も無いときは✕を隠しておく
function refreshSearchClearButton() {
  const hasSomething =
    searchInput.value !== "" ||
    searchMarker !== null ||
    !searchResults.classList.contains("hidden");
  searchClearBtn.classList.toggle("hidden", !hasSomething);
}

async function gsiSearch(query) {
  const res = await fetch(
    `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = await res.json();
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const [lng, lat] = item.geometry.coordinates;
    return { title: item.properties.title, lat, lng };
  });
}

function renderSearchResults(items) {
  if (items.length === 0) {
    searchResults.innerHTML = "<div class='search-result-item'>見つかりませんでした</div>";
    return;
  }
  searchResults.innerHTML = "";
  items.slice(0, 8).forEach((item) => {
    const div = document.createElement("div");
    div.className = "search-result-item selectable";
    div.textContent = item.title;
    div.addEventListener("click", () => {
      map.flyTo([item.lat, item.lng], 15);
      removeSearchMarker();
      searchMarker = L.marker([item.lat, item.lng]).addTo(map).bindPopup(item.title);
      searchResults.classList.add("hidden");
      refreshSearchClearButton();
    });
    searchResults.appendChild(div);
  });
}

async function doSearch() {
  const query = searchInput.value.trim();
  // 何も入れずに検索したときは、前に立てたピンを消して終わり
  if (!query) {
    searchResults.innerHTML = "";
    searchResults.classList.add("hidden");
    removeSearchMarker();
    refreshSearchClearButton();
    return;
  }
  searchResults.innerHTML = "<div class='search-result-item'>検索中…</div>";
  searchResults.classList.remove("hidden");
  refreshSearchClearButton();
  try {
    renderSearchResults(await gsiSearch(query));
  } catch (err) {
    searchResults.classList.add("hidden");
    showToast("検索に失敗しました(通信状態を確認してください)");
  }
  refreshSearchClearButton();
}

searchBtn.addEventListener("click", doSearch);
searchClearBtn.addEventListener("click", clearSearch);
searchInput.addEventListener("input", refreshSearchClearButton);
searchInput.addEventListener("keydown", (e) => {
  // 環境によりEnterキーの名前が違うことがあるため両方見る
  if (e.key === "Enter" || e.keyCode === 13) doSearch();
});
refreshSearchClearButton();

// ============================================================
// 現在地ボタン(ブラウザの位置情報APIを使用)
// ============================================================
let locationMarker = null;
let locationCircle = null;

const LocateControl = L.Control.extend({
  onAdd() {
    const btn = L.DomUtil.create("button", "locate-btn");
    btn.type = "button";
    btn.textContent = "📍 現在地";
    btn.title = "現在地を表示";
    L.DomEvent.disableClickPropagation(btn);
    btn.addEventListener("click", () => {
      map.locate({ setView: true, maxZoom: 16 });
    });
    return btn;
  },
});
new LocateControl({ position: "bottomright" }).addTo(map);

map.on("locationfound", (e) => {
  if (locationMarker) locationMarker.remove();
  if (locationCircle) locationCircle.remove();
  locationMarker = L.marker(e.latlng).addTo(map).bindPopup("現在地");
  // 位置情報の誤差の範囲を円で示す
  locationCircle = L.circle(e.latlng, {
    radius: e.accuracy,
    color: "#4285f4",
    fillColor: "#4285f4",
    fillOpacity: 0.15,
    weight: 1,
  }).addTo(map);
});

map.on("locationerror", () => {
  showToast("現在地を取得できませんでした(位置情報の許可を確認してください)");
});

// ============================================================
// ステータス表示・クリック・表示位置の保存
// ============================================================
const statusBar = document.getElementById("status-bar");
function updateStatusBar() {
  const c = map.getCenter();
  statusBar.textContent =
    `中心: 緯度 ${c.lat.toFixed(5)} / 経度 ${c.lng.toFixed(5)} ズーム: ${map.getZoom()}`;
}

map.on("moveend", () => {
  updateStatusBar();
  const c = map.getCenter();
  localStorage.setItem(
    VIEW_STORAGE_KEY,
    JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom() })
  );
});

map.on("click", (e) => {
  searchResults.classList.add("hidden"); // 地図をクリックしたら検索結果を閉じる
  const lat = e.latlng.lat.toFixed(6);
  const lng = e.latlng.lng.toFixed(6);
  // 表示中の都市計画レイヤーに当たっていれば、その区域のデータを全部出す
  const matchHtml = kumamotoPopupHtml(kumamotoMatchesAt(map, e.latlng));
  L.popup({ maxWidth: 330 })
    .setLatLng(e.latlng)
    .setContent(
      `<div class="map-popup">` +
      matchHtml +
      `<div class="popup-latlng">緯度: ${lat}<br>経度: ${lng}<br>` +
      `<a href="https://maps.gsi.go.jp/#16/${lat}/${lng}" target="_blank">地理院地図で開く</a></div>` +
      `</div>`
    )
    .openOn(map);
});

initTimeseries(map);
initKumamotoLegend(map); // 都市計画図の凡例(右下)
updateStatusBar();
refreshActiveEmptyNote();

// 前回選んでいたレイヤーと背景地図を戻す(初回は用途地域＋容積率建ぺい率)。
// カテゴリをすべて作り終えたあとに呼ぶ必要があるので、いちばん最後に置いている
restoreLayerState();
