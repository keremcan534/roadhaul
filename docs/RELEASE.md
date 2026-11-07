# Releasing RoadHaul on Google Play

This is the checklist for putting the game on Google Play: what the repository already has, the one-time setup
only the owner can do (accounts, keys, declarations), and the steps for each release. Google changes the Play
Console's screens and rules from time to time. When a screen here looks different, the Console's own help wins.

## What the repository has

| Needed by Google Play | Where | Notes |
|---|---|---|
| A signed Android App Bundle (`.aab`) | `.github/workflows/release.yml` ("Release bundle") | Built from `main` or a `v*` tag. Signed with the upload key from the repository's secrets (below). Numbered by main's commit count, so each build is higher than the last. |
| Target API level | `android/variables.gradle` | Android 16 (API 36). |
| 64-bit and 16 KB page sizes | none needed | The app has no native libraries. |
| Store listing text, 10 languages | `fastlane/metadata/android/<locale>/` | `title.txt` (at most 30 characters), `short_description.txt` (80), `full_description.txt` (4000), `changelogs/default.txt` (release notes, 500). Machine-written except English and Turkish: have native speakers read them. |
| App icon, 512 × 512 | `fastlane/metadata/android/en-US/images/icon.png` | Drawn by `node scripts/androidIcons.mjs`, the same mark as the launcher icon. |
| Feature graphic, 1024 × 500 | `fastlane/metadata/android/en-US/images/featureGraphic.jpg` | Drawn by `node scripts/storeArt.mjs` (after `npm run build`). It has no words, so every language shares it. |
| Phone screenshots | `fastlane/metadata/android/<locale>/images/phoneScreenshots/` | Six in each listing, 1920 × 1080, captioned in its language (`scripts/storeArt.mjs`): a village at dusk, the cab with its HUD, a rainy night, the job board, the garage's paint shop and the map with the rivals. Google Play takes two to eight. |
| Promo video (optional) | `store-video/trailer/roadhaul-trailer-<lang>.mp4` (4K) and `…-<lang>-1080p.mp4`, made by `node scripts/storeVideo.mjs` | 30 seconds (what Google Play autoplays), 3840 × 2160, one per language of the game, with music and the game's own sound. Not kept in the repository (hundreds of MB): the script makes them from the build. Google Play takes each as a YouTube link (below). |
| Privacy policy | `public/privacy.html` → https://keremcan534.github.io/roadhaul/privacy.html | English and Turkish. Deployed with the game by `deploy-pages.yml` on every push to `main`. Settings → About links to it. |
| Open-source licences | Settings → About | `licenses.txt`, built from the packages the game ships. |
| In-app purchases | `src/data/config/products.ts`, Google Play Billing (`@capgo/native-purchases`) | "Remove ads" (`remove_ads`), "Premium paints" (`premium_paints`), the "Street" and "Neon" design packs (`designs_street`, `designs_neon`, three truck designs each) the "Supporter pack" (`supporter_pack`: all four in one) and "Road Pass Plus" (`road_pass`: the Road Pass's second track of the season's colours, every season), one-time products, looks and comfort only. The shop shows what the Play Console sells: nothing until the products are set up (step 6). |
| Ads (off) | `ROADHAUL_ADS`, AdMob (`@capacitor-community/admob`) | Off in releases until you switch them on (step 7): a release without ads carries no ads code at all. CI's debug APK shows Google's test ads, to try them on a phone. A release says `live` or `off` out loud and is refused with test ads ("Each release", step 2). |

## One-time setup

### 1. A Google Play developer account

1. Sign up at https://play.google.com/console with the Google account that will own the game. There is a one-time
   registration fee (US$25).
2. Choose **Personal** (or **Organisation**, which needs a D-U-N-S number) and complete identity verification
   (government ID, contact email and phone). The Console may also ask you to confirm access to an Android device
   through its mobile app.
3. The **developer name** and the **contact email** are shown on the store page. The privacy policy tells players
   to use that email, so keep it one you read.

