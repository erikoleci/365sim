// Real label dictionary captured directly from the provider's socket
// connect-ack payload for ecco-p2p.socketi355.com:1338 (Engine.IO packet
// "40{...}" sent immediately on connect, before any "gamedetails" event).
// Not guessed — this is the verbatim JSON the provider itself sends.
//
// IMPORTANT — what this is and isn't:
// This is a STATIC i18n/label resource (event-type-key -> Albanian display
// text). It confirms the real names the provider uses internally for match
// events and stats (e.g. "Zoteron_topin" = who currently has the ball,
// "Sulm"/"Sulm_i_Rezikshem" = attack/dangerous attack, "Gol" = goal).
//
// It does NOT by itself tell us WHERE those event types show up in the
// live data stream. The <Detaje .../> gamedetails tag we already parse
// (see gameDetailsParser.js) has no field carrying one of these string
// keys — H1-H8/A1-A8/XY/PG/AM are still unverified numeric codes, and
// nothing captured so far confirms which (if any) of them maps to
// "currently attacking team" or "who has the ball". Until a live payload
// is captured showing one of these exact keys (or a numeric code we can
// map to one), NOTHING in this file is used to fabricate a possession/
// attack indicator — see MatchDetail.tsx's EVENT_LABELS comment.
export const LONDON365_LABELS = {
  Futboll: {
    Pushim: 'Pushim',
    Ndeshja_Mbaroi: 'Ndeshja Mbaroi',
    Fillo_Pjesa2: 'Pjesa 2 Filloi',
    Demitim: 'Demtim',
    Korne: 'Korne',
    Goditje_ne_porte: 'Goditje ne porte',
    Goditje_jasht_porte: 'Goditje jasht porte',
    Penallti: 'Penallti',
    Rivenie_fundore: 'Rivenie fundore',
    Rivenie_anesore: 'Rivenie anesore',
    Goditje_denimi: 'Goditje denimi',
    Goditje_denimi_rezikshme: 'Goditje denimi rezikshme',
    Zoteron_topin: 'Zoteron topin',
    Sulm: 'Sulm',
    Sulm_i_Rezikshem: 'Sulm i rezikshem',
    Pozicion_jashte_loje: 'Pozicion jashte loje',
    Gol: 'Gol',
    Nderrim: 'Nderrim',
    Karton_i_verdhe: 'Kartion i verdh',
    Karton_i_kuq: 'Karton i kuq',
    VAR: 'Arbitri shikon VAR',
    Statistika_Sumlme: 'Sulme',
    Statistika_Sumlme_Rrezikshme: 'Sulme te Rrezikshme',
    Statistika_ZoterimTopi: 'Zoterim topi %',
    Statistika_Goditje_ne_porte: 'Goditje ne porte',
    Statistika_Goditje_jasht_porte: 'Goditje jashte porte',
  },
};
