/// <reference types="@open-pets/plugin-sdk" />

export const SCHEDULE_ID = "system-resources-tick";
export const ALERT_COOLDOWN_MS = 10 * 60_000;
export const DEFAULT_POLL_SECONDS = 10;
export const DEFAULT_ALERT_PERCENT = 90;
export const DEFAULT_LANGUAGE = "auto";
export const SUSTAINED_ALERT_SAMPLES = 2;
export const METRIC_KEYS = ["cpu", "ram", "gpu", "disk"];
const MAX_SCHEDULE_REGISTRATION_ATTEMPTS = 2;
const INACTIVE_BUBBLE_ERROR = "Plugin bubble is no longer live.";

const METRIC_DEFINITIONS = [
  { key: "cpu", showKey: "showCpu", alertKey: "alertCpu", sustained: true },
  { key: "ram", showKey: "showRam", alertKey: "alertRam", sustained: false },
  { key: "gpu", showKey: "showGpu", alertKey: "alertGpu", sustained: true },
  { key: "disk", showKey: "showDisk", alertKey: "alertDisk", sustained: false },
];

export const CATALOGS = {
  en: {
    "plugin.name": "System Resources",
    "plugin.description": "Show live CPU and RAM meters, plus optional GPU and Disk metrics, on your pet.",
    "hud.cpu": "CPU",
    "hud.ram": "RAM",
    "hud.gpu": "GPU",
    "hud.disk": "Disk",
    "metric.cpu": "CPU usage",
    "metric.ram": "RAM usage",
    "metric.gpu": "GPU usage",
    "metric.disk": "Disk capacity",
    "metric.battery": "Battery",
    "battery.charging": "charging",
    "battery.notCharging": "not charging",
    "value.na": "—",
    "value.stale": "stale",
    "config.showHud.label": "Show resource HUD",
    "config.showHud.description": "Keep a compact CPU and RAM overlay on your pet.",
    "config.showCpu.label": "Show CPU",
    "config.showCpu.description": "Include CPU usage in the pinned HUD.",
    "config.showRam.label": "Show RAM",
    "config.showRam.description": "Include RAM usage in the pinned HUD.",
    "config.showGpu.label": "Show GPU",
    "config.showGpu.description": "Include GPU usage when the host provides it.",
    "config.showDisk.label": "Show Disk",
    "config.showDisk.description": "Include used system-volume capacity when the host provides it.",
    "config.showBattery.label": "Show Battery",
    "config.showBattery.description": "Include battery percentage and charging state in status and speech when available.",
    "config.showNetwork.label": "Show Network",
    "config.showNetwork.description": "Include download and upload rates in status and speech when available.",
    "config.pollSeconds.label": "Refresh interval (seconds)",
    "config.pollSeconds.description": "How often to sample host CPU and RAM metrics.",
    "config.alertPercent.label": "Alert threshold (%)",
    "config.alertPercent.description": "Speak when an enabled meter reaches this value; CPU and GPU require two readings.",
    "config.alertCpu.label": "Alert on CPU usage",
    "config.alertCpu.description": "Require two consecutive high CPU readings before speaking.",
    "config.alertRam.label": "Alert on RAM usage",
    "config.alertRam.description": "Alert on high RAM usage. This does not measure memory pressure.",
    "config.alertGpu.label": "Alert on GPU usage",
    "config.alertGpu.description": "Require two consecutive high GPU readings before speaking.",
    "config.alertDisk.label": "Alert on disk capacity",
    "config.alertDisk.description": "Alert when used system-volume capacity reaches the threshold.",
    "config.speakAlerts.label": "Speak on high load",
    "config.speakAlerts.description": "Let the pet call out when a meter crosses the alert threshold.",
    "config.language.label": "Language",
    "config.language.description": "Language for meters, status, and pet speech.",
    "config.language.auto": "Automatic (OpenPets)",
    "config.language.nl": "Nederlands",
    "config.language.en": "English",
    "config.language.fr": "Français",
    "config.language.de": "Deutsch",
    "command.show.title": "Show resource HUD",
    "command.show.description": "Show the live CPU, RAM, GPU, and disk meters on the pet.",
    "command.hide.title": "Hide resource HUD",
    "command.hide.description": "Hide the resource meters on the pet.",
    "command.snapshot.title": "Read resources",
    "command.snapshot.description": "Have the pet read the current CPU and RAM levels.",
    "speech.snapshot": "CPU {cpu}, RAM {ram}.",
    "speech.snapshotFull": "CPU {cpu}, RAM {ram}, GPU {gpu}, Disk {disk}.",
    "speech.battery": "Battery {percent} percent ({state}).",
    "speech.network": "Network download {download} and upload {upload}.",
    "speech.stale": "The last valid reading is stale.",
    "speech.unavailable": "Resource metrics are unavailable.",
    "speech.alert": "{label} is at {value} percent.",
    "status.line": "CPU {cpu} · RAM {ram}",
    "status.lineFull": "CPU {cpu} · RAM {ram} · GPU {gpu} · Disk {disk}",
    "status.network": "Network ↓ {download} · ↑ {upload}",
    "status.stale": "Last valid reading: {details} · stale",
    "status.unavailable": "Resource metrics unavailable",
  },
  nl: {
    "plugin.name": "Systeembronnen",
    "plugin.description": "Toon live CPU- en RAM-meters en optionele GPU- en schijfmetingen op je pet.",
    "hud.cpu": "CPU",
    "hud.ram": "RAM",
    "hud.gpu": "GPU",
    "hud.disk": "Schijf",
    "metric.cpu": "CPU-gebruik",
    "metric.ram": "RAM-gebruik",
    "metric.gpu": "GPU-gebruik",
    "metric.disk": "Schijfcapaciteit",
    "metric.battery": "Batterij",
    "battery.charging": "wordt opgeladen",
    "battery.notCharging": "niet aan het opladen",
    "value.na": "—",
    "value.stale": "verouderd",
    "config.showHud.label": "Toon bronnen-HUD",
    "config.showHud.description": "Houd een compact CPU- en RAM-overzicht op de pet.",
    "config.showCpu.label": "Toon CPU",
    "config.showCpu.description": "Neem CPU-gebruik op in de vastgezette HUD.",
    "config.showRam.label": "Toon RAM",
    "config.showRam.description": "Neem RAM-gebruik op in de vastgezette HUD.",
    "config.showGpu.label": "Toon GPU",
    "config.showGpu.description": "Neem GPU-gebruik op als de host dit levert.",
    "config.showDisk.label": "Toon schijf",
    "config.showDisk.description": "Neem gebruikte systeemvolumecapaciteit op als de host dit levert.",
    "config.showBattery.label": "Toon batterij",
    "config.showBattery.description": "Neem batterijpercentage en laadstatus op in status en spraak als die beschikbaar zijn.",
    "config.showNetwork.label": "Toon netwerk",
    "config.showNetwork.description": "Neem download- en uploadsnelheden op in status en spraak als die beschikbaar zijn.",
    "config.pollSeconds.label": "Verversinterval (seconden)",
    "config.pollSeconds.description": "Hoe vaak host-CPU en -RAM worden bemonsterd.",
    "config.alertPercent.label": "Drempel voor melding (%)",
    "config.alertPercent.description": "Spreek als een ingeschakelde meter deze waarde bereikt; CPU en GPU vereisen twee metingen.",
    "config.alertCpu.label": "Melding bij CPU-gebruik",
    "config.alertCpu.description": "Spreek pas na twee opeenvolgende hoge CPU-metingen.",
    "config.alertRam.label": "Melding bij RAM-gebruik",
    "config.alertRam.description": "Meld hoog RAM-gebruik. Dit meet geen geheugendruk.",
    "config.alertGpu.label": "Melding bij GPU-gebruik",
    "config.alertGpu.description": "Spreek pas na twee opeenvolgende hoge GPU-metingen.",
    "config.alertDisk.label": "Melding bij schijfcapaciteit",
    "config.alertDisk.description": "Meld wanneer de gebruikte systeemvolumecapaciteit de drempel bereikt.",
    "config.speakAlerts.label": "Spreek bij hoge belasting",
    "config.speakAlerts.description": "Laat de pet waarschuwen als een meter de drempel overschrijdt.",
    "config.language.label": "Taal",
    "config.language.description": "Taal voor meters, status en pet-spraak.",
    "config.language.auto": "Automatisch (OpenPets)",
    "config.language.nl": "Nederlands",
    "config.language.en": "English",
    "config.language.fr": "Français",
    "config.language.de": "Deutsch",
    "command.show.title": "Toon bronnen-HUD",
    "command.show.description": "Toon de live CPU-, RAM-, GPU- en schijfmeters op de pet.",
    "command.hide.title": "Verberg bronnen-HUD",
    "command.hide.description": "Verberg de bronnenmeters op de pet.",
    "command.snapshot.title": "Lees bronnen",
    "command.snapshot.description": "Laat de pet de huidige CPU en RAM voorlezen.",
    "speech.snapshot": "CPU {cpu}, RAM {ram}.",
    "speech.snapshotFull": "CPU {cpu}, RAM {ram}, GPU {gpu}, schijf {disk}.",
    "speech.battery": "Batterij {percent} procent ({state}).",
    "speech.network": "Netwerkdownload {download} en upload {upload}.",
    "speech.stale": "De laatste geldige meting is verouderd.",
    "speech.unavailable": "Bronmetingen zijn niet beschikbaar.",
    "speech.alert": "{label} staat op {value} procent.",
    "status.line": "CPU {cpu} · RAM {ram}",
    "status.lineFull": "CPU {cpu} · RAM {ram} · GPU {gpu} · Schijf {disk}",
    "status.network": "Netwerk ↓ {download} · ↑ {upload}",
    "status.stale": "Laatste geldige meting: {details} · verouderd",
    "status.unavailable": "Bronmetingen niet beschikbaar",
  },
  fr: {
    "plugin.name": "Ressources système",
    "plugin.description": "Affiche les compteurs CPU et RAM, ainsi que les mesures GPU et disque facultatives, sur le familier.",
    "hud.cpu": "CPU",
    "hud.ram": "RAM",
    "hud.gpu": "GPU",
    "hud.disk": "Disque",
    "metric.cpu": "Utilisation CPU",
    "metric.ram": "Utilisation RAM",
    "metric.gpu": "Utilisation GPU",
    "metric.disk": "Capacité du disque",
    "metric.battery": "Batterie",
    "battery.charging": "en charge",
    "battery.notCharging": "pas en charge",
    "value.na": "—",
    "value.stale": "obsolète",
    "config.showHud.label": "Afficher le HUD des ressources",
    "config.showHud.description": "Garde un overlay CPU et RAM compact sur le familier.",
    "config.showCpu.label": "Afficher le CPU",
    "config.showCpu.description": "Inclure l’utilisation CPU dans le HUD épinglé.",
    "config.showRam.label": "Afficher la RAM",
    "config.showRam.description": "Inclure l’utilisation RAM dans le HUD épinglé.",
    "config.showGpu.label": "Afficher le GPU",
    "config.showGpu.description": "Inclure l’utilisation GPU lorsque l’hôte la fournit.",
    "config.showDisk.label": "Afficher le disque",
    "config.showDisk.description": "Inclure la capacité utilisée du volume système lorsque l’hôte la fournit.",
    "config.showBattery.label": "Afficher la batterie",
    "config.showBattery.description": "Inclure le pourcentage et l’état de charge dans le statut et la parole lorsqu’ils sont disponibles.",
    "config.showNetwork.label": "Afficher le réseau",
    "config.showNetwork.description": "Inclure les débits descendant et montant dans le statut et la parole lorsqu’ils sont disponibles.",
    "config.pollSeconds.label": "Intervalle d’actualisation (secondes)",
    "config.pollSeconds.description": "Fréquence d’échantillonnage du CPU et de la RAM hôte.",
    "config.alertPercent.label": "Seuil d’alerte (%)",
    "config.alertPercent.description": "Parler lorsqu’un compteur activé atteint cette valeur ; le CPU et le GPU exigent deux mesures.",
    "config.alertCpu.label": "Alerter pour l’utilisation CPU",
    "config.alertCpu.description": "Exiger deux mesures CPU élevées consécutives avant de parler.",
    "config.alertRam.label": "Alerter pour l’utilisation RAM",
    "config.alertRam.description": "Alerter en cas d’utilisation RAM élevée. Cela ne mesure pas la pression mémoire.",
    "config.alertGpu.label": "Alerter pour l’utilisation GPU",
    "config.alertGpu.description": "Exiger deux mesures GPU élevées consécutives avant de parler.",
    "config.alertDisk.label": "Alerter pour la capacité du disque",
    "config.alertDisk.description": "Alerter lorsque la capacité utilisée du volume système atteint le seuil.",
    "config.speakAlerts.label": "Parler en cas de charge élevée",
    "config.speakAlerts.description": "Le familier prévient lorsqu’un compteur dépasse le seuil.",
    "config.language.label": "Langue",
    "config.language.description": "Langue des compteurs, du statut et des messages du familier.",
    "config.language.auto": "Automatique (OpenPets)",
    "config.language.nl": "Nederlands",
    "config.language.en": "English",
    "config.language.fr": "Français",
    "config.language.de": "Deutsch",
    "command.show.title": "Afficher le HUD des ressources",
    "command.show.description": "Afficher les compteurs CPU, RAM, GPU et disque sur le familier.",
    "command.hide.title": "Masquer le HUD des ressources",
    "command.hide.description": "Masquer les compteurs de ressources sur le familier.",
    "command.snapshot.title": "Lire les ressources",
    "command.snapshot.description": "Faire lire au familier le CPU et la RAM actuels.",
    "speech.snapshot": "CPU {cpu}, RAM {ram}.",
    "speech.snapshotFull": "CPU {cpu}, RAM {ram}, GPU {gpu}, disque {disk}.",
    "speech.battery": "Batterie à {percent} pour cent ({state}).",
    "speech.network": "Téléchargement réseau {download} et envoi {upload}.",
    "speech.stale": "La dernière mesure valide est obsolète.",
    "speech.unavailable": "Les mesures des ressources sont indisponibles.",
    "speech.alert": "{label} est à {value} pour cent.",
    "status.line": "CPU {cpu} · RAM {ram}",
    "status.lineFull": "CPU {cpu} · RAM {ram} · GPU {gpu} · disque {disk}",
    "status.network": "Réseau ↓ {download} · ↑ {upload}",
    "status.stale": "Dernière mesure valide : {details} · obsolète",
    "status.unavailable": "Mesures des ressources indisponibles",
  },
  de: {
    "plugin.name": "Systemressourcen",
    "plugin.description": "Zeigt Live-CPU und RAM sowie optionale GPU- und Datenträgermessungen am Haustier.",
    "hud.cpu": "CPU",
    "hud.ram": "RAM",
    "hud.gpu": "GPU",
    "hud.disk": "Datenträger",
    "metric.cpu": "CPU-Auslastung",
    "metric.ram": "RAM-Auslastung",
    "metric.gpu": "GPU-Auslastung",
    "metric.disk": "Datenträgerkapazität",
    "metric.battery": "Akku",
    "battery.charging": "wird geladen",
    "battery.notCharging": "nicht am Laden",
    "value.na": "—",
    "value.stale": "veraltet",
    "config.showHud.label": "Ressourcen-HUD anzeigen",
    "config.showHud.description": "Zeigt ein kompaktes CPU- und RAM-Overlay am Haustier.",
    "config.showCpu.label": "CPU anzeigen",
    "config.showCpu.description": "CPU-Auslastung im angehefteten HUD anzeigen.",
    "config.showRam.label": "RAM anzeigen",
    "config.showRam.description": "RAM-Auslastung im angehefteten HUD anzeigen.",
    "config.showGpu.label": "GPU anzeigen",
    "config.showGpu.description": "GPU-Auslastung anzeigen, wenn der Host sie liefert.",
    "config.showDisk.label": "Datenträger anzeigen",
    "config.showDisk.description": "Belegte Systemvolume-Kapazität anzeigen, wenn der Host sie liefert.",
    "config.showBattery.label": "Akku anzeigen",
    "config.showBattery.description": "Akkustand und Ladestatus in Status und Sprache anzeigen, wenn verfügbar.",
    "config.showNetwork.label": "Netzwerk anzeigen",
    "config.showNetwork.description": "Download- und Uploadraten in Status und Sprache anzeigen, wenn verfügbar.",
    "config.pollSeconds.label": "Aktualisierungsintervall (Sekunden)",
    "config.pollSeconds.description": "Wie oft Host-CPU und RAM abgefragt werden.",
    "config.alertPercent.label": "Warnschwelle (%)",
    "config.alertPercent.description": "Sprechen, wenn eine aktivierte Anzeige diesen Wert erreicht; CPU und GPU erfordern zwei Messungen.",
    "config.alertCpu.label": "Bei CPU-Auslastung warnen",
    "config.alertCpu.description": "Vor dem Sprechen zwei aufeinanderfolgende hohe CPU-Messungen verlangen.",
    "config.alertRam.label": "Bei RAM-Auslastung warnen",
    "config.alertRam.description": "Bei hoher RAM-Auslastung warnen. Dies misst keinen Speicherdruck.",
    "config.alertGpu.label": "Bei GPU-Auslastung warnen",
    "config.alertGpu.description": "Vor dem Sprechen zwei aufeinanderfolgende hohe GPU-Messungen verlangen.",
    "config.alertDisk.label": "Bei Datenträgerkapazität warnen",
    "config.alertDisk.description": "Warnen, wenn die belegte Systemvolume-Kapazität die Schwelle erreicht.",
    "config.speakAlerts.label": "Bei hoher Last sprechen",
    "config.speakAlerts.description": "Das Haustier warnt, wenn eine Anzeige die Schwelle überschreitet.",
    "config.language.label": "Sprache",
    "config.language.description": "Sprache für Anzeigen, Status und Haustier-Sprache.",
    "config.language.auto": "Automatisch (OpenPets)",
    "config.language.nl": "Nederlands",
    "config.language.en": "English",
    "config.language.fr": "Français",
    "config.language.de": "Deutsch",
    "command.show.title": "Ressourcen-HUD anzeigen",
    "command.show.description": "Live-CPU-, RAM-, GPU- und Datenträgeranzeigen am Haustier zeigen.",
    "command.hide.title": "Ressourcen-HUD ausblenden",
    "command.hide.description": "Die Ressourcenanzeigen am Haustier ausblenden.",
    "command.snapshot.title": "Ressourcen vorlesen",
    "command.snapshot.description": "Das Haustier liest die aktuelle CPU und RAM vor.",
    "speech.snapshot": "CPU {cpu}, RAM {ram}.",
    "speech.snapshotFull": "CPU {cpu}, RAM {ram}, GPU {gpu}, Datenträger {disk}.",
    "speech.battery": "Akku bei {percent} Prozent ({state}).",
    "speech.network": "Netzwerk-Download {download} und Upload {upload}.",
    "speech.stale": "Die letzte gültige Messung ist veraltet.",
    "speech.unavailable": "Ressourcenmessungen sind nicht verfügbar.",
    "speech.alert": "{label} liegt bei {value} Prozent.",
    "status.line": "CPU {cpu} · RAM {ram}",
    "status.lineFull": "CPU {cpu} · RAM {ram} · GPU {gpu} · Datenträger {disk}",
    "status.network": "Netzwerk ↓ {download} · ↑ {upload}",
    "status.stale": "Letzte gültige Messung: {details} · veraltet",
    "status.unavailable": "Ressourcenmessungen nicht verfügbar",
  },
};

