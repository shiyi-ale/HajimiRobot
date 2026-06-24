import React, { useState } from 'react';
import { Clock, Loader2, Minus, Plus, Target, Trash2, Utensils } from 'lucide-react';
import DriveControls from './DriveControls';
import { cn } from '@/src/lib/utils';
import { useLanguage } from '@/src/lib/i18n';
import type { FeedingPlan } from '@/src/types';

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

export default function Control() {
  const { dict } = useLanguage();
  const [isFeeding, setIsFeeding] = useState(false);
  const [trackingEnabled, setTrackingEnabled] = useState(true);
  const [feedback, setFeedback] = useState(dict.control.feedback);
  const [feedbackTone, setFeedbackTone] = useState<'default' | 'error'>('default');
  const [plans, setPlans] = useState<FeedingPlan[]>([
    { id: '1', time: '08:00', portions: 1 },
    { id: '2', time: '18:00', portions: 2 },
  ]);
  const [newPlanTime, setNewPlanTime] = useState('08:00');
  const [newPlanPortions, setNewPlanPortions] = useState(1);

  const setSuccessFeedback = (message: string) => {
    setFeedbackTone('default');
    setFeedback(message);
  };

  const setErrorFeedback = (error: unknown, fallback: string) => {
    setFeedbackTone('error');
    setFeedback(error instanceof Error ? error.message : fallback);
  };

  const handleFeed = async () => {
    setIsFeeding(true);
    try {
      await postJson('/api/control/feed', { amount: 10 });
      setSuccessFeedback(dict.control.feedSuccess);
    } catch (error) {
      setErrorFeedback(error, dict.control.feedError);
    } finally {
      setIsFeeding(false);
    }
  };

  const handleTrackingToggle = async () => {
    const nextValue = !trackingEnabled;
    setTrackingEnabled(nextValue);

    try {
      await postJson('/api/control/tracking', { enabled: nextValue });
      setSuccessFeedback(nextValue ? dict.control.trackingOn : dict.control.trackingOff);
    } catch (error) {
      setTrackingEnabled(!nextValue);
      setErrorFeedback(error, dict.control.trackingError);
    }
  };

  const handleAddPlan = () => {
    if (!newPlanTime) {
      setErrorFeedback(new Error(dict.control.chooseTime), dict.control.addPlanError);
      return;
    }

    setPlans((current) =>
        [...current, { id: crypto.randomUUID(), time: newPlanTime, portions: newPlanPortions }]
        .sort((a, b) => a.time.localeCompare(b.time)),
    );
    setSuccessFeedback(
      dict.control.addPlanSuccess
        .replace('{time}', newPlanTime)
        .replace('{portions}', String(newPlanPortions)),
    );
  };

  const handleDeletePlan = (id: string) => {
    setPlans((current) => current.filter((plan) => plan.id !== id));
    setSuccessFeedback(dict.control.deletePlanSuccess);
  };

  const handlePortionChange = (id: string, delta: number) => {
    setPlans((current) =>
      current.map((plan) =>
        plan.id === id
          ? { ...plan, portions: Math.max(1, plan.portions + delta) }
          : plan,
      ),
    );
  };

  return (
    <div className="space-y-6 pb-24">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">{dict.control.title}</h1>
        <p className="text-slate-500 text-sm">{dict.control.subtitle}</p>
      </header>

      <div
        className={cn(
          'rounded-2xl border px-4 py-3 text-sm',
          feedbackTone === 'error'
            ? 'border-red-200 bg-red-50 text-red-700'
            : 'border-emerald-100 bg-emerald-50 text-emerald-700',
        )}
      >
        {feedback}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => void handleFeed()}
          disabled={isFeeding}
          className="bg-white p-6 rounded-3xl card-shadow border border-slate-100 flex flex-col items-center gap-3 active:scale-95 transition-transform disabled:opacity-50"
        >
          <div className="p-4 bg-orange-50 rounded-2xl">
            {isFeeding ? <Loader2 className="w-6 h-6 text-orange-600 animate-spin" /> : <Utensils className="w-6 h-6 text-orange-600" />}
          </div>
          <span className="font-bold text-slate-800">{dict.control.feedNow}</span>
          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">{dict.control.feedDesc}</span>
        </button>

        <div className="bg-white p-6 rounded-3xl card-shadow border border-slate-100 flex flex-col items-center gap-3">
          <div className="p-4 bg-indigo-50 rounded-2xl">
            <Target className="w-6 h-6 text-indigo-600" />
          </div>
          <span className="font-bold text-slate-800">{dict.control.tracking}</span>
          <button
            onClick={() => void handleTrackingToggle()}
            className={cn(
              'relative h-6 w-12 rounded-full transition-colors',
              trackingEnabled ? 'bg-indigo-500' : 'bg-slate-200',
            )}
          >
            <div
              className={cn(
                'absolute top-1 h-4 w-4 rounded-full bg-white transition-all',
                trackingEnabled ? 'left-7' : 'left-1',
              )}
            />
          </button>
        </div>
      </div>

      <DriveControls showFeedback={false} />

      <div className="bg-white p-6 rounded-3xl card-shadow border border-slate-100">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-bold text-slate-800">{dict.control.feedPlans}</h3>
          <span className="rounded-full bg-brand-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-brand-600">
            {plans.length} {dict.control.plansSuffix}
          </span>
        </div>

        <div className="mb-5 rounded-2xl border border-slate-100 bg-slate-50 p-4">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <label className="flex flex-col gap-2">
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{dict.control.feedTime}</span>
              <input
                type="time"
                value={newPlanTime}
                onChange={(event) => setNewPlanTime(event.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-brand-400"
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{dict.control.portions}</span>
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-2">
                <button
                  onClick={() => setNewPlanPortions((current) => Math.max(1, current - 1))}
                  className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="min-w-8 text-center text-sm font-bold text-slate-800">{newPlanPortions}</span>
                <button
                  onClick={() => setNewPlanPortions((current) => current + 1)}
                  className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </label>
          </div>

          <button
            onClick={handleAddPlan}
            className="mt-4 w-full rounded-2xl bg-brand-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-brand-700"
          >
            {dict.control.addFeedTime}
          </button>
        </div>

        <div className="space-y-4">
          {plans.map((plan) => (
            <div key={plan.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-white rounded-xl shadow-sm">
                  <Clock className="w-4 h-4 text-slate-400" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800">{plan.time}</p>
                  <p className="text-xs text-slate-500">{plan.portions} {dict.control.portionUnit}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handlePortionChange(plan.id, -1)}
                  className="p-2 text-slate-400 hover:text-slate-600"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handlePortionChange(plan.id, 1)}
                  className="p-2 text-brand-500 hover:text-brand-700"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDeletePlan(plan.id)}
                  className="p-2 text-red-400 hover:text-red-600"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
