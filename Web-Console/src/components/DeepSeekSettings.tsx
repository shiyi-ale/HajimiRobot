import {useConsoleCopy} from '../lib/console-copy';
import React, { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import {useCopy} from '../lib/copy';
import { api, button, input, panel } from '../lib/intelligence';

export default function DeepSeekSettings({onConfigured}:{onConfigured:(value:boolean)=>void}) {
  const tr=useConsoleCopy();
  const {t}=useCopy();
  const [config,setConfig]=useState<any>(null);
  const [key,setKey]=useState('');
  const [model,setModel]=useState('deepseek-flash');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [models,setModels]=useState<string[]>([]);
  useEffect(()=>{let active=true;api('/agent/config').then(c=>{if(active){setConfig(c);setModel(c.model);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  const save=async(clear=false)=>{
    setBusy(true);setError('');setMessage('');
    try {
      const c=await api('/agent/config','PUT',{model,api_key:key,clear_key:clear});
      setConfig(c);setKey('');onConfigured(c.configured);
      setMessage(clear?tr("密钥已清除"):c.configured?tr("DeepSeek 配置已保存，立即生效"):tr("模型已保存，请输入 API Key 后再次保存"));
    } catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const test=async()=>{
    setBusy(true);setError('');setMessage('');
    try {
      const r=await api('/agent/config/test','POST');setModels(r.models);
      setMessage(r.selected_available?tr("连接成功，所选模型可用"):tr("连接成功，但所选模型不在可用列表中，请选择返回的模型名称"));
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  return <section className={panel}>
    <h2 className="flex items-center gap-2 font-bold"><KeyRound size={18}/>{tr("DeepSeek API 接入")}</h2>
    <p className="text-xs text-slate-500">{config?.configured?tr("密钥已配置"):tr("尚未配置密钥")} {tr("· 官方端点 https://api.deepseek.com")}</p>
    <label className="block text-sm">{tr("模型名称")}<input className={input} value={model} onChange={e=>setModel(e.target.value)} list="deepseek-models" placeholder="deepseek-flash"/><datalist id="deepseek-models">{Array.from(new Set(['deepseek-flash','deepseek-v4-pro',...models])).map(m=><option key={m} value={m}/>)}</datalist></label>
    <label className="block text-sm">API Key<input type="password" autoComplete="off" spellCheck={false} className={input} value={key} onChange={e=>setKey(e.target.value)} placeholder={config?.configured?tr("留空保留已有密钥，输入新值可替换"):tr("输入你的 DeepSeek API Key")}/></label>
    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy||!model.trim()} onClick={()=>save()}>{tr("保存配置")}</button><button className={button} disabled={busy||!config?.configured||!!key||model!==config?.model} onClick={test}>{tr("测试连接")}</button><button className="text-sm text-slate-500 disabled:opacity-40" disabled={busy||!config?.configured} onClick={()=>save(true)}>{tr("清除密钥")}</button></div>
    {message&&<p role="status" className="rounded-xl bg-teal-50 p-3 text-xs text-teal-800">{message}</p>}
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-xs text-red-800">{error}</p>}
    <p className="text-xs leading-5 text-slate-500">{tr("密钥只发送给本机服务；Windows 使用系统 DPAPI 加密保存，不回显、不写浏览器缓存。测试连接仅向 DeepSeek 查询模型列表；生成报告时才发送所选行为统计与证据。向量嵌入仍单独配置。")}</p>
  </section>;
}
