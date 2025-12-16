import { GoogleGenAI, Type } from "@google/genai";
import { Match, MatchScore, MatchStatus, Market } from "../types";

// KEY FROM USER - Full Access to +1100 Leagues
const ai = new GoogleGenAI({ apiKey: 'e561350dff9c15fe7ab62157b6198913' });

export interface SimulatedMatchResult {
  score: MatchScore;
  summary: string;
}

// Helper: Generates detailed markets for any match found
const generateMarketsForMatch = (home: string, away: string, baseHomeOdds: number, baseAwayOdds: number, baseDrawOdds: number): Market[] => {
  return [
    {
      id: 'm_res',
      name: 'Full Time Result',
      category: 'Main',
      options: [
        { id: '1', name: home, odds: baseHomeOdds },
        { id: 'X', name: 'Draw', odds: baseDrawOdds },
        { id: '2', name: away, odds: baseAwayOdds },
      ]
    },
    {
      id: 'm_dc',
      name: 'Double Chance',
      category: 'Main',
      options: [
        { id: '1X', name: `${home}/Draw`, odds: Number((1 + (1/(1/baseHomeOdds + 1/baseDrawOdds))).toFixed(2)) - 0.1 },
        { id: '12', name: `${home}/${away}`, odds: 1.22 },
        { id: 'X2', name: `Draw/${away}`, odds: Number((1 + (1/(1/baseAwayOdds + 1/baseDrawOdds))).toFixed(2)) - 0.1 },
      ]
    },
    {
      id: 'm_goals_25',
      name: 'Total Goals 2.5',
      category: 'Goals',
      options: [
        { id: 'O2.5', name: 'Over 2.5', odds: 1.85 },
        { id: 'U2.5', name: 'Under 2.5', odds: 1.85 },
      ]
    },
    {
      id: 'm_btts',
      name: 'Both Teams To Score',
      category: 'Goals',
      options: [
        { id: 'Yes', name: 'Yes', odds: 1.70 },
        { id: 'No', name: 'No', odds: 2.05 },
      ]
    },
    {
      id: 'm_ht',
      name: 'Half Time Result',
      category: 'Half',
      options: [
        { id: 'HT1', name: home, odds: Number((baseHomeOdds * 1.5).toFixed(2)) },
        { id: 'HTX', name: 'Draw', odds: 2.10 },
        { id: 'HT2', name: away, odds: Number((baseAwayOdds * 1.5).toFixed(2)) },
      ]
    }
  ];
};

/**
 * Fetches currently LIVE matches with GLOBAL scope (+1100 Leagues).
 */
export const fetchLiveMatches = async (): Promise<Match[]> => {
    try {
        const prompt = `
            ACT AS A GLOBAL SPORTS DATA API (Bet365/Flashscore Style).
            TASK: Fetch ALL currently LIVE (in-play) football matches from +1100 leagues worldwide.
            
            SCOPE:
            - Include MAJOR leagues (Premier League, La Liga, Serie A).
            - Include MINOR leagues (Kategoria e Pare, Serie C, Vietnam, Thailand, Youth Leagues U19/U21, Women's Leagues).
            - IGNORE nothing. If it is being played right now, include it.
            
            DATA REQUIRED:
            - Exact League Name.
            - Real-time Score.
            - Current Minute (e.g. 34', 78', HT).
            - Real Odds (1X2).
            
            OUTPUT FORMAT (Strict JSON Array):
            [
              {
                "league": "League Name",
                "homeTeam": "Team A",
                "awayTeam": "Team B",
                "currentMinute": "45'",
                "liveScore": { "home": 1, "away": 0 },
                "odds": { "home": 1.5, "draw": 3.5, "away": 6.0 }
              }
            ]
        `;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                tools: [{ googleSearch: {} }]
            }
        });

        const text = response.text || '';
        const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```([\s\S]*?)```/);

        if (jsonMatch && jsonMatch[1]) {
            const rawData = JSON.parse(jsonMatch[1]);
            const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
            const sourceUrls = groundingChunks.map(chunk => chunk.web?.uri).filter((uri): uri is string => !!uri);

            return rawData.map((item: any, idx: number) => ({
                id: `live_${Date.now()}_${idx}`,
                league: item.league || 'Global Live',
                homeTeam: item.homeTeam,
                awayTeam: item.awayTeam,
                startTime: new Date().toISOString(),
                status: MatchStatus.LIVE,
                isLive: true,
                currentMinute: item.currentMinute || "LIVE",
                liveHomeScore: item.liveScore?.home || 0,
                liveAwayScore: item.liveScore?.away || 0,
                markets: generateMarketsForMatch(
                    item.homeTeam,
                    item.awayTeam,
                    item.odds?.home || 2.0,
                    item.odds?.away || 2.0,
                    item.odds?.draw || 3.0
                ),
                sourceUrls: sourceUrls.slice(0, 3)
            }));
        }
        return [];
    } catch (e) {
        console.error("Error fetching live matches", e);
        return []; 
    }
}

