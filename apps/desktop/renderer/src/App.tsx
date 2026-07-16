import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import type { LiveEvent, MonitorStatus } from "../../contracts.js";

type Counts = Record<string, number>;
type TrendPoint = { minute: string; chat: number; enter: number; like: number; gift: number };
type FeedEvent = LiveEvent & { key?: string };

const defaultRoom = "https://live.douyin.com/557481980778";
const labels: Record<string, string> = { gift: "礼物", enter: "进场", like: "点赞", follow: "关注", share: "分享", fansclub: "粉丝团" };

function number(value: number | undefined): string { return new Intl.NumberFormat("zh-CN").format(value ?? 0); }
function time(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "--:--:--" : date.toLocaleTimeString("zh-CN", { hour12: false });
}

function TrendChart({ data }: { data: TrendPoint[] }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!element.current) return;
    const chart = echarts.init(element.current);
    chart.setOption({
      animationDuration: 350,
      tooltip: { trigger: "axis", backgroundColor: "#111a27", borderColor: "#26364d", textStyle: { color: "#dbe8f5" } },
      grid: { left: 42, right: 20, top: 24, bottom: 30 },
      xAxis: { type: "category", boundaryGap: false, data: data.map((x) => time(x.minute).slice(0, 5)), axisLine: { lineStyle: { color: "#263244" } }, axisLabel: { color: "#74849b" } },
      yAxis: { type: "value", splitLine: { lineStyle: { color: "#172131" } }, axisLabel: { color: "#74849b" } },
      series: [
        { name: "弹幕", type: "line", smooth: true, showSymbol: false, data: data.map((x) => x.chat), lineStyle: { color: "#39a0ff", width: 2 }, areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: "rgba(57,160,255,.34)" }, { offset: 1, color: "rgba(57,160,255,0)" }]) } },
        { name: "进场", type: "line", smooth: true, showSymbol: false, data: data.map((x) => x.enter), lineStyle: { color: "#39e6ae", width: 1.5 } }
      ]
    });
    const resize = new ResizeObserver(() => chart.resize()); resize.observe(element.current);
    return () => { resize.disconnect(); chart.dispose(); };
  }, [data]);
  return <div className="trend-chart" ref={element} />;
}

