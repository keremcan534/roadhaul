// Draws the Google Play listing's art from the game itself: six screenshots with a caption in each listing's
// language, and the feature graphic. Original art (spec §85): the game's own world, panels and brand, and Oswald
// (scripts/fonts, SIL Open Font License) for the captions. The 512 px store icon comes from scripts/androidIcons.mjs.
//
//   npm run build && node scripts/storeArt.mjs
//
// writes into fastlane/metadata/android:
//   <locale>/images/phoneScreenshots/01.jpg … 06.jpg  1920 × 1080, captioned in that language
//   en-US/images/featureGraphic.jpg                   1024 × 500, the brand on a scene (no words, so every listing shares it)
//
// The pictures are shot as the store video's are (scripts/video/shoot.mjs): the production build in headless
// Chromium, frame by frame on the high preset. Scenes of the road are shot once; the panels, and the HUD in the cab,
// in each listing's language. The footage is kept in store-video/screens (ignored by git), so a second run only
// composes; drawn in software, a first run takes an hour or so.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chromium } from '@playwright/test';
import { AMBER, ASPHALT, BRAND_CSS, DUSK, FONT_FACES, ROOT, brand, serveBuild } from './storeKit.mjs';
import { CLIPS, shootClip, shootStills } from './video/shoot.mjs';

const LISTINGS = join(ROOT, 'fastlane/metadata/android');
const FOOTAGE = join(ROOT, 'store-video/screens');
const PORT = 4180;
/** Browsers shooting at once: each draws in software on several threads. */
const WORKERS = 2;

/** Each listing, and the game's language it is written in. */
const LOCALES = {
  'en-US': 'en',
  'tr-TR': 'tr',
  'de-DE': 'de',
  'es-ES': 'es',
  'fr-FR': 'fr',
  'it-IT': 'it',
  'pl-PL': 'pl',
  'pt-BR': 'pt',
  'ru-RU': 'ru',
  id: 'id',
};

const clip = (id) => CLIPS.find((entry) => entry.id === id);

/** The scenes of the road: short clips whose last frame is the picture. */
const SCENES = {
  // A village street at dusk, the truck parked facing the low sun, the camera round at its front quarter.
  village: {
    id: 'village',
    query: 'weather=clear&date=2026-09-20&time=18:25&traffic=0',
    spawn: '-600,-1566,0',
    runUp: 0,
    parked: true,
    seconds: 0.5,
    turn: [
      [0.8, -0.08],
      [0.8, -0.08],
    ],
  },
  // Havenport's high street on a rainy night (the video's clip, held on a frame).
  night: { ...clip('night'), id: 'night-still', seconds: 0.5 },
  // From the driver's seat on the highway, with the HUD, at a phone's size: shot in each listing's language.
  cabin: { ...clip('cabin'), id: 'cabin-phone', seconds: 0.3, phone: true },
};

/**
 * The screenshots, in the listing's order: a scene of the road filling the picture (`scene`), or a phone showing a
 * scene or one of the panels (`phone`: a still from shootStills, or the cabin's clip), and the caption's key.
 */
const SCREENS = [
  { file: '01.jpg', scene: 'village', caption: 'drive' },
  { file: '02.jpg', phone: 'cabin', caption: 'wheel' },
  { file: '03.jpg', scene: 'night', caption: 'weather' },
  { file: '04.jpg', phone: 'jobs', caption: 'jobs' },
  { file: '05.jpg', phone: 'painted', caption: 'garage' },
  { file: '06.jpg', phone: 'map', caption: 'rivals' },
];

/**
 * The captions: a headline of a few words (the last one amber) and a line under it, in each listing's language. The
 * English and Turkish ones are written here; the others are machine-written, like the listing's texts (docs/RELEASE.md).
 */
