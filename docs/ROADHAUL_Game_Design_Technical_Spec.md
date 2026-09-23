> **Not (2026-09-23):** Bu dokümandaki motor önerisi (§6, Unity) [ADR 0001](adr/0001-web-stack-typescript-threejs.md) ile değiştirildi: proje **TypeScript + three.js** ile geliştiriliyor. Unity terimlerinin projedeki karşılıkları için [CLAUDE.md](../CLAUDE.md) içindeki tabloya bakın. Tasarımın geri kalanı aynen geçerlidir.
>
> *Note: the engine recommendation (§6, Unity) is superseded by ADR 0001 (TypeScript + three.js). See CLAUDE.md for how Unity terms map to this codebase. The rest of the design stands unchanged.*

# ROADHAUL — Mobil Lojistik & Kamyon Simülasyonu
## Yazılım Gereksinimleri + Oyun Tasarım Dokümanı + Teknik Mimari
**Sürüm:** 1.0  
**Tarih:** 23 Eylül 2026  
**Hedef:** Android öncelikli, daha sonra Windows/iOS  
**Önerilen motor:** Unity 6 LTS + C# + URP  
**Kodlama yardımcısı:** Claude Code  
**Doküman amacı:** Projeyi sıfırdan, modüler ve sonradan büyütülebilir biçimde geliştirmek.

---

# 1. Proje Özeti

## 1.1 Konsept

Oyuncu küçük bir lojistik işletmesiyle oyuna başlar. Bir görev noktasından yükü alır, rotayı takip eder, yükü teslim eder, para ve şirket itibarı kazanır ve zaman içinde:

- yeni kamyonlar satın alır,
- mevcut kamyonunu geliştirir,
- farklı kasa/römork tiplerine geçer,
- yeni şehir ve bölgelerin kilidini açar,
- daha değerli yük sözleşmelerine erişir,
- şirket merkezini geliştirir,
- yapay zekâ sürücüler çalıştırır,
- filoyu büyütür,
- özel etkinliklere katılır,
- sezonluk görevleri tamamlar.

Temel oyun döngüsü:

**Görevi seç → yükü al → kamyonu hazırla → sür → olaylarla karşılaş → teslim et → ödül al → kamyonu/şirketi geliştir → daha değerli görevlere eriş.**

Referans alınan Truck Simulator: Ultimate; simülasyon ile tycoon yapısını birleştiriyor, 100+ şehir, farklı kargo türleri, şirket yönetimi, çalışanlar, filo, ikinci el pazar, kamyon modifikasyonu, etkinlik/çok oyunculu sezon ve dinlenme tesisi gibi sistemler sunuyor. Bu proje bu tür sistemlerden ilham alabilir ancak başka oyunun marka, araç, harita, görsel, UI veya kodunu kopyalamamalıdır. [Kaynak: Google Play ve Zuuks resmi sayfası.]

---

# 2. Ürün Vizyonu

## 2.1 Ana hedef

Mobilde oynanabilir, ilk sürümü küçük tutulmuş fakat mimarisi büyümeye uygun bir lojistik simülasyon oyunu.

Oyunun ilk sürümünde 100 şehir, 40 kamyon veya multiplayer hedeflenmez.

İlk hedef:

- 1 ülke/bölge
- 3 şehir
- 1 başlangıç kamyonu
- 5–8 yük türü
- 20–30 görev
- temel ekonomi
- yakıt
- hasar
- teslimat
- basit trafik
- basit hava
- kamyon geliştirme
- şirket seviyesi
- birkaç etkinlik

Bu çekirdek sistem sağlam çalıştıktan sonra içerik genişletilir.

## 2.2 Tasarım ilkesi

**Önce oynanabilir çekirdek, sonra içerik.**

Yanlış yaklaşım:

> 50 kamyon + 100 şehir + multiplayer + detaylı şirket yönetimi + gerçekçi hava + canlı servis

Doğru yaklaşım:

> 1 kamyon + 3 şehir + 1 görev döngüsü + sağlam ekonomi + kayıt sistemi.

---

# 3. Referans Analizi

Truck Simulator: Ultimate'ın resmi mağaza açıklamasında şirket kurma, çalışan işe alma, filo büyütme, 100+ şehir, farklı yükler, ihale sistemi, ikinci el araç pazarı, kamyon modifikasyonu, yakıt, dinlenme tesisleri, hava durumu, paralı yollar ve multiplayer sezonları gibi sistemler bulunuyor.

Bu proje için alınabilecek tasarım fikirleri:

| Referans fikir | Bizim karşılığı |
|---|---|
| Yük taşıma | Görev sistemi |
| Şirket yönetimi | Şirket seviyesi |
| Filo | Kamyon garajı |
| Çalışanlar | V2/V3 filo sistemi |
| Farklı kargolar | CargoType sistemi |
| Modifikasyon | Upgrade sistemi |
| İkinci el pazar | V3 |
| İhaleler | V3 |
| Etkinlikler | Event sistemi |
| Dinlenme tesisleri | RestArea sistemi |
| Hava | Weather sistemi |
| Multiplayer | V5+ |

Referans oyunun güncel Google Play kaydında 100M+ indirme ve 4,3 yıldız görünmektedir; bu bilgi 23 Eylül 2026 tarihindeki mağaza görünümüne aittir. Güncel özellik listesinde lisanslı markalar, 100+ şehir, farklı görevler, filo yönetimi, çalışanlar, yakıt, modifikasyon, ikinci el araçlar, hava durumu ve multiplayer gibi sistemler yer almaktadır.

---

# 4. Özgün Oyun Kimliği

