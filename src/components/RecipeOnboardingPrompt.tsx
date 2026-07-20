"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleHelp, X } from "lucide-react";

const storageKey = "mixarr.recipe-onboarding.v239";

export default function RecipeOnboardingPrompt(){const[visible,setVisible]=useState(false);useEffect(()=>{setVisible(!window.localStorage.getItem(storageKey));},[]);if(!visible)return null;function dismiss(){window.localStorage.setItem(storageKey,"dismissed");setVisible(false);}return <section style={{display:"grid",gridTemplateColumns:"auto 1fr auto",gap:'.7rem',alignItems:'center',padding:'.8rem',border:'1px solid rgba(53,174,234,.28)',borderRadius:'var(--radius-lg)',background:'rgba(53,174,234,.06)'}} aria-label="Recipe onboarding"><CircleHelp/><div><strong>New to Mix Recipes?</strong><p style={{margin:'.2rem 0',color:'var(--muted)',fontSize:'.8rem'}}>Check library readiness, learn safety modes, and choose a starter strategy in a short guided introduction.</p><Link href="/recipes/onboarding" style={{color:'#b9e9ff',fontWeight:800,fontSize:'.78rem'}}>Start recipe onboarding</Link></div><button onClick={dismiss} aria-label="Dismiss recipe onboarding" style={{width:40,height:40,border:'1px solid var(--line)',borderRadius:'var(--radius-sm)',color:'var(--fg)',background:'transparent'}}><X size={17}/></button></section>}

export function completeRecipeOnboarding(state:"completed"|"dismissed"="completed"){window.localStorage.setItem(storageKey,state);}