const CAPTIONS = {
  drive: {
    'en-US': { words: ['Drive.', 'Deliver.', 'Grow.'], line: 'Build your own trucking company' },
    'tr-TR': { words: ['Sür.', 'Teslim et.', 'Büyü.'], line: 'Kendi nakliye şirketini kur' },
    'de-DE': { words: ['Fahren.', 'Liefern.', 'Wachsen.'], line: 'Bau deine eigene Spedition auf' },
    'es-ES': { words: ['Conduce.', 'Entrega.', 'Crece.'], line: 'Crea tu propia empresa de transporte' },
    'fr-FR': { words: ['Conduis.', 'Livre.', 'Grandis.'], line: 'Crée ta propre société de transport' },
    'it-IT': { words: ['Guida.', 'Consegna.', 'Cresci.'], line: 'Crea la tua azienda di trasporti' },
    'pl-PL': { words: ['Jedź.', 'Dostarczaj.', 'Rozwijaj się.'], line: 'Zbuduj własną firmę transportową' },
    'pt-BR': { words: ['Dirija.', 'Entregue.', 'Cresça.'], line: 'Monte a sua própria transportadora' },
    'ru-RU': { words: ['Води.', 'Доставляй.', 'Расти.'], line: 'Создай свою транспортную компанию' },
    id: { words: ['Mengemudi.', 'Mengantar.', 'Berkembang.'], line: 'Bangun perusahaan truk milikmu sendiri' },
  },
  wheel: {
    'en-US': { words: ['Take', 'the', 'wheel.'], line: 'Five cameras, from the chase view to the cab' },
    'tr-TR': { words: ['Direksiyona', 'geç.'], line: 'Takip kamerasından kabine beş kamera' },
    'de-DE': { words: ['Ab', 'ans', 'Steuer.'], line: 'Fünf Kameras, von außen bis ins Führerhaus' },
    'es-ES': { words: ['Toma', 'el', 'volante.'], line: 'Cinco cámaras, de la vista exterior a la cabina' },
    'fr-FR': { words: ['Prends', 'le', 'volant.'], line: 'Cinq caméras, de la vue extérieure à la cabine' },
    'it-IT': { words: ['Prendi', 'il', 'volante.'], line: 'Cinque telecamere, dalla vista esterna alla cabina' },
    'pl-PL': { words: ['Siadaj', 'za', 'kółkiem.'], line: 'Pięć kamer, od widoku z zewnątrz po kabinę' },
    'pt-BR': { words: ['Assuma', 'o', 'volante.'], line: 'Cinco câmeras, da visão externa à cabine' },
    'ru-RU': { words: ['Садись', 'за', 'руль.'], line: 'Пять камер: от вида снаружи до кабины' },
    id: { words: ['Pegang', 'kemudi.'], line: 'Lima kamera, dari luar hingga kabin' },
  },
  weather: {
    'en-US': { words: ['Rain', 'or', 'shine.'], line: 'Day and night, four seasons, a living world' },
    'tr-TR': { words: ['Yağmur', 'çamur', 'demeden.'], line: 'Gece gündüz, dört mevsim, yaşayan bir dünya' },
    'de-DE': { words: ['Bei', 'jedem', 'Wetter.'], line: 'Tag und Nacht, vier Jahreszeiten, eine lebendige Welt' },
    'es-ES': { words: ['Llueva', 'o', 'truene.'], line: 'Día y noche, cuatro estaciones, un mundo vivo' },
    'fr-FR': { words: ['Par', 'tous', 'les', 'temps.'], line: 'Jour et nuit, quatre saisons, un monde vivant' },
    'it-IT': { words: ['Con', 'ogni', 'tempo.'], line: 'Giorno e notte, quattro stagioni, un mondo vivo' },
    'pl-PL': { words: ['W', 'każdą', 'pogodę.'], line: 'Dzień i noc, cztery pory roku, żywy świat' },
    'pt-BR': { words: ['Faça', 'chuva', 'ou', 'sol.'], line: 'Dia e noite, quatro estações, um mundo vivo' },
    'ru-RU': { words: ['В', 'любую', 'погоду.'], line: 'День и ночь, четыре сезона, живой мир' },
    id: { words: ['Hujan', 'atau', 'cerah.'], line: 'Siang dan malam, empat musim, dunia yang hidup' },
  },
  jobs: {
    'en-US': { words: ['Take', 'the', 'job.'], line: 'New contracts every day across four cities' },
    'tr-TR': { words: ['İşi', 'kap.'], line: 'Dört şehirde her gün yeni sözleşmeler' },
    'de-DE': { words: ['Nimm', 'den', 'Auftrag.'], line: 'Jeden Tag neue Aufträge in vier Städten' },
    'es-ES': { words: ['Acepta', 'el', 'encargo.'], line: 'Nuevos contratos cada día en cuatro ciudades' },
    'fr-FR': { words: ['Prends', 'la', 'mission.'], line: 'De nouveaux contrats chaque jour dans quatre villes' },
    'it-IT': { words: ['Accetta', 'il', 'lavoro.'], line: 'Nuovi contratti ogni giorno in quattro città' },
    'pl-PL': { words: ['Bierz', 'zlecenie.'], line: 'Nowe zlecenia każdego dnia w czterech miastach' },
    'pt-BR': { words: ['Pegue', 'o', 'frete.'], line: 'Novos contratos todos os dias em quatro cidades' },
    'ru-RU': { words: ['Бери', 'заказ.'], line: 'Новые контракты каждый день в четырёх городах' },
    id: { words: ['Ambil', 'pekerjaan.'], line: 'Kontrak baru setiap hari di empat kota' },
  },
  garage: {
    'en-US': { words: ['Make', 'it', 'yours.'], line: 'Paint and upgrade every truck' },
    'tr-TR': { words: ['Tarzını', 'yansıt.'], line: 'Her kamyonu boya ve geliştir' },
    'de-DE': { words: ['Ganz', 'nach', 'deinem', 'Stil.'], line: 'Lackiere und verbessere jeden Lkw' },
    'es-ES': { words: ['Hazlo', 'tuyo.'], line: 'Pinta y mejora cada camión' },
    'fr-FR': { words: ['À', 'ton', 'style.'], line: 'Peins et améliore chaque camion' },
    'it-IT': { words: ['Rendilo', 'tuo.'], line: 'Vernicia e potenzia ogni camion' },
    'pl-PL': { words: ['Na', 'twój', 'styl.'], line: 'Maluj i ulepszaj każdą ciężarówkę' },
    'pt-BR': { words: ['Do', 'seu', 'jeito.'], line: 'Pinte e melhore cada caminhão' },
    'ru-RU': { words: ['Сделай', 'его', 'своим.'], line: 'Крась и улучшай каждый грузовик' },
    id: { words: ['Sesuai', 'gayamu.'], line: 'Cat dan tingkatkan setiap truk' },
  },
  rivals: {
    'en-US': { words: ['Beat', 'your', 'rivals.'], line: 'Win tenders and lead every city' },
    'tr-TR': { words: ['Rakiplerini', 'geç.'], line: 'İhaleleri kazan, her şehirde lider ol' },
    'de-DE': { words: ['Schlag', 'die', 'Konkurrenz.'], line: 'Gewinne Ausschreibungen, führe jede Stadt an' },
    'es-ES': { words: ['Vence', 'a', 'tus', 'rivales.'], line: 'Gana licitaciones y lidera cada ciudad' },
    'fr-FR': { words: ['Bats', 'tes', 'rivaux.'], line: 'Remporte les appels d’offres, domine chaque ville' },
    'it-IT': { words: ['Batti', 'i', 'rivali.'], line: 'Vinci gli appalti e guida ogni città' },
    'pl-PL': { words: ['Pokonaj', 'rywali.'], line: 'Wygrywaj przetargi i przejmij każde miasto' },
    'pt-BR': { words: ['Vença', 'os', 'rivais.'], line: 'Ganhe licitações e lidere cada cidade' },
    'ru-RU': { words: ['Обгони', 'конкурентов.'], line: 'Выигрывай тендеры и лидируй в каждом городе' },
    id: { words: ['Kalahkan', 'pesaing.'], line: 'Menangkan tender dan pimpin setiap kota' },
  },
};

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** The caption's headline: its words, the last one amber, each kept whole on a line. */
function headline(words) {
  return words
    .map((word, index) => (index === words.length - 1 ? `<span><em>${escape(word)}</em></span>` : `<span>${escape(word)}</span>`))
    .join(' ');
}