Projeyi sadece "Truck Simulator klonu" olmaktan çıkarmak için ana farklılaştırıcı:

## "Canlı lojistik macerası"

Görev yalnızca A'dan B'ye gitmek değildir.

Örnek:

> İstanbul → Bursa  
> Yük: Soğuk zincir gıda  
> Süre: 18 dakika  
> Hava: Yağmur  
> Risk: Yüksek  
> Ödül: 4.500 kredi

Yolda:

- trafik yoğunluğu,
- yakıt ihtiyacı,
- yol çalışması,
- kaza nedeniyle alternatif rota,
- mola noktası,
- hava değişimi,
- küçük yan görev,
- zaman bonusu,
- hassas yük riski

oluşabilir.

Böylece oyuncunun yaptığı yolculuk "boş sürüş" yerine küçük bir hikâyeye dönüşür.

---

# 5. Hedef Platform

## Faz 1

Android.

Hedef cihaz:

- düşük/orta segment Android
- minimum 4 GB RAM önerisi
- 30 FPS hedefi
- 60 FPS opsiyonel

## Faz 2

Windows.

## Faz 3

iOS.

---

# 6. Teknik Stack

## 6.1 Önerilen

- Unity 6 LTS
- C#
- Universal Render Pipeline
- Input System
- Addressables
- TextMeshPro
- Unity Localization
- Unity Profiler
- Unity Cloud Diagnostics veya eşdeğer crash sistemi
- Git
- Git LFS
- JSON veya SQLite tabanlı yerel save
- ScriptableObject tabanlı içerik tanımları

## 6.2 Neden Unity?

Bu proje için:

- mobil 3D desteği,
- araç fiziği ekosistemi,
- Android build pipeline,
- asset ekosistemi,
- C#,
- Claude Code ile metin tabanlı kod üretiminin uygunluğu,
- profiler/debug araçları

nedeniyle tercih edilir.

---

# 7. Mimari Prensip

Kod şu prensiple yazılacak:

**Data → Domain → Systems → Presentation → UI**

Örnek:

CargoDefinition
↓
CargoContract
↓
DeliverySystem
↓
GameState
↓
DeliveryUI

UI doğrudan ekonomi değiştirmemelidir.

Yanlış:

```csharp
money += 5000;
```

UI içinde.

Doğru:

```csharp
economyService.AddMoney(reward);
```

---

# 8. Önerilen Klasör Yapısı

```text
Assets/
  _Game/
    Art/
    Audio/
    Materials/
    Prefabs/
    Scenes/
    UI/
    Data/
    Localization/

    Scripts/
      Core/
      Gameplay/
      Economy/
      Vehicles/
      Cargo/
      Missions/
      World/
      Events/
      Company/
      Save/
      UI/
      Audio/
      AI/
      Input/
      Analytics/

    Tests/
      EditMode/
      PlayMode/

    Resources/
      Config/

    Addressables/
```

Kod isimlendirmesi:

```text
MissionSystem.cs
MissionDefinition.cs
MissionInstance.cs
CargoDefinition.cs
CargoInstance.cs
VehicleController.cs
FuelSystem.cs
DamageSystem.cs
EconomyService.cs
SaveService.cs
EventSystem.cs
CompanyService.cs
```

---

# 9. Core Gameplay Loop

```text
MAIN MENU
   ↓
COMPANY HQ
   ↓
JOB MARKET
   ↓
SELECT CONTRACT
   ↓
PREPARE TRUCK
   ↓
DRIVE TO PICKUP
   ↓
LOAD CARGO
   ↓
DELIVERY JOURNEY
   ↓
RANDOM EVENTS
   ↓
ARRIVE DESTINATION
   ↓
DELIVER
   ↓
CALCULATE REWARD
   ↓
XP + MONEY + REPUTATION
   ↓
UPGRADE / FUEL / REPAIR
   ↓
NEXT CONTRACT
```

---

# 10. Görev Sistemi

## 10.1 Görev nesnesi

Her görev aşağıdaki verilere sahip olmalıdır:

```text
MissionId
Title
Description
Origin
Destination
CargoType
CargoWeight
RequiredVehicleClass
RequiredTrailerType
BaseReward
Distance
TimeLimit
FuelEstimate
DamageTolerance
ReputationReward
Difficulty
WeatherModifier
SpecialRules
```

## 10.2 Görev örneği

```text
Görev:
Soğuk Zincir Teslimatı

Başlangıç:
İstanbul Deposu

Teslim:
Bursa Dağıtım Merkezi

Yük:
Dondurulmuş Gıda

Ağırlık:
8 ton

Süre:
16 dakika

Temel ödeme:
4.200 kredi

Hasar toleransı:
%5

Bonus:
Zamanında teslim +700

Ceza:
Gecikme -900

Özel:
Kasanın sıcaklığı kritik.
```

---

# 11. Cargo Sistemi

CargoType ScriptableObject olarak tanımlanır.

Örnek:

```text
Food
FrozenFood
Electronics
Furniture
Construction
Agriculture
Automotive
Medical
Fragile
Hazardous
Oversized
```

Her cargo:

```text
weight
volume
fragility
value
requiredTrailer
damageSensitivity
timeSensitivity
temperatureRequirement
```

özelliklerine sahip olabilir.

İlk sürümde yalnızca 6–8 cargo türü kullanılmalıdır.

---

# 12. Teslimat Sistemi

Teslimatın üç aşaması vardır:

## A. Pickup

Oyuncu pickup alanına girer.

UI:

> Yük hazır.
> Yükü almak için DUR.

## B. Transit

Görev aktif olur.

