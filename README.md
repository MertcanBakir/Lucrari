# Lucrari

Lucrari, bireysel yatırımcılar için geliştirilmiş, BIST ve küresel piyasalarda varlık ve portföy takibi sağlayan modern bir React Native (Expo) mobil uygulamasıdır.

## 1. Proje Özeti

- **Framework**: Expo SDK 54, React Native 0.81.5, TypeScript
- **Bildirimler**: FinBot zamanlaması, Expo push, Supabase RPC cihaz kaydı ve kullanıcı tercihleri
- **Yönlendirme**: Expo Router (Dosya tabanlı yönlendirme)
- **Veritabanı ve Kimlik Doğrulama**: Supabase (PostgreSQL, Row Level Security, RLS)
- **Tasarım Dili**: Özel tasarım sistemi, açık/koyu tema desteği, glassmorphism ve mikro-animasyonlar

---

## 2. Mimari Prensipler

- **Teknoloji Standartları**: Vanilla CSS/StyleSheet yaklaşımı (TailwindCSS kullanılmaz), Google Fonts tipografisi, platforma duyarlı haptik geri bildirimler.
- **Güvenlik ve İzolasyon**: Kullanıcı verileri Supabase RLS politikaları ile korunur. Kimlik doğrulama işlemleri merkezi `AuthContext` üzerinden yönetilir.
- **Sıfır Sahte Veri**: Sahte fiyatlar, sabitlenmiş (hardcoded) mock veriler veya tahmini değerler yerine daima Supabase kaynaklı gerçek finansal veriler kullanılır; eksik veriler güvenli durumlarla (fail-closed) ele alınır.
- **Test Kapsamı**: Proje genelinde kritik finansal hesaplamalar (ağırlıklı ortalama maliyet, getiri, kur çevrimi, takvim eşleştirmeleri ve izleme listesi mutasyonları) kapsamlı birim ve entegrasyon testleriyle doğrulanır.

---

## 3. Kurulum ve Çalıştırma

### Gereksinimler
- Node.js 22 ve npm

### Adımlar

1. Bağımlılıkları yükleyin:
   ```bash
   npm ci
   ```

2. Ortam değişkenlerini yapılandırın (`.env`):
   ```env
   EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```

3. Geliştirme sunucusunu başlatın:
   ```bash
   npm start
   ```


### Bilgisayardan bağımsız iOS preview build

`development` profili Metro geliştirme sunucusuna bağlanır. `preview` profili JavaScript paketini uygulamanın içine alır; açılmak için Metro, tunnel veya açık bir bilgisayar gerektirmez. Finansal veriler, oturum ve push bildirimleri için internet ve canlı Supabase/FinBot servisleri gerekir.

```bash
npx --yes eas-cli@27.4.1 build --platform ios --profile preview
```

Build bağlantısı/QR koduyla kayıtlı gerçek iPhone'a kurun. Anonim oturumu korumak için mevcut uygulamayı silmeden güncelleyin. Native açılış ekranını uygulamayı tamamen kapatıp yeniden açarak kontrol edin.

EAS bulut build ortamında `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` veya `EXPO_PUBLIC_SUPABASE_ANON_KEY` ve analiz özelliği için `EXPO_PUBLIC_ANALYSIS_API_URL` tanımlı olmalıdır. Git tarafından dışlanan yerel `.env` dosyalarına bulut build'in erişeceğini varsaymayın. Yalnız mobil uygulamaya dağıtılması güvenli public/publishable değerler kullanılmalıdır; servis anahtarı veya veritabanı bağlantısı eklemeyin.

---

## 4. Test ve Doğrulama Komutları

Projenin tip kontrolü, kodlama standartları ve test süiti aşağıdaki komutlarla çalıştırılır:

```bash
# Servis ve iş mantığı testlerini çalıştır
npm test

# React Native bileşen testlerini çalıştır
npm run test:ui

# Bileşen kapsam raporunu üret
npm run test:ui:coverage

# Ekran ve hook testlerini ayrı çalıştır ve kapsam raporlarını üret
npm run test:app
npm run test:hooks

# Tüm testleri çalıştır ve CI ile aynı kapsam eşiklerini doğrula
npm run test:coverage

# TypeScript tip kontrolü
npm run typecheck

# Kod kalitesi ve lint kontrolü
npm run lint

# Bağımlılık uyumluluk kontrolü
npx expo install --check

# Git diff kontrolü
git diff --check
```

### Simülatörsüz kritik akış testleri

- `tests/auth-persistence.test.ts`: Gerçek Supabase Auth SDK ve uygulamanın depolama adaptörüyle misafir oturumunun istemci yeniden oluşturulduğunda korunmasını, kayıtlı hesaba geçişin kalıcılığını ve başarılı çıkıştan sonra eski kimliğin dönmemesini doğrular. Yalnız HTTP ve cihaz depolaması taklit edilir; canlı Supabase'e bağlanılmaz.
- `tests/auth-service.test.ts`: Oturum sorgusu istisna verdiğinde yeni misafir hesabı açılmamasını ve yeniden denemede mevcut kimliğin geri alınmasını kapsar.
- `tests/hooks/auth-context.test.tsx`: Hesap değişimi, çıkış, görünür bootstrap hatası ve yeniden denemeyi doğrular.
- `tests/hooks/portfolio.test.tsx` ile `tests/app/portfolio.test.tsx`: Başarılı işlem sonrası pozisyon/değer yenilemesini, kullanıcıya göre işlem kapsamını ve hesap geçişinde önceki portföy detayının kaldırılmasını kapsar.

Bu testler mevcut CI'nin Jest dosya eşleştirmelerine dahildir; simülatör gerektirmez. Uygulama sürecini gerçekten kapatmayı, Keychain şifrelemesini veya cihaz kilidi davranışını doğrulamaz. Depolama adaptörünün yakalayıp yuttuğu hatalar bu test eklemesiyle düzeltilmemiştir; hizmet katmanına ulaşan hatalarla karıştırılmamalıdır.

### GitHub Actions CI

CI, `main` dalına yapılan push'larda ve `main` hedefli pull request'lerde çalışır. GitHub'ın Actions sekmesinden elle de başlatılabilir.

