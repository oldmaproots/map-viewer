// ============================================================
// 年代別写真の時系列表示(ズームレベル14以上で有効)。
// 地理院地図の「年代別の写真 > 時系列表示」に相当する機能。
//
// 同じ場所でも年代によって写真がある/ないが違うため、
// 画面中央のタイルを各年代について試しに読み込んで、
// 「この場所で見られる年代」をスライダーの下に点(●)で示す。
// ============================================================

// 古い順に並べた年代のリスト(出典はすべて国土地理院)
const TIMESERIES_ERAS = [
  { label: "1928年頃", url: "https://maps.gsi.go.jp/xyz/ort_1928/{z}/{x}/{y}.png", native: 17 },
  { label: "1936〜1942年頃", url: "https://maps.gsi.go.jp/xyz/ort_riku10/{z}/{x}/{y}.png", native: 17 },
  { label: "1945〜1950年", url: "https://maps.gsi.go.jp/xyz/ort_USA10/{z}/{x}/{y}.png", native: 17 },
  { label: "1961〜1969年", url: "https://maps.gsi.go.jp/xyz/ort_old10/{z}/{x}/{y}.png", native: 17 },
  { label: "1974〜1978年", url: "https://maps.gsi.go.jp/xyz/gazo1/{z}/{x}/{y}.jpg", native: 17 },
  { label: "1979〜1983年", url: "https://maps.gsi.go.jp/xyz/gazo2/{z}/{x}/{y}.jpg", native: 17 },
  { label: "1984〜1986年", url: "https://maps.gsi.go.jp/xyz/gazo3/{z}/{x}/{y}.jpg", native: 17 },
  { label: "1987〜1990年", url: "https://maps.gsi.go.jp/xyz/gazo4/{z}/{x}/{y}.jpg", native: 17 },
  { label: "2004年〜(簡易空中写真)", url: "https://maps.gsi.go.jp/xyz/airphoto/{z}/{x}/{y}.png", native: 18 },
  // 2007年度以降は1年度ごとのタイルがある
  ...Array.from({ length: 18 }, (_, k) => {
    const year = 2007 + k;
    return {
      label: `${year}年度`,
      url: `https://maps.gsi.go.jp/xyz/nendophoto${year}/{z}/{x}/{y}.png`,
      native: 18,
    };
  }),
  { label: "最新(シームレス)", url: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", native: 18 },
];

const GSI_PHOTO_ATTRIBUTION =
  '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>';

// ---- 状態 ----
let tsMap = null;            // Leafletの地図(initTimeseriesで受け取る)
let tsLayer = null;          // 現在表示中の写真レイヤー
let tsIndex = TIMESERIES_ERAS.length - 1; // 選択中の年代(最初は最新)
let tsEnabled = false;
let tsOpacity = 1;
let tsAvailability = [];     // 各年代がこの場所で見られるか(true/false/null=未確認)
let tsCheckTimer = null;
let tsOnRemoved = null;      // ✕で消されたときにチェックボックスを戻すための関数

const tsPanel = document.getElementById("timeseries-panel");
const tsSlider = document.getElementById("timeseries-slider");
const tsLabel = document.getElementById("timeseries-label");
const tsDots = document.getElementById("timeseries-dots");
const tsNote = document.getElementById("timeseries-note");

// ---- 表示の更新 ----
function tsUpdateLabel() {
  const era = TIMESERIES_ERAS[tsIndex];
  const avail = tsAvailability[tsIndex];
  tsLabel.innerHTML =
    era.label +
    (avail === false ? ' <span class="no-photo">(この場所の写真なし)</span>' : "");
}

function tsUpdateDots() {
  tsDots.innerHTML = "";
  TIMESERIES_ERAS.forEach((era, i) => {
    const dot = document.createElement("span");
    if (tsAvailability[i]) dot.classList.add("available");
    if (i === tsIndex) dot.classList.add("current");
    dot.title = era.label;
    tsDots.appendChild(dot);
  });
}

function tsShowLayer() {
  if (tsLayer) {
    tsMap.removeLayer(tsLayer);
    tsLayer = null;
  }
  if (!tsEnabled) return;
  const era = TIMESERIES_ERAS[tsIndex];
  tsLayer = L.tileLayer(era.url, {
    minZoom: 14,                 // ZL14以上でのみ表示(本家と同じ)
    maxNativeZoom: era.native,
    maxZoom: 20,
    opacity: tsOpacity,
    attribution: GSI_PHOTO_ATTRIBUTION,
  });
  tsLayer.addTo(tsMap);
  tsUpdateLabel();
  tsUpdateDots();
}

// ---- この場所で見られる年代の確認 ----
// 画面中央のタイル1枚を各年代について読み込んでみる(404なら写真なし)
function tsCheckAvailability() {
  if (!tsEnabled || tsMap.getZoom() < 14) return;
  const z = Math.min(tsMap.getZoom(), 17);
  const center = tsMap.getCenter();
  const n = Math.pow(2, z);
  const x = Math.floor(((center.lng + 180) / 360) * n);
  const latRad = (center.lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );

  TIMESERIES_ERAS.forEach((era, i) => {
    const zz = Math.min(z, era.native);
    const scale = Math.pow(2, z - zz);
    const url = era.url
      .replace("{z}", zz)
      .replace("{x}", Math.floor(x / scale))
      .replace("{y}", Math.floor(y / scale));
    const img = new Image();
    img.onload = () => {
      tsAvailability[i] = true;
      tsUpdateDots();
      if (i === tsIndex) tsUpdateLabel();
    };
    img.onerror = () => {
      tsAvailability[i] = false;
      tsUpdateDots();
      if (i === tsIndex) tsUpdateLabel();
    };
    img.src = url;
  });
}

function tsScheduleCheck() {
  clearTimeout(tsCheckTimer);
  tsCheckTimer = setTimeout(tsCheckAvailability, 600); // 動かし終わって0.6秒後に確認
}

function tsUpdateZoomNote() {
  if (!tsEnabled) return;
  tsNote.textContent =
    tsMap.getZoom() < 14 ? "ズームレベル14以上に拡大すると写真が表示されます" : "";
}

// ---- 有効化/無効化(script.jsから呼ぶ) ----
function enableTimeseries(onRemoved) {
  tsEnabled = true;
  tsOnRemoved = onRemoved;
  tsAvailability = TIMESERIES_ERAS.map(() => null);
  tsPanel.classList.add("visible");
  tsSlider.max = TIMESERIES_ERAS.length - 1;
  tsSlider.value = tsIndex;
  tsShowLayer();
  tsUpdateZoomNote();
  tsScheduleCheck();

  // 選択中レイヤー一覧に登録(透過スライダーと✕を使えるように)
  registerActiveLayer("timeseries", "年代別写真(時系列)", {
    setOpacity(v) {
      tsOpacity = v;
      if (tsLayer) tsLayer.setOpacity(v);
    },
    remove() {
      disableTimeseries();
      if (tsOnRemoved) tsOnRemoved();
    },
  });
}

function disableTimeseries() {
  tsEnabled = false;
  tsPanel.classList.remove("visible");
  if (tsLayer) {
    tsMap.removeLayer(tsLayer);
    tsLayer = null;
  }
  unregisterActiveLayer("timeseries");
}

// ---- 初期化(script.jsの最後で呼ばれる) ----
function initTimeseries(map) {
  tsMap = map;
  tsSlider.addEventListener("input", () => {
    tsIndex = Number(tsSlider.value);
    tsShowLayer();
  });
  map.on("moveend", () => {
    tsUpdateZoomNote();
    tsScheduleCheck();
  });
}