HUD:

```text
Kalan süre: 11:42
Mesafe: 87 km
Yük durumu: %100
Yakıt: %64
```

## C. Delivery

Teslim alanına giriş:

```text
TESLİMAT ALANI
[ DUR ]
```

Teslim sonrası:

```text
BAŞARILI TESLİMAT

Temel kazanç: 4.200
Zaman bonusu: +700
Hasar bonusu: +300

Toplam: 5.200

+ XP 420
+ Şirket İtibarı 8
```

---

# 13. Ekonomi Sistemi

Para birimi:

**Credit**

Ekonomi tek merkezden yönetilmelidir.

```text
EconomyService
  ├── AddMoney()
  ├── RemoveMoney()
  ├── CanAfford()
  ├── CalculateMissionReward()
  ├── CalculateFuelCost()
  ├── CalculateRepairCost()
  └── CalculateUpgradeCost()
```

Örnek:

```text
Mission income
- fuel
- toll
- repair
- penalties
= net profit
```

Oyuncuya yalnızca brüt para göstermek yerine net kârlılık da gösterilebilir.

---

# 14. İlerleme Sistemi

## Şirket seviyesi

```text
Level 1  Rookie
Level 2  Local Carrier
Level 3  Regional Carrier
Level 4  Professional Carrier
Level 5  Logistics Company
Level 6  Major Carrier
Level 7  National Logistics
Level 8  Global Carrier
```

İlk sürümde 5 seviye yeterlidir.

Level yükseldikçe:

- yeni görevler
- yeni araç sınıfları
- yeni bölgeler
- daha yüksek yük ağırlıkları
- yeni upgrade slotları

açılır.

---

# 15. Kamyon Sistemi

İlk sürüm:

3 araç.

Örnek sınıflar:

```text
Light Truck
Medium Truck
Heavy Truck
```

Gerçek marka kullanılacaksa lisans gerekir.

Lisanssız sürümde tamamen özgün:

```text
RoadHaul H1
RoadHaul H2
RoadHaul H3
```

gibi tasarımlar kullanılabilir.

Gerçek markaların isimleri, logoları, özgün tasarımları veya ticari kimlikleri izinsiz kullanılmamalıdır.

---

# 16. Vehicle Upgrade

Upgrade kategorileri:

## Motor

- acceleration
- hillPerformance
- fuelEfficiency

## Şanzıman

- shifting
- acceleration
- fuelEfficiency

## Fren

- brakingPower

## Lastik

- grip
- rainGrip
- wearRate

## Süspansiyon

- stability
- cargoProtection

## Depo

- fuelCapacity

## Kabin

- comfort
- companyPrestige

Upgrade sistemi:

```text
UpgradeDefinition
UpgradeLevel
UpgradeCost
StatModifier
RequiredCompanyLevel
```

---

# 17. Yakıt Sistemi

Yakıt tüketimi:

```text
baseConsumption
× truckWeightModifier
× terrainModifier
× speedModifier
× weatherModifier
```

Örnek:

```text
FuelUsed =
distance
* vehicle.baseFuelPerKm
* loadModifier
* terrainModifier
```

Yakıt fiyatı dünyadan bağımsız merkezi config'ten değiştirilebilir.

---

# 18. Hasar Sistemi

Çarpışma doğrudan aracın tamamen kullanılmaz hale gelmesine yol açmamalıdır.

Damage:

```text
0–20%   Minor
21–50%  Damaged
51–80%  Severe
81–100% Critical
```

Hasar:

- hızlanmayı
- fren mesafesini
- yakıt tüketimini
- teslimat ödülünü

etkileyebilir.

Ancak ilk sürümde fiziksel araç deformasyonu yapılması zorunlu değildir.

---

# 19. Trafik Sistemi

İlk sürüm:

- otomobil
- minibüs
- kamyon
- otobüs

NPC araçlar.

Trafik davranışları:

```text
Cruise
Follow
Stop
Avoid
ChangeLane
Turn
EmergencyStop
```

İlk sürümde gelişmiş trafik simülasyonu yerine waypoint tabanlı sistem önerilir.

---

# 20. Dünya Sistemi

İlk harita gerçek dünyanın birebir kopyası olmamalıdır.

Özgün bölge:

```text
North Valley
Central Plains
East Industrial
```

İlk sürüm:

### City A
Başlangıç şehri.

### City B
Sanayi şehri.

### City C
Tarım şehri.

Aralarında:

- şehir yolu
- çevre yolu
- otoyol
- kırsal yol

bulunur.

---

# 21. Harita Tasarım Stratejisi

Tek devasa map yerine:

```text
World
 ├── Region_A
 │    ├── City_A
 │    └── City_B
 ├── Region_B
 └── Region_C
```

Addressables ile bölgesel yükleme.

Bu yaklaşım:

- RAM kullanımını azaltır
- indirme boyutunu kontrol eder
- gelecekte yeni bölgelerin eklenmesini kolaylaştırır.

---

# 22. Event Sistemi

Kullanıcının istediği "etkinlikler" için sistem baştan kurulmalıdır.

Event:

```text
EventDefinition
 ├── title
 ├── description
 ├── duration
 ├── requirements
 ├── objectives
 ├── rewards
 └── modifiers
```

## Etkinlik örnekleri

### Acil Teslimat

30 dakika içinde 3 teslimat.

### Hafta Sonu Lojistiği

Özel cargo türlerinde %25 bonus.

### Kırılgan Yük

Hasar almadan teslim et.

### Yakıt Tasarrufu

Belirlenen tüketim sınırının altında tamamla.

### Uzun Yol