const COPY_CSS = `
h1{margin:0;font:700 150px/1.0 Oswald,sans-serif;text-transform:uppercase;letter-spacing:.01em;color:#fff;
  text-shadow:0 6px 30px rgba(20,8,20,.45),0 2px 4px rgba(0,0,0,.25)}
h1 span{white-space:nowrap}
h1 em{font-style:normal;color:${AMBER}}
p{margin:14px 0 0 4px;font:500 52px/1.2 Oswald,sans-serif;letter-spacing:.03em;color:rgba(255,248,240,.94);
  text-shadow:0 3px 18px rgba(20,8,20,.55)}
.bar{display:inline-block;width:64px;height:6px;border-radius:3px;background:${AMBER};margin:0 0 14px 4px}
.frame>.brand{position:absolute;left:96px;bottom:64px;gap:22px}
.frame>.brand .tile{width:84px;height:84px}
.frame>.brand .wordmark{width:${(40 * 310.5) / 42}px}`;

/** A scene of the road filling the picture, the caption over its sky: the headline on one line, clear of the scene. */
function scenePage(picture, drawings, lang, caption) {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>${FONT_FACES}</style><style>
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:${ASPHALT}}
.frame{position:relative;width:1920px;height:1080px;overflow:hidden}
.shot{position:absolute;inset:0;width:1920px;height:1080px}
.shade{position:absolute;inset:0;background:
  linear-gradient(180deg,rgba(18,12,22,.58) 0%,rgba(18,12,22,.34) 18%,rgba(18,12,22,0) 36%),
  linear-gradient(0deg,rgba(10,10,12,.55) 0%,rgba(10,10,12,0) 22%),
  radial-gradient(130% 100% at 50% 50%,rgba(0,0,0,0) 62%,rgba(0,0,0,.28) 100%)}
