import React, {useEffect, useRef, useState} from 'react';
import {ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Download, FileText, Leaf, Settings2, Sparkles, BookOpen, Heart} from 'lucide-react';
import {api,localDay} from '../lib/intelligence';
import {useCopy} from '../lib/copy';
import type {DailyStats,DataSource,Report,ReportSummary,ReviewLocation} from '../lib/console-types';
import ConsoleDrawer from './ConsoleDrawer';
import DeepSeekSettings from './DeepSeekSettings';

import {decodeAgentSession} from '../lib/agent-state';
import type {AgentContext as Context,PendingReport as Pending} from '../lib/agent-state';
const storage='hajimi-agent-view-v2';
function restore(){try{return decodeAgentSession(sessionStorage.getItem(storage),localDay());}catch{return decodeAgentSession(null,localDay());}}
export default function AgentConsole({onReview}:{onReview:(location:ReviewLocation)=>void}) {
  const {t,behavior,language}=useCopy();
  const initial=useRef(restore()).current;
  const [context,setContext]=useState<Context>(initial.context);
  const [pending,setPending]=useState<Pending|undefined>(initial.pending);
  const [report,setReport]=useState<Report|null>(null);
  const [stats,setStats]=useState<DailyStats|null>(null);
  const [settings,setSettings]=useState(false);
  const [preset,setPreset]=useState('summary');
  const [question,setQuestion]=useState('');
  const [history,setHistory]=useState<ReportSummary[]>([]);
  const [cursor,setCursor]=useState<number|undefined>();
  const [next,setNext]=useState<number|null>(null);
  const [previous,setPrevious]=useState<(number|undefined)[]>([]);
  const [refresh,setRefresh]=useState(0);
  const [loading,setLoading]=useState(true);
  const [submitting,setSubmitting]=useState(false);
  const [error,setError]=useState('');
  const [jobState,setJobState]=useState('queued');
  const [evidenceOpen,setEvidenceOpen]=useState(false);
  const [moreFindings,setMoreFindings]=useState(false);
  const [health,setHealth]=useState<{llm_configured?:boolean;embedding_configured?:boolean}>({});
  useEffect(()=>{try{sessionStorage.setItem(storage,JSON.stringify({context,pending}));}catch{/* private browser */}},[context,pending]);
  useEffect(()=>{api('/health').then(setHealth).catch(()=>{});},[settings]);
  useEffect(()=>{
    let active=true;setLoading(true);setError('');setReport(null);setStats(null);setMoreFindings(false);
    const load=async()=>{
      try {
        if(context.reportId){const r=await api<Report>(`/agent/reports/${context.reportId}`);if(active){setReport(r);setStats(r.stats);}}
        else {const r=await api<DailyStats>(`/stats/${context.date}?camera_id=${encodeURIComponent(context.camera)}&source=${context.source}`);if(active)setStats(r);}
      }catch(e){if(active)setError((e as Error).message);}finally{if(active)setLoading(false);}
    };void load();return()=>{active=false;};
  },[context,refresh]);
  useEffect(()=>{
    let active=true;const query=new URLSearchParams({camera_id:context.camera,source:context.source,limit:'20'});if(cursor)query.set('before_id',String(cursor));
    api<{reports:ReportSummary[];next_cursor:number|null}>(`/agent/reports?${query}`).then(r=>{if(active){setHistory(r.reports);setNext(r.next_cursor);}}).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[context.camera,context.source,cursor,refresh]);
  useEffect(()=>{
    if(!pending)return;let active=true;
    const poll=async()=>{
      try {const r=await api<{status:string;result:Report&{error?:string}}>(`/agent/jobs/${pending.id}`);if(!active)return;
        setJobState(r.status);
        if(r.status==='completed'){setContext({...pending.context,reportId:r.result.report_id});setPending(undefined);setRefresh(v=>v+1);}
        if(r.status==='failed'){setError(r.result.error||t('生成失败，请重试','Generation failed. Please retry.'));setPending(undefined);}
      }catch(e){if(active){setError((e as Error).message);setPending(undefined);}}
    };void poll();const timer=setInterval(poll,1500);return()=>{active=false;clearInterval(timer);};
  },[pending,language]);
  const change=(patch:Partial<Context>)=>{setContext(c=>({...c,...patch,reportId:undefined}));setCursor(undefined);setPrevious([]);};
  const generate=async()=>{
    if(submitting||pending)return;setSubmitting(true);setError('');
    const q=preset==='custom'?question:t(preset==='summary'?'生成简短中文合成或真实来源报告，按实际来源标注。摘要150字以内，最多3条发现，只写行为分布、主要变化与覆盖局限。引用有效证据ID，不列具体事件起止时刻，不推断医学结论。':'比较当天与此前七个完整日的行为占比，摘要150字以内，最多3条主要发现，使用给定趋势统计和证据ID。说明覆盖和历史不足，不列单事件起止时刻，合成数据必须标注，不推断医学结论。',preset==='summary'?'Write a concise report with a summary under 100 words and at most three findings. Use only provided statistics and valid evidence IDs. State synthetic provenance if applicable and coverage limitations. Do not invent event times or medical conclusions.':'Compare this day with seven prior complete days. Use a summary under 100 words and at most three evidence-cited findings. State coverage limits and synthetic provenance where applicable. Avoid individual event times and medical conclusions.');
    try {const r=await api<{job_id:string}>('/agent/reports','POST',{date:context.date,camera_id:context.camera,source:context.source,question:q});setJobState('queued');setContext(c=>({...c,reportId:undefined}));setPending({id:r.job_id,context:{...context,reportId:undefined}});}
    catch(e){setError((e as Error).message);}finally{setSubmitting(false);}
  };
  const exportReport=(format:'md'|'json')=>{
    if(!report)return;
    const markdown=[`# Hajimi · ${report.date}`,`> ${report.camera_id} · ${report.source} · ${report.mode}`,report.answer.summary,...report.answer.findings.map(f=>`- ${f.text}\n  Evidence: ${f.evidence_ids.join(', ')}`),'## Limitations',...report.answer.limitations.map(l=>`- ${l}`)].join('\n\n');
    const url=URL.createObjectURL(new Blob([format==='json'?JSON.stringify(report,null,2):markdown],{type:format==='json'?'application/json':'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`hajimi-${report.date}-${report.camera_id}.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const evidence=report?.stats||stats;
  const human=(seconds:number)=>seconds>=3600?`${Math.floor(seconds/3600)} ${t('小时','h')} ${Math.floor(seconds%3600/60)} ${t('分','min')}`:seconds<60?`${seconds.toFixed(1)} ${t('秒','s')}`:`${Math.floor(seconds/60)} ${t('分','min')}`;
  const pct=(value:number)=>(value*100).toFixed(1)+'%';
  const sourceName=(source:DataSource)=>({camera:t('摄像头','Camera'),'local-video':t('本地视频 · 测试','Local video · test'),test:t('合成案例','Synthetic cases'),legacy:t('旧版记录','Legacy records')})[source];
  const values=Object.entries(report?.trend.values||{}) as [string,import('../lib/console-types').TrendValue][];
  const largest=[...values].sort((a,b)=>Math.abs(b[1].delta_percentage_points)-Math.abs(a[1].delta_percentage_points))[0];
  const busy=!!pending||submitting;
  return <div className="space-y-6">
    <header className="care-heading"><div><p className="care-eyebrow">UNDERSTAND A LITTLE MORE</p><h1>{t('更懂它的每一天','Understand their every day')}</h1><p className="care-subtitle">{t('从日常活动里，发现值得关心的小变化。','A thoughtful look at daily activity, with evidence you can explore.')}</p></div><button className="quiet-button" onClick={()=>setSettings(true)}><Settings2 size={15}/>{t('分析设置','Analysis settings')}</button></header>
    {error&&<p role="alert" className="care-error">{error}</p>}
    <section className="care-card !py-5"><fieldset disabled={busy} className="flex flex-wrap items-end gap-3">
      <label className="min-w-[140px] flex-1"><span className="care-field-label">{t('哪一天','Date')}</span><input aria-label={t('报告日期','Report date')} type="date" className="care-field" value={context.date} onChange={e=>{if(e.target.value)change({date:e.target.value});}}/></label>
      <label className="min-w-[130px] flex-1"><span className="care-field-label">{t('摄像头','Camera')}</span><select aria-label={t('报告摄像头','Report camera')} className="care-field" value={context.camera} onChange={e=>change({camera:e.target.value})}><option value="primary">{t('主摄像头','Main camera')}</option><option value="secondary">{t('副摄像头','Second camera')}</option></select></label>
      <label className="min-w-[150px] flex-1"><span className="care-field-label">{t('数据来源','Data source')}</span><select aria-label={t('报告来源','Report source')} className="care-field" value={context.source} onChange={e=>change({source:e.target.value as DataSource})}>{(['local-video','camera','test','legacy'] as DataSource[]).map(s=><option key={s} value={s}>{sourceName(s)}</option>)}</select></label>
      <button className="care-button" onClick={generate} disabled={busy||(preset==='custom'&&!question.trim())}><Sparkles size={16}/>{busy?t('正在整理…','Preparing…'):t('生成报告','Create report')}</button>
    </fieldset><div className="mt-4 flex flex-wrap gap-2">{[['summary',t('今日小结','Daily summary')],['compare',t('与前七日对比','Compare with last 7 days')],['custom',t('自定义问题','Ask a question')]].map(([id,name])=><button key={id} disabled={busy} onClick={()=>setPreset(id)} className={`rounded-full px-3 py-1.5 text-xs ${preset===id?'bg-[#e9efdf] text-[#527044]':'text-stone-500 hover:bg-stone-50'}`}>{name}</button>)}</div>{preset==='custom'&&<textarea aria-label={t('自定义问题','Custom question')} disabled={busy} className="care-field mt-3" rows={3} maxLength={2000} value={question} onChange={e=>setQuestion(e.target.value)} placeholder={t('你想了解它的哪些变化？','What would you like to understand?')}/>}</section>
    {context.source==='test'&&<p className="care-chip warm">{t('合成案例，仅用于演示，不代表真实宠物。','Synthetic demonstration data, not a real pet’s behavior.')}</p>}
    {pending&&<div role="status" className="care-card flex items-center gap-3 text-sm text-[#6e8264]"><Sparkles size={19}/>{jobState==='queued'?t('任务已排队，可以切换页面，完成后回来查看。','Queued. You can switch pages and return later.'):t('正在查询记录并生成报告，请稍候。','Retrieving evidence and preparing your report…')}</div>}
    <div className="grid grid-cols-3 gap-3">
      <div className="care-metric"><p>{t('观测完整度','Observation coverage')}</p><strong>{evidence?pct(evidence.coverage):'—'}</strong><p>{t('按所选日期全天计算','Of the selected calendar day')}</p></div>
      <div className="care-metric"><p>{t('有效观测','Observed time')}</p><strong>{evidence?human(evidence.observed_sec):'—'}</strong><p>{t('未观测不等于没有活动','Unobserved does not mean inactive')}</p></div>
      <div className="care-metric"><p>{t('主要变化','Largest shift')}</p><strong>{largest?behavior(largest[0]):'—'}</strong><p>{largest?`${largest[1].delta_percentage_points>0?'+':''}${largest[1].delta_percentage_points.toFixed(1)} ${t('个百分点','pp')}`:t('需要足够历史观测','More historical evidence needed')}</p></div>
    </div>
    <div className="care-report-layout"><div className="min-w-0 space-y-5">
      <section className="care-card"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2"><Leaf size={17} className="text-[#78906e]"/>{t('这一天的陪伴记录','Your daily care notes')}</h2>{report&&<div className="flex gap-2"><button className="quiet-button" onClick={()=>exportReport('md')}><Download size={13}/>{t('导出','Export')}</button><button className="quiet-button" onClick={()=>exportReport('json')}>JSON</button></div>}</div>
      {loading?<p role="status" className="care-empty">{t('正在读取记录…','Loading your records…')}</p>:report?<><div className="mb-4 flex flex-wrap gap-2"><span className="care-chip">{report.mode==='llm'?t('AI 分析报告','AI-assisted report'):t('统计报告','Statistical report')}</span><span className="care-chip warm">{report.date}</span></div><p className="text-[15px] leading-8 text-[#55614c]">{report.answer.summary}</p><div className="mt-5 space-y-3">{report.answer.findings.slice(0,moreFindings?undefined:3).map((f,i)=><article key={i} className="rounded-xl border border-[#e8ebdf] bg-[#f7f9f1] p-4 text-sm leading-7"><p>{f.text}</p><button onClick={()=>setEvidenceOpen(true)} className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#769064]"><BookOpen size={12}/>{t('查看依据','View evidence')}</button></article>)}</div>{report.answer.findings.length>3&&<button className="quiet-button mt-3" onClick={()=>setMoreFindings(v=>!v)}>{moreFindings?t('收起更多发现','Show fewer findings'):t('展开其余发现','Show more findings')}</button>}{report.warnings.length>0&&<details className="mt-5 rounded-xl bg-[#faf0e2] p-3 text-xs text-[#947047]"><summary>{t('本次分析的服务提示','Service notes for this report')} ({report.warnings.length})</summary><ul className="mt-2 space-y-2">{report.warnings.map(w=><li key={w}>{w}</li>)}</ul></details>}<details className="mt-5 text-xs text-[#7e8674]"><summary>{t('这份报告的观测局限','Observation limitations')}</summary><ul className="mt-3 list-disc space-y-2 pl-4 leading-6">{report.answer.limitations.map(l=><li key={l}>{l}</li>)}</ul></details></>:<div className="care-empty"><Heart size={32} className="mx-auto mb-4 text-[#a8b79b]"/><p className="text-base text-[#617457]">{t('从一次小小的观察开始','Start with a little observation')}</p><p className="mt-2">{evidence?.sample_count?t('已有活动记录。生成一份报告，看看它今天的日常。','Activity is available. Create a report to explore the day.'):t('这一天还没有观测。换个日期，或先去活动页开始观察。','No observations for this day. Choose another date or start observing.')}</p><button className="quiet-button mt-5" onClick={()=>onReview({date:context.date,camera:context.camera,source:context.source})}>{t('去活动回看','Open activity')}<ArrowUpRight size={13}/></button></div>}
      </section>
      {evidence&&evidence.sample_count>0&&<section className="care-card"><div className="mb-5 flex items-center justify-between"><h2>{t('活动的分布','A picture of their activity')}</h2><span className="text-[10px] text-stone-400">{t('占有效观测时间','Share of observed time')}</span></div><div className="space-y-4">{(Object.entries(evidence.duration_sec) as [string,number][]).map(([key,seconds])=>{const current=seconds/Math.max(1,evidence.observed_sec),baseline=report?.trend.values[key]?.baseline_share;return <div key={key}><div className="mb-1.5 flex justify-between text-xs"><span>{behavior(key)}</span><span className="text-stone-500">{human(seconds)} · {pct(current)}</span></div><div className="h-2 rounded-full bg-[#eff1e8]"><div className="h-2 rounded-full bg-[#8ca17e]" style={{width:`${Math.min(100,current*100)}%`}}/></div>{baseline!==undefined&&<div className="mt-1 h-1 rounded-full bg-[#f4eee4]"><div className="h-1 rounded-full bg-[#d6b895]" style={{width:`${baseline*100}%`}}/></div>}</div>;})}</div><p className="mt-5 text-[11px] leading-6 text-stone-400">{values.length?t('绿色：当日 · 浅棕：有效历史日平均占比','Green: selected day · Sand: average share across eligible historical days'):t('历史观测不足，暂不展示趋势比较。','Insufficient historical coverage for a trend comparison.')}</p><p className="mt-2 text-[11px] text-stone-400">{t('进食观测片段','Eating episodes')} {evidence.eating_episodes} · {t('投喂指令','Feeding commands')} {evidence.feeding_commands}</p></section>}
    </div><aside className="space-y-5"><section className="care-card !p-5"><div className="mb-4 flex items-center justify-between"><h2>{t('以前的记录','Past reports')}</h2><FileText size={16} className="text-[#94a388]"/></div><p className="mb-3 text-[10px] text-stone-400">{sourceName(context.source)} · {context.camera==='primary'?t('主摄像头','Main camera'):t('副摄像头','Second camera')}</p>{!history.length&&<p className="py-7 text-xs leading-6 text-stone-400">{t('报告生成后会保存在这里。','Your completed reports will appear here.')}</p>}{history.map(h=><button key={h.id} disabled={busy} onClick={()=>setContext({date:h.date,camera:h.camera_id,source:h.source,reportId:h.id})} className={`mb-2 w-full rounded-xl border p-3 text-left ${context.reportId===h.id?'border-[#a6b99b] bg-[#f0f4e9]':'border-[#edece3] hover:bg-[#f7f8f1]'}`}><div className="flex items-center justify-between text-xs"><strong className="font-medium">{h.date}</strong><span className="text-[10px] text-stone-400">#{h.id}</span></div><p className="mt-2 line-clamp-2 text-[11px] leading-5 text-stone-500">{h.summary}</p></button>)}<div className="mt-3 flex justify-between"><button className="icon-button disabled:opacity-25" aria-label={t('上一页报告','Previous reports page')} disabled={!previous.length} onClick={()=>{setCursor(previous[previous.length-1]);setPrevious(p=>p.slice(0,-1));}}><ChevronLeft size={16}/></button><button className="icon-button disabled:opacity-25" aria-label={t('下一页报告','Next reports page')} disabled={!next} onClick={()=>{setPrevious(p=>[...p,cursor]);setCursor(next||undefined);}}><ChevronRight size={16}/></button></div></section><div className="rounded-2xl border border-[#e6e6d7] bg-[#f0f1e5] p-5 text-xs leading-6 text-[#7c896e]"><Heart size={20} className="mb-3"/>{t('每个变化都需要上下文。报告帮助你观察，不代替专业判断。','Every change needs context. Reports help you observe, not replace professional judgment.')}</div></aside></div>
    <ConsoleDrawer open={settings} onClose={()=>setSettings(false)} title={t('分析设置','Analysis settings')}><p className="care-subtitle">{t('报告模型在云端生成文字，本地记忆留在这台设备。','The cloud model writes reports; memory storage stays on this device.')}</p><DeepSeekSettings onConfigured={configured=>setHealth(h=>({...h,llm_configured:configured}))}/><div className="care-card text-xs leading-7"><p>DeepSeek · {health.llm_configured?t('已配置','Configured'):t('未配置，使用统计模式','Not configured · statistical mode')}</p><p>{t('语义记忆','Semantic memory')} · {health.embedding_configured?t('已配置','Configured'):t('未配置','Not configured')}</p></div></ConsoleDrawer>
    <ConsoleDrawer open={evidenceOpen} onClose={()=>setEvidenceOpen(false)} title={t('报告依据','Report evidence')}>{report&&<><div className="care-chip">#{report.report_id} · {report.date} · {report.source}</div>{report.answer.findings.map((f,i)=><details key={i} className="care-card"><summary className="text-sm leading-6">{f.text}</summary><p className="mt-3 break-all font-mono text-[10px] text-stone-400">{f.evidence_ids.join(' · ')}</p></details>)}<h3 className="text-sm font-semibold">{t('事件与关联录像','Events and linked recordings')}</h3>{report.stats.events.map(e=><div key={e.id} className="rounded-xl border border-stone-200 p-3 text-xs"><p>{behavior(e.label)} · {human(e.duration_sec)}</p><p className="mt-1 text-stone-400">{new Date(e.started_at).toLocaleString(language==='zh'?'zh-CN':'en-GB',{timeZone:'Asia/Shanghai'})}</p><button className="quiet-button mt-3" onClick={()=>onReview({date:report.date,camera:report.camera_id,source:report.source,eventId:e.id,timestamp:e.start})}>{e.clips.some(c=>c.status==='ready')?t('回看这一刻','Review this moment'):t('查看事件位置','Locate event')}<ArrowUpRight size={12}/></button></div>)}<details className="text-xs text-stone-500"><summary>{t('技术与原始证据','Technical evidence')}</summary><p className="mt-3">{report.prompt_version}</p><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all text-[10px]">{JSON.stringify({baseline:report.baseline.map(({events,...s})=>s),memories:report.memories,trend:report.trend},null,2)}</pre></details></>}</ConsoleDrawer>
  </div>;
}
