import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CloudSun,
  Download,
  Share2,
  Utensils,
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { getDailyReport, getReportDates } from '@/src/lib/api';
import type { DailyReport } from '@/src/types';

export default function Reports() {
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [dates, setDates] = useState<Array<{ date: string; label: string }>>([]);
  const [report, setReport] = useState<DailyReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadDates = async () => {
      try {
        const data = await getReportDates();
        if (cancelled) {
          return;
        }

        setDates(data.dates);
        const nextDate = data.dates[0]?.date;
        if (nextDate) {
          setSelectedDate(nextDate);
        } else {
          setError('No behavior records yet. Waiting for YOLO detections.');
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load report dates');
        }
      }
    };

    void loadDates();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedDate) {
      return;
    }

    let cancelled = false;

    const loadReport = async () => {
      try {
        const nextReport = await getDailyReport(selectedDate);
        if (cancelled) {
          return;
        }

        setReport(nextReport);
        setError(null);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load report');
        }
      }
    };

    void loadReport();
    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  return (
    <div className="space-y-6 pb-24">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">History Reports</h1>
          <p className="text-slate-500 text-sm">{report?.headline || 'YOLO Cat Behavior Report'}</p>
        </div>
        <div className="flex gap-2">
          <button className="p-2 bg-white rounded-xl card-shadow border border-slate-100 text-slate-600">
            <Download className="w-5 h-5" />
          </button>
          <button className="p-2 bg-white rounded-xl card-shadow border border-slate-100 text-slate-600">
            <Share2 className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
        {dates.map((d) => (
          <button
            key={d.date}
            onClick={() => setSelectedDate(d.date)}
            className={cn(
              'flex-shrink-0 px-5 py-3 rounded-2xl border transition-all',
              selectedDate === d.date
                ? 'bg-brand-600 border-brand-600 text-white shadow-lg shadow-brand-200'
                : 'bg-white border-slate-100 text-slate-600 hover:border-slate-200',
            )}
          >
            <p className="text-[10px] uppercase font-bold tracking-wider opacity-60">{d.label}</p>
            <p className="text-sm font-bold">{d.date.split('-').slice(1).join('/')}</p>
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 card-shadow">
          {error}
        </div>
      ) : report ? (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-3xl card-shadow border border-slate-100">
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-amber-50 rounded-2xl">
                  <CloudSun className="w-6 h-6 text-amber-500" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800">{report.date}</h3>
                  <p className="text-xs text-slate-500">{report.weather} {report.temperature}</p>
                </div>
              </div>
            </div>

            <div className="mb-6 rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                    YOLO26 Dataset
                  </p>
                  <p className="mt-2 text-sm font-semibold text-slate-800">
                    YOLO26 Format · 6 Behavior Classes
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Same detected class is logged once every hour
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {(report.detectedClasses?.length
                  ? report.detectedClasses
                  : ['eating', 'playing', 'rest', 'sitting', 'stretching', 'yawning']
                ).map((className) => (
                  <span
                    key={className}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600"
                  >
                    {className}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 bg-slate-50 rounded-2xl">
                <Activity className="w-4 h-4 text-blue-500 mx-auto mb-1" />
                <p className="text-[10px] text-slate-400 font-bold uppercase">Activity</p>
                <p className="text-sm font-bold text-slate-800">{report.summary.activityDuration}</p>
              </div>
              <div className="text-center p-3 bg-slate-50 rounded-2xl">
                <Utensils className="w-4 h-4 text-orange-500 mx-auto mb-1" />
                <p className="text-[10px] text-slate-400 font-bold uppercase">Feeding</p>
                <p className="text-sm font-bold text-slate-800">{report.summary.feedingCount} times</p>
              </div>
              <div className="text-center p-3 bg-slate-50 rounded-2xl">
                <AlertTriangle className="w-4 h-4 text-red-500 mx-auto mb-1" />
                <p className="text-[10px] text-slate-400 font-bold uppercase">Anomalies</p>
                <p className="text-sm font-bold text-slate-800">{report.summary.anomalies} times</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-3xl card-shadow border border-slate-100">
            <h3 className="font-bold text-slate-800 mb-6">Detailed Behavior Timeline</h3>
            <div className="space-y-8">
              {report.timeline.map((item, i) => (
                <div key={`${item.time}-${item.event}-${i}`} className="flex gap-4 relative">
                  {i !== report.timeline.length - 1 && (
                    <div className="absolute left-2.5 top-6 bottom-[-32px] w-0.5 bg-slate-100" />
                  )}
                  <div className={cn(
                    'w-5 h-5 rounded-full border-4 border-white ring-2 flex-shrink-0 z-10',
                    item.type === 'rest' ? 'ring-indigo-500 bg-indigo-500' :
                    item.type === 'feeding' ? 'ring-orange-500 bg-orange-500' :
                    item.type === 'alert' ? 'ring-red-500 bg-red-500' :
                    'ring-blue-500 bg-blue-500',
                  )} />
                  <div className="flex-1">
                    <div className="flex justify-between items-center mb-1">
                      <p className="text-sm font-bold text-slate-800">{item.event}</p>
                      <span className="text-xs font-mono text-slate-400">{item.time}</span>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-indigo-50 p-6 rounded-3xl border border-indigo-100">
            <h3 className="font-bold text-indigo-900 mb-3">YOLO Notes</h3>
            <ul className="space-y-3">
              {report.suggestions.map((suggestion, i) => (
                <li key={i} className="flex gap-3 text-sm text-indigo-700 leading-relaxed">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 flex-shrink-0" />
                  {suggestion}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 card-shadow">
          Loading report...
        </div>
      )}
    </div>
  );
}