100+ km rota.

### Konvoy

Sonraki sürümde multiplayer yerine AI konvoy.

---

# 23. Etkinliklerin Teknik Yapısı

Etkinlik kodu görev kodundan ayrılmalıdır.

```text
MissionSystem
EventSystem
RewardSystem
```

Bir event mevcut mission sistemini kullanabilir.

Örneğin:

```text
Event:
Weekend Express

Requirements:
MissionType = Express
MinDistance = 50 km

RewardMultiplier = 1.5
```

Böylece her etkinlik için ayrı oyun mekaniği yazmak gerekmez.

---

# 24. Rastgele Yol Olayları

Oyuncunun yolculuğunu çeşitlendirmek için:

```text
RoadEvent
 ├── RoadWork
 ├── TrafficJam
 ├── BrokenVehicle
 ├── WeatherChange
 ├── Detour
 ├── FuelStation
 ├── RestStop
 └── BonusDelivery
```

Önemli:

Rastgele olaylar oyuncuyu haksız şekilde cezalandırmamalıdır.

Her event:

```text
probability
cooldown
minimumDistance
missionCompatibility
```

kurallarına sahip olmalıdır.

---

# 25. Dinlenme Alanları

Rest Area sistemi:

- yakıt
- araç tamiri
- kısa mola
- yiyecek/içecek
- küçük bonus görev
- kozmetik alışveriş

içerebilir.

İlk sürümde sadece:

```text
Fuel
Repair
Continue
```

yeterlidir.

---

# 26. Şirket Merkezi

Oyuncunun ana ekranı sadece menü değil, basit bir şirket merkezi olabilir.

Bölümler:

```text
Garage
Office
Job Board
Market
Upgrade
Events
Statistics
```

İleride:

- ofis geliştirme
- depo
- çalışan odası
- filo park alanı
- şirket tabelası

eklenebilir.

---

# 27. Filo Sistemi

V1'de oyuncu yalnızca kendi aracını sürer.

V2:

```text
Truck 1 → Player
Truck 2 → AI Driver
Truck 3 → AI Driver
```

AI sürücü görev tamamladığında pasif gelir üretir.

Çalışan sistemi:

```text
DriverDefinition
Skill
Salary
Efficiency
Risk
Experience
```

---

# 28. Görev Pazarı

Görevler sonsuz sabit liste olmamalıdır.

MissionGenerator:

```text
GenerateDailyJobs()
GenerateRegionalJobs()
GenerateSpecialJobs()
```

parametrelerinden görev üretir.

Örneğin:

```text
Origin = CityA
Destination = CityB
Cargo = Electronics
Distance = 82 km
Difficulty = Medium
Reward = 5,800
```

---

# 29. Görev Üretim Algoritması

Görev üretimi:

```text
1. Uygun şehir seç
2. Hedef şehir seç
3. Cargo seç
4. Araç gereksinimini kontrol et
5. Mesafeyi hesapla
6. Temel ödülü hesapla
7. Risk katsayısı uygula
8. Zaman limitini belirle
9. Özel şart ekle
10. MissionInstance oluştur
```

---

# 30. UI

Mobil HUD sade olmalıdır.

Ekranda:

```text
      SPEED
       74
--------------------
GPS / NAVIGATION

Fuel       62%
Damage      8%
Cargo     100%

Mission
ETA  12:41
```

Kontroller:

- direksiyon
- gaz
- fren
- kamera
- sinyal
- korna
- el freni
- cruise control

İlk prototipte:

```text
Steering Wheel
Gas
Brake
```

yeterlidir.

---

# 31. Kamera Sistemi

Kamera modları:

1. Third Person
2. Cabin
3. Hood
4. Rear

İlk sürümde sadece:

- Third Person
- Cabin

yeterlidir.

---

# 32. Save System

Save sistemi en kritik sistemlerden biridir.

Save:

```text
PlayerProfile
CompanyState
VehicleState
GarageState
MissionState
CurrencyState
UpgradeState
EventState
WorldState
Settings
```

JSON örneği:

```json
{
  "version": 1,
  "money": 12500,
  "companyLevel": 2,
  "activeVehicleId": "truck_001",
  "fuel": 72.4,
  "damage": 3.1
}
```

Save versioning zorunludur.

Örneğin:

```text
Save v1
Save v2
Save v3
```

Yeni sürüm eski save'i migration ile dönüştürür.

---

# 33. Offline First

V1 tamamen offline çalışabilir.

Bu önemlidir.

Oyuncu:

- görev oynar
- para kazanır
- upgrade yapar
- save alır

İnternet olmadan devam edebilir.

Online servis daha sonra eklenir.

---

# 34. Multiplayer

V1'e alınmamalıdır.

Gelecekte:

```text
Convoy
Co-op Delivery
Race
Community Event
```

eklenebilir.

Multiplayer için oyun mimarisinde bugün yalnızca extension point bırakılır.

---

# 35. Reklam ve Para Kazanma

İlk sürümde aşırı reklam kullanılmamalıdır.

Önerilen:

### Rewarded Ad

Oyuncu isterse:

- görev sonrası küçük bonus
- ücretsiz tamir indirimi
- yakıt bonusu

alabilir.

### Interstitial

Sadece doğal geçişlerde ve düşük sıklıkta.

### IAP

İleride:

- kozmetik
- premium
- reklam kaldırma
- sezon bileti

eklenebilir.

Oyun ekonomisi reklam izlemeye zorlanmamalıdır.

---

# 36. Monetizasyonun Teknik Ayrımı

Gameplay kodu reklam SDK'sına bağımlı olmamalıdır.

