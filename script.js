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

const GSI_ATTRIBUTION =
  '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>';
const KONJAKU_ATTRIBUTION =
  '<a href="https://ktgis.net/kjmapw/index.html" target="_blank">今昔マップ on the web ((C)谷謙二)</a>';
const MOJ_ATTRIBUTION =
  '<a href="https://tiles.kmproj.com/" target="_blank">KotobaMedia</a>(<a href="https://www.moj.go.jp/MINJI/minji05_00494.html" target="_blank">法務省 登記所備付地図データ</a>)';

// ---- 前回見ていた場所を復元(初回は熊本周辺) ----
function loadLastView() {
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_STORAGE_KEY));
    if (saved && typeof saved.lat === "number") return saved;
  } catch (e) { /* 壊れていたら初期値 */ }
  return { lat: 32.79, lng: 130.74, zoom: 10 };
}
const lastView = loadLastView();

const map = L.map("map", {
  center: [lastView.lat, lastView.lng],
  zoom: lastView.zoom,
  maxZoom: 20, // 法務局地図(地番)は20まで拡大できる
});

L.control.scale({ imperial: false }).addTo(map);

// ============================================================
// 背景地図(どれか1つを選ぶ)
// ============================================================
const BASE_LAYERS = {
  標準地図: L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", {
    attribution: GSI_ATTRIBUTION, maxNativeZoom: 18, maxZoom: 20,
  }),
  淡色地図: L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", {
    attribution: GSI_ATTRIBUTION, maxNativeZoom: 18, maxZoom: 20,
  }),
  白地図: L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png", {
    attribution: GSI_ATTRIBUTION, maxNativeZoom: 14, maxZoom: 20,
  }),
  "空中写真(最新)": L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", {
    attribution: GSI_ATTRIBUTION, maxNativeZoom: 18, maxZoom: 20,
  }),
};
let currentBase = BASE_LAYERS["標準地図"];
currentBase.addTo(map);

// ============================================================
// 選択中のレイヤー一覧(透過スライダー付き)
// registerActiveLayer / unregisterActiveLayer は他のファイルからも呼ばれる
// ============================================================
const activeList = document.getElementById("active-layers-list");
const activeLayers = new Map(); // id -> { row, handle }

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

  const row = document.createElement("div");
  row.className = "active-row";

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = label;
  name.title = label;

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = 0;
  slider.max = 100;
  slider.value = 100;
  slider.title = "透過(不透明度)";
  slider.addEventListener("input", () => handle.setOpacity(slider.value / 100));

  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-btn";
  removeBtn.textContent = "✕";
  removeBtn.title = "このレイヤーを消す";
  removeBtn.addEventListener("click", () => handle.remove());

  row.appendChild(name);
  row.appendChild(slider);
  row.appendChild(removeBtn);
  activeList.appendChild(row);

  activeLayers.set(id, { row, handle });
  refreshActiveEmptyNote();
}

function unregisterActiveLayer(id) {
  const entry = activeLayers.get(id);
  if (!entry) return;
  entry.row.remove();
  activeLayers.delete(id);
  refreshActiveEmptyNote();
}

// ---- チェックボックス式レイヤー行の共通部品 ----
// makeLayer() はチェックを入れたときに呼ばれ、Leafletレイヤー(またはPromise)を返す
function buildLayerRow(container, id, label, makeLayer) {
  const row = document.createElement("label");
  row.className = "layer-row";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  let layer = null;

  checkbox.addEventListener("change", async () => {
    if (checkbox.checked) {
      try {
        layer = await makeLayer();
      } catch (e) {
        checkbox.checked = false;
        return;
      }
      if (!checkbox.checked) return; // 読み込み中に外された
      layer.addTo(map);
      registerActiveLayer(id, label, {
        setOpacity(v) { setLayerOpacity(layer, v); },
        remove() { checkbox.checked = false; checkbox.dispatchEvent(new Event("change")); },
      });
    } else {
      if (layer) map.removeLayer(layer);
      unregisterActiveLayer(id);
    }
  });

  row.appendChild(checkbox);
  row.appendChild(document.createTextNode(label));
  container.appendChild(row);
  return checkbox;
}

// レイヤーの種類ごとに透過(不透明度)の設定方法が違うのを吸収する
function setLayerOpacity(layer, v) {
  if (typeof layer.setOpacity === "function") {
    layer.setOpacity(v);                          // タイルレイヤー
  } else if (layer._container) {
    layer._container.style.opacity = v;           // MapLibre(ベクトル)レイヤー
  } else if (typeof layer.setStyle === "function") {
    layer.setStyle({ opacity: v, fillOpacity: v * 0.4 }); // GeoJSONレイヤー
  }
}

// ---- カテゴリ(アコーディオン)の共通部品 ----
const categoriesRoot = document.getElementById("categories");

function buildCategory(title) {
  const details = document.createElement("details");
  details.className = "category";
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
// 1. 新旧の地形図(今昔マップ【谷謙二氏】)
// ============================================================
(function buildKonjakuCategory() {
  const body = buildCategory("1. 新旧の地形図");
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
      buildLayerRow(eraContainer, id, `${region.name} ${era.era}`, () =>
        // {-y} が入ったURLはY座標が上下逆(TMS方式)。Leafletはそのまま解釈できる
        L.tileLayer(era.url, {
          minZoom: era.minZoom ?? 8,
          maxNativeZoom: era.maxNativeZoom ?? 16,
          maxZoom: 20,
          attribution: KONJAKU_ATTRIBUTION,
        })
      );
    });
  }
  select.addEventListener("change", () => showRegion(Number(select.value)));
  showRegion(Number(select.value));
})();