export function interpolate(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] == null ? `{${key}}` : String(vars[key]),
  );
}

export function resolveLanguage(raw, hostLocale = "en") {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "auto";
  if (value !== "auto" && CATALOGS[value]) return value;
  const lang = String(hostLocale || "en").split(/[-_]/)[0];
  return CATALOGS[lang] ? lang : "en";
}

export function t(language, key, vars) {
  const catalog = CATALOGS[language] ?? CATALOGS.en;
  const template = catalog[key] ?? CATALOGS.en[key] ?? key;
  return interpolate(template, vars);
}

export function clampPercent(value) {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function clampRate(value) {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

export function toneFor(percent) {
  if (percent == null) return "slate";
  if (percent >= 90) return "red";
  if (percent >= 70) return "amber";
  return "green";
}

export function formatPercent(language, percent) {
  return percent == null ? t(language, "value.na") : `${percent}%`;
}

export function formatRate(language, bytesPerSecond) {
  const value = clampRate(bytesPerSecond);
  if (value == null) return t(language, "value.na");
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let index = 0;
  let scaled = value;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index += 1;
  }
  const digits = index === 0 || scaled >= 10 ? 0 : 1;
  return `${scaled.toFixed(digits)} ${units[index]}`;
}

function metricValue(snapshot, key) {
  if (key === "disk") return snapshot?.disk ?? snapshot?.ssd ?? null;
  return snapshot?.[key] ?? null;
}

function hasMetric(snapshot) {
  return METRIC_KEYS.some((key) => metricValue(snapshot, key) != null);
}

export function hottestMetric(snapshot) {
  let hottest = null;
  for (const key of METRIC_KEYS) {
    const value = metricValue(snapshot, key);
    if (value == null) continue;
    if (!hottest || value > hottest.value) hottest = { key, value };
  }
  return hottest;
}

function normalizedBattery(hostMetrics) {
  const battery = hostMetrics?.battery;
  const percent = clampPercent(battery?.percent);
  const charging = typeof battery?.charging === "boolean" ? battery.charging : null;
  return {
    batteryPercent: percent,
    batteryCharging: charging,
    batteryAvailable: percent != null && charging != null,
  };
}

function normalizedNetwork(hostMetrics, extendedMetricsFresh) {
  const network = extendedMetricsFresh === false ? null : hostMetrics?.network;
  const download = clampRate(network?.downloadBytesPerSecond);
  const upload = clampRate(network?.uploadBytesPerSecond);
  return {
    networkDownloadBytesPerSecond: download,
    networkUploadBytesPerSecond: upload,
    networkAvailable: download != null && upload != null,
  };
}

export function mergeSnapshot(hostMetrics = {}, now = Date.now()) {
  const cpu = clampPercent(hostMetrics.cpuPercent);
  const ram = clampPercent(hostMetrics.memUsedPercent);
  const extendedMetricsFresh = hostMetrics?.extendedMetricsFresh !== false;
  const gpu = extendedMetricsFresh ? clampPercent(hostMetrics.gpuPercent) : null;
  const disk = extendedMetricsFresh ? clampPercent(hostMetrics.diskUsedPercent) : null;
  const battery = extendedMetricsFresh ? normalizedBattery(hostMetrics) : { batteryPercent: null, batteryCharging: null, batteryAvailable: false };
  const network = normalizedNetwork(hostMetrics, extendedMetricsFresh);
  const extendedMetricsSampledAt = Number.isFinite(Number(hostMetrics?.extendedMetricsSampledAt))
    ? Number(hostMetrics.extendedMetricsSampledAt)
    : null;
  const snapshot = {
    freshness: "fresh",
    cpu,
    ram,
    gpu,
    disk,
    extendedMetricsAvailable: gpu != null || disk != null || battery.batteryAvailable || network.networkAvailable,
    ...battery,
    ...network,
    extendedMetricsSampledAt,
    sampledAt: now,
    attemptedAt: now,
  };
  if (!hasMetric(snapshot)) snapshot.freshness = "unavailable";
  return snapshot;
}

export function staleSnapshot(previous, failedAt = Date.now()) {
  if (!previous || !hasMetric(previous)) return unavailableSnapshot(failedAt);
  return { ...previous, freshness: "stale", attemptedAt: failedAt };
}

export function unavailableSnapshot(attemptedAt = Date.now()) {
  return {
    freshness: "unavailable",
    cpu: null,
    ram: null,
    gpu: null,
    disk: null,
    extendedMetricsAvailable: false,
    batteryPercent: null,
    batteryCharging: null,
    batteryAvailable: false,
    networkDownloadBytesPerSecond: null,
    networkUploadBytesPerSecond: null,
    networkAvailable: false,
    extendedMetricsSampledAt: null,
    sampledAt: null,
    attemptedAt,
  };
}

export function readConfig(raw = {}, hostLocale = "en") {
  const pollSeconds = Number(raw.pollSeconds ?? DEFAULT_POLL_SECONDS);
  const alertPercent = Number(raw.alertPercent ?? DEFAULT_ALERT_PERCENT);
  return {
    showHud: raw.showHud !== false,
    showCpu: raw.showCpu !== false,
    showRam: raw.showRam !== false,
    showGpu: raw.showGpu !== false,
    showDisk: raw.showDisk !== false,
    showBattery: raw.showBattery !== false,
    showNetwork: raw.showNetwork !== false,
    speakAlerts: raw.speakAlerts !== false,
    alertCpu: raw.alertCpu !== false,
    alertRam: raw.alertRam !== false,
    alertGpu: raw.alertGpu !== false,
    alertDisk: raw.alertDisk !== false,
    pollSeconds: Math.max(5, Math.min(60, Number.isFinite(pollSeconds) ? pollSeconds : DEFAULT_POLL_SECONDS)),
    alertPercent: Math.max(70, Math.min(99, Number.isFinite(alertPercent) ? alertPercent : DEFAULT_ALERT_PERCENT)),
    language: resolveLanguage(raw.language ?? DEFAULT_LANGUAGE, hostLocale),
  };
}

function snapshotFromStored(value) {
  if (!value || typeof value !== "object") return null;
  const sampledAt = Number(value.sampledAt);
  if (!Number.isFinite(sampledAt)) return null;
  const gpu = clampPercent(value.gpu);
  const disk = clampPercent(value.disk ?? value.ssd);
  const batteryPercent = clampPercent(value.batteryPercent);
  const batteryCharging = typeof value.batteryCharging === "boolean" ? value.batteryCharging : null;
  const networkDownloadBytesPerSecond = clampRate(value.networkDownloadBytesPerSecond);
  const networkUploadBytesPerSecond = clampRate(value.networkUploadBytesPerSecond);
  const snapshot = {
    freshness: "stale",
    cpu: clampPercent(value.cpu),
    ram: clampPercent(value.ram),
    gpu,
    disk,
    batteryPercent,
    batteryCharging,
    batteryAvailable: batteryPercent != null && batteryCharging != null,
    networkDownloadBytesPerSecond,
    networkUploadBytesPerSecond,
    networkAvailable: networkDownloadBytesPerSecond != null && networkUploadBytesPerSecond != null,
    extendedMetricsAvailable: gpu != null || disk != null || (batteryPercent != null && batteryCharging != null) || (networkDownloadBytesPerSecond != null && networkUploadBytesPerSecond != null),
    extendedMetricsSampledAt: Number.isFinite(Number(value.extendedMetricsSampledAt)) ? Number(value.extendedMetricsSampledAt) : null,
    sampledAt,
    attemptedAt: Date.now(),
  };
  return hasMetric(snapshot) ? snapshot : null;
}

function visibilityValue(value) {
  if (value === true || value === "shown") return true;
  if (value === false || value === "hidden") return false;
  return null;
}

function safeError(error) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unknown error";
}