.copy{position:absolute;left:96px;top:50px;width:1728px}
${COPY_CSS}
${BRAND_CSS}
</style></head><body><div class="frame">
<img class="shot" src="${picture}">
<div class="shade"></div>
<div class="copy"><div class="bar"></div><h1 data-lines="1">${headline(caption.words)}</h1><p>${escape(caption.line)}</p></div>
${brand(drawings.markSvg, drawings.wordSvg)}
</div></body></html>`;
}

/**
 * A phone on its side showing the game at a phone's size (a panel, or the cab with its HUD), turned a little towards
 * the caption, on a blur of the same picture. The phone is plain and unbranded, as in the store video.
 */
function phonePage(picture, drawings, lang, caption) {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>${FONT_FACES}</style><style>
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:${ASPHALT}}
.frame{position:relative;width:1920px;height:1080px;overflow:hidden}
.blur{position:absolute;inset:-60px;width:2040px;height:1200px;object-fit:cover;filter:blur(30px) brightness(.45) saturate(1.15)}
.shade{position:absolute;inset:0;background:
  radial-gradient(42% 55% at 68% 52%,rgba(242,163,58,.16),rgba(242,163,58,0) 72%),
  linear-gradient(90deg,rgba(10,8,14,.6),rgba(10,8,14,0) 55%)}
.copy{position:absolute;left:96px;top:50%;width:640px;transform:translateY(-58%)}
.stage{position:absolute;inset:0;perspective:2400px}
.phone{position:absolute;left:1316px;top:540px;padding:26px;border-radius:70px;transform-style:preserve-3d;
  transform:translate(-50%,-50%) rotateY(-12deg) rotateX(4deg) scale(.56);
  background:linear-gradient(150deg,#34373e,#101114 38%,#08090b);
  box-shadow:0 70px 160px rgba(0,0,0,.62),inset 0 0 0 3px rgba(255,255,255,.08),0 0 0 2px rgba(0,0,0,.85)}
.phone::before{content:'';position:absolute;left:9px;top:50%;width:12px;height:12px;margin-top:-6px;border-radius:50%;background:#1d2026}
.screen{display:block;width:1830px;height:824px;border-radius:46px;object-fit:cover}
${COPY_CSS}
${BRAND_CSS}
</style></head><body><div class="frame">
<img class="blur" src="${picture}">
<div class="shade"></div>
<div class="stage"><div class="phone"><img class="screen" src="${picture}"></div></div>
<div class="copy"><div class="bar"></div><h1 data-lines="3">${headline(caption.words)}</h1><p>${escape(caption.line)}</p></div>
${brand(drawings.markSvg, drawings.wordSvg)}
</div></body></html>`;
}

function featureGraphicPage(picture, drawings) {
  // The scene fills the right, the truck about two thirds across; the brand stands on a dusk-dark panel at the left.
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:1024px;height:500px;overflow:hidden;background:${DUSK}}
.frame{position:relative;width:1024px;height:500px;overflow:hidden}
.shot{position:absolute;left:180px;top:-148px;width:1152px;height:648px}
.shade{position:absolute;inset:0;background:
  linear-gradient(90deg,${DUSK} 0px,${DUSK} 180px,rgba(26,19,32,.88) 260px,rgba(26,19,32,.45) 380px,rgba(26,19,32,0) 500px),
  radial-gradient(120% 110% at 70% 50%,rgba(0,0,0,0) 60%,rgba(0,0,0,.28) 100%)}