Yanlış:

```csharp
MissionSystem -> AdMob
```

Doğru:

```text
MissionSystem
RewardService
AdService
```

RewardService gerektiğinde AdService'e erişir.

Böylece reklam sağlayıcısı değiştirilebilir.

---

# 37. Ses Sistemi

Ses kategorileri:

```text
Engine
Transmission
Brake
Horn
Environment
Traffic
Weather
UI
Music
Radio
```

İlk sürüm:

- motor
- fren
- korna
- ortam
- UI

yeterlidir.

Radio sistemi V2/V3.

---

# 38. Hava Sistemi

İlk sürüm:

```text
Clear
Cloudy
Rain
Night
```

Hava değişimleri:

```text
WeatherManager
```

tarafından kontrol edilir.

Hava:

- yol tutuş
- görüş
- trafik
- yakıt
- görev zorluğu

üzerinde küçük etkiler yaratabilir.

---

# 39. Gece/Gündüz

Basit zaman sistemi:

```text
Morning
Day
Evening
Night
```

Tam gerçek zamanlı 24 saat sistemi V2'ye bırakılabilir.

---

# 40. Görev Zorlukları

```text
Easy
Normal
Hard
Expert
```

Zorluk etkileri:

- trafik
- zaman
- yük hassasiyeti
- rota
- hava
- ödül

---

# 41. Başlangıç Deneyimi

İlk 10 dakika kritik.

Oyuncu:

1. Şirket adını seçer.
2. Başlangıç kamyonunu alır.
3. İlk görevi görür.
4. Depoya gider.
5. Yükü alır.
6. Kısa bir rota tamamlar.
7. Para kazanır.
8. İlk upgrade açılır.

Tutorial mümkün olduğunca oynayarak öğretilmelidir.

Uzun metinler kullanılmamalıdır.

---

# 42. İlk 30 Dakika

Oyuncu ilk 30 dakikada:

- en az 3 teslimat
- 1 upgrade
- 1 yeni görev tipi
- 1 event
- şirket level artışı

görebilmelidir.

Ama oyuncuya çok hızlı araç satın aldırılmamalıdır.

---

# 43. MVP

## MVP kesinlikle şunları içermeli:

### Core

- araç sürüşü
- kamera
- temel trafik
- pickup
- delivery
- görev
- para
- yakıt
- hasar
- save/load
- UI

### İçerik

- 3 şehir
- 3 araç
- 6 cargo
- 20 görev
- 3 etkinlik
- 5 upgrade türü
- 1 hava sistemi

MVP'nin amacı "oyun fikrinin çalıştığını kanıtlamak"tır.

---

# 44. MVP Dışında

İlk sürüme koyma:

- multiplayer
- 100 şehir
- gerçek markalar
- lisanslı araçlar
- açık dünya streaming'in ileri seviyesi
- çalışan yönetimi
- online ekonomi
- klan
- PvP
- canlı sezon
- karmaşık mod sistemi
- gerçek radyo streaming

---

# 45. Geliştirme Fazları

## PHASE 0 — Project Foundation

- Unity projesi
- Git
- klasör yapısı
- scene
- input
- bootstrap
- service container
- logging
- config

## PHASE 1 — Driving Prototype

- truck
- physics
- camera
- input
- basic road

## PHASE 2 — Mission Loop

- cargo
- pickup
- delivery
- reward
- HUD

## PHASE 3 — Economy

- money
- fuel
- repair
- upgrade

## PHASE 4 — World

- 3 city
- traffic
- navigation
- rest area

## PHASE 5 — Progression

- company level
- unlock
- garage
- multiple trucks

## PHASE 6 — Events

- event definitions
- objectives
- rewards
- event UI

## PHASE 7 — Polish

- audio
- VFX
- optimization
- tutorial
- localization

## PHASE 8 — Release Candidate

- save migration
- crash handling
- Android builds
- performance
- store assets

---

# 46. Claude Code Çalışma Metodolojisi

Claude Code'a bütün oyunu tek prompt ile yaptırma.

Her aşamada küçük görevler ver.

## Kural

Claude Code:

```text
ANALYZE
→ PLAN
→ IMPLEMENT
→ TEST
→ REPORT
```

döngüsüyle çalışmalıdır.

---

# 47. CLAUDE.md

Proje root'unda:

```text
CLAUDE.md
```

bulunmalıdır.

İçerik:

```markdown
# ROADHAUL PROJECT RULES

## Architecture

Use:
Data -> Domain -> Systems -> Presentation -> UI

## Rules

- Do not put gameplay logic inside UI.
- Do not use static global mutable state unless explicitly approved.
- Use interfaces for replaceable services.
- Use ScriptableObjects for static game data.
- Runtime state must be separate from definition data.
- Every new system must have a clear owner.
- Avoid unnecessary dependencies.
- Prefer composition over inheritance.
- Write testable C#.
- Do not modify unrelated files.
- Before implementing a large feature, explain the plan.
- After implementation, run tests/build checks.
- Never invent Unity APIs.
- Do not delete working code without explaining why.
- Keep mobile performance in mind.

## Save

Save files must have a version number.
Never change save schema without migration.

## Performance

Target:
30 FPS minimum on supported mobile devices.

Avoid:
- per-frame allocations
- unnecessary GetComponent calls
- excessive Instantiate/Destroy
- expensive LINQ in Update
- uncontrolled physics objects

## Workflow

1. Inspect existing architecture.
2. Plan.
3. Implement minimum required scope.
4. Compile.
5. Test.
6. Report changed files.
```

---

# 48. Claude Code İlk Prompt

