import React, {useEffect, useRef} from 'react';
import {X} from 'lucide-react';
import {useCopy} from '../lib/copy';
export default function ConsoleDrawer({open,title,onClose,children}:{open:boolean;title:string;onClose:()=>void;children:React.ReactNode}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const {t} = useCopy();
  useEffect(()=>{const node=dialog.current;if(open&&!node?.open)node?.showModal();if(!open&&node?.open)node.close();},[open]);
  return <dialog ref={dialog} onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}} className="console-drawer" aria-label={title}>
    <div className="flex items-center justify-between border-b border-stone-200 px-6 py-5"><h2 className="text-lg font-semibold">{title}</h2><button className="icon-button" onClick={onClose} aria-label={t('关闭','Close')}><X size={20}/></button></div>
    <div className="space-y-5 p-6">{open ? children : null}</div>
  </dialog>;
}
