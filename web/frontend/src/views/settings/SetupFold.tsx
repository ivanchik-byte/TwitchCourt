import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export function SetupFold({ title, note, open, onToggle, children }: { title: string; note: string; open: boolean; onToggle: () => void; children: ReactNode }) {
 const id=useId()
 const [visited,setVisited]=useState(open)
 const body=useRef<HTMLDivElement>(null)
 useEffect(()=>{
  if(open)setVisited(true)
  else body.current?.querySelectorAll('audio').forEach(audio=>audio.pause())
 },[open])
 return <section className={`setup-fold${open?' is-open':''}`}>
  <button type="button" className="setup-fold-heading" aria-expanded={open} aria-controls={id} onClick={onToggle}><span><strong>{title}</strong><small>{note}</small></span><ChevronDown size={19} aria-hidden="true" /></button>
  <div ref={body} id={id} className="setup-fold-body" hidden={!open}>{open||visited?children:null}</div>
 </section>
}
