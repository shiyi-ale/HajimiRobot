import {useConsoleCopy} from '../lib/console-copy';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ChevronLeft, ChevronRight, Clock3, Film, ListFilter, Play, Radio, VideoOff } from 'lucide-react';
import { api, labels, localDay } from '../lib/intelligence';

import type {ReviewLocation} from '../lib/console-types';
import {useCopy} from '../lib/copy';

type Clip = { id: string; start: number; end: number; status: string; error?: string };
type Event = { id: string; start: number; end: number; label: string; duration_sec: number; confidence: number; frames: number; clips: Pick<Clip, 'id' | 'status'>[] };
type Review = Event & { labels: string[]; event_ids: string[]; event_count: number; span_sec: number; detected_sec: number; unobserved_sec: number; no_target_sec: number; revision: string; reviewed: boolean };
type Coverage = { start: number; end: number; state: string; reason: string };
const coverageColors: Record<string, string> = { observed_target: '#2dd4bf', observed_empty: '#64748b', unobserved: '#334155', not_elapsed: '#182231' };
const reasonNames: Record<string, string> = { detection: '检测到目标', completed_inference_no_target: '完成推理但无目标', unknown: '未观测 · 原因未知', future: '尚未发生', scheduled_skip: '调度未送推理', inference_pending: '已送推理，未有成功结果', inference_unavailable: '推理未就绪', inference_error: '推理失败', stream_offline: '已确认断流' };
const colors: Record<string, string> = { eating: '#fb923c', playing: '#2dd4bf', rest: '#818cf8', sitting: '#38bdf8', stretching: '#e879f9', yawning: '#facc15' };
const clock = (seconds: number) => new Date(seconds * 1000).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const dayStart = (day: string) => Date.parse(`${day}T00:00:00+08:00`) / 1000;

