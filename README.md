# Şehir Savaşları • Online PvP

Bu klasör, oyunun iki ayrı bilgisayardan internet üzerinden oynanabilen sürümüdür.

## Senin yapacağın şey

1. Bu klasörün içindekileri bir GitHub reposuna yükle.
2. Render.com'da **New → Blueprint** seç.
3. GitHub reposunu seç.
4. **Deploy Blueprint** düğmesine bas.
5. Render sana `https://...onrender.com` şeklinde bir oyun adresi verir.
6. İkiniz de aynı adresi açın. Biri **Yeni Oda Oluştur**, diğeri oda kodunu girip **Katıl** seçer.

Bu sürüm için kendi bilgisayarında Node.js çalıştırman gerekmez.

## Dosya yapısı

- `public/index.html` → oyun
- `server.js` → online oda ve WebSocket sunucusu
- `render.yaml` → Render'ın otomatik kurulum ayarı
- `package.json` → Node.js proje ayarı
- `start.bat` → sadece bilgisayarda local test etmek için

## Render ayarı

`render.yaml` Node web servisini Frankfurt bölgesinde ücretsiz planla tanımlar. Render, Blueprint dosyasını repo kökünde bulup servis ayarlarını buradan okuyabilir.

Render Web Service'leri WebSocket bağlantılarını destekler. İnternetteki tarayıcı bağlantısı HTTPS ise oyun otomatik olarak `wss://` kullanır.

## Önemli not

Bu ilk online sürümde Oyuncu 1 host olarak oyun motorunu çalıştırır. Gerçek üretim oyunu için oyun kurallarını tamamen sunucu tarafına taşımak ve host düşerse oyunu devam ettirecek oda sahipliği mekanizması eklemek gerekir.