async function warn(state, message, error) {
  try {
    await state.ctx.log.warn(message, { reason: safeError(error) });
  } catch {
    // Logging must not take down the plugin after the original failure.
  }
}

async function storageGet(state, key) {
  try {
    return await state.ctx.storage.get(key);
  } catch (error) {
    await warn(state, `system resources storage read failed: ${key}`, error);
    return undefined;
  }
}

async function storageSet(state, key, value) {
  try {
    await state.ctx.storage.set(key, value);
    return true;
  } catch (error) {
    await warn(state, `system resources storage write failed: ${key}`, error);
    return false;
  }
}

function isCurrent(state, generation) {
  return state.active && state.generation === generation;
}

function effectiveVisibility(state) {
  return state.hudVisible;
}

function snapshotForHud(snapshot) {
  if (!snapshot || snapshot.freshness === "unavailable" || !hasMetric(snapshot)) return null;
  return snapshot;
}

function hudItem(ctx, language, key, percent, stale) {
  if (percent == null) return null;
  const label = t(language, `hud.${key}`) + (stale ? ` (${t(language, "value.stale")})` : "");
  return { icon: ctx.assets.icon(key), value: percent, tone: toneFor(percent), label };
}

export function hudSpec(ctx, snapshot, language = "en", config, priority = "low") {
  const visibleSnapshot = snapshotForHud(snapshot);
  if (!visibleSnapshot) return null;
  const stale = visibleSnapshot.freshness === "stale";
  const items = METRIC_DEFINITIONS
    .filter(({ showKey }) => config?.[showKey] !== false)
    .map(({ key }) => hudItem(ctx, language, key, metricValue(visibleSnapshot, key), stale))
    .filter(Boolean)
    .slice(0, 4);
  if (items.length === 0) return null;
  // Virtual Pet owns the normal-priority default-pet pin when both plugins
  // are enabled. System Resources remains accessible through status, speech,
  // and resources.get without repeatedly reclaiming that single host slot.
  return { tone: "info", sticky: true, pin: true, dismissOn: [], priority, hud: { items } };
}

