// Albanian display labels for the provider's field/attribute names, used by the live
// match detail. Display text only: it does not confirm what a field means (for example
// no "who has the ball" / attack indicator has a known live source) and it only covers
// the event types we actually detect.
export const LONDON365_EVENT_LABELS: Record<string, string> = {
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
};

export const LONDON365_STAT_LABELS: Record<string, string> = {
  Statistika_Sumlme: 'Sulme',
  Statistika_Sumlme_Rrezikshme: 'Sulme te Rrezikshme',
  Statistika_ZoterimTopi: 'Zoterim topi %',
  Statistika_Goditje_ne_porte: 'Goditje ne porte',
  Statistika_Goditje_jasht_porte: 'Goditje jashte porte',
};