- **Kod kalitesi ve testler** bağımlılıkları kilit dosyasından kurar, TypeScript kontrolünü çalıştırır ve `app/`, `components/`, `constants/`, `context/`, `hooks/`, `scripts/`, `services/`, `tests/`, `types/`, `utils/` ve ESLint yapılandırmasını tarar. Lint hatası veya uyarısı kontrolü başarısız yapar. `Code quality and tests` kontrolü `main` dalına birleştirme için zorunludur.
- **Dependency Review**, `main` hedefli pull request'lerde aynı zorunlu kontrolün parçası olarak yeni ve güncellenen bağımlılıkları tarar. Uygulama, geliştirme ve kapsamı belirlenemeyen bağımlılıklardaki bilinen `high` ve `critical` açıklar birleştirmeyi engeller. Bu adım GitHub Dependency Graph özelliğini kullanır.
- **Test kapsamı**, tüm Jest testlerinden gelen sonuçları birleştirir. `app/`, `components/`, `hooks/`, `services/` ve `utils/` dizinlerinin her biri için satır, koşul dalı, fonksiyon ve ifade kapsamı ayrı ayrı en az %85 olmalıdır. Testlerce hiç yüklenmeyen kaynak dosyaları da ölçüme girer. `frontend-test-coverage` ve `test-coverage` raporları GitHub Actions'tan 14 gün indirilebilir.
- **Expo paketleme**, `main` dalına birleştirme için zorunludur. SDK bağımlılık uyumluluğunu kontrol eder ve iOS ile Android için JavaScript paketlerini üretir. EAS build'leri ihtiyaç olduğunda elle alınır.
- **Supabase SQL**, `main` dalına birleştirme için zorunludur. Her çalıştırmada geçici bir veritabanı açar, Lucrari'nin migration'larını uygular ve `supabase/tests/` altındaki SQL testlerini çalıştırır. Testler gereken enstrüman, fiyat ve kur verilerini kendi transaction'larında oluşturup rollback eder; canlı fiyat verisine ihtiyaç duymaz. Portföy sahipliği ve snapshot RLS testleri, migration ile verilen SELECT yetkisinin kullanıcılar arası erişimi açmadığını doğrular. FinBot ve TradingAgents'ın entegrasyon testleri kendi projelerinde yürütülür.

CI için canlı servis adresi, Expo hesabı veya GitHub Secret tanımlamak gerekmez.

---

## 5. Dizin Yapısı

```text
/
├── app/                  # Expo Router ekran ve sayfa hiyerarşisi
│   ├── (tabs)/           # Alt sekme navigasyonu (Ana Sayfa, Yatırımlar, Menü)
│   └── _layout.tsx       # Kök layout ve tema sağlayıcıları
├── components/           # Yeniden kullanılabilir UI bileşenleri
│   ├── calendar/         # Finansal takvim bileşenleri
│   ├── portfolio/        # Portföy ve varlık kartları
│   ├── watchlist/        # İzleme listesi ana sayfa ve arama bileşenleri
│   └── ui/               # Temel ikon ve görsel arayüz elemanları
├── constants/            # Tema, renk ve ikon eşleştirme sabitleri
├── context/              # Auth ve global durum sağlayıcıları
├── hooks/                # Özel React hook'ları (useWatchlist, useMonthlyCalendar vb.)
├── services/             # Supabase API, portföy ve izleme listesi servisleri
├── tests/                # Node.js yerel test süiti
├── types/                # TypeScript tip ve arayüz tanımları
└── utils/                # Finansal formatlayıcılar, kuyruklar ve yardımcı fonksiyonlar
```

---

## 6. Finansal Takvim Modeli

Finansal takvim modülü (`components/calendar/`), şirketin bilanço açıklamaları ve makroekonomik olayları filtreleme, görüntüleme ve Apple Takvim'e aktarma yeteneklerine sahiptir:

- **Filtreler**:
  - `all`: Tüm şirket bilançoları ve ekonomik olaylar.
  - `portfolio`: Yalnızca kullanıcının portföyünde açık pozisyonu bulunan (`ownedPositions`) şirketlerin bilanço olayları.
  - `watchlist`: Yalnızca kullanıcının izleme listesinde bulunan şirketlerin bilanço olayları (BIST ve ABD birlikte; ekonomik olaylar hariç).
  - `earnings`: Tüm şirket bilançoları.
  - `economic`: Yalnızca makroekonomik duyurular ve veriler.
  - `bist`: Yalnızca BIST piyasasındaki şirket bilançoları.
  - `usa`: Yalnızca ABD piyasasındaki şirket bilançoları.

- **Filtre Çipleri Sırası**:
  1. Tümü
  2. Portföyüm (`briefcase.fill` ikonu ve açık pozisyon sayısı rozeti)
  3. İzleme Listesi (`list.bullet` ikonu ve izlenen varlık sayısı rozeti)
  4. Şirketler
  5. Ekonomik
  6. BIST
  7. ABD

- **Sahiplik ve İzleme Eşleşmesi**: Sahiplik ve izleme listesi üyelik doğrulamaları birbirinden bağımsız olarak kesinlikle `instrumentId` üzerinden yapılır; unvan veya sembol benzerliği üzerinden eşleştirme yapılmaz. Ekonomik olaylar portföy veya izleme listesine dahil edilmez.
- **Mikro Miktar Toleransı**: Pozisyon büyüklüğü `0.000001` değerinden büyük olan varlıklar açık pozisyon kabul edilir.
- **Toplu Apple Takvim Aktarımı**: Ayın tüm olayları veya seçilen olaylar `.ics` formatında güvenli bir şekilde dışa aktarılabilir.

---

## 7. Takvim Render ve Durum Mimarisi

1. **Ay Değişiminde Sıfır-Kare Veri İzolasyonu**:
   - Ay geçişlerinde `stateMonthKey` ve `activeMonthKey` eşleşmesi render anında doğrulanır; eski aya ait etkinlikler veya noktalar yeni ayın ilk render karesinde görünmez.
2. **Kullanıcı Oturum Değişiminde Sıfır-Kare İzolasyonu**:
   - `resolveUserScopedOwnershipState` ve `resolveUserScopedMembershipState` doğrulaması sayesinde oturum değişiminde önceki kullanıcının portföy sahiplik veya izleme listesi verisi asla sızdırılmaz.
3. **Deterministik İstek/Cevap Eşleşmesi**:
   - `fetchYear` ve `fetchMonth` değerleri dönen cevapla birebir eşleştirilerek yarış durumları (race conditions) engellenir.
4. **Hafif Bellek İçi Sahiplik ve Üyelik Önbelleği (`usePortfolioCalendarOwnership` & `useWatchlistMembership`)**:
   - Takvim ekranında tam `useWatchlist()` instance'ı yerine yalnızca üyelik kümesini (`Set<string>`) yöneten hafif `useWatchlistMembership()` çalışır; in-flight deduplication ve pub/sub bildirimlerini ana servis cache'i ile paylaşır.
5. **HTTPS-Only Resmi Kaynak Doğrulaması**:
   - Detay modalındaki kaynak bağlantısı saf `isValidSecureEventUrl` fonksiyonu ile doğrulanır; yalnızca geçerli `https:` şemalı ve kimlik bilgisi içermeyen URL'ler kabul edilir.
6. **Çelişkisiz Görünüm Durumu Çözücü (`resolveCalendarViewState`)**:
   - Initial loading, initial error, stale data (`calendar`, `ownership`, `watchlist`, `calendar_and_ownership`, `calendar_and_watchlist`), true empty portfolio/watchlist ve normal render durumları kesin öncelik sırasına göre çözülür; hata durumunda yanlışlıkla "boş liste" mesajı gösterilmez.
7. **Otomatik Apple Takvim Seçim Uzlaştırması (`reconcileExportSelection`)**:
   - Takvim filtre veya veri değişiminde aktif görünür olayı kalmayan tarihler seçim kümesinden otomatik olarak temizlenir.