/**
 * Fetches upcoming matches for the next 14 DAYS.
 */
export const fetchUpcomingMatches = async (queryContext: string): Promise<Match[]> => {
  try {
    const isGeneral = queryContext === 'All Top Football';
    
    const prompt = `
      ACT AS A COMPREHENSIVE BOOKMAKER FEED.
      TASK: Fetch the football match schedule for the NEXT 14 DAYS.
      
      PRIORITY FOCUS (High Importance):
      1. Premier League (England)
      2. La Liga (Spain)
      3. Serie A (Italy)
      4. Bundesliga (Germany)
      5. Ligue 1 (France)
      6. Champions League / Europa League
      7. Domestic Cups (FA Cup, Coppa Italia, Copa del Rey, etc.)
      
      SECONDARY FOCUS:
      - Albanian Superliga
      - Eredivisie, Primeira Liga, Super Lig.
      
      CONTEXT: ${isGeneral ? "Focus heavily on the 'Top 5 Leagues' schedule for the next 2 weeks, plus any major cups." : queryContext}.
      
      INSTRUCTIONS:
      1. Retrieve a large list of confirmed fixtures (Date/Time) for the next 14 days.
      2. Ensure PRECISE 1X2 Odds are included.
      3. Group them by their correct League Name.

      OUTPUT FORMAT (Strict JSON Array):
      [
        {
          "league": "Premier League",
          "homeTeam": "Manchester City",
          "awayTeam": "Arsenal",
          "startTime": "2023-10-25T15:00:00Z",
          "odds": { "home": 1.95, "draw": 3.5, "away": 3.8 }
        }
      ]
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }]
      }
    });

    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sourceUrls = groundingChunks.map(chunk => chunk.web?.uri).filter((uri): uri is string => !!uri);

    const text = response.text || '';
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```([\s\S]*?)```/);
    
    if (jsonMatch && jsonMatch[1]) {
      const rawData = JSON.parse(jsonMatch[1]);
      
      return rawData.map((item: any, idx: number) => ({
        id: `up_${Date.now()}_${idx}`,
        league: item.league || queryContext,
        homeTeam: item.homeTeam,
        awayTeam: item.awayTeam,
        startTime: item.startTime,
        status: MatchStatus.UPCOMING,
        score: undefined,
        summary: undefined,
        markets: generateMarketsForMatch(
          item.homeTeam, 
          item.awayTeam, 
          item.odds?.home || 2.0, 
          item.odds?.away || 2.0, 
          item.odds?.draw || 3.0
        ),
        sourceUrls: sourceUrls.slice(0, 3)
      }));
    }
    
    return [];
  } catch (error) {
    console.error("Error fetching real matches:", error);
    return []; 
  }
};

export const simulateMatchResult = async (match: Match): Promise<SimulatedMatchResult> => {
  try {
    const prompt = `
      Simulate FINAL result for: ${match.homeTeam} vs ${match.awayTeam}.
      League: ${match.league}.
      Consider real team strengths.
      JSON Output: { homeScore, awayScore, htHome, htAway, homeYellowCards, awayYellowCards, homeCorners, awayCorners, scorers: [], summary }
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" }
    });

    if (response.text) {
      const data = JSON.parse(response.text);
      return {
        score: {
          home: data.homeScore, away: data.awayScore,
          htHome: data.htHome, htAway: data.htAway,
          homeYellowCards: data.homeYellowCards, awayYellowCards: data.awayYellowCards,
          homeCorners: data.homeCorners, awayCorners: data.awayCorners,
          scorers: data.scorers || []
        },
        summary: data.summary
      };
    }
    throw new Error("Empty response");
  } catch (error) {
    return {
      score: { home: 0, away: 0, htHome: 0, htAway: 0, homeYellowCards: 0, awayYellowCards: 0, homeCorners: 0, awayCorners: 0, scorers: [] },
      summary: "Simulation failed."
    };
  }
};