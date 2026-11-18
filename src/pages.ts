// Info pages (also required by Google AdSense): how to play, about, privacy, contact.
// Set the contact address in one place: CONTACT_EMAIL.
import { CFG } from '@sim';
import { MAX_PLAYERS } from './game/render';

export const CONTACT_EMAIL = '[SET CONTACT E-MAIL]';
/** until the address is set, the Contact page shows no placeholder */
const HAS_CONTACT = !CONTACT_EMAIL.startsWith('[');

interface Page {
  title: string;
  body: string;
}

const PAGES: Record<string, Page> = {
  'how-to-play': {
    title: 'How to play',
    body: `
      <p>Clingy Dingy is a fast timed climbing game. The first to reach the summit (${CFG.holds} holds) wins.</p>
      <h3>Controls</h3>
      <ol>
        <li>A ring closes on the next <b>blue</b> hold.</li>
        <li>When the ring closes, press the arrow for the side of the hold: <kbd>←</kbd> / <kbd>A</kbd> or <kbd>→</kbd> / <kbd>D</kbd>. On a phone, tap the left or right half of your screen.</li>
        <li><b>PERFECT</b> speeds you up, <b>OK</b> moves you up at the same pace, <b>too early</b> stalls you for a moment, and the <b>wrong hand</b> slips you one hold down.</li>
      </ol>
      <h3>Rooms and racing</h3>
      <ol>
        <li>Click “Create room” and send the link to your friends. Up to ${MAX_PLAYERS} players fit in one room.</li>
        <li>When everyone clicks “Ready!”, the countdown starts. After a round you can jump straight into a rematch.</li>
        <li>Your <b>own local time</b> is what counts, so network lag never affects your result. Every run is also checked on the server.</li>
      </ol>
      <h3>Account and rankings</h3>
      <p>You can play as a guest or create a free account. Only logged-in players' times make it into the global ranking. The room ranking shows the best times of a series of rematches in that room.</p>`,
  },
  'about': {
    title: 'About',
    body: `
      <p><b>Clingy Dingy</b> is a free browser game for 2–${MAX_PLAYERS} players: climbers race on parallel walls and everyone sees the others' progress live.</p>
      <p>It runs in the browser on desktop and mobile, with nothing to install. Results are verified on the server so the ranking stays fair.</p>
      <p>The game is under active development. Send ideas and feedback through the <a href="#/info/contact">Contact</a> page.</p>`,
  },
  privacy: {
    title: 'Privacy policy',
    body: `
      <p>Effective 17 November 2026. This page describes what data the Clingy Dingy game collects and why.</p>
      <h3>What we process</h3>
      <ul>
        <li><b>Playing without an account:</b> a nickname stored in your browser (localStorage) and a temporary random identifier for the time you are in a room.</li>
        <li><b>Account:</b> e-mail address, nickname and password (stored in hashed form by the authentication provider).</li>
        <li><b>Results:</b> run time, hit statistics and the log of key presses from a round, needed to verify the result's fairness and for the ranking.</li>
      </ul>
      <h3>Where data is stored</h3>
      <p>Account data and results are stored by Supabase (servers in the European Union). The game code is hosted on GitHub Pages.</p>
      <h3>Ads and cookies</h3>
      <p>The game may show Google AdSense ads. Google and its partners may use cookies and similar technologies to serve and measure ads (including personalised ads). You give or refuse consent to advertising cookies in the dialog shown on your first visit and can change it later. More: <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener">how Google uses data</a>.</p>
      <h3>Your rights</h3>
      <p>You have the right to access, correct and delete your data (including your whole account) and to lodge a complaint with your data protection authority. To use these rights, write to the address on the <a href="#/info/contact">Contact</a> page.</p>`,
  },
  contact: {
    title: 'Contact',
    body: HAS_CONTACT
      ? `
      <p>Have a question, an idea, or want your account deleted? Write to us:</p>
      <p><b>${CONTACT_EMAIL}</b></p>
      <p>We usually reply within a few working days.</p>`
      : '<p>Contact details will appear here soon.</p>',
  },
};

export const INFO_LINKS: [string, string][] = [
  ['how-to-play', 'How to play'],
  ['about', 'About'],
  ['privacy', 'Privacy'],
  ['contact', 'Contact'],
];

export const isInfoPage = (slug: string) => slug in PAGES;

/** `topbar` – the same account bar as in the menu, so login stays one click away on info pages too. */
export function infoHtml(slug: string, topbar = ''): string {
  const p = PAGES[slug];
  if (!p) return '';
  const nav = INFO_LINKS.map(([s, t]) => `<a href="#/info/${s}"${s === slug ? ' aria-current="page"' : ''}>${t}</a>`).join('');
  return `<div class="dim"></div><div class="studio">
    ${topbar}
    <header class="belka"><div class="tor me"><small>LANE</small>1</div><div class="title"><h1>CLINGY DINGY</h1><span>${p.title}</span></div><div class="tor opp"><small>UP TO</small>${MAX_PLAYERS}</div></header>
    <article class="doc"><h2>${p.title}</h2>${p.body}</article>
    <nav class="doc-nav" aria-label="Info pages"><a class="btn blue" href="#/">Back to game</a>${nav}</nav>
  </div>`;
}

export function footerLinksHtml(): string {
  return `<nav class="foot" aria-label="Information">${INFO_LINKS.map(([s, t]) => `<a href="#/info/${s}">${t}</a>`).join('')}</nav>`;
}
