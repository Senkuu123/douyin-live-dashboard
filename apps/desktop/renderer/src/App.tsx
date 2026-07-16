import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as echarts from "echarts";
import type { LiveEvent, MonitorStatus } from "../../contracts.js";
import {
  buildOnlineTrend,
  calculateRates,
  eventMatchesFilter,
  groupIssues,
  healthScore,
  highLevelEntries,
  highValueGifts,
  levelTier,
  negativeEvents,
  onlineDelta,
  type EventFilter,
  type OnlinePoint
} from "./dashboard-model.js";

type Counts = Record<string, number>;
type ModalType = "gift" | "level" | "negative" | "actions" | "issues" | null;
type TopChatter = { nickname: string; count: number; level: number };
type LevelSummary = { minLevel: number; counts: Counts; uniqueUsers: number; recentEvents: Array<Record<string, unknown>>; topChatters: TopChatter[] };

const defaultRoom = "163788489151";
const eventLabels: Record<string, string> = { gift: "礼物", enter: "进场", like: "点赞", follow: "关注", share: "分享", fansclub: "粉丝团" };
const filterItems: Array<[EventFilter, string]> = [["all", "全部"], ["gift", "礼物"], ["enter", "进场"], ["like", "点赞"], ["follow", "关注"]];

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

function TrendChart({ data }: { data: OnlinePoint[] }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!element.current) return;
    const chart = echarts.init(element.current);
    const populated = data.map((point) => point.online);
    const giftIndex = data.reduce((best, point, index) => point.gift > data[best]!.gift ? index : best, 0);
    const declineIndex = populated.length > 2 ? populated.reduce((best, value, index) => index > 0 && value - populated[index - 1]! < populated[best]! - populated[Math.max(0, best - 1)]! ? index : best, 1) : 0;
    chart.setOption({
      animationDuration: 300,
      grid: { left: 54, right: 28, top: 54, bottom: 32 },
      tooltip: { trigger: "axis", backgroundColor: "#0c1725", borderColor: "#2a3d55", textStyle: { color: "#dce8f5", fontSize: 11 } },
      xAxis: { type: "category", boundaryGap: false, data: data.map((point) => time(point.minute, true)), axisLine: { lineStyle: { color: "#26364b" } }, axisTick: { show: false }, axisLabel: { color: "#61748b", fontSize: 9, interval: 4 } },
      yAxis: { type: "value", scale: true, splitNumber: 4, splitLine: { lineStyle: { color: "#172538" } }, axisLine: { show: false }, axisLabel: { color: "#61748b", fontSize: 9 } },
      series: [{
        name: "在线人数", type: "line", smooth: .22, showSymbol: false, data: populated,
        lineStyle: { color: "#3d9cff", width: 2 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: "rgba(61,156,255,.32)" }, { offset: 1, color: "rgba(61,156,255,0)" }]) },
        markLine: { symbol: "none", silent: true, lineStyle: { color: "#53687f", width: 1 }, label: { show: true, position: "insideEndTop", distance: 4, padding: [3, 8], borderRadius: 3, color: "#f0a640", backgroundColor: "#2b2112", borderColor: "#a56a23", borderWidth: 1, fontSize: 9 }, data: data[giftIndex]?.gift ? [{ xAxis: giftIndex, label: { formatter: `${time(data[giftIndex]!.minute, true)}  礼物高峰` } }] : [] },
        markPoint: { symbolSize: 7, label: { show: false }, itemStyle: { color: "#ff536e" }, data: declineIndex > 0 && populated[declineIndex]! < populated[declineIndex - 1]! ? [{ coord: [declineIndex, populated[declineIndex]], name: "在线下降" }] : [] }
      }]
    });
    const observer = new ResizeObserver(() => chart.resize()); observer.observe(element.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [data]);
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
  const [session, setSession] = useState<Record<string, unknown> | null>(null);
  const [online, setOnline] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [onlyHighValue, setOnlyHighValue] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [highlightLevels, setHighlightLevels] = useState(true);
  const [levelDrawerOpen, setLevelDrawerOpen] = useState(false);
  const [minUserLevel, setMinUserLevel] = useState(0);
  const [draftMinUserLevel, setDraftMinUserLevel] = useState(0);
  const [levelSummary, setLevelSummary] = useState<LevelSummary | null>(null);
  const [modalType, setModalType] = useState<ModalType>(null);
  const [toast, setToast] = useState("");
  const chatListRef = useRef<HTMLDivElement>(null);
  const seenUsers = useRef(new Set<string>());

  useEffect(() => {
    window.dashboard.snapshot().then((snapshot) => {
      const restored = snapshot.recentEvents.map(restoreEvent);
      setSession(snapshot.session); setCounts(snapshot.counts); setUniqueUsers(snapshot.uniqueUsers);
      setReconnects(snapshot.reconnects); setOnline(snapshot.online); setTopChatters(snapshot.topChatters);
      setEvents(restored); restored.forEach((event) => event.userIdHash && seenUsers.current.add(event.userIdHash));
      const restoredRoom = snapshot.session?.roomId; if (restoredRoom) setRoomInput(String(restoredRoom));
      const start = snapshot.session?.startedAt ? new Date(String(snapshot.session.startedAt)).getTime() : null;
      const end = snapshot.session?.endedAt ? new Date(String(snapshot.session.endedAt)).getTime() : null;
      setStartedAt(start); setEndedAt(end);
      const latest = restored[0]?.receivedAt; if (latest) setLastUpdatedAt(new Date(latest).getTime());
      if (snapshot.session?.status) setStatus({ phase: String(snapshot.session.status), roomId: String(restoredRoom ?? "") });
    }).catch((error) => setStatus({ phase: "failed", message: error instanceof Error ? error.message : String(error) }));
    const offEvent = window.dashboard.onEvent((event) => {
      setEvents((current) => [event, ...current].slice(0, 10_000));
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
    });
    const offStatus = window.dashboard.onStatus((next) => { setStatus(next); if (next.phase === "stopped" || next.phase === "failed") setEndedAt(Date.now()); });
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { offEvent(); offStatus(); clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (autoScroll && chatListRef.current) chatListRef.current.scrollTop = 0;
  }, [events, autoScroll]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  const isRunning = ["starting", "collecting", "waiting", "connecting"].includes(status.phase);
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
  const rates = useMemo(() => calculateRates(sourceEvents, metricNow), [sourceEvents, metricNow]);
  const roomTrend = useMemo(() => buildOnlineTrend(events, metricNow), [events, metricNow]);
  const filteredTrend = useMemo(() => buildOnlineTrend(sourceEvents, metricNow), [sourceEvents, metricNow]);
  const delta = useMemo(() => onlineDelta(roomTrend), [roomTrend]);
  const highGifts = useMemo(() => highValueGifts(sourceEvents), [sourceEvents]);
  const highLevels = useMemo(() => highLevelEntries(sourceEvents), [sourceEvents]);
  const negatives = useMemo(() => negativeEvents(sourceEvents), [sourceEvents]);
  const issues = useMemo(() => groupIssues(sourceEvents), [sourceEvents]);
  const score = healthScore({ online, rates, highValueGiftCount: highGifts.length, highLevelEntryCount: highLevels.length, negativeCount: negatives.length });
  const chats = useMemo(() => sourceEvents.filter((event) => event.eventType === "chat"), [sourceEvents]);
  const highValueEvents = useMemo(() => sourceEvents.filter((event) => ["gift", "enter", "like", "follow", "share", "fansclub"].includes(event.eventType)).filter((event) => eventMatchesFilter(event, eventFilter)).filter((event) => !onlyHighValue || event.eventType === "gift" && highGifts.includes(event) || event.eventType === "enter" && Number(event.metrics.userLevel ?? 0) >= 20 || event.eventType === "like" && Number(event.metrics.count ?? 0) >= 50 || event.eventType === "follow"), [sourceEvents, eventFilter, onlyHighValue, highGifts]);

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
    { label: "独立用户", value: displayUniqueUsers, note: `新增独立 ${number(rates.unique)}`, tone: "#35d59b", values: filteredTrend.map((_, index) => Math.min(displayUniqueUsers, Math.round(displayUniqueUsers * (index + 1) / filteredTrend.length))) }
  ];
  const actionItems = [
    highLevels[0] ? { tone: "blue", title: "高等级用户进场", body: `${highLevels[0].nickname ?? "匿名用户"}进入直播间`, suggestion: "主播欢迎并关注互动", at: highLevels[0].receivedAt, fresh: true } : null,
    negatives[0] ? { tone: "red", title: "负面词出现", body: negatives[0].content ?? "出现负面反馈", suggestion: "关注评论区并及时回复", at: negatives[0].receivedAt, fresh: true } : null,
    highGifts[0] ? { tone: "orange", title: "礼物待感谢", body: `${highGifts[0].nickname ?? "匿名用户"}送出${highGifts[0].metrics.giftName ?? "礼物"}×${highGifts[0].metrics.giftCount ?? 1}`, suggestion: "主播及时感谢用户", at: highGifts[0].receivedAt, fresh: true } : null,
    delta < 0 ? { tone: "red", title: "在线人数下降", body: `近5分钟减少${number(Math.abs(delta))}人`, suggestion: "增加互动并切换福利品", at: new Date(metricNow).toISOString(), fresh: false } : null
  ].filter(Boolean) as Array<{ tone: string; title: string; body: string; suggestion: string; at: string; fresh: boolean }>;

  async function start(): Promise<void> {
    if (!roomInput.trim()) return;
    setCounts({}); setUniqueUsers(0); setEvents([]); setTopChatters([]); setOnline(0); seenUsers.current.clear();
    setStartedAt(Date.now()); setEndedAt(null); setLastUpdatedAt(null); setSession({ roomId: roomInput.trim() });
    try { const result = await window.dashboard.start(roomInput.trim()); setSession({ roomId: result.roomId }); }
    catch (error) { setStatus({ phase: "failed", message: error instanceof Error ? error.message : String(error) }); setEndedAt(Date.now()); }
  }

  async function stop(): Promise<void> {
    setStatus((current) => ({ ...current, phase: "stopping" }));
    await window.dashboard.stop();
  }

  async function pasteRoom(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      const match = text.match(/(?:live\.douyin\.com\/)?(\d{5,20})/);
      if (match) setRoomInput(match[1]!); else setToast("未识别到房间号");
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

  const modalRows = modalType === "gift" ? highGifts.map((event) => [event.nickname ?? "匿名用户", event.metrics.giftName ?? "礼物", `×${event.metrics.giftCount ?? 1}　价值${Number(event.metrics.diamondCount ?? 0) * Number(event.metrics.giftCount ?? 1)}钻石`, time(event.receivedAt)])
    : modalType === "level" ? highLevels.map((event) => [event.nickname ?? "匿名用户", `Lv${event.metrics.userLevel ?? 0}`, event.content ?? "进入直播间", time(event.receivedAt)])
      : modalType === "negative" ? negatives.map((event) => [event.nickname ?? "匿名用户", event.content ?? "负面反馈", "负面词命中", time(event.receivedAt)])
        : modalType === "issues" ? issues.map((issue) => [issue.title, issue.label, `${issue.count}次 · ${issue.latestContent}`, time(issue.latestAt)])
          : modalType === "actions" ? actionItems.map((item) => [item.title, item.body, item.suggestion, time(item.at)]) : [];
  const modalTitle = modalType === "gift" ? "高价值礼物明细" : modalType === "level" ? "高等级用户进场明细" : modalType === "negative" ? "负面词详情" : modalType === "issues" ? "完整问题列表" : "完整行动提示列表";
  const modalColumns = modalType === "gift" ? ["送出用户", "礼物", "数量与价值", "时间"] : modalType === "level" ? ["用户", "等级", "进场动作", "时间"] : modalType === "negative" ? ["用户", "最近内容", "类型", "时间"] : modalType === "issues" ? ["问题", "标签", "出现情况", "时间"] : ["提示类型", "触发内容", "建议动作", "时间"];

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"/><strong>抖音直播·指挥舱</strong></div>
      <div className="top-field room-field"><label>房间号</label><input value={roomInput} onChange={(event) => setRoomInput(event.target.value.replace(/\D/g, ""))} disabled={isRunning}/><button className="icon-button" onClick={pasteRoom} title="粘贴房间号"><Icon name="paste"/></button></div>
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
      <Panel title="直播态势" kicker="实时评分" className="health-panel" actions={<><button onClick={() => setToast("评分由在线、四项速率、独立用户及三类关键事件共同计算")}>ⓘ评分规则</button><button onClick={() => setToast("态势规则设置将在口径确认后接入")}>⚙设置</button></>}>
        <div className="health-main"><div className="shield">✓</div><div className="health-copy"><small>{score >= 75 ? "整体表现稳定，互动活跃度良好" : "互动状态需要关注"}</small><strong>{healthText}</strong></div><div className="score"><span>态势评分</span><b>{score}</b>/100</div></div>
        <div className="health-note">建议：{negatives.length ? "及时回应负面反馈，保持互动节奏。" : "保持互动引导，关注礼物转化和高等级用户进场。"}</div>
        <div className="health-factors">
          <button className="factor gift" onClick={() => setModalType("gift")}><Icon name="gift"/><span><b>高价值礼物数</b><small>评分贡献 +{Math.min(8, highGifts.length * 4)}</small></span><strong>{highGifts.length}件</strong></button>
          <button className="factor level" onClick={() => setModalType("level")}><Icon name="enter"/><span><b>高等级用户进场</b><small>评分贡献 +{Math.min(8, highLevels.length * 2)}</small></span><strong>{highLevels.length}人</strong></button>
          <button className="factor negative" onClick={() => setModalType("negative")}><span className="warning-icon">!</span><span><b>负面词出现</b><small>评分扣减 -{Math.min(20, negatives.length * 2)}</small></span><strong>{negatives.length}次</strong></button>
        </div>
      </Panel>

      <section className="metrics">
        {metricCards.map((card) => <article className="metric-card" style={{ "--tone": card.tone } as React.CSSProperties} key={card.label}><span className="metric-label">{card.label}</span><b className="metric-value">{number(card.value)}</b><div className="metric-sub">{card.note}</div><MiniChart values={card.values} tone={card.tone}/></article>)}
      </section>

      <Panel title="在线人数趋势" kicker="最近20分钟" className="trend-panel" actions={<span>当前 <b>{number(currentOnline)}</b>　平均 <b>{number(roomTrend.reduce((sum, point) => sum + point.online, 0) / Math.max(1, roomTrend.filter((point) => point.online).length))}</b></span>}><TrendChart data={roomTrend}/></Panel>

      <Panel title="行动提示" className="actions-panel" actions={<button onClick={() => setToast("行动提示设置将在规则确认后接入")}>⚙设置</button>}>
        <div className="action-list">{actionItems.map((item, index) => <div className={`action-card ${item.tone}`} key={`${item.title}-${item.at}`}><b>{item.title}</b><span>{item.body}<br/>建议：{item.suggestion}</span><time>{time(item.at)}</time>{item.fresh && index < 3 && <i>NEW</i>}</div>)}{!actionItems.length && <div className="empty">等待触发行动提示</div>}</div>
        <button className="actions-foot" onClick={() => setModalType("actions")}>查看更多提示⌄</button>
      </Panel>

      <Panel title="实时弹幕" kicker={`${number(rates.chat)}条/分钟`} icon="chat" className="chat-panel">
        <div className="scroll-list chat-list" ref={chatListRef}>{chats.map((event) => <div className={`chat-row ${highlightLevels && Number(event.metrics.userLevel ?? 0) >= 20 ? "high-level" : ""}`} key={event.eventId}><span className={`level ${levelTier(event.metrics.userLevel)}`}>Lv{event.metrics.userLevel ?? 0}</span><b>{event.nickname ?? "匿名用户"}</b><span>{event.content}</span><time>{time(event.receivedAt)}</time></div>)}{!chats.length && <div className="empty">等待弹幕数据</div>}</div>
        <div className="panel-controls"><button className={autoScroll ? "active" : ""} onClick={() => setAutoScroll((value) => !value)}>自动滚动<i/></button><button className={highlightLevels ? "active" : ""} onClick={() => setHighlightLevels((value) => !value)}>高亮高等级用户<i/></button></div>
      </Panel>

      <Panel title="高价值事件流" icon="event" className="event-panel" actions={<div className="event-filters">{filterItems.map(([value, label]) => <button className={eventFilter === value ? "active" : ""} aria-pressed={eventFilter === value} onClick={() => setEventFilter(value)} key={value}>{label}</button>)}</div>}>
        <div className="scroll-list event-list">{highValueEvents.map((event) => <div className={`event-row ${event.eventType}`} key={event.eventId}><Icon name={event.eventType === "gift" ? "gift" : event.eventType === "enter" ? "enter" : event.eventType === "like" ? "like" : event.eventType === "follow" ? "heart" : "event"}/><time>{time(event.receivedAt)}</time><b>{event.nickname ?? "匿名用户"}</b><span>{event.content ?? eventLabels[event.eventType]}{event.eventType === "gift" && event.metrics.diamondCount !== undefined && <em>价值 {Number(event.metrics.diamondCount) * Number(event.metrics.giftCount ?? 1)} 钻石</em>}</span></div>)}{!highValueEvents.length && <div className="empty">当前筛选下暂无事件</div>}</div>
        <div className="panel-controls"><button className={onlyHighValue ? "active" : ""} onClick={() => setOnlyHighValue((value) => !value)}>只看高价值<i/></button></div>
      </Panel>

      <Panel title="问题队列" kicker="需关注" icon="issue" className="issues-panel" actions={<span>{issues.length}个问题</span>}>
        <div className="issues-list">{issues.map((issue) => <div className="issue-card" key={issue.key}><div><b>{issue.title}</b><strong>{issue.label}</strong><em>{issue.severity}</em></div><p><span>出现{issue.count}次</span><time>最近{time(issue.latestAt)}</time></p><small>用户：{issue.latestContent}</small></div>)}{!issues.length && <div className="empty">未识别到集中问题</div>}</div>
        <button className="more-button" onClick={() => setModalType("issues")}>查看更多问题⌄</button>
      </Panel>

      <Panel title="榜单" icon="rank" className="rank-panel" actions={<span>本场</span>}>
        <div className="rank-tabs"><button className="active">发言榜</button><button>送礼榜</button><button>粉丝团榜</button></div>
        <ol>{displayTopChatters.map((user, index) => <li key={`${user.nickname}-${index}`}><i>{index + 1}</i><div><b>{user.nickname}</b><span className={`level ${levelTier(user.level)}`}>Lv{user.level}</span></div><span>{number(user.count)}条</span></li>)}</ol>{!displayTopChatters.length && <div className="empty">暂无排行</div>}
      </Panel>
    </div>

    <footer><span>ⓘ 数据说明　所有数据均实时采集，可能存在延迟</span><span>时区：Asia/Shanghai　原型版本：v2.0</span></footer>

    <aside className={`level-drawer ${levelDrawerOpen ? "open" : ""}`}><h3>按用户等级筛选</h3><p>全局仅统计所选等级及以上用户产生的互动数据和事件。</p><label>最低用户等级</label><div className="level-presets">{[0,10,20,30,40,50].map((level) => <button data-level={level} className={draftMinUserLevel === level ? "active" : ""} onClick={() => setDraftMinUserLevel(level)} key={level}>{level === 0 ? "全部" : `Lv${level}+`}</button>)}</div><input type="number" min="0" max="60" value={draftMinUserLevel} onChange={(event) => setDraftMinUserLevel(Number(event.target.value))}/><small>当前在线和在线趋势是房间级数据，不支持按用户等级拆分。</small><div className="drawer-actions"><button className="secondary" onClick={() => setLevelDrawerOpen(false)}>取消</button><button id="applyLevelFilter" onClick={applyLevelFilter}>应用筛选</button></div></aside>
    {levelDrawerOpen && <button className="drawer-mask" aria-label="关闭等级筛选" onClick={() => setLevelDrawerOpen(false)}/>}

    {modalType && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalType(null); }}><div className="modal"><header><h3>{modalTitle}</h3><button onClick={() => setModalType(null)}>×</button></header><div className="detail-summary"><span>本次会话共 {modalRows.length} 条记录</span><b>按最新触发时间排序</b></div><div className="detail-table"><div className="detail-row head">{modalColumns.map((column) => <span key={column}>{column}</span>)}</div>{modalRows.map((row, index) => <div className="detail-row" key={`${row[0]}-${index}`}>{row.map((cell, cellIndex) => cellIndex === 0 ? <b key={cellIndex}>{cell}</b> : <span key={cellIndex}>{cell}</span>)}</div>)}</div></div></div>}
    {status.message && status.phase === "failed" && <div className="error-banner">采集异常：{status.message}</div>}
    <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
  </main>;
}

export default App;
