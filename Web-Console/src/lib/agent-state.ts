import type {DataSource} from './console-types';
export interface AgentContext {date:string;camera:string;source:DataSource;reportId?:number;}
export interface PendingReport {id:string;context:AgentContext;}
export function decodeAgentSession(raw:string|null,today:string):{context:AgentContext;pending?:PendingReport} {
  const fallback={context:{date:today,camera:'primary',source:'local-video' as DataSource}};
  const context=(value:unknown):AgentContext|null=>{
    if(!value||typeof value!=='object')return null;
    const v=value as Record<string,unknown>;
    if(typeof v.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v.date)||typeof v.camera!=='string'||!v.camera||!['camera','local-video','test','legacy'].includes(String(v.source)))return null;
    return {date:v.date,camera:v.camera,source:v.source as DataSource,...(Number.isInteger(v.reportId)&&Number(v.reportId)>0?{reportId:Number(v.reportId)}:{})};
  };
  try {
    const value=JSON.parse(raw||'null');const selected=context(value?.context);if(!selected)return fallback;
    const pendingContext=context(value?.pending?.context);
    const pending=pendingContext&&typeof value.pending?.id==='string'&&/^[a-f0-9-]{36}$/i.test(value.pending.id)?{id:value.pending.id,context:pendingContext}:undefined;
    return {context:selected,pending};
  }catch{return fallback;}
}
