import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as echarts from "echarts";
import type { LiveEvent, MonitorStatus } from "../../contracts.js";
import {
  buildActionItems,
  buildOnlineTrend,
  calculateRates,
  DEFAULT_SCORE_WEIGHTS,
  detectTrendMarkers,
  eventMatchesFilter,
  groupIssues,
  healthScore,
  highLevelEntries,
  highValueGifts,
  levelTier,
  mergeTrend,
  negativeEvents,
  onlineDelta,
  scoreContributions,
  trendWindow,
  type ActionSettings,
  type EventFilter,
  type OnlinePoint,
  type ScoreDimension,
  type ScoreWeights,
  type TrendMarker
} from "./dashboard-model.js";

type Counts = Record<string, number>;
type ModalType = "gift" | "level" | "negative" | "actions" | "issues" | null;
type TopChatter = { nickname: string; count: number; level: number };
type TopGifter = { nickname: string; count: number; value: number; level: number };
type TopFan = { nickname: string; count: number; fanClubLevel: number; level: number };
type RankTab = "chat" | "gift" | "fans";
type SettingsPanel = "score" | "actions" | null;
type LevelSummary = { minLevel: number; counts: Counts; uniqueUsers: number; recentEvents: Array<Record<string, unknown>>; topChatters: TopChatter[]; topGifters: TopGifter[]; topFans: TopFan[] };

const defaultRoom = "163788489151";
const eventLabels: Record<string, string> = { gift: "礼物", enter: "进场", like: "点赞", follow: "关注", share: "分享", fansclub: "粉丝团" };
const filterItems: Array<[EventFilter, string]> = [["all", "全部"], ["gift", "礼物"], ["enter", "进场"], ["like", "点赞"], ["follow", "关注"]];
const scoreLabels: Record<ScoreDimension, string> = { online: "当前在线", enter: "进场速率", chat: "弹幕速率", like: "点赞速率", gift: "礼物速率", unique: "新增用户速率", highValueGift: "高价值礼物", highLevelEntry: "高等级用户进场", negative: "负面词控制" };
const SCORE_SETTINGS_KEY = "douyin-dashboard:score-weights:v1";
const ACTION_SETTINGS_KEY = "douyin-dashboard:action-settings:v1";
const ACTION_LIST_LIMIT = 80;
const CHAT_LIST_LIMIT = 240;
const EVENT_LIST_LIMIT = 240;
const ISSUE_LIST_LIMIT = 80;

function storedValue<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(key); return value ? { ...fallback, ...JSON.parse(value) } : fallback; }
  catch { return fallback; }
}

function number(value: number | undefined): string {
  return new Intl.NumberFormat("zh-CN").format(Math.max(0, Math.round(value ?? 0)));
}

function time(value: unknown, short = false): string {
  const date = value instanceof Date ? value : new Date(typeof value === "number" ? value : String(value));
  if (Number.isNaN(date.getTime())) return short ? "--:--" : "--:--:--";
  const result = date.toLocaleTimeString("zh-CN", { hour12: false });
  return short ? result.slice(0, 5) : result;
}

function parseMetrics(value: unknown): LiveEvent["metrics"] {
  if (value && typeof value === "object") return value as LiveEvent["metrics"];
  if (typeof value === "string") {
    try { return JSON.parse(value) as LiveEvent["metrics"]; } catch { return {}; }
  }
  return {};
}

function restoreEvent(row: Record<string, unknown>): LiveEvent {
  return {
    eventId: String(row.eventId),
    eventType: String(row.eventType) as LiveEvent["eventType"],
    receivedAt: new Date(row.receivedAt as string).toISOString(),
    userIdHash: row.userIdHash ? String(row.userIdHash) : null,
    nickname: row.nickname ? String(row.nickname) : null,
    content: row.content ? String(row.content) : null,
    metrics: parseMetrics(row.metrics)
  };
}

function iconPath(name: string): ReactNode {
  if (name === "chat") return <><path d="M4 5h16v11H9l-5 4V5Z"/><circle cx="9" cy="10.5" r=".7"/><circle cx="12" cy="10.5" r=".7"/><circle cx="15" cy="10.5" r=".7"/></>;
  if (name === "event") return <><path d="m3 18 6-7 5 4 7-10"/><circle cx="3" cy="18" r="2"/><circle cx="9" cy="11" r="2"/><circle cx="14" cy="15" r="2"/><circle cx="21" cy="5" r="2"/></>;
  if (name === "issue") return <><path d="M6 3h12v18H6zM9 7h6M9 17h6"/><path d="M12 10v3m0 2v.2"/></>;
  if (name === "rank") return <><path d="M8 4h8v4c0 4-1.8 6-4 6s-4-2-4-6V4ZM8 6H4c0 4 1.5 6 5 6m7-6h4c0 4-1.5 6-5 6M12 14v4m-4 2h8"/></>;
  if (name === "gift") return <><path d="M4 10h16v10H4zM3 7h18v4H3zM12 7v13M12 7H8.5C6.2 7 5 5.8 5 4.5S6.1 2 7.5 2C10 2 12 7 12 7Zm0 0h3.5C17.8 7 19 5.8 19 4.5S17.9 2 16.5 2C14 2 12 7 12 7Z"/></>;
  if (name === "enter") return <><circle cx="9" cy="6" r="3"/><path d="M3 20c0-4 2.5-7 6-7 2.2 0 4.1 1.2 5.1 3M14 10h7m-3-3 3 3-3 3"/></>;
  if (name === "like") return <path d="M8 10 12 3c.6-1 2-.6 2 .6V8h4.5a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17 19H8M3 10h5v10H3z"/>;
  if (name === "heart") return <path d="M12 21S3 15.6 3 8.8A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 9 2.8C21 15.6 12 21 12 21Z"/>;
  if (name === "filter") return <path d="M3 5h18l-7 8v6l-4 2v-8Z"/>;
  if (name === "export") return <><path d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5"/></>;
  if (name === "paste") return <><rect x="7" y="5" width="12" height="16" rx="2"/><path d="M10 5V3h6v2M4 17V7h3"/></>;
  return <circle cx="12" cy="12" r="8"/>;
}

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return <svg className={`ui-icon ${className}`} viewBox="0 0 24 24" aria-hidden="true">{iconPath(name)}</svg>;
}