Claude Code'a ilk olarak şunu ver:

```text
You are the lead software architect for a Unity 6 mobile trucking/logistics simulation game.

Read CLAUDE.md first.

Do not implement gameplay yet.

Your task is to inspect the repository and create:

1. ARCHITECTURE.md
2. SYSTEM_MAP.md
3. DEVELOPMENT_ROADMAP.md

The project must use:

Data -> Domain -> Systems -> Presentation -> UI

The first playable version must contain:

- one truck
- one small map
- pickup
- delivery
- mission
- money
- fuel
- damage
- save/load
- basic HUD

Do not add multiplayer.
Do not add ads.
Do not add online services.
Do not add real-world licensed brands.

Before changing code, explain the proposed architecture.
```

---

# 49. Claude Code — Vehicle Prompt

```text
Implement the first playable truck controller.

Requirements:

- Unity 6
- C#
- mobile input abstraction
- third person camera
- acceleration
- braking
- steering
- reverse
- basic friction
- speed limit
- configurable vehicle data

Create:

VehicleDefinition
VehicleRuntimeState
VehicleController
VehicleInput
VehicleCameraController

Do not implement missions, economy, UI, or multiplayer.

Keep the system modular so a second vehicle can be added without changing VehicleController.

After implementation:
1. compile
2. run tests if available
3. list changed files
4. explain known limitations
```

---

# 50. Claude Code — Mission Prompt

```text
Implement the first mission system.

Requirements:

A mission contains:

- id
- title
- origin
- destination
- cargo
- weight
- reward
- time limit
- damage tolerance
- difficulty

Flow:

Available
-> Accepted
-> TravellingToPickup
-> Loaded
-> Delivering
-> Completed / Failed

Create:

MissionDefinition
MissionInstance
MissionState
MissionService
MissionRepository

The mission system must not directly manipulate UI.

The mission system must expose events or state changes that presentation code can observe.

Do not implement procedural mission generation yet.
```

---

# 51. Claude Code — Economy Prompt

```text
Implement the economy layer.

Create:

EconomyService
CurrencyWallet
RewardCalculator
CostCalculator

Support:

- add money
- remove money
- affordability checks
- mission rewards
- fuel cost
- repair cost
- upgrade cost

Do not put economy calculations inside UI.

Write unit tests for:
- reward calculation
- insufficient funds
- repair cost
- fuel cost
```

---

# 52. Claude Code — Save Prompt

```text
Implement versioned local save/load.

Requirements:

- JSON save
- version number
- atomic write strategy
- backup save
- corruption handling
- migration interface

Create:

SaveGameData
SaveService
SaveVersion
ISaveMigration

The game must not crash if save data is missing or corrupted.

Create tests for:
- new save
- load save
- corrupted save
- older save version
```

---

# 53. Claude Code — Event Prompt

```text
Implement a data-driven event system.

Events must be defined using ScriptableObjects.

Each event supports:

- start date/time
- end date/time
- requirements
- objectives
- reward
- modifiers

Create:

EventDefinition
EventRuntimeState
EventService
EventObjective
EventReward

Do not hard-code individual events.

The same system must support future events without code changes.
```

---

# 54. Data Model

Ana ilişkiler:

```text
PlayerProfile
      |
      +--- CompanyState
      |
      +--- GarageState
      |       |
      |       +--- VehicleRuntimeState
      |
      +--- EconomyState
      |
      +--- MissionState
      |
      +--- EventState
```

Static definitions:

```text
VehicleDefinition
CargoDefinition
MissionDefinition
UpgradeDefinition
EventDefinition
CityDefinition
```

Runtime:

```text
VehicleRuntimeState
MissionInstance
CompanyState
EconomyState
EventRuntimeState
```

Static data ile runtime state kesinlikle birbirine karıştırılmamalıdır.

---

# 55. Dependency Flow

İzin verilen:

```text
UI
 ↓
Application/System
 ↓
Domain
 ↓
Data
```

Kaçınılacak:

```text
UI → Save file
UI → Economy database
UI → Vehicle physics internals
Mission → UI GameObject
```

---

# 56. Service Listesi

Başlangıçta:

```text
GameBootstrapper
GameStateService
MissionService
EconomyService
VehicleService
FuelService
DamageService
UpgradeService
SaveService
EventService
AudioService
SceneService
```

Daha sonra:

```text
TrafficService
WeatherService
NavigationService
CompanyService
FleetService
DriverService
AnalyticsService
AdService
IAPService
OnlineService
```

---

# 57. Event Bus

Sistemde gevşek bağlantı için event mekanizması kullanılabilir.

Örnek:

```text
MissionCompletedEvent
MoneyChangedEvent
FuelChangedEvent
VehicleDamagedEvent
VehicleRepairedEvent
CompanyLevelUpEvent
EventCompletedEvent
```

UI bu olayları dinler.

---

# 58. Test Stratejisi

## Unit Tests

Test edilecek:

- ekonomi
- görev durumları
- ödül
- yakıt
- hasar
- upgrade
- save migration

## Integration Tests

- görev kabul → pickup → delivery
- teslim → ödül
- save → reload
- upgrade → araç stat değişimi

## PlayMode Tests

- araç spawn
- görev başlangıcı
- pickup alanı
- delivery alanı

---

# 59. Performans

Mobil için kritik kurallar:

### Kaçınılacak

```csharp
FindObjectOfType()
GameObject.Find()
Instantiate() every frame
Destroy() every frame
LINQ inside Update()
large allocations
```

### Kullanılacak

- object pooling
- cached references
- Addressables
- LOD
- occlusion
- baked lighting
- texture compression
- simplified collision meshes