export function snapshotCopy(language, snapshot, kind, config = {}) {
  if (!snapshot || snapshot.freshness === "unavailable" || !hasMetric(snapshot)) {
    return t(language, kind === "speech" ? "speech.unavailable" : "status.unavailable");
  }
  const separator = kind === "speech" ? ", " : " · ";
  const details = METRIC_KEYS
    .map((key) => [key, metricValue(snapshot, key)])
    .filter(([, value]) => value != null)
    .map(([key, value]) => `${t(language, `hud.${key}`)} ${formatPercent(language, value)}`)
    .join(separator);
  const batteryState = snapshot.batteryCharging ? "battery.charging" : "battery.notCharging";
  const batteryDetails = config.showBattery !== false && snapshot.batteryAvailable
    ? kind === "speech"
      ? t(language, "speech.battery", {
        percent: String(snapshot.batteryPercent),
        state: t(language, batteryState),
      })
      : `${t(language, "metric.battery")} ${formatPercent(language, snapshot.batteryPercent)} (${t(language, batteryState)})`
    : null;
  const networkDetails = config.showNetwork !== false && snapshot.networkAvailable
    ? kind === "speech"
      ? t(language, "speech.network", {
        download: formatRate(language, snapshot.networkDownloadBytesPerSecond),
        upload: formatRate(language, snapshot.networkUploadBytesPerSecond),
      })
      : t(language, "status.network", {
        download: formatRate(language, snapshot.networkDownloadBytesPerSecond),
        upload: formatRate(language, snapshot.networkUploadBytesPerSecond),
      })
    : null;
  const parts = [details, batteryDetails, networkDetails].filter(Boolean);
  if (kind !== "speech") {
    const statusText = (selected) => snapshot.freshness === "stale"
      ? t(language, "status.stale", { details: selected.join(separator) })
      : selected.join(separator);
    if (statusText(parts).length > 120 && networkDetails) parts.pop();
    if (statusText(parts).length > 120 && batteryDetails) parts.splice(Math.max(0, parts.indexOf(batteryDetails)), 1);
    const fitted = statusText(parts);
    return fitted.length <= 120 ? fitted : `${fitted.slice(0, 119)}…`;
  }
  const fullDetails = parts.join(separator);
  if (snapshot.freshness === "stale") {
    return `${fullDetails} ${t(language, "speech.stale")}`;
  }
  return `${fullDetails}.`;
}

