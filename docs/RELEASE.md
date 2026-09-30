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
| Phone screenshots | `fastlane/metadata/android/<locale>/images/phoneScreenshots/` | One so far, 1920 × 1080, captioned in each listing's language (`scripts/storeArt.mjs`). **Google Play needs at least two.** Four or more at 1080p or larger help the listing. |
| Promo video (optional) | `store-video/roadhaul-promo.mp4`, made by `node scripts/storeVideo.mjs` | 32 seconds, 1920 × 1080, English, with music. Not kept in the repository (tens of MB): the script makes it from the build. Google Play takes it as a YouTube link (below). |
| Privacy policy | `public/privacy.html` → https://keremcan534.github.io/roadhaul/privacy.html | English and Turkish. Deployed with the game by `deploy-pages.yml` on every push to `main`. Settings → About links to it. |
| Open-source licences | Settings → About | `licenses.txt`, built from the packages the game ships. |

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
- Video (optional): upload `roadhaul-promo.mp4` to YouTube, then paste its address (`https://www.youtube.com/watch?v=…`)
  into the listing's **Video** field. Google Play shows it on the feature graphic with a play button. The YouTube video
  must be public or unlisted, with ads off, embedding allowed and no age restriction. One English video can serve every
  language. For fastlane, the address goes in `fastlane/metadata/android/en-US/video.txt`.

**Store settings** (Grow users → Store presence → Store settings):

- Category: **Simulation**. Tags: for example trucks, driving and simulation.
- Contact details: the email (required) and, optionally, https://keremcan534.github.io/roadhaul/ as the website.

**App content** (Policy and programs → App content). RoadHaul's answers:

| Declaration | Answer |
|---|---|
| Privacy policy | https://keremcan534.github.io/roadhaul/privacy.html |
| Ads | No, the app contains no ads. |
| App access | All functionality is available without special access (no sign-in). |
| Content rating | Fill in the IARC questionnaire as a **Game**. Vehicles collide and get damaged, and props (lamps, signs, bins) can be knocked over. No people or animals are hurt: pedestrians step out of the way. There is no blood, no weapons, no bad language, no gambling, and no alcohol, drugs or tobacco. Players cannot talk to each other or share anything, and there are no purchases. The game does not share the player's location. Expect the lowest or near-lowest ratings (for example PEGI 3 or 7, ESRB Everyone). |
| Target audience | 13 and over (13–15, 16–17, 18+) keeps the first release outside the Families programme. The game would qualify for younger players too (no data, no ads), but choosing ages under 13 adds the Families policy's requirements and review. |
| Data safety | "Does your app collect or share any of the required user data types?" **No.** The game has no accounts, sends nothing off the device and keeps its saves on the phone. |
| Advertising ID | No, the app does not use the advertising ID. |
| Government apps | No. |
| Financial features | None. |
| Health | None. |
| News app | No. |

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
run the Gradle task. `ROADHAUL_KEYSTORE_FILE` is the path to the `.jks` file, not its base64:

```sh
export ROADHAUL_KEYSTORE_FILE=/path/to/roadhaul-upload.jks ROADHAUL_KEYSTORE_PASSWORD=... ROADHAUL_KEY_ALIAS=upload ROADHAUL_KEY_PASSWORD=...
export ROADHAUL_VERSION_CODE=$(git rev-list --count HEAD)
npm run android && (cd android && ./gradlew bundleRelease)   # android/app/build/outputs/bundle/release/app-release.aab
```

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
- For the next release: bump the version, update the notes, build, upload. `scripts/storeVideo.mjs` cuts the video
  again from the new build (it needs ffmpeg with libx264; see the script's header). `scripts/storeArt.mjs` redraws the
  screenshots and the feature graphic if the game's look has changed.