---

## 8. İzleme Listesi (Watchlist) Modeli

Lucrari ana sayfasında (`app/(tabs)/index.tsx`), seçili gün olay listesinin altında kullanıcıların ilgilendikleri varlıkları portföylerine eklemeden güncel fiyat ve günlük getiri değişimleriyle takip edebilecekleri **İzleme Listesi** modülü yer alır.

### Temel Prensipler ve Güvenlik Sınırları
- **Yalnızca `get_my_watchlist` ve `set_my_watchlist_item` RPC'leri**: Mobil uygulama `user_watchlist_items` tablosunu doğrudan sorgulamaz; işlemler `auth.uid()` güvencesi altındaki PostgreSQL RPC fonksiyonları üzerinden yürütülür.
- **Portföy İzolasyonu**: İzleme listesi işlemleri alım/satım kaydı oluşturmaz ve isteğe bağlı nakit tutarlarını değiştirmez.
- **Fiyat Doğruluğu ve Fail-Closed Yaklaşım**: `has_price=false` veya fiyat kaydı bulunmayan enstrümanlar için sahte varsayılan fiyatlar üretilmez; veri güvenli şekilde `—` olarak sunulur. Fiyat güncelliğini yitirmişse `Fiyat güncel olmayabilir` uyarısı verilir.
- **Aktif Olmayan Varlıklar**: İşlem görmeyen (`is_active=false`) enstrümanlar listede `Artık aktif olarak fiyatlanmıyor` notu ile korunur ve sola kaydırılarak açılan "Sil" butonu ile listeden çıkarılabilir.
- **Sayfalama, Kompakt Görünüm ve Kart Düzeni**:
  - Header alanında solda "İzleme Listesi" başlığı ve `X Varlık` rozeti, sağda `+ Ekle` butonu yer alır; başlık alanı asla buton kalabalığı veya taşma yaratmaz.
  - İzleme listesi satırlarında kalıcı buton yer almaz; varsayılan durumda yalnızca finansal bilgiler (Sembol, Piyasa, Şirket, Fiyat, Getiri) temiz şekilde gösterilir.
  - Bir satır sola kaydırıldığında (swipe left), kart akıcı yay fiziğiyle kayarak arkasındaki kırmızı **“Sil”** aksiyonunu ortaya çıkarır; varlığı listeden çıkarmak için bu aksiyona dokunulması gerekir.
  - Liste genelinde aynı anda yalnızca tek bir satır açık kalabilir; başka bir satır açıldığında, kapalı başka bir satıra dokunulduğunda veya sayfalama/başlık kontrolleri kullanıldığında açık olan satır otomatik olarak kapanır.
  - İlk açılışta 20 kayıt çekilir; dar görünümde ilk 5 varlık gösterilir.
  - Toplam 5'ten fazla varlık olduğunda listenin en altında tüm genişliği kullanan sade bir **“Tümünü Gör” / “Daralt”** footer kontrolü yer alır.
  - "Tümünü Gör" tıklandığında aynı 20 kayıt ek RPC çağrısı olmadan anında genişletilir.
  - 20'den fazla varlık olduğunda `1–20 / 47`, `Önceki 20` ve `Sonraki 20` kontrolleriyle tek kaynaklı sayfalama yapılır. Sayfa etiketleri yalnızca ekranda doğrulanmış committed sayfadan türetilir.
  - Yeni varlık eklendiğinde liste otomatik olarak sayfa 0'a döner; son kaydın silinmesi durumunda geçerli önceki sayfaya uzlaştırılır.
  - Sayfa isteği hata verdiğinde önceki doğrulanmış sayfa korunurken hata bandındaki "Tekrar Dene" doğrudan başarısız olan sayfayı yeniden yükler.
- **Yatay Arama Modalı ve Gesture İzolasyonu**:
  - Tek satırlı yatay kaydırılabilir kategori çipleri (`Tümü, BIST, ABD, Kripto, Fon, Döviz`).
  - Yatay kaydırılabilir küçük sonuç kartları (`FlatList horizontal={true}`).
  - Modal içeriğini saran dokunma yakalayıcı kaldırılmış; arka plan dokunuşları modal kartından ayrı tutularak pürüzsüz yatay kaydırma ve buton etkileşimi sağlanmıştır.
  - Arama cursor'ı sunucudan tüketilen ham satır sayısıyla (`nextOffset = targetOffset + rawCount`) ilerler; UI'daki yinelenen kart temizliği sayfalama offsetini bozmaz.
  - `commitSearchState` ile ref ve state eşzamanlı güncellenerek aynı anda gelen kaydırma tetiklemelerinin mükerrer ağ isteği yapması engellenir.
  - Modal kapatıldığında arama durumu sıfırlanır ve devam eden sorgu nesilleri iptal edilir.
- **Deterministik Mutasyon Kuyruğu ("Last Intent Wins")**:
  - Kullanıcı hızlıca Ekle → Çıkar → Ekle yaptığında nihai niyet olan `Ekle` durumu kesin olarak veritabanına ve önbelleğe yansıtılır.
  - Eşzamanlı aynı yönlü çağrılar tek RPC'de birleştirilir, queued intent'ler kendi güncel executor'ları ile çalıştırılır ve tamamlanan işlemler kuyruktan temizlenir.
- **Render Anında Sıfır-Kare Kullanıcı İzolasyonu**:
  - `resolveUserScopedWatchlistState` ve `resolveUserScopedMembershipState` sayesinde kullanıcı oturum değişiminin ilk render karesinde önceki kullanıcının izleme listesi öğeleri veya üyelik kümesi kesinlikle gösterilmez.
- **Kullanıcı Bazlı Monotonik Revision ve Yarış Durumu Koruması**:
  - `membershipRevisionByUserId` ile her başarılı mutasyonda kullanıcının revision değeri artırılır.
  - `fetchAllWatchedInstrumentIds()` sorgusu tamamlandığında revision değişmişse bayat veri önbelleğe yazılmaz; paylaşılan in-flight pipeline içinde en fazla 3 deneme ile (`MAX_MEMBERSHIP_ATTEMPTS`) sorgu sıfırdan otomatik tekrarlanarak takvim filtresinin ve göstergelerin güncelliği garanti edilir.

---

## 9. Portföy Hareketleri (Portfolio Activity) Modeli

Yatırımlar ekranında varlık tahsis bölümünün hemen altında, kullanıcıların geçmiş alış ve satış işlemlerini inceleyebilecekleri **Portföy Hareketleri** (`app/portfolio-activity.tsx`) modülü yer alır.