export function resourcesResult(snapshot) {
  return {
    cpuPercent: metricValue(snapshot, "cpu"),
    ramPercent: metricValue(snapshot, "ram"),
    gpuPercent: metricValue(snapshot, "gpu"),
    diskUsedPercent: metricValue(snapshot, "disk"),
    extendedMetricsAvailable: metricValue(snapshot, "gpu") != null
      || metricValue(snapshot, "disk") != null
      || snapshot?.batteryAvailable === true
      || snapshot?.networkAvailable === true,
    batteryPercent: snapshot?.batteryPercent ?? null,
    batteryCharging: typeof snapshot?.batteryCharging === "boolean" ? snapshot.batteryCharging : null,
    batteryAvailable: snapshot?.batteryAvailable === true,
    networkDownloadBytesPerSecond: snapshot?.networkDownloadBytesPerSecond ?? null,
    networkUploadBytesPerSecond: snapshot?.networkUploadBytesPerSecond ?? null,
    networkAvailable: snapshot?.networkAvailable === true,
    extendedMetricsSampledAt: Number.isFinite(snapshot?.extendedMetricsSampledAt) ? snapshot.extendedMetricsSampledAt : null,
    freshness: snapshot?.freshness ?? "unavailable",
    sampledAt: Number.isFinite(snapshot?.sampledAt) ? snapshot.sampledAt : null,
  };
}