function Panel({ title, kicker, icon, actions, children, className = "" }: {
  title: string; kicker?: string; icon?: string; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return <section className={`panel ${className}`}>
    <header className="panel-head"><h2>{icon && <Icon name={icon} className="panel-title-icon"/>}{title}{kicker && <small>{kicker}</small>}</h2>{actions && <div className="head-actions">{actions}</div>}</header>
    {children}
  </section>;
}

function MiniChart({ values, tone }: { values: number[]; tone: string }) {
  const points = values.length ? values : [0, 0];
  const max = Math.max(1, ...points);
  const coords = points.map((value, index) => `${index / Math.max(1, points.length - 1) * 180},${46 - value / max * 34}`).join(" ");
  return <svg className="mini-chart" viewBox="0 0 180 50" preserveAspectRatio="none" style={{ color: tone }}>
    <path d="M0 46H180" className="mini-grid"/><polygon points={`0,50 ${coords} 180,50`} className="mini-area"/><polyline points={coords} className="mini-line"/>
  </svg>;
}

function TrendChart({ data, markers }: { data: OnlinePoint[]; markers: TrendMarker[] }) {
  const element = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!element.current) return;
    const chart = echarts.init(element.current);
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize()); observer.observe(element.current);
    return () => { observer.disconnect(); chart.dispose(); chartRef.current = null; };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const populated = data.map((point) => point.online);
    const styles = {
      gift: { color: "#f4a13e", fill: "#2b2112", border: "#a56a23" },
      issue: { color: "#ef4d8d", fill: "#2e1420", border: "#a63362" },
      decline: { color: "#ff536e", fill: "#30171a", border: "#a53d4d" }
    } as const;
    const indexByMinute = new Map(data.map((point, index) => [point.minute, index]));
    const grouped = [...markers.reduce((groups, marker) => {
      const index = indexByMinute.get(marker.minute);
      if (index === undefined) return groups;
      const current = groups.get(marker.minute) ?? { minute: marker.minute, index, online: populated[index] ?? marker.online, markers: [] as TrendMarker[] };
      current.markers.push(marker); groups.set(marker.minute, current); return groups;
    }, new Map<string, { minute: string; index: number; online: number; markers: TrendMarker[] }>()).values()];
    const labelInterval = Math.max(0, Math.ceil(data.length / 6) - 1);
    chart.setOption({
      animation: false,
      grid: { left: 54, right: 28, top: 60, bottom: 32 },
      tooltip: {
        trigger: "item", confine: true, backgroundColor: "#0c1725", borderColor: "#2a3d55", padding: [10, 12], textStyle: { color: "#dce8f5", fontSize: 11 },
        formatter: (params: any) => {
          if (params.seriesName === "趋势事件") {
            const group = grouped[params.dataIndex];
            if (!group) return "";
            return [`<b>${time(group.minute)}</b>`, `<span style="color:#6ea8ff">●</span> 在线人数　<b>${number(group.online)}</b>`, ...group.markers.map((marker) => `<span style="color:${styles[marker.type].color}">●</span> ${marker.metricLabel}　<b>${number(marker.metricValue)}${marker.metricUnit}</b>`)].join("<br/>");
          }
          return `${time(data[params.dataIndex]?.minute)}<br/><span style="color:#6ea8ff">●</span> 在线人数　<b>${number(Number(params.value))}</b>`;
        }
      },
      xAxis: { type: "category", boundaryGap: false, data: data.map((point) => time(point.minute, true)), axisLine: { lineStyle: { color: "#26364b" } }, axisTick: { show: false }, axisLabel: { color: "#61748b", fontSize: 9, interval: labelInterval, showMinLabel: true, showMaxLabel: true } },
      yAxis: { type: "value", scale: true, splitNumber: 4, splitLine: { lineStyle: { color: "#172538" } }, axisLine: { show: false }, axisLabel: { color: "#61748b", fontSize: 9 } },
      series: [{
        name: "在线人数", type: "line", smooth: .22, showSymbol: false, data: populated,
        lineStyle: { color: "#3d9cff", width: 2 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: "rgba(61,156,255,.32)" }, { offset: 1, color: "rgba(61,156,255,0)" }]) }
      }, {
        name: "趋势事件", type: "custom", coordinateSystem: "cartesian2d", silent: false, clip: false, z: 20,
        data: grouped.map((group) => ({ value: [group.index, group.online] })),
        renderItem: (params: any, api: any) => {
          const group = grouped[params.dataIndex]!;
          const [x, y] = api.coord([group.index, group.online]);
          const chartTop = params.coordSys.y;
          const chartBottom = params.coordSys.y + params.coordSys.height;
          const gap = 6;
          const widths = group.markers.map((item) => item.label.length > 5 ? 94 : 78);
          const totalWidth = widths.reduce((sum, itemWidth) => sum + itemWidth, 0) + gap * Math.max(0, group.markers.length - 1);
          const leftBoundary = params.coordSys.x + totalWidth / 2;
          const rightBoundary = params.coordSys.x + params.coordSys.width - totalWidth / 2;
          const groupCenter = Math.max(leftBoundary, Math.min(rightBoundary, x));
          const children: any[] = [
            { type: "rect", shape: { x: x - 10, y: chartTop - 4, width: 20, height: chartBottom - chartTop + 8 }, style: { fill: "rgba(0,0,0,0)" } },
            { type: "line", shape: { x1: x, y1: chartTop, x2: x, y2: chartBottom }, style: { stroke: "#53687f", lineWidth: 1 } },
            { type: "circle", shape: { cx: x, cy: y, r: 4 }, style: { fill: styles[group.markers[0]!.type].color } },
            { type: "text", style: { x: groupCenter, y: chartTop - 42, text: time(group.minute, true), fill: "#66788f", font: '9px "Microsoft YaHei UI"', textAlign: "center" } }
          ];
          group.markers.forEach((marker, groupIndex) => {
            const width = widths[groupIndex]!;
            const previousWidth = widths.slice(0, groupIndex).reduce((sum, itemWidth) => sum + itemWidth, 0) + groupIndex * gap;
            const labelX = groupCenter - totalWidth / 2 + previousWidth + width / 2;
            const style = styles[marker.type];
            children.push(
              { type: "rect", shape: { x: labelX - width / 2, y: chartTop - 29, width, height: 17, r: 3 }, style: { fill: style.fill, stroke: style.border, lineWidth: 1 } },
              { type: "text", style: { x: labelX, y: chartTop - 25, text: marker.label, fill: style.color, font: '9px "Microsoft YaHei UI"', textAlign: "center", textVerticalAlign: "top" } }
            );
          });
          return { type: "group", children };
        }
      }, {
        type: "scatter", silent: true, symbolSize: 10,
        data: data.length ? [[data.length - 1, populated.at(-1) ?? 0]] : [],
        itemStyle: { color: "#eaf5ff", borderColor: "#3d9cff", borderWidth: 3 }, label: { show: false }, tooltip: { show: false }, z: 12
      }]
    }, { notMerge: true, lazyUpdate: true });
  }, [data, markers]);
  return <div className="trend-chart" ref={element}/>;
}