// ============================================================
// 2. 公図・地番図・地名(法務局地図【KotobaMedia】)
// ============================================================
(function buildMojCategory() {
  const body = buildCategory("2. 公図・地番図・地名");

  addSourceNote(
    body,
    "法務局の登記所備付地図(2026年公開)をKotobaMedia社が変換・配信しているベクトルタイルです。" +
    "ズーム16以上に拡大すると地番(土地の番号)の文字も表示されます。"
  );

  // MapLibre(ベクトルタイル)レイヤーを作る。スタイル定義はローカルのJSONファイル
  function makeMojLayer(styleFile) {
    const layer = L.maplibreGL({
      style: styleFile,
      attribution: MOJ_ATTRIBUTION,
      pane: "overlayPane",
    });
    return layer;
  }

  buildLayerRow(body, "moj-fill", "2026年 法務局地図(登記所備付地図)", () =>
    makeMojLayer("moj-style-2026-fill.json")
  );
  buildLayerRow(body, "moj-line", "└ 塗りつぶしなし(境界線と地番のみ)", () =>
    makeMojLayer("moj-style-2026-line.json")
  );
})();

// ============================================================
// 3. 地形(基盤地図情報の標高データから手元で描く)
// ============================================================
(function buildChikeiCategory() {
  const body = buildCategory("3. 地形");

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
      buildLayerRow(sub, `dem-${key}-${mode}`, `${label} (${DEM_SOURCES[key].name})`, () =>
        createDemLayer(key, mode)
      );
    });
  });
})();

// ============================================================
// 4. 年代別の写真(時系列表示)
// ============================================================
(function buildNendaiCategory() {
  const body = buildCategory("4. 年代別の写真");

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
// 5. 標高・土地の凹凸
// ============================================================
(function buildHyokoCategory() {
  const body = buildCategory("5. 標高・土地の凹凸");

  // (a) 地理院の色別標高図(できあいのタイル)
  buildLayerRow(body, "relief", "色別標高図(地理院)", () =>
    L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/relief/{z}/{x}/{y}.png", {
      minZoom: 5,
      maxNativeZoom: 15,
      maxZoom: 20,
      attribution: GSI_ATTRIBUTION,
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

  const checkbox = buildLayerRow(body, "custom-relief", "自分で作る色別標高図", () => {
    const sourceKey = document.getElementById("relief-source").value;
    customLayer = createDemLayer(sourceKey, "custom", currentParams());
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
// 6. 都市計画図 > 熊本県
// ============================================================
(function buildToshikeikakuCategory() {
  const body = buildCategory("6. 都市計画図");
  const sub = buildSubgroup(body, "熊本県", true);

  addSourceNote(
    sub,
    '<a href="https://nlftp.mlit.go.jp/ksj/" target="_blank">国土数値情報(国土交通省)</a>の都市計画決定情報を加工して作成。' +
    "表示中に地図をクリックすると、その地点の区域名を表示します。"
  );

  KUMAMOTO_LAYER_DEFS.forEach((def) => {
    buildLayerRow(sub, `kumamoto-${def.key}`, def.label, () => ensureKumamotoLayer(def));
  });
})();

// ============================================================
// 7. 背景地図(ラジオボタンで1つだけ選ぶ)
// ============================================================
(function buildBaseCategory() {
  const body = buildCategory("7. 背景地図");
  Object.keys(BASE_LAYERS).forEach((name) => {
    const row = document.createElement("label");
    row.className = "layer-row";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "base-layer";
    radio.checked = name === "標準地図";
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      map.removeLayer(currentBase);
      currentBase = BASE_LAYERS[name];
      currentBase.addTo(map);
    });
    row.appendChild(radio);
    row.appendChild(document.createTextNode(name));
    body.appendChild(row);
  });
})();

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
const searchResults = document.getElementById("search-results");
let searchMarker = null;

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
      if (searchMarker) searchMarker.remove();
      searchMarker = L.marker([item.lat, item.lng]).addTo(map).bindPopup(item.title);
      searchResults.classList.add("hidden");
    });
    searchResults.appendChild(div);
  });
}

async function doSearch() {
  const query = searchInput.value.trim();
  if (!query) return;
  searchResults.innerHTML = "<div class='search-result-item'>検索中…</div>";
  searchResults.classList.remove("hidden");
  try {
    renderSearchResults(await gsiSearch(query));
  } catch (err) {
    searchResults.classList.add("hidden");
    showToast("検索に失敗しました(通信状態を確認してください)");
  }
}

searchBtn.addEventListener("click", doSearch);
searchInput.addEventListener("keydown", (e) => {
  // 環境によりEnterキーの名前が違うことがあるため両方見る
  if (e.key === "Enter" || e.keyCode === 13) doSearch();
});

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
  // 表示中の都市計画レイヤーに当たっていれば区域名も出す
  const matches = kumamotoMatchesAt(map, e.latlng);
  const matchHtml = matches.length
    ? `<div style="margin-bottom:4px">${matches.map((m) => `・${m}`).join("<br>")}</div>`
    : "";
  L.popup()
    .setLatLng(e.latlng)
    .setContent(
      matchHtml +
      `緯度: ${lat}<br>経度: ${lng}<br>` +
      `<a href="https://maps.gsi.go.jp/#16/${lat}/${lng}" target="_blank">地理院地図で開く</a>`
    )
    .openOn(map);
});

initTimeseries(map);
initKumamotoLegend(map); // 都市計画図の凡例(右下)
updateStatusBar();
refreshActiveEmptyNote();