function statusTone(snapshot) {
  if (!snapshot || snapshot.freshness === "unavailable" || snapshot.freshness === "stale") return "warning";
  const hottest = hottestMetric(snapshot);
  if (hottest?.value >= 90) return "error";
  if (hottest?.value >= 70) return "warning";
  return "info";
}

async function dismissHandle(state, handle) {
  if (!handle) return;
  try {
    await handle.dismiss();
  } catch (error) {
    await warn(state, "system resources HUD dismissal failed", error);
  }
}

async function dismissPinned(state) {
  const pinned = state.pinned;
  state.pinned = null;
  await dismissHandle(state, pinned);
}

function isInactiveBubbleError(error) {
  return error instanceof Error && error.message === INACTIVE_BUBBLE_ERROR;
}

async function probeBubbleLiveness(state, bubble, priority) {
  try {
    // The host can synchronously reject a pin before the SDK bridge registers
    // onDismiss. update() is the supported synchronous-liveness signal that
    // remains available on the returned handle.
    await bubble.update({ priority });
    return true;
  } catch (error) {
    if (isInactiveBubbleError(error)) return false;
    await warn(state, "system resources HUD liveness check failed", error);
    return true;
  }
}

async function updateHudForState(state, snapshot, generation) {
  if (!isCurrent(state, generation) || !effectiveVisibility(state) || state.hudSuppressed) return;
  const spec = hudSpec(state.ctx, snapshot, state.config.language, state.config, state.hudPriority);
  if (!spec) {
    await dismissPinned(state);
    return;
  }

  const pinned = state.pinned;
  if (pinned) {
    try {
      await pinned.update(spec);
      if (!isCurrent(state, generation) || !effectiveVisibility(state) || state.hudSuppressed || state.pinned !== pinned) return;
      return;
    } catch (error) {
      const wasCurrentPinned = state.pinned === pinned;
      if (wasCurrentPinned) state.pinned = null;
      if (wasCurrentPinned && isInactiveBubbleError(error)) {
        state.hudSuppressed = true;
        return;
      }
      await warn(state, "system resources HUD update failed", error);
    }
  }

  if (!isCurrent(state, generation) || !effectiveVisibility(state) || state.hudSuppressed) return;
  let bubble;
  try {
    bubble = await state.ctx.ui.bubble(spec);
  } catch (error) {
    state.hudSuppressed = true;
    await warn(state, "system resources HUD creation failed", error);
    return;
  }
  if (!isCurrent(state, generation) || !effectiveVisibility(state) || state.hudSuppressed) {
    await dismissHandle(state, bubble);
    return;
  }
  if (!await probeBubbleLiveness(state, bubble, state.hudPriority)) {
    state.hudSuppressed = true;
    return;
  }
  if (!isCurrent(state, generation) || !effectiveVisibility(state) || state.hudSuppressed) {
    await dismissHandle(state, bubble);
    return;
  }
  state.pinned = bubble;
  bubble.onDismiss((reason) => {
    if (state.pinned?.id !== bubble.id) return;
    state.pinned = null;
    if (reason === "replaced") state.hudSuppressed = true;
  });
}

export async function publishStatus(ctx, snapshot, language = "en") {
  try {
    await ctx.status.set({ text: snapshotCopy(language, snapshot, "status"), tone: statusTone(snapshot) });
  } catch {
    // The lifecycle controller logs this failure. This compatibility wrapper has no state.
  }
}

async function publishStatusForState(state, snapshot, generation) {
  if (!isCurrent(state, generation)) return;
  try {
    await state.ctx.status.set({ text: snapshotCopy(state.config.language, snapshot, "status", state.config), tone: statusTone(snapshot) });
  } catch (error) {
    await warn(state, "system resources status update failed", error);
  }
}

function alertCandidates(snapshot, config, alertStreaks = {}) {
  if (snapshot?.freshness !== "fresh") return [];
  return METRIC_DEFINITIONS
    .map((definition) => ({
      ...definition,
      value: metricValue(snapshot, definition.key),
      enabled: config?.[definition.alertKey] !== false,
      streak: alertStreaks[definition.key] ?? 0,
    }))
    .filter(({ value, enabled }) => enabled && value != null && value >= config.alertPercent)
    .filter(({ sustained, streak }) => !sustained || streak >= SUSTAINED_ALERT_SAMPLES)
    .sort((left, right) => right.value - left.value);
}

function updateAlertStreaks(state, snapshot) {
  const gpuSampledAt = Number.isFinite(snapshot?.extendedMetricsSampledAt) ? snapshot.extendedMetricsSampledAt : null;
  const distinctGpuSample = gpuSampledAt == null || state.lastGpuSampledAt !== gpuSampledAt;
  if (gpuSampledAt != null && distinctGpuSample) state.lastGpuSampledAt = gpuSampledAt;
  for (const definition of METRIC_DEFINITIONS) {
    if (!definition.sustained) {
      state.alertStreaks[definition.key] = 0;
      continue;
    }
    const value = metricValue(snapshot, definition.key);
    const sustained = snapshot?.freshness === "fresh"
      && state.config[definition.alertKey] !== false
      && value != null
      && value >= state.config.alertPercent;
    if (definition.key === "gpu" && value != null && !distinctGpuSample) continue;
    state.alertStreaks[definition.key] = sustained
      ? Math.min(SUSTAINED_ALERT_SAMPLES, state.alertStreaks[definition.key] + 1)
      : 0;
  }
}

function resetAlertStreaks(state) {
  for (const key of METRIC_KEYS) state.alertStreaks[key] = 0;
}

function alertLabel(language, key) {
  return t(language, `metric.${key}`);
}

export async function maybeAlert(ctx, snapshot, now = Date.now(), cfg) {
  const rawConfig = cfg ?? (await ctx.config.get()) ?? {};
  const settings = readConfig(rawConfig, ctx.locale);
  if (!settings.speakAlerts) return null;
  const candidate = alertCandidates(snapshot, settings, cfg?.alertStreaks)[0];
  if (!candidate) return null;
  try {
    await ctx.pet.react("error", { showMessage: false });
    await ctx.pet.speak(t(settings.language, "speech.alert", {
      label: alertLabel(settings.language, candidate.key),
      value: String(candidate.value),
    }));
  } catch {
    // The lifecycle controller logs this failure. Keep this helper compatible.
  }
  return { key: candidate.key, value: candidate.value };
}