**New personal accounts must run a closed test before the game can go to production:** at least 12 testers, opted in
for at least 14 days in a row. Start it as early as possible (see "Each release").

### 2. The upload key

Google Play keeps the key that signs the game for players ("Play App Signing"). You sign each upload with your own
**upload key**, which Google checks. Make it once and keep it safe.

```sh
keytool -genkeypair -v -keystore roadhaul-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000
```

`keytool` comes with the JDK (JDK 21, as the Android build uses). It asks for a password for the keystore and one for
the key (they may be the same) and a name for the certificate.

- **Never commit `roadhaul-upload.jks` or its passwords.** Keep a copy of the file and the passwords in a password
  manager or another safe place.
- If the upload key is lost or leaked, the Console can reset it: Test and release → App integrity → "Request upload key
  reset".

### 3. The repository's secrets

GitHub → the repository → Settings → Secrets and variables → Actions → **New repository secret**, four times:

| Secret | Value |
|---|---|
| `ROADHAUL_UPLOAD_KEYSTORE_BASE64` | The `.jks` file in base64 (commands below) |
| `ROADHAUL_KEYSTORE_PASSWORD` | The keystore's password |
| `ROADHAUL_KEY_ALIAS` | `upload` (the `-alias` above) |
| `ROADHAUL_KEY_PASSWORD` | The key's password |

The file in base64, ready to paste:

```sh
base64 -w0 roadhaul-upload.jks            # Linux
base64 -i roadhaul-upload.jks | pbcopy    # macOS (copies it)
```

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("roadhaul-upload.jks")) | Set-Clipboard   # Windows
```

### 4. GitHub Pages

The privacy policy must open at https://keremcan534.github.io/roadhaul/privacy.html before the game is submitted.
It is published with the game on every push to `main` (Settings → Pages → Source: "GitHub Actions").

### 5. The app in the Play Console

**Create app:** name `RoadHaul: Truck Simulator`, default language English (United States), **Game**, **Free**. Accept
the declarations.

**Store listing** (Grow users → Store presence → Main store listing):

- Paste the English texts from `fastlane/metadata/android/en-US/`. Then use "Manage translations" → "Add your own
  translations" for tr-TR, de-DE, es-ES, fr-FR, it-IT, pl-PL, pt-BR, ru-RU and id (Indonesian), from the folders of
  the same names.
- Graphics: `icon.png`, `featureGraphic.jpg` and the screenshots. A language without its own screenshots shows the
  English ones.
- Video (optional): upload `roadhaul-trailer-en.mp4` (the 4K file: YouTube then streams even its 1080p at a higher
  quality) to YouTube as a normal video, not a Short, then paste its address (`https://www.youtube.com/watch?v=…`,
  without `&si=` or a timestamp) into the listing's **Video** field. Google Play shows it on the feature graphic with a
  play button, and may autoplay its first 30 seconds muted: the trailer is 30 seconds, and its words are in the picture.
  The YouTube video must be public or unlisted, with monetisation off, embedding allowed ("Allow embedding" in its
  details), no age restriction, and "Not made for kids". Each language can have its own: upload
  `roadhaul-trailer-<lang>.mp4` too, and paste each address in that language's translation of the listing (a language
  without one shows the English video). For fastlane, the addresses go in `fastlane/metadata/android/<locale>/video.txt`.
  The trailer keeps to Google Play's rules for a listing's video: real play from the first frame, no prices, "free",
  rankings or calls to action, no phones or fingers.

**Store settings** (Grow users → Store presence → Store settings):

- Category: **Simulation**. Tags: for example trucks, driving and simulation.
- Contact details: the email (required) and, optionally, https://keremcan534.github.io/roadhaul/ as the website.

**App content** (Policy and programs → App content). RoadHaul's answers:

| Declaration | Answer |
|---|---|
| Privacy policy | https://keremcan534.github.io/roadhaul/privacy.html |
| Ads | **No** while the releases are built without ads (the default). **Yes** from the first release with live ads (step 7). |
| App access | All functionality is available without special access (no sign-in). |
| Content rating | Fill in the IARC questionnaire as a **Game**. Vehicles collide and get damaged, and props (lamps, signs, bins) can be knocked over. No people or animals are hurt: pedestrians step out of the way. There is no blood, no weapons, no bad language, and no alcohol, drugs or tobacco. **Gambling: no.** The game has no gambling or simulated gambling. Players cannot talk to each other or share anything. It offers in-app purchases of digital goods ("Remove ads", "Premium paints"): answer yes to that question. The game does not share the player's location. |
| Target audience | 13 and over (13–15, 16–17, 18+) keeps the game outside the Families programme. Choosing ages under 13 adds the Families policy's requirements and review, and with ads, only Families-certified ad networks and settings. |
| Data safety | Without ads: "Does your app collect or share any of the required user data types?" **No.** The game has no accounts, sends nothing off the device and keeps its saves on the phone; Google Play's purchases are Google's own. With live ads: **Yes**, for what the Google Mobile Ads SDK collects (step 7). |
| Advertising ID | No while the releases have no ads. With live ads: **Yes**, for advertising (the ads SDK declares the permission itself). |
| Government apps | No. |
| Financial features | None. |
| Health | None. |
| News app | No. |

### 6. Selling in the app (in-app purchases)

The game sells six one-time products (`src/data/config/products.ts`): **Remove ads** (no ads between contracts, and the
bonuses without an ad; the shop offers it only in a build with ads), **Premium paints** (the premium garage colours,
free to use once bought), two **design packs** (three truck designs each), **Road Pass Plus** (the pass's second track,
every season) and the **Supporter pack** (all of them in one). Nothing in the shop speeds the game up. The app reads what the player owns from Google Play
at every start, so a purchase follows the player to a new phone, and a refund takes it back.

1. Play Console → Setup → **Payments profile**: link or make a merchant account (it needs a bank account and, in many
   countries, tax details). Google takes its service fee from each sale.
2. Upload a bundle to a testing track first: the Console lets you make products only once the app has one with the
   billing library in it (every build has).
