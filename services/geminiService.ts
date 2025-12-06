import { GoogleGenAI } from "@google/genai";
import { Team, TeamStats, Match } from "../types";

const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
};

export const generateTournamentAnalysis = async (
  teams: Team[],
  stats: TeamStats[],
  matches: Match[]
): Promise<string> => {
  const client = getClient();
  if (!client) return "API Key mancante. Configura la chiave per l'analisi AI.";

  const playedMatches = matches.filter(m => m.played);
  if (playedMatches.length === 0) return "Dati insufficienti. Gioca le prime partite per generare il report tecnico.";

  // Serialize data for the prompt
  const standingsStr = stats
    .sort((a, b) => b.points - a.points)
    .map((s, i) => {
      const team = teams.find(t => t.id === s.teamId);
      const teamName = team?.name || 'Sconosciuto';
      
      // Format players list, marking the captain
      const players = team?.players.map(p => 
        p === team.captain ? `${p} (C)` : p
      ).join(' & ') || '';

      return `${i + 1}. ${teamName} [${players}] (Pt: ${s.points}, G: ${s.played}, V: ${s.won}, Diff: ${s.gamesWon - s.gamesLost})`;
    })
    .join('\n');

  const recentMatchesStr = playedMatches
    .slice(-5)
    .map(m => {
      const tA = teams.find(t => t.id === m.teamAId);
      const tB = teams.find(t => t.id === m.teamBId);
      const s = m.score;
      const scoreStr = s ? `${s.set1.a}-${s.set1.b}, ${s.set2.a}-${s.set2.b}` : '';
      return `${tA?.name} vs ${tB?.name}: ${scoreStr}`;
    })
    .join('\n');

  const prompt = `
    Agisci come un analista sportivo professionista specializzato nel Padel.
    Redigi un bollettino tecnico ufficiale sull'andamento del torneo, basandoti sui seguenti dati statistici:
    
    Classifica e Statistiche Squadre:
    ${standingsStr}

    Match Recenti:
    ${recentMatchesStr}

    Linee guida per il report:
    1. **Tono**: Formale, giornalistico e oggettivo. Evita assolutamente slang o espressioni colloquiali.
    2. **Analisi Prestazionale**: Evidenzia la solidità delle coppie di testa, citando punti di forza (es. "continuità di rendimento", "differenza game notevole").
    3. **Competitività**: Analizza l'equilibrio del torneo basandoti sui punteggi (es. "vittorie nette" vs "match combattuti all'ultimo set").
    4. **Terminologia**: Usa un linguaggio tecnico appropriato al contesto (es. "dominio territoriale", "cinismo nei punti chiave", "solidità difensiva").
    5. **Sintesi**: Mantieni l'analisi concisa (max 180 parole) ma densa di informazioni rilevanti.
  `;

  try {
    const response = await client.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    return response.text || "Report non disponibile.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Servizio di analisi momentaneamente non disponibile (Errore connessione).";
  }
};
