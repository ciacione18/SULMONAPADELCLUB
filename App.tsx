import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Team, Match, TournamentConfig, MatchScore, TournamentArchive, Streak, PairStats, PlayerStats, TeamStats } from './types';
import { generateSchedule, calculateStats, calculatePlayerRankings, calculateStreaks, calculatePairStats } from './utils/scheduler';
import { generateTournamentAnalysis } from './services/geminiService';
import { GoogleGenAI } from "@google/genai";
import { Trophy, Users, Calendar, Activity, Plus, Shield, CheckCircle, Award, User, UserPlus, X, Shuffle, Edit3, Save, List, Home, MapPin, FileText, Trash2, Crown, Flame, Settings, RefreshCw, Globe, UserCheck, Download, Upload, TrendingUp, TrendingDown, Minus, Archive, FolderOpen, FileJson, History, RotateCcw, ClipboardList, Zap, Swords, Target, Crosshair, Star, BarChart3, Users2, PenTool, Share2, Copy, Camera, Image as ImageIcon, Mic, MicOff, GitGraph, GanttChartSquare, AlertTriangle, ArrowRightLeft, Radio, Touchpad } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// --- TYPES FOR UI ---
interface RegistryPlayer {
    name: string;
    nickname?: string; // Added Nickname
    tier: number; // 1 (Pro), 2 (Adv), 3 (Int), 4 (Beg)
    image?: string; // Base64 string of the player's photo
    side?: 'DES' | 'SIN'; // Preferred side
}

// --- UTILS ---

const generateId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        try { return crypto.randomUUID(); } catch (e) {}
    }
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

function safeJSONParse<T>(key: string, fallback: T): T {
    try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : fallback;
    } catch (e) {
        console.warn(`Error parsing localStorage key "${key}":`, e);
        return fallback;
    }
}

// Image Resizer helper to prevent storage quota issues
const resizeImage = (file: File, maxWidth: number = 300): Promise<string> => {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) return resolve(e.target?.result as string);
                
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }
                
                canvas.width = width;
                canvas.height = height;
                
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.src = e.target?.result as string;
        };
        reader.readAsDataURL(file);
    });
};

// Blob to Base64 helper for Audio
const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
        const base64data = reader.result as string;
        // Remove the Data-URI prefix to get just the base64 string
        const base64String = base64data.split(',')[1];
        resolve(base64String);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// WhatsApp Helper
const copyStandingsToClipboard = (stats: any[], teams: Team[]) => {
    let text = "*🏆 CLASSIFICA TORNEO PADEL 🏆*\n\n";
    stats.forEach((s, i) => {
        const tName = teams.find(t => t.id === s.teamId)?.name || 'Team';
        let medal = '';
        if (i===0) medal = '🥇';
        else if (i===1) medal = '🥈';
        else if (i===2) medal = '🥉';
        else medal = `${i+1}.`;
        
        text += `${medal} *${tName}* - Pt: ${s.points} (Diff: ${s.gamesWon - s.gamesLost})\n`;
    });
    text += "\n_Generato da Sulmona Padel Manager_";
    
    navigator.clipboard.writeText(text).then(() => {
        alert("Classifica copiata! Incollala su WhatsApp.");
    });
};