function App() {
  const [roomInput, setRoomInput] = useState(defaultRoom);
  const [status, setStatus] = useState<MonitorStatus>({ phase: "idle" });
  const [counts, setCounts] = useState<Counts>({});
  const [uniqueUsers, setUniqueUsers] = useState(0);
  const [reconnects, setReconnects] = useState(0);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [topChatters, setTopChatters] = useState<TopChatter[]>([]);
  const [topGifters, setTopGifters] = useState<TopGifter[]>([]);
  const [topFans, setTopFans] = useState<TopFan[]>([]);
  const [persistedTrend, setPersistedTrend] = useState<OnlinePoint[]>([]);
  const [trendEvents, setTrendEvents] = useState<LiveEvent[]>([]);
  const [trendAt, setTrendAt] = useState(Date.now());
  const [fixedTrendMarkers, setFixedTrendMarkers] = useState<TrendMarker[]>([]);
  const [session, setSession] = useState<Record<string, unknown> | null>(null);
  const [online, setOnline] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [rankTab, setRankTab] = useState<RankTab>("chat");
  const [onlyHighValue, setOnlyHighValue] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [highlightLevels, setHighlightLevels] = useState(true);
  const [levelDrawerOpen, setLevelDrawerOpen] = useState(false);
  const [minUserLevel, setMinUserLevel] = useState(0);
  const [draftMinUserLevel, setDraftMinUserLevel] = useState(0);
  const [levelSummary, setLevelSummary] = useState<LevelSummary | null>(null);
  const [modalType, setModalType] = useState<ModalType>(null);
  const [settingsPanel, setSettingsPanel] = useState<SettingsPanel>(null);
  const [scoreWeights, setScoreWeights] = useState<ScoreWeights>(() => storedValue(SCORE_SETTINGS_KEY, DEFAULT_SCORE_WEIGHTS));
  const [draftScoreWeights, setDraftScoreWeights] = useState<ScoreWeights>(scoreWeights);
  const [actionSettings, setActionSettings] = useState<ActionSettings>(() => storedValue(ACTION_SETTINGS_KEY, { aggregate: true, showSuggestions: true }));
  const [draftActionSettings, setDraftActionSettings] = useState<ActionSettings>(actionSettings);
  const [toast, setToast] = useState("");
  const chatListRef = useRef<HTMLDivElement>(null);
  const seenUsers = useRef(new Set<string>());
  const liveEventsRef = useRef<LiveEvent[]>([]);
  const trendEventsRef = useRef<LiveEvent[]>([]);
  const trendMinuteRef = useRef(Math.floor(Date.now() / 60_000));

  useEffect(() => {
    window.dashboard.snapshot().then((snapshot) => {
      const restored = snapshot.recentEvents.map(restoreEvent);
      setSession(snapshot.session); setCounts(snapshot.counts); setUniqueUsers(snapshot.uniqueUsers);
      setReconnects(snapshot.reconnects); setOnline(snapshot.online); setTopChatters(snapshot.topChatters);
      setTopGifters(snapshot.topGifters ?? []); setTopFans(snapshot.topFans ?? []); setPersistedTrend(snapshot.trend ?? []);
      liveEventsRef.current = restored; trendEventsRef.current = restored; setEvents(restored); setTrendEvents(restored); setTrendAt(Date.now());
      restored.forEach((event) => event.userIdHash && seenUsers.current.add(event.userIdHash));
      const restoredRoom = snapshot.session?.roomId; if (restoredRoom) setRoomInput(String(restoredRoom));
      const start = snapshot.session?.startedAt ? new Date(String(snapshot.session.startedAt)).getTime() : null;
      const end = snapshot.session?.endedAt ? new Date(String(snapshot.session.endedAt)).getTime() : null;
      setStartedAt(start); setEndedAt(end);
      const latest = restored[0]?.receivedAt; if (latest) setLastUpdatedAt(new Date(latest).getTime());
      if (snapshot.session?.status) setStatus({ phase: String(snapshot.session.status), roomId: String(restoredRoom ?? "") });
    }).catch((error) => setStatus({ phase: "failed", message: error instanceof Error ? error.message : String(error) }));
    const offEvent = window.dashboard.onEvent((event) => {
      const nextEvents = [event, ...liveEventsRef.current].slice(0, 10_000);
      liveEventsRef.current = nextEvents; setEvents(nextEvents);
      const trendCutoff = Date.now() - 17 * 60_000;
      trendEventsRef.current = [event, ...trendEventsRef.current].filter((item) => new Date(item.receivedAt).getTime() >= trendCutoff).slice(0, 100_000);
      setLastUpdatedAt(new Date(event.receivedAt).getTime());
      setCounts((current) => ({ ...current, [event.eventType]: (current[event.eventType] ?? 0) + (event.eventType === "like" ? Number(event.metrics.count ?? 1) : event.eventType === "gift" ? Number(event.metrics.giftCount ?? 1) : 1) }));
      if (event.userIdHash && !seenUsers.current.has(event.userIdHash)) { seenUsers.current.add(event.userIdHash); setUniqueUsers((value) => value + 1); }
      if (event.metrics.online !== undefined && Number.isFinite(Number(event.metrics.online))) setOnline(Math.max(0, Number(event.metrics.online)));
      if (event.eventType === "chat" && event.nickname) setTopChatters((current) => {
        const next = new Map(current.map((item) => [item.nickname, item]));
        const previous = next.get(event.nickname!) ?? { nickname: event.nickname!, count: 0, level: 0 };
        next.set(event.nickname!, { ...previous, count: previous.count + 1, level: Math.max(previous.level, Number(event.metrics.userLevel ?? 0)) });
        return [...next.values()].sort((a, b) => b.count - a.count).slice(0, 10);
      });
      if (event.eventType === "gift" && event.nickname) setTopGifters((current) => {
        const next = new Map(current.map((item) => [item.nickname, item]));
        const previous = next.get(event.nickname!) ?? { nickname: event.nickname!, count: 0, value: 0, level: 0 };
        const count = Math.max(0, Number(event.metrics.giftCount ?? 1));
        next.set(event.nickname!, { ...previous, count: previous.count + count, value: previous.value + count * Number(event.metrics.diamondCount ?? 0), level: Math.max(previous.level, Number(event.metrics.userLevel ?? 0)) });
        return [...next.values()].sort((a, b) => b.value - a.value || b.count - a.count).slice(0, 10);
      });
      if (event.nickname && Number(event.metrics.fanClubLevel ?? 0) > 0) setTopFans((current) => {
        const next = new Map(current.map((item) => [item.nickname, item]));
        const previous = next.get(event.nickname!) ?? { nickname: event.nickname!, count: 0, fanClubLevel: 0, level: 0 };
        next.set(event.nickname!, { ...previous, count: previous.count + 1, fanClubLevel: Math.max(previous.fanClubLevel, Number(event.metrics.fanClubLevel ?? 0)), level: Math.max(previous.level, Number(event.metrics.userLevel ?? 0)) });
        return [...next.values()].sort((a, b) => b.fanClubLevel - a.fanClubLevel || b.count - a.count).slice(0, 10);
      });
    });
    const offStatus = window.dashboard.onStatus((next) => {
      setStatus(next);
      if (next.title || next.anchorName || next.roomId) {
        setSession((current) => ({ ...(current ?? {}), ...(next.roomId ? { roomId: next.roomId } : {}), ...(next.title ? { title: next.title } : {}), ...(next.anchorName ? { anchorName: next.anchorName } : {}) }));
      }
      if (next.phase === "stopped" || next.phase === "failed") setEndedAt(Date.now());
    });
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { offEvent(); offStatus(); clearInterval(timer); };
  }, []);

  const isRunning = ["starting", "collecting", "waiting", "connecting"].includes(status.phase);
  useEffect(() => {
    if (!isRunning) return;
    const minute = Math.floor(now / 60_000);
    if (minute === trendMinuteRef.current) return;
    trendMinuteRef.current = minute;
    setTrendEvents(trendEventsRef.current);
    setTrendAt(now);
  }, [now, isRunning]);

  useEffect(() => {
    if (autoScroll && chatListRef.current) chatListRef.current.scrollTop = 0;
  }, [events, autoScroll]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (minUserLevel === 0) { setLevelSummary(null); return; }
    let active = true;
    const load = () => window.dashboard.levelSummary(minUserLevel).then((summary) => {
      if (active) setLevelSummary(summary);
    }).catch((error) => {
      if (active) setToast(error instanceof Error ? error.message : String(error));
    });
    void load();
    const timer = isRunning ? window.setInterval(load, 2500) : null;
    return () => { active = false; if (timer !== null) clearInterval(timer); };
  }, [minUserLevel, isRunning]);
  const elapsedEnd = isRunning ? now : endedAt ?? startedAt ?? now;
  const elapsed = startedAt ? Math.max(0, Math.floor((elapsedEnd - startedAt) / 1000)) : 0;
  const duration = `${String(Math.floor(elapsed / 3600)).padStart(2, "0")}:${String(Math.floor(elapsed % 3600 / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const metricNow = isRunning ? now : lastUpdatedAt ?? now;
  const sourceEvents = useMemo(() => {
    if (minUserLevel === 0) return events;
    if (levelSummary) return levelSummary.recentEvents.map(restoreEvent);
    return events.filter((event) => Number(event.metrics.userLevel ?? 0) >= minUserLevel);
  }, [events, levelSummary, minUserLevel]);
  const displayCounts = minUserLevel > 0 && levelSummary ? levelSummary.counts : counts;
  const displayUniqueUsers = minUserLevel > 0 && levelSummary ? levelSummary.uniqueUsers : uniqueUsers;
  const displayTopChatters = minUserLevel > 0 && levelSummary ? levelSummary.topChatters : topChatters;
  const displayTopGifters = minUserLevel > 0 && levelSummary ? levelSummary.topGifters : topGifters;
  const displayTopFans = minUserLevel > 0 && levelSummary ? levelSummary.topFans : topFans;
  const rates = useMemo(() => calculateRates(sourceEvents, metricNow), [sourceEvents, metricNow]);
  const trendStart = startedAt ? Math.max(startedAt, trendAt - 17 * 60_000) : trendAt - 17 * 60_000;
  const roomTrendFull = useMemo(() => mergeTrend(persistedTrend, buildOnlineTrend(trendEvents, trendStart, trendAt)), [persistedTrend, trendEvents, trendStart, trendAt]);
  const roomTrend = useMemo(() => trendWindow(roomTrendFull), [roomTrendFull]);
  const detectedTrendMarkers = useMemo(() => detectTrendMarkers(roomTrendFull.filter((point) => new Date(point.minute).getTime() + 60_000 <= trendAt)), [roomTrendFull, trendAt]);
  useEffect(() => {
    setFixedTrendMarkers((current) => {
      const known = new Set(current.map((marker) => marker.id));
      const additions = detectedTrendMarkers.filter((marker) => !known.has(marker.id));
      return additions.length ? [...current, ...additions].sort((a, b) => new Date(a.minute).getTime() - new Date(b.minute).getTime()) : current;
    });
  }, [detectedTrendMarkers]);
  const visibleTrendMarkers = useMemo(() => {
    const firstMinute = roomTrend[0]?.minute;
    return firstMinute ? fixedTrendMarkers.filter((marker) => marker.minute >= firstMinute) : [];
  }, [roomTrend, fixedTrendMarkers]);
  const filteredTrend = useMemo(() => buildOnlineTrend(sourceEvents, startedAt, metricNow), [sourceEvents, startedAt, metricNow]);
  const delta = useMemo(() => onlineDelta(roomTrend), [roomTrend]);
  const highGifts = useMemo(() => highValueGifts(sourceEvents), [sourceEvents]);
  const highGiftIds = useMemo(() => new Set(highGifts.map((event) => event.eventId)), [highGifts]);
  const highLevels = useMemo(() => highLevelEntries(sourceEvents), [sourceEvents]);
  const negatives = useMemo(() => negativeEvents(sourceEvents), [sourceEvents]);
  const issues = useMemo(() => groupIssues(sourceEvents), [sourceEvents]);
  const scoreInput = { online, rates, highValueGiftCount: highGifts.length, highLevelEntryCount: highLevels.length, negativeCount: negatives.length };
  const score = healthScore(scoreInput, scoreWeights);
  const contributions = scoreContributions(scoreInput, scoreWeights);
  const chats = useMemo(() => sourceEvents.filter((event) => event.eventType === "chat"), [sourceEvents]);
  const highValueEvents = useMemo(() => sourceEvents
    .filter((event) => event.eventType !== "gift" || Number(event.metrics.giftCount ?? 0) > 0)
    .filter((event) => ["gift", "enter", "like", "follow", "share", "fansclub"].includes(event.eventType))
    .filter((event) => eventMatchesFilter(event, eventFilter))
    .filter((event) => !onlyHighValue ||
      event.eventType === "gift" && highGiftIds.has(event.eventId) ||
      event.eventType === "enter" && Number(event.metrics.userLevel ?? 0) >= 20 ||
      event.eventType === "like" && Number(event.metrics.count ?? 0) >= 50 ||
      event.eventType === "follow"), [sourceEvents, eventFilter, onlyHighValue, highGiftIds]);

  const statusText = status.phase === "failed" ? "连接异常" : isRunning && status.phase !== "waiting" ? "采集中" : "待命";
  const healthText = score >= 75 ? "正常" : score >= 55 ? "关注" : "预警";
  const latestTitle = String(session?.title ?? "等待获取直播间标题");
  const currentOnline = online || roomTrend.at(-1)?.online || 0;
  const metricCards = [
    { label: "当前在线", value: currentOnline, note: minUserLevel > 0 ? "房间总在线（不分等级）" : `近5分钟 ${delta >= 0 ? "+" : ""}${number(delta)}`, tone: "#3d9cff", values: roomTrend.map((point) => point.online) },
    { label: "进场人数", value: displayCounts.enter ?? 0, note: `进场速率 ${number(rates.enter)}/分`, tone: "#41c9dd", values: filteredTrend.map((point) => point.enter) },
    { label: "弹幕数", value: displayCounts.chat ?? 0, note: `弹幕速率 ${number(rates.chat)}/分`, tone: "#ef4d8d", values: filteredTrend.map((point) => point.chat) },
    { label: "点赞数", value: displayCounts.like ?? 0, note: `点赞速率 ${number(rates.like)}/分`, tone: "#ff536e", values: filteredTrend.map((point) => point.like) },
    { label: "礼物数", value: displayCounts.gift ?? 0, note: `礼物速率 ${number(rates.gift)}/分`, tone: "#f4a13e", values: filteredTrend.map((point) => point.gift) },
    { label: "独立用户", value: displayUniqueUsers, note: `新增速率 ${number(rates.unique)}/分`, tone: "#35d59b", values: filteredTrend.map((point) => point.unique) }
  ];
  const actionItems = useMemo(() => buildActionItems(sourceEvents, fixedTrendMarkers, actionSettings), [sourceEvents, fixedTrendMarkers, actionSettings]);
  const visibleActionItems = actionItems.slice(0, ACTION_LIST_LIMIT);
  const visibleChats = chats.slice(0, CHAT_LIST_LIMIT);
  const visibleHighValueEvents = highValueEvents.slice(0, EVENT_LIST_LIMIT);
  const visibleIssues = issues.slice(0, ISSUE_LIST_LIMIT);
  const rankRows = rankTab === "chat" ? displayTopChatters.map((item) => ({ ...item, detail: `${number(item.count)}条` }))
    : rankTab === "gift" ? displayTopGifters.map((item) => ({ ...item, detail: `${number(item.value)}钻` }))
      : displayTopFans.map((item) => ({ ...item, detail: `团Lv${item.fanClubLevel} · 互动${number(item.count)}次` }));

  async function start(): Promise<void> {
    if (!roomInput.trim()) return;
    const startTime = Date.now();
    liveEventsRef.current = []; trendEventsRef.current = []; trendMinuteRef.current = Math.floor(startTime / 60_000);
    setCounts({}); setUniqueUsers(0); setEvents([]); setTrendEvents([]); setTrendAt(startTime); setFixedTrendMarkers([]); setTopChatters([]); setTopGifters([]); setTopFans([]); setPersistedTrend([]); setOnline(0); seenUsers.current.clear();
    setStartedAt(startTime); setEndedAt(null); setLastUpdatedAt(null); setSession({ roomId: roomInput.trim() });
    try { const result = await window.dashboard.start(roomInput.trim()); setSession({ roomId: result.roomId }); }
    catch (error) { setStatus({ phase: "failed", message: error instanceof Error ? error.message : String(error) }); setEndedAt(Date.now()); }
  }

  async function stop(): Promise<void> {
    setStatus((current) => ({ ...current, phase: "stopping" }));
    await window.dashboard.stop();
  }

  async function pasteRoom(): Promise<void> {
    try {
      const text = await window.dashboard.readClipboard();
      const match = text.match(/(?:live\.douyin\.com\/)?(\d{5,20})/);
      if (match) { setRoomInput(match[1]!); setToast("已粘贴房间号"); } else setToast("剪贴板中未识别到抖音房间号");
    } catch { setToast("当前未授权读取剪贴板"); }
  }

  async function exportCsv(): Promise<void> {
    try {
      const result = await window.dashboard.exportCsv();
      if (!result.canceled) setToast(`已导出 ${number(result.rowCount)} 条数据`);
    } catch (error) { setToast(error instanceof Error ? error.message : String(error)); }
  }

  function openLevelFilter(): void {
    setDraftMinUserLevel(minUserLevel);
    setLevelDrawerOpen(true);
  }

  function applyLevelFilter(): void {
    const level = Math.max(0, Math.min(60, Math.floor(draftMinUserLevel)));
    setLevelSummary(null);
    setMinUserLevel(level);
    setLevelDrawerOpen(false);
    setToast(level > 0 ? `全局仅显示 Lv${level} 及以上用户数据` : "已显示全部用户数据");
  }

  function openScoreSettings(): void { setDraftScoreWeights({ ...scoreWeights }); setSettingsPanel("score"); }
  function saveScoreSettings(): void {
    const total = Object.values(draftScoreWeights).reduce((sum, value) => sum + value, 0);
    if (total !== 100) { setToast("评分权重总和必须等于100"); return; }
    setScoreWeights(draftScoreWeights); localStorage.setItem(SCORE_SETTINGS_KEY, JSON.stringify(draftScoreWeights)); setSettingsPanel(null); setToast("评分权重已保存");
  }
  function openActionSettings(): void { setDraftActionSettings({ ...actionSettings }); setSettingsPanel("actions"); }
  function saveActionSettings(): void {
    setActionSettings(draftActionSettings); localStorage.setItem(ACTION_SETTINGS_KEY, JSON.stringify(draftActionSettings)); setSettingsPanel(null); setToast("行动提示设置已保存");
  }

  const modalRows = modalType === "gift" ? highGifts.map((event) => [event.nickname ?? "匿名用户", event.metrics.giftName ?? "礼物", `×${event.metrics.giftCount ?? 1}　价值${Number(event.metrics.diamondCount ?? 0) * Number(event.metrics.giftCount ?? 1)}钻石`, time(event.receivedAt)])
    : modalType === "level" ? highLevels.map((event) => [event.nickname ?? "匿名用户", `Lv${event.metrics.userLevel ?? 0}`, event.content ?? "进入直播间", time(event.receivedAt)])
      : modalType === "negative" ? negatives.map((event) => [event.nickname ?? "匿名用户", event.content ?? "负面反馈", "负面词命中", time(event.receivedAt)])
        : modalType === "issues" ? issues.map((issue) => [issue.title, issue.label, `${issue.count}次 · ${issue.latestUser}`, time(issue.latestAt)])
          : modalType === "actions" ? actionItems.map((item) => [item.title, item.body, actionSettings.showSuggestions ? item.suggestion : "已隐藏", time(item.at)]) : [];
  const modalTitle = modalType === "gift" ? "高价值礼物明细" : modalType === "level" ? "高等级用户进场明细" : modalType === "negative" ? "负面词详情" : modalType === "issues" ? "完整问题列表" : "完整行动提示列表";
  const modalColumns = modalType === "gift" ? ["送出用户", "礼物", "数量与价值", "时间"] : modalType === "level" ? ["用户", "等级", "进场动作", "时间"] : modalType === "negative" ? ["用户", "最近内容", "类型", "时间"] : modalType === "issues" ? ["问题", "标签", "出现情况", "时间"] : ["提示类型", "触发内容", "建议动作", "时间"];

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"/><strong>抖音直播·指挥舱</strong></div>
      <div className="top-field room-field"><label>房间号</label><input value={roomInput} onChange={(event) => setRoomInput(event.target.value.replace(/\D/g, ""))} disabled={isRunning}/><button className="icon-button" onClick={pasteRoom} disabled={isRunning} title={isRunning ? "采集中不可更换房间" : "从剪贴板粘贴房间号或直播间链接"} aria-label="粘贴房间号"><Icon name="paste"/></button></div>
      <div className="top-field title-field"><label>直播间标题</label><span>{latestTitle}</span></div>
      <div className="top-spacer"/>
      <div className="status-meta"><i className={`status-dot ${isRunning ? "on" : ""}`}/><em>{statusText}</em><span className="meta-sep"/><span>已连接</span><b>{duration}</b><span>重连 {reconnects} 次</span><span>最后更新</span><b>{lastUpdatedAt ? time(lastUpdatedAt) : "--:--:--"}</b></div>
      <div className="toolbar">
        <button className={`toolbar-button ${isRunning ? "stop" : ""}`} onClick={isRunning ? stop : start}><span>{isRunning ? "□ 停止" : "▶ 开始"}</span></button>
        <button id="levelFilterButton" className={`toolbar-button ${minUserLevel > 0 ? "active" : ""}`} onClick={openLevelFilter}><Icon name="filter"/><span>{minUserLevel > 0 ? `Lv${minUserLevel}+` : "筛选"}</span></button>
        <button className="toolbar-button" onClick={exportCsv}><Icon name="export"/><span>导出</span></button>
      </div>
    </header>

    <div className="dashboard-grid">
      <Panel title="直播态势" kicker="实时评分" className="health-panel" actions={<><button onClick={() => setToast("九个维度先标准化，再按当前权重计算总分")}>ⓘ评分规则</button><button id="scoreSettingsButton" onClick={openScoreSettings}>⚙设置</button></>}>
        <div className="health-main"><div className="shield">✓</div><div className="health-copy"><small>{score >= 75 ? "整体表现稳定，互动活跃度良好" : "互动状态需要关注"}</small><strong>{healthText}</strong></div><div className="score"><span>态势评分</span><b>{score}</b>/100</div></div>
        <div className="health-note">建议：{negatives.length ? "及时回应负面反馈，保持互动节奏。" : "保持互动引导，关注礼物转化和高等级用户进场。"}</div>
        <div className="health-factors">
          <button className="factor gift" onClick={() => setModalType("gift")}><Icon name="gift"/><span><b>高价值礼物数</b><small>评分贡献 +{Math.round(contributions.highValueGift)}</small></span><strong>{highGifts.length}件</strong></button>
          <button className="factor high-level-factor" onClick={() => setModalType("level")}><Icon name="enter"/><span><b>高等级用户进场</b><small>评分贡献 +{Math.round(contributions.highLevelEntry)}</small></span><strong>{highLevels.length}人</strong></button>
          <button className="factor negative" onClick={() => setModalType("negative")}><span className="warning-icon">!</span><span><b>负面词出现</b><small>评分扣减 -{Math.round(scoreWeights.negative - contributions.negative)}</small></span><strong>{negatives.length}次</strong></button>
        </div>
      </Panel>

      <section className="metrics">
        {metricCards.map((card) => <article className="metric-card" style={{ "--tone": card.tone } as React.CSSProperties} key={card.label}><span className="metric-label">{card.label}</span><b className="metric-value">{number(card.value)}</b><div className="metric-sub">{card.note}</div><MiniChart values={card.values} tone={card.tone}/></article>)}
      </section>

      <Panel title="在线人数趋势" kicker="最近15分钟" className="trend-panel" actions={<span>当前 <b>{number(currentOnline)}</b>　平均 <b>{number(roomTrend.reduce((sum, point) => sum + point.online, 0) / Math.max(1, roomTrend.filter((point) => point.online).length))}</b></span>}><TrendChart data={roomTrend} markers={visibleTrendMarkers}/></Panel>

      <Panel title="行动提示" className="actions-panel" actions={<button id="actionSettingsButton" onClick={openActionSettings}>⚙设置</button>}>
        <div className="action-list">{visibleActionItems.map((item, index) => <div className={`action-card ${item.tone}`} key={`${item.type}-${item.at}-${item.body}-${index}`}><b>{item.title}</b><span>{item.body}{actionSettings.showSuggestions && <><br/>建议：{item.suggestion}</>}</span><time>{time(item.at)}</time></div>)}{!actionItems.length && <div className="empty">等待触发行动提示</div>}</div>
        <button className="actions-foot" onClick={() => setModalType("actions")}>查看更多提示⌄</button>
      </Panel>

      <Panel title="实时弹幕" kicker={`${number(rates.chat)}条/分钟`} icon="chat" className="chat-panel">
        <div className="scroll-list chat-list" ref={chatListRef}>{visibleChats.map((event) => <div className={`chat-row ${highlightLevels && Number(event.metrics.userLevel ?? 0) >= 20 ? "high-level" : ""}`} key={event.eventId}><span className={`level ${levelTier(event.metrics.userLevel)}`}>Lv{event.metrics.userLevel ?? 0}</span><b>{event.nickname ?? "匿名用户"}</b><span>{event.content}</span><time>{time(event.receivedAt)}</time></div>)}{!chats.length && <div className="empty">等待弹幕数据</div>}</div>
        <div className="panel-controls"><button className={autoScroll ? "active" : ""} onClick={() => setAutoScroll((value) => !value)}>自动滚动<i/></button><button className={highlightLevels ? "active" : ""} onClick={() => setHighlightLevels((value) => !value)}>高亮高等级用户<i/></button></div>
      </Panel>

      <Panel title="高价值事件流" icon="event" className="event-panel" actions={<div className="event-filters">{filterItems.map(([value, label]) => <button className={eventFilter === value ? "active" : ""} aria-pressed={eventFilter === value} onClick={() => setEventFilter(value)} key={value}>{label}</button>)}</div>}>
        <div className="scroll-list event-list">{visibleHighValueEvents.map((event) => <div className={`event-row ${event.eventType}`} key={event.eventId}><Icon name={event.eventType === "gift" ? "gift" : event.eventType === "enter" ? "enter" : event.eventType === "like" ? "like" : event.eventType === "follow" ? "heart" : "event"}/><time>{time(event.receivedAt)}</time><b>{event.nickname ?? "匿名用户"}</b><span>{event.eventType === "gift" ? `${event.metrics.giftName ?? "礼物"} ×${event.metrics.giftCount ?? 1}` : event.content ?? eventLabels[event.eventType]}{event.eventType === "gift" && event.metrics.diamondCount !== undefined && <em>价值 {Number(event.metrics.diamondCount) * Number(event.metrics.giftCount ?? 0)} 钻石</em>}</span></div>)}{!highValueEvents.length && <div className="empty">当前筛选下暂无事件</div>}</div>
        <div className="panel-controls"><button id="onlyHighValueButton" className={onlyHighValue ? "active" : ""} onClick={() => setOnlyHighValue((value) => !value)}>只看高价值<i/></button></div>
      </Panel>

      <Panel title="问题队列" kicker="需关注" icon="issue" className="issues-panel" actions={<span>{issues.length}个问题</span>}>
        <div className="issues-list">{visibleIssues.map((issue) => <div className="issue-card" key={issue.key}><div><b title={issue.title}>{issue.title}</b><strong>{issue.label}</strong><em>{issue.severity}</em></div><p><span>出现{issue.count}次</span><time>最近{time(issue.latestAt)}</time></p><small>用户：{issue.latestUser}</small></div>)}{!issues.length && <div className="empty">未识别到直播间问题</div>}</div>
        <button className="more-button" onClick={() => setModalType("issues")}>查看更多问题⌄</button>
      </Panel>

      <Panel title="榜单" icon="rank" className="rank-panel" actions={<span>本场</span>}>
        <div className="rank-tabs"><button data-rank="chat" className={rankTab === "chat" ? "active" : ""} onClick={() => setRankTab("chat")}>发言榜</button><button data-rank="gift" className={rankTab === "gift" ? "active" : ""} onClick={() => setRankTab("gift")}>送礼榜</button><button data-rank="fans" className={rankTab === "fans" ? "active" : ""} onClick={() => setRankTab("fans")}>粉丝团榜</button></div>
        <ol>{rankRows.map((user, index) => <li key={`${rankTab}-${user.nickname}-${index}`}><i>{index + 1}</i><div><b>{user.nickname}</b><span className={`level ${levelTier(user.level)}`}>Lv{user.level}</span></div><span>{user.detail}</span></li>)}</ol>{!rankRows.length && <div className="empty rank-empty">暂无排行</div>}
      </Panel>
    </div>

    <footer><span>ⓘ 数据说明　所有数据均实时采集，可能存在延迟</span><span>时区：Asia/Shanghai　原型版本：v2.0</span></footer>

    <aside className={`level-drawer ${levelDrawerOpen ? "open" : ""}`}><h3>按用户等级筛选</h3><p>全局仅统计所选等级及以上用户产生的互动数据和事件。</p><label>最低用户等级</label><div className="level-presets">{[0,10,20,30,40,50].map((level) => <button data-level={level} className={draftMinUserLevel === level ? "active" : ""} onClick={() => setDraftMinUserLevel(level)} key={level}>{level === 0 ? "全部" : `Lv${level}+`}</button>)}</div><input type="number" min="0" max="60" value={draftMinUserLevel} onChange={(event) => setDraftMinUserLevel(Number(event.target.value))}/><small>当前在线和在线趋势是房间级数据，不支持按用户等级拆分。</small><div className="drawer-actions"><button className="secondary" onClick={() => setLevelDrawerOpen(false)}>取消</button><button id="applyLevelFilter" onClick={applyLevelFilter}>应用筛选</button></div></aside>
    {levelDrawerOpen && <button className="drawer-mask" aria-label="关闭等级筛选" onClick={() => setLevelDrawerOpen(false)}/>}

    <aside className={`settings-drawer ${settingsPanel === "score" ? "open" : ""}`}>
      <h3>直播态势评分权重</h3><p>九个维度权重合计必须为100。负面词维度表示“负面反馈控制得分”，出现次数越多，得分越低。</p>
      <div className="weight-list">{(Object.keys(scoreLabels) as ScoreDimension[]).map((key) => <label className="weight-row" key={key}><span>{scoreLabels[key]}</span><input type="range" min="0" max="40" step="1" value={draftScoreWeights[key]} onChange={(event) => setDraftScoreWeights((current) => ({ ...current, [key]: Number(event.target.value) }))}/><b>{draftScoreWeights[key]}</b></label>)}</div>
      <div className={`weight-total ${Object.values(draftScoreWeights).reduce((sum, value) => sum + value, 0) === 100 ? "valid" : ""}`}><span>当前合计</span><b>{Object.values(draftScoreWeights).reduce((sum, value) => sum + value, 0)} / 100</b></div>
      <button className="reset-settings" onClick={() => setDraftScoreWeights({ ...DEFAULT_SCORE_WEIGHTS })}>恢复默认权重</button>
      <div className="drawer-actions"><button className="secondary" onClick={() => setSettingsPanel(null)}>取消</button><button onClick={saveScoreSettings}>保存设置</button></div>
    </aside>

    <aside className={`settings-drawer ${settingsPanel === "actions" ? "open" : ""}`}>
      <h3>行动提示设置</h3><p>控制行动提示卡片的生成方式。关闭聚合后，每个触发事件都会生成独立卡片。</p>
      <div className="setting-options">
        <button className={draftActionSettings.aggregate ? "active" : ""} onClick={() => setDraftActionSettings((current) => ({ ...current, aggregate: !current.aggregate }))}><span><b>聚合同类事件</b><small>同类型事件按60秒窗口合并展示</small></span><i/></button>
        <button className={draftActionSettings.showSuggestions ? "active" : ""} onClick={() => setDraftActionSettings((current) => ({ ...current, showSuggestions: !current.showSuggestions }))}><span><b>显示建议</b><small>在卡片中显示主播下一步建议动作</small></span><i/></button>
      </div>
      <div className="drawer-actions"><button className="secondary" onClick={() => setSettingsPanel(null)}>取消</button><button onClick={saveActionSettings}>保存设置</button></div>
    </aside>
    {settingsPanel && <button className="drawer-mask" aria-label="关闭设置" onClick={() => setSettingsPanel(null)}/>}

    {modalType && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalType(null); }}><div className="modal"><header><h3>{modalTitle}</h3><button onClick={() => setModalType(null)}>×</button></header><div className="detail-summary"><span>本次会话共 {modalRows.length} 条记录</span><b>按最新触发时间排序</b></div><div className="detail-table"><div className="detail-row head">{modalColumns.map((column) => <span key={column}>{column}</span>)}</div>{modalRows.map((row, index) => <div className="detail-row" key={`${row[0]}-${index}`}>{row.map((cell, cellIndex) => cellIndex === 0 ? <b key={cellIndex}>{cell}</b> : <span key={cellIndex}>{cell}</span>)}</div>)}</div></div></div>}
    {status.message && status.phase === "failed" && <div className="error-banner">采集异常：{status.message}</div>}
    <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
  </main>;
}

export default App;