async function maybeAlertForState(state, snapshot, now, generation) {
  if (!isCurrent(state, generation) || snapshot?.freshness !== "fresh" || !state.config.speakAlerts) return null;
  const candidate = alertCandidates(snapshot, state.config, state.alertStreaks)[0];
  if (!candidate) return null;
  if (now - state.lastAlertAt < ALERT_COOLDOWN_MS) return null;

  state.lastAlertAt = now;
  await storageSet(state, "lastAlertAt", now);
  if (!isCurrent(state, generation)) return null;
  try {
    await state.ctx.pet.react("error", { showMessage: false });
  } catch (error) {
    await warn(state, "system resources alert reaction failed", error);
  }
  if (!isCurrent(state, generation)) return null;
  try {
    await state.ctx.pet.speak(t(state.config.language, "speech.alert", {
      label: alertLabel(state.config.language, candidate.key),
      value: String(candidate.value),
    }));
  } catch (error) {
    await warn(state, "system resources alert speech failed", error);
  }
  return { key: candidate.key, value: candidate.value };
}

async function sampleMetrics(state, now) {
  try {
    return mergeSnapshot((await state.ctx.system.metrics()) ?? {}, now);
  } catch (error) {
    await warn(state, "system resources metric collection failed", error);
    return staleSnapshot(state.lastFreshSnapshot, now);
  }
}

async function executePoll(state, purposes, generation, requestedAt) {
  const now = Number.isFinite(requestedAt) ? requestedAt : Date.now();
  const snapshot = await sampleMetrics(state, now);
  if (!isCurrent(state, generation)) return snapshot;

  state.currentSnapshot = snapshot;
  // Current desktop hosts expose an identity for each successful extended
  // metrics collection. Older hosts do not, so the scheduled poll remains the
  // fallback monitoring-sample boundary there. Assistant and UI requests may
  // read the same host state, but must not manufacture sustained CPU/GPU
  // samples.
  if (purposes.has("scheduled")) updateAlertStreaks(state, snapshot);
  if (snapshot.freshness === "fresh") {
    state.lastFreshSnapshot = snapshot;
    await storageSet(state, "snapshot", snapshot);
  }
  if (!isCurrent(state, generation)) return snapshot;

  const ambient = [...purposes].some((purpose) => purpose !== "capability");
  if (ambient) {
    await updateHudForState(state, snapshot, generation);
    await publishStatusForState(state, snapshot, generation);
    const alerting = [...purposes].some((purpose) => ["start", "scheduled", "config", "show"].includes(purpose));
    if (alerting) await maybeAlertForState(state, snapshot, now, generation);
  }
  return snapshot;
}

function requestPoll(state, purpose, requestedAt = Date.now()) {
  if (!state.active) return Promise.resolve(state.currentSnapshot);
  state.pendingPurposes.add(purpose);
  if (!Number.isFinite(state.pendingRequestedAt)) state.pendingRequestedAt = requestedAt;
  if (state.pollPromise) return state.pollPromise;

  const drain = (async () => {
    let result = state.currentSnapshot;
    while (state.active && state.pendingPurposes.size > 0) {
      const purposes = state.pendingPurposes;
      state.pendingPurposes = new Set();
      const startedAt = state.pendingRequestedAt;
      state.pendingRequestedAt = null;
      const generation = state.generation;
      result = await executePoll(state, purposes, generation, startedAt);
    }
    return result;
  })();
  state.pollPromise = drain;
  void drain.finally(() => {
    if (state.pollPromise === drain) state.pollPromise = null;
  });
  return drain;
}

async function reconcileScheduleNow(state) {
  state.scheduleGeneration += 1;
  const scheduleGeneration = state.scheduleGeneration;
  state.scheduleArmed = false;
  try {
    await state.ctx.schedule.cancel(SCHEDULE_ID);
  } catch (error) {
    await warn(state, "system resources schedule cancellation failed", error);
  }
  if (!state.active || scheduleGeneration !== state.scheduleGeneration) return;
  let lastError;
  for (let attempt = 1; attempt <= MAX_SCHEDULE_REGISTRATION_ATTEMPTS; attempt += 1) {
    if (!state.active || scheduleGeneration !== state.scheduleGeneration) return;
    try {
      await state.ctx.schedule.once(SCHEDULE_ID, state.config.pollSeconds * 1000, async () => {
        if (!state.active || scheduleGeneration !== state.scheduleGeneration) return;
        state.scheduleArmed = false;
        await requestPoll(state, "scheduled");
        if (state.active && scheduleGeneration === state.scheduleGeneration) await queueSchedule(state);
      });
      if (state.active && scheduleGeneration === state.scheduleGeneration) state.scheduleArmed = true;
      return;
    } catch (error) {
      lastError = error;
    }
  }
  await warn(state, "system resources schedule registration failed after bounded retry", lastError);
}

function queueSchedule(state) {
  const next = state.schedulePromise.then(() => reconcileScheduleNow(state));
  state.schedulePromise = next.catch(() => undefined);
  return next;
}

async function persistVisibility(state) {
  const visibleStored = await storageSet(state, "hudVisible", state.hudVisible);
  const configStored = await storageSet(state, "hudConfigValue", state.config.showHud);
  state.visibilityDirty = !(visibleStored && configStored);
}

async function setHudVisibility(state, visible) {
  if (!state.active) return state.currentSnapshot;
  state.hudVisible = visible;
  state.visibilitySource = "command";
  if (visible) {
    state.hudSuppressed = false;
    state.hudPriority = "normal";
  }
  state.generation += 1;
  if (!visible) {
    await dismissPinned(state);
    await persistVisibility(state);
    return state.currentSnapshot;
  }
  await persistVisibility(state);
  await queueSchedule(state);
  return requestPoll(state, "show");
}

async function handleConfigChange(state, raw) {
  if (!state.active) return;
  const next = readConfig(raw ?? {}, state.ctx.locale);
  const visibilityChanged = next.showHud !== state.config.showHud;
  const alertSettingsChanged = next.alertPercent !== state.config.alertPercent
    || next.alertCpu !== state.config.alertCpu
    || next.alertRam !== state.config.alertRam
    || next.alertGpu !== state.config.alertGpu
    || next.alertDisk !== state.config.alertDisk
    || next.speakAlerts !== state.config.speakAlerts;
  state.config = next;
  state.generation += 1;
  if (alertSettingsChanged) resetAlertStreaks(state);
  if (visibilityChanged) {
    state.hudVisible = next.showHud;
    state.visibilitySource = "config";
    if (next.showHud) {
      state.hudSuppressed = false;
      state.hudPriority = "low";
    }
    if (!next.showHud) await dismissPinned(state);
    await persistVisibility(state);
  }
  await queueSchedule(state);
  await requestPoll(state, "config");
}

async function speakSnapshotForState(state) {
  const snapshot = await requestPoll(state, "snapshot");
  if (!state.active || !snapshot) return snapshot;
  try {
    await state.ctx.pet.speak(snapshotCopy(state.config.language, snapshot, "speech", state.config));
  } catch (error) {
    await warn(state, "system resources snapshot speech failed", error);
  }
  return snapshot;
}