3. Monetize with Play → Products → **In-app products** → Create product, once for each. The product ids must be exactly
   `remove_ads`, `premium_paints`, `designs_street`, `designs_neon`, `supporter_pack` and `road_pass` (they are in the
   game's code and stored on players' phones: never rename them). Suggested prices: €1.99, €0.99, €0.99, €0.99, €2.99
   and €1.49 (see "Local prices" below). `road_pass` is a one-time product too (not a subscription): Road Pass Plus for
   every season. `supporter_pack` holds all five others: the shop shows it first, as the best value, so keep its price
   well under theirs together. Give each a name and a description (translate them for the listings' languages), a price,
   and **activate** it.
4. Setup → **License testing**: add the Google accounts that test purchases. Their purchases are free test orders,
   and they can test a pending (slow) payment too.
5. On a tester's phone, install the build from the testing track: Settings shows "Restore purchases", the main menu
   a Shop button, and the garage the premium colours (dimmed until bought).

In a browser, `?store=simulated` stands in for Google Play (development and the end-to-end tests).

#### Local prices

The game never names a price itself: the shop shows the one Google Play gives, in the player's currency. What a
player in each country pays is set in the Play Console, and a euro price turned into lira, rupiah or złoty at the
exchange rate is far more than people there pay for a game's extras. So:

1. Monetize with Play → Products → **Pricing templates** → Create template, one per price point (for example
   "Small" €0.99, "Medium" €1.49, "Ads" €1.99, "Bundle" €2.99). Each product takes its price from a template, and a
   change to the template changes every product on it.
2. In each template, after the default price, open **Local prices**. Play fills in every country from the exchange
   rate and rounds to local habits (…,99 and so on); then lower the countries where that is too much for the place.
   As a start, about half the converted price in Türkiye, Indonesia, Brazil, India and the other markets Play marks as
   emerging, and about 70% in Poland and the rest of Eastern Europe. Keep each above Play's minimum for the country.
3. Watch the conversion (Monetize with Play → **Financial reports**) for a month or two, and adjust one template at a
   time. Play's **Price experiments** (Monetize with Play → Products) can try two prices in a country on part of its
   players before changing it for everyone.

Players who bought keep what they bought: a price change only affects new purchases.

### 7. Switching the ads on

Releases are built without ads until you switch them on here. CI's debug APK always shows Google's **test** ads, so the
rewarded boosts and the ads between contracts can be tried on a phone first. The ads, when on:

- **Rewarded**, the player's choice only: a quarter of a delivery's pay again (100 to 2,500 credits), or half off a
  repair or a fill-up at a depot or rest area (five a day).
- **Interstitial**, never while driving: as a delivery's result closes, after the first three deliveries, then every
  third, at least eight minutes apart. None once "Remove ads" is bought.

The numbers are in `GameConfig.monetization` (`src/data/config/GameConfig.ts`).

1. Sign up at https://admob.google.com with the Google account that owns the game, and link it to the Play app
   (Apps → Add app → Android, "published on Google Play" once it is).
2. In the app: Ad units → **Rewarded** (one) and **Interstitial** (one). Note the **App ID** (`ca-app-pub-…~…`) and the
   two **ad unit IDs** (`ca-app-pub-…/…`).
3. Privacy & messaging: create a **European regulations** (GDPR) message for the app, and a **US states** message if
   you like. The game shows Google's consent form where the law asks for it, and Settings → "Ad privacy choices" lets
   players change their answer.
4. **app-ads.txt**: AdMob shows a line for it. It must be at the root of the website on the store listing. The game's
   site is a project page (keremcan534.github.io/roadhaul), and the root belongs to a `keremcan534.github.io`
   repository: create that repository with `app-ads.txt` in it, or list a website of your own whose root you control.
5. GitHub → the repository → Settings → Secrets and variables → Actions → **Variables** (not secrets: the ids ship
   inside the app): `ROADHAUL_ADS` = `live`, `ROADHAUL_ADMOB_APP_ID`, `ROADHAUL_ADMOB_REWARDED_ID` and
   `ROADHAUL_ADMOB_INTERSTITIAL_ID`. The next "Release bundle" builds with the ads. A build on a desktop takes the
   same environment variables; `ROADHAUL_ADS=test` builds Google's test ads, which never pay, so a release refuses
   them.
6. Play Console → App content: **Ads: Yes**; **Advertising ID: Yes**, for advertising or marketing; **Data safety**:
   declare what the Google Mobile Ads SDK collects and shares, as Google lists it at
   https://developers.google.com/admob/android/privacy/play-data-disclosure (device or other IDs, app interactions,
   diagnostics, approximate location from the IP address; shared for advertising, analytics and fraud prevention).
   The privacy policy already describes the ads.
7. Put the release through a closed test first and check, on a phone in the EEA or with a VPN, that the consent form
   shows.

Never tap your own live ads, and never ask players to: AdMob closes accounts for invalid clicks. Test with the debug
APK's test ads.

### 8. The cloud save

The app keeps the player's company in their Google account through **Android's own backup** (Auto Backup and the
phone-to-phone transfer): nothing to sign up for, no server, nothing in the Play Console. The game mirrors its save,
settings and purchases to `files/roadhaul/` in the app's storage, and the backup rules
(`android/app/src/main/res/xml/data_extraction_rules.xml`, `backup_rules.xml`) carry only that folder. Android backs
it up about once a day, while the phone is idle, charging and on Wi-Fi, if the player has backup on (Settings →
Google → Backup), and brings it back when the game is installed again with the same account, before it first starts.

- **Data safety** (Play Console → App content): the backup is Android's, encrypted in the player's account, not data
  the game collects: nothing to declare for it.
- **Try it** on a phone with the debug APK and a Google account: play, then
  `adb shell bmgr backupnow com.keremcan534.roadhaul`, uninstall, install again (`adb install`), and the company is back.
  `adb shell bmgr restore com.keremcan534.roadhaul` restores without reinstalling.