### Temel Prensipler ve Güvenlik Sınırları
- **`get_my_portfolio_activity` RPC Sözleşmesi**: İşlemler `auth.uid()` ve portföy sahipliği doğrulaması altındaki PostgreSQL RPC fonksiyonu üzerinden 4 parçalı keyset cursor (`occurred_at`, `created_at`, `source_kind`, `activity_id`) ile sayfalanır.
- **Tarihsel Değer Güvencesi**: Geçmiş işlemler için canlı fiyat, güncel kur veya live FX dönüşümü yapılmaz; `quantity`, `unit_price` ve `gross_amount` yalnızca işlem anındaki değerlerle sunulur.
- **Geri Alınan İşlemler (Reversal)**: Geri alınmış hareketler (`is_reversed: true`) gizlenmez; görsel olarak pasifleştirilerek `Geri Alındı` etiketi ve geri alınma nedeni ile sunulur.
- **Salt Okunur Denetim**: Hareketler ekranından veya detay modalından herhangi bir alım/satım veya geri alma işlemi tetiklenmez.
- **Fail-Closed Görünüm Durumu ve Sıfır-Kare İzolasyonu**: `resolvePortfolioActivityViewState` ve `resolveUserScopedActivityState` sayesinde oturum geçişlerinde önceki kullanıcının/portföyün hareketleri bir render karesi bile sızdırılmaz.
- **Reaktif Güncelleme**: Portföyde gerçekleşen alış/satış kayıtları ve isteğe bağlı nakit güncellemelerinde `subscribePortfolioChanges` otomatik olarak önbelleği geçersiz kılar ve listeyi günceller.

---

### Uygulama logları

Uygulama kayıtları `utils/logger.ts` üzerinden üretilir. Her modül `createScopedLogger` ile kendi scope'unu tanımlar. Tüm seviyeler aynı çağrı biçimini kullanır.

```ts
log.warn('analysis.request.failed', {
  message: 'API request failed.',
  context: { requestId, method: 'POST', path: '/v1/analyses', status: 422, durationMs },
  error,
});
```

- Kayıt şeması `timestamp` (UTC), `level`, `scope`, sabit İngilizce `event`, İngilizce geliştirici mesajı `message`, `context` ve `error` alanlarından oluşur. Kullanıcıya gösterilen hata mesajlarının mevcut dili korunur. Hata nesnesi `name`, `message`, `code` ve `stack` alanlarına normalize edilir.
- `debug` önbellek, sorgu birleştirme, polling, gecikmiş yanıt ve rutin okuma ayrıntıları içindir. `info` kullanıcı işlemleri ve önemli durum değişimlerini, `warn` istek başarısızlıklarını, yeniden denemeleri ve eski veriye dönüşü, `error` tamamlanamayan işlemleri ve sözleşme hatalarını kaydeder. API hatası API katmanında kaydedilir, analiz hook'ları aynı hataya ait ekran bağlamını debug seviyesinde ekler.
- `context` alanına ham istek/yanıt, kimlik bilgileri ve kullanıcı metinleri eklenmez. İşlem kimlikleri, durumlar, sayaçlar ve süreler açıkça seçilir. Bilinen hassas alan adları, kullanıcı kimlikleri, e-posta adresleri, Bearer/JWT token'ları, tanınan API anahtarı biçimleri, URL içindeki kimlik bilgileri ve parola/anahtar parametreleri kayıttan önce maskelenir. Temizleme mesajı, context'i ve hata mesajı/stack'ini kapsar. Yeni hassas alanlar veya anahtar biçimleri eklenirken temizleme kuralları ve testleri güncellenmelidir.
- `false`, `0`, uzun metinler ve iç içe context nesneleri korunur. Döngüsel nesneler güvenli biçimde işaretlenir ve nesne derinliği sınırlandırılır. Konsol çıktısı tek satırdır.
- Analysis API çağrıları `X-Request-ID` başlığıyla bir istemci istek kimliği gönderir. Yeniden denemeler aynı kimliği korur. Kayıtlar HTTP metodu, yol, deneme numarası, süre ve yanıt durumunu içerir. Backend standart doğrulama alan yolları sağladığında `invalidFields` kaydedilir, reddedilen değerler ve ham hata gövdesi kaydedilmez. Backend tarafında eşleştirme için bu başlığın sunucu loglarına da aktarılması gerekir.
- Son 100 kayıt yalnız bellekte tutulur. `logger.getRecentLogs()` bağımsız bir kopya, `logger.exportLogs()` temizlenmiş JSON döndürür. Uygulama kapanınca kayıtlar kaybolur. Varsayılan konsol seviyesi geliştirmede debug, üretimde info'dur. Konsol filtresi bellek tamponunu filtrelemez. Harici toplama veya kalıcı log saklama entegrasyonu yoktur.
- ESLint, logger ve test dosyaları dışında doğrudan `console` kullanımını engeller. `check:health` komutu da aynı logger'ı kullanır. Etkileşimli proje sıfırlama komutunun kullanıcı yönergeleri doğrudan terminale yazılır.

### Agent servisi ve sunucu kaynakları

Menüdeki **Agent servisi** kartı API ve kaynak durumunu gösterir. Kart `/agent-health` detay sayfasını açar. CPU yüzdesi, mantıksal çekirdek sayısı, örnekleme aralığı, bellek kullanımı (GiB), kullanılabilir bellek, kaynak örnekleme zamanı ve sistem çalışma süresi burada gösterilir.

Detay sorgusu mevcut Supabase oturumunun güncel access token'ıyla `GET /healthz` isteği yapar. Mevcut API istemcisi 401 yanıtında oturumu bir kez yeniler. Backend yalnız yapılandırılmış kişisel hesap sahibine detay verir. 403 yetki gereksinimi, geçersiz oturum ve bağlantı hatası ayrı gösterilir. Kaynak bilgisi olmayan eski/public sağlık yanıtları API erişimi olarak gösterilir.

Detay ekranı odaktayken ve uygulama ön plandayken 12 saniyede bir yenilenir. Menü kartı odaklandığında bir kez kontrol edilir. İstekler önbelleksizdir, aynı anda ikinci istek başlatılmaz ve kullanıcı değişimi, ekran kapanması veya uygulamanın arka plana geçmesi bekleyen isteği iptal eder. Başarısız yenilemede eski sayılar gösterilmez.

`scope: host` sunucunun tüm iş yüklerini, `scope: system` API ortamının sistem ölçümlerini ifade eder. İlk CPU örneği ve eksik sayaçlar ölçüm bekleniyor olarak gösterilir. CPU için %90/%98, bellek için %85/%95 uyarı/kritik sınırları uygulanır. Bu kontrol arka plan işlerini, veritabanını, model veya ChatGPT oturumlarını, disk sağlığını ve AWS durumunu doğrulamaz. Sunucuda kaynak sayaçlarını sunan backend imajı ile Compose yapılandırmasının dağıtılmış olması gerekir.

## 10. Agent ve Finansal Çoklu Ajan Analizleri

Alt navigasyondaki **Agent** sekmesi, FinBot Analysis Backend üzerinden yeni finansal analiz başlatma, devam eden analizi takip etme, geçmiş analizleri listeleme ve tamamlanan Markdown raporlarını güvenli biçimde görüntüleme akışını sunar.

### Ortam ve Kimlik Doğrulama