// --- WEB GENERATOR ---
const generateStaticWebPage = (
    tournament: { name: string, config: TournamentConfig, teams: Team[], matches: Match[] }, 
    stats: TeamStats[], 
    playerStats: PlayerStats[], 
    registryPlayers: RegistryPlayer[], 
    logo: string | null,
    aiReport: string | null
) => {
    const sortedMatches = [...tournament.matches].sort((a, b) => a.round - b.round);
    
    // Calculate FUT stats for all players
    const playersWithCards = playerStats.map((p, index) => {
        const fut = calculateFutStats(p);
        const rp = registryPlayers.find(reg => reg.name === p.name);
        return { 
            ...p, 
            fut, 
            rank: index + 1, 
            image: rp?.image, 
            side: rp?.side,
            nickname: rp?.nickname // Pass Nickname
        };
    });

    // GENERATE HEADLINES FOR NEWS TICKER
    const headlines = [`TORNEO LIVE: ${tournament.name.toUpperCase()}`];
    
    // Leader
    if (stats.length > 0) {
        const leader = tournament.teams.find(t => t.id === stats[0].teamId);
        if (leader) headlines.push(`IN TESTA: ${leader.name} (${stats[0].points} PT)`);
    }

    // Last Result
    const playedMatches = tournament.matches.filter(m => m.played && m.score).sort((a,b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0));
    if (playedMatches.length > 0) {
        const last = playedMatches[0];
        const tA = tournament.teams.find(t => t.id === last.teamAId)?.name || 'Team A';
        const tB = tournament.teams.find(t => t.id === last.teamBId)?.name || 'Team B';
        const s = last.score!;
        const scoreStr = `${s.set1.a}-${s.set1.b} ${s.set2.a}-${s.set2.b}` + (s.set3 ? ` ${s.set3.a}-${s.set3.b}` : '');
        headlines.push(`ULTIMO RISULTATO: ${tA} vs ${tB} [${scoreStr}]`);
    }

    // MVP
    if (playerStats.length > 0) {
        headlines.push(`MVP ATTUALE: ${playerStats[0].name} (WR: ${playerStats[0].winRate.toFixed(0)}%)`);
    }

    // Next Match
    const nextMatch = tournament.matches.find(m => !m.played);
    if (nextMatch) {
         const tA = tournament.teams.find(t => t.id === nextMatch.teamAId)?.name || 'Team A';
         const tB = tournament.teams.find(t => t.id === nextMatch.teamBId)?.name || 'Team B';
         headlines.push(`PROSSIMO INCONTRO: ${tA} vs ${tB} (R${nextMatch.round})`);
    } else if (playedMatches.length === tournament.matches.length && tournament.matches.length > 0) {
        headlines.push("TORNEO COMPLETATO - CONTROLLA LA CLASSIFICA FINALE");
    }

    const newsTickerHtml = `
        <div class="bg-yellow-400 border-b-2 border-yellow-500 flex items-stretch h-10 shadow-lg relative z-40 overflow-hidden">
            <div class="bg-red-600 text-white px-4 flex items-center justify-center font-black italic tracking-tighter uppercase text-sm shrink-0 shadow-[4px_0_10px_rgba(0,0,0,0.3)] z-10">
                <span class="flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-pulse"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1"/></svg>
                    SULMONA PADEL NEWS
                </span>
            </div>
            <div class="flex-1 flex items-center bg-yellow-400 text-slate-900 overflow-hidden relative">
                <div class="animate-marquee whitespace-nowrap flex items-center gap-12 text-sm font-bold uppercase tracking-wide px-4">
                    ${[...headlines, ...headlines].map(item => `
                        <span class="inline-flex items-center gap-2">
                             <span class="w-1.5 h-1.5 bg-slate-900 rounded-full"></span>
                             ${item}
                        </span>
                    `).join('')}
                </div>
            </div>
        </div>
    `;

    const style = `
        <script src="https://cdn.tailwindcss.com"></script>
        <script>
            tailwind.config = {
                theme: { extend: { colors: { padel: { dark: '#1e293b', court: '#3b82f6', ball: '#eab308' } } } }
            }
        </script>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
            body { font-family: 'Inter', sans-serif; -webkit-tap-highlight-color: transparent; }
            
            /* Card Gradients */
            .fut-card-bg-1 { background: linear-gradient(to bottom, #fef08a, #facc15, #ca8a04); border-color: #fde047; color: #713f12; }
            .fut-card-bg-2 { background: linear-gradient(to bottom, #f1f5f9, #cbd5e1, #64748b); border-color: #e2e8f0; color: #0f172a; }
            .fut-card-bg-3 { background: linear-gradient(to bottom, #fde68a, #f59e0b, #b45309); border-color: #fbbf24; color: #451a03; }
            .fut-card-bg-4 { background: linear-gradient(to bottom, #1e293b, #0f172a, #000000); border-color: #475569; color: #ffffff; }

            /* Flip Card CSS */
            .perspective-1000 { perspective: 1000px; }
            .transform-style-3d { transform-style: preserve-3d; }
            .backface-hidden { backface-visibility: hidden; -webkit-backface-visibility: hidden; }
            .rotate-y-180 { transform: rotateY(180deg); }
            .flip-card-inner { transition: transform 0.6s ease-out; transform-style: preserve-3d; transform: translateZ(0); }
            
            /* DESKTOP HOVER (Only on non-touch or fine pointer devices) */
            @media (hover: hover) {
                .group:hover .flip-card-inner { transform: rotateY(180deg); }
            }
            
            /* CLICK CLASS (Activated by JS on Tap for Mobile/Touch) */
            .flip-card-inner.flipped { transform: rotateY(180deg) !important; }

            /* Touch indicator for mobile */
            .touch-hint { display: none; }
            @media (hover: none) {
                .touch-hint { display: block; }
            }

            /* Marquee Animation */
            @keyframes marquee {
                0% { transform: translateX(0); }
                100% { transform: translateX(-50%); }
            }
            .animate-marquee {
                animation: marquee 20s linear infinite;
                min-width: 200%;
            }
        </style>
    `;

    const nav = `
        <div class="flex justify-center gap-4 mb-8 sticky top-0 z-50 bg-slate-900/90 backdrop-blur p-4 border-b border-slate-700 overflow-x-auto">
            <button onclick="showTab('standings')" class="nav-btn text-white px-4 py-2 rounded-lg font-bold bg-padel-court hover:bg-blue-600 transition whitespace-nowrap">Classifica</button>
            <button onclick="showTab('matches')" class="nav-btn text-slate-400 px-4 py-2 rounded-lg font-bold hover:bg-slate-800 transition whitespace-nowrap">Partite</button>
            <button onclick="showTab('cards')" class="nav-btn text-slate-400 px-4 py-2 rounded-lg font-bold hover:bg-slate-800 transition whitespace-nowrap">Giocatori (Cards)</button>
            ${aiReport ? `<button onclick="showTab('analysis')" class="nav-btn text-slate-400 px-4 py-2 rounded-lg font-bold hover:bg-slate-800 transition whitespace-nowrap">Analisi AI</button>` : ''}
        </div>
    `;

    // 1. STANDINGS HTML
    const standingsHtml = `
        <div id="standings" class="tab-content max-w-4xl mx-auto animate-fade-in">
            <h2 class="text-3xl font-black text-center text-white mb-6 uppercase italic">Classifica Generale</h2>
            <div class="bg-slate-800 rounded-xl overflow-hidden shadow-2xl border border-slate-700">
                <table class="w-full text-left text-slate-300">
                    <thead class="bg-slate-900 text-slate-400 uppercase text-xs">
                        <tr>
                            <th class="p-4">#</th>
                            <th class="p-4">Squadra</th>
                            <th class="p-4 text-center text-padel-ball font-bold">PT</th>
                            <th class="p-4 text-center">G</th>
                            <th class="p-4 text-center text-green-400">V</th>
                            <th class="p-4 text-center text-red-400">P</th>
                            <th class="p-4 text-center">Diff</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-700">
                        ${stats.map((s, i) => {
                            const t = tournament.teams.find(tm => tm.id === s.teamId);
                            const medal = i===0 ? '🥇' : i===1 ? '🥈' : i===2 ? '🥉' : i+1;
                            return `
                                <tr class="hover:bg-slate-700/50 transition">
                                    <td class="p-4 font-black text-xl">${medal}</td>
                                    <td class="p-4 font-bold text-white">${t?.name}</td>
                                    <td class="p-4 text-center font-black text-xl text-white bg-slate-700/30">${s.points}</td>
                                    <td class="p-4 text-center">${s.played}</td>
                                    <td class="p-4 text-center text-green-400 font-bold">${s.won}</td>
                                    <td class="p-4 text-center text-red-400 font-bold">${s.lost}</td>
                                    <td class="p-4 text-center font-mono">${s.gamesWon - s.gamesLost > 0 ? '+' : ''}${s.gamesWon - s.gamesLost}</td>
                                </tr>
                            `
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    // 2. MATCHES HTML
    const matchesHtml = `
        <div id="matches" class="tab-content hidden max-w-4xl mx-auto animate-fade-in">
             <h2 class="text-3xl font-black text-center text-white mb-6 uppercase italic">Calendario</h2>
             <div class="grid gap-4">
                ${sortedMatches.map(m => {
                    const tA = tournament.teams.find(t => t.id === m.teamAId)?.name;
                    const tB = tournament.teams.find(t => t.id === m.teamBId)?.name;
                    
                    const getPlayers = (ids?: string[]) => ids ? ids.map(pid => tournament.teams.find(t => t.id === pid)?.name || pid).join(', ') : '';
                    const playersA = getPlayers(m.playersAIds);
                    const playersB = getPlayers(m.playersBIds);

                    const score = m.played && m.score ? 
                        `<span class="text-padel-ball font-mono font-bold text-lg">${m.score.set1.a}-${m.score.set1.b} ${m.score.set2.a}-${m.score.set2.b} ${m.score.set3 && (m.score.set3.a>0||m.score.set3.b>0) ? `(${m.score.set3.a}-${m.score.set3.b})` : ''}</span>` 
                        : '<span class="text-slate-500 italic text-sm">Da giocare</span>';
                    
                    return `
                        <div class="bg-slate-800 p-4 rounded-xl border border-slate-700 flex flex-col md:flex-row items-center justify-between gap-4">
                            <div class="text-xs text-slate-500 font-bold bg-slate-900 px-2 py-1 rounded">R${m.round}</div>
                            <div class="flex-1 flex items-center justify-between w-full md:w-auto gap-4">
                                <div class="flex-1 text-right overflow-hidden">
                                    <div class="text-white font-bold truncate">${tA}</div>
                                    ${playersA ? `<div class="text-[10px] text-slate-400 truncate">${playersA}</div>` : ''}
                                </div>
                                <span class="text-slate-600 font-black text-xs">VS</span>
                                <div class="flex-1 text-left overflow-hidden">
                                    <div class="text-white font-bold truncate">${tB}</div>
                                    ${playersB ? `<div class="text-[10px] text-slate-400 truncate">${playersB}</div>` : ''}
                                </div>
                            </div>
                            <div class="bg-slate-900 px-4 py-2 rounded-lg min-w-[120px] text-center">
                                ${score}
                            </div>
                        </div>
                    `;
                }).join('')}
             </div>
        </div>
    `;

    // 3. CARDS HTML
    const cardsHtml = `
        <div id="cards" class="tab-content hidden max-w-7xl mx-auto animate-fade-in">
            <h2 class="text-3xl font-black text-center text-white mb-2 uppercase italic">Albo Giocatori & Statistiche</h2>
             <p class="text-center text-slate-400 text-sm mb-8 flex items-center justify-center gap-2">
                <svg class="w-4 h-4 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"></path></svg>
                Tocca le carte per vedere le statistiche.
             </p>
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-8 justify-items-center">
                ${playersWithCards.map(p => {
                    let cardClass = 'fut-card-bg-4';
                    let labelColor = 'text-slate-400';
                    if(p.rank === 1) { cardClass = 'fut-card-bg-1'; labelColor = 'text-yellow-800'; }
                    else if(p.rank === 2) { cardClass = 'fut-card-bg-2'; labelColor = 'text-slate-600'; }
                    else if(p.rank === 3) { cardClass = 'fut-card-bg-3'; labelColor = 'text-amber-900'; }

                    const imgHtml = p.image 
                        ? `<img src="${p.image}" class="w-full h-full object-cover" />`
                        : `<div class="w-full h-full flex items-center justify-center"><svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="opacity-50"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>`;

                    return `
                        <div class="group perspective-1000 w-72 h-[28rem] cursor-pointer" onclick="this.querySelector('.flip-card-inner').classList.toggle('flipped')">
                            <div class="relative w-full h-full transform-style-3d flip-card-inner shadow-2xl rounded-3xl">
                                
                                <!-- FRONT -->
                                <div class="absolute inset-0 backface-hidden ${cardClass} rounded-t-3xl rounded-b-3xl border-4 p-4 shadow-xl flex flex-col">
                                    <!-- Top Info -->
                                    <div class="flex items-start justify-between mb-2 font-bold leading-none">
                                        <div class="flex flex-col items-center">
                                            <span class="text-4xl font-black">${p.fut.ovr}</span>
                                            ${p.nickname ? `<span class="text-[11px] italic font-bold uppercase text-current -mt-1 mb-1 truncate max-w-[65px] tracking-tighter">${p.nickname}</span>` : ''}
                                            ${p.side ? `<span class="text-[10px] font-bold mt-1 border border-current px-1 rounded opacity-80">${p.side}</span>` : ''}
                                        </div>
                                        <div class="flex flex-col items-center pt-1 opacity-90">
                                            <span class="text-3xl font-black">#${p.rank}</span>
                                            <span class="text-[9px] uppercase font-bold opacity-75">RANK</span>
                                        </div>
                                    </div>
                                    
                                    <!-- Image -->
                                    <div class="w-full h-40 bg-black/10 rounded-t-full rounded-b-2xl mb-3 flex items-end justify-center overflow-hidden border-b-2 border-black/10 shadow-inner shrink-0 relative">
                                        ${imgHtml}
                                        <div class="touch-hint absolute bottom-2 right-2 bg-black/40 rounded-full p-1 text-white/80 animate-pulse">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                                        </div>
                                    </div>

                                    <!-- Name -->
                                    <div class="text-center mb-4 border-b-2 border-current/20 pb-2">
                                        <h2 class="text-xl font-black uppercase tracking-tighter truncate">${p.name}</h2>
                                    </div>

                                    <!-- Stats -->
                                    <div class="grid grid-cols-2 gap-x-4 gap-y-1 font-black text-lg">
                                        <div class="flex justify-between items-baseline border-b border-current/10"><span>${p.fut.pac}</span> <span class="text-xs ${labelColor} opacity-80">VEL</span></div>
                                        <div class="flex justify-between items-baseline border-b border-current/10"><span>${p.fut.sho}</span> <span class="text-xs ${labelColor} opacity-80">ATT</span></div>
                                        <div class="flex justify-between items-baseline border-b border-current/10"><span>${p.fut.pas}</span> <span class="text-xs ${labelColor} opacity-80">TEC</span></div>
                                        <div class="flex justify-between items-baseline border-b border-current/10"><span>${p.fut.def}</span> <span class="text-xs ${labelColor} opacity-80">DIF</span></div>
                                        <div class="flex justify-between items-baseline"><span>${p.fut.men}</span> <span class="text-xs ${labelColor} opacity-80">MEN</span></div>
                                        <div class="flex justify-between items-baseline"><span>${p.fut.phy}</span> <span class="text-xs ${labelColor} opacity-80">FIS</span></div>
                                    </div>

                                    <!-- Decor -->
                                    <div class="mt-auto flex justify-center opacity-60 pb-2">
                                        <div class="flex items-center gap-2">
                                            <div class="w-1.5 h-1.5 rounded-full bg-current"></div>
                                            <span class="text-[8px] font-bold tracking-[0.2em] uppercase">SULMONA PADEL</span>
                                            <div class="w-1.5 h-1.5 rounded-full bg-current"></div>
                                        </div>
                                    </div>
                                </div>

                                <!-- BACK (Detailed Stats) -->
                                <div class="absolute inset-0 backface-hidden rotate-y-180 bg-slate-900 text-white rounded-3xl border-2 border-slate-600 p-5 shadow-2xl overflow-hidden flex flex-col">
                                    <h3 class="text-center font-black text-xl mb-4 text-padel-court uppercase tracking-widest border-b border-slate-700 pb-2">${p.name}</h3>
                                    
                                    <div class="flex-1 space-y-3 text-sm">
                                        <div class="flex justify-between items-center border-b border-slate-800 pb-1">
                                            <span class="text-slate-400">Punti Classifica</span>
                                            <span class="font-bold text-yellow-400 text-lg">${p.points}</span>
                                        </div>
                                        <div class="flex justify-between items-center border-b border-slate-800 pb-1">
                                            <span class="text-slate-400">Match (V-P)</span>
                                            <span class="font-bold">${p.played} <span class="text-xs font-normal text-slate-500">(${p.won}-${p.lost})</span></span>
                                        </div>
                                        <div class="flex justify-between items-center border-b border-slate-800 pb-1">
                                            <span class="text-slate-400">Win Rate</span>
                                            <span class="font-bold ${p.winRate >= 50 ? 'text-green-400' : 'text-red-400'}">${p.winRate.toFixed(1)}%</span>
                                        </div>
                                        <div class="flex justify-between items-center border-b border-slate-800 pb-1">
                                            <span class="text-slate-400">Set (V-P)</span>
                                            <span class="font-bold">${p.setsWon}-${p.setsLost} <span class="text-xs text-slate-500">(${p.setsWon-p.setsLost > 0 ? '+' : ''}${p.setsWon-p.setsLost})</span></span>
                                        </div>
                                        <div class="flex justify-between items-center border-b border-slate-800 pb-1">
                                            <span class="text-slate-400">Game (V-P)</span>
                                            <span class="font-bold">${p.gamesWon}-${p.gamesLost}</span>
                                        </div>
                                        <div class="flex justify-between items-center border-b border-slate-800 pb-1">
                                            <span class="text-slate-400">Diff. Game</span>
                                            <span class="font-bold ${p.gamesWon-p.gamesLost > 0 ? 'text-green-400' : 'text-red-400'}">${p.gamesWon-p.gamesLost > 0 ? '+' : ''}${p.gamesWon-p.gamesLost}</span>
                                        </div>
                                        
                                        <div class="pt-2 grid grid-cols-2 gap-2 text-xs text-center">
                                            <div class="bg-slate-800 rounded p-1">
                                                <div class="text-slate-500 mb-1">Tie-Break</div>
                                                <div class="font-bold text-blue-400 text-base">${p.tieBreaksWon}</div>
                                            </div>
                                            <div class="bg-slate-800 rounded p-1">
                                                <div class="text-slate-500 mb-1">Bagels (6-0)</div>
                                                <div class="font-bold text-red-400 text-base">${p.bagels}</div>
                                            </div>
                                            <div class="bg-slate-800 rounded p-1">
                                                <div class="text-slate-500 mb-1">Rimonte</div>
                                                <div class="font-bold text-green-400 text-base">${p.comebacks}</div>
                                            </div>
                                            <div class="bg-slate-800 rounded p-1">
                                                <div class="text-slate-500 mb-1">3 Set</div>
                                                <div class="font-bold text-orange-400 text-base">${p.threeSetMatches}</div>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div class="mt-auto pt-2 text-center">
                                        <span class="text-[10px] text-slate-600 uppercase font-bold tracking-widest">Full Stats Report</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;

    // 4. ANALYSIS HTML
    const analysisHtml = aiReport ? `
        <div id="analysis" class="tab-content hidden max-w-4xl mx-auto animate-fade-in">
            <h2 class="text-3xl font-black text-center text-white mb-6 uppercase italic">Analisi Tecnica AI</h2>
            <div class="bg-slate-800 rounded-xl p-6 md:p-8 shadow-2xl border border-slate-700 text-slate-300 leading-relaxed whitespace-pre-line text-lg">
                ${aiReport}
            </div>
            <div class="text-center mt-4">
                <span class="text-xs text-slate-500 uppercase tracking-widest font-bold">Generato da Gemini AI</span>
            </div>
        </div>
    ` : '';

    return `
<!DOCTYPE html>
<html lang="it" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${tournament.name} - Web Report</title>
    ${style}
</head>
<body class="bg-slate-950 text-slate-100 pb-20">
    ${newsTickerHtml}
    
    <!-- Header -->
    <header class="bg-slate-900 border-b border-slate-800 p-6 mb-0 text-center shadow-lg relative overflow-hidden">
        <div class="absolute inset-0 bg-gradient-to-r from-blue-900/20 to-purple-900/20 z-0"></div>
        <div class="relative z-10 flex flex-col items-center">
            ${logo ? `<img src="${logo}" class="w-20 h-20 object-contain mb-4 rounded-full border-4 border-padel-court bg-white p-1 shadow-lg shadow-padel-court/50" />` : ''}
            <h1 class="text-3xl md:text-5xl font-black tracking-tight text-white mb-2 uppercase italic">${tournament.name}</h1>
            <p class="text-padel-court font-bold tracking-widest uppercase text-xs">Official Tournament Report</p>
            <p class="text-slate-500 text-sm mt-2">Generato il ${new Date().toLocaleDateString()}</p>
        </div>
    </header>

    ${nav}
    
    <main class="p-4">
        ${standingsHtml}
        ${matchesHtml}
        ${cardsHtml}
        ${analysisHtml}
    </main>
    
    <footer class="text-center text-slate-600 text-xs py-10 mt-10 border-t border-slate-800">
        <p>Powered by Sulmona Padel Club Manager</p>
    </footer>

    <script>
        function showTab(id) {
            document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
            document.getElementById(id).classList.remove('hidden');
            
            document.querySelectorAll('.nav-btn').forEach(el => {
                el.classList.remove('bg-padel-court', 'text-white');
                el.classList.add('text-slate-400');
            });
            event.target.classList.remove('text-slate-400');
            event.target.classList.add('bg-padel-court', 'text-white');
        }
    </script>
</body>
</html>
    `;
};

// --- COMPONENTS ---

// NEWS TICKER COMPONENT (SKY NEWS STYLE)
const NewsTicker = ({ items }: { items: string[] }) => {
    return (
        <div className="bg-yellow-400 border-b-2 border-yellow-500 flex items-stretch h-10 shadow-lg relative z-40 overflow-hidden">
            {/* STATIC LABEL */}
            <div className="bg-red-600 text-white px-4 flex items-center justify-center font-black italic tracking-tighter uppercase text-sm shrink-0 shadow-[4px_0_10px_rgba(0,0,0,0.3)] z-10">
                <span className="flex items-center gap-1">
                    <Radio size={16} className="animate-pulse" /> SULMONA PADEL NEWS
                </span>
            </div>
            
            {/* SCROLLING TEXT */}
            <div className="flex-1 flex items-center bg-yellow-400 text-slate-900 overflow-hidden relative">
                <div className="animate-marquee whitespace-nowrap flex items-center gap-12 text-sm font-bold uppercase tracking-wide px-4">
                    {/* Duplicate items for smoother loop visual */}
                    {[...items, ...items].map((item, i) => (
                        <span key={i} className="inline-flex items-center gap-2">
                             <span className="w-1.5 h-1.5 bg-slate-900 rounded-full"></span>
                             {item}
                        </span>
                    ))}
                </div>
            </div>
            
            <style>{`
                @keyframes marquee {
                    0% { transform: translateX(0); }
                    100% { transform: translateX(-50%); }
                }
                .animate-marquee {
                    animation: marquee 20s linear infinite;
                    min-width: 200%;
                }
            `}</style>
        </div>
    );
};

// VOICE ASSISTANT COMPONENT
const VoiceScoreAssistant = ({ onScoreParsed }: { onScoreParsed: (score: MatchScore) => void }) => {
    const [isRecording, setIsRecording] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorderRef.current = new MediaRecorder(stream);
            chunksRef.current = [];

            mediaRecorderRef.current.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };

            mediaRecorderRef.current.onstop = async () => {
                const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
                await processAudio(audioBlob);
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorderRef.current.start();
            setIsRecording(true);
        } catch (err) {
            console.error("Mic Error:", err);
            alert("Impossibile accedere al microfono.");
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            setIsProcessing(true);
        }
    };

    const processAudio = async (blob: Blob) => {
        const apiKey = process.env.API_KEY;
        if (!apiKey) {
            alert("API Key mancante.");
            setIsProcessing(false);
            return;
        }

        try {
            const base64Audio = await blobToBase64(blob);
            const client = new GoogleGenAI({ apiKey });
            
            const prompt = `
                Ascolta questo audio che contiene un punteggio di una partita di Padel o Tennis.
                Estrai i set. Esempio audio: "Vittoria sei quattro sei due".
                Restituisci ESCLUSIVAMENTE un JSON valido in questo formato, senza markdown:
                { "set1": { "a": 6, "b": 4 }, "set2": { "a": 6, "b": 2 }, "set3": { "a": 0, "b": 0 } }
                Se menziona solo un set, metti gli altri a 0. Se c'è un terzo set o tie break, riempilo.
                Interpreta chi è "A" e "B" in base all'ordine di pronuncia (chi vince il set di solito viene detto prima o ha il punteggio più alto se detto "6 a 4").
            `;

            const response = await client.models.generateContent({
                model: "gemini-2.5-flash",
                contents: {
                    parts: [
                        { inlineData: { mimeType: "audio/webm", data: base64Audio } },
                        { text: prompt }
                    ]
                }
            });

            const text = response.text;
            if (text) {
                // Clean response just in case
                const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
                const parsedScore = JSON.parse(jsonStr) as MatchScore;
                onScoreParsed(parsedScore);
            }
        } catch (error) {
            console.error("Gemini Audio Error:", error);
            alert("Non sono riuscito a capire il punteggio. Riprova.");
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <button
            onClick={isRecording ? stopRecording : startRecording}
            className={`p-2 rounded-full transition-all ${
                isRecording ? 'bg-red-500 animate-pulse text-white' : 
                isProcessing ? 'bg-yellow-500 animate-bounce text-white' : 
                'bg-slate-700 text-padel-court hover:bg-slate-600'
            }`}
            title="Detta punteggio (AI)"
            disabled={isProcessing}
        >
            {isRecording ? <MicOff size={18} /> : isProcessing ? <Activity size={18} /> : <Mic size={18} />}
        </button>
    );
};

// PLAYOFF BRACKET COMPONENT
const PlayoffBracket = ({ teams, stats, config }: { teams: Team[], stats: TeamStats[], config: TournamentConfig }) => {
    // Determine qualified teams based on current sorted stats
    const qualifiedTeams = useMemo(() => {
        // stats is ALREADY sorted by the main calculation logic (Pt > Set > Game)
        // We just slice the top N teams.
        const limit = config.playoffTeams > 0 ? config.playoffTeams : 4;
        
        return stats.slice(0, limit).map((s, index) => {
            const t = teams.find(team => team.id === s.teamId);
            if (!t) return null;
            return {
                ...t,
                rank: index + 1,
                stats: s
            };
        }).filter(Boolean) as (Team & { rank: number, stats: TeamStats })[];
    }, [stats, teams, config.playoffTeams]);

    if (config.playoffTeams <= 0) return <div className="text-center text-slate-500 p-8">Nessun playoff configurato. Vai su Opzioni per attivarlo.</div>;
    
    // Helper to render a bracket box
    const renderMatchBox = (
        t1?: Team & { rank: number, stats: TeamStats }, 
        t2?: Team & { rank: number, stats: TeamStats }, 
        label: string = "Match",
        placeholderT2: string = "In attesa"
    ) => (
        <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 w-56 shadow-lg relative flex flex-col gap-2">
            <div className="text-[10px] text-padel-court font-bold uppercase tracking-widest text-center border-b border-slate-700 pb-1">{label}</div>
            
            {/* Slot 1 */}
            <div className={`p-2 rounded border flex justify-between items-center ${t1 ? 'bg-slate-700 border-slate-600' : 'bg-slate-900/50 border-dashed border-slate-700'}`}>
                <div className="overflow-hidden">
                    <span className="text-xs text-slate-400 block font-bold mb-0.5">{t1 ? `${t1.rank}° Classificato` : 'TBD'}</span>
                    <span className="text-sm font-bold text-white truncate block">{t1?.name || 'In attesa'}</span>
                </div>
                {t1 && <span className="text-xs font-bold text-padel-court bg-black/30 px-1.5 py-0.5 rounded">{t1.stats.points}pt</span>}
            </div>

            {/* VS Divider */}
            <div className="text-[10px] text-slate-500 text-center font-bold">VS</div>

            {/* Slot 2 */}
            <div className={`p-2 rounded border flex justify-between items-center ${t2 ? 'bg-slate-700 border-slate-600' : 'bg-slate-900/50 border-dashed border-slate-700'}`}>
                <div className="overflow-hidden">
                    <span className="text-xs text-slate-400 block font-bold mb-0.5">{t2 ? `${t2.rank}° Classificato` : 'TBD'}</span>
                    <span className="text-sm font-bold text-white truncate block">{t2?.name || placeholderT2}</span>
                </div>
                {t2 && <span className="text-xs font-bold text-padel-court bg-black/30 px-1.5 py-0.5 rounded">{t2.stats.points}pt</span>}
            </div>
            
            {/* Connector line for desktop */}
            <div className="absolute top-1/2 -right-6 w-6 h-0.5 bg-slate-500 hidden md:block"></div>
        </div>
    );

    // --- 6 TEAMS SPECIAL LAYOUT (1st and 2nd BYE) ---
    if (config.playoffTeams === 6) {
        return (
            <div className="overflow-x-auto p-4 flex flex-col items-center">
                <div className="bg-padel-court/10 border border-padel-court/30 p-3 rounded-lg mb-6 text-center max-w-lg">
                    <h3 className="text-xl font-bold text-white flex items-center justify-center gap-2"><GitGraph className="text-padel-court"/> Tabellone Top 6</h3>
                    <p className="text-xs text-slate-300 mt-1">Le prime 2 classificate accedono direttamente alle Semifinali.</p>
                </div>

                <div className="flex gap-12 md:gap-16 items-center">
                    {/* QUARTER FINALS COLUMN */}
                    <div className="flex flex-col gap-24 mt-16">
                        {renderMatchBox(qualifiedTeams[3], qualifiedTeams[4], "Quarti A (4° vs 5°)")}
                        {renderMatchBox(qualifiedTeams[2], qualifiedTeams[5], "Quarti B (3° vs 6°)")}
                    </div>

                    {/* SEMI FINALS COLUMN */}
                    <div className="flex flex-col gap-10">
                        {/* 1st vs Winner Q1 */}
                        {renderMatchBox(qualifiedTeams[0], undefined, "Semifinale A", "Vinc. Quarti A")}
                        {/* 2nd vs Winner Q2 */}
                        {renderMatchBox(qualifiedTeams[1], undefined, "Semifinale B", "Vinc. Quarti B")}
                    </div>

                    {/* FINALS COLUMN */}
                    <div className="flex flex-col gap-8">
                        <div className="relative">
                            <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 text-yellow-400 animate-bounce">
                                <Trophy size={32} />
                            </div>
                            {renderMatchBox(undefined, undefined, "FINALE", "Vinc. Semi B")}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // --- STANDARD LAYOUT (2, 4, 8, etc.) ---
    return (
        <div className="overflow-x-auto p-4 flex flex-col items-center">
             <div className="bg-padel-court/10 border border-padel-court/30 p-3 rounded-lg mb-6 text-center max-w-lg">
                <h3 className="text-xl font-bold text-white flex items-center justify-center gap-2"><GitGraph className="text-padel-court"/> Tabellone LIVE</h3>
                <p className="text-xs text-slate-300 mt-1">Questa è una <strong>simulazione in tempo reale</strong> basata sulla classifica attuale.</p>
             </div>
             
             <div className="flex gap-12 md:gap-16 items-center">
                {/* QUARTER FINALS (If 8 teams) - Placeholder logic for expandability */}
                {config.playoffTeams >= 8 && (
                     <div className="flex flex-col gap-4">
                        <div className="text-slate-500 text-xs">Quarti di finale non visualizzati (Spazio ridotto)</div>
                     </div>
                )}

                {/* SEMI FINALS COLUMN */}
                {config.playoffTeams >= 4 && (
                    <div className="flex flex-col gap-10">
                        {renderMatchBox(qualifiedTeams[0], qualifiedTeams[3], "Semifinale A (1° vs 4°)")}
                        {renderMatchBox(qualifiedTeams[1], qualifiedTeams[2], "Semifinale B (2° vs 3°)")}
                    </div>
                )}
                
                {/* CONNECTOR GRAPHIC */}
                {config.playoffTeams >= 4 && (
                    <div className="hidden md:flex flex-col gap-32 items-center relative">
                        {/* Vertical brackets */}
                        <div className="absolute top-[20%] bottom-[20%] w-px bg-slate-500 -left-6"></div>
                        <div className="absolute top-[20%] w-6 h-px bg-slate-500 -left-6"></div>
                        <div className="absolute bottom-[20%] w-6 h-px bg-slate-500 -left-6"></div>
                        <div className="w-8 h-px bg-slate-500"></div>
                    </div>
                )}

                {/* FINALS COLUMN */}
                <div className="flex flex-col gap-8">
                    <div className="relative">
                        {/* Winner Trophy Icon Floating */}
                        <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 text-yellow-400 animate-bounce">
                            <Trophy size={32} />
                        </div>
                        {renderMatchBox(
                            config.playoffTeams === 2 ? qualifiedTeams[0] : undefined, 
                            config.playoffTeams === 2 ? qualifiedTeams[1] : undefined, 
                            "FINALE"
                        )}
                        <div className="absolute top-1/2 -right-6 w-6 h-0.5 bg-slate-500 hidden md:block opacity-0"></div> {/* Hidden connector to maintain spacing */}
                    </div>
                </div>
             </div>
        </div>
    );
};

// HEAD TO HEAD MODAL
const HeadToHeadModal = ({ teamA, teamB, stats, onClose }: { teamA: Team, teamB: Team, stats: TeamStats[], onClose: () => void }) => {
    const statsA = stats.find(s => s.teamId === teamA.id);
    const statsB = stats.find(s => s.teamId === teamB.id);

    const getForm = (s?: TeamStats) => {
        if (!s) return 50;
        return Math.min(100, Math.max(0, 50 + (s.winRate / 2) + ((s.gamesWon - s.gamesLost) * 2)));
    };

    const formA = getForm(statsA);
    const formB = getForm(statsB);

    return (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/90 backdrop-blur p-4 animate-in fade-in zoom-in duration-300" onClick={onClose}>
            {/* Main Card Container with sticky header logic */}
            <div className="w-full max-w-4xl bg-slate-900 rounded-2xl border border-slate-700 overflow-hidden relative shadow-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                
                {/* TOP ACTION BAR - STICKY TOP */}
                <div className="p-3 bg-slate-800 border-b border-slate-700 shrink-0">
                    <button onClick={onClose} className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 rounded-xl shadow-lg transition-transform active:scale-95 flex items-center justify-center gap-2">
                        <RotateCcw size={18} /> TORNA AL MATCH
                    </button>
                </div>
                
                {/* SCROLLABLE CONTENT */}
                <div className="overflow-y-auto custom-scrollbar flex-1 bg-slate-900">
                    
                    {/* VS HEADER */}
                    <div className="flex justify-center items-center py-6 bg-gradient-to-b from-slate-800 to-slate-900 border-b border-slate-700">
                         <span className="text-4xl md:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-orange-600 italic tracking-tighter pr-2">VS</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2">
                        {/* TEAM A */}
                        <div className="p-6 md:p-10 flex flex-col items-center border-b md:border-b-0 md:border-r border-slate-700 bg-slate-900/50">
                            <div className="w-20 h-20 md:w-32 md:h-32 rounded-full bg-blue-600/20 border-4 border-blue-500 flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(59,130,246,0.3)]">
                                <Users size={40} className="text-blue-400"/>
                            </div>
                            <h2 className="text-xl md:text-3xl font-black text-white text-center uppercase tracking-tight mb-2">{teamA.name}</h2>
                            <div className="text-blue-400 text-sm font-bold mb-6"># Rank {stats.findIndex(s => s.teamId === teamA.id) + 1}</div>
                            
                            <div className="w-full space-y-4">
                                 <div className="flex justify-between items-center text-sm">
                                     <span className="text-slate-400">Vittorie</span>
                                     <span className="text-white font-bold text-lg">{statsA?.won || 0}</span>
                                 </div>
                                 <div className="flex justify-between items-center text-sm">
                                     <span className="text-slate-400">Win Rate</span>
                                     <div className="w-24 bg-slate-800 rounded-full h-2">
                                         <div className="bg-blue-500 h-full rounded-full" style={{width: `${statsA?.winRate || 0}%`}}></div>
                                     </div>
                                 </div>
                                 <div className="flex justify-between items-center text-sm">
                                     <span className="text-slate-400">Forma</span>
                                     <span className="text-blue-400 font-bold">{formA.toFixed(0)}</span>
                                 </div>
                            </div>
                        </div>

                        {/* TEAM B */}
                        <div className="p-6 md:p-10 flex flex-col items-center bg-slate-900/50">
                            <div className="w-20 h-20 md:w-32 md:h-32 rounded-full bg-red-600/20 border-4 border-red-500 flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(239,68,68,0.3)]">
                                <Users size={40} className="text-red-400"/>
                            </div>
                            <h2 className="text-xl md:text-3xl font-black text-white text-center uppercase tracking-tight mb-2">{teamB.name}</h2>
                            <div className="text-red-400 text-sm font-bold mb-6"># Rank {stats.findIndex(s => s.teamId === teamB.id) + 1}</div>
                            
                            <div className="w-full space-y-4">
                                 <div className="flex justify-between items-center text-sm">
                                     <span className="text-slate-400">Vittorie</span>
                                     <span className="text-white font-bold text-lg">{statsB?.won || 0}</span>
                                 </div>
                                 <div className="flex justify-between items-center text-sm">
                                     <span className="text-slate-400">Win Rate</span>
                                     <div className="w-24 bg-slate-800 rounded-full h-2">
                                         <div className="bg-red-500 h-full rounded-full" style={{width: `${statsB?.winRate || 0}%`}}></div>
                                     </div>
                                 </div>
                                 <div className="flex justify-between items-center text-sm">
                                     <span className="text-slate-400">Forma</span>
                                     <span className="text-red-400 font-bold">{formB.toFixed(0)}</span>
                                 </div>
                            </div>
                        </div>
                    </div>

                    {/* BOTTOM STATS */}
                    <div className="p-4 bg-black/20 text-center border-t border-slate-700 pb-8">
                         <p className="text-xs text-slate-500 uppercase tracking-widest font-bold">Probabilità Vittoria (AI Est)</p>
                         <div className="flex items-center gap-2 mt-2 max-w-md mx-auto">
                             <span className="text-blue-400 font-bold">{formA > formB ? ((formA / (formA+formB))*100).toFixed(0) : (100 - (formB / (formA+formB))*100).toFixed(0)}%</span>
                             <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden flex">
                                 <div className="bg-blue-500 h-full transition-all duration-1000" style={{width: `${(formA / (formA+formB)) * 100}%`}}></div>
                                 <div className="bg-red-500 h-full transition-all duration-1000" style={{width: `${(formB / (formA+formB)) * 100}%`}}></div>
                             </div>
                             <span className="text-red-400 font-bold">{formB > formA ? ((formB / (formA+formB))*100).toFixed(0) : (100 - (formA / (formA+formB))*100).toFixed(0)}%</span>
                         </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// PLAYER FUT CARD COMPONENT
const calculateFutStats = (p: PlayerStats) => {
    // Normalize stats to 0-99 scale
    const pac = Math.min(99, Math.round(p.winRate)); // Speed = Win %
    const sho = Math.min(99, Math.round((p.gamesWon / Math.max(1, p.played)) * 14)); // Attack = Avg Games Won * multiplier
    const pas = Math.min(99, Math.round(60 + (p.avgSetDiff * 20))); // Technique = Set Diff base 60
    const dri = Math.min(99, Math.round(50 + (p.avgGameDiff * 5))); // Form = Game Diff base 50
    const def = Math.min(99, Math.max(20, Math.round(99 - ((p.gamesLost / Math.max(1, p.played)) * 12)))); // Defense = Inverse of games lost
    const men = Math.min(99, Math.round(50 + (p.tieBreaksWon * 15) + (p.comebacks * 20))); // Mental = Clutch moments
    const phy = Math.min(99, Math.round(Math.min(p.played * 8, 99))); // Physical = Stamina/Matches played

    // Calculate OVR weighted
    const ovr = Math.round((pac * 0.2) + (sho * 0.2) + (pas * 0.15) + (def * 0.15) + (men * 0.15) + (phy * 0.15));
    
    return { pac, sho, pas, def, men, phy, ovr };
};

const PlayerFUTCard = ({ 
    player, 
    rank, 
    image, 
    side,
    nickname,
    onImageUpload, 
    onClose 
}: { 
    player: PlayerStats, 
    rank: number, 
    image?: string,
    side?: 'DES' | 'SIN',
    nickname?: string,
    onImageUpload: (img: string) => void,
    onClose: () => void 
}) => {
    const stats = calculateFutStats(player);
    const imgInputRef = useRef<HTMLInputElement>(null);
    
    let bgGradient = "bg-gradient-to-b from-slate-300 to-slate-400 border-slate-200 text-slate-900"; // Default
    let textColor = "text-slate-900";
    let labelColor = "text-slate-700";
    
    if (rank === 1) { // Gold
        bgGradient = "bg-gradient-to-b from-yellow-200 via-yellow-400 to-yellow-600 border-yellow-300";
        textColor = "text-yellow-900";
        labelColor = "text-yellow-800";
    } else if (rank === 2) { // Silver
        bgGradient = "bg-gradient-to-b from-slate-100 via-slate-300 to-slate-500 border-slate-300";
        textColor = "text-slate-900";
        labelColor = "text-slate-700";
    } else if (rank === 3) { // Bronze
        bgGradient = "bg-gradient-to-b from-amber-200 via-amber-500 to-amber-700 border-amber-400";
        textColor = "text-amber-900";
        labelColor = "text-amber-800";
    } else {
        // Base card / Black
        bgGradient = "bg-gradient-to-b from-slate-800 via-slate-900 to-black border-slate-600";
        textColor = "text-white";
        labelColor = "text-slate-400";
    }

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const resized = await resizeImage(e.target.files[0]);
            onImageUpload(resized);
        }
    };

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in" onClick={onClose}>
            <div className={`relative w-72 ${bgGradient} rounded-t-3xl rounded-b-3xl border-4 p-5 shadow-[0_0_50px_rgba(0,0,0,0.5)] transform hover:scale-105 transition-transform duration-300`} onClick={e => e.stopPropagation()}>
                <button onClick={onClose} className="absolute top-2 right-2 p-1 bg-black/20 rounded-full hover:bg-black/40 text-current z-10"><X size={20}/></button>
                
                {/* Top Info */}
                <div className={`flex items-start justify-between mb-2 ${textColor} font-bold`}>
                    <div className="flex flex-col items-center leading-none">
                        <span className="text-5xl font-black">{stats.ovr}</span>
                        {nickname && <span className="text-[9px] font-bold uppercase text-current/80 -mt-1 mb-0.5 truncate max-w-[50px] tracking-tighter">{nickname}</span>}
                        {side && <span className="text-[10px] font-bold mt-1 border border-current px-1 rounded opacity-80">{side}</span>}
                    </div>
                    {/* MODIFIED: Rank Display instead of generic Country */}
                    <div className="opacity-90 flex flex-col items-center leading-none pt-1">
                         <span className="text-4xl font-black">#{rank}</span>
                         <span className="text-xs uppercase font-bold opacity-75">RANK</span>
                    </div>
                </div>

                {/* Player Image / Placeholder */}
                <div 
                    className="w-full h-36 bg-black/10 rounded-t-full rounded-b-2xl mb-4 flex items-end justify-center overflow-hidden border-b-2 border-black/10 shadow-inner relative group cursor-pointer"
                    onClick={() => imgInputRef.current?.click()}
                    title="Clicca per cambiare foto"
                >
                    {image ? (
                        <img src={image} className="w-full h-full object-cover" alt={player.name} />
                    ) : (
                        <User size={90} className={`${textColor} opacity-90 translate-y-2 drop-shadow-lg`} />
                    )}
                    
                    {/* Overlay for upload */}
                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        <Camera size={32} className="text-white drop-shadow-md"/>
                    </div>
                    
                    <input type="file" ref={imgInputRef} hidden accept="image/*" onChange={handleUpload} />
                </div>

                {/* Name */}
                <div className={`text-center mb-5 border-b-2 border-current/20 pb-2`}>
                    <h2 className={`text-2xl font-black uppercase tracking-tighter ${textColor} truncate drop-shadow-sm`}>{player.name}</h2>
                </div>

                {/* Stats Grid */}
                <div className={`grid grid-cols-2 gap-x-6 gap-y-2 font-black text-xl ${textColor}`}>
                    <div className="flex justify-between items-baseline border-b border-current/10 pb-1"><span>{stats.pac}</span> <span className={`text-sm ${labelColor} font-bold self-center`}>VEL</span></div>
                    <div className="flex justify-between items-baseline border-b border-current/10 pb-1"><span>{stats.sho}</span> <span className={`text-sm ${labelColor} font-bold self-center`}>ATT</span></div>
                    
                    <div className="flex justify-between items-baseline border-b border-current/10 pb-1"><span>{stats.pas}</span> <span className={`text-sm ${labelColor} font-bold self-center`}>TEC</span></div>
                    <div className="flex justify-between items-baseline border-b border-current/10 pb-1"><span>{stats.def}</span> <span className={`text-sm ${labelColor} font-bold self-center`}>DIF</span></div>
                    
                    <div className="flex justify-between items-baseline"><span>{stats.men}</span> <span className={`text-sm ${labelColor} font-bold self-center`}>MEN</span></div>
                    <div className="flex justify-between items-baseline"><span>{stats.phy}</span> <span className={`text-sm ${labelColor} font-bold self-center`}>FIS</span></div>
                </div>
                
                {/* Bottom Decor */}
                <div className="mt-5 flex justify-center opacity-60">
                     <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-current"></div>
                        <span className="text-[10px] font-bold tracking-[0.2em] uppercase">SULMONA PADEL</span>
                        <div className="w-2 h-2 rounded-full bg-current"></div>
                     </div>
                </div>
            </div>
        </div>
    );
};


const Header = ({ 
    onGoHome, 
    showHome, 
    logo, 
    onLogoUpload 
}: { 
    onGoHome?: () => void, 
    showHome?: boolean, 
    logo?: string | null, 
    onLogoUpload?: (e: React.ChangeEvent<HTMLInputElement>) => void 
}) => {
  const logoInputRef = useRef<HTMLInputElement>(null);

  return (
  <header 
    className="bg-slate-900 border-b border-slate-800 p-4 sticky top-0 shadow-lg flex items-center justify-center md:justify-between"
    style={{ zIndex: 900 }} 
  >
    <div className="max-w-5xl mx-auto w-full flex items-center justify-between">
      <div className="flex items-center gap-3">
        {/* LOGO SECTION */}
        <div 
            className="h-14 w-14 bg-white rounded-full p-1 border-2 border-padel-ball flex items-center justify-center overflow-hidden shadow-lg shadow-padel-ball/20 cursor-pointer relative group"
            onClick={() => logoInputRef.current?.click()}
            title="Clicca per caricare il tuo logo"
        >
             <img 
                src={logo || "https://cdn-icons-png.flaticon.com/512/3669/3669896.png"} 
                alt="Club Logo" 
                className="w-full h-full object-contain"
            />
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-full">
                <Users size={20} className="text-white"/>
            </div>
            <input 
                type="file" 
                ref={logoInputRef} 
                className="hidden" 
                accept="image/*"
                onChange={onLogoUpload}
            />
        </div>
        <div>
            <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight leading-none text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400">SULMONA PADEL CLUB</h1>
            <p className="text-[10px] text-padel-court font-bold uppercase tracking-widest">Tournament Manager</p>
        </div>
      </div>
      
      {showHome && (
        <button 
            type="button"
            onClick={onGoHome}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-4 py-2 rounded-lg border border-slate-700 transition-colors text-xs uppercase font-bold cursor-pointer shadow-md hover:shadow-lg active:scale-95"
        >
            <Home size={18} /> <span className="hidden sm:inline">Home</span>
        </button>
      )}
    </div>
  </header>
  );
};

const SetupScreen = ({ 
  onStart,
  onResume,
  activeTournamentName,
  archives,
  onLoadArchive,
  onDeleteArchive,
  onImportTournament,
  registryPlayers,
  setRegistryPlayers
}: { 
  onStart: (teams: Team[], config: TournamentConfig) => void,
  onResume: () => void,
  activeTournamentName?: string,
  archives: TournamentArchive[],
  onLoadArchive: (archive: TournamentArchive) => void,
  onDeleteArchive: (id: string) => void,
  onImportTournament: (e: React.ChangeEvent<HTMLInputElement>) => void,
  registryPlayers: RegistryPlayer[],
  setRegistryPlayers: React.Dispatch<React.SetStateAction<RegistryPlayer[]>>
}) => {
  const [registryInput, setRegistryInput] = useState('');
  const [registryNickname, setRegistryNickname] = useState(''); // NEW STATE
  const [registryTier, setRegistryTier] = useState<number>(3); // Default Intermediate
  const [registrySide, setRegistrySide] = useState<'DES' | 'SIN'>('SIN');
  const [newPlayerImage, setNewPlayerImage] = useState<string | null>(null); // For new player creation
  
  // Team Creation State
  const [teamName, setTeamName] = useState('');
  const [selectedForTeam, setSelectedForTeam] = useState<string[]>([]);
  const [selectedCaptain, setSelectedCaptain] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  
  // Edit Team State
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCaptain, setEditCaptain] = useState("");

  const [config, setConfig] = useState<TournamentConfig>({
    name: 'Torneo Sociale',
    mode: 'DOUBLES',
    teamSize: 2,
    doubleRound: true,
    playoffTeams: 4
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const newPlayerImgRef = useRef<HTMLInputElement>(null);
  
  // Ref for uploading image to existing player
  const existingPlayerImgRef = useRef<HTMLInputElement>(null);
  const [targetPlayerForImg, setTargetPlayerForImg] = useState<string | null>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  const isAmericano = config.mode === 'AMERICANO';
  const isSingles = config.mode === 'SINGLES';
  const isTeamMode = !isAmericano && !isSingles;
  const assignedPlayers = useMemo(() => new Set(teams.flatMap(t => t.players)), [teams]);

  const addPlayerToRegistry = () => {
      if (!registryInput.trim()) return;
      if (registryPlayers.some(p => p.name === registryInput.trim())) { alert("Giocatore già presente."); return; }
      
      setRegistryPlayers([...registryPlayers, { 
          name: registryInput.trim(), 
          nickname: registryNickname.trim() || undefined,
          tier: registryTier,
          side: registrySide,
          image: newPlayerImage || undefined
      }]);
      setRegistryInput('');
      setRegistryNickname(''); // Reset
      setRegistryTier(3); // Reset to default
      setNewPlayerImage(null); // Reset image
  };

  const handleNewPlayerImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          const resized = await resizeImage(e.target.files[0]);
          setNewPlayerImage(resized);
      }
      e.target.value = '';
  };

  const handleExistingPlayerImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0] && targetPlayerForImg) {
          const resized = await resizeImage(e.target.files[0]);
          setRegistryPlayers(prev => prev.map(p => p.name === targetPlayerForImg ? {...p, image: resized} : p));
          setTargetPlayerForImg(null);
      }
      e.target.value = '';
  };

  const removePlayerFromRegistry = (playerName: string) => {
      if (assignedPlayers.has(playerName)) { alert("Impossibile rimuovere: giocatore in squadra."); return; }
      setRegistryPlayers(registryPlayers.filter(p => p.name !== playerName));
      setSelectedForTeam(selectedForTeam.filter(p => p !== playerName));
  };
  
  const clearRegistry = () => {
      if(registryPlayers.some(p => assignedPlayers.has(p.name))) { alert("Rimuovi prima le squadre."); return; }
      if(confirm("Cancellare tutto l'albo?")) setRegistryPlayers([]);
  };

  const handleRenamePlayer = (oldName: string) => {
      const newName = prompt("Nuovo nome:", oldName);
      if (newName && newName.trim() && newName !== oldName) {
           if (registryPlayers.some(p => p.name === newName)) { alert("Nome esistente."); return; }
           setRegistryPlayers(registryPlayers.map(p => p.name === oldName ? { ...p, name: newName } : p));
           if (selectedForTeam.includes(oldName)) setSelectedForTeam(selectedForTeam.map(p => p === oldName ? newName : p));
           if (selectedCaptain === oldName) setSelectedCaptain(newName);
      }
  };
  
  const cycleTier = (player: RegistryPlayer) => {
      const nextTier = player.tier === 4 ? 1 : player.tier + 1;
      setRegistryPlayers(registryPlayers.map(p => p.name === player.name ? { ...p, tier: nextTier } : p));
  };
  
  const cycleSide = (player: RegistryPlayer) => {
      const nextSide = player.side === 'DES' ? 'SIN' : 'DES';
      setRegistryPlayers(registryPlayers.map(p => p.name === player.name ? { ...p, side: nextSide } : p));
  };

  const togglePlayerSelection = (player: string) => {
      if (assignedPlayers.has(player)) return; 
      if (selectedForTeam.includes(player)) {
          setSelectedForTeam(selectedForTeam.filter(p => p !== player));
          if (selectedCaptain === player) setSelectedCaptain(null);
      } else {
          setSelectedForTeam([...selectedForTeam, player]);
      }
  };

  const handleModeChange = (mode: 'SINGLES' | 'DOUBLES' | 'AMERICANO') => {
      let newSize = 2;
      if (mode === 'SINGLES') newSize = 1;
      if (mode === 'AMERICANO') newSize = 1;
      
      setConfig({ ...config, mode, teamSize: newSize });
      setTeams([]);
      setSelectedForTeam([]);
  };

  const handleAddTeam = () => {
    const required = isTeamMode ? config.teamSize : 1;
    if (isTeamMode && selectedForTeam.length !== required) { 
        alert(`Per questa modalità devi selezionare esattamente ${required} giocatori per squadra.`); 
        return; 
    }
    if (!isTeamMode && selectedForTeam.length < 1) return;
    
    let finalName = teamName.trim() || selectedForTeam.join(' / ');
    let finalCaptain = selectedCaptain;
    if (isTeamMode && !finalCaptain && selectedForTeam.length > 0) finalCaptain = selectedForTeam[0];

    setTeams([...teams, {
        id: generateId(),
        name: finalName,
        players: [...selectedForTeam],
        captain: finalCaptain || undefined
    }]);
    setTeamName('');
    setSelectedForTeam([]);
    setSelectedCaptain(null);
  };

  const handleAddAllAsIndividuals = () => {
      const available = registryPlayers.filter(p => !assignedPlayers.has(p.name));
      setTeams([...teams, ...available.map(p => ({ id: generateId(), name: p.name, players: [p.name] }))]);
  };
  
  // ALGORITMO SQUADRE EQUILIBRATE (Generico per N giocatori)
  const handleGenerateBalancedTeams = () => {
      if (!isTeamMode) return;
      const size = config.teamSize;
      
      if (selectedForTeam.length < size * 2) { alert(`Seleziona almeno ${size * 2} giocatori per generare almeno 2 squadre.`); return; }
      if (selectedForTeam.length % size !== 0) { alert(`Il numero di giocatori selezionati deve essere un multiplo di ${size}.`); return; }

      // 1. Get detailed player objects and sort by Tier (1=Best to 4=Worst)
      const pool = selectedForTeam.map(name => registryPlayers.find(p => p.name === name)!).filter(Boolean);
      pool.sort((a, b) => a.tier - b.tier);

      // 2. Prepare buckets for teams
      const numTeams = pool.length / size;
      const newTeamsStruct: RegistryPlayer[][] = Array.from({ length: numTeams }, () => []);

      // 3. Snake Draft Distribution to balance tiers
      for (let i = 0; i < size; i++) {
          const isGoingUp = i % 2 === 0;
          for (let t = 0; t < numTeams; t++) {
              const teamIndex = isGoingUp ? t : (numTeams - 1 - t);
              const player = pool.shift();
              if (player) newTeamsStruct[teamIndex].push(player);
          }
      }

      const newTeams: Team[] = newTeamsStruct.map(members => ({
          id: generateId(),
          name: members.map(p => p.name).join(' / '),
          players: members.map(p => p.name),
          captain: members[0].name // Highest rank is usually first in snake draft logic for first round
      }));

      setTeams([...teams, ...newTeams]);
      setSelectedForTeam([]);
      alert(`Generate ${newTeams.length} squadre equilibrate da ${size} giocatori!`);
  };

  const removeTeam = (id: string) => {
    setTeams(teams.filter(t => t.id !== id));
    if (editingTeamId === id) setEditingTeamId(null);
  };
  
  const startEditing = (team: Team) => {
      setEditingTeamId(team.id);
      setEditName(team.name);
      setEditCaptain(team.captain || team.players[0] || "");
  };

  const saveEditedTeam = () => {
      if (!editingTeamId) return;
      setTeams(teams.map(t => 
          t.id === editingTeamId ? { ...t, name: editName, captain: editCaptain } : t
      ));
      setEditingTeamId(null);
  };

  const handleStartTournament = () => {
      if (activeTournamentName && teams.length > 0) {
          if (!confirm("ATTENZIONE: C'è un torneo attivo in memoria. Iniziandone uno nuovo, quello precedente verrà sovrascritto.\n\nVuoi procedere?")) {
              return;
          }
      }
      onStart(teams, config);
  };

  const exportRegistry = () => {
    if (registryPlayers.length === 0) {
        alert("L'albo è vuoto, nulla da salvare.");
        return;
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(registryPlayers));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "albo_giocatori_fasce.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const importRegistry = (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileObj = event.target.files && event.target.files[0];
    if (!fileObj) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const content = e.target?.result;
        if (typeof content === 'string') {
            try {
                const imported = JSON.parse(content);
                // Handle both simple strings and new object structure
                if (Array.isArray(imported)) {
                    let newEntries: RegistryPlayer[] = [];
                    
                    if (imported.length > 0 && typeof imported[0] === 'string') {
                        // Legacy import
                        newEntries = (imported as string[]).map(s => ({ name: s, tier: 3 }));
                    } else if (imported.length > 0 && typeof imported[0] === 'object') {
                        // New format import
                        newEntries = imported as RegistryPlayer[];
                    }

                    const existingNames = new Set(registryPlayers.map(p => p.name));
                    
                    // Update existing with new data if present (images/side/nickname)
                    const updatedExisting = registryPlayers.map(p => {
                        const importedP = newEntries.find(np => np.name === p.name);
                        if (importedP) {
                            return { 
                                ...p, 
                                image: importedP.image || p.image,
                                side: importedP.side || p.side,
                                nickname: importedP.nickname || p.nickname
                            };
                        }
                        return p;
                    });
                    
                    const uniqueNew = newEntries.filter(p => !existingNames.has(p.name));
                    
                    if (uniqueNew.length > 0 || updatedExisting.length > 0) {
                        setRegistryPlayers([...updatedExisting, ...uniqueNew]);
                        alert(`Importati ${uniqueNew.length} nuovi giocatori e aggiornati i dati esistenti.`);
                    } else {
                        alert("Tutti i giocatori del file sono già presenti.");
                    }
                } else {
                    alert("Formato file non valido.");
                }
            } catch (err) {
                alert("Errore nella lettura del file.");
            }
        }
    };
    reader.readAsText(fileObj);
    event.target.value = '';
  };

  const exportArchive = (archive: TournamentArchive) => {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ config: archive.config, teams: archive.teams, matches: archive.matches }));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", `padel_torneo_${archive.name.replace(/\s+/g, '_')}.json`);
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
  };

  const getTierColor = (tier: number) => {
      switch(tier) {
          case 1: return 'bg-yellow-500 text-yellow-950 border-yellow-300'; // Gold/Pro
          case 2: return 'bg-slate-300 text-slate-800 border-slate-200'; // Silver/Adv
          case 3: return 'bg-amber-700 text-amber-100 border-amber-600'; // Bronze/Int
          case 4: return 'bg-blue-900 text-blue-200 border-blue-700'; // Iron/Beg
          default: return 'bg-slate-700';
      }
  };
  
  const getTierLabel = (tier: number) => {
      switch(tier) {
          case 1: return '★ PRO';
          case 2: return 'ADV';
          case 3: return 'INT';
          case 4: return 'BEG';
          default: return '';
      }
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 animate-fade-in pb-20">
      <div className="bg-slate-800 rounded-xl p-6 md:p-8 shadow-2xl border border-slate-700">
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            {activeTournamentName && (
                <div className="bg-green-900/20 border border-green-700/50 p-4 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4 animate-pulse-slow">
                    <div className="flex items-center gap-3">
                        <div className="bg-green-800 p-2 rounded-full"><Activity size={24} className="text-green-300" /></div>
                        <div>
                            <h3 className="font-bold text-white text-lg">Torneo in Corso</h3>
                            <p className="text-xs text-green-300">{activeTournamentName}</p>
                        </div>
                    </div>
                    <button onClick={onResume} className="w-full sm:w-auto bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-6 rounded-lg shadow-lg flex items-center justify-center gap-2 transition-all transform hover:scale-105">
                        <RefreshCw size={20} /> RIPRENDI
                    </button>
                </div>
            )}
            
            <div className={`bg-blue-900/20 border border-blue-700/50 p-4 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4 ${!activeTournamentName ? 'md:col-span-2' : ''}`}>
                <div className="flex items-center gap-3">
                    <div className="bg-blue-800 p-2 rounded-full"><FolderOpen size={24} className="text-blue-300" /></div>
                    <div>
                        <h3 className="font-bold text-white text-lg">Carica Backup</h3>
                        <p className="text-xs text-blue-300">Ripristina un torneo da file JSON</p>
                    </div>
                </div>
                <button 
                    onClick={() => backupInputRef.current?.click()} 
                    className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-6 rounded-lg shadow-lg flex items-center justify-center gap-2 transition-all transform hover:scale-105"
                >
                    <Upload size={20} /> 
                    <span>CARICA FILE</span>
                </button>
                <input type="file" ref={backupInputRef} className="hidden" accept=".json" onChange={onImportTournament} />
            </div>
        </div>

        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 border-b border-slate-700 pb-6">
            <div>
                <h2 className="text-3xl font-bold text-white flex items-center gap-2"><Settings className="text-padel-court" /> Configurazione Nuovo Torneo</h2>
            </div>
            <div className="flex-1 w-full md:w-auto flex items-center gap-2">
                <input type="text" value={config.name} onChange={e => setConfig({...config, name: e.target.value})} className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-white text-sm focus:ring-1 focus:ring-padel-court" placeholder="Nome Evento" />
            </div>
        </div>
        
        {/* MODE SELECTION & TEAM SIZE */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
             {['DOUBLES', 'AMERICANO', 'SINGLES'].map(m => (
                 <div key={m} onClick={() => handleModeChange(m as any)}
                    className={`cursor-pointer p-4 rounded-lg border-2 flex flex-col items-center justify-center gap-2 transition-all ${config.mode === m ? 'bg-padel-court/10 border-padel-court' : 'bg-slate-900 border-slate-700 hover:border-slate-500'}`}
                 >
                     {m === 'DOUBLES' ? <Users size={24} className={config.mode === m ? 'text-padel-court' : 'text-slate-500'} /> : m === 'AMERICANO' ? <Shuffle size={24} className={config.mode === m ? 'text-padel-court' : 'text-slate-500'} /> : <User size={24} className={config.mode === m ? 'text-padel-court' : 'text-slate-500'} />}
                     <span className={`font-bold text-sm text-center ${config.mode === m ? 'text-white' : 'text-slate-500'}`}>{m === 'DOUBLES' ? 'Doppio/Squadre' : m === 'AMERICANO' ? 'Americano' : 'Singolo'}</span>
                 </div>
             ))}
             
             {/* TEAM SIZE INPUT - Visible mostly for Doubles/Team mode */}
             <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 flex flex-col justify-center">
                 <label className="text-xs text-slate-400 font-bold uppercase mb-1 flex items-center gap-1"><Users2 size={12}/> Giocatori per Squadra</label>
                 <div className="flex items-center gap-2">
                    <input 
                        type="number" 
                        min="1" 
                        max="8" 
                        value={config.teamSize} 
                        onChange={e => setConfig({...config, teamSize: parseInt(e.target.value) || 2})}
                        disabled={config.mode === 'SINGLES' || config.mode === 'AMERICANO'}
                        className="w-full bg-slate-800 text-white font-bold text-center border border-slate-600 rounded py-1 focus:ring-1 focus:ring-padel-court disabled:opacity-50"
                    />
                 </div>
                 <span className="text-[10px] text-slate-500 mt-1 italic text-center">
                     {config.mode === 'SINGLES' ? 'Fisso (1 vs 1)' : config.mode === 'AMERICANO' ? 'Fisso (Individuale)' : 'Es. 2 per Doppio, 3-4 per Squadre'}
                 </span>
             </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 flex flex-col gap-4">
                <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700 h-full flex flex-col">
                    <div className="flex items-center justify-between border-b border-slate-700 pb-2 mb-4">
                        <h3 className="text-white font-bold flex items-center gap-2"><List size={18} className="text-padel-ball"/> Albo Giocatori</h3>
                        <div className="flex gap-1">
                             <button onClick={exportRegistry} className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-blue-400" title="Salva su File"><Download size={16}/></button>
                             <label className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-green-400 cursor-pointer" title="Carica da File">
                                <Upload size={16}/>
                                <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={importRegistry} />
                             </label>
                             <button onClick={clearRegistry} className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-red-400" title="Svuota"><Trash2 size={16}/></button>
                        </div>
                    </div>
                    
                    {/* ADD PLAYER */}
                    <div className="flex gap-2 mb-4 items-center flex-wrap sm:flex-nowrap">
                        <div className="relative">
                            <button 
                                onClick={() => newPlayerImgRef.current?.click()} 
                                className={`w-10 h-10 rounded-lg flex items-center justify-center border transition-colors ${newPlayerImage ? 'border-padel-court bg-black' : 'border-slate-600 bg-slate-800 hover:bg-slate-700'}`}
                                title="Aggiungi Foto"
                            >
                                {newPlayerImage ? (
                                    <img src={newPlayerImage} alt="Preview" className="w-full h-full object-cover rounded-lg" />
                                ) : (
                                    <Camera size={18} className="text-slate-400"/>
                                )}
                            </button>
                            <input type="file" ref={newPlayerImgRef} hidden accept="image/*" onChange={handleNewPlayerImageUpload} />
                            {newPlayerImage && (
                                <button onClick={() => setNewPlayerImage(null)} className="absolute -top-1 -right-1 bg-red-500 rounded-full p-0.5"><X size={8} className="text-white"/></button>
                            )}
                        </div>
                        
                        <div className="flex-1 flex gap-2 w-full sm:w-auto">
                            <input type="text" placeholder="Nome..." value={registryInput} onChange={e => setRegistryInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addPlayerToRegistry()} className="flex-1 w-full bg-slate-800 border border-slate-600 rounded-lg p-2 text-white text-sm focus:ring-1 focus:ring-padel-court outline-none" />
                            <input type="text" placeholder="Nick" value={registryNickname} onChange={e => setRegistryNickname(e.target.value)} onKeyDown={e => e.key === 'Enter' && addPlayerToRegistry()} className="w-16 bg-slate-800 border border-slate-600 rounded-lg p-2 text-white text-sm focus:ring-1 focus:ring-padel-court outline-none" title="Soprannome" />
                        </div>
                        
                        <div className="flex gap-2 w-full sm:w-auto">
                            <select 
                                value={registryTier} 
                                onChange={e => setRegistryTier(Number(e.target.value))}
                                className="w-14 bg-slate-800 border border-slate-600 rounded-lg text-white text-xs text-center focus:ring-1 focus:ring-padel-court"
                                title="Fascia di Livello"
                            >
                                <option value="1">PRO</option>
                                <option value="2">ADV</option>
                                <option value="3">INT</option>
                                <option value="4">BEG</option>
                            </select>
                            <select 
                                value={registrySide} 
                                onChange={e => setRegistrySide(e.target.value as 'DES' | 'SIN')}
                                className="w-14 bg-slate-800 border border-slate-600 rounded-lg text-white text-xs text-center focus:ring-1 focus:ring-padel-court"
                                title="Lato Preferito"
                            >
                                <option value="SIN">SIN</option>
                                <option value="DES">DES</option>
                            </select>
                            <button onClick={addPlayerToRegistry} className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg transition-colors border border-slate-600"><Plus size={18} /></button>
                        </div>
                    </div>

                    {/* HIDDEN INPUT FOR EXISTING PLAYERS */}
                    <input type="file" ref={existingPlayerImgRef} hidden accept="image/*" onChange={handleExistingPlayerImageUpload} />

                    <div className="flex-1 overflow-y-auto max-h-[450px] space-y-2 pr-1 custom-scrollbar">
                        {registryPlayers.length === 0 ? <div className="text-center text-slate-600 italic text-sm py-4">Albo vuoto.</div> : registryPlayers.map((player, idx) => {
                                const isAssigned = assignedPlayers.has(player.name);
                                return (
                                    <div key={idx} className={`flex items-center justify-between p-2 rounded-lg text-sm border transition-colors ${isAssigned ? 'bg-green-900/10 border-green-900/30 text-green-500' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'}`}>
                                        <div className="flex items-center gap-3">
                                            <span className="text-slate-600 text-xs w-4 text-center">{idx + 1}.</span>
                                            
                                            {/* Tier Badge - Clickable to cycle */}
                                            <div 
                                                onClick={(e) => { e.stopPropagation(); cycleTier(player); }}
                                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold border cursor-pointer select-none w-10 text-center ${getTierColor(player.tier)} transition-transform active:scale-95`}
                                                title="Clicca per cambiare fascia"
                                            >
                                                {getTierLabel(player.tier)}
                                            </div>

                                            {/* Side Badge */}
                                            <div 
                                                onClick={(e) => { e.stopPropagation(); cycleSide(player); }}
                                                className={`px-1.5 py-0.5 rounded text-[9px] font-bold border bg-slate-700 text-slate-300 border-slate-600 w-8 text-center cursor-pointer select-none hover:bg-slate-600 transition-colors active:scale-95`}
                                                title="Clicca per cambiare lato (DES/SIN)"
                                            >
                                                {player.side || '-'}
                                            </div>

                                            {/* Avatar if present - Clickable to upload */}
                                            <div 
                                                className="relative w-8 h-8 group/img cursor-pointer"
                                                onClick={() => { setTargetPlayerForImg(player.name); existingPlayerImgRef.current?.click(); }}
                                                title="Cambia Foto"
                                            >
                                                 {player.image ? (
                                                    <img src={player.image} alt="Avatar" className="w-full h-full rounded-full object-cover border border-slate-600" />
                                                ) : (
                                                    <div className="w-full h-full rounded-full bg-slate-700 flex items-center justify-center"><User size={14} className="text-slate-500"/></div>
                                                )}
                                                <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity">
                                                    <Camera size={14} className="text-white"/>
                                                </div>
                                            </div>

                                            <div className="flex flex-col group cursor-pointer" onClick={() => handleRenamePlayer(player.name)}>
                                                <div className="flex items-center gap-2">
                                                    <span className={`${isAssigned ? 'line-through opacity-70' : 'font-medium'}`}>{player.name}</span>
                                                    <Edit3 size={10} className="opacity-0 group-hover:opacity-100 text-slate-500" />
                                                </div>
                                                {player.nickname && <span className="text-[10px] text-slate-500 italic">"{player.nickname}"</span>}
                                            </div>
                                        </div>
                                        {!isAssigned && <button onClick={() => removePlayerFromRegistry(player.name)} className="text-slate-500 hover:text-red-400 p-1"><X size={14} /></button>}
                                    </div>
                                );
                            })}
                    </div>
                </div>
            </div>

            <div className="lg:col-span-7 flex flex-col gap-4">
                <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700 h-full flex flex-col">
                    <h3 className="text-white font-bold mb-4 flex items-center gap-2"><UserPlus size={18} className="text-padel-court"/> {isTeamMode ? "Composizione Squadre" : "Lista Partecipanti"}</h3>
                    
                    {/* SELECTION POOL */}
                    <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50 mb-4 flex-1">
                        {isTeamMode && <div className="mb-4"><input type="text" placeholder="Nome Squadra (Opzionale)" value={teamName} onChange={e => setTeamName(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-white text-sm focus:ring-1 focus:ring-padel-court outline-none" /></div>}
                        
                        <div className="flex flex-wrap gap-2 mb-4 max-h-[200px] overflow-y-auto">
                            {registryPlayers.length === 0 && <p className="text-sm text-slate-500 italic">Aggiungi giocatori all'albo.</p>}
                            {registryPlayers.map(player => {
                                if (assignedPlayers.has(player.name)) return null; 
                                const isSelected = selectedForTeam.includes(player.name);
                                const isCaptain = selectedCaptain === player.name;
                                return (
                                    <div key={player.name} className={`text-sm rounded-full border transition-all flex items-center gap-0 overflow-hidden pl-1 ${isSelected ? 'bg-padel-court text-white border-padel-court shadow-md scale-105' : 'bg-slate-700 text-slate-300 border-slate-600 opacity-80 hover:opacity-100'}`}>
                                        <button onClick={() => togglePlayerSelection(player.name)} className="px-2 py-1.5 flex items-center gap-2">
                                            {isSelected ? <CheckCircle size={14}/> : <Plus size={14}/>}
                                            {/* Small Avatar in Selection */}
                                            {player.image ? (
                                                <img src={player.image} className="w-4 h-4 rounded-full object-cover border border-white/20" />
                                            ) : (
                                                 <span className={`w-2 h-2 rounded-full inline-block mr-1 ${getTierColor(player.tier).split(' ')[0]}`}></span>
                                            )}
                                            {player.name}
                                        </button>
                                        {isSelected && isTeamMode && <button onClick={() => setSelectedCaptain(isCaptain ? null : player.name)} className={`px-2 py-1.5 border-l ${isCaptain ? 'bg-yellow-400 text-yellow-900' : 'border-blue-400 hover:bg-blue-600'}`}><Crown size={12} className={isCaptain ? 'fill-current' : ''} /></button>}
                                    </div>
                                )
                            })}
                        </div>

                        {/* ACTION BUTTONS */}
                        <div className="flex flex-col gap-2">
                             {/* Individual Add (Manual) */}
                            {isTeamMode ? (
                                <button onClick={handleAddTeam} disabled={selectedForTeam.length < config.teamSize} className="w-full bg-padel-court hover:bg-blue-500 text-white px-6 py-3 rounded-lg font-bold text-sm shadow-lg disabled:opacity-50 transition-all">
                                    <Plus size={16} className="inline mr-2"/> {teamName || selectedForTeam.length > 0 ? "Aggiorna/Crea Squadra" : "Crea Squadra Manuale"} ({selectedForTeam.length}/{config.teamSize})
                                </button>
                            ) : (
                                <div className="flex gap-2 w-full">
                                    <button onClick={handleAddTeam} disabled={selectedForTeam.length < 1} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg font-bold text-sm border border-slate-600 disabled:opacity-50">
                                        <Plus size={16} className="inline mr-2"/> Aggiungi Selezionati
                                    </button>
                                    <button onClick={handleAddAllAsIndividuals} disabled={registryPlayers.filter(p => !assignedPlayers.has(p.name)).length === 0} className="flex-1 bg-padel-court hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-bold text-sm shadow-lg disabled:opacity-50">
                                        <UserCheck size={16} className="inline mr-2"/> Aggiungi Tutti
                                    </button>
                                </div>
                            )}

                             {/* Balanced Generation (Only for Team Mode) */}
                             {isTeamMode && (
                                 <div className="mt-2 pt-2 border-t border-slate-700">
                                    <p className="text-[10px] text-slate-400 mb-2 uppercase font-bold tracking-wider">Generazione Automatica</p>
                                    <button 
                                        onClick={handleGenerateBalancedTeams} 
                                        disabled={selectedForTeam.length < config.teamSize * 2 || selectedForTeam.length % config.teamSize !== 0} 
                                        className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-6 py-3 rounded-lg font-bold text-sm shadow-lg disabled:opacity-50 transition-all flex items-center justify-center gap-2 border border-emerald-500/50"
                                        title={`Seleziona un multiplo di ${config.teamSize} giocatori per generare squadre equilibrate`}
                                    >
                                        <BarChart3 size={16} /> Estrazione Equilibrata ({config.teamSize} per squadra)
                                    </button>
                                    <p className="text-[10px] text-slate-500 mt-1 text-center italic">Seleziona la pool di giocatori e clicca per creare squadre con somma di abilità simile.</p>
                                 </div>
                             )}
                        </div>
                    </div>

                    {/* TEAM LIST */}
                    <div>
                        <h4 className="text-slate-400 text-xs uppercase font-bold mb-3 flex items-center gap-2">Iscritti <span className="bg-slate-700 text-slate-200 px-2 rounded-full">{teams.length}</span></h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                            {teams.map(t => {
                                const isEditing = editingTeamId === t.id;
                                return (
                                    <div key={t.id} className="bg-slate-700 text-white p-3 rounded-lg border border-slate-600 shadow-sm group">
                                        {isEditing ? (
                                            <div className="flex flex-col gap-2">
                                                <input 
                                                    value={editName}
                                                    onChange={e => setEditName(e.target.value)}
                                                    className="bg-slate-800 border border-slate-500 rounded px-2 py-1 text-xs text-white"
                                                    placeholder="Nome Squadra"
                                                />
                                                {config.mode !== 'SINGLES' && config.mode !== 'AMERICANO' && (
                                                    <select 
                                                        value={editCaptain}
                                                        onChange={e => setEditCaptain(e.target.value)}
                                                        className="bg-slate-800 border border-slate-500 rounded px-2 py-1 text-xs text-white"
                                                    >
                                                        {t.players.map(p => <option key={p} value={p}>Cap: {p}</option>)}
                                                    </select>
                                                )}
                                                <div className="flex gap-2 justify-end mt-1">
                                                    <button onClick={() => setEditingTeamId(null)} className="p-1 bg-slate-600 rounded hover:bg-slate-500"><X size={14}/></button>
                                                    <button onClick={saveEditedTeam} className="p-1 bg-green-600 rounded hover:bg-green-500"><Save size={14}/></button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-between h-full">
                                                <div className="flex flex-col overflow-hidden">
                                                    <span className="font-bold text-sm truncate">{t.name}</span>
                                                    {isTeamMode && <div className="text-[10px] text-slate-400 truncate flex flex-wrap gap-1 mt-1">{t.players.map((p, idx) => <span key={p} className={`flex items-center gap-0.5 ${p === t.captain ? 'text-yellow-400 font-bold' : ''}`}>{p} {p === t.captain && <Crown size={8} className="fill-current"/>}{idx !== t.players.length-1 && ','} </span>)}</div>}
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <button onClick={() => startEditing(t)} className="text-slate-400 hover:text-blue-400 bg-slate-800 rounded-full p-1.5" title="Modifica Nome/Capitano"><Edit3 size={14}/></button>
                                                    <button onClick={() => removeTeam(t.id)} className="text-slate-400 hover:text-red-400 bg-slate-800 rounded-full p-1.5"><X size={14} /></button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-700 pt-6">
             {!isAmericano && <div className="bg-slate-900 p-4 rounded-lg border border-slate-700 cursor-pointer" onClick={() => setConfig({...config, doubleRound: !config.doubleRound})}><div className="flex items-center justify-between"><span className="text-slate-300 font-medium">Andata e Ritorno</span><div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${config.doubleRound ? 'bg-padel-court border-padel-court' : 'border-slate-500'}`}>{config.doubleRound && <CheckCircle size={16} className="text-white" />}</div></div></div>}
             <div className="bg-slate-900 p-4 rounded-lg border border-slate-700"><div className="flex items-center justify-between mb-2"><label className="text-slate-300 font-medium">Accesso Playoff</label><Shield size={16} className="text-slate-500"/></div><select value={config.playoffTeams} onChange={e => setConfig({...config, playoffTeams: Number(e.target.value)})} className="w-full bg-slate-800 border border-slate-600 rounded text-white p-2 text-sm focus:ring-1 focus:ring-padel-court" disabled={isAmericano}><option value={0}>Nessuno</option>{!isAmericano && <><option value={2}>Top 2 (Finale)</option><option value={4}>Top 4 (Semifinali)</option><option value={6}>Top 6 (1°-2° Bye)</option><option value={-1}>Tutti</option></>}</select></div>
        </div>

        <button disabled={teams.length < (isAmericano ? 4 : 2)} onClick={handleStartTournament} className="w-full bg-padel-ball hover:bg-yellow-400 text-slate-900 font-bold py-4 rounded-xl shadow-lg transition-all disabled:opacity-50 mt-6 text-lg flex items-center justify-center gap-2"><Trophy size={20} /> Inizia Torneo</button>

        {archives.length > 0 && (
            <div className="mt-12">
                <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2"><History className="text-slate-400" /> Archivio Tornei</h3>
                <div className="bg-slate-900/50 rounded-xl border border-slate-700 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-900 text-slate-400 uppercase text-xs">
                                <tr>
                                    <th className="p-4">Data</th>
                                    <th className="p-4">Nome Torneo</th>
                                    <th className="p-4">Info</th>
                                    <th className="p-4 text-center">Azioni</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                                {archives.map(arc => (
                                    <tr key={arc.id} className="hover:bg-slate-800/50">
                                        <td className="p-4 text-slate-400 whitespace-nowrap">{new Date(arc.date).toLocaleDateString()}</td>
                                        <td className="p-4 font-bold text-white">{arc.name}</td>
                                        <td className="p-4 text-slate-400 text-xs">{arc.teams.length} Squadre, {arc.matches.filter(m => m.played).length} Match</td>
                                        <td className="p-4">
                                            <div className="flex gap-2 justify-center">
                                                <button onClick={() => onLoadArchive(arc)} className="p-2 bg-blue-900/50 text-blue-400 rounded hover:bg-blue-900 hover:text-white" title="Carica/Visualizza"><RotateCcw size={16}/></button>
                                                <button onClick={() => exportArchive(arc)} className="p-2 bg-slate-700 text-slate-400 rounded hover:bg-slate-600 hover:text-white" title="Download JSON"><Download size={16}/></button>
                                                <button onClick={() => onDeleteArchive(arc.id)} className="p-2 bg-red-900/50 text-red-400 rounded hover:bg-red-900 hover:text-white" title="Elimina"><Trash2 size={16}/></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        )}
      </div>
    </div>
  );
};

// Simple Match Card Component for Dashboard
const MatchCard: React.FC<{ 
    match: Match, 
    teams: Team[], 
    onUpdateMatch: (data: { score: MatchScore, date?: string, court?: string, playersAIds?: string[], playersBIds?: string[] }) => void, 
    mode: string, 
    onShowH2H?: (tA: Team, tB: Team) => void
}> = ({ match, teams, onUpdateMatch, mode, onShowH2H }) => {
    const [editing, setEditing] = useState(!match.played);
    const [score, setScore] = useState<MatchScore>(match.score || { set1: {a:0, b:0}, set2: {a:0, b:0}, set3: {a:0, b:0} });
    const [dateVal, setDateVal] = useState(match.date || "");
    const [courtVal, setCourtVal] = useState(match.court || "");

    // Player Selection State
    const [selPlayersA, setSelPlayersA] = useState<string[]>([]);
    const [selPlayersB, setSelPlayersB] = useState<string[]>([]);

    useEffect(() => {
        // Initialize or Update state from match props
        setScore(match.score || { set1: {a:0, b:0}, set2: {a:0, b:0}, set3: {a:0, b:0} });
        setDateVal(match.date || "");
        setCourtVal(match.court || "");

        // Initialize player selection
        const tA = teams.find(t => t.id === match.teamAId);
        const tB = teams.find(t => t.id === match.teamBId);
        
        if (match.playersAIds && match.playersAIds.length > 0) {
            setSelPlayersA(match.playersAIds);
        } else if (tA) {
             setSelPlayersA(tA.players); // Default to all
        }

        if (match.playersBIds && match.playersBIds.length > 0) {
            setSelPlayersB(match.playersBIds);
        } else if (tB) {
            setSelPlayersB(tB.players); // Default to all
        }
    }, [match, teams]);

    const getTeamName = (id: string, playerIds?: string[]) => {
        if (mode === 'AMERICANO' && playerIds) {
             const names = playerIds.map(pid => teams.find(t => t.id === pid)?.name || pid);
             return names.join(' / ');
        }
        return teams.find(t => t.id === id)?.name || '???';
    };

    const teamAName = getTeamName(match.teamAId, match.playersAIds);
    const teamBName = getTeamName(match.teamBId, match.playersBIds);

    const handleSave = () => {
        // CRITICAL: Ensure we have players selected, or fallback to default team players if empty (for non-Americano)
        let finalPlayersA = selPlayersA;
        let finalPlayersB = selPlayersB;

        const tA = teams.find(t => t.id === match.teamAId);
        const tB = teams.find(t => t.id === match.teamBId);

        if (mode !== 'AMERICANO' && mode !== 'SINGLES') {
            if (finalPlayersA.length === 0 && tA) finalPlayersA = tA.players;
            if (finalPlayersB.length === 0 && tB) finalPlayersB = tB.players;
        }

        onUpdateMatch({ 
            score, 
            date: dateVal, 
            court: courtVal, 
            playersAIds: finalPlayersA,
            playersBIds: finalPlayersB
        });
        setEditing(false);
    };

    const handleShare = () => {
        const scoreStr = `${score.set1.a}-${score.set1.b} ${score.set2.a}-${score.set2.b} ${score.set3 && (score.set3.a>0 || score.set3.b>0) ? `(${score.set3.a}-${score.set3.b})` : ''}`;
        const text = `🎾 *PADEL RESULT*\n\n${teamAName} 🆚 ${teamBName}\n📊 ${scoreStr}\n🏆 ${mode}`;
        
        if (navigator.share) {
            navigator.share({ title: 'Match Result', text }).catch(console.error);
        } else {
            navigator.clipboard.writeText(text);
            alert('Risultato copiato negli appunti!');
        }
    };

    const togglePlayer = (side: 'A' | 'B', playerId: string) => {
        if (side === 'A') {
            setSelPlayersA(prev => prev.includes(playerId) ? prev.filter(id => id !== playerId) : [...prev, playerId]);
        } else {
            setSelPlayersB(prev => prev.includes(playerId) ? prev.filter(id => id !== playerId) : [...prev, playerId]);
        }
    };

    const renderPlayerSelection = (teamId: string, selectedIds: string[], side: 'A' | 'B') => {
        if (mode === 'AMERICANO' || mode === 'SINGLES') return null;
        
        const team = teams.find(t => t.id === teamId);
        if (!team) return null;

        return (
            <div className="flex flex-wrap gap-1 mt-1">
                {team.players.map(p => {
                    const isSelected = selectedIds.includes(p);
                    return (
                        <button 
                            key={p} 
                            onClick={() => togglePlayer(side, p)}
                            className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${isSelected ? 'bg-green-600 text-white border-green-500' : 'bg-slate-800 text-slate-500 border-slate-600 hover:border-slate-400'}`}
                        >
                            {p}
                        </button>
                    )
                })}
            </div>
        );
    };

    return (
        <div className={`bg-slate-700/50 rounded p-3 border ${match.played ? 'border-green-500/30' : 'border-slate-600'}`}>
             <div className="flex justify-between items-center mb-2">
                 <div className="flex-1">
                     {/* TEAM A HEADER */}
                     <div className="text-sm font-bold text-white truncate">{teamAName}</div>
                     {editing ? renderPlayerSelection(match.teamAId, selPlayersA, 'A') : (
                         mode !== 'AMERICANO' && mode !== 'SINGLES' && (
                             <div className="text-[10px] text-slate-400 truncate">
                                 {match.playersAIds ? 
                                     match.playersAIds.map(pid => teams.find(t => t.id === pid)?.name || pid).join(' / ') 
                                     : teams.find(t => t.id === match.teamAId)?.players.join(' / ')}
                             </div>
                         )
                     )}
                     
                     <div className="flex items-center gap-2 my-1">
                         <span className="text-xs text-slate-400">vs</span>
                         {!editing && onShowH2H && mode !== 'AMERICANO' && (
                             <button 
                                onClick={() => {
                                    const tA = teams.find(t => t.id === match.teamAId);
                                    const tB = teams.find(t => t.id === match.teamBId);
                                    if(tA && tB) onShowH2H(tA, tB);
                                }}
                                className="text-[9px] bg-red-900/50 text-red-300 px-1.5 rounded border border-red-800 hover:bg-red-800"
                             >
                                 VS Stats
                             </button>
                         )}
                     </div>
                     
                     {/* TEAM B HEADER */}
                     <div className="text-sm font-bold text-white truncate">{teamBName}</div>
                     {editing ? renderPlayerSelection(match.teamBId, selPlayersB, 'B') : (
                         mode !== 'AMERICANO' && mode !== 'SINGLES' && (
                             <div className="text-[10px] text-slate-400 truncate">
                                 {match.playersBIds ? 
                                     match.playersBIds.map(pid => teams.find(t => t.id === pid)?.name || pid).join(' / ') 
                                     : teams.find(t => t.id === match.teamBId)?.players.join(' / ')}
                             </div>
                         )
                     )}
                 </div>
                 
                 <div className="flex flex-col gap-1 ml-2">
                     {editing ? (
                         <div className="flex gap-1 flex-col">
                            <button onClick={handleSave} className="bg-green-600 p-1.5 rounded text-white hover:bg-green-500"><Save size={16}/></button>
                            <VoiceScoreAssistant onScoreParsed={setScore} />
                         </div>
                     ) : (
                         <div className="flex gap-1 flex-col">
                            <button onClick={() => setEditing(true)} className="bg-slate-600 p-1.5 rounded text-slate-300 hover:text-white"><Edit3 size={16}/></button>
                            <button onClick={handleShare} className="bg-slate-600 p-1.5 rounded text-slate-300 hover:text-green-400"><Share2 size={16}/></button>
                         </div>
                     )}
                 </div>
             </div>
             
             {editing ? (
                 <div className="flex flex-col gap-2 border-t border-slate-600 pt-2 mt-2">
                     <div className="grid grid-cols-2 gap-2 mb-2">
                         <input 
                            type="datetime-local" 
                            value={dateVal} 
                            onChange={e => setDateVal(e.target.value)}
                            className="bg-slate-800 text-xs text-white p-1 rounded border border-slate-600 w-full"
                         />
                         <select 
                            value={courtVal} 
                            onChange={e => setCourtVal(e.target.value)}
                            className="bg-slate-800 text-xs text-white p-1 rounded border border-slate-600 w-full"
                         >
                            <option value="">Seleziona Campo</option>
                            <option value="Olimpionica">Olimpionica</option>
                            <option value="M&T">M&T</option>
                            <option value="Centrale">Centrale</option>
                            <option value="Campo 4">Campo 4</option>
                         </select>
                     </div>
                     <div className="flex gap-2 text-center items-center justify-center">
                         <div className="space-y-1">
                             <div className="text-[10px] text-slate-400">SET 1</div>
                             <input type="number" className="w-8 bg-slate-800 text-white text-center rounded border border-slate-600" value={score.set1.a} onChange={e => setScore({...score, set1: {...score.set1, a: +e.target.value}})} />
                             <input type="number" className="w-8 bg-slate-800 text-white text-center rounded border border-slate-600" value={score.set1.b} onChange={e => setScore({...score, set1: {...score.set1, b: +e.target.value}})} />
                         </div>
                         <div className="space-y-1">
                             <div className="text-[10px] text-slate-400">SET 2</div>
                             <input type="number" className="w-8 bg-slate-800 text-white text-center rounded border border-slate-600" value={score.set2.a} onChange={e => setScore({...score, set2: {...score.set2, a: +e.target.value}})} />
                             <input type="number" className="w-8 bg-slate-800 text-white text-center rounded border border-slate-600" value={score.set2.b} onChange={e => setScore({...score, set2: {...score.set2, b: +e.target.value}})} />
                         </div>
                         <div className="space-y-1">
                             <div className="text-[10px] text-slate-400">SET 3</div>
                             <input type="number" className="w-8 bg-slate-800 text-white text-center rounded border border-slate-600" value={score.set3?.a || 0} onChange={e => setScore({...score, set3: {...(score.set3 || {a:0, b:0}), a: +e.target.value}})} />
                             <input type="number" className="w-8 bg-slate-800 text-white text-center rounded border border-slate-600" value={score.set3?.b || 0} onChange={e => setScore({...score, set3: {...(score.set3 || {a:0, b:0}), b: +e.target.value}})} />
                         </div>
                     </div>
                 </div>
             ) : (
                 <div className="flex flex-col gap-1 items-center">
                    {(match.date || match.court) && (
                        <div className="flex gap-2 text-[10px] text-slate-400">
                             {match.date && <span>{new Date(match.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>}
                             {match.court && <span className="text-padel-court font-bold">{match.court}</span>}
                        </div>
                    )}
                    <div className="text-center font-mono text-lg font-bold text-padel-court tracking-widest">
                        {score.set1.a}-{score.set1.b}  {score.set2.a}-{score.set2.b}
                        {(score.set3 && (score.set3.a > 0 || score.set3.b > 0)) && (
                            <span className="text-green-500 font-extrabold text-base ml-2">{score.set3.a}-{score.set3.b}</span>
                        )}
                    </div>
                 </div>
             )}
        </div>
    );
};

const TournamentDashboard = ({ 
    tournament, 
    updateTournament, 
    onArchive,
    registryPlayers,
    onUpdatePlayerImage,
    logo
}: { 
    tournament: { id: string, config: TournamentConfig, teams: Team[], matches: Match[], startDate: string, name: string },
    updateTournament: (t: any) => void,
    onArchive: () => void,
    registryPlayers: RegistryPlayer[],
    onUpdatePlayerImage: (name: string, img: string) => void,
    logo: string | null
}) => {
    const [activeTab, setActiveTab] = useState<'MATCHES' | 'CALENDAR' | 'STANDINGS' | 'STATS' | 'PRO' | 'ANALYSIS' | 'TEAMS' | 'BRACKET' | 'SETTINGS'>('MATCHES');
    const [aiReport, setAiReport] = useState<string>('');
    const [loadingAi, setLoadingAi] = useState(false);

    // Editing Teams State
    const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
    const [editTeamName, setEditTeamName] = useState("");
    const [editTeamCaptain, setEditTeamCaptain] = useState("");

    // Selected Player for FUT Card
    const [selectedPlayerForCard, setSelectedPlayerForCard] = useState<{player: PlayerStats, rank: number} | null>(null);

    // VS Modal
    const [h2hTeams, setH2hTeams] = useState<{tA: Team, tB: Team} | null>(null);

    // Derived state - Force re-calc when tournament changes
    const stats = useMemo(() => calculateStats(tournament.teams, tournament.matches, tournament.config.mode), [tournament]);
    const playerStats = useMemo(() => calculatePlayerRankings(tournament.teams, tournament.matches), [tournament]);
    const streaks = useMemo(() => calculateStreaks(tournament.teams, tournament.matches), [tournament]);
    const pairStats = useMemo(() => calculatePairStats(tournament.teams, tournament.matches), [tournament]);
    
    // Group matches by round
    const rounds = useMemo(() => {
        const r: Record<number, Match[]> = {};
        tournament.matches.forEach(m => {
            if (!r[m.round]) r[m.round] = [];
            r[m.round].push(m);
        });
        return r;
    }, [tournament.matches]);

    // Flatten matches for Calendar
    const allMatchesSorted = useMemo(() => {
        return [...tournament.matches].sort((a, b) => {
             // If we had dates, sort by date, otherwise by round
             if (a.date && b.date) return new Date(a.date).getTime() - new Date(b.date).getTime();
             return a.round - b.round;
        });
    }, [tournament.matches]);

    const handleMatchUpdate = (matchId: string, data: { score: MatchScore, date?: string, court?: string, playersAIds?: string[], playersBIds?: string[] }) => {
        const newMatches = tournament.matches.map(m => 
            m.id === matchId ? { 
                ...m, 
                score: data.score, 
                date: data.date, 
                court: data.court, 
                playersAIds: data.playersAIds,
                playersBIds: data.playersBIds,
                played: true 
            } : m
        );
        // FORCE DEEP UPDATE with timestamp to ensure all useMemos are triggered
        updateTournament({ 
            ...tournament, 
            matches: newMatches,
            lastUpdated: Date.now() 
        });
    };

    const generateAI = async () => {
        setLoadingAi(true);
        const report = await generateTournamentAnalysis(tournament.teams, stats, tournament.matches);
        setAiReport(report);
        setLoadingAi(false);
    };

    const handleUpdateTeam = () => {
        if (!editingTeamId) return;
        const newTeams = tournament.teams.map(t => 
            t.id === editingTeamId ? { ...t, name: editTeamName, captain: editTeamCaptain } : t
        );
        updateTournament({ ...tournament, teams: newTeams });
        setEditingTeamId(null);
    };

    const startEditingTeam = (team: Team) => {
        setEditingTeamId(team.id);
        setEditTeamName(team.name);
        setEditTeamCaptain(team.captain || team.players[0] || "");
    };

    const handleToggleDoubleRound = () => {
        const isDouble = !tournament.config.doubleRound;
        const nTeams = tournament.teams.length;
        // Standard round robin rounds = N-1 (if even) or N (if odd/bye included in logic). 
        // Based on scheduler logic: if N is even, rounds = N-1. If odd, rounds = N.
        const effectiveN = nTeams % 2 === 0 ? nTeams : nTeams + 1;
        const singleLegRounds = effectiveN - 1;

        let updatedMatches = [...tournament.matches];

        if (isDouble) {
            // TURN ON: Add Return Leg Matches
            if (!confirm(`Vuoi generare le partite di ritorno? Verranno aggiunti ${updatedMatches.length} nuovi match.`)) return;

            // Simple logic: Take all existing matches (which should be first leg if we are toggling from single)
            // Clone them, swap A/B, add round offset.
            // Note: We filter by round <= singleLegRounds to avoid duplicating already duplicated matches if data is weird.
            const firstLegMatches = updatedMatches.filter(m => m.round <= singleLegRounds);
            
            const returnMatches: Match[] = firstLegMatches.map(m => ({
                id: `match-return-generated-${m.id}-${Date.now()}`,
                teamAId: m.teamBId,
                teamBId: m.teamAId,
                round: m.round + singleLegRounds,
                score: null,
                played: false
            }));

            updatedMatches = [...updatedMatches, ...returnMatches];
        } else {
            // TURN OFF: Remove Return Leg Matches
            // We only remove matches that are unplayed to avoid data loss.
            if (!confirm("Disattivare il girone di ritorno? Le partite di ritorno NON ANCORA GIOCATE verranno eliminate.")) return;
            
            updatedMatches = updatedMatches.filter(m => {
                if (m.round > singleLegRounds && !m.played) return false; // Delete unplayed return matches
                return true; // Keep others
            });
        }

        updateTournament({
            ...tournament,
            matches: updatedMatches,
            config: { ...tournament.config, doubleRound: isDouble }
        });
    };

    const handleUpdatePlayoffConfig = (teamsCount: number) => {
        updateTournament({
            ...tournament,
            config: { ...tournament.config, playoffTeams: teamsCount }
        });
    };

    const handleExportWeb = () => {
        const html = generateStaticWebPage(tournament, stats, playerStats, registryPlayers, logo, aiReport);
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${tournament.name.replace(/\s+/g, '_')}_WEB.html`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleExportPDF = () => {
         const doc = new jsPDF();
         doc.setFontSize(18);
         doc.text(`Report Torneo: ${tournament.name}`, 14, 20);
         doc.setFontSize(11);
         doc.text(`Data: ${new Date().toLocaleDateString()}`, 14, 28);
         
         // 1. STANDINGS
         doc.text("Classifica Generale", 14, 40);
         const standingsData = stats.map((s, i) => [
             i+1, 
             tournament.teams.find(t => t.id === s.teamId)?.name || '?',
             s.points, 
             s.played, 
             s.won, 
             s.lost,
             s.setsWon - s.setsLost,
             s.gamesWon - s.gamesLost
         ]);
         
         autoTable(doc, {
             head: [['Pos', 'Team', 'Pt', 'G', 'V', 'P', 'Set +/-', 'Game +/-']],
             body: standingsData,
             startY: 45,
             theme: 'grid',
             headStyles: { fillColor: [41, 128, 185] }
         });
         
         // 2. PLAYERS
         const finalY = (doc as any).lastAutoTable.finalY + 15;
         doc.text("Statistiche Giocatori", 14, finalY);
         
         const playersData = playerStats.map((p, i) => [
             i+1,
             p.name,
             p.points, // Added Points here too
             p.played,
             `${p.winRate.toFixed(1)}%`,
             p.setsWon - p.setsLost,
             p.gamesWon - p.gamesLost
         ]);

         autoTable(doc, {
             head: [['Rank', 'Nome', 'Pt', 'Partite', 'Win%', 'Set +/-', 'Game +/-']],
             body: playersData,
             startY: finalY + 5,
             theme: 'striped'
         });

         // 3. CALENDAR
         doc.addPage();
         doc.text("Calendario Incontri", 14, 20);
         
         const calendarData = allMatchesSorted.map(m => {
             const tA = tournament.teams.find(t => t.id === m.teamAId);
             const tB = tournament.teams.find(t => t.id === m.teamBId);
             
             // Get exact players if possible (same logic as Calendar tab)
             const getPlayers = (ids: string[] | undefined, team: Team | undefined) => {
                 if(ids) return ids.map(pid => tournament.teams.find(t => t.id === pid)?.name || pid).join(' / ');
                 return team?.players.join(' / ') || '';
             };
             
             const teamDisplayA = `${tA?.name || ''}\n(${getPlayers(m.playersAIds, tA)})`;
             const teamDisplayB = `${tB?.name || ''}\n(${getPlayers(m.playersBIds, tB)})`;
             
             // Check if truly played (not 0-0)
             const totalGames = m.score ? (m.score.set1.a + m.score.set1.b + m.score.set2.a + m.score.set2.b + (m.score.set3 ? m.score.set3.a + m.score.set3.b : 0)) : 0;
             const isEffectivePlayed = m.played && m.score && totalGames > 0;

             const scoreStr = isEffectivePlayed && m.score
                ? `${m.score.set1.a}-${m.score.set1.b} ${m.score.set2.a}-${m.score.set2.b}` 
                : 'Da Giocare';

             return [
                 m.round,
                 m.court || '-',
                 m.date ? new Date(m.date).toLocaleString() : '-',
                 teamDisplayA,
                 teamDisplayB,
                 scoreStr
             ];
         });
         
         autoTable(doc, {
             head: [['Round', 'Campo', 'Data', 'Team A', 'Team B', 'Risultato']],
             body: calendarData,
             startY: 25,
             styles: { fontSize: 8 },
             columnStyles: { 
                 3: { cellWidth: 50 }, 
                 4: { cellWidth: 50 } 
             }
         });
         
         doc.save(`${tournament.name.replace(/\s+/g, '_')}_report.pdf`);
    };

    const handleExportBackup = () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
            config: tournament.config,
            teams: tournament.teams,
            matches: tournament.matches,
            startDate: tournament.startDate,
            name: tournament.name,
            // ADDED: Include Logo and Registry (images) in backup
            logo: logo,
            registryPlayers: registryPlayers
        }));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", `BACKUP_${tournament.name.replace(/\s+/g, '_')}.json`);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    };

    const handleExportProPDF = () => {
        const doc = new jsPDF();
        doc.setFontSize(20);
        doc.text(`PRO ANALYTICS: ${tournament.name}`, 14, 20);
        
        let yPos = 30;

        // 1. BEST PAIRS
        doc.setFontSize(14);
        doc.text("Migliori Coppie", 14, yPos);
        yPos += 5;
        autoTable(doc, {
            head: [['Coppia', 'Giocate', 'Vinte', '% Vittorie']],
            body: pairStats.map(p => [`${p.p1} & ${p.p2}`, p.played, p.won, `${p.winRate.toFixed(1)}%`]),
            startY: yPos,
            theme: 'grid',
            headStyles: { fillColor: [22, 160, 133] }
        });
        
        yPos = (doc as any).lastAutoTable.finalY + 15;

        // 2. SPECIAL METRICS
        doc.text("Metriche Speciali", 14, yPos);
        yPos += 5;
        
        // Prepare Real Data for PDF - CRITICAL FIX: Sort copies to avoid mutation
        // SORT LOGIC: 1. Value (Desc), 2. Matches Played (Asc - Efficiency)
        const sortMetric = (metric: keyof PlayerStats) => (a: PlayerStats, b: PlayerStats) => {
            const valA = a[metric] as number;
            const valB = b[metric] as number;
            if (valB !== valA) return valB - valA;
            return a.played - b.played;
        };

        const bagelsData = [...playerStats].sort(sortMetric('bagels')).filter(p => p.bagels > 0).slice(0, 3).map(p => [`${p.name} (${p.played})`, p.bagels]);
        const tieBreaksData = [...playerStats].sort(sortMetric('tieBreaksWon')).filter(p => p.tieBreaksWon > 0).slice(0, 3).map(p => [`${p.name} (${p.played})`, p.tieBreaksWon]);
        const comebacksData = [...playerStats].sort(sortMetric('comebacks')).filter(p => p.comebacks > 0).slice(0, 3).map(p => [`${p.name} (${p.played})`, p.comebacks]);
        
        // Streaks logic for PDF
        const streaksData = [...streaks]
            .sort((a,b) => {
                if(b.maxWin !== a.maxWin) return b.maxWin - a.maxWin;
                const pA = playerStats.find(p => p.name === a.name);
                const pB = playerStats.find(p => p.name === b.name);
                return (pA?.played || 0) - (pB?.played || 0);
            })
            .filter(s => s.maxWin > 0)
            .slice(0, 3)
            .map(s => {
                const p = playerStats.find(ps => ps.name === s.name);
                return [`${s.name} (${p?.played || 0})`, s.maxWin];
            });

        // Just listing them all in one table for simplicity or separate
        autoTable(doc, {
            head: [['Categoria', 'Top Player (Partite)', 'Valore']],
            body: [
                ['Bagel (6-0)', bagelsData[0] ? bagelsData[0][0] : '-', bagelsData[0] ? bagelsData[0][1] : 0],
                ['Tie-Break Vinti', tieBreaksData[0] ? tieBreaksData[0][0] : '-', tieBreaksData[0] ? tieBreaksData[0][1] : 0],
                ['Rimonte', comebacksData[0] ? comebacksData[0][0] : '-', comebacksData[0] ? comebacksData[0][1] : 0],
                ['Winning Streak', streaksData[0] ? streaksData[0][0] : '-', streaksData[0] ? streaksData[0][1] : 0],
            ],
            startY: yPos,
            theme: 'striped'
        });

        yPos = (doc as any).lastAutoTable.finalY + 15;

        // 3. ATTACK / DEFENSE (SORTED BY BEST NET DIFF)
        doc.text("Attacco vs Difesa", 14, yPos);
        yPos += 5;
        const adData = [...playerStats]
            .filter(p => p.played > 0) // ADDED FILTER
            .sort((a, b) => b.avgGameDiff - a.avgGameDiff) // Sort by Best Net Diff
            .map(p => [
            p.name,
            (p.gamesWon / Math.max(1, p.played)).toFixed(2),
            (p.gamesLost / Math.max(1, p.played)).toFixed(2),
            p.avgGameDiff.toFixed(2)
        ]);
        
        autoTable(doc, {
            head: [['Giocatore', 'Game Vinti/Match', 'Game Persi/Match', 'Diff. Netta']],
            body: adData,
            startY: yPos,
             headStyles: { fillColor: [44, 62, 80] }
        });

        doc.save(`${tournament.name}_PRO_Stats.pdf`);
    };

    const isAmericano = tournament.config.mode === 'AMERICANO';
    const isSingles = tournament.config.mode === 'SINGLES';

    return (
        <div className="max-w-6xl mx-auto p-4 md:p-6 pb-20">
             
             {/* Dashboard Header */}
             <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
                <h2 className="text-2xl text-white font-bold tracking-tight">{tournament.name}</h2>
                <div className="flex flex-wrap gap-2 justify-center">
                    <button onClick={handleExportWeb} className="bg-padel-court hover:bg-blue-600 px-4 py-2 rounded text-white flex items-center gap-2 text-sm font-bold shadow-lg transition-transform hover:scale-105" title="Crea Pagina Web"><Globe size={16}/> Sito Web</button>
                    <button onClick={handleExportBackup} className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded text-white flex items-center gap-2 text-sm font-bold shadow transition-transform hover:scale-105" title="Scarica Backup JSON"><Download size={16}/> Backup</button>
                    <button onClick={onArchive} className="bg-red-600 hover:bg-red-500 px-4 py-2 rounded text-white flex items-center gap-2 text-sm font-bold shadow-lg transition-transform hover:scale-105"><Archive size={16}/> Archivia</button>
                    <button onClick={handleExportPDF} className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded text-white flex items-center gap-2 text-sm font-bold shadow transition-transform hover:scale-105"><FileText size={16}/> PDF Report</button>
                    <button onClick={handleExportProPDF} className="bg-gradient-to-r from-yellow-600 to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 px-4 py-2 rounded text-white flex items-center gap-2 text-sm font-bold shadow transition-transform hover:scale-105"><Star size={16}/> PDF PRO</button>
                </div>
             </div>

             {/* TABS */}
             <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-hide">
                 {[
                     {id:'MATCHES', label:'Partite', icon: Activity},
                     {id:'CALENDAR', label:'Calendario', icon: Calendar},
                     {id:'STANDINGS', label:'Classifica', icon: List},
                     {id:'BRACKET', label:'Playoff', icon: GitGraph},
                     {id:'STATS', label:'Players', icon: Users},
                     {id:'PRO', label:'Pro Stats', icon: TrendingUp},
                     {id:'ANALYSIS', label:'Analisi Coach', icon: Zap},
                     {id:'TEAMS', label:'Squadre', icon: Users2},
                     {id:'SETTINGS', label:'Opzioni', icon: Settings}
                 ].map(tab => (
                     <button 
                        key={tab.id} 
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm whitespace-nowrap transition-all ${activeTab === tab.id ? 'bg-padel-court text-white shadow-lg scale-105' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                     >
                         <tab.icon size={16}/> {tab.label}
                     </button>
                 ))}
             </div>

             {/* MATCHES VIEW */}
             {activeTab === 'MATCHES' && (
                 <div className="space-y-6">
                     {Object.entries(rounds).map(([round, matches]) => (
                         <div key={round} className="bg-slate-800/80 rounded-xl p-4 border border-slate-700 shadow-xl">
                             <div className="flex items-center gap-2 mb-4 border-b border-slate-700 pb-2">
                                 <span className="bg-padel-court text-white text-xs font-bold px-2 py-1 rounded">ROUND {round}</span>
                             </div>
                             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                 {(matches as Match[]).map(m => (
                                     <MatchCard 
                                        key={m.id} 
                                        match={m} 
                                        teams={tournament.teams} 
                                        onUpdateMatch={(data) => handleMatchUpdate(m.id, data)} 
                                        mode={tournament.config.mode}
                                        onShowH2H={(tA, tB) => setH2hTeams({tA, tB})}
                                     />
                                 ))}
                             </div>
                         </div>
                     ))}
                 </div>
             )}

             {/* CALENDAR VIEW */}
             {activeTab === 'CALENDAR' && (
                 <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 overflow-hidden">
                     <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-slate-300">
                            <thead className="bg-slate-900 text-slate-400 uppercase text-xs">
                                <tr>
                                    <th className="p-3">Data/Ora</th>
                                    <th className="p-3">Fase</th>
                                    <th className="p-3">Campo</th>
                                    <th className="p-3 text-center">Incontro</th>
                                    <th className="p-3 text-right">Risultato</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700">
                                {allMatchesSorted.map(m => {
                                    const tA = tournament.teams.find(t => t.id === m.teamAId);
                                    const tB = tournament.teams.find(t => t.id === m.teamBId);
                                    
                                    // Helpers to display players (pairs) instead of just Team Names if possible
                                    const getPlayers = (ids: string[] | undefined, team: Team | undefined) => {
                                        if(ids && ids.length > 0) return ids.map(pid => tournament.teams.find(t => t.id === pid)?.name || pid).join(' / ');
                                        return team?.players.join(' / ') || '';
                                    };
                                    
                                    let labelA = tA?.name || 'TBD';
                                    let subA = getPlayers(m.playersAIds, tA);
                                    let labelB = tB?.name || 'TBD';
                                    let subB = getPlayers(m.playersBIds, tB);

                                    // FIX LOGIC: 
                                    // 1. If Americano, title should be the Pair, not "Mix" or empty.
                                    // 2. If Singles, sub-label is same as title, so hide sub-label.
                                    if (isAmericano) {
                                        labelA = subA;
                                        subA = ''; // Hide sub
                                        labelB = subB;
                                        subB = '';
                                    } else {
                                        // Avoid duplication for Singles or auto-named teams
                                        if (subA === labelA) subA = '';
                                        if (subB === labelB) subB = '';
                                    }
                                    
                                    // CHECK IF REALLY PLAYED (Not 0-0)
                                    const totalGames = m.score ? (m.score.set1.a + m.score.set1.b + m.score.set2.a + m.score.set2.b + (m.score.set3 ? m.score.set3.a + m.score.set3.b : 0)) : 0;
                                    const isEffectivePlayed = m.played && m.score && totalGames > 0;

                                    return (
                                        <tr key={m.id} className="hover:bg-slate-700/50">
                                            <td className="p-3 whitespace-nowrap">
                                                <div className="flex flex-col">
                                                    <span className="text-white font-bold">{m.date ? new Date(m.date).toLocaleDateString() : '-'}</span>
                                                    <span className="text-[10px] text-slate-500">{m.date ? new Date(m.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}</span>
                                                </div>
                                            </td>
                                            <td className="p-3"><span className="bg-slate-700 px-2 py-1 rounded text-xs">Round {m.round}</span></td>
                                            <td className="p-3"><span className="text-xs text-padel-court font-bold">{m.court || 'Non ass.'}</span></td>
                                            <td className="p-3 text-center">
                                                <div className="flex flex-col gap-2">
                                                    <div className="flex flex-col items-center">
                                                        <span className="text-white font-bold text-sm">{labelA}</span>
                                                        {subA && <span className="text-[11px] text-slate-400">{subA}</span>}
                                                    </div>
                                                    <span className="text-[10px] text-slate-600 font-bold">VS</span>
                                                    <div className="flex flex-col items-center">
                                                        <span className="text-white font-bold text-sm">{labelB}</span>
                                                        {subB && <span className="text-[11px] text-slate-400">{subB}</span>}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-3 text-right">
                                                {isEffectivePlayed && m.score ? (
                                                    <span className="font-mono text-white bg-green-900/50 border border-green-700/50 px-2 py-1 rounded inline-flex items-center gap-2">
                                                        <span>{m.score.set1.a}-{m.score.set1.b}</span>
                                                        <span>|</span>
                                                        <span>{m.score.set2.a}-{m.score.set2.b}</span>
                                                        {(m.score.set3 && (m.score.set3.a > 0 || m.score.set3.b > 0)) && (
                                                            <>
                                                                <span>|</span>
                                                                <span className="text-green-400 font-extrabold">{m.score.set3.a}-{m.score.set3.b}</span>
                                                            </>
                                                        )}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-500 italic text-xs">Da giocare</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                     </div>
                 </div>
             )}

             {/* STANDINGS VIEW */}
             {activeTab === 'STANDINGS' && (
                 <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 overflow-hidden">
                    <div className="flex justify-end mb-4">
                        <button onClick={() => copyStandingsToClipboard(stats, tournament.teams)} className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded text-xs font-bold shadow transition-transform hover:scale-105">
                            <Copy size={14} /> Copia per WhatsApp
                        </button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-slate-300">
                            <thead className="bg-slate-900 text-slate-400 uppercase text-xs">
                                <tr>
                                    <th className="p-3">Pos</th>
                                    <th className="p-3">Squadra</th>
                                    <th className="p-3 text-center">Pt</th>
                                    <th className="p-3 text-center">G</th>
                                    <th className="p-3 text-center">V</th>
                                    <th className="p-3 text-center">P</th>
                                    <th className="p-3 text-center hidden sm:table-cell">Set</th>
                                    <th className="p-3 text-center hidden sm:table-cell">Game</th>
                                    <th className="p-3 text-center">Diff</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700">
                                {stats.map((s, idx) => {
                                    const team = tournament.teams.find(t => t.id === s.teamId);
                                    const diff = s.gamesWon - s.gamesLost;
                                    return (
                                        <tr key={s.teamId} className={`hover:bg-slate-700/50 ${idx < 3 ? 'bg-slate-700/20' : ''}`}>
                                            <td className="p-3 font-bold">
                                                {idx === 0 && <span className="text-yellow-400 text-lg">🥇</span>}
                                                {idx === 1 && <span className="text-slate-300 text-lg">🥈</span>}
                                                {idx === 2 && <span className="text-amber-600 text-lg">🥉</span>}
                                                {idx > 2 && <span className="text-slate-500 ml-2">{idx + 1}</span>}
                                            </td>
                                            <td className="p-3 font-medium text-white">
                                                {team?.name || 'N/A'}
                                                {team?.captain && <span className="block text-[10px] text-slate-500">Cap: {team.captain}</span>}
                                            </td>
                                            <td className="p-3 text-center font-bold text-white text-lg">{s.points}</td>
                                            <td className="p-3 text-center">{s.played}</td>
                                            <td className="p-3 text-center text-green-400">{s.won}</td>
                                            <td className="p-3 text-center text-red-400">{s.lost}</td>
                                            <td className="p-3 text-center hidden sm:table-cell text-xs">{s.setsWon}-{s.setsLost}</td>
                                            <td className="p-3 text-center hidden sm:table-cell text-xs">{s.gamesWon}-{s.gamesLost}</td>
                                            <td className={`p-3 text-center font-bold ${diff > 0 ? 'text-green-400' : diff < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                                                {diff > 0 ? '+' : ''}{diff}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                 </div>
             )}

             {/* BRACKET VIEW */}
             {activeTab === 'BRACKET' && (
                 <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                     <PlayoffBracket teams={tournament.teams} stats={stats} config={tournament.config} />
                 </div>
             )}

             {/* PLAYER STATS VIEW */}
             {activeTab === 'STATS' && (
                 <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 overflow-hidden relative">
                    {selectedPlayerForCard && (
                        <PlayerFUTCard 
                            player={selectedPlayerForCard.player} 
                            rank={selectedPlayerForCard.rank} 
                            image={registryPlayers.find(rp => rp.name === selectedPlayerForCard.player.name)?.image}
                            side={registryPlayers.find(rp => rp.name === selectedPlayerForCard.player.name)?.side}
                            nickname={registryPlayers.find(rp => rp.name === selectedPlayerForCard.player.name)?.nickname}
                            onImageUpload={(img) => onUpdatePlayerImage(selectedPlayerForCard.player.name, img)}
                            onClose={() => setSelectedPlayerForCard(null)} 
                        />
                    )}

                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-slate-300">
                            <thead className="bg-slate-900 text-slate-400 uppercase text-xs">
                                <tr>
                                    <th className="p-3">Rank</th>
                                    <th className="p-3">Giocatore</th>
                                    <th className="p-3 text-center text-padel-court">Pt</th>
                                    <th className="p-3 text-center">Match</th>
                                    <th className="p-3 text-center">Win %</th>
                                    <th className="p-3 text-center hidden sm:table-cell">Set +/-</th>
                                    <th className="p-3 text-center hidden sm:table-cell">Game +/-</th>
                                    <th className="p-3 text-center">Forma</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700">
                                {playerStats.map((p, idx) => {
                                    const streak = streaks.find(s => s.name === p.name);
                                    return (
                                        <tr 
                                            key={p.name} 
                                            className="hover:bg-slate-700/50 cursor-pointer group transition-colors"
                                            onClick={() => setSelectedPlayerForCard({player: p, rank: idx + 1})}
                                            title="Clicca per vedere la carta giocatore"
                                        >
                                            <td className="p-3 text-slate-500 text-center">{idx + 1}</td>
                                            <td className="p-3 font-bold text-white group-hover:text-padel-court transition-colors flex items-center gap-2">
                                                {p.name}
                                                <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-yellow-400 text-black text-[9px] font-bold px-1 rounded">CARD</div>
                                            </td>
                                            <td className="p-3 text-center font-bold text-padel-court text-lg">{p.points}</td>
                                            <td className="p-3 text-center">{p.played}</td>
                                            <td className="p-3 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <div className="w-16 h-2 bg-slate-700 rounded-full overflow-hidden">
                                                        <div className="h-full bg-padel-court" style={{ width: `${p.winRate}%` }}></div>
                                                    </div>
                                                    <span className="text-xs">{p.winRate.toFixed(0)}%</span>
                                                </div>
                                            </td>
                                            <td className="p-3 text-center hidden sm:table-cell">{(p.setsWon - p.setsLost) > 0 ? '+' : ''}{p.setsWon - p.setsLost}</td>
                                            <td className="p-3 text-center hidden sm:table-cell">{(p.gamesWon - p.gamesLost) > 0 ? '+' : ''}{p.gamesWon - p.gamesLost}</td>
                                            <td className="p-3 text-center">
                                                <div className="flex gap-1 justify-center">
                                                    {streak?.recent.map((r, i) => (
                                                        <span key={i} className={`w-2 h-2 rounded-full ${r === 'W' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                                    ))}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                 </div>
             )}

            {/* PRO STATS VIEW */}
            {activeTab === 'PRO' && (
                <div className="space-y-8 animate-fade-in">
                    
                    {/* 1. SPECIAL METRICS GRID */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {/* BAGEL FACTORY */}
                        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                            <h4 className="text-slate-400 text-xs font-bold uppercase mb-2 flex items-center gap-2"><Target size={14} className="text-red-400"/> Specialisti 6-0 (Bagel)</h4>
                            {[...playerStats]
                                .sort((a,b) => {
                                    if(b.bagels !== a.bagels) return b.bagels - a.bagels;
                                    return a.played - b.played; // Less matches = better efficiency
                                })
                                .filter(p => p.bagels > 0)
                                .slice(0,3)
                                .map((p,i) => (
                                <div key={i} className="flex justify-between text-sm py-1 border-b border-slate-700/50 last:border-0">
                                    <span className="text-white flex items-center gap-1">{p.name} <span className="text-[9px] text-slate-500">(su {p.played})</span></span>
                                    <span className="text-padel-court font-bold">{p.bagels}</span> 
                                </div>
                            ))}
                        </div>
                        {/* TIE BREAK KINGS */}
                        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                            <h4 className="text-slate-400 text-xs font-bold uppercase mb-2 flex items-center gap-2"><Crosshair size={14} className="text-blue-400"/> Re del Tie-Break</h4>
                            {[...playerStats]
                                .sort((a,b) => {
                                    if(b.tieBreaksWon !== a.tieBreaksWon) return b.tieBreaksWon - a.tieBreaksWon;
                                    return a.played - b.played;
                                })
                                .filter(p => p.tieBreaksWon > 0)
                                .slice(0,3)
                                .map((p,i) => (
                                <div key={i} className="flex justify-between text-sm py-1 border-b border-slate-700/50 last:border-0">
                                    <span className="text-white flex items-center gap-1">{p.name} <span className="text-[9px] text-slate-500">(su {p.played})</span></span>
                                    <span className="text-blue-400 font-bold">{p.tieBreaksWon}</span>
                                </div>
                            ))}
                        </div>
                        {/* COMEBACK KIDS */}
                        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                            <h4 className="text-slate-400 text-xs font-bold uppercase mb-2 flex items-center gap-2"><RotateCcw size={14} className="text-green-400"/> Maestri della Rimonta</h4>
                            {[...playerStats]
                                .sort((a,b) => {
                                    if(b.comebacks !== a.comebacks) return b.comebacks - a.comebacks;
                                    return a.played - b.played;
                                })
                                .filter(p => p.comebacks > 0)
                                .slice(0,3)
                                .map((p,i) => (
                                <div key={i} className="flex justify-between text-sm py-1 border-b border-slate-700/50 last:border-0">
                                    <span className="text-white flex items-center gap-1">{p.name} <span className="text-[9px] text-slate-500">(su {p.played})</span></span>
                                    <span className="text-green-400 font-bold">{p.comebacks}</span>
                                </div>
                            ))}
                        </div>
                        {/* WINNING STREAK BEASTS */}
                        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                            <h4 className="text-slate-400 text-xs font-bold uppercase mb-2 flex items-center gap-2"><Flame size={14} className="text-orange-500"/> Winning Streak</h4>
                            {[...streaks]
                                .sort((a,b) => {
                                    if(b.maxWin !== a.maxWin) return b.maxWin - a.maxWin;
                                    const pA = playerStats.find(p => p.name === a.name);
                                    const pB = playerStats.find(p => p.name === b.name);
                                    return (pA?.played || 0) - (pB?.played || 0);
                                })
                                .filter(s => s.maxWin > 0)
                                .slice(0,3)
                                .map((s,i) => {
                                    const p = playerStats.find(ps => ps.name === s.name);
                                    return (
                                        <div key={i} className="flex justify-between text-sm py-1 border-b border-slate-700/50 last:border-0">
                                            <span className="text-white flex items-center gap-1">{s.name} <span className="text-[9px] text-slate-500">(su {p?.played || 0})</span></span>
                                            <span className="text-orange-500 font-bold">{s.maxWin}</span>
                                        </div>
                                    )
                                })}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* BEST PAIRS */}
                        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 overflow-hidden h-full">
                            <h3 className="text-white font-bold mb-4 flex items-center gap-2"><Users size={18} className="text-teal-400"/> Migliori Coppie</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm text-slate-300">
                                    <thead className="bg-slate-900 text-slate-400 uppercase text-xs">
                                        <tr>
                                            <th className="p-2">Coppia</th>
                                            <th className="p-2 text-center">G</th>
                                            <th className="p-2 text-center">V</th>
                                            <th className="p-2 text-center">% Vitt.</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-700">
                                        {pairStats.slice(0, 10).map((p, idx) => (
                                            <tr key={idx} className="hover:bg-slate-700/50">
                                                <td className="p-2 text-white font-medium">{p.p1} & {p.p2}</td>
                                                <td className="p-2 text-center text-xs">{p.played}</td>
                                                <td className="p-2 text-center text-xs text-green-400">{p.won}</td>
                                                <td className="p-2 text-center font-bold text-padel-court">{p.winRate.toFixed(0)}%</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* ATTACK VS DEFENSE */}
                        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 overflow-hidden h-full">
                            <h3 className="text-white font-bold mb-4 flex items-center gap-2"><Swords size={18} className="text-red-400"/> Attacco & Difesa</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm text-slate-300">
                                    <thead className="bg-slate-900 text-slate-400 uppercase text-xs">
                                        <tr>
                                            <th className="p-2">Giocatore</th>
                                            <th className="p-2 text-center text-blue-300" title="Game Vinti per Match">Atk</th>
                                            <th className="p-2 text-center text-red-300" title="Game Persi per Match">Dif</th>
                                            <th className="p-2 text-center">Netto</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-700">
                                        {[...playerStats]
                                            .filter(p => p.played > 0) // ADDED FILTER
                                            .sort((a, b) => b.avgGameDiff - a.avgGameDiff) // Sort by Best Net Diff
                                            .slice(0, 10).map((p, idx) => (
                                            <tr key={idx} className="hover:bg-slate-700/50">
                                                <td className="p-2 text-white">{p.name}</td>
                                                <td className="p-2 text-center text-blue-400">{(p.gamesWon / Math.max(1, p.played)).toFixed(1)}</td>
                                                <td className="p-2 text-center text-red-400">{(p.gamesLost / Math.max(1, p.played)).toFixed(1)}</td>
                                                <td className={`p-2 text-center font-bold ${p.avgGameDiff > 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                    {p.avgGameDiff > 0 ? '+' : ''}{p.avgGameDiff.toFixed(1)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* COURT ANALYSIS */}
                    <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                         <h3 className="text-white font-bold mb-4 flex items-center gap-2"><MapPin size={18} className="text-purple-400"/> Analisi Campi</h3>
                         <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                            {['Olimpionica', 'M&T', 'Centrale'].map(court => {
                                const courtMatches = tournament.matches.filter(m => m.court === court && m.played);
                                const totalGames = courtMatches.reduce((acc, m) => {
                                    if (!m.score) return acc;
                                    return acc + (m.score.set1.a + m.score.set1.b) + 
                                           (m.score.set2.a + m.score.set2.b) + 
                                           (m.score.set3 ? m.score.set3.a + m.score.set3.b : 0);
                                }, 0);
                                const avgGames = courtMatches.length ? (totalGames / courtMatches.length).toFixed(1) : '0';
                                return (
                                    <div key={court} className="bg-slate-900 p-3 rounded border border-slate-700 flex justify-between items-center">
                                        <div>
                                            <span className="text-white font-bold block">{court}</span>
                                            <span className="text-xs text-slate-500">{courtMatches.length} Partite</span>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-xl font-bold text-white">{avgGames}</span>
                                            <span className="text-xl font-bold text-white">{avgGames}</span>
                                            <span className="text-[10px] text-slate-400 block uppercase">Media Game</span>
                                        </div>
                                    </div>
                                )
                            })}
                         </div>
                    </div>
                </div>
            )}

            {/* AI ANALYSIS VIEW */}
            {activeTab === 'ANALYSIS' && (
                <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-xl">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                         <div>
                             <h3 className="text-white text-xl font-bold flex items-center gap-2"><Zap size={24} className="text-yellow-400"/> Analisi Tecnica IA</h3>
                             <p className="text-slate-400 text-sm mt-1">Report professionale generato da Intelligenza Artificiale basato sui dati del torneo.</p>
                         </div>
                         <button onClick={generateAI} disabled={loadingAi} className="bg-padel-court hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-bold shadow-lg disabled:opacity-50 transition-all flex items-center gap-2">
                             {loadingAi ? <RefreshCw className="animate-spin" /> : <Zap size={18} />} Genera Nuovo Report
                         </button>
                    </div>
                    
                    {aiReport ? (
                        <div className="bg-slate-900/50 p-6 rounded-lg border border-slate-700 text-slate-300 leading-relaxed whitespace-pre-line shadow-inner">
                            {aiReport}
                        </div>
                    ) : (
                        <div className="text-center py-12 text-slate-500 bg-slate-900/30 rounded-lg border border-slate-700/50 border-dashed">
                            <Zap size={48} className="mx-auto mb-4 opacity-20" />
                            <p>Clicca "Genera Nuovo Report" per ottenere un'analisi tecnica dettagliata.</p>
                        </div>
                    )}
                </div>
            )}

            {/* TEAMS EDIT VIEW */}
            {activeTab === 'TEAMS' && (
                <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-xl">
                     <h3 className="text-white font-bold mb-6 flex items-center gap-2"><Users2 size={24} className="text-green-400"/> Gestione Squadre</h3>
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {tournament.teams.map(team => {
                            const isEditing = editingTeamId === team.id;
                            return (
                                <div key={team.id} className="bg-slate-700 p-4 rounded-lg border border-slate-600">
                                    {isEditing ? (
                                        <div className="flex flex-col gap-3">
                                            <div className="space-y-1">
                                                <label className="text-[10px] uppercase text-slate-400 font-bold">Nome Squadra</label>
                                                <input 
                                                    value={editTeamName}
                                                    onChange={e => setEditTeamName(e.target.value)}
                                                    className="w-full bg-slate-900 border border-slate-500 rounded px-2 py-1.5 text-white text-sm"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[10px] uppercase text-slate-400 font-bold">Capitano</label>
                                                <select 
                                                    value={editTeamCaptain}
                                                    onChange={e => setEditTeamCaptain(e.target.value)}
                                                    className="w-full bg-slate-900 border border-slate-500 rounded px-2 py-1.5 text-white text-sm"
                                                >
                                                    {team.players.map(p => <option key={p} value={p}>{p}</option>)}
                                                </select>
                                            </div>
                                            <div className="flex justify-end gap-2 mt-2">
                                                <button onClick={() => setEditingTeamId(null)} className="p-2 bg-slate-600 rounded text-slate-300 hover:text-white"><X size={16}/></button>
                                                <button onClick={handleUpdateTeam} className="p-2 bg-green-600 rounded text-white hover:bg-green-500"><Save size={16}/></button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h4 className="font-bold text-white text-lg">{team.name}</h4>
                                                <div className="text-xs text-slate-400 mt-1 space-y-1">
                                                    <p><span className="text-slate-500">Capitano:</span> <span className="text-yellow-400 font-bold">{team.captain || '-'}</span></p>
                                                    <p><span className="text-slate-500">Giocatori:</span> {team.players.join(', ')}</p>
                                                </div>
                                            </div>
                                            <button onClick={() => startEditingTeam(team)} className="bg-slate-800 p-2 rounded-full text-slate-400 hover:text-white hover:bg-blue-600 transition-colors">
                                                <Edit3 size={16} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                     </div>
                </div>
            )}

            {/* SETTINGS VIEW (NEW) */}
            {activeTab === 'SETTINGS' && (
                <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-xl animate-fade-in">
                    <h3 className="text-white font-bold mb-6 flex items-center gap-2"><Settings size={24} className="text-slate-400"/> Opzioni Torneo (Admin)</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Playoff Settings */}
                        <div className="bg-slate-900/50 p-6 rounded-lg border border-slate-700">
                             <h4 className="text-white font-bold mb-4 flex items-center gap-2"><GitGraph size={20} className="text-padel-court"/> Struttura Playoff</h4>
                             <p className="text-slate-400 text-sm mb-4">Modifica quante squadre accedono alla fase finale. Il tabellone si aggiornerà automaticamente.</p>
                             
                             <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase">Configurazione Attuale</label>
                                <select 
                                    value={tournament.config.playoffTeams} 
                                    onChange={(e) => handleUpdatePlayoffConfig(Number(e.target.value))}
                                    className="w-full bg-slate-800 border border-slate-600 rounded text-white p-3 focus:ring-1 focus:ring-padel-court"
                                    disabled={tournament.config.mode === 'AMERICANO'}
                                >
                                    <option value={0}>Nessun Playoff (Solo Classifica)</option>
                                    <option value={2}>Finale Secca (Top 2)</option>
                                    <option value={4}>Semifinali + Finale (Top 4)</option>
                                    <option value={6}>Top 6 (1°-2° Bye)</option>
                                    <option value={8}>Quarti + Semi + Finale (Top 8)</option>
                                    <option value={-1}>Tutti ai Playoff</option>
                                </select>
                             </div>
                        </div>

                        {/* Schedule Settings */}
                        <div className="bg-slate-900/50 p-6 rounded-lg border border-slate-700">
                             <h4 className="text-white font-bold mb-4 flex items-center gap-2"><Calendar size={20} className="text-blue-400"/> Formato Partite</h4>
                             <p className="text-slate-400 text-sm mb-4">Gestisci la durata del torneo aggiungendo o rimuovendo il girone di ritorno.</p>
                             
                             <div className="flex items-center justify-between bg-slate-800 p-4 rounded border border-slate-600">
                                 <div>
                                     <span className="text-white font-bold block">Andata e Ritorno</span>
                                     <span className="text-xs text-slate-500">
                                         {tournament.config.doubleRound 
                                            ? "Attivo: Il calendario include il ritorno." 
                                            : "Disattivo: Solo girone di andata."}
                                     </span>
                                 </div>
                                 
                                 {tournament.config.mode !== 'AMERICANO' && (
                                     <button 
                                        onClick={handleToggleDoubleRound}
                                        className={`px-4 py-2 rounded font-bold text-sm transition-colors flex items-center gap-2 ${tournament.config.doubleRound ? 'bg-red-900/50 text-red-300 border border-red-800 hover:bg-red-800' : 'bg-green-600 hover:bg-green-500 text-white shadow-lg'}`}
                                     >
                                         {tournament.config.doubleRound ? <Minus size={16}/> : <Plus size={16}/>}
                                         {tournament.config.doubleRound ? "Rimuovi Ritorno" : "Aggiungi Ritorno"}
                                     </button>
                                 )}
                             </div>
                             {tournament.config.doubleRound && (
                                 <div className="mt-3 flex items-start gap-2 p-2 bg-yellow-900/20 text-yellow-500 text-xs rounded border border-yellow-800/30">
                                     <AlertTriangle size={14} className="shrink-0 mt-0.5"/>
                                     <span>Attenzione: Rimuovendo il ritorno, tutte le partite del girone di ritorno <strong>non ancora giocate</strong> verranno eliminate definitivamente.</span>
                                 </div>
                             )}
                        </div>
                    </div>
                </div>
            )}

            {/* H2H MODAL */}
            {h2hTeams && (
                <HeadToHeadModal 
                    teamA={h2hTeams.tA} 
                    teamB={h2hTeams.tB} 
                    stats={stats} 
                    onClose={() => setH2hTeams(null)} 
                />
            )}
        </div>
    );
};

// --- MAIN APP ---

export default function App() {
  const [logo, setLogo] = useState<string | null>(localStorage.getItem('padelLogo'));
  
  // Registry State - LIFTED UP
  const [registryPlayers, setRegistryPlayers] = useState<RegistryPlayer[]>(() => {
      const raw = safeJSONParse('padelRegistryDraft', []);
      if (raw.length > 0 && typeof raw[0] === 'string') {
          // Migration: Convert old strings to objects
          return (raw as unknown as string[]).map(name => ({ name, tier: 3 }));
      }
      return raw;
  });

  // Active tournament state
  const [activeTournament, setActiveTournament] = useState<{
      id: string,
      config: TournamentConfig,
      teams: Team[],
      matches: Match[],
      startDate: string,
      name: string
  } | null>(() => safeJSONParse('padelActiveTournament', null));

  // Archives state
  const [archives, setArchives] = useState<TournamentArchive[]>(() => safeJSONParse('padelArchives', []));

  useEffect(() => {
      // Persist registry changes
      localStorage.setItem('padelRegistryDraft', JSON.stringify(registryPlayers));
  }, [registryPlayers]);

  useEffect(() => {
      if (activeTournament) {
          localStorage.setItem('padelActiveTournament', JSON.stringify(activeTournament));
      }
  }, [activeTournament]);

  useEffect(() => {
      localStorage.setItem('padelArchives', JSON.stringify(archives));
  }, [archives]);

  const updatePlayerImage = (name: string, img: string) => {
      setRegistryPlayers(prev => prev.map(p => p.name === name ? {...p, image: img} : p));
  };

  const handleStart = (teams: Team[], config: TournamentConfig) => {
    const schedule = generateSchedule(teams, config.doubleRound, config.mode);
    const newTournament = {
        id: generateId(),
        config,
        teams,
        matches: schedule,
        startDate: new Date().toISOString(),
        name: config.name
    };
    setActiveTournament(newTournament);
  };
  
  const handleArchive = () => {
      if (!activeTournament) return;
      if (!confirm("Sei sicuro di voler archiviare il torneo corrente? Verrà salvato nello storico e potrai iniziarne uno nuovo.")) return;

      const archive: TournamentArchive = {
          id: activeTournament.id,
          date: activeTournament.startDate,
          name: activeTournament.name,
          config: activeTournament.config,
          teams: activeTournament.teams,
          matches: activeTournament.matches
      };
      
      setArchives([archive, ...archives]);
      localStorage.removeItem('padelActiveTournament'); // Explicitly clear from storage
      setActiveTournament(null);
  };

  const handleResume = () => {
      const saved = safeJSONParse('padelActiveTournament', null);
      if (saved) {
          setActiveTournament(saved);
      } else {
          alert("Nessun torneo salvato trovato.");
      }
  };

  const handleLoadArchive = (archive: TournamentArchive) => {
      if (activeTournament) {
          if (!confirm("C'è un torneo attivo. Caricando un archivio, i progressi non salvati del torneo corrente andranno persi. Vuoi procedere?")) return;
      }
      setActiveTournament({
          id: archive.id,
          config: archive.config,
          teams: archive.teams,
          matches: archive.matches,
          startDate: archive.date,
          name: archive.name
      });
  };

  const handleDeleteArchive = (id: string) => {
      if (confirm("Eliminare definitivamente questo torneo dall'archivio?")) {
          setArchives(archives.filter(a => a.id !== id));
      }
  };

  const handleImportTournament = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (ev) => {
          try {
              const content = ev.target?.result as string;
              const data = JSON.parse(content);
              // Basic validation
              if (data.config && data.teams && data.matches) {
                  if (activeTournament && !confirm("Sovrascrivere il torneo corrente?")) return;
                  
                  // IMPORT LOGO if present
                  if (data.logo) {
                      setLogo(data.logo);
                      localStorage.setItem('padelLogo', data.logo);
                  }

                  // IMPORT REGISTRY (Merge images)
                  if (data.registryPlayers && Array.isArray(data.registryPlayers)) {
                      setRegistryPlayers(prev => {
                          const newRegistry = [...prev];
                          data.registryPlayers.forEach((importedP: RegistryPlayer) => {
                              const existingIdx = newRegistry.findIndex(p => p.name === importedP.name);
                              if (existingIdx >= 0) {
                                  if (importedP.image) {
                                      newRegistry[existingIdx] = { ...newRegistry[existingIdx], image: importedP.image };
                                  }
                                  if (importedP.side) {
                                      newRegistry[existingIdx] = { ...newRegistry[existingIdx], side: importedP.side };
                                  }
                                  if (importedP.nickname) {
                                      newRegistry[existingIdx] = { ...newRegistry[existingIdx], nickname: importedP.nickname };
                                  }
                              } else {
                                  newRegistry.push(importedP);
                              }
                          });
                          return newRegistry;
                      });
                  }

                  setActiveTournament({
                      id: generateId(),
                      config: data.config,
                      teams: data.teams,
                      matches: data.matches,
                      startDate: new Date().toISOString(),
                      name: data.config.name || "Torneo Importato"
                  });
              } else {
                  alert("Formato file non valido.");
              }
          } catch (err) {
              alert("Errore durante l'importazione.");
          }
      };
      reader.readAsText(file);
      e.target.value = '';
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
          const reader = new FileReader();
          reader.onloadend = () => {
              const base64 = reader.result as string;
              setLogo(base64);
              localStorage.setItem('padelLogo', base64);
          };
          reader.readAsDataURL(file);
      }
  };

  // Check LocalStorage directly for the Resume button name, 
  // because activeTournament state is null when in SetupScreen
  const savedTournament = safeJSONParse<{name: string}>('padelActiveTournament', null as any);
  const savedTournamentName = savedTournament ? savedTournament.name : undefined;

  // GENERATE NEWS HEADLINES LOGIC
  const newsItems = useMemo(() => {
      if (!activeTournament) {
          return [
              "BENVENUTI AL SULMONA PADEL CLUB MANAGER",
              "CREA NUOVO TORNEO PER INIZIARE",
              "GESTISCI ALBO GIOCATORI E STATISTICHE AVANZATE",
              "IMPORTA/ESPORTA I TUOI DATI",
              "BUON PADEL A TUTTI!"
          ];
      }

      const { teams, matches, config, name } = activeTournament;
      const stats = calculateStats(teams, matches, config.mode);
      const playerStats = calculatePlayerRankings(teams, matches);
      
      const headlines: string[] = [`TORNEO LIVE: ${name.toUpperCase()}`];

      // 1. Leader
      if (stats.length > 0) {
          const leader = teams.find(t => t.id === stats[0].teamId);
          if (leader) headlines.push(`IN TESTA: ${leader.name} (${stats[0].points} PT)`);
      }

      // 2. Last Result
      const playedMatches = matches.filter(m => m.played && m.score).sort((a,b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0));
      if (playedMatches.length > 0) {
          const last = playedMatches[0];
          const tA = teams.find(t => t.id === last.teamAId)?.name || 'Team A';
          const tB = teams.find(t => t.id === last.teamBId)?.name || 'Team B';
          const s = last.score!;
          const scoreStr = `${s.set1.a}-${s.set1.b} ${s.set2.a}-${s.set2.b}` + (s.set3 ? ` ${s.set3.a}-${s.set3.b}` : '');
          headlines.push(`ULTIMO RISULTATO: ${tA} vs ${tB} [${scoreStr}]`);
      }

      // 3. Top Player (MVP)
      if (playerStats.length > 0) {
          headlines.push(`MVP ATTUALE: ${playerStats[0].name} (WR: ${playerStats[0].winRate.toFixed(0)}%)`);
      }

      // 4. Next Match
      const nextMatch = matches.find(m => !m.played);
      if (nextMatch) {
           const tA = teams.find(t => t.id === nextMatch.teamAId)?.name || 'Team A';
           const tB = teams.find(t => t.id === nextMatch.teamBId)?.name || 'Team B';
           headlines.push(`PROSSIMO INCONTRO: ${tA} vs ${tB} (R${nextMatch.round})`);
      } else if (playedMatches.length === matches.length && matches.length > 0) {
          headlines.push("TORNEO COMPLETATO - CONTROLLA LA CLASSIFICA FINALE");
      }

      return headlines;
  }, [activeTournament]);

  return (
    <div className="min-h-screen bg-slate-950 font-sans text-slate-100 selection:bg-padel-court selection:text-white">
      <Header 
        onGoHome={() => setActiveTournament(null)} 
        showHome={!!activeTournament} 
        logo={logo}
        onLogoUpload={handleLogoUpload}
      />

      <NewsTicker items={newsItems} />
      
      <main>
        {!activeTournament ? (
          <SetupScreen 
            onStart={handleStart} 
            onResume={handleResume}
            activeTournamentName={savedTournamentName} 
            archives={archives}
            onLoadArchive={handleLoadArchive}
            onDeleteArchive={handleDeleteArchive}
            onImportTournament={handleImportTournament}
            registryPlayers={registryPlayers}
            setRegistryPlayers={setRegistryPlayers}
          />
        ) : (
          <TournamentDashboard 
             tournament={activeTournament} 
             updateTournament={setActiveTournament}
             onArchive={handleArchive}
             registryPlayers={registryPlayers}
             onUpdatePlayerImage={updatePlayerImage}
             logo={logo}
          />
        )}
      </main>
    </div>
  );
}