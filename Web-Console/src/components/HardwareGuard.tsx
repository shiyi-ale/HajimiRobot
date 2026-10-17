import React, { useEffect, useState } from 'react';
export default function HardwareGuard({ children }: { children: React.ReactNode }) {
  const [online, setOnline] = useState(false);
  useEffect(() => {
    let active = true;
    const poll = () => fetch('/api/jetson/status', { signal: AbortSignal.timeout(3000) })
      .then(r => { if (active) setOnline(r.ok); }).catch(() => { if (active) setOnline(false); });
    void poll();
    const timer = setInterval(poll, 5000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <><p role="status" className="mb-4 rounded-xl bg-slate-100 p-3 text-sm">Jetson {online ? '已连接' : '离线 · 硬件操作已禁用'}</p><fieldset disabled={!online} className={!online ? 'opacity-50' : ''}>{children}</fieldset></>;
}
