# LiveALT

LiveALT je statický, zdarma provozovatelný dashboard pro Binance USDⓈ-M Futures breadth:

- denně inkrementálně udržuje `1d` OHLCV data po symbolech
- počítá historickou breadth metriku `% symbolů nad 30W MA`
- generuje aktuální seznamy symbolů nad a pod 30W MA
- počítá normalizovanou vzdálenost od MA přes ATR%
- vytváří similarity mapu kryptoměn z korelace denních výnosů
- publikuje výsledný web přes GitHub Pages

Celý provoz běží bez backendu a bez placených cloud služeb. Automatizace používá jen GitHub Actions a Binance veřejné REST endpointy.

## Architektura

Systém má dvě vrstvy:

1. Python pipeline v `src/livealt/`
   - objevuje aktuální univerzum aktivních Binance USDT perpetual futures
   - inkrementálně dotahuje chybějící denní data
   - ukládá denní OHLCV do `data/klines_1d/SYMBOL/YYYY.parquet`
   - počítá breadth, snapshoty, lifecycle a similarity artefakty
   - generuje statické JSON do `outputs/api/`

2. Statický frontend v `site/`
   - načítá jen JSON soubory z `site/public/data`
   - nic nepočítá serverově
   - buildne se přes Vite a nasadí na GitHub Pages

Adresářová struktura:

```text
.
├─ .github/workflows/daily-update.yml
├─ config/settings.yaml
├─ data/
│  ├─ klines_1d/
│  ├─ manifests/
│  ├─ logs/
│  └─ universe/
├─ outputs/
│  ├─ api/
│  └─ validation/
├─ site/
├─ src/livealt/
└─ tests/
```

## Jak funguje daily update

Každý běh udělá:

1. stáhne `exchangeInfo` z Binance Futures
2. vyfiltruje aktivní USDT perpetual symboly
3. uloží snapshot aktuálního universa
4. pro každý aktivní symbol stáhne jen chybějící `1d` svíčky
5. aktualizuje lifecycle registry a delist inference
6. spočítá breadth historii a aktuální snapshoty
7. spočítá korelační distance a similarity mapu
8. zvaliduje JSON výstupy
9. buildne frontend a publikuje Pages

Při selhání jednoho symbolu pipeline pokračuje dál. Stav jednotlivých symbolů je uložen v `data/manifests/symbol_status.json`.

## Datový model

### Raw market data

- hlavní formát je Parquet
- data jsou uložena po symbolech a po rocích
- repo verzují jen `1d` OHLCV, ne `1m`

Výhody:

- denní diffy v gitu zůstávají malé
- update nepřepisuje zbytečně celou historii
- výpočty jsou rychlé a čitelné

### Universe a lifecycle

Universe je uložen do:

- `data/universe/snapshots/YYYY-MM-DD.json`
- `data/universe/latest.json`
- `data/universe/history.parquet`
- `data/manifests/lifecycle_registry.json`

Lifecycle registry drží pro každý symbol:

- `first_seen_date`
- `last_seen_active_date`
- `first_data_date`
- `last_data_date`
- `listing_date_inferred`
- `delisted_date_inferred`
- `status`

To je důležité kvůli survivorship bias.

## Jak je ošetřen survivorship bias

Breadth se nepočítá proti dnešnímu seznamu symbolů.

Místo toho má každý symbol vlastní lifecycle interval:

- začíná inferred listing date
- končí inferred delist date

Symbol se do historických výpočtů zahrne jen tehdy, když:

- byl v daný den aktivní podle lifecycle
- a zároveň už měl dost historie pro 30W MA

Po delistu symbol v datech zůstává, ale od následujících dnů už nevstupuje do breadth, snapshotů ani clusteringu.

## 30W MA metodika

Dashboard potřebuje denní rozhodnutí nad/pod 30W MA. Proto nepoužívá týdenní endpoint jako primární zdroj.

Použitá definice:

- `30W MA = 210denní trailing průměr denních close`

To je praktická, denně aktualizovatelná a interně konzistentní aproximace 30 týdnů z daily dat.

Eligible symbol pro den `D`:

- je aktivní v den `D`
- má alespoň 210 denních close do dne `D`
- má validní `close` a `ma_30w`

Breadth historie obsahuje:

- `date`
- `eligible_count`
- `above_count`
- `above_pct`

`above_pct` je uložen v procentech `0-100`.

## Distance metriky

### Raw distance

```text
(close / ma_30w - 1) * 100
```

### Normalized distance

```text
normalized_distance = raw_distance_pct / ATR%(60)
```

Kde:

- `ATR%(60) = 60denní ATR / close * 100`

Tím se omezí dominance extrémně volatilních meme coinů a tabulky jsou použitelnější napříč různými typy symbolů.

### Momentum

