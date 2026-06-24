import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  Video, 
  Settings as SettingsIcon, 
  Gamepad2, 
  FileText 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { Page } from './types';
import { useLanguage } from './lib/i18n';

// Components
import Dashboard from './components/Dashboard';
import Monitor from './components/Monitor';
import Control from './components/Control';
import Reports from './components/Reports';
import Settings from './components/Settings';

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const { dict } = useLanguage();

  const navItems = [
    { id: 'dashboard', label: dict.nav.dashboard, icon: LayoutDashboard },
    { id: 'monitor', label: dict.nav.monitor, icon: Video },
    { id: 'control', label: dict.nav.control, icon: Gamepad2 },
    { id: 'reports', label: dict.nav.reports, icon: FileText },
    { id: 'settings', label: dict.nav.settings, icon: SettingsIcon },
  ];

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return <Dashboard />;
      case 'monitor': return <Monitor />;
      case 'control': return <Control />;
      case 'reports': return <Reports />;
      case 'settings': return <Settings />;
      default: return <Dashboard />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col max-w-xl mx-auto relative shadow-2xl shadow-slate-200">
      {/* Main Content */}
      <main className="flex-1 px-6 pt-8 pb-24 overflow-y-auto no-scrollbar">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentPage}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {renderPage()}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 inset-x-0 max-w-xl mx-auto bg-white/80 backdrop-blur-xl border-t border-slate-100 px-6 py-3 flex justify-between items-center z-50">
        {navItems.map((item) => {
          const isActive = currentPage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setCurrentPage(item.id as Page)}
              className={cn(
                "flex flex-col items-center gap-1 transition-all relative py-1",
                isActive ? "text-brand-600" : "text-slate-400 hover:text-slate-600"
              )}
            >
              <item.icon className={cn(
                "w-6 h-6 transition-transform",
                isActive && "scale-110"
              )} />
              <span className="text-[10px] font-bold tracking-tight">{item.label}</span>
              {isActive && (
                <motion.div 
                  layoutId="nav-indicator"
                  className="absolute -top-3 w-1 h-1 bg-brand-600 rounded-full"
                />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
