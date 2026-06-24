// =====================================================
// VVS-WRAPPED.JS  –  V.V.S Rotselaar  (v3 – Animated)
// Toont een Spotify-Wrapped-stijl slideshow voor de
// ingelogde speler als de admin dit heeft ingeschakeld.
//
// Firestore-afhankelijkheden (read-only):
//   settings/siteSettings → { wrappedEnabled: bool }
//   users/{uid}           → stats: goals, assists, matchen,
//                           minuten, geel, rood, motmPunten
// =====================================================

import { db } from './firebase-config.js';
import {
    doc, getDoc, collection, query, where, getDocs
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ── Triggered vanuit app.js na auth ──────────────────────────────────────────
export async function checkAndShowWrapped(user, userData) {
    if (!user || !userData) return;

    try {
        const settingsSnap = await getDoc(doc(db, 'settings', 'siteSettings'));
        if (!settingsSnap.exists() || !settingsSnap.data().wrappedEnabled) return;

        const userSnap = await getDocs(
            query(collection(db, 'users'), where('uid', '==', user.uid))
        );
        if (userSnap.empty) return;
        const stats = userSnap.docs[0].data();

        const seasonKey    = settingsSnap.data().wrappedSeasonKey || 'default';
        const dismissedKey = `vvs_wrapped_dismissed_${user.uid}_${seasonKey}`;
        if (localStorage.getItem(dismissedKey) === '1') return;

        const slides = buildSlides(stats);
        if (slides.length === 0) return;

        showWrappedModal(slides, stats.naam || stats.name || 'Speler', user, dismissedKey);

    } catch (e) {
        console.warn('[Wrapped] Kon niet laden:', e);
    }
}

// ── Willekeurige tekst picker ─────────────────────────────────────────────────
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ── Slide-builder ─────────────────────────────────────────────────────────────
function buildSlides(s) {
    const slides = [];
    const voornaam = (s.naam || s.name || 'Speler').split(' ')[0];
    const goals   = s.goals       ?? s.Goals       ?? 0;
    const assists = s.assists     ?? s.Assists     ?? 0;
    const matchen = s.matchen     ?? s.matches     ?? 0;
    const minuten = s.minuten     ?? s.minutes     ?? 0;
    const geel    = s.geelKaarten ?? s.geel ?? s.yellowCards ?? 0;
    const rood    = s.roodKaarten ?? s.rood ?? s.redCards    ?? 0;
    const motm    = s.motmPunten  ?? 0;

    const allZero = goals === 0 && assists === 0 && matchen === 0
                 && minuten === 0 && motm === 0;

    // ── Welkomstslide ─────────────────────────────────────────────────────────
    if (!allZero) {
        slides.push({
            type: 'intro',
            icon: 'assets/logo.png', iconInvert: false,
            title: `${voornaam}'s`,
            subtitle: 'VVS WRAPPED',
            desc: pick([
                'Jouw seizoen in cijfers. Swipe of klik om verder te gaan.',
                'Dit is jouw seizoen bij VVS. Klaar voor de hoogtepunten?',
                'Een heel seizoen samengevat. Geniet ervan!',
                'Swipe door jouw persoonlijke VVS-terugblik!',
                'Elk doelpunt. Elke minuut. Elke kaart. Dit is jouw verhaal.',
                `${voornaam}, dit was geen gewoon seizoen. Klik door en ontdek het zelf!`,
                'Van de eerste fluittoon tot het laatste fluitsignaal — dit is jouw jaar.',
            ]),
            bg: 'linear-gradient(135deg, #0B1D3A 0%, #0047AB 100%)',
            color: '#fff',
            accent: '#7eb8ff',
            animClass: 'anim-intro',
        });
    }

    // ── Matchen ───────────────────────────────────────────────────────────────
    if (matchen > 0) {
        const desc = matchen >= 25
            ? pick([
                `${matchen} matchen — bijna elke speeldag stond jij op het veld. Legendarisch!`,
                `De ploeg kon blindelings op jou rekenen. ${matchen} keer er zijn is geen toeval.`,
                `${matchen} wedstrijden! Jij bent de rots waarop VVS gebouwd is dit seizoen.`,
                `Hoeveel ploegmaats haalden ${matchen} matchen? Jij wel. Wat een toewijding!`,
            ])
            : matchen >= 20
            ? pick([
                `${matchen} matchen — dat noemen ze toewijding van het hoogste niveau!`,
                `${matchen} keer het shirt aantrekken, en élke keer alles geven. Respect!`,
                `Elke wedstrijd klaarstaan voor VVS vraagt meer dan talent alleen. ${matchen} keer bewezen!`,
                `${matchen} matchen gespeeld — de coach wist altijd op jou te rekenen.`,
            ])
            : matchen >= 15
            ? pick([
                `${matchen} matchen — je was er wanneer het telde. Solide seizoen!`,
                `Meer dan twee derde van het seizoen actief? ${matchen} matchen is indrukwekkend.`,
                `${matchen} keer opgekomen voor VVS — de ploeg voelde jouw aanwezigheid.`,
                `Vijftien of meer matchen is geen toevalstreffer. Dat is consistentie.`,
            ])
            : matchen >= 10
            ? pick([
                `${matchen} matchen — de ploeg wist dat jij er was wanneer het telde.`,
                `${matchen} keer het veld op, ${matchen} keer gegeven. Goed bezig!`,
                `Meer dan de helft van het seizoen actief. ${matchen} matchen — dat is inzet!`,
                `${matchen} wedstrijden meegespeeld — de basis voor een nóg beter seizoen!`,
            ])
            : matchen >= 6
            ? pick([
                `De helft van het seizoen meegespeeld — en élke keer vol gegeven.`,
                `${matchen} matchen — goed voor een mooie bijdrage aan het team.`,
                `Niet elke match, maar als jij er was, voelde de ploeg het verschil.`,
                `${matchen} keer het veld op. Elke minuut die je speelde was er eentje waard.`,
            ])
            : matchen >= 3
            ? pick([
                `${matchen} matchen dit seizoen — elke keer dat jij meedeed, maakte je het verschil.`,
                `Soms telt kwaliteit meer dan kwantiteit. ${matchen} matchen, maar altijd aanwezig.`,
                `${matchen} keer het VVS-shirt gedragen. Elk moment was er eentje om in te kaderen.`,
            ])
            : pick([
                `Weinig matchen dit seizoen, maar kwaliteit boven kwantiteit telt ook!`,
                `${matchen} keer het shirt van VVS gedragen — elk moment was er eentje waard.`,
                `Weinig matchen, maar wie weet wat volgend seizoen brengt!`,
                `${matchen} match${matchen > 1 ? 'en' : ''} — een begin. Volgend seizoen gaan we voor meer!`,
            ]);
        slides.push({
            type: 'stat', icon: 'assets/calender.png', iconInvert: true,
            label: 'MATCHEN GESPEELD',
            value: matchen, rawValue: matchen,
            desc,
            bg: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
            color: '#fff', accent: '#4fc3f7',
            animClass: 'anim-count',
        });
    }

    // ── Minuten ───────────────────────────────────────────────────────────────
    if (minuten > 0 && matchen > 0) {
        const gem = Math.round(minuten / matchen);
        const sec = (minuten * 60).toLocaleString('nl-BE');
        const desc = gem >= 85
            ? pick([
                `Bijna élke minuut van élke match! ${minuten.toLocaleString('nl-BE')} min is leveren pur sang.`,
                `${minuten.toLocaleString('nl-BE')} minuten — de coach kon je gewoon niet van het veld halen!`,
                `Gemiddeld ${gem} min per wedstrijd. Jij speelt als een machine die nooit stopt.`,
                `${sec} seconden lang VVS-voetbal. De tegenstander werd moe van jou te zien.`,
            ])
            : gem >= 70
            ? pick([
                `Jij was er bijna de volledige tijd. ${minuten.toLocaleString('nl-BE')} minuten — respect!`,
                `Gemiddeld ${gem} min per wedstrijd. De coach vertrouwde blindelings op jou.`,
                `${minuten.toLocaleString('nl-BE')} minuten op het veld — de tegenstander zag je véél te veel!`,
                `Dat zijn ${sec} seconden pure VVS-toewijding. Indrukwekkend!`,
            ])
            : gem >= 55
            ? pick([
                `Gemiddeld ${gem} minuten per match — dat is maar liefst ${sec} seconden VVS-voetbal!`,
                `${minuten.toLocaleString('nl-BE')} minuten op het veld. Een sterke bijdrage elke speeldag.`,
                `${sec} seconden lang het shirt van VVS dragen — dat is geen toeval.`,
                `Meer dan een uur gemiddeld per wedstrijd. ${minuten.toLocaleString('nl-BE')} minuten totaal!`,
            ])
            : gem >= 40
            ? pick([
                `${minuten.toLocaleString('nl-BE')} minuten gespeeld — gemiddeld ${gem} min per wedstrijd. Elke minuut telt!`,
                `Dat zijn ${sec} seconden pure inzet voor de ploeg. Goed bezig!`,
                `${gem} minuten gemiddeld — jij gaf je kans als het ertoe deed.`,
                `${minuten.toLocaleString('nl-BE')} minuten VVS-voetbal dit seizoen. Solide bijdrage!`,
            ])
            : gem >= 20
            ? pick([
                `${minuten.toLocaleString('nl-BE')} minuten — misschien niet altijd de volle negentig, maar altijd impact.`,
                `${gem} minuten gemiddeld — jij was een wapen van de bank af of in de beginfase.`,
                `Kort maar krachtig: ${minuten.toLocaleString('nl-BE')} minuten actie voor VVS.`,
            ])
            : pick([
                `${minuten.toLocaleString('nl-BE')} minuten — dat klinkt als ${sec} seconden pure inzet!`,
                `Elke minuut op het veld telt. En jij had er ${minuten.toLocaleString('nl-BE')} van!`,
                `${minuten.toLocaleString('nl-BE')} minuten VVS. Volgend seizoen gaan we voor meer speeltijd!`,
            ]);
        slides.push({
            type: 'stat', icon: 'assets/stopwatch.png', iconInvert: true,
            label: 'MINUTEN OP HET VELD',
            value: minuten.toLocaleString('nl-BE'), rawValue: minuten,
            desc,
            bg: 'linear-gradient(135deg, #0d2137 0%, #1a4a6e 100%)',
            color: '#fff', accent: '#80deea',
            animClass: 'anim-count',
        });
    }

    // ── Goals ──────────────────────────────────────────────────────────────────
    if (goals > 0) {
        const desc = goals >= 25
            ? pick([
                `${goals} goals — een absolute legende! Het net trilde dit seizoen van angst voor jou.`,
                `${goals} keer raak. De topschutterslijst kende maar één naam: die van jou.`,
                `${goals} goals is geen seizoen, dat is een meesterwerk. Ongelooflijk!`,
                `De doelman sidderde bij jouw naam. ${goals} goals — ga zo voort en je wordt VVS-icoon!`,
            ])
            : goals >= 20
            ? pick([
                `${goals} goals — een echte topschutter! De doelman sidderde bij jouw naam.`,
                `${goals} keer raak — jij bent de ster van de aanval. Indrukwekkend!`,
                `Doelpunt na doelpunt. ${goals} goals is geen toeval, dat is klasse.`,
                `${goals} keer vieren — jij weet hoe het voelt om een held te zijn!`,
            ])
            : goals >= 15
            ? pick([
                `${goals} goals — de defensie van de tegenstander had het moeilijk met jou.`,
                `Vijftien of meer goals in één seizoen? Dat is serieuze aanvalskracht!`,
                `${goals} keer het net vinden — jij bent onmisbaar voorin voor VVS.`,
                `${goals} goals dit seizoen. De coach wist: als hij speelt, vallen er goals.`,
            ])
            : goals >= 10
            ? pick([
                `Dubbele cijfers! ${goals} goals is een seizoen om in te kaderen.`,
                `${goals} goals — de keeper wist niet wat hem overkwam. Fantastisch!`,
                `Tien of meer is geen geluk, dat is talent. ${goals} goals dit seizoen!`,
                `${goals} keer raak! Jij weet hoe je een wedstrijd beslist. Knap gedaan!`,
            ])
            : goals >= 7
            ? pick([
                `${goals} goals — bijna in dubbele cijfers! Nog een beetje en jij domineert de topschutterslijst.`,
                `${goals} keer vieren dit seizoen. De keeper had moeite met jou!`,
                `${goals} goals is een sterk seizoen. Die cijfers blijven niet onopgemerkt!`,
            ])
            : goals >= 5
            ? pick([
                `${goals} goals — elke treffer was goud waard voor de ploeg!`,
                `Vijf of meer goals in een seizoen is écht iets om trots op te zijn.`,
                `${goals} keer het net doen trillen. Jij weet hoe het moet!`,
                `${goals} goals — de aanval draait mee dankzij spelers zoals jij.`,
            ])
            : goals >= 3
            ? pick([
                `${goals} goals dit seizoen — elke keer dat jij scoorde was het een feestje!`,
                `${goals} keer raak. Klein getal, grote impact voor de ploeg.`,
                `${goals} goals — de basis voor een nóg scherper seizoen volgend jaar!`,
            ])
            : goals === 2
            ? pick([
                `2 goals — dubbel feest voor VVS! Elke treffer telde.`,
                `Twee keer het net vinden — beide goals waren goud waard.`,
                `2 goals gescord dit seizoen. Volgend jaar mikken we op méér!`,
            ])
            : pick([
                `1 goal — en elke goal telt. Die ene zal je nooit vergeten!`,
                `Eén treffer, maar wat een treffer. Jij scoorde voor VVS!`,
                `Het enige dat telt is dat er eentje binnenging. Goed gedaan!`,
                `1 goal — het begin van een mooie doelpuntenhistorie bij VVS!`,
            ]);
        slides.push({
            type: 'stat', icon: 'assets/goal.png', iconInvert: true,
            label: 'GOALS GESCOORD',
            value: goals, rawValue: goals,
            desc,
            bg: 'linear-gradient(135deg, #1b4332 0%, #2d6a4f 100%)',
            color: '#fff', accent: '#b7e4c7',
            animClass: 'anim-count',
        });
    }

    // ── Assists ───────────────────────────────────────────────────────────────
    if (assists > 0) {
        const desc = assists >= 20
            ? pick([
                `${assists} assists! Jij bent de architect van het spel. Zonder jou valt er geen goal.`,
                `${assists} keer de perfecte pass — de topscorer dankt jou voor elk doelpunt.`,
                `${assists} assists is fenomenaal. Je ploegmaats weten: als jij speelt, worden zij beter.`,
            ])
            : assists >= 15
            ? pick([
                `${assists} assists! De spelmaker van de ploeg — zonder jou vallen er geen goals.`,
                `${assists} keer de beslissende pass. Jij maakt je ploegmaats onverslaanbaar!`,
                `Assistkoning! ${assists} assists is een cijfer om trots op te zijn.`,
                `${assists} assists — de doelmannen van de tegenstander haten het als jij de bal heeft.`,
            ])
            : assists >= 10
            ? pick([
                `${assists} assists — jij deelt uit als geen ander. De ploeg draait op jou!`,
                `${assists} keer de beslissende pass gegeven. Dat is teamplay op zijn best.`,
                `De spitsen danken jou. ${assists} assists is serieus werk!`,
                `Dubbele cijfers in assists — jij ziet passes die anderen gewoon niet zien.`,
            ])
            : assists >= 7
            ? pick([
                `${assists} assists — een sterke bijdrage aan het doelpuntenfestijn van VVS!`,
                `${assists} keer de juiste pass op het juiste moment. Jij denkt sneller dan anderen.`,
                `${assists} assists is bijna dubbele cijfers. Nog even en jij domineert het middenveld!`,
            ])
            : assists >= 4
            ? pick([
                `${assists} assists — de scorers danken jou. Zonder jou geen goals!`,
                `${assists} keer de juiste pass op het juiste moment. Goed werk!`,
                `${assists} assists — jij ziet het spel zoals weinigen dat doen.`,
                `${assists} keer een ploegmaat in een goeie positie gebracht. Teamspeler in hart en nieren!`,
            ])
            : assists >= 2
            ? pick([
                `${assists} assists — elke perfecte pass die eindigde in een goal is er eentje om te koesteren.`,
                `${assists} keer de beslissende pass geven — dat vraagt inzicht en timing.`,
                `${assists} assists dit seizoen. Volgend jaar mikken we op nóg meer creativiteit!`,
            ])
            : pick([
                `1 assist — die ene pass die alles veranderde. Zo klein, zo groot.`,
                `Eén assist, maar wat een assist. Jij maakte een goal mogelijk!`,
                `Bescheiden maar doeltreffend — 1 assist die de ploeg hielp.`,
                `1 assist — het begin van een mooie assisthistorie bij VVS!`,
            ]);
        slides.push({
            type: 'stat', icon: 'assets/assist.png', iconInvert: true,
            label: 'ASSISTS GEGEVEN',
            value: assists, rawValue: assists,
            desc,
            bg: 'linear-gradient(135deg, #2c1654 0%, #4a0e8f 100%)',
            color: '#fff', accent: '#ce93d8',
            animClass: 'anim-count',
        });
    }

    // ── Goals + Assists samen ─────────────────────────────────────────────────
    if (goals > 0 && assists > 0) {
        const totaal = goals + assists;
        slides.push({
            type: 'double', icon: 'assets/goal.png', iconInvert: true,
            label: 'TOTALE BIJDRAGE',
            value1: goals, label1: 'Goals',
            value2: assists, label2: 'Assists',
            desc: pick([
                `${totaal} rechtstreekse betrokkenheden — jij bent onmisbaar voor VVS!`,
                `Goals én assists: jij was overal dit seizoen. ${totaal} keer betrokken bij een goal.`,
                `Scoren én creëren — ${totaal} bijdragen aan het scorebord. Dankjewel!`,
                `${totaal} keer een vinger in de pap. De coach weet wie zijn beste wapen is.`,
                `Goals + assists = ${totaal}. Dat is niet zomaar een getal, dat is impact.`,
                `Aanvallen en creëren in één pakket: ${totaal} bijdragen aan de overwinning van VVS.`,
            ]),
            bg: 'linear-gradient(135deg, #7b1fa2 0%, #1565c0 100%)',
            color: '#fff', accent: '#f8bbd9',
            animClass: 'anim-double',
        });
    }

    // ── MOTM-punten ───────────────────────────────────────────────────────────
    if (motm > 0) {
        const desc = motm >= 15
            ? pick([
                `${motm} MOTM-punten! De ploeg kiest keer op keer voor jou. Jij bent de publiekslieveling!`,
                `${motm} punten als Man van de Match — niemand straalt zo op het veld als jij.`,
                `Wedstrijd na wedstrijd de beste. ${motm} MOTM-punten is een statement.`,
                `De ploegmaats stemmen — en telkens dezelfde naam. ${motm} punten: jij bent de man.`,
            ])
            : motm >= 10
            ? pick([
                `${motm} MOTM-punten! De ploeg kiest keer op keer voor jou. Wat een seizoen!`,
                `${motm} punten als Man van de Match — jij bent de publiekslieveling.`,
                `Keer op keer de beste op het veld. ${motm} MOTM-punten spreekt voor zich!`,
                `${motm} punten — de fans weten wie de uitblinker is. En het is jij.`,
            ])
            : motm >= 7
            ? pick([
                `${motm} MOTM-punten — regelmatig de sterspeler van de dag. Dat is klasse!`,
                `${motm} punten — de ploeg weet wie er uitblinkt als het telt.`,
                `${motm} Man van de Match-punten. Meerdere keren de beste op het veld zijn.`,
            ])
            : motm >= 5
            ? pick([
                `${motm} MOTM-punten — meerdere keren de sterspeler van de dag. Knap!`,
                `${motm} punten — de ploeg weet wie er uitblinkt. Blijf zo presteren!`,
                `${motm} Man van de Match-punten. De fans zien hoe goed jij speelt!`,
                `${motm} punten — jij maakte indruk op je ploegmaats en ze stemden ervoor!`,
            ])
            : motm >= 3
            ? pick([
                `${motm} MOTM-punten — het publiek is overtuigd van jouw kwaliteiten.`,
                `${motm} keer de beste speler gekozen — dat is meer dan een coincidentie!`,
                `${motm} punten verdiend als uitblinker. Jij trekt de aandacht op het veld.`,
            ])
            : pick([
                `${motm} MOTM-punt${motm > 1 ? 'en' : ''} — de ploeg erkent jouw bijdrage. Ga zo door!`,
                `Man van de Match zijn is bijzonder. Jij weet hoe dat voelt!`,
                `${motm} punten verdiend — je maakte indruk op je ploegmaats.`,
                `MOTM-punten verdienen is niet vanzelfsprekend. Jij deed het!`,
            ]);
        slides.push({
            type: 'stat', icon: 'assets/assist.png', iconInvert: true,
            label: 'MOTM-PUNTEN',
            value: motm, rawValue: motm,
            desc,
            bg: 'linear-gradient(135deg, #7f5a00 0%, #d4a017 100%)',
            color: '#fff', accent: '#ffe082',
            animClass: 'anim-count',
        });
    }

    // ── Kaarten ───────────────────────────────────────────────────────────────
    if (!allZero) {
        let desc;
        if (rood >= 3) {
            desc = pick([
                `${rood} rode kaarten — de ref kende jou van voor naar achter. Wat een seizoen!`,
                `${rood} keer vroeg naar de kleedkamer. De passie is mooi, maar zo niet 😅`,
                `${rood} rode kaarten is een record op zich. Volgend jaar wat meer zen?`,
            ]);
        } else if (rood >= 2) {
            desc = pick([
                `${rood} rode kaarten — volgend seizoen iets minder temperament? Maar die passie is ook een kracht!`,
                `De ref kende jou goed dit jaar. ${rood} rode kaarten — probeer het rustiger aan te pakken.`,
                `Heetgebakerd? Dat kan, maar ${rood} rode kaarten is toch iets om over na te denken.`,
            ]);
        } else if (rood === 1) {
            desc = pick([
                `1 rode kaart — iedereen heeft weleens een slechte dag. Volgend jaar beter!`,
                `Eén keer de kleedkamer in voor tijd. Leer ervan en ga sterker terug!`,
                `Rood gezien dit seizoen — dat hoort erbij, maar probeer het te vermijden.`,
                `Eén rode kaart — niet ideaal, maar jij hebt bewezen dat je er bovenop kan komen.`,
            ]);
        } else if (geel >= 8) {
            desc = pick([
                `${geel} gele kaarten — de ref schreef jouw naam dit seizoen héél vaak neer!`,
                `${geel} keer geel: jij speelt vol passie, maar een beetje minder zou ook kunnen 😄`,
                `${geel} gele kaarten — de ref en jij zijn dit seizoen goede bekenden geworden.`,
            ]);
        } else if (geel >= 5) {
            desc = pick([
                `${geel} gele kaarten — de ref hield je goed in de gaten! Die inzet is bewonderenswaardig.`,
                `Vijf of meer gele kaarten: jij gaat altijd tot het uiterste. Maar pas op!`,
                `${geel} keer geel — je speelt met passie, maar een beetje minder zou ook kunnen 😄`,
                `${geel} gele kaarten — tussenin zitten. Genoeg passie, maar aan de grens.`,
            ]);
        } else if (geel >= 3) {
            desc = pick([
                `${geel} gele kaarten — de ref had zijn oogje op jou. Let iets meer op de discipline!`,
                `${geel} keer de naam genoteerd. Passie is mooi, maar discipline ook!`,
                `${geel} gele kaarten dit seizoen — kan beter, maar de inzet is er!`,
            ]);
        } else if (geel > 0) {
            desc = pick([
                `${geel} gele kaart${geel > 1 ? 'en' : ''} — een klein dipje in een verder goed seizoen.`,
                `${geel}x geel. Niet ideaal, maar het hoort bij het spel. Ga zo door!`,
                `${geel} keer de naam genoteerd door de scheidsrechter. Kan beter, maar je komt er!`,
                `${geel} gele kaart${geel > 1 ? 'en' : ''} — de inzet was er. Volgend seizoen iets kalmer?`,
            ]);
        } else {
            desc = pick([
                `0 kaarten! Een perfect seizoen qua discipline — de ref had jou niet nodig 👏`,
                `Geen enkele kaart dit seizoen. Dat is sportiviteit op zijn best. Geweldig!`,
                `Nul kaarten — jij speelt hard maar fair. Zo hoort het! Ga zo voort!`,
                `Schoon strafblad! Niet één kaart — de ref floot jou dit seizoen gewoon niet.`,
            ]);
        }
        slides.push({
            type: 'cards', icon: rood > 0 ? 'assets/red.png' : 'assets/yellow.png', iconInvert: false,
            label: 'KAARTEN DIT SEIZOEN',
            geel, rood,
            desc,
            bg: rood > 0
                ? 'linear-gradient(135deg, #4a0000 0%, #8b1a1a 100%)'
                : 'linear-gradient(135deg, #3e2000 0%, #7c4a03 100%)',
            color: '#fff', accent: '#ffd54f',
            animClass: 'anim-cards',
        });
    }

    // ── SAMENVATTING (shareable summary) ─────────────────────────────────────
    if (!allZero) {
        slides.push({
            type: 'summary',
            naam: (s.naam || s.name || 'Speler'),
            voornaam,
            goals, assists, matchen, minuten, geel, rood, motm,
            icon: 'assets/logo.png',
            bg: 'linear-gradient(160deg, #0B1D3A 0%, #003380 55%, #0047AB 100%)',
            color: '#fff',
            accent: '#4fc3f7',
            title: 'MIJN VVS SEIZOEN',
            animClass: 'anim-summary',
        });
    }

    // ── Eindslide ─────────────────────────────────────────────────────────────
    slides.push({
        type: 'outro',
        icon: 'assets/firework.png', iconInvert: false,
        title: pick([
            'Bedankt voor dit seizoen!',
            'Wat een jaar, ' + voornaam + '!',
            'Tot volgend seizoen!',
            voornaam + ', jij bent VVS!',
            'Jij maakt het verschil, ' + voornaam + '!',
            'Tot op het veld, ' + voornaam + '!',
        ]),
        desc: pick([
            'VVS Rotselaar is er dankzij spelers zoals jij. Tot volgend seizoen!',
            'Zonder jou is VVS niet compleet. Bedankt voor alles dit jaar!',
            'Een nieuw seizoen wacht. Klaar om er opnieuw vol voor te gaan?',
            'Jij bent de reden waarom VVS Rotselaar zo speciaal is. Dankjewel!',
            'Deel jouw samenvatting en laat iedereen zien wat jij dit seizoen deed!',
            'Elke wedstrijd, elke minuut, elke goal — het was de moeite waard.',
        ]),
        bg: 'linear-gradient(135deg, #0B1D3A 0%, #003380 100%)',
        color: '#fff',
        animClass: 'anim-outro',
    });

    return slides;
}

// ── Modal renderer ────────────────────────────────────────────────────────────
function showWrappedModal(slides, naam, user, dismissedKey) {
    document.getElementById('vvsWrappedModal')?.remove();

    let idx = 0;

    const modal = document.createElement('div');
    modal.id = 'vvsWrappedModal';
    modal.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:99990',
        'display:flex', 'align-items:center', 'justify-content:center',
        'background:rgba(0,0,0,0.92)', 'padding:1rem',
        'backdrop-filter:blur(8px)',
        'animation:vwFadeIn 0.5s ease',
    ].join(';');

    modal.innerHTML = `
<style>
/* ── Keyframes ── */
@keyframes vwFadeIn    { from { opacity:0 } to { opacity:1 } }
@keyframes vwSlideUp   { from { opacity:0; transform:translateY(40px) scale(0.95) }
                         to   { opacity:1; transform:none } }
@keyframes vwSlideLeft { from { opacity:0; transform:translateX(60px) scale(0.97) }
                         to   { opacity:1; transform:none } }
@keyframes vwPulse     { 0%,100% { transform:scale(1) } 50% { transform:scale(1.10) } }
@keyframes vwFloat     { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-8px) } }
@keyframes vwGlow      { 0%,100% { text-shadow:0 0 20px rgba(255,255,255,0.2) }
                         50%     { text-shadow:0 0 40px rgba(255,255,255,0.6), 0 0 80px rgba(100,200,255,0.3) } }
@keyframes vwShine     { 0%   { left:-100% }
                         60%  { left:120% }
                         100% { left:120% } }
@keyframes vwBounceIn  { 0%   { opacity:0; transform:scale(0.3) }
                         50%  { opacity:1; transform:scale(1.08) }
                         70%  { transform:scale(0.95) }
                         100% { transform:scale(1) } }
@keyframes vwFlashIn   { 0%   { opacity:0; transform:scale(2) }
                         40%  { opacity:1; transform:scale(0.95) }
                         100% { transform:scale(1) } }
@keyframes vwParticle  { 0%   { opacity:1; transform:translateY(0) scale(1) }
                         100% { opacity:0; transform:translateY(-120px) scale(0) } }
@keyframes vwCountUp   { from { opacity:0; transform:translateY(20px) }
                         to   { opacity:1; transform:none } }
@keyframes vwProgressFill { from { width:0 } to { width:100% } }
@keyframes vwReveal    { from { clip-path:inset(0 100% 0 0) }
                         to   { clip-path:inset(0 0% 0 0) } }

/* ── Card ── */
#vvsWrappedCard {
    position:relative;
    width:100%; max-width:440px; min-height:560px;
    border-radius:28px;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    padding:2.5rem 2rem 5rem;
    text-align:center;
    box-shadow:0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06);
    overflow:hidden;
    transition:background 0.6s cubic-bezier(0.4,0,0.2,1);
    user-select:none;
    font-family:'Barlow Condensed',sans-serif;
}

/* Shine sweep overlay */
#vvsWrappedCard::before {
    content:'';
    position:absolute; top:0; left:-100%; width:60%; height:100%;
    background:linear-gradient(90deg,transparent,rgba(255,255,255,0.07),transparent);
    animation:vwShine 4s ease-in-out infinite;
    pointer-events:none; z-index:0;
}

/* ── Progress bar ── */
#vvsWrappedCard .vw-progress {
    position:absolute; top:0; left:0; right:0;
    display:flex; gap:4px; padding:14px 16px 0; z-index:3;
}
#vvsWrappedCard .vw-prog-seg {
    height:3px; flex:1; border-radius:2px;
    background:rgba(255,255,255,0.22);
    overflow:hidden; position:relative;
}
#vvsWrappedCard .vw-prog-seg.done::after {
    content:''; position:absolute; inset:0;
    background:rgba(255,255,255,0.88);
}
#vvsWrappedCard .vw-prog-seg.active::after {
    content:''; position:absolute; inset:0;
    background:rgba(255,255,255,0.75);
    animation:vwProgressFill 0.5s ease forwards;
}

/* ── Top buttons ── */
.vw-close {
    position:absolute; top:1.1rem; right:1.1rem;
    background:rgba(255,255,255,0.15); border:1px solid rgba(255,255,255,0.25);
    color:#fff; width:34px; height:34px; border-radius:50%; font-size:1rem;
    cursor:pointer; display:flex; align-items:center; justify-content:center;
    transition:all 0.2s; z-index:4;
}
.vw-close:hover { background:rgba(255,255,255,0.3); transform:scale(1.1); }

.vw-share-top {
    position:absolute; top:1.1rem; right:3.8rem;
    background:rgba(255,255,255,0.15); border:1px solid rgba(255,255,255,0.25);
    color:#fff; width:34px; height:34px; border-radius:50%; font-size:1rem;
    cursor:pointer; display:flex; align-items:center; justify-content:center;
    transition:all 0.2s; z-index:4;
}
.vw-share-top:hover { background:rgba(255,255,255,0.3); transform:scale(1.1); }

/* ── Slide content ── */
#vwSlideContent { position:relative; z-index:1; width:100%; }

/* ── Animations ── */
.anim-intro .vw-icon     { animation:vwFloat 3s ease-in-out infinite; }
.anim-intro .vw-title    { animation:vwReveal 0.7s 0.2s ease both; }
.anim-intro .vw-subtitle { animation:vwReveal 0.7s 0.4s ease both; }
.anim-intro .vw-desc     { animation:vwSlideUp 0.5s 0.6s ease both; }

.anim-count .vw-icon     { animation:vwBounceIn 0.6s ease both; }
.anim-count .vw-label    { animation:vwSlideUp 0.4s 0.1s ease both; }
.anim-count .vw-big      { animation:vwFlashIn 0.5s 0.2s ease both; }
.anim-count .vw-desc     { animation:vwSlideUp 0.5s 0.4s ease both; }

.anim-double .vw-icon         { animation:vwBounceIn 0.6s ease both; }
.anim-double .vw-label        { animation:vwSlideUp 0.4s 0.1s ease both; }
.anim-double .vw-double-item  { animation:vwBounceIn 0.5s ease both; }
.anim-double .vw-double-item:nth-child(2) { animation-delay:0.15s; }
.anim-double .vw-desc         { animation:vwSlideUp 0.5s 0.35s ease both; }

.anim-cards .vw-icon      { animation:vwBounceIn 0.6s ease both; }
.anim-cards .vw-label     { animation:vwSlideUp 0.4s 0.1s ease both; }
.anim-cards .vw-card-item { animation:vwBounceIn 0.5s ease both; }
.anim-cards .vw-card-item:nth-child(2) { animation-delay:0.2s; }
.anim-cards .vw-desc      { animation:vwSlideUp 0.5s 0.4s ease both; }

.anim-summary .vw-sum-title  { animation:vwReveal 0.6s 0.1s ease both; }
.anim-summary .vw-sum-grid   { animation:vwSlideUp 0.5s 0.3s ease both; }
.anim-summary .vw-sum-motm   { animation:vwSlideUp 0.5s 0.5s ease both; }
.anim-summary .vw-sum-footer { animation:vwSlideUp 0.4s 0.65s ease both; }

.anim-outro .vw-icon  { animation:vwBounceIn 0.7s ease both; }
.anim-outro .vw-title { animation:vwGlow 2.5s 0.3s ease-in-out infinite,
                                  vwSlideUp 0.5s 0.3s ease both; }
.anim-outro .vw-desc  { animation:vwSlideUp 0.5s 0.5s ease both; }

/* ── Text elements ── */
.vw-slide { width:100%; position:relative; }

.vw-icon {
    width:76px; height:76px; object-fit:contain;
    margin:0 auto 0.85rem; display:block;
}
.vw-icon.invert { filter:invert(1); }

.vw-label {
    font-size:0.78rem; font-weight:800; letter-spacing:0.16em;
    color:rgba(255,255,255,0.85); text-transform:uppercase; margin-bottom:0.4rem;
    display:block;
}
.vw-big {
    font-size:clamp(4rem,15vw,5.5rem); font-weight:900; line-height:1;
    margin-bottom:0.6rem;
    filter:drop-shadow(0 4px 20px rgba(0,0,0,0.4));
}
.vw-title {
    font-size:clamp(1.8rem,6vw,2.6rem); font-weight:900; line-height:1.1;
    margin-bottom:0.4rem;
}
.vw-subtitle {
    font-size:1.4rem; font-weight:700; color:rgba(255,255,255,0.9);
    margin-bottom:0.8rem; letter-spacing:0.04em;
}
.vw-desc {
    font-size:1.05rem; font-weight:600; color:rgba(255,255,255,0.95);
    line-height:1.55; max-width:340px; margin:0 auto 1rem;
    text-shadow:0 1px 4px rgba(0,0,0,0.4);
}

.vw-double { display:flex; gap:2rem; justify-content:center; margin-bottom:0.75rem; }
.vw-double-item { display:flex; flex-direction:column; align-items:center; gap:2px; }
.vw-double-val  { font-size:3.8rem; font-weight:900; line-height:1;
                  filter:drop-shadow(0 2px 10px rgba(0,0,0,0.3)); }
.vw-double-lbl  { font-size:0.78rem; font-weight:800; letter-spacing:.1em;
                  color:rgba(255,255,255,0.85); text-transform:uppercase; }

.vw-cards-row   { display:flex; gap:1.5rem; justify-content:center; margin-bottom:0.8rem; }
.vw-card-item   { display:flex; flex-direction:column; align-items:center; gap:4px; }
.vw-card-val    { font-size:3.4rem; font-weight:900; line-height:1;
                  filter:drop-shadow(0 2px 8px rgba(0,0,0,0.3)); }
.vw-card-lbl    { font-size:0.78rem; font-weight:800; letter-spacing:.08em;
                  color:rgba(255,255,255,0.85); text-transform:uppercase; }

/* ── Summary slide ── */
.vw-summary-wrap {
    width:100%; text-align:left;
    padding:0 0.25rem;
}
.vw-sum-header {
    display:flex; align-items:center; justify-content:space-between;
    margin-bottom:0.9rem;
}
.vw-sum-name-block { flex:1; min-width:0; padding-right:0.75rem; }
.vw-sum-eyebrow {
    font-size:0.68rem; font-weight:800; letter-spacing:0.22em;
    color:rgba(255,255,255,0.52); text-transform:uppercase; display:block;
    margin-bottom:0.2rem;
}
.vw-sum-player-name {
    font-size:clamp(1.6rem,7vw,2.2rem); font-weight:900; line-height:1.05;
    color:#fff; text-transform:uppercase; word-break:break-word;
    text-shadow:0 2px 12px rgba(0,0,0,0.4);
}
.vw-sum-logo {
    width:64px; height:64px; object-fit:contain; flex-shrink:0;
    filter:drop-shadow(0 2px 8px rgba(0,0,0,0.4));
}
.vw-sum-divider {
    width:100%; height:1.5px;
    background:linear-gradient(90deg,rgba(255,255,255,0.35),rgba(255,255,255,0.05));
    margin-bottom:0.85rem; border:none;
}
.vw-sum-stat-row {
    display:flex; align-items:baseline; gap:0.65rem;
    margin-bottom:0.55rem; padding:0 0.1rem;
}
.vw-sum-stat-val {
    font-size:2.4rem; font-weight:900; line-height:1; min-width:2.5rem;
    text-align:right; flex-shrink:0;
    filter:drop-shadow(0 2px 10px rgba(0,0,0,0.3));
}
.vw-sum-stat-lbl {
    font-size:0.8rem; font-weight:800; letter-spacing:0.12em;
    color:rgba(255,255,255,0.62); text-transform:uppercase;
    padding-bottom:0.15rem;
}
.vw-sum-season {
    margin-top:0.8rem; padding-top:0.6rem;
    border-top:1px solid rgba(255,255,255,0.12);
    font-size:0.68rem; font-weight:700; letter-spacing:0.14em;
    color:rgba(255,255,255,0.38); text-transform:uppercase; text-align:center;
}

/* ── Nav bar ── */
.vw-nav {
    position:absolute; bottom:1.1rem; left:0; right:0;
    display:flex; align-items:center; justify-content:center; gap:0.65rem;
    flex-wrap:wrap; padding:0 1rem; z-index:3;
}
.vw-nav-btn {
    background:rgba(255,255,255,0.18); border:1.5px solid rgba(255,255,255,0.45);
    color:#fff; border-radius:50px; padding:0.5rem 1.25rem;
    font-size:0.88rem; font-weight:800; font-family:'Barlow Condensed',sans-serif;
    letter-spacing:0.06em; cursor:pointer; transition:all 0.2s;
    text-shadow:0 1px 3px rgba(0,0,0,0.2);
}
.vw-nav-btn:hover { background:rgba(255,255,255,0.32); border-color:rgba(255,255,255,0.8); transform:translateY(-1px); }
.vw-nav-btn:disabled { opacity:0.22; cursor:default; transform:none; }

.vw-counter { font-size:0.8rem; font-weight:700; color:rgba(255,255,255,0.65);
              font-family:'Barlow Condensed',sans-serif; letter-spacing:.04em; }
.vw-dismiss-btn {
    background:transparent; border:none; color:rgba(255,255,255,0.45);
    font-size:0.76rem; font-weight:600; font-family:'Barlow Condensed',sans-serif;
    letter-spacing:0.04em; cursor:pointer; text-decoration:underline;
    padding:0.3rem 0.5rem; transition:color 0.2s; width:100%; text-align:center;
    margin-top:-0.3rem;
}
.vw-dismiss-btn:hover { color:rgba(255,255,255,0.85); }

/* ── Particle burst ── */
.vw-particle {
    position:absolute; border-radius:50%; pointer-events:none;
    animation:vwParticle 0.9s ease-out forwards;
}

@media (max-width:480px) {
    #vvsWrappedCard { min-height:80svh; border-radius:22px; padding:2rem 1.25rem 5.5rem; }
    .vw-big     { font-size:3.8rem; }
    .vw-icon    { width:60px; height:60px; }
    .vw-title   { font-size:1.75rem; }
    .vw-desc    { font-size:0.95rem; }
    .vw-double  { gap:1.25rem; }
    .vw-double-val { font-size:3.2rem; }
    .vw-sum-cell-val { font-size:1.9rem; }
}
</style>

<div id="vvsWrappedCard">
    <button class="vw-share-top" id="vwShare" title="Deel deze slide">
        <img src="assets/share.png" alt="Deel" style="width:16px;height:16px;object-fit:contain;filter:invert(1);display:block;">
    </button>
    <button class="vw-close" id="vwClose" aria-label="Sluiten">✕</button>
    <div class="vw-progress" id="vwProgress"></div>
    <div id="vwSlideContent"></div>
    <div class="vw-nav">
        <button class="vw-nav-btn" id="vwPrev">← Vorige</button>
        <span class="vw-counter" id="vwCounter"></span>
        <button class="vw-nav-btn" id="vwNext">Volgende →</button>
        <button class="vw-dismiss-btn" id="vwDismiss">Niet meer tonen</button>
    </div>
</div>`;

    document.body.appendChild(modal);

    const card      = document.getElementById('vvsWrappedCard');
    const content   = document.getElementById('vwSlideContent');
    const progress  = document.getElementById('vwProgress');
    const counter   = document.getElementById('vwCounter');
    const btnPrev   = document.getElementById('vwPrev');
    const btnNext   = document.getElementById('vwNext');
    const btnClose  = document.getElementById('vwClose');
    const btnDismiss = document.getElementById('vwDismiss');

    // Build progress segments
    slides.forEach((_, i) => {
        const seg = document.createElement('div');
        seg.className = 'vw-prog-seg';
        seg.dataset.i = i;
        progress.appendChild(seg);
    });

    // ── Particle burst helper ─────────────────────────────────────────────────
    function burstParticles(count = 12) {
        const colors = ['#4fc3f7','#80deea','#ffe082','#f8bbd9','#b7e4c7','#fff'];
        for (let i = 0; i < count; i++) {
            const p = document.createElement('div');
            p.className = 'vw-particle';
            const size  = 4 + Math.random() * 6;
            const angle = Math.random() * Math.PI * 2;
            const dist  = 40 + Math.random() * 100;
            p.style.cssText = [
                `width:${size}px`, `height:${size}px`,
                `background:${colors[Math.floor(Math.random() * colors.length)]}`,
                `left:calc(50% + ${Math.cos(angle) * dist}px)`,
                `top:calc(40% + ${Math.sin(angle) * dist}px)`,
                `animation-delay:${Math.random() * 0.3}s`,
                'position:absolute', 'pointer-events:none',
                `animation:vwParticle ${0.6 + Math.random() * 0.5}s ease-out forwards`,
            ].join(';');
            card.appendChild(p);
            setTimeout(() => p.remove(), 1200);
        }
    }

    // ── Render function ───────────────────────────────────────────────────────
    function render(i) {
        const s  = slides[i];
        const ac = s.accent || '#fff';
        card.style.background = s.bg;

        // Progress
        progress.querySelectorAll('.vw-prog-seg').forEach((seg, j) => {
            seg.className = 'vw-prog-seg' + (j < i ? ' done' : j === i ? ' active' : '');
        });

        counter.textContent = `${i + 1} / ${slides.length}`;
        btnPrev.disabled = i === 0;
        btnNext.textContent = i === slides.length - 1 ? '✓ Klaar' : 'Volgende →';

        const animCls = s.animClass || 'anim-count';
        let html = `<div class="vw-slide ${animCls}">`;

        switch (s.type) {
            case 'intro':
                html += `
                    <img class="vw-icon${s.iconInvert ? ' invert' : ''}" src="${s.icon}" alt="">
                    <div class="vw-title" style="color:${ac}">${s.title}</div>
                    <div class="vw-subtitle">${s.subtitle}</div>
                    <div class="vw-desc">${s.desc}</div>`;
                break;

            case 'stat':
                html += `
                    <img class="vw-icon${s.iconInvert ? ' invert' : ''}" src="${s.icon}" alt="">
                    <span class="vw-label">${s.label}</span>
                    <div class="vw-big" style="color:${ac}">${s.value}</div>
                    <div class="vw-desc">${s.desc}</div>`;
                break;

            case 'double':
                html += `
                    <img class="vw-icon${s.iconInvert ? ' invert' : ''}" src="${s.icon}" alt="">
                    <span class="vw-label" style="color:${ac};margin-bottom:1rem;">${s.label}</span>
                    <div class="vw-double">
                        <div class="vw-double-item">
                            <span class="vw-double-val" style="color:${ac}">${s.value1}</span>
                            <span class="vw-double-lbl">${s.label1}</span>
                        </div>
                        <div class="vw-double-item">
                            <span class="vw-double-val" style="color:${ac}">${s.value2}</span>
                            <span class="vw-double-lbl">${s.label2}</span>
                        </div>
                    </div>
                    <div class="vw-desc">${s.desc}</div>`;
                break;

            case 'cards':
                html += `
                    <img class="vw-icon${s.iconInvert ? ' invert' : ''}" src="${s.icon}" alt="">
                    <span class="vw-label" style="color:${ac}">${s.label}</span>
                    <div class="vw-cards-row">
                        <div class="vw-card-item">
                            <span class="vw-card-val" style="color:#FFD600">${s.geel}</span>
                            <span class="vw-card-lbl">Geel</span>
                        </div>
                        <div class="vw-card-item">
                            <span class="vw-card-val" style="color:#FF3D00">${s.rood}</span>
                            <span class="vw-card-lbl">Rood</span>
                        </div>
                    </div>
                    <div class="vw-desc">${s.desc}</div>`;
                break;

            case 'summary': {
                const minFmt = s.minuten.toLocaleString('nl-BE');
                const seasonLabel = getSeasonLabel();
                const statRows = [
                    { val: s.goals,   lbl: 'GOALS',   col: '#7edd9a' },
                    { val: s.assists, lbl: 'ASSISTS',  col: '#ce93d8' },
                    { val: s.matchen, lbl: 'MATCHEN',  col: '#4fc3f7' },
                    { val: `${minFmt}'`, lbl: 'MINUTEN', col: '#80deea' },
                    ...(s.motm > 0 ? [{ val: s.motm, lbl: 'MAN VD. MATCH', col: '#FFE082' }] : []),
                ];
                html += `
                    <div class="vw-summary-wrap">
                        <div class="vw-sum-header">
                            <div class="vw-sum-name-block">
                                <span class="vw-sum-eyebrow">VVS Wrapped · ${seasonLabel}</span>
                                <div class="vw-sum-player-name">${s.naam}</div>
                            </div>
                            <img class="vw-sum-logo" src="assets/logo.png" alt="VVS">
                        </div>
                        <hr class="vw-sum-divider">
                        ${statRows.map(r => `
                        <div class="vw-sum-stat-row">
                            <span class="vw-sum-stat-val" style="color:${r.col}">${r.val}</span>
                            <span class="vw-sum-stat-lbl">${r.lbl}</span>
                        </div>`).join('')}
                        <div class="vw-sum-season">vvsrotselaar.be</div>
                    </div>`;
                break;
            }

            case 'outro':
                html += `
                    <img class="vw-icon${s.iconInvert ? ' invert' : ''}" src="${s.icon}" alt="">
                    <div class="vw-title" style="color:#fff">${s.title}</div>
                    <div class="vw-desc">${s.desc}</div>`;
                // Outro krijgt een groter confetti-feest
                if (typeof confetti === 'function') {
                    setTimeout(() => confetti({
                        particleCount: 140, spread: 110, origin: { y: 0.45 },
                        colors: ['#0047AB','#ffffff','#FFD600','#4fc3f7'],
                    }), 400);
                }
                break;
        }
        html += `</div>`;
        content.innerHTML = html;

        // ── Counting animation for .vw-big ────────────────────────────────────
        // Easing: snel optellen tot ~80%, dan sterk vertragen voor spanning,
        // confetti + particle burst pas wanneer het getal op zijn eindwaarde staat.
        if (s.rawValue !== undefined && !isNaN(s.rawValue) && s.rawValue > 0) {
            const bigEl = content.querySelector('.vw-big');
            if (bigEl) {
                const target    = s.rawValue;
                const formatted = s.value;
                // Totale duur: min 1.2s, max 2.8s afhankelijk van grootte
                const duration  = Math.min(1200 + Math.sqrt(target) * 100, 2800);
                let startTime   = null;
                let fired       = false;

                // Aangepaste easing: snel tot p=0.75, dan dramatisch vertragen
                function easeCustom(p) {
                    if (p < 0.75) {
                        // Snelle fase: bereikt ~90% van de waarde in 75% van de tijd
                        return 0.9 * (p / 0.75);
                    } else {
                        // Trage fase: laatste 10% duurt 25% van de tijd
                        const q = (p - 0.75) / 0.25;
                        return 0.9 + 0.1 * (1 - Math.pow(1 - q, 3));
                    }
                }

                function tick(ts) {
                    if (!startTime) startTime = ts;
                    const p   = Math.min((ts - startTime) / duration, 1);
                    const val = Math.round(target * easeCustom(p));
                    bigEl.textContent = val >= 1000 ? val.toLocaleString('nl-BE') : String(val);

                    if (p < 1) {
                        requestAnimationFrame(tick);
                    } else {
                        bigEl.textContent = formatted;
                        // Pas nu confetti + particles laten zien
                        if (!fired) {
                            fired = true;
                            burstParticles(12);
                            // Lichte confetti-scheur specifiek voor stat-slides
                            if (typeof confetti === 'function') {
                                confetti({
                                    particleCount: 55, spread: 70,
                                    origin: { x: 0.5, y: 0.55 },
                                    colors: ['#0047AB','#ffffff','#FFD600','#4fc3f7'],
                                    scalar: 0.85,
                                });
                            }
                        }
                    }
                }
                bigEl.textContent = '0';
                requestAnimationFrame(tick);
            }
        }

        // ── Summary staggered stat animation ─────────────────────────────────
        if (s.type === 'summary') {
            content.querySelectorAll('.vw-sum-stat-row').forEach((row, ci) => {
                row.style.opacity = '0';
                row.style.transform = 'translateX(-20px)';
                setTimeout(() => {
                    row.style.transition = 'opacity 0.45s ease, transform 0.45s ease';
                    row.style.opacity = '1';
                    row.style.transform = 'none';
                }, 300 + ci * 110);
            });
        }

        // Burst on double slides (stat slides burst after count finishes)
        if (s.type === 'double') {
            setTimeout(() => burstParticles(8), 350);
        }
    }

    function goTo(newIdx) {
        if (newIdx < 0 || newIdx > slides.length - 1) return;
        idx = newIdx;
        render(idx);
    }

    btnNext.addEventListener('click', () => {
        if (idx === slides.length - 1) closeModal();
        else goTo(idx + 1);
    });
    btnPrev.addEventListener('click', () => goTo(idx - 1));
    btnClose.addEventListener('click', closeModal);
    btnDismiss?.addEventListener('click', () => {
        try { localStorage.setItem(dismissedKey, '1'); } catch (_) {}
        closeModal();
    });

    document.getElementById('vwShare')?.addEventListener('click', () => {
        shareSlide(slides[idx], naam);
    });

    // Swipe support
    let touchX = 0, touchY = 0;
    card.addEventListener('touchstart', e => {
        touchX = e.touches[0].clientX;
        touchY = e.touches[0].clientY;
    }, { passive: true });
    card.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - touchX;
        const dy = Math.abs(e.changedTouches[0].clientY - touchY);
        if (Math.abs(dx) > 40 && dy < 60) {
            if (dx > 0) goTo(idx - 1);
            else goTo(idx + 1);
        }
    }, { passive: true });

    // Keyboard
    function onKey(e) {
        if (e.key === 'ArrowRight') goTo(idx + 1);
        if (e.key === 'ArrowLeft')  goTo(idx - 1);
        if (e.key === 'Escape')     closeModal();
    }
    document.addEventListener('keydown', onKey);

    function closeModal() {
        document.removeEventListener('keydown', onKey);
        modal.style.opacity = '0';
        modal.style.transition = 'opacity 0.35s ease';
        setTimeout(() => modal.remove(), 350);
    }

    render(0);
}