- API adresi yalnızca `EXPO_PUBLIC_ANALYSIS_API_URL` ortam değişkeninden okunur ve `https:` olması zorunludur.
- Korumalı `/v1/*` isteklerinde Supabase access tokenı her istek anında SDK üzerinden alınır. Token uygulama state'ine veya kalıcı depoya yazılmaz ve loglanmaz.
- `401` yanıtında Supabase oturumu bir kez yenilenir ve aynı API isteği yalnızca bir kez tekrarlanır.
- Mobil uygulamaya Supabase service-role anahtarı, ChatGPT oturum bilgisi veya model sağlayıcı sırrı konulmaz.

### Analiz Yaşam Döngüsü

Yeni analizde tarih alanının ardından **Analiz Vadesi** seçilir. Kısa (1 ay), Orta (3 ay) ve Uzun (12 ay) seçenekleri hem Kişisel ChatGPT hem API anahtarı modunda `request.analysis_horizon` olarak gönderilir. Vade bilgisi olan analizler geçmişte bu bilgiyle gösterilir.

1. `GET /v1/providers` ile kullanıcının kullanabileceği sağlayıcı ve modeller alınır; model listesi istemcide hardcode edilmez. `model_options` varsa kullanıcıya `name` gösterilir ve API'ye `id` gönderilir; eski backend yanıtları için `models` alanı geriye dönük fallback olarak korunur.
2. Her bilinçli yeni analiz isteği için UUID v4 `Idempotency-Key` üretilir. Ağ hatasındaki açık tekrar denemede aynı anahtar ve aynı istek gövdesi korunur.
3. `POST /v1/analyses` sonucu tamamlanmış rapor kabul edilmez; dönen analiz kimliği kullanıcı bazlı olarak AsyncStorage'da saklanır.
4. İlk durum kontrolü yaklaşık 2,5 saniye sonra, sonraki kontroller yaklaşık 5 saniyede bir yapılır. Uygulama arka plandayken veya ekran odakta değilken polling durur.
5. Yalnızca `status=success` ve `stage=finished` olduğunda rapor endpoint'i çağrılır; terminal hata durumlarında polling sonlandırılır.
6. Uygulama yeniden açıldığında kullanıcıya ait aktif analiz kimliği okunur ve takip kaldığı yerden sürdürülür.
7. Analiz kabul edildiğinde oluşturma modalı kapanır ve kullanıcı Agent ana ekranında kalır. Çalışan analiz, rapor detay modalından bağımsız olarak arka planda takip edilir; detay ekranı yalnız kullanıcı geçmiş kartına dokunduğunda açılır.

Yeni analizlerde analist seçenekleri `market`, `macro` (Makro Analist), `news` ve `fundamentals` olarak gönderilir. Yeni raporların Makro bölümü `macro` koduyla gösterilir. Yatırımcı Tepkisi Haber raporunun içinde yer alır. Geçmiş raporlardaki ayrı `sentiment` bölümleri ve `effective_config.analysts` içindeki eski `social` değeri görüntüleme için desteklenir. Frontend raporları `sections` sözleşmesinden okur, ham state alanlarını kullanmaz.

### Dinamik Model Kataloğu

- Katalog kullanıcı bazlı ve 5 dakikalık bellek önbelleğiyle tutulur; eşzamanlı istekler tek bir `/v1/providers` çağrısını paylaşır.
- Agent ekranı ilk açıldığında, kullanıcı açıkça yeniden denediğinde ve uygulama uzun süre arka planda kaldıktan sonra ekrana dönüldüğünde katalog güvenli biçimde yenilenir.
- Kişisel ChatGPT kullanıcısı Hızlı ve Derin modeli kendi kataloğundan seçer. API anahtarı modunda iki kademe de kendi bağlantısını ve o bağlantının sağlayıcısı için backend'in etkinleştirdiği modeli seçer. Her iki kademe aynı bağlantıyı kullanabilir.
- Seçili model yenilenen katalogdan kalkarsa seçim ilk geçerli modele uzlaştırılır; görünmeyen eski bir model kimliğiyle analiz başlatılmaz.
- Katalog yüklenirken veya kullanılamazken model alanları ve analiz başlatma eylemi kapatılır; kullanıcıya ayrı bir yeniden deneme eylemi sunulur.
- Backend `MODEL_NOT_ALLOWED` döndürürse eski analiz isteği otomatik tekrarlanmaz. Katalog zorla yenilenir, geçersiz seçim temizlenir ve kullanıcıdan güncel modeli seçmesi istenir.

### API Bağlantıları

- Agent ekranında bağlantı ekleme, listeleme, kontrol etme ve kaldırma işlemleri `/v1/connections` uçları üzerinden yapılır. Girilen anahtar maskelenir, HTTPS isteğine verildiğinde alan temizlenir ve anahtar loglara veya kalıcı depoya yazılmaz.
- Bağlantı kontrolü sağlayıcının model-listesi isteğini kullanır. Model erişimi, API kotası ve faturalandırma sağlayıcı hesabına bağlıdır. Anahtar değiştirmek için yeni bağlantı eklenip eski bağlantı kaldırılır.
- API anahtarlı analizler `models.quick` ve `models.deep` içinde bağlantı kimliği ile model kimliği gönderir. Kişisel ChatGPT için mevcut iki üst düzey model alanı kullanılır. Geçmiş detayındaki model bilgisi işin kendi sağlayıcı/model kaydından okunur.
- API bağlantıları, herkese açık kayıtlı kullanıcı erişimini destekleyen TradingAgents Analysis API v2 dağıtımını ve anonim olmayan Supabase oturumunu gerektirir. Agent'a erişemeyen misafirler e-posta ile kayıt olabilir veya mevcut hesaplarına giriş yapabilir. Supabase e-posta doğrulaması açıksa, bağlantı doğrulandıktan sonra kullanıcı Agent'dan giriş yapar. Veriler Supabase hesabına göre ayrı kalır.
- Backend, yapılandırılmış kişisel owner hesabının mevcut anonim oturumuna izin verebilir. Kişisel ChatGPT kataloğu yalnızca bu hesaba backend tarafından sunulur.

### Rapor ve Geçmiş Güvenliği

- Rapor bölümleri backend sırasıyla gösterilir; `disclaimer` bölümü her zaman açık ve görünür tutulur.
- Her rapor bölümü bağımsız ve açılır/kapanır bir karttır. `content_markdown: null` geçerli bir "bu ajan çalıştırılmadı" durumu olarak kabul edilir ve raporun tamamını geçersiz kılmaz.
- Bileşik raporların `parts` alanları ayrı alt başlıklarla gösterilir (`risk.aggressive`, `risk.conservative`, `risk.neutral`, `trade_plan.research_manager` gibi).
- Rapor açma/yükleme akışı merkezi logger ile izlenir; yalnız analiz kimliği, durum, bölüm ve alt-parça sayıları kaydedilir. Access token, Idempotency-Key ve Markdown rapor metni loglanmaz.
- Markdown içindeki script, style, yorum ve ham HTML temizlenir. Yalnızca güvenli `https:` bağlantıları etkileşimli hale getirilir; WebView veya ham HTML çalıştırılmaz.
- Geçmiş liste 20 kayıtlık sayfalarla sanallaştırılır; devam eden ve tamamlanan kayıtlar aynı listede gösterilir.
- Backend OpenAPI dokümanındaki başarılı response şemaları şu anda boş olduğundan istemci, tarih/UUID/enum ve rapor sözleşmelerini çalışma anında fail-closed doğrular. Backend şemaları yayınlandığında bu tipler OpenAPI'den üretilmelidir.

