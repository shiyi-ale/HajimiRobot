import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { useLanguage } from '@/src/lib/i18n';

type CarAction = 'forward' | 'backward' | 'left' | 'right';
type GimbalAction = 'up' | 'down' | 'left' | 'right';
type FeedbackTone = 'default' | 'error';

const CAR_ACTIVE_FLASH_MS = 180;
const GIMBAL_REPEAT_MS = 55;
const GIMBAL_STEP = 18;

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

function DirectionButton({
  label,
  icon: Icon,
  active,
  onPressStart,
  onPressEnd,
  tone,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onPressStart: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPressEnd: () => void;
  tone: 'sky' | 'emerald';
}) {
  const activeClasses =
    tone === 'emerald'
      ? 'border-emerald-400 bg-emerald-500 text-white shadow-[0_12px_35px_-16px_rgba(16,185,129,0.9)]'
      : 'border-sky-400 bg-sky-500 text-white shadow-[0_12px_35px_-16px_rgba(14,165,233,0.9)]';

  return (
    <button
      type="button"
      onPointerDown={onPressStart}
      onPointerUp={onPressEnd}
      onPointerLeave={onPressEnd}
      onPointerCancel={onPressEnd}
      className={cn(
        'flex h-12 w-12 touch-none select-none items-center justify-center rounded-2xl border text-slate-700 transition-all duration-150 active:scale-95 sm:h-14 sm:w-14',
        active ? activeClasses : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white',
      )}
      aria-label={label}
    >
      <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
    </button>
  );
}

function ControlPad({
  mode,
  title,
  badgeLabel,
  badgeClassName,
  activeAction,
  onStart,
  onStop,
  onCenter,
  tone,
  stopLabel,
}: {
  mode: 'car' | 'gimbal';
  title: string;
  badgeLabel: string;
  badgeClassName: string;
  activeAction: CarAction | GimbalAction | null;
  onStart: (action: CarAction | GimbalAction) => void;
  onStop: () => void;
  onCenter: () => void;
  tone: 'sky' | 'emerald';
  stopLabel: string;
}) {
  return (
    <div className="rounded-[30px] border border-slate-100 bg-slate-50/80 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <h3 className="whitespace-nowrap text-base font-bold text-slate-800">{title}</h3>
        <span className={cn('rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em]', badgeClassName)}>
          {badgeLabel}
        </span>
      </div>

      <div className="mt-5 flex flex-col items-center gap-2.5">
        <DirectionButton
          label="up"
          icon={ArrowUp}
          active={activeAction === 'forward' || activeAction === 'up'}
          onPressStart={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            onStart(mode === 'car' ? 'forward' : 'up');
          }}
          onPressEnd={onStop}
          tone={tone}
        />
        <div className="flex items-center gap-3">
          <DirectionButton
            label="left"
            icon={ArrowLeft}
            active={activeAction === 'left'}
            onPressStart={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              onStart('left');
            }}
            onPressEnd={onStop}
            tone={tone}
          />
          <button
            type="button"
            onClick={onCenter}
            className={cn(
              'flex h-12 w-12 items-center justify-center rounded-2xl border text-[11px] font-bold tracking-[0.18em] text-white transition-transform active:scale-95 sm:h-14 sm:w-14',
              tone === 'emerald' ? 'border-emerald-400 bg-emerald-500' : 'border-slate-900 bg-slate-900',
            )}
          >
            {stopLabel}
          </button>
          <DirectionButton
            label="right"
            icon={ArrowRight}
            active={activeAction === 'right'}
            onPressStart={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              onStart('right');
            }}
            onPressEnd={onStop}
            tone={tone}
          />
        </div>
        <DirectionButton
          label="down"
          icon={ArrowDown}
          active={activeAction === 'backward' || activeAction === 'down'}
          onPressStart={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            onStart(mode === 'car' ? 'backward' : 'down');
          }}
          onPressEnd={onStop}
          tone={tone}
        />
      </div>
    </div>
  );
}