// ── Seizoenlabel automatisch berekenen ───────────────────────────────────────
// Voetbalseizoen loopt van zomer tot zomer: aug-dec = startjaar, jan-jul = vorig jaar
function getSeasonLabel() {
    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth() + 1; // 1-12
    const start = month >= 8 ? year : year - 1;
    return `${start}–${String(start + 1).slice(2)}`;
}

// ── Canvas share function ─────────────────────────────────────────────────────
async function shareSlide(slide, naam) {
    const btn = document.getElementById('vwShare');
    if (btn) { btn.innerHTML = '⏳'; btn.disabled = true; }

    try {
        const W = 1080, H = 1920;
        const canvas = document.createElement('canvas');
        canvas.width  = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // ── Background gradient ───────────────────────────────────────────────
        const gradColors = parseGradient(slide.bg);
        const grad = ctx.createLinearGradient(0, 0, W, H);
        grad.addColorStop(0, gradColors[0]);
        grad.addColorStop(1, gradColors[1]);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        // Depth overlay
        const ov = ctx.createLinearGradient(0, 0, 0, H);
        ov.addColorStop(0, 'rgba(0,0,0,0.05)');
        ov.addColorStop(1, 'rgba(0,0,0,0.35)');
        ctx.fillStyle = ov;
        ctx.fillRect(0, 0, W, H);

        // Subtle radial glow in center
        const glow = ctx.createRadialGradient(W/2, H*0.42, 0, W/2, H*0.42, W*0.7);
        glow.addColorStop(0, 'rgba(255,255,255,0.06)');
        glow.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);

        const cx     = W / 2;
        const accent = slide.accent || '#ffffff';

        // ── Header zone (top 180px) ───────────────────────────────────────────
        ctx.font         = 'bold 44px "Barlow Condensed", Arial, sans-serif';
        ctx.fillStyle    = 'rgba(255,255,255,0.45)';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('V.V.S ROTSELAAR', cx, 90);

        // Header separator line
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth   = 1.5;
        ctx.beginPath(); ctx.moveTo(80, 140); ctx.lineTo(W - 80, 140); ctx.stroke();

        // ── Footer zone (bottom 150px) ────────────────────────────────────────
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath(); ctx.moveTo(80, H - 150); ctx.lineTo(W - 150, H - 150); ctx.stroke();
        ctx.font      = 'bold 44px "Barlow Condensed", Arial, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillText(`${naam}  ·  VVS Wrapped`, cx, H - 80);

        // ── Content zone ──────────────────────────────────────────────────────
        const contentTop = 160;
        const contentBot = H - 160;
        const contentH   = contentBot - contentTop;
        const midY       = contentTop + contentH / 2;

        if (slide.type === 'summary') {
            await drawSummaryCanvas(ctx, slide, cx, contentTop, contentH, W, H, accent, naam);
        } else if (slide.type === 'stat') {
            await drawStatCanvas(ctx, slide, cx, midY, accent);
        } else if (slide.type === 'double') {
            await drawDoubleCanvas(ctx, slide, cx, midY, accent);
        } else if (slide.type === 'cards') {
            await drawCardsCanvas(ctx, slide, cx, midY, accent);
        } else {
            // intro / outro
            await drawIntroOutroCanvas(ctx, slide, cx, midY);
        }

        // Share
        const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
        const file = new File([blob], 'vvs-wrapped.png', { type: 'image/png' });

        if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({
                title: 'VVS Wrapped',
                text:  `${naam}'s VVS-seizoen in cijfers 💙`,
                files: [file],
            });
        } else {
            const url = URL.createObjectURL(blob);
            const a   = document.createElement('a');
            a.href     = url;
            a.download = 'vvs-wrapped.png';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 3000);
        }

    } catch (e) {
        if (e.name !== 'AbortError') console.warn('[Wrapped] Delen mislukt:', e);
    } finally {
        if (btn) {
            btn.innerHTML = '<img src="assets/share.png" alt="Deel" style="width:16px;height:16px;object-fit:contain;filter:invert(1);display:block;">';
            btn.disabled = false;
        }
    }
}