### Ortam Değişkeni

```env
EXPO_PUBLIC_ANALYSIS_API_URL=https://analysis.example.com
```


## Yatırımlar: Sade Portföy Takibi

- **İşlem kaydı:** Varlık, adet ve birim fiyat girilir; işlem zamanı kayıt sırasında otomatik atanır. Mevcut alış/satış tasarımı, piyasa sekmeleri ve satış yüzdesi kısayolları korunur. Alış için nakit kurulumu veya bakiye yeterliliği aranmaz. Satış yalnız eldeki adet kadar yapılabilir. Sunucu, geçmiş tarihli kayıtlar ve geri almalar dahil işlem sırasının hiçbir noktasında adedin negatife düşmemesini kontrol eder.
- **Maliyet yöntemi:** Hareketli ağırlıklı ortalama kullanılır. Alış, kalan maliyete eklenir; satış maliyeti, satış öncesi ortalama birim maliyet × satılan adettir. Satış, kalan birim maliyeti değiştirmez. Tam kapanışta kalan maliyet sıfırlanır. Sıralama `transaction_at`, `created_at`, `id` alanlarıyladır.
- **Nakit isteğe bağlıdır:** `portfolio_cash_accounts.current_balance` alanında elle güncellenen TRY ve USD tutarları saklanır. Kayıt yoksa kullanıcı nakit eklememiş kabul edilir. Alış/satışlar bu tutarları değiştirmez. Para yatırma/çekme defteri ve zorunlu ilk kurulum bulunmaz.
- **Değer ve kâr/zarar:** Toplam portföy değeri = açık pozisyonların güncel değeri + isteğe bağlı nakit. Açık pozisyon kâr/zararı kalan maliyetle karşılaştırılır. Satış kâr/zararı ayrı gösterilir ve tamamen satılmış varlıkları da kapsar; portföy değerine ayrıca eklenmez. Günlük değişim, mevcut adetlerin fiyat verisindeki günlük değişimiyle hesaplanır; gün içi işlem zamanına göre kişisel günlük getiri değildir.
- **Kur:** TRY/USD gösterimi güncel USD/TRY kuru kullanır. USD maliyetleri de güncel kurla çevrilir; alış tarihinden itibaren oluşan kur getirisi ayrı hesaplanmaz. Eksik fiyat/kur için kısmi değer ve uyarı gösterilir.
- **Veri akışı:** Ekran → `usePortfolio` → `portfolio-service` → sahipliği doğrulayan Supabase fonksiyonları. `get_portfolio_positions` açık pozisyonları, `get_portfolio_realized_pnl` kapatılmış varlıklar dahil satış kârını getirir. `get_portfolio_cash` ve `set_portfolio_cash` elle girilen nakdi yönetir. Alış ve satışlar `record_portfolio_transaction` üzerinden tekrar gönderime dayanıklı olarak kaydedilir. İşlem geçmişi yalnız alış ve satışları sayfalar.
- **Geçiş:** `20261119000000_simplify_portfolio.sql` mevcut alış/satışları korur; mevcut net nakdi elle tutulan bakiyeye dönüştürür. `portfolio_fifo_matches`, `portfolio_cash_flows`, ilgili fonksiyonlar ve otomatik nakit kurulum tetikleyicisi kaldırılır. Eski uygulanmış geçiş dosyaları veritabanının yeniden kurulabilmesi için geçmiş olarak saklanır; çalışan sistemde eski hesap motoru bulunmaz.
- **Değer geçmişi:** Önceki anlık değer kayıtları ve o günün fiyatları korunur. `calculation_version < 2` kayıtları eski hesap yöntemiyle üretilmiş tarihsel verilerdir ve kısmi olarak işaretlenir. Yeni kayıtlar ortalama maliyet kullanır (`calculation_version = 2`). Elle girilen nakdin geçmişi bulunmadığı ve yalnız son piyasa fiyatları mevcut olduğu için anlık değer üretimi yalnız bugünün İstanbul tarihine açıktır. Nakit akışı gerektiren zaman ağırlıklı getiri alanları kaldırılmıştır.

### Veritabanı ve Testler

```sh
supabase db push --linked
supabase db query --linked --file supabase/tests/portfolio_simple_model_test.sql
npm run typecheck
npm run lint
npm test
npm run test:ui
npm run test:hooks
npm run test:app
```

SQL kabul testi, geçici veriler üzerinde bakiyesiz alış, tekrar gönderim, kısmi/tam satış, ortalama maliyet, satıştan sonra ek alış, işlem geri alma, geçmişte fazla satışın reddi, kullanıcı izolasyonu ve anlık değer üretimini doğrular; sonunda bütün test verilerini geri alır.


## Portföy Grafiği

Yatırımlar özetindeki grafik ikonu `app/portfolio-chart.tsx` ekranını açar. Mevcut para birimi ve piyasa seçimi taşınır; ekran içinde TRY/USD, Tümü/BIST/NASDAQ/Kripto/Fonlar/FX-Altın, 1 hafta/1 ay/3 ay/6 ay/1 yıl/tümü ve Değer/Kâr-Zarar seçilebilir. Grafik parmakla incelenebilir; parmak bırakılınca seçilen tarih korunur. Grafik içindeki kaydırma sayfa kaydırmasına devredilmez. Tarih değişimlerinde, sık hareketlerde sınırlandırılmış hafif seçim titreşimi verilir; aynı tarihte tekrarlanmaz. Erişilebilirlik eylemleriyle önceki/sonraki tarih seçimi de desteklenir. Çizim Expo SDK 54 ile uyumlu `react-native-svg` üzerinden yapılır. Paket Expo Go içinde bulunur; mevcut özel geliştirme istemcisine eklenmesi için yeni bir native derleme gerekir.