---

# 60. Grafik Hedefi

MVP için:

- stylized realistic
- düşük/orta polygon
- baked environment
- basit shader
- kaliteli ışık

Amaç:

**"Gerçekçi görünmeye çalışan ama telefonda çalışmayan oyun" değil.**

Amaç:

**"Basit ama tutarlı görünen ve akıcı çalışan oyun."**

---

# 61. Asset Stratejisi

Koddan bağımsız tutulmalı.

```text
Truck
Road
Building
Tree
Traffic
UI
Audio
```

asset paketleri halinde yönetilebilir.

Önemli:

Başka oyunun assetlerini rip etmek, lisanssız marka/araç modelini kullanmak veya oyunun özgün görsel kimliğini kopyalamak yapılmamalıdır.

---

# 62. Navigation

İlk sürüm:

Waypoint graph.

```text
CityA_Depot
    |
Waypoint01
    |
Waypoint02
    |
Highway
    |
Waypoint03
    |
CityB_Depot
```

GPS sistemi bu graph üzerinden rota oluşturur.

Daha sonra:

- alternatif rota
- trafik
- ücretli yol
- yol kapanması

eklenebilir.

---

# 63. GPS Sistemi

GPS:

```text
NavigationService
Route
Waypoint
NavigationMarker
```

Oyuncuya:

- dönüş oku
- mesafe
- ETA
- hedef yönü

gösterir.

---

# 64. Görev Üretim Dengesi

Ödül hesabı:

```text
Reward =
BaseDistanceValue
× CargoMultiplier
× DifficultyMultiplier
× RiskMultiplier
× EventMultiplier
```

Ceza:

```text
LatePenalty
DamagePenalty
CargoFailurePenalty
```

Ancak toplam ceza oyuncunun tüm görev gelirini yok edecek seviyeye getirilmemelidir.

---

# 65. İleride Eklenebilecek Sistemler

## V2

- daha fazla şehir
- daha fazla araç
- ikinci el araç
- çalışanlar
- filo
- daha gelişmiş hava
- sezonluk etkinlikler

## V3

- ihale sistemi
- şirket merkezi
- AI çalışan ekonomisi
- özel yükler
- ağır yükler
- römorklar

## V4

- online hesap
- leaderboard
- cloud save
- community events

## V5

- multiplayer convoy
- co-op delivery
- online events

---

# 66. Multiplayer İçin Bugünden Alınması Gereken Önlemler

V1 offline olsa da domain kodu:

```text
Player
Mission
Vehicle
Company
Economy
```

gibi server-authoritative yapıya dönüştürülebilecek şekilde yazılmalıdır.

Örneğin:

```csharp
MissionService.CompleteMission()
```

ekonomiyi doğrudan UI'dan değiştirmemelidir.

İleride:

```text
Client
 ↓
Server validates
 ↓
Reward
 ↓
Player state
```

modeline geçilebilir.

---

# 67. Güvenlik

Online sürümde:

- client'a para verme yetkisi verilmez
- reward client tarafından belirlenmez
- IAP server doğrulaması yapılır
- save manipülasyonu kontrol edilir
- leaderboard server tarafında hesaplanır

Offline V1'de bu sistemler gerekli değildir.

---

# 68. Analytics

İlk sürümde bile temel telemetry faydalıdır.

Ölçülebilecek olaylar:

```text
game_started
tutorial_completed
mission_started
mission_completed
mission_failed
truck_purchased
upgrade_purchased
event_started
event_completed
session_duration
```

Kişisel veri toplanmamalıdır; analytics sistemi minimum ve şeffaf tutulmalıdır.

---

# 69. Başarı KPI'ları

Kodlama KPI'ı:

- crash-free
- stable save
- 30 FPS
- görev döngüsü hatasız

Oyun KPI'ı:

- tutorial completion
- first mission completion
- second session return
- average session
- mission completion rate
- upgrade conversion

İlk aşamada indirme sayısından önce oynanabilirlik ölçülmelidir.

---

# 70. Definition of Done

Bir özellik "bitti" sayılabilmesi için:

```text
[ ] Code implemented
[ ] Compiles
[ ] No console errors
[ ] Unit test if applicable
[ ] PlayMode test if applicable
[ ] Mobile tested
[ ] Save compatible
[ ] UI connected
[ ] No unrelated changes
[ ] Documentation updated
```

---

# 71. Git Commit Stratejisi

Kötü:

```text
update game
```

İyi:

```text
feat: add mission state machine
feat: add vehicle fuel system
fix: prevent duplicate delivery reward
test: add economy reward tests
```

Her özellik küçük commit olmalıdır.

---

# 72. Branch Stratejisi

```text
main
develop
feature/vehicle-controller
feature/mission-system
feature/economy
feature/save-system
feature/events
```

Tek geliştirici projede bile feature branch kullanmak güvenlidir.

---

# 73. Riskler

## En büyük risk

Oyunun kapsamının büyümesi.

Örnek:

> "Bir de multiplayer ekleyelim."

Sonuç:

6 aylık MVP → 2 yıllık proje.

Çözüm:

Her özellik:

```text
MVP
V2
V3
Later
```

olarak sınıflandırılmalı.

---

# 74. En Kritik Teknik Risk

Araç fiziği.

Araç sürüşü kötü ise:

- grafik iyi olsa bile oyun kötü hissedilir.

Bu nedenle araç kontrol prototipi ilk aşamada test edilmelidir.

---

# 75. En Kritik Tasarım Riski

Oyuncunun:

> "Aldım, sürdüm, bıraktım."

