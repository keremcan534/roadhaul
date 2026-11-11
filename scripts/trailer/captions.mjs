// The trailer's words, in each of the game's languages: short lines a muted viewer reads at a glance on a phone.
// Nothing in them sells (no "free", no prices, no "#1", no "download now": Google Play's rules for a listing's
// video), and nothing they claim goes past the game. Where the store's screenshots (scripts/storeArt.mjs) or the
// game (src/ui/i18n) already say the same, they say it the same way.
//
// A caption is a list of lines; the last is drawn in amber.

/** The game's languages, and the Google Play listing each one's video belongs to. */
export const LANGUAGES = {
  en: 'en-US',
  tr: 'tr-TR',
  de: 'de-DE',
  es: 'es-ES',
  fr: 'fr-FR',
  it: 'it-IT',
  pl: 'pl-PL',
  pt: 'pt-BR',
  ru: 'ru-RU',
  id: 'id',
};

export const CAPTIONS = {
  /** Over the cold open. */
  start: {
    en: ['Start with', 'one truck.'],
    tr: ['Tek bir', 'kamyonla başla.'],
    de: ['Starte mit', 'einem Lkw.'],
    es: ['Empieza con', 'un camión.'],
    fr: ['Commence avec', 'un camion.'],
    it: ['Inizia con', 'un camion.'],
    pl: ['Zacznij od', 'jednej ciężarówki.'],
    pt: ['Comece com', 'um caminhão.'],
    ru: ['Начни с', 'одного грузовика.'],
    id: ['Mulai dengan', 'satu truk.'],
  },
  /** The job board, and loading. */
  job: {
    en: ['Take the job.'],
    tr: ['İşi kap.'],
    de: ['Nimm den Auftrag.'],
    es: ['Acepta el encargo.'],
    fr: ['Prends la mission.'],
    it: ['Accetta il lavoro.'],
    pl: ['Bierz zlecenie.'],
    pt: ['Pegue o frete.'],
    ru: ['Бери заказ.'],
    id: ['Ambil pekerjaan.'],
  },
  /** On the road. */
  road: {
    en: ['Hit the road.'],
    tr: ['Yola çık.'],
    de: ['Ab auf die Straße.'],
    es: ['A la carretera.'],
    fr: ['En route.'],
    it: ['Si parte.'],
    pl: ['W drogę.'],
    pt: ['Pé na estrada.'],
    ru: ['В путь.'],
    id: ['Ayo berangkat.'],
  },
  /** The world montage. */
  weather: {
    en: ['Rain or shine.'],
    tr: ['Yağmur çamur demeden.'],
    de: ['Bei jedem Wetter.'],
    es: ['Llueva o truene.'],
    fr: ['Par tous les temps.'],
    it: ['Con ogni tempo.'],
    pl: ['W każdą pogodę.'],
    pt: ['Faça chuva ou sol.'],
    ru: ['В любую погоду.'],
    id: ['Hujan atau cerah.'],
  },
  /** The delivery and its pay. */
  paid: {
    en: ['Deliver.', 'Get paid.'],
    tr: ['Teslim et.', 'Kazan.'],
    de: ['Liefern.', 'Kassieren.'],
    es: ['Entrega.', 'Cobra.'],
    fr: ['Livre.', 'Encaisse.'],
    it: ['Consegna.', 'Incassa.'],
    pl: ['Dostarcz.', 'Zarabiaj.'],
    pt: ['Entregue.', 'Receba.'],
    ru: ['Доставь.', 'Заработай.'],
    id: ['Antar.', 'Dapat bayaran.'],
  },
  /** The garage: paints and upgrades, the three trucks. */
  garage: {
    en: ['Make it yours.'],
    tr: ['Tarzını yansıt.'],
    de: ['Ganz nach deinem Stil.'],
    es: ['Hazlo tuyo.'],
    fr: ['À ton style.'],
    it: ['Rendilo tuo.'],
    pl: ['Na twój styl.'],
    pt: ['Do seu jeito.'],
    ru: ['Сделай его своим.'],
    id: ['Sesuai gayamu.'],
  },
  /** The company's trucks on the road, run by its drivers. */
  fleet: {
    en: ['Grow your fleet.'],
    tr: ['Filonu büyüt.'],
    de: ['Bau deine Flotte aus.'],
    es: ['Amplía tu flota.'],
    fr: ['Agrandis ta flotte.'],
    it: ['Espandi la tua flotta.'],
    pl: ['Rozbuduj flotę.'],
    pt: ['Aumente sua frota.'],
    ru: ['Расширяй автопарк.'],
    id: ['Perbesar armadamu.'],
  },
  /** The rivals: their trucks on the map, the league. */
  rivals: {
    en: ['Beat your rivals.'],
    tr: ['Rakiplerini geç.'],
    de: ['Schlag die Konkurrenz.'],
    es: ['Vence a tus rivales.'],
    fr: ['Bats tes rivaux.'],
    it: ['Batti i rivali.'],
    pl: ['Pokonaj rywali.'],
    pt: ['Vença os rivais.'],
    ru: ['Обгони конкурентов.'],
    id: ['Kalahkan pesaing.'],
  },
  /** The finale's three words, one on each hit. */
  finale: {
    en: ['Drive.', 'Deliver.', 'Grow.'],
    tr: ['Sür.', 'Teslim et.', 'Büyü.'],
    de: ['Fahren.', 'Liefern.', 'Wachsen.'],
    es: ['Conduce.', 'Entrega.', 'Crece.'],
    fr: ['Roule.', 'Livre.', 'Grandis.'],
    it: ['Guida.', 'Consegna.', 'Cresci.'],
    pl: ['Jedź.', 'Dostarczaj.', 'Rośnij.'],
    pt: ['Dirija.', 'Entregue.', 'Cresça.'],
    ru: ['Рули.', 'Доставляй.', 'Расти.'],
    id: ['Setir.', 'Antar.', 'Tumbuh.'],
  },
  /** Under the brand. */
  tagline: {
    en: ['Build your own trucking company'],
    tr: ['Kendi nakliye şirketini kur'],
    de: ['Bau deine eigene Spedition auf'],
    es: ['Crea tu propia empresa de transporte'],
    fr: ['Crée ta propre société de transport'],
    it: ['Crea la tua azienda di trasporti'],
    pl: ['Zbuduj własną firmę transportową'],
    pt: ['Monte a sua própria transportadora'],
    ru: ['Создай свою транспортную компанию'],
    id: ['Bangun perusahaan truk milikmu sendiri'],
  },
};

/** The captions in `lang`: { key: lines }. */
export function captionsIn(lang) {
  return Object.fromEntries(Object.entries(CAPTIONS).map(([key, byLanguage]) => [key, byLanguage[lang]]));
}