- `portfolio_snapshots` toplam değer, günün USD/TRY kuru ve kayıt zamanını; `portfolio_snapshot_positions` varlık bazındaki tarihsel değerleri saklar. `portfolio_snapshot_markets`, yeni kayıtlar için kapatılmış pozisyonların satış kârı dahil piyasa toplamlarını saklar. TRY/USD dönüşümü günün kaydedilmiş kuruyla yapılır; güncel kur geçmişe uygulanmaz.
- Eski kur bilgisi yalnız snapshot pozisyonlarında gerçekten kayıtlıysa başlığa taşınır. Geçmiş kur eksikse ilgili yabancı para noktası boş kalır. Eski piyasa bazında gerçekleşmiş kâr bulunmadığından, filtreli Kâr/Zarar geçmişi `market_breakdown_complete` işaretli yeni kayıtlardan başlar. Eski toplam Kâr/Zarar, başlıktaki gerçekleşmiş + gerçekleşmemiş kâr toplamından okunur; hesap yöntemi değişikliği ekranda belirtilir.
- Değer, seçili yatırımların toplam piyasa değeridir; yalnız Tümü seçimi isteğe bağlı nakdi içerir. Kâr/Zarar gerçekleşmiş + gerçekleşmemiş kârdır ve nakit içermez. Bu göstergeler para girişlerinden arındırılmış dönem getirisi veya zaman ağırlıklı getiri yüzdesi olarak sunulmaz.
- `get_portfolio_chart` kullanıcı/portföy sahipliğini ve filtreleri doğrular. En fazla 600 tarih döner; uzun geçmişte zaman dilimlerinin ilk/son, minimum/maksimum ve eksik veri noktaları korunarak çizim yükü sınırlandırılır. Eksik günler sıfıra çevrilmez, eksik kur/kâr noktaları çizgiyle birleştirilmez.
- `refresh_portfolio_chart`, ekran açıldığında veya yenilendiğinde yalnız kullanıcının bugünkü snapshot'ını günceller. Alış/satış ve nakit değişiklikleri grafik önbelleğini geçersiz kılar. Grafik sorguları kullanıcı, dönem, piyasa, para birimi ve göstergeye göre ayrılır; filtre/oturum değişiminde eski sonuç gösterilmez.
- `private.capture_portfolio_chart_snapshots()` ve Supabase `pg_cron` işi `lucrari-portfolio-chart-snapshots` her saatin 55. dakikasında uygulama kapalıyken de kayıt üretir. İstanbul takvim günü içinde aynı satır güncellenir; önceki günler değiştirilmez. Tek bir portföyün fiyat hatası diğer portföyleri durdurmaz. İşin sonucu ve uyarıları Supabase Cron kayıtlarından izlenir.
- Geçişler: `20261119001000_portfolio_chart.sql` ve değerleme/grafik kurunu eşitleyen `20261119002000_consistent_snapshot_chart_fx.sql`. SQL kabul testi: `supabase/tests/portfolio_chart_test.sql`; tarihsel kur, piyasa filtreleri, gerçekleşmiş kâr, eski eksik veriler, örnekleme sınırı, kullanıcı izolasyonu ve sıfırlama zincirini test verilerini geri alarak doğrular.

## Push Bildirimleri

FinBot/AWS bildirimleri zamanlar ve Expo Push Service üzerinden gönderir. Lucrari yalnız mevcut Supabase oturumuyla `register_push_device`, `unregister_push_device`, `get_notification_preferences_v2` ve `set_notification_preferences_v2` RPC'lerini çağırır. Mobil uygulama `notifications` şemasındaki tablolara erişmez; servis anahtarı içermez. Bu RPC'lerin FinBot bildirim migration'ıyla hedef Supabase ortamına kurulmuş olması gerekir.

- EAS proje kimliği `b44b6f90-e455-41e3-964b-1c3e7f9f4323`; mevcut worker için kayıt ortamı tüm build profillerinde `production` kullanılır. Development/preview cihazları da gerçek bildirim alır.
- Gerçek iOS/Android cihaz ve yeni development, preview veya production build gerekir. Expo Go ve web'de cihaz kaydı yapılmaz. Native paket/plugin değişikliği nedeniyle eski yüklü build yeterli değildir.
- EAS tarafında iOS APNs anahtarı ve Android FCM v1 gönderim bilgileri yapılandırılmalıdır. Android için ilgili Firebase uygulamasının `google-services.json` dosyası `GOOGLE_SERVICES_JSON` adlı EAS file environment variable ile sağlanmalıdır. `app.config.ts`, verilen build dosyası yolunu `expo.android.googleServicesFile` alanına bağlar. Yerelde aynı değişken dosya yolu olarak kullanılabilir. Bu dosya Firebase istemci yapılandırmasıdır; FCM servis hesabı anahtarı değildir. Repoda bu dosya veya gönderim kimlik bilgileri bulunmaz. iOS bundle kimliği `com.merticon.Lucrari`, Android paket adı `com.merticon.lucrari` olarak yapılandırılmıştır.
- Oturum hazır olunca ilk sistem izin isteği yapılır. Ret sonrası otomatik tekrar sorulmaz; Menü → Bildirimler üzerinden cihaz kaydı tekrar denenebilir veya telefon ayarları açılabilir. Token değişiminde, oturum yenilendiğinde ve uygulama yeniden öne geldiğinde kayıt güncellenir. Token dinleyicisinin verdiği native token doğrudan Expo token isteğinde kullanılır; aynı token için tekrar gelen olaylar kayıt döngüsü başlatmaz. Ağ hatası ana uygulamayı engellemez; tekrar deneme ayarlardan veya sonraki öne gelme/oturum olayından yapılır.
- Kurulum UUID'si, izin isteği işareti ve RPC'nin döndürdüğü kullanıcıya bağlı cihaz kimliği AsyncStorage'da saklanır. Push token kalıcı saklanmaz ve loglanmaz. Cihazda uygulama verilerinin silinmesi kurulum kimliğini yeniler.
- Hesap geçişi ve `resetAccountSession` ile çıkıştan önce cihaz kaydı kaldırılır; devam eden kayıt işlemleri beklenir veya iptal edilir. Kaldırma başarısızsa hesap geçişi yapılmaz. Yeni çıkış/hesap değiştirme giriş noktaları `withAccountTransition` kullanmalıdır. Menüdeki yatırım sıfırlama mevcut oturumu korur; bildirim kaydını kaldırmaz.
- Menü → Bildirimler yedi bağımsız bildirimi iki kategori kartında yönetir: **Portföy bildirimleri** (`earnings_morning`, `earnings_midday`, `daily_portfolio`, `watchlist_earnings`) ve **Genel bildirimler** (`economic_reminders`, `earnings_today`, `earnings_tomorrow`). TR/US ülkeleri ve dahil edilen minimum önem eşiği (1–3) ayrıca korunur. Saat dilimi mobil arayüzde gösterilmez veya düzenlenmez; diğer tercihleri kaydederken backend’den gelen saat dilimi korunur. Tercihler varsayılan değer tahmin edilmeden RPC'den okunur. Backend programı: portföy özeti 10.00, genel bugünkü bilanço özeti 10.15, şirket bazlı hatırlatmalar 13.30’dan itibaren 15 dakika arayla, takip listesi özeti 14.30, yarınki bilançolar 20.00. Ekonomik hatırlatmalar etkinlikten 180/60/15 dakika önce gönderilir; ülke/önem filtreleri yalnız bunlara uygulanır. Günlük kâr/zarar Türkiye saatiyle 00.00 itibarıyla dünkü tamamlanmış değerlemeye dayanır. Saatler ve saat dilimi ayar ekranında gösterilmez. Setter, yalnız değişen alanı değil mevcut yedi boolean dahil tüm v2 tercihlerini gönderir; başarısız okuma/kayıt kullanıcıya hata gösterir ve kaydedildi durumuna geçmez.
- Bildirime dokunma oturum ve yönlendirme hazır olana kadar bekler. `earnings_morning` ilgili günün portföy bilanço listesini, `earnings_midday` ilgili şirket etkinliğini, `watchlist_earnings` kullanıcının takip listesi bilançolarını, `earnings_today`/`earnings_tomorrow` payload’daki günün tüm katalog bilançolarını açar. `economic_reminder` ilgili ekonomik etkinliği açar; tercih adı çoğul `economic_reminders` iken push tipi tekildir. Daha önce teslim edilmiş `macro_morning` bildirimlerinin takvim bağlantısı geriye uyumluluk için korunur; bu tercih artık v2 ayarlarında bulunmaz. En fazla 20 ID içeren payload tam liste yerine kullanılmaz; ekran veriyi yeniden yükler. Makro bildirimlerinde günlük gruplama ve saatler tercihlerdeki saat dilimini kullanır; aylık önbellek saat dilimine göre ayrılır.
- Portföy ve genel bugünkü bilanço özetleri, kaynak güncel ve başarılıyken boş günde de bilgi verebilir. Yarınki bilanço listesi boşsa gönderilmez. Takip listesi özetinde şirket bazlı portföy hatırlatmaları açıkken portföydeki şirketlerin tekrarlanmamasını backend sağlar. Bilanço bildirimleri beklenen açıklama günü hatırlatmalarıdır; sonuçların yayımlandığı anlamına gelmez.
- `daily_portfolio` yalnız bildirimin `portfolio_id`, `snapshot_id`, `valuation_date` ve `currency` değerleriyle eşleşen tarihsel kaydı mevcut RLS yetkileriyle okur. Bu sayfada yalnız ilgili günün kâr/zararı gösterilir; toplam portföy değeri sorgulanmaz veya gösterilmez. Günlük değişim, karşılaştırılabilir önceki günün `absolute_pnl_base` farkıdır; önceki veri yoksa sıfır gösterilmez. Güncel fiyatlarla eski bildirim yeniden hesaplanmaz.
- Payload keyfi URL açamaz. Bilinmeyen sürüm/tür, geçersiz alanlar ve geleceğe ayrılan `analysis_ready` ana ekrana yönlenir. Aynı yanıt tekrar yönlendirme oluşturmaz. Uygulama açıkken bildirim gösterilir; kullanıcı dokunmadan ekran değiştirilmez.

