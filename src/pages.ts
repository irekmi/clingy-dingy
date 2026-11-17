// Strony informacyjne (wymagane m.in. przez Google AdSense): jak grać, o grze, prywatność, kontakt.
// Adres kontaktowy ustaw w jednym miejscu: CONTACT_EMAIL.
import { CFG } from '@sim';
import { MAX_PLAYERS } from './game/render';

export const CONTACT_EMAIL = '[WPISZ ADRES E-MAIL]';
/** dopóki adres nie jest ustawiony, strona Kontakt nie pokazuje atrapy */
const HAS_CONTACT = !CONTACT_EMAIL.startsWith('[');

interface Page {
  title: string;
  body: string;
}

const PAGES: Record<string, Page> = {
  'jak-grac': {
    title: 'Jak grać',
    body: `
      <p>Clingy Dingy to szybka wspinaczka na czas. Wygrywa ten, kto pierwszy dotrze na szczyt (${CFG.holds} chwytów).</p>
      <h3>Sterowanie</h3>
      <ol>
        <li>Na następnym <b>niebieskim</b> chwycie zaciska się pierścień.</li>
        <li>Gdy pierścień się zamknie, wciśnij strzałkę strony chwytu: <kbd>←</kbd> / <kbd>A</kbd> albo <kbd>→</kbd> / <kbd>D</kbd>. Na telefonie dotknij lewej lub prawej połowy swojego ekranu.</li>
        <li><b>PERFEKT</b> przyspiesza tempo, <b>OK</b> wchodzi wyżej bez zmian, <b>za wcześnie</b> zatrzymuje na chwilę, a <b>zła ręka</b> zsuwa Cię o chwyt w dół.</li>
      </ol>
      <h3>Pokój i rywalizacja</h3>
      <ol>
        <li>Kliknij „Utwórz pokój” i wyślij link znajomym. W pokoju zagra do ${MAX_PLAYERS} osób.</li>
        <li>Gdy wszyscy klikną „Gotowy!”, zaczyna się odliczanie. Po rundzie możesz od razu zagrać rewanż.</li>
        <li>Liczy się <b>Twój własny, lokalny czas</b>, więc opóźnienia sieci nie wpływają na wynik. Każdy bieg jest dodatkowo sprawdzany na serwerze.</li>
      </ol>
      <h3>Konto i rankingi</h3>
      <p>Możesz grać jako gość albo założyć darmowe konto. Tylko czasy zalogowanych graczy trafiają do rankingu ogólnego. Ranking pokoju pokazuje najlepsze czasy w danej serii rewanży.</p>`,
  },
  'o-grze': {
    title: 'O grze',
    body: `
      <p><b>Clingy Dingy</b> to darmowa gra przeglądarkowa dla 2–${MAX_PLAYERS} osób: wspinacze rywalizują na równoległych ścianach, a każdy widzi na żywo postępy pozostałych.</p>
      <p>Gra działa w przeglądarce na komputerze i telefonie, bez instalacji. Wyniki są weryfikowane po stronie serwera, żeby ranking był uczciwy.</p>
      <p>Gra jest rozwijana na bieżąco. Pomysły i uwagi możesz wysłać przez stronę <a href="#/info/kontakt">Kontakt</a>.</p>`,
  },
  prywatnosc: {
    title: 'Polityka prywatności',
    body: `
      <p>Obowiązuje od 17 listopada 2026 r. Poniżej opisujemy, jakie dane zbiera gra Clingy Dingy i po co.</p>
      <h3>Jakie dane przetwarzamy</h3>
      <ul>
        <li><b>Gra bez konta:</b> nick zapisany w pamięci przeglądarki (localStorage) oraz tymczasowy, losowy identyfikator na czas gry w pokoju.</li>
        <li><b>Konto:</b> adres e-mail, nick i hasło (przechowywane w postaci zaszyfrowanej przez dostawcę uwierzytelniania).</li>
        <li><b>Wyniki:</b> czas biegu, liczba trafień i zapis wciśnięć klawiszy z danej rundy, potrzebne do weryfikacji uczciwości wyniku i do rankingu.</li>
      </ul>
      <h3>Gdzie przechowujemy dane</h3>
      <p>Dane kont i wyniki przechowuje Supabase (serwery w Unii Europejskiej). Kod gry jest hostowany na GitHub Pages.</p>
      <h3>Reklamy i pliki cookies</h3>
      <p>Gra może wyświetlać reklamy Google AdSense. Google i jego partnerzy mogą używać plików cookies i podobnych technologii do wyświetlania reklam (także spersonalizowanych) oraz ich pomiaru. Zgodę na cookies reklamowe wyrażasz lub odmawiasz w oknie wyświetlanym przy pierwszej wizycie i możesz ją później zmienić. Więcej: <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener">jak Google wykorzystuje dane</a>.</p>
      <h3>Twoje prawa</h3>
      <p>Masz prawo wglądu w swoje dane, ich poprawienia, usunięcia (w tym całego konta) oraz wniesienia skargi do Prezesa UODO. Aby skorzystać z tych praw, napisz na adres z zakładki <a href="#/info/kontakt">Kontakt</a>.</p>`,
  },
  kontakt: {
    title: 'Kontakt',
    body: HAS_CONTACT
      ? `
      <p>Masz pytanie, pomysł albo chcesz usunąć konto? Napisz do nas:</p>
      <p><b>${CONTACT_EMAIL}</b></p>
      <p>Odpowiadamy zwykle w ciągu kilku dni roboczych.</p>`
      : '<p>Dane kontaktowe pojawią się tutaj wkrótce.</p>',
  },
};

export const INFO_LINKS: [string, string][] = [
  ['jak-grac', 'Jak grać'],
  ['o-grze', 'O grze'],
  ['prywatnosc', 'Prywatność'],
  ['kontakt', 'Kontakt'],
];

export const isInfoPage = (slug: string) => slug in PAGES;

export function infoHtml(slug: string): string {
  const p = PAGES[slug];
  if (!p) return '';
  const nav = INFO_LINKS.map(([s, t]) => `<a href="#/info/${s}"${s === slug ? ' aria-current="page"' : ''}>${t}</a>`).join('');
  return `<div class="dim"></div><div class="studio">
    <header class="belka"><div class="tor me"><small>TOR</small>1</div><div class="title"><h1>CLINGY DINGY</h1><span>${p.title}</span></div><div class="tor opp"><small>DO</small>${MAX_PLAYERS}</div></header>
    <article class="doc"><h2>${p.title}</h2>${p.body}</article>
    <nav class="doc-nav" aria-label="Strony informacyjne"><a class="btn blue" href="#/">Wróć do gry</a>${nav}</nav>
  </div>`;
}

export function footerLinksHtml(): string {
  return `<nav class="foot" aria-label="Informacje">${INFO_LINKS.map(([s, t]) => `<a href="#/info/${s}">${t}</a>`).join('')}</nav>`;
}