// ── Canvas draw helpers ───────────────────────────────────────────────────────

async function drawStatCanvas(ctx, slide, cx, midY, accent) {
    const iconH  = 200, labelH = 60, valueH = 280, descH = 160;
    const total  = iconH + labelH + valueH + descH + 40 + 20 + 50;
    let y = midY - total / 2;

    await drawIcon(ctx, slide.icon, cx, y + iconH / 2, iconH, slide.iconInvert);
    y += iconH + 40;

    ctx.font = 'bold 56px "Barlow Condensed", Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(slide.label, cx, y + labelH / 2);
    y += labelH + 20;

    ctx.font      = 'bold 280px "Barlow Condensed", Arial, sans-serif';
    ctx.fillStyle = accent;
    ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 40;
    ctx.fillText(String(slide.value), cx, y + valueH / 2);
    ctx.shadowBlur = 0;
    y += valueH + 50;

    wrapText(ctx, slide.desc, cx, y, 940, 64, 'rgba(255,255,255,0.92)', 'bold 52px "Barlow Condensed", Arial, sans-serif');
}

async function drawDoubleCanvas(ctx, slide, cx, midY, accent) {
    const iconH = 180, labelH = 60, valueH = 240, subH = 60, descH = 140;
    const total = iconH + labelH + valueH + subH + descH + 36 + 20 + 24 + 50;
    let y = midY - total / 2;

    await drawIcon(ctx, slide.icon, cx, y + iconH / 2, iconH, slide.iconInvert);
    y += iconH + 36;
    ctx.font = 'bold 56px "Barlow Condensed", Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.82)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(slide.label, cx, y + labelH / 2);
    y += labelH + 20;
    ctx.font = 'bold 240px "Barlow Condensed", Arial, sans-serif'; ctx.fillStyle = accent;
    ctx.fillText(String(slide.value1), cx - 250, y + valueH / 2);
    ctx.fillText(String(slide.value2), cx + 250, y + valueH / 2);
    y += valueH + 24;
    ctx.font = 'bold 56px "Barlow Condensed", Arial, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.fillText(slide.label1, cx - 250, y + subH / 2);
    ctx.fillText(slide.label2, cx + 250, y + subH / 2);
    y += subH + 50;
    wrapText(ctx, slide.desc, cx, y, 920, 62, 'rgba(255,255,255,0.92)', 'bold 52px "Barlow Condensed", Arial, sans-serif');
}

