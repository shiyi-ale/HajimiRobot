import {useConsoleCopy} from '../lib/console-copy';
import React, { useEffect, useRef, useState } from 'react';
import { Activity, Camera, Play, Square, RefreshCw, Film, ShieldCheck } from 'lucide-react';
import { api, button, input, labels, panel } from '../lib/intelligence';

import NvrReview from './NvrReview';
import ConsoleDrawer from './ConsoleDrawer';
import {useCopy} from '../lib/copy';
import type {ReviewLocation} from '../lib/console-types';

export default function NvrConsole({location}:{location?:ReviewLocation}) {
  const tr=useConsoleCopy();
  const {t,behavior} = useCopy();
  const [settingsOpen,setSettingsOpen]=useState(false);
  useEffect(()=>{if(location)setCamera(location.camera);},[location]);
  const [camera, setCamera] = useState('primary');
  const [config, setConfig] = useState<any>(null);
  const [status, setStatus] = useState<any>({});
  const [assets, setAssets] = useState<any>({models:[],videos:[]});
  const [hardware, setHardware] = useState<any>({});
  const [edges, setEdges] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [points, setPoints] = useState<number[][]>([]);
  const [tick, setTick] = useState(0);
  const [previewError, setPreviewError] = useState(true);
  const svg = useRef<SVGSVGElement>(null);
  useEffect(()=>{if(!status.running)return;const timer=setInterval(()=>setTick(Date.now()),250);return()=>clearInterval(timer);},[status.running]);
  useEffect(()=>{api('/nvr/assets').then(setAssets).catch(e=>setError(e.message));api('/nvr/hardware').then(setHardware).catch(e=>setError(e.message));},[]);
  useEffect(() => {
    let active = true;
    setConfig(null); setPreviewError(true);
    api(`/cameras/${camera}/config`).then(c => { if (active) setConfig(c); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [camera]);
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const data = await api('/nvr/status');
        if (active) { setStatus(data.pipelines[camera] || {}); setEdges(data.heartbeats.filter((h:any)=>h.camera === camera)); setTick(Date.now()); }
      } catch (e) { if (active) setError((e as Error).message); }
    };
    void poll(); const timer = setInterval(poll, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [camera]);
  const act = async (action: () => Promise<any>, text: string) => {
    setBusy(true); setError(''); setMessage('');
    try { await action(); setMessage(text); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const set = (key: string, value: unknown) => setConfig((c: any) => ({ ...c, [key]: value }));
  const polygon = (drawing ? points : config?.roi || []).map((p: number[]) => `${p[0] * 1000},${p[1] * 1000}`).join(' ');
  return <div className="space-y-5">
    <header className="care-heading"><div><p className="care-eyebrow">LITTLE MOMENTS, EVERY DAY</p><h1>{t('它的日常，都在这里','Every little moment')}</h1><p className="care-subtitle">{t('看看它在做什么，回到你关心的那一刻。','See what your companion is up to. Revisit the moments that matter.')}</p></div><button className="quiet-button" onClick={()=>setSettingsOpen(true)}><Camera size={16}/>{t('摄像头设置','Camera settings')}</button></header>
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><select aria-label={t('摄像头','Camera')} className="care-field !w-auto" value={camera} onChange={e=>setCamera(e.target.value)}><option value="primary">{t('主摄像头','Main camera')}</option><option value="secondary">{t('副摄像头','Second camera')}</option></select><span className="care-chip">{status.running?t('正在观察','Observing'):t('设备未运行','Not running')}</span></div><div className="flex gap-2"><button className="care-button" disabled={busy||status.running||!config?.source} onClick={()=>act(()=>api(`/cameras/${camera}/start`,'POST'),t('观察已启动','Observation started'))}><Play size={14}/>{t('开始观察','Start observing')}</button><button className="quiet-button" disabled={busy||!status.running} onClick={()=>act(()=>api(`/cameras/${camera}/stop`,'POST'),t('观察已停止','Observation stopped'))}><Square size={13}/>{t('停止','Stop')}</button></div></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-teal-50 p-3 text-sm text-teal-800">{message}</p>}
    <NvrReview camera={camera} source={config?.source_kind || 'local-video'} running={!!status.running} tick={tick} location={location}/>
    <ConsoleDrawer open={settingsOpen} onClose={()=>setSettingsOpen(false)} title={t('摄像头设置','Camera settings')}>
      <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-bold"><Camera size={18}/>{tr("视频与 ROI")}</h2><span className="text-xs text-slate-500">{status.state || tr("未启动")}</span></div>
      <div className="relative overflow-hidden rounded-xl bg-slate-900" style={{aspectRatio:status.frame_width?`${status.frame_width}/${status.frame_height}`:'16/9'}}>
        <img alt={tr("视频预览")} className={`h-full w-full object-fill ${previewError ? 'invisible' : ''}`} src={`/api/v1/cameras/${camera}/preview.jpg?t=${tick}`} onLoad={() => setPreviewError(false)} onError={() => setPreviewError(true)}/>
        {previewError && <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-slate-300">{tr("配置视频路径并启动后显示预览。也可先在此绘制 ROI。")}</div>}
        <svg ref={svg} role="img" aria-label={tr("点击绘制 ROI 多边形")} viewBox="0 0 1000 1000" preserveAspectRatio="none" className={`absolute inset-0 h-full w-full ${drawing ? 'cursor-crosshair' : ''}`} onClick={e => {
          if (!drawing || !svg.current || points.length >= 32) return;
          const r = svg.current.getBoundingClientRect();
          setPoints([...points, [Math.max(0, Math.min(1, (e.clientX-r.left)/r.width)), Math.max(0, Math.min(1, (e.clientY-r.top)/r.height))]]);
        }}><polygon points={polygon} fill="rgba(20,184,166,.15)" stroke="#2dd4bf" strokeWidth="5"/>{(drawing ? points : []).map((p, i) => <circle key={i} cx={p[0]*1000} cy={p[1]*1000} r="9" fill="#fff"/>)}{!drawing&&status.running&&Date.now()/1000-(status.detection_captured_at||0)<2&&(status.boxes||[]).map((b:any,i:number)=><g key={i}><rect x={b.xyxy[0]*1000} y={b.xyxy[1]*1000} width={(b.xyxy[2]-b.xyxy[0])*1000} height={(b.xyxy[3]-b.xyxy[1])*1000} fill="none" stroke="#fbbf24" strokeWidth="5"/><text x={b.xyxy[0]*1000+8} y={Math.max(30,b.xyxy[1]*1000-10)} fill="#fbbf24" fontSize="28">{behavior(b.label)} {(b.confidence*100).toFixed(0)}%</text></g>)}</svg>
      </div>
      <div className="flex flex-wrap gap-2"><button disabled={status.running} className={button} onClick={() => { setDrawing(true); setPoints([]); }}>{tr("重绘 ROI")}</button><button className={button} disabled={!drawing || points.length < 3} onClick={() => { set('roi', points); setDrawing(false); }}>{tr("完成绘制")}</button><button className="text-sm text-slate-500" onClick={() => { setDrawing(false); setPoints([]); }}>{tr("取消")}</button></div>
      <p className="text-xs text-slate-500">{tr("至少 3 个顶点，沿区域边界依次点击；完成后需保存配置。ROI 仅限制运动分析区域。")}</p>
      {config && <fieldset disabled={status.running || busy} className="space-y-3">
        <label className="block text-sm">{tr("已整理训练模型")}<select className={input} value={assets.models.some((m:any)=>m.path===config.weights)?config.weights:''} onChange={e=>{if(e.target.value)set('weights',e.target.value);}}><option value="">{tr("手动填写权重路径")}</option>{assets.models.map((m:any)=><option key={m.id} value={m.path}>{m.recommended?tr("★ 推荐 · "):''}{m.id} · {(m.size_bytes/1e6).toFixed(1)} MB</option>)}</select></label>
        <label className="block text-sm">{tr("本地视频素材")}<select className={input} value={assets.videos.some((v:any)=>v.path===config.source)?config.source:''} onChange={e=>{if(e.target.value)setConfig((c:any)=>({...c,source:e.target.value,source_kind:'local-video'}));}}><option value="">{tr("手动填写视频来源")}</option>{assets.videos.map((v:any)=><option key={v.path} value={v.path}>{v.name} · {v.duration_sec.toFixed(1)} {tr("秒")}</option>)}</select></label>
        <label className="block text-sm">{tr("推理设备")}<select className={input} value={config.inference_device} onChange={e=>set('inference_device',e.target.value)}><option value="cuda:0">GPU · {hardware.gpus?.[0]?.name||tr("CUDA:0（待就绪）")}</option><option value="cpu">{tr("CPU（手动选择）")}</option></select></label>
        {hardware.cuda_available===false&&<p className="text-xs text-amber-800">{tr("CUDA 不可用，GPU 模式不会自动回退 CPU。请检查 CUDA 版 PyTorch。")}</p>}
        <label className="block text-sm">{tr("视频来源")}<select className={input} value={config.source_kind} onChange={e => set('source_kind', e.target.value)}><option value="local-video">{tr("本地视频（测试）")}</option><option value="camera">{tr("摄像头流")}</option></select></label>
        <label className="block text-sm">{tr("本地绝对路径 / 流 URL")}<input className={input} value={config.source} placeholder="D:\videos\pet.mp4" onChange={e => set('source', e.target.value)}/></label>
        <label className="block text-sm">{tr("六类行为权重路径")}<input className={input} value={config.weights} placeholder="D:\models\wfd_yolo26n_from_x_best.pt" onChange={e => set('weights', e.target.value)}/></label>
        <details><summary className="cursor-pointer text-sm text-teal-700">{tr("调度与录像参数")}</summary><div className="mt-3 grid grid-cols-2 gap-3">{Object.entries({ review_gap_sec: tr("回看合并间隔秒"), review_max_sec: tr("回看组最大跨度秒"), analysis_fps: tr("运动分析 FPS"), idle_fps: tr("静止推理 FPS"), candidate_fps: tr("候选推理 FPS"), active_fps: tr("活跃推理 FPS"), rise_ratio: tr("升档运动比例"), fall_ratio: tr("降档运动比例"), rise_sec: tr("升档持续秒"), fall_sec: tr("降档持续秒"), warmup_sec: tr("背景预热秒"), pre_sec: tr("事件前缓冲秒"), post_sec: tr("事件后录像秒"), retention_days: tr("保留天数"), max_storage_bytes: tr("容量上限 bytes"), confidence: tr("检测置信度") }).map(([key, text]) => <label key={key} className="text-xs">{text}<input type="number" step="any" className={input} value={config[key]} onChange={e => set(key, Number(e.target.value))}/></label>)}</div></details>
        <button className={button} disabled={drawing} onClick={() => act(async () => setConfig(await api(`/cameras/${camera}/config`, 'PUT', config)), tr("配置已保存"))}>{tr("保存配置 · v")}{config.revision}</button>
      </fieldset>}
      <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || status.running || !config?.source} onClick={() => act(() => api(`/cameras/${camera}/start`, 'POST'), tr("视频分析已启动，请查看下方运行状态"))}><Play size={14} className="mr-1 inline"/>{tr("启动")}</button><button className={button} disabled={busy || !status.running} onClick={() => act(() => api(`/cameras/${camera}/stop`, 'POST'), tr("视频分析已停止"))}><Square size={14} className="mr-1 inline"/>{tr("停止")}</button><button className="text-sm text-teal-700" disabled={!status.running} onClick={() => act(() => api(`/cameras/${camera}/motion-reset`, 'POST'), tr("背景已重置，重新预热"))}><RefreshCw size={14} className="mr-1 inline"/>{tr("云台移动后重置")}</button></div>
    </ConsoleDrawer>
    <details className={panel}><summary className="cursor-pointer text-sm">{t('运行诊断与设备状态','Diagnostics and device status')}</summary><h2 className="flex items-center gap-2 font-bold"><Activity size={18}/>{tr("运行指标")}</h2><div className="grid grid-cols-3 gap-3">{[[tr("运动比例"), `${((status.motion_ratio || 0)*100).toFixed(1)}%`], [tr("推理次数"), status.inference_count || 0], [tr("延迟"), `${status.latency_ms || 0} ms`], [tr("分析帧数"), status.analyzed_frames || 0], [tr("未送推理"), status.skipped_frames || 0], [tr("替换旧帧"), status.replaced_frames || 0]].map(([k, v]) => <div key={k} className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] text-slate-500">{k}</p><p className="mt-1 text-sm font-bold">{v}</p></div>)}</div>
      <p className="text-xs text-slate-500">{tr("运动检测")}{status.stream_ok ? tr("运行中") : tr("未连接")} {tr("· 行为模型")}{status.inference_ok ? tr("已就绪") : tr("未就绪")}</p>
      {status.compute_device&&<p className="text-xs text-teal-800">{tr("实际推理：")}{status.compute_device} · {status.gpu_name||'CPU'} · {status.precision} · {status.model_id}</p>}
      {edges.map(e => <p key={e.device} className="text-xs text-slate-500">{e.device} {tr("· 心跳")}{e.online ? tr("在线") : tr("离线 / 陈旧")} · {e.age_sec} {tr("秒前")}</p>)}
      {[status.error, status.inference_error, status.recording_error].filter(Boolean).map((s: string) => <p key={s} className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">{s}</p>)}
      <p className="flex gap-2 text-xs text-slate-500"><ShieldCheck size={16} className="shrink-0"/>{status.inference_ok?tr("真实 YOLO 推理已接入；录像由持续运动或有效检测触发。"):tr("模型未就绪时仍可运行运动检测与录像，不生成行为检测结果。")}</p></details>
  </div>;
}