export default function DriveControls({
  className,
  showFeedback = true,
}: {
  className?: string;
  showFeedback?: boolean;
}) {
  const { dict } = useLanguage();
  const [activeCarAction, setActiveCarAction] = useState<CarAction | null>(null);
  const [activeGimbalAction, setActiveGimbalAction] = useState<GimbalAction | null>(null);
  const [feedback, setFeedback] = useState(dict.drive.feedback);
  const [feedbackTone, setFeedbackTone] = useState<FeedbackTone>('default');

  const carActiveTimeoutRef = useRef<number | null>(null);
  const gimbalIntervalRef = useRef<number | null>(null);
  const activeGimbalRef = useRef<GimbalAction | null>(null);

  const setSuccessFeedback = (message: string) => {
    setFeedbackTone('default');
    setFeedback(message);
  };

  const setErrorFeedback = (error: unknown, fallback: string) => {
    setFeedbackTone('error');
    setFeedback(error instanceof Error ? error.message : fallback);
  };

  const clearCarFlash = () => {
    if (carActiveTimeoutRef.current != null) {
      window.clearTimeout(carActiveTimeoutRef.current);
      carActiveTimeoutRef.current = null;
    }
  };

  const clearGimbalLoop = () => {
    if (gimbalIntervalRef.current != null) {
      window.clearInterval(gimbalIntervalRef.current);
      gimbalIntervalRef.current = null;
    }
  };

  const sendCarAction = async (action: CarAction | 'stop') => {
    await postJson(`/api/control/car/${action}`);
  };

  const sendGimbalAction = async (action: GimbalAction | 'center') => {
    const suffix = action === 'center' ? '' : `?step=${GIMBAL_STEP}`;
    await postJson(`/api/control/gimbal/${action}${suffix}`);
  };

  const stopCarControl = async () => {
    clearCarFlash();
    setActiveCarAction(null);
    try {
      await sendCarAction('stop');
      setSuccessFeedback(dict.drive.stopCarSuccess);
    } catch (error) {
      setErrorFeedback(error, dict.drive.stopCarError);
    }
  };

  const stopGimbalControl = () => {
    clearGimbalLoop();
    const hadActiveAction = activeGimbalRef.current != null;
    activeGimbalRef.current = null;
    setActiveGimbalAction(null);

    if (hadActiveAction) {
      setSuccessFeedback(dict.drive.gimbalStop);
    }
  };

  const triggerCarAction = async (action: CarAction) => {
    clearCarFlash();
    setActiveCarAction(action);
    setSuccessFeedback(dict.drive.sentCar[action]);

    carActiveTimeoutRef.current = window.setTimeout(() => {
      setActiveCarAction((current) => (current === action ? null : current));
      carActiveTimeoutRef.current = null;
    }, CAR_ACTIVE_FLASH_MS);

    try {
      await sendCarAction(action);
    } catch (error) {
      clearCarFlash();
      setActiveCarAction(null);
      setErrorFeedback(error, dict.drive.sendCarError);
    }
  };

  const startGimbalControl = (action: GimbalAction) => {
    if (activeGimbalRef.current === action && gimbalIntervalRef.current != null) {
      return;
    }

    clearGimbalLoop();
    activeGimbalRef.current = action;
    setActiveGimbalAction(action);
    setSuccessFeedback(dict.drive.gimbalMoving[action]);

    void sendGimbalAction(action).catch((error) => setErrorFeedback(error, dict.drive.sendGimbalError));
    gimbalIntervalRef.current = window.setInterval(() => {
      void sendGimbalAction(action).catch((error) => {
        clearGimbalLoop();
        activeGimbalRef.current = null;
        setActiveGimbalAction(null);
        setErrorFeedback(error, dict.drive.sendGimbalError);
      });
    }, GIMBAL_REPEAT_MS);
  };

  const handleGimbalCenter = async () => {
    clearGimbalLoop();
    activeGimbalRef.current = null;
    setActiveGimbalAction(null);

    try {
      await sendGimbalAction('center');
      setSuccessFeedback(dict.drive.gimbalCenter);
    } catch (error) {
      setErrorFeedback(error, dict.drive.centerError);
    }
  };

  useEffect(() => {
    const handlePointerRelease = () => {
      stopGimbalControl();
    };

    window.addEventListener('pointerup', handlePointerRelease);
    window.addEventListener('pointercancel', handlePointerRelease);
    window.addEventListener('blur', handlePointerRelease);

    return () => {
      window.removeEventListener('pointerup', handlePointerRelease);
      window.removeEventListener('pointercancel', handlePointerRelease);
      window.removeEventListener('blur', handlePointerRelease);
      clearCarFlash();
      clearGimbalLoop();
    };
  }, []);

  return (
    <div className={cn('rounded-3xl border border-slate-100 bg-white p-5 sm:p-6 card-shadow', className)}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{dict.drive.title}</h2>
          <p className="mt-1 text-sm text-slate-500">{dict.drive.subtitle}</p>
        </div>
        <span className="rounded-full bg-slate-900 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white">
          {dict.drive.live}
        </span>
      </div>

      {showFeedback && (
        <div
          className={cn(
            'mt-4 rounded-2xl border px-4 py-3 text-sm',
            feedbackTone === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-100 bg-emerald-50 text-emerald-700',
          )}
        >
          {feedback}
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-4">
        <ControlPad
          mode="car"
          title={dict.drive.carTitle}
          badgeLabel={dict.drive.carBadge}
          badgeClassName="bg-sky-50 text-sky-700"
          activeAction={activeCarAction}
          onStart={(action) => {
            void triggerCarAction(action as CarAction);
          }}
          onStop={() => {}}
          onCenter={() => void stopCarControl()}
          tone="sky"
          stopLabel={dict.drive.stopLabel}
        />
        <ControlPad
          mode="gimbal"
          title={dict.drive.gimbalTitle}
          badgeLabel={dict.drive.gimbalBadge}
          badgeClassName="bg-emerald-50 text-emerald-700"
          activeAction={activeGimbalAction}
          onStart={(action) => startGimbalControl(action as GimbalAction)}
          onStop={stopGimbalControl}
          onCenter={() => void handleGimbalCenter()}
          tone="emerald"
          stopLabel={dict.drive.midLabel}
        />
      </div>
    </div>
  );
}