.frame>.brand{position:absolute;left:210px;top:50%;transform:translate(-50%,-50%);flex-direction:column;gap:22px}
.frame>.brand .tile{width:124px;height:124px}
.frame>.brand .wordmark{width:320px}
${BRAND_CSS}
</style></head><body><div class="frame">
<img class="shot" src="${picture}">
<div class="shade"></div>
${brand(drawings.markSvg, drawings.wordSvg)}
</div></body></html>`;
}

/** Renders `html` at `width` × `height` into a JPEG at `file`, once its fonts are in. */
async function render(browser, html, width, height, file) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    // A headline too wide for its lines (long words in some languages) gets smaller until it fits in them.
    const heading = document.querySelector('h1');
    if (heading === null) return;
    const lines = Number(heading.dataset.lines);
    let size = 150;
    const fits = () =>
      heading.scrollWidth <= heading.clientWidth + 1 &&
      heading.getBoundingClientRect().height <= size * lines + 1 &&
      [...heading.children].every((span) => span.getBoundingClientRect().right <= heading.getBoundingClientRect().right + 1);
    while (!fits() && size > 80) {
      size -= 4;
      heading.style.fontSize = `${size}px`;
    }
  });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, await page.screenshot({ type: 'jpeg', quality: 88 }));
  await page.close();
}

/** A picture file as a data: URL, for the pages that compose the art. */
const dataUrl = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`;

/** A clip's last frame. */
function lastFrame(folder) {
  const frames = readdirSync(folder).filter((name) => name.endsWith('.jpg')).sort();
  return dataUrl(join(folder, frames[frames.length - 1]), 'image/jpeg');
}

/** Shoots what is not shot yet, WORKERS browsers at once: the scenes once, the panels and the cab in each language. */
async function shoot(baseUrl) {
  const langs = [...new Set(Object.values(LOCALES))];
  const jobs = [
    ...['village', 'night'].map((scene) => (browser) => shootClip(browser, baseUrl, SCENES[scene], join(FOOTAGE, 'scenes'))),
    ...langs.flatMap((lang) => [
      (browser) => shootClip(browser, baseUrl, SCENES.cabin, join(FOOTAGE, lang), lang),
      (browser) => {
        const dir = join(FOOTAGE, lang, 'stills');
        return existsSync(join(dir, 'stills.json')) ? false : shootStills(browser, baseUrl, dir, { lang, delivery: false });
      },
    ]),
  ];
  const worker = async () => {
    const browser = await chromium.launch();
    try {
      for (let job = jobs.shift(); job !== undefined; job = jobs.shift()) {
        await job(browser);
      }
    } finally {
      await browser.close();
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
}

const stop = await serveBuild(PORT);
try {
  await shoot(`http://127.0.0.1:${PORT}/`);
} finally {
  stop();
}
const browser = await chromium.launch();
try {
  const scenes = {
    village: lastFrame(join(FOOTAGE, 'scenes', SCENES.village.id)),
    night: lastFrame(join(FOOTAGE, 'scenes', SCENES.night.id)),
  };
  const english = JSON.parse(readFileSync(join(FOOTAGE, 'en', 'stills', 'stills.json'), 'utf8'));
  const drawings = { markSvg: english.brand.mark, wordSvg: english.brand.word };
  for (const [locale, lang] of Object.entries(LOCALES)) {
    const panel = (name) =>
      name === 'cabin'
        ? lastFrame(join(FOOTAGE, lang, SCENES.cabin.id))
        : dataUrl(join(FOOTAGE, lang, 'stills', `${name}.png`), 'image/png');
    for (const screen of SCREENS) {
      const caption = CAPTIONS[screen.caption][locale];
      const html =
        screen.scene !== undefined
          ? scenePage(scenes[screen.scene], drawings, lang, caption)
          : phonePage(panel(screen.phone), drawings, lang, caption);
      const file = join(LISTINGS, locale, 'images/phoneScreenshots', screen.file);
      await render(browser, html, 1920, 1080, file);
    }
    console.log(`Screenshots: ${locale}`);
  }
  const feature = join(LISTINGS, 'en-US/images/featureGraphic.jpg');
  await render(browser, featureGraphicPage(scenes.village, drawings), 1024, 500, feature);
  console.log(`Feature graphic: ${feature}`);
} finally {
  await browser.close();
}
