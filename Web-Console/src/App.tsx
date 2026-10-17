import React, { useState } from 'react';
import {
  LayoutDashboard,
  Video,
  Settings as SettingsIcon,
  Gamepad2,
  FileText, PawPrint, Globe
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { Page } from './types';
import { useLanguage } from './lib/i18n';

// Components
import Dashboard from './components/Dashboard';
import Monitor from './components/Monitor';
import Control from './components/Control';
import Settings from './components/Settings';
import NvrConsole from './components/NvrConsole';
import AgentConsole from './components/AgentConsole';
import HardwareGuard from './components/HardwareGuard';

declare const __APP_VERSION__: string;
export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('nvr');
  const [location, setLocation] = useState<import('./lib/console-types').ReviewLocation | undefined>();
  const { dict, language, setLanguage } = useLanguage();
  const zh = language === 'zh';
  const navItems = [
    {id:'nvr',label:zh?'活动回看':'Activity',icon:Video},
    {id:'reports',label:zh?'行为报告':'Reports',icon:FileText},
    {id:'dashboard',label:dict.nav.dashboard,icon:LayoutDashboard},
    {id:'monitor',label:dict.nav.monitor,icon:Video},
    {id:'control',label:dict.nav.control,icon:Gamepad2},
    {id:'settings',label:dict.nav.settings,icon:SettingsIcon},
  ];
  const renderPage = () => {
    switch(currentPage) {
      case 'nvr': return <NvrConsole location={location}/>;
      case 'reports': return <AgentConsole onReview={next=>{setLocation(next);setCurrentPage('nvr');}}/>;
      case 'dashboard': return <Dashboard/>;
      case 'monitor': return <Monitor/>;
      case 'control': return <HardwareGuard><Control/></HardwareGuard>;
      default: return <Settings/>;
    }
  };
  return <div className="care-shell">
    <aside className="care-sidebar">
      <a href="#" onClick={e=>{e.preventDefault();setCurrentPage('nvr');}} className="care-logo"><span><PawPrint size={25}/></span><div>Hajimi<small>{zh?'陪伴每一个日常':'A little closer, every day'}</small></div></a>
      <p className="sidebar-caption">{zh?'我的宠物空间':'YOUR PET SPACE'}</p>
      <nav aria-label={zh?'主导航':'Main navigation'}>{navItems.map(item=><button key={item.id} aria-current={currentPage===item.id?'page':undefined} onClick={()=>setCurrentPage(item.id as Page)} className={cn('care-nav-item',currentPage===item.id&&'active')}><item.icon size={19}/><span>{item.label}</span></button>)}</nav>
      <div className="sidebar-note"><PawPrint size={22}/><p>{zh?'把每一次活动，变成更懂它的线索。':'Small moments. A better understanding.'}</p><span>v{__APP_VERSION__}</span></div>
    </aside>
    <div className="care-workspace">
      <header className="care-topbar"><div className="flex items-center gap-2 text-sm"><PawPrint size={17} className="text-[#65836a]"/><span>{zh?'哈基米的陪伴日记':'Hajimi’s care journal'}</span></div><button className="quiet-button" onClick={()=>setLanguage(zh?'en':'zh')} aria-label={zh?'切换为英文':'Switch to Chinese'}><Globe size={15}/>{zh?'English':'中文'}</button></header>
      <main className={cn('care-main',!['nvr','reports'].includes(currentPage)&&'care-main-narrow')}>
        <AnimatePresence mode="wait"><motion.div key={currentPage} initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0}} transition={{duration:.16}}>{renderPage()}</motion.div></AnimatePresence>
      </main>
    </div>
    <nav className="care-mobile-nav" aria-label={zh?'移动导航':'Mobile navigation'}>{navItems.map(item=><button key={item.id} aria-current={currentPage===item.id?'page':undefined} onClick={()=>setCurrentPage(item.id as Page)} className={currentPage===item.id?'active':''}><item.icon size={20}/><span>{item.label}</span></button>)}</nav>
  </div>;
}