export default function NvrReview({ camera, source, running, tick, location }: { camera: string; source: string; running: boolean; tick: number; location?:ReviewLocation }) {
  const tr=useConsoleCopy();
  const {t,behavior} = useCopy();
  const duration=(seconds:number)=>seconds<60?`${seconds.toFixed(1)} ${t('秒','s')}`:`${Math.floor(seconds/60)} ${t('分','min')} ${Math.floor(seconds%60)} ${t('秒','s')}`;
  const intentApplied = useRef<ReviewLocation | undefined>(undefined);
  const [day, setDay] = useState(localDay());
  const [reviewSource, setReviewSource] = useState(source);
  const [events, setEvents] = useState<Event[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [coverage, setCoverage] = useState<Coverage[]>([]);
  const [rawCount, setRawCount] = useState(0);
  const [clips, setClips] = useState<Clip[]>([]);
  const [label, setLabel] = useState('');
  const [tab, setTab] = useState<'events' | 'clips'>('events');
  const [selected, setSelected] = useState<string>('');
  const [clip, setClip] = useState<Clip | null>(null);
  const [cursor, setCursor] = useState(dayStart(day) + 12 * 3600);
  const [hours, setHours] = useState(24);
  const [live, setLive] = useState(false);
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(tr("选择事件或时间轴上的录像片段开始回看。"));
  const [loading, setLoading] = useState(true);
  const [liveError, setLiveError] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const start = dayStart(day);
  const span = hours * 3600;
  const viewStart = hours === 24 ? start : Math.max(start, Math.min(start + 86400 - span, cursor - span / 2));
  const viewEnd = viewStart + span;
  const filtered = useMemo(() => events.filter(e => !label || e.label === label).sort((a, b) => b.start - a.start), [events, label]);
  const filteredReviews = useMemo(() => reviews.filter(r => !label || r.labels.includes(label)).sort((a, b) => b.start - a.start), [reviews, label]);
  const visibleClips = clips.filter(c => c.start < start + 86400 && c.end > start);
  const currentReview = reviews.find(r => r.id === selected || r.event_ids.includes(selected));
  const currentEvent = reviews.find(r => r.id === selected) || events.find(e => e.id === selected);
  const rows = tab === 'events' ? filteredReviews : visibleClips;
  const maxPage = Math.max(0, Math.ceil(rows.length / 30) - 1);

  useEffect(() => { setReviewSource(location?.source || source); if(location)setDay(location.date); }, [source, camera, location]);
  useEffect(() => {
    setClip(null); setSelected(''); setLive(false); setCursor(dayStart(day) + 12 * 3600);
    setPage(0); setNotice(tr("选择事件或时间轴上的录像片段开始回看。"));
  }, [day, camera, reviewSource]);
  useEffect(() => { setPage(0); }, [label, tab]);
  useEffect(() => { if (page > maxPage) setPage(maxPage); }, [page, maxPage]);
  useEffect(() => {
    let active = true;
    setEvents([]); setReviews([]); setCoverage([]); setRawCount(0); setClips([]); setLoading(true); setError('');
    const load = async () => {
      try {
        const query = new URLSearchParams({ camera_id: camera, source: reviewSource, day });
        const [e, c, t] = await Promise.all([api(`/events?${query}`), api(`/clips?${query}`), api(`/review/timeline?${query}`)]);
        if (active) {
          setEvents(e.events); setClips(c.clips); setCoverage(t.coverage); setRawCount(t.raw_event_count);
          setReviews(t.reviews.map((r: any) => ({...r, label:r.labels[0], duration_sec:r.detected_sec, frames:r.event_count})));
          setError('');
        }
      } catch (e) { if (active) setError((e as Error).message); }
      finally { if (active) setLoading(false); }
    };
    void load(); const interval = setInterval(load, 5000);
    return () => { active = false; clearInterval(interval); };
  }, [day, camera, reviewSource]);

  const openClip = (next: Clip, timestamp = next.start) => {
    setLive(false); setClip(next); setError(''); setCursor(timestamp);
    pendingSeek.current = Math.max(0, timestamp - next.start);
    if (clip?.id === next.id && player.current?.readyState) {
      player.current.currentTime = Math.min(pendingSeek.current, Math.max(0, player.current.duration - .05));
      pendingSeek.current = null;
    }
    setNotice(tr("已定位录像；点击播放器播放。"));
  };
  const seek = (timestamp: number) => {
    setCursor(timestamp); setSelected(''); setLive(false);
    const found = visibleClips.find(c => c.status === 'ready' && c.start <= timestamp && c.end > timestamp);
    if (found) openClip(found, timestamp);
    else { setClip(null); setNotice(`${clock(timestamp)} ${t('无可播放录像。空白区域不代表没有宠物。','No recording. A gap does not mean the pet was absent.')}`); }
  };
  const selectEvent = (event: Event) => {
    setSelected(event.id); setCursor(Math.max(start, event.start)); setLive(false);
    const linked = event.clips.map(c => clips.find(full => full.id === c.id)).filter((c): c is Clip => !!c && c.status === 'ready');
    const playable = linked.find(c => c.start <= event.start && c.end > event.start) || linked[0];
    if (playable) openClip(playable, Math.max(playable.start, event.start));
    else { setClip(null); setNotice(tr("该事件仅有检测记录，未关联可播放录像，或录像尚未就绪 / 已过期。")); }
  };
  useEffect(()=>{
    if(!location || loading || intentApplied.current===location || day!==location.date || reviewSource!==location.source)return;
    if(location.eventId){const event=events.find(e=>e.id===location.eventId);if(event)selectEvent(event);else if(location.timestamp!==undefined)seek(location.timestamp);}
    else if(location.timestamp!==undefined)seek(location.timestamp);
    intentApplied.current=location;
  },[location,loading,events,day,reviewSource]);
  const markViewed = async (review: Review) => {
    try {
      await api(`/review/${review.id}/status`, 'PUT', {revision:review.revision, reviewed:true});
      setReviews(all => all.map(r => r.id === review.id ? {...r, reviewed:true} : r));
    } catch (e) { setError((e as Error).message); }
  };
  const shiftDay = (delta: number) => setDay(new Date((start + delta * 86400) * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }));
  const geometry = (a: number, b: number) => ({ left: `${Math.max(0, (a - viewStart) / span * 100)}%`, width: `${Math.max(.25, (Math.min(viewEnd, b) - Math.max(viewStart, a)) / span * 100)}%` });

  return <section className="care-timeline overflow-hidden rounded-2xl border border-slate-800 bg-[#101923] text-slate-200 shadow-xl shadow-slate-900/10">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/60 px-5 py-4">
      <div className="flex items-center gap-3"><span className="rounded-lg bg-teal-400/10 p-2 text-teal-300"><Film size={20}/></span><div><h2 className="font-bold text-white">{tr("事件回看")}</h2><p className="text-xs text-slate-400">REVIEW · Asia/Shanghai · UTC+8</p></div></div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg border border-slate-600 bg-slate-800"><button aria-label={tr("前一天")} className="p-2 hover:text-teal-300" onClick={() => shiftDay(-1)}><ChevronLeft size={16}/></button><input aria-label={tr("回看日期")} type="date" value={day} onChange={e => { if (e.target.value) setDay(e.target.value); }} className="w-36 bg-transparent py-2 text-sm text-white [color-scheme:dark]"/><button aria-label={tr("后一天")} className="p-2 hover:text-teal-300" onClick={() => shiftDay(1)}><ChevronRight size={16}/></button></div>
        <button onClick={() => setDay(localDay())} className="rounded-lg border border-slate-600 px-3 py-2 text-xs hover:bg-slate-800">{tr("今天")}</button>
        <select aria-label={tr("回看数据来源")} value={reviewSource} onChange={e => setReviewSource(e.target.value)} className="rounded-lg border border-slate-600 bg-slate-800 px-2 py-2 text-xs"><option value="local-video">{tr("本地视频 · 测试")}</option><option value="legacy">{t('旧版记录','Legacy records')}</option><option value="camera">{tr("摄像头")}</option><option value="test">{tr("合成案例 · 非真实检测")}</option></select>
      </div>
    </div>
    {reviewSource !== 'camera' && <div className="border-b border-amber-300/10 bg-amber-300/5 px-5 py-2 text-xs text-amber-200">{reviewSource === 'test' ? tr("合成案例数据，仅用于界面与统计演示，不代表真实宠物；未生成对应录像。") : tr("本地视频测试来源，录像时间为本次处理采集时间。")}</div>}
    {error && <p role="alert" className="m-4 rounded-lg bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
    <div className="grid lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 border-b border-slate-700/60 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-2 px-4 py-3 text-xs"><span className="flex items-center gap-2"><Camera size={15}/>{camera === 'primary' ? tr("主摄像头") : tr("副摄像头")}<span className="text-slate-500">/</span>{live ? tr("实时预览") : tr("历史回放")}</span><button disabled={!running || reviewSource !== source} onClick={() => { setLive(v => !v); setLiveError(false); }} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 disabled:opacity-30 ${live ? 'border-teal-400 text-teal-300' : 'border-slate-600 text-slate-300'}`}><Radio size={12}/>{tr("实时")}</button></div>
        <div className="relative flex h-[42vh] max-h-[420px] min-h-[220px] w-full items-center justify-center overflow-hidden bg-[#080d13]">
          {live ? <><img className="h-full w-full object-contain" alt={tr("摄像头实时画面")} src={`/api/v1/cameras/${camera}/preview.jpg?t=${tick}`} onError={() => setLiveError(true)} onLoad={() => setLiveError(false)}/>{liveError && <p className="absolute rounded-lg bg-slate-900/90 p-4 text-sm">{tr("暂无实时画面，等待视频流恢复。")}</p>}</> : clip ? <video ref={player} key={clip.id} controls preload="metadata" className="h-full w-full" src={`/api/v1/clips/${clip.id}/video`} onError={() => setError(tr("录像加载失败，文件可能已清理或无法解码。"))} onLoadedMetadata={() => { if (player.current && pendingSeek.current !== null) { player.current.currentTime = Math.min(pendingSeek.current, Math.max(0, player.current.duration - .05)); pendingSeek.current = null; } }} onTimeUpdate={() => { if (player.current) setCursor(clip.start + player.current.currentTime); }} onPlay={() => { if (currentReview && !currentReview.reviewed) void markViewed(currentReview); }} onEnded={() => setNotice(tr("当前录像已结束，可选择下一个事件继续回看。"))}/> : <div className="max-w-sm space-y-3 px-6 text-center"><VideoOff size={36} className="mx-auto text-slate-600"/><p className="text-sm text-slate-300">{currentEvent ? `${behavior(currentEvent.label)} · ${clock(currentEvent.start)}` : tr("从时间线开始，回看每一次活动")}</p><p className="text-xs leading-6 text-slate-500">{tr(notice)}</p></div>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-slate-400"><span className="flex items-center gap-2"><Clock3 size={14}/><span className="font-mono text-teal-300">{clock(cursor)}</span>{currentEvent && <span style={{ color: colors[currentEvent.label] }}>{behavior(currentEvent.label)} · {duration(currentEvent.duration_sec)}</span>}</span><span>{live ? tr("实时画面不代表历史录像覆盖") : clip ? `${clock(clip.start)} — ${clock(clip.end)}` : tr("未选择可播放录像")}</span></div>
        <div className="border-t border-slate-700/60 px-4 py-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400"><span>{rawCount} {tr("条原始片段 →")}{reviews.length} {tr("个回看组 · 合并不增加行为时长")}</span>{currentReview && <button disabled={currentReview.reviewed} onClick={() => void markViewed(currentReview)} className="rounded border border-slate-600 px-2 py-1 text-teal-300 disabled:text-slate-500">{currentReview.reviewed ? tr("已查看") : tr("标记当前组已查看")}</button>}</div>
          {currentReview && <p className="mb-3 text-xs leading-6 text-slate-400">{tr("当前组：")}{currentReview.labels.map(l => behavior(l)).join(' / ')} · {currentReview.event_count} {tr("个原始片段 · 跨度")}{duration(currentReview.span_sec)} {tr("· 有效检测")}{duration(currentReview.detected_sec)} {tr("· 已观测无目标")}{duration(currentReview.no_target_sec)} {tr("· 未观测")}{duration(currentReview.unobserved_sec)}</p>}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3 text-xs"><span className="font-semibold text-white">{tr("时间轴")}</span><span className="text-slate-500">{tr("灰色：可播放录像 · 彩色：行为事件")}</span></div><div className="flex items-center gap-1"><button aria-label={tr("上一个时间窗口")} onClick={() => seek(Math.max(start, cursor - span / 2))} className="p-1 hover:text-teal-300"><ChevronLeft size={15}/></button>{[1/60, .25, 1, 6, 24].map(h => <button key={h} onClick={() => setHours(h)} className={`rounded px-2 py-1 text-xs ${hours === h ? 'bg-teal-400/15 text-teal-300' : 'text-slate-400 hover:bg-slate-800'}`}>{h < 1 ? `${h*60}${t('分钟','min')}` : `${h}${t('小时','h')}`}</button>)}<button aria-label={tr("下一个时间窗口")} onClick={() => seek(Math.min(start + 86399, cursor + span / 2))} className="p-1 hover:text-teal-300"><ChevronRight size={15}/></button></div></div>
          <div className="relative mx-2 select-none pb-2">
            <div className="mb-3 flex justify-between text-[10px] font-mono text-slate-500">{Array.from({ length: 7 }, (_, i) => <span key={i}>{i === 6 && viewEnd === start + 86400 ? '24:00' : (hours < .25 ? clock(viewStart + span * i / 6) : clock(viewStart + span * i / 6).slice(0, 5))}</span>)}</div>
            <div role="slider" aria-label={tr("录像时间轴")} aria-valuemin={start} aria-valuemax={start + 86399} aria-valuenow={Math.round(cursor)} aria-valuetext={clock(cursor)} tabIndex={0} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); seek(e.key === 'Home' ? start : e.key === 'End' ? start + 86399 : Math.max(start, Math.min(start + 86399, cursor + (e.key === 'ArrowRight' ? 10 : -10)))); } }} onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); seek(Math.min(start + 86399, viewStart + (e.clientX - rect.left) / rect.width * span)); }} className="relative h-7 cursor-crosshair rounded bg-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-teal-300">
              {visibleClips.filter(c => c.status === 'ready' && c.end > viewStart && c.start < viewEnd).map(c => <span key={c.id} title={`录像 ${clock(c.start)} — ${clock(c.end)}`} style={geometry(c.start, c.end)} className="absolute top-1 h-5 rounded-sm bg-slate-400/70"/>)}
            </div>
            <div aria-label={tr("观测覆盖与缺口")} className="relative mt-2 h-5 overflow-hidden rounded bg-slate-900">{coverage.filter(c => c.end > viewStart && c.start < viewEnd).map(c => <span key={c.start} title={`${clock(c.start)} — ${clock(c.end)} · ${tr(reasonNames[c.reason] || c.reason)}`} style={{left:`${Math.max(0,(c.start-viewStart)/span*100)}%`,width:`${(Math.min(viewEnd,c.end)-Math.max(viewStart,c.start))/span*100}%`, background:c.reason==='stream_offline'?'#f87171':c.reason==='scheduled_skip'?'#b45309':coverageColors[c.state]}} className="absolute inset-y-0"/>)}</div>
            <div className="mt-2 space-y-1.5">{Object.entries(labels).map(([k])=>[k,behavior(k)]).filter(([key]) => !label || label === key).map(([key, name]) => <div key={key} className="relative h-4 rounded bg-slate-800/40"><span className="pointer-events-none absolute left-1 top-0 z-10 text-[9px] text-slate-400">{name}</span>{filtered.filter(e => e.label === key && e.end > viewStart && e.start < viewEnd).map(e => <button key={e.id} aria-label={`${name} ${clock(e.start)}`} title={`${name} ${clock(e.start)} · ${duration(e.duration_sec)}`} onClick={() => selectEvent(e)} style={{ ...geometry(e.start, e.end), background: colors[key] }} className={`absolute top-0 h-4 min-w-[3px] rounded-sm opacity-80 hover:opacity-100 focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-white ${selected === e.id ? 'z-10 ring-2 ring-white' : ''}`}/>)}</div>)}</div>
            {cursor >= viewStart && cursor <= viewEnd && <div className="pointer-events-none absolute bottom-1 top-5 z-30 w-px bg-white/80" style={{ left: `${(cursor - viewStart) / span * 100}%` }}><div className="-ml-1 h-2 w-2 rotate-45 bg-white"/></div>}
          </div>
          <p className="mt-2 text-[10px] leading-5 text-slate-400">{tr("观测轨道：青色有目标 · 灰色空检测 · 琥珀色调度未推理 · 红色确认断流 · 深灰未知 · 暗色尚未发生。悬停查看区间原因。")}</p>
          <p className="mt-3 text-[10px] leading-5 text-slate-500">{tr("点击录像轨道定位；点击彩色片段查看事件。可用左右方向键移动 10 秒。空白仅表示无相应记录，不能据此推断宠物状态。")}</p>
        </div>
      </div>
      <aside className="flex min-h-0 flex-col bg-[#141f2b]">
        <div className="space-y-3 border-b border-slate-700/60 p-4"><div className="flex items-center gap-4 text-sm">{(['events', 'clips'] as const).map(t => <button key={t} onClick={() => setTab(t)} className={`border-b-2 pb-2 ${tab === t ? 'border-teal-300 text-teal-300' : 'border-transparent text-slate-400'}`}>{t === 'events' ? tr("行为事件") : tr("录像片段")} <span className="ml-1 rounded bg-white/5 px-1.5 text-xs">{t === 'events' ? filteredReviews.length : visibleClips.length}</span></button>)}</div><div className="flex items-center gap-2"><ListFilter size={15} className="shrink-0 text-slate-500"/><select aria-label={tr("回看行为筛选")} value={label} onChange={e => setLabel(e.target.value)} className="w-full rounded-lg border border-slate-600 bg-slate-800 px-2 py-2 text-xs"><option value="">{tr("全部行为")}</option>{Object.entries(labels).map(([k, v]) => <option key={k} value={k}>{behavior(k)}</option>)}</select></div></div>
        <div className="max-h-[620px] flex-1 overflow-y-auto p-3">
          {loading ? <p role="status" className="p-6 text-center text-xs text-slate-400">{tr("正在加载时间线…")}</p> : !rows.length ? <div className="space-y-3 px-4 py-12 text-center"><Film size={28} className="mx-auto text-slate-600"/><p className="text-sm">{tr("该日期暂无")}{tab === 'events' ? tr("行为事件") : tr("录像")}</p><p className="text-xs leading-6 text-slate-500">{tr("尝试切换日期、摄像头或数据来源。检测记录与录像分别保存。")}</p></div> : tab === 'events' ? filteredReviews.slice(page * 30, page * 30 + 30).map(e => <button key={e.id} onClick={() => selectEvent(e)} className={`mb-2 flex w-full gap-3 rounded-xl border p-3 text-left transition ${currentReview?.id === e.id ? 'border-teal-400/70 bg-teal-400/10' : 'border-slate-700/50 bg-slate-800/35 hover:border-slate-500'}`}><div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg" style={{ background: `${colors[e.label]}18`, color: colors[e.label] }}><Play size={20}/></div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-1"><strong className="text-sm text-white">{e.labels.map(l => behavior(l)).join(' / ')}</strong><span className="font-mono text-[10px] text-slate-400">{clock(e.start)}</span></div><p className="mt-1 text-xs text-slate-400">{duration(e.detected_sec)} · {(e.confidence * 100).toFixed(0)}{tr("% 置信度")}</p><p className="mt-1 text-[10px] text-slate-400">{e.event_count} {tr("个片段 · 跨度")}{duration(e.span_sec)} · {e.reviewed ? tr("已查看") : tr("未查看")}</p><p className="mt-1 text-[10px] text-slate-500">{e.clips.some(c => c.status === 'ready') ? tr("关联录像 · 点击定位") : tr("仅检测记录 · 无可播放录像")}</p></div></button>) : visibleClips.slice(page * 30, page * 30 + 30).map(c => <button key={c.id} disabled={c.status !== 'ready'} onClick={() => { setSelected(''); openClip(c); }} className={`mb-2 w-full rounded-xl border p-3 text-left disabled:opacity-50 ${clip?.id === c.id ? 'border-teal-400 bg-teal-400/10' : 'border-slate-700/50 bg-slate-800/35 hover:border-slate-500'}`}><div className="flex items-center justify-between text-xs"><span className="flex items-center gap-2"><Film size={14}/>{clock(c.start)}</span><span>{duration(Math.max(0, c.end - c.start))}</span></div><p className="mt-2 text-[10px] text-slate-400">{({ ready: tr("可播放"), recording: tr("录像中"), failed: tr("录像失败"), deleted: tr("已清理") } as Record<string, string>)[c.status] || c.status}</p>{c.error && <p className="mt-1 text-xs text-amber-300">{c.error}</p>}</button>)}
        </div>
        <div className="flex items-center justify-between border-t border-slate-700/60 px-4 py-3 text-xs text-slate-400"><span>{rows.length} {tr("条 · 第")}{page + 1}/{maxPage + 1} {tr("页")}</span><div className="flex gap-2"><button aria-label={tr("上一页事件")} disabled={!page} onClick={() => setPage(p => p - 1)} className="rounded bg-slate-800 p-1 disabled:opacity-25"><ChevronLeft size={16}/></button><button aria-label={tr("下一页事件")} disabled={page >= maxPage} onClick={() => setPage(p => p + 1)} className="rounded bg-slate-800 p-1 disabled:opacity-25"><ChevronRight size={16}/></button></div></div>
      </aside>
    </div>
  </section>;
}