Otomatik testler `tests/notification*.test.ts`, `tests/hooks/notification*.test.tsx` ve `tests/app/notifications.test.tsx` altında; takvim bağlantıları `tests/app/home.test.tsx` içinde doğrulanır. Mevcut her dizin için dört kapsam ölçütünde %85 CI barajı korunur.

Gerçek cihaz kabul testi: yeni build yükleyin, izin verin ve cihaz kaydını doğrulayın; tercihi değiştirip ekranı yeniden açın; FinBot üzerinden yedi tür push alın; açık, arka plan ve kapalı uygulamada dokunmayı deneyin; tarihsel özetin bildirim günüyle eşleştiğini doğrulayın; hesap geçişinden sonra eski cihaz kaydının kaldırıldığını kontrol edin. EAS kimlik bilgileri ve gerçek teslimat, Jest veya JavaScript paketleme testleriyle kanıtlanamaz.


## Açılış Ekranı

Native açılış ekranı `expo-splash-screen` config plugin'iyle yapılandırılır. Açık temada `Lucrari_logo_light.png`, koyu temada `Lucrari_logo_dark.png` kullanılır. İki görsel de şeffaf ve yumuşatılmış kenarlıdır; beyaz zeminli eski `splash-icon.png` açılış ekranında kullanılmaz. Logo 180 birim genişlikte ortalanır; zeminler uygulamanın `#F8F6F7` ve `#171416` tema renkleridir. Tema varyantını cihazın sistem teması seçer. Ana içerik hazır olduğunda iOS açılış ekranı 300 ms solma efektiyle kapanır; oturumun hazırlanmasını bekleyen mevcut akış korunur.

Görsel veya plugin ayarı değişiklikleri yeni native build gerektirir; Metro Reload yeterli değildir. Expo SDK 54'te development build açılış ekranının tüm native özelliklerini yansıtmayabilir. Görünümü gerçek cihazda yeni **preview** veya production build ile, uygulamayı tamamen kapatıp açık/koyu sistem temalarında yeniden açarak doğrulayın.


## Etkileşim Geri Bildirimi ve Hareket

- Tüm uygulama titreşimleri `services/feedback/haptics.ts` üzerinden geçer. Seçimlerde hafif seçim geri bildirimi, içerik açılışında hafif dokunma, işlem sonucunda başarı/hata geri bildirimi kullanılır. Web'de titreşim çalıştırılmaz; native hata veya desteklenmeyen donanım kullanıcı işlemini durdurmaz. Pozisyon kartı açılışında üst ekran aynı dokunuşu ikinci kez titreştirmez.
- Başarılı nakit ve alış/satış kayıtları, veri kaydı tamamlandıktan sonra ortak `FeedbackToast` ile bildirilir. Mesaj dört saniyede kapanır veya elle kapatılır; yeni başarı eskisini değiştirir. Bu mesajlar sistem push bildirimi değildir. Kayıt hataları ve kullanıcı kararı gerektiren onay/aksiyon pencereleri korunur.
- İlk portföy, izleme listesi ve günlük takvim yüklemesi `LoadingSkeleton` kart taslaklarını kullanır. Taslaklarda sahte finansal değer bulunmaz; sürekli yanıp sönen animasyon kullanılmaz. Mevcut veri varken yenilemede kartlar ve takvim olayları korunur.
- Filtrelerde ve başarı mesajlarında 180 ms geçişler, izleme listesi genişletmede native layout geçişi kullanılır. Finansal rakamlar animasyonla saydırılmaz. Modallar kısa fade geçişi kullanır; işlem formunun sekme hareketi kısaltılmıştır.
- `useReducedMotion` sistemin Hareketi Azalt tercihini okur ve açık uygulamadaki değişiklikleri dinler. Tercih okunana kadar hareket kapalıdır. Tercih açıkken yeni geçişler, modal animasyonu ve ana sayfa parallax hareketi devre dışıdır. Animasyonlar unmount/tercih değişiminde, mesaj zamanlayıcıları mesaj değişimi/unmount durumunda temizlenir.

Doğrulama: `tests/feedback.test.ts`, `tests/hooks/reduced-motion.test.tsx`, `tests/ui/feedback.test.tsx` ve portföy ekran testleri ortak geri bildirim, süre/dismiss davranışı, kayıt öncesi başarı göstermeme ve hareket tercihlerini kapsar. Gerçek cihazda titreşim hissi, açık/koyu tema, VoiceOver/TalkBack ve Hareketi Azalt açık/kapalı görsel kontrolü ayrıca yapılmalıdır. Bu geliştirmeler mevcut native paketleri kullanır; yeni paket veya native yapılandırma gerektirmez.