async function drawCardsCanvas(ctx, slide, cx, midY, accent) {
    const iconH = 180, labelH = 60, numH = 200, cardIconH = 180, cardLblH = 60, descH = 140;
    const total = iconH + labelH + numH + cardIconH + cardLblH + descH + 36 + 20 + 20 + 16 + 50;
    let y = midY - total / 2;

    await drawIcon(ctx, slide.icon, cx, y + iconH / 2, iconH, false);
    y += iconH + 36;
    ctx.font = 'bold 56px "Barlow Condensed", Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.82)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(slide.label, cx, y + labelH / 2);
    y += labelH + 20;
    ctx.font = 'bold 200px "Barlow Condensed", Arial, sans-serif';
    ctx.fillStyle = '#FFD600'; ctx.fillText(String(slide.geel), cx - 240, y + numH / 2);
    ctx.fillStyle = '#FF3D00'; ctx.fillText(String(slide.rood), cx + 240, y + numH / 2);
    y += numH + 20;
    await drawIcon(ctx, 'assets/yellow.png', cx - 240, y + cardIconH / 2, cardIconH, false);
    await drawIcon(ctx, 'assets/red.png',    cx + 240, y + cardIconH / 2, cardIconH, false);
    y += cardIconH + 16;
    ctx.font = 'bold 56px "Barlow Condensed", Arial, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.fillText('Geel', cx - 240, y + cardLblH / 2);
    ctx.fillText('Rood', cx + 240, y + cardLblH / 2);
    y += cardLblH + 50;
    wrapText(ctx, slide.desc, cx, y, 920, 62, 'rgba(255,255,255,0.92)', 'bold 52px "Barlow Condensed", Arial, sans-serif');
}

