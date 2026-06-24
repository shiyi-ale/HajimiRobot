import React, { useState } from 'react';
import {
  Bell,
  ChevronRight,
  Cpu,
  Eye,
  Globe2,
  LogOut,
  Power,
  Shield,
  Smartphone,
  User,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { useLanguage } from '@/src/lib/i18n';

async function postJson(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let data: unknown;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(typeof data === 'object' && data !== null && 'error' in data ? String(data.error) : `Request failed: ${response.status}`);
  }

  return data;
}

export default function Settings() {
  const { dict, language, setLanguage } = useLanguage();
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [feedback, setFeedback] = useState(dict.settings.feedback);
  const [feedbackTone, setFeedbackTone] = useState<'default' | 'error'>('default');

  const sections = [
    {
      title: dict.settings.deviceConfig,
      items: [
        { icon: Cpu, label: dict.settings.deviceNaming, value: 'Hajime-01', color: 'text-blue-500', bg: 'bg-blue-50' },
        { icon: Eye, label: dict.settings.calibration, value: dict.settings.calibrationValue, color: 'text-indigo-500', bg: 'bg-indigo-50' },
      ],
    },
    {
      title: dict.settings.alerts,
      items: [
        { icon: Bell, label: dict.settings.alerts, value: dict.settings.alertsValue, color: 'text-orange-500', bg: 'bg-orange-50' },
        { icon: Shield, label: dict.settings.privacy, value: dict.settings.privacyValue, color: 'text-purple-500', bg: 'bg-purple-50' },
      ],
    },
    {
      title: dict.settings.preferences,
      items: [
        { icon: Smartphone, label: dict.settings.displayMode, value: dict.settings.displayModeValue, color: 'text-slate-500', bg: 'bg-slate-50' },
        { icon: User, label: dict.settings.profile, value: 'hangjianzhao7', color: 'text-brand-500', bg: 'bg-brand-50' },
      ],
    },
  ];

  const handleShutdown = async () => {
    const firstConfirm = window.confirm(dict.settings.shutdownConfirm1);
    if (!firstConfirm) {
      return;
    }

    const secondConfirm = window.confirm(dict.settings.shutdownConfirm2);
    if (!secondConfirm) {
      return;
    }

    setIsShuttingDown(true);
    setFeedbackTone('default');
    setFeedback(dict.settings.shutdownSending);

    try {
      await postJson('/api/system/shutdown?confirm=true');
      setFeedback(dict.settings.shutdownSent);
    } catch (error) {
      setFeedbackTone('error');
      setFeedback(error instanceof Error ? error.message : dict.settings.shutdownFailed);
    } finally {
      setIsShuttingDown(false);
    }
  };

  return (
    <div className="space-y-6 pb-24">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">{dict.settings.title}</h1>
        <p className="text-slate-500 text-sm">{dict.settings.subtitle}</p>
      </header>

      <div
        className={cn(
          'rounded-2xl border px-4 py-3 text-sm',
          feedbackTone === 'error'
            ? 'border-red-200 bg-red-50 text-red-700'
            : 'border-amber-200 bg-amber-50 text-amber-700',
        )}
      >
        {feedback}
      </div>

      <div className="space-y-8">
        <div className="space-y-3">
          <h3 className="px-2 text-[10px] uppercase font-bold tracking-widest text-slate-400">
            {dict.settings.preferences}
          </h3>
          <div className="bg-white rounded-3xl card-shadow border border-slate-100 overflow-hidden">
            <div className="w-full flex items-center justify-between p-4 border-b border-slate-50">
              <div className="flex items-center gap-4">
                <div className="p-2 rounded-xl bg-emerald-50">
                  <Globe2 className="w-5 h-5 text-emerald-500" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-bold text-slate-800">{dict.settings.language}</p>
                  <p className="text-xs text-slate-500">
                    {language === 'zh' ? dict.settings.zh : dict.settings.en}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-full bg-slate-100 p-1">
                <button
                  onClick={() => setLanguage('zh')}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-bold transition-colors',
                    language === 'zh' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
                  )}
                >
                  {dict.settings.zh}
                </button>
                <button
                  onClick={() => setLanguage('en')}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-bold transition-colors',
                    language === 'en' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
                  )}
                >
                  {dict.settings.en}
                </button>
              </div>
            </div>
          </div>
        </div>

        {sections.map((section, i) => (
          <div key={i} className="space-y-3">
            <h3 className="px-2 text-[10px] uppercase font-bold tracking-widest text-slate-400">
              {section.title}
            </h3>
            <div className="bg-white rounded-3xl card-shadow border border-slate-100 overflow-hidden">
              {section.items.map((item, j) => (
                <button
                  key={j}
                  className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0"
                >
                  <div className="flex items-center gap-4">
                    <div className={cn('p-2 rounded-xl', item.bg)}>
                      <item.icon className={cn('w-5 h-5', item.color)} />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-bold text-slate-800">{item.label}</p>
                      <p className="text-xs text-slate-500">{item.value}</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300" />
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="space-y-3">
          <h3 className="px-2 text-[10px] uppercase font-bold tracking-widest text-slate-400">
            {dict.settings.power}
          </h3>
          <div className="bg-white rounded-3xl card-shadow border border-red-100 overflow-hidden">
            <button
              onClick={() => void handleShutdown()}
              disabled={isShuttingDown}
              className="w-full flex items-center justify-between p-4 text-left transition-colors hover:bg-red-50 disabled:opacity-60"
            >
              <div className="flex items-center gap-4">
                <div className="p-2 rounded-xl bg-red-50">
                  <Power className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800">{dict.settings.shutdown}</p>
                  <p className="text-xs text-slate-500">{dict.settings.shutdownDesc}</p>
                </div>
              </div>
              <span className="rounded-full bg-red-600 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white">
                {isShuttingDown ? 'WAIT' : 'POWER'}
              </span>
            </button>
          </div>
        </div>

        <button className="w-full flex items-center justify-center gap-2 p-4 bg-red-50 text-red-600 rounded-2xl font-bold text-sm hover:bg-red-100 transition-colors">
          <LogOut className="w-4 h-4" />
          {dict.settings.logout}
        </button>

        <div className="text-center space-y-1">
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">Hajime Robot v1.0.4</p>
          <p className="text-[10px] text-slate-300">Made with love for pets</p>
        </div>
      </div>
    </div>
  );
}