async function readInitialState(state) {
  const [storedVisibility, storedConfigValue, storedAlert, storedSnapshot] = await Promise.all([
    storageGet(state, "hudVisible"),
    storageGet(state, "hudConfigValue"),
    storageGet(state, "lastAlertAt"),
    storageGet(state, "snapshot"),
  ]);
  const visible = visibilityValue(storedVisibility);
  const previousConfig = typeof storedConfigValue === "boolean" ? storedConfigValue : null;
  if (visible == null) {
    state.hudVisible = state.config.showHud;
    state.visibilitySource = "config";
  } else if (previousConfig != null && previousConfig !== state.config.showHud) {
    state.hudVisible = state.config.showHud;
    state.visibilitySource = "config";
  } else {
    state.hudVisible = visible;
    state.visibilitySource = "command";
  }
  if (typeof storedAlert === "number" && Number.isFinite(storedAlert)) state.lastAlertAt = storedAlert;
  state.lastFreshSnapshot = snapshotFromStored(storedSnapshot);
  state.currentSnapshot = state.lastFreshSnapshot ? staleSnapshot(state.lastFreshSnapshot) : null;
  if (visible == null || previousConfig == null || previousConfig !== state.config.showHud) await persistVisibility(state);
}

export async function collectSnapshot(ctx, now = Date.now()) {
  try {
    return mergeSnapshot((await ctx.system.metrics()) ?? {}, now);
  } catch {
    return unavailableSnapshot(now);
  }
}

export async function updateHud(ctx, snapshot, cfg) {
  const state = activeLifecycle?.ctx === ctx ? activeLifecycle : null;
  if (!state) return;
  if (cfg) state.config = cfg;
  await updateHudForState(state, snapshot, state.generation);
}

export async function tick(ctx, now = Date.now()) {
  const state = activeLifecycle?.ctx === ctx ? activeLifecycle : null;
  if (!state) return collectSnapshot(ctx, now);
  return requestPoll(state, "scheduled", now);
}

export async function showHud(ctx) {
  const state = activeLifecycle?.ctx === ctx ? activeLifecycle : null;
  return state ? setHudVisibility(state, true) : null;
}

export async function hideHud(ctx) {
  const state = activeLifecycle?.ctx === ctx ? activeLifecycle : null;
  if (state) await setHudVisibility(state, false);
}

export async function speakSnapshot(ctx) {
  const state = activeLifecycle?.ctx === ctx ? activeLifecycle : null;
  if (state) return speakSnapshotForState(state);
  const snapshot = await collectSnapshot(ctx);
  try {
    await ctx.pet.speak(snapshotCopy(resolveLanguage("auto", ctx.locale), snapshot, "speech"));
  } catch {}
  return snapshot;
}

let activeLifecycle = null;

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      if (activeLifecycle) await stopLifecycle(activeLifecycle);
      const state = {
        ctx,
        active: true,
        generation: 1,
        scheduleGeneration: 0,
        scheduleArmed: false,
        schedulePromise: Promise.resolve(),
        pollPromise: null,
        pendingPurposes: new Set(),
        pendingRequestedAt: null,
        config: readConfig((await ctx.config.get()) ?? {}, ctx.locale),
        hudVisible: true,
        visibilitySource: "config",
        visibilityDirty: false,
        hudSuppressed: false,
        hudPriority: "low",
        pinned: null,
        currentSnapshot: null,
        lastFreshSnapshot: null,
        lastAlertAt: 0,
        alertStreaks: { cpu: 0, ram: 0, gpu: 0, disk: 0 },
        lastGpuSampledAt: null,
        unsubscribeConfig: null,
        unsubscribeClick: null,
        assistantRegistered: false,
      };
      activeLifecycle = state;
      await readInitialState(state);

      try {
        state.unsubscribeConfig = ctx.config.onChange((raw) => handleConfigChange(state, raw));
      } catch (error) {
        await warn(state, "system resources config subscription failed", error);
      }
      try {
        state.unsubscribeClick = ctx.events.on("pet:clicked", () => speakSnapshotForState(state));
      } catch (error) {
        await warn(state, "system resources click subscription failed", error);
      }

      const icon = ctx.assets.icon("system-resources");
      const commandSpecs = [
        ["show", "$t:command.show.title", "$t:command.show.description", () => setHudVisibility(state, true)],
        ["hide", "$t:command.hide.title", "$t:command.hide.description", () => setHudVisibility(state, false)],
        ["snapshot", "$t:command.snapshot.title", "$t:command.snapshot.description", () => speakSnapshotForState(state)],
      ];
      for (const [id, title, description, handler] of commandSpecs) {
        try {
          await ctx.commands.register({ id, title, description, icon }, handler);
        } catch (error) {
          await warn(state, `system resources command registration failed: ${id}`, error);
        }
      }

      if (ctx.assistant?.registerCapability) {
        try {
          await ctx.assistant.registerCapability(
            {
              id: "resources.get",
              description: "Read current CPU and RAM usage, optional GPU and disk capacity, battery state, and network throughput when the OpenPets host supports them.",
              inputSchema: { type: "object", properties: {}, additionalProperties: false },
            },
            async () => resourcesResult(await requestPoll(state, "capability")),
          );
          state.assistantRegistered = true;
        } catch (error) {
          await warn(state, "system resources assistant capability registration failed", error);
        }
      }

      await requestPoll(state, "start");
      await queueSchedule(state);
    },
    async stop() {
      if (activeLifecycle) await stopLifecycle(activeLifecycle);
    },
  });
}

async function stopLifecycle(state) {
  if (!state.active) return;
  state.active = false;
  state.generation += 1;
  state.scheduleGeneration += 1;
  state.scheduleArmed = false;
  if (state.unsubscribeConfig) {
    try { state.unsubscribeConfig(); } catch (error) { await warn(state, "system resources config unsubscribe failed", error); }
    state.unsubscribeConfig = null;
  }
  if (state.unsubscribeClick) {
    try { state.unsubscribeClick(); } catch (error) { await warn(state, "system resources click unsubscribe failed", error); }
    state.unsubscribeClick = null;
  }
  if (state.assistantRegistered && state.ctx.assistant?.unregisterCapability) {
    try {
      await state.ctx.assistant.unregisterCapability("resources.get");
    } catch (error) {
      await warn(state, "system resources assistant capability cleanup failed", error);
    }
    state.assistantRegistered = false;
  }
  try {
    await state.ctx.schedule.cancel(SCHEDULE_ID);
  } catch (error) {
    await warn(state, "system resources schedule cancellation failed during shutdown", error);
  }
  await dismissPinned(state);
  if (state.visibilityDirty) await persistVisibility(state);
  if (activeLifecycle === state) activeLifecycle = null;
}
