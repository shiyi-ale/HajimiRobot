import React, { useEffect, useState } from 'react';
import { 
  Battery, 
  Activity, 
  Utensils, 
  Droplets, 
  ChevronRight,
  AlertCircle
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { motion } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { useLanguage } from '@/src/lib/i18n';
import { getDashboardSummary, getDeviceStatus } from '@/src/lib/api';
import { connectFrontendSocket } from '@/src/lib/socket';
import type { BehaviorEvent, DeviceStatus, FrontendSocketMessage } from '@/src/types';

const activityData = [
  { time: '08:00', activity: 20 },
  { time: '10:00', activity: 45 },
  { time: '12:00', activity: 30 },
  { time: '14:00', activity: 70 },
  { time: '16:00', activity: 40 },
  { time: '18:00', activity: 55 },
  { time: '20:00', activity: 25 },
];

export default function Dashboard() {
  const { dict, language } = useLanguage();
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [summary, setSummary] = useState<{
    activityDuration: string;
    feedingCount: number;
    totalFood: number;
    waterCount: number;
  } | null>(null);
  const [timeline, setTimeline] = useState<BehaviorEvent[]>([]);
  const [reportSummary, setReportSummary] = useState(dict.dashboard.waitingStatus);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [nextStatus, nextSummary] = await Promise.all([
          getDeviceStatus(),
          getDashboardSummary(),
        ]);

        if (cancelled) {
          return;
        }

        setDeviceStatus(nextStatus);
        setSummary(nextSummary.todaySummary);
        setTimeline(nextSummary.timeline);
        setReportSummary(nextSummary.latestReport.summary);
      } catch {
        if (cancelled) {
          return;
        }

        setReportSummary(dict.dashboard.backendError);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const socket = connectFrontendSocket((message: FrontendSocketMessage) => {
      if (message.type === 'status') {
        setDeviceStatus(message.data as DeviceStatus);
      }
    });

    return () => socket.close();
  }, []);

  const statusTone = !deviceStatus?.isOnline
    ? {
        label: dict.dashboard.offline,
        className: 'bg-slate-100 text-slate-500 border-slate-200',
        dotClassName: 'bg-slate-400',
      }
    : deviceStatus.streamConnected
      ? {
          label: dict.dashboard.online,
          className: 'bg-emerald-50 text-emerald-600 border-emerald-100',
          dotClassName: 'bg-emerald-500',
        }
      : {
          label: dict.dashboard.onlineVideoAbnormal,
          className: 'bg-amber-50 text-amber-700 border-amber-100',
          dotClassName: 'bg-amber-500',
        };

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{dict.app.robotName}</h1>
          <p className="text-slate-500 text-sm">
            {deviceStatus?.isOnline
              ? `${dict.dashboard.lastSeenPrefix} ${new Date(deviceStatus.lastCommunication).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })}`
              : dict.dashboard.waitingOnline}
          </p>
        </div>
        <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border", statusTone.className)}>
          <div className={cn("w-2 h-2 rounded-full", statusTone.dotClassName, deviceStatus?.isOnline && "animate-pulse")} />
          {statusTone.label}
        </div>
      </header>

      {/* Device Status Cards */}
      <div className="grid grid-cols-2 gap-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-4 rounded-3xl card-shadow border border-slate-100"
        >
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-blue-50 rounded-xl">
              <Battery className="w-5 h-5 text-blue-600" />
            </div>
            <span className="text-xs font-mono text-slate-400">{deviceStatus?.battery ?? '--'}%</span>
          </div>
          <h3 className="text-sm font-medium text-slate-500 mb-1">{dict.dashboard.deviceBattery}</h3>
          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${deviceStatus?.battery ?? 0}%` }}
              className="bg-blue-500 h-full rounded-full"
            />
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white p-4 rounded-3xl card-shadow border border-slate-100"
        >
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-orange-50 rounded-xl">
              <Utensils className="w-5 h-5 text-orange-600" />
            </div>
            <span className="text-xs font-mono text-slate-400">{deviceStatus?.foodLevel ?? '--'}%</span>
          </div>
          <h3 className="text-sm font-medium text-slate-500 mb-1">{dict.dashboard.foodLevel}</h3>
          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${deviceStatus?.foodLevel ?? 0}%` }}
              className="bg-orange-500 h-full rounded-full"
            />
          </div>
        </motion.div>
      </div>

      {/* Activity Overview */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-white p-6 rounded-3xl card-shadow border border-slate-100"
      >
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-bold text-slate-800">{dict.dashboard.overview}</h3>
          <div className="flex gap-4">
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{dict.dashboard.feeding}</p>
              <p className="text-lg font-mono font-bold text-slate-900">{summary?.feedingCount ?? 0}{dict.dashboard.times}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{dict.dashboard.drinking}</p>
              <p className="text-lg font-mono font-bold text-slate-900">{summary?.waterCount ?? 0}{dict.dashboard.times}</p>
            </div>
          </div>
        </div>
        
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={activityData}>
              <defs>
                <linearGradient id="colorActivity" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis 
                dataKey="time" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 10, fill: '#94a3b8' }}
              />
              <Tooltip 
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
              />
              <Area 
                type="monotone" 
                dataKey="activity" 
                stroke="#0ea5e9" 
                strokeWidth={3}
                fillOpacity={1} 
                fill="url(#colorActivity)" 
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      {/* Behavior Timeline */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="bg-white p-6 rounded-3xl card-shadow border border-slate-100"
      >
        <h3 className="font-bold text-slate-800 mb-4">{dict.dashboard.timeline}</h3>
        <div className="space-y-6">
          {(timeline.length ? timeline : [
            { time: '15:20', event: language === 'zh' ? '沙发上休息' : 'Resting on sofa', type: 'rest' },
            { time: '12:00', event: language === 'zh' ? '进食 15g' : 'Finished feeding 15g', type: 'feeding' },
            { time: '08:30', event: language === 'zh' ? '起床活动' : 'Started morning activity', type: 'activity' },
          ]).map((item, i) => (
            <div key={i} className="flex gap-4 relative">
              {i !== (timeline.length ? timeline.length : 3) - 1 && (
                <div className="absolute left-2.5 top-6 bottom-[-24px] w-0.5 bg-slate-100" />
              )}
              <div className={cn(
                "w-5 h-5 rounded-full border-4 border-white ring-2 flex-shrink-0 z-10",
                item.type === 'rest' ? "ring-indigo-500 bg-indigo-500" :
                item.type === 'feeding' ? "ring-orange-500 bg-orange-500" :
                "ring-blue-500 bg-blue-500"
              )} />
              <div className="flex-1 pb-2">
                <div className="flex justify-between items-center">
                  <p className="text-sm font-medium text-slate-800">{item.event}</p>
                  <span className="text-xs font-mono text-slate-400">{item.time}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Report Summary */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="bg-brand-600 p-6 rounded-3xl card-shadow text-white relative overflow-hidden"
      >
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-brand-100" />
            <span className="text-xs font-medium text-brand-100">{dict.dashboard.careSuggestion}</span>
          </div>
          <p className="text-sm leading-relaxed mb-4 opacity-90">
            {reportSummary}
          </p>
          <button className="flex items-center gap-1 text-xs font-bold bg-white/20 hover:bg-white/30 transition-colors px-3 py-2 rounded-xl">
            {dict.dashboard.fullReport}
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>
        {/* Abstract background shapes */}
        <div className="absolute top-[-20%] right-[-10%] w-40 h-40 bg-white/10 rounded-full blur-3xl" />
        <div className="absolute bottom-[-20%] left-[-10%] w-32 h-32 bg-brand-400/20 rounded-full blur-2xl" />
      </motion.div>
    </div>
  );
}
