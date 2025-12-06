
export interface Player {
  id: string;
  name: string;
}

export interface Team {
  id: string;
  name: string;
  players: string[]; // List of player names (1 for singles, 2 for doubles, N for squads)
  captain?: string; // Name of the captain
}

export interface MatchScore {
  set1: { a: number; b: number };
  set2: { a: number; b: number };
  set3?: { a: number; b: number }; // Tie-break or 3rd set
}

export interface Match {
  id: string;
  teamAId: string;
  teamBId: string;
  playersAIds?: string[]; // For Americano: explicit player IDs. For Teams: Selected players for this match
  playersBIds?: string[]; // For Americano: explicit player IDs. For Teams: Selected players for this match
  round: number;
  score: MatchScore | null;
  played: boolean;
  winnerId?: string;
  isPlayoff?: boolean;
  playoffLabel?: string;
  // Linking for playoffs
  nextMatchId?: string; 
  nextMatchSlot?: 'A' | 'B';
  // Scheduling details
  date?: string;
  court?: string;
}

export interface TeamStats {
  teamId: string;
  played: number;
  won: number;
  lost: number;
  points: number; // 3 for win
  setsWon: number;
  setsLost: number;
  gamesWon: number;
  gamesLost: number;
  winRate: number;
}

export interface PlayerStats {
  name: string;
  played: number;
  won: number;
  lost: number;
  points: number; // ADDED: 3 for Win, 1 for Loss
  setsWon: number;
  setsLost: number;
  gamesWon: number;
  gamesLost: number;
  // Proportional Stats
  winRate: number; // %
  avgSetDiff: number; // (SetsWon - SetsLost) / Played
  avgGameDiff: number; // (GamesWon - GamesLost) / Played
  
  // Advanced Pro Stats
  bagels: number; // Sets won 6-0
  tieBreaksWon: number; // Sets won 7-6 or 7-5
  comebacks: number; // Won match after losing 1st set
  threeSetMatches: number; // Matches played that went to 3rd set
}

export interface Streak {
  name: string;
  current: number; // > 0 winning streak, < 0 losing streak
  maxWin: number;
  maxLoss: number;
  recent: ('W' | 'L')[]; // Last 5 matches
}

export interface PairStats {
  p1: string;
  p2: string;
  played: number;
  won: number;
  lost: number;
  winRate: number;
}

export interface TournamentConfig {
  name: string;
  mode: 'SINGLES' | 'DOUBLES' | 'AMERICANO'; // Tournament mode
  teamSize: number; // Number of players per team (1, 2, 3, 4...)
  doubleRound: boolean; // Andata e ritorno
  playoffTeams: number; // 0, 2, 4, 8, 16... -1 for All
}
export interface TournamentArchive {
    id: string;
    date: string;
    name: string;
    config: TournamentConfig;
    teams: Team[];
    matches: Match[];
}