function Panel({ title, kicker, children, className = "" }: { title: string; kicker?: string; children: React.ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><header className="panel-title"><div><span>{title}</span>{kicker && <small>{kicker}</small>}</div><i /></header>{children}</section>;
}

function App() {
  const [roomInput, setRoomInput] = useState(defaultRoom);
  const [status, setStatus] = useState<MonitorStatus>({ phase: "idle" });
  const [counts, setCounts] = useState<Counts>({});
  const [uniqueUsers, setUniqueUsers] = useState(0);
  const [reconnects, setReconnects] = useState(0);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [topChatters, setTopChatters] = useState<Array<{ nickname: string; count: number }>>([]);
  const [session, setSession] = useState<Record<string, unknown> | null>(null);
  const [online, setOnline] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const seenUsers = useRef(new Set<string>());

  useEffect(() => {
    window.dashboard.snapshot().then((snapshot) => {
      setSession(snapshot.session); setCounts(snapshot.counts); setUniqueUsers(snapshot.uniqueUsers);
      setReconnects(snapshot.reconnects); setOnline(snapshot.online); setTrend(snapshot.trend); setTopChatters(snapshot.topChatters);
      setEvents(snapshot.recentEvents.map((row) => ({
        eventId: String(row.eventId), eventType: String(row.eventType) as LiveEvent["eventType"],
        receivedAt: new Date(row.receivedAt as string).toISOString(), userIdHash: null,
        nickname: row.nickname ? String(row.nickname) : null, content: row.content ? String(row.content) : null,
        metrics: row.metrics && typeof row.metrics === "object" ? row.metrics as LiveEvent["metrics"] : {}
      })));
    });
    const offEvent = window.dashboard.onEvent((event) => {
      setEvents((current) => [event, ...current].slice(0, 200));
      setCounts((current) => ({ ...current, [event.eventType]: (current[event.eventType] ?? 0) + (event.eventType === "like" ? event.metrics.count ?? 1 : 1) }));
      if (event.userIdHash && !seenUsers.current.has(event.userIdHash)) { seenUsers.current.add(event.userIdHash); setUniqueUsers((v) => v + 1); }
      if (event.metrics.online !== undefined) setOnline(event.metrics.online);
      if (event.eventType === "chat" && event.nickname) setTopChatters((current) => {
        const next = new Map(current.map((item) => [item.nickname, item.count])); next.set(event.nickname!, (next.get(event.nickname!) ?? 0) + 1);
        return [...next].map(([nickname, count]) => ({ nickname, count })).sort((a, b) => b.count - a.count).slice(0, 8);
      });
      const minute = new Date(event.receivedAt); minute.setSeconds(0, 0); const key = minute.toISOString();
      setTrend((current) => {
        const next = [...current]; let point = next.find((item) => item.minute === key);
        if (!point) { point = { minute: key, chat: 0, enter: 0, like: 0, gift: 0 }; next.push(point); }
        if (event.eventType in point) point[event.eventType as "chat" | "enter" | "like" | "gift"] += 1;
        return next.slice(-20);
      });
    });
    const offStatus = window.dashboard.onStatus((next) => setStatus(next));
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { offEvent(); offStatus(); clearInterval(timer); };
  }, []);

  const isRunning = ["starting", "collecting"].includes(status.phase);
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const duration = `${String(Math.floor(elapsed / 3600)).padStart(2, "0")}:${String(Math.floor(elapsed % 3600 / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const chats = events.filter((event) => event.eventType === "chat");
  const highValue = events.filter((event) => ["gift", "enter", "like", "follow", "share", "fansclub"].includes(event.eventType));
  const issues = useMemo(() => chats.filter((event) => /(多少钱|价格|链接|听不见|卡顿|怎么买|哪里买)/.test(event.content ?? "")).slice(0, 8), [chats]);
  const health = Math.max(35, Math.min(98, 62 + Math.round((counts.chat ?? 0) / 80) + Math.round((counts.enter ?? 0) / 30) + Math.min(12, counts.gift ?? 0)));

  async function start() {
    if (!roomInput.trim()) return;
    setCounts({}); setUniqueUsers(0); setTrend([]); setEvents([]); setTopChatters([]); setOnline(0); seenUsers.current.clear(); setStartedAt(Date.now());
    try { const result = await window.dashboard.start(roomInput.trim()); setSession({ roomId: result.roomId }); }
    catch (error) { setStatus({ phase: "failed", message: error instanceof Error ? error.message : String(error) }); }
  }
  async function stop() { await window.dashboard.stop(); }

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">◉</span><strong>抖音直播 · 指挥舱</strong><em>LIVE OPS</em></div>
      <div className="room-control"><label>直播间</label><input value={roomInput} onChange={(e) => setRoomInput(e.target.value)} disabled={isRunning} /><button className="paste" onClick={() => navigator.clipboard.readText().then(setRoomInput)}>粘贴</button></div>
      <div className="live-meta"><span className={`pulse ${isRunning ? "on" : ""}`} />{isRunning ? "采集中" : status.phase === "failed" ? "连接异常" : "待命"}<b>{duration}</b><small>重连 {reconnects} 次</small></div>
      <button className={isRunning ? "stop-button" : "start-button"} onClick={isRunning ? stop : start}>{isRunning ? "Ⅱ 停止" : "▶ 开始采集"}</button>
    </header>

    <div className="dashboard-grid">
      <Panel title="直播态势" kicker="LOCAL RULE ENGINE" className="health-panel">
        <div className="health-row"><div className="shield">✓</div><div><small>连接与互动状态</small><strong>{isRunning ? "正常" : "待命"}</strong></div><div className="score"><span>{health}</span>/ 100</div></div>
        <p>{isRunning ? "数据流持续进入，当前未检测到采集阻塞。" : "输入直播间链接后开始采集；历史数据已载入。"}</p>
        <div className="health-flags"><span className="green">弹幕 {number(counts.chat)}</span><span className="amber">礼物 {number(counts.gift)}</span><span className="red">问题 {issues.length}</span></div>
      </Panel>

      {[
        ["当前在线", online, "实时房间统计", "blue"], ["进入人数", counts.enter, "本次会话", "cyan"],
        ["弹幕数", counts.chat, "本次会话", "pink"], ["点赞数", counts.like, "累计动作", "rose"],
        ["礼物数", counts.gift, "礼物事件", "orange"], ["独立用户", uniqueUsers, "哈希去重", "green"]
      ].map(([label, value, note, tone]) => <section className={`metric-card ${tone}`} key={String(label)}><small>{label}</small><strong>{number(Number(value ?? 0))}</strong><span>{note}</span><div className="spark"><i /><i /><i /><i /><i /><i /></div></section>)}

      <Panel title="互动趋势" kicker="最近 20 分钟" className="trend-panel"><TrendChart data={trend} /></Panel>
      <Panel title="行动提示" kicker="实时规则" className="actions-panel">
        <div className="action-item blue"><b>高活跃用户</b><span>{topChatters[0] ? `${topChatters[0].nickname} 已发 ${topChatters[0].count} 条弹幕` : "等待活跃用户出现"}</span></div>
        <div className="action-item red"><b>问题集中度</b><span>{issues.length ? `识别到 ${issues.length} 条购买或体验问题` : "暂未发现高频问题"}</span></div>
        <div className="action-item amber"><b>礼物反馈</b><span>{counts.gift ? `已捕获 ${counts.gift} 条礼物事件，建议及时致谢` : "暂未捕获礼物事件"}</span></div>
      </Panel>

      <Panel title="实时弹幕" kicker={`${chats.length} 条可见`} className="chat-panel"><div className="scroll-list">{chats.slice(0, 40).map((event) => <div className="feed-line" key={event.eventId}><time>{time(event.receivedAt)}</time><b>{event.nickname ?? "匿名用户"}</b><span>{event.content}</span></div>)}{!chats.length && <div className="empty">等待弹幕数据</div>}</div></Panel>
      <Panel title="高价值事件流" kicker="礼物 · 进场 · 关注" className="event-panel"><div className="scroll-list">{highValue.slice(0, 35).map((event) => <div className={`event-line ${event.eventType}`} key={event.eventId}><span className="event-icon">{event.eventType === "gift" ? "◆" : event.eventType === "like" ? "♥" : event.eventType === "enter" ? "↳" : "+"}</span><time>{time(event.receivedAt)}</time><b>{event.nickname ?? "匿名用户"}</b><span>{event.content ?? labels[event.eventType]}</span></div>)}{!highValue.length && <div className="empty">等待互动事件</div>}</div></Panel>
      <Panel title="问题队列" kicker={`${issues.length} 个命中`} className="issues-panel"><div className="scroll-list">{issues.map((event) => <div className="issue-card" key={event.eventId}><b>{event.content}</b><span>{event.nickname ?? "匿名用户"} · {time(event.receivedAt)}</span></div>)}{!issues.length && <div className="empty">未命中价格、购买、链接或体验问题</div>}</div></Panel>
      <Panel title="弹幕榜" kicker="本场排行" className="rank-panel"><ol>{topChatters.slice(0, 6).map((user, index) => <li key={user.nickname}><i>{index + 1}</i><span>{user.nickname}</span><b>{number(user.count)} 条</b></li>)}</ol>{!topChatters.length && <div className="empty">暂无排行</div>}</Panel>
    </div>
    <footer><span>数据库实时写入 · 用户 ID 仅保存 SHA-256 哈希</span><span>房间 {String(session?.roomId ?? session?.platform_room_id ?? "未选择")} · Asia/Shanghai</span></footer>
  </main>;
}

export default App;