hissine kapılması.

Bunu kırmak için:

- farklı cargo
- zaman
- risk
- olay
- ödül
- upgrade
- şirket gelişimi

döngüsü kurulmalıdır.

---

# 76. İlk Prototip Haritası

Harita yaklaşık:

```text
CITY A
  |
  | 10 km
  |
HIGHWAY
  |
  | 15 km
  |
REST STOP
  |
  | 10 km
  |
CITY B
```

Toplam sürüş:

35 km.

Bu kadar küçük bir alan ilk prototip için yeterlidir.

---

# 77. İlk 10 Görev

1. İlk Paket
2. Market Sevkiyatı
3. Fabrika Malzemesi
4. Kırılgan Elektronik
5. Tarım Ürünü
6. Acil Teslimat
7. Uzun Rota
8. Yakıt Tasarrufu
9. Gece Teslimatı
10. Hassas Kargo

Bu görevler aynı haritayı tekrar kullanabilir.

---

# 78. İlk 3 Etkinlik

## Event 1 — Express Week

Hızlı teslimatlarda bonus.

## Event 2 — Safe Driver

Hasarsız teslimat ödülü.

## Event 3 — Heavy Cargo

Ağır yük görevleri.

Etkinlik sistemi kodlandıktan sonra içerik tarafı yalnızca yeni ScriptableObject verileri ekleyerek büyütülebilir.

---

# 79. Sonraki İçerik Paketleri

### Cargo Pack

10 yeni yük.

### Region Pack

1 yeni bölge.

### Truck Pack

3 özgün kamyon.

### Event Pack

5 yeni etkinlik.

### Company Pack

ofis/garaj geliştirmeleri.

Böylece DLC sistemi teknik olarak mümkün hale gelir.

---

# 80. Sonuç

Bu proje "Truck Simulator: Ultimate'ın aynısını yapma" projesi değildir.

Hedef:

**Mobilde küçük başlayan, görev → sürüş → teslimat → kazanç → geliştirme → şirket büyütme döngüsünü güçlü kuran özgün bir lojistik simülasyonu.**

En önemli teknik karar:

> Büyük oyunu küçük parçalar halinde inşa etmek.

İlk başarı kriteri:

```text
Oyuncu
↓
Görev alır
↓
Kamyonuna biner
↓
Yükü alır
↓
Sürer
↓
Teslim eder
↓
Para kazanır
↓
Kamyonunu geliştirir
↓
Yeni göreve geçer
```

Bu döngü eğlenceli ve hatasız çalışıyorsa proje devam ettirilir.

Çalışmıyorsa 100 şehir eklemek problemi çözmez.

---

# 81. Önerilen İlk Geliştirme Sırası

Claude Code ile tam sıra:

```text
01. Unity project foundation
02. Git + CLAUDE.md
03. Bootstrap architecture
04. Vehicle data
05. Vehicle controller
06. Camera
07. Mobile controls
08. Small test road
09. Cargo data
10. Pickup zone
11. Delivery zone
12. Mission state machine
13. HUD
14. Economy
15. Fuel
16. Damage
17. Reward screen
18. Save/load
19. Garage
20. Upgrade
21. 3-city prototype
22. Traffic
23. Navigation
24. Weather
25. Events
26. Tutorial
27. Optimization
28. Android build
29. Device testing
30. MVP release candidate
```

**Bu sıra bozulmamalıdır.**

---

# 82. İlk Claude Code Görevi

Projenin başlangıcında Claude Code'a yalnızca şu görev verilmelidir:

```text
Read the project requirements and CLAUDE.md.

Do not build the whole game.

First create the project foundation and architecture.

Tasks:

1. Inspect the Unity project.
2. Create the required folder structure.
3. Create the core interfaces and service boundaries.
4. Create GameBootstrapper.
5. Create a minimal GameStateService.
6. Create placeholder VehicleDefinition.
7. Create placeholder MissionDefinition.
8. Create placeholder CargoDefinition.
9. Create placeholder SaveGameData.
10. Create EditMode tests for the basic domain structures.

Do not implement vehicle physics yet.
Do not implement UI yet.
Do not implement economy yet.
Do not implement multiplayer.
Do not install unnecessary packages.

After completion:
- compile the project
- run available tests
- report all changed files
- report any errors
- explain the next recommended step

Never make unrelated changes.
```

---

# 83. Projenin Altın Kuralı

**Claude Code'a "oyunu yap" deme.**

Şunu de:

> "Şimdi sadece VehicleController sistemini yap."

Sonra:

> "Şimdi testlerini yaz."

Sonra:

> "Şimdi MissionSystem'i yap."

Bu şekilde ilerlemek, kod tabanının kontrolsüz şekilde büyümesini engeller.

---

# 84. Referanslar

- Google Play — Truck Simulator: Ultimate
- Zuuks Games — Truck Simulator: Ultimate resmi ürün sayfası

Referans oyun özellikleri zamanla değişebilir. Bu dokümandaki referans analizi 23 Eylül 2026 tarihinde erişilen mağaza/resmi sayfa bilgilerine dayanır.

---

# 85. Lisans / Fikri Mülkiyet Notu

Bu proje başka bir oyunun:

- kaynak kodunu,
- haritasını,
- modellerini,
- UI tasarımını,
- logo/markasını,
- lisanslı araçlarını,
- seslerini,
- özgün içeriklerini

kopyalamamalıdır.

Referans alınan şey **oyun türü ve sistem tasarımıdır**.

Özgün marka, özgün araç tasarımları, özgün harita, özgün görev metinleri ve özgün görsel kimlik kullanılmalıdır.