async function drawIntroOutroCanvas(ctx, slide, cx, midY) {
    const iconH = 240, titleH = 100, descH = 160, total = iconH + titleH + descH + 50 + 40;
    let y = midY - total / 2;
    await drawIcon(ctx, slide.icon, cx, y + iconH / 2, iconH, slide.iconInvert || false);
    y += iconH + 50;
    ctx.font = 'bold 100px "Barlow Condensed", Arial, sans-serif';
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(slide.title || slide.subtitle || 'VVS Wrapped', cx, y + titleH / 2);
    y += titleH + 40;
    wrapText(ctx, slide.desc, cx, y, 920, 66, 'rgba(255,255,255,0.88)', 'bold 56px "Barlow Condensed", Arial, sans-serif');
}

// ── Summary canvas — the star shareable ───────────────────────────────────────
async function drawSummaryCanvas(ctx, slide, cx, contentTop, contentH, W, H, accent, naam) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    // Logo
    const logoSize = 140;
    await drawIcon(ctx, 'assets/logo.png', cx, contentTop + 120, logoSize, false);

    // Title
    ctx.font      = 'bold 52px "Barlow Condensed", Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.letterSpacing = '0.2em';
    ctx.fillText('MIJN VVS SEIZOEN', cx, contentTop + 240);
    ctx.letterSpacing = '0';

    // Player name
    ctx.font      = 'bold 100px "Barlow Condensed", Arial, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 20;
    ctx.fillText(slide.naam.toUpperCase(), cx, contentTop + 350);
    ctx.shadowBlur = 0;

    // ── 2×2 stat grid ─────────────────────────────────────────────────────────
    const gridTop  = contentTop + 430;
    const cellW    = 420, cellH = 300;
    const gap      = 28;
    const cols     = [cx - cellW - gap / 2, cx + gap / 2];
    const rows     = [gridTop, gridTop + cellH + gap];

    const cells = [
        { val: slide.goals,   lbl: 'GOALS',   col: '#b7e4c7' },
        { val: slide.assists, lbl: 'ASSISTS',  col: '#ce93d8' },
        { val: slide.matchen, lbl: 'MATCHEN',  col: '#4fc3f7' },
        { val: `${slide.minuten.toLocaleString('nl-BE')}'`, lbl: 'MINUTEN', col: '#80deea', smallVal: true },
    ];

    cells.forEach((cell, ci) => {
        const col = ci % 2, row = Math.floor(ci / 2);
        const x   = cols[col], y = rows[row];

        // Card background
        ctx.save();
        roundRect(ctx, x, y, cellW, cellH, 28);
        ctx.fillStyle = 'rgba(255,255,255,0.09)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();

        // Value
        ctx.font      = `bold ${cell.smallVal ? '110px' : '140px'} "Barlow Condensed", Arial, sans-serif`;
        ctx.fillStyle = cell.col;
        ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 16;
        ctx.fillText(String(cell.val), x + cellW / 2, y + cellH * 0.48);
        ctx.shadowBlur = 0;

        // Label
        ctx.font      = 'bold 44px "Barlow Condensed", Arial, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.68)';
        ctx.fillText(cell.lbl, x + cellW / 2, y + cellH * 0.82);
    });

    // ── MOTM strip ────────────────────────────────────────────────────────────
    if (slide.motm > 0) {
        const motmY = rows[1] + cellH + gap + 20;
        const motmW = cellW * 2 + gap, motmH = 140, motmX = cx - motmW / 2;
        ctx.save();
        roundRect(ctx, motmX, motmY, motmW, motmH, 28);
        const mg = ctx.createLinearGradient(motmX, motmY, motmX + motmW, motmY + motmH);
        mg.addColorStop(0, 'rgba(180,130,0,0.22)');
        mg.addColorStop(1, 'rgba(255,215,0,0.12)');
        ctx.fillStyle = mg; ctx.fill();
        ctx.strokeStyle = 'rgba(255,215,0,0.35)'; ctx.lineWidth = 2; ctx.stroke();
        ctx.restore();

        ctx.font      = 'bold 80px "Barlow Condensed", Arial, sans-serif';
        ctx.fillStyle = '#FFE082';
        ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 16;
        ctx.fillText(`⭐ ${slide.motm}`, cx - 100, motmY + motmH / 2);
        ctx.shadowBlur = 0;

        ctx.font      = 'bold 46px "Barlow Condensed", Arial, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        ctx.fillText('MAN VAN DE MATCH', cx + 180, motmY + motmH / 2);
    }

    // ── Disciplne: kaarten ────────────────────────────────────────────────────
    const motmOffset = slide.motm > 0 ? 200 : 0;
    const disciplineY = rows[1] + cellH + gap + 20 + motmOffset;
    if (slide.geel > 0 || slide.rood > 0) {
        ctx.font      = 'bold 44px "Barlow Condensed", Arial, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.38)';
        ctx.fillText(`🟡 ${slide.geel}  ×  geel     🔴 ${slide.rood}  ×  rood`, cx, disciplineY + 50);
    }

    // ── Watermark footer ──────────────────────────────────────────────────────
    ctx.font      = 'bold 40px "Barlow Condensed", Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillText('vvsrotselaar.be  ·  Seizoen 2024–25', cx, H - 70);
}

// ── Utility: rounded rect path ────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

// ── Icon loader ───────────────────────────────────────────────────────────────
async function drawIcon(ctx, src, cx, cy, size, invert) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const half = size / 2;
            ctx.save();
            if (invert) {
                const off = document.createElement('canvas');
                off.width = size; off.height = size;
                const octx = off.getContext('2d');
                octx.filter = 'invert(1)';
                octx.drawImage(img, 0, 0, size, size);
                ctx.drawImage(off, cx - half, cy - half, size, size);
            } else {
                ctx.drawImage(img, cx - half, cy - half, size, size);
            }
            ctx.restore();
            resolve();
        };
        img.onerror = resolve;
        img.src = src;
    });
}

function parseGradient(bg) {
    const matches = bg.match(/#[0-9a-fA-F]{3,6}/g) || ['#0B1D3A', '#0047AB'];
    return [matches[0], matches[matches.length - 1]];
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, color, font) {
    if (!text) return;
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'center';
    const words = text.split(' ');
    let line = '', curY = y;
    for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxWidth && line) {
            ctx.fillText(line, x, curY);
            line = word; curY += lineHeight;
        } else { line = test; }
    }
    if (line) ctx.fillText(line, x, curY);
}