```text
momentum_30d_pct = (close / close před 30 dny - 1) * 100
```

Záložka `MA Distance` používá 2D scatter:

- osa X: 30denní momentum
- osa Y: vzdálenost od 30W MA, raw nebo normalizovaná podle zvoleného přepínače
- top-right: silné momentum a cena vysoko nad 30W MA
- bottom-left: slabé momentum a cena pod 30W MA

## Similarity mapa

Similarity mapa není ML pipeline pro research, ale praktická analytická vrstva pro dashboard.

Použitá metodika:

- vstup: denní log returny
- okno: posledních 60 dní
- distance: `sqrt(0.5 * (1 - correlation))`
- embedding: 2D t-SNE projekce nad předpočítanou korelační distance maticí
- interpretace: body blízko sebe měly podobné nedávné denní pohyby
- neinterpretuj absolutní směr os; mapa je relativní lokální sousedství

Pipeline stále interně počítá aglomerativní clustering s average linkage a `min_cluster_size`, ale frontend primárně zobrazuje spojitou similarity mapu místo pevně pojmenovaných skupin. Důvod je praktičnost: pro stovky altcoinů je mapa často čitelnější než rigidní seznam clusterů.

## Lokální spuštění

### 1. Instalace

```bash
python -m pip install -e .[dev]
npm install --prefix site
```

### 2. Volitelný bootstrap z lokálního parquet skladu

Pokud máš k dispozici lokální `1m` Binance warehouse:

```bash
python -m livealt.cli --config config/settings.yaml bootstrap-local \
  --source-root /mnt/d/AlgoWorkflows/RawAlgoData/crypto/binance_klines_1m/CryptoMVP_raw/binance_um/klines_1m
```

Tenhle krok není nutný pro produkční běh v GitHub Actions. Je pouze pro rychlejší inicializaci historie lokálně.

### 3. Spuštění pipeline

```bash
python -m livealt.cli --config config/settings.yaml run
```

### 4. Validace

```bash
python -m livealt.cli --config config/settings.yaml validate
pytest -q
```

### 5. Frontend

```bash
npm --prefix site run build
```

Pro lokální vývoj webu:

```bash
npm --prefix site run dev
```

## GitHub Pages deploy

Workflow `.github/workflows/daily-update.yml` dělá:

- scheduled daily run
- manual run přes `workflow_dispatch`
- Python pipeline
- testy a validaci
- commit změněných `data/` a `outputs/`
- build Vite webu
- deploy na GitHub Pages

### Nutné jednorázové GitHub nastavení

1. `Settings -> Pages`
2. v `Source` nastav `GitHub Actions`
3. `Settings -> Actions -> General`
4. v `Workflow permissions` zapni `Read and write permissions`
5. ulož nastavení

Bez těchto dvou kliknutí nebude workflow schopné:

- pushnout aktualizovaná data zpět do branch
- publikovat web přes Pages

## Hlavní výstupy

V `outputs/api/` vznikají:

- `overview.json`
- `breadth_history.json`
- `above_30w_ma.json`
- `below_30w_ma.json`
- `clusters.json`
- `methodology.json`
- `schema_version.json`

Frontend čte jejich kopii z `site/public/data/`.

## Konfigurace

Hlavní parametry jsou v `config/settings.yaml`:

- Binance endpointy a retry limity
- filtrace universa
- délka MA, ATR a momentum okna
- similarity / cluster parametry
- bootstrap chování
- minimální poměr úspěšných symbol updateů

## Známá omezení

- Produkční běh v GitHub Actions nevidí tvůj lokální parquet sklad. Tam se vždy jede jen z Binance REST.
- Inference listingu a delistu je nejlepší po bootstrapu nebo po delším provozu snapshotů; historická data před prvním nasazením mohou být jen přibližně odvozena z prvního a posledního dostupného daily baru.
- Pokud Binance krátkodobě vrátí nestandardní stav symbolu, delist se potvrzuje až po několika chybějících snapshots, aby se omezily falešné delisty.
- Repo stále poroste s historií `1d` dat, ale výrazně pomaleji než při ukládání intraday dat.

## Když workflow selže

Zkontroluj:

1. záložku `Actions` a log běhu
2. `data/manifests/symbol_status.json`
3. `outputs/validation/latest_validation_report.json`
4. `data/logs/pipeline.log`

Typické příčiny:

- Binance rate limit nebo dočasný HTTP problém
- příliš nízký podíl úspěšných symbol updateů
- chybějící GitHub Pages nebo Actions write permissions
- chybějící frontend dependencies při prvním běhu

## Rozšíření do budoucna

Repo je připravené na další rozšíření bez změny architektury:

- další breadth metriky
- více snapshot tabulek
- funding nebo OI doplňky
- další statické stránky nad stejnými JSON artefakty