- **Across phones at once** (a save the player picks on any device, any time) needs Google Play Games' saved games:
  a Play Games project in the Play Console, its plugin in the app and a sign-in. The game's backup text
  (`SaveService.exportText`) is what it would store. That is an online service, so it waits for the owner's go-ahead.

## Each release

### 1. Before building

- `npm run check` passes on `main` (CI runs it on every pull request).
- Play the build on real phones: at least one low-end and one mid-range Android phone (roadmap step 29). Settings →
  Performance display shows the frame rate.
- Set the version players see in `package.json` (for example `1.0.0` for the first production release). The build
  number (`versionCode`) takes care of itself.
- Update the release notes in `fastlane/metadata/android/<locale>/changelogs/default.txt`.

### 2. Build the signed bundle

Either run it by hand, on `main`: GitHub → Actions → **Release bundle** → Run workflow. Or push a version tag:

```sh
git tag v1.0.0 && git push origin v1.0.0
```

When the run finishes, download its artifact, `roadhaul-<ref>-<build>`: a zip with `app-release.aab` inside.

To build it on a desktop instead (JDK 21 and the Android SDK), set the same four values as environment variables and
run the Gradle task. `ROADHAUL_KEYSTORE_FILE` is the path to the `.jks` file, not its base64. The ads' variables
(step 7 of the setup) go in the same shell:

```sh
export ROADHAUL_KEYSTORE_FILE=/path/to/roadhaul-upload.jks ROADHAUL_KEYSTORE_PASSWORD=... ROADHAUL_KEY_ALIAS=upload ROADHAUL_KEY_PASSWORD=...
export ROADHAUL_ADS=live ROADHAUL_ADMOB_APP_ID=... ROADHAUL_ADMOB_REWARDED_ID=... ROADHAUL_ADMOB_INTERSTITIAL_ID=...   # or ROADHAUL_ADS=off
export ROADHAUL_VERSION_CODE=$((1000 + $(git rev-list --count HEAD)))
npm run android && (cd android && ./gradlew bundleRelease)   # android/app/build/outputs/bundle/release/app-release.aab
```

The build number is 1000 more than `main`'s commits, the same as the workflow's: the builds uploaded before the
workflow was used were numbered by CI's runs (146 to 149), and Google Play takes only higher numbers.

A release build checks its ads before it starts (`android/app/build.gradle`). `ROADHAUL_ADS` must be `live` or `off`,
said out loud; test ads are refused, because they never pay. The game inside must have been built the same way: its
`build-info.json` is written by `npm run android`, so a shell that forgot the variables there is caught. On a phone,
Settings → About shows the build: `1049` carries the game's own ads, `1049-noads` none and `1049-testads` Google's
test ads.

A release build is shrunk and optimized by R8 (`android/app/build.gradle`). The bundle carries R8's mapping file, so
Google Play shows crash reports with the code's real names; nothing to upload by hand. A new native plugin that finds
classes or resources by name needs its keep rules (`android/app/proguard-rules.pro`, `res/raw/keep.xml`); try the
release build on a phone after adding one.

### 3. Upload it

- **The first time: closed testing** (Test and release → Testing → Closed testing). Create a track, add the testers
  (an email list or a Google Group), upload the `.aab` and roll it out. Testers join through the track's opt-in link
  and install from Google Play. The first upload also turns on Play App Signing.
- Release notes: `node scripts/releaseNotes.mjs` prints every language's notes in the form the Console's release
  notes box takes. Paste them in.
- After at least 12 testers have stayed opted in for 14 days, apply for production access from the Dashboard. After
  that, releases go to **Production** (or to open or closed testing first).
- The first review usually takes a few days. Later ones are often faster.

### 4. After release

- Android vitals (Monitor and improve) shows crashes, "app not responding" reports and slow frames on players' phones.
- Reply to reviews in the Console.
- For the next release: bump the version, update the notes, build, upload. `scripts/storeVideo.mjs` shoots and cuts the
  trailers again from the new build (it needs Google Chrome and ffmpeg with libx264; see the script's header). `scripts/storeArt.mjs` redraws the
  screenshots and the feature graphic if the game's look has changed.
